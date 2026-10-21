/*
 * S2 읽은 내용 확인의 본문 — 항목 칸, 근거 줄, 보내기. 받은 것을 그리는 일만 하고, 받는 일은 Confirm.tsx가 한다.
 * 무엇을 보내고 근거 줄을 어떻게 고르는지는 Confirm.tsx 머리말과 confirmValues.ts.
 *
 * 칸의 값은 칸마다 '처음 값'(서버 세션의 값, 없으면 null)과 '지금 값'으로 나눠 든다. 사용자가 손댄 칸만
 * edits에 들어가고, 보낼 때 처음 값과 비교해 달라진 것만 고른다. 고쳤다가 처음 값으로 되돌린 칸은 보내지 않는다.
 *
 * 칸 종류(설계서 7.2 S2 열): 선택=드롭다운 첫 칸 `— 모름 —`, 예·아니오=라디오 `예/아니오/모름`(G4),
 * 금액=만원 칸 + 억·만, 범위로 읽혔으면 최소·최대 두 칸, 날짜=달력, 정수·소수·글=칸.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import type { FieldCatalog, FieldInfo, HeldValue } from "../api/types";
import { AmountField, RangeField } from "../components/AmountFields";
import { Button } from "../components/Button";
import { YesNoField, type YesNo } from "../components/ChoiceFields";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SystemError } from "../components/Feedback";
import { DateField, NumberField, SelectField, TextField } from "../components/Field";
import { Icon } from "../components/Icon";
import { Provenance } from "../components/Provenance";
import { ReadItemRow } from "../components/ReadItemRow";
import { useAlive, useAppState } from "./AppState";
import { changedValues, isRange, sameValue, showValue, splitRejection, type Value } from "./confirmValues";
import { describeFailure } from "./failure";
import { sessionPath } from "./routes";
import styles from "./Confirm.module.css";

interface Edit {
  value: Value;
  /** 칸이 알린 입력 오류(금액을 못 읽음, 범위 최소>최대 등). 있으면 보내기가 잠긴다 */
  problem: string | null;
}

/** 서버가 거절한 사유. byField는 칸 아래로, rest는 어느 칸인지 못 정해 버튼 위 목록에만 */
interface Rejection {
  byField: Record<string, string>;
  rest: string[];
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
  const navigate = useNavigate();
  const { lostConnection } = useAppState();
  const alive = useAlive();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [failure, setFailure] = useState<{ id: number; error: unknown } | null>(null);
  const [askBack, setAskBack] = useState(false);
  // 상태는 다시 그려진 뒤에야 바뀌므로 같은 순간 두 번 누름은 ref로 막는다
  const busy = useRef(false);

  const names = Object.keys(catalog);
  const readNames = names.filter((n) => n in held || n in unreadable);
  const emptyNames = names.filter((n) => !readNames.includes(n));
  const base = (name: string): Value => held[name]?.value ?? null;
  const current = (name: string): Value => (name in edits ? edits[name].value : base(name));

  const changes = changedValues(
    Object.fromEntries(names.map((n) => [n, base(n)])),
    Object.fromEntries(Object.entries(edits).map(([n, e]) => [n, e.value])),
  );
  const problems = Object.entries(edits).flatMap(([n, e]) => (e.problem ? [`${catalog[n].label}: ${e.problem}`] : []));
  const dirty = Object.keys(changes).length > 0 || problems.length > 0;
  const lockedReason = offline
    ? "서버에 연결되지 않아 지금은 보낼 수 없습니다."
    : problems.length > 0
      ? "위 입력 오류를 고치면 눌러집니다."
      : undefined;

  function update(name: string) {
    return (value: Value, problem: string | null = null) => {
      setEdits((all) => ({ ...all, [name]: { value, problem } }));
      // 고친 칸의 서버 사유는 지난 값에 대한 것이 된다
      setRejection((r) => {
        if (!r || !(name in r.byField)) return r;
        const byField = { ...r.byField };
        delete byField[name];
        return Object.keys(byField).length === 0 && r.rest.length === 0 ? null : { ...r, byField };
      });
    };
  }

