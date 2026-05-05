const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

// #9: 재접속용 토큰 생성
function genSessionToken() {
  return crypto.randomBytes(16).toString('hex');
}
const RECONNECT_GRACE_MS = 30000;  // 30초 유예

// ── 글로벌 에러 핸들러 (서버 크래시 방지) ──
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err.message, err.stack);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});

const ROW_LABELS = ['A','B','C','D','E','F','G'];
function coord(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }

// 한국어 조사 자동 변환 — 마지막 글자의 받침 유무로 with받침/without받침 선택.
//   한글이 아니거나 빈 문자열이면 without받침 반환.
//   사용: `${name}${조사(name, '이', '가')} 이동` → 받침 있으면 '이', 없으면 '가'
function 조사(word, with받침, without받침) {
  if (!word || typeof word !== 'string') return without받침;
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return without받침;
  const hasJongseong = (last - 0xAC00) % 28 !== 0;
  return hasJongseong ? with받침 : without받침;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '8mb' }));

// 스크린샷 저장 엔드포인트 — 클라이언트가 보낸 dataURL을 screenshots/ 폴더에 저장
const fs = require('fs');
const screenshotDir = path.join(__dirname, 'screenshots');
try { if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true }); } catch (e) {}
app.post('/__save_shot', (req, res) => {
  try {
    const { name, data } = req.body || {};
    if (!name || !data) return res.status(400).json({ ok: false, msg: 'name/data required' });
    const safeName = String(name).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 80);
    const m = String(data).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, msg: 'invalid data URL' });
    const buf = Buffer.from(m[2], 'base64');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = path.join(screenshotDir, `${safeName}.${ext}`);
    fs.writeFileSync(file, buf);
    res.json({ ok: true, path: file });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// ── 캐릭터 데이터 (30 characters across 3 tiers) ────────────────
// ══════════════════════════════════════════════════════════════════

const CHARACTERS = {
  1: [
    { type:'archer', name:'궁수', tier:1, atk:1, icon:'🏹', tag:null, desc:'위치한 곳 좌측 대각선 전체 공격',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'공격 범위 반전'}] },
    { type:'spearman', name:'창병', tier:1, atk:1, icon:'🔱', tag:'royal', desc:'위치한 곳 세로줄 전체 공격', skills:[] },
    { type:'cavalry', name:'기마병', tier:1, atk:1, icon:'🐎', tag:'royal', desc:'위치한 곳 가로줄 전체 공격', skills:[] },
    { type:'watchman', name:'파수꾼', tier:1, atk:0.5, icon:'👁', tag:null, desc:'주변 8칸 · 자기 제외', skills:[] },
    { type:'twins', name:'쌍둥이 강도', tier:1, atk:1, icon:'👫', tag:'villain', desc:'누나 가로 3칸 / 동생 세로 3칸', isTwin:true,
      skills:[{id:'brothers', name:'분신', cost:2, replacesAction:true, desc:'누나가 동생 위치로, 또는 동생이 누나 위치로 합류'}] },
    { type:'scout', name:'척후병', tier:1, atk:1, icon:'🔭', tag:'royal', desc:'자신 포함 가로 3칸',
      skills:[{id:'recon', name:'정찰', cost:2, replacesAction:false, desc:'랜덤 적 1개의 행 또는 열 공개'}] },
    { type:'manhunter', name:'인간 사냥꾼', tier:1, atk:1, icon:'🪤', tag:'villain', desc:'자신 포함 세로 3칸',
      skills:[{id:'trap', name:'덫 설치', cost:2, replacesAction:true, desc:'현재 위치에 덫 설치 · 작동 시 2 피해'}] },
    { type:'messenger', name:'전령', tier:1, atk:0.5, icon:'📯', tag:null, desc:'X대각선 5칸 · 자신 포함',
      skills:[{id:'sprint', name:'질주', cost:1, replacesAction:false, oncePerTurn:true, desc:'이번 턴 이동 2회 실행'}] },
    { type:'gunpowder', name:'화약상', tier:1, atk:1, icon:'💣', tag:null, desc:'상하 각2칸 · 자기 제외',
      skills:[
        {id:'bomb', name:'폭탄 설치', cost:2, replacesAction:false, desc:'주변 8칸 중 한 곳에 폭탄 설치'},
        {id:'detonate', name:'기폭', cost:0, replacesAction:false, oncePerTurn:true, desc:'설치된 폭탄 전부 폭발 · 1 피해'}
      ] },
    { type:'herbalist', name:'약초전문가', tier:1, atk:1, icon:'🌿', tag:null, desc:'좌우 각2칸 · 자기 제외',
      skills:[{id:'herb', name:'약초학', cost:2, replacesAction:false, desc:'자신 제외 주변 모든 아군 체력 1 회복'}] },
  ],
  2: [
    { type:'general', name:'장군', tier:2, atk:2, icon:'🎖', tag:'royal', desc:'자신 포함 십자 5칸', skills:[] },
    { type:'knight', name:'기사', tier:2, atk:2, icon:'🐴', tag:'royal', desc:'자신 포함 X대각선 5칸', skills:[] },
    { type:'shadowAssassin', name:'그림자 암살자', tier:2, atk:2, icon:'🗡', tag:'villain', desc:'주변 9칸 중 1칸 선택 공격',
      skills:[{id:'shadow', name:'그림자 숨기', cost:1, replacesAction:false, oncePerTurn:true, desc:'다음 턴까지 공격과 상태이상에 면역'}] },
    { type:'wizard', name:'마법사', tier:2, atk:2, icon:'🧙', tag:null, desc:'한칸 건너뛴 십자 4칸',
      skills:[], passives:['instantMagic'] },
    { type:'armoredWarrior', name:'갑주무사', tier:2, atk:2, icon:'🛡', tag:null, desc:'자신 + 아래 가로3칸 · 총 4칸',
      skills:[], passives:['ironSkin'] },
    { type:'witch', name:'마녀', tier:2, atk:1, icon:'🧹', tag:'villain', desc:'전체 보드 중 1칸 선택 공격',
      skills:[{id:'curse', name:'저주', cost:3, replacesAction:true, desc:'적 1명에게 저주 부여'}] },
    { type:'dualBlade', name:'양손 검객', tier:2, atk:2, icon:'⚔', tag:null, desc:'좌우 대각선 4칸 · col±1, row±1',
      skills:[{id:'dualStrike', name:'쌍검무', cost:2, replacesAction:false, oncePerTurn:true, desc:'이번 턴 공격 2회 실행'}] },
    { type:'ratMerchant', name:'쥐 장수', tier:2, atk:1, icon:'🐀', tag:'villain', desc:'제자리와 쥐가 소환된 칸 공격',
      skills:[{id:'rats', name:'역병의 자손들', cost:2, replacesAction:false, desc:'쥐가 없는 랜덤 타일 세 곳에 쥐 소환'}] },
    { type:'weaponSmith', name:'무기상', tier:2, atk:2, icon:'⚒', tag:null, desc:'가로 3칸을 공격',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'가로 혹은 세로 공격 범위 전환'}] },
    { type:'bodyguard', name:'호위 무사', tier:2, atk:1, icon:'🛡️', tag:'royal', desc:'십자 4칸 · 자기 제외',
      skills:[], passives:['loyalty'] },
  ],
  3: [
    { type:'prince', name:'왕자', tier:3, atk:3, icon:'👑', tag:'royal', desc:'자신 포함 좌우 3칸', skills:[] },
    { type:'princess', name:'공주', tier:3, atk:3, icon:'🌸', tag:'royal', desc:'자신 포함 상하 3칸', skills:[] },
    { type:'king', name:'국왕', tier:3, atk:2, icon:'♛', tag:'royal', desc:'자신의 칸',
      skills:[{id:'ring', name:'절대복종 반지', cost:3, replacesAction:false, desc:'적 유닛 하나의 위치 강제 이동'}] },
    { type:'dragonTamer', name:'드래곤 조련사', tier:3, atk:2, icon:'🐉', tag:null, desc:'X대각선 4칸 · 자기 제외',
      skills:[{id:'dragon', name:'드래곤 소환', cost:5, replacesAction:false, oncePerTurn:true, desc:'드래곤 유닛 소환'}] },
    { type:'monk', name:'수도승', tier:3, atk:1, icon:'🙏', tag:null, desc:'상하 각1칸 · 자기 제외',
      skills:[{id:'divine', name:'신성', cost:3, replacesAction:false, desc:'자신 제외 아군 한명 체력을 2 회복하고 상태 이상 제거'}],
      passives:['grace'] },
    { type:'slaughterHero', name:'학살 영웅', tier:3, atk:1, icon:'🪓', tag:'villain', desc:'3x3 전체 9칸',
      skills:[], passives:['betrayer'] },
    { type:'commander', name:'지휘관', tier:3, atk:2, icon:'📋', tag:'royal', desc:'좌우 각1칸 · 자기 제외',
      skills:[], passives:['wrath'] },
    { type:'sulfurCauldron', name:'유황이 끓는 솥', tier:3, atk:0.5, icon:'🔥', tag:'royal', desc:'주변 8칸 · 자기 제외',
      skills:[{id:'sulfurRiver', name:'유황범람', cost:3, replacesAction:true, desc:'보드 테두리 전체 공격 · 2 피해'}] },
    { type:'torturer', name:'고문 기술자', tier:3, atk:2, icon:'⛓', tag:'villain', desc:'자신 + 바로 아래 · 총 2칸',
      skills:[{id:'nightmare', name:'악몽', cost:2, replacesAction:false, desc:'표식 상태의 모든 적에게 1 피해'}],
      passives:['markPassive'] },
    { type:'count', name:'백작', tier:3, atk:2, icon:'🦇', tag:'villain', desc:'X대각선 5칸 · 자신 포함',
      skills:[], passives:['tyranny'] },
  ]
};

const ALL_CHARS = Object.values(CHARACTERS).flat();
const getChar = (type) => ALL_CHARS.find(c => c.type === type);

// Helper: find skill data from CHARACTERS definition
function getSkillData(pieceType, skillId) {
  const baseType = pieceType === 'twins_elder' || pieceType === 'twins_younger' ? 'twins' : pieceType;
  const charDef = ALL_CHARS.find(c => c.type === baseType);
  if (!charDef || !charDef.skills) return null;
  return charDef.skills.find(s => s.id === skillId) || null;
}

// ══════════════════════════════════════════════════════════════════
// ── 공격 범위 계산 ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function inBounds(col, row, bounds) {
  return col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max;
}

function getAttackCells(type, col, row, bounds, extra) {
  extra = extra || {};
  const b = bounds || { min: 0, max: 4 };
  const cells = [];
  const push = (c, r) => { if (inBounds(c, r, b)) cells.push({ col: c, row: r }); };

  switch (type) {
    // ── TIER 1 ──
    case 'archer': {
      if (extra.toggleState === 'right') {
        const d = col - row;
        for (let c = b.min; c <= b.max; c++) {
          const r = c - d;
          if (r >= b.min && r <= b.max) push(c, r);
        }
      } else {
        const d = col + row;
        for (let c = b.min; c <= b.max; c++) {
          const r = d - c;
          if (r >= b.min && r <= b.max) push(c, r);
        }
      }
      break;
    }
    case 'spearman':
      for (let r = b.min; r <= b.max; r++) push(col, r);
      break;
    case 'cavalry':
      for (let c = b.min; c <= b.max; c++) push(c, row);
      break;
    case 'watchman':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          if (dc !== 0 || dr !== 0) push(col + dc, row + dr);
      break;
    case 'twins_elder':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'twins_younger':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'scout':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'manhunter':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'messenger':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'gunpowder':
      push(col, row - 1); push(col, row - 2);
      push(col, row + 1); push(col, row + 2);
      break;
    case 'herbalist':
      push(col - 1, row); push(col - 2, row);
      push(col + 1, row); push(col + 2, row);
      break;

    // ── TIER 2 ──
    case 'general':
      push(col, row);
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;
    case 'knight':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'shadowAssassin':
      if (extra.tCol !== undefined && extra.tRow !== undefined) {
        push(extra.tCol, extra.tRow);
      } else {
        push(col, row);
      }
      break;
    case 'wizard':
      push(col, row - 2); push(col, row + 2);
      push(col - 2, row); push(col + 2, row);
      break;
    case 'armoredWarrior':
      push(col, row);
      push(col - 1, row + 1); push(col, row + 1); push(col + 1, row + 1);
      break;
    case 'witch':
      if (extra.tCol !== undefined && extra.tRow !== undefined) {
        push(extra.tCol, extra.tRow);
      }
      break;
    case 'dualBlade':
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'ratMerchant':
      push(col, row);
      if (extra.rats) {
        for (const rat of extra.rats) push(rat.col, rat.row);
      }
      break;
    case 'weaponSmith':
      if (extra.toggleState === 'vertical') {
        push(col, row); push(col, row - 1); push(col, row + 1);
      } else {
        push(col, row); push(col - 1, row); push(col + 1, row);
      }
      break;
    case 'bodyguard':
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;

    // ── TIER 3 ──
    case 'prince':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'princess':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'king':
      push(col, row);
      break;
    case 'dragonTamer':
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'dragon':
      push(col, row);
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;
    case 'monk':
      push(col, row - 1);
      push(col, row + 1);
      break;
    case 'slaughterHero':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          push(col + dc, row + dr);
      break;
    case 'commander':
      push(col - 1, row);
      push(col + 1, row);
      break;
    case 'sulfurCauldron':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          if (dc !== 0 || dr !== 0) push(col + dc, row + dr);
      break;
    case 'torturer':
      push(col, row); push(col, row + 1);
      break;
    case 'count':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
  }
  return cells;
}

// Get border cells for sulfurCauldron skill
function getBorderCells(bounds) {
  const cells = [];
  for (let c = bounds.min; c <= bounds.max; c++) {
    cells.push({ col: c, row: bounds.min });
    cells.push({ col: c, row: bounds.max });
  }
  for (let r = bounds.min + 1; r < bounds.max; r++) {
    cells.push({ col: bounds.min, row: r });
    cells.push({ col: bounds.max, row: r });
  }
  return cells;
}

function isCrossAdjacent(c1, r1, c2, r2) {
  const dc = Math.abs(c1 - c2), dr = Math.abs(r1 - r2);
  return (dc === 1 && dr === 0) || (dc === 0 && dr === 1);
}

// ══════════════════════════════════════════════════════════════════
// ── 방(Room) 관리 ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const rooms = {};

function createRoom(id, opts = {}) {
  const mode = opts.mode || 'pvp';             // 'pvp' (1v1) | 'team' (2v2)
  const playerCount = mode === 'team' ? 4 : 2;
  return {
    id,
    mode,                                       // NEW
    playerCount,                                // NEW
    players: [],
    phase: 'waiting',      // waiting -> draft -> initial_reveal -> exchange_draft -> final_reveal -> hp_distribution -> placement -> game -> ended
    currentPlayerIdx: 0,
    turnNumber: 0,
    // 인원수에 따라 동적으로 초기화
    draftDone:         Array(playerCount).fill(false),
    hpDone:            Array(playerCount).fill(false),
    initialRevealDone: Array(playerCount).fill(false),
    exchangeDone:      Array(playerCount).fill(false),
    finalRevealDone:   Array(playerCount).fill(false),
    revealDone:        Array(playerCount).fill(false),   // kept for legacy compatibility
    placementDone:     Array(playerCount).fill(false),
    isAI: false,
    // SP system: 1v1은 플레이어당, 팀전은 팀 풀. 인덱스 0/1은 1v1=p0/p1, 팀전=teamA/teamB
    sp: [1, 1],
    instantSp: [0, 0],
    // Board bounds — 팀전은 7×7로 시작
    boardBounds: mode === 'team' ? { min: 0, max: 6 } : { min: 0, max: 4 },
    // 보드 축소 레벨 — LV4=7×7, LV3=5×5, LV2=3×3, LV1=1×1.
    //   1v1 init=LV3 (full 5×5), 팀전 init=LV4 (full 7×7).
    //   매 트리거(turn-based, 1대1교전)마다 -1 까지 감소.
    boardShrinkLevel: mode === 'team' ? 4 : 3,
    boardShrunk: false,
    boardShrinkStage: 0,   // 0=초기, 1=첫 축소, 2=최종 축소
    stalemateShrinkTriggered: false,
    stalemateShrinkTurn: null,
    // Board objects: traps, bombs (per player arrays)
    boardObjects: Array(playerCount).fill(null).map(() => []),
    // Rats per player
    rats: Array(playerCount).fill(null).map(() => []),
    // Teams (팀전 전용, 1v1에서도 편의상 채워둠: teamA=[0], teamB=[1])
    teams: mode === 'team' ? [[], []] : [[0], [1]],
    eliminatedPlayers: new Set(),
    // Spectators
    spectators: [],
    // Timer
    timer: null,
    timerDeadline: null,
    // Chat colors
    chatColors: {},        // socketId -> color
    chatColorPool: ['#f87171','#fb923c','#fbbf24','#4ade80','#60a5fa','#a78bfa'],
    chatColorIdx: 0,
  };
}

// ── 팀/인덱스 헬퍼 ───────────────────────────────────────
function getTeamOf(room, idx) {
  if (room.mode !== 'team') return idx;  // 1v1: 팀=인덱스
  for (let t = 0; t < room.teams.length; t++) {
    if (room.teams[t].includes(idx)) return t;
  }
  return -1;
}
function getTeammates(room, idx) {
  if (room.mode !== 'team') return [];    // 1v1: 팀원 없음
  const t = getTeamOf(room, idx);
  if (t < 0) return [];
  return room.teams[t].filter(i => i !== idx);
}
function getEnemyIndices(room, idx) {
  if (room.mode !== 'team') return [1 - idx];
  const myTeam = getTeamOf(room, idx);
  const enemyTeam = 1 - myTeam;
  return [...(room.teams[enemyTeam] || [])];
}
function getEnemyTeamOf(room, idx) {
  if (room.mode !== 'team') return 1 - idx;
  return 1 - getTeamOf(room, idx);
}
function isTeammate(room, a, b) {
  if (a === b) return false;
  return getTeamOf(room, a) === getTeamOf(room, b);
}
// 두 말이 같은 편(본인 or 같은 팀)인지
function isAlly(room, pieceOwnerIdxA, pieceOwnerIdxB) {
  if (pieceOwnerIdxA === pieceOwnerIdxB) return true;
  return room.mode === 'team' && isTeammate(room, pieceOwnerIdxA, pieceOwnerIdxB);
}
// 본인 + 팀원 인덱스 배열 (아군 맥락)
function getAllyIndices(room, idx) {
  if (room.mode !== 'team') return [idx];
  const t = getTeamOf(room, idx);
  if (t < 0) return [idx];
  return [...room.teams[t]];
}
// 기본 상대 인덱스 (1v1 호환) — 단일 상대가 필요할 때
function getOpponentIdx(room, idx) {
  if (room.mode !== 'team') return 1 - idx;
  const enemies = getEnemyIndices(room, idx);
  return enemies[0];   // 팀모드에서 단일 상대 의미가 모호하니 사용처에서 주의
}
// SP/상태 배열 인덱스 — 1v1에서는 playerIdx, 팀전에서는 teamId
function teamSlotIdx(room, idx) {
  return room.mode === 'team' ? getTeamOf(room, idx) : idx;
}
// 탈락자(전멸/이탈/기권)인지
function isPlayerEliminated(room, idx) {
  if (room.eliminatedPlayers && room.eliminatedPlayers.has(idx)) return true;
  const p = room.players[idx];
  if (!p || !p.pieces) return false;
  return p.pieces.every(piece => !piece.alive);
}
// 팀 전멸 여부
function isTeamEliminated(room, teamId) {
  if (room.mode !== 'team') return false;
  const team = room.teams[teamId] || [];
  return team.every(idx => isPlayerEliminated(room, idx));
}
// 다음 턴 플레이어 계산
// 1v1: 단순 토글
// 팀전: 위치 기반 4-슬롯 순환 — 화면 분할 좌표 기준
//   pos 1 (좌상, slot 0): teamId=0, slotPos=0
//   pos 2 (우상, slot 1): teamId=1, slotPos=0
//   pos 3 (좌하, slot 2): teamId=0, slotPos=1
//   pos 4 (우하, slot 3): teamId=1, slotPos=1
// 정방향(1→2→3→4→1)으로 순환. 선이 누구든 wrap-around 로 진행.
// 슬롯의 본래 주인이 탈락하면 "같은 팀의 살아남은 멤버"가 그 슬롯의 차례를 대신 수행.
//   예: pos 2 탈락 시 [1, 4, 3, 4] (pos 4 가 자기 슬롯과 pos 2 슬롯을 모두 진행)
//   예: pos 1·2 탈락 시 [3, 4, 3, 4]
const TEAM_SLOT_KEYS = [
  [0, 0],  // slot 0 = pos 1
  [1, 0],  // slot 1 = pos 2
  [0, 1],  // slot 2 = pos 3
  [1, 1],  // slot 3 = pos 4
];

function getSlotIdxOfPlayer(player, room) {
  if (!player) return 0;
  const teamId = player.teamId ?? 0;
  // 팀 멤버 순서로 위치 결정 — slotPos 데이터에 의존하지 않음
  let posInTeam = 0;
  if (room && Array.isArray(room.teams?.[teamId])) {
    const teamArr = room.teams[teamId];
    posInTeam = teamArr.indexOf(player.index);
    if (posInTeam < 0) posInTeam = 0;
  } else {
    posInTeam = player.slotPos ?? 0;  // fallback
  }
  return posInTeam * 2 + teamId;
}

function buildTeamTurnOrder(room) {
  // slotPos 데이터에 의존하지 않음 — room.teams 배열의 멤버 순서를 슬롯 순서로 사용
  // pos 1 = blue[0], pos 2 = red[0], pos 3 = blue[1], pos 4 = red[1]
  const blue = (room.teams[0] || []).slice();
  const red  = (room.teams[1] || []).slice();
  const slotOwners = [blue[0], red[0], blue[1], red[1]];
  const order = [];
  for (let slotIdx = 0; slotIdx < slotOwners.length; slotIdx++) {
    let idx = slotOwners[slotIdx];
    if (idx == null) { order.push(-1); continue; }
    if (isPlayerEliminated(room, idx)) {
      // 본 슬롯 주인이 탈락 → 같은 팀의 살아있는 멤버로 대체
      const teamArr = (slotIdx === 0 || slotIdx === 2) ? blue : red;
      const survivor = teamArr.find(j => !isPlayerEliminated(room, j));
      if (survivor != null) idx = survivor;
      else { order.push(-1); continue; }
    }
    order.push(idx);
  }
  return order;
}

function getNextPlayerIdx(room) {
  if (room.mode !== 'team') return 1 - room.currentPlayerIdx;
  if (typeof room.turnSlotIdx !== 'number') {
    // 보호: turnSlotIdx 가 초기화 안된 상황 → currentPlayerIdx 의 슬롯에서 시작
    const cur = room.players[room.currentPlayerIdx];
    room.turnSlotIdx = getSlotIdxOfPlayer(cur, room);
  }
  // 정방향으로 다음 슬롯 (4슬롯 고정 순환)
  for (let offset = 1; offset <= TEAM_SLOT_KEYS.length; offset++) {
    const nextSlot = (room.turnSlotIdx + offset) % TEAM_SLOT_KEYS.length;
    const order = buildTeamTurnOrder(room);
    const candidate = order[nextSlot];
    if (candidate >= 0 && !isPlayerEliminated(room, candidate)) {
      room.turnSlotIdx = nextSlot;
      return candidate;
    }
  }
  return room.currentPlayerIdx;
}
// 팀전 대기실 상태 방송
function broadcastTeamRoomState(room) {
  if (!room || room.mode !== 'team') return;
  const payload = {
    roomId: room.id,
    players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId, slotPos: p.slotPos ?? 0, isAI: p.socketId === 'AI' })),
    teams: room.teams,
    count: room.players.length,
  };
  // 각 플레이어에게 자신의 idx도 포함해서 전송
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_room_state', { ...payload, myIdx: p.index });
  }
}

// 이전 턴 플레이어 (오류 메시지/로그용)
// turnSlotIdx 기반 — 현재 슬롯의 직전 슬롯의 주인
function getPrevPlayerIdx(room, curIdx) {
  if (room.mode !== 'team') return 1 - curIdx;
  if (typeof room.turnSlotIdx !== 'number') return curIdx;
  const order = buildTeamTurnOrder(room);
  for (let offset = 1; offset <= TEAM_SLOT_KEYS.length; offset++) {
    const prevSlot = (room.turnSlotIdx - offset + TEAM_SLOT_KEYS.length) % TEAM_SLOT_KEYS.length;
    const candidate = order[prevSlot];
    if (candidate >= 0) return candidate;
  }
  return curIdx;
}

function assignChatColor(room, socketId) {
  if (room.chatColors[socketId]) return room.chatColors[socketId];
  const pool = room.chatColorPool;
  const color = pool[room.chatColorIdx % pool.length];
  room.chatColorIdx++;
  room.chatColors[socketId] = color;
  return color;
}

// ── 타이머 시스템 ─────────────────────────────────────
const TIMER_SECONDS = 90;
const DRAFT_TIMER_SECONDS = 150;

function startTimer(room, phase, callback) {
  clearTimer(room);
  // 팀전 드래프트는 150초, 교환 드래프트는 60초, 그 외 팀 페이즈는 90초
  const longPhases = new Set(['draft', 'team_draft']);
  let sec;
  if (longPhases.has(phase)) sec = DRAFT_TIMER_SECONDS;
  else if (phase === 'exchange_draft') sec = 60;
  else sec = TIMER_SECONDS;
  room.timerDeadline = Date.now() + sec * 1000;
  emitToBothAndSpectators(room, 'timer_start', { seconds: sec, phase });
  room.timer = setTimeout(() => {
    room.timer = null;
    room.timerDeadline = null;
    if (room.phase !== 'ended') callback();
  }, sec * 1000);
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.timerDeadline = null;
  // ※ _aiThinkTimer 는 여기서 정리 안 함 — startTimer 가 내부에서 clearTimer 를 호출하기 때문에,
  //   transitionToExchangeDraft 처럼 [_aiThinkTimer 설정 → startTimer(60s 안전망) 설정] 순서일 때
  //   safety timer 가 AI 사고 타이머를 즉시 wipe 해버림. 게임 종료 경로에서 별도 호출(clearAiThinkState).
}

// 교환 페이즈 남은 시간 계산 — 페이즈 시작 시각 기준 공유 카운트다운.
//   누가 먼저 끝내든 "그 시점의 남은 시간" 으로 카운트다운 표시 (60초 풀타임 X).
function exchangeRemainingMs(room) {
  if (!room || !room._exchangeStart) return 60000;
  const max = room._exchangeMaxMs || 60000;
  return Math.max(500, max - (Date.now() - room._exchangeStart));
}

// AI 사고 타이머/메타데이터 명시적 정리 — endGame/endTeamGame/disconnect 등 stale fire 방지가 필요한 곳에서만 호출.
function clearAiThinkState(room) {
  if (!room) return;
  if (room._aiThinkTimer) {
    clearTimeout(room._aiThinkTimer);
    room._aiThinkTimer = null;
  }
  delete room._aiThinkStart;
  delete room._aiThinkMs;
}

function emitToBothAndSpectators(room, event, data) {
  for (const p of room.players) {
    if (p.socketId !== 'AI') io.to(p.socketId).emit(event, data);
  }
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

// ── 타이머 타임아웃 핸들러 ──────────────────────────────────

// 드래프트 타임아웃: 미선택 플레이어 랜덤 픽
function draftTimeout(room) {
  if (room.phase !== 'draft') return;
  for (let i = 0; i < 2; i++) {
    if (!room.draftDone[i] && room.players[i].socketId !== 'AI') {
      const browse = room.players[i]._browseDraft || {};
      const had1 = browse[1] || null;
      const had2 = browse[2] || null;
      const had3 = browse[3] || null;
      const t1 = had1 || randomPick(CHARACTERS[1]).type;
      const t2 = had2 || randomPick(CHARACTERS[2]).type;
      const t3 = had3 || randomPick(CHARACTERS[3]).type;
      room.players[i].draft = { t1, t2, t3 };
      room.draftDone[i] = true;
      const sock = io.sockets.sockets.get(room.players[i].socketId);
      if (sock) {
        const allFilled = had1 && had2 && had3;
        const timeoutMsg = allFilled ? '자동 확정' : '랜덤 선택';
        sock.emit('draft_ok', { t1, t2, t3, timeout: true, timeoutMsg });
      }
    }
  }
  if (room.draftDone.every(d => d)) {
    transitionToInitialReveal(room);
  }
}

// HP 분배 타임아웃: 미완료 플레이어 랜덤 HP
function hpTimeout(room) {
  if (room.phase !== 'hp_distribution') return;
  for (let i = 0; i < 2; i++) {
    if (!room.hpDone[i] && room.players[i].socketId !== 'AI') {
      const player = room.players[i];
      const hasTwins = player.draft.t1 === 'twins';
      // 랜덤 HP 분배 (합계 10, 각 최소 1, 최대 8)
      let hps;
      if (hasTwins) {
        hps = randomHpSplit(3, 10, 2); // twins tier min 2
      } else {
        hps = randomHpSplit(3, 10, 1);
      }
      player.hpDist = hps;
      const d = player.draft;
      if (hasTwins) {
        // 쌍둥이 자동 분배
        const twinHp = hps[0];
        const elder = Math.max(1, Math.floor(Math.random() * (twinHp - 1)) + 1);
        const younger = twinHp - elder;
        player.pieces = [
          createPiece('twins', 1, elder, { subUnit: 'elder', parentType: 'twins' }),
          createPiece('twins', 1, younger, { subUnit: 'younger', parentType: 'twins' }),
          createPiece(d.t2, 2, hps[1]),
          createPiece(d.t3, 3, hps[2]),
        ];
        player.pieces[0].type = 'twins_elder';
        player.pieces[1].type = 'twins_younger';
        player.twinSplitDone = true;
      } else {
        player.pieces = [
          createPiece(d.t1, 1, hps[0]),
          createPiece(d.t2, 2, hps[1]),
          createPiece(d.t3, 3, hps[2]),
        ];
      }
      room.hpDone[i] = true;
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('hp_ok', { hps, timeout: true });
    }
  }
  if (room.hpDone.every(d => d)) {
    transitionToPlacement(room);
  }
}

// 랜덤 HP 분배 헬퍼
function randomHpSplit(count, total, minVal) {
  const arr = new Array(count).fill(minVal);
  let remaining = total - count * minVal;
  while (remaining > 0) {
    const idx = Math.floor(Math.random() * count);
    if (arr[idx] < 8) { arr[idx]++; remaining--; }
  }
  return arr;
}

// 배치 타임아웃: 미배치 말 랜덤 배치
function placementTimeout(room) {
  if (room.phase !== 'placement') return;
  for (let i = 0; i < 2; i++) {
    if (!room.placementDone[i] && room.players[i].socketId !== 'AI') {
      const player = room.players[i];
      const bounds = room.boardBounds;
      // 미배치 말들 랜덤 배치
      const allPos = [];
      for (let r = bounds.min; r <= bounds.max; r++)
        for (let c = bounds.min; c <= bounds.max; c++)
          allPos.push({ col: c, row: r });
      for (const piece of player.pieces) {
        if (piece.col < 0) {
          const used = player.pieces.filter(p => p.col >= 0 && !p.subUnit).map(p => `${p.col},${p.row}`);
          const available = allPos.filter(p => !used.includes(`${p.col},${p.row}`));
          if (available.length > 0) {
            const pos = randomPick(available);
            piece.col = pos.col;
            piece.row = pos.row;
          }
        }
      }
      room.placementDone[i] = true;
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('placement_timeout', {});
    }
  }
  if (room.placementDone.every(d => d)) {
    startGameFromRoom(room);
  }
}

// 턴 타임아웃: 현재 턴 강제 종료
function turnTimeout(room) {
  if (room.phase !== 'game') return;
  const idx = room.currentPlayerIdx;
  if (room.players[idx].socketId === 'AI') return;
  emitToBothAndSpectators(room, 'turn_timeout', { playerIdx: idx });
  endTurn(room);
}

// ── 페이즈 전환 헬퍼 (타이머 연동) ─────────────────────────

// ══════════════════════════════════════════════════════════════════
// ── 팀전 (2v2) 페이즈 전환 ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function transitionToTeamDraft(room) {
  clearTimer(room);
  room.phase = 'team_draft';
  // 팀전 드래프트 — 2픽 (티어 무관)
  for (const p of room.players) {
    p.draft = { pick1: null, pick2: null };
  }
  room.draftDone = Array(room.playerCount).fill(false);
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_draft_start', {
      myIdx: p.index,
      teamId: p.teamId,
      players: room.players.map(pl => ({ name: pl.name, idx: pl.index, teamId: pl.teamId })),
      teams: room.teams,
      characters: CHARACTERS,
    });
  }
  startTimer(room, 'team_draft', () => teamDraftTimeout(room));
  // AI 봇 자동 픽 (각 봇마다 1.5초 ~ 3.5초 사이 무작위 지연)
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 1500 + Math.random() * 2000;
      setTimeout(() => aiTeamDraftPick(room, p.index), delay);
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ── 팀전 AI 자동 행동 ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// AI 드래프트 — 팀원과 안 겹치는 캐릭터 2개 무작위 픽
function aiTeamDraftPick(room, idx) {
  if (!room || room.phase !== 'team_draft') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.draftDone[idx]) return;
  const teammates = getTeammates(room, idx);
  const forbidden = new Set();
  for (const tIdx of teammates) {
    const tmDraft = room.players[tIdx]?.draft || {};
    if (tmDraft.pick1) forbidden.add(tmDraft.pick1);
    if (tmDraft.pick2) forbidden.add(tmDraft.pick2);
  }
  // 모든 티어에서 후보 — 다양한 티어가 섞이도록
  const allTypes = ALL_CHARS.map(c => c.type).filter(t => !forbidden.has(t));
  const shuffled = allTypes.slice().sort(() => Math.random() - 0.5);
  const pick1 = shuffled[0];
  const pick2 = shuffled.find(t => t !== pick1);
  if (!pick1 || !pick2) return;
  p.draft = { pick1, pick2 };
  // 팀원에게 진행 상황 브로드캐스트
  const teamMembers = room.teams[p.teamId] || [];
  const teamDrafts = teamMembers.map(i => ({
    idx: i,
    name: room.players[i]?.name,
    draft: { pick1: room.players[i]?.draft?.pick1 || null, pick2: room.players[i]?.draft?.pick2 || null },
    confirmed: !!room.draftDone[i],
  }));
  for (const tIdx of teamMembers) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_draft_pick_update', { playerIdx: idx, slot: 'pick2', type: pick2, teamDrafts });
    }
  }
  // 확정
  room.draftDone[idx] = true;
  io.to(room.id).emit('team_draft_status', {
    draftDone: [...room.draftDone],
    doneNames: room.players.filter((_, i) => room.draftDone[i]).map(p2 => p2.name),
  });
  // 모두 확정되면 다음 페이즈로
  if (room.draftDone.every(d => d)) {
    transitionToTeamHp(room);
  }
}

// AI HP 분배 — 5/5 기본, 쌍둥이 있으면 그쪽 6/4
function aiTeamHpDistribute(room, idx) {
  if (!room || room.phase !== 'team_hp') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.hpDone[idx]) return;
  const draft = p.draft || {};
  const t1Twin = draft.pick1 === 'twins';
  const t2Twin = draft.pick2 === 'twins';
  let hps = [5, 5];
  if (t1Twin) hps = [6, 4];
  else if (t2Twin) hps = [4, 6];
  p.hpDist = { pick1: hps[0], pick2: hps[1] };
  // 쌍둥이 분할
  if (t1Twin || t2Twin) {
    const twinHp = t1Twin ? hps[0] : hps[1];
    const elder = Math.ceil(twinHp / 2);
    const younger = twinHp - elder;
    p.hpDist.twinElder = elder;
    p.hpDist.twinYounger = younger;
  }
  // 실제 pieces 생성 (이게 누락되면 alive=0으로 게임 시작됨)
  p.pieces = buildTeamPieces(p.draft, p.hpDist);
  // 팀원 HP 패널이 실시간 갱신되도록 — 팀 멤버에게 team_hp_browse 전송
  const teammates = getTeammates(room, idx);
  for (const tIdx of teammates) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_hp_browse', {
        playerIdx: idx,
        hps: [hps[0], hps[1]],
      });
    }
  }
  room.hpDone[idx] = true;
  io.to(room.id).emit('team_hp_status', {
    hpDone: [...room.hpDone],
    doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p2 => p2.name),
  });
  if (room.hpDone.every(d => d)) {
    transitionToTeamReveal(room);
  }
}

// AI 배치 — 전략적 배치 (적팀 공격범위 회피 + 시너지 형성)
// 자동 배치 후에도 다른 플레이어 배치가 갱신되면 재평가 (확정 X — 보드 위 배치만)
function aiTeamPlace(room, idx) {
  if (!room || room.phase !== 'team_placement') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.placementDone[idx]) return;
  const bounds = room.boardBounds || { min: 0, max: 6 };
  const teamId = p.teamId;
  const enemyIdxs = getEnemyIndices(room, idx);
  const teammates = getTeammates(room, idx);
  // 자기 팀 진영 (블루: 위 0~2, 레드: 아래 4~6)
  const zoneRows = teamId === 0
    ? [bounds.min, bounds.min + 1, bounds.min + 2]
    : [bounds.max, bounds.max - 1, bounds.max - 2];
  const frontRow = zoneRows[2];
  const midRow = zoneRows[1];
  const backRow = zoneRows[0];

  // 점유된 칸
  const occupied = new Set();
  for (const tIdx of [idx, ...teammates]) {
    const tp = room.players[tIdx];
    if (!tp) continue;
    for (const pc of (tp.pieces || [])) {
      if (pc.col >= 0 && pc.row >= 0) occupied.add(`${pc.col},${pc.row}`);
    }
  }

  // 적팀 배치된 piece들의 공격 셀 합집합 — 회피 후보
  const enemyAttackCells = new Set();
  for (const ei of enemyIdxs) {
    const ep = room.players[ei];
    if (!ep) continue;
    for (const epc of (ep.pieces || [])) {
      if (epc.col < 0 || epc.row < 0) continue;
      const cells = getAttackCells(epc.type, epc.col, epc.row, bounds, { toggleState: epc.toggleState });
      for (const c of cells) enemyAttackCells.add(`${c.col},${c.row}`);
    }
  }

  const isAggressive = (pc) => ['archer','spearman','cavalry','knight','general','dualBlade','prince','princess','slaughterHero','shadowAssassin','torturer','dragonTamer'].includes(pc.type);
  const isSupport = (pc) => ['herbalist','monk','watchman','scout','commander','wizard','ratMerchant','bodyguard','king'].includes(pc.type);
  const isFragile = (pc) => pc.maxHp <= 2 || ['watchman','messenger','sulfurCauldron','herbalist','monk'].includes(pc.type);

  // 셀 점수 — 높을수록 배치하기 좋음
  const scoreCell = (piece, c, r) => {
    if (occupied.has(`${c},${r}`)) return -Infinity;
    if (r < bounds.min || r > bounds.max || c < bounds.min || c > bounds.max) return -Infinity;
    let score = 0;
    // 1. 적 공격범위 안에 있으면 페널티 (공격형은 약하게, 약한 유닛은 강하게)
    const inEnemyRange = enemyAttackCells.has(`${c},${r}`);
    if (inEnemyRange) {
      if (isFragile(piece)) score -= 25;
      else if (isAggressive(piece)) score -= 5;
      else score -= 12;
    }
    // 2. 역할별 행 선호
    const dRow = teamId === 0 ? r - bounds.min : bounds.max - r;
    if (isAggressive(piece)) {
      score += dRow * 6;  // 전진할수록 보상
    } else if (isSupport(piece) || isFragile(piece)) {
      score += (2 - Math.min(2, dRow)) * 8;  // 후방일수록 보상
    } else {
      score += dRow === 1 ? 5 : 2;  // 중간 우선
    }
    // 3. 가장자리 페널티 (보드 축소 대비)
    if (c === bounds.min || c === bounds.max) score -= 4;
    // 4. 팀원과 너무 인접하면 페널티 (AoE/덫에 휘말리지 않게)
    for (const tIdx of teammates) {
      const tp = room.players[tIdx];
      if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (!tpc.alive || tpc.col < 0) continue;
        const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
        if (dist === 1) score -= 6;
      }
    }
    // 5. 시너지 — commander 인접 (사기증진)
    if (piece.tag === 'royal' || isAggressive(piece)) {
      for (const tIdx of [...teammates, idx]) {
        const tp = room.players[tIdx];
        if (!tp) continue;
        for (const tpc of (tp.pieces || [])) {
          if (tpc.type === 'commander' && tpc.col >= 0) {
            const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
            if (dist === 1) score += 8;
          }
        }
      }
    }
    // 6. 약한 유닛은 호위무사 인접 보너스
    if (isFragile(piece) && piece.tag === 'royal') {
      for (const tIdx of [...teammates, idx]) {
        const tp = room.players[tIdx];
        if (!tp) continue;
        for (const tpc of (tp.pieces || [])) {
          if (tpc.type === 'bodyguard' && tpc.col >= 0) {
            const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
            if (dist <= 2) score += 5;
          }
        }
      }
    }
    // 7. 무작위 분산 — 같은 점수일 때 랜덤 선택
    score += Math.random() * 2;
    return score;
  };

  // 각 piece 별로 진영 내 모든 셀 점수 계산 후 최고점에 배치
  // piece 처리 순서: 공격형 먼저 (앞 행 선점), 지원/약한 유닛 나중 (남은 자리에 안전 배치)
  const piecesOrdered = p.pieces
    .map((pc, pi) => ({ pc, pi }))
    .filter(o => o.pc.col < 0)
    .sort((a, b) => {
      const aPri = isAggressive(a.pc) ? 0 : (isSupport(a.pc) || isFragile(a.pc) ? 2 : 1);
      const bPri = isAggressive(b.pc) ? 0 : (isSupport(b.pc) || isFragile(b.pc) ? 2 : 1);
      return aPri - bPri;
    });

  for (const { pc: piece, pi } of piecesOrdered) {
    if (piece.col >= 0) continue;
    let best = { col: -1, row: -1, score: -Infinity };
    // 자기 진영 내 모든 셀 평가
    for (const r of zoneRows) {
      for (let c = bounds.min; c <= bounds.max; c++) {
        const s = scoreCell(piece, c, r);
        if (s > best.score) best = { col: c, row: r, score: s };
      }
    }
    if (best.col >= 0) {
      piece.col = best.col;
      piece.row = best.row;
      occupied.add(`${best.col},${best.row}`);
    }
  }
  // 모든 piece 배치되면 — 즉시 확정 X. 다른 플레이어 배치 보고 한 번만 재평가하도록 placementDone은 늦게 셋
  // 단, 모든 휴먼 + 다른 봇이 확정한 상태면 자기도 확정해야 게임이 진행됨
  // → 배치 자체는 완료 표시하고, 일부 휴먼이 아직 배치 중이면 그들이 변경할 때마다 우리 placement도 재평가 가능
  // 현재 구현: 즉시 확정 (이전 동작 유지) — 추후 reactive 재평가는 별도 hook
  if (p.pieces.every(pc => pc.col >= 0)) {
    room.placementDone[idx] = true;
    // 팀 내부에 즉시 보이도록 broadcastTeamPlacementUpdate
    if (typeof broadcastTeamPlacementUpdate === 'function') broadcastTeamPlacementUpdate(room, idx);
    io.to(room.id).emit('team_placement_status', {
      placementDone: [...room.placementDone],
      doneNames: room.players.filter((_, i) => room.placementDone[i]).map(p2 => p2.name),
    });
    if (room.placementDone.every(d => d)) {
      startTeamGameFromRoom(room);
    }
  }
}

// ── 팀전 AI 점수 헬퍼 (1v1 aiScoreAttack/aiScoreMove의 팀모드 적응판) ──
// probMap 대신 실제 적 위치 + 가중치(HP, tier, 스킬 보유) 기반 점수
function aiTeamCellThreatScore(room, idx, col, row, opts) {
  // opts.revealedOnly = true 면 "표식된 적 + 최근 hit 기억" 만 인지 (마녀·그림자 자유 타겟형)
  // 페어플레이: 일반 전수조사 X. 인간 플레이어와 동일한 정보(표식·관측)만 사용
  const revealedOnly = !!(opts && opts.revealedOnly);
  const enemyIdxs = getEnemyIndices(room, idx);
  let score = 0;
  for (const ei of enemyIdxs) {
    for (const pc of (room.players[ei]?.pieces || [])) {
      if (!pc.alive) continue;
      if (revealedOnly) {
        // 표식 OR 최근 AI 팀이 hit 으로 확인한 위치만 인지
        const isMarked = (pc.statusEffects || []).some(e => e.type === 'mark');
        const teamId = getTeamOf(room, idx);
        const teamMem = (room.aiTeamMemory && room.aiTeamMemory[teamId]) || null;
        const memKey = `${pc.col},${pc.row}`;
        const memTurn = teamMem?.hits?.[memKey];
        const isRecentHit = (memTurn != null) && (room.turnNumber - memTurn <= 3);  // 3턴 이내 hit 기억
        if (!isMarked && !isRecentHit) continue;
      }
      if (pc.col === col && pc.row === row) {
        const tierW = (pc.tier || 1) * 1.5;
        const hpW = Math.max(0, 4 - pc.hp);
        const skillW = pc.hasSkill ? 2 : 0;
        score += 9 + tierW + hpW + skillW;
      }
    }
  }
  return score;
}

// AI 팀 hit 기억 — AI 팀이 (col, row) 셀에 hit 을 기록한 턴 번호 저장
// 마녀·그림자 같이 무차별 타겟형 캐릭터의 다음 시전 시 위치 추론에 사용
function aiTeamRecordHit(room, attackerIdx, col, row) {
  if (room.mode !== 'team') return;
  if (!room.aiTeamMemory) room.aiTeamMemory = {};
  const teamId = getTeamOf(room, attackerIdx);
  if (!room.aiTeamMemory[teamId]) room.aiTeamMemory[teamId] = { hits: {} };
  room.aiTeamMemory[teamId].hits[`${col},${row}`] = room.turnNumber;
}
function aiTeamScoreAttack(room, idx, piece, extra) {
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, piece.col, piece.row, bounds, extra || {});
  let score = 0;
  for (const c of cells) score += aiTeamCellThreatScore(room, idx, c.col, c.row);
  score *= (1 + (piece.atk || 1) * 0.1);
  return score;
}
function aiTeamScoreMove(room, idx, piece, newCol, newRow) {
  const bounds = room.boardBounds;
  // 마녀·그림자 암살자는 표식된 적 위치만 인지 — 이동 점수 산정도 동일
  const revealedOnly = (piece.type === 'witch' || piece.type === 'shadowAssassin');
  const cells = getAttackCells(piece.type, newCol, newRow, bounds);
  let score = 0;
  for (const c of cells) score += aiTeamCellThreatScore(room, idx, c.col, c.row, { revealedOnly });
  // 보드 축소 회피 — 다음 축소 예상 영역에 들어갔는지 강하게 페널티
  // (사용자 요청 #20b: 축소 예고 중 AI가 외곽으로 나도는 바보짓 절대 금지)
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  for (const ev of schedule) {
    if (room.boardShrinkStage >= ev.stage) continue;  // 이미 거친 단계
    const turnsToShrink = ev.shrinkTurn - room.turnNumber;
    if (turnsToShrink > 10 || turnsToShrink < 0) continue;  // 10턴 이내만
    // 새 위치가 곧 파괴될 영역(현재 bounds 밖이지만 ev.newBounds 안인 셀)인지
    const willBeOutside = newCol < ev.newBounds.min || newCol > ev.newBounds.max ||
                          newRow < ev.newBounds.min || newRow > ev.newBounds.max;
    if (willBeOutside) {
      // 임박할수록 강한 페널티 (10턴 전: -50, 1턴 전: -200)
      const urgency = Math.max(1, 11 - turnsToShrink);
      score -= 25 * urgency;
    }
  }
  // 일반 가장자리 회피 (보드 축소 임박 안 해도)
  if (room.turnNumber >= 25 && !room.boardShrunk) {
    if (newCol === bounds.min || newCol === bounds.max || newRow === bounds.min || newRow === bounds.max) {
      score *= 0.5;
    }
  }
  // HP 낮은데 적 인접 → 멀어지면 보너스 (도망 장려)
  if (piece.hp <= 2) {
    const enemyIdxs = getEnemyIndices(room, idx);
    let nearestE = Infinity;
    for (const ei of enemyIdxs) {
      for (const pc of (room.players[ei]?.pieces || [])) {
        if (!pc.alive || pc.col == null) continue;
        const d = Math.abs(pc.col - newCol) + Math.abs(pc.row - newRow);
        if (d < nearestE) nearestE = d;
      }
    }
    const curNearest = (() => {
      let n = Infinity;
      for (const ei of enemyIdxs) for (const pc of (room.players[ei]?.pieces || [])) {
        if (!pc.alive || pc.col == null) continue;
        const d = Math.abs(pc.col - piece.col) + Math.abs(pc.row - piece.row);
        if (d < n) n = d;
      }
      return n;
    })();
    if (nearestE > curNearest) score += 20 * (3 - piece.hp);
  }
  return score;
}
function aiTeamBestTargetCell(room, idx, piece) {
  const bounds = room.boardBounds;
  // 마녀·그림자 암살자는 보드 전체 어디든 공격 가능 → 페어플레이 차원에서 표식된 적만 인지
  const revealedOnly = (piece.type === 'witch' || piece.type === 'shadowAssassin');
  let best = { col: piece.col, row: piece.row, score: 0 };
  for (let r = bounds.min; r <= bounds.max; r++) {
    for (let c = bounds.min; c <= bounds.max; c++) {
      if (c === piece.col && r === piece.row) continue;
      const sc = aiTeamCellThreatScore(room, idx, c, r, { revealedOnly });
      if (sc > best.score) { best = { col: c, row: r, score: sc }; }
    }
  }
  return best;
}

// 팀전 AI 스킬 실행 — 1v1 aiExecSkill의 팀모드판 (idx를 받음)
function aiTeamExecSkill(room, idx, pidx, skillId, params) {
  // ★ 사망 기폭 페이즈 — 팀모드 AI 스킬로 화약상 사망 시 큐.
  startPhase(room);
  const result = executeSkill(room, idx, pidx, skillId, params || {});
  // 모든 비-AI 플레이어 + 관전자에게 스킬 사용 알림 (인간 use_skill 경로와 동일)
  // 누락되면 팀원/적의 스킬 사용을 인지 불가 → 토스트·로그 누락
  const skillPiece = room.players[idx]?.pieces[pidx];
  if (skillPiece) {
    const basePayload = {
      casterIdx: idx,
      casterName: room.players[idx].name,
      casterTeamId: room.players[idx].teamId,
      casterPieceIdx: pidx,                 // 시전자 카드 spotlight 용
      sp: room.sp,                           // 마법구 비행 애니용
      instantSp: room.instantSp,
      skillUsed: {
        icon: skillPiece.icon,
        name: skillPiece.name,
        skillName: skillPiece.skillName,
      },
      // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용 (AI 시전 경로)
      hits: result.data?.hits || null,
    };
    // 본인/팀원/적 분기 (use_skill 핸들러의 explicitAlly/explicitOpp 와 동일 로직)
    const explicitAlly = (result.allyMsg !== undefined) ? result.allyMsg : (result.msg || null);
    const explicitOpp  = (result.oppMsg  !== undefined) ? result.oppMsg  : (result.msg || null);
    // 반드시 broadcastTeamGameState 보다 먼저 보냄 — 그래야 클라가 oldSpSnap 캡처 후 마법구 비행 가능
    for (const p of room.players) {
      if (!p.socketId || p.socketId === 'AI' || p.index === idx) continue;
      const isAlly = (p.teamId === room.players[idx].teamId);
      io.to(p.socketId).emit('team_skill_notice', { ...basePayload, msg: isAlly ? explicitAlly : explicitOpp });
    }
    for (const s of (room.spectators || [])) {
      io.to(s.socketId).emit('team_skill_notice', { ...basePayload, msg: explicitOpp });
    }
  }
  // 마지막에 전체 상태 브로드캐스트 (팀_skill_notice 가 먼저 도착해야 마법구 애니 동작)
  broadcastTeamGameState(room);

  // ★ 기폭 (detonate) — 폭발 애니메이션 emit. 인간 use_skill 경로와 동일.
  //   누락 시 팀모드 AI 기폭이 다른 플레이어에게 폭발 애니가 안 보임.
  if (result && result.data && Array.isArray(result.data.deferredBombEmits)) {
    const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row }));
    if (bombList.length > 0) {
      emitToBoth(room, 'detonation_intro', { bombs: bombList });
    }
    const deferred = [...result.data.deferredBombEmits];
    setTimeout(() => {
      if (!rooms[room.id]) return;
      for (const bd of deferred) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
    }, 1930);
  }

  // ★ 사망 기폭 페이즈 flush — 팀모드 AI 스킬로 화약상 사망 시 cast/intro/bomb_detonated 시퀀스 emit.
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') {
      checkGameEndAfterPhase(room);
    }
  });

  // AI 토스트 추적 — 스킬은 ~7.6s 동안 표시
  aiTrackToastEnd(room, 'skill');
  return result;
}

// AI 토스트 추적기 — 두 시점 추적:
//   ① _aiNextActionEarliest : 토스트가 *나타나는* 시점 — AI의 다음 행동(intra-turn) 이 이 전에는 안 됨.
//                              그래야 발생 순서대로 토스트가 줄지어 표시됨.
//   ② _aiEndTurnEarliest    : 토스트가 *사라지는* 시점 — AI의 endTurn 이 이 시각 + 0.5s 버퍼까지 지연.
//                              그래야 다음 플레이어 턴오버 토스트가 직전 토스트보다 먼저 오지 않음.
function aiTrackToast(room, kind) {
  // 토스트 노출 시점 (appear) — 새 시퀀스 기준:
  //   skill: T+1500ms (마법구 비행 1.5s 끝나면 스킬 효과 + 토스트 동시 노출)
  //   attack/move/passive: 즉시 (~100ms)
  //   detonation: 1.5s + 폭탄 애니(0.95s) ≈ 2500ms
  //   sp_grant: 풀스크린 애니
  // 토스트 종료 시점 (disappear) — appear + TOAST_DURATION(4000) + fade(350).
  let appearMs = 100;
  let totalMs  = 4500;
  if (kind === 'skill')          { appearMs = 1500; totalMs = 5900; }
  else if (kind === 'detonation') { appearMs = 2500; totalMs = 7000; }
  else if (kind === 'sp_grant')   { appearMs = 0;    totalMs = 6000; }
  const now = Date.now();
  const appearAt = now + appearMs;
  const finishAt = now + totalMs;
  if (!room._aiNextActionEarliest || appearAt > room._aiNextActionEarliest) {
    room._aiNextActionEarliest = appearAt;
  }
  if (!room._aiEndTurnEarliest || finishAt > room._aiEndTurnEarliest) {
    room._aiEndTurnEarliest = finishAt;
  }
}
// 호환용 별칭 — aiTeamExecSkill 등 기존 호출처가 사용
function aiTrackToastEnd(room, kind) { aiTrackToast(room, kind); }
// AI 인트라 턴 다음 행동까지 대기할 시간 (ms) — 토스트가 나타날 때까지 + 작은 마진
function aiNextActionWaitMs(room, fallbackMs) {
  const now = Date.now();
  const earliest = room._aiNextActionEarliest || 0;
  const remain = Math.max(0, earliest - now);
  // 토스트 출력 직후 최소 200ms 마진 — 사용자가 토스트를 인지할 시간
  return Math.max(fallbackMs || 0, remain + 200);
}

// ── 팀전 AI 턴 종료 안전 스케줄러 ──
// 기존 setTimeout(...endTurn..., 4000) 패턴은 4초 대기 중 다른 곳에서 endTurn이 먼저 호출되면
// currentPlayerIdx가 바뀌어 조건이 false가 되고 게임이 멈출 위험이 있었다.
// 이 헬퍼는 핸들을 추적해 중복 스케줄/취소를 안전하게 처리하고, 30초 워치독으로 강제 endTurn 보장.
function scheduleAITurnEnd(room, idx, delayMs) {
  if (!room) return;
  if (!room._aiTurnEndHandle) room._aiTurnEndHandle = {};
  if (!room._aiTurnEndWatchdog) room._aiTurnEndWatchdog = {};
  // 이미 예약된 핸들이 있으면 취소 (중복 방지)
  if (room._aiTurnEndHandle[idx]) {
    clearTimeout(room._aiTurnEndHandle[idx]);
    room._aiTurnEndHandle[idx] = null;
  }
  if (room._aiTurnEndWatchdog[idx]) {
    clearTimeout(room._aiTurnEndWatchdog[idx]);
    room._aiTurnEndWatchdog[idx] = null;
  }
  // 사용자 요청: 토스트가 모두 사라지고 0.5초 버퍼까지 대기 후 endTurn.
  //   호출자가 넘긴 delayMs 와 _aiEndTurnEarliest 중 더 큰 값 적용.
  const now = Date.now();
  const earliest = room._aiEndTurnEarliest || 0;
  const remainingToastMs = Math.max(0, earliest - now);
  const finalDelay = Math.max(delayMs, remainingToastMs + 500);
  // 메인 endTurn 콜백
  room._aiTurnEndHandle[idx] = setTimeout(() => {
    room._aiTurnEndHandle[idx] = null;
    if (!room || room.phase !== 'game') return;
    if (room.currentPlayerIdx === idx) {
      // 워치독 취소
      if (room._aiTurnEndWatchdog[idx]) {
        clearTimeout(room._aiTurnEndWatchdog[idx]);
        room._aiTurnEndWatchdog[idx] = null;
      }
      room._aiEndTurnEarliest = 0;
      endTurn(room);
    }
    // 다른 곳에서 endTurn이 먼저 호출됐다면 정상 — 그냥 종료 (워치독은 이미 무관)
  }, finalDelay);
  // 워치독 — 최종 delay의 2배 시간 후에도 currentPlayerIdx가 여전히 idx면 강제 endTurn
  // (게임 멈춤 방지용 안전망)
  room._aiTurnEndWatchdog[idx] = setTimeout(() => {
    room._aiTurnEndWatchdog[idx] = null;
    if (!room || room.phase !== 'game') return;
    if (room.currentPlayerIdx === idx) {
      console.warn('[AI watchdog] forcing endTurn for stalled AI', idx);
      room._aiEndTurnEarliest = 0;
      endTurn(room);
    }
  }, finalDelay * 2 + 5000);
}

// ── 팀전 AI 자유 스킬 사용 (그림자/정비/질주/약초학/정찰/기폭/신성/반지) ──
function aiTeamUsePreSkills(room, idx) {
  const p = room.players[idx];
  if (!p || p.actionDone) return;
  const allyIdxs = getAllyIndices(room, idx);
  const enemyIdxs = getEnemyIndices(room, idx);
  for (let pi = 0; pi < p.pieces.length; pi++) {
    const piece = p.pieces[pi];
    if (!piece.alive || !piece.hasSkill || piece.skillReplacesAction) continue;
    if ((room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow')) continue;
    if (p.skillsUsedBeforeAction && p.skillsUsedBeforeAction.includes(piece.skillId)) continue;
    // shadow — 적과 인접하면 시전
    if (piece.skillId === 'shadow') {
      const adjEnemy = enemyIdxs.some(ei => (room.players[ei]?.pieces || []).some(e =>
        e.alive && e.col != null && Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row) <= 2));
      if (adjEnemy) { aiTeamExecSkill(room, idx, pi, 'shadow'); return; }
    }
    // reform — 더 좋은 공격 점수 방향이면
    if (piece.skillId === 'reform') {
      const curScore = aiTeamScoreAttack(room, idx, piece, { toggleState: piece.toggleState });
      const altState = piece.type === 'archer' ? (piece.toggleState === 'right' ? 'left' : 'right') : (piece.toggleState === 'vertical' ? 'horizontal' : 'vertical');
      const altScore = aiTeamScoreAttack(room, idx, piece, { toggleState: altState });
      if (altScore > curScore + 8) { aiTeamExecSkill(room, idx, pi, 'reform'); return; }
    }
    // sprint — 위급(HP≤1) + 도망 필요시에만. 1v1 AI 와 동일한 정책.
    if (piece.skillId === 'sprint') {
      const critical = piece.hp <= 1;
      if (critical) { aiTeamExecSkill(room, idx, pi, 'sprint'); return; }
    }
    // herb — 인접 아군 부상 시
    if (piece.skillId === 'herb') {
      const woundedAlly = allyIdxs.flatMap(ai => room.players[ai]?.pieces || [])
        .some(a => a.alive && a !== piece && a.hp < a.maxHp &&
          Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1);
      if (woundedAlly) { aiTeamExecSkill(room, idx, pi, 'herb'); return; }
    }
    // recon — 무작위 적 정보 공개
    if (piece.skillId === 'recon' && Math.random() < 0.4) {
      aiTeamExecSkill(room, idx, pi, 'recon'); return;
    }
    // bomb — 폭탄 설치 (적 인접 셀 우선)
    if (piece.skillId === 'bomb') {
      const adj = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
      const cands = [];
      for (const [dc, dr] of adj) {
        const c = piece.col + dc, r = piece.row + dr;
        if (!inBounds(c, r, room.boardBounds)) continue;
        const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === c && pc.row === r));
        if (occ) continue;
        const hasBomb = (room.boardObjects[idx] || []).some(o => o.type === 'bomb' && o.col === c && o.row === r);
        if (hasBomb) continue;
        cands.push({ col: c, row: r });
      }
      if (cands.length > 0) {
        const t = cands[Math.floor(Math.random() * cands.length)];
        aiTeamExecSkill(room, idx, pi, 'bomb', { col: t.col, row: t.row }); return;
      }
    }
    // detonate — 폭탄이 적 위치 위에 있으면
    if (piece.skillId === 'detonate') {
      const myBombs = (room.boardObjects[idx] || []).filter(o => o.type === 'bomb');
      const enemyOnBomb = myBombs.some(b => enemyIdxs.some(ei =>
        (room.players[ei]?.pieces || []).some(e => e.alive && e.col === b.col && e.row === b.row)));
      if (enemyOnBomb) { aiTeamExecSkill(room, idx, pi, 'detonate'); return; }
    }
    // divine (수도승 신성) — 부상 아군에게
    if (piece.skillId === 'divine') {
      // 자기 외 아군 중 가장 부상자 우선
      let target = null, targetIdx = -1, targetOwnerIdx = -1;
      for (const ai of allyIdxs) {
        const ap = room.players[ai];
        for (let api = 0; api < (ap?.pieces || []).length; api++) {
          const pc = ap.pieces[api];
          if (!pc.alive || pc === piece) continue;
          if (pc.hp >= pc.maxHp) continue;
          if (!target || (pc.maxHp - pc.hp) > (target.maxHp - target.hp)) {
            target = pc; targetIdx = api; targetOwnerIdx = ai;
          }
        }
      }
      if (target) {
        aiTeamExecSkill(room, idx, pi, 'divine', { targetPieceIdx: targetIdx, targetOwnerIdx }); return;
      }
    }
    // dragon — 5SP 충분하면 한 번 소환 (게임당 1회 시도)
    if (piece.skillId === 'dragon' && (room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) >= 5) {
      // 자기 인접 빈 칸
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const c = piece.col + dc, r = piece.row + dr;
        if (!inBounds(c, r, room.boardBounds)) continue;
        const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === c && pc.row === r));
        if (!occ) { aiTeamExecSkill(room, idx, pi, 'dragon', { col: c, row: r }); return; }
      }
    }
    // ring (국왕) — 가장 위협적인 적을 외곽으로 밀어넣기.
    // 사용자 요청: 절대 같은 팀원에게 사용하지 못하게 — 적팀(enemyIdxs) 만 후보 + targetOwnerIdx 명시.
    if (piece.skillId === 'ring') {
      // 적팀 piece 들을 owner 정보와 함께 수집 (server.executeSkill 'king' 케이스가 type+ownerIdx 로 매칭)
      const enemyEntries = [];
      for (const ei of enemyIdxs) {
        const owner = room.players[ei];
        if (!owner) continue;
        if (owner.teamId === room.players[idx].teamId) continue;  // 같은 팀이면 스킵 (이중 안전장치)
        for (const e of (owner.pieces || [])) {
          if (e.alive && e.col != null) enemyEntries.push({ piece: e, ownerIdx: ei });
        }
      }
      if (enemyEntries.length > 0) {
        const target = enemyEntries[0];
        const bounds = room.boardBounds;
        for (let r = bounds.min; r <= bounds.max; r += (bounds.max - bounds.min)) {
          for (let c = bounds.min; c <= bounds.max; c++) {
            const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === c && pc.row === r));
            if (!occ) {
              aiTeamExecSkill(room, idx, pi, 'ring', {
                targetName: target.piece.type,        // server 는 piece.type 으로 매칭
                targetOwnerIdx: target.ownerIdx,      // 같은 팀원 폴백 방지
                col: c, row: r,
              });
              return;
            }
          }
        }
      }
    }
  }
}

// ── 팀전 AI 보드 축소 대피 ──
// 다음 축소가 임박했고 외곽에 내 말이 있으면 안쪽으로 즉시 대피 (1v1 aiFindEvacuation과 동등)
function aiTeamFindEvacuation(room, idx) {
  const p = room.players[idx];
  if (!p) return null;
  const bounds = room.boardBounds;
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  // 다음 축소 이벤트
  const nextShrink = schedule.find(ev => room.boardShrinkStage < ev.stage && room.turnNumber < ev.shrinkTurn);
  if (!nextShrink) return null;
  const turnsLeft = nextShrink.shrinkTurn - room.turnNumber;
  if (turnsLeft > 5) return null;  // 5턴 이내만 대피 모드
  // 곧 파괴될 외곽에 있는 내 말 찾기
  const newBounds = nextShrink.newBounds;
  const myAlive = p.pieces.filter(pc => pc.alive && pc.col >= 0);
  const trapped = myAlive.filter(pc => pc.col < newBounds.min || pc.col > newBounds.max ||
                                       pc.row < newBounds.min || pc.row > newBounds.max);
  if (trapped.length === 0) return null;
  // 가장 임박한(보드 축소 영역 밖) 첫 piece부터 안쪽으로 1칸 이동
  for (const piece of trapped) {
    const pieceIdx = p.pieces.indexOf(piece);
    const candidates = [];
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = piece.col + dc, nr = piece.row + dr;
      if (!inBounds(nc, nr, bounds)) continue;
      // 다른 piece 점유 체크
      const occ = room.players.some(pl => (pl.pieces || []).some(pc =>
        pc.alive && pc !== piece && pc.col === nc && pc.row === nr));
      if (occ) continue;
      // 새 위치가 안전 영역(newBounds) 안인지 우선
      const inSafe = nc >= newBounds.min && nc <= newBounds.max &&
                     nr >= newBounds.min && nr <= newBounds.max;
      candidates.push({ col: nc, row: nr, score: inSafe ? 100 : 30 });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.score - a.score);
    return { piece, pieceIdx, col: candidates[0].col, row: candidates[0].row };
  }
  return null;
}

// ── 팀전 AI 메인 턴 — 1v1과 동일한 STEP 구조 ──
function aiTeamTakeTurn(room, idx) {
  if (!room || room.phase !== 'game') return;
  if (room.currentPlayerIdx !== idx) return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI') return;
  const bounds = room.boardBounds;
  const myAlive = p.pieces.filter(pc => pc.alive);
  if (myAlive.length === 0) { endTurn(room); return; }
  const enemyIdxs = getEnemyIndices(room, idx);

  // ★ STEP 0: 보드 축소 임박 시 외곽 말 대피 (최우선) — 1v1 aiFindEvacuation 동등
  const evac = aiTeamFindEvacuation(room, idx);
  if (evac && !p.actionDone) {
    aiTeamExecuteMove(room, idx, evac.pieceIdx, evac.col, evac.row);
    return;
  }

  // ★ STEP 1: free 스킬 사용 (그림자/정비/질주/약초/정찰/폭탄·기폭/신성/반지/드래곤)
  // 사용자 요청: 행동 사이 3초 딜레이 — pre-skill 썼으면 3초 후 다시 진입해 다음 액션 평가
  const preLenBefore = (p.skillsUsedBeforeAction || []).length;
  aiTeamUsePreSkills(room, idx);
  const usedPreSkill = ((p.skillsUsedBeforeAction || []).length > preLenBefore);
  if (p.actionDone) {
    // pre-skill이 actionDone을 셋했으면 (드물지만 예외) — 턴 종료
    scheduleAITurnEnd(room, idx, 3000);
    return;
  }
  if (usedPreSkill) {
    // 사용자 요청: 이전 스킬의 토스트·애니메이션이 화면에서 사라질 때까지 freeze.
    //   _aiEndTurnEarliest 기준 (skill = now + 5900ms) + 200ms 마진. 최소 3000ms 보장.
    const _now = Date.now();
    const _earliest = room._aiEndTurnEarliest || 0;
    const waitMs = Math.max(3000, (_earliest - _now) + 200);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === idx) {
        aiTeamTakeTurn(room, idx);
      }
    }, waitMs);
    return;
  }

  // ★ STEP 2: 행동 대체 스킬 (덫/저주/유황범람/분신)
  for (const piece of myAlive) {
    if (!piece.hasSkill || !piece.skillReplacesAction) continue;
    if ((room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
    const pi = p.pieces.indexOf(piece);

    if (piece.type === 'manhunter') {
      const enemies = enemyIdxs.flatMap(ei => room.players[ei]?.pieces || []).filter(e => e.alive);
      const minDist = Math.min(...enemies.map(e => e.col != null ? Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row) : 99));
      const prob = minDist <= 3 ? 0.7 : 0.3;
      const hasTrap = (room.boardObjects[idx] || []).some(o => o.type === 'trap' && o.col === piece.col && o.row === piece.row);
      if (!hasTrap && Math.random() < prob) {
        aiTeamExecSkill(room, idx, pi, 'trap');
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
    if (piece.type === 'witch') {
      // 학습 메모리 — 같은 타겟에 저주가 계속 해소되면 회피
      // p._curseHistory: { 'ownerIdx:type:subUnit': cleansedCount }
      if (!p._curseHistory) p._curseHistory = {};
      // 적팀에 신성 시전자(수도승)·정화 가능 유닛이 있으면 저주가 무력화될 가능성 높음
      const enemyHasMonk = enemyIdxs.some(ei => (room.players[ei]?.pieces || []).some(e =>
        e.alive && (e.type === 'monk' || (e.skills && e.skills.some(s => s.id === 'divine')))));

      const candidates = enemyIdxs.flatMap(ei => (room.players[ei]?.pieces || [])
        .map((pc, ti) => ({ pc, ownerIdx: ei, idxInOwner: ti }))
        .filter(o => o.pc.alive && o.pc.hp > 1 && o.pc.type !== 'monk' &&
          !o.pc.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow')));

      // 우선순위: 신성 시전자(monk) 자신을 먼저 표적
      // — 단, 신성 시전자가 살아있는 동안은 저주가 계속 풀리니까 monk 죽을 때까지 monk 노리기
      if (enemyHasMonk) {
        // monk를 후보에 추가 — 저주는 못 걸지만, 마녀의 일반 공격으로 monk를 죽이는 것이 우선
        // 이 케이스는 일반 공격 점수가 높을 테니 여기서 저주 스킵 (false 반환과 유사하게 다음으로 진행)
        // 하지만 SP가 충분하고 다른 좋은 타겟이 있으면 저주는 시도
      }

      if (candidates.length > 0) {
        // 정렬: cleanse 메모리 적은 것 → 스킬 보유 → HP 높음 → tier 높음
        candidates.sort((a, b) => {
          const ka = `${a.ownerIdx}:${a.pc.type}:${a.pc.subUnit || ''}`;
          const kb = `${b.ownerIdx}:${b.pc.type}:${b.pc.subUnit || ''}`;
          const ca = p._curseHistory[ka] || 0;
          const cb = p._curseHistory[kb] || 0;
          if (ca !== cb) return ca - cb;  // 정화 횟수 적은 쪽이 우선
          if ((b.pc.hasSkill ? 1 : 0) !== (a.pc.hasSkill ? 1 : 0)) return (b.pc.hasSkill ? 1 : 0) - (a.pc.hasSkill ? 1 : 0);
          if (b.pc.hp !== a.pc.hp) return b.pc.hp - a.pc.hp;
          return (b.pc.tier || 0) - (a.pc.tier || 0);
        });
        const t = candidates[0];
        const targetKey = `${t.ownerIdx}:${t.pc.type}:${t.pc.subUnit || ''}`;
        const cleansedTimes = p._curseHistory[targetKey] || 0;
        // 같은 타겟이 2회 이상 정화됐고 적팀에 monk가 있으면 — 저주 시전 포기 (헛수고)
        if (cleansedTimes >= 2 && enemyHasMonk) {
          // 저주 스킵 — 다음 행동 후보로 넘어감
        } else {
          aiTeamExecSkill(room, idx, pi, 'curse', { targetPieceIdx: t.idxInOwner, targetOwnerIdx: t.ownerIdx });
          // 저주 시전 시점 기록 (해소 추적용 키 생성)
          p._lastCurseTarget = { key: targetKey, ownerIdx: t.ownerIdx, type: t.pc.type, subUnit: t.pc.subUnit, turnNumber: room.turnNumber };
          scheduleAITurnEnd(room, idx, 3000);
          return;
        }
      }
    }
    if (piece.type === 'sulfurCauldron') {
      const enemiesAll = enemyIdxs.flatMap(ei => room.players[ei]?.pieces || []).filter(e => e.alive && e.col != null);
      const borderEnemies = enemiesAll.filter(e =>
        e.col === bounds.min || e.col === bounds.max || e.row === bounds.min || e.row === bounds.max);
      if (borderEnemies.length >= 2) {
        aiTeamExecSkill(room, idx, pi, 'sulfurRiver');
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
    if (piece.type === 'twins_elder' || piece.type === 'twins_younger') {
      const elder = p.pieces.find(pc => pc.subUnit === 'elder' && pc.alive);
      const younger = p.pieces.find(pc => pc.subUnit === 'younger' && pc.alive);
      if (elder && younger && Math.min(elder.hp, younger.hp) <= 1 && Math.random() < 0.3) {
        const moverSub = elder.hp < younger.hp ? 'elder' : 'younger';
        aiTeamExecSkill(room, idx, pi, 'brothers', { target: moverSub });
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
  }

  // ★ STEP 3: 공격 vs 이동 점수 비교 (dual-blade는 강제 공격)
  let bestAction = null;
  const dualPiece = myAlive.find(pc => pc.dualBladeAttacksLeft > 0);
  if (dualPiece) {
    const dpi = p.pieces.indexOf(dualPiece);
    const sc = aiTeamScoreAttack(room, idx, dualPiece, { toggleState: dualPiece.toggleState });
    bestAction = { type: 'attack', piece: dualPiece, pieceIdx: dpi, score: sc };
  } else {
    for (const piece of myAlive) {
      if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow')) continue;
      const pi = p.pieces.indexOf(piece);
      const extra = { toggleState: piece.toggleState };
      if (piece.type === 'ratMerchant') extra.rats = room.rats[idx];
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
        const bt = aiTeamBestTargetCell(room, idx, piece);
        extra.tCol = bt.col; extra.tRow = bt.row;
      }
      // 공격 점수
      const atkScore = aiTeamScoreAttack(room, idx, piece, extra);
      if (!bestAction || atkScore > bestAction.score) {
        bestAction = { type: 'attack', piece, pieceIdx: pi, score: atkScore, extra };
      }
      // 이동 점수 (4방향 × 0.7 가중)
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        // 점유 체크
        const occupied = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === nc && pc.row === nr));
        if (occupied) continue;
        const moveScore = aiTeamScoreMove(room, idx, piece, nc, nr) * 0.7;
        if (!bestAction || moveScore > bestAction.score) {
          bestAction = { type: 'move', piece, pieceIdx: pi, score: moveScore, col: nc, row: nr };
        }
      }
    }
  }

  if (!bestAction || bestAction.score <= 0) {
    // 안전한 행동 없음 — 무작위 이동 (이전 폴백 유지)
    const piecesToTry = myAlive.slice().sort(() => Math.random() - 0.5);
    for (const piece of piecesToTry) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]].sort(() => Math.random() - 0.5);
      for (const [dc, dr] of dirs) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === nc && pc.row === nr));
        if (occ) continue;
        aiTeamExecuteMove(room, idx, p.pieces.indexOf(piece), nc, nr);
        return;
      }
    }
    endTurn(room);
    return;
  }

  if (bestAction.type === 'move') {
    aiTeamExecuteMove(room, idx, bestAction.pieceIdx, bestAction.col, bestAction.row);
  } else {
    aiTeamExecuteAttack(room, idx, bestAction.pieceIdx, bestAction.extra);
  }
}

// 팀전 AI 이동 실행 — 1v1 aiExecuteMove의 팀모드판
function aiTeamExecuteMove(room, idx, pieceIdx, nc, nr) {
  const p = room.players[idx];
  const piece = p.pieces[pieceIdx];
  if (!piece || !piece.alive) { endTurn(room); return; }
  const prevCol = piece.col, prevRow = piece.row;
  piece.col = nc; piece.row = nr;
  p._lastActionType = 'move';
  // 트랩 체크 (적팀의 트랩만)
  for (const eIdx of getEnemyIndices(room, idx)) {
    const arr = room.boardObjects[eIdx] || [];
    const ti = arr.findIndex(o => o.type === 'trap' && o.col === nc && o.row === nr);
    if (ti >= 0) {
      arr.splice(ti, 1);
      const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: nc, row: nr }, piece, eIdx, 2, false, idx);
      piece.hp = Math.max(0, piece.hp - dmg);
      // Wizard passive: 마법사가 덫을 밟아 피격되어도 인스턴트 SP 1 획득
      if (piece.type === 'wizard' && dmg > 0) {
        const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, idx) : idx;
        room.instantSp[wizSpSlot] += 1;
        emitSPUpdate(room);
        // 인스턴트 매직 알림 — 텍스트 메시지 제거 (클라 황금 마법구 애니만 사용). type='wizard' 로만 트리거.
        emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: idx, msg: `🧙 인스턴트 매직 : SP 획득` });

        emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: idx });

      }
      const willDie = piece.hp <= 0;
      if (willDie) handleDeath(room, piece, idx);
      // trap_triggered emit — 1v1과 동일하게
      emitToBoth(room, 'trap_triggered', {
        col: nc, row: nr,
        pieceInfo: { type: piece.type, name: piece.name, icon: piece.icon },
        damage: dmg,
        destroyed: willDie,
        newHp: piece.hp,
        owner: eIdx,
        victimOwnerIdx: idx,
      });
      break;
    }
  }
  p.actionDone = true;
  // 같은 팀에게 이동 알림 (팀원 애니메이션)
  for (const tIdx of getTeammates(room, idx)) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_ally_moved', {
        moverName: p.name, pieceType: piece.type, pieceIcon: piece.icon, pieceName: piece.name,
        subUnit: piece.subUnit, prevCol, prevRow, col: nc, row: nr,
      });
    }
  }
  // 적팀에게도 1v1처럼 이동 알림 (토스트/로그)
  const isMarked = (piece.statusEffects || []).some(e => e.type === 'mark');
  for (const enIdx of getEnemyIndices(room, idx)) {
    const en = room.players[enIdx];
    if (en && en.socketId && en.socketId !== 'AI') {
      io.to(en.socketId).emit('opp_moved', {
        msg: isMarked
          ? `${p.name}의 표식된 ${piece.name}${조사(piece.name, '이', '가')} 이동했습니다.`
          : `${p.name}${조사(p.name, '이', '가')} 이동했습니다.`,
        prevCol: isMarked ? prevCol : undefined,
        prevRow: isMarked ? prevRow : undefined,
        col: isMarked ? nc : undefined,
        row: isMarked ? nr : undefined,
      });
    }
  }
  // Sprint 카운트 처리 — 첫 이동 후 messengerMovesLeft 감소
  if (piece.alive && piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
    piece.messengerMovesLeft--;
    if (piece.messengerMovesLeft <= 0) piece.messengerSprintActive = false;
  }
  broadcastTeamGameState(room);
  // 후속 sprint 이동 가능 — 3초 후 aiTeamTakeTurn 재진입 (다음 최적 이동 계산)
  if (piece.alive && piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === idx) {
        aiTeamTakeTurn(room, idx);
      }
    }, 3000);
    return;
  }
  scheduleAITurnEnd(room, idx, 3000);
}

// AI 공격 헬퍼 — processAttack을 직접 호출 (extra: shadowAssassin/witch의 tCol/tRow + ratMerchant rats)
function aiTeamExecuteAttack(room, idx, pieceIdx, extra) {
  const p = room.players[idx];
  const piece = p.pieces[pieceIdx];
  if (!piece || !piece.alive) { endTurn(room); return; }
  const bounds = room.boardBounds;
  const atkExtra = extra || { toggleState: piece.toggleState };
  if (!atkExtra.rats && piece.type === 'ratMerchant') atkExtra.rats = room.rats[idx];
  const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, atkExtra);
  const hitResults = processAttack(room, idx, piece, atkCells);
  p.actionDone = true;
  // 모든 인간에게 결과 브로드캐스트 (broadcastTeamGameState로 자연스럽게 갱신됨)
  // 피격된 각 적 플레이어에게 being_attacked
  const defenderHitsByOwner = new Map();
  for (const h of hitResults) {
    if (h.defOwnerIdx === undefined) continue;
    if (!defenderHitsByOwner.has(h.defOwnerIdx)) defenderHitsByOwner.set(h.defOwnerIdx, []);
    defenderHitsByOwner.get(h.defOwnerIdx).push(h);
  }
  for (const [ownerIdx, hits] of defenderHitsByOwner.entries()) {
    const defPlayer = room.players[ownerIdx];
    if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
    io.to(defPlayer.socketId).emit('being_attacked', {
      atkCells,
      hitPieces: hits.map(h => {
        // ★ 합류 쌍둥이 버그 수정: col/row 기반 find 는 같은 칸의 첫 매치(누나)만 반환 → 동생 hit 도 누나 이름/도장으로 잘못 매핑.
        //   대신 defPieceIdx 로 정확히 해당 piece 를 찾고, 클라에 defPieceIdx 도 함께 전달.
        const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
        return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          name: dp?.name, icon: dp?.icon,
          defPieceIdx: h.defPieceIdx,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false };
      }),
      yourPieces: pieceSummary(defPlayer.pieces),
    });
  }
  // 같은 팀에게 team_ally_hit
  for (const [defOwnerIdx, hits] of defenderHitsByOwner.entries()) {
    const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
    for (const allyIdx of allyIdxs) {
      const ally = room.players[allyIdx];
      if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
      io.to(ally.socketId).emit('team_ally_hit', {
        atkCells,
        victimIdx: defOwnerIdx,
        victimName: room.players[defOwnerIdx].name,
        hitPieces: hits.map(h => {
          // ★ 합류 쌍둥이 버그 수정 — 동일.
          const dp = (typeof h.defPieceIdx === 'number') ? room.players[defOwnerIdx].pieces[h.defPieceIdx] : null;
          return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            name: dp?.name, icon: dp?.icon,
            defPieceIdx: h.defPieceIdx,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false };
        }),
      });
    }
  }
  // ★ 관전자 일반 공격 애니메이션 — 팀모드. defOwnerIdx 포함 hits.
  emitToSpectators(room, 'spectator_attack_anim', {
    atkCells,
    hits: hitResults.map(h => ({
      col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
      defPieceIdx: h.defPieceIdx,
      defOwnerIdx: h.defOwnerIdx,
      redirectedToBodyguard: h.redirectedToBodyguard || false,
      bodyguardRedirect: h.bodyguardRedirect || false,
    })),
  });

  emitToSpectators(room, 'spectator_log', {
    msg: hitResults.length > 0
      ? `${p.name}의 공격 명중!`
      : `${p.name} 공격 빗나감`,
    type: 'hit', playerIdx: idx,
  });
  // 전체 상태 동기화
  broadcastTeamGameState(room);
  // 쌍검무 — 두 번째 공격 (1v1과 동일하게 4초 딜레이)
  if (piece.dualBladeAttacksLeft > 0 && piece.alive) {
    const DUAL_BLADE_DELAY = 4000;
    setTimeout(() => {
      if (room.phase !== 'game' || room.currentPlayerIdx !== idx) return;
      if (!piece.alive) { setTimeout(() => endTurn(room), 100); return; }
      piece.dualBladeAttacksLeft--;
      const extra2Cells = getAttackCells(piece.type, piece.col, piece.row, bounds, atkExtra);
      const extra2Hits = processAttack(room, idx, piece, extra2Cells);
      // 두 번째 공격 결과 emit
      const hitsByOwner2 = new Map();
      for (const h of extra2Hits) {
        if (h.defOwnerIdx === undefined) continue;
        if (!hitsByOwner2.has(h.defOwnerIdx)) hitsByOwner2.set(h.defOwnerIdx, []);
        hitsByOwner2.get(h.defOwnerIdx).push(h);
      }
      for (const [ownerIdx, hits] of hitsByOwner2.entries()) {
        const defPlayer = room.players[ownerIdx];
        if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
        io.to(defPlayer.socketId).emit('being_attacked', {
          atkCells: extra2Cells,
          hitPieces: hits.map(h => {
            const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
            return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx };
          }),
          yourPieces: pieceSummary(defPlayer.pieces),
        });
      }
      for (const [defOwnerIdx, hits] of hitsByOwner2.entries()) {
        const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
        for (const allyIdx of allyIdxs) {
          const ally = room.players[allyIdx];
          if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
          io.to(ally.socketId).emit('team_ally_hit', {
            atkCells: extra2Cells, victimIdx: defOwnerIdx,
            victimName: room.players[defOwnerIdx].name,
            hitPieces: hits.map(h => {
              const dp = (typeof h.defPieceIdx === 'number') ? room.players[defOwnerIdx].pieces[h.defPieceIdx] : null;
              return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
                name: dp?.name, icon: dp?.icon,
                defPieceIdx: h.defPieceIdx,
                redirectedToBodyguard: h.redirectedToBodyguard || false };
            }),
          });
        }
      }
      // ★ 관전자 — 쌍검무 두 번째 공격 애니
      emitToSpectators(room, 'spectator_attack_anim', {
        atkCells: extra2Cells,
        hits: extra2Hits.map(h => ({
          col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          defPieceIdx: h.defPieceIdx, defOwnerIdx: h.defOwnerIdx,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false,
        })),
      });
      broadcastTeamGameState(room);
      scheduleAITurnEnd(room, idx, 3000);
    }, DUAL_BLADE_DELAY);
    return;
  }
  scheduleAITurnEnd(room, idx, 3000);
}

function teamDraftTimeout(room) {
  if (room.phase !== 'team_draft') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_draft' });
  for (let i = 0; i < room.playerCount; i++) {
    if (room.draftDone[i]) continue;
    const p = room.players[i];
    if (!p.draft) p.draft = { pick1: null, pick2: null };
    const teammates = getTeammates(room, i);
    const forbidden = new Set();
    for (const tIdx of teammates) {
      const tmDraft = room.players[tIdx]?.draft || {};
      if (tmDraft.pick1) forbidden.add(tmDraft.pick1);
      if (tmDraft.pick2) forbidden.add(tmDraft.pick2);
    }
    const available = ALL_CHARS.map(c => c.type).filter(t => !forbidden.has(t));
    if (!p.draft.pick1) {
      const pool = available.filter(t => t !== p.draft.pick2);
      p.draft.pick1 = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!p.draft.pick2) {
      const pool = available.filter(t => t !== p.draft.pick1);
      p.draft.pick2 = pool[Math.floor(Math.random() * pool.length)];
    }
    room.draftDone[i] = true;
  }
  transitionToTeamHp(room);
}

function transitionToTeamHp(room) {
  clearTimer(room);
  room.phase = 'team_hp';
  room.hpDone = Array(room.playerCount).fill(false);
  // 각 플레이어에게 HP 분배 페이즈 알림 (팀원 draft도 포함)
  for (const p of room.players) {
    if (!p.socketId) continue;
    const hasTwins = p.draft?.pick1 === 'twins' || p.draft?.pick2 === 'twins';
    // 팀원 draft 정보 (팀 내 다른 멤버)
    const teammateDraft = room.teams[p.teamId]
      .filter(i => i !== p.index)
      .map(i => ({ idx: i, name: room.players[i].name, draft: room.players[i].draft }))[0] || null;
    io.to(p.socketId).emit('team_hp_phase', {
      draft: p.draft,
      hasTwins,
      teammateDraft: teammateDraft ? teammateDraft.draft : null,
    });
  }
  startTimer(room, 'team_hp', () => teamHpTimeout(room));
  // AI 봇 자동 분배
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 1500 + Math.random() * 1500;
      setTimeout(() => aiTeamHpDistribute(room, p.index), delay);
    }
  }
}

function teamHpTimeout(room) {
  if (room.phase !== 'team_hp') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_hp' });
  // 미완료 플레이어: 균등 분할 (10을 반반 = 5/5, 쌍둥이면 2/4/4 등)
  for (let i = 0; i < room.playerCount; i++) {
    if (room.hpDone[i]) continue;
    const p = room.players[i];
    if (!p.draft?.pick1 || !p.draft?.pick2) continue;
    const hasTwins = p.draft.pick1 === 'twins' || p.draft.pick2 === 'twins';
    if (hasTwins) {
      // 쌍둥이: 슬롯1=쌍둥이 4 (형2/동생2), 슬롯2=6
      const twinSlot = p.draft.pick1 === 'twins' ? 'pick1' : 'pick2';
      const otherSlot = twinSlot === 'pick1' ? 'pick2' : 'pick1';
      p.hpDist = {
        [twinSlot]: 4,
        [otherSlot]: 6,
        twinElder: 2, twinYounger: 2,
      };
      p.pieces = buildTeamPieces(p.draft, p.hpDist);
    } else {
      p.hpDist = { pick1: 5, pick2: 5 };
      p.pieces = buildTeamPieces(p.draft, p.hpDist);
    }
    room.hpDone[i] = true;
  }
  transitionToTeamReveal(room);
}

// 팀전 pieces 빌더 — 티어 구분 없이 2개 캐릭터 생성
function buildTeamPieces(draft, hpDist) {
  const pieces = [];
  for (const slot of ['pick1', 'pick2']) {
    const type = draft[slot];
    if (!type) continue;
    const charDef = ALL_CHARS.find(c => c.type === type);
    const tier = charDef?.tier || 1;
    if (type === 'twins') {
      const elderHp = hpDist.twinElder || 1;
      const youngerHp = hpDist.twinYounger || 1;
      const elder = createPiece('twins', tier, elderHp, { subUnit: 'elder', parentType: 'twins' });
      elder.type = 'twins_elder';
      const younger = createPiece('twins', tier, youngerHp, { subUnit: 'younger', parentType: 'twins' });
      younger.type = 'twins_younger';
      pieces.push(elder, younger);
    } else {
      pieces.push(createPiece(type, tier, hpDist[slot] || 1));
    }
  }
  return pieces;
}

function transitionToTeamReveal(room) {
  clearTimer(room);
  room.phase = 'team_reveal';
  room.revealDone = Array(room.playerCount).fill(false);
  // AI 봇은 즉시 자동 확인
  for (const p of room.players) {
    if (p.socketId === 'AI') room.revealDone[p.index] = true;
  }
  // 4명의 모든 pieces를 전체 공개
  const allPlayerPieces = room.players.map(p => ({
    idx: p.index,
    name: p.name,
    teamId: p.teamId,
    pieces: pieceSummary(p.pieces),
  }));
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_reveal_phase', {
      myIdx: p.index,
      teamId: p.teamId,
      teams: room.teams,
      allPlayerPieces,
    });
  }
  startTimer(room, 'team_reveal', () => teamRevealTimeout(room));
  // 모두 봇이면 즉시 다음 페이즈로 (이론상 가능)
  if (room.revealDone.every(d => d)) {
    setTimeout(() => {
      if (room.phase === 'team_reveal') transitionToTeamPlacement(room);
    }, 3000);
  }
}

function teamRevealTimeout(room) {
  if (room.phase !== 'team_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_reveal' });
  transitionToTeamPlacement(room);
}

function transitionToTeamPlacement(room) {
  clearTimer(room);
  room.phase = 'team_placement';
  room.placementDone = Array(room.playerCount).fill(false);
  // 모든 pieces를 미배치 상태로 리셋 (col=-1, row=-1)
  for (const p of room.players) {
    for (const pc of p.pieces) {
      pc.col = -1; pc.row = -1;
    }
  }
  for (const p of room.players) {
    if (!p.socketId) continue;
    // 1v1과 동일하게 상대팀 양 플레이어의 full piece 정보(스킬·패시브 포함) 제공
    const oppTeamId = 1 - p.teamId;
    const opponents = (room.teams[oppTeamId] || []).map(i => ({
      idx: i,
      name: room.players[i].name,
      pieces: room.players[i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      })),
    }));
    io.to(p.socketId).emit('team_placement_phase', {
      myIdx: p.index,
      teamId: p.teamId,
      teams: room.teams,
      boardBounds: room.boardBounds,
      zone: getTeamPlacementZone(p.teamId),
      myPieces: pieceSummary(p.pieces),
      teammates: getTeammates(room, p.index).map(i => ({
        idx: i,
        name: room.players[i].name,
        pieces: pieceSummary(room.players[i].pieces),
      })),
      opponents,
    });
  }
  startTimer(room, 'team_placement', () => teamPlacementTimeout(room));
  // AI 봇 자동 배치 — 즉시 (사용자 요청: 내가 배치할 때까지 기다리지 말 것)
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 300 + Math.random() * 400;
      setTimeout(() => aiTeamPlace(room, p.index), delay);
    }
  }
}

// 팀 배치 구역
function getTeamPlacementZone(teamId) {
  if (teamId === 0) return { rowMin: 0, rowMax: 2 };  // A팀 상단
  return { rowMin: 4, rowMax: 6 };                    // B팀 하단
}

// 팀 배치 상태를 팀원에게 브로드캐스트
function broadcastTeamPlacementUpdate(room, changedIdx) {
  if (!room || room.mode !== 'team') return;
  const teamId = room.players[changedIdx]?.teamId;
  if (teamId === undefined || teamId === null) return;
  const teamMembers = room.teams[teamId] || [];
  // 팀 내 모두에게 팀 전체 pieces 상태 전송
  const teamPieces = teamMembers.map(i => ({
    idx: i,
    name: room.players[i].name,
    pieces: pieceSummary(room.players[i].pieces),
  }));
  for (const tIdx of teamMembers) {
    const tp = room.players[tIdx];
    if (!tp || !tp.socketId) continue;
    io.to(tp.socketId).emit('team_placement_update', { teamPieces });
  }
}

function teamPlacementTimeout(room) {
  if (room.phase !== 'team_placement') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_placement' });
  // 미배치 유닛은 자동 배치 (팀 구역 내 빈 칸)
  for (let i = 0; i < room.playerCount; i++) {
    if (room.placementDone[i]) continue;
    const p = room.players[i];
    const zone = getTeamPlacementZone(p.teamId);
    // 팀 내 점유된 칸 수집
    const occupied = new Set();
    for (const tIdx of room.teams[p.teamId]) {
      for (const pc of room.players[tIdx].pieces) {
        if (pc.col >= 0 && pc.row >= 0) occupied.add(`${pc.col},${pc.row}`);
      }
    }
    // 미배치 pieces 순회하며 빈 칸에 자동 배치
    for (const pc of p.pieces) {
      if (pc.col >= 0) continue;
      for (let r = zone.rowMin; r <= zone.rowMax; r++) {
        let placed = false;
        for (let c = room.boardBounds.min; c <= room.boardBounds.max; c++) {
          const key = `${c},${r}`;
          if (!occupied.has(key)) {
            pc.col = c; pc.row = r;
            occupied.add(key);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    room.placementDone[i] = true;
  }
  startTeamGameFromRoom(room);
}

// 팀전 게임 시작 — A1 먼저
function startTeamGameFromRoom(room) {
  clearTimer(room);
  room.phase = 'game';
  // ── 슬롯 정규화: 각 팀이 정확히 slotPos 0/1 한 명씩 갖도록 강제 ──
  // 기존 slotPos 가 명시되어 있으면 그 값을 우선 보존 (봇 추가 시 명시적 slotPos 가 join 순서와 다를 수 있음)
  // 정렬 후 인덱스로 재정규화 — 충돌·결손이 있을 때만 변경됨
  for (let teamId = 0; teamId < 2; teamId++) {
    const teamMembers = room.teams[teamId] || [];
    // 1) 기존 slotPos 기준으로 팀 배열 정렬 (없거나 동일하면 join 순서 유지)
    teamMembers.sort((a, b) => {
      const pa = room.players[a]?.slotPos;
      const pb = room.players[b]?.slotPos;
      const na = (pa == null) ? 99 : pa;
      const nb = (pb == null) ? 99 : pb;
      if (na !== nb) return na - nb;
      return a - b;
    });
    // 2) 정렬된 순서로 slotPos 재할당 (충돌·결손 자동 보정)
    teamMembers.forEach((idx, slotIdx) => {
      const p = room.players[idx];
      if (p) p.slotPos = slotIdx;  // 0 or 1
    });
  }
  // 선공 무작위 — 팀 / 팀 내 슬롯 모두 랜덤 (사용자 요청: 항상 블루팀이 먼저 X)
  const startTeam = Math.random() < 0.5 ? 0 : 1;
  const startTeamMembers = (room.teams[startTeam] || []);
  const startSlot = startTeamMembers.length > 0 ? Math.floor(Math.random() * startTeamMembers.length) : 0;
  room.currentPlayerIdx = startTeamMembers[startSlot] ?? 0;
  room.turnNumber = 1;
  // turnSlotIdx 초기화 — 4슬롯 순환의 시작점
  const firstPlayer = room.players[room.currentPlayerIdx];
  room.turnSlotIdx = getSlotIdxOfPlayer(firstPlayer, room);
  // 팀 내부 round-robin 인덱스 — 시작팀의 다음 멤버, 반대팀은 0번부터
  const otherTeam = 1 - startTeam;
  room.teamRotationIdx = [];
  room.teamRotationIdx[startTeam] = (startSlot + 1) % Math.max(startTeamMembers.length, 1);
  room.teamRotationIdx[otherTeam] = 0;
  // 첫 플레이어 턴 리셋
  const first = room.players[room.currentPlayerIdx];
  if (first) {
    first.actionDone = false;
    first.actionUsedSkillReplace = false;
    first.skillsUsedBeforeAction = [];
    first.twinMovedSubs = [];
  }
  // 초기 게임 상태 브로드캐스트
  for (const p of room.players) {
    if (!p.socketId) continue;
    const state = getTeamGameStateFor(room, p.index);
    io.to(p.socketId).emit('team_game_start', {
      ...state,
      teams: room.teams,
    });
  }
  // 관전자 (Phase 5에서 보강)
  emitToSpectators(room, 'spectator_log', { msg: `전투 개시. 선공은${first?.name || '?'}`, type: 'event' });
  // 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));
  // 첫 플레이어가 AI라면 자동으로 턴 시작
  if (first && first.socketId === 'AI') {
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === first.index) {
        aiTeamTakeTurn(room, first.index);
      }
    }, 3000);
  }
}

// ── 초기 공개: 드래프트 직후, 상대 캐릭터 타입 공개 ──
function transitionToInitialReveal(room) {
  clearTimer(room);
  room.phase = 'initial_reveal';
  if (room.isAI) {
    room.initialRevealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppDraft = room.players[1 - i].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      io.to(p.socketId).emit('initial_reveal_phase', {
        myDraft: p.draft,
        oppChars,
        myDeckName: p.deckName || '',
        oppDeckName: room.players[1 - i].deckName || '',
        myName: p.name,
        oppName: room.players[1 - i].name,
      });
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'initial_reveal',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'initial_reveal', () => initialRevealTimeout(room));
}

function initialRevealTimeout(room) {
  if (room.phase !== 'initial_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'initial_reveal' });
  for (let i = 0; i < 2; i++) {
    if (!room.initialRevealDone[i]) room.initialRevealDone[i] = true;
  }
  transitionToExchangeDraft(room);
}

// 덱 유효성 검사 (무효하면 랜덤)
function validateDeck(deck) {
  if (!deck || !deck.t1 || !deck.t2 || !deck.t3) {
    return { t1: randomPick(CHARACTERS[1]).type, t2: randomPick(CHARACTERS[2]).type, t3: randomPick(CHARACTERS[3]).type };
  }
  const t1 = CHARACTERS[1].find(c => c.type === deck.t1) ? deck.t1 : randomPick(CHARACTERS[1]).type;
  const t2 = CHARACTERS[2].find(c => c.type === deck.t2) ? deck.t2 : randomPick(CHARACTERS[2]).type;
  const t3 = CHARACTERS[3].find(c => c.type === deck.t3) ? deck.t3 : randomPick(CHARACTERS[3]).type;
  return { t1, t2, t3 };
}

// AI 덱 이름 — 조합 분석해서 그럴싸한 별칭 생성
function aiGenerateDeckName(draft) {
  if (!draft) return '뉴비 정찰대';
  const types = [draft.t1, draft.t2, draft.t3].filter(Boolean);
  if (types.length === 0) return '미정 부대';
  const chars = types.map((t, i) => findCharData(t, i + 1));
  const tags = chars.map(c => c.tag).filter(Boolean);
  const royalCount = tags.filter(t => t === 'royal').length;
  const villainCount = tags.filter(t => t === 'villain').length;
  const setHas = (xs) => types.some(t => xs.includes(t));
  if (setHas(['gunpowder', 'sulfurCauldron'])) return '화염 분대';
  if (setHas(['shadowAssassin', 'witch', 'torturer'])) return '암흑 첩보대';
  if (setHas(['bodyguard', 'armoredWarrior'])) return '철벽 수비대';
  if (setHas(['herbalist']) && setHas(['monk'])) return '신성 치유단';
  if (setHas(['herbalist']) || setHas(['monk'])) return '서포트 부대';
  if (royalCount >= 2) return '왕실 근위대';
  if (villainCount >= 2) return '어둠의 패거리';
  if (setHas(['cavalry', 'messenger', 'twins'])) return '기동 정찰대';
  if (setHas(['ratMerchant', 'manhunter'])) return '음습한 사냥꾼';
  if (setHas(['dragonTamer'])) return '드래곤의 군단';
  if (setHas(['king', 'commander'])) return '지휘 사령부';
  return '균형 부대';
}

// 캐릭터 데이터 조회 헬퍼
function findCharData(type, tier) {
  const ch = CHARACTERS[tier]?.find(c => c.type === type);
  if (!ch) return { type, name: type, icon: '?', desc: '' };
  return { type: ch.type, name: ch.name, icon: ch.icon, desc: ch.desc, tag: ch.tag, atk: ch.atk, range: ch.range, skills: ch.skills || [], passives: ch.passives || [] };
}

// ── AI 교환 드래프트 카운터픽 결정 ──
// 상대 조합 분석 → 가장 가치 높은 카운터 1티어 결정. 없으면 null (교환 안 함)
function aiDecideExchange(myDraft, oppDraft) {
  if (!myDraft || !oppDraft) return null;
  const opp = [oppDraft.t1, oppDraft.t2, oppDraft.t3];
  const my = { 1: myDraft.t1, 2: myDraft.t2, 3: myDraft.t3 };
  const ROYAL = new Set(['spearman','cavalry','watchman','general','bodyguard','prince','princess','king','commander','monk']);
  const VILLAIN = new Set(['twins','manhunter','witch','ratMerchant','shadowAssassin','torturer','count','slaughterHero','sulfurCauldron']);
  const TANK = new Set(['bodyguard','armoredWarrior','count']);
  const RANGED = new Set(['archer','spearman','cavalry','wizard','ratMerchant','dragonTamer','sulfurCauldron']);
  const HEAL = new Set(['herbalist','monk']);
  const oppRoyal = opp.filter(t => ROYAL.has(t)).length;
  const oppVillain = opp.filter(t => VILLAIN.has(t)).length;
  const oppRanged = opp.filter(t => RANGED.has(t)).length;
  const oppHeal = opp.filter(t => HEAL.has(t)).length;
  const oppHasTank = opp.some(t => TANK.has(t));
  const oppHasShadow = opp.includes('shadowAssassin');
  const oppHasWizard = opp.includes('wizard');
  const oppHasHerbalist = opp.includes('herbalist');
  const oppHasMonk = opp.includes('monk');
  const oppHasTwins = opp.includes('twins');
  const oppHasRats = opp.includes('ratMerchant');
  const myAlready = (type) => my[1] === type || my[2] === type || my[3] === type;

  // 후보 수집 — priority + variety boost (작은 무작위 가산점으로 같은 우선순위 후보 중 다양화)
  const counters = [];
  const addCounter = (tier, newType, basePriority) => {
    if (myAlready(newType)) return;
    if (my[tier] === newType) return;  // 안전망: 이미 같은 자리에 있는 캐릭터면 제외
    const variety = Math.random() * 8;  // 0~8 랜덤 가산
    counters.push({ tier, newType, priority: basePriority + variety, _base: basePriority });
  };

  // ── 왕실 다수 → 저주/악몽 콤보 ──
  if (oppRoyal >= 2) {
    addCounter(3, 'torturer',     85);
    addCounter(2, 'witch',        75);
    addCounter(1, 'manhunter',    55);  // 덫으로 견제
  }
  // ── 악인 다수 → 수도승 가호 ──
  if (oppVillain >= 2) {
    addCounter(3, 'monk',         80);
    addCounter(3, 'commander',    50);  // 사기증진
  }
  // ── 탱커 보유 → 저주(우회) / 학살영웅 / 마법사(원거리) / 폭탄 ──
  if (oppHasTank) {
    addCounter(2, 'witch',        70);
    addCounter(3, 'slaughterHero',60);
    addCounter(2, 'wizard',       55);
    addCounter(1, 'gunpowder',    50);
  }
  // ── 그림자 암살자 → 수도승/마녀(저주로 스킬봉인) ──
  if (oppHasShadow) {
    addCounter(3, 'monk',         65);
    addCounter(2, 'witch',        60);
  }
  // ── 약초+왕실 → 표식+악몽 콤보 ──
  if (oppHasHerbalist && oppRoyal >= 2) {
    addCounter(3, 'torturer',     90);
  }
  // ── 마법사 → 우회/회피형 ──
  if (oppHasWizard) {
    addCounter(1, 'gunpowder',    58);
    addCounter(1, 'manhunter',    52);
    addCounter(2, 'shadowAssassin', 50);
  }
  // ── 적 수도승 → 영역 공격 ──
  if (oppHasMonk) {
    addCounter(3, 'sulfurCauldron', 65);
    addCounter(1, 'gunpowder',    50);
  }
  // ── 적 쌍둥이 → 영역 공격 (좁은 범위에 둘 다 잡을 수 있음) ──
  if (oppHasTwins) {
    addCounter(3, 'sulfurCauldron', 60);
    addCounter(1, 'gunpowder',    55);
  }
  // ── 적 쥐 장수 → 표식/광역 (쥐 청소) ──
  if (oppHasRats) {
    addCounter(2, 'wizard',       55);
    addCounter(3, 'sulfurCauldron', 50);
  }
  // ── 원거리 다수 → 그림자 암살자/전령 (기동) ──
  if (oppRanged >= 2) {
    addCounter(2, 'shadowAssassin', 55);
    addCounter(1, 'messenger',    48);
  }
  // ── 적 회복 다수 → 학살영웅/유황 ──
  if (oppHeal >= 1) {
    addCounter(3, 'slaughterHero', 55);
  }
  // ── 일반적 강력 픽 (베이스라인 다양성) ──
  addCounter(3, 'king',           35);  // 안정적 3티어
  addCounter(2, 'armoredWarrior', 30);
  addCounter(1, 'archer',         25);

  if (counters.length === 0) return null;
  counters.sort((a, b) => b.priority - a.priority);
  // 상위 3개 중 가중 랜덤 — 항상 #1만 뽑지 않도록
  const topN = counters.slice(0, Math.min(3, counters.length));
  const totalWeight = topN.reduce((s, c) => s + c.priority, 0);
  let r = Math.random() * totalWeight;
  let pick = topN[0];
  for (const c of topN) { r -= c.priority; if (r <= 0) { pick = c; break; } }
  // 베이스 우선순위 50 미만 카운터는 35% 확률로 패스 (확실하지 않으면 안 바꿈)
  if (pick._base < 50 && Math.random() < 0.35) return null;
  // priority(_base) 노출 — confirm_initial_reveal 핸들러에서 YES/NO 결정에 활용.
  return { tier: pick.tier, newType: pick.newType, priority: pick._base };
}

// ── 교환 드래프트: 같은 티어 내 1캐릭터 교환 가능 (60초) ──
//   #12 단일측 흐름: exchangeDecisions 가 NO 인 측은 자동 done 처리, 'exchange_waiting' 상태로 emit.
// AI 시나리오 — final_reveal 로 진행할 때 7~15초 무작위 "AI 가 고민 중" 딜레이.
//   인간이 ✓로 교환 드래프트를 진행했든, ✗로 그 자리에서 대기했든 동일하게 적용 →
//   인간이 swap 결과를 보기 전에 항상 7~15초 대기 UI 를 거침. (둘 다 NO 케이스만 예외 — 진입조차 안 함)
function transitionToExchangeDraft(room) {
  clearTimer(room);
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  room.phase = 'exchange_draft';
  if (!room.exchangeDecisions) room.exchangeDecisions = [null, null];
  // 교환 페이즈 공유 타이머 시작 시각 — 양측 동시에 60초 카운트가 흐름.
  //   누군가 일찍 끝낸 후 보는 카운트다운은 "남은 시간" 기준 (실시간 동기화).
  room._exchangeStart = Date.now();
  room._exchangeMaxMs = 60000;

  // AI 가 YES 한 경우 — AI 가 "고민하고 캐릭터 픽 확정" 하는 데 7~15초 강제 딜레이.
  //   서버 내부에서는 _pendingSwap 즉시 계산 (게임 로직 결정성), 하지만 exchangeDone[1] 은 7-15s 후 설정 →
  //   인간 입장에서는 AI 가 이 시간동안 "고민 중" 인 것처럼 보임.
  const aiYes = room.isAI && room.exchangeDecisions[1] === true;
  const aiThinkMs = aiYes ? (7000 + Math.floor(Math.random() * 8001)) : 0;

  if (room.isAI) {
    const aiPlayer = room.players[1];
    const human = room.players[0];
    aiPlayer._exchangeOriginal = { ...aiPlayer.draft };
    if (aiYes) {
      // _pendingSwap 즉시 계산 (외부에서 보이지 않음)
      const swap = aiPlayer._aiPrecomputedSwap || aiDecideExchange(aiPlayer.draft, human.draft);
      if (swap) {
        const key = swap.tier === 1 ? 't1' : swap.tier === 2 ? 't2' : 't3';
        const currentType = aiPlayer.draft[key];
        const conflictsOtherSlot =
          (key !== 't1' && aiPlayer.draft.t1 === swap.newType) ||
          (key !== 't2' && aiPlayer.draft.t2 === swap.newType) ||
          (key !== 't3' && aiPlayer.draft.t3 === swap.newType);
        if (currentType !== swap.newType && !conflictsOtherSlot) {
          aiPlayer._pendingSwap = { tier: swap.tier, key, newType: swap.newType };
        }
      }
      // exchangeDone[1] 은 일부러 false 유지 — 7-15초 setTimeout 안에서 true 로 전환
    } else {
      // AI NO — 즉시 done
      room.exchangeDone[1] = true;
    }
    delete aiPlayer._aiPrecomputedSwap;
  }

  // 인간 측 처리
  //   - NO/✗ 측: 자동 done + 카운트다운 (AI YES 면 ai_decision_wait, 그 외 exchange_waiting_phase)
  //   - YES/✓ 측: exchange_draft_phase 로 정상 교환 드래프트 화면
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const wantsExchange = room.exchangeDecisions[i] === true;
      if (!wantsExchange) {
        room.exchangeDone[i] = true;
        // 페이즈 시작 시점이라 remaining = 60000. 동일 이벤트로 AI/인간 분기 제거.
        const remainingMs = exchangeRemainingMs(room);
        io.to(p.socketId).emit('ai_decision_wait', { waitMs: remainingMs });
        console.log(`[transitionToExchangeDraft] NO side waitMs=${remainingMs}${aiYes ? ` (AI internal think=${aiThinkMs}ms)` : ''}`);
      } else {
        const available = {};
        for (const tier of [1, 2, 3]) {
          const myType = tier === 1 ? p.draft.t1 : tier === 2 ? p.draft.t2 : p.draft.t3;
          available[tier] = CHARACTERS[tier]
            .filter(c => c.type !== myType)
            .map(c => ({ type: c.type, name: c.name, icon: c.icon, desc: c.desc, tag: c.tag, atk: c.atk, range: c.range, isTwin: !!c.isTwin, skills: c.skills, passives: c.passives }));
        }
        io.to(p.socketId).emit('exchange_draft_phase', {
          myDraft: p.draft,
          available,
          oppDraft: room.players[1 - i].draft,
        });
      }
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'exchange_draft',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
  });

  // AI thinking 타이머 (AI 가 YES 인 경우만) — 7-15s 후 exchangeDone[1]=true + 양측 done 체크
  if (aiYes) {
    room._aiThinkStart = Date.now();
    room._aiThinkMs = aiThinkMs;
    console.log(`[transitionToExchangeDraft] starting AI think timer ${aiThinkMs}ms`);
    room._aiThinkTimer = setTimeout(() => {
      room._aiThinkTimer = null;
      // ★ 진단 #1/#2: phase 가 이미 다른 상태로 넘어갔으면 (게임 종료/연결끊김 등) 즉시 중단.
      //   stale 콜백이 ended room 의 exchangeDone 를 건드리거나 transitionToFinalReveal 을 잘못 호출하지 않도록.
      if (!room || room.phase !== 'exchange_draft') return;
      room.exchangeDone[1] = true;
      console.log(`[ai think timer fired] phase=${room.phase} exchangeDone=${JSON.stringify(room.exchangeDone)}`);
      if (room.exchangeDone.every(d => d)) {
        transitionToFinalReveal(room);
      }
      // 인간이 아직 픽 중이면 그냥 기다림 — 인간이 submit 할 때 exchange_pick 핸들러에서 transition
    }, aiThinkMs);
  }

  // 즉시 양측 done 체크 (사실상 이 함수 진입 시 양측 done 인 경우는 거의 없음 —
  //   anyYes=true 라서 진입하므로 적어도 한쪽은 ✓ 하거나 AI YES, 그쪽이 picking 중)
  if (room.exchangeDone.every(d => d)) {
    transitionToFinalReveal(room);
  } else {
    startTimer(room, 'exchange_draft', () => exchangeDraftTimeout(room));
  }
}

function exchangeDraftTimeout(room) {
  if (room.phase !== 'exchange_draft') return;
  // AI thinking 타이머도 정리 (어차피 timeout 으로 전체 종료)
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  for (let i = 0; i < 2; i++) {
    if (!room.exchangeDone[i]) {
      room.exchangeDone[i] = true;
      const sock = io.sockets.sockets.get(room.players[i].socketId);
      if (sock) sock.emit('exchange_done', { draft: room.players[i].draft, timeout: true });
    }
  }
  transitionToFinalReveal(room);
}

// ── 최종 공개: 교환 후 상대 캐릭터 공개 ──
function transitionToFinalReveal(room) {
  clearTimer(room);
  // AI thinking 타이머 / 관련 메타데이터 정리 + 교환 페이즈 시작 시각 정리
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  delete room._aiThinkStart;
  delete room._aiThinkMs;
  delete room._exchangeStart;
  delete room._exchangeMaxMs;
  room.phase = 'final_reveal';
  if (room.isAI) {
    // 보류된 AI 교체를 여기서 적용 — 사용자가 본 exchange_draft_phase는 교체 전 조합
    const aiPlayer = room.players[1];
    if (aiPlayer && aiPlayer._pendingSwap) {
      aiPlayer.draft[aiPlayer._pendingSwap.key] = aiPlayer._pendingSwap.newType;
      delete aiPlayer._pendingSwap;
    }
    delete aiPlayer._exchangeOriginal;
    room.finalRevealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppDraft = room.players[1 - i].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      io.to(p.socketId).emit('final_reveal_phase', {
        myDraft: p.draft,
        oppChars,
        myDeckName: p.deckName || '',
        oppDeckName: room.players[1 - i].deckName || '',
        myName: p.name,
        oppName: room.players[1 - i].name,
      });
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'final_reveal',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'final_reveal', () => finalRevealTimeout(room));
}

function finalRevealTimeout(room) {
  if (room.phase !== 'final_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'final_reveal' });
  for (let i = 0; i < 2; i++) {
    if (!room.finalRevealDone[i]) room.finalRevealDone[i] = true;
  }
  transitionToHpPhase(room);
}

function transitionToHpPhase(room) {
  clearTimer(room);
  room.phase = 'hp_distribution';
  if (room.isAI) {
    const hasTwins = room.players[1].draft.t1 === 'twins';
    const aiHps = aiDistributeHp(hasTwins);
    const aiD = room.players[1].draft;
    if (aiD.t1 === 'twins') {
      room.players[1].pieces = [
        createPiece('twins', 1, aiHps[0], { subUnit: 'elder', parentType: 'twins' }),
        createPiece('twins', 1, aiHps[1], { subUnit: 'younger', parentType: 'twins' }),
        createPiece(aiD.t2, 2, aiHps[2]),
        createPiece(aiD.t3, 3, aiHps[3]),
      ];
      room.players[1].pieces[0].type = 'twins_elder';
      room.players[1].pieces[1].type = 'twins_younger';
    } else {
      room.players[1].pieces = [
        createPiece(aiD.t1, 1, aiHps[0]),
        createPiece(aiD.t2, 2, aiHps[1]),
        createPiece(aiD.t3, 3, aiHps[2]),
      ];
    }
    room.players[1].hpDist = aiHps;
    room.hpDone[1] = true;
  }
  room.players.forEach((p) => {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit('hp_phase', { draft: p.draft, hasTwins: p.draft.t1 === 'twins' });
    }
  });
  // 관전자에게 HP 페이즈 시작 알림
  emitToSpectators(room, 'spectator_phase', {
    phase: 'hp',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'hp_distribution', () => hpTimeout(room));
}

function startRevealPhaseFromRoom(room) {
  clearTimer(room);
  room.phase = 'reveal';
  if (room.isAI) {
    room.revealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppPieces = room.players[1 - i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      io.to(p.socketId).emit('reveal_phase', {
        yourPieces: pieceSummary(p.pieces),
        oppPieces,
      });
    }
  });
  // 관전자에게 공개 페이즈 알림
  emitToSpectators(room, 'spectator_reveal', {
    p0Pieces: pieceSummary(room.players[0].pieces),
    p1Pieces: pieceSummary(room.players[1].pieces),
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
  });
  startTimer(room, 'reveal', () => revealTimeout(room));
}

function revealTimeout(room) {
  if (room.phase !== 'reveal') return;
  for (let i = 0; i < 2; i++) {
    if (!room.revealDone[i] && room.players[i].socketId !== 'AI') {
      room.revealDone[i] = true;
    }
  }
  if (room.revealDone.every(d => d)) {
    transitionToPlacement(room);
  }
}

function transitionToPlacement(room) {
  clearTimer(room);
  room.phase = 'placement';
  if (room.isAI) {
    aiPlacePieces(room.players[1].pieces, room.boardBounds);
    room.placementDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppPieces = room.players[1 - i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      io.to(p.socketId).emit('placement_phase', { pieces: pieceSummary(p.pieces), oppPieces });
    }
  });
  // 관전자에게 배치 페이즈 시작 알림
  emitToSpectators(room, 'spectator_placement_start', {
    p0Pieces: pieceSummary(room.players[0].pieces),
    p1Pieces: pieceSummary(room.players[1].pieces),
    boardBounds: room.boardBounds,
  });
  startTimer(room, 'placement', () => placementTimeout(room));
}

function startGameFromRoom(room) {
  clearTimer(room);
  room.phase = 'game';
  const firstPlayer = Math.random() < 0.5 ? 0 : 1;
  room.currentPlayerIdx = firstPlayer;
  room.turnNumber = 1;

  room.players[firstPlayer].actionDone = false;
  room.players[firstPlayer].actionUsedSkillReplace = false;
  room.players[firstPlayer].skillsUsedBeforeAction = [];
  room.players[firstPlayer].twinMovedSubs = [];

  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit('game_start', {
        yourPieces: pieceSummary(p.pieces),
        oppPieces: oppPieceSummary(room.players[1 - i].pieces),
        currentPlayerIdx: firstPlayer,
        turnNumber: 1,
        isYourTurn: i === firstPlayer,
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardBounds: room.boardBounds,
        boardObjects: boardObjectsSummary(room, i),
      });
    }
  });
  // 관전자에게 게임 시작 알림
  emitToSpectators(room, 'spectator_log', { msg: '전투 개시. 선공은 ' + room.players[room.currentPlayerIdx].name, type: 'event' });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
  // 첫 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));

  // AI가 선공인 경우 AI 턴 실행
  if (room.isAI && firstPlayer === 1) {
    setTimeout(() => {
      if (room.phase === 'game') aiTakeTurn(room);
    }, 3000);
  }
}

function createPiece(type, tier, hp, extra) {
  const baseType = (type === 'twins_elder' || type === 'twins_younger') ? 'twins' : type;
  const c = getChar(baseType);
  if (!c) return null;

  const skillList = c.skills || [];
  const hasSkill = skillList.length > 0;
  const firstSkill = skillList[0] || null;

  // 쌍둥이: subUnit별 개별 아이콘/이름 (관계 설정은 남매 — 누나·동생)
  let pieceIcon = c.icon;
  let pieceName = c.name;
  if (extra?.subUnit === 'elder') {
    pieceIcon = '👧';
    pieceName = '쌍둥이 강도 누나';
  } else if (extra?.subUnit === 'younger') {
    pieceIcon = '👦';
    pieceName = '쌍둥이 강도 동생';
  }

  const base = {
    type, tier, name: pieceName, icon: pieceIcon, atk: c.atk, tag: c.tag,
    desc: c.desc, hp, maxHp: hp, col: -1, row: -1, alive: true,
    statusEffects: [],
    // Skill state from CHARACTERS definition
    hasSkill,
    skillName: firstSkill ? firstSkill.name : null,
    skillId: firstSkill ? firstSkill.id : null,
    skillCost: firstSkill ? firstSkill.cost : 0,
    skillReplacesAction: firstSkill ? firstSkill.replacesAction : false,
    // Multi-skill support: store all skills for characters with multiple skills
    skills: skillList,
    // Passives
    passives: c.passives || [],
    passiveName: null,
    // Toggle state for archer/weaponSmith
    toggleState: null,
    // Wizard one-time SP passive used
    wizardPassiveUsed: false,
    // DualBlade attacks left this turn (쌍검무 활성 시 2)
    dualBladeAttacksLeft: 0,
    // Messenger sprint active this turn
    messengerSprintActive: false,
    messengerMovesLeft: 0,
    // Dragon summoned flag (for dragonTamer)
    dragonSummoned: false,
    // Sub-unit info for twins
    subUnit: extra?.subUnit || null,
    parentType: extra?.parentType || null,
    // Is this a summoned dragon?
    isDragon: extra?.isDragon || false,
    ownerIdx: extra?.ownerIdx ?? -1,
  };

  // Set passive display names
  if (base.passives.includes('instantMagic')) base.passiveName = '인스턴트매직';
  if (base.passives.includes('ironSkin')) base.passiveName = '아이언스킨';
  if (base.passives.includes('grace')) base.passiveName = '가호';
  if (base.passives.includes('betrayer')) base.passiveName = '배반자';
  if (base.passives.includes('wrath')) base.passiveName = '사기증진';
  if (base.passives.includes('markPassive')) base.passiveName = '표식';
  if (base.passives.includes('tyranny')) base.passiveName = '폭정';
  if (base.passives.includes('loyalty')) base.passiveName = '충성';

  return base;
}

function pieceSummary(pieces) {
  return pieces.map((pc, idx) => ({
    index: idx, type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
    hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, desc: pc.desc, tag: pc.tag,
    col: pc.col, row: pc.row, alive: pc.alive,
    statusEffects: pc.statusEffects,
    hasSkill: pc.hasSkill, skillName: pc.skillName, skillId: pc.skillId,
    skillCost: pc.skillCost, skillReplacesAction: pc.skillReplacesAction,
    skills: pc.skills || [],
    passiveName: pc.passiveName, passives: pc.passives,
    toggleState: pc.toggleState,
    subUnit: pc.subUnit,
    isDragon: pc.isDragon,
    wizardPassiveUsed: pc.wizardPassiveUsed,
    dualBladeAttacksLeft: pc.dualBladeAttacksLeft || 0,
    messengerSprintActive: pc.messengerSprintActive,
    messengerMovesLeft: pc.messengerMovesLeft,
    dragonSummoned: pc.dragonSummoned,
  }));
}

function oppPieceSummary(pieces) {
  return pieces.map((pc, idx) => {
    const hasMark = pc.statusEffects.some(e => e.type === 'mark');
    return {
      index: idx, type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
      hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, desc: pc.desc, tag: pc.tag,
      alive: pc.alive,
      statusEffects: pc.statusEffects.filter(e => e.type !== 'trap'),
      hasSkill: pc.hasSkill, skillName: pc.skillName,
      skillCost: pc.skillCost,
      skills: pc.skills || [],
      passives: pc.passives || [],
      passiveName: pc.passiveName,
      subUnit: pc.subUnit,
      isDragon: pc.isDragon,
      range: pc.range,
      toggleState: pc.toggleState,
      // 표식 상태인 적은 위치 공개
      col: hasMark ? pc.col : undefined,
      row: hasMark ? pc.row : undefined,
      marked: hasMark,
    };
  });
}

function boardObjectsSummary(room, playerIdx) {
  const own = room.boardObjects[playerIdx].map(o => ({ ...o }));
  const oppRats = room.rats[1 - playerIdx].map(r => ({ type: 'rat', col: r.col, row: r.row, owner: 1 - playerIdx }));
  const ownRats = room.rats[playerIdx].map(r => ({ type: 'rat', col: r.col, row: r.row, owner: playerIdx }));
  return [...own, ...oppRats, ...ownRats];
}

// ══════════════════════════════════════════════════════════════════
// ── Damage Resolution Pipeline ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function resolveDamage(room, attackerPiece, defenderPiece, attackerIdx, baseDamage, isStatusDmg, defIdx) {
  // 팀전: 실제 방어자 인덱스를 인자로 받음 / 1v1: 1-attackerIdx
  const defenderIdx = (defIdx !== undefined && defIdx !== null) ? defIdx : (1 - attackerIdx);
  const defender = room.players[defenderIdx];
  const attacker = room.players[attackerIdx];
  let dmg = baseDamage;

  // Status damage pipeline (curse): only shadow blocks
  if (isStatusDmg) {
    if (defenderPiece.statusEffects.some(e => e.type === 'shadow')) return 0;
    return dmg;
  }

  // Step 2: Commander buff — 팀모드에서는 팀원 지휘관 인접도 버프 적용
  if (attacker) {
    const commanderSources = (room.mode === 'team')
      ? getAllyIndices(room, attackerIdx).flatMap(i => room.players[i].pieces)
      : attacker.pieces;
    for (const p of commanderSources) {
      if (p.alive && p.type === 'commander' && p !== attackerPiece) {
        const dc = Math.abs(p.col - attackerPiece.col);
        const dr = Math.abs(p.row - attackerPiece.row);
        if ((dc === 0 && dr === 1) || (dc === 1 && dr === 0)) {
          dmg += 1;
          break;
        }
      }
    }
  }

  // Step 3: Monk attacking villain => damage = 3
  if (attackerPiece.type === 'monk' && defenderPiece.tag === 'villain') {
    dmg = 3;
    const atkName = room.players[attackerIdx].name;
    emitToBoth(room, 'passive_alert', { type: 'monk_attack', playerIdx: attackerIdx, msg: `🙏 가호: 악인 공격 시 3 피해` });
    emitToSpectators(room, 'spectator_log', { msg: `🙏 가호: 악인 공격 시 3 피해`, type: 'passive', playerIdx: attackerIdx });
  }

  // Step 4: Shadow => damage = 0
  if (defenderPiece.statusEffects.some(e => e.type === 'shadow')) {
    return 0;
  }

  // Step 5: ArmoredWarrior iron skin: -0.5 (not status dmg)
  if (defenderPiece.type === 'armoredWarrior') {
    const before = dmg;
    dmg = Math.max(0, dmg - 0.5);
    if (before !== dmg) {
      const defName = room.players[defenderIdx].name;
      emitToBoth(room, 'passive_alert', { type: 'armoredWarrior', playerIdx: defenderIdx, msg: `🛡 아이언 스킨: 피해 0.5 감소` });
      emitToSpectators(room, 'spectator_log', { msg: `🛡 아이언 스킨: 피해 0.5 감소`, type: 'passive', playerIdx: defenderIdx });
    }
  }

  // Step 6: Monk being attacked by villain => damage = 0.5
  if (defenderPiece.type === 'monk' && attackerPiece.tag === 'villain') {
    dmg = 0.5;
    const defName = room.players[defenderIdx].name;
    emitToBoth(room, 'passive_alert', { type: 'monk', playerIdx: defenderIdx, msg: `🙏 가호: 악인 공격 피해 0.5로 감소` });
    emitToSpectators(room, 'spectator_log', { msg: `🙏 가호: 악인 공격 피해 0.5로 감소`, type: 'passive', playerIdx: defenderIdx });
  }

  // Step 7: Count hit by tier 1 or 2 => -0.5
  if (defenderPiece.type === 'count' && (attackerPiece.tier === 1 || attackerPiece.tier === 2)) {
    const before = dmg;
    dmg = Math.max(0, dmg - 0.5);
    if (before !== dmg) {
      const defName = room.players[defenderIdx].name;
      emitToBoth(room, 'passive_alert', { type: 'count', playerIdx: defenderIdx, msg: `🦇 폭정: ${attackerPiece.tier}티어 공격 피해 0.5 감소` });
      emitToSpectators(room, 'spectator_log', { msg: `🦇 폭정: ${attackerPiece.tier}티어 공격 피해 0.5 감소`, type: 'passive', playerIdx: defenderIdx });
    }
  }

  // Step 8: Bodyguard passive — 왕실 아군 피해를 1로 줄이고 대신 받음 (항상 활성)
  // 팀모드: 방어자의 팀 전체에서 호위무사 탐색 + 대상 왕실은 팀원 것도 가능
  if (defenderPiece.tag === 'royal' && defenderPiece.type !== 'bodyguard') {
    const defenderTeamIdx = (room.mode === 'team')
      ? getAllyIndices(room, defenderIdx)
      : [defenderIdx];
    // 호위무사 탐색 (가장 먼저 찾은 것)
    let bodyguardPiece = null, bodyguardOwnerIdx = null;
    for (const bIdx of defenderTeamIdx) {
      const bg = room.players[bIdx].pieces.find(p => p.type === 'bodyguard' && p.alive);
      if (bg) { bodyguardPiece = bg; bodyguardOwnerIdx = bIdx; break; }
    }
    if (bodyguardPiece) {
      bodyguardPiece.hp = Math.max(0, bodyguardPiece.hp - 1);
      const defName = room.players[bodyguardOwnerIdx].name;
      emitToBoth(room, 'passive_alert', { type: 'bodyguard', playerIdx: bodyguardOwnerIdx, msg: `🛡 충성: ${defenderPiece.name} 대신 1 피해` });
      emitToSpectators(room, 'spectator_log', { msg: `🛡 충성: ${defenderPiece.name} 대신 1 피해`, type: 'passive', playerIdx: bodyguardOwnerIdx });
      // #1: 호위무사 피격 애니메이션을 위해 pending hit 정보를 사이드채널로 전달
      if (!room._pendingBodyguardHits) room._pendingBodyguardHits = [];
      const bgDefender = room.players[bodyguardOwnerIdx];
      const bgPieceIdx = bgDefender.pieces.indexOf(bodyguardPiece);
      room._pendingBodyguardHits.push({
        col: bodyguardPiece.col, row: bodyguardPiece.row,
        damage: 1, newHp: bodyguardPiece.hp, destroyed: bodyguardPiece.hp <= 0,
        hitName: bodyguardPiece.name, hitIcon: bodyguardPiece.icon,
        defPieceIdx: bgPieceIdx,
        defOwnerIdx: bodyguardOwnerIdx,  // 팀모드 라우팅용
        attackerSub: attackerPiece.subUnit || null,
        attackerName: attackerPiece.name,
        attackerIcon: attackerPiece.icon,
        bodyguardRedirect: true,
      });
      // #11: 호위무사 HP가 1이면 저주 즉시 해제 (패시브)
      checkCurseRemoval(room, bodyguardPiece, bodyguardOwnerIdx);
      if (bodyguardPiece.hp <= 0) {
        bodyguardPiece.alive = false;
        handleDeath(room, bodyguardPiece, bodyguardOwnerIdx);
      }
      return 0;
    }
  }

  return Math.max(0, dmg);
}

function setKillInfo(room, type, killer, victims) {
  room.lastKillInfo = { type, killer, victims: (victims || []).map(v => v.name || v) };
}

// #11: 저주 해제 조건 — 마녀 사망 또는 대상 HP ≤ 1 시 즉시 해제
function checkCurseRemoval(room, piece, ownerIdx) {
  if (!piece || !piece.statusEffects) return;
  const curse = piece.statusEffects.find(e => e.type === 'curse');
  if (!curse) return;
  const sourceIdx = curse.source;
  const sourceWitch = room.players[sourceIdx]?.pieces.find(pc => pc.type === 'witch' && pc.alive);
  if (!sourceWitch || piece.hp <= 1) {
    piece.statusEffects = piece.statusEffects.filter(e => e.type !== 'curse');
    const reason = !sourceWitch ? '마녀가 사망해' : '체력 고갈로';
    emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: ownerIdx, targetName: piece.name, msg: `☠ 저주: ${reason} ${piece.name}의 저주 해제` });
    emitToSpectators(room, 'spectator_log', { msg: `☠ 저주: ${reason} ${piece.name}의 저주 해제`, type: 'passive', playerIdx: ownerIdx });
    // AI 마녀 학습 — 같은 대상에 저주가 정화될 때마다 _curseHistory 카운트 증가 → 다음 시전 시 회피
    const witchOwner = room.players[sourceIdx];
    if (witchOwner && witchOwner.socketId === 'AI') {
      if (!witchOwner._curseHistory) witchOwner._curseHistory = {};
      const key = `${ownerIdx}:${piece.type}:${piece.subUnit || ''}`;
      witchOwner._curseHistory[key] = (witchOwner._curseHistory[key] || 0) + 1;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ── Animation Phase System ─────────────────────────────────────────
// 트리거 액션의 부산물 (사망 효과 등) 을 한꺼번에 휘몰아치지 않게 순차 페이즈로 묶음.
//
// 사용 패턴:
//   startPhase(room) → 액션 처리 (handleDeath 가 페이즈 큐에 효과 push)
//                   → flushPhase(room, onComplete)
// 페이즈 진행 중 _animPhaseEndsAt + _aiEndTurnEarliest 가 미래 시각으로 설정됨 →
// AI 행동 / 턴 전환 / 다음 액션이 이 시각까지 대기.
//
// 사용자 요구: 한 트리거의 모든 결과는 즉시(서버 사이드) 계산되지만, 클라가 보는
// 애니메이션은 사망 → 사망 효과 → 체인 효과 순으로 호흡감 있게 노출.
// ══════════════════════════════════════════════════════════════════

function startPhase(room) {
  room._currentPhase = {
    pendingDeathDetonations: [],  // 1세대 사망 화약상 (액션의 직접 결과)
  };
}

function isPhaseActive(room) {
  return !!room._currentPhase;
}

// 사망 기폭 — handleDeath 가 화약상 분기에서 호출. 페이즈 큐에 push.
//   체인 wave 처리 중이면 다음 wave 큐로, 아니면 1세대 큐로.
//   페이즈 비활성 시 false 반환 (호출자가 즉시 처리 fallback).
function queueDeathDetonation(room, ownerIdx, casterPieceIdx) {
  if (room._tempChainQueue) {
    room._tempChainQueue.push({ ownerIdx, casterPieceIdx });
    return true;
  }
  if (room._currentPhase) {
    room._currentPhase.pendingDeathDetonations.push({ ownerIdx, casterPieceIdx });
    return true;
  }
  return false;
}

// 페이즈 종료 — 사망 기폭 wave 들 사전 계산 (state 즉시 변경) + emit 만 시간차 스케줄링
function flushPhase(room, onComplete) {
  if (!room._currentPhase) {
    if (onComplete) onComplete();
    return;
  }
  const phase = room._currentPhase;
  room._currentPhase = null;

  const RECOGNITION_DELAY = 600;   // 사망 인지 텀
  const CAST_DURATION = 780;        // "사망 기폭" 말풍선 + spotlight
  const BOMB_DURATION = 1930;       // detonation_intro + bomb_detonated
  const POST_SETTLE = 500;          // wave 간 마진

  // === 1) 모든 wave 사전 계산 ===
  const waves = [];
  let waveQueue = phase.pendingDeathDetonations.slice();
  let safetyCounter = 0;

  while (waveQueue.length > 0 && safetyCounter < 8) {
    safetyCounter++;
    const wave = waveQueue;
    const newPending = [];

    // 이번 wave 의 detonateBomb 안에서 발생하는 사망(=체인) 은 newPending 으로
    room._tempChainQueue = newPending;

    const deferredEmits = [];
    for (const dd of wave) {
      const bombs = (room.boardObjects[dd.ownerIdx] || []).filter(o => o.type === 'bomb');
      for (const bomb of bombs) {
        const hits = detonateBomb(room, dd.ownerIdx, bomb, { deferEmit: true });
        deferredEmits.push({ col: bomb.col, row: bomb.row, hits });
      }
      room.boardObjects[dd.ownerIdx] = (room.boardObjects[dd.ownerIdx] || []).filter(o => o.type !== 'bomb');
    }

    room._tempChainQueue = null;

    waves.push({
      casters: wave.map(dd => ({ ownerIdx: dd.ownerIdx, pieceIdx: dd.casterPieceIdx })),
      deferredEmits,
    });

    waveQueue = newPending;  // 다음 wave (체인)
  }

  // === 2) emit 스케줄링 (각 wave 순차 노출) ===
  let cursor = 0;
  for (const wave of waves) {
    const allBombs = wave.deferredEmits.map(b => ({ col: b.col, row: b.row }));

    cursor += RECOGNITION_DELAY;
    const c1 = cursor;
    setTimeout(() => {
      if (rooms[room.id]) {
        emitToBoth(room, 'death_detonate_cast', { casters: wave.casters, bombs: allBombs });
      }
    }, c1);

    cursor += CAST_DURATION;
    const c2 = cursor;
    setTimeout(() => {
      if (rooms[room.id]) {
        emitToBoth(room, 'detonation_intro', { bombs: allBombs });
      }
    }, c2);

    cursor += BOMB_DURATION;
    const c3 = cursor;
    setTimeout(() => {
      if (!rooms[room.id]) return;
      for (const bd of wave.deferredEmits) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
    }, c3);

    cursor += POST_SETTLE;
  }

  // === 3) 페이즈 종료 시각 마킹 + AI 차단 + 게임종료 검사 지연 플래그 ===
  if (cursor > 0) {
    const phaseEnd = Date.now() + cursor + 200;
    room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, phaseEnd);
    if (!room._aiEndTurnEarliest || phaseEnd > room._aiEndTurnEarliest) {
      room._aiEndTurnEarliest = phaseEnd;
    }
    if (!room._aiNextActionEarliest || phaseEnd > room._aiNextActionEarliest) {
      room._aiNextActionEarliest = phaseEnd;
    }
    // ★ sync 게임종료 검사가 미리 fire 되지 않게 방지하는 플래그.
    //   호출자가 동기 흐름에서 endGame 호출 직전에 이 플래그 체크 → true 면 skip.
    //   onComplete callback 안에서 checkGameEndAfterPhase 가 처리.
    room._phaseDeferredGameEndCheck = true;
  }

  // === 4) 모든 wave 종료 후 callback ===
  setTimeout(() => {
    if (rooms[room.id]) {
      room._phaseDeferredGameEndCheck = false;
      if (onComplete) onComplete();
    }
  }, cursor + 100);
}

// 페이즈 종료 후 게임 종료 검사 — 양측 동시 전멸이면 simultaneous_draw, 아니면 일반 승패.
// 게임 종료 시 true 반환, 계속 진행해야 하면 false (호출자가 정상 흐름 진행).
function checkGameEndAfterPhase(room) {
  if (room.mode === 'team') {
    const team0Elim = isTeamEliminated(room, 0);
    const team1Elim = isTeamEliminated(room, 1);
    if (team0Elim && team1Elim) {
      setKillInfo(room, 'simultaneous_draw', null, []);
      endTeamGame(room, 0, 'simultaneous_draw');
      return true;
    }
    if (team0Elim) { endTeamGame(room, 1); return true; }
    if (team1Elim) { endTeamGame(room, 0); return true; }
  } else {
    const p0Dead = checkWin(room, 0);
    const p1Dead = checkWin(room, 1);
    if (p0Dead && p1Dead) {
      setKillInfo(room, 'simultaneous_draw', null, []);
      endGame(room, -1, 'simultaneous_draw');
      return true;
    }
    if (p0Dead) { endGame(room, 1); return true; }
    if (p1Dead) { endGame(room, 0); return true; }
  }
  return false;
}

function handleDeath(room, deadPiece, ownerIdx) {
  deadPiece.alive = false;
  const owner = room.players[ownerIdx];

  // 팀전: 플레이어 전멸 감지 → team_player_eliminated 이벤트 (1회성)
  if (room.mode === 'team' && owner) {
    if (!room.eliminatedPlayers) room.eliminatedPlayers = new Set();
    if (!room.eliminatedPlayers.has(ownerIdx)) {
      const allDead = owner.pieces && owner.pieces.every(p => !p.alive);
      if (allDead) {
        room.eliminatedPlayers.add(ownerIdx);
        const payload = {
          playerIdx: ownerIdx,
          playerName: owner.name,
          teamId: owner.teamId,
          slotPos: owner.slotPos ?? 0,
        };
        emitToBoth(room, 'team_player_eliminated', payload);
      }
    }
  }

  // (저주 전파 기능 제거 — 게임 룰에 없음)

  // 화약상 사망 → 사망 기폭. 페이즈가 active 면 큐로 넘김 (시퀀스), 아니면 즉시 처리(레거시).
  if (deadPiece.type === 'gunpowder') {
    const bombs = (room.boardObjects[ownerIdx] || []).filter(o => o.type === 'bomb');
    if (bombs.length > 0) {
      const casterPieceIdx = (owner && owner.pieces) ? owner.pieces.indexOf(deadPiece) : -1;
      const queued = queueDeathDetonation(room, ownerIdx, casterPieceIdx);
      if (!queued) {
        // 페이즈 비활성 — 즉시 폭발 (보드 축소 등 레거시 경로)
        for (const bomb of bombs) {
          detonateBomb(room, ownerIdx, bomb);
        }
        room.boardObjects[ownerIdx] = (room.boardObjects[ownerIdx] || []).filter(o => o.type !== 'bomb');
      }
      // 큐로 들어간 경우 — flushPhase 에서 폭탄 처리 + 보드 정리
    }
  }

  // Dragon tamer dies: dragon stays alive (independent unit)

  // Witch death: remove all curses sourced from this player + 즉시 알림
  if (deadPiece.type === 'witch') {
    for (let pi = 0; pi < room.players.length; pi++) {
      const pl = room.players[pi];
      for (const p of pl.pieces) {
        if (p.alive) {
          const had = p.statusEffects.some(e => e.type === 'curse' && e.source === ownerIdx);
          if (had) {
            p.statusEffects = p.statusEffects.filter(e => !(e.type === 'curse' && e.source === ownerIdx));
            emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: pi, targetName: p.name, msg: `☠ 저주: 마녀가 사망해 ${p.name}의 저주 해제` });
            emitToSpectators(room, 'spectator_log', { msg: `☠ 저주: 마녀가 사망해 ${p.name}의 저주 해제`, type: 'passive', playerIdx: pi });
          }
        }
      }
    }
  }
}

function detonateBomb(room, ownerIdx, bomb, options) {
  const opts = options || {};
  const deferEmit = !!opts.deferEmit;
  // 기폭 스킬에서 호출 시(=deferEmit) sp_update 가 skill_result 보다 먼저 도착해
  // 시전자의 마법구 비행 애니가 무동작이 되므로, 이 경우엔 sp_update emit 을 생략하고
  // 후속 skill_result 가 sp/instantSp 를 일괄 전달.
  const suppressSpUpdate = deferEmit;
  const opponent = room.players[1 - ownerIdx];
  const defOwnerIdx = 1 - ownerIdx;
  const hits = [];
  for (let epi = 0; epi < opponent.pieces.length; epi++) {
    const ep = opponent.pieces[epi];
    if (ep.alive && ep.col === bomb.col && ep.row === bomb.row) {
      const dmg = resolveDamage(room, { type: 'gunpowder', tag: null, tier: 1, col: bomb.col, row: bomb.row }, ep, ownerIdx, 1, false);
      ep.hp = Math.max(0, ep.hp - dmg);
      if (ep.hp <= 0) {
        handleDeath(room, ep, 1 - ownerIdx);
      }
      // Wizard passive: SP on bomb hit — 마법사 소속 플레이어/팀에 SP 추가
      if (ep.type === 'wizard') {
        // ep는 적의 wizard. ep의 소유자 idx를 찾아야 함
        let wizOwnerIdx = -1;
        for (let pi = 0; pi < room.players.length; pi++) {
          if (room.players[pi].pieces.includes(ep)) { wizOwnerIdx = pi; break; }
        }
        if (wizOwnerIdx < 0) wizOwnerIdx = 1 - ownerIdx;  // fallback
        const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, wizOwnerIdx) : wizOwnerIdx;
        room.instantSp[wizSpSlot] += 1;
        if (!suppressSpUpdate) emitSPUpdate(room);
        const wizOwnerName = room.players[wizOwnerIdx].name;
        emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: wizOwnerIdx, msg: `🧙 인스턴트 매직 : SP 획득` });

        emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: wizOwnerIdx });

      }
      hits.push({ col: ep.col, row: ep.row, damage: dmg, newHp: ep.hp, destroyed: !ep.alive, type: ep.type, name: ep.name, icon: ep.icon, defPieceIdx: epi, defOwnerIdx });
    }
  }
  // 기폭 스킬에서 호출 시(deferEmit) bomb_detonated 는 skill_result 다음에 외부에서 emit
  if (!deferEmit) {
    emitToBoth(room, 'bomb_detonated', { col: bomb.col, row: bomb.row, hits });
  }
  const bombKilled = hits.filter(h => h.destroyed);
  if (bombKilled.length > 0) {
    setKillInfo(room, 'bomb', null, bombKilled.map(k => ({ name: k.name })));
  }
  return hits;
}

function processAttack(room, attackerIdx, atkPiece, atkCells, extraDamage, opts) {
  const attacker = room.players[attackerIdx];
  const baseDmg = (extraDamage !== undefined) ? extraDamage : atkPiece.atk;
  // 스킬(유황범람 등)에서 호출 시 sp_update 가 후속 skill_result 보다 먼저 가지 않도록 suppress.
  const suppressSpUpdate = !!(opts && opts.suppressSpUpdate);
  room._suppressSpUpdate = suppressSpUpdate;
  const hitResults = [];
  // #1: 호위무사 hit 사이드채널 초기화
  room._pendingBodyguardHits = [];
  // 사용자 요청: 표식이 한 번에 여러 대상에 새겨지면 단일 로그/토스트로 통합.
  //   per-target emit 대신 이름들을 수집한 뒤 attack 종료 시 한 번만 발송.
  const _markedTargetNames = [];

  // 팀전: 적 = 적팀 멤버만 / 1v1: 적 = 상대
  // (이전 버그: !isTeammate(self,self)는 true이므로 공격자 본인이 enemy에 포함되어 friendly-fire 발생)
  const enemyIndices = getEnemyIndices(room, attackerIdx);

  for (const defIdx of enemyIndices) {
    const defender = room.players[defIdx];
    if (!defender) continue;
    for (const cell of atkCells) {
      for (let dpi = 0; dpi < defender.pieces.length; dpi++) {
        const defPiece = defender.pieces[dpi];
        if (defPiece.alive && defPiece.col === cell.col && defPiece.row === cell.row) {
          // 호위무사 가로채기 감지: resolveDamage 직전후 _pendingBodyguardHits 길이 비교
          const bgBefore = (room._pendingBodyguardHits || []).length;
          const dmg = resolveDamage(room, atkPiece, defPiece, attackerIdx, baseDmg, false, defIdx);
          const redirectedToBodyguard = ((room._pendingBodyguardHits || []).length > bgBefore);
          defPiece.hp = Math.max(0, defPiece.hp - dmg);
          // #11: 피격 후 HP=1 이하로 내려가면 저주 즉시 해제
          if (defPiece.alive && dmg > 0) {
            checkCurseRemoval(room, defPiece, defIdx);
          }
          const destroyed = defPiece.hp <= 0;
          if (destroyed) {
            handleDeath(room, defPiece, defIdx);
          }
          hitResults.push({
            col: cell.col, row: cell.row,
            damage: dmg, newHp: defPiece.hp, destroyed,
            revealedType: destroyed ? defPiece.type : undefined,
            revealedName: destroyed ? defPiece.name : undefined,
            revealedIcon: destroyed ? defPiece.icon : undefined,
            hitName: defPiece.name,
            hitIcon: defPiece.icon,
            defPieceIdx: dpi,          // 피격 대상의 배열 인덱스 (프로필 애니메이션용)
            defOwnerIdx: defIdx,       // 팀모드: 어느 적 플레이어의 말인지
            // 호위무사가 대신 받음 — 클라에서 토스트·애니메이션 스킵
            redirectedToBodyguard,
            attackerSub: atkPiece.subUnit || null,
            attackerName: atkPiece.name,
            attackerIcon: atkPiece.icon,
          });

          // Post-damage: torturer passive mark — 다중 대상 시 단일 통합 알림으로 처리 (사용자 요청).
          //   여기서는 이름만 수집하고 emit 은 processAttack 종료 시 한 번만.
          if (atkPiece.type === 'torturer' && !destroyed) {
            let markTarget = defPiece;
            // 호위무사 패시브: 왕실 아군 상태이상도 대신 받음
            if (defPiece.tag === 'royal' && defPiece.type !== 'bodyguard') {
              const bg = defender.pieces.find(p => p.type === 'bodyguard' && p.alive);
              if (bg) markTarget = bg;
            }
            // 그림자 상태 면역
            if (!markTarget.statusEffects.some(e => e.type === 'shadow') &&
                !markTarget.statusEffects.some(e => e.type === 'mark')) {
              markTarget.statusEffects.push({ type: 'mark', source: attackerIdx });
              _markedTargetNames.push(markTarget.name);
            }
          }

          // (마녀 저주는 이제 직접 대상 지정 스킬로 변경됨)

          // Post-damage: wizard passive (defender is wizard, gain 1 instant SP per hit, even on death)
          if (defPiece.type === 'wizard') {
            const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, defIdx) : defIdx;
            room.instantSp[wizSpSlot] += 1;
            // 스킬 컨텍스트에서는 sp_update suppress (skill_result 가 일괄 sp/instantSp 전달)
            if (!room._suppressSpUpdate) emitSPUpdate(room);
            const defName = room.players[defIdx].name;
            emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: defIdx, msg: `🧙 인스턴트 매직 : SP 획득` });

            emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: defIdx });
          }
        }
      }
    }
  }

  // SlaughterHero passive: 공격 범위 내 "아군"(팀모드: 자기+팀원) 1 피해
  if (atkPiece.type === 'slaughterHero') {
    const attackerName = room.players[attackerIdx].name;
    const allyIndices = (room.mode === 'team') ? getAllyIndices(room, attackerIdx) : [attackerIdx];
    for (const cell of atkCells) {
      for (const aIdx of allyIndices) {
        const allyPlayer = room.players[aIdx];
        for (const allyPiece of allyPlayer.pieces) {
          if (allyPiece.alive && allyPiece !== atkPiece && allyPiece.col === cell.col && allyPiece.row === cell.row) {
            allyPiece.hp = Math.max(0, allyPiece.hp - 1);
            const whose = aIdx === attackerIdx ? '' : `${allyPlayer.name}의 `;
            // 배반자 토스트·로그 출력 제거 — 데미지 도장으로 충분히 표현됨 (사용자 요청)
            // Wizard passive: 배반자로 마법사가 피격되면 인스턴트 SP 1 획득
            if (allyPiece.type === 'wizard') {
              const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, aIdx) : aIdx;
              room.instantSp[wizSpSlot] += 1;
              if (!room._suppressSpUpdate) emitSPUpdate(room);
              emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: aIdx, msg: `🧙 인스턴트 매직 : SP 획득` });
              emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: aIdx });
            }
            if (allyPiece.hp <= 0) {
              handleDeath(room, allyPiece, aIdx);
            }
          }
        }
      }
    }
    // 배반자 — 아군 쥐도 격파 (피격 유효)
    for (const cell of atkCells) {
      for (const aIdx of allyIndices) {
        const before = (room.rats[aIdx] || []).length;
        room.rats[aIdx] = (room.rats[aIdx] || []).filter(
          r => !(r.col === cell.col && r.row === cell.row)
        );
        if (room.rats[aIdx].length < before) {
          // 배반자로 아군 쥐 격파 — 토스트·로그 출력 제거 (사용자 요청)
        }
      }
    }
  }

  // Destroy rats hit by attacks — 팀전 시 모든 적 플레이어의 쥐
  const destroyedRatCells = [];
  for (const defIdx of enemyIndices) {
    for (const cell of atkCells) {
      const before = (room.rats[defIdx] || []).length;
      room.rats[defIdx] = (room.rats[defIdx] || []).filter(
        r => !(r.col === cell.col && r.row === cell.row)
      );
      if (room.rats[defIdx].length < before) {
        destroyedRatCells.push({ col: cell.col, row: cell.row });
      }
    }
  }
  if (destroyedRatCells.length > 0) {
    const attackerName = room.players[attackerIdx].name;
    const coordStr = destroyedRatCells.map(c => coord(c.col, c.row)).join(', ');
    emitToSpectators(room, 'spectator_log', {
      msg: `🐀 ${attackerName}${조사(attackerName, '이', '가')} ${coordStr}의 쥐 격파함`,
      type: 'hit',
      playerIdx: attackerIdx,
    });
  }

  // Track kill info for game-over messages
  const killed = hitResults.filter(h => h.destroyed);
  if (killed.length > 0) {
    setKillInfo(room, 'attack', atkPiece.name, killed.map(k => ({ name: k.revealedName })));
  }

  // #1: 호위무사 hit을 hitResults에 추가 (클라이언트 피격 애니메이션용)
  if (room._pendingBodyguardHits && room._pendingBodyguardHits.length > 0) {
    hitResults.push(...room._pendingBodyguardHits);
    room._pendingBodyguardHits = [];
  }
  // sp_update suppress 플래그 정리
  room._suppressSpUpdate = false;

  // 표식 통합 알림 — 이번 공격으로 새겨진 표식 대상 모두 한 번에 출력 (사용자 요청)
  if (_markedTargetNames.length > 0) {
    const namesStr = _markedTargetNames.join(', ');
    emitToBoth(room, 'passive_alert', { type: 'torturer', playerIdx: attackerIdx, msg: `⛓ 표식: ${namesStr}에게 표식 새김` });
    emitToSpectators(room, 'spectator_log', { msg: `⛓ 표식: ${namesStr}에게 표식 새김`, type: 'passive', playerIdx: attackerIdx });
  }

  return hitResults;
}

function checkWin(room, defenderIdx) {
  const defender = room.players[defenderIdx];
  // 드래곤 포함 모든 유닛이 죽어야 패배 (드래곤 살아있으면 패배 불가)
  return defender.pieces.every(p => !p.alive);
}

// ══════════════════════════════════════════════════════════════════
// ── SP System Helpers ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function spendSP(room, playerIdx, amount) {
  // 팀모드: SP 풀은 [블루팀, 레드팀] = teamId로 인덱싱 / 1v1: [p0, p1] = playerIdx
  const slot = (room.mode === 'team')
    ? (getTeamOf(room, playerIdx))
    : playerIdx;
  const oppSlot = 1 - slot;
  const totalSp = room.sp[slot] + room.instantSp[slot];
  if (totalSp < amount) return false;
  // Consume instant SP first (disappears permanently, no transfer to opponent)
  let remaining = amount;
  const instantUsed = Math.min(room.instantSp[slot], remaining);
  room.instantSp[slot] -= instantUsed;
  remaining -= instantUsed;
  // Then consume regular SP (transfers to opponent)
  if (remaining > 0) {
    room.sp[slot] -= remaining;
    room.sp[oppSlot] = Math.min(room.sp[oppSlot] + remaining, 10);
  }
  // ❌ emitSPUpdate(room) 제거 — sp_update 가 skill_result/status_update/team_game_update 보다 먼저 도착하면
  //    클라이언트에서 S.sp 가 미리 갱신되어 oldSpSnap=newSp 가 되고, spendSPAttention 의 마법구·인스턴트
  //    pip 비행 애니가 delta=0 으로 한 개도 발생 안 함. 후속 결과 이벤트들이 sp/instantSp 를 직접 포함하므로
  //    여기서 별도 sp_update 를 보낼 필요가 없음.
  return true;
}

function emitSPUpdate(room) {
  emitToBoth(room, 'sp_update', {
    sp: room.sp,
    instantSp: room.instantSp,
    skillPoints: room.sp,
  });
}

// ══════════════════════════════════════════════════════════════════
// ── Turn Management ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// 관전자용 스킬 메시지 빌드 — result.msg 기반으로 플레이어 이름 추가
function buildSpectatorSkillMsg(playerName, piece, result) {
  const msg = result.msg || '';
  // 기존 이모지+스킬명 패턴에서 플레이어 이름 삽입
  // "🏹 정비: ..." → "🏹 {이름}의 궁수가 정비를 사용! ..."
  const patterns = [
    { prefix: '🏹 정비:', rewrite: (m) => `🏹 정비: 공격 방향 전환` },
    { prefix: '👫 분신:', rewrite: (m) => m },
    { prefix: '🪤 덫 설치:', rewrite: (m) => `🪤 덫 설치: ${playerName}의 덫 설치` },
    { prefix: '📯 질주:', rewrite: (m) => `📯 질주: 전령은 추가 이동 가능` },
    { prefix: '💥기폭:', rewrite: (m) => `💥기폭: 폭탄 폭발!` },
    { prefix: '💣 폭탄 설치:', rewrite: (m) => `💣 폭탄 설치: ${playerName}의 폭탄 설치` },
    { prefix: '🌿 약초학:', rewrite: (m) => `🌿 약초학: 범위 내 아군 1 HP 회복` },
    { prefix: '👻 그림자 숨기:', rewrite: (m) => `👻 그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역` },
    { prefix: '☠ 저주:', rewrite: (m) => {
        const tMatch = m.match(/^☠ 저주: (.+?)[을를] 저주/);
        const tName = tMatch ? tMatch[1] : '대상';
        return `☠ 저주: ${tName}${조사(tName, '을', '를')} 저주`;
      } },
    { prefix: '⚔ 쌍검무:', rewrite: (m) => `⚔ 쌍검무: 양손검객은 추가 공격 가능` },
    { prefix: '⚒ 정비:', rewrite: (m) => `⚒ 정비: 공격 방향 전환` },
    { prefix: '♛ 절대복종 반지:', rewrite: (m) => {
        const kMatch = m.match(/^♛ 절대복종 반지: (.+?)[을를] 강제 이동/);
        const target = kMatch ? kMatch[1] : '대상';
        return `♛ 반지: ${playerName}의 국왕이 ${target}${조사(target, '을', '를')} 강제 이동`;
      } },
    { prefix: '🙏 신성:', rewrite: (m) => {
        const mMatch = m.match(/^🙏 신성: (.+?)의 상태이상/);
        const tName = mMatch ? mMatch[1] : '대상';
        return `🙏 신성: ${tName}의 상태이상 제거, 2 HP 회복`;
      } },
    { prefix: '🔥 유황범람:', rewrite: (m) => `🔥 유황범람: 보드 외곽 전체 2 피해` },
    { prefix: '⛓ 악몽:', rewrite: (m) => `⛓ 악몽: 모든 표식 상태 유닛 1 피해` },
  ];
  for (const p of patterns) {
    if (msg.startsWith(p.prefix)) return p.rewrite(msg);
  }
  // 매칭 안 되면 기본 포맷
  return `✦ ${playerName}의 ${piece.icon}${piece.name} → ${piece.skillName || msg}`;
}

function emitToBoth(room, event, data) {
  for (const p of room.players) {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit(event, data);
    }
  }
  // 관전자에게도 동일 이벤트 전달
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

function emitToPlayer(room, idx, event, data) {
  const p = room.players[idx];
  if (p && p.socketId !== 'AI') {
    io.to(p.socketId).emit(event, data);
  }
}

function emitToSpectators(room, event, data) {
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

function getSpectatorGameState(room) {
  const p0 = room.players[0], p1 = room.players[1];
  return {
    turnNumber: room.turnNumber,
    currentPlayerIdx: room.currentPlayerIdx,
    sp: room.sp,
    instantSp: room.instantSp,
    boardBounds: room.boardBounds,
    p0Pieces: p0 ? pieceSummary(p0.pieces) : [],
    p1Pieces: p1 ? pieceSummary(p1.pieces) : [],
    p0Name: p0 ? p0.name : '?',
    p1Name: p1 ? p1.name : '?',
    boardObjects: [
      ...boardObjectsSummary(room, 0),
      ...boardObjectsSummary(room, 1),
    ],
  };
}

function processTurnStart(room) {
  const idx = room.currentPlayerIdx;
  const player = room.players[idx];

  // Reset turn flags
  player.actionDone = false;
  player.actionUsedSkillReplace = false;
  player.skillsUsedBeforeAction = [];
  player.twinMovedSubs = [];
  player._lastActionType = null;  // 'move' | 'attack' | null

  // Reset per-turn skill states for current player
  for (const p of player.pieces) {
    p.dualBladeAttacksLeft = 0;
    p.messengerSprintActive = false;
    p.messengerMovesLeft = 0;
  }

  // Remove shadow effects from THIS player's pieces (shadow lasts until own next turn)
  for (const p of player.pieces) {
    p.statusEffects = p.statusEffects.filter(e => e.type !== 'shadow');
  }

  // ★ Pre-curse HP 스냅샷 — 클라이언트의 저주 보라 도장 표시용.
  //    snapshotTurnStartHps(preCurseHps) 가 startHp 로 사용해 curse 적용 전 HP 를 복원.
  //    your_turn / opp_turn / team_game_update 페이로드에 첨부.
  const preCurseHpsSnap = {};
  for (let i = 0; i < room.players.length; i++) {
    preCurseHpsSnap[i] = (room.players[i].pieces || []).map(p => (p && p.alive === false) ? 0 : (p && p.hp != null ? p.hp : 0));
  }
  room._preCurseHpsSnap = preCurseHpsSnap;

  // ── 애니메이션 페이즈 시작 (#24) ──
  //   여러 turn-event 가 한 턴에 발생할 때, 0.5s 텀으로 순차 재생.
  //   전체 페이즈 동안 게임 일시정지 (AI/curse_tick 모두). 페이즈 종료 + 1.5s 버퍼 후 정상화.
  //   순서: 보드 파괴 경고 → 보드 파괴 → 1대1 대치 → ... → SP 지급 (항상 마지막)
  //   각 애니메이션의 server-side 추정 duration:
  const ANIM_GAP = 500;
  const DUR_SHRINK_WARN = 3000;
  const DUR_SHRINK_INTRO = 3000;
  const DUR_BOARD_SHRINK = 3000;
  const DUR_STALEMATE = 3000;
  const DUR_SP_GRANT = 5400;
  let animTotalMs = 0;
  const queueAnim = (durMs) => {
    if (animTotalMs > 0) animTotalMs += ANIM_GAP;
    animTotalMs += durMs;
  };

  // 1. 1대1 대치 감지 (즉시 trigger, 별도 애니메이션 없음 — 기존 5턴 후 축소만 예약)
  detectStalemateShrink(room);

  // ── 보드 축소 스케줄 (애니메이션 페이즈) ──
  const schedule = getBoardShrinkSchedule(room);
  for (const ev of schedule) {
    if (room.turnNumber >= ev.warnTurn && room.turnNumber < ev.shrinkTurn && room.boardShrinkStage < ev.stage) {
      const remaining = ev.shrinkTurn - room.turnNumber;
      if (remaining > 0) {
        emitToBoth(room, 'board_shrink_warning', { turnsRemaining: remaining, turnsLeft: remaining, stage: ev.stage });
        emitToSpectators(room, 'spectator_log', { msg: `외곽 파괴까지 ${remaining}턴`, type: 'event' });
        queueAnim(DUR_SHRINK_WARN);
      }
    }
    if (room.turnNumber >= ev.shrinkTurn && room.boardShrinkStage < ev.stage) {
      room.boardShrinkStage = ev.stage;
      decreaseBoardShrinkLevel(room);
      if (room.boardShrinkLevel === 1) room.boardShrunk = true;
      const eliminated = [];
      // ★ 보드 축소로 죽는 piece 들 — handleDeath 경로로 통일.
      //   사용자 요청: 화약상이 축소로 죽으면 사망 기폭이 시전돼야 함.
      //   페이즈 시작 → 축소 처리 → 사망 처리 (handleDeath 가 사망 기폭 큐로 push) → flushPhase
      startPhase(room);
      const deadPieces = [];
      for (let pi = 0; pi < room.players.length; pi++) {
        const pl = room.players[pi];
        for (const p of pl.pieces) {
          if (p.alive && !inBounds(p.col, p.row, room.boardBounds)) {
            // p.alive 는 handleDeath 가 처리 — 여기서는 hp 만 0 으로 (handleDeath 안에서 sequencing)
            p.hp = 0;
            eliminated.push({ type: p.type, name: p.name, icon: p.icon, col: p.col, row: p.row, owner: pi });
            deadPieces.push({ piece: p, ownerIdx: pi });
          }
        }
      }
      // boardObjects 정리는 handleDeath 후 (화약상 사망 기폭 큐가 폭탄 위치 참조해야 하므로 그 전)
      // 하지만 축소 영역 밖의 폭탄은 사라져야 함 — handleDeath 가 필요한 폭탄을 큐로 옮겨놓음.
      // detonateBomb 가 deferEmit 으로 호출되며 큐의 폭탄 좌표 그대로 사용 가능 — 단, 축소 영역 안에 들어있는 폭탄만.
      for (const dp of deadPieces) {
        handleDeath(room, dp.piece, dp.ownerIdx);
      }
      for (let i = 0; i < room.players.length; i++) {
        if (room.boardObjects[i]) room.boardObjects[i] = room.boardObjects[i].filter(o => inBounds(o.col, o.row, room.boardBounds));
        if (room.rats[i]) room.rats[i] = room.rats[i].filter(r => inBounds(r.col, r.row, room.boardBounds));
      }
      emitToBoth(room, 'board_shrink', { newBounds: room.boardBounds, bounds: room.boardBounds, eliminated, stage: ev.stage });
      emitToSpectators(room, 'spectator_log', { msg: '🔥 보드 외곽 파괴', type: 'event' });
      queueAnim(DUR_BOARD_SHRINK);
      // 축소 애니 후 사망 기폭 시퀀스 — flushPhase 가 적절한 cursor 로 emit 들 스케줄.
      //   onComplete 에서 무승부/승패 검사
      flushPhase(room, () => {
        if (rooms[room.id] && room.phase === 'game') {
          checkGameEndAfterPhase(room);
        }
      });
      // 축소로 인한 승부 체크는 페이즈 종료 후 처리되도록 큐잉
      // (즉시 endGame 하면 애니메이션 도중 게임 종료 → 후속 SP 지급 등 끊김)
      // 현재 위치에서는 일단 그대로 두고, 후속 코드의 win check 가 해결하게 함.
    }
  }

  // ── SP 지급 (애니메이션 페이즈의 *마지막* — 사용자 요청 #24) ──
  let spGrantedThisTurn = false;
  if (room.turnNumber > 0 && room.turnNumber % 10 === 0 && room.turnNumber <= 40) {
    const poolTotal = room.sp[0] + room.sp[1];
    if (poolTotal < 10) {
      room.sp[0] = Math.min(room.sp[0] + 1, 10);
      room.sp[1] = Math.min(room.sp[1] + 1, 10);
      const newTotal = room.sp[0] + room.sp[1];
      if (newTotal > 10) {
        const excess = newTotal - 10;
        room.sp[1] = Math.max(0, room.sp[1] - excess);
      }
    }
    emitToBoth(room, 'turn_event', {
      type: 'sp_grant',
      msg: '새로운 SP가 지급되었습니다',
      sp: room.sp,
      instantSp: room.instantSp,
    });
    emitToSpectators(room, 'spectator_log', { msg: '새로운 SP가 지급되었습니다', type: 'event' });
    queueAnim(DUR_SP_GRANT);
    spGrantedThisTurn = true;
  }

  // 애니메이션 페이즈 종료 시각 기록 — AI/저주틱 등 모든 후속 처리는 이 시각 + 1.5s 까지 대기
  if (animTotalMs > 0) {
    room._animPhaseEndsAt = Date.now() + animTotalMs + 1500;
  } else {
    room._animPhaseEndsAt = 0;
  }
  // 레거시 호환
  room._spGrantBlockedUntil = room._animPhaseEndsAt || 0;

  // 저주 틱·축소 처리는 애니메이션 페이즈 이후로 미룸
  const continueTurnStart = () => {
    // Process curse damage at the start of this player's turn
    for (const p of player.pieces) {
      if (p.alive) {
        const curse = p.statusEffects.find(e => e.type === 'curse');
        if (curse) {
          const sourceIdx = curse.source;
          const sourceWitch = room.players[sourceIdx]?.pieces.find(pc => pc.type === 'witch' && pc.alive);
          if (!sourceWitch || p.hp <= 1) {
            p.statusEffects = p.statusEffects.filter(e => e.type !== 'curse');
            const reason = !sourceWitch ? '마녀가 사망해' : '체력 고갈로';
            emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: idx, targetName: p.name, msg: `☠ 저주: ${reason} ${p.name}의 저주 해제` });
            emitToSpectators(room, 'spectator_log', { msg: `☠ 저주: ${reason} ${p.name}의 저주 해제`, type: 'passive', playerIdx: idx });
          } else {
            p.hp = Math.max(0, p.hp - 0.5);
            emitToBoth(room, 'curse_tick', { playerIdx: idx, targetName: p.name, damage: 0.5, newHp: p.hp });
            if (p.hp <= 0) {
              handleDeath(room, p, idx);
            } else {
              checkCurseRemoval(room, p, idx);
            }
          }
        }
      }
    }
  };
  // continueTurnStart — 저주 틱 + 후속 처리. 애니메이션 페이즈가 있으면 그 종료 + 1.5s 후 실행.
  const _phaseDelay = animTotalMs > 0 ? (animTotalMs + 1500) : 0;
  if (_phaseDelay > 0) {
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      continueTurnStart();
    }, _phaseDelay);
  } else {
    continueTurnStart();
  }
  room._spGrantedThisTurn = spGrantedThisTurn;  // endTurn 측 AI 트리거 지연용 (레거시)

  // ── 보드 축소 후 승부 체크 ──
  //   축소로 인해 누군가 탈락했으면 승부 결과 emit. 애니메이션 페이즈는 클라에서 이미 진행 중이라
  //   server-side 승부 처리만 즉시 (game_over 이벤트는 client 가 받지만 내부적으로 전환되도 OK).
  //   ★ 사망 기폭 페이즈가 deferred 되어 있으면 sync 검사 skip — flushPhase callback 이 처리.
  if (room.boardShrinkStage > 0 && (animTotalMs > 0) && !room._phaseDeferredGameEndCheck) {
    if (room.mode === 'team') {
      const aElim = isTeamEliminated(room, 0);
      const bElim = isTeamEliminated(room, 1);
      if (aElim && bElim) { setKillInfo(room, 'shrink', null, []); endGame(room, -1, 'draw'); return; }
      if (aElim) { setKillInfo(room, 'shrink', null, []); endGame(room, room.teams[1][0], 'shrink'); return; }
      if (bElim) { setKillInfo(room, 'shrink', null, []); endGame(room, room.teams[0][0], 'shrink'); return; }
    } else {
      const p0Dead = checkWin(room, 0);
      const p1Dead = checkWin(room, 1);
      if (p0Dead && p1Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, -1, 'draw'); return; }
      if (p0Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 1, 'shrink'); return; }
      if (p1Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 0, 'shrink'); return; }
    }
    // LV1 + unreachable 무승부
    if (room.boardShrinkLevel === 1 && checkUnreachableDraw(room)) {
      setKillInfo(room, 'unreachable', null, []);
      if (room.mode === 'team') endTeamGame(room, 0, 'unreachable_draw');
      else endGame(room, -1, 'unreachable_draw');
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 자동 무승부 판정 — 두 조건 모두 만족 시에만 무승부
//   ① 보드 외곽 파괴가 2회 모두 완료 (보드가 1x1 — 이동 불가)
//   ② 이 상태에서 살아있는 모든 유닛 중 누구의 공격범위에도 '자기 자신의 위치'가 포함되지 않음
//      (1x1 에서 모두 같은 칸에 스택되므로, 자기-공격 가능한 유닛이 하나라도 있으면 누군가 칠 수 있음 → 무승부 아님)
// ═══════════════════════════════════════════════════════════════
function checkUnreachableDraw(room) {
  const bounds = room.boardBounds;
  // 조건 ①: 보드가 1x1 (= max-min+1 == 1)
  const cells = (bounds.max - bounds.min + 1);
  if (cells > 1) return false;
  // 살아있는 모든 유닛 중 누구라도 자기 위치를 공격할 수 있으면 무승부 아님
  for (const player of (room.players || [])) {
    for (const piece of (player.pieces || [])) {
      if (!piece.alive) continue;
      if (!inBounds(piece.col, piece.row, bounds)) continue;
      const atk = getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState });
      if (atk.some(c => c.col === piece.col && c.row === piece.row)) {
        return false;  // 자기 위치 공격 가능 → 누군가 스택된 적을 칠 수 있음 → 무승부 아님
      }
    }
  }
  // 조건 ②: 모두 자기-공격 불가 → 무승부
  return true;
}

// 보드 축소 스케줄 (모드별)
// 사용자 요청 (#24): 1v1은 70턴에 마지막 외곽 파괴, 10턴 전부터 카운트다운 경고
//                   팀전은 80턴에 마지막 외곽 파괴 (60턴 첫 축소 후 더 좁혀짐)
// 레벨 → 보드 칸 수 (LV4=7, LV3=5, LV2=3, LV1=1)
function _shrinkLevelToSize(level) {
  return ({ 4: 7, 3: 5, 2: 3, 1: 1 })[level] || 1;
}
// 레벨 → bounds (모드별 base 사이즈에 중앙 정렬)
function _levelToBounds(level, baseSize) {
  const targetSize = _shrinkLevelToSize(level);
  const offset = Math.floor((baseSize - targetSize) / 2);
  return { min: offset, max: baseSize - 1 - offset };
}
// 한 단계 축소 — LV1 이면 노옵
function decreaseBoardShrinkLevel(room) {
  if (room.boardShrinkLevel <= 1) return false;
  room.boardShrinkLevel--;
  const baseSize = room.mode === 'team' ? 7 : 5;
  room.boardBounds = _levelToBounds(room.boardShrinkLevel, baseSize);
  return true;
}

// schedule — 트리거 시점 (warn/shrink) 의 array. 매 트리거마다 -1 LV.
//   1대1교전(stalemate) 은 기존 schedule 과 *cumulative* — replace 하지 않고 추가 트리거.
function getBoardShrinkSchedule(room) {
  const events = [];
  if (room.mode === 'team') {
    events.push({ warnTurn: 20, shrinkTurn: 30, key: 'team-30' });
    events.push({ warnTurn: 50, shrinkTurn: 60, key: 'team-60' });
    events.push({ warnTurn: 70, shrinkTurn: 80, key: 'team-80' });
  } else {
    events.push({ warnTurn: 40, shrinkTurn: 50, key: '1v1-50' });
    events.push({ warnTurn: 60, shrinkTurn: 70, key: '1v1-70' });
  }
  if (room.stalemateShrinkTurn != null) {
    events.push({
      warnTurn: Math.max(0, room.stalemateShrinkTurn - 5),
      shrinkTurn: room.stalemateShrinkTurn,
      key: `stalemate-${room.stalemateShrinkTurn}`,
      stalemate: true,
    });
  }
  events.sort((a, b) => a.shrinkTurn - b.shrinkTurn);
  // boardShrinkStage 호환을 위해 stage 필드 부여 (1부터 누적)
  let stage = 1;
  for (const ev of events) {
    ev.stage = stage++;
    ev.final = (stage > events.length);
  }
  return events;
}

// 1대1 대치 감지 — 양 플레이어 각 1유닛 alive 시 5턴 후 보드 축소 예약.
// 레벨 시스템 (#25): 이미 LV1 이면 의미 없으므로 스킵.
// 한 번 트리거 되면 cumulative — 기존 turn 50/70 schedule 과 함께 작동.
function detectStalemateShrink(room) {
  if (!room || room.mode === 'team') return;
  if (room.stalemateShrinkTriggered) return;   // 이미 트리거됨
  if (room.boardShrinkLevel <= 1) return;      // 더 이상 축소 불가 (LV1)
  const a = room.players[0]?.pieces.filter(p => p.alive).length || 0;
  const b = room.players[1]?.pieces.filter(p => p.alive).length || 0;
  if (a !== 1 || b !== 1) return;
  room.stalemateShrinkTriggered = true;
  room.stalemateShrinkTurn = room.turnNumber + 5;
  emitToBoth(room, 'turn_event', {
    type: 'stalemate_shrink',
    msg: '1대1 대치 상황: 5턴 후 보드가 축소됩니다.',
  });
  emitToSpectators(room, 'spectator_log', {
    msg: '1대1 대치 상황: 5턴 후 보드가 축소됩니다.',
    type: 'event',
  });
}

function endTurn(room) {
  // AI 턴 종료 핸들 정리 — 이중 endTurn 호출이나 stale setTimeout 방지
  const prevPlayerIdx = room.currentPlayerIdx;
  if (room._aiTurnEndHandle && room._aiTurnEndHandle[prevPlayerIdx]) {
    clearTimeout(room._aiTurnEndHandle[prevPlayerIdx]);
    room._aiTurnEndHandle[prevPlayerIdx] = null;
  }
  if (room._aiTurnEndWatchdog && room._aiTurnEndWatchdog[prevPlayerIdx]) {
    clearTimeout(room._aiTurnEndWatchdog[prevPlayerIdx]);
    room._aiTurnEndWatchdog[prevPlayerIdx] = null;
  }
  // 이전 플레이어가 행동·스킬 없이 턴을 종료했으면 안내 메시지 (모든 플레이어/관전자에게 동등하게 emit)
  const prevPlayer = room.players[prevPlayerIdx];
  if (prevPlayer && prevPlayer.alive !== false) {
    const noAction = !prevPlayer.actionDone &&
      !prevPlayer.actionUsedSkillReplace &&
      !(prevPlayer.skillsUsedBeforeAction && prevPlayer.skillsUsedBeforeAction.length > 0) &&
      prevPlayer._lastActionType !== 'move' &&
      prevPlayer._lastActionType !== 'attack';
    if (noAction && prevPlayer.name) {
      const msg = `${prevPlayer.name}의 턴 스킵`;
      if (typeof emitToBoth === 'function') emitToBoth(room, 'no_action_notice', { playerIdx: prevPlayerIdx, name: prevPlayer.name, msg });
      emitToSpectators(room, 'spectator_log', { msg, type: 'event', playerIdx: prevPlayerIdx });
    }
  }

  room.currentPlayerIdx = getNextPlayerIdx(room);
  room.turnNumber++;

  const curIdx = room.currentPlayerIdx;
  const prevIdx = getPrevPlayerIdx(room, curIdx);
  const cur = room.players[curIdx];
  const prev = room.players[prevIdx];

  // Process turn-start effects
  processTurnStart(room);

  // 승부 체크 (모드별)
  if (room.mode === 'team') {
    if (isTeamEliminated(room, 0)) { endTeamGame(room, 1); return; }
    if (isTeamEliminated(room, 1)) { endTeamGame(room, 0); return; }
  } else {
    if (checkWin(room, 0)) { endGame(room, 1); return; }
    if (checkWin(room, 1)) { endGame(room, 0); return; }
  }
  // 자동 무승부 — 보드 1x1 상태에서 어느 유닛도 자기-공격 불가일 때 (조건 1+2 모두 만족)
  if (checkUnreachableDraw(room)) {
    setKillInfo(room, 'unreachable', null, []);
    if (room.mode === 'team') endTeamGame(room, 0, 'unreachable_draw');
    else endGame(room, -1, 'unreachable_draw');
    return;
  }

  const turnData = {
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    skillPoints: room.sp,
    boardBounds: room.boardBounds,
    preCurseHps: room._preCurseHpsSnap || null,   // 저주 보라 도장 표시용 (curse 적용 전 HP)
  };

  // ── 팀 모드 분기 ──
  if (room.mode === 'team') {
    broadcastTeamGameState(room, turnData);
    emitToSpectators(room, 'spectator_log', { msg: `${room.turnNumber}턴 : ${cur.name}의 차례`, type: 'system', playerIdx: curIdx });
    startTimer(room, 'game', () => turnTimeout(room));
    // 현재 차례가 AI라면 자동 행동 트리거. 애니메이션 페이즈 진행 중이면 그 종료 + 1.5s 까지 대기.
    if (cur && cur.socketId === 'AI') {
      const phaseRemain = Math.max(0, (room._animPhaseEndsAt || 0) - Date.now());
      const aiDelay = Math.max(2500, phaseRemain);
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === curIdx) {
          aiTeamTakeTurn(room, curIdx);
        }
      }, aiDelay);
    }
    return;
  }

  // AI turn
  if (room.isAI && curIdx === 1) {
    emitToPlayer(room, prevIdx, 'opp_turn', {
      ...turnData,
      oppPieces: oppPieceSummary(cur.pieces),
      boardObjects: boardObjectsSummary(room, prevIdx),
    });
    // AI 턴에도 타이머 리셋 (플레이어에게 시각적 표시)
    startTimer(room, 'game', () => turnTimeout(room));
    // 애니메이션 페이즈 진행 중이면 그 종료 + 1.5s 까지 대기, 그 외 3s.
    const phaseRemain = Math.max(0, (room._animPhaseEndsAt || 0) - Date.now());
    const aiDelay = Math.max(3000, phaseRemain);
    setTimeout(() => {
      if (room.phase === 'game') aiTakeTurn(room);
    }, aiDelay);
    return;
  }

  // Human turn
  emitToPlayer(room, curIdx, 'your_turn', {
    ...turnData,
    yourPieces: pieceSummary(cur.pieces),
    oppPieces: oppPieceSummary(prev.pieces),
    boardObjects: boardObjectsSummary(room, curIdx),
    isYourTurn: true,
  });
  emitToPlayer(room, prevIdx, 'opp_turn', {
    ...turnData,
    oppPieces: oppPieceSummary(cur.pieces),
    boardObjects: boardObjectsSummary(room, prevIdx),
  });

  // 관전자에게 전체 상태 전송
  const curPlayer = room.players[room.currentPlayerIdx];
  emitToSpectators(room, 'spectator_log', { msg: `${room.turnNumber}턴 : ${curPlayer.name} 차례`, type: 'system', playerIdx: room.currentPlayerIdx });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  // 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));
}

// ── 팀전 게임 상태 브로드캐스트 ──
// 각 플레이어에게 개인화된 뷰 전송 (자기팀 pieces full, 적팀 oppSummary)
function getTeamGameStateFor(room, viewerIdx) {
  const viewerTeamId = room.players[viewerIdx]?.teamId;
  const players = room.players.map(p => {
    const isAlly = p.teamId === viewerTeamId;  // 자기 + 팀원 = ally
    return {
      idx: p.index,
      name: p.name,
      teamId: p.teamId,
      slotPos: p.slotPos ?? 0,  // 위치 기반 턴오더용
      pieces: isAlly ? pieceSummary(p.pieces) : oppPieceSummary(p.pieces),
      actionDone: !!p.actionDone,
      eliminated: isPlayerEliminated(room, p.index),
    };
  });
  // 보드 오브젝트: 자기팀 것은 full, 상대팀은 공개된 것만
  const boardObjects = [];
  for (let i = 0; i < room.players.length; i++) {
    const pTeam = room.players[i].teamId;
    if (pTeam === viewerTeamId) {
      // own team: full objects + own rats
      for (const o of (room.boardObjects[i] || [])) boardObjects.push({ ...o });
      for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
    } else {
      // enemy team: rats are visible
      for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
    }
  }
  return {
    currentPlayerIdx: room.currentPlayerIdx,
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    boardBounds: room.boardBounds,
    boardShrinkStage: room.boardShrinkStage,
    players,
    boardObjects,
    myIdx: viewerIdx,
    myTeamId: viewerTeamId,
    isMyTurn: room.currentPlayerIdx === viewerIdx,
  };
}

function broadcastTeamGameState(room, extra) {
  if (!room || room.mode !== 'team') return;
  for (const p of room.players) {
    if (!p.socketId) continue;
    const state = getTeamGameStateFor(room, p.index);
    if (extra) Object.assign(state, extra);
    io.to(p.socketId).emit('team_game_update', state);
  }
  // 관전자에게도 전체 정보 송신 (모든 팀의 정보 가시)
  const specs = (room.spectators || []);
  if (specs.length > 0) {
    const specState = getTeamSpectatorGameState(room);
    if (extra) Object.assign(specState, extra);
    for (const s of specs) {
      io.to(s.socketId).emit('team_spectator_update', specState);
    }
  }
}

// 팀전 관전자 — 4명 전원 풀데이터(좌표/상태/스킬 모두 가시)
function getTeamSpectatorGameState(room) {
  const players = room.players.map(p => ({
    idx: p.index,
    name: p.name,
    teamId: p.teamId,
    slotPos: p.slotPos ?? 0,
    deckName: p.deckName || '',
    pieces: pieceSummary(p.pieces),
    actionDone: !!p.actionDone,
    eliminated: isPlayerEliminated(room, p.index),
  }));
  const boardObjects = [];
  for (let i = 0; i < room.players.length; i++) {
    for (const o of (room.boardObjects[i] || [])) boardObjects.push({ ...o });
    for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
  }
  return {
    currentPlayerIdx: room.currentPlayerIdx,
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    boardBounds: room.boardBounds,
    boardShrinkStage: room.boardShrinkStage,
    players,
    boardObjects,
    isSpectator: true,
    teams: room.teams,
    p0Name: room.players[0]?.name || '',
    p1Name: room.players[1]?.name || '',
    p2Name: room.players[2]?.name || '',
    p3Name: room.players[3]?.name || '',
  };
}

// 팀전 게임 종료
function endTeamGame(room, winnerTeamId, reason) {
  clearTimer(room);
  clearAiThinkState(room);
  room.phase = 'ended';
  const winners = (room.teams[winnerTeamId] || []).map(i => room.players[i]?.name).filter(Boolean);
  const losers = (room.teams[1 - winnerTeamId] || []).map(i => room.players[i]?.name).filter(Boolean);
  // 1v1처럼 구조화된 reason 객체 (type/killer/victims) 전달
  const killInfo = room.lastKillInfo || {};
  const reasonObj = reason === 'surrender' ? { type: 'surrender' }
    : reason === 'shrink' ? { type: 'shrink' }
    : reason === 'draw' ? { type: 'draw' }
    : reason === 'unreachable_draw' ? { type: 'unreachable_draw' }
    : reason === 'simultaneous_draw' ? { type: 'simultaneous_draw' }
    : reason === 'disconnect' ? { type: 'disconnect' }
    : { type: killInfo.type || 'attack', killer: killInfo.killer || null, victims: killInfo.victims || [] };
  const isDraw = reason === 'draw' || reason === 'unreachable_draw' || reason === 'simultaneous_draw';
  // 팀 컬러 라벨
  const winTeamLabel = winnerTeamId === 0 ? '블루팀' : '레드팀';
  const loseTeamLabel = winnerTeamId === 0 ? '레드팀' : '블루팀';
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_game_over', {
      win: isDraw ? null : (p.teamId === winnerTeamId),
      winnerTeamId: isDraw ? null : winnerTeamId,
      winTeamLabel, loseTeamLabel,
      winners, losers,
      reason: reasonObj,
    });
  }
  emitToSpectators(room, 'team_game_over', {
    winnerTeamId: isDraw ? null : winnerTeamId,
    winTeamLabel, loseTeamLabel, winners, losers,
    reason: reasonObj, spectator: true,
  });
}

function endGame(room, winnerIdx, reason) {
  clearTimer(room);
  clearAiThinkState(room);
  room.phase = 'ended';
  const killInfo = room.lastKillInfo || {};
  const reasonObj = reason === 'surrender' ? { type: 'surrender' }
    : reason === 'shrink' ? { type: 'shrink' }
    : reason === 'draw' ? { type: 'draw' }
    : reason === 'unreachable_draw' ? { type: 'unreachable_draw' }
    : reason === 'simultaneous_draw' ? { type: 'simultaneous_draw' }
    : reason === 'disconnect' ? { type: 'disconnect' }
    : { type: killInfo.type || 'attack', killer: killInfo.killer || null, victims: killInfo.victims || [] };

  // Draw (양 팀 전멸 또는 unreachable — 게임 끝낼 수 없음)
  if (reason === 'draw' || reason === 'unreachable_draw' || reason === 'simultaneous_draw') {
    for (let i = 0; i < 2; i++) {
      emitToPlayer(room, i, 'game_over', { win: null, draw: true, reason: reasonObj });
    }
    emitToSpectators(room, 'game_over', { win: null, draw: true, spectator: true, reason: reasonObj,
      winnerName: room.players[0].name, loserName: room.players[1].name });
    return;
  }

  const winner = room.players[winnerIdx];
  const loser = room.players[1 - winnerIdx];
  const finalPiecesW = { yours: pieceSummary(winner.pieces), opps: pieceSummary(loser.pieces) };
  const finalPiecesL = { yours: pieceSummary(loser.pieces), opps: pieceSummary(winner.pieces) };

  // #15: 패배 측에 승자의 모든 piece 좌표(살아있는 것만) + 보드 오브젝트(덫·폭탄·쥐) + boardBounds 노출
  // — 패배 시 마지막 보드 상태 그리드 재현 용도
  const replayWinnerPieces = winner.pieces.map(pc => ({
    type: pc.type, name: pc.name, icon: pc.icon, hp: pc.hp, maxHp: pc.maxHp,
    col: pc.col, row: pc.row, alive: pc.alive, subUnit: pc.subUnit || null,
  }));
  const replayBoardObjects = [
    ...((room.boardObjects?.[winnerIdx] || []).map(o => ({ ...o, owner: 'opp' }))),
    ...((room.boardObjects?.[1 - winnerIdx] || []).map(o => ({ ...o, owner: 'me' }))),
  ];

  emitToPlayer(room, winnerIdx, 'game_over', { win: true, opponentName: loser.name, finalPieces: finalPiecesW, reason: reasonObj });
  emitToPlayer(room, 1 - winnerIdx, 'game_over', {
    win: false, opponentName: winner.name, finalPieces: finalPiecesL, reason: reasonObj,
    replayWinnerPieces, replayBoardObjects, replayBounds: room.boardBounds,
  });
  emitToSpectators(room, 'game_over', { win: null, winnerName: winner.name, loserName: loser.name, spectator: true, reason: reasonObj });
}

// ══════════════════════════════════════════════════════════════════
// ── Skill Execution ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function executeSkill(room, playerIdx, pieceIdx, skillId, params) {
  const player = room.players[playerIdx];
  const piece = player.pieces[pieceIdx];
  if (!piece || !piece.alive) return { ok: false, msg: '올바르지 않은 말입니다.' };
  if (!piece.hasSkill) return { ok: false, msg: '이 말은 스킬이 없습니다.' };

  // 저주 상태이면 스킬 봉인
  if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) {
    return { ok: false, msg: '저주 상태에서는 스킬을 사용할 수 없습니다.' };
  }

  // Look up skill cost — 다중 스킬 지원 (화약상 등)
  let cost = piece.skillCost;
  const baseChar = getChar(piece.type === 'twins_elder' || piece.type === 'twins_younger' ? 'twins' : piece.type);
  if (baseChar && baseChar.skills.length > 1 && skillId) {
    const matchedSkill = baseChar.skills.find(s => s.id === skillId);
    if (matchedSkill) cost = matchedSkill.cost;
  }

  // Check SP (regular + instant) — 팀모드는 teamId 슬롯
  const spSlot = (room.mode === 'team') ? getTeamOf(room, playerIdx) : playerIdx;
  if ((room.sp[spSlot] + room.instantSp[spSlot]) < cost) return { ok: false, msg: 'SP가 부족합니다.' };

  // 턴당 1회 제한 체크 (oncePerTurn)
  const effectiveSkillId = skillId || piece.skillId;
  const matchedSkillForOnce = baseChar ? baseChar.skills.find(s => s.id === effectiveSkillId) : null;
  if (matchedSkillForOnce && matchedSkillForOnce.oncePerTurn) {
    const usedKey = `${pieceIdx}:${effectiveSkillId}`;
    if (player.skillsUsedBeforeAction.includes(usedKey)) {
      return { ok: false, msg: '이 스킬은 턴당 1회만 사용할 수 있습니다.' };
    }
  }

  // Determine if this is a replacesAction skill (다중 스킬 지원)
  let replacesAction = piece.skillReplacesAction;
  if (baseChar && baseChar.skills.length > 1 && skillId) {
    const matchedSkill = baseChar.skills.find(s => s.id === skillId);
    if (matchedSkill) replacesAction = matchedSkill.replacesAction;
  }

  // If skill replaces action and action already done, can't use
  if (replacesAction && player.actionDone) {
    return { ok: false, msg: '이미 행동을 사용했습니다. 행동 대체 스킬을 사용할 수 없습니다.' };
  }

  const result = { ok: true, msg: '', data: {} };
  const bounds = room.boardBounds;

  // Resolve skill by piece type
  const effectiveType = piece.type;

  switch (effectiveType) {
    // ── ARCHER: 정비 (toggle diagonal direction) ──
    case 'archer': {
      piece.toggleState = (piece.toggleState === 'right') ? null : 'right';
      spendSP(room, playerIdx, cost);
      result.msg = `🏹 정비: 공격 방향 전환`;
      result.oppMsg = `🏹 정비: 공격 방향 전환`;
      result.data.toggleState = piece.toggleState;
      break;
    }

    // ── TWINS: 의좋은형제 (move one twin to the other) ──
    case 'twins_elder':
    case 'twins_younger': {
      const elderTwin = player.pieces.find(p => p.subUnit === 'elder' && p.alive);
      const youngerTwin = player.pieces.find(p => p.subUnit === 'younger' && p.alive);
      if (!elderTwin || !youngerTwin) return { ok: false, msg: '쌍둥이 중 하나가 쓰러져 분신을 사용할 수 없습니다.' };

      const mover = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'elder' && p.alive)
        : player.pieces.find(p => p.subUnit === 'younger' && p.alive);
      const target = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'younger' && p.alive)
        : player.pieces.find(p => p.subUnit === 'elder' && p.alive);

      if (!mover || !target) return { ok: false, msg: '대상이 없습니다.' };
      // ★ 비행 애니메이션용 — 이동 전 좌표를 캡쳐 (시전자/상대방/관전자 모두 동일 from→to 사용)
      const _twinFromCol = mover.col, _twinFromRow = mover.row;
      const _twinToCol   = target.col, _twinToRow   = target.row;
      mover.col = target.col;
      mover.row = target.row;
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      const moverSubject = mover.subUnit === 'elder' ? '누나가' : '동생이';
      const moverObject  = mover.subUnit === 'elder' ? '누나를' : '동생을';
      const targetLabel  = target.subUnit === 'elder' ? '누나' : '동생';
      result.msg = `👫 분신: ${moverSubject} ${targetLabel} 위치로 합류`;
      result.oppMsg = `👫 분신: ${moverSubject} ${targetLabel} 위치로 합류`;
      // 시전자/상대/관전자 모두에게 비행 애니메이션 정보 전달 (fog of war 우회용)
      result.data = result.data || {};
      result.data.twinJoin = {
        moverSub: mover.subUnit,
        fromCol: _twinFromCol, fromRow: _twinFromRow,
        toCol:   _twinToCol,   toRow:   _twinToRow,
      };
      break;
    }

    // ── SCOUT: 정찰 (reveal random enemy's row or col) ──
    case 'scout': {
      // 팀모드: 모든 상대팀 유닛 중에서 랜덤 / 1v1: 상대 1명
      let enemyPieces;
      if (room.mode === 'team') {
        const enemyIndices = getEnemyIndices(room, playerIdx);
        enemyPieces = enemyIndices.flatMap(ei => (room.players[ei]?.pieces || []).filter(p => p.alive && !p.isDragon));
      } else {
        enemyPieces = room.players[1 - playerIdx].pieces.filter(p => p.alive && !p.isDragon);
      }
      if (enemyPieces.length === 0) return { ok: false, msg: '적이 없습니다.' };
      const target = enemyPieces[Math.floor(Math.random() * enemyPieces.length)];
      const axis = Math.random() < 0.5 ? 'row' : 'col';
      const value = axis === 'row' ? target.row : target.col;
      spendSP(room, playerIdx, cost);
      // scout_result — 시전자 + 팀원에게 위치 정보 전달 (자체 addLog/toast 처리)
      if (room.mode === 'team') {
        const allies = getAllyIndices(room, playerIdx);
        for (const aIdx of allies) {
          emitToPlayer(room, aIdx, 'scout_result', { axis, value, targetName: target.name });
        }
      } else {
        emitToPlayer(room, playerIdx, 'scout_result', { axis, value, targetName: target.name });
      }
      // 적 측 메시지는 use_skill 핸들러의 status_update / team_skill_notice 로 자동 전달.
      // ★ 중복된 "[이름] - 정찰" 메시지 제거: scout_result 가 시전자/팀원을 커버하므로
      //   team_skill_notice 의 폴백 텍스트가 추가되지 않도록 result.allyMsg = '' (빈 문자열) 명시.
      result.oppMsg = `🔭 정찰: 상대가 ${target.name}의 위치를 알아냈습니다.`;
      result.allyMsg = '';   // 빈 문자열 — 팀원 시점에 team_skill_notice 의 fallback 출력 차단
      // 인벤토리 E1 관전자 셀: "🔭 정찰: 상대 [target]의 위치는 [label]"
      const labelStr = axis === 'row' ? `${['A','B','C','D','E','F','G'][value] || value}열` : `${value+1}행`;
      emitToSpectators(room, 'spectator_log', { msg: `🔭 정찰: 상대 ${target.name}의 위치는 ${labelStr}`, type: 'skill', playerIdx: playerIdx });
      result.skipLog = true;
      break;
    }

    // ── MANHUNTER: 덫 설치 ──
    case 'manhunter': {
      // 같은 칸 중복 설치 방지 (모든 플레이어 오브젝트 검사)
      const allObjectsAtCell = (room.boardObjects || []).flat()
        .some(o => o && (o.type === 'trap' || o.type === 'bomb') && o.col === piece.col && o.row === piece.row);
      if (allObjectsAtCell) {
        return { ok: false, msg: '이미 덫/폭탄이 설치된 칸입니다.' };
      }
      room.boardObjects[playerIdx].push({ type: 'trap', col: piece.col, row: piece.row, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `🪤 덫 설치: 설치 완료`;
      result.oppMsg = `🪤 덫 설치: 상대의 덫 설치`;
      break;
    }

    // ── MESSENGER: 질주 — 이동권 +1회 ──
    // 사용 가능: 아직 행동 없음 / 본인(전령) 이동 후
    // 사용 불가: 누구든 공격함 / 다른 유닛이 이동함
    case 'messenger': {
      if (player._lastActionType === 'attack') {
        return { ok: false, msg: '공격 후에는 질주를 사용할 수 없습니다.' };
      }
      if (player._lastActionType === 'move' &&
          (player._lastActionPieceType !== 'messenger')) {
        return { ok: false, msg: '다른 유닛이 이동했으므로 질주를 사용할 수 없습니다.' };
      }
      // 질주 활성화 — 이번 턴 이동권 1회 추가 제공
      piece.messengerSprintActive = true;
      // 이동권: 아직 이동 안 했으면 2회, 이미 1회 이동했으면 1회 더 남음
      piece.messengerMovesLeft = player.actionDone ? 1 : 2;
      // 공격은 금지 (actionUsedSkillReplace 로 막음)
      player.actionUsedSkillReplace = true;
      spendSP(room, playerIdx, cost);
      result.msg = `📯 질주: 전령은 추가 이동 가능`;
      result.oppMsg = `📯 질주: 전령은 추가 이동 가능`;
      break;
    }

    // ── GUNPOWDER: 시한폭탄 설치 / 기폭 ──
    case 'gunpowder': {
      if (skillId === 'detonate') {
        // 기폭: 설치한 폭탄 모두 폭발 (SP 0)
        const bombs = room.boardObjects[playerIdx].filter(o => o.type === 'bomb');
        if (bombs.length === 0) return { ok: false, msg: '설치된 폭탄이 없습니다.' };
        const allHits = [];
        const deferredBombEmits = [];  // skill_result 이후에 emit할 폭탄 데이터
        for (const bomb of bombs) {
          const hits = detonateBomb(room, playerIdx, bomb, { deferEmit: true });
          allHits.push(...hits);
          deferredBombEmits.push({ col: bomb.col, row: bomb.row, hits });
        }
        room.boardObjects[playerIdx] = room.boardObjects[playerIdx].filter(o => o.type !== 'bomb');
        result.msg = `💥기폭: 폭탄 폭발!`;
        result.oppMsg = `💥기폭: 폭탄 폭발!`;
        result.data.hits = allHits;
        result.data.deferredBombEmits = deferredBombEmits;  // 외부에서 사용
        break;
      }
      // 시한폭탄 설치
      const tc = params?.col ?? piece.col;
      const tr = params?.row ?? piece.row;
      if (Math.abs(tc - piece.col) > 1 || Math.abs(tr - piece.row) > 1) {
        return { ok: false, msg: '자신 또는 인접 8칸에만 설치 가능합니다.' };
      }
      if (!inBounds(tc, tr, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      // 같은 칸 중복 설치 방지
      const bombOverlap = (room.boardObjects || []).flat()
        .some(o => o && (o.type === 'trap' || o.type === 'bomb') && o.col === tc && o.row === tr);
      if (bombOverlap) {
        return { ok: false, msg: '이미 덫/폭탄이 설치된 칸입니다.' };
      }
      room.boardObjects[playerIdx].push({ type: 'bomb', col: tc, row: tr, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `💣 폭탄 설치: 설치 완료`;
      result.oppMsg = `💣 폭탄 설치: 상대의 폭탄 설치`;
      break;
    }

    // ── HERBALIST: 약초학 (heal 3x3 allies +1 HP, not self) ──
    // 팀모드: 팀원 아군도 대상 포함
    case 'herbalist': {
      let healed = 0;
      const healedIdxs = [];
      const allyIndices = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
      for (const aIdx of allyIndices) {
        const allyPlayer = room.players[aIdx];
        for (const ally of allyPlayer.pieces) {
          if (ally.alive && ally !== piece && Math.abs(ally.col - piece.col) <= 1 && Math.abs(ally.row - piece.row) <= 1) {
            if (ally.hp < ally.maxHp) {
              ally.hp = Math.min(ally.maxHp, ally.hp + 1);
              healed++;
              if (aIdx === playerIdx) healedIdxs.push(allyPlayer.pieces.indexOf(ally));
            }
          }
        }
      }
      spendSP(room, playerIdx, cost);
      result.data.healedPieceIdxs = healedIdxs;
      result.msg = `🌿 약초학: 범위 내 아군 1 HP 회복`;
      result.oppMsg = `🌿 약초학: 범위 내 아군 1 HP 회복`;
      break;
    }

    // ── SHADOW ASSASSIN: 그림자 숨기 ──
    case 'shadowAssassin': {
      if (piece.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '이미 그림자 상태입니다.' };
      }
      piece.statusEffects.push({ type: 'shadow', source: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `👻 그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역`;
      result.oppMsg = `👻 그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역`;
      break;
    }

    // ── WITCH: 저주 (직접 대상 지정 — 턴당 0.5 피해 + 스킬 봉인) ──
    case 'witch': {
      const tIdx = params?.targetPieceIdx;
      // 팀모드: targetOwnerIdx로 적팀 멤버 식별, 1v1: 상대 단일
      const targetOwnerIdx = (params?.targetOwnerIdx != null) ? params.targetOwnerIdx : (1 - playerIdx);
      const opponent = room.players[targetOwnerIdx];
      if (!opponent || tIdx === undefined || !opponent.pieces[tIdx]) {
        return { ok: false, msg: '저주 대상을 선택하세요.' };
      }
      // 팀모드: 적팀 검증 (자신/팀원에는 못 검)
      if (room.mode === 'team' && opponent.teamId === room.players[playerIdx].teamId) {
        return { ok: false, msg: '같은 팀원에게는 저주를 걸 수 없습니다.' };
      }
      const target = opponent.pieces[tIdx];
      if (!target.alive || target.hp <= 1) {
        return { ok: false, msg: 'HP가 1 이하인 대상에게는 저주를 걸 수 없습니다.' };
      }
      if (target.statusEffects.some(e => e.type === 'curse')) {
        return { ok: false, msg: '이미 저주 상태입니다.' };
      }
      // 그림자 상태 면역
      if (target.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '그림자 상태의 대상에게는 저주를 걸 수 없습니다.' };
      }
      // 호위 무사 충성 — 왕실 아군이 받을 상태이상도 호위무사가 대신 받음
      let curseTarget = target;
      let curseTargetOwnerIdx = targetOwnerIdx;
      if (target.tag === 'royal' && target.type !== 'bodyguard') {
        // 같은 팀(1v1: 같은 플레이어)의 살아있는 호위무사 탐색
        const bgOwners = (room.mode === 'team') ? getAllyIndices(room, targetOwnerIdx) : [targetOwnerIdx];
        for (const bgOwnerIdx of bgOwners) {
          const bg = room.players[bgOwnerIdx]?.pieces.find(p => p.type === 'bodyguard' && p.alive);
          if (bg && !bg.statusEffects.some(e => e.type === 'curse') && bg.hp > 1 && !bg.statusEffects.some(e => e.type === 'shadow')) {
            curseTarget = bg;
            curseTargetOwnerIdx = bgOwnerIdx;
            const bgOwnerName = room.players[bgOwnerIdx].name;
            emitToBoth(room, 'passive_alert', { type: 'bodyguard', playerIdx: bgOwnerIdx, msg: `🛡 충성: ${target.name} 대신 저주를 받음` });
            emitToSpectators(room, 'spectator_log', { msg: `🛡 충성: ${target.name} 대신 저주를 받음`, type: 'passive', playerIdx: bgOwnerIdx });
            break;
          }
        }
      }
      curseTarget.statusEffects.push({ type: 'curse', source: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `☠ 저주: ${curseTarget.name}${조사(curseTarget.name, '을', '를')} 저주`;
      result.oppMsg = `☠ 저주: 상대 마녀가 ${curseTarget.name}${조사(curseTarget.name, '을', '를')} 저주`;
      break;
    }

    // ── DUAL BLADE: 쌍검무 (양손검객 공격권 +1 — 총 최대 2회) ──
    case 'dualBlade': {
      // 가드: 이동 후 사용 불가 (이번 턴 공격 2회 — 이동 후엔 의미 없음)
      if (player._lastActionType === 'move') {
        return { ok: false, msg: '이미 이동했으므로 쌍검무를 사용할 수 없습니다.' };
      }
      // 가드: 다른 유닛이 공격했다면 사용 불가 (이 양손검객 본인은 OK)
      if (player._lastActionType === 'attack' &&
          (player._lastActionPieceType !== 'dualBlade')) {
        return { ok: false, msg: '다른 유닛이 행동했으므로 쌍검무를 사용할 수 없습니다.' };
      }
      piece.dualBladeAttacksLeft = 1;  // +1 공격권
      spendSP(room, playerIdx, cost);
      // 시전자·상대팀·관전자 모두 동일한 문장 사용
      result.msg = `⚔ 쌍검무: 양손검객은 추가 공격 가능`;
      result.oppMsg = `⚔ 쌍검무: 양손검객은 추가 공격 가능`;
      break;
    }

    // ── RAT MERCHANT: 역병의 자손들 (summon 3 rats) ──
    case 'ratMerchant': {
      // 보드 전체에서 랜덤 3곳 (이미 쥐가 있는 곳 제외)
      const existingRats = room.rats[playerIdx];
      const allCells = [];
      for (let c = bounds.min; c <= bounds.max; c++)
        for (let r = bounds.min; r <= bounds.max; r++) {
          if (!existingRats.some(er => er.col === c && er.row === r))
            allCells.push({ col: c, row: r });
        }
      const numRats = Math.min(3, allCells.length);
      const newRats = [];
      for (let i = 0; i < numRats; i++) {
        const ri = Math.floor(Math.random() * allCells.length);
        newRats.push(allCells.splice(ri, 1)[0]);
      }
      room.rats[playerIdx].push(...newRats);
      spendSP(room, playerIdx, cost);
      emitToBoth(room, 'rats_spawned', { rats: newRats, owner: playerIdx, spCost: cost });
      emitToSpectators(room, 'spectator_log', { msg: `🐀 역병의 자손들: 쥐 ${newRats.length}마리 소환`, type: 'skill', playerIdx });
      result.msg = ``;
      result.skipLog = true;
      break;
    }

    // ── WEAPON SMITH: 정비 (toggle horizontal/vertical) ──
    case 'weaponSmith': {
      piece.toggleState = (piece.toggleState === 'vertical') ? null : 'vertical';
      spendSP(room, playerIdx, cost);
      const wsDir = piece.toggleState === 'vertical' ? '세로' : '가로';
      result.msg = `⚒ 정비: 공격 방향 전환`;
      result.oppMsg = `⚒ 정비: 공격 방향 전환`;
      result.data.toggleState = piece.toggleState;
      break;
    }

    // (호위 무사는 패시브로 변경됨 — 스킬 핸들러 불필요)

    // ── KING: 절대복종 반지 (force move enemy) ──
    case 'king': {
      const targetName = params?.targetName;
      const destCol = params?.col;
      const destRow = params?.row;
      if (targetName === undefined || destCol === undefined || destRow === undefined) {
        return { ok: false, msg: '대상과 목적지를 지정하세요.' };
      }
      if (!inBounds(destCol, destRow, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      // 팀모드: 양 적팀 멤버 모두 검색, 1v1: 단일 상대
      const kingTargetOwnerIdx = (params?.targetOwnerIdx != null) ? params.targetOwnerIdx : (1 - playerIdx);
      const kingTargetOwner = room.players[kingTargetOwnerIdx];
      if (!kingTargetOwner) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
      if (room.mode === 'team' && kingTargetOwner.teamId === room.players[playerIdx].teamId) {
        return { ok: false, msg: '같은 팀원은 강제 이동할 수 없습니다.' };
      }
      const enemyPiece = kingTargetOwner.pieces.find(p => p.alive && p.type === targetName);
      if (!enemyPiece) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
      if (enemyPiece.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '그림자 상태인 적에게는 사용할 수 없습니다.' };
      }
      enemyPiece.col = destCol;
      enemyPiece.row = destRow;
      spendSP(room, playerIdx, cost);
      result.msg = `♛ 절대복종 반지: ${enemyPiece.name}${조사(enemyPiece.name, '을', '를')} 강제 이동`;
      result.oppMsg = `♛ 반지: 상대 국왕이 ${enemyPiece.name}${조사(enemyPiece.name, '을', '를')} 강제 이동`;

      // Check if moved onto a trap
      const trapIdx2 = room.boardObjects[playerIdx].findIndex(o => o.type === 'trap' && o.col === destCol && o.row === destRow);
      if (trapIdx2 >= 0) {
        room.boardObjects[playerIdx].splice(trapIdx2, 1);
        const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: destCol, row: destRow }, enemyPiece, playerIdx, 2, false);
        enemyPiece.hp = Math.max(0, enemyPiece.hp - dmg);
        // Wizard passive: 강제 이동된 마법사가 덫을 밟아 피격되어도 인스턴트 SP 1 획득
        if (enemyPiece.type === 'wizard' && dmg > 0) {
          const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, kingTargetOwnerIdx) : kingTargetOwnerIdx;
          room.instantSp[wizSpSlot] += 1;
          // ❌ emitSPUpdate(room) 제거 — executeSkill 안이라 skill_result 가 sp/instantSp 를 자동 전달.
          //    여기서 sp_update 가 먼저 가면 시전자의 마법구 비행 애니가 delta=0 으로 무동작이 됨.
          emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: kingTargetOwnerIdx, msg: `🧙 인스턴트 매직 : SP 획득` });

          emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: kingTargetOwnerIdx });

        }
        const willDie2 = enemyPiece.hp <= 0;
        if (willDie2) handleDeath(room, enemyPiece, kingTargetOwnerIdx);
        emitToBoth(room, 'trap_triggered', {
          col: destCol, row: destRow,
          pieceInfo: { type: enemyPiece.type, name: enemyPiece.name, icon: enemyPiece.icon },
          damage: dmg,
          destroyed: willDie2,
          newHp: enemyPiece.hp,
          victimOwnerIdx: kingTargetOwnerIdx,
        });
      }
      break;
    }

    // ── DRAGON TAMER: 드래곤 소환 ──
    case 'dragonTamer': {
      // 보드 위 드래곤이 이미 1마리 있으면 소환 불가
      const existingDragon = player.pieces.find(p => p.isDragon && p.alive);
      if (existingDragon) return { ok: false, msg: '보드 위에 이미 드래곤이 있습니다.' };
      const dc = params?.col;
      const dr = params?.row;
      if (dc === undefined || dr === undefined) return { ok: false, msg: '소환 위치를 지정하세요.' };
      if (!inBounds(dc, dr, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      const dragon = createPiece('dragonTamer', 3, 3, { isDragon: true, ownerIdx: playerIdx });
      dragon.type = 'dragon';
      dragon.name = '드래곤';
      dragon.icon = '🐲';
      dragon.atk = 3;
      dragon.hp = 3;
      dragon.maxHp = 3;
      dragon.col = dc;
      dragon.row = dr;
      dragon.hasSkill = false;
      dragon.skillName = null;
      dragon.skillId = null;
      dragon.tag = null;
      dragon.tier = 3;
      dragon.desc = '자신 + 십자4칸 · 총 5칸';
      player.pieces.push(dragon);
      spendSP(room, playerIdx, cost);
      emitToBoth(room, 'dragon_spawned', { dragon: { col: dc, row: dr, hp: 3 }, owner: playerIdx, spCost: cost });
      emitToSpectators(room, 'spectator_log', { msg: `🐉 드래곤 소환: ${coord(dc,dr)}에 드래곤 소환`, type: 'skill', playerIdx });
      result.msg = ``;
      result.skipLog = true;
      break;
    }

    // ── MONK: 신성 (heal ally +2, remove status effects) ──
    case 'monk': {
      const targetIdx2 = params?.targetPieceIdx;
      if (targetIdx2 === undefined) return { ok: false, msg: '대상을 지정하세요.' };
      const target = player.pieces[targetIdx2];
      if (!target || !target.alive) return { ok: false, msg: '대상이 없습니다.' };
      if (target === piece) return { ok: false, msg: '자신은 치유할 수 없습니다.' };
      target.hp = Math.min(target.maxHp, target.hp + 2);
      // AI 마녀 학습 — 신성으로 저주 정화 시 시전자 마녀의 _curseHistory 카운트 증가
      const hadCurse = (target.statusEffects || []).find(e => e.type === 'curse');
      if (hadCurse) {
        const witchOwner = room.players[hadCurse.source];
        if (witchOwner && witchOwner.socketId === 'AI') {
          if (!witchOwner._curseHistory) witchOwner._curseHistory = {};
          const key = `${playerIdx}:${target.type}:${target.subUnit || ''}`;
          witchOwner._curseHistory[key] = (witchOwner._curseHistory[key] || 0) + 1;
        }
      }
      target.statusEffects = [];
      spendSP(room, playerIdx, cost);
      result.data.healedPieceIdxs = [targetIdx2];
      result.msg = `🙏 신성: ${target.name}의 상태이상 제거, 2 HP 회복`;
      result.oppMsg = `🙏 신성: ${target.name}의 상태이상 제거, 2 HP 회복`;
      break;
    }

    // ── SULFUR CAULDRON: 유황의 강 (border attack, dmg 3) ──
    case 'sulfurCauldron': {
      const borderCells = getBorderCells(bounds);
      // suppressSpUpdate=true — 시전자 마법구 비행 애니가 race 안 나도록
      const hits = processAttack(room, playerIdx, { ...piece, atk: 2, type: 'sulfurCauldron' }, borderCells, 2, { suppressSpUpdate: true });
      const sulfurKilled = hits.filter(h => h.destroyed);
      if (sulfurKilled.length > 0) {
        setKillInfo(room, 'sulfur', null, sulfurKilled.map(k => ({ name: k.revealedName })));
      }
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `🔥 유황범람: 보드 외곽 전체 2 피해`;
      result.oppMsg = `🔥 유황범람: 보드 외곽 전체 2 피해`;
      result.data.hits = hits;
      result.data.borderCells = borderCells;
      break;
    }

    // ── TORTURER: 악몽 (damage all marked enemies — 팀모드는 양 적팀 모두) ──
    case 'torturer': {
      // 팀모드: getEnemyIndices로 양 적팀 멤버 모두, 1v1: 단일 상대
      const enemyIndices = (room.mode === 'team') ? getEnemyIndices(room, playerIdx) : [1 - playerIdx];
      const enemyEntries = enemyIndices.map(ei => ({ idx: ei, pieces: room.players[ei].pieces.filter(p => p.alive) }));
      const allEnemies = enemyEntries.flatMap(e => e.pieces);
      const hasMarked = allEnemies.some(p => p.statusEffects.some(e => e.type === 'mark'));
      if (!hasMarked) return { ok: false, msg: '표식 상태의 적이 없어 악몽을 사용할 수 없습니다.' };
      const hits = [];
      for (const ee of enemyEntries) {
        for (const m of ee.pieces.filter(p => p.statusEffects.some(e => e.type === 'mark'))) {
          const dmg = resolveDamage(room, piece, m, playerIdx, 1, false);
          m.hp = Math.max(0, m.hp - dmg);
          // Wizard passive: 악몽으로 마법사가 피격되어도 인스턴트 SP 1 획득 (피격마다 트리거)
          if (m.type === 'wizard' && dmg > 0) {
            const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, ee.idx) : ee.idx;
            room.instantSp[wizSpSlot] += 1;
            // ❌ emitSPUpdate 제거 — skill_result 가 sp/instantSp 를 자동 전달함.
            emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: ee.idx, msg: `🧙 인스턴트 매직 : SP 획득` });

            emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: ee.idx });

          }
          if (m.hp <= 0) handleDeath(room, m, ee.idx);
          hits.push({ col: m.col, row: m.row, damage: dmg, newHp: m.hp, destroyed: !m.alive, name: m.name, ownerIdx: ee.idx });
        }
      }
      const nightmareKilled = hits.filter(h => h.destroyed);
      if (nightmareKilled.length > 0) {
        setKillInfo(room, 'nightmare', piece.name, nightmareKilled.map(k => ({ name: k.name })));
        // 사망 알림 — 악몽으로 격파된 각 대상에 대해 1회씩 (인벤토리 #E 악몽 row의 빨간 피드백)
        for (const k of nightmareKilled) {
          const victimOwner = room.players[k.ownerIdx];
          const victimOwnerName = victimOwner ? victimOwner.name : '';
          const prefix = victimOwnerName ? `${victimOwnerName}의 ` : '';
          emitToBoth(room, 'passive_alert', {
            type: 'nightmare_kill',
            playerIdx: playerIdx,
            msg: `⛓ 악몽: ${prefix}${k.name} 격파!`,
          });
          emitToSpectators(room, 'spectator_log', {
            msg: `⛓ 악몽: ${player.name}의 고문기술자가 ${prefix}${k.name}${조사(k.name, '을', '를')} 격파`,
            type: 'passive', playerIdx: playerIdx,
          });
        }
      }
      spendSP(room, playerIdx, cost);
      result.msg = `⛓ 악몽: 모든 표식 상태 적 1 피해`;
      result.oppMsg = `⛓ 악몽: 모든 표식 상태 유닛 1 피해`;
      result.data.hits = hits;
      break;
    }

    default:
      return { ok: false, msg: '알 수 없는 스킬입니다.' };
  }

  // 턴당 1회 제한 스킬 사용 기록
  if (matchedSkillForOnce && matchedSkillForOnce.oncePerTurn) {
    const usedKey = `${pieceIdx}:${effectiveSkillId}`;
    player.skillsUsedBeforeAction.push(usedKey);
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════
// ── AI Brain ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function initAiBrain() {
  const prob = [];
  for (let r = 0; r < 5; r++) {
    prob[r] = [];
    for (let c = 0; c < 5; c++) prob[r][c] = 1.0;
  }
  return {
    probMap: prob,
    confirmedEmpty: new Set(),
    hits: [],
    mode: 'scan',
    huntTargets: [],
    enemiesAlive: 3,
    turnCount: 0,
    lastHitTurn: -10,
    // 피격 기억: { pieceType: { col, row, turn } } — 맞은 위치를 기억해서 도망
    hitMemory: {},
  };
}

function aiSpreadProbability(brain) {
  const old = brain.probMap.map(r => [...r]);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (old[r][c] <= 0) continue;
      const spread = old[r][c] * 0.15;
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
          brain.probMap[nr][nc] += spread;
        }
      }
    }
  }
  normalizeProbMap(brain);
}

function normalizeProbMap(brain) {
  let max = 0;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++)
      if (brain.probMap[r][c] > max) max = brain.probMap[r][c];
  if (max > 0) {
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        brain.probMap[r][c] = brain.probMap[r][c] / max * 10;
  }
}

function aiProcessAttackResult(brain, atkCells, hitResults) {
  for (const cell of atkCells) {
    const hit = hitResults.find(h => h.col === cell.col && h.row === cell.row);
    if (hit) {
      brain.hits.push({ col: cell.col, row: cell.row, turn: brain.turnCount, destroyed: hit.destroyed });
      brain.lastHitTurn = brain.turnCount;
      brain.mode = 'hunt';
      if (hit.destroyed) {
        brain.enemiesAlive--;
        brain.probMap[cell.row][cell.col] = 0;
        if (brain.enemiesAlive <= 1) brain.mode = 'finish';
      } else {
        boostHuntArea(brain, cell.col, cell.row);
      }
    } else {
      brain.probMap[cell.row][cell.col] *= 0.1;
    }
  }
  if (brain.turnCount - brain.lastHitTurn > 5) brain.mode = 'scan';
}

function boostHuntArea(brain, col, row) {
  // 적중 셀: 최고 확신 — 상대가 도망가기 전까지 같은 칸 지속 공격
  brain.probMap[row][col] = 9;
  // 인접 4방: 상대가 도망갈 가능성 — 두번째 우선순위
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = col + dc, nr = row + dr;
    if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
      brain.probMap[nr][nc] = Math.max(brain.probMap[nr][nc], 6);
    }
  }
}

function aiScoreAttack(brain, piece, room, extra) {
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, piece.col, piece.row, bounds, extra);
  let score = 0;
  for (const cell of cells) {
    if (inBounds(cell.col, cell.row, bounds)) {
      score += brain.probMap[cell.row][cell.col];
    }
  }
  score *= (1 + piece.atk * 0.1);
  return score;
}

function aiScoreMove(brain, piece, newCol, newRow, room) {
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, newCol, newRow, bounds);
  let score = 0;
  for (const cell of cells) {
    if (inBounds(cell.col, cell.row, bounds)) {
      score += brain.probMap[cell.row][cell.col];
    }
  }
  // 보드 축소 회피 — 다음 축소 영역(newBounds) 밖에 들어가면 강한 페널티 (팀모드와 동일 로직)
  // 임박할수록 강한 페널티 (10턴 전: -25, 1턴 전: -250)
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  for (const ev of schedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const turnsToShrink = ev.shrinkTurn - room.turnNumber;
    if (turnsToShrink > 10 || turnsToShrink < 0) continue;
    const willBeOutside = newCol < ev.newBounds.min || newCol > ev.newBounds.max ||
                          newRow < ev.newBounds.min || newRow > ev.newBounds.max;
    if (willBeOutside) {
      const urgency = Math.max(1, 11 - turnsToShrink);
      score -= 25 * urgency;
    }
  }
  // 일반 가장자리 페널티 (보드 축소 임박 안 해도)
  if (room.turnNumber >= 25 && !room.boardShrunk) {
    if (newCol === bounds.min || newCol === bounds.max || newRow === bounds.min || newRow === bounds.max) {
      score *= 0.5;
    }
  }

  // ★ 피격 기억: 최근에 맞은 말은 현재 위치에서 벗어나는 것에 높은 점수
  const mem = brain.hitMemory[piece.type];
  if (mem && brain.turnCount - mem.turn <= 2) {
    // 현재 위치가 맞은 위치와 같거나 인접 → 이동하면 생존 보너스
    const distFromHit = Math.abs(newCol - mem.col) + Math.abs(newRow - mem.row);
    const curDistFromHit = Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row);
    if (distFromHit > curDistFromHit) {
      // 맞은 곳에서 멀어지는 방향 → 큰 보너스
      score += 25 * (1 + (piece.maxHp - piece.hp) / piece.maxHp); // HP 낮을수록 더 도망
    }
  }

  return score;
}

function aiBestTargetCell(brain, piece, room) {
  const bounds = room.boardBounds;
  let bestCol = bounds.min, bestRow = bounds.min, bestScore = -1;
  for (let r = bounds.min; r <= bounds.max; r++) {
    for (let c = bounds.min; c <= bounds.max; c++) {
      if (c === piece.col && r === piece.row) continue;
      const score = brain.probMap[r][c];
      if (score > bestScore) { bestScore = score; bestCol = c; bestRow = r; }
    }
  }
  return { col: bestCol, row: bestRow };
}

function aiSelectPieces() {
  const t1 = CHARACTERS[1];
  const t2 = CHARACTERS[2];
  const t3 = CHARACTERS[3];
  return {
    t1: randomPick(t1.filter(c => c.type !== 'twins')).type,
    t2: randomPick(t2).type,
    t3: randomPick(t3).type,
  };
}

function aiDistributeHp(hasTwins) {
  if (hasTwins) {
    const patterns = [[2,2,3,3],[1,1,4,4],[2,1,3,4],[1,2,4,3],[2,2,2,4]];
    return randomPick(patterns);
  }
  const patterns = [
    [3,3,4],[2,4,4],[3,4,3],[2,3,5],[3,3,4],
    [2,4,4],[4,3,3],[3,5,2],[2,5,3],[4,4,2],
  ];
  return randomPick(patterns);
}

function aiPlacePieces(pieces, bounds) {
  const b = bounds || { min: 0, max: 4 };
  const positions = [];
  const allPos = [];
  for (let r = b.min; r <= b.max; r++)
    for (let c = b.min; c <= b.max; c++)
      allPos.push({ col: c, row: r });

  for (let i = 0; i < pieces.length; i++) {
    if (!pieces[i].alive) continue;
    const candidates = allPos.filter(p =>
      !positions.some(placed => placed.col === p.col && placed.row === p.row)
    );
    if (i === 0) {
      positions.push(randomPick(candidates));
    } else {
      candidates.sort((a, b2) => {
        const distA = Math.min(...positions.map(pl => Math.abs(a.col - pl.col) + Math.abs(a.row - pl.row)));
        const distB = Math.min(...positions.map(pl => Math.abs(b2.col - pl.col) + Math.abs(b2.row - pl.row)));
        return distB - distA;
      });
      const top = candidates.slice(0, Math.min(5, candidates.length));
      positions.push(randomPick(top));
    }
  }

  for (let i = 0; i < pieces.length; i++) {
    if (positions[i]) {
      pieces[i].col = positions[i].col;
      pieces[i].row = positions[i].row;
    }
  }
}

// ── AI Main Turn Logic ──────────────────────────────────────────

// AI가 피격당했을 때 기억 저장 (being_attacked 처리 시 호출)
function aiRecordHit(brain, piece) {
  brain.hitMemory[piece.type] = { col: piece.col, row: piece.row, turn: brain.turnCount };
}

// AI 스킬 사용 후 플레이어+관전자에게 알림
function aiNotifySkill(room, pieceIdx, result, skillId) {
  if (!result || !result.ok) return;
  const piece = room.players[1].pieces[pieceIdx];
  // ★ 다중 스킬 캐릭터 (화약상의 폭탄 설치 vs 기폭 등) — 실제 시전된 스킬 이름을 정확히 전달.
  //   piece.skillName 만 쓰면 첫 번째 스킬명 (폭탄 설치) 만 노출돼 말풍선이 잘못 표시됨.
  let actualSkillName = piece.skillName || '';
  if (skillId && Array.isArray(piece.skills)) {
    const matched = piece.skills.find(s => s.id === skillId);
    if (matched && matched.name) actualSkillName = matched.name;
  }
  // 플레이어에게 status_update — 시전자 카드 spotlight + 마법구 비행 트리거
  const human = room.players[0];
  if (human.socketId !== 'AI') {
    io.to(human.socketId).emit('status_update', {
      oppPieces: oppPieceSummary(room.players[1].pieces),
      yourPieces: pieceSummary(human.pieces),
      sp: room.sp,
      instantSp: room.instantSp,
      boardObjects: boardObjectsSummary(room, 0),
      msg: result.oppMsg || null,
      skillUsed: {
        icon: piece.icon,
        name: piece.name,
        skillName: actualSkillName,
      },
      casterPieceIdx: pieceIdx,
    });
  }
  // 1v1 관전자: 마법구 비행 + spotlight 전용 이벤트
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit('spectator_skill_anim', {
      casterIdx: 1,
      casterName: 'AI',
      casterPieceIdx: pieceIdx,
      sp: room.sp,
      instantSp: room.instantSp,
      skillUsed: { icon: piece.icon, name: piece.name, skillName: actualSkillName },
      // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용
      hits: result.data?.hits || null,
    });
  }
  // 관전자 로그
  if (!result.skipLog && result.msg) {
    const specMsg = buildSpectatorSkillMsg('AI', piece, result);
    emitToSpectators(room, 'spectator_log', { msg: specMsg, type: 'skill', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  // ★ 기폭 (detonate) — 폭발 애니메이션 emit. 인간 use_skill 경로와 동일.
  //   누락 시 AI가 기폭을 써도 상대방에게 폭발 애니가 안 보임 (사용자 보고).
  if (result.data && Array.isArray(result.data.deferredBombEmits)) {
    const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row }));
    if (bombList.length > 0) {
      emitToBoth(room, 'detonation_intro', { bombs: bombList });
      // emitToBoth 가 이미 spectators 포함 (중복 방지)
    }
    const deferred = [...result.data.deferredBombEmits];
    setTimeout(() => {
      if (!rooms[room.id]) return;
      for (const bd of deferred) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
    }, 1930);
  }

  // AI 토스트 추적 — 1v1 AI 스킬도 인트라 턴 행동 순서 보장
  aiTrackToast(room, 'skill');
}

// AI executeSkill wrapper — 실행 후 알림
function aiExecSkill(room, pidx, skillId, params) {
  // ★ 사망 기폭 페이즈 — 스킬 (학살영웅 attack 비슷한 효과 / 유황범람 / 악몽 등) 로 화약상 사망 시 큐.
  startPhase(room);
  const result = executeSkill(room, 1, pidx, skillId, params || {});
  aiNotifySkill(room, pidx, result, skillId);  // skillId 전달 — 다중스킬 캐릭터의 정확한 스킬명용
  // 사망 기폭 페이즈 flush — checkGameEndAfterPhase 는 별도 (AI는 endTurn 따로)
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') {
      checkGameEndAfterPhase(room);
    }
  });
  return result;
}

// AI 스킬 사용 판단 (free skills — 행동 전에 사용)
// 적극적 사용: 명백한 이득이 있으면 사용. SP 보존보다 스킬 가치 우선.
function aiUsePreSkills(room) {
  const aiPlayer = room.players[1];
  const human = room.players[0];
  const brain = room.aiBrain;
  const alivePieces = aiPlayer.pieces.filter(p => p.alive);
  const bounds = room.boardBounds;

  // ★ 사용자 요청 — AI 는 한 번에 한 개의 스킬만 사용. 시전 후 모든 애니메이션·토스트가
  //   화면에서 사라질 때까지 freeze. 다음 스킬은 aiTakeTurn 의 setTimeout 재진입으로 처리.
  //   _execed 가 true 이면 이번 호출에서는 더 이상 시전하지 않고 즉시 리턴 (다른 piece 도 스킵).
  let _execed = false;
  const _tryExec = (pidx, skillId, params) => {
    if (_execed) return false;
    const r = aiExecSkill(room, pidx, skillId, params);
    if (r && r.ok) { _execed = true; return true; }
    return false;
  };

  for (const piece of alivePieces) {
    if (_execed) break;  // 이미 한 개 시전 — 이번 호출 종료
    if (!piece.hasSkill || piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
    const pidx = aiPlayer.pieces.indexOf(piece);

    switch (piece.type) {
      // 그림자 암살자: 피격 기억 있거나 HP 낮으면 그림자 (1 SP, 거의 무조건)
      case 'shadowAssassin': {
        const mem = brain.hitMemory[piece.type];
        const recentlyHit = mem && brain.turnCount - mem.turn <= 2;
        const hasShadow = piece.statusEffects.some(e => e.type === 'shadow');
        if (!hasShadow && (recentlyHit || piece.hp <= piece.maxHp * 0.6 || Math.random() < 0.4)) {
          _tryExec(pidx, 'shadow');
        }
        break;
      }
      // 궁수/무기상: 대안 공격범위가 더 좋으면 토글 (SP 1 — 자유롭게)
      case 'archer':
      case 'weaponSmith': {
        const curCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds, { toggleState: piece.toggleState });
        let curScore = 0;
        for (const c of curCells) curScore += brain.probMap[c.row]?.[c.col] || 0;
        const altState = piece.type === 'archer'
          ? (piece.toggleState === 'right' ? null : 'right')
          : (piece.toggleState === 'vertical' ? null : 'vertical');
        const altCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds, { toggleState: altState });
        let altScore = 0;
        for (const c of altCells) altScore += brain.probMap[c.row]?.[c.col] || 0;
        if (altScore > curScore * 1.3 && altScore >= 4) {
          _tryExec(pidx, 'reform');
        }
        break;
      }
      // 전령 질주 — 사용자 요청: SP 1을 함부로 쓰지 말 것. 확실한 이득이 있을 때만.
      //   기존: 최근 피격 기억만 있어도 무조건 사용 → 자주 의미없는 SP 소모.
      //   개선:
      //     (1) HP ≤ 1 인 위급 상황 (도망용 추가 이동) — 피격 기억 + 저체력
      //     (2) 적과 멀리 떨어져 있는데 attack score 가 0 이라 "다가가기" 위해 추가 이동이 필요한 경우 — 정찰/접근용
      //   그 외엔 보류.
      case 'messenger': {
        const mem = brain.hitMemory[piece.type];
        const recentlyHit = mem && brain.turnCount - mem.turn <= 1;
        // (1) 위급 도주
        const critical = piece.hp <= 1;
        // (2) 공격 가치 없을 때 — 현재 위치 공격범위 내 적 점수가 0 이고 적 가까이 갈 필요가 있는 경우
        const curAtkCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds);
        let curThreatScore = 0;
        for (const c of curAtkCells) curThreatScore += brain.probMap[c.row]?.[c.col] || 0;
        const needsRepositioning = curThreatScore < 0.5 && recentlyHit;
        if ((critical && recentlyHit) || needsRepositioning) {
          _tryExec(pidx, 'sprint');
        }
        break;
      }
      // 척후병: 정찰 자주 사용 (SP 2 — scan 모드일 때 70%)
      case 'scout': {
        if (brain.mode === 'scan' && Math.random() < 0.7) {
          _tryExec(pidx, 'recon');
        }
        break;
      }
      // 약초전문가: 인접 아군 부상 시 적극적으로 회복 (SP 2)
      case 'herbalist': {
        const nearbyInjured = alivePieces.filter(a =>
          a !== piece && a.hp < a.maxHp &&
          Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1
        );
        if (nearbyInjured.length >= 1) {
          _tryExec(pidx, 'herb');
        }
        break;
      }
      // 쥐장수: 쥐가 적으면 적극 소환 (SP 2)
      case 'ratMerchant': {
        if (room.rats[1].length < 3 && Math.random() < 0.85) {
          _tryExec(pidx, 'rats');
        }
        break;
      }
      // 고문기술자: 표식된 적 있으면 즉시 악몽 (SP 3)
      case 'torturer': {
        const marked = human.pieces.filter(p => p.alive && p.statusEffects.some(e => e.type === 'mark'));
        if (marked.length >= 1) {
          _tryExec(pidx, 'nightmare');
        }
        break;
      }
      // 양손검객: 인접 적이 있고 SP 충분하면 거의 항상 (SP 2)
      case 'dualBlade': {
        // 인접 4방향에 적이 있으면 90% 확률, 아니면 60%
        const adjEnemy = human.pieces.some(p => p.alive &&
          ((Math.abs(p.col - piece.col) === 1 && p.row === piece.row) ||
           (Math.abs(p.row - piece.row) === 1 && p.col === piece.col)));
        if (adjEnemy ? Math.random() < 0.9 : Math.random() < 0.6) {
          _tryExec(pidx, 'dualStrike');
        }
        break;
      }
      // 수도승: 아군 부상 시 신성 (SP 3) — 회복 + 상태이상 제거
      case 'monk': {
        const injured = alivePieces.filter(a => a !== piece && a.hp < a.maxHp).sort((a, b) => a.hp - b.hp);
        const cursed = alivePieces.filter(a => a.statusEffects.some(e => e.type === 'curse' || e.type === 'mark'));
        const target = cursed[0] || injured[0];
        if (target && (cursed.length > 0 || target.hp <= target.maxHp * 0.6)) {
          const targetIdx = aiPlayer.pieces.indexOf(target);
          _tryExec(pidx, 'divine', { targetPieceIdx: targetIdx });
        }
        break;
      }
      // 국왕: 절대복종 반지 (SP 3) — 적을 덫/폭탄/유리한 위치로 강제 이동
      case 'king': {
        // 적이 있고 SP 3+ 있으면 50% 확률로 사용 (적을 덫 위치로 끌어들이기)
        const enemies = human.pieces.filter(p => p.alive);
        if (enemies.length === 0) break;
        // 내 덫 위치 탐색
        const myTraps = (room.boardObjects[1] || []).filter(o => o.type === 'trap');
        let target = null, destCol, destRow;
        if (myTraps.length > 0) {
          // HP 가장 높은 적을 덫으로
          const trap = myTraps[0];
          target = enemies.sort((a, b) => b.hp - a.hp)[0];
          destCol = trap.col; destRow = trap.row;
        } else if (Math.random() < 0.4) {
          // 덫이 없어도 가끔 사용 — 적을 보드 가장자리(축소 위험 지역)로
          target = enemies.sort((a, b) => b.hp - a.hp)[0];
          // 가장자리 칸 중 비어있는 곳
          for (let r = bounds.min; r <= bounds.max && !destCol; r++) {
            for (let c = bounds.min; c <= bounds.max; c++) {
              const isBorder = r === bounds.min || r === bounds.max || c === bounds.min || c === bounds.max;
              if (!isBorder) continue;
              const occ = room.players.some(pl => pl.pieces.some(p => p.alive && p.col === c && p.row === r));
              if (!occ) { destCol = c; destRow = r; break; }
            }
          }
        }
        if (target && destCol != null && destRow != null) {
          _tryExec(pidx, 'ring', { targetName: target.type, col: destCol, row: destRow });
        }
        break;
      }
      // 드래곤 조련사: SP 5 충분하면 적극 소환
      case 'dragonTamer': {
        const aiHasDragon = aiPlayer.pieces.some(p => p.isDragon && p.alive);
        if (!aiHasDragon && (room.sp[1] + room.instantSp[1]) >= 5) {
          // 적과 가까운 빈 칸 우선
          const emptyCells = [];
          for (let r = bounds.min; r <= bounds.max; r++)
            for (let c = bounds.min; c <= bounds.max; c++) {
              const occ = room.players.some(pl => pl.pieces.some(p => p.alive && p.col === c && p.row === r));
              if (!occ) emptyCells.push({ col: c, row: r });
            }
          if (emptyCells.length > 0) {
            // 적 평균 위치에서 거리 계산해 가까운 곳 우선
            const enemies = human.pieces.filter(p => p.alive && p.col != null);
            const avgC = enemies.length ? enemies.reduce((s, e) => s + e.col, 0) / enemies.length : 2;
            const avgR = enemies.length ? enemies.reduce((s, e) => s + e.row, 0) / enemies.length : 2;
            emptyCells.sort((a, b) => (Math.abs(a.col - avgC) + Math.abs(a.row - avgR)) - (Math.abs(b.col - avgC) + Math.abs(b.row - avgR)));
            const pos = emptyCells[0];
            _tryExec(pidx, 'dragon', { col: pos.col, row: pos.row });
          }
        }
        break;
      }
      // 화약상: 폭탄 설치 (replacesAction=false 분리 — 행동 후에도 사용 가능)
      case 'gunpowder': {
        // 기폭이 우선 — 설치된 폭탄 있고 적이 폭탄 인접 시 즉시 기폭
        const myBombs = (room.boardObjects[1] || []).filter(o => o.type === 'bomb');
        if (myBombs.length > 0) {
          // 적이 폭탄 영향권에 있는지 확인
          let enemiesInBlast = 0;
          for (const b of myBombs) {
            for (const e of human.pieces) {
              if (!e.alive) continue;
              if (Math.abs(e.col - b.col) <= 1 && Math.abs(e.row - b.row) <= 1) enemiesInBlast++;
            }
          }
          if (enemiesInBlast >= 1) {
            _tryExec(pidx, 'detonate');
            break;
          }
        }
        // 신규 설치 — 인접 8칸 중 적 있을 가능성 높은 위치
        if ((room.sp[1] + room.instantSp[1]) >= 2) {
          let bestCell = null, bestScore = -1;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nc = piece.col + dc, nr = piece.row + dr;
              if (!inBounds(nc, nr, bounds)) continue;
              if (room.boardObjects[1].some(o => o.col === nc && o.row === nr)) continue;
              const score = brain.probMap[nr]?.[nc] || 0;
              if (score > bestScore) { bestScore = score; bestCell = { col: nc, row: nr }; }
            }
          }
          if (bestCell && bestScore >= 2) {
            _tryExec(pidx, 'bomb', { col: bestCell.col, row: bestCell.row });
          }
        }
        break;
      }
    }
  }
}

// AI가 보드 축소 임박 시 외곽 셀에 있는 말을 안쪽으로 대피시킬 행동 찾기
// 반환: { piece, pieceIdx, col, row } 또는 null
function aiFindEvacuation(room) {
  const aiPlayer = room.players[1];
  const bounds = room.boardBounds;
  // 다음 축소 이벤트의 newBounds 가져오기 (turnNumber + 5턴 이내일 때만 발동)
  const schedule = getBoardShrinkSchedule(room);
  let nextShrink = null;
  for (const ev of schedule) {
    if (room.boardShrinkStage < ev.stage) {
      nextShrink = ev;
      break;
    }
  }
  if (!nextShrink) return null;
  const turnsLeft = nextShrink.shrinkTurn - room.turnNumber;
  if (turnsLeft > 5 || turnsLeft < 0) return null;
  const newB = nextShrink.newBounds;
  // 곧 파괴될 셀 = 현재 bounds 안이지만 newBounds 밖
  const willBeDestroyed = (col, row) =>
    inBounds(col, row, bounds) && !inBounds(col, row, newB);
  // 외곽 위험 셀에 있는 내 살아있는 말들
  const danger = aiPlayer.pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && willBeDestroyed(p.col, p.row));
  if (danger.length === 0) return null;
  // 가장 위험한 말 1개 선택 (HP 낮은 우선)
  danger.sort((a, b) => a.p.hp - b.p.hp);
  const target = danger[0].p;
  const targetIdx = danger[0].i;
  // 안쪽으로 이동 가능한 인접 셀 찾기 (newBounds 안 + 점유되지 않음)
  const candidates = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = target.col + dc, nr = target.row + dr;
    if (!inBounds(nc, nr, bounds)) continue;
    if (!inBounds(nc, nr, newB)) continue;  // 안쪽으로만 이동
    // 점유 검사 (자기/팀원 등 — 1v1: 자기 외 다른 말)
    const occupied = room.players.some(pl =>
      pl.pieces.some(p => p.alive && p !== target && p.col === nc && p.row === nr)
    );
    if (occupied) {
      // 쌍둥이끼리는 같은 칸 OK
      const sameTwin = target.subUnit && room.players.some(pl =>
        pl.pieces.some(p => p.alive && p !== target && p.col === nc && p.row === nr && p.subUnit && p.parentType === target.parentType)
      );
      if (!sameTwin) continue;
    }
    // 안쪽 깊이 점수 (newBounds 중심에 가까울수록 높음)
    const cx = (newB.min + newB.max) / 2, cy = (newB.min + newB.max) / 2;
    const dist = Math.abs(nc - cx) + Math.abs(nr - cy);
    candidates.push({ col: nc, row: nr, score: -dist });
  }
  if (candidates.length === 0) {
    // 인접 셀로는 못 빠지면 다른 위험 말로 폴백
    if (danger.length > 1) {
      // 임시 폴백: 두번째 위험 말 시도
      // (단순화 — 실제로는 모든 말을 순회하는 것이 정석)
    }
    return null;
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { piece: target, pieceIdx: targetIdx, col: best.col, row: best.row };
}

// AI가 피격 후 도망해야 하는 말 찾기
function aiFindFleeingPieces(room) {
  const brain = room.aiBrain;
  const aiPlayer = room.players[1];
  const fleeing = [];

  for (const piece of aiPlayer.pieces) {
    if (!piece.alive) continue;
    const mem = brain.hitMemory[piece.type];
    if (!mem || brain.turnCount - mem.turn > 2) continue;

    // 현재 위치가 맞은 위치와 같거나 인접 → 도망 필요
    const dist = Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row);
    if (dist <= 1) {
      const urgency = (piece.maxHp - piece.hp) / piece.maxHp; // HP 많이 깎였을수록 긴급
      fleeing.push({ piece, urgency, pieceIdx: aiPlayer.pieces.indexOf(piece) });
    }
  }

  return fleeing.sort((a, b) => b.urgency - a.urgency);
}

const AI_ACTION_DELAY = 3000;
function aiEndTurn(room) {
  // 사용자 요청: AI 는 자신의 턴에 발생한 모든 토스트가 사라진 후 0.5초 버퍼까지 대기 후 endTurn.
  //   - 토스트 발생 순서대로 표시되어야 하고,
  //   - 다음 플레이어의 턴오더 토스트가 직전 스킬/공격 토스트보다 먼저 오는 일이 없도록.
  const now = Date.now();
  const earliest = room._aiEndTurnEarliest || 0;
  const remainingToastMs = Math.max(0, earliest - now);
  const delay = Math.max(AI_ACTION_DELAY, remainingToastMs + 500);
  setTimeout(() => {
    if (room.phase === 'game') endTurn(room);
  }, delay);
  room._aiEndTurnEarliest = 0;  // 다음 AI 턴 위해 리셋 (stale future-time 으로 인한 freeze 방지)
}

function aiTakeTurn(room) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const bounds = room.boardBounds;

  // ★ Intra-turn 버퍼 — 직전 (같은 턴 내) 스킬·액션의 토스트가 아직 화면에 있으면 대기.
  //   _aiEndTurnEarliest 는 aiEndTurn 에서 리셋되므로 cross-turn 에는 영향 없음. 단, 안전 cap (5s).
  //   사용자 요청: 액션 ↔ 스킬 양방향 모두 명확한 호흡 텀.
  const _now = Date.now();
  const _earliest = room._aiEndTurnEarliest || 0;
  if (_earliest > _now) {
    const remain = _earliest - _now;
    // 안전 cap — stale value 로 인한 freeze 방지 (정상값은 ~6초 이내)
    const waitMs = Math.min(7500, remain + 1500);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === 1) {
        aiTakeTurn(room);
      }
    }, waitMs);
    return;
  }

  brain.turnCount++;
  aiSpreadProbability(brain);

  const alivePieces = aiPlayer.pieces.filter(p => p.alive);
  if (alivePieces.length === 0) return;

  // ★ STEP 0: 보드 축소 임박 — 외곽 말 즉시 대피 최우선
  // 다음 축소까지 5턴 이내이고, 외곽(곧 파괴될 셀)에 있는 내 말이 있으면 안쪽으로 이동
  const evacAction = aiFindEvacuation(room);
  if (evacAction && !aiPlayer.actionDone) {
    aiExecuteMove(room, evacAction);
    return;
  }

  // ★ STEP 1: 행동 전 free 스킬 사용
  //   사용자 요청: AI 는 한 번에 한 개의 스킬만 시전. 시전 후 모든 애니메이션·토스트·팝업이
  //   화면에서 완전히 사라질 때까지 freeze. 그 다음에야 다음 스킬·행동 가능.
  //   → aiUsePreSkills 가 한 번에 한 개만 시전 (내부 _execed 가드).
  //   → 재진입 대기 시간은 _aiEndTurnEarliest (토스트가 사라지는 시점) 기준 + 안전 마진.
  const preLenBefore = (aiPlayer.skillsUsedBeforeAction || []).length;
  aiUsePreSkills(room);
  const usedPreSkill = ((aiPlayer.skillsUsedBeforeAction || []).length > preLenBefore);
  if (usedPreSkill) {
    // 이전 스킬의 토스트/애니메이션이 화면에서 사라질 때까지 대기 — _aiEndTurnEarliest 활용.
    //   skill 의 경우 _aiEndTurnEarliest = now + 5900ms (appear 1500 + display 4000 + fade 350 + 50 buffer).
    //   사용자 요청: 스킬과 다음 행동(다른 스킬/일반 액션) 사이 명확한 호흡 텀 — 1500ms 버퍼.
    //   토스트 사라진 후에도 1.5초 가량 정적 → 다음 스킬/액션의 토스트가 명확히 분리되어 보임.
    const now = Date.now();
    const earliest = room._aiEndTurnEarliest || 0;
    const waitMs = Math.max(2500, (earliest - now) + 1500);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === 1) {
        aiTakeTurn(room);
      }
    }, waitMs);
    // ★ 직전 iteration 이 스킬 시전이었음을 마킹 — 다음 iteration 에서 액션으로 fall-through 시 추가 버퍼.
    room._aiLastWasSkill = true;
    return;
  }

  // ★ 직전 iteration 이 스킬이었고 이번에 더 이상 스킬을 안 쓴다면, 액션으로 넘어가기 전 추가 버퍼.
  //   사용자 요청: AI 가 스킬과 일반 행동을 거의 동시에 하는 느낌 제거. 스킬 phase 끝 → 명확한 텀 → 액션 phase.
  if (room._aiLastWasSkill) {
    room._aiLastWasSkill = false;
    const now = Date.now();
    const earliest = room._aiEndTurnEarliest || 0;
    const remain = Math.max(0, earliest - now);
    const waitMs = remain + 1500;  // 토스트 끝난 후 1.5초 추가 텀
    if (waitMs >= 200) {
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === 1) {
          aiTakeTurn(room);
        }
      }, waitMs);
      return;
    }
  }

  // ★ STEP 2: 피격된 말 — 도망 vs 반격 비교 (#6)
  // 도망만 하지 말고, 현재 공격으로 상대 격파가 가능하면 공격을 우선 고려
  const fleeList = aiFindFleeingPieces(room);
  if (fleeList.length > 0 && !aiPlayer.actionDone) {
    const flee = fleeList[0];
    const piece = flee.piece;
    const mem = brain.hitMemory[piece.type];

    // 반격 가치: 현재 위치에서 공격 시 예상 점수 (probMap 기반)
    let counterExtra = {};
    if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
      const bt = aiBestTargetCell(brain, piece, room);
      counterExtra.tCol = bt.col; counterExtra.tRow = bt.row;
    }
    if (piece.toggleState) counterExtra.toggleState = piece.toggleState;
    const counterAttackScore = aiScoreAttack(brain, piece, room, counterExtra);

    // 최적 도망 위치 평가
    let bestMove = null, bestFleeScore = -1;
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = piece.col + dc, nr = piece.row + dr;
      if (!inBounds(nc, nr, bounds)) continue;
      if (aiPlayer.pieces.some(p => p.alive && p !== piece && p.col === nc && p.row === nr)) continue;
      const dist = Math.abs(nc - mem.col) + Math.abs(nr - mem.row);
      const atkAfterMove = aiScoreMove(brain, piece, nc, nr, room);
      const fleeScore = dist * 15 + atkAfterMove;
      if (fleeScore > bestFleeScore) {
        bestFleeScore = fleeScore;
        bestMove = { col: nc, row: nr };
      }
    }

    // 반격 우선 판단 — 상대 유닛 위치를 추론하고 격파 가능하면 반격
    const criticalHp = piece.hp <= 2;
    // 상대 위치 추론: probMap에서 가장 높은 셀이 공격 범위 내인지
    let canHitProbTarget = false;
    let probTargetScore = 0;
    let sureHit = false;  // 9점 셀 (확정에 가까운 적 위치) 공격 가능 여부
    const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState });
    for (const c of atkCells) {
      const v = brain.probMap[c.row]?.[c.col] || 0;
      if (v >= 9) sureHit = true;
      if (v >= 6) { canHitProbTarget = true; probTargetScore += v; }
    }
    // 확정 격파 가능 (probMap=9 셀 공격 가능)이면 HP 위험 무시하고 공격 — 적의 사망이 더 가치 있음
    const shouldCounterAttack = sureHit || (
      !criticalHp && (
        canHitProbTarget ||
        (counterAttackScore > bestFleeScore * 1.05 && counterAttackScore > 4)
      )
    );

    if (shouldCounterAttack) {
      aiExecuteAttack(room, { piece, pieceIdx: flee.pieceIdx, score: counterAttackScore, extra: counterExtra });
      return;
    }
    if (bestMove) {
      aiExecuteMove(room, { piece, pieceIdx: flee.pieceIdx, col: bestMove.col, row: bestMove.row });
      return;
    }
  }

  // ★ STEP 3: 행동 대체 스킬 사용 (manhunter 덫, witch 저주, sulfurCauldron 유황범람)
  // 적극적 사용: 명백한 이득이 있으면 즉시 시전.
  if (!aiPlayer.actionDone) {
    for (const piece of alivePieces) {
      if (!piece.hasSkill || !piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
      if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
      const pidx = aiPlayer.pieces.indexOf(piece);

      if (piece.type === 'manhunter') {
        // 덫 설치 — 자기 자리에. 적이 가까이 있으면 더 적극적
        const nearestEnemyDist = Math.min(...room.players[0].pieces.filter(p => p.alive && p.col != null)
          .map(e => Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row)));
        const prob = nearestEnemyDist <= 3 ? 0.7 : 0.4;
        // 같은 자리에 이미 덫이 있으면 X
        const hasTrap = (room.boardObjects[1] || []).some(o => o.type === 'trap' && o.col === piece.col && o.row === piece.row);
        if (!hasTrap && Math.random() < prob) {
          aiExecSkill(room, pidx, 'trap');
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'witch') {
        // 저주: 스킬 보유자/고HP 대상 우선. 수도승은 가호 패시브로 0.5 받으니 일단 제외.
        const enemies = room.players[0].pieces.filter(p => p.alive && p.hp > 1 &&
          !p.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow') &&
          p.type !== 'monk');
        if (enemies.length > 0) {
          // 우선순위: 스킬 보유 > HP 높음 > 티어 높음
          enemies.sort((a, b) =>
            (b.hasSkill ? 1 : 0) - (a.hasSkill ? 1 : 0) ||
            b.hp - a.hp ||
            (b.tier || 0) - (a.tier || 0)
          );
          const target = enemies[0];
          const tIdx = room.players[0].pieces.indexOf(target);
          aiExecSkill(room, pidx, 'curse', { targetPieceIdx: tIdx });
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'sulfurCauldron' && (room.sp[1] + room.instantSp[1]) >= piece.skillCost) {
        // 보드 외곽에 적 있을 확률 높거나, 외곽이 좁아져 적이 외곽으로 몰릴 때
        const borderCells = getBorderCells(bounds);
        let borderScore = 0;
        for (const c of borderCells) borderScore += brain.probMap[c.row]?.[c.col] || 0;
        // 외곽에 실제로 보이는 적이 있는지도 체크 (확실한 가치)
        const visibleBorderEnemies = room.players[0].pieces.filter(p => p.alive && p.col != null &&
          (p.col === bounds.min || p.col === bounds.max || p.row === bounds.min || p.row === bounds.max)
        ).length;
        if (visibleBorderEnemies >= 1 || borderScore >= 12) {
          aiExecSkill(room, pidx, 'sulfurRiver');
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'twins_elder' || piece.type === 'twins_younger') {
        // 분신: 거의 안 쓰는 게 좋음 — HP 한쪽이 매우 낮을 때만 합류
        const elder = aiPlayer.pieces.find(p => p.subUnit === 'elder' && p.alive);
        const younger = aiPlayer.pieces.find(p => p.subUnit === 'younger' && p.alive);
        if (elder && younger && Math.min(elder.hp, younger.hp) <= 1 && Math.random() < 0.3) {
          // 약한 쪽이 강한 쪽 위치로 합류
          const moverSub = elder.hp < younger.hp ? 'elder' : 'younger';
          aiExecSkill(room, pidx, 'brothers', { target: moverSub });
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
    }
  }

  // ★ STEP 4: 일반 공격 vs 이동 판단
  // #5: 쌍검무 활성화 유닛이 있으면 "공격만" 허용 — 이동 고려 안 함
  const dualPiece = alivePieces.find(p => p.dualBladeAttacksLeft > 0);
  let bestAction = null;

  if (dualPiece) {
    // 쌍검무 활성 — 해당 양손검객이 반드시 공격해야 함
    const pieceIdx = aiPlayer.pieces.indexOf(dualPiece);
    let extra = {};
    if (dualPiece.toggleState) extra.toggleState = dualPiece.toggleState;
    const atkScore = aiScoreAttack(brain, dualPiece, room, extra);
    bestAction = { type: 'attack', piece: dualPiece, pieceIdx, score: atkScore, extra };
  } else {
    for (const piece of alivePieces) {
      const pieceIdx = aiPlayer.pieces.indexOf(piece);
      let extra = {};
      if (piece.type === 'ratMerchant') extra.rats = room.rats[1];
      if (piece.toggleState) extra.toggleState = piece.toggleState;

      // Attack score
      let atkExtra = { ...extra };
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
        const bt = aiBestTargetCell(brain, piece, room);
        atkExtra.tCol = bt.col;
        atkExtra.tRow = bt.row;
      }
      const atkScore = aiScoreAttack(brain, piece, room, atkExtra);
      if (!bestAction || atkScore > bestAction.score) {
        bestAction = { type: 'attack', piece, pieceIdx, score: atkScore, extra: atkExtra };
      }

      // Move score (일반 이동 — 도망이 아닌 전략적 이동)
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        const moveScore = aiScoreMove(brain, piece, nc, nr, room) * 0.7;
        if (!bestAction || moveScore > bestAction.score) {
          bestAction = { type: 'move', piece, pieceIdx, score: moveScore, col: nc, row: nr };
        }
      }
    }
  }

  if (!bestAction) {
    aiPlayer.actionDone = true;
    aiEndTurn(room);
    return;
  }

  if (bestAction.type === 'move') {
    aiExecuteMove(room, bestAction);
  } else {
    aiExecuteAttack(room, bestAction);
  }
}

function aiExecuteMove(room, action) {
  const aiPlayer = room.players[1];
  const piece = action.piece;
  const prevCol = piece.col, prevRow = piece.row;

  piece.col = action.col;
  piece.row = action.row;

  // Check trap
  const trapIdx = room.boardObjects[0].findIndex(o => o.type === 'trap' && o.col === action.col && o.row === action.row);
  if (trapIdx >= 0) {
    room.boardObjects[0].splice(trapIdx, 1);
    const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: action.col, row: action.row }, piece, 0, 2, false);
    piece.hp = Math.max(0, piece.hp - dmg);
    // Wizard passive: AI 마법사가 덫을 밟아 피격되어도 인스턴트 SP 1 획득
    if (piece.type === 'wizard' && dmg > 0) {
      const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, 1) : 1;
      room.instantSp[wizSpSlot] += 1;
      emitSPUpdate(room);
      emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: 1, msg: `🧙 인스턴트 매직 : SP 획득` });

      emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: 1 });

    }
    const willDie3 = piece.hp <= 0;
    if (willDie3) {
      handleDeath(room, piece, 1);
      setKillInfo(room, 'trap', null, [{ name: piece.name }]);
    }
    emitToBoth(room, 'trap_triggered', {
      col: action.col, row: action.row,
      pieceInfo: { type: piece.type, name: piece.name, icon: piece.icon },
      damage: dmg,
      destroyed: willDie3,
      newHp: piece.hp,
      victimOwnerIdx: 1,
    });
  }

  emitToPlayer(room, 0, 'opp_moved', { msg: `${room.players[1].name}${조사(room.players[1].name, '이', '가')} 이동했습니다.`, prevCol, prevRow, col: action.col, row: action.row });
  emitToSpectators(room, 'spectator_log', { msg: `${piece.icon}${piece.name} 이동`, type: 'move', playerIdx: 1 });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  aiTrackToast(room, 'move');
  aiPlayer.actionDone = true;
  aiEndTurn(room);
}

function aiExecuteAttack(room, action) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const piece = action.piece;
  const bounds = room.boardBounds;

  // ★ 사망 기폭 페이즈 시작 — 학살영웅 등으로 화약상이 죽으면 큐에 push.
  startPhase(room);

  const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, action.extra);
  const hitResults = processAttack(room, 1, piece, atkCells);

  aiProcessAttackResult(brain, atkCells, hitResults);

  emitToPlayer(room, 0, 'being_attacked', {
    atkCells,
    hitPieces: hitResults.map(h => {
      // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
      const dp = (typeof h.defPieceIdx === 'number') ? humanPlayer.pieces[h.defPieceIdx] : null;
      return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
        name: dp?.name, icon: dp?.icon, defPieceIdx: h.defPieceIdx,
        redirectedToBodyguard: h.redirectedToBodyguard || false,
        bodyguardRedirect: h.bodyguardRedirect || false };
    }),
    yourPieces: pieceSummary(humanPlayer.pieces),
  });
  // ★ 관전자 일반 공격 애니 (1v1 AI 공격) — defOwnerIdx 0 (인간 = p0)
  emitToSpectators(room, 'spectator_attack_anim', {
    atkCells,
    hits: hitResults.map(h => ({
      col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
      defPieceIdx: h.defPieceIdx, defOwnerIdx: 0,
      redirectedToBodyguard: h.redirectedToBodyguard || false,
      bodyguardRedirect: h.bodyguardRedirect || false,
    })),
  });
  // 관전자에게 공격 결과 전송
  if (hitResults.length > 0) {
    for (const h of hitResults) {
      const dp = humanPlayer.pieces.find(p => p.col === h.col && p.row === h.row);
      const targetName = dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row);
      emitToSpectators(room, 'spectator_log', { msg: h.destroyed
        ? `⚔ AI의 ${piece.icon}${piece.name}! ${targetName} 격파함 💀`
        : `⚔ AI의 ${piece.icon}${piece.name}! ${targetName}에 ${h.damage} 피해`, type: 'hit', playerIdx: 1 });
    }
  } else {
    emitToSpectators(room, 'spectator_log', { msg: `AI 공격 빗나감`, type: 'miss', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  aiTrackToast(room, 'attack');

  // ★ 게임종료 검사 — 사망 기폭 페이즈가 deferred 면 callback 으로 지연.
  //   simultaneous_draw 케이스도 checkGameEndAfterPhase 가 처리.
  //   dualBlade 후속 공격은 setTimeout(4000ms) 라 페이즈 끝난 뒤 실행됨 (room.phase 자체 체크).
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') {
      checkGameEndAfterPhase(room);
    }
  });

  // ★ 공격 후 dualBlade 추가 공격 (4초 대기 — 클라이언트 애니메이션 + 인지 시간 포함)
  if (piece.dualBladeAttacksLeft > 0) {
    const DUAL_BLADE_DELAY = 4000;
    setTimeout(() => {
      if (room.phase !== 'game') return;
      if (!piece.alive) { aiPlayer.actionDone = true; aiEndTurn(room); return; }
      piece.dualBladeAttacksLeft--;
      const extraCells = getAttackCells(piece.type, piece.col, piece.row, bounds);
      const extraHits = processAttack(room, 1, piece, extraCells);
      aiProcessAttackResult(brain, extraCells, extraHits);
      emitToPlayer(room, 0, 'being_attacked', {
        atkCells: extraCells,
        hitPieces: extraHits.map(h => {
          const dp = (typeof h.defPieceIdx === 'number') ? humanPlayer.pieces[h.defPieceIdx] : null;
          return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            name: dp?.name, icon: dp?.icon, defPieceIdx: h.defPieceIdx,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false };
        }),
        yourPieces: pieceSummary(humanPlayer.pieces),
      });
      // ★ 관전자 — 쌍검무 두 번째 공격 (1v1 AI). defOwnerIdx 0
      emitToSpectators(room, 'spectator_attack_anim', {
        atkCells: extraCells,
        hits: extraHits.map(h => ({
          col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          defPieceIdx: h.defPieceIdx, defOwnerIdx: 0,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false,
        })),
      });
      if (hitResults.length > 0 || extraHits.length > 0) {
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
      }
      if (checkWin(room, 0)) { endGame(room, 1); return; }
      aiPlayer.actionDone = true;
      aiEndTurn(room);
    }, DUAL_BLADE_DELAY);
    return;  // setTimeout 콜백에서 턴 종료 처리
  }

  aiPlayer.actionDone = true;
  aiEndTurn(room);
}

// ══════════════════════════════════════════════════════════════════
// ── Socket Events ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {

  // 소켓 이벤트 안전 래퍼 (에러 시 서버 크래시 방지)
  const _on = socket.on.bind(socket);
  socket.on = (event, handler) => {
    _on(event, (...args) => {
      try { handler(...args); }
      catch (err) { console.error(`[Socket Error] ${event}:`, err.message, err.stack); }
    });
  };

  // ── 캐릭터 데이터 요청 (덱빌더용) ──
  socket.on('request_characters', () => {
    socket.emit('characters_data', { characters: CHARACTERS });
  });

  // ── #9: 재접속 (새로고침/연결 끊김 복구) ──
  // 새로고침 = 현재 페이즈 복원 (로비 이동 아님). 각 단계별로 해당 페이즈의 phase 이벤트 재전송.
  socket.on('reconnect_game', ({ roomId, sessionToken }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('reconnect_failed', { reason: 'room_not_found' }); return; }
    const player = room.players.find(p => p.sessionToken === sessionToken);
    if (!player) { socket.emit('reconnect_failed', { reason: 'token_mismatch' }); return; }
    if (room.phase === 'ended') { socket.emit('reconnect_failed', { reason: 'game_ended' }); return; }
    // 유예 타이머 취소
    if (player._disconnectTimer) {
      clearTimeout(player._disconnectTimer);
      player._disconnectTimer = null;
    }
    // 소켓 재할당
    player.socketId = socket.id;
    socket.data.roomId = roomId;
    socket.data.idx = player.index;
    socket.data.sessionToken = sessionToken;
    socket.join(roomId);

    const idx = player.index;
    const phase = room.phase;

    // ── 페이즈별 상태 재전송 ──
    if (phase === 'game') {
      if (room.mode === 'team') {
        const state = getTeamGameStateFor(room, idx);
        socket.emit('team_game_start', { ...state, teams: room.teams, reconnected: true });
      } else {
        const opp = room.players[1 - idx];
        socket.emit('game_start', {
          yourPieces: pieceSummary(player.pieces),
          oppPieces: oppPieceSummary(opp.pieces),
          currentPlayerIdx: room.currentPlayerIdx,
          turnNumber: room.turnNumber,
          isYourTurn: room.currentPlayerIdx === idx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillPoints: room.sp,
          boardBounds: room.boardBounds,
          boardObjects: boardObjectsSummary(room, idx),
          reconnected: true,
        });
      }
    } else if (phase === 'waiting') {
      if (room.mode === 'team') {
        socket.emit('team_room_state', { players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId })), teams: room.teams });
      } else {
        socket.emit('joined', { idx, roomId, characters: CHARACTERS, sessionToken, reconnected: true });
      }
    } else if (phase === 'team_draft') {
      socket.emit('team_draft_start', {
        myIdx: idx, teamId: player.teamId,
        players: room.players.map(pl => ({ name: pl.name, idx: pl.index, teamId: pl.teamId })),
        teams: room.teams, characters: CHARACTERS,
      });
      // 이미 골랐던 픽 복원
      if (player.draft) {
        socket.emit('team_draft_pick_update', { idx, draft: player.draft });
      }
    } else if (phase === 'team_hp') {
      const teammates = getTeammates(room, idx);
      const teammateDraft = teammates[0] != null ? room.players[teammates[0]].draft : null;
      socket.emit('team_hp_phase', {
        draft: player.draft,
        hasTwins: player.draft?.pick1 === 'twins' || player.draft?.pick2 === 'twins',
        teammateDraft,
      });
    } else if (phase === 'team_reveal') {
      const allPlayerPieces = room.players.map(p => ({
        idx: p.index, name: p.name, teamId: p.teamId,
        pieces: p.pieces.map(pc => ({
          type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
          hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag, desc: pc.desc,
          subUnit: pc.subUnit, hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
          passiveName: pc.passiveName, passives: pc.passives,
        })),
      }));
      socket.emit('team_reveal_phase', { myIdx: idx, teamId: player.teamId, teams: room.teams, allPlayerPieces });
    } else if (phase === 'team_placement') {
      const oppTeamId = 1 - player.teamId;
      const opponents = (room.teams[oppTeamId] || []).map(i => ({
        idx: i, name: room.players[i].name,
        pieces: room.players[i].pieces.map(pc => ({
          type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
          hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag, desc: pc.desc, subUnit: pc.subUnit,
          hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
          passiveName: pc.passiveName, passives: pc.passives,
        })),
      }));
      socket.emit('team_placement_phase', {
        myIdx: idx, teamId: player.teamId, teams: room.teams,
        boardBounds: room.boardBounds, zone: getTeamPlacementZone(player.teamId),
        myPieces: pieceSummary(player.pieces),
        teammates: getTeammates(room, idx).map(i => ({ idx: i, name: room.players[i].name, pieces: pieceSummary(room.players[i].pieces) })),
        opponents,
      });
    } else if (phase === 'initial_reveal') {
      const oppDraft = room.players[1 - idx].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      socket.emit('initial_reveal_phase', { myDraft: player.draft, oppChars });
    } else if (phase === 'exchange_draft') {
      const available = {};
      for (const tier of [1, 2, 3]) {
        const myType = tier === 1 ? player.draft.t1 : tier === 2 ? player.draft.t2 : player.draft.t3;
        available[tier] = CHARACTERS[tier]
          .filter(c => c.type !== myType)
          .map(c => ({ type: c.type, name: c.name, icon: c.icon, desc: c.desc, tag: c.tag, atk: c.atk, range: c.range }));
      }
      socket.emit('exchange_draft_phase', {
        myDraft: player.draft, available, oppDraft: room.players[1 - idx].draft,
      });
    } else if (phase === 'final_reveal') {
      const oppDraft = room.players[1 - idx].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      socket.emit('final_reveal_phase', { myDraft: player.draft, oppChars });
    } else if (phase === 'hp_distribution') {
      socket.emit('hp_phase', { draft: player.draft, hasTwins: player.draft.t1 === 'twins' });
    } else if (phase === 'reveal') {
      const oppPieces = room.players[1 - idx].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      socket.emit('reveal_phase', { yourPieces: pieceSummary(player.pieces), oppPieces });
    } else if (phase === 'placement') {
      const oppPieces = room.players[1 - idx].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      socket.emit('placement_phase', { pieces: pieceSummary(player.pieces), oppPieces });
    } else {
      // 그 외(드래프트 단일 단계 등) — 기본 resume 이벤트만
      socket.emit('reconnect_phase_resume', { phase, idx });
    }
    socket.emit('reconnect_ok', { idx, phase });
  });

  // ── 방 입장 ──
  socket.on('join_room', ({ roomId, playerName, deck }) => {
    if (rooms[roomId] && rooms[roomId].phase === 'ended') {
      delete rooms[roomId];
    }
    if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];

    // 이 방이 팀전 방이면 join_team_room 흐름으로 자동 전환 — 게임 진행 중/만석은 관전자
    if (room.mode === 'team') {
      const teamFull = room.players.length >= 4;
      const teamInProgress = room.phase !== 'waiting';
      if (teamInProgress || teamFull) {
        // 관전자로 입장
        room.spectators = room.spectators || [];
        room.spectators.push({ socketId: socket.id, name: playerName });
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.isSpectator = true;
        socket.emit('team_spectator_joined', {
          roomId,
          phase: room.phase,
          gameState: room.phase === 'game' ? getTeamSpectatorGameState(room) : null,
          characters: CHARACTERS,
          players: room.players.map(p => ({ idx: p.index, name: p.name, teamId: p.teamId })),
          teams: room.teams,
        });
        return;
      }
      socket.emit('team_room_redirect', { roomId, playerName });
      return;
    }

    if (room.players.length >= 2 || room.phase !== 'waiting') {
      // 관전자로 입장
      room.spectators = room.spectators || [];
      room.spectators.push({ socketId: socket.id, name: playerName });
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.isSpectator = true;
      // 현재 페이즈별 스냅샷 전달
      let draftState = null, hpState = null, placementState = null;
      if (room.phase === 'draft' || room.phase === 'hp' || room.phase === 'reveal' || room.phase === 'placement' || room.phase === 'game') {
        draftState = {
          p0: room.players[0]?.draft || null,
          p1: room.players[1]?.draft || null,
          draftDone: [...(room.draftDone || [false, false])],
        };
      }
      if (room.phase === 'hp' || room.phase === 'reveal' || room.phase === 'placement' || room.phase === 'game') {
        hpState = {
          p0Pieces: room.players[0]?.pieces ? pieceSummary(room.players[0].pieces) : [],
          p1Pieces: room.players[1]?.pieces ? pieceSummary(room.players[1].pieces) : [],
          hpDone: [...(room.hpDone || [false, false])],
        };
      }
      if (room.phase === 'placement') {
        placementState = {
          p0Pieces: pieceSummary(room.players[0].pieces),
          p1Pieces: pieceSummary(room.players[1].pieces),
          boardBounds: room.boardBounds,
        };
      }
      socket.emit('spectator_joined', {
        roomId,
        phase: room.phase,
        gameState: room.phase === 'game' ? getSpectatorGameState(room) : null,
        draftState,
        hpState,
        placementState,
        characters: CHARACTERS,
        p0Name: room.players[0]?.name || '?',
        p1Name: room.players[1]?.name || '?',
      });
      return;
    }

    const idx = room.players.length;
    const playerDraft = validateDeck(deck);
    const deckName = (deck && typeof deck.deckName === 'string') ? deck.deckName.slice(0, 16) : '';
    const sessionToken = genSessionToken();
    room.players.push({
      socketId: socket.id, name: playerName, index: idx,
      pieces: [], draft: playerDraft, hpDist: null,
      deckName,  // 캐릭터 공개 등에서 닉네임 아래 표시용
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      sessionToken,  // #9: 재접속용
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = idx;
    socket.data.sessionToken = sessionToken;
    room.draftDone[idx] = true;

    socket.emit('joined', { idx, roomId, playerName, characters: CHARACTERS, sessionToken });

    if (room.players.length === 2) {
      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('opponent_joined', { opponentName: room.players[1 - i].name });
      });
      // 드래프트 건너뛰기 → 바로 초기 공개
      transitionToInitialReveal(room);
    } else {
      socket.emit('waiting', {});
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ── 팀전 (2v2) 대기실 ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  socket.on('join_team_room', ({ roomId, playerName }) => {
    if (rooms[roomId] && rooms[roomId].phase === 'ended') {
      delete rooms[roomId];
    }
    if (!rooms[roomId]) {
      rooms[roomId] = createRoom(roomId, { mode: 'team' });
    }
    const room = rooms[roomId];
    if (room.mode !== 'team') {
      socket.emit('err', { msg: '이미 1대1 전용 방입니다.' });
      return;
    }
    if (room.phase !== 'waiting') {
      socket.emit('err', { msg: '이미 게임이 시작된 방입니다.' });
      return;
    }
    // 방이 꽉 찼는데 AI 봇이 있으면 — 사람이 자리를 가져갈 수 있도록 봇 하나 자동 퇴장
    if (room.players.length >= 4) {
      const botIdx = room.players.findIndex(p => p.socketId === 'AI');
      if (botIdx >= 0) {
        // 봇 제거 + 팀/인덱스 재정렬
        room.players.splice(botIdx, 1);
        for (let t = 0; t < 2; t++) {
          room.teams[t] = room.teams[t].filter(i => i !== botIdx).map(i => i > botIdx ? i - 1 : i);
        }
        room.players.forEach((p, i) => { p.index = i; });
      } else {
        socket.emit('err', { msg: '방이 가득 찼습니다. 4/4' });
        return;
      }
    }
    const idx = room.players.length;
    const sessionToken = genSessionToken();
    room.players.push({
      socketId: socket.id, name: playerName, index: idx,
      pieces: [], draft: null, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: null,  // 배정 후 채워짐
      sessionToken,  // #9: 재접속용
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = idx;
    socket.data.sessionToken = sessionToken;
    socket.data.isTeamMode = true;

    // 팀 자동 배정 — A팀이 덜 찼으면 A, 아니면 B. 자리는 첫 빈 슬롯.
    const teamACount = room.teams[0].length;
    const teamBCount = room.teams[1].length;
    const targetTeam = teamACount <= teamBCount ? 0 : 1;
    const usedPos = new Set(room.teams[targetTeam].map(i => room.players[i]?.slotPos));
    const slotPos = !usedPos.has(0) ? 0 : (!usedPos.has(1) ? 1 : 0);
    room.teams[targetTeam].push(idx);
    room.players[idx].teamId = targetTeam;
    room.players[idx].slotPos = slotPos;

    socket.emit('team_joined', { idx, roomId, playerName, sessionToken });
    broadcastTeamRoomState(room);
  });

  // 팀 변경 요청 — targetPos가 비어있으면 그 자리로, 아니면 거절
  socket.on('team_change', ({ targetTeam, targetPos }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    const idx = socket.data.idx;
    if (idx === undefined) return;
    if (targetTeam !== 0 && targetTeam !== 1) return;
    const wantPos = (targetPos === 0 || targetPos === 1) ? targetPos : null;
    // 같은 팀 내 같은 자리면 무시
    if (room.players[idx].teamId === targetTeam && room.players[idx].slotPos === wantPos) return;
    // 현재 팀에서 제거
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== idx);
    }
    // 가용 자리 검사
    const occupiedSlots = new Set(room.teams[targetTeam].map(i => room.players[i]?.slotPos));
    let assignedPos = wantPos;
    if (assignedPos == null || occupiedSlots.has(assignedPos)) {
      // wantPos가 비지 않았거나 미지정 → 첫 빈 자리 할당
      assignedPos = !occupiedSlots.has(0) ? 0 : (!occupiedSlots.has(1) ? 1 : null);
    }
    if (assignedPos == null) {
      // 양 자리 다 차있음 → 원복
      const original = room.players[idx].teamId;
      room.teams[original].push(idx);
      socket.emit('err', { msg: '해당 팀이 이미 가득 찼습니다.' });
      broadcastTeamRoomState(room);
      return;
    }
    room.teams[targetTeam].push(idx);
    room.players[idx].teamId = targetTeam;
    room.players[idx].slotPos = assignedPos;
    broadcastTeamRoomState(room);
  });

  // AI 봇 추가 — 빈 슬롯에 AI 플레이어 삽입 (혼자/소수 인원으로 4인 팀전 즐길 수 있게)
  socket.on('team_add_bot', ({ targetTeam, targetPos } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (room.players.length >= 4) {
      socket.emit('err', { msg: '방이 가득 찼습니다.' });
      return;
    }
    // 어느 슬롯에 넣을지 결정 (지정 우선, 없으면 자동 균형)
    let team, pos;
    if (targetTeam === 0 || targetTeam === 1) {
      team = targetTeam;
      const occupied = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = (targetPos === 0 || targetPos === 1) && !occupied.has(targetPos)
        ? targetPos
        : (!occupied.has(0) ? 0 : (!occupied.has(1) ? 1 : null));
      if (pos == null) {
        socket.emit('err', { msg: '해당 팀에 빈 자리가 없습니다.' });
        return;
      }
    } else {
      team = (room.teams[0].length <= room.teams[1].length) ? 0 : 1;
      const occupied = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = !occupied.has(0) ? 0 : (!occupied.has(1) ? 1 : null);
      if (pos == null) team = 1 - team;
      const occupied2 = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = !occupied2.has(0) ? 0 : (!occupied2.has(1) ? 1 : null);
      if (pos == null) {
        socket.emit('err', { msg: '빈 자리가 없습니다.' });
        return;
      }
    }
    const idx = room.players.length;
    // 봇 이름 부여 — 팀 색상 + 슬롯 번호 (예: "블루봇 MK-1", "레드봇 MK-2")
    const teamLabel = team === 0 ? '블루봇' : '레드봇';
    const botName = `${teamLabel} MK-${pos + 1}`;
    room.players.push({
      socketId: 'AI', name: botName, index: idx,
      pieces: [], draft: null, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: team, slotPos: pos,
    });
    room.teams[team].push(idx);
    if (!room.aiBrain) room.aiBrain = initAiBrain();
    broadcastTeamRoomState(room);
  });

  // AI 봇 제거 — 빈 슬롯에 다른 사람을 들이고 싶을 때
  socket.on('team_remove_bot', ({ targetTeam, targetPos } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (targetTeam !== 0 && targetTeam !== 1) return;
    const ti = (room.teams[targetTeam] || []).find(i =>
      room.players[i]?.socketId === 'AI' && room.players[i]?.slotPos === targetPos
    );
    if (ti === undefined) return;
    // 제거 + 인덱스 재정렬
    room.players.splice(ti, 1);
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== ti).map(i => i > ti ? i - 1 : i);
    }
    room.players.forEach((p, i) => { p.index = i; });
    broadcastTeamRoomState(room);
  });

  // 대기실 나가기
  socket.on('team_leave', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    const idx = socket.data.idx;
    if (idx === undefined) return;
    // 제거
    room.players.splice(idx, 1);
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
    }
    // 인덱스 재조정
    room.players.forEach((p, i) => {
      p.index = i;
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.data.idx = i;
      }
    });
    socket.leave(room.id);
    socket.data.roomId = null;
    socket.data.idx = undefined;
    socket.emit('team_left');
    if (room.players.length === 0) {
      delete rooms[room.id];
    } else {
      broadcastTeamRoomState(room);
    }
  });

  // 게임 시작 요청 (4/4일 때만)
  socket.on('team_start_request', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (room.players.length < 4) {
      socket.emit('err', { msg: '4명이 모여야 시작할 수 있습니다.' });
      return;
    }
    if (room.teams[0].length !== 2 || room.teams[1].length !== 2) {
      socket.emit('err', { msg: '각 팀에 2명씩 배정해야 합니다.' });
      return;
    }
    // 3초 카운트다운 방송
    io.to(room.id).emit('team_countdown', { seconds: 3 });
    room._teamStartTimeout = setTimeout(() => {
      if (room.phase !== 'waiting') return;  // 이미 취소됨
      io.to(room.id).emit('team_start_ready', {
        players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId })),
        teams: room.teams,
        characters: CHARACTERS,
      });
      transitionToTeamDraft(room);
    }, 3000);
  });

  // ── 팀전 드래프트 ──
  // 각자 2개 캐릭터 선택 (티어 구분 없음, 팀원 중복 불가)
  // 팀전 드래프트 — 2픽 슬롯 (티어 무관). slot = 'pick1' | 'pick2'
  socket.on('team_draft_pick', ({ slot, type }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_draft') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.draftDone[idx]) return;
    if (slot !== 'pick1' && slot !== 'pick2') return;
    if (type !== null) {
      if (!ALL_CHARS.find(c => c.type === type)) {
        socket.emit('err', { msg: '잘못된 선택입니다.' }); return;
      }
      // 팀원이 이미 선택한 캐릭터 금지
      const teammates = getTeammates(room, idx);
      for (const tIdx of teammates) {
        const tmDraft = room.players[tIdx]?.draft || {};
        if (tmDraft.pick1 === type || tmDraft.pick2 === type) {
          socket.emit('err', { msg: '팀원이 이미 선택한 캐릭터입니다.' }); return;
        }
      }
      // 자기 다른 슬롯과 중복 방지
      const otherSlot = slot === 'pick1' ? 'pick2' : 'pick1';
      if (player.draft?.[otherSlot] === type) {
        socket.emit('err', { msg: '같은 캐릭터를 2번 선택할 수 없습니다.' }); return;
      }
    }
    if (!player.draft) player.draft = { pick1: null, pick2: null };
    player.draft[slot] = type;
    const myTeam = player.teamId;
    const teamMembers = room.teams[myTeam] || [];
    const teamDrafts = teamMembers.map(i => ({
      idx: i,
      name: room.players[i]?.name,
      draft: {
        pick1: room.players[i]?.draft?.pick1 || null,
        pick2: room.players[i]?.draft?.pick2 || null,
      },
      confirmed: !!room.draftDone[i],
    }));
    for (const tIdx of teamMembers) {
      const tp = room.players[tIdx];
      if (!tp || !tp.socketId) continue;
      io.to(tp.socketId).emit('team_draft_pick_update', { playerIdx: idx, slot, type, teamDrafts });
    }
  });

  socket.on('team_draft_confirm', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_draft') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.draftDone[idx]) return;
    const { pick1, pick2 } = player.draft || {};
    if (!pick1 || !pick2) {
      socket.emit('err', { msg: '2개 캐릭터를 모두 선택해주세요.' }); return;
    }
    if (pick1 === pick2) {
      socket.emit('err', { msg: '같은 캐릭터를 2번 선택할 수 없습니다.' }); return;
    }
    // 팀원과 중복 검사
    const teammates = getTeammates(room, idx);
    for (const tIdx of teammates) {
      const tmDraft = room.players[tIdx]?.draft || {};
      if (tmDraft.pick1 === pick1 || tmDraft.pick2 === pick1 ||
          tmDraft.pick1 === pick2 || tmDraft.pick2 === pick2) {
        socket.emit('err', { msg: '팀원과 겹치는 캐릭터가 있습니다.' }); return;
      }
    }
    room.draftDone[idx] = true;
    socket.emit('team_draft_confirmed', { pick1, pick2 });
    io.to(room.id).emit('team_draft_status', {
      draftDone: [...room.draftDone],
      doneNames: room.players.filter((_, i) => room.draftDone[i]).map(p => p.name),
    });
    if (room.draftDone.every(done => done)) {
      transitionToTeamHp(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 선택을 기다리는 중...' });
    }
  });

  // 팀전 HP 실시간 브라우징 — 팀원에게 내 현재 분배 값 공유
  socket.on('team_hp_browse', ({ hps }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_hp') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const teamMembers = room.teams[room.players[idx].teamId] || [];
    for (const tIdx of teamMembers) {
      if (tIdx === idx) continue;
      const tp = room.players[tIdx];
      if (tp && tp.socketId) {
        io.to(tp.socketId).emit('team_hp_browse', { playerIdx: idx, hps });
      }
    }
  });

  // ── 팀전 HP 분배 — 2픽 포맷 ──
  // hps = [pick1Hp, pick2Hp] 합계 10, 각 최소 1
  // 쌍둥이 포함 시: 해당 pick 슬롯은 최소 2 + twinSplit=[elder,younger]
  socket.on('team_hp_distribute', ({ hps, twinSplit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_hp') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.hpDone[idx]) return;
    const draft = player.draft || {};
    if (!draft.pick1 || !draft.pick2) {
      socket.emit('err', { msg: '드래프트가 완료되지 않았습니다.' }); return;
    }
    const hasTwins = draft.pick1 === 'twins' || draft.pick2 === 'twins';
    const twinSlot = draft.pick1 === 'twins' ? 'pick1' : draft.pick2 === 'twins' ? 'pick2' : null;

    // twin split 단계
    if (twinSplit && hasTwins && player.hpDist) {
      const twinSlotHp = player.hpDist[twinSlot];
      if (!Array.isArray(twinSplit) || twinSplit.length !== 2 ||
          twinSplit[0] < 1 || twinSplit[1] < 1 ||
          twinSplit[0] + twinSplit[1] !== twinSlotHp) {
        socket.emit('err', { msg: `쌍둥이 HP 합계는 ${twinSlotHp}, 각 최소 1이어야 합니다.` }); return;
      }
      player.hpDist = { ...player.hpDist, twinElder: twinSplit[0], twinYounger: twinSplit[1] };
      player.pieces = buildTeamPieces(draft, player.hpDist);
      player.twinSplitDone = true;
      room.hpDone[idx] = true;
      socket.emit('hp_ok', { hps: [player.hpDist.pick1, player.hpDist.pick2], twinSplit });
      io.to(room.id).emit('team_hp_status', {
        hpDone: [...room.hpDone],
        doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p => p.name),
      });
      if (room.hpDone.every(d => d)) transitionToTeamReveal(room);
      else socket.emit('wait_msg', { msg: '다른 플레이어의 HP 분배를 기다리는 중...' });
      return;
    }

    // 일반 — hps 2개
    if (!Array.isArray(hps) || hps.length !== 2 ||
        hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 9)) {
      socket.emit('err', { msg: 'HP 합계는 10, 각 최소 1 최대 9 · 2개 필요' }); return;
    }
    if (hasTwins) {
      const twinIdx = twinSlot === 'pick1' ? 0 : 1;
      if (hps[twinIdx] < 2) { socket.emit('err', { msg: '쌍둥이는 최소 2 HP 필요합니다.' }); return; }
      player.hpDist = { pick1: hps[0], pick2: hps[1] };
      socket.emit('twin_split_needed', { twinTierHp: hps[twinIdx] });
      return;
    }
    player.hpDist = { pick1: hps[0], pick2: hps[1] };
    player.pieces = buildTeamPieces(draft, player.hpDist);
    room.hpDone[idx] = true;
    socket.emit('hp_ok', { hps });
    io.to(room.id).emit('team_hp_status', {
      hpDone: [...room.hpDone],
      doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p => p.name),
    });
    if (room.hpDone.every(d => d)) {
      transitionToTeamReveal(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 HP 분배를 기다리는 중...' });
    }
  });

  // ── 팀전 배치 ──
  socket.on('team_place_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_placement') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player) return;
    if (room.placementDone[idx]) {
      socket.emit('err', { msg: '이미 확정한 배치는 수정할 수 없습니다.' }); return;
    }
    const bounds = room.boardBounds;
    if (pieceIdx < 0 || pieceIdx >= player.pieces.length) return;
    if (!inBounds(col, row, bounds)) { socket.emit('err', { msg: '보드 밖입니다.' }); return; }
    const piece = player.pieces[pieceIdx];
    // 자기 말 중복 체크 (쌍둥이는 서로 공유 허용)
    if (piece.subUnit) {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row && !p.subUnit)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    } else {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    }
    // 팀원 말 중복 체크
    for (const tIdx of getTeammates(room, idx)) {
      const tp = room.players[tIdx];
      if (tp.pieces.some(p => p.col === col && p.row === row)) {
        socket.emit('err', { msg: '팀원의 말이 이미 있는 칸입니다.' }); return;
      }
    }
    piece.col = col; piece.row = row;
    socket.emit('team_placed_ok', { pieceIdx, col, row });
    broadcastTeamPlacementUpdate(room, idx);
    // 사용자 요청: AI 봇은 진입 즉시 자기 자리에 배치하고 그대로 유지 (인간 행동마다 wipe 금지).
    // 봇이 아직 배치되지 않은 상태(col<0)인 경우만 한 번 더 재시도 — 그 외에는 그대로 둠.
    for (const p of room.players) {
      if (p.socketId === 'AI' && !room.placementDone[p.index]) {
        const allPlaced = (p.pieces || []).every(pc => pc.col >= 0);
        if (!allPlaced) {
          // 아직 배치 안 된 piece가 남아있으면 즉시 재시도 (긴 대기 X)
          setTimeout(() => {
            if (room.phase === 'team_placement' && !room.placementDone[p.index]) {
              aiTeamPlace(room, p.index);
            }
          }, 200);
        }
      }
    }
  });

  socket.on('team_confirm_placement', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_placement') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player) return;
    if (player.pieces.some(p => p.col < 0)) {
      socket.emit('err', { msg: '모든 말을 배치하세요.' }); return;
    }
    room.placementDone[idx] = true;
    socket.emit('team_confirm_placement_ok');
    io.to(room.id).emit('team_placement_status', {
      placementDone: [...room.placementDone],
      doneNames: room.players.filter((_, i) => room.placementDone[i]).map(p => p.name),
    });
    if (room.placementDone.every(d => d)) {
      startTeamGameFromRoom(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 배치를 기다리는 중...' });
    }
  });

  // ── 팀전 공개 단계 '다음' 버튼 ──
  socket.on('team_reveal_continue', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_reveal') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    if (room.revealDone[idx]) return;
    room.revealDone[idx] = true;
    io.to(room.id).emit('team_reveal_status', { revealDone: [...room.revealDone] });
    if (room.revealDone.every(d => d)) {
      transitionToTeamPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어를 기다리는 중...' });
    }
  });

  // ── AI 연습 모드 ──
  socket.on('join_ai', ({ playerName, deck }) => {
    const roomId = `ai_${socket.id}_${Date.now()}`;
    rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    room.isAI = true;
    room.aiBrain = initAiBrain();

    // 덱 유효성 검사 후 드래프트로 사용
    const playerDraft = validateDeck(deck);

    const humanDeckName = (deck && typeof deck.deckName === 'string') ? deck.deckName.slice(0, 16) : '';
    room.players.push({
      socketId: socket.id, name: playerName, index: 0,
      pieces: [], draft: playerDraft, hpDist: null,
      deckName: humanDeckName,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = 0;

    room.players.push({
      socketId: 'AI', name: 'AI', index: 1,
      pieces: [], draft: null, hpDist: null,
      deckName: aiGenerateDeckName(null),  // AI 덱 이름 — 드래프트 후 다시 갱신
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });

    socket.emit('joined', { idx: 0, roomId, playerName, characters: CHARACTERS });
    socket.emit('opponent_joined', { opponentName: 'AI' });

    const aiDraft = aiSelectPieces();
    room.players[1].draft = aiDraft;
    room.players[1].deckName = aiGenerateDeckName(aiDraft);
    room.draftDone[0] = true;
    room.draftDone[1] = true;

    // 드래프트 건너뛰기 → 바로 초기 공개
    transitionToInitialReveal(room);
  });

  // ── 드래프트 실시간 브라우징 (관전자용) ──
  socket.on('draft_browse', ({ step, type, selected }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'draft') return;
    const idx = socket.data.idx;
    // 부분 선택 저장 (스마트 타임아웃용)
    if (selected) room.players[idx]._browseDraft = selected;
    emitToSpectators(room, 'spectator_draft_browse', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      step, type, selected,
    });
  });

  // ── HP 실시간 조정 (관전자용) ──
  socket.on('hp_browse', ({ hps }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'hp_distribution') return;
    const idx = socket.data.idx;
    emitToSpectators(room, 'spectator_hp_browse', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      draft: room.players[idx].draft,
      hps,
    });
  });

  // ── 드래프트 선택 ──
  socket.on('select_pieces', ({ t1, t2, t3 }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'draft') return;
    const idx = socket.data.idx;

    if (!CHARACTERS[1].find(c => c.type === t1) ||
        !CHARACTERS[2].find(c => c.type === t2) ||
        !CHARACTERS[3].find(c => c.type === t3)) {
      socket.emit('err', { msg: '잘못된 선택입니다.' }); return;
    }

    room.players[idx].draft = { t1, t2, t3 };
    room.draftDone[idx] = true;
    socket.emit('draft_ok', { t1, t2, t3 });
    // 관전자에게 드래프트 슬롯 업데이트
    emitToSpectators(room, 'spectator_draft_update', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      draft: { t1, t2, t3 },
      draftDone: [...room.draftDone],
    });

    if (room.draftDone.every(d => d)) {
      transitionToInitialReveal(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 선택을 기다리는 중...' });
    }
  });

  // ── HP 분배 ──
  // Supports two modes:
  //   1) Non-twins: {hps: [t1, t2, t3]} sum=10, each >= 1
  //   2) Twins step 1: {hps: [twinTier, t2, t3]} where twinTier >= 2, sum=10
  //      Twins step 2: {twinSplit: [elder, younger]} sum = twinTier HP, each >= 1
  socket.on('distribute_hp', ({ hps, twinSplit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'hp_distribution') return;
    const idx = socket.data.idx;
    const player = room.players[idx];
    const hasTwins = player.draft.t1 === 'twins';

    // If this is a twin split step
    if (twinSplit && hasTwins && player.hpDist) {
      const twinTierHp = player.hpDist[0]; // HP assigned to twins tier
      if (!Array.isArray(twinSplit) || twinSplit.length !== 2 ||
          twinSplit[0] < 1 || twinSplit[1] < 1 ||
          twinSplit[0] + twinSplit[1] !== twinTierHp) {
        socket.emit('err', { msg: `쌍둥이 HP 합계는 ${twinTierHp}, 각 최소 1이어야 합니다.` }); return;
      }

      const d = player.draft;
      player.pieces = [
        createPiece('twins', 1, twinSplit[0], { subUnit: 'elder', parentType: 'twins' }),
        createPiece('twins', 1, twinSplit[1], { subUnit: 'younger', parentType: 'twins' }),
        createPiece(d.t2, 2, player.hpDist[1]),
        createPiece(d.t3, 3, player.hpDist[2]),
      ];
      player.pieces[0].type = 'twins_elder';
      player.pieces[1].type = 'twins_younger';
      player.twinSplitDone = true;
      room.hpDone[idx] = true;
      socket.emit('hp_ok', { hps: player.hpDist, twinSplit });
      emitToSpectators(room, 'spectator_hp_update', { playerIdx: idx, playerName: player.name, pieces: pieceSummary(player.pieces), hpDone: [...room.hpDone] });

      if (room.hpDone.every(d2 => d2)) {
        transitionToPlacement(room);
      } else {
        socket.emit('wait_msg', { msg: '상대방의 HP 분배를 기다리는 중...' });
      }
      return;
    }

    // Standard HP distribution
    if (hasTwins) {
      // For twins: 3 values [twinTierTotal, t2, t3], twinTierTotal >= 2
      if (!Array.isArray(hps) || hps.length !== 3 ||
          hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 8)) {
        socket.emit('err', { msg: 'HP 합계는 10, 각 최소 1 최대 8 · 3개 필요' }); return;
      }
      if (hps[0] < 2) {
        socket.emit('err', { msg: '쌍둥이 티어는 최소 2 HP 필요합니다.' }); return;
      }
      player.hpDist = hps;
      // Request twin split
      socket.emit('twin_split_needed', { twinTierHp: hps[0] });
      return;
    }

    // Non-twins: standard 3 values
    if (!Array.isArray(hps) || hps.length !== 3 ||
        hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 8)) {
      socket.emit('err', { msg: 'HP 합계는 10, 각 유닛 최소 1 최대 8 · 3개 필요' }); return;
    }

    player.hpDist = hps;
    const d = player.draft;
    player.pieces = [
      createPiece(d.t1, 1, hps[0]),
      createPiece(d.t2, 2, hps[1]),
      createPiece(d.t3, 3, hps[2]),
    ];
    room.hpDone[idx] = true;
    socket.emit('hp_ok', { hps });
    emitToSpectators(room, 'spectator_hp_update', { playerIdx: idx, playerName: player.name, pieces: pieceSummary(player.pieces), hpDone: [...room.hpDone] });

    if (room.hpDone.every(d2 => d2)) {
      transitionToPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 HP 분배를 기다리는 중...' });
    }
  });

  // startRevealPhase moved to global scope as startRevealPhaseFromRoom

  // ── Reveal 확인 (레거시 — 새 흐름에서는 사용 안 함) ──
  socket.on('confirm_reveal', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'reveal') return;
    const idx = socket.data.idx;
    room.revealDone[idx] = true;

    if (room.revealDone.every(d => d)) {
      transitionToPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방을 기다리는 중...' });
    }
  });

  // ── 초기 공개 확인 (#12: YES/NO 결정도 함께) ──
  // wantsExchange = true → 교체 드래프트 진행 측, false → 그대로 확정 측.
  // 양측 모두 결정되면 분기:
  //   둘 다 NO → final_reveal 로 직행 (교환 없음)
  //   하나라도 YES → exchange_draft 로 진입 (NO 측은 자동 done 처리, 60s 대기)
  // 교체 페이즈 — 10초 결정 윈도우 종료 후 클라이언트가 최종 결정을 emit.
  //   클라이언트가 자체 10초 타이머로 토글 후 한 번만 emit (조기 emit 도 수용 — 서버는 마지막 값으로 갱신).
  //   양측 모두 수신 시 즉시 다음 단계. 둘 다 NO → final_reveal 직행. 하나라도 YES → exchange_draft.
  //   서버는 상대 측의 결정을 broadcast 하지 않음 — 결정 윈도우 동안 익명성 유지.
  socket.on('confirm_initial_reveal', (payload) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'initial_reveal') return;
    const idx = socket.data.idx;
    if (!room.exchangeDecisions) room.exchangeDecisions = [null, null];
    const wantsExchange = !!(payload && payload.wantsExchange);
    room.exchangeDecisions[idx] = wantsExchange;
    room.initialRevealDone[idx] = true;
    console.log(`[confirm_initial_reveal] idx=${idx} wantsExchange=${wantsExchange} initialRevealDone=${JSON.stringify(room.initialRevealDone)} exchangeDecisions=${JSON.stringify(room.exchangeDecisions)} isAI=${room.isAI}`);

    if (room.initialRevealDone.every(d => d)) {
      // AI 결정 — aiDecideExchange 의 카운터 점수에 기반한 분석적 판단.
      //   강력한 카운터(점수 70+) 발견 → 거의 확실히 YES
      //   보통 카운터(50-69) → 70% YES
      //   약한 카운터(35-49) → 30% YES
      //   카운터 없거나 매우 약함 → NO
      // 무작위 50% 동전 던지기 대신 "상대 조합을 보고 판단" 하는 동작으로 자연스러움 강화.
      if (room.isAI) {
        if (room.exchangeDecisions[1] == null) {
          const aiPlayer = room.players[1];
          const humanPlayer = room.players[0];
          const swap = aiDecideExchange(aiPlayer.draft, humanPlayer.draft);
          let aiYes;
          if (swap && swap.priority >= 70) aiYes = true;
          else if (swap && swap.priority >= 50) aiYes = (Math.random() < 0.7);
          else if (swap && swap.priority >= 35) aiYes = (Math.random() < 0.3);
          else aiYes = false;
          room.exchangeDecisions[1] = aiYes;
          // YES 결정 시 미리 계산된 swap 을 보관 — transitionToExchangeDraft 에서 재사용
          if (aiYes && swap) {
            aiPlayer._aiPrecomputedSwap = { tier: swap.tier, newType: swap.newType };
          }
        }
      }
      const anyYes = room.exchangeDecisions.some(d => d === true);
      console.log(`[confirm_initial_reveal] both done, anyYes=${anyYes}, exchangeDecisions=${JSON.stringify(room.exchangeDecisions)}`);
      if (!anyYes) {
        // 둘 다 NO → final_reveal 직행 (대기 없음 — 양측 모두 교체하지 않으므로 보여줄 게 없음)
        console.log('[confirm_initial_reveal] both NO → transitionToFinalReveal');
        transitionToFinalReveal(room);
      } else {
        console.log('[confirm_initial_reveal] anyYes → transitionToExchangeDraft');
        transitionToExchangeDraft(room);
      }
    }
    // 상대가 아직 결정 안 했어도 wait_msg 보내지 않음 — 결정 사실 자체가 정보가 됨.
  });

  // ── 교환 드래프트: 1캐릭터 교환 ──
  socket.on('exchange_pick', ({ tier, newType }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'exchange_draft') return;
    const idx = socket.data.idx;
    if (room.exchangeDone[idx]) return;

    const player = room.players[idx];

    // 교환하지 않고 확정
    if (!tier || !newType) {
      room.exchangeDone[idx] = true;
      socket.emit('exchange_done', { draft: player.draft });
      if (room.exchangeDone.every(d => d)) {
        transitionToFinalReveal(room);
      } else {
        // 상대가 아직 안 끝남 — 페이즈 시작부터 흐른 시간 빼고 남은 시간 카운트다운
        socket.emit('ai_decision_wait', { waitMs: exchangeRemainingMs(room) });
      }
      return;
    }

    // 유효성 검사
    if (![1, 2, 3].includes(tier)) {
      socket.emit('err', { msg: '잘못된 티어입니다.' }); return;
    }
    const charExists = CHARACTERS[tier]?.find(c => c.type === newType);
    if (!charExists) {
      socket.emit('err', { msg: '존재하지 않는 캐릭터입니다.' }); return;
    }
    const currentType = tier === 1 ? player.draft.t1 : tier === 2 ? player.draft.t2 : player.draft.t3;
    if (newType === currentType) {
      socket.emit('err', { msg: '같은 캐릭터로는 교환할 수 없습니다.' }); return;
    }

    // 교환 실행
    if (tier === 1) player.draft.t1 = newType;
    else if (tier === 2) player.draft.t2 = newType;
    else player.draft.t3 = newType;

    room.exchangeDone[idx] = true;
    socket.emit('exchange_done', { draft: player.draft, exchanged: { tier, newType, newChar: findCharData(newType, tier) } });
    emitToSpectators(room, 'spectator_exchange', { playerIdx: idx, playerName: player.name });

    if (room.exchangeDone.every(d => d)) {
      transitionToFinalReveal(room);
    } else {
      // 상대가 아직 안 끝남 — 페이즈 시작부터 흐른 시간 빼고 남은 시간 카운트다운
      socket.emit('ai_decision_wait', { waitMs: exchangeRemainingMs(room) });
    }
  });

  // ── 최종 공개 확인 ──
  socket.on('confirm_final_reveal', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'final_reveal') return;
    const idx = socket.data.idx;
    room.finalRevealDone[idx] = true;

    if (room.finalRevealDone.every(d => d)) {
      transitionToHpPhase(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방을 기다리는 중...' });
    }
  });

  // ── 말 배치 ──
  socket.on('place_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const idx = socket.data.idx;
    const player = room.players[idx];
    const bounds = room.boardBounds;

    if (pieceIdx < 0 || pieceIdx >= player.pieces.length) return;
    if (!inBounds(col, row, bounds)) return;

    const piece = player.pieces[pieceIdx];
    if (piece.subUnit) {
      // Twins can share cell with other twin
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row && !p.subUnit)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    } else {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    }

    player.pieces[pieceIdx].col = col;
    player.pieces[pieceIdx].row = row;
    socket.emit('placed_ok', { pieceIdx, col, row });
    // 관전자에게 배치 실시간 업데이트
    emitToSpectators(room, 'spectator_placement_update', {
      p0Pieces: pieceSummary(room.players[0].pieces),
      p1Pieces: pieceSummary(room.players[1].pieces),
      boardBounds: room.boardBounds,
    });
  });

  // ── 배치 확정 ──
  socket.on('confirm_placement', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const idx = socket.data.idx;
    const player = room.players[idx];

    if (player.pieces.some(p => p.col < 0)) {
      socket.emit('err', { msg: '모든 말을 배치하세요.' }); return;
    }

    room.placementDone[idx] = true;

    if (room.placementDone.every(d => d)) {
      startGameFromRoom(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 배치를 기다리는 중...' });
    }
  });

  // ── 이동 ──
  socket.on('move_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const player = room.players[idx];

    // Check if action already done (unless messenger sprint OR twin's other half not yet moved)
    {
      const _pc = player.pieces[pieceIdx];
      const _twinSecondMove = _pc && (_pc.subUnit === 'elder' || _pc.subUnit === 'younger') &&
        Array.isArray(player.twinMovedSubs) && !player.twinMovedSubs.includes(_pc.subUnit);
      if (player.actionDone && !_pc?.messengerSprintActive && !_twinSecondMove) {
        socket.emit('err', { msg: '이미 행동을 사용했습니다.' }); return;
      }
    }

    const piece = player.pieces[pieceIdx];
    if (!piece || !piece.alive) { socket.emit('err', { msg: '올바르지 않은 말입니다.' }); return; }

    // Action-replace skill used => can't move (질주는 예외 — 이동을 위한 스킬이므로)
    if (player.actionUsedSkillReplace && !piece.messengerSprintActive) {
      socket.emit('err', { msg: '행동 대체 스킬을 사용했으므로 이동할 수 없습니다.' }); return;
    }

    // 쌍둥이 이동 중에는 쌍둥이만 이동 가능
    if (player.twinMovedSubs && player.twinMovedSubs.length > 0 && !piece.subUnit) {
      socket.emit('err', { msg: '쌍둥이 이동 중입니다. 나머지 쌍둥이를 이동시키세요.' }); return;
    }
    // 전령 질주 중에는 해당 전령만 이동 가능
    const anySprintingMsg = player.pieces.find(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
    if (anySprintingMsg && anySprintingMsg !== piece) {
      socket.emit('err', { msg: '전령 질주 중입니다. 해당 전령만 이동할 수 있습니다.' }); return;
    }
    if (!inBounds(col, row, room.boardBounds)) { socket.emit('err', { msg: '보드 밖입니다.' }); return; }
    if (!isCrossAdjacent(piece.col, piece.row, col, row)) {
      socket.emit('err', { msg: '상하좌우 1칸만 이동할 수 있습니다.' }); return;
    }

    // Block friendly unit stacking (except twins of the SAME player)
    const friendlyOccupant = player.pieces.find(p => p.alive && p.col === col && p.row === row);
    if (friendlyOccupant) {
      const bothAreTwins = piece.subUnit && friendlyOccupant.subUnit;
      if (!bothAreTwins) {
        socket.emit('err', { msg: '아군이 있는 칸으로는 이동할 수 없습니다.' }); return;
      }
    }
    // 팀모드: 팀원의 말도 같은 칸에 있으면 이동 차단 (쌍둥이는 같은 플레이어 한정 — 팀원 쌍둥이와는 공유 X)
    if (room.mode === 'team') {
      for (const tIdx of getTeammates(room, idx)) {
        const tp = room.players[tIdx];
        if (!tp) continue;
        if ((tp.pieces || []).some(p => p.alive && p.col === col && p.row === row)) {
          socket.emit('err', { msg: '팀원이 있는 칸으로는 이동할 수 없습니다.' }); return;
        }
      }
    }

    const prev = { col: piece.col, row: piece.row };
    piece.col = col;
    piece.row = row;

    // Check trap (팀전: 모든 적팀 플레이어의 덫 확인)
    const enemyIndicesForTrap = (room.mode === 'team')
      ? room.players.map(p => p.index).filter(i => !isTeammate(room, idx, i))
      : [1 - idx];
    let trapIdx = -1, trapOwnerIdx = -1;
    for (const eIdx of enemyIndicesForTrap) {
      const arr = room.boardObjects[eIdx] || [];
      const ti = arr.findIndex(o => o.type === 'trap' && o.col === col && o.row === row);
      if (ti >= 0) { trapIdx = ti; trapOwnerIdx = eIdx; break; }
    }
    if (trapIdx >= 0) {
      room.boardObjects[trapOwnerIdx].splice(trapIdx, 1);
      const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col, row }, piece, trapOwnerIdx, 2, false, idx);
      piece.hp = Math.max(0, piece.hp - dmg);
      // Wizard passive: SP on trap hit
      if (piece.type === 'wizard') {
        const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, idx) : idx;
        room.instantSp[wizSpSlot] += 1;
        emitSPUpdate(room);
        // 인스턴트 매직 알림 — 텍스트 메시지 제거 (클라 황금 마법구 애니만 사용). type='wizard' 로만 트리거.
        emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: idx, msg: `🧙 인스턴트 매직 : SP 획득` });

        emitToSpectators(room, 'spectator_log', { msg: `🧙 인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: idx });

      }
      const willDie = piece.hp <= 0;
      if (willDie) {
        handleDeath(room, piece, idx);
        setKillInfo(room, 'trap', null, [{ name: piece.name }]);
      }
      emitToBoth(room, 'trap_triggered', {
        col, row,
        pieceInfo: { type: piece.type, name: piece.name, icon: piece.icon },
        damage: dmg,
        destroyed: willDie,
        newHp: piece.hp,
        victimOwnerIdx: idx,
      });
    }

    // ★ 쌍둥이 이동: 한쪽만 이동해도 행동 완료. 같은 턴에 다른 쪽 이동은 옵션.
    if (piece.subUnit) {
      if (!player.twinMovedSubs) player.twinMovedSubs = [];
      if (player.twinMovedSubs.includes(piece.subUnit)) {
        socket.emit('err', { msg: '이미 이동한 쌍둥이입니다. 다른 쪽을 이동시키세요.' }); return;
      }
      player.twinMovedSubs.push(piece.subUnit);
      player.actionDone = true;  // 첫 이동만으로 턴 종료 가능
    } else if (piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
      // Messenger sprint: handle multi-move
      piece.messengerMovesLeft--;
      if (piece.messengerMovesLeft <= 0) {
        piece.messengerSprintActive = false;
        player.actionDone = true;
      }
    } else {
      player.actionDone = true;
    }
    // 행동 추적 — 쌍검무/질주 가드용
    player._lastActionType = 'move';
    player._lastActionPieceType = piece.type;
    player._lastActionSubUnit = piece.subUnit || null;

    // twinMovePending: 쌍둥이 첫 이동 후 나머지 한쪽이 아직 이동 안 했으면 true.
    //   client 가 새 "쌍둥이 이동 페이즈" 를 유지하기 위한 플래그.
    const stillCanMoveOtherTwin = piece.subUnit
      && Array.isArray(player.twinMovedSubs) && player.twinMovedSubs.length === 1
      && player.pieces.some(p => p.alive && p.subUnit && p.subUnit !== piece.subUnit);
    socket.emit('move_ok', {
      pieceIdx, prev, col, row,
      yourPieces: pieceSummary(player.pieces),
      boardObjects: boardObjectsSummary(room, idx),
      twinMovePending: stillCanMoveOtherTwin,
      twinMovedSub: piece.subUnit || null,
    });
    if (room.mode === 'team') {
      // 팀모드: 팀원에게 실시간 이동 이벤트(애니메이션용)
      const moverPiece = piece;
      const allyIdxs = getAllyIndices(room, idx).filter(i => i !== idx);
      for (const alIdx of allyIdxs) {
        const ally = room.players[alIdx];
        if (ally && ally.socketId && ally.socketId !== 'AI') {
          io.to(ally.socketId).emit('team_ally_moved', {
            moverIdx: idx,
            moverName: room.players[idx].name,
            pieceType: moverPiece.type,
            pieceIcon: moverPiece.icon,
            pieceName: moverPiece.name,
            subUnit: moverPiece.subUnit || null,
            prevCol: prev.col, prevRow: prev.row,
            col, row,
          });
        }
      }
      // 적팀 모두에게 이동 알림 — 1v1과 동일한 토스트/로그 표시
      const enemyIdxs = getEnemyIndices(room, idx);
      const isMarked = (piece.statusEffects || []).some(e => e.type === 'mark');
      for (const enIdx of enemyIdxs) {
        const en = room.players[enIdx];
        if (en && en.socketId && en.socketId !== 'AI') {
          io.to(en.socketId).emit('opp_moved', {
            msg: isMarked
              ? `${room.players[idx].name}의 표식된 ${piece.name}${조사(piece.name, '이', '가')} 이동했습니다.`
              : `${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 이동했습니다.`,
            // 표식된 말은 좌표 노출 (애니메이션용), 일반 이동은 좌표 숨김
            prevCol: isMarked ? prev.col : undefined,
            prevRow: isMarked ? prev.row : undefined,
            col: isMarked ? col : undefined,
            row: isMarked ? row : undefined,
          });
        }
      }
      broadcastTeamGameState(room);
    } else {
      const opp = room.players[1 - idx];
      if (opp.socketId !== 'AI') {
        io.to(opp.socketId).emit('opp_moved', { msg: `${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 이동했습니다.`, prevCol: prev.col, prevRow: prev.row, col, row });
      }
    }
    emitToSpectators(room, 'spectator_log', { msg: `${player.name}, ${piece.icon}${piece.name} 이동`, type: 'move', playerIdx: idx });
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // Check win after trap damage
    if (room.mode === 'team') {
      if (isTeamEliminated(room, 0)) { endTeamGame(room, 1); return; }
      if (isTeamEliminated(room, 1)) { endTeamGame(room, 0); return; }
    } else {
      if (checkWin(room, idx)) {
        endGame(room, 1 - idx);
        return;
      }
    }

    // DON'T auto end turn - wait for 'end_turn' event
  });

  // ── 공격 ──
  socket.on('attack', ({ pieceIdx, tCol, tRow }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const player = room.players[idx];

    if (player.actionDone) {
      // 쌍검무: 2회 공격 중 2번째 공격
      const piece = player.pieces[pieceIdx];
      if (piece && piece.dualBladeAttacksLeft > 0) {
        piece.dualBladeAttacksLeft--;
        const bounds = room.boardBounds;
        const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds);
        const hitResults = processAttack(room, idx, piece, atkCells);
        const cellResults = atkCells.map(cell => {
          const hit = hitResults.find(h => h.col === cell.col && h.row === cell.row);
          return {
            col: cell.col, row: cell.row, hit: !!hit,
            damage: hit ? hit.damage : 0, destroyed: hit ? hit.destroyed : false,
            revealedType: hit?.revealedType, revealedName: hit?.revealedName, revealedIcon: hit?.revealedIcon,
            hitName: hit?.hitName, hitIcon: hit?.hitIcon,
            defPieceIdx: hit?.defPieceIdx,
            defOwnerIdx: hit?.defOwnerIdx,
            redirectedToBodyguard: hit?.redirectedToBodyguard || false,
            bodyguardRedirect: hit?.bodyguardRedirect || false,
          };
        });
        // 쌍검무 추가 공격에서도 호위무사 가로채기 hit 별도 추가 (atkCells 에 없는 호위무사 좌표)
        for (const hit of hitResults) {
          if (!hit.bodyguardRedirect) continue;
          const already = cellResults.some(c => c.hit && c.bodyguardRedirect && c.col === hit.col && c.row === hit.row);
          if (already) continue;
          cellResults.push({
            col: hit.col, row: hit.row, hit: true,
            damage: hit.damage, destroyed: hit.destroyed,
            revealedType: hit.revealedType, revealedName: hit.revealedName, revealedIcon: hit.revealedIcon,
            hitName: hit.hitName, hitIcon: hit.hitIcon,
            defPieceIdx: hit.defPieceIdx,
            defOwnerIdx: hit.defOwnerIdx,
            redirectedToBodyguard: false,
            bodyguardRedirect: true,
          });
        }
        socket.emit('attack_result', {
          pieceIdx, cellResults, anyHit: hitResults.length > 0,
          oppPieces: oppPieceSummary(room.players[1 - idx].pieces),
          yourPieces: pieceSummary(player.pieces),
        });
        const defender = room.players[1 - idx];
        if (defender.socketId !== 'AI') {
          io.to(defender.socketId).emit('being_attacked', {
            atkCells,
            hitPieces: hitResults.map(h => {
              // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
              const dp = (typeof h.defPieceIdx === 'number') ? defender.pieces[h.defPieceIdx] : null;
              return {
                col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
                name: dp?.name, icon: dp?.icon,
                // 호위무사 가로채기 플래그 — 클라이언트 토스트 분기용 (누락 시 '공격받았습니다' 오출력)
                redirectedToBodyguard: h.redirectedToBodyguard || false,
                bodyguardRedirect: h.bodyguardRedirect || false,
                defPieceIdx: h.defPieceIdx,
              };
            }),
            yourPieces: pieceSummary(defender.pieces),
          });
        }
        // ★ 관전자 — 1v1 인간 시점 쌍검무 추가 공격
        emitToSpectators(room, 'spectator_attack_anim', {
          atkCells,
          hits: hitResults.map(h => ({
            col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            defPieceIdx: h.defPieceIdx, defOwnerIdx: 1 - idx,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false,
          })),
        });
        // 관전자 로그: 쌍검무 추가 공격
        if (hitResults.length > 0) {
          for (const h of hitResults) {
            const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row);
            const targetName = dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row);
            emitToSpectators(room, 'spectator_log', { msg: h.destroyed
              ? `${player.name}의 ${targetName} 사망`
              : `${player.name}의 공격 명중!`, type: 'hit', playerIdx: idx });
          }
        } else {
          emitToSpectators(room, 'spectator_log', { msg: `${player.name} 공격 빗나감`, type: 'miss', playerIdx: idx });
        }
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
        if (checkWin(room, 1 - idx)) { endGame(room, idx); }
        return;
      }
      socket.emit('err', { msg: '이미 행동을 사용했습니다.' }); return;
    }

    if (player.actionUsedSkillReplace) {
      socket.emit('err', { msg: '행동 대체 스킬을 사용했으므로 공격할 수 없습니다.' }); return;
    }

    // 쌍둥이 이동 중이면 공격 불가 (이동과 공격을 섞을 수 없음)
    if (player.twinMovedSubs && player.twinMovedSubs.length > 0) {
      socket.emit('err', { msg: '쌍둥이가 이동 중입니다. 나머지 쌍둥이도 이동하거나 턴을 종료하세요.' }); return;
    }

    const attacker = player;
    const defender = room.players[1 - idx];
    const atkPiece = attacker.pieces[pieceIdx];
    if (!atkPiece || !atkPiece.alive) { socket.emit('err', { msg: '올바르지 않은 말입니다.' }); return; }

    // Validate target for target-picking types
    if ((atkPiece.type === 'shadowAssassin' || atkPiece.type === 'witch') &&
        (tCol === undefined || tRow === undefined || !inBounds(tCol, tRow, room.boardBounds))) {
      socket.emit('err', { msg: '대상 칸을 선택하세요.' }); return;
    }
    // shadowAssassin: 자기 주변 9칸(자신 포함) 이내만 허용
    if (atkPiece.type === 'shadowAssassin') {
      if (Math.abs(tCol - atkPiece.col) > 1 || Math.abs(tRow - atkPiece.row) > 1) {
        socket.emit('err', { msg: '주변 9칸 중에서만 선택 가능합니다.' }); return;
      }
    }

    const bounds = room.boardBounds;
    const extra = {
      tCol, tRow,
      toggleState: atkPiece.toggleState,
      rats: room.rats[idx],
    };

    // ★ 쌍둥이 동시 공격: 형+동생 공격 범위 합산
    let atkCells = getAttackCells(atkPiece.type, atkPiece.col, atkPiece.row, bounds, extra);
    let twinAtkPiece = null;
    if (atkPiece.subUnit) {
      const otherSub = atkPiece.subUnit === 'elder' ? 'younger' : 'elder';
      twinAtkPiece = attacker.pieces.find(p => p.subUnit === otherSub && p.alive);
      if (twinAtkPiece) {
        const twinCells = getAttackCells(twinAtkPiece.type, twinAtkPiece.col, twinAtkPiece.row, bounds, extra);
        // 중복 제거하여 합산
        for (const tc of twinCells) {
          if (!atkCells.some(c => c.col === tc.col && c.row === tc.row)) {
            atkCells.push(tc);
          }
        }
      }
    }

    // ★ 사망 기폭 페이즈 시작 — processAttack 안 handleDeath 가 화약상 죽이면 큐에 push.
    //   handler 끝의 flushPhase 가 cast/intro/bomb_detonated emit 들 시간차로 스케줄링.
    startPhase(room);

    // 본체 공격 처리
    const hitResults = processAttack(room, idx, atkPiece, getAttackCells(atkPiece.type, atkPiece.col, atkPiece.row, bounds, extra));
    // 쌍둥이 다른 쪽 공격 처리 (겹치는 셀은 이미 본체에서 처리됨 — 중복 피해 방지)
    if (twinAtkPiece) {
      const twinCells = getAttackCells(twinAtkPiece.type, twinAtkPiece.col, twinAtkPiece.row, bounds, extra);
      const twinOnlyCells = twinCells.filter(tc => !getAttackCells(atkPiece.type, atkPiece.col, atkPiece.row, bounds, extra).some(c => c.col === tc.col && c.row === tc.row));
      const twinHits = processAttack(room, idx, twinAtkPiece, twinOnlyCells);
      hitResults.push(...twinHits);
      // 겹치는 셀은 두 번 공격 (형과 동생 각각 피해)
      const overlapCells = twinCells.filter(tc => getAttackCells(atkPiece.type, atkPiece.col, atkPiece.row, bounds, extra).some(c => c.col === tc.col && c.row === tc.row));
      if (overlapCells.length > 0) {
        const overlapHits = processAttack(room, idx, twinAtkPiece, overlapCells);
        hitResults.push(...overlapHits);
      }
    }

    // 각 셀별로 모든 hit를 보존 (쌍둥이 중첩 공격 시 같은 셀에 2개의 hit 가능)
    const cellResults = [];
    for (const cell of atkCells) {
      const cellHits = hitResults.filter(h => h.col === cell.col && h.row === cell.row);
      if (cellHits.length === 0) {
        cellResults.push({ col: cell.col, row: cell.row, hit: false, damage: 0, destroyed: false });
      } else {
        for (const hit of cellHits) {
          cellResults.push({
            col: cell.col, row: cell.row, hit: true,
            damage: hit.damage, destroyed: hit.destroyed,
            revealedType: hit.revealedType, revealedName: hit.revealedName, revealedIcon: hit.revealedIcon,
            hitName: hit.hitName, hitIcon: hit.hitIcon,
            defPieceIdx: hit.defPieceIdx,
            defOwnerIdx: hit.defOwnerIdx,
            attackerSub: hit.attackerSub, attackerName: hit.attackerName, attackerIcon: hit.attackerIcon,
            // 호위무사 가로채기 플래그 — 클라이언트 토스트/애니메이션 분기용
            redirectedToBodyguard: hit.redirectedToBodyguard || false,
            bodyguardRedirect: hit.bodyguardRedirect || false,
          });
        }
      }
    }
    // ★ 호위무사 가로채기 hit (_pendingBodyguardHits) — atkCells 에 없는 호위무사 좌표가 들어있어
    //   위 루프에서 누락됨. 별도 추가해야 클라이언트가 충성 도장(파란색)을 표시할 수 있음.
    for (const hit of hitResults) {
      if (!hit.bodyguardRedirect) continue;
      const already = cellResults.some(c => c.hit && c.bodyguardRedirect && c.col === hit.col && c.row === hit.row);
      if (already) continue;
      cellResults.push({
        col: hit.col, row: hit.row, hit: true,
        damage: hit.damage, destroyed: hit.destroyed,
        revealedType: hit.revealedType, revealedName: hit.revealedName, revealedIcon: hit.revealedIcon,
        hitName: hit.hitName, hitIcon: hit.hitIcon,
        defPieceIdx: hit.defPieceIdx,
        defOwnerIdx: hit.defOwnerIdx,
        attackerSub: hit.attackerSub, attackerName: hit.attackerName, attackerIcon: hit.attackerIcon,
        redirectedToBodyguard: false,
        bodyguardRedirect: true,
      });
    }
    if (room.mode === 'team') {
      // 팀전: attack_result에 단일 oppPieces는 의미 없음 (team_game_update로 전체 동기)
      socket.emit('attack_result', {
        pieceIdx, cellResults, anyHit: hitResults.length > 0,
        yourPieces: pieceSummary(player.pieces),
      });
      // being_attacked를 실제 피격된 각 적 플레이어에게 각각 전송
      const defenderHitsByOwner = new Map();
      for (const h of hitResults) {
        if (h.defOwnerIdx === undefined) continue;
        if (!defenderHitsByOwner.has(h.defOwnerIdx)) defenderHitsByOwner.set(h.defOwnerIdx, []);
        defenderHitsByOwner.get(h.defOwnerIdx).push(h);
      }
      for (const [ownerIdx, hits] of defenderHitsByOwner.entries()) {
        const defPlayer = room.players[ownerIdx];
        if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
        io.to(defPlayer.socketId).emit('being_attacked', {
          atkCells,
          hitPieces: hits.map(h => {
            // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
            const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
            return {
              col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx,
            };
          }),
          yourPieces: pieceSummary(defPlayer.pieces),
        });
      }
      // 팀원 피격 알림 — 같은 팀의 다른 멤버에게 애니메이션용 이벤트
      for (const [defOwnerIdx, hits] of defenderHitsByOwner.entries()) {
        const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
        for (const allyIdx of allyIdxs) {
          const ally = room.players[allyIdx];
          if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
          io.to(ally.socketId).emit('team_ally_hit', {
            atkCells,
            victimIdx: defOwnerIdx,
            victimName: room.players[defOwnerIdx].name,
            hitPieces: hits.map(h => {
              // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
              const dp = (typeof h.defPieceIdx === 'number') ? room.players[defOwnerIdx].pieces[h.defPieceIdx] : null;
              return {
                col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
                name: dp?.name, icon: dp?.icon,
                defPieceIdx: h.defPieceIdx,
                redirectedToBodyguard: h.redirectedToBodyguard || false,
                bodyguardRedirect: h.bodyguardRedirect || false,
              };
            }),
          });
        }
      }
    } else {
      socket.emit('attack_result', {
        pieceIdx, cellResults, anyHit: hitResults.length > 0,
        oppPieces: oppPieceSummary(defender.pieces),
        yourPieces: pieceSummary(player.pieces),
      });
      if (defender.socketId !== 'AI') {
        io.to(defender.socketId).emit('being_attacked', {
          atkCells,
          hitPieces: hitResults.map(h => {
            // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
            const dp = (typeof h.defPieceIdx === 'number') ? defender.pieces[h.defPieceIdx] : null;
            return {
              col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx,
            };
          }),
          yourPieces: pieceSummary(defender.pieces),
        });
      }
    }

    // ★ 관전자 일반 공격 애니메이션 — 셀 hit 번쩍임 + 카드 hit flash + 본체 도장.
    //   defOwnerIdx 가 hits 에 들어있어 클라가 패널 매핑 가능.
    emitToSpectators(room, 'spectator_attack_anim', {
      atkCells,
      hits: hitResults.map(h => ({
        col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
        defPieceIdx: h.defPieceIdx,
        defOwnerIdx: (h.defOwnerIdx !== undefined) ? h.defOwnerIdx : (1 - idx),
        redirectedToBodyguard: h.redirectedToBodyguard || false,
        bodyguardRedirect: h.bodyguardRedirect || false,
      })),
    });

    // 관전자 로그: 일반 공격 (쌍둥이는 각 공격자별로 메시지 분리)
    if (hitResults.length > 0) {
      for (const h of hitResults) {
        const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row) || defender.pieces.find(p => !p.alive && p.hp === 0 && p.lastCol === h.col && p.lastRow === h.row);
        const targetName = (h.hitIcon && h.hitName) ? `${h.hitIcon}${h.hitName}` : (dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row));
        // 실제 공격자 (쌍둥이의 경우 attackerSub로 구분)
        const atkName = h.attackerName || atkPiece.name;
        const atkIcon = h.attackerIcon || atkPiece.icon;
        emitToSpectators(room, 'spectator_log', { msg: h.destroyed
          ? `${player.name}의 ${targetName} 사망`
          : `${player.name}의 공격 명중!`, type: 'hit', playerIdx: idx });
      }
    } else {
      emitToSpectators(room, 'spectator_log', { msg: `${player.name} 공격 빗나감`, type: 'miss', playerIdx: idx });
    }

    // AI 피격 기억 + 공격자 위치 추론 (실제 적 타입·ATK 기반 후보 좁히기)
    if (room.isAI && 1 - idx === 1 && room.aiBrain) {
      for (const h of hitResults) {
        const hitPiece = defender.pieces.find(p => p.col === h.col && p.row === h.row && p.alive);
        if (hitPiece) {
          aiRecordHit(room.aiBrain, hitPiece);
        }
      }
      // ── 공격자 위치 역산 (스마트 버전) ──
      // 적 유닛 타입은 초기공개로 이미 알고 있음 → 그 타입들이 실제로 hit 셀을 공격할 수 있는 후보 위치만 가산
      if (hitResults.length > 0) {
        const bSize = 5;  // AI 1v1
        const opp = room.players[0];
        // 적 살아있는 유닛 타입 목록 (각 타입의 ATK도 함께)
        const aliveEnemyTypes = (opp.pieces || []).filter(p => p.alive).map(p => ({ type: p.type, atk: p.atk, toggleState: p.toggleState }));
        if (aliveEnemyTypes.length === 0) {
          // 폴백 — 기존 방식
          for (const h of hitResults) {
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nc = h.col + dc, nr = h.row + dr;
              if (nc >= 0 && nc < bSize && nr >= 0 && nr < bSize)
                room.aiBrain.probMap[nr][nc] = Math.max(room.aiBrain.probMap[nr][nc], 5);
            }
          }
        } else {
          // 각 hit별 후보 셀 집합 (이번 공격에서 가능한 공격자 위치들)
          const newCandidates = new Set();
          for (const h of hitResults) {
            // ATK 값으로 추가 필터 — damage가 일치하는 유닛만 (commander 버프 ±1, monk vs 악인 = 3 등 변수 있어 완전 필터링은 안 함)
            const hitDamage = h.damage;
            for (const et of aliveEnemyTypes) {
              // 가능 공격자 셀 — 그 타입이 어디서든 hit 셀을 공격 범위에 포함하는지
              for (let r = 0; r < bSize; r++) for (let c = 0; c < bSize; c++) {
                // 자기 자리(AI 말 위치)는 적이 있을 수 없음
                if (room.players[1].pieces.some(p => p.alive && p.col === c && p.row === r)) continue;
                // 그 타입 기준 공격 셀
                const extra = et.toggleState ? { toggleState: et.toggleState } : {};
                let cells;
                try { cells = getAttackCells(et.type, c, r, room.boardBounds, extra); } catch (e) { continue; }
                if (cells.some(cc => cc.col === h.col && cc.row === h.row)) {
                  newCandidates.add(`${c},${r}`);
                }
              }
            }
          }
          // 후보 집합에 가산 — 후보 수가 적을수록 신뢰도 ↑
          const candList = [...newCandidates];
          const baseConf = candList.length <= 3 ? 8 : (candList.length <= 6 ? 7 : 6);
          // 회피 후 재피격 추론: brain.lastHitCandidates와 교집합 시 신뢰도 +1
          const prevCands = room.aiBrain.lastHitCandidates;
          if (prevCands && prevCands.size > 0) {
            const intersect = candList.filter(k => prevCands.has(k));
            if (intersect.length > 0 && intersect.length <= 4) {
              // 교집합이 작으면 거의 확정 → 9
              for (const key of intersect) {
                const [c, r] = key.split(',').map(Number);
                room.aiBrain.probMap[r][c] = 9;
              }
            }
          }
          // 일반 후보 가산
          for (const key of candList) {
            const [c, r] = key.split(',').map(Number);
            room.aiBrain.probMap[r][c] = Math.max(room.aiBrain.probMap[r][c], baseConf);
          }
          // 다음 회피 후 재피격 추론용 저장
          room.aiBrain.lastHitCandidates = newCandidates;
          room.aiBrain.lastHitTurn = room.aiBrain.turnCount;
        }
      } else {
        // 빗나감 — 직전 후보군 기억 유지하되 회피 성공으로 약간 감쇠
        if (room.aiBrain.lastHitCandidates) {
          for (const key of room.aiBrain.lastHitCandidates) {
            const [c, r] = key.split(',').map(Number);
            room.aiBrain.probMap[r][c] = Math.max(0, (room.aiBrain.probMap[r][c] || 0) * 0.7);
          }
        }
      }
      // 공격 범위 셀 자체도 적이 있을 수 있음
      if (atkCells.length > 0) {
        for (const c of atkCells) {
          if (c.row >= 0 && c.row < 5 && c.col >= 0 && c.col < 5) {
            room.aiBrain.probMap[c.row][c.col] = Math.max(room.aiBrain.probMap[c.row][c.col], 4);
          }
        }
        const avgCol = atkCells.reduce((s, c) => s + c.col, 0) / atkCells.length;
        const avgRow = atkCells.reduce((s, c) => s + c.row, 0) / atkCells.length;
        const cr = Math.round(avgRow), cc = Math.round(avgCol);
        if (cr >= 0 && cr < 5 && cc >= 0 && cc < 5) {
          room.aiBrain.probMap[cr][cc] = Math.max(room.aiBrain.probMap[cr][cc], 7);
        }
      }
    }

    // 일반(첫) 공격 종료 — actionDone 만 표시, dualBladeAttacksLeft는 건드리지 않음
    // (추가 공격 크레딧은 actionDone 분기 안의 두 번째 공격 처리에서만 차감)
    player.actionDone = true;
    // 행동 추적
    player._lastActionType = 'attack';
    player._lastActionPieceType = atkPiece.type;
    player._lastActionSubUnit = atkPiece.subUnit || null;

    if (room.mode === 'team') {
      // 팀모드: 공격 후 전체 상태 재브로드캐스트
      broadcastTeamGameState(room);
    }
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // ★ 승리 체크 — 사망 기폭 페이즈가 큐에 있으면 flushPhase callback 으로 지연.
    //   simultaneous_draw 케이스 (양측 동시 전멸) 도 checkGameEndAfterPhase 가 처리.
    flushPhase(room, () => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      checkGameEndAfterPhase(room);
    });

    // DON'T auto end turn - wait for 'end_turn' event
  });

  // ── 턴 종료 ──
  // ── 기권 ──
  socket.on('surrender', () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    const idx = socket.data.idx;
    // 이미 종료된 방은 무시
    if (room.phase === 'ended' || room.phase === 'waiting') return;

    // ── 팀전: 한 명 기권 = 팀 즉시 패배 ──
    if (room.mode === 'team') {
      const teamSetupPhases = ['team_draft', 'team_hp', 'team_reveal', 'team_placement'];
      const surrenderedTeam = room.players[idx]?.teamId;
      if (surrenderedTeam === undefined || surrenderedTeam === null) return;
      const winnerTeamId = 1 - surrenderedTeam;
      if (room.phase === 'game' || teamSetupPhases.includes(room.phase)) {
        emitToSpectators(room, 'spectator_log', { msg: `🏳 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 기권했습니다! ${surrenderedTeam === 0 ? '블루' : '레드'}팀 패배.`, type: 'system', playerIdx: idx });
        endTeamGame(room, winnerTeamId, 'surrender');
      }
      return;
    }

    // 세팅 단계(초기공개/교환/최종공개/HP/배치)에서 나가기 — 상대 승리.
    // 사용자 요청: 게임 시작 전 이탈은 그리드 화면 출력 안 함, 해골 화면(=기권 처리)으로 송출.
    const setupPhases = ['initial_reveal','exchange_draft','final_reveal','hp_distribution','placement'];
    if (setupPhases.includes(room.phase)) {
      emitToSpectators(room, 'spectator_log', { msg: `🚪 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 게임을 나갔습니다.`, type: 'system', playerIdx: idx });
      endGame(room, 1 - idx, 'surrender');  // surrender 처리 → 해골 화면 + 그리드 미노출
      return;
    }
    // 게임 중 기권
    if (room.phase !== 'game') return;
    if (room.currentPlayerIdx !== idx) return;
    emitToSpectators(room, 'spectator_log', { msg: `🏳 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 기권했습니다!`, type: 'system', playerIdx: idx });
    endGame(room, 1 - idx, 'surrender');
  });

  socket.on('end_turn', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    // Allow ending turn even without action (player may choose to only use free skills)
    endTurn(room);
  });

  // ── 쌍둥이 누나 이동 넘기기 (스택 시) ──
  socket.on('skip_twin_move', ({ subUnit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }
    const player = room.players[idx];
    if (!subUnit || (subUnit !== 'elder' && subUnit !== 'younger')) return;
    if (!player.twinMovedSubs) player.twinMovedSubs = [];
    if (player.twinMovedSubs.includes(subUnit)) return;
    player.twinMovedSubs.push(subUnit);
    // 행동 자체는 소비되지 않음 — 단지 해당 쌍둥이의 이동만 컨펌으로 스킵
    player._twinSkipConfirmed = true;
    socket.emit('twin_skip_ok', {
      subUnit,
      twinMovedSubs: [...player.twinMovedSubs],
    });
  });

  // ── 스킬 사용 ──
  socket.on('use_skill', ({ pieceIdx, skillId, params }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    // ★ 사망 기폭 페이즈 시작 — executeSkill 안 handleDeath 가 화약상 죽이면 큐에 push.
    //   handler 끝의 flushPhase 가 cast/bomb_detonated 시간차 스케줄링 + 게임종료 검사 지연.
    startPhase(room);

    const result = executeSkill(room, idx, pieceIdx, skillId, params || {});
    if (!result.ok) {
      socket.emit('err', { msg: result.msg });
      return;
    }

    const skillPiece = room.players[idx].pieces[pieceIdx];

    if (room.mode === 'team') {
      // 팀모드: 시전자에게 skill_result 먼저
      socket.emit('skill_result', {
        msg: result.skipLog ? '' : result.msg,
        data: result.data,
        success: true,
        effects: result.data,
        yourPieces: pieceSummary(room.players[idx].pieces),
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardObjects: boardObjectsSummary(room, idx),
        actionDone: room.players[idx].actionDone,
        actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
        skillsUsed: room.players[idx].skillsUsedBeforeAction,
        casterPieceIdx: pieceIdx,
      });
      // 시전자 외 모두에게 skill 알림 — 반드시 broadcastTeamGameState 보다 먼저 보냄.
      // 그렇지 않으면 team_game_update 가 먼저 도착해 S.sp 가 NEW 값으로 갱신되고,
      // 후속 team_skill_notice 핸들러의 oldSpSnap=newSp 가 되어 마법구 delta=0 으로 무동작이 됨.
      for (const p of room.players) {
        if (!p.socketId || p.index === idx) continue;
        const isAlly = (p.teamId === room.players[idx].teamId);
        // allyMsg / oppMsg 명시 분기:
        //   - undefined  → result.msg (본문) 사용
        //   - null/'' (빈문자열) → 메시지 출력 차단 (애니메이션만 재생)
        //   - 그 외 string → 그 메시지 그대로 사용
        const explicitAlly = (result.allyMsg !== undefined) ? result.allyMsg : (result.msg || null);
        const explicitOpp  = (result.oppMsg  !== undefined) ? result.oppMsg  : (result.msg || null);
        io.to(p.socketId).emit('team_skill_notice', {
          casterIdx: idx,
          casterName: room.players[idx].name,
          casterTeamId: room.players[idx].teamId,
          casterPieceIdx: pieceIdx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillUsed: {
            icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName,
          },
          msg: isAlly ? explicitAlly : explicitOpp,
          // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용. defOwnerIdx + defPieceIdx 포함.
          hits: result.data?.hits || null,
        });
      }
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('team_skill_notice', {
          casterIdx: idx,
          casterName: room.players[idx].name,
          casterTeamId: room.players[idx].teamId,
          casterPieceIdx: pieceIdx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillUsed: {
            icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName,
          },
          hits: result.data?.hits || null,
          msg: result.oppMsg || result.msg || null,
        });
      }
      // 마지막에 전체 상태 브로드캐스트 — 모든 클라가 이미 시전자 카드/마법구 애니를 트리거한 후 도착
      broadcastTeamGameState(room);
    } else {
      // 1v1 기존 로직
      socket.emit('skill_result', {
        msg: result.skipLog ? '' : result.msg,
        data: result.data,
        success: true,
        effects: result.data,
        yourPieces: pieceSummary(room.players[idx].pieces),
        oppPieces: oppPieceSummary(room.players[1 - idx].pieces),
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardObjects: boardObjectsSummary(room, idx),
        actionDone: room.players[idx].actionDone,
        actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
        skillsUsed: room.players[idx].skillsUsedBeforeAction,
        casterPieceIdx: pieceIdx,           // 시전자 카드 spotlight 용
      });

      // Update opponent with skill details
      const opp = room.players[1 - idx];
      if (opp.socketId !== 'AI') {
        io.to(opp.socketId).emit('status_update', {
          oppPieces: oppPieceSummary(room.players[idx].pieces),
          yourPieces: pieceSummary(opp.pieces),
          sp: room.sp,
          instantSp: room.instantSp,
          skillPoints: room.sp,
          boardObjects: boardObjectsSummary(room, 1 - idx),
          msg: result.oppMsg || null,
          skillUsed: {
            icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName,
          },
          casterPieceIdx: pieceIdx,         // 상대 시점에서 시전자 카드 spotlight 용
          // 상대 측에서도 회복 애니메이션 — 시전자 piece 인덱스 그대로 전달 (상대 oppPieces 동일 순서)
          healedPieceIdxs: result.data?.healedPieceIdxs || null,
          // 분신 비행 애니메이션 — fog of war 우회용 좌표 정보 (있을 때만)
          twinJoin: result.data?.twinJoin || null,
          // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 빨간 도장 / 충성 파란 도장용
          //   defPieceIdx 는 server 의 opp.pieces (= 받는 쪽의 yourPieces) 인덱스와 일치.
          hits: result.data?.hits || null,
        });
      }
    }

    // 1v1 관전자에게도 마법구 비행 + 시전자 spotlight 트리거 (팀모드는 위 team_skill_notice 가 이미 처리)
    if (room.mode !== 'team') {
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('spectator_skill_anim', {
          casterIdx: idx,
          casterName: room.players[idx].name,
          casterPieceIdx: pieceIdx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillUsed: { icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName },
          // 분신 비행 애니메이션 — 좌표 정보 (있을 때만)
          twinJoin: result.data?.twinJoin || null,
          msg: result.msg || null,
          // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용
          hits: result.data?.hits || null,
        });
      }
    }
    // 관전자에게 상세 스킬 로그 전송
    if (!result.skipLog) {
      const specSkillMsg = buildSpectatorSkillMsg(room.players[idx].name, skillPiece, result);
      emitToSpectators(room, 'spectator_log', { msg: specSkillMsg, type: 'skill', playerIdx: idx });
    }
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // 기폭 스킬: SP_END(1) + offset 200ms = 980ms + 폭탄 애니(950ms) = ~1930ms
    // 1) 즉시 detonation_intro emit — 클라가 980ms 후 시퀀스 시작
    // 2) 1930ms 후 bomb_detonated 이벤트로 피해 적용 (클라 시퀀스 종료 시점)
    if (result.data && Array.isArray(result.data.deferredBombEmits)) {
      const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row }));
      if (bombList.length > 0) {
        // emitToBoth 가 spectators 까지 포함 — 중복 emit 제거.
        emitToBoth(room, 'detonation_intro', { bombs: bombList });
      }
      const deferred = [...result.data.deferredBombEmits];
      setTimeout(() => {
        if (!rooms[room.id]) return;
        for (const bd of deferred) {
          emitToBoth(room, 'bomb_detonated', bd);
        }
      }, 1930);
    }

    // Check win after skill effects (모드별)
    // ★ 게임종료 검사 — 사망 기폭 페이즈 deferred 면 flushPhase callback 이 처리 (simultaneous_draw 포함)
    flushPhase(room, () => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      checkGameEndAfterPhase(room);
    });
  });

  // ── 폭탄 기폭 ──
  socket.on('detonate_bomb', ({ bombIdx }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const bombs = room.boardObjects[idx].filter(o => o.type === 'bomb');
    if (bombIdx < 0 || bombIdx >= bombs.length) {
      socket.emit('err', { msg: '잘못된 폭탄 인덱스입니다.' }); return;
    }

    const bomb = bombs[bombIdx];
    detonateBomb(room, idx, bomb);
    room.boardObjects[idx] = room.boardObjects[idx].filter(o => !(o.type === 'bomb' && o.col === bomb.col && o.row === bomb.row));

    socket.emit('skill_result', {
      msg: `폭탄 기폭: ${coord(bomb.col, bomb.row)}`,
      success: true,
      yourPieces: pieceSummary(room.players[idx].pieces),
      oppPieces: oppPieceSummary(room.players[1 - idx].pieces),
      sp: room.sp,
      instantSp: room.instantSp,
      skillPoints: room.sp,
      boardObjects: boardObjectsSummary(room, idx),
      actionDone: room.players[idx].actionDone,
      actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
      skillsUsed: room.players[idx].skillsUsedBeforeAction,
    });

    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
    if (checkWin(room, 1 - idx)) { endGame(room, idx); return; }
    if (checkWin(room, idx)) { endGame(room, 1 - idx); return; }
  });

  // ── 관전 가능한 방 목록 ──
  socket.on('list_rooms', () => {
    const list = [];
    for (const [id, room] of Object.entries(rooms)) {
      if (room.phase === 'game' || room.phase === 'draft' || room.phase === 'hp_distribution' || room.phase === 'reveal' || room.phase === 'placement') {
        const mode = room.isAI ? 'ai' : (room.mode === 'team' ? 'team' : '1v1');
        list.push({
          roomId: id,
          p0Name: room.players[0]?.name || '?',
          p1Name: room.players[1]?.name || '?',
          phase: room.phase,
          spectators: (room.spectators || []).length,
          turnNumber: room.turnNumber || 0,
          mode,  // 'ai' | '1v1' | 'team' — 클라 필터용
        });
      }
    }
    socket.emit('room_list', list);
  });

  // 대기 중(입장 가능) 방 목록
  socket.on('list_waiting_rooms', () => {
    const list = [];
    for (const [id, room] of Object.entries(rooms)) {
      if (room.phase !== 'waiting') continue;
      if (room.isAI) continue;
      const max = room.mode === 'team' ? 4 : 2;
      if (room.players.length >= max) continue;
      list.push({
        roomId: id,
        mode: room.mode === 'team' ? 'team' : '1v1',
        playerCount: room.players.length,
        maxPlayers: max,
        players: room.players.map(p => p.name),
      });
    }
    socket.emit('waiting_room_list', list);
  });

  // ── 채팅 ──
  socket.on('chat_msg', ({ text, scope }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    const isSpec = socket.data.isSpectator;
    let name;
    if (pIdx >= 0) {
      name = room.players[pIdx].name || (pIdx === 0 ? '플레이어1' : '플레이어2');
    } else if (isSpec) {
      const spec = (room.spectators || []).find(s => s.socketId === socket.id);
      name = spec ? spec.name : '관전자';
    } else {
      return;
    }
    const color = assignChatColor(room, socket.id);
    // 관전자는 scope 무시하고 항상 전체 채팅만 가능
    const effectiveScope = isSpec ? 'all' : (scope === 'team' ? 'team' : 'all');
    const msg = {
      sender: name, text: String(text).slice(0, 200),
      pIdx: isSpec ? -1 : pIdx, color,
      isSpectator: !!isSpec,
      scope: effectiveScope,
      teamId: pIdx >= 0 ? room.players[pIdx].teamId : null,
    };
    if (isSpec) {
      // 관전자 메시지 → 관전자끼리만
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('chat_msg', msg);
      }
      return;
    }
    // ── 팀 채팅 ──: 팀 내 멤버에게만
    if (effectiveScope === 'team' && room.mode === 'team') {
      const senderTeam = room.players[pIdx].teamId;
      if (senderTeam !== 0 && senderTeam !== 1) return;
      for (const tIdx of (room.teams[senderTeam] || [])) {
        const tp = room.players[tIdx];
        if (tp && tp.socketId && tp.socketId !== 'AI') {
          io.to(tp.socketId).emit('chat_msg', msg);
        }
      }
      // 팀 채팅은 관전자/상대팀에게 안 감
      return;
    }
    // ── 전체 채팅 ──: 모든 플레이어 + 관전자
    for (const p of room.players) {
      if (p.socketId !== 'AI') {
        io.to(p.socketId).emit('chat_msg', msg);
      }
    }
    for (const s of (room.spectators || [])) {
      io.to(s.socketId).emit('chat_msg', msg);
    }
  });

  // ── 연결 끊김 ──
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      // 관전자 제거
      if (socket.data.isSpectator) {
        room.spectators = (room.spectators || []).filter(s => s.socketId !== socket.id);
        return;
      }
      // ── 팀전 대기실 중 한 명 이탈 처리 ──
      if (room.mode === 'team' && room.phase === 'waiting') {
        clearTimer(room);
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (dcIdx >= 0) {
          // 카운트다운이 진행 중이면 취소
          if (room._teamStartTimeout) {
            clearTimeout(room._teamStartTimeout);
            room._teamStartTimeout = null;
            io.to(room.id).emit('team_countdown_cancel');
          }
          room.players.splice(dcIdx, 1);
          for (let t = 0; t < 2; t++) {
            room.teams[t] = (room.teams[t] || []).filter(i => i !== dcIdx).map(i => i > dcIdx ? i - 1 : i);
          }
          room.players.forEach((p, i) => {
            p.index = i;
            if (p.socketId) {
              const s = io.sockets.sockets.get(p.socketId);
              if (s) s.data.idx = i;
            }
          });
          if (room.players.length === 0) {
            delete rooms[roomId];
          } else {
            broadcastTeamRoomState(room);
          }
          return;
        }
      }
      // ── #9: 게임/세팅 중 연결 끊김 — 30초 유예 (재접속 대기) ──
      if (room.phase !== 'waiting' && room.phase !== 'ended') {
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (dcIdx < 0) return;  // 이미 빠져나간 소켓
        const player = room.players[dcIdx];
        const dcName = player.name;

        // 소켓만 비우고 유예 타이머 설정 — 재접속 시 cancel
        player.socketId = null;
        if (player._disconnectTimer) clearTimeout(player._disconnectTimer);
        emitToSpectators(room, 'spectator_log', { msg: `${dcName} 연결 끊김`, type: 'system', playerIdx: dcIdx });
        // 상대에게도 알림 (승리 처리 아직 안 함)
        for (const p of room.players) {
          if (p.socketId && p.socketId !== 'AI') {
            io.to(p.socketId).emit('opp_disconnected_pending', { msg: `${dcName}${조사(dcName, '이', '가')} 연결이 끊겼습니다. 30초 동안 재접속을 기다립니다...`, graceMs: RECONNECT_GRACE_MS });
          }
        }

        player._disconnectTimer = setTimeout(() => {
          if (!rooms[roomId]) return;
          const r2 = rooms[roomId];
          const p2 = r2.players[dcIdx];
          if (!p2 || p2.socketId) return;  // 이미 재접속 또는 방이 바뀜
          // 재접속 안 함 → 기존 패배 처리
          emitToSpectators(r2, 'spectator_log', { msg: `🔌 ${dcName} 재접속 실패. 패배 처리.`, type: 'system', playerIdx: dcIdx });
          if (r2.mode === 'team' && (p2.teamId === 0 || p2.teamId === 1)) {
            endTeamGame(r2, 1 - p2.teamId, 'disconnect');
            return;
          }
          clearTimer(r2);
          const otherIdx = 1 - dcIdx;
          const other = r2.players[otherIdx];
          if (other && other.socketId && other.socketId !== 'AI') {
            io.to(other.socketId).emit('disconnected', { msg: `${dcName} 기권패` });
          }
          emitToSpectators(r2, 'disconnected', { msg: `${dcName} 기권패` });
          r2.phase = 'ended';
        }, RECONNECT_GRACE_MS);
        return;
      }
      if (room.phase === 'waiting') {
        delete rooms[roomId];
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// ── Server Start ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`CALIGO server running:`);
  console.log(`   Local: http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Network: http://${net.address}:${PORT}`);
      }
    }
  }
});
