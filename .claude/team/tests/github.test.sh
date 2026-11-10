#!/bin/bash
# github.sh のテスト（bash .claude/team/tests/github.test.sh）
# インストール先と同じ形（<prefix>/bin・<prefix>/etc）に一時的に置き、一時リポジトリ・push 先の bare リポジトリ・
# gh の代わりのスクリプト・hook を書いた設定を作って、決めた形だけを実行し、書き込む操作の前に確認を流すことを確かめる
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

# macOS の mktemp -d は TMPDIR を見ないため、場所を指定する（サンドボックスで書ける場所）
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/github-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
remote="$tmp/remote.git"
outside="$tmp/outside"
prefix="$tmp/prefix"
mkdir -p "$repo/.claude" "$outside" "$tmp/bin" "$tmp/cfg" "$prefix/etc"
cp -R "$SRC/bin" "$prefix/bin"
SCRIPT="$prefix/bin/github.sh"
# 送ってよいリポジトリの一覧
printf '# コメント\n\nme/repo\n' >"$prefix/etc/github-repos"

# origin は GitHub の URL にし、ユーザーの git の設定（insteadOf）で手元の bare リポジトリに向ける
export GIT_CONFIG_GLOBAL="$tmp/gitconfig"
git config --global url."$remote".insteadOf https://github.com/me/repo.git
git init -q --bare "$remote"
git -C "$repo" init -q -b main
touch "$repo/a"
git -C "$repo" add -A
git -C "$repo" commit -q -m init
git -C "$repo" remote add origin https://github.com/me/repo.git
git -C "$repo" tag v1
git -C "$repo" branch fix/a

# gh の代わり: 引数を1行に1つずつ記録する
cat >"$tmp/bin/gh" <<EOF
#!/bin/bash
printf '%s\n' "\$@" >"$tmp/gh-args"
echo fake-gh
EOF
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"

# 同じフォルダの確認（cr-gate-push.sh・tdd-push-gate.sh・cr-limit-gate.sh）の代わり:
# 受け取ったコマンドと CLAUDE_PROJECT_DIR を記録する。cr-gate-push.sh は DENYME で JSON の deny、
# tdd-push-gate.sh は TDDDENY で exit 2、cr-limit-gate.sh は LIMITDENY で JSON の deny を返す
fake_check() { # <名前> <止める文字> <止め方（json / exit2）>
  cat >"$prefix/bin/$1" <<EOF
#!/bin/bash
c=\$(jq -r '.tool_input.command')
printf '%s\n' "\$c" >>"$tmp/check-log-$1"
printf '%s\n' "\$CLAUDE_PROJECT_DIR" >>"$tmp/project-log"
case "\$c" in
  *$2*)
    if [ "$3" = json ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$1-denied"}}'
    else
      echo '$1-denied' >&2
      exit 2
    fi ;;
esac
exit 0
EOF
  chmod +x "$prefix/bin/$1"
}
fake_check cr-gate-push.sh DENYME json
fake_check tdd-push-gate.sh TDDDENY exit2
fake_check cr-limit-gate.sh LIMITDENY json
# リポジトリの設定の hook は、信頼したフォルダのものでも流さない（作業ツリーのファイルを外で動かさないため）
cat >"$tmp/repo-hook.sh" <<EOF
#!/bin/bash
cat >/dev/null
echo ran >>"$tmp/repo-hook-log"
EOF
chmod +x "$tmp/repo-hook.sh"
jq -n --arg r "$tmp/repo-hook.sh" '{hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", command: $r}]}]}}' \
  >"$repo/.claude/settings.json"
