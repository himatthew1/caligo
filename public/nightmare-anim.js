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
  // 표식(정수리 위) 위치 — mark-anim 과 동일 기준. 악몽 크기 = 표식(0.74×p-gif) × 2배.
  function _nmPos(cell) {
    const cr = cell.getBoundingClientRect();
    const pgif = cell.querySelector('.piece-marker img.p-gif')
      || cell.querySelector('.spec-piece .p-icon img') || cell.querySelector('img.p-gif');
    const pr = pgif ? pgif.getBoundingClientRect() : null;
    const cx = pr ? (pr.left + pr.width / 2 - cr.left) : cr.width / 2;
    const cy = pr ? (pr.top - cr.top - 9) : cr.height * 0.28;
    const w = pr ? pr.width : 30;
    return { cx, cy, size: Math.max(40, Math.round(w * 0.74 * 2)) };
  }

  function animateNightmareCast(positions, opts) {
    opts = opts || {};
    const board = document.getElementById(opts.boardId || 'game-board');
    if (!board) return;
    const list = Array.isArray(positions) ? positions : [positions];
    const M = window.MARK_GIFS || {};
    const url = M.nightmare || '/art/mark/nightmare.gif';
    list.forEach(pos => {
      if (!pos || pos.col == null || pos.row == null) return;
      const cell = board.querySelector(`.cell[data-col="${pos.col}"][data-row="${pos.row}"]`);
      if (!cell) return;
      cell.classList.add('mark-brand-host');                    // overflow:visible
      const p = _nmPos(cell);
      const ov = document.createElement('img');
      ov.className = 'nightmare-gif-anim'; ov.alt = '';
      ov.style.cssText = `position:absolute;left:${p.cx}px;top:${p.cy}px;width:${p.size}px;height:${p.size}px;` +
        `margin-left:${-p.size / 2}px;margin-top:${-p.size / 2}px;z-index:20;pointer-events:none;` +
        `image-rendering:pixelated;object-fit:contain;filter:` +
        `drop-shadow(0.5px 0 0 #000) drop-shadow(-0.5px 0 0 #000) drop-shadow(0 0.5px 0 #000) drop-shadow(0 -0.5px 0 #000) ` +
        `drop-shadow(0.5px 0.5px 0 #000) drop-shadow(-0.5px 0.5px 0 #000) drop-shadow(0.5px -0.5px 0 #000) drop-shadow(-0.5px -0.5px 0 #000);`;
      _nmOnceHoldBlob(url).then(bu => {
        ov.src = bu; cell.appendChild(ov);
        _nmFrameDelays(url).then(fd => {
          const impact = (fd.length > 3 ? fd[3] : (fd.length ? fd[fd.length - 1] : 520));
          const total = fd.length ? fd[fd.length - 1] : 1170;
          // ── 4프레임(임팩트): 피격 흔들림 + 데미지 도장 ──
          setTimeout(() => {
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
          }, impact);
          setTimeout(() => { try { if (ov.parentNode) ov.remove(); } catch (e) {} URL.revokeObjectURL(bu); }, total + 150);
        });
      }).catch(() => {});
    });
  }

  window.animateNightmareCast = animateNightmareCast;
})();
