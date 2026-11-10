// 設定パネルのオブジェクトの欄(ステップの詳細)と、見た目の共通の設定(全体の設定)。
// 開いたオブジェクトは「見た目」「時間」「位置」に分け、よく触るものを上に置く。位置の数値はプレビューの取っ手で直すことが多いので畳んでおく。
// 項目はいくつでも開いたままにでき、選んだものは強調する。
import { type ReactNode, useEffect, useRef, useState } from "react";
import { captionBoxColor } from "../../core/defaults";
import {
  type AnyObject,
  DEFAULT_ARROW_STYLE,
  DEFAULT_POINTER_STYLE,
  DEFAULT_RECT_STYLE,
  DEFAULT_TEXT_STYLE,
  isPath,
  isScreenAnchored,
  type ObjectRef,
  objectOf,
  objectWindow,
  POINTER_PRESETS,
  pathSpan,
  resolvePointerStyle,
  resolveTransition,
  retimeObject,
  shapeOutsideVideo,
  transitionSpec,
} from "../../core/objects";
import type { Pointer, Project, Shape, Step, Transition, TransitionSpec } from "../../core/schema";
import { api } from "./api";
import { CheckField, Field, FontField, NumField, prune, SegField, SelectField } from "./fields";
import { type MessageKey, t } from "./i18n";
import { Icon, type IconName } from "./icons";
import {
  NEW_OBJECT_KINDS,
  type NewObjectKind,
  newKindLabel,
  objectLabel,
  objectLabels,
  objectMenu,
  objectsByTime,
  patchObject,
} from "./objects-ui";
import { loadChoice, saveChoice } from "./widgets";

type Update = (fn: (p: Project) => Project, key?: string) => void;
type Size = { w: number; h: number };

/** 図形 index の文の入力欄の id(プレビューで文字をダブルクリックしたらここへ移る) */
export const objectTextInputId = (index: number) => `object-text-input-${index}`;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const refKey = (r: ObjectRef) => `${r.kind}:${r.index}`;

/** 色の入力。小さな色見本と色の値を 1 行に並べる。#RRGGBBAA の不透明度(AA)は保つ */
function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const alpha = props.value.length === 9 ? props.value.slice(7) : "";
  return (
    <Field label={props.label}>
      <span className="color-field">
        <input
          type="color"
          value={props.value.slice(0, 7)}
          onChange={(e) => props.onChange(`${e.target.value.toUpperCase()}${alpha}`)}
        />
        <span className="color-value">{props.value.slice(0, 7).toUpperCase()}</span>
      </span>
    </Field>
  );
}

/** 現れ方・消え方。種類を並べたボタンで選び、フェードは長さ、点滅は長さと回数も直せる */
function TransitionField(props: {
  label: string;
  value: TransitionSpec | undefined;
  onChange: (v: TransitionSpec | undefined) => void;
}) {
  const tr = resolveTransition(props.value);
  const explicit: { duration?: number; count?: number } = typeof props.value === "object" ? props.value : {};
  return (
    <div className="row">
      <SegField<Transition>
        label={props.label}
        value={tr.type}
        options={[
          { value: "none", label: t("trNone") },
          { value: "fade", label: t("trFade") },
          { value: "flash", label: t("trFlash") },
        ]}
        onChange={(v) => props.onChange(transitionSpec(v, explicit.duration, explicit.count))}
      />
      {tr.type !== "none" && (
        <NumField
          label={t("trDuration")}
          value={explicit.duration}
          placeholder={String(tr.duration)}
          min={0.05}
          step={0.1}
          onChange={(v) => props.onChange(transitionSpec(tr.type, v, explicit.count))}
        />
      )}
      {tr.type === "flash" && (
        <NumField
          label={t("trCount")}
          value={explicit.count}
          placeholder={String(tr.count)}
          min={1}
          max={20}
          step={1}
          onChange={(v) =>
            props.onChange(transitionSpec("flash", explicit.duration, v === undefined ? v : Math.round(v)))
          }
        />
      )}
    </div>
  );
}

