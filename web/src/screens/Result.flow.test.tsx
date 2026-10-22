/*
 * S4 판정 결과 — 질문 이어서 하기, 처음부터 다시(M1), 실패(E2·판정 실패·E1), 떠난 뒤 늦은 응답.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";

import { App } from "../App";

import { ask, CHOICE_Q, result } from "./questionsTesting";
import { ASSESS, assessment, event, NEXT, open, PATH, program, server, TRACE, traceOf } from "./resultTesting";
import { callsTo, json, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

const location = () => screen.getByTestId("location");

/**
 * 붙잡아 둔 응답을 내주고, 화면 코드가 그 본문을 다 읽은 뒤 이어지는 일까지 끝날 때까지 기다린다.
 * 본문을 읽은 뒤의 일(떠났는지 확인 → 다음 호출 또는 상태 바꾸기)은 모두 마이크로태스크라,
 * 그다음 매크로태스크(setTimeout 0)가 돌 때는 이미 끝나 있다. 시간을 재며 기다리지 않는다
 */
async function settle(release: (r: Response) => void, response: Response) {
  let read: () => void = () => {};
  const consumed = new Promise<void>((resolve) => (read = resolve));
  const json = response.json.bind(response);
  response.json = () =>
    json().then((body: unknown) => {
      read();
      return body;
    });
  release(response);
  await consumed;
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const actions = () => screen.getByRole("region", { name: "다음 할 일" });

describe("질문 이어서 하기 — 사용자가 멈췄을 때만", () => {
  it("next가 ASK(사용자가 멈춤)면 주 버튼으로 보이고, 누르면 판정을 다시 부르지 않고 바로 S3로 간다", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    await user.click(within(actions()).getByRole("button", { name: "질문 이어서 하기" }));
    expect(location()).toHaveTextContent("/s/s-1/questions");
    expect(callsTo(spy, ASSESS)).toHaveLength(1);
    // '결과를 지운다'고 말하지 않는다 — 결과는 서버 기록에 남는다
    expect(screen.getByRole("main")).not.toHaveTextContent(/결과를 지/);
  });

  it.each(["COMPLETE", "ALL_NOT_MATCHED", "ONLY_DECLINED_LEFT"] as const)("%s이면 보이지 않는다", async (reason) => {
    server({ [NEXT]: () => result(reason) });
    await open();
    expect(within(actions()).queryByRole("button", { name: "질문 이어서 하기" })).not.toBeInTheDocument();
    expect(within(actions()).getByRole("button", { name: "처음부터 다시" })).toBeInTheDocument();
  });
});

