// CLI の export・frame・inspect から起動された非表示ウィンドウで仕事をする(AI-02, AI-03)。
import { parseProjectText } from "../../core/validate";
import { api } from "./api";
import { runFrame, runInspect } from "./cli-jobs";
import { exportProject } from "./exporter";

export async function runExportJob(): Promise<void> {
  const job = await api.getExportJob();
  if (!job) {
    api.finishExport({ ok: false, warnings: [], error: "no export job" });
    return;
  }
  const parsed = parseProjectText(job.projectText);
  if (!parsed.ok) {
    api.finishExport({
      ok: false,
      warnings: [],
      error: parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    });
    return;
  }
  if (job.kind !== "export") {
    try {
      const result =
        job.kind === "frame"
          ? await runFrame(parsed.project, job.projectPath, job.outPath, job.frame ?? {})
          : await runInspect(parsed.project, job.projectPath);
      result.warnings.unshift(...parsed.warnings.map((w) => `${w.path}: ${w.message}`));
      api.finishExport(result);
    } catch (e) {
      api.finishExport({ ok: false, warnings: [], error: (e as Error).message });
    }
    return;
  }
  let lastReport = 0;
  try {
    const result = await exportProject({
      project: parsed.project,
      projectPath: job.projectPath,
      outPath: job.outPath,
      onProgress: (done, total) => {
        const now = performance.now();
        if (now - lastReport > 500 || done === total) {
          lastReport = now;
          api.reportExportProgress(done, total);
        }
      },
    });
    result.warnings.unshift(...parsed.warnings.map((w) => `${w.path}: ${w.message}`));
    api.finishExport(result);
  } catch (e) {
    api.finishExport({ ok: false, warnings: [], error: (e as Error).message });
  }
}
