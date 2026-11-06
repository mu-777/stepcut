// 右側の設定パネル。ステップの設定とプロジェクト全体の設定。

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

export function StepInspector(props: {
  project: Project;
  index: number;
  update: Update;
  voices: Voice[];
  playheadLocal: number;
  /** 読み上げの生成の状況(失敗・生成中・読み上げごとの長さ) */
  speechStatus: { error: string | null; pending: boolean; durations: number[] } | null;
  /** このステップの読み上げを試聴中 */
  speechPlaying: boolean;
  /** タイムラインで選んだ要素。その欄を強調して見える位置へ動かす */
  focus: Selection;
  /** プレビューで範囲を編集中のズームと枠 */
  drawing: { zoom: number; key: number } | null;
  /** プレビューでズームの枠 key(時刻の順の番号)の編集を始める */
  onDrawZoom: (zoomIndex: number, key?: number) => void;
  /** 枠の大きさを全部の枠でそろえる(編集の設定) */
  syncSize: boolean;
  /** 再生位置にズームを足す */
  onAddZoom: () => void;
  onPreviewSpeech: () => void;
  /** このステップの録画の大きさ */
  srcSize: { w: number; h: number } | null;
}) {
  const { project, index, update, voices, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  const caption = step.caption ?? { text: "" };
  const pieces = speechPieces(step);
  const first = pieces[0];
  const synced = speechSynced(step);
  const status = props.speechStatus;
  const times = speechTimes(step, status?.durations ?? []);
  const audio = step.audio ?? {};
  const style = resolveCaptionStyle(project, step);
  const projCap = project.styles?.caption;
  const overridden = caption.position !== undefined || caption.width !== undefined;
  const src = props.srcSize ?? { w: 1920, h: 1080 };
  const out = resolveOutput(project);
  const crop = computeLayout(out.width, out.height, resolveLayout(project), src.w, src.h).crop;

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
  const setZoomFn = (k: number, key: string, fn: (z: Zoom) => Zoom) =>
    set(`zoom${k}.${key}`)((s) => ({ ...s, zooms: (s.zooms ?? []).map((z, i) => (i === k ? fn(z) : z)) }));
  const setZoom = (k: number, key: string, patch: Partial<Zoom>) =>
    set(`zoom${k}.${key}`)((s) => ({
      ...s,
      zooms: (s.zooms ?? []).map((z, i) => (i === k ? (prune({ ...z, ...patch }) as Zoom) : z)),
    }));

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

      <Section focused={focus.kind === "caption"}>
        <h4>{t("caption")}</h4>
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
          {overridden && <span className="badge">{t("overridden")}</span>}
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
        <p className="hint">{t("captionWidthHint")}</p>
        {overridden && (
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
          </div>
        </Section>
      ))}
      <Section focused={false}>
        <div className="row">
          <button
            type="button"
            onClick={props.onPreviewSpeech}
            // 生成中は押せない。試聴中は「読み上げを終了」
            disabled={
              !props.speechPlaying && (status?.pending || !pieces.some((_, k) => speechText(step, k)))
            }
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
            {t("addSpeech")}
          </button>
        </div>
        {status?.error && <p className="hint">⚠ {status.error}</p>}
        {pieces.length > 0 && (
          <>
            <VoiceSelect
              label={t("voice")}
              voices={voices}
              value={first?.voice}
              emptyLabel={t("defaultVoice")}
              onChange={(v) => setPiece(0, "voice", { voice: v })}
            />
            <NumField
              label={t("rate")}
              value={typeof first?.params?.rate === "number" ? first.params.rate : undefined}
              step={0.1}
              min={0.5}
              max={3}
              placeholder={t("defaultVoice")}
              onChange={(v) => setPiece(0, "rate", { params: withParam(first?.params, "rate", v) })}
            />
          </>
        )}
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
        {t("addHold")}
      </button>

      <h4>{t("zooms")}</h4>
      {(step.zooms ?? []).map((z, k) => {
        const keys = sortedKeys(z);
        // 編集中の枠(プレビューで編集していなければ最初の枠)
        const ki = props.drawing?.zoom === k ? Math.min(props.drawing.key, keys.length - 1) : 0;
        const cur = keys[ki] ?? (keys[0] as ZoomKey);
        const keep = z.keepAspect ?? false;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ズームは id を持たない
          <Section key={k} className="zoom" focused={focus.kind === "zoom" && focus.index === k}>
            <div className="row">
              <NumField
                label={t("start")}
                value={z.start}
                min={0}
                onChange={(v) =>
                  v !== undefined && v < z.end && setZoomFn(k, "start", (x) => retimeZoom(x, v, x.end))
                }
              />
              <NumField
                label={t("end")}
                value={z.end}
                min={0}
                onChange={(v) =>
                  v !== undefined && v > z.start && setZoomFn(k, "end", (x) => retimeZoom(x, x.start, v))
                }
              />
            </div>
            <p className="hint">{t("zoomHeldHint")}</p>
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
                      setZoomFn(k, `key${i}.t`, (x) => ({
                        ...x,
                        keys: sortedKeys(x)
                          .map((y, j) => (j === i ? { ...y, t: Math.min(Math.max(v, x.start), x.end) } : y))
                          .sort((p, q) => p.t - q.t),
                      }))
                    }
                  />
                  <button type="button" className="small" onClick={() => props.onDrawZoom(k, i)}>
                    {t("editKey")}
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setZoomFn(k, `key${i}.remove`, (x) => ({
                        ...x,
                        keys: sortedKeys(x).filter((_, j) => j !== i),
                      }))
                    }
                  >
                    {t("remove")}
                  </button>
                </div>
              ))}
            <p className="hint">{t("zoomKeysHint")}</p>
            <ZoomRectFields
              rect={cur.rect}
              scale={rectScale(cur.rect, keep, crop, src.w, src.h)}
              onChange={(rect, key) =>
                setZoomFn(k, `key${ki}.${key}`, (x) =>
                  setZoomKeyRect(x, ki, rect, props.syncSize, src.w, src.h),
                )
              }
            />
            <button
              type="button"
              className="small"
              onClick={() =>
                setZoomFn(k, "aspect", (x) => ({
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
              onChange={(v) => setZoom(k, "transition", { transition: v })}
            />
            <p className="hint">{t("zoomTimeHint")}</p>
            <CheckField
              label={t("hold")}
              value={zoomHolds(z)}
              onChange={(v) => setZoom(k, "hold", { hold: v ? undefined : false })}
            />
            <CheckField
              label={t("zoomKeepAspect")}
              value={keep}
              onChange={(v) => setZoom(k, "keepAspect", { keepAspect: v ? true : undefined })}
            />
            <div className="row">
              <button type="button" onClick={() => props.onDrawZoom(k, ki)}>
                {t("drawRect")}
              </button>
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
      })}
      <button type="button" onClick={props.onAddZoom}>
        {t("addZoom")} (Z)
      </button>
    </div>
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

export function ProjectInspector(props: {
  project: Project;
  update: Update;
  voices: Voice[];
  /** プレビューで映像を選んでいる。映像の位置の欄を強調する */
  focusVideo: boolean;
  srcSize: { w: number; h: number } | null;
  projectPath: string | null;
  backgroundError: string | null;
}) {
  const { project, update, voices } = props;
  const out = resolveOutput(project);
  const layout = resolveLayout(project);
  const capStyle = project.styles?.caption ?? {};
  const set = <K extends keyof Project>(key: K, value: Project[K], coalesce?: string) =>
    update((p) => ({ ...p, [key]: value }), coalesce ?? String(key));
  const setCapPos = (pos: { x: number; y: number } | undefined, key: string) =>
    set("styles", prune({ ...project.styles, caption: prune({ ...capStyle, position: pos }) }), key);
  // テロップの位置・幅を個別に設定しているステップの数
  const overrides = project.steps.filter(
    (st) => st.caption?.position !== undefined || st.caption?.width !== undefined,
  ).length;
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

      <h3>{t("captionStyle")}</h3>
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
      <p className="hint">{t("captionWidthHint")}</p>
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

      <h3>{t("speech")}</h3>
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
