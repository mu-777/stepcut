---
status: accepted
date: 2026-11-11
tags: [ai, cli, distribution]
---

# AI(Claude Code)との連携はファイル + CLI + スキルで行い、MCP は後回しにする(2026-11-11 決定)

Claude Code・Codex などのコーディングエージェントに、手順書動画のプロジェクトを編集させる方法についての決定。何を作り、どう配り、エージェントがアプリの CLI をどう見つけるか。

## 決定

- 連携の土台は今のまま、JSON のプロジェクトファイル(AI-01)と CLI(AI-02〜08)。エージェントは JSON を直接書き、アプリは外部変更を検知して読み直す(AI-05・06)
- JSON だけでは分からないことを CLI で渡す
  - `frame`(AI-03): 指定した時刻の画を PNG にする。書き出しと同じ見た目(結果に画像の点を映像側の座標へ直す `geometry`)と、素材のフレームそのもの(`--source`。画像のピクセル = 映像側の座標)を選べる
  - `inspect`(AI-08): 計算後の時間。読み上げは実際に生成して長さを測る(JSON には書かれていない)
- 手引きは Claude Code のスキルだけを用意し、プラグインとして配る(AI-09)。このリポジトリのルートに `.claude-plugin/marketplace.json` を置いてマーケットプレイスにし、プラグインは `plugins/screen-annotator/`(スキル `edit-project`)。ユーザーは `/plugin marketplace add mu-777/screen-annotator` → `/plugin install screen-annotator@screen-annotator` で入れる。`plugin.json` に `version` は書かず、main のコミットがそのまま更新として届く
- スキルには仕様の写し(project-format.md・project.schema.json)を同梱する。プラグインはそのフォルダだけが配られ、docs を参照できないため。写しは単体テスト(`src/plugin-files.test.ts`)で docs と一致を確かめる
- CLI はアプリの実行ファイルそのもの。スキルに同梱した `find-cli.sh` が探す: 環境変数 `SCREEN_ANNOTATOR_CLI` → 前に覚えた場所(`${CLAUDE_PLUGIN_DATA}/cli-path`)→ インストーラの既定の場所(Windows: `%LOCALAPPDATA%\Programs\Screen Annotator\` と `Program Files`、Mac: `/Applications`)→ PATH。見つからなければスキルがユーザーに場所を聞き、`--save` で覚える。名前が Screen Annotator らしいファイルだけを `help` で確かめる(ほかのアプリを起動しない)
- CLI の結果は `--json --result <file>` でファイルから読ませる(Windows の GUI アプリは標準出力が届かないことがあり、標準エラーには Chromium のログが出る)

## 理由

- コーディングエージェントはファイルの読み書きとコマンドの実行が最も得意。MCP の道具で「ズームを足す」などを並べても、JSON を直接書くのと比べてできることは増えず、保守する仕組みと仕様が 2 通りになる
- エージェントが困るのは書き方より「画が見えない」「読み上げの長さが分からない」こと。frame・inspect がそこを埋める
- プラグインのマーケットプレイスは Claude Code がスキルを配る標準の方法で、GitHub のリポジトリを足すだけで入り、更新も届く。追加のサーバー・費用が要らない(C1)
- インストール先はインストーラで変えられる(`oneClick: false`)ので、既定の場所を探しつつ、最後は人に聞くのが確実

## 不採用案と理由(逆戻りガード)

- **MCP サーバーを作る(今は)** — 上の理由。開いているアプリの状態(再生位置・選択・プレビューの画)を渡したくなったとき、または Claude Desktop などシェルのない相手から使わせたいときに、CLI と同じ中身を呼ぶ薄い層として見直す
- **Codex 向けの手引き(AGENTS.md の雛形)も配る** — ユーザーの指定で Claude Code のスキルだけにした
- **スキルを `~/.claude/skills/` へコピーしてもらう** — 手作業で、更新が届かない
- **スキルから docs を参照する(写しを置かない)** — インストールされたプラグインからリポジトリの docs は見えない
- **インストール時に CLI を PATH に登録する** — インストーラの変更と OS ごとの対応が要り、ポータブル版では効かない。探索 + 聞いて覚える方が単純

## 前提と再検討の条件

- CLI の引数・結果の形はスキルが頼りにしている。変えるときは SKILL.md も同じ作業で直す
- Mac 版の配布の形が決まったら、`find-cli.sh` の既定の場所を確かめる
- 公開範囲を広げる(Anthropic のディレクトリへの申請など)ときは、このリポジトリ全体を clone させている点(マーケットプレイスの追加はリポジトリの clone)を見直す
