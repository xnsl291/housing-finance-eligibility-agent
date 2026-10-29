/*
 * 선 아이콘 한 벌. 시안은 lucide 모양을 썼지만 의존성을 늘리지 않으려고 쓰는 것만 직접 그림.
 *
 * 아이콘은 늘 글자 옆에 붙는 꾸밈이라 화면 읽기 프로그램에는 숨김(aria-hidden).
 * 뜻은 옆 글자가 전함(설계서 11.1 — 아이콘만으로 뜻을 전하지 않음).
 */
const PATHS = {
  check: <path d="M20 6 9 17l-5-5" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowLeft: <path d="M19 12H5m7 7-7-7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  quote: (
    <path d="M4 7h5v5c0 3-2 5-4 5M14 7h5v5c0 3-2 5-4 5" />
  ),
  eraser: (
    <>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21Z" />
      <path d="M22 21H7M5 11l9 9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  pause: <path d="M8 4h2v16H8zM14 4h2v16h-2z" />,
  externalLink: <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  serverOff: (
    <>
      <path d="M7 2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5M2 6a4 4 0 0 1 2-3.5M2 14a2 2 0 0 1 2-2h8M20 12a2 2 0 0 1 2 2v4" />
      <path d="M6 6h.01M6 18h.01M2 2l20 20" />
    </>
  ),
  loader: <path d="M21 12a9 9 0 1 1-6.2-8.6" />,
  cornerDownLeft: <path d="M20 4v7a4 4 0 0 1-4 4H4m5-5-5 5 5 5" />,
  minus: <path d="M5 12h14" />,
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  listChecks: <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8" />,
  fileX: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5m-9.5 4.5 5 5m0-5-5 5" />
    </>
  ),
  timer: (
    <>
      <path d="M10 2h4M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
  // 좁은 화면 머리 메뉴(시안 폭 900·390 '메뉴 버튼', C-MENU 닫기)
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  // S8 이어서 하기 배너, S7 다시 판정함 안내(시안 S8·S4-k)
  rotateCcw: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
