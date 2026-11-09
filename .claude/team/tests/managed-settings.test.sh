#!/bin/bash
# managed-settings.json とリポジトリの .claude/settings.json のテスト（bash .claude/team/tests/managed-settings.test.sh）
# サンドボックス・権限の守りを弱める変更や、サンドボックスの外で動かすものの書き間違いを止める
set -u
TEAM="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$TEAM/../.." && pwd)"
M="$TEAM/managed-settings.json"
P="$ROOT/.claude/settings.json"
PREFIX=/opt/claude-code-team/bin/

pass=0
fail=0
# expect <説明> <jq の式（true になること）> <ファイル>
expect() {
  if jq -e "$2" "$3" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  %s\n' "$1" "$2"
  fi
}

expect "managed-settings.json が JSON として読める" '.' "$M"

# サンドボックス
expect "サンドボックスを有効にする" '.sandbox.enabled == true' "$M"
expect "サンドボックスが使えないときは動かさない" '.sandbox.failIfUnavailable == true' "$M"
expect "サンドボックスの外でのやり直しを禁止する" '.sandbox.allowUnsandboxedCommands == false' "$M"
expect "通信先は managed settings の一覧だけ" '.sandbox.network.allowManagedDomainsOnly == true' "$M"
expect "github.com への通信を断る" '.sandbox.network.deniedDomains | index("github.com") != null' "$M"
expect "通信先の一覧に * を入れない" '[.sandbox.network.allowedDomains[] | select(test("\\*"))] | length == 0' "$M"
expect "通信先の一覧に GitHub を入れない" '[.sandbox.network.allowedDomains[] | select(test("github"))] | length == 0' "$M"
# 書き込める場所・通信の道を広げる設定を書かない（Unix ソケット・自前のプロキシ・弱いサンドボックス・ポート）
expect "sandbox.filesystem を書かない（書き込める場所・読めない場所は既定のまま）" '.sandbox.filesystem == null' "$M"
expect "Unix ソケットを許さない" '.sandbox.network.allowUnixSockets == null and .sandbox.network.allowAllUnixSockets == null' "$M"
expect "自前のプロキシを使わない" '.sandbox.network.httpProxyPort == null and .sandbox.network.socksProxyPort == null' "$M"
expect "ポートを開けない" '(.sandbox.network.allowLocalBinding // false) == false' "$M"
expect "弱いサンドボックスを使わない" '(.sandbox.enableWeakerNestedSandbox // false) == false and (.sandbox.enableWeakerNetworkIsolation // false) == false' "$M"
expect "サンドボックスの違反を無視しない" '.sandbox.ignoreViolations == null' "$M"
expect "managed settings で環境変数を設定しない" '.env == null' "$M"
# excludedCommands が、つないだコマンドの全部の一致を求めるのは 2.1.277 から。古い版では起動させない
expect "Claude Code 2.1.277 より前の版を起動させない" '(.requiredMinimumVersion // "0") | split(".") | map(tonumber) | . >= [2, 1, 277]' "$M"

# サンドボックスの外で動かすもの（excludedCommands・hook）は、インストール先（root の持ち物）のスクリプトの名前だけ。
# 後ろに ; や && などで別のコマンドを続けられないよう、コマンド全体を決まった形と比べる
EXCLUDED_OK='^/opt/claude-code-team/bin/[A-Za-z0-9_-]+\.sh( \*)?$'
HOOK_OK='^/opt/claude-code-team/bin/[A-Za-z0-9_-]+\.sh$'
# only_installed <JSON のファイル>: excludedCommands と hook が、決まった形だけか
only_installed() {
  jq -e --arg e "$EXCLUDED_OK" --arg h "$HOOK_OK" '
    (.sandbox.excludedCommands | length > 0 and all(test($e))) and
    ([.hooks[]?[]?.hooks[]?.command] | all(test($h)))' "$1" >/dev/null 2>&1
}
if only_installed "$M"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: excludedCommands・hook に、インストール先のスクリプトの名前以外がある"
fi
# 確かめ方そのものが、後ろに続けたコマンドや .. を止めること
bad_json="$(mktemp "${TMPDIR:-/tmp}/managed-bad.XXXXXX")"
for bad in '{"sandbox":{"excludedCommands":["/opt/claude-code-team/bin/github.sh *; curl x"]}}' \
  '{"sandbox":{"excludedCommands":["/opt/claude-code-team/bin/github.sh *"]},"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/opt/claude-code-team/bin/cr-limit-gate.sh ; curl x"}]}]}}' \
  '{"sandbox":{"excludedCommands":["/opt/claude-code-team/bin/../../tmp/x.sh *"]}}'; do
  printf '%s' "$bad" >"$bad_json"
  if only_installed "$bad_json"; then
    fail=$((fail + 1))
    printf 'FAIL: 止めるべき書き方を通した: %s\n' "$bad"
  else
    pass=$((pass + 1))
  fi
done
rm -f "$bad_json"
# インストール先のスクリプトの名前は、リポジトリの bin にあること（excludedCommands・hook の両方）
while IFS= read -r name; do
  if [ -f "$TEAM/bin/$name" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s が .claude/team/bin にない\n' "$name"
  fi
done < <(jq -r --arg p "$PREFIX" '[.sandbox.excludedCommands[], (.hooks[]?[]?.hooks[]?.command)] | .[] | select(startswith($p)) | ltrimstr($p) | split(" ")[0]' "$M" | sort -u)

# 権限
expect "bypassPermissions モードを使えなくする" '.permissions.disableBypassPermissionsMode == "disable"' "$M"
expect "deny に sudo がある" '.permissions.deny | index("Bash(sudo *)") != null' "$M"
expect "deny に ~/.ssh の読み取りがある" '.permissions.deny | index("Read(~/.ssh/**)") != null' "$M"
expect "deny に個人のパス（/Users/）を書かない" '[.permissions.deny[] | select(test("/Users/"))] | length == 0' "$M"

# リポジトリの設定: インストール先のスクリプトを許可し、サンドボックスを弱める設定を書かない
expect ".claude/settings.json が JSON として読める" '.' "$P"
expect "github.sh を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/github.sh *)") != null' "$P"
expect "cr-review.sh を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/cr-review.sh *)") != null' "$P"
expect "wait-pr-checks.sh を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/wait-pr-checks.sh *)") != null' "$P"
expect "リポジトリの設定にサンドボックスの設定を書かない（managed settings で決める）" '.sandbox == null' "$P"
expect "リポジトリの設定で環境変数を設定しない（外で動くスクリプトに渡るため）" '.env == null' "$P"
# hook はサンドボックスの外で動くため、作業ツリーのファイルを動かさない。リポジトリの設定には hook を書かず、
# managed settings からインストール先のものだけを動かす
expect "リポジトリの設定に hook を書かない" '.hooks == null' "$P"
expect "managed settings で、cr-review.sh の前に CodeRabbit の枠を確かめる" '[.hooks.PreToolUse[]? | select(.matcher == "Bash") | .hooks[].command] | index("/opt/claude-code-team/bin/cr-limit-gate.sh") != null' "$M"
expect "managed settings で、API キーが会話ログに出るコマンドを止める" '[.hooks.PreToolUse[]? | select(.matcher == "Bash") | .hooks[].command] | index("/opt/claude-code-team/bin/block-ai-speak-trace-secrets.sh") != null' "$M"
expect "リポジトリの設定で git push・gh を直接許可しない" '[.permissions.allow[] | select(test("^Bash\\((git push|git fetch|gh )"))] | length == 0' "$P"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
