# サンドボックスの外で git を動かすスクリプト（github.sh・cr-review.sh）から source する
#
# サンドボックスの中では、一時フォルダに作ったリポジトリなどの .git/config を自由に書ける。
# そのリポジトリで外から git を動かすと、core.fsmonitor・core.sshCommand・credential.helper などに書いたコマンドが
# サンドボックスの外で動いてしまうため、リポジトリの設定は決めた項目だけを認め、それ以外があれば断る。
# ユーザー（~/.gitconfig）・システムの設定は、サンドボックスの中から書き換えられないため見ない。
#
# また、source したスクリプトと、そこから動くすべての git（CodeRabbit CLI などが動かすものも含む）で、
# git のフック（.git/hooks。fetch でも reference-transaction などが動く）を動かさない。

export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null

# check_git_config: 今のリポジトリの設定（.git/config・config.worktree）が、決めた項目だけか。違えば終わる
check_git_config() {
  local key
  while IFS= read -r key; do
    case "$key" in
      core.repositoryformatversion | core.filemode | core.bare | core.logallrefupdates | core.ignorecase | core.precomposeunicode | core.symlinks) ;;
      extensions.worktreeconfig | extensions.objectformat) ;;
      remote.*.url | remote.*.fetch | remote.*.pushurl | remote.*.tagopt | remote.*.prune | remote.*.gh-resolved) ;;
      branch.*) ;;
      push.autosetupremote | push.default) ;;
      coderabbit.*) ;;
      user.name | user.email) ;;
      *)
        printf '%s: リポジトリの git の設定に、認めていない項目があります: %s（.git/config を確かめてください）\n' "$(basename "$0")" "$key" >&2
        exit 1
        ;;
    esac
  done < <({ git config --local --name-only --list; git config --worktree --name-only --list; } 2>/dev/null | sort -u)
}
