/*
 * 사이드바. 시안 B0 묶음 16, 설계서 4절 C-SIDE.
 *
 * '시스템 상태'가 아니라 '이 도구에 대해' 성격이다 — 일반 사용자에게 시스템 상태는 뜻이 없다.
 * API 주소와 상품 id는 '개발자 정보' 접힘 안에 넣는다(결함 D4). 상품은 화면 이름과
 * 전세·매매 구분으로 보인다.
 *
 * '내 기록 지우기'는 시안에 없다. 시안 뒤에 서버에 삭제 경로가 생겼고(PR #29) 개인정보 안내도
 * "'내 기록 지우기'로 서버에서 지울 수 있습니다"로 바뀌어, 안내가 말하는 버튼을 같은 자리에 둔다.
 * 되돌릴 수 없으므로 항상 확인 창(M2)을 거친다(설계서 C-RESET).
 * 지울 세션이 하나도 없으면(이 탭에서 연 세션도 주소의 세션도 없음) 버튼을 숨기지 않고 잠근 채
 * "아직 지울 기록이 없습니다"를 보인다. 바로 위 안내 문구가 이 버튼을 가리키므로, 숨기면 안내가 없는
 * 버튼을 말하게 된다. 그때 부모는 onDeleteRecords를 넘기지 않는다.
 *
 * '전체 초기화'는 적은 문장까지 지우므로 지울 것이 있으면 '초기화 확인' 창을 먼저 띄운다. 지울 것이 없으면
 * 물을 것도 없어 바로 처음으로 간다. 설계서 M1('처음부터 다시' 확인)과는 다른 창이다 — "지울 것이 있을 때만"
 * 띄우는 규칙만 M1에서 빌려 왔다. 전체 초기화는 화면 상태만 비우고 서버 기록은 지우지 않으므로, 창 본문은
 * RESET_NOTE("서버에 남은 기록은 지워지지 않습니다")를 그대로 쓰고 적은 문장도 지워진다는 말만 더한다.
 * 서버 기록은 그 뒤에도 '내 기록 지우기'로 지울 수 있다(Layout이 연 세션 목록을 초기화 때 비우지 않음).
 * 지우기가 실패하면 창을 닫지 않고 창 안에 다시 누르라는 문구를 보인다. 닫아 버리면 지워졌는지
 * 아닌지 사용자가 알 수 없다.
 *
 * 먹색 바탕 위 회색(side-muted)은 이 안에서만 쓴다. 흰 바탕에서는 대비가 모자란다(시안 C0 4절).
 */
import { useId, useState } from "react";
import { Link } from "react-router-dom";

import type { Program } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { DELETE_NOTE, NOTICE } from "./Notice";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  programs: Program[];
  /** 개발자 정보에 보일 API 주소 */
  apiBase: string;
  /** null은 아직 확인 전. 확인하기 전에 '연결됨'이라고 말하지 않는다 */
  connected: boolean | null;
  /** 화면 값과 적은 문장을 지우고 처음으로. 서버 기록은 그대로 */
  onReset: () => void;
  /** 지울 것(적은 문장·세션)이 있으면 true. 그때만 초기화 확인 창을 띄운다 */
  confirmReset?: boolean;
  /** 서버의 세션과 기록을 지움(DELETE /v1/sessions/{id}). 지울 세션이 없으면 넘기지 않는다 — 버튼이 잠긴다 */
  onDeleteRecords?: () => Promise<unknown>;
}

const TENURE = { JEONSE: "전세", PURCHASE: "매매" } as const;

