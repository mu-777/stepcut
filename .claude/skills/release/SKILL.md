---
name: release
description: 新しい版をリリースする(CHANGELOG を書く → 版を上げる → PR を作る → マージ後に Release を確認する)。「リリースして」「v0.2.0 を出して」「新しい版を出したい」等の依頼で使う。
---

# リリース

**書かれた順に、1 フェーズずつ実行する。各フェーズの確認を満たさない限り次へ進まない。**

## 仕組み(先に読む)

- **版の正は `package.json` の `version`**。**リリースノートの正は `CHANGELOG.md`**(Keep a Changelog)
- **リリースの合図は「main に載った version の変化」**。`.github/workflows/release.yml` が main への push で走り、
  `v<version>` のタグがまだなければ CHANGELOG のその版の節に中身があるかを確かめ、タグを作り、
  `build.yml` を呼んで Windows 版のビルドと GitHub Release の公開まで行う。タグがあれば何もしない
- `npm version <level>` は version フック(`scripts/changelog.mjs stamp`)で `## [Unreleased]` を
  `## [x.y.z] - 日付` に置き換えてから版のコミットを作る
- **エージェントは main にもタグにも push できず、`workflow_dispatch` も叩けない**(403)。作業ブランチへの
  push と PR の作成だけで完結するようにしてある。**タグは push しない。打つのは CI**
- 経緯と不採用案: [docs/decisions/20261116-release-flow.md](../../../docs/decisions/20261116-release-flow.md)

## Phase 0: 事前チェック

```bash
git branch --show-current                 # → main ではない作業ブランチ
git status --porcelain                    # → 空
git fetch origin main --tags
git log --oneline HEAD..origin/main       # → 空(main の最新を取り込み済み)
git tag --list 'v*' --sort=-v:refname | head -3   # → 前のタグ
npm run check                             # → 通る
```

1 つでも満たさなければ**停止してユーザーに報告する**(勝手に直さない)。main にいるなら作業ブランチを切ってよいか聞く。

続けて、公開前に人の判断が要る事項がまだ残っているかを見て、残っていればユーザーに示し、進めてよいか確認する。

- docs/requirements.md の未決事項のうち配布に関わるもの
- STATUS.md の「未決事項」のうち公開前とされているもの
- 本番の依存(`dependencies`)や Electron の版を変えたなら、THIRD_PARTY_NOTICES.md がそれに合っているか

## Phase 1: 前のタグ以降の変更を集める

```bash
LAST=$(git describe --tags --abbrev=0)
git log --oneline "$LAST"..HEAD
git diff --stat "$LAST"..HEAD
```

**コミットメッセージを鵜呑みにせず、diff で実際に何が変わったかを確かめる。**

## Phase 2: CHANGELOG.md の [Unreleased] を書く

`## [Unreleased]` の直下に書く。

- **書く**: 利用者に見える変化。機能の追加・変更、見た目・挙動の変化、バグ修正、既定値の変更、
  プロジェクトファイルの形の変化(旧版で開けなくなるなど)
- **書かない**: 内部の整理、テスト、CI、docs のみの変更、挙動が変わらない依存の更新。それしかなければ「内部の改善のみ」と 1 行
- 読者は利用者。画面に見える言葉で書き、関数名・ファイルパスは書かない
  - ❌ `exporter.ts の音声の代替を追加` / ⭕ `AAC が使えない環境でも音声付きで書き出せるようにした`
- 1 変更 1 行の箇条書き、常体。分類はこの順で、要るものだけ見出しを立てる:
  `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`
- `[Unreleased]` の上の案内コメント、過去の版の節、末尾のリンク定義は触らない(リンクはフックが直す)

**草稿の全文をユーザーに見せて承認を得る。承認前にコミットしない**(外部に公開される文章のため)。
承認後: `git add CHANGELOG.md && git commit -m "CHANGELOG: v<次の版> の変更を記入"`

## Phase 3: 版を上げる

レベルは引数で指定がなければ、提案してユーザーに確認する。

- `patch`: バグ修正・文言・見た目の微調整のみ
- `minor`: 機能の追加、利用者に見える挙動の変更
- `major`: 互換性が壊れる変更(1.0 以降。0.x の間は互換性が壊れても `minor`)

```bash
npm version <patch|minor|major> -m "release: v%s"
git tag -d v<新しい版>        # npm が作ったローカルのタグは捨てる(打つのは CI)
```

確認(全部見る):

```bash
git show --stat HEAD                          # package.json・package-lock.json・CHANGELOG.md が入っている
git tag --list 'v<新しい版>'                   # → 空(消し忘れがない)
node scripts/changelog.mjs extract <新しい版>   # CI と同じ確認。Phase 2 の内容が出る
```

`changelog: ... の節がすでにある` で止まったら異常。停止して報告する。

## Phase 4: PR を作る

```bash
git push -u origin <作業ブランチ>
```

GitHub MCP の `create_pull_request`(既に PR があれば `update_pull_request` で本文を差し替える)。

- base: `main`、タイトル: `release: v<新しい版>`
- 本文: ①**マージすると v<新しい版> のタグと GitHub Release が自動で公開される**こと ②CHANGELOG のその版の節 ③リリース以外の変更が含まれていればその一覧

**ここで停止し、マージはユーザーに任せる。** PR のビルド(Artifacts)で実機確認したい場合は `/pr-build` の手順でリンクを貼る。

## Phase 5: マージ後の確認

release(タグ)→ build(確認・ビルド・publish)の順に走る(十数分)。自分で確認まで済ませる。

```
mcp__github__actions_list(method="list_workflow_runs", owner="mu-777", repo="stepcut", resource_id="release.yml")
mcp__github__get_release_by_tag(owner="mu-777", repo="stepcut", tag="v<新しい版>")
```

確認すること:

1. release の run が緑(tag ジョブが赤ならタグは打たれていない)
2. Release の本文が CHANGELOG の節と同じ(案内コメント・リンク定義が混ざっていない)
3. `StepCut-Setup.exe` と `StepCut-Portable.exe` が添付されている
4. `https://github.com/mu-777/stepcut/releases/latest/download/StepCut-Setup.exe` が新しい版を指す

## 失敗したとき

| 症状 | 対応 |
|---|---|
| `npm version` が「Git working directory not clean」 | Phase 0 に戻る |
| main やタグへの push が 403 | 仕様。Phase 4 の PR の経路に戻す |
| tag ジョブが CHANGELOG の確認で赤 | その版の節がないか空。CHANGELOG を直して PR で main に入れ直す。タグは打たれていないので、直した push で自動でやり直される |
| タグはできたが build が赤 | ログを見る。直したら**同じタグを打ち直さず**、`patch` でもう一段上げて出し直す(壊れたタグの扱いはユーザーに聞く) |
| 間違った内容で公開した | タグ・Release を勝手に消さない。状況を報告して指示を待つ |
