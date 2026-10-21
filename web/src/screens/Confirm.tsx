/*
 * S2 읽은 내용 확인. 설계서 6절 S2, 시안 S2(MfKqY)·S2-a~e·S2-M1, E2(CiczT).
 *
 * LLM이 문장에서 읽은 값을 사람이 보고 고친다. 이 프로젝트에서 가장 중요한 화면이다(G3) — 실물 LLM이
 * '경기도'를 지방으로, '원룸 알아보는 중'을 재개발 세입자로 읽은 적이 있다. 이 화면은 값을 짐작하거나
 * 채우지 않는다. 빈칸은 빈칸으로 둔다(G5).
 *
 * 들어오면
 * 1. 항목 목록(GET /v1/fields)과 세션 상태(GET /v1/sessions/:id)를 함께 받는다. 항목 이름·종류·선택지는
 *    서버가 정본이다(설계서 7.1). 값과 그 출처(LLM/USER)·근거 구절도 서버 세션에서 읽는다
 * 2. 경고(개인정보)와 못 쓴 값(unreadable)은 서버가 저장하지 않는 값이라 S1이 라우터 state로 넘긴다.
 *    새로 고치거나 주소로 바로 오면 없다 — 그때는 경고 없이 그린다(오류가 아님)
 * 3. '문장에서 읽은 항목' = LLM이 읽은 값 + 못 쓴 값(설계서 S2 구성 4). 앞서 직접 넣고 돌아온 값(USER)은
 *    '직접 넣은 항목'으로 따로 센다 — 문장에서 읽은 것이 아니다. 나머지는 접힌 '비어 있는 항목' 안에
 *
 * 확인했습니다 — 다음
 * - 바뀐 값만 보낸다(confirmValues.ts). 바뀐 게 없으면 서버를 부르지 않고 바로 S3로
 * - 서버가 거절하면(422) 이 화면에 머물고 사유를 칸 아래와 버튼 위 목록에 보인다
 * - 칸에 입력 오류가 있거나 서버에 연결되지 않았으면 잠기고, 잠긴 이유를 버튼 아래에 적는다
 * - 기다리는 동안 두 번 누름은 버튼과 busy가 막는다. 그사이 화면을 떠났으면 늦게 온 답은 버린다(useAlive)
 *
 * ← 문장 다시 쓰기: 고친 값이 있으면 확인 창(M1), 없으면 바로 S1. 적은 문장은 앱 메모리에 있어 그대로 남는다.
 * 서버 세션은 지우지 않는다 — 이 탭에서 연 세션 목록에 있어 '내 기록 지우기'로 지울 수 있다(AppState.tsx).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { FieldCatalog, HeldValue } from "../api/types";
import { Skeleton, SystemError } from "../components/Feedback";
import { useAlive, useAppState } from "./AppState";
import { ConfirmForm } from "./ConfirmForm";
import type { ConfirmState } from "./routes";
import screen from "./Screen.module.css";
import styles from "./Confirm.module.css";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; catalog: FieldCatalog; held: Record<string, HeldValue> }
  /** 세션이 없음(404) — E2 */
  | { kind: "missing" }
  /** 받다가 서버에 연결되지 않음 — 맨 위 E1 상자 하나로 알린다 */
  | { kind: "offline" }
  /** heldKnown: 세션 상태는 받았는가. 받았을 때만 "읽은 값은 서버에 있다"고 말할 수 있다 */
  | { kind: "failed"; what: "fields" | "session"; error: unknown; heldKnown: boolean };

const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
const isNetwork = (e: unknown) => e instanceof ApiError && e.kind === "network";

