// ── CALIGO 2v2 팀전 4-AI 헤드리스 자가대국 하니스 ───────────────────────────
//   server.js 를 require(리스닝 안 함)하여 팀 AI 로직을 4명 모두 AI 로 구동.
//   목적: 최근 변경(질주 루프·공격 페이즈·도주·AI공격 알림)이 크래시/무한루프/턴꼬임 없이
//         게임을 끝까지 완주하는지 검증 + 1v1 대비 처리 차이 보고.
//   사용: node team-selfplay.js [games]
'use strict';
const S = require('./server.js');
const { createRoom, createPiece, getTeamBrain, aiTeamTakeTurn, endTurn, rooms, CHARACTERS } = S;

// 안전 캐릭터 풀 (특수/광역 포함 — 페이즈/스킬 경로를 적극 자극).
const POOL = {
  1: ['spearman', 'cavalry', 'archer', 'watchman', 'scout', 'manhunter', 'herbalist', 'gunpowder', 'messenger'],
  2: ['general', 'knight', 'wizard', 'armoredWarrior', 'weaponSmith', 'bodyguard', 'dualBlade', 'ratMerchant'],
  3: ['prince', 'princess', 'monk', 'commander', 'count', 'slaughterHero', 'torturer', 'sulfurCauldron'],
};
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function buildPlayer(index, teamId) {
  const deck = { t1: rnd(POOL[1]), t2: rnd(POOL[2]), t3: rnd(POOL[3]) };
  const hps = [4, 3, 3];
  const pieces = [createPiece(deck.t1, 1, hps[0]), createPiece(deck.t2, 2, hps[1]), createPiece(deck.t3, 3, hps[2])].filter(Boolean);
  return {
    socketId: 'AI', name: `${teamId === 0 ? 'BLUE' : 'RED'}-${index}`, index, teamId,
    pieces, draft: deck, hpDist: hps,
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    slotPos: 0, alive: true,
  };
}

function makeGame() {
  const room = createRoom('tl-' + Math.random().toString(36).slice(2, 8), { mode: 'team' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 1; room.currentPlayerIdx = 0; room.turnSlotIdx = 0;
  // 4 플레이어: idx 0,1 = team0(blue) / idx 2,3 = team1(red)
  room.players = [buildPlayer(0, 0), buildPlayer(1, 0), buildPlayer(2, 1), buildPlayer(3, 1)];
  room.teams = [[0, 1], [2, 3]];
  // slotPos (팀 내 순서)
  room.players[0].slotPos = 0; room.players[1].slotPos = 1;
  room.players[2].slotPos = 0; room.players[3].slotPos = 1;

  // 배치 — 7x7 전체에서 겹침 없이 무작위 (12말).
  const b = room.boardBounds, all = [];
  for (let r = b.min; r <= b.max; r++) for (let c = b.min; c <= b.max; c++) all.push([c, r]);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  let k = 0;
  for (const p of room.players) p.pieces.forEach(pc => { const [c, r] = all[k++]; pc.col = c; pc.row = r; });

  rooms[room.id] = room;
  getTeamBrain(room, 0); getTeamBrain(room, 1);
  return room;
}

function teamAlive(room, t) {
  return room.teams[t].reduce((s, idx) => s + room.players[idx].pieces.filter(p => p.alive).length, 0);
}

function playOneGame(verbose) {
  const room = makeGame();
  const issues = [];
  let guard = 0;
  const MAX = 600;          // 턴 상한 (무한루프 감지)
  let perTurnReentry = 0;    // 한 턴 내 aiTeamTakeTurn 재진입 누적 (루프 감지)
  let lastTurn = -1, lastCur = -1, sameStateCount = 0;

  while (room.phase === 'game' && guard++ < MAX) {
    const idx = room.currentPlayerIdx;
    const beforeT = room.turnNumber, beforeC = room.currentPlayerIdx;

    // 무한루프 감지 — 같은 (turn,player) 가 연속 반복되면 stuck.
    if (beforeT === lastTurn && beforeC === lastCur) {
      sameStateCount++;
      if (sameStateCount > 4) { issues.push(`STUCK at turn ${beforeT} player ${beforeC} (no advance)`); break; }
    } else { sameStateCount = 0; lastTurn = beforeT; lastCur = beforeC; }

    try {
      aiTeamTakeTurn(room, idx);
    } catch (e) {
      issues.push(`CRASH turn ${beforeT} player ${idx}: ${e.message}\n${(e.stack||'').split('\n').slice(1,4).join('\n')}`);
      break;
    }

    // 승부 판정 (직접)
    const a0 = teamAlive(room, 0), a1 = teamAlive(room, 1);
    if (a0 === 0 || a1 === 0) { room.phase = 'ended'; break; }

    // 턴이 동기적으로 안 넘어갔으면(드물게 deferred) 강제 진행.
    if (room.phase === 'game' && room.currentPlayerIdx === beforeC && room.turnNumber === beforeT) {
      const p = room.players[beforeC];
      if (!p.actionDone) p.actionDone = true;
      try { endTurn(room); } catch (e) { issues.push(`endTurn CRASH: ${e.message}`); break; }
    }
  }
  if (guard >= MAX) issues.push(`TURN-CAP reached (${MAX}) — 미완주(무한 진행 의심)`);

  const a0 = teamAlive(room, 0), a1 = teamAlive(room, 1);
  let winner;
  if (a0 > 0 && a1 === 0) winner = 0;
  else if (a1 > 0 && a0 === 0) winner = 1;
  else if (a0 === 0 && a1 === 0) winner = 'draw';
  else winner = 'cap';
  const turns = room.turnNumber;
  delete rooms[room.id];
  return { winner, turns, a0, a1, issues };
}

// ── 실행 ──
const N = parseInt(process.argv[2], 10) || 50;
const verbose = process.argv.includes('--verbose');
const stat = { 0: 0, 1: 0, draw: 0, cap: 0 };
const allIssues = [];
let totalTurns = 0;
const t0 = Date.now();
// 미처리 예외/거부도 포착
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e.message); });

for (let g = 0; g < N; g++) {
  const r = playOneGame(verbose);
  stat[r.winner]++;
  totalTurns += r.turns;
  if (r.issues.length > 0) {
    for (const iss of r.issues) allIssues.push(`[game ${g + 1}] ${iss}`);
  }
  if (verbose) console.log(`game ${g + 1}: winner=${r.winner} turns=${r.turns} alive[${r.a0},${r.a1}] issues=${r.issues.length}`);
}
const ms = Date.now() - t0;
console.log(`\n=== 2v2 팀전 4-AI 자가대국 ${N}판 (${ms}ms, ${(N / (ms / 1000)).toFixed(1)} games/s, avg ${(totalTurns / N).toFixed(1)} turns) ===`);
console.log(`승: 팀0=${stat[0]}  팀1=${stat[1]}  무승부=${stat.draw}  턴상한(미완주)=${stat.cap}`);
console.log(`이슈 총 ${allIssues.length}건`);
const uniq = {};
for (const iss of allIssues) { const key = iss.replace(/turn \d+|player \d+|game \d+/g, '#'); uniq[key] = (uniq[key] || 0) + 1; }
const sorted = Object.entries(uniq).sort((a, b) => b[1] - a[1]);
for (const [key, cnt] of sorted.slice(0, 15)) console.log(`  ×${cnt}  ${key.split('\n')[0].slice(0, 160)}`);
process.exit(0);
