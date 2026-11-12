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

# 行末の \ で続けたすぐ次の行が、コメントの行・空の行だと、シェルはそこでコマンドを終え、後ろの指定が渡らない。
# 下の確かめはコメントの行を除いてから行をつなぐため、元のファイルで、この書き方がないことを先に確かめる
if awk 'prev ~ /\\$/ && ($0 ~ /^[[:space:]]*#/ || $0 ~ /^[[:space:]]*$/) { found = 1 } { prev = $0 } END { exit found ? 0 : 1 }' "$S"; then
  ng "行末の \\ で続けた次の行が、コメントの行・空の行になっている（後ろの指定が渡らない）"
else
  ok
fi
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
# ホームのパスに空白があっても、全体を取る（dscl の出力の NFSHomeDirectory: の後ろをすべて取る）
home_line="$(grep -E '^home=.*dscl' "$S" || true)"
filter="$(printf '%s' "$home_line" | sed -E 's/.*NFSHomeDirectory \| //; s/\)"$//')"
got="$(printf 'NFSHomeDirectory: /Users/a b\n' | eval "$filter" 2>/dev/null || true)"
if [ "$got" = "/Users/a b" ]; then ok; else ng "ホームのパスの空白の後ろが切れる（$got）"; fi
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
# Chrome は 127.0.0.2 などの自分の Mac の中・リンクローカルの宛先を、暗黙にプロキシの例外にするため、
# <-loopback> でそれを外してから、localhost・127.0.0.1 だけを例外にする
if printf '%s\n' "$start" | grep -Eq -- '--proxy-bypass "?<-loopback>,localhost,127\.0\.0\.1"?( |$)'; then ok; else ng "プロキシの例外が <-loopback>,localhost,127.0.0.1 になっていない"; fi
# 後ろにもう一度書いて値を上書きさせない（どちらも1回だけ）。起動の行の途中にコメントを書かせない（後ろの指定が効かなくなる）
for opt in --proxy-server --proxy-bypass; do
  n=$(printf '%s\n' "$start" | grep -o -- "$opt" | wc -l | tr -d ' ')
  if [ "$n" = 1 ]; then ok; else ng "起動の行に $opt が1回だけではない（$n 回）"; fi
done
if printf '%s\n' "$start" | grep -q '#'; then ng "起動の行の途中にコメント（#）がある"; else ok; fi
# WebRTC の UDP は HTTP のプロキシを通らないため、プロキシを通らない UDP を Chrome の起動引数で止める。
# Playwright MCP には Chrome に引数を渡すオプションがないため、設定ファイル（root の持ち物）の launchOptions.args で渡す
CONF_PATH=/opt/claude-code-team/etc/playwright-mcp.json
n=$(printf '%s\n' "$start" | grep -o -- '--config' | wc -l | tr -d ' ')
if [ "$n" = 1 ] && printf '%s\n' "$start" | grep -Eq -- "--config \"?$CONF_PATH\"?( |$)"; then ok; else ng "起動の行で、--config $CONF_PATH を1回だけ渡していない"; fi
C="$(cd "$(dirname "$0")/.." && pwd)/etc/playwright-mcp.json"
if jq -e '.browser.launchOptions.args | index("--force-webrtc-ip-handling-policy=disable_non_proxied_udp") != null' "$C" >/dev/null 2>&1; then ok; else ng "設定ファイルで、プロキシを通らない WebRTC の UDP を止めていない"; fi
# 設定ファイルには、Chrome の起動引数だけを書く（守りを弱めるほかの設定を書かせない）
if jq -e '(keys == ["browser"]) and (.browser | keys == ["launchOptions"]) and (.browser.launchOptions | keys == ["args"]) and all(.browser.launchOptions.args[]; . == "--force-webrtc-ip-handling-policy=disable_non_proxied_udp")' "$C" >/dev/null 2>&1; then ok; else ng "設定ファイルに、決めた起動引数のほかのものがある"; fi
I="$(cd "$(dirname "$0")/.." && pwd)/install.sh"
if grep -Ev '^[[:space:]]*#' "$I" | grep -Eq 'install -o root -g wheel -m 644 "\$src/etc/playwright-mcp\.json" "\$prefix/etc/playwright-mcp\.json"'; then ok; else ng "install.sh が設定ファイルを /opt/claude-code-team/etc に入れていない"; fi
if grep -Ev '^[[:space:]]*#' "$I" | grep -Eq '^jq empty "\$src/etc/playwright-mcp\.json"$'; then ok; else ng "install.sh が、入れる前に設定ファイルの JSON を確かめていない"; fi
# 手元のファイルを広く読ませる指定を付けない
lacks "--allow-unrestricted-file-access を付けない" 'allow-unrestricted-file-access'

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
