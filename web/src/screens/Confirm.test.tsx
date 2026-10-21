import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { HeldValue } from "../api/types";
import { changedValues, splitRejection } from "./confirmValues";
import { callsTo, fakeServer, FIELDS, json, renderApp } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const AT = "2026-10-21T00:00:00Z";
const llm = (value: HeldValue["value"], phrase: string | null): HeldValue => ({ value, source: "LLM", at: AT, phrase });

/** 문장에서 읽은 값. 지역은 앞서 이 화면에서 고친 뒤 돌아온 값(USER) */
const HELD: Record<string, HeldValue> = {
  age: llm(29, "만 29세 직장인"),
  household_head_status: llm("HEAD", "무주택 세대주입니다"),
  is_first_time_buyer: llm(true, "처음 집을 삽니다"),
  combined_annual_income_krw: llm({ low: 45_000_000, high: 50_000_000 }, "4천 후반대"),
  lease_deposit_krw: llm(180_000_000, "보증금 1억8천"),
  region_name: { value: "부산", source: "USER", at: AT, phrase: null },
};

/** S1에서 막 넘어온 경우의 라우터 state */
const NOTES = {
  warnings: ["주민등록번호로 보이는 내용이 있어 저장하지 않았습니다"],
  unreadable: { housing_area_m2: "25평" },
};

const PATH = "/s/s-1/confirm";
const SESSION = "GET /v1/sessions/s-1";
const PUT = "PUT /v1/sessions/s-1/fields";

function server(routes: Parameters<typeof fakeServer>[0] = {}) {
  return fakeServer({
    [SESSION]: () => json({ session_id: "s-1", values: HELD }),
    [PUT]: () => json({ session_id: "s-1", values: HELD }),
    ...routes,
  });
}

async function open(withNotes = true) {
  renderApp(withNotes ? { pathname: PATH, state: NOTES } : PATH);
  await screen.findByRole("heading", { name: /문장에서 읽은 항목/ });
}

function row(label: string): HTMLElement {
  // 줄 = '고치기'(또는 '닫기')가 든 가장 가까운 칸. 이름표 글자에서 위로 올라가 찾는다
  const name = screen.getAllByText(label, { selector: "span" })[0];
  return name.parentElement!.parentElement!;
}

function nextButton() {
  return screen.getByRole("button", { name: "확인했습니다 — 다음" });
}

function sentBody(spy: ReturnType<typeof fakeServer>) {
  const calls = callsTo(spy, PUT);
  expect(calls).toHaveLength(1);
  return JSON.parse(String(calls[0][1]?.body));
}

const location = () => screen.getByTestId("location");

describe("S2 근거 한 줄 — 값이 어디서 왔는지", () => {
  it("읽은 값·범위·직접 넣은 값·쓸 수 없었던 원문을 각각 다른 말로 보인다", async () => {
    server();
    await open();

    expect(screen.getByRole("heading", { name: "문장에서 읽은 항목 7개" })).toBeInTheDocument();
    expect(row("나이")).toHaveTextContent("“만 29세 직장인”에서 읽음");
    expect(row("세대주 여부")).toHaveTextContent("세대주임");
    expect(row("부부합산 총소득")).toHaveTextContent(
      "“4천 후반대”에서 읽음 · 4,500만~5,000만원으로 읽었습니다. 다르면 고쳐주세요",
    );
    expect(row("임차보증금")).toHaveTextContent("1억 8,000만원");
    expect(row("주택 소재지")).toHaveTextContent("직접 넣은 값");
    // 못 쓴 원문: 칸은 빈 채(모름) + 경고
    expect(row("전용면적")).toHaveTextContent("모름");
    expect(row("전용면적")).toHaveTextContent("전용면적: “25평”은 그대로 쓸 수 없습니다. 직접 넣어 주세요");
    // 개인정보 경고
    expect(screen.getByText("주민등록번호로 보이는 내용이 있어 저장하지 않았습니다")).toBeInTheDocument();
  });

  it("고치면 '고친 값 (읽은 값: …)', 비우면 '읽은 값을 비웠습니다'로 바뀐다 (결함 D13)", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "임차보증금 고치기" }));
    const input = screen.getByRole("textbox", { name: "임차보증금" });
    await user.clear(input);
    await user.type(input, "2억");
    expect(row("임차보증금")).toHaveTextContent("고친 값 (읽은 값: 1억 8,000만원) ← “보증금 1억8천”에서 읽음");

    await user.clear(input);
    expect(row("임차보증금")).toHaveTextContent("읽은 값을 비웠습니다 — 모름으로 봅니다");
    expect(row("임차보증금")).not.toHaveTextContent("고친 값");

    // 처음 값으로 되돌리면 다시 '읽음'
    await user.type(input, "18000");
    expect(row("임차보증금")).toHaveTextContent("“보증금 1억8천”에서 읽음");
    expect(row("임차보증금")).not.toHaveTextContent("고친 값");
  });

  it("앞서 직접 넣은 값을 비우면 '읽은 값'이라고 하지 않는다", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "주택 소재지 고치기" }));
    await user.clear(screen.getByRole("textbox", { name: "주택 소재지" }));
    expect(row("주택 소재지")).toHaveTextContent("넣은 값을 비웠습니다 — 모름으로 봅니다");
  });
});

