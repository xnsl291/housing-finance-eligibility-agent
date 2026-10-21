/*
 * 화면들이 함께 쓰는 앱 메모리. 적은 문장, 상품 목록, 이 탭에서 연 세션 번호.
 *
 * 적은 문장은 서버에도 브라우저 저장소(localStorage 등)에도 두지 않고 여기에만 둔다. 개인정보 안내가
 * "입력한 문장 전체는 저장하지 않습니다"라고 약속하기 때문이다(G12). 그래서 같은 탭 안에서만 남고,
 * 새로 고치면 사라진다. 실패하거나 S2에서 '문장 다시 쓰기'로 돌아와도 남아 있는 것은 이 덕분이다.
 *
 * 연 세션 번호는 '내 기록 지우기'가 지울 대상이다. 문장을 다시 읽거나 전체 초기화를 하면 주소에서
 * 앞 세션이 사라지는데, 그 세션에도 읽어 낸 값이 남아 있다. 개인정보 안내가 "'내 기록 지우기'로 서버에서
 * 지울 수 있습니다"라고 약속하므로 번호를 받은 순간(그 뒤 성공·실패·시간 초과와 관계없이) 여기 모은다.
 * 한계: 이 목록도 메모리라서 새로 고치면 사라진다. 그 뒤에는 주소에 있는 세션만 지울 수 있다.
 * 세션 열기 자체가 시간 초과로 끊겨 번호를 받지 못한 경우도 모을 수 없다.
 * 브라우저 저장소에 두지 않은 것은 적은 문장과 같은 이유다(이 탭 밖에 흔적을 남기지 않음).
 */
import { createContext, useContext } from "react";

import type { Program } from "../api/types";

/** 상품 목록: 받는 중 / 받지 못함 / 받음 */
export type ProgramsState = "loading" | "failed" | Program[];

export interface AppState {
  draft: string;
  setDraft: (text: string) => void;
  programs: ProgramsState;
  /** 세션을 열어 번호를 받으면 곧바로 부른다. 같은 번호는 한 번만 모인다 */
  rememberSession: (id: string) => void;
}

export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error("useAppState는 Layout 안에서만 쓸 수 있습니다");
  return state;
}
