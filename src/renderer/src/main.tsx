import { createRoot } from "react-dom/client";
import { App } from "./App";
import { runExportJob } from "./export-job";
import "./styles.css";

const mode = new URLSearchParams(location.search).get("mode");
if (mode === "export") {
  runExportJob();
} else {
  createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}
