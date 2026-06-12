// ─────────────────────────────────────────────────────────────────────────────
// 악몽 시전 — 에셋 기반 (v6, 프리뷰 확정 사양)
//   표식 적 셀의 정수리 위(표식 위치)에 nightmare.gif (표식 2배 크기) 1회 재생.
//   GIF 4프레임(임팩트)에 피격 흔들림 + 캐릭터 위 데미지 도장(showBoardDamageStamp) 출력.
//
//   animateNightmareCast(positions, opts):
//     positions : [{ col, row, damage? }, ...]  (damage 없으면 1)
//     opts: boardId(기본 'game-board')
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  function _nmOnceHoldBlob(url) {
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
  function _nmFrameDelays(url) {
    return fetch(url, { cache: 'no-cache' }).then(r => r.arrayBuffer()).then(ab => {
      const b = new Uint8Array(ab); let t = 0, out = [];
      for (let i = 0; i < b.length - 7; i++) { if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 0x04 && b[i + 7] === 0x00) { t += ((b[i + 4] | (b[i + 5] << 8)) * 10); out.push(t); } }
      return out;
    }).catch(() => [130, 260, 390, 520, 650, 780, 910, 1040, 1170]);
  }
  // 악몽 = 실제 렌더된 표식 레이어(.mark-board-layer) 의 중심·크기에 정확히 정렬(2배).
  //   ★ 기존엔 p-gif 기준(다른 앵커)이라 표식 idle 과 따로 놀았음 → 실제 표식 레이어 rect 를 1순위로.
  function _nmPos(cell) {
    const cr = cell.getBoundingClientRect();
    // ★ 셀의 총 렌더 배율(부모 transform scale 포함) — 일반 셀=1(무영향), 스케일된 캐러셀 멤버에선 보정.
    const sc = (cell.offsetWidth > 0) ? (cr.width / cell.offsetWidth) : 1;
    const ml = cell.querySelector('.mark-board-layer');   // 표식 idle(정수리) — 인게임/모드 무관 실제 위치·크기
    if (ml) {
      const mr = ml.getBoundingClientRect();
      if (mr.width > 0) {
        return {
          cx: (mr.left + mr.width / 2 - cr.left) / sc,
          cy: (mr.top + mr.height / 2 - cr.top) / sc,
          size: Math.round(mr.width / sc * 2),
        };
      }
    }
    // 폴백 — 표식 레이어가 아직 없으면 p-gif 정수리 추정
    const pgif = cell.querySelector('.piece-marker img.p-gif')
      || cell.querySelector('.spec-piece .p-icon img') || cell.querySelector('img.p-gif');
    const pr = pgif ? pgif.getBoundingClientRect() : null;
    const cx = pr ? (pr.left + pr.width / 2 - cr.left) / sc : (cr.width / sc) / 2;
    const cy = pr ? ((pr.top - cr.top) / sc - 9) : (cr.height / sc) * 0.28;
    const markSize = (window._MARK_TUNE && window._MARK_TUNE.size) || window.MARK_IDLE_SIZE || 35;
    return { cx, cy, size: Math.round(markSize * 2) };
  }

  // opts.onImpact(positions) — 4프레임 임팩트 시점에 1회 호출(데미지/HP 일괄 처리·판정 훅)
  function animateNightmareCast(positions, opts) {
    opts = opts || {};
    const board = document.getElementById(opts.boardId || 'game-board');
    if (!board) return;
    const list = (Array.isArray(positions) ? positions : [positions])
      .filter(p => p && p.col != null && p.row != null);
    if (!list.length) return;
    const M = window.MARK_GIFS || {};
    const url = M.nightmare || '/art/mark/nightmare.gif';
    // ★ 프레임 지연은 단 한 번만 파싱 → 모든 표식 적의 임팩트(흔들림+도장+데미지)가 같은 시점에 일괄 발동.
    const fdP = _nmFrameDelays(url);
    const overlays = [];
    list.forEach(pos => {
      const cell = board.querySelector(`.cell[data-col="${pos.col}"][data-row="${pos.row}"]`);
      if (!cell) { overlays.push(null); return; }
      cell.classList.add('mark-brand-host');                    // overflow:visible
      const p = _nmPos(cell);                                   // ★ 위치는 표식 레이어 기준 → 숨기기 전에 계산
      // ★ 악몽 모션 동안 기존 표식 idle 숨김 (모션만 보이게) → cleanup 에서 복구.
      cell.querySelectorAll('.mark-board-layer').forEach(ml => { ml.dataset._nmHidden = '1'; ml.style.display = 'none'; });
      const ov = document.createElement('img');
      ov.className = 'nightmare-gif-anim'; ov.alt = '';
      ov.style.cssText = `position:absolute;left:${p.cx}px;top:${p.cy}px;width:${p.size}px;height:${p.size}px;` +
        `margin-left:${-p.size / 2}px;margin-top:${-p.size / 2}px;z-index:20;pointer-events:none;` +
        `image-rendering:pixelated;object-fit:contain;filter:` +
        `drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000) drop-shadow(0 0 0.5px #000);`;
      overlays.push(ov);
      _nmOnceHoldBlob(url).then(bu => { ov._blob = bu; ov.src = bu; cell.appendChild(ov); }).catch(() => {});
    });
    fdP.then(fd => {
      const impact = (fd.length > 3 ? fd[3] : (fd.length ? fd[fd.length - 1] : 520));
      const total = fd.length ? fd[fd.length - 1] : 1170;
      // ── 4프레임(임팩트): 모든 표식 적 동시 — 피격 흔들림 + 데미지 도장 + 데미지 처리(onImpact) ──
      setTimeout(() => {
        list.forEach(pos => {
          const cell = board.querySelector(`.cell[data-col="${pos.col}"][data-row="${pos.row}"]`);
          if (!cell) return;
          const mk = cell.querySelector('.piece-marker') || cell.querySelector('.spec-piece');
          if (mk && mk.animate) {
            mk.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' },
              { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
              { duration: 350, easing: 'ease' });
          }
          const dmg = (typeof pos.damage === 'number') ? pos.damage : 1;
          if (typeof window.showBoardDamageStamp === 'function') {
            try { window.showBoardDamageStamp(pos.col, pos.row, 'normal', dmg); } catch (e) {}
          }
        });
        if (typeof opts.onImpact === 'function') { try { opts.onImpact(list); } catch (e) {} }
      }, impact);
      setTimeout(() => {
        overlays.forEach(ov => { if (!ov) return; try { if (ov.parentNode) ov.remove(); } catch (e) {} if (ov._blob) { try { URL.revokeObjectURL(ov._blob); } catch (e) {} } });
        // ★ 숨겼던 표식 idle 복구
        list.forEach(pos => { const cell = board.querySelector(`.cell[data-col="${pos.col}"][data-row="${pos.row}"]`); if (!cell) return;
          cell.querySelectorAll('.mark-board-layer[data-_nm-hidden], .mark-board-layer').forEach(ml => { if (ml.dataset._nmHidden) { ml.style.display = ''; delete ml.dataset._nmHidden; } }); });
      }, total + 150);
    });
  }

  window.animateNightmareCast = animateNightmareCast;
})();
