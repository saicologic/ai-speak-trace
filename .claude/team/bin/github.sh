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
#   - 送り元は、今の HEAD と同じコミットだけ（push の前の確認は HEAD を見るため）
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

# 秘密の情報（API キー・トークン・秘密鍵）の形。公開のリポジトリに書かせない
# （Anthropic・AWS のアクセスキー・GitHub のトークン・ElevenLabs・Slack・PEM の秘密鍵）
SECRET_RE='sk-ant-[A-Za-z0-9_-]{20,}|(AKIA|ASIA)[0-9A-Z]{16}|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|sk_[0-9a-f]{48}|-----BEGIN ([A-Z]+ )*PRIVATE KEY-----|xox[abprs]-[A-Za-z0-9-]{10,}'
# has_secret: 標準入力に秘密の情報の形があるか
has_secret() { grep -aEq -- "$SECRET_RE"; }

skips=()
while [ "${1-}" = "--skip" ]; do
  case "${2-}" in
    SKIP_CR_LOOP | SKIP_TDD_CHECK | SKIP_CR_LIMIT) skips+=("$2=1") ;;
    *) die "--skip に使えない名前: ${2-}" ;;
  esac
  shift 2
done

top=$(git rev-parse --show-toplevel 2>/dev/null) || top=""
# 作業ツリーのない場所（.git の中など）でも、gh が中で git を動かすため、リポジトリの設定を確かめる
if git rev-parse --git-dir >/dev/null 2>&1; then
  check_git_config
fi

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
# 引数は、そのまま書ける文字だけならそのまま、ほかは一重引用符で囲む（中の ' は '\'' にする）。
# printf '%q' は改行があると $'...' の形になり、push を見つけるスクリプト（is-git-push.mjs など）が読めないため使わない
# （置き換える文字は変数に入れる。${var//\'/...} の引用符の読み方は、bash 3.2（macOS の /bin/bash）と新しい版で違うため）
quote_arg() {
  local sq="'" esc="'\\''"
  if [[ "$1" =~ ^[A-Za-z0-9_./:=@%+,-]+$ ]]; then
    printf '%s' "$1"
  else
    printf "'%s'" "${1//$sq/$esc}"
  fi
}
synth() {
  local s="" a
  for a in "${skips[@]}"; do s="$s$a "; done
  for a in "$@"; do s="$s$(quote_arg "$a") "; done
  printf '%s' "${s% }"
}

# run_check <確認のスクリプト> <入力>: 止めたら終わる（exit 2、または JSON の deny）
run_check() {
  local script=$1 input=$2 out rc errf
  errf=$(mktemp "${TMPDIR:-/tmp}/github-sh.XXXXXX") || die "一時ファイルを作れません"
  out=$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="${top:-$PWD}" "$script" 2>"$errf")
  rc=$?
  # 2（止める）だけでなく、落ちた・ない・実行できないとき（0 以外）も、確かめられないので止める
  if [ "$rc" -ne 0 ]; then
    cat "$errf" >&2
    rm -f "$errf"
    printf 'github.sh: 確認が止めました（終了コード %s）: %s\n' "$rc" "$(basename "$script")" >&2
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

# 開いたファイル（ファイル記述子 3）のリンクの数・装置と inode、パスの装置と inode（リンクはたどらない）
fd3_links() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %l /dev/fd/3; else stat -L -c %h /dev/fd/3; fi
}
# macOS の /dev/fd/3 は、装置の番号が実際のファイルと違って見えるため、inode の番号だけで比べる
fd3_inode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %i /dev/fd/3; else stat -L -c %d:%i /dev/fd/3; fi
}
path_inode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %i "$1"; else stat -c %d:%i "$1"; fi
}