export CLAUDE_CONFIG_DIR="$tmp/cfg"
jq -n --arg r "$repo" '{projects: {($r): {hasTrustDialogAccepted: true}}}' >"$tmp/cfg/.claude.json"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }
reset_logs() { rm -f "$tmp/gh-args" "$tmp"/check-log-* "$tmp/project-log" "$tmp/repo-hook-log"; }
# run <引数...>: repo で github.sh を実行し、終了コードを rc、出力を out に入れる
run() { reset_logs; out=$(cd "$repo" && bash "$SCRIPT" "$@" 2>&1); rc=$?; }
checked() { ls "$tmp"/check-log-* >/dev/null 2>&1; }
# rejected <説明> <引数...>: github.sh のエラー（1）で断られ、理由を出し、gh を呼ばず、確認も流さない
# （スクリプトがない・構文エラーなどで失敗したときに通らないよう、終了コードと「github.sh:」で見分ける）
rejected() {
  local name=$1; shift
  run "$@"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q '^github.sh: ' && [ ! -e "$tmp/gh-args" ] && ! checked; then ok; else ng "$name（rc=$rc）: $out"; fi
}
remote_head() { git -C "$remote" rev-parse --verify -q "refs/heads/$1"; }
gh_args() { tr '\n' ' ' <"$tmp/gh-args" 2>/dev/null | sed 's/ $//'; }
# 確認に渡したコマンド（3つの確認に同じものを渡す）
gate_log() { cat "$tmp/check-log-cr-gate-push.sh" 2>/dev/null; }
same_to_all_checks() {
  [ -n "$(gate_log)" ] && [ "$(cat "$tmp/check-log-tdd-push-gate.sh" 2>/dev/null)" = "$(gate_log)" ] &&
    [ "$(cat "$tmp/check-log-cr-limit-gate.sh" 2>/dev/null)" = "$(gate_log)" ]
}

# --- 決めていない操作は断る
rejected "引数なし"
rejected "知らない操作" status
rejected "gh の決めていない操作" pr merge 1
rejected "gh pr ready（Ready はユーザーが変える）" pr ready 1
rejected "gh の決めていない種類" repo delete x

# --- push
run push origin fix/a
if [ "$rc" -eq 0 ] && [ "$(remote_head fix/a)" = "$(git -C "$repo" rev-parse HEAD)" ]; then ok; else ng "push origin fix/a（rc=$rc）: $out"; fi
if [ "$(gate_log)" = "git push origin fix/a" ] && same_to_all_checks; then ok; else ng "push で3つの確認に渡すコマンド: $(gate_log)"; fi
if [ "$(sort -u "$tmp/project-log" 2>/dev/null)" = "$repo" ]; then ok; else ng "確認の CLAUDE_PROJECT_DIR: $(cat "$tmp/project-log" 2>/dev/null)"; fi
if [ ! -e "$tmp/repo-hook-log" ]; then ok; else ng "リポジトリの設定の hook を流した"; fi

run push -u origin HEAD:refs/heads/feature/x
if [ "$rc" -eq 0 ] && [ -n "$(remote_head feature/x)" ]; then ok; else ng "push -u origin HEAD:refs/heads/feature/x（rc=$rc）: $out"; fi
run push origin HEAD:test/y
if [ "$rc" -eq 0 ] && [ -n "$(remote_head test/y)" ]; then ok; else ng "push origin HEAD:test/y（rc=$rc）: $out"; fi

# 送ってよいブランチは fix/*・feature/*・test/* だけ
rejected "main への push" push origin main
rejected "main への push（refs/heads）" push origin HEAD:refs/heads/main
rejected "release/* への push" push origin HEAD:refs/heads/release/v9.9.9
rejected "名前のないブランチ（fix/）" push origin HEAD:refs/heads/fix/
rejected "HEAD（今のブランチが main）" push origin HEAD
rejected "送るものを指定しない" push origin
git -C "$repo" switch -q fix/a
run push origin HEAD
if [ "$rc" -eq 0 ]; then ok; else ng "HEAD（今のブランチが fix/a）（rc=$rc）: $out"; fi
git -C "$repo" switch -q main

