/*
 * S8 이어서 하기 배너(설계서 S8, 시안 S8) — 이 탭에서 시작하지 않은 세션으로 S2~S4에 들어왔을 때만 보이고,
 * '새로 시작'은 '처음부터 다시'와 같은 확인 창 규칙을 따른다.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RETENTION_NOTE } from "../components/Notice";
import { ask, CHOICE_Q, NEXT, open, server } from "./questionsTesting";
import * as resultTesting from "./resultTesting";
import { fakeServer, json, renderApp } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const TITLE = "이전에 하던 확인을 이어서 보여 드립니다";
const banner = () => screen.queryByRole("region", { name: TITLE });

describe("S8 배너 — 보일 때", () => {
  it("주소로 바로 S3에 들어오면(새로 고침과 같음) 제목 아래에 배너와 '새로 시작'을 보인다", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    const b = banner()!;
    expect(b).toHaveTextContent("서버에 남아 있는 값으로 이어 갑니다. 처음부터 다시 하시려면 ‘새로 시작’을 눌러 주세요.");
    // 이어 갈 기록이 언제까지 남는지(서버 7일, Privacy.test.tsx가 서버 상수와 대조)
    expect(b).toHaveTextContent(RETENTION_NOTE);
    expect(within(b).getByRole("button", { name: "새로 시작" })).toBeInTheDocument();
    // 제목 아래 — 화면이 바뀌면 초점이 h1로 가므로 위에 두면 건너뛴다
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 주소 공유 주의는 S11 몫이라 넣지 않는다
    expect(b).not.toHaveTextContent("주소");
  });

  it("주소로 바로 S2·S4에 들어와도 보인다", async () => {
    fakeServer({
      "GET /v1/sessions/s-1": () =>
        json({ session_id: "s-1", values: { age: { value: 29, source: "LLM", at: "t", phrase: null } } }),
    });
    const { unmount } = renderApp("/s/s-1/confirm");
    await screen.findByRole("heading", { level: 1, name: "이렇게 읽었습니다" });
    expect(banner()).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();

    resultTesting.server();
    await resultTesting.open();
    expect(banner()).toBeInTheDocument();
  });
});

describe("S8 배너 — 보이지 않을 때", () => {
  it("이 탭에서 시작한 세션(앱 메모리에 있음)이면 보이지 않는다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q), "POST /v1/sessions": () => json({ session_id: "s-1" }, 201) });
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "항목을 직접 고르기" }));
    await screen.findByRole("region", { name: CHOICE_Q.label });
    expect(banner()).not.toBeInTheDocument();
  });

  it("이어 받은 세션도 같은 탭에서 다음 화면으로 넘어가면 다시 띄우지 않는다", async () => {
    const user = userEvent.setup();
    server({
      [NEXT]: () => ask(CHOICE_Q),
      [resultTesting.ASSESS]: () => resultTesting.assessment(resultTesting.program()),
    });
    await open();
    expect(banner()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "그만 묻고 지금까지로 결과 보기" }));
    await screen.findByRole("heading", { level: 1, name: "이 조건으로 본 결과" });
    expect(banner()).not.toBeInTheDocument();
  });
});

describe("S8 새로 시작", () => {
  it("지울 것이 있으면 '처음부터 다시'와 같은 확인 창을 띄우고, 처음부터를 누르면 S1로 간다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    await user.click(within(banner()!).getByRole("button", { name: "새로 시작" }));
    const dialog = screen.getByRole("alertdialog", { name: "처음부터 다시 할까요?" });
    expect(dialog).toHaveTextContent("서버에 남은 기록은 지금 지우지 않으며, 마지막으로 쓴 때로부터 7일 뒤 저절로 지워집니다. 바로 지우려면 ‘내 기록 지우기’를 누르세요.");
    await user.click(within(dialog).getByRole("button", { name: "처음부터" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
  });

  it("지울 것이 없으면(값도 기록도 없음) 확인 창 없이 바로 S1로 간다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q) }, {});
    await open();
    await waitFor(() => expect(screen.getByText(/지금까지 0개 확인/)).toBeInTheDocument());
    await user.click(within(banner()!).getByRole("button", { name: "새로 시작" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
  });
});
