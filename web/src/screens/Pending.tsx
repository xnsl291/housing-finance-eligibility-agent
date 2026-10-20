/*
 * S2~S4 자리표시. 이번 PR은 S0·S1과 공통 틀까지라, 주소와 단계 표시만 맞춰 둔다.
 * 화면별 PR에서 이 파일 대신 실제 화면으로 바꾼다.
 *
 * S2 자리표시에만 '← 문장 다시 쓰기'를 둔다. 설계서 S2 동작 표에 있는 길이고, 돌아간 S1에 적은 문장이
 * 남아 있어야 한다는 약속(앱 메모리)을 지금부터 확인할 수 있게 하려고.
 */
import { useNavigate } from "react-router-dom";

import { Button } from "../components/Button";
import styles from "./Screen.module.css";

const TITLE = { 1: "읽은 내용 확인", 2: "하나씩 확인", 3: "판정 결과" } as const;

export function Pending({ step }: { step: 1 | 2 | 3 }) {
  const navigate = useNavigate();
  return (
    <section className={styles.heading}>
      <span className={styles.eyebrow}>{TITLE[step]}</span>
      <h1 className={styles.title}>{TITLE[step]}</h1>
      <p className={styles.lead}>이 화면은 다음 단계에서 만듭니다.</p>
      {step === 1 && (
        <div>
          <Button variant="text" icon="arrowLeft" onClick={() => navigate("/write")}>
            문장 다시 쓰기
          </Button>
        </div>
      )}
    </section>
  );
}
