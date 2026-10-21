import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 예시 문장이 서버 쪽 화면 상수와 같은지 대조한다(Feedback.test.tsx와 같은 방식)
import inputPy from "../../../src/housing_finance_agent/ui/screens/input.py?raw";

import { callsTo, fakeServer, json, renderApp } from "./testing";
import { EXAMPLES } from "./Write";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SENTENCE = "만 31세이고 연봉 5천입니다.";

function box() {
  return screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" });
}

function readButton() {
  return screen.getByRole("button", { name: "조건 읽기" });
}

/** 세션을 열 때마다 s-1, s-2 … 를 준다 */
function sessions() {
  let n = 0;
  return () => json({ session_id: `s-${++n}` }, 201);
}

function extracted(id: string) {
  return json({
    session_id: id,
    values: {},
    warnings: ["주민등록번호로 보이는 내용이 있어 저장하지 않았습니다"],
    unreadable: { exclusive_area: "25평" },
  });
}

describe("S1 글자 수와 잠김", () => {
  it("빈 칸이면 조건 읽기가 잠기고 잠긴 이유를 한 줄로 알린다", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    renderApp("/write");

    expect(readButton()).toHaveAttribute("aria-disabled", "true");
    expect(readButton()).toHaveAccessibleDescription("칸이 비어 있어 아직 보낼 수 없습니다. 한 문장이라도 적으면 눌러집니다.");
    await user.click(readButton());
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(0);

    // 빈칸만 친 것도 빈 칸이다
    await user.type(box(), "   ");
    expect(readButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("글자 수를 '적은 수 / 1,000자 (남은 글자 N)'로 보이고, 이모지 한 글자는 한 자로 센다", async () => {
    const user = userEvent.setup();
    fakeServer();
    renderApp("/write");
    expect(screen.getByText("0 / 1,000자 (남은 글자 1,000)")).toBeInTheDocument();

    await user.type(box(), "가나다😀");
    expect(screen.getByText("4 / 1,000자 (남은 글자 996)")).toBeInTheDocument();
    expect(readButton()).not.toHaveAttribute("aria-disabled");
  });

  it("1,000자를 넘기면 칸 아래 오류와 함께 잠기고, 정확히 1,000자는 보낼 수 있다", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    renderApp("/write");

    await user.click(box());
    await user.paste("가".repeat(1023));
    expect(screen.getByText("1,023 / 1,000자")).toBeInTheDocument();
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(box()).toHaveAccessibleDescription(/1,000자까지 보낼 수 있습니다\. 23자 줄여 주세요/);
    expect(readButton()).toHaveAttribute("aria-disabled", "true");
    expect(readButton()).toHaveAccessibleDescription("1,000자를 넘어 아직 보낼 수 없습니다.");
    await user.click(readButton());
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(0);

    await user.type(box(), "{Backspace}".repeat(23));
    expect(screen.getByText("1,000 / 1,000자 (남은 글자 0)")).toBeInTheDocument();
    expect(readButton()).not.toHaveAttribute("aria-disabled");
  });
});

describe("S1 예시 버튼", () => {
  it("예시 문장은 서버 쪽 화면 상수와 글자 그대로 같다", () => {
    const pyStrings = (inputPy.split("EXAMPLES")[1] ?? "").match(/"[^"]*"/g) ?? [];
    const joined = pyStrings.map((s) => s.slice(1, -1)).join("");
    for (const ex of EXAMPLES) {
      expect(joined).toContain(ex.name);
      expect(joined).toContain(ex.text);
    }
  });

  it("칸이 비어 있으면 묻지 않고 바로 넣는다", async () => {
    const user = userEvent.setup();
    fakeServer();
    renderApp("/write");
    await user.click(screen.getByRole("button", { name: /혼자 사는 직장인/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(box()).toHaveValue(EXAMPLES[0].text);
  });

  it("칸에 글이 있으면 확인 창(M3)을 띄우고, 기본 초점은 취소다. 취소하면 글이 그대로 있다", async () => {
    const user = userEvent.setup();
    fakeServer();
    renderApp("/write");
    await user.type(box(), SENTENCE);

    await user.click(screen.getByRole("button", { name: /결혼 준비 중인 맞벌이/ }));
    expect(screen.getByRole("alertdialog", { name: "적어 두신 문장을 예시로 바꿀까요?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(box()).toHaveValue(SENTENCE);

    await user.click(screen.getByRole("button", { name: /결혼 준비 중인 맞벌이/ }));
    await user.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(box()).toHaveValue(EXAMPLES[1].text);
  });
});

describe("S1 조건 읽기", () => {
  it("세션을 열고 문장을 보낸 뒤 S2로 간다. 경고와 못 읽은 값은 라우터 state로 넘긴다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => extracted("s-1"),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));
    const [, init] = callsTo(server, "POST /v1/sessions/s-1/messages")[0];
    expect(JSON.parse(String(init?.body))).toEqual({ message: SENTENCE });
    expect(JSON.parse(screen.getByTestId("location").dataset.state ?? "null")).toEqual({
      warnings: ["주민등록번호로 보이는 내용이 있어 저장하지 않았습니다"],
      unreadable: { exclusive_area: "25평" },
    });
    // 초점은 화면이 그려진 뒤의 효과(effect)에서 옮겨지므로 기다린다
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "읽은 내용 확인" })).toHaveFocus());
  });

  it("기다리는 동안 '문장을 읽고 있습니다'를 보이고 칸을 고칠 수 없다", async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => {};
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    expect(await screen.findByText("문장을 읽고 있습니다")).toBeInTheDocument();
    expect(box()).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "조건 읽기" })).not.toBeInTheDocument();

    await act(async () => answer(extracted("s-1")));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));
  });

  it("조건 읽기를 누르면 버튼이 기다림 표시로 바뀌어도 키보드 초점이 페이지 밖(body)으로 떨어지지 않는다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => new Promise<Response>(() => {}),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    readButton().focus();
    await user.keyboard("{Enter}");

    const loading = await screen.findByText("문장을 읽고 있습니다");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(loading);
  });

  it("실패 뒤 다시 시도를 누르면 상자가 사라져도 초점이 body로 떨어지지 않는다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "조건을 읽지 못했습니다" }, 503),
      "POST /v1/sessions/s-2/messages": () => new Promise<Response>(() => {}),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());
    const region = await screen.findByRole("region", { name: "조건을 읽지 못했습니다" });

    within(region).getByRole("button", { name: "다시 시도" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByText("문장을 읽고 있습니다");
    expect(document.activeElement).not.toBe(document.body);
  });

  it("같은 순간 두 번 눌러도 한 번만 보낸다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => extracted("s-1"),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);

    // 한 act 안에서 두 번 눌러야 그 사이에 화면이 다시 그려지지 않는다(= 같은 순간).
    // fireEvent를 두 번 부르면 첫 번째 뒤에 화면이 바뀌어 두 번째가 떨어진 버튼을 누르게 된다
    const button = readButton();
    act(() => {
      button.click();
      button.click();
    });
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/confirm"));
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(1);
    expect(callsTo(server, "POST /v1/sessions/s-1/messages")).toHaveLength(1);
  });

  it("S2에서 '문장 다시 쓰기'로 돌아오면 적은 문장이 그대로 있다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => extracted("s-1"),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());
    await user.click(await screen.findByRole("button", { name: "문장 다시 쓰기" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/write");
    expect(box()).toHaveValue(SENTENCE);
  });
});