# read_body <ファイル>: 本文のファイル（リポジトリかスクラッチパッドの中）を開いて確かめ、中身を body に入れる
body=""
read_body() {
  local f=$1 real inside=""
  [ "$f" != "-" ] || die "本文を標準入力から読むことはできません"
  # .env* の名前のファイル・フォルダの中のファイル（managed settings の Read の deny）は、指定されたパスでも送らない
  case "/$f" in */.env*) die "本文に使えないファイルです: $f" ;; esac
  real=$(realpath "$f" 2>/dev/null) || die "本文のファイルがありません: $f"
  [ -f "$real" ] || die "本文のファイルがありません: $f"
  # サンドボックスの中から読めないファイル（managed settings の Read の deny にあるもの）は送らない。
  # ホームのフォルダそのものがリポジトリでも、~/.aws などを「リポジトリの中」として送らないよう、場所でも確かめる
  case "$real" in */.env*) die "本文に使えないファイルです: $f" ;; esac
  local h
  h=$(realpath "$HOME" 2>/dev/null) || h=$HOME
  case "$real" in
    "$h"/.aws/* | "$h"/.ssh/* | "$h"/.gnupg/* | "$h"/.config/gh/* | "$h"/Library/Keychains/* | \
      "$h"/.docker/config.json | "$h"/.git-credentials | "$h"/.netrc | "$h"/.npmrc | \
      "$h"/Library/"Application Support"/io.github.saicologic.ai-speak-trace/*)
      die "本文に使えないファイルです: $f"
      ;;
  esac
  if [ -n "$top" ]; then
    case "$real" in "$(realpath "$top")"/*) inside=1 ;; esac
  fi
  case "$real" in /private/tmp/claude-"$(id -u)"/*/*/scratchpad/*) inside=1 ;; esac
  [ -n "$inside" ] || die "本文のファイルは、リポジトリかスクラッチパッドの中に置いてください: $f"
  exec 3<"$real" || die "本文のファイルを開けません: $f"
  # 確かめてから開くまでの間に、リンクなどに差し替えられていないか（開いたものが、確かめた場所のファイルそのものか）
  if [ -L "$real" ] || [ "$(realpath "$f" 2>/dev/null)" != "$real" ] || [ "$(fd3_inode)" != "$(path_inode "$real")" ]; then
    die "本文のファイルが、確かめた後に差し替えられました: $f"
  fi
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
    [ -n "$a" ] || die "空の引数は使えません"
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
  # タイトル・本文（--body-file は読んだ中身）などに秘密の情報があれば、書かない
  if printf '%s\n' "$@" | has_secret; then
    die "書き込む内容に秘密の情報（API キー・トークン・秘密鍵）の形があります。消してから、もう一度実行してください"
  fi
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
          # 確認（cr-gate-push.sh・tdd-push-gate.sh）は HEAD を見るため、送り元は HEAD と同じコミットだけにする
          src=${a%%:*}
          src_sha=$(git rev-parse -q --verify "$src^{commit}" 2>/dev/null) || die "送り元のコミットがありません: $src"
          [ "$src_sha" = "$(git rev-parse HEAD)" ] || die "送り元は今の HEAD と同じコミットだけです（確認は HEAD を見るため）: $a"
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
    # まだ送っていないコミットで足した行と、コミットメッセージに、秘密の情報があれば送らない
    # （後のコミットで消しても、前のコミットに残るため）
    # - 送り済みかどうかは、手元の remote-tracking ref（サンドボックスの中から作れる）ではなく、
    #   リモートに今あるコミット（ls-remote）で決める
    # - replace の ref で git log に見せる中身だけを差し替えさせない（push は本当の中身を送る）
    # - バイナリ扱い（.gitattributes）・NUL のあるファイルの中身と、マージのコミットで足した行も見る
    remote_shas=$(git ls-remote "$remote") || die "リモートの状態を調べられませんでした: $remote"
    not_args=()
    while read -r sha _; do
      git cat-file -e "$sha^{commit}" 2>/dev/null && not_args+=("^$sha")
    done <<<"$remote_shas"
    # git log が失敗したときは、確かめられないので送らない（空の出力を「秘密の情報なし」としない）
    msgs=$(GIT_NO_REPLACE_OBJECTS=1 git log --format=%B HEAD ${not_args[@]+"${not_args[@]}"}) ||
      die "まだ送っていないコミットのメッセージを調べられませんでした"
    diffs=$(GIT_NO_REPLACE_OBJECTS=1 git log -p --text --diff-merges=first-parent --format= HEAD ${not_args[@]+"${not_args[@]}"}) ||
      die "まだ送っていないコミットの変えた中身を調べられませんでした"
    if { printf '%s\n' "$msgs"; printf '%s\n' "$diffs" | grep -a '^+'; } | has_secret; then
      die "まだ送っていないコミット（変えた中身・メッセージ）に、秘密の情報（API キー・トークン・秘密鍵）の形があります。コミットから消してから、もう一度実行してください"
    fi
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
