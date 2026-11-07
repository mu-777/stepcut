// 左の設定パネル。全体・ステップ・文(テロップと読み上げ)・ズームのパネル。

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  CAPTION_BOX_COLOR,
  captionBoxColor,
  DEFAULT_BACKGROUND,
  DEFAULT_CAPTION_WIDTH,
  DEFAULT_MARGIN,
  resolveCaptionStyle,
  resolveLayout,
  resolveOutput,
  speechPieces,
  speechSynced,
  speechText,
  withSpeechPieces,
  zoomHolds,
  zoomTransition,
} from "../../core/defaults";
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
import type { Background, Margin, Project, SpeechPiece, Step, Zoom, ZoomKey } from "../../core/schema";
import { speechTimes } from "../../core/timeline";
import type { Voice } from "../../shared/api";
import { api } from "./api";
import { drawPresetThumb, PRESETS } from "./backgrounds";
import { CheckField, Field, NumField, prune, SelectField, TextField, withParam } from "./fields";
import { t } from "./i18n";
import type { Selection } from "./timeline";

type Update = (fn: (p: Project) => Project, key?: string) => void;

function patchStep(update: Update, index: number, key: string) {
  return (fn: (s: Step) => Step) =>
    update((p) => ({ ...p, steps: p.steps.map((s, i) => (i === index ? fn(s) : s)) }), `step${index}.${key}`);
}

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
 * パネルの種類。左のアイコン列で切り替える。データの種類ではなく、一緒に直すもののまとまりで分ける
 * (テロップと読み上げは、読み上げが既定でテロップの文を読むので「文」にまとめる)
 */
export type PanelKind = "project" | "step" | "text" | "zoom";

/** 選んだ要素を直すパネル。プロジェクトを選んだだけでは切り替えない */
export function panelOf(s: Selection): PanelKind | null {
  if (s.kind === "video") return "project";
  if (s.kind === "step" || s.kind === "hold") return "step";
  if (s.kind === "caption" || s.kind === "speech") return "text";
  if (s.kind === "zoom") return "zoom";
  return null;
}

/** ステップのパネル: 録画の区間・速度・録画の音・保持 */
export function StepPanel(props: {
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
  const audio = step.audio ?? {};

  return (
    <div className="inspector">
      <Section focused={focus.kind === "step"}>
        <TextField
          label={t("id")}
          value={step.id}
          onChange={(v) => set("id")((s) => ({ ...s, id: v.replace(/[^A-Za-z0-9_-]/g, "") }))}
        />
        <SelectField
          label={t("source")}
          value={step.source}
          options={project.sources.map((s) => ({ value: s.id, label: `${s.id} — ${s.path}` }))}
          onChange={(v) => set("source")((s) => ({ ...s, source: v }))}
        />
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
            set("speed")((s) => ({ ...s, speed: v === undefined || v === 1 ? undefined : Math.max(1, v) }))
          }
        />
      </Section>

      <h4>{t("sourceAudio")}</h4>
      <div className="row">
        <CheckField
          label={t("enabled")}
          value={audio.source?.enabled ?? project.audio?.source?.enabled ?? true}
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
    </div>
  );
}

/** 文のパネル: このステップのテロップと読み上げ、その下に全ステップ共通の見た目と声 */
export function TextPanel(props: {
  project: Project;
  /** 直すステップ。録画がなければ null(共通の見た目だけを出す) */
  index: number | null;
  update: Update;
  voices: Voice[];
  focus: Selection;
  /** 読み上げの生成の状況(失敗・生成中・読み上げごとの長さ) */
  speechStatus: { error: string | null; pending: boolean; durations: number[] } | null;
  /** このステップの読み上げを試聴中 */
  speechPlaying: boolean;
  onPreviewSpeech: () => void;
}) {
  return (
    <div className="inspector">
      {props.index !== null && <StepText {...props} index={props.index} />}
      <TextDefaults project={props.project} update={props.update} voices={props.voices} />
    </div>
  );
}

