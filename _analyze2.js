// 심층 AI 약점 분석 — replay 턴 단위로 공격 효율·HP 침식·표식 미교전·패배원인 파헤침.
require('dotenv').config({ path: '.env' });
const { admin, enabled } = require('./supabase-admin');

(async () => {
  if (!enabled()) { console.log('admin 비활성'); process.exit(1); }
  const { data, error } = await admin.from('match_log')
    .select('mode, result, turns, replay').order('created_at', { ascending: false }).limit(500);
  if (error) { console.log('쿼리 오류:', error.message); process.exit(1); }
  const games = data.filter(m => m.mode === '1v1' && m.replay && Array.isArray(m.replay.turns));
  console.log(`vs-AI 1v1 ${games.length}판 심층 분석\n`);

  const atCell = (pieces, aiIdxs, mine) => pieces.filter(p => mine ? aiIdxs.includes(p.idx) : !aiIdxs.includes(p.idx));
  const hp = (pieces, aiIdxs, mine) => atCell(pieces, aiIdxs, mine).filter(p => p.alive).reduce((s, p) => s + (p.hp || 0), 0);

  // ── 1) 패배 원인 분포 ──
  const reasonCnt = {};
  for (const g of games.filter(g => g.result === 'ai_loss')) {
    const r = g.replay.reason || 'unknown'; reasonCnt[r] = (reasonCnt[r] || 0) + 1;
  }
  console.log('패배 원인:', JSON.stringify(reasonCnt));

  // ── 2) AI 공격 효율 (다음 AI 턴 대비 적 총HP 감소 = 명중) ──
  //   블라인드 공격이 얼마나 헛방인가.
  let atkTot = 0, atkHit = 0;
  // ── 3) HP 침식 — 패배판에서 AI 총HP 곡선의 하락이 "여러 작은 스텝(축적)" vs "큰 폭발" ──
  let chipSteps = 0, burstSteps = 0, totLossHpDrops = 0;
  // ── 4) 표식적 미교전 — AI 턴에 표식 적(st에 mark)이 있는데 그 턴에 attack 결정을 안 함 ──
  let markedTurns = 0, markedNoAttack = 0;
  // ── 5) 결정 분포: 승리판 vs 패배판 ──
  const decWin = {}, decLoss = {};

  for (const g of games) {
    const aiIdxs = g.replay.aiIdxs || [];
    const turns = g.replay.turns;
    const isLoss = g.result === 'ai_loss';
    const decMap = isLoss ? decLoss : decWin;

    // AI 턴만 순서대로
    const aiTurns = turns.filter(t => aiIdxs.includes(t.idx));
    for (let i = 0; i < aiTurns.length; i++) {
      const t = aiTurns[i];
      const acts = t.actions || [];
      for (const a of acts) if (a.decide) decMap[a.decide] = (decMap[a.decide] || 0) + 1;

      // 공격 효율: 이 턴에 attack 결정 → 다음 AI 턴의 적 총HP 와 비교
      const attacked = acts.some(a => a.decide === 'attack' || a.decide === 'counter');
      if (attacked && t.board && aiTurns[i + 1] && aiTurns[i + 1].board) {
        atkTot++;
        const eHpNow = hp(t.board.pieces, aiIdxs, false);
        const eHpNext = hp(aiTurns[i + 1].board.pieces, aiIdxs, false);
        if (eHpNext < eHpNow) atkHit++;
      }
      // 표식적 미교전
      if (t.board) {
        const markedEnemies = atCell(t.board.pieces, aiIdxs, false)
          .filter(p => p.alive && Array.isArray(p.st) && p.st.some(s => s === 'mark' || (s && s.type === 'mark')));
        if (markedEnemies.length) {
          markedTurns++;
          if (!attacked) markedNoAttack++;
        }
      }
    }

    // HP 침식(패배판)
    if (isLoss) {
      let prev = null;
      for (const t of aiTurns) {
        if (!t.board) continue;
        const cur = hp(t.board.pieces, aiIdxs, true);
        if (prev != null && cur < prev) {
          const drop = prev - cur; totLossHpDrops += drop;
          if (drop <= 1) chipSteps++; else burstSteps++;
        }
        prev = cur;
      }
    }
  }

  console.log(`\n공격 효율(다음 AI턴 적HP 감소=명중): ${atkHit}/${atkTot} = ${(atkHit/(atkTot||1)*100).toFixed(1)}%  (블라인드 헛방 = ${(100-atkHit/(atkTot||1)*100).toFixed(1)}%)`);
  console.log(`\nHP 침식(패배판): chip(≤1) ${chipSteps}회 vs burst(>1) ${burstSteps}회 | 총 하락 ${totLossHpDrops}`);
  console.log(`  → chip 비중 ${(chipSteps/((chipSteps+burstSteps)||1)*100).toFixed(0)}% (높을수록 "가랑비" 축적사)`);
  console.log(`\n표식적 존재 턴 ${markedTurns} 중 그 턴 공격 안 함: ${markedNoAttack} (${(markedNoAttack/(markedTurns||1)*100).toFixed(0)}%)`);
  console.log(`\n결정분포 — 승리판:`, JSON.stringify(decWin), `\n         패배판:`, JSON.stringify(decLoss));

  // ── 6) 패배판: AI 마지막 생존 vs 인간 생존 (얼마나 크게 짐) ──
  let closeLoss = 0, blowout = 0;
  for (const g of games.filter(g => g.result === 'ai_loss')) {
    const last = g.replay.turns[g.replay.turns.length - 1];
    if (!last || !last.board) continue;
    const humanAlive = atCell(last.board.pieces, g.replay.aiIdxs || [], false).filter(p => p.alive).length;
    if (humanAlive >= 3) blowout++; else if (humanAlive === 1) closeLoss++;
  }
  console.log(`\n패배 규모: 인간 3말 전원생존(완패) ${blowout} / 인간 1말만 생존(접전패) ${closeLoss}`);
})();