rejected "--force" push --force origin fix/a
rejected "-f" push -f origin fix/a
rejected "--force-with-lease" push --force-with-lease origin fix/a
rejected "+refspec" push origin +fix/a
rejected "+refspec（src:dst）" push origin +HEAD:refs/heads/fix/a
rejected "削除（:branch）" push origin :fix/a
rejected "--delete" push --delete origin fix/a
rejected "--tags" push --tags origin
rejected "タグを送る（名前だけ）" push origin v1
rejected "タグを送る（refs/tags）" push origin HEAD:refs/tags/v2
rejected "--receive-pack" push --receive-pack=x origin fix/a
rejected "-o" push -o ci.skip origin fix/a
rejected "登録していないリモート" push "$remote" fix/a
rejected "リモートなし" push
rejected "ブランチ名の前の -" push origin -- fix/a

# 送り元は今の HEAD と同じコミットだけ（確かめるのは HEAD のため、ほかのコミットを送らせない）
git -C "$repo" switch -q -c fix/other
git -C "$repo" commit -q --allow-empty -m "別のコミット"
other_sha=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" switch -q main
rejected "HEAD と違うブランチを送る" push origin fix/other
rejected "HEAD と違うブランチを、送り先を書いて送る" push origin fix/other:refs/heads/fix/other
rejected "HEAD と違うコミットを SHA で送る" push origin "$other_sha:refs/heads/fix/x"
rejected "送り元がない" push origin nothing:refs/heads/fix/x
git -C "$repo" branch -q -D fix/other

# 送り先は、一覧に書いた GitHub のリポジトリだけ
git -C "$repo" remote add evil https://example.com/x.git
git -C "$repo" remote add someone https://github.com/someone/repo.git
rejected "GitHub 以外のリモートへの push" push evil fix/a
rejected "一覧にないリポジトリへの push" push someone fix/a
rejected "GitHub 以外のリモートからの fetch" fetch evil
git -C "$repo" config remote.origin.pushurl https://example.com/x.git
rejected "pushurl が GitHub 以外" push origin fix/a
git -C "$repo" config remote.origin.pushurl https://github.com/someone/repo.git
rejected "pushurl が一覧にない GitHub のリポジトリ" push origin fix/a
git -C "$repo" config --unset remote.origin.pushurl
mv "$prefix/etc/github-repos" "$prefix/etc/github-repos.bak"
rejected "一覧のファイルがない" push origin fix/a
mv "$prefix/etc/github-repos.bak" "$prefix/etc/github-repos"

# リポジトリの git の設定は、決めた項目だけ（コマンドを動かす設定・URL の書き換えなどがあれば断る）
for kv in "core.sshCommand=touch $tmp/pwned" "core.fsmonitor=touch $tmp/pwned" "url.https://example.com/.insteadOf=https://github.com/" \
  "credential.helper=!touch $tmp/pwned" "include.path=$tmp/x" "alias.push=!touch $tmp/pwned"; do
  git -C "$repo" config "${kv%%=*}" "${kv#*=}"
  rejected "リポジトリの設定 ${kv%%=*}（push）" push origin fix/a
  rejected "リポジトリの設定 ${kv%%=*}（pr view）" pr view 12
  git -C "$repo" config --unset "${kv%%=*}"
done
# 作業ツリーのない場所（.git の中）でも、リポジトリの設定を確かめる
git -C "$repo" config core.fsmonitor "touch $tmp/pwned"
reset_logs
out=$(cd "$repo/.git" && bash "$SCRIPT" pr view 12 2>&1)
rc=$?
if [ "$rc" -eq 1 ] && [ ! -e "$tmp/gh-args" ]; then ok; else ng ".git の中での pr view（rc=$rc）: $out"; fi
git -C "$repo" config --unset core.fsmonitor
if [ ! -e "$tmp/pwned" ]; then ok; else ng "リポジトリの設定のコマンドが動いた"; fi

