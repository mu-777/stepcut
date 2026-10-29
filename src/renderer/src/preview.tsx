// プレビュー。縮小した大きさで描く(NF-04)。
// 枠の編集(ズーム範囲、枠付きでの映像の位置と大きさ)は、図形編集ソフトと同じく本体のドラッグで移動、角のドラッグで拡大縮小する。
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { resolveLayout } from "../../core/defaults";
import { computeLayout, type Rect } from "../../core/layout";
import type { Project } from "../../core/schema";
import { outputToSource, sourceToOutput } from "./compositor";
import { Player, type PlayerState } from "./player";

export interface DrawingZoom {
  srcW: number;
  srcH: number;
  rect: Rect | null;
  /** 範囲(ソースのピクセル)。key は 1 回のドラッグで同じ */
  onRect: (rect: Rect, key: string) => void;
}

export interface VideoEdit {
  /** 映像の矩形(出力のピクセル)。key は 1 回のドラッグで同じ */
  onRect: (rect: Rect, key: string) => void;
}

export function Preview(props: {
  outW: number;
  outH: number;
  project: Project;
  stateRef: MutableRefObject<PlayerState>;
  playerRef: MutableRefObject<Player | null>;
  onTime: (t: number, playing: boolean) => void;
  drawing: DrawingZoom | null;
  /** 表示中の録画の大きさ(映像の位置の計算に使う) */
  srcSize: { w: number; h: number } | null;
  /** 映像を選んでいるとき(枠付き)。枠とハンドルを出す */
  videoEdit: VideoEdit | null;
  /** 映像の上をクリックした(枠付きで、ほかの編集をしていないとき) */
  onVideoClick: (inside: boolean) => void;
  /** 右クリック。点は出力のピクセル */
  onContextMenu: (clientX: number, clientY: number, out: { x: number; y: number }) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const onTimeRef = useRef(props.onTime);
  onTimeRef.current = props.onTime;
  const { stateRef, playerRef, outW, outH } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const player = new Player(
      canvas,
      () => stateRef.current,
      (t, p) => onTimeRef.current(t, p),
    );
    playerRef.current = player;
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [stateRef, playerRef]);

  // 枠に合わせて出力の縦横比で大きさを決める。描画の解像度は出力を超えない
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const resize = () => {
      const maxW = el.clientWidth;
      const maxH = el.clientHeight;
      const scale = Math.min(maxW / outW, maxH / outH);
      setSize({ w: Math.max(1, Math.floor(outW * scale)), h: Math.max(1, Math.floor(outH * scale)) });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [outW, outH]);

  const dpr = Math.min(window.devicePixelRatio || 1, outW / Math.max(1, size.w));
  const pxW = Math.round(size.w * dpr);
  const pxH = Math.round(size.h * dpr);

  useEffect(() => {
    // 大きさが変わるとキャンバスが消えるので描き直す
    void pxW;
    void pxH;
    playerRef.current?.renderStill();
  }, [pxW, pxH, playerRef]);

  const d = props.drawing;
  const k = outW / Math.max(1, size.w);
  const toStage = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = (el.closest(".preview-stage") as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const layout = resolveLayout(props.project);
  const src = props.srcSize ?? { w: 1920, h: 1080 };
  const videoBox = computeLayout(size.w, size.h, layout, src.w, src.h).video;

  let editor: React.ReactNode = null;
  if (d) {
    // ズーム範囲: ソースの座標 ⇔ 画面上の座標
    const box = d.rect
      ? (() => {
          const a = sourceToOutput(props.project, size.w, size.h, d.srcW, d.srcH, d.rect.x, d.rect.y);
          const b = sourceToOutput(
            props.project,
            size.w,
            size.h,
            d.srcW,
            d.srcH,
            d.rect.x + d.rect.w,
            d.rect.y + d.rect.h,
          );
          return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        })()
      : null;
    editor = (
      <BoxEditor
        box={box}
        aspect={d.srcW / d.srcH}
        allowDraw
        bounds={videoBox}
        snapX={[]}
        snapY={[]}
        onChange={(b, key) => {
          const a = outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, b.x, b.y);
          const c = outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, b.x + b.w, b.y + b.h);
          if (c.x - a.x < 4 || c.y - a.y < 4) return;
          d.onRect(
            { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(c.x - a.x), h: Math.round(c.y - a.y) },
            key,
          );
        }}
      />
    );
  } else if (props.videoEdit) {
    const ve = props.videoEdit;
    const bandTop = size.h * (1 - layout.bandHeight);
    editor = (
      <BoxEditor
        box={videoBox}
        aspect={src.w / src.h}
        snapX={[size.w / 2]}
        snapY={[size.h / 2, bandTop / 2]}
        onChange={(b, key) => ve.onRect({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }, key)}
      />
    );
  }

  return (
    <div className="preview" ref={wrapRef}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用 */}
      <div
        className="preview-stage"
        style={{ width: size.w, height: size.h }}
        onPointerDown={(e) => {
          if (e.button !== 0 || d) return;
          const p = toStage(e, e.currentTarget);
          const v = videoBox;
          props.onVideoClick(p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = toStage(e, e.currentTarget);
          props.onContextMenu(e.clientX, e.clientY, { x: p.x * k, y: p.y * k });
        }}
      >
        <canvas ref={canvasRef} width={pxW} height={pxH} style={{ width: size.w, height: size.h }} />
        {editor}
      </div>
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };
type Mode = "move" | "draw" | "nw" | "ne" | "sw" | "se";
const SNAP = 6;

