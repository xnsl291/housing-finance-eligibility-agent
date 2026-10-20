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

describe("잘못 읽힐 금액은 오류로 (원 단위 실수·상한·단위 중복)", () => {
  it.each(["180000000", "18000000", "1억 18000000", "12345678.5"])(
    "단위 없는 숫자가 8자리 이상인 %s는 원 단위 실수로 보고 오류",
    (text) => {
      expect(parseAmount(text)).toEqual({
        error: "원 단위로 적으신 것 같습니다. 만원 단위로 적어 주세요(예: 1억 8천은 18000)",
      });
    },
  );

  it("7자리까지는 만원으로 읽는다", () => {
    expect(parseAmount("9999999")).toEqual({ won: 99_999_990_000 });
  });

  it("단위를 붙여 적은 큰 수는 원 단위 실수로 보지 않는다", () => {
    expect(parseAmount("18000000만")).toEqual({ won: 180_000_000_000 });
  });

  it.each(["1000000000억", "99999999999999999999억"])("정수로 정확히 보낼 수 없는 %s는 오류", (text) => {
    expect(parseAmount(text)).toEqual({ error: "금액이 너무 큽니다" });
  });

  it.each(["1만만", "1억만", "3억2천만만"])("단위가 겹친 %s는 오류", (text) => {
    expect(parseAmount(text)).toHaveProperty("error");
  });

  it.each(["-100", "-3억"])("음수 %s는 오류", (text) => {
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

  it("음수가 들어와도 부호는 맨 앞에 한 번만 붙는다", () => {
    expect(formatWon(-10_010_000)).toBe("-1,001만원");
    expect(formatWon(-110_000_000)).toBe("-1억 1,000만원");
  });

  it("범위는 범위로 (G6)", () => {
    expect(formatRange(45_000_000, 50_000_000)).toBe("4,500만~5,000만원");
  });

  it("서버 값을 칸에 다시 넣으면 같은 값으로 읽힌다", () => {
    // 1,000억원 이상은 만원 단위 숫자가 8자리가 되어 원 단위 실수로 읽히므로 억을 붙여 넣는다
    for (const won of [180_000_000, 45_000_000, 123_456_789, 0, 100_000_000_000, 1_234_567_890_000]) {
      expect(parseAmount(wonToInput(won))).toEqual({ won });
    }
    expect(wonToInput(null)).toBe("");
  });
});
