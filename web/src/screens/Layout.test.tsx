import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";
import { callsTo, fakeServer, json, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("단계 표시는 주소로 정한다", () => {
  it.each([
    ["/write", "조건 입력"],
    ["/s/abc/confirm", "읽은 내용 확인"],
    ["/s/abc/questions", "하나씩 확인"],
    ["/s/abc/result", "판정 결과"],
  ])("%s 에서는 '%s'가 지금 단계다", async (path, name) => {
    fakeServer();
    renderApp(path);
    const steps = screen.getByRole("list", { name: "진행 단계" });
    expect(within(steps).getByText(name)).toHaveAttribute("aria-current", "step");
  });

  it("첫 화면에는 단계 표시가 없다 (시안 S0)", () => {
    fakeServer();
    renderApp("/");
    expect(screen.queryByRole("list", { name: "진행 단계" })).not.toBeInTheDocument();
  });

  it("S4 주소에는 판정 결과 화면이 그려진다", () => {
    fakeServer();
    renderApp("/s/abc/result");
    expect(screen.getByRole("heading", { level: 1, name: "이 조건으로 본 결과" })).toBeInTheDocument();
  });
});

describe("화면이 바뀔 때 초점", () => {
  // 실제 앱(main.tsx)은 StrictMode로 감싸 있어 개발 중에는 효과(effect)가 두 번 돈다
  it("StrictMode에서도 처음 연 화면에서는 초점을 옮기지 않고, 화면이 바뀌면 새 제목으로 옮긴다", async () => {
    const user = userEvent.setup();
    fakeServer();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </StrictMode>,
    );
    await screen.findByText("판정 서버에 연결됨");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);

    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "상황을 문장으로 적어 주세요" })).toHaveFocus(),
    );
  });
});