describe("S1 서버에 연결되지 않음 (E1, 결함 D5)", () => {
  const OFFLINE = "서버에 연결되지 않아 지금은 보낼 수 없습니다.";

  it("연결 확인이 실패하면 본문 맨 위에 시스템 오류를 띄우고, 칸은 쓸 수 있게 둔 채 조건 읽기만 잠근다", async () => {
    const user = userEvent.setup();
    let up = false;
    const server = fakeServer({
      "GET /health": () => {
        if (!up) throw new TypeError("Failed to fetch");
        return json({ status: "ok", programs: [] });
      },
    });
    renderApp("/write");

    const region = await screen.findByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" });
    expect(region).toHaveTextContent("조건의 문제가 아닙니다.");
    // 본문 맨 위: 화면 제목보다 앞에 있다
    const title = screen.getByRole("heading", { level: 1, name: "상황을 문장으로 적어 주세요" });
    expect(region.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(box(), SENTENCE);
    expect(box()).toHaveValue(SENTENCE);
    expect(box()).not.toHaveAttribute("readonly");
    expect(region).toHaveTextContent("적어 두신 문장은 그대로 있습니다.");
    expect(readButton()).toHaveAttribute("aria-disabled", "true");
    expect(readButton()).toHaveAccessibleDescription(OFFLINE);
    await user.click(readButton());
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(0);

    // 다시 연결 확인 → 연결 확인을 다시 부르고, 돌아오면 상자를 걷고 잠금을 푼다. 같은 화면에 머문다
    up = true;
    await user.click(within(region).getByRole("button", { name: "다시 연결 확인" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" })).not.toBeInTheDocument(),
    );
    expect(readButton()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
    expect(box()).toHaveValue(SENTENCE);
  });

  it("조건 읽기에서 연결이 안 되면 연결 상태를 끊김으로 바꿔 머리·사이드바도 맞춘다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/write");
    expect(await screen.findByText("판정 서버에 연결됨")).toBeInTheDocument();
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    await screen.findByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" });
    expect(screen.getByText("판정 서버에 연결되지 않음")).toBeInTheDocument();
    expect(screen.getByText("연결 안 됨")).toBeInTheDocument();
    expect(readButton()).toHaveAccessibleDescription(OFFLINE);
    // 같은 내용의 상자가 둘 뜨지 않는다
    expect(screen.getAllByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" })).toHaveLength(1);
  });
});

describe("S1 화면을 떠난 뒤 늦게 온 응답", () => {
  it("읽는 중에 전체 초기화로 떠나면 답이 와도 S2로 끌고 가지 않는다. 열린 세션은 지울 수 있게 남는다", async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => {};
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => new Promise<Response>((resolve) => (answer = resolve)),
      "DELETE /v1/sessions/s-1": () => json({ session_id: "s-1", deleted: true }),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());
    await screen.findByText("문장을 읽고 있습니다");

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);

    await act(async () => answer(extracted("s-1")));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);

    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await vi.waitFor(() => expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1));
  });

  it("읽는 중에 떠난 뒤 실패가 와도 다른 화면에 영향이 없다", async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => {};
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());
    await screen.findByText("문장을 읽고 있습니다");
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "처음으로" }));

    await act(async () => answer(json({ detail: "조건을 읽지 못했습니다" }, 503)));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.queryByRole("region", { name: "조건을 읽지 못했습니다" })).not.toBeInTheDocument();
  });
});

