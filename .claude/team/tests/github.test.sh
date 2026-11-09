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

# 同じフォルダの cr-gate-push.sh の代わり: 受け取ったコマンドを記録し、DENYME を含めば JSON で止める
cat >"$prefix/bin/cr-gate-push.sh" <<EOF
#!/bin/bash
c=\$(jq -r '.tool_input.command')
printf '%s\n' "\$c" >>"$tmp/gate-log"
case "\$c" in *DENYME*) echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"gate-denied"}}' ;; esac
exit 0
EOF
# リポジトリの hook: CLAUDE_PROJECT_DIR を記録し、REPODENY を含めば exit 2 で止める
cat >"$tmp/repo-hook.sh" <<EOF
#!/bin/bash
c=\$(jq -r '.tool_input.command')
printf '%s\n' "\$CLAUDE_PROJECT_DIR" >>"$tmp/repo-hook-log"
case "\$c" in *REPODENY*) echo 'repo-hook-denied' >&2; exit 2 ;; esac
exit 0
EOF
# matcher が * の hook は流さない（通知などの hook のため）
cat >"$tmp/star-hook.sh" <<EOF
#!/bin/bash
cat >/dev/null
echo ran >>"$tmp/star-hook-log"
EOF
chmod +x "$prefix/bin/cr-gate-push.sh" "$tmp/repo-hook.sh" "$tmp/star-hook.sh"
jq -n --arg r "$tmp/repo-hook.sh" --arg s "$tmp/star-hook.sh" \
  '{hooks: {PreToolUse: [
    {matcher: "Bash", hooks: [{type: "command", command: ("\"$CLAUDE_PROJECT_DIR\"/../" + ($r | split("/") | last))}]},
    {matcher: "*", hooks: [{type: "command", command: $s}]}]}}' \
  >"$repo/.claude/settings.json"
export CLAUDE_CONFIG_DIR="$tmp/cfg"
# repo は信頼したフォルダ（Claude Code の .claude.json の hasTrustDialogAccepted）
jq -n --arg r "$repo" '{projects: {($r): {hasTrustDialogAccepted: true}}}' >"$tmp/cfg/.claude.json"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }
reset_logs() { rm -f "$tmp/gh-args" "$tmp/gate-log" "$tmp/repo-hook-log" "$tmp/star-hook-log"; }
# run <引数...>: repo で github.sh を実行し、終了コードを rc、出力を out に入れる
run() { reset_logs; out=$(cd "$repo" && bash "$SCRIPT" "$@" 2>&1); rc=$?; }
# rejected <説明> <引数...>: 断られ（0 以外）、gh を呼ばず、確認も流さない
rejected() {
  local name=$1; shift
  run "$@"
  if [ "$rc" -ne 0 ] && [ ! -e "$tmp/gh-args" ] && [ ! -e "$tmp/gate-log" ]; then ok; else ng "$name（rc=$rc）: $out"; fi
}
remote_head() { git -C "$remote" rev-parse --verify -q "refs/heads/$1"; }
gh_args() { tr '\n' ' ' <"$tmp/gh-args" 2>/dev/null | sed 's/ $//'; }
gate_log() { cat "$tmp/gate-log" 2>/dev/null; }

# --- 決めていない操作は断る
rejected "引数なし"
rejected "知らない操作" status
rejected "gh の決めていない操作" pr merge 1
rejected "gh pr ready（Ready はユーザーが変える）" pr ready 1
rejected "gh の決めていない種類" repo delete x

# --- push
run push origin fix/a
if [ "$rc" -eq 0 ] && [ "$(remote_head fix/a)" = "$(git -C "$repo" rev-parse HEAD)" ]; then ok; else ng "push origin fix/a（rc=$rc）: $out"; fi
if [ "$(gate_log)" = "git push origin fix/a" ]; then ok; else ng "push で cr-gate-push.sh に渡すコマンド: $(gate_log)"; fi
if [ "$(cat "$tmp/repo-hook-log" 2>/dev/null)" = "$repo" ]; then ok; else ng "リポジトリの hook の CLAUDE_PROJECT_DIR: $(cat "$tmp/repo-hook-log" 2>/dev/null)"; fi
if [ ! -e "$tmp/star-hook-log" ]; then ok; else ng "matcher が * の hook を流した"; fi

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

