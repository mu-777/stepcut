// LP(site/)に載せる動画と画像を、StepCut 自身で作る。手順と絵コンテは docs/lp-media.md。
//   Linux:   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/make-lp-media.cjs
//   Windows: node scripts/make-lp-media.cjs
//   使い方の動画だけ、手で直したプロジェクトから書き出し直す: 上のコマンドの最後に --howto-export
// 前提: npm run build 済み、ffmpeg と Playwright がある。
// 環境変数: LP_SPEECH_ENGINE(使い方の動画の読み上げエンジン。azure など)、LP_SPEECH_VOICE(声の ID)
//
// 1. 例の画面(site/media-src/sample-app.html)をブラウザで操作して録画する
// 2. その録画に、テロップ・四角・ズーム・矢印・ポインターを付けたプロジェクト(.stepcut.json)を書く
// 3. StepCut の CLI で mp4 に書き出す(ヒーロー用と、使いみちの 3 例)
// 4. StepCut でそのプロジェクトを開いた画面を撮る
// 5. StepCut を操作するところを録画し、その録画も StepCut で「使い方」の動画にする
// 途中のファイルは test-output/lp-media/、使い方の動画のプロジェクトと録画は test-output/lp-howto/、
// できたものは site/public/media/ に置く。
const { chromium, _electron: electron } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "test-output", "lp-media");
const howtoDir = path.join(root, "test-output", "lp-howto");
const outDir = path.join(root, "site", "public", "media");
const howtoOnly = process.argv.includes("--howto-export");
if (!howtoOnly) fs.rmSync(work, { recursive: true, force: true });
for (const dir of [work, howtoDir, outDir]) fs.mkdirSync(dir, { recursive: true });

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
  await sleep(4500);
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

// ---- 使いみちの 3 例(操作の手順・製品のデモ・資料の解説)。例ごとに違う機能を使う ----

// 例の画面をブラウザーで開いて録画する。run の中の press(名前, セレクター) で、押した時刻と位置を覚える
async function recordScreen(html, out, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: work, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`file://${path.join(root, "site/media-src", html)}`);
  const marks = {};
  const now = () => (Date.now() - t0) / 1000;
  const box = (selector) => page.locator(selector).boundingBox();
  const press = async (name, selector) => {
    const b = await box(selector);
    await page.locator(selector).click();
    marks[name] = { t: now(), box: b };
  };
  await run({ page, marks, now, box, press });
  marks.end = { t: now() };
  const video = page.video();
  await context.close();
  const webm = await video.path();
  await browser.close();
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
    path.join(work, out),
  );
  return marks;
}

const pad = (b, p) => ({
  x: Math.round(b.x - p),
  y: Math.round(b.y - p),
  w: Math.round(b.width + p * 2),
  h: Math.round(b.height + p * 2),
});
// 押す場所へ動いてクリックするポインター。at はクリックの時刻(ステップ内)
const clickAt = (b, at) => {
  const to = center(b);
  return {
    mode: "line",
    path: [
      { t: Math.max(0.1, at - 1), x: to.x + 120, y: to.y + 130 },
      { t: at, x: to.x, y: to.y },
    ],
    click: true,
    enter: "fade",
  };
};

// 例 1 操作の手順: ステップの切り分け・ポインター・四角・早送り(入力している間)
async function makeProcedure() {
  const m = await recordScreen(
    "sample-app.html",
    "use-steps-src.mp4",
    async ({ page, marks, now, press }) => {
      await sleep(2200);
      await press("requests", "#nav-requests");
      await sleep(2200);
      marks.typeStart = { t: now() };
      await page.locator("#subject").pressSequentially("交通費(大阪への出張)", { delay: 260 });
      await page.locator("#amount").pressSequentially("12800", { delay: 260 });
      marks.typeEnd = { t: now() };
      await sleep(1800);
      await press("send", "#send");
      await sleep(2600);
    },
  );
  const lead = 1.5;
  const steps = [
    {
      id: "open",
      source: "rec",
      in: round(m.requests.t - lead),
      out: round(m.requests.t + 1.5),
      caption: { text: "左のメニューから「申請」を開きます" },
      speech: {},
      shapes: [{ type: "rect", start: 0.2, end: lead + 0.2, rect: pad(m.requests.box, -4), enter: "fade" }],
      pointers: [clickAt(m.requests.box, lead - 0.1)],
    },
    {
      id: "type",
      source: "rec",
      in: round(m.typeStart.t - 0.2),
      out: round(m.typeEnd.t + 0.4),
      speed: 3,
      caption: { text: "件名と金額を入力します(早送り)" },
      speech: {},
    },
    {
      id: "send",
      source: "rec",
      in: round(m.send.t - lead),
      out: round(m.send.t + 2),
      caption: { text: "「送信」を押します" },
      speech: {},
      shapes: [{ type: "rect", start: 0.2, end: lead + 0.2, rect: pad(m.send.box, 8), enter: "fade" }],
      pointers: [clickAt(m.send.box, lead - 0.1)],
    },
  ];
  exportVideo(writeProject("use-steps", steps, { source: "use-steps-src.mp4" }), "use-steps", 1.2);
}

