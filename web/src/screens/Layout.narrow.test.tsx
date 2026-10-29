/*
 * 좁은 화면(설계서 11.4) — 1,023px 이하에서 사이드바가 머리 메뉴(C-MENU)로 들어간다.
 * jsdom은 배치를 계산하지 않아 여기서는 동작만 본다: 메뉴 열고 닫기, 초점, aria, 메뉴 안 버튼이 사이드바와 같이 동작하는지.
 * 배치(가로 넘침, 44px)는 브라우저로 확인한다.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import headerMenuCss from "../components/HeaderMenu.module.css?raw";
import { callsTo, fakeServer, json, PROGRAMS, renderApp, screenWidth } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 스크롤 잠금 테스트가 바꾼다. 중간에 실패해도 다른 테스트로 새지 않게
  document.documentElement.style.overflow = "";
});

const menuButton = () => screen.getByRole("button", { name: "이 도구에 대해" });
const menu = () => screen.getByRole("dialog", { name: "이 도구에 대해" });

describe("화면 폭에 따라 사이드바 자리가 바뀐다", () => {
  it("넓은 화면(1,024px 이상)은 왼쪽 사이드바, 머리 메뉴 버튼은 없다", () => {
    screenWidth(1440);
    fakeServer();
    renderApp("/write");
    expect(screen.getByRole("complementary", { name: "이 도구에 대해" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 도구에 대해" })).not.toBeInTheDocument();
  });

  it.each([900, 390])("%ipx에서는 사이드바가 없고 머리에 메뉴 버튼이 있다. 사이드바 버튼은 화면에 한 벌뿐이다", (width) => {
    screenWidth(width);
    fakeServer();
    renderApp("/write");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 초기화" })).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "이 도구에 대해" })).toBe(menuButton());
  });
});

describe("머리 메뉴 열고 닫기", () => {
  it("열면 aria-expanded·aria-controls가 메뉴를 가리키고, 초점이 메뉴 안 닫기 버튼으로 가며, 메뉴 밖은 inert", async () => {
    const user = userEvent.setup();
    screenWidth(900);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(menuButton().getAttribute("aria-controls")).toBe(menu().id);
    expect(menu()).toHaveAttribute("aria-modal", "true");
    expect(within(menu()).getByRole("button", { name: "메뉴 닫기" })).toHaveFocus();
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();
  });

  it("메뉴 안에 사이드바 내용이 다 있다 — 상품 목록, 연결 상태, 전체 초기화, 개인정보 안내와 자세히 링크, 내 기록 지우기", async () => {
    const user = userEvent.setup();
    screenWidth(390);
    fakeServer();
    renderApp("/s/s-7/questions");
    await screen.findByText("연결됨");
    await user.click(menuButton());
    const m = within(menu());
    for (const p of PROGRAMS) expect(m.getByText(p.program_name)).toBeInTheDocument();
    expect(m.getByText("판정 서버에 연결됨")).toBeInTheDocument();
    expect(m.getByRole("button", { name: "전체 초기화" })).toBeInTheDocument();
    expect(m.getByRole("heading", { name: "개인정보 안내" })).toBeInTheDocument();
    expect(m.getByRole("link", { name: "개인정보·이용 안내 자세히" })).toBeInTheDocument();
    expect(m.getByRole("button", { name: "내 기록 지우기" })).not.toHaveAttribute("aria-disabled");
  });

  it("Esc로 닫히고 초점이 메뉴 버튼으로 돌아온다. 메뉴 밖 inert도 풀린다", async () => {
    const user = userEvent.setup();
    screenWidth(900);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
  });

  it("닫기 버튼으로 닫아도 초점이 메뉴 버튼으로 돌아온다. 키보드(Enter)로도 열린다", async () => {
    const user = userEvent.setup();
    screenWidth(390);
    fakeServer();
    renderApp("/write");
    menuButton().focus();
    await user.keyboard("{Enter}");
    expect(menu()).toBeInTheDocument();
    await user.click(within(menu()).getByRole("button", { name: "메뉴 닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it("메뉴 바깥(어두운 배경)을 누르면 닫히고 초점이 메뉴 버튼으로 돌아온다", async () => {
    const user = userEvent.setup();
    screenWidth(900);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());
    await user.click(menu().parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it("탭은 메뉴 밖으로 새지 않는다 — 처음에서 Shift+Tab이면 끝으로, 끝에서 Tab이면 처음으로", async () => {
    const user = userEvent.setup();
    screenWidth(900);
    fakeServer();
    renderApp("/s/s-7/questions");
    await user.click(menuButton());
    const close = within(menu()).getByRole("button", { name: "메뉴 닫기" });
    const last = within(menu()).getByRole("button", { name: "내 기록 지우기" });

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });
});

describe("메뉴 안 버튼은 사이드바와 같이 동작한다", () => {
  const SENTENCE = "만 31세이고 연봉 5천입니다.";

  it("전체 초기화: 확인 창이 뜨면 Esc는 확인 창만 닫는다. '처음으로'를 누르면 메뉴가 닫히고 첫 화면으로 간다", async () => {
    const user = userEvent.setup();
    screenWidth(390);
    const server = fakeServer();
    renderApp("/write");
    await user.type(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" }), SENTENCE);
    await user.click(menuButton());
    const reset = within(menu()).getByRole("button", { name: "전체 초기화" });
    await user.click(reset);
    expect(screen.getByRole("alertdialog", { name: "처음으로 돌아갈까요?" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(menu()).toBeInTheDocument();
    expect(reset).toHaveFocus();

    await user.click(reset);
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "문장으로 적기" }));
    expect(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" })).toHaveValue("");
    expect(server.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET")).toHaveLength(0);
  });

  it("내 기록 지우기: 확인 뒤 서버 세션을 지우고, 메뉴가 닫히며 첫 화면으로 가고 완료를 알린다", async () => {
    const user = userEvent.setup();
    screenWidth(900);
    const server = fakeServer(
      { "DELETE /v1/sessions/s-7": () => json({ session_id: "s-7", deleted: true }) },
      { emptySession: true },
    );
    renderApp("/s/s-7/confirm");
    await user.click(menuButton());
    await user.click(within(menu()).getByRole("button", { name: "내 기록 지우기" }));
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "지우기" }));

    await vi.waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(callsTo(server, "DELETE /v1/sessions/s-7")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("내 기록을 서버에서 지웠습니다.")).toBeInTheDocument();
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
  });

  it("개인정보·이용 안내 자세히: 메뉴를 닫고 S11로 가며 초점은 새 화면 제목으로", async () => {
    const user = userEvent.setup();
    screenWidth(390);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());
    await user.click(within(menu()).getByRole("link", { name: "개인정보·이용 안내 자세히" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/privacy");
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });
});

describe("좁은 화면에서 '왼쪽' 사이드바를 가리키던 글", () => {
  it("S0 개인정보 한 줄은 넓은 화면에서 '왼쪽', 좁은 화면에서 머리 메뉴를 가리킨다", () => {
    screenWidth(390);
    fakeServer();
    renderApp("/");
    const line = within(screen.getByRole("region", { name: "시작하기" })).getByText(/입력한 문장 전체는/, { selector: "p" });
    expect(line).toHaveTextContent("위쪽 '이 도구에 대해' 메뉴의 '개인정보 안내'");
    expect(line).not.toHaveTextContent("왼쪽");
  });

  it("그 말이 가리키는 메뉴 버튼 글('이 도구에 대해')은 600px 미만에서도 눈에 보인다 — 숨기면 ☰만 남아 글과 맞지 않는다", () => {
    // jsdom은 @media를 계산하지 않아 규칙 글을 읽는다. 390px에서 글이 들어가는지(가로 넘침 없음)는 브라우저로 확인했다
    screenWidth(390);
    fakeServer();
    renderApp("/");
    const label = within(menuButton()).getByText("이 도구에 대해");
    expect(label.closest(".sr-only")).toBeNull();
    // 메뉴 CSS 어디에도 눈으로만 숨기는 규칙(clip·1px 절대 위치)이나 글을 빼는 규칙이 없다
    expect(headerMenuCss).not.toMatch(/clip:|position:\s*absolute/);
    for (const cls of label.className.split(/\s+/).filter(Boolean)) {
      const name = cls.replace(/^_(.+)_[a-z0-9]+_\d+$/, "$1");
      expect(headerMenuCss).not.toMatch(new RegExp(String.raw`\.${name}\s*\{[^}]*display:\s*none`));
    }
  });

  it("S11 지우는 방법도 같은 말로 바뀐다", () => {
    screenWidth(900);
    fakeServer();
    renderApp("/privacy");
    expect(screen.getByText(/'내 기록 지우기'는 위쪽 '이 도구에 대해' 메뉴의 '개인정보 안내' 아래에 있습니다/)).toBeInTheDocument();
  });
});

describe("머리 메뉴 — 잠깐 다듬은 것", () => {
  it("닫혀 있을 때는 aria-controls가 없다(가리킬 메뉴가 문서에 없음)", () => {
    screenWidth(900);
    fakeServer();
    renderApp("/write");
    expect(menuButton()).not.toHaveAttribute("aria-controls");
  });

  it("열린 동안 뒤 화면은 굴러가지 않고(문서 overflow hidden), 닫으면 원래 값으로 돌아온다", async () => {
    const user = userEvent.setup();
    document.documentElement.style.overflow = "clip";
    screenWidth(900);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());
    expect(document.documentElement.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.documentElement.style.overflow).toBe("clip");
  });
});

describe("구간 경계(1,023/1,024px)를 넘나들 때", () => {
  it("메뉴를 연 채 넓어지면 메뉴가 사라지고, inert가 남지 않으며, 초점이 body로 떨어지지 않는다. 다시 좁아져도 저절로 열리지 않는다", async () => {
    const user = userEvent.setup();
    const setWidth = screenWidth(900);
    fakeServer();
    renderApp("/write");
    await user.click(menuButton());
    expect(menu()).toBeInTheDocument();

    setWidth(1440);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByRole("complementary", { name: "이 도구에 대해" })).toBeInTheDocument();

    setWidth(900);
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("메뉴에서 '내 기록 지우기' 확인 창을 연 채 넓어져도 확인 창이 그대로 있고, 뒤 화면은 계속 inert다", async () => {
    const user = userEvent.setup();
    const setWidth = screenWidth(900);
    fakeServer({}, { emptySession: true });
    renderApp("/s/s-7/confirm");
    await user.click(menuButton());
    await user.click(within(menu()).getByRole("button", { name: "내 기록 지우기" }));
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();

    setWidth(1440);
    expect(screen.getByRole("alertdialog", { name: "내 기록을 지울까요?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("전체 초기화 확인 창도 넓은 화면 → 좁은 화면으로 바뀌어도 그대로 있다", async () => {
    const user = userEvent.setup();
    const setWidth = screenWidth(1440);
    fakeServer();
    renderApp("/write");
    await user.type(screen.getByRole("textbox", { name: "상황을 자유롭게 적어 주세요" }), "만 31세");
    await user.click(screen.getByRole("button", { name: "전체 초기화" }));

    setWidth(390);
    expect(screen.getByRole("alertdialog", { name: "처음으로 돌아갈까요?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("지우는 중에 폭이 바뀌고 지우기가 실패해도 실패 문구가 확인 창 안에 보인다", async () => {
    const user = userEvent.setup();
    const setWidth = screenWidth(900);
    let release: (r: Response) => void = () => {};
    fakeServer(
      { "DELETE /v1/sessions/s-7": () => new Promise<Response>((resolve) => (release = resolve)) },
      { emptySession: true },
    );
    renderApp("/s/s-7/confirm");
    await user.click(menuButton());
    await user.click(within(menu()).getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));

    setWidth(1440);
    release(json({ detail: "고장" }, 500));
    const dialog = await screen.findByRole("alertdialog", { name: "내 기록을 지울까요?" });
    await vi.waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("지우지 못했습니다. 잠시 뒤 다시 눌러 주세요"),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/s/s-7/confirm");
  });
});
