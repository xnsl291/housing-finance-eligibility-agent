/*
 * S7 답한 값 고치기의 계산 — 목록 줄 만들기와 다시 판정한 뒤 바뀐 곳. 그리지 않는다(resultText.ts와 같은 이유로 나눔).
 *
 * 목록 = 지금 값이 있는 항목 + 모른다고 한 항목(설계서 S7). 데이터는 둘 다 서버에서 온다.
 * - 값: GET /v1/sessions/{id}의 values. 출처(source)가 LLM이면 문장에서 읽음, USER면 직접 넣음
 *   (S2에서 고친 값과 S3에서 답한 값은 서버 기록상 둘 다 USER라 나눌 수 없다 — 그래서 '질문에 답한 값'이라고 쓰지 않는다)
 * - 모른다고 한 항목: GET /trace 기록을 서버 declined_of와 같은 규칙으로 되짚는다(resultText.declinedOf).
 *   next의 declined_needed는 쓰지 않는다 — 결과를 낼 때(RESULT)만 오고, 그중에서도 아직 판정에 필요한 것만 담는다.
 *   S3에서 질문을 받는 중(ASK)에는 없어서 목록을 만들 수 없다
 * 모른다고 한 뒤 값이 다시 들어온 항목은 값 줄로만 나온다(서버도 그 순간 모름이 풀린다).
 * 값이 있는데 모른다고도 한 항목(기준에 걸친 범위 값을 다시 물었을 때 '모르겠어요')은 값 줄로 보인다.
 */
import type { FieldCatalog, FieldValue, HeldValue, ProgramResult, TraceEvent } from "../api/types";
import { formatWon } from "../components/amount";
import { VERDICT_LABEL } from "../components/VerdictBadge";
import { declinedOf, fieldLabel, valueText } from "./resultText";

export interface HeldItem {
  field: string;
  label: string;
  /** read 문장에서 읽음 / direct 직접 넣음 / declined 모른다고 함(값 없음) */
  source: "read" | "direct" | "declined";
  /** 서버에 있는 값 그대로(고치기 칸의 처음 값). 모른다고 한 줄은 null */
  value: FieldValue | null;
  /** 보일 값(억·만, 범위, 한국어 선택지). 모른다고 한 줄은 null */
  shown: string | null;
  /** 문장에서 읽은 근거 구절. 서버가 주지 않았으면 null */
  phrase: string | null;
}

/** 줄 순서는 항목 목록(서버 GET /v1/fields)의 순서. 목록에 없는 항목(또는 목록을 못 받음)은 뒤에 서버가 준 순서로 */
export function heldItems(
  values: Record<string, HeldValue>,
  events: TraceEvent[],
  catalog: FieldCatalog | null,
): HeldItem[] {
  const declined = declinedOf(events);
  const fields = [...new Set([...Object.keys(values), ...declined])];
  const order = Object.keys(catalog ?? {});
  const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length);
  return fields
    .sort((a, b) => rank(a) - rank(b))
    .map((field): HeldItem => {
      const held = values[field];
      const label = fieldLabel(catalog, field);
      if (!held) return { field, label, source: "declined", value: null, shown: null, phrase: null };
      return {
        field,
        label,
        source: held.source === "LLM" ? "read" : "direct",
        value: held.value,
        shown: valueText(held.value, catalog?.[field]),
        phrase: held.source === "LLM" ? held.phrase : null,
      };
    });
}

/**
 * 고친 값으로 다시 판정한 뒤 바뀐 곳(시안 S4-k). 상품마다 판정이 바뀌었는지, 금액이 바뀌었는지.
 * 판정을 해석하지 않는다 — 두 응답을 견주어 다른 것만 적는다.
 * 금액은 앞뒤 둘 다 숫자일 때만 견준다. 한쪽이 없으면(조건 불충족이 되었거나 못 냄) 판정 줄이나 카드가 말한다 —
 * 판정이 끝나지 않은 금액을 '바뀐 한도'로 크게 알리면 확정처럼 읽힌다(G7)
 */
export function changeLines(previous: ProgramResult[], current: ProgramResult[]): string[] {
  const lines: string[] = [];
  for (const now of current) {
    const before = previous.find((p) => p.program_id === now.program_id);
    if (!before) {
      lines.push(`${now.program_name} — 이번에 새로 봤습니다`);
      continue;
    }
    if (before.status !== now.status) {
      lines.push(`${now.program_name} — ${VERDICT_LABEL[before.status]} → ${VERDICT_LABEL[now.status]}`);
    }
    const a = before.loan_limit?.amount_krw;
    const b = now.loan_limit?.amount_krw;
    if (typeof a === "number" && typeof b === "number" && a !== b) {
      lines.push(`${now.program_name} — 한도 ${formatWon(a)} → ${formatWon(b)}`);
    }
  }
  for (const gone of previous) {
    if (!current.some((c) => c.program_id === gone.program_id)) lines.push(`${gone.program_name} — 이번에는 보지 않았습니다`);
  }
  return lines;
}
