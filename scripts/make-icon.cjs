// assets/logo/stepcut-icon.svg から Windows 用の build/icon.ico を作る。
//   node scripts/make-icon.cjs
// ロゴの SVG を変えたときだけ実行し、できた icon.ico をコミットする(ビルドでは実行しない)。
// 描画に Playwright の Chromium を使う。依存には入れていないので、なければ
// `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright` で一時的に入れる。
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "assets/logo/stepcut-icon.svg");
const OUT = path.join(root, "build/icon.ico");
// 256 は PNG、それより小さいものは BMP で入れる(小さい PNG を読めない古い道具があるため)
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** RGBA(上から下)を、ICO の中の 32bit BMP(下から上の BGRA + 透過マスク)にする */
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // 色の面とマスクの面を合わせた高さ
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  // 透過マスク(1bit、行は 4 バイト境界)。透過はアルファで表すので、すべて 0 にする
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, pixels, mask]);
}

(async () => {
  const svg = fs.readFileSync(SRC, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const rendered = await page.evaluate(
    async ({ svg, sizes }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await img.decode();
      return sizes.map((size) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        return {
          size,
          rgba: Array.from(ctx.getImageData(0, 0, size, size).data),
          png: canvas.toDataURL("image/png").split(",")[1],
        };
      });
    },
    { svg, sizes: SIZES },
  );
  await browser.close();

  const entries = rendered.map(({ size, rgba, png }) => ({
    size,
    data: size >= 256 ? Buffer.from(png, "base64") : bmpEntry(size, rgba),
  }));
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(1, 2); // 種類: アイコン
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    dir[at] = size >= 256 ? 0 : size; // 256 は 0 と書く決まり
    dir[at + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.concat([dir, ...entries.map((e) => e.data)]));
  console.log(`${path.relative(root, OUT)}: ${SIZES.join(", ")}px`);
})();
