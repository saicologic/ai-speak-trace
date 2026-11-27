#!/bin/bash -p
# ブランチの PR ができるまで待ち、見つけた PR を出力する。
# 使い方: wait-pr-created.sh <owner/repo> <ブランチ>
# 子ワークツリーに渡した作業の PR を、元の session から見張るため、Claude が Bash の run_in_background で実行する。
# インストール先（/opt/claude-code-team/bin）から、managed settings の sandbox.excludedCommands でサンドボックスの外で動かす。
# 中身は lib/wait-pr-created.sh
# テスト: bash .claude/team/tests/wait-pr-created.test.sh
# サンドボックスの外で動くため、受け取った環境は中身に渡さない（作業ツリーなどに置いた gh・jq、PERL5OPT・exported function などで、
# 外の処理を動かさせない）。PATH は Playwright MCP（playwright-mcp.sh）と同じ決めた値にし、HOME はアカウントの情報から求め、
# env -i で中身を動かす（中身はファイルを作らないため、TMPDIR も渡さない）。この入口で呼ぶコマンドも、絶対パスで呼ぶ。
# shebang の -p（privileged mode）で、入口そのものも受け取った BASH_ENV を読まず、exported function を取り込まない
# （exec・cd などを関数で上書きさせない。excludedCommands のとおりパスを書いて直接動かすときに効く）
PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PATH
user="$(/usr/bin/id -un)"
# アカウントの情報（macOS は id -P の9番目、CI の Linux は getent passwd の6番目）から、ホームのフォルダを求める
if [ "$(/usr/bin/uname -s)" = Darwin ]; then
  home="$(/usr/bin/id -P "$user" | /usr/bin/cut -d: -f9)"
else
  home="$(/usr/bin/getent passwd "$user" | /usr/bin/cut -d: -f6)"
fi
[ -d "$home" ] || { echo "ホームフォルダが見つかりません" >&2; exit 1; }
# 待つ時間の上限（数字かどうかは中身で確かめる）
timeout="${WAIT_PR_CREATED_TIMEOUT:-3600}"
lib="$(builtin cd "$(/usr/bin/dirname "$0")" && builtin pwd)/lib/wait-pr-created.sh"
builtin cd / || exit 1
exec /usr/bin/env -i PATH="$PATH" HOME="$home" USER="$user" LOGNAME="$user" WAIT_PR_CREATED_TIMEOUT="$timeout" /bin/bash --noprofile --norc "$lib" "$@"
