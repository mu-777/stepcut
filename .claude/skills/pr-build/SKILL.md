---
name: pr-build
description: 作業ブランチの PR を用意し、CI がビルドした Windows バイナリのリンクを PR 本文に貼る。「PR にビルドしたバイナリを付けて」「動作確認用の exe が欲しい」「このブランチの Windows ビルドが欲しい」等の依頼で使う。クラウドセッション(Linux コンテナ)から Windows バイナリを出す唯一の経路。
---

# PR にビルド済みバイナリを付ける

レビュワーが実機で触れる Windows バイナリを、作業ブランチの PR から辿れるようにする。
**書かれた順に、1 フェーズずつ実行する。**

## なぜこの手順なのか(先に読む)

- **GitHub の PR にバイナリを「添付」することはできない。** PR/Issue コメントへのファイル添付は
  Web UI のドラッグ&ドロップ専用で公開 API が無く、`.exe` は許可拡張子に入っていない。
  **だから「Actions run へのリンクを PR 本文に貼る」が唯一の形になる。**
- **クラウドセッションのコンテナでは Windows ビルドができない。** `npm run dist:win`(nsis/portable)は
  Linux では Wine が要り、入っていない。**ローカルで dist:win は試さない。**
  (パッケージ化の設定確認だけなら `npm run dist:dir` で Linux 版を作れる)
- **エージェントのトークンには Actions の write が無い。** `workflow_dispatch` は
  `403 Resource not accessible by integration` で落ちる。**dispatch を試さない。**
- したがって **`.github/workflows/build.yml` の `pull_request` トリガ**(base=main の PR を作る/更新すると
  windows-latest でネイティブビルドが走る)に乗る。

## Phase 0: 事前チェック

```bash
git status --porcelain     # → 空(未コミットの変更を残さない)
git log --oneline origin/main..HEAD
npm run check              # → 全部通る
```

落ちる/作業ツリーが汚れている → **停止してユーザーに報告**(勝手に直さない)。
push 済みでなければ `git push -u origin <branch>` する。

## Phase 1: PR を用意する

まず既に PR があるか確認する(ブランチの push で自動作成されていることがある)。

```
mcp__github__list_pull_requests(owner="mu-777", repo="stepcut", head="mu-777:<branch>", state="all")
```

- 無ければ `mcp__github__create_pull_request`(base=main)で作る
- あれば `mcp__github__update_pull_request` でタイトルと本文を今回の内容に更新する

本文は通常の PR と同じ(変更の概要・検証・手動確認が必要な項目)。末尾にプレースホルダの節を置く:

```markdown
## Windows ビルド(動作確認用)

このブランチの HEAD からビルドした Windows バイナリのリンクを、CI 完了後にここへ追記します。
```

## Phase 2: ビルドの完了を待つ

PR の作成/head への push で `build` ワークフローが自動で走る(dispatch はしない)。

```
mcp__github__actions_list(method="list_workflow_runs", owner="mu-777", repo="stepcut",
                          workflow_runs_filter={branch: "<branch>"})
```

`resource_id="build.yml"` は、build.yml が main にまだ無い間は 404 になる。`resource_id` を省いて全 run から
`name: build` のものを選ぶ。

- 目的の run は `head_sha` がブランチ HEAD と一致し、`event` が `pull_request` のもの
- `status` が `completed` になるまで待つ。`sleep` ではなく、`send_later` で数分後に自分へチェックインを入れる
- `conclusion` が `success` 以外なら **リンクは貼らず**、失敗ジョブのログ(`mcp__github__get_job_logs`)を
  読んで原因をユーザーに報告する。`check` ジョブ(lint 等)だけが落ちて `build-win` が成功している場合も、
  その旨を書いたうえでリンクを貼ってよい

## Phase 3: リンクを PR 本文に追記

```
mcp__github__actions_list(method="list_workflow_run_artifacts", owner="mu-777", repo="stepcut",
                          resource_id="<run_id>")
```

`stepcut-win` が取れる。`update_pull_request` でプレースホルダを差し替える。
**本文全体を書き直すことになるので、Phase 1 の本文を手元に持っておく**(body の部分更新はできない)。

```markdown
## Windows ビルド(動作確認用)

このブランチの HEAD(`<short sha>`)を CI でビルドしたもの:

- **[Actions run #<run_number>](<run html_url>)** → ページ下部の Artifacts から `stepcut-win` を取得
  - `StepCut Setup <version>.exe`(インストーラ)と `StepCut <version>.exe`(portable)

ダウンロードには GitHub へのログインが必要で、Artifact は既定で 90 日で失効します。
未署名のため、初回起動時に SmartScreen の警告が出ます(「詳細情報」→「実行」)。
```

## 注意点

- **Artifact の直リンクは配らない。** `download_workflow_run_artifact` が返す URL は数分で失効する。
  **run の `html_url` を貼る。**
- **PR に push するたびにビルドが走り直す。** `concurrency` で古い run は打ち切られるので、
  リンクは最後の push の後に貼る。貼った後に push したらリンクを更新する
