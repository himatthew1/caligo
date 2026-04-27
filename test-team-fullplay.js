// 4인 팀전 풀 플레이 테스트 — 게임 종료까지 진행하며 발견된 문제를 모두 보고
const { io } = require('./node_modules/socket.io-client');

const URL = 'http://localhost:3000';
const ROOM = 'fulltest_' + Date.now();
const players = ['A1', 'A2', 'B1', 'B2'];
const sockets = {};
const state = {};
const issues = [];   // 누적된 문제 리스트
const eventLog = []; // 전체 이벤트 로그 (요약용)

const TURN_LIMIT = 60;        // 60턴 안에 안 끝나면 강제 종료
const SILENCE_LIMIT = 10000;  // 10초간 turn 진행 없으면 stuck 판정
const ACTION_DELAY = 200;
let lastTurnNumber = 0;
let lastTurnAdvancedAt = Date.now();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function recordIssue(category, msg) {
  issues.push({ category, msg, t: Date.now() });
  console.log(`  ⚠ [${category}] ${msg}`);
}
function logEvent(category, msg) {
  eventLog.push({ category, msg, t: Date.now() });
}

function createClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  state[name] = {
    idx: null, teamId: null, chars: null, myDraft: { pick1: null, pick2: null },
    teamDraftConfirmed: false, hpDone: false, placementConfirmed: false,
    myPieces: [], boardBounds: null, gameStarted: false, gameEnded: false,
    lastState: null, lastSkillResult: null, errCount: 0,
    lastTurnTaken: 0,
  };

  s.on('connect', () => logEvent('conn', `${name} connected`));
  s.on('connect_error', (e) => recordIssue('CONN_ERR', `${name}: ${e.message}`));

  s.on('err', ({ msg }) => {
    state[name].errCount++;
    recordIssue('SERVER_ERR', `${name}: ${msg}`);
  });

  s.on('team_joined', ({ idx, roomId }) => {
    state[name].idx = idx;
  });

  s.on('team_room_state', ({ players: ps, teams, myIdx, count }) => {
    const me = ps.find(p => p.idx === (myIdx ?? state[name].idx));
    if (me) state[name].teamId = me.teamId;
  });

  s.on('team_countdown', ({ seconds }) => logEvent('phase', `${name}: countdown ${seconds}s`));
  s.on('team_start_ready', () => logEvent('phase', `${name}: start_ready`));

  s.on('team_draft_start', ({ characters }) => {
    state[name].chars = characters;
    logEvent('phase', `${name}: draft_start`);
  });

  s.on('team_draft_confirmed', ({ pick1, pick2 }) => {
    state[name].teamDraftConfirmed = true;
    state[name].myDraft = { pick1, pick2 };
    logEvent('draft', `${name}: confirmed ${pick1}/${pick2}`);
  });

  s.on('team_hp_phase', ({ draft, hasTwins }) => {
    state[name].myDraft = draft;
    logEvent('phase', `${name}: hp_phase`);
    // 5/5 분배 (쌍둥이 케이스 처리)
    const t1Twin = draft.pick1 === 'twins';
    const t2Twin = draft.pick2 === 'twins';
    let hps = [5, 5];
    if (t1Twin && hps[0] < 2) hps = [2, 8];
    if (t2Twin && hps[1] < 2) hps = [8, 2];
    setTimeout(() => s.emit('team_hp_distribute', { hps }), 100 + Math.random() * 200);
  });

  s.on('twin_split_needed', ({ twinTierHp }) => {
    const e = Math.ceil(twinTierHp / 2), y = twinTierHp - e;
    s.emit('team_hp_distribute', { twinSplit: [e, y] });
  });

  s.on('hp_ok', () => {
    state[name].hpDone = true;
    logEvent('hp', `${name}: ok`);
  });

  s.on('team_placement_phase', ({ myIdx, teamId, boardBounds, myPieces, opponents }) => {
    state[name].boardBounds = boardBounds;
    state[name].myPieces = myPieces || [];
    if (!opponents || opponents.length !== 2) {
      recordIssue('PLACEMENT', `${name}: opponents 누락 또는 수 오류 (받음=${opponents?.length})`);
    }
    logEvent('phase', `${name}: placement (${myPieces.length} pieces, ${opponents?.length || 0} opponents)`);
    // idx 별 고정 자리 (충돌 방지)
    // idx 0 → team0, row 0,    cols 0..N
    // idx 2 → team0, row 2,    cols 0..N
    // idx 1 → team1, row 6,    cols 0..N
    // idx 3 → team1, row 4,    cols 0..N
    const rowMap = { 0: 0, 1: 6, 2: 2, 3: 4 };
    const myRow = rowMap[myIdx];
    myPieces.forEach((pc, i) => {
      const col = i;  // 0, 1, 2, ... — pieces 수만큼
      const row = myRow;
      setTimeout(() => s.emit('team_place_piece', { pieceIdx: i, col, row }),
                 200 + i * 100);
    });
    setTimeout(() => {
      s.emit('team_confirm_placement');
      state[name].placementConfirmed = true;
    }, 250 + myPieces.length * 100 + 300);
  });

  s.on('team_placed_ok', () => {});
  s.on('team_placement_update', () => {});
  s.on('team_confirm_placement_ok', () => {});

  s.on('team_game_start', (st) => {
    state[name].gameStarted = true;
    state[name].lastState = st;
    logEvent('game', `${name}: GAME START — turn ${st.turnNumber}, isMyTurn=${st.isMyTurn}`);
    if (st.isMyTurn) takeTurn(name, st);
  });

  s.on('team_game_update', (st) => {
    state[name].lastState = st;
    if (st.turnNumber > lastTurnNumber) {
      lastTurnNumber = st.turnNumber;
      lastTurnAdvancedAt = Date.now();
    }
    if (st.isMyTurn) takeTurn(name, st);
  });

  s.on('team_game_over', ({ win, winnerTeamId, reason, winners, losers }) => {
    state[name].gameEnded = true;
    logEvent('game', `${name}: GAME OVER — winnerTeam=${winnerTeamId} reason=${reason} winners=${winners} losers=${losers}`);
  });

  s.on('team_skill_notice', ({ casterName, skillUsed, msg }) => {
    logEvent('skill', `${name}: notice — ${casterName} ${skillUsed?.skillName} (${msg || ''})`);
  });

  s.on('passive_alert', ({ type, msg }) => {
    logEvent('passive', `${name}: ${type} — ${msg}`);
  });

  s.on('turn_event', ({ type, msg }) => {
    logEvent('event', `${name}: turn_event ${type} — ${msg}`);
  });

  s.on('board_shrink_warning', ({ turnsRemaining }) => {
    logEvent('event', `${name}: shrink_warning ${turnsRemaining}턴 남음`);
  });

  s.on('board_shrink', ({ bounds }) => {
    logEvent('event', `${name}: BOARD_SHRUNK to ${JSON.stringify(bounds)}`);
  });

  s.on('move_ok', ({ pieceIdx, col, row, yourPieces }) => {
    state[name].myPieces = yourPieces || state[name].myPieces;
  });

  s.on('opp_moved', () => {});

  s.on('attack_result', ({ cellResults, anyHit, yourPieces }) => {
    if (yourPieces) state[name].myPieces = yourPieces;
    const hits = (cellResults || []).filter(c => c.hit && !c.redirectedToBodyguard && c.damage > 0);
    if (hits.length > 0) {
      logEvent('combat', `${name}: hit ${hits.length} target(s)`);
    }
  });

  s.on('being_attacked', ({ hitPieces, yourPieces }) => {
    if (yourPieces) state[name].myPieces = yourPieces;
  });

  s.on('skill_result', ({ msg, yourPieces }) => {
    if (yourPieces) state[name].myPieces = yourPieces;
    state[name].lastSkillResult = msg;
    if (msg) logEvent('skill', `${name}: skill_result — ${msg}`);
  });

  s.on('status_update', ({ msg, yourPieces }) => {
    if (yourPieces) state[name].myPieces = yourPieces;
  });

  s.on('bomb_detonated', ({ hits }) => {
    logEvent('combat', `${name}: bomb hit ${hits?.length || 0} target(s)`);
  });

  s.on('trap_triggered', () => {});

  s.on('opp_disconnected_pending', ({ msg }) => {
    recordIssue('DISCONN', `${name}: ${msg}`);
  });

  sockets[name] = s;
  return s;
}

