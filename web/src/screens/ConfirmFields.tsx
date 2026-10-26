/*
 * S2 읽은 내용 확인의 칸 조각 — 근거 줄 고르기, 종류별 칸, 접힌 '비어 있는 항목', 버튼 위 오류 목록.
 * 상태(무엇을 고쳤고 무엇이 틀렸나)와 보내기는 ConfirmForm.tsx가 들고, 여기는 받은 것을 그린다.
 * ConfirmForm.tsx가 400줄을 넘어 책임 단위로 나눴다. 동작은 나누기 전과 같다.
 *
 * 칸 종류(설계서 7.2 S2 열): 선택=드롭다운 첫 칸 `— 모름 —`, 예·아니오=라디오 `예/아니오/모름`(G4),
 * 금액=만원 칸 + 억·만, 범위로 읽혔으면 최소·최대 두 칸, 날짜=달력, 정수·소수·글=칸.
 */
import { useEffect, useState, type ReactNode } from "react";

import type { FieldCatalog, FieldInfo, HeldValue } from "../api/types";
import { AmountField, RangeField } from "../components/AmountFields";
import { YesNoField, type YesNo } from "../components/ChoiceFields";
import { DateField, NumberField, SelectField, TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Provenance } from "../components/Provenance";
import { isRange, sameValue, showValue, type Value } from "./confirmValues";
import styles from "./Confirm.module.css";

/** 서버가 거절한 사유. byField는 칸 아래로, rest는 어느 칸인지 못 정해 버튼 위 목록에만 */
export interface Rejection {
  byField: Record<string, string>;
  rest: string[];
}

/**
 * 근거 한 줄(설계서 S2 '근거 한 줄' 표 다섯 경우 + 결함 D13의 '비움').
 * 고치는 중 칸에 입력 오류가 있으면 지금 값은 null이지만 비운 것이 아니다 — 고친 값으로 본다.
 */
export function provenanceOf(info: FieldInfo, held: HeldValue | undefined, value: Value, problem: boolean): ReactNode {
  if (!held) return value === null && !problem ? null : <Provenance kind="direct" />;
  const changed = problem || !sameValue(value, held.value);
  const cleared = changed && value === null && !problem;
  if (held.source === "USER") return cleared ? <Provenance kind="cleared" was="direct" /> : <Provenance kind="direct" />;
  if (!changed) {
    return isRange(held.value) ? (
      <Provenance kind="range" phrase={held.phrase} range={showValue(info, held.value) ?? ""} />
    ) : (
      <Provenance kind="read" phrase={held.phrase} />
    );
  }
  if (cleared) return <Provenance kind="cleared" was="read" />;
  return <Provenance kind="edited" phrase={held.phrase} readValue={showValue(info, held.value) ?? ""} />;
}

interface FieldInputProps {
  info: FieldInfo;
  /** 서버에 있던 값. 숫자·금액 칸은 처음 그릴 때만 쓴다(칸이 글을 따로 든다) */
  initial: Value;
  value: Value;
  error: string | null;
  onChange: (value: Value, problem?: string | null) => void;
}

/**
 * 종류별 칸 하나(설계서 7.2 S2 열). 숫자 칸은 빈 채로 시작한다 — 처음 값이 없으면 빈칸(G5)
 *
 * 서버 설명(how_to_check)을 어디에 두나
 * - 숫자를 적는 칸(금액·정수·소수)은 칸 아래에 늘 보인다(help). 이 칸들의 설명은 '10%를 냈으면 0.1로', '평이 아니라
 *   제곱미터로' 같은 단위 안내다. 서버는 숫자인지만 보므로 안내를 '?' 안에 숨기면 10을 적어 1000%로 판정된다(설계서 7.1)
 * - 선택·예아니오·날짜·글 칸은 이름 옆 '?'로 연다(S10, term)
 */
export function FieldInput({ info, initial, value, error, onChange }: FieldInputProps) {
  const common = { label: info.label, term: info.how_to_check, error };
  const numeric = { label: info.label, help: info.how_to_check, error };
  switch (info.kind) {
    case "AMOUNT":
      // 범위로 읽힌 값은 범위로 둔다(G6). 한 숫자로 접으면 5천만원 기준을 근거 없이 통과한다
      return isRange(initial) ? (
        <RangeField label={info.label} defaultValue={initial} error={error} onChange={onChange} />
      ) : (
        <AmountField {...numeric} defaultWon={typeof initial === "number" ? initial : null} onChange={onChange} />
      );
    case "CHOICE":
      return (
        <SelectField
          {...common}
          value={value === null ? null : String(value)}
          options={(info.choices ?? []).map((c) => ({ value: c, label: info.choice_labels?.[c] ?? c }))}
          onChange={onChange}
        />
      );
    case "BOOL":
      return <BoolInput {...common} initial={typeof initial === "boolean" ? initial : null} onChange={onChange} />;
    case "DATE":
      return <DateField {...common} value={typeof value === "string" ? value : null} onChange={onChange} />;
    case "INT":
    case "FLOAT":
      return (
        <NumberField
          {...numeric}
          integer={info.kind === "INT"}
          defaultValue={typeof initial === "number" ? initial : null}
          onChange={onChange}
        />
      );
    default:
      return <TextInput {...common} initial={initial === null ? null : String(initial)} onChange={onChange} />;
  }
}

