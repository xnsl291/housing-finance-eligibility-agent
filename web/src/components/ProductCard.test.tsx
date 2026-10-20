import { render, screen } from "@testing-library/react";

import type { Status } from "../api/types";
import { ProductCard, type LimitInfo } from "./ProductCard";

function card(status: Status, limit: LimitInfo, unresolved = 0, items: string[] = []) {
  return render(
    <ProductCard
      name="청년전용 버팀목전세자금"
      status={status}
      limit={limit}
      unresolved={unresolved}
      items={items}
      sourceUrl="https://example.invalid"
      details={<p>근거</p>}
    />,
  );
}

describe("상품 카드의 한도 (G7)", () => {
  it("조건 불충족이면 금액이 있어도 한도 줄이 아예 없다", () => {
    const { container } = card("NOT_MATCHED", { won: 144_000_000 }, 0, ["임차보증금이 3억원을 넘음"]);
    expect(container).not.toHaveTextContent("1억 4,400만원");
    expect(container).not.toHaveTextContent("한도");
    expect(screen.getByRole("heading", { name: "맞지 않는 조건" })).toBeInTheDocument();
  });

  it("남은 조건이 0개일 때만 '예상 대출 한도'로 보인다", () => {
    card("PRECHECK_MATCH", { won: 144_000_000 });
    expect(screen.getByText("예상 대출 한도")).toBeInTheDocument();
    expect(screen.getByText("1억 4,400만원")).toBeInTheDocument();
  });

  it.each(["CONDITIONAL", "INSUFFICIENT_INFORMATION"] as const)(
    "%s이면 남은 조건 수가 0이어도 '예상 대출 한도'로 크게 보이지 않는다",
    (status) => {
      const { container } = card(status, { won: 144_000_000 }, 0);
      expect(container).not.toHaveTextContent("예상 대출 한도");
      expect(container).toHaveTextContent("지금까지 확인된 조건 기준 한도");
      expect(container).toHaveTextContent("판정이 끝나지 않아 이 금액은 달라질 수 있습니다");
      expect(container).not.toHaveTextContent("0개");
    },
  );

  it("확인 안 된 조건이 있으면 확정처럼 보이지 않게 단서를 단다", () => {
    const { container } = card("INSUFFICIENT_INFORMATION", { won: 144_000_000 }, 3);
    expect(container).not.toHaveTextContent("예상 대출 한도");
    expect(container).toHaveTextContent("지금까지 확인된 조건 기준 한도");
    expect(container).toHaveTextContent("아직 확인되지 않은 조건이 3개 있어 이 금액은 달라질 수 있습니다");
  });

  it("금액을 못 내면 설계서 8.3 사유를, 모르는 코드면 기본 문장을 보인다", () => {
    const { container, unmount } = card("CONDITIONAL", { won: null, reason: "BASE_IMPRECISE" }, 1);
    expect(container).toHaveTextContent("금액이 범위로만 들어와 한도를 내지 않았습니다. 정확한 금액을 입력해 주세요");
    unmount();

    const other = card("CONDITIONAL", { won: null, reason: "NEW_CODE" }, 1);
    expect(other.container).toHaveTextContent("대출 한도를 계산하지 못했습니다");
  });

  it("판정 배지가 카드 안에 글자로 있다", () => {
    card("CONDITIONAL", { won: null }, 1, ["부부합산 총소득이 기준에 걸칩니다"]);
    expect(screen.getByText("추가 확인 필요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "더 알려 주시면 판정할 수 있는 것" })).toBeInTheDocument();
  });
});

describe("상품 카드의 공식 링크와 목록", () => {
  it("공식 안내 링크 이름에 상품 이름이 들어가 카드끼리 구분된다", () => {
    card("CONDITIONAL", { won: null }, 1);
    const link = screen.getByRole("link", { name: /공식 안내 페이지/ });
    expect(link).toHaveAccessibleName(expect.stringContaining("청년전용 버팀목전세자금"));
    expect(link).toHaveAccessibleName(expect.stringContaining("(새 창)"));
  });

  it("같은 글의 목록 줄이 둘이어도 key 경고 없이 둘 다 그린다", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      card("CONDITIONAL", { won: null }, 2, ["세대 구성 정보가 필요합니다", "세대 구성 정보가 필요합니다"]);
      expect(screen.getAllByText("세대 구성 정보가 필요합니다")).toHaveLength(2);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
