// ─────────────────────────────────────────────────────────────────────────────
// 표식 발동 — 에셋 기반 (v3, 프리뷰 확정 사양)
//   인두 PNG 가 정수리 위 표식 위치로 내려찍힘 → 불꽃 → 생성 GIF(1회) → 정수리 위 표식 idle 레이어로 인계.
//   캐릭터 보라 글로우는 생성에 맞춰 페이드인(.mark-aura-in).
//
//   animateMarkBrand(positions, opts):
//     positions : [{ col, row }, ...]
//     opts: boardId(기본 'game-board'), onSizzle(임팩트 콜백), stagger(다중 간격 ms, 기본 130)
//
//   소환 중인 셀은 window._markSummoning 에 등록 → renderGameBoard 가 idle 표식 레이어를 억제
//   (_markSummoningActive). 생성 GIF 종료 시 해제 → idle 레이어 인계.
// ─────────────────────────────────────────────────────────────────────────────

if (!window._markSummoning) window._markSummoning = new Set();
window._markSummoningActive = function (col, row) { return window._markSummoning.has(col + ',' + row); };

// 정수리 위 표식 배치 (style.css .mark-board-layer 와 동일) — 인게임 튜닝 시 함께 조정.
const _MARK_SIZE = 35;        // ★ 튜너 확정값(mark-preview): 35
window.MARK_IDLE_SIZE = _MARK_SIZE;   // 악몽 등 다른 모션이 표식 크기에 맞추도록 전역 노출
const _MARK_OFFY = -32;
const _MARK_IRONSZ = Math.round(_MARK_SIZE * 1.45);   // 인두 ×1.45

// 1회재생 + 마지막 프레임 hold blob (NETSCAPE 제거 + 마지막 GCE disposal=1)
function _markOnceHoldBlob(url) {
  return fetch(url, { cache: 'no-cache' }).then(r => r.arrayBuffer()).then(ab => {
    let b = new Uint8Array(ab);
    for (let i = 0; i < b.length - 13; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xFF && b[i + 2] === 0x0B) {
        let t = ''; for (let k = 0; k < 11; k++) t += String.fromCharCode(b[i + 3 + k]);
        if (t === 'NETSCAPE2.0') { const o = new Uint8Array(b.length - 19); o.set(b.slice(0, i), 0); o.set(b.slice(i + 19), i); b = o; break; }
      }
    }
    let lastG = -1; for (let i = 0; i < b.length - 7; i++) { if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 0x04 && b[i + 7] === 0x00) lastG = i; }
    if (lastG >= 0) { const p = lastG + 3; b[p] = (b[p] & ~(7 << 2)) | (1 << 2); }
    return URL.createObjectURL(new Blob([b], { type: 'image/gif' }));
  });
}
function _markGifTotalMs(url) {
  return fetch(url, { cache: 'no-cache' }).then(r => r.arrayBuffer()).then(ab => {
    const b = new Uint8Array(ab); let t = 0;
    for (let i = 0; i < b.length - 7; i++) { if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 0x04 && b[i + 7] === 0x00) t += ((b[i + 4] | (b[i + 5] << 8)) * 10); }
    return t || 1170;
  }).catch(() => 1170);
}

function animateMarkBrand(positions, opts) {
  opts = opts || {};
  const board = document.getElementById(opts.boardId || 'game-board');
  if (!board) return;
  const list = Array.isArray(positions) ? positions : [positions];
  const stagger = (typeof opts.stagger === 'number') ? opts.stagger : 130;
  // ★ 소환 플래그를 동기로 먼저 등록 — 직후 renderGameBoard 가 idle 표식 레이어를 억제하도록
  //   (이게 없으면 idle 이 먼저 뜨고 인두/생성이 나중에 따로 재생됨).
  list.forEach(pos => { if (pos && pos.col != null && pos.row != null) window._markSummoning.add(pos.col + ',' + pos.row); });
  list.forEach((pos, i) => {
    if (!pos || pos.col == null || pos.row == null) return;
    setTimeout(() => _markBrandOne(board, pos.col, pos.row, opts), i * stagger);
  });
}

