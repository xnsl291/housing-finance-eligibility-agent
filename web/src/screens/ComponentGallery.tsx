/*
 * 개발용 부품 모음(/_components). 시안 B0과 나란히 놓고 대조하려고 둔다.
 * 묶음 번호와 이름을 시안 B0과 같게 맞췄다(15 값 표는 tokens.css에 있어 뺐음).
 * 칸은 서버로 보낼 값을 바로 옆에 보여 준다 — 빈칸이 0이 되지 않는지 눈으로도 확인하려고.
 * 사용자 화면이 아니므로 화면 문구 규칙(8절)의 대상이 아니다.
 */
import { useState, type ReactNode } from "react";

import type { AmountRange, Status } from "../api/types";
import { AppHeader, StepIndicator } from "../components/AppHeader";
import { AmountField, RangeField } from "../components/AmountFields";
import { Button } from "../components/Button";
import { ChoiceList, YesNoField, type YesNo } from "../components/ChoiceFields";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateField, FieldError, NumberField, SelectField, TextField } from "../components/Field";
import { LoadingSentence, Skeleton, SystemError, Toast } from "../components/Feedback";
import { Notice, NOTICE } from "../components/Notice";
import { ProductCard } from "../components/ProductCard";
import { Provenance } from "../components/Provenance";
import { QuestionCard } from "../components/QuestionCard";
import { ReadItemRow } from "../components/ReadItemRow";
import { Sidebar } from "../components/Sidebar";
import { StopBanner } from "../components/StopBanner";
import { VerdictBadge } from "../components/VerdictBadge";
import styles from "./ComponentGallery.module.css";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATUSES: Status[] = ["PRECHECK_MATCH", "CONDITIONAL", "NOT_MATCHED", "INSUFFICIENT_INFORMATION"];

const PROGRAMS = [
  { program_id: "hug-youth-jeonse", program_name: "청년전용 버팀목전세자금", tenure: "JEONSE" as const },
  { program_id: "nhuf-beotimmok", program_name: "버팀목전세자금", tenure: "JEONSE" as const },
  { program_id: "nhuf-didimdol", program_name: "내집마련디딤돌대출", tenure: "PURCHASE" as const },
].map((p) => ({ ...p, organization: null, source_url: "", source_checked_at: "" }));

