// Undo/Redo(PRJ-07)。プロジェクト全体のスナップショットを積む。
// 文字入力のような連続した変更は、同じ key で 1 秒以内なら 1 つにまとめる。
// ドラッグ(key が "drag" で始まる)は 1 回のドラッグ全体を 1 つにまとめる。
import type { Project } from "../../core/schema";

const COALESCE_MS = 1000;
const LIMIT = 200;

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  lastKey: string | null;
  lastAt: number;
}

export function initHistory(p: Project): History {
  return { past: [], present: p, future: [], lastKey: null, lastAt: 0 };
}

export function commit(h: History, next: Project, key: string | null = null, now = Date.now()): History {
  if (next === h.present) return h;
  const coalesce =
    key !== null && key === h.lastKey && (key.startsWith("drag") || now - h.lastAt < COALESCE_MS);
  const past = coalesce ? h.past : [...h.past, h.present].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}
