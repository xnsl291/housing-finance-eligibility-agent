import { screen, within } from "@testing-library/react";

import { fakeServer, renderApp } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("단계 표시는 주소로 정한다", () => {
  it.each([
    ["/write", "조건 입력"],
    ["/s/abc/confirm", "읽은 내용 확인"],
    ["/s/abc/questions", "하나씩 확인"],
    ["/s/abc/result", "판정 결과"],
  ])("%s 에서는 '%s'가 지금 단계다", async (path, name) => {
    fakeServer();
    renderApp(path);
    const steps = screen.getByRole("list", { name: "진행 단계" });
    expect(within(steps).getByText(name)).toHaveAttribute("aria-current", "step");
  });

  it("첫 화면에는 단계 표시가 없다 (시안 S0)", () => {
    fakeServer();
    renderApp("/");
    expect(screen.queryByRole("list", { name: "진행 단계" })).not.toBeInTheDocument();
  });

  it("S2~S4는 아직 자리표시 화면이다", () => {
    fakeServer();
    renderApp("/s/abc/result");
    expect(screen.getByRole("heading", { level: 1, name: "판정 결과" })).toBeInTheDocument();
    expect(screen.getByText("이 화면은 다음 단계에서 만듭니다.")).toBeInTheDocument();
  });
});

describe("연결 상태", () => {
  it("서버가 답하면 연결됨, 연결이 안 되면 연결되지 않음", async () => {
    fakeServer();
    const { unmount } = renderApp("/write");
    expect(await screen.findByText("판정 서버에 연결됨")).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();

    fakeServer({
      "GET /health": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/write");
    expect(await screen.findByText("판정 서버에 연결되지 않음")).toBeInTheDocument();
  });
});
