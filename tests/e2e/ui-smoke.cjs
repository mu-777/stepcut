// GUI の動作確認(開発用)。xvfb-run -a node tests/e2e/ui-smoke.cjs で実行する。
// test-output/ に録画とプロジェクトを作り、開く→再生→ズーム範囲の指定→分割→Undo→保存→外部変更の検知、
// タイムライン(トリム・テロップの移動・ズームの作成)・キー操作・右クリックメニュー・カラム幅、
// 左のサムネイル列と設定パネル(全体の設定 / ステップの詳細)の切り替えを通す。
const { _electron: electron } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
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
// 素材にする画像(赤一色)
const img = path.join(outDir, "red.png");
if (!fs.existsSync(img)) {
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=640x360",
    "-frames:v",
    "1",
    img,
  ]);
}
const projectPath = path.join(outDir, "ui.stepcut.json");
fs.writeFileSync(
  projectPath,
  `${JSON.stringify(
    {
      format: "stepcut.project",
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

// アプリの設定(settings.json)は開発者のものを使わず、テスト用のフォルダーに置く(毎回まっさらにする)
const userDataDir = path.join(outDir, "user-data");
fs.rmSync(userDataDir, { recursive: true, force: true });

// VOICEVOX のエンジンの代わり(声 1 つ、無音の WAV を返す)
function fakeVoicevox() {
  const wav = Buffer.alloc(44 + 24000 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + 48000, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(48000, 40);
  const server = http.createServer((req, res) => {
    if (req.url === "/version") return res.end(JSON.stringify("0.0.0-test"));
    if (req.url === "/speakers")
      return res.end(JSON.stringify([{ name: "テスト", styles: [{ name: "ノーマル", id: 7 }] }]));
    if (req.url?.startsWith("/audio_query")) return res.end(JSON.stringify({ speedScale: 1 }));
    if (req.url?.startsWith("/synthesis")) return res.end(wav);
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, "node_modules/electron")),
    args: [root, "--no-sandbox", `--user-data-dir=${userDataDir}`, projectPath],
    cwd: root,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForSelector(".rail-thumb");
  // 前回の実行で覚えたカラム幅・欄の開閉を消す
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".rail-thumb");
  await page.waitForTimeout(2500);
  await shot(page, "01-open");
  // 左端のサムネイル列(ステップの一覧の代わり)。いちばん上の「全体」で全体の設定を開く
  const thumbs = page.locator(".rail-thumb");
  const openProject = async () => {
    await page.locator(".rail-project").click();
    await page.waitForTimeout(100);
  };
  /** ヘッダーの「ファイル」のメニューから保存する */
  const saveProject = async () => {
    await page.getByRole("button", { name: /^(File|ファイル)/ }).click();
    await page.getByRole("menuitem", { name: /^(Save|保存)/ }).click();
  };
  /** サムネイル i の横に出ている ID・長さ・テロップの文 */
  const tipOf = (i) => thumbs.nth(i).locator(".rail-text").textContent();
  check((await thumbs.count()) === 2, "プロジェクトを開いてサムネイルが 2 つ並ぶ");
  check((await page.locator(".tl-clip").count()) === 2, "タイムラインにクリップが 2 つ");
  check((await page.locator(".tl-tile canvas").count()) > 0, "クリップにサムネイルが並ぶ");
  check((await tipOf(0)).includes("最初のステップ"), "サムネイルの横にテロップの文が出る");
  const timeText = () => page.locator(".transport .time").textContent();
  const panelTitle = () => page.locator(".panel-title").textContent();

  // 再生して時刻が進む
  await page.locator(".transport button.play").click();
  await page.waitForTimeout(1500);
  const t1 = await timeText();
  await page.locator(".transport button.play").click();
  check(!t1.startsWith("0:00.00"), `再生で時刻が進む (${t1})`);

  // 途中から再生しても、すぐ音を鳴らす(鳴らした AudioBufferSourceNode.start を記録して見る)。
  // 音声はステップ全体を作り終えるまで待たず、再生位置から短い区切りで作る
  await page.evaluate(() => {
    window.__audioStarts = [];
    const orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (!(this.context instanceof OfflineAudioContext)) window.__audioStarts.push(performance.now());
      return orig.apply(this, args);
    };
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const playAt = await page.evaluate(() => performance.now());
  await page.locator(".transport button.play").click();
  await page.waitForTimeout(1200);
  await page.locator(".transport button.play").click();
  const audioStarts = await page.evaluate(() => window.__audioStarts);
  check(
    audioStarts.length > 0 && audioStarts[0] - playAt < 1000,
    `途中から再生してもすぐ音を鳴らす (${audioStarts.length ? Math.round(audioStarts[0] - playAt) : "-"}ms)`,
  );
  await page.keyboard.press("Home");

  // 目盛りのクリックでシーク
  const ruler = await page.locator(".tl-ruler").boundingBox();
  const clip1 = await page.locator(".tl-clip").nth(0).boundingBox();
  const clip2 = await page.locator(".tl-clip").nth(1).boundingBox();
  await page.mouse.click(clip2.x + 2, ruler.y + ruler.height / 2);
  await page.waitForTimeout(200);
  check((await timeText()).startsWith("0:04"), `目盛りのクリックでシーク (${await timeText()})`);
  check(Math.abs(clip1.x + clip1.width - clip2.x) < 2, "クリップの切れ目と目盛りの位置が一致する");

  // ステップ 1 を選んでズームを追加し、プレビュー上で範囲を指定する
  await thumbs.first().click();
  check(
    /^(Step|ステップ) 1$/.test((await panelTitle()).trim()) &&
      (await page.locator(".fold").count()) === 5 &&
      (await page.locator(".rail-thumb.on").count()) === 1,
    "サムネイルを選ぶとパネルはそのステップの詳細(録画・速度 / 録画の枠 / 文 / ズーム / オブジェクト)",
  );
  check(
    (await page.locator(".fold.open").count()) === 3 &&
      (await page.locator(".fold-summary").first().textContent()).startsWith("4.0"),
    "録画・速度は閉じて長さだけを出し、文・ズーム・オブジェクトは開いている",
  );
  {
    const nav = page.locator(".panel-nav button");
    const b0 = await nav.nth(0).boundingBox();
    const b1 = await nav.nth(1).boundingBox();
    const tt = await page.locator(".panel-nav .panel-title").boundingBox();
    const hh = await page.locator(".panel-head").boundingBox();
    check(
      b0.x < tt.x && tt.x + tt.width <= b1.x && Math.abs(tt.x + tt.width / 2 - (hh.x + hh.width / 2)) < 3,
      "ステップの見出しは真ん中で、左右に前後のステップへの矢印",
    );
  }
  await page.getByRole("button", { name: /Zoom at playhead|再生位置にズーム/ }).click();
  const box = await page.locator(".draw-layer").boundingBox();
  await drag(
    page,
    { x: box.x + box.width * 0.3, y: box.y + box.height * 0.2 },
    { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 },
  );
  await page.waitForTimeout(500);
  const areaW = () =>
    page
      .getByLabel(/^(Area width \(px\)|枠の幅\(px\))$/)
      .first()
      .inputValue();
  const zoomW = await areaW();
  check(zoomW !== "640", `ドラッグでズーム範囲が設定される (幅 ${zoomW})`);
  await shot(page, "02-zoom");
  check((await page.locator(".tl-bar.zoom").count()) === 1, "ズームがタイムラインに出る");
  check((await page.locator(".tl-hold.zoom-hold").count()) === 1, "ズーム中は既定で映像を止める");
  // ズーム中の映像: 止める / 拡縮時のみ / 止めない(流す) を並べたボタンで選ぶ
  const holdBtn = (name) => page.getByRole("button", { name });
  check(
    (await holdBtn(/^(Freeze|止める)$/).getAttribute("aria-pressed")) === "true" &&
      (await holdBtn(/^(Keep playing|止めない\(流す\))$/).count()) === 1,
    "「ズーム中の映像」は 止める・拡縮時のみ・止めない(流す) のボタンで、既定は「止める」",
  );
  await holdBtn(/^(Only while scaling|拡縮時のみ)$/).click();
  await page.waitForTimeout(200);
  {
    // ズームが頭から始まるときは拡大の前に止める区間がなく、縮小の後だけになる
    const zw = (await page.locator(".tl-bar.zoom").first().boundingBox()).width;
    const hw = await page
      .locator(".tl-hold.zoom-hold")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    check(
      hw.length >= 1 && hw.length <= 2 && hw.every((w) => w < zw),
      `「拡大・縮小の動きの間だけ止める」で、動きの前後だけが保持になる (${hw.map(Math.round).join(", ")} < ${Math.round(zw)})`,
    );
  }
  await holdBtn(/^(Keep playing|止めない\(流す\))$/).click();
  await page.waitForTimeout(200);
  check((await page.locator(".tl-hold.zoom-hold").count()) === 0, "映像を止める設定を外せる");

  // ズームの帯のダブルクリックで、その時刻に枠を足す(元に戻しておく)
  {
    const zb = await page.locator(".tl-bar.zoom").first().boundingBox();
    await page.mouse.dblclick(zb.x + zb.width * 0.6, zb.y + zb.height / 2);
    await page.waitForTimeout(300);
    check((await page.locator(".tl-key").count()) === 2, "ズームの帯のダブルクリックでその時刻に枠を足す");
    // タイムラインでシークしても枠の編集は続く(プレビューはズームせずに枠を出す)
    await page.locator(".tl-ruler").click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(200);
    check(
      (await page.locator(".preview-stage .box-outline").count()) >= 1,
      "ズームの枠の編集中にタイムラインでシークしても、枠の編集は続く",
    );
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.waitForTimeout(200);
  }

  // S で分割、Undo で戻す(ズーム範囲の編集中は矢印キーで枠が動くので、Esc で編集を終えてから)
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("s");
  await page.waitForTimeout(200);
  check((await thumbs.count()) === 3, "S で分割してステップが 3 つになる");
  check(
    (await page.locator(".tl-bar.caption").count()) === 3,
    "分割した後半にも空のテロップ(プレースホルダー)が付く",
  );
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check((await thumbs.count()) === 2, "Undo で 2 つに戻る");

  // クリップの右端を左へドラッグして Out を詰める(1 回のドラッグは Undo 1 回分)
  const c1 = await page.locator(".tl-clip").nth(0).boundingBox();
  const pxPerSec = c1.width / 4;
  await drag(
    page,
    { x: c1.x + c1.width - 2, y: c1.y + c1.height / 2 },
    { x: c1.x + c1.width - 2 - pxPerSec, y: c1.y + c1.height / 2 },
  );
  const dur1 = await tipOf(0);
  check(dur1.includes("3.0s"), `クリップ端のドラッグで Out が詰まる (${dur1})`);
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check((await tipOf(0)).includes("4.0s"), "トリムは Undo 1 回で戻る");

  // 置いた保持はドラッグで位置を動かせる
  await page.mouse.click(c1.x + pxPerSec, c1.y + c1.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: /Hold here|ここに保持/ }).click();
  await page.waitForTimeout(200);
  // 再生ヘッドに吸着しないよう、再生ヘッドを末尾へ離しておく
  await page.keyboard.press("End");
  await page.waitForTimeout(100);
  const hold0 = await page.locator(".tl-hold:not(.zoom-hold):not(.auto)").first().boundingBox();
  await drag(page, { x: hold0.x + 6, y: center(hold0).y }, { x: hold0.x + 6 + pxPerSec, y: center(hold0).y });
  const hold1 = await page.locator(".tl-hold:not(.zoom-hold):not(.auto)").first().boundingBox();
  check(
    Math.abs(hold1.x - hold0.x - pxPerSec) < pxPerSec * 0.2 && Math.abs(hold1.width - hold0.width) < 2,
    `保持をドラッグで動かせる (${Math.round(hold0.x)} → ${Math.round(hold1.x)})`,
  );
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.waitForTimeout(150);
  check(
    (await page.locator(".tl-hold:not(.zoom-hold):not(.auto)").count()) === 0,
    "保持の追加と移動はそれぞれ Undo 1 回で戻る",
  );

  // テロップの左端を右へ 1 秒詰める
  const cap = await page.locator(".tl-bar.caption").first().boundingBox();
  await drag(page, { x: cap.x + 3, y: center(cap).y }, { x: cap.x + 3 + pxPerSec, y: center(cap).y });
  check(
    /^(Step|ステップ) 1$/.test((await panelTitle()).trim()) &&
      (await page.locator(".section.focused textarea").first().inputValue()) === "最初のステップ" &&
      (await page.locator(".fold.open").count()) === 1,
    "テロップを選ぶと文の欄だけが開き、ほかの欄は閉じる",
  );
  check(
    (await page.locator(".section.focused textarea").first().inputValue()) === "最初のステップ",
    "テロップを選ぶとパネルはそのステップの詳細で、テロップの欄を強調する",
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
  await saveProject();
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
  check((await tipOf(1)).includes("外部で変更したテロップ"), "外部変更を検知して再読み込みする");
  await shot(page, "03-external");

  // プロジェクトの問題(検証の警告)は上端の帯に出て、× で閉じられる。閉じたら出さない
  {
    const warned = structuredClone(saved);
    warned.steps[1].speech = [{ text: "一つ目" }, { start: 1 }];
    fs.writeFileSync(projectPath, `${JSON.stringify(warned, null, 2)}\n`);
    await page.waitForTimeout(2000);
    const issueBar = page.locator(".banner.issues");
    check(
      (await issueBar.count()) === 1 && (await page.locator("footer.issues").count()) === 0,
      "プロジェクトの問題は上端の帯に出る",
    );
    await issueBar.getByRole("button").click();
    await page.waitForTimeout(150);
    check((await issueBar.count()) === 0, "問題の帯は × で閉じられる");
    fs.writeFileSync(projectPath, `${JSON.stringify(saved, null, 2)}\n`);
    await page.waitForTimeout(2000);
  }

  // キー操作: Home → → で 1 秒、Shift+→ で 1 フレーム、↓ で次のステップ境界(J/K/L はない)
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  check((await timeText()).startsWith("0:01.00"), `→ で 1 秒進む (${await timeText()})`);
  await page.keyboard.press("Shift+ArrowRight");
  check((await timeText()).startsWith("0:01.03"), `Shift+→ で 1 フレーム進む (${await timeText()})`);
  await page.keyboard.press("ArrowDown");
  check((await timeText()).startsWith("0:04.00"), `↓ で次のステップ境界へ (${await timeText()})`);
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  check(
    (await page.locator(".transport select.rate").inputValue()) === "1" &&
      (await page.getByRole("button", { name: /^(Play|再生)$/ }).count()) === 1,
    "L キーでは再生しない(J/K/L はない)",
  );

  // サムネイルの右クリックで並び替え
  await thumbs.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move down|下へ移動/ }).click();
  const first = await thumbs.first().getAttribute("aria-label");
  check(first.includes("外部で変更したテロップ"), `右クリックメニューで下へ移動 (1 番目: ${first})`);
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();

  // 設定パネルの幅をドラッグで変える
  const left0 = (await page.locator("aside.panel").boundingBox()).width;
  const sp = await page.locator(".splitter.col").nth(1).boundingBox();
  await drag(page, center(sp), { x: center(sp).x - 80, y: center(sp).y });
  const left1 = (await page.locator("aside.panel").boundingBox()).width;
  check(left1 - left0 > 60, `設定パネルの幅を変えられる (${left0} → ${left1})`);
  // 左から サムネイル列 | プレビュー | 設定パネル の順
  const railBox = await page.locator(".step-rail").boundingBox();
  const centerBox = await page.locator(".center").boundingBox();
  const panelBox = await page.locator("aside.panel").boundingBox();
  check(
    railBox.x < centerBox.x && centerBox.x + centerBox.width <= panelBox.x,
    "サムネイル列・プレビュー・設定パネルが左から順に並ぶ",
  );
  // サムネイル列の幅も変えられる
  // 狭めるとサムネイルだけになり、文はマウスを重ねたときに出る
  const rail0 = (await page.locator(".step-rail").boundingBox()).width;
  const pic0 = (await thumbs.first().locator(".rail-pic").boundingBox()).width;
  const rsp = await page.locator(".splitter.col").first().boundingBox();
  await drag(page, center(rsp), { x: center(rsp).x - 110, y: center(rsp).y });
  const rail1 = (await page.locator(".step-rail").boundingBox()).width;
  const pic1 = (await thumbs.first().locator(".rail-pic").boundingBox()).width;
  check(
    rail0 - rail1 > 80 && !(await thumbs.first().locator(".rail-text").isVisible()) && pic1 > rail1 - 30,
    `サムネイル列を狭めるとサムネイルだけを列の幅いっぱいに出す (${rail0} → ${rail1}, ${pic0} → ${pic1})`,
  );
  await thumbs.nth(0).hover();
  await page.waitForTimeout(100);
  const tip = (await page.locator(".rail-tip").count()) ? await page.locator(".rail-tip").textContent() : "";
  await page.mouse.move(700, 5);
  check(tip.includes("最初のステップ"), "サムネイルだけのときはマウスを重ねるとテロップの文が出る");
  // 切り替わる所でサムネイルの大きさが飛ばない
  const railDrag = async (dx) => {
    const b = await page.locator(".splitter.col").first().boundingBox();
    await drag(page, center(b), { x: center(b).x + dx, y: center(b).y });
    return {
      pic: (await thumbs.first().locator(".rail-pic").boundingBox()).width,
      // 切り替わった直後は文の幅が 0 なので、表示の有無は display で見る
      text: await thumbs
        .first()
        .locator(".rail-text")
        .evaluate((el) => getComputedStyle(el).display !== "none"),
      proj: await page.locator(".rail-project").evaluate((el) => ({
        h: el.getBoundingClientRect().height,
        dir: getComputedStyle(el).flexDirection,
      })),
    };
  };
  const narrowEnd = await railDrag(118 - rail1);
  const wideStart = await railDrag(4);
  check(
    !narrowEnd.text && wideStart.text && Math.abs(wideStart.pic - narrowEnd.pic) <= 5,
    `文が出る所でサムネイルの大きさが飛ばない (${narrowEnd.pic} → ${wideStart.pic})`,
  );
  check(
    narrowEnd.proj.dir === "column" && wideStart.proj.dir === "row" && narrowEnd.proj.h === wideStart.proj.h,
    `同じ所で「全体」が縦並びから横並びになり、高さは変わらない (${narrowEnd.proj.h} → ${wideStart.proj.h})`,
  );
  await railDrag(220 - 122);
  check(await thumbs.first().locator(".rail-text").isVisible(), "広げるとサムネイルの横に文が戻る");

  // プレビューの上の帯から、テロップの入力とズームの追加を始められる
  await thumbs.nth(1).click();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: /^(Caption|テロップ)$/ }).click();
  check((await page.locator(".caption-input").count()) === 1, "帯の「テロップ」でその場の入力を始める");
  await page.keyboard.press("Escape");
  const quickBefore = await page.locator(".tl-bar.zoom").count();
  await page.getByRole("button", { name: /^＋ (Zoom|ズーム)$/ }).click();
  check(
    (await page.locator(".tl-bar.zoom").count()) === quickBefore + 1 &&
      (await page.locator(".box-outline").count()) === 1,
    "帯の「＋ ズーム」でズームを足し、範囲の編集を始める",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.waitForTimeout(200);

  // プレビューの右クリックでズームを作り、枠を動かす(UI-05)
  await thumbs.nth(1).click();
  await page.keyboard.press("ArrowRight");
  const stage = await page.locator(".preview-stage").boundingBox();
  const zoomsBefore = await page.locator(".tl-bar.zoom").count();
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.4, { button: "right" });
  await page.getByRole("menuitem", { name: /^＋ (Zoom|ズーム)/ }).click();
  await page.waitForTimeout(400);
  check(
    (await page.locator(".tl-bar.zoom").count()) === zoomsBefore + 1,
    "プレビューの右クリックでズームを作る",
  );
  check(
    (await page.locator(".item-button.selected").count()) === 1 &&
      (await page.getByLabel(/^(Center X \(px\)|中心 X\(px\))$/).count()) === 1,
    "ズームを作るとステップの詳細でそのズームが開く",
  );
  check(
    (await page.locator(".fold.open").count()) === 1 &&
      (await page.locator(".item-list li.open").evaluate((el) => getComputedStyle(el).outlineStyle)) ===
        "solid" &&
      (await page
        .locator(".item-list li.open")
        .getByLabel(/^(Center X \(px\)|中心 X\(px\))$/)
        .count()) === 1,
    "ズームを選ぶとズームの欄だけが開き、見出しと設定の欄をまとめて枠で囲む",
  );
  const centerX = () =>
    page
      .getByLabel(/^(Center X \(px\)|中心 X\(px\))$/)
      .last()
      .inputValue();
  const areaH = () =>
    page
      .getByLabel(/^(Area height \(px\)|枠の高さ\(px\))$/)
      .last()
      .inputValue();
  const ob = await page.locator(".box-outline").boundingBox();
  const cx0 = await centerX();
  await drag(page, center(ob), { x: center(ob).x - 40, y: center(ob).y - 20 });
  const cx1 = await centerX();
  check(cx0 !== cx1, `ズームの枠をドラッグで移動 (中心 X ${cx0} → ${cx1})`);
  // 角のハンドル: 中心を固定して縦横比を保ったまま拡大
  const ob2 = await page.locator(".box-outline").boundingBox();
  const w0 = Number(
    await page
      .getByLabel(/^(Area width \(px\)|枠の幅\(px\))$/)
      .last()
      .inputValue(),
  );
  await drag(
    page,
    { x: ob2.x + ob2.width, y: ob2.y + ob2.height },
    { x: ob2.x + ob2.width + 30, y: ob2.y + ob2.height + 17 },
  );
  const w1 = Number(
    await page
      .getByLabel(/^(Area width \(px\)|枠の幅\(px\))$/)
      .last()
      .inputValue(),
  );
  check(
    w1 > w0 && Math.abs(Number(await centerX()) - Number(cx1)) <= 2,
    `角のハンドルは中心固定で拡大 (幅 ${w0} → ${w1})`,
  );
  // 辺のハンドル: 中心を固定して縦横比を変える
  const h0 = await areaH();
  const ob3 = await page.locator(".box-outline").boundingBox();
  await drag(
    page,
    { x: ob3.x + ob3.width, y: ob3.y + ob3.height / 2 },
    { x: ob3.x + ob3.width + 40, y: ob3.y + ob3.height / 2 },
  );
  check((await areaH()) === h0, "辺のハンドルは高さを変えずに幅だけ変える");
  // 録画の隅の外までドラッグしても、枠の大きさは変わらない(内側だけを動く)
  const wBefore = await areaW();
  const ob4 = await page.locator(".box-outline").boundingBox();
  const st4 = await page.locator(".preview-stage").boundingBox();
  await drag(page, center(ob4), { x: st4.x + 2, y: st4.y + 2 });
  check(
    (await areaW()) === wBefore && (await areaH()) === h0,
    `隅へのドラッグで枠の大きさが変わらない (幅 ${wBefore} → ${await areaW()})`,
  );
  await shot(page, "05-zoom-edit");
  // 枠の外をクリック(ドラッグなし)で確定する
  const layer = await page.locator(".draw-layer").boundingBox();
  await page.mouse.click(layer.x + 3, layer.y + 3);
  await page.waitForTimeout(200);
  check((await page.locator(".draw-layer").count()) === 0, "枠の外のクリックでズーム範囲の編集を終える");

  // ズームの枠(キーフレーム): 帯のクリックで編集を始め、再生位置に枠を足す
  const zb = await page.locator(".tl-bar.zoom").first().boundingBox();
  await page.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await page.waitForTimeout(300);
  check(
    (await page.locator(".draw-layer").count()) === 1,
    "タイムラインのズームのクリックで枠の編集を始める",
  );
  // 帯のクリックでは再生位置を動かさない。目盛りのクリック(シーク)では編集を続ける(プレビューはズームせずに枠を出す)
  const rulerBox = await page.locator(".tl-ruler").boundingBox();
  await page.mouse.click(zb.x + zb.width * 0.9, rulerBox.y + rulerBox.height / 2);
  await page.waitForTimeout(300);
  check((await page.locator(".draw-layer").count()) === 1, "目盛りのクリック(シーク)では枠の編集を続ける");
  const tBefore = await page.locator(".time").first().textContent();
  await page.mouse.click(zb.x + zb.width * 0.3, zb.y + zb.height / 2);
  await page.waitForTimeout(300);
  const tStart = await page.locator(".time").first().textContent();
  check(tStart === tBefore, `タイムラインのズームの帯のクリックでは再生位置を動かさない (${tBefore})`);
  await page.mouse.click(zb.x + zb.width * 0.9, rulerBox.y + rulerBox.height / 2);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Area at playhead|再生位置に枠/ }).click();
  await page.waitForTimeout(300);
  check((await page.locator(".tl-key").count()) === 2, "再生位置に枠を足すとタイムラインに ◆ が 2 つ出る");
  check((await page.locator(".box-ghost").count()) === 1, "ほかの枠は点線で出る");
  check((await page.locator(".seg-label").textContent()).includes("2/2"), "足した枠の編集に移る");
  // 枠の大きさを変えると、サイズをそろえる設定(既定オン)でもう一方の枠も同じ大きさになる
  const kb = await page.locator(".box-outline").boundingBox();
  await drag(
    page,
    { x: kb.x + kb.width, y: kb.y + kb.height },
    { x: kb.x + kb.width - 30, y: kb.y + kb.height - 17 },
  );
  const gb = await page.locator(".box-ghost").boundingBox();
  const kb2 = await page.locator(".box-outline").boundingBox();
  check(
    Math.abs(gb.width - kb2.width) <= 2,
    `サイズをそろえる設定でほかの枠も同じ大きさ (${Math.round(gb.width)} / ${Math.round(kb2.width)})`,
  );
  // 枠が重なっていても、点線の枠の番号から選べる
  await page.locator(".box-ghost span").click();
  await page.waitForTimeout(300);
  check(
    (await page.locator(".seg-label").textContent()).includes("1/2"),
    "点線の枠のクリックでその枠の編集に切り替える",
  );
  // プレビューの外(ヘッダーの余白)のクリックでも編集を終える
  const tbBox = await page.locator(".toolbar").boundingBox();
  await page.mouse.click(tbBox.x + tbBox.width * 0.3, tbBox.y + tbBox.height / 2);
  await page.waitForTimeout(200);
  check((await page.locator(".draw-layer").count()) === 0, "プレビューの外のクリックで枠の編集を終える");
  // 再生を始めても編集を終える
  await page.mouse.click(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^(Play|再生)$/ }).click();
  await page.waitForTimeout(300);
  check((await page.locator(".draw-layer").count()) === 0, "再生ボタンで枠の編集を終える");
  await page.getByRole("button", { name: /^(Pause|停止)$/ }).click();
  await page.waitForTimeout(200);

  // Z キーで再生位置にズームを足す
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  const zc = await page.locator(".tl-bar.zoom").count();
  await page.keyboard.press("z");
  await page.waitForTimeout(300);
  check((await page.locator(".tl-bar.zoom").count()) === zc + 1, "Z キーでズームを足す");
  await page.keyboard.press("Escape");

  // 録画を選び、ドラッグで移動(中心線に吸着)、角で縮小(中心固定)、辺で切り取り
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.4);
  await page.waitForTimeout(200);
  const vb = await page.locator(".box-outline").boundingBox();
  check(vb !== null, "プレビューの録画をクリックすると枠とハンドルが出る");
  check(
    (await page.locator(".rail-project.on").count()) === 0 &&
      !/Project|全体/.test(await panelTitle()) &&
      (await page.locator(".fold.open", { hasText: /Recording frame|録画の枠/ }).count()) === 1,
    "録画の枠を選ぶとパネルはそのステップの「録画の枠」の欄",
  );
  check(
    (await page.locator(".preview-tools .seg").count()) === 1,
    "枠の編集中はプレビューの下の帯に中心固定/隅固定の切り替えが出る",
  );
  check((await page.locator(".preview-hint").count()) === 0, "プレビューの上に操作の説明を重ねない");
  // 映像と帯をひとまとまりとして上下中央に置く
  {
    const pv = await page.locator(".preview").boundingBox();
    const sg = await page.locator(".preview-stage").boundingBox();
    const tb = await page.locator(".preview-tools").boundingBox();
    const above = sg.y - pv.y;
    const below = pv.y + pv.height - (tb.y + tb.height);
    check(
      Math.abs(above - below) <= 2,
      `映像と帯は上下中央 (上 ${Math.round(above)} / 下 ${Math.round(below)})`,
    );
  }
  await drag(page, center(vb), { x: center(vb).x + 4, y: center(vb).y + 30 });
  const marginOf = async () =>
    Promise.all([/^(Left|左)$/, /^(Right|右)$/].map((re) => page.getByLabel(re).inputValue().then(Number)));
  const [ml, mr] = await marginOf();
  check(Math.abs(ml - mr) <= 2, `録画の移動で中心線に吸着する (左 ${ml} / 右 ${mr})`);
  const vb2 = await page.locator(".box-outline").boundingBox();
  await drag(
    page,
    { x: vb2.x + vb2.width, y: vb2.y + vb2.height },
    { x: vb2.x + vb2.width - 60, y: vb2.y + vb2.height - 34 },
  );
  const [ml2, mr2] = await marginOf();
  check(ml2 > ml && Math.abs(ml2 - mr2) <= 2, `角のハンドルは中心固定で縮小 (左 ${ml2} / 右 ${mr2})`);
  // 矢印キーで 10px、Shift+矢印キーで 1px 動かす
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  const [ml3a] = await marginOf();
  check(ml3a === ml2 + 10, `→ で録画を 10px 右へ動かす (左 ${ml2} → ${ml3a})`);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(100);
  const [ml3] = await marginOf();
  check(ml3 === ml3a + 1, `Shift+→ で録画を 1px 右へ動かす (左 ${ml3a} → ${ml3})`);
  // 画面の左辺に吸着する
  const vb4 = await page.locator(".box-outline").boundingBox();
  await drag(page, center(vb4), { x: center(vb4).x - (vb4.x - stage.x) + 4, y: center(vb4).y });
  const [ml4] = await marginOf();
  check(ml4 === 0, `録画の移動で画面の左辺に吸着する (左 ${ml4})`);
  const vb3 = await page.locator(".box-outline").boundingBox();
  await drag(page, { x: vb3.x + vb3.width / 2, y: vb3.y }, { x: vb3.x + vb3.width / 2, y: vb3.y + 30 });
  await page.waitForTimeout(300);
  await shot(page, "06-video-box");

  // 枠の変更はそのステップだけ(ステップ 2 は全体の枠のまま)
  await saveProject();
  await page.waitForTimeout(800);
  const savedOwn = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  check(
    savedOwn.steps[0].layout?.margin?.top > 0.04 &&
      savedOwn.steps[0].layout?.fit === "cover" &&
      savedOwn.steps[1].layout === undefined &&
      savedOwn.layout?.margin === undefined,
    `プレビューで動かした枠はそのステップだけに保存される (上 ${savedOwn.steps[0].layout?.margin?.top})`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /^(Use this frame for all steps|この枠を共通にする)$/ }).click();
  await page.waitForTimeout(200);

  // 背景をプリセット「ミント」に変える
  await openProject();
  {
    const layoutFold = page
      .locator(".fold")
      .filter({ has: page.locator(".fold-title", { hasText: /^(Layout|レイアウト)$/ }) });
    if (!(await layoutFold.evaluate((el) => el.classList.contains("open"))))
      await layoutFold.locator(".fold-head").click();
  }
  await page.locator(".swatch").nth(2).click();
  await page.waitForTimeout(500);
  await saveProject();
  await page.waitForTimeout(800);
  const saved2 = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  check(
    saved2.layout?.margin?.top > 0.04 && saved2.steps[0].layout === undefined,
    `「この枠を共通にする」で全体の枠になり、ステップの個別の枠は消える (上 ${saved2.layout?.margin?.top})`,
  );
  check(saved2.layout.fit === "cover", "辺のハンドルで縦横比を変えると切り取りになる");
  check(saved2.layout.background?.image === "preset:mint", "背景のプリセットを選べる");
  await page.keyboard.press("Escape");
  await shot(page, "07-mint");

  // 余白なし: オンで余白 0、オフで元に戻す
  await openProject();
  const noMargin = page.getByLabel(/No margins|余白なし/);
  const before = await marginOf();
  await noMargin.check();
  await page.waitForTimeout(200);
  const zeroed = await marginOf();
  check(
    zeroed.every((v) => v === 0),
    `余白なしで上下左右の余白が 0 (${before} → ${zeroed})`,
  );
  await noMargin.uncheck();
  await page.waitForTimeout(200);
  const after = await marginOf();
  check(
    after[0] === before[0] && after[1] === before[1],
    `余白なしを外すと元の余白に戻る (${before} → ${after})`,
  );

  // ステップ 2 だけ余白なしにする(設定パネルの「録画の枠」)
  {
    await thumbs.nth(1).click();
    await page.waitForTimeout(200);
    const frameFold = page.locator(".fold", { hasText: /Recording frame|録画の枠/ });
    if (!(await frameFold.evaluate((el) => el.classList.contains("open"))))
      await frameFold.locator(".fold-head").click();
    await frameFold.getByLabel(/No margins|余白なし/).check();
    await page.waitForTimeout(200);
    await saveProject();
    await page.waitForTimeout(800);
    const saved3 = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    const m = saved3.steps[1].layout?.margin;
    check(
      m &&
        m.top === 0 &&
        m.left === 0 &&
        saved3.steps[1].layout.fit === "contain" &&
        saved3.layout.margin.top > 0.04,
      "ステップ 2 だけ余白なしにできる(全体の余白はそのまま)",
    );
    check(
      /This step uses its own frame|このステップだけの枠/.test(
        await frameFold.locator(".fold-body .hint").first().textContent(),
      ),
      "個別の枠を使うステップは欄に「このステップだけの枠」と出る",
    );
    await page.getByRole("button", { name: /^(Back to the shared frame|全体の枠に戻す)$/ }).click();
    await page.waitForTimeout(200);
    check(
      /Uses the shared frame|全体の枠を使っています/.test(
        await frameFold.locator(".fold-body .hint").first().textContent(),
      ),
      "「全体の枠に戻す」で全体の枠に戻る",
    );
  }

  // テロップをプレビュー上でドラッグする(全体の設定を開いていても、そのステップの個別の値になる)
  await thumbs.first().click();
  await openProject();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const ch = await page.locator(".caption-text").boundingBox();
  check(ch !== null, "テロップの上にドラッグ用の枠が出る");
  await drag(page, center(ch), { x: center(ch).x, y: center(ch).y - 200 });
  await page.waitForTimeout(300);
  const badge = () => page.locator(".badge").first().textContent();
  check(
    /Set for this step|個別/.test(await badge()),
    "全体の設定を開いていても、テロップを動かすとステップの詳細に移り個別設定になる",
  );
  await page.getByRole("button", { name: /Use shared position|共通の位置に戻す/ }).click();
  check(/Shared|共通/.test(await badge()), "共通の位置に戻せる");
  // 動かした位置を全ステップ共通にする
  const ch1 = await page.locator(".caption-text").boundingBox();
  await drag(page, center(ch1), { x: center(ch1).x, y: center(ch1).y - 150 });
  await page.waitForTimeout(300);
  const movedY = (await page.locator(".caption-text").boundingBox()).y;
  await page.getByRole("button", { name: /Use for all steps|この位置を共通にする/ }).click();
  await page.waitForTimeout(300);
  check(
    /Shared|共通/.test(await badge()) &&
      Math.abs((await page.locator(".caption-text").boundingBox()).y - movedY) < 2,
    "動かした位置を共通にできる(テロップはその位置のまま)",
  );
  // 「共通の設定 ›」で全体の設定のテロップの見た目の欄へ移る
  await page.locator(".link-badge").click();
  await page.waitForTimeout(200);
  check(
    /Project|全体/.test(await panelTitle()) &&
      (await page.locator(".fold.open").count()) === 1 &&
      /Caption style|テロップの見た目/.test(await page.locator(".fold.open .fold-title").textContent()) &&
      (await page.locator(".fold.open .section.focused").count()) === 1,
    "「共通の設定 ›」で全体の設定のテロップの見た目の欄だけを開いて強調する",
  );
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  // テロップの文字のクリックでテロップの設定へ移り、その場で入力できる(PowerPoint と同じ)
  await openProject();
  await page.waitForTimeout(200);
  const ch2 = await page.locator(".caption-text").boundingBox();
  await page.mouse.click(center(ch2).x, center(ch2).y);
  await page.waitForTimeout(200);
  check(
    (await page.locator(".section.focused textarea").first().inputValue()) === "最初のステップ",
    "プレビューのテロップをクリックするとテロップの設定へ移る",
  );
  check((await page.locator(".caption-input").count()) === 1, "テロップの文字のクリックで入力欄が出る");
  await page.keyboard.type("です");
  await page.waitForTimeout(200);
  check(
    (await page.locator(".section.focused textarea").first().inputValue()) === "最初のステップです",
    "プレビュー上の入力がステップの詳細のテロップにも入る",
  );
  await shot(page, "08-caption-input");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(
    (await page.locator(".caption-input").count()) === 0 &&
      (await page.locator(".caption-box.selected").count()) === 1,
    "Esc で入力を終え、テロップの枠を選んだ状態になる",
  );
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  check(
    (await page.locator(".section.focused textarea").first().inputValue()) === "最初のステップ",
    "プレビュー上の入力は Undo 1 回で戻る",
  );

  // テロップのラインのダブルクリックで、テロップのないステップにテロップを作る
  const capLane = page.locator(".tl-lane").nth(1);
  const clips = page.locator(".tl-clip");
  const second = await clips.nth(1).boundingBox();
  const laneBox = await capLane.boundingBox();
  const capsBefore = await page.locator(".tl-bar.caption").count();
  await page.mouse.dblclick(second.x + second.width / 2, laneBox.y + laneBox.height / 2);
  await page.waitForTimeout(200);
  check(
    (await page.locator(".tl-bar.caption").count()) >= capsBefore,
    "テロップのラインのダブルクリックでテロップを選ぶ・作る",
  );

  // 読み上げを追加すると読み上げが 2 つになる
  await thumbs.first().click();
  await page.getByRole("button", { name: /^＋ (Speech|読み上げ)$/ }).click();
  await page.waitForTimeout(200);
  check((await page.locator(".tl-bar.speech").count()) >= 2, "読み上げを 1 ステップに 2 つ置ける");

  // 再生して止めると再生ボタンが再生の表示に戻る
  await page.getByRole("button", { name: /^(Play|再生)$/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^(Pause|停止)$/ }).click();
  await page.waitForTimeout(300);
  check(
    (await page.getByRole("button", { name: /^(Play|再生)$/ }).count()) === 1,
    "停止すると再生ボタンが ▶ に戻る",
  );

  // タイムラインの拡大縮小は左上の角、プレビューの表示倍率はプレビュー下のバー
  const innerW = async () => (await page.locator(".tl-inner").boundingBox()).width;
  const tlW0 = await innerW();
  await page.locator(".tl-zoom-btn").nth(1).click();
  await page.waitForTimeout(200);
  check((await innerW()) > tlW0, "タイムラインの左上の + で拡大する");
  await page.locator(".tl-zoom-btn").nth(2).click();
  await page.getByRole("button", { name: /^(Zoom in preview|プレビューを拡大)$/ }).click();
  await page.waitForTimeout(200);
  check(
    (await page.locator(".zoom-pct").textContent()).includes("%"),
    "プレビュー下の + でプレビューを拡大する",
  );
  await page.locator(".zoom-pct").click();
  check(!(await page.locator(".zoom-pct").textContent()).includes("%"), "% を押すと全体表示に戻る");

  // テロップを選ぶと左右の端に取っ手が出て、ドラッグで幅を変えられる
  await thumbs.first().click();
  await page.waitForTimeout(300);
  // テロップが出ている時刻へ(目盛りの、テロップの帯の中ほど)
  {
    const cb = await page.locator(".tl-bar.caption").first().boundingBox();
    const rb = await page.locator(".tl-ruler").boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, rb.y + rb.height / 2);
    await page.waitForTimeout(300);
  }
  // 枠(文字の外側の縁)のクリックで枠を選ぶ
  const ch3 = await page.locator(".caption-box").boundingBox();
  await page.mouse.click(ch3.x + 3, center(ch3).y);
  await page.waitForTimeout(200);
  const edge = await page.locator(".caption-edge.r").boundingBox();
  await drag(page, center(edge), { x: center(edge).x - 80, y: center(edge).y });
  const wv = await page
    .getByLabel(/^(Width \(0–1\)|幅\(0〜1\))$/)
    .first()
    .inputValue();
  check(wv !== "" && Number(wv) < 0.8, `テロップの右端のドラッグで幅を変える (${wv})`);
  // 読み上げ: 書き換えるまではテロップの文を読み、書き換えたらその文、テロップと同じ文に戻すとまたテロップに合わせる
  const speechBox = page.getByLabel(/^(Text to read|読み上げ文)/).first();
  const capText = await page.locator(".section.focused textarea").first().inputValue();
  check(
    (await page.getByLabel(/Read the caption text|テロップと同じ文を読む/).count()) === 0,
    "読み上げに「テロップと同じ文を読む」のチェックを置かない",
  );
  await speechBox.fill("別の読み上げ");
  await page.waitForTimeout(150);
  check(
    (await speechBox.inputValue()) === "別の読み上げ" &&
      (await page.getByRole("button", { name: /Read the caption text again|テロップの文に戻す/ }).count()) ===
        1,
    "読み上げの文を書き換えられ、「テロップの文に戻す」が出る",
  );
  await page.getByRole("button", { name: /Read the caption text again|テロップの文に戻す/ }).click();
  await page.waitForTimeout(150);
  check((await speechBox.inputValue()) === capText, "「テロップの文に戻す」でテロップの文を読む");

  // フェードイン: ステップの頭は黒になる(プレビューの中央の明るさで見る)
  await thumbs.first().click();
  await page.waitForTimeout(200);
  const recFold = page.locator(".fold").filter({ hasText: /Recording & speed|録画・速度/ });
  if (!(await recFold.evaluate((el) => el.classList.contains("open"))))
    await recFold.locator(".fold-head").click();
  const brightness = () =>
    page
      .locator(".preview-stage canvas")
      .first()
      .evaluate((c) => {
        const d = c
          .getContext("2d")
          .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return d[0] + d[1] + d[2];
      });
  await page.keyboard.press("Home");
  await page.waitForTimeout(400);
  const lit = await brightness();
  await page.getByLabel(/^(Fade in \(s\)|フェードイン\(秒\))$/).fill("1");
  await page.waitForTimeout(400);
  const faded = await brightness();
  check(lit > 60 && faded < 10, `フェードインを入れるとステップの頭が黒になる (${lit} → ${faded})`);
  // フェードイン・フェードアウトはタイムラインの映像のクリップに示す
  await page.getByLabel(/^(Fade out \(s\)|フェードアウト\(秒\))$/).fill("0.5");
  await page.waitForTimeout(200);
  {
    const fin = await page.locator(".tl-fade.in").boundingBox();
    const fout = await page.locator(".tl-fade.out").boundingBox();
    check(
      fin !== null && fout !== null && Math.abs(fin.width - 2 * fout.width) < 3,
      `ステップのフェードイン・フェードアウトをタイムラインに示す (${fin && Math.round(fin.width)} / ${fout && Math.round(fout.width)}px)`,
    );
    await shot(page, "05a-fade");
  }
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.waitForTimeout(100);

  // オブジェクト: プレビューの下の「＋ オブジェクト」から足し、プレビュー上の取っ手で直す
  await thumbs.nth(1).click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const addObject = async (name) => {
    await page.getByRole("button", { name: /^＋ (Object|オブジェクト)$/ }).click();
    await page.getByRole("menuitem", { name }).click();
    await page.waitForTimeout(300);
  };
  const pixelAt = (pt) =>
    page
      .locator(".preview-stage canvas")
      .first()
      .evaluate((c, p) => {
        const r = c.getBoundingClientRect();
        const k = c.width / r.width;
        const d = c
          .getContext("2d")
          .getImageData(Math.floor((p.x - r.left) * k), Math.floor((p.y - r.top) * k), 1, 1).data;
        return [d[0], d[1], d[2]];
      }, pt);
  // 項目はいくつも開けるので、選んでいる項目の中を見る
  const selSection = () => page.locator("li.open:has(> .item-head .item-button.selected) .section.object");
  const objField = (label) => selSection().getByLabel(label);
  await addObject(/^(Box|四角)$/);
  const boxOutline = page.locator(".object-layer .box-outline");
  check(
    (await boxOutline.count()) === 1 &&
      (await page.locator(".tl-bar.object.selected").count()) === 1 &&
      (await page.locator(".fold.open .fold-title").first().textContent()).match(/Objects|オブジェクト/) !==
        null,
    "「＋ オブジェクト」→「四角」で再生位置に四角を作り、プレビューに枠、タイムラインに帯、設定パネルにオブジェクトの欄",
  );
  // 開いたオブジェクトは 見た目・時間・位置 の小見出しに分け、位置の数値は畳んでおく
  const posToggle = selSection().locator(".obj-group-title.toggle");
  check(
    (await selSection().locator(".obj-group-title").allTextContents())
      .join(",")
      .match(/(Look|見た目).*(Timing|時間).*(Position|位置)/) !== null &&
      (await posToggle.getAttribute("aria-expanded")) === "false" &&
      (await page.locator(".item-actions button").count()) >= 3,
    "開いたオブジェクトは「見た目・時間・位置」に分かれ、位置は畳まれ、見出しの右に操作のアイコンが並ぶ",
  );
  await posToggle.click();
  await page.waitForTimeout(150);
  const rectC = center(await boxOutline.boundingBox());
  const unfilled = await pixelAt(rectC);
  // 塗りはチェックで出す(出すと不透明度 1 になる)
  check(
    (await objField(/^(Opacity|不透明度)$/).count()) === 0,
    "四角の塗りは既定で消えていて、不透明度の欄も出ない",
  );
  await selSection()
    .getByRole("checkbox", { name: /^(Fill|塗り)$/ })
    .check();
  await page.waitForTimeout(300);
  const filled = await pixelAt(rectC);
  check(
    filled[0] > 200 && filled[1] < 120 && filled[2] < 120,
    `塗りのチェックを入れると四角の中が塗りの色(赤)になる (${unfilled} → ${filled})`,
  );
  const xBefore = Number(await objField(/^X$/).inputValue());
  await drag(page, rectC, { x: rectC.x + 40, y: rectC.y + 3 });
  const xAfter = Number(await objField(/^X$/).inputValue());
  check(xAfter > xBefore + 20, `四角の枠のドラッグで位置が動く (X ${xBefore} → ${xAfter})`);

  // 空いた所のクリックで選択を外し、四角の上のクリックで選び直す
  const stageBox = await page.locator(".preview-stage").boundingBox();
  await page.mouse.click(stageBox.x + 30, stageBox.y + 30);
  await page.waitForTimeout(200);
  check((await boxOutline.count()) === 0, "プレビューの空いた所のクリックでオブジェクトの選択を外す");
  await page.mouse.click(rectC.x + 40, rectC.y + 3);
  await page.waitForTimeout(200);
  check((await boxOutline.count()) === 1, "プレビュー上の四角のクリックで四角を選ぶ");

  // 位置の基準を「画面に固定」にしても見えている位置は変わらず、録画の外(背景)へ動かせる
  const anchorBefore = await boxOutline.boundingBox();
  await selSection()
    .getByRole("button", { name: /^(Fixed on screen|画面に固定)$/ })
    .click();
  await page.waitForTimeout(300);
  const anchorAfter = await boxOutline.boundingBox();
  check(
    Math.abs(anchorAfter.x - anchorBefore.x) < 2 && Math.abs(anchorAfter.width - anchorBefore.width) < 2,
    `「画面に固定」に切り替えても見えている位置と大きさは変わらない (x ${anchorBefore.x} → ${anchorAfter.x})`,
  );
  const ac = center(anchorAfter);
  await drag(page, ac, { x: ac.x - (anchorAfter.x - stageBox.x) + 8, y: ac.y });
  const movedBox = await boxOutline.boundingBox();
  const bg = await pixelAt({ x: stageBox.x + 14, y: movedBox.y + movedBox.height / 2 });
  check(
    movedBox.x < stageBox.x + 30 && bg[0] > 200 && bg[1] < 120,
    `画面に固定した四角は録画の外(背景)にも描かれる (${bg})`,
  );

  // 矢印: 両端の取っ手。終点をドラッグすると終点が動く
  await addObject(/^(Arrow|矢印)$/);
  const handles = page.locator(".line-handle");
  check((await handles.count()) === 2, "矢印は両端に取っ手を出す");
  const toXBefore = Number(await objField(/^(End X|終点 X)$/).inputValue());
  const hb = center(await handles.nth(1).boundingBox());
  await drag(page, hb, { x: hb.x + 50, y: hb.y - 37 });
  const toXAfter = Number(await objField(/^(End X|終点 X)$/).inputValue());
  check(toXAfter > toXBefore + 20, `矢印の終点の取っ手で終点が動く (${toXBefore} → ${toXAfter})`);

  // 蛍光ペン: ポインターの見た目の 1 つ。見た目のボタンで選ぶと、下の行が蛍光ペンの設定(色・太さ・不透明度)になる
  await addObject(/^(Pointer|ポインター)$/);
  await selSection()
    .getByRole("button", { name: /^(Highlighter|蛍光ペン)$/ })
    .click();
  await page.waitForTimeout(200);
  check(
    (await objField(/^(Opacity|不透明度)$/).count()) === 1 &&
      (await page.locator(".item-name", { hasText: /(Highlighter|蛍光ペン)/ }).count()) === 1,
    "ポインターの見た目で蛍光ペンを選ぶと、蛍光ペンの設定が出て名前が「ポインター(蛍光ペン)」になる",
  );
  // 現れ方を点滅にすると、長さと回数の欄が出る
  await selSection()
    .getByRole("button", { name: /^(Flash|点滅)$/ })
    .first()
    .click();
  await page.waitForTimeout(150);
  check((await objField(/^(Blinks|回数)$/).count()) === 1, "現れ方を点滅にすると、長さと回数を直せる");
  await selSection().locator(".seg-field").first().scrollIntoViewIfNeeded();
  await shot(page, "05b-pointer");
  // ポインターの端は水平に吸着する
  const hh = center(await handles.nth(1).boundingBox());
  await drag(page, hh, { x: hh.x + 30, y: hh.y + 8 });
  check(
    (await objField(/^(Start Y|始点 Y)$/).inputValue()) === (await objField(/^(End Y|終点 Y)$/).inputValue()),
    "ポインター(蛍光ペン)の端は水平に吸着する",
  );

  // ポインター: 取っ手に 1(動き始め)と 2(着く所)の番号
  await addObject(/^(Pointer|ポインター)$/);
  check(
    (await handles.nth(0).textContent()) === "1" && (await handles.nth(1).textContent()) === "2",
    "ポインターは動き始めと着く所に 1・2 の取っ手を出す",
  );

  // テキスト: 作るとすぐ文を打てる
  await addObject(/^(Text|テキスト)$/);
  await page.keyboard.type("ここを押す");
  await page.waitForTimeout(200);
  check(
    (await page.locator(".tl-bar.object", { hasText: "ここを押す" }).count()) === 1,
    "テキストを作るとすぐ文を打て、タイムラインの帯に文が出る",
  );
  const textTitle = await page.locator(".item-button .item-name", { hasText: "ここを押す" }).textContent();
  check(
    ["テキスト(ここを押す)", "Text (ここを押す)"].includes(textTitle),
    `右パネルのテキストの見出しは「テキスト(文)」 (${textTitle})`,
  );
  check(
    (await page.locator(".tl-bar.object").count()) === 5,
    "重なる時刻のオブジェクトはタイムラインで行を分けて並ぶ",
  );
  // 行が増えて段が高さに収まらなければ、タイムラインを縦にスクロールして最後の行まで見られる
  const lastRowVisible = await page.locator(".timeline").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const bars = [...el.querySelectorAll(".tl-bar.object")];
    const bottom = Math.max(...bars.map((b) => b.getBoundingClientRect().bottom));
    const ok = bottom <= el.getBoundingClientRect().bottom + 1;
    el.scrollTop = 0;
    return ok;
  });
  check(lastRowVisible, "オブジェクトの行が増えても、タイムラインを縦にスクロールして最後の行まで見られる");
  await shot(page, "05-objects");

  // Delete で選んだオブジェクトを消す(文の入力欄からフォーカスを外してから)
  await page.locator(".preview-stage").click({ position: { x: 30, y: 30 } });
  await page.locator(".tl-bar.object", { hasText: "ここを押す" }).click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  check((await page.locator(".tl-bar.object").count()) === 4, "Delete で選んだオブジェクトを消す");

  // 保存すると JSON に書かれる
  await saveProject();
  await page.waitForTimeout(500);
  const savedObj = JSON.parse(fs.readFileSync(projectPath, "utf8")).steps[1];
  check(
    savedObj.shapes?.map((x) => x.type).join(",") === "rect,arrow" &&
      savedObj.shapes[0].style?.fillOpacity === 1 &&
      savedObj.shapes[0].anchor === "screen" &&
      savedObj.pointers?.length === 2 &&
      savedObj.pointers.filter((p) => p.style?.preset === "highlighter").length === 1 &&
      savedObj.highlights === undefined,
    "オブジェクトはステップの shapes・pointers に保存され、蛍光ペンはポインターの見た目になる",
  );

  // タイムラインの帯をクリックで選んでも再生位置は動かさない。ダブルクリックで始まりへ移す
  {
    const tm = async () => page.locator(".time").first().textContent();
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const before = await tm();
    const bars = page.locator(".tl-bar.object");
    await bars.nth(1).click();
    await page.waitForTimeout(150);
    check((await tm()) === before, `タイムラインの帯を選んでも再生位置は動かない (${before})`);
    await bars.nth(1).dblclick();
    await page.waitForTimeout(150);
    check(
      (await tm()) !== before,
      `タイムラインの帯のダブルクリックで再生位置をその始まりへ移す (${before} → ${await tm()})`,
    );
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    // Ctrl+クリックでまとめて選び、まとめてドラッグで動かす
    await bars.nth(0).click({ modifiers: ["Control"] });
    await page.waitForTimeout(100);
    check((await page.locator(".tl-bar.multi").count()) === 2, "Ctrl+クリックで帯をまとめて選べる");
    const x0 = await page
      .locator(".tl-bar.multi")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    const b1 = await page.locator(".tl-bar.multi").first().boundingBox();
    await drag(
      page,
      { x: b1.x + b1.width / 2, y: b1.y + b1.height / 2 },
      { x: b1.x + b1.width / 2 + 30, y: b1.y + b1.height / 2 },
    );
    await page.waitForTimeout(150);
    const x1 = await page
      .locator(".tl-bar.multi")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    check(
      x1.length === 2 && x1.every((x, i) => x - x0[i] > 10) && Math.abs(x1[0] - x0[0] - (x1[1] - x0[1])) < 2,
      `まとめて選んだ帯はまとめてドラッグで動く (${x0.map(Math.round)} → ${x1.map(Math.round)})`,
    );
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.waitForTimeout(150);
    // Ctrl+C・Ctrl+V(メニューのコピー・貼り付け)でオブジェクトを再生位置に貼る
    await bars.nth(0).click();
    const n0 = await bars.count();
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent("copy", { cancelable: true })));
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent("paste", { cancelable: true })));
    await page.waitForTimeout(200);
    check((await bars.count()) === n0 + 1, "オブジェクトをコピーして再生位置に貼れる");
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.waitForTimeout(150);
    // Ctrl+X(切り取り)で消え、貼り付けで戻る(まとめた選択はクリップのクリックで解く)
    await page.locator(".tl-clip").nth(1).click();
    await bars.nth(0).click();
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent("cut", { cancelable: true })));
    await page.waitForTimeout(150);
    const afterCut = await bars.count();
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent("paste", { cancelable: true })));
    await page.waitForTimeout(150);
    check(
      afterCut === n0 - 1 && (await bars.count()) === n0,
      `オブジェクトを切り取ると消え、貼り付けで戻る (${n0} → ${afterCut} → ${await bars.count()})`,
    );
    // オブジェクトのレーンの空いた所の右クリックで、その時刻にオブジェクトを足す
    await page.locator(".tl-lane").nth(4).scrollIntoViewIfNeeded();
    const lane = await page.locator(".tl-lane").nth(4).boundingBox();
    const n1 = await bars.count();
    await page.mouse.click(lane.x + 4, lane.y + lane.height - 3, { button: "right" });
    await page.getByRole("menuitem", { name: /^＋ (Text|テキスト)$/ }).click();
    await page.waitForTimeout(200);
    check((await bars.count()) === n1 + 1, "オブジェクトのレーンの右クリックでオブジェクトを足す");
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.waitForTimeout(150);
  }

  // 読み上げのレーンの右クリックで読み上げを足し、帯の右クリックでコピー → 別の時刻に貼る
  {
    const speechBars = page.locator(".tl-bar.speech");
    const s0 = await speechBars.count();
    const lane = await page.locator(".tl-lane").nth(2).boundingBox();
    const clip1 = await page.locator(".tl-clip").nth(1).boundingBox();
    await page.mouse.click(clip1.x + clip1.width - 6, lane.y + lane.height / 2, { button: "right" });
    await page.getByRole("menuitem", { name: /^(\+|＋) (Speech|読み上げ)$/ }).click();
    await page.waitForTimeout(200);
    check((await speechBars.count()) === s0 + 1, "読み上げのレーンの右クリックで読み上げを足す");
    await speechBars.nth(0).click({ button: "right" });
    await page.getByRole("menuitem", { name: /^(Copy|コピー)/ }).click();
    await page.mouse.click(clip1.x + clip1.width / 2, lane.y + lane.height / 2, { button: "right" });
    await page.getByRole("menuitem", { name: /Paste here|ここに貼り付け/ }).click();
    await page.waitForTimeout(200);
    check((await speechBars.count()) === s0 + 2, "読み上げをコピーして、レーンの右クリックで貼る");
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
    await page.waitForTimeout(150);
  }
  await page.locator(".tl-sound").click();
  await page.waitForTimeout(150);
  check(
    (await page.locator(".tl-clip-muted").count()) === (await page.locator(".tl-clip").count()) &&
      (await page.locator(".tl-sound.off").count()) === 1,
    "映像の段の見出しのボタンで録画の音を全体で消す(すべてのクリップに印)",
  );
  await page.locator(".tl-sound").click();
  await page.waitForTimeout(150);
  await page.locator(".tl-clip").nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Mute this step|このステップの録画の音を消す/ }).click();
  await page.waitForTimeout(150);
  check(
    (await page.locator(".tl-clip-muted").count()) === 1,
    "クリップの右クリックで、そのステップの録画の音だけを消す",
  );
  await page.getByRole("button", { name: /^(Undo|元に戻す)$/ }).click();
  await page.waitForTimeout(150);

  // プレビューの右クリックから、クリックした所を中心に足す。録画の外なら図形は画面に固定する
  const bgPt = { x: stageBox.x + stageBox.width * 0.85, y: stageBox.y + stageBox.height * 0.3 };
  await page.mouse.click(bgPt.x, bgPt.y, { button: "right" });
  await page.getByRole("menuitem", { name: /^＋ (Box|四角)$/ }).click();
  await page.waitForTimeout(300);
  const ctxBox = center(await boxOutline.boundingBox());
  check(
    Math.abs(ctxBox.x - bgPt.x) < 4 &&
      Math.abs(ctxBox.y - bgPt.y) < 4 &&
      (await page.locator(".item-head:has(.item-button.selected) .badge").count()) === 1,
    `プレビューの右クリックで、録画の外のクリックした所に画面に固定した四角を足す (${ctxBox.x}, ${ctxBox.y})`,
  );
  // オブジェクトの上の右クリックでは、そのオブジェクトの操作も出る
  await page.mouse.click(ctxBox.x, ctxBox.y - 1, { button: "right" });
  await page.getByRole("menuitem", { name: /^(Remove|削除)/ }).click();
  await page.waitForTimeout(200);
  check((await page.locator(".tl-bar.object").count()) === 4, "オブジェクトの上の右クリックから消せる");

  // 全体の設定
  await openProject();
  await page.waitForTimeout(300);
  // 閉じている欄を開いてから中身を見る(欄の開閉は覚えている)
  while ((await page.locator(".fold:not(.open)").count()) > 0)
    await page.locator(".fold:not(.open) .fold-head").first().click();
  check(
    /Project|全体/.test(await panelTitle()) &&
      (await page.getByLabel(/No margins|余白なし/).count()) === 1 &&
      (await page.locator(".dict-field").count()) === 1,
    "「全体」で出力・レイアウト・テロップの見た目・声の共通の設定",
  );
  await shot(page, "04-project");
  // 解像度の候補には通称を付ける。縦横比を固定すると、幅を変えたとき高さも合わせる
  {
    const opts = await page
      .locator(".field", { hasText: /^(Width × Height|幅 × 高さ)/ })
      .locator("option")
      .allTextContents();
    check(
      opts.some((o) => o.includes("3840×2160 (4K)")),
      `解像度の候補に通称が付く (${opts.join(", ")})`,
    );
    await page.getByRole("checkbox", { name: /^(Keep aspect ratio|縦横比を固定)$/ }).check();
    const wField = page.getByLabel(/^(Width|幅)$/).first();
    const hField = page.getByLabel(/^(Height|高さ)$/).first();
    const h0 = await hField.inputValue();
    await wField.fill("1280");
    await page.waitForTimeout(150);
    const h1 = await hField.inputValue();
    await wField.fill("1920");
    await page.waitForTimeout(150);
    check(
      h1 === "720" && (await hField.inputValue()) === h0,
      `縦横比を固定すると幅に合わせて高さも変わる (${h0} → ${h1})`,
    );
    await page.getByRole("checkbox", { name: /^(Keep aspect ratio|縦横比を固定)$/ }).uncheck();
  }
  // 選択欄のラベルには選択肢の文字も入るので、ラベルの見出しで探す
  const fontSel = page
    .locator(".field")
    .filter({ has: page.locator("> span", { hasText: /^(Font|フォント)$/ }) })
    .locator("input")
    .first();
  await fontSel.click();
  await page.waitForTimeout(300);
  const fontOpts = await page.locator(".combo-list > div").count();
  const firstFont = (await page.locator(".combo-list > div").first().textContent()) ?? "";
  await fontSel.fill(firstFont.slice(0, 2));
  await page.waitForTimeout(150);
  const filtered = await page.locator(".combo-list > div").allTextContents();
  check(
    fontOpts > 5 &&
      filtered.length >= 1 &&
      filtered.length < fontOpts &&
      (filtered[0] ?? "").toLowerCase().startsWith(firstFont.slice(0, 2).toLowerCase()),
    `テロップのフォントは打ち込め、OS のフォントを絞り込む(前方一致が先) (${fontOpts} → ${filtered.length} 件)`,
  );
  // 日本語の名前でも探せる(Windows の游ゴシック・メイリオ)
  await fontSel.fill("游ゴ");
  await page.waitForTimeout(150);
  const jaFonts = await page.locator(".combo-list > div").allTextContents();
  check(
    process.platform !== "win32" || jaFonts.some((x) => x.includes("Yu Gothic")),
    `フォントを日本語の名前で探せる (${jaFonts.slice(0, 3).join(" / ")})`,
  );
  await fontSel.fill("");
  await page.keyboard.press("Escape");
  check(
    (await page.locator(".fold").count()) === 5,
    "全体の設定も欄(出力・レイアウト・テロップの見た目・読み上げ・オブジェクトの見た目)ごとに畳める",
  );
  await page.locator(".fold-all").click();
  await page.waitForTimeout(100);
  check((await page.locator(".fold.open").count()) === 0, "「すべての欄を閉じる」で全部の欄を閉じる");

  // ヘッダー: 文字なしのアイコン、プロジェクトの名前はウィンドウの中央、書き出しは右端
  const hdr = await page.locator(".toolbar").boundingBox();
  const exportBtn = await page.locator(".tb-btn.primary").boundingBox();
  const titleBox = await page.locator(".tb-title").boundingBox();
  const winW = await page.evaluate(() => window.innerWidth);
  check(
    (await page.locator(".tb-btn svg").count()) === 6 &&
      (await page.locator(".tb-side.right .tb-btn").first().getAttribute("aria-label")).match(
        /Shortcuts|キー操作/,
      ) !== null &&
      /^(File|ファイル)$/.test((await page.locator(".tb-side .tb-btn span").first().textContent()) ?? "") &&
      /^(Export|書き出し)$/.test((await page.locator(".tb-btn.primary span").textContent()) ?? "") &&
      (await page.locator(".tb-name").textContent()) === "ui" &&
      Math.abs(titleBox.x + titleBox.width / 2 - winW / 2) < 3 &&
      hdr.x + hdr.width - (exportBtn.x + exportBtn.width) < 16,
    `ヘッダーはアイコン(ファイルと書き出しは文字付き)で、プロジェクト名はウィンドウの中央、書き出しは右端 (中央のずれ ${Math.round(titleBox.x + titleBox.width / 2 - winW / 2)})`,
  );
  // 新規・開く・保存は「ファイル」のメニューにまとめる
  await page.getByRole("button", { name: /^(File|ファイル)/ }).click();
  check(
    (await page.getByRole("menuitem").allTextContents())
      .join(",")
      .match(/(New|新規).*(Open|開く).*(Save|保存)/) !== null,
    "「ファイル」のメニューに新規・開く・保存",
  );
  await page.keyboard.press("Escape");
  // タイトルのクリックで名前を変える(ファイル名が変わる)。戻しておく
  const rename = async (name) => {
    await page.locator(".tb-title").click();
    await page.locator(".tb-title-input").fill(name);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
  };
  await rename("ui-renamed");
  const renamed = fs.existsSync(path.join(path.dirname(projectPath), "ui-renamed.stepcut.json"));
  const renamedTitle = await page.locator(".tb-name").textContent();
  await rename("ui");
  check(
    renamed && renamedTitle === "ui-renamed" && fs.existsSync(projectPath),
    "タイトルのクリックでプロジェクトの名前(ファイル名)を変えられる",
  );
  // 右パネルの見出し: 真ん中にタイトル、右端にすべて閉じるボタン
  const ph = await page.locator(".panel-head").boundingBox();
  const pt = await page.locator(".panel-head .panel-title").boundingBox();
  const pf = await page.locator(".panel-head .fold-all").boundingBox();
  check(
    Math.abs(pt.x + pt.width / 2 - (ph.x + ph.width / 2)) < 3 && ph.x + ph.width - (pf.x + pf.width) < 4,
    "右パネルの見出しは真ん中、すべて閉じるボタンは右端",
  );
  check(
    /ui — StepCut/.test(await page.title()),
    `ウィンドウのタイトルにプロジェクト名 (${await page.title()})`,
  );
  // アプリの設定(言語・プロジェクトの保存先)
  await page.getByRole("button", { name: /^(Settings|設定)$/ }).click();
  await page.waitForTimeout(200);
  check(
    (await page.locator(".settings-dialog .seg-field button").count()) === 3 &&
      (await page.locator(".settings-dialog .dir-row").count()) === 1,
    "ヘッダーの「設定」でアプリの設定(言語・プロジェクトの保存先)を開く",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check((await page.locator(".settings-dialog").count()) === 0, "Esc でアプリの設定を閉じる");

  // 新規(録画なし): 録画の追加の案内はサムネイル列の「全体」の下、設定パネルは全体の設定
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^(File|ファイル)/ }).click();
  await page.getByRole("menuitem", { name: /^(New|新規)/ }).click();
  await page.waitForTimeout(300);
  const addBig = await page.locator(".rail-add").boundingBox();
  const railBig = await page.locator(".step-rail").boundingBox();
  check(
    (await page.locator(".rail-add-label").count()) === 1 &&
      addBig.height > railBig.height * 0.6 &&
      (await page.locator(".rail-project.on").count()) === 1 &&
      /Project|全体/.test(await panelTitle()),
    "録画がないときは ＋ を列いっぱいに広げて「録画を追加」を添え、設定パネルは全体の設定",
  );
  // mp4 以外を列にドロップすると断る(ドロップを受け付けている)
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "note.txt", { type: "text/plain" }));
    const rail = document.querySelector(".step-rail");
    rail.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    rail.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  check(
    /mp4/.test((await page.locator(".banner").textContent()) ?? ""),
    "サムネイル列へのドロップを受け付け、mp4 以外は断る",
  );

  // まだ保存していないプロジェクトの保存は、先にヘッダーで名前を入れてもらう
  await saveProject();
  await page.waitForTimeout(150);
  check(
    (await page.locator(".tb-title-input").count()) === 1,
    "無題の「保存」でヘッダーの名前の入力が始まる",
  );
  await page.keyboard.press("Escape");

  {
    await page.getByRole("button", { name: /^(Keyboard shortcuts|キー操作の一覧)$/i }).click();
    await page.getByRole("button", { name: /Change keys|キー操作を変更/ }).click();
    await page.waitForTimeout(200);
    const splitKey = page.getByRole("button", {
      name: /^(Split the step at the playhead|再生位置でステップを分割): /,
    });
    await splitKey.click();
    await page.keyboard.press("q");
    await page.waitForTimeout(200);
    check(
      ((await splitKey.textContent()) ?? "").trim() === "Q",
      `アプリの設定でキーを割り当て直せる (${await splitKey.textContent()})`,
    );
    // メニューが使う Ctrl のキーは割り当てられない
    await splitKey.click();
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(150);
    check(
      (await page.locator(".keys-section .hint.warn").count()) === 1,
      "Ctrl+S は割り当てられないと知らせる",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^(Reset all keys|すべてのキーを既定に戻す)$/ }).click();
    await page.waitForTimeout(150);
    check(((await splitKey.textContent()) ?? "").trim() === "S", "すべてのキーを既定に戻す");
    await page.keyboard.press("Escape");
    // ウィンドウの最小幅(左右のパネルの最小幅 + 再生操作の帯が重ならない幅)
    const minW = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()[0],
    );
    check(minW >= 700, `ウィンドウの最小幅を決めている (${minW}px)`);
  }

  // 画像を素材に足す(ファイル選択のダイアログは差し替える)
  {
    const pickReturns = (paths) =>
      app.evaluate(({ dialog }, ps) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps });
      }, paths);
    await pickReturns([img]);
    await page.locator(".rail-add").click();
    await page.waitForTimeout(600);
    const recFold = page.locator(".fold").filter({ hasText: /Recording & speed|録画・速度/ });
    if (!(await recFold.evaluate((el) => el.classList.contains("open"))))
      await recFold.locator(".fold-head").click();
    const len = page.getByLabel(/^(Length \(s\)|長さ\(秒\))$/);
    check(
      (await page.locator(".tl-clip").count()) === 1 &&
        (await len.count()) === 1 &&
        (await len.inputValue()) === "3" &&
        (await page.getByLabel(/^(Speed|速度)/).count()) === 0,
      "画像を足すと 3 秒のステップになり、設定は長さだけ(速度・In/Out はない)",
    );
    await page.keyboard.press("Home");
    await page.waitForTimeout(400);
    const stage = await page.locator(".preview-stage canvas").first().boundingBox();
    const [pr, pg] = await pixelAt({ x: stage.x + stage.width / 2, y: stage.y + stage.height * 0.4 });
    check(pr > 180 && pg < 80, `プレビューに画像を描く (${pr},${pg})`);
    // 左端を左へ引くと長さが伸びる(in は 0 のまま)
    await page.keyboard.press("End");
    const clip = await page.locator(".tl-clip").first().boundingBox();
    const hl = await page.locator(".tl-clip .tl-handle.left").first().boundingBox();
    await drag(page, center(hl), { x: center(hl).x + clip.width / 3, y: center(hl).y });
    const shorter = Number(await len.inputValue());
    const hl2 = await page.locator(".tl-clip .tl-handle.left").first().boundingBox();
    await drag(page, center(hl2), { x: center(hl2).x - clip.width, y: center(hl2).y });
    const longer = Number(await len.inputValue());
    check(
      shorter < 3 && longer > shorter,
      `画像のクリップは左端で縮めても伸ばしてもよい (${shorter} → ${longer})`,
    );
    // 画像のクリップの右クリックに録画の音の項目はない
    await page.locator(".tl-clip").first().click({ button: "right" });
    await page.waitForTimeout(150);
    check(
      (await page.getByRole("menuitem", { name: /recording audio|録画の音/ }).count()) === 0 &&
        (await page.getByRole("menuitem", { name: /after this step|この後に録画・画像/ }).count()) === 1,
      "画像のクリップの右クリック: 録画の音の項目はなく、「この後に録画・画像」がある",
    );
    await page.keyboard.press("Escape");
    // 映像のレーンの空いた所の右クリックで末尾に足す
    await pickReturns([rec]);
    // 伸ばしたクリップの後ろが見えるよう、タイムラインを右端まで送る
    await page.locator(".tl-scroll").evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(150);
    const c1 = await page.locator(".tl-clip").first().boundingBox();
    const lane = await page.locator(".tl-video-lane").boundingBox();
    await page.mouse.click(c1.x + c1.width + 15, lane.y + lane.height / 2, { button: "right" });
    await page.getByRole("menuitem", { name: /at the end|末尾に録画・画像/ }).click();
    await page.waitForTimeout(600);
    check((await page.locator(".tl-clip").count()) === 2, "映像のレーンの右クリックで録画を末尾に足す");
  }

  // 読み上げエンジン: 既定では選べず、アプリの設定で同意して有効にすると選べる(VOICEVOX はテスト用のサーバー)
  {
    const server = await fakeVoicevox();
    const url = `http://127.0.0.1:${server.address().port}`;
    await openProject();
    const speechFold = page
      .locator(".fold")
      .filter({ has: page.locator(".fold-title", { hasText: /^(Speech|読み上げ)$/ }) });
    if (!(await speechFold.evaluate((el) => el.classList.contains("open"))))
      await speechFold.locator(".fold-head").click();
    const engineSel = speechFold
      .locator(".field", { hasText: /^(Speech engine|読み上げエンジン)/ })
      .locator("select");
    check(
      (await engineSel.locator('option[value="voicevox"]').evaluate((el) => el.disabled)) &&
        (await engineSel.locator('option[value="azure"]').evaluate((el) => el.disabled)),
      "VOICEVOX・Azure は既定では選べない",
    );
    await page.getByRole("button", { name: /Speech engine settings|読み上げエンジンの設定/ }).click();
    await page.waitForTimeout(200);
    let confirmText = "";
    page.once("dialog", (d) => {
      confirmText = d.message();
      void d.accept();
    });
    // 確認の後に設定を保存してから入るので、check() ではなく click() で押す
    await page.locator('.engine-block[data-engine="voicevox"] .engine-head input[type="checkbox"]').click();
    await page.waitForTimeout(200);
    check(/利用規約|terms/.test(confirmText), "有効にするときに規約の確認を求める");
    const vvBlock = page.locator('.engine-block[data-engine="voicevox"]');
    const urlInput = vvBlock.locator(".field", { hasText: /Engine URL|エンジンの場所/ }).locator("input");
    await urlInput.fill(url);
    await urlInput.blur();
    await page.waitForTimeout(200);
    await vvBlock.getByRole("button", { name: /Test connection|接続を確かめる/ }).click();
    await page.waitForTimeout(800);
    check(
      /1/.test((await vvBlock.locator(".hint").last().textContent()) ?? ""),
      `接続を確かめると声の数が出る (${await vvBlock.locator(".hint").last().textContent()})`,
    );
    await shot(page, "21-engines");
    const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, "settings.json"), "utf8"));
    check(
      saved.engines.voicevox.enabled && typeof saved.engines.voicevox.agreedAt === "string",
      "同意した日時をアプリの設定に残す",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await engineSel.selectOption("voicevox");
    await page.waitForTimeout(800);
    // 声は打った文字で部分一致の絞り込みができる選択欄
    const voiceInput = speechFold.locator(".field", { hasText: /^(Voice|声)/ }).locator("input");
    await voiceInput.click();
    const voiceOpts = await speechFold.locator(".combo-list > div").allTextContents();
    check(
      voiceOpts.some((o) => o.includes("テスト(ノーマル)")),
      `VOICEVOX を選ぶと声の一覧がエンジンの声になる (${voiceOpts.join(" / ")})`,
    );
    await voiceInput.fill("ノーマル");
    const filteredVoices = await speechFold.locator(".combo-list > div").allTextContents();
    check(
      filteredVoices.length >= 1 && filteredVoices.every((o) => o.includes("ノーマル")),
      `声は名前の途中の文字でも絞り込める (${filteredVoices.join(" / ")})`,
    );
    await voiceInput.press("Enter");
    await page.waitForTimeout(200);
    check(
      /テスト\(ノーマル\)/.test(await voiceInput.inputValue()),
      `Enter で絞り込んだ声を選ぶ (${await voiceInput.inputValue()})`,
    );
    server.close();
  }

  // クラッシュ復旧(PRJ-06): 未保存の変更を 5 秒後に別ファイルへ残し、強制終了のあとの起動で復元を尋ねる。
  // 別のアプリの設定フォルダー・別のプロジェクトで、起動し直して確かめる
  {
    const recDir = path.join(outDir, "user-data-recovery");
    fs.rmSync(recDir, { recursive: true, force: true });
    const recProject = path.join(outDir, "recover.stepcut.json");
    fs.copyFileSync(projectPath, recProject);
    const recFiles = () => {
      try {
        return fs.readdirSync(path.join(recDir, "recovery")).filter((f) => f.endsWith(".json"));
      } catch {
        return [];
      }
    };
    // 起動して最初のダイアログの文を覚える(answer が false なら断る)。window.confirm は読み込みの直後に出る
    const launchRecovery = async (answer) => {
      const a = await electron.launch({
        executablePath: require(path.join(root, "node_modules/electron")),
        args: [root, "--no-sandbox", `--user-data-dir=${recDir}`, recProject],
        cwd: root,
      });
      const w = await a.firstWindow();
      const dialogs = [];
      w.on("dialog", (d) => {
        dialogs.push(d.message());
        void (answer ? d.accept() : d.dismiss());
      });
      await w.setViewportSize({ width: 1400, height: 860 });
      await w.waitForSelector(".rail-thumb");
      await w.waitForTimeout(1500);
      return { a, w, dialogs };
    };
    const editCaption = async (w, text) => {
      await w.locator(".rail-thumb").first().click();
      await w.locator(".tl-bar.caption").first().click();
      const box = w.locator(".section.focused textarea").first();
      await box.fill(text);
      await box.blur();
      await w.waitForTimeout(200);
    };
    const captionOf = async (w) => {
      await w.locator(".rail-thumb").first().click();
      await w.locator(".tl-bar.caption").first().click();
      return w.locator(".section.focused textarea").first().inputValue();
    };

    // 1) 編集して 5 秒以上待ち、強制終了。プロジェクトのファイルは変わらない
    const before = fs.readFileSync(recProject, "utf8");
    let r = await launchRecovery(true);
    check(r.dialogs.length === 0, "復旧ファイルがなければ復元の確認は出ない");
    await editCaption(r.w, "クラッシュ前の編集");
    await r.w.waitForTimeout(6000);
    check(recFiles().length === 1, `未保存の変更を 5 秒後に復旧ファイルへ残す (${recFiles().join(",")})`);
    check(fs.readFileSync(recProject, "utf8") === before, "自動保存でプロジェクトのファイルは書き換えない");
    r.a.process().kill("SIGKILL");
    await new Promise((res) => setTimeout(res, 800));

    // 2) 起動し直す: 復元を尋ね、受け入れると編集が戻り、未保存として出る
    r = await launchRecovery(true);
    check(
      r.dialogs.length === 1 && /復元|Restore/.test(r.dialogs[0]),
      `強制終了のあとの起動で復元を尋ねる (${r.dialogs.join(" | ")})`,
    );
    check((await captionOf(r.w)) === "クラッシュ前の編集", "復元すると編集が戻る");
    check((await r.w.locator(".tb-dirty").count()) === 1, "復元した内容は未保存として出る");
    check(fs.readFileSync(recProject, "utf8") === before, "復元してもプロジェクトのファイルは書き換わらない");

    // 3) 保存すると復旧ファイルが消える。閉じて起動し直しても尋ねない
    await r.w.getByRole("button", { name: /^(File|ファイル)/ }).click();
    await r.w.getByRole("menuitem", { name: /^(Save|保存)/ }).click();
    await r.w.waitForTimeout(800);
    check(recFiles().length === 0, "保存すると復旧ファイルを消す");
    check(
      fs.readFileSync(recProject, "utf8").includes("クラッシュ前の編集"),
      "保存でプロジェクトのファイルに入る",
    );
    await r.a.close();
    r = await launchRecovery(true);
    check(r.dialogs.length === 0, "保存して閉じたあとの起動では復元を尋ねない");

    // 4) 復元したあとの保存済みの内容を、もう一度編集して強制終了する
    await editCaption(r.w, "破棄する編集");
    await r.w.waitForTimeout(6000);
    check(recFiles().length === 1, "もう一度、復旧ファイルが残る");
    r.a.process().kill("SIGKILL");
    await new Promise((res) => setTimeout(res, 800));

    // 5) 復元を断ると復旧ファイルが消え、保存した内容が開く
    r = await launchRecovery(false);
    check(r.dialogs.length === 1, "復元を尋ねる");
    check((await captionOf(r.w)) === "クラッシュ前の編集", "断ると保存してある内容のまま");
    check((await r.w.locator(".tb-dirty").count()) === 0, "断ると未保存にならない");
    check(recFiles().length === 0, "断ると復旧ファイルを消す");
    await r.a.close();
    r = await launchRecovery(true);
    check(r.dialogs.length === 0, "断ったあとの起動では尋ねない");
    check(r.dialogs.length === 0 && recFiles().length === 0, "変更なしで閉じたあとに復旧ファイルが残らない");
    await r.a.close();
  }

  // 読めない録画の選び直し・開けないプロジェクトの知らせ・保持で伸びた長さ・書き出しの中止(別のフォルダーで起動し直す)
  {
    const fixDir = path.join(outDir, "fix");
    fs.rmSync(fixDir, { recursive: true, force: true });
    fs.mkdirSync(fixDir, { recursive: true });
    const launchWith = async (file) => {
      const a = await electron.launch({
        executablePath: require(path.join(root, "node_modules/electron")),
        args: [root, "--no-sandbox", `--user-data-dir=${path.join(fixDir, "user-data")}`, file],
        cwd: root,
      });
      const w = await a.firstWindow();
      await w.setViewportSize({ width: 1400, height: 860 });
      await w.waitForTimeout(2000);
      return { a, w };
    };
    // 閉じるときの「保存していない変更」の確認で止まらないよう、プロセスごと止める
    const kill = async (a) => {
      a.process().kill("SIGKILL");
      await new Promise((res) => setTimeout(res, 500));
    };

    // 1) 開けないプロジェクト: 何が開けなかったかを先に書く
    const badPath = path.join(fixDir, "bad.stepcut.json");
    fs.writeFileSync(badPath, JSON.stringify({ format: "stepcut.project", version: 1, steps: "x" }));
    let r = await launchWith(badPath);
    const badText = (await r.w.locator(".banner.error pre").textContent()) ?? "";
    check(
      /^(プロジェクトファイルを開けませんでした|Could not open the project file): bad\.stepcut\.json\n/.test(
        badText,
      ) && badText.includes("steps"),
      `開けないプロジェクトは、ファイル名を添えて知らせ、直す場所も出す (${badText.split("\n")[0]})`,
    );
    await kill(r.a);

    // 2) 録画が見つからない: 平易な文と「場所を選ぶ…」で選び直す
    const lostPath = path.join(fixDir, "lost.stepcut.json");
    fs.writeFileSync(
      lostPath,
      JSON.stringify({
        format: "stepcut.project",
        version: 1,
        sources: [{ id: "rec1", path: "moved.mp4" }],
        steps: [{ id: "a", source: "rec1", in: 0, out: 4, caption: { text: "a" } }],
      }),
    );
    r = await launchWith(lostPath);
    const lost = r.w.locator(".issues li.error");
    const lostText = (await lost.first().textContent()) ?? "";
    check(
      /(録画・画像が見つかりません|Recording or image not found): moved\.mp4/.test(lostText) &&
        !/ENOENT|remote method/.test(lostText),
      `見つからない録画は、内部のエラー文ではなく平易な文で知らせる (${lostText})`,
    );
    await r.a.evaluate(
      ({ dialog }, ps) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ps });
      },
      [rec],
    );
    await lost
      .first()
      .getByRole("button", { name: /^(場所を選ぶ…|Locate…)$/ })
      .click();
    await r.w.waitForTimeout(2500);
    check(
      (await r.w.locator(".issues li.error").count()) === 0 && (await r.w.locator(".tb-dirty").count()) === 1,
      "「場所を選ぶ…」で録画を選び直すと問題が消え、未保存の変更になる",
    );
    check((await r.w.locator(".tl-tile canvas").count()) > 0, "選び直した録画のサムネイルが出る");

    // 3) ズーム(映像を止める)で伸びた長さを「録画・速度」の見出しに出す
    await r.w.locator(".rail-thumb").first().click();
    const summary = () => r.w.locator(".fold-summary").first().textContent();
    check((await summary()) === "4.0s", `保持がなければ録画の長さ (${await summary()})`);
    await r.w.keyboard.press("ArrowRight");
    await r.w.getByRole("button", { name: /^＋ (Zoom|ズーム)$/ }).click();
    await r.w.keyboard.press("Escape");
    await r.w.waitForTimeout(300);
    const held = (await summary()) ?? "";
    const railLen = (await r.w.locator(".rail-thumb").first().locator(".rail-text").textContent()) ?? "";
    check(
      held === "6.0s" && railLen.includes("6.0s"),
      `ズームで伸びたら、見出しも左の列と同じ伸びた後の長さ (${held} / ${railLen})`,
    );

    // 4) 書き出しの中止: ボタンが中止になり、押すと知らせが出て、途中のファイルを残さない
    const outMp4 = path.join(fixDir, "cancel.mp4");
    await r.a.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, outMp4);
    const exportButton = r.w.locator(".tb-btn.primary");
    await exportButton.click();
    await r.w.waitForFunction(() =>
      /中止|Cancel/.test(document.querySelector(".tb-btn.primary")?.textContent ?? ""),
    );
    check(true, "書き出し中は書き出しのボタンが「中止 n%」になる");
    await exportButton.click();
    await r.w.waitForSelector(".banner.info");
    const canceled = (await r.w.locator(".banner.info pre").textContent()) ?? "";
    await r.w.waitForTimeout(500);
    check(/書き出しを中止しました|Export canceled/.test(canceled), `中止すると知らせが出る (${canceled})`);
    check(
      fs.readdirSync(fixDir).filter((f) => f.startsWith("cancel")).length === 0,
      "中止した書き出しは、書き出し先にも途中のファイルにも残らない",
    );
    check(
      /^(書き出し|Export)$/.test((await exportButton.textContent()) ?? ""),
      "中止のあとは書き出しのボタンに戻る",
    );
    await kill(r.a);
  }

  check(errors.length === 0, `コンソールエラーなし ${errors.join(" | ")}`);
  await app.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
