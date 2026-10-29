import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("단계를 넘기지 않으면(첫 화면) 단계 표시를 그리지 않는다", () => {
    render(<AppHeader connected />);
    expect(screen.queryByRole("list", { name: "진행 단계" })).not.toBeInTheDocument();
    expect(screen.getByText(/이 화면은 승인 여부를 판단하지 않습니다/)).toBeInTheDocument();
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
    render(<Sidebar programs={programs} apiBase="http://127.0.0.1:8000" connected onReset={() => {}} onDeleteRecords={async () => {}} />, { wrapper: MemoryRouter });
    const item = screen.getByText("내집마련디딤돌대출");
    expect(item).toHaveTextContent("매매");
    expect(screen.getByText("nhuf-didimdol").closest("details")).not.toHaveAttribute("open");
  });

  it("버튼은 누른 것만 알린다 — 확인 창은 Layout이 띄운다(Layout.test.tsx)", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onDelete = vi.fn();
    render(<Sidebar programs={programs} apiBase="" connected onReset={onReset} onDeleteRecords={onDelete} />, { wrapper: MemoryRouter });

    await user.click(screen.getByRole("button", { name: "전체 초기화" }));
    await user.click(screen.getByRole("button", { name: "내 기록 지우기" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("상품 목록이 비어 있으면(받지 못함) 상품 묶음 제목도, 개발자 정보의 '상품 id' 항목도 그리지 않는다", () => {
    render(<Sidebar programs={[]} apiBase="http://127.0.0.1:8000" connected={false} onReset={() => {}} />, { wrapper: MemoryRouter });
    expect(screen.queryByText("판정에 쓰는 상품")).not.toBeInTheDocument();
    const dev = screen.getByText("http://127.0.0.1:8000").closest("details")!;
    expect(dev).not.toHaveTextContent("상품 id");
  });

  it("연결을 확인하기 전에는 연결됐다고 말하지 않는다", () => {
    render(<Sidebar programs={programs} apiBase="" connected={null} onReset={() => {}} />, { wrapper: MemoryRouter });
    expect(screen.getByText("판정 서버 연결 확인 중")).toBeInTheDocument();
    expect(screen.queryByText("판정 서버에 연결됨")).not.toBeInTheDocument();
  });

  it("지울 세션이 없으면(onDeleteRecords 없음) 내 기록 지우기를 숨기지 않고 잠근 채 이유를 보인다", async () => {
    const user = userEvent.setup();
    render(<Sidebar programs={programs} apiBase="" connected onReset={() => {}} />, { wrapper: MemoryRouter });
    const button = screen.getByRole("button", { name: "내 기록 지우기" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("아직 지울 기록이 없습니다");
    await user.click(button);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // 개인정보 안내 문구는 그대로 둔다
    expect(screen.getByText(/'내 기록 지우기'로 서버에서 지울 수 있고, 마지막으로 쓴 때로부터 7일이 지나면 저절로 지워집니다/)).toBeInTheDocument();
  });
});
