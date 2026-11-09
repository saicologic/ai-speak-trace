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
#   書き込む gh api など、上にない操作とオプション
# - 送り先:
#   - push・PR の操作は、<prefix>/etc/github-repos に書いた GitHub のリポジトリだけ。PR の操作は origin のリポジトリを --repo に付ける
#   - push するブランチは fix/*・feature/*・test/* だけ（main・release/* へは PR で入れる）
#   - fetch は GitHub のリポジトリだけ
# - サンドボックスの中で書き換えられたリポジトリで、外のコマンドを動かさないように:
#   - リポジトリの git の設定は、決めた項目だけを認める（lib/git-safety.sh）
#   - git のフック（.git/hooks）は動かさない（core.hooksPath=/dev/null）
# - 書き込む操作（push・pr create / edit / comment / close・issue comment / create）の前に、次の確認を、同じ操作の git / gh のコマンドとして流し、
#   止められたら止める
#   - 同じフォルダの cr-gate-push.sh（手元の CodeRabbit レビュー）
#   - リポジトリの .claude/settings(.local).json の PreToolUse（matcher が Bash）の hook（TDD・CodeRabbit の枠など）。
#     Claude Code で信頼したフォルダ（.claude.json の hasTrustDialogAccepted）のものだけ。worktree では、メインのフォルダ
#     （.git があるほう）の設定と hook を使う（worktree の中は書き換えられるため）。matcher が * などの hook は流さない
# - --skip NAME（SKIP_CR_LOOP・SKIP_TDD_CHECK・SKIP_CR_LIMIT）は、確認に NAME=1 を付けたコマンドとして渡す。
#   ユーザーの了承を得たときだけ使う
# - --body-file は、リポジトリの中か、Claude Code のスクラッチパッド（/private/tmp/claude-<uid>/*/*/scratchpad/）の中のファイルだけ
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

# GitHub の URL から owner/name を取り出す（GitHub 以外なら失敗）
github_slug() {
  local p
  case "$1" in
    https://github.com/*) p=${1#https://github.com/} ;;
    git@github.com:*) p=${1#git@github.com:} ;;
    ssh://git@github.com/*) p=${1#ssh://git@github.com/} ;;
    *) return 1 ;;
  esac
  p=${p%/}
  p=${p%.git}
  [[ "$p" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || return 1
  printf '%s' "$p"
}

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

# リポジトリの hook を読むフォルダ（信頼したメインのフォルダ。なければ空）
trusted_main() {
  local common main f
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  case "$common" in */.git) main=${common%/.git} ;; *) return 0 ;; esac
  if [ -n "${CLAUDE_CONFIG_DIR-}" ]; then f="$CLAUDE_CONFIG_DIR/.claude.json"; else f="$HOME/.claude.json"; fi
  jq -e --arg d "$main" '.projects[$d].hasTrustDialogAccepted == true' "$f" >/dev/null 2>&1 && printf '%s' "$main"
}

# 確認に渡すコマンドを作る（--skip の NAME=1 を先頭に付ける）
synth() {
  local s="" a
  for a in "${skips[@]}"; do s="$s$a "; done
  for a in "$@"; do s="$s$(printf '%q' "$a") "; done
  printf '%s' "${s% }"
}

# run_hook <hook のコマンド> <入力> <CLAUDE_PROJECT_DIR>: hook が止めたら終わる（exit 2、または JSON の deny）
run_hook() {
  local h=$1 input=$2 project=$3 out rc errf
  errf=$(mktemp "${TMPDIR:-/tmp}/github-sh.XXXXXX") || die "一時ファイルを作れません"
  out=$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$project" bash -c "$h" 2>"$errf")
  rc=$?
  if [ "$rc" -eq 2 ]; then
    cat "$errf" >&2
    rm -f "$errf"
    printf 'github.sh: 確認が止めました: %s\n' "$h" >&2
    exit 2
  fi
  rm -f "$errf"
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
    printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' >&2
    printf 'github.sh: 確認が止めました: %s\n' "$h" >&2
    exit 2
  fi
}

# run_checks <コマンド...>: cr-gate-push.sh と、信頼したリポジトリの PreToolUse（Bash）の hook を流す
run_checks() {
  local input main f h
  input=$(jq -n --arg c "$(synth "$@")" --arg d "$PWD" \
    '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $c}, cwd: $d}') || die "jq がありません"
  run_hook "$(printf '%q' "$here/cr-gate-push.sh")" "$input" "${top:-$PWD}"
  main=$(trusted_main)
  if [ -z "$main" ]; then
    [ -z "$top" ] || printf 'github.sh: 信頼したフォルダではないため、リポジトリの hook は流しません\n' >&2
    return 0
  fi
  for f in "$main/.claude/settings.json" "$main/.claude/settings.local.json"; do
    [ -f "$f" ] || continue
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      run_hook "$h" "$input" "$main"
    done < <(jq -r '.hooks.PreToolUse[]? | select((.matcher // "") | split("|") | any(. == "Bash")) | .hooks[]? | select(.type == "command") | .command' "$f" 2>/dev/null)
  done
}