describe("S2 보내기 — 바뀐 값만", () => {
  it("고친 값만 보내고 그대로 둔 값은 보내지 않는다. 성공하면 S3로", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    const age = screen.getByRole("textbox", { name: "나이" });
    await user.clear(age);
    await user.type(age, "31");
    await user.click(nextButton());

    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
    expect(sentBody(spy)).toEqual({ values: { age: 31 } });
  });

  it("비운 값은 0이 아니라 null로 보낸다 (G5)", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    await user.click(screen.getByRole("button", { name: "임차보증금 고치기" }));
    await user.clear(screen.getByRole("textbox", { name: "임차보증금" }));
    await user.click(nextButton());

    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
    expect(sentBody(spy)).toEqual({ values: { lease_deposit_krw: null } });
  });

  it("바뀐 것이 없으면 서버를 부르지 않고 바로 S3로 간다", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    await user.click(nextButton());
    expect(location()).toHaveTextContent("/s/s-1/questions");
    expect(callsTo(spy, PUT)).toHaveLength(0);
  });

  it("비어 있는 항목은 접혀 있고, 펼쳐 넣은 값은 '직접 넣은 값'으로 보낸다", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    const toggle = screen.getByRole("button", { name: "비어 있는 항목 1개 — 아는 값이 있으면 미리 채워도 됩니다" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("비워 두면 판정에 필요한 것만 다음 단계에서 여쭙니다. 화면이 대신 채우지 않습니다.")).not.toBeVisible();

    await user.click(toggle);
    expect(screen.getByText("비워 두면 판정에 필요한 것만 다음 단계에서 여쭙니다. 화면이 대신 채우지 않습니다.")).toBeVisible();
    const date = screen.getByLabelText("전입일");
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveValue("");
    await user.type(date, "2026-11-01");
    await user.click(nextButton());

    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
    expect(sentBody(spy)).toEqual({ values: { move_in_date: "2026-11-01" } });
  });

  it("기다리는 동안 두 번 눌러도 한 번만 보낸다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    const spy = server({ [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    await open();

    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "나이" }), "0");
    // 기다리는 동안 버튼 글이 '보내는 중'으로 바뀌므로 요소를 먼저 잡아 둔다
    const button = nextButton();
    await user.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(callsTo(spy, PUT)).toHaveLength(1);

    await act(async () => finish(json({ session_id: "s-1", values: HELD })));
    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
  });

  it("보내는 중에 화면을 떠났으면 늦게 온 답으로 S3에 끌고 가지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: (r: Response) => void;
    server({ [PUT]: () => new Promise<Response>((resolve) => (finish = resolve)) });
    await open();

    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "나이" }), "0");
    await user.click(nextButton());
    await user.click(screen.getByRole("button", { name: "문장 다시 쓰기" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");

    await act(async () => finish(json({ session_id: "s-1", values: HELD })));
    expect(location()).toHaveTextContent("/write");
  });
});

