// 背景(LAY-04)。色・グラデーションは毎フレーム描き、画像は出力の大きさで 1 度だけ用意して使い回す。
// プリセット画像はコードで描く(画像ファイルを同梱しないので、出力の大きさに合わせて劣化なく作れ、ライセンスの心配もない)。
import type { Background } from "../../core/schema";
import { api } from "./api";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = CanvasImageSource & { width: number; height: number };

interface Blob2 {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface Preset {
  id: string;
  /** 下地の線形グラデーション(角度と色) */
  base: { angle: number; colors: string[] };
  /** 上に重ねるぼかした色の円(位置と半径は出力に対する割合) */
  blobs: Blob2[];
}

export const PRESETS: Preset[] = [
  {
    id: "default",
    base: { angle: 135, colors: ["#1E2A5A", "#3B2C6B", "#152238"] },
    blobs: [
      { x: 0.15, y: 0.2, r: 0.55, color: "#4F6BFF" },
      { x: 0.85, y: 0.3, r: 0.5, color: "#B34FD8" },
      { x: 0.6, y: 0.95, r: 0.6, color: "#2BB5C8" },
    ],
  },
  {
    id: "sunset",
    base: { angle: 160, colors: ["#FF8A5B", "#E2537A", "#6A3A8C"] },
    blobs: [
      { x: 0.2, y: 0.15, r: 0.5, color: "#FFD27A" },
      { x: 0.9, y: 0.75, r: 0.55, color: "#C2307A" },
    ],
  },
  {
    id: "mint",
    base: { angle: 120, colors: ["#D8F5EC", "#9FE3D0", "#7CC4E6"] },
    blobs: [
      { x: 0.1, y: 0.85, r: 0.5, color: "#5FD1A9" },
      { x: 0.85, y: 0.15, r: 0.45, color: "#A8E6FF" },
    ],
  },
  {
    id: "ocean",
    base: { angle: 180, colors: ["#0B3D6E", "#0E5A8A", "#06233F"] },
    blobs: [
      { x: 0.3, y: 0.1, r: 0.5, color: "#1FA2D6" },
      { x: 0.8, y: 0.9, r: 0.55, color: "#1C4FA0" },
    ],
  },
  {
    id: "graphite",
    base: { angle: 135, colors: ["#3A3D44", "#24262B", "#17181B"] },
    blobs: [{ x: 0.2, y: 0.2, r: 0.6, color: "#5A5F6B" }],
  },
  {
    id: "paper",
    base: { angle: 135, colors: ["#F6F4EF", "#E7E4DC", "#D9DDE3"] },
    blobs: [
      { x: 0.85, y: 0.2, r: 0.5, color: "#FFFFFF" },
      { x: 0.1, y: 0.9, r: 0.5, color: "#C9D3E0" },
    ],
  },
];

/** CSS と同じ向きの角度(0 = 下から上、90 = 左から右)で線形グラデーションを作る */
function linear(ctx: Ctx, w: number, h: number, angle: number, colors: string[]): CanvasGradient {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // 角まで色が届く長さ(CSS の linear-gradient と同じ)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const g = ctx.createLinearGradient(
    w / 2 - dx * half,
    h / 2 - dy * half,
    w / 2 + dx * half,
    h / 2 + dy * half,
  );
  colors.forEach((c, i) => {
    g.addColorStop(i / Math.max(1, colors.length - 1), c);
  });
  return g;
}

function drawPreset(ctx: Ctx, w: number, h: number, p: Preset): void {
  ctx.fillStyle = linear(ctx, w, h, p.base.angle, p.base.colors);
  ctx.fillRect(0, 0, w, h);
  const s = Math.max(w, h);
  for (const b of p.blobs) {
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * s);
    g.addColorStop(0, `${b.color}B3`);
    g.addColorStop(1, `${b.color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

/** 色とグラデーションを描く。画像なら false を返す */
export function drawSimpleBackground(ctx: Ctx, w: number, h: number, bg: Background): boolean {
  if (typeof bg === "string") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    return true;
  }
  if ("gradient" in bg) {
    ctx.fillStyle = linear(ctx, w, h, bg.gradient.angle ?? 180, bg.gradient.colors);
    ctx.fillRect(0, 0, w, h);
    return true;
  }
  return false;
}

/** 画像の背景を出力の大きさで用意しておく。ファイルは読み込みが終わるまで null を返す */
export class BackgroundStore {
  private cache = new Map<string, Img | null>();
  private loading = new Map<string, Promise<Img | null>>();
  private errors = new Map<string, string>();

  constructor(private onLoad: () => void = () => {}) {}

  private key(image: string, w: number, h: number, projectPath: string | null) {
    return `${image}|${w}x${h}|${image.startsWith("preset:") ? "" : (projectPath ?? "")}`;
  }

  /** 画像の背景。用意できていなければ読み込みを始めて null を返す */
  get(image: string, w: number, h: number, projectPath: string | null): Img | null {
    const k = this.key(image, w, h, projectPath);
    if (this.cache.has(k)) return this.cache.get(k) ?? null;
    void this.load(image, w, h, projectPath);
    return null;
  }

  error(image: string, projectPath: string | null): string | null {
    return this.errors.get(`${image}|${projectPath ?? ""}`) ?? null;
  }

  load(image: string, w: number, h: number, projectPath: string | null): Promise<Img | null> {
    const k = this.key(image, w, h, projectPath);
    if (this.cache.has(k)) return Promise.resolve(this.cache.get(k) ?? null);
    let p = this.loading.get(k);
    if (!p) {
      p = render(image, w, h, projectPath)
        .catch((e) => {
          this.errors.set(`${image}|${projectPath ?? ""}`, (e as Error).message);
          return null;
        })
        .then((img) => {
          this.cache.set(k, img);
          this.loading.delete(k);
          this.onLoad();
          return img;
        });
      this.loading.set(k, p);
    }
    return p;
  }
}

async function render(image: string, w: number, h: number, projectPath: string | null): Promise<Img> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  if (image.startsWith("preset:")) {
    const preset = PRESETS.find((p) => `preset:${p.id}` === image);
    if (!preset) throw new Error(`背景のプリセットがありません / Unknown preset: ${image}`);
    drawPreset(ctx, w, h, preset);
    return canvas;
  }
  const abs = await api.resolveSource(projectPath, image);
  const size = await api.fileSize(abs);
  const bytes = await api.readRange(abs, 0, size);
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  // 出力いっぱいに縦横比を保って敷き詰める(はみ出しは切る)
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bmp.close();
  return canvas;
}

/** 設定画面の見本用に、プリセットを小さく描く */
export function drawPresetThumb(canvas: HTMLCanvasElement, id: string): void {
  const p = PRESETS.find((x) => x.id === id);
  const ctx = canvas.getContext("2d");
  if (p && ctx) drawPreset(ctx, canvas.width, canvas.height, p);
}
