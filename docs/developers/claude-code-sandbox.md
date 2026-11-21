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
| サンドボックスの外で動くスクリプト | `.claude/team/bin/` → `/opt/claude-code-team/bin/`（root の持ち物） | GitHub への操作（`github.sh`）・手元の CodeRabbit レビュー（`cr-review.sh`）・PR の監視（`wait-pr-checks.sh`）・push の前の確認（`cr-gate-push.sh`・`tdd-push-gate.sh`）・hook（下の「[hook の一覧](#hook-の一覧)」）・Playwright MCP の起動（`playwright-mcp.sh`） |
| リポジトリの設定 | `.claude/settings.json` | 許可するコマンド（hook は書かない） |

### サンドボックスの外で動かすものを、インストール先だけにする理由

- managed settings でサンドボックスを管理者が決める状態にすると、リポジトリの設定に書いた `sandbox.excludedCommands`（サンドボックスの外で動かすコマンド）と通信先は無視されます。clone したリポジトリが、コマンドをサンドボックスの外に出せないようにするためです
- そのため、外で動かすスクリプトは、リポジトリの中のファイルではなく、root の持ち物として `/opt/claude-code-team/bin` に入れたものだけにしています
- hook もサンドボックスの外で動きます。作業ツリーのファイル（`.github/scripts`・`.claude/hooks` など）はサンドボックスの中から書き換えられるため、hook や外で動くスクリプトから動かしません。hook はリポジトリの設定には書かず、managed settings からインストール先のものだけを動かします
- TDD の順番の確認（`tdd-push-gate.sh`）は、`install.sh` が `/opt/claude-code-team/bin/ci` に入れた `.github/scripts` を使います
- 外で git を動かすスクリプトは、リポジトリの git の設定を決めた項目だけ認め、git のフック・fsmonitor・サブモジュールの中・`ext::` のリモートを使いません（`.claude/team/bin/lib/git-safety.sh`）。サンドボックスの中で書き換えたリポジトリの設定から、外のコマンドを動かさないためです

### MCP サーバー

- MCP サーバーもサンドボックスの外で動きます。動かす MCP サーバーは、`.claude/team/managed-mcp.json` → `/Library/Application Support/ClaudeCode/managed-mcp.json`（root の持ち物）で、インストール先の Playwright MCP（`playwright-mcp.sh`）だけに決めます
- このファイルがあると、プロジェクトの `.mcp.json`・プラグイン・claude.ai のコネクタ・`--mcp-config` で足したサーバーは動きません（[公式のドキュメント](https://code.claude.com/docs/en/managed-mcp)）。組み込みの Claude in Chrome も止まります（普段のログイン中の Chrome を操作させないため、使えるようにしていません）。**この Mac のほかのプロジェクトでも同じ**です
- ただし、Claude のデスクトップアプリのセッションに、デスクトップアプリが渡すコネクタは、`managed-mcp.json` では止まりません（claude.ai の組織の設定で管理されます）。このリポジトリの開発は、ターミナルの Claude Code（CLI）で行い、デスクトップアプリのセッションは対象外にします
- `playwright-mcp.sh` は、受け取った環境変数・引数を使わず、`/` に移ってから決めた環境変数だけで `npx` を動かします。Playwright MCP の守りは、下の「[Playwright MCP](#playwright-mcp)」に書きます

## 入れ方

### 前提

- macOS
- Claude Code 2.1.295 以上。入れる前に `claude --version` で確かめ、古ければ `claude update` で上げます
  - 2.1.277 より前の版: `excludedCommands` に一部が一致しただけで、`;` などでつないだコマンド全体がサンドボックスの外で動きます
  - 2.1.295 より前の版: hook が失敗したときに操作を止める `onFailure` が効きません
  - managed settings の `requiredMinimumVersion` で、2.1.163〜2.1.294 は起動しなくなります。2.1.163 より前の版は、この設定を読まずに起動します
- `jq`（`brew install jq`）
- Node.js（`brew install node@24`）。Playwright MCP と、ページを開く hook が使います。開いた後の hook は `perl`（macOS に入っているもの）も使います
- `gh` にログインしていること（`gh auth login`）。トークンは、このリポジトリだけに絞った fine-grained personal access token（Contents・Pull requests・Issues の読み書き）を使うことを勧めます。`github.sh` はサンドボックスの外でこのトークンを使うためです
- 手元の CodeRabbit レビューを使う場合は、CodeRabbit CLI を `~/.local/bin/coderabbit` に入れ、ログインしていること

### 入れる

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
- スクリプトを `/opt/claude-code-team/bin` に、managed settings と MCP サーバーの設定を `/Library/Application Support/ClaudeCode/managed-settings.json`・`managed-mcp.json` に入れます
  - 前のものがあれば、同じフォルダに `.bak` として残します
  - はじめて入れる前のものは、`managed-settings.json.before-claude-code-team`・`managed-mcp.json.before-claude-code-team` として別に残します
- managed settings は、**その Mac のすべてのプロジェクト**に効きます。通信先も、ほかのプロジェクトを含めて `managed-settings.json` の一覧だけになります
- Claude Code の `/status` で、managed settings が読まれていることを確かめます

### 入れ直す・起動し直す

`.claude/team/` か `.github/scripts/` を変える PR がマージされたら、同じ手順でもう一度入れます。入れ直すまでは、前に入れた設定のままです（たとえば `managed-mcp.json` を入れていない Mac では、プロジェクトの `.mcp.json` やプラグインの MCP サーバーが動きます）。

入れた後（入れ直した後も）は、次の手順で Claude Code を起動し直します。managed settings はファイルを変えるとその場で読み直されますが、MCP サーバー（Playwright MCP）は、起動したときのプロセスが動き続けるため、起動し直すまで前の起動の仕方（前の守り）のままです。ほかのセッション（Orca のほかのタブなど）が動かしているものや、終わったセッションに残ったものもあります。

1. 開いている Claude Code のセッションを、すべて終了します（`/exit`）
2. 残っている Playwright MCP を止め、何も残っていないことを確かめます

   ```bash
   pkill -f "npm exec @playwright/mcp@"
   ps -axo pid,lstart,command | grep -E "playwright/mcp" | grep -v grep
   ```

3. Claude Code を起動し、Playwright MCP を一度使ってから、新しい起動の仕方で動いていることを確かめます。行に `--proxy-server http://127.0.0.1:9`・`--proxy-bypass <-loopback>,localhost,127.0.0.1`・`--config /opt/claude-code-team/etc/playwright-mcp.json` があれば、入れたものが動いています

   ```bash
   ps -axo pid,lstart,command | grep -E "playwright/mcp" | grep -v grep
   ```

### 外す

次を実行します。はじめて入れる前の managed settings・MCP サーバーの設定（`*.before-claude-code-team`）があれば戻し、なければ消します（`.bak` は、入れ直す前のチームの設定のこともあるため戻しません）。

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

- push できるのは、`.claude/team/etc/github-repos` に書いたリポジトリの、`fix/*`・`feature/*`・`test/*` のブランチだけです。`main`・`release/*` へは PR で入れます
  - force push・ブランチの削除・タグはできません
  - 送り元は今の HEAD と同じコミットだけです（push の前の確認は HEAD を見るため。`github.sh push -u origin HEAD:refs/heads/<ブランチ>` の形で送ります）
- push と PR・Issue への書き込みの前に、手元の CodeRabbit レビュー（`cr-gate-push.sh`）・TDD の順番（`tdd-push-gate.sh`）・CodeRabbit の枠（`cr-limit-gate.sh`）を流し、通らなければ止めます。急ぎで飛ばすときは、ユーザーの了承を得て `--skip SKIP_CR_LOOP`・`--skip SKIP_TDD_CHECK`・`--skip SKIP_CR_LIMIT` を付けます
- PR・Issue への文章の書き込みは、毎回ユーザーに確かめます（managed settings の `ask`）
- PR の Ready for review・マージはできません（人が行います）
- 本文のファイルは、リポジトリの中か、Claude Code のスクラッチパッドの中に置きます。`github.sh` は、ファイルを開いてからほかのファイルのハードリンクでないことを確かめ、中身を読んで `--body` で渡します
- ブラウザを開く `--web`（`-w`）は使えません

## hook の一覧

hook は managed settings からだけ動かし（`allowManagedHooksOnly`）、どれもインストール先（`/opt/claude-code-team/bin`）のものです。テストは `.claude/team/tests/` にあります。

| hook | 動くとき | すること | hook が動かない・失敗したとき |
|---|---|---|---|
| `block-ai-speak-trace-secrets.sh` | Bash を動かす前 | アプリの API キーを含む設定ファイル・API・項目名に触れるコマンドを止める | `jq` が動かなければ止める |
| `cr-limit-gate.sh` | Bash を動かす前 | CodeRabbit の枠切れの間、レビューを動かす操作（`gh pr create`・`git push` など）を止める | 枠を調べられなければ止めない |
| `playwright-navigate-pre.sh` | Playwright MCP でページ・タブを開く前 | URL を見て、確認なしで開く・確かめる・開かない、を決める（下の「[Playwright MCP](#playwright-mcp)」） | 開かない（`onFailure: block`） |
| `playwright-navigate-post.sh` | Playwright MCP でページ・タブを開いた後 | 確認で許可して開けたサイトを、許可したサイトの一覧に足す（1 つずつ順に動く） | 足さずに理由を伝える（次も確認が出る） |
| `watch-pr-checks.sh` | Bash を動かした後 | push・PR の作成の後に、`wait-pr-checks.sh` で CI と CodeRabbit を監視するよう伝える | 何もしない |
| `reply-language-check.sh` | 返答の終わり（Stop） | 返答の最後のメッセージが英語なら、日本語で書き直させる（下の「[返答の言語の確認](#返答の言語の確認)」） | 止めない |

## サンドボックスの中での開発

| 作業 | Claude Code（サンドボックスの中） | 開発者（自分のターミナル） |
|---|---|---|
| lint・テスト・ビルド | backend・frontend の lint・テスト・ビルドと、`src-tauri` の `cargo check` ができます | `backend/src/mcp/mcp-sandbox.spec.ts` を流します（下の説明） |
| 依存の入れ直し・追加（`npm ci`・`npm install`） | できません（managed settings の `deny`） | 行います。Rust の新しい crate を足したときの取得（`cargo fetch`）も行います |
| 画面の確認 | Playwright MCP で `localhost` の画面を確かめます（下の「[Playwright MCP](#playwright-mcp)」） | `npm run dev` でサーバーを起動しておきます |
| 外部の API（ElevenLabs・Claude・Amazon Bedrock）につなぐ確認 | できません | PR の「## 手動確認項目」で確かめます |

- `mcp-sandbox.spec.ts` は、`sandbox-exec` で MCP サーバーをサンドボックスに入れて確かめるテストです
  - サンドボックスの中からもう1つサンドボックスは作れない（`sandbox_apply: Operation not permitted`）ため、Claude Code の中では飛ばします。CI（ubuntu）にも `sandbox-exec` がないため飛ばします
  - MCP サーバーの仕組み（`backend/scripts/mcp-sandbox.*`・`backend/src/mcp/`）を変えたときは、開発者が `cd backend && npx jest src/mcp/mcp-sandbox.spec.ts` を流して確かめます
- `npm ci`・`npm install` は、サンドボックスの中では npm のキャッシュ（`~/.npm`）に書けず、保護されたファイル（`.vscode/settings.json` など）も消せないため、`node_modules` を消した後に途中で止まり、壊れたまま残ります。依存を足すときも、Claude Code は `package.json` の変更を提案し、開発者が入れます
- Claude Code はサーバーを起動できません（ポートを開けないため）。Playwright MCP はサンドボックスの外で動くため、開発者が起動したサーバーを開けます

## Playwright MCP

画面の確認に使う Playwright MCP は、サンドボックスの外で動きます。手元のファイルを読んだり、外のサイトに送ったりさせないため、次のようにしています。

### つながる先

- ブラウザは、つながらないプロキシ（`http://127.0.0.1:9`）を通し、`localhost`・`127.0.0.1` だけを例外にしているため、外のサイトにはつながりません（ページの JavaScript・リダイレクトも同じ）
- プロキシを通らない WebRTC の UDP も、Chrome の起動引数で止めています（`/opt/claude-code-team/etc/playwright-mcp.json`）
- Playwright MCP の `--allowed-origins` は、README に「守りにはならない」とあるため使いません

### 操作ごとの扱い

| 操作 | 扱い | 理由 |
|---|---|---|
| ページを開く（`browser_navigate`）・URL を渡して新しいタブを開く（`browser_tabs`） | hook（`playwright-navigate-pre.sh`・`playwright-navigate-post.sh`）が URL を見て決める（下の表） | `file://` で手元のファイルを読めるため |
| URL のない `browser_tabs`（一覧・閉じる・選ぶ） | hook では決めず、ふだんの権限の設定のとおり | ページを開かないため |
| ページで JavaScript を動かす（`browser_evaluate`） | 確かめずに許可する | 画面の確認で何度も使うため（下の「[受け入れた危険](#受け入れた危険)」） |
| 手元のファイルをページに渡す（`browser_file_upload`・`browser_drop`） | 毎回ユーザーに確かめる | サンドボックスの外から手元のファイルを読むため |
| Playwright のサーバーの中で任意のコードを動かす（`browser_run_code_unsafe`） | 使えない | サンドボックスの外で、どんなコードでも動かせるため |

### ページを開くときの判断

| URL | 判断 |
|---|---|
| 許可したサイト（初めは開発用の画面の `http://localhost:5173`・`http://127.0.0.1:5173`） | 確認なしで開く |
| 初めてのサイト | 確かめる。確認で許可して開けたら、一覧に足し、次からは確かめない |
| http・https 以外の URL（`file:`・`data:`・`javascript:` など） | 開かない |
| ユーザー名・パスワードの付いた URL・文字列でない URL | 開かない |
| URL を確かめられないとき（Node が見つからない・判断のスクリプトが失敗した・hook が起動できない・時間切れ） | 開かない |

- hook はサンドボックスの外で動くため、受け取った `PATH`・`NODE_OPTIONS`・`PERL5OPT`・`PERL5LIB`・`PERLLIB` を使いません。Node は、Playwright MCP と同じ決めた場所（`/opt/homebrew/opt/node@24/bin`・`/opt/homebrew/bin`・`/usr/local/bin` など）から探します
- 確認で許可したかは、開く前の hook が `tool_use_id` ごとに記録し、開いた後の hook がその呼び出しだけを一覧に足します（確認せずに開いた呼び出しや、URL が変わったときは足しません）
- 開いた後の hook は、Playwright MCP の結果の最初の `### Page` の節の `- Page URL:` の行から、実際に着いたページを読みます（ページの中身に書かれた同じ形の行は使いません）。足すのは、着いたページが確認したサイトと同じときだけです
  - リダイレクトで別のサイトに着いたときと、開くのに失敗したとき（結果が `### Error`）は、足しません（次も確認が出ます）
  - 結果から着いたページを読めないときは、足さずに理由を伝えます

### 許可したサイトの一覧

- 一覧は `~/.claude/state/playwright-allowed-origins` です（1 行に 1 つのオリジン。`#` で始まる行は読み飛ばします）
- Claude Code からは書き換えられません（サンドボックスの中からは書けず、ファイルを書くツールも managed settings の deny で止めます）
- サイトを外すときは、その行を自分で消します。hook は一覧全体を読み直して書き換えるため、Claude Code がページを開いていないときに直します（足している最中に直すと、直した内容が戻ることがあります）
- 外のサイトは、一覧に足しても開けません（上のプロキシで止まるため）
- 開いた後の hook は、`perl` の `flock`（`playwright-allowed-origins.flock`）で 1 つずつ順に動きます。`flock` は、hook が落ちても OS が外します。ほかの hook を待つのは 3 秒までで、取れなければ足さずに理由を伝えます
- 一覧に足すときは、さらにロック（`playwright-allowed-origins.lock`）を取ってから、一覧全体を一時ファイルに書いて入れ替えます。落ちた hook のロックが残っても、30 秒たてば片付けます

### 受け入れた危険

- hook が確かめるのは、`browser_navigate` で開くときと、`browser_tabs` で URL を渡して新しいタブを開くときだけです。開いたページのリンクのクリック・リダイレクト・`browser_evaluate` でページを移ると、許可していない `localhost`・`127.0.0.1` のポートにも確認なしで移れます（外のサイトには、上のプロキシでつながりません）
- `browser_evaluate` を確かめずに許可するため、アプリのページの中から、手元のバックエンドの API を直接呼ぶことは確認なしでできます（文字起こしの削除や、Claude・ElevenLabs への送信など、画面に出ない操作も含む）

## 返答の言語の確認

返答の最後のメッセージが英語のときは、`reply-language-check.sh`（managed settings の Stop の hook）が止めて、日本語で書き直させます。

- 数える前に、言語の判断に関係しない部分を除きます: コードブロック（囲みのものと、空の行の後に字下げしたもの）・インラインコード・引用の行・URL・メールアドレス・ファイルの場所とファイルの名前
- 残った文で、日本語の文字（ひらがな・カタカナ・漢字）と英字（A〜Z・a〜z）を数えます（数字・記号は数えません）。合わせた数のうち、日本語の文字が 2 割より少ないときに英語とみなします
- 次のときは止めません
  - 数えた文字が 40 より少ない短い返答
  - 書き直した返答（もう一度は止めません）
  - Claude Code から `node` が見つからないとき（入れ直しでは直らないので、`node` が `PATH` にあるかを確かめます）

## 変えたいとき

| 変えたいもの | 変える場所 |
|---|---|
| 通信先（npm 以外のレジストリなど） | `.claude/team/managed-settings.json` の `sandbox.network.allowedDomains` |
| push してよいリポジトリ | `.claude/team/etc/github-repos` |
| Claude Code に確認なしで許可するコマンド | `.claude/settings.json` の `permissions.allow` |
| 禁止するコマンド・読み取り | `.claude/team/managed-settings.json` の `permissions.deny` |
| `github.sh`・hook などの動き | `.claude/team/bin/`（テストは `.claude/team/tests/`） |
| Playwright MCP で確認なしで開くサイト | 各自の `~/.claude/state/playwright-allowed-origins`（確認で許可すると足されます。初めから許可するサイトは `.claude/team/bin/lib/playwright-navigate-gate.mjs`） |

どれも PR で変えます（各自の一覧を除く）。`.claude/team/tests/managed-settings.test.sh` が、サンドボックスを切る・通信先に `*` や GitHub を入れる・外で動かすものにインストール先以外を入れる、などの変更を止めます。個人の設定（`~/.claude/settings.json`・`.claude/settings.local.json`）で、守りを弱めないでください（managed settings の項目は上書きできません）。

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
| Playwright MCP で、どのページも開けない | ページを開く hook が `node` を見つけられないか、hook を入れていません。上と同じ場所に Node.js があるかと、`install.sh` で入れ直したかを確かめます |
| 許可したはずのサイトで、毎回確認が出る | 開いた後の hook が一覧に足せていません。リダイレクトで別のサイトに着いていないかと、hook が伝えた理由を見て、`~/.claude/state/playwright-allowed-origins` の権限を直すか、オリジンの行を自分で足します |
| ElevenLabs・Claude API・Amazon Bedrock につなぐ確認 | サンドボックスからはつながらず、`~/.aws` も読めません。アプリの起動などは開発者が行います（PR の「## 手動確認項目」） |

## 外にデータを出させない守り

サンドボックスの外で動くツール（ファイルを読む・書くツール、`github.sh`、Playwright MCP）を使って、手元の情報を外に出したり、あとから外でコマンドを動かしたりさせないため、次のようにしています。

| 道 | 守り |
|---|---|
| 公開のリポジトリの PR・Issue に書く | `github.sh` の PR・Issue への文章の書き込みは、毎回ユーザーに確かめます（managed settings の `ask`）。タイトル・本文に API キー・トークン・秘密鍵の形があれば、`github.sh` が止めます |
| push するコードに入れる | まだ送っていないコミットで足した行に、API キー・トークン・秘密鍵の形があれば、`github.sh` が止めます（後のコミットで消しても、前のコミットに残るため） |
| 秘密の情報を読む | `~/.ssh`・`~/.aws`・クラウドの認証情報・ブラウザの Cookie・パスワード・メールなどを、`Read`・Bash では読ませません（managed settings の `Read` の deny。サンドボックスにも同じものが加わります）。Playwright MCP で `file://` の URL を開くこと（`browser_navigate`・`browser_tabs`）も、hook で止めます（上の「[Playwright MCP](#playwright-mcp)」） |
| あとから外でコマンドを動かす | シェルの起動ファイル（`~/.zshrc`・`~/.config/fish` など）・`~/Library/LaunchAgents`・`/Users`・`/Volumes` の下のリポジトリの git の hook と設定（worktree ごとの設定を含む。テストが一時フォルダに作るリポジトリは除く）・`.npmrc`・`.cargo/config*`・Python が起動のたびに読むファイル（`site-packages` の `*.pth`・`sitecustomize.py`・`usercustomize.py`）・`.envrc`・`.vscode`・Claude Code の個人の設定を、ファイルを書くツールで書き換えさせません（`Edit` の deny） |
| 個人・プロジェクトの設定に hook を足す | managed settings の hook だけを動かします（`allowManagedHooksOnly`）。**この Mac のほかのプロジェクトでも、個人の設定の hook は動きません** |

GitHub の secret scanning の push protection（リポジトリの設定）も、あわせて有効にします。開発者が自分のターミナルで push するときも、秘密の情報を止めます。

## 守りの限界

- サンドボックスと hook は、うっかりや、読み込んだ文書に仕込まれた指示（プロンプトインジェクション）による操作を止めるためのものです。Mac の管理者の権限を持つ開発者は、managed settings を外せます
- 最後の守りは、GitHub のブランチ保護と必須チェック（`tdd-order`・`backend-test`・`frontend-test`・`build`）です
- 秘密の情報の形の確かめは、決めた形（Anthropic・AWS のアクセスキー・GitHub・ElevenLabs・Slack のトークン、PEM の秘密鍵）だけを見ます。形を変えたもの（区切る・符号にする）は止められません。PR・Issue への書き込みを毎回確かめるのは、このためです
- 開発者が自分のターミナルで動かすもの（`npm run dev`・`npm test` など）は、Claude Code が書き換えたコードをサンドボックスの外で動かします。コードの変更は、レビューしてから動かします（`package.json` の `scripts`・依存のパッケージなど、書き換えを止めていないものも同じです）
