/*
 * 읽은 항목 줄. 시안 B0 묶음 17, 확인 화면(S2).
 *
 * 평소에는 값만 보이고 '고치기'를 누르면 그 자리에서 칸이 열린다. 항목 22개가 칸으로
 * 세로로 늘어서면 '확인하고 넘어가는 화면'이 '작성하는 화면'처럼 보이기 때문이다.
 * 근거 한 줄은 접지 않고 항상 보인다.
 *
 * 초점: 열면 칸으로, 닫으면 '고치기'로 돌려보낸다. 안 그러면 키보드 사용자는 열린 칸을
 * 찾아 탭을 여러 번 눌러야 하고, 닫은 뒤에는 초점이 사라진 버튼과 함께 없어진다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "./Icon";
import styles from "./ReadItemRow.module.css";

interface ReadItemRowProps {
  label: string;
  /** 보여 줄 값(억·만 표기, 한국어 이름표 등). null이면 비어 있음 */
  value: string | null;
  unit?: string;
  /** 근거 한 줄(<Provenance>) */
  provenance: ReactNode;
  /** '고치기'를 누르면 열릴 칸 */
  editor: ReactNode;
}

export function ReadItemRow({ label, value, unit, provenance, editor }: ReadItemRowProps) {
  const [open, setOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) editorRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    else if (wasOpen.current) editRef.current?.focus();
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
            <span className={`${styles.value} ${value === null ? styles.empty : ""} num`}>{value ?? "(비어 있음)"}</span>
            {unit && value !== null && <span className={styles.unit}>{unit}</span>}
          </>
        )}
        {open ? (
          <button type="button" className={styles.action} onClick={() => setOpen(false)}>
            닫기
          </button>
        ) : (
          <button
            ref={editRef}
            type="button"
            className={styles.action}
            aria-label={`${label} 고치기`}
            onClick={() => setOpen(true)}
          >
            <Icon name="pencil" size={13} />
            고치기
          </button>
        )}
      </div>
      {open && <div ref={editorRef}>{editor}</div>}
      {provenance}
    </div>
  );
}
