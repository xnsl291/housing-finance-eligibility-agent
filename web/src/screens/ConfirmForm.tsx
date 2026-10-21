/*
 * S2 읽은 내용 확인의 본문 — 항목 칸, 근거 줄, 보내기. 받은 것을 그리는 일만 하고, 받는 일은 Confirm.tsx가 한다.
 * 무엇을 보내고 근거 줄을 어떻게 고르는지는 Confirm.tsx 머리말과 confirmValues.ts. 칸 조각은 ConfirmFields.tsx.
 *
 * 나눔: useEdits = 무엇을 고쳤고 무엇이 틀렸나(상태) / useSubmit = 보내기와 결과 / ConfirmForm = 줄 그리기 /
 * Actions = 버튼 줄과 확인 창.
 *
 * 칸의 값은 칸마다 '처음 값'(서버 세션의 값, 없으면 null)과 '지금 값'으로 나눠 든다. 사용자가 손댄 칸만
 * edits에 들어가고, 보낼 때 처음 값과 비교해 달라진 것만 고른다. 고쳤다가 처음 값으로 되돌린 칸은 보내지 않는다.
 */
import { useRef, useState, type FocusEvent } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { FieldCatalog, HeldValue } from "../api/types";
import { afterPress } from "../components/afterPress";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SystemError } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { ReadItemRow } from "../components/ReadItemRow";
import { useAlive, useAppState } from "./AppState";
import { EmptyFields, ErrorList, FieldInput, provenanceOf, type Rejection } from "./ConfirmFields";
import { changedValues, showValue, splitRejection, type Value } from "./confirmValues";
import { describeFailure, type FailureText } from "./failure";
import { sessionPath } from "./routes";
import styles from "./Confirm.module.css";

interface Edit {
  value: Value;
  /** 칸이 알린 입력 오류(금액을 못 읽음, 범위 최소>최대 등). 있으면 보내기가 잠긴다 */
  problem: string | null;
}

interface ConfirmFormProps {
  sessionId: string;
  catalog: FieldCatalog;
  held: Record<string, HeldValue>;
  warnings: string[];
  unreadable: Record<string, string>;
  offline: boolean;
  /** 보내다가 세션이 없다는 답(404)을 받음 → E2 */
  onMissing: () => void;
}

export function ConfirmForm({ sessionId, catalog, held, warnings, unreadable, offline, onMissing }: ConfirmFormProps) {
  const e = useEdits(catalog, held);
  // 앞서 직접 넣고 돌아온 값(USER)은 '문장에서 읽은 항목'에 세지 않고 따로 묶는다. 같이 세면 제목이 문장에서
  // 읽은 수보다 큰 수를 말한다
  const userNames = e.names.filter((n) => held[n]?.source === "USER");
  const readNames = e.names.filter((n) => (n in held || n in unreadable) && !userNames.includes(n));
  const emptyNames = e.names.filter((n) => !readNames.includes(n) && !userNames.includes(n));
  const lockedReason = offline ? "서버에 연결되지 않아 지금은 보낼 수 없습니다." : e.inputLock;
  const { submit, failure } = useSubmit(sessionId, catalog, e, Boolean(lockedReason), onMissing);

  const field = (name: string) => (
    <FieldInput
      info={catalog[name]}
      initial={e.base(name)}
      value={e.current(name)}
      error={e.rejection?.byField[name] ?? null}
      onChange={e.update(name)}
    />
  );
  // S3에서 뒤로 오면 라우터 state(못 쓴 원문)가 남아 있다. 그 사이 직접 넣은 값이 있으면 경고는 지난 일이다
  const warnOf = (name: string) => (held[name]?.source === "USER" ? undefined : unreadable[name]);
  const row = (name: string) => (
    <ReadItemRow
      key={name}
      label={catalog[name].label}
      value={showValue(catalog[name], e.current(name))}
      // 못 쓴 원문 줄의 빈 값은 사용자가 모른다고 한 것이 아니다
      emptyLabel={name in unreadable && !held[name] ? "(비어 있음)" : undefined}
      problem={e.hasProblem(name)}
      provenance={
        <>
          {/* 근거 줄 위에 '그대로 쓸 수 없는 원문' 경고(Streamlit confirm.py와 같은 문구). 칸은 빈 채로 둔다 */}
          {warnOf(name) !== undefined && (
            <p className={styles.unreadable}>
              <Icon name="alertTriangle" size={14} />
              {catalog[name].label}: “{warnOf(name)}”은 그대로 쓸 수 없습니다. 직접 넣어 주세요
            </p>
          )}
          {provenanceOf(catalog[name], held[name], e.current(name), e.problemNames.includes(name))}
        </>
      }
      // 줄 머리에 이름표가 이미 있어 칸의 이름표는 눈에서만 감춘다(화면 읽기 프로그램은 그대로 읽음)
      editor={
        <div className={styles.editor} onBlur={e.leave(name)}>
          {field(name)}
        </div>
      }
    />
  );
  const group = (id: string, title: string, list: string[]) =>
    list.length > 0 && (
      <section className={styles.read} aria-labelledby={id}>
        <h2 id={id} className={styles.sectionLabel}>
          {title} <span className={styles.count}>{list.length}개</span>
        </h2>
        {list.map(row)}
      </section>
    );

  return (
    <>
      {warnings.map((w) => (
        <p key={w} className={styles.warning}>
          <Icon name="lock" size={16} />
          {w}
        </p>
      ))}
      {group("s2-read", "문장에서 읽은 항목", readNames)}
      {group("s2-user", "직접 넣은 항목", userNames)}
      <EmptyFields
        count={emptyNames.length}
        forceOpen={emptyNames.some(e.hasProblem)}
        fields={emptyNames.map((name) => (
          <div key={name} onBlur={e.leave(name)}>
            {field(name)}
          </div>
        ))}
      />
      <ErrorList problems={e.problems} rejection={e.rejection} catalog={catalog} />
      <Actions
        // 연결 안 됨은 맨 위 E1 상자가, 422는 칸과 목록이 알린다. 그 밖의 실패(시간 초과·서버 오류)만 버튼 위 상자로
        failure={failure}
        lockedReason={lockedReason}
        dirty={Object.keys(e.changes).length > 0 || e.problemNames.length > 0}
        onSubmit={submit}
      />
    </>
  );
}

