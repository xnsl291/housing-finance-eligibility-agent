import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AmountField, RangeField } from "./AmountFields";
import { YesNoField, type YesNo } from "./ChoiceFields";
import { DateField, NumberField, SelectField } from "./Field";

describe("금액 칸", () => {
  it("'3억 2천'을 320000000원으로 넘기고 억·만으로 다시 보여 준다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountField label="임차보증금" onChange={onChange} />);

    await user.type(screen.getByLabelText("임차보증금"), "3억 2천");

    expect(onChange).toHaveBeenLastCalledWith(320_000_000, null);
    expect(screen.getByText("3억 2,000만원")).toBeInTheDocument();
  });

  it("빈칸으로 시작하고, 지워도 0이 아니라 null이다 (G5)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountField label="부부합산 총소득" onChange={onChange} />);

    const input = screen.getByLabelText("부부합산 총소득");
    expect(input).toHaveValue("");
    expect(screen.getByText("— 아직 비어 있습니다")).toBeInTheDocument();

    await user.type(input, "5");
    await user.clear(input);

    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(onChange).not.toHaveBeenCalledWith(0, expect.anything());
  });

  it("서버 값이 있으면 만원 단위로 채워 시작한다", () => {
    render(<AmountField label="임차보증금" defaultWon={180_000_000} onChange={() => {}} />);
    expect(screen.getByLabelText("임차보증금")).toHaveValue("18000");
    expect(screen.getByText("1억 8,000만원")).toBeInTheDocument();
  });

  it("못 알아본 글은 빈칸으로 넘기지 않고 오류를 같이 넘기며, 칸을 떠나면 칸에 연결된 오류를 보인다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmountField label="임차보증금" onChange={onChange} />);
    const input = screen.getByLabelText("임차보증금");

    await user.type(input, "삼억");
    expect(onChange).toHaveBeenLastCalledWith(null, expect.stringContaining("알아볼 수 없습니다"));
    expect(input).not.toHaveAttribute("aria-invalid");

    await user.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("알아볼 수 없습니다"));
  });
});

describe("억·만 표기 live 영역은 늘 두고 글만 바꾼다", () => {
  it("금액 칸: 못 알아본 글이어도 영역은 그대로 남고 글만 비운다", async () => {
    const user = userEvent.setup();
    const { container } = render(<AmountField label="임차보증금" onChange={() => {}} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("— 아직 비어 있습니다");

    await user.type(screen.getByLabelText("임차보증금"), "삼억");
    expect(live).toBeInTheDocument();
    expect(live).toHaveTextContent("");

    await user.clear(screen.getByLabelText("임차보증금"));
    await user.type(screen.getByLabelText("임차보증금"), "3억");
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live).toHaveTextContent("3억원");
  });

  it("범위 칸: 범위가 없을 때도 영역이 있고, 범위가 생기면 같은 영역에 글이 들어간다", async () => {
    const user = userEvent.setup();
    const { container } = render(<RangeField label="소득" onChange={() => {}} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
    expect(live).toHaveTextContent("");

    await user.type(screen.getByLabelText("소득 최소"), "4500");
    await user.type(screen.getByLabelText("소득 최대"), "5천");
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live).toHaveTextContent("4,500만~5,000만원");
  });
});

