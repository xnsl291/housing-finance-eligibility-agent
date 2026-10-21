import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function 응답(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("실패를 셋으로 나눈다 (설계서 D14)", () => {
  it("연결이 안 되면 network", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.health()).rejects.toMatchObject({ kind: "network", status: null });
  });

  it("제한 시간이 지나면 timeout — 서버가 꺼졌다고 말하지 않는다", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const 결과 = api.health().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);

    const 오류 = (await 결과) as ApiError;
    expect(오류.kind).toBe("timeout");
    expect(오류.message).not.toContain("연결할 수 없");
  });

  it("중계(개발 서버 프록시)가 판정 서버에 닿지 못해 502를 주면 network", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502 }));

    await expect(api.startSession()).rejects.toMatchObject({ kind: "network", status: 502 });
  });

  it("서버가 거절하면 http와 서버가 준 사유", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      응답(422, { detail: "나이: 소수점 없는 숫자로 넣어 주세요" }),
    );

    await expect(api.setFields("abc", { age: "스물" })).rejects.toMatchObject({
      kind: "http",
      status: 422,
      message: "나이: 소수점 없는 숫자로 넣어 주세요",
    });
  });

  it("사유가 문장이 아니면 코드만 알린다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(응답(422, { detail: [{ loc: ["body"] }] }));

    await expect(api.health()).rejects.toMatchObject({
      message: "요청이 거부됐습니다 (HTTP 422)",
    });
  });
});

it("세션 번호는 주소에 그대로 끼우지 않는다", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(응답(200, {}));

  await api.session("a/b");

  expect(fetch.mock.calls[0][0]).toBe("/v1/sessions/a%2Fb");
});