describe("S1 실패 — 종류마다 다르게 말하고, 적은 문장은 그대로 둔다 (결함 D14)", () => {
  it("서버에 연결되지 않으면 연결 안내", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    const region = await screen.findByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" });
    expect(within(region).getByRole("heading")).toHaveFocus();
    expect(region).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(region).toHaveTextContent("적어 두신 문장은 그대로 있습니다. 다시 쓰지 않으셔도 됩니다.");
    expect(box()).toHaveValue(SENTENCE);
    expect(screen.queryByRole("button", { name: "직접 입력으로 넘어가기" })).not.toBeInTheDocument();
  });

  it("문장 읽기가 너무 오래 걸리면 시간 초과 안내 — 서버가 꺼졌다고 말하지 않는다 (E3)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText("조금 더 걸리고 있습니다")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(130_000));
    const region = await screen.findByRole("region", { name: "문장을 읽는 데 너무 오래 걸려 중단했습니다" });
    expect(region).toHaveTextContent("서버는 켜져 있습니다.");
    expect(region).toHaveTextContent("적어 두신 문장은 그대로 있습니다.");
    expect(region).not.toHaveTextContent("연결할 수 없");
    expect(box()).toHaveValue(SENTENCE);
    expect(screen.getByRole("button", { name: "직접 입력으로 넘어가기" })).toBeInTheDocument();
  });

  it("문장을 못 읽으면(503) 조건 문제가 아니라고 말하고, 직접 입력으로 넘어가면 새 세션으로 질문 화면에 간다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "LLM 호출에 실패했습니다: 연결 거부" }, 503),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    const region = await screen.findByRole("region", { name: "조건을 읽지 못했습니다" });
    expect(region).toHaveTextContent("문장 해석이 실패한 것이고 조건에 문제가 있는 것은 아닙니다.");
    expect(region).toHaveTextContent("적어 두신 문장은 그대로 있습니다.");
    expect(box()).toHaveValue(SENTENCE);

    await user.click(screen.getByRole("button", { name: "직접 입력으로 넘어가기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/questions"));
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(2);
  });

  it("그 밖의 거절은 서버가 준 문구를 그대로 보인다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "세션 파일을 쓰지 못했습니다" }, 500),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    const region = await screen.findByRole("region", { name: "요청을 처리하지 못했습니다" });
    expect(region).toHaveTextContent("세션 파일을 쓰지 못했습니다");
    expect(region).toHaveTextContent("적어 두신 문장은 그대로 있습니다.");
    expect(box()).toHaveValue(SENTENCE);
  });

  it("서버가 문장을 거절하면(422) 시스템 오류 상자가 아니라 칸 바로 아래 입력 오류로 보인다 (C-ERROR)", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "문장이 1,000자를 넘습니다" }, 422),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    await vi.waitFor(() => expect(box()).toHaveAccessibleDescription(/문장이 1,000자를 넘습니다/));
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("region", { name: "요청을 처리하지 못했습니다" })).not.toBeInTheDocument();
    expect(box()).toHaveValue(SENTENCE);
    // 고쳐서 다시 보낼 수 있게 조건 읽기가 그대로 있다. 고치면 오류를 걷는다
    expect(readButton()).not.toHaveAttribute("aria-disabled");
    await user.type(box(), " 무주택입니다.");
    expect(box()).not.toHaveAttribute("aria-invalid");
  });

  it("중계가 시간 초과(504)를 알려 오면 시간 초과로 말한다 — 거절로 보이지 않는다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => new Response("Gateway Timeout", { status: 504 }),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    const region = await screen.findByRole("region", { name: "문장을 읽는 데 너무 오래 걸려 중단했습니다" });
    expect(region).not.toHaveTextContent("HTTP 504");
    expect(screen.getByRole("button", { name: "직접 입력으로 넘어가기" })).toBeInTheDocument();
  });

  it("실패한 뒤 다시 시도하면 새 세션을 열어 보낸다", async () => {
    const user = userEvent.setup();
    const server = fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "조건을 읽지 못했습니다: 형식 오류" }, 503),
      "POST /v1/sessions/s-2/messages": () => extracted("s-2"),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());

    const region = await screen.findByRole("region", { name: "조건을 읽지 못했습니다" });
    await user.click(within(region).getByRole("button", { name: "다시 시도" }));

    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/confirm"));
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(2);
    expect(callsTo(server, "POST /v1/sessions/s-2/messages")).toHaveLength(1);
  });

  it("실패 안내가 떠 있을 때 문장을 고치면 안내를 걷고 조건 읽기를 다시 보인다", async () => {
    const user = userEvent.setup();
    fakeServer({
      "POST /v1/sessions": sessions(),
      "POST /v1/sessions/s-1/messages": () => json({ detail: "조건을 읽지 못했습니다" }, 503),
    });
    renderApp("/write");
    await user.type(box(), SENTENCE);
    await user.click(readButton());
    await screen.findByRole("region", { name: "조건을 읽지 못했습니다" });

    await user.type(box(), " 무주택입니다.");
    expect(screen.queryByRole("region", { name: "조건을 읽지 못했습니다" })).not.toBeInTheDocument();
    expect(readButton()).not.toHaveAttribute("aria-disabled");
  });
});