  async function submit() {
    if (busy.current || lockedReason) return;
    const next = sessionPath(sessionId, "questions");
    if (Object.keys(changes).length === 0) {
      navigate(next);
      return;
    }
    busy.current = true;
    setFailure(null);
    // 앞선 거절 사유는 지난번에 보낸 값에 대한 것이다. 이번 답이 500 등이면 낡은 사유가 새 실패와 함께 남는다
    setRejection(null);
    try {
      await api.setFields(sessionId, changes);
      if (alive.current) navigate(next);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 422) {
        setRejection(splitRejection(error.message, Object.keys(changes), catalog));
      } else if (error instanceof ApiError && error.status === 404) onMissing();
      else if (error instanceof ApiError && error.kind === "network") lostConnection();
      else setFailure((f) => ({ id: (f?.id ?? 0) + 1, error }));
    } finally {
      busy.current = false;
    }
  }

  const field = (name: string) => (
    <FieldInput
      info={catalog[name]}
      initial={base(name)}
      value={current(name)}
      error={rejection?.byField[name] ?? null}
      onChange={update(name)}
    />
  );
  // 연결 안 됨은 맨 위 E1 상자가, 422는 칸과 목록이 알린다. 그 밖의 실패(시간 초과·서버 오류)만 버튼 위 상자로
  const failText = failure && describeFailure(failure.error, "start");
  const hasProblem = (name: string) => Boolean(edits[name]?.problem || rejection?.byField[name]);

  return (
    <>
      {warnings.map((w) => (
        <p key={w} className={styles.warning}>
          <Icon name="lock" size={16} />
          {w}
        </p>
      ))}

      {readNames.length > 0 && (
        <section className={styles.read} aria-labelledby="s2-read">
          <h2 id="s2-read" className={styles.sectionLabel}>
            문장에서 읽은 항목 <span className={styles.count}>{readNames.length}개</span>
          </h2>
          {readNames.map((name) => (
            <ReadItemRow
              key={name}
              label={catalog[name].label}
              value={showValue(catalog[name], current(name))}
              problem={hasProblem(name)}
              provenance={
                <RowNotes
                  label={catalog[name].label}
                  unreadable={unreadable[name]}
                  provenance={provenanceOf(catalog[name], held[name], current(name), Boolean(edits[name]?.problem))}
                />
              }
              // 줄 머리에 이름표가 이미 있어 칸의 이름표는 눈에서만 감춘다(화면 읽기 프로그램은 그대로 읽음)
              editor={<div className={styles.editor}>{field(name)}</div>}
            />
          ))}
        </section>
      )}

      <EmptyFields
        count={emptyNames.length}
        forceOpen={emptyNames.some(hasProblem)}
        fields={emptyNames.map((name) => (
          <div key={name}>{field(name)}</div>
        ))}
      />

      <ErrorList problems={problems} rejection={rejection} catalog={catalog} />

      <section className={styles.actions} aria-label="확인">
        {failure && failText && (
          <SystemError key={failure.id} title={failText.title} icon={failText.icon} onRetry={submit}>
            <span className={styles.line}>{failText.body}</span>
            <span className={styles.line}>고치신 값은 화면에 그대로 있습니다.</span>
          </SystemError>
        )}
        <div className={styles.buttons}>
          <Button lockedReason={lockedReason} onClick={submit}>
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

/**
 * 근거 한 줄(설계서 S2 '근거 한 줄' 표 다섯 경우 + 결함 D13의 '비움').
 * 고치는 중 칸에 입력 오류가 있으면 지금 값은 null이지만 비운 것이 아니다 — 고친 값으로 본다.
 */
function provenanceOf(info: FieldInfo, held: HeldValue | undefined, value: Value, problem: boolean): ReactNode {
  if (!held) return value === null && !problem ? null : <Provenance kind="direct" />;
  const changed = problem || !sameValue(value, held.value);
  const cleared = changed && value === null && !problem;
  if (held.source === "USER") return cleared ? <Provenance kind="cleared" was="direct" /> : <Provenance kind="direct" />;
  if (!changed) {
    return isRange(held.value) ? (
      <Provenance kind="range" phrase={held.phrase} range={showValue(info, held.value) ?? ""} />
    ) : (
      <Provenance kind="read" phrase={held.phrase} />
    );
  }
  if (cleared) return <Provenance kind="cleared" was="read" />;
  return <Provenance kind="edited" phrase={held.phrase} readValue={showValue(info, held.value) ?? ""} />;
}

/** 근거 줄 위에 '그대로 쓸 수 없는 원문' 경고(Streamlit confirm.py와 같은 문구). 칸은 빈 채로 둔다 */
function RowNotes({ label, unreadable, provenance }: { label: string; unreadable?: string; provenance: ReactNode }) {
  return (
    <>
      {unreadable !== undefined && (
        <p className={styles.unreadable}>
          <Icon name="alertTriangle" size={14} />
          {label}: “{unreadable}”은 그대로 쓸 수 없습니다. 직접 넣어 주세요
        </p>
      )}
      {provenance}
    </>
  );
}

interface FieldInputProps {
  info: FieldInfo;
  /** 서버에 있던 값. 숫자·금액 칸은 처음 그릴 때만 쓴다(칸이 글을 따로 든다) */
  initial: Value;
  value: Value;
  error: string | null;
  onChange: (value: Value, problem?: string | null) => void;
}

/** 종류별 칸 하나(설계서 7.2 S2 열). 숫자 칸은 빈 채로 시작한다 — 처음 값이 없으면 빈칸(G5) */
function FieldInput({ info, initial, value, error, onChange }: FieldInputProps) {
  const common = { label: info.label, help: info.how_to_check, error };
  switch (info.kind) {
    case "AMOUNT":
      // 범위로 읽힌 값은 범위로 둔다(G6). 한 숫자로 접으면 5천만원 기준을 근거 없이 통과한다
      return isRange(initial) ? (
        <RangeField label={info.label} defaultValue={initial} error={error} onChange={onChange} />
      ) : (
        <AmountField {...common} defaultWon={typeof initial === "number" ? initial : null} onChange={onChange} />
      );
    case "CHOICE":
      return (
        <SelectField
          {...common}
          value={value === null ? null : String(value)}
          options={(info.choices ?? []).map((c) => ({ value: c, label: info.choice_labels?.[c] ?? c }))}
          onChange={onChange}
        />
      );
    case "BOOL":
      return <BoolInput {...common} initial={typeof initial === "boolean" ? initial : null} onChange={onChange} />;
    case "DATE":
      return <DateField {...common} value={typeof value === "string" ? value : null} onChange={onChange} />;
    case "INT":
    case "FLOAT":
      return (
        <NumberField
          {...common}
          integer={info.kind === "INT"}
          defaultValue={typeof initial === "number" ? initial : null}
          onChange={onChange}
        />
      );
    default:
      return <TextInput {...common} initial={initial === null ? null : String(initial)} onChange={onChange} />;
  }
}

/**
 * 글 칸. 칸에는 친 그대로 두고, 값은 앞뒤 공백을 떼어 알린다 — 읽은 값 뒤에 공백만 붙인 것을 '고친 값'으로
 * 보내지 않게. 칸의 글까지 떼면(제어 값을 다듬으면) 낱말 사이 공백을 칠 수 없어 칸이 글을 따로 든다.
 * 빈칸만 친 것은 빈칸이다. 서버는 빈 글을 거절한다
 */
function TextInput({
  initial,
  onChange,
  ...common
}: {
  label: string;
  help?: string;
  error: string | null;
  initial: string | null;
  onChange: (value: Value) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <TextField
      {...common}
      value={text}
      onChange={(v) => {
        setText(v);
        const trimmed = v?.trim() ?? "";
        onChange(trimmed === "" ? null : trimmed);
      }}
    />
  );
}

/**
 * 예·아니오·모름. 모름과 아직 안 고름은 보낼 때 둘 다 null(모름)이지만, 칸에는 사용자가 고른 대로 보인다.
 * 아무것도 미리 골라 두지 않는다(시안 S2-a) — 처음 값이 없으면 셋 다 빈 채로 시작한다
 */
function BoolInput({
  label,
  help,
  error,
  initial,
  onChange,
}: {
  label: string;
  help?: string;
  error: string | null;
  initial: boolean | null;
  onChange: (value: Value) => void;
}) {
  const [picked, setPicked] = useState<YesNo>(initial);
  return (
    <YesNoField
      label={label}
      help={help}
      error={error}
      withUnknown
      value={picked}
      onChange={(v) => {
        setPicked(v);
        onChange(v === "unknown" || v === null ? null : v);
      }}
    />
  );
}

/** 접힌 '비어 있는 항목 N개'. 접어도 칸은 지우지 않고 숨긴다 — 적던 글이 사라지지 않게(ReadItemRow와 같은 이유) */
function EmptyFields({ count, forceOpen, fields }: { count: number; forceOpen: boolean; fields: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  // 이 안의 칸에 고칠 것(입력 오류·서버 거절)이 있는 동안은 접지 못한다. 접힌 채면 버튼은 잠겼는데 어느 칸이
  // 문제인지 안 보인다(ReadItemRow가 '닫기'를 감추는 것과 같은 이유). open만 보고 그리면, 한 번 펼쳐진 뒤
  // 사용자가 접은 상태에서 다음 오류가 와도 forceOpen이 이미 true라 다시 펼쳐지지 않았다
  const shown = open || forceOpen;
  // 문제가 풀린 뒤 갑자기 접히지 않게, 펼쳐진 상태를 그대로 남긴다
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  if (count === 0) return null;
  return (
    <section className={styles.empty}>
      <h2 className={styles.emptyTitle}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={shown}
          aria-disabled={forceOpen || undefined}
          onClick={() => {
            if (!forceOpen) setOpen(!shown);
          }}
        >
          <Icon name={shown ? "chevronDown" : "chevronRight"} size={16} />
          비어 있는 항목 {count}개 — 아는 값이 있으면 미리 채워도 됩니다
        </button>
      </h2>
      <div hidden={!shown}>
        <p className={styles.emptyLead}>
          비워 두면 판정에 필요한 것만 다음 단계에서 여쭙니다. 화면이 대신 채우지 않습니다.
        </p>
        <div className={styles.grid}>{fields}</div>
      </div>
    </section>
  );
}

/** 버튼 위 오류 목록(설계서 S2 구성 6). 영역은 늘 두고 글만 바꿔야 화면 읽기 프로그램이 읽는다 */
function ErrorList({
  problems,
  rejection,
  catalog,
}: {
  problems: string[];
  rejection: Rejection | null;
  catalog: FieldCatalog;
}) {
  const rejected = rejection
    ? [...Object.entries(rejection.byField).map(([n, m]) => `${catalog[n].label}: ${m}`), ...rejection.rest]
    : [];
  return (
    <div className={styles.errors} aria-live="assertive">
      {problems.length > 0 && <Errors title="고쳐야 보낼 수 있습니다" items={problems} />}
      {rejected.length > 0 && <Errors title="서버가 받지 않은 값이 있습니다" items={rejected} />}
    </div>
  );
}

function Errors({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.errorGroup}>
      <strong className={styles.errorTitle}>{title}</strong>
      <ul className={styles.errorItems}>
        {items.map((item) => (
          <li key={item}>
            <Icon name="alertCircle" size={14} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