function _markBrandOne(board, col, row, opts) {
  const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
  if (!cell) return;
  const M = window.MARK_GIFS || {};
  // ★ 튜닝값 — window._MARK_TUNE 로 오버라이드(프리뷰 슬라이더). 미설정 시 현재 인게임 기본값.
  const _T = window._MARK_TUNE || {};
  const _size   = _T.size   || _MARK_SIZE;                              // 표식 크기(가시성) — 기본 33
  const _ironSz = _T.ironSize || Math.round(_size * (_T.ironScale || 1.45)); // 인두 ×1.45
  const _ironDur     = (_T.ironDur     != null) ? _T.ironDur     : 950; // 인두 낙하 시간(튜너 확정 0.95s)
  const _ironH       = (_T.ironH       != null) ? _T.ironH       : 50;  // 인두 강하 높이(튜너 확정 50)
  const _impactMs    = (_T.impactMs    != null) ? _T.impactMs    : 480; // 임팩트(튜너 확정 480) → 착지 뒤 생성
  const _summonDelay = (_T.summonDelay != null) ? _T.summonDelay : (_impactMs + 30); // 생성 GIF 시작(착지 뒤)
  const _summonDur   = (_T.summonDur   != null) ? _T.summonDur   : 1170; // 생성 GIF 총 길이
  const _ironOffX    = (_T.ironOffX    != null) ? _T.ironOffX    : 0;   // 인두 X 위치 보정
  const _ironOffY    = (_T.ironOffY    != null) ? _T.ironOffY    : -6;  // 인두 Y 위치 보정(튜너 확정 −6, 살짝 위)
  const _markOffY    = (_T.markOffY    != null) ? _T.markOffY    : 0;   // 표식(생성/정수리) Y 보정
  const key = col + ',' + row;
  const _summonBlobP = _markOnceHoldBlob(M.summon);  // ★ 시작과 동시에 생성 GIF blob 준비 → impact 시점 즉시 표시(인두와 거의 동시)
  window._markSummoning.add(key);
  cell.classList.add('mark-brand-host');                         // overflow:visible
  cell.querySelectorAll('.mark-board-layer').forEach(el => { el.style.display = 'none'; });  // 소환 중 idle 숨김
  // ★ 표식으로 공개되는 적이면 모습 자체도 글로우와 함께 페이드인 — 소환 시작 시 안 보이게.
  const _oppMk = cell.querySelector('.piece-marker.opp-marked');
  if (_oppMk) { _oppMk.style.transition = 'none'; _oppMk.style.opacity = '0'; void _oppMk.offsetWidth; }

  // ── 표식 중심 — idle .mark-board-layer 의 '실제 정착 위치'에 정렬 ──
  //   (생성 GIF·인두·불꽃을 모두 idle 과 동일 지점에 두어 인계 시 위치 점프 0.
  //    idle 은 .piece-marker 기준 left:50%/bottom:100%/translateY(11) 이라 p-gif bbox 와 어긋났었음.)
  const cr = cell.getBoundingClientRect();
  const _host0 = cell.querySelector('.piece-marker') || cell.querySelector('.spec-piece');
  let markCx, markCy;
  if (_host0) {
    _host0.style.position = 'relative';
    const probe = document.createElement('img');
    probe.className = 'mark-board-layer';
    probe.style.cssText = `visibility:hidden;animation:none;width:${_size}px;height:${_size}px;transform:translate(-50%,11px);`;
    _host0.appendChild(probe);
    const prb = probe.getBoundingClientRect();
    markCx = prb.left + prb.width / 2 - cr.left;
    markCy = prb.top + prb.height / 2 - cr.top + _markOffY;
    probe.remove();
  } else {
    const pgif = cell.querySelector('img.p-gif');
    const pr = pgif ? pgif.getBoundingClientRect() : null;
    markCx = pr ? (pr.left + pr.width / 2 - cr.left) : cr.width / 2;
    markCy = (pr ? (pr.top - cr.top - 9) : cr.height * 0.28) + _markOffY;
  }
  const fixX = cr.left + markCx, fixY = cr.top + markCy;          // 불꽃(position:fixed)용 뷰포트 좌표

  // ── 인두 PNG 낙하 (정수리 위 표식 위치) ──
  const iron = document.createElement('img');
  iron.src = M.iron || '/art/mark/mark_iron.png';
  iron.className = 'mark-iron-anim'; iron.alt = '';
  // ★ 인두는 '바닥 기준' — 인두 바닥이 표식(정수리) 바닥에 닿도록(머리 위로 들려 찍힘). mark-preview 와 동일.
  //   (이전엔 인두 중심을 표식 중심에 둬서 큰 인두가 유닛 위로 겹쳐 내려왔음)
  const _markBottomY = markCy + _size / 2;                 // 표식(정수리) 바닥 y
  iron.style.cssText = `position:absolute;left:${markCx + _ironOffX}px;top:${_markBottomY - _ironSz / 2 + _ironOffY}px;width:${_ironSz}px;height:${_ironSz}px;` +
    `margin-left:${-_ironSz / 2}px;margin-top:${-_ironSz / 2}px;z-index:30;pointer-events:none;` +
    `image-rendering:pixelated;object-fit:contain;filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 3px rgba(168,116,231,0.75));`;
  cell.appendChild(iron);
  iron.animate([
    { opacity: 0, transform: `translateY(${-_ironH}px) scale(.92)` },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.4 },
    { opacity: 1, transform: 'translateY(3px) scale(1.04)', offset: 0.62 },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.78 },
    { opacity: 0, transform: `translateY(${-Math.round(_ironH * 0.72)}px) scale(.94)` },
  ], { duration: _ironDur, easing: 'ease', fill: 'forwards' });

  const impactMs = _impactMs;
  if (typeof opts.onSizzle === 'function') setTimeout(() => { try { opts.onSizzle(); } catch (e) {} }, impactMs);

  // ── 임팩트: 불꽃 + 글로우 페이드인 + (표식 적) 모습 페이드인 ──
  setTimeout(() => {
    _markSparks(fixX, fixY);
    cell.classList.add('mark-aura-in');
    if (_oppMk) { _oppMk.style.transition = 'opacity 1.1s ease'; _oppMk.style.opacity = '1'; }  // 모습=글로우와 동기 페이드인
    setTimeout(() => cell.classList.remove('mark-aura-in'), 1300);
  }, impactMs);

  // ── 생성 GIF (1회) → 끝나면 idle 레이어 인계 ──
  const summonImg = document.createElement('img');
  summonImg.className = 'mark-summon-anim'; summonImg.alt = '';
  summonImg.style.cssText = `position:absolute;left:${markCx}px;top:${markCy}px;width:${_size}px;height:${_size}px;` +
    `margin-left:${-_size / 2}px;margin-top:${-_size / 2}px;z-index:6;pointer-events:none;` +
    `image-rendering:pixelated;object-fit:contain;filter:` +
    `drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000) ` +
    `drop-shadow(0 0 2px rgba(168,116,231,0.7));`;
  let blobUrl = null;
  setTimeout(() => {
    _summonBlobP.then(bu => {                     // ★ 이미 준비된 blob → 즉시 표시(인두와 동시)
      blobUrl = bu; summonImg.src = bu; cell.appendChild(summonImg);
      setTimeout(() => {
        // ★ 생성 GIF 끝 → 생성 오버레이를 '그 자리에서' 표식 idle 레이어로 전환(끊김 0).
        //   renderGameBoard 로 셀을 재구축하면 오버레이 파괴+새 idle 디코드 사이 공백/소멸이 생겨
        //   "생성 후 표식이 사라지고 턴 넘어가야 보이던" 버그가 났음 → 재구축 대신 직접 전환.
        window._markSummoning.delete(key);
        cell.classList.remove('mark-brand-host');
        try {
          summonImg.src = (window.MARK_GIFS && window.MARK_GIFS.idle) || '/art/mark/mark_idle.gif';
          summonImg.className = 'mark-board-layer';     // CSS 가 정수리 위 위치/크기/글로우/bob 담당
          summonImg.removeAttribute('style');
          const host = cell.querySelector('.piece-marker') || cell.querySelector('.spec-piece');
          if (host) {
            cell.querySelectorAll('.mark-board-layer').forEach(el => { if (el !== summonImg) el.remove(); });  // 기존/숨김 잔재 제거 — 중복 방지
            host.style.position = 'relative'; host.appendChild(summonImg);
          } else summonImg.remove();
        } catch (e) { try { summonImg.remove(); } catch (_) {} }
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        // (다음 자연 renderGameBoard 가 진짜 idle 레이어로 교체 — 둘 다 같은 idle 이라 끊김 없음)
      }, _summonDur + 100);                       // 생성 GIF 총 길이 + 버퍼
    }).catch(() => { _markBrandCleanup(cell, key); });
  }, _summonDelay);

  setTimeout(() => { try { if (iron.parentNode) iron.remove(); } catch (e) {} }, _ironDur + 70);
  // 안전망 — 3.5s 후 강제 정리
  setTimeout(() => { if (window._markSummoning.has(key)) _markBrandCleanup(cell, key); }, 3500);
}

