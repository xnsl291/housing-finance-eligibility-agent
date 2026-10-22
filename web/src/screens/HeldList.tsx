/*
 * S7 답한 값 고치기의 목록과 고치기 줄. 설계서 6절 S7, 시안 S3-e(S2uD5)·S4-k(qrvA3)·S4-v2(XtWat).
 * S3 '지금까지 확인한 항목'(접힘)과 S4 '이 조건으로 판정했습니다'가 같이 쓴다 — 자리마다 모양이 다르면 사용자가 매번 새로 읽어야 한다.
 *
 * 줄마다 항목 · 값 · 어디서 온 값인가 · 고치기(모른다고 한 줄은 '값 넣기'). 누르면 그 자리 아래에 칸이 열린다.
 * - 칸은 S3 질문 카드의 칸을 그대로 쓴다(QuestionInput.tsx 머리말 — 칸 안에 '모름'이 없는 S3 열을 고른 이유)
 * - 저장은 바뀐 값만. 그대로면 저장을 잠근다 — 그대로 보내면 서버 기록에서 출처가 '문장에서 읽음'에서
 *   '직접 넣음'으로 바뀐다(confirmValues.ts와 같은 이유)
 * - '값 비우기'는 null을 보낸다. 서버는 값을 지울 뿐 '모른다고 함'으로 만들지 않으므로(session.py declined_of)
 *   '모름'이라고 부르지 않고, 다시 여쭐 수 있다고 적는다
 * - 서버 거절(422)·저장 실패는 그 줄 아래 한 줄. 저장 중에는 다른 줄의 고치기와 이 줄의 취소를 잠근다
 * - 한 번에 한 줄만 열린다. 어느 줄이 열렸는지는 화면이 든다 — S4는 멈춘 이유 아래 버튼으로 줄을 열어야 해서
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { FieldCatalog, FieldValue } from "../api/types";
import { Button } from "../components/Button";
import { FieldError } from "../components/Field";
import { isRange, sameValue } from "./confirmValues";
import type { HeldItem } from "./heldItems";
import { NO_ANSWER, QuestionInput, valueToSend, type Answer } from "./QuestionInput";
import styles from "./HeldList.module.css";

interface HeldListProps {
  items: HeldItem[];
  /** 항목 목록. 못 받았으면 null — 칸 종류를 몰라 고치기를 두지 않는다 */
  catalog: FieldCatalog | null;
  openField: string | null;
  onOpenField: (field: string | null) => void;
  /** 저장. 성공하면 null, 실패하면 줄 아래 문장(useValueEdit.ts) */
  onSave: (field: string, value: FieldValue | null) => Promise<string | null>;
  /** 저장하고 다시 받는 중 */
  saving: boolean;
  /** 연결 끊김 등 밖의 이유로 잠글 때. 목록 위에 한 번만 적는다 */
  lockedReason?: string;
  /** 저장하면 무엇이 일어나는지 한 줄(S3: 다음 질문을 다시 받음, S4: 다시 판정함) */
  afterSave: string;
}

const SAVING_LOCK = "고친 값을 저장하는 중입니다.";