export function Sidebar({ programs, apiBase, connected, onReset, confirmReset = false, onDeleteRecords }: SidebarProps) {
  const [askingReset, setAskingReset] = useState(false);
  const [asking, setAsking] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const noRecordsId = useId();

  function closeDialog() {
    setAsking(false);
    setDeleteFailed(false);
  }

  return (
    <aside className={styles.side} aria-label="이 도구에 대해">
      <div className={styles.head}>
        <span className={styles.title}>주거금융 지원가능성 판정</span>
        <span className={styles.muted}>신청 전에 가능성을 가늠하는 도구</span>
      </div>
      <hr className={styles.rule} />

      <section className={styles.group}>
        <h2 className={styles.label}>이 도구가 하는 일</h2>
        <ul className={styles.list}>
          <li>적어 주신 조건을 상품의 신청 조건과 대조합니다</li>
          <li>판정마다 공식 자료 원문을 함께 보여 줍니다</li>
          <li>모르는 항목은 모른 채로 둡니다</li>
        </ul>
      </section>
      <section className={styles.group}>
        <h2 className={styles.label}>이 도구가 하지 않는 일</h2>
        <ul className={`${styles.list} ${styles.mutedList}`}>
          <li>승인·심사를 하지 않습니다</li>
          <li>금리와 월 상환액을 계산하지 않습니다</li>
          <li>신청서를 접수하지 않습니다</li>
        </ul>
      </section>
      <hr className={styles.rule} />

      {/* 상품 목록을 받지 못하면 제목만 남지 않게 묶음을 뺀다(첫 화면 S0-b와 같은 규칙) */}
      {programs.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.label}>판정에 쓰는 상품</h2>
          <ul className={styles.list}>
            {programs.map((p) => (
              <li key={p.program_id} className={styles.program}>
                {p.tenure && <span className={styles.tenure}>{TENURE[p.tenure]}</span>}
                {p.program_name}
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* 상품 목록을 받지 못하면 '상품 id' 항목도 뺀다. 빈 항목 제목만 남지 않게(위 묶음과 같은 규칙) */}
      <details className={styles.dev}>
        <summary>
          <Icon name="chevronRight" size={14} />
          {programs.length > 0 ? "개발자 정보 (API 주소, 상품 id)" : "개발자 정보 (API 주소)"}
        </summary>
        <dl>
          <dt>API 주소</dt>
          <dd>{apiBase}</dd>
          {programs.length > 0 && (
            <>
              <dt>상품 id</dt>
              {programs.map((p) => (
                <dd key={p.program_id}>{p.program_id}</dd>
              ))}
            </>
          )}
        </dl>
      </details>
      <hr className={styles.rule} />

      <p className={styles.connection}>
        <span className={styles.dot} aria-hidden="true" />
        {connected === null
          ? "판정 서버 연결 확인 중"
          : connected
            ? "판정 서버에 연결됨"
            : "판정 서버에 연결되지 않음"}
      </p>
      <div className={styles.group}>
        <button
          type="button"
          className={styles.outline}
          onClick={() => (confirmReset ? setAskingReset(true) : onReset())}
        >
          전체 초기화
        </button>
        <p className={styles.small}>{NOTICE.reset}</p>
      </div>
      <section className={styles.group}>
        <h2 className={styles.label}>개인정보 안내</h2>
        <p className={styles.small}>{NOTICE.privacy}</p>
        {/* S11 화면(시안 '개인정보·이용 안내 자세히'). 같은 탭 안에서 옮긴다 — 새로 고치면 이 탭에서 연 세션 목록이 사라져
            '내 기록 지우기'가 지울 수 있는 범위가 줄어든다(D-39) */}
        <Link to="/privacy" className={styles.more}>
          개인정보·이용 안내 자세히
        </Link>
        {/* 잠김은 disabled가 아니라 aria-disabled로. 초점이 머물러 잠긴 이유를 읽을 수 있다(Button.tsx와 같은 방식) */}
        <button
          type="button"
          className={styles.outline}
          aria-disabled={!onDeleteRecords || undefined}
          aria-describedby={onDeleteRecords ? undefined : noRecordsId}
          onClick={() => onDeleteRecords && setAsking(true)}
        >
          내 기록 지우기
        </button>
        {!onDeleteRecords && (
          <p id={noRecordsId} className={styles.small}>
            아직 지울 기록이 없습니다
          </p>
        )}
      </section>

      <ConfirmDialog
        open={askingReset}
        title="처음으로 돌아갈까요?"
        confirmLabel="처음으로"
        cancelLabel="계속하기"
        onConfirm={() => {
          setAskingReset(false);
          onReset();
        }}
        onCancel={() => setAskingReset(false)}
      >
        {NOTICE.reset} 적어 두신 문장도 지워집니다.
      </ConfirmDialog>

      <ConfirmDialog
        open={asking}
        title="내 기록을 지울까요?"
        confirmLabel="지우기"
        cancelLabel="취소"
        onConfirm={async () => {
          setDeleteFailed(false);
          try {
            await onDeleteRecords?.();
          } catch {
            setDeleteFailed(true);
            return;
          }
          closeDialog();
        }}
        onCancel={closeDialog}
      >
        {DELETE_NOTE}
        {/* 영역은 늘 두고 글만 바꾼다. 실패하면 바로 읽힌다 */}
        <p role="alert" className={styles.fail}>
          {deleteFailed ? "지우지 못했습니다. 잠시 뒤 다시 눌러 주세요" : ""}
        </p>
      </ConfirmDialog>
    </aside>
  );
}
