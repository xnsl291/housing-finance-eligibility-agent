/*
 * 금액 칸과 범위 칸. 시안 B0 묶음 4.
 *
 * 사용자는 만원·억 단위로 적고(`3억 2천`) 칸 아래에 억·만 표기를 늘 같이 보여 준다(G11).
 * 서버에는 원 단위 정수, 범위는 {low, high}로 넘긴다. 바꾸는 규칙은 amount.ts.
 * 빈칸은 null이다. 0을 채우지 않는다 — 소득 0과 소득 모름은 판정이 다르다(G5).
 */
import { useId, useState } from "react";

import type { AmountRange } from "../api/types";
import { formatRange, formatWon, parseAmount, wonToInput } from "./amount";
import { FieldError, FieldFrame } from "./Field";
import styles from "./Field.module.css";

interface AmountFieldProps {
  label: string;
  /** 서버에 있던 값(원). 없으면 빈칸으로 시작 */
  defaultWon?: number | null;
  onChange: (won: number | null, problem: string | null) => void;
  help?: string;
  error?: string | null;
}

export function AmountField({ label, defaultWon, onChange, help, error }: AmountFieldProps) {
  const [text, setText] = useState(wonToInput(defaultWon));
  const [left, setLeft] = useState(false);
  const parsed = parseAmount(text);
  const problem = "error" in parsed ? parsed.error : null;

  return (
    <FieldFrame
      label={label}
      help={help}
      error={error ?? (left ? problem : null)}
      below={<KoreanAmount won={"won" in parsed ? parsed.won : undefined} />}
    >
      {(a) => (
        <div className={styles.box} data-invalid={a.invalid}>
          <input
            id={a.id}
            className={`${styles.input} ${styles.amount}`}
            inputMode="text"
            placeholder="예: 3억 2천"
            aria-describedby={a.describedBy}
            aria-invalid={a.invalid || undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const p = parseAmount(e.target.value);
              onChange("won" in p ? p.won : null, "error" in p ? p.error : null);
            }}
            onBlur={() => setLeft(true)}
          />
          <span className={styles.unit}>만원</span>
        </div>
      )}
    </FieldFrame>
  );
}

/** 칸 아래 억·만 표기. 못 알아본 글이면(undefined) 비워 둔다 — 오류 줄이 대신 말한다 */
function KoreanAmount({ won }: { won: number | null | undefined }) {
  if (won === undefined) return null;
  // aria-live: 치는 동안 바뀐 자릿수를 화면 읽기 프로그램도 확인할 수 있게(공손하게)
  return (
    <span aria-live="polite" className={won === null ? styles.koreanEmpty : styles.koreanAmount}>
      {won === null ? "— 아직 비어 있습니다" : formatWon(won)}
    </span>
  );
}

interface RangeFieldProps {
  label: string;
  defaultValue?: AmountRange | null;
  onChange: (range: AmountRange | null, problem: string | null) => void;
  error?: string | null;
}

/**
 * 범위로 읽은 값은 범위로 둔다(G6). `4천 후반대`를 한 숫자로 접으면 5천만원 기준을 근거 없이
 * 통과한다. 두 칸 아래에도 억·만 표기를 붙인다(결함 D12).
 */
export function RangeField({ label, defaultValue, onChange, error }: RangeFieldProps) {
  const id = useId();
  const [lowText, setLowText] = useState(wonToInput(defaultValue?.low));
  const [highText, setHighText] = useState(wonToInput(defaultValue?.high));
  const [left, setLeft] = useState(false);
  const { range, problem } = readRange(lowText, highText);
  const shown = error ?? (left ? problem : null);

  function update(nextLow: string, nextHigh: string) {
    setLowText(nextLow);
    setHighText(nextHigh);
    const r = readRange(nextLow, nextHigh);
    onChange(r.range, r.problem);
  }

  const cell = (which: "low" | "high") => (
    <label className={styles.pairItem}>
      <span className={styles.pairLabel}>{which === "low" ? "최소" : "최대"}</span>
      <span className={styles.box} data-invalid={Boolean(shown)}>
        <input
          className={`${styles.input} ${styles.amount}`}
          aria-label={`${label} ${which === "low" ? "최소" : "최대"}`}
          aria-describedby={`${id}-error ${id}-help`}
          aria-invalid={Boolean(shown) || undefined}
          value={which === "low" ? lowText : highText}
          onChange={(e) => (which === "low" ? update(e.target.value, highText) : update(lowText, e.target.value))}
        />
        <span className={styles.unit}>만원</span>
      </span>
    </label>
  );

  return (
    <fieldset
      className={styles.field}
      onBlur={(e) => {
        // 최소 칸을 채우고 최대 칸으로 가는 중에 "모두 적어 주세요"를 띄우면 아직 적는 사람을
        // 나무라는 꼴이다. 초점이 두 칸 묶음 밖으로 나갔을 때만 떠난 것으로 본다
        // (React onBlur는 focusout처럼 올라오고, relatedTarget이 새로 초점을 받은 곳이다)
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLeft(true);
      }}
    >
      <legend className={styles.label}>{label}</legend>
      <div className={styles.pair}>
        {cell("low")}
        {cell("high")}
      </div>
      <FieldError id={`${id}-error`} message={shown} />
      {range && (
        <span aria-live="polite" className={styles.koreanAmount}>
          {formatRange(range.low, range.high)}
        </span>
      )}
      <span id={`${id}-help`} className={styles.help}>
        정확한 값을 아시면 두 칸에 같은 값을 넣어 주세요
      </span>
    </fieldset>
  );
}

function readRange(lowText: string, highText: string): { range: AmountRange | null; problem: string | null } {
  const low = parseAmount(lowText);
  const high = parseAmount(highText);
  if ("error" in low) return { range: null, problem: `최소: ${low.error}` };
  if ("error" in high) return { range: null, problem: `최대: ${high.error}` };
  if (low.won === null && high.won === null) return { range: null, problem: null };
  // 한 칸만 채우면 범위가 아니다. 빈 칸을 0이나 다른 칸 값으로 채우지 않는다(G5)
  if (low.won === null || high.won === null) return { range: null, problem: "최소와 최대를 모두 적어 주세요" };
  if (low.won > high.won) return { range: null, problem: "최소가 최대보다 큽니다" };
  return { range: { low: low.won, high: high.won }, problem: null };
}
