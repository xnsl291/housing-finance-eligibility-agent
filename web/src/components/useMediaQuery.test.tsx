import { render } from "@testing-library/react";

import { NARROW, useMediaQuery } from "./useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

function Probe({ n }: { n: number }) {
  const narrow = useMediaQuery(NARROW);
  return (
    <p>
      {n} {String(narrow)}
    </p>
  );
}

describe("useMediaQuery", () => {
  it("다시 그려도 change 듣기를 새로 걸지 않는다 — 질의가 같으면 구독은 한 번", () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: add, removeEventListener: remove }));
    const { rerender } = render(<Probe n={1} />);
    rerender(<Probe n={2} />);
    rerender(<Probe n={3} />);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
