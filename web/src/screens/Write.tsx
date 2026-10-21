/*
 * S1 조건 입력. 설계서 6절 S1, 시안 S1(vTRQ5)·S1-a~f·S1-M3.
 *
 * 자유 문장을 받아 서버에 보낸다. 이 화면은 아무것도 판단하지 않는다 — 문장을 훑어 값을 짐작하거나
 * 빠진 항목을 채우면 사용자는 자기가 쓰지 않은 조건으로 판정받는다.
 *
 * 적은 문장은 앱 메모리(AppState)에만 둔다. 실패해도, S2에서 돌아와도 지우지 않는다. 다시 쓰게
 * 만들면 사용자는 짧게 쓰고, 짧게 쓰면 '정보 부족'으로 떨어진다.
 *
 * 조건 읽기
 * 1. 세션을 새로 연다. 문장을 읽을 때마다 새로 연다 — 앞 문장으로 모인 값과 '모르겠다'가 새 판정에
 *    섞이지 않게(설계서 S1). 실패한 뒤 다시 눌러도 새 세션이다. 앞서 연 세션을 여기서 지우지는 않는다.
 *    비어 있다고 장담할 수 없어서다 — 시간 초과로 화면이 기다림을 끊어도 서버는 끝까지 읽어 값을 저장할
 *    수 있다. 대신 번호를 받는 즉시 앱 메모리에 모아 '내 기록 지우기'가 함께 지우게 한다(AppState.tsx)
 * 2. 기다리는 동안 '문장을 읽고 있습니다'. 10초가 넘으면 한 줄 더(LoadingSentence)
 * 3. 문장을 보낸다
 * 4. 성공하면 S2로. 경고와 못 읽은 값은 서버에 남지 않는 값이라 라우터 state로 넘긴다
 *
 * 실패는 종류별로 다르게 말한다(failure.ts). 어느 경우든 적어 둔 문장이 그대로 있다고 덧붙인다.
 *
 * 기다리는 동안 사용자가 전체 초기화·뒤로 가기로 이 화면을 떠날 수 있다. 그 뒤에 온 답으로 S2로 끌고
 * 가거나 상태를 바꾸지 않는다(alive). 요청을 끊지는 않는다 — 끊어도 서버는 끝까지 일하므로 얻는 것이 없다.
 * 열린 세션 번호는 떠났어도 이미 앱 메모리에 모였으므로 '내 기록 지우기'로 지울 수 있다.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingSentence, SystemError } from "../components/Feedback";
import { FieldFrame } from "../components/Field";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { useAppState } from "./AppState";
import { describeFailure, inputRejection, type Stage } from "./failure";
import { sessionPath, type ConfirmState } from "./routes";
import screen from "./Screen.module.css";
import styles from "./Write.module.css";

// 서버 기본 상한과 같은 값(api.py `_DEFAULT_MAX_MESSAGE_CHARS`). 서버가 상한을 내려 주지 않아 화면이
// 따로 든다. 화면에서 막는 것은 긴 글을 다 쓰고 거절당하지 않게 하려는 것이고, 진짜 상한은 서버가 지킨다
const MAX_CHARS = 1000;

// 정본: `ui/screens/input.py` EXAMPLES. 주민번호·계좌·주소는 넣지 않는다 — 예시가 곧 입력 요구로 읽힌다
export const EXAMPLES = [
  {
    name: "혼자 사는 직장인",
    text: "만 29세 직장인이고 무주택 세대주입니다. 연봉은 4천만원이고 서울에서 보증금 1억8천짜리 전셋집을 구하고 있습니다.",
  },
  {
    name: "결혼 준비 중인 맞벌이",
    text: "결혼 2년차 맞벌이입니다. 부부합산 소득은 6천만원쯤 되고 경기도 성남에서 전세 2억5천 아파트를 알아보는 중입니다. 자녀는 없습니다.",
  },
] as const;

const KEEP_DRAFT = "적어 두신 문장은 그대로 있습니다. 다시 쓰지 않으셔도 됩니다.";

/** 서버(파이썬 len)와 같게 글자를 센다. JS의 length는 이모지 같은 글자를 둘로 센다 */
function countChars(text: string): number {
  return [...text].length;
}

const n = (value: number) => value.toLocaleString("ko-KR");

interface Failure {
  /** 같은 실패가 거듭되면 오류 상자를 새로 그려 초점을 다시 제목으로 옮기려고 */
  id: number;
  error: unknown;
  stage: Stage;
  /** 무엇을 하다 실패했나. '다시 시도'가 같은 일을 다시 한다 */
  action: "read" | "direct";
}

