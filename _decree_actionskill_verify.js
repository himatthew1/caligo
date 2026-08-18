// 칙명 유닛의 '행동소비 스킬' 해금 검증 — 장군 부대공격(troopAttack, replacesAction:true).
//  - 조작자가 이미 행동(actionDone=true) + 지명된 장군이 칙명 대상(_decreeUnit) + SP 충분
//    → troopAttack 시전 성공, _troopQueue 설정, 칙명(_decreeUnit) 소멸.
//  - 칙명 없이 actionDone=true 면 거부(대조군).
//  - SP 부족이면 거부(대조군).
const S = require('./server.js');
const { createRoom, createPiece, executeSkill, rooms } = S;

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, x != null ? '→ ' + JSON.stringify(x) : ''); } }

function setup() {
  const room = createRoom('da-' + Math.random().toString(36).slice(2, 7), { mode: '1v1' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 5; room.currentPlayerIdx = 0; room.sp = [8, 8]; room.instantSp = [0, 0];
  // player0: 전령(0) + 장군(1) + 왕자(2) — 모두 왕실(부대공격 대상)
  const msg = createPiece('messenger', 1, 3); msg.col = 0; msg.row = 0; msg.alive = true;
  const gen = createPiece('general', 2, 3); gen.col = 2; gen.row = 2; gen.alive = true;
  const prince = createPiece('prince', 3, 3); prince.col = 3; prince.row = 3; prince.alive = true;
  room.players[0] = { socketId: 's0', name: 'P0', index: 0, pieces: [msg, gen, prince],
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [], _decreeUnit: null };
  // player1: 적 하나
  const e = createPiece('spearman', 1, 3); e.col = 4; e.row = 4; e.alive = true;
  room.players[1] = { socketId: 's1', name: 'P1', index: 1, pieces: [e],
    actionDone: false, skillsUsedBeforeAction: [] };
  rooms[room.id] = room;
  return { room, gen };
}

console.log('== 칙명 유닛 행동소비 스킬(장군 부대공격) 해금 검증 ==');

// 1) 칙명 지명 + actionDone + SP 충분 → troopAttack 성공
{
  const { room, gen } = setup();
  const p = room.players[0];
  p.actionDone = true;                 // 조작자 이미 행동함(칙명은 행동 후 사용)
  p._decreeUnit = { ownerIdx: 0, pieceIdx: 1 };   // 장군(idx1)을 칙명 지명
  const r = executeSkill(room, 0, 1, 'troopAttack', {});
  ok('칙명 장군 부대공격 성공', r && r.ok, r && r.msg);
  ok('_troopQueue 설정됨', Array.isArray(p._troopQueue) && p._troopQueue.length > 0, p._troopQueue);
  ok('칙명(_decreeUnit) 소멸', p._decreeUnit === null, p._decreeUnit);
}

// 2) 대조군: 칙명 없이 actionDone=true → 거부
{
  const { room } = setup();
  const p = room.players[0];
  p.actionDone = true;
  p._decreeUnit = null;
  const r = executeSkill(room, 0, 1, 'troopAttack', {});
  ok('칙명 없으면 행동소비 스킬 거부', !(r && r.ok), r && r.msg);
}

// 3) 대조군: 칙명 지명 but SP 부족 → 거부
{
  const { room } = setup();
  const p = room.players[0];
  p.actionDone = true;
  p._decreeUnit = { ownerIdx: 0, pieceIdx: 1 };
  room.sp = [1, 1];   // troopAttack cost 3 > 1
  const r = executeSkill(room, 0, 1, 'troopAttack', {});
  ok('SP 부족이면 거부', !(r && r.ok), r && r.msg);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
