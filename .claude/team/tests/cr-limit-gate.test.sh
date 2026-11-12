#!/bin/bash
# cr-limit-gate.sh のうち、手元の CodeRabbit CLI（cr-review.sh）の枠切れの部分のテスト
# （bash .claude/team/tests/cr-limit-gate.test.sh）
# インストール先（/opt/claude-code-team/bin）の cr-review.sh も、枠が戻る時刻まで止めることを確かめる
set -u
HOOK="$(cd "$(dirname "$0")/../bin" && pwd)/cr-limit-gate.sh"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cr-limit-gate-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
git init -q -b main "$repo"
touch "$repo/.coderabbit.yaml"
mkdir -p "$tmp/home/.claude/state" "$tmp/bin"
# 通知（osascript）と gh は呼ばれても何もしない
for c in osascript gh; do printf '#!/bin/bash\nexit 0\n' >"$tmp/bin/$c"; chmod +x "$tmp/bin/$c"; done
export HOME="$tmp/home" PATH="$tmp/bin:$PATH"

pass=0
fail=0
# check <期待（deny / allow）> <コマンド>
check() {
  local want=$1 cmd=$2 got
  if jq -n --arg c "$cmd" --arg d "$repo" '{tool_input: {command: $c}, cwd: $d}' | bash "$HOOK" | grep -q '"deny"'; then got=deny; else got=allow; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s（期待 %s、結果 %s）\n' "$cmd" "$want" "$got"
  fi
}

# 枠切れ（10分後に戻る）
echo $(( $(date +%s) + 600 )) >"$HOME/.claude/state/coderabbit-cli-limit-until"
check deny "/opt/claude-code-team/bin/cr-review.sh"
check deny "/opt/claude-code-team/bin/cr-review.sh --base-branch release/v9.9.9"
check allow "/opt/claude-code-team/bin/cr-review.sh --accept"
check allow "/opt/claude-code-team/bin/cr-review.sh --base"
check allow "/opt/claude-code-team/bin/cr-review.sh --base-branch main --accept"
# --base-branch の値が --accept でも、レビューは動く
check deny "/opt/claude-code-team/bin/cr-review.sh --base-branch --accept"
check allow "echo /opt/claude-code-team/bin/cr-review.sh"

# 枠が戻った後
echo $(( $(date +%s) - 60 )) >"$HOME/.claude/state/coderabbit-cli-limit-until"
check allow "/opt/claude-code-team/bin/cr-review.sh"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
