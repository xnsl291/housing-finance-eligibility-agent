import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Program } from "../api/types";
import { AppHeader } from "./AppHeader";
import { Sidebar } from "./Sidebar";

describe("단계 표시 (설계서 C-HEADER)", () => {
  it("지금 단계를 표시하고, 눌러서 이동할 수 없다", () => {
    render(<AppHeader step={1} connected />);
    const steps = screen.getByRole("list", { name: "진행 단계" });

    expect(within(steps).getByText("읽은 내용 확인")).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByText(/조건 입력/)).toHaveTextContent("(끝남)");
    expect(within(steps).queryByRole("button")).not.toBeInTheDocument();
    expect(within(steps).queryByRole("link")).not.toBeInTheDocument();
  });

  it("머리 고지를 늘 보인다", () => {
    render(<AppHeader step={0} connected />);
    expect(screen.getByText(/이 화면은 승인 여부를 판단하지 않습니다/)).toBeInTheDocument();
  });
});

describe("사이드바", () => {
  const programs: Program[] = [
    {
      program_id: "nhuf-didimdol",
      program_name: "내집마련디딤돌대출",
      organization: null,
      tenure: "PURCHASE",
      source_url: "https://example.invalid",
      source_checked_at: "2026-10-01",
    },
  ];

  it("상품은 이름과 전세·매매로 보이고, id는 개발자 정보 안에만 있다 (결함 D4)", () => {
    render(<Sidebar programs={programs} apiBase="http://127.0.0.1:8000" connected onReset={() => {}} onDeleteRecords={async () => {}} />);
    const item = screen.getByText("내집마련디딤돌대출");
    expect(item).toHaveTextContent("매매");
    expect(screen.getByText("nhuf-didimdol").closest("details")).not.toHaveAttribute("open");
  });

  it("내 기록 지우기는 확인 창을 거치고, 취소하면 지우지 않는다", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => {});
    render(<Sidebar programs={programs} apiBase="" connected onReset={() => {}} onDeleteRecords={onDelete} />);

    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
