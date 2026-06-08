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
const _MARK_SIZE = 28;
const _MARK_OFFY = -32;
const _MARK_IRONSZ = Math.round(_MARK_SIZE * 1.35);   // 인두 ×1.35

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
  const key = col + ',' + row;
  const _summonBlobP = _markOnceHoldBlob(M.summon);  // ★ 시작과 동시에 생성 GIF blob 준비 → impact 시점 즉시 표시(인두와 거의 동시)
  window._markSummoning.add(key);
  cell.classList.add('mark-brand-host');                         // overflow:visible
  cell.querySelectorAll('.mark-board-layer').forEach(el => { el.style.display = 'none'; });  // 소환 중 idle 숨김
  // ★ 표식으로 공개되는 적이면 모습 자체도 글로우와 함께 페이드인 — 소환 시작 시 안 보이게.
  const _oppMk = cell.querySelector('.piece-marker.opp-marked');
  if (_oppMk) { _oppMk.style.transition = 'none'; _oppMk.style.opacity = '0'; void _oppMk.offsetWidth; }

  // ── 표식 중심(정수리 위) — 실제 p-gif 위치 기준(셀 크기·정렬 무관) ──
  const cr = cell.getBoundingClientRect();
  const pgif = cell.querySelector('.piece-marker img.p-gif')
    || cell.querySelector('.spec-piece .p-icon img') || cell.querySelector('img.p-gif');
  const pr = pgif ? pgif.getBoundingClientRect() : null;
  const markCx = pr ? (pr.left + pr.width / 2 - cr.left) : cr.width / 2;
  const markCy = pr ? (pr.top - cr.top - 9) : cr.height * 0.28;   // p-gif 위 ~9px = idle 레이어 중심과 일치
  const fixX = cr.left + markCx, fixY = cr.top + markCy;          // 불꽃(position:fixed)용 뷰포트 좌표

  // ── 인두 PNG 낙하 (정수리 위 표식 위치) ──
  const iron = document.createElement('img');
  iron.src = M.iron || '/art/mark/mark_iron.png';
  iron.className = 'mark-iron-anim'; iron.alt = '';
  iron.style.cssText = `position:absolute;left:${markCx}px;top:${markCy}px;width:${_MARK_IRONSZ}px;height:${_MARK_IRONSZ}px;` +
    `margin-left:${-_MARK_IRONSZ / 2}px;margin-top:${-_MARK_IRONSZ / 2}px;z-index:30;pointer-events:none;` +
    `image-rendering:pixelated;object-fit:contain;filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 3px rgba(168,116,231,0.75));`;
  cell.appendChild(iron);
  iron.animate([
    { opacity: 0, transform: 'translateY(-18px) scale(.92)' },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.4 },
    { opacity: 1, transform: 'translateY(3px) scale(1.04)', offset: 0.62 },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.78 },
    { opacity: 0, transform: 'translateY(-13px) scale(.94)' },
  ], { duration: 650, easing: 'ease', fill: 'forwards' });

  const impactMs = 325;
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
  summonImg.style.cssText = `position:absolute;left:${markCx}px;top:${markCy}px;width:${_MARK_SIZE}px;height:${_MARK_SIZE}px;` +
    `margin-left:${-_MARK_SIZE / 2}px;margin-top:${-_MARK_SIZE / 2}px;z-index:6;pointer-events:none;` +
    `image-rendering:pixelated;object-fit:contain;filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 2px rgba(168,116,231,0.7));`;
  let blobUrl = null;
  setTimeout(() => {
    _summonBlobP.then(bu => {                     // ★ 이미 준비된 blob → 즉시 표시(인두와 동시)
      blobUrl = bu; summonImg.src = bu; cell.appendChild(summonImg);
      setTimeout(() => {
        // 생성 GIF 끝 → idle 인계. idle 먼저 렌더(디코드 시작)한 뒤 생성 오버레이 제거(공백 최소화).
        window._markSummoning.delete(key);
        cell.classList.remove('mark-brand-host');
        cell.querySelectorAll('.mark-board-layer').forEach(el => { el.style.display = ''; });
        if (typeof renderGameBoard === 'function') { try { renderGameBoard(); } catch (e) {} }
        setTimeout(() => { try { if (summonImg.parentNode) summonImg.remove(); } catch (e) {} if (blobUrl) URL.revokeObjectURL(blobUrl); }, 60);
      }, 1170 + 100);                             // 생성 GIF 총 길이(고정 1170ms) + 버퍼
    }).catch(() => { _markBrandCleanup(cell, key); });
  }, impactMs + 30);

  setTimeout(() => { try { if (iron.parentNode) iron.remove(); } catch (e) {} }, 720);
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
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    const s = 2 + Math.floor(Math.random() * 2);
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
