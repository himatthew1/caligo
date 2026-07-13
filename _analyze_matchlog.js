// AI 대국 로그 분석 — match_log(Supabase) 조회 → belief 정확도·결정 패턴·승패 진단.
require('dotenv').config({ path: '.env' });
const { admin, enabled } = require('./supabase-admin');

(async () => {
  if (!enabled()) { console.log('admin 비활성 — .env 키 확인'); process.exit(1); }
  const { data, error } = await admin.from('match_log')
    .select('id, mode, result, turns, created_at, replay')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { console.log('쿼리 오류:', error.message); process.exit(1); }
  console.log(`총 ${data.length}판 로드`);

  // 결과/모드 분포
  const byMode = {}, byResult = {};
  for (const m of data) { byMode[m.mode] = (byMode[m.mode]||0)+1; byResult[m.result] = (byResult[m.result]||0)+1; }
  console.log('모드:', JSON.stringify(byMode));
  console.log('결과:', JSON.stringify(byResult));

  // vs-AI 1v1 만 추림
  const games = data.filter(m => m.mode === '1v1' && m.replay && Array.isArray(m.replay.turns));
  console.log(`\n=== vs-AI 1v1 ${games.length}판 심층 분석 ===`);
  const wins = games.filter(g=>g.result==='ai_win').length, losses = games.filter(g=>g.result==='ai_loss').length, draws = games.filter(g=>g.result==='draw').length;
  console.log(`AI 승 ${wins} / 패 ${losses} / 무 ${draws}  (승률 ${(wins/(wins+losses||1)*100).toFixed(1)}%)`);
  console.log(`평균 턴수: ${(games.reduce((s,g)=>s+(g.turns||0),0)/(games.length||1)).toFixed(1)}`);

  // belief 정확도 + 결정 패턴 (AI 턴만)
  let beliefSum=0, beliefN=0;
  const decideCount={}; let sureHitButMoved=0, sureHitTotal=0, totalAiTurns=0;
  for (const g of games) {
    const aiIdxs = g.replay.aiIdxs || [];
    for (const t of g.replay.turns) {
      if (!aiIdxs.includes(t.idx)) continue;   // AI 턴만
      totalAiTurns++;
      // belief 정확도: 살아있는 적 실위치의 probMap 값 평균
      if (t.belief && t.belief.probMap && t.board && t.board.pieces) {
        const enemies = t.board.pieces.filter(p => p.alive && !aiIdxs.includes(p.idx));
        if (enemies.length) {
          let s=0,n=0; for (const e of enemies) { const row=t.belief.probMap[e.r]; if(row && typeof row[e.c]==='number'){s+=row[e.c];n++;} }
          if (n){ beliefSum += s/n; beliefN++; }
        }
      }
      // 결정 패턴
      for (const a of (t.actions||[])) {
        if (a.decide) decideCount[a.decide]=(decideCount[a.decide]||0)+1;
        if (a.sureHit !== undefined) { sureHitTotal++; if (a.sureHit && a.decide==='move') sureHitButMoved++; }
      }
    }
  }
  console.log(`\nbelief 정확도(실적칸 평균확률, ↑=추론정확): ${(beliefSum/(beliefN||1)).toFixed(3)}  (표본 ${beliefN}턴)`);
  console.log(`AI 결정 분포:`, JSON.stringify(decideCount));
  console.log(`확실타격 가능했는데 이동 선택: ${sureHitButMoved}/${sureHitTotal}`);
  console.log(`총 AI 턴: ${totalAiTurns}`);

  // 인간 덱 빈도 (어떤 조합에 지나)
  const humanDeckFreq={};
  for (const g of games) {
    const aiIdxs=g.replay.aiIdxs||[]; const last=g.replay.turns[g.replay.turns.length-1];
    const ht=[...new Set(last.board.pieces.filter(p=>!aiIdxs.includes(p.idx)).map(p=>p.type))].sort().join('+');
    if(!humanDeckFreq[ht]) humanDeckFreq[ht]={w:0,l:0};
    if(g.result==='ai_win')humanDeckFreq[ht].w++; else if(g.result==='ai_loss')humanDeckFreq[ht].l++;
  }
  console.log('\n=== 인간 덱별 AI 전적 ===');
  Object.entries(humanDeckFreq).sort((a,b)=>(b[1].w+b[1].l)-(a[1].w+a[1].l)).forEach(([d,r])=>console.log(`  [${d}]  AI ${r.w}승 ${r.l}패`));

  // 특정 매치업(철통보안)에서 AI 덱별 승패 — 이긴 조합을 카운터픽에 반영
  const TARGET = 'bodyguard+commander+watchman';
  console.log(`\n=== [${TARGET}] 상대 AI 덱별 전적 ===`);
  const aiDeckVs = {};
  for (const g of games) {
    const aiIdxs=g.replay.aiIdxs||[]; const last=g.replay.turns[g.replay.turns.length-1];
    const ht=[...new Set(last.board.pieces.filter(p=>!aiIdxs.includes(p.idx)).map(p=>p.type))].sort().join('+');
    if (ht!==TARGET) continue;
    const at=[...new Set(last.board.pieces.filter(p=>aiIdxs.includes(p.idx)).map(p=>p.type))].sort().join('+');
    if(!aiDeckVs[at]) aiDeckVs[at]={w:0,l:0};
    if(g.result==='ai_win')aiDeckVs[at].w++; else if(g.result==='ai_loss')aiDeckVs[at].l++;
  }
  Object.entries(aiDeckVs).sort((a,b)=>(b[1].w-b[1].l)-(a[1].w-a[1].l)).forEach(([d,r])=>console.log(`  AI[${d}] ${r.w}승 ${r.l}패`));

  // 패배 동역학: 힐 감지 + AI 처치수 + 집중사격
  console.log('\n=== 패배 동역학 (힐 vs 처치) ===');
  let totHealEvents=0, totKills=0, gamesNoKill=0, lossN=0;
  for (const g of games.filter(g=>g.result==='ai_loss')) {
    lossN++;
    const aiIdxs=g.replay.aiIdxs||[];
    // 적(인간) 말별 HP 추이 — 증가하면 힐
    const hpTrace={}; // key idx:pi → [hp...]
    let healEvents=0, kills=0;
    let prevAliveEnemies=null;
    for (const t of g.replay.turns) {
      const enemies=t.board.pieces.filter(p=>!aiIdxs.includes(p.idx));
      for (const e of enemies) { const k=`${e.idx}:${e.pi}`; if(!hpTrace[k])hpTrace[k]=[]; hpTrace[k].push(e.hp); }
      const aliveCnt=enemies.filter(e=>e.alive).length;
      if(prevAliveEnemies!=null && aliveCnt<prevAliveEnemies) kills+=(prevAliveEnemies-aliveCnt);
      prevAliveEnemies=aliveCnt;
    }
    for (const k in hpTrace){ const h=hpTrace[k]; for(let i=1;i<h.length;i++) if(h[i]>h[i-1]) healEvents++; }
    totHealEvents+=healEvents; totKills+=kills; if(kills===0)gamesNoKill++;
  }
  console.log(`패배 ${lossN}판: 평균 적 처치 ${(totKills/lossN).toFixed(2)}마리 | 적 1마리도 못 죽인 판 ${gamesNoKill}/${lossN} | 평균 힐이벤트 ${(totHealEvents/lossN).toFixed(1)}회`);

  // 패배 샘플 상세
  const lossGames = games.filter(g=>g.result==='ai_loss').slice(0,3);
  console.log(`\n=== 패배 샘플 ${lossGames.length}판 ===`);
  for (const g of lossGames) {
    const lastTurn = g.replay.turns[g.replay.turns.length-1];
    const aiIdxs = g.replay.aiIdxs||[];
    const aiAlive = lastTurn.board.pieces.filter(p=>aiIdxs.includes(p.idx)&&p.alive).length;
    const humanAlive = lastTurn.board.pieces.filter(p=>!aiIdxs.includes(p.idx)&&p.alive).length;
    const aiTypes = lastTurn.board.pieces.filter(p=>aiIdxs.includes(p.idx)).map(p=>p.type);
    const humanTypes = lastTurn.board.pieces.filter(p=>!aiIdxs.includes(p.idx)).map(p=>p.type);
    console.log(`  ${g.turns}턴 패배 | AI생존 ${aiAlive} vs 인간생존 ${humanAlive} | AI덱[${aiTypes}] vs 인간덱[${humanTypes}]`);
  }
})();
