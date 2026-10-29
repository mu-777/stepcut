# STATUS

## 更新
2026-10-29

## ブランチ
ccr-47d39648-xbk8lb

## ゴール
手順書動画エディタ(仮称)の M1(MVP)を Windows で使える状態にする。範囲は docs/decisions/20261029-mvp-scope.md

## 現在地
- Electron + TypeScript で M1 を実装済み。Linux コンテナで GUI 操作・CLI(validate / export)・mp4/SRT 書き出しを確認済み
- 構成: src/core(形・時刻・レイアウト・検証。単体テストあり)、src/main(ファイル・読み上げ・CLI)、src/renderer(合成・再生・書き出し・UI)
- Windows 版は PR ごとに GitHub Actions でビルド(.github/workflows/build.yml、手順は /pr-build)。実機は未確認(読み上げ、HW エンコーダー、AAC、メニュー、CLI の標準出力)

## 次にやること
- PR の Windows ビルドで実機確認: 録画追加→分割→テロップ・読み上げ・ズーム→書き出し、CLI の export
- リリース(タグ→GitHub Releases)の仕組み。dayglassbar の release.yml 方式が参考
- M2: ポインター・蛍光ペン(直線)、フレーム画像の書き出し(AI-03)、クラッシュ復旧(PRJ-06)、PRJ-03

## 課題・ブロッカー
- Windows の GUI アプリは CLI の標準出力がコンソールに出ない可能性がある。`--result <file>` で回避できるが実機で要確認

## 未決事項
- 仮決め: 早送りステップでは元の音声を鳴らさない(U-09)、HW がなければ OpenH264・AAC がなければ Opus(T-02)、ズームの遷移 0.4 秒(U-05)、音量は共通+ステップ(U-06)
- 要件の未決 U-01〜U-05, U-08(docs/requirements.md 11.1)
- 法務・規約: H.264/AAC 特許(T-03)、OS 標準音声の商用利用(T-04)
- 要件定義書 12 章の出典の差し替え(T-08)
