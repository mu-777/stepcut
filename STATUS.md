# STATUS

## 更新
2026-10-29

## ブランチ
ccr-47d39648-xbk8lb

## ゴール
手順書動画エディタ(仮称)の MVP を作る。要件は docs/requirements.md

## 現在地
- リポジトリ初期化済み(AGENTS.md・README・要件定義書・決定記録)
- T-01 / T-05 / T-06 の案を作成(status: proposed、承認待ち): UI 基盤は Electron(decisions/20261029-ui-platform.md)、MVP は M1〜M3 の 3 段階(decisions/20261029-mvp-scope.md)、JSON の形は docs/project-format.md
- 実装は未着手

## 次にやること
- 承認されたら 3 件の決定記録を status: accepted にする
- 雛形を作る: Electron + TypeScript + Vite、lint/format は Biome、テストは Vitest(いずれも MIT 系)。AGENTS.md の「完了の定義」を埋める
- M1 の最初の実装: project-format.md から JSON Schema と検証(AI-04)、出力時刻 → ソース時刻の対応(4 章)を単体テスト付きで作る

## 課題・ブロッカー
- 3 件の案の承認待ち

## 未決事項
- 要件の未決 U-01〜U-05, U-08(docs/requirements.md 11.1)。U-06 は仮決め(両方で持つ)、U-07 は案あり
- ズームの遷移時間の既定値は仮に 0.4 秒(U-05)
- 法務・規約: H.264/AAC 特許(T-03。Electron 内蔵 OpenH264 を使うかもこれ次第)、OS 標準音声の商用利用(T-04)
- 要件定義書 12 章の出典の差し替え(T-08)
- LICENSE ファイルが未作成
