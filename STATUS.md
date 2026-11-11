# STATUS

## 更新
2026-11-11

## ブランチ
ccr-fafc2071-v3o4vf(main 8ea59ec を取り込み済み。アプリの名前の変更。未マージ)

## ゴール
仮の名前(Screen Annotator)を StepCut に替える

## 現在地
- 名前を StepCut に替えた(docs/decisions/20261111-app-name.md): 表示名、CLI のコマンド名 stepcut、appId、format(stepcut.project)、拡張子(.stepcut.json)、Artifact 名(stepcut-win)、プラグイン(plugins/stepcut、/stepcut:edit-project)、環境変数 STEPCUT_CLI。旧名のプロジェクトファイルは開けない(読み替えなし)
- 画面: 書き出し中はボタンが「中止 n%」(use-export.ts)。問題の帯に「録画・画像が見つかりません」と「場所を選ぶ…」(App.tsx の relinkSource)。開けないプロジェクトはファイル名を添える(use-project-file.ts)。「録画・速度」の見出しはステップ全体の長さ(保持を含む。inspector.tsx の recordingSummary)。タイムラインの見出しの列を 84px に
- CLI: 知らないコマンドは画面を開かず終了コード 2(cli.ts の parseCli)。frame の --time がステップを超えたら warnings
- スキル: scripts/run-cli.sh 経由で CLI を呼ぶ。validate・frame は allowed-tools で確認なし。「録画から新しく作るとき」の節。決定は docs/decisions/20261111-ai-integration.md
- 確認: npm run check(単体 153)、ui-smoke(203 項目)、CLI と run-cli.sh を開発ビルドで実行。実機(Windows)と実際の Claude Code は未確認

## 次にやること
- GitHub のリポジトリ名(mu-777/screen-annotator)を変えるか決める。変えたら pr-build の repo=、README の /plugin marketplace add、plugin.json の homepage を直す。公開の前に商標(J-PlatPat)で StepCut を確認する
- ユーザーの実機確認(docs/manual-test.html の「保存・開く」「書き出し」「CLI」に足した項目)と、Claude Code にプラグインを入れて validate・frame で確認が出ないかを見る
- 確認が済んだら main へ PR(Windows バイナリは /pr-build)。前回からの実機確認(VOICEVOX・Azure・復旧)も残っている。M2 の残り: PRJ-03

## 課題・ブロッカー
- ui-smoke は全項目のあと、最後の app.close() で終わらないことがある(原因は未確認。項目はすべて通る)

## 未決事項
- 保留(ユーザーが検討中): 初回の案内・チュートリアル。エンドユーザー向けの説明は別の Web ページで作る(README は開発者向けのまま)
- 見送り: frame の複数時刻(--every)、録画の長さを返すコマンド。設定パネルの内部の表現(0〜1 など)と操作の見つけにくさ
- 仮決め: 拡張子 .stepcut.json、プラグイン名 stepcut。商標は未確認。以前から: 読み上げのキャッシュ 500MB ほか、移行の判定(#17)、CI で ui-smoke(#19)、T-02・U-01・U-04・T-03・T-04・T-08