describe("범위 칸 (G6)", () => {
  it("두 칸을 {low, high} 원 단위로 넘기고 아래에 범위를 억·만으로 보인다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RangeField label="부부합산 총소득" onChange={onChange} />);

    await user.type(screen.getByLabelText("부부합산 총소득 최소"), "4500");
    expect(onChange).toHaveBeenLastCalledWith(null, "최소와 최대를 모두 적어 주세요");

    await user.type(screen.getByLabelText("부부합산 총소득 최대"), "5천");
    expect(onChange).toHaveBeenLastCalledWith({ low: 45_000_000, high: 50_000_000 }, null);
    expect(screen.getByText("4,500만~5,000만원")).toBeInTheDocument();
  });

  it("두 칸에 같은 값을 넣으면 범위가 아니라 정확한 값(정수 하나)으로 넘기고, 표기도 한 값으로 보인다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RangeField label="소득" onChange={onChange} />);

    await user.type(screen.getByLabelText("소득 최소"), "4800");
    await user.type(screen.getByLabelText("소득 최대"), "4800");
    expect(onChange).toHaveBeenLastCalledWith(48_000_000, null);
    expect(screen.getByText("4,800만원")).toBeInTheDocument();
    expect(screen.queryByText("4,800만~4,800만원")).not.toBeInTheDocument();
  });

  it("최소 칸만 떠나 최대 칸으로 가면 오류를 띄우지 않고, 묶음 전체를 떠나면 보인다", async () => {
    const user = userEvent.setup();
    render(
      <>
        <RangeField label="소득" onChange={() => {}} />
        <button type="button">다음</button>
      </>,
    );
    const low = screen.getByLabelText("소득 최소");

    await user.type(low, "4500");
    await user.tab();
    expect(screen.getByLabelText("소득 최대")).toHaveFocus();
    expect(screen.queryByText("최소와 최대를 모두 적어 주세요")).not.toBeInTheDocument();
    expect(low).not.toHaveAttribute("aria-invalid");

    await user.tab();
    expect(screen.getByRole("button", { name: "다음" })).toHaveFocus();
    expect(screen.getByText("최소와 최대를 모두 적어 주세요")).toBeInTheDocument();
    expect(low).toHaveAttribute("aria-invalid", "true");
  });

  it("최소가 최대보다 크면 오류", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RangeField label="소득" defaultValue={{ low: 45_000_000, high: 50_000_000 }} onChange={onChange} />);

    const low = screen.getByLabelText("소득 최소");
    await user.clear(low);
    await user.type(low, "6000");
    // 오류는 묶음(fieldset) 전체를 떠날 때 보인다. 최소 → 최대 → 밖
    await user.tab();
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith(null, "최소가 최대보다 큽니다");
    expect(screen.getByText("최소가 최대보다 큽니다")).toBeInTheDocument();
  });
});

describe("예·아니오·모름 (G4)", () => {
  function Harness({ withUnknown, onChange }: { withUnknown: boolean; onChange: (v: YesNo) => void }) {
    return <YesNoField label="생애최초 주택구입" value={null} withUnknown={withUnknown} onChange={onChange} />;
  }

  it("체크박스가 아니라 라디오이고, 아무것도 안 고른 채 시작한다", () => {
    render(<Harness withUnknown onChange={() => {}} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("모름과 아니오는 다른 값이다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness withUnknown onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "아니오" }));
    await user.click(screen.getByRole("radio", { name: "모름" }));
    await user.click(screen.getByRole("radio", { name: "예" }));

    expect(onChange.mock.calls).toEqual([[false], ["unknown"], [true]]);
  });

  it("질문 화면(S3)은 칸 안에 모름을 두지 않는다", () => {
    render(<Harness withUnknown={false} onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["예", "아니오"]);
  });

  it("그룹 이름이 항목 이름표다", () => {
    render(<Harness withUnknown onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "생애최초 주택구입" })).toBeInTheDocument();
  });
});

describe("그 밖의 칸", () => {
  it("숫자 칸은 빈칸이면 null, 숫자면 숫자", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="나이" integer unit="만 나이" onChange={onChange} />);
    const input = screen.getByLabelText("나이");

    expect(input).toHaveValue("");
    await user.type(input, "29");
    expect(onChange).toHaveBeenLastCalledWith(29, null);
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it("드롭다운 첫 칸은 모름이고 고르면 null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="세대주 여부"
        value="HEAD"
        options={[{ value: "HEAD", label: "세대주임" }]}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText("세대주 여부"), "— 모름 —");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("날짜는 달력 칸이다 (D-34)", () => {
    render(<DateField label="잔금지급일" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("잔금지급일")).toHaveAttribute("type", "date");
  });
});
