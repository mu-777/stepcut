import { access, appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { IMAGE_SOURCE_EXTENSIONS } from "../core/defaults";
import {
  type CliJobResult,
  type ExportJob,
  type ExportResult,
  MIN_WINDOW_W,
  type OpenedProject,
  type SettingsPatch,
  type TtsRequest,
} from "../shared/api";
import { AccessList, isValidProjectName } from "./access";
import {
  type CliArgs,
  defaultOutPath,
  formatJobResult,
  formatValidate,
  HELP,
  parseCli,
  validateFile,
} from "./cli";
import { FileReaders } from "./file-readers";
import { OutputFiles } from "./output-files";
import { resolveStoredPath } from "./paths";
import { ProjectWatcher, rebaseSourcePaths, writeAtomic } from "./project-files";
import { clearRecovery, clearRecoverySync, readRecovery, writeRecovery } from "./recovery";
import { azureKey, loadSettings, saveSettings, setAzureKey } from "./settings";
import { createAzureEngine } from "./tts/azure-engine";
import { createOsEngine } from "./tts/os-engine";
import { TtsService } from "./tts/service";
import { createVoicevoxEngine } from "./tts/voicevox-engine";

const PROJECT_FILTER = { name: "Screen Annotator Project", extensions: ["json"] };

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

let mainWindow: BrowserWindow | null = null;
let dirty = false;
let exportJob: ExportJob | null = null;
let exportDone: ((r: ExportResult | CliJobResult) => void) | null = null;
let cliJson = false;
/** 書き出し中か(ウィンドウを閉じるときに確かめる) */
let busy = false;
/** レンダラーから受け取るパスの許可(docs/decisions/20261111-ipc-restrictions.md) */
const acl = new AccessList();

/** クラッシュ復旧の自動保存の置き場(PRJ-06) */
const recoveryDir = () => path.join(app.getPath("userData"), "recovery");
/** 最後に復旧ファイルを書いたプロジェクト(null は未保存のプロジェクト)。閉じるときに消す */
let recoveryKeyOf: { projectPath: string | null } | null = null;
/** 書き込みと削除が前後しないよう、1 本ずつ順に行う */
let recoveryQueue: Promise<unknown> = Promise.resolve();
const inRecoveryQueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const r = recoveryQueue.then(fn, fn);
  recoveryQueue = r.catch(() => {});
  return r;
};
const assertRecoveryPath = (p: string | null) => (p === null ? null : acl.assertProject(p));

const tts = () =>
  new TtsService(path.join(app.getPath("userData"), "tts-cache"), [
    createOsEngine(),
    // ユーザーが自分で有効にするエンジン(既定は使えない)
    createVoicevoxEngine(async () => (await loadSettings()).engines.voicevox),
    createAzureEngine(async () => (await loadSettings()).engines.azure, azureKey),
  ]);
let ttsService: TtsService | null = null;

const watcher = new ProjectWatcher((filePath, text) => {
  mainWindow?.webContents.send("project:external-change", { filePath, text } satisfies OpenedProject);
});

