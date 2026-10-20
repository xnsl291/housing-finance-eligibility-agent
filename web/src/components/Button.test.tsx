import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./Button";

describe("로딩 버튼 (설계서 C-LOADING, N4)", () => {
  it("보내는 동안 잠겨 두 번 눌러도 한 번만 보낸다", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Button onClick={send}>답하기</Button>);

    const button = screen.getByRole("button", { name: "답하기" });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(send).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("보내는 중");
    // 화면 읽기 프로그램용 안내
    expect(screen.getByText("보내는 중", { selector: "[aria-live]" })).toBeInTheDocument();

    await act(async () => finish());
    expect(button).toHaveTextContent("답하기");
    await user.click(button);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("같은 순간 두 번 눌러도(다시 그려지기 전) 한 번만 보낸다", async () => {
    const send = vi.fn(() => new Promise<void>(() => {}));
    render(<Button onClick={send}>답하기</Button>);
    const button = screen.getByRole("button", { name: "답하기" });

    act(() => {
      button.click();
      button.click();
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("보내기가 실패해도 처리되지 않은 rejection을 남기지 않고 다시 누를 수 있게 풀린다", async () => {
    const user = userEvent.setup();
    const unhandled = vi.fn();
    // jsdom 환경에도 node의 process가 있다. node 타입을 들이지 않으려고 이렇게 꺼냄
    const proc = (globalThis as unknown as { process: { on: Function; off: Function } }).process;
    proc.on("unhandledRejection", unhandled);
    try {
      const send = vi.fn(() => Promise.reject(new Error("서버 꺼짐")));
      render(<Button onClick={send}>답하기</Button>);
      const button = screen.getByRole("button", { name: "답하기" });

      await user.click(button);
      await act(() => new Promise((r) => setTimeout(r, 20)));

      expect(unhandled).not.toHaveBeenCalled();
      expect(button).not.toHaveAttribute("aria-busy");
      expect(button).toHaveTextContent("답하기");
    } finally {
      proc.off("unhandledRejection", unhandled);
    }
  });

  it("잠긴 버튼은 누름을 무시하고 잠긴 이유를 버튼에 연결한다", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    render(
      <Button onClick={send} lockedReason="칸이 비어 있어 아직 보낼 수 없습니다">
        답하기
      </Button>,
    );

    const button = screen.getByRole("button", { name: "답하기" });
    await user.click(button);

    expect(send).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("칸이 비어 있어 아직 보낼 수 없습니다");
  });
});
