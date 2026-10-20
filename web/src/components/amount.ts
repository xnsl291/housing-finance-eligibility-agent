/*
 * 금액 글자 ↔ 원 단위 정수.
 *
 * 사용자는 만원·억 단위로 적고(`3억 2천`, `4500`, `1억 8,000만`) 서버는 원 단위 정수를 받는다.
 * 원으로 직접 치게 하면 0을 하나 더 넣거나 빼는 실수가 잦다(설계서 7.2 [제안 P2]).
 *
 * 숫자만 적으면 만원으로 본다. 그래서 `2천`은 2천만원이다(억 아래 자리는 만원 단위).
 * 빈칸은 null이다 — 0으로 바꾸지 않는다. 소득 0과 소득 모름은 판정이 다르다(G5).
 * 알아볼 수 없는 글은 null이 아니라 오류로 돌려준다. 조용히 빈칸 취급하면 사용자가 적은
 * 값이 사라진 것을 모른다.
 */

export type AmountParse = { won: number | null } | { error: string };

const UNIT_MAN: Record<string, number> = { 억: 10_000, 천: 1_000, 백: 100, 십: 10, 만: 1 };
const TOKEN = /(\d+(?:\.\d+)?)?(억|천|백|십|만)?/y;

export function parseAmount(text: string): AmountParse {
  let s = text.replace(/[\s,]/g, "");
  if (s === "") return { won: null };
  // 끝의 '원'은 '만원'·'억원'처럼 단위 뒤에서만 받는다. `5000원`을 5000만원으로 읽으면 안 됨
  if (s.endsWith("원")) {
    if (!/[억만]원$/.test(s)) return { error: "만원 단위로 적어 주세요. 예: 4500 또는 4천5백" };
    s = s.slice(0, -1);
  }

  let man = 0;
  let lastScale = Infinity;
  let pos = 0;
  while (pos < s.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(s);
    if (!m || m[0] === "") return { error: "금액을 알아볼 수 없습니다. 예: 3억 2천, 4500" };
    const [, num, unit] = m;
    pos = TOKEN.lastIndex;
    if (num === undefined) {
      // `4천만`·`1억5천만`처럼 숫자 없이 끝에 붙은 '만'은 앞자리가 만원 단위라는 표시일 뿐
      if (unit === "만" && pos === s.length && man > 0) break;
      return { error: "금액을 알아볼 수 없습니다. 예: 3억 2천, 4500" };
    }
    const scale = unit ? UNIT_MAN[unit] : 1;
    // `2천3억`처럼 큰 단위가 뒤에 오면 틀린 글이다
    if (scale >= lastScale) return { error: "금액을 알아볼 수 없습니다. 예: 3억 2천, 4500" };
    lastScale = scale;
    man += Number(num) * scale;
  }

  const won = Math.round(man * 10_000);
  // 소수점 아래가 원 아래로 내려가면(0.00001만원) 원 단위 정수로 보낼 수 없다
  if (Math.abs(won - man * 10_000) > 1e-6) return { error: "원 단위까지만 적을 수 있습니다" };
  return { won };
}

/** 180000000 → `1억 8,000만원`. 금액은 억·만으로 끊어 보여 준다(G11). */
export function formatWon(won: number): string {
  return `${formatWonBare(won)}원`;
}

/** 범위는 범위로 보여 준다(G6). 45000000~50000000 → `4,500만~5,000만원` */
export function formatRange(low: number, high: number): string {
  return `${formatWonBare(low)}~${formatWonBare(high)}원`;
}

function formatWonBare(won: number): string {
  if (won === 0) return "0";
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const rest = won % 10_000;
  const parts: string[] = [];
  if (eok) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  if (rest) parts.push(rest.toLocaleString("ko-KR"));
  return parts.join(" ");
}

/** 서버 값을 칸에 다시 넣을 때. 만원 단위 숫자로 돌려야 parseAmount가 같은 값으로 읽는다 */
export function wonToInput(won: number | null | undefined): string {
  return won == null ? "" : String(won / 10_000);
}
