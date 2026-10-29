/*
 * S0 첫 화면. 설계서 6절 S0, 시안 S0(e49DYK)·S0-b(QWTJO).
 *
 * 무슨 도구인지, 무엇을 준비하면 좋은지를 먼저 보여 준다. 짧게 쓰면 읽히는 항목이 줄어 '정보 부족'으로
 * 끝나기 때문이다.
 *
 * 대상 상품 묶음은 서버 응답(/v1/programs)으로만 그린다. 상품 이름을 화면에 박으면 상품이 늘 때 두 곳을
 * 고쳐야 한다. 받지 못하면 묶음을 통째로 빼고 그린다(시안 S0-b '서버 준비 전 모양'). 상품 수를 말하는
 * 대략 안내도 쓰지 않는다 — 상품 수가 바뀌면 틀린 말이 된다.
 *
 * 시작 버튼 두 개
 * - 문장으로 적기 → S1
 * - 항목을 직접 고르기 → 세션을 열고 바로 S3. 읽은 값이 없으니 확인할 것도 없어 S2를 건너뛴다(Q8)
 *
 * 세션을 여는 동안 다른 화면으로 떠났으면 답이 와도 S3로 끌고 가지 않는다(alive). 번호는 앱 메모리에
 * 모았으므로 '내 기록 지우기'로 지울 수 있다.
 */
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { Button } from "../components/Button";
import { Skeleton, SystemError } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { usePrivacyPlace } from "../components/Sidebar";
import { useAlive, useAppState } from "./AppState";
import { describeFailure } from "./failure";
import { sessionPath } from "./routes";
import styles from "./Start.module.css";

const TENURE = { JEONSE: "전세", PURCHASE: "매매" } as const;

// 설계서 S0 '준비하면 좋은 것'(7절 항목에서 고름). 판정 규칙이 아니라 안내 문구라 화면이 든다
const PREPARE = ["나이", "부부합산 연소득", "순자산", "무주택 여부", "지역", "보증금 또는 집값", "(전세라면) 잔금일·전입일"];

// 심사 주체는 머리 고지(설계서 C-HEADER)처럼 '기관'으로만 말한다. 기관을 나열하면 상품이 늘 때 틀린 말이 된다
const NOT_DONE = [
  "승인·심사가 아닙니다. 실제 심사는 기관이 합니다",
  "금리와 월 상환액은 계산하지 않습니다",
  "신청서를 접수하지 않습니다",
];

export function Start() {
  const navigate = useNavigate();
  const { programs, rememberSession, lostConnection } = useAppState();
  const [failure, setFailure] = useState<{ id: number; error: unknown } | null>(null);
  const alive = useAlive();
  const privacyPlace = usePrivacyPlace();

  // '항목을 직접 고르기'와 실패 뒤 '다시 시도'는 같은 일을 한다. 버튼마다 따로 잠기므로 둘을 잇달아 누르면
  // 세션이 둘 열린다. 화면 단위로 한 번에 하나만 열게 막는다(ref는 다시 그리기를 기다리지 않고 바로 바뀐다)
  const busy = useRef(false);

  async function startDirect() {
    if (busy.current) return;
    busy.current = true;
    try {
      const { session_id } = await api.startSession();
      rememberSession(session_id);
      if (alive.current) navigate(sessionPath(session_id, "questions"));
    } catch (error) {
      // 연결 안 됨이면 머리·사이드바의 연결 표시도 맞춘다. 안내는 이 화면의 상자가 한다
      if (error instanceof ApiError && error.kind === "network") lostConnection();
      if (alive.current) setFailure((f) => ({ id: (f?.id ?? 0) + 1, error }));
    } finally {
      busy.current = false;
    }
  }

  const text = failure && describeFailure(failure.error, "start");

  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.title}>내 조건으로 될 것 같은지, 신청 전에 가늠해 보세요</h1>
        <p className={styles.lead}>
          상황을 적어 주시면 상품들의 신청 조건과 대조해 가늠해 드립니다. 판정마다 어떤 조건에서 그렇게 봤는지 공식
          자료 원문을 함께 보여 드립니다.
        </p>
      </section>

      {programs === "loading" && <Skeleton />}
      {Array.isArray(programs) && programs.length > 0 && (
        <section className={styles.block} aria-labelledby="s0-programs">
          <h2 id="s0-programs" className={styles.label}>
            이 도구가 보는 상품
          </h2>
          <ul className={styles.programs}>
            {programs.map((p) => (
              <li key={p.program_id} className={styles.program}>
                {p.tenure && <span className={styles.chip}>{TENURE[p.tenure]}</span>}
                <span className={styles.programName}>{p.program_name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.pair}>
        <section className={styles.card} aria-labelledby="s0-prepare">
          <h2 id="s0-prepare" className={styles.label}>
            준비해 두시면 좋은 것
          </h2>
          <ul className={styles.chips}>
            {PREPARE.map((name) => (
              <li key={name} className={styles.prepare}>
                {name}
              </li>
            ))}
          </ul>
          <p className={styles.small}>모르는 것이 있어도 시작할 수 있습니다. 모르는 항목은 모른 채로 두고 판정합니다.</p>
        </section>
        <section className={styles.card} aria-labelledby="s0-not">
          <h2 id="s0-not" className={styles.label}>
            이 도구가 하지 않는 것
          </h2>
          <ul className={styles.notDone}>
            {NOT_DONE.map((line) => (
              <li key={line}>
                <Icon name="minus" size={15} />
                {line}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className={styles.process}>
        <Icon name="listChecks" size={17} />
        문장을 읽은 뒤, 판정에 필요한 것만 몇 가지 더 여쭙니다. 남은 질문 수는 답에 따라 달라집니다. 언제든 멈추고
        결과를 볼 수 있습니다.
      </p>

      <section className={styles.start} aria-label="시작하기">
        <div className={styles.buttons}>
          <Button onClick={() => navigate("/write")}>문장으로 적기</Button>
          <Button variant="secondary" busyLabel="여는 중" onClick={startDirect}>
            항목을 직접 고르기
          </Button>
        </div>
        {failure && text && (
          <SystemError key={failure.id} title={text.title} icon={text.icon} onRetry={startDirect}>
            {text.body}
          </SystemError>
        )}
        {/* 사이드바 개인정보 안내(PRIVACY_NOTE)를 줄인 것. 줄여도 남는 것을 빠뜨리면 "그것만 남는다"로 읽혀
            사실과 어긋난다(G12, C-COPY). 남는 것은 다 적고, 저장 위치·가림·지우는 방법은 사이드바로 넘긴다.
            Start.test.tsx가 필수 구절이 여기와 PRIVACY_NOTE 양쪽에 있는지 대조한다.
            S11 화면 링크는 PR #34에서 미뤄 둔 것. 같은 탭에서 연다 — 새로 고침 없이 옮겨야 이 탭에서 연 세션 목록(D-39)이 남는다 */}
        <p className={styles.privacy}>
          <Icon name="lock" size={14} />
          입력한 문장 전체는 저장하지 않지만, 읽어 낸 값과 그 근거가 된 문장 일부, 직접 넣거나 답한 값, 모른다고 한
          항목은 서버에 저장되어 서버를 다시 켜도 남습니다. 자세한 내용과 지우는 방법은 {privacyPlace}와{" "}
          <Link to="/privacy">개인정보·이용 안내</Link>에 있습니다.
        </p>
      </section>
    </>
  );
}
