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
# expect <説明> [jq のオプション...] <jq の式（true になること）> <ファイル>
expect() {
  local desc=$1
  shift
  local file="${@: -1}" expr="${@: -2:1}"
  local opts=("${@:1:$#-2}")
  if jq -e ${opts[@]+"${opts[@]}"} "$expr" "$file" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  %s\n' "$desc" "$expr"
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
expect "確認を飛ばす github.sh --skip は、ユーザーに確かめる（ask）" '.permissions.ask | index("Bash(/opt/claude-code-team/bin/github.sh --skip *)") != null' "$M"
expect "レビュー済みにする cr-review.sh --accept は、ユーザーに確かめる（ask）" '.permissions.ask | index("Bash(/opt/claude-code-team/bin/cr-review.sh --accept*)") != null' "$M"
expect "レビュー済みにする cr-review.sh --base-branch … --accept も、ユーザーに確かめる（ask）" '.permissions.ask | index("Bash(/opt/claude-code-team/bin/cr-review.sh --base-branch * --accept*)") != null' "$M"
# Playwright MCP はサンドボックスの外で動くため、外の URL を開く・ページで JavaScript を動かす操作は、ユーザーに確かめる
expect "Playwright MCP の browser_navigate は、ユーザーに確かめる（ask）" '.permissions.ask | index("mcp__playwright__browser_navigate") != null' "$M"
expect "Playwright MCP の browser_evaluate は、ユーザーに確かめる（ask）" '.permissions.ask | index("mcp__playwright__browser_evaluate") != null' "$M"
expect "リポジトリの設定で browser_navigate・browser_evaluate を確認なしで許可しない" '[.permissions.allow[] | select(. == "mcp__playwright__browser_navigate" or . == "mcp__playwright__browser_evaluate")] | length == 0' "$P"
# Playwright MCP のうち、Playwright のサーバーの中で任意のコードを動かす操作は使わせない（サンドボックスの外で動くため）
expect "Playwright MCP の browser_run_code_unsafe を使わせない（deny）" '.permissions.deny | index("mcp__playwright__browser_run_code_unsafe") != null' "$M"
# ファイルのアップロードは、サンドボックスの外から手元のファイルを読んでページに渡すため、ユーザーに確かめる
expect "Playwright MCP の browser_file_upload は、ユーザーに確かめる（ask）" '.permissions.ask | index("mcp__playwright__browser_file_upload") != null' "$M"
expect "リポジトリの設定で browser_run_code_unsafe・browser_file_upload を確認なしで許可しない" '[.permissions.allow[] | select(. == "mcp__playwright__browser_run_code_unsafe" or . == "mcp__playwright__browser_file_upload" or . == "mcp__playwright__*" or . == "mcp__playwright")] | length == 0' "$P"
# 公開のリポジトリへの文章の書き込み（PR・Issue のタイトル・本文・コメント）は、毎回ユーザーに確かめる
# （読み込んだ文書に仕込まれた指示で、手元の情報を書かせないため。push は github.sh が秘密の情報の形を確かめる）
for op in "pr create" "pr edit" "pr comment" "pr close" "issue create" "issue comment"; do
  expect "github.sh $op は、ユーザーに確かめる（ask）" ".permissions.ask | index(\"Bash(/opt/claude-code-team/bin/github.sh $op *)\") != null" "$M"
done
# サンドボックスの外で、あとからコマンドが動く場所を、ファイルを書くツールで書き換えさせない
# （シェルの起動ファイル・ログインのときに動くもの・git の hook と設定・エディタのタスク・Claude Code の個人の設定）
for rule in "Edit(~/.zshrc)" "Edit(~/.zprofile)" "Edit(~/.zshenv)" "Edit(~/.zlogin)" "Edit(~/.bashrc)" "Edit(~/.bash_profile)" "Edit(~/.profile)" \
  "Edit(~/Library/LaunchAgents/**)" "Edit(~/.ssh/**)" "Edit(~/.gitconfig)" "Edit(~/.config/git/**)" \
  "Edit(~/**/.git/hooks/**)" "Edit(~/**/.git/config)" "Edit(//**/.envrc)" "Edit(//**/.vscode/**)" \
  "Edit(~/.claude/settings.json)" "Edit(~/.claude/settings.local.json)" "Edit(//**/.claude/settings.local.json)"; do
  expect "deny に $rule がある" ".permissions.deny | index(\"$rule\") != null" "$M"
done
# どこにでも当たるルールは // から書く（** から書くと、今のフォルダからの相対になり、サブフォルダ・worktree で外れる）
expect "deny の Edit・Read で、** から書いたもの（今のフォルダからの相対）がない" '[.permissions.deny[] | select(test("^(Edit|Read)\\(\\*\\*"))] | length == 0' "$M"
# リポジトリの設定（.claude/settings.json）は PR でレビューするが、作業中に書き換えるときは、ユーザーに確かめる
expect "リポジトリの .claude/settings.json の書き換えは、ユーザーに確かめる（ask）" '.permissions.ask | index("Edit(//**/.claude/settings.json)") != null' "$M"
# Playwright MCP で、手元のファイルをページに渡す操作（ドラッグ・アンド・ドロップ）も、ユーザーに確かめる
expect "Playwright MCP の browser_drop は、ユーザーに確かめる（ask）" '.permissions.ask | index("mcp__playwright__browser_drop") != null' "$M"
# git の hook と設定は、ホームの下（開発するリポジトリ）だけを止める。// から書くと、サンドボックスの書き込みの禁止にも
# 加わり、テストが一時フォルダ（/private/tmp）に作る git のリポジトリも git init できなくなるため
expect "deny の .git/hooks・.git/config は、ホームの下だけ（// から書かない）" '[.permissions.deny[] | select(test("^Edit\\(//.*\\.git/(hooks|config)"))] | length == 0' "$M"
# 読ませない場所を広げる（クラウドの認証情報・ブラウザの Cookie・パスワード・メール）
for rule in "Read(~/.config/gcloud/**)" "Read(~/.kube/**)" "Read(~/.azure/**)" "Read(~/Library/Cookies/**)" \
  "Read(~/Library/Application Support/Google/Chrome/**)" "Read(~/Library/Application Support/Firefox/**)" "Read(~/Library/Safari/**)" \
  "Read(~/Library/Messages/**)" "Read(~/Library/Mail/**)" "Read(~/.password-store/**)" "Read(~/.config/op/**)"; do
  expect "deny に $rule がある" ".permissions.deny | index(\"$rule\") != null" "$M"
done
# hook はサンドボックスの外で動くため、managed settings のものだけを動かす（個人・プロジェクトの設定の hook を動かさない）
expect "hook は managed settings のものだけを動かす（allowManagedHooksOnly）" '.allowManagedHooksOnly == true' "$M"
expect "bypassPermissions モードを使えなくする" '.permissions.disableBypassPermissionsMode == "disable"' "$M"
expect "deny に sudo がある" '.permissions.deny | index("Bash(sudo *)") != null' "$M"
expect "deny に ~/.ssh の読み取りがある" '.permissions.deny | index("Read(~/.ssh/**)") != null' "$M"
expect "レビュー済みの記録・枠切れの記録（~/.claude/state）を、ファイルを書くツールで書き換えさせない" '.permissions.deny | index("Edit(~/.claude/state/**)") != null' "$M"
# npm ci・npm install は、サンドボックスの中では ~/.npm に書けず、保護されたファイル（.vscode/settings.json など）も
# 消せないため、node_modules を消した後に途中で止まり、壊れたまま残る。依存の入れ直し・追加は開発者がターミナルで行う
for rule in "Bash(npm ci)" "Bash(npm ci *)" "Bash(npm install)" "Bash(npm install *)" "Bash(npm i)" "Bash(npm i *)"; do
  expect "deny に $rule がある" ".permissions.deny | index(\"$rule\") != null" "$M"
done
expect "deny に個人のパス（/Users/）を書かない" '[.permissions.deny[] | select(test("/Users/"))] | length == 0' "$M"

# リポジトリの設定: インストール先のスクリプトを許可し、サンドボックスを弱める設定を書かない
expect ".claude/settings.json が JSON として読める" '.' "$P"
expect "github.sh の push を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/github.sh push *)") != null' "$P"
expect "cr-review.sh を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/cr-review.sh *)") != null' "$P"
expect "wait-pr-checks.sh を許可する" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/wait-pr-checks.sh *)") != null' "$P"
expect "リポジトリの設定にサンドボックスの設定を書かない（managed settings で決める）" '.sandbox == null' "$P"
expect "リポジトリの設定で環境変数を設定しない（外で動くスクリプトに渡るため）" '.env == null' "$P"
# hook はサンドボックスの外で動くため、作業ツリーのファイルを動かさない。リポジトリの設定には hook を書かず、
# managed settings からインストール先のものだけを動かす
expect "リポジトリの設定に hook を書かない" '.hooks == null' "$P"
expect "managed settings で、cr-review.sh の前に CodeRabbit の枠を確かめる" '[.hooks.PreToolUse[]? | select(.matcher == "Bash") | .hooks[].command] | index("/opt/claude-code-team/bin/cr-limit-gate.sh") != null' "$M"
expect "managed settings で、API キーが会話ログに出るコマンドを止める" '[.hooks.PreToolUse[]? | select(.matcher == "Bash") | .hooks[].command] | index("/opt/claude-code-team/bin/block-ai-speak-trace-secrets.sh") != null' "$M"
# github.sh で確認なしに許すのは、読む操作と push・fetch だけ（書く操作は、ask に当たらない書き方でも既定の確認に落ちる）
expect "リポジトリの設定で github.sh の全部の操作を許可しない" '.permissions.allow | index("Bash(/opt/claude-code-team/bin/github.sh *)") == null' "$P"
expect "リポジトリの設定で github.sh に許すのは、読む操作と push・fetch だけ" '[.permissions.allow[] | select(startswith("Bash(/opt/claude-code-team/bin/github.sh "))] | length > 0 and all(test("^Bash\\(/opt/claude-code-team/bin/github\\.sh (push|fetch|pr view|pr list|pr diff|pr checks|issue view|run view|run list|api)( \\*)?\\)$"))' "$P"
expect "リポジトリの設定で git push・gh を直接許可しない" '[.permissions.allow[] | select(test("^Bash\\((git push|git fetch|gh )"))] | length == 0' "$P"

