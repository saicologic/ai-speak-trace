"""GiNZA で発話ごとに名詞のまとまり（キーワードの候補）を取り出す

標準入力: {"texts": ["発話1", "発話2", ...]}
標準出力: {"terms": [[[正規化した語, 表記], ...], ...]}（発話ごと、出てきた順）
--check: モデルを読み込めるかを確かめ、{"ok": true, "versions": {...}} を出力する

取り出し方（評価で決めたもの）
- 続いている名詞を1語にまとめる（副詞可能名詞・数詞・人名は名詞として扱わない）
- 先頭の接頭辞（再・新など）と、名詞の後の接尾辞（性・的など）をつなげる。敬称（さん・様など）はつなげない
- 先頭と末尾の助数詞可能名詞（時間・円など）は外す（「社」は会社名の一部のため残す）
- 2文字未満・ひらがなだけ・1語だけのストップワードは除く
- 英単語の間の空白は残す
"""
import json
import re
import sys
import unicodedata

HIRAGANA_ONLY = re.compile(r'^[ぁ-ゖー]+$')
HONORIFICS = {'さん', '様', 'さま', '君', 'くん', 'ちゃん', '氏', '先生'}
# Sudachi が受け付ける長さより短く区切る（文字数。UTF-8 では 1 文字最大 4 バイト）
MAX_CHARS = 10000


def normalize(text):
    return unicodedata.normalize('NFKC', text).lower()


def is_noun(token):
    tag = token.tag_
    return (tag.startswith('名詞') and '数詞' not in tag and '副詞可能' not in tag
            and '人名' not in tag)


def extract(doc):
    """1つの解析結果から [正規化した語, 表記] の一覧を返す"""
    tokens = list(doc)
    found = []
    i = 0
    while i < len(tokens):
        j = i
        buf = []
        while j < len(tokens) and tokens[j].tag_.startswith('接頭辞'):
            buf.append(tokens[j])
            j += 1
        k = j
        while k < len(tokens) and (
            is_noun(tokens[k])
            or (k > j and tokens[k].tag_.startswith('接尾辞') and tokens[k].text not in HONORIFICS)
        ):
            buf.append(tokens[k])
            k += 1
        if k == j:
            i += 1
            continue
        while buf and '助数詞可能' in buf[0].tag_:
            buf.pop(0)
        while len(buf) > 1 and '助数詞可能' in buf[-1].tag_ and buf[-1].text != '社':
            buf.pop()
        # 英単語の間の空白は残す（Google Meet など）
        surface = ''.join(t.text_with_ws for t in buf).strip()
        if (len(surface) >= 2 and not HIRAGANA_ONLY.match(surface)
                and not (len(buf) == 1 and buf[0].is_stop)):
            found.append([normalize(surface), surface])
        i = k
    return found


def split_long(text):
    """長すぎる発話を句点で区切る（区切れなければ文字数で切る）"""
    if len(text) <= MAX_CHARS:
        return [text]
    parts, current = [], ''
    for sentence in re.split(r'(?<=[。！？!?])', text):
        while len(sentence) > MAX_CHARS:
            parts.append(sentence[:MAX_CHARS])
            sentence = sentence[MAX_CHARS:]
        if len(current) + len(sentence) > MAX_CHARS:
            parts.append(current)
            current = ''
        current += sentence
    if current:
        parts.append(current)
    return parts


def main():
    import spacy

    nlp = spacy.load('ja_ginza')
    if '--check' in sys.argv:
        from importlib.metadata import version
        json.dump({'ok': True, 'versions': {'ginza': version('ginza'), 'ja-ginza': version('ja-ginza'),
                                            'spacy': spacy.__version__}}, sys.stdout)
        return
    texts = json.load(sys.stdin)['texts']
    result = []
    for text in texts:
        terms = []
        for doc in nlp.pipe(split_long(text)):
            terms.extend(extract(doc))
        result.append(terms)
    json.dump({'terms': result}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
