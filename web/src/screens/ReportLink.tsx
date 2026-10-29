/*
 * S13 의견 보내기 '이 판정이 이상해요'. 설계서 6절 S13, 9절 N15. 판정 근거(S5) 끝에 상품마다 하나.
 *
 * 받는 곳은 공개 코드 저장소의 GitHub 이슈 양식(.github/ISSUE_TEMPLATE/judgment-feedback.yml)이다. 이슈는 누구나
 * 읽으므로 주소에 채우는 것은 개인정보가 아닌 셋뿐이다 — 양식 이름, 상품 이름, 그 카드의 판정 이름.
 * 넣은 값·근거 구절·세션 번호는 채우지 않는다(세션 번호는 기록을 되찾는 열쇠라 공개되면 값이 그대로 보인다 — S11 주소 공유 주의).
 * 그래서 이 링크는 판정 결과(ProgramResult) 전체를 받지 않고 이름 둘만 받는다.
 *
 * S5 끝에 두는 이유: 설계서가 '결과 카드나 S5 끝'을 적었고, 상품마다 두어야 어느 상품의 어느 판정인지 채울 수 있다.
 * 판정이 이상하다고 느낀 사람은 근거를 먼저 펼쳐 보므로 그 끝이 자연스럽고, 접힘 안이라 결과 화면을 시끄럽게 하지 않는다.
 * 인쇄(S12)에서는 뺀다(screen-only) — 종이에서는 누를 수 없고, 인쇄가 링크 뒤에 주소를 덧붙여 찍는다(base.css).
 */
import type { Status } from "../api/types";
import { Icon } from "../components/Icon";
import { VERDICT_LABEL } from "../components/VerdictBadge";
import styles from "./RuleDetails.module.css";

/** 공개 코드 저장소. 의견 받는 곳을 바꾸면 여기 한 곳만 */
export const ISSUE_REPO = "https://github.com/xnsl291/housing-finance-eligibility-agent";
/** .github/ISSUE_TEMPLATE의 파일 이름. 아래 채우는 열쇠(product·verdict)는 그 양식의 id와 같아야 한다 */
const TEMPLATE = "judgment-feedback.yml";

export const REPORT_WARNING = "GitHub 공개 이슈로 열립니다. 입력한 값이나 개인정보는 적지 마세요. GitHub 계정이 필요합니다.";

export function reportUrl(programName: string, status: Status): string {
  const verdict = VERDICT_LABEL[status];
  const query = new URLSearchParams({
    template: TEMPLATE,
    title: `[판정 의견] ${programName} — ${verdict}`,
    product: programName,
    verdict,
  });
  return `${ISSUE_REPO}/issues/new?${query}`;
}

export function ReportLink({ programName, status }: { programName: string; status: Status }) {
  return (
    <section className={`${styles.part} ${styles.report} screen-only`} aria-label="의견 보내기">
      <p className={styles.muted}>{REPORT_WARNING}</p>
      <a className={styles.reportLink} href={reportUrl(programName, status)} target="_blank" rel="noopener noreferrer">
        <Icon name="externalLink" size={14} />
        이 판정이 이상해요
        <span className="sr-only"> ({programName}, 새 창)</span>
      </a>
    </section>
  );
}
