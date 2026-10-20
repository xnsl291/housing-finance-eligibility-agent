import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChoiceList } from "./ChoiceFields";
import { TextField } from "./Field";
import { Provenance } from "./Provenance";
import { QuestionCard } from "./QuestionCard";
import { ReadItemRow } from "./ReadItemRow";

describe("근거 한 줄", () => {
  it("비운 것과 고친 것을 다른 말로 남긴다 (결함 D13)", () => {
    const { rerender, container } = render(<Provenance kind="edited" phrase="연봉 4천" readValue="4,000만원" />);
    expect(container).toHaveTextContent("고친 값 (읽은 값: 4,000만원) ← “연봉 4천”에서 읽음");

    rerender(<Provenance kind="cleared" />);
    expect(container).toHaveTextContent("읽은 값을 비웠습니다 — 모름으로 봅니다");
    expect(container).not.toHaveTextContent("고친 값");
  });

  it("범위로 읽은 것을 범위로 말한다 (G6)", () => {
    const { container } = render(<Provenance kind="range" phrase="4천 후반대" range="4,500만~5,000만원" />);
    expect(container).toHaveTextContent("“4천 후반대”에서 읽음 · 4,500만~5,000만원으로 읽었습니다. 다르면 고쳐주세요");
  });
});

describe("읽은 항목 줄", () => {
  it("고치기를 누르면 칸이 열리고 초점이 칸으로, 닫으면 고치기로 돌아온다", async () => {
    const user = userEvent.setup();
    render(
      <ReadItemRow
        label="주택 소재지"
        value="서울특별시"
        provenance={<Provenance kind="read" phrase="서울에서" />}
        editor={<TextField label="주택 소재지" value="서울특별시" onChange={() => {}} />}
      />,
    );

    await user.click(screen.getByRole("button", { name: "주택 소재지 고치기" }));
    expect(screen.getByRole("textbox", { name: "주택 소재지" })).toHaveFocus();
    // 근거 한 줄은 열어도 남는다
    expect(screen.getByText("“서울에서”에서 읽음")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("button", { name: "주택 소재지 고치기" })).toHaveFocus();
  });
});

describe("읽은 항목 줄의 빈 값", () => {
  it("값이 없으면 근거 줄·드롭다운과 같은 말인 '모름'으로 보인다", () => {
    const { container } = render(
      <ReadItemRow
        label="무주택 여부"
        value={null}
        provenance={<Provenance kind="cleared" />}
        editor={<TextField label="무주택 여부" value={null} onChange={() => {}} />}
      />,
    );
    expect(screen.getByText("모름", { selector: "span" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("(비어 있음)");
  });
});

describe("질문 카드", () => {
  function Card({
    ready,
    onAnswer = () => {},
    onDecline = () => {},
    title = "세대주 여부",
    questionKey = "household_head_status:1",
  }: {
    ready: boolean;
    onAnswer?: () => void | Promise<unknown>;
    onDecline?: () => void | Promise<unknown>;
    title?: string;
    questionKey?: string;
  }) {
    return (
      <QuestionCard
        questionKey={questionKey}
        title={title}
        why="남은 상품 2개 모두 이 값이 있어야 판정할 수 있습니다"
        answerReady={ready}
        onAnswer={onAnswer}
        onDecline={onDecline}
      >
        {(titleId) => (
          <ChoiceList
            labelledBy={titleId}
            value={null}
            options={[
              { value: "HEAD", label: "세대주임" },
              { value: "PROSPECTIVE_HEAD", label: "세대주 예정" },
            ]}
            onChange={() => {}}
          />
        )}
      </QuestionCard>
    );
  }

  it("나타나면 초점이 질문 제목으로 간다", () => {
    render(<Card ready={false} />);
    expect(screen.getByRole("heading", { name: "세대주 여부" })).toHaveFocus();
  });

  it("같은 항목을 다시 물으면(제목 같음, 순번 다름) 초점이 다시 제목으로 간다", () => {
    const { rerender } = render(<Card ready={false} questionKey="household_head_status:1" />);
    act(() => (document.activeElement as HTMLElement).blur());

    rerender(<Card ready={false} questionKey="household_head_status:2" />);
    expect(screen.getByRole("heading", { name: "세대주 여부" })).toHaveFocus();
  });

  it("같은 질문에서 제목 글만 바뀌면 초점을 옮기지 않는다", () => {
    const { rerender } = render(<Card ready={false} questionKey="household_head_status:1" />);
    act(() => (document.activeElement as HTMLElement).blur());

    rerender(<Card ready={false} questionKey="household_head_status:1" title="세대주 여부(다시 확인)" />);
    expect(document.activeElement).toBe(document.body);
  });

  it("답을 고르기 전에는 답하기가 잠기고, 모르겠어요는 늘 누를 수 있다", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const onDecline = vi.fn();
    render(<Card ready={false} onAnswer={onAnswer} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("'답하기'를 기다리는 동안 '모르겠어요'도 잠긴다", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onAnswer = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onDecline = vi.fn();
    render(<Card ready onAnswer={onAnswer} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(onAnswer).toHaveBeenCalledOnce();
    expect(onDecline).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "모르겠어요" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => finish());
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("같은 순간 두 버튼을 눌러도(다시 그려지기 전) 하나만 보낸다", () => {
    const onAnswer = vi.fn(() => new Promise<void>(() => {}));
    const onDecline = vi.fn(() => new Promise<void>(() => {}));
    render(<Card ready onAnswer={onAnswer} onDecline={onDecline} />);
    const answer = screen.getByRole("button", { name: "답하기" });
    const decline = screen.getByRole("button", { name: "모르겠어요" });

    act(() => {
      answer.click();
      decline.click();
    });

    expect(onAnswer).toHaveBeenCalledOnce();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("선택지 묶음 이름이 질문 제목이고, 아무것도 안 고른 채 시작한다", () => {
    render(<Card ready={false} />);
    const group = screen.getByRole("radiogroup", { name: "세대주 여부" });
    expect(group).toBeInTheDocument();
    for (const r of screen.getAllByRole("radio")) expect(r).not.toBeChecked();
  });
});
