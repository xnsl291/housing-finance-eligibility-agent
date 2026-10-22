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

  it("지우기가 실패하면 첫 화면으로 가지 않고 창 안에 다시 누르라고 알린다", async () => {
    const user = userEvent.setup();
    fakeServer({ "DELETE /v1/sessions/s-7": () => json({ detail: "고장" }, 500) }, { emptySession: true });
    renderApp("/s/s-7/confirm");
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));

    expect(await screen.findByText("지우지 못했습니다. 잠시 뒤 다시 눌러 주세요")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/s/s-7/confirm");
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
