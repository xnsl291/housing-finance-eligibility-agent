/*
 * 근거 한 줄 — 값이 어디서 왔는지. 시안 B0 묶음 5.
 *
 * 확인 화면(S2) 칸 아래와 확인 과정(S6)에 붙는다. 한 번 지나가면 무엇을 자기가 고쳤는지
 * 기억하지 못하므로 다섯 경우를 서로 다른 글과 아이콘으로 남긴다.
 * '비움'을 '고친 값'과 따로 둔 이유: 비운 것과 바꾼 것은 뜻이 다르다(결함 D13).
 */
import { Icon, type IconName } from "./Icon";
import styles from "./Provenance.module.css";

export type ProvenanceProps =
  /** 문장에서 읽은 값 그대로 */
  | { kind: "read"; phrase: string }
  /** 범위로 읽음. range는 formatRange로 만든 글 */
  | { kind: "range"; phrase: string; range: string }
  /** 읽은 값을 사용자가 고침. readValue는 고치기 전 값(억·만 표기 등 보여 줄 글) */
  | { kind: "edited"; phrase: string; readValue: string }
  /** 문장에 없던 값을 사용자가 넣음 */
  | { kind: "direct" }
  /** 읽은 값을 비움 → 모름 */
  | { kind: "cleared" };

const ICON: Record<ProvenanceProps["kind"], IconName> = {
  read: "quote",
  range: "quote",
  edited: "pencil",
  direct: "plus",
  cleared: "eraser",
};

export function Provenance(props: ProvenanceProps) {
  // 사용자가 손댄 값(고침·직접·비움)은 한 단계 진하게 — 읽은 값과 눈으로도 구분되게
  const touched = props.kind !== "read" && props.kind !== "range";
  return (
    <p className={`${styles.line} ${touched ? styles.touched : ""}`}>
      <Icon name={ICON[props.kind]} size={14} />
      <span>{text(props)}</span>
    </p>
  );
}

function text(p: ProvenanceProps): string {
  switch (p.kind) {
    case "read":
      return `“${p.phrase}”에서 읽음`;
    case "range":
      return `“${p.phrase}”에서 읽음 · ${p.range}으로 읽었습니다. 다르면 고쳐주세요`;
    case "edited":
      return `고친 값 (읽은 값: ${p.readValue}) ← “${p.phrase}”에서 읽음`;
    case "direct":
      return "직접 넣은 값";
    case "cleared":
      return "읽은 값을 비웠습니다 — 모름으로 봅니다";
  }
}
