# H.264/AAC の特許(調査メモ)

決定は [decisions/20261116-codec-patents.md](decisions/20261116-codec-patents.md)。ここは 2026-11 時点で調べた事実。法的な判断ではない。

## StepCut のどこに関わるか

| 処理 | 実装 | 配布しているのは |
|---|---|---|
| H.264 エンコード(優先) | GPU・OS のエンコーダー(WebCodecs `prefer-hardware`) | OS・GPU のメーカー |
| H.264 エンコード(代替) | Electron 内蔵の OpenH264(Chromium が自前でビルド) | StepCut |
| H.264 デコード | GPU のデコーダーか Electron 内蔵の FFmpeg | GPU / StepCut |
| AAC エンコード | Windows の Media Foundation(なければ Opus) | Microsoft |
| AAC デコード | Electron 内蔵の FFmpeg | StepCut |

- 特許の「実施」には生産・譲渡(配布)が含まれる。使わなくても同梱して配れば論点は残る([特許法 2 条 3 項](https://laws.e-gov.go.jp/law/334AC0000000121)、[35 U.S.C. §271](https://www.law.cornell.edu/uscode/text/35/271))
- Windows 11 のライセンス条項の H.264 の通知は「個人的かつ非商用」の利用に限る([Windows の使用条件](https://www.microsoft.com/en-us/useterms))

## 特許プール(Via LA)の条件

| 項目 | H.264 | AAC |
|---|---|---|
| エンコーダー・デコーダーの製品 | 年 10 万台まで無料(契約は要る)、超えると 1 台 $0.20 | 1 台目から $0.98。契約時に $15,000(小規模事業者は $1,000) |
| 作った動画の配布 | 無料のネット配信は特許料なし。12 分を超える動画を1本ずつ売るなら 2% か $0.02 の安いほう | 特許料なし |
| エンドユーザーの利用 | 個人・消費者としての利用(社内の業務を含む) | — |
| 米国の特許が切れる時期 | 最後が 2030 年 11 月ごろ | 基本は 2028 年、拡張は 2031 年 |

出典: [Via LA AVC の説明資料(2022 年版)](https://via-la.com/wp-content/uploads/2025/09/avcweb.pdf)、[Via LA AAC](https://www.via-la.com/licensing-programs/aac/)、[Wikipedia: AVC](https://en.wikipedia.org/wiki/Advanced_Video_Coding)、[Wikipedia: AAC](https://en.wikipedia.org/wiki/Advanced_Audio_Coding)

## Cisco の OpenH264 バイナリ

Cisco が特許料を負担するのは Cisco が配布したバイナリだけ。条件は、利用者の端末に別途ダウンロードさせる(他のソフトウェアに組み込んで配らない)、利用者が有効・無効を切り替えられる、所定の表示をする、など([BINARY_LICENSE](http://www.openh264.org/BINARY_LICENSE.txt))。ソースから自分でビルドしたもの(Chromium・Electron・BtbN の FFmpeg ビルドに入っているもの)は対象外。

## 他のツールの対応

| ツール | 対応 |
|---|---|
| Chrome | Google がライセンスを取得。Chromium・CEF の既定では H.264/AAC は無効([CEF #3559](https://github.com/chromiumembedded/cef/issues/3559)) |
| Firefox / Fedora | Cisco のバイナリを別途ダウンロード([Fedora](https://docs.fedoraproject.org/nn/quick-docs/openh264/)) |
| Electron のアプリ全般 | 既定で H.264/AAC 入りの FFmpeg を同梱。公式の見解なし |
| NW.js | 有効にするなら特許料が要ると明記([NW.js](https://nwjs.readthedocs.io/en/nw28/For%20Developers/Enable%20Proprietary%20Codecs/)) |
| FFmpeg / TeamDev | 特許への対応は利用者の責任と明記([FFmpeg](https://www.ffmpeg.org/legal.html)、[TeamDev](https://teamdev.com/dotnetbrowser/docs/guides/gs/media/)) |
| VLC | 欧州ではソフトウェア特許を認めないという立場([VideoLAN FAQ](https://wiki.videolan.org/Frequently_Asked_Questions)) |
| OpenScreen(MIT) | Electron + WebCodecs の GPU 優先。引き継ぎ版は LGPL 版 FFmpeg(OpenH264 入り)も同梱。特許への言及なし([getopenscreen/openscreen](https://github.com/getopenscreen/openscreen)) |
| Recordly(AGPL-3.0) | WebCodecs(GPU → Electron の OpenH264)と ffmpeg-static(GPU → x264、音声は FFmpeg の AAC)。特許への言及なし。AGPL なのは GPL の FFmpeg を同梱するため([webadderall/Recordly](https://github.com/webadderall/Recordly)) |
