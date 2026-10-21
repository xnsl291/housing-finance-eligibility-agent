/*
 * S3·S4 자리표시. 주소와 단계 표시만 맞춰 둔다. 화면별 PR에서 이 파일 대신 실제 화면으로 바꾼다.
 */
import styles from "./Screen.module.css";

const TITLE = { 2: "하나씩 확인", 3: "판정 결과" } as const;

export function Pending({ step }: { step: 2 | 3 }) {
  return (
    <section className={styles.heading}>
      <span className={styles.eyebrow}>{TITLE[step]}</span>
      <h1 className={styles.title}>{TITLE[step]}</h1>
      <p className={styles.lead}>이 화면은 다음 단계에서 만듭니다.</p>
    </section>
  );
}
