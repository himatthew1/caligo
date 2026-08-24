// CALIGO AI 후보덱 목록 (server.js 에서 분리된 편집용 데이터 파일)
// 이 배열만 고치면 AI 픽이 바뀝니다. 형식은 아래 주석 참고.
// aiSelectPieces() 가 이 목록에서 무작위 선택(시너지 결함은 _aiDraftSynergyBad 안전망).

// ★ AI 큐레이션 덱 50종 — 20 순수 팩션(팩션당 하이라이트 5) + 30 하이브리드(2팩션 이상 혼합).
//   서포트 스킬 역이용(마법사 SP뻥튀기·인어 자해로 발동패시브 유도·검투사 투지·백작 흡혈·철인 might 등)과
//   견제 대상까지 의식해 구성. 팩션 지원 능력엔 그 팩션 유닛 필수(오베론→정령2+, 마왕→악인, 공주 후원자→왕실).
//   { n: 이름, d: [t1,t2,t3], c: 콤보 의도, k: 견제(어떤 픽에 강한가) }
const AI_DECK_LIST = [
  // ── 순수 왕실(Royal) 5 ──
  { n: '왕실 근위대',   d: ['spearman', 'bodyguard', 'princess'],           c: '후원자 HP+1 + 호위무사가 왕실 대신 피해', k: '단일 저격·버스트 덱(호위 보호)' },
  { n: '총사령부',     d: ['messenger', 'general', 'king'],                c: '칙명+부대공격 다중행동 + 반지 진형붕괴', k: '느린 위치의존 덱' },
  { n: '사기충천 돌격대', d: ['cavalry', 'knight', 'commander'],             c: '사기증진 인접버프 + 기마 질주 러시', k: '수비·터틀 덱' },
  { n: '계승의 왕좌',   d: ['scout', 'knight', 'prince'],                   c: '정찰 + 왕실 다수로 계승자 공격력↑', k: '은신·블라인드 덱(정찰 공개)' },
  { n: '폭군의 칙령',   d: ['messenger', 'courtier', 'king'],              c: '탄압으로 적 스킬 SP+1 봉쇄 + 칙명·반지', k: '스킬 콤보 의존 덱(탄압)' },
  // ── 순수 악인(Villain) 5 ──
  { n: '어둠의 장막',   d: ['manhunter', 'shadowAssassin', 'demonKing'],   c: '어둠장막이 비악인 적 공격 1칸 봉인(악인 면제)', k: '고정 사거리 공격수(창병·파수꾼)' },
  { n: '저주받은 밤',   d: ['poisoner', 'witch', 'torturer'],              c: '독+저주+악몽 지속뎀(감쇄 우회)', k: '힐탱·아이언스킨 덱' },
  { n: '망자의 군세',   d: ['gravekeeper', 'necromancer', 'undead'],       c: '유해→악령 물량 + 불사 언데드', k: '소모전·보드장악 덱' },
  { n: '학살의 광기',   d: ['hookKiller', 'shadowAssassin', 'slaughterHero'], c: '가로 횡+3×3 학살 광역', k: '밀집 포메이션·클러스터' },
  { n: '흡혈 귀족회',   d: ['poisoner', 'witch', 'count'],                 c: '독+저주+흡혈 상한돌파', k: '왕실 다수·고체력 덱' },
  // ── 순수 정령(Spirit) 5 ──
  { n: '정령왕의 군세', d: ['fairy', 'griffin', 'oberon'],                 c: '요정왕 축복/은혜로 정령 공·체 버프', k: '스탯 체크 덱(버프로 능가)' },
  { n: '백은의 성역',   d: ['herbalist', 'unicorn', 'monk'],               c: '유니콘 면역 + 약초·신성 힐 방벽', k: '상태이상(저주·표식·독) 덱' },
  { n: '유황의 정령술', d: ['mermaid', 'wizard', 'sulfurCauldron'],        c: '사이렌+마법사 SP → 유황 테두리 광역', k: '외곽·테두리 이동 덱' },
  { n: '드래곤의 둥지', d: ['herbalist', 'dryad', 'dragonTamer'],          c: '정령 서포트 + 드래곤 소환 화력', k: '단일 위협·저화력 덱' },
  { n: '폭풍의 창공',   d: ['windSurfer', 'griffin', 'sulfurCauldron'],    c: '바람몰이로 외곽 몰이 → 유황·격노', k: '포메이션 의존 덱(몰이 붕괴)' },
  // ── 순수 무팩션(No-faction) 5 ──
  { n: '강철 용병단',   d: ['gunpowder', 'armoredWarrior', 'mercenary'],   c: '폭탄+아이언스킨 탱크+용병 화력', k: '저티어 러시(감쇄)' },
  { n: '검투장의 영웅', d: ['wanderer', 'dualBlade', 'gladiator'],         c: '쌍검무 2타 + 투지(스킬없는 아군 힐+사기)', k: '스킬없는 깡스탯 미러' },
  { n: '민병 저항군',   d: ['watchman', 'weaponSmith', 'militia'],         c: '광역 파수+정비+민병(atk3)', k: '밀집 소규모 교전' },
  { n: '변이 실험체',   d: ['thief', 'ironman', 'homunculus'],             c: 'might(HP비례)+변이+강탈 트릭', k: '적응·유연 필요 매치' },
  { n: '운명의 도박판', d: ['fortuneTeller', 'storyteller', 'mercenary'],  c: '흉조+선동(배신) 교란', k: '시너지 의존 덱(선동 붕괴)' },
  // ── 하이브리드 30 (2팩션 이상 혼합) ──
  { n: '마력 폭발',     d: ['gunpowder', 'wizard', 'dragonTamer'],         c: '마법사 피격 SP 뻥튀기→5SP 드래곤 조기소환 + 폭탄 압박', k: '느린 후반 스케일 덱' },
  { n: '사이렌 반응진', d: ['mermaid', 'griffin', 'torturer'],             c: '사이렌 송이 아군 그리폰 때려 격노 발동+전체 0.5딜, 표식→악몽', k: '밀집·저체력 물량' },
  { n: '반지의 마술사', d: ['scout', 'wizard', 'king'],                    c: '정찰+마법사 SP→반지로 핵심 유닛 이탈', k: '지휘관 클러스터·포메이션' },
  { n: '지휘관의 그림자', d: ['watchman', 'shadowAssassin', 'commander'],   c: '사기증진(팩션무관)으로 파수꾼8칸·암살 직격 강화', k: '뭉치는 저체력 다수' },
  { n: '철인 수도회',   d: ['herbalist', 'ironman', 'monk'],               c: '약초+신성 힐로 철인 HP 유지→might 공격력 폭등', k: '저격·버스트 부재 덱' },
  { n: '흡혈 왕정',     d: ['scout', 'witch', 'count'],                    c: '백작 흡혈로 적 왕실 상한 흡수+저주 지속', k: '왕실 다수·고체력 탱커' },
  { n: '표식 추적대',   d: ['scout', 'heretic', 'torturer'],               c: '정찰 공개+현혹 소속교란+표식→악몽', k: '은신·블라인드 덱' },
  { n: '투지의 방벽',   d: ['watchman', 'armoredWarrior', 'commander'],    c: '사기증진+아이언스킨 방벽으로 광역 유닛 강화', k: '저티어 러시' },
  { n: '성기사단',     d: ['spearman', 'unicorn', 'monk'],                c: '유니콘 면역+신성으로 왕실 전선 유지', k: '상태이상 콤보덱' },
  { n: '폭풍 기사단',   d: ['windSurfer', 'knight', 'gladiator'],          c: '바람몰이로 적 밀어 기사 대각 직격+투지 러시', k: '라인 정렬·포메이션' },
  { n: '드래곤 근위',   d: ['scout', 'wizard', 'dragonTamer'],             c: '정찰+마법사 SP 수급→드래곤 소환', k: '정보열위·저화력 덱' },
  { n: '저주받은 왕실', d: ['messenger', 'witch', 'king'],                 c: '저주 지속뎀+칙명 템포+반지', k: '소수 정예·왕실 덱' },
  { n: '폭탄 사령관',   d: ['gunpowder', 'knight', 'commander'],           c: '사기증진 폭탄 화력 + 기사 대각 직격', k: '밀집 클러스터' },
  { n: '신성 방패병',   d: ['spearman', 'armoredWarrior', 'monk'],         c: '아이언스킨+신성 힐 왕실 전선', k: '저티어 러시·악인 덱(가호)' },
  { n: '독의 궁정',     d: ['poisoner', 'courtier', 'count'],              c: '독+흡혈 소모 + 탄압으로 적 스킬 봉쇄', k: '스킬 콤보·고체력 지구전 덱' },
  { n: '유황 폭격대',   d: ['gunpowder', 'wizard', 'sulfurCauldron'],      c: '마법사 SP 조기→유황 테두리+폭탄 이중 광역', k: '밀집·외곽 이동 덱' },
  { n: '요정 검투사',   d: ['fairy', 'dualBlade', 'gladiator'],            c: '투지로 검객 힐+사기→쌍검무 2타 극대화', k: '스킬없는 깡스탯 덱' },
  { n: '마왕의 첩자',   d: ['manhunter', 'wizard', 'demonKing'],           c: '어둠장막 봉인+마법사 SP 수급(악인 면제)', k: '고정 사거리 공격수' },
  { n: '표식 저격',     d: ['scout', 'wizard', 'torturer'],                c: '정찰+표식→악몽 + 마법사 SP', k: '은신·블라인드 덱' },
  { n: '방벽 흡혈',     d: ['spearman', 'bodyguard', 'count'],             c: '창병 전선+성지기 방벽+흡혈 상한돌파', k: '왕실 미러·고체력' },
  { n: '유황 기병',     d: ['cavalry', 'griffin', 'sulfurCauldron'],       c: '질주+격노+유황 테두리 광역', k: '외곽·포메이션 덱' },
  { n: '강령 왕정',     d: ['messenger', 'necromancer', 'count'],          c: '강령 물량+흡혈+칙명 템포', k: '물량전·소모전' },
  { n: '정령 사령부',   d: ['archer', 'knight', 'commander'],              c: '사기증진으로 엘프 대각+기사 화력 강화', k: '뭉치는 덱' },
  { n: '신성 폭발',     d: ['gunpowder', 'armoredWarrior', 'monk'],        c: '폭탄+아이언스킨+신성 힐 전선', k: '악인 덱(가호)·저티어' },
  { n: '그림자 폭탄',   d: ['gunpowder', 'shadowAssassin', 'slaughterHero'], c: '폭탄+은신+3×3 학살 광역', k: '밀집 클러스터' },
  { n: '후원 창공',     d: ['spearman', 'griffin', 'princess'],            c: '후원자로 왕실 HP+1 + 그리폰 격노 화력', k: '저격 부재 덱' },
  { n: '현혹 기병',     d: ['cavalry', 'heretic', 'gladiator'],            c: '질주+현혹 소속교란+투지 사기', k: '시너지 의존 덱' },
  { n: '마법 학살',     d: ['scout', 'wizard', 'slaughterHero'],           c: '정찰로 위치확보→마법사 SP+학살 3×3 광역', k: '밀집 클러스터' },
  { n: '정찰 흡혈',     d: ['scout', 'shadowAssassin', 'count'],           c: '정찰+은신 직격+흡혈 상한돌파', k: '왕실·정보열위 덱' },
  { n: '요정 반지',     d: ['fairy', 'wizard', 'king'],                    c: '요정+마법사 SP 수급→절대복종 반지', k: '포메이션(반지 해체)' },
];

module.exports = { AI_DECK_LIST };
