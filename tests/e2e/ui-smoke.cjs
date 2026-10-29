// GUI の動作確認(開発用)。xvfb-run -a node tests/e2e/ui-smoke.cjs で実行する。
// test-output/ に録画とプロジェクトを作り、開く→再生→ズーム範囲の指定→分割→Undo→保存→外部変更の検知を通す。
const { _electron: electron } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const outDir = path.join(root, "test-output", "ui");
fs.mkdirSync(outDir, { recursive: true });
const rec = path.join(outDir, "rec.mp4");
if (!fs.existsSync(rec)) {
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    rec,
  ]);
}
const projectPath = path.join(outDir, "ui.sanno.json");
fs.writeFileSync(
  projectPath,
  `${JSON.stringify(
    {
      format: "screen-annotator.project",
      version: 1,
      sources: [{ id: "rec1", path: "rec.mp4" }],
      steps: [
        {
          id: "first",
          source: "rec1",
          in: 0,
          out: 4,
          caption: { text: "最初のステップ" },
          speech: { text: "最初のステップです。" },
        },
        { id: "second", source: "rec1", in: 4, out: 8, caption: { text: "Second step" } },
      ],
    },
    null,
    2,
  )}\n`,
);

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const seek = (page, t) =>
  page.locator(".transport input[type=range]").evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
const check = (cond, msg) => {
  if (!cond) throw new Error(`NG: ${msg}`);
  console.log(`ok  ${msg}`);
};

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, "node_modules/electron")),
    args: [root, "--no-sandbox", projectPath],
    cwd: root,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on(
    "console",
    (m) =>
      process.env.DEBUG &&
      console.log(
        "console:",
        m.type(),
        m.text(),
        JSON.stringify(m.location()),
        JSON.stringify(m.args().length),
      ),
  );
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForSelector(".step-item");
  await page.waitForTimeout(1500);
  await shot(page, "01-open");
  check((await page.locator(".step-item").count()) === 2, "プロジェクトを開いてステップが 2 つ表示される");

  // 再生して時刻が進む
  await page.locator(".transport button").click();
  await page.waitForTimeout(1500);
  const t1 = await page.locator(".transport .time").textContent();
  await page.locator(".transport button").click();
  check(!t1.startsWith("0:00.00"), `再生で時刻が進む (${t1})`);

  // ステップ 1 を選んでズームを追加し、プレビュー上で範囲を指定する
  await page.locator(".step-item").first().click();
  await page.getByRole("button", { name: /Add zoom|ズームを追加/ }).click();
  const layer = page.locator(".draw-layer");
  const box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const zoomHint = await page.locator(".zoom .hint").first().textContent();
  check(!zoomHint.includes("960×540"), `ドラッグでズーム範囲が設定される (${zoomHint})`);

  // 分割と Undo
  await page.getByRole("button", { name: /^(Split here|ここで分割)$/ }).click();
  check((await page.locator(".step-item").count()) === 3, "分割でステップが 3 つになる");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check((await page.locator(".step-item").count()) === 2, "Undo で 2 つに戻る");

  // 保存(開いたファイルへ上書き)
  // メニューのショートカットは xvfb 上の Playwright から届かないため、ボタンで保存する
  await page.getByRole("button", { name: /^(Save|保存)$/ }).click();
  await page.waitForTimeout(800);
  const saved = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  check(saved.steps[0].zooms?.length === 1, "保存した JSON にズームが入る");
  check(saved.sources[0].path === "rec.mp4", "素材パスは相対パスのまま");

  // ズームの途中に移動して、拡大表示を撮る
  const z = saved.steps[0].zooms[0];
  await seek(page, (z.start + z.end) / 2);
  await page.waitForTimeout(800);
  await shot(page, "02-zoom");

  // 外部変更(AI による編集を想定)を検知して再読み込みする
  saved.steps[1].caption.text = "外部で変更したテロップ";
  fs.writeFileSync(projectPath, `${JSON.stringify(saved, null, 2)}\n`);
  await page.waitForTimeout(2000);
  const captions = await page.locator(".step-caption").allTextContents();
  check(captions.includes("外部で変更したテロップ"), "外部変更を検知して再読み込みする");
  await shot(page, "03-external");

  // キー操作: Home → → で 1 秒、Shift+→ で 1 フレーム、↓ で次のステップ境界、L 連打で ×2
  const timeText = () => page.locator(".transport .time").textContent();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  check((await timeText()).startsWith("0:01.00"), `→ で 1 秒進む (${await timeText()})`);
  await page.keyboard.press("Shift+ArrowRight");
  check((await timeText()).startsWith("0:01.03"), `Shift+→ で 1 フレーム進む (${await timeText()})`);
  await page.keyboard.press("ArrowDown");
  check((await timeText()).startsWith("0:04.00"), `↓ で次のステップ境界へ (${await timeText()})`);
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  check((await page.locator(".transport select.rate").inputValue()) === "2", "L 2 回で ×2 再生");
  await page.keyboard.press("k");
  await page.locator(".transport select.rate").selectOption("1");

  // プロジェクト設定タブ
  await page.getByRole("button", { name: /^(Project|プロジェクト)$/ }).click();
  await page.waitForTimeout(300);
  await shot(page, "04-project");

  check(errors.length === 0, `コンソールエラーなし ${errors.join(" | ")}`);
  await app.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
