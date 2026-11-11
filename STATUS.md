# STATUS

## 更新
2026-11-11

## ブランチ
main(ai-integration をマージ済み。CLI の frame・inspect と Claude Code のプラグイン)

## ゴール
AI(Claude Code)がプロジェクトを編集できるよう、CLI(frame・inspect)とスキルを用意して配る

## 現在地
- CLI: frame(AI-03。書き出しと同じ見た目 / --source で素材のフレーム)と inspect(AI-08。計算後の時間と読み上げの実長)。main の runCli → 非表示ウィンドウの cli-jobs.ts。決定 docs/decisions/20261111-ai-integration.md
- Claude Code のプラグイン(AI-09): リポジトリ直下 .claude-plugin/marketplace.json、plugins/screen-annotator/skills/edit-project(SKILL.md・find-cli.sh・仕様の写し。写しは src/plugin-files.test.ts で一致を確認)
- 確認: npm run check(単体 101)、CLI の frame・inspect・export・validate を実行して確認
- main までの到達点(c5fe9cc): 画像の素材・ステップごとの録画の枠・文言の統一ほか(詳細は git log)

## 次にやること
- ユーザーの確認: Claude Code でプラグインを入れてスキルを試す(/plugin marketplace add mu-777/screen-annotator → /plugin install screen-annotator@screen-annotator)
- ユーザーの実機確認(手順書 docs/manual-test.html。画像の項目を追加済み)。NG があれば直す
- M2 の残り: クラッシュ復旧(PRJ-06)、PRJ-03

## 課題・ブロッカー
- なし

## 未決事項
- ユーザーに聞いている: フェード以外の切り替え、アプリの設定に足す項目
- 仮決め: ズームの帯のダブルクリックは枠の追加のまま(ほかの帯はダブルクリックで始まりへシーク)。保持はクリックした所へシークのまま
- 仮決め: 画面に固定した図形の単位は出力の高さ 1080 基準の px。新しいオブジェクトは 3 秒出す。全体の設定のポインターの共通値は形と大きさだけ
- 仮決め: HW がなければ OpenH264・AAC がなければ Opus(T-02)。要件の未決 U-01, U-04。法務・規約 T-03, T-04, T-08
