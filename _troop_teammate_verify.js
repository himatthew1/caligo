// 팀전 부대공격(장군) — 팀원 왕실도 시전자가 '직접' 조작(크로스오너, 자동 아님) 검증(헤드리스).
//  - executeSkill('general') 큐 = 나1·나2·팀원1·팀원2 (owner-aware 단일 큐).
//  - 표준/투석기 팀원 크로스공격: attack 핸들러 _troopCrossA 결정식 + processAttack(팀원 소유) 적용.
//  - 팀원 기마병 질주 크로스: executeSkill('dash', crossOwnerIdx) 가 팀원 유닛을 질주 + 시전자 큐 소진.
const S = require('./server.js');
const { createRoom, createPiece, executeSkill, getAllyIndices, isFaction, processAttack, getAttackCells, rooms } = S;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, e != null ? JSON.stringify(e) : ''); } };

function mkPlayer(index, teamId, deck) {
  const pieces = deck.map((t, i) => createPiece(t, i + 1, [4, 3, 3][i] || 3)).filter(Boolean);
  return { socketId: 'AI', name: `P${index}`, index, teamId, pieces, draft: {}, hpDist: [4,3,3],
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [], _lastActionType: null, alive: true, sp: 20 };
}
function makeRoom(casterDeck) {
  const room = createRoom('tt-' + Math.random().toString(36).slice(2, 8), { mode: 'team' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 5; room.currentPlayerIdx = 0; room.turnSlotIdx = 0;
  room.players = [
    mkPlayer(0, 0, casterDeck),
    mkPlayer(1, 0, ['prince', 'princess', 'monk']),
    mkPlayer(2, 1, ['king', 'monk', 'watchman']),
    mkPlayer(3, 1, ['king', 'monk', 'watchman']),
  ];
  room.teams = [[0, 1], [2, 3]];
  room.sp = [20, 20]; room.instantSp = [0, 0];
  room.players.forEach(p => p.pieces.forEach(pc => pc.alive = true));
  rooms[room.id] = room;
  return room;
}
// attack 핸들러 _troopCrossA 결정식 재현
function troopCrossA(caster, idx, decreeOwnerIdx, pieceIdx, room) {
  const tf0 = (caster._troopQueue && caster._troopQueue.length) ? caster._troopQueue[0] : null;
  return !!(typeof decreeOwnerIdx === 'number' && decreeOwnerIdx !== idx
    && tf0 && (tf0.ownerIdx ?? idx) === decreeOwnerIdx && tf0.pieceIdx === pieceIdx && room.players[decreeOwnerIdx]);
}

console.log('== 팀전 부대공격 팀원 직접 조작(크로스오너) 검증 ==');
let room = makeRoom(['general', 'prince', 'monk']);
const caster = room.players[0], mate = room.players[1];
// 배치
room.players[2].pieces.forEach((pc,i)=>{pc.alive=true;pc.col=3;pc.row=Math.min(3+i,room.boardBounds.max);});
caster.pieces[0].col=3; caster.pieces[0].row=2;   // general (+ 모양 → (3,3))
caster.pieces[1].col=2; caster.pieces[1].row=3;   // prince 가로3 → (3,3)
caster.pieces[2].col=0; caster.pieces[2].row=0;
mate.pieces[0].col=2; mate.pieces[0].row=3;        // prince 가로3 → (3,3)
mate.pieces[1].col=3; mate.pieces[1].row=2;        // princess 세로3 → (3,3)
mate.pieces[2].col=0; mate.pieces[2].row=6;
caster.sp = 20;

const gi = caster.pieces.findIndex(p => p.type === 'general');
const r = executeSkill(room, 0, gi, 'general', {});
ok('부대공격 시전 성공', r && r.ok, r && r.msg);
const q = caster._troopQueue || [];
console.log('  · 큐:', q.map(e=>`${e.ownerIdx}:${e.pieceIdx}:${e.type}`).join(' | '));
ok('큐에 시전자+팀원 왕실 모두 포함', q.length === 4, q.length);
ok('순서 = 나1·나2·팀원1·팀원2', q[0].ownerIdx===0 && q[1].ownerIdx===0 && q[2].ownerIdx===1 && q[3].ownerIdx===1, q.map(e=>e.ownerIdx));
ok('자동 지휘 큐(_troopTeammates) 없음(수동 조작)', caster._troopTeammates == null);

// 팀원 첫 유닛(팀원 prince, ownerIdx=1, pieceIdx=0)을 큐 앞으로 가정 → 크로스공격 결정식
caster._troopQueue = [{ ownerIdx: 1, pieceIdx: 0, tier: 3, type: 'prince' }];
ok('크로스공격 결정식=true(팀원 조작, decreeOwnerIdx=1)', troopCrossA(caster, 0, 1, 0, room) === true);
ok('크로스공격 결정식=false(자기 idx)', troopCrossA(caster, 0, 0, 0, room) === false);
// 실제 데미지: 팀원 prince(2,3) 가로3 → (3,3) 적. processAttack(팀원 소유=1)
const enemyHpBefore = [2,3].reduce((s,ei)=>s+room.players[ei].pieces.reduce((a,p)=>a+(p.alive?p.hp:0),0),0);
const matePrince = mate.pieces[0];
const cells = getAttackCells(matePrince.type, matePrince.col, matePrince.row, room.boardBounds, {});
const hits = processAttack(room, 1, matePrince, cells, undefined, { suppressSpUpdate: true });
ok('팀원 유닛(소유=1)으로 크로스공격 명중', hits.length > 0, hits.length);
const enemyHpAfter = [2,3].reduce((s,ei)=>s+room.players[ei].pieces.reduce((a,p)=>a+(p.alive?p.hp:0),0),0);
ok('적 HP 감소', enemyHpAfter < enemyHpBefore, { before: enemyHpBefore, after: enemyHpAfter });

// ── 팀원 기마병 질주 크로스: executeSkill('dash', crossOwnerIdx) ──
console.log('== 팀원 기마병 질주 크로스 ==');
room = makeRoom(['general', 'monk', 'watchman']);
const caster2 = room.players[0];
// 팀원(1)에 기마병 배치
const mate2 = room.players[1];
mate2.pieces[0] = createPiece('cavalry', 1, 3); mate2.pieces[0].alive = true; mate2.pieces[0].col = 1; mate2.pieces[0].row = 1;
// 시전자 큐: 팀원 기마병만
caster2._troopQueue = [{ ownerIdx: 1, pieceIdx: 0, tier: 1, type: 'cavalry' }];
caster2.actionDone = true; caster2.actionUsedSkillReplace = true;   // 부대공격 시전 후 상태
const before = { c: mate2.pieces[0].col, r: mate2.pieces[0].row };
const dr = executeSkill(room, 0, 0, 'dash', { col: 1, row: 3 }, 1);   // crossOwnerIdx=1
ok('팀원 기마병 질주 크로스 성공', dr && dr.ok, dr && dr.msg);
ok('팀원 기마병이 목표로 이동', mate2.pieces[0].row === 3 && mate2.pieces[0].col === 1, { c: mate2.pieces[0].col, r: mate2.pieces[0].row, before });
ok('시전자 큐 소진(질주 후 비움)', caster2._troopQueue == null, caster2._troopQueue);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
setTimeout(() => process.exit(fail ? 1 : 0), 300);