describe("S2 서버가 값을 거절함 (422)", () => {
  it("이 화면에 머물고, 사유를 그 칸 아래와 버튼 위 목록에 보인다. 어느 칸인지 모르는 사유는 목록에만", async () => {
    const user = userEvent.setup();
    server({
      [PUT]: () => json({ detail: "값이 맞지 않습니다 — 나이: 값을 다시 확인해 주세요; 알 수 없는 문제" }, 422),
    });
    await open();

    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    const age = screen.getByRole("textbox", { name: "나이" });
    await user.clear(age);
    await user.type(age, "300");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await user.click(nextButton());

    expect(await screen.findByText("서버가 받지 않은 값이 있습니다")).toBeInTheDocument();
    expect(location()).toHaveTextContent(PATH);
    // 닫아 둔 줄이 스스로 열리고 칸 아래에 사유가 붙는다
    expect(screen.getByRole("textbox", { name: "나이" })).toHaveAccessibleDescription("값을 다시 확인해 주세요");
    expect(screen.getByText("나이: 값을 다시 확인해 주세요")).toBeInTheDocument();
    expect(screen.getByText("알 수 없는 문제")).toBeInTheDocument();

    // 그 칸을 고치면 칸의 사유는 걷힌다
    await user.type(screen.getByRole("textbox", { name: "나이" }), "1");
    expect(screen.queryByText("나이: 값을 다시 확인해 주세요")).not.toBeInTheDocument();
  });
});

describe("S2 비어 있는 항목 — 고칠 것이 있는 동안", () => {
  const toggle = () => screen.getByRole("button", { name: /^비어 있는 항목/ });

  it("안의 칸에 입력 오류가 있으면 접어도 칸이 가려지지 않는다", async () => {
    const user = userEvent.setup();
    server();
    await open(false);

    await user.click(toggle());
    await user.type(screen.getByRole("textbox", { name: "전용면적" }), "abc");
    await user.click(toggle());
    expect(screen.getByRole("textbox", { name: "전용면적" })).toBeVisible();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("422로 펼쳐진 뒤 접었다가 다시 거절돼도 칸이 보인다", async () => {
    const user = userEvent.setup();
    const spy = server({ [PUT]: () => json({ detail: "값이 맞지 않습니다 — 전입일: 달력에서 골라 주세요" }, 422) });
    await open(false);

    await user.click(toggle());
    await user.type(screen.getByLabelText("전입일"), "2026-11-01");
    await user.click(nextButton());
    expect(await screen.findByText("서버가 받지 않은 값이 있습니다")).toBeInTheDocument();
    await user.click(toggle());
    await user.click(nextButton());
    await vi.waitFor(() => expect(callsTo(spy, PUT)).toHaveLength(2));
    expect(screen.getByLabelText("전입일")).toBeVisible();
  });
});

describe("S2 다시 보낼 때", () => {
  it("다시 보내면 앞선 422 사유를 지운다 — 두 번째가 500이면 낡은 거절 목록이 남지 않는다", async () => {
    const user = userEvent.setup();
    let tries = 0;
    server({
      [PUT]: () =>
        ++tries === 1
          ? json({ detail: "값이 맞지 않습니다 — 나이: 값을 다시 확인해 주세요" }, 422)
          : json({ detail: "고장" }, 500),
    });
    await open();

    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "나이" }), "0");
    await user.click(nextButton());
    expect(await screen.findByText("서버가 받지 않은 값이 있습니다")).toBeInTheDocument();

    await user.click(nextButton());
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했습니다" })).toBeInTheDocument();
    expect(screen.queryByText("서버가 받지 않은 값이 있습니다")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "나이" })).not.toHaveAccessibleDescription(/값을 다시 확인해 주세요/);
  });
});

