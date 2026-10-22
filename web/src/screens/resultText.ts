/*
 * 판정 결과(S4·S5·S6)에서 쓰는 계산과 문구. 그리지 않는다 — 테스트로 바로 지키려고 화면과 나눴다.
 *
 * 여기서도 판정하지 않는다. 받은 응답을 정렬하고 사람이 읽을 말로 바꾸기만 한다(Streamlit `ui/flow.py`,
 * `ui/screens/results.py`와 같은 일). 값을 반올림하거나 없는 값을 채우지 않는다.
 *
 * 이름표는 화면이 만들지 않는다. 항목 이름은 서버 항목 목록(GET /v1/fields)과, 판정 응답이 규칙마다 싣는
 * field_label(파생 항목 포함), 한도 구간 이름은 판정 응답의 tier_label·skipped_tier_labels가 정본이다.
 */
import type { FieldCatalog, FieldInfo, FieldValue, LoanLimit, Program, ProgramResult, Status, TraceEvent } from "../api/types";
import { formatRange, formatWon } from "../components/amount";

/** 결과 카드 순서(설계서 13절 Q2 — 판정 순으로 확정). 모르는 상태는 맨 뒤 */
const VERDICT_ORDER: Status[] = ["PRECHECK_MATCH", "CONDITIONAL", "INSUFFICIENT_INFORMATION", "NOT_MATCHED"];

/** 판정 순으로 정렬한다. 같은 판정끼리는 서버 순서를 지킨다(안정 정렬) */
export function sortByVerdict(results: ProgramResult[]): ProgramResult[] {
  const rank = (s: Status) => {
    const i = VERDICT_ORDER.indexOf(s);
    return i === -1 ? VERDICT_ORDER.length : i;
  };
  return [...results].sort((a, b) => rank(a.status) - rank(b.status));
}

/** 아직 확인되지 않은 조건 수 = 값 없음 + 기준에 걸침(Streamlit _확인_안_된_조건) */
export function unresolvedCount(result: ProgramResult): number {
  return result.missing_fields.length + result.imprecise_fields.length;
}

/**
 * 한도 설명 한 줄(설계서 S4 '한도 설명'). 두 상한 중 어느 쪽에 걸렸는지.
 * 비율을 거는 값은 전세는 임차보증금, 매매는 주택가격이다(limits.py ratio_field). 응답에는 그 항목이 없어서
 * 상품의 전세·매매(GET /v1/programs의 tenure)로 고른다. 설계서 문구는 전세 기준이라 매매에 쓰면 틀린 말이 된다.
 * 상품 목록을 못 받았으면 어느 값인지 말하지 않는다
 */
export function limitNote(limit: LoanLimit, tenure: "JEONSE" | "PURCHASE" | null | undefined): string {
  const ratio = limit.ratio_amount_krw;
  const cap = limit.cap_amount_krw;
  if (ratio == null || cap == null) return "계산 근거를 응답에서 받지 못했습니다";
  const base = tenure === "JEONSE" ? "보증금 비율" : tenure === "PURCHASE" ? "주택가격 비율" : "비율";
  const hit = ratio <= cap ? base : "금액 상한";
  return `${base}로 구한 ${formatWon(ratio)}과 금액 상한 ${formatWon(cap)} 중 작은 쪽입니다 — ${hit}에 걸렸습니다`;
}

/** 항목 코드 → 이름표. 항목 목록을 못 받았으면 코드 그대로(설계서 S4 상태표) */
export function fieldLabel(catalog: FieldCatalog | null, field: string): string {
  return catalog?.[field]?.label ?? field;
}

