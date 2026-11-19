// 左端のサムネイル列。いちばん上の「全体」で全体の設定、サムネイルでそのステップの詳細を開く。
// ステップの一覧の代わり。列が広ければサムネイルの横にテロップの文を出し、狭ければサムネイルだけにする。
// 文が隠れている・切れているときは、マウスを重ねると横に全文を出す。mp4 を列にドロップすると録画を足す。

import { useState } from "react";
import { sourceTimeAt, type TimelineEntry } from "../../core/timeline";
import { t } from "./i18n";
import { Icon } from "./icons";
import type { SourceMedia } from "./media";
import { quantize, type ThumbCache } from "./thumbs";
import { ThumbTile } from "./timeline";

/** ステップの並べ替えのドラッグで運ぶデータの種類(ファイルのドロップと区別する) */
const STEP_DRAG = "application/x-stepcut-step";

export function StepRail(props: {
  timeline: TimelineEntry[];
  media: Map<string, SourceMedia>;
  thumbs: ThumbCache;
  /** サムネイルが届いたら増える(描き直すため) */
  thumbsVersion: number;
  /** 全体の設定を開いている */
  projectOpen: boolean;
  /** 設定パネルで直しているステップ */
  target: number | null;
  /** 再生位置のステップ */
  playhead: number | null;
  onProject: () => void;
  onStep: (i: number) => void;
  onStepMenu: (e: React.MouseEvent, i: number) => void;
  onAdd: () => void;
  /** サムネイルのドラッグでステップ from を to 番目へ動かす */
  onMove: (from: number, to: number) => void;
  /** 列にファイルをドロップした(録画の追加) */
  onDropFiles: (files: File[]) => void;
}) {
  /** マウスを重ねたサムネイルと、その位置(テロップの文を横に出す) */
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const tipEntry = tip ? props.timeline[tip.i] : undefined;
  /** ファイルを列の上にドラッグしている */
  const [dropping, setDropping] = useState(false);
  const empty = props.timeline.length === 0;
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  /** 並べ替えでドラッグしているステップと、落とす位置(その番号のステップの前。末尾は長さ) */
  const [moving, setMoving] = useState<{ from: number; at: number | null } | null>(null);
  const isStepDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(STEP_DRAG);
  /** マウスの位置から落とす位置を決める(サムネイルの上半分なら前、下半分なら後ろ) */
  const dropIndex = (e: React.DragEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  };
  /** 動かした後の番号(元の位置を抜いてから入れる) */
  const moveTarget = (from: number, at: number) => (at > from ? at - 1 : at);
  return (
    <nav
      className={`step-rail ${dropping ? "dropping" : ""} ${empty ? "empty" : ""}`}
      aria-label={t("steps")}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        // 列の中の子要素へ移っただけなら消さない
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        props.onDropFiles([...e.dataTransfer.files]);
      }}
    >
      <button
        type="button"
        className={`rail-project ${props.projectOpen ? "on" : ""}`}
        aria-pressed={props.projectOpen}
        title={t("panelProjectTip")}
        onClick={props.onProject}
      >
        <Icon name="panelProject" />
        <span>{t("panelProject")}</span>
      </button>
      <ol
        className="rail-thumbs"
        onScroll={() => setTip(null)}
        onDragOver={(e) => {
          if (!moving || !isStepDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(e) => {
          if (moving && !e.currentTarget.contains(e.relatedTarget as Node | null))
            setMoving({ ...moving, at: null });
        }}
        onDrop={(e) => {
          if (!moving || !isStepDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          const { from, at } = moving;
          setMoving(null);
          if (at === null) return;
          const to = moveTarget(from, at);
          if (to !== from) props.onMove(from, to);
        }}
      >
        {props.timeline.map((e) => {
          const m = props.media.get(e.step.source);
          // ステップの頭から少し進んだところ(フェードや操作前の静止を避ける)
          const src = sourceTimeAt(e.step, Math.min(1, e.duration / 2));
          const thumb = m
            ? (props.thumbs.get(m, quantize(src, 0.5)) ?? props.thumbs.nearest(m, src, 1))
            : null;
          const on = !props.projectOpen && props.target === e.index;
          const dropCls =
            moving && moving.at !== null && moveTarget(moving.from, moving.at) !== moving.from
              ? moving.at === e.index
                ? "drop-before"
                : moving.at === e.index + 1 && e.index === props.timeline.length - 1
                  ? "drop-after"
                  : ""
              : "";
          return (
            <li
              key={`${e.index}-${e.step.id}`}
              className={dropCls}
              onDragOver={(ev) => {
                if (!moving || !isStepDrag(ev)) return;
                ev.preventDefault();
                const at = dropIndex(ev, e.index);
                if (at !== moving.at) setMoving({ ...moving, at });
              }}
            >
              <button
                type="button"
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(STEP_DRAG, String(e.index));
                  ev.dataTransfer.effectAllowed = "move";
                  setTip(null);
                  setMoving({ from: e.index, at: null });
                }}
                onDragEnd={() => setMoving(null)}
                className={`rail-thumb ${on ? "on" : ""} ${props.playhead === e.index ? "playhead" : ""} ${moving?.from === e.index ? "moving" : ""}`}
                aria-current={on ? "true" : undefined}
                aria-label={`${t("step")} ${e.index + 1}. ${e.step.caption?.text || t("noCaption")}`}
                onClick={() => props.onStep(e.index)}
                onContextMenu={(ev) => props.onStepMenu(ev, e.index)}
                onPointerEnter={(ev) => {
                  const text = ev.currentTarget.querySelector<HTMLElement>(".rail-caption");
                  // 文が全部見えていれば出さない
                  if (text && text.offsetParent !== null && text.scrollHeight <= text.clientHeight) return;
                  const r = ev.currentTarget.getBoundingClientRect();
                  setTip({ i: e.index, x: r.right + 8, y: r.top + r.height / 2 });
                }}
                onPointerLeave={() => setTip(null)}
              >
                <span className="rail-pic">
                  <ThumbTile thumb={thumb} />
                  <span className="rail-num">{e.index + 1}</span>
                </span>
                <span className="rail-text">
                  <span className="rail-meta">
                    {t("step")} {e.index + 1} · {e.duration.toFixed(1)}s
                  </span>
                  <span className={`rail-caption ${e.step.caption?.text ? "" : "muted"}`}>
                    {e.step.caption?.text || t("noCaption")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {/* 録画がないときは「全体」より下を埋める大きなボタン、あるときは「全体」と同じ形のボタン。どちらも文字を添える */}
      <button
        type="button"
        className="rail-add"
        title={`${t("addRecording")} (${t("dropHint")})`}
        aria-label={t("addRecording")}
        onClick={props.onAdd}
      >
        <span className="rail-add-plus">＋</span>
        <span className="rail-add-label">{t("addRecordingShort")}</span>
      </button>
      {tipEntry && tip && (
        <div className="rail-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <span className="rail-tip-id">
            {t("step")} {tip.i + 1} · {tipEntry.duration.toFixed(1)}s
          </span>
          {tipEntry.step.caption?.text || t("noCaption")}
        </div>
      )}
    </nav>
  );
}