/**
 * 사용자가 손댄 칸과 틀린 곳(입력 오류·서버 거절·목록에 올린 오류). 화면 그리기·보내기와 떼어 둔 상태 묶음.
 * 칸의 값은 처음 값(base)과 지금 값(current)으로 나눠 들고, 보낼 것(changes)은 둘을 비교해 고른다.
 */
function useEdits(catalog: FieldCatalog, held: Record<string, HeldValue>) {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [rejection, setRejection] = useState<Rejection | null>(null);
  /** 칸을 떠날 때 버튼 위 목록에 올린 입력 오류(이름 → 그때의 문구) */
  const [listed, setListed] = useState<Record<string, string>>({});

  const names = Object.keys(catalog);
  const base = (name: string): Value => held[name]?.value ?? null;
  const current = (name: string): Value => (name in edits ? edits[name].value : base(name));
  const changes = changedValues(
    Object.fromEntries(names.map((n) => [n, base(n)])),
    Object.fromEntries(Object.entries(edits).map(([n, x]) => [n, x.value])),
  );
  // 버튼 잠김은 지금 칸의 문제로 바로 정한다. 버튼 위 목록은 칸을 떠난 뒤의 문제(listed)만 싣는다 — 칸 아래 오류
  // 줄과 같은 때에 바뀌어야, 치는 동안 글자마다 목록이 바뀌어 읽히지 않는다. 고쳐진 칸은 목록에서 바로 걷는다
  // (걷는 것은 읽지 않으므로 시끄럽지 않고, 버튼이 풀렸는데 목록이 '고쳐야 한다'고 남지 않게)
  const problemNames = names.filter((n) => edits[n]?.problem);
  const problems = problemNames.flatMap((n) => (n in listed ? [`${catalog[n].label}: ${listed[n]}`] : []));
  const inputLock =
    problemNames.length === 0
      ? undefined
      : problemNames.every((n) => n in listed)
        ? "위 입력 오류를 고치면 눌러집니다."
        : // 아직 목록에 없는 오류를 '위 입력 오류'라고 부르지 않는다
          "지금 적고 있는 칸에 고칠 것이 있습니다.";

  /** 칸(묶음)을 떠날 때 그 칸의 문제를 목록에 올리거나 걷는다. 마우스를 누르는 중이면 뗀 뒤에(afterPress.ts) */
  const leave = (name: string) => (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    const problem = edits[name]?.problem ?? null;
    afterPress(() =>
      setListed((all) => {
        const next = { ...all };
        if (problem) next[name] = problem;
        else delete next[name];
        return next;
      }),
    );
  };

  const update = (name: string) => (value: Value, problem: string | null = null) => {
    setEdits((all) => ({ ...all, [name]: { value, problem } }));
    // 고친 칸의 서버 사유는 지난 값에 대한 것이 된다
    setRejection((r) => {
      if (!r || !(name in r.byField)) return r;
      const byField = { ...r.byField };
      delete byField[name];
      return Object.keys(byField).length === 0 && r.rest.length === 0 ? null : { ...r, byField };
    });
  };

  const hasProblem = (name: string) => Boolean(edits[name]?.problem || rejection?.byField[name]);
  return { names, base, current, changes, problemNames, problems, inputLock, rejection, setRejection, leave, update, hasProblem };
}

