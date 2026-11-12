# ドメイン駆動設計（DDD）の設計

> **状態: 議論中**　この設計を中心に、今後の改善を話し合う。決めたことは「[8. 決めたことの記録](#8-決めたことの記録)」に足し、まだ決めていないことは「[7. 論点](#7-論点)」に番号を付けて書く。

## 0. この設計の目的

このアプリには、守らなければならない約束が2つある。

- **伏せた会話だけを外に出す**: Claude・MCP には、個人情報チェックで伏せると選んだ文字列を置き換えた会話だけを渡す
- **根拠のない文を出さない**: ディープサーチ・要約で、会話や公式の出典で確かめられなかった文を出さない

今は、この約束が `*.service.ts` と `*.utils.ts` に散らばった処理と、呼ぶ側の注意で守られている。DDD の形にして、約束を **型・集約・lint で守る** ことを目的にする。

対象はシステム全体（バックエンド・フロントエンド・MCP）とする。Tauri（Rust）は sidecar を起動・管理するだけのため、対象にしない。

参考にする書き方は、TypeScript の DDD でよく使う形（private constructor と `create()`／`reconstruct()`、brand 型）とする。

## 1. 戦略的設計

### 1-1. 境界づけられたコンテキスト

| コンテキスト | 何を扱うか | 区分 | 今のモジュール |
|---|---|---|---|
| **文字起こし** | 音声・話者・発話・単語、分割して文字起こしするジョブ | 中核 | `transcription`・`podcast` |
| **個人情報** | 個人情報の検出、伏せる／伏せないの選択、送れる会話 | 中核 | `privacy` |
| **ディープサーチ** | 調査のジョブ、キーワード・公式の出典・Web 調査、根拠の確認 | 中核 | `research` |
| **会話の分析** | 要約、Web 検索付きの分析、発言の文脈、要約の根拠 | 支援 | `interview`・`claude/summary`・`claude/analysis` |
| **キーワード** | 専門用語・固有名詞の抽出、話者ごとのキーワード | 支援 | `ginza` |
| **会話の公開（MCP）** | 外のエージェントに、送れる会話だけを読ませる | 支援 | `mcp` |
| **AI への送受信** | Claude への送受信の確認・監査・送信先の制限 | 汎用 | `claude/claude-client`・`claude-guard`・`security` |
| **設定** | API キー・Guardrail ID・AI 分析のオン／オフ | 汎用 | `settings` |
| **フィードバック** | 利用者の感想の保存 | 汎用 | `feedback` |

中核の3つは、「0. この設計の目的」の約束を守る所で、DDD の型を一番しっかり作る。汎用のものは薄くする。

### 1-2. コンテキストマップ

```text
 ElevenLabs ──[腐敗防止層]──▶ 文字起こし ◀──[腐敗防止層]── Podcast のキャッシュ
                               │  ▲
            話者名を変えた・消した │  │ 文字起こしを読む
                               ▼  │
 Bedrock ───[腐敗防止層]──▶   個人情報
 Guardrails                    │
                               │ 公開する言葉: 送れる会話（SendableConversation）
          ┌────────────────────┼─────────────────────┬──────────────┐
          ▼                    ▼                     ▼              ▼
     ディープサーチ          会話の分析            キーワード      会話の公開（MCP）
          │                    │
          └──────┬─────────────┘
                 ▼
          AI への送受信 ──[腐敗防止層]──▶ Claude API

 フロントエンド ──[公開する言葉: API の契約（contracts）]──▶ 各コンテキストの API
```

- **個人情報は「送れる会話」を公開する言葉として出す**。下流のディープサーチ・会話の分析・MCP は、伏せる前の `Transcription` を受け取れない
- 外部 API（ElevenLabs・Bedrock・Claude・Podcast のキャッシュ）は、どれも腐敗防止層の中に閉じ込め、`speaker_id` のような外の形をドメインに持ち込まない
- 文字起こしから個人情報などへの知らせ（話者名を変えた・文字起こしを消した）は、ドメインイベントで送る（[3-3](#3-3-ドメインイベント)）

### 1-3. ユビキタス言語

| 用語 | 意味 | コード |
|---|---|---|
| 文字起こし | 1つの音声の話者・発話・単語 | `Transcription` |
| 話者／話者名 | 「Aさん」など。後から変えられる | `Speaker`・`SpeakerName` |
| 発話 | 同じ話者が続けて話した区切り | `Utterance` |
| 分割ジョブ | 長い音声を区切って文字起こしする処理 | `ChunkedTranscriptionJob` |
| 個人情報チェック | 検出した結果と、伏せる／伏せないの選択 | `PrivacyScan` |
| 検出 | 種類と文字列ごとにまとめた個人情報 | `PiiFinding` |
| **送れる会話**／送れる文字列 | 伏せる処理を通した会話・文字列。外に出してよいのはこれだけ | `SendableConversation`・`SendableText` |
| チェックが古い | チェックの後に、話者名・本文が変わったか、文字起こしし直した | `PrivacyScan.isStaleFor()` |
| 調査 | ディープサーチの1回分 | `ResearchJob` |
| 引用 | 会話の中にあると確かめた文字列 | `Quote` |
| 公式の出典 | 確定した公式サイトの情報源 | `WebSource`（`official`） |
| 根拠つきの文 | 出典を確かめられた、レポートの文 | `ReportSegment`・`ClaimCheck` |
| 要点の根拠 | 要約の要点を裏付ける、会話の中の引用 | `SummaryEvidence` |

新しい用語を足すときは、この表に足してから、コードの名前を決める。

## 2. 層とディレクトリ

### 2-1. バックエンド

コンテキストごとに4つの層を持つ。NestJS のモジュールは、コンテキストと1対1にする。

```text
backend/src/
├── shared/                         共有カーネル（最小限）
│   └── domain/                     ID・時刻（Clock）・ドメインイベントの基底
├── transcription/
│   ├── domain/                     集約・値オブジェクト・リポジトリのインターフェース・イベント
│   ├── application/                ユースケース（今の *.service.ts を薄くしたもの）
│   ├── infrastructure/             ファイル保存・ElevenLabs のアダプター・ffmpeg
│   ├── presentation/               controller・DTO
│   ├── public.ts                   ほかのコンテキストに見せるもの（これ以外は import させない）
│   └── transcription.module.ts
├── privacy/                        同じ形。public.ts で SendableConversation を公開する
├── research/
├── insight/                        会話の分析（interview と claude/summary・analysis をまとめる）
├── keywords/                       ginza
├── mcp/                            presentation と、MCP の起動
├── ai-gateway/                     claude-client・claude-guard・audit・egress-guard
├── settings/
└── feedback/
```

依存の向き:

```text
presentation ──▶ application ──▶ domain ◀── infrastructure
```

- `domain/` は、NestJS・`fs`・AWS SDK・Anthropic SDK を import しない
- ほかのコンテキストのものは、相手の `public.ts` からだけ import する

### 2-2. フロントエンド

フロントエンドには業務のルールが少ないため、エンティティは作らない。コンテキストごとに機能を分け、API の形を画面の形に変える所（腐敗防止層）を1か所に集める。

```text
frontend/src/
├── features/
│   ├── transcription/   api.ts（DTO → 画面の型）・model/（純粋な関数）・hooks/・components/
│   ├── privacy/
│   ├── research/
│   ├── insight/
│   ├── keywords/
│   ├── settings/
│   └── feedback/
└── shared/              共通の部品・sanitizeHtml・platform
```

- `api/client.ts` は、コンテキストごとの `features/*/api.ts` に分ける
- `utils/researchReport.ts`・`utils/keywords.ts`・`utils/transcription.ts` などは、それぞれの `features/*/model/` に移す（テストも一緒に移す）
- `ResearchPage.tsx` は、`features/research/components/` で段階ごとの部品に分ける

### 2-3. API の契約（フロントエンドとバックエンドの間）

今の `frontend/src/types/research.ts` は、バックエンドの型を手で写したものになっている。これを、両方から import する `contracts/`（DTO の型だけを置く場所）にする。

- バックエンドの `presentation/` の DTO は、`contracts/` の型を満たすように書く
- ドメインの型は `contracts/` に出さない（ドメインを変えても、API の形が勝手に変わらないようにするため）

### 2-4. MCP

MCP は、外のエージェント向けのプレゼンテーション層とする。今 `mcp/conversation-reader.ts` の中にある「チェックが古いか」の判定と伏せる処理は、個人情報のドメイン（`PrivacyScan.isStaleFor()`・`toSendableConversation()`）を使う形にし、アプリと MCP で判定を1か所にする。

## 3. 戦術的設計

### 3-1. 文字起こし

| 種類 | 名前 | ルール |
|---|---|---|
| 集約ルート | `Transcription` | 話者・発話・単語は一緒に変わる。`create()`（文字起こしの直後）／`reconstruct()`（保存したものから） |
| メソッド | `renameSpeakers()` | 知らない話者 ID は無視する。変わったときだけ `SpeakerRenamed` を出す |
| 値オブジェクト | `SpeakerName` | 前後の空白を除き、空にしない |
| 値オブジェクト | `TimeRange` | 開始 ≦ 終了 |
| 集約ルート | `ChunkedTranscriptionJob` | `initializing → splitting → transcribing → merging → completed／failed` の順にしか進まない。再開できるのは途中で止まったものだけ |
| リポジトリ | `TranscriptionRepository`・`ChunkedJobRepository` | |
| イベント | `TranscriptionCompleted`・`SpeakerRenamed`・`TranscriptionDeleted` | |
| 腐敗防止層 | `ElevenLabsAdapter` | `speaker_id`・snake_case をドメインの形に変える。話者名の初期値（Aさん・Bさん）はドメインで決める |

v0.9.1 の課題（話者名を発話から外す）は、`Transcription` の中で `speakerNameOf()` を使う形にし、`toJSON()`／`reconstruct()` の中だけで片付ける。

### 3-2. 個人情報

| 種類 | 名前 | ルール |
|---|---|---|
| 集約ルート | `PrivacyScan` | 検出・選択・チェックした時点の記録（話者名・本文のハッシュ、作成日時）を持つ |
| メソッド | `chooseMasks()` | 選んだものは確認済みにする |
| メソッド | `isStaleFor(t)` | 話者名・本文・文字起こしし直しのどれかがあれば古い |
| メソッド | `applyTo(t)` | 伏せると選んだ文字列を置き換えて、`SendableConversation` にする |
| エンティティ | `PiiFinding` | 種類と文字列で見分ける。誤検出の多い種類は要確認で始まる |
| 値オブジェクト | `SendableText`・`SendableConversation` | brand 型。`privacy/domain` の外では作れない |
| ドメインサービス | `PiiPolicy` | 個人情報として扱わないもの（国名だけの住所・製品名だけの氏名など）の判断 |
| リポジトリ | `PrivacyScanRepository` | |
| 腐敗防止層 | `GuardrailAdapter` | Bedrock の結果を `PiiFinding` に変える |
| イベントを受ける | `SpeakerRenamed` → チェックし直し、`TranscriptionDeleted` → 結果を消す | |

チェック中かどうか・やり直しの順番待ち（今の `PrivacyService` の `running`・`pending`）は処理の都合のため、アプリケーション層に置く。

### 3-3. ドメインイベント

今の `TranscriptionStoreService.delete()` は、発話ベクトル・GiNZA のキャッシュ・分析のログを自分で消していて、文字起こしのコンテキストがほかのコンテキストを知っている。

- 集約は、起きたことをイベントとしてためる（`pullEvents()`）
- アプリケーション層が、保存した後に、同じプロセスの中で受け手に順番に渡す
- 受け手: `TranscriptionDeleted` → 個人情報・キーワード・会話の分析・ディープサーチが、それぞれ自分のデータを消す。`SpeakerRenamed` → 個人情報がチェックし直す

外部のメッセージの仕組みは入れない。今の「先に派生データを消し、失敗したら文字起こしを残す」順番は、受け手が失敗したら止める形で守る（[D-2](#7-論点)）。

### 3-4. ディープサーチ

| 種類 | 名前 | ルール |
|---|---|---|
| 集約ルート | `ResearchJob` | `proposing → awaiting_confirmation → researching → analyzing → evaluating → completed`。どの段階からも `failed` になれる。`resume()` は終わっていない最初の段階から（今の `resumeStage`） |
| 値オブジェクト | `ResearchTitle` | 前後の空白と改行を除き、60 文字で切る（今の `normalizeTitle`） |
| 値オブジェクト | `Keyword`・`Quote`・`OfficialDomain`・`WebSource` | `Quote` は、会話の中にあると確かめたものだけ作れる |
| 値オブジェクト | `ReportSegment`・`ClaimCheck`・`ResearchEvaluation` | |
| ドメインサービス | `QuoteVerifier` | 引用が送れる会話にあるか（今の `verifyQuotes`） |
| ドメインサービス | `OfficialSourcePolicy` | 公式の出典か（今の `isOfficial`・`normalizeDomain`） |
| ドメインサービス | `GroundingEvaluator` | 根拠を確かめられなかった文を除く（今の `evaluate`・`toReportSegments`・`mergeIntoSentences`） |
| ドメインサービス | `PreSendCheck` | 送る前の確認の記録（今の `sendableWords`・`checkPersonalData`） |
| 受け取るもの | `SendableConversation` だけ | |

根拠の確認の決まりそのものは [ディープサーチ](deep-search.md) に書いてある。この設計では、その決まりをどこに置くかだけを決める。

### 3-5. 会話の分析

| 種類 | 名前 | ルール |
|---|---|---|
| 集約ルート | `SummaryLog` | 要点と要点の根拠。根拠は会話にある引用だけ（今の `verifySummaryEvidence`） |
| 集約ルート | `InterviewAnalysis` | 話者・キーワード・質問・結果 |
| 値オブジェクト | `SummaryPrompt` | `{{fullText}}` を含む指示 |
| 受け取るもの | `SendableConversation` だけ | |

### 3-6. キーワード・設定・フィードバック・AI への送受信

- **キーワード**: `SpeakerKeywords`（値オブジェクト）と、一般的な語を除くルール（`general-words.ts`）をドメインに置く。GiNZA の Python はインフラのアダプターにする
- **設定**: `AiAnalysisMode`・`GuardrailConfig` を値オブジェクトにする。キーチェーンへの保存はインフラに置く
- **フィードバック**: `Feedback` のエンティティだけを作る（ほぼ保存するだけのため薄くする）
- **AI への送受信**: ドメインモデルは作らない。Claude への腐敗防止層として、「外から来た内容は指示と分けて渡す」「送受信を監査する」を1か所に集め、受け取る型は `SendableText` にする

## 4. 守るための仕組み

| 仕組み | 内容 |
|---|---|
| 型 | `SendableText` の brand 型。伏せる前の会話を Claude・MCP に渡すと、コンパイルで止まる |
| テストの型の確認 | jest でテストのファイルの型も確かめる。`backend/tsconfig.json` は `isolatedModules: true` のため、今の `ts-jest` は型を確かめず、`tsconfig.build.json` もテストを除いている。このままでは `@ts-expect-error` を使った型のテストが CI で効かない |
| ESLint | ①`domain/` から NestJS・`fs`・SDK を import しない ②ほかのコンテキストは `public.ts` からだけ ③`privacy/domain` の外で `as SendableText` と書かない（テストを除く）④フロントエンドの `features/*` は、ほかの `features/*` の中を import しない |
| lint のテスト | 上のルールが効くことを、`backend/src/lint` のテストで確かめる |

## 5. テストの方針

[テスト駆動開発](../../CLAUDE.md)の決まりに従う。

| 層 | テスト |
|---|---|
| domain | 純粋な単体テスト。モックを使わない |
| application | インメモリのリポジトリと、偽の腐敗防止層を使う |
| infrastructure | 一時ディレクトリ・外部 API の偽物を使う |
| presentation | 今の controller・MCP のテスト |

- ファイルを移す・層を分けるなど動きを変えない書き換えは、今あるテストがその動きを確かめているかを先に見て、足りなければ特性テストを先に足す
- 特性テストは、実装を一時的に壊して（例: 伏せずに渡す）失敗することを確かめてから使う
- テストのファイルの移動は `test:` のコミットで行う

## 6. 進め方

すべて `release/v0.9.1` に入れる。

| 順 | 内容 | 進み具合 |
|---|---|---|
| 0 | テストの型の確認（`tsconfig.spec.json` と、今あるテストの型のエラーの修正） | 途中 |
| 1 | 送れる会話: `SendableConversation` を、個人情報・会話の分析・ディープサーチ・MCP の受け取る型にする | 途中（特性テストと `SendableConversation` の型まで） |
| 2 | lint ①〜③（層と公開の境界） | |
| 3 | 文字起こしの集約: `Transcription`・`SpeakerName`・`renameSpeakers()` | |
| 4 | 個人情報の集約: `PrivacyScan`（`isStaleFor`・`applyTo`）。MCP の判定もここを使う | |
| 5 | ドメインイベント: `TranscriptionDeleted`・`SpeakerRenamed`。`TranscriptionStoreService` からほかのコンテキストへの依存を外す | |
| 6 | ディープサーチ: `ResearchJob` の状態の移り変わりと、根拠の確認のドメインサービス | |
| 7 | 会話の分析: `SummaryLog`・`InterviewAnalysis` | |
| 8 | キーワード・設定・フィードバック | |
| 9 | 層のディレクトリ: `application/`・`infrastructure/`・`presentation/` に分ける（動きを変えない移動だけ） | |
| 10 | API の契約: `contracts/` を作り、フロントエンドの写した型を置き換える | |
| 11 | フロントエンド: `features/*` に分け、`api/client.ts`・`ResearchPage.tsx` を分ける | |
| 12 | 話者名を発話から外す（v0.9.1 の課題） | |

DDD の作業とは別に、`fix/*` で直すもの:

- ディープサーチで、音声ファイル名が伏せる処理を通らずに Claude に送られている（`research/research-claude.service.ts` の文書の題名）。MCP（`mcp/conversation-reader.ts`）はファイル名を空にしていて、扱いが揃っていない。それまでは `SendableConversation.audioFileName` を、伏せていない `string` のままにする（[D-4](#7-論点)）

## 7. 論点

番号を付けて話し合う。決めたら「8. 決めたことの記録」に移す。

| 番号 | 論点 | 今の案 |
|---|---|---|
| D-1 | `contracts/` の置き場所（リポジトリの直下にするか、`backend` から出すか）と、フロントエンドからの import のしかた | 未定 |
| D-2 | ドメインイベントの受け手が失敗したとき、ほかの受け手を続けるか止めるか | 消すときは止める。話者名を変えたときは続ける |
| D-3 | MCP は別のプロセスとして起動するため、リポジトリの実装をどう共有するか | MCP の起動のしかたを確かめてから決める |
| D-4 | 音声ファイル名を Claude に送るときの扱い（題名に使わないか、伏せる処理を通すか） | DDD の後に `fix/*` で直す |
| D-5 | テストの型の確認を、jest（`tsconfig.spec.json`）でするか、CI に `tsc --noEmit` を足すか | jest でする（CI のワークフローを変えずに `backend-test` で効く） |
| D-6 | 汎用のコンテキスト（設定・フィードバック）まで4つの層に分けるか | 分けるが、`domain/` は薄くする |

## 8. 決めたことの記録

| 日付 | 決めたこと | 理由 |
|---|---|---|
| 2026-11-13 | DDD の形は、一部のモジュールではなくシステム全体に入れる | ディープサーチ・要約にも業務のルールが多く、一部だけでは線引き・lint・書く場所が揺れるため |
| 2026-11-13 | 技術の部品（ストレージ・外部 API のクライアントなど）は、ドメインモデルにせずインフラ層に置く | 業務のルールがなく、層が増えるだけになるため |
| 2026-11-13 | 最初は「送れる会話」の型から始める | 「伏せた会話だけを外に出す」約束に一番効くため |
| 2026-11-13 | すべて `release/v0.9.1` に入れる | |
| 2026-11-13 | 音声ファイル名の問題は、DDD の作業の後に `fix/*` で直す | DDD の作業（動きを変えない書き換え）と、動きを変える修正を混ぜないため |
