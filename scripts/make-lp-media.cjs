// LP(site/)に載せる動画と画像を、StepCut 自身で作る。
//   Linux:   xvfb-run -a node scripts/make-lp-media.cjs
//   Windows: node scripts/make-lp-media.cjs
// 前提: npm run build 済み、ffmpeg と Playwright がある。手順と絵コンテは docs/lp-media.md。
//
// 1. 例の画面(site/media-src/sample-app.html)をブラウザで操作して録画する
// 2. その録画に、テロップ・四角・ズーム・矢印・ポインターを付けたプロジェクト(.stepcut.json)を書く
// 3. StepCut の CLI で mp4 に書き出す(ヒーロー用の全体、ズームだけ、矢印だけ)
// 4. StepCut でそのプロジェクトを開いた画面を撮る
// 5. StepCut を操作するところを録画し、その録画も StepCut で「使い方」の動画にする
// 途中のファイルは test-output/lp-media/、できたものは site/public/media/ に置く。
const { chromium, _electron: electron } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "test-output", "lp-media");
const outDir = path.join(root, "site", "public", "media");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const linux = process.platform === "linux";
const electronBin = require(path.join(root, "node_modules/electron"));
const sandboxArgs = linux ? ["--no-sandbox"] : [];
const W = 1280;
const H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

// StepCut の CLI。結果の JSON はファイルで受ける(標準出力をパイプで受けると終わらないことがある)
function cli(command, project, ...args) {
  const result = path.join(work, `result-${command}-${path.basename(project)}.json`);
  execFileSync(electronBin, [root, ...sandboxArgs, command, project, ...args, "--result", result], {
    cwd: root,
    stdio: "ignore",
  });
  return JSON.parse(fs.readFileSync(result, "utf8"));
}

// 1. 例の画面を操作して録画する。押した時刻と場所を覚えておき、プロジェクトの時刻と座標に使う
async function record() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: work, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`file://${path.join(root, "site/media-src/sample-app.html")}`);
  const marks = {};
  const press = async (name, selector) => {
    const el = page.locator(selector);
    const b = await el.boundingBox();
    await el.click();
    marks[name] = { t: (Date.now() - t0) / 1000, box: b };
  };
  await sleep(2500);
  await press("settings", "#nav-settings");
  await sleep(3000);
  await press("mail", "#mail");
  await sleep(3000);
  marks.row = { box: await page.locator(".row").first().boundingBox() };
  await press("save", "#save");
  await sleep(3000);
  marks.end = { t: (Date.now() - t0) / 1000 };
  const video = page.video();
  await context.close();
  const webm = await video.path();
  await browser.close();
  const mp4 = path.join(work, "sample-app.mp4");
  ffmpeg("-i", webm, "-r", "30", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", mp4);
  return marks;
}

const center = (b) => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
const round = (n) => Math.round(n * 100) / 100;

// 2. プロジェクトを書く。各ステップは「押す 1.5 秒前」から「押した 1.5 秒後」まで
function buildSteps(m) {
  const lead = 1.5;
  const pointerTo = (to, from) => ({
    mode: "line",
    path: [
      { t: 0.3, x: from.x, y: from.y },
      { t: lead - 0.1, x: to.x, y: to.y },
    ],
    click: true,
    enter: "fade",
  });
  const settings = center(m.settings.box);
  const mail = center(m.mail.box);
  const save = center(m.save.box);
  const pad = (b, p) => ({
    x: Math.round(b.x - p),
    y: Math.round(b.y - p),
    w: Math.round(b.width + p * 2),
    h: Math.round(b.height + p * 2),
  });
  // ズームの枠: 「メール通知」の行を中心に、録画と同じ縦横比で
  const zw = 760;
  const zh = Math.round((zw * H) / W);
  const rowC = center(m.row.box);
  const zoomRect = {
    x: Math.round(rowC.x - zw / 2),
    y: Math.max(0, Math.round(rowC.y - zh / 2 + 40)),
    w: zw,
    h: zh,
  };
  return [
    {
      id: "open-settings",
      source: "rec",
      in: round(m.settings.t - lead),
      out: round(m.settings.t + 1.5),
      caption: { text: "左のメニューから「設定」を開きます" },
      speech: {},
      shapes: [{ type: "rect", start: 0.2, end: lead + 0.2, rect: pad(m.settings.box, -4), enter: "fade" }],
      pointers: [pointerTo(settings, { x: 520, y: 420 })],
    },
    {
      id: "turn-on-mail",
      source: "rec",
      in: round(m.mail.t - lead),
      out: round(m.mail.t + 1.8),
      caption: { text: "「メール通知」をオンにします" },
      speech: {},
      zooms: [{ start: 0.3, end: lead + 1.4, hold: false, keys: [{ t: 0.3, rect: zoomRect }] }],
      pointers: [pointerTo(mail, { x: mail.x - 170, y: mail.y + 70 })],
    },
    {
      id: "save",
      source: "rec",
      in: round(m.save.t - lead),
      out: round(m.save.t + 2),
      caption: { text: "最後に「保存」を押します" },
      speech: {},
      shapes: [
        {
          type: "arrow",
          start: 0.2,
          end: lead + 0.3,
          from: { x: save.x - 230, y: save.y },
          to: { x: Math.round(m.save.box.x - 14), y: save.y },
          enter: "fade",
        },
      ],
      pointers: [pointerTo(save, { x: save.x - 60, y: save.y + 110 })],
    },
  ];
}

