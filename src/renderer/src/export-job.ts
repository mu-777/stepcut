// CLI の export から起動された非表示ウィンドウで書き出しを行う(AI-02)。
import { parseProjectText } from "../../core/validate";
import { api } from "./api";
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
