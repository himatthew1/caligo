// 그리폰 격노 AI 사용 — 헤드리스 결정적 검증(1v1 aiUsePreSkills).
//  - _rageActive + 처치확정(HP≤1) 적 존재 → 격노 시전(정체 타겟), 적 처치.
//  - _rageActive + 처치불가(적 HP 높음) + 그리폰 여유 → 보류(SP 낭비 방지).
//  - _rageActive + 처치불가 + 그리폰 위급(HP1) → 최고가치 적에게 사용(사장 방지).
//  - 비활성(_rageActive=false) → 미사용.
const S = require('./server.js');
const { createRoom, createPiece, initAiBrain, aiUsePreSkills, rooms } = S;

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, x != null ? '→ ' + JSON.stringify(x) : ''); } }

function setup() {
  const room = createRoom('gr-' + Math.random().toString(36).slice(2, 7), { mode: '1v1' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 5; room.currentPlayerIdx = 1; room.sp = [5, 5]; room.instantSp = [0, 0];
  // human(0)
  const h = createPiece('spearman', 1, 3);
  h.col = 0; h.row = 0; h.alive = true;
  const h2 = createPiece('knight', 2, 3);
  h2.col = 4; h2.row = 4; h2.alive = true;
  room.players[0] = { socketId: 's0', name: 'H', index: 0, pieces: [h, h2], actionDone: false, skillsUsedBeforeAction: [] };
  // AI(1) 그리폰
  const g = createPiece('griffin', 2, 3);
  g.col = 2; g.row = 2; g.alive = true;
  room.players[1] = { socketId: 'AI', name: 'AI', index: 1, pieces: [g], actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [] };
  rooms[room.id] = room;
  try { initAiBrain(room); } catch (e) {}
  if (!room.aiBrain) room.aiBrain = { hitMemory: {}, probMap: [], turnCount: 5, _dangerMap: [] };
  return { room, g, h, h2 };
}

console.log('== 그리폰 격노 AI 검증 ==');

// 1) 처치확정 대상(창병 HP1) → 격노로 처치
{
  const { room, g, h } = setup();
  g._rageActive = true; h.hp = 1;
  aiUsePreSkills(room);
  ok('처치확정 적에 격노 시전 → 사망', !h.alive, { hp: h.hp, alive: h.alive });
  ok('격노 후 비활성화', g._rageActive === false, g._rageActive);
}

// 2) 처치불가(적 HP 높음) + 그리폰 여유 → 보류
{
  const { room, g, h, h2 } = setup();
  g._rageActive = true; g.hp = 3; h.hp = 3; h2.hp = 3;
  aiUsePreSkills(room);
  ok('처치불가+여유 → 격노 보류(적 생존)', h.alive && h2.alive && g._rageActive === true,
     { hHp: h.hp, h2Hp: h2.hp, rage: g._rageActive });
}

// 3) 처치불가 + 그리폰 위급(HP1) → 사용(최고가치 적)
{
  const { room, g, h, h2 } = setup();
  g._rageActive = true; g.hp = 1; h.hp = 3; h2.hp = 3;
  aiUsePreSkills(room);
  ok('위급 시 격노 사용(사장 방지)', g._rageActive === false, { rage: g._rageActive });
}

// 4) 비활성 → 미사용
{
  const { room, g, h } = setup();
  g._rageActive = false; h.hp = 1;
  aiUsePreSkills(room);
  ok('비활성이면 격노 미사용', h.alive && g._rageActive === false, { hAlive: h.alive });
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
