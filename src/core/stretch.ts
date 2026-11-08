// 音の高さを変えずに長さを変える(早送りステップの元の音声)。WSOLA: 短い窓を少しずつ重ねて並べ直し、
// つなぎ目の波形が合う位置を前後から探してずらすことで、つなぎ目の濁りを抑える。

/** 窓の長さ(サンプル)。48kHz で約 43ms */
const WINDOW = 2048;
const HOP_OUT = WINDOW / 2;
/** つなぎ目を探す幅(サンプル) */
const SEEK = 512;

/**
 * channels を speed 倍の速さにした音を返す(長さは約 1/speed)。チャンネルは同じ位置でそろえて切る。
 * speed が 1 なら写しを返す
 */
export function timeStretch(channels: readonly Float32Array[], speed: number): Float32Array[] {
  const first = channels[0];
  if (!first) return [];
  const inLen = first.length;
  const outLen = Math.max(0, Math.round(inLen / speed));
  if (speed === 1 || inLen < WINDOW * 2) {
    // 短すぎる音は窓を作れないので、間引いて長さだけ合わせる
    return channels.map((c) => {
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) out[i] = c[Math.min(inLen - 1, Math.floor(i * speed))] ?? 0;
      return out;
    });
  }
  const hopIn = HOP_OUT * speed;
  const win = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW);
  const outs = channels.map(() => new Float32Array(outLen + WINDOW));
  const norm = new Float32Array(outLen + WINDOW);
  // つなぎ目の合わせ込みはチャンネルを足した波形で行う
  const mono = new Float32Array(inLen);
  for (const c of channels) for (let i = 0; i < inLen; i++) mono[i] = (mono[i] ?? 0) + (c[i] ?? 0);

  let prevEnd = 0; // 前の窓の続き(自然につながる入力の位置)
  for (let k = 0; k * HOP_OUT < outLen; k++) {
    const nominal = Math.round(k * hopIn);
    let pos = Math.min(nominal, inLen - WINDOW);
    if (k > 0) {
      // 前の窓をそのまま続けた波形と、いちばん似ている位置を nominal の前後から選ぶ
      let best = pos;
      let bestScore = Number.NEGATIVE_INFINITY;
      const lo = Math.max(0, nominal - SEEK);
      const hi = Math.min(inLen - WINDOW, nominal + SEEK);
      for (let p = lo; p <= hi; p += 4) {
        let score = 0;
        for (let i = 0; i < HOP_OUT; i += 8) score += (mono[p + i] ?? 0) * (mono[prevEnd + i] ?? 0);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      pos = best;
    }
    if (pos < 0) break;
    const at = k * HOP_OUT;
    channels.forEach((c, ch) => {
      const out = outs[ch] as Float32Array;
      for (let i = 0; i < WINDOW; i++) out[at + i] = (out[at + i] ?? 0) + (c[pos + i] ?? 0) * (win[i] ?? 0);
    });
    for (let i = 0; i < WINDOW; i++) norm[at + i] = (norm[at + i] ?? 0) + (win[i] ?? 0);
    prevEnd = Math.min(inLen - WINDOW, pos + HOP_OUT);
  }
  return outs.map((o) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const n = norm[i] ?? 0;
      r[i] = n > 1e-3 ? (o[i] ?? 0) / n : 0;
    }
    return r;
  });
}
