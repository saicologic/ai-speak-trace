#!/bin/bash
# orca-child.sh のテスト（bash .claude/team/tests/orca-child.test.sh）
# orca を偽のコマンドに差し替え、正しい引数なら決めた引数で orca worktree create を呼び、依頼文を子ワークツリーに写すこと、
# 決めた形でないブランチ・元のブランチ・依頼文のファイルは、orca を呼ばずに断ることを確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
TEAM="$(cd "$(dirname "$0")/.." && pwd)"

# mktemp が失敗したときは、ここで止める（空の値で rm -rf しないように）
tmp=$(mktemp -d "${TMPDIR:-/tmp}/orca-child-test.XXXXXX") || exit 1
[ -n "$tmp" ] && [ -d "$tmp" ] || exit 1
tmp=$(cd "$tmp" && pwd -P) || exit 1
# Claude Code のスクラッチパッドの形（/tmp/claude-<uid>/<プロジェクト>/<セッション>/scratchpad）のフォルダ
scratch_top="/tmp/claude-$(id -u)/orca-child-test-$$"
scratch="$scratch_top/session/scratchpad"
mkdir -p "$scratch" || exit 1
trap 'rm -rf "$tmp" "$scratch_top"' EXIT

# 呼び出すワークツリー（依頼文は、その .claude/briefs/ に置く）
repo="$tmp/repo"
git init -q "$repo" || exit 1
briefs="$repo/.claude/briefs"
mkdir -p "$briefs"
# 偽の orca が子ワークツリーを作る場所
children="$tmp/children"
mkdir -p "$children"

