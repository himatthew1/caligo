// 3-bot 팀전 보조 — 브라우저가 1번 플레이어, 봇 3명이 나머지 자리
// 사용: node test-team-3bots.js <ROOM_CODE>
const { io } = require('./node_modules/socket.io-client');

const URL = 'http://localhost:3000';
const ROOM = process.argv[2] || 'TESTRM';
const BOTS = ['아군봇', '적봇1', '적봇2'];   // 브라우저가 idx 0 (A1팀), 봇 3명이 idx 1,2,3
const sockets = {};
const state = {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(name, msg) { console.log(`[${name}] ${msg}`); }

function createBot(name, joinDelay) {
  setTimeout(() => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    sockets[name] = s;
    state[name] = { idx: null, teamId: null, chars: null, myDraft: { pick1: null, pick2: null }, lastTurn: 0, errs: [] };

    s.on('connect', () => {
      log(name, `connected; joining ${ROOM}`);
      s.emit('join_team_room', { roomId: ROOM, playerName: name });
    });
    s.on('err', ({ msg }) => { state[name].errs.push(msg); log(name, `ERR: ${msg}`); });
    s.on('team_joined', ({ idx }) => { state[name].idx = idx; log(name, `joined as idx=${idx}`); });
    s.on('team_room_state', ({ players }) => {
      const me = players.find(p => p.idx === state[name].idx);
      if (me) state[name].teamId = me.teamId;
    });

    // ── 드래프트 (브라우저 대기용 딜레이 증가) ──
    s.on('team_draft_start', ({ characters }) => {
      state[name].chars = characters;
      log(name, 'draft_start');
      const all = [...(characters[1] || []), ...(characters[2] || []), ...(characters[3] || [])];
      const pickCandidates = all.filter(c => !c.isTwin).slice();
      const offsets = { '아군봇': [0, 5], '적봇1': [1, 6], '적봇2': [2, 7] };
      const off = offsets[name] || [0, 1];
      const p1 = pickCandidates[off[0] % pickCandidates.length].type;
      const p2 = pickCandidates[off[1] % pickCandidates.length].type;
      setTimeout(() => s.emit('team_draft_pick', { slot: 'pick1', type: p1 }), 8000);
      setTimeout(() => s.emit('team_draft_pick', { slot: 'pick2', type: p2 }), 9000);
      setTimeout(() => s.emit('team_draft_confirm'), 10000);
    });

    // ── HP (긴 딜레이) ──
    s.on('team_hp_phase', ({ draft }) => {
      log(name, 'hp_phase');
      const t1Twin = draft.pick1 === 'twins';
      const t2Twin = draft.pick2 === 'twins';
      let hps = [5, 5];
      if (t1Twin) hps = [4, 6];
      if (t2Twin) hps = [6, 4];
      setTimeout(() => s.emit('team_hp_distribute', { hps }), 12000);
    });
    s.on('twin_split_needed', ({ twinTierHp }) => {
      const e = Math.ceil(twinTierHp / 2), y = twinTierHp - e;
      s.emit('team_hp_distribute', { twinSplit: [e, y] });
    });

    // ── 배치 (긴 딜레이) ──
    s.on('team_placement_phase', ({ myIdx, myPieces }) => {
      log(name, `placement (${myPieces.length} pieces)`);
      const rowMap = { 0: 0, 1: 6, 2: 2, 3: 4 };
      const myRow = rowMap[myIdx];
      myPieces.forEach((pc, i) => {
        const col = i;
        setTimeout(() => s.emit('team_place_piece', { pieceIdx: i, col, row: myRow }), 14000 + i * 200);
      });
      setTimeout(() => s.emit('team_confirm_placement'), 14000 + myPieces.length * 200 + 1000);
    });

    // ── 게임 시작 ──
    s.on('team_game_start', () => log(name, 'game_started'));

    // ── 턴 진행: 무작위 이동 + 가능하면 공격 ──
    s.on('team_game_update', (st) => {
      if (!st.isMyTurn) return;
      // 같은 턴 중복 방지
      if (state[name].lastTurn === st.turnNumber) return;
      state[name].lastTurn = st.turnNumber;
      setTimeout(() => takeBotTurn(s, name, st), 800 + Math.random() * 400);
    });

    s.on('team_game_over', () => log(name, 'game_over'));
  }, joinDelay);
}

function takeBotTurn(s, name, st) {
  const me = (st.players || []).find(p => p.idx === st.myIdx);
  if (!me) { s.emit('end_turn'); return; }
  const myPieces = (me.pieces || []).filter(p => p.alive);
  if (myPieces.length === 0) { s.emit('end_turn'); return; }
  const enemies = (st.players || []).filter(p => p.teamId !== st.myTeamId)
    .flatMap(p => (p.pieces || []).filter(pc => pc.alive));
  // 인접 적 공격 시도 (좌표 알 때만)
  const allOccupied = new Set();
  for (const p of (st.players || [])) for (const pc of (p.pieces || [])) {
    if (pc.alive && pc.col !== undefined) allOccupied.add(`${pc.col},${pc.row}`);
  }
  const bMin = st.boardBounds.min, bMax = st.boardBounds.max;
  // 그냥 첫 살아있는 말 한 칸 이동
  const piece = myPieces[0];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  // 셔플
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  const pIdx = me.pieces.indexOf(piece);
  for (const [dc, dr] of dirs) {
    const nc = piece.col + dc, nr = piece.row + dr;
    if (nc < bMin || nc > bMax || nr < bMin || nr > bMax) continue;
    if (allOccupied.has(`${nc},${nr}`)) continue;
    s.emit('move_piece', { pieceIdx: pIdx, col: nc, row: nr });
    setTimeout(() => s.emit('end_turn'), 500);
    return;
  }
  s.emit('end_turn');
}

// 봇 3명을 시간차로 입장시킴 (browser가 먼저 들어왔다고 가정)
console.log(`Targeting room: ${ROOM}`);
console.log('Browser should join first as player 1 (idx 0)');
console.log('Bots will join in 1.5 seconds...');
createBot(BOTS[0], 1500);
createBot(BOTS[1], 2000);
createBot(BOTS[2], 2500);

// 60초 타임아웃
setTimeout(() => {
  console.log('\n=== State summary ===');
  for (const n of BOTS) {
    const sStat = state[n] || {};
    console.log(`  ${n}: idx=${sStat.idx}, teamId=${sStat.teamId}, errs=${(sStat.errs||[]).length}`);
  }
  console.log('Bots will keep running. Ctrl+C to stop.');
}, 8000);