/** 開いたオブジェクトの中の小見出し */
function Group(props: { title: string; children: ReactNode }) {
  return (
    <div className="obj-group">
      <p className="obj-group-title">{props.title}</p>
      {props.children}
    </div>
  );
}

/** 畳める小見出し。開閉はオブジェクトをまたいで覚える。warn なら畳んでいても見出しに印を出す */
function FoldGroup(props: {
  id: string;
  title: string;
  summary: string;
  warn?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(
    () => loadChoice(`objfold.${props.id}`, ["open", "closed"] as const, "closed") === "open",
  );
  return (
    <div className={`obj-group ${open ? "open" : ""}`}>
      <button
        type="button"
        className="obj-group-title toggle"
        aria-expanded={open}
        onClick={() => {
          saveChoice(`objfold.${props.id}`, open ? "closed" : "open");
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {props.title}
        {props.warn && (
          <span className="warn-mark" title={props.warn}>
            ⚠
          </span>
        )}
        {!open && <span className="obj-group-summary">{props.summary}</span>}
      </button>
      {open && props.children}
    </div>
  );
}

/** 録画に追従する図形が録画の外にはみ出しているときの説明(はみ出しがなければ null) */
export function outsideWarning(o: AnyObject, src: Size | null): string | null {
  return src && shapeOutsideVideo(o, src.w, src.h) ? t("outsideVideoTip") : null;
}

/** ステップの詳細のオブジェクトの欄。始まりの時刻の順に並べ、開いた項目に設定を出す(いくつでも開ける) */
export function ObjectsList(props: {
  project: Project;
  index: number;
  update: Update;
  selected: ObjectRef | null;
  stepDuration: number;
  /** ステップの録画の大きさ(録画の外へのはみ出しを調べる) */
  srcSize: Size | null;
  onSelect: (ref: ObjectRef | null) => void;
  onAdd: (kind: NewObjectKind) => void;
  onShapeAnchor: (index: number, anchor: "video" | "screen") => void;
  /** 始まりの時刻を変えたら、再生位置をそこへ移す(ステップ内の時刻) */
  onSeekLocal: (local: number) => void;
  imageSize: (path: string) => Size | null;
  loadImage: (path: string) => Promise<Size | null>;
  imageError: (path: string) => string | null;
}) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const selKey = props.selected ? refKey(props.selected) : null;
  // 別のステップに移ったら、開いた項目を閉じる(番号はステップごと)
  // biome-ignore lint/correctness/useExhaustiveDependencies: ステップが変わったときだけ
  useEffect(() => setOpened(new Set()), [props.index]);
  // タイムライン・プレビューで選んだものはそれだけを開き、ほかは閉じる。このパネルで開いたものは開いた項目に足す
  const fromPanel = useRef(false);
  useEffect(() => {
    const additive = fromPanel.current;
    fromPanel.current = false;
    if (!selKey) return;
    setOpened((s) => (additive ? (s.has(selKey) ? s : new Set(s).add(selKey)) : new Set([selKey])));
  }, [selKey]);
  const selectHere = (ref: ObjectRef | null) => {
    fromPanel.current = true;
    props.onSelect(ref);
  };
  const step = props.project.steps[props.index];
  if (!step) return null;
  const refs = objectsByTime(step, props.stepDuration);
  const labels = objectLabels(step, props.stepDuration);
  const toggle = (ref: ObjectRef) => {
    const k = refKey(ref);
    const next = new Set(opened);
    if (next.has(k)) {
      next.delete(k);
      if (selKey === k) selectHere(null);
    } else {
      next.add(k);
      selectHere(ref);
    }
    setOpened(next);
  };
  return (
    <>
      {refs.length === 0 && <p className="hint">{t("noObjects")}</p>}
      <ol className="item-list">
        {refs.map((ref) => {
          const o = objectOf(step, ref);
          if (!o) return null;
          const k = refKey(ref);
          const open = opened.has(k);
          const selected = selKey === k;
          const w = objectWindow(o, props.stepDuration);
          const warn = outsideWarning(o, props.srcSize);
          return (
            <li key={k} className={open ? "open" : ""}>
              <div className="item-head">
                <button
                  type="button"
                  className={`item-button ${selected ? "selected" : ""}`}
                  aria-expanded={open}
                  onClick={() => (open && !selected ? selectHere(ref) : toggle(ref))}
                >
                  <span className="item-name">{labels.get(k) ?? objectLabel(o, ref.kind)}</span>
                  {warn && (
                    <span className="badge warn" title={warn}>
                      ⚠ {t("outsideBadge")}
                    </span>
                  )}
                  {isScreenAnchored(o) && (
                    <span className="badge" title={t("anchorScreen")}>
                      {t("anchorBadge")}
                    </span>
                  )}
                  <span className="muted">
                    {w.start.toFixed(1)} – {w.end.toFixed(1)}s
                  </span>
                </button>
                {open && (
                  <span className="item-actions">
                    {objectMenu(props.update, props.index, ref, step, selectHere).map((m) => (
                      <button
                        key={m.label}
                        type="button"
                        className="small icon-btn"
                        title={m.shortcut ? `${m.label} (${m.shortcut})` : m.label}
                        aria-label={m.label}
                        disabled={m.disabled}
                        onClick={m.action}
                      >
                        <Icon name={m.icon ?? "duplicate"} />
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {open && <ObjectSection {...props} step={step} ref_={ref} object={o} warn={warn} />}
            </li>
          );
        })}
      </ol>
      <div className="object-add">
        {NEW_OBJECT_KINDS.map((k) => (
          <button key={k} type="button" className="small" onClick={() => props.onAdd(k)}>
            ＋ {newKindLabel(k)}
          </button>
        ))}
      </div>
    </>
  );
}

function ObjectSection(props: {
  project: Project;
  index: number;
  update: Update;
  step: Step;
  ref_: ObjectRef;
  object: AnyObject;
  stepDuration: number;
  warn: string | null;
  onShapeAnchor: (index: number, anchor: "video" | "screen") => void;
  onSeekLocal: (local: number) => void;
  imageSize: (path: string) => Size | null;
  loadImage: (path: string) => Promise<Size | null>;
  imageError: (path: string) => string | null;
}) {
  const { index, update, ref_: ref, object: o } = props;
  const set = (key: string, fn: (o: AnyObject) => AnyObject) =>
    patchObject(update, index, ref, fn, `obj${index}.${ref.kind}${ref.index}.${key}`);
  const setStart = (v: number) => {
    set("start", (x) => retimeObject(x, v, x.end ?? null));
    props.onSeekLocal(v);
  };
  const w = objectWindow(o, props.stepDuration);
  const endField = (
    <NumField
      label={t("end")}
      value={o.end}
      min={0}
      step={0.1}
      placeholder={`${props.stepDuration.toFixed(1)}`}
      title={t("endDefaultStepTip")}
      onChange={(v) => {
        if (v !== undefined && v <= w.start) return;
        set("end", (x) => retimeObject(x, w.start, v === undefined ? null : v));
      }}
    />
  );
  let times: ReactNode;
  if (isPath(o)) {
    const span = pathSpan(o);
    const marker = resolvePointerStyle(props.project, o).preset === "highlighter";
    times = (
      <div className="row">
        <NumField
          label={marker ? t("drawStart") : t("moveStart")}
          value={span.start}
          min={0}
          step={0.1}
          onChange={(v) => v !== undefined && setStart(v)}
        />
        <NumField
          label={marker ? t("drawEnd") : t("moveEnd")}
          value={span.end}
          min={span.start}
          step={0.1}
          onChange={(v) => {
            if (v === undefined || v < span.start) return;
            // 間の点(フリーハンド)は同じ割合で詰める・伸ばす
            const k = span.end > span.start ? (v - span.start) / (span.end - span.start) : 1;
            set("moveEnd", (x) => {
              const p = x as Pointer;
              const path = p.path.map((q, i) => ({
                ...q,
                t: i === p.path.length - 1 ? r3(v) : r3(span.start + (q.t - span.start) * k),
              }));
              return { ...p, path };
            });
          }}
        />
        {endField}
      </div>
    );
  } else {
    times = (
      <div className="row">
        <NumField
          label={t("start")}
          value={(o as Shape).start}
          min={0}
          step={0.1}
          onChange={(v) => v !== undefined && setStart(v)}
        />
        {endField}
      </div>
    );
  }
  const screen = isScreenAnchored(o);

  return (
    <div className="section object">
      <KindFields {...props} set={set} part="content" />
      <Group title={t("groupLook")}>
        <KindFields {...props} set={set} part="look" />
      </Group>
      <Group title={t("groupTime")}>
        {times}
        <TransitionField
          label={t("enter")}
          value={o.enter}
          onChange={(v) => set("enter", (x) => prune({ ...x, enter: v }) as AnyObject)}
        />
        <TransitionField
          label={t("exit")}
          value={o.exit}
          onChange={(v) => set("exit", (x) => prune({ ...x, exit: v }) as AnyObject)}
        />
      </Group>
      <FoldGroup
        id="position"
        title={t("groupPosition")}
        summary={isPath(o) ? "" : screen ? t("anchorScreenShort") : t("anchorVideoShort")}
        warn={props.warn ?? undefined}
      >
        {!isPath(o) && (
          <SegField
            label={t("anchor")}
            value={screen ? "screen" : "video"}
            options={[
              { value: "video", label: t("anchorVideoShort") },
              { value: "screen", label: t("anchorScreenShort") },
            ]}
            title={`${t("anchorVideo")} / ${t("anchorScreen")}`}
            onChange={(v) => props.onShapeAnchor(ref.index, v)}
          />
        )}
        {props.warn && <p className="hint warn">⚠ {props.warn}</p>}
        <KindFields {...props} set={set} part="position" />
      </FoldGroup>
    </div>
  );
}

type SetFn = (key: string, fn: (o: AnyObject) => AnyObject) => void;
type Pt = { x: number; y: number };

/** 位置(始点・終点)の数値 */
function EndsFields(props: { a: Pt; b: Pt; onChange: (a: Pt, b: Pt, key: string) => void }) {
  const { a, b } = props;
  return (
    <>
      <div className="row">
        <NumField
          label={t("fromX")}
          value={a.x}
          step={10}
          onChange={(v) => v !== undefined && props.onChange({ ...a, x: v }, b, "ax")}
        />
        <NumField
          label={t("fromY")}
          value={a.y}
          step={10}
          onChange={(v) => v !== undefined && props.onChange({ ...a, y: v }, b, "ay")}
        />
      </div>
      <div className="row">
        <NumField
          label={t("toX")}
          value={b.x}
          step={10}
          onChange={(v) => v !== undefined && props.onChange(a, { ...b, x: v }, "bx")}
        />
        <NumField
          label={t("toY")}
          value={b.y}
          step={10}
          onChange={(v) => v !== undefined && props.onChange(a, { ...b, y: v }, "by")}
        />
      </div>
    </>
  );
}

function BoxFields(props: {
  rect: { x: number; y: number; w: number; h: number };
  onChange: (r: { x: number; y: number; w: number; h: number }, key: string) => void;
}) {
  const r = props.rect;
  return (
    <div className="row">
      <NumField
        label={t("boxX")}
        value={r.x}
        step={10}
        onChange={(v) => v !== undefined && props.onChange({ ...r, x: v }, "x")}
      />
      <NumField
        label={t("boxY")}
        value={r.y}
        step={10}
        onChange={(v) => v !== undefined && props.onChange({ ...r, y: v }, "y")}
      />
      <NumField
        label={t("boxW")}
        value={r.w}
        step={10}
        min={1}
        onChange={(v) => v && v > 0 && props.onChange({ ...r, w: v }, "w")}
      />
      <NumField
        label={t("boxH")}
        value={r.h}
        step={10}
        min={1}
        onChange={(v) => v && v > 0 && props.onChange({ ...r, h: v }, "h")}
      />
    </div>
  );
}

/** 画像を選んで、その絶対パスを返す(保存するときにプロジェクトからの相対パスに書き換わる) */
async function chooseImage(): Promise<string | null> {
  return api.pickImage();
}

/** ポインターの最初と最後の点を書き換える */
function setEnds(x: AnyObject, a: Pt, b: Pt): AnyObject {
  const q = x as Pointer;
  return {
    ...q,
    path: q.path.map((pt, i) => (i === 0 ? { ...pt, ...a } : i === q.path.length - 1 ? { ...pt, ...b } : pt)),
  };
}

/** ポインターの見た目の選択肢(ボタンのアイコンと名前) */
const POINTER_LOOKS: { value: string; icon: IconName; label: MessageKey }[] = [
  { value: "arrow", icon: "ptrArrow", label: "pointerArrow" },
  { value: "dot", icon: "ptrDot", label: "pointerDot" },
  { value: "ring", icon: "ptrRing", label: "pointerRing" },
  { value: "highlighter", icon: "ptrHighlighter", label: "pointerHighlighter" },
  { value: "image", icon: "ptrImage", label: "pointerImage" },
];

/**
 * 種類ごとの設定。part で出す部分を選ぶ: content は中身(テキストの文・四角の画像)、look は見た目、
 * position は位置の数値
 */
function KindFields(props: {
  project: Project;
  ref_: ObjectRef;
  object: AnyObject;
  set: SetFn;
  part: "content" | "look" | "position";
  imageSize: (path: string) => Size | null;
  loadImage: (path: string) => Promise<Size | null>;
  imageError: (path: string) => string | null;
}) {
  const { project, ref_: ref, object: o, set, part } = props;
  const setStyle = (key: string, patch: Record<string, unknown>) =>
    set(`style.${key}`, (x) => {
      const style = prune({ ...((x as { style?: object }).style ?? {}), ...patch });
      const { style: _s, ...rest } = x as AnyObject & { style?: object };
      return (style ? { ...rest, style } : rest) as AnyObject;
    });

  if (isPath(o)) {
    const first = o.path[0] as Pt;
    const last = o.path[o.path.length - 1] as Pt;
    if (part === "position")
      return <EndsFields a={first} b={last} onChange={(a, b, key) => set(key, (x) => setEnds(x, a, b))} />;
    if (part === "content" || ref.kind !== "pointer") return null;
    const p = o as Pointer;
    const st = resolvePointerStyle(project, p);
    const sizeField = (
      <NumField
        label={t("pointerSize")}
        title={t("unitPx1080")}
        value={p.style?.size}
        placeholder={String(st.size)}
        min={4}
        step={4}
        onChange={(v) => setStyle("size", { size: v })}
      />
    );
    const colorField = (
      <ColorField label={t("color")} value={st.color} onChange={(v) => setStyle("color", { color: v })} />
    );
    // 見た目を選ぶと、その下の行が見た目に合った設定に変わる
    const projectPreset = project.styles?.pointer?.preset ?? DEFAULT_POINTER_STYLE.preset;
    return (
      <>
        <SegField
          label={t("pointerPreset")}
          value={st.preset}
          options={POINTER_LOOKS.map((l) => ({
            value: l.value,
            label: t(l.label),
            icon: <Icon name={l.icon} />,
          }))}
          onChange={async (v) => {
            if (v === "image") {
              const path = await chooseImage();
              if (path) setStyle("image", { image: path });
              return;
            }
            setStyle("preset", { preset: v === projectPreset ? undefined : v, image: undefined });
          }}
        />
        {st.preset === "arrow" && <div className="row">{sizeField}</div>}
        {(st.preset === "dot" || st.preset === "ring") && (
          <div className="row">
            {colorField}
            {sizeField}
          </div>
        )}
        {st.preset === "highlighter" && (
          <div className="row">
            {colorField}
            <NumField
              label={t("lineWidth")}
              title={t("unitSrcPx")}
              value={p.style?.width}
              placeholder={String(st.width)}
              min={1}
              step={2}
              onChange={(v) => setStyle("width", { width: v })}
            />
            <NumField
              label={t("opacity")}
              value={p.style?.opacity}
              placeholder={String(st.opacity)}
              min={0}
              max={1}
              step={0.1}
              onChange={(v) => setStyle("opacity", { opacity: v })}
            />
          </div>
        )}
        {st.image && (
          <>
            <div className="row">
              <button
                type="button"
                className="small"
                onClick={async () => {
                  const path = await chooseImage();
                  if (path) setStyle("image", { image: path });
                }}
              >
                {t("chooseImage")}
              </button>
              {sizeField}
            </div>
            <ImagePath path={st.image} error={props.imageError(st.image)} />
          </>
        )}
        {st.preset !== "highlighter" && (
          <CheckField
            label={t("clickRipple")}
            value={p.click ?? false}
            onChange={(v) => set("click", (x) => prune({ ...x, click: v || undefined }) as AnyObject)}
          />
        )}
      </>
    );
  }

  const s = o as Shape;
  // 図形の長さの単位(画面に固定なら 1080p 基準の px)
  const unit = isScreenAnchored(s) ? t("unitPx1080") : t("unitSrcPx");
  const setRect = (r: { x: number; y: number; w: number; h: number }, key: string) =>
    set(`rect.${key}`, (x) => ({ ...(x as Shape), rect: r }) as AnyObject);
  if (part === "position") {
    if (s.type === "arrow")
      return (
        <EndsFields
          a={s.from}
          b={s.to}
          onChange={(a, b, key) => set(key, (x) => ({ ...(x as Shape), from: a, to: b }) as AnyObject)}
        />
      );
    return <BoxFields rect={s.rect} onChange={setRect} />;
  }

  if (s.type === "rect") {
    if (part === "content") {
      // 中に描く画像。線は画像の枠、塗りは透明な所に見える
      const size = s.image ? props.imageSize(s.image) : null;
      const setImage = (image: string | undefined) =>
        set("image", (x) => prune({ ...(x as Shape), image }) as AnyObject);
      const pick = async () => {
        const path = await chooseImage();
        if (!path) return;
        // 画像の縦横比に合わせて高さを変える(幅は保つ)
        const sz = await props.loadImage(path);
        set("image", (x) => {
          const r = x as Extract<Shape, { type: "rect" }>;
          const rect = sz ? { ...r.rect, h: Math.max(1, Math.round((r.rect.w * sz.h) / sz.w)) } : r.rect;
          return { ...r, image: path, rect };
        });
      };
      if (!s.image)
        return (
          <div className="row">
            <button type="button" className="small" onClick={pick}>
              {t("addImage")}
            </button>
          </div>
        );
      return (
        <>
          <ImagePath path={s.image} error={props.imageError(s.image)} />
          <div className="row">
            <button type="button" className="small" onClick={pick}>
              {t("chooseImage")}
            </button>
            <button
              type="button"
              className="small"
              disabled={!size}
              onClick={() =>
                size && setRect({ ...s.rect, h: Math.round((s.rect.w * size.h) / size.w) }, "aspect")
              }
            >
              {t("imageAspect")}
            </button>
            <button type="button" className="small" onClick={() => setImage(undefined)}>
              {t("removeImage")}
            </button>
          </div>
        </>
      );
    }
    const st = { ...DEFAULT_RECT_STYLE, ...project.styles?.rect, ...s.style };
    // 線・塗りはチェックで出す・消す(消すと太さ・不透明度を 0 にする)。出すときは共通の値、それも 0 なら既定の値
    const common = { ...DEFAULT_RECT_STYLE, ...project.styles?.rect };
    const strokeOn = st.strokeWidth > 0;
    const fillOn = st.fillOpacity > 0;
    return (
      <>
        <div className="row">
          <CheckField
            label={t("stroke")}
            value={strokeOn}
            onChange={(v) =>
              setStyle("strokeWidth", {
                strokeWidth: v ? (common.strokeWidth > 0 ? undefined : DEFAULT_RECT_STYLE.strokeWidth) : 0,
              })
            }
          />
          {strokeOn && (
            <>
              <ColorField
                label={t("color")}
                value={st.stroke}
                onChange={(v) => setStyle("stroke", { stroke: v })}
              />
              <NumField
                label={t("lineWidth")}
                title={`${t("strokeWidthTip")} (${unit})`}
                value={s.style?.strokeWidth}
                placeholder={String(st.strokeWidth)}
                min={0}
                step={1}
                onChange={(v) => setStyle("strokeWidth", { strokeWidth: v })}
              />
            </>
          )}
          <NumField
            label={t("radius")}
            title={unit}
            value={s.style?.radius}
            placeholder={String(st.radius)}
            min={0}
            step={2}
            onChange={(v) => setStyle("radius", { radius: v })}
          />
        </div>
        <div className="row">
          <CheckField
            label={t("fill")}
            value={fillOn}
            onChange={(v) =>
              setStyle("fillOpacity", { fillOpacity: v ? (common.fillOpacity > 0 ? undefined : 1) : 0 })
            }
          />
          {fillOn && (
            <>
              <ColorField
                label={t("color")}
                value={st.fill}
                onChange={(v) => setStyle("fill", { fill: v })}
              />
              <NumField
                label={t("opacity")}
                title={t("fillOpacityTip")}
                value={s.style?.fillOpacity}
                placeholder={String(st.fillOpacity)}
                min={0}
                max={1}
                step={0.1}
                onChange={(v) => setStyle("fillOpacity", { fillOpacity: v })}
              />
            </>
          )}
        </div>
      </>
    );
  }
  if (s.type === "arrow") {
    if (part === "content") return null;
    const st = { ...DEFAULT_ARROW_STYLE, ...project.styles?.arrow, ...s.style };
    return (
      <div className="row">
        <ColorField label={t("color")} value={st.color} onChange={(v) => setStyle("color", { color: v })} />
        <NumField
          label={t("lineWidth")}
          title={unit}
          value={s.style?.width}
          placeholder={String(st.width)}
          min={1}
          step={2}
          onChange={(v) => setStyle("width", { width: v })}
        />
        <NumField
          label={t("arrowHead")}
          title={t("arrowHeadTip")}
          value={s.style?.head}
          placeholder={String(st.head)}
          min={1}
          step={0.5}
          onChange={(v) => setStyle("head", { head: v })}
        />
      </div>
    );
  }
  // テキスト
  if (part === "content")
    return (
      <textarea
        id={objectTextInputId(ref.index)}
        className="object-text"
        aria-label={t("objText")}
        rows={2}
        value={s.text}
        onChange={(e) => set("text", (x) => ({ ...(x as Shape), text: e.target.value }) as AnyObject)}
      />
    );
  const st = { ...DEFAULT_TEXT_STYLE, ...project.styles?.text, ...s.style };
  const boxOn = captionBoxColor(st.background) !== null;
  return (
    <>
      <FontField
        label={t("font")}
        value={s.style?.font}
        placeholder={`${t("defaultFont")} (${st.font})`}
        onChange={(v) => setStyle("font", { font: v })}
      />
      <div className="row">
        <NumField
          label={t("textSize")}
          title={unit}
          value={s.style?.size}
          placeholder={String(st.size)}
          min={4}
          step={2}
          onChange={(v) => setStyle("size", { size: v })}
        />
        <ColorField label={t("color")} value={st.color} onChange={(v) => setStyle("color", { color: v })} />
        <SelectField
          label={t("align")}
          value={st.align}
          options={[
            { value: "left", label: t("alignLeft") },
            { value: "center", label: t("alignCenter") },
            { value: "right", label: t("alignRight") },
          ]}
          onChange={(v) => setStyle("align", { align: v === DEFAULT_TEXT_STYLE.align ? undefined : v })}
        />
      </div>
      <div className="row">
        <CheckField
          label={t("textBox")}
          value={boxOn}
          onChange={(v) =>
            setStyle("background", { background: v ? DEFAULT_TEXT_STYLE.background : "#00000000" })
          }
        />
        {boxOn && (
          <ColorField
            label={t("boxColor")}
            value={st.background}
            onChange={(v) => setStyle("background", { background: v })}
          />
        )}
      </div>
    </>
  );
}

function ImagePath(props: { path: string; error: string | null }) {
  return (
    <>
      <p className="hint path" title={props.path}>
        {props.path.replace(/^.*[\\/]/, "")}
      </p>
      {props.error && (
        <p className="hint error">
          {t("imageMissing")}: {props.error}
        </p>
      )}
    </>
  );
}

/** 全体の設定: オブジェクトの見た目の共通の値(個別の値がなければこれを使う) */
export function ObjectDefaults(props: { project: Project; update: Update }) {
  const { project, update } = props;
  const styles = project.styles ?? {};
  const setStyle = <K extends "pointer" | "rect" | "arrow" | "text">(
    kind: K,
    patch: Record<string, unknown>,
  ) =>
    update(
      (p) => ({
        ...p,
        styles: prune({ ...p.styles, [kind]: prune({ ...(p.styles?.[kind] ?? {}), ...patch }) }),
      }),
      `styles.${kind}.${Object.keys(patch).join(",")}`,
    );
  const ptr = { ...DEFAULT_POINTER_STYLE, ...styles.pointer };
  const rc = { ...DEFAULT_RECT_STYLE, ...styles.rect };
  const ar = { ...DEFAULT_ARROW_STYLE, ...styles.arrow };
  const tx = { ...DEFAULT_TEXT_STYLE, ...styles.text };
  return (
    <div className="section">
      <p className="field-label">{t("objPointer")}</p>
      <div className="row">
        <SegField
          label={t("pointerPreset")}
          value={ptr.preset}
          options={POINTER_LOOKS.filter((l) => (POINTER_PRESETS as readonly string[]).includes(l.value)).map(
            (l) => ({ value: l.value, label: t(l.label), icon: <Icon name={l.icon} /> }),
          )}
          onChange={(v) =>
            setStyle("pointer", { preset: v === DEFAULT_POINTER_STYLE.preset ? undefined : v })
          }
        />
        <NumField
          label={t("pointerSize")}
          value={styles.pointer?.size}
          placeholder={String(DEFAULT_POINTER_STYLE.size)}
          min={4}
          step={4}
          onChange={(v) => setStyle("pointer", { size: v })}
        />
      </div>
      <p className="field-label">{t("objRect")}</p>
      <div className="row">
        <ColorField label={t("stroke")} value={rc.stroke} onChange={(v) => setStyle("rect", { stroke: v })} />
        <NumField
          label={t("strokeWidth")}
          value={styles.rect?.strokeWidth}
          placeholder={String(DEFAULT_RECT_STYLE.strokeWidth)}
          min={0}
          step={1}
          onChange={(v) => setStyle("rect", { strokeWidth: v })}
        />
        <ColorField label={t("fill")} value={rc.fill} onChange={(v) => setStyle("rect", { fill: v })} />
        <NumField
          label={t("fillOpacity")}
          value={styles.rect?.fillOpacity}
          placeholder={String(DEFAULT_RECT_STYLE.fillOpacity)}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => setStyle("rect", { fillOpacity: v })}
        />
      </div>
      <p className="field-label">{t("objArrow")}</p>
      <div className="row">
        <ColorField label={t("color")} value={ar.color} onChange={(v) => setStyle("arrow", { color: v })} />
        <NumField
          label={t("arrowWidth")}
          value={styles.arrow?.width}
          placeholder={String(DEFAULT_ARROW_STYLE.width)}
          min={1}
          step={2}
          onChange={(v) => setStyle("arrow", { width: v })}
        />
        <NumField
          label={t("arrowHead")}
          value={styles.arrow?.head}
          placeholder={String(DEFAULT_ARROW_STYLE.head)}
          min={1}
          step={0.5}
          onChange={(v) => setStyle("arrow", { head: v })}
        />
      </div>
      <p className="field-label">{t("objText")}</p>
      <FontField
        label={t("font")}
        value={styles.text?.font}
        placeholder={`${t("defaultFont")} (${DEFAULT_TEXT_STYLE.font})`}
        onChange={(v) => setStyle("text", { font: v })}
      />
      <div className="row">
        <NumField
          label={t("textSize")}
          value={styles.text?.size}
          placeholder={String(DEFAULT_TEXT_STYLE.size)}
          min={4}
          step={2}
          onChange={(v) => setStyle("text", { size: v })}
        />
        <ColorField label={t("color")} value={tx.color} onChange={(v) => setStyle("text", { color: v })} />
      </div>
    </div>
  );
}
