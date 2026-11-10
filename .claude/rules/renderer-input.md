---
paths:
  - "src/renderer/**"
---

# レンダラーのキー操作とフォーカス

- Ctrl+Z / Ctrl+Shift+Z はメニューから届き、`isTyping()` が真なら入力欄の文字の取り消しに回す。`isTyping()` はテキスト・数値の入力欄とテキストエリアだけを含める(チェックボックス・選択欄・スライダーを含めると、それらを触った後に Ctrl+Z が効かなくなる)
- ドラッグの `pointerdown` で `preventDefault` するとフォーカスが入力欄に残る。App の `pointerdown`(キャプチャ)でフォーカスを外しているので、フォーカスを入力欄に残したい部品は input / button などの中に置く
- Ctrl+C / Ctrl+X / Ctrl+V はメニューの role(copy / cut / paste)から `copy` / `cut` / `paste` イベントとして届く。キーの keydown では拾えない
- 単独キーの操作(再生・シーク・分割など)は `keymap.ts` の `actionOf` で判定する。`e.key` を直接比べない(アプリの設定で割り当てを変えられるため)。ツールチップ・右クリックメニューのキーも `keyLabel` / `withKey` で今の割り当てを出す
- 録画・ズームの枠の編集中は矢印キーで枠が動く(シークしない)。E2E でシークするときは Esc で編集を終えてから
