/*
 * 상품 카드(판정 결과 S4). 시안 B0 묶음 13·14.
 *
 * 판정 배지가 가장 먼저 읽혀야 한다. 한도는 판정이 끝났을 때만 확정처럼 크게 보인다(G7) —
 * 한도는 보증금만 있으면 계산되므로, 소득을 모르는 '정보 부족'에서도 금액이 나온다.
 * 크게 띄우면 사용자는 확정으로 읽는다. 그래서 네 경우로 나눈다(시안 '예상 한도 네 가지 경우').
 *   ① 조건 불충족: 한도 줄이 아예 없다. 탈락한 사람에게 금액을 알려 주지 않는다
 *   ② 판정이 '사전 조건 부합'(PRECHECK_MATCH)이고 남은 조건 0개: '예상 대출 한도' 크게
 *   ③ 그 밖에 금액이 있음: 작게 + 회색 주의 상자(주황 '추가 확인 필요'와 모양으로 구분).
 *      남은 조건 수가 0이어도 판정이 끝나지 않았으면(추가 확인 필요·정보 부족) 크게 띄우지 않는다
 *   ④ 금액을 못 냄: 설계서 8.3 사유 그대로
 * 아래 목록은 판정에 따라 뜻이 달라 제목을 다르게 단다(묶음 14).
 * '사전 조건 부합'인데 금액을 못 냈으면 서버 목록에는 그 사유 한 줄만 온다(assessment.py _next_actions).
 * 한도 자리(④)가 이미 같은 사유를 말하므로 목록은 그리지 않는다.
 */
import type { ReactNode } from "react";

import type { Status } from "../api/types";
import { formatWon } from "./amount";
import { Icon } from "./Icon";
import { VerdictBadge } from "./VerdictBadge";
import styles from "./ProductCard.module.css";

/** 설계서 8.3 한도를 못 낸 이유. 모르는 코드는 '대출 한도를 계산하지 못했습니다'. 판정 근거(S5)도 같은 문장을 쓴다 */
const LIMIT_REASON: Record<string, string> = {
  BASE_UNKNOWN: "한도 계산에 쓰는 금액을 입력하면 한도를 계산할 수 있습니다",
  BASE_IMPRECISE: "금액이 범위로만 들어와 한도를 내지 않았습니다. 정확한 금액을 입력해 주세요",
  TIER_UNKNOWN: "한도 기준이 갈리는 조건을 아직 알 수 없어 금액을 내지 못했습니다",
  REGION_UNKNOWN: "지역에 따라 한도가 달라집니다. 주택 소재지를 입력해 주세요",
  NOT_REVIEWED: "한도 규칙이 아직 검수되지 않아 금액을 내지 않습니다",
};

export function limitReasonText(reason: string | null | undefined): string {
  return LIMIT_REASON[reason ?? ""] ?? "대출 한도를 계산하지 못했습니다";
}

/** 금액이 확정이 아닐 때 붙이는 단서(③). 카드와 판정 근거(S5)가 같은 금액을 보이므로 단서도 같아야 한다 */
export function limitCaveat(unresolved: number): string {
  return unresolved > 0
    ? `아직 확인되지 않은 조건이 ${unresolved}개 있어 이 금액은 달라질 수 있습니다`
    : "판정이 끝나지 않아 이 금액은 달라질 수 있습니다";
}

/** 한도를 확정처럼 크게 보여도 되는가(②) — 판정이 '사전 조건 부합'이고 남은 조건이 없을 때만. 판정 근거(S5)도 이걸로 단서를 단다 */
export function isFinal(status: Status, unresolved: number): boolean {
  return status === "PRECHECK_MATCH" && unresolved === 0;
}

const LIST_TITLE: Record<Status, string> = {
  NOT_MATCHED: "맞지 않는 조건",
  CONDITIONAL: "더 알려 주시면 판정할 수 있는 것",
  INSUFFICIENT_INFORMATION: "더 알려 주시면 판정할 수 있는 것",
  PRECHECK_MATCH: "참고",
};

export interface LimitInfo {
  /** 원 단위 한도. 못 냈으면 null */
  won: number | null;
  /** won이 null일 때 서버가 준 이유 코드 */
  reason?: string | null;
  /** 한도를 어떻게 구했는지 한 줄(예: 보증금 비율에 걸렸습니다). 금액이 있을 때만 보인다 */
  note?: string;
}

interface ProductCardProps {
  name: string;
  status: Status;
  limit: LimitInfo;
  /** 아직 확인되지 않은 조건 수(빠진 값 + 기준에 걸친 값) */
  unresolved: number;
  /** 판정별 목록 줄들. 비어 있으면 목록을 그리지 않는다 */
  items: string[];
  sourceUrl: string;
  /** 판정 근거 상세(S5). 접힘 안에 넣는다 */
  details: ReactNode;
  /** 비교표(S9)의 '자세히'가 찾아오는 id. 제목은 초점을 받을 수 있다(tabIndex -1) */
  id?: string;
}

export function ProductCard({ name, status, limit, unresolved, items, sourceUrl, details, id }: ProductCardProps) {
  const list = status === "PRECHECK_MATCH" && limit.won === null ? [] : items;
  return (
    <article id={id} className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.name} tabIndex={-1}>
          {name}
        </h3>
        <VerdictBadge status={status} />
      </div>

      {status !== "NOT_MATCHED" && <Limit limit={limit} final={isFinal(status, unresolved)} unresolved={unresolved} />}

      {list.length > 0 && (
        <div className={styles.list}>
          <h4 className={styles.listTitle}>{LIST_TITLE[status]}</h4>
          <ul className={status === "NOT_MATCHED" ? styles.failed : undefined}>
            {/* 서버 문장이 겹칠 수 있어(같은 사유가 두 규칙에서 나옴) 글만으로는 key가 겹친다 */}
            {list.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.foot}>
        {/* 공식 페이지는 카드에서 바로 보이게(N10). 카드가 여럿이면 링크 목록에서 "공식 안내 페이지"가
            줄줄이 나와 구분이 안 되므로, 화면 읽기 프로그램에만 상품 이름을 붙인다 */}
        <a className={styles.link} href={sourceUrl} target="_blank" rel="noreferrer">
          <Icon name="externalLink" size={14} />
          공식 안내 페이지
          <span className="sr-only"> {name} (새 창)</span>
        </a>
        <details className={styles.details}>
          <summary>
            판정 근거 자세히 보기
            <Icon name="chevronDown" size={15} />
          </summary>
          {details}
        </details>
      </div>
    </article>
  );
}

function Limit({ limit, final, unresolved }: { limit: LimitInfo; final: boolean; unresolved: number }) {
  if (limit.won === null) {
    return <p className={styles.noLimit}>{limitReasonText(limit.reason)}</p>;
  }
  if (!final) {
    return (
      <div className={styles.limit}>
        <span className={styles.limitLabel}>지금까지 확인된 조건 기준 한도</span>
        <strong className={`${styles.partialAmount} num`}>{formatWon(limit.won)}</strong>
        {/* 한도 설명은 확정이 아닐 때도 보인다(설계서 S4 상품 카드 '한도 설명', 시안 S4) */}
        {limit.note && <span className={styles.note}>{limit.note}</span>}
        <p className={styles.caution}>
          <Icon name="alertTriangle" size={15} />
          {limitCaveat(unresolved)}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.limit}>
      <span className={styles.limitLabel}>예상 대출 한도</span>
      <strong className={`${styles.finalAmount} num`}>{formatWon(limit.won)}</strong>
      {limit.note && <span className={styles.note}>{limit.note}</span>}
    </div>
  );
}
