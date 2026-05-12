// ─────────────────────────────────────────────────────────────────────────────
// 악몽 시전 — 통합 애니메이션 모듈 (v5)
//   SVG 나선형 어두운 보라 소용돌이 (느린 회전). 5가지 스타일 (A~E) 중 선택.
//   표식 인디케이터/marker 사슬 떨림 유지.
//
//   animateNightmareCast(positions, opts):
//     positions : [{ col, row }, ...]
//     opts:
//       boardId : 대상 보드 요소 id (기본 'game-board')
//       onCast : 시작 시점 콜백 (사운드)
//       simulateCellMark : preview 전용 — 🎯 cell-mark 생성
//       spiralStyle : 'a' | 'b' | 'c' | 'd' | 'e' (기본 'a' — 게임 본 적용 확정)
//       opacityLevel : 1~5 (기본 3 = 0.62). 1 = 가장 옅음 (0.30), 5 = 가장 짙음 (0.95)
//
//   스타일별 나선 구성:
//     A : 2-arm 아르키메데스 나선 (클래식 갤럭시) — 6.0s/회전
//     B : 1-arm 조밀한 다중 코일 (vortex tunnel) — 8.0s (가장 느림)
//     C : 3-arm 은하 나선 — 5.5s
//     D : 1-arm 굵고 느슨한 hypnotic — 7.5s
//     E : 4-arm 풍차형 나선 — 6.5s
// ─────────────────────────────────────────────────────────────────────────────

// 어두운 보라 톤 그라데이션 — 모든 스타일 공통
const NIGHTMARE_STROKE_OUTER = '#581c87';   // 매우 어두운 보라 (외곽)
const NIGHTMARE_STROKE_MAIN  = '#7e22ce';   // 진한 보라 (메인)
const NIGHTMARE_STROKE_GLOW  = '#a855f7';   // 보라 (글로우)
const NIGHTMARE_GLOW_RGBA    = 'rgba(168, 85, 247, 0.8)';

// endR=50 으로 viewBox (-50~+50) 가득 채움 — 컨테이너 150% 확장과 결합하여 회전 시 잘림 없음.
const SPIRAL_CONFIGS = {
  a: { arms: 2, turns: 2.2, startR: 2,  endR: 50, strokeWidth: 4.0 },
  b: { arms: 1, turns: 4.0, startR: 4,  endR: 50, strokeWidth: 3.0 },
  c: { arms: 3, turns: 1.6, startR: 4,  endR: 50, strokeWidth: 3.5 },
  d: { arms: 1, turns: 2.6, startR: 3,  endR: 50, strokeWidth: 5.5 },
  e: { arms: 4, turns: 1.3, startR: 6,  endR: 50, strokeWidth: 3.0 },
};

// 단일 arm 의 폴리라인 path 문자열 생성 — 충분히 dense 한 포인트로 곡선처럼 매끄럽게.
function _spiralArmPath(turns, startR, endR, armOffsetRad) {
  const POINTS_PER_TURN = 36;
  const totalPoints = Math.max(8, Math.round(POINTS_PER_TURN * turns));
  let d = '';
  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    const theta = t * turns * 2 * Math.PI + armOffsetRad;
    const r = startR + (endR - startR) * t;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    d += (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
  }
  return d.trim();
}

