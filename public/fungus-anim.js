// ★ 진균지대 연출 모듈 — 인게임(game.js)과 프리뷰(fungus-anim-preview.html)가 이 파일 하나를 그대로 공유.
//   스타일은 style.css 의 .fz-* 규칙. 수정은 여기(타이밍·파티클)와 style.css(모양·색)만 하면 양쪽 동일 반영.
//
//   모든 연출은 보드 안 전용 레이어(.fz-board-layer, 오베론 구 레이어와 같은 방식)에 셀 좌표로 붙인다
//   → renderGameBoard 가 셀 내용을 재구축해도 연출이 끊기지 않음(보드 애니 생존 원칙).
//   ★ 캐릭터 그래픽은 항상 연출 위: 연출 중엔 보드에 .fz-active 를 달아 유닛 그래픽을 레이어 위로 올린다.
//   ★ 각 칸 연출은 그 칸 안으로 클리핑(칸 밖으로 번지지 않음).
//
//   FungusAnim.spawn(board, cells, opts)   — 새 진균지대 생성(포자살포·확산 공통)
//       cells: [{ col, row, from?: {col,row} }]  from 이 있으면 '확산' — 원래 진균칸에서 새 칸으로 곰팡이가 번지는 방향 연출
//       opts.onSettle(cell)  — 그 칸이 실제 진균지대로 정착하는 순간(게임: .cell-fungus 부여)
//       opts.onDone()        — 전체 종료
//       반환: 전체 길이(ms)
//   FungusAnim.sweep(board, fungusCells, opts) — 머쉬킨 페이즈: 왼쪽 위 → 오른쪽 아래로 쓸어내리는 독포자 연기 글로우
//       opts.onCellGlow(cell) — 그 칸이 가장 밝아지는 순간(게임: 노출 유닛 중독 심화 도장·로그)
//       opts.onDone()
//       반환: 전체 길이(ms)
//   FungusAnim.idle(board, fungusCells) — 진균지대 기본 아이들(포자 솜뭉치·별가루·잎사귀가 몽실몽실 피어오름, 무한 반복)
//       렌더 때마다 호출해도 됨: 기존 칸은 유지(애니 리셋 없음)·위치만 갱신, 사라진 칸은 제거.
//
//   파티클(정령·버섯 포자·자연·독 컨셉, 아주 작고 녹색 위주, 헤롱헤롱) — fluff(연두 포자) · toxic(짙은 독녹색 포자)
//     · spark(연두 정령 별가루) · leaf(작은 잎사귀) · shroom(생성 때 톡 솟는 아기 버섯)
(function () {
  const T = {
    SPAWN_STAGGER: 180,     // 여러 칸 생성 시 칸 사이 간격
    SPAWN_SOURCE_LEAD: 260, // 확산: 원래 칸이 먼저 맥동한 뒤 번지기 시작
    SPAWN_SETTLE: 700,      // 번지기 시작 → 진균지대 정착(onSettle)
    SPAWN_FADE: 380,        // 정착 후 오버레이 페이드
    MOLD_SPOTS: 9,          // 확산 시 곰팡이 덩어리를 이루는 반점 수(마스크용, 직접 안 보임)
    MOLD_SPREAD: 0.8,       // 반점이 반대편 끝까지 번지는 데 쓰는 비율(정착 시간 대비)
    MOLD_GOO_BLUR: 3,       // 반점이 한 덩어리로 뭉치는 정도
    MOLD_NOISE_FREQ: 0.55,  // 단면 자글자글 촘촘함
    MOLD_NOISE_SCALE: 5,    // 단면 자글자글 세기(px)
    MOLD_RIM: 1.1,          // 밝은 테두리 두께(마스크 확대 비율)
    SWEEP_STEP: 120,        // 스와이프: 대각선 한 줄(col+row)당 지연
    SWEEP_PEAK: 300,        // 칸 글로우 시작 → 최고조(onCellGlow)
    SWEEP_CELL: 820,        // 칸 글로우 전체 길이
    // 파티클 구성(칸당 개수)
    P_SPAWN: { fluff: 5, toxic: 2, spark: 2, shroom: 2 },         // 생성(포자살포·확산) — 곰팡이가 번지는 동안
    P_SWEEP: { fluff: 4, toxic: 1, spark: 1, leaf: 1 },           // 머쉬킨 페이즈 스와이프
    P_IDLE:  { fluff: 3, toxic: 1, spark: 1, leaf: 1 },           // 기본 아이들(무한 반복)
    P_IDLE_CYCLE: [4200, 6800],                                   // 아이들 파티클 한 바퀴 길이 범위(ms) — 느릿느릿
    P_ONCE_CYCLE: [1000, 1400],                                   // 1회 파티클 길이 범위(ms)
    SMOKE_PUFFS: 3,         // 스와이프 시 칸당 독포자 연기 덩어리 수
    SMOKE_GAP: 90,          // 연기 덩어리 사이 시간차
  };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function cellEl(board, c) {
    return board && board.querySelector(`.cell[data-col="${c.col}"][data-row="${c.row}"]`);
  }
  // 보드 전용 연출 레이어 + 진행 중 연출 수(0 이 되면 유닛 끌어올림 해제)
  function boardLayer(board) {
    let layer = board.querySelector(':scope > .fz-board-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'fz-board-layer';
      board.appendChild(layer);
    }
    return layer;
  }
  function hold(board) { board._fzHold = (board._fzHold || 0) + 1; board.classList.add('fz-active'); }
  function release(board) {
    board._fzHold = Math.max(0, (board._fzHold || 0) - 1);
    if (!board._fzHold) board.classList.remove('fz-active');
  }
  // 칸 하나 크기·위치의 연출 상자(보드 레이어 안, 칸 모양으로 클리핑)
  function layerAt(board, cell, cls) {
    const el = document.createElement('div');
    el.className = 'fz-layer ' + cls;
    el.style.left = cell.offsetLeft + 'px';
    el.style.top = cell.offsetTop + 'px';
    el.style.width = cell.offsetWidth + 'px';
    el.style.height = cell.offsetHeight + 'px';
    boardLayer(board).appendChild(el);
    hold(board);
    const _remove = el.remove.bind(el);
    el.remove = () => { if (el.isConnected) { _remove(); release(board); } };
    return el;
  }
  // ── 미니 파티클 ──
  //   mode 'once': 연출 시간(span ms) 안에 시간차로 1회.  mode 'idle': 무한 반복(음수 지연으로 처음부터 흩어진 상태).
  function addParticles(layer, mix, mode, span) {
    for (const kind of Object.keys(mix || {})) {
      for (let i = 0; i < mix[kind]; i++) {
        const el = document.createElement('span');
        el.className = 'fz-p fz-p-' + kind + (mode === 'idle' ? ' fz-p-loop' : '');
        const sway = kind === 'leaf' ? rnd(4, 6) : rnd(2.5, 4.5);   // 헤롱헤롱 갈지자 폭
        const t = mode === 'idle' ? rnd(T.P_IDLE_CYCLE[0], T.P_IDLE_CYCLE[1]) : rnd(T.P_ONCE_CYCLE[0], T.P_ONCE_CYCLE[1]);
        el.style.setProperty('--x', rnd(14, 86).toFixed(1) + '%');
        el.style.setProperty('--y', (kind === 'shroom' ? rnd(45, 85) : rnd(40, 92)).toFixed(1) + '%');
        el.style.setProperty('--dx', ((Math.random() < 0.5 ? -1 : 1) * sway).toFixed(1) + 'px');
        el.style.setProperty('--dy', (kind === 'shroom' ? 0 : -rnd(12, 22)).toFixed(1) + 'px');
        el.style.setProperty('--r', Math.round(rnd(0, 360)) + 'deg');
        el.style.setProperty('--t', Math.round(t) + 'ms');
        el.style.setProperty('--d', Math.round(mode === 'idle' ? -rnd(0, t) : rnd(0, Math.max(0, (span || 600) - 300))) + 'ms');
        layer.appendChild(el);
      }
    }
  }

  // 곰팡이 마스크 필터 — ① blur+알파 임계값(goo)으로 반점들을 하나의 둥근 덩어리로 합치고
  //   ② 노이즈 변위로 그 경계를 자글자글하게. 문서에 1회 주입.
  function ensureMoldFilter() {
    if (document.getElementById('fz-moldmask')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.innerHTML = '<defs><filter id="fz-moldmask" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + T.MOLD_GOO_BLUR + '" result="b"/>' +
      '<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g"/>' +
      '<feTurbulence type="fractalNoise" baseFrequency="' + T.MOLD_NOISE_FREQ + '" numOctaves="2" seed="7" result="n"/>' +
      '<feDisplacementMap in="g" in2="n" scale="' + T.MOLD_NOISE_SCALE + '" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter></defs>';
    document.body.appendChild(svg);
  }
  let _moldSeq = 0;

  // 곰팡이 번짐 — 반점이 시작점에서 가까운 순으로 부풀어 둥근 덩어리로 번져 나감.
  //   확산(dir 있음): 원래 칸과 맞닿은 가장자리에서 반대편 끝으로.
  //   포자살포(dir 없음): 칸 안 랜덤한 한 점에서 사방으로.
  //   반점은 직접 그리지 않고 '마스크'로만 사용 → 곰팡이 면 하나가 그 모양대로 드러나므로 겹침 자국이 없음.
  //   경계는 자글자글한 단면 + 살짝 큰 마스크로 만든 밝은 테두리. 투명도는 면 전체에 한 번(.fz-moldfront).
  function addMold(layer, dir) {
    ensureMoldFilter();
    const W = layer.offsetWidth || 56, H = layer.offsetHeight || 56;
    const id = 'fzm' + (++_moldSeq);
    const spots = [];
    if (dir) {
      const along = (t) => (dir.x !== 0 ? (dir.x > 0 ? t : 1 - t) : null);
      const alongY = (t) => (dir.y !== 0 ? (dir.y > 0 ? t : 1 - t) : null);
      for (let i = 0; i < T.MOLD_SPOTS; i++) {
        const t = -0.08 + (i / (T.MOLD_SPOTS - 1)) * 1.04 + rnd(-0.05, 0.05);   // 경계(원래 칸 쪽)부터 반대편 끝까지
        const cross = rnd(0.12, 0.88);
        const ax = along(t), ay = alongY(t);
        spots.push({
          x: (ax != null ? ax : cross) * W, y: (ay != null ? ay : cross) * H,
          r: W * rnd(0.17, 0.26),
          d: Math.round(Math.max(0, t) * T.SPAWN_SETTLE * T.MOLD_SPREAD),
        });
      }
    } else {
      // 랜덤 시작점 + 칸 전체에 고르게 흩은 반점 — 시작점에서 먼 반점일수록 늦게 부풂
      const ox = rnd(0.2, 0.8) * W, oy = rnd(0.2, 0.8) * H;
      const pts = [{ x: ox, y: oy }];
      const g = Math.ceil(Math.sqrt(T.MOLD_SPOTS));
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
        if (pts.length >= T.MOLD_SPOTS + 1) break;
        pts.push({ x: ((i + rnd(0.15, 0.85)) / g) * W, y: ((j + rnd(0.15, 0.85)) / g) * H });
      }
      const far = Math.max(...pts.map(p => Math.hypot(p.x - ox, p.y - oy))) || 1;
      for (const p of pts) {
        const t = Math.hypot(p.x - ox, p.y - oy) / far;
        spots.push({ x: p.x, y: p.y, r: W * rnd(0.17, 0.26), d: Math.round(t * T.SPAWN_SETTLE * T.MOLD_SPREAD) });
      }
    }
    const circles = (k) => spots.map(p =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(p.r * k).toFixed(1)}" fill="#fff" style="--d:${p.d}ms"/>`).join('');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fz-moldfront');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML =
      `<defs>` +
        `<mask id="${id}r" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><g filter="url(#fz-moldmask)">${circles(T.MOLD_RIM)}</g></mask>` +
        `<mask id="${id}f" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><g filter="url(#fz-moldmask)">${circles(1)}</g></mask>` +
      `</defs>` +
      `<rect class="fz-mf-rim" width="${W}" height="${H}" mask="url(#${id}r)"/>` +
      `<rect class="fz-mf-fill" width="${W}" height="${H}" mask="url(#${id}f)"/>`;
    layer.appendChild(svg);
  }

  // ── 진균지대 생성 ──────────────────────────────────────────────
  function spawn(board, cells, opts) {
    opts = opts || {};
    const list = (cells || []).filter(c => cellEl(board, c));
    if (!list.length) { if (opts.onDone) opts.onDone(); return 0; }
    let total = 0;
    list.forEach((c, i) => {
      const base = i * T.SPAWN_STAGGER;
      const dir = c.from ? { x: Math.sign(c.col - c.from.col), y: Math.sign(c.row - c.from.row) } : null;
      const creepAt = base + (dir ? T.SPAWN_SOURCE_LEAD : 0);
      const end = creepAt + T.SPAWN_SETTLE + T.SPAWN_FADE;
      total = Math.max(total, end);
      // 확산 — 원래 진균칸이 먼저 맥동(곰팡이가 깨어남).
      if (dir) {
        setTimeout(() => {
          const src = cellEl(board, c.from);
          if (!src) return;
          const pulse = layerAt(board, src, 'fz-source');
          setTimeout(() => pulse.remove(), T.SPAWN_SOURCE_LEAD + T.SPAWN_SETTLE);
        }, base);
      }
      // 새 칸 — 곰팡이가 번짐(확산이면 원래 칸 쪽 가장자리, 포자살포면 칸 안 랜덤 점에서 출발).
      setTimeout(() => {
        const el = cellEl(board, c); if (!el) return;
        const layer = layerAt(board, el, 'fz-spawn' + (dir ? ' fz-dir' : ''));
        // 번지기 시작점 — 확산이면 원래 칸과 맞닿은 가장자리, 아니면 칸 중심
        layer.style.setProperty('--ox', dir ? (50 - dir.x * 50) + '%' : '50%');
        layer.style.setProperty('--oy', dir ? (50 - dir.y * 50) + '%' : '55%');
        layer.style.setProperty('--settle', T.SPAWN_SETTLE + 'ms');
        layer.innerHTML = '<div class="fz-stain"></div>';
        addMold(layer, dir);   // 포자살포·확산 공통 곰팡이 번짐(시작점만 다름)
        addParticles(layer, T.P_SPAWN, 'once', T.SPAWN_SETTLE);
        setTimeout(() => {
          if (opts.onSettle) { try { opts.onSettle(c); } catch (e) {} }
          layer.classList.add('fz-out');
          setTimeout(() => layer.remove(), T.SPAWN_FADE);
        }, T.SPAWN_SETTLE);
      }, creepAt);
    });
    setTimeout(() => { if (opts.onDone) opts.onDone(); }, total);
    return total;
  }

  // 독포자 연기 구름 — 칸의 대각선을 따라 흐릿한 구름 덩어리 몇 개가 시간차로 피어올라 흘러감.
  function addSmoke(layer) {
    const w = layer.offsetWidth || 56;
    for (let i = 0; i < T.SMOKE_PUFFS; i++) {
      const el = document.createElement('span');
      el.className = 'fz-smoke';
      const t = (i + 0.5) / T.SMOKE_PUFFS;
      el.style.setProperty('--x', ((t * 0.7 + 0.15) * 100 + rnd(-10, 10)).toFixed(1) + '%');
      el.style.setProperty('--y', ((t * 0.7 + 0.15) * 100 + rnd(-10, 10)).toFixed(1) + '%');
      el.style.setProperty('--s', (w * rnd(0.7, 0.95)).toFixed(1) + 'px');
      el.style.setProperty('--d', Math.round(i * T.SMOKE_GAP) + 'ms');
      el.style.setProperty('--t', Math.round(T.SWEEP_CELL - i * T.SMOKE_GAP) + 'ms');
      layer.appendChild(el);
    }
  }

  // ── 머쉬킨 페이즈 스와이프 글로우 ───────────────────────────────
  function sweep(board, fungusCells, opts) {
    opts = opts || {};
    const list = (fungusCells || []).filter(c => cellEl(board, c))
      .slice().sort((a, b) => ((a.col + a.row) - (b.col + b.row)) || (a.row - b.row));
    if (!list.length) { if (opts.onDone) opts.onDone(); return 0; }
    const minDiag = list[0].col + list[0].row;
    let total = 0;
    list.forEach((c) => {
      const at = (c.col + c.row - minDiag) * T.SWEEP_STEP;
      total = Math.max(total, at + T.SWEEP_CELL);
      setTimeout(() => {
        const el = cellEl(board, c); if (!el) return;
        const layer = layerAt(board, el, 'fz-sweep');
        layer.style.setProperty('--dur', T.SWEEP_CELL + 'ms');
        layer.innerHTML = '<div class="fz-glow"></div>';
        addSmoke(layer);
        addParticles(layer, T.P_SWEEP, 'once', T.SWEEP_CELL);
        setTimeout(() => { if (opts.onCellGlow) { try { opts.onCellGlow(c); } catch (e) {} } }, T.SWEEP_PEAK);
        setTimeout(() => layer.remove(), T.SWEEP_CELL);
      }, at);
    });
    setTimeout(() => { if (opts.onDone) opts.onDone(); }, total);
    return total;
  }

  // ── 진균지대 기본 아이들 ─────────────────────────────────────────
  function idle(board, fungusCells) {
    if (!board) return;
    const layer = boardLayer(board);
    const want = new Map((fungusCells || []).map(c => [`${c.col},${c.row}`, c]));
    layer.querySelectorAll(':scope > .fz-idle').forEach(box => { if (!want.has(box.dataset.k)) box.remove(); });
    for (const [k, c] of want) {
      const el = cellEl(board, c);
      let box = layer.querySelector(`:scope > .fz-idle[data-k="${k}"]`);
      if (!el) { if (box) box.remove(); continue; }
      if (!box) {
        box = document.createElement('div');
        box.className = 'fz-layer fz-idle';
        box.dataset.k = k;
        layer.insertBefore(box, layer.firstChild);   // 다른 연출 아래
        addParticles(box, T.P_IDLE, 'idle');
      }
      box.style.left = el.offsetLeft + 'px';
      box.style.top = el.offsetTop + 'px';
      box.style.width = el.offsetWidth + 'px';
      box.style.height = el.offsetHeight + 'px';
    }
    board.classList.toggle('fz-idle-on', want.size > 0);
  }

  window.FungusAnim = { spawn, sweep, idle, T };
})();