function createWindow(opts: { show: boolean; query?: Record<string, string> }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: MIN_WINDOW_W,
    minHeight: 560,
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
  lockNavigation(win);
  const wcId = win.webContents.id;
  // レンダラーが落ちた・ウィンドウが閉じたら、書きかけの出力(.part)を捨てる
  win.webContents.on("render-process-gone", () => void outputs.closeOwner(wcId));
  win.on("closed", () => void outputs.closeOwner(wcId));
  const query = new URLSearchParams(opts.query).toString();
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? `?${query}` : ""}`);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), { query: opts.query });
  }
  return win;
}

/** 別のページへ移る・新しいウィンドウを開く・webview を付けることを禁じる(開発時だけ自分の dev サーバーの中は許す) */
function lockNavigation(win: BrowserWindow): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    let origin: string | null = null;
    try {
      origin = new URL(url).origin;
    } catch {
      // 読めない URL は止める
    }
    if (!devOrigin || origin !== devOrigin) e.preventDefault();
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

function sendMenu(command: string) {
  return () => mainWindow?.webContents.send("menu", command);
}

/** アプリのメニュー。Windows ではメニューバーを隠し、キー操作(accelerator)とコピー・貼り付けの役割だけに使う */
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
    {
      role: "help",
      submenu: [{ label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+/", click: sendMenu("shortcuts") }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readProject(filePath: string): Promise<OpenedProject> {
  acl.allowProject(filePath);
  const text = await readFile(filePath, "utf8");
  watcher.watch(filePath, text);
  return { filePath, text };
}

// 素材は読み込み中だけ開いておき、使われなくなったら閉じる
const readers = new FileReaders();
const outputs = new OutputFiles();

function registerIpc(): void {
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:set", async (_e, patch: SettingsPatch) => {
    // 起動する実行ファイルは、ファイル選択で選んだものか今の設定のものだけ
    acl.assertExe(patch?.engines?.voicevox?.exePath, (await loadSettings()).engines.voicevox.exePath);
    return saveSettings(patch);
  });
  ipcMain.handle("settings:azure-key", (_e, key: string | null) => setAzureKey(key));
  ipcMain.handle("dialog:pick-exe", async () => {
    const r = await dialog.showOpenDialog({
      filters: process.platform === "win32" ? [{ name: "Program", extensions: ["exe"] }] : [],
      properties: ["openFile"],
    });
    const exe = r.canceled ? null : (r.filePaths[0] ?? null);
    if (exe) acl.allowExe(exe);
    return exe;
  });
  // 規約の案内を開く。https だけ
  ipcMain.handle("shell:open-external", async (_e, url: string) => {
    if (url.startsWith("https://")) await shell.openExternal(url);
  });
  ipcMain.handle("dialog:pick-dir", async (_e, defaultPath: string | null) => {
    const r = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return r.filePaths[0] ?? null;
  });
  ipcMain.handle("project:open-dialog", async () => {
    const dir = (await loadSettings()).projectDir;
    const r = await dialog.showOpenDialog({
      filters: [PROJECT_FILTER],
      properties: ["openFile"],
      ...(dir ? { defaultPath: dir } : {}),
    });
    const file = r.filePaths[0];
    return file ? readProject(file) : null;
  });
  ipcMain.handle("project:read", (_e, filePath: string) => readProject(acl.assertProject(filePath)));
  ipcMain.handle("project:initial", () => (initialProject ? readProject(initialProject) : null));
  ipcMain.handle(
    "project:save",
    async (_e, filePath: string | null, text: string, prevPath: string | null, name?: string) => {
      if (filePath !== null) acl.assertProject(filePath);
      let target = filePath;
      if (!target) {
        // 新しいプロジェクト: 名前(ヘッダーで入力したもの)で、アプリの設定の保存先に置く。
        // 保存先を決めていない・同じ名前のファイルがあるときは、その名前で保存先を尋ねる
        const fileName = `${name || "project"}.sanno.json`;
        const dir = (await loadSettings()).projectDir;
        const direct = dir && name ? path.join(dir, fileName) : null;
        if (direct && !(await exists(direct))) target = direct;
        else {
          const r = await dialog.showSaveDialog({
            filters: [PROJECT_FILTER],
            defaultPath: dir ? path.join(dir, fileName) : fileName,
          });
          if (r.canceled || !r.filePath) return null;
          target = r.filePath;
        }
      }
      acl.allowProject(target);
      const rebased = rebaseSourcePaths(text, prevPath ? path.dirname(prevPath) : null, path.dirname(target));
      watcher.markSaved(rebased);
      await writeAtomic(target, rebased);
      watcher.watch(target, rebased);
      return { filePath: target, text: rebased } satisfies OpenedProject;
    },
  );
  // プロジェクトの名前の変更: 同じフォルダーでファイル名を変える(素材のパスは同じフォルダーからの相対なので変わらない)
  ipcMain.handle("project:rename", async (_e, from: string, name: string) => {
    acl.assertProject(from);
    if (!isValidProjectName(name)) throw new Error(`この名前は使えません / Invalid name: ${String(name)}`);
    const ext = /\.sanno\.json$/i.test(from) ? ".sanno.json" : path.extname(from);
    const target = path.join(path.dirname(from), `${name}${ext}`);
    if (target === from) return target;
    if (await exists(target)) throw new Error(`同じ名前のファイルがあります / Already exists: ${target}`);
    await rename(from, target);
    acl.allowProject(target);
    watcher.watch(target, await readFile(target, "utf8"));
    return target;
  });
  ipcMain.handle(
    "recovery:write",
    async (_e, projectPath: string | null, name: string | null, text: string) => {
      const p = assertRecoveryPath(projectPath);
      if (typeof text !== "string") return;
      recoveryKeyOf = { projectPath: p };
      await inRecoveryQueue(() =>
        writeRecovery(recoveryDir(), p, typeof name === "string" ? name : null, text),
      );
    },
  );
  ipcMain.handle("recovery:read", (_e, projectPath: string | null) =>
    readRecovery(recoveryDir(), assertRecoveryPath(projectPath)),
  );
  ipcMain.handle("recovery:clear", (_e, projectPath: string | null) =>
    inRecoveryQueue(() => clearRecovery(recoveryDir(), assertRecoveryPath(projectPath))),
  );
  ipcMain.handle("sources:pick", async () => {
    const r = await dialog.showOpenDialog({
      filters: [
        { name: "MP4 / Image", extensions: ["mp4", ...IMAGE_SOURCE_EXTENSIONS] },
        { name: "MP4", extensions: ["mp4"] },
        { name: "Image", extensions: [...IMAGE_SOURCE_EXTENSIONS] },
      ],
      properties: ["openFile", "multiSelections"],
    });
    for (const p of r.filePaths) acl.allowRead(p);
    return r.filePaths;
  });
  ipcMain.handle("image:pick", async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile"],
    });
    const img = r.filePaths[0] ?? null;
    if (img) acl.allowRead(img);
    return img;
  });
  // 書き出したファイルをエクスプローラー(Finder)で選んだ状態で開く
  ipcMain.handle("file:reveal", (_e, absPath: string) => shell.showItemInFolder(acl.assertReveal(absPath)));
  ipcMain.handle("export:pick", async (_e, defaultPath: string) => {
    const r = await dialog.showSaveDialog({ filters: [{ name: "MP4", extensions: ["mp4"] }], defaultPath });
    const out = r.canceled ? null : (r.filePath ?? null);
    if (out) acl.allowExport(out);
    return out;
  });
  ipcMain.handle("sources:resolve", (_e, projectPath: string | null, stored: string) => {
    const resolved = projectPath ? resolveStoredPath(path.dirname(projectPath), stored) : stored;
    acl.allowResolved(projectPath, resolved);
    return resolved;
  });
  ipcMain.on("project:dirty", (_e, value: boolean) => {
    dirty = value;
  });
  ipcMain.on("project:busy", (_e, value: boolean) => {
    busy = value === true;
  });
  // 「保存して閉じる」で保存できたあと
  ipcMain.on("window:close-after-save", () => {
    dirty = false;
    busy = false;
    mainWindow?.close();
  });
  // プリロードが、ドロップされたファイルのパスを得たとき(レンダラーが決めたパスではない)
  ipcMain.on("file:dropped", (_e, p: string) => {
    if (typeof p === "string" && p) acl.allowRead(p);
  });

  ipcMain.handle("file:size", async (_e, p: string) => (await stat(acl.assertRead(p))).size);
  ipcMain.handle("file:read-range", (_e, p: string, start: number, end: number) =>
    readers.read(acl.assertRead(p), start, end),
  );
  ipcMain.handle("output:open", (e, p: string) => outputs.open(acl.assertWrite(p), e.sender.id));
  ipcMain.handle("output:write", (_e, handle: number, position: number, data: Uint8Array) =>
    outputs.write(handle, position, data),
  );
  ipcMain.handle("output:close", (_e, handle: number, commit: boolean) =>
    outputs.close(handle, commit === true),
  );
  ipcMain.handle("file:write-text", (_e, p: string, text: string) =>
    writeFile(acl.assertWrite(p), text, "utf8"),
  );

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
  ipcMain.on("export:finish", (_e, result: ExportResult | CliJobResult) => exportDone?.(result));
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
  acl.allowProject(projectPath);
  const outPath = args.out ?? defaultOutPath(args);
  if (args.command === "export") acl.allowExport(outPath);
  else acl.allowWrite(outPath);
  exportJob = {
    kind: args.command === "frame" || args.command === "inspect" ? args.command : "export",
    projectPath,
    projectText: await readFile(projectPath, "utf8"),
    outPath,
    frame: { step: args.step, time: args.time, at: args.at, source: args.source },
  };
  const result = await new Promise<ExportResult | CliJobResult>((resolve) => {
    exportDone = resolve;
    const win = createWindow({ show: false, query: { mode: "export" } });
    win.webContents.on("render-process-gone", (_e, d) =>
      resolve({ ok: false, warnings: [], error: `renderer exited: ${d.reason}` }),
    );
  });
  if (!args.json && exportJob.kind === "export") process.stderr.write("\n");
  process.stdout.write(`${args.json ? JSON.stringify(result) : formatJobResult(exportJob.kind, result)}\n`);
  if (!args.json) for (const w of result.warnings) process.stdout.write(`warn   ${w}\n`);
  await writeResult(args, result);
  return result.ok ? 0 : 1;
}

const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const cli = parseCli(argv);
// コマンドなしで .json を渡されたら、そのプロジェクトを開いて起動する
const initialArg = cli ? undefined : argv.find((a) => !a.startsWith("-") && /\.json$/i.test(a));
const initialProject = initialArg ? path.resolve(initialArg) : null;
if (initialProject) acl.allowProject(initialProject);

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
  // メニューバーは出さない(操作は画面のヘッダーにある)。メニューは残し、Ctrl+S などのキーとコピー・貼り付けに使う
  if (process.platform !== "darwin") mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", (e) => {
    if (!mainWindow) return;
    if (busy) {
      const keep = dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        buttons: ["中止して閉じる / Cancel export and close", "閉じない / Keep open"],
        defaultId: 1,
        cancelId: 1,
        message: "書き出し中です。中止して閉じますか？ / An export is running. Cancel it and close?",
      });
      if (keep === 1) {
        e.preventDefault();
        return;
      }
    }
    if (!dirty) {
      // 変更なしで閉じる。復旧ファイルは要らない
      if (recoveryKeyOf) clearRecoverySync(recoveryDir(), recoveryKeyOf.projectPath);
      return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["保存して閉じる / Save and close", "破棄して閉じる / Discard", "キャンセル / Cancel"],
      defaultId: 2,
      cancelId: 2,
      message: "保存していない変更があります。/ You have unsaved changes.",
    });
    if (choice === 0) {
      // 保存できたらレンダラーが closeAfterSave で閉じる。取り消し・失敗なら閉じない
      e.preventDefault();
      mainWindow.webContents.send("menu", "saveAndClose");
    } else if (choice === 2) e.preventDefault();
    else if (recoveryKeyOf) clearRecoverySync(recoveryDir(), recoveryKeyOf.projectPath); // 破棄して閉じる
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
