import { act, render, screen } from "@testing-library/react";

// 서버 쪽 화면 상수 파일을 글 그대로 읽는다(Vite ?raw). node 타입을 들이지 않으려고 이렇게 함
import appPy from "../../../src/housing_finance_agent/ui/app.py?raw";
import inputPy from "../../../src/housing_finance_agent/ui/screens/input.py?raw";
import sidebarPy from "../../../src/housing_finance_agent/ui/screens/sidebar.py?raw";

import { LoadingSentence, SystemError, Toast } from "./Feedback";
import { DELETE_NOTE, NOTICE } from "./Notice";
import { StopBanner } from "./StopBanner";
import { VerdictBadge } from "./VerdictBadge";

afterEach(() => vi.useRealTimers());

describe("로딩 문장", () => {
  it("읽어 주는 영역에 있고, 10초가 넘으면 한 줄을 더한다", () => {
    vi.useFakeTimers();
    render(<LoadingSentence label="문장을 읽고 있습니다" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("문장을 읽고 있습니다");
    expect(status).not.toHaveTextContent("조금 더 걸리고 있습니다");

    act(() => vi.advanceTimersByTime(10_000));
    expect(status).toHaveTextContent("조금 더 걸리고 있습니다");
  });
});

describe("오류 모양 (G13)", () => {
  it("시스템 오류는 바로 읽히는 알림이고 초점이 제목으로 간다", () => {
    render(
      <SystemError title="지금 판정 서버에 연결할 수 없습니다" onRetry={() => {}}>
        조건의 문제가 아닙니다.
      </SystemError>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("조건의 문제가 아닙니다.");
    expect(screen.getByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("조건 불충족 판정은 오류 알림으로 그리지 않는다", () => {
    render(<VerdictBadge status="NOT_MATCHED" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("조건 불충족")).not.toHaveAttribute("aria-live");
  });
});

describe("완료 알림", () => {
  it("몇 초 뒤 닫히고, 읽어 주는 영역은 남는다", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast message="결과를 복사했습니다" onClose={onClose} />);
    expect(screen.getByRole("status")).toHaveTextContent("결과를 복사했습니다");

    act(() => vi.advanceTimersByTime(4_000));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("완료 알림 타이머", () => {
  it("onClose가 매번 새 함수여도 타이머가 다시 시작되지 않는다", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Toast message="결과를 복사했습니다" onClose={first} />);

    act(() => vi.advanceTimersByTime(3_000));
    rerender(<Toast message="결과를 복사했습니다" onClose={second} />);
    act(() => vi.advanceTimersByTime(1_000));

    // 처음 뜬 지 4초에 한 번, 그때의 최신 onClose로 닫는다
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("멈춘 이유 배너 (설계서 8.4)", () => {
  it("물을 게 없어 멈춤과 모르셔서 멈춤이 다르게 보인다", () => {
    const { container, rerender } = render(<StopBanner reason="COMPLETE" />);
    const complete = container.textContent;
    rerender(<StopBanner reason="ONLY_DECLINED_LEFT" declinedLabels={["세대주 여부", "순자산"]} />);
    expect(container.textContent).not.toBe(complete);
    expect(container).toHaveTextContent(
      "세대주 여부, 순자산을(를) 모르셔서 확정하지 못한 부분이 있습니다. 확인되면 이어서 판정할 수 있습니다.",
    );
  });

  it("모르는 이유는 '판정했습니다'", () => {
    const { container } = render(<StopBanner reason="SOMETHING_NEW" />);
    expect(container).toHaveTextContent("판정했습니다판정했습니다.");
  });
});

/*
 * 고지 문구는 서버 쪽 화면 상수의 사본이다. 저쪽이 바뀌었는데 여기가 그대로면
 * 저장·삭제에 대해 사실과 다른 말을 하게 된다(G12). 파이썬 파일을 직접 읽어 대조한다.
 */
describe("고지 문구가 서버 쪽 상수와 같다 (C-COPY)", () => {
  const FILES = { "screens/input.py": inputPy, "screens/sidebar.py": sidebarPy, "app.py": appPy };

  function pyConstant(file: keyof typeof FILES, name: string): string {
    const src = FILES[file];
    // 한 줄짜리("...")와 괄호로 여러 줄을 이은 것 둘 다. 저장소 파일이 CRLF일 수 있다
    const m = new RegExp(String.raw`^${name} = (\([\s\S]*?\r?\n\)|"[^\r\n]*")`, "m").exec(src);
    if (!m) throw new Error(`${file}에 ${name}이 없음`);
    return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
  }

  it.each([
    ["input", "screens/input.py", "PRIVACY_NOTICE"],
    ["privacy", "screens/sidebar.py", "PRIVACY_NOTE"],
    ["reset", "screens/sidebar.py", "RESET_NOTE"],
    ["trace", "app.py", "TRACE_NOTE"],
  ] as const)("%s = %s의 %s", (kind, file, name) => {
    expect(NOTICE[kind]).toBe(pyConstant(file, name));
  });

  it("DELETE_NOTE", () => {
    expect(DELETE_NOTE).toBe(pyConstant("screens/sidebar.py", "DELETE_NOTE"));
  });
});
