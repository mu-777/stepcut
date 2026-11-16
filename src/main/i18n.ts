// メインプロセスが自分で出す文言(ネイティブのダイアログとメニュー)。画面に出すエラーは shared/messages.ts のコードで返し、画面が訳す。
// 言語はアプリの設定に従い、auto なら OS の言語(docs/decisions/20261116-message-i18n.md)。

const en = {
  file: "File",
  edit: "Edit",
  view: "View",
  new: "New",
  open: "Open…",
  save: "Save",
  addRecording: "Add Recording or Image…",
  export: "Export…",
  undo: "Undo",
  redo: "Redo",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  actualSize: "Actual Size",
  shortcuts: "Keyboard Shortcuts",
  exportRunning: "An export is running. Cancel it and close?",
  cancelExportAndClose: "Cancel Export and Close",
  keepOpen: "Keep Open",
  unsavedChanges: "You have unsaved changes.",
  saveAndClose: "Save and Close",
  discardAndClose: "Discard and Close",
  cancel: "Cancel",
};

const ja: Record<keyof typeof en, string> = {
  file: "ファイル",
  edit: "編集",
  view: "表示",
  new: "新規",
  open: "開く…",
  save: "保存",
  addRecording: "録画・画像を追加…",
  export: "書き出し…",
  undo: "元に戻す",
  redo: "やり直す",
  zoomIn: "拡大",
  zoomOut: "縮小",
  actualSize: "実際のサイズ",
  shortcuts: "キー操作の一覧",
  exportRunning: "書き出し中です。中止して閉じますか？",
  cancelExportAndClose: "中止して閉じる",
  keepOpen: "閉じない",
  unsavedChanges: "保存していない変更があります。",
  saveAndClose: "保存して閉じる",
  discardAndClose: "破棄して閉じる",
  cancel: "キャンセル",
};

export type MainMessageKey = keyof typeof en;

let dict: Record<MainMessageKey, string> = en;

/** 言語を決める。auto なら osLocale(app.getLocale())が ja で始まるとき日本語 */
export function setMainLanguage(lang: "auto" | "ja" | "en", osLocale: string): void {
  dict = lang === "ja" || (lang === "auto" && osLocale.toLowerCase().startsWith("ja")) ? ja : en;
}

export function mt(key: MainMessageKey): string {
  return dict[key];
}