// LP の地(#1e1f22)になじむ、青の暗いグラデーション
const background = { gradient: { angle: 160, colors: ["#2F4F8F", "#1B2740", "#141A28"] } };

function writeProject(name, steps, source = "sample-app.mp4") {
  const project = {
    format: "stepcut.project",
    version: 1,
    output: { width: W, height: H, fps: 30, quality: "high" },
    layout: { background },
    // Windows では既定のフォント(Yu Gothic UI)。ほかの OS ではそのフォントがないので指定する
    ...(process.platform === "win32" ? {} : { styles: { caption: { font: "Noto Sans JP" } } }),
    sources: [{ id: "rec", path: source }],
    steps,
  };
  const file = path.join(work, `${name}.stepcut.json`);
  fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
  return file;
}

// 3. 書き出して、Web 用に詰め直す(音声なし・先頭にメタデータ)。最初のフレームを poster にする
function exportVideo(project, name, posterAt) {
  const raw = path.join(work, `${name}-raw.mp4`);
  const r = cli("export", project, "--out", raw);
  if (!fs.existsSync(raw)) throw new Error(`書き出しに失敗: ${name} ${JSON.stringify(r)}`);
  ffmpeg(
    "-i",
    raw,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "27",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(outDir, `${name}.mp4`),
  );
  ffmpeg(
    "-i",
    raw,
    "-vf",
    `select='eq(n\\,${Math.round(posterAt * 30)})'`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    path.join(outDir, `${name}.jpg`),
  );
  console.log(
    `${name}.mp4`,
    `${Math.round(fs.statSync(path.join(outDir, `${name}.mp4`)).size / 1024)} KB`,
    (r.warnings || []).length ? `(警告 ${r.warnings.length})` : "",
  );
}

