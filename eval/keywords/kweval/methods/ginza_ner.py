"""3. GiNZA（spaCy）：固有表現抽出と名詞句を使う"""

from collections import Counter

import spacy

from kweval.methods import Method, Scored
from kweval.methods.common import from_spacy, join_morphs, keep_term, noun_runs, run_surfaces, strip_audio_tags

# 数・日時・量などの固有表現は、キーワードではないので除く
NUMERIC_LABEL_PARTS = (
    "Date", "Time", "Money", "Percent", "Age", "Frequency", "Rank", "Point",
    "Ordinal", "Countx", "Multiplication", "Measurement", "Period", "Timex",
    "N_", "Number", "Temperature", "Speed", "Weight", "Volume", "Physical_Extent",
    "Space", "Calorie", "Seismic", "Stock", "Latitude", "Longitude", "Intensity",
    "Numex", "School_Age",
)  # fmt: skip

# 固有表現は名詞句より強いしるしとして、点数を重くする
ENTITY_WEIGHT = 2.0


def is_keyword_label(label: str) -> bool:
    return not any(part in label for part in NUMERIC_LABEL_PARTS)


class GinzaNer(Method):
    name = "ginza"
    label = "3. GiNZA 固有表現 + 名詞句"

    def __init__(self) -> None:
        self.nlp = None
        # 直近の extract で見つけた固有表現（組み合わせの手法で使う）
        self.last_entities: Counter[str] = Counter()
        self.last_labels: dict[str, str] = {}

    def setup(self) -> None:
        self.nlp = spacy.load("ja_ginza")

    def extract(self, utterances: list[str]) -> list[Scored]:
        if self.nlp is None:
            self.setup()
        entities: Counter[str] = Counter()
        phrases: Counter[str] = Counter()
        labels: dict[str, str] = {}
        for doc in self.nlp.pipe((strip_audio_tags(u) for u in utterances), batch_size=32):
            for ent in doc.ents:
                text = ent.text.strip()
                # 句読点をまたぐ固有表現（「Mastoroだったりとか、」など）は、範囲の誤りなので除く
                if any(p in text for p in "、。"):
                    continue
                if is_keyword_label(ent.label_) and keep_term(text):
                    entities[text] += 1
                    labels.setdefault(text, ent.label_)
            morphs = from_spacy(doc)
            runs = noun_runs(morphs)
            for chunk in doc.noun_chunks:
                # 名詞句の主要部（root）を含む名詞の連続だけを取り出す
                # 例:「経営管理のSaaSの会社」→「会社」、「共同創業者CTO」→「共同創業者CTO」
                root = morph_index(doc, chunk.root.i)
                for start, end in runs:
                    if start <= root < end:
                        text = join_morphs(run_surfaces(morphs, start, end))
                        if keep_term(text):
                            phrases[text] += 1
                        break
        self.last_entities = entities
        self.last_labels = labels
        scores: dict[str, float] = {}
        counts: Counter[str] = Counter()
        for term, n in phrases.items():
            scores[term] = scores.get(term, 0.0) + n
            counts[term] += n
        for term, n in entities.items():
            scores[term] = scores.get(term, 0.0) + ENTITY_WEIGHT * n
            counts[term] = max(counts[term], n)
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        return [Scored(t, s, counts[t], proper=t in entities) for t, s in ranked]


def morph_index(doc, token_i: int) -> int:
    """spaCy のトークン位置を、空白を除いた Morph の列での位置に直す"""
    return sum(1 for t in doc[:token_i] if not t.tag_.startswith("空白"))
