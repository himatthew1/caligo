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
  const marksArr = opts.marksArr || null;
  const turnNumber = (opts.turnNumber != null) ? opts.turnNumber : 0;
  const onLanded = opts.onLanded || null;

  // ★ GIF 기반 생성 애니메이션 — RAT_ANIM_CONFIG.spawn 위치에 1회 재생
  const rc = window.RAT_ANIM_CONFIG?.spawn;
  const rGifs = window.RAT_GIFS;
  const rColor = isMyRat ? 'black' : 'white';
  const spawnUrl = rGifs?.[rColor]?.spawn;
  const useGif = !!(rc && spawnUrl);

  rats.forEach((rat, i) => {
    setTimeout(() => {
      const targetCell = board.querySelector(`.cell[data-col="${rat.col}"][data-row="${rat.row}"]`);
      if (!targetCell) return;

      if (marksArr) marksArr.push({ col: rat.col, row: rat.row, turn: turnNumber, spawnT: Date.now() });
      targetCell.classList.add('rat-spawn-mark');
      targetCell.style.setProperty('--rat-fade-offset', '0s');

      if (useGif) {
        // ★ GIF 생성 애니메이션 — 셀 내부에 spawn GIF 오버레이
        const rx = isMyRat ? rc.x : -rc.x;
        const ry = rc.y; // Y 는 반전 없음 — 같은 수평선에서 마주봄
        const flip = isMyRat ? '' : ' scaleX(-1)';

        // ★ _gifBlobCache 우선 사용 (preloadAllAsync 에서 이미 캐싱)
        const _cachedBlob = window._gifBlobCache && window._gifBlobCache[spawnUrl];
        const _blobP = _cachedBlob
          ? Promise.resolve(_cachedBlob)
          : fetch(spawnUrl).then(r => r.blob());

        _blobP.then(blob => blob.arrayBuffer()).then(ab => {
          // NETSCAPE 블록 제거 → 1회 재생
          const src = new Uint8Array(ab);
          let patched = src;
          for (let i2 = 0; i2 < src.length - 18; i2++) {
            if (src[i2] === 0x21 && src[i2+1] === 0xFF && src[i2+2] === 0x0B) {
              const sig = String.fromCharCode(src[i2+3],src[i2+4],src[i2+5],src[i2+6],src[i2+7],src[i2+8],src[i2+9],src[i2+10],src[i2+11],src[i2+12],src[i2+13]);
              if (sig === 'NETSCAPE2.0') {
                patched = new Uint8Array(src.length - 19);
                patched.set(src.subarray(0, i2), 0);
                patched.set(src.subarray(i2 + 19), i2);
                break;
              }
            }
          }
          const blobUrl = URL.createObjectURL(new Blob([patched], { type: 'image/gif' }));
          const img = document.createElement('img');
          img.className = 'rat-spawn-gif rat-board-gif';
          img.style.cssText = `width:${rc.w}%;height:${rc.h}%;left:${50+rx}%;top:${50+ry}%;transform:translate(-50%,-50%)${flip};z-index:20`;
          img.src = blobUrl;

          const dur = (window._gifDurationCache && window._gifDurationCache[spawnUrl]) || 1170;
          // ★ Blob URL 즉시 DOM 추가 — decode() 지연 없이 프레임 0부터 렌더링.
          //   decode() 대기 중 브라우저 내부 GIF 타이머가 프레임을 소비하는 문제 원천 차단.
          targetCell.appendChild(img);
          setTimeout(() => {
            // ★ onLanded 를 먼저 호출 — renderGameBoard 가 idle GIF 를 그린 뒤
            //   spawn img 는 innerHTML 교체로 자동 제거됨. 순서가 반대면 1프레임 빈 갭 발생.
            if (onLanded) { try { onLanded(rat); } catch (e) {} }
            // renderGameBoard innerHTML 교체 후에도 혹시 남아있으면 정리
            if (img.parentNode) img.remove();
            URL.revokeObjectURL(blobUrl);
          }, dur + 100);
        }).catch(() => {
          // fetch/blob 실패 시 즉시 콜백
          if (onLanded) { try { onLanded(rat); } catch (e) {} }
        });
      } else {
        // ── 폴백: 기존 orb 애니메이션 ──
        const ratEmoji = isMyRat ? '🐀' : '🐁';
        const finalLeftOffset = isMyRat ? 7 : 2;
        const ratColor2 = isMyRat ? '#52b788' : '#e05252';
        const tRect = targetCell.getBoundingClientRect();
        const finalLeft = tRect.left + finalLeftOffset;
        const finalTop = tRect.top + 1;
        const fallDist = 220;
        const orb = document.createElement('div');
        orb.className = 'rat-fly-orb';
        orb.textContent = ratEmoji;
        orb.style.color = ratColor2;
        orb.style.left = finalLeft + 'px';
        orb.style.top = (finalTop - fallDist) + 'px';
        orb.style.setProperty('--fall', fallDist + 'px');
        document.body.appendChild(orb);

        let swapped = false;
        const finish = () => {
          if (swapped) return;
          swapped = true;
          if (onLanded) { try { onLanded(rat); } catch (e) {} }
          try { orb.remove(); } catch (e) {}
        };
        orb.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, 1100);
      }
    }, i * 130);
  });
}
