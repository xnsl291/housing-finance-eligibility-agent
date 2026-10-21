import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NOTICE } from "../components/Notice";
import { callsTo, fakeServer, json, PROGRAMS, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("S0 첫 화면 — 대상 상품 묶음", () => {
  it("서버가 준 상품 이름과 전세·매매 구분을 그대로 그린다", async () => {
    fakeServer();
    renderApp("/");
    const group = await screen.findByRole("region", { name: "이 도구가 보는 상품" });
    const items = within(group).getAllByRole("listitem");
    expect(items).toHaveLength(PROGRAMS.length);
    expect(items[0]).toHaveTextContent("전세");
    expect(items[0]).toHaveTextContent("가상 청년 상품 가");
    expect(items[1]).toHaveTextContent("매매");
    expect(items[1]).toHaveTextContent("가상 상품 나");
  });

  it("상품 목록을 받지 못하면 묶음을 빼고 그리고, 나머지는 그대로 있다 (시안 S0-b)", async () => {
    fakeServer({ "GET /v1/programs": () => json({ detail: "고장" }, 500) });
    renderApp("/");
    expect(await screen.findByRole("region", { name: "준비해 두시면 좋은 것" })).toBeInTheDocument();
    // 받는 중 뼈대가 걷힐 때까지 기다린 뒤 확인한다
    await vi.waitFor(() => expect(screen.queryByText("불러오는 중입니다")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "이 도구가 보는 상품" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "문장으로 적기" })).toBeInTheDocument();
  });
});

describe("S0 첫 화면 — 개인정보 한 줄 (G12, D9, C-COPY)", () => {
  // 사이드바 개인정보 안내(PRIVACY_NOTE)가 말하는 것 중 이 한 줄이 빠뜨리면 안 되는 구절.
  // 줄여 말하면 "그것만 남는다"로 읽힌다(C-COPY '…만처럼 줄여 말하지 말 것')
  const MUST = [
    "입력한 문장 전체는 저장하지 않",
    "읽어 낸 값",
    "근거가 된 문장 일부",
    "답한 값",
    "모른다고 한 항목",
    "다시 켜도 남습니다",
  ];

  it("필수 구절을 모두 담고, 같은 구절이 사이드바 개인정보 안내에도 있다(사실과 어긋나지 않음)", () => {
    fakeServer();
    renderApp("/");
    const start = screen.getByRole("region", { name: "시작하기" });
    const line = within(start).getByText(/입력한 문장 전체는 저장하지 않/, { selector: "p" });
    for (const phrase of MUST) {
      expect(line).toHaveTextContent(phrase);
      expect(NOTICE.privacy).toContain(phrase);
    }
    expect(line.textContent).not.toMatch(/만\s*(남|저장)/);
    // 자세한 내용은 사이드바의 '개인정보 안내'를 가리킨다. 그 제목이 실제로 있어야 한다
    expect(line).toHaveTextContent("왼쪽 '개인정보 안내'");
    expect(screen.getByRole("heading", { name: "개인정보 안내" })).toBeInTheDocument();
  });
});

describe("S0 첫 화면 — 시작 버튼", () => {
  it("문장으로 적기는 조건 입력(/write)으로 간다", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
    // 초점은 화면이 그려진 뒤의 효과(effect)에서 옮겨지므로 기다린다
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "상황을 문장으로 적어 주세요" })).toHaveFocus(),
    );
    // 세션은 문장을 보낼 때 연다. 여기서 미리 열지 않는다
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(0);
  });

  it("항목을 직접 고르기는 세션을 열고 S2를 건너뛰어 질문(/s/세션/questions)으로 간다 (Q8)", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ "POST /v1/sessions": () => json({ session_id: "s-1" }, 201) });
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "항목을 직접 고르기" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/questions"));
    expect(callsTo(server, "POST /v1/sessions")).toHaveLength(1);
  });

  it("직접 고르기를 기다리는 중에 다른 화면으로 떠나면, 세션이 열려도 질문 화면으로 끌고 가지 않는다", async () => {
    const user = userEvent.setup();
    let answer: (r: Response) => void = () => {};
    const server = fakeServer({
      "POST /v1/sessions": () => new Promise<Response>((resolve) => (answer = resolve)),
      "DELETE /v1/sessions/s-1": () => json({ session_id: "s-1", deleted: true }),
    });
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "항목을 직접 고르기" }));
    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");

    await act(async () => answer(json({ session_id: "s-1" }, 201)));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");

    // 열린 세션 번호는 지울 대상으로 남는다
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await vi.waitFor(() => expect(callsTo(server, "DELETE /v1/sessions/s-1")).toHaveLength(1));
  });

  it("직접 고르기에서 서버에 연결되지 않으면 조건 문제가 아니라고 알리고 다시 시도할 수 있다", async () => {
    const user = userEvent.setup();
    let fail = true;
    fakeServer({
      "POST /v1/sessions": () => {
        if (fail) throw new TypeError("Failed to fetch");
        return json({ session_id: "s-2" }, 201);
      },
    });
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "항목을 직접 고르기" }));

    const region = await screen.findByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" });
    expect(region).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    // 화면 쪽에서 연결 실패를 보면 머리·사이드바의 연결 표시도 끊김으로 맞춘다
    expect(screen.getByText("판정 서버에 연결되지 않음")).toBeInTheDocument();

    fail = false;
    await user.click(within(region).getByRole("button", { name: "다시 시도" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/questions"));
  });
});
