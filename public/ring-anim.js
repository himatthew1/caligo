// ─────────────────────────────────────────────────────────────────────────────
// 절대복종 반지 — 통합 애니메이션 모듈
//   게임 (game.js) 과 미리보기 (skill-board-anims-preview.html) 모두 본 파일을 로드.
//   미리보기 전용 재구현 X — 단일 소스로 동작 보장.
//   roleHint: 'caster' | 'victim' | 'observer'
//   opts.boardId: 대상 보드 요소 id (기본 'game-board'). 미리보기에서 다른 id 사용 가능.
// ─────────────────────────────────────────────────────────────────────────────

function animateRingTeleport(rt, roleHint, opts) {
  if (!rt) return;
  const boardId = (opts && opts.boardId) || 'game-board';
  const board = document.getElementById(boardId);
  if (!board) return;

  // ★ 보드 위 피해자 시각화 — 아이들 GIF 우선, 최종 폴백 이동 PNG → 아이콘 이미지
  const _victimVisualHtml = (() => {
    const type = rt.victimType;
    if (!type) return rt.victimIcon ? `<span style="font-size:1.3rem">${rt.victimIcon}</span>` : '';
    // 아이들 GIF (PIECE_GIFS)
    const idleUrl = window.PIECE_GIFS && window.PIECE_GIFS[type];
    if (idleUrl) {
      return `<img src="${idleUrl}" alt="" class="p-gif" style="width:38px;height:38px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 0 1px rgba(0,0,0,1)) drop-shadow(0 0 1px rgba(0,0,0,1));" draggable="false">`;
    }
    // 이동 PNG 폴백 (PIECE_MOVE_PNGS)
    const moveUrl = (typeof getPieceMoveUrl === 'function') ? getPieceMoveUrl(type) : null;
    if (moveUrl) {
      return `<img src="${moveUrl}" alt="" class="p-gif" style="width:38px;height:38px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 0 1px rgba(0,0,0,1)) drop-shadow(0 0 1px rgba(0,0,0,1));" draggable="false">`;
    }
    return '';
  })();
  const fromCell = board.querySelector(`.cell[data-col="${rt.fromCol}"][data-row="${rt.fromRow}"]`);
  const toCell = board.querySelector(`.cell[data-col="${rt.toCol}"][data-row="${rt.toRow}"]`);

  // ── 인트로 (1s): 도착 셀 오로라 색 3번 점멸 ──
  if (toCell) {
    toCell.classList.remove('aurora-intro');
    void toCell.offsetWidth;
    toCell.classList.add('aurora-intro');
    setTimeout(() => toCell.classList.remove('aurora-intro'), 1000);
  }

  // ── fromCell ghost: 모든 role 이 prevanish 인트로 (흰빛 + 살짝 떠오름) 를 봄.
  //    서버가 이미 piece 를 toCell 로 이동시킨 후 본 함수가 호출되므로 fromCell 에 marker 가 없음.
  //    victimIcon 으로 ghost 를 주입해 1s 동안 ring-prevanish 발현, 메인 단계에서 ring-vanish 후 제거.
  let fromGhost = null;
  if (fromCell && rt.victimIcon) {
    // 항상 ghost 를 생성 — 서버가 이미 victim 을 이동시킨 후이므로
    // fromCell 에 남아있는 .piece-marker 는 아군 유닛이다. 절대 건드리지 않는다.
    fromGhost = document.createElement('div');
    fromGhost.className = 'piece-marker ring-ghost';
    fromGhost.innerHTML = `<span class="p-icon">${_victimVisualHtml}</span>`;
    fromGhost.style.position = 'absolute';
    fromGhost.style.inset = '0';
    fromGhost.style.display = 'flex';
    fromGhost.style.flexDirection = 'column';
    fromGhost.style.alignItems = 'center';
    fromGhost.style.justifyContent = 'center';
    fromGhost.style.pointerEvents = 'none';
    fromGhost.style.zIndex = '20';
    try {
      if (getComputedStyle(fromCell).position === 'static') fromCell.style.position = 'relative';
    } catch (e) {}
    fromCell.appendChild(fromGhost);
    fromGhost.classList.remove('ring-prevanish');
    void fromGhost.offsetWidth;
    fromGhost.classList.add('ring-prevanish');
  }

  // ── toCell:
  //    'victim' 시점만 기존 marker (본인의 victim piece) 를 ring-arrived 대상으로 활용 →
  //    intro+vanish 동안 visibility:hidden, ring-arrived 시점에 노출 (두 마리 방지).
  //    'caster' / 'observer' 시점은 기존 marker 가 victim 이 아닐 수 있음 (아군/팀원/표식 적 등) →
  //    기존 marker 는 가만히 두고 (사용자 요청), 항상 victimIcon ghost 를 z-index 위에 띄움.
  let hiddenExistingMarker = null;
  let arrivalGhost = null;
  if (toCell && rt.victimIcon) {
    const existing = toCell.querySelector('.piece-marker');
    const isVictimRole = (roleHint === 'victim');
    if (isVictimRole && existing) {
      existing.style.visibility = 'hidden';
      hiddenExistingMarker = existing;
    } else {
      // caster / observer / victim-without-existing-marker 모두 ghost 생성.
      // 기존 marker (있다면) 는 hidden 처리 X — 그대로 정지 유지.
      arrivalGhost = document.createElement('div');
      arrivalGhost.className = 'piece-marker ring-arrival-ghost';
      arrivalGhost.innerHTML = `<span class="p-icon">${_victimVisualHtml}</span>`;
      arrivalGhost.style.visibility = 'hidden';
      arrivalGhost.style.position = 'absolute';
      arrivalGhost.style.inset = '0';
      arrivalGhost.style.display = 'flex';
      arrivalGhost.style.flexDirection = 'column';
      arrivalGhost.style.alignItems = 'center';
      arrivalGhost.style.justifyContent = 'center';
      arrivalGhost.style.zIndex = '20';
      arrivalGhost.style.pointerEvents = 'none';
      try {
        if (getComputedStyle(toCell).position === 'static') toCell.style.position = 'relative';
      } catch (e) {}
      toCell.appendChild(arrivalGhost);
    }
  }

  // 1초 후 본 애니 시작
  setTimeout(() => _animateRingMain(rt, roleHint, board, fromCell, toCell, fromGhost, arrivalGhost, hiddenExistingMarker), 1000);
}