export function Write() {
  const navigate = useNavigate();
  const { draft, setDraft, rememberSession } = useAppState();
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pendingExample, setPendingExample] = useState<string | null>(null);
  // 상태는 다시 그려진 뒤에야 바뀌므로, 같은 순간 두 번 누름은 ref로 막는다
  const busy = useRef(false);
  // 이 화면이 떠 있는가. 떠난 뒤 온 답은 버린다(머리말)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const length = countChars(draft);
  const over = length - MAX_CHARS;
  const empty = draft.trim() === "";
  const lockedReason = empty
    ? "칸이 비어 있어 아직 보낼 수 없습니다. 한 문장이라도 적으면 눌러집니다."
    : over > 0
      ? `${n(MAX_CHARS)}자를 넘어 아직 보낼 수 없습니다.`
      : undefined;

  function fail(error: unknown, stage: Stage, action: Failure["action"]) {
    setFailure((f) => ({ id: (f?.id ?? 0) + 1, error, stage, action }));
  }

  async function read() {
    if (busy.current || lockedReason) return;
    busy.current = true;
    setFailure(null);
    setReading(true);
    let stage: Stage = "start";
    try {
      const { session_id } = await api.startSession();
      rememberSession(session_id);
      stage = "read";
      const result = await api.sendMessage(session_id, draft);
      if (!alive.current) return;
      const state: ConfirmState = { warnings: result.warnings, unreadable: result.unreadable };
      navigate(sessionPath(session_id, "confirm"), { state });
    } catch (error) {
      if (alive.current) fail(error, stage, "read");
    } finally {
      busy.current = false;
      if (alive.current) setReading(false);
    }
  }

  // 문장 없이 시작(S1-F). 읽은 값이 없으니 S2를 건너뛰고 바로 질문으로(Q8)
  async function startDirect() {
    if (busy.current) return;
    busy.current = true;
    try {
      const { session_id } = await api.startSession();
      rememberSession(session_id);
      if (alive.current) navigate(sessionPath(session_id, "questions"));
    } catch (error) {
      if (alive.current) fail(error, "start", "direct");
    } finally {
      busy.current = false;
    }
  }

  function pickExample(text: string) {
    if (draft.trim() === "") setDraft(text);
    else if (draft !== text) setPendingExample(text);
  }

  function edit(text: string) {
    setDraft(text);
    // 고쳐 쓰면 앞 실패 안내는 지난 문장에 대한 것이 된다. 걷고 '조건 읽기'를 다시 보인다
    setFailure(null);
  }

  // 422는 입력 오류라 칸 아래에(C-ERROR). 그 밖의 실패만 시스템 오류 상자로
  const rejected = failure && inputRejection(failure.error);
  const text = failure && !rejected && describeFailure(failure.error, failure.stage);

  return (
    <>
      <section className={screen.heading}>
        <span className={screen.eyebrow}>조건 입력</span>
        <h1 className={screen.title}>상황을 문장으로 적어 주세요</h1>
        <p className={screen.lead}>
          읽은 내용은 다음 화면에서 직접 확인하고 고칠 수 있고, 판정에 더 필요한 것은 그다음에 하나씩 여쭙니다.
        </p>
      </section>

      {/* 입력 칸보다 먼저. 다 쓰고 나서 읽는 안내는 이미 늦다 */}
      <div className={styles.notice}>
        <Notice kind="input" />
      </div>

      <section className={styles.examples} aria-labelledby="s1-examples">
        <h2 id="s1-examples" className={styles.examplesLabel}>
          이렇게 적으면 됩니다
        </h2>
        <div className={styles.exampleRow}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.name}
              type="button"
              className={styles.example}
              disabled={reading}
              onClick={() => pickExample(ex.text)}
            >
              <span className={styles.exampleName}>
                <Icon name="cornerDownLeft" size={14} />
                {ex.name}
              </span>
              <span className={styles.exampleText}>{ex.text}</span>
            </button>
          ))}
        </div>
      </section>

      <FieldFrame
        label="상황을 자유롭게 적어 주세요"
        error={over > 0 ? `${n(MAX_CHARS)}자까지 보낼 수 있습니다. ${n(over)}자 줄여 주세요` : rejected}
      >
        {(a) => (
          <div className={styles.inputArea}>
            <textarea
              id={a.id}
              className={styles.textarea}
              aria-describedby={[a.describedBy, `${a.id}-count`].filter(Boolean).join(" ")}
              aria-invalid={a.invalid || undefined}
              placeholder="나이, 소득, 무주택 여부, 지역, 보증금을 적어 주시면 읽을 수 있는 항목이 많아집니다."
              value={draft}
              readOnly={reading}
              onChange={(e) => edit(e.target.value)}
            />
            <span id={`${a.id}-count`} className={`${styles.count} num`} data-over={over > 0 || undefined}>
              {over > 0
                ? `${n(length)} / ${n(MAX_CHARS)}자`
                : `${n(length)} / ${n(MAX_CHARS)}자 (남은 글자 ${n(MAX_CHARS - length)})`}
            </span>
          </div>
        )}
      </FieldFrame>

      <section className={styles.actions} aria-label="보내기">
        {reading ? (
          <LoadingSentence label="문장을 읽고 있습니다" />
        ) : failure && text ? (
          <>
            <SystemError key={failure.id} title={text.title} icon={text.icon} onRetry={failure.action === "read" ? read : startDirect}>
              {/* 서버가 준 문구는 마침표 없이 끝나기도 해서 한 줄로 이어 붙이지 않고 줄을 나눈다 */}
              <span className={styles.line}>{text.body}</span>
              <span className={styles.line}>{KEEP_DRAFT}</span>
            </SystemError>
            {text.direct && (
              <>
                <p className={styles.hint}>
                  직접 입력으로 넘어가면 읽은 값 없이 시작합니다. 확인할 것이 없으므로 '읽은 내용 확인'은 건너뛰고 바로
                  질문으로 갑니다.
                </p>
                <div>
                  <Button variant={text.direct} busyLabel="여는 중" onClick={startDirect}>
                    직접 입력으로 넘어가기
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <Button lockedReason={lockedReason} onClick={read}>
              조건 읽기
            </Button>
            {!lockedReason && <p className={styles.hint}>누르면 문장을 서버로 보냅니다.</p>}
          </>
        )}
      </section>

      <ConfirmDialog
        open={pendingExample !== null}
        title="적어 두신 문장을 예시로 바꿀까요?"
        confirmLabel="바꾸기"
        cancelLabel="취소"
        onConfirm={() => {
          if (pendingExample !== null) edit(pendingExample);
          setPendingExample(null);
        }}
        onCancel={() => setPendingExample(null)}
      >
        지금 칸에 있는 글이 예시 문장으로 바뀝니다. 되돌리려면 다시 적어야 합니다.
      </ConfirmDialog>
    </>
  );
}
