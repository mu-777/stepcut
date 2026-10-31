import { appendFile, type FileHandle, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import type { ExportJob, ExportResult, OpenedProject, TtsRequest } from "../shared/api";
import { type CliArgs, formatValidate, HELP, parseCli, validateFile } from "./cli";
import { resolveStoredPath } from "./paths";
import { ProjectWatcher, rebaseSourcePaths, writeAtomic } from "./project-files";
import { createOsEngine } from "./tts/os-engine";
import { TtsService } from "./tts/service";

const PROJECT_FILTER = { name: "Screen Annotator Project", extensions: ["json"] };

let mainWindow: BrowserWindow | null = null;
let dirty = false;
let exportJob: ExportJob | null = null;
let exportDone: ((r: ExportResult) => void) | null = null;
let cliJson = false;

const tts = () => new TtsService(path.join(app.getPath("userData"), "tts-cache"), [createOsEngine()]);
let ttsService: TtsService | null = null;

const watcher = new ProjectWatcher((filePath, text) => {
  mainWindow?.webContents.send("project:external-change", { filePath, text } satisfies OpenedProject);
});

function createWindow(opts: { show: boolean; query?: Record<string, string> }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: opts.show,
    title: "Screen Annotator",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  const query = new URLSearchParams(opts.query).toString();
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? `?${query}` : ""}`);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), { query: opts.query });
  }
  return win;
}

function sendMenu(command: string) {
  return () => mainWindow?.webContents.send("menu", command);
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: sendMenu("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: sendMenu("open") },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: sendMenu("save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: sendMenu("saveAs") },
        { type: "separator" },
        { label: "Add Recording…", click: sendMenu("addSource") },
        { label: "Export…", accelerator: "CmdOrCtrl+E", click: sendMenu("export") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        // テキスト入力中は入力欄の Undo、それ以外はプロジェクトの Undo(レンダラー側で振り分ける)
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: sendMenu("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: sendMenu("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { role: "viewMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readProject(filePath: string): Promise<OpenedProject> {
  const text = await readFile(filePath, "utf8");
  watcher.watch(filePath, text);
  return { filePath, text };
}

// 素材は読み込みのたびに開き直さず、開いたままにする(アプリの終了で閉じる)
const readers = new Map<string, Promise<FileHandle>>();
const outputs = new Map<number, FileHandle>();
let nextHandle = 1;

function registerIpc(): void {
  ipcMain.handle("project:open-dialog", async () => {
    const r = await dialog.showOpenDialog({ filters: [PROJECT_FILTER], properties: ["openFile"] });
    const file = r.filePaths[0];
    return file ? readProject(file) : null;
  });
  ipcMain.handle("project:read", (_e, filePath: string) => readProject(filePath));
  ipcMain.handle("project:initial", () => (initialProject ? readProject(initialProject) : null));
  ipcMain.handle(
    "project:save",
    async (_e, filePath: string | null, text: string, prevPath: string | null) => {
      let target = filePath;
      if (!target) {
        const r = await dialog.showSaveDialog({
          filters: [PROJECT_FILTER],
          defaultPath: prevPath ?? "project.sanno.json",
        });
        if (r.canceled || !r.filePath) return null;
        target = r.filePath;
      }
      const rebased = rebaseSourcePaths(text, prevPath ? path.dirname(prevPath) : null, path.dirname(target));
      watcher.markSaved(rebased);
      await writeAtomic(target, rebased);
      watcher.watch(target, rebased);
      return { filePath: target, text: rebased } satisfies OpenedProject;
    },
  );
  ipcMain.handle("sources:pick", async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: "MP4", extensions: ["mp4"] }],
      properties: ["openFile", "multiSelections"],
    });
    return r.filePaths;
  });
  ipcMain.handle("image:pick", async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile"],
    });
    return r.filePaths[0] ?? null;
  });
  ipcMain.handle("export:pick", async (_e, defaultPath: string) => {
    const r = await dialog.showSaveDialog({ filters: [{ name: "MP4", extensions: ["mp4"] }], defaultPath });
    return r.canceled ? null : (r.filePath ?? null);
  });
  ipcMain.handle("sources:resolve", (_e, projectPath: string | null, stored: string) =>
    projectPath ? resolveStoredPath(path.dirname(projectPath), stored) : stored,
  );
  ipcMain.on("project:dirty", (_e, value: boolean) => {
    dirty = value;
  });

  ipcMain.handle("file:size", async (_e, p: string) => (await stat(p)).size);
  ipcMain.handle("file:read-range", async (_e, p: string, start: number, end: number) => {
    let fh = readers.get(p);
    if (!fh) {
      fh = open(p, "r");
      readers.set(p, fh);
    }
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await (await fh).read(buf, 0, end - start, start);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  });
  ipcMain.handle("output:open", async (_e, p: string) => {
    const handle = nextHandle++;
    outputs.set(handle, await open(p, "w"));
    return handle;
  });
  ipcMain.handle("output:write", async (_e, handle: number, position: number, data: Uint8Array) => {
    const fh = outputs.get(handle);
    if (!fh) throw new Error("output handle is closed");
    await fh.write(data, 0, data.byteLength, position);
  });
  ipcMain.handle("output:close", async (_e, handle: number) => {
    await outputs.get(handle)?.close();
    outputs.delete(handle);
  });
  ipcMain.handle("file:write-text", (_e, p: string, text: string) => writeFile(p, text, "utf8"));

  ipcMain.handle("tts:voices", (_e, engine: string) => {
    ttsService ??= tts();
    return ttsService.voices(engine);
  });
  ipcMain.handle("tts:synthesize", (_e, req: TtsRequest) => {
    ttsService ??= tts();
    return ttsService.synthesize(req);
  });

  ipcMain.handle("export:job", () => exportJob);
  ipcMain.on("export:progress", (_e, done: number, total: number) => {
    if (!cliJson && total > 0) process.stderr.write(`\rexport ${Math.round((done / total) * 100)}%`);
  });
  ipcMain.on("export:finish", (_e, result: ExportResult) => exportDone?.(result));
}

async function writeResult(args: CliArgs, payload: unknown): Promise<void> {
  if (args.result) await writeFile(args.result, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function runCli(args: CliArgs): Promise<number> {
  cliJson = args.json;
  if (args.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const projectPath = args.project as string;
  const v = await validateFile(projectPath);
  if (args.command === "validate" || !v.ok) {
    process.stdout.write(`${args.json ? JSON.stringify(v) : formatValidate(v)}\n`);
    await writeResult(args, v);
    return v.ok ? 0 : 1;
  }
  exportJob = {
    projectPath,
    projectText: await readFile(projectPath, "utf8"),
    outPath: args.out ?? projectPath.replace(/(\.sanno)?\.json$/i, "") + ".mp4",
  };
  const result = await new Promise<ExportResult>((resolve) => {
    exportDone = resolve;
    const win = createWindow({ show: false, query: { mode: "export" } });
    win.webContents.on("render-process-gone", (_e, d) =>
      resolve({ ok: false, warnings: [], error: `renderer exited: ${d.reason}` }),
    );
  });
  if (!args.json) process.stderr.write("\n");
  process.stdout.write(
    `${args.json ? JSON.stringify(result) : result.ok ? `OK ${result.outPath}` : `NG ${result.error}`}\n`,
  );
  if (!args.json) for (const w of result.warnings) process.stdout.write(`warn   ${w}\n`);
  await writeResult(args, result);
  return result.ok ? 0 : 1;
}

const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const cli = parseCli(argv);
// コマンドなしで .json を渡されたら、そのプロジェクトを開いて起動する
const initialArg = cli ? undefined : argv.find((a) => !a.startsWith("-") && /\.json$/i.test(a));
const initialProject = initialArg ? path.resolve(initialArg) : null;

app.whenReady().then(async () => {
  registerIpc();
  if (cli && "error" in cli) {
    process.stderr.write(`${cli.error}\n${HELP}\n`);
    app.exit(2);
    return;
  }
  if (cli) {
    const code = await runCli(cli).catch((e) => {
      process.stderr.write(`${(e as Error).stack ?? e}\n`);
      return 1;
    });
    app.exit(code);
    return;
  }
  buildMenu();
  mainWindow = createWindow({ show: true });
  mainWindow.on("close", (e) => {
    if (!dirty || !mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Discard / 破棄して閉じる", "Cancel / キャンセル"],
      defaultId: 1,
      message: "保存していない変更があります。/ You have unsaved changes.",
    });
    if (choice === 1) e.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    watcher.stop();
  });
});

// GPU プロセスやレンダラーが落ちたときの記録。画面が一瞬白くなる現象の原因を後から確かめるため
async function logProcessGone(kind: string, details: { reason: string; exitCode: number }): Promise<void> {
  const line = `${new Date().toISOString()} ${kind} reason=${details.reason} exitCode=${details.exitCode}\n`;
  process.stderr.write(line);
  try {
    const dir = app.getPath("logs");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "process-gone.log"), line, "utf8");
  } catch {
    // 記録できなくても動作は続ける
  }
}
app.on("child-process-gone", (_e, d) => void logProcessGone(`child:${d.type}`, d));
app.on("render-process-gone", (_e, _wc, d) => void logProcessGone("renderer", d));

app.on("window-all-closed", () => {
  if (!cli) app.quit();
});