/**
 * 확인했습니다 — 바뀐 값만 보내고 결과에 따라 S3로 가거나(성공) 이 화면에 머문다. 422는 칸별 사유로,
 * 404는 E2로, 연결 안 됨은 맨 위 E1 상자로, 그 밖의 실패(시간 초과·서버 오류)만 버튼 위 상자(failure)로 알린다
 */
type EditsForSubmit = Pick<ReturnType<typeof useEdits>, "changes" | "setRejection">;
function useSubmit(sessionId: string, catalog: FieldCatalog, e: EditsForSubmit, locked: boolean, onMissing: () => void) {
  const navigate = useNavigate();
  const { lostConnection } = useAppState();
  const alive = useAlive();
  const [failure, setFailure] = useState<{ id: number; error: unknown } | null>(null);
  // 상태는 다시 그려진 뒤에야 바뀌므로 같은 순간 두 번 누름은 ref로 막는다
  const busy = useRef(false);

  async function submit() {
    if (busy.current || locked) return;
    const next = sessionPath(sessionId, "questions");
    if (Object.keys(e.changes).length === 0) {
      navigate(next);
      return;
    }
    busy.current = true;
    setFailure(null);
    // 앞선 거절 사유는 지난번에 보낸 값에 대한 것이다. 이번 답이 500 등이면 낡은 사유가 새 실패와 함께 남는다
    e.setRejection(null);
    try {
      await api.setFields(sessionId, e.changes);
      if (alive.current) navigate(next);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 422) {
        e.setRejection(splitRejection(error.message, Object.keys(e.changes), catalog));
      } else if (error instanceof ApiError && error.status === 404) onMissing();
      else if (error instanceof ApiError && error.kind === "network") lostConnection();
      else setFailure((f) => ({ id: (f?.id ?? 0) + 1, error }));
    } finally {
      busy.current = false;
    }
  }

  return { submit, failure: failure && { id: failure.id, text: describeFailure(failure.error, "start") } };
}

/** 버튼 줄(확인했습니다·문장 다시 쓰기)과 그 위 실패 상자, 문장 다시 쓰기 확인 창(M1) */
function Actions({
  failure,
  lockedReason,
  dirty,
  onSubmit,
}: {
  failure: { id: number; text: FailureText } | null;
  lockedReason: string | undefined;
  /** 고친 값이나 입력 오류가 있는가. 있으면 문장 다시 쓰기 전에 확인 창을 띄운다 */
  dirty: boolean;
  onSubmit: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [askBack, setAskBack] = useState(false);
  return (
    <>
      <section className={styles.actions} aria-label="확인">
        {failure && (
          <SystemError key={failure.id} title={failure.text.title} icon={failure.text.icon} onRetry={onSubmit}>
            <span className={styles.line}>{failure.text.body}</span>
            <span className={styles.line}>고치신 값은 화면에 그대로 있습니다.</span>
          </SystemError>
        )}
        <div className={styles.buttons}>
          <Button lockedReason={lockedReason} onClick={onSubmit}>
            확인했습니다 — 다음
          </Button>
          <span className={styles.back}>
            <Button variant="text" icon="arrowLeft" onClick={() => (dirty ? setAskBack(true) : navigate("/write"))}>
              문장 다시 쓰기
            </Button>
          </span>
        </div>
        <p className={styles.hint}>
          바뀐 값만 서버에 보냅니다. 그대로 둔 값을 다시 보내면 출처가 '문장에서 읽음'에서 '직접 넣음'으로 바뀌어
          기록이 사실과 달라집니다.
        </p>
      </section>

      <ConfirmDialog
        open={askBack}
        title="처음부터 다시 할까요?"
        confirmLabel="처음부터"
        cancelLabel="계속하기"
        onConfirm={() => {
          setAskBack(false);
          navigate("/write");
        }}
        onCancel={() => setAskBack(false)}
      >
        {/* 설계서 M1 문구는 S3·S4와 같이 쓰는 것이라 '답한 내용'이 들어 있다. S2에는 아직 답한 것이 없어
            이 화면에서 사라지는 것만 적는다. 실제로 S1로 가면 이 화면의 칸(고친 값)은 보내지 않고 버려지고,
            문장은 앱 메모리(AppState의 draft)에 있어 S1 칸에 그대로 남는다 */}
        이 화면에서 고친 값이 사라집니다. 적어 두신 문장은 남습니다.
      </ConfirmDialog>
    </>
  );
}
