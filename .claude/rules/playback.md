---
paths:
  - "src/renderer/src/player.ts"
  - "src/renderer/src/thumbs.ts"
  - "src/renderer/src/media.ts"
---

# プレビューの再生とデコード(mediabunny)

- `CanvasSink.canvasesAtTimestamps` は、同じ時刻が続く間(保持中など)は何も返さない。返ってきたフレームを合図に時刻や描画を進めると、保持の間だけ再生ヘッドとズームの動きが止まる。再生はデコードと描画を分け、描画は requestAnimationFrame ごとに最新のフレームで行う
- 停止中のシークは `getCanvas` を要求ごとに投げない。デコードは前のキーフレームから始まるので要求が積まれ、表示が数秒遅れる。デコードは 1 本だけにし、その間の要求は最新 1 件にまとめる(`renderStill`)
