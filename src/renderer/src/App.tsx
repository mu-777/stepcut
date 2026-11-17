import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { captionWindow } from "../../core/captions";
import {
  DEFAULT_IMAGE_STEP_SECONDS,
  isImageSource,
  resolveLayout,
  resolveOutput,
  speechPieces,
  withSpeechPieces,
} from "../../core/defaults";
import {
  canMergeSteps,
  deleteStep,
  duplicateStep,
  followCaptions,
  mergeSteps,
  moveStep,
  newProject,
  setStepLayout,
  splitStep,
  uniqueStepId,
} from "../../core/edit";
import {
  computeLayout,
  marginOf,
  setZoomKeyRect,
  sortedKeys,
  viewRectAt,
  zoomRectAt,
} from "../../core/layout";
import {
  isScreenAnchored,
  type ObjectRef,
  objectOf,
  objectWindow,
  reanchorShape,
  shapeOutsideVideo,
} from "../../core/objects";
import type { Project, Step, Zoom } from "../../core/schema";
import { buildTimeline, locate, totalDuration } from "../../core/timeline";
import { parseProject } from "../../core/validate";
import {
  CENTER_MIN_W,
  PANEL_MIN_W,
  RAIL_MIN_W,
  type SpeechEngineSettings,
  type Voice,
} from "../../shared/api";
import { api } from "./api";
import { BackgroundStore } from "./backgrounds";
import { frameGeometry, screenGeometry, toOutput, toSource } from "./compositor";
import { commit, type History, initHistory, redo, undo } from "./history";
import { errorText, msgText, t } from "./i18n";
import { Icon, type IconName } from "./icons";
import { ImageStore } from "./images";
import {
  type FoldCommand,
  FoldCommandContext,
  foldOf,
  type PanelView,
  ProjectPanel,
  StepDetail,
  viewOf,
} from "./inspector";
import { actionOf, keyLabel, withKey } from "./keymap";
import { openMedia, releaseMedia, type SourceMedia } from "./media";
import { hitObject, ObjectEditor, objectSnapBoxes, zoomSnapBoxes } from "./object-editor";
import { objectTextInputId } from "./object-panel";
import {
  insertObject,
  NEW_OBJECT_KINDS,
  type NewObjectKind,
  newKindLabel,
  newKindTip,
  newObject,
  objectMenu,
  patchObject,
  patchStepObject,
} from "./objects-ui";
import { PLAYBACK_RATES, type Player, type PlayerState } from "./player";
import { Preview } from "./preview";
import { SettingsDialog } from "./settings-dialog";
import { SpeechStore } from "./speech";
import { StepRail } from "./step-rail";
import { ThumbCache } from "./thumbs";
import { fmtTime, insertZoom, type MenuItem, type Selection, selectedStep, Timeline } from "./timeline";
import { useClipboard } from "./use-clipboard";
import { useExport } from "./use-export";
import { type Banner, useProjectFile } from "./use-project-file";
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

/** 検証の指摘の場所。ステップは画面と同じ「ステップ N」を添える(JSON の場所も残す) */
/** ヘッダーのボタンの文字は「…」を付けない(押すとダイアログが開くことはアイコンで足りる) */
const bare = (label: string) => label.replace(/…$/, "");

function issuePath(path: string): string {
  const m = /^steps\[(\d+)\]/.exec(path);
  return m ? `${t("step")} ${Number(m[1]) + 1} (${path})` : path;
}

