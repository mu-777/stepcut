#!/usr/bin/env bash
# StepCut の CLI を探して実行し、結果の JSON を標準出力に出す。終了コードは CLI のもの
# (0 = 成功、1 = 失敗、2 = 引数の誤り)。CLI が見つからなければ 3。
#
#   run-cli.sh <validate|frame|inspect|export> <覚えておく場所> <プロジェクト> [オプション...]
#
# --json と --result は付けなくてよい(ここで付ける)。Windows の GUI アプリは標準出力が届かないことがあり、
# 標準エラーには Chromium のログが出るので、結果は --result のファイルから読んで出す。
# コマンドを先頭に置くのは、スキルの allowed-tools でコマンドごとに許可できるようにするため。
set -u

cmd="${1:-}"
data="${2:-}"
if [ -z "$cmd" ] || [ -z "$data" ]; then
  echo '{"ok":false,"error":"usage: run-cli.sh <validate|frame|inspect|export> <data-dir> <project> [options]"}'
  exit 2
fi
shift 2

here="$(cd "$(dirname "$0")" && pwd)"
if ! cli="$(bash "$here/find-cli.sh" "$data")"; then
  echo '{"ok":false,"error":"StepCut の実行ファイルが見つかりません。ユーザーに場所を聞き、find-cli.sh --save で覚えさせる / CLI not found"}'
  exit 3
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"$cli" "$cmd" "$@" --json --result "$tmp/result.json" >/dev/null 2>"$tmp/stderr.txt"
code=$?
if [ -s "$tmp/result.json" ]; then
  cat "$tmp/result.json"
  echo
else
  # 結果が書かれなかった(引数の誤りなど)。Chromium のログ([pid:...] で始まる行)を除いた標準エラーを出す
  grep -v '^\[' "$tmp/stderr.txt" >&2
  echo "{\"ok\":false,\"error\":\"結果がありません(終了コード ${code})。上の出力を見る / No result\"}"
fi
exit "$code"
