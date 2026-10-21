/*
 * S3 하나씩 확인 — 질문 카드 내용, 칸 종류별로 서버에 보내는 값, 확인 수, 같은 항목 재질문.
 * 실패·멈추기·처음부터 다시는 Questions.stop.test.tsx.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Question } from "../api/types";
import { ask, CHOICE_Q, DECLINE, NEXT, open, PATH, PUT, result, sentBodies, sequence, server, start } from "./questionsTesting";
import { callsTo, json } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const card = () => screen.getByRole("region", { name: CHOICE_Q.label });

describe("S3 질문 카드", () => {
  it("항목 이름이 질문이고, 왜 묻는지를 보인다. 처음 묻는 값에는 '지금 아는 값' 줄이 없다", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();

    expect(card()).toHaveTextContent("남은 상품 2개 모두 이 값이 있어야 판정할 수 있습니다");
    expect(card()).not.toHaveTextContent("지금 아는 값");
    // 선택은 라디오, 아무것도 안 골라진 채 시작(설계서 7.2)
    for (const r of within(card()).getAllByRole("radio")) expect(r).not.toBeChecked();
    expect(within(card()).getByRole("radio", { name: "세대주임" })).toBeInTheDocument();
  });

  it("기준에 걸쳐 다시 물으면 세션의 지금 값을 억·만으로 보이고, 확인 방법을 붙인다 (시안 S3-f)", async () => {
    const q: Question = {
      ...CHOICE_Q,
      field: "combined_annual_income_krw",
      label: "부부합산 총소득",
      kind: "AMOUNT",
      ask_kind: "IMPRECISE",
      why: "알려주신 값이 기준에 걸쳐 판정이 갈립니다 (가상 청년 상품 가)",
      how_to_check: "국세청 홈택스의 소득금액증명에서 확인할 수 있습니다",
      choices: null,
      choice_labels: null,
    };
    server({ [NEXT]: () => ask(q) }, { combined_annual_income_krw: { low: 45_000_000, high: 50_000_000 } });
    await open("부부합산 총소득");

    const c = screen.getByRole("region", { name: "부부합산 총소득" });
    expect(c).toHaveTextContent("지금은 4,500만~5,000만원으로 알고 있습니다. 기준에 걸쳐 정확한 값이 필요합니다.");
    expect(c).toHaveTextContent("확인 방법: 국세청 홈택스의 소득금액증명에서 확인할 수 있습니다");
    // 범위로는 못 답한다 — 칸이 하나뿐(최소·최대 두 칸이 아님)
    expect(within(c).getAllByRole("textbox")).toHaveLength(1);
  });

  it("서버가 '결과를 내라'고 하면 바로 결과 주소로 간다", async () => {
    server({ [NEXT]: () => result("COMPLETE") });
    start();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/result"));
  });
});

describe("S3 답하기 — 칸 종류별로 서버에 보내는 값", () => {
  it("선택은 선택지 코드로 보낸다. 고르기 전에는 답하기가 잠긴다", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")) });
    await open();

    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(callsTo(spy, PUT)).toHaveLength(0);

    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(sentBodies(spy, PUT)).toEqual([{ values: { household_head_status: "PROSPECTIVE_HEAD" } }]);
  });

  it("금액은 만원 단위로 받아 원 단위 정수로 보낸다. 칸 아래 억·만 표기", async () => {
    const user = userEvent.setup();
    const q: Question = { ...CHOICE_Q, field: "lease_deposit_krw", label: "임차보증금", kind: "AMOUNT", choices: null, choice_labels: null };
    const spy = server({ [NEXT]: sequence(ask(q), result("COMPLETE")) });
    await open("임차보증금");

    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "1억 8천");
    expect(screen.getByText("1억 8,000만원")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(sentBodies(spy, PUT)).toEqual([{ values: { lease_deposit_krw: 180_000_000 } }]);
  });

  it("금액을 못 읽으면 답하기가 잠기고 보내지 않는다", async () => {
    const user = userEvent.setup();
    const q: Question = { ...CHOICE_Q, field: "lease_deposit_krw", label: "임차보증금", kind: "AMOUNT", choices: null, choice_labels: null };
    const spy = server({ [NEXT]: () => ask(q) });
    await open("임차보증금");

    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "180000000");
    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(callsTo(spy, PUT)).toHaveLength(0);
    // 아무것도 안 고른 것과 구분한다 — 칸에 적은 것이 있는데 "답을 고르거나 적으면"이라고 하지 않는다
    expect(screen.getByRole("button", { name: "답하기" })).toHaveAccessibleDescription("위 칸의 입력을 고쳐 주세요");
  });

  it("예·아니오는 모름 칸 없이 예/아니오 라디오이고 true/false로 보낸다 (G4)", async () => {
    const user = userEvent.setup();
    const q: Question = { ...CHOICE_Q, field: "is_first_time_buyer", label: "생애최초 주택구입", kind: "BOOL", choices: null, choice_labels: null };
    const spy = server({ [NEXT]: sequence(ask(q), ask(q), result("COMPLETE")) });
    await open("생애최초 주택구입");

    expect(screen.queryByRole("radio", { name: "모름" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "아니오" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    await screen.findByText(/지금까지 1개 확인/);
    await user.click(screen.getByRole("radio", { name: "예" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));

    expect(sentBodies(spy, PUT)).toEqual([
      { values: { is_first_time_buyer: false } },
      { values: { is_first_time_buyer: true } },
    ]);
  });

  it("날짜는 달력으로 받아 YYYY-MM-DD로, 정수는 수로, 글은 앞뒤 공백을 떼고 보낸다", async () => {
    const user = userEvent.setup();
    const date: Question = { ...CHOICE_Q, field: "move_in_date", label: "전입일", kind: "DATE", choices: null, choice_labels: null };
    const int: Question = { ...CHOICE_Q, field: "age", label: "나이", kind: "INT", choices: null, choice_labels: null };
    const text: Question = { ...CHOICE_Q, field: "region_name", label: "주택 소재지", kind: "TEXT", choices: null, choice_labels: null };
    const spy = server({ [NEXT]: sequence(ask(date), ask(int), ask(text), result("COMPLETE")) });
    await open("전입일");

    const calendar = screen.getByLabelText("전입일", { selector: "input" });
    expect(calendar).toHaveAttribute("type", "date");
    fireEvent.change(calendar, { target: { value: "2026-11-02" } });
    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.type(await screen.findByRole("textbox", { name: "나이" }), "29");
    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.type(await screen.findByRole("textbox", { name: "주택 소재지" }), "  경기도 성남시 ");
    await user.click(screen.getByRole("button", { name: "답하기" }));

    expect(sentBodies(spy, PUT)).toEqual([
      { values: { move_in_date: "2026-11-02" } },
      { values: { age: 29 } },
      { values: { region_name: "경기도 성남시" } },
    ]);
  });

  it("서버가 거절하면(422) 같은 질문에 머물고 카드 안에 사유를 보인다. 확인 수는 그대로", async () => {
    const user = userEvent.setup();
    const spy = server({
      [NEXT]: () => ask(CHOICE_Q),
      [PUT]: () => json({ detail: "값이 맞지 않습니다 — 세대주 여부: 고를 수 없는 값" }, 422),
    });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));

    expect(await within(card()).findByText(/고를 수 없는 값/)).toBeInTheDocument();
    // 사람이 읽을 한 줄이 먼저, 서버가 보낸 사유는 그 뒤에(시안 S3-c)
    expect(card()).toHaveTextContent(
      "이 값으로는 저장하지 못했습니다. (서버가 보낸 사유: 값이 맞지 않습니다 — 세대주 여부: 고를 수 없는 값)",
    );
    // 선택지 묶음이 사유를 설명으로 가리킨다 — 화면 읽기 프로그램이 묶음에 들어가며 사유를 같이 읽는다
    expect(screen.getByRole("radiogroup", { name: "세대주 여부" })).toHaveAccessibleDescription(/이 값으로는 저장하지 못했습니다/);
    expect(screen.getByRole("radio", { name: "세대주임" })).toBeChecked();
    expect(callsTo(spy, NEXT)).toHaveLength(1);
    expect(screen.queryByText(/개 확인/)).not.toBeInTheDocument();

    // 답을 바꾸면 지난 사유는 걷는다
    await user.click(screen.getByRole("radio", { name: "세대주 예정" }));
    expect(card()).not.toHaveTextContent("고를 수 없는 값");
    expect(screen.getByRole("radiogroup", { name: "세대주 여부" })).not.toHaveAccessibleDescription(/저장하지 못했습니다/);
  });

  it("글로 적는 칸도 서버가 거절한 사유를 칸의 설명으로 연결한다", async () => {
    const user = userEvent.setup();
    const q: Question = { ...CHOICE_Q, field: "lease_deposit_krw", label: "임차보증금", kind: "AMOUNT", choices: null, choice_labels: null };
    server({ [NEXT]: () => ask(q), [PUT]: () => json({ detail: "0원 이상의 금액으로 넣어 주세요" }, 422) });
    await open("임차보증금");

    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "4800");
    await user.click(screen.getByRole("button", { name: "답하기" }));

    await within(screen.getByRole("region", { name: "임차보증금" })).findByText(/0원 이상의 금액/);
    expect(screen.getByRole("textbox", { name: "임차보증금" })).toHaveAccessibleDescription(
      /이 값으로는 저장하지 못했습니다\. \(서버가 보낸 사유: 0원 이상의 금액으로 넣어 주세요\)/,
    );
  });
});

describe("S3 모르겠어요와 확인 수", () => {
  it("모르겠어요는 그 항목을 서버에 '모름'으로 기록하고 다음 질문을 받는다", async () => {
    const user = userEvent.setup();
    const spy = server({ [NEXT]: sequence(ask(CHOICE_Q), result("ONLY_DECLINED_LEFT")) });
    await open();

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));

    expect(sentBodies(spy, DECLINE)).toEqual([{ field: "household_head_status" }]);
    expect(callsTo(spy, PUT)).toHaveLength(0);
    // 기록 → 다음 질문 → 세션 상태를 차례로 기다린 뒤 옮겨 가므로 바로 보지 않고 기다린다
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/s-1/result"));
  });

  it("답하거나 모른다고 할 때마다 확인 수가 1 늘고, 진행 줄에 질문 총 개수·남은 개수를 쓰지 않는다 (N3)", async () => {
    const user = userEvent.setup();
    const age: Question = { ...CHOICE_Q, field: "age", label: "나이", kind: "INT", choices: null, choice_labels: null };
    server({ [NEXT]: sequence(ask(CHOICE_Q), ask(age), ask(CHOICE_Q)) }, {});
    await open();
    expect(screen.getByText("판정에 필요한 것만 하나씩 여쭙니다 · 지금까지 0개 확인")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    expect(await screen.findByText("판정에 필요한 것만 하나씩 여쭙니다 · 지금까지 1개 확인")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(await screen.findByText("판정에 필요한 것만 하나씩 여쭙니다 · 지금까지 2개 확인")).toBeInTheDocument();

    // 머리 영역의 '3 / 4 단계'는 단계 표시라 빼고 진행 줄만 본다
    const progress = screen.getByText(/지금까지 2개 확인/).parentElement!;
    expect(progress).not.toHaveTextContent(/\d+\s*개\s*중/);
    expect(progress).not.toHaveTextContent(/\d+\s*\/\s*\d+/);
    expect(progress).not.toHaveTextContent(/\d+\s*개\s*남/);
  });

  it("세션에 값이 있는데 이 화면에서 센 수가 0이면(새로 고친 뒤 등) '0개 확인'을 쓰지 않는다", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) }, { age: 29 });
    await open();
    await waitFor(() => expect(screen.getByText(/판정에 필요한 것만 하나씩 여쭙니다/)).toHaveTextContent(/^판정에 필요한 것만 하나씩 여쭙니다$/));
  });

  it("모르겠어요 안내는 아직 없는 기능(결과 화면에서 값 넣기)을 약속하지 않는다", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) });
    await open();
    expect(card()).toHaveTextContent("‘모르겠어요’를 고르면 이 항목은 다시 묻지 않습니다.");
    expect(card()).not.toHaveTextContent("이 조건으로 판정했습니다");
  });

  it("같은 항목을 다시 물으면 초점이 다시 질문 제목으로 가고 칸이 비워진다", async () => {
    const user = userEvent.setup();
    const q: Question = { ...CHOICE_Q, field: "lease_deposit_krw", label: "임차보증금", kind: "AMOUNT", choices: null, choice_labels: null };
    server({ [NEXT]: sequence(ask(q), ask({ ...q, ask_kind: "IMPRECISE" })) });
    await open("임차보증금");

    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "4800");
    await user.click(screen.getByRole("button", { name: "답하기" }));

    await screen.findByText(/지금까지 1개 확인/);
    expect(screen.getByRole("heading", { name: "임차보증금" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "임차보증금" })).toHaveValue("");
  });

  it("답을 보내는 동안 모르겠어요를 눌러도 한 질문에 답과 모름이 둘 다 가지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    const spy = server({
      [NEXT]: sequence(ask(CHOICE_Q), result("COMPLETE")),
      [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    await open();

    await user.click(screen.getByRole("radio", { name: "세대주임" }));
    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    await user.click(screen.getByRole("button", { name: /보내는 중/ }));

    expect(callsTo(spy, PUT)).toHaveLength(1);
    expect(callsTo(spy, DECLINE)).toHaveLength(0);
    await act(async () => finish(json({ session_id: "s-1", values: {} })));
  });

  it("직접 입력으로 시작해 값이 하나도 없는 세션도 같은 화면이다 (S1-F)", async () => {
    server({ [NEXT]: () => ask(CHOICE_Q) }, {});
    await open();
    expect(screen.getByRole("heading", { name: "몇 가지만 더 여쭙겠습니다" })).toBeInTheDocument();
    expect(card()).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(PATH);
  });
});