# git のフック（.git/hooks）は動かさない
printf '#!/bin/sh\ntouch %s/pre-push-ran\n' "$tmp" >"$repo/.git/hooks/pre-push"
chmod +x "$repo/.git/hooks/pre-push"
run push origin fix/a
if [ "$rc" -eq 0 ] && [ ! -e "$tmp/pre-push-ran" ]; then ok; else ng "git のフックが動いた（rc=$rc）: $out"; fi
rm -f "$repo/.git/hooks/pre-push"

# 確認が止めたら push しない（JSON の deny・exit 2 のどちらでも）
for b in DENYME TDDDENY LIMITDENY; do
  git -C "$repo" branch "fix/$b"
  run push origin "fix/$b"
  if [ "$rc" -eq 2 ] && [ -z "$(remote_head "fix/$b")" ] && printf '%s' "$out" | grep -q -- '-denied'; then ok; else ng "確認が止めた push（fix/$b、rc=$rc）: $out"; fi
done

# 確認のスクリプトが 0・2 以外で終わったとき（落ちた・ない・実行できない）も、push しない
git -C "$repo" branch fix/broken
printf '#!/bin/bash\ncat >/dev/null\necho broken >&2\nexit 1\n' >"$prefix/bin/cr-limit-gate.sh"
run push origin fix/broken
if [ "$rc" -eq 2 ] && [ -z "$(remote_head fix/broken)" ]; then ok; else ng "確認が 1 で終わった push（rc=$rc）: $out"; fi
rm -f "$prefix/bin/cr-limit-gate.sh"
run push origin fix/broken
if [ "$rc" -eq 2 ] && [ -z "$(remote_head fix/broken)" ]; then ok; else ng "確認のスクリプトがない push（rc=$rc）: $out"; fi
fake_check cr-limit-gate.sh LIMITDENY json

# --skip は、確認に NAME=1 を付けたコマンドとして渡す
for s in SKIP_CR_LOOP SKIP_TDD_CHECK SKIP_CR_LIMIT; do
  run --skip "$s" push origin fix/a
  if [ "$rc" -eq 0 ] && [ "$(gate_log)" = "$s=1 git push origin fix/a" ] && same_to_all_checks; then ok; else ng "--skip $s（rc=$rc）: $(gate_log) $out"; fi
done
rejected "知らない --skip" --skip FOO push origin fix/a

