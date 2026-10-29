import { act, render, screen } from "@testing-library/react";

import { LoadingSentence, SystemError, Toast } from "./Feedback";
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
  it("시스템 오류는 초점을 제목으로 옮겨 알리고, role=alert를 겹쳐 두 번 읽히게 하지 않는다", () => {
    render(
      <SystemError title="지금 판정 서버에 연결할 수 없습니다" onRetry={() => {}}>
        조건의 문제가 아닙니다.
      </SystemError>,
    );
    expect(screen.getByRole("heading", { name: "지금 판정 서버에 연결할 수 없습니다" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "지금 판정 서버에 연결할 수 없습니다" })).toHaveTextContent(
      "조건의 문제가 아닙니다.",
    );
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
