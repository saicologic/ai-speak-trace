# バックエンドの外への通信の制限と記録

[開発者ガイドに戻る](README.md)

バックエンド（sidecar）から外への通信は、アプリが使う API の宛先（HTTPS）だけに絞り、すべての接続を記録します（`backend/src/security/egress-guard.ts`）。読み込んだ会話や依存のパッケージに仕込まれたものが、会話のデータを知らないサーバーに送らないようにするためです。

## 許す宛先

| 宛先 | 使いみち |
|---|---|
| `api.anthropic.com` | 要約・分析・ディープサーチ（Web 検索も Anthropic の側で行う） |
| `api.elevenlabs.io` | 文字起こし |
| `bedrock-runtime.<リージョン>.amazonaws.com` | Amazon Bedrock Guardrails |
| `sts.amazonaws.com`・`sts.<リージョン>.amazonaws.com`・`portal.sso.<リージョン>.amazonaws.com`・`oidc.<リージョン>.amazonaws.com` | AWS のプロファイルの認証情報（AssumeRole・SSO） |
| `github.com`・`release-assets.githubusercontent.com`・`objects.githubusercontent.com` | GiNZA の準備で `uv` を取るときだけ（`withEgressHosts`） |

- ポートは 443（HTTPS）だけです。HTTP（暗号なし）・ほかのポートは断ります
- IP アドレスを直に書いた宛先は、自分の Mac の中（`127.0.0.1`・`localhost`）を含めて断ります
- 許した宛先から一覧にない宛先に転送（リダイレクト）されたときも、転送先への接続を断ります
- 宛先を足すときは、`egress-guard.ts` の一覧とテスト（`egress-guard.spec.ts`）を変え、このページの表に足します。必要な処理の間だけで足りるなら、`withEgressHosts` で、その処理の間だけ許します

## 仕組み

Node の通信（axios・AWS SDK・`fetch`・`net`・`tls`）は、最後はすべて `net.Socket.prototype.connect` を通ります。バックエンドの起動時（`main.ts`）に、ここで宛先を確かめるようにします。

- 一覧にない宛先は、DNS を引く前に `EGRESS_BLOCKED` のエラーで断ります
- Unix ソケット（パスでつなぐ、Mac の中だけの通信）は断りません

## 記録

データのフォルダの `logs/network.jsonl` に、接続を1件ずつ JSON の行で追記します。

```json
{"time":"2026-11-10T09:00:00.000Z","host":"api.anthropic.com","port":443,"allowed":true,"bytesSent":2048,"bytesReceived":8192}
{"time":"2026-11-10T09:00:01.000Z","host":"example.com","port":443,"allowed":false}
```

- 断った接続はその場で、通した接続は閉じたときに、送受信のバイト数とともに記録します
- パス・ヘッダー・本文・API キーは残しません
- `"allowed":false` の行があれば、アプリが使わない宛先に送ろうとしたものがあったということです。どの操作のときに起きたかを確かめてください

## 守れないもの

- バックエンドが動かす別のプログラム（GiNZA の `uv`・Python、`ffmpeg`）の通信は、この確かめを通りません。`uv` は GiNZA の準備のときに PyPI からパッケージを取ります
- 許した宛先（Anthropic・ElevenLabs・AWS）そのものに、別のアカウントのキーで送ることは止められません。キーは設定画面とキーチェーンで管理します