export function ComponentGallery() {
  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>공통 부품</h1>
      <p className={styles.sub}>개발용. 시안 B0과 나란히 놓고 대조합니다.</p>

      <Group n={1} title="판정 배지 4종">
        <div className={styles.row}>
          {STATUSES.map((s) => (
            <Labeled key={s} name={s}>
              <VerdictBadge status={s} />
            </Labeled>
          ))}
        </div>
      </Group>

      <Group n={2} title="버튼">
        <div className={styles.row}>
          <Labeled name="주 버튼 (누르면 2초 로딩)">
            <Button onClick={() => wait(2000)}>조건 읽기</Button>
          </Labeled>
          <Labeled name="보조 버튼">
            <Button variant="secondary">모르겠어요</Button>
          </Labeled>
          <Labeled name="잠긴 버튼">
            <Button lockedReason="칸이 비어 있어 아직 보낼 수 없습니다">답하기</Button>
          </Labeled>
          <Labeled name="글자 버튼">
            <Button variant="text" icon="arrowLeft">
              처음부터 다시
            </Button>
          </Labeled>
        </div>
      </Group>

      <Group n={3} title="칸 — 종류별">
        <FieldsDemo />
      </Group>

      <Group n={4} title="금액 칸과 범위 칸">
        <AmountDemo />
      </Group>

      <Group n={5} title="근거 한 줄">
        <div className={styles.stack}>
          <Provenance kind="read" phrase="연봉 4천만원" />
          <Provenance kind="range" phrase="4천 후반대" range="4,500만~5,000만원" />
          <Provenance kind="edited" phrase="연봉 4천" readValue="4,000만원" />
          <Provenance kind="direct" />
          <Provenance kind="cleared" />
        </div>
      </Group>

      <Group n={6} title="질문 카드 (S3)">
        <QuestionDemo />
      </Group>

      <Group n={7} title="멈춘 이유 배너">
        <div className={styles.stack}>
          <StopBanner reason="COMPLETE" />
          <StopBanner reason="ALL_NOT_MATCHED" />
          <StopBanner reason="ONLY_DECLINED_LEFT" declinedLabels={["세대주 여부", "순자산"]} />
          <StopBanner reason="USER_STOPPED" />
          <StopBanner reason={undefined} />
        </div>
      </Group>

      <Group n={8} title="고지 한 줄과 개인정보 안내">
        <div className={styles.stack}>
          {(Object.keys(NOTICE) as (keyof typeof NOTICE)[]).map((k) => (
            <Labeled key={k} name={k}>
              <Notice kind={k} />
            </Labeled>
          ))}
        </div>
      </Group>

      <Group n={9} title="로딩 3종">
        <div className={styles.grid3}>
          <Labeled name="1 · 문장 읽기 (10초 뒤 한 줄 더)">
            <LoadingSentence label="문장을 읽고 있습니다" />
          </Labeled>
          <Labeled name="2 · 버튼 안 (누르면 3초 로딩)">
            <Button onClick={() => wait(3000)}>답하기</Button>
          </Labeled>
          <Labeled name="3 · 첫 진입 뼈대">
            <Skeleton />
          </Labeled>
        </div>
      </Group>

      <Group n={10} title="오류 — 섞지 않습니다">
        <ErrorDemo />
      </Group>

      <Group n={11} title="확인 창">
        <DialogDemo />
      </Group>

      <Group n={12} title="단계 표시와 머리 영역">
        <div className={styles.stack}>
          <StepIndicator step={1} />
          <AppHeader step={1} connected />
        </div>
      </Group>

      <Group n={13} title="상품 카드">
        <ProductDemo />
      </Group>

      <Group n={14} title="완료 알림">
        <ToastDemo />
      </Group>

      <Group n={16} title="사이드바">
        <Sidebar
          programs={PROGRAMS}
          apiBase="http://127.0.0.1:8000"
          connected
          onReset={() => {}}
          onDeleteRecords={() => wait(1000)}
        />
      </Group>

      <Group n={17} title="읽은 항목 줄 (S2)">
        <ReadRowsDemo />
      </Group>
    </main>
  );
}

function Group({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.h2}>
        <span className={styles.n}>{n}</span> {title}
      </h2>
      {children}
    </section>
  );
}

function Labeled({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.labeled}>
      <span className={styles.name}>{name}</span>
      {children}
    </div>
  );
}

/** 서버로 보낼 값. undefined는 '아직 안 고름', null은 빈칸·모름 */
function Sent({ value }: { value: unknown }) {
  return <code className={styles.sent}>보낼 값: {value === undefined ? "(안 고름)" : JSON.stringify(value)}</code>;
}

function FieldsDemo() {
  const [text, setText] = useState<string | null>("서울특별시 관악구");
  const [age, setAge] = useState<number | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [first, setFirst] = useState<YesNo>("unknown");
  const [date, setDate] = useState<string | null>(null);
  return (
    <div className={styles.grid3}>
      <div>
        <TextField label="주택 소재지" value={text} onChange={setText} help="시·군·구까지만 적어 주세요" />
        <Sent value={text} />
      </div>
      <div>
        <NumberField label="나이" integer unit="만 나이" onChange={(v) => setAge(v)} help="비어 있습니다 — 화면이 대신 채우지 않습니다" />
        <Sent value={age} />
      </div>
      <div>
        <SelectField
          label="세대주 여부"
          value={head}
          options={[
            { value: "HEAD", label: "세대주임" },
            { value: "PROSPECTIVE_HEAD", label: "세대주 예정" },
          ]}
          onChange={setHead}
          help="첫 칸이 모름입니다"
        />
        <Sent value={head} />
      </div>
      <div>
        <YesNoField label="생애최초 주택구입" value={first} onChange={setFirst} withUnknown help="체크박스를 쓰지 않습니다(G4)" />
        <Sent value={first} />
      </div>
      <div>
        <DateField label="임대차계약 잔금지급일" value={date} onChange={setDate} />
        <Sent value={date} />
      </div>
      <TextField label="부부합산 총소득" value="50000000" onChange={() => {}} error="최소가 최대보다 큽니다" />
    </div>
  );
}

