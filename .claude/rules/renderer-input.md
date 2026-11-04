---
paths:
  - "src/renderer/**"
---

# レンダラーのキー操作とフォーカス

- Ctrl+Z / Ctrl+Shift+Z はメニューから届き、`isTyping()` が真なら入力欄の文字の取り消しに回す。`isTyping()` はテキスト・数値の入力欄とテキストエリアだけを含める(チェックボックス・選択欄・スライダーを含めると、それらを触った後に Ctrl+Z が効かなくなる)
- ドラッグの `pointerdown` で `preventDefault` するとフォーカスが入力欄に残る。App の `pointerdown`(キャプチャ)でフォーカスを外しているので、フォーカスを入力欄に残したい部品は input / button などの中に置く
- Ctrl+C / Ctrl+V はメニューの role(copy / paste)から `copy` / `paste` イベントとして届く。キーの keydown では拾えない
- 録画・ズームの枠の編集中は矢印キーで枠が動く(シークしない)。E2E でシークするときは Esc で編集を終えてから
