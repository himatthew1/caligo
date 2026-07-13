// ── CALIGO 결정화(determinized) 롤아웃 기반 행동선택 (MCTS-lite) ─────────────
//   탐욕 1-ply 휴리스틱 대신, 내 belief(probMap)에서 적 위치를 샘플 → 각 후보 행동을
//   적용 후 게임을 끝까지 롤아웃(양측 탐욕 정책) → 승률로 평가 → 최선 행동 선택.
//   헤드리스 시뮬(server.js, 1200판/초)을 재사용. fog 존중(치팅 없음).
//
//   검증: node ai-mcts.js [games] [D]   (MCTS측 vs 탐욕측, 무스킬 덱)
'use strict';
const S = require('./server.js');
const { createRoom, createPiece, getTeamBrain, aiTeamTakeTurn, endTurn,
        processAttack, getAttackCells } = S;

const clone = (o) => JSON.parse(JSON.stringify(o));
const ORTHO = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// ── 내 후보 행동 열거: 말마다 (공격=사거리 패턴 발사) + (인접 빈칸 이동) ──
function enumerateActions(room, meIdx) {
  const bounds = room.boardBounds;
  const me = room.players[meIdx];
  const mine = new Set(me.pieces.filter(p => p.alive).map(p => `${p.col},${p.row}`));
  const acts = [];
  me.pieces.forEach((p, pi) => {
    if (!p.alive) return;
    acts.push({ kind: 'attack', pi });
    for (const [dc, dr] of ORTHO) {
      const c = p.col + dc, r = p.row + dr;
      if (c < bounds.min || c > bounds.max || r < bounds.min || r > bounds.max) continue;
      if (mine.has(`${c},${r}`)) continue;
      acts.push({ kind: 'move', pi, col: c, row: r });
    }
  });
  return acts;
}

// 행동 적용 (현재 플레이어 = meIdx) 후 턴 종료.
function applyAction(room, meIdx, act) {
  const p = room.players[meIdx].pieces[act.pi];
  if (!p || !p.alive) { endTurn(room); return; }
  if (act.kind === 'attack') {
    const cells = getAttackCells(p.type, p.col, p.row, room.boardBounds);
    try { processAttack(room, meIdx, p, cells, undefined, { suppressSpUpdate: true }); } catch (e) {}
  } else {
    // 이동 — 대상 칸이 비어있으면 이동, 아니면 제자리(헛턴)
    const occ = room.players.some(pl => pl.pieces.some(q => q.alive && q.col === act.col && q.row === act.row));
    if (!occ) { p.col = act.col; p.row = act.row; }
  }
  room.players[meIdx].actionDone = true;
  endTurn(room);
}

// belief(probMap)에서 적 위치 nEnemy개 가중 샘플 (내 말 칸 제외).
function sampleEnemyCells(brain, bounds, nEnemy, occupied) {
  const cells = [];
  for (let r = bounds.min; r <= bounds.max; r++)
    for (let c = bounds.min; c <= bounds.max; c++) {
      if (occupied.has(`${c},${r}`)) continue;
      cells.push({ c, r, w: (brain.probMap[r]?.[c] || 0) + 0.05 });
    }
  const picked = [];
  for (let k = 0; k < nEnemy && cells.length; k++) {
    let tot = cells.reduce((s, x) => s + x.w, 0), t = Math.random() * tot, i = 0;
    while (i < cells.length - 1 && t > cells[i].w) { t -= cells[i].w; i++; }
    picked.push(cells[i]); cells.splice(i, 1);
  }
  return picked;
}

// 결정화 롤아웃 룸: 내 진짜 말(복제) + 샘플된 generic 적('general' atk2/hp3).
function buildDetRoom(realRoom, meIdx, enemyCells, myPiecesClone) {
  const foeIdx = 1 - meIdx;
  const room = createRoom('mcts-' + Math.random().toString(36).slice(2, 7), { mode: 'pvp' });
  room._headless = true; room.isAI = true; room.phase = 'game';
  room.turnNumber = realRoom.turnNumber; room.currentPlayerIdx = meIdx;
  room.boardBounds = { ...realRoom.boardBounds };
  room.boardShrinkLevel = realRoom.boardShrinkLevel;
  room.boardShrinkStage = realRoom.boardShrinkStage;
  room.boardShrunk = realRoom.boardShrunk;
  room.sp = [...realRoom.sp]; room.instantSp = [...realRoom.instantSp];

  const mePlayer = {
    socketId: 'AI', name: 'ME', index: meIdx, pieces: myPiecesClone.map(clone),
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    teamId: meIdx, slotPos: 0, alive: true,
  };
  const foePieces = enemyCells.map((e, i) => {
    const pc = createPiece('general', 2, 3);
    pc.col = e.c; pc.row = e.r; return pc;
  });
  const foePlayer = {
    socketId: 'AI', name: 'FOE', index: foeIdx, pieces: foePieces,
    actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [],
    teamId: foeIdx, slotPos: 0, alive: true,
  };
  room.players = meIdx === 0 ? [mePlayer, foePlayer] : [foePlayer, mePlayer];
  S.rooms[room.id] = room;
  getTeamBrain(room, 0); getTeamBrain(room, 1);
  return room;
}

