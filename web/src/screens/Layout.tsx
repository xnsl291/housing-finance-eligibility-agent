/*
 * 모든 화면이 공유하는 틀. 사이드바 + 본문(머리 영역 + 화면). 설계서 4절 C-HEADER·C-SIDE, 시안 S0·S1.
 *
 * 여기서 하는 일
 * - 앱 메모리(적은 문장, 상품 목록)를 갖고 아래 화면에 나눠 준다(AppState.tsx)
 * - 서버 연결 상태를 본다. 처음 열 때와 주소가 바뀔 때마다(설계서 E1 "화면을 다시 그릴 때마다")
 * - 단계는 주소로 정한다(routes.ts). 단계가 바뀐 순간에만 본문이 위에서 내려온다(C-HEADER, 420ms)
 * - 주소가 바뀌면 초점을 새 화면 제목(h1)으로 옮긴다(시안 C0 1절). 화면 읽기 프로그램 사용자가
 *   화면이 바뀐 것을 알게 하려고
 * - 전체 초기화(앱 메모리만 비움)와 내 기록 지우기(서버 세션 삭제)
 */
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";

import { api } from "../api/client";
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

  async function deleteRecords(id: string) {
    await api.deleteSession(id);
    setDraft("");
    navigate("/");
    setToast("내 기록을 서버에서 지웠습니다.");
  }

  return (
    <AppStateContext.Provider value={{ draft, setDraft, programs }}>
      <div className={styles.app}>
        <Sidebar
          programs={Array.isArray(programs) ? programs : []}
          apiBase={window.location.origin}
          connected={connected}
          onReset={reset}
          confirmReset={draft !== "" || sessionId !== undefined}
          onDeleteRecords={sessionId === undefined ? undefined : () => deleteRecords(sessionId)}
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
