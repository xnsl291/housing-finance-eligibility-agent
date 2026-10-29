/*
 * S9 상품 비교표. 설계서 6절 S9, 시안 S4(kBM26)의 '두 상품을 한눈에'.
 *
 * 카드 목록을 대신하지 않고 위에 덧붙인다. 후보(판정한 상품)가 2개 이상일 때만 그린다 — 하나면 표가 카드와 같은 말을 한다.
 * 열: 상품 · 판정 · 예상 한도 · 남은 확인 · 자세히. 순서는 카드와 같은 판정 순(13절 Q2, resultText.sortByVerdict).
 *
 * 한도 칸은 카드와 같은 규칙(G7, ProductCard.tsx 네 경우)을 표 모양으로 줄인 것이다
 * - 조건 불충족: '—'. 탈락한 상품의 금액을 보이지 않는다. 남은 확인도 '—'(판정이 이미 났다)
 * - 확정(isFinal — 사전 조건 부합이고 남은 조건 0개): 금액 그대로
 * - 그 밖에 금액이 있으면: 금액 옆 '*' + 표 아래 설명. 판정이 끝나지 않은 금액을 확정처럼 보이지 않게
 * - 금액을 못 냈으면: '계산하지 못함'. 까닭은 카드에 있다(표 칸에 긴 사유를 넣지 않음)
 * 표 아래 설명은 설계서 문구('아직 확인되지 않은 조건이 있어 달라질 수 있습니다')를 쓴다. 단 '*'가 붙은 상품 중 남은 조건이
 * 0개인데 판정이 끝나지 않은 것(추가 확인 필요·정보 부족)이 있으면 그 문구가 틀린 말이 되어, 그 경우만 이유를 넓혀 쓴다
 *
 * '자세히'는 그 카드로 스크롤하고, 카드 제목으로 초점을 옮기고, 카드 테두리를 잠깐 강조한다. 초점을 옮겨야 키보드·화면 읽기
 * 프로그램 사용자도 같은 자리에 간다. 강조는 CSS 애니메이션이 끝나면(animationend) 거둔다 — 시간을 재지 않는다.
 * 움직임 줄이기를 켰으면 스크롤도 부드럽게 하지 않는다.
 *
 * 600px 미만에서는 표 대신 상품마다 한 줄 카드(설계서 S9·11.4, 시안 폭 390 'S4 결과 — 비교표 대신 한 줄 카드'). 다섯 열이
 * 390px에 들어가지 않아 표를 그대로 두면 가로로 넘친다. 카드도 칸 규칙(한도 '—'·'*'·'계산하지 못함', 표 아래 설명)은 표와 같고,
 * 카드 전체가 '자세히' 버튼이다(시안에는 버튼이 따로 없음). 남은 확인은 조건 불충족이면 적지 않는다(표의 '—' 대신).
 *
 * 표와 카드를 둘 다 그리고 어느 쪽을 보일지는 CSS만으로 정한다(CompareTable.module.css). 카드는 기본으로 숨고, 600px 미만
 * 화면(`screen and`)에서만 표를 숨기고 카드를 보인다. 그래서 인쇄는 폭과 관계없이 표다 — 폰에서 인쇄해도 표가 찍힌다.
 * 화면 폭(JS)으로 하나만 그리면 폰에서 인쇄할 때 카드가 찍히는데, 카드는 <button>이라 인쇄 CSS(base.css)가 버튼을 모두 숨겨
 * 비교가 통째로 빠진다. 인쇄 직전에 다시 그려 표로 바꾸는 것도 브라우저가 기다려 주지 않아 믿을 수 없다.
 * 숨긴 쪽은 display:none이라 화면 읽기 프로그램도 읽지 않는다 — 같은 내용을 두 번 읽지 않는다.
 */
import type { ProgramResult } from "../api/types";
import { formatWon } from "../components/amount";
import { Icon } from "../components/Icon";
import { isFinal } from "../components/ProductCard";
import { VerdictBadge } from "../components/VerdictBadge";
import { sortByVerdict, unresolvedCount } from "./resultText";
import styles from "./CompareTable.module.css";

/** 카드 id. 비교표의 '자세히'가 이 id로 카드를 찾는다 */
export function cardId(programId: string): string {
  return `card-${programId}`;
}

export const STAR_NOTE = "* 아직 확인되지 않은 조건이 있어 달라질 수 있습니다";
export const STAR_NOTE_WIDE = "* 아직 확인되지 않은 조건이 있거나 판정이 끝나지 않아 달라질 수 있습니다";

/** 한도 칸 글과 '*'를 붙일지(머리말의 네 경우) */
export function limitCell(result: ProgramResult): { text: string; star: boolean } {
  if (result.status === "NOT_MATCHED") return { text: "—", star: false };
  const won = result.loan_limit?.amount_krw;
  if (won == null) return { text: "계산하지 못함", star: false };
  return { text: formatWon(won), star: !isFinal(result.status, unresolvedCount(result)) };
}

