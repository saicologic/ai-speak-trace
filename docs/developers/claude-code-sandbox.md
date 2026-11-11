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
| managed settings | `.claude/team/managed-settings.json`・`managed-mcp.json` → `/Library/Application Support/ClaudeCode/` | サンドボックスを必ず使う・通信先を固定する・bypassPermissions モードを使えなくする。個人の設定・リポジトリの設定では上書きできない |
| サンドボックスの外で動くスクリプト | `.claude/team/bin/` → `/opt/claude-code-team/bin/`（root の持ち物） | GitHub への操作（`github.sh`）・手元の CodeRabbit レビュー（`cr-review.sh`）・PR の監視（`wait-pr-checks.sh`・`watch-pr-checks.sh`）・push の前の確認（`cr-gate-push.sh`・`tdd-push-gate.sh`・`cr-limit-gate.sh`）・Playwright MCP の起動（`playwright-mcp.sh`） |
| リポジトリの設定 | `.claude/settings.json` | 許可するコマンド（hook は書かない） |

managed settings でサンドボックスを管理者が決める状態にすると、リポジトリの設定に書いた `sandbox.excludedCommands`（サンドボックスの外で動かすコマンド）と通信先は無視されます（clone したリポジトリが、コマンドをサンドボックスの外に出せないようにするため）。そのため、外で動かすスクリプトは、リポジトリの中のファイルではなく、root の持ち物として `/opt/claude-code-team/bin` に入れたものだけにしています。

hook もサンドボックスの外で動きます。作業ツリーのファイル（`.github/scripts`・`.claude/hooks` など）はサンドボックスの中から書き換えられるため、hook や外で動くスクリプトから動かしません。hook は、リポジトリの設定には書かず、managed settings からインストール先のもの（API キーを守る `block-ai-speak-trace-secrets.sh`・CodeRabbit の枠の `cr-limit-gate.sh`・PR の監視の `watch-pr-checks.sh`）だけを動かします。TDD の順番の確認（`tdd-push-gate.sh`）は、`install.sh` が `/opt/claude-code-team/bin/ci` に入れた `.github/scripts` を使います。

