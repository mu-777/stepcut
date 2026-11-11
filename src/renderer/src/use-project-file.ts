import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { newProject } from "../../core/edit";
import type { Project } from "../../core/schema";
import { parseProjectText, serializeProject } from "../../core/validate";
import { api } from "./api";
import { commit, type History, initHistory } from "./history";
import { t } from "./i18n";
import type { Player } from "./player";
import type { Selection } from "./timeline";

/** 画面上端の知らせ。reveal があれば、そのファイルのフォルダーを開くリンクを付ける */
export type Banner = { kind: "info" | "error"; text: string; reveal?: string };

/** プロジェクトの名前(ファイル名から拡張子を除く) */
const baseName = (p: string) => p.replace(/^.*[\\/]/, "").replace(/(\.sanno)?\.json$/i, "");

/** 復旧ファイルを書くまでの待ち(最後の変更から) */
const RECOVERY_DELAY_MS = 5000;

/** 読み込んだ結果と比べられる形(保存するときと同じ整形)。読めなければそのまま */
function canonicalText(text: string): string {
  const r = parseProjectText(text);
  return r.ok ? serializeProject(r.project) : text;
}

type Args = {
  project: Project;
  setHist: Dispatch<SetStateAction<History>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
  playerRef: RefObject<Player | null>;
  setBanner: Dispatch<SetStateAction<Banner | null>>;
};

/**
 * プロジェクトファイルの状態と流れ(読み込み・保存・名前の変更・新規・開く・外部変更・クラッシュ復旧)。
 * 履歴(hist)は App が持ち、ここは setHist で書き換える
 */
