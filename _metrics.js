// 자가대국 행동 지표 측정 — belief 정확도(추론), 게임길이, 총 교전피해.
require('dotenv').config({ path: '.env' });
const S = require('./server.js');
const SP = require('./ai-selfplay');
const { getTeamBrain, getEnemyIndices, aiTeamTakeTurn, endTurn, rooms } = S;
// pvp: 팀id = 플레이어 idx

const totalHp = (room, idx) => room.players[idx].pieces.reduce((s, p) => s + (p.alive ? p.hp : 0), 0);

function runMetrics(N) {
  let beliefSum = 0, beliefN = 0, lenSum = 0, dmgSum = 0, games = 0;
  for (let g = 0; g < N; g++) {
    const room = SP.makeGame();
    const initHp = totalHp(room, 0) + totalHp(room, 1);
    let guard = 0;
    while (room.phase === 'game' && guard++ < 400) {
      const idx = room.currentPlayerIdx;
      try {
        const brain = getTeamBrain(room, idx);
        const enemies = getEnemyIndices(room, idx).flatMap(ei => room.players[ei].pieces.filter(p => p.alive));
        if (brain && brain.probMap && enemies.length) {
          let s = 0; enemies.forEach(e => { const row = brain.probMap[e.row]; if (row && typeof row[e.col] === 'number') s += row[e.col]; });
          beliefSum += s / enemies.length; beliefN++;
        }
      } catch (e) {}
      const before = room.turnNumber;
      try { aiTeamTakeTurn(room, idx); } catch (e) { break; }
      if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) endTurn(room);
    }
    dmgSum += initHp - (totalHp(room, 0) + totalHp(room, 1));  // 총 가해 피해
    lenSum += room.turnNumber; games++;
    delete rooms[room.id];
  }
  return {
    games,
    beliefAvg: +(beliefSum / (beliefN || 1)).toFixed(3),   // 실제 적칸 평균 확률(추론 정확도) ↑좋음
    gameLenAvg: +(lenSum / games).toFixed(1),
    dmgAvg: +(dmgSum / games).toFixed(2),                  // 판당 총 교전피해 ↑=더 싸움
  };
}

const N = parseInt(process.argv[2], 10) || 500;
const t0 = Date.now();
const r = runMetrics(N);
console.log(`${N}판 (${Date.now() - t0}ms):`, JSON.stringify(r));
process.exit(0);
