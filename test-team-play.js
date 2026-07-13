// 4인 팀전 자동 플레이 테스트
const { io } = require('./node_modules/socket.io-client');

const URL = 'http://localhost:3000';
const ROOM = 'autotest_' + Date.now();
const players = ['A1', 'A2', 'B1', 'B2'];
const sockets = {};
const state = {};  // per-player

const log = (name, ...args) => console.log(`[${name}]`, ...args);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  state[name] = {
    idx: null, teamId: null, chars: null, myDraft: {pick1:null,pick2:null},
    teamDraftConfirmed: false, hpDone: false, placementDone: false,
    myPieces: [], boardBounds: null,
  };

  s.on('connect', () => log(name, 'connected', s.id));

  s.on('err', ({ msg }) => log(name, '❌ ERR:', msg));

  s.on('team_joined', ({ idx, roomId }) => {
    state[name].idx = idx;
    log(name, 'team_joined idx=' + idx);
  });

  s.on('team_room_state', ({ players: ps, teams, myIdx, count }) => {
    const me = ps.find(p => p.idx === myIdx);
    if (me) state[name].teamId = me.teamId;
    log(name, `room_state count=${count} teamId=${state[name].teamId}`);
  });

  s.on('team_countdown', ({ seconds }) => log(name, `⏱ countdown ${seconds}s`));

  s.on('team_draft_start', ({ myIdx, teamId, characters }) => {
    state[name].chars = characters;
    log(name, '🎴 draft started');
  });

  s.on('team_draft_pick_update', ({ playerIdx, slot, type, teamDrafts }) => {
    const td = teamDrafts?.find(d => d.idx === myIdx(name));
    // no log spam
  });

  s.on('team_draft_confirmed', ({ pick1, pick2 }) => {
    state[name].teamDraftConfirmed = true;
    log(name, `✓ draft confirmed: ${pick1} / ${pick2}`);
  });

  s.on('team_draft_status', ({ draftDone }) => {
    // log(name, `draft status: ${draftDone.filter(d=>d).length}/4`);
  });

  s.on('team_hp_phase', ({ draft, hasTwins }) => {
    log(name, `💚 hp phase starts — draft=${JSON.stringify(draft)} hasTwins=${hasTwins}`);
    // 기본 5/5 분배 (쌍둥이면 최소 2 맞춤)
    const t1Twin = draft.pick1 === 'twins';
    const t2Twin = draft.pick2 === 'twins';
    const hps = [5, 5];
    if (t1Twin && hps[0] < 2) hps[0] = 2, hps[1] = 8;
    if (t2Twin && hps[1] < 2) hps[1] = 2, hps[0] = 8;
    setTimeout(() => s.emit('team_hp_distribute', { hps }), 100 + Math.random() * 300);
  });

  s.on('twin_split_needed', ({ twinTierHp }) => {
    const e = Math.ceil(twinTierHp / 2), y = twinTierHp - e;
    log(name, `👬 twin split needed — ${e}/${y}`);
    s.emit('team_hp_distribute', { twinSplit: [e, y] });
  });

  s.on('hp_ok', () => {
    state[name].hpDone = true;
    log(name, '✓ hp_ok');
  });

  s.on('team_hp_status', ({ hpDone }) => {
    // log(name, `hp status: ${hpDone.filter(d=>d).length}/4`);
  });

  s.on('team_placement_phase', ({ myIdx, teamId, boardBounds, myPieces }) => {
    state[name].boardBounds = boardBounds;
    state[name].myPieces = myPieces || [];
    log(name, `🗺 placement phase — ${myPieces.length} pieces, bounds=${JSON.stringify(boardBounds)}`);
    // 간단 배치: idx와 teamId에 따라 자리
    const teamRowBase = teamId === 0 ? 0 : 5;
    const slotBase = myIdx * 3;  // A1:0-2, A2:3-5, B1:0-2, B2:3-5
    myPieces.forEach((pc, i) => {
      const col = (slotBase + i) % 7;
      const row = teamRowBase + Math.floor((slotBase + i) / 7);
      setTimeout(() => s.emit('team_place_piece', { pieceIdx: i, col, row }), 200 + i * 100);
    });
    setTimeout(() => {
      s.emit('team_confirm_placement');
      log(name, '✓ placement submitted');
    }, 200 + myPieces.length * 100 + 300);
  });

  s.on('team_placement_update', ({ teamPieces }) => {
    // teammate placed pieces
  });

  s.on('team_placed_ok', ({ pieceIdx, col, row }) => {
    // placed
  });

  s.on('team_game_start', (st) => {
    log(name, `🎮 GAME START — turn ${st.turnNumber}, currentPlayer=${st.currentPlayerIdx}, isMyTurn=${st.isMyTurn}`);
    state[name].gameStarted = true;
    state[name].currentPlayerIdx = st.currentPlayerIdx;
    state[name].lastState = st;
    if (st.isMyTurn) takeTurn(name, st);
  });

  s.on('team_game_update', (st) => {
    state[name].currentPlayerIdx = st.currentPlayerIdx;
    state[name].lastState = st;
    if (st.isMyTurn) takeTurn(name, st);
  });

  s.on('team_game_over', ({ win, winnerTeamId }) => {
    log(name, `🏆 game over — win=${win} winnerTeam=${winnerTeamId}`);
  });

  s.on('team_skill_notice', ({ casterName, skillUsed }) => {
    // log(name, `skill: ${casterName} used ${skillUsed?.skillName}`);
  });

  s.on('opp_disconnected_pending', ({ msg }) => log(name, `disc pending: ${msg}`));

  sockets[name] = s;
  return s;
}

