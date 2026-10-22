/*
 * S11 개인정보·이용 안내. 설계서 6절 S11, 시안 S11(jJwW4). 주소 /privacy.
 *
 * 무엇이 남고 언제 지워지는지를 사실대로 적는다(G12). "저장하지 않습니다"라고 쓰고 실제로 남기면 가장 나쁜 오류다.
 *
 * 문구의 출처
 * - 서버 고지 상수와 같은 말을 하는 줄은 상수(Notice.tsx — 서버 파이썬 상수와 글자 대조 테스트가 있음)를 문장 단위로
 *   잘라 그대로 쓴다. 다듬지 않는다. Privacy.test.tsx가 줄마다 상수의 한 문장인지 대조한다
 *   PRIVACY_NOTE(사이드바 개인정보 안내) → 남지 않는 것·남는 것·가리는 것·지우는 방법 첫 줄
 *   PRIVACY_NOTICE(입력 화면) → 가리지 못하는 것과 적지 말 것
 *   DELETE_NOTE·RESET_NOTE → 지우기와 초기화가 하는 일
 * - 주소 공유 주의는 시안 S8(LMNGD)의 문구 그대로
 * - 그 밖의 줄(근거 구절 예시, 읽지 못한 원문, 가리는 모양과 자리, 보관 기간 미정, 지우기의 범위와 한계)은 이 화면이
 *   쓴 것이다. 근거:
 *   근거 구절은 세션 값의 phrase(api.py) — 값마다 있지는 않다(직접 넣은 값, 근거를 붙이지 않은 값).
 *   읽지 못한 원문은 추출 기록의 unreadable(session.py record_extraction, #45부터 가린 뒤 저장).
 *   가리는 모양은 extraction.py `_SENSITIVE` 정규식 두 개, 가리는 자리는 record_extraction(근거 구절·읽지 못한 원문에만
 *   scrub, 값은 그대로). 보관 기간은 설계서 13절 Q4 미정 — 서버에 만료 규칙이 없다(지어내지 않음).
 *   지우기 범위는 기술결정기록 D-39(이 탭에서 연 세션을 모두 지움). 주소로 들어와 연 세션도 Layout이 목록에 넣으므로
 *   새로 고친 뒤에도 그 세션은 지울 수 있고, 새로 고치기 전에 연 다른 세션과 번호를 받지 못한 세션은 지울 수 없다
 *
 * 시안은 '지우는 방법' 자리에 버튼이 없다고 적었으나(그때는 서버 삭제 경로가 없었음) 지금은 사이드바에 '내 기록 지우기'가
 * 있다. 이 화면에 버튼을 또 두지 않고 사이드바의 그 버튼을 가리킨다 — 지우기 확인 창과 실패 처리를 두 벌 두지 않으려고.
 * 시안의 '전체 초기화' 버튼도 같은 이유로 두지 않는다.
 */
import type { ReactNode } from "react";

import { Icon, type IconName } from "../components/Icon";
import { DELETE_NOTE, NOTICE } from "../components/Notice";
import screen from "./Screen.module.css";
import styles from "./Privacy.module.css";

/** 상수를 문장으로 자른다. 상수의 문장은 모두 '.'로 끝나고 문장 안에는 '. '가 없다 */
export function sentences(text: string): string[] {
  return text.split(/(?<=\.) /);
}

const [NOT_KEPT, KEPT, MASKED, DELETABLE] = sentences(NOTICE.privacy);

/** 시안 S8의 주소 공유 주의 */
export const SHARE_WARNING =
  "이 페이지 주소에는 확인 기록을 되찾는 번호가 들어 있습니다. 주소를 다른 사람에게 보내지 마세요 — 받은 사람이 입력하신 값을 그대로 보게 됩니다.";

export const RETENTION_UNDECIDED = "아직 정해지지 않았습니다.";

