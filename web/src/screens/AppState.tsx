/*
 * 화면들이 함께 쓰는 앱 메모리. 적은 문장과 상품 목록.
 *
 * 적은 문장은 서버에도 브라우저 저장소(localStorage 등)에도 두지 않고 여기에만 둔다. 개인정보 안내가
 * "입력한 문장 전체는 저장하지 않습니다"라고 약속하기 때문이다(G12). 그래서 같은 탭 안에서만 남고,
 * 새로 고치면 사라진다. 실패하거나 S2에서 '문장 다시 쓰기'로 돌아와도 남아 있는 것은 이 덕분이다.
 */
import { createContext, useContext } from "react";

import type { Program } from "../api/types";

/** 상품 목록: 받는 중 / 받지 못함 / 받음 */
export type ProgramsState = "loading" | "failed" | Program[];

export interface AppState {
  draft: string;
  setDraft: (text: string) => void;
  programs: ProgramsState;
}

export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error("useAppState는 Layout 안에서만 쓸 수 있습니다");
  return state;
}
