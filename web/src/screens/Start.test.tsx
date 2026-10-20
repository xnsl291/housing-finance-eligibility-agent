import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

describe("S0 첫 화면 — 시작 버튼", () => {
  it("문장으로 적기는 조건 입력(/write)으로 간다", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/write");
    expect(screen.getByRole("heading", { level: 1, name: "상황을 문장으로 적어 주세요" })).toHaveFocus();
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

    fail = false;
    await user.click(within(region).getByRole("button", { name: "다시 시도" }));
    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-2/questions"));
  });
});
