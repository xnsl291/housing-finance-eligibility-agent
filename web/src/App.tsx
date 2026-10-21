/*
 * 화면 주소. 세션 번호를 주소에 실어 새로 고쳐도 이어지게 한다(시안 S8, 설계서 13절 Q3).
 * 값과 답은 서버 세션에만 있고, 화면은 주소의 세션 번호로 다시 읽어 온다.
 *
 * /                      S0 첫 화면
 * /write                 S1 조건 입력
 * /s/:sessionId/confirm   S2 읽은 내용 확인
 * /s/:sessionId/questions S3 하나씩 확인 (직접 입력으로 시작하면 S2를 건너뛰고 여기로 — Q8)
 * /s/:sessionId/result    S4 판정 결과
 *
 * S3·S4는 아직 자리표시다(Pending). 화면별 PR에서 채운다.
 */
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

import { Confirm } from "./screens/Confirm";
import { Layout } from "./screens/Layout";
import { Pending } from "./screens/Pending";
import { Start } from "./screens/Start";
import { Write } from "./screens/Write";

// 개발용 부품 모음. 개발 서버에서만 등록한다. 완성본에서는 import.meta.env.DEV가 false로
// 바뀌어 아래 import가 통째로 빠지므로 부품 모음 파일(ComponentGallery-*.js)이 만들어지지 않는다
const ComponentGallery = import.meta.env.DEV
  ? lazy(() => import("./screens/ComponentGallery").then((m) => ({ default: m.ComponentGallery })))
  : null;

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Start />} />
        <Route path="/write" element={<Write />} />
        <Route path="/s/:sessionId/confirm" element={<Confirm />} />
        <Route path="/s/:sessionId/questions" element={<Pending step={2} />} />
        <Route path="/s/:sessionId/result" element={<Pending step={3} />} />
        <Route path="*" element={<h1>없는 화면입니다</h1>} />
      </Route>
      {ComponentGallery && (
        <Route
          path="/_components"
          element={
            <Suspense>
              <ComponentGallery />
            </Suspense>
          }
        />
      )}
    </Routes>
  );
}