# worktree でも、確認は同じフォルダ（インストール先）のものだけを流し、worktree の設定の hook は流さない
git -C "$repo" worktree add -q "$tmp/wt" -b fix/wt
mkdir -p "$tmp/wt/.claude"
cp "$repo/.claude/settings.json" "$tmp/wt/.claude/settings.json"
reset_logs
out=$(cd "$tmp/wt" && bash "$SCRIPT" push origin fix/wt 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$tmp/repo-hook-log" ] && [ -n "$(gate_log)" ]; then ok; else ng "worktree の push（rc=$rc）: $out"; fi

# --- fetch（読むだけなので確認は流さない。git のフックも動かさない）
printf '#!/bin/sh\ntouch %s/ref-hook-ran\n' "$tmp" >"$repo/.git/hooks/reference-transaction"
chmod +x "$repo/.git/hooks/reference-transaction"
git -C "$remote" update-ref refs/heads/fix/new "$(git -C "$repo" rev-parse HEAD)"
run fetch origin
if [ "$rc" -eq 0 ] && ! checked && [ ! -e "$tmp/ref-hook-ran" ]; then ok; else ng "fetch origin（rc=$rc）: $out"; fi
rm -f "$repo/.git/hooks/reference-transaction"
rejected "fetch --upload-pack" fetch --upload-pack=x origin
rejected "fetch（リモートなし）" fetch
# . で始まる名前のリポジトリ（owner/.github など）は、GitHub のリポジトリとして使える
git config --global url."$remote".insteadOf https://github.com/me/.github.git
git -C "$repo" remote add dotgithub https://github.com/me/.github.git
run fetch dotgithub
if [ "$rc" -eq 0 ]; then ok; else ng "fetch（me/.github）（rc=$rc）: $out"; fi
git -C "$repo" remote remove dotgithub

# サブモジュール（入れ子のリポジトリ）の設定でも、外のコマンドを動かさない
sub="$tmp/subsrc"
git init -q -b main "$sub"
git -C "$sub" commit -q --allow-empty -m sub
git -C "$repo" -c protocol.file.allow=always submodule --quiet add "$sub" sub 2>/dev/null
git -C "$repo" commit -q -m "サブモジュール"
rejected "サブモジュールの設定がある（submodule.*）" push origin fix/a
git -C "$repo" config --remove-section submodule.sub 2>/dev/null
git -C "$repo/sub" config core.fsmonitor "touch $tmp/sub-pwned"
touch "$repo/sub/dirty"
# 対照: 守りがなければ、git status でサブモジュールの core.fsmonitor が動く（この準備で確かめられていること）
( cd "$repo" && git status --porcelain >/dev/null 2>&1 )
if [ -e "$tmp/sub-pwned" ]; then ok; else ng "対照: 守りがないときに、サブモジュールの core.fsmonitor が動かない（この準備では確かめられない）"; fi
rm -f "$tmp/sub-pwned"
( cd "$repo" && GIT_CONFIG_COUNT=0 bash -c ". '$prefix/bin/lib/git-safety.sh'; git status --porcelain >/dev/null" )
if [ ! -e "$tmp/sub-pwned" ]; then ok; else ng "git-safety.sh を読んだ後の git status で、サブモジュールの core.fsmonitor が動いた"; fi
git -C "$repo" rm -q --cached sub
rm -rf "$repo/sub" "$repo/.gitmodules"
git -C "$repo" commit -q -am "サブモジュールを外す"

# --- gh の読むだけの操作は、そのまま渡す（確認は流さない）
run pr view 12 --json state -q .state
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr view 12 --json state -q .state" ] && ! checked; then ok; else ng "pr view（rc=$rc）: $(gh_args)"; fi
run pr checks 12
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr checks 12" ]; then ok; else ng "pr checks: $(gh_args)"; fi
run run list --limit 3
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "run list --limit 3" ]; then ok; else ng "run list: $(gh_args)"; fi
run api repos/o/r/pulls/12/comments --paginate --jq '.[].body'
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "api repos/o/r/pulls/12/comments --paginate --jq .[].body" ]; then ok; else ng "api（GET）: $(gh_args)"; fi
# ブラウザを開く --web は、どの書き方でも断る
rejected "pr view --web" pr view 12 --web
rejected "pr view --web=true" pr view 12 --web=true
rejected "pr view -w" pr view 12 -w
rejected "pr view -cw（短いオプションをまとめた形）" pr view 12 -cw
rejected "run view --web" run view 5 --web
rejected "api -X" api -X DELETE repos/o/r
rejected "api --method" api --method=POST repos/o/r
rejected "api -f" api repos/o/r/issues -f title=x
rejected "api --input" api repos/o/r --input f
rejected "api のパスなし" api --paginate
rejected "api に URL" api https://example.com/x
rejected "api の graphql" api graphql
rejected "api の repos 以外" api user/emails
rejected "api のパスに .." api repos/../user