# 送り先は、一覧に書いた GitHub のリポジトリだけ
git -C "$repo" remote add evil https://example.com/x.git
git -C "$repo" remote add someone https://github.com/someone/repo.git
rejected "GitHub 以外のリモートへの push" push evil fix/a
rejected "一覧にないリポジトリへの push" push someone fix/a
rejected "GitHub 以外のリモートからの fetch" fetch evil
git -C "$repo" config remote.origin.pushurl https://example.com/x.git
rejected "pushurl が GitHub 以外" push origin fix/a
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
if [ ! -e "$tmp/pwned" ]; then ok; else ng "リポジトリの設定のコマンドが動いた"; fi

# git のフック（.git/hooks）は動かさない
printf '#!/bin/sh\ntouch %s/pre-push-ran\n' "$tmp" >"$repo/.git/hooks/pre-push"
chmod +x "$repo/.git/hooks/pre-push"
run push origin fix/a
if [ "$rc" -eq 0 ] && [ ! -e "$tmp/pre-push-ran" ]; then ok; else ng "git のフックが動いた（rc=$rc）: $out"; fi
rm -f "$repo/.git/hooks/pre-push"

# 確認が止めたら push しない
git -C "$repo" branch fix/DENYME
run push origin fix/DENYME
if [ "$rc" -eq 2 ] && [ -z "$(remote_head fix/DENYME)" ] && printf '%s' "$out" | grep -q 'gate-denied'; then ok; else ng "cr-gate-push.sh（JSON）が止めた push（rc=$rc）: $out"; fi
git -C "$repo" branch fix/REPODENY
run push origin fix/REPODENY
if [ "$rc" -eq 2 ] && [ -z "$(remote_head fix/REPODENY)" ] && printf '%s' "$out" | grep -q 'repo-hook-denied'; then ok; else ng "リポジトリの hook（exit 2）が止めた push（rc=$rc）: $out"; fi

# --skip は、確認に NAME=1 を付けたコマンドとして渡す
run --skip SKIP_CR_LOOP push origin fix/a
if [ "$rc" -eq 0 ] && [ "$(gate_log)" = "SKIP_CR_LOOP=1 git push origin fix/a" ]; then ok; else ng "--skip SKIP_CR_LOOP（rc=$rc）: $(gate_log) $out"; fi
rejected "知らない --skip" --skip FOO push origin fix/a

# リポジトリの hook は、信頼したフォルダのものだけ流す。worktree では、メインのフォルダの設定を使う
untrusted="$tmp/untrusted"
mkdir -p "$untrusted/.claude"
git -C "$untrusted" init -q -b main
git -C "$untrusted" commit -q --allow-empty -m init
git -C "$untrusted" branch fix/u
git -C "$untrusted" remote add origin https://github.com/me/repo.git
cp "$repo/.claude/settings.json" "$untrusted/.claude/settings.json"
reset_logs
out=$(cd "$untrusted" && bash "$SCRIPT" push --dry-run origin fix/u 2>&1)
rc=$?
if [ ! -e "$tmp/repo-hook-log" ] && [ -e "$tmp/gate-log" ]; then ok; else ng "信頼していないフォルダのリポジトリの hook を流した（rc=$rc）: $out"; fi
git -C "$repo" worktree add -q "$tmp/wt" -b fix/wt
mkdir -p "$tmp/wt/.claude"
jq -n --arg t "$tmp" '{hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", command: ("touch " + $t + "/wt-hook-ran")}]}]}}' >"$tmp/wt/.claude/settings.json"
reset_logs
out=$(cd "$tmp/wt" && bash "$SCRIPT" push origin fix/wt 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$tmp/wt-hook-ran" ] && [ "$(cat "$tmp/repo-hook-log" 2>/dev/null)" = "$repo" ]; then ok; else ng "worktree で、メインのフォルダの hook を流す（rc=$rc）: $out / $(cat "$tmp/repo-hook-log" 2>/dev/null)"; fi

# --- fetch（読むだけなので確認は流さない）
run fetch origin
if [ "$rc" -eq 0 ] && [ ! -e "$tmp/gate-log" ]; then ok; else ng "fetch origin（rc=$rc）: $out"; fi
rejected "fetch --upload-pack" fetch --upload-pack=x origin
rejected "fetch（リモートなし）" fetch

# --- gh の読むだけの操作は、そのまま渡す（確認は流さない）
run pr view 12 --json state -q .state
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr view 12 --json state -q .state" ] && [ ! -e "$tmp/gate-log" ]; then ok; else ng "pr view（rc=$rc）: $(gh_args)"; fi
run pr checks 12
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr checks 12" ]; then ok; else ng "pr checks: $(gh_args)"; fi
run run list --limit 3
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "run list --limit 3" ]; then ok; else ng "run list: $(gh_args)"; fi
run api repos/o/r/pulls/12/comments --paginate --jq '.[].body'
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "api repos/o/r/pulls/12/comments --paginate --jq .[].body" ]; then ok; else ng "api（GET）: $(gh_args)"; fi
rejected "pr view --web" pr view 12 --web
rejected "api -X" api -X DELETE repos/o/r
rejected "api --method" api --method=POST repos/o/r
rejected "api -f" api repos/o/r/issues -f title=x
rejected "api --input" api repos/o/r --input f
rejected "api のパスなし" api --paginate
rejected "api に URL" api https://example.com/x
rejected "api の graphql" api graphql
rejected "api の repos 以外" api user/emails

