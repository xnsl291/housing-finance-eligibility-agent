/*
 * S8 이어서 하기 배너. 설계서 6절 S8(결함 D2), 시안 S8(LMNGD).
 *
 * 세션 번호는 이미 주소(/s/:id/...)에 있어 새로 고쳐도 서버에서 값을 받아 이어 간다(routes.ts). 이 배너는 사용자에게
 * 그 사실을 알린다 — 이 탭에서 시작하지 않은 세션(앱 메모리에 없음 = 새로 고침·주소로 들어옴)으로 S2~S4에 들어왔을 때만.
 *
 * - 보일지는 처음 그릴 때 한 번 정한다. 그다음 이 세션을 앱 메모리에 넣는다(rememberSession) — 같은 탭에서 다음 단계로
 *   넘어가면 더는 '이전에 하던' 것이 아니어서 배너를 다시 띄우지 않는다. 메모리에 넣으면 '내 기록 지우기'의 대상에도
 *   남는다(StartOver.tsx가 떠나기 전에 넣는 것과 같은 이유)
 * - 자리는 제목(h1) 아래. 화면이 바뀌면 초점이 h1로 가므로(Layout.tsx) 위에 두면 화면 읽기 프로그램이 건너뛴다
 *   (S4 멈춘 이유를 제목 아래로 내린 것과 같은 원칙). 시안은 제목 위다
 * - '새로 시작'은 '처음부터 다시'와 같은 확인 창 규칙(설계서 M1, StartOver.tsx)
 * - 시안 본문의 '3개를 확인한 곳부터'는 쓰지 않는다. 확인 수는 앱 메모리라 새로 고치면 모른다(AppState.tsx)
 * - 시안의 주소 공유 주의(이 주소를 남에게 보내지 마세요)는 S11 개인정보 안내 몫이라 여기 두지 않는다
 * - 화면이 closed를 켜면 닫고 다시 열지 않는다. S4는 고친 값을 저장하면 켠다 — 이미 이어서 작업하는 중이라
 *   '이전에 하던 확인을 이어서 보여 드립니다'가 지난 말이 되고, 제목과 바뀐 곳 안내 사이를 가로막는다
 */
import { useEffect, useId, useState } from "react";

import { Icon } from "../components/Icon";
import { useAppState } from "./AppState";
import { StartOver } from "./StartOver";
import styles from "./ResumeBanner.module.css";

interface ResumeBannerProps {
  sessionId: string;
  dirty: boolean;
  /** 켜지면 닫는다(머리말) */
  closed?: boolean;
  /** '새로 시작'을 잠글 이유(고친 값을 저장하는 중 — StartOver.tsx) */
  lockedReason?: string;
}

export function ResumeBanner({ sessionId, dirty, closed = false, lockedReason }: ResumeBannerProps) {
  const { knowsSession, rememberSession } = useAppState();
  const [resumed, setResumed] = useState(() => !knowsSession(sessionId));
  // 한 번 닫으면 closed가 다시 꺼져도(다시 받는 동안 등) 열지 않는다
  if (closed && resumed) setResumed(false);
  const titleId = useId();

  useEffect(() => {
    rememberSession(sessionId);
  }, [sessionId, rememberSession]);

  if (!resumed) return null;
  return (
    <section className={styles.banner} aria-labelledby={titleId}>
      <Icon name="rotateCcw" size={18} />
      <div className={styles.text}>
        <h2 id={titleId} className={styles.title}>
          이전에 하던 확인을 이어서 보여 드립니다
        </h2>
        <p className={styles.body}>
          서버에 남아 있는 값으로 이어 갑니다. 처음부터 다시 하시려면 ‘새로 시작’을 눌러 주세요.
        </p>
      </div>
      <StartOver sessionId={sessionId} dirty={dirty} label="새로 시작" variant="secondary" lockedReason={lockedReason} />
    </section>
  );
}
