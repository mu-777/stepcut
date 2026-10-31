// 旧い書き方のプロジェクトを今の形に直す(検証の前に行う)。
// version は 1 のまま(M1 の段階での変更のため)。直した後の形で保存される。

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

/**
 * layout.mode / bandHeight / margin(数値) / video を、上下左右の余白(layout.margin)に直す。
 * 旧「帯あり」: 上・左・右に margin(出力の高さに対する割合)、下に帯の高さ。旧「全画面」: 余白なし。
 */
export function migrateProject(raw: unknown, outW = 1920, outH = 1080): unknown {
  if (!isObj(raw) || !isObj(raw.layout)) return raw;
  const l = { ...raw.layout };
  const legacy = "mode" in l || "bandHeight" in l || typeof l.margin === "number" || "video" in l;
  if (!legacy) return raw;
  const o = isObj(raw.output) ? raw.output : {};
  const w = num(o.width, outW);
  const h = num(o.height, outH);
  if (l.mode === "full") {
    l.margin = { top: 0, right: 0, bottom: 0, left: 0 };
  } else {
    const m = num(l.margin, 0.04);
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    l.margin = { top: m, right: r4((m * h) / w), bottom: num(l.bandHeight, 0.2), left: r4((m * h) / w) };
  }
  delete l.mode;
  delete l.bandHeight;
  delete l.video;
  return { ...raw, layout: l };
}