# --- PR を作る（Draft だけ）
printf 'body @coderabbitai\n' >"$repo/body.md"
run pr create --draft --base main --title "t 1" --body-file body.md
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr create --draft --base main --title t 1 --body-file body.md --repo me/repo" ]; then ok; else ng "pr create --draft（rc=$rc）: $(gh_args) $out"; fi
if [ "$(gate_log)" = "gh pr create --draft --base main --title t\\ 1 --body-file body.md --repo me/repo" ]; then ok; else ng "pr create で確認に渡すコマンド: $(gate_log)"; fi
rejected "pr create（--draft なし）" pr create --base main --title t --body x
rejected "pr create --web" pr create --draft --web
rejected "pr create の知らないオプション" pr create --draft --repo o/r
rejected "pr create（本文のファイルがリポジトリの外）" pr create --draft --title t --body-file "$outside/x"
ln -s /etc/hosts "$repo/link.md"
rejected "pr create（本文のファイルが外へのリンク）" pr create --draft --title t --body-file link.md
rejected "pr create（本文のファイルが標準入力）" pr create --draft --title t --body-file -
run pr create --draft --title DENYME --body x
if [ "$rc" -eq 2 ] && [ ! -e "$tmp/gh-args" ]; then ok; else ng "確認が止めた pr create（rc=$rc）: $out"; fi
git -C "$repo" remote set-url origin https://github.com/someone/repo.git
rejected "pr create（origin が一覧にないリポジトリ）" pr create --draft --title t --body x
git -C "$repo" remote set-url origin https://github.com/me/repo.git

# --- PR の本文・タイトルを変える・コメント・閉じる
run pr edit 12 --body-file body.md --add-label no-tdd
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr edit 12 --body-file body.md --add-label no-tdd --repo me/repo" ]; then ok; else ng "pr edit（rc=$rc）: $(gh_args) $out"; fi
rejected "pr edit の番号が数字でない" pr edit abc --title t
rejected "pr edit --add-reviewer" pr edit 12 --add-reviewer someone
run pr comment 12 --body-file body.md
if [ "$rc" -eq 0 ] && [ "$(gate_log)" = "gh pr comment 12 --body-file body.md --repo me/repo" ]; then ok; else ng "pr comment で確認に渡すコマンド（rc=$rc）: $(gate_log) $out"; fi
rejected "pr comment（本文なし）" pr comment 12
rejected "pr comment --edit-last" pr comment 12 --edit-last --body x
run pr close 12 --comment "閉じます"
if [ "$rc" -eq 0 ] && [ "$(gh_args)" = "pr close 12 --comment 閉じます --repo me/repo" ]; then ok; else ng "pr close（rc=$rc）: $(gh_args) $out"; fi
rejected "pr close --delete-branch" pr close 12 --delete-branch

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
