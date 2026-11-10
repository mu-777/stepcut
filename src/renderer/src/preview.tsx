// プレビュー。縮小した大きさで描く(NF-04)。
// 枠の編集(ズーム範囲、録画の位置と大きさ)は共通の操作: 枠の中のドラッグで移動、四隅で縦横比を保った拡大縮小、四辺の中央で縦横比の変更。
// Ctrl+ホイールでプレビューだけを拡大縮小できる(細かい調整用。書き出しには影響しない)。
import { type MutableRefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveCaptionPlacement, resolveCaptionStyle, resolveLayout } from "../../core/defaults";
import { computeLayout, type Rect, zoomViewRect } from "../../core/layout";
import type { Project, Step } from "../../core/schema";
import { captionBox, captionFont, outputToSource, sourceToOutput } from "./compositor";
import { t } from "./i18n";
import { Player, type PlayerState } from "./player";

export interface DrawingZoom {
  srcW: number;
  srcH: number;
  /** 編集中の枠(ソースのピクセル) */
  rect: Rect | null;
  /** すべての枠(時刻の順)。編集中でない枠は点線で示し、中心どうしを線でつなぐ */
  ghosts: Rect[];
  /** 編集中の枠の番号 */
  current: number;
  /** 点線の枠をクリックした(その枠の編集に切り替える) */
  onPick: (i: number) => void;
  /** 録画の縦横比を保つズーム。実際に見える範囲(広げた範囲)も示す */
  keepAspect: boolean;
  /** 範囲(ソースのピクセル)。key は 1 回のドラッグで同じ */
  onRect: (rect: Rect, key: string) => void;
  /** 枠の外をクリックして確定した */
  onCommit: () => void;
}

export interface VideoEdit {
  /** 録画の枠(出力のピクセル)。key は 1 回のドラッグで同じ。shapeChanged は縦横比を変えた操作 */
  onRect: (rect: Rect, key: string, shapeChanged: boolean) => void;
}

/** プレビューの表示倍率の範囲 */
const VIEW_ZOOM_MAX = 8;

