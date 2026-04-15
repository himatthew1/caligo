const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const ROW_LABELS = ['A','B','C','D','E'];
function coord(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════════
// ── 캐릭터 데이터 (30 characters across 3 tiers) ────────────────
// ══════════════════════════════════════════════════════════════════

const CHARACTERS = {
  1: [
    { type:'archer', name:'궁수', tier:1, atk:1, icon:'🏹', tag:null, desc:'좌측 대각선(/) 전체',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'공격 범위 대각선 방향 반전'}] },
    { type:'spearman', name:'창병', tier:1, atk:1, icon:'🔱', tag:'royal', desc:'세로줄 전체', skills:[] },
    { type:'cavalry', name:'기마병', tier:1, atk:1, icon:'🐎', tag:'royal', desc:'가로줄 전체', skills:[] },
    { type:'watchman', name:'파수꾼', tier:1, atk:0.5, icon:'👁', tag:null, desc:'주변 8칸(자기제외)', skills:[] },
    { type:'twins', name:'쌍둥이 강도', tier:1, atk:1, icon:'👬', tag:'villain', desc:'형:가로3칸, 동생:세로3칸', isTwin:true,
      skills:[{id:'brothers', name:'분신', cost:2, replacesAction:true, desc:'형을 동생에게 또는 동생을 형에게 합류'}] },
    { type:'scout', name:'척후병', tier:1, atk:1, icon:'🔭', tag:'royal', desc:'자신 포함 가로 3칸',
      skills:[{id:'recon', name:'정찰', cost:2, replacesAction:false, desc:'랜덤 적 1개의 행 또는 열 공개'}] },
    { type:'manhunter', name:'인간 사냥꾼', tier:1, atk:1, icon:'🪤', tag:'villain', desc:'자신 포함 세로 3칸',
      skills:[{id:'trap', name:'덫 설치', cost:2, replacesAction:true, desc:'현재 위치에 덫 설치'}] },
    { type:'messenger', name:'전령', tier:1, atk:0.5, icon:'📯', tag:null, desc:'X대각선 5칸(자신포함)',
      skills:[{id:'sprint', name:'질주', cost:1, replacesAction:false, oncePerTurn:true, desc:'이번 턴 이동 2회'}] },
    { type:'gunpowder', name:'화약상', tier:1, atk:1, icon:'💣', tag:null, desc:'상하 각2칸(자기제외)',
      skills:[
        {id:'bomb', name:'시한폭탄 설치', cost:2, replacesAction:false, desc:'주변 8칸 중 한 곳에 폭탄 설치'},
        {id:'detonate', name:'기폭', cost:0, replacesAction:false, oncePerTurn:true, desc:'설치한 폭탄 모두 폭발'}
      ] },
    { type:'herbalist', name:'약초전문가', tier:1, atk:1, icon:'🌿', tag:null, desc:'좌우 각2칸(자기제외)',
      skills:[{id:'herb', name:'약초학', cost:3, replacesAction:false, desc:'주변 3x3 아군 체력+1(자신제외)'}] },
  ],
  2: [
    { type:'general', name:'장군', tier:2, atk:2, icon:'🎖', tag:'royal', desc:'자신 포함 십자 5칸', skills:[] },
    { type:'knight', name:'기사', tier:2, atk:2, icon:'🐴', tag:'royal', desc:'자신 포함 X대각선 5칸', skills:[] },
    { type:'shadowAssassin', name:'그림자 암살자', tier:2, atk:2, icon:'🗡', tag:'villain', desc:'주변 9칸 중 1칸 선택',
      skills:[{id:'shadow', name:'그림자 숨기', cost:1, replacesAction:false, oncePerTurn:true, desc:'다음 턴까지 공격/상태이상 면역'}] },
    { type:'wizard', name:'마법사', tier:2, atk:2, icon:'🧙', tag:null, desc:'한칸 건너뛴 십자 4칸',
      skills:[], passives:['instantMagic'] },
    { type:'armoredWarrior', name:'갑주무사', tier:2, atk:2, icon:'🛡', tag:null, desc:'자신 + 아래 가로3칸(4칸)',
      skills:[], passives:['ironSkin'] },
    { type:'witch', name:'마녀', tier:2, atk:1, icon:'🧹', tag:'villain', desc:'원하는 칸 1곳 지정 공격',
      skills:[{id:'curse', name:'저주', cost:3, replacesAction:true, desc:'적 1명에 저주(턴당 0.5피해+스킬봉인)'}] },
    { type:'dualBlade', name:'양손 검객', tier:2, atk:2, icon:'⚔', tag:null, desc:'좌우 대각선 4칸(col±1,row±1)',
      skills:[{id:'dualStrike', name:'쌍검무', cost:2, replacesAction:false, oncePerTurn:true, desc:'이번 턴 2회 공격'}] },
    { type:'ratMerchant', name:'쥐 장수', tier:2, atk:1, icon:'🐀', tag:'villain', desc:'제자리 + 쥐 위치',
      skills:[{id:'rats', name:'역병의 자손들', cost:2, replacesAction:false, desc:'스킬 사용 시 쥐가 없는 보드 랜덤 3곳에 쥐를 소환합니다. 쥐가 있는 칸은 쥐 장수의 공격 범위에 포함됩니다. 이 스킬은 행동을 소비하지 않으며, SP가 있는 한 여러번 사용 가능합니다.'}] },
    { type:'weaponSmith', name:'무기상', tier:2, atk:2, icon:'⚒', tag:null, desc:'자신 포함 가로3칸(토글)',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'가로↔세로 공격 범위 전환'}] },
    { type:'bodyguard', name:'호위 무사', tier:2, atk:2, icon:'🛡️', tag:'royal', desc:'십자 4칸(자기제외)',
      skills:[], passives:['loyalty'] },
  ],
  3: [
    { type:'prince', name:'왕자', tier:3, atk:3, icon:'👑', tag:'royal', desc:'자신 포함 좌우 3칸', skills:[] },
    { type:'princess', name:'공주', tier:3, atk:3, icon:'🌸', tag:'royal', desc:'자신 포함 상하 3칸', skills:[] },
    { type:'king', name:'국왕', tier:3, atk:2, icon:'♛', tag:'royal', desc:'자신의 칸',
      skills:[{id:'ring', name:'절대복종 반지', cost:3, replacesAction:false, desc:'적 말 이름 선언+위치 지정→강제 이동'}] },
    { type:'dragonTamer', name:'드래곤 조련사', tier:3, atk:2, icon:'🐉', tag:null, desc:'X대각선 4칸(자기제외)',
      skills:[{id:'dragon', name:'드래곤 소환', cost:5, replacesAction:false, oncePerTurn:true, desc:'드래곤 유닛 소환(3HP, 십자5칸, ATK3)'}] },
    { type:'monk', name:'수도승', tier:3, atk:1, icon:'🙏', tag:null, desc:'상하 각1칸(자기제외)',
      skills:[{id:'divine', name:'신성', cost:4, replacesAction:false, desc:'아군 1명 체력+2, 상태이상 제거(자신제외)'}],
      passives:['grace'] },
    { type:'slaughterHero', name:'학살 영웅', tier:3, atk:1, icon:'🪓', tag:'villain', desc:'3x3 전체 9칸',
      skills:[], passives:['betrayer'] },
    { type:'commander', name:'지휘관', tier:3, atk:2, icon:'📋', tag:'royal', desc:'좌우 각1칸(자기제외)',
      skills:[], passives:['wrath'] },
    { type:'sulfurCauldron', name:'유황이 끓는 솥', tier:3, atk:0.5, icon:'🔥', tag:'royal', desc:'주변 8칸(자기제외)',
      skills:[{id:'sulfurRiver', name:'유황범람', cost:3, replacesAction:true, desc:'현재 보드 테두리 전체 공격, 피해2'}] },
    { type:'torturer', name:'고문 기술자', tier:3, atk:2, icon:'⛓', tag:'villain', desc:'자신 + 바로 아래(2칸)',
      skills:[{id:'nightmare', name:'악몽', cost:2, replacesAction:false, desc:'표식 상태의 모든 적에게 피해1'}],
      passives:['markPassive'] },
    { type:'count', name:'백작', tier:3, atk:2, icon:'🦇', tag:'villain', desc:'X대각선 5칸(자신포함)',
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

function createRoom(id) {
  return {
    id,
    players: [],
    phase: 'waiting',      // waiting -> draft -> initial_reveal -> exchange_draft -> final_reveal -> hp_distribution -> placement -> game -> ended
    currentPlayerIdx: 0,
    turnNumber: 0,
    draftDone:     [false, false],
    hpDone:        [false, false],
    initialRevealDone: [false, false],
    exchangeDone:  [false, false],
    finalRevealDone: [false, false],
    revealDone:    [false, false],   // kept for legacy compatibility
    placementDone: [false, false],
    isAI: false,
    // SP system: starts 1 each, +1 each per 10 turns, per-player max 10, pool max 10, stop after turn 50
    sp: [1, 1],
    // Instant SP: one-time-use SP from wizard passive (not part of influence graph)
    instantSp: [0, 0],
    // Board bounds
    boardBounds: { min: 0, max: 4 },
    boardShrunk: false,
    // Board objects: traps, bombs (per player arrays)
    boardObjects: [[], []],
    // Rats per player
    rats: [[], []],
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
  const sec = (phase === 'draft') ? DRAFT_TIMER_SECONDS : TIMER_SECONDS;
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
        const timeoutMsg = allFilled
          ? '시간초과로 자동 확정 됐습니다.'
          : '시간초과로 빈 슬롯이 랜덤으로 선택됐습니다.';
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
        player.pieces[0].name = '쌍둥이(형)';
        player.pieces[1].type = 'twins_younger';
        player.pieces[1].name = '쌍둥이(동생)';
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

// 캐릭터 데이터 조회 헬퍼
function findCharData(type, tier) {
  const ch = CHARACTERS[tier]?.find(c => c.type === type);
  if (!ch) return { type, name: type, icon: '?', desc: '' };
  return { type: ch.type, name: ch.name, icon: ch.icon, desc: ch.desc, tag: ch.tag, atk: ch.atk, range: ch.range, skills: ch.skills || [], passives: ch.passives || [] };
}

// ── 교환 드래프트: 같은 티어 내 1캐릭터 교환 가능 (90초) ──
function transitionToExchangeDraft(room) {
  clearTimer(room);
  room.phase = 'exchange_draft';
  if (room.isAI) {
    // AI는 교환하지 않음
    room.exchangeDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      // 각 티어에서 교환 가능한 캐릭터 목록 (자신이 이미 선택한 것 제외)
      const available = {};
      for (const tier of [1, 2, 3]) {
        const myType = tier === 1 ? p.draft.t1 : tier === 2 ? p.draft.t2 : p.draft.t3;
        available[tier] = CHARACTERS[tier]
          .filter(c => c.type !== myType)
          .map(c => ({ type: c.type, name: c.name, icon: c.icon, desc: c.desc, tag: c.tag, atk: c.atk, range: c.range }));
      }
      io.to(p.socketId).emit('exchange_draft_phase', {
        myDraft: p.draft,
        available,
        oppDraft: room.players[1 - i].draft,
      });
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'exchange_draft',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
  });
  startTimer(room, 'exchange_draft', () => exchangeDraftTimeout(room));
}

function exchangeDraftTimeout(room) {
  if (room.phase !== 'exchange_draft') return;
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
  room.phase = 'final_reveal';
  if (room.isAI) {
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
      room.players[1].pieces[0].name = '쌍둥이(형)';
      room.players[1].pieces[1].type = 'twins_younger';
      room.players[1].pieces[1].name = '쌍둥이(동생)';
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

  const base = {
    type, tier, name: c.name, icon: c.icon, atk: c.atk, tag: c.tag,
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

function resolveDamage(room, attackerPiece, defenderPiece, attackerIdx, baseDamage, isStatusDmg) {
  const defender = room.players[1 - attackerIdx];
  const attacker = room.players[attackerIdx];
  let dmg = baseDamage;

  // Status damage pipeline (curse): only shadow blocks
  if (isStatusDmg) {
    if (defenderPiece.statusEffects.some(e => e.type === 'shadow')) return 0;
    return dmg;
  }

  // Step 2: Commander buff - if attacker is in commander's cross (up/down/left/right 1), +1 damage
  if (attacker) {
    for (const p of attacker.pieces) {
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
      emitToBoth(room, 'passive_alert', { type: 'armoredWarrior', msg: `🛡 갑주무사의 아이언 스킨! 피해 0.5 감소!` });
      const defName = room.players[1 - attackerIdx].name;
      emitToSpectators(room, 'spectator_log', { msg: `🛡 ${defName}의 갑주무사 아이언 스킨 발동! 피해 0.5 감소`, type: 'passive', playerIdx: 1 - attackerIdx });
    }
  }

  // Step 6: Monk being attacked by villain => damage = 0.5
  if (defenderPiece.type === 'monk' && attackerPiece.tag === 'villain') {
    dmg = 0.5;
    emitToBoth(room, 'passive_alert', { type: 'monk', msg: `🙏 수도승의 가호! 악인의 공격 피해가 0.5로 감소!` });
    const defName = room.players[1 - attackerIdx].name;
    emitToSpectators(room, 'spectator_log', { msg: `🙏 ${defName}의 수도승 가호 발동! 악인의 공격 피해 0.5로 감소`, type: 'passive', playerIdx: 1 - attackerIdx });
  }

  // Step 7: Count hit by tier 1 or 2 => -0.5
  if (defenderPiece.type === 'count' && (attackerPiece.tier === 1 || attackerPiece.tier === 2)) {
    const before = dmg;
    dmg = Math.max(0, dmg - 0.5);
    if (before !== dmg) {
      emitToBoth(room, 'passive_alert', { type: 'count', msg: `🧛 백작의 패시브! ${attackerPiece.tier}티어 공격 피해 0.5 감소!` });
      const defName = room.players[1 - attackerIdx].name;
      emitToSpectators(room, 'spectator_log', { msg: `🧛 ${defName}의 백작 패시브 발동! ${attackerPiece.tier}티어 공격 피해 0.5 감소`, type: 'passive', playerIdx: 1 - attackerIdx });
    }
  }

  // Step 8: Bodyguard passive — 왕실 아군 피해를 1로 줄이고 대신 받음 (항상 활성)
  if (defenderPiece.tag === 'royal' && defenderPiece.type !== 'bodyguard') {
    const bodyguardPiece = defender.pieces.find(p => p.type === 'bodyguard' && p.alive);
    if (bodyguardPiece) {
      // Redirect: original target takes 0, bodyguard takes 1
      bodyguardPiece.hp = Math.max(0, bodyguardPiece.hp - 1);
      emitToBoth(room, 'passive_alert', { type: 'bodyguard', msg: `🛡 호위무사가 ${defenderPiece.name} 대신 피해를 받았습니다!` });
      const defName = room.players[1 - attackerIdx].name;
      emitToSpectators(room, 'spectator_log', { msg: `🛡 ${defName}의 호위무사가 ${defenderPiece.name} 대신 피해를 받았습니다!`, type: 'passive', playerIdx: 1 - attackerIdx });
      if (bodyguardPiece.hp <= 0) {
        bodyguardPiece.alive = false;
        handleDeath(room, bodyguardPiece, 1 - attackerIdx);
      }
      return 0;
    }
  }

  return Math.max(0, dmg);
}

function setKillInfo(room, type, killer, victims) {
  room.lastKillInfo = { type, killer, victims: (victims || []).map(v => v.name || v) };
}

function handleDeath(room, deadPiece, ownerIdx) {
  deadPiece.alive = false;
  const owner = room.players[ownerIdx];

  // Curse spread: curse spreads to nearby allies on death (3x3)
  const curseEffect = deadPiece.statusEffects.find(e => e.type === 'curse');
  if (curseEffect) {
    for (const ally of owner.pieces) {
      if (ally.alive && ally !== deadPiece) {
        if (Math.abs(ally.col - deadPiece.col) <= 1 && Math.abs(ally.row - deadPiece.row) <= 1) {
          if (!ally.statusEffects.some(e => e.type === 'curse')) {
            if (ally.type === 'monk') continue; // Monk immune to villain status
            ally.statusEffects.push({ type: 'curse', source: curseEffect.source });
          }
        }
      }
    }
  }

  // Bomb auto-detonate on gunpowder death
  if (deadPiece.type === 'gunpowder') {
    const bombs = room.boardObjects[ownerIdx].filter(o => o.type === 'bomb');
    for (const bomb of bombs) {
      detonateBomb(room, ownerIdx, bomb);
    }
    room.boardObjects[ownerIdx] = room.boardObjects[ownerIdx].filter(o => o.type !== 'bomb');
  }

  // Dragon tamer dies: dragon stays alive (independent unit)

  // Witch death: remove all curses sourced from this player
  if (deadPiece.type === 'witch') {
    for (const pl of room.players) {
      for (const p of pl.pieces) {
        if (p.alive) {
          p.statusEffects = p.statusEffects.filter(e => !(e.type === 'curse' && e.source === ownerIdx));
        }
      }
    }
  }
}

function detonateBomb(room, ownerIdx, bomb) {
  const opponent = room.players[1 - ownerIdx];
  const hits = [];
  for (const ep of opponent.pieces) {
    if (ep.alive && ep.col === bomb.col && ep.row === bomb.row) {
      const dmg = resolveDamage(room, { type: 'gunpowder', tag: null, tier: 1, col: bomb.col, row: bomb.row }, ep, ownerIdx, 1, false);
      ep.hp = Math.max(0, ep.hp - dmg);
      if (ep.hp <= 0) {
        handleDeath(room, ep, 1 - ownerIdx);
      }
      // Wizard passive: SP on bomb hit
      if (ep.type === 'wizard') {
        room.instantSp[1 - ownerIdx] += 1;
        emitSPUpdate(room);
        emitToBoth(room, 'passive_alert', { type: 'wizard', msg: `✨ 마법사가 폭탄에 피격! 인스턴트 SP +1 획득!` });
        const wizOwnerName = room.players[1 - ownerIdx].name;
        emitToSpectators(room, 'spectator_log', { msg: `✨ ${wizOwnerName}의 마법사가 폭탄에 피격! SP +1`, type: 'passive', playerIdx: 1 - ownerIdx });
      }
      hits.push({ col: ep.col, row: ep.row, damage: dmg, newHp: ep.hp, destroyed: !ep.alive, type: ep.type, name: ep.name, icon: ep.icon });
    }
  }
  emitToBoth(room, 'bomb_detonated', { col: bomb.col, row: bomb.row, hits });
  const bombKilled = hits.filter(h => h.destroyed);
  if (bombKilled.length > 0) {
    setKillInfo(room, 'bomb', null, bombKilled.map(k => ({ name: k.name })));
  }
  return hits;
}

function processAttack(room, attackerIdx, atkPiece, atkCells, extraDamage) {
  const defender = room.players[1 - attackerIdx];
  const attacker = room.players[attackerIdx];
  const baseDmg = (extraDamage !== undefined) ? extraDamage : atkPiece.atk;
  const hitResults = [];

  for (const cell of atkCells) {
    for (let dpi = 0; dpi < defender.pieces.length; dpi++) {
      const defPiece = defender.pieces[dpi];
      if (defPiece.alive && defPiece.col === cell.col && defPiece.row === cell.row) {
        const dmg = resolveDamage(room, atkPiece, defPiece, attackerIdx, baseDmg, false);
        defPiece.hp = Math.max(0, defPiece.hp - dmg);
        const destroyed = defPiece.hp <= 0;
        if (destroyed) {
          handleDeath(room, defPiece, 1 - attackerIdx);
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
          attackerSub: atkPiece.subUnit || null,
          attackerName: atkPiece.name,
          attackerIcon: atkPiece.icon,
        });

        // Post-damage: torturer passive mark
        if (atkPiece.type === 'torturer' && !destroyed) {
          // 호위 무사 패시브: 왕실 아군 상태이상도 대신 받음
          let markTarget = defPiece;
          if (defPiece.tag === 'royal' && defPiece.type !== 'bodyguard') {
            const bg = defender.pieces.find(p => p.type === 'bodyguard' && p.alive);
            if (bg) markTarget = bg;
          }
          if (!markTarget.statusEffects.some(e => e.type === 'mark')) {
            markTarget.statusEffects.push({ type: 'mark', source: attackerIdx });
            emitToBoth(room, 'passive_alert', { type: 'torturer', msg: `⛓ 고문 기술자가 ${markTarget.name}에게 표식을 새겼습니다!` });
            const atkName = room.players[attackerIdx].name;
            emitToSpectators(room, 'spectator_log', { msg: `⛓ ${atkName}의 고문 기술자가 ${markTarget.name}에게 표식!`, type: 'passive', playerIdx: attackerIdx });
          }
        }

        // (마녀 저주는 이제 직접 대상 지정 스킬로 변경됨)

        // Post-damage: wizard passive (defender is wizard, gain 1 instant SP per hit, even on death)
        if (defPiece.type === 'wizard') {
          room.instantSp[1 - attackerIdx] += 1;
          emitSPUpdate(room);
          emitToBoth(room, 'passive_alert', { type: 'wizard', msg: `✨ 마법사 피격! 인스턴트 SP +1 획득!` });
          const defName = room.players[1 - attackerIdx].name;
          emitToSpectators(room, 'spectator_log', { msg: `✨ ${defName}의 마법사 피격! 인스턴트 SP +1 획득`, type: 'passive', playerIdx: 1 - attackerIdx });
        }
      }
    }
  }

  // SlaughterHero passive: allies in attack range take 0.5 dmg
  if (atkPiece.type === 'slaughterHero') {
    const attackerName = room.players[attackerIdx].name;
    for (const cell of atkCells) {
      for (const allyPiece of attacker.pieces) {
        if (allyPiece.alive && allyPiece !== atkPiece && allyPiece.col === cell.col && allyPiece.row === cell.row) {
          allyPiece.hp = Math.max(0, allyPiece.hp - 1);
          emitToBoth(room, 'passive_alert', { type: 'slaughterHero', msg: `⚔ ${attackerName}의 학살 영웅이 적군을 공격했습니다! 광역에 아군 ${allyPiece.name}이(가) 휘말림! (1 피해)` });
          emitToSpectators(room, 'spectator_log', { msg: `⚔ ${attackerName}의 학살 영웅 광역에 아군 ${allyPiece.name} 휘말림! (1 피해)`, type: 'passive', playerIdx: attackerIdx });
          if (allyPiece.hp <= 0) {
            handleDeath(room, allyPiece, attackerIdx);
          }
        }
      }
    }
  }

  // Destroy rats hit by attacks (opponent's rats)
  for (const cell of atkCells) {
    room.rats[1 - attackerIdx] = room.rats[1 - attackerIdx].filter(
      r => !(r.col === cell.col && r.row === cell.row)
    );
  }

  // Track kill info for game-over messages
  const killed = hitResults.filter(h => h.destroyed);
  if (killed.length > 0) {
    setKillInfo(room, 'attack', atkPiece.name, killed.map(k => ({ name: k.revealedName })));
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
  const totalSp = room.sp[playerIdx] + room.instantSp[playerIdx];
  if (totalSp < amount) return false;
  // Consume instant SP first (disappears permanently, no transfer to opponent)
  let remaining = amount;
  const instantUsed = Math.min(room.instantSp[playerIdx], remaining);
  room.instantSp[playerIdx] -= instantUsed;
  remaining -= instantUsed;
  // Then consume regular SP (transfers to opponent)
  if (remaining > 0) {
    room.sp[playerIdx] -= remaining;
    room.sp[1 - playerIdx] = Math.min(room.sp[1 - playerIdx] + remaining, 10);
  }
  emitSPUpdate(room);
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
    { prefix: '🏹 정비:', rewrite: (m) => `🏹 ${playerName}의 궁수가 정비를 사용! ${m.replace('🏹 정비: ', '')}` },
    { prefix: '👬 분신:', rewrite: (m) => `👬 ${playerName}의 ${m.replace('👬 분신: ', '')}` },
    { prefix: '🪤 덫 설치:', rewrite: (m) => `🪤 ${playerName}의 인간 사냥꾼이 덫을 설치!` },
    { prefix: '📯 질주:', rewrite: (m) => `📯 ${playerName}의 전령이 질주를 사용! 이번 턴 2회 이동` },
    { prefix: '💥 기폭:', rewrite: (m) => `💥 ${playerName}의 화약상이 기폭! ${m.replace('💥 기폭: ', '')}` },
    { prefix: '💣 폭탄 설치:', rewrite: (m) => `💣 ${playerName}의 화약상이 ${m.replace('💣 폭탄 설치: ', '')}` },
    { prefix: '🌿 약초학:', rewrite: (m) => `🌿 ${playerName}의 약초전문가가 약초학을 사용! ${m.replace('🌿 약초학: ', '')}` },
    { prefix: '🗡 그림자 숨기:', rewrite: (m) => `🗡 ${playerName}의 그림자 암살자가 은신!` },
    { prefix: '🧙 저주:', rewrite: (m) => `🧹 ${playerName}의 마녀가 ${m.replace('🧙 저주: ', '')}` },
    { prefix: '⚔ 쌍검무:', rewrite: (m) => `⚔ ${playerName}의 양손 검객이 쌍검무를 사용! 이번 턴 2회 공격` },
    { prefix: '⚒ 정비:', rewrite: (m) => `⚒ ${playerName}의 무기상이 정비를 사용! ${m.replace('⚒ 정비: ', '')}` },
    { prefix: '♛ 절대복종 반지:', rewrite: (m) => `♛ ${playerName}의 국왕이 절대복종 반지를 사용! ${m.replace('♛ 절대복종 반지: ', '')}` },
    { prefix: '🙏 신성:', rewrite: (m) => `🙏 ${playerName}의 수도승이 신성을 사용! ${m.replace('🙏 신성: ', '')}` },
    { prefix: '🔥 유황범람:', rewrite: (m) => `🔥 ${playerName}의 유황이 끓는 솥이 유황범람을 사용! 보드 테두리 전체 공격 (피해 2)` },
    { prefix: '⛓ 악몽:', rewrite: (m) => `⛓ ${playerName}의 고문 기술자가 악몽을 사용! ${m.replace('⛓ 악몽: ', '')}` },
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

  // Process curse damage at the start of this player's turn
  // Curse does 0.5 dmg per opponent's turn start
  for (const p of player.pieces) {
    if (p.alive) {
      const curse = p.statusEffects.find(e => e.type === 'curse');
      if (curse) {
        // Check if source witch is alive
        const sourceIdx = curse.source;
        const sourceWitch = room.players[sourceIdx]?.pieces.find(pc => pc.type === 'witch' && pc.alive);
        if (!sourceWitch || p.hp <= 1) {
          // 마녀 사망 또는 대상 HP ≤ 1이면 저주 해제
          p.statusEffects = p.statusEffects.filter(e => e.type !== 'curse');
          const reason = !sourceWitch ? '마녀 사망' : 'HP 1 도달';
          emitToBoth(room, 'passive_alert', { type: 'curse_removed', msg: `☠ ${p.name}의 저주가 해제되었습니다! (${reason})` });
          emitToSpectators(room, 'spectator_log', { msg: `☠ ${p.name}의 저주 해제 (${reason})`, type: 'passive', playerIdx: idx });
        } else {
          p.hp = Math.max(0, p.hp - 0.5);
          if (p.hp <= 0) {
            handleDeath(room, p, idx);
          }
        }
      }
    }
  }

  // SP gain every 10 turns (+1 each), per-player max 10, pool max 10, stop after turn 50
  if (room.turnNumber > 0 && room.turnNumber % 10 === 0 && room.turnNumber <= 50) {
    const poolTotal = room.sp[0] + room.sp[1];
    if (poolTotal < 10) {
      room.sp[0] = Math.min(room.sp[0] + 1, 10);
      room.sp[1] = Math.min(room.sp[1] + 1, 10);
      // Pool limit 10 체크: 초과분 잘라내기
      const newTotal = room.sp[0] + room.sp[1];
      if (newTotal > 10) {
        const excess = newTotal - 10;
        room.sp[1] = Math.max(0, room.sp[1] - excess);
      }
    }
    emitSPUpdate(room);
    emitToBoth(room, 'turn_event', { type: 'sp_grant', msg: '턴 이벤트 : 새로운 SP가 지급되었습니다.' });
  }

  // Board shrink warning (turn 40+)
  if (room.turnNumber >= 40 && !room.boardShrunk) {
    const remaining = 50 - room.turnNumber;
    if (remaining > 0) {
      emitToBoth(room, 'board_shrink_warning', { turnsRemaining: remaining, turnsLeft: remaining });
    }
  }

  // Board shrink at turn 50
  if (room.turnNumber >= 50 && !room.boardShrunk) {
    room.boardShrunk = true;
    room.boardBounds = { min: 1, max: 3 };
    const eliminated = [];
    for (let pi = 0; pi < room.players.length; pi++) {
      const pl = room.players[pi];
      for (const p of pl.pieces) {
        if (p.alive && !inBounds(p.col, p.row, room.boardBounds)) {
          p.alive = false;
          p.hp = 0;
          eliminated.push({ type: p.type, name: p.name, icon: p.icon, col: p.col, row: p.row, owner: pi });
        }
      }
    }
    // Remove board objects outside bounds
    for (let i = 0; i < 2; i++) {
      room.boardObjects[i] = room.boardObjects[i].filter(o => inBounds(o.col, o.row, room.boardBounds));
      room.rats[i] = room.rats[i].filter(r => inBounds(r.col, r.row, room.boardBounds));
    }
    emitToBoth(room, 'board_shrink', { newBounds: room.boardBounds, bounds: room.boardBounds, eliminated });

    // Check board shrink wins/draw
    const p0Dead = checkWin(room, 0);
    const p1Dead = checkWin(room, 1);
    if (p0Dead && p1Dead) {
      setKillInfo(room, 'shrink', null, []);
      endGame(room, -1, 'draw');
      return;
    }
    if (p0Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 1, 'shrink'); return; }
    if (p1Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 0, 'shrink'); return; }
  }
}

function endTurn(room) {
  room.currentPlayerIdx = 1 - room.currentPlayerIdx;
  room.turnNumber++;

  const curIdx = room.currentPlayerIdx;
  const prevIdx = 1 - curIdx;
  const cur = room.players[curIdx];
  const prev = room.players[prevIdx];

  // Process turn-start effects
  processTurnStart(room);

  // Check wins after curse damage
  if (checkWin(room, 0)) { endGame(room, 1); return; }
  if (checkWin(room, 1)) { endGame(room, 0); return; }

  const turnData = {
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    skillPoints: room.sp,
    boardBounds: room.boardBounds,
  };

  // AI turn
  if (room.isAI && curIdx === 1) {
    emitToPlayer(room, prevIdx, 'opp_turn', {
      ...turnData,
      oppPieces: oppPieceSummary(cur.pieces),
      boardObjects: boardObjectsSummary(room, prevIdx),
    });
    // AI 턴에도 타이머 리셋 (플레이어에게 시각적 표시)
    startTimer(room, 'game', () => turnTimeout(room));
    setTimeout(() => {
      if (room.phase === 'game') aiTakeTurn(room);
    }, 3000);
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
  emitToSpectators(room, 'spectator_log', { msg: `[턴 ${room.turnNumber}] ${curPlayer.name}의 차례`, type: 'system', playerIdx: room.currentPlayerIdx });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  // 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));
}

function endGame(room, winnerIdx, reason) {
  clearTimer(room);
  room.phase = 'ended';
  const killInfo = room.lastKillInfo || {};
  const reasonObj = reason === 'surrender' ? { type: 'surrender' }
    : reason === 'shrink' ? { type: 'shrink' }
    : reason === 'draw' ? { type: 'draw' }
    : reason === 'disconnect' ? { type: 'disconnect' }
    : { type: killInfo.type || 'attack', killer: killInfo.killer || null, victims: killInfo.victims || [] };

  // Draw (both sides eliminated by board shrink)
  if (reason === 'draw') {
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

  emitToPlayer(room, winnerIdx, 'game_over', { win: true, opponentName: loser.name, finalPieces: finalPiecesW, reason: reasonObj });
  emitToPlayer(room, 1 - winnerIdx, 'game_over', { win: false, opponentName: winner.name, finalPieces: finalPiecesL, reason: reasonObj });
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

  // Check SP (regular + instant)
  if ((room.sp[playerIdx] + room.instantSp[playerIdx]) < cost) return { ok: false, msg: 'SP가 부족합니다.' };

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
      const dir = piece.toggleState === 'right' ? '우대각선(\\)' : '좌대각선(/)';
      result.msg = `🏹 정비: 궁수의 공격 범위를 ${dir}(으)로 반전했습니다.`;
      result.oppMsg = `🏹 상대가 정비를 사용해 궁수의 공격 범위를 바꿨습니다.`;
      result.data.toggleState = piece.toggleState;
      break;
    }

    // ── TWINS: 의좋은형제 (move one twin to the other) ──
    case 'twins_elder':
    case 'twins_younger': {
      const otherSub = piece.subUnit === 'elder' ? 'younger' : 'elder';
      const otherTwin = player.pieces.find(p => p.subUnit === otherSub && p.alive);
      if (!otherTwin) return { ok: false, msg: '상대 쌍둥이가 없습니다.' };

      const mover = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'elder' && p.alive)
        : player.pieces.find(p => p.subUnit === 'younger' && p.alive);
      const target = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'younger' && p.alive)
        : player.pieces.find(p => p.subUnit === 'elder' && p.alive);

      if (!mover || !target) return { ok: false, msg: '대상이 없습니다.' };
      mover.col = target.col;
      mover.row = target.row;
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      const moverLabel = mover.subUnit === 'elder' ? '형' : '동생';
      const targetLabel = target.subUnit === 'elder' ? '형' : '동생';
      result.msg = `👬 분신: 쌍둥이 ${moverLabel}이(가) 쌍둥이 ${targetLabel}에게 합류했습니다!`;
      result.oppMsg = `👬 상대의 쌍둥이 ${moverLabel}이(가) 분신을 사용해 쌍둥이 ${targetLabel}을(를) 합류시켰습니다!`;
      break;
    }

    // ── SCOUT: 정찰 (reveal random enemy's row or col) ──
    case 'scout': {
      const enemyPieces = room.players[1 - playerIdx].pieces.filter(p => p.alive && !p.isDragon);
      if (enemyPieces.length === 0) return { ok: false, msg: '적이 없습니다.' };
      const target = enemyPieces[Math.floor(Math.random() * enemyPieces.length)];
      const axis = Math.random() < 0.5 ? 'row' : 'col';
      const value = axis === 'row' ? target.row : target.col;
      spendSP(room, playerIdx, cost);
      emitToPlayer(room, playerIdx, 'scout_result', { axis, value, targetName: target.name });
      emitToPlayer(room, 1 - playerIdx, 'skill_result', { msg: '🔭 상대방이 정찰을 사용했습니다!' });
      emitToSpectators(room, 'spectator_log', { msg: `🔭 ${player.name}의 척후병이 정찰! ${target.name}의 위치 정보를 알아냈다!`, type: 'skill', playerIdx: playerIdx });
      result.skipLog = true;
      break;
    }

    // ── MANHUNTER: 덫 설치 ──
    case 'manhunter': {
      room.boardObjects[playerIdx].push({ type: 'trap', col: piece.col, row: piece.row, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `🪤 덫 설치: 현재 위치에 덫을 설치했습니다.`;
      result.oppMsg = `🪤 상대가 덫을 설치했습니다.`;
      break;
    }

    // ── MESSENGER: 스퍼트 (double move this turn) ──
    case 'messenger': {
      piece.messengerSprintActive = true;
      piece.messengerMovesLeft = 2;
      spendSP(room, playerIdx, cost);
      result.msg = `📯 질주: 전령이 이번 턴 2회 이동합니다.`;
      result.oppMsg = `📯 상대 전령이 질주를 사용했습니다.`;
      break;
    }

    // ── GUNPOWDER: 시한폭탄 설치 / 기폭 ──
    case 'gunpowder': {
      if (skillId === 'detonate') {
        // 기폭: 설치한 폭탄 모두 폭발 (SP 0)
        const bombs = room.boardObjects[playerIdx].filter(o => o.type === 'bomb');
        if (bombs.length === 0) return { ok: false, msg: '설치된 폭탄이 없습니다.' };
        const allHits = [];
        for (const bomb of bombs) {
          const hits = detonateBomb(room, playerIdx, bomb);
          allHits.push(...hits);
        }
        room.boardObjects[playerIdx] = room.boardObjects[playerIdx].filter(o => o.type !== 'bomb');
        result.msg = `💥 기폭: 폭탄 ${bombs.length}개 폭발!`;
        result.oppMsg = `💥 상대가 폭탄을 기폭했습니다!`;
        result.data.hits = allHits;
        break;
      }
      // 시한폭탄 설치
      const tc = params?.col ?? piece.col;
      const tr = params?.row ?? piece.row;
      if (Math.abs(tc - piece.col) > 1 || Math.abs(tr - piece.row) > 1) {
        return { ok: false, msg: '자신 또는 인접 8칸에만 설치 가능합니다.' };
      }
      if (!inBounds(tc, tr, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      room.boardObjects[playerIdx].push({ type: 'bomb', col: tc, row: tr, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `💣 폭탄 설치: ${coord(tc,tr)}에 폭탄을 설치했습니다.`;
      result.oppMsg = `💣 상대가 폭탄을 설치했습니다.`;
      break;
    }

    // ── HERBALIST: 약초학 (heal 3x3 allies +1 HP, not self) ──
    case 'herbalist': {
      let healed = 0;
      for (const ally of player.pieces) {
        if (ally.alive && ally !== piece && Math.abs(ally.col - piece.col) <= 1 && Math.abs(ally.row - piece.row) <= 1) {
          ally.hp = Math.min(ally.maxHp, ally.hp + 1);
          healed++;
        }
      }
      spendSP(room, playerIdx, cost);
      result.msg = `🌿 약초학: 아군 ${healed}명 치유 (+1 HP)`;
      result.oppMsg = `🌿 상대가 약초학을 사용해 아군을 치유했습니다.`;
      break;
    }

    // ── SHADOW ASSASSIN: 그림자 숨기 ──
    case 'shadowAssassin': {
      if (piece.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '이미 그림자 상태입니다.' };
      }
      piece.statusEffects.push({ type: 'shadow', source: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `🗡 그림자 숨기: 그림자 암살자가 은신했습니다.`;
      result.oppMsg = `🗡 상대의 그림자 암살자가 은신했습니다.`;
      break;
    }

    // ── WITCH: 저주 (직접 대상 지정 — 턴당 0.5 피해 + 스킬 봉인) ──
    case 'witch': {
      const tIdx = params?.targetPieceIdx;
      const opponent = room.players[1 - playerIdx];
      if (tIdx === undefined || !opponent.pieces[tIdx]) {
        return { ok: false, msg: '저주 대상을 선택하세요.' };
      }
      const target = opponent.pieces[tIdx];
      if (!target.alive || target.hp <= 1) {
        return { ok: false, msg: 'HP가 1 이하인 대상에게는 저주를 걸 수 없습니다.' };
      }
      if (target.statusEffects.some(e => e.type === 'curse')) {
        return { ok: false, msg: '이미 저주 상태입니다.' };
      }
      if (target.type === 'monk') {
        return { ok: false, msg: '수도승에게는 저주가 통하지 않습니다.' };
      }
      target.statusEffects.push({ type: 'curse', source: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `🧙 저주: ${target.name}에게 저주를 걸었습니다.`;
      result.oppMsg = `🧙 상대 마녀가 아군 ${target.name}에게 저주를 걸었습니다.`;
      break;
    }

    // ── DUAL BLADE: 쌍검무 (이번 턴 2회 풀 공격) ──
    case 'dualBlade': {
      piece.dualBladeAttacksLeft = 2;
      spendSP(room, playerIdx, cost);
      result.msg = `⚔ 쌍검무: 이번 턴 2회 공격 가능`;
      result.oppMsg = `⚔ 상대가 쌍검무를 사용했습니다.`;
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
      emitToBoth(room, 'rats_spawned', { rats: newRats, owner: playerIdx });
      emitToSpectators(room, 'spectator_log', { msg: `🐀 ${player.name}의 쥐 장수가 역병의 자손들을 사용! 쥐 ${newRats.length}마리 소환!`, type: 'skill', playerIdx });
      result.msg = ``;
      result.skipLog = true;
      break;
    }

    // ── WEAPON SMITH: 정비 (toggle horizontal/vertical) ──
    case 'weaponSmith': {
      piece.toggleState = (piece.toggleState === 'vertical') ? null : 'vertical';
      spendSP(room, playerIdx, cost);
      const wsDir = piece.toggleState === 'vertical' ? '세로' : '가로';
      result.msg = `⚒ 정비: 무기상의 공격 범위를 ${wsDir}(으)로 전환했습니다.`;
      result.oppMsg = `⚒ 상대가 정비를 사용해 무기상의 공격 범위를 바꿨습니다.`;
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
      const enemyPiece = room.players[1 - playerIdx].pieces.find(p => p.alive && p.type === targetName);
      if (!enemyPiece) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
      if (enemyPiece.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '그림자 상태인 적에게는 사용할 수 없습니다.' };
      }
      enemyPiece.col = destCol;
      enemyPiece.row = destRow;
      spendSP(room, playerIdx, cost);
      result.msg = `♛ 절대복종 반지: ${enemyPiece.name}을(를) ${coord(destCol,destRow)}로 강제 이동!`;
      result.oppMsg = `♛ 상대 국왕이 절대복종 반지를 사용했습니다!`;

      // Check if moved onto a trap
      const trapIdx2 = room.boardObjects[playerIdx].findIndex(o => o.type === 'trap' && o.col === destCol && o.row === destRow);
      if (trapIdx2 >= 0) {
        room.boardObjects[playerIdx].splice(trapIdx2, 1);
        const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: destCol, row: destRow }, enemyPiece, playerIdx, 1, false);
        enemyPiece.hp = Math.max(0, enemyPiece.hp - dmg);
        if (enemyPiece.hp <= 0) handleDeath(room, enemyPiece, 1 - playerIdx);
        emitToBoth(room, 'trap_triggered', {
          col: destCol, row: destRow,
          pieceInfo: { type: enemyPiece.type, name: enemyPiece.name, icon: enemyPiece.icon },
          damage: dmg,
        });
      }
      break;
    }

    // ── DRAGON TAMER: 드래곤 소환 ──
    case 'dragonTamer': {
      // 보드 위 드래곤이 이미 1마리 있으면 소환 불가
      const existingDragon = player.pieces.find(p => p.isDragon && p.alive);
      if (existingDragon) return { ok: false, msg: '보드 위에 이미 드래곤이 있습니다. (최대 1마리)' };
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
      dragon.desc = '자신+십자4칸 (5칸)';
      player.pieces.push(dragon);
      spendSP(room, playerIdx, cost);
      emitToBoth(room, 'dragon_spawned', { dragon: { col: dc, row: dr, hp: 3 }, owner: playerIdx });
      emitToSpectators(room, 'spectator_log', { msg: `🐉 ${player.name}의 드래곤 조련사가 ${coord(dc,dr)}에 드래곤 소환!`, type: 'skill', playerIdx });
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
      target.statusEffects = [];
      spendSP(room, playerIdx, cost);
      result.msg = `🙏 신성: ${target.name}의 HP+2, 상태이상 제거.`;
      result.oppMsg = `🙏 상대가 신성을 사용해 아군을 회복했습니다.`;
      break;
    }

    // ── SULFUR CAULDRON: 유황의 강 (border attack, dmg 3) ──
    case 'sulfurCauldron': {
      const borderCells = getBorderCells(bounds);
      const hits = processAttack(room, playerIdx, { ...piece, atk: 2, type: 'sulfurCauldron' }, borderCells, 2);
      const sulfurKilled = hits.filter(h => h.destroyed);
      if (sulfurKilled.length > 0) {
        setKillInfo(room, 'sulfur', null, sulfurKilled.map(k => ({ name: k.revealedName })));
      }
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `🔥 유황범람: 보드 테두리 전체 공격! (피해 2)`;
      result.oppMsg = `🔥 상대가 유황범람을 사용했습니다!`;
      result.data.hits = hits;
      result.data.borderCells = borderCells;
      break;
    }

    // ── TORTURER: 악몽 (damage all marked enemies) ──
    case 'torturer': {
      const enemies = room.players[1 - playerIdx].pieces.filter(p => p.alive);
      const hasMarked = enemies.some(p => p.statusEffects.some(e => e.type === 'mark'));
      if (!hasMarked) return { ok: false, msg: '표식 상태의 적이 없어 악몽을 사용할 수 없습니다.' };
      const marked = enemies.filter(p => p.statusEffects.some(e => e.type === 'mark'));
      const hits = [];
      for (const m of marked) {
        const dmg = resolveDamage(room, piece, m, playerIdx, 1, false);
        m.hp = Math.max(0, m.hp - dmg);
        if (m.hp <= 0) handleDeath(room, m, 1 - playerIdx);
        hits.push({ col: m.col, row: m.row, damage: dmg, newHp: m.hp, destroyed: !m.alive, name: m.name });
      }
      const nightmareKilled = hits.filter(h => h.destroyed);
      if (nightmareKilled.length > 0) {
        setKillInfo(room, 'nightmare', piece.name, nightmareKilled.map(k => ({ name: k.name })));
      }
      spendSP(room, playerIdx, cost);
      result.msg = `⛓ 악몽: 표식 대상 ${marked.length}명 공격!`;
      result.oppMsg = `⛓ 상대 고문 기술자가 악몽을 사용했습니다!`;
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
  brain.probMap[row][col] = 2;
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = col + dc, nr = row + dr;
    if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
      brain.probMap[nr][nc] = Math.max(brain.probMap[nr][nc], 8);
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
  // Penalize edge cells if board shrink is approaching
  if (room.turnNumber >= 35 && !room.boardShrunk) {
    if (newCol === 0 || newCol === 4 || newRow === 0 || newRow === 4) {
      score *= 0.3;
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
function aiNotifySkill(room, pieceIdx, result) {
  if (!result || !result.ok) return;
  const piece = room.players[1].pieces[pieceIdx];
  // 플레이어에게 status_update
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
        skillName: piece.skillName || '',
      },
    });
  }
  // 관전자에게 로그
  if (!result.skipLog && result.msg) {
    const specMsg = buildSpectatorSkillMsg('AI', piece, result);
    emitToSpectators(room, 'spectator_log', { msg: specMsg, type: 'skill', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
}

// AI executeSkill wrapper — 실행 후 알림
function aiExecSkill(room, pidx, skillId, params) {
  const result = executeSkill(room, 1, pidx, skillId, params || {});
  aiNotifySkill(room, pidx, result);
  return result;
}

// AI 스킬 사용 판단 (free skills — 행동 전에 사용)
function aiUsePreSkills(room) {
  const aiPlayer = room.players[1];
  const brain = room.aiBrain;
  const alivePieces = aiPlayer.pieces.filter(p => p.alive);

  for (const piece of alivePieces) {
    if (!piece.hasSkill || piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
    const pidx = aiPlayer.pieces.indexOf(piece);

    switch (piece.type) {
      // 그림자 암살자: 피격 기억 있거나 HP 낮으면 그림자 사용
      case 'shadowAssassin': {
        const mem = brain.hitMemory[piece.type];
        const recentlyHit = mem && brain.turnCount - mem.turn <= 2;
        if (!piece.statusEffects.some(e => e.type === 'shadow') && (recentlyHit || piece.hp <= piece.maxHp * 0.5)) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 호위무사: 패시브 — 스킬 핸들러 불필요
      // 마녀: replacesAction=true이므로 aiUseActionSkills에서 처리
      // 궁수/무기상: 현재 공격 범위에 히트가 적으면 토글
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
        if (altScore > curScore * 1.3) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 전령: 도망 필요 시 스프린트
      case 'messenger': {
        const mem = brain.hitMemory[piece.type];
        if (mem && brain.turnCount - mem.turn <= 1) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 척후병: 정찰 사용
      case 'scout': {
        if (brain.mode === 'scan' && Math.random() < 0.6) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 약초전문가: 인접 아군이 다쳐 있으면 치유
      case 'herbalist': {
        const nearbyInjured = alivePieces.filter(a =>
          a !== piece && a.hp < a.maxHp &&
          Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1
        );
        if (nearbyInjured.length >= 1) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 쥐장수: 쥐가 적으면 소환
      case 'ratMerchant': {
        if (room.rats[1].length < 2) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 고문기술자: 표식 적이 있으면 악몽
      case 'torturer': {
        const marked = room.players[0].pieces.filter(p => p.alive && p.statusEffects.some(e => e.type === 'mark'));
        if (marked.length >= 1) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 양손검객: 공격 예정이면 쌍검무 활성화 (공격 전에 사용)
      case 'dualBlade': {
        if (Math.random() < 0.7) {
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 수도승: 아군 중 HP 낮은 유닛 치유
      case 'monk': {
        const injured = alivePieces.filter(a => a !== piece && a.hp < a.maxHp).sort((a, b) => a.hp - b.hp);
        if (injured.length > 0 && injured[0].hp <= injured[0].maxHp * 0.5) {
          const targetIdx = aiPlayer.pieces.indexOf(injured[0]);
          aiExecSkill(room, pidx, );
        }
        break;
      }
      // 드래곤 조련사: SP 충분하고 보드 위 드래곤 없으면
      case 'dragonTamer': {
        const aiHasDragon = room.players[1].pieces.some(p => p.isDragon && p.alive);
        if (!aiHasDragon && (room.sp[1] + room.instantSp[1]) >= 5) {
          // 빈 칸 찾기
          const b = room.boardBounds;
          const emptyCells = [];
          for (let r = b.min; r <= b.max; r++)
            for (let c = b.min; c <= b.max; c++) {
              let occ = false;
              for (const pl of room.players)
                if (pl.pieces.some(p => p.alive && p.col === c && p.row === r)) { occ = true; break; }
              if (!occ) emptyCells.push({ col: c, row: r });
            }
          if (emptyCells.length > 0) {
            const pos = randomPick(emptyCells);
            aiExecSkill(room, pidx, );
          }
        }
        break;
      }
    }
  }
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
  setTimeout(() => {
    if (room.phase === 'game') endTurn(room);
  }, AI_ACTION_DELAY);
}

function aiTakeTurn(room) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const bounds = room.boardBounds;

  brain.turnCount++;
  aiSpreadProbability(brain);

  const alivePieces = aiPlayer.pieces.filter(p => p.alive);
  if (alivePieces.length === 0) return;

  // ★ STEP 1: 행동 전 free 스킬 사용
  aiUsePreSkills(room);

  // ★ STEP 2: 피격된 말 도망 우선 판단
  const fleeList = aiFindFleeingPieces(room);
  if (fleeList.length > 0 && !aiPlayer.actionDone) {
    const flee = fleeList[0];
    const piece = flee.piece;

    // 맞은 위치에서 가장 멀어지는 방향으로 이동
    const mem = brain.hitMemory[piece.type];
    let bestMove = null;
    let bestDist = -1;

    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = piece.col + dc, nr = piece.row + dr;
      if (!inBounds(nc, nr, bounds)) continue;
      const dist = Math.abs(nc - mem.col) + Math.abs(nr - mem.row);
      // 이동 후 공격 점수도 고려
      const atkScore = aiScoreMove(brain, piece, nc, nr, room);
      const fleeScore = dist * 15 + atkScore;
      if (fleeScore > bestDist) {
        bestDist = fleeScore;
        bestMove = { col: nc, row: nr };
      }
    }

    if (bestMove) {
      aiExecuteMove(room, { piece, pieceIdx: flee.pieceIdx, col: bestMove.col, row: bestMove.row });
      return;
    }
  }

  // ★ STEP 3: 행동 대체 스킬 사용 (manhunter 덫, gunpowder 폭탄, sulfurCauldron)
  if (!aiPlayer.actionDone) {
    for (const piece of alivePieces) {
      if (!piece.hasSkill || !piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
      const pidx = aiPlayer.pieces.indexOf(piece);

      if (piece.type === 'manhunter') {
        // 확률적 상으로 덫 설치
        if (Math.random() < 0.4) {
          aiExecSkill(room, pidx, );
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'gunpowder') {
        // 기존 폭탄이 있으면 기폭 우선 고려 (SP 0)
        const existingBombs = room.boardObjects[1].filter(o => o.type === 'bomb');
        if (existingBombs.length > 0 && Math.random() < 0.6) {
          aiExecSkill(room, pidx, );
        } else if (Math.random() < 0.5 && (room.sp[1] + room.instantSp[1]) >= 2) {
          // 인접 8칸 중 확률이 가장 높은 위치에 폭탄 설치
          let bestBombCell = null, bestBombScore = -1;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nc = piece.col + dc, nr = piece.row + dr;
              if (!inBounds(nc, nr, bounds)) continue;
              const score = brain.probMap[nr]?.[nc] || 0;
              if (score > bestBombScore) { bestBombScore = score; bestBombCell = { col: nc, row: nr }; }
            }
          }
          if (bestBombCell && bestBombScore > 3) {
            aiExecSkill(room, pidx, );
            aiPlayer.actionDone = true;
            aiEndTurn(room);
            return;
          }
        }
      }
      if (piece.type === 'witch') {
        // 마녀: 저주할 적 선택 (HP 높은 스킬 보유자 우선)
        const enemies = room.players[0].pieces.filter(p => p.alive && !p.statusEffects.some(e => e.type === 'curse') && p.type !== 'monk');
        if (enemies.length > 0 && Math.random() < 0.5) {
          // 스킬 보유자나 고HP 대상 우선
          enemies.sort((a, b) => (b.hasSkill ? 1 : 0) - (a.hasSkill ? 1 : 0) || b.hp - a.hp);
          const target = enemies[0];
          const tIdx = room.players[0].pieces.indexOf(target);
          aiExecSkill(room, pidx, );
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'sulfurCauldron' && (room.sp[1] + room.instantSp[1]) >= piece.skillCost) {
        // 적이 테두리에 있을 확률이 높으면 사용
        const borderCells = getBorderCells(bounds);
        let borderScore = 0;
        for (const c of borderCells) borderScore += brain.probMap[c.row]?.[c.col] || 0;
        if (borderScore > 20) {
          aiExecSkill(room, pidx, );
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
    }
  }

  // ★ STEP 4: 일반 공격 vs 이동 판단
  let bestAction = null;

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
    const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: action.col, row: action.row }, piece, 0, 1, false);
    piece.hp = Math.max(0, piece.hp - dmg);
    if (piece.hp <= 0) {
      handleDeath(room, piece, 1);
      setKillInfo(room, 'trap', null, [{ name: piece.name }]);
    }
    emitToBoth(room, 'trap_triggered', {
      col: action.col, row: action.row,
      pieceInfo: { type: piece.type, name: piece.name, icon: piece.icon },
      damage: dmg,
    });
  }

  emitToPlayer(room, 0, 'opp_moved', { msg: `${room.players[1].name}이(가) 이동했습니다.`, prevCol, prevRow, col: action.col, row: action.row });
  emitToSpectators(room, 'spectator_log', { msg: `${piece.icon}${piece.name} 이동`, type: 'move', playerIdx: 1 });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  aiPlayer.actionDone = true;
  aiEndTurn(room);
}

function aiExecuteAttack(room, action) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const piece = action.piece;
  const bounds = room.boardBounds;

  const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, action.extra);
  const hitResults = processAttack(room, 1, piece, atkCells);

  aiProcessAttackResult(brain, atkCells, hitResults);

  emitToPlayer(room, 0, 'being_attacked', {
    atkCells,
    hitPieces: hitResults.map(h => {
      const dp = humanPlayer.pieces.find(p => p.col === h.col && p.row === h.row);
      return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed, name: dp?.name, icon: dp?.icon };
    }),
    yourPieces: pieceSummary(humanPlayer.pieces),
  });
  // 관전자에게 공격 결과 전송
  if (hitResults.length > 0) {
    for (const h of hitResults) {
      const dp = humanPlayer.pieces.find(p => p.col === h.col && p.row === h.row);
      const targetName = dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row);
      emitToSpectators(room, 'spectator_log', { msg: `⚔ AI의 ${piece.icon}${piece.name} → ${targetName} ${h.damage}피해${h.destroyed ? ' 💀 격파!' : ''}`, type: 'hit', playerIdx: 1 });
    }
  } else {
    emitToSpectators(room, 'spectator_log', { msg: `⚔ AI의 ${piece.icon}${piece.name} 공격 — 빗나감!`, type: 'miss', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  if (checkWin(room, 0)) {
    endGame(room, 1);
    return;
  }

  // ★ 공격 후 dualBlade 추가 공격 (쌍검무 활성화된 경우 2번째 공격)
  if (piece.dualBladeAttacksLeft > 0) {
    piece.dualBladeAttacksLeft--;
    const extraCells = getAttackCells(piece.type, piece.col, piece.row, bounds);
    const extraHits = processAttack(room, 1, piece, extraCells);
    aiProcessAttackResult(brain, extraCells, extraHits);
    emitToPlayer(room, 0, 'being_attacked', {
      atkCells: extraCells,
      hitPieces: extraHits.map(h => {
        const dp = humanPlayer.pieces.find(p => p.col === h.col && p.row === h.row);
        return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed, name: dp?.name, icon: dp?.icon };
      }),
      yourPieces: pieceSummary(humanPlayer.pieces),
    });
    if (checkWin(room, 0)) { endGame(room, 1); return; }
  }

  aiPlayer.actionDone = true;
  aiEndTurn(room);
}

// ══════════════════════════════════════════════════════════════════
// ── Socket Events ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {

  // ── 캐릭터 데이터 요청 (덱빌더용) ──
  socket.on('request_characters', () => {
    socket.emit('characters_data', { characters: CHARACTERS });
  });

  // ── 방 입장 ──
  socket.on('join_room', ({ roomId, playerName, deck }) => {
    if (rooms[roomId] && rooms[roomId].phase === 'ended') {
      delete rooms[roomId];
    }
    if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];

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
    room.players.push({
      socketId: socket.id, name: playerName, index: idx,
      pieces: [], draft: playerDraft, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = idx;
    room.draftDone[idx] = true;

    socket.emit('joined', { idx, roomId, playerName, characters: CHARACTERS });

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

  // ── AI 연습 모드 ──
  socket.on('join_ai', ({ playerName, deck }) => {
    const roomId = `ai_${socket.id}_${Date.now()}`;
    rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    room.isAI = true;
    room.aiBrain = initAiBrain();

    // 덱 유효성 검사 후 드래프트로 사용
    const playerDraft = validateDeck(deck);

    room.players.push({
      socketId: socket.id, name: playerName, index: 0,
      pieces: [], draft: playerDraft, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = 0;

    room.players.push({
      socketId: 'AI', name: 'AI', index: 1,
      pieces: [], draft: null, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });

    socket.emit('joined', { idx: 0, roomId, playerName, characters: CHARACTERS });
    socket.emit('opponent_joined', { opponentName: 'AI' });

    const aiDraft = aiSelectPieces();
    room.players[1].draft = aiDraft;
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
      player.pieces[0].name = '쌍둥이(형)';
      player.pieces[1].type = 'twins_younger';
      player.pieces[1].name = '쌍둥이(동생)';
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
        socket.emit('err', { msg: 'HP 합계는 10, 각 최소 1 최대 8. (3개 필요)' }); return;
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
      socket.emit('err', { msg: 'HP 합계는 10, 각 유닛 최소 1 최대 8. (3개 필요)' }); return;
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

  // ── 초기 공개 확인 ──
  socket.on('confirm_initial_reveal', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'initial_reveal') return;
    const idx = socket.data.idx;
    room.initialRevealDone[idx] = true;

    if (room.initialRevealDone.every(d => d)) {
      transitionToExchangeDraft(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방을 기다리는 중...' });
    }
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
        socket.emit('wait_msg', { msg: '상대방의 교환을 기다리는 중...' });
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
      socket.emit('wait_msg', { msg: '상대방의 교환을 기다리는 중...' });
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

    // Check if action already done (unless messenger sprint is active)
    if (player.actionDone && !player.pieces[pieceIdx]?.messengerSprintActive) {
      socket.emit('err', { msg: '이미 행동을 사용했습니다.' }); return;
    }

    // Action-replace skill used => can't move
    if (player.actionUsedSkillReplace) {
      socket.emit('err', { msg: '행동 대체 스킬을 사용했으므로 이동할 수 없습니다.' }); return;
    }

    const piece = player.pieces[pieceIdx];
    if (!piece || !piece.alive) { socket.emit('err', { msg: '올바르지 않은 말입니다.' }); return; }

    // 쌍둥이 이동 중에는 쌍둥이만 이동 가능
    if (player.twinMovedSubs && player.twinMovedSubs.length > 0 && !piece.subUnit) {
      socket.emit('err', { msg: '쌍둥이 이동 중입니다. 나머지 쌍둥이를 이동시키세요.' }); return;
    }
    if (!inBounds(col, row, room.boardBounds)) { socket.emit('err', { msg: '보드 밖입니다.' }); return; }
    if (!isCrossAdjacent(piece.col, piece.row, col, row)) {
      socket.emit('err', { msg: '상하좌우 1칸만 이동할 수 있습니다.' }); return;
    }

    const prev = { col: piece.col, row: piece.row };
    piece.col = col;
    piece.row = row;

    // Check trap
    const trapIdx = room.boardObjects[1 - idx].findIndex(o => o.type === 'trap' && o.col === col && o.row === row);
    if (trapIdx >= 0) {
      room.boardObjects[1 - idx].splice(trapIdx, 1);
      const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col, row }, piece, 1 - idx, 1, false);
      piece.hp = Math.max(0, piece.hp - dmg);
      // Wizard passive: SP on trap hit
      if (piece.type === 'wizard') {
        room.instantSp[idx] += 1;
        emitSPUpdate(room);
        emitToBoth(room, 'passive_alert', { type: 'wizard', msg: `✨ 마법사가 덫에 피격! 인스턴트 SP +1 획득!` });
        emitToSpectators(room, 'spectator_log', { msg: `✨ ${player.name}의 마법사가 덫에 피격! SP +1`, type: 'passive', playerIdx: idx });
      }
      if (piece.hp <= 0) {
        handleDeath(room, piece, idx);
        setKillInfo(room, 'trap', null, [{ name: piece.name }]);
      }
      emitToBoth(room, 'trap_triggered', {
        col, row,
        pieceInfo: { type: piece.type, name: piece.name, icon: piece.icon },
        damage: dmg,
      });
    }

    // ★ 쌍둥이 이동: 둘 다 살아있으면 각각 이동해야 행동 완료
    if (piece.subUnit) {
      // 이미 이동한 쌍둥이인지 확인
      if (!player.twinMovedSubs) player.twinMovedSubs = [];
      if (player.twinMovedSubs.includes(piece.subUnit)) {
        socket.emit('err', { msg: '이미 이동한 쌍둥이입니다. 다른 쪽을 이동시키세요.' }); return;
      }
      player.twinMovedSubs.push(piece.subUnit);

      const otherSub = piece.subUnit === 'elder' ? 'younger' : 'elder';
      const otherTwin = player.pieces.find(p => p.subUnit === otherSub && p.alive);
      if (otherTwin) {
        if (player.twinMovedSubs.length >= 2) {
          // 둘 다 이동 완료
          player.actionDone = true;
          player.twinMovedSubs = [];
        }
        // 아직 1명만 이동 → actionDone 안 함
      } else {
        // 다른 쌍둥이 죽음 → 혼자 이동으로 행동 완료
        player.actionDone = true;
        player.twinMovedSubs = [];
      }
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

    socket.emit('move_ok', {
      pieceIdx, prev, col, row,
      yourPieces: pieceSummary(player.pieces),
      boardObjects: boardObjectsSummary(room, idx),
      twinMovePending: piece.subUnit && !player.actionDone,
      twinMovedSub: piece.subUnit || null,  // 어느 쪽이 이동했는지
    });
    const opp = room.players[1 - idx];
    if (opp.socketId !== 'AI') {
      io.to(opp.socketId).emit('opp_moved', { msg: `${room.players[playerIdx].name}이(가) 이동했습니다.`, prevCol: prev.col, prevRow: prev.row, col, row });
    }
    emitToSpectators(room, 'spectator_log', { msg: `🚶 ${player.name}의 ${piece.icon}${piece.name} 이동: ${coord(prev.col,prev.row)} → ${coord(col,row)}`, type: 'move', playerIdx: idx });
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // Check win after trap damage
    if (checkWin(room, idx)) {
      endGame(room, 1 - idx);
      return;
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
          };
        });
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
              const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row);
              return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed, name: dp?.name, icon: dp?.icon };
            }),
            yourPieces: pieceSummary(defender.pieces),
          });
        }
        // 관전자 로그: 쌍검무 추가 공격
        if (hitResults.length > 0) {
          for (const h of hitResults) {
            const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row);
            const targetName = dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row);
            emitToSpectators(room, 'spectator_log', { msg: `⚔ ${player.name}의 ${atkPiece.icon}${atkPiece.name} → ${targetName} ${h.damage}피해${h.destroyed ? ' 💀 격파!' : ''}`, type: 'hit', playerIdx: idx });
          }
        } else {
          emitToSpectators(room, 'spectator_log', { msg: `⚔ ${player.name}의 ${atkPiece.icon}${atkPiece.name} 공격 — 빗나감!`, type: 'miss', playerIdx: idx });
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

    const cellResults = atkCells.map(cell => {
      const hit = hitResults.find(h => h.col === cell.col && h.row === cell.row);
      return {
        col: cell.col, row: cell.row, hit: !!hit,
        damage: hit ? hit.damage : 0, destroyed: hit ? hit.destroyed : false,
        revealedType: hit?.revealedType, revealedName: hit?.revealedName, revealedIcon: hit?.revealedIcon,
        hitName: hit?.hitName, hitIcon: hit?.hitIcon,
        defPieceIdx: hit?.defPieceIdx,
        attackerSub: hit?.attackerSub, attackerName: hit?.attackerName, attackerIcon: hit?.attackerIcon,
      };
    });
    socket.emit('attack_result', {
      pieceIdx, cellResults, anyHit: hitResults.length > 0,
      oppPieces: oppPieceSummary(defender.pieces),
      yourPieces: pieceSummary(player.pieces),
    });

    if (defender.socketId !== 'AI') {
      io.to(defender.socketId).emit('being_attacked', {
        atkCells,
        hitPieces: hitResults.map(h => {
          const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row);
          return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed, name: dp?.name, icon: dp?.icon };
        }),
        yourPieces: pieceSummary(defender.pieces),
      });
    }

    // 관전자 로그: 일반 공격
    if (hitResults.length > 0) {
      for (const h of hitResults) {
        const dp = defender.pieces.find(p => p.col === h.col && p.row === h.row);
        const targetName = dp ? `${dp.icon}${dp.name}` : coord(h.col,h.row);
        emitToSpectators(room, 'spectator_log', { msg: `⚔ ${player.name}의 ${atkPiece.icon}${atkPiece.name} → ${targetName} ${h.damage}피해${h.destroyed ? ' 💀 격파!' : ''}`, type: 'hit', playerIdx: idx });
      }
    } else {
      emitToSpectators(room, 'spectator_log', { msg: `⚔ ${player.name}의 ${atkPiece.icon}${atkPiece.name} 공격 — 빗나감!`, type: 'miss', playerIdx: idx });
    }

    // AI 피격 기억 + 공격자 위치 추론
    if (room.isAI && 1 - idx === 1 && room.aiBrain) {
      for (const h of hitResults) {
        const hitPiece = defender.pieces.find(p => p.col === h.col && p.row === h.row && p.alive);
        if (hitPiece) {
          aiRecordHit(room.aiBrain, hitPiece);
        }
      }
      // 공격 범위 셀로부터 공격자 위치 추론: 공격 셀들의 중심 근처에 적이 있을 가능성 높음
      if (atkCells.length > 0) {
        const avgCol = atkCells.reduce((s, c) => s + c.col, 0) / atkCells.length;
        const avgRow = atkCells.reduce((s, c) => s + c.row, 0) / atkCells.length;
        // 공격 범위 셀 근처 확률 대폭 증가
        for (const c of atkCells) {
          if (c.row >= 0 && c.row < 5 && c.col >= 0 && c.col < 5) {
            room.aiBrain.probMap[c.row][c.col] = Math.max(room.aiBrain.probMap[c.row][c.col], 7);
          }
        }
        // 중심점 근처는 더 높은 확률
        const cr = Math.round(avgRow), cc = Math.round(avgCol);
        if (cr >= 0 && cr < 5 && cc >= 0 && cc < 5) {
          room.aiBrain.probMap[cr][cc] = Math.max(room.aiBrain.probMap[cr][cc], 9);
        }
      }
    }

    // 쌍검무: 첫 번째 공격 후 추가 공격 남아있으면 actionDone 유지하되 공격 허용
    if (atkPiece.dualBladeAttacksLeft > 0) {
      atkPiece.dualBladeAttacksLeft--;
      player.actionDone = true; // actionDone이지만 위 분기에서 추가 공격 허용
    } else {
      player.actionDone = true;
    }

    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    if (checkWin(room, 1 - idx)) {
      endGame(room, idx);
      return;
    }

    // DON'T auto end turn - wait for 'end_turn' event
  });

  // ── 턴 종료 ──
  // ── 기권 ──
  socket.on('surrender', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) return;
    emitToSpectators(room, 'spectator_log', { msg: `🏳 ${room.players[idx].name}이(가) 기권했습니다!`, type: 'system', playerIdx: idx });
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

  // ── 스킬 사용 ──
  socket.on('use_skill', ({ pieceIdx, skillId, params }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const result = executeSkill(room, idx, pieceIdx, skillId, params || {});
    if (!result.ok) {
      socket.emit('err', { msg: result.msg });
      return;
    }

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
    });

    // Update opponent with skill details
    const skillPiece = room.players[idx].pieces[pieceIdx];
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
          icon: skillPiece.icon,
          name: skillPiece.name,
          skillName: skillPiece.skillName,
        },
      });
    }

    // 관전자에게 상세 스킬 로그 전송
    if (!result.skipLog) {
      const specSkillMsg = buildSpectatorSkillMsg(room.players[idx].name, skillPiece, result);
      emitToSpectators(room, 'spectator_log', { msg: specSkillMsg, type: 'skill', playerIdx: idx });
    }
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // Check win after skill effects
    if (checkWin(room, 0)) { endGame(room, 1); return; }
    if (checkWin(room, 1)) { endGame(room, 0); return; }
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
      msg: `폭탄 기폭: (${bomb.col},${bomb.row})`,
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
        list.push({
          roomId: id,
          p0Name: room.players[0]?.name || '?',
          p1Name: room.players[1]?.name || '?',
          phase: room.phase,
          spectators: (room.spectators || []).length,
          turnNumber: room.turnNumber || 0,
        });
      }
    }
    socket.emit('room_list', list);
  });

  // ── 채팅 ──
  socket.on('chat_msg', ({ text }) => {
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
    const msg = { sender: name, text: String(text).slice(0, 200), pIdx: isSpec ? -1 : pIdx, color, isSpectator: !!isSpec };
    if (isSpec) {
      // 관전자 메시지 → 관전자끼리만
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('chat_msg', msg);
      }
    } else {
      // 플레이어 메시지 → 플레이어 + 관전자
      for (const p of room.players) {
        if (p.socketId !== 'AI') {
          io.to(p.socketId).emit('chat_msg', msg);
        }
      }
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('chat_msg', msg);
      }
    }
  });

  // ── 연결 끊김 ──
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      clearTimer(room);
      // 관전자 제거
      if (socket.data.isSpectator) {
        room.spectators = (room.spectators || []).filter(s => s.socketId !== socket.id);
        return;
      }
      if (room.phase !== 'waiting' && room.phase !== 'ended') {
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        const dcName = dcIdx >= 0 ? room.players[dcIdx].name : '알 수 없음';
        const otherIdx = dcIdx >= 0 ? 1 - dcIdx : -1;
        const otherName = otherIdx >= 0 ? room.players[otherIdx].name : '';
        // 남은 플레이어에게
        if (otherIdx >= 0) {
          emitToPlayer(room, otherIdx, 'disconnected', { msg: `${dcName}이(가) 연결을 끊었습니다. 승리!` });
        }
        // 관전자에게
        emitToSpectators(room, 'disconnected', { msg: `${dcName}이(가) 접속을 끊어 ${otherName}이(가) 승리했습니다!` });
        room.phase = 'ended';
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
