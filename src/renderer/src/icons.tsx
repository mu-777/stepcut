// 再生操作(一般的な動画プレイヤーの形)、ヘッダーの操作、設定パネルのアイコン。色は文字色に合わせる。
const paths: Record<string, string> = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  toStart: "M6 5h2v14H6zM20 5v14L9 12z",
  toEnd: "M16 5h2v14h-2zM4 5v14l11-7z",
  prev: "M11 5v14L3 12zM21 5v14l-8-7z",
  next: "M13 5v14l8-7zM3 5v14l8-7z",
  back: "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
  forward: "M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z",
  volume: "M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13",
  muted: "M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6",
  fullscreen: "M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z",
  // 全体: 画面の中に録画の枠
  panelProject: "M3 5h18v14H3zM7 8.5h10v7H7z",
  // 設定パネルの欄をすべて閉じる: 向かい合う山形
  collapseAll: "M7 4l5 5 5-5M7 20l5-5 5 5",
  // ヘッダー(線だけのアイコン)
  fileNew: "M6 3h8l5 5v13H6zM14 3v5h5M12 11v6M9 14h6",
  fileOpen: "M3 6h6l2 2h10v11H3z",
  fileSave: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  fileSaveAs: "M12 20H5V4h11l3 3v4M8 4v5h7V4M15 21l6-6-2-2-6 6v2z",
  addRecording: "M3 6h12v12H3zM15 10l6-3v10l-6-3M9 9v6M6 12h6",
  exportVideo: "M12 15V3M7 8l5-5 5 5M4 14v6h16v-6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  settings:
    "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
};

/** 線も描くアイコン。OUTLINE は線だけ(塗らない) */
const LINE_ICONS = [
  "panelProject",
  "collapseAll",
  "fileNew",
  "fileOpen",
  "fileSave",
  "fileSaveAs",
  "addRecording",
  "exportVideo",
  "undo",
  "redo",
  "settings",
];
const STROKED = new Set(["volume", "muted", ...LINE_ICONS]);
const OUTLINE = new Set(LINE_ICONS);

export function Icon(props: { name: keyof typeof paths }) {
  const stroke = STROKED.has(props.name);
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={paths[props.name]}
        fill={OUTLINE.has(props.name) ? "none" : "currentColor"}
        stroke={stroke ? "currentColor" : "none"}
        strokeWidth={stroke ? 1.6 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