export function useProjectFile({ project, setHist, setSelection, playerRef, setBanner }: Args) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [savedText, setSavedText] = useState(() => serializeProject(newProject()));
  /** ヘッダーのプロジェクト名を入力中 */
  const [titleEdit, setTitleEdit] = useState(false);
  /** まだ保存していないプロジェクトに付けた名前(保存するときのファイル名) */
  const [pendingName, setPendingName] = useState<string | null>(null);
  /** 名前を入れ終えたら保存する(未保存で「保存」を押した) */
  /** 名前の入力のあとに保存する(close なら保存できたあと閉じる) */
  const saveAfterName = useRef<false | true | "close">(false);

  const dirty = serializeProject(project) !== savedText;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);
  const projectName = filePath ? baseName(filePath) : (pendingName ?? t("untitled"));
  // ウィンドウのタイトル(タスクバー)にもプロジェクトの名前を出す
  useEffect(() => {
    document.title = `${dirty ? "● " : ""}${projectName} — Screen Annotator`;
  }, [dirty, projectName]);

  const loadProject = useCallback(
    (path: string, text: string, keepHistory: boolean) => {
      const r = parseProjectText(text);
      if (!r.ok) {
        // 何が開けなかったかを先に書く(下の行は直す場所。手で直す人・AI のためにそのまま出す)
        setBanner({
          kind: "error",
          text: [
            `${t("openFailed")}: ${path.replace(/^.*[\\/]/, "")}`,
            ...r.errors.map((e) => `${e.path}: ${e.message}`),
          ].join("\n"),
        });
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
    },
    [setBanner, setHist, setSelection, playerRef],
  );

  /** 復旧ファイルが残っているプロジェクト(書いた・復元した)。保存・破棄・保存先の変更で消す */
  const recoveryWritten = useRef<{ path: string | null } | null>(null);
  /**
   * 前回のクラッシュで残った復旧ファイルがあれば、復元するか尋ねる(PRJ-06)。読み込んだ内容(diskText)と同じ・読めない
   * ものは黙って消す。復元しても savedText は読み込んだ内容のままなので、未保存の変更として出る
   */
  const offerRecovery = useCallback(
    async (projectPath: string | null, diskText: string) => {
      try {
        const rec = await api.readRecovery(projectPath);
        if (!rec) return;
        const r = parseProjectText(rec.text);
        if (!r.ok || serializeProject(r.project) === diskText) {
          await api.clearRecovery(projectPath);
          return;
        }
        if (!window.confirm(t("recoverConfirm").replace("{time}", new Date(rec.savedAt).toLocaleString()))) {
          await api.clearRecovery(projectPath);
          return;
        }
        recoveryWritten.current = { path: projectPath };
        setHist(initHistory(r.project));
        if (projectPath === null) setPendingName(rec.name);
      } catch {
        // 復旧は補助。失敗しても編集は続ける
      }
    },
    [setHist],
  );

  const confirmDiscard = () => !dirty || window.confirm(t("discardConfirm"));

  /** 保存する。保存できたら true(保存先の選択を取り消したときは false) */
  async function save(path: string | null, name?: string): Promise<boolean> {
    const r = await api.saveProject(path, serializeProject(project), filePath, name);
    if (!r) return false;
    loadProject(r.filePath, r.text, true);
    setPendingName(null);
    return true;
  }

  /** ヘッダーのプロジェクト名の入力を終えた。保存済みならファイル名を変え、未保存なら保存するときの名前にする */
  async function commitName(raw: string | null) {
    setTitleEdit(false);
    const wantSave = saveAfterName.current;
    saveAfterName.current = false;
    // ファイル名に使えない文字は除く
    const name = raw?.replace(/[\\/:*?"<>|]/g, "").trim() ?? "";
    if (!name) return;
    if (!filePath) {
      setPendingName(name);
      if (wantSave) {
        try {
          if ((await save(null, name)) && wantSave === "close") api.closeAfterSave();
        } catch (e) {
          setBanner({ kind: "error", text: (e as Error).message });
        }
      }
      return;
    }
    if (name === baseName(filePath)) return;
    try {
      setFilePath(await api.renameProject(filePath, name));
    } catch (e) {
      setBanner({ kind: "error", text: (e as Error).message });
    }
  }

  /** メニュー・ショートカットから呼ぶファイル操作(App の actions に差し込む。毎回の描画で作り直す) */
  const fileActions = {
    new: () => {
      if (!confirmDiscard()) return;
      const p = newProject();
      setHist(initHistory(p));
      setSavedText(serializeProject(p));
      setFilePath(null);
      setPendingName(null);
      setSelection({ kind: "project" });
    },
    open: async () => {
      if (!confirmDiscard()) return;
      const r = await api.openProjectDialog();
      if (r && loadProject(r.filePath, r.text, false)) void offerRecovery(r.filePath, canonicalText(r.text));
    },
    // まだ保存していないプロジェクトは、先にヘッダーで名前を入れてもらう
    save: () => {
      if (filePath) void save(filePath);
      else if (pendingName) void save(null, pendingName);
      else {
        saveAfterName.current = true;
        setTitleEdit(true);
      }
    },
    // ウィンドウを閉じるときの「保存して閉じる」。保存できたときだけ閉じる(取り消し・失敗なら閉じない)
    saveAndClose: async () => {
      try {
        if (filePath) {
          if (await save(filePath)) api.closeAfterSave();
        } else if (pendingName) {
          if (await save(null, pendingName)) api.closeAfterSave();
        } else {
          saveAfterName.current = "close";
          setTitleEdit(true);
        }
      } catch (e) {
        setBanner({ kind: "error", text: (e as Error).message });
      }
    },
  };

  useEffect(() => {
    api
      .initialProject()
      .then((p) => {
        if (!p) return offerRecovery(null, serializeProject(newProject()));
        if (loadProject(p.filePath, p.text, false)) return offerRecovery(p.filePath, canonicalText(p.text));
      })
      .catch(() => {});
  }, [loadProject, offerRecovery]);

  // クラッシュ復旧の自動保存: 未保存の変更があるとき、最後の変更の 5 秒後に別ファイルへ書く(PRJ-06)。
  // プロジェクトや保存先が変わると前のタイマーは捨てる。保存・破棄・読み込み直し・名前の変更で古い復旧ファイルを消す
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      recoveryWritten.current = { path: filePath };
      api.writeRecovery(filePath, filePath ? null : pendingName, serializeProject(project)).catch(() => {});
    }, RECOVERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, project, filePath, pendingName]);
  useEffect(() => {
    const w = recoveryWritten.current;
    if (w && (!dirty || w.path !== filePath)) {
      recoveryWritten.current = null;
      api.clearRecovery(w.path).catch(() => {});
    }
  }, [dirty, filePath]);

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
    [loadProject, setBanner],
  );

  return {
    filePath,
    dirty,
    projectName,
    pendingName,
    titleEdit,
    setTitleEdit,
    saveAfterName,
    commitName,
    fileActions,
  };
}
