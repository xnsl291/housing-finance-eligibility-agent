import { formatRange, formatWon, parseAmount, wonToInput } from "./amount";

describe("만원·억으로 적은 금액을 원 단위 정수로 (설계서 7.2)", () => {
  it.each([
    ["3억 2천", 320_000_000],
    ["3억2천만원", 320_000_000],
    ["1억 8,000만", 180_000_000],
    ["1억8천", 180_000_000],
    ["18000", 180_000_000],
    ["4500", 45_000_000],
    ["4천5백", 45_000_000],
    ["4천만", 40_000_000],
    ["2천", 20_000_000],
    ["1.5억", 150_000_000],
    ["3억원", 300_000_000],
    ["0", 0],
  ])("%s → %d원", (text, won) => {
    expect(parseAmount(text)).toEqual({ won });
  });

  it("빈칸은 0이 아니라 null이다 (G5)", () => {
    expect(parseAmount("")).toEqual({ won: null });
    expect(parseAmount("   ")).toEqual({ won: null });
  });

  it.each(["abc", "2천3억", "5000원", "-100", "만원", "0.00001"])("%s는 빈칸이 아니라 오류다", (text) => {
    expect(parseAmount(text)).toHaveProperty("error");
  });
});

describe("억·만 표기 (G11)", () => {
  it.each([
    [180_000_000, "1억 8,000만원"],
    [45_000_000, "4,500만원"],
    [300_000_000, "3억원"],
    [123_456_789, "1억 2,345만 6,789원"],
    [0, "0원"],
  ])("%d → %s", (won, text) => {
    expect(formatWon(won)).toBe(text);
  });

  it("범위는 범위로 (G6)", () => {
    expect(formatRange(45_000_000, 50_000_000)).toBe("4,500만~5,000만원");
  });

  it("서버 값을 칸에 다시 넣으면 같은 값으로 읽힌다", () => {
    for (const won of [180_000_000, 45_000_000, 123_456_789, 0]) {
      expect(parseAmount(wonToInput(won))).toEqual({ won });
    }
    expect(wonToInput(null)).toBe("");
  });
});
