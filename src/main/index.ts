import { existsSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  net,
  shell,
} from "electron";
import iconIco from "../../build/icon.ico?asset";
import iconPng from "../../build/icon.png?asset";
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
import { AppError, encodeError } from "../shared/messages";
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
import { mt, setMainLanguage } from "./i18n";
import { OutputFiles } from "./output-files";
import { resolveStoredPath } from "./paths";
import { ProjectWatcher, rebaseSourcePaths, writeAtomic } from "./project-files";
import { clearRecovery, clearRecoverySync, readRecovery, writeRecovery } from "./recovery";
import { azureKey, loadSettings, saveSettings, setAzureKey } from "./settings";
import { createAzureEngine } from "./tts/azure-engine";
import { createOsEngine } from "./tts/os-engine";
import { TtsService } from "./tts/service";
import { createVoicevoxEngine } from "./tts/voicevox-engine";
import { stepUiZoom, type UiZoomCommand, uiZoomCommand } from "./ui-zoom";
import { checkForUpdate, RELEASES_API } from "./update-check";

const PROJECT_FILTER = { name: "StepCut Project", extensions: ["json"] };

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
    title: "StepCut",
    // タイトルバー・タスクバーのアイコン。Windows は exe と同じ ICO(小さい大きさの絵を持つ)、ほかは 256px の PNG。
    // 元は assets/logo/、作り方は docs/decisions/20261112-logo.md
    icon: process.platform === "win32" ? iconIco : iconPng,
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

/** 画面全体の表示の大きさを変えて覚える(メインのウィンドウだけ。書き出し用の隠れたウィンドウには当てない) */
async function applyUiZoom(cmd: UiZoomCommand): Promise<void> {
  const win = mainWindow;
  if (!win) return;
  const cur = (await loadSettings()).uiZoom;
  const next = cmd === "reset" ? 1 : stepUiZoom(cur, cmd === "in" ? 1 : -1);
  // 先に覚えてから当てる(倍率が変わると画面の resize が起き、開いているアプリの設定が読み直すため)
  if (next !== cur) await saveSettings({ uiZoom: next });
  if (!win.isDestroyed()) win.webContents.setZoomFactor(next);
}

/**
 * 表示の大きさのキーを受ける。メニューの accelerator は配列によって「+」が届かないので、キーの押下を直接見る。
 * 読み込み直したときは覚えた倍率を当て直す
 */
