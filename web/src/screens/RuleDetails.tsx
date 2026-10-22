/*
 * S5 판정 근거 상세(카드 안 펼침). 설계서 6절 S5, 8.2, 시안 S4-a·S4-i·S4-l. Streamlit results.render_detail과 같은 순서.
 *
 * 이 도구의 주장("모든 조건에 출처가 붙는다")을 증명하는 자리다(G9). 그래서 판정에 쓰이지 않은 규칙,
 * 아직 다루지 않는 조건, 검수 대기 건수까지 드러낸다. 접어 둘 수는 있어도 건수는 늘 보인다.
 *
 * 순서와 기본 상태(설계서 표 그대로)
 * 1. 규칙별 판정 — 불충족·값 없음·걸침은 펼침(급한 것: 왜 안 됐나, 뭘 더 알려 줘야 하나), 모르는 결과 코드도
 *    펼친 쪽에(새 종류가 생긴 것을 숨기지 않으려고). 통과·특례로 대체됨·적용 대상 아님은 접힘(건수는 제목에).
 *    검수 대기는 건수 주의 + 내용 접힘
 * 2. 한도 계산 근거 3. 아직 다루지 않는 조건 4. 출처
 *
 * 원문 인용은 서식 없이 원문 그대로(G8) — 글자로만 넣어 `*`·`_`가 서식으로 바뀌지 않고, 줄바꿈도 그대로 둔다.
 * 규칙 머리에는 항목 코드 대신 이름표(결함 D4). 규칙 번호는 근거를 되짚을 때 쓰므로 작게 남긴다.
 */
import type { ReactNode } from "react";

import type { FieldCatalog, ProgramResult, RuleOutcome } from "../api/types";
import { formatWon } from "../components/amount";
import { Icon } from "../components/Icon";
import { limitCaveat, limitReasonText } from "../components/ProductCard";
import { fieldLabel, tierLabel } from "./resultText";
import styles from "./RuleDetails.module.css";

/** 설계서 8.2 규칙 결과 이름. 모르는 코드는 코드 그대로(Streamlit labels.outcome_label) */
export const OUTCOME_LABEL: Record<string, string> = {
  FAILED: "불충족",
  MISSING_VALUE: "값 없음",
  IMPRECISE: "값이 기준에 걸쳐 판단 불가",
  PASSED: "통과",
  SUPERSEDED: "특례로 대체됨",
  NOT_APPLICABLE: "적용 대상 아님",
  NOT_REVIEWED: "검수 전이라 판정에 쓰지 않음",
};

const OPEN = ["FAILED", "MISSING_VALUE", "IMPRECISE"];
const FOLDED = ["PASSED", "SUPERSEDED", "NOT_APPLICABLE"];
const NO_QUOTE = "이 규칙에는 원문 인용이 붙어 있지 않습니다";

interface RuleDetailsProps {
  result: ProgramResult;
  catalog: FieldCatalog | null;
  /** 카드와 같은 한도 설명·단서를 쓰려고 화면이 계산해 넘긴다 */
  limitNote: string;
  final: boolean;
  unresolved: number;
}