describe("S2 입력 오류 — 버튼 잠김", () => {
  async function editIncome(user: ReturnType<typeof userEvent.setup>, low: string, high: string) {
    await user.click(screen.getByRole("button", { name: "부부합산 총소득 고치기" }));
    const lo = screen.getByRole("textbox", { name: "부부합산 총소득 최소" });
    const hi = screen.getByRole("textbox", { name: "부부합산 총소득 최대" });
    await user.clear(lo);
    if (low) await user.type(lo, low);
    await user.clear(hi);
    if (high) await user.type(hi, high);
  }

  it("범위 최소>최대면 잠기고, 잠긴 이유와 오류 목록을 보이며, 눌러도 보내지 않는다", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    await editIncome(user, "5000", "4500");
    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    expect(nextButton()).toHaveAccessibleDescription("위 입력 오류를 고치면 눌러집니다.");
    expect(screen.getByText("고쳐야 보낼 수 있습니다")).toBeInTheDocument();
    expect(screen.getByText("부부합산 총소득: 최소가 최대보다 큽니다")).toBeInTheDocument();
    // 고칠 것이 있는 줄은 닫지 못한다(닫으면 오류가 가려진다)
    expect(within(row("부부합산 총소득")).queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();

    await user.click(nextButton());
    expect(callsTo(spy, PUT)).toHaveLength(0);
    expect(location()).toHaveTextContent(PATH);
  });

  it("범위 한쪽만 채우면 잠긴다", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await editIncome(user, "4500", "");
    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("부부합산 총소득: 범위는 두 칸을 모두 채우거나 모두 비워 주세요")).toBeInTheDocument();
  });

  it("금액을 못 읽으면 잠긴다", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "임차보증금 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "억억");
    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/^임차보증금: 금액을 알아볼 수 없습니다/)).toBeInTheDocument();
  });

  it("범위 두 칸 아래에 억·만 범위 표기와 안내가 붙는다 (결함 D12)", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await editIncome(user, "4600", "4800");
    const income = row("부부합산 총소득");
    expect(income).toHaveTextContent("4,600만~4,800만원");
    expect(income).toHaveTextContent("정확한 값을 아시면 두 칸에 같은 값을 넣어 주세요");
    expect(income).toHaveTextContent("고친 값 (읽은 값: 4,500만~5,000만원)");
  });

  it("두 칸에 같은 값을 넣으면 범위가 아니라 정확한 값(정수)으로 보낸다 — 서버 한도 계산은 정수만 받는다", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    await editIncome(user, "4800", "4800");
    const income = row("부부합산 총소득");
    expect(income).toHaveTextContent("4,800만원");
    expect(income).not.toHaveTextContent("4,800만~4,800만원");
    expect(income).toHaveTextContent("고친 값 (읽은 값: 4,500만~5,000만원)");

    await user.click(nextButton());
    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
    expect(sentBody(spy)).toEqual({ values: { combined_annual_income_krw: 48_000_000 } });
  });

  it("서버에 연결되지 않으면 고친 값은 둔 채 버튼만 잠그고, 연결이 돌아오면 푼다 (E1)", async () => {
    const user = userEvent.setup();
    let up = false;
    const spy = server({
      "GET /health": () => (up ? json({ status: "ok", programs: [] }) : Promise.reject(new TypeError("down"))),
    });
    await open();
    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "나이" }), "0");

    expect(await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).toBeInTheDocument();
    expect(nextButton()).toHaveAccessibleDescription("서버에 연결되지 않아 지금은 보낼 수 없습니다.");
    await user.click(nextButton());
    expect(callsTo(spy, PUT)).toHaveLength(0);

    up = true;
    await user.click(screen.getByRole("button", { name: "다시 연결 확인" }));
    await vi.waitFor(() => expect(nextButton()).not.toHaveAttribute("aria-disabled"));
    expect(screen.getByRole("textbox", { name: "나이" })).toHaveValue("290");
  });
});

