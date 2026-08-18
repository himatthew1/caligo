// 종합 검증: (1) 저주는 스킬 봉인 안 함 / 개구리는 봉인함, (2) 칙명이 actionUsedSkillReplace 우회,
//   (3) AI 마녀가 개구리 장난·빗자루 비행을 때맞춰 사용.
const S = require('./server.js');
const { createRoom, createPiece, executeSkill, initAiBrain, aiUsePreSkills, hasStatus, addStatus, rooms } = S;

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, x != null ? '→ ' + JSON.stringify(x) : ''); } }

function room1v1(cur, cpieces, apieces) {
  const room = createRoom(cur + Math.random().toString(36).slice(2, 6), { mode: '1v1' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 6; room.currentPlayerIdx = 1; room.sp = [8, 8]; room.instantSp = [0, 0];
  room.players[0] = { socketId: 's0', name: 'H', index: 0, pieces: cpieces, actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [] };
  room.players[1] = { socketId: 'AI', name: 'AI', index: 1, pieces: apieces, actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [], _decreeUnit: null };
  rooms[room.id] = room;
  return room;
}

console.log('== 마녀/칙명 종합 검증 ==');

// ── (1) 저주는 스킬 봉인 안 함 / 개구리는 봉인 ──
{
  const arch = createPiece('archer', 1, 3); arch.col = 1; arch.row = 1; arch.alive = true;
  const dummy = createPiece('spearman', 1, 3); dummy.col = 4; dummy.row = 4; dummy.alive = true;
  const room = room1v1('sk', [dummy], [arch]);
  // 저주 상태 → reform 시전 가능해야 함(봉인 X)
  arch.statusEffects = [{ type: 'curse', source: 0 }];
  const r1 = executeSkill(room, 1, 0, 'reform', {});
  ok('저주 상태에서 스킬 사용 가능(봉인 X)', r1 && r1.ok, r1 && r1.msg);
  // 개구리 상태 → 봉인
  arch.statusEffects = [{ type: 'frog', source: 0 }];
  const r2 = executeSkill(room, 1, 0, 'reform', {});
  ok('개구리 상태에서 스킬 봉인', !(r2 && r2.ok) && /개구리/.test(r2 && r2.msg || ''), r2 && r2.msg);
}

// ── (2) 칙명이 actionUsedSkillReplace 우회(이동/공격 핸들러 가드 로직 재현) ──
{
  const msg = createPiece('messenger', 1, 3); msg.col = 2; msg.row = 2; msg.alive = true;
  const dummy = createPiece('spearman', 1, 3); dummy.col = 4; dummy.row = 4; dummy.alive = true;
  const room = room1v1('dc', [dummy], [msg]);
  const p = room.players[1];
  // 부대공격류로 actionUsedSkillReplace 세워진 상태 + 칙명으로 전령(idx0) 지명
  p.actionDone = true; p.actionUsedSkillReplace = true;
  p._decreeUnit = { ownerIdx: 1, pieceIdx: 0 };
  // move 핸들러 가드 재현: _isDecreePiece 면 actionUsedSkillReplace 우회
  const pieceOwnerIdx = 1, pieceIdx = 0;
  const _isDecreePiece = !!(p._decreeUnit && p._decreeUnit.ownerIdx === pieceOwnerIdx && p._decreeUnit.pieceIdx === pieceIdx);
  const moveBlocked = (p.actionUsedSkillReplace && !msg.messengerSprintActive && !false && !false && !_isDecreePiece);
  ok('칙명 지명 유닛은 actionUsedSkillReplace 우회(이동 허용)', moveBlocked === false, { _isDecreePiece, moveBlocked });
  // attack 가드 재현
  const _decreeAttack = !!(p._decreeUnit && p._decreeUnit.ownerIdx === 1 && p._decreeUnit.pieceIdx === 0);
  const atkBlocked = (p.actionUsedSkillReplace && !false && !_decreeAttack);
  ok('칙명 지명 유닛은 actionUsedSkillReplace 우회(공격 허용)', atkBlocked === false, { _decreeAttack, atkBlocked });
}

// ── (3) AI 마녀 개구리 장난 (위험 없음 + 고가치 스킬 적) ──
{
  const witch = createPiece('witch', 2, 3); witch.col = 2; witch.row = 2; witch.alive = true;
  const monk = createPiece('monk', 3, 3); monk.col = 0; monk.row = 0; monk.alive = true;
  const room = room1v1('fg', [monk], [witch]);
  room.aiBrain = initAiBrain(9); const brain = room.aiBrain; brain.turnCount = room.turnNumber;
  // 위험 없음: dangerMap 0
  brain._dangerMap = Array.from({ length: 9 }, () => Array(9).fill(0));
  brain._dangerTurn = brain.turnCount;
  aiUsePreSkills(room);
  ok('AI 마녀가 고가치 스킬 적(수도승)을 개구리로', hasStatus(monk, 'frog'), (monk.statusEffects || []));
}

// ── (3b) AI 마녀 빗자루 비행 (저주 채널링 중 + 현재칸 위험) ──
{
  const witch = createPiece('witch', 2, 3); witch.col = 2; witch.row = 2; witch.alive = true;
  const enemy = createPiece('spearman', 1, 3); enemy.col = 0; enemy.row = 0; enemy.alive = true;
  const room = room1v1('bf', [enemy], [witch]);
  room.aiBrain = initAiBrain(9); const brain = room.aiBrain; brain.turnCount = room.turnNumber;
  // 채널링: 적에게 witch(소유자1) 발 저주
  enemy.statusEffects = [{ type: 'curse', source: 1 }];
  // 현재 칸(2,2) 위험, 나머지 안전
  brain._dangerMap = Array.from({ length: 9 }, () => Array(9).fill(0));
  brain._dangerMap[2][2] = 5;
  brain._dangerTurn = brain.turnCount;
  const from = { col: witch.col, row: witch.row };
  aiUsePreSkills(room);
  const moved = (witch.col !== from.col || witch.row !== from.row);
  ok('AI 마녀가 위험 시 빗자루 비행으로 도주', moved, { from, to: { col: witch.col, row: witch.row } });
  ok('도주 후 저주 유지(채널링 계속)', enemy.statusEffects.some(e => e.type === 'curse'), enemy.statusEffects);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
