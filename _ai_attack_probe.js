// AI 공격 명중률 vs 사거리 내 믿음(best) — 최적 공격 임계값 도출
require('dotenv').config();
const supa = require('./supabase-admin');
const S = require('./server.js');
const getAttackCells = S.getAttackCells;

(async () => {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await supa.admin.from('match_log')
      .select('mode, result, replay').eq('mode', '1v1')
      .order('created_at', { ascending: false }).range(from, from + 199);
    if (error) { console.error(error.message); break; }
    all = all.concat(data || []);
    if (!data || data.length < 200) break; from += 200;
  }

  // 버킷: best(0~10) 구간별 [공격횟수, 명중횟수, 사거리내실제적있음]
  const buckets = {};   // key = floor(best) → {n, hit, hadEnemy}
  const B = (k) => (buckets[k] = buckets[k] || { n: 0, hit: 0, hadEnemy: 0 });

  for (const g of all) {
    const rep = g.replay || {}; const turns = rep.turns || [];
    const aiIdx = (rep.aiIdxs && rep.aiIdxs.length) ? rep.aiIdxs[0] : 1;
    const humanIdx = aiIdx === 0 ? 1 : 0;
    for (const tr of turns) {
      const pm = tr.belief && tr.belief.probMap;
      const board = tr.board && tr.board.pieces;
      const bounds = tr.board && tr.board.bounds;
      if (!pm || !board || !bounds || tr.idx !== aiIdx) continue;
      const acts = tr.actions || [];
      const ev = tr.events || [];
      const didHit = ev.some(e => e && e.ai === aiIdx && e.dmg > 0);
      for (const a of acts) {
        if (!a || a.decide !== 'attack') continue;
        const pc = board.find(p => p.idx === aiIdx && p.pi === a.pi);
        if (!pc || pc.c == null) continue;
        let cells;
        try { cells = getAttackCells(pc.type, pc.c, pc.r, bounds, {}); } catch (e) { continue; }
        if (!cells || !cells.length) continue;
        let best = 0, hadEnemy = false;
        for (const c of cells) {
          const v = (pm[c.row] && typeof pm[c.row][c.col] === 'number') ? pm[c.row][c.col] : 0;
          if (v > best) best = v;
          if (board.some(p => p.idx === humanIdx && p.alive && p.c === c.col && p.r === c.row)) hadEnemy = true;
        }
        const k = Math.min(10, Math.floor(best));
        const b = B(k); b.n++; if (didHit) b.hit++; if (hadEnemy) b.hadEnemy++;
      }
    }
  }

  console.log('공격 유닛 사거리 내 최대믿음(best) 구간별 — 명중률 / 실제 적 존재율');
  console.log('best  | 공격수 | 명중률 | 사거리내실제적');
  let cumN = 0, cumHit = 0;
  for (let k = 10; k >= 0; k--) {
    const b = buckets[k]; if (!b) continue;
    console.log(`  ${k}~${k+1} | ${String(b.n).padStart(5)} | ${(100*b.hit/b.n).toFixed(0).padStart(3)}% | ${(100*b.hadEnemy/b.n).toFixed(0)}%`);
  }
  // 누적: best>=T 로 공격 게이트했을 때의 명중률/커버리지
  console.log('\n임계값 T 이상만 공격 시:');
  for (const T of [3,4,5,6,7]) {
    let n=0,hit=0; for(let k=10;k>=T;k--){const b=buckets[k]; if(b){n+=b.n;hit+=b.hit;}}
    const total=Object.values(buckets).reduce((s,b)=>s+b.n,0);
    console.log(`  best>=${T}: 명중률 ${(100*hit/(n||1)).toFixed(0)}% · 유지 공격수 ${n}/${total}(${(100*n/total).toFixed(0)}%)`);
  }
})();