function AmountDemo() {
  const [deposit, setDeposit] = useState<number | null>(180_000_000);
  const [income, setIncome] = useState<number | null>(null);
  const [range, setRange] = useState<AmountRange | null>({ low: 45_000_000, high: 50_000_000 });
  return (
    <div className={styles.grid3}>
      <div>
        <AmountField label="임차보증금" defaultWon={180_000_000} onChange={(w) => setDeposit(w)} help="입력하는 동안에도 자릿수를 같이 보여 줍니다" />
        <Sent value={deposit} />
      </div>
      <div>
        <AmountField label="부부합산 총소득" onChange={(w) => setIncome(w)} help="0을 채우지 않습니다. 소득 0과 소득 모름은 판정이 다릅니다(G5)" />
        <Sent value={income} />
      </div>
      <div>
        <RangeField label="부부합산 총소득" defaultValue={{ low: 45_000_000, high: 50_000_000 }} onChange={(r) => setRange(r)} />
        <Sent value={range} />
      </div>
    </div>
  );
}

function QuestionDemo() {
  const [choice, setChoice] = useState<string | null>(null);
  return (
    <QuestionCard
      questionKey="household_head_status:1"
      title="세대주 여부"
      why="남은 상품 2개 모두 이 값이 있어야 판정할 수 있습니다"
      known="지금은 4,500만~5,000만원으로 알고 있습니다. 기준에 걸쳐 정확한 값이 필요합니다."
      howToCheck="국토교통부 주택도시기금 포털(nhuf.molit.go.kr)에서 확인할 수 있습니다"
      answerReady={choice !== null}
      onAnswer={() => wait(1500)}
      onDecline={() => wait(1500)}
    >
      {(titleId) => (
        <ChoiceList
          labelledBy={titleId}
          value={choice}
          options={[
            { value: "HEAD", label: "세대주임" },
            { value: "PROSPECTIVE_HEAD", label: "세대주 예정" },
          ]}
          onChange={setChoice}
        />
      )}
    </QuestionCard>
  );
}

function ErrorDemo() {
  return (
    <div className={styles.grid3}>
      <Labeled name="1 · 시스템 오류 — 본문 맨 위 전면">
        <SystemError title="지금 판정 서버에 연결할 수 없습니다" onRetry={() => wait(1000)}>
          조건의 문제가 아닙니다. 적어 두신 문장은 그대로 있습니다. 다시 쓰지 않으셔도 됩니다.
        </SystemError>
      </Labeled>
      <Labeled name="2 · 입력 오류 — 칸 바로 아래 한 줄">
        <FieldError id="gallery-error" message="1,000자까지 보낼 수 있습니다. 23자 줄여 주세요" />
      </Labeled>
      <Labeled name="3 · 판정 결과 — 오류가 아닙니다">
        <ProductCard
          name="내집마련디딤돌대출"
          status="NOT_MATCHED"
          limit={{ won: 144_000_000 }}
          unresolved={0}
          items={["임차보증금이 3억원을 넘음"]}
          sourceUrl="https://nhuf.molit.go.kr"
          details={<p>판정 근거(S5)가 여기에 들어갑니다.</p>}
        />
      </Labeled>
    </div>
  );
}

