/*
 * S4 고친 뒤 다시 판정(refresh)이 실패했을 때 — 앞 결과를 지우지 않고 '저장은 됐고 판정만 못 했다'고 따로 알린다.
 * S8 배너는 고친 뒤 바뀐 곳 안내가 뜨면 닫힌다.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ASSESS, assessment, open, program, server } from "./resultTesting";
import { callsTo, json } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

const summary = () => screen.getByRole("region", { name: "이 조건으로 판정했습니다" });
const FAILED = "고친 값은 저장했지만 다시 판정하지 못했습니다.";

async function changeAge(user: ReturnType<typeof userEvent.setup>, to: string) {
  await user.click(within(summary()).getByRole("button", { name: "고치기 — 나이" }));
  const field = screen.getByRole("textbox", { name: "나이" });
  await user.clear(field);
  await user.type(field, to);
  await user.click(screen.getByRole("button", { name: "저장" }));
}

/** 판정을 두 번째 부를 때(고친 뒤 다시 판정)만 failing으로 답한다. 세 번째부터는 조건 불충족 */
function failSecondAssess(failing: () => Response) {
  let calls = 0;
  return server({
    [ASSESS]: () => {
      calls += 1;
      if (calls === 1) return assessment(program());
      if (calls === 2) return failing();
      return assessment(program({ status: "NOT_MATCHED", loan_limit: null }));
    },
  });
}

describe("S4 고친 뒤 다시 판정 실패", () => {
  it.each<[string, () => Response, string]>([
    ["시간 초과(504)", () => json({ detail: "중계 시간 초과" }, 504), "사유: 서버가 제때 답하지 않았습니다."],
    ["서버 오류(500)", () => json({ detail: "판정 엔진 오류" }, 500), "사유: 판정 엔진 오류"],
  ])("%s — 앞 결과는 그대로, 따로 알리고 초점을 옮긴다. 다시 판정하면 바뀐 곳 안내로", async (_name, failing, reason) => {
    const user = userEvent.setup();
    const spy = failSecondAssess(failing);
    await open();
    await changeAge(user, "40");

    const notice = (await screen.findByText(FAILED)).closest("[tabindex='-1']") as HTMLElement;
    expect(notice).toHaveTextContent(reason);
    expect(notice).toHaveTextContent("아래 결과는 고치기 전 값으로 판정한 것입니다.");
    expect(notice).toHaveFocus();
    // 앞 결과를 지우지 않는다 — '판정하지 못했습니다' 전면 상자로 바꾸지 않는다
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    expect(screen.queryByText("판정하지 못했습니다")).not.toBeInTheDocument();
    // 저장은 성공했으므로 줄은 닫힌다
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();

    await user.click(within(notice).getByRole("button", { name: "다시 판정" }));
    expect(await screen.findByText(/고치신 값으로 다시 판정했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.getByText("가상 청년 상품 가 — 사전 조건 부합 → 조건 불충족")).toBeInTheDocument();
    expect(callsTo(spy, ASSESS)).toHaveLength(3);
  });

  it("연결 안 됨 — 앞 결과는 그대로, 사유는 연결. 다시 연결 확인하면 다시 판정한다", async () => {
    const user = userEvent.setup();
    const spy = failSecondAssess(() => {
      throw new TypeError("Failed to fetch");
    });
    await open();
    await changeAge(user, "40");

    const notice = (await screen.findByText(FAILED)).closest("[tabindex='-1']") as HTMLElement;
    expect(notice).toHaveTextContent("사유: 서버에 연결되지 않았습니다.");
    expect(notice).toHaveFocus();
    expect(screen.getByRole("heading", { level: 3, name: "가상 청년 상품 가" })).toBeInTheDocument();
    // 연결이 끊긴 동안 다시 판정은 잠긴다. 맨 위 E1 상자의 다시 연결 확인이 다시 판정까지 한다
    expect(within(notice).getByRole("button", { name: "다시 판정" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "다시 연결 확인" }));
    expect(await screen.findByText(/고치신 값으로 다시 판정했습니다/)).toBeInTheDocument();
    expect(callsTo(spy, ASSESS)).toHaveLength(3);
  });

  it("세션이 없어졌으면(404) 화면 전체를 E2로", async () => {
    const user = userEvent.setup();
    failSecondAssess(() => json({ detail: "세션 없음" }, 404));
    await open();
    await changeAge(user, "40");
    expect(await screen.findByRole("heading", { name: "이전 확인 기록을 찾을 수 없습니다" })).toBeInTheDocument();
  });
});

describe("S8 배너 — 고친 뒤", () => {
  it("바뀐 곳 안내가 뜨면 이어서 하기 배너를 닫는다(이미 이어서 작업 중)", async () => {
    const user = userEvent.setup();
    server();
    await open();
    const title = "이전에 하던 확인을 이어서 보여 드립니다";
    expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    await changeAge(user, "30");
    await screen.findByText(/고치신 값으로 다시 판정했습니다/);
    expect(screen.queryByRole("region", { name: title })).not.toBeInTheDocument();
  });
});
