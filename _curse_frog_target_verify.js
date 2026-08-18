// 저주/개구리 타겟 가치 재튜닝 검증.
const S = require('./server.js');
const { createPiece, aiCurseValue, aiFrogValue, aiUsePreSkills, createRoom, initAiBrain, hasStatus, rooms } = S;

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, x != null ? '→ ' + JSON.stringify(x) : ''); } }
const P = (t, hp) => { const p = createPiece(t, 2, hp); p.alive = true; return p; };

console.log('== 저주/개구리 타겟 재튜닝 검증 ==');

// ── 저주 가치 ──
const tank = P('armoredWarrior', 4);
const iron = P('ironman', 4);
const griffin = P('griffin', 3);
const dryad = P('dryad', 3);
const wizard = P('wizard', 3);
const spear = P('spearman', 4);

ok('탱커(갑주무사) 저주 가치 > 0', aiCurseValue(tank, {}) > 0, aiCurseValue(tank, {}));
ok('철인 저주 가치 높음(고HP)', aiCurseValue(iron, {}) > 5, aiCurseValue(iron, {}));
ok('그리폰(격노) 저주 배제(음수)', aiCurseValue(griffin, {}) < 0, aiCurseValue(griffin, {}));
ok('드라이어드(생장) 저주 배제(음수)', aiCurseValue(dryad, {}) < 0, aiCurseValue(dryad, {}));
ok('마법사(순간마법) 저주 배제(음수)', aiCurseValue(wizard, {}) < 0, aiCurseValue(wizard, {}));
ok('최후 1인이면 그리폰도 저주 허용(양수)', aiCurseValue(griffin, { lastEnemy: true }) > 0, aiCurseValue(griffin, { lastEnemy: true }));
ok('적팀 오베론 생존 시 정령(엘프궁수)도 배제', aiCurseValue(P('archer', 3), { enemyHasOberon: true }) < 0, aiCurseValue(P('archer', 3), { enemyHasOberon: true }));
ok('오베론 있어도 비정령(창병)은 저주 가능', aiCurseValue(spear, { enemyHasOberon: true }) > 0, aiCurseValue(spear, { enemyHasOberon: true }));
ok('탱커 > 그리폰(배제) 우선순위', aiCurseValue(tank, {}) > aiCurseValue(griffin, {}));

// ── 개구리 가치 ──
const monk = P('monk', 3);
const commander = P('commander', 3);  // 패시브(wrath) 위협 — 액티브 스킬 없음? 있음(없음). 낮아야
const king = P('king', 3);
ok('수도승(신성) 개구리 가치 최상위권', aiFrogValue(monk) >= aiFrogValue(king), { monk: aiFrogValue(monk), king: aiFrogValue(king) });
ok('스킬 없는 유닛(창병) 개구리 가치 0', aiFrogValue(spear) === 0, aiFrogValue(spear));
ok('수도승 개구리 가치 > 지휘관', aiFrogValue(monk) > aiFrogValue(commander), { monk: aiFrogValue(monk), commander: aiFrogValue(commander) });

// ── AI 저주 결정: 그리폰+갑주무사 → 갑주무사 저주(그리폰 배제) ──
{
  const room = createRoom('cf' + Math.random().toString(36).slice(2, 6), { mode: '1v1' });
  room.isAI = true; room._headless = true; room.phase = 'game';
  room.turnNumber = 6; room.currentPlayerIdx = 1; room.sp = [8, 8]; room.instantSp = [0, 0];
  const g = P('griffin', 3); g.col = 0; g.row = 0;
  const aw = P('armoredWarrior', 4); aw.col = 1; aw.row = 1;
  const witch = P('witch', 3); witch.col = 2; witch.row = 2;
  room.players[0] = { socketId: 's0', name: 'H', index: 0, pieces: [g, aw], actionDone: false, skillsUsedBeforeAction: [] };
  room.players[1] = { socketId: 'AI', name: 'AI', index: 1, pieces: [witch], actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [], _decreeUnit: null };
  rooms[room.id] = room;
  // aiCurseValue 로 타겟 선정 재현(1v1 저주 결정 로직과 동일 정렬)
  const enemies = room.players[0].pieces.filter(p => p.alive && p.hp > 1);
  const opts = { lastEnemy: enemies.length === 1, enemyHasOberon: false };
  enemies.sort((a, b) => aiCurseValue(b, opts) - aiCurseValue(a, opts));
  ok('AI 저주 타겟 = 갑주무사(그리폰 아님)', enemies[0].type === 'armoredWarrior', enemies[0].type);
  ok('그리폰만 있으면(비최후 아님) 저주 미시전 판정', aiCurseValue(g, opts) <= 0, aiCurseValue(g, opts));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
