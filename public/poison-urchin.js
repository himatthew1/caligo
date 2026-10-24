// ★ 중독 심화 도장 — 원형 성게 말풍선 윤곽(SVG, 정원 + 등폭·등길이 가시 12개). 인게임(game.js)과 프리뷰가 공유.
//   실제 픽셀 크기(W×H) 그대로 그려 늘림 왜곡이 없다: 타원 둘레를 '호 길이' 기준으로 등분해
//   가시 밑변 폭이 모두 같고, 가시는 둘레의 법선 방향으로 같은 길이만큼 뻗는다.
(function () {
  const W = 52, H = 52;          // 도장 박스 크기(px) — CSS .dmg-stamp.poison-up 와 동일(정원)
  const SPIKES = 12;             // 가시 수 — 성기게
  const SPIKE_LEN = 4.5;         // 가시 길이(px) — 짧게
  const cx = W / 2, cy = H / 2;
  const a = cx - SPIKE_LEN - 2, b = cy - SPIKE_LEN - 2;   // 몸통 타원 반지름(테두리 여유 2px)
  // 타원 둘레를 촘촘히 샘플링해 누적 호 길이 테이블 생성
  const N = 720, pts = [], acc = [0];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push(t);
    if (i > 0) {
      const t0 = pts[i - 1];
      const dx = a * (Math.cos(t) - Math.cos(t0)), dy = b * (Math.sin(t) - Math.sin(t0));
      acc.push(acc[i - 1] + Math.hypot(dx, dy));
    }
  }
  const P = acc[N];
  const tAt = (len) => {   // 호 길이 → 매개변수 t
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] < len) lo = m; else hi = m; }
    const f = (len - acc[lo]) / ((acc[hi] - acc[lo]) || 1);
    return pts[lo] + (pts[hi] - pts[lo]) * f;
  };
  let d = '';
  for (let k = 0; k < SPIKES * 2; k++) {
    const t = tAt((k / (SPIKES * 2)) * P);
    let x = cx + a * Math.cos(t), y = cy + b * Math.sin(t);
    if (k % 2 === 1) {   // 가시 끝 — 바깥 법선 방향으로 SPIKE_LEN
      const nx = b * Math.cos(t), ny = a * Math.sin(t), nl = Math.hypot(nx, ny) || 1;
      x += (nx / nl) * SPIKE_LEN; y += (ny / nl) * SPIKE_LEN;
    }
    d += (k ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  d += 'Z';
  window.POISON_URCHIN_SVG =
    `<svg class="urchin" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
    `<defs><linearGradient id="poisonUrchinFill" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#166534"/><stop offset="1" stop-color="#3f6212"/></linearGradient></defs>` +
    `<path d="${d}"/></svg>`;
})();