# 本文のファイルが、リポジトリの中かスクラッチパッドの中か
check_body_file() {
  local f=$1 real
  [ "$f" != "-" ] || die "本文を標準入力から読むことはできません"
  real=$(realpath "$f" 2>/dev/null) || die "本文のファイルがありません: $f"
  [ -f "$real" ] || die "本文のファイルがありません: $f"
  if [ -n "$top" ]; then
    case "$real" in "$(realpath "$top")"/*) return 0 ;; esac
  fi
  case "$real" in /private/tmp/claude-"$(id -u)"/*/*/scratchpad/*) return 0 ;; esac
  die "本文のファイルは、リポジトリかスクラッチパッドの中に置いてください: $f"
}

# write_gh <gh の引数...>: origin のリポジトリ（一覧にあるもの）を --repo に付け、確認を流してから実行する（PR・Issue）
write_gh() {
  [ -n "$top" ] || die "リポジトリの中で実行してください"
  check_remote origin push
  run_checks gh "$@" --repo "$slug"
  exec gh "$@" --repo "$slug"
}

check_pr_number() {
  case "${1-}" in '' | *[!0-9]*) die "PR の番号を数字で指定してください: ${1-}" ;; esac
}

# check_gh_opts <値を取るオプション（| 区切り）> <値を取らないオプション（| 区切り）> <引数...>
# 決めたオプションだけか確かめる。--body-file / -F の値は check_body_file で確かめる
check_gh_opts() {
  local with=$1 without=$2 a v
  shift 2
  while [ $# -gt 0 ]; do
    a=$1
    shift
    case "$a" in --*=*) v=${a#*=}; a=${a%%=*}; set -- "$v" "$@" ;; esac
    if [[ "|$with|" == *"|$a|"* ]]; then
      [ $# -gt 0 ] || die "$a に値がありません"
      case "$a" in --body-file | -F) check_body_file "$1" ;; esac
      shift
    elif [[ "|$without|" == *"|$a|"* ]]; then
      :
    else
      die "使えないオプション・引数: $a"
    fi
  done
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
    exec git -c core.hooksPath=/dev/null push "${flags[@]}" "$remote" "${refs[@]}"
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
    exec git -c core.hooksPath=/dev/null fetch "$@"
    ;;
  pr)
    sub=${2-}
    case "$sub" in
      view | list | diff | checks)
        for a in "${@:3}"; do
          case "$a" in -w | --web) die "--web は使えません" ;; esac
        done
        exec gh "$@"
        ;;
      create)
        [[ " ${*:3} " == *" --draft "* ]] || die "PR は --draft で作ってください"
        check_gh_opts "--base|-B|--head|-H|--title|-t|--body|-b|--body-file|-F|--label|-l" "--draft" "${@:3}"
        write_gh "$@"
        ;;
      edit)
        check_pr_number "${3-}"
        check_gh_opts "--title|-t|--body|-b|--body-file|-F|--add-label|--remove-label|--base|-B" "" "${@:4}"
        write_gh "$@"
        ;;
      comment)
        check_pr_number "${3-}"
        [[ " ${*:4} " =~ \ (--body|-b|--body-file|-F)[\ =] ]] || die "本文（--body・--body-file）を指定してください"
        check_gh_opts "--body|-b|--body-file|-F" "" "${@:4}"
        write_gh "$@"
        ;;
      close)
        check_pr_number "${3-}"
        check_gh_opts "--comment|-c" "" "${@:4}"
        write_gh "$@"
        ;;
      *) die "gh pr $sub はできません" ;;
    esac
    ;;
  run)
    case "${2-}" in
      view | list)
        for a in "${@:3}"; do
          case "$a" in -w | --web) die "--web は使えません" ;; esac
        done
        exec gh "$@"
        ;;
      *) die "gh run ${2-} はできません" ;;
    esac
    ;;
  issue)
    case "${2-}" in
      view)
        for a in "${@:3}"; do
          case "$a" in -w | --web) die "--web は使えません" ;; esac
        done
        exec gh "$@"
        ;;
      comment)
        check_pr_number "${3-}"
        [[ " ${*:4} " =~ \ (--body|-b|--body-file|-F)[\ =] ]] || die "本文（--body・--body-file）を指定してください"
        check_gh_opts "--body|-b|--body-file|-F" "" "${@:4}"
        write_gh "$@"
        ;;
      create)
        check_gh_opts "--title|-t|--body|-b|--body-file|-F|--label|-l" "" "${@:3}"
        write_gh "$@"
        ;;
      *) die "gh issue ${2-} はできません" ;;
    esac
    ;;
  api)
    # リポジトリの API（repos/...）のパスだけ（URL・graphql・ほかの API は断る）
    [[ "${2-}" =~ ^/?repos/[A-Za-z0-9._/-]+(\?[A-Za-z0-9=\&_.,-]*)?$ ]] || die "api の最初の引数は repos/... のパスにしてください: ${2-}"
    check_gh_opts "--jq|-q" "--paginate" "${@:3}"
    exec gh "$@"
    ;;
  *) die "できない操作です: ${1-}" ;;
esac