export function Preview(props: {
  outW: number;
  outH: number;
  project: Project;
  stateRef: MutableRefObject<PlayerState>;
  playerRef: MutableRefObject<Player | null>;
  onTime: (t: number, playing: boolean) => void;
  drawing: DrawingZoom | null;
  /** 枠の拡大縮小で固定する点 */
  anchor: Anchor;
  /** 表示中の録画の大きさ(映像の位置の計算に使う) */
  srcSize: { w: number; h: number } | null;
  /** 録画を選んでいるとき。枠とハンドルを出す */
  videoEdit: VideoEdit | null;
  /** プレビューをクリックした(ほかの編集をしていないとき)。inside は録画の上か */
  onVideoClick: (inside: boolean) => void;
  /** 右クリック。点は出力のピクセル */
  onContextMenu: (clientX: number, clientY: number, out: { x: number; y: number }) => void;
  /** プレビューの真下の帯に置く、プレビュー上の操作の部品(編集中だけの切り替え、表示倍率) */
  tools: React.ReactNode;
  /** プレビューの表示倍率(1 = 全体表示) */
  viewZoom: number;
  onViewZoom: (z: number) => void;
  /** いまテロップが出ているステップ。テロップをドラッグで動かせる */
  captionStep: Step | null;
  /** テロップの中心(画面側座標) */
  onCaptionMove: (pos: { x: number; y: number }, key: string) => void;
  /** テロップの枠(文字の外側の縁)をクリックした(ドラッグなし)。枠を選ぶ */
  onCaptionClick: () => void;
  /** テロップの文字をクリックした(ドラッグなし)。その場で文字の入力を始める */
  onCaptionEdit: () => void;
  /** プレビュー上でテロップの文字を入力中 */
  captionEditing: boolean;
  /** 入力した文字 */
  onCaptionText: (text: string) => void;
  /** 文字の入力を終えた(Esc・フォーカスが外れた) */
  onCaptionEditEnd: () => void;
  /** テロップの幅(出力の幅に対する割合)。key は 1 回のドラッグで同じ */
  onCaptionWidth: (width: number, key: string) => void;
  /** テロップを選んでいる(幅の取っ手を出す) */
  captionSelected: boolean;
  /** 録画を置く場所をダブルクリックした */
  onEmptyDoubleClick: () => void;
  /** 描画の GPU コンテキストが失われた(用意した画像を作り直す) */
  onContextLost: () => void;
  /** 選んだオブジェクトの取っ手(ステージの大きさを渡して作る) */
  objects?: (stage: { w: number; h: number }) => React.ReactNode;
  /** プレビューをクリックした点(ステージのピクセル)でオブジェクトを選ぶ。選んだら true */
  onPickObject?: (p: { x: number; y: number }, stage: { w: number; h: number }) => boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fitSize, setFitSize] = useState({ w: 640, h: 360 });
  /** 映像を置ける高さ(操作の帯の分を除く) */
  const [availH, setAvailH] = useState(360);
  const onTimeRef = useRef(props.onTime);
  onTimeRef.current = props.onTime;
  const onLostRef = useRef(props.onContextLost);
  onLostRef.current = props.onContextLost;
  const { stateRef, playerRef, outW, outH, viewZoom } = props;
  const onViewZoomRef = useRef(props.onViewZoom);
  onViewZoomRef.current = props.onViewZoom;
  const size = { w: Math.round(fitSize.w * viewZoom), h: Math.round(fitSize.h * viewZoom) };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const player = new Player(
      canvas,
      () => stateRef.current,
      (t, p) => onTimeRef.current(t, p),
    );
    playerRef.current = player;
    // GPU のプロセスが落ちるとキャンバスの中身が消える。用意した画像を捨て、戻ったら描き直す
    const lost = () => onLostRef.current();
    const restored = () => {
      onLostRef.current();
      void player.renderStill();
    };
    canvas.addEventListener("contextlost", lost);
    canvas.addEventListener("contextrestored", restored);
    return () => {
      canvas.removeEventListener("contextlost", lost);
      canvas.removeEventListener("contextrestored", restored);
      player.stop();
      playerRef.current = null;
    };
  }, [stateRef, playerRef]);

  // 枠に合わせて出力の縦横比で大きさを決める。描画の解像度は出力を超えない。
  // 操作の帯は映像の真下に置くので、その高さを除いた中に収める(余った高さは帯の下に回る)
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const resize = () => {
      const maxW = el.clientWidth;
      const maxH = Math.max(1, el.clientHeight - TOOLS_H);
      const scale = Math.min(maxW / outW, maxH / outH);
      setFitSize({ w: Math.max(1, Math.floor(outW * scale)), h: Math.max(1, Math.floor(outH * scale)) });
      setAvailH(maxH);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [outW, outH]);

  // Ctrl+ホイールでプレビューを拡大縮小(カーソルの下の点を保つ)。拡大中はホイールで上下、Shift+ホイールで左右に動かす
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const viewZoomRef = useRef(viewZoom);
  viewZoomRef.current = viewZoom;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const stage = el.querySelector(".preview-stage") as HTMLElement | null;
        const r = stage?.getBoundingClientRect();
        if (r)
          zoomAnchor.current = {
            fx: (e.clientX - r.left) / r.width,
            fy: (e.clientY - r.top) / r.height,
            cx: e.clientX,
            cy: e.clientY,
          };
        const next = Math.min(VIEW_ZOOM_MAX, Math.max(1, viewZoomRef.current * Math.exp(-e.deltaY * 0.002)));
        onViewZoomRef.current(Math.abs(next - 1) < 0.02 ? 1 : next);
      } else if (viewZoomRef.current > 1) {
        e.preventDefault();
        if (e.shiftKey) el.scrollLeft += e.deltaY;
        else {
          el.scrollLeft += e.deltaX;
          el.scrollTop += e.deltaY;
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示倍率が変わったときだけ位置を合わせる
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const stage = el?.querySelector(".preview-stage") as HTMLElement | null;
    if (!el || !a || !stage) return;
    const r = stage.getBoundingClientRect();
    el.scrollLeft += r.left + a.fx * r.width - a.cx;
    el.scrollTop += r.top + a.fy * r.height - a.cy;
  }, [viewZoom]);

  /** 中ボタンのドラッグで表示位置を動かす */
  const panFrom = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (e.button !== 1 || !el) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const l0 = el.scrollLeft;
    const t0 = el.scrollTop;
    const move = (ev: PointerEvent) => {
      el.scrollLeft = l0 - (ev.clientX - x0);
      el.scrollTop = t0 - (ev.clientY - y0);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
  const [captionGuides, setCaptionGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  let editor: React.ReactNode = null;
  if (d) {
    // ズーム範囲: ソースの座標 ⇔ 画面上の座標(ズームなしの表示で)
    const toScreen = (r: Rect) => {
      const a = sourceToOutput(props.project, size.w, size.h, d.srcW, d.srcH, r.x, r.y);
      const b = sourceToOutput(props.project, size.w, size.h, d.srcW, d.srcH, r.x + r.w, r.y + r.h);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    const crop = computeLayout(size.w, size.h, layout, d.srcW, d.srcH).crop;
    editor = (
      <BoxEditor
        box={d.rect ? toScreen(d.rect) : null}
        // 実際に見える範囲(表示の縦横比に合わせて広げた範囲)を薄く示す。枠どおりに映すズームでは枠と同じ
        visible={
          d.rect && d.keepAspect ? toScreen(zoomViewRect(d.rect, crop.w / crop.h, d.srcW, d.srcH)) : null
        }
        ghosts={d.ghosts.length > 1 ? d.ghosts.map(toScreen) : []}
        current={d.current}
        onPick={d.onPick}
        allowDraw
        bounds={videoBox}
        anchor={props.anchor}
        snapX={[videoBox.x + videoBox.w / 2]}
        snapY={[videoBox.y + videoBox.h / 2]}
        edgeX={[videoBox.x, videoBox.x + videoBox.w]}
        edgeY={[videoBox.y, videoBox.y + videoBox.h]}
        onCommit={d.onCommit}
        onChange={(b, key, _shape, move) => {
          const a = outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, b.x, b.y);
          if (move && d.rect) {
            // 移動では大きさを変えない(画面の座標への換算の誤差や端での切り詰めで枠が伸び縮みしないように)
            const { w, h } = d.rect;
            d.onRect(
              {
                x: Math.round(Math.min(Math.max(0, a.x), Math.max(0, d.srcW - w))),
                y: Math.round(Math.min(Math.max(0, a.y), Math.max(0, d.srcH - h))),
                w,
                h,
              },
              key,
            );
            return;
          }
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
    editor = (
      <BoxEditor
        box={videoBox}
        anchor={props.anchor}
        snapX={[size.w / 2]}
        snapY={[size.h / 2]}
        edgeX={[0, size.w]}
        edgeY={[0, size.h]}
        onChange={(b, key, shapeChanged) =>
          ve.onRect({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }, key, shapeChanged)
        }
      />
    );
  }

  // テロップのドラッグ(表示中のステップのテロップ)。クリックだけならそのテロップを選ぶ
  let captionHandle: React.ReactNode = null;
  const cs = props.captionStep;
  if (cs && !d && !props.videoEdit) {
    const ctx = canvasRef.current?.getContext("2d");
    const c = ctx
      ? captionBox(ctx, props.project, cs, size.w, size.h, videoBox, t("captionPlaceholder"))
      : null;
    if (c) {
      // 幅(折り返す幅)の枠と、左右の取っ手。中心を固定して左右対称に変える
      const wrapW = resolveCaptionPlacement(props.project, cs).width * size.w;
      const widthFrame = (
        <div
          className={`caption-width ${props.captionSelected ? "shown" : ""}`}
          style={{ left: c.cx - wrapW / 2, top: c.box.y, width: wrapW, height: c.box.h }}
        >
          {(["l", "r"] as const).map((side) => (
            <div
              key={side}
              className={`caption-edge ${side}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                const origin = (
                  e.currentTarget.closest(".preview-stage") as HTMLElement
                ).getBoundingClientRect();
                const key = `drag-caption-width-${Date.now()}`;
                const move = (ev: PointerEvent) => {
                  let half = Math.abs(ev.clientX - origin.left - c.cx);
                  let gx: number | null = null;
                  if (!ev.altKey) {
                    // 録画の左右の辺と、画面の左右の辺に吸着する
                    for (const x of [videoBox.x, videoBox.x + videoBox.w, 0, size.w]) {
                      const h = Math.abs(x - c.cx);
                      if (Math.abs(h - half) <= SNAP) {
                        half = h;
                        gx = c.cx + (ev.clientX - origin.left < c.cx ? -h : h);
                        break;
                      }
                    }
                  }
                  setCaptionGuides({ x: gx, y: null });
                  const w = Math.min(1, Math.max(0.1, (half * 2) / size.w));
                  props.onCaptionWidth(Math.round(w * 10000) / 10000, key);
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                  setCaptionGuides({ x: null, y: null });
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          ))}
        </div>
      );
      // PowerPoint と同じく、枠(文字の外側の縁)のクリックで枠を選び、文字のクリックで入力を始める。どちらもドラッグなら移動
      const style = resolveCaptionStyle(props.project, cs);
      const fontPx = style.size * (size.h / 1080);
      const pad = fontPx * 0.4;
      const editing = props.captionEditing;
      // 入力中は折り返す幅いっぱいの入力欄を出す(キャンバスのテロップは描かない)
      const textRect = editing ? { x: c.cx - wrapW / 2 - pad, w: wrapW + pad * 2, h: c.box.h } : c.box;
      /** 押してからドラッグならテロップを動かし、動かさずに離したら onClick */
      const dragOrClick = (e: React.PointerEvent, onClick: () => void) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const key = `drag-caption-${Date.now()}`;
        const halfH = c.box.h / 2;
        const below = videoBox.y + videoBox.h;
        let moved = false;
        const move = (ev: PointerEvent) => {
          if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < CLICK_PX) return;
          moved = true;
          let cx = c.cx + ev.clientX - x0;
          let cy = c.cy + ev.clientY - y0;
          let gx: number | null = null;
          let gy: number | null = null;
          if (!ev.altKey) {
            // 左右の中央、録画の下の余白の中央、録画の下辺(テロップの上辺)、画面の下辺(テロップの下辺)に吸着する
            if (Math.abs(cx - size.w / 2) <= SNAP) {
              cx = size.w / 2;
              gx = cx;
            }
            const cands = [
              { center: (below + size.h) / 2, line: (below + size.h) / 2 },
              { center: below + halfH, line: below },
              { center: size.h - halfH, line: size.h - 1 },
            ]
              .filter((x) => below < size.h || x.line !== (below + size.h) / 2)
              .map((x) => ({ ...x, d: Math.abs(x.center - cy) }))
              .filter((x) => x.d <= SNAP)
              .sort((a, b) => a.d - b.d);
            const best = cands[0];
            if (best) {
              cy = best.center;
              gy = best.line;
            }
          }
          setCaptionGuides({ x: gx, y: gy });
          const r4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
          props.onCaptionMove({ x: r4(cx / size.w), y: r4(cy / size.h) }, key);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          setCaptionGuides({ x: null, y: null });
          if (!moved) onClick();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };
      captionHandle = (
        <>
          <div
            className={`caption-box ${editing ? "editing" : props.captionSelected ? "selected" : ""}`}
            style={{ left: textRect.x - CAPTION_FRAME, top: c.cy, width: textRect.w + CAPTION_FRAME * 2 }}
            onPointerDown={(e) => dragOrClick(e, props.onCaptionClick)}
          >
            {editing ? (
              <CaptionInput
                value={cs.caption?.text ?? ""}
                placeholder={t("captionPlaceholder")}
                style={{
                  font: captionFont(style.font, fontPx),
                  lineHeight: `${c.lineH}px`,
                  color: style.color,
                  textAlign: style.align === "left" ? "left" : "center",
                  padding: `${pad / 2}px ${pad}px`,
                  background: c.boxColor ?? "transparent",
                  minHeight: textRect.h,
                }}
                onChange={props.onCaptionText}
                onEnd={props.onCaptionEditEnd}
              />
            ) : (
              <div
                className="caption-text"
                style={{ height: textRect.h }}
                title={t("tipCaption")}
                onPointerDown={(e) => dragOrClick(e, props.onCaptionEdit)}
              />
            )}
          </div>
          {widthFrame}
        </>
      );
    }
  }

  return (
    <div className="preview" ref={outerRef}>
      <div
        className="preview-scroll"
        ref={wrapRef}
        // 全体表示では映像の高さにして、操作の帯を映像の真下に置く。拡大中は置ける高さいっぱいに広げる
        style={{ height: viewZoom === 1 ? size.h : availH }}
        onPointerDown={panFrom}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用 */}
        <div
          className="preview-stage"
          style={{ width: size.w, height: size.h }}
          onPointerDown={(e) => {
            if (e.button !== 0 || d) return;
            const p = toStage(e, e.currentTarget);
            if (props.onPickObject?.(p, size)) return;
            const v = videoBox;
            props.onVideoClick(p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h);
          }}
          onDoubleClick={(e) => {
            if (d) return;
            const p = toStage(e, e.currentTarget);
            const v = videoBox;
            if (p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h) props.onEmptyDoubleClick();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const p = toStage(e, e.currentTarget);
            props.onContextMenu(e.clientX, e.clientY, { x: p.x * k, y: p.y * k });
          }}
        >
          <canvas ref={canvasRef} width={pxW} height={pxH} style={{ width: size.w, height: size.h }} />
          {captionHandle}
          {!d && !props.videoEdit && props.objects?.(size)}
          {editor}
          {captionGuides.x !== null && <div className="guide v" style={{ left: captionGuides.x }} />}
          {captionGuides.y !== null && <div className="guide h" style={{ top: captionGuides.y }} />}
        </div>
      </div>
      <div className="preview-tools" style={{ width: fitSize.w, height: TOOLS_H }}>
        {props.tools}
      </div>
    </div>
  );
}

/** プレビューの真下の操作の帯の高さ(px)。編集を始めても映像の大きさが変わらないよう、常に確保する */
const TOOLS_H = 34;
/** テロップの枠(文字の外側の縁)の幅(px。CSS の padding 6px と線 1px)。ここを押すと枠を選ぶ・動かす */
const CAPTION_FRAME = 7;

/** プレビュー上のテロップの文字の入力欄。出したときにフォーカスし、文の末尾にカーソルを置く */
function CaptionInput(props: {
  value: string;
  placeholder: string;
  style: React.CSSProperties;
  onChange: (text: string) => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="caption-input"
      aria-label={props.placeholder}
      value={props.value}
      placeholder={props.placeholder}
      style={props.style}
      // 入力欄の中のドラッグは文字の選択にする(枠の移動にしない)
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={props.onEnd}
    />
  );
}

type Box = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
type Mode = "move" | "draw" | Handle;
export type Anchor = "center" | "corner";
const SNAP = 12;
const MIN = 8;
/** クリックとみなす移動量(px) */
const CLICK_PX = 3;

/** 取っ手の向き。hx は左 -1・右 +1、hy は上 -1・下 +1 */
const HANDLE_DIR: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  ne: [1, -1],
  sw: [-1, 1],
  se: [1, 1],
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** 値 v に最も近い吸着先(SNAP 以内)。なければ null */
function nearest(v: number, targets: number[]): number | null {
  let best: number | null = null;
  for (const t of targets)
    if (Math.abs(t - v) <= SNAP && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best;
}

/**
 * 画面上の枠の編集(ズームの範囲・録画の配置で共通)。
 * 枠の中のドラッグで移動、四隅は縦横比を保ったまま拡大縮小、四辺の中央は縦横比を変える。
 * anchor が center なら中心を固定、corner なら反対側の角・辺を固定する。
 * snapX / snapY は枠の中心、edgeX / edgeY は枠の辺を吸着させる線。吸着中はガイド線を出す。Alt で吸着しない。
 * 枠の外をクリック(ドラッグなし)すると onCommit を呼ぶ。
 */
export function BoxEditor(props: {
  box: Box | null;
  /** 実際に見える範囲(ズーム)。薄い線で示す */
  visible?: Box | null;
  /** すべての枠(移動するズーム)。current 以外を点線で示し、中心どうしを線でつなぐ */
  ghosts?: Box[];
  current?: number;
  onPick?: (i: number) => void;
  allowDraw?: boolean;
  /** 新しく描くとき・移動するときに収める範囲。移動では大きさを変えず、範囲の内側だけを動かす */
  bounds?: Box;
  anchor: Anchor;
  snapX: number[];
  snapY: number[];
  edgeX: number[];
  edgeY: number[];
  /** move は枠ごとの移動(大きさは変わらない) */
  onChange: (b: Box, key: string, shapeChanged: boolean, move: boolean) => void;
  onCommit?: () => void;
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
    const cx0 = b0.x + b0.w / 2;
    const cy0 = b0.y + b0.h / 2;
    const key = `drag-box-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = { x: ev.clientX - origin.left, y: ev.clientY - origin.top };
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < CLICK_PX) return;
      moved = true;
      const free = ev.altKey;
      let b: Box;
      let gx: number | null = null;
      let gy: number | null = null;
      if (mode === "move") {
        b = { ...b0, x: b0.x + p.x - p0.x, y: b0.y + p.y - p0.y };
        if (!free) {
          // 中心を中心線へ、辺を辺の線へ。いちばん近いものに吸着する
          const pick = (lo: number, size: number, centers: number[], edges: number[]) => {
            const cands: { d: number; at: number }[] = [];
            const c = nearest(lo + size / 2, centers);
            if (c !== null) cands.push({ d: c - (lo + size / 2), at: c });
            const l = nearest(lo, edges);
            if (l !== null) cands.push({ d: l - lo, at: l });
            const r = nearest(lo + size, edges);
            if (r !== null) cands.push({ d: r - (lo + size), at: r });
            cands.sort((a, z) => Math.abs(a.d) - Math.abs(z.d));
            return cands[0] ?? null;
          };
          const sx = pick(b.x, b.w, props.snapX, props.edgeX);
          const sy = pick(b.y, b.h, props.snapY, props.edgeY);
          if (sx) {
            b.x += sx.d;
            gx = sx.at;
          }
          if (sy) {
            b.y += sy.d;
            gy = sy.at;
          }
        }
        if (props.bounds) {
          const B = props.bounds;
          b.x = Math.max(B.x, Math.min(b.x, B.x + B.w - b.w));
          b.y = Math.max(B.y, Math.min(b.y, B.y + B.h - b.h));
        }
      } else if (mode === "draw") {
        // 新しく描く: 押した点と今の点を対角にする
        b = {
          x: Math.min(p0.x, p.x),
          y: Math.min(p0.y, p.y),
          w: Math.max(MIN, Math.abs(p.x - p0.x)),
          h: Math.max(MIN, Math.abs(p.y - p0.y)),
        };
        if (props.bounds) {
          const B = props.bounds;
          b.x = Math.min(Math.max(b.x, B.x), B.x + B.w - b.w);
          b.y = Math.min(Math.max(b.y, B.y), B.y + B.h - b.h);
        }
      } else {
        const [hx, hy] = HANDLE_DIR[mode];
        const center = props.anchor === "center";
        const locked = hx !== 0 && hy !== 0;
        // 固定する点(中心固定なら中心、隅固定なら反対側の辺)
        const fx = center ? cx0 : hx > 0 ? b0.x : b0.x + b0.w;
        const fy = center ? cy0 : hy > 0 ? b0.y : b0.y + b0.h;
        const span = (pv: number, f: number, dir: number) =>
          Math.max(MIN, center ? Math.abs(pv - f) * 2 : dir * (pv - f));
        let w = b0.w;
        let h = b0.h;
        if (locked) {
          const k = Math.max(span(p.x, fx, hx) / b0.w, span(p.y, fy, hy) / b0.h);
          w = Math.max(MIN, b0.w * k);
          h = (w * b0.h) / b0.w;
        } else if (hx !== 0) w = span(p.x, fx, hx);
        else h = span(p.y, fy, hy);
        const build = (bw: number, bh: number): Box => ({
          x: center ? cx0 - bw / 2 : hx > 0 ? fx : hx < 0 ? fx - bw : b0.x,
          y: center ? cy0 - bh / 2 : hy > 0 ? fy : hy < 0 ? fy - bh : b0.y,
          w: bw,
          h: bh,
        });
        b = build(w, h);
        if (!free) {
          // 動く辺を辺の線へ吸着させる。中心固定なら反対側の辺も同じだけ動く
          const cands: { d: number; w: number; h: number; gx: number | null; gy: number | null }[] = [];
          const factor = center ? 2 : 1;
          if (hx !== 0 || (center && locked)) {
            for (const side of center ? [-1, 1] : [hx]) {
              const ex = side < 0 ? b.x : b.x + b.w;
              const t = nearest(ex, props.edgeX);
              if (t === null) continue;
              const nw = Math.max(MIN, w + (t - ex) * side * factor);
              cands.push({ d: Math.abs(t - ex), w: nw, h: locked ? (nw * b0.h) / b0.w : h, gx: t, gy: null });
            }
          }
          if (hy !== 0 || (center && locked)) {
            for (const side of center ? [-1, 1] : [hy]) {
              const ey = side < 0 ? b.y : b.y + b.h;
              const t = nearest(ey, props.edgeY);
              if (t === null) continue;
              const nh = Math.max(MIN, h + (t - ey) * side * factor);
              cands.push({ d: Math.abs(t - ey), w: locked ? (nh * b0.w) / b0.h : w, h: nh, gx: null, gy: t });
            }
          }
          cands.sort((a, z) => a.d - z.d);
          const c = cands[0];
          if (c) {
            b = build(c.w, c.h);
            gx = c.gx;
            gy = c.gy;
          }
        }
      }
      setGuides({ x: gx, y: gy });
      if (mode === "draw") setPreview(b);
      else
        props.onChange(
          b,
          key,
          mode !== "move" && !(HANDLE_DIR[mode][0] !== 0 && HANDLE_DIR[mode][1] !== 0),
          mode === "move",
        );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: null, y: null });
      // 枠の外をクリックしただけなら確定
      if (!moved && mode === "draw") {
        props.onCommit?.();
        return;
      }
      setPreview((pv) => {
        if (pv) props.onChange(pv, key, true, false);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const b = preview ?? props.box;
  const v = preview ? null : props.visible;
  const ghosts = props.ghosts ?? [];
  return (
    <div
      className={`box-layer ${props.allowDraw ? "draw-layer" : ""}`}
      onPointerDown={props.allowDraw ? (e) => begin(e, "draw") : undefined}
      title={props.allowDraw ? t("tipBoxDraw") : undefined}
    >
      {ghosts.length > 1 && (
        <svg className="box-path" aria-hidden="true">
          <polyline
            points={ghosts
              .map((g, i) => {
                const c = i === props.current && b ? b : g;
                return `${c.x + c.w / 2},${c.y + c.h / 2}`;
              })
              .join(" ")}
          />
        </svg>
      )}
      {ghosts.map((g, i) =>
        i === props.current ? null : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: 枠は時刻の順の番号で区別する
            key={i}
            className="box-ghost"
            style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            title={`${i + 1}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              props.onPick?.(i);
            }}
          >
            <span>{i + 1}</span>
          </div>
        ),
      )}
      {v && <div className="box-visible" style={{ left: v.x, top: v.y, width: v.w, height: v.h }} />}
      {b && (
        <div
          className="box-outline"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
          onPointerDown={(e) => begin(e, "move")}
          title={t("tipBoxMove")}
        >
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <div
              key={c}
              className={`box-handle ${c}`}
              title={t("tipBoxCorner")}
              onPointerDown={(e) => begin(e, c)}
            />
          ))}
          {(["n", "s", "e", "w"] as const).map((c) => (
            <div
              key={c}
              className={`box-handle edge ${c}`}
              title={t("tipBoxEdge")}
              onPointerDown={(e) => begin(e, c)}
            />
          ))}
        </div>
      )}
      {guides.x !== null && <div className="guide v" style={{ left: guides.x }} />}
      {guides.y !== null && <div className="guide h" style={{ top: guides.y }} />}
    </div>
  );
}
