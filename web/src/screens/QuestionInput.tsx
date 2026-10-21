/*
 * S3 질문 카드 안의 답 칸. 설계서 7.2 'S3' 열 — 칸 종류마다 서버로 보낼 값의 모양이 다르다.
 *
 * | 종류 | 칸 | 서버로 보내는 값 |
 * | 선택 CHOICE | 라디오, 아무것도 안 골라진 채 시작 | 선택지 코드(예: "HEAD") |
 * | 예·아니오 BOOL | 라디오 예/아니오. 모름 칸 없음 — 카드의 '모르겠어요'가 대신 | true/false |
 * | 금액 AMOUNT | 만원 단위 칸 + 억·만 표기(기술결정기록 D-38). 범위로는 못 답함 | 원 단위 정수 |
 * | 날짜 DATE | 달력(D-34) | "YYYY-MM-DD" |
 * | 정수 INT·소수 FLOAT | 숫자 칸 | 수 |
 * | 글 TEXT | 한 줄 칸 | 앞뒤 공백을 뗀 글 |
 *
 * 범위로 못 답하게 한 이유: 기준에 걸친 값을 다시 묻는 경우(IMPRECISE)는 정확한 값이 있어야 판정이 갈린다.
 * 범위를 또 받으면 같은 질문이 다시 돌아온다(시안 S3-f).
 *
 * 칸 이름은 질문 제목과 같게 두고 눈에는 숨긴다(카드 제목이 이미 크게 보임). 화면 읽기 프로그램은 칸에 들어가며
 * 무엇을 묻는지 다시 듣는다. 눈에 보이는 안내('만원 단위로 적어 주세요' 등)는 칸 아래 도움말로 둔다.
 *
 * 금액·숫자 칸은 글을 칸 안에 들고 있다(부품이 그렇게 만들어짐). 같은 항목을 다시 물을 때 앞 답이 남지 않게
 * 부르는 쪽이 질문마다 key를 바꿔 새 칸으로 그린다.
 */
import type { FieldValue, Question } from "../api/types";
import { AmountField } from "../components/AmountFields";
import { ChoiceList, YesNoField } from "../components/ChoiceFields";
import { DateField, NumberField, TextField } from "../components/Field";
import styles from "./Questions.module.css";

export interface Answer {
  /** 보낼 값. 아직 안 고르거나 비웠으면 null */
  value: FieldValue | null;
  /** 칸이 알린 입력 오류(금액을 못 읽음 등). 있으면 답하기가 잠긴다 */
  problem: string | null;
}

export const NO_ANSWER: Answer = { value: null, problem: null };

interface QuestionInputProps {
  question: Question;
  /** 선택지 묶음 이름으로 쓸 카드 제목 id */
  titleId: string;
  /** 칸의 설명에 더할 줄의 id(카드 맨 아래 서버 거절 사유). 없으면 undefined */
  describedBy: string | undefined;
  answer: Answer;
  onChange: (answer: Answer) => void;
}

export function QuestionInput({ question, titleId, describedBy, answer, onChange }: QuestionInputProps) {
  const { kind, label } = question;
  const set = (value: FieldValue | null, problem: string | null = null) => onChange({ value, problem });

  if (kind === "CHOICE") {
    const choices = question.choices ?? [];
    const labels = question.choice_labels ?? {};
    return (
      <ChoiceList
        labelledBy={titleId}
        describedBy={describedBy}
        value={typeof answer.value === "string" ? answer.value : null}
        options={choices.map((code) => ({ value: code, label: labels[code] ?? code }))}
        onChange={(code) => set(code)}
      />
    );
  }

  return (
    <div className={styles.input}>
      {kind === "BOOL" ? (
        <YesNoField
          label={label}
          value={typeof answer.value === "boolean" ? answer.value : null}
          withUnknown={false}
          describedBy={describedBy}
          onChange={(v) => set(typeof v === "boolean" ? v : null)}
        />
      ) : kind === "AMOUNT" ? (
        <AmountField
          label={label}
          help="만원 단위로 적어 주세요. 예: 4800, 3억 2천"
          describedBy={describedBy}
          onChange={(won, p) => set(won, p)}
        />
      ) : kind === "DATE" ? (
        <DateField
          label={label}
          help="날짜를 골라 주세요"
          describedBy={describedBy}
          value={typeof answer.value === "string" ? answer.value : null}
          onChange={(v) => set(v)}
        />
      ) : kind === "INT" || kind === "FLOAT" ? (
        <NumberField
          label={label}
          help="숫자로 적어 주세요"
          integer={kind === "INT"}
          describedBy={describedBy}
          onChange={(n, p) => set(n, p)}
        />
      ) : (
        // 글(TEXT). 서버가 모르는 종류를 보내도 글 칸으로 받는다 — 서버가 422로 사유를 알려 준다
        <TextField
          label={label}
          help="적어 주세요"
          describedBy={describedBy}
          value={typeof answer.value === "string" ? answer.value : null}
          // 치는 중에는 공백을 그대로 둔다. 앞뒤 공백은 보낼 때 뗀다(valueToSend)
          onChange={(v) => set(v)}
        />
      )}
    </div>
  );
}

/** 보낼 값. 글은 앞뒤 공백을 떼고, 떼서 비면 보낼 것이 없다(null) */
export function valueToSend(answer: Answer): FieldValue | null {
  if (answer.problem) return null;
  if (typeof answer.value === "string") return answer.value.trim() === "" ? null : answer.value.trim();
  return answer.value;
}
