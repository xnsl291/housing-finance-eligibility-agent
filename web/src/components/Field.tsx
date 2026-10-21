/*
 * 칸 부품. 시안 B0 묶음 3 — 글·숫자·선택·날짜·오류가 붙은 칸.
 * 예·아니오와 질문 카드 선택지는 ChoiceFields.tsx, 금액·범위는 AmountFields.tsx.
 *
 * 공통 약속
 * - 빈칸은 null이다. 화면이 0이나 기본값을 채우지 않는다(G5)
 * - 오류는 칸 바로 아래 한 줄이고 칸과 연결한다(aria-describedby). 어느 칸의 오류인지
 *   화면 읽기 프로그램이 같이 읽는다(설계서 11.3)
 * - 글을 숫자로 바꾸는 칸(숫자·금액·범위)은 onChange(값, 오류)로 알린다. 못 알아본 글을
 *   빈칸으로 바꿔 넘기면 사용자가 적은 값이 조용히 사라지므로, 부모가 보내기를 막을 수 있게
 *   오류를 같이 넘긴다. 칸 스스로는 칸을 떠난 뒤에만 오류를 보인다(치는 중에 빨갛게 하지 않음).
 *   마우스로 다른 곳을 눌러 떠났으면 손을 뗀 뒤에 보인다 — 오류 줄이 생기며 누른 버튼이 밀리지 않게(afterPress.ts)
 */
import { useId, useState, type ReactNode } from "react";

import { afterPress } from "./afterPress";
import { Icon } from "./Icon";
import styles from "./Field.module.css";

interface A11y {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

interface FrameProps {
  label: string;
  help?: string;
  error?: string | null;
  /** 라디오 묶음처럼 칸이 여럿이면 fieldset·legend로 묶는다 */
  group?: boolean;
  children: (a11y: A11y) => ReactNode;
  /** 칸과 도움말 사이에 끼울 것(금액의 억·만 표기) */
  below?: ReactNode;
}

export function FieldFrame({ label, help, error, group, children, below }: FrameProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  const a11y = { id, describedBy, invalid: Boolean(error) };

  const body = (
    <>
      {children(a11y)}
      <FieldError id={errorId} message={error} />
      {below}
      {help && (
        <span id={helpId} className={styles.help}>
          {help}
        </span>
      )}
    </>
  );

  if (group) {
    return (
      <fieldset className={styles.field} aria-describedby={describedBy}>
        <legend className={styles.label}>{label}</legend>
        {body}
      </fieldset>
    );
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {body}
    </div>
  );
}

/**
 * 입력 오류 한 줄(시안 '오류 입력'). 칸 밖에서도 쓴다(예: 문장 칸 1,000자 초과).
 * 영역은 늘 두고 글만 바꾼다 — 그래야 aria-live가 바뀐 순간을 읽는다. 바로(assertive) 읽는 것은
 * 사용자가 방금 한 입력의 문제라서다(시안 C0 2절).
 */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  return (
    <span id={id} className={styles.error} aria-live="assertive">
      {message && (
        <>
          <Icon name="alertCircle" size={14} />
          {message}
        </>
      )}
    </span>
  );
}

interface TextFieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  help?: string;
  error?: string | null;
}

export function TextField({ label, value, onChange, help, error }: TextFieldProps) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      {(a) => (
        <div className={styles.box} data-invalid={a.invalid}>
          <input
            id={a.id}
            className={styles.input}
            aria-describedby={a.describedBy}
            aria-invalid={a.invalid || undefined}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          />
        </div>
      )}
    </FieldFrame>
  );
}

interface NumberFieldProps {
  label: string;
  defaultValue?: number | null;
  /** 정수만(INT) 또는 소수 허용(FLOAT) */
  integer: boolean;
  onChange: (value: number | null, problem: string | null) => void;
  unit?: string;
  help?: string;
  error?: string | null;
}

/**
 * 정수·소수 칸. type="number"를 쓰지 않는 이유: 브라우저가 못 알아본 글을 조용히 ""로
 * 바꿔 넘겨서, 사용자가 적은 값과 빈칸이 구분되지 않는다.
 */
export function NumberField({ label, defaultValue, integer, onChange, unit, help, error }: NumberFieldProps) {
  const [text, setText] = useState(defaultValue == null ? "" : String(defaultValue));
  const [left, setLeft] = useState(false);
  const problem = numberProblem(text, integer);

  return (
    <FieldFrame label={label} help={help} error={error ?? (left ? problem : null)}>
      {(a) => (
        <div className={styles.box} data-invalid={a.invalid}>
          <input
            id={a.id}
            className={`${styles.input} num`}
            inputMode={integer ? "numeric" : "decimal"}
            aria-describedby={a.describedBy}
            aria-invalid={a.invalid || undefined}
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              const p = numberProblem(next, integer);
              onChange(p || next.trim() === "" ? null : Number(next.replace(/,/g, "")), p);
            }}
            // 마우스를 누르는 중이면 뗀 뒤에 오류를 그린다(afterPress.ts)
            onBlur={() => afterPress(() => setLeft(true))}
          />
          {unit && <span className={styles.unit}>{unit}</span>}
        </div>
      )}
    </FieldFrame>
  );
}

function numberProblem(text: string, integer: boolean): string | null {
  const s = text.trim().replace(/,/g, "");
  if (s === "") return null;
  const ok = integer ? /^\d+$/.test(s) : /^\d+(\.\d+)?$/.test(s);
  return ok ? null : integer ? "숫자로 적어 주세요" : "숫자로 적어 주세요(소수점은 .)";
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  /** 서버가 준 한국어 이름표(choice_labels)를 붙여 넘긴다. 코드 이름은 보이지 않는다 */
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  help?: string;
  error?: string | null;
}

/** 드롭다운(확인 화면 S2). 첫 칸이 `— 모름 —`이고, 고르지 않은 것과 모름이 같은 뜻이다(설계서 7.2) */
export function SelectField({ label, value, options, onChange, help, error }: SelectFieldProps) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      {(a) => (
        <div className={styles.box} data-invalid={a.invalid}>
          <select
            id={a.id}
            className={`${styles.input} ${styles.select}`}
            aria-describedby={a.describedBy}
            aria-invalid={a.invalid || undefined}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">— 모름 —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" />
        </div>
      )}
    </FieldFrame>
  );
}

interface DateFieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  help?: string;
  error?: string | null;
}

/** 날짜는 달력으로만 받는다(D-34). 자유 입력이면 형식을 못 맞혀 질문이 그 항목에서 멈춘다 */
export function DateField({ label, value, onChange, help, error }: DateFieldProps) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      {(a) => (
        <div className={styles.box} data-invalid={a.invalid}>
          <input
            id={a.id}
            type="date"
            className={`${styles.input} num`}
            aria-describedby={a.describedBy}
            aria-invalid={a.invalid || undefined}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          />
        </div>
      )}
    </FieldFrame>
  );
}
