// ── CALIGO AI 헤드리스 셀프플레이 하니스 ─────────────────────────────────
//   server.js 를 require (리스닝 안 함) 하여 순수 게임/AI 로직을 재사용.
//   양측을 idx-범용 aiTeamTakeTurn 으로 구동, 연출 setTimeout 은 _headless 가드로 동기화.
//   목적: 가중치 최적화(P3) / MCTS(P4) 의 토대 — "분당 수천 판" 자가대국.
//   사용: node ai-selfplay.js [games] [--verbose]
'use strict';

const S = require('./server.js');
const { createRoom, createPiece, getTeamBrain, aiTeamTakeTurn, endTurn, rooms } = S;
const CH = S.CHARACTERS;

// 1차 검증용 안전 캐릭터 풀 (특수 소환/전역 스킬 제외 — 안정화 후 전체로 확장).
const SAFE = {
  1: ['spearman', 'cavalry', 'archer', 'watchman', 'scout', 'manhunter', 'herbalist'],
  2: ['general', 'knight', 'wizard', 'armoredWarrior', 'weaponSmith', 'bodyguard', 'dualBlade'],
  3: ['prince', 'princess', 'monk', 'commander', 'count', 'slaughterHero', 'torturer'],
};
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomDeck() {
  return { t1: rnd(SAFE[1]), t2: rnd(SAFE[2]), t3: rnd(SAFE[3]) };
}

// 보드 안에서 겹치지 않게 3말 무작위 배치 좌표.
function randomPlacement(taken, bounds) {
  const cells = [];
  for (let r = bounds.min; r <= bounds.max; r++)
    for (let c = bounds.min; c <= bounds.max; c++)
      if (!taken.has(`${c},${r}`)) cells.push([c, r]);
  // shuffle
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return cells.slice(0, 3);
}

function buildPlayer(idx, deck, hps) {
  const pieces = [
    createPiece(deck.t1, 1, hps[0]),
    createPiece(deck.t2, 2, hps[1]),
    createPiece(deck.t3, 3, hps[2]),
  ].filter(Boolean);
  return {
    socketId: 'AI', name: idx === 0 ? 'BOT-A' : 'BOT-B', index: idx,
    pieces, draft: deck, hpDist: hps,
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    teamId: idx, slotPos: 0, alive: true,
  };
}

// wA/wB: 각 측 AI 가중치(override). undefined 면 서버 기본(AI_WEIGHTS).
function makeGame(wA, wB) {
  const room = createRoom('hl-' + Math.random().toString(36).slice(2, 8), { mode: 'pvp' });
  room.isAI = true;
  room._headless = true;
  room.phase = 'game';
  room.currentPlayerIdx = 0;
  room.turnNumber = 1;
  const bounds = room.boardBounds;

  room.players = [buildPlayer(0, randomDeck(), [4, 3, 3]), buildPlayer(1, randomDeck(), [4, 3, 3])];

  // 배치 — 겹침 없이 무작위 (양측 모두 보드 전체에서).
  const taken = new Set();
  for (const p of room.players) {
    const spots = randomPlacement(taken, bounds);
    p.pieces.forEach((pc, i) => { const [c, r] = spots[i]; pc.col = c; pc.row = r; taken.add(`${c},${r}`); });
  }

  rooms[room.id] = room;
  // 양측 브레인 사전 초기화 + per-side 가중치 주입.
  const bA = getTeamBrain(room, 0); if (wA) bA._weights = wA;
  const bB = getTeamBrain(room, 1); if (wB) bB._weights = wB;
  return room;
}

function aliveCount(room, idx) { return room.players[idx].pieces.filter(p => p.alive).length; }

