import { render, screen } from "@testing-library/react";

import type { Status } from "../api/types";
import { VERDICT_LABEL, VerdictBadge } from "./VerdictBadge";

const STATUSES: Status[] = ["PRECHECK_MATCH", "CONDITIONAL", "NOT_MATCHED", "INSUFFICIENT_INFORMATION"];

describe("판정 배지 (설계서 G1·G2)", () => {
  it("서버 상태 코드 4개를 설계서 8.1 이름 그대로 보인다", () => {
    const { container } = render(
      <>
        {STATUSES.map((s) => (
          <VerdictBadge key={s} status={s} />
        ))}
      </>,
    );
    expect(container.textContent).toBe("사전 조건 부합추가 확인 필요조건 불충족정보 부족");
  });

  it.each(STATUSES)("%s 배지에 확정 표현이 없다", (status) => {
    render(<VerdictBadge status={status} />);
    const text = screen.getByText(VERDICT_LABEL[status]).textContent ?? "";
    for (const banned of ["승인", "가능합니다", "대출 가능", "자격 있음", "가능"]) {
      expect(text).not.toContain(banned);
    }
  });
});
