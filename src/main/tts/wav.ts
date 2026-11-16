// WAV(RIFF)の長さを読む。読み上げの長さ(TTS-03)に使う。

export function wavDuration(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) =>
    String.fromCharCode(buf[o] ?? 0, buf[o + 1] ?? 0, buf[o + 2] ?? 0, buf[o + 3] ?? 0);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      if (!byteRate) throw new Error("WAV has no fmt chunk");
      // ストリーム出力では data のサイズが 0 や最大値のことがあるので、実際の残りで抑える
      const dataSize = Math.min(size || Number.MAX_SAFE_INTEGER, buf.length - offset - 8);
      return dataSize / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** 無音の WAV(16bit モノラル)。読み上げエンジンがない環境の代替に使う */
export function silentWav(seconds: number, sampleRate = 24000): Uint8Array {
  const dataSize = Math.round(seconds * sampleRate) * 2;
  const buf = new Uint8Array(44 + dataSize);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i);
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);
  return buf;
}