function takeTurn(name, st) {
  const s = sockets[name];
  const me = (st.players || []).find(p => p.idx === st.myIdx);
  if (!me) {
    recordIssue('TURN', `${name}: my data not in state.players`);
    setTimeout(() => s.emit('end_turn'), ACTION_DELAY);
    return;
  }
  const myAlive = (me.pieces || []).filter(p => p.alive);
  if (myAlive.length === 0) {
    setTimeout(() => s.emit('end_turn'), ACTION_DELAY);
    return;
  }
  state[name].lastTurnTaken = st.turnNumber;
  const enemies = (st.players || [])
    .filter(p => p.teamId !== me.teamId)
    .flatMap(p => p.pieces.filter(pc => pc.alive));
  // 점유 검사 — 이동 시 충돌 회피용 (모든 살아있는 piece의 좌표)
  const allOccupied = new Set();
  for (const pl of (st.players || [])) {
    for (const p of pl.pieces) {
      if (p.alive && p.col != null && p.col >= 0) {
        allOccupied.add(`${p.col},${p.row}`);
      }
    }
  }
  // 1. 인접 적 있으면 공격
  for (const myP of myAlive) {
    if (myP.col == null || myP.col < 0) continue;
    for (const ep of enemies) {
      if (ep.col == null || ep.col < 0) continue;
      const dx = Math.abs(myP.col - ep.col);
      const dy = Math.abs(myP.row - ep.row);
      if (dx + dy === 1 || dx + dy === 0) {
        const pieceIdx = me.pieces.indexOf(myP);
        setTimeout(() => {
          if (myP.type === 'shadowAssassin' || myP.type === 'witch') {
            s.emit('attack', { pieceIdx, tCol: ep.col, tRow: ep.row });
          } else {
            s.emit('attack', { pieceIdx });
          }
          setTimeout(() => s.emit('end_turn'), 400);
        }, ACTION_DELAY);
        return;
      }
    }
  }
  // 2. 공격 못하면 — 가장 가까운 적 향해 빈 인접 칸으로 이동
  const myP = myAlive[0];
  const pieceIdx = me.pieces.indexOf(myP);
  let nearest = null, minDist = 999;
  for (const ep of enemies) {
    if (ep.col == null) continue;
    const d = Math.abs(myP.col - ep.col) + Math.abs(myP.row - ep.row);
    if (d < minDist) { minDist = d; nearest = ep; }
  }
  // 4방 인접 후보 중 빈칸 + 가장 적과 가까운 칸 선택
  const b = st.boardBounds || { min: 0, max: 6 };
  const candidates = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = myP.col + dc, nr = myP.row + dr;
    if (nc < b.min || nc > b.max || nr < b.min || nr > b.max) continue;
    if (allOccupied.has(`${nc},${nr}`)) continue;  // 점유된 칸 회피
    let dist = 0;
    if (nearest) dist = Math.abs(nearest.col - nc) + Math.abs(nearest.row - nr);
    candidates.push({ col: nc, row: nr, dist });
  }
  if (candidates.length === 0) {
    setTimeout(() => s.emit('end_turn'), ACTION_DELAY);
    return;
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  setTimeout(() => {
    s.emit('move_piece', { pieceIdx, col: best.col, row: best.row });
    setTimeout(() => s.emit('end_turn'), 400);
  }, ACTION_DELAY);
}