# MCP サーバー: サンドボックスの外で動くため、動かす MCP サーバーは managed-mcp.json（root の持ち物）で決める。
# managed-mcp.json があると、そこに書いたサーバーだけが動き、プロジェクトの .mcp.json・プラグイン・claude.ai のコネクタ・
# --mcp-config で足したサーバーは動かない（https://code.claude.com/docs/en/managed-mcp）
MCP="$TEAM/managed-mcp.json"
SERVER_OK='^/opt/claude-code-team/bin/[A-Za-z0-9_-]+\.sh$'
# mcp_ok <JSON のファイル>: サーバーは、インストール先のスクリプトを引数・環境変数なしで動かす手元のサーバーだけか
# （書いてよいキーは command・type だけ。値に ${VAR} の展開を使わない）
mcp_ok() {
  jq -e --arg ok "$SERVER_OK" '
    (.mcpServers | type == "object" and length > 0) and
    all(.mcpServers[];
      (keys - ["command", "type"] == []) and
      (.command | type == "string" and test($ok)) and
      ((.type // "stdio") == "stdio")) and
    ([.. | strings | select(contains("${"))] | length == 0)' "$1" >/dev/null 2>&1
}
if mcp_ok "$MCP"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: managed-mcp.json に、インストール先のスクリプトを引数・環境変数なしで動かすもの以外がある"
fi
# managed settings の ask・deny は mcp__playwright__… の名前で書いているため、サーバーの名前を playwright に決める
# （名前を変えると、ask・deny が当たらなくなる）
expect "managed-mcp.json のサーバーの名前は playwright だけ（ask・deny の名前と合わせる）" '.mcpServers | keys == ["playwright"]' "$MCP"
# 確かめ方そのものが、止めるべき書き方を止めること
bad_mcp="$(mktemp "${TMPDIR:-/tmp}/managed-mcp-bad.XXXXXX")"
for bad in '{"mcpServers":{"p":{"command":"/opt/claude-code-team/bin/playwright-mcp.sh","args":["x"]}}}' \
  '{"mcpServers":{"p":{"command":"/opt/claude-code-team/bin/playwright-mcp.sh","env":{}}}}' \
  '{"mcpServers":{"p":{"command":"/opt/claude-code-team/bin/playwright-mcp.sh","cwd":"/tmp"}}}' \
  '{"mcpServers":{"p":{"type":"http","url":"https://x"}}}' \
  '{"mcpServers":{"p":{"command":"/opt/claude-code-team/bin/playwright-mcp.sh","type":"sse"}}}' \
  '{"mcpServers":{"p":{"command":"/bin/sh"}}}' \
  '{"mcpServers":{"p":{"command":"/opt/claude-code-team/bin/../x.sh"}}}' \
  '{"mcpServers":{"p":{"command":"${HOME}/x.sh"}}}' \
  '{"mcpServers":{}}'; do
  printf '%s' "$bad" >"$bad_mcp"
  if mcp_ok "$bad_mcp"; then
    fail=$((fail + 1))
    printf 'FAIL: managed-mcp.json の止めるべき書き方を通した: %s\n' "$bad"
  else
    pass=$((pass + 1))
  fi
done
rm -f "$bad_mcp"
while IFS= read -r name; do
  if [ -f "$TEAM/bin/$name" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: MCP サーバーの %s が .claude/team/bin にない\n' "$name"
  fi
done < <(jq -r --arg p "$PREFIX" '.mcpServers[].command | select(startswith($p)) | ltrimstr($p)' "$MCP" | sort -u)
# managed-mcp.json があると、組み込みの Claude in Chrome も止まる。普段のログイン中の Chrome を操作させないため、使えるようにしない
# （ブラウザでの確認は、localhost の開発用の画面を Playwright MCP で開くだけにする）
expect "Claude in Chrome を使えるようにしない" '(.allowClaudeInChromeWithManagedMcp // false) == false' "$M"
# MCP サーバーは managed-mcp.json だけで決める（許可の一覧を二重に持たない）
expect "MCP サーバーの許可の一覧を書かない（managed-mcp.json で決める）" '.allowedMcpServers == null and .allowManagedMcpServersOnly == null and .deniedMcpServers == null' "$M"
expect "リポジトリの設定で Claude in Chrome のツールを許可しない" '[.permissions.allow[] | select(startswith("mcp__claude-in-chrome"))] | length == 0' "$P"
# リポジトリに .mcp.json を置かない（managed-mcp.json があると使われず、紛らわしいため）
if git -C "$ROOT" ls-files --error-unmatch .mcp.json >/dev/null 2>&1; then
  fail=$((fail + 1))
  echo "FAIL: リポジトリに .mcp.json がある"
else
  pass=$((pass + 1))
fi
# install.sh が managed-mcp.json も入れる。壊れた JSON は、何かを入れる前に止める
I="$TEAM/install.sh"
icode="$(grep -nEv '^[[:space:]]*#' "$I")"
if printf '%s\n' "$icode" | grep -Eq '^[0-9]+:for name in managed-settings\.json managed-mcp\.json; do$'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: install.sh が managed-settings.json と managed-mcp.json の両方を入れていない"
fi
jq_line=$(printf '%s\n' "$icode" | grep -E '^[0-9]+:jq empty "\$src/managed-mcp\.json"$' | head -n 1 | cut -d: -f1)
first_install=$(printf '%s\n' "$icode" | grep -E '^[0-9]+:[[:space:]]*install -' | head -n 1 | cut -d: -f1)
if [ -n "$jq_line" ] && [ -n "$first_install" ] && [ "$jq_line" -lt "$first_install" ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: install.sh が、何かを入れる前に managed-mcp.json の JSON を確かめていない"
fi
if printf '%s\n' "$icode" | grep -Eq '^[0-9]+:set -[a-z]*e'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: install.sh が、失敗したところで止まらない（set -e がない）"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
