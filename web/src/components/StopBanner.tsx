/*
 * 멈춘 이유 배너(결과 화면 맨 위). 시안 B0 묶음 7, 설계서 8.4.
 *
 * 판정 4색을 쓰지 않는다. COMPLETE를 초록 성공 상자로 그리면 바로 아래 빨간 '조건 불충족'
 * 카드와 뜻이 부딪친다(결함 D17). 중립색에 아이콘과 제목으로 구분한다.
 * "물을 게 없어서 멈춤"과 "모르셔서 멈춤"을 반드시 다르게 보여 준다 — 같으면 확정되지 않은
 * 결과를 확정으로 읽는다. 본문은 8.4절 문구 그대로, 제목은 시안이 붙인 것.
 */
import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import styles from "./StopBanner.module.css";

/** 서버 next.reason + 화면이 아는 USER_STOPPED. 그 밖의 값은 '판정했습니다'로 */
type StopReason = "COMPLETE" | "ALL_NOT_MATCHED" | "ONLY_DECLINED_LEFT" | "USER_STOPPED" | "MORE_TO_ASK";

const BANNER: Record<StopReason | "OTHER", { icon: IconName; title: string; body: string }> = {
  COMPLETE: { icon: "check", title: "모두 확인했습니다", body: "판정에 필요한 항목을 모두 확인했습니다." },
  ALL_NOT_MATCHED: {
    icon: "xCircle",
    title: "더 물어도 바뀌지 않습니다",
    body: "확인한 조건으로는 남은 상품 모두 조건에 맞지 않아 더 묻지 않았습니다. 아래에서 어느 조건 때문인지 확인할 수 있습니다.",
  },
  ONLY_DECLINED_LEFT: {
    icon: "help",
    title: "모르신 항목이 남았습니다",
    body: "을(를) 모르셔서 확정하지 못한 부분이 있습니다. 확인되면 이어서 판정할 수 있습니다.",
  },
  USER_STOPPED: {
    icon: "pause",
    title: "중간에 멈췄습니다",
    body: "질문을 중간에 멈췄습니다. 지금까지 확인한 값으로만 판정했습니다.",
  },
  // 고친 값으로 다시 판정했더니 물을 것이 남음(useResult.ts). 사용자가 멈춘 것이 아니라 USER_STOPPED 문구를 쓰지 않는다.
  // 8.4절에 없는 경우라 문구는 화면이 정했다 — 고친 값 때문인지는 단정하지 않는다(앞서 남아 있던 질문일 수도 있음)
  MORE_TO_ASK: {
    icon: "help",
    title: "아직 여쭐 항목이 남았습니다",
    body: "판정에 더 필요한 항목이 남아 있습니다. 지금까지 확인한 값으로만 판정했습니다.",
  },
  OTHER: { icon: "info", title: "판정했습니다", body: "판정했습니다." },
};

interface StopBannerProps {
  reason: string | undefined;
  /** ONLY_DECLINED_LEFT일 때 모른다고 한 항목 이름표들 */
  declinedLabels?: string[];
  /** 본문 아래에 붙일 것(S4: 모른다고 한 항목으로 가는 버튼 — 결함 D1) */
  children?: ReactNode;
}

export function StopBanner({ reason, declinedLabels = [], children }: StopBannerProps) {
  const key = reason && reason in BANNER ? (reason as StopReason) : "OTHER";
  const b = BANNER[key];
  const body =
    key === "ONLY_DECLINED_LEFT" ? `${declinedLabels.join(", ") || "일부 항목"}${b.body}` : b.body;
  return (
    <div className={styles.banner}>
      <Icon name={b.icon} size={19} />
      <div className={styles.text}>
        <strong className={styles.title}>{b.title}</strong>
        <span className={styles.body}>{body}</span>
        {children}
      </div>
    </div>
  );
}
