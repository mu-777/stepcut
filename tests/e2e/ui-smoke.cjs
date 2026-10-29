// GUI の動作確認(開発用)。xvfb-run -a node tests/e2e/ui-smoke.cjs で実行する。
// test-output/ に録画とプロジェクトを作り、開く→再生→ズーム範囲の指定→分割→Undo→保存→外部変更の検知、
// タイムライン(トリム・テロップの移動・ズームの作成)・キー操作・右クリックメニュー・カラム幅を通す。
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
const check = (cond, msg) => {
  if (!cond) throw new Error(`NG: ${msg}`);
  console.log(`ok  ${msg}`);
};
const drag = async (page, from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

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
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForSelector(".step-item");
  // 前回の実行で覚えたカラム幅を消す
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".step-item");
  await page.waitForTimeout(2500);
  await shot(page, "01-open");
  check((await page.locator(".step-item").count()) === 2, "プロジェクトを開いてステップが 2 つ表示される");
  check((await page.locator(".tl-clip").count()) === 2, "タイムラインにクリップが 2 つ");
  check((await page.locator(".tl-tile canvas").count()) > 0, "クリップにサムネイルが並ぶ");
  const timeText = () => page.locator(".transport .time").textContent();

  // 再生して時刻が進む
  await page.locator(".transport button.play").click();
  await page.waitForTimeout(1500);
  const t1 = await timeText();
  await page.locator(".transport button.play").click();
  check(!t1.startsWith("0:00.00"), `再生で時刻が進む (${t1})`);

  // 目盛りのクリックでシーク
  const ruler = await page.locator(".tl-ruler").boundingBox();
  const clip1 = await page.locator(".tl-clip").nth(0).boundingBox();
  const clip2 = await page.locator(".tl-clip").nth(1).boundingBox();
  await page.mouse.click(clip2.x + 2, ruler.y + ruler.height / 2);
  await page.waitForTimeout(200);
  check((await timeText()).startsWith("0:04"), `目盛りのクリックでシーク (${await timeText()})`);
  check(Math.abs(clip1.x + clip1.width - clip2.x) < 2, "クリップの切れ目と目盛りの位置が一致する");

  // ステップ 1 を選んでズームを追加し、プレビュー上で範囲を指定する
  await page.locator(".step-item").first().click();
  check(
    (await page.locator(".side-title").textContent()).includes("first"),
    "右カラムに選んだステップの設定",
  );
  await page.getByRole("button", { name: /Add zoom|ズームを追加/ }).click();
  const box = await page.locator(".draw-layer").boundingBox();
  await drag(
    page,
    { x: box.x + box.width * 0.3, y: box.y + box.height * 0.2 },
    { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 },
  );
  await page.waitForTimeout(500);
  const zoomHint = await page.locator(".zoom .hint").first().textContent();
  check(!zoomHint.includes("960×540"), `ドラッグでズーム範囲が設定される (${zoomHint})`);
  await shot(page, "02-zoom");
  check((await page.locator(".tl-bar.zoom").count()) === 1, "ズームがタイムラインに出る");

  // Ctrl+K で分割、Undo で戻す
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(200);
  check((await page.locator(".step-item").count()) === 3, "Ctrl+K で分割してステップが 3 つになる");
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check((await page.locator(".step-item").count()) === 2, "Undo で 2 つに戻る");

  // クリップの右端を左へドラッグして Out を詰める(1 回のドラッグは Undo 1 回分)
  const c1 = await page.locator(".tl-clip").nth(0).boundingBox();
  const pxPerSec = c1.width / 4;
  await drag(
    page,
    { x: c1.x + c1.width - 2, y: c1.y + c1.height / 2 },
    { x: c1.x + c1.width - 2 - pxPerSec, y: c1.y + c1.height / 2 },
  );
  const dur1 = await page.locator(".step-dur").first().textContent();
  check(dur1.startsWith("3.0"), `クリップ端のドラッグで Out が詰まる (${dur1})`);
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check(
    (await page.locator(".step-dur").first().textContent()).startsWith("4.0"),
    "トリムは Undo 1 回で戻る",
  );

  // テロップの左端を右へ 1 秒詰める
  const cap = await page.locator(".tl-bar.caption").first().boundingBox();
  await drag(page, { x: cap.x + 3, y: center(cap).y }, { x: cap.x + 3 + pxPerSec, y: center(cap).y });
  check(
    (await page.locator(".side-title").textContent()).includes("first"),
    "テロップを選ぶと右カラムはそのステップ",
  );

  // ステップ 2 のズームのレーンをドラッグしてズームを作る
  const zoneY = (await page.locator(".tl-lane").nth(3).boundingBox()).y + 12;
  const c2 = await page.locator(".tl-clip").nth(1).boundingBox();
  await drag(page, { x: c2.x + 10, y: zoneY }, { x: c2.x + 10 + pxPerSec * 1.5, y: zoneY });
  check((await page.locator(".tl-bar.zoom").count()) === 2, "ズームのレーンのドラッグでズームを作る");
  // Delete で選んだズームを消す
  await page.keyboard.press("Delete");
  check((await page.locator(".tl-bar.zoom").count()) === 1, "Delete で選んだズームを消す");

  // 保存(開いたファイルへ上書き)
  // メニューのショートカットは xvfb 上の Playwright から届かないため、ボタンで保存する
  await page.getByRole("button", { name: /^(Save|保存)$/ }).click();
  await page.waitForTimeout(800);
  const saved = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  check(saved.steps[0].zooms?.length === 1, "保存した JSON にズームが入る");
  check(
    Math.abs((saved.steps[0].caption.start ?? 0) - 1) < 0.15,
    `テロップの開始が約 1 秒 (${saved.steps[0].caption.start})`,
  );
  check(saved.sources[0].path === "rec.mp4", "素材パスは相対パスのまま");

  // 外部変更(AI による編集を想定)を検知して再読み込みする
  saved.steps[1].caption.text = "外部で変更したテロップ";
  fs.writeFileSync(projectPath, `${JSON.stringify(saved, null, 2)}\n`);
  await page.waitForTimeout(2000);
  const captions = await page.locator(".step-caption").allTextContents();
  check(captions.includes("外部で変更したテロップ"), "外部変更を検知して再読み込みする");
  await shot(page, "03-external");

  // キー操作: Home → → で 1 秒、Shift+→ で 1 フレーム、↓ で次のステップ境界、L 連打で ×2
  await page.locator("body").click({ position: { x: 5, y: 300 } });
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

  // ステップ一覧の右クリックで並び替え
  await page.locator(".step-item").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move down|下へ移動/ }).click();
  const ids = await page.locator(".step-id").allTextContents();
  check(ids[0].includes("second"), `右クリックメニューで下へ移動 (${ids.join(", ")})`);
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();

  // 左カラムの幅をドラッグで変える
  const left0 = (await page.locator("aside.left-pane").boundingBox()).width;
  const sp = await page.locator(".splitter.col").first().boundingBox();
  await drag(page, center(sp), { x: center(sp).x + 80, y: center(sp).y });
  const left1 = (await page.locator("aside.left-pane").boundingBox()).width;
  check(left1 - left0 > 60, `左カラムの幅を変えられる (${left0} → ${left1})`);

  // プレビューの右クリックでズームを作り、枠を動かす(UI-05)
  await page.locator(".step-item").nth(1).click();
  await page.keyboard.press("ArrowRight");
  const stage = await page.locator(".preview-stage").boundingBox();
  const zoomsBefore = await page.locator(".tl-bar.zoom").count();
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.4, { button: "right" });
  await page.getByRole("menuitem", { name: /Add zoom here|ここにズームを追加/ }).click();
  await page.waitForTimeout(400);
  check(
    (await page.locator(".tl-bar.zoom").count()) === zoomsBefore + 1,
    "プレビューの右クリックでズームを作る",
  );
  const ob = await page.locator(".box-outline").boundingBox();
  const hintBefore = await page.locator(".zoom.focused .hint").textContent();
  await drag(page, center(ob), { x: center(ob).x - 40, y: center(ob).y - 20 });
  const hintAfter = await page.locator(".zoom.focused .hint").textContent();
  check(hintBefore !== hintAfter, `ズームの枠をドラッグで移動 (${hintBefore} → ${hintAfter})`);
  await page.getByRole("button", { name: /^(Done|完了)$/ }).click();

  // 枠付きで映像を選び、ドラッグで移動(中心線に吸着)、角で縮小(LAY-08)
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.4);
  await page.waitForTimeout(200);
  const vb = await page.locator(".box-outline").boundingBox();
  check(vb !== null, "プレビューの映像をクリックすると枠とハンドルが出る");
  await drag(page, center(vb), { x: center(vb).x + 3, y: center(vb).y + 60 });
  const vx = await page.getByLabel("X", { exact: true }).inputValue();
  check(vx === "0.5", `映像の移動で中心線に吸着する (x=${vx})`);
  await drag(
    page,
    { x: vb.x + vb.width, y: vb.y + vb.height + 60 },
    { x: vb.x + vb.width - 100, y: vb.y + vb.height },
  );
  await page.waitForTimeout(300);
  await shot(page, "05-video-box");

  // 背景をプリセット「ミント」に変える
  await page.locator(".swatch").nth(2).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^(Save|保存)$/ }).click();
  await page.waitForTimeout(800);
  const saved2 = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  check(saved2.layout?.video?.y > 0.45, `映像を下へ動かした位置が保存される (y=${saved2.layout?.video?.y})`);
  check(saved2.layout.video.width < 0.85, `角のドラッグで縮小する (width=${saved2.layout.video.width})`);
  check(saved2.layout.background?.image === "preset:mint", "背景のプリセットを選べる");
  await page.keyboard.press("Escape");
  await shot(page, "06-mint");

  // プロジェクトの設定
  await page.locator(".nav-item").click();
  await page.waitForTimeout(300);
  check(
    (await page.locator(".side-title").textContent()).includes(await page.locator(".nav-item").textContent()),
    "プロジェクトを選ぶと右カラムはプロジェクトの設定",
  );
  await shot(page, "04-project");

  check(errors.length === 0, `コンソールエラーなし ${errors.join(" | ")}`);
  await app.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
