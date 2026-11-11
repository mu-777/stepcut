#!/usr/bin/env bash
# Screen Annotator の CLI(アプリの実行ファイル)を探し、見つかればパスを 1 行で出す(終了コード 0)。
# 見つからなければ何も出さず終了コード 1(ユーザーに場所を聞き、--save で覚えさせる)。
#
#   find-cli.sh <覚えておく場所>                 探す
#   find-cli.sh <覚えておく場所> --save <パス>    ユーザーに聞いたパスを確かめて覚える(次からはそれを使う)
#
# 探す順: 環境変数 SCREEN_ANNOTATOR_CLI → 覚えたパス → インストーラの既定の場所 → PATH の screen-annotator
set -u

data="${1:-${HOME}/.screen-annotator}"
store="${data}/cli-path"

# Windows のパス(C:\...)を Git Bash で使える形にする
to_unix() {
  if command -v cygpath >/dev/null 2>&1 && [ -n "$1" ]; then cygpath -u "$1"; else printf '%s\n' "$1"; fi
}

# 名前が Screen Annotator らしく、help に答えるなら Screen Annotator とみなす
# (ほかのアプリを起動しないよう名前で絞り、固まっても待ち続けないよう時間を区切る)
works() {
  [ -n "$1" ] && [ -f "$1" ] || return 1
  case "$(basename "$1" | tr '[:upper:]' '[:lower:]')" in
    "screen annotator"* | screen-annotator*) ;;
    *) return 1 ;;
  esac
  if command -v timeout >/dev/null 2>&1; then
    timeout 60 "$1" help 2>/dev/null | grep -q "screen-annotator validate"
  else
    "$1" help 2>/dev/null | grep -q "screen-annotator validate"
  fi
}

remember() {
  mkdir -p "$data" && printf '%s\n' "$1" >"$store"
}

if [ "${2:-}" = "--save" ]; then
  p="$(to_unix "${3:-}")"
  # フォルダを渡されたら中の実行ファイルを探す
  if [ -d "$p" ]; then
    for name in "Screen Annotator.exe" "Screen Annotator" "Contents/MacOS/Screen Annotator"; do
      [ -f "$p/$name" ] && p="$p/$name" && break
    done
  fi
  if works "$p"; then
    remember "$p"
    printf '%s\n' "$p"
    exit 0
  fi
  echo "Screen Annotator の実行ファイルではありません: ${3:-}" >&2
  exit 1
fi

candidates=()
[ -n "${SCREEN_ANNOTATOR_CLI:-}" ] && candidates+=("$(to_unix "$SCREEN_ANNOTATOR_CLI")")
[ -f "$store" ] && candidates+=("$(head -n 1 "$store")")
# Windows: インストーラの既定(自分だけ = LOCALAPPDATA\Programs、すべてのユーザー = Program Files)
for base in "${LOCALAPPDATA:-}" "${PROGRAMFILES:-}" "${PROGRAMW6432:-}"; do
  [ -z "$base" ] && continue
  base="$(to_unix "$base")"
  [ "$base" = "$(to_unix "${LOCALAPPDATA:-}")" ] && base="$base/Programs"
  for dir in "screen-annotator" "Screen Annotator"; do
    candidates+=("$base/$dir/Screen Annotator.exe")
  done
done
# macOS
candidates+=("/Applications/Screen Annotator.app/Contents/MacOS/Screen Annotator")
candidates+=("${HOME}/Applications/Screen Annotator.app/Contents/MacOS/Screen Annotator")
# PATH
if command -v screen-annotator >/dev/null 2>&1; then candidates+=("$(command -v screen-annotator)"); fi

for c in "${candidates[@]}"; do
  if works "$c"; then
    [ "$c" != "$(head -n 1 "$store" 2>/dev/null)" ] && remember "$c"
    printf '%s\n' "$c"
    exit 0
  fi
done
exit 1
