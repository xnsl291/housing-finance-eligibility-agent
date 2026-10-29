// 개발 서버는 API 요청을 FastAPI로 넘긴다(D-37).
//
// 화면과 서버의 주소가 다르면 브라우저가 요청을 막고, 풀려면 서버가 CORS를 열어야 한다.
// 이 서버는 인증이 없어(127.0.0.1 전제) CORS를 열면 다른 웹사이트도 판정 서버를 부를 수
// 있게 된다. 그래서 개발 때는 여기서 넘기고, 완성본은 FastAPI가 화면 파일을 직접 낸다
// (`serve.py`). 어느 쪽이든 브라우저에는 주소가 하나다.
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

const api = process.env.HFA_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: { "/v1": api, "/health": api },
    // 테스트에서만 서버 쪽 화면 상수 파일(파이썬)을 글로 읽는다. 고지 문구가 저쪽과 같은지
    // 대조하려고(components/Feedback.test.tsx). 개인정보 안내 테스트(screens/Privacy.test.tsx)는 가리는 정규식(extraction.py)과
    // 가리는 자리(session.py)를 읽어 문구와 대조한다. 용어 도움말 테스트(screens/TermHelp.test.tsx)는 규칙 파일
    // field_guides.yaml을 읽어 설명 문구가 서버 정본과 같은지 본다(빼면 Denied ID로 읽지 못함 — 2026-10-22 확인).
    // 개발 서버는 web 밖 파일을 내주지 않게 그대로 둔다
    fs: process.env.VITEST
      ? { allow: [searchForWorkspaceRoot(process.cwd()), "../src/housing_finance_agent", "../rules"] }
      : undefined,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // vitest는 기본으로 CSS를 빈 글로 바꾼다(?raw 포함). 아래 파일은 테스트가 규칙 글을 읽어야 해서 그대로 둔다
    // - tokens.css: 색 대비(styles/tokens.test.ts)
    // - HeaderMenu.module.css: 좁은 화면에서 메뉴 버튼 글을 숨기지 않는지(screens/Layout.narrow.test.tsx)
    css: { include: [/tokens\.css/, /HeaderMenu\.module\.css/] },
  },
});