// 例 2 製品のデモ: 動くズーム・止めて見せる(保持)・テキスト・画像(ロゴ)・フェード
async function makeDemo() {
  const m = await recordScreen("sample-dashboard.html", "use-demo-src.mp4", async ({ marks, box, press }) => {
    marks.kpis = { box: await box(".kpis") };
    marks.growth = { box: await box("#growth") };
    marks.panel = { box: await box(".panel") };
    await sleep(5500);
    await press("weekly", "#weekly");
    await sleep(3500);
  });
  fs.copyFileSync(path.join(root, "build/icon.png"), path.join(work, "logo.png"));
  // 箱を中心に、録画と同じ縦横比の枠
  const frame = (b, w) => {
    const c = center(b);
    const h = Math.round((w * H) / W);
    return {
      x: Math.min(W - w, Math.max(0, Math.round(c.x - w / 2))),
      y: Math.min(H - h, Math.max(0, Math.round(c.y - h / 2))),
      w,
      h,
    };
  };
  const logo = {
    type: "rect",
    start: 0,
    anchor: "screen",
    rect: { x: 48, y: 36, w: 96, h: 96 },
    image: "logo.png",
    style: { strokeWidth: 0 },
  };
  const first = m.weekly.t - 1.2 - 0.5;
  const g = m.growth.box;
  const steps = [
    {
      id: "overview",
      source: "rec",
      in: 0.5,
      out: round(m.weekly.t - 1.2),
      fadeIn: 0.6,
      caption: { text: "売上の動きを、ひと目で確認できます" },
      speech: {},
      zooms: [
        {
          start: 0.7,
          end: round(first - 0.3),
          hold: false,
          keys: [
            { t: 0.7, rect: frame(m.kpis.box, 860) },
            { t: round(first - 0.5), rect: frame(m.panel.box, 860) },
          ],
        },
      ],
      shapes: [
        logo,
        {
          type: "text",
          start: 0.9,
          end: round(first - 0.3),
          rect: { x: Math.round(g.x - 10), y: Math.round(g.y + g.height + 14), w: 230, h: 44 },
          text: "前の月より増加",
          style: { size: 22 },
          enter: "fade",
          exit: "fade",
        },
      ],
    },
    {
      id: "switch",
      source: "rec",
      in: round(m.weekly.t - 1.2),
      out: round(m.weekly.t + 2.4),
      fadeOut: 0.6,
      caption: { text: "期間を切り替えると、すぐに反映されます" },
      speech: {},
      // 切り替わった後のグラフに寄って、止めて見せる
      zooms: [{ start: 2.2, end: 3.6, keys: [{ t: 2.2, rect: frame(m.panel.box, 900) }] }],
      shapes: [logo],
      pointers: [clickAt(m.weekly.box, 1.1)],
    },
  ];
  exportVideo(writeProject("use-demo", steps, { source: "use-demo-src.mp4" }), "use-demo", 1.5);
}

