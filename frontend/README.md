# AI Speak Trace - Frontend

音声文字起こし結果の閲覧・キーワード分析・会話分析を行うフロントエンドアプリケーションです。

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

### 環境変数

開発時はViteのプロキシ設定により `http://localhost:3100` へ自動的に転送されるため、環境変数の設定は不要です。

本番環境ではバックエンドのURLを指定してください。

```env
VITE_API_BASE_URL=https://your-backend-url.com/api
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

### その他のコマンド

```bash
# ビルド結果のプレビュー
npm run preview

# リント
npm run lint
```
