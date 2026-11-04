# AI Speak Trace - Frontend

音声データの文字起こし結果の閲覧・キーワード抽出・要約・会話分析・ディープサーチを行うフロントエンドアプリケーションです。

## 主な機能

- **入力**: 音声ファイル（mp3, m4a, wav など）のアップロード
- **文字起こし**: AIによる話者分離の実行・結果表示
- **出力**: キーワード抽出 & フィルター（標準と GiNZA を切り替え。GiNZA はベータ機能）、話者ごとの色分け表示
- **深掘り**: 要約、キーワードから調査質問を生成する会話分析（Web検索付き）、発言の文脈の分析
- **ディープサーチ**: 会話に出てきた用語を Web の公式情報で調べた解説と、根拠の評価を表示
- **個人情報チェック**: Claude に送る前に伏せる文字列の確認・選択
- **誤りの報告**: AI が生成した結果の誤りを報告し、見直すときに一緒に表示
- **設定**: APIキー管理、AI 分析（Claude と AWS）の ON/OFF、GiNZA（ベータ）の有効化

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| ビルドツール | Vite | 7.x |
| UIライブラリ | React | 19.x |
| 言語 | TypeScript | 5.9.x |
| Markdown変換 | marked | 17.x |
| リンター | ESLint | 9.x |

## セットアップ

### 依存パッケージのインストール

```bash
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

http://localhost:5173 でアクセスできます。

### ビルド

```bash
npm run build
```

ビルド結果は `dist/` に出力されます。

## テスト

### ユニットテスト

vitest で実行しています。ユーティリティ関数とフックのテストは対象ファイルと同階層に `.test.ts`、コンポーネントのテストは `components/__tests__/` に `.test.tsx` として配置しています。主なものは次のとおりです。

| テストファイル | 内容 |
|--------------|------|
| `utils/keywords.test.ts` | 専門用語・固有名詞のキーワード抽出ロジック |
| `utils/speakerKeywords.test.ts` | 標準・GiNZA と話者に応じたキーワードの選び方 |
| `utils/researchReport.test.ts` | ディープサーチのレポートの表示用の組み立て |
| `utils/sanitizeHtml.test.ts` | AI が生成した Markdown を表示するときの HTML の無害化 |
| `components/__tests__/PrivacyPanel.test.tsx` | 個人情報チェックの表示と伏せる文字列の選択 |
| `components/__tests__/FeedbackButton.test.tsx` | 誤りの報告のフォーム |

### テスト実行

```bash
# ユニットテスト（1回実行）
npm run test:run

# ウォッチモード（ファイル変更時に自動実行）
npm run test
```

### その他のコマンド

```bash
# ビルド結果のプレビュー
npm run preview

# リント
npm run lint
```
