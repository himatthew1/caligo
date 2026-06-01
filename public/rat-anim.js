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
          // ★ 고유 GIF Comment Extension 삽입 — Chrome 의 동일 바이너리 GIF 타이머 공유 차단.
          //   동일 데이터 GIF 를 여러 개 DOM 에 추가하면 Chrome 이 애니 타이머를 공유하여
          //   뒤에 추가된 GIF 가 이미 진행된 프레임부터 시작 → 앞부분 프레임 누락.
          //   GCT 뒤에 고유 comment 블록(8바이트)을 삽입하면 바이너리가 달라져 독립 재생.
          if (!window._ratGifUid) window._ratGifUid = 0;
          const _uid = ++window._ratGifUid;
          const _commentBlock = new Uint8Array([0x21, 0xFE, 4,
            (_uid >>> 24) & 0xFF, (_uid >>> 16) & 0xFF, (_uid >>> 8) & 0xFF, _uid & 0xFF, 0x00]);
          const _packed = patched[10];
          const _hasGct = (_packed >> 7) & 1;
          const _gctBytes = _hasGct ? 3 * (1 << ((_packed & 7) + 1)) : 0;
          const _insertAt = 13 + _gctBytes; // 6(header) + 7(LSD) + GCT
          const _final = new Uint8Array(patched.length + _commentBlock.length);
          _final.set(patched.subarray(0, _insertAt), 0);
          _final.set(_commentBlock, _insertAt);
          _final.set(patched.subarray(_insertAt), _insertAt + _commentBlock.length);
          const blobUrl = URL.createObjectURL(new Blob([_final], { type: 'image/gif' }));
          const img = document.createElement('img');
          img.className = 'rat-spawn-gif rat-board-gif';
          img.style.cssText = `width:${rc.w}%;height:${rc.h}%;left:${50+rx}%;top:${50+ry}%;transform:translate(-50%,-50%)${flip};z-index:20`;
          img.src = blobUrl;

          const dur = (window._gifDurationCache && window._gifDurationCache[spawnUrl]) || 1170;
          // ★ Blob URL 즉시 DOM 추가 — decode() 지연 없이 프레임 0부터 렌더링.
          targetCell.appendChild(img);

          // ★ spawn → idle 무 공백 전환 (in-cell 직접 교체):
          //   renderGameBoard 를 호출하면 셀 innerHTML 재구축 → 어떤 브릿지를 써도 깜빡임 발생.
          //   해결: idle GIF 를 spawn 종료 전에 셀 안에 미리 배치 (spawn 뒤, 낮은 z-index).
          //         spawn 재생 끝 → spawn 제거 → idle 이 이미 그 자리에 있으므로 빈 프레임 0.
          //         onLanded 는 skipRender:true 로 호출 → renderGameBoard 미호출.
          //         다음 이벤트(턴변경 등)에서 renderGameBoard 가 자연스럽게 셀 재구축.

          const _idleConf = window.RAT_ANIM_CONFIG?.idle;
          const _idleUrl = rGifs?.[rColor]?.idle;

          // ★ spawn ↔ idle 겹침 제거 (사용자 보고: 소환모션과 idle 이 겹쳐 불안정):
          //   이전엔 idle 을 spawn 뒤(z-index 낮게) 300ms 먼저 배치 → 크기·위치가 달라
          //   spawn 뒤로 idle 이 삐져나와 "겹치는 지점" 발생.
          //   해결: idle 을 opacity:0 으로 미리 배치(로드·디코드만) → spawn 제거와 동시에
          //         opacity:1 노출. 겹침 구간 0 + 빈 프레임 0.
          let _idleEl = null;
          if (_idleUrl && _idleConf) {
            const _preloadAt = Math.max(100, dur - 300);
            setTimeout(() => {
              const _cell = board.querySelector(`.cell[data-col="${rat.col}"][data-row="${rat.row}"]`);
              if (!_cell) return;
              const _idleRx = isMyRat ? _idleConf.x : -_idleConf.x;
              const _idleFlip = isMyRat ? '' : ' scaleX(-1)';
              const _idleZ = isMyRat ? 4 : 3;
              const _idle = document.createElement('img');
              _idle.className = 'rat-board-gif';
              // opacity:0 — 로드/디코드만 시키고 보이지 않게 (spawn 과 겹치지 않음)
              _idle.style.cssText = `width:${_idleConf.w}%;height:${_idleConf.h}%;left:${50+_idleRx}%;top:${50+_idleConf.y}%;transform:translate(-50%,-50%)${_idleFlip};z-index:${_idleZ};opacity:0`;
              _idle.src = _idleUrl;
              _cell.appendChild(_idle);
              _idleEl = _idle;
            }, _preloadAt);
          }

          // spawn 재생 완료 → spawn 제거 + idle 동시 노출 (겹침 없이 매끄럽게 전환)
          setTimeout(() => {
            if (_idleEl) _idleEl.style.opacity = '1';  // spawn 제거와 같은 프레임에 노출
            if (img.parentNode) img.remove();
            URL.revokeObjectURL(blobUrl);
            // ★ skipRender:true → renderGameBoard 미호출. idle GIF 는 이미 셀에 존재.
            if (onLanded) { try { onLanded(rat, { skipRender: true }); } catch (e) {} }
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
