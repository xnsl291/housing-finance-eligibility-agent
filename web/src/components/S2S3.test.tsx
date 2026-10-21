import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AmountField } from "./AmountFields";
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

describe("근거 한 줄의 빈 자리", () => {
  it("근거 구절이 없으면 지어내지 않고 '문장에서 읽음'만 쓴다", () => {
    const { container } = render(<Provenance kind="edited" phrase={null} readValue="29" />);
    expect(container).toHaveTextContent("고친 값 (읽은 값: 29) ← 문장에서 읽음");
    expect(container).not.toHaveTextContent("“");
  });

  it("앞서 직접 넣은 값을 비우면 '읽은 값'이라 하지 않는다", () => {
    const { container } = render(<Provenance kind="cleared" was="direct" />);
    expect(container).toHaveTextContent("넣은 값을 비웠습니다 — 모름으로 봅니다");
  });
});

describe("읽은 항목 줄", () => {
  it("닫았다 다시 열어도 칸에 적던 글이 남는다", async () => {
    const user = userEvent.setup();
    render(
      <ReadItemRow
        label="임차보증금"
        value="1억 8,000만원"
        provenance={null}
        editor={<AmountField label="임차보증금" defaultWon={180_000_000} onChange={() => {}} />}
      />,
    );
    await user.click(screen.getByRole("button", { name: "임차보증금 고치기" }));
    await user.type(screen.getByRole("textbox", { name: "임차보증금" }), "억");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("textbox", { name: "임차보증금" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "임차보증금 고치기" }));
    expect(screen.getByRole("textbox", { name: "임차보증금" })).toHaveValue("18000억");
  });

  it("고칠 것이 생기면 닫힌 줄이 스스로 열리고, 그동안 닫기를 감춘다. 초점은 옮기지 않는다", () => {
    const row = (problem: boolean) => (
      <ReadItemRow
        label="나이"
        value="29"
        problem={problem}
        provenance={null}
        editor={<TextField label="나이" value="29" onChange={() => {}} />}
      />
    );
    const { rerender } = render(row(false));
    rerender(row(true));
    expect(screen.getByRole("textbox", { name: "나이" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "나이" })).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();

    rerender(row(false));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

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

  it("빈 값 글을 따로 주면(못 쓴 원문 줄) 그 글로 보인다", () => {
    render(
      <ReadItemRow
        label="전용면적"
        value={null}
        emptyLabel="(비어 있음)"
        provenance={null}
        editor={<TextField label="전용면적" value={null} onChange={() => {}} />}
      />,
    );
    expect(screen.getByText("(비어 있음)", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("모름", { selector: "span" })).not.toBeInTheDocument();
  });
});

describe("질문 카드", () => {
  function Card({
    ready,
    onAnswer = () => {},
    onDecline = () => {},
    title = "세대주 여부",
    questionKey = "household_head_status:1",
    lockedReason,
    error,
    inputProblem,
    sending,
  }: {
    ready: boolean;
    inputProblem?: boolean;
    sending?: boolean;
    onAnswer?: () => void | Promise<unknown>;
    onDecline?: () => void | Promise<unknown>;
    title?: string;
    questionKey?: string;
    lockedReason?: string;
    error?: string | null;
  }) {
    return (
      <QuestionCard
        questionKey={questionKey}
        lockedReason={lockedReason}
        error={error}
        inputProblem={inputProblem}
        sending={sending}
        title={title}
        why="남은 상품 2개 모두 이 값이 있어야 판정할 수 있습니다"
        answerReady={ready}
        onAnswer={onAnswer}
        onDecline={onDecline}
      >
        {(titleId, describedBy) => (
          <ChoiceList
            labelledBy={titleId}
            describedBy={describedBy}
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

  it("잠긴 이유를 받으면 답을 골랐어도 두 버튼이 함께 잠긴다 (E1)", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const onDecline = vi.fn();
    render(<Card ready lockedReason="서버에 연결되지 않아 지금은 보낼 수 없습니다" onAnswer={onAnswer} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
    // 같은 이유를 버튼마다 적지 않고 한 줄만. 두 버튼이 그 줄을 설명으로 가리킨다(E1 상자가 이미 위에 있음)
    expect(screen.getAllByText("서버에 연결되지 않아 지금은 보낼 수 없습니다")).toHaveLength(1);
    for (const name of ["답하기", "모르겠어요"]) {
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription("서버에 연결되지 않아 지금은 보낼 수 없습니다");
    }
  });

  it("부모가 보내는 중이면(다시 시도 등 카드 밖에서 보냄) 두 버튼이 함께 잠긴다", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const onDecline = vi.fn();
    render(<Card ready sending onAnswer={onAnswer} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "답하기" }));
    await user.click(screen.getByRole("button", { name: "모르겠어요" }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "답하기" })).toHaveAccessibleDescription("보내는 중이라 잠시 누를 수 없습니다");
  });

  it("칸에 못 읽는 글이 있으면 답하기 잠긴 이유가 '고르거나 적으면'이 아니라 '입력을 고쳐 주세요'다", () => {
    const { rerender } = render(<Card ready={false} />);
    expect(screen.getByRole("button", { name: "답하기" })).toHaveAccessibleDescription("답을 고르거나 적으면 누를 수 있습니다");
    rerender(<Card ready={false} inputProblem />);
    expect(screen.getByRole("button", { name: "답하기" })).toHaveAccessibleDescription("위 칸의 입력을 고쳐 주세요");
  });

  it("모르겠어요 안내는 아직 없는 기능을 약속하지 않는다", () => {
    render(<Card ready={false} />);
    const card = screen.getByRole("region", { name: "세대주 여부" });
    expect(card).toHaveTextContent("‘모르겠어요’를 고르면 이 항목은 다시 묻지 않습니다.");
    expect(card).not.toHaveTextContent("이 조건으로 판정했습니다");
  });

  it("서버가 거절한 사유를 사람이 읽을 한 줄 뒤에 붙여 카드 안에 보이고, 답 칸이 그 줄을 가리킨다 (시안 S3-c)", () => {
    const { rerender } = render(<Card ready error="값이 맞지 않습니다 — 세대주 여부: 고를 수 없는 값" />);
    const card = screen.getByRole("region", { name: "세대주 여부" });
    expect(card).toHaveTextContent(
      "이 값으로는 저장하지 못했습니다. (서버가 보낸 사유: 값이 맞지 않습니다 — 세대주 여부: 고를 수 없는 값)",
    );
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(/^이 값으로는 저장하지 못했습니다\./);

    rerender(<Card ready error={null} />);
    expect(card).not.toHaveTextContent("값이 맞지 않습니다");
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-describedby");
  });

  it("선택지 묶음 이름이 질문 제목이고, 아무것도 안 고른 채 시작한다", () => {
    render(<Card ready={false} />);
    const group = screen.getByRole("radiogroup", { name: "세대주 여부" });
    expect(group).toBeInTheDocument();
    for (const r of screen.getAllByRole("radio")) expect(r).not.toBeChecked();
  });
});
