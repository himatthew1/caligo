// 발동 조건 빈도 측정 — 자가대국에서 #6(지휘관 드래프트)·#4(표식 발생)가 얼마나 트리거되나.
require('dotenv').config({ path: '.env' });
const S = require('./server.js');
const SP = require('./ai-selfplay');
const { aiTeamTakeTurn, endTurn, rooms } = S;

const N = parseInt(process.argv[2], 10) || 1000;
let cmdDraftGames = 0;     // 어느 한쪽이라도 지휘관 보유한 판
let markEverGames = 0;     // 게임 중 한 번이라도 표식이 붙은 판
let markTurns = 0;         // 표식이 존재한 총 턴 수
let totalTurns = 0;

for (let i = 0; i < N; i++) {
  const room = SP.makeGame();
  const hasCmd = room.players.some(p => p.pieces.some(pc => pc.type === 'commander'));
  if (hasCmd) cmdDraftGames++;
  let markedThisGame = false, guard = 0;
  while (room.phase === 'game' && guard++ < 400) {
    const idx = room.currentPlayerIdx;
    const before = room.turnNumber;
    // 표식 존재 검사
    const anyMark = room.players.some(p => p.pieces.some(pc =>
      pc.alive && pc.statusEffects && pc.statusEffects.some(e => e.type === 'mark')));
    if (anyMark) { markTurns++; markedThisGame = true; }
    totalTurns++;
    try { aiTeamTakeTurn(room, idx); } catch (e) { break; }
    if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) endTurn(room);
  }
  if (markedThisGame) markEverGames++;
  delete rooms[room.id];
}

console.log(`=== 발동 조건 빈도 (${N}판) ===`);
console.log(`#6 지휘관 보유 판: ${cmdDraftGames} (${(cmdDraftGames/N*100).toFixed(1)}%)  — 그나마 버프 인접+초과피해까지 겹쳐야 실발동`);
console.log(`#4 표식 발생 판:   ${markEverGames} (${(markEverGames/N*100).toFixed(1)}%)`);
console.log(`   표식 존재 턴/전체 턴: ${markTurns}/${totalTurns} (${(markTurns/totalTurns*100).toFixed(2)}%)`);
process.exit(0);
