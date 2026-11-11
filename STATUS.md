# STATUS

## 更新
2026-11-11

## ブランチ
claude/vigilant-archimedes-osom10(main 24a5618 から。実装レビューの指摘への対応。未マージ・PR なし)

## ゴール
レビューの指摘 #1〜#18(#17・#19 を除く)を直す

## 現在地
- 指摘への対応は実装済み。読み上げ(tts/service.ts): エンジンごとの同時数・同じ鍵の共有・VOICEVOX の起動 1 回と失敗の扱い・キャッシュの上限
- 書き出しは .part に書いて成功時に置き換え(main/output-files.ts)。素材のファイルは 10 秒使わなければ閉じる(main/file-readers.ts)
- IPC はパスの許可リスト(main/access.ts、決定 docs/decisions/20261111-ipc-restrictions.md)。ページの移動を禁止
- クラッシュ復旧(PRJ-06): main/recovery.ts と use-project-file.ts。閉じるときに「保存して閉じる」
- 使わない素材・読み上げ・サムネイルを解放。60 秒を超えるステップの音声は区切って書き出す。App.tsx から use-project-file.ts・use-export.ts・use-clipboard.ts を分けた(挙動は同じ)
- 確認: npm run check(単体 152)、ui-smoke(193 項目)、CLI の export・frame・inspect。実機(Windows)は未確認

## 次にやること
- ユーザーの実機確認(docs/manual-test.html): 今回の分は、閉じるときの確認・強制終了からの復元・録画のドロップ・書き出しの上書き・書き出し後に録画を消せるか。前回からの分は VOICEVOX・Azure
- 確認が済んだら main へ PR(Windows バイナリは /pr-build)。M2 の残り: PRJ-03

## 課題・ブロッカー
- なし

## 未決事項
- 仮決め(今回): 読み上げのキャッシュの上限 500MB、同時数は OS 2・VOICEVOX 1・Azure 3、復旧の保存は変更の 5 秒後、sandbox は false のまま
- 配布前にやる: 移行の判定を version の番号にする(#17)、CI で ui-smoke を回す(#19)。ユーザーに聞いている: フェード以外の切り替え、アプリの設定に足す項目
- 仮決め(以前から): ズームの帯のダブルクリック、画面に固定した図形の単位、HW/AAC の代替(T-02)。要件の未決 U-01, U-04。法務 T-03, T-04, T-08