/** 서버가 가리는 모양(extraction.py `_SENSITIVE` 정규식 두 개). Privacy.test.tsx가 정규식과 대조한다 */
export const MASK_SHAPES =
  "가리는 것은 숫자를 '-'로 이은 주민등록번호 모양(6자리-7자리)과 계좌번호 모양(2~3자리-2~6자리-2~6자리)뿐입니다. 그 밖의 것(이름·주소·이메일, '-' 없이 붙여 쓴 번호, 앞자리가 네 자리인 계좌번호 등)은 가리지 않습니다. '-'로 이은 전화번호(예: 010-1234-5678)는 계좌번호 모양과 같아 가려집니다.";

/** 서버가 가리는 자리(session.py record_extraction — 근거 구절과 읽지 못한 원문에만 scrub) */
export const MASK_SCOPE = "가리는 자리는 문장에서 가져온 조각(근거 구절, 값으로 바꾸지 못한 원문)입니다. 읽어 낸 값과 칸에 직접 넣은 값은 가리지 않고 그대로 남습니다.";

export function Privacy() {
  return (
    <>
      <section className={screen.heading}>
        <span className={screen.eyebrow}>이용 안내</span>
        <h1 className={screen.title}>개인정보·이용 안내</h1>
        <p className={screen.lead}>무엇이 남고 언제 지워지는지 사실대로 적었습니다.</p>
      </section>

      <div className={styles.sections}>
        <Section icon="fileX" title="무엇이 남지 않는가" lead={NOT_KEPT} />
        <Section icon="listChecks" title="무엇이 남는가" lead={KEPT}>
          <li>문장에서 읽어 낸 값에는 근거로 쓴 문장 일부(근거 구절)가 함께 남을 수 있습니다. 예: “연봉 4천만원”</li>
          <li>문장에서 찾았지만 값으로 바꾸지 못한 표현(예: “25평”, 단위가 빠진 금액)도 그 원문 조각이 남습니다.</li>
        </Section>
        <Section icon="lock" title="가리는 것과 가리지 못하는 것" lead={MASKED}>
          {sentences(NOTICE.input).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>{MASK_SHAPES}</li>
          <li>{MASK_SCOPE}</li>
        </Section>
        <Section icon="timer" title="언제 지워지는가" lead={RETENTION_UNDECIDED}>
          <li>보관 기간이 정해지면 이 자리에 적겠습니다. 그 전까지 이 도구는 기록을 저절로 지우지 않습니다.</li>
        </Section>
        <Section icon="eraser" title="지우는 방법" lead={DELETABLE}>
          <li>
            '내 기록 지우기'는 왼쪽 '개인정보 안내' 아래에 있습니다. 누르면 확인 창이 뜨고, 지우면 이 탭에서 연 확인 기록을
            모두 서버에서 지웁니다. {DELETE_NOTE}
          </li>
          <li>
            화면을 새로 고치거나 새 탭에서 열면, 그 전에 연 기록의 번호를 화면이 잊어 지울 수 없게 됩니다. 다만 새로 고친
            뒤에도 기록 번호가 든 주소(읽은 내용 확인·하나씩 확인·판정 결과)로 이 탭에서 연 기록은 화면이 기억하므로, 다른
            화면으로 옮겨도 지울 수 있습니다.
          </li>
          <li>
            기록을 여는 요청이 시간 초과로 끊겨 화면이 기록 번호를 받지 못했으면, 서버에 기록이 생겼더라도 이 화면에서는 지울
            수 없습니다.
          </li>
          <li>'전체 초기화'는 지우기와 다릅니다. {NOTICE.reset}</li>
        </Section>
        <Section icon="alertTriangle" title="주소를 다른 사람에게 보내지 마세요" lead={SHARE_WARNING} />
      </div>
    </>
  );
}

function Section({ icon, title, lead, children }: { icon: IconName; title: string; lead: string; children?: ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>
        <Icon name={icon} size={17} />
        {title}
      </h2>
      <ul className={styles.list}>
        <li className={styles.lead}>{lead}</li>
        {children}
      </ul>
    </section>
  );
}
