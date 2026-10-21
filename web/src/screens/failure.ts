/*
 * 서버 호출 실패를 사용자가 읽을 말로 바꾼다. 설계서 C-ERROR, 결함 D14(시간 초과를 '연결 안 됨'으로
 * 보이던 것)를 고친 자리다.
 *
 * 어느 경우든 "당신 조건의 문제가 아닙니다"가 드러나야 한다(G13). 조건 불충족 판정과 섞이면 안 된다.
 *
 * stage는 어느 호출에서 실패했는지다. 같은 시간 초과라도 세션을 여는 짧은 호출(10초)과 문장을 읽는
 * 긴 호출(LLM)은 뜻이 다르다. 문장을 읽다 끊긴 경우만 "서버는 켜져 있습니다"라고 말할 수 있다 —
 * 바로 앞에서 세션 열기가 성공했기 때문이다.
 *
 * 504는 시간 초과로 묶는다. 판정 서버는 504를 내지 않고, 사이에 선 중계(개발 서버의 프록시 등)가
 * "판정 서버가 제때 답하지 않았다"고 알려 온 것이다. 거절(http)로 두면 "요청이 거부됐습니다 (HTTP 504)"가 보인다.
 *
 * 422(서버가 입력을 거절함)는 여기서 다루지 않는다. 시스템 오류가 아니라 입력 오류라서 상자가 아니라
 * 칸 바로 아래에 보인다(설계서 C-ERROR). 화면은 inputRejection으로 먼저 걸러 낸다.
 */
import { ApiError } from "../api/client";
import type { IconName } from "../components/Icon";

/** start: 세션 열기(POST /v1/sessions) · read: 문장 읽기(POST .../messages) */
export type Stage = "start" | "read";

export interface FailureText {
  title: string;
  body: string;
  icon: IconName;
  /**
   * 문장 없이 항목을 직접 채우는 길(S1-F)을 권할지와 그 버튼의 무게. 문장 읽기가 실패·지연된 경우만.
   * 503은 다시 해도 같을 가능성이 커 직접 입력이 주 버튼, 시간 초과는 다시 시도가 먼저라 보조 버튼(시안 S1-d·S1-f)
   */
  direct: "primary" | "secondary" | null;
}

/** 서버가 입력을 거절했으면(422) 칸 아래에 보일 사유를, 아니면 null */
export function inputRejection(error: unknown): string | null {
  return error instanceof ApiError && error.status === 422 ? error.message : null;
}

function isTimeout(error: ApiError): boolean {
  return error.kind === "timeout" || error.status === 504;
}

export function describeFailure(error: unknown, stage: Stage): FailureText {
  if (error instanceof ApiError && error.kind === "network") {
    // 시안 E1
    return {
      title: "지금 판정 서버에 연결할 수 없습니다",
      body: "조건의 문제가 아닙니다.",
      icon: "serverOff",
      direct: null,
    };
  }
  if (error instanceof ApiError && isTimeout(error)) {
    if (stage === "read") {
      // 설계서 E3
      return {
        title: "문장을 읽는 데 너무 오래 걸려 중단했습니다",
        body: "서버는 켜져 있습니다. 다시 시도하거나, 항목을 직접 고를 수 있습니다.",
        icon: "timer",
        direct: "secondary",
      };
    }
    return {
      title: "서버가 제때 답하지 않아 중단했습니다",
      body: "조건의 문제가 아닙니다. 잠시 뒤 다시 시도해 주세요.",
      icon: "timer",
      direct: null,
    };
  }
  if (error instanceof ApiError && error.status === 503 && stage === "read") {
    // 설계서 S1 상태 표 '문장을 못 읽음 (503)'
    return {
      title: "조건을 읽지 못했습니다",
      body: "문장 해석이 실패한 것이고 조건에 문제가 있는 것은 아닙니다. 아래로 넘어가면 문장 없이 항목을 직접 채워서 판정할 수 있습니다.",
      icon: "fileX",
      direct: "primary",
    };
  }
  // 그 밖의 거절은 서버가 준 문구를 그대로(설계서 S1 '그 밖의 오류'). ApiError가 아닌 것은 화면 쪽 잘못이다
  return {
    title: "요청을 처리하지 못했습니다",
    body: error instanceof ApiError ? error.message : "화면에서 예상하지 못한 오류가 났습니다. 다시 시도해 주세요.",
    icon: "alertCircle",
    direct: null,
  };
}
