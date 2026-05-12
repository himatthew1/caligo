// ─────────────────────────────────────────────────────────────────────────────
// 표식 발동 — 통합 애니메이션 모듈 (v2)
//   하늘에서 인두가 떨어져 셀의 *실제 표식 인디케이터 위치* (우측 상단) 에 박힘.
//   단일 연속 시퀀스: 낙하 → 임팩트 → 홀드 → 들어올림 (사라졌다 다시 안 나타남).
//
//   animateMarkBrand(positions, opts):
//     positions : [{ col, row }, ...]
//     opts:
//       boardId : 대상 보드 요소 id (기본 'game-board')
//       onSizzle : 인두가 박히는 순간 콜백 (사운드 트리거)
//       stagger : 다중 대상일 때 셀 간 간격 ms (기본 130)
//       simulateCellMark : preview 전용 — 임팩트 시점에 🎯 cell-mark 가 없으면 자동 생성
//
//   타임라인 (셀당, 총 1.8s):
//     0~450ms    : 인두 위 -260% → 표식 위치 까지 낙하
//     450ms      : 임팩트 — 셀 흔들림 + 불티/연기 + 사운드 + 인두 짧은 bounce
//     450~1080ms : 인두 표식 위치 holding (잠시 박혀 있음)
//     1080~1800ms: 인두 부드럽게 들어올려져 위로 사라짐 (rotation -10deg)
// ─────────────────────────────────────────────────────────────────────────────

function animateMarkBrand(positions, opts) {
  opts = opts || {};
  const boardId = opts.boardId || 'game-board';
  const stagger = (typeof opts.stagger === 'number') ? opts.stagger : 130;
  const board = document.getElementById(boardId);
  if (!board) return;
  const list = Array.isArray(positions) ? positions : [positions];
  list.forEach((pos, i) => {
    if (!pos || pos.col == null || pos.row == null) return;
    setTimeout(() => _animateSingleBrand(board, pos.col, pos.row, opts), i * stagger);
  });
}

function _animateSingleBrand(board, col, row, opts) {
  const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
  if (!cell) return;
  try { if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative'; } catch (e) {}

  // ★ 인두가 셀 밖까지 보이도록 overflow:visible 강제 — 애니메이션 종료 후 자동 해제.
  cell.classList.add('mark-brand-host');

  // ── 인두 본체 — 단일 연속 시퀀스 (markBrandSeq 1.8s, 슬램 강조) ──
  const iron = document.createElement('div');
  iron.className = 'mark-brand-iron';
  iron.innerHTML = `
    <div class="mark-brand-iron-handle"></div>
    <div class="mark-brand-iron-head"></div>
  `;
  cell.appendChild(iron);

  // 새 슬램 키프레임 — 임팩트는 15% (= 270ms) 에 발생.
  const IMPACT_MS = 270;
  setTimeout(() => {
    // 셀 흔들림 + 사운드 + 표식 이모지 붉은 글로우
    cell.classList.add('mark-brand-cell-shake');
    setTimeout(() => cell.classList.remove('mark-brand-cell-shake'), 420);
    if (typeof opts.onSizzle === 'function') {
      try { opts.onSizzle(); } catch (e) {}
    }
    // 표식 인디케이터 — preview 에서는 새로 생성 / 게임에서는 기존 cell-mark 사용
    let mk = cell.querySelector('.cell-mark');
    if (!mk && opts.simulateCellMark) {
      mk = document.createElement('span');
      mk.className = 'cell-mark mark-brand-spawned';
      mk.textContent = '🎯';
      cell.appendChild(mk);
    }
    if (mk) {
      mk.classList.remove('mark-brand-spawn-anim');
      void mk.offsetWidth;
      mk.classList.add('mark-brand-spawn-anim');
      setTimeout(() => mk.classList.remove('mark-brand-spawn-anim'), 1250);
    }

    // 불티 + 연기 — 표식 인디케이터 위치 (셀 우측 상단) 에서 발생.
    const rect = cell.getBoundingClientRect();
    const fx = rect.left + rect.width * 0.85;
    const fy = rect.top + rect.height * 0.16;

    // 연기 (회색 wisp 5개)
    for (let k = 0; k < 5; k++) {
      const sm = document.createElement('div');
      sm.className = 'mark-smoke-particle';
      sm.style.left = fx + 'px';
      sm.style.top = fy + 'px';
      const dx = (Math.random() - 0.5) * 22;
      const dur = 1.0 + Math.random() * 0.6;
      sm.style.setProperty('--dx', dx + 'px');
      sm.style.setProperty('--dur', dur + 's');
      sm.style.animationDelay = (Math.random() * 0.15) + 's';
      document.body.appendChild(sm);
      setTimeout(() => sm.remove(), (dur + 0.3) * 1000);
    }
    // 불티 (오렌지 작은 점 8개, 부채꼴)
    for (let k = 0; k < 8; k++) {
      const sp = document.createElement('div');
      sp.className = 'mark-spark-particle';
      sp.style.left = fx + 'px';
      sp.style.top = fy + 'px';
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const dist = 14 + Math.random() * 22;
      sp.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      sp.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      sp.style.setProperty('--dur', (0.5 + Math.random() * 0.4) + 's');
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 1200);
    }
  }, IMPACT_MS);

  // 시퀀스 종료 후 정리 (1.8s 단일 애니메이션 끝)
  setTimeout(() => {
    try { iron.remove(); } catch (e) {}
    cell.classList.remove('mark-brand-host');
  }, 1820);
}