/**
 * 画面上の枠の編集。縦横比は常に保つ(映像やズーム範囲を歪ませない)。
 * snapX / snapY は枠の中心を吸着させる線(画面上の座標)。吸着中はガイド線を出す。
 */
function BoxEditor(props: {
  box: Box | null;
  aspect: number;
  allowDraw?: boolean;
  /** 新しく描くときに収める範囲 */
  bounds?: Box;
  snapX: number[];
  snapY: number[];
  onChange: (b: Box, key: string) => void;
}) {
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [preview, setPreview] = useState<Box | null>(null);

  const begin = (e: React.PointerEvent, mode: Mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const stage = (e.currentTarget as HTMLElement).closest(".preview-stage") as HTMLElement;
    const origin = stage.getBoundingClientRect();
    const p0 = { x: e.clientX - origin.left, y: e.clientY - origin.top };
    const b0 = props.box ?? { x: p0.x, y: p0.y, w: 0, h: 0 };
    const key = `drag-box-${Date.now()}`;
    const { aspect } = props;
    const move = (ev: PointerEvent) => {
      const p = { x: ev.clientX - origin.left, y: ev.clientY - origin.top };
      let b: Box;
      let gx: number | null = null;
      let gy: number | null = null;
      if (mode === "move") {
        b = { ...b0, x: b0.x + p.x - p0.x, y: b0.y + p.y - p0.y };
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const sx = props.snapX.find((x) => Math.abs(x - cx) <= SNAP);
        const sy = props.snapY.find((y) => Math.abs(y - cy) <= SNAP);
        if (sx !== undefined && !ev.altKey) {
          b.x = sx - b.w / 2;
          gx = sx;
        }
        if (sy !== undefined && !ev.altKey) {
          b.y = sy - b.h / 2;
          gy = sy;
        }
      } else {
        // 描くとき・角を動かすときは、反対側の角を固定する
        const anchor =
          mode === "draw"
            ? p0
            : {
                x: mode === "nw" || mode === "sw" ? b0.x + b0.w : b0.x,
                y: mode === "nw" || mode === "ne" ? b0.y + b0.h : b0.y,
              };
        const dx = p.x - anchor.x;
        const dy = p.y - anchor.y;
        const w = Math.max(8, Math.abs(dx), Math.abs(dy) * aspect);
        const h = w / aspect;
        b = { x: dx < 0 ? anchor.x - w : anchor.x, y: dy < 0 ? anchor.y - h : anchor.y, w, h };
        if (mode === "draw" && props.bounds) {
          const B = props.bounds;
          b.x = Math.min(Math.max(b.x, B.x), B.x + B.w - b.w);
          b.y = Math.min(Math.max(b.y, B.y), B.y + B.h - b.h);
        }
      }
      setGuides({ x: gx, y: gy });
      if (mode === "draw") setPreview(b);
      else props.onChange(b, key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: null, y: null });
      setPreview((pv) => {
        if (pv) props.onChange(pv, key);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const b = preview ?? props.box;
  return (
    <div
      className={`box-layer ${props.allowDraw ? "draw-layer" : ""}`}
      onPointerDown={props.allowDraw ? (e) => begin(e, "draw") : undefined}
    >
      {b && (
        <div
          className="box-outline"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
          onPointerDown={(e) => begin(e, "move")}
        >
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <div key={c} className={`box-handle ${c}`} onPointerDown={(e) => begin(e, c)} />
          ))}
        </div>
      )}
      {guides.x !== null && <div className="guide v" style={{ left: guides.x }} />}
      {guides.y !== null && <div className="guide h" style={{ top: guides.y }} />}
    </div>
  );
}
