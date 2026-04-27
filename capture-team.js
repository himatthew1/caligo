// 팀전 단계별 스크린샷 캡처
// 사용: node capture-team.js
// 동작:
//   1. puppeteer-core로 Chrome을 띄움 (헤드리스 X — 시각 확인)
//   2. 4번째 플레이어 자리에 봇 3명을 socket.io로 연결
//   3. 브라우저는 1번 플레이어 — eval로 액션 자동
//   4. 각 페이즈마다 PNG로 screenshots/ 저장

const puppeteer = require('./node_modules/puppeteer-core');
const { io } = require('./node_modules/socket.io-client');
const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:3000';
const ROOM = 'CAP' + Math.random().toString(36).slice(2, 6).toUpperCase();
const SHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `team-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[shot] ${file}`);
  return file;
}

// 특정 화면이 표시될 때까지 대기
async function waitForScreen(page, screenId, timeout = 20000) {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.classList.contains('active'),
    { timeout },
    screenId
  ).catch(e => console.log(`[wait] ${screenId} timeout`));
}

function startBots(roomCode) {
  const sockets = {};
  const start = (name, joinDelay) => {
    setTimeout(() => {
      const s = io(URL, { transports: ['websocket'], forceNew: true });
      sockets[name] = s;
      const state = { idx: null };

      s.on('connect', () => s.emit('join_team_room', { roomId: roomCode, playerName: name }));
      s.on('team_joined', ({ idx }) => { state.idx = idx; console.log(`[bot:${name}] joined idx=${idx}`); });

      s.on('team_draft_start', ({ characters }) => {
        const all = [...(characters[1]||[]), ...(characters[2]||[]), ...(characters[3]||[])];
        const pool = all.filter(c => !c.isTwin);
        const offsets = { '아군': [3, 7], '적1': [1, 5], '적2': [2, 8] };
        const off = offsets[name] || [0, 1];
        const p1 = pool[off[0] % pool.length].type;
        const p2 = pool[off[1] % pool.length].type;
        // 봇은 빨리 픽 — 브라우저가 천천히 픽할 수 있게 충분한 시간 둠
        setTimeout(() => s.emit('team_draft_pick', { slot: 'pick1', type: p1 }), 4000);
        setTimeout(() => s.emit('team_draft_pick', { slot: 'pick2', type: p2 }), 5000);
        setTimeout(() => s.emit('team_draft_confirm'), 6000);
      });

      s.on('team_hp_phase', ({ draft }) => {
        const hps = [5, 5];
        if (draft.pick1 === 'twins') hps[0] = 4, hps[1] = 6;
        if (draft.pick2 === 'twins') hps[0] = 6, hps[1] = 4;
        setTimeout(() => s.emit('team_hp_distribute', { hps }), 8000);
      });
      s.on('twin_split_needed', ({ twinTierHp }) => {
        const e = Math.ceil(twinTierHp / 2), y = twinTierHp - e;
        s.emit('team_hp_distribute', { twinSplit: [e, y] });
      });

      // reveal phase에서는 봇이 18초 후 자동 진행 (브라우저가 reveal 스크린 캡처할 시간)
      s.on('team_reveal_phase', () => {
        setTimeout(() => s.emit('team_reveal_continue'), 18000);
      });

      s.on('team_placement_phase', ({ myIdx, myPieces }) => {
        const rowMap = { 0: 0, 1: 6, 2: 2, 3: 4 };
        const myRow = rowMap[myIdx];
        myPieces.forEach((pc, i) => {
          setTimeout(() => s.emit('team_place_piece', { pieceIdx: i, col: i, row: myRow }), 8000 + i*200);
        });
        setTimeout(() => s.emit('team_confirm_placement'), 8000 + myPieces.length*200 + 800);
      });

      s.on('team_game_update', (st) => {
        if (!st.isMyTurn) return;
        // 무작정 한 칸 이동 → 종료
        const me = st.players.find(p => p.idx === st.myIdx);
        if (!me) { s.emit('end_turn'); return; }
        const alivePieces = (me.pieces||[]).filter(p => p.alive);
        if (!alivePieces.length) { s.emit('end_turn'); return; }
        const occupied = new Set();
        for (const p of st.players) for (const pc of p.pieces||[]) {
          if (pc.alive && pc.col != null) occupied.add(`${pc.col},${pc.row}`);
        }
        const piece = alivePieces[0];
        const pIdx = me.pieces.indexOf(piece);
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dc, dr] of dirs.sort(() => Math.random()-0.5)) {
          const nc = piece.col + dc, nr = piece.row + dr;
          if (nc < st.boardBounds.min || nc > st.boardBounds.max) continue;
          if (nr < st.boardBounds.min || nr > st.boardBounds.max) continue;
          if (occupied.has(`${nc},${nr}`)) continue;
          setTimeout(() => {
            s.emit('move_piece', { pieceIdx: pIdx, col: nc, row: nr });
            setTimeout(() => s.emit('end_turn'), 400);
          }, 800);
          return;
        }
        s.emit('end_turn');
      });
    }, joinDelay);
  };
  start('아군', 1500);
  start('적1', 2200);
  start('적2', 2900);
  return sockets;
}

