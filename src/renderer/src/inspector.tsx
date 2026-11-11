// 右の設定パネル。全体の設定と、ステップの詳細(録画・速度 / 文 / ズーム)。

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  CAPTION_BOX_COLOR,
  captionBoxColor,
  DEFAULT_BACKGROUND,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_WIDTH,
  DEFAULT_MARGIN,
  DEFAULT_SOLID_BACKGROUND,
  hasStepLayout,
  isImageSource,
  type ResolvedLayout,
  resolveAudio,
  resolveCaptionStyle,
  resolveLayout,
  resolveOutput,
  speechPieces,
  speechSynced,
  speechText,
  withSpeechPieces,
  zoomHoldMode,
  zoomTransition,
} from "../../core/defaults";
import { clearStepLayout, makeStepLayoutCommon, setStepLayout } from "../../core/edit";
import {
  computeLayout,
  type Rect,
  rectScale,
  resetRectAspect,
  retimeZoom,
  setZoomKeyRect,
  sortedKeys,
  zoomScale,
} from "../../core/layout";
import { type ObjectRef, shapeOutsideVideo, stepObjects } from "../../core/objects";
import type { Background, Margin, Project, SpeechPiece, Step, Zoom, ZoomKey } from "../../core/schema";
import { speechTimes, videoDuration } from "../../core/timeline";
import type { SpeechEngineSettings, Voice } from "../../shared/api";
import { api } from "./api";
import { drawPresetThumb, PRESETS } from "./backgrounds";
import {
  CheckField,
  Field,
  FontField,
  NumField,
  prune,
  SegField,
  SelectField,
  TextField,
  withParam,
} from "./fields";
import { t } from "./i18n";
import { withKey } from "./keymap";
import { ObjectDefaults, ObjectsList } from "./object-panel";
import type { NewObjectKind } from "./objects-ui";
import type { Selection } from "./timeline";
import { loadChoice, saveChoice } from "./widgets";

type Update = (fn: (p: Project) => Project, key?: string) => void;

function patchStep(update: Update, index: number, key: string) {
  return (fn: (s: Step) => Step) =>
    update((p) => ({ ...p, steps: p.steps.map((s, i) => (i === index ? fn(s) : s)) }), `step${index}.${key}`);
}

/** 選べる読み上げエンジン。os 以外はユーザーがアプリの設定で有効にしたときだけ選べる */
const SPEECH_ENGINES = ["os", "voicevox", "azure"] as const;
const ENGINE_LABEL = { os: "engineOs", voicevox: "engineVoicevox", azure: "engineAzure" } as const;

function VoiceSelect(props: {
  label: string;
  voices: Voice[];
  value: string | null | undefined;
  emptyLabel: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={props.label}>
      <select value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value || undefined)}>
        <option value="">{props.emptyLabel}</option>
        {props.voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.language})
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * 設定パネルに出すもの。左のサムネイル列の「全体」か、ステップ(サムネイル)を選んで切り替える
 * (docs/decisions/20261108-step-drilldown-ui.md)
 */
export type PanelView = "project" | "step";

/** 選んだ要素を直す画面。プロジェクトを選んだだけ(Esc・削除の後など)では切り替えない */
export function viewOf(s: Selection): PanelView | null {
  if (s.kind === "video") return "step";
  if (s.kind === "project") return null;
  return "step";
}

/** 選んだ要素を直す欄の id。この欄だけを開き、ほかの欄を閉じる */
export function foldOf(s: Selection): string | null {
  if (s.kind === "video") return "frame";
  if (s.kind === "caption" || s.kind === "speech") return "text";
  if (s.kind === "zoom") return "zoom";
  if (s.kind === "hold") return "recording";
  if (s.kind === "pointer" || s.kind === "shape") return "objects";
  return null;
}

/**
 * 欄の開閉をまとめて変える指示(すべて閉じる・選んだ要素の欄だけ開く)。seq が変わるたびに 1 回だけ効く。
 * 欄ごとの開閉はそのあと手で変えられ、覚えておく
 */
export interface FoldCommand {
  seq: number;
  open: (id: string) => boolean;
}
export const FoldCommandContext = createContext<FoldCommand | null>(null);
/** 欄ごとに、最後に従った指示の seq(画面を切り替えて欄を作り直しても、同じ指示を当て直さない) */
const appliedFold = new Map<string, number>();

