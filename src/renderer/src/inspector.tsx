// 右側の設定パネル。ステップの設定とプロジェクト全体の設定。

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ZOOM_TRANSITION,
  resolveCaptionStyle,
  resolveLayout,
  resolveOutput,
} from "../../core/defaults";
import type { Project, Step, Zoom } from "../../core/schema";
import type { Voice } from "../../shared/api";
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
  speechInfo: string | null;
  /** タイムラインで選んだ要素。その欄を強調して見える位置へ動かす */
  focus: Selection;
  onDrawZoom: (zoomIndex: number) => void;
}) {
  const { project, index, update, voices, focus } = props;
  const step = project.steps[index];
  if (!step) return null;
  const set = (key: string) => patchStep(update, index, key);
  const caption = step.caption ?? { text: "" };
  const speech = step.speech ?? { text: "" };
  const audio = step.audio ?? {};
  const style = resolveCaptionStyle(project, step);
  const mode = resolveLayout(project).mode;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  const setCaption = (key: string, patch: Partial<NonNullable<Step["caption"]>>) =>
    set(`caption.${key}`)((s) => ({ ...s, caption: { ...(s.caption ?? { text: "" }), ...patch } }));
  const setSpeech = (key: string, patch: Partial<NonNullable<Step["speech"]>>) =>
    set(`speech.${key}`)((s) => {
      const next = prune({ ...(s.speech ?? { text: "" }), ...patch });
      return { ...s, speech: next?.text !== undefined ? (next as NonNullable<Step["speech"]>) : undefined };
    });
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
        <NumField
          label={t("captionSize")}
          value={caption.style?.size}
          placeholder={String(style.size)}
          step={2}
          onChange={(v) => setCaption("size", { style: prune({ ...caption.style, size: v }) })}
        />
        {mode === "full" && (
          <div className="row">
            <NumField
              label={t("captionX")}
              value={caption.position?.x ?? 0.5}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => setCaption("x", { position: { x: v ?? 0.5, y: caption.position?.y ?? 0.88 } })}
            />
            <NumField
              label={t("captionY")}
              value={caption.position?.y ?? 0.88}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => setCaption("y", { position: { x: caption.position?.x ?? 0.5, y: v ?? 0.88 } })}
            />
          </div>
        )}
      </Section>

      <Section focused={focus.kind === "speech"}>
        <h4>{t("speech")}</h4>
        <TextField
          label={t("speechText")}
          multiline
          value={speech.text}
          onChange={(v) => setSpeech("text", { text: v })}
        />
        <NumField
          label={t("speechStart")}
          value={speech.start}
          min={0}
          placeholder="0"
          onChange={(v) => setSpeech("start", { start: v === 0 ? undefined : v })}
        />
        {props.speechInfo && <p className="hint">{props.speechInfo}</p>}
        <VoiceSelect
          label={t("voice")}
          voices={voices}
          value={speech.voice}
          emptyLabel={t("defaultVoice")}
          onChange={(v) => setSpeech("voice", { voice: v })}
        />
        <NumField
          label={t("rate")}
          value={typeof speech.params?.rate === "number" ? speech.params.rate : undefined}
          step={0.1}
          min={0.5}
          max={3}
          placeholder={t("defaultVoice")}
          onChange={(v) => setSpeech("rate", { params: withParam(speech.params, "rate", v) })}
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
            holds: [...(s.holds ?? []), { at: round(props.playheadLocal), duration: 1 }].sort(
              (a, b) => a.at - b.at,
            ),
          }))
        }
      >
        {t("addHold")}
      </button>

      <h4>{t("zooms")}</h4>
      {(step.zooms ?? []).map((z, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ズームは id を持たない
        <Section key={k} className="zoom" focused={focus.kind === "zoom" && focus.index === k}>
          <div className="row">
            <NumField
              label={t("start")}
              value={z.start}
              min={0}
              onChange={(v) => setZoom(k, "start", { start: v ?? 0 })}
            />
            <NumField
              label={t("end")}
              value={z.end}
              min={0}
              onChange={(v) => setZoom(k, "end", { end: v ?? 0 })}
            />
          </div>
          <div className="row">
            <NumField
              label={t("transition")}
              value={z.transition}
              min={0}
              placeholder={String(DEFAULT_ZOOM_TRANSITION)}
              onChange={(v) => setZoom(k, "transition", { transition: v })}
            />
            <CheckField
              label={t("hold")}
              value={z.hold ?? false}
              onChange={(v) => setZoom(k, "hold", { hold: v || undefined })}
            />
          </div>
          <p className="hint">
            x {Math.round(z.rect.x)}, y {Math.round(z.rect.y)}, {Math.round(z.rect.w)}×{Math.round(z.rect.h)}
          </p>
          <div className="row">
            <button type="button" onClick={() => props.onDrawZoom(k)}>
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
      ))}
      <button
        type="button"
        onClick={() => {
          const start = round(props.playheadLocal);
          set("zooms")((s) => ({
            ...s,
            zooms: [
              ...(s.zooms ?? []),
              { start, end: round(start + 2), rect: { x: 0, y: 0, w: 960, h: 540 } },
            ],
          }));
          props.onDrawZoom(step.zooms?.length ?? 0);
        }}
      >
        {t("addZoom")}
      </button>
    </div>
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

const RESOLUTIONS = [
  { label: "1920×1080", w: 1920, h: 1080 },
  { label: "1280×720", w: 1280, h: 720 },
  { label: "2560×1440", w: 2560, h: 1440 },
  { label: "3840×2160", w: 3840, h: 2160 },
];

export function ProjectInspector(props: { project: Project; update: Update; voices: Voice[] }) {
  const { project, update, voices } = props;
  const out = resolveOutput(project);
  const layout = resolveLayout(project);
  const capStyle = project.styles?.caption ?? {};
  const set = <K extends keyof Project>(key: K, value: Project[K], coalesce?: string) =>
    update((p) => ({ ...p, [key]: value }), coalesce ?? String(key));
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
      <SelectField
        label={t("mode")}
        value={layout.mode}
        options={[
          { value: "band", label: t("band") },
          { value: "full", label: t("full") },
        ]}
        onChange={(v) => set("layout", { ...project.layout, mode: v })}
      />
      {layout.mode === "band" && (
        <>
          <Field label={t("background")}>
            <input
              type="color"
              value={layout.background.slice(0, 7)}
              onChange={(e) =>
                set("layout", { ...project.layout, background: e.target.value.toUpperCase() }, "layout.bg")
              }
            />
          </Field>
          <div className="row">
            <NumField
              label={t("bandHeight")}
              value={layout.bandHeight}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => set("layout", prune({ ...project.layout, bandHeight: v }), "layout.band")}
            />
            <NumField
              label={t("margin")}
              value={layout.margin}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => set("layout", prune({ ...project.layout, margin: v }), "layout.margin")}
            />
          </div>
          <CheckField
            label={t("shadow")}
            value={layout.shadow}
            onChange={(v) => set("layout", { ...project.layout, shadow: v })}
          />
        </>
      )}

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