describe("연결 상태", () => {
  it("서버가 답하면 연결됨, 연결이 안 되면 연결되지 않음", async () => {
    fakeServer();
    const { unmount } = renderApp("/write");
    expect(await screen.findByText("판정 서버에 연결됨")).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();

    fakeServer({
      "GET /health": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/write");
    expect(await screen.findByText("판정 서버에 연결되지 않음")).toBeInTheDocument();
  });
});

const SENTENCE = "만 31세이고 연봉 5천입니다.";

describe("사이드바 — 전체 초기화와 내 기록 지우기", () => {
  it("전체 초기화는 초기화 확인 뒤 적은 문장을 비우고 첫 화면으로 간다. 서버에는 아무것도 보내지 않는다", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    renderApp("/write");
    await user.type(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" }), SENTENCE);

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);

    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" })).toHaveValue("");
    expect(server.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET")).toHaveLength(0);
  });

  it("지울 세션이 없으면 내 기록 지우기가 잠겨 있고, 주소에 세션이 있으면 눌린다", () => {
    fakeServer();
    const { unmount } = renderApp("/write");
    expect(screen.getByRole("button", { name: "내 기록 지우기" })).toHaveAttribute("aria-disabled", "true");
    unmount();
    renderApp("/s/s-7/questions");
    expect(screen.getByRole("button", { name: "내 기록 지우기" })).not.toHaveAttribute("aria-disabled");
  });

  it("내 기록 지우기는 확인(M2) 뒤 서버 세션을 지우고, 메모리를 비워 첫 화면으로 가며 완료를 알린다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": () => json({ session_id: "s-1" }, 201),
      "POST /v1/sessions/s-1/messages": () => json({ session_id: "s-1", values: {}, warnings: [], unreadable: {} }),
      "DELETE /v1/sessions/s-1": () => json({ session_id: "s-1", deleted: true }),
    }, { emptySession: true });
    renderApp("/write");
    await user.type(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" }), SENTENCE);
    await user.click(screen.getByRole("button", { name: "조건 읽기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));

    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "지우기" }));

    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1);
    expect(screen.getByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" })).toHaveValue("");
  });

  it("지우기가 실패하면 첫 화면으로 가지 않고 창 안에 다시 누르라고 알린다. 다시 눌러 성공하면 닫히고, 다시 열면 지난 문구가 없다", async () => {
    const user = userEvent.setup();
    let fail = true;
    fakeServer(
      {
        "DELETE /v1/sessions/s-7": () => (fail ? json({ detail: "고장" }, 500) : json({ session_id: "s-7", deleted: true })),
      },
      { emptySession: true },
    );
    renderApp("/s/s-7/confirm");
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));

    const dialog = await screen.findByRole("alertdialog", { name: "내 기록을 지울까요?" });
    await vi.waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("지우지 못했습니다. 잠시 뒤 다시 눌러 주세요"));
    expect(screen.getByTestId("location")).toHaveTextContent("/s/s-7/confirm");

    // 취소로 닫았다가 다시 열면 지난 실패 문구가 남아 있지 않다
    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("");

    fail = false;
    await user.click(screen.getByRole("button", { name: "지우기" }));
    // 주소 이동은 창 닫기보다 늦게 그려질 수 있어(라우터가 transition으로 옮김) 주소를 기다린다
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("내 기록 지우기는 확인 창을 거치고, 취소하면 지우지 않는다. 기본 초점은 취소", async () => {
    const user = userEvent.setup();
    const server = fakeServer({}, { emptySession: true });
    renderApp("/s/s-7/confirm");
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(callsTo(server, "DELETE /v1/sessions/s-7")).toHaveLength(0);
  });

  it("전체 초기화 확인 창: 본문은 RESET_NOTE에 적은 문장도 지워진다는 말을 더하고, 기본 초점은 계속하기, 계속하기면 그대로 둔다", async () => {
    const user = userEvent.setup();
    fakeServer();
    renderApp("/write");
    await user.type(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" }), SENTENCE);
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    const dialog = screen.getByRole("alertdialog", { name: "처음으로 돌아갈까요?" });
    expect(dialog).toHaveTextContent(
      "이 화면의 입력과 결과를 지우고 처음으로 돌아갑니다. 서버에 남은 기록은 지워지지 않습니다. 적어 두신 문장도 지워집니다.",
    );
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "계속하기" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
    expect(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" })).toHaveValue(SENTENCE);
  });

  it("전체 초기화는 지울 것이 없으면 묻지 않고 바로 처음으로 간다", async () => {
    const user = userEvent.setup();
    fakeServer();
    renderApp("/write");
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });
});

describe("내 기록 지우기 — 이 탭에서 연 세션을 모두 지운다", () => {
  const box = () => screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" });

  /** 세션을 열 때마다 s-1, s-2 … 를 준다 */
  function sessions() {
    let n = 0;
    return () => json({ session_id: `s-${++n}` }, 201);
  }
  const read = (id: string) => () => json({ session_id: id, values: {}, warnings: [], unreadable: {} });
  const deleted = (id: string) => () => json({ session_id: id, deleted: true });

  async function deleteAll(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
  }

  it("문장을 두 번 읽은 뒤(앞 한 번은 실패) 지우면 두 세션을 모두 지운다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "조건을 읽지 못했습니다" }, 503),
      "POST /v1/sessions/s-2/messages": read("s-2"),
      "DELETE /v1/sessions/s-1": deleted("s-1"),
      "DELETE /v1/sessions/s-2": deleted("s-2"),
    }, { emptySession: true });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(screen.getByRole("button", { name: "조건 읽기" }));
    await user.click(await screen.findByRole("button", { name: "다시 시도" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/confirm"));

    await deleteAll(user);
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1);
    expect(callsTo(server, "DELETE /v1/sessions/s-2")).toHaveLength(1);
    expect(screen.getByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();
  });

  it("전체 초기화 뒤에도 앞서 연 세션을 지울 수 있다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": read("s-1"),
      "DELETE /v1/sessions/s-1": deleted("s-1"),
    }, { emptySession: true });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(screen.getByRole("button", { name: "조건 읽기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    // 초기화는 서버에 아무것도 보내지 않는다
    expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(0);

    await deleteAll(user);
    await vi.waitFor(() => expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1));
    expect(await screen.findByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();
  });

  /** 문장을 두 번 읽어 세션 s-1, s-2를 연다. 끝나면 /s/s-2/confirm */
  async function readTwice(user: ReturnType<typeof userEvent.setup>) {
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(screen.getByRole("button", { name: "조건 읽기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));
    // S2는 항목 목록과 세션을 받은 뒤에 버튼을 그린다
    await user.click(await screen.findByRole("button", { name: "문장 다시 쓰기" }));
    await user.click(screen.getByRole("button", { name: "조건 읽기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/confirm"));
  }

  it("이미 없는 세션(404)이 섞여 있어도 지운 것으로 본다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": read("s-1"),
      "POST /v1/sessions/s-2/messages": read("s-2"),
      "DELETE /v1/sessions/s-1": () => json({ detail: "세션을 찾을 수 없습니다" }, 404),
      "DELETE /v1/sessions/s-2": deleted("s-2"),
    }, { emptySession: true });
    await readTwice(user);

    await deleteAll(user);
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1);
    expect(callsTo(server, "DELETE /v1/sessions/s-2")).toHaveLength(1);
    expect(screen.getByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();
  });

  it("일부만 실패하면 창 안에 알리고, 다시 누르면 실패한 것만 다시 지운다", async () => {
    const user = userEvent.setup();
    let broken = true;
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": read("s-1"),
      "POST /v1/sessions/s-2/messages": read("s-2"),
      "DELETE /v1/sessions/s-1": () => (broken ? json({ detail: "고장" }, 500) : deleted("s-1")()),
      "DELETE /v1/sessions/s-2": deleted("s-2"),
    }, { emptySession: true });
    await readTwice(user);

    await deleteAll(user);
    expect(await screen.findByText("지우지 못했습니다. 잠시 뒤 다시 눌러 주세요")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/confirm");

    broken = false;
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(2);
    // 처음에 지운 s-2는 주소에 남아 있어도 다시 보내지 않는다
    expect(callsTo(server, "DELETE /v1/sessions/s-2")).toHaveLength(1);
    expect(screen.getByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();
  });
});

describe("내 기록 지우기 — 주소로 들어와 이 탭에서 연 세션", () => {
  it("새로 고친 뒤 주소로 연 세션도 목록에 남아, S11로 옮겨도 잠기지 않고 그 세션을 지운다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "GET /v1/sessions/s-9": () => json({ session_id: "s-9", values: {} }),
      "DELETE /v1/sessions/s-9": () => json({ session_id: "s-9", deleted: true }),
    });
    // 주소로 바로 연다(새로 고침과 같음) — 이 탭에서 세션을 연 적이 없다
    renderApp("/s/s-9/confirm");
    await screen.findByRole("heading", { level: 1, name: "이렇게 읽었습니다" });
    const side = screen.getByRole("complementary", { name: "이 도구에 대해" });
    await user.click(within(side).getByRole("link", { name: "개인정보·이용 안내 자세히" }));
    await screen.findByRole("heading", { level: 1, name: "개인정보·이용 안내" });

    const button = screen.getByRole("button", { name: "내 기록 지우기" });
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await vi.waitFor(() => expect(callsTo(server, "DELETE /v1/sessions/s-9")).toHaveLength(1));
  });

  it("세션 화면이 아닌 주소(/s/:id/아무거나)로 열어도 주소의 세션을 목록에 넣는다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ "DELETE /v1/sessions/s-8": () => json({ session_id: "s-8", deleted: true }) });
    renderApp("/s/s-8/other");
    const side = screen.getByRole("complementary", { name: "이 도구에 대해" });
    await user.click(within(side).getByRole("link", { name: "개인정보·이용 안내 자세히" }));
    await screen.findByRole("heading", { level: 1, name: "개인정보·이용 안내" });
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await vi.waitFor(() => expect(callsTo(server, "DELETE /v1/sessions/s-8")).toHaveLength(1));
  });
});
