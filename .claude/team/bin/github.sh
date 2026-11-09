#!/bin/bash
# GitHub につなぐ操作を、決めた形だけ実行する
#
# managed settings のサンドボックスは、Bash から GitHub への通信を止めている（sandbox.network.deniedDomains）。
# インストール先（/opt/claude-code-team/bin、root の持ち物）のこのスクリプトだけを sandbox.excludedCommands に入れて外で動かし、
# GitHub に届く道をここに絞る。外で動くため、引数は決めた形だけを受け付け、それ以外は断る。
#
# 使い方（リポジトリのフォルダで実行する）:
#   github.sh [--skip NAME]... push [-u|--set-upstream] [--dry-run] <remote> <branch | HEAD | src:dst>...
#   github.sh fetch [-p|--prune] [-q|--quiet] <remote> [<ref>...]
#   github.sh pr view|list|diff|checks [args...]      （読むだけ。--web は除く）
#   github.sh run view|list [args...]                  （読むだけ。--web は除く）
#   github.sh api repos/<path> [--paginate] [--jq|-q <expr>] （GET だけ）
#   github.sh [--skip NAME]... pr create --draft [--base|-B B] [--head|-H H] [--title|-t T] [--body|-b T | --body-file|-F F] [--label|-l L]
#   github.sh [--skip NAME]... pr edit <番号> [--title T] [--body T | --body-file F] [--add-label L] [--remove-label L] [--base B]
#   github.sh [--skip NAME]... pr comment <番号> (--body T | --body-file F)
#   github.sh [--skip NAME]... pr close <番号> [--comment|-c T]
#   github.sh issue view <番号> [args...]              （読むだけ。--web は除く）
#   github.sh issue comment <番号> (--body T | --body-file F)
#   github.sh issue create [--title T] [--body T | --body-file F] [--label L]
#
# リダイレクト（> file）・cd・$( ) を含む呼び出しは、サンドボックスの中で動いて GitHub に届かない
# （sandbox.excludedCommands の決まり）。本文は --body-file で渡し、フォルダは前の呼び出しで移っておく
#
# - 断るもの: force push・削除・タグ・Draft でない PR の作成・gh pr ready（Ready はユーザーが変える）・gh pr merge・
#   書き込む gh api・ブラウザを開く --web など、上にない操作とオプション
# - 送り先:
#   - push・PR・Issue への書き込みは、<prefix>/etc/github-repos に書いた GitHub のリポジトリだけ。PR・Issue は origin のリポジトリを --repo に付ける
#   - push するブランチは fix/*・feature/*・test/* だけ（main・release/* へは PR で入れる）
#   - fetch は GitHub のリポジトリだけ
# - サンドボックスの中で書き換えられたリポジトリで、外のコマンドを動かさないように（lib/git-safety.sh）:
#   - リポジトリの git の設定は、決めた項目だけを認める
#   - git のフック・fsmonitor・サブモジュールの中・ext:: のリモートを使わない
# - 書き込む操作（push・pr create / edit / comment / close・issue comment / create）の前に、同じフォルダ（インストール先）の
#   確認を、同じ操作の git / gh のコマンドとして流し、止められたら止める（exit 2、または JSON の deny）
#   - cr-gate-push.sh（手元の CodeRabbit レビュー）・tdd-push-gate.sh（TDD の順番）・cr-limit-gate.sh（CodeRabbit の枠）
#   - リポジトリの設定（.claude/settings.json）の hook は流さない。作業ツリーのファイルは、サンドボックスの中から書き換えられるため
# - --skip NAME（SKIP_CR_LOOP・SKIP_TDD_CHECK・SKIP_CR_LIMIT）は、確認に NAME=1 を付けたコマンドとして渡す。
#   ユーザーの了承を得たときだけ使う
# - --body-file は、リポジトリの中か、Claude Code のスクラッチパッド（/private/tmp/claude-<uid>/*/*/scratchpad/）の中のファイルだけ。
#   開いてからリンクの数（ハードリンク）を確かめ、中身を読んで --body で渡す（確かめた後に差し替えられないように）
#
# テスト: bash .claude/team/tests/github.test.sh

