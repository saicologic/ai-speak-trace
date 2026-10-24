import { piiLabel } from '../privacy/privacy.utils';

/**
 * 連絡先などを伏せる（MCP サーバーで返す直前に使う）
 *
 * アプリの中で Claude に送るときは、送る直前に Guardrails で連絡先などを検出して伏せる。
 * MCP サーバーは AWS を呼ばないため、形の決まっている連絡先などを、この Mac の中の正規表現で伏せる。
 * 氏名・住所のような形の決まっていないものは検出できない（個人情報チェックの「伏せる」で伏せる）
 */

/** 半角・全角の数字 */
const D = '[0-9０-９]';
/** 数字の区切り（ハイフン・長音・空白） */
const SEP = '[-－‐ー−\\s]?';
/** 前後に続く数字がない（区切りをはさんで続く数字も含む。長い番号の一部だけを伏せないため） */
const START = `(?<!${D}${SEP})`;
const END = `(?!${SEP}${D})`;

interface ContactPattern {
  /** 個人情報の種類（表示名は piiLabel で決める） */
  type: string;
  pattern: RegExp;
  /** 一致したものを伏せるか（桁数などで誤検出を減らす） */
  accept?: (match: string) => boolean;
}

/** 数字だけを取り出す（全角は半角にする） */
function digitsOf(text: string): string {
  return text.normalize('NFKC').replace(/\D/g, '');
}

/** カード番号のチェックディジット（Luhn）が合うか */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** 長いものから順に伏せる（カード番号の一部を電話番号として伏せないため） */
const CONTACT_PATTERNS: ContactPattern[] = [
  {
    type: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]+[@＠][A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: 'CREDIT_DEBIT_CARD_NUMBER',
    pattern: new RegExp(`${START}${D}{4}(?:${SEP}${D}{2,4}){3}${END}`, 'g'),
    accept: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 16 && luhn(d);
    },
  },
  {
    type: 'JP_MY_NUMBER',
    pattern: new RegExp(`${START}${D}{4}${SEP}${D}{4}${SEP}${D}{4}${END}`, 'g'),
    accept: (m) => digitsOf(m).length === 12,
  },
  {
    type: 'PHONE',
    pattern: new RegExp(
      `${START}(?:[+＋]81${SEP}|${D})${D}{0,4}${SEP}[(（]?${D}{1,4}[)）]?${SEP}${D}{3,4}${END}`,
      'g',
    ),
    accept: (m) => {
      const d = digitsOf(m);
      // 国内の番号は 0 から始まる10・11桁（+81 は 0 を除いた9・10桁）
      return d.startsWith('81')
        ? d.length >= 11 && d.length <= 12
        : d.startsWith('0') && d.length >= 10 && d.length <= 11;
    },
  },
  {
    type: 'IP_ADDRESS',
    pattern: /(?<![0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9.])/g,
    accept: (m) => m.split('.').every((n) => Number(n) <= 255),
  },
];

/** 連絡先などを [電話番号] のように置き換える */
export function maskContacts(text: string): string {
  let result = text;
  for (const { type, pattern, accept } of CONTACT_PATTERNS) {
    result = result.replace(pattern, (m) =>
      !accept || accept(m) ? `[${piiLabel(type)}]` : m,
    );
  }
  return result;
}
