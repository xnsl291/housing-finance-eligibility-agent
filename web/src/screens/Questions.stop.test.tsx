/*
 * S3 하나씩 확인 — 실패(D15·E1·E2), 그만 묻고 결과 보기, 처음부터 다시(M1), 떠난 뒤 늦은 응답.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";

import { App } from "../App";
import { ask, CHOICE_Q, DECLINE, NEXT, open, PATH, PUT, result, sentBodies, sequence, server, SESSION, start } from "./questionsTesting";
import { callsTo, json } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const stopButton = () => screen.getByRole("button", { name: "그만 묻고 지금까지로 결과 보기" });
const location = () => screen.getByTestId("location");

describe("S3 실패 — 화면이 거기서 끝나지 않는다 (결함 D15)", () => {
  it("다음 질문을 못 받으면 다시 시도와 그만 묻고 결과 보기가 남고, 다시 시도하면 질문을 그린다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: sequence(json({ detail: "내부 오류" }, 500), ask(CHOICE_Q)) });
    start();

    const box = (await screen.findByRole("heading", { name: "다음 질문을 받지 못했습니다" })).closest("section")!;
    expect(box).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(box).toHaveTextContent("사유: 내부 오류");
    expect(stopButton()).not.toHaveAttribute("aria-disabled");

    await user.click(within(box).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("region", { name: "세대주 여부" })).toBeInTheDocument();
  });

  it("답은 저장됐는데 다음 질문을 못 받으면 답한 수가 서버에 있다고 알린다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: sequence(ask(CHOICE_Q), json({ detail: "내부 오류" }, 500)) });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));

    const box = (await screen.findByRole("heading", { name: "다음 질문을 받지 못했습니다" })).closest("section")!;
    // 모르겠어요도 세므로 '답하신'이 아니라 '확인하신'
    expect(box).toHaveTextContent("지금까지 확인하신 1개는 서버에 그대로 있습니다.");
    expect(stopButton()).toBeInTheDocument();
  });

  it("답 저장이 서버 오류로 실패하면 답을 둔 채 다시 시도로 같은 값을 다시 보낸다", async () => {
    const user = userEvent.setup();
    let fail = true;
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")),
      [PUT]: () => (fail ? json({ detail: "저장 실패" }, 500) : json({ session_id: "s-1", values: {} })),
    });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    const box = (await screen.findByRole("heading", { name: "답을 저장하지 못했습니다" })).closest("section")!;
    expect(box).toHaveTextContent("고르신 답은 화면에 그대로 있습니다.");
    expect(screen.getByRole("radio", { name: "세대주 예정" })).toBeChecked();
    expect(screen.queryByText(/개 확인/)).not.toBeInTheDocument();

    fail = false;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));
    expect(sentBodies(spy, PUT)).toEqual([
      { values: { household_head_status: "PROSPECTIVE_HEAD" } },
      { values: { household_head_status: "PROSPECTIVE_HEAD" } },
    ]);
    await waitFor(() => expect(location()).toHaveTextContent("/s/s-1/result"));
  });

  it("저장 실패 뒤 답을 바꾸고 다시 시도하면 지금 화면의 답을 보낸다 — 처음 누른 순간의 값이 아니라", async () => {
    const user = userEvent.setup();
    let fail = true;
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")),
      [PUT]: () => (fail ? json({ detail: "저장 실패" }, 500) : json({ session_id: "s-1", values: {} })),
    });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    const box = (await screen.findByRole("heading", { name: "답을 저장하지 못했습니다" })).closest("section")!;

    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    fail = false;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));

    expect(sentBodies(spy, PUT)).toEqual([
      { values: { household_head_status: "HEAD" } },
      { values: { household_head_status: "PROSPECTIVE_HEAD" } },
    ]);
  });

  it("모르겠어요 기록이 실패했으면 다시 시도는 모름을 다시 보낸다", async () => {
    const user = userEvent.setup();
    let fail = true;
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")),
      [DECLINE]: () => (fail ? json({ detail: "저장 실패" }, 500) : json({ session_id: "s-1", declined: [] })),
    });
    await open();

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    const box = (await screen.findByRole("heading", { name: "답을 저장하지 못했습니다" })).closest("section")!;
    // 칸에서 답을 골라도 다시 시도는 처음 한 일(모름)을 다시 한다
    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    fail = false;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));

    expect(sentBodies(spy, DECLINE)).toEqual([{ field: "household_head_status" }, { field: "household_head_status" }]);
    expect(callsTo(spy, PUT)).toHaveLength(0);
  });

  it("다시 시도로 보내는 동안 카드의 답하기·모르겠어요도 잠겨 한 질문에 답과 모름이 둘 다 가지 않는다", async () => {
    const user = userEvent.setup();
    let calls = 0;
    let finish!: (r: Response) => void;
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")),
      [PUT]: () =>
        ++calls === 1 ? json({ detail: "저장 실패" }, 500) : new Promise<Response>((resolve) => (finish = resolve)),
    });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    const box = (await screen.findByRole("heading", { name: "답을 저장하지 못했습니다" })).closest("section")!;
    await user.click(within(box).getByRole("button", { name: "다시 시도" }));

    const c = screen.getByRole("region", { name: CHOICE_Q.label });
    for (const name of ["답하기", "모르겠어요"]) {
      expect(within(c).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await user.click(within(c).getByRole("button", { name: "모르겠어요" }));
    await user.click(within(c).getByRole("button", { name: "답하기" }));
    expect(callsTo(spy, DECLINE)).toHaveLength(0);
    expect(callsTo(spy, PUT)).toHaveLength(2);
    await act(async () => finish(json({ session_id: "s-1", values: {} })));
  });

  it("답 저장이 시간 초과면 '저장하지 못했습니다'라고 단정하지 않는다 — 서버가 마쳤는지 모른다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q), [PUT]: () => json({ detail: "gateway" }, 504) });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));

    expect(await screen.findByRole("heading", { name: "서버가 제때 답하지 않아 중단했습니다" })).toBeInTheDocument();
    expect(screen.queryByText("답을 저장하지 못했습니다")).not.toBeInTheDocument();
  });

  it("세션이 없으면(404) 처음부터 다시 하라고 안내한다 (E2)", async () => {
    server({ [NEXT]: () => json({ detail: "없는 세션입니다" }, 404) });
    start();
    expect(await screen.findByRole("heading", { name: "이전 확인 기록을 찾을 수 없습니다" })).toBeInTheDocument();
  });

  it("다음 질문을 받다가 연결이 끊기면 E1 상자 하나만, 연결이 돌아오면 질문을 다시 받는다", async () => {
    const user = userEvent.setup();
    let up = false;
    const down = () => Promise.reject(new TypeError("down"));
    server({
      "GET /health": () => (up ? json({ status: "ok", programs: [] }) : down()),
      [NEXT]: () => (up ? ask(CHOICE_Q) : down()),
    });
    start();

    const box = (await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).closest("section")!;
    expect(screen.queryByRole("heading", { name: "다음 질문을 받지 못했습니다" })).not.toBeInTheDocument();
    expect(stopButton()).toHaveAttribute("aria-disabled", "true");

    up = true;
    await user.click(within(box).getByRole("button", { name: "다시 연결 확인" }));
    expect(await screen.findByRole("region", { name: "세대주 여부" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).not.toBeInTheDocument();
  });

  it("답을 보내다 연결이 끊기면 고른 답은 두고 세 버튼을 잠근다 (E1)", async () => {
    const user = userEvent.setup();
    let up = true;
    const spy = server({
      "GET /health": () => (up ? json({ status: "ok", programs: [] }) : Promise.reject(new TypeError("down"))),
      [NEXT]: () => ask(CHOICE_Q),
      [PUT]: () => Promise.reject(new TypeError("down")),
    });
    await open();

    up = false;
    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));

    expect(await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("고르신 답은 화면에 그대로 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "세대주임" })).toBeChecked();
    for (const name of ["답하기", "모르겠어요", "그만 묻고 지금까지로 결과 보기"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(callsTo(spy, PUT)).toHaveLength(1);

    // 잠긴 이유는 카드 안에 한 줄만. 두 버튼이 그 줄을 같이 가리킨다(버튼마다 줄을 달면 같은 말을 거듭 읽음)
    const c = screen.getByRole("region", { name: CHOICE_Q.label });
    expect(within(c).getAllByText("서버에 연결되지 않아 지금은 보낼 수 없습니다.")).toHaveLength(1);
    for (const name of ["답하기", "모르겠어요"]) {
      expect(within(c).getByRole("button", { name })).toHaveAccessibleDescription("서버에 연결되지 않아 지금은 보낼 수 없습니다.");
    }
  });

  it("다음 질문을 기다리는 동안 '다시 연결 확인'을 눌러도 다음 질문을 또 부르지 않는다", async () => {
    const user = userEvent.setup();
    let up = false;
    const spy = server({
      "GET /health": () => (up ? json({ status: "ok", programs: [] }) : Promise.reject(new TypeError("down"))),
      [NEXT]: () => new Promise<Response>(() => {}),
    });
    start();

    const box = (await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).closest("section")!;
    up = true;
    await user.click(within(box).getByRole("button", { name: "다시 연결 확인" }));
    expect(callsTo(spy, NEXT)).toHaveLength(1);
  });

  it("StrictMode가 효과를 두 번 돌려도 다음 질문은 한 번만 부른다", async () => {
    const spy = server({ [NEXT]: () => ask(CHOICE_Q) });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[PATH]}>
          <App />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(await screen.findByRole("region", { name: CHOICE_Q.label })).toBeInTheDocument();
    expect(callsTo(spy, NEXT)).toHaveLength(1);
  });
});

describe("S3 멈추기와 되돌아가기", () => {
  it("그만 묻고 결과 보기는 판정을 부르지 않고 결과 주소로 간다 — 판정은 S4가 한다", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();

    await user.click(stopButton());

    expect(location()).toHaveTextContent("/s/s-1/result");
    // 결과 화면(S4)이 한 번 부른다. S3도 불렀다면 두 번이 된다
    await waitFor(() => expect(callsTo(spy, "POST /v1/sessions/s-1/assessment")).toHaveLength(1));
  });

  it("지울 것이 있으면 확인 창(M1)을 띄우고 초점은 계속하기. 처음부터는 S1로 가고 서버 세션은 지우지 않는다", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();

    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog", { name: "처음부터 다시 할까요?" });
    // 서버 세션은 지우지 않으므로 '사라집니다'라고 하지 않는다(G12). 사이드바 전체 초기화 창과 같은 말
    expect(dialog).toHaveTextContent(
      "처음부터 다시 시작합니다. 지금까지 고치고 답한 값은 새 판정에 쓰지 않습니다. 서버에 남은 기록은 지워지지 않으며, ‘내 기록 지우기’로 지울 수 있습니다.",
    );
    expect(dialog).not.toHaveTextContent("사라집니다");
    // 적은 문장이 없는 탭(주소로 바로 옴)에서는 '문장은 남습니다'를 말하지 않는다
    expect(dialog).not.toHaveTextContent("적어 두신 문장은 남습니다");
    expect(within(dialog).getByRole("button", { name: "계속하기" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "계속하기" }));
    expect(location()).toHaveTextContent("/s/s-1/questions");

    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");
    expect(callsTo(spy, "DELETE /v1/sessions/s-1")).toHaveLength(0);
  });

  it("새로 고친 뒤(연 세션 목록이 빔)에 처음부터 다시로 떠나도 '내 기록 지우기'로 이 세션을 지울 수 있다 — 확인 창의 약속", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: () => ask(CHOICE_Q), "DELETE /v1/sessions/s-1": () => json({ session_id: "s-1", deleted: true }) });
    await open();

    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");

    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    expect(callsTo(spy, "DELETE /v1/sessions/s-1")).toHaveLength(1);
  });

  it("값이 하나도 없고 아직 답한 것도 없으면 묻지 않고 S1로 간다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q) }, {});
    await open();

    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(location()).toHaveTextContent("/write");
  });

  it("빈 세션이라도 이 화면에서 하나 답했으면 확인 창을 띄운다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q) }, {});
    await open();

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    await screen.findByText(/지금까지 1개 확인/);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("세션 상태를 못 받았으면 지울 것이 있다고 보고 확인 창을 띄운다", async () => {
    const user = userEvent.setup();
    server({ [NEXT]: () => ask(CHOICE_Q), [SESSION]: () => json({ detail: "내부 오류" }, 500) }, {});
    await open();

    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("다음 질문을 기다리는 사이 떠났으면 늦게 온 '결과를 내라'로 끌고 가지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    server({ [NEXT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    start();

    await user.click(await screen.findByRole("button", { name: "처음부터 다시" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");

    await act(async () => finish(result("COMPLETE")));
    expect(location()).toHaveTextContent("/write");
  });
});