mkdir -p "$tmp/bin"
# orca の代わり: 呼ばれた引数を1つずつ NUL で区切って記録し、--name の子ワークツリーを作って、その場所を JSON で答える
#   FAKE_ORCA_RC: その終了コードで終わる（子ワークツリーは作らない）
#   FAKE_ORCA_OUT: 答える JSON（子ワークツリーの場所を答えない・2つ答えるときに使う）
cat >"$tmp/bin/orca" <<EOF
#!/bin/bash
printf '%s\0' "\$@" >"$tmp/orca-called"
[ "\${FAKE_ORCA_RC:-0}" = 0 ] || exit "\$FAKE_ORCA_RC"
name=""
while [ \$# -gt 0 ]; do [ "\$1" = --name ] && name=\$2; shift; done
mkdir -p "$children/\$name"
: >"$children/\$name/.git"
if [ -n "\${FAKE_ORCA_OUT-}" ]; then printf '%s\n' "\$FAKE_ORCA_OUT"; exit 0; fi
printf '{"ok":true,"result":{"worktree":{"id":"repo1::%s","path":"%s","branch":"x"}}}\n' "$children/\$name" "$children/\$name"
EOF
chmod +x "$tmp/bin/orca"
cp "$tmp/bin/orca" "$tmp/bin/other-orca"
export PATH="$tmp/bin:$PATH"
unset ORCA_CLI_COMMAND FAKE_ORCA_RC FAKE_ORCA_OUT

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

# called_args: 記録した引数を1行に1つずつ出す（改行を含む引数は、そのまま複数行になる）
called_args() { tr '\0' '\n' <"$tmp/orca-called"; }
# run <引数...>: 呼び出すワークツリーの中で orca-child.sh を動かし、out・rc に入れる
run() {
  rm -f "$tmp/orca-called"
  out=$(cd "$repo" && bash "$BIN/orca-child.sh" "$@" 2>&1)
  rc=$?
}

# accepted <説明> <期待する引数（改行区切り）> <引数...>: 0 で終わり、orca を期待する引数で呼ぶ
accepted() {
  local name=$1 want=$2
  shift 2
  rm -rf "${children:?}"/*
  run "$@"
  if [ "$rc" -eq 0 ] && [ -e "$tmp/orca-called" ] && [ "$(called_args)" = "$want" ]; then ok; else
    ng "$name（rc=$rc）: $out / 呼んだ引数: $([ -e "$tmp/orca-called" ] && called_args | tr '\n' ' ')"
  fi
}

# rejected <説明> <引数...>: 1 で終わり、orca を呼ばない
rejected() {
  local name=$1
  shift
  run "$@"
  if [ "$rc" -eq 1 ] && [ -n "$out" ] && [ ! -e "$tmp/orca-called" ]; then ok; else ng "$name（rc=$rc）: $out"; fi
}

# 依頼文なし: 元のブランチの既定は origin/main。名前はブランチの / の後ろ
accepted "依頼文なし・元のブランチは既定" "worktree
create
--name
orca-child-helper
--parent-worktree
active
--base-branch
origin/main
--branch
fix/orca-child-helper
--setup
skip
--json" fix/orca-child-helper
# 依頼文がないときは、子ワークツリーに何も写さない
if [ ! -e "$children/orca-child-helper/.claude/briefs" ]; then ok; else ng "依頼文なしで写した"; fi

accepted "元のブランチに release" "worktree
create
--name
new-thing
--parent-worktree
active
--base-branch
origin/release/v0.11.1
--branch
feature/new-thing
--setup
skip
--json" feature/new-thing origin/release/v0.11.1

accepted "test/* のブランチ" "worktree
create
--name
a.b_c-1
--parent-worktree
active
--base-branch
origin/main
--branch
test/a.b_c-1
--setup
skip
--json" test/a.b_c-1 origin/main

# 依頼文を渡したら、作ると同時に Claude Code を起動する（中身は改行を含めてそのまま渡す）
brief_text='1行目の依頼
2行目 "引用" $(not-run) `x`'
printf '%s\n' "$brief_text" >"$briefs/brief.md"
accepted ".claude/briefs の依頼文" "worktree
create
--name
x
--parent-worktree
active
--base-branch
origin/main
--branch
fix/x
--setup
skip
--agent
claude
--prompt
$brief_text
--json" fix/x origin/main "$briefs/brief.md"
# 子ワークツリーの .claude/briefs/<名前>.md に、依頼文を写す（git に入れないよう、そのフォルダの .gitignore も置く）
if [ "$(cat "$children/x/.claude/briefs/x.md" 2>/dev/null)" = "$brief_text" ]; then ok; else ng "子ワークツリーに写していない: $out"; fi
if [ "$(cat "$children/x/.claude/briefs/.gitignore" 2>/dev/null)" = "*" ]; then ok; else ng "子ワークツリーの .claude/briefs/.gitignore がない"; fi

# 相対パス（呼び出すワークツリーからの）でも通る
accepted "相対パスの依頼文" "worktree
create
--name
x
--parent-worktree
active
--base-branch
origin/main
--branch
fix/x
--setup
skip
--agent
claude
--prompt
$brief_text
--json" fix/x origin/main ".claude/briefs/brief.md"

printf 'スクラッチパッドの依頼\n' >"$scratch/brief.md"
accepted "スクラッチパッドの依頼文" "worktree
create
--name
x
--parent-worktree
active
--base-branch
origin/release/v1.2.3
--branch
fix/x
--setup
skip
--agent
claude
--prompt
スクラッチパッドの依頼
--json" fix/x origin/release/v1.2.3 "$scratch/brief.md"
if [ "$(cat "$children/x/.claude/briefs/x.md" 2>/dev/null)" = "スクラッチパッドの依頼" ]; then ok; else ng "スクラッチパッドの依頼文を写していない: $out"; fi

# ORCA_CLI_COMMAND があれば、それを使う（orca は呼ばない）
rm -rf "${children:?}"/*
mv "$tmp/bin/orca" "$tmp/bin/orca.off"
rm -f "$tmp/orca-called"
out=$(cd "$repo" && ORCA_CLI_COMMAND="$tmp/bin/other-orca" bash "$BIN/orca-child.sh" fix/x 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ -e "$tmp/orca-called" ] && [ "$(called_args | head -2 | tr '\n' ' ')" = "worktree create " ]; then ok; else ng "ORCA_CLI_COMMAND（rc=$rc）: $out"; fi
mv "$tmp/bin/orca.off" "$tmp/bin/orca"
# ORCA_CLI_COMMAND は1つのコマンドとして扱い、空白で分けて別のコマンドを動かさない
rm -f "$tmp/injected"
out=$(cd "$repo" && ORCA_CLI_COMMAND="touch $tmp/injected" bash "$BIN/orca-child.sh" fix/x 2>&1)
if [ ! -e "$tmp/injected" ]; then ok; else ng "ORCA_CLI_COMMAND を空白で分けた: $out"; fi

# orca が失敗したら、その終了コードで終わる
rm -rf "${children:?}"/*
out=$(cd "$repo" && FAKE_ORCA_RC=3 bash "$BIN/orca-child.sh" fix/x origin/main "$briefs/brief.md" 2>&1)
rc=$?
if [ "$rc" -eq 3 ]; then ok; else ng "orca の失敗（rc=$rc）: $out"; fi

# orca の答えから子ワークツリーの場所が1つに決まらないときは、写さずに失敗で終わる（作ったことは伝える）
for o in '{"ok":true}' "{\"a\":\"$children/x\",\"b\":\"$tmp/other/x\"}" "{\"path\":\"$tmp/none/x\"}"; do
  rm -rf "${children:?}"/*
  out=$(cd "$repo" && FAKE_ORCA_OUT="$o" bash "$BIN/orca-child.sh" fix/x origin/main "$briefs/brief.md" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && [ ! -e "$children/x/.claude/briefs/x.md" ]; then ok; else ng "子ワークツリーの場所が決まらない $o（rc=$rc）: $out"; fi
done

# 子ワークツリーの .claude/briefs がリンクで外を指していたら、写さない
rm -rf "${children:?}"/*
mkdir -p "$children/x/.claude" "$tmp/outside"
: >"$children/x/.git"
ln -s "$tmp/outside" "$children/x/.claude/briefs"
out=$(cd "$repo" && FAKE_ORCA_OUT="{\"path\":\"$children/x\"}" bash "$BIN/orca-child.sh" fix/x origin/main "$briefs/brief.md" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && [ -z "$(ls -A "$tmp/outside")" ]; then ok; else ng "子ワークツリーのリンクの先に写した（rc=$rc）: $out"; fi
# 写す先のファイルがリンクで外を指していたら、写さない
rm -rf "${children:?}"/*
mkdir -p "$children/x/.claude/briefs"
: >"$children/x/.git"
: >"$tmp/outside-file"
ln -s "$tmp/outside-file" "$children/x/.claude/briefs/x.md"
out=$(cd "$repo" && FAKE_ORCA_OUT="{\"path\":\"$children/x\"}" bash "$BIN/orca-child.sh" fix/x origin/main "$briefs/brief.md" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && [ ! -s "$tmp/outside-file" ]; then ok; else ng "写す先のリンクの先に書いた（rc=$rc）: $out"; fi

# 引数の数
rejected "引数なし"
rejected "引数が多すぎる" fix/x origin/main "$briefs/brief.md" extra

# ブランチは fix/*・feature/*・test/* の、/ を1つだけ含む名前
rejected "main" main
rejected "release/*" release/v0.11.1
rejected "chore/*" chore/x
rejected "fix/ だけ" fix/
rejected "fix のみ" fix
rejected "/ を2つ" fix/a/b
rejected "- で始まる名前" fix/-x
rejected "オプションの形" --help
rejected ".. を含む" fix/a..b
rejected ". で始まる名前" fix/.x
rejected ".lock で終わる" fix/x.lock
rejected ". で終わる" fix/x.
rejected "空白を含む" "fix/a b"
rejected "改行を含む" "fix/a
b"
rejected "; を含む" "fix/a;b"
rejected "全角を含む" "fix/あ"

# 元のブランチは origin/main・origin/release/vX.Y.Z だけ
rejected "main（origin なし）" fix/x main
rejected "origin/feature" fix/x origin/feature/x
rejected "版が足りない" fix/x origin/release/v1.2
rejected "版の後ろに文字" fix/x "origin/release/v0.11.1;x"
rejected "v なし" fix/x origin/release/0.11.1
rejected "空の元のブランチ" fix/x ""
rejected "オプションの形の元のブランチ" fix/x --json

# 依頼文のファイルは、呼び出すワークツリーの .claude/briefs/ か、スクラッチパッドの中の、普通のファイルだけ
printf '依頼\n' >"$tmp/brief.md"
rejected "決めた場所の外" fix/x origin/main "$tmp/brief.md"
mkdir -p /tmp/claude
tmpclaude=$(mktemp -d /tmp/claude/orca-child-test.XXXXXX) || exit 1
printf '依頼\n' >"$tmpclaude/brief.md"
rejected "/tmp/claude（再起動で消える）" fix/x origin/main "$tmpclaude/brief.md"
rm -rf "$tmpclaude"
printf '依頼\n' >"$repo/brief.md"
rejected "ワークツリーの中でも .claude/briefs の外" fix/x origin/main "$repo/brief.md"
mkdir -p "$repo/.claude"
printf '依頼\n' >"$repo/.claude/brief.md"
rejected ".claude の直下" fix/x origin/main "$repo/.claude/brief.md"
rejected "ない依頼文" fix/x origin/main "$briefs/none.md"
rejected "フォルダ" fix/x origin/main "$briefs"
rejected ".. で外に出る" fix/x origin/main "$briefs/../../brief.md"
ln -s "$tmp/brief.md" "$briefs/link.md"
rejected "外を指すシンボリックリンク" fix/x origin/main "$briefs/link.md"
ln -s "$briefs/brief.md" "$briefs/inner-link.md"
rejected "中を指すシンボリックリンク" fix/x origin/main "$briefs/inner-link.md"
ln "$tmp/brief.md" "$briefs/hard.md"
rejected "外のファイルのハードリンク" fix/x origin/main "$briefs/hard.md"
: >"$briefs/empty.md"
rejected "空の依頼文" fix/x origin/main "$briefs/empty.md"
mkdir -p "$scratch_top/notscratch"
printf '依頼\n' >"$scratch_top/notscratch/brief.md"
rejected "スクラッチパッドでない /tmp/claude-<uid>" fix/x origin/main "$scratch_top/notscratch/brief.md"
# uid の違うスクラッチパッドの形（Claude Code のサンドボックスの中では /tmp の直下に作れないため、作れたときだけ確かめる。CI では作れる）
other="/tmp/claude-$(id -u)-orca-child-test-$$"
if mkdir -p "$other/a/b/scratchpad" 2>/dev/null; then
  printf '依頼\n' >"$other/a/b/scratchpad/brief.md"
  rejected "uid の違うスクラッチパッド" fix/x origin/main "$other/a/b/scratchpad/brief.md"
  rm -rf "$other"
else
  echo "SKIP: uid の違うスクラッチパッド（$other を作れない）"
fi

# 呼び出すワークツリーの .claude/briefs そのものが、リンクで外を指していたら断る
mv "$briefs" "$tmp/briefs.real"
mkdir -p "$tmp/elsewhere"
printf '依頼\n' >"$tmp/elsewhere/brief.md"
ln -s "$tmp/elsewhere" "$briefs"
rejected ".claude/briefs が外を指すリンク" fix/x origin/main "$briefs/brief.md"
rm "$briefs"
# .claude が外を指すリンクでも断る
mv "$repo/.claude" "$tmp/dotclaude.real"
mkdir -p "$tmp/elsewhere2/briefs"
printf '依頼\n' >"$tmp/elsewhere2/briefs/brief.md"
ln -s "$tmp/elsewhere2" "$repo/.claude"
rejected ".claude が外を指すリンク" fix/x origin/main "$repo/.claude/briefs/brief.md"
rm "$repo/.claude"
mv "$tmp/dotclaude.real" "$repo/.claude"
mv "$tmp/briefs.real" "$briefs"

# リポジトリの外（git のワークツリーでない場所）からは、.claude/briefs の依頼文を受け付けない
out=$(cd "$tmp" && bash "$BIN/orca-child.sh" fix/x origin/main "$briefs/brief.md" 2>&1)
rc=$?
if [ "$rc" -eq 1 ]; then ok; else ng "ワークツリーの外から（rc=$rc）: $out"; fi

# .env* の名前のファイル・フォルダの中のものは、中を読まずに名前で断る
# （サンドボックスの中では .env* を消せないため、ファイルは作らず、断った理由が .env であることを確かめる）
for p in "$briefs/.env.local" "$briefs/.env.d/brief.md" "$briefs/.env"; do
  run fix/x origin/main "$p"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '\.env' && [ ! -e "$tmp/orca-called" ]; then ok; else ng ".env の名前 $p（rc=$rc）: $out"; fi
done

# 秘密の情報の形を含む依頼文は断る（github.sh と同じ形）
k_anthropic="sk-ant""-api03-$(printf 'a%.0s' $(seq 1 40))"
k_aws="AKIA""ABCDEFGHIJKLMNOP"
k_gh="ghp""_$(printf 'a%.0s' $(seq 1 36))"
k_pem="-----BEGIN RSA ""PRIVATE KEY-----"
i=0
for k in "$k_anthropic" "$k_aws" "$k_gh" "$k_pem"; do
  i=$((i + 1))
  printf '依頼\n鍵: %s\n' "$k" >"$briefs/secret$i.md"
  rejected "秘密の情報の形 $i" fix/x origin/main "$briefs/secret$i.md"
done

# 呼び出すリポジトリの git の設定に、認めていない項目（外でコマンドを動かせるもの）があれば断る
git -C "$repo" config core.fsmonitor "touch $tmp/fsmonitor-ran"
rejected "認めていない git の設定" fix/x origin/main "$briefs/brief.md"
git -C "$repo" config --unset core.fsmonitor

# 秘密の情報の形は github.sh の SECRET_RE と同じにする（片方だけ直して、ずれないように）
want=$(grep -E "^SECRET_RE=" "$TEAM/bin/github.sh")
got=$(grep -E "^SECRET_RE=" "$BIN/orca-child.sh" 2>/dev/null)
if [ -n "$want" ] && [ "$got" = "$want" ]; then ok; else ng "SECRET_RE が github.sh と違う: $got"; fi

# Claude Code が自分で orca を動かせるようにはしない（サンドボックスの外で動かすものに入れない）
if ! grep -q 'orca-child' "$TEAM/managed-settings.json"; then ok; else ng "managed-settings.json に orca-child がある"; fi

# 依頼文の置き場所は git に入れない
root_ignore="$TEAM/../../.gitignore"
if grep -qxF '.claude/briefs/' "$root_ignore"; then ok; else ng ".gitignore に .claude/briefs/ がない"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