export function HeldList({ items, catalog, openField, onOpenField, onSave, saving, lockedReason, afterSave }: HeldListProps) {
  const lockId = useId();
  const table = useRef<HTMLTableElement>(null);
  // 취소로 닫으면 초점을 그 줄의 고치기로 돌려보낸다. 저장으로 닫힐 때는 화면이 초점을 정한다(S4 바뀐 곳 안내 등)
  const returnTo = useRef<string | null>(null);
  const lock = lockedReason ?? (saving ? SAVING_LOCK : undefined);

  useEffect(() => {
    if (openField !== null || returnTo.current === null) return;
    table.current?.querySelector<HTMLElement>(`[data-field="${returnTo.current}"] button`)?.focus();
    returnTo.current = null;
  }, [openField]);

  if (items.length === 0) return <p className={styles.empty}>아직 확인한 항목이 없습니다.</p>;
  return (
    <>
      {lock && (
        <p id={lockId} className={styles.lock}>
          {lock}
        </p>
      )}
      {catalog === null && <p className={styles.lock}>항목 목록을 받지 못해 지금은 고칠 수 없습니다.</p>}
      <table ref={table} className={styles.table}>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">값</th>
            <th scope="col">어디서 온 값인가</th>
            <th scope="col">
              <span className="sr-only">고치기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const info = catalog?.[item.field];
            const open = openField === item.field && info !== undefined;
            return (
              <Row
                key={item.field}
                item={item}
                action={
                  info &&
                  !open && (
                    <span data-field={item.field}>
                      <Button
                        variant="secondary"
                        icon="pencil"
                        lockedReason={lock}
                        reasonId={lockId}
                        onClick={() => onOpenField(item.field)}
                      >
                        {item.source === "declined" ? "값 넣기" : "고치기"}{" "}
                        <span className="sr-only">— {item.label}</span>
                      </Button>
                    </span>
                  )
                }
                panel={
                  open && (
                    <EditRow
                      item={item}
                      spec={info}
                      lockedReason={lockedReason}
                      saving={saving}
                      afterSave={afterSave}
                      onSave={onSave}
                      onClose={(cancelled) => {
                        if (cancelled) returnTo.current = item.field;
                        onOpenField(null);
                      }}
                    />
                  )
                }
              />
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** 한 줄. 고치기가 열리면 panel(EditRow)이 줄 아래 넓은 칸을 차지한다 */
function Row({ item, action, panel }: { item: HeldItem; action: ReactNode; panel: ReactNode }) {
  return (
    <>
      <tr className={styles.row}>
        <th scope="row">{item.label}</th>
        <td className={item.shown === null ? styles.none : styles.value}>{item.shown ?? "값 없음"}</td>
        <td className={styles.source}>{sourceText(item)}</td>
        <td className={styles.action}>{action || null}</td>
      </tr>
      {panel && (
        <tr className={styles.editRow}>
          <td colSpan={4}>{panel}</td>
        </tr>
      )}
    </>
  );
}

/** 어디서 온 값인가. 직접 넣은 값은 S2에서 고친 값과 S3 답을 서버가 나누지 않아 '직접 넣은 값'으로만 쓴다(heldItems.ts) */
function sourceText(item: HeldItem): string {
  if (item.source === "declined") return "모른다고 함 · 다시 묻지 않습니다";
  if (item.source === "direct") return "직접 넣은 값";
  return item.phrase === null ? "문장에서 읽음" : `“${item.phrase}”에서 읽음`;
}

interface EditRowProps {
  item: HeldItem;
  spec: FieldCatalog[string];
  lockedReason: string | undefined;
  saving: boolean;
  afterSave: string;
  onSave: HeldListProps["onSave"];
  onClose: (cancelled: boolean) => void;
}

function EditRow({ item, spec, lockedReason, saving, afterSave, onSave, onClose }: EditRowProps) {
  const titleId = useId();
  const errorId = useId();
  const box = useRef<HTMLDivElement>(null);
  // 범위로 읽힌 값은 칸에 채우지 않는다 — 고치기 칸은 정확한 값 하나를 받는다(S3와 같음, QuestionInput.tsx)
  const start = item.value === null || isRange(item.value) ? null : item.value;
  const [answer, setAnswer] = useState<Answer>(start === null ? NO_ANSWER : { value: start, problem: null });
  const [error, setError] = useState<string | null>(null);
  /** 이 줄에서 누른 쪽(저장·비우기). 누른 버튼은 스스로 '저장하는 중'이 되고, 다른 쪽은 잠근다 */
  const [pending, setPending] = useState<"save" | "clear" | null>(null);

  // 열리면 칸으로 초점을 옮기고 보이게 한다(멈춘 이유 아래 버튼으로 연 경우 줄이 화면 밖에 있을 수 있다)
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "center" });
    box.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, []);

  const value = valueToSend(answer);
  const saveLock =
    lockedReason ??
    (answer.problem
      ? "칸의 값을 고쳐야 저장할 수 있습니다"
      : value === null
        ? "값을 넣어야 저장할 수 있습니다"
        : item.value !== null && sameValue(value, item.value)
          ? "값을 바꿔야 저장할 수 있습니다"
          : undefined);

  async function send(next: FieldValue | null) {
    setError(null);
    setPending(next === null ? "clear" : "save");
    const failed = await onSave(item.field, next);
    setPending(null);
    if (failed === null) onClose(false);
    else setError(failed);
  }

  return (
    <div ref={box} className={styles.edit}>
      <span id={titleId} className="sr-only">
        {item.label}
      </span>
      <QuestionInput
        question={spec}
        titleId={titleId}
        describedBy={errorId}
        answer={answer}
        onChange={(next) => {
          setAnswer(next);
          setError(null);
        }}
      />
      <p className={styles.note}>
        {item.source === "declined" ? `값을 넣으면 ‘모른다고 함’이 풀립니다. ${afterSave}` : afterSave}
      </p>
      <div className={styles.buttons}>
        <Button
          lockedReason={pending === "clear" ? SAVING_LOCK : saveLock}
          busyLabel="저장하는 중" onClick={() => (value === null ? undefined : send(value))}>
          저장
        </Button>
        {item.source !== "declined" && (
          <Button
            variant="secondary"
            lockedReason={pending === "save" ? SAVING_LOCK : lockedReason}
            busyLabel="비우는 중" onClick={() => send(null)}>
            값 비우기
          </Button>
        )}
        <Button variant="text" lockedReason={saving ? SAVING_LOCK : undefined} onClick={() => onClose(true)}>
          취소
        </Button>
      </div>
      {item.source !== "declined" && (
        <p className={styles.note}>
          값을 비우면 이 항목은 값이 없는 것으로 판정합니다. ‘모른다고 함’으로 남지 않아 질문을 이어서 하면 다시 여쭐 수
          있습니다.
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
