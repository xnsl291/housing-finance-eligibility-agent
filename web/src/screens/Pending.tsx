/*
 * S4 자리표시. 주소와 단계 표시만 맞춰 둔다. S4 화면 PR에서 이 파일 대신 실제 화면으로 바꾼다.
 */
import styles from "./Screen.module.css";

export function Pending() {
  return (
    <section className={styles.heading}>
      <span className={styles.eyebrow}>판정 결과</span>
      <h1 className={styles.title}>판정 결과</h1>
      <p className={styles.lead}>이 화면은 다음 단계에서 만듭니다.</p>
    </section>
  );
}
