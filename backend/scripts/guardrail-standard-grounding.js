/**
 * get-guardrail の出力から、根拠の確認（contextual grounding check）だけを STANDARD にした
 * update-guardrail の入力を作る（今の設定はそのまま引き継ぐ。AWS には何も送らない）
 *
 * 使い方: node scripts/guardrail-standard-grounding.js <get-guardrail の出力.json> > update.json
 * 先に npm run build でビルドしておく（dist の GuardrailUpdateInput を使う）
 */
const fs = require('fs');
const {
  GuardrailUpdateInput,
} = require('../dist/privacy/guardrail-update-input.js');

const file = process.argv[2];
if (!file) {
  console.error(
    '使い方: node scripts/guardrail-standard-grounding.js <get-guardrail の出力.json>',
  );
  process.exit(1);
}

try {
  const current = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const input = new GuardrailUpdateInput(current).withStandardGrounding();
  process.stdout.write(`${JSON.stringify(input, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
