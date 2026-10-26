/*
 * 멈춘 이유 배너(결과 화면 맨 위). 시안 B0 묶음 7, 설계서 8.4.
 *
 * 판정 4색을 쓰지 않는다. COMPLETE를 초록 성공 상자로 그리면 바로 아래 빨간 '조건 불충족'
 * 카드와 뜻이 부딪친다(결함 D17). 중립색에 아이콘과 제목으로 구분한다.
 * "물을 게 없어서 멈춤"과 "모르셔서 멈춤"을 반드시 다르게 보여 준다 — 같으면 확정되지 않은
 * 결과를 확정으로 읽는다. 본문은 8.4절 문구 그대로(MORE_TO_ASK만 아래 이유로 다름), 제목은 시안이 붙인 것.
 */
import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import styles from "./StopBanner.module.css";

/** 서버 next.reason + 화면이 정한 MORE_TO_ASK(next가 ASK — 아직 물을 것이 남음). 그 밖의 값은 '판정했습니다'로 */
type StopReason = "COMPLETE" | "ALL_NOT_MATCHED" | "ONLY_DECLINED_LEFT" | "MORE_TO_ASK";

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
  // next가 ASK인데 결과 화면에 있음. 설계서 8.4의 USER_STOPPED("질문을 중간에 멈췄습니다")를 쓰지 않는다 — 서버는
  // '사용자가 멈춤'과 '고친 뒤 물을 것이 새로 생김'을 나누지 못하고, 화면 메모리로 나누면 새로 고칠 때 말이 바뀐다.
  // 어느 경우에도 참인 사실 하나만 말한다(useResult.ts)
  MORE_TO_ASK: {
    icon: "pause",
    title: "아직 여쭐 항목이 남았습니다",
    body: "지금까지 확인한 값으로만 판정했습니다. 질문을 이어서 하면 결과가 바뀔 수 있습니다.",
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

/** 배너의 제목과 본문. 결과 복사(S12)도 같은 말을 쓴다 */
export function stopText(reason: string | undefined, declinedLabels: string[] = []) {
  const key = reason && reason in BANNER ? (reason as StopReason) : "OTHER";
  const b = BANNER[key];
  const body =
    key === "ONLY_DECLINED_LEFT" ? `${declinedLabels.join(", ") || "일부 항목"}${b.body}` : b.body;
  return { icon: b.icon, title: b.title, body };
}

export function StopBanner({ reason, declinedLabels = [], children }: StopBannerProps) {
  const { icon, title, body } = stopText(reason, declinedLabels);
  return (
    <div className={styles.banner}>
      <Icon name={icon} size={19} />
      <div className={styles.text}>
        <strong className={styles.title}>{title}</strong>
        <span className={styles.body}>{body}</span>
        {children}
      </div>
    </div>
  );
}
