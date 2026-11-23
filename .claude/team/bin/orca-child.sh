#!/bin/bash
# 今のワークツリーの子ワークツリーを Orca で作り、依頼文を渡したときは、そこで Claude Code を起動して依頼を渡す
#
# 使い方: orca-child.sh <ブランチ> [元のブランチ（既定: origin/main）] [依頼文のファイル]
#   例: ! /opt/claude-code-team/bin/orca-child.sh fix/foo origin/release/v0.11.1 .claude/briefs/foo.md
#
# Claude Code のサンドボックスからは Orca に届かず、セッションは自分のワークツリーにしか書けないため、
# 子ワークツリーの作業は、そこで新しく起動した Claude Code に渡す。Claude Code が依頼文を書き、ユーザーが `!` で動かす。
# Claude Code が自分で Orca を動かせるようにはしない（サンドボックスを広げないため、sandbox.excludedCommands に入れない）。
#
# - ブランチは fix/*・feature/*・test/*（github.sh が push できるもの）の、/ を1つだけ含む名前。
#   ワークツリーの名前は、ブランチの / の後ろ
# - 元のブランチは origin/main・origin/release/vX.Y.Z だけ
# - 依頼文のファイルは、呼び出したワークツリーの .claude/briefs/（git に入れない）か、Claude Code のスクラッチパッド
#   （/private/tmp/claude-<uid>/<プロジェクト>/<セッション>/scratchpad/）の中の普通のファイルだけ。/tmp/claude/ は再起動で消えるため使わない。
#   シンボリックリンク・ハードリンク・.env* の名前のもの・秘密の情報の形を含むものは断る
# - 依頼文は、作った子ワークツリーの .claude/briefs/<ワークツリーの名前>.md にも写す（子のセッションが後から読み直せるように）
# - ORCA_CLI_COMMAND があればそれを、なければ orca を動かす
#
# テスト: bash .claude/team/tests/orca-child.test.sh

set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd -P)
# shellcheck source=lib/git-safety.sh
. "$here/lib/git-safety.sh"

die() { printf 'orca-child.sh: %s\n' "$1" >&2; exit 1; }
usage() {
  cat >&2 <<'EOF'
使い方: orca-child.sh <ブランチ> [元のブランチ（既定: origin/main）] [依頼文のファイル]
  ブランチ: fix/<名前>・feature/<名前>・test/<名前>
  元のブランチ: origin/main・origin/release/vX.Y.Z
  依頼文のファイル: 呼び出したワークツリーの .claude/briefs/ か、Claude Code のスクラッチパッドの中
EOF
  exit 1
}

# 秘密の情報（API キー・トークン・秘密鍵）の形。github.sh と同じ（テストで同じことを確かめる）
SECRET_RE='sk-ant-[A-Za-z0-9_-]{20,}|(AKIA|ASIA)[0-9A-Z]{16}|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|sk_[0-9a-f]{48}|-----BEGIN ([A-Z]+ )*PRIVATE KEY-----|xox[abprs]-[A-Za-z0-9-]{10,}'

[ $# -ge 1 ] && [ $# -le 3 ] || usage
branch=$1
base=${2-origin/main}
brief=${3-}

[[ "$branch" =~ ^(fix|feature|test)/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { printf 'orca-child.sh: 使えないブランチ: %s\n' "$branch" >&2; usage; }
case "$branch" in *..* | *.lock | *.) printf 'orca-child.sh: 使えないブランチ: %s\n' "$branch" >&2; usage ;; esac
[[ "$base" =~ ^origin/(main|release/v[0-9]+\.[0-9]+\.[0-9]+)$ ]] || { printf 'orca-child.sh: 使えない元のブランチ: %s\n' "$base" >&2; usage; }
name=${branch#*/}

# 呼び出したワークツリー。サンドボックスの中で書き換えられる設定で、外のコマンドを動かさないよう、設定を確かめる
top=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  check_git_config
  top=$(git rev-parse --show-toplevel 2>/dev/null) || top=""
fi

# 開いたファイル（ファイル記述子 3）のリンクの数・inode、パスの inode（リンクはたどらない）。github.sh と同じ
fd3_links() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %l /dev/fd/3; else stat -L -c %h /dev/fd/3; fi
}
fd3_inode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %i /dev/fd/3; else stat -L -c %d:%i /dev/fd/3; fi
}
path_inode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f %i "$1"; else stat -c %d:%i "$1"; fi
}