/**
 * 글 칸. 칸에는 친 그대로 두고, 값은 앞뒤 공백을 떼어 알린다 — 읽은 값 뒤에 공백만 붙인 것을 '고친 값'으로
 * 보내지 않게. 칸의 글까지 떼면(제어 값을 다듬으면) 낱말 사이 공백을 칠 수 없어 칸이 글을 따로 든다.
 * 빈칸만 친 것은 빈칸이다. 서버는 빈 글을 거절한다
 */
function TextInput({
  initial,
  onChange,
  ...common
}: {
  label: string;
  term?: string;
  error: string | null;
  initial: string | null;
  onChange: (value: Value) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <TextField
      {...common}
      value={text}
      onChange={(v) => {
        setText(v);
        const trimmed = v?.trim() ?? "";
        onChange(trimmed === "" ? null : trimmed);
      }}
    />
  );
}

/**
 * 예·아니오·모름. 모름과 아직 안 고름은 보낼 때 둘 다 null(모름)이지만, 칸에는 사용자가 고른 대로 보인다.
 * 아무것도 미리 골라 두지 않는다(시안 S2-a) — 처음 값이 없으면 셋 다 빈 채로 시작한다
 */
function BoolInput({
  label,
  term,
  error,
  initial,
  onChange,
}: {
  label: string;
  term?: string;
  error: string | null;
  initial: boolean | null;
  onChange: (value: Value) => void;
}) {
  const [picked, setPicked] = useState<YesNo>(initial);
  return (
    <YesNoField
      label={label}
      term={term}
      error={error}
      withUnknown
      value={picked}
      onChange={(v) => {
        setPicked(v);
        onChange(v === "unknown" || v === null ? null : v);
      }}
    />
  );
}

/** 접힌 '비어 있는 항목 N개'. 접어도 칸은 지우지 않고 숨긴다 — 적던 글이 사라지지 않게(ReadItemRow와 같은 이유) */
export function EmptyFields({ count, forceOpen, fields }: { count: number; forceOpen: boolean; fields: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  // 이 안의 칸에 고칠 것(입력 오류·서버 거절)이 있는 동안은 접지 못한다. 접힌 채면 버튼은 잠겼는데 어느 칸이
  // 문제인지 안 보인다(ReadItemRow가 '닫기'를 감추는 것과 같은 이유). open만 보고 그리면, 한 번 펼쳐진 뒤
  // 사용자가 접은 상태에서 다음 오류가 와도 forceOpen이 이미 true라 다시 펼쳐지지 않았다
  const shown = open || forceOpen;
  // 문제가 풀린 뒤 갑자기 접히지 않게, 펼쳐진 상태를 그대로 남긴다
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  if (count === 0) return null;
  return (
    <section className={styles.empty}>
      <h2 className={styles.emptyTitle}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={shown}
          aria-disabled={forceOpen || undefined}
          onClick={() => {
            if (!forceOpen) setOpen(!shown);
          }}
        >
          <Icon name={shown ? "chevronDown" : "chevronRight"} size={16} />
          비어 있는 항목 {count}개 — 아는 값이 있으면 미리 채워도 됩니다
        </button>
      </h2>
      <div hidden={!shown}>
        <p className={styles.emptyLead}>
          비워 두면 판정에 필요한 것만 다음 단계에서 여쭙니다. 화면이 대신 채우지 않습니다.
        </p>
        <div className={styles.grid}>{fields}</div>
      </div>
    </section>
  );
}

/** 버튼 위 오류 목록(설계서 S2 구성 6). 영역은 늘 두고 글만 바꿔야 화면 읽기 프로그램이 읽는다 */
export function ErrorList({
  problems,
  rejection,
  catalog,
}: {
  problems: string[];
  rejection: Rejection | null;
  catalog: FieldCatalog;
}) {
  const rejected = rejection
    ? [...Object.entries(rejection.byField).map(([n, m]) => `${catalog[n].label}: ${m}`), ...rejection.rest]
    : [];
  return (
    // polite: 칸 아래 오류 줄(FieldError)이 이미 바로(assertive) 읽는다. 목록까지 끊고 들어가면 같은 말을 두 번 읽는다
    <div className={styles.errors} aria-live="polite">
      {problems.length > 0 && <Errors title="고쳐야 보낼 수 있습니다" items={problems} />}
      {rejected.length > 0 && <Errors title="서버가 받지 않은 값이 있습니다" items={rejected} />}
    </div>
  );
}

function Errors({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.errorGroup}>
      <strong className={styles.errorTitle}>{title}</strong>
      <ul className={styles.errorItems}>
        {items.map((item) => (
          <li key={item}>
            <Icon name="alertCircle" size={14} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
