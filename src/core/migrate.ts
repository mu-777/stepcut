// 旧い書き方のプロジェクトを今の形に直す(検証の前に行う)。
// version は 1 のまま(M1 の段階での変更のため)。直した後の形で保存される。

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

export function migrateProject(raw: unknown, outW = 1920, outH = 1080): unknown {
  return migrateHighlights(migrateLayout(raw, outW, outH));
}

/**
 * layout.mode / bandHeight / margin(数値) / video を、上下左右の余白(layout.margin)に直す。
 * 旧「帯あり」: 上・左・右に margin(出力の高さに対する割合)、下に帯の高さ。旧「全画面」: 余白なし。
 */
function migrateLayout(raw: unknown, outW: number, outH: number): unknown {
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

/**
 * 蛍光ペン(steps[].highlights と styles.highlighter)を、見た目が蛍光ペンのポインターに直す。
 * 蛍光ペンの見た目(色・太さ・不透明度)は、それぞれのポインターの style に書く
 */
function migrateHighlights(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return raw;
  const styles = isObj(raw.styles) ? raw.styles : null;
  const common = styles && isObj(styles.highlighter) ? styles.highlighter : {};
  const hasLegacy =
    (styles && "highlighter" in styles) || raw.steps.some((s) => isObj(s) && "highlights" in s);
  if (!hasLegacy) return raw;
  const steps = raw.steps.map((s) => {
    if (!isObj(s) || !("highlights" in s)) return s;
    const { highlights, ...rest } = s;
    const converted = (Array.isArray(highlights) ? highlights : []).map((h) => {
      if (!isObj(h)) return h;
      const own = isObj(h.style) ? h.style : {};
      return { ...h, style: { preset: "highlighter", ...common, ...own } };
    });
    const pointers = [...converted, ...(Array.isArray(rest.pointers) ? rest.pointers : [])];
    return pointers.length ? { ...rest, pointers } : rest;
  });
  const out: Obj = { ...raw, steps };
  if (styles) {
    const { highlighter: _h, ...st } = styles;
    out.styles = st;
  }
  return out;
}
