// Ablation A/B — 인게임 추론기능(#6 지휘관추론 + #4 표식추격) ON vs OFF 비대칭 대국.
//   한쪽 브레인만 _ablate 로 기능 끄고 붙임. 기능이 도움되면 ON 쪽이 50% 초과.
//   매 판 좌우(선/후공) 교대로 진영 편향 제거.
require('dotenv').config({ path: '.env' });
const S = require('./server.js');
const SP = require('./ai-selfplay');
const { getTeamBrain, aiTeamTakeTurn, endTurn, rooms } = S;

function playAblated(treatIdx, ctrlAblate) {
  const room = SP.makeGame();
  // control 쪽 브레인에만 기능 OFF
  const ctrlIdx = 1 - treatIdx;
  const cb = getTeamBrain(room, ctrlIdx); cb._ablate = ctrlAblate;
  const tb = getTeamBrain(room, treatIdx); tb._ablate = null;   // 전체 기능
  let guard = 0;
  while (room.phase === 'game' && guard++ < 400) {
    const idx = room.currentPlayerIdx;
    const before = room.turnNumber;
    try { aiTeamTakeTurn(room, idx); } catch (e) { break; }
    if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) endTurn(room);
  }
  const a = room.players[0].pieces.filter(p => p.alive).length;
  const b = room.players[1].pieces.filter(p => p.alive).length;
  let winner = 'draw';
  if (room.phase !== 'ended') winner = 'cap';
  else if (a > 0 && b === 0) winner = 0;
  else if (b > 0 && a === 0) winner = 1;
  delete rooms[room.id];
  return winner;
}

function run(label, ablate, N) {
  let treatWin = 0, ctrlWin = 0, other = 0;
  for (let i = 0; i < N; i++) {
    const treatIdx = i % 2;                  // 좌우 교대
    const w = playAblated(treatIdx, ablate);
    if (w === treatIdx) treatWin++;
    else if (w === (1 - treatIdx)) ctrlWin++;
    else other++;
  }
  const decisive = treatWin + ctrlWin;
  const wr = decisive ? (treatWin / decisive * 100) : 50;
  console.log(`[${label}] ${N}판 — 기능ON 승:${treatWin}  OFF 승:${ctrlWin}  무/cap:${other}`);
  console.log(`   → 승부난 판 기준 기능ON 승률 ${wr.toFixed(1)}%  (50%=무효과, >50%=도움)`);
  return wr;
}

const N = parseInt(process.argv[2], 10) || 1000;
const t0 = Date.now();
console.log('=== Ablation A/B (비대칭: 한쪽만 기능 OFF) ===');
run('#6+#4 둘다', { noCmd: true, noMark: true }, N);
run('#6 지휘관추론만', { noCmd: true }, N);
run('#4 표식추격만', { noMark: true }, N);
console.log(`(${Date.now() - t0}ms)`);
process.exit(0);
