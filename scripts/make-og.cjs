// LP の OGP 画像 site/public/og.png(1200×630)を作る。
//   node scripts/make-og.cjs
// ロゴか見出しを変えたときだけ実行し、できた og.png をコミットする。Playwright が要る(make-icon.cjs と同じ)。
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const logo = fs.readFileSync(path.join(root, "assets/logo/stepcut-logo-on-dark.svg"), "utf8");
const html = `<body style="margin:0;width:1200px;height:630px;background:#1e1f22;color:#e3e5e8;display:flex;
  flex-direction:column;justify-content:center;gap:44px;padding:0 96px;box-sizing:border-box;
  font-family:'Zen Kaku Gothic New','Noto Sans CJK JP',sans-serif">
  <div style="width:420px">${logo}</div>
  <div style="font-size:68px;font-weight:900;line-height:1.3">録画を、手順が伝わる動画に。</div>
  <div style="font-size:28px;color:#9a9ca3">画面録画から手順書動画を作る Windows 用の無料アプリ</div>
</body>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;900&display=swap">${html}`,
    { waitUntil: "networkidle" },
  );
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, "site/public/og.png");
  await page.screenshot({ path: out });
  await browser.close();
  console.log(path.relative(root, out));
})();
