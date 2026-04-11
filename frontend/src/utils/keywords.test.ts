import { describe, it, expect } from "vitest";
import { extractKeywords } from "./keywords";

describe("extractKeywords", () => {
  it("空文字列から空のキーワードリストを返す", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("キーワードが含まれないテキストから空のリストを返す", () => {
    expect(extractKeywords("これはひらがなだけの文です")).toEqual([]);
  });

  it("カタカナ語（3文字以上）を抽出する", () => {
    const result = extractKeywords(
      "ドキュメントの管理をします。ドキュメントは重要です。",
    );
    const texts = result.map((k) => k.text);
    expect(texts).toContain("ドキュメント");
  });

  it("英語略語（大文字2文字以上）を抽出する", () => {
    const result = extractKeywords(
      "AIとLLMの技術について話します。APIの設計も重要です。",
    );
    const texts = result.map((k) => k.text);
    expect(texts).toContain("AI");
    expect(texts).toContain("LLM");
    expect(texts).toContain("API");
  });

  it("英語+カタカナの複合語を抽出する", () => {
    const result = extractKeywords("AIエコシステムの発展が重要です");
    const texts = result.map((k) => k.text);
    expect(texts).toContain("AIエコシステム");
  });

  it("カタカナ+漢字の複合語を抽出する", () => {
    const result = extractKeywords("コーネル大学の研究成果");
    const texts = result.map((k) => k.text);
    expect(texts).toContain("コーネル大学");
  });

  it("先頭大文字の英単語（4文字以上）を抽出する", () => {
    const result = extractKeywords("Claudeを使って分析します");
    const texts = result.map((k) => k.text);
    expect(texts).toContain("Claude");
  });

  it("複数語の英語（Kotoba Technologies等）を抽出する", () => {
    const result = extractKeywords("Kotoba Technologiesが開発した技術");
    const texts = result.map((k) => k.text);
    expect(texts).toContain("Kotoba Technologies");
  });

  it("出現回数をカウントし、頻度順にソートする", () => {
    const result = extractKeywords(
      "APIを使います。LLMも使います。APIの設計。APIの実装。",
    );
    expect(result[0].text).toBe("API");
    expect(result[0].count).toBe(3);
  });

  it("ストップワードを除外する", () => {
    const result = extractKeywords(
      "スゴイ技術です。ホントに便利です。チョット難しい。",
    );
    const texts = result.map((k) => k.text);
    expect(texts).not.toContain("スゴイ");
    expect(texts).not.toContain("ホント");
    expect(texts).not.toContain("チョット");
  });

  it("2文字未満のキーワードを除外する", () => {
    const result = extractKeywords("AはBより大きい");
    const texts = result.map((k) => k.text);
    // 1文字の大文字は除外
    expect(texts).not.toContain("A");
    expect(texts).not.toContain("B");
  });

  it("漢字+英字の複合語を抽出する", () => {
    const result = extractKeywords("富岳LLMの性能が話題です");
    const texts = result.map((k) => k.text);
    expect(texts).toContain("富岳LLM");
  });

  it("長い複合語を優先し、短いマッチを除外する", () => {
    const result = extractKeywords("AIエコシステムの設計");
    const texts = result.map((k) => k.text);
    // 「AIエコシステム」は含むが、その部分マッチ「エコシステム」は除外
    expect(texts).toContain("AIエコシステム");
    expect(texts).not.toContain("エコシステム");
  });
});
