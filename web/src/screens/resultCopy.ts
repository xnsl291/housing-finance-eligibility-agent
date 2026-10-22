/*
 * 결과 복사(S12)의 글. 그리지 않는다 — 테스트로 바로 지키려고 화면과 나눴다(resultText.ts와 같은 이유).
 *
 * 맨 앞 두 줄은 고지다(G1). 그다음 제목과 복사 일시 — 규칙·자료가 바뀌면 판정도 바뀌므로 언제 본 결과인지 남긴다. 복사한 글은 어디로든 붙여 넣어지고 앞부분만 잘려 쓰이기 쉽다. 고지가 뒤에 있으면
 * 판정만 잘려 나가 '확인서'처럼 쓰일 수 있다. 끝에도 결과 고지를 한 번 더 둔다 — 뒷부분만 떼어 쓰는 경우.
 * 고지는 화면의 고지 상수(Notice.tsx, 서버 상수와 글자 대조됨)를 그대로 쓴다.
 *
 * 내용은 화면이 보이는 것과 같은 말이다. 새로 판정하거나 줄이지 않는다
 * - 멈춘 이유: StopBanner의 제목·본문
 * - 왜 이 상품만 보이나: 화면의 scope 줄(resultText.scopeLine) 그대로. 상품 목록 앞에. 못 정했으면(화면도 안 보임) 넣지 않는다
 * - 상품: 카드와 같은 판정 순, 판정 이름(VERDICT_LABEL), 한도는 카드의 네 경우(G7) 그대로 — 불충족은 한도 줄이 없고,
 *   확정 전이면 '지금까지 확인된 조건 기준 한도'와 카드의 단서(limitCaveat), 못 냈으면 사유. 판정별 목록과 공식 안내 페이지
 * - 이 조건으로 판정했습니다: 항목 · 값 · 출처(HeldList의 출처 글). 세션 값을 못 받았으면 그렇다고 적는다
 * 판정 근거(규칙별 원문)는 넣지 않는다. 글이 길어져 붙여 넣는 곳에서 읽히지 않고, 원문은 공식 안내 페이지와 인쇄에 있다.
 */
import type { Program, ProgramResult } from "../api/types";
import { formatWon } from "../components/amount";
import { NOTICE } from "../components/Notice";
import { cardList, isFinal, LIST_TITLE, limitCaveat, limitReasonText } from "../components/ProductCard";
import { stopText } from "../components/StopBanner";
import { VERDICT_LABEL } from "../components/VerdictBadge";
import type { HeldItem } from "./heldItems";
import { sourceText } from "./HeldList";
import { limitNote, sortByVerdict, unresolvedCount } from "./resultText";

export interface CopyInput {
  reason: string | undefined;
  declinedLabels: string[];
  /** 왜 이 상품만 보이나(resultText.scopeLine). 화면에 안 보이면 null */
  scope: string | null;
  copiedAt: Date;
  results: ProgramResult[];
  /** 상품 목록(전세·매매 — 한도 설명의 '보증금 비율'·'주택가격 비율'). 못 받았으면 null */
  programs: Program[] | null;
  /** 이 조건으로 판정했습니다. 세션 값이나 기록을 못 받았으면 null */
  items: HeldItem[] | null;
}

export function copyText({ reason, declinedLabels, scope, copiedAt, results, programs, items }: CopyInput): string {
  const stop = stopText(reason, declinedLabels);
  const lines = [NOTICE.header, NOTICE.result, "", "주거금융 지원가능성 판정 결과", `복사 일시 ${stampText(copiedAt)}`, ""];
  lines.push(`${stop.title} — ${stop.body}`);
  if (scope) lines.push(scope);
  lines.push("");
  if (results.length === 0) lines.push("판정한 상품이 없습니다.", "");
  for (const result of sortByVerdict(results)) lines.push(...productLines(result, programs), "");
  lines.push("이 조건으로 판정했습니다");
  if (items === null) lines.push("- 확인한 항목을 불러오지 못했습니다");
  else if (items.length === 0) lines.push("- 아직 확인한 항목이 없습니다");
  else
    for (const item of items)
      lines.push(item.shown === null ? `- ${item.label}: 모른다고 함` : `- ${item.label}: ${item.shown} (${sourceText(item)})`);
  lines.push("", NOTICE.result);
  return lines.join("\n");
}

/** 인쇄·복사 일시. 사용자 컴퓨터 시각 그대로 'YYYY-MM-DD HH:mm' */
export function stampText(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function productLines(result: ProgramResult, programs: Program[] | null): string[] {
  const lines = [`[${result.program_name}] ${VERDICT_LABEL[result.status]}`];
  const won = result.loan_limit?.amount_krw ?? null;
  const unresolved = unresolvedCount(result);
  // 조건 불충족은 한도 줄이 아예 없다(G7 ①)
  if (result.status !== "NOT_MATCHED") {
    if (won === null) lines.push(`한도: ${limitReasonText(result.loan_limit?.reason)}`);
    else {
      const tenure = programs?.find((p) => p.program_id === result.program_id)?.tenure;
      const note = limitNote(result.loan_limit!, tenure);
      lines.push(
        isFinal(result.status, unresolved)
          ? `예상 대출 한도: ${formatWon(won)} (${note})`
          : `지금까지 확인된 조건 기준 한도: ${formatWon(won)} (${note}) — ${limitCaveat(unresolved)}`,
      );
    }
  }
  const list = cardList(result.status, won, result.next_actions);
  if (list.length > 0) lines.push(`${LIST_TITLE[result.status]}:`, ...list.map((item) => `- ${item}`));
  lines.push(`공식 안내 페이지: ${result.source_url}`);
  return lines;
}