/** 값 한 개를 사람이 읽을 말로(설계서 S6 — 금액은 억·만, 예/아니오, 선택지는 한국어). Streamlit flow._값_보기. S7 조건 요약도 쓴다 */
export function valueText(value: FieldValue, info: FieldInfo | undefined): string {
  if (typeof value === "object") return formatRange(value.low, value.high);
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (info?.kind === "AMOUNT" && typeof value === "number") return formatWon(value);
  return info?.choice_labels?.[String(value)] ?? String(value);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * 확인 과정(S6) 줄들. Streamlit flow.trace_lines와 같은 모양.
 * 판정에 쓰이지 않는 기록(세션 시작)과 모르는 종류는 줄을 만들지 않는다.
 * 바로 앞 기록도 판정이고 결과가 같으면 '판정함'을 다시 쓰지 않는다. 판정이 시간 초과로 끊겼지만 서버는
 * 마친 뒤 '다시 시도'하면, 같은 값으로 같은 판정이 두 번 기록된다. 사용자가 한 일은 한 번이다
 */
export function traceLines(events: TraceEvent[], catalog: FieldCatalog | null): string[] {
  const lines: string[] = [];
  const name = (f: string) => fieldLabel(catalog, f);
  let lastAssessed: string | null = null;
  for (const event of events) {
    if (event.kind === "ASSESSED") {
      const results = JSON.stringify(isObject(event.payload) ? event.payload.results : null);
      if (results !== lastAssessed) lines.push("판정함");
      lastAssessed = results;
      continue;
    }
    // 값을 읽고·넣고·모른다고 한 기록이 사이에 있으면 다시 판정한 것이다
    if (event.kind === "EXTRACTED" || event.kind === "FIELD_SET" || event.kind === "FIELD_DECLINED") lastAssessed = null;
    const payload = isObject(event.payload) ? event.payload : {};
    const values = isObject(payload.values) ? payload.values : {};
    if (event.kind === "EXTRACTED") {
      const read = Object.keys(values);
      if (read.length > 0) lines.push(`문장에서 읽음 — ${read.map(name).join(", ")}`);
    } else if (event.kind === "FIELD_SET") {
      for (const [field, value] of Object.entries(values)) {
        lines.push(
          value === null || value === undefined
            ? `${name(field)} — 비움`
            : `${name(field)} — ${valueText(value as FieldValue, catalog?.[field])}`,
        );
      }
    } else if (event.kind === "FIELD_DECLINED") {
      lines.push(`${name(String(payload.field))} — 모른다고 함`);
    }
  }
  return lines;
}

/**
 * 모른다고 한 항목. 서버 session.py declined_of와 같은 규칙이다 — 나중 것이 이긴다.
 * 모른다고 한 뒤 값을 넣으면(답하든 문장에서 읽든) 풀린다. **값을 비우는 것(null)만으로는 풀리지 않는다.**
 * 풀린 뒤 값을 지워도 모름이 되살아나지 않는다
 */
export function declinedOf(events: TraceEvent[]): Set<string> {
  const declined = new Set<string>();
  for (const event of events) {
    const payload = isObject(event.payload) ? event.payload : {};
    if (event.kind === "FIELD_DECLINED") {
      declined.add(String(payload.field));
    } else if (event.kind === "EXTRACTED" || event.kind === "FIELD_SET") {
      const values = isObject(payload.values) ? payload.values : {};
      for (const [field, value] of Object.entries(values)) if (value !== null) declined.delete(field);
    }
  }
  return declined;
}

const TENURE_FIELD = "intended_tenure";

/**
 * 왜 이 상품만 보이나 한 줄(설계서 S3 끝 표).
 *
 * 무엇을 뺐는지는 후보 상품(next.candidates)으로 안다. 서버는 전세·매매 값이 있을 때만 그쪽 상품으로
 * 후보를 좁힌다(next_action.py _candidates) — 기록을 되짚지 않아도 되고, 기록을 못 받아도 쓸 수 있다.
 * 상품 목록을 못 받았으면 어느 쪽 상품인지 몰라 그리지 않는다(null).
 *
 * 다 봤을 때는 모른다고 했는지에 따라 문구가 다르다. 멈춘 이유의 declined_needed나 기록(declinedOf)으로 안다.
 * 둘 다로 알 수 없으면(기록을 못 받음) '답하지 않으셔서' — 모른다고 한 경우에도 참인 말이다.
 * 설계서 표의 '세 상품'은 상품 수가 바뀌면 틀리므로 실제로 본 상품 수를 쓴다
 */
export function scopeLine(
  candidates: string[],
  programs: Program[] | null,
  events: TraceEvent[] | null,
  declinedNeeded: string[],
): string | null {
  if (!programs || candidates.length === 0) return null;
  if (candidates.length < programs.length) {
    const kinds = new Set(candidates.map((id) => programs.find((p) => p.program_id === id)?.tenure));
    if (kinds.size !== 1) return null;
    if (kinds.has("JEONSE")) return "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다";
    if (kinds.has("PURCHASE")) return "집을 사신다고 해서 전세 상품은 빼고 봤습니다";
    return null;
  }
  const declined = declinedNeeded.includes(TENURE_FIELD) || (events !== null && declinedOf(events).has(TENURE_FIELD));
  const n = candidates.length;
  return declined
    ? `전세인지 매매인지 모르셔서 상품 ${n}개를 모두 봤습니다`
    : `전세·매매를 답하지 않으셔서 상품 ${n}개를 모두 봤습니다`;
}

/** 지울 것(읽은 값·넣은 값·모른다고 한 것)이 있는가 — '처음부터 다시' 확인 창을 띄울지(설계서 M1) */
export function hasRecords(events: TraceEvent[]): boolean {
  return events.some((e) => e.kind === "EXTRACTED" || e.kind === "FIELD_SET" || e.kind === "FIELD_DECLINED");
}
