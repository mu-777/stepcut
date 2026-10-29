// プレビュー。縮小した大きさで描く(NF-04)。ズーム範囲の指定中はドラッグで範囲を受け取る。
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import type { Rect } from "../../core/layout";
import type { Project } from "../../core/schema";
import { outputToSource, sourceToOutput } from "./compositor";
import { Player, type PlayerState } from "./player";

export interface DrawingZoom {
  srcW: number;
  srcH: number;
  rect: Rect | null;
  onRect: (rect: Rect) => void;
}

export function Preview(props: {
  outW: number;
  outH: number;
  project: Project;
  stateRef: MutableRefObject<PlayerState>;
  playerRef: MutableRefObject<Player | null>;
  onTime: (t: number, playing: boolean) => void;
  drawing: DrawingZoom | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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
  const toLocal = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // 画面上の点(CSS ピクセル)→ ソースの座標
  const toSource = (x: number, y: number) =>
    d ? outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, x, y) : { x: 0, y: 0 };

  let outline: { left: number; top: number; width: number; height: number } | null = null;
  if (drag) {
    outline = {
      left: Math.min(drag.x0, drag.x1),
      top: Math.min(drag.y0, drag.y1),
      width: Math.abs(drag.x1 - drag.x0),
      height: Math.abs(drag.y1 - drag.y0),
    };
  } else if (d?.rect) {
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
    outline = { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
  }

  return (
    <div className="preview" ref={wrapRef}>
      <div className="preview-stage" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvasRef} width={pxW} height={pxH} style={{ width: size.w, height: size.h }} />
        {d && (
          <div
            className="draw-layer"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const p = toLocal(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const p = toLocal(e);
              setDrag({ ...drag, x1: p.x, y1: p.y });
            }}
            onPointerUp={() => {
              if (!drag) return;
              const a = toSource(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
              const b = toSource(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
              setDrag(null);
              if (b.x - a.x < 4 || b.y - a.y < 4) return;
              d.onRect({
                x: Math.round(a.x),
                y: Math.round(a.y),
                w: Math.round(b.x - a.x),
                h: Math.round(b.y - a.y),
              });
            }}
          >
            {outline && <div className="zoom-outline" style={outline} />}
          </div>
        )}
      </div>
    </div>
  );
}