describe("처음부터 다시 (M1) — S3와 같은 확인 창", () => {
  it("기록에 값이 있으면 확인 창을 띄우고, '처음부터'를 누르면 S1로 간다", async () => {
    const user = userEvent.setup();
    server();
    await open();
    await user.click(within(actions()).getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog", { name: "처음부터 다시 할까요?" });
    expect(dialog).toHaveTextContent(
      "처음부터 다시 시작합니다. 지금까지 고치고 답한 값은 새 판정에 쓰지 않습니다. 서버에 남은 기록은 지워지지 않으며, ‘내 기록 지우기’로 지울 수 있습니다.",
    );
    expect(dialog).not.toHaveTextContent("사라집니다");
    expect(location()).toHaveTextContent(PATH);
    await user.click(within(dialog).getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");
  });

  it("지울 것이 없으면(값도 모름도 없는 기록) 창 없이 바로 S1로 간다", async () => {
    const user = userEvent.setup();
    server({ [TRACE]: () => traceOf([event("SESSION_STARTED"), event("ASSESSED")]) });
    await open();
    await user.click(within(actions()).getByRole("button", { name: "처음부터 다시" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(location()).toHaveTextContent("/write");
  });

  it("떠난 세션은 '내 기록 지우기' 대상에 남는다", async () => {
    const user = userEvent.setup();
    const spy = server({ "DELETE /v1/sessions/s-1": () => json({ session_id: "s-1", deleted: true }) });
    await open();
    await user.click(within(actions()).getByRole("button", { name: "처음부터 다시" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "처음부터" }));
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(callsTo(spy, "DELETE /v1/sessions/s-1")).toHaveLength(1));
  });
});

describe("실패", () => {
  it.each([NEXT, ASSESS])("%s가 404면 E2(세션을 찾을 수 없음)", async (key) => {
    server({ [key]: () => json({ detail: "없는 세션입니다" }, 404) });
    renderApp(PATH);
    expect(await screen.findByRole("heading", { name: "이전 확인 기록을 찾을 수 없습니다" })).toBeInTheDocument();
  });

  it("판정이 실패하면 '판정하지 못했습니다'와 사유, 다시 시도하면 결과를 그린다", async () => {
    const user = userEvent.setup();
    let fail = true;
    server({ [ASSESS]: () => (fail ? json({ detail: "내부 오류" }, 500) : assessment(program())) });
    renderApp(PATH);
    const box = (await screen.findByRole("heading", { name: "판정하지 못했습니다" })).closest("section")!;
    expect(box).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(box).toHaveTextContent("사유: 내부 오류");
    // 판정 실패는 조건 불충족이 아니다(G13) — 판정 배지가 없다
    expect(screen.queryByText("조건 불충족")).not.toBeInTheDocument();
    fail = false;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
  });

  it("연결이 안 되면 맨 위 E1 상자 하나와 머리 연결 상태가 끊김이 되고, 다시 연결 확인으로 결과를 받는다", async () => {
    const user = userEvent.setup();
    let down = true;
    server({
      [NEXT]: () => {
        if (down) throw new TypeError("Failed to fetch");
        return result("COMPLETE");
      },
    });
    renderApp(PATH);
    const box = (await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).closest("section")!;
    expect(box).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(screen.queryByRole("heading", { name: "판정하지 못했습니다" })).not.toBeInTheDocument();
    down = false;
    await user.click(within(box).getByRole("button", { name: "다시 연결 확인" }));
    expect(await screen.findByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).not.toBeInTheDocument();
  });

  it("결과를 받은 뒤 연결이 끊기면 결과는 그대로 두고 질문 이어서 하기를 잠근다 (시안 S4-f)", async () => {
    server({
      [NEXT]: () => ask(CHOICE_Q),
      [TRACE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp(PATH);
    const box = (await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).closest("section")!;
    expect(box).toHaveTextContent("이미 받은 결과는 화면에 그대로 있습니다.");
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    expect(within(actions()).getByRole("button", { name: "질문 이어서 하기" })).toHaveAttribute("aria-disabled", "true");
  });

  it("판정을 기다리는 동안 떠나면 늦게 온 응답으로 화면을 바꾸지 않는다", async () => {
    const user = userEvent.setup();
    let finish: (r: Response) => void = () => {};
    const error = vi.spyOn(console, "error");
    const spy = server({ [ASSESS]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    renderApp(PATH);
    await waitFor(() => expect(callsTo(spy, ASSESS)).toHaveLength(1));
    await user.click(within(actions()).getByRole("button", { name: "처음부터 다시" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");

    finish(assessment(program()));
    await new Promise((r) => setTimeout(r, 20));
    expect(location()).toHaveTextContent("/write");
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
    expect(callsTo(spy, TRACE)).toHaveLength(0);
  });

  it("멈춘 이유를 기다리는 동안 떠나면 판정을 부르지 않는다 — 아무도 보지 않는 판정이 기록에 남지 않게", async () => {
    const user = userEvent.setup();
    let finish: (r: Response) => void = () => {};
    const spy = server({ [NEXT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    renderApp(PATH);
    await waitFor(() => expect(callsTo(spy, NEXT)).toHaveLength(1));
    await user.click(within(actions()).getByRole("button", { name: "처음부터 다시" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "처음부터" }));

    finish(result("COMPLETE"));
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo(spy, ASSESS)).toHaveLength(0);
  });

  it("주소의 세션만 바뀌면 앞 세션의 늦은 판정을 새 세션 화면에 그리지 않는다", async () => {
    const user = userEvent.setup();
    let finish: (r: Response) => void = () => {};
    const spy = server({
      [ASSESS]: () => new Promise<Response>((resolve) => (finish = resolve)),
      "GET /v1/sessions/s-2/next": () => result("COMPLETE"),
      "POST /v1/sessions/s-2/assessment": () => assessment(program({ program_id: "p-buy", program_name: "둘째 세션 상품" })),
      "GET /v1/sessions/s-2/trace": () => traceOf(),
    });
    function Go() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/s/s-2/result")}>둘째 세션으로</button>;
    }
    render(
      <MemoryRouter initialEntries={[PATH]}>
        <App />
        <Go />
      </MemoryRouter>,
    );
    await waitFor(() => expect(callsTo(spy, ASSESS)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "둘째 세션으로" }));
    expect(await screen.findByRole("heading", { level: 3, name: "둘째 세션 상품" })).toBeInTheDocument();

    await settle(finish, assessment(program()));
    expect(screen.queryByRole("heading", { level: 3, name: "가상 청년 상품 가" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "둘째 세션 상품" })).toBeInTheDocument();
  });
});
