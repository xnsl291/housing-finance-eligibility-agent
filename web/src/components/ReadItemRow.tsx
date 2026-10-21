/*
 * 읽은 항목 줄. 시안 B0 묶음 17, 확인 화면(S2).
 *
 * 평소에는 값만 보이고 '고치기'를 누르면 그 자리에서 칸이 열린다. 항목 22개가 칸으로
 * 세로로 늘어서면 '확인하고 넘어가는 화면'이 '작성하는 화면'처럼 보이기 때문이다.
 * 근거 한 줄은 접지 않고 항상 보인다.
 *
 * 초점: 열면 칸으로, 닫으면 '고치기'로 돌려보낸다. 안 그러면 키보드 사용자는 열린 칸을
 * 찾아 탭을 여러 번 눌러야 하고, 닫은 뒤에는 초점이 사라진 버튼과 함께 없어진다.
 *
 * 닫아도 칸은 지우지 않고 숨기기만 한다. 칸이 사라지면 칸 안에 적던 글(금액 칸의 `3억 2`처럼 아직
 * 숫자로 못 바꾼 글)이 함께 사라져, 다시 열었을 때 사용자가 적은 것과 다른 글이 보인다.
 *
 * 고칠 것(problem)이 있으면 열어 두고 '닫기'를 감춘다. 닫으면 칸 아래 오류가 같이 가려져, 버튼은
 * 잠겼는데 어느 칸이 문제인지 안 보이게 된다. 서버가 값을 거절해(422) 닫힌 줄에 문제가 생기면
 * 스스로 열린다. 이때는 초점을 옮기지 않는다 — 여러 줄이 한꺼번에 열리면 초점이 마지막 줄로 튄다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "./Icon";
import styles from "./ReadItemRow.module.css";

interface ReadItemRowProps {
  label: string;
  /**
   * 보여 줄 값(억·만 표기, 한국어 이름표 등). null이면 '모름'으로 보인다. 근거 줄("모름으로 봅니다")과
   * 드롭다운 첫 칸("— 모름 —")이 같은 상태를 '모름'이라 부르므로 여기도 같은 말을 쓴다
   */
  value: string | null;
  /**
   * value가 null일 때 '모름' 대신 보일 글. 문장에서 읽었지만 쓸 수 없었던 항목(S2 못 쓴 원문)은 사용자가
   * 모른다고 한 것이 아니라 비어 있을 뿐이라 '(비어 있음)'을 준다(시안 S2)
   */
  emptyLabel?: string;
  unit?: string;
  /** 근거 한 줄(<Provenance>) */
  provenance: ReactNode;
  /** '고치기'를 누르면 열릴 칸 */
  editor: ReactNode;
  /** 칸에 고칠 것(입력 오류·서버 거절)이 있는가. 있으면 열어 두고 닫지 못하게 한다 */
  problem?: boolean;
}

export function ReadItemRow({ label, value, emptyLabel = "모름", unit, provenance, editor, problem = false }: ReadItemRowProps) {
  const [open, setOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  // 사용자가 '고치기'를 눌러 연 경우만 초점을 칸으로 옮긴다(머리말)
  const focusOnOpen = useRef(false);

  useEffect(() => {
    if (problem) setOpen(true);
  }, [problem]);

  useEffect(() => {
    if (open && focusOnOpen.current) editorRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    else if (!open && wasOpen.current) editRef.current?.focus();
    focusOnOpen.current = false;
    wasOpen.current = open;
  }, [open]);

  return (
    <div className={`${styles.row} ${open ? styles.open : ""}`}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {open ? (
          <span className={styles.chip}>고치는 중</span>
        ) : (
          <>
            <span className={`${styles.value} ${value === null ? styles.empty : ""} num`}>{value ?? emptyLabel}</span>
            {unit && value !== null && <span className={styles.unit}>{unit}</span>}
          </>
        )}
        {open ? (
          !problem && (
            <button type="button" className={styles.action} onClick={() => setOpen(false)}>
              닫기
            </button>
          )
        ) : (
          <button
            ref={editRef}
            type="button"
            className={styles.action}
            aria-label={`${label} 고치기`}
            onClick={() => {
              focusOnOpen.current = true;
              setOpen(true);
            }}
          >
            <Icon name="pencil" size={13} />
            고치기
          </button>
        )}
      </div>
      <div ref={editorRef} hidden={!open}>
        {editor}
      </div>
      {provenance}
    </div>
  );
}
