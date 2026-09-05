// ═══════════════════════════════════════════════════════════════
// CALIGO — 가챠/크레딧 공유 설정 (서버 + 클라 공용 상수)
// ───────────────────────────────────────────────────────────────
// 기본 공개 9종(로그인 없이도 플레이 가능), 티어별 뽑기 비용, 크레딧 보상표.
// 서버는 require, 클라는 로그인/설정 payload 로 전달받아 동일 값을 공유.
// ═══════════════════════════════════════════════════════════════

// ── 기본 공개 캐릭터 9종 (팩션×티어 각 1) — 미로그인/신규 계정도 항상 보유 ──
//   왕실: 창병·기사·왕자 / 악인: 인간사냥꾼·그림자암살자·광전사 / 정령: 약초전문가·마법사·드래곤조련사
const BASE_TYPES = [
  'spearman', 'manhunter', 'herbalist',      // T1 (royal / villain / spirit)
  'knight', 'shadowAssassin', 'wizard',      // T2
  'prince', 'slaughterHero', 'dragonTamer',  // T3
];
const BASE_SET = new Set(BASE_TYPES);

// ── 튜토리얼 완료(승리) 보상 캐릭터 — 가챠 풀에서 제외, 튜토리얼 클리어 시에만 지급 ──
const TUTORIAL_REWARD_TYPES = ['general', 'commander'];
const TUTORIAL_REWARD_SET = new Set(TUTORIAL_REWARD_TYPES);

// ── 티어별 뽑기 비용 (크레딧) ──
const TIER_COST = { 1: 10, 2: 20, 3: 30 };

// ── 크레딧 보상표 ──
const REWARDS = {
  signup: 30,        // 최초 계정 생성
  attendance: 3,     // 매일 출석(자국 자정 기준)
  aiWin: 2, aiLoss: 1,
  pvpWin: 5, pvpLoss: 2,      // 1v1
  teamWin: 5, teamLoss: 2,    // 2v2 (팀원 각자)
  perfectBonus: 5,   // 퍼펙트(아군 무사망) 추가 → 승리보상 + 5
};

// 특정 티어에서 뽑기 가능한 풀(=그 티어 수집형 전체 − 기본 3종). CHARACTERS 를 인자로 받아 계산.
//   summon 전용 유닛(드래곤·쥐 등)은 CHARACTERS 에 없으므로 자동 제외됨.
function poolForTier(CHARACTERS, tier) {
  const list = (CHARACTERS && CHARACTERS[tier]) || [];
  // 기본 9종 + 튜토리얼 보상(장군·지휘관)은 가챠 풀에서 제외.
  return list.map(c => c.type).filter(t => !BASE_SET.has(t) && !TUTORIAL_REWARD_SET.has(t));
}

// 유효 보유 목록 = 기본 9 ∪ 가챠 획득분. (base 는 저장 안 하고 항상 포함)
function effectiveOwned(gachaOwned) {
  const set = new Set(BASE_TYPES);
  (gachaOwned || []).forEach(t => set.add(t));
  return set;
}

module.exports = { BASE_TYPES, BASE_SET, TUTORIAL_REWARD_TYPES, TUTORIAL_REWARD_SET, TIER_COST, REWARDS, poolForTier, effectiveOwned };
