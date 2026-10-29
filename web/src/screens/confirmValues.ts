/*
 * S2 읽은 내용 확인의 계산. 화면을 그리지 않는 조각만 모아 따로 시험한다.
 *
 * 옛 Streamlit 화면(지움)의 `ui/flow.py` confirm_updates와 `ui/screens/confirm.py`의 근거 문구를 옮긴 것이다.
 * - 바뀐 값만 보낸다. 그대로 둔 값을 다시 보내면 서버 기록에서 그 값의 출처가 '문장에서 읽음'에서
 *   '직접 넣음'으로 바뀌어, 결과 화면의 확인 과정(S6)이 사실과 달라진다(설계서 S2)
 * - 비운 값은 null로 보낸다. 서버는 null을 "지움 → 모름"으로 받는다(`session.py` replay)
 * - 빈칸은 null이지 0이 아니다(G5)
 */
import type { AmountRange, FieldCatalog, FieldInfo, FieldValue } from "../api/types";
import { formatRange, formatWon } from "../components/amount";

/** 칸 하나의 값. null은 모름(빈칸·`— 모름 —`·모름 라디오) */
export type Value = FieldValue | null;

export function isRange(value: Value): value is AmountRange {
  return typeof value === "object" && value !== null && "low" in value && "high" in value;
}

/** 같은 값인가. 범위는 두 끝을 비교한다(객체라 ===로는 늘 다르다) */
export function sameValue(a: Value, b: Value): boolean {
  if (isRange(a) || isRange(b)) return isRange(a) && isRange(b) && a.low === b.low && a.high === b.high;
  return a === b;
}

/**
 * 서버로 보낼 것. 처음 값(base)과 달라진 칸만, 비운 칸은 null로.
 * edits에 있어도 처음 값으로 되돌려 놓은 칸은 보내지 않는다.
 */
export function changedValues(base: Record<string, Value>, edits: Record<string, Value>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [name, value] of Object.entries(edits)) {
    if (!sameValue(value, base[name] ?? null)) out[name] = value;
  }
  return out;
}

/** 닫힌 줄에 보일 값. 금액은 억·만(G11), 범위는 범위(G6), 선택지는 서버가 준 한국어 이름표. null은 null(줄이 '모름'으로 보임) */
export function showValue(info: FieldInfo, value: Value): string | null {
  if (value === null) return null;
  if (isRange(value)) return formatRange(value.low, value.high);
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (info.kind === "AMOUNT" && typeof value === "number") return formatWon(value);
  if (info.kind === "CHOICE") return info.choice_labels?.[String(value)] ?? String(value);
  return String(value);
}

/**
 * 서버가 값을 거절한 문장(422 detail)을 칸별로 나눈다. 서버는 `값이 맞지 않습니다 — 나이: 사유; 전용면적: 사유`
 * 모양으로 낸다(`api.py` set_fields). 보낸 항목의 이름표로 시작하는 조각은 그 칸으로, 나머지(없는 항목 등)는
 * rest로 — 버튼 위 목록에 그대로 보인다. 모양이 바뀌어 하나도 못 나누면 문장 전체가 rest로 가므로 사유는 잃지 않는다.
 */
export function splitRejection(
  message: string,
  sent: string[],
  catalog: FieldCatalog,
): { byField: Record<string, string>; rest: string[] } {
  const body = message.includes(" — ") ? message.slice(message.indexOf(" — ") + 3) : message;
  const byField: Record<string, string> = {};
  const rest: string[] = [];
  for (const part of body.split("; ")) {
    // 이름표가 다른 이름표의 앞부분인 경우를 생각해 긴 이름표부터 맞춘다
    const name = [...sent]
      .sort((a, b) => (catalog[b]?.label.length ?? 0) - (catalog[a]?.label.length ?? 0))
      .find((n) => catalog[n] && part.startsWith(`${catalog[n].label}: `));
    if (name) byField[name] = part.slice(catalog[name].label.length + 2);
    else rest.push(part);
  }
  if (Object.keys(byField).length === 0) return { byField, rest: [message] };
  return { byField, rest };
}
