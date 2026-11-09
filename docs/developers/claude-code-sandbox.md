# Claude Code のサンドボックスと GitHub への操作

このリポジトリで Claude Code を使う開発者は、全員が同じ設定（managed settings）とスクリプトを使います。個人の設定ではなく、`.claude/team/` で管理し、PR でレビューします。開発者は macOS を使う前提です。

## なぜ使うか

- Claude Code が動かすコマンドを、OS のサンドボックス（macOS の Seatbelt）の中で動かし、書き込める場所と通信先を絞ります
- GitHub への操作（push・PR・Issue）は、決めた形だけを受け付けるスクリプト（`github.sh`）からだけ行います。Bash から GitHub には届きません
- 個人の設定のばらつきをなくし、守りを弱める変更をレビューと CI（`.claude/team/tests/`）で止めます

サンドボックスが制限するのは、Claude Code が Bash で動かすコマンドだけです。開発者が自分のターミナルで行う操作（`git push` など）は、今までどおり動きます。

## 守りの層

| 層 | 置き場所 | 役割 |
|---|---|---|
| GitHub の設定 | ブランチ保護・必須チェック（`tdd-order` など） | Claude Code を使うかどうかに関係なく、全員に効く最後の守り |
| managed settings | `.claude/team/managed-settings.json` → `/Library/Application Support/ClaudeCode/managed-settings.json` | サンドボックスを必ず使う・通信先を固定する・bypassPermissions モードを使えなくする。個人の設定・リポジトリの設定では上書きできない |
| サンドボックスの外で動くスクリプト | `.claude/team/bin/` → `/opt/claude-code-team/bin/`（root の持ち物） | GitHub への操作（`github.sh`）・手元の CodeRabbit レビュー（`cr-review.sh`）・PR の監視（`wait-pr-checks.sh`・`watch-pr-checks.sh`）・push の前の確認（`cr-gate-push.sh`・`tdd-push-gate.sh`・`cr-limit-gate.sh`） |
| リポジトリの設定 | `.claude/settings.json` | 許可するコマンド（hook は書かない） |

managed settings でサンドボックスを管理者が決める状態にすると、リポジトリの設定に書いた `sandbox.excludedCommands`（サンドボックスの外で動かすコマンド）と通信先は無視されます（clone したリポジトリが、コマンドをサンドボックスの外に出せないようにするため）。そのため、外で動かすスクリプトは、リポジトリの中のファイルではなく、root の持ち物として `/opt/claude-code-team/bin` に入れたものだけにしています。

hook もサンドボックスの外で動きます。作業ツリーのファイル（`.github/scripts`・`.claude/hooks` など）はサンドボックスの中から書き換えられるため、hook や外で動くスクリプトから動かしません。hook は、リポジトリの設定には書かず、managed settings からインストール先のもの（API キーを守る `block-ai-speak-trace-secrets.sh`・CodeRabbit の枠の `cr-limit-gate.sh`・PR の監視の `watch-pr-checks.sh`）だけを動かします。TDD の順番の確認（`tdd-push-gate.sh`）は、`install.sh` が `/opt/claude-code-team/bin/ci` に入れた `.github/scripts` を使います。

外で git を動かすスクリプトは、リポジトリの git の設定を決めた項目だけ認め、git のフック・fsmonitor・サブモジュールの中・`ext::` のリモートを使いません（`.claude/team/bin/lib/git-safety.sh`）。サンドボックスの中で書き換えたリポジトリの設定から、外のコマンドを動かさないためです。

## 入れ方

前提:

- macOS
- `jq`（`brew install jq`）
- `gh` にログインしていること（`gh auth login`）。トークンは、このリポジトリだけに絞った fine-grained personal access token（Contents・Pull requests・Issues の読み書き）を使うことを勧めます。`github.sh` はサンドボックスの外でこのトークンを使うため
- 手元の CodeRabbit レビューを使う場合は、CodeRabbit CLI を `~/.local/bin/coderabbit` に入れ、ログインしていること

ターミナルで、次を自分で実行します（管理者のパスワードを聞かれます。Claude Code には実行させません）。

```bash
# GitHub の main から入れる
curl -fsSL https://raw.githubusercontent.com/saicologic/ai-speak-trace/main/.claude/team/install.sh | sudo bash -s --

# main にまだない版を入れるとき（URL の main と、最後のブランチの両方を変える）
curl -fsSL https://raw.githubusercontent.com/saicologic/ai-speak-trace/release/vX.Y.Z/.claude/team/install.sh | sudo bash -s -- release/vX.Y.Z
```

- インストーラー（`install.sh`）も、入れるものも、手元の作業ツリーからは取りません。作業ツリーは Claude Code のサンドボックスの中から書き換えられるため、`git status` が空でも、手元のファイルを `sudo` で動かすと、レビューしていないものが root で動くおそれがあります。GitHub でレビューしてマージしたものだけを使います
- `install.sh` は、ブランチの今のコミットを root だけが読み書きできる一時フォルダに clone し、そこから入れます。入れたコミットは `/opt/claude-code-team/etc/installed-from` に残します
- 中身を確かめてから実行したいときは、GitHub の画面で `.claude/team/install.sh` を読んでから実行します
- スクリプトを `/opt/claude-code-team/bin` に、managed settings を `/Library/Application Support/ClaudeCode/managed-settings.json` に入れます。前の managed settings があれば、同じフォルダに `.bak` として残します
- managed settings は、**その Mac のすべてのプロジェクト**に効きます。通信先も、ほかのプロジェクトを含めて `managed-settings.json` の一覧だけになります
- Claude Code の `/status` で、managed settings が読まれていることを確かめます