# --- PR を作る（Draft だけ）。本文のファイルは、確かめた後に中身を読み、--body で渡す
printf 'body @coderabbitai\n' >"$repo/body.md"
run pr create --draft --base main --title "t 1" --body-file body.md
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr create --draft --base main --title t 1 --body body @coderabbitai --repo me/repo" ]; then ok; else ng "pr create --draft（rc=$rc）: $(gh_args) $out"; fi
if [ "$(gate_log)" = "gh pr create --draft --base main --title 't 1' --body 'body @coderabbitai' --repo me/repo" ] && same_to_all_checks; then ok; else ng "pr create で確認に渡すコマンド: $(gate_log)"; fi
run pr create --draft --title t --body-file=body.md
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr create --draft --title t --body body @coderabbitai --repo me/repo" ]; then ok; else ng "pr create --body-file=（rc=$rc）: $(gh_args) $out"; fi
rejected "pr create（--draft なし）" pr create --base main --title t --body x
rejected "pr create（--draft がタイトルの中だけ）" pr create --title "a --draft b" --body x
rejected "pr create（--draft がタイトルの値）" pr create --title --draft --body x
rejected "pr create --web" pr create --draft --web
rejected "pr create の知らないオプション" pr create --draft --repo o/r
echo secret >"$outside/x"
rejected "pr create（本文のファイルがリポジトリの外）" pr create --draft --title t --body-file "$outside/x"
ln -s "$outside/x" "$repo/link.md"
rejected "pr create（本文のファイルが外へのリンク）" pr create --draft --title t --body-file link.md
ln "$outside/x" "$repo/hard.md"
rejected "pr create（本文のファイルが外のファイルのハードリンク）" pr create --draft --title t --body-file hard.md
rm -f "$repo/link.md" "$repo/hard.md"
rejected "pr create（本文のファイルが標準入力）" pr create --draft --title t --body-file -
rejected "pr create（本文のファイルがない）" pr create --draft --title t --body-file none.md
# サンドボックスの中から読めないファイル（managed settings の Read の deny にある .env*）は、リポジトリの中でも本文にしない
printf 'SECRET=1\n' >"$repo/.env.local"
rejected "pr create（本文のファイルが .env*）" pr create --draft --title t --body-file .env.local
rm -f "$repo/.env.local"
# ホームのフォルダそのものがリポジトリでも、managed settings の Read の deny にある場所（~/.aws など）は本文にしない
mkdir -p "$repo/.aws" "$repo/.ssh"
printf 'secret\n' >"$repo/.aws/credentials"
printf 'secret\n' >"$repo/.ssh/id_ed25519"
for secret in .aws/credentials .ssh/id_ed25519; do
  reset_logs
  out=$(cd "$repo" && HOME="$repo" bash "$SCRIPT" pr comment 12 --body-file "$secret" 2>&1)
  rc=$?
  if [ "$rc" -eq 1 ] && [ ! -e "$tmp/gh-args" ] && ! checked; then ok; else ng "ホームがリポジトリのときの本文 $secret（rc=$rc）: $out"; fi
done
rm -rf "$repo/.aws" "$repo/.ssh"
# スクラッチパッドの本文は使える（macOS のスクラッチパッドの場所に作れるときだけ確かめる）
scratch="/private/tmp/claude-$(id -u)/github-test-$$/s/scratchpad"
if mkdir -p "$scratch" 2>/dev/null; then
  printf 'from scratchpad\n' >"$scratch/b.md"
  run pr create --draft --title t --body-file "$scratch/b.md"
  if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr create --draft --title t --body from scratchpad --repo me/repo" ]; then ok; else ng "pr create（スクラッチパッドの本文）（rc=$rc）: $(gh_args) $out"; fi
  rm -rf "/private/tmp/claude-$(id -u)/github-test-$$"
fi
run pr create --draft --title DENYME --body x
if [ "$rc" -eq 2 ] && [ ! -e "$tmp/gh-args" ]; then ok; else ng "確認が止めた pr create（rc=$rc）: $out"; fi
git -C "$repo" remote set-url origin https://github.com/someone/repo.git
rejected "pr create（origin が一覧にないリポジトリ）" pr create --draft --title t --body x
git -C "$repo" remote set-url origin https://github.com/me/repo.git

