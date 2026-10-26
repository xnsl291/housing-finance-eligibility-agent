/*
 * S10 용어 도움말 — '?'는 서버가 설명(how_to_check)을 준 항목 중 선택·예아니오·날짜·글 칸에만, 설명은 서버 문구 그대로,
 * 키보드로 열고 닫기. 숫자를 적는 칸(금액·정수·소수)은 how_to_check가 단위 안내('10%를 냈으면 0.1로', '평이 아니라
 * 제곱미터로')라 '?' 안에 숨기지 않고 칸 아래에 늘 보인다(설계서 7.1 — 서버는 숫자인지만 본다).
 *
 * 설명의 정본은 rules/field_guides.yaml이다. 테스트가 쓰는 설명 문구가 그 파일의 문구와 같은지도 대조한다 —
 * 가짜가 실제와 갈라지면 '서버 문구 그대로'를 확인하는 테스트가 엉뚱한 글을 지키게 된다.
 * 한계: web 의존성에 YAML 파서가 없어(의존성은 늘리지 않음) 파일을 글로 읽고, 항목 이름 줄부터 다음 항목 이름 줄 전까지에서
 * `how_to_check:` 한 줄을 찾아 비교한다. 값이 여러 줄이거나 따옴표로 감싸이면 찾지 못해 테스트가 실패한다(틀린 통과는 없음).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import guidesYaml from "../../../rules/field_guides.yaml?raw";

import type { FieldInfo } from "../api/types";
import { FieldInput } from "./ConfirmFields";
import { fakeServer, FIELDS, json, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

/** field_guides.yaml에서 한 항목의 how_to_check(한 줄 값)를 글로 꺼낸다(머리말의 한계) */
function guide(name: string): string {
  const block = new RegExp(String.raw`^${name}:\r?\n((?:[ #].*\r?\n|\r?\n)*)`, "m").exec(guidesYaml)?.[1];
  const value = block && /^ {2}how_to_check: (.+?)\r?$/m.exec(block)?.[1];
  if (!value) throw new Error(`${name}의 how_to_check가 없음`);
  return value;
}

const AREA = guide("housing_area_m2");
const RATIO = guide("deposit_paid_ratio");
const PRICE = guide("housing_value_krw");
const FIRST = guide("is_first_time_buyer");

const RATIO_FIELD: FieldInfo = { label: "임차보증금 지급 비율", kind: "FLOAT", how_to_check: RATIO };
const PRICE_FIELD: FieldInfo = { label: "주택가격", kind: "AMOUNT", how_to_check: PRICE };

function field(info: FieldInfo) {
  render(<FieldInput info={info} initial={null} value={null} error={null} onChange={() => {}} />);
}

describe("용어 도움말 (S10)", () => {
  it("테스트의 가짜 항목 목록(FIELDS) 설명이 규칙 파일(field_guides.yaml)의 how_to_check와 글자까지 같다", () => {
    expect(FIELDS.housing_area_m2.how_to_check).toBe(AREA);
    expect(FIELDS.is_first_time_buyer.how_to_check).toBe(FIRST);
  });

  it("숫자 칸(소수·금액)은 단위 안내를 '?' 없이 칸 아래에 늘 보인다 — 펼치지 않아도 '0.1로'·'제곱미터로'가 보인다", () => {
    field(RATIO_FIELD);
    field(FIELDS.housing_area_m2);
    field(PRICE_FIELD);
    for (const text of [RATIO, AREA, PRICE]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(RATIO)).toHaveTextContent("10%를 냈으면 0.1로 적어 주세요");
    expect(screen.getByText(AREA)).toHaveTextContent("평이 아니라 제곱미터로");
    expect(screen.queryAllByRole("button", { name: /도움말$/ })).toHaveLength(0);
    // 칸의 설명으로도 읽힌다
    expect(screen.getByRole("textbox", { name: "임차보증금 지급 비율" })).toHaveAccessibleDescription(RATIO);
  });

  it("설명이 있는 선택·예아니오 칸만 '?'가 있다 — 없는 항목에 빈 상자를 두지 않는다", () => {
    field(FIELDS.is_first_time_buyer);
    field(FIELDS.age);
    field(FIELDS.household_head_status);
    expect(screen.getByRole("button", { name: "생애최초 주택구입 도움말" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /도움말$/ })).toHaveLength(1);
  });

  it("누르면 서버 문구 그대로 열리고 aria-expanded·aria-controls가 상자를 가리킨다", async () => {
    field(FIELDS.is_first_time_buyer);
    const button = screen.getByRole("button", { name: "생애최초 주택구입 도움말" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(FIRST)).not.toBeVisible();

    await userEvent.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel.textContent).toBe(FIRST);
  });

  it("키보드로 열고, Esc로 닫으면 초점이 '?'로 돌아온다", async () => {
    const user = userEvent.setup();
    field(FIELDS.is_first_time_buyer);
    const button = screen.getByRole("button", { name: "생애최초 주택구입 도움말" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");

    // 칸으로 옮겨 가서 Esc를 눌러도 닫힌다
    await user.tab();
    expect(screen.getByRole("radio", { name: "예" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("닫혀 있어도 칸의 설명으로 읽히고, 묶음 이름에 버튼 글이 섞이지 않는다", () => {
    field(FIELDS.is_first_time_buyer);
    expect(screen.getByRole("group", { name: "생애최초 주택구입" })).toHaveAccessibleDescription(FIRST);
  });

  it("S2 확인 화면: 전용면적(숫자)은 안내가 늘 보이고, 예·아니오 칸에는 '?'가 붙는다", async () => {
    fakeServer({ "GET /v1/sessions/s-1": () => json({ session_id: "s-1", values: {} }) });
    renderApp("/s/s-1/confirm");
    await userEvent.click(await screen.findByRole("button", { name: /비어 있는 항목 \d+개/ }));
    expect(screen.getByText(AREA)).toBeVisible();
    expect(screen.queryByRole("button", { name: "전용면적 도움말" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생애최초 주택구입 도움말" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "부부합산 총소득 도움말" })).not.toBeInTheDocument();
  });
});
