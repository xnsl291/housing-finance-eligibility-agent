// 색 토큰 대비를 글자 그대로 읽어 계산한다. 시안 값을 옮기다 대비가 모자란 색이 다시 들어오면 잡으려고
import tokens from "./tokens.css?raw";

function token(name: string): string {
  const m = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!m) throw new Error(`tokens.css에 --${name}이 없음`);
  return m[1];
}

/** WCAG 2.x 상대 휘도 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("색 대비", () => {
  it("잠긴 버튼 글자(off-fg)가 바탕(off-bg) 위에서 4.5:1 이상이다", () => {
    expect(contrast(token("off-fg"), token("off-bg"))).toBeGreaterThanOrEqual(4.5);
  });
});
