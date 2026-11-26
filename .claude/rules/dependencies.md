---
paths:
  - "package.json"
  - "package-lock.json"
---

# 依存とライセンス表記

- `dependencies`(配布物に入る)を足す・外す・版を上げたら、THIRD_PARTY_NOTICES.md の表(版・ライセンス・著作権表示・入手先)も同じ作業で直す。推移的な依存も対象。一覧は `npm ls --omit=dev --all --parseable` と各パッケージの package.json・LICENSE で取る
- Electron の版を上げたら THIRD_PARTY_NOTICES.md の Electron の版と、FFmpeg の節(Chromium の版と `ffmpeg_revision`)も直す。Chromium の版は `https://raw.githubusercontent.com/electron/electron/v<版>/DEPS` の `chromium_version`、FFmpeg の版は `https://chromium.googlesource.com/chromium/src/+/refs/tags/<Chromium の版>/DEPS?format=TEXT`(base64)の `ffmpeg_revision`。Electron・Chromium のライセンスファイル(LICENSE.electron.txt・LICENSES.chromium.html)は electron-builder が exe の隣に置くので手当ては要らない
- THIRD_PARTY_NOTICES.md と LICENSE は package.json の `build.extraFiles` で exe の隣に置いている。名前を変えたらそこも直す
- MPL-2.0(mediabunny)は改変しない前提。改変するなら改変したソースの公開が要る
