/*
 * S7 고치기 저장 — 고친 값 하나만 PUT /fields로 보내고, 성공하면 화면이 준 다시 받기(after)를 기다린다.
 * S3(다음 질문 다시 받기)와 S4(다시 판정)가 같이 쓴다. 다른 것은 저장 뒤 무엇을 다시 받느냐뿐이라 그것만 받는다.
 *
 * - 한 번에 하나만 보낸다(savingRef). 저장하고 다시 받는 동안 saving이 켜져 있어 화면이 다른 줄과 버튼을 잠근다
 * - 실패는 고치던 줄 아래 한 줄로 돌려준다. 422는 서버 사유 그대로(S3 카드와 같음)
 * - 404(세션 없음)는 줄에 적지 않고 다시 받기를 부른다 — 다시 받기가 같은 404를 받아 화면 전체를 E2로 바꾼다
 * - 연결 안 됨은 Layout 연결 상태를 끊김으로 바꾼다(맨 위 E1 상자). 줄에는 저장하지 못했다는 말만
 * - 시간 초과는 서버가 저장을 마쳤는지 모르므로 "저장하지 못했습니다"라고 단정하지 않는다. 다시 보내도 같은 값을
 *   덮어쓸 뿐이라 안전하다
 * 떠난 뒤 늦게 온 응답은 버린다(useAlive).
 */
import { useRef, useState } from "react";

import { api, ApiError } from "../api/client";
import type { FieldValue } from "../api/types";
import { useAlive, useAppState } from "./AppState";
import { isTimeout } from "./failure";

export function useValueEdit(sessionId: string, after: () => Promise<void>) {
  const { lostConnection } = useAppState();
  const alive = useAlive();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  /** 저장. 성공하면 null, 실패하면 줄 아래에 보일 문장. null 값은 '비움'이다(서버가 지움 → 값 없음으로 받는다) */
  async function save(field: string, value: FieldValue | null): Promise<string | null> {
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    try {
      try {
        await api.setFields(sessionId, { [field]: value });
      } catch (error) {
        if (!alive.current) return null;
        if (error instanceof ApiError && error.status === 404) {
          await after();
          return null;
        }
        return failureText(error, lostConnection);
      }
      if (alive.current) await after();
      return null;
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  }

  return { saving, save };
}

function failureText(error: unknown, lostConnection: () => void): string {
  if (error instanceof ApiError && error.status === 422) return error.message;
  if (error instanceof ApiError && error.kind === "network") {
    lostConnection();
    return "서버에 연결되지 않아 저장하지 못했습니다. 연결되면 다시 저장해 주세요.";
  }
  if (isTimeout(error)) return "서버가 제때 답하지 않았습니다. 저장됐는지 알 수 없으니 다시 저장해 주세요.";
  if (error instanceof ApiError && error.kind === "http") return `저장하지 못했습니다. 사유: ${error.message}`;
  return "저장하지 못했습니다. 다시 저장해 주세요.";
}
