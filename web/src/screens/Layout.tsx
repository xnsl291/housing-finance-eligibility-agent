/*
 * 모든 화면이 공유하는 틀. 사이드바 + 본문(머리 영역 + 화면). 설계서 4절 C-HEADER·C-SIDE, 시안 S0·S1.
 *
 * 여기서 하는 일
 * - 앱 메모리(적은 문장, 상품 목록)를 갖고 아래 화면에 나눠 준다(AppState.tsx)
 * - 서버 연결 상태를 본다. 처음 열 때와 주소가 바뀔 때마다(설계서 E1 "화면을 다시 그릴 때마다"),
 *   화면이 '다시 연결 확인'을 누를 때. 화면의 호출이 연결 안 됨으로 실패해도 끊김으로 바꾼다(lostConnection)
 * - 단계는 주소로 정한다(routes.ts). 단계가 바뀐 순간에만 본문이 위에서 내려온다(C-HEADER, 420ms)
 * - 주소가 바뀌면 초점을 새 화면 제목(h1)으로 옮긴다(시안 C0 1절). 화면 읽기 프로그램 사용자가
 *   화면이 바뀐 것을 알게 하려고
 * - 전체 초기화(적은 문장만 비움, 서버 기록과 연 세션 목록은 그대로)와 내 기록 지우기(이 탭에서 연
 *   세션과 주소의 세션을 서버에서 삭제)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";

import { api, ApiError } from "../api/client";
import { AppHeader } from "../components/AppHeader";
import { Toast } from "../components/Feedback";
import { Sidebar } from "../components/Sidebar";
import { AppStateContext, type ProgramsState } from "./AppState";
import { stepOf } from "./routes";
import styles from "./Layout.module.css";

export function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sessionId = useMatch("/s/:sessionId/*")?.params.sessionId;
  const step = stepOf(pathname);

  const [draft, setDraft] = useState("");
  const [programs, setPrograms] = useState<ProgramsState>("loading");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 이 탭에서 연 세션 번호(AppState.tsx 머리말). 전체 초기화로 비우지 않는다 — 초기화 뒤에도 지울 수 있어야 한다
  const [opened, setOpened] = useState<string[]>([]);
  // 이 탭에서 이미 지운 번호. 일부만 실패해 다시 누를 때 지운 것을 또 보내지 않으려고
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());

  const rememberSession = useCallback((id: string) => {
    setOpened((list) => (list.includes(id) ? list : [...list, id]));
  }, []);
  const recheckConnection = useCallback(async () => {
    try {
      await api.health();
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);
  const lostConnection = useCallback(() => setConnected(false), []);

  useEffect(() => {
    let alive = true;
    api.programs().then(
      (r) => alive && setPrograms(r.programs),
      () => alive && setPrograms("failed"),
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api.health().then(
      () => alive && setConnected(true),
      () => alive && setConnected(false),
    );
    return () => {
      alive = false;
    };
  }, [pathname]);

  // 처음 그릴 때는 옮기지 않는다. 막 연 페이지에서 초점을 빼앗으면 주소창·첫 링크부터 읽는 흐름이 깨진다
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const heading = document.querySelector<HTMLElement>("main h1");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, [pathname]);

  function reset() {
    setDraft("");
    navigate("/");
  }

  // 지울 대상: 이 탭에서 연 세션 + 주소의 세션. 같은 번호는 한 번만, 이미 지운 것은 뺀다
  const targets = [...new Set([...opened, ...(sessionId === undefined ? [] : [sessionId])])].filter(
    (id) => !gone.has(id),
  );

  async function deleteRecords() {
    const results = await Promise.allSettled(
      targets.map((id) =>
        api.deleteSession(id).catch((error) => {
          // 404는 이미 없는 것이라 지운 것으로 친다
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }),
      ),
    );
    const done = targets.filter((_, i) => results[i].status === "fulfilled");
    setGone((set) => new Set([...set, ...done]));
    setOpened((list) => list.filter((id) => !done.includes(id)));
    // 하나라도 못 지웠으면 실패로 알린다(Sidebar가 창 안에 문구를 보임). 다시 누르면 남은 것만 지운다
    if (done.length < targets.length) throw new Error("일부 기록을 지우지 못했습니다");
    setDraft("");
    navigate("/");
    setToast("내 기록을 서버에서 지웠습니다.");
  }

  return (
    <AppStateContext.Provider
      value={{ draft, setDraft, programs, rememberSession, connected, recheckConnection, lostConnection }}
    >
      <div className={styles.app}>
        <Sidebar
          programs={Array.isArray(programs) ? programs : []}
          apiBase={window.location.origin}
          connected={connected}
          onReset={reset}
          confirmReset={draft !== "" || sessionId !== undefined}
          onDeleteRecords={targets.length === 0 ? undefined : deleteRecords}
        />
        <main className={styles.main}>
          <div className={styles.inner}>
            <AppHeader step={step} connected={connected} />
            {/* key가 단계라서 단계가 바뀔 때만 새로 그려지며 내려온다. 글자를 칠 때는 움직이지 않는다 */}
            <div key={step ?? "none"} className={styles.page}>
              <Outlet />
            </div>
          </div>
        </main>
        <Toast message={toast} onClose={() => setToast(null)} />
      </div>
    </AppStateContext.Provider>
  );
}
