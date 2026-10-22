/*
 * S4 판정 결과. 설계서 6절 S4 '제안 배치' 중 이번 범위, 시안 S4(kBM26)·S4-c·d·e·f·g·i, S4-M1.
 *
 * 위에서 아래로
 * 1. 멈춘 이유 — 중립 배너(판정 4색을 쓰지 않음, 11.2·D17). "물을 게 없어서"와 "모르셔서"를 다르게(8.4)
 * 2. 왜 이 상품만 보이나 한 줄 — 기록에 남은 전세·매매 답으로(resultText.scopeLine)
 * 3. 고지
 * 4. 상품 카드 — 판정 순(13절 Q2). 카드 안에 판정 근거(S5)
 * 5. 확인 과정(S6, 접힘)
 * 6. 행동 영역 — 사용자가 멈췄으면 주 버튼 '질문 이어서 하기', 보조 '처음부터 다시'
 * 비교표(S9)·조건 요약과 고치기(S7)·인쇄(S12)는 다음 PR이라 자리도 두지 않는다.
 *
 * 서버 주고받기와 실패 나누기는 useResult.ts. 이 화면은 판정하지 않는다 — 받은 것을 그대로 보이고, 순서만 바꾼다.
 * 연결이 끊겨도 받은 결과는 숨기지 않는다(시안 S4-f) — 숨기면 "서버가 안 됨"이 "당신은 안 됨"처럼 읽힌다(G13).
 *
 * '질문 이어서 하기'는 바로 S3로 간다. 판정 결과는 서버 기록에 남아 있으므로 '결과를 지운다'고 말하지 않는다.
 * 모른다고 한 것만 남은 경우(ONLY_DECLINED_LEFT)에는 두지 않는다 — 모른다고 한 항목은 다시 묻지 않아 누르면
 * 곧바로 결과로 돌아온다(8.4 'D1을 푸는 길'). S7과 함께 푼다.
 */
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import type { FieldCatalog, ProgramResult } from "../api/types";
import { Button } from "../components/Button";
import { Skeleton, SystemError } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { ProductCard } from "../components/ProductCard";
import { StopBanner } from "../components/StopBanner";
import { useAppState } from "./AppState";
import { Missing } from "./Confirm";
import { describeFailure } from "./failure";
import { fieldLabel, hasRecords, limitNote, scopeLine, sortByVerdict, tenureOf, unresolvedCount } from "./resultText";
import { sessionPath } from "./routes";
import { RuleDetails } from "./RuleDetails";
import { StartOver } from "./StartOver";
import { TraceSection } from "./TraceSection";
import { USER_STOPPED, useResult } from "./useResult";
import screen from "./Screen.module.css";
import styles from "./Result.module.css";

const OFFLINE_LOCK = "서버에 연결되지 않아 지금은 이어 갈 수 없습니다.";

export function Result() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { connected, recheckConnection, answeredCount } = useAppState();
  const { load, catalog, fetchAll, retryTrace } = useResult(sessionId);

  if (load.kind === "missing") return <Missing />;

  const offline = connected === false || load.kind === "offline";
  const ready = load.kind === "ready" ? load : null;
  async function reconnect() {
    await recheckConnection();
    if (load.kind !== "ready") await fetchAll();
  }
  // 지울 것이 있을 때만 확인 창(설계서 M1). 기록을 못 받았으면 있다고 본다
  const dirty =
    answeredCount(sessionId) > 0 || ready === null || ready.trace.kind !== "ready" || hasRecords(ready.trace.events);

  return (
    <>
      {offline && (
        <SystemError title="지금 판정 서버에 연결할 수 없습니다" retryLabel="다시 연결 확인" onRetry={reconnect}>
          <span className={styles.line}>조건의 문제가 아닙니다.</span>
          {ready && <span className={styles.line}>이미 받은 결과는 화면에 그대로 있습니다.</span>}
        </SystemError>
      )}
      {ready && (
        <div className={styles.top}>
          <StopBanner
            reason={ready.reason}
            declinedLabels={ready.declinedNeeded.map((f) => fieldLabel(catalog, f))}
          />
          {ready.trace.kind === "ready" && (
            <p className={styles.scope}>
              <Icon name="minus" size={15} />
              {scopeLine(tenureOf(ready.trace.events))}
            </p>
          )}
        </div>
      )}
      <section className={screen.heading}>
        <span className={screen.eyebrow}>판정 결과</span>
        <h1 className={screen.title}>이 조건으로 본 결과</h1>
        <Notice kind="result" />
      </section>

      {load.kind === "loading" && <Skeleton />}
      {load.kind === "failed" && !offline && <AssessFailed error={load.error} onRetry={fetchAll} />}
      {ready && (
        <>
          <Cards results={ready.results} catalog={catalog} />
          <TraceSection
            trace={ready.trace}
            catalog={catalog}
            onRetry={retryTrace}
            lockedReason={offline ? OFFLINE_LOCK : undefined}
          />
        </>
      )}

      <section className={styles.actions} aria-label="다음 할 일">
        {ready?.reason === USER_STOPPED && (
          <Button lockedReason={offline ? OFFLINE_LOCK : undefined} onClick={() => navigate(sessionPath(sessionId, "questions"))}>
            질문 이어서 하기
          </Button>
        )}
        <span className={styles.back}>
          <StartOver sessionId={sessionId} dirty={dirty} />
        </span>
      </section>
    </>
  );
}

function Cards({ results, catalog }: { results: ProgramResult[]; catalog: FieldCatalog | null }) {
  const { programs } = useAppState();
  if (results.length === 0) return <p className={styles.empty}>판정한 상품이 없습니다.</p>;
  return (
    <div className={styles.cards}>
      {sortByVerdict(results).map((result) => {
        const tenure = Array.isArray(programs) ? programs.find((p) => p.program_id === result.program_id)?.tenure : undefined;
        const limit = result.loan_limit;
        const unresolved = unresolvedCount(result);
        const final = result.status === "PRECHECK_MATCH" && unresolved === 0;
        const note = limit ? limitNote(limit, tenure) : "";
        return (
          <ProductCard
            key={result.program_id}
            name={result.program_name}
            status={result.status}
            limit={{ won: limit?.amount_krw ?? null, reason: limit?.reason, note }}
            unresolved={unresolved}
            items={result.next_actions}
            sourceUrl={result.source_url}
            details={<RuleDetails result={result} catalog={catalog} limitNote={note} final={final} unresolved={unresolved} />}
          />
        );
      })}
    </div>
  );
}

/** 판정 실패(설계서 S3 상태표 '판정 실패', 결함 D15와 같은 원칙). 다시 시도는 멈춘 이유부터 다시 받는다 */
function AssessFailed({ error, onRetry }: { error: unknown; onRetry: () => Promise<void> }) {
  const text = describeFailure(error, "start");
  return (
    <SystemError title="판정하지 못했습니다" icon={text.icon} onRetry={onRetry}>
      {error instanceof ApiError && error.kind === "http" ? (
        <>
          <span className={styles.line}>조건의 문제가 아닙니다.</span>
          <span className={styles.line}>사유: {error.message}</span>
        </>
      ) : (
        <span className={styles.line}>{text.body}</span>
      )}
    </SystemError>
  );
}
