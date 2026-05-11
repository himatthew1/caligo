// ─────────────────────────────────────────────────────────────────────────────
// 약초학 시전 — 통합 애니메이션 모듈
//   게임 (game.js) 과 미리보기 (skill-board-anims-preview.html) 모두 본 파일을 로드.
//   미리보기 전용 재구현 X — 단일 소스로 동작 보장.
//
//   animateHerbCast(centerCol, centerRow, opts):
//     centerCol / centerRow : 약초전문가 본인 위치 (시계방향 reveal 의 중심)
//     opts:
//       boardId : 대상 보드 요소 id (기본 'game-board')
//
//   동작: 시계방향 8칸 (N → NE → E → SE → S → SW → W → NW) 에 STEP_MS=55ms 간격으로
//         herb-cast-cell 클래스 부여 + 셀 전체에 랜덤 분포된 반짝이/꽃 파티클 3개씩 주입.
// ─────────────────────────────────────────────────────────────────────────────

function animateHerbCast(centerCol, centerRow, opts) {
  opts = opts || {};
  const boardId = opts.boardId || 'game-board';
  const board = document.getElementById(boardId);
  if (!board) return;
  // 시계방향 순서: 위(N) → 우상(NE) → 우(E) → 우하(SE) → 아래(S) → 좌하(SW) → 좌(W) → 좌상(NW)
  const clockwise = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]
  ];
  const STEP_MS = 55;     // 휘리릭 — 타이트한 간격
  const HOLD_MS = 1100;   // 셀 발광 유지 시간
  const leafChars = ['✨', '🌸', '✨', '🌸', '✨', '⭐', '🌸', '✨'];   // 벚꽃 + 반짝이
  clockwise.forEach(([dc, dr], i) => {
    setTimeout(() => {
      const c = centerCol + dc, r = centerRow + dr;
      const cell = board.querySelector(`.cell[data-col="${c}"][data-row="${r}"]`);
      if (!cell) return;
      cell.classList.remove('herb-cast-cell');
      void cell.offsetWidth;
      cell.classList.add('herb-cast-cell');
      setTimeout(() => cell.classList.remove('herb-cast-cell'), HOLD_MS);
      // 반짝이/데이지 파티클 — 셀당 3개. 셀 전체 (0.08~0.92) 랜덤 분포.
      const rect = cell.getBoundingClientRect();
      for (let k = 0; k < 3; k++) {
        const p = document.createElement('div');
        p.className = 'herb-leaf-particle';
        p.textContent = leafChars[(i + k) % leafChars.length];
        const sx = rect.left + rect.width  * (0.08 + Math.random() * 0.84);
        const sy = rect.top  + rect.height * (0.08 + Math.random() * 0.84);
        p.style.left = sx + 'px';
        p.style.top = sy + 'px';
        const dx = (Math.random() - 0.5) * 32;
        const rot = (Math.random() - 0.5) * 540;
        p.style.setProperty('--dx', dx + 'px');
        p.style.setProperty('--rot', rot + 'deg');
        p.style.setProperty('--rot1', ((Math.random() - 0.5) * 60) + 'deg');
        p.style.animationDelay = (Math.random() * 0.15) + 's';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1500);
      }
    }, i * STEP_MS);
  });
}
