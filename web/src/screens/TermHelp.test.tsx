/*
 * S10 용어 도움말 — '?'는 서버가 설명(how_to_check)을 준 항목에만, 설명은 서버 문구 그대로, 키보드로 열고 닫기.
 * 설명의 정본은 rules/field_guides.yaml이다. 테스트의 가짜 항목 목록(FIELDS)이 그 문구와 같은지도 대조한다 —
 * 가짜가 실제와 갈라지면 '서버 문구 그대로'를 확인하는 테스트가 엉뚱한 글을 지키게 된다.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import guidesYaml from "../../../rules/field_guides.yaml?raw";

import { FieldInput } from "./ConfirmFields";
import { fakeServer, FIELDS, json, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

const AREA = FIELDS.housing_area_m2;

function field(name: keyof typeof FIELDS) {
  render(<FieldInput info={FIELDS[name]} initial={null} value={null} error={null} onChange={() => {}} />);
}

describe("용어 도움말 (S10)", () => {
  it("테스트의 설명 문구가 규칙 파일(field_guides.yaml)의 how_to_check와 글자까지 같다", () => {
    expect(guidesYaml).toContain(`how_to_check: ${AREA.how_to_check}`);
  });

  it("설명이 있는 항목만 '?'가 있다 — 없는 항목에 빈 상자를 두지 않는다", () => {
    field("housing_area_m2");
    field("age");
    field("is_first_time_buyer");
    expect(screen.getByRole("button", { name: "전용면적 도움말" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "나이 도움말" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /도움말$/ })).toHaveLength(1);
  });

  it("누르면 서버 문구 그대로 열리고 aria-expanded·aria-controls가 상자를 가리킨다", async () => {
    field("housing_area_m2");
    const button = screen.getByRole("button", { name: "전용면적 도움말" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(AREA.how_to_check!)).not.toBeVisible();

    await userEvent.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel.textContent).toBe(AREA.how_to_check);
  });

  it("키보드로 열고, Esc로 닫으면 초점이 '?'로 돌아온다", async () => {
    const user = userEvent.setup();
    field("housing_area_m2");
    const button = screen.getByRole("button", { name: "전용면적 도움말" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");

    // 칸으로 옮겨 가서 Esc를 눌러도 닫힌다
    await user.tab();
    expect(screen.getByRole("textbox", { name: "전용면적" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("닫혀 있어도 칸의 설명으로 읽힌다 — '?'를 열지 않는 화면 읽기 프로그램 사용자도 놓치지 않게", () => {
    field("housing_area_m2");
    expect(screen.getByRole("textbox", { name: "전용면적" })).toHaveAccessibleDescription(AREA.how_to_check!);
  });

  it("예·아니오 묶음에도 붙고, 묶음 이름에 버튼 글이 섞이지 않는다", () => {
    const info = { ...FIELDS.is_first_time_buyer, how_to_check: "본인과 배우자 모두 과거에 주택을 소유한 적이 없어야 합니다" };
    render(<FieldInput info={info} initial={null} value={null} error={null} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "생애최초 주택구입" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생애최초 주택구입 도움말" })).toBeInTheDocument();
  });

  it("S2 확인 화면의 칸에 붙는다", async () => {
    fakeServer({ "GET /v1/sessions/s-1": () => json({ session_id: "s-1", values: {} }) });
    renderApp("/s/s-1/confirm");
    await userEvent.click(await screen.findByRole("button", { name: /비어 있는 항목 \d+개/ }));
    expect(screen.getByRole("button", { name: "전용면적 도움말" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "부부합산 총소득 도움말" })).not.toBeInTheDocument();
  });
});
