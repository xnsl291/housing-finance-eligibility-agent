import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

function Page({ onConfirm = () => {} }: { onConfirm?: () => void }) {
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
          onConfirm();
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
});
