/*
 * S4 결과 화면의 S7 조각 — '이 조건으로 판정했습니다' 요약, 고친 뒤 바뀐 곳 안내, 모른다고 한 항목으로 가는 버튼.
 * 설계서 6절 S7·8.4 'D1을 푸는 길', 시안 S4-k(qrvA3)·S4-v2(XtWat). Result.tsx가 180줄에 가까워 책임 단위로 나눴다.
 *
 * - 요약은 결과 카드 아래, 확인 과정 위(설계서 S4 제안 배치 6). 목록과 고치기 줄은 S3와 같은 HeldList
 * - 바뀐 곳 안내는 다시 판정한 직후에만 보인다. 저장하면 고치기 줄이 닫혀 초점 둘 곳이 사라지므로, 안내로 초점을 옮겨
 *   화면 읽기 프로그램이 "다시 판정했다"는 것부터 읽게 한다(시안 S4-k 메모)
 * - 모른다고 한 것만 남아 멈췄을 때(ONLY_DECLINED_LEFT) 멈춘 이유 배너 안에 항목마다 '값 넣기'를 둔다. 누르면 요약의
 *   그 줄이 열리고 칸으로 초점이 간다(결함 D1 — 배너가 "확인되면 이어서 판정할 수 있습니다"라고 하는데 길이 없었다)
 */
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import type { FieldCatalog, FieldValue, ProgramResult } from "../api/types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { describeFailure } from "./failure";
import { changeLines, heldItems, type HeldItem } from "./heldItems";
import { HeldList } from "./HeldList";
import { fieldLabel } from "./resultText";
import type { Change, HeldState, TraceState } from "./useResult";
import { useValueEdit } from "./useValueEdit";
import styles from "./ConditionSummary.module.css";

/**
 * 요약의 줄과 고치기 상태. 저장은 그 값만 PUT(useValueEdit) → 끝나면 다시 판정(useResult refresh).
 * 저장할 때 그 줄의 고치기 전 값을 들어 두었다가 다시 판정에 넘긴다 — 바뀐 곳 안내의 '고친 값: A → B'의 A
 */
export function useSummaryEdit(
  sessionId: string,
  held: HeldState | null,
  trace: TraceState | null,
  catalog: FieldCatalog | null,
  refresh: (field: string, before: string) => Promise<void>,
) {
  const [openField, setOpenField] = useState<string | null>(null);
  const editing = useRef({ field: "", before: "" });
  const edit = useValueEdit(sessionId, () => refresh(editing.current.field, editing.current.before));
  const items =
    held?.kind === "ready" && trace?.kind === "ready" ? heldItems(held.values, trace.events, catalog) : null;

  function save(field: string, value: FieldValue | null) {
    const item = items?.find((i) => i.field === field);
    editing.current = { field, before: item?.shown ?? "모른다고 함" };
    return edit.save(field, value);
  }

  return { items, openField, setOpenField, saving: edit.saving, save };
}

interface SummaryProps {
  held: HeldState;
  items: HeldItem[] | null;
  catalog: FieldCatalog | null;
  openField: string | null;
  onOpenField: (field: string | null) => void;
  onSave: (field: string, value: FieldValue | null) => Promise<string | null>;
  saving: boolean;
  lockedReason: string | undefined;
  onRetry: () => Promise<void>;
}

/** 이 조건으로 판정했습니다. 세션 값이나 기록을 못 받으면 그렇다고 적고 다시 시도를 둔다(S6와 같은 모양) */
export function ConditionSummary({ held, items, onRetry, lockedReason, ...list }: SummaryProps) {
  return (
    <section className={styles.summary} aria-labelledby="summary-title">
      <div className={styles.head}>
        <h2 id="summary-title" className={styles.title}>
          이 조건으로 판정했습니다
        </h2>
        <p className={styles.lead}>값을 고치면 그 값으로 다시 판정합니다.</p>
      </div>
      {items ? (
        <HeldList items={items} lockedReason={lockedReason} afterSave="저장하면 이 값으로 다시 판정합니다." {...list} />
      ) : (
        <div className={styles.failed}>
          <p>판정에 쓴 값을 불러오지 못했습니다. {reasonOf(held)}</p>
          <Button variant="secondary" lockedReason={lockedReason} onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      )}
    </section>
  );
}

function reasonOf(held: HeldState): string {
  if (held.kind === "ready") return "";
  if (held.error instanceof ApiError && held.error.kind === "http") return held.error.message;
  return describeFailure(held.error, "start").title;
}

/** 고친 값으로 다시 판정한 직후(시안 S4-k). 초점을 받는다(머리말) */
export function ChangeNotice({ change, items, results, catalog }: {
  change: Change;
  items: HeldItem[] | null;
  results: ProgramResult[];
  catalog: FieldCatalog | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, [change]);
  const lines = changeLines(change.previous, results);
  // 고친 뒤 값. 줄이 없으면 비운 것이다. 줄이 있는데 값이 없으면 여전히 모른다고 한 항목이다
  const now = items?.find((i) => i.field === change.field);
  const after = items === null ? null : now ? (now.shown ?? "모른다고 함") : "비움";
  return (
    <div ref={box} tabIndex={-1} className={styles.change} role="status">
      <Icon name="rotateCcw" size={18} />
      <div className={styles.changeText}>
        <strong>
          고치신 값으로 다시 판정했습니다{lines.length > 0 ? ` — 바뀐 곳 ${lines.length}군데` : ""}
        </strong>
        {lines.length > 0 ? (
          <ul className={styles.changeList}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <span>판정과 한도는 그대로입니다.</span>
        )}
        <span className={styles.edited}>
          고친 값: {fieldLabel(catalog, change.field)} — {change.before}
          {after !== null && ` → ${after}`}
        </span>
      </div>
    </div>
  );
}

/** 모른다고 한 것만 남았을 때 그 항목들로 가는 버튼(결함 D1). 요약을 못 그리면 갈 곳이 없어 두지 않는다 */
export function DeclinedLinks({ fields, items, catalog, lockedReason, onOpen }: {
  fields: string[];
  items: HeldItem[] | null;
  catalog: FieldCatalog | null;
  lockedReason: string | undefined;
  onOpen: (field: string) => void;
}) {
  const targets = fields.filter((f) => catalog?.[f] && items?.some((i) => i.field === f));
  if (targets.length === 0) return null;
  return (
    <div className={styles.links}>
      <span>값을 알게 되셨으면 여기서 넣을 수 있습니다. 넣으면 다시 판정합니다.</span>
      <div className={styles.linkButtons}>
        {targets.map((f) => (
          <Button key={f} variant="secondary" icon="pencil" lockedReason={lockedReason} onClick={() => onOpen(f)}>
            {fieldLabel(catalog, f)} 값 넣기
          </Button>
        ))}
      </div>
    </div>
  );
}
