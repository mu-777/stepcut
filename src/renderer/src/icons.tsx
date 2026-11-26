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
  // プレビューの全体表示: 枠の中に ↔(タイムラインの全体表示 ↔ とそろえる。全画面の四隅のかぎと見分ける)
  fitView: "M3 5h18v14H3zM7 12h10M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  // ヘッダー(線だけのアイコン)
  // ファイル(新規・開く・保存のメニュー): 書類
  fileMenu: "M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7",
  exportVideo: "M12 15V3M7 8l5-5 5 5M4 14v6h16v-6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  // オブジェクトの操作(設定パネルの見出しの右)
  duplicate: "M9 9h11v11H9zM5 15V4h11",
  bringForward: "M12 20V8M7 13l5-5 5 5M5 4h14",
  sendBackward: "M12 4v12M7 11l5 5 5-5M5 20h14",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  // キー操作の一覧: 丸の中の ?
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 16.5v.5",
  // 支援(Ko-fi へのリンク): ハート
  heart: "M12 20.5S3.5 15.5 3.5 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2.5c0 6-8.5 11-8.5 11z",
  // ポインターの見た目(設定パネルの切り替え)
  ptrArrow: "M6 3v15l4-4 3 6 2-1-3-6h6z",
  ptrDot: "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  ptrRing: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  ptrHighlighter: "M3 15h18v5H3zM14 3l4 4-6 6H8V9z",
  ptrImage: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  // プレビューの下の追加の段(線だけ。ポインター・蛍光ペン・画像は上の見た目のアイコンを使う)
  // テロップ: 画面の下に文字の線
  addCaption: "M3 5h18v14H3zM7 15.5h10",
  // ズーム: 虫めがねの中に ＋
  addZoom: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3L20 20M8 10.5h5M10.5 8v5",
  addRect: "M4 6h16v12H4z",
  addArrow: "M5 19L18 6M10 5.5h8.5V14",
  // テキスト: T
  addText: "M5 7V5h14v2M12 5v14M9 19h6",
  // 歯車(塗り。Material Icons の settings、Apache-2.0)
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
};

/** 線も描くアイコン。OUTLINE は線だけ(塗らない) */
const LINE_ICONS = [
  "panelProject",
  "collapseAll",
  "fitView",
  "chevronLeft",
  "chevronRight",
  "fileMenu",
  "exportVideo",
  "undo",
  "redo",
  "duplicate",
  "bringForward",
  "sendBackward",
  "trash",
  "help",
  "heart",
  "ptrRing",
  "ptrImage",
  "addCaption",
  "addZoom",
  "addRect",
  "addArrow",
  "addText",
];
const STROKED = new Set(["volume", "muted", ...LINE_ICONS]);
const OUTLINE = new Set(LINE_ICONS);

export type IconName = keyof typeof paths;

export function Icon(props: { name: IconName }) {
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