function DialogDemo() {
  const [which, setWhich] = useState<"M1" | "M2" | "M3" | null>(null);
  const close = () => setWhich(null);
  return (
    <div className={styles.row}>
      <Button variant="secondary" onClick={() => setWhich("M1")}>
        M1 처음부터 다시
      </Button>
      <Button variant="secondary" onClick={() => setWhich("M2")}>
        M2 내 기록 지우기
      </Button>
      <Button variant="secondary" onClick={() => setWhich("M3")}>
        M3 예시로 바꾸기
      </Button>
      <ConfirmDialog open={which === "M1"} title="처음부터 다시 할까요?" confirmLabel="처음부터" cancelLabel="계속하기" onConfirm={close} onCancel={close}>
        지금까지 고치고 답한 내용이 사라집니다. 처음부터 다시 할까요? 적어 두신 문장은 남습니다.
      </ConfirmDialog>
      <ConfirmDialog open={which === "M2"} title="내 기록을 지울까요?" confirmLabel="지우기" cancelLabel="취소" onConfirm={() => wait(1000).then(close)} onCancel={close}>
        읽어 낸 값과 답한 내용을 서버에서 지웁니다. 되돌릴 수 없습니다.
      </ConfirmDialog>
      <ConfirmDialog open={which === "M3"} title="적어 두신 문장을 예시로 바꿀까요?" confirmLabel="바꾸기" cancelLabel="취소" onConfirm={close} onCancel={close}>
        지금 칸에 있는 글이 예시 문장으로 바뀝니다. 되돌리려면 다시 적어야 합니다.
      </ConfirmDialog>
    </div>
  );
}

function ProductDemo() {
  return (
    <div className={styles.grid2}>
      <ProductCard
        name="청년전용 버팀목전세자금"
        status="PRECHECK_MATCH"
        limit={{ won: 144_000_000, note: "보증금 비율로 구한 1억 4,400만원과 금액 상한 2억원 중 작은 쪽입니다 — 보증금 비율에 걸렸습니다" }}
        unresolved={0}
        items={["생애최초 주택구입에 해당하면 한도가 더 늘어날 수 있습니다"]}
        sourceUrl="https://nhuf.molit.go.kr"
        details={<p>판정 근거(S5)가 여기에 들어갑니다.</p>}
      />
      <ProductCard
        name="버팀목전세자금"
        status="INSUFFICIENT_INFORMATION"
        limit={{ won: 144_000_000 }}
        unresolved={3}
        items={["세대 구성 정보가 필요합니다", "순자산 정보가 필요합니다"]}
        sourceUrl="https://nhuf.molit.go.kr"
        details={<p>판정 근거(S5)가 여기에 들어갑니다.</p>}
      />
      <ProductCard
        name="버팀목전세자금"
        status="CONDITIONAL"
        limit={{ won: null, reason: "BASE_IMPRECISE" }}
        unresolved={1}
        items={["부부합산 총소득이 기준에 걸칩니다. 정확한 값을 알려주세요"]}
        sourceUrl="https://nhuf.molit.go.kr"
        details={<p>판정 근거(S5)가 여기에 들어갑니다.</p>}
      />
    </div>
  );
}

function ToastDemo() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => setMessage("결과를 복사했습니다")}>
        완료 알림 띄우기
      </Button>
      <Toast message={message} onClose={() => setMessage(null)} />
    </>
  );
}

function ReadRowsDemo() {
  return (
    <div className={styles.stack}>
      <ReadItemRow
        label="나이"
        value="29"
        unit="만 나이"
        provenance={<Provenance kind="read" phrase="만 29세 직장인" />}
        editor={<NumberField label="나이" integer defaultValue={29} unit="만 나이" onChange={() => {}} />}
      />
      <ReadItemRow
        label="부부합산 총소득"
        value="4,500만~5,000만원"
        provenance={<Provenance kind="range" phrase="4천 후반대" range="4,500만~5,000만원" />}
        editor={<RangeField label="부부합산 총소득" defaultValue={{ low: 45_000_000, high: 50_000_000 }} onChange={() => {}} />}
      />
      <ReadItemRow
        label="임차보증금"
        value="1억 8,000만원"
        provenance={<Provenance kind="edited" phrase="보증금 1억8천" readValue="1억 8,000만원" />}
        editor={<AmountField label="임차보증금" defaultWon={180_000_000} onChange={() => {}} />}
      />
      <ReadItemRow
        label="주택 소재지"
        value="서울특별시"
        provenance={<Provenance kind="direct" />}
        editor={<TextField label="주택 소재지" value="서울특별시" onChange={() => {}} />}
      />
      <ReadItemRow
        label="무주택 여부"
        value={null}
        provenance={<Provenance kind="cleared" />}
        editor={<YesNoField label="무주택 여부" value="unknown" withUnknown onChange={() => {}} />}
      />
    </div>
  );
}