# read_brief <ファイル>: 依頼文のファイルを開いて確かめ、中身を prompt に入れる
prompt=""
read_brief() {
  local f=$1 real top_real briefs_real inside=""
  # .env* の名前のファイル・フォルダの中のファイルは、中を読まずに断る
  case "/$f" in */.env*) die "依頼文に使えないファイルです（.env*）: $f" ;; esac
  [ ! -L "$f" ] || die "依頼文のファイルが、シンボリックリンクです: $f"
  real=$(realpath "$f" 2>/dev/null) || die "依頼文のファイルがありません: $f"
  [ -f "$real" ] || die "依頼文のファイルがありません: $f"
  case "$real" in */.env*) die "依頼文に使えないファイルです（.env*）: $f" ;; esac
  # .claude・.claude/briefs が、リンクでほかの場所を指していないこと（解決した場所が、ワークツリーの中のそのフォルダであること）
  if [ -n "$top" ]; then
    top_real=$(realpath "$top")
    briefs_real=$(realpath "$top_real/.claude/briefs" 2>/dev/null) || briefs_real=""
    if [ "$briefs_real" = "$top_real/.claude/briefs" ]; then
      case "$real" in "$briefs_real"/*) inside=1 ;; esac
    fi
  fi
  # case の * は / にも合うため、段の数を正規表現で決める（/tmp/claude-<uid>/<プロジェクト>/<セッション>/scratchpad/ の中）
  [[ "$real" =~ ^/(private/)?tmp/claude-$(id -u)/[^/]+/[^/]+/scratchpad/ ]] && inside=1
  [ -n "$inside" ] || die "依頼文のファイルは、呼び出したワークツリーの .claude/briefs/ か、スクラッチパッドの中に置いてください: $f"
  exec 3<"$real" || die "依頼文のファイルを開けません: $f"
  # 確かめてから開くまでの間に、リンクなどに差し替えられていないか
  if [ -L "$real" ] || [ "$(realpath "$f" 2>/dev/null)" != "$real" ] || [ "$(fd3_inode)" != "$(path_inode "$real")" ]; then
    die "依頼文のファイルが、確かめた後に差し替えられました: $f"
  fi
  # ハードリンクは、realpath では外のファイルと見分けられないため断る
  [ "$(fd3_links)" = 1 ] || die "依頼文のファイルが、ほかのファイルのハードリンクです: $f"
  prompt=$(cat <&3)
  exec 3<&-
  [ -n "$prompt" ] || die "依頼文のファイルが空です: $f"
  # パイプで渡すと、grep が先に終わったときに送る側が SIGPIPE で失敗し、pipefail で検査をすり抜けるため、ヒアストリングで渡す
  if grep -aEq -- "$SECRET_RE" <<<"$prompt"; then
    die "依頼文に、秘密の情報（API キー・トークン・秘密鍵）の形があります: $f"
  fi
}

[ -z "$brief" ] || read_brief "$brief"

orca=${ORCA_CLI_COMMAND:-orca}
args=(worktree create --name "$name" --parent-worktree active --base-branch "$base" --branch "$branch" --setup skip)
[ -z "$brief" ] || args+=(--agent claude --prompt "$prompt")
args+=(--json)

rc=0
out=$("$orca" "${args[@]}") || rc=$?
printf '%s\n' "$out"
[ "$rc" -eq 0 ] || exit "$rc"
[ -n "$brief" ] || exit 0

# 依頼文を、作った子ワークツリーの .claude/briefs/<名前>.md に写す
# 子ワークツリーの場所は、orca の答えの中の、/<名前> で終わる絶対パス（<repoId>::<パス> の形も含む）が1つだけのとき、それとする
fail_copy() { die "子ワークツリーを作り、Claude Code に依頼を渡しましたが、依頼文を写せませんでした: $1"; }
candidates=$(printf '%s' "$out" | jq -r --arg n "/$name" '[.. | strings | sub("^.*::"; "") | select(startswith("/") and endswith($n))] | unique | .[]' 2>/dev/null) ||
  fail_copy "orca の答えを読めません"
[ -n "$candidates" ] || fail_copy "orca の答えに、子ワークツリーの場所がありません"
[ "$(printf '%s\n' "$candidates" | wc -l | tr -d ' ')" = 1 ] || fail_copy "orca の答えから、子ワークツリーの場所が1つに決まりません"
child=$(realpath "$candidates" 2>/dev/null) || fail_copy "子ワークツリーがありません: $candidates"
[ -d "$child" ] && [ -e "$child/.git" ] || fail_copy "子ワークツリーがありません: $candidates"
if [ -n "$top" ] && [ "$child" = "$(realpath "$top")" ]; then fail_copy "子ワークツリーが、呼び出したワークツリーと同じです"; fi
dir="$child/.claude/briefs"
# 1段ずつフォルダに入り、リンクでほかの場所を指していないことを確かめてから、次の段を相対パスで作る
# （.claude がリンクのとき、その先に briefs を作らない。確かめた後に、子のセッションがリンクに差し替えても、外に書かない）
cd "$child" 2>/dev/null || fail_copy "$child に入れません"
here_dir=$child
for part in .claude briefs; do
  here_dir="$here_dir/$part"
  if [ -L "./$part" ]; then fail_copy "$here_dir が、リンクでほかの場所を指しています"; fi
  [ -d "./$part" ] || mkdir "./$part" 2>/dev/null || fail_copy "$here_dir を作れません"
  cd "./$part" 2>/dev/null || fail_copy "$here_dir に入れません"
  [ "$(pwd -P)" = "$here_dir" ] || fail_copy "$here_dir が、リンクでほかの場所を指しています"
done
dest="$dir/$name.md"
if [ -e "./$name.md" ] || [ -L "./$name.md" ]; then fail_copy "$dest がすでにあります"; fi
# 上書きしない（確かめた後にリンクを置かれても、その先に書かない）
set -C
# 子ワークツリーの元のブランチの .gitignore に .claude/briefs/ がなくても、git に入れないようにする。
# すでに .gitignore があるときは、全部を無視する * の行があり、! で無視をやめる行がないことを確かめ、違えば依頼文を書かない
if [ ! -e ./.gitignore ] && [ ! -L ./.gitignore ]; then
  printf '*\n' >./.gitignore 2>/dev/null || fail_copy "$dir/.gitignore に書けません"
elif [ -L ./.gitignore ] || ! grep -qx '\*' ./.gitignore 2>/dev/null || grep -q '^!' ./.gitignore 2>/dev/null; then
  fail_copy "$dir/.gitignore が、全部を無視していません（* の行がないか、! で無視をやめる行があります。依頼文が git に入るおそれがあります）"
fi
printf '%s\n' "$prompt" >"./$name.md" 2>/dev/null || fail_copy "$dest に書けません"
printf 'orca-child.sh: 依頼文を %s に写しました\n' "$dest" >&2