here=$(cd "$(dirname "$0")" && pwd -P)
# shellcheck source=lib/git-safety.sh
. "$here/lib/git-safety.sh"

die() { printf 'github.sh: %s\n' "$1" >&2; exit 1; }

skips=()
while [ "${1-}" = "--skip" ]; do
  case "${2-}" in
    SKIP_CR_LOOP | SKIP_TDD_CHECK | SKIP_CR_LIMIT) skips+=("$2=1") ;;
    *) die "--skip に使えない名前: ${2-}" ;;
  esac
  shift 2
done

top=$(git rev-parse --show-toplevel 2>/dev/null) || top=""
[ -z "$top" ] || check_git_config

# 送ってよいリポジトリか（<prefix>/etc/github-repos に書いたもの）
allowed_repo() {
  local list="$here/../etc/github-repos" line
  [ -f "$list" ] || die "送ってよいリポジトリの一覧がありません: $list"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%%#*}
    line=${line//[[:space:]]/}
    [ -n "$line" ] || continue
    [ "$line" = "$1" ] && return 0
  done <"$list"
  return 1
}

# check_remote <remote> <push|fetch>: リモートの URL が GitHub か（push なら pushurl も見て、一覧のリポジトリか）
# 最後に見たリポジトリを slug に入れる
slug=""
check_remote() {
  local u urls
  git remote | grep -qxF -- "$1" || die "登録していないリモートです: $1"
  urls=$(git config --get-all "remote.$1.url")
  [ "$2" != push ] || urls="$urls"$'\n'$(git config --get-all "remote.$1.pushurl")
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    slug=$(github_slug "$u") || die "GitHub 以外のリモートです: $u"
    [ "$2" != push ] || allowed_repo "$slug" || die "送ってよいリポジトリの一覧にありません: $slug"
  done <<<"$urls"
  [ -n "$slug" ] || die "リモートの URL がありません: $1"
}

# 送ってよいブランチか（fix/*・feature/*・test/*）
check_branch() {
  case "$1" in
    fix/?* | feature/?* | test/?*) ;;
    *) die "送ってよいブランチは fix/*・feature/*・test/* だけです（main・release/* へは PR で入れる）: $1" ;;
  esac
}

# 確認に渡すコマンドを作る（--skip の NAME=1 を先頭に付ける）
synth() {
  local s="" a
  for a in "${skips[@]}"; do s="$s$a "; done
  for a in "$@"; do s="$s$(printf '%q' "$a") "; done
  printf '%s' "${s% }"
}

# run_check <確認のスクリプト> <入力>: 止めたら終わる（exit 2、または JSON の deny）
run_check() {
  local script=$1 input=$2 out rc errf
  errf=$(mktemp "${TMPDIR:-/tmp}/github-sh.XXXXXX") || die "一時ファイルを作れません"
  out=$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="${top:-$PWD}" "$script" 2>"$errf")
  rc=$?
  if [ "$rc" -eq 2 ]; then
    cat "$errf" >&2
    rm -f "$errf"
    printf 'github.sh: 確認が止めました: %s\n' "$(basename "$script")" >&2
    exit 2
  fi
  rm -f "$errf"
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
    printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' >&2
    printf 'github.sh: 確認が止めました: %s\n' "$(basename "$script")" >&2
    exit 2
  fi
}

# run_checks <コマンド...>: 同じフォルダの確認を流す
run_checks() {
  local input c
  input=$(jq -n --arg c "$(synth "$@")" --arg d "$PWD" \
    '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $c}, cwd: $d}') || die "jq がありません"
  for c in cr-gate-push.sh tdd-push-gate.sh cr-limit-gate.sh; do
    run_check "$here/$c" "$input"
  done
}

# 開いたファイル（ファイル記述子 3）のリンクの数
fd3_links() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %l /dev/fd/3; else stat -L -c %h /dev/fd/3; fi
}

