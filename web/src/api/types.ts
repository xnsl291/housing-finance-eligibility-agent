/*
 * 서버 응답의 모양. 정본은 `src/housing_finance_agent/api.py`이고 여기는 그 사본임.
 * 서버 응답을 바꾸면 여기도 같이 고칠 것.
 */

export type FieldKind = "AMOUNT" | "CHOICE" | "BOOL" | "DATE" | "TEXT" | "INT" | "FLOAT";

export interface FieldInfo {
  label: string;
  kind: FieldKind;
  choices?: string[];
  choice_labels?: Record<string, string>;
  how_to_check?: string;
}

export type FieldCatalog = Record<string, FieldInfo>;

/** 금액은 정수(원) 또는 범위. 사용자가 "7천 정도"라고 하면 범위가 된다. */
export type AmountRange = { low: number; high: number };
export type FieldValue = string | number | boolean | AmountRange;

export interface Health {
  status: string;
  programs: string[];
}

export interface Program {
  program_id: string;
  program_name: string;
  organization: string | null;
  tenure: "JEONSE" | "PURCHASE" | null;
  source_url: string;
  source_checked_at: string;
}

export interface HeldValue {
  value: FieldValue;
  source: "USER" | "LLM";
  at: string;
  phrase: string | null;
}

export interface SessionState {
  session_id: string;
  values: Record<string, HeldValue>;
}

/** 문장을 보낸 직후의 응답. 경고와 못 읽은 값은 이번 문장에만 해당해 저장되지 않는다. */
export interface ExtractedState extends SessionState {
  warnings: string[];
  unreadable: Record<string, string>;
}

export interface Question {
  field: string;
  label: string;
  kind: FieldKind;
  ask_kind: "MISSING" | "IMPRECISE";
  why: string;
  needed_by: string[];
  how_to_check: string | null;
  choices: string[] | null;
  choice_labels: Record<string, string> | null;
}

export interface NextAction {
  session_id: string;
  action: "ASK" | "RESULT";
  candidates: string[];
  policy_version: number;
  question?: Question;
  reason?: "ALL_NOT_MATCHED" | "COMPLETE" | "ONLY_DECLINED_LEFT";
  declined_needed?: string[];
}

/** `eligibility.py`. 확정 표현(ELIGIBLE·APPROVED)은 일부러 없다. */
export type Status = "PRECHECK_MATCH" | "CONDITIONAL" | "NOT_MATCHED" | "INSUFFICIENT_INFORMATION";

/** 규칙 하나의 결과(`api.py` rule_outcomes). outcome은 7가지지만 새 종류가 생겨도 화면이 숨기지 않게 string으로 받는다(설계서 8.2) */
export interface RuleOutcome {
  rule_id: string;
  outcome: string;
  field: string | null;
  /** 원문 인용. 비어 있으면 인용이 붙어 있지 않은 규칙 */
  citation: string | null;
  failure_message: string | null;
}

/**
 * 예상 한도(`api.py` _limit_as_json). 조건 불충족이면 통째로 null.
 * amount_krw가 null이면 못 낸 것이고 reason에 사유 코드(limits.py)가 있다.
 * 비율을 어느 값에 걸었는지(ratio_field)는 응답에 없다.
 */
export interface LoanLimit {
  amount_krw: number | null;
  tier: string | null;
  ratio_amount_krw: number | null;
  cap_amount_krw: number | null;
  citation: string | null;
  rule_id: string | null;
  reason: string | null;
}

export interface ProgramResult {
  program_id: string;
  program_name: string;
  status: Status;
  passed_rules: string[];
  failed_rules: string[];
  missing_fields: string[];
  imprecise_fields: string[];
  /** 판정에 따라 뜻이 다른 문장 목록(assessment.py _next_actions) — 불충족 사유, 알려 줘야 할 것, 참고 */
  next_actions: string[];
  loan_limit: LoanLimit | null;
  rule_outcomes: RuleOutcome[];
  /** 이 상품에서 아직 다루지 않는 조건(규칙 파일의 unresolved 문장들) */
  unresolved: string[];
  rule_version: number | string | null;
  source_url: string;
  source_checked_at: string;
}

export interface Assessment {
  session_id: string;
  results: ProgramResult[];
}

export interface TraceEvent {
  seq: number;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface Trace {
  session_id: string;
  events: TraceEvent[];
}
