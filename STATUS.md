# STATUS

## 更新
2026-10-29

## ブランチ
ccr-01bb69ef-7ku6xc

## ゴール
手順書動画エディタ(仮称)の MVP を作る。要件は docs/requirements.md

## 現在地
- リポジトリ初期化済み(AGENTS.md・README・要件定義書・決定記録 5 件)
- 実装は未着手。技術選定も未着手

## 次にやること
- 技術選定: Electron か Tauri か(要件 T-01)。Windows / Mac での WebCodecs(H.264/AAC エンコード)対応を一次情報で確認する
- プロジェクトファイル(JSON)の構造を設計する(T-05)
- MVP の範囲を決める(T-06)

## 課題・ブロッカー
なし

## 未決事項
- 要件の未決 U-01〜U-08(BGM、背景画像、VFR ソースの扱いなど。docs/requirements.md 11.1)
- 法務・規約の確認: H.264/AAC 特許(T-03)、OS 標準音声の商用利用(T-04)
- 要件定義書 12 章の出典の差し替え(T-08)
- LICENSE ファイルが未作成
