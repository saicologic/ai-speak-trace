#!/bin/bash
# cr-review.sh のテスト（bash .claude/team/tests/cr-review.test.sh）
# サンドボックスの外で動くため、引数・リポジトリの git の設定・サブモジュール・環境変数で、外のコマンドを動かされないことを確かめる。
# CodeRabbit CLI は、HOME の下に置いた代わりのスクリプト（~/.local/bin/coderabbit）で確かめる
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cr-review-test.XXXXXX")" && pwd -P) || exit 1
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
remote="$tmp/remote.git"
# origin は GitHub の URL にし、ユーザーの git の設定（insteadOf）で手元の bare リポジトリに向ける
export GIT_CONFIG_GLOBAL="$tmp/gitconfig"
git config --global url."$remote".insteadOf https://github.com/me/repo.git
git init -q --bare -b main "$remote"
git init -q -b main "$repo"
git -C "$repo" commit -q --allow-empty -m init
git -C "$repo" remote add origin https://github.com/me/repo.git
git -C "$repo" push -q origin main
git -C "$repo" switch -q -c fix/a
git -C "$repo" commit -q --allow-empty -m change

# CodeRabbit CLI の代わり: 呼ばれた引数を記録し、指摘なし（0）で終わる
export HOME="$tmp/home"
mkdir -p "$HOME/.local/bin"
cat >"$HOME/.local/bin/coderabbit" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >"$tmp/cr-called"
exit 0
EOF
chmod +x "$HOME/.local/bin/coderabbit"
# 環境変数で差し替えようとしたプログラム
printf '#!/bin/bash\ntouch %s/evil-ran\n' "$tmp" >"$tmp/evil"
chmod +x "$tmp/evil"
marker="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)/coderabbit-reviewed"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ng() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }
# run <引数...>: repo で cr-review.sh を実行し、終了コードを rc、出力を out に入れる
run() { rm -f "$tmp/cr-called" "$marker"; out=$(cd "$repo" && bash "$BIN/cr-review.sh" "$@" 2>&1); rc=$?; }
# rejected <説明> <引数...>: エラーで終わり、CodeRabbit CLI を呼ばず、レビュー済みにしない
rejected() {
  local name=$1; shift
  run "$@"
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ] && [ -n "$out" ] && [ ! -e "$tmp/cr-called" ] && [ ! -e "$marker" ]; then ok; else ng "$name（rc=$rc）: $out"; fi
}

# 親ブランチを表示するだけなら、レビューを動かさずに終わる
run --base-branch main --base
if [ "$rc" -eq 0 ] && [ "$out" = "main" ]; then ok; else ng "--base-branch main --base（rc=$rc）: $out"; fi

# 正しい流れ: 親ブランチと比べてレビューし、指摘がなければレビュー済みにする。環境変数のプログラムは動かさない
rm -f "$marker"
out=$(cd "$repo" && CODERABBIT_BIN="$tmp/evil" CR="$tmp/evil" bash "$BIN/cr-review.sh" --base-branch main 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && grep -q -- "--base-commit $(git -C "$repo" rev-parse main)" "$tmp/cr-called" 2>/dev/null &&
  grep -qx "$(git -C "$repo" rev-parse HEAD)" "$marker" 2>/dev/null; then ok; else ng "レビューの正しい流れ（rc=$rc）: $out"; fi
if [ ! -e "$tmp/evil-ran" ]; then ok; else ng "環境変数で差し替えたプログラムが動いた"; fi

# 親ブランチの名前は、ブランチ名の形だけ（git fetch のオプションにさせない）
rejected "--base-branch に git fetch のオプション" --base-branch "--upload-pack=touch $tmp/pwned"
rejected "--base-branch に ..（範囲の書き方）" --base-branch "main..x"
rejected "--base-branch が空" --base-branch ""
if [ ! -e "$tmp/pwned" ]; then ok; else ng "--base-branch の値で、外のコマンドが動いた"; fi

# origin は GitHub の URL だけ
git -C "$repo" remote set-url origin "$remote"
rejected "origin が GitHub の URL でない" --base-branch main
git -C "$repo" remote set-url origin https://github.com/me/repo.git

# 親ブランチが手元にも GitHub にもないときは、比べるコミットが決まらないので、CodeRabbit CLI を呼ばずに終わる
rejected "親ブランチがない" --base-branch nobranch

# リポジトリの git の設定に、コマンドを動かす設定があれば断る（--base・--accept・レビュー）
for kv in "core.fsmonitor=touch $tmp/pwned" "core.sshCommand=touch $tmp/pwned" "url.$tmp/x.insteadOf=https://github.com/"; do
  git -C "$repo" config "${kv%%=*}" "${kv#*=}"
  for args in "--base" "--accept" ""; do
    # shellcheck disable=SC2086
    rejected "${kv%%=*} があるリポジトリで cr-review.sh $args" --base-branch main $args
  done
  git -C "$repo" config --unset "${kv%%=*}"
done
if [ ! -e "$tmp/pwned" ]; then ok; else ng "リポジトリの設定のコマンドが動いた"; fi

# サブモジュール（入れ子のリポジトリ）の設定でも、外のコマンドを動かさない
git init -q -b main "$repo/nested"
git -C "$repo/nested" commit -q --allow-empty -m nested
git -C "$repo" add nested 2>/dev/null
git -C "$repo" commit -q -m "入れ子のリポジトリ"
git -C "$repo/nested" config core.fsmonitor "touch $tmp/nested-pwned"
touch "$repo/nested/dirty"
# 対照: 守りがなければ、git status で入れ子のリポジトリの core.fsmonitor が動く（この準備で確かめられていること）
( cd "$repo" && git status --porcelain >/dev/null 2>&1 )
if [ -e "$tmp/nested-pwned" ]; then ok; else ng "対照: 守りがないときに、入れ子のリポジトリの core.fsmonitor が動かない"; fi
rm -f "$tmp/nested-pwned"
run --base-branch main
if [ ! -e "$tmp/nested-pwned" ]; then ok; else ng "入れ子のリポジトリの core.fsmonitor が動いた（rc=$rc）: $out"; fi

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
