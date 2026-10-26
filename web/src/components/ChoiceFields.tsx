/*
 * 고르는 칸. 시안 B0 묶음 3의 '예 · 아니오 · 모름'과 묶음 6 질문 카드의 선택지.
 *
 * 예·아니오는 체크박스로 만들지 않는다(G4). 체크박스는 "체크 안 함"이 곧 "아니오"라서,
 * 모른다는 뜻이 아니오로 판정에 들어간다. 그래서 값이 넷이다.
 *   true 예 / false 아니오 / "unknown" 모름을 골랐음 / null 아직 아무것도 안 고름
 * "unknown"과 null을 나눈 이유: 확인 화면(S2)에서 모름은 사용자가 고른 답이고,
 * 질문 화면(S3)에서는 아무것도 안 고른 채라 '답하기'를 잠가야 한다.
 */
import { useId } from "react";

import { FieldFrame } from "./Field";
import styles from "./Field.module.css";

export type YesNo = boolean | "unknown" | null;

interface YesNoFieldProps {
  label: string;
  value: YesNo;
  onChange: (value: YesNo) => void;
  /** 확인 화면(S2)은 칸 안에 모름을 둔다. 질문 화면(S3)은 카드의 '모르겠어요'가 따로 있어 뺀다(설계서 7.2) */
  withUnknown: boolean;
  help?: string;
  /** 서버가 준 용어 설명(how_to_check). 있으면 이름 옆 '?'(S10, Field.tsx) */
  term?: string;
  error?: string | null;
  /** 칸 밖에 있는 설명 줄의 id(Field.tsx 공통 약속) */
  describedBy?: string;
}

const YES_NO: { value: Exclude<YesNo, null>; label: string }[] = [
  { value: true, label: "예" },
  { value: false, label: "아니오" },
  { value: "unknown", label: "모름" },
];

export function YesNoField({ label, value, onChange, withUnknown, help, term, error, describedBy }: YesNoFieldProps) {
  const name = useId();
  const options = withUnknown ? YES_NO : YES_NO.slice(0, 2);
  return (
    <FieldFrame label={label} help={help} term={term} error={error} describedBy={describedBy} group>
      {() => (
        <div className={styles.radios}>
          {options.map((o) => (
            <label key={o.label} className={styles.radio}>
              <input
                type="radio"
                className={styles.radioInput}
                name={name}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </FieldFrame>
  );
}

interface ChoiceListProps {
  /** 묶음 이름이 될 질문 제목의 id */
  labelledBy: string;
  /** 묶음 설명이 될 줄의 id(질문 카드의 서버 거절 사유) */
  describedBy?: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * 질문 카드의 선택지(시안 '선택지 세대주임'). 아무것도 안 고른 채 시작한다(설계서 7.2).
 * 진짜 라디오라 탭으로 묶음에 들어가 방향키로 고른다(시안 C0 3절).
 */
export function ChoiceList({ labelledBy, describedBy, value, options, onChange }: ChoiceListProps) {
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className={styles.choices}>
      {options.map((o) => (
        <label key={o.value} className={styles.choice}>
          <input
            type="radio"
            className={styles.radioInput}
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