// StepCut を起動する。アプリの設定は作業用のフォルダーに置き、画面の言語は日本語にする
async function launchApp(name, size, args, video) {
  const userData = path.join(work, `user-data-${name}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "ja" }));
  const app = await electron.launch({
    executablePath: electronBin,
    args: [root, ...sandboxArgs, `--user-data-dir=${userData}`, ...args],
    cwd: root,
    ...(video ? { recordVideo: { dir: path.join(work, "app-video"), size } } : {}),
  });
  const page = await app.firstWindow();
  await page.setViewportSize(size);
  return { app, page };
}

// 閉じるときの「保存していない変更」の確認には「破棄して閉じる」で答える(録画を最後まで書き終えるため、止めずに閉じる)
async function closeApp(app) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await app.close();
}

// 4. StepCut で開いた画面を撮る(2 つ目のステップのテロップを選んだ状態)
async function screenshotApp(project) {
  const { app, page } = await launchApp("shot", { width: 1360, height: 800 }, [project]);
  await page.waitForSelector(".rail-thumb");
  await page.waitForTimeout(2500);
  await page.locator(".rail-thumb").nth(1).click();
  await page.waitForTimeout(300);
  await page.locator(".tl-bar.caption").nth(1).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, "app.png") });
  console.log("app.png");
  await closeApp(app);
}

// 5. StepCut を操作するところを録画する(録画を入れる → 切る → テロップを書く → ズームを足す → 書き出す)
const APP = { width: 1280, height: 760 };
async function recordHowto() {
  const { app, page } = await launchApp("howto", APP, [], true);
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const marks = {};
  const mark = async (name, locator) => {
    marks[name] = { t: now(), box: locator ? await locator.boundingBox() : null };
  };
  const source = path.join(work, "sample-app.mp4");
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, source);
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    },
    path.join(work, "howto-inner.mp4"),
  );

  // 録画を入れる
  const add = page.locator(".preview-empty-add");
  await add.waitFor();
  await sleep(2000);
  await mark("add", add);
  await add.click();
  await page.waitForSelector(".rail-thumb");
  await sleep(2500);

  // ステップに切る: 1 秒ずつ進めて、区切りで分割(S)
  await page.locator(".tl-bar.caption").first().click();
  await page.keyboard.press("Home");
  await sleep(600);
  await mark("split", page.locator(".timeline"));
  for (const seconds of [4, 3]) {
    for (let i = 0; i < seconds; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(280);
    }
    await sleep(400);
    await page.keyboard.press("s");
    await sleep(900);
  }
  await sleep(800);

  // テロップを書く
  await page.locator(".rail-thumb").first().click();
  await sleep(500);
  await page.locator(".tl-bar.caption").first().click();
  const box = page.locator(".section.focused textarea").first();
  await box.click();
  await mark("caption", box);
  await page.keyboard.type("左のメニューから「設定」を開きます", { delay: 110 });
  await sleep(1500);
  await box.blur();

  // ズームを足す
  await page.locator(".rail-thumb").nth(1).click();
  await sleep(700);
  await mark("zoom", page.locator(".preview"));
  await page.keyboard.press("z");
  await sleep(2500);
  await page.keyboard.press("Escape");
  await sleep(500);

  // 書き出す
  const exportButton = page.locator(".tb-btn.primary");
  await mark("export", exportButton);
  await exportButton.click();
  await page
    .waitForFunction(
      () => /^(書き出し|Export)$/.test(document.querySelector(".tb-btn.primary")?.textContent ?? ""),
      null,
      { timeout: 120000 },
    )
    .catch(() => {});
  await sleep(2500);
  await mark("end");
  const video = page.video();
  await closeApp(app);
  const webm = await video.path();
  ffmpeg(
    "-i",
    webm,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path.join(work, "stepcut-app.mp4"),
  );
  return marks;
}

// その録画を「使い方」の動画にする。ステップの区切りは、操作した時刻から決める
function buildHowtoSteps(m) {
  const click = (box, t) => {
    const to = center(box);
    return {
      mode: "line",
      path: [
        { t: Math.max(0.1, t - 0.9), x: to.x - 90, y: to.y + 110 },
        { t, x: to.x, y: to.y },
      ],
      click: true,
      enter: "fade",
    };
  };
  const zoom = (rect, end) => [{ start: 0.4, end, hold: false, keys: [{ t: 0.4, rect }] }];
  const step = (id, from, to, text, rest = {}) => ({
    id,
    source: "rec",
    in: round(from),
    out: round(to),
    caption: { text },
    speech: {},
    ...rest,
  });
  const exportEnd = m.end.t - 2.3;
  return [
    step("add", m.add.t - 1.5, m.add.t + 2.5, "録画を追加します", { pointers: [click(m.add.box, 1.4)] }),
    step("split", m.split.t - 0.3, m.caption.t - 1.6, "手順の区切りで、ステップに分けます", {
      zooms: zoom({ x: 120, y: 250, w: 860, h: 510 }, m.caption.t - 1.6 - (m.split.t - 0.3) - 0.6),
    }),
    step("caption", m.caption.t - 0.6, m.zoom.t - 1, "テロップを書きます。同じ文の読み上げが付きます", {
      zooms: zoom({ x: 420, y: 60, w: 860, h: 510 }, m.zoom.t - 1 - (m.caption.t - 0.6) - 0.6),
    }),
    step("zoom", m.zoom.t - 0.4, m.export.t - 0.4, "見せたい場所に、ズームを足します"),
    step("export", m.export.t - 1.2, m.export.t + 2, "「書き出し」を押します", {
      pointers: [click(m.export.box, 1.1)],
    }),
    step("wait", m.export.t + 2, exportEnd, "書き出しが終わるまで待ちます(早送り)", { speed: 4 }),
    step("done", exportEnd, m.end.t - 0.2, "mp4 ができました"),
  ];
}

(async () => {
  const marks = await record();
  const steps = buildSteps(marks);
  const all = writeProject("notification-settings", steps);
  const check = cli("validate", all);
  if (check.ok === false) throw new Error(`検証エラー: ${JSON.stringify(check)}`);
  exportVideo(all, "hero", 1.2);
  exportVideo(writeProject("zoom", [steps[1]]), "zoom", 2.2);
  exportVideo(writeProject("point", [steps[2]]), "point", 1.2);
  await screenshotApp(all);
  const howto = await recordHowto();
  exportVideo(writeProject("howto", buildHowtoSteps(howto), "stepcut-app.mp4"), "howto", 1.5);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
