/*
 * '처음부터 다시' 글자 버튼과 확인 창(설계서 M1, 시안 S3-M1·S4-M1). S3와 S4가 같이 쓴다 — 시안 S4-M1 메모처럼
 * 자리마다 다른 창을 만들면 사용자가 매번 새로 읽어야 한다.
 *
 * - 지울 것이 있을 때만(dirty) 창을 띄운다. 없으면 바로 S1로
 * - S8 이어서 하기 배너의 '새로 시작'도 같은 창을 쓴다(label·variant만 다름). 하는 일이 같은데 창이 다르면 다른 일로 읽힌다
 * - 떠나면 주소에서 이 세션이 빠진다. 새로 고친 뒤라 이 탭의 연 세션 목록에 없으면 '내 기록 지우기'가 더는
 *   이 세션을 못 지우므로, 떠나기 전에 목록에 넣는다(창이 "'내 기록 지우기'로 지울 수 있습니다"라고 약속함)
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAppState } from "./AppState";

interface StartOverProps {
  sessionId: string;
  dirty: boolean;
  /** 버튼 글. 기본은 맨 아래 글자 버튼 '처음부터 다시', S8 배너는 보조 버튼 '새로 시작' */
  label?: string;
  variant?: "text" | "secondary";
}

export function StartOver({ sessionId, dirty, label = "처음부터 다시", variant = "text" }: StartOverProps) {
  const navigate = useNavigate();
  const { draft, rememberSession } = useAppState();
  const [ask, setAsk] = useState(false);
  function backToWrite() {
    rememberSession(sessionId);
    navigate("/write");
  }
  return (
    <>
      <Button
        variant={variant}
        icon={variant === "text" ? "arrowLeft" : undefined}
        onClick={() => (dirty ? setAsk(true) : backToWrite())}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={ask}
        title="처음부터 다시 할까요?"
        confirmLabel="처음부터"
        cancelLabel="계속하기"
        onConfirm={() => {
          setAsk(false);
          backToWrite();
        }}
        onCancel={() => setAsk(false)}
      >
        {/* 설계서 M1의 옛 문구 "사라집니다"는 쓰지 않는다. 이 버튼은 화면만 S1로 옮기고 서버 세션은 지우지 않으므로
            사실과 다른 약속이 된다(G12). 사이드바 전체 초기화 창(RESET_NOTE "서버에 남은 기록은 지워지지 않습니다")과
            같은 말을 쓰고, 지우는 길(내 기록 지우기 — backToWrite가 지킴)을 덧붙인다. 적은 문장은 앱 메모리에 있어
            S1 칸에 그대로 남는다. 직접 입력으로 시작했거나 새로 고친 뒤라 문장이 없으면 '남습니다'를 말하지 않는다 */}
        처음부터 다시 시작합니다. 지금까지 고치고 답한 값은 새 판정에 쓰지 않습니다. 서버에 남은 기록은 지워지지
        않으며, ‘내 기록 지우기’로 지울 수 있습니다.
        {draft.trim() !== "" && " 적어 두신 문장은 남습니다."}
      </ConfirmDialog>
    </>
  );
}