# read_body <ファイル>: 本文のファイル（リポジトリかスクラッチパッドの中）を開いて確かめ、中身を body に入れる
body=""
read_body() {
  local f=$1 real inside=""
  [ "$f" != "-" ] || die "本文を標準入力から読むことはできません"
  real=$(realpath "$f" 2>/dev/null) || die "本文のファイルがありません: $f"
  [ -f "$real" ] || die "本文のファイルがありません: $f"
  if [ -n "$top" ]; then
    case "$real" in "$(realpath "$top")"/*) inside=1 ;; esac
  fi
  case "$real" in /private/tmp/claude-"$(id -u)"/*/*/scratchpad/*) inside=1 ;; esac
  [ -n "$inside" ] || die "本文のファイルは、リポジトリかスクラッチパッドの中に置いてください: $f"
  exec 3<"$real" || die "本文のファイルを開けません: $f"
  # ハードリンクは、realpath では外のファイルと見分けられないため断る
  [ "$(fd3_links)" = 1 ] || die "本文のファイルが、ほかのファイルのハードリンクです: $f"
  body=$(cat <&3)
  exec 3<&-
}

# check_gh_opts <値を取るオプション（| 区切り）> <値を取らないオプション（| 区切り）> <引数...>
# 決めたオプションだけか確かめ、gh に渡す引数を gh_opts に入れる。--body-file / -F は、中身を読んで --body にする。
# オプションとして書いたもの（値は除く）を seen に入れる（例: |--draft|--body|）
gh_opts=()
seen="|"
check_gh_opts() {
  local with=$1 without=$2 a v
  shift 2
  gh_opts=()
  seen="|"
  while [ $# -gt 0 ]; do
    a=$1
    shift
    case "$a" in --*=*) v=${a#*=}; a=${a%%=*}; set -- "$v" "$@" ;; esac
    if [[ "|$with|" == *"|$a|"* ]]; then
      [ $# -gt 0 ] || die "$a に値がありません"
      case "$a" in
        --body-file | -F)
          read_body "$1"
          gh_opts+=(--body "$body")
          seen="$seen--body|"
          ;;
        *)
          gh_opts+=("$a" "$1")
          seen="$seen$a|"
          ;;
      esac
      shift
    elif [[ "|$without|" == *"|$a|"* ]]; then
      gh_opts+=("$a")
      seen="$seen$a|"
    else
      die "使えないオプション・引数: $a"
    fi
  done
}
# has_body: --body・-b・--body-file・-F のどれかを、オプションとして書いたか
has_body() { [[ "$seen" == *"|--body|"* || "$seen" == *"|-b|"* ]]; }

# reject_web <引数...>: ブラウザを開く --web（--web=…・-w・-cw のような短いオプションのまとめ）を断る
reject_web() {
  local a
  for a in "$@"; do
    case "$a" in
      --web | --web=*) die "--web は使えません" ;;
      --*) ;;
      -*w*) die "--web（-w）は使えません: $a" ;;
    esac
  done
}

# write_gh <gh の引数...>: origin のリポジトリ（一覧にあるもの）を --repo に付け、確認を流してから実行する（PR・Issue）
write_gh() {
  [ -n "$top" ] || die "リポジトリの中で実行してください"
  check_remote origin push
  run_checks gh "$@" --repo "$slug"
  exec gh "$@" --repo "$slug"
}

check_number() {
  case "${1-}" in '' | *[!0-9]*) die "番号を数字で指定してください: ${1-}" ;; esac
}

case "${1-}" in
  push)
    shift
    [ -n "$top" ] || die "リポジトリの中で実行してください"
    flags=()
    remote=""
    refs=()
    for a in "$@"; do
      case "$a" in
        -u | --set-upstream | --dry-run) flags+=("$a") ;;
        -*) die "push に使えないオプション: $a" ;;
        *)
          if [ -z "$remote" ]; then
            remote=$a
            continue
          fi
          case "$a" in +* | :*) die "force push・削除はできません: $a" ;; esac
          if [[ "$a" == *:* ]]; then
            dst=${a#*:}
            case "$dst" in
              refs/heads/?*) dst=${dst#refs/heads/} ;;
              refs/* | '' | *:*) die "送り先はブランチだけです: $a" ;;
            esac
          elif [ "$a" = "HEAD" ]; then
            dst=$(git symbolic-ref -q --short HEAD) || die "今のブランチがありません（HEAD:refs/heads/<branch> の形で指定してください）"
          elif git show-ref --verify -q "refs/heads/$a"; then
            dst=$a
          else
            die "ブランチではありません（タグなどは送れません）: $a"
          fi
          check_branch "$dst"
          refs+=("$a")
          ;;
      esac
    done
    [ -n "$remote" ] || die "リモートを指定してください"
    [ "${#refs[@]}" -gt 0 ] || die "送るブランチを指定してください"
    check_remote "$remote" push
    run_checks git push "${flags[@]}" "$remote" "${refs[@]}"
    exec git push "${flags[@]}" "$remote" "${refs[@]}"
    ;;
  fetch)
    shift
    [ -n "$top" ] || die "リポジトリの中で実行してください"
    remote=""
    for a in "$@"; do
      case "$a" in
        -p | --prune | -q | --quiet) ;;
        -*) die "fetch に使えないオプション: $a" ;;
        *) [ -n "$remote" ] || remote=$a ;;
      esac
    done
    [ -n "$remote" ] || die "リモートを指定してください"
    check_remote "$remote" fetch
    exec git fetch "$@"
    ;;
  pr)
    case "${2-}" in
      view | list | diff | checks)
        reject_web "${@:3}"
        exec gh "$@"
        ;;
      create)
        check_gh_opts "--base|-B|--head|-H|--title|-t|--body|-b|--body-file|-F|--label|-l" "--draft" "${@:3}"
        [[ "$seen" == *"|--draft|"* ]] || die "PR は --draft で作ってください"
        write_gh pr create "${gh_opts[@]}"
        ;;
      edit)
        check_number "${3-}"
        check_gh_opts "--title|-t|--body|-b|--body-file|-F|--add-label|--remove-label|--base|-B" "" "${@:4}"
        write_gh pr edit "$3" "${gh_opts[@]}"
        ;;
      comment)
        check_number "${3-}"
        check_gh_opts "--body|-b|--body-file|-F" "" "${@:4}"
        has_body || die "本文（--body・--body-file）を指定してください"
        write_gh pr comment "$3" "${gh_opts[@]}"
        ;;
      close)
        check_number "${3-}"
        check_gh_opts "--comment|-c" "" "${@:4}"
        write_gh pr close "$3" "${gh_opts[@]}"
        ;;
      *) die "gh pr ${2-} はできません" ;;
    esac
    ;;
  run)
    case "${2-}" in
      view | list)
        reject_web "${@:3}"
        exec gh "$@"
        ;;
      *) die "gh run ${2-} はできません" ;;
    esac
    ;;
  issue)
    case "${2-}" in
      view)
        reject_web "${@:3}"
        exec gh "$@"
        ;;
      comment)
        check_number "${3-}"
        check_gh_opts "--body|-b|--body-file|-F" "" "${@:4}"
        has_body || die "本文（--body・--body-file）を指定してください"
        write_gh issue comment "$3" "${gh_opts[@]}"
        ;;
      create)
        check_gh_opts "--title|-t|--body|-b|--body-file|-F|--label|-l" "" "${@:3}"
        write_gh issue create "${gh_opts[@]}"
        ;;
      *) die "gh issue ${2-} はできません" ;;
    esac
    ;;
  api)
    # リポジトリの API（repos/...）のパスだけ（URL・graphql・ほかの API・.. は断る）
    [[ "${2-}" =~ ^/?repos/[A-Za-z0-9._/-]+(\?[A-Za-z0-9=\&_.,-]*)?$ ]] || die "api の最初の引数は repos/... のパスにしてください: ${2-}"
    [[ "${2-}" != *..* ]] || die "api のパスに .. は使えません: ${2-}"
    check_gh_opts "--jq|-q" "--paginate" "${@:3}"
    exec gh api "$2" "${gh_opts[@]}"
    ;;
  *) die "できない操作です: ${1-}" ;;
esac