MCP サーバーもサンドボックスの外で動きます。動かす MCP サーバーは、`.claude/team/managed-mcp.json` → `/Library/Application Support/ClaudeCode/managed-mcp.json`（root の持ち物）で、インストール先の Playwright MCP（`playwright-mcp.sh`）だけに決めます。このファイルがあると、プロジェクトの `.mcp.json`・プラグイン・claude.ai のコネクタ・`--mcp-config` で足したサーバーは動きません（[公式のドキュメント](https://code.claude.com/docs/en/managed-mcp)）。組み込みの Claude in Chrome も止まります（普段のログイン中の Chrome を操作させないため、使えるようにしていません）。**この Mac のほかのプロジェクトでも同じ**です。ただし、Claude のデスクトップアプリのセッションに、デスクトップアプリが渡すコネクタは、`managed-mcp.json` では止まりません（claude.ai の組織の設定で管理されます）。このリポジトリの開発は、ターミナルの Claude Code（CLI）で行い、デスクトップアプリのセッションは対象外にします。`playwright-mcp.sh` は、受け取った環境変数・引数を使わず、`/` に移ってから決めた環境変数だけで `npx` を動かします。

外で git を動かすスクリプトは、リポジトリの git の設定を決めた項目だけ認め、git のフック・fsmonitor・サブモジュールの中・`ext::` のリモートを使いません（`.claude/team/bin/lib/git-safety.sh`）。サンドボックスの中で書き換えたリポジトリの設定から、外のコマンドを動かさないためです。

## 入れ方

前提:

- macOS
- Claude Code 2.1.277 以上（それより前の版では、`excludedCommands` に一部が一致しただけで、`;` などでつないだコマンド全体がサンドボックスの外で動くため。managed settings の `requiredMinimumVersion` で、2.1.163〜2.1.276 は起動しなくなります。2.1.163 より前の版はこの設定を読まずに起動するため、入れる前に `claude --version` で確かめ、古ければ `claude update` で上げます）
- `jq`（`brew install jq`）
- `gh` にログインしていること（`gh auth login`）。トークンは、このリポジトリだけに絞った fine-grained personal access token（Contents・Pull requests・Issues の読み書き）を使うことを勧めます。`github.sh` はサンドボックスの外でこのトークンを使うため
- 手元の CodeRabbit レビューを使う場合は、CodeRabbit CLI を `~/.local/bin/coderabbit` に入れ、ログインしていること

ターミナルで、次を自分で実行します（管理者のパスワードを聞かれます。Claude Code には実行させません）。

```bash
# GitHub の main から入れる（ダウンロードに成功したときだけ実行する）
installer=$(mktemp) &&
  curl -fsSL https://raw.githubusercontent.com/saicologic/ai-speak-trace/main/.claude/team/install.sh -o "$installer" &&
  sudo bash "$installer"
rm -f "$installer"

# main にまだない版を入れるとき（PR でレビューしてマージしたコミットの SHA を、URL と最後の引数の両方に書く）
sha=<マージしたコミットの SHA（40 文字）>
installer=$(mktemp) &&
  curl -fsSL "https://raw.githubusercontent.com/saicologic/ai-speak-trace/$sha/.claude/team/install.sh" -o "$installer" &&
  sudo bash "$installer" "$sha"
rm -f "$installer"
```

- インストーラー（`install.sh`）も、入れるものも、手元の作業ツリーからは取りません。作業ツリーは Claude Code のサンドボックスの中から書き換えられるため、`git status` が空でも、手元のファイルを `sudo` で動かすと、レビューしていないものが root で動くおそれがあります。GitHub でレビューしてマージしたものだけを使います
- `release/*` などのブランチは直接 push できるため、ブランチの名前では入れません。`main`（ブランチ保護で PR が必須）か、レビューしてマージしたコミットの SHA を指定します。SHA は、`main` か `release/*` の履歴に入っているものだけを受け付けます（GitHub は、どのブランチにも入っていないコミットも SHA で取り出せるため）
- `install.sh` は、そのコミットを root だけが読み書きできる一時フォルダに取り出し、そこから入れます。入れたコミットは `/opt/claude-code-team/etc/installed-from` に残します
- 中身を確かめてから実行したいときは、GitHub の画面で `.claude/team/install.sh` を読んでから実行します
- スクリプトを `/opt/claude-code-team/bin` に、managed settings と MCP サーバーの設定を `/Library/Application Support/ClaudeCode/managed-settings.json`・`managed-mcp.json` に入れます。前のものがあれば、同じフォルダに `.bak` として残します。はじめて入れる前のものは、`managed-settings.json.before-claude-code-team`・`managed-mcp.json.before-claude-code-team` として別に残します
- managed settings は、**その Mac のすべてのプロジェクト**に効きます。通信先も、ほかのプロジェクトを含めて `managed-settings.json` の一覧だけになります
- Claude Code の `/status` で、managed settings が読まれていることを確かめます

`.claude/team/` か `.github/scripts/` を変える PR がマージされたら、同じ手順でもう一度入れます。入れ直すまでは、前に入れた設定のままです（たとえば `managed-mcp.json` を入れていない Mac では、プロジェクトの `.mcp.json` やプラグインの MCP サーバーが動きます）。

外すときは、次を実行します。はじめて入れる前の managed settings・MCP サーバーの設定（`*.before-claude-code-team`）があれば戻し、なければ消します（`.bak` は、入れ直す前のチームの設定のこともあるため戻しません）。

```bash
sudo rm -rf /opt/claude-code-team
dir="/Library/Application Support/ClaudeCode"
for name in managed-settings.json managed-mcp.json; do
  if [ -f "$dir/$name.before-claude-code-team" ]; then
    sudo mv "$dir/$name.before-claude-code-team" "$dir/$name"   # はじめて入れる前の設定に戻す
  else
    sudo rm -f "$dir/$name"
  fi
done
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

- push できるのは、`.claude/team/etc/github-repos` に書いたリポジトリの、`fix/*`・`feature/*`・`test/*` のブランチだけです。`main`・`release/*` へは PR で入れます。force push・ブランチの削除・タグはできません。送り元は今の HEAD と同じコミットだけです（push の前の確認は HEAD を見るため。`github.sh push -u origin HEAD:refs/heads/<ブランチ>` の形で送ります）
- push と PR・Issue への書き込みの前に、手元の CodeRabbit レビュー（`cr-gate-push.sh`）・TDD の順番（`tdd-push-gate.sh`）・CodeRabbit の枠（`cr-limit-gate.sh`）を流し、通らなければ止めます。急ぎで飛ばすときは、ユーザーの了承を得て `--skip SKIP_CR_LOOP`・`--skip SKIP_TDD_CHECK`・`--skip SKIP_CR_LIMIT` を付けます
- PR の Ready for review・マージはできません（人が行います）
- 本文のファイルは、リポジトリの中か、Claude Code のスクラッチパッドの中に置きます。`github.sh` は、ファイルを開いてからほかのファイルのハードリンクでないことを確かめ、中身を読んで `--body` で渡します
- ブラウザを開く `--web`（`-w`）は使えません

push・PR の作成の後は、`watch-pr-checks.sh`（managed settings の hook）が、`/opt/claude-code-team/bin/wait-pr-checks.sh` で CI と CodeRabbit を監視するよう Claude Code に伝えます。

## サンドボックスの中での開発

| 作業 | Claude Code（サンドボックスの中） | 開発者（自分のターミナル） |
|---|---|---|
| lint・テスト・ビルド | backend・frontend の lint・テスト・ビルドと、`src-tauri` の `cargo check` ができます | `backend/src/mcp/mcp-sandbox.spec.ts` を流します（下の説明） |
| 依存の入れ直し・追加（`npm ci`・`npm install`） | できません（managed settings の `deny`） | 行います。Rust の新しい crate を足したときの取得（`cargo fetch`）も行います |
| 画面の確認 | Playwright MCP で `localhost` の画面を確かめます | `npm run dev` でサーバーを起動しておきます |
| 外部の API（ElevenLabs・Claude・Amazon Bedrock）につなぐ確認 | できません | PR の「## 手動確認項目」で確かめます |

- `mcp-sandbox.spec.ts` は、`sandbox-exec` で MCP サーバーをサンドボックスに入れて確かめるテストです。サンドボックスの中からもう1つサンドボックスは作れない（`sandbox_apply: Operation not permitted`）ため、Claude Code の中では飛ばします。CI（ubuntu）にも `sandbox-exec` がないため飛ばします。MCP サーバーの仕組み（`backend/scripts/mcp-sandbox.*`・`backend/src/mcp/`）を変えたときは、開発者が `cd backend && npx jest src/mcp/mcp-sandbox.spec.ts` を流して確かめます
- `npm ci`・`npm install` は、サンドボックスの中では npm のキャッシュ（`~/.npm`）に書けず、保護されたファイル（`.vscode/settings.json` など）も消せないため、`node_modules` を消した後に途中で止まり、壊れたまま残ります。依存を足すときも、Claude Code は `package.json` の変更を提案し、開発者が入れます
- Claude Code はサーバーを起動できません（ポートを開けないため）。Playwright MCP はサンドボックスの外で動くため、開発者が起動したサーバーを開けます。外の URL を開く（`browser_navigate`）・ページで JavaScript を動かす（`browser_evaluate`）・手元のファイルをページに渡す（`browser_file_upload`）操作は毎回ユーザーに確かめ、Playwright のサーバーの中で任意のコードを動かす操作（`browser_run_code_unsafe`）は使えません。Playwright MCP のブラウザは、つながらないプロキシ（`http://127.0.0.1:9`）を通し、`localhost`・`127.0.0.1` だけを例外にしているため、外のサイトにはつながりません（ページの JavaScript・リダイレクトも同じ）。プロキシを通らない WebRTC の UDP も、Chrome の起動引数で止めています（`/opt/claude-code-team/etc/playwright-mcp.json`）。Playwright MCP の `--allowed-origins` は、README に「守りにはならない」とあるため使いません

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
| `open`・`osascript` が失敗する | サンドボックスでは使えません。開発者が自分のターミナルで実行します |
| 開発サーバーを起動できない（`listen EPERM`） | サンドボックスでは、ポートを開けません。開発者が自分のターミナルで起動します。`sandbox.network.allowLocalBinding` を入れるとポートを開けますが、自分の Mac の中で待ち受けているすべてのアプリにつなげるようになり、ポートを絞れないため、入れません |
| `npm ci`・`npm install` が断られる | サンドボックスの中では途中で止まって `node_modules` が壊れるため、managed settings で止めています。開発者が自分のターミナルで実行します |
| Playwright MCP が起動しない | `/opt/claude-code-team/bin/playwright-mcp.sh` と `managed-mcp.json` を入れたか（`install.sh`）と、Node.js が `/opt/homebrew/opt/node@24/bin`・`/opt/homebrew/bin`・`/usr/local/bin` のどれかにあるかを確かめます（受け取った `PATH` は使いません） |
| ElevenLabs・Claude API・Amazon Bedrock につなぐ確認 | サンドボックスからはつながらず、`~/.aws` も読めません。アプリの起動などは開発者が行います（PR の「## 手動確認項目」） |

## 外にデータを出させない守り

サンドボックスの外で動くツール（ファイルを読む・書くツール、`github.sh`）を使って、手元の情報を外に出したり、あとから外でコマンドを動かしたりさせないため、次のようにしています。

| 道 | 守り |
|---|---|
| 公開のリポジトリの PR・Issue に書く | `github.sh` の PR・Issue への文章の書き込みは、毎回ユーザーに確かめます（managed settings の `ask`）。タイトル・本文に API キー・トークン・秘密鍵の形があれば、`github.sh` が止めます |
| push するコードに入れる | まだ送っていないコミットで足した行に、API キー・トークン・秘密鍵の形があれば、`github.sh` が止めます（後のコミットで消しても、前のコミットに残るため） |
| 秘密の情報を読む | `~/.ssh`・`~/.aws`・クラウドの認証情報・ブラウザの Cookie・パスワード・メールなどを読ませません（managed settings の `Read` の deny。サンドボックスにも同じものが加わります） |
| あとから外でコマンドを動かす | シェルの起動ファイル（`~/.zshrc`・`~/.config/fish` など）・`~/Library/LaunchAgents`・`/Users`・`/Volumes` の下のリポジトリの git の hook と設定（worktree ごとの設定を含む。テストが一時フォルダに作るリポジトリは除く）・`.npmrc`・`.cargo/config*`・Python が起動のたびに読むファイル（`site-packages` の `*.pth`・`sitecustomize.py`・`usercustomize.py`）・`.envrc`・`.vscode`・Claude Code の個人の設定を、ファイルを書くツールで書き換えさせません（`Edit` の deny） |
| 個人・プロジェクトの設定に hook を足す | managed settings の hook だけを動かします（`allowManagedHooksOnly`）。**この Mac のほかのプロジェクトでも、個人の設定の hook は動きません** |

GitHub の secret scanning の push protection（リポジトリの設定）も、あわせて有効にします。開発者が自分のターミナルで push するときも、秘密の情報を止めます。

## 守りの限界

- サンドボックスと hook は、うっかりや、読み込んだ文書に仕込まれた指示（プロンプトインジェクション）による操作を止めるためのものです。Mac の管理者の権限を持つ開発者は、managed settings を外せます
- 最後の守りは、GitHub のブランチ保護と必須チェック（`tdd-order`・`backend-test`・`frontend-test`・`build`）です
- 秘密の情報の形の確かめは、決めた形（Anthropic・AWS のアクセスキー・GitHub・ElevenLabs・Slack のトークン、PEM の秘密鍵）だけを見ます。形を変えたもの（区切る・符号にする）は止められません。PR・Issue への書き込みを毎回確かめるのは、このためです
- 開発者が自分のターミナルで動かすもの（`npm run dev`・`npm test` など）は、Claude Code が書き換えたコードをサンドボックスの外で動かします。コードの変更は、レビューしてから動かします（`package.json` の `scripts`・依存のパッケージなど、書き換えを止めていないものも同じです）
