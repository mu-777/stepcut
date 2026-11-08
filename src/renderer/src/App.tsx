import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { captionWindow } from "../../core/captions";
import { resolveLayout, resolveOutput, speechPieces, withSpeechPieces } from "../../core/defaults";
import {
  canMergeSteps,
  deleteStep,
  duplicateStep,
  mergeSteps,
  moveStep,
  newProject,
  splitStep,
  uniqueStepId,
} from "../../core/edit";
import {
  computeLayout,
  marginOf,
  retimeZoom,
  setZoomKeyRect,
  sortedKeys,
  viewRectAt,
  zoomRectAt,
} from "../../core/layout";
import type { Project, Zoom, ZoomKey } from "../../core/schema";
import { buildTimeline, locate, totalDuration } from "../../core/timeline";
import { parseProject, parseProjectText, serializeProject } from "../../core/validate";
import type { Voice } from "../../shared/api";
import { api } from "./api";
import { BackgroundStore } from "./backgrounds";
import { exportProject } from "./exporter";
import { commit, type History, initHistory, redo, undo } from "./history";
import { t } from "./i18n";
import { Icon } from "./icons";
import { type PanelView, ProjectPanel, StepDetail, viewOf } from "./inspector";
import { openMedia, type SourceMedia } from "./media";
import { PLAYBACK_RATES, type Player, type PlayerState } from "./player";
import { Preview } from "./preview";
import { SpeechStore } from "./speech";
import { StepRail } from "./step-rail";
import { ThumbCache } from "./thumbs";
import { fmtTime, insertZoom, type MenuItem, type Selection, selectedStep, Timeline } from "./timeline";
import {
  ContextMenu,
  loadChoice,
  loadPref,
  ShortcutsDialog,
  Splitter,
  saveChoice,
  savePref,
} from "./widgets";

/** ズームの範囲の編集。key は編集中の枠(時刻の順の番号) */
type DrawingZoom = { step: number; zoom: number; key: number };

/** 文字を入力中か。チェックボックス・スライダー・選択欄は含めない(Ctrl+Z を文字の取り消しに回さないため) */
const TEXT_INPUTS = new Set(["text", "number", "search", "url", "email", "password", "tel", ""]);
const isTyping = () => {
  const el = document.activeElement;
  return (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) || el instanceof HTMLTextAreaElement;
};

