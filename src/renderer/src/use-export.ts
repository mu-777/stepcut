import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import type { Project } from "../../core/schema";
import type { Issue } from "../../core/validate";
import { api } from "./api";
import { exportProject } from "./exporter";
import { t } from "./i18n";
import type { Player } from "./player";
import type { SpeechStore } from "./speech";
import type { Banner } from "./use-project-file";

type Args = {
  project: Project;
  filePath: string | null;
  /** プロジェクトの検証の指摘(あれば書き出さない) */
  issues: Issue[];
  issuePath: (path: string) => string;
  playerRef: RefObject<Player | null>;
  speech: SpeechStore;
  setBanner: Dispatch<SetStateAction<Banner | null>>;
};

/** mp4 の書き出し。進み具合を exporting に持つ(書き出していなければ null) */
export function useExport({ project, filePath, issues, issuePath, playerRef, speech, setBanner }: Args) {
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  /** 書き出し中だけある。abort で中止する */
  const abort = useRef<AbortController | null>(null);

  /** 書き出しを中止する(途中のファイルは残さない) */
  const cancelExport = () => abort.current?.abort();

  async function doExport() {
    if (issues.length > 0) {
      setBanner({ kind: "error", text: issues.map((e) => `${issuePath(e.path)}: ${e.message}`).join("\n") });
      return;
    }
    const outPath = await api.pickExportPath(
      filePath ? filePath.replace(/(\.sanno)?\.json$/i, ".mp4") : "output.mp4",
    );
    if (!outPath) return;
    playerRef.current?.stop();
    setExporting({ done: 0, total: 1 });
    api.setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await exportProject({
        project,
        projectPath: filePath,
        outPath,
        speech,
        signal: ac.signal,
        onProgress: (done, totalFrames) => {
          if (done % 10 === 0 || done === totalFrames) setExporting({ done, total: totalFrames });
        },
      });
      setBanner({
        kind: "info",
        text: [`${t("exportDone")}: ${r.outPath}`, ...r.warnings].join("\n"),
        reveal: r.outPath,
      });
    } catch (e) {
      if (ac.signal.aborted) setBanner({ kind: "info", text: t("exportCanceled") });
      else setBanner({ kind: "error", text: `${t("exportFailed")}: ${(e as Error).message}` });
    } finally {
      abort.current = null;
      api.setBusy(false);
      setExporting(null);
    }
  }

  return { exporting, doExport, cancelExport };
}
