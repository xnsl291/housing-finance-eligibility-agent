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
    // 대조하려고(components/Feedback.test.tsx). 개발 서버는 web 밖 파일을 내주지 않게 그대로 둔다
    fs: process.env.VITEST
      ? { allow: [searchForWorkspaceRoot(process.cwd()), "../src/housing_finance_agent/ui"] }
      : undefined,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
