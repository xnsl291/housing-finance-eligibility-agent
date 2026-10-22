/*
 * S4 행동 영역과 S12 결과 인쇄·복사. 설계서 6절 S4 '제안 배치' 8, S12, 시안 S4(kBM26) 맨 아래·S12(ixam0).
 *
 * 주 버튼은 하나만(설계서 S4 제안 배치 8)
 * - 아직 물을 것이 남았으면(next가 ASK) '질문 이어서 하기'가 주, '결과 인쇄'·'결과 복사'는 보조
 * - 아니면 '결과 인쇄'가 주, '결과 복사'는 보조
 * '처음부터 다시'는 늘 글자 버튼. 결과를 아직 못 받았으면(받는 중·실패) 인쇄·복사를 두지 않는다 — 찍을 결과가 없다.
 * 연결이 끊겨도 인쇄·복사는 잠그지 않는다. 이미 받은 결과를 브라우저 안에서 다루는 일이라 서버가 필요 없다.
 *
 * 인쇄: 브라우저 인쇄(window.print). 종이 모양은 CSS(@media print — styles/base.css 등)가 정한다. 접힌 것(판정 근거,
 * 확인 과정)은 종이에서 펼칠 방법이 없어 인쇄 직전에 펼치고 끝나면 되돌린다(beforeprint·afterprint). 버튼이 아니라
 * 이벤트에 거는 이유는 브라우저 메뉴나 Ctrl+P로 인쇄해도 같게 하려고다.
 *
 * 인쇄 머리에는 인쇄 일시를 적는다(usePrintPrep — 인쇄 전 이벤트 때 시각을 잡아 곧바로 그린다). 쪽마다 바닥에 반복하는
 * 고지는 Result.tsx가 둔다.
 *
 * 복사: 클립보드에 글로(resultCopy.ts — 고지가 맨 앞). 성공·실패를 알림(Toast)으로. 클립보드는 브라우저가 막을 수 있다
 * (권한, 주소가 https·localhost가 아님). 실패를 조용히 넘기면 사용자는 복사된 줄 알고 빈 글을 붙여 넣는다. 글을 만들다
 * 던진 것도 같은 실패로 알린다. 같은 알림을 잇달아 띄우면 알림 줄을 새로 그려 다시 읽히게 한다(Toast id).
 */
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/Button";
import { Toast } from "../components/Feedback";
import { sessionPath } from "./routes";
import { StartOver } from "./StartOver";
import styles from "./Result.module.css";

export const COPIED = "결과를 복사했습니다. 맨 앞에 고지 문구가 들어 있습니다.";
export const COPY_FAILED = "결과를 복사하지 못했습니다. 브라우저가 클립보드 사용을 막았을 수 있습니다. 결과 인쇄를 이용해 주세요.";

interface ResultActionsProps {
  sessionId: string;
  /** 아직 물을 것이 남음(MORE_TO_ASK) */
  moreToAsk: boolean;
  /** 복사할 글을 만든다. 결과를 아직 못 받았으면 null — 인쇄·복사를 두지 않는다 */
  copy: (() => string) | null;
  /** 처음부터 다시 확인 창을 띄울지(설계서 M1) */
  dirty: boolean;
  /** 질문 이어서 하기를 잠그는 이유(연결 끊김·저장 중) */
  continueLock: string | undefined;
  /** 처음부터 다시를 잠그는 이유(저장 중) */
  savingLock: string | undefined;
}

export function ResultActions({ sessionId, moreToAsk, copy, dirty, continueLock, savingLock }: ResultActionsProps) {
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ text: string; failed: boolean; n: number } | null>(null);

  async function copyResult(make: () => string) {
    const show = (text: string, failed: boolean) => setToast((t) => ({ text, failed, n: (t?.n ?? 0) + 1 }));
    try {
      await navigator.clipboard.writeText(make());
      show(COPIED, false);
    } catch {
      show(COPY_FAILED, true);
    }
  }

  return (
    <>
      <section className={styles.actions} aria-label="다음 할 일">
        {moreToAsk && (
          <Button lockedReason={continueLock} onClick={() => navigate(sessionPath(sessionId, "questions"))}>
            질문 이어서 하기
          </Button>
        )}
        {copy && (
          <>
            <Button variant={moreToAsk ? "secondary" : "primary"} onClick={() => window.print()}>
              결과 인쇄
            </Button>
            {/* 클립보드 쓰기는 기다려야 하지만 버튼 안 로딩('보내는 중')은 서버에 보내는 것처럼 읽혀 Promise를 돌려주지 않는다 */}
            <Button variant="secondary" onClick={() => void copyResult(copy)}>
              결과 복사
            </Button>
          </>
        )}
        <span className={styles.back}>
          <StartOver sessionId={sessionId} dirty={dirty} lockedReason={savingLock} />
        </span>
      </section>
      <Toast
        message={toast?.text ?? null}
        id={toast?.n}
        icon={toast?.failed ? "alertCircle" : "check"}
        onClose={() => setToast(null)}
      />
    </>
  );
}

/**
 * 인쇄 준비. 인쇄하는 동안만 본문의 접힌 것을 모두 펼친다(사용자가 열어 둔 것은 그대로, 인쇄 때문에 연 것만 되돌린다).
 * 인쇄 일시를 돌려준다 — 인쇄 전 이벤트 때 잡고 flushSync로 곧바로 그린다. 기다렸다 그리면 인쇄 지면에 빠진다.
 * 인쇄가 끝나도 지우지 않는다(화면에서는 CSS로 숨김). 다음 인쇄 때 새 시각으로 바뀐다
 */
export function usePrintPrep(): Date | null {
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    // 인쇄 전 이벤트가 인쇄 후 이벤트 없이 두 번 올 수 있다(인쇄 창을 띄운 채 PDF 저장 등). 덮어쓰면 처음에 연 것을 잊어
    // 인쇄가 끝나도 펼쳐진 채 남으므로 모은다
    // 보던 자리. Chrome은 내려 본 채로 인쇄하면 position: fixed인 바닥 고지(Result.tsx)를 쪽마다 찍지 않는다(2026-10-22
    // printToPDF로 확인 — 맨 위에서는 쪽마다 찍힘). 인쇄하는 동안만 맨 위로 올리고 끝나면 돌려놓는다
    let savedY: number | null = null;
    const before = () => {
      flushSync(() => setPrintedAt(new Date()));
      savedY ??= window.scrollY;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      const closed = [...document.querySelectorAll<HTMLDetailsElement>("main details:not([open])")];
      for (const d of closed) d.open = true;
      opened = [...opened, ...closed];
    };
    const after = () => {
      for (const d of opened) d.open = false;
      opened = [];
      if (savedY) window.scrollTo(0, savedY);
      savedY = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return printedAt;
}
