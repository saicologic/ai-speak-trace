# ドメイン駆動設計（DDD）の設計

> **状態: 議論中**　この設計を中心に、今後の改善を話し合う。決めたことは「[8. 決めたことの記録](#8-決めたことの記録)」に足し、まだ決めていないことは「[7. 論点](#7-論点)」に番号を付けて書く。
>
> 各項目は、**修正前**（今のコード）と **修正後**（この設計）に分けて書く。

## 0. この設計の目的

このアプリには、守らなければならない約束が2つある。

- **伏せた会話だけを外に出す**: Claude・MCP には、個人情報チェックで伏せると選んだ文字列を置き換えた会話だけを渡す
- **根拠のない文を出さない**: ディープサーチ・要約で、会話や公式の出典で確かめられなかった文を出さない

| | 約束をどう守っているか |
|---|---|
| 修正前 | `*.service.ts` と `*.utils.ts` に散らばった処理と、呼ぶ側の注意（`findById` ではなく `findForSending` を呼ぶ、など）で守っている |
| 修正後 | 約束を **型・集約・lint で守る**。守らないコードは、コンパイル・lint・テストのどれかで止まる |

対象はシステム全体（バックエンド・フロントエンド・MCP）とする。Tauri（Rust）は sidecar を起動・管理するだけのため、対象にしない。

参考にする書き方は、TypeScript の DDD でよく使う形（private constructor と `create()`／`reconstruct()`、brand 型）とする。

## 1. 戦略的設計

### 1-1. 境界づけられたコンテキスト

| コンテキスト | 何を扱うか | 区分 | 修正前（今のモジュール） | 修正後 |
|---|---|---|---|---|
| **文字起こし** | 音声・話者・発話・単語、分割して文字起こしするジョブ | 中核 | `transcription`・`podcast` | `transcription` |
| **個人情報** | 個人情報の検出、伏せる／伏せないの選択、送れる会話 | 中核 | `privacy` | `privacy` |
| **ディープサーチ** | 調査のジョブ、キーワード・公式の出典・Web 調査、根拠の確認 | 中核 | `research` | `research` |
| **会話の分析** | 要約、Web 検索付きの分析、発言の文脈、要約の根拠 | 支援 | `interview`・`claude/summary`・`claude/analysis` に分かれている | `insight` |
| **キーワード** | 専門用語・固有名詞の抽出、話者ごとのキーワード | 支援 | `ginza`・`transcription/ginza-keyword-store` | `keywords` |
| **会話の公開（MCP）** | 外のエージェントに、送れる会話だけを読ませる | 支援 | `mcp` | `mcp` |
| **AI への送受信** | Claude への送受信の確認・監査・送信先の制限 | 汎用 | `claude/claude-client`・`claude-guard`・`claude-audit`・`security` | `ai-gateway` |
| **設定** | API キー・Guardrail ID・AI 分析のオン／オフ | 汎用 | `settings` | `settings` |
| **フィードバック** | 利用者の感想の保存 | 汎用 | `feedback` | `feedback` |

中核の3つは「0. この設計の目的」の約束を守る所で、DDD の型を一番しっかり作る。汎用のものは薄くする。

### 1-2. コンテキストマップ

#### 修正前

```text
 transcription ──直接呼ぶ──▶ privacy（PrivacyService.rescanIfChecked・maskForSending）
       │
       ├──直接呼ぶ──▶ DerivedLogCleaner・UtteranceEmbeddingStore・GinzaKeywordStore（削除のとき）
       │
       └── findForSending ／ findById ──▶ interview・research・ginza（どちらを呼ぶかは呼ぶ側しだい）

 claude/summary・claude/analysis・research-claude ── string を受け取って Claude に送る
 mcp ── 文字起こしと個人情報チェックのファイルを読み、チェックが古いかを自分で判定する
 frontend ── types/ にバックエンドの型を手で写している
```

- 伏せる前の `Transcription` と伏せた後の `Transcription` が同じ型で、Claude 側は `string` を受け取る
- 文字起こしの削除が、ほかのコンテキストのデータの削除を直接呼んでいる
- 「チェックが古いか」の判定が、`privacy/privacy.service.ts` と `mcp/conversation-reader.ts` の2か所にある

#### 修正後

```text
 ElevenLabs ──[腐敗防止層]──▶ 文字起こし ◀──[腐敗防止層]── Podcast のキャッシュ
                               │  ▲
     イベント: 話者名を変えた・消した │  │ 文字起こしを読む（public.ts）
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
- 文字起こしから個人情報などへの知らせは、ドメインイベントで送る（[3-3](#3-3-ドメインイベント)）

### 1-3. ユビキタス言語

| 用語 | 意味 | 修正前のコード | 修正後のコード |
|---|---|---|---|
| 文字起こし | 1つの音声の話者・発話・単語 | `Transcription`（データだけの interface。どこからでも書き換えられる） | `Transcription`（集約の class。変えるときは `renameSpeakers()` などのメソッドを通す。[3-1](#3-1-文字起こし)） |
| 話者／話者名 | 「Aさん」など。後から変えられる | `Speaker`・`string` | `Speaker`・`SpeakerName` |
| 発話 | 同じ話者が続けて話した区切り | `Utterance` | `Utterance` |
| 分割ジョブ | 長い音声を区切って文字起こしする処理 | `ChunkedTranscriptionJob`（interface） | `ChunkedTranscriptionJob`（集約） |
| 個人情報チェック | 検出した結果と、伏せる／伏せないの選択 | `PrivacyScan`（interface） | `PrivacyScan`（集約） |
| 検出 | 種類と文字列ごとにまとめた個人情報 | `PiiFinding` | `PiiFinding` |
| **送れる会話**／送れる文字列 | 伏せる処理を通した会話・文字列。外に出してよいのはこれだけ | なし（「送る用の文字起こし」と呼び、型は `Transcription`） | `SendableConversation`・`SendableText` |
| チェックが古い | チェックの後に、話者名・本文が変わったか、文字起こしし直した | 2か所のハッシュの比較 | `PrivacyScan.isStaleFor()` |
| 調査 | ディープサーチの1回分 | `ResearchJob`（interface） | `ResearchJob`（集約） |
| 引用 | 会話の中にあると確かめた文字列 | `TranscriptQuote` | `Quote` |
| 公式の出典 | 確定した公式サイトの情報源 | `WebSource`（`official`） | `WebSource`（`official`） |
| 根拠つきの文 | 出典を確かめられた、レポートの文 | `ReportSegment`・`ClaimCheck` | `ReportSegment`・`ClaimCheck` |
| 要点の根拠 | 要約の要点を裏付ける、会話の中の引用 | `SummaryEvidence` | `SummaryEvidence` |

新しい用語を足すときは、この表に足してから、コードの名前を決める。

## 2. 層とディレクトリ

### 2-1. バックエンド

#### 修正前

```text
backend/src/
├── transcription/
│   ├── transcription.controller.ts
│   ├── transcription.service.ts           話者名の変更・保存・個人情報チェックのやり直しの呼び出しが一緒
│   ├── transcription-store.service.ts     保存の窓口。削除のとき、ほかのコンテキストのデータも消す
│   ├── transcription.utils.ts             ElevenLabs の結果から発話を作る
│   ├── elevenlabs.service.ts・audio-splitter.service.ts・chunked-*.ts
│   ├── derived-log-cleaner.service.ts・utterance-embedding-store.service.ts・ginza-keyword-store.service.ts
│   └── types/                             interface だけ（ルールを持たない）
├── privacy/        guardrail.service.ts・privacy.service.ts・privacy.utils.ts・privacy-scan.store.ts・privacy.types.ts
├── research/       research.service.ts（約 850 行）・research.utils.ts・research-claude.service.ts・…
├── interview/      要約・分析のログと、Claude を呼ぶ流れ
├── claude/         Claude クライアントと、要約・分析のプロンプト
├── ginza/・mcp/・settings/・feedback/・podcast/
└── storage/・aws/・security/・common/
```

- ルールは `*.service.ts`（処理の流れと一緒）と `*.utils.ts`（関数）にあり、データは interface で、どこからでも書き換えられる
- 層の分け方がなく、`*.service.ts` が NestJS・ファイル・外部 API・ルールをまとめて持っている

#### 修正後

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

#### 修正前

```text
frontend/src/
├── api/client.ts          すべての API の呼び出し（約 940 行・50 の関数）
├── components/            画面と部品が一緒に並ぶ（ResearchPage.tsx は約 1400 行）
├── hooks/                 useKeywordSource・usePrivacyStatuses
├── types/                 index.ts・research.ts（バックエンドの型を手で写したもの）
└── utils/                 researchReport・keywords・transcription・speakerKeywords など
```

#### 修正後

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

| | |
|---|---|
| 修正前 | `frontend/src/types/research.ts` などに、バックエンドの型を手で写している。片方だけ変えても、コンパイルでは気づけない |
| 修正後 | 両方から import する `contracts/`（DTO の型だけを置く場所）を作る。バックエンドの `presentation/` の DTO は `contracts/` の型を満たすように書く。ドメインの型は `contracts/` に出さない（ドメインを変えても、API の形が勝手に変わらないようにするため） |

### 2-4. MCP

| | |
|---|---|
| 修正前 | `mcp/conversation-reader.ts` が、文字起こしと個人情報チェックのファイルを読み、チェックが古いかの判定（3つの記録の比較）と伏せる処理を自分で行う。アプリ側の `PrivacyService` と判定が2か所に分かれている |
| 修正後 | MCP は、外のエージェント向けのプレゼンテーション層にする。判定と伏せる処理は、個人情報のドメイン（`PrivacyScan.isStaleFor()`・`toSendableConversation()`）を使い、アプリと MCP で1か所にする |

## 3. 戦術的設計

### 3-1. 文字起こし

| 名前（修正後） | 種類 | ルール | 修正前にあった場所 |
|---|---|---|---|
| `Transcription` | 集約ルート | 話者・発話・単語は一緒に変わる。`create()`（文字起こしの直後）／`reconstruct()`（保存したものから） | `types/transcription.types.ts` の interface。どこからでも書き換えられる |
| `renameSpeakers()` | メソッド | 知らない話者 ID は無視する。変わったときだけ `SpeakerRenamed` を出す | `TranscriptionService.updateSpeakers()` の2つのループ。名前が変わらなくても、個人情報チェックをやり直す |
| `SpeakerName` | 値オブジェクト | 前後の空白を除き、空にしない | `string` |
| `TimeRange` | 値オブジェクト | 開始 ≦ 終了 | `start`・`end` の数値 |
| `ChunkedTranscriptionJob` | 集約ルート | `initializing → splitting → transcribing → merging → completed／failed` の順にしか進まない。再開できるのは途中で止まったものだけ | `chunked-job.types.ts` の interface と、`chunked-transcription.service.ts` の中の `status` の書き換え |
| `TranscriptionRepository`・`ChunkedJobRepository` | リポジトリ | | `storage/interfaces/transcription-storage.interface.ts`・`chunked-job-store.service.ts` |
| `TranscriptionCompleted`・`SpeakerRenamed`・`TranscriptionDeleted` | イベント | | なし（直接呼んでいる） |
| `ElevenLabsAdapter` | 腐敗防止層 | `speaker_id`・snake_case をドメインの形に変える。話者名の初期値（Aさん・Bさん）はドメインで決める | `elevenlabs.service.ts`・`transcription.utils.ts` |

#### 話者名を変えるときのコード

修正前: `Transcription` はデータだけの interface で、話者名を変えるルールはアプリケーションの service に書いてある。

```ts
// transcription/types/transcription.types.ts
export interface Transcription {
  id: string;
  speakers: Speaker[];          // 話者名はここと、
  utterances: Utterance[];      // 発話ごとの speakerName の両方にある
  // ...
}

// transcription/transcription.service.ts
async updateSpeakers(id: string, speakers: { id: string; name: string }[]) {
  const transcription = await this.getTranscription(id);
  for (const update of speakers) {
    const speaker = transcription.speakers.find((s) => s.id === update.id);
    if (speaker) speaker.name = update.name;          // 直接書き換える
  }
  for (const utterance of transcription.utterances) { // 発話の複製も、忘れずに写す必要がある
    const speaker = transcription.speakers.find((s) => s.id === utterance.speakerId);
    if (speaker) utterance.speakerName = speaker.name;
  }
  await this.store.save(transcription);
  this.privacyService.rescanIfChecked(transcription); // 名前が変わらなくても呼ぶ。個人情報を直接知っている
  return transcription;
}
```

- どこからでも `speaker.name = ...` と書けるため、発話の `speakerName` を写し忘れると、話者の一覧と発話で名前が食い違う
- 空の名前・前後の空白は、この service では確かめていない
- 名前が変わったかどうかに関係なく、個人情報チェックをやり直す

修正後: ルールは `Transcription` の中にあり、外からは変えられない。

```ts
// transcription/domain/transcription.ts
export class Transcription {
  private events: TranscriptionEvent[] = [];
  private constructor(private props: TranscriptionProps) {}

  static create(input: TranscribedAudio): Transcription      // 文字起こしの直後（話者名は Aさん・Bさん）
  static reconstruct(json: TranscriptionJson): Transcription // 保存したものから

  /** 知らない話者 ID は無視する。変わったときだけ SpeakerRenamed をためる */
  renameSpeakers(updates: { id: SpeakerId; name: SpeakerName }[]): void

  /** 発話の話者名は、話者の一覧から読む（複製しない） */
  speakerNameOf(speakerId: SpeakerId): SpeakerName

  pullEvents(): TranscriptionEvent[]
  toJSON(): TranscriptionJson
}

// transcription/application/rename-speakers.ts
async execute(id: string, updates: { id: string; name: string }[]) {
  const transcription = await this.repository.findById(id);
  transcription.renameSpeakers(
    updates.map((u) => ({ id: SpeakerId.of(u.id), name: SpeakerName.of(u.name) })), // 空の名前はここで止まる
  );
  await this.repository.save(transcription);
  await this.events.publish(transcription.pullEvents()); // 個人情報は SpeakerRenamed を受けてチェックし直す
}
```

- 話者名は話者の一覧だけに持つため、写し忘れが起きない
- 空の名前・前後の空白は `SpeakerName` が受け付けない
- 文字起こしは個人情報のことを知らない。名前が変わらなかったときは、イベントが出ないのでチェックもやり直さない

#### 保存するデータ

| | `transcription.json` の話者名 |
|---|---|
| 修正前 | `speakers[].name` と `utterances[].speakerName` の両方に書く |
| 修正後 | `speakers[].name` だけに書く（v0.9.1 の課題）。`toJSON()`／`reconstruct()` の中だけで片付くため、ほかのコードは変えない。v0.9.0 のファイルにある `utterances[].speakerName` は、読むときに無視する |

### 3-2. 個人情報

| 名前（修正後） | 種類 | ルール | 修正前にあった場所 |
|---|---|---|---|
| `PrivacyScan` | 集約ルート | 検出・選択・チェックした時点の記録（話者名・本文のハッシュ、作成日時）を持つ | `privacy.types.ts` の interface |
| `chooseMasks()` | メソッド | 選んだものは確認済みにする | `PrivacyService.updateMasks()` |
| `isStaleFor(t)` | メソッド | 話者名・本文・文字起こしし直しのどれかがあれば古い | `PrivacyService.runScan()` と `mcp/conversation-reader.ts` の2か所 |
| `applyTo(t)` | メソッド | 伏せると選んだ文字列を置き換えて、`SendableConversation` にする | `PrivacyService.maskForSending()`（`Transcription` を返す） |
| `PiiFinding` | エンティティ | 種類と文字列で見分ける。誤検出の多い種類は要確認で始まる | `privacy.utils.ts` の `toFindings` |
| `SendableText`・`SendableConversation` | 値オブジェクト | brand 型。`privacy/domain` の外では作れない | なし |
| `PiiPolicy` | ドメインサービス | 個人情報として扱わないもの（国名だけの住所・製品名だけの氏名など）の判断 | `privacy.utils.ts` の `isIgnoredPii`・`withoutIgnoredPii` |
| `PrivacyScanRepository` | リポジトリ | | `privacy-scan.store.ts` |
| `GuardrailAdapter` | 腐敗防止層 | Bedrock の結果を `PiiFinding` に変える | `guardrail.service.ts` |
| イベントを受ける | | `SpeakerRenamed` → チェックし直し、`TranscriptionDeleted` → 結果を消す | `TranscriptionService` から `rescanIfChecked()` を直接呼ぶ |

チェック中かどうか・やり直しの順番待ち（`PrivacyService` の `running`・`pending`）は処理の都合のため、修正後もアプリケーション層に置く。

#### 送れる会話の型

修正前:

```ts
// privacy/privacy.service.ts — 伏せる前も後も同じ型
async maskForSending(transcription: Transcription): Promise<Transcription>

// claude/summary.service.ts — どんな文字列でも受け取る
async summarize(fullText: string, ...)
```

修正後:

```ts
// privacy/domain/sendable.ts
export type SendableText = string & { readonly [sendableBrand]: true };
export function toSendableConversation(
  transcription: Transcription,
  findings: PiiFinding[],
): SendableConversation

// Claude 側は、送れる文字列しか受け取らない
async summarize(fullText: SendableText, ...)
```

修正後は、`findById` の結果（伏せる前）を `summarize()` に渡すと、コンパイルで止まる。

### 3-3. ドメインイベント

| | 文字起こしを消すとき | 話者名を変えたとき |
|---|---|---|
| 修正前 | `TranscriptionStoreService.delete()` が、分析のログ・発話ベクトル・GiNZA のキャッシュを順に消してから、文字起こしを消す（ほかのコンテキストを直接知っている） | `TranscriptionService.updateSpeakers()` が、保存の後に `PrivacyService.rescanIfChecked()` を直接呼ぶ |
| 修正後 | 集約が `TranscriptionDeleted` をため、アプリケーション層が保存の前に受け手（個人情報・キーワード・会話の分析・ディープサーチ）に順に渡す。それぞれが自分のデータを消す | 集約が `SpeakerRenamed` をため、保存の後に個人情報が受け取ってチェックし直す |

- イベントは、集約がためて（`pullEvents()`）、アプリケーション層が同じプロセスの中で受け手に渡す。外部のメッセージの仕組みは入れない
- 修正前の「先に派生データを消し、失敗したら文字起こしを残す」順番は、受け手が失敗したら止める形で守る（[D-2](#7-論点)）

### 3-4. ディープサーチ

| 名前（修正後） | 種類 | ルール | 修正前にあった場所 |
|---|---|---|---|
| `ResearchJob` | 集約ルート | `proposing → awaiting_confirmation → researching → analyzing → evaluating → completed`。どの段階からも `failed` になれる。`resume()` は終わっていない最初の段階から | `research.types.ts` の interface と、`research.service.ts` の中の `status` の書き換え・`resumeStage` |
| `ResearchTitle` | 値オブジェクト | 前後の空白と改行を除き、60 文字で切る | `research.service.ts` の `normalizeTitle` |
| `Keyword`・`Quote`・`OfficialDomain`・`WebSource` | 値オブジェクト | `Quote` は、会話の中にあると確かめたものだけ作れる | `string`・`TranscriptQuote` など |
| `ReportSegment`・`ClaimCheck`・`ResearchEvaluation` | 値オブジェクト | | `research.types.ts` の interface |
| `QuoteVerifier` | ドメインサービス | 引用が送れる会話にあるか | `research.utils.ts` の `verifyQuotes` |
| `OfficialSourcePolicy` | ドメインサービス | 公式の出典か | `research.utils.ts` の `isOfficial`・`normalizeDomain` |
| `GroundingEvaluator` | ドメインサービス | 根拠を確かめられなかった文を除く | `research.service.ts` の `evaluate`、`research.utils.ts` の `toReportSegments`・`mergeIntoSentences` |
| `PreSendCheck` | ドメインサービス | 送る前の確認の記録 | `research.service.ts` の `sendableWords`、`research.utils.ts` の `checkPersonalData` |
| 受け取るもの | | `SendableConversation` だけ | `findForSending` の結果（型は `Transcription`） |

根拠の確認の決まりそのものは [ディープサーチ](deep-search.md) に書いてある。この設計では、その決まりをどこに置くかだけを決める。

### 3-5. 会話の分析

| 名前（修正後） | 種類 | ルール | 修正前にあった場所 |
|---|---|---|---|
| `SummaryLog` | 集約ルート | 要点と要点の根拠。根拠は会話にある引用だけ | `interview.types.ts` の interface と、`interview.utils.ts` の `verifySummaryEvidence` |
| `InterviewAnalysis` | 集約ルート | 話者・キーワード・質問・結果 | `interview.types.ts` の interface |
| `SummaryPrompt` | 値オブジェクト | `{{fullText}}` を含む指示 | `string` |
| 受け取るもの | | `SendableConversation` だけ | `findForSending` の結果（型は `Transcription`）。Claude 側は `string` |

### 3-6. キーワード・設定・フィードバック・AI への送受信

| コンテキスト | 修正前 | 修正後 |
|---|---|---|
| キーワード | `ginza/` の service・utils と、`transcription/ginza-keyword-store.service.ts` に分かれている | `SpeakerKeywords`（値オブジェクト）と、一般的な語を除くルール（`general-words.ts`）をドメインに置く。GiNZA の Python はインフラのアダプターにする |
| 設定 | `settings.service.ts` に、検証・保存・Guardrail の確かめがまとまっている | `AiAnalysisMode`・`GuardrailConfig` を値オブジェクトにする。キーチェーンへの保存はインフラに置く |
| フィードバック | service と store | `Feedback` のエンティティだけを作る（ほぼ保存するだけのため薄くする） |
| AI への送受信 | `claude/` に、クライアント・確認・監査と、要約・分析のプロンプトが一緒にある。受け取る型は `string` | ドメインモデルは作らない。Claude への腐敗防止層として、「外から来た内容は指示と分けて渡す」「送受信を監査する」を1か所に集め、受け取る型は `SendableText` にする。要約・分析のプロンプトは会話の分析に移す |

## 4. 守るための仕組み

| 仕組み | 修正前 | 修正後 |
|---|---|---|
| 型 | 伏せる前と後が同じ `Transcription`・`string` | `SendableText` の brand 型。伏せる前の会話を Claude・MCP に渡すと、コンパイルで止まる |
| テストの型の確認 | `backend/tsconfig.json` が `isolatedModules: true` のため、`ts-jest` は型を確かめず、`tsconfig.build.json` もテストを除いている。`@ts-expect-error` を使った型のテストが CI で効かない。今のテストのファイルには型のエラーがある | jest でテストのファイルの型も確かめる（[D-5](#7-論点)） |
| ESLint | 層・コンテキストの境界のルールはない | ①`domain/` から NestJS・`fs`・SDK を import しない ②ほかのコンテキストは `public.ts` からだけ ③`privacy/domain` の外で `as SendableText` と書かない（テストを除く）④フロントエンドの `features/*` は、ほかの `features/*` の中を import しない |
| lint のテスト | テストのファイルの書き方（`.skip`・`.only` など）だけ | 上のルールが効くことも、`backend/src/lint` のテストで確かめる |

## 5. テストの方針

[テスト駆動開発](../../CLAUDE.md)の決まりに従う。

| 層 | 修正前 | 修正後 |
|---|---|---|
| domain | なし（ルールは service・utils のテストで確かめている） | 純粋な単体テスト。モックを使わない |
| application | service のテスト。保存先・ほかの service をモックにする | インメモリのリポジトリと、偽の腐敗防止層を使う |
| infrastructure | store のテスト（一時ディレクトリ） | 一時ディレクトリ・外部 API の偽物を使う |
| presentation | controller・MCP のテスト | 同じ |

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

| | 音声ファイル名の扱い |
|---|---|
| 修正前 | ディープサーチでは、音声ファイル名が伏せる処理を通らずに Claude に送られている（`research/research-claude.service.ts` の文書の題名）。MCP（`mcp/conversation-reader.ts`）はファイル名を空にしていて、扱いが揃っていない |
| 修正後 | [D-4](#7-論点) で決める。それまでは `SendableConversation.audioFileName` を、伏せていない `string` のままにする |

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
| 2026-11-13 | 設計のドキュメントは、各項目を修正前（今のコード）と修正後（設計）に分けて書く | 今のコードとの違いを見ながら話し合うため |
