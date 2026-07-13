// 팀전 중 각 이벤트가 4명에게 어떻게 전달되는지 검증
const { io } = require('./node_modules/socket.io-client');
const URL = 'http://localhost:3000';
const ROOM = 'evtest_' + Date.now();
const players = ['A1', 'A2', 'B1', 'B2'];
const sockets = {};
const events = {};  // per-player event log

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  events[name] = [];
  const eventNames = [
    'team_joined', 'team_room_state', 'team_countdown', 'team_start_ready',
    'team_draft_start', 'team_draft_pick_update', 'team_draft_confirmed', 'team_draft_status',
    'team_hp_phase', 'team_hp_ok', 'hp_ok', 'team_hp_status', 'twin_split_needed',
    'team_placement_phase', 'team_placement_update', 'team_placed_ok', 'team_confirm_placement_ok',
    'team_game_start', 'team_game_update', 'team_skill_notice', 'team_game_over',
    'move_ok', 'opp_moved', 'attack_result', 'being_attacked',
    'skill_result', 'status_update', 'passive_alert', 'bomb_detonated',
    'turn_event', 'sp_update', 'board_shrink_warning', 'board_shrink',
    'err', 'wait_msg',
  ];
  for (const e of eventNames) {
    s.on(e, (data) => events[name].push({ event: e, data: summarize(data) }));
  }
  sockets[name] = s;
  return s;
}

function summarize(data) {
  if (data == null) return null;
  if (typeof data !== 'object') return data;
  const keys = Object.keys(data);
  if (keys.length > 5) return `{${keys.slice(0,5).join(',')},...}`;
  const s = {};
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string') s[k] = v.slice(0, 40);
    else if (typeof v === 'number') s[k] = v;
    else if (Array.isArray(v)) s[k] = `Arr(${v.length})`;
    else if (typeof v === 'object') s[k] = '{...}';
    else s[k] = v;
  }
  return s;
}

function countEvents(name) {
  const count = {};
  for (const e of events[name]) count[e.event] = (count[e.event] || 0) + 1;
  return count;
}

async function main() {
  console.log('=== 팀전 이벤트 전파 검증 ===\n');
  for (const p of players) createClient(p);
  await sleep(400);

  for (const p of players) sockets[p].emit('join_team_room', { roomId: ROOM, playerName: p });
  await sleep(500);

  sockets.A1.emit('team_start_request');
  await sleep(3500);

  // 드래프트
  const picks = { A1: ['archer','general'], A2: ['spearman','knight'], B1: ['cavalry','wizard'], B2: ['watchman','armoredWarrior'] };
  for (const p of players) {
    sockets[p].emit('team_draft_pick', { slot: 'pick1', type: picks[p][0] });
    await sleep(80);
    sockets[p].emit('team_draft_pick', { slot: 'pick2', type: picks[p][1] });
    await sleep(80);
  }
  await sleep(300);
  for (const p of players) sockets[p].emit('team_draft_confirm');
  await sleep(1500);

  // HP 자동 분배
  for (const p of players) sockets[p].emit('team_hp_distribute', { hps: [5, 5] });
  await sleep(1500);

  // 배치 — 각자 서로 다른 위치
  const placements = {
    A1: [[0, 0], [1, 0]],  // idx 0 팀0: 상단
    A2: [[0, 6], [1, 6]],  // idx 1 팀1: 하단 (실제 팀 A1=0, A2=1... but team 번갈아)
    B1: [[2, 0], [3, 0]],
    B2: [[2, 6], [3, 6]],
  };
  await sleep(500);
  for (const p of players) {
    const ps = placements[p];
    sockets[p].emit('team_place_piece', { pieceIdx: 0, col: ps[0][0], row: ps[0][1] });
    await sleep(50);
    sockets[p].emit('team_place_piece', { pieceIdx: 1, col: ps[1][0], row: ps[1][1] });
    await sleep(50);
    sockets[p].emit('team_confirm_placement');
  }
  await sleep(1500);

  console.log('── 게임 시작 후 이벤트 카운트 ──');
  for (const p of players) {
    console.log(`${p}:`, JSON.stringify(countEvents(p)));
  }

  // 각자 저장된 이벤트 초기화 (게임 중 이벤트만 추적)
  for (const p of players) events[p] = [];

  console.log('\n── A1이 행동 시도 (current turn player) ──');
  // A1 턴(idx=0). 이동 시도
  sockets.A1.emit('move_piece', { pieceIdx: 0, col: 0, row: 1 });
  await sleep(500);

  console.log('이동 후 이벤트:');
  for (const p of players) {
    const count = countEvents(p);
    console.log(`  ${p}:`, JSON.stringify(count));
  }

  // 턴 종료
  sockets.A1.emit('end_turn');
  await sleep(500);

  console.log('\n턴 종료 후 이벤트 누적:');
  for (const p of players) {
    console.log(`  ${p}:`, JSON.stringify(countEvents(p)));
  }

  // 여러 턴 스킵
  console.log('\n── 여러 턴 스킵 ──');
  for (let i = 0; i < 8; i++) {
    const cur = events[players[0]].find(e => e.event === 'team_game_update')?.data;
    // 현재 턴 플레이어에게 end_turn 보내기는 각자 구현해야
    // 간단히: 모든 플레이어 all send end_turn (당사자만 응답)
    for (const p of players) sockets[p].emit('end_turn');
    await sleep(300);
  }

  console.log('\n8턴 스킵 후 이벤트:');
  for (const p of players) {
    console.log(`  ${p}:`, JSON.stringify(countEvents(p)));
  }

  for (const p of players) sockets[p].disconnect();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