async function main() {
  console.log('=== 4인 팀전 풀 플레이 테스트 ===');
  console.log('방 코드:', ROOM);
  console.log();

  // 1. 클라이언트 4명 생성
  for (const p of players) createClient(p);
  await sleep(700);

  // 2. join_team_room
  for (const p of players) {
    sockets[p].emit('join_team_room', { roomId: ROOM, playerName: p });
    await sleep(150);
  }
  await sleep(500);

  console.log('팀 배정:');
  for (const p of players) console.log(`  ${p}: idx=${state[p].idx} teamId=${state[p].teamId}`);

  // 3. 게임 시작
  sockets.A1.emit('team_start_request');
  await sleep(4000);  // 카운트다운 + 진입

  // 4. 드래프트 — 2픽씩
  const charPools = {
    A1: ['archer', 'general'],
    A2: ['herbalist', 'witch'],
    B1: ['cavalry', 'monk'],
    B2: ['watchman', 'armoredWarrior'],
  };
  console.log('\n드래프트 진행...');
  for (const p of players) {
    const [c1, c2] = charPools[p];
    sockets[p].emit('team_draft_pick', { slot: 'pick1', type: c1 });
    await sleep(80);
    sockets[p].emit('team_draft_pick', { slot: 'pick2', type: c2 });
    await sleep(80);
  }
  await sleep(400);
  for (const p of players) {
    sockets[p].emit('team_draft_confirm');
    await sleep(80);
  }
  await sleep(2000);

  // 5. HP / 배치 — 자동 핸들러
  console.log('\nHP 분배 + 배치 진행...');
  await sleep(4000);

  // 6. 게임 진행
  console.log('\n게임 시작 — 진행 모니터링');
  let stuckCheckTimer = setInterval(() => {
    const idle = Date.now() - lastTurnAdvancedAt;
    const allEnded = players.every(p => state[p].gameEnded);
    if (allEnded) { clearInterval(stuckCheckTimer); return; }
    if (idle > SILENCE_LIMIT) {
      recordIssue('STUCK', `턴 ${lastTurnNumber}에서 ${(idle/1000).toFixed(1)}초간 진행 없음`);
      clearInterval(stuckCheckTimer);
    }
    if (lastTurnNumber > TURN_LIMIT) {
      recordIssue('TURN_LIMIT', `${TURN_LIMIT}턴 도달 — 강제 종료`);
      clearInterval(stuckCheckTimer);
    }
  }, 2000);

  // 종료 대기 (최대 90초)
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (players.every(p => state[p].gameEnded)) break;
    if (lastTurnNumber > TURN_LIMIT) break;
    if (Date.now() - lastTurnAdvancedAt > SILENCE_LIMIT) break;
  }

  clearInterval(stuckCheckTimer);

  // 7. 결과 보고
  console.log('\n=== 결과 ===');
  console.log(`최종 턴: ${lastTurnNumber}`);
  console.log(`게임 종료 상태: ${players.map(p => `${p}=${state[p].gameEnded ? '✓' : '✗'}`).join(', ')}`);
  for (const p of players) {
    console.log(`  ${p}: errCount=${state[p].errCount}`);
  }

  // 이벤트 카테고리별 카운트
  const cat = {};
  for (const e of eventLog) cat[e.category] = (cat[e.category] || 0) + 1;
  console.log('\n이벤트 카운트:');
  for (const [k, v] of Object.entries(cat)) console.log(`  ${k}: ${v}`);

  // 이슈 보고
  console.log('\n발견된 문제:');
  if (issues.length === 0) {
    console.log('  (문제 없음)');
  } else {
    const byCat = {};
    for (const i of issues) {
      byCat[i.category] = byCat[i.category] || [];
      byCat[i.category].push(i.msg);
    }
    for (const [c, msgs] of Object.entries(byCat)) {
      console.log(`  [${c}] (${msgs.length})`);
      for (const m of msgs.slice(0, 5)) console.log(`    - ${m}`);
      if (msgs.length > 5) console.log(`    ... +${msgs.length - 5}건 더`);
    }
  }

  // 모든 shrink/game 이벤트
  console.log('\n전체 shrink·game 이벤트:');
  for (const e of eventLog) {
    if (e.category === 'event' || e.category === 'game') {
      console.log(`  [${e.category}] ${e.msg}`);
    }
  }

  for (const p of players) sockets[p].disconnect();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