/** 開け閉めできる欄。開閉はステップをまたいで覚える。FoldCommandContext の指示でまとめて開け閉めする */
function Fold(props: {
  id: string;
  title: string;
  summary?: string;
  /** 開閉を覚えていないときに開くか */
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const cmd = useContext(FoldCommandContext);
  const [open, setOpen] = useState(
    () =>
      loadChoice(`fold.${props.id}`, ["open", "closed"] as const, props.defaultOpen ? "open" : "closed") ===
      "open",
  );
  useEffect(() => {
    if (!cmd || appliedFold.get(props.id) === cmd.seq) return;
    appliedFold.set(props.id, cmd.seq);
    setOpen(cmd.open(props.id));
  }, [cmd, props.id]);
  useEffect(() => saveChoice(`fold.${props.id}`, open ? "open" : "closed"), [props.id, open]);
  return (
    <section className={`fold ${open ? "open" : ""}`}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="fold-chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="fold-title">{props.title}</span>
        {!open && props.summary && <span className="fold-summary">{props.summary}</span>}
      </button>
      {open && <div className="fold-body">{props.children}</div>}
    </section>
  );
}

/**
 * 「録画・速度」の見出しに添える長さ。保持(ズーム中に止める・置いた保持・読み上げ待ち)で伸びているときは、
 * 左の列・タイムラインと同じ伸びた後の長さを出し、保持の分を添える
 */
function recordingSummary(step: Step, stepDuration: number): string {
  const speed = step.speed ?? 1;
  const speedText = speed > 1 ? ` ×${speed}` : "";
  const held = stepDuration - videoDuration(step);
  if (held < 0.05) return `${(step.out - step.in).toFixed(1)}s${speedText}`;
  return `${stepDuration.toFixed(1)}s${speedText}(${t("holdIncluded").replace("{sec}", held.toFixed(1))})`;
}

/** ステップの詳細: 録画・速度 / 文(テロップと読み上げ)/ ズーム を開け閉めできる欄で並べる */
export function StepDetail(props: {
  project: Project;
  index: number;
  update: Update;
  voices: Voice[];
  focus: Selection;
  playheadLocal: number;
  speechStatus: { error: string | null; pending: boolean; durations: number[] } | null;
  speechPlaying: boolean;
  onPreviewSpeech: () => void;
  /** 共通の設定(全体の画面)へ移る */
  onGoShared: () => void;
  drawing: { step: number; zoom: number; key: number } | null;
  onDrawZoom: (step: number, zoomIndex: number, key?: number) => void;
  syncSize: boolean;
  onAddZoom: () => void;
  /** ズームを選ぶ。null で選択を外す(ステップを選んだ状態に戻す) */
  onSelectZoom: (zoom: number | null) => void;
  srcSizeOf: (step: number) => { w: number; h: number } | null;
  /** ステップの出力上の長さ(オブジェクトの終わりの既定) */
  stepDuration: number;
  onSelectObject: (ref: ObjectRef | null) => void;
  onAddObject: (kind: NewObjectKind) => void;
  /** 図形の座標の基準を変える(見えている位置を保つ) */
  onShapeAnchor: (index: number, anchor: "video" | "screen") => void;
  imageSize: (path: string) => { w: number; h: number } | null;
  /** 画像を読み込んで大きさを返す(読めなければ null) */
  loadImage: (path: string) => Promise<{ w: number; h: number } | null>;
  imageError: (path: string) => string | null;
  /** 時刻を直したら再生位置をそこへ移す(ステップ index 内の時刻) */
  onSeekLocal: (step: number, local: number) => void;
}) {
  const { project, index, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const mine = "step" in focus && focus.step === index;
  const zooms = step.zooms ?? [];
  const selZoom = mine && focus.kind === "zoom" ? focus.index : null;
  const speed = step.speed ?? 1;
  return (
    <div className="inspector">
      <Fold
        id="recording"
        title={t("sectionRecording")}
        summary={recordingSummary(step, props.stepDuration)}
        defaultOpen={false}
      >
        <StepRecording {...props} />
      </Fold>
      <Fold
        id="frame"
        title={t("sectionFrame")}
        summary={t(hasStepLayout(step) ? "frameOwn" : "frameCommon")}
        defaultOpen={false}
      >
        <StepFrame project={project} index={index} update={props.update} focused={focus.kind === "video"} />
      </Fold>
      <Fold id="text" defaultOpen title={t("sectionText")} summary={step.caption?.text || "—"}>
        <StepText {...props} />
      </Fold>
      <Fold id="zoom" defaultOpen title={t("sectionZoom")} summary={String(zooms.length)}>
        {zooms.length === 0 && <p className="hint">{t("noZooms")}</p>}
        <ol className="item-list">
          {zooms.map((z, k) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ズームは id を持たない
            <li key={k} className={selZoom === k ? "open" : ""}>
              <button
                type="button"
                className={`item-button ${selZoom === k ? "selected" : ""}`}
                aria-expanded={selZoom === k}
                onClick={() => props.onSelectZoom(selZoom === k ? null : k)}
              >
                <span>
                  {t("sectionZoom")} {k + 1}
                </span>
                <span className="muted">
                  {fmtSec(z.start)} – {fmtSec(z.end)}
                  {z.keys.length > 1 ? ` · ${t("zoomKey")} ×${z.keys.length}` : ""}
                </span>
              </button>
              {selZoom === k && <ZoomSection {...props} k={k} />}
            </li>
          ))}
        </ol>
        <button type="button" onClick={props.onAddZoom}>
          ＋ {withKey(t("addZoom"), "addZoom")}
        </button>
      </Fold>
      <Fold
        id="objects"
        defaultOpen
        title={t("sectionObjects")}
        summary={`${stepObjects(step).length}${objectsOutside(step, props.srcSizeOf(index)) ? " ⚠" : ""}`}
      >
        <ObjectsList
          project={project}
          index={index}
          update={props.update}
          selected={
            mine && (focus.kind === "pointer" || focus.kind === "shape")
              ? { kind: focus.kind, index: focus.index }
              : null
          }
          stepDuration={props.stepDuration}
          srcSize={props.srcSizeOf(index)}
          onSeekLocal={(local) => props.onSeekLocal(index, local)}
          onSelect={props.onSelectObject}
          onAdd={props.onAddObject}
          onShapeAnchor={props.onShapeAnchor}
          imageSize={props.imageSize}
          loadImage={props.loadImage}
          imageError={props.imageError}
        />
      </Fold>
    </div>
  );
}

/** ステップの録画の区間・速度・録画の音・保持 */
function StepRecording(props: {
  project: Project;
  index: number;
  update: Update;
  /** タイムラインで選んだ要素。その欄を強調して見える位置へ動かす */
  focus: Selection;
  /** 再生位置(このステップ内の時刻)。保持を足す位置 */
  playheadLocal: number;
}) {
  const { project, index, update, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  const image = isImageSource(project.sources.find((s) => s.id === step.source)?.path ?? "");

  return (
    <>
      <Section focused={focus.kind === "step"}>
        {/* ステップの id はファイルの中だけで使う。画面では「ステップ N」(時間の順の番号)で呼ぶ */}
        <SelectField
          label={t("source")}
          value={step.source}
          options={project.sources.map((s) => ({ value: s.id, label: `${s.id} — ${s.path}` }))}
          onChange={(v) => set("source")((s) => ({ ...s, source: v }))}
        />
        {image ? (
          // 画像はどの時刻も同じ 1 枚。長さだけを決める(in は 0 にそろえる)
          <NumField
            label={t("stepLength")}
            value={Math.round(((step.out - step.in) / (step.speed ?? 1)) * 1000) / 1000}
            min={0.1}
            step={0.5}
            onChange={(v) =>
              set("length")((s) => ({ ...s, in: 0, out: Math.max(0.1, v ?? 0.1) * (s.speed ?? 1) }))
            }
          />
        ) : (
          <>
            <div className="row">
              <NumField
                label={t("in")}
                value={step.in}
                min={0}
                onChange={(v) => set("in")((s) => ({ ...s, in: v ?? 0 }))}
              />
              <NumField
                label={t("out")}
                value={step.out}
                min={0}
                onChange={(v) => set("out")((s) => ({ ...s, out: v ?? 0 }))}
              />
            </div>
            <NumField
              label={t("speed")}
              value={step.speed ?? 1}
              min={1}
              step={0.5}
              onChange={(v) =>
                set("speed")((s) => ({
                  ...s,
                  speed: v === undefined || v === 1 ? undefined : Math.max(1, v),
                }))
              }
            />
          </>
        )}
      </Section>

      {!image && <StepSourceAudio {...props} />}
      <StepFadeHolds {...props} />
    </>
  );
}

/** 録画の音声(画像のステップでは出さない) */
function StepSourceAudio(props: { project: Project; index: number; update: Update }) {
  const { project, index, update } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  const audio = step.audio ?? {};
  return (
    <>
      <h4>{t("sourceAudio")}</h4>
      <div className="row">
        <CheckField
          label={t("enabled")}
          value={resolveAudio(project, step).sourceEnabled}
          onChange={(v) =>
            set("audio.enabled")((s) => ({
              ...s,
              audio: { ...s.audio, source: { ...s.audio?.source, enabled: v } },
            }))
          }
        />
        <NumField
          label={t("volume")}
          value={audio.source?.volume}
          step={0.1}
          min={0}
          max={2}
          placeholder={String(project.audio?.source?.volume ?? 1)}
          onChange={(v) =>
            set("audio.volume")((s) => ({
              ...s,
              audio: prune({ ...s.audio, source: prune({ ...s.audio?.source, volume: v }) }),
            }))
          }
        />
      </div>
      {(step.speed ?? 1) > 1 && (
        <CheckField
          label={t("keepPitch")}
          value={resolveAudio(project, step).keepPitch}
          onChange={(v) =>
            set("audio.keepPitch")((s) => ({
              ...s,
              audio: prune({
                ...s.audio,
                source: prune({ ...s.audio?.source, keepPitch: v ? undefined : false }),
              }),
            }))
          }
        />
      )}
    </>
  );
}

/** フェードと保持 */
function StepFadeHolds(props: {
  project: Project;
  index: number;
  update: Update;
  focus: Selection;
  playheadLocal: number;
}) {
  const { project, index, update, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  return (
    <>
      <h4>{t("fade")}</h4>
      <div className="row">
        {(["fadeIn", "fadeOut"] as const).map((key) => (
          <NumField
            key={key}
            label={t(key)}
            value={step[key]}
            min={0}
            step={0.25}
            placeholder={t("none")}
            onChange={(v) => set(key)((s) => ({ ...s, [key]: v ? Math.min(v, 10) : undefined }))}
          />
        ))}
      </div>

      <h4>{t("holds")}</h4>
      {(step.holds ?? []).map((h, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 保持は id を持たない
        <Section key={k} focused={focus.kind === "hold" && focus.index === k}>
          <div className="row">
            <NumField
              label={t("at")}
              value={h.at}
              min={0}
              onChange={(v) =>
                set(`hold${k}.at`)((s) => ({
                  ...s,
                  holds: s.holds?.map((x, i) => (i === k ? { ...x, at: v ?? 0 } : x)),
                }))
              }
            />
            <NumField
              label={t("duration")}
              value={h.duration}
              min={0.1}
              onChange={(v) =>
                set(`hold${k}.duration`)((s) => ({
                  ...s,
                  holds: s.holds?.map((x, i) => (i === k ? { ...x, duration: v ?? 1 } : x)),
                }))
              }
            />
            <button
              type="button"
              className="small"
              onClick={() => set("holds")((s) => ({ ...s, holds: s.holds?.filter((_, i) => i !== k) }))}
            >
              {t("remove")}
            </button>
          </div>
        </Section>
      ))}
      <button
        type="button"
        onClick={() =>
          set("holds")((s) => ({
            ...s,
            holds: [
              ...(s.holds ?? []),
              { at: Math.round(props.playheadLocal * 1000) / 1000, duration: 1 },
            ].sort((a, b) => a.at - b.at),
          }))
        }
      >
        ＋ {t("addHold")}
      </button>
    </>
  );
}

/** このステップのテロップと読み上げ */
function StepText(props: {
  project: Project;
  index: number;
  update: Update;
  voices: Voice[];
  focus: Selection;
  /** 読み上げの生成の状況(失敗・生成中・読み上げごとの長さ) */
  speechStatus: { error: string | null; pending: boolean; durations: number[] } | null;
  /** このステップの読み上げを試聴中 */
  speechPlaying: boolean;
  onPreviewSpeech: () => void;
  onGoShared: () => void;
  onSeekLocal: (step: number, local: number) => void;
}) {
  const { project, index, update, voices, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  const caption = step.caption ?? { text: "" };
  const pieces = speechPieces(step);
  const synced = speechSynced(step);
  const status = props.speechStatus;
  const times = speechTimes(step, status?.durations ?? []);
  const style = resolveCaptionStyle(project, step);
  const projCap = project.styles?.caption;
  const overridden = caption.position !== undefined || caption.width !== undefined;

  const setCaption = (key: string, patch: Partial<NonNullable<Step["caption"]>>) =>
    set(`caption.${key}`)((s) => ({ ...s, caption: { ...(s.caption ?? { text: "" }), ...patch } }));
  // 読み上げ k を書き換える。最初の読み上げで text がなければテロップの文を読む。読み上げがなければ読まない
  /** 1 つ目の読み上げの文を消し、テロップの文を読むようにする */
  const followCaption = (s: Step) =>
    withSpeechPieces(
      s,
      speechPieces(s).map((x, j) => {
        if (j !== 0) return x;
        const { text: _t, ...rest } = x;
        return rest;
      }),
    );
  const setPiece = (k: number, key: string, patch: Partial<SpeechPiece>) =>
    set(`speech${k}.${key}`)((s) =>
      withSpeechPieces(
        s,
        speechPieces(s.speech ? s : { ...s, speech: {} }).map((p, j) =>
          j === k ? (prune({ ...p, ...patch }) ?? {}) : p,
        ),
      ),
    );

  return (
    <>
      <Section focused={focus.kind === "caption"}>
        <h4 className="first">{t("caption")}</h4>
        <TextField
          label={t("caption")}
          multiline
          value={caption.text}
          placeholder={t("captionPlaceholder")}
          onChange={(v) => setCaption("text", { text: v })}
        />
        <div className="row">
          <NumField
            label={t("captionStart")}
            value={caption.start}
            min={0}
            onChange={(v) => setCaption("start", { start: v })}
          />
          <NumField
            label={t("captionEnd")}
            value={caption.end}
            min={0}
            onChange={(v) => setCaption("end", { end: v })}
          />
        </div>
        <div className="row">
          <NumField
            label={t("captionSize")}
            value={caption.style?.size}
            placeholder={String(style.size)}
            step={2}
            onChange={(v) => setCaption("size", { style: prune({ ...caption.style, size: v }) })}
          />
          <SelectField
            label={t("captionBg")}
            value={
              caption.style?.background === undefined
                ? "inherit"
                : captionBoxColor(caption.style.background)
                  ? "on"
                  : "none"
            }
            options={[
              {
                value: "inherit",
                label: `${t("bgInherit")}(${t(captionBoxColor(style.background) && caption.style?.background === undefined ? "bgOn" : "bgNone")})`,
              },
              { value: "none", label: t("bgNone") },
              { value: "on", label: t("bgOn") },
            ]}
            onChange={(v) =>
              setCaption("bg", {
                style: prune({
                  ...caption.style,
                  background: v === "inherit" ? undefined : v === "none" ? "#00000000" : CAPTION_BOX_COLOR,
                }),
              })
            }
          />
        </div>
        <p className="field-label">
          {t("captionPlacement")}
          {overridden ? (
            <span className="badge">{t("overridden")}</span>
          ) : (
            <button
              type="button"
              className="badge link-badge"
              title={t("goSharedTip")}
              onClick={props.onGoShared}
            >
              {t("usingCommon")} ›
            </button>
          )}
        </p>
        <div className="row">
          <NumField
            label={t("captionX")}
            value={caption.position?.x}
            step={0.01}
            min={0}
            max={1}
            placeholder={projCap?.position ? String(projCap.position.x) : "auto"}
            onChange={(v) =>
              setCaption("x", {
                position:
                  v === undefined
                    ? undefined
                    : { x: v, y: caption.position?.y ?? projCap?.position?.y ?? 0.88 },
              })
            }
          />
          <NumField
            label={t("captionY")}
            value={caption.position?.y}
            step={0.01}
            min={0}
            max={1}
            placeholder={projCap?.position ? String(projCap.position.y) : "auto"}
            onChange={(v) =>
              setCaption("y", {
                position:
                  v === undefined
                    ? undefined
                    : { x: caption.position?.x ?? projCap?.position?.x ?? 0.5, y: v },
              })
            }
          />
          <NumField
            label={t("captionWidth")}
            value={caption.width}
            step={0.05}
            min={0.1}
            max={1}
            placeholder={String(projCap?.width ?? DEFAULT_CAPTION_WIDTH)}
            onChange={(v) => setCaption("width", { width: v })}
          />
        </div>
        {overridden && (
          <div className="row">
            <button
              type="button"
              className="small"
              title={t("useAsCommonHint")}
              onClick={() =>
                // この位置・幅を全ステップ共通にし、このステップの個別の値は消す
                update((p) => {
                  const st = p.steps[index];
                  if (!st?.caption) return p;
                  const { position, width, ...rest } = st.caption;
                  const cap = p.styles?.caption ?? {};
                  return {
                    ...p,
                    styles: {
                      ...p.styles,
                      caption: { ...cap, position: position ?? cap.position, width: width ?? cap.width },
                    },
                    steps: p.steps.map((s, i) => (i === index ? { ...s, caption: rest } : s)),
                  };
                }, `step${index}.caption.common`)
              }
            >
              {t("useAsCommon")}
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                set("caption.reset")((s) => {
                  if (!s.caption) return s;
                  const { position: _p, width: _w, ...rest } = s.caption;
                  return { ...s, caption: rest };
                })
              }
            >
              {t("resetToProject")}
            </button>
          </div>
        )}
      </Section>

      <h4>{t("speech")}</h4>
      {pieces.length > 1 && <p className="hint">{t("speechPieceHint")}</p>}
      {pieces.map((p, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 読み上げは id を持たない
        <Section key={k} focused={focus.kind === "speech" && focus.index === k}>
          {pieces.length > 1 && (
            <p className="field-label">
              {t("speech")} {k + 1}
            </p>
          )}
          {/* 1 つ目は、書き換えるまでテロップの文を読む(テロップを直すと読み上げも変わる)。
              書き換えたらその文を持ち、テロップと同じ文に戻したらまたテロップに合わせる */}
          <TextField
            label={t("speechText")}
            multiline
            value={speechSynced(step, k) ? caption.text : (p.text ?? "")}
            placeholder={t("speechPlaceholder")}
            onChange={(v) =>
              k === 0 && v === caption.text
                ? set("speech0.text")(followCaption)
                : setPiece(k, "text", { text: v })
            }
          />
          {k === 0 &&
            (synced ? (
              <p className="hint">{t("speechFollowsCaption")}</p>
            ) : (
              <button type="button" className="small" onClick={() => set("speech.sync")(followCaption)}>
                {t("speechResetToCaption")}
              </button>
            ))}
          <div className="row">
            <NumField
              label={t("speechStart")}
              value={p.start}
              min={0}
              placeholder={k === 0 ? "0" : `${t("speechAfterPrev")} (${(times[k]?.start ?? 0).toFixed(2)})`}
              onChange={(v) => {
                setPiece(k, "start", { start: v === 0 && k === 0 ? undefined : v });
                if (v !== undefined) props.onSeekLocal(index, v);
              }}
            />
            {status?.durations[k] ? <p className="hint">{status.durations[k]?.toFixed(2)} s</p> : null}
          </div>
          <div className="row">
            <VoiceSelect
              label={t("voice")}
              voices={voices}
              value={p.voice}
              emptyLabel={t("defaultVoice")}
              onChange={(v) => setPiece(k, "voice", { voice: v })}
            />
            <NumField
              label={t("rate")}
              value={typeof p.params?.rate === "number" ? p.params.rate : undefined}
              step={0.1}
              min={0.5}
              max={3}
              placeholder={t("defaultVoice")}
              onChange={(v) => setPiece(k, "rate", { params: withParam(p.params, "rate", v) })}
            />
          </div>
          {pieces.length > 1 && (
            <button
              type="button"
              className="small"
              onClick={() =>
                set("speech.remove")((s) =>
                  withSpeechPieces(
                    s,
                    speechPieces(s).filter((_, j) => j !== k),
                  ),
                )
              }
            >
              {t("remove")}
            </button>
          )}
        </Section>
      ))}
      <div className="row">
        <button
          type="button"
          onClick={props.onPreviewSpeech}
          // 生成中は押せない。試聴中は「読み上げを終了」
          disabled={!props.speechPlaying && (status?.pending || !pieces.some((_, k) => speechText(step, k)))}
        >
          {props.speechPlaying
            ? `■ ${t("stopSpeech")}`
            : status?.pending
              ? t("speechPending")
              : `▶ ${t("previewSpeech")}`}
        </button>
        <button
          type="button"
          onClick={() =>
            set("speech.add")((s) => {
              const cur = speechPieces(s);
              // 1 つ目はテロップと同じ文を読む設定で作る。2 つ目からは文を書いてもらう
              return withSpeechPieces(s, [...cur, cur.length === 0 ? {} : { text: "" }]);
            })
          }
        >
          ＋ {t("addSpeech")}
        </button>
      </div>
      {status?.error && <p className="hint">⚠ {status.error}</p>}
    </>
  );
}

/** 全ステップ共通のテロップの見た目と位置、読み上げの声・音量・辞書 */
function TextDefaults(props: {
  project: Project;
  update: Update;
  voices: Voice[];
  focused: boolean;
  speechEngines: SpeechEngineSettings | null;
  voiceError: string | null;
  onOpenSettings: () => void;
}) {
  const { project, update, voices } = props;
  const engine = project.speech?.engine ?? "os";
  const enabled = (e: string) =>
    e === "os" ||
    (e === "voicevox" && !!props.speechEngines?.voicevox.enabled) ||
    (e === "azure" && !!props.speechEngines?.azure.enabled);
  const capStyle = project.styles?.caption ?? {};
  const set = <K extends keyof Project>(key: K, value: Project[K], coalesce?: string) =>
    update((p) => ({ ...p, [key]: value }), coalesce ?? String(key));
  const setCapPos = (pos: { x: number; y: number } | undefined, key: string) =>
    set("styles", prune({ ...project.styles, caption: prune({ ...capStyle, position: pos }) }), key);
  // テロップの位置・幅を個別に設定しているステップの数
  const overrides = project.steps.filter(
    (st) => st.caption?.position !== undefined || st.caption?.width !== undefined,
  ).length;

  return (
    <>
      <Fold id="p.caption" title={t("captionStyle")} defaultOpen>
        <Section focused={props.focused}>
          <FontField
            label={t("font")}
            value={capStyle.font}
            placeholder={`${t("defaultFont")} (${DEFAULT_CAPTION_STYLE.font})`}
            onChange={(v) =>
              set(
                "styles",
                prune({ ...project.styles, caption: prune({ ...capStyle, font: v }) }),
                "style.font",
              )
            }
          />
          <div className="row">
            <NumField
              label={t("size")}
              value={capStyle.size}
              placeholder="48"
              step={2}
              onChange={(v) =>
                set(
                  "styles",
                  prune({ ...project.styles, caption: prune({ ...capStyle, size: v }) }),
                  "style.size",
                )
              }
            />
            <Field label={t("color")}>
              <input
                type="color"
                value={(capStyle.color ?? "#FFFFFF").slice(0, 7)}
                onChange={(e) =>
                  set(
                    "styles",
                    { ...project.styles, caption: { ...capStyle, color: e.target.value.toUpperCase() } },
                    "style.color",
                  )
                }
              />
            </Field>
          </div>
          <SelectField
            label={t("captionBg")}
            value={captionBoxColor(capStyle.background ?? "auto") ? "on" : "none"}
            options={[
              { value: "none", label: t("bgNone") },
              { value: "on", label: t("bgOn") },
            ]}
            onChange={(v) =>
              set(
                "styles",
                prune({
                  ...project.styles,
                  caption: prune({ ...capStyle, background: v === "on" ? CAPTION_BOX_COLOR : undefined }),
                }),
                "style.bg",
              )
            }
          />
          <p className="field-label">{t("captionPlacement")}</p>
          <div className="row">
            <NumField
              label={t("captionX")}
              value={capStyle.position?.x}
              step={0.01}
              min={0}
              max={1}
              placeholder="auto"
              onChange={(v) =>
                setCapPos(v === undefined ? undefined : { x: v, y: capStyle.position?.y ?? 0.88 }, "style.x")
              }
            />
            <NumField
              label={t("captionY")}
              value={capStyle.position?.y}
              step={0.01}
              min={0}
              max={1}
              placeholder="auto"
              onChange={(v) =>
                setCapPos(v === undefined ? undefined : { x: capStyle.position?.x ?? 0.5, y: v }, "style.y")
              }
            />
            <NumField
              label={t("captionWidthProject")}
              value={capStyle.width}
              step={0.05}
              min={0.1}
              max={1}
              placeholder={String(DEFAULT_CAPTION_WIDTH)}
              onChange={(v) =>
                set(
                  "styles",
                  prune({ ...project.styles, caption: prune({ ...capStyle, width: v }) }),
                  "style.w",
                )
              }
            />
          </div>
          {overrides > 0 && (
            <button
              type="button"
              className="small"
              onClick={() =>
                update((p) => ({
                  ...p,
                  steps: p.steps.map((st) => {
                    if (!st.caption) return st;
                    const { position: _p, width: _w, ...rest } = st.caption;
                    return { ...st, caption: rest };
                  }),
                }))
              }
            >
              {t("clearOverrides")} ({overrides})
            </button>
          )}
        </Section>
      </Fold>

      <Fold id="p.speech" title={t("speech")} defaultOpen>
        <Field label={t("speechEngine")}>
          <select
            value={engine}
            onChange={(e) => {
              const next = e.target.value;
              // 声の名前はエンジンごとに違うので、エンジンを替えたら全体とステップの声の指定を外す(元に戻すで戻せる)
              update(
                (p) => ({
                  ...p,
                  speech: prune({ ...p.speech, engine: next === "os" ? undefined : next, voice: undefined }),
                  steps: p.steps.map((s) =>
                    withSpeechPieces(
                      s,
                      speechPieces(s).map((piece) => prune({ ...piece, voice: undefined }) ?? {}),
                    ),
                  ),
                }),
                "speech.engine",
              );
            }}
          >
            {SPEECH_ENGINES.map((e) => (
              <option key={e} value={e} disabled={!enabled(e) && e !== engine}>
                {t(ENGINE_LABEL[e])}
                {enabled(e) ? "" : ` ${t("engineNotEnabled")}`}
              </option>
            ))}
          </select>
        </Field>
        {engine !== "os" && !enabled(engine) && <p className="hint warn">{t("engineFallbackHint")}</p>}
        {(engine === "voicevox" || engine === "azure") && (
          <p className="hint">{t(engine === "voicevox" ? "voicevoxTermsHint" : "azureTermsHint")}</p>
        )}
        {props.voiceError && enabled(engine) && <p className="hint warn">{props.voiceError}</p>}
        <button type="button" className="small" onClick={props.onOpenSettings}>
          {t("openEngineSettings")}
        </button>
        <VoiceSelect
          label={t("voice")}
          voices={voices}
          value={project.speech?.voice}
          emptyLabel={t(engine === "os" ? "osDefault" : "engineDefaultVoice")}
          onChange={(v) => set("speech", prune({ ...project.speech, voice: v }))}
        />
        <div className="row">
          <NumField
            label={t("rate")}
            value={typeof project.speech?.params?.rate === "number" ? project.speech.params.rate : undefined}
            step={0.1}
            min={0.5}
            max={3}
            placeholder="1"
            onChange={(v) =>
              set(
                "speech",
                prune({ ...project.speech, params: withParam(project.speech?.params, "rate", v) }),
                "speech.rate",
              )
            }
          />
          <NumField
            label={t("speechVolume")}
            value={project.audio?.speech?.volume}
            step={0.1}
            min={0}
            max={2}
            placeholder="1"
            onChange={(v) =>
              set("audio", prune({ ...project.audio, speech: prune({ volume: v }) }), "audio.speech")
            }
          />
        </div>
        <DictionaryField
          value={project.dictionary ?? []}
          onChange={(entries) => set("dictionary", entries.length ? entries : undefined, "dictionary")}
        />
      </Fold>
    </>
  );
}

const fmtSec = (s: number) => `${s.toFixed(1)}s`;

/** 録画に追従する図形のうち、録画の外にはみ出したものがあるか(欄を畳んでいても印を出す) */
const objectsOutside = (step: Step, src: { w: number; h: number } | null) =>
  !!src && (step.shapes ?? []).some((s) => shapeOutsideVideo(s, src.w, src.h));

function ZoomSection(props: {
  project: Project;
  update: Update;
  index: number;
  k: number;
  drawing: { step: number; zoom: number; key: number } | null;
  onDrawZoom: (step: number, zoomIndex: number, key?: number) => void;
  syncSize: boolean;
  srcSizeOf: (step: number) => { w: number; h: number } | null;
  onSeekLocal: (step: number, local: number) => void;
}) {
  const { project, update, index, k } = props;
  const step = project.steps[index];
  const z = step?.zooms?.[k];
  if (!step || !z) return null;
  const set = (key: string) => patchStep(update, index, key);
  const src = props.srcSizeOf(index) ?? { w: 1920, h: 1080 };
  const out = resolveOutput(project);
  const crop = computeLayout(out.width, out.height, resolveLayout(project, step), src.w, src.h).crop;
  const setZoomFn = (key: string, fn: (z: Zoom) => Zoom) =>
    set(`zoom${k}.${key}`)((s) => ({ ...s, zooms: (s.zooms ?? []).map((x, i) => (i === k ? fn(x) : x)) }));
  const setZoom = (key: string, patch: Partial<Zoom>) =>
    set(`zoom${k}.${key}`)((s) => ({
      ...s,
      zooms: (s.zooms ?? []).map((x, i) => (i === k ? (prune({ ...x, ...patch }) as Zoom) : x)),
    }));
  const keys = sortedKeys(z);
  // 編集中の枠(プレビューで編集していなければ最初の枠)
  const drawing = props.drawing?.step === index && props.drawing.zoom === k ? props.drawing : null;
  const ki = drawing ? Math.min(drawing.key, keys.length - 1) : 0;
  const cur = keys[ki] ?? (keys[0] as ZoomKey);
  const keep = z.keepAspect ?? false;

  return (
    <Section className="zoom" focused={false}>
      <div className="row">
        <NumField
          label={t("start")}
          value={z.start}
          min={0}
          onChange={(v) => {
            if (v === undefined || v >= z.end) return;
            setZoomFn("start", (x) => retimeZoom(x, v, x.end));
            props.onSeekLocal(index, v);
          }}
        />
        <NumField
          label={t("end")}
          value={z.end}
          min={0}
          onChange={(v) => {
            if (v === undefined || v <= z.start) return;
            setZoomFn("end", (x) => retimeZoom(x, x.start, v));
            // 映像を止めるズームは止めた所(始まり)を、それ以外は終わりを見せる
            props.onSeekLocal(index, zoomHoldMode(z) === "zoom" ? z.start : v);
          }}
        />
      </div>
      <p className="field-label">
        {t("zoomKeys")}
        {keys.length > 1 && ` — ${t("zoomKey")} ${ki + 1}/${keys.length}`}
      </p>
      {keys.length > 1 &&
        keys.map((key, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 枠は時刻の順の番号で区別する
          <div key={i} className={`row zoom-key ${i === ki ? "current" : ""}`}>
            <NumField
              label={`${t("zoomKey")} ${i + 1} (${t("at")})`}
              value={key.t}
              min={z.start}
              max={z.end}
              step={0.1}
              onChange={(v) =>
                v !== undefined &&
                setZoomFn(`key${i}.t`, (x) => ({
                  ...x,
                  keys: sortedKeys(x)
                    .map((y, j) => (j === i ? { ...y, t: Math.min(Math.max(v, x.start), x.end) } : y))
                    .sort((p, q) => p.t - q.t),
                }))
              }
            />
            <button type="button" className="small" onClick={() => props.onDrawZoom(index, k, i)}>
              {t("editKey")}
            </button>
            <button
              type="button"
              className="small"
              onClick={() =>
                setZoomFn(`key${i}.remove`, (x) => ({
                  ...x,
                  keys: sortedKeys(x).filter((_, j) => j !== i),
                }))
              }
            >
              {t("remove")}
            </button>
          </div>
        ))}
      <ZoomRectFields
        rect={cur.rect}
        scale={rectScale(cur.rect, keep, crop, src.w, src.h)}
        onChange={(rect, key) =>
          setZoomFn(`key${ki}.${key}`, (x) => setZoomKeyRect(x, ki, rect, props.syncSize, src.w, src.h))
        }
      />
      <button
        type="button"
        className="small"
        onClick={() =>
          setZoomFn("aspect", (x) => ({
            ...x,
            keys: sortedKeys(x).map((y) => ({
              ...y,
              rect: resetRectAspect(y.rect, keep, crop, src.w, src.h),
            })),
          }))
        }
      >
        {t("zoomResetAspect")}
      </button>
      <NumField
        label={t("zoomTime")}
        value={z.transition}
        min={0}
        step={0.1}
        placeholder={zoomTransition(
          { ...z, transition: undefined },
          zoomScale(z, crop, src.w, src.h),
        ).toFixed(2)}
        onChange={(v) => setZoom("transition", { transition: v })}
      />
      <SegField
        label={t("hold")}
        value={zoomHoldMode(z)}
        options={[
          { value: "zoom", label: t("holdZoom") },
          { value: "transition", label: t("holdTransition") },
          { value: "none", label: t("holdNone") },
        ]}
        onChange={(v) =>
          setZoom(
            "hold",
            v === "transition"
              ? {
                  hold: "transition",
                  // 止める長さを今の動きの秒数に合わせて書いておく(書かないと固定の秒数になる)
                  transition:
                    z.transition ??
                    Math.round(
                      zoomTransition({ ...z, hold: undefined }, zoomScale(z, crop, src.w, src.h)) * 100,
                    ) / 100,
                }
              : { hold: v === "zoom" ? undefined : false },
          )
        }
      />
      <CheckField
        label={t("zoomKeepAspect")}
        value={keep}
        onChange={(v) => setZoom("keepAspect", { keepAspect: v ? true : undefined })}
      />
      <div className="row">
        {!drawing && (
          <button type="button" onClick={() => props.onDrawZoom(index, k, ki)}>
            {t("drawRect")}
          </button>
        )}
        <button
          type="button"
          className="small"
          onClick={() => set("zooms")((s) => ({ ...s, zooms: s.zooms?.filter((_, i) => i !== k) }))}
        >
          {t("remove")}
        </button>
      </div>
    </Section>
  );
}

/** ズームの枠の数値。倍率を変えると中心と縦横比を保って枠の大きさが変わる */
function ZoomRectFields(props: { rect: Rect; scale: number; onChange: (rect: Rect, key: string) => void }) {
  const r = props.rect;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const round = (b: Rect) => ({
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.w),
    h: Math.round(b.h),
  });
  const resize = (w: number, h: number) => round({ x: cx - w / 2, y: cy - h / 2, w, h });
  return (
    <>
      <div className="row">
        <NumField
          label={t("zoomScale")}
          value={Math.round(props.scale * 100) / 100}
          step={0.1}
          min={1}
          onChange={(v) => {
            if (!v || v < 1) return;
            const k = props.scale / v;
            props.onChange(resize(r.w * k, r.h * k), "scale");
          }}
        />
        <NumField
          label={t("zoomBoxW")}
          value={Math.round(r.w)}
          step={10}
          min={8}
          onChange={(v) => v && v >= 8 && props.onChange(resize(v, r.h), "w")}
        />
        <NumField
          label={t("zoomBoxH")}
          value={Math.round(r.h)}
          step={10}
          min={8}
          onChange={(v) => v && v >= 8 && props.onChange(resize(r.w, v), "h")}
        />
      </div>
      <div className="row">
        <NumField
          label={t("zoomCenterX")}
          value={Math.round(cx)}
          step={10}
          onChange={(v) => v !== undefined && props.onChange(round({ ...r, x: v - r.w / 2 }), "cx")}
        />
        <NumField
          label={t("zoomCenterY")}
          value={Math.round(cy)}
          step={10}
          onChange={(v) => v !== undefined && props.onChange(round({ ...r, y: v - r.h / 2 }), "cy")}
        />
      </div>
    </>
  );
}

/** 設定の欄。タイムラインで選ばれたら強調し、見える位置へ動かす */
function Section(props: { focused: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [props.focused]);
  return (
    <div ref={ref} className={`section ${props.className ?? ""} ${props.focused ? "focused" : ""}`}>
      {props.children}
    </div>
  );
}

/** 出力の縦横比を固定しているときの比(幅 ÷ 高さ)。保存はせず、アプリを閉じるまで覚えておく */
let lockedAspect: number | null = null;

/** 「余白なし」にする前の余白と置き方。保存はせず、アプリを閉じるまで覚えておく */
const savedMargins = new Map<string, { margin: Margin; fit: "contain" | "cover" }>();

type FramePatch = { margin?: Margin; fit?: "contain" | "cover"; shadow?: boolean };

/**
 * 録画の枠の欄(余白・余白なし・切り取り・影)。全体の設定とステップの上書きで共通。
 * memo は「余白なし」を外したときに戻す値を覚える場所の名前(全体・ステップの id)
 */
function FrameFields(props: {
  layout: ResolvedLayout;
  outW: number;
  outH: number;
  focused: boolean;
  memo: string;
  onChange: (patch: FramePatch, key?: string) => void;
}) {
  const { layout, onChange } = props;
  const noMargin = layout.fit === "contain" && Object.values(layout.margin).every((v) => Math.abs(v) < 1e-9);
  return (
    <>
      <Section focused={props.focused}>
        <MarginField
          margin={layout.margin}
          outW={props.outW}
          outH={props.outH}
          onChange={(m, key) => onChange({ margin: m }, key)}
        />
        <CheckField
          label={t("noMargin")}
          value={noMargin}
          onChange={(v) => {
            if (v) {
              // 直前の余白と置き方を覚えておき、外したら戻す(アプリを閉じるまで)
              savedMargins.set(props.memo, { margin: layout.margin, fit: layout.fit });
              onChange({ margin: { top: 0, right: 0, bottom: 0, left: 0 }, fit: "contain" });
            } else {
              const back = savedMargins.get(props.memo) ?? {
                margin: DEFAULT_MARGIN,
                fit: "contain" as const,
              };
              savedMargins.delete(props.memo);
              onChange(back);
            }
          }}
        />
        <CheckField
          label={t("fitCover")}
          value={layout.fit === "cover"}
          onChange={(v) => onChange({ fit: v ? "cover" : "contain" })}
        />
      </Section>
      <CheckField label={t("shadow")} value={layout.shadow} onChange={(v) => onChange({ shadow: v })} />
    </>
  );
}

/** ステップの録画の枠。変えるとこのステップだけの上書きになる。共通にする・全体に戻すボタン付き */
function StepFrame(props: { project: Project; index: number; update: Update; focused: boolean }) {
  const { project, index, update } = props;
  const step = project.steps[index];
  if (!step) return null;
  const out = resolveOutput(project);
  const own = hasStepLayout(step);
  return (
    <>
      <p className="hint">{t(own ? "frameOwnHint" : "frameCommonHint")}</p>
      <FrameFields
        layout={resolveLayout(project, step)}
        outW={out.width}
        outH={out.height}
        focused={props.focused}
        memo={`step:${step.id}`}
        onChange={(patch, key) => update((p) => setStepLayout(p, index, patch), key ?? `frame${index}`)}
      />
      {own && (
        <div className="row">
          <button
            type="button"
            className="small"
            title={t("frameUseAsCommonHint")}
            onClick={() => update((p) => makeStepLayoutCommon(p, index))}
          >
            {t("frameUseAsCommon")}
          </button>
          <button type="button" className="small" onClick={() => update((p) => clearStepLayout(p, index))}>
            {t("frameBackToCommon")}
          </button>
        </div>
      )}
    </>
  );
}

/** 解像度の候補。かっこの中は通称 */
const RESOLUTIONS = [
  { label: "1920×1080 (Full HD)", w: 1920, h: 1080 },
  { label: "1280×720 (HD)", w: 1280, h: 720 },
  { label: "2560×1440 (WQHD)", w: 2560, h: 1440 },
  { label: "3840×2160 (4K)", w: 3840, h: 2160 },
];

/**
 * 全体の設定: 出力、レイアウト(背景・余白 = 録画の枠・影)、テロップの見た目と読み上げの声の共通の値。
 * どれも全ステップに効く
 */
export function ProjectPanel(props: {
  project: Project;
  update: Update;
  voices: Voice[];
  /** ユーザーが有効にした読み上げエンジン(読み込み前は null) */
  speechEngines: SpeechEngineSettings | null;
  /** 声の一覧を取れなかった理由 */
  voiceError: string | null;
  onOpenSettings: () => void;
  /** ステップの「共通の設定 ›」から来た。テロップの見た目の欄を強調する */
  focusShared: boolean;
  backgroundError: string | null;
}) {
  const { project, update } = props;
  const out = resolveOutput(project);
  const layout = resolveLayout(project);
  const set = <K extends keyof Project>(key: K, value: Project[K], coalesce?: string) =>
    update((p) => ({ ...p, [key]: value }), coalesce ?? String(key));
  const overridden = project.steps.filter(hasStepLayout).length;
  const even = (v: number | undefined) => (v === undefined ? undefined : Math.max(16, Math.round(v / 2) * 2));
  // 縦横比の固定。固定したときの比(幅 ÷ 高さ)を保つ(入力の途中の値で比が崩れないように)。アプリを閉じるまで覚える
  const [aspect, setAspect] = useState<number | null>(() => lockedAspect);
  const lockAspect = (v: number | null) => {
    lockedAspect = v;
    setAspect(v);
  };
  const setSize = (w: number | undefined, h: number | undefined, key: string) =>
    set("output", prune({ ...project.output, width: even(w), height: even(h) }), key);
  /** 幅・高さの入力。空や小さすぎる値(打ちかけ)は直前の大きさのまま(欄は打ったまま残る) */
  const typedSize = (v: number | undefined) => (v !== undefined && v >= 16 ? v : null);

  return (
    <div className="inspector">
      <Fold
        id="p.output"
        title={t("output")}
        summary={`${out.width}×${out.height} · ${out.fps}fps`}
        defaultOpen
      >
        <Field label={`${t("width")} × ${t("height")}`}>
          <select
            value={RESOLUTIONS.find((r) => r.w === out.width && r.h === out.height)?.label ?? ""}
            onChange={(e) => {
              const r = RESOLUTIONS.find((x) => x.label === e.target.value);
              if (!r) return;
              set("output", { ...project.output, width: r.w, height: r.h });
              if (aspect !== null) lockAspect(r.w / r.h);
            }}
          >
            <option value="">—</option>
            {RESOLUTIONS.map((r) => (
              <option key={r.label}>{r.label}</option>
            ))}
          </select>
        </Field>
        <div className="row">
          <NumField
            label={t("width")}
            value={out.width}
            step={2}
            onChange={(raw) => {
              const v = typedSize(raw);
              if (v !== null) setSize(v, aspect !== null ? v / aspect : project.output?.height, "output.w");
            }}
          />
          <NumField
            label={t("height")}
            value={out.height}
            step={2}
            onChange={(raw) => {
              const v = typedSize(raw);
              if (v !== null) setSize(aspect !== null ? v * aspect : project.output?.width, v, "output.h");
            }}
          />
          <CheckField
            label={t("lockAspect")}
            value={aspect !== null}
            onChange={(v) => lockAspect(v ? out.width / out.height : null)}
          />
        </div>
        <div className="row">
          <SelectField
            label={t("fps")}
            value={String(out.fps)}
            options={[
              { value: "30", label: "30" },
              { value: "60", label: "60" },
            ]}
            onChange={(v) => set("output", { ...project.output, fps: v === "60" ? 60 : 30 })}
          />
          <SelectField
            label={t("quality")}
            value={out.quality}
            options={(["low", "medium", "high"] as const).map((q) => ({ value: q, label: t(q) }))}
            onChange={(v) => set("output", { ...project.output, quality: v })}
          />
        </div>
        <CheckField
          label={t("srt")}
          value={out.srt}
          onChange={(v) => set("output", { ...project.output, srt: v })}
        />
      </Fold>

      <Fold id="p.layout" title={t("layout")} defaultOpen>
        <BackgroundField
          value={layout.background}
          error={props.backgroundError}
          onChange={(bg, key) => set("layout", { ...project.layout, background: bg }, key)}
        />
        <FrameFields
          layout={layout}
          outW={out.width}
          outH={out.height}
          focused={false}
          memo="project"
          onChange={(patch, key) => {
            // 全体の置き方は既定(contain)なら書かない
            const fit = "fit" in patch ? (patch.fit === "cover" ? "cover" : undefined) : project.layout?.fit;
            set("layout", prune({ ...project.layout, ...patch, fit }), key);
          }}
        />
        {overridden > 0 && <p className="hint">{`${t("frameOverriddenSteps")}: ${overridden}`}</p>}
      </Fold>

      <TextDefaults
        project={project}
        update={update}
        voices={props.voices}
        focused={props.focusShared}
        speechEngines={props.speechEngines}
        voiceError={props.voiceError}
        onOpenSettings={props.onOpenSettings}
      />
      <Fold id="p.objects" title={t("objectDefaults")} defaultOpen={false}>
        <ObjectDefaults project={project} update={update} />
      </Fold>
    </div>
  );
}

type Dict = { from: string; to: string }[];

/** 保存する形: 語が空の行は除き、前後の空白を落とす */
const cleanDict = (rows: Dict): Dict =>
  rows.map((r) => ({ from: r.from.trim(), to: r.to.trim() })).filter((r) => r.from !== "");

/**
 * 読みの辞書。語と読みを行ごとの 2 つの欄で入れる(書き方の決まりを利用者に守らせない)。
 * 書きかけの行(語がまだ空)は手元にだけ持ち、外から内容が変わったときだけ置き換える
 */
function DictionaryField(props: { value: Dict; onChange: (d: Dict) => void }) {
  const [rows, setRows] = useState<Dict>(props.value);
  useEffect(() => {
    setRows((prev) => (JSON.stringify(cleanDict(prev)) === JSON.stringify(props.value) ? prev : props.value));
  }, [props.value]);
  const change = (next: Dict) => {
    setRows(next);
    props.onChange(cleanDict(next));
  };
  return (
    <div className="field dict-field">
      <span>{t("dictionary")}</span>
      {rows.length > 0 && (
        <div className="dict-grid">
          <span className="dict-head">{t("dictWord")}</span>
          <span className="dict-head">{t("dictReading")}</span>
          <span />
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 行は並びの位置で直す(語が同じ行もありうる)
            <div className="dict-row" key={i}>
              <input
                type="text"
                value={r.from}
                aria-label={`${t("dictWord")} ${i + 1}`}
                placeholder={t("dictWordPlaceholder")}
                onChange={(e) => change(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
              />
              <input
                type="text"
                value={r.to}
                aria-label={`${t("dictReading")} ${i + 1}`}
                placeholder={t("dictReadingPlaceholder")}
                onChange={(e) => change(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
              />
              <button
                type="button"
                className="icon-btn"
                title={t("remove")}
                aria-label={`${t("remove")} ${i + 1}`}
                onClick={() => change(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="small" onClick={() => setRows([...rows, { from: "", to: "" }])}>
        ＋ {t("dictAdd")}
      </button>
      <p className="hint">{t("dictHint")}</p>
    </div>
  );
}

const PRESET_LABELS: Record<string, Parameters<typeof t>[0]> = {
  default: "presetDefault",
  sunset: "presetSunset",
  mint: "presetMint",
  ocean: "presetOcean",
  graphite: "presetGraphite",
  paper: "presetPaper",
};

function PresetSwatch(props: { id: string; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPresetThumb(ref.current, props.id);
  }, [props.id]);
  const label = t(PRESET_LABELS[props.id] ?? "presetDefault");
  return (
    <button
      type="button"
      className={`swatch ${props.selected ? "selected" : ""}`}
      title={label}
      aria-label={label}
      onClick={props.onClick}
    >
      <canvas ref={ref} width={64} height={36} />
    </button>
  );
}

/** 背景(LAY-04)。種類を選び、種類ごとの設定を出す */
function BackgroundField(props: {
  value: Background;
  error: string | null;
  onChange: (bg: Background, key: string) => void;
}) {
  const bg = props.value;
  const kind = typeof bg === "string" ? "color" : "gradient" in bg ? "gradient" : "image";
  const grad = typeof bg !== "string" && "gradient" in bg ? bg.gradient : null;
  const image = typeof bg !== "string" && "image" in bg ? bg.image : null;
  return (
    <>
      <SelectField
        label={t("bgType")}
        value={kind}
        options={[
          { value: "image", label: t("bgImage") },
          { value: "gradient", label: t("bgGradient") },
          { value: "color", label: t("bgColor") },
        ]}
        onChange={(v) =>
          props.onChange(
            v === "color"
              ? DEFAULT_SOLID_BACKGROUND
              : v === "gradient"
                ? { gradient: { angle: 135, colors: ["#1E2A5A", "#6A3093"] } }
                : DEFAULT_BACKGROUND,
            "layout.bgType",
          )
        }
      />
      {typeof bg === "string" && (
        <Field label={t("color")}>
          <input
            type="color"
            value={bg.slice(0, 7)}
            onChange={(e) => props.onChange(e.target.value.toUpperCase(), "layout.bg")}
          />
        </Field>
      )}
      {grad && (
        <>
          <NumField
            label={t("angle")}
            value={grad.angle ?? 180}
            step={15}
            onChange={(v) => props.onChange({ gradient: { ...grad, angle: v ?? 180 } }, "layout.angle")}
          />
          <div className="row">
            {grad.colors.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 色は並び順で区別する
              <div className="grad-color" key={i}>
                <input
                  type="color"
                  value={c.slice(0, 7)}
                  onChange={(e) =>
                    props.onChange(
                      {
                        gradient: {
                          ...grad,
                          colors: grad.colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)),
                        },
                      },
                      `layout.grad${i}`,
                    )
                  }
                />
                {grad.colors.length > 2 && (
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      props.onChange(
                        { gradient: { ...grad, colors: grad.colors.filter((_, j) => j !== i) } },
                        "layout.gradRemove",
                      )
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {grad.colors.length < 4 && (
              <button
                type="button"
                className="small"
                onClick={() =>
                  props.onChange(
                    { gradient: { ...grad, colors: [...grad.colors, grad.colors.at(-1) ?? "#FFFFFF"] } },
                    "layout.gradAdd",
                  )
                }
              >
                ＋ {t("addColor")}
              </button>
            )}
          </div>
        </>
      )}
      {image !== null && (
        <>
          <div className="swatches">
            {PRESETS.map((p) => (
              <PresetSwatch
                key={p.id}
                id={p.id}
                selected={image === `preset:${p.id}`}
                onClick={() => props.onChange({ image: `preset:${p.id}` }, "layout.preset")}
              />
            ))}
          </div>
          {!image.startsWith("preset:") && <p className="hint">{image}</p>}
          {props.error && <p className="hint error">⚠ {props.error}</p>}
          <button
            type="button"
            onClick={async () => {
              const path = await api.pickImage();
              if (path) props.onChange({ image: path }, "layout.image");
            }}
          >
            {t("chooseImage")}
          </button>
        </>
      )}
    </>
  );
}

/** 上下左右の余白。表示は出力のピクセル、保存は割合 */
function MarginField(props: {
  margin: Margin;
  outW: number;
  outH: number;
  onChange: (m: Margin, key: string) => void;
}) {
  const m = props.margin;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const field = (side: keyof Margin, label: Parameters<typeof t>[0], size: number) => (
    <NumField
      label={t(label)}
      value={Math.round(m[side] * size)}
      step={2}
      onChange={(v) => props.onChange({ ...m, [side]: r6((v ?? 0) / size) }, `margin.${side}`)}
    />
  );
  return (
    <>
      <p className="field-label">{t("marginTitle")}</p>
      <div className="row">
        {field("top", "marginTop", props.outH)}
        {field("bottom", "marginBottom", props.outH)}
        {field("left", "marginLeft", props.outW)}
        {field("right", "marginRight", props.outW)}
      </div>
    </>
  );
}
