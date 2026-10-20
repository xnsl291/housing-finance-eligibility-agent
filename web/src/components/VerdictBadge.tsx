/*
 * 판정 배지. 서버 상태 코드 4개와 이름 4개가 1:1이다(설계서 G2, 8.1).
 *
 * 이름은 글자 그대로 쓴다. 확정 표현(승인·가능합니다·대출 가능)은 넣지 않는다(G1) —
 * 실제 심사는 기관이 하므로 "가능하다"고 했다가 거절되면 사용자가 시간과 돈을 잃는다.
 * 색이 안 보여도 글자가 남으므로 색만으로 구분하지 않는다(G10). 이모지도 쓰지 않는다(11.1).
 */
import type { Status } from "../api/types";

import styles from "./VerdictBadge.module.css";

export const VERDICT_LABEL: Record<Status, string> = {
  PRECHECK_MATCH: "사전 조건 부합",
  CONDITIONAL: "추가 확인 필요",
  NOT_MATCHED: "조건 불충족",
  INSUFFICIENT_INFORMATION: "정보 부족",
};

const TONE: Record<Status, string> = {
  PRECHECK_MATCH: styles.ok,
  CONDITIONAL: styles.warn,
  NOT_MATCHED: styles.no,
  INSUFFICIENT_INFORMATION: styles.info,
};

export function VerdictBadge({ status }: { status: Status }) {
  return <span className={`${styles.badge} ${TONE[status]}`}>{VERDICT_LABEL[status]}</span>;
}