`.claude/team/` か `.github/scripts/` を変える PR がマージされたら、同じ手順でもう一度入れます。

外すときは、次を実行します。入れる前の managed settings（`.bak`）があれば、いちばん新しいものを戻し、なければ消します。

```bash
sudo rm -rf /opt/claude-code-team
dir="/Library/Application Support/ClaudeCode"
latest=$(ls -t "$dir"/managed-settings.json.*.bak 2>/dev/null | head -1)
if [ -n "$latest" ]; then
  sudo mv "$latest" "$dir/managed-settings.json"   # 入れる前の managed settings に戻す
else
  sudo rm "$dir/managed-settings.json"
fi
```

## GitHub への操作（github.sh）

Claude Code は、GitHub への操作を `/opt/claude-code-team/bin/github.sh` で行います。リポジトリのフォルダで、先頭に環境変数の代入・`cd`・リダイレクト・`$( )` を付けずに実行します（付けると、サンドボックスの中で動いて GitHub に届きません）。

| 操作 | 例 |
|---|---|
| push | `github.sh push -u origin HEAD:refs/heads/fix/xxx` |
| fetch | `github.sh fetch origin main` |
| PR を読む | `github.sh pr view 123`・`pr diff`・`pr checks`・`pr list` |
| PR を作る（Draft だけ） | `github.sh pr create --draft --base release/vX.Y.Z --title "..." --body-file <ファイル>` |
| PR の本文・タイトル・ラベル | `github.sh pr edit 123 --body-file <ファイル>` |
| PR のコメント・閉じる | `github.sh pr comment 123 --body-file <ファイル>`・`pr close 123 --comment "..."` |
| Issue | `github.sh issue view 7`・`issue comment 7 --body-file <ファイル>`・`issue create --title "..." --body-file <ファイル>` |
| CI | `github.sh run list`・`run view <id>` |
| API（読むだけ） | `github.sh api repos/<owner>/<repo>/pulls/123/comments --paginate --jq ...` |

- push できるのは、`.claude/team/etc/github-repos` に書いたリポジトリの、`fix/*`・`feature/*`・`test/*` のブランチだけです。`main`・`release/*` へは PR で入れます。force push・ブランチの削除・タグはできません
- push と PR・Issue への書き込みの前に、手元の CodeRabbit レビュー（`cr-gate-push.sh`）・TDD の順番（`tdd-push-gate.sh`）・CodeRabbit の枠（`cr-limit-gate.sh`）を流し、通らなければ止めます。急ぎで飛ばすときは、ユーザーの了承を得て `--skip SKIP_CR_LOOP`・`--skip SKIP_TDD_CHECK`・`--skip SKIP_CR_LIMIT` を付けます
- PR の Ready for review・マージはできません（人が行います）
- 本文のファイルは、リポジトリの中か、Claude Code のスクラッチパッドの中に置きます。`github.sh` は、ファイルを開いてからほかのファイルのハードリンクでないことを確かめ、中身を読んで `--body` で渡します
- ブラウザを開く `--web`（`-w`）は使えません

push・PR の作成の後は、`watch-pr-checks.sh`（managed settings の hook）が、`/opt/claude-code-team/bin/wait-pr-checks.sh` で CI と CodeRabbit を監視するよう Claude Code に伝えます。

## 変えたいとき

| 変えたいもの | 変える場所 |
|---|---|
| 通信先（npm 以外のレジストリなど） | `.claude/team/managed-settings.json` の `sandbox.network.allowedDomains` |
| push してよいリポジトリ | `.claude/team/etc/github-repos` |
| Claude Code に確認なしで許可するコマンド | `.claude/settings.json` の `permissions.allow` |
| 禁止するコマンド・読み取り | `.claude/team/managed-settings.json` の `permissions.deny` |
| `github.sh` などの動き | `.claude/team/bin/`（テストは `.claude/team/tests/`） |

どれも PR で変えます。`.claude/team/tests/managed-settings.test.sh` が、サンドボックスを切る・通信先に `*` や GitHub を入れる・外で動かすものにインストール先以外を入れる、などの変更を止めます。個人の設定（`~/.claude/settings.json`・`.claude/settings.local.json`）で、守りを弱めないでください（managed settings の項目は上書きできません）。

## 困ったとき

| 起きたこと | 理由と対処 |
|---|---|
| `Operation not permitted` | サンドボックスが、作業フォルダ・一時フォルダの外への書き込みを止めています |
| 通信が `host is not on the allow list` で失敗する | 通信先の一覧にないドメインです。必要なら、`allowedDomains` を変える PR を出します |
| `gh`・`git push` が失敗する | Bash から GitHub には届きません。`github.sh` を使います |
| `open`・`osascript` が失敗する | サンドボックスでは使えません。開発者が自分のターミナルで実行します（Claude Code では、コマンドの先頭に `!` を付けると、サンドボックスの外で実行できます） |
| 開発サーバー・Playwright のポートを開けない | サンドボックスでは、ポートを開けません。開発者が自分のターミナルで起動します |
| ElevenLabs・Claude API・Amazon Bedrock につなぐ確認 | サンドボックスからはつながらず、`~/.aws` も読めません。アプリの起動などは開発者が行います（PR の「## 手動確認項目」） |

## 守りの限界

- サンドボックスと hook は、うっかりや、読み込んだ文書に仕込まれた指示（プロンプトインジェクション）による操作を止めるためのものです。Mac の管理者の権限を持つ開発者は、managed settings を外せます
- 最後の守りは、GitHub のブランチ保護と必須チェック（`tdd-order`・`backend-test`・`frontend-test`・`build`）です
