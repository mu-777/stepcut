import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Api, CliJobResult, ExportResult, OpenedProject, TtsRequest } from "../shared/api";

const api: Api = {
  platform: process.platform,
  openProjectDialog: () => ipcRenderer.invoke("project:open-dialog"),
  readProject: (filePath) => ipcRenderer.invoke("project:read", filePath),
  initialProject: () => ipcRenderer.invoke("project:initial"),
  saveProject: (filePath, text, prevPath, name) =>
    ipcRenderer.invoke("project:save", filePath, text, prevPath, name),
  renameProject: (filePath, name) => ipcRenderer.invoke("project:rename", filePath, name),
  pickSources: () => ipcRenderer.invoke("sources:pick"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  setAzureKey: (key) => ipcRenderer.invoke("settings:azure-key", key),
  pickExecutable: () => ipcRenderer.invoke("dialog:pick-exe"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  pickDirectory: (defaultPath) => ipcRenderer.invoke("dialog:pick-dir", defaultPath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  pickImage: () => ipcRenderer.invoke("image:pick"),
  revealFile: (absPath: string) => ipcRenderer.invoke("file:reveal", absPath),
  pickExportPath: (defaultPath) => ipcRenderer.invoke("export:pick", defaultPath),
  resolveSource: (projectPath, stored) => ipcRenderer.invoke("sources:resolve", projectPath, stored),
  setDirty: (dirty) => ipcRenderer.send("project:dirty", dirty),
  onExternalChange: (cb) => {
    const listener = (_e: unknown, p: OpenedProject) => cb(p);
    ipcRenderer.on("project:external-change", listener);
    return () => ipcRenderer.off("project:external-change", listener);
  },
  onMenu: (cb) => {
    const listener = (_e: unknown, command: string) => cb(command);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.off("menu", listener);
  },
  fileSize: (p) => ipcRenderer.invoke("file:size", p),
  readRange: (p, start, end) => ipcRenderer.invoke("file:read-range", p, start, end),
  openOutput: (p) => ipcRenderer.invoke("output:open", p),
  writeOutput: (handle, position, data) => ipcRenderer.invoke("output:write", handle, position, data),
  closeOutput: (handle) => ipcRenderer.invoke("output:close", handle),
  writeText: (p, text) => ipcRenderer.invoke("file:write-text", p, text),
  ttsVoices: (engine) => ipcRenderer.invoke("tts:voices", engine),
  ttsSynthesize: (req: TtsRequest) => ipcRenderer.invoke("tts:synthesize", req),
  getExportJob: () => ipcRenderer.invoke("export:job"),
  reportExportProgress: (done, total) => ipcRenderer.send("export:progress", done, total),
  finishExport: (result: ExportResult | CliJobResult) => ipcRenderer.send("export:finish", result),
};

contextBridge.exposeInMainWorld("api", api);
