/*
 * 화면 주소. 세션 번호를 주소에 실어 새로 고쳐도 이어지게 한다(시안 S8).
 * 값과 답은 서버 세션에만 있고, 화면은 주소의 세션 번호로 다시 읽어 온다.
 *
 * 뼈대 단계라 화면은 아직 비어 있다. 화면별 PR에서 채운다.
 */
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

// 개발용 부품 모음. 사용자 화면 묶음에 섞이지 않게 따로 불러온다
const ComponentGallery = lazy(() =>
  import("./screens/ComponentGallery").then((m) => ({ default: m.ComponentGallery })),
);

export function App() {
  return (
    <Routes>
      <Route path="/" element={<main>주거금융 지원가능성 판정</main>} />
      <Route
        path="/_components"
        element={
          <Suspense>
            <ComponentGallery />
          </Suspense>
        }
      />
      <Route path="*" element={<main>없는 화면입니다</main>} />
    </Routes>
  );
}
