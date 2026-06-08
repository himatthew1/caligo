// ─────────────────────────────────────────────────────────────────────────────
// 유해 단계별 피격 애니메이션 — 통합 모듈
//   게임(game.js)과 프리뷰(remains-hit-preview.html)가 본 파일을 함께 로드 → 단일 소스.
//
//   유해는 공격당할 때마다 단계가 오른다 (서버가 hits 카운트):
//     stage 1 (hits 0) : 공통 유해            (remains.png)
//     stage 2 (hits 1) : 1타                  (remains_hit1.png)
//     stage 3 (hits 2) : 2타                  (remains_hit2.png)
//     (3타 → 제거 — 칸 해제)
//
//   피격 순간 연출 (깜빡임 없이 정착):
//     1타 → remains_hit1.gif 1회 재생 → remains_hit1.png 로 정착
//     2타 → remains_hit2.gif 1회 재생 → remains_hit2.png 로 정착
//     3타 → remains_hit3.gif 1회 재생 → 유해 제거
//
//   animateRemainsHit(board, col, row, opts):
//     board     : 보드 요소 (document.getElementById('game-board') 등)
//     col, row  : 유해 좌표
//     opts:
//       hitNumber  : 이번이 몇 번째 피격인지 (1·2·3). 필수.
//       facingLeft : (선택) 유해가 좌향이면 true → scaleX(-1)
//       onSettle   : (선택) 정착(또는 제거) 완료 콜백
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  // ── 단일 재생 GIF 바이트 패치 (NETSCAPE 루프 블록 제거 + 고유 comment 삽입) ──
  //   rat-anim.js / playDeathAnimations 와 동일한 검증된 기법:
  //     · NETSCAPE2.0(19바이트) 제거 → 무한루프 → 1회 재생
  //     · 고유 GIF Comment Extension 삽입 → Chrome 의 동일 바이너리 타이머 공유 차단
  function _patchOneShot(ab) {
    const src = new Uint8Array(ab);
    let patched = src;
    for (let i = 0; i < src.length - 18; i++) {
      if (src[i] === 0x21 && src[i + 1] === 0xFF && src[i + 2] === 0x0B) {
        const sig = String.fromCharCode(
          src[i + 3], src[i + 4], src[i + 5], src[i + 6], src[i + 7], src[i + 8],
          src[i + 9], src[i + 10], src[i + 11], src[i + 12], src[i + 13]);
        if (sig === 'NETSCAPE2.0') {
          patched = new Uint8Array(src.length - 19);
          patched.set(src.subarray(0, i), 0);
          patched.set(src.subarray(i + 19), i);
          break;
        }
      }
    }
    if (!window._remainsGifUid) window._remainsGifUid = 0;
    const uid = ++window._remainsGifUid;
    const comment = new Uint8Array([0x21, 0xFE, 4,
      (uid >>> 24) & 0xFF, (uid >>> 16) & 0xFF, (uid >>> 8) & 0xFF, uid & 0xFF, 0x00]);
    const packed = patched[10];
    const hasGct = (packed >> 7) & 1;
    const gctBytes = hasGct ? 3 * (1 << ((packed & 7) + 1)) : 0;
    const insertAt = 13 + gctBytes; // 6(header) + 7(LSD) + GCT
    const out = new Uint8Array(patched.length + comment.length);
    out.set(patched.subarray(0, insertAt), 0);
    out.set(comment, insertAt);
    out.set(patched.subarray(insertAt), insertAt + comment.length);
    return out;
  }

  function _oneShotBlobUrl(url) {
    const cached = window._gifBlobCache && window._gifBlobCache[url];
    const blobP = cached ? Promise.resolve(cached) : fetch(url).then(r => r.blob());
    return blobP
      .then(blob => blob.arrayBuffer())
      .then(ab => URL.createObjectURL(new Blob([_patchOneShot(ab)], { type: 'image/gif' })));
  }

  function _facingTransform(facingLeft) {
    return facingLeft ? 'translate(-50%,-50%) scaleX(-1)' : '';
  }

  // 셀 안의 정적 유해 마커(<img.remains-marker>)를 보장 — 없으면 지정 stage 로 생성.
  function _ensureStatic(cell, stage, facingLeft) {
    let st = cell.querySelector('img.remains-marker');
    const imgs = window.REMAINS_STAGE_IMGS || {};
    if (!st) {
      st = document.createElement('img');
      st.className = 'remains-marker';
      st.alt = '';
      cell.appendChild(st);
    }
    st.src = imgs[stage] || window.REMAINS_IMG || '/art/remains.png';
    st.dataset.stage = String(stage);
    if (facingLeft) st.style.transform = _facingTransform(true);
    return st;
  }

  // ── 메인 ──
  window.animateRemainsHit = function (board, col, row, opts) {
    opts = opts || {};
    const hitNumber = opts.hitNumber;            // 1·2·3
    const facingLeft = !!opts.facingLeft;
    const onSettle = opts.onSettle || null;
    if (!board || !(hitNumber >= 1 && hitNumber <= 3)) { if (onSettle) onSettle(); return; }

    const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
    if (!cell) { if (onSettle) onSettle(); return; }

    const hitGifs = window.REMAINS_HIT_GIFS || {};
    const stageImgs = window.REMAINS_STAGE_IMGS || {};
    const gifUrl = hitGifs[hitNumber];
    const resultStage = hitNumber + 1;           // 2·3·4
    const destroyed = resultStage >= 4;
    const resultPng = destroyed ? null : stageImgs[resultStage];

    // ── ★ 캐러셀 셀 — 유해는 슬롯(.cc-remains). 셀에 풀사이즈 오버레이를 그리면 캐러셀 위에 겹침.
    //   보이는 슬롯이 유해면 그 슬롯 이미지를 hit GIF 로 스왑(슬롯 크기·위치 그대로), 아니면 단계만 갱신. ──
    const _ccWrap = cell.querySelector('.cc-wrapper');
    if (_ccWrap) {
      const _remSlot = _ccWrap.querySelector('.cc-main[data-owner="remains"]');
      const _remImg = _remSlot && _remSlot.querySelector('img.cc-remains');
      const _visible = _remSlot && !_remSlot.classList.contains('cc-hidden');
      if (!gifUrl || !_remImg || !_visible) { if (onSettle) onSettle(); return; }
      const _gd = (window._gifDurationCache && window._gifDurationCache[gifUrl]) || 650;
      const _prevSrc = _remImg.src;
      if (facingLeft) _remImg.style.transform = _facingTransform(true);
      _oneShotBlobUrl(gifUrl).then(blobUrl => {
        _remImg.src = blobUrl;
        setTimeout(() => {
          if (!destroyed) _remImg.src = _prevSrc;   // 파괴면 재렌더가 슬롯 제거
          if (onSettle) onSettle();
          URL.revokeObjectURL(blobUrl);
        }, _gd + 80);
      }).catch(() => { if (onSettle) onSettle(); });
      return;
    }

    cell.classList.add('has-remains');           // 사이즈/overflow 정책 (style.css) 동일 적용

    // 피격 전 단계의 정적 유해를 보장 (없으면 생성)
    const preStage = hitNumber;                  // 피격 직전 stage = hitNumber (hits = hitNumber-1)
    const staticEl = _ensureStatic(cell, preStage, facingLeft);

    const gifDur = (window._gifDurationCache && window._gifDurationCache[gifUrl]) || 650;

    // 정착(또는 제거) — GIF 종료 시점에 호출. 정적 PNG 노출/제거를 책임진다.
    const settle = () => {
      if (destroyed) {
        if (staticEl && staticEl.parentNode) staticEl.remove();
        cell.classList.remove('has-remains');
        if (cell._remainsStage !== undefined) delete cell._remainsStage;
      } else {
        if (resultPng) staticEl.src = resultPng;   // 결과 단계 PNG (프리로드됨 → 즉시)
        staticEl.style.opacity = '1';              // 숨김 해제
        staticEl.dataset.stage = String(resultStage);
      }
      if (onSettle) onSettle();
    };

    if (!gifUrl) { settle(); return; }           // GIF 누락 폴백 — 즉시 정착

    _oneShotBlobUrl(gifUrl).then(blobUrl => {
      // ★ 겹침 0 보장: GIF 재생 동안 뒤의 정적 PNG 를 완전히 숨긴다.
      //   (GIF 스프라이트의 투명 영역으로 뒤의 PNG 가 비치는 것까지 차단 — 단 한 프레임도 겹치지 않음)
      //   같은 동기 tick 안에서 [정적 숨김]+[GIF 추가] 처리 → 그 사이 paint 없음.
      staticEl.style.opacity = '0';
      if (!destroyed && resultPng) staticEl.src = resultPng;  // 숨긴 채 결과 PNG 미리 적재(디코드)

      const gif = document.createElement('img');
      gif.className = 'remains-marker remains-hit-gif';   // 동일 사이즈/스타일 + 위 레이어
      gif.alt = '';
      gif.style.zIndex = '6';                             // 정적 유해(z 2) 위
      if (facingLeft) gif.style.transform = _facingTransform(true);
      gif.src = blobUrl;
      cell.appendChild(gif);

      setTimeout(() => {
        // ★ [정적 노출/제거]와 [GIF 제거]를 같은 동기 tick 에 → 둘이 동시에 보이는 프레임 0,
        //   빈 프레임도 0 (비파괴: GIF 마지막 프레임 ≈ 결과 PNG 라 매끄럽게 교대).
        settle();
        if (gif.parentNode) gif.remove();
        URL.revokeObjectURL(blobUrl);
      }, gifDur + 80);
    }).catch(() => { settle(); });
  };
})();