function _markBrandCleanup(cell, key) {
  window._markSummoning.delete(key);
  cell.classList.remove('mark-brand-host');
  cell.querySelectorAll('.mark-board-layer').forEach(el => { el.style.display = ''; });
  cell.querySelectorAll('.mark-iron-anim, .mark-summon-anim').forEach(el => el.remove());
}

// 픽셀 네모 불꽃 — 표식 중심에서 팍 튐 (프리뷰와 동일). cx/cy = 뷰포트 좌표.
function _markSparks(cx, cy) {
  const colors = ['#ffd84d', '#ff9a3d', '#ffefb0', '#ff5a2d', '#ffffff'];
  for (let i = 0; i < 18; i++) {                  // ★ 튜너 확정: 12→18개
    const p = document.createElement('div');
    const s = 3;                                  // ★ 튜너 확정: 3px 고정
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${s}px;height:${s}px;background:${colors[i % colors.length]};` +
      `z-index:60;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 3px rgba(255,170,60,.9);` +
      `transition:transform .55s cubic-bezier(.2,.7,.3,1),opacity .55s;opacity:1`;
    document.body.appendChild(p);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    const dist = 26 * (0.5 + Math.random() * 0.8);
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist + 26 * 0.45;
    void p.offsetWidth;
    p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    p.style.opacity = '0';
    setTimeout(() => p.remove(), 600);
  }
}

// ─── 표식 파괴/해제 모션 ───────────────────────────────────────────────────────
//   기존 표식 idle 레이어를 페이드아웃하며 정수리 위에 release GIF(1회) 재생.
//   생성/idle 과 동일한 외곽선(0-오프셋 블러 0.5px ×3, 캐릭터 방식 센터 대칭) + 글로우.
//   animateMarkRelease(positions, opts): positions [{col,row}], opts: boardId, stagger
const _MARK_OUTLINE = 'drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000)';
function animateMarkRelease(positions, opts) {
  opts = opts || {};
  const board = document.getElementById(opts.boardId || 'game-board');
  if (!board) return;
  const list = Array.isArray(positions) ? positions : [positions];
  const stagger = (typeof opts.stagger === 'number') ? opts.stagger : 130;
  list.forEach((pos, i) => {
    if (!pos || pos.col == null || pos.row == null) return;
    setTimeout(() => _markReleaseOne(board, pos.col, pos.row), i * stagger);
  });
}
function _markReleaseOne(board, col, row) {
  const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
  if (!cell) return;
  const M = window.MARK_GIFS || {};
  const _T = window._MARK_TUNE || {};
  const _size = _T.size || _MARK_SIZE;
  const _markOffY = (_T.markOffY != null) ? _T.markOffY : 0;
  const _oppMk = cell.querySelector('.piece-marker.opp-marked');
  const _glow = _oppMk ? 'rgba(224,82,82,0.7)' : 'rgba(168,116,231,0.7)';
  cell.classList.add('mark-brand-host');
  // 기존 idle 표식 페이드아웃
  cell.querySelectorAll('.mark-board-layer').forEach(el => {
    el.style.transition = 'opacity .45s ease'; el.style.opacity = '0';
  });
  const cr = cell.getBoundingClientRect();
  const pgif = cell.querySelector('.piece-marker img.p-gif')
    || cell.querySelector('.spec-piece .p-icon img') || cell.querySelector('img.p-gif');
  const pr = pgif ? pgif.getBoundingClientRect() : null;
  const markCx = pr ? (pr.left + pr.width / 2 - cr.left) : cr.width / 2;
  const markCy = (pr ? (pr.top - cr.top - 9) : cr.height * 0.28) + _markOffY;
  const url = M.release || '/art/mark/mark_release.gif';
  _markOnceHoldBlob(url).then(bu => {
    const rel = document.createElement('img');
    rel.className = 'mark-release-anim'; rel.alt = '';
    rel.style.cssText = `position:absolute;left:${markCx}px;top:${markCy}px;width:${_size}px;height:${_size}px;` +
      `margin-left:${-_size / 2}px;margin-top:${-_size / 2}px;z-index:7;pointer-events:none;` +
      `image-rendering:pixelated;object-fit:contain;filter:${_MARK_OUTLINE} drop-shadow(0 0 2px ${_glow});`;
    rel.src = bu; cell.appendChild(rel);
    _markGifTotalMs(url).then(dur => {
      setTimeout(() => { try { if (rel.parentNode) rel.remove(); } catch (e) {} URL.revokeObjectURL(bu); }, (dur || 800) + 80);
    });
  }).catch(() => {});
}
window.animateMarkRelease = animateMarkRelease;