// 例 3 資料の解説: 画像のステップ・蛍光ペン・矢印
async function makeSlides() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`file://${path.join(root, "site/media-src/sample-slides.html")}`);
  const keys = {};
  for (const n of [1, 2]) {
    const slide = page.locator(`#slide${n}`);
    await slide.screenshot({ path: path.join(work, `slide${n}.png`) });
    const s = await slide.boundingBox();
    const k = await page.locator(`#key${n}`).boundingBox();
    keys[n] = { x: k.x - s.x, y: k.y - s.y, width: k.width, height: k.height };
  }
  await browser.close();
  const k1 = keys[1];
  const k2 = center(keys[2]);
  const steps = [
    {
      id: "slide1",
      source: "s1",
      in: 0,
      out: 4.5,
      fadeIn: 0.5,
      caption: { text: "申請は、ブラウザーから出せるようになります" },
      speech: {},
      pointers: [
        {
          mode: "line",
          path: [
            { t: 0.9, x: Math.round(k1.x), y: Math.round(k1.y + k1.height * 0.55) },
            { t: 2.1, x: Math.round(k1.x + k1.width), y: Math.round(k1.y + k1.height * 0.55) },
          ],
          style: { preset: "highlighter" },
        },
      ],
    },
    {
      id: "slide2",
      source: "s2",
      in: 0,
      out: 4.5,
      fadeOut: 0.5,
      caption: { text: "申請すると、上長に通知が届きます" },
      speech: {},
      shapes: [
        {
          type: "arrow",
          start: 0.8,
          from: { x: k2.x, y: Math.round(keys[2].y + keys[2].height + 150) },
          to: { x: k2.x, y: Math.round(keys[2].y + keys[2].height + 14) },
          enter: "fade",
        },
      ],
    },
  ];
  const sources = [
    { id: "s1", path: "slide1.png" },
    { id: "s2", path: "slide2.png" },
  ];
  exportVideo(writeProject("use-slides", steps, { sources }), "use-slides", 2.4);
}

// LP の地(#1e1f22)になじむ、青の暗いグラデーション
const background = { gradient: { angle: 160, colors: ["#2F4F8F", "#1B2740", "#141A28"] } };

function writeProject(name, steps, { source = "sample-app.mp4", sources, dir = work, speech } = {}) {
  const project = {
    format: "stepcut.project",
    version: 1,
    // 使い方の動画は音声付きで載せるので、字幕(SRT)も書き出す
    output: { width: W, height: H, fps: 30, quality: "high", ...(speech !== undefined ? { srt: true } : {}) },
    layout: { background },
    // Windows では既定のフォント(Yu Gothic UI)。ほかの OS ではそのフォントがないので指定する
    ...(process.platform === "win32" ? {} : { styles: { caption: { font: "Noto Sans JP" } } }),
    ...(speech ? { speech } : {}),
    sources: sources ?? [{ id: "rec", path: source }],
    steps,
  };
  const file = path.join(dir, `${name}.stepcut.json`);
  fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
  return file;
}

