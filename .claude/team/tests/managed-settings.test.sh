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

# サンドボックスの外で動かすものは、インストール先（root の持ち物）のスクリプトだけ
if jq -e --arg p "$PREFIX" '.sandbox.excludedCommands | length > 0 and all(startswith($p))' "$M" >/dev/null 2>&1; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: excludedCommands が %s で始まらないものを含む\n' "$PREFIX"
fi
# インストール先のスクリプトの名前は、リポジトリの bin にあること（excludedCommands・hook の両方）
while IFS= read -r name; do
  if [ -f "$TEAM/bin/$name" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s が .claude/team/bin にない\n' "$name"
  fi
done < <(jq -r --arg p "$PREFIX" '[.sandbox.excludedCommands[], (.hooks[]?[]?.hooks[]?.command)] | .[] | select(startswith($p)) | ltrimstr($p) | split(" ")[0]' "$M" | sort -u)
expect "hook はインストール先のスクリプトだけ" '[.hooks[]?[]?.hooks[]?.command | select(startswith("/opt/claude-code-team/bin/") | not)] | length == 0' "$M"

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
expect "リポジトリの設定で git push・gh を直接許可しない" '[.permissions.allow[] | select(test("^Bash\\((git push|git fetch|gh )"))] | length == 0' "$P"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
