---
status: accepted
date: 2026-11-16
tags: [build, ci, release]
---

# リリースは main に入った版の変更を CI が拾い、タグと GitHub Release を作る(2026-11-16 決定)

版の付け方、リリースノート、タグ・GitHub Release を作る経路の決定。クラウドセッションのエージェントから始めてリリースまで進められることを前提にしている。手順はスキル `/release`(`.claude/skills/release/SKILL.md`)。

## 決定

- 版の正は `package.json` の `version`、リリースノートの正は `CHANGELOG.md`(Keep a Changelog)
- `/release` スキルが CHANGELOG を書き(ユーザーの承認を取る)、`npm version` で版を上げ、作業ブランチから PR を作って止まる。マージは人がする
- `.github/workflows/release.yml` が main への push で走り、`v<version>` のタグがなければ CHANGELOG のその版の節に中身があるかを確かめ(`scripts/changelog.mjs extract`)、タグを作り、`build.yml` を `workflow_call` で呼ぶ。タグがあれば何もしない
- `build.yml` は確認(`npm run check`)とビルドが両方通ったときだけ、別のジョブ(書き込み権限はそこだけ)で GitHub Release を作る。本文は CHANGELOG の節
- 通常のリリースとして出す(プレリリースにしない)。配布物の名前は版を含めず `StepCut-Setup.exe` / `StepCut-Portable.exe` に固定し、紹介ページは `releases/latest/download/<名前>` で最新版を直接指す
- PR・手動実行のビルドは version に短い SHA を足す(`0.1.0-g1a2b3c4`)。CI の作業場所だけの書き換えでコミットしない。semver ではこれは `0.1.0` より古い扱いなので、アプリの新しい版の確認([20261113-update-check.md](20261113-update-check.md))は、同じ番号の版が出たあとの PR ビルドで「新しい版がある」と出る(許容)
- 仕組みを入れた時点の版は 0.0.9 とし、タグ `v0.0.9` は人が手で打つ(Release は作らない)。最初のリリースは `/release` で 0.1.0 にする

## 理由

- エージェントが起こせる GitHub のイベントは「作業ブランチへの push」と「PR の作成・更新」だけ(下の不採用案)。そのため、合図をマージ後の main の中身(version の変化)に置いた。version を上げるのは `/release` だけなので、通常の PR のマージでは「タグがすでにある」で何も起きない
- `GITHUB_TOKEN` が作ったタグは workflow を起こさない([GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow))。タグの push でビルドを起動すると、タグだけできて Release が出ない。そのため直接呼ぶ
- CHANGELOG を確かめてからタグを作るので、本文が空のリリースは出ない。確認で落ちてもタグは打たれず、CHANGELOG を直した push で自動でやり直される
- 仕組みを入れた時点の 0.1.0 にタグがないと、マージ直後から main への push のたびに確認で落ちる。最初の版だけのための分岐をコードに入れず、0.0.9 の手動のタグで済ませた
- 0.x の版番号で開発中であることは伝わる。プレリリースにすると `releases/latest` の対象にならず、紹介ページから最新版を直接ダウンロードさせられない([REST API: Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release))
- 同じ作者の dayglassbar で同じ仕組みが動いている

## 不採用案と理由(逆戻りガード)

- **エージェントからタグを push / main に push** — 403 になる(dayglassbar で実測。どの条件で弾かれているかは未確定)
- **スキルから `workflow_dispatch` / `repository_dispatch`** — エージェントのトークンに Actions の write がなく 403
- **PR のラベルでリリースを判定** — ラベルは誰でも付けられ、スキルを通した保証にならない。`pull_request: closed` はどのブランチの workflow が動くかの確認も要る
- **release.yml に `paths: [package.json]`** — CHANGELOG の確認で落ちたあと、package.json 以外を直した push でやり直せなくなる。version が変わらない push は即終わるので、フィルタがなくても実害はない
- **CHANGELOG に版の見出しがあるかで判定(見出しがなければ何もしない)** — 最初のタグがなくても落ちないが、フックを通さず版を上げたときに何も起きず気づきにくい。最初のタグを手で打てば要らない
- **PAT / GitHub App のトークンでタグを push し、タグの push でビルド** — 秘密の発行・管理が増える。`workflow_call` で直接呼べば要らない
- **プレリリースにする** — 上の理由。商標・特許(T-03)の確認は公開前の確認としてスキルで人に示す
- **ビルドのジョブに書き込み権限を付けて、その中で Release を作る** — PR のビルドにも書き込み権限が付く

## 前提と再検討の条件

- エージェントが main とタグに push できるようになれば、手元から `git push --follow-tags` してもよい。ただしその場合もタグの push では build は起きないので、release.yml の経路は残す
- Mac 版を出す段階(M3)で build.yml に macos のジョブを足し、publish の対象に加える
- 自動更新(electron-updater)を入れるなら、配布物の名前の固定と blockmap の扱いを見直す