function rolloutWinner(room, meIdx) {
  let g = 0;
  while (room.phase === 'game' && g++ < 300) {
    const idx = room.currentPlayerIdx, before = room.turnNumber;
    try { aiTeamTakeTurn(room, idx); } catch (e) { break; }
    if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) endTurn(room);
  }
  const myAlive = room.players[meIdx].pieces.filter(p => p.alive).length;
  const foeAlive = room.players[1 - meIdx].pieces.filter(p => p.alive).length;
  S.rooms[room.id] && delete S.rooms[room.id];
  if (myAlive > 0 && foeAlive === 0) return 1;
  if (foeAlive > 0 && myAlive === 0) return 0;
  return 0.5;
}

// ── 메인: 결정화 롤아웃으로 최선 행동 선택 ──
function mctsChooseAction(realRoom, meIdx, opts = {}) {
  const D = opts.D || 8;                    // 결정화 샘플 수
  const brain = getTeamBrain(realRoom, meIdx);
  const bounds = realRoom.boardBounds;
  const me = realRoom.players[meIdx];
  const myAlivePieces = me.pieces.filter(p => p.alive);
  if (myAlivePieces.length === 0) return null;
  const nEnemy = opts.nEnemy != null ? opts.nEnemy
    : realRoom.players[1 - meIdx].pieces.filter(p => p.alive).length;
  if (nEnemy === 0) return null;

  const acts = enumerateActions(realRoom, meIdx);
  if (acts.length === 0) return null;
  const myPiecesSnapshot = me.pieces.map(clone);
  const occupied = new Set(myAlivePieces.map(p => `${p.col},${p.row}`));

  let best = null, bestScore = -1;
  for (const act of acts) {
    let total = 0;
    for (let d = 0; d < D; d++) {
      const enemyCells = sampleEnemyCells(brain, bounds, nEnemy, occupied);
      const det = buildDetRoom(realRoom, meIdx, enemyCells, myPiecesSnapshot);
      applyAction(det, meIdx, act);
      total += rolloutWinner(det, meIdx);
    }
    const avg = total / D;
    if (avg > bestScore) { bestScore = avg; best = act; }
  }
  return best;
}

module.exports = { mctsChooseAction, enumerateActions, applyAction };

// ── 검증 CLI: MCTS측 vs 탐욕측 (무스킬 덱) ──
if (require.main === module) {
  const NOSKILL = { 1: ['spearman', 'cavalry'], 2: ['general', 'knight'], 3: ['prince', 'princess', 'count', 'commander', 'slaughterHero'] };
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const games = parseInt(process.argv[2], 10) || 40;
  const D = parseInt(process.argv[3], 10) || 6;

  function buildPlayer(idx) {
    const deck = { t1: rnd(NOSKILL[1]), t2: rnd(NOSKILL[2]), t3: rnd(NOSKILL[3]) };
    const hps = [4, 3, 3];
    const pieces = [createPiece(deck.t1, 1, hps[0]), createPiece(deck.t2, 2, hps[1]), createPiece(deck.t3, 3, hps[2])];
    return { socketId: 'AI', name: 'P' + idx, index: idx, pieces, draft: deck,
      actionDone: false, actionUsedSkillReplace: false, skillsUsedBeforeAction: [], teamId: idx, slotPos: 0, alive: true };
  }
  function makeGame() {
    const room = createRoom('v-' + Math.random().toString(36).slice(2, 7), { mode: 'pvp' });
    room._headless = true; room.isAI = true; room.phase = 'game'; room.currentPlayerIdx = 0; room.turnNumber = 1;
    room.players = [buildPlayer(0), buildPlayer(1)];
    const b = room.boardBounds, taken = new Set(), all = [];
    for (let r = b.min; r <= b.max; r++) for (let c = b.min; c <= b.max; c++) all.push([c, r]);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    let k = 0;
    for (const p of room.players) p.pieces.forEach(pc => { const [c, r] = all[k++]; pc.col = c; pc.row = r; taken.add(`${c},${r}`); });
    S.rooms[room.id] = room;
    getTeamBrain(room, 0); getTeamBrain(room, 1);
    return room;
  }

  let mctsWins = 0, greedyWins = 0, draws = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const mctsSide = g % 2;                  // 선/후공 교대
    const room = makeGame();
    let guard = 0;
    while (room.phase === 'game' && guard++ < 400) {
      const idx = room.currentPlayerIdx, before = room.turnNumber;
      if (idx === mctsSide) {
        const act = mctsChooseAction(room, idx, { D });
        if (act) applyAction(room, idx, act); else endTurn(room);
      } else {
        try { aiTeamTakeTurn(room, idx); } catch (e) { break; }
      }
      if (room.phase === 'game' && room.currentPlayerIdx === idx && room.turnNumber === before) endTurn(room);
    }
    const a0 = room.players[mctsSide].pieces.filter(p => p.alive).length;
    const a1 = room.players[1 - mctsSide].pieces.filter(p => p.alive).length;
    delete S.rooms[room.id];
    if (a0 > 0 && a1 === 0) mctsWins++;
    else if (a1 > 0 && a0 === 0) greedyWins++;
    else draws++;
  }
  const ms = Date.now() - t0;
  console.log(`MCTS(D=${D}) vs 탐욕 — ${games}판 (${ms}ms, ${(ms / games).toFixed(0)}ms/판)`);
  console.log(`  MCTS 승: ${mctsWins}  탐욕 승: ${greedyWins}  무승부: ${draws}  → MCTS 승률 ${(mctsWins / games * 100).toFixed(1)}%`);
  process.exit(0);
}
