// テロップの折り返し(TXT-04)、SRT(TXT-08)、読みの辞書(TTS-06)。

/**
 * 幅に収まるように折り返す。ユーザーの改行は保つ。
 * 日本語は語の区切りがないので 1 文字単位、空白を含む欧文は語単位で折り返す。
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const tokens = paragraph.match(/[A-Za-z0-9_.,:;!?'"()\-/@#%&+=]+\s*|\s+|./gu) ?? [""];
    let line = "";
    for (const token of tokens) {
      if (line && measure(line + token) > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
        // 1 語だけで幅を超える場合は文字単位で割る
        while (measure(line) > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        line += token;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function toSrt(cues: Cue[]): string {
  return cues
    .filter((c) => c.text.trim() !== "" && c.end > c.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

export function applyDictionary(text: string, dictionary: { from: string; to: string }[] = []): string {
  let out = text;
  for (const { from, to } of dictionary) out = out.split(from).join(to);
  return out;
}
