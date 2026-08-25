// AI 패배 분석 — match_log 리플레이 집계 (읽기 전용)
require('dotenv').config();
const supa = require('./supabase-admin');

function isAiIdx(rep, idx) { return Array.isArray(rep.aiIdxs) && rep.aiIdxs.includes(idx); }

(async () => {
  // 전체 페이지네이션 fetch
  let all = [], from = 0;
  while (true) {
    const { data, error } = await supa.admin.from('match_log')
      .select('mode, result, turns, replay, created_at')
      .order('created_at', { ascending: false }).range(from, from + 199);
    if (error) { console.error(error.message); break; }
    all = all.concat(data || []);
    if (!data || data.length < 200) break;
    from += 200;
  }
  console.log('총 대국:', all.length);

  const only1v1 = all.filter(g => g.mode === '1v1');
  console.log('1v1:', only1v1.length, '| team:', all.filter(g => g.mode === 'team').length);

  // ── 집계 누산기 ──
  let aiWin = 0, aiLoss = 0, other = 0;
  let winTurns = [], lossTurns = [];
  // 믿음 정확도
  let beliefSamples = 0, beliefAtEnemySum = 0, knewEnemyTurns = 0, beliefTurns = 0;
  // 공격 효율
  let atkDecided = 0, atkHitEnemy = 0;
  // 데미지 수지
  let dmgOut = 0, dmgIn = 0;
  // 덱 성적 (AI 덱 조합)
  const deckRec = {};   // key= t1|t2|t3 → {w,l}
  // 패배 시 AI 첫 유닛 사망 턴
  let firstDeathTurns = [];

  for (const g of only1v1) {
    const rep = g.replay || {}; const turns = rep.turns || [];
    if (!turns.length) continue;
    const aiIdx = (Array.isArray(rep.aiIdxs) && rep.aiIdxs.length) ? rep.aiIdxs[0] : 1;
    const humanIdx = aiIdx === 0 ? 1 : 0;
    const isWin = g.result === 'ai_win';
    const isLoss = g.result === 'ai_loss';
    if (isWin) aiWin++; else if (isLoss) aiLoss++; else { other++; }
    if (isWin) winTurns.push(g.turns); if (isLoss) lossTurns.push(g.turns);

    // AI 덱 (replay.players[aiIdx].deck 또는 board 첫 스냅샷의 AI 유닛 type)
    let deckKey = null;
    try {
      const first = turns.find(t => t.board && t.board.pieces);
      if (first) {
        const aiTypes = first.board.pieces.filter(p => p.idx === aiIdx).map(p => p.type).sort();
        deckKey = aiTypes.join('|');
      }
    } catch (e) {}
    if (deckKey) { deckRec[deckKey] = deckRec[deckKey] || { w: 0, l: 0 }; if (isWin) deckRec[deckKey].w++; else if (isLoss) deckRec[deckKey].l++; }

    let firstDeath = null;
    for (const tr of turns) {
      const pm = tr.belief && tr.belief.probMap;
      const board = tr.board && tr.board.pieces;
      if (!board) continue;

      // AI 유닛 첫 사망 턴
      if (firstDeath == null) {
        const aiDead = board.some(p => p.idx === aiIdx && !p.alive);
        if (aiDead) firstDeath = tr.t;
      }

      // 믿음 정확도 (AI 턴만: belief 있음) — 숨은 적(비표식) 실제 위치의 probMap 값
      if (pm && isAiIdx(rep, tr.idx)) {
        beliefTurns++;
        const enemies = board.filter(p => p.idx === humanIdx && p.alive);
        let turnKnew = false, sum = 0, n = 0;
        for (const e of enemies) {
          const v = (pm[e.r] && typeof pm[e.r][e.c] === 'number') ? pm[e.r][e.c] : 0;
          sum += v; n++;
          if (v >= 6) turnKnew = true;   // 강한 믿음(공격 트리거 임계) 이상이면 "안다"
        }
        if (n > 0) { beliefAtEnemySum += sum / n; beliefSamples++; }
        if (turnKnew) knewEnemyTurns++;
      }

      // 공격 결정 vs 명중 (actions decide=attack, events 로 실제 적 피해 확인)
      const acts = tr.actions || [];
      const decidedAtk = acts.some(a => a && a.decide === 'attack');
      if (isAiIdx(rep, tr.idx) && decidedAtk) {
        atkDecided++;
        const ev = tr.events || [];
        // AI(ai===aiIdx)가 인간 유닛에게 dmg>0 준 이벤트가 있으면 명중
        if (ev.some(e => e && e.ai === aiIdx && e.dmg > 0)) atkHitEnemy++;
      }

      // 데미지 수지 (events 전체)
      for (const e of (tr.events || [])) {
        if (!e || !(e.dmg > 0)) continue;
        if (e.ai === aiIdx) dmgOut += e.dmg; else if (e.ai === humanIdx) dmgIn += e.dmg;
      }
    }
    if (isLoss && firstDeath != null) firstDeathTurns.push(firstDeath);
  }

  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';

  console.log('\n═══ AI 성적 ═══');
  console.log(`AI 승 ${aiWin} / 패 ${aiLoss} / 기타 ${other} → 승률 ${pct(aiWin, aiWin + aiLoss)}`);
  console.log(`평균 턴 — 승리 ${avg(winTurns).toFixed(1)} / 패배 ${avg(lossTurns).toFixed(1)}`);
  console.log(`패배 시 AI 첫 유닛 사망 평균 턴: ${avg(firstDeathTurns).toFixed(1)} (n=${firstDeathTurns.length})`);

  console.log('\n═══ 믿음(belief) 정확도 ═══');
  console.log(`실제 숨은 적 위치의 평균 probMap 값(0~10): ${(beliefAtEnemySum / (beliefSamples || 1)).toFixed(2)} (n=${beliefSamples})`);
  console.log(`AI 턴 중 "적을 안다"(적어도 1적 probMap≥6) 비율: ${pct(knewEnemyTurns, beliefTurns)} (${knewEnemyTurns}/${beliefTurns})`);

  console.log('\n═══ 공격 효율 ═══');
  console.log(`공격 결정 턴 ${atkDecided} 중 실제 적 명중 ${atkHitEnemy} → 명중률 ${pct(atkHitEnemy, atkDecided)}`);
  console.log(`(=blind 헛공격 ${atkDecided - atkHitEnemy}회, ${pct(atkDecided - atkHitEnemy, atkDecided)})`);

  console.log('\n═══ 데미지 수지 ═══');
  console.log(`AI 가한 피해 ${dmgOut.toFixed(1)} / 받은 피해 ${dmgIn.toFixed(1)} → 수지비 ${(dmgOut / (dmgIn || 1)).toFixed(2)}`);

  console.log('\n═══ AI 덱 성적 (승-패, 5판+ 만) ═══');
  Object.entries(deckRec).filter(([, v]) => v.w + v.l >= 5)
    .sort((a, b) => (b[1].w / (b[1].w + b[1].l)) - (a[1].w / (a[1].w + a[1].l)))
    .forEach(([k, v]) => console.log(`  ${(v.w / (v.w + v.l) * 100).toFixed(0)}% (${v.w}승 ${v.l}패)  ${k}`));
})();
