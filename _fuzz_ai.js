// AI 추론 함수 퍼징 — 유해/쥐/다중피격/지휘관/미스메모리/표식을 엣지 입력으로 반복 호출, 크래시 검출.
require('dotenv').config({ path: '.env' });
const S = require('./server.js');
const { getAttackCells, initAiBrain, aiObserveEnemyAttack, aiInjectMarkedEnemies, aiClearOwnCells,
        aiSpreadProbability, aiProcessAttackResult, aiBestTargetCell, getEnemyIndices } = S;

const TYPES = ['spearman','cavalry','watchman','scout','archer','general','knight','witch','shadowAssassin',
  'bodyguard','armoredWarrior','commander','slaughterHero','sulfurCauldron','monk','herbalist','king','torturer'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const bounds = { min: 0, max: 4 };

function randPiece(type) {
  return { type, atk: rnd(4), alive: Math.random() < 0.9, col: rnd(5), row: rnd(5),
    hp: 1 + rnd(4), maxHp: 4, tier: 1 + rnd(3), hasSkill: Math.random() < 0.5,
    skillId: pick(['curse','dragon','ring','bomb','recon',null]), skillCost: rnd(5),
    statusEffects: Math.random() < 0.3 ? [{ type: pick(['mark','curse','shadow']) }] : [] };
}
function randRoom() {
  const mk = () => Array.from({ length: 1 + rnd(3) }, () => randPiece(pick(TYPES)));
  const room = {
    mode: 'pvp', boardBounds: bounds,
    sp: [rnd(11), rnd(11)], instantSp: [rnd(3), rnd(3)],
    players: [{ teamId: 0, pieces: mk() }, { teamId: 1, pieces: mk() }],
    remains: Math.random() < 0.5 ? Array.from({ length: rnd(4) }, () => ({ col: rnd(5), row: rnd(5), hits: rnd(3) })) : undefined,
    rats: Math.random() < 0.5 ? [Array.from({ length: rnd(3) }, () => ({ col: rnd(5), row: rnd(5) })), []] : undefined,
  };
  return room;
}

let crashes = 0, runs = 0;
const t0 = Date.now();
for (let i = 0; i < 60000; i++) {
  runs++;
  try {
    const room = randRoom();
    const brain = initAiBrain(5);
    brain.turnCount = rnd(40);
    const own = room.players[1].pieces;
    const attackers = room.players[0].pieces;
    // 공격 범위 = 무작위 공격자 타입의 footprint (가끔 빈 배열·범위밖 포함)
    let atkCells = [];
    try { atkCells = getAttackCells(pick(TYPES), rnd(5), rnd(5), bounds, {}); } catch (e) {}
    if (Math.random() < 0.2) atkCells = [];
    if (Math.random() < 0.2) atkCells = atkCells.concat([{ col: 9, row: -3 }, { col: -1, row: 7 }]);  // 범위 밖
    // hitResults: own 일부 + damage (가끔 초과피해로 사기증진 추론 발동)
    const hitResults = own.filter(() => Math.random() < 0.5)
      .map(p => ({ col: p.col, row: p.row, damage: rnd(6), destroyed: Math.random() < 0.3 }));

    aiSpreadProbability(brain);
    aiObserveEnemyAttack(brain, room, own, attackers, atkCells, hitResults);
    aiProcessAttackResult(brain, atkCells, hitResults, attackers[0]);
    aiClearOwnCells(brain, room, 1);
    aiInjectMarkedEnemies(brain, room, 1);
    // 두 번째 관측(교차턴 교집합·미스메모리 경로)
    aiObserveEnemyAttack(brain, room, own, attackers, atkCells, hitResults.slice(0, 1));
    if (own[0]) aiBestTargetCell(brain, own[0], room);
  } catch (e) {
    crashes++;
    if (crashes <= 5) console.log(`CRASH #${crashes}:`, e.message, '\n', (e.stack || '').split('\n')[1]);
  }
}
console.log(`\n퍼징 ${runs}회 (${Date.now() - t0}ms): 크래시 ${crashes}건`);
process.exit(0);
