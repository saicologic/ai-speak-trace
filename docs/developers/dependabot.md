# Dependabot の PR の対応

Dependabot の PR は、チームの全員が同じ決まりで扱います。

**決まり: Dependabot の PR は `main` に直接マージせず、宛先を `release/vX.Y.Z` に変えて、バージョン付きのリリースと DMG をセットにする。**

## なぜ `release/*` を通すのか

| 理由 | 内容 |
|---|---|
| DMG に依存関係が焼き込まれる | `backend/`・`frontend/`・`src-tauri/` の依存は、ビルドしたときの版が DMG に入る。`main` に入れただけでは、利用者は古い依存の DMG を使い続ける |
| DMG はワークフローで作る | DMG は `release.yml`（`tag-release.yml` が起動する）で作る。Actions の更新を `main` に直接入れると、新しい `release.yml` が本番のリリースで初めて動き、失敗してもリリースの後でしか分からない |
| `.github/` は `main` へ直接の例外に含めない | `main` へ直接PRを作ってよいのは、Markdown と `docs/` だけを変える場合に限る。`dependabot-comment.yml` のように DMG に影響しないワークフローの更新も、同じく `release/*` を通す |

## エコシステムごとの対象

| エコシステム | 対象のディレクトリ | DMG への影響 |
|---|---|---|
| npm | `backend/`・`frontend/` | ある（sidecar とフロントエンドに入る） |
| cargo | `src-tauri/` | ある（Tauri のアプリに入る） |
| github-actions | `.github/workflows/` | `release.yml`・`tag-release.yml` を変えるものはある。それ以外もワークフローの変更なので `release/*` を通す |

設定は `.github/dependabot.yml` にあります。どのエコシステムも `main` 宛てに PR が来ます（`target-branch` は付けていません）。github-actions の版上げ（version updates）は、1つの PR にまとめています（[公式: `groups`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--)。`applies-to` を付けないときは version updates だけがまとまり、セキュリティの更新は別の PR で来ます）。

セキュリティの更新は、`target-branch` を付けていても、いつも既定のブランチ（`main`）宛てに来ます（[公式: `target-branch`](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)）。そのため、宛先の変更（下の手順 2）は毎回必要です。

## 手順

| 手順 | 誰が | 内容 |
|---|---|---|
| 1 | ユーザー | `main` から `release/vX.Y.Z` を作り、`src-tauri/tauri.conf.json` のバージョンを更新して push する |
| 2 | Claude Code（またはユーザー） | Dependabot の PR の宛先を `release/vX.Y.Z` に変え、`no-tdd` ラベルを付ける |
| 3 | ユーザー | CI が通ったら、`release/vX.Y.Z` にマージする |
| 4 | ユーザー | `release/vX.Y.Z` → `main` の PR をマージする前に、GitHub の Actions の画面で `release.yml`（Release）を `workflow_dispatch` でリリースブランチに対して動かし、`dmg` の artifact ができることを確かめる |
| 5 | ユーザー | `release: vX.Y.Z` の PR を `main` にマージする（タグ・DMG のリリースは自動で作られる） |

手順 1・3〜5 は、CLAUDE.md の「リリース手順」と同じです。

### Claude Code で行うとき

Bash のサンドボックスからは GitHub に届かないため、`/opt/claude-code-team/bin/github.sh` を使います（[Claude Code のサンドボックスと GitHub への操作](claude-code-sandbox.md)）。

| したいこと | コマンド |
|---|---|
| 開いている Dependabot の PR を一覧にする | `/opt/claude-code-team/bin/github.sh pr list --author app/dependabot --state open`（必要に応じて `--json number,title,baseRefName,labels` を付ける） |
| PR が変えたファイルを見る | `/opt/claude-code-team/bin/github.sh pr diff <番号> --name-only` |
| 宛先を変える | `/opt/claude-code-team/bin/github.sh pr edit <番号> --base release/vX.Y.Z` |
| ラベルを付ける | `/opt/claude-code-team/bin/github.sh pr edit <番号> --add-label no-tdd` |

宛先の変更・ラベルの追加は PR への書き込みなので、毎回ユーザーに確かめてから行います。

## 判断の基準

| 確かめること | どうするか |
|---|---|
| 勧告（GHSA・RUSTSEC）を直す更新か | 直すなら、パッチリリース（X.Y.**Z**）にする。CLAUDE.md の「セキュリティパッチのリリース方針」に従い、出ている中で一番新しいパッチの版から `release/vX.Y.Z` を作る |
| 勧告のない版上げか | 急がない。次のパッチリリースに一緒に入れてよい |
| DMG に影響するか | 影響しても影響しなくても `release/*` を通す。影響するものは、手順 4 の DMG の確認を必ずする |
| メジャー版上げか | マージの前に、公式のリリースノート（GitHub のリリースのページ・CHANGELOG）で互換を確かめる。Actions の場合、`with:` の入力・`node` の版・権限の変更を見る |
| `workflow_run` で動くワークフローか（`dependabot-comment.yml`） | `workflow_run` は既定のブランチのワークフローで動くため、マージした後でしか確かめられない。そのことを PR に書く（[公式: `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)） |

### 勧告の確かめ方

| 対象 | 確かめ方 |
|---|---|
| `backend/`・`frontend/` | それぞれのディレクトリで `npm audit` を流す（[npm audit](https://docs.npmjs.com/cli/commands/npm-audit)） |
| `src-tauri/` | `src-tauri/` で `cargo audit` を流す（[RustSec](https://rustsec.org/)） |
| CI | `audit.yml`（Audit）が、依存を変えた PR と毎週、同じ確認を流す |

Dependabot の PR の本文にある GHSA・RUSTSEC の番号も、勧告を直すかどうかの手がかりになります。

## 今後

この決まりを確かめる仕組み（`main` 宛ての Dependabot の PR を止める CI の必須チェック・Dependabot の PR への自動のラベル・`.claude/team` での確認）は、次の版で作ります。
