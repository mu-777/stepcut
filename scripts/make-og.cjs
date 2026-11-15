// LP の OGP 画像(1200×630)を作る。英語のページ(/)用の site/public/og.png と、日本語のページ(/ja/)用の og-ja.png。
//   node scripts/make-og.cjs
// ロゴか見出しを変えたときだけ実行し、できた画像をコミットする。Playwright が要る(make-icon.cjs と同じ)。
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const logo = fs.readFileSync(path.join(root, "assets/logo/stepcut-logo-on-dark.svg"), "utf8");
const pages = [
  {
    file: "og.png",
    font: "IBM+Plex+Sans",
    family: "'IBM Plex Sans',sans-serif",
    title: "Turn recordings into videos that explain.",
    sub: "A free Windows app for adding explanations to recordings",
  },
  {
    file: "og-ja.png",
    font: "IBM+Plex+Sans+JP",
    family: "'IBM Plex Sans JP','Noto Sans JP',sans-serif",
    title: "録画を、説明付きの動画に。",
    sub: "録画に説明を付ける Windows 用の無料アプリ",
  },
];
const html = (
  p,
) => `<body style="margin:0;width:1200px;height:630px;background:#1e1f22;color:#e3e5e8;display:flex;
  flex-direction:column;justify-content:center;gap:44px;padding:0 96px;box-sizing:border-box;font-family:${p.family}">
  <div style="width:420px">${logo}</div>
  <div style="font-size:68px;font-weight:700;line-height:1.3">${p.title}</div>
  <div style="font-size:28px;color:#9a9ca3">${p.sub}</div>
</body>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const p of pages) {
    await page.setContent(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${p.font}:wght@400;700&display=swap">${html(p)}`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(root, "site/public", p.file);
    await page.screenshot({ path: out });
    console.log(path.relative(root, out));
  }
  await browser.close();
})();
