# サンドボックスの外で git を動かすスクリプト（github.sh・cr-review.sh・tdd-push-gate.sh）から source する
#
# サンドボックスの中では、一時フォルダに作ったリポジトリや、入れ子のリポジトリ（サブモジュール）の .git/config を自由に書ける。
# そのリポジトリで外から git を動かすと、core.fsmonitor・core.sshCommand・credential.helper・diff の textconv などに書いた
# コマンドがサンドボックスの外で動いてしまうため、次の2つで防ぐ。
#
# 1. source したスクリプトと、そこから動くすべての git（gh・CodeRabbit CLI などが動かすものも含む）で、環境変数
#    （GIT_CONFIG_COUNT。リポジトリの設定より強く、入れ子のリポジトリにも渡る）で次を決める
#    - git のフック（.git/hooks。fetch でも reference-transaction などが動く）を動かさない
#    - fsmonitor を使わない・サブモジュールの中に入らない（入れ子のリポジトリの設定を読ませない）
#    - ext:: のリモート（コマンドを動かすリモート）を使わない
# 2. 今のリポジトリの設定（.git/config・config.worktree）は、決めた項目だけを認める（check_git_config）。
#    ユーザー（~/.gitconfig）・システムの設定は、サンドボックスの中から書き換えられないため見ない

export GIT_CONFIG_COUNT=7 \
  GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null \
  GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false \
  GIT_CONFIG_KEY_2=submodule.recurse GIT_CONFIG_VALUE_2=false \
  GIT_CONFIG_KEY_3=fetch.recurseSubmodules GIT_CONFIG_VALUE_3=false \
  GIT_CONFIG_KEY_4=diff.ignoreSubmodules GIT_CONFIG_VALUE_4=all \
  GIT_CONFIG_KEY_5=status.submoduleSummary GIT_CONFIG_VALUE_5=false \
  GIT_CONFIG_KEY_6=protocol.ext.allow GIT_CONFIG_VALUE_6=never

# check_git_config: 今のリポジトリの設定が、決めた項目だけか。違えば、理由を出して 1 で終わる
check_git_config() {
  local key
  while IFS= read -r key; do
    case "$key" in
      core.repositoryformatversion | core.filemode | core.bare | core.logallrefupdates | core.ignorecase | core.precomposeunicode | core.symlinks) ;;
      extensions.worktreeconfig | extensions.objectformat) ;;
      remote.*.url | remote.*.fetch | remote.*.pushurl | remote.*.tagopt | remote.*.prune | remote.*.gh-resolved) ;;
      branch.*) ;;
      push.autosetupremote | push.default) ;;
      coderabbit.defaultbranch) ;;
      user.name | user.email) ;;
      *)
        printf '%s: リポジトリの git の設定に、認めていない項目があります: %s（.git/config を確かめてください）\n' "$(basename "$0")" "$key" >&2
        exit 1
        ;;
    esac
  done < <({ git config --local --name-only --list; git config --worktree --name-only --list; } 2>/dev/null | sort -u)
}

# github_slug <URL>: GitHub の URL から owner/name を取り出す（GitHub 以外・.. を含むものは失敗。owner/.github などは通す）
github_slug() {
  local p
  case "$1" in
    https://github.com/*) p=${1#https://github.com/} ;;
    git@github.com:*) p=${1#git@github.com:} ;;
    ssh://git@github.com/*) p=${1#ssh://git@github.com/} ;;
    *) return 1 ;;
  esac
  p=${p%/}
  p=${p%.git}
  [[ "$p" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || return 1
  [[ "$p" != *..* ]] || return 1
  printf '%s' "$p"
}
