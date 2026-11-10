#!/bin/bash
# playwright-mcp.sh（Playwright MCP の起動。managed-mcp.json で、これだけを動かす）のテスト
# （bash .claude/team/tests/playwright-mcp.test.sh）
# MCP サーバーはサンドボックスの外で動き、Claude Code の環境変数を引き継ぐ。
# そのため、受け取った環境変数・引数・作業フォルダで、動かすものや動き方を変えられないことを確かめる
set -u
S="$(cd "$(dirname "$0")/../bin" && pwd)/playwright-mcp.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

if [ -f "$S" ]; then ok; else ng "$S がない"; exit 1; fi

# コメントの行を除き、行末の \ でつないだ行を1行にしたもの（行番号は、つないだ後の行の番号）
code="$(grep -Ev '^[[:space:]]*#' "$S" | sed -e :a -e '/\\$/N; s/\\\n//; ta')"
# has <説明> <grep -E の式>: コードに、その書き方があること
has() { if printf '%s\n' "$code" | grep -Eq -- "$2"; then ok; else ng "$1（$2）"; fi; }
# lacks <説明> <grep -E の式>: コードに、その書き方がないこと
lacks() { if printf '%s\n' "$code" | grep -Eq -- "$2"; then ng "$1（$2）"; else ok; fi; }
# line_of <grep -E の式>: その書き方がある最初の行の番号（なければ 99999）
line_of() { printf '%s\n' "$code" | grep -nE -- "$1" | head -n 1 | cut -d: -f1 | grep . || echo 99999; }

# npx はすべて、環境変数を空にしてから動かす（NODE_OPTIONS・npm_config_*・PLAYWRIGHT_MCP_* などを引き継がない）
has "npx を動かす" 'npx'
if printf '%s\n' "$code" | grep -E '(^|[^A-Za-z_])npx( |$)' | grep -Ev '/usr/bin/env -i ' | grep -q .; then
  ng "env -i を通さずに npx を動かす行がある"
else
  ok
fi
# 使う変数は、スクリプトの中で決めたものだけ（受け取った HOME・引数・PLAYWRIGHT_* などを使わない）
allowed=' PATH home user app APP BROWSERS_DIR PLAYWRIGHT_MCP_VERSION PLAYWRIGHT_VERSION '
# 一重引用符の中（awk の $2 など）は、シェルが展開しないため除く
used="$(printf '%s\n' "$code" | sed "s/'[^']*'//g" | grep -oE '\$\{?[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?!$-]' | sed -E 's/^\$\{?//' | sort -u)"
for v in $used; do
  case "$allowed" in
    *" $v "*) ok ;;
    *) ng "スクリプトの中で決めていない変数を使う: \$$v" ;;
  esac
done
# PATH・HOME は、決めた値・アカウントの情報から作る
has "PATH を決めた値にする" '^PATH="?/'
has "HOME を、アカウントの情報から求める" 'dscl \. -read "?/Users/'
lacks "PLAYWRIGHT_BROWSERS_PATH で、動かすブラウザを差し替えさせない" 'PLAYWRIGHT_BROWSERS_PATH'
# 順番: PATH を決め、/ に移ってから npx を動かす（作業フォルダの node_modules を使わない）
first_npx=$(line_of '(^|[^A-Za-z_])npx( |$)')
path_line=$(line_of '^PATH="?/')
cd_line=$(line_of '^cd /( |$)')
if [ "$path_line" -lt "$first_npx" ]; then ok; else ng "npx より前に PATH を決めていない"; fi
if [ "$cd_line" -lt "$first_npx" ]; then ok; else ng "npx より前に / に移っていない"; fi
# バージョンを決めて取る
has "@playwright/mcp のバージョンを決める" '^PLAYWRIGHT_MCP_VERSION="[0-9]+\.[0-9]+\.[0-9]+"$'
lacks "latest を使わない" '@latest'
# Playwright MCP を起動する行に、プロフィールを残さない指定（--isolated）がある
if printf '%s\n' "$code" | grep -E '@playwright/mcp@' | grep -q -- '--isolated'; then ok; else ng "Playwright MCP の起動に --isolated がない"; fi
# ブラウザは localhost の開発用の画面だけを開く。つながらないプロキシ（127.0.0.1 の使っていないポート）を通させ、
# localhost・127.0.0.1 だけをプロキシの例外にする。ページの JavaScript・リダイレクトも含め、外への通信はブラウザの段階で失敗する
start="$(printf '%s\n' "$code" | grep -E '@playwright/mcp@' || true)"
if printf '%s\n' "$start" | grep -Eq -- '--proxy-server "?http://127\.0\.0\.1:9"?( |$)'; then ok; else ng "Playwright MCP のブラウザを、つながらないプロキシ（http://127.0.0.1:9）に通していない"; fi
if printf '%s\n' "$start" | grep -Eq -- '--proxy-bypass "?localhost,127\.0\.0\.1"?( |$)'; then ok; else ng "プロキシの例外が localhost,127.0.0.1 だけになっていない"; fi
# 後ろにもう一度書いて値を上書きさせない（どちらも1回だけ）。起動の行の途中にコメントを書かせない（後ろの指定が効かなくなる）
for opt in --proxy-server --proxy-bypass; do
  n=$(printf '%s\n' "$start" | grep -o -- "$opt" | wc -l | tr -d ' ')
  if [ "$n" = 1 ]; then ok; else ng "起動の行に $opt が1回だけではない（$n 回）"; fi
done
if printf '%s\n' "$start" | grep -q '#'; then ng "起動の行の途中にコメント（#）がある"; else ok; fi
# 手元のファイルを広く読ませる指定を付けない
lacks "--allow-unrestricted-file-access を付けない" 'allow-unrestricted-file-access'

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