describe("S2 칸 종류 (설계서 7.2 S2 열)", () => {
  it("예·아니오는 체크박스가 아니라 예/아니오/모름 라디오다. 모름을 고르면 null로 보낸다 (G4)", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "생애최초 주택구입 고치기" }));
    const group = screen.getByRole("group", { name: "생애최초 주택구입" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(["예", "아니오", "모름"]);
    expect(within(group).getByRole("radio", { name: "예" })).toBeChecked();

    await user.click(within(group).getByRole("radio", { name: "모름" }));
    expect(row("생애최초 주택구입")).toHaveTextContent("읽은 값을 비웠습니다 — 모름으로 봅니다");
    await user.click(nextButton());
    await vi.waitFor(() => expect(location()).toHaveTextContent("/s/s-1/questions"));
    expect(sentBody(spy)).toEqual({ values: { is_first_time_buyer: null } });
  });

  it("선택은 드롭다운이고 첫 칸이 '— 모름 —'이다. 이름표는 서버가 준 한국어", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "세대주 여부 고치기" }));
    const select = screen.getByRole("combobox", { name: "세대주 여부" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["— 모름 —", "세대주임", "세대주 예정"]);
    expect(select).toHaveValue("HEAD");
  });

  it("못 쓴 값의 칸은 빈 채로 시작한다 — 0을 채우지 않는다 (G5)", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "전용면적 고치기" }));
    expect(screen.getByRole("textbox", { name: "전용면적" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "전용면적" })).toHaveAccessibleDescription(
      "평이 아니라 제곱미터로 넣어 주세요. 등기부등본이나 매물 정보의 전용면적입니다",
    );
  });
});

describe("S2 들어오는 길", () => {
  it("새로 고침 등으로 라우터 state가 없으면 경고 없이 그린다(오류 아님)", async () => {
    server();
    await open(false);

    expect(screen.queryByText(/저장하지 않았습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/그대로 쓸 수 없습니다/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "문장에서 읽은 항목 6개" })).toBeInTheDocument();
    // 못 쓴 원문이 없으니 전용면적은 비어 있는 항목으로 간다
    expect(screen.getByRole("button", { name: "비어 있는 항목 2개 — 아는 값이 있으면 미리 채워도 됩니다" })).toBeInTheDocument();
  });

  it("세션이 없으면(404) 처음부터 다시 하라고 안내하고, '처음부터'는 S1로 간다 (E2)", async () => {
    const user = userEvent.setup();
    fakeServer({ [SESSION]: () => json({ detail: "없는 세션입니다" }, 404) });
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "이전 확인 기록을 찾을 수 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("처음부터 다시 시작해 주세요. 조건의 문제가 아닙니다.")).toBeInTheDocument();
    // 새로 고친 뒤라 앱 메모리에 문장이 없다 — '두었습니다'라고 하지 않는다
    expect(screen.queryByText("적어 두신 문장은 그대로 두었습니다.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");
  });

  it("항목 목록을 못 받으면 칸 없이 오류 상자를 보이고, 다시 시도하면 그린다 (S2-e)", async () => {
    const user = userEvent.setup();
    let broken = true;
    server({ "GET /v1/fields": () => (broken ? json({ detail: "고장" }, 500) : json({ fields: FIELDS })) });
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "항목 목록을 받지 못했습니다" })).toBeInTheDocument();
    expect(screen.getByText("사유: 고장")).toBeInTheDocument();
    // 세션은 받았으므로 읽은 값이 서버에 있다고 말할 수 있다
    expect(screen.getByText(/읽은 값은 서버에 그대로 있습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확인했습니다 — 다음" })).not.toBeInTheDocument();

    broken = false;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { name: /문장에서 읽은 항목/ })).toBeInTheDocument();
  });
});

describe("S2 세션 조회 실패", () => {
  it("세션 상태를 못 받으면(500) 읽은 값이 서버에 있다고 말하지 않는다 — 확인하지 않은 말이다 (G12)", async () => {
    server({ [SESSION]: () => json({ detail: "고장" }, 500) });
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "읽은 내용을 불러오지 못했습니다" })).toBeInTheDocument();
    expect(screen.getByText("사유: 고장")).toBeInTheDocument();
    expect(screen.queryByText(/서버에 그대로 있습니다/)).not.toBeInTheDocument();
  });

  it("항목 목록과 세션 상태를 둘 다 못 받아도 그 말을 하지 않는다", async () => {
    server({ [SESSION]: () => json({ detail: "고장" }, 500), "GET /v1/fields": () => json({ detail: "고장" }, 500) });
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "항목 목록을 받지 못했습니다" })).toBeInTheDocument();
    expect(screen.queryByText(/서버에 그대로 있습니다/)).not.toBeInTheDocument();
  });
});

