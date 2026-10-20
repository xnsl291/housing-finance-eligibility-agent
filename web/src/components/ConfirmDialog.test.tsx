import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

function Page({ onConfirm = () => {} }: { onConfirm?: () => void | Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">다른 버튼</button>
      <button type="button" onClick={() => setOpen(true)}>
        처음부터 다시
      </button>
      <ConfirmDialog
        open={open}
        title="처음부터 다시 할까요?"
        confirmLabel="처음부터"
        cancelLabel="계속하기"
        onConfirm={() => {
          const r = onConfirm();
          if (r instanceof Promise) return r.then(() => setOpen(false));
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      >
        지금까지 고치고 답한 내용이 사라집니다.
      </ConfirmDialog>
    </>
  );
}

describe("확인 창 (설계서 11.3)", () => {
  it("열리면 초점이 안전한 쪽(계속하기)에 간다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));

    expect(screen.getByRole("alertdialog", { name: "처음부터 다시 할까요?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveFocus();
  });

  it("엔터 한 번으로는 지워지지 않는다", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Page onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Esc로 닫히고, 닫히면 창을 연 버튼으로 초점이 돌아온다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "처음부터 다시" });
    await user.click(opener);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("버튼으로 닫아도 창을 연 버튼으로 돌아온다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "처음부터 다시" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "계속하기" }));

    expect(opener).toHaveFocus();
  });

  it("탭이 창 밖으로 새지 않는다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog");

    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 5; i++) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("창 안에 초점이 없어도 Esc로 닫힌다(키 처리가 문서 수준)", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("창 안에 초점이 없을 때 탭을 누르면 창 안으로 들어온다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog");
    act(() => (document.activeElement as HTMLElement).blur());

    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("창 밖 배경을 눌러도 초점이 창에 남는다", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog");

    await user.click(dialog.parentElement as HTMLElement);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("열린 동안 창 밖 화면은 inert이고, 닫으면 풀린다", async () => {
    const user = userEvent.setup();
    const { container } = render(<Page />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    const dialog = screen.getByRole("alertdialog");

    expect(container).toHaveAttribute("inert");
    expect(dialog.closest("[inert]")).toBeNull();

    await user.keyboard("{Escape}");
    expect(container).not.toHaveAttribute("inert");
  });

  it("되돌릴 수 없는 일을 기다리는 동안에는 Esc·취소로 닫히지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    render(<Page onConfirm={() => new Promise<void>((resolve) => (finish = resolve))} />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "계속하기" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => finish());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("창을 연 버튼이 사라졌으면 초점을 본문 제목으로 보낸다", async () => {
    function Reset() {
      const [open, setOpen] = useState(false);
      const [done, setDone] = useState(false);
      return (
        <main>
          <h1>주거금융 지원가능성 판정</h1>
          {!done && (
            <button type="button" onClick={() => setOpen(true)}>
              처음부터 다시
            </button>
          )}
          <ConfirmDialog
            open={open}
            title="처음부터 다시 할까요?"
            confirmLabel="처음부터"
            cancelLabel="계속하기"
            onConfirm={() => {
              setDone(true);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          >
            본문
          </ConfirmDialog>
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Reset />);
    await user.click(screen.getByRole("button", { name: "처음부터 다시" }));
    await user.click(screen.getByRole("button", { name: "처음부터" }));

    expect(screen.getByRole("heading", { name: "주거금융 지원가능성 판정" })).toHaveFocus();
  });
});
