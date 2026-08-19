// 팀전 부대공격(장군) 팀원 자동 지휘 — 헤드리스 결정적 검증.
//  - executeSkill('general') 가 시전자 자기 왕실 = 수동 큐(_troopQueue), 팀원 왕실 = 자동 큐(_troopTeammates)로 분리하는가.
//  - 순서: 시전자 왕실(피스 순서) → 팀원 왕실(소유자·피스 순서).
//  - 수동 큐 소진 후 _resolveTeammateTroops 가 팀원 왕실 공격을 실제로 적용하는가(적 HP 감소).
const S = require('./server.js');
const { createRoom, createPiece, executeSkill, getAllyIndices, getEnemyIndices, isFaction, _resolveTeammateTroops, rooms } = S;

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); } }

function mkPlayer(index, teamId, deck) {
  const pieces = deck.map((t, i) => createPiece(t, i + 1, [4, 3, 3][i] || 3)).filter(Boolean);
  return { socketId: 'AI', name: `P${index}`, index, teamId, pieces, draft: {}, hpDist: [4,3,3],
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    _lastActionType: null, slotPos: teamId === 0 ? index : index - 2, alive: true, sp: 20 };
}

function makeRoom() {
  const room = createRoom('tt-' + Math.random().toString(36).slice(2, 8), { mode: 'team' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 5; room.currentPlayerIdx = 0; room.turnSlotIdx = 0;
  // idx0(장군+왕자=team0 시전자) / idx1(왕자·공주=team0 팀원) / idx2,3 team1 적
  room.players = [
    mkPlayer(0, 0, ['general', 'prince', 'monk']),
    mkPlayer(1, 0, ['prince', 'princess', 'monk']),
    mkPlayer(2, 1, ['king', 'monk', 'watchman']),
    mkPlayer(3, 1, ['king', 'monk', 'watchman']),
  ];
  room.teams = [[0, 1], [2, 3]];
  room.sp = [20, 20]; room.instantSp = [0, 0];
  rooms[room.id] = room;
  return room;
}

console.log('== 팀전 부대공격 팀원 자동 지휘 검증 ==');
const room = makeRoom();
const caster = room.players[0];    // 장군 시전자
const mate = room.players[1];      // 팀원 왕실
const bounds = room.boardBounds;

// 왕실 태그 확인(어떤 유닛이 큐에 들어가는지)
console.log('  · royal 태그:', room.players.map((p,i)=>`P${i}[`+p.pieces.map(pc=>`${pc.type}:${isFaction(pc,'royal')?'R':'-'}`).join(',')+']').join(' '));

// 배치: 시전자 왕실은 적 인접에 두어 공격 성립. 팀원 왕실도 적 인접.
// 보드 7x7 (팀전 LV4) 가정 — bounds.min..max.
const mn = bounds.min, mx = bounds.max;
// 적 왕(idx2) 을 (3,3) 에 배치. 시전자/팀원 왕실을 인접 배치.
room.players[2].pieces.forEach((pc,i)=>{ pc.alive=true; pc.col=3; pc.row=3+i<=mx?3+i:mx; });
room.players[3].pieces.forEach((pc,i)=>{ pc.alive=true; pc.col=4; pc.row=3+i<=mx?3+i:mx; });
// 시전자 general(0)=(3,2), prince(1)=(2,3), monk(2) 아무곳
caster.pieces[0].col=3; caster.pieces[0].row=2; caster.pieces[0].alive=true;   // general
caster.pieces[1].col=2; caster.pieces[1].row=3; caster.pieces[1].alive=true;   // prince (가로3 → (3,3) 적중)
caster.pieces[2].col=0; caster.pieces[2].row=0; caster.pieces[2].alive=true;   // monk
// 팀원 prince(0)=(3,4) 세로... prince=가로3, princess=세로3
mate.pieces[0].col=2; mate.pieces[0].row=3; mate.pieces[0].alive=true;   // prince 가로3 → (3,3)
mate.pieces[1].col=3; mate.pieces[1].row=2; mate.pieces[1].alive=true;   // princess 세로3 → (3,3)
mate.pieces[2].col=0; mate.pieces[2].row=6; mate.pieces[2].alive=true;   // monk

caster.sp = 20;
const gi = caster.pieces.findIndex(p => p.type === 'general');
ok('장군 존재', gi >= 0, gi);

const r = executeSkill(room, 0, gi, 'general', {});
ok('부대공격 시전 성공', r && r.ok, r && r.msg);
console.log('  · 시전 메시지:', r && r.msg);

// 수동 큐 = 시전자 자기 왕실만
const mq = caster._troopQueue || [];
ok('수동 큐 존재(시전자 왕실)', mq.length > 0, mq);
ok('수동 큐 전부 시전자 소유(ownerIdx=0)', mq.every(q => (q.ownerIdx ?? 0) === 0), mq.map(q=>q.ownerIdx));
console.log('  · 수동 큐:', mq.map(q=>`${q.ownerIdx}:${q.pieceIdx}:${q.type}`).join(' | '));

// 자동 큐 = 팀원 왕실만, 순서=팀원 소유·피스순
const tq = caster._troopTeammates || [];
ok('자동 큐 존재(팀원 왕실)', tq.length > 0, tq);
ok('자동 큐 전부 팀원 소유(ownerIdx=1)', tq.every(q => q.ownerIdx === 1), tq.map(q=>q.ownerIdx));
console.log('  · 자동 큐:', tq.map(q=>`${q.ownerIdx}:${q.pieceIdx}:${q.type}`).join(' | '));

// 팀원 왕실 피스 인덱스 순서 오름차순
ok('자동 큐 피스 순서 오름차순', tq.every((q,i)=> i===0 || q.pieceIdx > tq[i-1].pieceIdx), tq.map(q=>q.pieceIdx));

// 적 총 HP 스냅샷(자동 지휘 전)
const enemyHpBefore = [2,3].reduce((s,ei)=> s + room.players[ei].pieces.reduce((a,p)=>a+(p.alive?p.hp:0),0), 0);
console.log('  · 자동 지휘 전 적 총 HP:', enemyHpBefore);

// 수동 큐를 비운 것으로 간주하고(시전자가 자기 왕실 조작 완료) 자동 지휘 직접 호출
caster._troopQueue = null;
_resolveTeammateTroops(room, 0);
ok('_resolveTeammateTroops 호출 후 _troopTeammates 소거', caster._troopTeammates == null);

// setTimeout 기반 → 충분히 대기 후 검증
const waitMs = tq.length * 1500 + 800;
setTimeout(() => {
  const enemyHpAfter = [2,3].reduce((s,ei)=> s + room.players[ei].pieces.reduce((a,p)=>a+(p.alive?p.hp:0),0), 0);
  console.log('  · 자동 지휘 후 적 총 HP:', enemyHpAfter);
  ok('팀원 자동 지휘가 적에게 피해 적용(HP 감소)', enemyHpAfter < enemyHpBefore, { before: enemyHpBefore, after: enemyHpAfter });
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}, waitMs);