# --- PR の本文・タイトルを変える・コメント・閉じる
run pr edit 12 --body-file body.md --add-label no-tdd
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr edit 12 --body body @coderabbitai --add-label no-tdd --repo me/repo" ]; then ok; else ng "pr edit（rc=$rc）: $(gh_args) $out"; fi
rejected "pr edit の番号が数字でない" pr edit abc --title t
rejected "pr edit --add-reviewer" pr edit 12 --add-reviewer someone
run pr comment 12 --body-file body.md
if [ "$rc" -eq 0 ] && [ "$(gate_log)" = "gh pr comment 12 --body 'body @coderabbitai' --repo me/repo" ]; then ok; else ng "pr comment で確認に渡すコマンド（rc=$rc）: $(gate_log) $out"; fi
rejected "pr comment（本文なし）" pr comment 12
rejected "pr comment --edit-last" pr comment 12 --edit-last --body x
rejected "pr comment に空の引数" pr comment 12 --body x ""
# 本文に改行・' ・「git push」の文字があっても、確認に渡すコマンドを push と読み違えない
printf "Don't merge yet\n; git push origin x\n(git push) \$(git push)\n" >"$repo/tricky.md"
run pr comment 12 --body-file tricky.md
if [ "$rc" -eq 0 ] && [ -n "$(gate_log)" ]; then ok; else ng "改行・' のある本文の pr comment（rc=$rc）: $out"; fi
if ! gate_log | node "$prefix/bin/lib/is-git-push.mjs"; then ok; else ng "確認に渡すコマンドを push と読んだ（is-git-push.mjs）: $(gate_log)"; fi
if [ -z "$(gate_log | node "$prefix/bin/lib/git-push-segments.mjs" SKIP_CR_LOOP)" ]; then ok; else ng "確認に渡すコマンドを push と読んだ（git-push-segments.mjs）: $(gate_log)"; fi
rm -f "$repo/tricky.md"

# 本文のファイルを、確かめた後・開く前に、外のファイルへのリンクに差し替えても送らない
# （realpath の代わりに、確かめた直後に差し替えるスクリプトを置いて、差し替えを起こす）
real_realpath=$(PATH="${PATH#"$tmp/bin:"}" command -v realpath)
printf 'swap\n' >"$repo/swap.md"
touch "$tmp/swap-once"
cat >"$tmp/bin/realpath" <<EOF
#!/bin/bash
out=\$("$real_realpath" "\$@") || exit 1
printf '%s\n' "\$out"
if [ -e "$tmp/swap-once" ] && [ "\$out" = "$repo/swap.md" ]; then
  rm -f "$tmp/swap-once" "$repo/swap.md"
  ln -s "$outside/x" "$repo/swap.md"
fi
EOF
chmod +x "$tmp/bin/realpath"
rejected "本文のファイルを、確かめた後に外へのリンクに差し替える" pr comment 12 --body-file swap.md
rm -f "$tmp/bin/realpath" "$repo/swap.md" "$tmp/swap-once"
run pr close 12 --comment "閉じます"
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr close 12 --comment 閉じます --repo me/repo" ]; then ok; else ng "pr close（rc=$rc）: $(gh_args) $out"; fi
rejected "pr close --delete-branch" pr close 12 --delete-branch

# --- Issue（読む・コメントする・作る）
run issue view 7 --comments
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "issue view 7 --comments" ] && ! checked; then ok; else ng "issue view（rc=$rc）: $(gh_args) $out"; fi
rejected "issue view --web" issue view 7 --web
rejected "issue の決めていない操作" issue close 7
run issue comment 7 --body-file body.md
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "issue comment 7 --body body @coderabbitai --repo me/repo" ]; then ok; else ng "issue comment（rc=$rc）: $(gh_args) $out"; fi
rejected "issue comment（本文なし）" issue comment 7
rejected "issue comment の番号が数字でない" issue comment x --body y
run issue create --title "t" --body-file body.md --label bug
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "issue create --title t --body body @coderabbitai --label bug --repo me/repo" ]; then ok; else ng "issue create（rc=$rc）: $(gh_args) $out"; fi
rejected "issue create（本文のファイルがリポジトリの外）" issue create --title t --body-file "$outside/x"
rejected "issue create --assignee" issue create --title t --body x --assignee someone

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
