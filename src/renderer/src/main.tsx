import { createRoot } from "react-dom/client";
import { App } from "./App";
import { api } from "./api";
import { runExportJob } from "./export-job";
import { setLanguage } from "./i18n";
import { setKeyOverrides } from "./keymap";
import "./styles.css";

const mode = new URLSearchParams(location.search).get("mode");
if (mode === "export") {
  runExportJob();
} else {
  // 画面の言語とキー操作はアプリの設定に従う(読めなければ OS の言語・既定のキーのまま)
  void api
    .getSettings()
    .then((s) => {
      setLanguage(s.language);
      setKeyOverrides(s.shortcuts);
    })
    .catch(() => {})
    .finally(() => createRoot(document.getElementById("root") as HTMLElement).render(<App />));
}