export function CompareTable({ results }: { results: ProgramResult[] }) {
  if (results.length < 2) return null;
  const rows = sortByVerdict(results);
  const starred = rows.filter((r) => limitCell(r).star);
  const note = starred.length === 0 ? null : starred.every((r) => unresolvedCount(r) > 0) ? STAR_NOTE : STAR_NOTE_WIDE;

  // 구역(section)에는 이름을 붙이지 않는다. 표(caption)와 카드 목록(aria-labelledby)이 같은 이름을 갖고 있어 두 번 읽힌다
  return (
    <section className={styles.wrap}>
      <table className={styles.table} aria-describedby={note ? "s9-note" : undefined}>
        <caption id="s9-caption" className={styles.caption}>
          상품 {rows.length}개를 한눈에
        </caption>
        <thead>
          <tr>
            <th scope="col">상품</th>
            <th scope="col">판정</th>
            <th scope="col" className={styles.num}>
              예상 한도
            </th>
            <th scope="col" className={styles.num}>
              남은 확인
            </th>
            <th scope="col" className={styles.more}>
              <span className="sr-only">카드로 가기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const limit = limitCell(r);
            return (
              <tr key={r.program_id}>
                <th scope="row" className={styles.name}>
                  {r.program_name}
                </th>
                <td>
                  <VerdictBadge status={r.status} />
                </td>
                <td className={`${styles.num} num`}>
                  {limit.text}
                  {limit.star && (
                    <>
                      <span aria-hidden="true"> *</span>
                      <span className="sr-only"> (달라질 수 있음 — 표 아래 설명)</span>
                    </>
                  )}
                </td>
                <td className={`${styles.num} num`}>{r.status === "NOT_MATCHED" ? "—" : `${unresolvedCount(r)}개`}</td>
                <td className={styles.more}>
                  {/* 줄마다 같은 '자세히'라 버튼 목록에서 구분되게 상품 이름을 붙인다. 보이는 글이 앞에 오게(음성 조작) */}
                  <button
                    type="button"
                    className={styles.button}
                    aria-label={`자세히 ${r.program_name}`}
                    onClick={() => showCard(r.program_id)}
                  >
                    자세히
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <CompareCards rows={rows} note={note} />
      {note && (
        <p id="s9-note" className={styles.note}>
          {note}
        </p>
      )}
    </section>
  );
}

/** 600px 미만에서 표 대신 보이는 한 줄 카드 묶음(머리말). 위 줄 상품·판정, 아래 줄 예상 한도·남은 확인(시안 폭 390) */
function CompareCards({ rows, note }: { rows: ProgramResult[]; note: string | null }) {
  return (
    <div className={styles.cardList}>
      <p id="s9-cards-caption" className={styles.caption}>
        상품 {rows.length}개를 한눈에
      </p>
      <ul className={styles.cards} aria-labelledby="s9-cards-caption" aria-describedby={note ? "s9-note" : undefined}>
        {rows.map((r) => {
          const limit = limitCell(r);
          return (
            <li key={r.program_id}>
              <button type="button" className={styles.card} onClick={() => showCard(r.program_id)}>
                <span className={styles.cardTop}>
                  <span className={styles.name}>{r.program_name}</span>
                  <VerdictBadge status={r.status} />
                </span>
                <span className={styles.cardBottom}>
                  <span className={`${styles.cardLimit} num`}>
                    {/* 이름표를 눈에도 보인다. 조건 불충족이면 금액 자리가 '—'뿐이라 이름표가 없으면 무엇이 없는지 알 수 없다 */}
                    <span className={styles.cardLabel}>예상 한도 </span>
                    {limit.text}
                    {limit.star && (
                      <>
                        <span aria-hidden="true"> *</span>
                        <span className="sr-only"> (달라질 수 있음 — 목록 아래 설명)</span>
                      </>
                    )}
                  </span>
                  {r.status !== "NOT_MATCHED" && <span className={styles.cardLeft}>남은 확인 {unresolvedCount(r)}개</span>}
                  <Icon name="chevronRight" size={16} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** '자세히' — 그 카드로 스크롤, 제목에 초점, 잠깐 강조(머리말) */
function showCard(programId: string) {
  const card = document.getElementById(cardId(programId));
  if (!card) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  card.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  card.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  // 같은 카드를 잇달아 눌러도 다시 강조되게 표시를 뗐다가 붙인다(그 사이에 스타일을 다시 계산시킨다)
  card.removeAttribute("data-flash");
  void card.offsetWidth;
  card.setAttribute("data-flash", "");
  // 카드 안 다른 요소의 animationend도 올라온다(버블링). 카드 자신의 애니메이션이 끝났을 때만 거둔다
  const done = (event: AnimationEvent) => {
    if (event.target !== card) return;
    card.removeAttribute("data-flash");
    card.removeEventListener("animationend", done);
  };
  card.addEventListener("animationend", done);
}
