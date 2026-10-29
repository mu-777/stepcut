import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveOutput } from "../../core/defaults";
import { deleteStep, duplicateStep, moveStep, newProject, splitStep, uniqueStepId } from "../../core/edit";
import type { Project } from "../../core/schema";
import { buildTimeline, locate, totalDuration } from "../../core/timeline";
import { parseProject, parseProjectText, serializeProject } from "../../core/validate";
import type { Voice } from "../../shared/api";
import { api } from "./api";
import { exportProject } from "./exporter";
import { commit, type History, initHistory, redo, undo } from "./history";
import { t } from "./i18n";
import { ProjectInspector, StepInspector } from "./inspector";
import { openMedia, type SourceMedia } from "./media";
import { PLAYBACK_RATES, type Player, type PlayerState } from "./player";
import { Preview } from "./preview";
import { SpeechStore } from "./speech";
import { ThumbCache } from "./thumbs";
import { fmtTime, type MenuItem, type Selection, selectedStep, Timeline } from "./timeline";
import { ContextMenu, loadPref, Splitter, savePref } from "./widgets";

const isTyping = () => {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  );
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
  const [trimPreview, setTrimPreview] = useState<{ step: number; time: number } | null>(null);
  const [drawingZoom, setDrawingZoom] = useState<{ step: number; zoom: number } | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [banner, setBanner] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [leftW, setLeftW] = useState(() => loadPref("leftWidth", 220));
  const [rightW, setRightW] = useState(() => loadPref("rightWidth", 320));
  const [timelineH, setTimelineH] = useState(() => loadPref("timelineHeight", 190));
  const [zoomCommand, setZoomCommand] = useState<{ n: number; kind: "in" | "out" | "fit" }>({
    n: 0,
    kind: "fit",
  });
  useEffect(() => savePref("leftWidth", leftW), [leftW]);
  useEffect(() => savePref("rightWidth", rightW), [rightW]);
  useEffect(() => savePref("timelineHeight", timelineH), [timelineH]);
  const [thumbsVersion, setThumbsVersion] = useState(0);
  const thumbs = useMemo(() => new ThumbCache(() => setThumbsVersion((v) => v + 1)), []);
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

  // 停止中の表示を更新する
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示に関わる値が変わったら描き直す
  useEffect(() => {
    playerRef.current?.renderStill();
  }, [project, timeline, media, trimPreview, drawingZoom]);

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
              { id: uniqueStepId(p, "step"), source: id, in: 0, out: Math.round(m.duration * 1000) / 1000 },
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
    if (s.kind === "project") return;
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
    else if (s.kind === "speech") patch((st) => ({ ...st, speech: undefined }));
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
    if (key === "Escape") setDrawingZoom(null);
    else if (key === " ") {
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
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loc = locate(timeline, time);
  const selStep = selected !== null ? project.steps[selected] : undefined;
  const playheadLocal = loc && selected === loc.entry.index ? loc.local : 0;
  const selMedia = selStep ? media.get(selStep.source) : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: speechVersion で生成の進み具合を拾う
  const speechInfo = useMemo(() => {
    if (!selStep) return null;
    const err = speech.error(project, selStep);
    if (err) return `⚠ ${err}`;
    if (speech.isPending(project, selStep)) return t("speechPending");
    const a = speech.get(project, selStep);
    return a ? `${a.duration.toFixed(2)} s` : null;
  }, [selStep, project, speech, speechVersion]);

  /** ステップ一覧から選ぶ。再生ヘッドがそのステップの外なら先頭へ移す */
  const selectStep = (i: number) => {
    setSelection({ kind: "step", step: i });
    setDrawingZoom(null);
    const e = timeline[i];
    if (e && !(loc && loc.entry.index === i)) playerRef.current?.seek(e.start);
  };

  /** タイムラインで要素を選ぶ。ズームの範囲の編集は別の要素を選んだら終える */
  const select = (s: Selection) => {
    setSelection(s);
    if (drawingZoom && !(s.kind === "zoom" && s.step === drawingZoom.step && s.index === drawingZoom.zoom))
      setDrawingZoom(null);
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
        {
          label: t("delete"),
          action: () => {
            update((p) => deleteStep(p, i));
            setSelection({ kind: "project" });
          },
        },
      ],
    });
  };

  const editZoomRect = (step: number, zoom: number) => {
    playerRef.current?.stop();
    setSelection({ kind: "zoom", step, index: zoom });
    setDrawingZoom({ step, zoom });
  };

  // ズーム範囲の指定を始めたら、ズームの途中に移して範囲を指定する場面を見せる
  // (追加した直後のズームはこの時点で project に入っているので、effect で行う)
  const drawingKey = drawingZoom ? `${drawingZoom.step}:${drawingZoom.zoom}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 指定を始めたときだけ移す
  useEffect(() => {
    if (!drawingZoom) return;
    const e = timeline[drawingZoom.step];
    const z = project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom];
    if (e && z) playerRef.current?.seek(e.start + (z.start + z.end) / 2);
  }, [drawingKey]);

  const out = resolveOutput(project);
  const clampW = (v: number) => Math.min(Math.max(v, 160), 640);

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" onClick={() => actions.current.new?.()}>
          {t("new")}
        </button>
        <button type="button" onClick={() => actions.current.open?.()}>
          {t("open")}
        </button>
        <button type="button" onClick={() => actions.current.save?.()}>
          {t("save")}
        </button>
        <button type="button" onClick={() => actions.current.addSource?.()}>
          {t("addRecording")}
        </button>
        <button
          type="button"
          onClick={() => doExport()}
          disabled={exporting !== null || project.steps.length === 0}
        >
          {exporting
            ? `${t("exporting")} ${Math.round((exporting.done / Math.max(1, exporting.total)) * 100)}%`
            : t("export")}
        </button>
        <span className="sep" />
        <button type="button" onClick={() => setHist(undo)} disabled={hist.past.length === 0}>
          {t("undo")}
        </button>
        <button type="button" onClick={() => setHist(redo)} disabled={hist.future.length === 0}>
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

      <main className="main" style={{ gridTemplateColumns: `${leftW}px 5px minmax(0, 1fr) 5px ${rightW}px` }}>
        <aside className="left-pane">
          <button
            type="button"
            className={`nav-item ${selection.kind === "project" ? "selected" : ""}`}
            onClick={() => select({ kind: "project" })}
          >
            {t("project")}
          </button>
          <h3>{t("stepList")}</h3>
          {project.sources.length === 0 && <p className="hint">{t("noSources")}</p>}
          <ol className="step-list">
            {timeline.map((e) => (
              <li key={`${e.index}-${e.step.id}`} className={e.index === selected ? "selected" : ""}>
                <button
                  type="button"
                  className="step-item"
                  onClick={() => selectStep(e.index)}
                  onContextMenu={(ev) => stepMenu(ev, e.index)}
                >
                  <span className="step-id">
                    {e.index + 1}. {e.step.id}
                    {(e.step.speed ?? 1) > 1 ? ` ×${e.step.speed}` : ""}
                  </span>
                  <span className="step-dur">{e.duration.toFixed(1)}s</span>
                  <span className="step-caption">{e.step.caption?.text || "—"}</span>
                </button>
              </li>
            ))}
          </ol>
          {project.sources.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const src = selStep
                  ? project.sources.find((s) => s.id === selStep.source)
                  : project.sources[0];
                if (!src) return;
                const m = media.get(src.id);
                update((p) => ({
                  ...p,
                  steps: [
                    ...p.steps,
                    {
                      id: uniqueStepId(p, "step"),
                      source: src.id,
                      in: 0,
                      out: Math.round((m?.duration ?? 1) * 1000) / 1000,
                    },
                  ],
                }));
                setSelection({ kind: "step", step: project.steps.length });
              }}
            >
              {t("addStep")}
            </button>
          )}
          <p className="hint">
            {t("total")}: {fmtTime(total)}
          </p>
        </aside>
        <Splitter dir="col" onDrag={(d) => setLeftW((w) => clampW(w + d))} />

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
                ? {
                    srcW: selMedia.width,
                    srcH: selMedia.height,
                    rect: project.steps[drawingZoom.step]?.zooms?.[drawingZoom.zoom]?.rect ?? null,
                    onRect: (rect) => {
                      update((p) => ({
                        ...p,
                        steps: p.steps.map((s, i) =>
                          i === drawingZoom.step
                            ? {
                                ...s,
                                zooms: s.zooms?.map((z, k) => (k === drawingZoom.zoom ? { ...z, rect } : z)),
                              }
                            : s,
                        ),
                      }));
                      setDrawingZoom(null);
                    },
                  }
                : null
            }
          />
          <div className="transport">
            <button
              type="button"
              className="play"
              onClick={() => (playing ? playerRef.current?.stop() : playerRef.current?.play())}
            >
              {playing ? t("pause") : t("play")}
            </button>
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
              {rate < 0 && <option value="">◀ ×{-rate}</option>}
              {PLAYBACK_RATES.map((r) => (
                <option key={r} value={r}>
                  ×{r}
                </option>
              ))}
            </select>
            <span className="time">
              {fmtTime(time)} / {fmtTime(total)}
            </span>
            {drawingZoom && <span className="hint">{t("drawingRect")}</span>}
            <span className="spacer" />
            <button
              type="button"
              className="small"
              title={t("zoomOut")}
              onClick={() => setZoomCommand((c) => ({ n: c.n + 1, kind: "out" }))}
            >
              −
            </button>
            <button
              type="button"
              className="small"
              title={t("zoomIn")}
              onClick={() => setZoomCommand((c) => ({ n: c.n + 1, kind: "in" }))}
            >
              +
            </button>
            <button
              type="button"
              className="small"
              onClick={() => setZoomCommand((c) => ({ n: c.n + 1, kind: "fit" }))}
            >
              {t("zoomFit")}
            </button>
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
            zoomCommand={zoomCommand}
          />
        </section>
        <Splitter dir="col" onDrag={(d) => setRightW((w) => clampW(w - d))} />

        <aside className="side">
          <h3 className="side-title">
            {t("settingsOf")}:{" "}
            {selected !== null && selStep ? `${t("step")} ${selected + 1} (${selStep.id})` : t("project")}
          </h3>
          {selected !== null && selStep ? (
            <StepInspector
              project={project}
              index={selected}
              update={update}
              voices={voices}
              playheadLocal={playheadLocal}
              speechInfo={speechInfo}
              focus={selection}
              onDrawZoom={(zoom) => editZoomRect(selected, zoom)}
            />
          ) : (
            <ProjectInspector project={project} update={update} voices={voices} />
          )}
        </aside>
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
    </div>
  );
}
