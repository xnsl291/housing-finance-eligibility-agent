/*
 * 화면 주소. 세션 번호를 주소에 실어 새로 고쳐도 이어지게 한다(시안 S8).
 * 값과 답은 서버 세션에만 있고, 화면은 주소의 세션 번호로 다시 읽어 온다.
 *
 * 뼈대 단계라 화면은 아직 비어 있다. 화면별 PR에서 채운다.
 */
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

// 개발용 부품 모음. 개발 서버에서만 등록한다. 완성본에서는 import.meta.env.DEV가 false로
// 바뀌어 아래 import가 통째로 빠지므로 부품 모음 파일(ComponentGallery-*.js)이 만들어지지 않는다
const ComponentGallery = import.meta.env.DEV
  ? lazy(() => import("./screens/ComponentGallery").then((m) => ({ default: m.ComponentGallery })))
  : null;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<main>주거금융 지원가능성 판정</main>} />
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
      <Route path="*" element={<main>없는 화면입니다</main>} />
    </Routes>
  );
}
