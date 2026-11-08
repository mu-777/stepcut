// 左端のサムネイル列。いちばん上の「全体」で全体の設定、サムネイルでそのステップの詳細を開く。
// ステップの一覧の代わり。列が広ければサムネイルの横にテロップの文を出し、狭ければサムネイルだけにする。
// 文が隠れている・切れているときは、マウスを重ねると横に全文を出す。

import { useState } from "react";
import { sourceTimeAt, type TimelineEntry } from "../../core/timeline";
import { t } from "./i18n";
import { Icon } from "./icons";
import type { SourceMedia } from "./media";
import { quantize, type ThumbCache } from "./thumbs";
import { ThumbTile } from "./timeline";

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
}) {
  /** マウスを重ねたサムネイルと、その位置(テロップの文を横に出す) */
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const tipEntry = tip ? props.timeline[tip.i] : undefined;
  return (
    <nav className="step-rail" aria-label={t("steps")}>
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
      <ol className="rail-thumbs" onScroll={() => setTip(null)}>
        {props.timeline.map((e) => {
          const m = props.media.get(e.step.source);
          // ステップの頭から少し進んだところ(フェードや操作前の静止を避ける)
          const src = sourceTimeAt(e.step, Math.min(1, e.duration / 2));
          const thumb = m
            ? (props.thumbs.get(m, quantize(src, 0.5)) ?? props.thumbs.nearest(m, src, 1))
            : null;
          const on = !props.projectOpen && props.target === e.index;
          return (
            <li key={`${e.index}-${e.step.id}`}>
              <button
                type="button"
                className={`rail-thumb ${on ? "on" : ""} ${props.playhead === e.index ? "playhead" : ""}`}
                aria-current={on ? "true" : undefined}
                aria-label={`${e.index + 1}. ${e.step.caption?.text || e.step.id}`}
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
                    {e.step.id} · {e.duration.toFixed(1)}s
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
      <button type="button" className="rail-add" title={t("addRecording")} onClick={props.onAdd}>
        ＋
      </button>
      {tipEntry && tip && (
        <div className="rail-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <span className="rail-tip-id">
            {tip.i + 1}. {tipEntry.step.id} · {tipEntry.duration.toFixed(1)}s
          </span>
          {tipEntry.step.caption?.text || t("noCaption")}
        </div>
      )}
    </nav>
  );
}