function _animateRingMain(rt, roleHint, board, fromCell, toCell, fromGhost, arrivalGhost, hiddenExistingMarker) {
  // 1. 오로라 펄스 — aurora-target 으로 시작, 1.5s 후 aurora-fade 로 swap (펄스 정지 + alpha 페이드).
  //    셀 자체와 자식 (마커/토큰/설치물) 은 페이드 영향 받지 않음.
  if (toCell) {
    toCell.classList.remove('aurora-target', 'aurora-fade');
    void toCell.offsetWidth;
    toCell.classList.add('aurora-target');
    setTimeout(() => {
      toCell.classList.remove('aurora-target');
      toCell.classList.add('aurora-fade');
    }, 1500);
    setTimeout(() => toCell.classList.remove('aurora-fade'), 2900);
  }

  // 2. fromCell ghost (또는 기존 marker) vanish — 모든 role 공유.
  if (fromCell) {
    const fromMarker = (fromGhost && fromGhost.isConnected) ? fromGhost : fromCell.querySelector('.piece-marker');
    if (fromMarker) {
      fromMarker.classList.add('ring-vanish');
      if (fromGhost) setTimeout(() => { try { fromGhost.remove(); } catch (e) {} }, 400);
    }
  }

  // 3. 도착 — vanish 종료 (320ms) 후 등장.
  const ARRIVE_DELAY = 320;
  const POOF_OFFSET = 700;
  setTimeout(() => {
    const toCellNow = board.querySelector(`.cell[data-col="${rt.toCol}"][data-row="${rt.toRow}"]`);
    if (!toCellNow) return;
    // arrivedMarker 우선순위: 기존 marker (visibility 만 hidden 처리됨) → arrivalGhost.
    const arrivedMarker = (hiddenExistingMarker && hiddenExistingMarker.isConnected)
      ? hiddenExistingMarker
      : ((arrivalGhost && arrivalGhost.isConnected) ? arrivalGhost : null);
    if (arrivedMarker) {
      arrivedMarker.style.visibility = '';     // 노출 + ring-arrived 시작
      arrivedMarker.classList.add('ring-arrived');
      setTimeout(() => {
        arrivedMarker.classList.remove('ring-arrived');
        // arrivalGhost (시전자 fog-of-war 케이스) 만 페이드 아웃 후 제거.
        // hiddenExistingMarker (피해자/관전자 시점 본인/실제 marker) 는 그대로 유지 (페이드 X).
        if (arrivalGhost && arrivalGhost.isConnected && arrivedMarker === arrivalGhost) {
          arrivalGhost.classList.add('ring-fade-out');
          setTimeout(() => { try { arrivalGhost.remove(); } catch (e) {} }, 800);
        }
      }, 1000);
    }
    // 빛 입자 — "뿅" 해제 시점에 사방으로 발사.
    setTimeout(() => {
      const rect = toCellNow.getBoundingClientRect();
      const colors = ['rgba(165, 243, 252, 0.95)', 'rgba(217, 70, 239, 0.9)', 'rgba(250, 204, 21, 0.9)'];
      const BURST_COUNT = 16;
      for (let i = 0; i < BURST_COUNT; i++) {
        const p = document.createElement('div');
        p.className = 'aurora-emit-particle';
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        const angle = (Math.PI * 2 * i / BURST_COUNT) + (Math.random() - 0.5) * 0.4;
        const dist = 38 + Math.random() * 30;
        p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
        p.style.setProperty('--aurora-color', colors[i % colors.length]);
        p.style.setProperty('--dur', (0.9 + Math.random() * 0.5) + 's');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1500);
      }
    }, POOF_OFFSET);
  }, ARRIVE_DELAY);
}