// 3. 書き出して、Web 用に詰め直す(1 秒ごとにキーフレーム、先頭にメタデータ)。1 コマを poster にする。
// 音声は、audio を指定した動画だけ残す(Linux では読み上げが無音なので残さない)
function exportVideo(project, name, posterAt, { audio = false } = {}) {
  const raw = path.join(work, `${name}-raw.mp4`);
  const r = cli("export", project, "--out", raw);
  if (!fs.existsSync(raw)) throw new Error(`書き出しに失敗: ${name} ${JSON.stringify(r)}`);
  const sound = audio && !linux ? ["-c:a", "aac", "-b:a", "96k"] : ["-an"];
  const video = ["-c:v", "libx264", "-preset", "slow", "-crf", "27", "-g", "30", "-pix_fmt", "yuv420p"];
  ffmpeg("-i", raw, ...sound, ...video, "-movflags", "+faststart", path.join(outDir, `${name}.mp4`));
  const frame = `select='eq(n\\,${Math.round(posterAt * 30)})'`;
  ffmpeg("-i", raw, "-vf", frame, "-frames:v", "1", "-q:v", "4", path.join(outDir, `${name}.jpg`));
  // 字幕(SRT)があれば、ブラウザーで出せる WebVTT にする
  const srt = raw.replace(/\.mp4$/, ".srt");
  if (fs.existsSync(srt)) ffmpeg("-i", srt, path.join(outDir, `${name}.vtt`));
  const kb = Math.round(fs.statSync(path.join(outDir, `${name}.mp4`)).size / 1024);
  console.log(`${name}.mp4`, `${kb} KB`, ...(r.warnings || []).map((w) => `\n  警告: ${w}`));
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

// 5. StepCut を操作するところを録画する。
// 録画を入れる → 切る → プレビューの上でテロップを書く → ズームの範囲を囲む → 再生して確かめる → 四角を置く → 書き出す
const APP = { width: 1280, height: 760 };
async function recordHowto(sample) {
  const { app, page } = await launchApp("howto", APP, [], true);
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const marks = {};
  const mark = async (name, locator) => {
    marks[name] = { t: now(), box: locator ? await locator.boundingBox() : null };
  };
  // ゆっくりドラッグする(動画で動きが見えるように)
  const slowDrag = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await sleep(300);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 24, from.y + ((to.y - from.y) * i) / 24);
      await sleep(40);
    }
    await sleep(300);
    await page.mouse.up();
  };
  const addBar = (name) => page.locator(".preview-add").getByRole("button", { name });
  const thumb = (i) => page.locator(".rail-thumb").nth(i);
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    },
    path.join(work, "sample-app.mp4"),
  );
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

  // ステップに切る: 1 秒ずつ進めて、区切りで分割(S)。区切りは例の画面で押した時刻の間
  await page.locator(".tl-bar.caption").first().click();
  await page.keyboard.press("Home");
  await sleep(600);
  await mark("split", page.locator(".timeline"));
  const cuts = [Math.round(sample.settings.t + 2), Math.round(sample.mail.t + 2)];
  let at = 0;
  for (const cutAt of cuts) {
    for (; at < cutAt; at++) {
      await page.keyboard.press("ArrowRight");
      await sleep(250);
    }
    await sleep(400);
    await page.keyboard.press("s");
    await sleep(900);
  }
  await sleep(600);

  // テロップを書く: プレビューの上で入力する。右の設定にも同じ文が入る
  await thumb(0).click();
  await sleep(700);
  await addBar(/^テロップ$/).click();
  const input = page.locator(".caption-input");
  await input.waitFor();
  await mark("caption", input);
  await sleep(500);
  await page.keyboard.type("左のメニューから「設定」を開きます", { delay: 120 });
  await sleep(1600);
  await page.keyboard.press("Escape");
  await sleep(800);

  // ズーム: ステップ 2 の少し先で足し、プレビューの上で範囲を囲む
  await thumb(1).click();
  await sleep(500);
  await page.keyboard.press("ArrowRight");
  await sleep(600);
  await mark("zoom", addBar(/^ズーム$/));
  await addBar(/^ズーム$/).click();
  await sleep(1000);
  const layer = await page.locator(".draw-layer").boundingBox();
  // 録画の点(ピクセル)を、プレビュー上の位置に直す。プレビューの枠は出力の画面全体で、
  // 録画はその中の余白(既定は上 4%・下 20%・左右 2.25%)の内側に、縦横比を保って収まっている
  const fit = Math.min((layer.width * 0.955) / W, (layer.height * 0.76) / H);
  const origin = {
    x: layer.x + layer.width * 0.0225 + (layer.width * 0.955 - W * fit) / 2,
    y: layer.y + layer.height * 0.04 + (layer.height * 0.76 - H * fit) / 2,
  };
  const inLayer = (x, y) => ({ x: origin.x + x * fit, y: origin.y + y * fit });
  const row = sample.row.box;
  await slowDrag(inLayer(row.x - 30, row.y - 50), inLayer(row.x + row.width + 30, row.y + row.height + 110));
  await sleep(1300);
  await page.keyboard.press("Escape");
  await sleep(500);

  // 再生して、ズームをプレビューで確かめる
  await thumb(1).click();
  await sleep(700);
  const play = page.locator(".transport button.play");
  await mark("play", play);
  await play.click();
  await sleep(4300);
  await play.click();
  await sleep(700);

  // オブジェクト: ステップ 3 に四角を足し、「保存」の上へ動かす
  await thumb(2).click();
  await sleep(700);
  await mark("object", addBar(/^四角$/));
  await addBar(/^四角$/).click();
  await sleep(900);
  const outline = await page.locator(".object-layer .box-outline").boundingBox();
  const save = center(sample.save.box);
  await slowDrag(center(outline), inLayer(save.x, save.y));
  await sleep(1200);
  await page.keyboard.press("Escape");
  await sleep(600);

  // 書き出す
  const exportButton = page.locator(".tb-btn.primary");
  await mark("export", exportButton);
  await exportButton.click();
  await sleep(1500);
  await page
    .waitForFunction(
      () => /^書き出し$/.test(document.querySelector(".tb-btn.primary")?.textContent ?? ""),
      null,
      {
        timeout: 180000,
      },
    )
    .catch(() => {});
  await sleep(2500);
  await mark("end");
  const video = page.video();
  await closeApp(app);
  const webm = await video.path();
  const mp4 = path.join(howtoDir, "stepcut-app.mp4");
  ffmpeg("-i", webm, "-r", "30", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-an", mp4);
  return marks;
}

