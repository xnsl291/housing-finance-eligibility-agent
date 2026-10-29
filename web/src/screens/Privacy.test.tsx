/*
 * S11 개인정보·이용 안내 — 고지 문구(components/Notice.tsx)와 같은 말을 하는 줄은 그 문장 그대로, 보관 기간은 서버 상수(7일)와 대조, 주소 공유 주의,
 * 첫 화면(S0)·사이드바에서 들어오는 링크.
 * 고지 문구의 정본은 Notice.tsx다(옛 Streamlit 화면을 지우면서 서버 쪽 상수와의 대조는 없어졌다). 서버 파일에서
 * 읽어 대조하는 것은 가리는 정규식(extraction.py)과 가리는 자리·보관 기간(session.py)이다.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import extractionPy from "../../../src/housing_finance_agent/extraction.py?raw";
import apiPy from "../../../src/housing_finance_agent/api.py?raw";
import sessionPy from "../../../src/housing_finance_agent/session.py?raw";

import { DELETE_NOTE, NOTICE, RETENTION_NOTE } from "../components/Notice";
import {
  MASK_SCOPE,
  MASK_SHAPES,
  RETENTION_READS,
  RETENTION_TIMING,
  RETENTION_WRITES,
  SHARE_WARNING,
  UNDELETABLE_BOUND,
  sentences,
} from "./Privacy";
import { fakeServer, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

const PRIVACY_NOTE = NOTICE.privacy;
const PRIVACY_NOTICE = NOTICE.input;
const RESET_NOTE = NOTICE.reset;

function openPage() {
  fakeServer();
  renderApp("/privacy");
  return screen.getByRole("heading", { level: 1, name: "개인정보·이용 안내" });
}

const section = (title: string) => screen.getByRole("region", { name: title });

describe("S11 개인정보·이용 안내", () => {
  it("상수를 문장으로 잘라도 이어 붙이면 원문 그대로다 — 자르다가 글자를 잃지 않는다", () => {
    expect(sentences(PRIVACY_NOTE)).toHaveLength(4);
    expect(sentences(PRIVACY_NOTE).join(" ")).toBe(PRIVACY_NOTE);
    expect(sentences(PRIVACY_NOTICE).join(" ")).toBe(PRIVACY_NOTICE);
  });

  it("남지 않는 것·남는 것·가리는 것·지우는 방법의 첫 줄은 PRIVACY_NOTE의 문장 그대로", () => {
    openPage();
    const [notKept, kept, masked, deletable] = sentences(PRIVACY_NOTE);
    expect(within(section("무엇이 남지 않는가")).getAllByRole("listitem")[0].textContent).toBe(notKept);
    expect(within(section("무엇이 남는가")).getAllByRole("listitem")[0].textContent).toBe(kept);
    expect(within(section("가리는 것과 가리지 못하는 것")).getAllByRole("listitem")[0].textContent).toBe(masked);
    expect(within(section("지우는 방법")).getAllByRole("listitem")[0].textContent).toBe(deletable);
  });

  it("남는 것에 근거 구절이 들어간다 — 값만 남는다고 줄여 말하지 않는다(C-COPY)", () => {
    openPage();
    const kept = section("무엇이 남는가");
    for (const phrase of ["근거가 된 문장 일부", "답한 값", "모른다고 한 항목", "세션 파일", "다시 켜도 남습니다", "근거 구절"]) {
      expect(kept).toHaveTextContent(phrase);
    }
    expect(kept.textContent).not.toMatch(/만\s*(남|저장)/);
  });

  it("근거 구절은 값마다 있다고 말하지 않는다 — 근거 구절이 없는 값도 있다(직접 넣은 값, 모델이 근거를 붙이지 않은 값)", () => {
    openPage();
    const kept = section("무엇이 남는가");
    expect(kept).toHaveTextContent("근거로 쓴 문장 일부(근거 구절)가 함께 남을 수 있습니다");
    expect(kept.textContent).not.toMatch(/값마다/);
  });

  it("값으로 바꾸지 못한 원문도 남는다고 적는다 — 서버가 읽지 못한 값(unreadable)도 기록에 남긴다(#45)", () => {
    openPage();
    expect(section("무엇이 남는가")).toHaveTextContent("값으로 바꾸지 못한 표현");
    // 서버가 그 원문을 가린 뒤 저장한다 — 그래야 '가린 뒤 저장합니다'가 이 줄에도 맞다
    expect(sessionPy).toMatch(/"unreadable": \{\s*name: scrub\(str\(text\)\)/);
  });

  it("가리지 못하는 것은 PRIVACY_NOTICE의 문장 그대로 — 주소는 가리지 못한다는 뜻이 남는다(D8)", () => {
    openPage();
    const notice = sentences(PRIVACY_NOTICE);
    const lines = within(section("가리는 것과 가리지 못하는 것"))
      .getAllByRole("listitem")
      .slice(1, 1 + notice.length)
      .map((li) => li.textContent);
    expect(lines).toEqual(notice);
    expect(lines.join(" ")).toContain("집 주소는 가리지 못합니다");
  });

  it("가리는 모양은 서버 정규식(extraction.py _SENSITIVE) 두 가지뿐이고, 그 밖(이름·주소·전화번호 등)은 가리지 않는다고 적는다", () => {
    // 서버가 가리는 모양이 바뀌면(종류가 늘거나 자릿수가 바뀌면) 이 테스트가 깨져 문구를 다시 보게 한다
    const block = /^_SENSITIVE = \(([\s\S]*?)^\)/m.exec(extractionPy)![1];
    const patterns = [...block.matchAll(/re\.compile\(r"([^"]+)"\), "([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(patterns).toEqual([
      [String.raw`(?<!\d)\d{6}\s*-\s*\d{7}(?!\d)`, "주민등록번호"],
      [String.raw`(?<!\d)\d{2,3}-\d{2,6}-\d{2,6}(?!\d)`, "계좌번호"],
    ]);
    // 문구의 예가 실제 정규식과 맞는지 — 가려지는 것과 안 가려지는 것
    const masks = (text: string) => patterns.some(([p]) => new RegExp(p).test(text));
    expect(masks("010-1234-5678")).toBe(true);
    expect(masks("01012345678")).toBe(false);
    expect(masks("1002-123-456789")).toBe(false);

    openPage();
    const masked = section("가리는 것과 가리지 못하는 것");
    expect(masked).toHaveTextContent(MASK_SHAPES);
    expect(masked).toHaveTextContent(MASK_SCOPE);
    // 서버가 글 칸 값도 가린다(#47). 이 처리가 사라지면 MASK_SCOPE가 거짓이 된다.
    expect(sessionPy).toMatch(/scrub\(value\) if isinstance\(value, str\) and kind_of\(name\) == "TEXT"/);
    for (const phrase of ["6자리-7자리", "2~3자리-2~6자리-2~6자리", "이름·주소·이메일", "010-1234-5678"]) {
      expect(MASK_SHAPES).toContain(phrase);
    }
  });

  it("보관 기간은 서버 상수(session.py RETENTION)와 같은 7일이고, 쓰기만 기간을 늘린다고 적는다", () => {
    // 서버 기간이 바뀌면 이 줄이 깨져 문구를 다시 보게 한다
    expect(sessionPy).toMatch(/^RETENTION = timedelta\(days=7\)\r?$/m);
    // 서버가 기간을 세는 기준: 마지막 기록 시각(없으면 연 시각)
    expect(sessionPy).toMatch(/_LAST_USED = "COALESCE\(\(SELECT MAX\(at\) FROM events/);
    openPage();
    const when = section("언제 지워지는가");
    const lines = within(when).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toBe(RETENTION_NOTE);
    expect(lines).toContain(RETENTION_WRITES);
    expect(lines).toContain(RETENTION_READS);
    expect(lines).toContain(RETENTION_TIMING);
    // 기간을 말하는 숫자는 7일뿐이다
    const periods = [...(when.textContent ?? "").matchAll(/\d+\s*(일|개월|년|시간)/g)].map((m) => m[0]);
    expect(new Set(periods)).toEqual(new Set(["7일"]));
    expect(when.textContent).not.toMatch(/정해지지 않|저절로 지우지 않/);
  });

  it("파일에서 지우는 때는 서버가 실제로 지우는 때와 같다 — 켜져 있으면 한 시간마다, 꺼져 있었으면 켤 때", () => {
    // 한 시간마다: SWEEP_EVERY 상수와 앱 수명이 그 간격으로 sweep을 부르는 줄
    expect(sessionPy).toMatch(/^SWEEP_EVERY = timedelta\(hours=1\)\r?$/m);
    expect(apiPy).toMatch(/sweep_every: timedelta = SWEEP_EVERY/);
    expect(apiPy).toMatch(/await asyncio\.sleep\(sweep_every\.total_seconds\(\)\)/);
    expect(apiPy).toMatch(/await asyncio\.to_thread\(store\.sweep\)/);
    // 켤 때: 저장소를 열면(서버를 켜면) 곧바로 sweep
    expect(sessionPy).toMatch(/self\._db\.commit\(\)\r?\n\s+self\.sweep\(\)/);
    expect(RETENTION_TIMING).toContain("한 시간 안에");
    expect(RETENTION_TIMING).toContain("다음에 켤 때");
    // 열 수 없게 되는 것은 곧바로다(exists가 기간을 본다) — 첫 줄이 그 말을 한다
    expect(RETENTION_NOTE).toContain("열 수 없게 되고");
  });

  it("'쓴 때'에 문장 보내기가 들어간다 — 읽어 낸 값이 없어도 문장을 보내면 기록이 남는다(record_extraction)", () => {
    expect(RETENTION_WRITES).toMatch(/^'쓴 때'는 문장을 보내거나 값을 넣거나 고친 때/);
    // 다시 판정해 기간이 느는 결과 화면과 어긋나지 않게, 읽기는 두 화면으로만 말한다
    expect(RETENTION_READS).toContain("읽은 내용 확인·하나씩 확인 두 화면은");
    expect(RETENTION_READS).not.toMatch(/판정 결과/);
  });

  it("사이드바 개인정보 안내와 전체 초기화 안내도 7일을 말한다 — '지워지지 않습니다'로 영영 남는 것처럼 읽히지 않게", () => {
    expect(sentences(PRIVACY_NOTE)[3]).toContain("7일이 지나면 저절로 지워집니다");
    expect(RESET_NOTE).toContain("지금 지우지 않습니다");
    expect(RESET_NOTE).toContain("7일 뒤 저절로 지워지고");
    expect(RESET_NOTE).not.toContain("지워지지 않습니다");
  });

  it("지우는 방법은 이 탭에서 연 기록을 모두 지운다는 것과 새로 고친 뒤의 한계를 말하고, DELETE_NOTE·RESET_NOTE를 그대로 쓴다", () => {
    openPage();
    const how = section("지우는 방법");
    expect(how).toHaveTextContent("이 탭에서 연 확인 기록을 모두 서버에서 지웁니다");
    expect(how).toHaveTextContent("새로 고치거나");
    // 새로 고친 뒤에도 이 탭에서 연 주소의 기록은 지울 수 있다(Layout이 주소의 세션을 목록에 넣음). 그 전에 연 기록은 빠진다
    expect(how).toHaveTextContent("그 전에 연 기록의 번호를 화면이 잊어 지울 수 없게 됩니다");
    expect(how).toHaveTextContent("이 탭에서 연 기록은 화면이 기억하므로, 다른 화면으로 옮겨도 지울 수 있습니다");
    expect(how.textContent).not.toContain("그 주소의 기록만 지웁니다");
    // D-39의 남은 빈틈 — 번호를 받지 못한 기록
    expect(how).toHaveTextContent("시간 초과로 끊겨 화면이 기록 번호를 받지 못했으면");
    // 그 빈틈도 서버 보관 기간(7일)으로 끝이 있다
    expect(within(how).getAllByRole("listitem").map((li) => li.textContent)).toContain(UNDELETABLE_BOUND);
    expect(how.textContent).toContain(DELETE_NOTE);
    expect(how.textContent).toContain(RESET_NOTE);
    // 가리키는 버튼과 제목이 실제로 사이드바에 있다
    const side = screen.getByRole("complementary", { name: "이 도구에 대해" });
    expect(within(side).getByRole("heading", { name: "개인정보 안내" })).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: "내 기록 지우기" })).toBeInTheDocument();
  });

  it("주소 공유 주의(시안 S8 문구 그대로)", () => {
    openPage();
    expect(SHARE_WARNING).toBe(
      "이 페이지 주소에는 확인 기록을 되찾는 번호가 들어 있습니다. 주소를 다른 사람에게 보내지 마세요 — 받은 사람이 입력하신 값을 그대로 보게 됩니다.",
    );
    expect(within(section("주소를 다른 사람에게 보내지 마세요")).getByRole("listitem").textContent).toBe(SHARE_WARNING);
  });

  it("'저장하지 않습니다'를 남는 것에 대해 말하지 않는다 — 문장 전체 말고는 저장하지 않는다는 말이 없다(G12)", () => {
    openPage();
    const all = screen.getByRole("main").textContent ?? "";
    const notSaved = all.match(/[^.]*저장하지 않[^.]*\./g) ?? [];
    for (const line of notSaved) expect(line).toMatch(/문장 전체는 저장하지 않/);
  });
});

describe("S11로 들어오는 링크", () => {
  it("첫 화면(S0) 개인정보 한 줄의 링크로 같은 탭 안에서 옮긴다", async () => {
    fakeServer();
    renderApp("/");
    const start = screen.getByRole("region", { name: "시작하기" });
    await userEvent.click(within(start).getByRole("link", { name: "개인정보·이용 안내" }));
    expect(await screen.findByRole("heading", { level: 1, name: "개인정보·이용 안내" })).toBeInTheDocument();
  });

  it("사이드바 개인정보 안내 아래 '자세히' 링크", async () => {
    fakeServer();
    renderApp("/write");
    const side = screen.getByRole("complementary", { name: "이 도구에 대해" });
    await userEvent.click(within(side).getByRole("link", { name: "개인정보·이용 안내 자세히" }));
    expect(await screen.findByRole("heading", { level: 1, name: "개인정보·이용 안내" })).toBeInTheDocument();
  });
});