describe("S2 오류 상자는 하나만", () => {
  it("연결이 끊긴 채 항목 목록도 못 받으면 '연결 안 됨' 상자 하나만 보인다 — 두 상자가 초점을 다투지 않게", async () => {
    const user = userEvent.setup();
    let up = false;
    server({
      "GET /health": () => (up ? json({ status: "ok", programs: [] }) : Promise.reject(new TypeError("down"))),
      "GET /v1/fields": () => (up ? json({ fields: FIELDS }) : json({ detail: "고장" }, 500)),
    });
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).toBeInTheDocument();
    // 항목 목록 요청이 끝나 뼈대가 걷힐 때까지 기다린 뒤 본다
    await vi.waitFor(() => expect(screen.queryByText("불러오는 중입니다")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "항목 목록을 받지 못했습니다" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /다시/ })).toHaveLength(1);

    // 연결이 돌아오면 '다시 연결 확인' 하나로 항목 목록까지 다시 받는다
    up = true;
    await user.click(screen.getByRole("button", { name: "다시 연결 확인" }));
    expect(await screen.findByRole("heading", { name: /문장에서 읽은 항목/ })).toBeInTheDocument();
  });
});

describe("S2 문장 다시 쓰기", () => {
  it("고친 값이 없으면 묻지 않고 S1로 간다", async () => {
    const user = userEvent.setup();
    server();
    await open();

    await user.click(screen.getByRole("button", { name: "문장 다시 쓰기" }));
    expect(location()).toHaveTextContent("/write");
  });

  it("고친 값이 있으면 확인 창(M1)을 띄우고, 계속하기는 머물고 처음부터는 S1로 간다", async () => {
    const user = userEvent.setup();
    const spy = server();
    await open();
    await user.click(screen.getByRole("button", { name: "나이 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "나이" }), "0");

    await user.click(screen.getByRole("button", { name: "문장 다시 쓰기" }));
    const dialog = screen.getByRole("alertdialog", { name: "처음부터 다시 할까요?" });
    // S2에서 사라지는 것은 이 화면에서 고친 값뿐이다. S3의 '답한 내용'은 아직 없다
    expect(dialog).toHaveTextContent("이 화면에서 고친 값이 사라집니다. 적어 두신 문장은 남습니다.");
    expect(dialog).not.toHaveTextContent("답한");
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "계속하기" }));
    expect(location()).toHaveTextContent(PATH);

    await user.click(screen.getByRole("button", { name: "문장 다시 쓰기" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));
    expect(location()).toHaveTextContent("/write");
    // 서버 세션은 지우지 않고, 고친 값도 보내지 않는다(버려짐)
    expect(callsTo(spy, "DELETE /v1/sessions/s-1")).toHaveLength(0);
    expect(callsTo(spy, PUT)).toHaveLength(0);
  });
});

describe("S2 계산", () => {
  it("처음 값으로 되돌린 칸·같은 범위는 보내지 않는다", () => {
    expect(
      changedValues(
        { a: 1, r: { low: 1, high: 2 }, c: true },
        { a: 1, r: { low: 1, high: 2 }, c: null, d: "x" },
      ),
    ).toEqual({ c: null, d: "x" });
  });

  it("422 사유를 이름표로 칸에 나누고, 모양이 다르면 문장 전체를 남긴다", () => {
    expect(splitRejection("값이 맞지 않습니다 — 나이: 틀림; 전입일: 달력에서", ["age", "move_in_date"], FIELDS)).toEqual({
      byField: { age: "틀림", move_in_date: "달력에서" },
      rest: [],
    });
    expect(splitRejection("없는 항목입니다: foo", ["foo"], FIELDS)).toEqual({ byField: {}, rest: ["없는 항목입니다: foo"] });
  });
});
