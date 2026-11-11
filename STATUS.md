# STATUS

## 更新
2026-11-11

## ブランチ
ccr-f1009c33-k0274q(main b9f3a3e から。ユーザー観点・Claude Code 観点のレビューの残件への対応。未マージ・PR なし)

## ゴール
レビューの残件を直す: 書き出しの中止、見つからない録画の選び直し、開けないファイルの知らせ、保持で伸びた長さの表示、レーン名の折り返し、CLI の打ち間違い・範囲外の時刻、スキルの新規作成の手順と確認の省略

## 現在地
- 画面: 書き出し中はボタンが「中止 n%」(use-export.ts)。問題の帯に「録画・画像が見つかりません」と「場所を選ぶ…」(App.tsx の relinkSource)。開けないプロジェクトはファイル名を添える(use-project-file.ts)。「録画・速度」の見出しは保持を含む長さ(inspector.tsx の recordingSummary)。タイムラインの見出しの列を 84px に
- CLI: 知らないコマンドは画面を開かず終了コード 2(cli.ts の parseCli)。frame の --time がステップを超えたら warnings
- スキル: scripts/run-cli.sh 経由で CLI を呼ぶ。validate・frame は allowed-tools で確認なし。「録画から新しく作るとき」の節。決定は docs/decisions/20261111-ai-integration.md
- 確認: npm run check(単体 153)、ui-smoke(204 項目)、CLI と run-cli.sh を開発ビルドで実行。実機(Windows)と実際の Claude Code は未確認

## 次にやること
- ユーザーの実機確認(docs/manual-test.html の「保存・開く」「書き出し」「CLI」に足した項目)と、Claude Code にプラグインを入れて validate・frame で確認が出ないかを見る
- 確認が済んだら main へ PR(Windows バイナリは /pr-build)。前回からの実機確認(VOICEVOX・Azure・復旧)も残っている
- M2 の残り: PRJ-03

## 課題・ブロッカー
- ui-smoke は全項目のあと、最後の app.close() で終わらないことがある(原因は未確認。項目はすべて通る)

## 未決事項
- 保留(ユーザーが検討中): 初回の案内・チュートリアル。エンドユーザー向けの説明は別の Web ページで作る(README は開発者向けのまま)
- 見送り: frame の複数時刻(--every)、録画の長さを返すコマンド。設定パネルの内部の表現(0〜1 など)と操作の見つけにくさ
- 仮決め(以前から): 読み上げのキャッシュ 500MB ほか、移行の判定(#17)、CI で ui-smoke(#19)、T-02・U-01・U-04・T-03・T-04・T-08