function _buildSpiralSVG(style) {
  const cfg = SPIRAL_CONFIGS[style] || SPIRAL_CONFIGS.a;
  const armOffsets = [];
  for (let i = 0; i < cfg.arms; i++) {
    armOffsets.push((2 * Math.PI * i) / cfg.arms);
  }
  // 각 arm 을 어두운 외곽선 + 메인 + 글로우 3겹으로 그려 깊이감.
  const pathStrings = armOffsets.map(off => _spiralArmPath(cfg.turns, cfg.startR, cfg.endR, off));
  const outerStrokes = pathStrings.map(d => `<path d="${d}" stroke="${NIGHTMARE_STROKE_OUTER}" stroke-width="${cfg.strokeWidth + 2.5}" stroke-opacity="0.55"/>`).join('');
  const mainStrokes  = pathStrings.map(d => `<path d="${d}" stroke="${NIGHTMARE_STROKE_MAIN}"  stroke-width="${cfg.strokeWidth}" stroke-opacity="0.95"/>`).join('');
  const glowStrokes  = pathStrings.map(d => `<path d="${d}" stroke="${NIGHTMARE_STROKE_GLOW}"  stroke-width="${Math.max(1, cfg.strokeWidth - 2)}" stroke-opacity="0.9"/>`).join('');
  // viewBox 살짝 확장 (-55~+55, 110×110) → endR=50 의 외곽선 (strokeWidth/2) 까지 잘림 없이 표시.
  return `<svg viewBox="-55 -55 110 110" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 3px ${NIGHTMARE_GLOW_RGBA});">
      ${outerStrokes}
      ${mainStrokes}
      ${glowStrokes}
    </g>
  </svg>`;
}

// data:image/svg+xml URI 생성 — CSS background-image var 로 주입.
function _buildSpiralDataURI(style) {
  const svg = _buildSpiralSVG(style);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function animateNightmareCast(positions, opts) {
  opts = opts || {};
  const boardId = opts.boardId || 'game-board';
  const spiralStyle = (opts.spiralStyle || 'a').toLowerCase();
  const styleKey = SPIRAL_CONFIGS[spiralStyle] ? spiralStyle : 'a';
  // 오퍼시티 1~5 (★ 사용자 확정: 기본 2 = 0.45). 범위 밖이면 2로 클램프.
  let opacityLevel = parseInt(opts.opacityLevel, 10);
  if (!(opacityLevel >= 1 && opacityLevel <= 5)) opacityLevel = 2;
  const opacityClass = `opt-${opacityLevel}`;
  const board = document.getElementById(boardId);
  if (!board) return;
  const list = (Array.isArray(positions) ? positions : [positions]).filter(p => p && p.col != null && p.row != null);
  if (list.length === 0) return;

  if (typeof opts.onCast === 'function') {
    try { opts.onCast(); } catch (e) {}
  }

  // 보드 안개
  const fog = document.createElement('div');
  fog.className = 'nightmare-board-fog';
  board.appendChild(fog);
  setTimeout(() => { try { fog.remove(); } catch (e) {} }, 2400);

  // SVG → data URI 한 번만 빌드 (style 마다 동일).
  const dataUri = _buildSpiralDataURI(styleKey);
  const bgValue = `url("${dataUri}")`;
  const styleClass = `style-${styleKey}`;

  list.forEach(({ col, row }) => {
    const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
    if (!cell) return;
    try { if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative'; } catch (e) {}

    // cell-mark 확보
    let mark = cell.querySelector('.cell-mark');
    if (!mark && opts.simulateCellMark) {
      mark = document.createElement('span');
      mark.className = 'cell-mark';
      mark.textContent = '🎯';
      cell.appendChild(mark);
    }
    if (mark) {
      mark.classList.remove('nightmare-chained');
      void mark.offsetWidth;
      mark.classList.add('nightmare-chained');
    }
    const marker = cell.querySelector('.piece-marker');
    if (marker) {
      marker.classList.remove('nightmare-tremble');
      void marker.offsetWidth;
      marker.classList.add('nightmare-tremble');
    }
    // ★ ::after 가 SVG 를 표시 — CSS var 로 data URI 전달. 오퍼시티 class 도 부여.
    cell.style.setProperty('--nightmare-spiral-bg', bgValue);
    cell.classList.add('nightmare-spiral-host', styleClass, opacityClass);

    setTimeout(() => {
      if (mark) {
        mark.classList.remove('nightmare-chained');
        mark.classList.add('nightmare-impact-flash');
        setTimeout(() => mark.classList.remove('nightmare-impact-flash'), 550);
      }
      if (marker) marker.classList.remove('nightmare-tremble');
      cell.classList.remove('nightmare-spiral-host', styleClass, opacityClass);
      cell.style.removeProperty('--nightmare-spiral-bg');
    }, 2400);
  });
}
