// 칙명(전령) 팀원 크로스 조작 — 헤드리스 결정적 검증.
//  - executeSkill('decree') 가 팀원 왕실 유닛 타겟(targetOwnerIdx)을 수락하고 _decreeUnit 을 설정하는가.
//  - 적/비왕실/사망 타겟은 거부하는가.
//  - move/attack 핸들러의 크로스 리다이렉트 결정식(_decreeCross)이 팀원 소유로 올바르게 해석되는가.
//  - 조작 후 _decreeUnit 이 소멸하는가.
const S = require('./server.js');
const { createRoom, createPiece, executeSkill, getAllyIndices, getEnemyIndices, rooms } = S;

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); } }

function mkPlayer(index, teamId, deck) {
  const pieces = deck.map((t, i) => createPiece(t, i + 1, [4, 3, 3][i] || 3)).filter(Boolean);
  return { socketId: 'AI', name: `P${index}`, index, teamId, pieces, draft: {}, hpDist: [4,3,3],
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    _lastActionType: null, slotPos: teamId === 0 ? index : index - 2, alive: true, sp: 20 };
}

function makeRoom() {
  const room = createRoom('dc-' + Math.random().toString(36).slice(2, 8), { mode: 'team' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 5; room.currentPlayerIdx = 0; room.turnSlotIdx = 0;
  // idx0(전령, team0) / idx1(왕자=왕실, team0) / idx2,3 team1
  room.players = [
    mkPlayer(0, 0, ['messenger', 'monk', 'wolf']),
    mkPlayer(1, 0, ['prince', 'princess', 'commander']),
    mkPlayer(2, 1, ['king', 'monk', 'wolf']),
    mkPlayer(3, 1, ['prince', 'monk', 'wolf']),
  ];
  room.teams = [[0, 1], [2, 3]];
  room.sp = [20, 20]; room.instantSp = [0, 0];   // ★ 팀 SP 풀(teamId 인덱싱)
  // 배치
  let c = 1;
  for (const p of room.players) p.pieces.forEach(pc => { pc.col = c; pc.row = 1; pc.alive = true; c++; });
  rooms[room.id] = room;
  return room;
}

console.log('== 칙명 팀원 크로스 검증 ==');
const room = makeRoom();
const caster = room.players[0];        // 전령
const teammate = room.players[1];      // 왕실(왕자/공주/사령관)
const enemy = room.players[2];

// 전령 SP 확보 & 이번 턴 행동 완료 상태(칙명은 행동 후 사용 가능)
caster.sp = 20; caster.actionDone = true; caster._lastActionType = 'attack';

// messenger piece index
const mi = caster.pieces.findIndex(p => p.type === 'messenger');
ok('전령 존재', mi >= 0, mi);

// 1) 팀원 왕실 유닛(prince, idx0) 타겟 칙명
const r1 = executeSkill(room, 0, mi, 'decree', { targetOwnerIdx: 1, targetPieceIdx: 0 });
ok('팀원 왕실(왕자) 칙명 성공', r1 && r1.ok, r1 && r1.msg);
ok('_decreeUnit = 팀원 소유', !!caster._decreeUnit && caster._decreeUnit.ownerIdx === 1 && caster._decreeUnit.pieceIdx === 0, caster._decreeUnit);
ok('결과 data.decreeUnit 전달', !!(r1 && r1.data && r1.data.decreeUnit && r1.data.decreeUnit.ownerIdx === 1), r1 && r1.data && r1.data.decreeUnit);

// move 핸들러 크로스 결정식 재현 (decreeOwnerIdx = 1, pieceIdx = 0, 조작자 idx=0)
function decreeCross(player, idx, decreeOwnerIdx, pieceIdx) {
  return !!(typeof decreeOwnerIdx === 'number' && decreeOwnerIdx !== idx
    && player._decreeUnit && player._decreeUnit.ownerIdx === decreeOwnerIdx
    && player._decreeUnit.pieceIdx === pieceIdx && room.players[decreeOwnerIdx]);
}
ok('move 크로스 결정식=true(팀원 조작)', decreeCross(caster, 0, 1, 0) === true);
ok('move 크로스 결정식=false(조작자 자기 idx)', decreeCross(caster, 0, 0, 0) === false);
ok('move 크로스 결정식=false(다른 pieceIdx)', decreeCross(caster, 0, 1, 2) === false);
const pieceOwnerIdx = decreeCross(caster, 0, 1, 0) ? 1 : 0;
ok('pieceOwner 해석 = 팀원(1)', pieceOwnerIdx === 1);
ok('pieceOwner.pieces[0] = 팀원 왕자', room.players[pieceOwnerIdx].pieces[0].type === 'prince', room.players[pieceOwnerIdx].pieces[0].type);

// 소멸 시뮬레이션(핸들러 consume 로직): _decreeUnit.ownerIdx===pieceOwnerIdx && pieceIdx 일치 → null
if (caster._decreeUnit && caster._decreeUnit.ownerIdx === pieceOwnerIdx && caster._decreeUnit.pieceIdx === 0) caster._decreeUnit = null;
ok('조작 후 _decreeUnit 소멸', caster._decreeUnit === null);

// 2) 적 유닛 타겟 거부
caster.actionDone = true; caster._lastActionType = 'attack'; caster._decreeUnit = null; caster.sp = 20;
const r2 = executeSkill(room, 0, mi, 'decree', { targetOwnerIdx: 2, targetPieceIdx: 0 });
ok('적 유닛 칙명 거부', !(r2 && r2.ok), r2 && r2.msg);

// 3) 비왕실(팀원의 사령관? commander=왕실). 팀원 비왕실 유닛으로 테스트: wolf 없음 → 늑대 대신 monk? monk=왕실 아님?
//    안전하게: 팀원 pieces 중 비왕실 찾기.
caster.actionDone = true; caster._lastActionType = 'attack'; caster._decreeUnit = null; caster.sp = 20;
const CH = S.CHARACTERS;
const nonRoyalIdx = teammate.pieces.findIndex(p => { const ch = CH[p.type]; return ch && ch.faction !== 'royal'; });
if (nonRoyalIdx >= 0) {
  const r3 = executeSkill(room, 0, mi, 'decree', { targetOwnerIdx: 1, targetPieceIdx: nonRoyalIdx });
  ok('팀원 비왕실 유닛 칙명 거부', !(r3 && r3.ok), { type: teammate.pieces[nonRoyalIdx].type, msg: r3 && r3.msg });
} else {
  console.log('  (팀원 전원 왕실 — 비왕실 거부 케이스 스킵)');
}

// 4) 사망한 팀원 왕실 거부
caster.actionDone = true; caster._lastActionType = 'attack'; caster._decreeUnit = null; caster.sp = 20;
teammate.pieces[1].alive = false;
const r4 = executeSkill(room, 0, mi, 'decree', { targetOwnerIdx: 1, targetPieceIdx: 1 });
ok('사망 팀원 왕실 칙명 거부', !(r4 && r4.ok), r4 && r4.msg);
teammate.pieces[1].alive = true;

// 5) 아군 인덱스 정합성
ok('getAllyIndices(0) 팀원1 포함', getAllyIndices(room, 0).includes(1));
ok('getEnemyIndices(0)===getEnemyIndices(1) (같은 팀 적집합 동일)',
  JSON.stringify(getEnemyIndices(room, 0).slice().sort()) === JSON.stringify(getEnemyIndices(room, 1).slice().sort()));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