// その録画を「使い方」の動画にする。ステップの区切りは、操作した時刻から決める。
// テロップは画面に出す短い文、speech は読み上げる文(書かなければテロップを読む)
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
  const step = (id, from, to, text, rest = {}) => ({
    id,
    source: "rec",
    in: round(from),
    out: round(to),
    caption: { text },
    speech: {},
    ...rest,
  });
  // 見せたい所へ寄る(映像は止めない)。ステップの終わりの少し前まで
  const zoom = (rect, from, to) => [
    { start: 0.4, end: round(to - from - 0.6), hold: false, keys: [{ t: 0.4, rect }] },
  ];
  const exportEnd = m.end.t - 2.3;
  const cut = {
    split: [m.split.t - 0.3, m.caption.t - 1.9],
    caption: [m.caption.t - 1, m.zoom.t - 1.4],
    zoom: [m.zoom.t - 0.6, m.play.t - 0.9],
  };
  return [
    step("add", m.add.t - 1.5, m.add.t + 2.5, "録画を追加します", {
      speech: { text: "まず、録画を追加します。" },
      pointers: [click(m.add.box, 1.4)],
    }),
    step("split", ...cut.split, "説明の区切りで、ステップに分けます", {
      zooms: zoom({ x: 120, y: 250, w: 860, h: 510 }, ...cut.split),
    }),
    step("caption", ...cut.caption, "テロップは、プレビューの上で書けます", {
      speech: {
        text: "テロップは、プレビューの上で書けます。右の設定にも同じ文が入り、読み上げが付きます。",
      },
      zooms: zoom({ x: 330, y: 90, w: 950, h: 564 }, ...cut.caption),
    }),
    step("zoom", ...cut.zoom, "ズームは、見せたい範囲を枠で囲みます", { pointers: [click(m.zoom.box, 0.5)] }),
    step("play", m.play.t - 0.6, m.object.t - 1, "再生して、その場で確かめられます"),
    step("object", m.object.t - 0.6, m.export.t - 0.6, "四角や矢印も、プレビューの上に置けます", {
      pointers: [click(m.object.box, 0.5)],
    }),
    step("export", m.export.t - 1.2, m.export.t + 2, "「書き出し」を押します", {
      speech: { text: "最後に、書き出しを押します。" },
      pointers: [click(m.export.box, 1.1)],
    }),
    step("wait", m.export.t + 2, exportEnd, "書き出しが終わるまで待ちます(早送り)", {
      speed: 8,
      speech: { text: "書き出しが終わるまで、少し待ちます。" },
    }),
    step("done", exportEnd, m.end.t - 0.2, "mp4 ができました", { speech: { text: "mp4 ができました。" } }),
  ];
}

// 使い方の動画を書き出す。プロジェクトは test-output/lp-howto/ にあり、手で直してから --howto-export で書き出し直せる
function exportHowto() {
  const project = path.join(howtoDir, "howto.stepcut.json");
  const check = cli("validate", project);
  if (check.ok === false) throw new Error(`検証エラー: ${JSON.stringify(check)}`);
  exportVideo(project, "howto", 1.5, { audio: true });
  console.log(`使い方の動画のプロジェクト: ${path.relative(root, project)}`);
}

(async () => {
  if (howtoOnly) {
    exportHowto();
    process.exit(0);
  }
  const marks = await record();
  const steps = buildSteps(marks);
  const all = writeProject("notification-settings", steps);
  const check = cli("validate", all);
  if (check.ok === false) throw new Error(`検証エラー: ${JSON.stringify(check)}`);
  exportVideo(all, "hero", 1.2);
  await makeProcedure();
  await makeDemo();
  await makeSlides();
  await screenshotApp(all);
  const howto = await recordHowto(marks);
  // 手で直したプロジェクトが残っていれば、上書きする前に写しを取る
  const project = path.join(howtoDir, "howto.stepcut.json");
  if (fs.existsSync(project))
    fs.copyFileSync(project, path.join(howtoDir, `howto.${Date.now()}.backup.json`));
  const engine = process.env.LP_SPEECH_ENGINE;
  const speech = { engine: engine || "os", voice: process.env.LP_SPEECH_VOICE || null };
  writeProject("howto", buildHowtoSteps(howto), { source: "stepcut-app.mp4", dir: howtoDir, speech });
  exportHowto();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