function playOneGame(verbose, wA, wB) {
  const room = makeGame(wA, wB);
  let guard = 0;
  const MAX_TURNS = 400;
  while (room.phase === 'game' && guard++ < MAX_TURNS) {
    const idx = room.currentPlayerIdx;
    const before = room.turnNumber;
    try {
      aiTeamTakeTurn(room, idx);
    } catch (e) {
      console.error(`[turn ${room.turnNumber} p${idx}] ERROR:`, e.message);
      throw e;
    }
    // 턴이 안 넘어갔으면(행동 없음/엔진 미진행) 강제 종료해 진행.
    if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) {
      endTurn(room);
    }
    if (verbose && guard <= 12) {
      console.log(`  t${room.turnNumber} cur=${room.currentPlayerIdx} alive=[${aliveCount(room,0)},${aliveCount(room,1)}] phase=${room.phase}`);
    }
  }
  const a = aliveCount(room, 0), b = aliveCount(room, 1);
  let winner;
  if (room.phase !== 'ended') winner = 'cap';          // 턴 상한 → 무승부 처리
  else if (a > 0 && b === 0) winner = 0;
  else if (b > 0 && a === 0) winner = 1;
  else winner = 'draw';
  delete rooms[room.id];
  return { winner, turns: room.turnNumber, aliveA: a, aliveB: b,
    deckA: room.players[0].draft, deckB: room.players[1].draft };
}

// 가중치 A vs B 매치 — n판, 매 판 좌우(선/후공) 교대로 진영 편향 제거. A의 승수 반환.
function playMatch(wA, wB, n) {
  let aWins = 0, bWins = 0, draws = 0;
  for (let i = 0; i < n; i++) {
    // 짝수판: A=P0,B=P1 / 홀수판: 교대 → 선/후공 균형
    const swap = i % 2 === 1;
    const r = playOneGame(false, swap ? wB : wA, swap ? wA : wB);
    const aIdx = swap ? 1 : 0;
    if (r.winner === aIdx) aWins++;
    else if (r.winner === (1 - aIdx)) bWins++;
    else draws++;
  }
  return { aWins, bWins, draws, n };
}

module.exports = { playOneGame, playMatch, makeGame };

// require 시엔 CLI 미실행
if (require.main !== module) return;

// ── CLI ──
//   node ai-selfplay.js [games] [--verbose]      : 기본 vs 기본 셀프플레이
//   node ai-selfplay.js --match [games]          : 기본 vs 무력화(검증) 매치
if (process.argv.includes('--match')) {
  const games = parseInt(process.argv[process.argv.indexOf('--match') + 1], 10) || 200;
  const DEF = S.AI_WEIGHTS_DEFAULT;
  const CRIPPLE = { ...DEF, approachMul: 0, threatMul: 0, infoGainMul: 0, fleeBonus: 0, commanderAuraMul: 0, shrinkAvoid: 0 };
  const t0 = Date.now();
  const res = playMatch(DEF, CRIPPLE, games);
  console.log(`[검증] 기본 vs 무력화 ${games}판 (${Date.now() - t0}ms)`);
  console.log(`  기본 승: ${res.aWins}  무력화 승: ${res.bWins}  무승부: ${res.draws}`);
  console.log(`  → 가중치가 의미있으면 기본이 압도해야 함. 기본 승률 ${(res.aWins / games * 100).toFixed(1)}%`);
  process.exit(0);
}

// ── 실행 (기본 셀프플레이) ──
const N = parseInt(process.argv[2], 10) || 20;
const verbose = process.argv.includes('--verbose');
const stat = { 0: 0, 1: 0, draw: 0, cap: 0 };
let totalTurns = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  if (verbose) console.log(`\n=== game ${g + 1} ===`);
  const r = playOneGame(verbose);
  stat[r.winner]++;
  totalTurns += r.turns;
  if (verbose) console.log(` → winner=${r.winner} turns=${r.turns} alive[${r.aliveA},${r.aliveB}]`);
}
const ms = Date.now() - t0;
console.log(`\n=== ${N} games in ${ms}ms (${(N / (ms / 1000)).toFixed(1)} games/s, avg ${(totalTurns / N).toFixed(1)} turns) ===`);
console.log(`P0 wins: ${stat[0]}  P1 wins: ${stat[1]}  draws: ${stat.draw}  turn-cap: ${stat.cap}`);
process.exit(0);
