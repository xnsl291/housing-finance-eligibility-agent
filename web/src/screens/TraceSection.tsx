/*
 * S6 확인 과정(결과 아래 접힘). 설계서 6절 S6, 시안 S4-b. Streamlit app._결과의 '어떤 순서로 무엇을 확인했나'.
 *
 * 규칙마다 어떻게 됐는지는 S5가 보여 준다. 여기서는 값이 어디서 왔는지 — 문장에서 읽었는지, 고쳤는지,
 * 답했는지, 모른다고 했는지를 순서대로 보인다. 줄 모양은 resultText.traceLines.
 * 아래 TRACE_NOTE는 글자 그대로(C-COPY, Notice.tsx). 기록을 못 받아도 결과는 그대로 두고 여기만 다시 시도한다.
 */
import { ApiError } from "../api/client";
import type { FieldCatalog } from "../api/types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { describeFailure } from "./failure";
import { traceLines } from "./resultText";
import type { TraceState } from "./useResult";
import styles from "./Result.module.css";

interface TraceSectionProps {
  trace: TraceState;
  catalog: FieldCatalog | null;
  onRetry: () => Promise<void>;
  /** 연결이 끊겼으면 다시 시도를 잠근다. 이유는 맨 위 E1 상자가 말한다 */
  lockedReason: string | undefined;
}

export function TraceSection({ trace, catalog, onRetry, lockedReason }: TraceSectionProps) {
  return (
    <>
      <details className={styles.trace}>
        <summary>
          <Icon name="chevronRight" size={15} />
          어떤 순서로 무엇을 확인했나
        </summary>
        {trace.kind === "ready" ? (
          <ol className={styles.traceList}>
            {traceLines(trace.events, catalog).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        ) : (
          <div className={styles.traceFailed}>
            {/* 설계서 S6 '기록을 불러오지 못했습니다. (사유)'. 서버가 준 사유는 그대로, 그 밖은 failure.ts의 문장 */}
            <p>기록을 불러오지 못했습니다. {reasonOf(trace.error)}</p>
            <Button variant="secondary" lockedReason={lockedReason} onClick={onRetry}>
              다시 시도
            </Button>
          </div>
        )}
      </details>
      <Notice kind="trace" />
    </>
  );
}

function reasonOf(error: unknown): string {
  if (error instanceof ApiError && error.kind === "http") return error.message;
  return describeFailure(error, "start").title;
}