export function App() {
  const [hist, setHist] = useState<History>(() => initHistory(newProject()));
  const project = hist.present;
  const [selection, setSelection] = useState<Selection>({ kind: "project" });
  const [media, setMedia] = useState<Map<string, SourceMedia>>(new Map());
  /** 読めなかった素材(録画・画像)。missing はファイルがない */
  const [mediaErrors, setMediaErrors] = useState<
    { id: string; path: string; message: string; missing: boolean }[]
  >([]);
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
  /** アプリの設定を開いているか("shortcuts" ならキー操作の欄まで送る) */
  const [settingsOpen, setSettingsOpen] = useState<false | true | "shortcuts" | "engines">(false);
  // 読み上げのエンジン(ユーザーが有効にしたもの)と、プロジェクトのエンジンの声の一覧
  const [speechEngines, setSpeechEngines] = useState<SpeechEngineSettings | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const engineName = project.speech?.engine ?? "os";
  // アプリの設定を閉じたときに読み直す(エンジンを有効にした・場所を変えた)
  useEffect(() => {
    if (settingsOpen) return;
    void api.getSettings().then((s) => setSpeechEngines(s.engines));
  }, [settingsOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: エンジンとその設定が変わったら読み直す
  useEffect(() => {
    let alive = true;
    setVoiceError(null);
    api.ttsVoices(engineName).then(
      (v) => alive && setVoices(v),
      (e: Error) => {
        if (!alive) return;
        setVoices([]);
        setVoiceError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [engineName, speechEngines]);
  /** 言語を切り替えたら増やして描き直す */
  const [, setLangVersion] = useState(0);
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
  const [voices, setVoices] = useState<Voice[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  /** 新しい版の知らせ。閉じるとその版を覚えて、次からは知らせない */
  const [newVersion, setNewVersion] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    // 起動の邪魔をしないよう少し待ってから 1 回だけ確認する。失敗は知らせない(オフラインでも普通に使えるように)
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.autoCheckUpdate();
        if (r?.status !== "available") return;
        if ((await api.getSettings()).dismissedUpdate === r.version) return;
        setNewVersion({ version: r.version, url: r.url });
      } catch {
        // 確認できなくても何もしない
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** 設定パネルに出しているもの(全体の設定か、ステップの詳細) */
  const [view, setView] = useState<PanelView>("step");
  /** ステップの「共通の設定 ›」から全体の設定へ来た(テロップの見た目の欄を強調する) */
  const [sharedFocus, setSharedFocus] = useState(false);
  /** 設定パネルの欄をまとめて開け閉めする指示 */
  const [foldCmd, setFoldCmd] = useState<FoldCommand | null>(null);
  /** id の欄だけを開き、ほかを閉じる(null ならすべて閉じる) */
  const foldOnly = (id: string | null) =>
    setFoldCmd((c) => ({ seq: (c?.seq ?? 0) + 1, open: (x) => x === id }));
  const [panelW, setPanelW] = useState(() => loadPref("panelWidth", 320));
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  /** 左端のサムネイル列の幅 */
  const [railW, setRailW] = useState(() => loadPref("stepRailWidth", 220));
  const [timelineH, setTimelineH] = useState(() => loadPref("timelineHeight", 190));
  /** プレビューの表示倍率(1 = 全体表示)。書き出しには影響しない */
  const [viewZoom, setViewZoom] = useState(1);
  useEffect(() => savePref("panelWidth", panelW), [panelW]);
  useEffect(() => savePref("stepRailWidth", railW), [railW]);
  useEffect(() => savePref("timelineHeight", timelineH), [timelineH]);
  const [thumbsVersion, setThumbsVersion] = useState(0);
  const thumbs = useMemo(() => new ThumbCache(() => setThumbsVersion((v) => v + 1)), []);
  const [bgVersion, setBgVersion] = useState(0);
  const backgrounds = useMemo(() => new BackgroundStore(() => setBgVersion((v) => v + 1)), []);
  const [imgVersion, setImgVersion] = useState(0);
  const images = useMemo(() => new ImageStore(() => setImgVersion((v) => v + 1)), []);
  const speech = useMemo(() => new SpeechStore(), []);
  const playerRef = useRef<Player | null>(null);
  const latestProject = useRef(project);
  latestProject.current = project;

  const {
    filePath,
    dirty,
    projectName,
    pendingName,
    titleEdit,
    setTitleEdit,
    saveAfterName,
    commitName,
    fileActions,
  } = useProjectFile({ project, setHist, setSelection, playerRef, setBanner });

  // biome-ignore lint/correctness/useExhaustiveDependencies: speechVersion で読み上げの長さの更新を拾う
  const speechDurations = useMemo(() => speech.durations(project), [project, speechVersion]);
  const timeline = useMemo(() => buildTimeline(project.steps, speechDurations), [project, speechDurations]);
  const total = totalDuration(timeline);
  const issues = useMemo(() => {
    const r = parseProject(project);
    return [...(r.ok ? [] : r.errors), ...r.warnings];
  }, [project]);
  /** 上端に出すプロジェクトの問題。閉じたときの中身(problemKey)を覚え、中身が変わるまで出さない */
  const problemLines = [
    ...mediaErrors.map((m) => ({
      text: m.missing
        ? `${t("sourceMissing")}: ${m.path}`
        : `${t("sourceUnreadable")}: ${m.path} (${m.message})`,
      error: true,
      relink: m.id as string | undefined,
    })),
    ...issues.map((i) => ({
      text: `${issuePath(i.path)}: ${msgText(i)}`,
      error: false,
      relink: undefined as string | undefined,
    })),
  ];
  const problemKey = problemLines.map((p) => p.text).join("\n");
  const [dismissedProblems, setDismissedProblems] = useState<string | null>(null);
  const selected = selectedStep(selection);
  // 要素を選んだら、それを直す画面(全体の設定かステップの詳細)に切り替える
  useEffect(() => {
    const v = viewOf(selection);
    if (v) {
      setView(v);
      setSharedFocus(false);
    }
    // 要素を選んだら、その欄だけを開いてほかの欄を閉じる
    const fold = foldOf(selection);
    if (fold) setFoldCmd((c) => ({ seq: (c?.seq ?? 0) + 1, open: (x) => x === fold }));
  }, [selection]);

  const update = useCallback((fn: (p: Project) => Project, key?: string) => {
    // 録画の枠が変わったら、位置を書いたテロップも枠に合わせて動かす
    setHist((h) => commit(h, followCaptions(h.present, fn(h.present)), key ?? null));
  }, []);

  // 状態は ref 経由でプレーヤーに渡す(再生中のループが古い値を見ないように)
  const playerState: PlayerState = {
    project,
    timeline,
    media,
    speech,
    sourceView: trimPreview ? { stepIndex: trimPreview.step, time: trimPreview.time } : null,
    ignoreZoom: drawingZoom !== null,
    selectedObject:
      selection.kind === "pointer" || selection.kind === "shape"
        ? { step: selection.step, ref: { kind: selection.kind, index: selection.index } }
        : null,
    thumbs,
    backgrounds,
    images,
    projectPath: filePath,
    captionPlaceholder: t("captionPlaceholder"),
    hideCaptionStep: captionEdit,
  };
  const stateRef = useRef(playerState);
  stateRef.current = playerState;

  // 素材を開く
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = new Map<string, SourceMedia>();
      const errors: typeof mediaErrors = [];
      const used: string[] = [];
      for (const s of project.sources) {
        try {
          const path = await api.resolveSource(filePath, s.path);
          used.push(path);
          next.set(s.id, await openMedia(path));
        } catch (e) {
          const message = errorText(e);
          errors.push({ id: s.id, path: s.path, message, missing: /ENOENT/.test(message) });
        }
      }
      if (alive) {
        setMedia(next);
        setMediaErrors(errors);
        // 使わなくなった素材を閉じる。再生中なら止め、閉じた素材のフレームの写しも捨てる
        // (録画の読み取りは閉じると落ちるが、プレイヤー・サムネイルは失敗を握りつぶす)
        const keep = used;
        if (releaseMedia(keep) > 0) {
          if (playerRef.current?.playing) playerRef.current.stop();
          playerRef.current?.dropCache();
        }
        thumbs.retain(keep);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project.sources, filePath, thumbs]);

  // 読み上げを用意する(入力が落ち着いてから)
  useEffect(() => {
    const timer = setTimeout(() => {
      speech
        .loadAll(project, () => setSpeechVersion((v) => v + 1))
        .then(() => {
          // 使わなくなった文の音声を捨てる(古い状態の読み込みが後から終わっても、最新の状態でだけ行う)
          if (latestProject.current === project) {
            speech.retain(project);
            setSpeechVersion((v) => v + 1);
          }
        });
      setSpeechVersion((v) => v + 1);
    }, 600);
    return () => clearTimeout(timer);
  }, [project, speech]);

  // 停止中の表示を更新する。画面に出す前に描き直し、編集中の枠と映像を同じフレームで動かす
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示に関わる値が変わったら描き直す
  useLayoutEffect(() => {
    playerRef.current?.renderStill();
  }, [project, timeline, media, trimPreview, drawingZoom, bgVersion, imgVersion, captionEdit, selection]);

  // 選択が範囲外になったら(削除・外部変更)プロジェクトの選択に戻す
  useEffect(() => {
    if (selected !== null && selected >= project.steps.length) setSelection({ kind: "project" });
  }, [selected, project.steps.length]);

  const { exporting, doExport, cancelExport } = useExport({
    project,
    filePath,
    issues,
    issuePath,
    playerRef,
    speech,
    setBanner,
  });

  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    new: fileActions.new,
    open: fileActions.open,
    save: fileActions.save,
    addSource: async () => addSourcePaths(await api.pickSources()),
    saveAndClose: fileActions.saveAndClose,
    // 書き出し中の Ctrl+E は重ねて始めない(中止はボタンで)
    export: () => {
      if (!exporting) void doExport();
    },
    shortcuts: () => setShortcutsOpen(true),
    undo: () => (isTyping() ? document.execCommand("undo") : setHist(undo)),
    redo: () => (isTyping() ? document.execCommand("redo") : setHist(redo)),
  };

  /**
   * 録画・画像をステップとして足す(選んだファイル・ドロップしたファイル)。after を渡すとそのステップの後ろ、
   * 省略すると末尾に入れる。画像は DEFAULT_IMAGE_STEP_SECONDS 秒のステップにする
   */
  async function addSourcePaths(paths: string[], after?: number) {
    if (!paths.length) return;
    let p = project;
    let at = after === undefined ? p.steps.length : after + 1;
    const first = at;
    for (const path of paths) {
      try {
        const m = await openMedia(path);
        let n = p.sources.length + 1;
        while (p.sources.some((s) => s.id === `rec${n}`)) n++;
        const id = `rec${n}`;
        const step: Step = {
          id: uniqueStepId(p, "step"),
          source: id,
          in: 0,
          out: m.kind === "image" ? DEFAULT_IMAGE_STEP_SECONDS : Math.round(m.duration * 1000) / 1000,
          // テロップは空で付けておく(プレビューには仮の文を出し、書き出しには出さない)
          caption: { text: "" },
          // 読み上げは、書き換えるまでテロップの文を読む
          speech: {},
        };
        p = {
          ...p,
          sources: [...p.sources, { id, path }],
          steps: [...p.steps.slice(0, at), step, ...p.steps.slice(at)],
        };
        at++;
      } catch (e) {
        setBanner({ kind: "error", text: errorText(e) });
      }
    }
    if (at === first) return;
    update(() => p);
    setSelection({ kind: "step", step: at - 1 });
  }

  /** 読めない素材の場所を選び直す(素材のパスだけを差し替える。ステップはそのまま) */
  async function relinkSource(id: string) {
    const [path] = await api.pickSources();
    if (!path) return;
    update((p) => ({ ...p, sources: p.sources.map((s) => (s.id === id ? { ...s, path } : s)) }));
  }

  useEffect(() => api.onMenu((cmd) => actions.current[cmd]?.()), []);

  /** 選んだ要素を消す(Delete キー) */
  const deleteSelection = () => removeItem(selection);
  /** 要素を消す(Delete キー・切り取り・右クリックの削除) */
  const removeItem = (s: Selection) => {
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
    else if (s.kind === "pointer" || s.kind === "shape") {
      const ref: ObjectRef = { kind: s.kind, index: s.index };
      patch((st) => patchStepObject(st, ref, () => null));
    } else if (s.kind === "speech")
      patch((st) =>
        withSpeechPieces(
          st,
          speechPieces(st).filter((_, k) => k !== s.index),
        ),
      );
    setSelection({ kind: "step", step: s.step });
  };

  /** 前(dir = -1)・次(1)のステップの切れ目へ */
  const seekBoundary = (dir: -1 | 1) => {
    const pl = playerRef.current;
    if (!pl) return;
    const boundaries = [0, ...timeline.map((x) => x.start + x.duration)];
    if (dir < 0) pl.seek([...boundaries].reverse().find((b) => b < pl.time - 1e-3) ?? 0);
    else pl.seek(boundaries.find((b) => b > pl.time + 1e-3) ?? total);
  };

  // キー操作は一般的な動画編集アプリに合わせる(docs/decisions/20261029-timeline-ui.md)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (isTyping()) return;
    const pl = playerRef.current;
    if (!pl) return;
    // 録画の枠・ズームの枠を編集中は、矢印キーで 10px ずつ動かす(Shift で 1px。シークの Shift と同じく細かく)
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
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
    if (e.key === "Escape") {
      setDrawingZoom(null);
      stopSpeech();
      if (selection.kind === "video") setSelection({ kind: "step", step: selection.step });
      if (selObject) setSelection({ kind: "step", step: selObject.step });
      e.preventDefault();
      return;
    }
    // 割り当ては アプリの設定 → キー操作 で変えられる(keymap.ts)
    const action = actionOf(e);
    const frame = 1 / resolveOutput(project).fps;
    let handled = true;
    if (action === "play") {
      if (pl.playing) pl.stop();
      else pl.play();
    } else if (action === "back1s") pl.seek(pl.time - 1);
    else if (action === "forward1s") pl.seek(pl.time + 1);
    else if (action === "backFrame") pl.seek(pl.time - frame);
    else if (action === "forwardFrame") pl.seek(pl.time + frame);
    else if (action === "prevBoundary") seekBoundary(-1);
    else if (action === "nextBoundary") seekBoundary(1);
    else if (action === "toStart") pl.seek(0);
    else if (action === "toEnd") pl.seek(total);
    else if (action === "split") {
      const l = locate(timeline, pl.time);
      if (l) update((p) => splitStep(p, l.entry.index, l.local, true));
    } else if (action === "delete") deleteSelection();
    else if (action === "addZoom") addZoomAtPlayhead();
    else if (action === "fullscreen") toggleFullscreen();
    else if (action === "mute") setMuted((m) => !m);
    else if (action === "anchor") setAnchor((a) => (a === "center" ? "corner" : "center"));
    else handled = false;
    if (handled) e.preventDefault();
  };
  // サムネイル列の外にファイルを落としても、ウィンドウがそのファイルを開いて画面が入れ替わらないようにする
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
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
  // 再生操作のクリックと再生の開始(Space を含む)でも終える。数値で直せるよう設定のパネルと操作の帯では終えず、
  // シークしながら枠を見比べられるようタイムラインの操作でも終えない(別の要素を選んだら select が終える)
  const endBoxEditRef = useRef(() => {});
  endBoxEditRef.current = () => {
    if (drawingZoom) setDrawingZoom(null);
    if (selection.kind === "video") setSelection({ kind: "step", step: selection.step });
  };
  useEffect(() => {
    if (playing) endBoxEditRef.current();
  }, [playing]);
  useEffect(() => {
    const keep = ".preview-stage, .preview-tools, .panel, .timeline, .context-menu, .dialog-backdrop";
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
  // 録画の枠を編集中に再生位置が別のステップへ移ったら、そのステップの枠の編集にする(枠はステップごと)
  const locIndex = loc?.entry.index ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 再生位置のステップが変わったときだけ見る
  useEffect(() => {
    if (selection.kind === "video" && locIndex !== null && locIndex !== selection.step)
      setSelection({ kind: "video", step: locIndex });
  }, [locIndex]);
  const selStep = selected !== null ? project.steps[selected] : undefined;
  const selMedia = selStep ? media.get(selStep.source) : undefined;
  // パネルで直すステップ。選んだ要素のステップ、なければ再生位置のステップ
  const target = selected ?? loc?.entry.index ?? null;
  const tgtStep = target !== null ? project.steps[target] : undefined;
  /** 設定パネルに全体の設定を出す(ステップがなければ常に全体) */
  const projectShown = view === "project" || !tgtStep;
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
      const i = selection.step;
      const src = media.get(project.steps[i]?.source ?? "") ?? locMedia;
      const v = computeLayout(
        out.width,
        out.height,
        resolveLayout(project, project.steps[i]),
        src?.width ?? 1920,
        src?.height ?? 1080,
      ).video;
      update(
        (p) =>
          setStepLayout(p, i, {
            margin: marginOf({ ...v, x: v.x + dx * n, y: v.y + dy * n }, out.width, out.height),
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
          shortcut: keyLabel("delete"),
          action: () => {
            update((p) => deleteStep(p, i));
            setSelection({ kind: "project" });
          },
        },
      ],
    });
  };

  /**
   * ズームの枠 key の編集を始める。seek なら、枠が複数のときはその枠の時刻へ、1 つのときは再生位置が区間の外なら
   * 区間の途中へ移す(タイムラインで選んだときは再生位置を動かさない)
   */
  const editZoomRect = (step: number, zoom: number, key = 0, seek = true) => {
    playerRef.current?.stop();
    setSelection({ kind: "zoom", step, index: zoom });
    setDrawingZoom({ step, zoom, key });
    const e = timeline[step];
    const z = project.steps[step]?.zooms?.[zoom];
    const pl = playerRef.current;
    if (!seek || !e || !z || !pl) return;
    const keys = sortedKeys(z);
    const k = keys[key];
    if (keys.length > 1 && k) {
      pl.seek(e.start + Math.min(k.t, e.duration - 0.001));
      return;
    }
    const local = pl.time - e.start;
    if (local < z.start || local > z.end) pl.seek(e.start + (z.start + z.end) / 2);
  };

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

  /**
   * ズーム step / zoom の時刻 local に枠を足して編集を始める(その時刻に見えている範囲で作る)。
   * 同じ時刻に枠があればそれを選ぶ。再生位置をその時刻へ移す
   */
  const addZoomKey = (step: number, zoom: number, local: number) => {
    const e = timeline[step];
    const z = project.steps[step]?.zooms?.[zoom];
    if (!e || !z) return;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const t = r3(Math.min(Math.max(local, z.start), z.end));
    playerRef.current?.stop();
    playerRef.current?.seek(e.start + Math.min(t, e.duration - 0.001));
    setSelection({ kind: "zoom", step, index: zoom });
    const keys = sortedKeys(z);
    const same = keys.findIndex((k) => Math.abs(k.t - t) < 1 / resolveOutput(project).fps);
    if (same >= 0) {
      setDrawingZoom({ step, zoom, key: same });
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
    updateZoom(step, zoom, (x) => ({ ...x, keys: next }), "zoom-key-add");
    setDrawingZoom({ step, zoom, key: next.findIndex((k) => k.t === t) });
  };

  /** 編集中のズームの、再生位置に枠を足す */
  const addZoomKeyAtPlayhead = () => {
    if (!drawingZoom) return;
    const e = timeline[drawingZoom.step];
    if (e) addZoomKey(drawingZoom.step, drawingZoom.zoom, (playerRef.current?.time ?? time) - e.start);
  };

  /** タイムラインのダブルクリックで、ステップ i の時刻 local にズームを足して範囲の編集を始める */
  const addZoomAt = (i: number, local: number) => {
    const e = timeline[i];
    const st = project.steps[i];
    if (!e || !st) return;
    const r = insertZoom(project, i, local, e.duration, media.get(st.source));
    if (!r) return;
    update(() => r.project, "zoom-add");
    playerRef.current?.seek(e.start + local);
    editZoomRect(i, r.index, 0, false);
  };

  const out = resolveOutput(project);
  const locMedia = loc ? media.get(loc.entry.step.source) : [...media.values()][0];

  /** 再生位置のステップにズームを足し、範囲の編集を始める。center はソースの座標 */
  const addZoomAtPlayhead = (center?: { x: number; y: number }) => {
    if (!loc) return;
    const r = insertZoom(project, loc.entry.index, loc.local, loc.entry.duration, locMedia, center);
    if (!r) return;
    update(() => r.project, "zoom-add");
    editZoomRect(loc.entry.index, r.index, 0, false);
  };

  /** 選んでいるオブジェクト */
  const selObject: { step: number; ref: ObjectRef } | null =
    selection.kind === "pointer" || selection.kind === "shape"
      ? { step: selection.step, ref: { kind: selection.kind, index: selection.index } }
      : null;

  /** 選んでいるオブジェクトが枠で直す図形(四角・テキスト) */
  const boxObjectSelected = (() => {
    if (!selObject || selObject.ref.kind !== "shape") return false;
    const s = project.steps[selObject.step]?.shapes?.[selObject.ref.index];
    return !!s && s.type !== "arrow";
  })();

  /**
   * オブジェクトを選ぶ(null ならステップの選択に戻す)。seek なら、再生位置が出ている間の外のとき始まりへ移る
   * (タイムラインで選んだときは再生位置を動かさない)
   */
  const selectObject = (step: number, ref: ObjectRef | null, seek = true) => {
    if (!ref) {
      setSelection({ kind: "step", step });
      return;
    }
    const e = timeline[step];
    const st = project.steps[step];
    const o = st ? objectOf(st, ref) : undefined;
    if (e && o && seek) {
      const w = objectWindow(o, e.duration);
      const tm = playerRef.current?.time ?? time;
      if (tm < e.start + w.start || tm >= e.start + w.end) playerRef.current?.seek(e.start + w.start);
    }
    setSelection({ kind: ref.kind, step, index: ref.index });
  };

  /**
   * オブジェクトを足して選ぶ。at(出力のピクセル)を渡すとそこを中心に、渡さなければいま見えている範囲の中央付近に置く。
   * 録画の外なら、図形は画面に固定して置き、ポインター(録画の中にしか描けない)は録画の中央に置く。
   * atTime(全体の時刻)を渡すとその時刻に作り(タイムラインの右クリック)、渡さなければ再生位置に作る。
   * 画像は先にファイルを選ばせ、取り消したら何も作らない
   */
  const addObject = (
    kind: NewObjectKind,
    stepIndex?: number,
    at?: { x: number; y: number },
    atTime?: number,
  ) => {
    if (kind !== "image") {
      placeObject(kind, stepIndex, at, atTime);
      return;
    }
    playerRef.current?.stop();
    void (async () => {
      const path = await api.pickImage();
      if (!path) return;
      const img = await images.load(path, filePath);
      placeObject(
        kind,
        stepIndex,
        at,
        atTime,
        img ? { path, w: img.width, h: img.height } : { path, w: 0, h: 0 },
      );
    })();
  };

  const placeObject = (
    kind: NewObjectKind,
    stepIndex?: number,
    at?: { x: number; y: number },
    atTime?: number,
    image?: { path: string; w: number; h: number },
  ) => {
    const place = atTime === undefined ? loc : locate(timeline, atTime);
    const i = stepIndex ?? place?.entry.index;
    if (i === undefined) return;
    const e = timeline[i];
    const st = project.steps[i];
    if (!e || !st) return;
    // ステップの終わりちょうどでは見えないので、少し手前に作る
    const local = place && place.entry.index === i ? Math.min(place.local, Math.max(0, e.duration - 0.5)) : 0;
    const m = media.get(st.source);
    const g = frameGeometry(project, st, local, out.width, out.height, m?.width || 1920, m?.height || 1080);
    playerRef.current?.stop();
    const b = g.box;
    const inVideo = at && at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h;
    const screen = at && !inVideo && kind !== "pointer" && kind !== "highlighter";
    const sg = screenGeometry(out.width, out.height, g.video);
    const opts = { sharedPointerPreset: project.styles?.pointer?.preset, image };
    const made = screen
      ? newObject(kind, local, e.duration, sg.view, toSource(sg, at.x, at.y), opts)
      : newObject(kind, local, e.duration, g.view, inVideo ? toSource(g, at.x, at.y) : undefined, opts);
    const object = screen ? { ...made.object, anchor: "screen" as const } : made.object;
    const r = insertObject(project, i, made.kind, object);
    update(() => r.project, "object-add");
    if (!loc || loc.entry.index !== i || Math.abs(loc.local - local) > 1e-3)
      playerRef.current?.seek(e.start + local);
    setSelection({ kind: r.ref.kind, step: i, index: r.ref.index });
    // 文字はすぐ文を打てるようにする(欄が開いてから)
    if (kind === "text")
      setTimeout(() => {
        const el = document.getElementById(objectTextInputId(r.ref.index)) as HTMLTextAreaElement | null;
        el?.focus();
        el?.select();
      }, 80);
  };

  /**
   * 図形の座標の基準を変える(録画に追従 ⇔ 画面に固定)。再生位置で見えている位置と大きさを保つ
   * (再生位置が別のステップならそのステップの始まりで換算する)
   */
  const setShapeAnchor = (i: number, index: number, anchor: "video" | "screen") => {
    const st = project.steps[i];
    const s = st?.shapes?.[index];
    if (!st || !s || (anchor === "screen") === isScreenAnchored(s)) return;
    const local = loc && loc.entry.index === i ? loc.local : 0;
    const m = media.get(st.source);
    const g = frameGeometry(project, st, local, out.width, out.height, m?.width || 1920, m?.height || 1080);
    const sg = screenGeometry(out.width, out.height, g.video);
    const [from, to] = anchor === "screen" ? [g, sg] : [sg, g];
    const next = reanchorShape(
      s,
      anchor,
      (p) => {
        const o = toOutput(from, p.x, p.y);
        return toSource(to, o.x, o.y);
      },
      from.k / to.k,
    );
    patchObject(update, i, { kind: "shape", index }, () => next, "object-anchor");
  };

  /**
   * プレビューの右クリック。オブジェクトの上ならその操作、再生ヘッドのステップに、クリックした点を中心にズーム(UI-05)・
   * オブジェクトを作る
   */
  const previewMenu = (x: number, y: number, pt: { x: number; y: number }) => {
    const items: MenuItem[] = [];
    if (loc && locMedia && !drawingZoom) {
      const { entry, local } = loc;
      const step = entry.step;
      if (!playing) {
        const g = frameGeometry(project, step, local, out.width, out.height, locMedia.width, locMedia.height);
        const sg = screenGeometry(out.width, out.height, g.video);
        const hitRef = hitObject(project, step, local, entry.duration, g, sg, out.height, pt);
        if (hitRef) {
          setSelection({ kind: hitRef.kind, step: entry.index, index: hitRef.index });
          const item = { kind: hitRef.kind, step: entry.index, index: hitRef.index };
          items.push(
            { label: t("copy"), shortcut: "Ctrl+C", action: () => copyItem(item) },
            { label: t("cut"), shortcut: "Ctrl+X", action: () => cutItem(item) },
            ...objectMenu(update, entry.index, hitRef, step, (r) =>
              setSelection(
                r ? { kind: r.kind, step: entry.index, index: r.index } : { kind: "step", step: entry.index },
              ),
            ),
          );
        }
      }
      const zooms = step.zooms ?? [];
      const hit = zooms.findIndex((z) => local >= z.start && local <= z.end);
      const geo = computeLayout(
        out.width,
        out.height,
        resolveLayout(project, step),
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
        items.push({
          label: `＋ ${t("zooms")}`,
          shortcut: keyLabel("addZoom"),
          action: () => addZoomAtPlayhead(center),
        });
      }
    }
    // クリックした所を中心にオブジェクトを足す
    if (loc && !drawingZoom) {
      const first = items.length > 0;
      items.push(
        ...NEW_OBJECT_KINDS.map((k, n) => ({
          label: `＋ ${newKindLabel(k)}`,
          separator: n === 0 && first,
          action: () => addObject(k, loc.entry.index, pt),
        })),
      );
    }
    if (loc) {
      const i = loc.entry.index;
      items.push({
        label: t("editVideoBox"),
        separator: true,
        action: () => setSelection({ kind: "video", step: i }),
      });
    }
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

  const { clipKind, copyItem, cutItem, pasteAt } = useClipboard({
    project,
    media,
    timeline,
    speechDurations,
    update,
    selection,
    setSelection,
    removeItem,
    playerRef,
    time,
    isTyping,
  });

  // 再生を始めたら読み上げの試聴を終える
  // biome-ignore lint/correctness/useExhaustiveDependencies: 再生の開始だけを見る
  useEffect(() => {
    if (playing) stopSpeech();
  }, [playing]);

  /** 録画がないときの追加(プレビューのダブルクリック・ステップ一覧の案内)。確認してから追加する */
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
  /** 再生位置のステップにテロップがない(消した)。帯の「テロップ」で作り直せる */
  const captionMissing = loc !== null && !loc.entry.step.caption;
  /** プレビューの下の追加の段を押せないとき(再生中・枠の編集中・再生位置がない) */
  const addDisabled = playing || !loc || drawingZoom !== null || selection.kind === "video";
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

  const clampW = (v: number) => Math.min(Math.max(v, PANEL_MIN_W), 640);
  // ウィンドウが狭いときは、プレビューの列(再生操作の帯)が重ならない幅を残すよう、右のパネル → 左の列の順に縮める
  const over = Math.max(0, railW + panelW + 10 + CENTER_MIN_W - winW);
  const panelShown = Math.max(PANEL_MIN_W, panelW - over);
  const railShown = Math.max(RAIL_MIN_W, railW - Math.max(0, over - (panelW - panelShown)));
  // つまみのドラッグは押したときの関数で続くので、今の表示幅は ref で渡す(縮めて表示している分から動かす)
  const shownRef = useRef({ rail: railShown, panel: panelShown });
  shownRef.current = { rail: railShown, panel: panelShown };

  return (
    <div className="app">
      {/* 左: ファイル(新規・開く・保存)と元に戻す/やり直し、真ん中: プロジェクトの名前、右: アプリの設定と書き出し。
          真ん中をウィンドウの中央にそろえるため、左右は同じ幅の列にする */}
      <header className="toolbar">
        <div className="tb-side">
          <button
            type="button"
            className="tb-btn"
            title={t("fileMenu")}
            aria-label={t("fileMenu")}
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({
                x: r.left,
                y: r.bottom + 2,
                items: [
                  { label: t("new"), shortcut: "Ctrl+N", action: () => actions.current.new?.() },
                  { label: t("open"), shortcut: "Ctrl+O", action: () => actions.current.open?.() },
                  { label: t("save"), shortcut: "Ctrl+S", action: () => actions.current.save?.() },
                ],
              });
            }}
          >
            <Icon name="fileMenu" />
            <span>{t("fileShort")}</span>
          </button>
          <span className="tb-sep" />
          <button
            type="button"
            className="tb-btn"
            title={`${t("undo")} (Ctrl+Z)`}
            aria-label={t("undo")}
            onClick={() => setHist(undo)}
            disabled={hist.past.length === 0}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="tb-btn"
            title={`${t("redo")} (Ctrl+Shift+Z)`}
            aria-label={t("redo")}
            onClick={() => setHist(redo)}
            disabled={hist.future.length === 0}
          >
            <Icon name="redo" />
          </button>
        </div>
        {titleEdit ? (
          <input
            className="tb-title-input"
            aria-label={t("projectName")}
            defaultValue={filePath || pendingName ? projectName : ""}
            placeholder={t("projectNamePlaceholder")}
            // biome-ignore lint/a11y/noAutofocus: 名前の入力を始めたときだけ出す欄
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                saveAfterName.current = false;
                setTitleEdit(false);
              }
            }}
            onBlur={(e) => void commitName(titleEdit ? e.currentTarget.value : null)}
          />
        ) : (
          <button
            type="button"
            className="tb-title"
            title={`${filePath ?? t("notSavedYet")}
${t("renameTip")}`}
            onClick={() => setTitleEdit(true)}
          >
            <span className="tb-name">{projectName}</span>
            {dirty && (
              <span className="tb-dirty" title={t("unsaved")}>
                ●
              </span>
            )}
          </button>
        )}
        <div className="tb-side right">
          <button
            type="button"
            className="tb-btn"
            title={`${t("shortcuts")} (Ctrl+/)`}
            aria-label={t("shortcuts")}
            onClick={() => setShortcutsOpen(true)}
          >
            <Icon name="help" />
          </button>
          <button
            type="button"
            className="tb-btn"
            title={t("appSettings")}
            aria-label={t("settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
          <button
            type="button"
            className="tb-btn primary"
            title={exporting ? t("cancelExportTip") : `${t("export")} (Ctrl+E)`}
            aria-label={exporting ? t("cancelExport") : bare(t("export"))}
            onClick={() => (exporting ? cancelExport() : doExport())}
            disabled={project.steps.length === 0}
          >
            <Icon name="exportVideo" />
            {/* 書き出し中は中止のボタンになる(進み具合を添える) */}
            <span>
              {exporting
                ? `${t("cancelExport")} ${Math.round((exporting.done / Math.max(1, exporting.total)) * 100)}%`
                : bare(t("export"))}
            </span>
          </button>
        </div>
      </header>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          <pre>{banner.text}</pre>
          {banner.reveal && (
            <button
              type="button"
              className="small"
              onClick={() => void api.revealFile(banner.reveal as string)}
            >
              {t("revealFolder")}
            </button>
          )}
          <button type="button" className="small" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}
      {newVersion && (
        <div className="banner info update-banner">
          <pre>{`${t("updateAvailable")}: v${newVersion.version}`}</pre>
          <button type="button" className="small" onClick={() => void api.openExternal(newVersion.url)}>
            {t("openDownloadPage")}
          </button>
          <button
            type="button"
            className="small"
            aria-label={t("close")}
            onClick={() => {
              void api.setSettings({ dismissedUpdate: newVersion.version });
              setNewVersion(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {/* プロジェクトの問題(検証のエラー・警告、読めない録画)。閉じられる。閉じた後に問題が増えたら(中身が変わったら)また出す */}
      {problemLines.length > 0 && problemKey !== dismissedProblems && (
        <div className="banner issues">
          <div className="issues-body">
            <strong>{t("issues")}</strong>
            <ul>
              {problemLines.map((p) => (
                <li key={p.text} className={p.error ? "error" : undefined}>
                  {p.text}
                  {p.relink && (
                    <button
                      type="button"
                      className="small"
                      onClick={() => void relinkSource(p.relink as string)}
                    >
                      {t("relinkSource")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="small"
            title={t("dismissIssues")}
            aria-label={t("dismissIssues")}
            onClick={() => setDismissedProblems(problemKey)}
          >
            ×
          </button>
        </div>
      )}

      <main
        className="main"
        style={{ gridTemplateColumns: `${railShown}px 5px minmax(0, 1fr) 5px ${panelShown}px` }}
      >
        <StepRail
          timeline={timeline}
          media={media}
          thumbs={thumbs}
          thumbsVersion={thumbsVersion}
          projectOpen={projectShown}
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
          onDropFiles={(files) => {
            const paths = files
              .filter((f) => /\.mp4$/i.test(f.name) || isImageSource(f.name))
              .map((f) => api.pathForFile(f));
            if (paths.length) void addSourcePaths(paths);
            else setBanner({ kind: "error", text: t("dropMp4Only") });
          }}
        />
        <Splitter
          dir="col"
          onDrag={(d) =>
            setRailW((w) => Math.min(Math.max(Math.min(w, shownRef.current.rail) + d, RAIL_MIN_W), 400))
          }
        />
        <section className="center" style={{ gridTemplateRows: `minmax(0, 1fr) auto 5px ${timelineH}px` }}>
          <Preview
            outW={out.width}
            outH={out.height}
            project={project}
            step={loc?.entry.step ?? null}
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
                    // 枠をちょうど囲む余白にする(そのステップだけの上書き)。縦横比を変えたら、枠に合わせて録画の端を切り取る
                    onRect: (rect, key, shapeChanged) =>
                      update(
                        (p) =>
                          setStepLayout(p, selection.step, {
                            margin: marginOf(rect, out.width, out.height),
                            ...(shapeChanged ? { fit: "cover" as const } : {}),
                          }),
                        key,
                      ),
                  }
                : null
            }
            onVideoClick={(inside) => {
              if (playing) return;
              if (inside && loc) setSelection({ kind: "video", step: loc.entry.index });
              else if (selection.kind === "video") setSelection({ kind: "step", step: selection.step });
            }}
            onContextMenu={previewMenu}
            tools={
              <>
                {/* 追加の段。基本の編集はプレビューで済ませる。ここから始め、細かい数値は右の設定パネルで直す。
                    使えないとき(再生中・枠の編集中)も消さずに押せなくし、帯の形を変えない */}
                <div className="preview-add" role="toolbar" aria-label={t("addToolbar")}>
                  <AddButton
                    icon="addCaption"
                    label={t("quickCaption")}
                    title={t(captionMissing ? "quickCaptionAddTip" : "quickCaptionTip")}
                    // テロップがあっても再生位置で出ていなければ押せない。消したステップでは押すと全期間のテロップを作る
                    disabled={addDisabled || (captionStep === null && !captionMissing)}
                    onClick={() => {
                      if (!loc) return;
                      const i = loc.entry.index;
                      if (captionMissing)
                        update(
                          (p) => ({
                            ...p,
                            steps: p.steps.map((st, k) => (k === i ? { ...st, caption: { text: "" } } : st)),
                          }),
                          "caption-add",
                        );
                      setSelection({ kind: "caption", step: loc.entry.index });
                      setCaptionEdit(loc.entry.index);
                    }}
                  />
                  <span className="add-sep" aria-hidden="true" />
                  <AddButton
                    icon="addZoom"
                    label={t("quickZoom")}
                    title={withKey(t("quickZoomTip"), "addZoom")}
                    disabled={addDisabled}
                    onClick={() => addZoomAtPlayhead()}
                  />
                  <span className="add-sep" aria-hidden="true" />
                  {NEW_OBJECT_KINDS.map((k) => (
                    <AddButton
                      key={k}
                      icon={ADD_ICON[k]}
                      label={newKindLabel(k)}
                      title={newKindTip(k)}
                      disabled={addDisabled}
                      onClick={() => addObject(k)}
                    />
                  ))}
                </div>
                <div className="preview-status">
                  <div className="preview-tools-left">
                    {(drawingZoom || ((selection.kind === "video" || boxObjectSelected) && !playing)) && (
                      <div className="seg" title={withKey(t("anchorTip"), "anchor")}>
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
                      aria-label={viewZoom === 1 ? t("previewFit") : undefined}
                      onClick={() => setViewZoom(1)}
                    >
                      {viewZoom === 1 ? <Icon name="fitView" /> : `${Math.round(viewZoom * 100)}%`}
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
                  </div>
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
            objects={(stage, caption) => {
              if (!selObject || playing || !loc || loc.entry.index !== selObject.step) return null;
              const st = loc.entry.step;
              const o = objectOf(st, selObject.ref);
              if (!o) return null;
              const m = media.get(st.source);
              const g = frameGeometry(
                project,
                st,
                loc.local,
                stage.w,
                stage.h,
                m?.width || 1920,
                m?.height || 1080,
              );
              return (
                <ObjectEditor
                  project={project}
                  object={o}
                  ref_={selObject.ref}
                  g={isScreenAnchored(o) ? screenGeometry(stage.w, stage.h, g.video) : g}
                  anchor={anchor}
                  onChange={(next, key) =>
                    patchObject(update, selObject.step, selObject.ref, () => next, key)
                  }
                  onEditText={() => document.getElementById(objectTextInputId(selObject.ref.index))?.focus()}
                  outside={shapeOutsideVideo(o, m?.width || 1920, m?.height || 1080)}
                  targets={[
                    ...objectSnapBoxes(
                      st,
                      loc.local,
                      loc.entry.duration,
                      g,
                      screenGeometry(stage.w, stage.h, g.video),
                      selObject.ref,
                    ),
                    ...zoomSnapBoxes(st, g, null),
                    ...(caption ? [caption] : []),
                  ]}
                />
              );
            }}
            snapTargets={(stage, zoomEditing) => {
              if (!loc) return [];
              // ズームの枠の編集中は、そのステップを再生位置で表示しているときだけ(ズームなしの表示に合わせる)
              if (zoomEditing && drawingZoom?.step !== loc.entry.index) return [];
              const st = loc.entry.step;
              const m = media.get(st.source);
              const g = frameGeometry(
                project,
                st,
                loc.local,
                stage.w,
                stage.h,
                m?.width || 1920,
                m?.height || 1080,
                zoomEditing,
              );
              const sg = screenGeometry(stage.w, stage.h, g.video);
              return [
                ...objectSnapBoxes(st, loc.local, loc.entry.duration, g, sg, null),
                ...zoomSnapBoxes(
                  st,
                  g,
                  zoomEditing && drawingZoom ? { zoom: drawingZoom.zoom, key: drawingZoom.key } : null,
                ),
              ];
            }}
            onPickObject={(p, stage) => {
              if (playing || !loc) return false;
              const st = loc.entry.step;
              const m = media.get(st.source);
              const g = frameGeometry(
                project,
                st,
                loc.local,
                stage.w,
                stage.h,
                m?.width || 1920,
                m?.height || 1080,
              );
              const sg = screenGeometry(stage.w, stage.h, g.video);
              const hit = hitObject(project, st, loc.local, loc.entry.duration, g, sg, stage.h, p);
              if (hit) {
                setSelection({ kind: hit.kind, step: loc.entry.index, index: hit.index });
                return true;
              }
              // オブジェクトを選んでいるときの空いた所のクリックは、選択を外すだけにする
              if (selObject) {
                setSelection({ kind: "step", step: selObject.step });
                return true;
              }
              return false;
            }}
            onAddSource={project.steps.length === 0 ? () => void actions.current.addSource?.() : undefined}
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
                  ["toStart", "toStart", "toStart", () => playerRef.current?.seek(0)],
                  ["prev", "prevBoundary", "prevBoundary", () => seekBoundary(-1)],
                  ["back", "back1s", "back1s", () => playerRef.current?.seek(time - 1)],
                ] as const
              ).map(([icon, label, key, fn]) => (
                <button
                  key={icon}
                  type="button"
                  className="icon"
                  title={withKey(t(label), key)}
                  aria-label={t(label)}
                  onClick={fn}
                >
                  <Icon name={icon} />
                </button>
              ))}
              <button
                type="button"
                className="icon play"
                title={withKey(t(playing ? "pause" : "play"), "play")}
                aria-label={t(playing ? "pause" : "play")}
                onClick={() => (playing ? playerRef.current?.stop() : playerRef.current?.play())}
              >
                <Icon name={playing ? "pause" : "play"} />
              </button>
              {(
                [
                  ["forward", "forward1s", "forward1s", () => playerRef.current?.seek(time + 1)],
                  ["next", "nextBoundary", "nextBoundary", () => seekBoundary(1)],
                  ["toEnd", "toEnd", "toEnd", () => playerRef.current?.seek(total)],
                ] as const
              ).map(([icon, label, key, fn]) => (
                <button
                  key={icon}
                  type="button"
                  className="icon"
                  title={withKey(t(label), key)}
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
                title={t("playbackRate")}
                value={PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number]) ? rate : ""}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  setRate(r);
                  playerRef.current?.setRate(r);
                }}
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    ×{r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon"
                title={withKey(t(muted ? "unmute" : "mute"), "mute")}
                aria-label={t(muted ? "unmute" : "mute")}
                onClick={() => setMuted((m) => !m)}
              >
                <Icon name={muted ? "muted" : "volume"} />
              </button>
              <button
                type="button"
                className="icon"
                title={withKey(t("fullscreen"), "fullscreen")}
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
            onAddSource={async (after) => addSourcePaths(await api.pickSources(), after)}
            openMenu={(x, y, items) => setMenu({ x, y, items })}
            onEditZoomRect={(st, z, k) => editZoomRect(st, z, k, false)}
            editingKey={drawingZoom}
            onPreviewSpeech={previewSpeech}
            onMergeNext={mergeNext}
            clipKind={clipKind}
            onCopy={copyItem}
            onCut={cutItem}
            onPaste={pasteAt}
            onRemove={removeItem}
            onAddObjectAt={(kind, at) => addObject(kind, undefined, undefined, at)}
            onAddZoomAt={addZoomAt}
            onAddZoomKey={addZoomKey}
            onSelectObject={(st, ref) => selectObject(st, ref, false)}
          />
        </section>
        <Splitter
          dir="col"
          onDrag={(d) => setPanelW((w) => clampW(Math.min(w, shownRef.current.panel) - d))}
        />
        <aside className="panel">
          <FoldCommandContext.Provider value={foldCmd}>
            {view === "project" || target === null || !tgtStep ? (
              <>
                {/* 見出しは真ん中、欄をすべて閉じるボタンは右端 */}
                <div className="panel-head">
                  <span />
                  <h3 className="panel-title">{t("panelProjectTitle")}</h3>
                  <button
                    type="button"
                    className="small fold-all"
                    title={t("collapseAll")}
                    aria-label={t("collapseAll")}
                    onClick={() => foldOnly(null)}
                  >
                    <Icon name="collapseAll" />
                  </button>
                </div>
                <ProjectPanel
                  project={project}
                  update={update}
                  voices={voices}
                  speechEngines={speechEngines}
                  voiceError={voiceError}
                  onOpenSettings={() => setSettingsOpen("engines")}
                  focusShared={sharedFocus}
                  backgroundError={(() => {
                    const bg = resolveLayout(project).background;
                    return typeof bg !== "string" && "image" in bg
                      ? backgrounds.error(bg.image, filePath)
                      : null;
                  })()}
                />
              </>
            ) : (
              <>
                {/* 見出しは真ん中で左右に前後のステップへの矢印、欄をすべて閉じるボタンは右端 */}
                <div className="panel-head">
                  <span />
                  <div className="panel-nav">
                    <button
                      type="button"
                      className="small icon-btn"
                      title={t("prevStep")}
                      aria-label={t("prevStep")}
                      disabled={target <= 0}
                      onClick={() => selectStep(target - 1)}
                    >
                      <Icon name="chevronLeft" />
                    </button>
                    <h3 className="panel-title">
                      {t("step")} {target + 1}
                    </h3>
                    <button
                      type="button"
                      className="small icon-btn"
                      title={t("nextStep")}
                      aria-label={t("nextStep")}
                      disabled={target >= project.steps.length - 1}
                      onClick={() => selectStep(target + 1)}
                    >
                      <Icon name="chevronRight" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="small fold-all"
                    title={t("collapseAll")}
                    aria-label={t("collapseAll")}
                    onClick={() => foldOnly(null)}
                  >
                    <Icon name="collapseAll" />
                  </button>
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
                    foldOnly("p.caption");
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
                  stepDuration={timeline[target]?.duration ?? 0}
                  onSelectObject={(ref) => selectObject(target, ref)}
                  onAddObject={(k) => addObject(k, target)}
                  onSeekLocal={(step, local) => {
                    const e = timeline[step];
                    if (e) playerRef.current?.seek(e.start + Math.min(local, e.duration));
                  }}
                  onShapeAnchor={(index, anchor) => setShapeAnchor(target, index, anchor)}
                  imageSize={(p) => images.size(p, filePath)}
                  loadImage={(p) =>
                    images.load(p, filePath).then((img) => (img ? { w: img.width, h: img.height } : null))
                  }
                  imageError={(p) => images.error(p, filePath)}
                />
              </>
            )}
          </FoldCommandContext.Provider>
        </aside>
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {shortcutsOpen && (
        <ShortcutsDialog
          onClose={() => setShortcutsOpen(false)}
          onEdit={() => {
            setShortcutsOpen(false);
            setSettingsOpen("shortcuts");
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          focus={settingsOpen === true ? undefined : settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onLanguage={() => setLangVersion((v) => v + 1)}
          onKeys={() => setLangVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

/** 追加の段のアイコン */
const ADD_ICON: Record<NewObjectKind, IconName> = {
  pointer: "ptrArrow",
  highlighter: "ptrHighlighter",
  rect: "addRect",
  arrow: "addArrow",
  text: "addText",
  image: "ptrImage",
};

/** 追加の段のボタン(アイコンの下に名前)。狭いときは名前を隠してアイコンだけにする(名前はツールチップに残る) */
function AddButton(props: {
  icon: IconName;
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="add-button"
      title={props.title}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      <span className="add-label">{props.label}</span>
    </button>
  );
}
