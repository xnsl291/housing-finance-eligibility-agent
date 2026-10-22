/*
 * 서버 호출. 화면은 판정 코드를 모르고 이 경로들만 안다(`api.py` 머리말).
 *
 * 실패를 셋으로 나눠 돌려준다. Streamlit 화면은 셋을 한 덩어리로 받아, 서버가 살아 있는데
 * 오래 걸렸을 뿐인 경우에도 "서버를 띄운 뒤 다시 눌러 주세요"를 보였다(설계서 결함 D14).
 * - network: 연결이 안 됨. 서버가 꺼졌을 때(중계가 502로 알려 온 경우 포함)
 * - timeout: 연결은 됐는데 제한 시간 안에 답이 없음
 * - http: 서버가 거절함. `detail`은 서버가 사람이 읽을 문장으로 준 사유(PR #28)
 */
import type {
  Assessment,
  ExtractedState,
  FieldCatalog,
  Health,
  NextAction,
  Program,
  SessionState,
  Trace,
} from "./types";

export type ApiErrorKind = "network" | "timeout" | "http";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

// 짧은 호출은 10초. 문장 읽기는 LLM을 부르므로 서버의 LLM 제한 시간(기본 120초)보다
// 조금 길게 기다린다. 화면이 먼저 끊으면 서버는 끝까지 일하고 답은 버려진다.
const QUICK_MS = 10_000;
const LLM_MS = 130_000;

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = QUICK_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError("timeout", "오래 걸려 중단했습니다");
    }
    throw new ApiError("network", "서버에 연결할 수 없습니다");
  } finally {
    clearTimeout(timer);
  }

  // 502를 '연결 안 됨'으로 보는 것은 "판정 서버(FastAPI)는 502를 내지 않는다"는 전제 위에 서 있다.
  // 502는 사이에 선 중계(개발 서버의 프록시 등)가 판정 서버에 닿지 못했을 때 낸다. http로 두면 서버가
  // 꺼졌는데 "요청이 거부됐습니다 (HTTP 502)"가 보인다. 판정 서버가 502를 내게 바뀌면 이 줄을 다시 볼 것.
  // 504(중계의 시간 초과)는 연결은 된 것이라 여기서 바꾸지 않고 http로 두며, 화면 쪽(failure.ts)이 시간 초과로 묶는다
  if (response.status === 502) {
    throw new ApiError("network", "서버에 연결할 수 없습니다", 502);
  }
  if (!response.ok) {
    throw new ApiError("http", await detailOf(response), response.status);
  }
  return (await response.json()) as T;
}

async function detailOf(response: Response): Promise<string> {
  try {
    const detail = (await response.json())?.detail;
    // FastAPI의 자체 검증 오류는 detail이 목록이다. 사용자가 읽을 문장이 아니라 코드만 알린다.
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // 본문이 JSON이 아님
  }
  return `요청이 거부됐습니다 (HTTP ${response.status})`;
}

const s = (id: string) => `/v1/sessions/${encodeURIComponent(id)}`;

export const api = {
  health: () => call<Health>("GET", "/health"),
  programs: () => call<{ programs: Program[] }>("GET", "/v1/programs"),
  fields: () => call<{ fields: FieldCatalog }>("GET", "/v1/fields"),
  startSession: () => call<{ session_id: string }>("POST", "/v1/sessions"),
  session: (id: string) => call<SessionState>("GET", s(id)),
  sendMessage: (id: string, message: string) =>
    call<ExtractedState>("POST", `${s(id)}/messages`, { message }, LLM_MS),
  setFields: (id: string, values: Record<string, unknown>) =>
    call<SessionState>("PUT", `${s(id)}/fields`, { values }),
  next: (id: string) => call<NextAction>("GET", `${s(id)}/next`),
  decline: (id: string, field: string) =>
    call<{ session_id: string; declined: string[] }>("POST", `${s(id)}/declined`, { field }),
  /**
   * 판정. programIds를 주면 그 상품만(본문에 id 목록을 그대로 — api.py assess_session, Streamlit api_client와 같은 모양).
   * 결과 화면은 next가 준 후보만 보낸다. 빈 목록은 서버가 '전부'로 읽으므로 보내지 않는다
   */
  assess: (id: string, programIds?: string[]) =>
    call<Assessment>(
      "POST",
      `${s(id)}/assessment`,
      programIds && programIds.length > 0 ? programIds : undefined,
    ),
  trace: (id: string) => call<Trace>("GET", `${s(id)}/trace`),
  deleteSession: (id: string) =>
    call<{ session_id: string; deleted: boolean }>("DELETE", s(id)),
};