export function Confirm() {
  const { sessionId = "" } = useParams();
  const { state } = useLocation();
  const notes = (state as ConfirmState | null) ?? null;
  const { connected, recheckConnection, lostConnection } = useAppState();
  const alive = useAlive();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // 다시 시도를 거듭 눌렀을 때 앞선 요청의 늦은 답이 뒤 답을 덮지 않게
  const seq = useRef(0);

  const fetchAll = useCallback(async () => {
    const mine = ++seq.current;
    setLoad({ kind: "loading" });
    const [fields, session] = await Promise.allSettled([api.fields(), api.session(sessionId)]);
    if (!alive.current || mine !== seq.current) return;
    const errors = [fields, session].flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    if (session.status === "rejected" && isNotFound(session.reason)) setLoad({ kind: "missing" });
    else if (errors.some(isNetwork)) {
      lostConnection();
      setLoad({ kind: "offline" });
    } else if (fields.status === "rejected") {
      setLoad({ kind: "failed", what: "fields", error: fields.reason, heldKnown: session.status === "fulfilled" });
    } else if (session.status === "rejected") {
      setLoad({ kind: "failed", what: "session", error: session.reason, heldKnown: false });
    } else setLoad({ kind: "ready", catalog: fields.value.fields, held: session.value.values });
  }, [sessionId, alive, lostConnection]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  if (load.kind === "missing") return <Missing />;

  const offline = connected === false || load.kind === "offline";
  async function reconnect() {
    await recheckConnection();
    if (load.kind !== "ready") await fetchAll();
  }

  return (
    <>
      {offline && (
        <SystemError title="지금 판정 서버에 연결할 수 없습니다" retryLabel="다시 연결 확인" onRetry={reconnect}>
          <span className={styles.line}>조건의 문제가 아닙니다.</span>
          {load.kind === "ready" && <span className={styles.line}>고치신 값은 화면에 그대로 있습니다.</span>}
        </SystemError>
      )}
      <section className={screen.heading}>
        <span className={screen.eyebrow}>읽은 내용 확인</span>
        <h1 className={screen.title}>이렇게 읽었습니다</h1>
        <p className={screen.lead}>
          틀린 곳이 있으면 고쳐 주세요. 고치지 않고 넘어가면 읽은 값 그대로 씁니다. 판정에 더 필요한 것은 다음
          단계에서 하나씩 여쭙니다.
        </p>
      </section>
      {load.kind === "loading" && <Skeleton />}
      {/* 연결이 끊겼으면 위 상자 하나만. 두 상자가 함께 뜨면 둘 다 초점을 제목으로 끌어가 서로 다투고,
          '다시 연결 확인'이 연결이 돌아온 뒤 목록도 다시 받으므로 아래 상자의 '다시 시도'는 같은 일을 두 번 권한다 */}
      {load.kind === "failed" && !offline && (
        <LoadFailed what={load.what} error={load.error} heldKnown={load.heldKnown} onRetry={fetchAll} />
      )}
      {load.kind === "ready" && (
        <ConfirmForm
          sessionId={sessionId}
          catalog={load.catalog}
          held={load.held}
          warnings={notes?.warnings ?? []}
          unreadable={notes?.unreadable ?? {}}
          offline={offline}
          onMissing={() => setLoad({ kind: "missing" })}
        />
      )}
    </>
  );
}

/** 항목 목록이나 세션 상태를 못 받음(시안 S2-e). 칸 없이 그리면 사용자가 채운 것이 어디로 가는지 알 수 없어 화면을 그리지 않는다 */
function LoadFailed({
  what,
  error,
  heldKnown,
  onRetry,
}: {
  what: "fields" | "session";
  error: unknown;
  heldKnown: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <SystemError
      title={what === "fields" ? "항목 목록을 받지 못했습니다" : "읽은 내용을 불러오지 못했습니다"}
      icon="alertCircle"
      onRetry={onRetry}
    >
      <span className={styles.line}>조건의 문제가 아닙니다. 잠시 뒤 다시 시도해 주세요.</span>
      {/* 세션 조회가 실패했으면(500 등) 서버에 값이 남아 있는지 이 화면은 모른다. 확인하지 않은 말은 하지 않는다(G12) */}
      {heldKnown && <span className={styles.line}>읽은 값은 서버에 그대로 있습니다.</span>}
      {/* 서버가 준 사유는 그대로(설계서 상태 표 '(사유)'). 시간 초과는 위 문장으로 충분하다 */}
      {error instanceof ApiError && error.kind === "http" && <span className={styles.line}>사유: {error.message}</span>}
    </SystemError>
  );
}

/** 세션을 찾을 수 없음(E2). 다시 시도해도 같으므로 '처음부터'가 유일한 길이다. 적은 문장은 남긴다 */
function Missing() {
  const navigate = useNavigate();
  const { draft } = useAppState();
  return (
    <SystemError
      title="이전 확인 기록을 찾을 수 없습니다"
      icon="fileX"
      retryLabel="처음부터"
      retryVariant="primary"
      onRetry={() => navigate("/write")}
    >
      <span className={styles.line}>처음부터 다시 시작해 주세요. 조건의 문제가 아닙니다.</span>
      {/* 새로 고친 뒤라면 앱 메모리의 문장도 이미 없다. 없는 것을 '두었습니다'라고 하지 않는다 */}
      {draft.trim() !== "" && <span className={styles.line}>적어 두신 문장은 그대로 두었습니다.</span>}
    </SystemError>
  );
}