(async () => {
  console.log(`[setup] room=${ROOM}, screenshots → ${SHOT_DIR}`);
  console.log(`[setup] launching Chrome...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[page error]', e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(800);

  // 1. 홈 화면
  await shot(page, '01-home');

  // 닉네임 + 룸코드 + 팀모드 입장
  await page.evaluate((room) => {
    document.getElementById('input-name').value = '나이트메어';
    document.getElementById('input-room').value = room;
    document.getElementById('btn-join-team').click();
  }, ROOM);
  await sleep(600);

  // 봇 시작 (브라우저 입장 직후)
  startBots(ROOM);
  await sleep(3500);

  // 2. 팀전 대기실 (4/4)
  await shot(page, '02-waiting-room');

  // 게임 시작
  await page.evaluate(() => document.getElementById('btn-team-start').click());
  await sleep(4000);   // 카운트다운 + 드래프트 진입

  // 3. 팀전 드래프트
  await shot(page, '03-draft');

  // 봇이 픽할 시간 충분히 줌 (봇 4-6초 후 픽함)
  await sleep(7500);

  // 픽 - 두 개 직접 emit (팀원이 이미 픽한 거 피해서)
  await page.evaluate(() => {
    const all = [...(S.characters?.[1]||[]), ...(S.characters?.[2]||[]), ...(S.characters?.[3]||[])];
    const tmPicks = new Set([S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean));
    const candidates = all.filter(c => !c.isTwin && !tmPicks.has(c.type));
    const p1 = candidates[0]?.type;
    const p2 = candidates[1]?.type || candidates[2]?.type;
    console.log('[draft]', { p1, p2, tmPicks: [...tmPicks] });
    if (p1) socket.emit('team_draft_pick', { slot: 'pick1', type: p1 });
    setTimeout(() => { if (p2) socket.emit('team_draft_pick', { slot: 'pick2', type: p2 }); }, 250);
    setTimeout(() => socket.emit('team_draft_confirm'), 600);
  });

  // HP 화면 진입 대기 + 캡처 (팀모드는 screen-hp 재사용) — 길게 대기
  await waitForScreen(page, 'screen-hp', 30000);
  await sleep(900);
  await shot(page, '04-hp-distribute');

  // HP 분배 확정 (브라우저)
  await page.evaluate(() => socket.emit('team_hp_distribute', { hps: [5, 5] }));

  // 화면 전환을 빠르게 추적 — 200ms 간격으로 확인
  const screenLog = [];
  let revealCaught = false;
  for (let i = 0; i < 100; i++) {
    const cur = await page.evaluate(() => {
      const a = [...document.querySelectorAll('.screen.active')].map(s => s.id);
      return a.join(',');
    });
    screenLog.push(`${i*200}ms:${cur}`);
    if (cur === 'screen-team-reveal' && !revealCaught) {
      await shot(page, '05-reveal');
      revealCaught = true;
    }
    if (cur === 'screen-placement') break;
    await sleep(200);
  }
  console.log(`[debug] screen transitions: ${screenLog.slice(-15).join(' → ')}`);
  if (!revealCaught) {
    console.log(`[debug] reveal phase NEVER appeared`);
    await shot(page, '05-reveal');  // fallback
  }

  // 배치로 이동
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /배치로 이동|계속/.test(b.textContent.trim()));
    if (btn) btn.click(); else socket.emit('team_reveal_continue');
  });

  // 배치 화면 (screen-placement 재사용)
  await waitForScreen(page, 'screen-placement', 20000);
  await sleep(900);
  await shot(page, '06-placement');

  // 브라우저 배치
  await page.evaluate(() => {
    socket.emit('team_place_piece', { pieceIdx: 0, col: 0, row: 0 });
    setTimeout(() => socket.emit('team_place_piece', { pieceIdx: 1, col: 1, row: 0 }), 250);
    setTimeout(() => socket.emit('team_confirm_placement'), 700);
  });

  // 게임 화면
  await waitForScreen(page, 'screen-game', 25000);
  // 게임 시작 애니메이션 대기
  await sleep(2200);
  await shot(page, '07-game-1턴');

  // 팀원 셀 클릭 → 공격 범위 오버레이 (액션 없는 상태에서)
  await page.evaluate(() => {
    if (S.teammatePieces?.[0]) {
      const tm = S.teammatePieces[0];
      const cell = document.querySelector(`#game-board .cell[data-col="${tm.col}"][data-row="${tm.row}"]`);
      cell?.click();
    }
  });
  await sleep(800);
  await shot(page, '08-game-팀원공격범위');

  // 다시 토글로 끄고 — 이동 액션 모드 진입
  await page.evaluate(() => {
    if (S.teammatePieces?.[0]) {
      const tm = S.teammatePieces[0];
      const cell = document.querySelector(`#game-board .cell[data-col="${tm.col}"][data-row="${tm.row}"]`);
      cell?.click();   // toggle off
    }
    setTimeout(() => document.getElementById('btn-action-move')?.click(), 200);
  });
  await sleep(900);
  await shot(page, '09-game-이동모드');

  console.log('[done] all screenshots saved.');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('[error]', e); process.exit(1); });
