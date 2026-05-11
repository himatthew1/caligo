// ─────────────────────────────────────────────────────────────────────────────
// 쥐 소환 — 통합 애니메이션 모듈
//   게임 (game.js) 과 미리보기 (skill-board-anims-preview.html) 모두 본 파일을 로드.
//   미리보기 전용 재구현 X — 단일 소스로 동작 보장.
//
//   animateRatSpawn(rats, owner, opts):
//     rats   : [{ col, row }, ...] — 소환될 쥐 좌표 배열
//     owner  : 시전자 player idx (0 또는 1, AI 는 1)
//     opts   :
//       boardId      : 대상 보드 요소 id (기본 'game-board')
//       viewerIdx    : 시점 (본인 쥐 vs 적 쥐 분기 기준). 기본 0
//       marksArr     : (선택) 외부 spawnT 누적 배열 — 게임은 S._ratSpawnMarks 전달해서
//                       renderGameBoard 재렌더 후에도 페이드 위치 동기화. 미리보기는 생략.
//       turnNumber   : (선택) 마크에 기록할 턴 번호. 기본 0
//       onLanded(rat): (선택) orb 착지 시점 콜백 — 게임은 _ratIncoming 제거 + renderGameBoard.
//                       미리보기는 생략 (orb 가 자동 제거됨).
// ─────────────────────────────────────────────────────────────────────────────

function animateRatSpawn(rats, owner, opts) {
  if (!Array.isArray(rats) || rats.length === 0) return;
  opts = opts || {};
  const boardId = opts.boardId || 'game-board';
  const board = document.getElementById(boardId);
  if (!board) return;
  const viewerIdx = (opts.viewerIdx != null) ? opts.viewerIdx : 0;
  const isMyRat = owner === viewerIdx;
  const ratEmoji = isMyRat ? '🐀' : '🐁';
  const finalLeftOffset = isMyRat ? 7 : 2;
  const ratColor = isMyRat ? '#52b788' : '#e05252';
  const marksArr = opts.marksArr || null;
  const turnNumber = (opts.turnNumber != null) ? opts.turnNumber : 0;
  const onLanded = opts.onLanded || null;

  rats.forEach((rat, i) => {
    setTimeout(() => {
      const targetCell = board.querySelector(`.cell[data-col="${rat.col}"][data-row="${rat.row}"]`);
      if (!targetCell) return;
      // 보라 셀 표시 + spawnT 기록 — 즉시 적용 (소환 트리거 시점). 셀 페이드 3s 가 정확히 작동.
      if (marksArr) marksArr.push({ col: rat.col, row: rat.row, turn: turnNumber, spawnT: Date.now() });
      targetCell.classList.add('rat-spawn-mark');
      targetCell.style.setProperty('--rat-fade-offset', '0s');

      const tRect = targetCell.getBoundingClientRect();
      const finalLeft = tRect.left + finalLeftOffset;
      const finalTop = tRect.top + 1;
      const fallDist = 220;
      const orb = document.createElement('div');
      orb.className = 'rat-fly-orb';
      orb.textContent = ratEmoji;
      orb.style.color = ratColor;
      orb.style.left = finalLeft + 'px';
      orb.style.top = (finalTop - fallDist) + 'px';
      orb.style.setProperty('--fall', fallDist + 'px');
      document.body.appendChild(orb);

      // animationend 또는 1100ms 후 — onLanded 콜백 + orb 제거.
      let swapped = false;
      const finish = () => {
        if (swapped) return;
        swapped = true;
        if (onLanded) { try { onLanded(rat); } catch (e) {} }
        try { orb.remove(); } catch (e) {}
      };
      orb.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 1100);
    }, i * 130);
  });
}