function StepText(props: {
  project: Project;
  index: number;
  update: Update;
  voices: Voice[];
  focus: Selection;
  speechStatus: { error: string | null; pending: boolean; durations: number[] } | null;
  speechPlaying: boolean;
  onPreviewSpeech: () => void;
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
          <span className="badge">{t(overridden ? "overridden" : "usingCommon")}</span>
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
          {k === 0 && (
            <CheckField
              label={t("speechSyncCaption")}
              value={synced}
              onChange={(v) =>
                // オフにするとテロップの文をコピーして、別の文に書き換えられるようにする
                set("speech.sync")((s) =>
                  withSpeechPieces(
                    s,
                    speechPieces(s).map((x, j) => {
                      if (j !== 0) return x;
                      const { text: _t, ...rest } = x;
                      return v ? rest : { ...rest, text: s.caption?.text ?? "" };
                    }),
                  ),
                )
              }
            />
          )}
          <TextField
            label={t("speechText")}
            multiline
            value={speechSynced(step, k) ? caption.text : (p.text ?? "")}
            disabled={speechSynced(step, k)}
            placeholder={t("speechPlaceholder")}
            onChange={(v) => setPiece(k, "text", { text: v })}
          />
          <div className="row">
            <NumField
              label={t("speechStart")}
              value={p.start}
              min={0}
              placeholder={k === 0 ? "0" : `${t("speechAfterPrev")} (${(times[k]?.start ?? 0).toFixed(2)})`}
              onChange={(v) => setPiece(k, "start", { start: v === 0 && k === 0 ? undefined : v })}
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
function TextDefaults(props: { project: Project; update: Update; voices: Voice[] }) {
  const { project, update, voices } = props;
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
    <div className="defaults">
      <h3>{t("textDefaults")}</h3>
      <h4 className="first">{t("captionStyle")}</h4>
      <TextField
        label={t("font")}
        value={capStyle.font ?? ""}
        placeholder="Yu Gothic UI"
        onChange={(v) =>
          set(
            "styles",
            prune({ ...project.styles, caption: prune({ ...capStyle, font: v || undefined }) }),
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
            set("styles", prune({ ...project.styles, caption: prune({ ...capStyle, width: v }) }), "style.w")
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

      <h4>{t("speech")}</h4>
      <VoiceSelect
        label={t("voice")}
        voices={voices}
        value={project.speech?.voice}
        emptyLabel={t("osDefault")}
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
    </div>
  );
}

/** ズームのパネル: 選んだズームだけを出す。選んでいなければズームの一覧(選ぶとそこへ移る) */
export function ZoomPanel(props: {
  project: Project;
  update: Update;
  focus: Selection;
  /** 各ステップの先頭の時刻(一覧に全体の時刻を出す) */
  stepStarts: number[];
  /** プレビューで範囲を編集中のズームと枠 */
  drawing: { step: number; zoom: number; key: number } | null;
  /** プレビューでズームの枠 key(時刻の順の番号)の編集を始める */
  onDrawZoom: (step: number, zoomIndex: number, key?: number) => void;
  /** 枠の大きさを全部の枠でそろえる(編集の設定) */
  syncSize: boolean;
  /** 再生位置にズームを足す */
  onAddZoom: () => void;
  /** 一覧から選ぶ */
  onSelectZoom: (step: number, zoom: number) => void;
  /** 録画の大きさ(ステップの録画ごと) */
  srcSizeOf: (step: number) => { w: number; h: number } | null;
}) {
  const { project, focus } = props;
  const sel = focus.kind === "zoom" && project.steps[focus.step]?.zooms?.[focus.index] ? focus : null;
  return (
    <div className="inspector">
      {sel ? (
        <ZoomSection {...props} index={sel.step} k={sel.index} />
      ) : (
        <>
          {project.steps.every((s) => !s.zooms?.length) && <p className="hint">{t("noZooms")}</p>}
          <ol className="item-list">
            {project.steps.flatMap((s, i) =>
              (s.zooms ?? []).map((z, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ズームは id を持たない
                <li key={`${i}-${k}`}>
                  <button type="button" className="item-button" onClick={() => props.onSelectZoom(i, k)}>
                    {fmtSec((props.stepStarts[i] ?? 0) + z.start)} –{" "}
                    {fmtSec((props.stepStarts[i] ?? 0) + z.end)}
                    <span className="muted">
                      {t("step")} {i + 1}
                      {z.keys.length > 1 ? ` · ${t("zoomKey")} ×${z.keys.length}` : ""}
                    </span>
                  </button>
                </li>
              )),
            )}
          </ol>
        </>
      )}
      <button type="button" onClick={props.onAddZoom}>
        ＋ {t("addZoom")} (Z)
      </button>
    </div>
  );
}

const fmtSec = (s: number) => `${s.toFixed(1)}s`;

function ZoomSection(props: {
  project: Project;
  update: Update;
  index: number;
  k: number;
  drawing: { step: number; zoom: number; key: number } | null;
  onDrawZoom: (step: number, zoomIndex: number, key?: number) => void;
  syncSize: boolean;
  srcSizeOf: (step: number) => { w: number; h: number } | null;
}) {
  const { project, update, index, k } = props;
  const step = project.steps[index];
  const z = step?.zooms?.[k];
  if (!step || !z) return null;
  const set = (key: string) => patchStep(update, index, key);
  const src = props.srcSizeOf(index) ?? { w: 1920, h: 1080 };
  const out = resolveOutput(project);
  const crop = computeLayout(out.width, out.height, resolveLayout(project), src.w, src.h).crop;
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
          onChange={(v) => v !== undefined && v < z.end && setZoomFn("start", (x) => retimeZoom(x, v, x.end))}
        />
        <NumField
          label={t("end")}
          value={z.end}
          min={0}
          onChange={(v) =>
            v !== undefined && v > z.start && setZoomFn("end", (x) => retimeZoom(x, x.start, v))
          }
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
      <CheckField
        label={t("hold")}
        value={zoomHolds(z)}
        onChange={(v) => setZoom("hold", { hold: v ? undefined : false })}
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

/** 「余白なし」にする前の余白と置き方。保存はせず、アプリを閉じるまで覚えておく */
let savedMargin: { margin: Margin | undefined; fit: "contain" | "cover" | undefined } | null = null;

const RESOLUTIONS = [
  { label: "1920×1080", w: 1920, h: 1080 },
  { label: "1280×720", w: 1280, h: 720 },
  { label: "2560×1440", w: 2560, h: 1440 },
  { label: "3840×2160", w: 3840, h: 2160 },
];

/** 全体のパネル: 出力とレイアウト(背景・余白 = 録画の枠・影)。どれも全ステップに効く */
export function ProjectPanel(props: {
  project: Project;
  update: Update;
  /** プレビューで録画の枠を選んでいる。余白の欄を強調する */
  focusVideo: boolean;
  backgroundError: string | null;
}) {
  const { project, update } = props;
  const out = resolveOutput(project);
  const layout = resolveLayout(project);
  const set = <K extends keyof Project>(key: K, value: Project[K], coalesce?: string) =>
    update((p) => ({ ...p, [key]: value }), coalesce ?? String(key));
  const noMargin = layout.fit === "contain" && Object.values(layout.margin).every((v) => Math.abs(v) < 1e-9);
  const even = (v: number | undefined) => (v === undefined ? undefined : Math.max(16, Math.round(v / 2) * 2));

  return (
    <div className="inspector">
      <h3>{t("output")}</h3>
      <Field label={`${t("width")} × ${t("height")}`}>
        <select
          value={RESOLUTIONS.find((r) => r.w === out.width && r.h === out.height)?.label ?? ""}
          onChange={(e) => {
            const r = RESOLUTIONS.find((x) => x.label === e.target.value);
            if (r) set("output", { ...project.output, width: r.w, height: r.h });
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
          onChange={(v) => set("output", prune({ ...project.output, width: even(v) }), "output.w")}
        />
        <NumField
          label={t("height")}
          value={out.height}
          step={2}
          onChange={(v) => set("output", prune({ ...project.output, height: even(v) }), "output.h")}
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

      <h3>{t("layout")}</h3>
      <BackgroundField
        value={layout.background}
        error={props.backgroundError}
        onChange={(bg, key) => set("layout", { ...project.layout, background: bg }, key)}
      />
      <Section focused={props.focusVideo}>
        <MarginField
          margin={layout.margin}
          outW={out.width}
          outH={out.height}
          onChange={(m, key) => set("layout", { ...project.layout, margin: m }, key)}
        />
        <CheckField
          label={t("noMargin")}
          value={noMargin}
          onChange={(v) => {
            if (v) {
              // 直前の余白と置き方を覚えておき、外したら戻す(アプリを閉じるまで)
              savedMargin = { margin: project.layout?.margin, fit: project.layout?.fit };
              set(
                "layout",
                prune({
                  ...project.layout,
                  margin: { top: 0, right: 0, bottom: 0, left: 0 },
                  fit: undefined,
                }),
              );
            } else {
              const back = savedMargin ?? { margin: DEFAULT_MARGIN, fit: undefined };
              savedMargin = null;
              set("layout", prune({ ...project.layout, margin: back.margin, fit: back.fit }));
            }
          }}
        />
        <CheckField
          label={t("fitCover")}
          value={layout.fit === "cover"}
          onChange={(v) => set("layout", prune({ ...project.layout, fit: v ? "cover" : undefined }))}
        />
      </Section>
      <CheckField
        label={t("shadow")}
        value={layout.shadow}
        onChange={(v) => set("layout", { ...project.layout, shadow: v })}
      />
    </div>
  );
}

type Dict = { from: string; to: string }[];

const parseDict = (text: string): Dict =>
  text
    .split("\n")
    .map((line) => line.split("="))
    .filter((parts) => (parts[0] ?? "").trim() !== "")
    .map(([from = "", ...rest]) => ({ from: from.trim(), to: rest.join("=").trim() }));

const formatDict = (d: Dict) => d.map((x) => `${x.from}=${x.to}`).join("\n");

/** 入力中の空行などを消さないよう、文字列は手元に持ち、外から内容が変わったときだけ置き換える */
function DictionaryField(props: { value: Dict; onChange: (d: Dict) => void }) {
  const [text, setText] = useState(formatDict(props.value));
  useEffect(() => {
    setText((prev) =>
      formatDict(parseDict(prev)) === formatDict(props.value) ? prev : formatDict(props.value),
    );
  }, [props.value]);
  return (
    <Field label={t("dictionary")}>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(parseDict(e.target.value));
        }}
      />
    </Field>
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
              ? "#000000"
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
                {t("addColor")}
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
