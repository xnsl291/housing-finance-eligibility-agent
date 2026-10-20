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

export interface RuleOutcome {
  rule_id: string;
  outcome: string;
  field: string | null;
  citation: unknown;
  failure_message: string | null;
}

export interface ProgramResult {
  program_id: string;
  program_name: string;
  status: Status;
  passed_rules: string[];
  failed_rules: string[];
  missing_fields: string[];
  imprecise_fields: string[];
  next_actions: unknown[];
  loan_limit: Record<string, unknown> | null;
  rule_outcomes: RuleOutcome[];
  unresolved: unknown[];
  rule_version: number | null;
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
