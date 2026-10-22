/*
 * 판정 결과(S4·S5·S6)에서 쓰는 계산과 문구. 그리지 않는다 — 테스트로 바로 지키려고 화면과 나눴다.
 *
 * 여기서도 판정하지 않는다. 받은 응답을 정렬하고 사람이 읽을 말로 바꾸기만 한다(Streamlit `ui/flow.py`,
 * `ui/screens/results.py`와 같은 일). 값을 반올림하거나 없는 값을 채우지 않는다.
 *
 * 항목 이름의 정본은 서버 항목 목록(GET /v1/fields)이다. 다만 판정에만 쓰는 파생 항목(수도권 여부,
 * 병역 반영 나이)은 그 목록에 없어서(rules.py field_catalog) 규칙 줄에 코드가 그대로 나온다(결함 D4).
 * 그 둘만 rules/field_guides.yaml의 이름표를 옮겨 둔다. 저쪽을 고치면 여기도 고친다.
 */
import type { FieldCatalog, FieldInfo, FieldValue, LoanLimit, ProgramResult, Status, TraceEvent } from "../api/types";
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

/**
 * 한도 구간 이름표. 서버가 응답에 이름표를 싣지 않아 assessment.py _TIER_NAMES를 옮겨 둔다(결함 D4).
 * 저쪽에 없는 구간(single·default·general)은 이름표를 지어내지 않는다 — 판정 근거에서 그 줄을 그리지 않는다
 */
const TIER_LABEL: Record<string, string> = {
  newlywed_or_two_children: "신혼 가구 또는 2자녀 이상 가구",
  under_25_single: "만 25세 미만 단독세대주",
  first_time: "생애최초 주택구입자",
  single_first_time: "생애최초 주택구입자",
};

export function tierLabel(tier: string | null): string | null {
  return tier ? (TIER_LABEL[tier] ?? null) : null;
}

/** 파생 항목 이름표(머리말). rules/field_guides.yaml의 region·age_after_service_credit */
const DERIVED_LABEL: Record<string, string> = {
  region: "수도권 여부",
  age_after_service_credit: "병역 복무기간을 반영한 나이",
};

/** 항목 코드 → 이름표. 항목 목록을 못 받았으면 코드 그대로(설계서 S4 상태표) */
export function fieldLabel(catalog: FieldCatalog | null, field: string): string {
  return catalog?.[field]?.label ?? DERIVED_LABEL[field] ?? field;
}

/** 값 한 개를 사람이 읽을 말로(설계서 S6 — 금액은 억·만, 예/아니오, 선택지는 한국어). Streamlit flow._값_보기 */
export function valueText(value: FieldValue, info: FieldInfo | undefined): string {
  if (typeof value === "object") return formatRange(value.low, value.high);
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (info?.kind === "AMOUNT" && typeof value === "number") return formatWon(value);
  return info?.choice_labels?.[String(value)] ?? String(value);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * 확인 과정(S6) 줄들. Streamlit flow.trace_lines와 같은 모양.
 * 판정에 쓰이지 않는 기록(세션 시작)과 모르는 종류는 줄을 만들지 않는다
 */
export function traceLines(events: TraceEvent[], catalog: FieldCatalog | null): string[] {
  const lines: string[] = [];
  const name = (f: string) => fieldLabel(catalog, f);
  for (const event of events) {
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
    } else if (event.kind === "ASSESSED") {
      lines.push("판정함");
    }
  }
  return lines;
}

/**
 * 기록으로 본 전세·매매 답. 서버 상태와 같은 규칙으로 되짚는다(session.py) — 값을 넣으면 '모른다'가 풀리고,
 * 비우면(null) 모르는 상태로 돌아간다. NONE은 아직 묻지도 답하지도 않음
 */
export type Tenure = "JEONSE" | "PURCHASE" | "DECLINED" | "NONE";

const TENURE_FIELD = "intended_tenure";

export function tenureOf(events: TraceEvent[]): Tenure {
  let tenure: Tenure = "NONE";
  for (const event of events) {
    const payload = isObject(event.payload) ? event.payload : {};
    if (event.kind === "FIELD_DECLINED" && payload.field === TENURE_FIELD) {
      if (tenure === "NONE") tenure = "DECLINED";
    } else if (event.kind === "EXTRACTED" || event.kind === "FIELD_SET") {
      const values = isObject(payload.values) ? payload.values : {};
      if (!(TENURE_FIELD in values)) continue;
      const v = values[TENURE_FIELD];
      tenure = v === "JEONSE" || v === "PURCHASE" ? v : "NONE";
    }
  }
  return tenure;
}

/**
 * 왜 이 상품만 보이나 한 줄(설계서 S3 끝 표). 앞 셋은 설계서 제안 문구 그대로.
 * 아직 묻지 않은 채 멈춘 경우(NONE)는 설계서 표에 없어 문구를 더했다 — 모른다고 한 것과는 사실이 다르다
 */
export function scopeLine(tenure: Tenure): string {
  switch (tenure) {
    case "JEONSE":
      return "전세를 구하신다고 해서 매매 상품은 빼고 봤습니다";
    case "PURCHASE":
      return "집을 사신다고 해서 전세 상품은 빼고 봤습니다";
    case "DECLINED":
      return "전세인지 매매인지 모르셔서 세 상품을 모두 봤습니다";
    case "NONE":
      return "전세인지 매매인지 아직 여쭙지 않아 세 상품을 모두 봤습니다";
  }
}

/** 지울 것(읽은 값·넣은 값·모른다고 한 것)이 있는가 — '처음부터 다시' 확인 창을 띄울지(설계서 M1) */
export function hasRecords(events: TraceEvent[]): boolean {
  return events.some((e) => e.kind === "EXTRACTED" || e.kind === "FIELD_SET" || e.kind === "FIELD_DECLINED");
}