function myIdx(name) { return state[name]?.idx; }

// 단순 턴 로직: 첫 살아있는 내 말로 한 칸 오른쪽으로 이동 시도, 실패 시 턴 종료
let turnCounter = 0;
function takeTurn(name, st) {
  turnCounter++;
  if (turnCounter > 20) return;  // 무한루프 방지
  const s = sockets[name];
  const me = st.players.find(p => p.idx === st.myIdx);
  if (!me) { s.emit('end_turn'); return; }
  const alive = me.pieces.filter(p => p.alive);
  if (alive.length === 0) { s.emit('end_turn'); return; }
  log(name, `🎯 turn ${st.turnNumber} — alive=${alive.length}, sp=${JSON.stringify(st.sp)}`);
  // 첫 유닛을 인접 빈칸으로 이동 (오른쪽 1칸 시도)
  const p = alive[0];
  const pieceIdx = me.pieces.indexOf(p);
  const tryCol = Math.min(p.col + 1, 6);
  setTimeout(() => {
    s.emit('move_piece', { pieceIdx, col: tryCol, row: p.row });
    setTimeout(() => s.emit('end_turn'), 200);
  }, 150);
}

async function main() {
  console.log('=== 4인 팀전 자동 플레이 테스트 ===');
  console.log('방 코드:', ROOM);

  // 1. 4명 생성/접속
  for (const p of players) createClient(p);
  await sleep(800);

  // 2. 4명 모두 join_team_room
  for (const p of players) {
    sockets[p].emit('join_team_room', { roomId: ROOM, playerName: p });
    await sleep(200);
  }
  await sleep(500);

  // 3. 팀 확인 (A1,A2가 같은 팀이어야 ideal이지만 자동배정)
  console.log('\n팀 배정:');
  for (const p of players) console.log(`  ${p}: teamId=${state[p].teamId}, idx=${state[p].idx}`);

  // 4. 게임 시작 (A1이 시작 버튼)
  sockets.A1.emit('team_start_request');
  console.log('\n게임 시작 요청...');
  await sleep(4000);  // 카운트다운 3초 + 여유

  // 5. 드래프트 — 각자 2픽 (고유 캐릭터 할당)
  const charPools = {
    A1: ['archer', 'general'],
    A2: ['spearman', 'knight'],
    B1: ['cavalry', 'wizard'],
    B2: ['watchman', 'armoredWarrior'],
  };
  console.log('\n드래프트 시작...');
  for (const p of players) {
    if (!state[p].chars) {
      console.log(`  ⚠ ${p}: chars 없음 (drafting failed?)`);
      continue;
    }
    const [c1, c2] = charPools[p];
    sockets[p].emit('team_draft_pick', { slot: 'pick1', type: c1 });
    await sleep(100);
    sockets[p].emit('team_draft_pick', { slot: 'pick2', type: c2 });
    await sleep(100);
  }
  await sleep(500);
  for (const p of players) {
    sockets[p].emit('team_draft_confirm');
    await sleep(100);
  }
  await sleep(1500);

  // 6. HP 분배 — 자동으로 team_hp_phase 핸들러가 처리
  console.log('\nHP 분배 대기...');
  await sleep(2000);

  // 7. 배치 — 자동으로 team_placement_phase 핸들러가 처리
  console.log('\n배치 대기...');
  await sleep(3000);

  // 8. 게임 시작 확인
  console.log('\n게임 상태:');
  for (const p of players) {
    console.log(`  ${p}: gameStarted=${state[p].gameStarted} currentPlayer=${state[p].currentPlayerIdx}`);
  }

  // 몇 턴 진행
  console.log('\n턴 진행 (10초)...');
  await sleep(10000);
  // 턴 상태 체크
  console.log('\n턴 진행 상태:');
  for (const p of players) {
    const st = state[p].lastState;
    console.log(`  ${p}: turn=${st?.turnNumber || '?'} curPlayer=${st?.currentPlayerIdx}`);
  }

  // 종료
  console.log('\n=== 테스트 종료 ===');
  for (const p of players) sockets[p].disconnect();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