export function App() {
  const [hist, setHist] = useState<History>(() => initHistory(newProject()));
  const project = hist.present;
  const [filePath, setFilePath] = useState<string | null>(null);
  const [savedText, setSavedText] = useState(() => serializeProject(newProject()));
  const [selection, setSelection] = useState<Selection>({ kind: "project" });
  const [media, setMedia] = useState<Map<string, SourceMedia>>(new Map());
  const [mediaErrors, setMediaErrors] = useState<string[]>([]);
  const [speechVersion, setSpeechVersion] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  useEffect(() => playerRef.current?.setMuted(muted), [muted]);
  const [trimPreview, setTrimPreview] = useState<{ step: number; time: number } | null>(null);
  const [drawingZoom, setDrawingZoom] = useState<DrawingZoom | null>(null);
  /** プレビュー上でテロップの文字を入力中のステップ */
  const [captionEdit, setCaptionEdit] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** 枠の拡大縮小の基準。中心固定(既定)か、反対側の角・辺を固定 */
  const [anchor, setAnchor] = useState(() =>
    loadChoice("boxAnchor", ["center", "corner"] as const, "center"),
  );
  useEffect(() => saveChoice("boxAnchor", anchor), [anchor]);
  /** ズームの枠の大きさを全部の枠でそろえる(編集の設定。ファイルには保存しない) */
  const [syncSize, setSyncSize] = useState(
    () => loadChoice("zoomSyncSize", ["on", "off"] as const, "on") === "on",
  );
  useEffect(() => saveChoice("zoomSyncSize", syncSize ? "on" : "off"), [syncSize]);
  /** 読み上げの試聴中のステップ */
  const [speechPlaying, setSpeechPlaying] = useState<number | null>(null);
  /** コピーしたズーム(アプリ内だけで持つ)。録画の大きさが違うステップへ貼るときに換算する */
  const zoomClipboard = useRef<{ zoom: Zoom; srcW: number; srcH: number } | null>(null);
  const [hasZoomClip, setHasZoomClip] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [banner, setBanner] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** 設定パネルに出しているもの(全体の設定か、ステップの詳細) */
  const [view, setView] = useState<PanelView>("step");
  /** ステップの「共通の設定 ›」から全体の設定へ来た(テロップの見た目の欄を強調する) */
  const [sharedFocus, setSharedFocus] = useState(false);
  const [panelW, setPanelW] = useState(() => loadPref("panelWidth", 320));
  const [timelineH, setTimelineH] = useState(() => loadPref("timelineHeight", 190));
  /** プレビューの表示倍率(1 = 全体表示)。書き出しには影響しない */
  const [viewZoom, setViewZoom] = useState(1);
  useEffect(() => savePref("panelWidth", panelW), [panelW]);
  useEffect(() => savePref("timelineHeight", timelineH), [timelineH]);
  const [thumbsVersion, setThumbsVersion] = useState(0);
  const thumbs = useMemo(() => new ThumbCache(() => setThumbsVersion((v) => v + 1)), []);
  const [bgVersion, setBgVersion] = useState(0);
  const backgrounds = useMemo(() => new BackgroundStore(() => setBgVersion((v) => v + 1)), []);
  const speech = useMemo(() => new SpeechStore(), []);
  const playerRef = useRef<Player | null>(null);

  const dirty = serializeProject(project) !== savedText;
  // biome-ignore lint/correctness/useExhaustiveDependencies: speechVersion で読み上げの長さの更新を拾う
  const speechDurations = useMemo(() => speech.durations(project), [project, speechVersion]);
  const timeline = useMemo(() => buildTimeline(project.steps, speechDurations), [project, speechDurations]);
  const total = totalDuration(timeline);
  const issues = useMemo(() => {
    const r = parseProject(project);
    return [...(r.ok ? [] : r.errors), ...r.warnings];
  }, [project]);
  const selected = selectedStep(selection);
  // 要素を選んだら、それを直す画面(全体の設定かステップの詳細)に切り替える
  useEffect(() => {
    const v = viewOf(selection);
    if (v) {
      setView(v);
      setSharedFocus(false);
    }
  }, [selection]);

  const update = useCallback((fn: (p: Project) => Project, key?: string) => {
    setHist((h) => commit(h, fn(h.present), key ?? null));
  }, []);

  // 状態は ref 経由でプレーヤーに渡す(再生中のループが古い値を見ないように)
  const playerState: PlayerState = {
    project,
    timeline,
    media,
    speech,
    sourceView: trimPreview ? { stepIndex: trimPreview.step, time: trimPreview.time } : null,
    ignoreZoom: drawingZoom !== null,
    thumbs,
    backgrounds,
    projectPath: filePath,
    captionPlaceholder: t("captionPlaceholder"),
    hideCaptionStep: captionEdit,
  };
  const stateRef = useRef(playerState);
  stateRef.current = playerState;

  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    api.ttsVoices("os").then(setVoices, () => setVoices([]));
  }, []);

  // 素材を開く
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = new Map<string, SourceMedia>();
      const errors: string[] = [];
      for (const s of project.sources) {
        try {
          next.set(s.id, await openMedia(await api.resolveSource(filePath, s.path)));
        } catch (e) {
          errors.push(`${s.id}: ${(e as Error).message}`);
        }
      }
      if (alive) {
        setMedia(next);
        setMediaErrors(errors);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project.sources, filePath]);

  // 読み上げを用意する(入力が落ち着いてから)
  useEffect(() => {
    const timer = setTimeout(() => {
      speech.loadAll(project, () => setSpeechVersion((v) => v + 1));
      setSpeechVersion((v) => v + 1);
    }, 600);
    return () => clearTimeout(timer);
  }, [project, speech]);

  // 停止中の表示を更新する。画面に出す前に描き直し、編集中の枠と映像を同じフレームで動かす
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示に関わる値が変わったら描き直す
  useLayoutEffect(() => {
    playerRef.current?.renderStill();
  }, [project, timeline, media, trimPreview, drawingZoom, bgVersion, captionEdit]);

  // 選択が範囲外になったら(削除・外部変更)プロジェクトの選択に戻す
  useEffect(() => {
    if (selected !== null && selected >= project.steps.length) setSelection({ kind: "project" });
  }, [selected, project.steps.length]);

  const loadProject = useCallback((path: string, text: string, keepHistory: boolean) => {
    const r = parseProjectText(text);
    if (!r.ok) {
      setBanner({ kind: "error", text: r.errors.map((e) => `${e.path}: ${e.message}`).join("\n") });
      return false;
    }
    setHist((h) => (keepHistory ? commit(h, r.project) : initHistory(r.project)));
    setFilePath(path);
    setSavedText(serializeProject(r.project));
    setBanner(null);
    if (!keepHistory) {
      setSelection({ kind: "project" });
      playerRef.current?.seek(0);
    }
    return true;
  }, []);

  const confirmDiscard = () => !dirty || window.confirm(t("discardConfirm"));

  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    new: () => {
      if (!confirmDiscard()) return;
      const p = newProject();
      setHist(initHistory(p));
      setSavedText(serializeProject(p));
      setFilePath(null);
      setSelection({ kind: "project" });
    },
    open: async () => {
      if (!confirmDiscard()) return;
      const r = await api.openProjectDialog();
      if (r) loadProject(r.filePath, r.text, false);
    },
    save: () => save(filePath),
    saveAs: () => save(null),
    addSource: async () => {
      const paths = await api.pickSources();
      if (!paths.length) return;
      let p = project;
      for (const path of paths) {
        try {
          const m = await openMedia(path);
          let n = p.sources.length + 1;
          while (p.sources.some((s) => s.id === `rec${n}`)) n++;
          const id = `rec${n}`;
          p = {
            ...p,
            sources: [...p.sources, { id, path }],
            steps: [
              ...p.steps,
              {
                id: uniqueStepId(p, "step"),
                source: id,
                in: 0,
                out: Math.round(m.duration * 1000) / 1000,
                // テロップは空で付けておく(プレビューには仮の文を出し、書き出しには出さない)
                caption: { text: "" },
                // テロップと同じ文を読む(既定でオン)
                speech: {},
              },
            ],
          };
        } catch (e) {
          setBanner({ kind: "error", text: (e as Error).message });
        }
      }
      update(() => p);
      setSelection({ kind: "step", step: p.steps.length - 1 });
    },
    export: () => doExport(),
    shortcuts: () => setShortcutsOpen(true),
    undo: () => (isTyping() ? document.execCommand("undo") : setHist(undo)),
    redo: () => (isTyping() ? document.execCommand("redo") : setHist(redo)),
  };

  async function save(path: string | null) {
    const r = await api.saveProject(path, serializeProject(project), filePath);
    if (r) loadProject(r.filePath, r.text, true);
  }

  async function doExport() {
    if (issues.some((i) => !i.message.includes("M2"))) {
      setBanner({ kind: "error", text: issues.map((e) => `${e.path}: ${e.message}`).join("\n") });
      return;
    }
    const outPath = await api.pickExportPath(
      filePath ? filePath.replace(/(\.sanno)?\.json$/i, ".mp4") : "output.mp4",
    );
    if (!outPath) return;
    playerRef.current?.stop();
    setExporting({ done: 0, total: 1 });
    try {
      const r = await exportProject({
        project,
        projectPath: filePath,
        outPath,
        speech,
        onProgress: (done, totalFrames) => {
          if (done % 10 === 0 || done === totalFrames) setExporting({ done, total: totalFrames });
        },
      });
      setBanner({ kind: "info", text: [`${t("exportDone")}: ${r.outPath}`, ...r.warnings].join("\n") });
    } catch (e) {
      setBanner({ kind: "error", text: `${t("exportFailed")}: ${(e as Error).message}` });
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => api.onMenu((cmd) => actions.current[cmd]?.()), []);

  useEffect(() => {
    api.initialProject().then((p) => p && loadProject(p.filePath, p.text, false));
  }, [loadProject]);

  useEffect(
    () =>
      api.onExternalChange((p) => {
        const r = parseProjectText(p.text);
        if (!r.ok) {
          setBanner({
            kind: "error",
            text: `${t("externalInvalid")}\n${r.errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`,
          });
          return;
        }
        // 未保存の変更がなければそのまま読み込む(AI-05)。あれば確認する(AI-06)
        if (dirtyRef.current && !window.confirm(t("externalChange"))) return;
        loadProject(p.filePath, p.text, true);
      }),
    [loadProject],
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  /** 選んだ要素を消す(Delete キー) */
  const deleteSelection = () => {
    const s = selection;
    if (!("step" in s)) return;
    const patch = (fn: (st: Project["steps"][number]) => Project["steps"][number]) =>
      update((p) => ({ ...p, steps: p.steps.map((st, i) => (i === s.step ? fn(st) : st)) }));
    if (s.kind === "step") {
      update((p) => deleteStep(p, s.step));
      setSelection({ kind: "project" });
      return;
    }
    if (s.kind === "zoom") patch((st) => ({ ...st, zooms: st.zooms?.filter((_, i) => i !== s.index) }));
    else if (s.kind === "hold") patch((st) => ({ ...st, holds: st.holds?.filter((_, i) => i !== s.index) }));
    else if (s.kind === "caption") patch((st) => ({ ...st, caption: undefined }));
    else if (s.kind === "speech")
      patch((st) =>
        withSpeechPieces(
          st,
          speechPieces(st).filter((_, k) => k !== s.index),
        ),
      );
    setSelection({ kind: "step", step: s.step });
  };

  // キー操作は一般的な動画編集アプリに合わせる(docs/decisions/20261029-timeline-ui.md)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (isTyping()) return;
    const pl = playerRef.current;
    if (!pl) return;
    const changeRate = (r: number) => {
      setRate(r);
      pl.setRate(r);
      if (!pl.playing) pl.play();
    };
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const boundaries = [0, ...timeline.map((x) => x.start + x.duration)];
    let handled = true;
    // 録画の枠・ズームの枠を編集中は、矢印キーで 10px ずつ動かす(Shift で 1px。シークの Shift と同じく細かく)
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    if (
      arrow &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      nudgeBox(arrow[0] as number, arrow[1] as number, e.shiftKey)
    ) {
      e.preventDefault();
      return;
    }
    if (key === "Escape") {
      setDrawingZoom(null);
      stopSpeech();
      if (selection.kind === "video") setSelection({ kind: "project" });
    } else if (key === " ") {
      if (pl.playing) pl.stop();
      else {
        if (pl.rate < 0) changeRate(1);
        pl.play();
      }
    } else if (key === "k" && !e.ctrlKey && !e.metaKey) pl.stop();
    else if (key === "l") changeRate(pl.playing && pl.rate >= 1 ? Math.min(3, Math.floor(pl.rate) + 1) : 1);
    else if (key === "j") changeRate(pl.playing && pl.rate < 0 ? Math.max(-3, pl.rate - 1) : -1);
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      // ←→ は 1 秒、Shift+←→ は 1 フレーム
      const d = e.shiftKey ? 1 / resolveOutput(project).fps : 1;
      pl.seek(pl.time + (key === "ArrowLeft" ? -d : d));
    } else if (key === "ArrowUp") pl.seek([...boundaries].reverse().find((b) => b < pl.time - 1e-3) ?? 0);
    else if (key === "ArrowDown") pl.seek(boundaries.find((b) => b > pl.time + 1e-3) ?? total);
    else if (key === "Home") pl.seek(0);
    else if (key === "End") pl.seek(total);
    else if (key === "k" && (e.ctrlKey || e.metaKey)) {
      const l = locate(timeline, pl.time);
      if (l) update((p) => splitStep(p, l.entry.index, l.local, true));
    } else if (key === "Delete" || key === "Backspace") deleteSelection();
    else if (key === "z" && !e.ctrlKey && !e.metaKey) addZoomAtPlayhead();
    else if (key === "f" && !e.ctrlKey && !e.metaKey) toggleFullscreen();
    else if (key === "m" && !e.ctrlKey && !e.metaKey) setMuted((m) => !m);
    else handled = false;
    if (handled) e.preventDefault();
  };
  // タイムライン・プレビューの操作を始めたら入力欄からフォーカスを外す。ドラッグは押下の既定動作を止めるので
  // フォーカスが入力欄に残り、Ctrl+Z が文字の取り消しに回って編集を戻せなくなるため
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("input, textarea, select, label, button, [contenteditable]")) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el !== document.body) el.blur();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  // 枠の編集(ズーム・録画)は、プレビューの外のクリックでも終える。プレビュー上のクリックは BoxEditor・Preview が扱う。
  // タイムライン・再生操作のクリックと再生の開始でも終える(タイムラインのズームのクリックはその後で編集を始め直す)。
  // 数値で直せるよう設定のパネルと操作の帯では終えない
  const endBoxEditRef = useRef(() => {});
  endBoxEditRef.current = () => {
    if (drawingZoom) setDrawingZoom(null);
    if (selection.kind === "video") setSelection({ kind: "project" });
  };
  useEffect(() => {
    if (playing) endBoxEditRef.current();
  }, [playing]);
  useEffect(() => {
    const keep = ".preview-stage, .preview-tools, .panel, .context-menu, .dialog-backdrop";
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (e.button !== 0 || !target || target.closest(keep)) return;
      endBoxEditRef.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loc = locate(timeline, time);
  const selStep = selected !== null ? project.steps[selected] : undefined;
  const selMedia = selStep ? media.get(selStep.source) : undefined;
  // パネルで直すステップ。選んだ要素のステップ、なければ再生位置のステップ
  const target = selected ?? loc?.entry.index ?? null;
  const tgtStep = target !== null ? project.steps[target] : undefined;
  const playheadLocal = loc && target === loc.entry.index ? loc.local : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: speechVersion で生成の進み具合を拾う
  const speechStatus = useMemo(() => {
    if (!tgtStep) return null;
    return {
      error: speech.error(project, tgtStep),
      pending: speech.isPending(project, tgtStep),
      durations: speech.stepDurations(project, tgtStep),
    };
  }, [tgtStep, project, speech, speechVersion]);

  /**
   * 選んでいる枠を矢印キーで動かす。録画の枠は出力の、ズームの枠は録画のピクセル単位。fine なら 1px、それ以外は 10px。
   * 動かしたら true
   */
  const nudgeBox = (dx: number, dy: number, fine: boolean): boolean => {
    const n = fine ? 1 : 10;
    if (drawingZoom) {
      const st = project.steps[drawingZoom.step];
      const z = st?.zooms?.[drawingZoom.zoom];
      const m = st ? media.get(st.source) : undefined;
      if (!z) return false;
      const w = m?.width ?? 1920;
      const h = m?.height ?? 1080;
      const r = sortedKeys(z)[drawingZoom.key]?.rect;
      if (!r) return false;
      const moved = {
        ...r,
        x: Math.min(Math.max(0, r.x + dx * n), Math.max(0, w - r.w)),
        y: Math.min(Math.max(0, r.y + dy * n), Math.max(0, h - r.h)),
      };
      update(
        (p) => ({
          ...p,
          steps: p.steps.map((s, i) =>
            i === drawingZoom.step
              ? {
                  ...s,
                  zooms: s.zooms?.map((x, k) =>
                    k === drawingZoom.zoom ? setZoomKeyRect(x, drawingZoom.key, moved, false, w, h) : x,
                  ),
                }
              : s,
          ),
        }),
        "nudge-zoom",
      );
      return true;
    }
    if (selection.kind === "video" && !playing) {
      const src = locMedia ?? [...media.values()][0];
      const v = computeLayout(
        out.width,
        out.height,
        resolveLayout(project),
        src?.width ?? 1920,
        src?.height ?? 1080,
      ).video;
      update(
        (p) => ({
          ...p,
          layout: {
            ...p.layout,
            margin: marginOf({ ...v, x: v.x + dx * n, y: v.y + dy * n }, out.width, out.height),
          },
        }),
        "nudge-video",
      );
      return true;
    }
    return false;
  };

  /** ステップ一覧から選ぶ。再生ヘッドがそのステップの外なら先頭へ移す */
  const selectStep = (i: number) => {
    setSelection({ kind: "step", step: i });
    setDrawingZoom(null);
    const e = timeline[i];
    if (e && !(loc && loc.entry.index === i)) playerRef.current?.seek(e.start);
  };

  /** タイムラインで要素を選ぶ。ズームを選んだら範囲の編集を始め、別の要素を選んだら終える */
  const select = (s: Selection) => {
    setSelection(s);
    if (s.kind === "zoom") {
      if (!(drawingZoom && s.step === drawingZoom.step && s.index === drawingZoom.zoom)) {
        playerRef.current?.stop();
        // 再生位置にいちばん近い枠を編集する
        const z = project.steps[s.step]?.zooms?.[s.index];
        const local = (playerRef.current?.time ?? time) - (timeline[s.step]?.start ?? 0);
        const keys = z ? sortedKeys(z) : [];
        let key = 0;
        keys.forEach((k, i) => {
          if (Math.abs(k.t - local) < Math.abs((keys[key]?.t ?? 0) - local)) key = i;
        });
        setDrawingZoom({ step: s.step, zoom: s.index, key });
      }
    } else if (drawingZoom) setDrawingZoom(null);
    if (speechPlaying !== null && "step" in s && s.step !== speechPlaying) stopSpeech();
  };

  const stepMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    selectStep(i);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t("moveStepUp"),
          disabled: i === 0,
          action: () => {
            update((p) => moveStep(p, i, i - 1));
            setSelection({ kind: "step", step: i - 1 });
          },
        },
        {
          label: t("moveStepDown"),
          disabled: i >= project.steps.length - 1,
          action: () => {
            update((p) => moveStep(p, i, i + 1));
            setSelection({ kind: "step", step: i + 1 });
          },
        },
        { label: t("duplicate"), action: () => update((p) => duplicateStep(p, i)) },
        { label: t("mergeNext"), disabled: !canMergeSteps(project, i), action: () => mergeNext(i) },
        {
          label: t("delete"),
          shortcut: "Delete",
          action: () => {
            update((p) => deleteStep(p, i));
            setSelection({ kind: "project" });
          },
        },
      ],
    });
  };

  const editZoomRect = (step: number, zoom: number, key = 0) => {
    playerRef.current?.stop();
    setSelection({ kind: "zoom", step, index: zoom });
    setDrawingZoom({ step, zoom, key });
  };

  // ズーム範囲の指定を始めたら、範囲を指定する場面を見せる。枠が 1 つなら、再生位置がズームの区間の外のときだけ
  // 区間の途中へ移す。枠が複数なら、編集する枠の時刻へ移す
  // (追加した直後のズームはこの時点で project に入っているので、effect で行う)
  const drawingKey = drawingZoom ? `${drawingZoom.step}:${drawingZoom.zoom}:${drawingZoom.key}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 指定を始めたときだけ移す
  useEffect(() => {
    if (!drawingZoom) return;
    const e = timeline[drawingZoom.step];
    const z = project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom];
    const pl = playerRef.current;
    if (!e || !z || !pl) return;
    const keys = sortedKeys(z);
    const k = keys[drawingZoom.key];
    if (keys.length > 1 && k) {
      pl.seek(e.start + Math.min(k.t, e.duration - 0.001));
      return;
    }
    const local = pl.time - e.start;
    if (local < z.start || local > z.end) pl.seek(e.start + (z.start + z.end) / 2);
  }, [drawingKey]);

  /** ズーム step / zoom を書き換える */
  const updateZoom = (step: number, zoom: number, fn: (z: Zoom) => Zoom, key: string) =>
    update(
      (p) => ({
        ...p,
        steps: p.steps.map((s, i) =>
          i === step ? { ...s, zooms: s.zooms?.map((x, k) => (k === zoom ? fn(x) : x)) } : s,
        ),
      }),
      key,
    );

  /** 編集中のズームの、再生位置に枠を足す(その時刻に見えている範囲で作る)。同じ時刻に枠があればそれを選ぶ */
  const addZoomKeyAtPlayhead = () => {
    if (!drawingZoom) return;
    const e = timeline[drawingZoom.step];
    const z = project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom];
    if (!e || !z) return;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const t = r3(Math.min(Math.max((playerRef.current?.time ?? time) - e.start, z.start), z.end));
    const keys = sortedKeys(z);
    const same = keys.findIndex((k) => Math.abs(k.t - t) < 1 / resolveOutput(project).fps);
    if (same >= 0) {
      setDrawingZoom({ ...drawingZoom, key: same });
      return;
    }
    const rect = zoomRectAt(z, t);
    const next = [
      ...keys,
      {
        t,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
      },
    ].sort((a, b) => a.t - b.t);
    updateZoom(drawingZoom.step, drawingZoom.zoom, (x) => ({ ...x, keys: next }), "zoom-key-add");
    setDrawingZoom({ ...drawingZoom, key: next.findIndex((k) => k.t === t) });
  };

  /** タイムラインのダブルクリックで、ステップ i の時刻 local にズームを足して範囲の編集を始める */
  const addZoomAt = (i: number, local: number) => {
    const e = timeline[i];
    const st = project.steps[i];
    if (!e || !st) return;
    const r = insertZoom(project, i, local, e.duration, media.get(st.source));
    if (!r) return;
    update(() => r.project, "zoom-add");
    editZoomRect(i, r.index);
  };

  const out = resolveOutput(project);
  const locMedia = loc ? media.get(loc.entry.step.source) : [...media.values()][0];

  /** 再生位置のステップにズームを足し、範囲の編集を始める。center はソースの座標 */
  const addZoomAtPlayhead = (center?: { x: number; y: number }) => {
    if (!loc) return;
    const r = insertZoom(project, loc.entry.index, loc.local, loc.entry.duration, locMedia, center);
    if (!r) return;
    update(() => r.project, "zoom-add");
    editZoomRect(loc.entry.index, r.index);
  };

  /** プレビューの右クリック。再生ヘッドのステップに、クリックした点を中心にズームを作る(UI-05) */
  const previewMenu = (x: number, y: number, pt: { x: number; y: number }) => {
    const items: MenuItem[] = [];
    if (loc && locMedia && !drawingZoom) {
      const { entry, local } = loc;
      const step = entry.step;
      const zooms = step.zooms ?? [];
      const hit = zooms.findIndex((z) => local >= z.start && local <= z.end);
      const geo = computeLayout(
        out.width,
        out.height,
        resolveLayout(project),
        locMedia.width,
        locMedia.height,
      );
      const v = geo.video;
      const fx = (pt.x - v.x) / v.w;
      const fy = (pt.y - v.y) / v.h;
      if (hit >= 0) {
        items.push({ label: t("drawRect"), action: () => editZoomRect(entry.index, hit) });
      } else if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
        // 表示中の範囲(ズーム中ならその範囲)の中で、クリックした点をソースの座標にする
        const view = viewRectAt(step, local, locMedia.width, locMedia.height, geo.crop);
        const center = { x: view.x + fx * view.w, y: view.y + fy * view.h };
        items.push({ label: t("addZoomHere"), shortcut: "Z", action: () => addZoomAtPlayhead(center) });
      }
    }
    items.push({ label: t("editVideoBox"), action: () => setSelection({ kind: "video" }) });
    setMenu({ x, y, items });
  };

  /** 読み上げだけを鳴らす */
  const speechPlayer = useRef<AudioContext | null>(null);
  /** 読み上げの試聴を終える(一時停止ではなく終了) */
  const stopSpeech = () => {
    speechPlayer.current?.close();
    speechPlayer.current = null;
    setSpeechPlaying(null);
  };
  /** ステップの読み上げを、それぞれの開始時刻の間隔で鳴らす。鳴らし終えたら試聴を終える */
  const previewSpeech = (i: number) => {
    const step = project.steps[i];
    const placed = step ? speech.placed(project, step) : [];
    if (!step || placed.length === 0 || speech.isPending(project, step)) return;
    stopSpeech();
    playerRef.current?.stop();
    const ac = new AudioContext();
    speechPlayer.current = ac;
    const t0 = Math.min(...placed.map((x) => x.start));
    const end = Math.max(...placed.map((x) => x.start + x.buffer.duration)) - t0;
    for (const x of placed) {
      const node = ac.createBufferSource();
      node.buffer = x.buffer;
      node.connect(ac.destination);
      node.start(ac.currentTime + x.start - t0);
    }
    setSpeechPlaying(i);
    setTimeout(
      () => {
        if (speechPlayer.current === ac) stopSpeech();
      },
      end * 1000 + 100,
    );
  };

  /** ステップ i と次のステップをまとめる。前のステップの自動保持(読み上げが長い分)も保つ */
  const mergeNext = (i: number) => {
    if (!canMergeSteps(project, i)) return;
    update((p) => mergeSteps(p, i, timeline[i]?.duration));
    setSelection({ kind: "step", step: i });
  };

  /** ズームをコピーする */
  const copyZoom = (step: number, zoom: number) => {
    const st = project.steps[step];
    const z = st?.zooms?.[zoom];
    if (!st || !z) return;
    const m = media.get(st.source);
    zoomClipboard.current = { zoom: structuredClone(z), srcW: m?.width ?? 1920, srcH: m?.height ?? 1080 };
    setHasZoomClip(true);
  };

  /** コピーしたズームを全体の時刻 at に貼る。録画の大きさが違えば枠を換算し、空いている長さに収める */
  const pasteZoom = (at: number) => {
    const clip = zoomClipboard.current;
    const l = locate(timeline, at);
    if (!clip || !l) return;
    const { entry, local } = l;
    const zooms = entry.step.zooms ?? [];
    if (zooms.some((z) => local >= z.start && local <= z.end)) return;
    const m = media.get(entry.step.source);
    const kx = (m?.width ?? 1920) / clip.srcW;
    const ky = (m?.height ?? 1080) / clip.srcH;
    const conv = (r: ZoomKey["rect"]) => ({
      x: Math.round(r.x * kx),
      y: Math.round(r.y * ky),
      w: Math.round(r.w * kx),
      h: Math.round(r.h * ky),
    });
    const hi = Math.min(entry.duration, ...zooms.filter((z) => z.start > local).map((z) => z.start));
    const end = Math.min(hi, local + (clip.zoom.end - clip.zoom.start));
    if (end - local < 0.1) return;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const moved = retimeZoom(clip.zoom, local, local + (clip.zoom.end - clip.zoom.start));
    const fitted = retimeZoom(moved, r3(local), r3(end));
    const z: Zoom = { ...fitted, keys: fitted.keys.map((k) => ({ ...k, rect: conv(k.rect) })) };
    update(
      (p) => ({
        ...p,
        steps: p.steps.map((s, j) => (j === entry.index ? { ...s, zooms: [...zooms, z] } : s)),
      }),
      "zoom-paste",
    );
    setSelection({ kind: "zoom", step: entry.index, index: zooms.length });
  };

  // Ctrl+C / Ctrl+V(メニューのコピー・貼り付け)。文字の入力中はそのまま、ズームを選んでいればズームのコピー・貼り付け
  const clipRef = useRef<{ copy: (e: ClipboardEvent) => void; paste: (e: ClipboardEvent) => void }>({
    copy: () => {},
    paste: () => {},
  });
  clipRef.current = {
    copy: (e) => {
      if (isTyping() || selection.kind !== "zoom") return;
      e.preventDefault();
      copyZoom(selection.step, selection.index);
    },
    paste: (e) => {
      if (isTyping() || !zoomClipboard.current) return;
      e.preventDefault();
      pasteZoom(playerRef.current?.time ?? time);
    },
  };
  useEffect(() => {
    const copy = (e: ClipboardEvent) => clipRef.current.copy(e);
    const paste = (e: ClipboardEvent) => clipRef.current.paste(e);
    document.addEventListener("copy", copy);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("paste", paste);
    };
  }, []);

  // 再生を始めたら読み上げの試聴を終える
  // biome-ignore lint/correctness/useExhaustiveDependencies: 再生の開始だけを見る
  useEffect(() => {
    if (playing) stopSpeech();
  }, [playing]);

  /** 録画がないときの追加(プレビューのダブルクリック・ステップ一覧の案内)。確認してから追加する */
  const confirmAddRecording = () => {
    if (window.confirm(t("addRecordingConfirm"))) void actions.current.addSource?.();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.querySelector(".center .preview")?.requestFullscreen();
  };

  // テロップのドラッグ: いまテロップが出ているステップ
  const captionStep =
    loc && !playing
      ? (() => {
          const w = captionWindow(loc.entry.step, loc.entry.duration, true);
          return w && loc.local >= w.start && loc.local < w.end ? loc.entry.step : null;
        })()
      : null;
  // 再生を始めた・再生位置が別のステップへ移ったなどでテロップが出なくなったら、文字の入力を終える
  const captionEditing = captionEdit !== null && captionStep !== null && loc?.entry.index === captionEdit;
  useEffect(() => {
    if (captionEdit !== null && !captionEditing) setCaptionEdit(null);
  }, [captionEdit, captionEditing]);
  /**
   * プレビューでのテロップの置き方の変更(位置・幅)。常にそのステップの個別の値にする。
   * 全ステップ共通にするのは、文のパネルの「この位置を共通にする」か共通の欄の数値
   */
  const patchCaptionPlacement = (
    patch: { position?: { x: number; y: number }; width?: number },
    key: string,
  ) => {
    if (!loc) return;
    const i = loc.entry.index;
    update(
      (p) => ({
        ...p,
        steps: p.steps.map((s, j) =>
          j === i && s.caption ? { ...s, caption: { ...s.caption, ...patch } } : s,
        ),
      }),
      key,
    );
    if (selection.kind !== "caption" || selection.step !== i) setSelection({ kind: "caption", step: i });
  };
  const moveCaption = (pos: { x: number; y: number }, key: string) =>
    patchCaptionPlacement({ position: pos }, key);

  const clampW = (v: number) => Math.min(Math.max(v, 160), 640);

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" title="Ctrl+N" onClick={() => actions.current.new?.()}>
          {t("new")}
        </button>
        <button type="button" title="Ctrl+O" onClick={() => actions.current.open?.()}>
          {t("open")}
        </button>
        <button type="button" title="Ctrl+S" onClick={() => actions.current.save?.()}>
          {t("save")}
        </button>
        <button type="button" onClick={() => actions.current.addSource?.()}>
          {t("addRecording")}
        </button>
        <button
          type="button"
          title="Ctrl+E"
          onClick={() => doExport()}
          disabled={exporting !== null || project.steps.length === 0}
        >
          {exporting
            ? `${t("exporting")} ${Math.round((exporting.done / Math.max(1, exporting.total)) * 100)}%`
            : t("export")}
        </button>
        <span className="sep" />
        <button type="button" title="Ctrl+Z" onClick={() => setHist(undo)} disabled={hist.past.length === 0}>
          {t("undo")}
        </button>
        <button
          type="button"
          title="Ctrl+Shift+Z"
          onClick={() => setHist(redo)}
          disabled={hist.future.length === 0}
        >
          {t("redo")}
        </button>
        <span className="title">
          {filePath ?? t("untitled")}
          {dirty ? ` • ${t("unsaved")}` : ""}
        </span>
      </header>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          <pre>{banner.text}</pre>
          <button type="button" className="small" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}

      <main className="main" style={{ gridTemplateColumns: `auto ${panelW}px 5px minmax(0, 1fr)` }}>
        <StepRail
          timeline={timeline}
          media={media}
          thumbs={thumbs}
          thumbsVersion={thumbsVersion}
          projectOpen={view === "project"}
          target={target}
          playhead={loc?.entry.index ?? null}
          onProject={() => {
            setView("project");
            setSharedFocus(false);
          }}
          onStep={(i) => {
            setView("step");
            selectStep(i);
          }}
          onStepMenu={stepMenu}
          onAdd={() => actions.current.addSource?.()}
        />
        <aside className="panel">
          {view === "project" ? (
            <>
              <h3 className="panel-title">{t("panelProjectTitle")}</h3>
              <ProjectPanel
                project={project}
                update={update}
                voices={voices}
                focusVideo={selection.kind === "video"}
                focusShared={sharedFocus}
                backgroundError={(() => {
                  const bg = resolveLayout(project).background;
                  return typeof bg !== "string" && "image" in bg
                    ? backgrounds.error(bg.image, filePath)
                    : null;
                })()}
              />
            </>
          ) : target !== null && tgtStep ? (
            <>
              <div className="panel-head">
                <h3 className="panel-title">
                  {t("step")} {target + 1}
                  <span className="muted"> {tgtStep.id}</span>
                </h3>
                <div className="seg">
                  <button
                    type="button"
                    className="small"
                    title={t("prevStep")}
                    aria-label={t("prevStep")}
                    disabled={target <= 0}
                    onClick={() => selectStep(target - 1)}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className="small"
                    title={t("nextStep")}
                    aria-label={t("nextStep")}
                    disabled={target >= project.steps.length - 1}
                    onClick={() => selectStep(target + 1)}
                  >
                    ▶
                  </button>
                </div>
              </div>
              <StepDetail
                project={project}
                index={target}
                update={update}
                voices={voices}
                focus={selection}
                playheadLocal={playheadLocal}
                speechStatus={speechStatus}
                speechPlaying={speechPlaying === target}
                onPreviewSpeech={() => {
                  if (speechPlaying === target) stopSpeech();
                  else previewSpeech(target);
                }}
                onGoShared={() => {
                  setView("project");
                  setSharedFocus(true);
                }}
                drawing={drawingZoom}
                onDrawZoom={editZoomRect}
                syncSize={syncSize}
                onAddZoom={() => addZoomAtPlayhead()}
                onSelectZoom={(zoom) => {
                  if (zoom === null) {
                    select({ kind: "step", step: target });
                    return;
                  }
                  const e = timeline[target];
                  const z = tgtStep.zooms?.[zoom];
                  // ズームの区間の外にいれば、区間の始まりへ移ってから選ぶ(再生位置にいちばん近い枠を編集する)
                  if (e && z && !(time >= e.start + z.start && time <= e.start + z.end))
                    playerRef.current?.seek(e.start + z.start);
                  select({ kind: "zoom", step: target, index: zoom });
                }}
                srcSizeOf={(step) => {
                  const m = media.get(project.steps[step]?.source ?? "");
                  return m ? { w: m.width, h: m.height } : null;
                }}
              />
            </>
          ) : (
            <button type="button" className="link-button hint" onClick={confirmAddRecording}>
              {t("noSources")}
            </button>
          )}
        </aside>
        <Splitter dir="col" onDrag={(d) => setPanelW((w) => clampW(w + d))} />

        <section className="center" style={{ gridTemplateRows: `minmax(0, 1fr) auto 5px ${timelineH}px` }}>
          <Preview
            outW={out.width}
            outH={out.height}
            project={project}
            stateRef={stateRef}
            playerRef={playerRef}
            onTime={(tm, pl) => {
              setTime(tm);
              setPlaying(pl);
            }}
            drawing={
              drawingZoom && selMedia
                ? (() => {
                    const z = project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom];
                    const keys = z ? sortedKeys(z) : [];
                    return {
                      srcW: selMedia.width,
                      srcH: selMedia.height,
                      rect: keys[drawingZoom.key]?.rect ?? null,
                      // ほかの枠は点線で出し、クリックでその枠の編集に切り替える
                      ghosts: keys.map((k) => k.rect),
                      current: drawingZoom.key,
                      keepAspect: z?.keepAspect ?? false,
                      onPick: (i) => editZoomRect(drawingZoom.step, drawingZoom.zoom, i),
                      onRect: (rect, key) =>
                        updateZoom(
                          drawingZoom.step,
                          drawingZoom.zoom,
                          (x) =>
                            setZoomKeyRect(
                              x,
                              drawingZoom.key,
                              rect,
                              syncSize,
                              selMedia.width,
                              selMedia.height,
                            ),
                          key,
                        ),
                      onCommit: () => setDrawingZoom(null),
                    };
                  })()
                : null
            }
            anchor={anchor}
            srcSize={locMedia ? { w: locMedia.width, h: locMedia.height } : null}
            videoEdit={
              selection.kind === "video" && !drawingZoom && !playing
                ? {
                    // 枠をちょうど囲む余白にする。縦横比を変えたら、枠に合わせて録画の端を切り取る
                    onRect: (rect, key, shapeChanged) =>
                      update(
                        (p) => ({
                          ...p,
                          layout: {
                            ...p.layout,
                            margin: marginOf(rect, out.width, out.height),
                            ...(shapeChanged ? { fit: "cover" as const } : {}),
                          },
                        }),
                        key,
                      ),
                  }
                : null
            }
            onVideoClick={(inside) => {
              if (playing) return;
              if (inside) setSelection({ kind: "video" });
              else if (selection.kind === "video") setSelection({ kind: "project" });
            }}
            onContextMenu={previewMenu}
            tools={
              <>
                <div className="preview-tools-left">
                  {(drawingZoom || (selection.kind === "video" && !playing)) && (
                    <div className="seg" title={t("anchorTip")}>
                      {(["center", "corner"] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          className={`small ${anchor === a ? "on" : ""}`}
                          aria-pressed={anchor === a}
                          onClick={() => setAnchor(a)}
                        >
                          {t(a === "center" ? "anchorCenter" : "anchorCorner")}
                        </button>
                      ))}
                    </div>
                  )}
                  {drawingZoom &&
                    (() => {
                      const z = project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom];
                      const n = z?.keys.length ?? 0;
                      const go = (i: number) => editZoomRect(drawingZoom.step, drawingZoom.zoom, i);
                      return (
                        <>
                          {n > 1 && (
                            <div className="seg">
                              <button
                                type="button"
                                className="small"
                                title={t("prevKey")}
                                aria-label={t("prevKey")}
                                disabled={drawingZoom.key <= 0}
                                onClick={() => go(drawingZoom.key - 1)}
                              >
                                ◀
                              </button>
                              <span className="seg-label">
                                {t("zoomKey")} {drawingZoom.key + 1}/{n}
                              </span>
                              <button
                                type="button"
                                className="small"
                                title={t("nextKey")}
                                aria-label={t("nextKey")}
                                disabled={drawingZoom.key >= n - 1}
                                onClick={() => go(drawingZoom.key + 1)}
                              >
                                ▶
                              </button>
                            </div>
                          )}
                          <button type="button" className="small" onClick={addZoomKeyAtPlayhead}>
                            ＋ {t("addZoomKey")}
                          </button>
                          {n > 1 && (
                            <button
                              type="button"
                              className={`small ${syncSize ? "on" : ""}`}
                              aria-pressed={syncSize}
                              title={t("syncSizeHint")}
                              onClick={() => setSyncSize((v) => !v)}
                            >
                              {t("syncSize")}
                            </button>
                          )}
                        </>
                      );
                    })()}
                </div>
                <div className="preview-tools-right">
                  {/* プレビューの表示倍率(書き出しには影響しない)。% を押すと全体表示に戻る */}
                  <button
                    type="button"
                    className="small"
                    title={`${t("previewZoomOut")} (Ctrl+Wheel)`}
                    aria-label={t("previewZoomOut")}
                    disabled={viewZoom <= 1}
                    onClick={() => setViewZoom((z) => Math.max(1, z / 1.25))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="small zoom-pct"
                    title={t("previewFit")}
                    onClick={() => setViewZoom(1)}
                  >
                    {viewZoom === 1 ? t("previewFit") : `${Math.round(viewZoom * 100)}%`}
                  </button>
                  <button
                    type="button"
                    className="small"
                    title={`${t("previewZoomIn")} (Ctrl+Wheel)`}
                    aria-label={t("previewZoomIn")}
                    disabled={viewZoom >= 8}
                    onClick={() => setViewZoom((z) => Math.min(8, z * 1.25))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="small"
                    title={`${t("shortcuts")} (Ctrl+/)`}
                    aria-label={t("shortcuts")}
                    onClick={() => setShortcutsOpen(true)}
                  >
                    ?
                  </button>
                </div>
              </>
            }
            viewZoom={viewZoom}
            onViewZoom={setViewZoom}
            captionStep={captionStep}
            onCaptionMove={moveCaption}
            onCaptionWidth={(width, key) => patchCaptionPlacement({ width }, key)}
            captionSelected={selection.kind === "caption" && loc?.entry.index === selection.step}
            onCaptionClick={() => {
              if (loc) setSelection({ kind: "caption", step: loc.entry.index });
            }}
            onCaptionEdit={() => {
              if (!loc) return;
              setSelection({ kind: "caption", step: loc.entry.index });
              setCaptionEdit(loc.entry.index);
            }}
            captionEditing={captionEditing}
            onCaptionText={(text) => {
              if (captionEdit === null) return;
              const i = captionEdit;
              // 右の欄のテロップの入力欄と同じ履歴のまとまりにする
              update(
                (p) => ({
                  ...p,
                  steps: p.steps.map((s, j) =>
                    j === i ? { ...s, caption: { ...(s.caption ?? {}), text } } : s,
                  ),
                }),
                `step${i}.caption.text`,
              );
            }}
            onCaptionEditEnd={() => setCaptionEdit(null)}
            onEmptyDoubleClick={() => {
              if (project.steps.length === 0) confirmAddRecording();
            }}
            onContextLost={() => {
              thumbs.clear();
              backgrounds.clear();
              playerRef.current?.dropCache();
              setBgVersion((v) => v + 1);
            }}
          />
          <div className="transport">
            <div className="transport-left">
              <span className="time">
                {fmtTime(time)} / {fmtTime(total)}
              </span>
            </div>
            <div className="transport-center">
              {(
                [
                  ["toStart", "toStart", "Home", () => playerRef.current?.seek(0)],
                  [
                    "prev",
                    "prevBoundary",
                    "↑",
                    () => keyRef.current(new KeyboardEvent("keydown", { key: "ArrowUp" })),
                  ],
                  ["back", "back1s", "←", () => playerRef.current?.seek(time - 1)],
                ] as const
              ).map(([icon, label, key, fn]) => (
                <button
                  key={icon}
                  type="button"
                  className="icon"
                  title={`${t(label)} (${key})`}
                  aria-label={t(label)}
                  onClick={fn}
                >
                  <Icon name={icon} />
                </button>
              ))}
              <button
                type="button"
                className="icon play"
                title={`${t(playing ? "pause" : "play")} (Space)`}
                aria-label={t(playing ? "pause" : "play")}
                onClick={() => (playing ? playerRef.current?.stop() : playerRef.current?.play())}
              >
                <Icon name={playing ? "pause" : "play"} />
              </button>
              {(
                [
                  ["forward", "forward1s", "→", () => playerRef.current?.seek(time + 1)],
                  [
                    "next",
                    "nextBoundary",
                    "↓",
                    () => keyRef.current(new KeyboardEvent("keydown", { key: "ArrowDown" })),
                  ],
                  ["toEnd", "toEnd", "End", () => playerRef.current?.seek(total)],
                ] as const
              ).map(([icon, label, key, fn]) => (
                <button
                  key={icon}
                  type="button"
                  className="icon"
                  title={`${t(label)} (${key})`}
                  aria-label={t(label)}
                  onClick={fn}
                >
                  <Icon name={icon} />
                </button>
              ))}
            </div>
            <div className="transport-right">
              <select
                className="rate"
                aria-label={t("playbackRate")}
                title={`${t("playbackRate")} (J / K / L)`}
                value={PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number]) ? rate : ""}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  setRate(r);
                  playerRef.current?.setRate(r);
                }}
              >
                {rate < 0 && <option value="">◀ ×{-rate}</option>}
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    ×{r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon"
                title={`${t(muted ? "unmute" : "mute")} (M)`}
                aria-label={t(muted ? "unmute" : "mute")}
                onClick={() => setMuted((m) => !m)}
              >
                <Icon name={muted ? "muted" : "volume"} />
              </button>
              <button
                type="button"
                className="icon"
                title={`${t("fullscreen")} (F)`}
                aria-label={t("fullscreen")}
                onClick={toggleFullscreen}
              >
                <Icon name="fullscreen" />
              </button>
            </div>
          </div>
          <Splitter dir="row" onDrag={(d) => setTimelineH((h) => Math.min(Math.max(h - d, 120), 480))} />
          <Timeline
            project={project}
            timeline={timeline}
            total={total}
            time={time}
            playing={playing}
            media={media}
            thumbs={thumbs}
            thumbsVersion={thumbsVersion}
            speechDurations={speechDurations}
            selection={selection}
            onSelect={select}
            onSeek={(tm) => playerRef.current?.seek(tm)}
            update={update}
            onTrimPreview={setTrimPreview}
            openMenu={(x, y, items) => setMenu({ x, y, items })}
            onEditZoomRect={editZoomRect}
            editingKey={drawingZoom}
            onPreviewSpeech={previewSpeech}
            onMergeNext={mergeNext}
            onCopyZoom={copyZoom}
            onPasteZoom={hasZoomClip ? pasteZoom : null}
            onAddZoomAt={addZoomAt}
          />
        </section>
      </main>

      {(issues.length > 0 || mediaErrors.length > 0) && (
        <footer className="issues">
          <strong>{t("issues")}</strong>
          <ul>
            {mediaErrors.map((m) => (
              <li key={m} className="error">
                {m}
              </li>
            ))}
            {issues.map((i) => (
              <li key={`${i.path}:${i.message}`}>
                {i.path}: {i.message}
              </li>
            ))}
          </ul>
        </footer>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
