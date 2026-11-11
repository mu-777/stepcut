# STATUS

## 更新
2026-11-11

## ブランチ
claude/vigilant-archimedes-osom10(main 24a5618 から。実装レビューの指摘を優先度順に直す)

## ゴール
レビューの指摘 #1〜#18(#17・#19 を除く)を直す: 読み上げの同時実行、書き出し・保存の失敗時の扱い、クラッシュ復旧(PRJ-06)、IPC の制限、メモリの解放、App.tsx のフック分割

## 現在地
- レビュー対応: 読み上げ(#1・#2・#5・#18)は済み。同時数の上限・同じ鍵の共有・VOICEVOX の起動 1 回・キャッシュの上限 500MB(tts/service.ts)。残りは作業中
- 読み上げエンジン(TTS-12〜14): main の tts/voicevox-engine.ts・azure-engine.ts。アプリの設定の「読み上げエンジン」(engine-settings.tsx)で同意して有効に。Azure の鍵は safeStorage で暗号化(settings.ts)。無効なエンジンは OS 標準で代読(service.ts の pick)。全体の設定の読み上げでエンジンを選ぶ。決定 docs/decisions/20261111-external-tts.md、C1 を読み替え
- AI 連携(main に入済み): CLI の frame・inspect と Claude Code のプラグイン(docs/decisions/20261111-ai-integration.md)
- 確認: npm run check、ui-smoke(176 項目。テスト用の VOICEVOX サーバーで接続まで)。実機の VOICEVOX・Azure は未確認
- main までの到達点(6384412): AI 連携・画像の素材・ステップごとの録画の枠ほか(詳細は git log)

## 次にやること
- レビュー対応の残り: #3・#4(書き出し・ファイルハンドル)→ #6(PRJ-06)→ #7〜#14 → #15・#16
- ユーザーの実機確認(手順書 docs/manual-test.html。特に VOICEVOX の起動・自動起動・声・書き出しと Azure の鍵の保存・声・書き出し)。NG があれば直す
- ユーザーの確認: Claude Code のプラグインを入れてスキルを試す(README の「Claude Code から使う」)
- M2 の残り: PRJ-03

## 課題・ブロッカー
- なし

## 未決事項
- 仮決め: 読み上げのキャッシュの上限 500MB、同時数は OS 2・VOICEVOX 1・Azure 3。移行の判定を version の番号にするのは配布前にやる(#17)
- ユーザーに聞いている: フェード以外の切り替え、アプリの設定に足す項目
- 仮決め: ズームの帯のダブルクリックは枠の追加のまま(ほかの帯はダブルクリックで始まりへシーク)。保持はクリックした所へシークのまま
- 仮決め: 画面に固定した図形の単位は出力の高さ 1080 基準の px。新しいオブジェクトは 3 秒出す。全体の設定のポインターの共通値は形と大きさだけ
- 仮決め: HW がなければ OpenH264・AAC がなければ Opus(T-02)。要件の未決 U-01, U-04。法務・規約 T-03, T-04, T-08