function setupUiZoom(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (e, input) => {
    const cmd = uiZoomCommand(input);
    if (!cmd) return;
    e.preventDefault();
    void applyUiZoom(cmd);
  });
  win.webContents.on("did-finish-load", () => {
    void loadSettings().then((s) => {
      if (!win.isDestroyed()) win.webContents.setZoomFactor(s.uiZoom);
    });
  });
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
      label: mt("file"),
      submenu: [
        { label: mt("new"), accelerator: "CmdOrCtrl+N", click: sendMenu("new") },
        { label: mt("open"), accelerator: "CmdOrCtrl+O", click: sendMenu("open") },
        { label: mt("save"), accelerator: "CmdOrCtrl+S", click: sendMenu("save") },
        { type: "separator" },
        { label: mt("addRecording"), click: sendMenu("addSource") },
        { label: mt("export"), accelerator: "CmdOrCtrl+E", click: sendMenu("export") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: mt("edit"),
      submenu: [
        // テキスト入力中は入力欄の Undo、それ以外はプロジェクトの Undo(レンダラー側で振り分ける)
        { label: mt("undo"), accelerator: "CmdOrCtrl+Z", click: sendMenu("undo") },
        { label: mt("redo"), accelerator: "CmdOrCtrl+Shift+Z", click: sendMenu("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: mt("view"),
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        // キーは setupUiZoom が受ける(ここは表示だけ。registerAccelerator: false)
        {
          label: mt("zoomIn"),
          accelerator: "CmdOrCtrl+Plus",
          registerAccelerator: false,
          click: () => void applyUiZoom("in"),
        },
        {
          label: mt("zoomOut"),
          accelerator: "CmdOrCtrl+-",
          registerAccelerator: false,
          click: () => void applyUiZoom("out"),
        },
        {
          label: mt("actualSize"),
          accelerator: "CmdOrCtrl+0",
          registerAccelerator: false,
          click: () => void applyUiZoom("reset"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [{ label: mt("shortcuts"), accelerator: "CmdOrCtrl+/", click: sendMenu("shortcuts") }],
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

/** 画面の言語に合わせる(メニューを作り直す)。auto なら OS の言語 */
function applyMainLanguage(lang: "auto" | "ja" | "en"): void {
  setMainLanguage(lang, app.getLocale());
  if (!cli) buildMenu();
}

/**
 * ipcMain.handle に、AppError を画面で訳せる形にして返す処理を足したもの(shared/messages.ts)。
 * Electron の invoke はエラーの message しか渡さないため
 */
function handle<A extends unknown[]>(
  channel: string,
  fn: (e: IpcMainInvokeEvent, ...args: A) => unknown,
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await fn(e, ...(args as A));
    } catch (err) {
      throw encodeError(err);
    }
  });
}

function registerIpc(): void {
  handle("settings:get", () => loadSettings());
  handle("settings:set", async (_e, patch: SettingsPatch) => {
    // 起動する実行ファイルは、ファイル選択で選んだものか今の設定のものだけ
    acl.assertExe(patch?.engines?.voicevox?.exePath, (await loadSettings()).engines.voicevox.exePath);
    const saved = await saveSettings(patch);
    if (patch?.language !== undefined) applyMainLanguage(saved.language);
    // アプリの設定で数字を入れたときは、すぐ画面に当てる
    if (patch?.uiZoom !== undefined && mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.setZoomFactor(saved.uiZoom);
    return saved;
  });
  handle("settings:azure-key", (_e, key: string | null) => setAzureKey(key));
  handle("dialog:pick-exe", async () => {
    const r = await dialog.showOpenDialog({
      filters: process.platform === "win32" ? [{ name: "Program", extensions: ["exe"] }] : [],
      properties: ["openFile"],
    });
    const exe = r.canceled ? null : (r.filePaths[0] ?? null);
    if (exe) acl.allowExe(exe);
    return exe;
  });
  // 規約の案内を開く。https だけ
  handle("shell:open-external", async (_e, url: string) => {
    if (url.startsWith("https://")) await shell.openExternal(url);
  });
  // 新しい版の確認(GitHub Releases)。テストでは STEPCUT_UPDATE_URL で確認先を差し替える
  const checkUpdate = () =>
    checkForUpdate(
      app.getVersion(),
      (url, init) => net.fetch(url, init),
      process.env.STEPCUT_UPDATE_URL || RELEASES_API,
    );
  handle("update:check", () => checkUpdate());
  handle("update:auto", async () => {
    // 開発中(パッケージしていない)と CLI では自動で確認しない。E2E が外へ通信しないように
    if (cli || (!app.isPackaged && !process.env.STEPCUT_UPDATE_URL)) return null;
    if (!(await loadSettings()).checkUpdates) return null;
    return checkUpdate();
  });
  handle("dialog:pick-dir", async (_e, defaultPath: string | null) => {
    const r = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return r.filePaths[0] ?? null;
  });
  handle("project:open-dialog", async () => {
    const dir = (await loadSettings()).projectDir;
    const r = await dialog.showOpenDialog({
      filters: [PROJECT_FILTER],
      properties: ["openFile"],
      ...(dir ? { defaultPath: dir } : {}),
    });
    const file = r.filePaths[0];
    return file ? readProject(file) : null;
  });
  handle("project:read", (_e, filePath: string) => readProject(acl.assertProject(filePath)));
  handle("project:initial", () => (initialProject ? readProject(initialProject) : null));
  handle(
    "project:save",
    async (_e, filePath: string | null, text: string, prevPath: string | null, name?: string) => {
      if (filePath !== null) acl.assertProject(filePath);
      let target = filePath;
      if (!target) {
        // 新しいプロジェクト: 名前(ヘッダーで入力したもの)で、アプリの設定の保存先に置く。
        // 保存先を決めていない・同じ名前のファイルがあるときは、その名前で保存先を尋ねる
        const fileName = `${name || "project"}.stepcut.json`;
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
  handle("project:rename", async (_e, from: string, name: string) => {
    acl.assertProject(from);
    if (!isValidProjectName(name)) throw new AppError("invalidName", { name: String(name) });
    const ext = /\.stepcut\.json$/i.test(from) ? ".stepcut.json" : path.extname(from);
    const target = path.join(path.dirname(from), `${name}${ext}`);
    if (target === from) return target;
    if (await exists(target)) throw new AppError("nameExists", { path: target });
    await rename(from, target);
    acl.allowProject(target);
    watcher.watch(target, await readFile(target, "utf8"));
    return target;
  });
  handle("recovery:write", async (_e, projectPath: string | null, name: string | null, text: string) => {
    const p = assertRecoveryPath(projectPath);
    if (typeof text !== "string") return;
    recoveryKeyOf = { projectPath: p };
    await inRecoveryQueue(() =>
      writeRecovery(recoveryDir(), p, typeof name === "string" ? name : null, text),
    );
  });
  handle("recovery:read", (_e, projectPath: string | null) =>
    readRecovery(recoveryDir(), assertRecoveryPath(projectPath)),
  );
  handle("recovery:clear", (_e, projectPath: string | null) =>
    inRecoveryQueue(() => clearRecovery(recoveryDir(), assertRecoveryPath(projectPath))),
  );
  handle("sources:pick", async () => {
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
  handle("image:pick", async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile"],
    });
    const img = r.filePaths[0] ?? null;
    if (img) acl.allowRead(img);
    return img;
  });
  // 書き出したファイルをエクスプローラー(Finder)で選んだ状態で開く
  handle("file:reveal", (_e, absPath: string) => shell.showItemInFolder(acl.assertReveal(absPath)));
  handle("export:pick", async (_e, defaultPath: string) => {
    const r = await dialog.showSaveDialog({ filters: [{ name: "MP4", extensions: ["mp4"] }], defaultPath });
    const out = r.canceled ? null : (r.filePath ?? null);
    if (out) acl.allowExport(out);
    return out;
  });
  handle("sources:resolve", (_e, projectPath: string | null, stored: string) => {
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

  handle("file:size", async (_e, p: string) => (await stat(acl.assertRead(p))).size);
  handle("file:read-range", (_e, p: string, start: number, end: number) =>
    readers.read(acl.assertRead(p), start, end),
  );
  handle("output:open", (e, p: string) => outputs.open(acl.assertWrite(p), e.sender.id));
  handle("output:write", (_e, handle: number, position: number, data: Uint8Array) =>
    outputs.write(handle, position, data),
  );
  handle("output:close", (_e, handle: number, commit: boolean) => outputs.close(handle, commit === true));
  handle("file:write-text", (_e, p: string, text: string) => writeFile(acl.assertWrite(p), text, "utf8"));

  handle("tts:voices", (_e, engine: string) => {
    ttsService ??= tts();
    return ttsService.voices(engine);
  });
  handle("tts:synthesize", (_e, req: TtsRequest) => {
    ttsService ??= tts();
    return ttsService.synthesize(req);
  });
  handle("tts:cache-info", () => {
    ttsService ??= tts();
    return ttsService.cacheInfo();
  });
  handle("tts:cache-clear", () => {
    ttsService ??= tts();
    return ttsService.clearCache();
  });

  handle("export:job", () => exportJob);
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
const cli = parseCli(argv, existsSync);
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
  applyMainLanguage((await loadSettings().catch(() => null))?.language ?? "auto");
  mainWindow = createWindow({ show: true });
  setupUiZoom(mainWindow);
  // メニューバーは出さない(操作は画面のヘッダーにある)。メニューは残し、Ctrl+S などのキーとコピー・貼り付けに使う
  if (process.platform !== "darwin") mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", (e) => {
    if (!mainWindow) return;
    if (busy) {
      const keep = dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        buttons: [mt("cancelExportAndClose"), mt("keepOpen")],
        defaultId: 1,
        cancelId: 1,
        message: mt("exportRunning"),
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
      buttons: [mt("saveAndClose"), mt("discardAndClose"), mt("cancel")],
      defaultId: 2,
      cancelId: 2,
      message: mt("unsavedChanges"),
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
