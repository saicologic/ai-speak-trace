# コード署名・公証の設定

## 概要

macOS Gatekeeperによる警告を回避するため、Apple Developer Programに登録してコード署名・公証を設定する手順を説明します。

---

## 手順

### 1. Apple Developer Programへの登録

**URL:** https://developer.apple.com/programs/enroll/

1. 上記URLにアクセスしてApple IDでサインイン
2. 個人または組織としての登録種別を選択
3. 年間 $99 を支払い
4. Appleによる審査完了を待つ（数日〜1週間）

---

### 2. CSRの生成（Keychain Access）

**Keychain Access.app** でAppleに提出する証明書要求ファイル（CSR）を作成します。

1. Spotlight（`Cmd + Space`）で「キーチェーンアクセス」を検索して開く
2. メニューバーから **「キーチェーンアクセス」→「証明書アシスタント」→「認証局に証明書を要求...」** を選択
3. 以下を入力:

| 項目 | 入力値 |
|---|---|
| メールアドレス | Apple IDのメールアドレス |
| 通称 | 任意（例: `AI Speak Trace`） |
| CAのメールアドレス | 空欄 |
| 要求の処理 | **「ディスクに保存」** を選択 |

4. 「続ける」をクリックして `.certSigningRequest` ファイルを保存（デスクトップ推奨）

---

### 3. Developer ID Application 証明書の発行

**URL:** https://developer.apple.com/account/resources/certificates

1. 上記URLにアクセス
2. **「＋」ボタン** をクリック
3. 「Software」セクションから **「Developer ID Application」** を選択して「続ける」
4. 手順2で作成した `.certSigningRequest` ファイルをアップロード
5. 「続ける」→ **`.cer` ファイルをダウンロード**

---

### 4. 証明書のインポートと確認（Keychain Access）

1. ダウンロードした `.cer` ファイルを**ダブルクリック**
2. 「ログイン」キーチェーンを選択して「追加」
3. Keychain Accessを開き、左サイドバーで **「ログイン」×「自分の証明書」** を選択
4. 以下の表示を確認:

```
▶ Developer ID Application: 名前 (TEAMID)
```

> **▶ がある** = 秘密鍵が紐付いている（正常）
> **▶ がない** = 秘密鍵がない → トラブルシューティングを参照

5. ターミナルで証明書IDを確認:

```bash
security find-identity -v -p codesigning
```

以下のように表示されれば成功:

```
1) ABC123... "Developer ID Application: SATORU MIKAMI (2M2QV9R792)"
   1 valid identities found
```

---

### 5. App-specific passwordの生成

**URL:** https://appleid.apple.com

1. 上記URLにApple IDでサインイン
2. 「**サインインとセキュリティ**」→「**App用パスワード**」→「**＋**」をクリック
3. 名前を入力（例: `ai-speak-trace-ci`）して「作成」
4. `xxxx-xxxx-xxxx-xxxx` 形式のパスワードが表示される（**この画面を閉じると二度と表示されないので必ず控える**）

---

### 6. .p12のエクスポートとBase64変換

1. Keychain Accessで **「Developer ID Application: ...」** を右クリック
2. **「"Developer ID Application: ..."を書き出す...」** を選択
3. 以下の設定で保存:

| 項目 | 設定値 |
|---|---|
| ファイル名 | `certificate.p12` |
| 保存先 | デスクトップ |
| パスワード | 任意のパスワードを設定（`APPLE_CERTIFICATE_PASSWORD` として使用） |

4. ターミナルでBase64に変換してクリップボードにコピー:

```bash
base64 -i ~/Desktop/certificate.p12 | pbcopy
```

---

### 7. GitHub Secretsへの登録

**URL:** https://github.com/saicologic/ai-speak-trace/settings/secrets/actions

1. 上記URLにアクセス
2. **「New repository secret」** をクリック
3. 以下の6つを1つずつ登録:

| Secret名 | 値の取得方法 | 関連リンク |
|---|---|---|
| `APPLE_SIGNING_IDENTITY` | `security find-identity -v -p codesigning` の出力文字列全体 | https://developer.apple.com/account/resources/certificates |
| `APPLE_CERTIFICATE` | 手順6で `pbcopy` したBase64文字列 | — |
| `APPLE_CERTIFICATE_PASSWORD` | 手順6で `.p12` エクスポート時に設定したパスワード | — |
| `APPLE_ID` | 自分のApple IDメールアドレス | https://appleid.apple.com |
| `APPLE_PASSWORD` | 手順5で生成した App用パスワード（`xxxx-xxxx-xxxx-xxxx` 形式） | https://appleid.apple.com |
| `APPLE_TEAM_ID` | `APPLE_SIGNING_IDENTITY` の末尾の括弧内の値（例: `2M2QV9R792`） | https://developer.apple.com/account |

---

### 8. コードへの反映

**`src-tauri/tauri.conf.json`**

`bundle.macOS.signingIdentity` に手順4で確認した証明書ID文字列を設定:

```json
"macOS": {
  "signingIdentity": "Developer ID Application: SATORU MIKAMI (2M2QV9R792)"
}
```

**`.github/workflows/release.yml`**

`tauri-apps/tauri-action` の `env` に署名・公証用の環境変数を追加:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
  APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
  APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## トラブルシューティング

### 「証明書は信頼されていません」と表示される

Appleの中間証明書がインストールされていない場合に発生します。

**URL:** https://www.apple.com/certificateauthority/

1. 上記URLにアクセス
2. **「Developer ID - G2 (Expiring 09/17/2031 23:59:59 UTC)」** をダウンロード
3. ダウンロードした `.cer` ファイルをダブルクリックしてインポート
4. Keychain Accessで Developer ID Application 証明書の「信頼されていません」表示が消えることを確認

### `security find-identity` で0件になる

```
0 valid identities found
```

- Keychain Accessの **「自分の証明書」** カテゴリを確認
- 証明書の左に **▶ がない** 場合、秘密鍵が紐付いていない
  - 原因: CSRを生成したMacとは別のMacでインポートしている
  - 対処: CSRを生成したMacで `.cer` をインポートし直す