export function RuleDetails({ result, catalog, limitNote, final, unresolved }: RuleDetailsProps) {
  return (
    <div className={styles.details}>
      <Rules outcomes={result.rule_outcomes} catalog={catalog} />
      <LimitBasis result={result} note={limitNote} final={final} unresolved={unresolved} />

      <section className={styles.part}>
        <h4 className={styles.partTitle}>아직 다루지 않는 조건</h4>
        {result.unresolved.length > 0 ? (
          <ul className={styles.plain}>
            {result.unresolved.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>이 상품에 적어 둔 미해결 조건이 없습니다</p>
        )}
      </section>

      <section className={styles.part}>
        <h4 className={styles.partTitle}>출처</h4>
        <ul className={styles.plain}>
          {result.source_url && (
            <li>
              원문{" "}
              <a href={result.source_url} target="_blank" rel="noreferrer">
                {result.source_url}
                <span className="sr-only"> (새 창)</span>
              </a>
            </li>
          )}
          <li>자료 확인일 {result.source_checked_at || "표시 없음"}</li>
          <li>규칙 버전 {result.rule_version ?? "표시 없음"}</li>
        </ul>
      </section>
    </div>
  );
}

function Rules({ outcomes, catalog }: { outcomes: RuleOutcome[]; catalog: FieldCatalog | null }) {
  const groups = new Map<string, RuleOutcome[]>();
  for (const rule of outcomes) groups.set(rule.outcome, [...(groups.get(rule.outcome) ?? []), rule]);
  const known = [...OPEN, ...FOLDED, "NOT_REVIEWED"];
  const unknown = [...groups.keys()].filter((code) => !known.includes(code)).sort();
  const reviewWait = groups.get("NOT_REVIEWED") ?? [];
  const title = (code: string, n: number) => `${OUTCOME_LABEL[code] ?? code} ${n}건`;

  return (
    <section className={styles.part}>
      <h4 className={styles.partTitle}>규칙별 판정</h4>
      {outcomes.length === 0 && <p className={styles.muted}>규칙 결과를 응답에서 받지 못했습니다</p>}
      {[...OPEN, ...unknown].map((code) => {
        const rules = groups.get(code);
        if (!rules) return null;
        return (
          <div key={code} className={styles.group}>
            <h5 className={styles.groupTitle}>{title(code, rules.length)}</h5>
            <RuleList rules={rules} catalog={catalog} failed={code === "FAILED"} />
          </div>
        );
      })}
      {FOLDED.map((code) => {
        const rules = groups.get(code);
        if (!rules) return null;
        return (
          <details key={code} className={styles.fold}>
            <summary>
              {title(code, rules.length)}
              <Icon name="chevronDown" size={14} />
            </summary>
            <RuleList rules={rules} catalog={catalog} failed={false} />
          </details>
        );
      })}
      {reviewWait.length > 0 && (
        <div className={styles.group}>
          <p className={styles.caution}>
            <Icon name="alertTriangle" size={15} />
            {reviewWait.length}건은 검수 전이라 이번 판정에 쓰이지 않았습니다
          </p>
          <details className={styles.fold}>
            <summary>
              검수 대기 규칙 {reviewWait.length}건 보기
              <Icon name="chevronDown" size={14} />
            </summary>
            <RuleList rules={reviewWait} catalog={catalog} failed={false} />
          </details>
        </div>
      )}
    </section>
  );
}

function RuleList({ rules, catalog, failed }: { rules: RuleOutcome[]; catalog: FieldCatalog | null; failed: boolean }) {
  return (
    <ul className={styles.rules}>
      {rules.map((rule, i) => (
        <li key={`${i}-${rule.rule_id}`} className={styles.rule}>
          <p className={styles.ruleHead}>
            <span className={styles.ruleId}>{rule.rule_id}</span>
            {rule.field && <span>{fieldLabel(catalog, rule.field)}</span>}
            {/* 사유는 불충족만 빨간 글자로(설계서 8.2). 다음 줄로 내리면 규칙 하나가 세 줄이 된다 */}
            {failed && rule.failure_message && <span className={styles.failure}>— {rule.failure_message}</span>}
          </p>
          <Quote text={rule.citation} />
        </li>
      ))}
    </ul>
  );
}

/** 원문 인용. 글자 그대로(G8). 없으면 없다고 말한다 */
function Quote({ text }: { text: string | null }) {
  return text ? <p className={styles.quote}>{text}</p> : <p className={styles.muted}>{NO_QUOTE}</p>;
}

/**
 * 한도 계산 근거. 카드에만 단서를 달면 상세를 펼친 사람에게는 금액이 다시 확정처럼 보인다 — 같은 금액을
 * 두 번 보여 주므로 단서도 두 곳에 있어야 한다(Streamlit _한도_근거)
 */
function LimitBasis({ result, note, final, unresolved }: { result: ProgramResult; note: string; final: boolean; unresolved: number }) {
  const limit = result.loan_limit;
  if (limit === null) {
    return (
      <section className={styles.part}>
        <h4 className={styles.partTitle}>한도 계산 근거</h4>
        <p className={styles.muted}>이 판정에서는 한도를 계산하지 않았습니다</p>
      </section>
    );
  }
  const tier = tierLabel(limit.tier);
  return (
    <section className={styles.part}>
      <h4 className={styles.partTitle}>한도 계산 근거</h4>
      <dl className={styles.facts}>
        {limit.amount_krw === null ? (
          <Fact name="금액">{limitReasonText(limit.reason)}</Fact>
        ) : (
          <>
            <Fact name="금액">
              <span className="num">{formatWon(limit.amount_krw)}</span>
            </Fact>
            {!final && <Fact name="단서">{limitCaveat(unresolved)}</Fact>}
            <Fact name="계산">{note}</Fact>
            {tier && <Fact name="적용 구간">{tier}</Fact>}
          </>
        )}
        {limit.rule_id && (
          <Fact name="근거 규칙">
            <span className={styles.ruleId}>{limit.rule_id}</span>
          </Fact>
        )}
      </dl>
      <Quote text={limit.citation} />
    </section>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}
