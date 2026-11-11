# STATUS

## 更新
2026-11-11

## ブランチ
ccr-fafc2071-v3o4vf(main から。アプリの名前の変更)

## ゴール
仮の名前(Screen Annotator)を StepCut に替える

## 現在地
- 名前を StepCut に替えた(決定記録 docs/decisions/20261111-app-name.md)。副題は「Turn recordings into step-by-step videos, driven by captions.」
- 替えた所: 表示名・ウィンドウのタイトル、CLI のコマンド名(stepcut)、appId(com.mu777.stepcut)、プロジェクトファイルの format(stepcut.project)と拡張子(.stepcut.json)、CI の Artifact 名(stepcut-win)、README・docs
- 旧名のプロジェクトファイル(format が screen-annotator.project)は開けない。読み替えの処理は置いていない
- ui-smoke のキー操作の一覧のボタンを探す所を、大文字小文字を区別しないようにした(英語の表示は「Keyboard Shortcuts」で、main でも落ちていた)
- npm run check(単体 87)、ui-smoke(162 項目)、CLI の validate・export は通過

## 次にやること
- GitHub のリポジトリ名(mu-777/screen-annotator)を変えるかを決める。変えたら .claude/skills/pr-build/SKILL.md の repo= を直す
- 公開の前に商標(J-PlatPat / USPTO)で「StepCut」「ステップカット」を確認する
- ユーザーの実機確認(手順書 docs/manual-test.html)。M2 の残り: フレーム画像の書き出し(AI-03)、クラッシュ復旧(PRJ-06)、PRJ-03

## 課題・ブロッカー
- なし

## 未決事項
- ユーザーに聞いている: フェード以外の切り替え、アプリの設定に足す項目
- 仮決め: 拡張子 .stepcut.json(旧 .sanno.json から名前に合わせて替えた)。商標は未確認のまま名前を決めた
- 仮決め: ズームの帯のダブルクリックは枠の追加のまま。画面に固定した図形の単位は出力の高さ 1080 基準の px。HW がなければ OpenH264・AAC がなければ Opus(T-02)。要件の未決 U-01, U-04。法務・規約 T-03, T-04, T-08
