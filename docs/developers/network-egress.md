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
- `lookup` を差し替えた接続は断ります（許した名前のまま、別の IP につなげるため）
- HTTP のプロキシ（`HTTPS_PROXY` など）を使う環境では、プロキシの宛先が一覧にないため、外部の API を使えません。宛先がプロキシの設定（`HTTPS_PROXY`・`HTTP_PROXY`・`ALL_PROXY` と小文字のもの）と同じときは、エラーの文を「プロキシを使う環境では、外部の API につなげません（プロキシ: 宛先）」にして、理由が分かるようにします。プロキシを許すと、プロキシの先の宛先を確かめられなくなるため、許しません

## 記録

データのフォルダの `logs/network.jsonl` に、接続を1件ずつ JSON の行で追記します。

```json
{"time":"2026-11-10T09:00:00.000Z","host":"api.anthropic.com","port":443,"allowed":true,"bytesSent":2048,"bytesReceived":8192}
{"time":"2026-11-10T09:00:01.000Z","host":"example.com","port":443,"allowed":false}
```

- 断った接続はその場で、通した接続は閉じたときに、送受信のバイト数とともに記録します
- 接続の処理を止めないよう、書き込みを待たずに、順番に書きます
- ファイルが 5MB を超えるときは、`network.jsonl.1` に移してから書きます。古い記録は1世代（`network.jsonl.1`）だけ残します
- パス・ヘッダー・本文・API キーは残しません
- `"allowed":false` の行があれば、アプリが使わない宛先に送ろうとしたものがあったということです。どの操作のときに起きたかを確かめてください

## 守れないもの

- バックエンドが動かす別のプログラム（GiNZA の `uv`・Python、`ffmpeg`）の通信は、この確かめを通りません。`uv` は GiNZA の準備のときに PyPI からパッケージを取ります
- 許した宛先（Anthropic・ElevenLabs・AWS）そのものに、別のアカウントのキーで送ることは止められません。キーは設定画面とキーチェーンで管理します
- 同じプロセスの中でも、DNS の問い合わせ（名前にデータを入れて送る）・UDP（`dgram`）・Node の内部の仕組みを直に使う通信は、この確かめを通りません
- 記録の `"allowed":true` は、つなぎに行ったことを表します。つながらなかった接続も同じように残ります。通した接続は閉じたときに記録するため、バックエンドが途中で落ちると残りません
