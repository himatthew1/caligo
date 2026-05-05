// ═══════════════════════════════════════════════════════════════
// CALIGO - 클라이언트 (game.js)
// ═══════════════════════════════════════════════════════════════

const socket = io();

// #9: 연결 직후 세션 재접속 시도 (새로고침 시 게임 복구)
socket.on('connect', () => {
  try {
    const raw = sessionStorage.getItem('caligo_session');
    if (!raw) return;
    const sess = JSON.parse(raw);
    if (!sess || !sess.token || !sess.roomId) return;
    // 2시간 이상 지난 세션은 무시 (일반 게임 최대 한 판 기준)
    if (Date.now() - (sess.ts || 0) > 2 * 60 * 60 * 1000) {
      sessionStorage.removeItem('caligo_session');
      return;
    }
    socket.emit('reconnect_game', { roomId: sess.roomId, sessionToken: sess.token });
  } catch (e) {}
});

socket.on('reconnect_failed', ({ reason }) => {
  try { sessionStorage.removeItem('caligo_session'); } catch (e) {}
  console.warn('[reconnect failed]', reason);
});

socket.on('reconnect_ok', ({ idx, phase }) => {
  // 상태는 다른 이벤트(joined/team_game_start)로 복구
  if (typeof showSkillToast === 'function') {
    showSkillToast('재접속', false, undefined, 'event');
  }
});

socket.on('reconnect_phase_resume', ({ phase }) => {
  // 세팅 단계 재접속 — 서버가 현재 phase에 맞는 이벤트를 뒤이어 보냄
  console.log('[reconnect] phase resume:', phase);
});

// 1v1 입장 버튼으로 팀 방 코드를 입력한 경우 — 자동으로 팀전 입장으로 전환
socket.on('team_room_redirect', ({ roomId, playerName }) => {
  S.isTeamMode = true;
  S.myName = playerName;
  S.roomId = roomId;
  showSkillToast('이 방은 2v2 팀전 방입니다. 팀전으로 입장합니다.', false, undefined, 'event');
  socket.emit('join_team_room', { roomId, playerName });
});

socket.on('opp_disconnected_pending', ({ msg, graceMs }) => {
  try { showSkillToast(`🔌 ${msg}`, true, undefined, 'event'); } catch (e) {}
});

// ── 좌표 변환 헬퍼 (세로=A~E, 가로=1~5) ──
const ROW_LABELS = ['A','B','C','D','E','F','G'];
function coord(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }
function coordLabel(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }
function myN() { return S.myName || '나'; }
function oppN() { return S.opponentName || '상대'; }

// 한국어 조사 자동 변환 — 마지막 글자의 받침 유무로 with받침/without받침 선택.
function 조사(word, with받침, without받침) {
  if (!word || typeof word !== 'string') return without받침;
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return without받침;
  const hasJongseong = (last - 0xAC00) % 28 !== 0;
  return hasJongseong ? with받침 : without받침;
}

// 슬라이더 좌측 컬럼 오버플로 감지 → --slide-scale을 점진적으로 줄여 최적점 찾기
function autoFitLeftCol(leftCol) {
  if (!leftCol) return;
  leftCol.style.setProperty('--slide-scale', '1');
  requestAnimationFrame(() => {
    const name = leftCol.querySelector('.slide-name');
    const atkRow = leftCol.querySelector('.slide-atk-row');
    const miniRow = leftCol.querySelector('.slide-mini-headers');
    const overflowing = () => {
      const o = (el) => el && (el.scrollWidth > el.clientWidth + 1);
      return o(name) || o(atkRow) || o(miniRow);
    };
    let scale = 1;
    const MIN = 0.72;
    const STEP = 0.04;
    for (let i = 0; i < 10 && overflowing() && scale > MIN; i++) {
      scale = Math.max(MIN, scale - STEP);
      leftCol.style.setProperty('--slide-scale', String(scale.toFixed(2)));
    }
  });
}

// 왕실/악인 도장 SVG 뱃지 (단일 이미지, 크기/모양 고정)
function tagBadgeHtml(tag) {
  if (!tag) return '';
  const id = tag === 'royal' ? 'stamp-royal' : 'stamp-villain';
  return `<span class="tag-badge ${tag}" title="${tag === 'royal' ? '왕실' : '악인'}"><svg><use href="#${id}"/></svg></span>`;
}

// 특수 공격 범위 캐릭터만 desc 표시 — 나머지는 미니 그리드로 충분
const SPECIAL_DESC_TYPES = new Set([
  'archer',         // 좌측 대각선 전체 (토글)
  'spearman',       // 세로줄 전체
  'cavalry',        // 가로줄 전체
  'twins',          // 형/동생 패턴
  'shadowAssassin', // 1칸 선택
  'witch',          // 원하는 칸 1곳
  'ratMerchant',    // 쥐 위치
  'weaponSmith',    // 가로/세로 토글
]);
function shouldShowDesc(typeOrObj) {
  if (!typeOrObj) return false;
  const t = typeof typeOrObj === 'string' ? typeOrObj : typeOrObj.type;
  return SPECIAL_DESC_TYPES.has(t);
}

function ratDestroyMsg(rats, mine) {
  const suffix = mine ? '격파됨' : '격파함';
  const coords = rats.map(r => coord(r.col, r.row));
  return `${coords.join(', ')}의 쥐 ${suffix}`;
}

function animateRatDestruction(cells, isMyRat) {
  const board = document.getElementById('game-board');
  if (!board) return;
  if (cells && cells.length > 0) playSfxRatDeath();
  const emoji = isMyRat ? '🐀' : '🐁';
  const color = isMyRat ? '#52b788' : '#e05252';
  const posStyle = isMyRat ? 'top:1px;right:2px' : 'bottom:1px;left:2px';
  for (const { col, row } of cells) {
    const cell = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
    if (!cell) continue;
    const ratEl = document.createElement('span');
    ratEl.style.cssText = `position:absolute;${posStyle};font-size:0.5rem;color:${color};z-index:10;pointer-events:none`;
    ratEl.textContent = emoji;
    ratEl.classList.add('rat-fading');
    cell.appendChild(ratEl);
    setTimeout(() => {
      ratEl.classList.add('rat-fadeout');
      setTimeout(() => ratEl.remove(), 600);
    }, 400);
  }
}

// ── 게임 상태 ─────────────────────────────────────────────────
const S = {
  playerIdx: null,
  myName: null,
  opponentName: null,
  roomId: null,
  phase: 'lobby',

  // 서버에서 받은 캐릭터 데이터
  characters: null,

  // 드래프트 (단계별)
  draftStep: 1,            // 현재 단계 (1,2,3)
  draftSelected: {},       // { 1: type, 2: type, 3: type }
  draftPicked: [],         // 이미 확정된 타입 목록
  deckBuilderMode: false,  // 덱 빌더 모드 여부

  // HP 분배
  myDraft: null,
  hpValues: [4, 3, 3],
  hasTwins: false,
  twinTierHp: 0,

  // 게임
  myPieces: [],
  oppPieces: [],
  isMyTurn: false,
  turnNumber: 1,
  sp: [1, 1],
  instantSp: [0, 0],
  boardBounds: { min: 0, max: 4 },
  boardObjects: [],

  // 액션 상태
  action: null,           // null | 'move' | 'attack' | 'skill_target'
  selectedPiece: null,    // piece index
  targetSelectMode: false, // shadowAssassin/witch 타겟 선택
  skillTargetData: null,  // 스킬 대상 선택 데이터

  // 공격/피격 기록
  attackLog: [],

  // 추리 토큰 (클라이언트 전용) — { pieceKey, icon, name, col, row }
  deductionTokens: [],

  // 팀전 (2v2)
  isTeamMode: false,
  teamId: null,           // 내 팀 (0=A, 1=B)
  teamPlayers: [],        // [{ name, idx, teamId }, ...]
  teamTeams: [[], []],    // [[idx,...], [idx,...]]
  teamDraft: { pick1: null, pick2: null },
  teamDraftConfirmed: false,
  teamTeammatePicks: { pick1: null, pick2: null },
  teamHpDist: null,
};

// ── 오디오 설정 ─────────────────────────────────────────────
let bgmMuted = false;
let sfxMuted = false;
let chatMuted = (() => {
  try { return localStorage.getItem('caligo_chat_muted') === '1'; } catch (e) { return false; }
})();

// ── 타이머 ───────────────────────────────────────────────────
let timerInterval = null;
let timerDeadline = null;

function startClientTimer(seconds) {
  stopClientTimer();
  timerDeadline = Date.now() + seconds * 1000;
  const clock = document.getElementById('timer-clock');
  const arc = document.getElementById('timer-arc');
  const text = document.getElementById('timer-text');
  clock.classList.remove('hidden');
  const total = seconds * 1000;
  const circumference = 283; // 2 * π * 45

  let lastTickSec = -1;
  function tick() {
    const remaining = Math.max(0, timerDeadline - Date.now());
    const secs = Math.ceil(remaining / 1000);
    const ratio = remaining / total;
    arc.style.strokeDashoffset = circumference * (1 - ratio);
    text.textContent = secs;
    // 15초부터 회색 + 깜빡임 (틱 효과음 타이밍과 동일)
    const urgent = secs <= 15;
    arc.classList.toggle('urgent', urgent);
    text.classList.toggle('urgent', urgent);
    // 15초 이하일 때 매초 틱 사운드
    if (secs <= 15 && secs > 0 && secs !== lastTickSec) {
      lastTickSec = secs;
      playTimerTick();
    }
    if (remaining <= 0) stopClientTimer();
  }
  tick();
  timerInterval = setInterval(tick, 250);
}

function stopClientTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerDeadline = null;
  const clock = document.getElementById('timer-clock');
  if (clock) clock.classList.add('hidden');
}

// 로비/게임오버 상태에서는 타이머 관련 이벤트 무시
function isActiveGamePhase() {
  const lobbyShown = document.getElementById('screen-lobby')?.classList.contains('active');
  const gameoverShown = document.getElementById('screen-gameover')?.classList.contains('active');
  return !(lobbyShown || gameoverShown);
}

socket.on('timer_start', ({ seconds }) => {
  // 게임 종료 후 도착한 stale timer_start 차단 (무승부 시 타이머 계속 울리는 버그 방지)
  if (S._gameEnded) return;
  if (!isActiveGamePhase()) return;
  startClientTimer(seconds);
});

socket.on('turn_timeout', () => {
  if (!isActiveGamePhase()) return;
  if (typeof playSfxTimeout === 'function') playSfxTimeout();
  addLog('⏰ 턴 스킵', 'system');
  showSkillToast('⏰ 턴 스킵', false, undefined, 'event');
  // 쌍둥이 이동 페이즈 중 타이머 만료 → 클라 상태/플로팅 버튼/body 클래스 정리
  // (서버는 turnTimeout → endTurn 으로 턴을 진행하지만, 클라가 twin phase 를 자체 정리 안 하면 UI 가 멈춰 보임)
  if (S.twinPhaseActive && typeof exitTwinMovePhase === 'function') {
    exitTwinMovePhase(/*emitToast=*/false);
  }
});

socket.on('placement_timeout', () => {
  if (!isActiveGamePhase()) return;
  if (typeof playSfxTimeout === 'function') playSfxTimeout();
  addLog('⏰ 랜덤 배치', 'system');
  showSkillToast('⏰ 랜덤 배치', false, undefined, 'event');
});

// ── 페이즈별 시간 초과 통합 핸들러 ──
//   서버가 phase_timeout 이벤트로 phase 명을 전달 → 클라가 phase 별 통일 메시지 출력.
const PHASE_TIMEOUT_MSG = {
  initial_reveal:   '⏰ 시간 초과',
  final_reveal:     '⏰ 시간 초과',
  team_draft:       '⏰ 랜덤 선택',
  team_hp:          '⏰ 자동 분배',
  team_reveal:      '⏰ 시간 초과',
  team_placement:   '⏰ 랜덤 배치',
};
socket.on('phase_timeout', ({ phase }) => {
  const msg = PHASE_TIMEOUT_MSG[phase];
  if (!msg) return;
  if (typeof playSfxTimeout === 'function') playSfxTimeout();
  addLog(msg, 'system');
  showSkillToast(msg, false, undefined, 'event');
});

// ── 화면 전환 ─────────────────────────────────────────────────
// 화면 오버레이 — 교환 드래프트를 캐릭터 딕셔너리처럼 떠오르는 패널로 표시.
//   뒤의 교체 페이즈는 그대로 .active 유지 → 슬라이드 인/아웃하는 동안에도 보임.
//   openOverlayScreen: 우측에서 슬라이드 인. closeOverlayScreen: 우측으로 슬라이드 아웃 (같은 방향, 모달처럼 사라짐).
//   showScreen 을 호출하지 않으므로 BGM 등은 호출자가 책임 (필요 시 S.phase 만 갱신).
const OVERLAY_ANIM_MS = 420;
function openOverlayScreen(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.classList.remove('overlay-closing', 'overlay-slide-out-right');
  target.classList.add('is-overlay', 'overlay-slide-in-right');
  S.phase = targetId.replace('screen-', '');
  setTimeout(() => target.classList.remove('overlay-slide-in-right'), OVERLAY_ANIM_MS);
}
function closeOverlayScreen(targetId) {
  const target = document.getElementById(targetId);
  if (!target || !target.classList.contains('is-overlay')) return;
  target.classList.remove('overlay-slide-in-right');
  target.classList.add('overlay-slide-out-right', 'overlay-closing');
  setTimeout(() => {
    target.classList.remove('is-overlay', 'overlay-slide-out-right', 'overlay-closing');
  }, OVERLAY_ANIM_MS);
}

function showScreen(id) {
  // 다른 화면으로 이동 시 떠 있는 오버레이는 자동 정리 (예: 재접속/게임오버 등)
  document.querySelectorAll('.screen.is-overlay').forEach(s => {
    s.classList.remove('is-overlay', 'overlay-slide-in-right', 'overlay-slide-out-right', 'overlay-closing');
  });
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  S.phase = id.replace('screen-', '');
  // 로비 / 게임오버로 돌아가면 타이머 무조건 종료
  if (id === 'screen-lobby' || id === 'screen-gameover') {
    stopClientTimer();
  }
  // BGM 자동 전환
  const setupScreens = ['screen-initial-reveal','screen-exchange','screen-final-reveal','screen-hp','screen-placement','screen-draft','screen-reveal'];
  if (id === 'screen-lobby') bgmPlay('lobby');
  else if (id === 'screen-draft' && S.deckBuilderMode) bgmPlay('lobby');
  else if (setupScreens.includes(id)) bgmPlay('setup');
  else if (id === 'screen-game') bgmPlay('game');
  // gameover는 game_over 핸들러에서 직접 호출
  // #7: 설정 단계 나가기 버튼 표시/숨김
  const exitScreens = ['screen-initial-reveal','screen-exchange','screen-final-reveal','screen-hp','screen-placement'];
  const exitBtn = document.getElementById('btn-setup-exit');
  if (exitBtn) exitBtn.classList.toggle('hidden', !exitScreens.includes(id));
  // 로비 진입 시 내 덱 버튼 상태 갱신
  if (id === 'screen-lobby') updateLobbyDeckButton();
}

// 로비의 "내 덱" 버튼 — 현재 선택된 덱 이름 + 캐릭터 아이콘 상단 표시
function updateLobbyDeckButton() {
  const btn = document.getElementById('btn-deck');
  const preview = document.getElementById('btn-deck-preview');
  if (!btn) return;
  const deck = loadDeck();
  const hasChars = S.characters;
  // 덱 리스트에 실제 존재하는지 확인 — 삭제된 경우 로비에서도 빈 상태로 표시
  const list = loadDeckList();
  const matched = (deck && deck.t1 && deck.t2 && deck.t3)
    ? list.find(d => d && d.t1 === deck.t1 && d.t2 === deck.t2 && d.t3 === deck.t3)
    : null;
  const deckReady = !!matched;  // 리스트에 있어야만 "준비됨"
  // 버튼 텍스트
  if (deckReady) {
    btn.textContent = matched.name || '내 덱';
  } else {
    btn.textContent = '내 덱';
  }
  // 프리뷰 원 — 리스트에 없으면 빈 슬롯 3개
  if (!preview) return;
  preview.classList.remove('hidden');
  const factionCls = (tag) => tag === 'royal' ? 'faction-royal'
                            : tag === 'villain' ? 'faction-villain'
                            : 'faction-none';
  const iconsHtml = [['t1',1],['t2',2],['t3',3]].map(([k, tier]) => {
    if (!deckReady || !hasChars) {
      return `<span class="deck-preview-icon empty"></span>`;
    }
    const c = findLocalChar(deck[k], tier);
    if (!c) return `<span class="deck-preview-icon empty"></span>`;
    return `<span class="deck-preview-icon ${factionCls(c.tag)}" title="${c.name}">${c.icon}</span>`;
  }).join('');
  preview.innerHTML = iconsHtml;
}

// ── 덱 저장/로드 (localStorage) ──────────────────────────────
const DECK_STORAGE_KEY = 'caligo_my_deck';
function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      // 덱 목록에서 동일 조합 매칭하여 이름 부여
      let deckName = '';
      try {
        const list = loadDeckList();
        const match = list.find(x => x && x.t1 === d.t1 && x.t2 === d.t2 && x.t3 === d.t3);
        if (match && match.name) deckName = match.name;
      } catch (e) {}
      return { t1: d.t1 || null, t2: d.t2 || null, t3: d.t3 || null, deckName };
    }
  } catch (e) {}
  return null;
}
function saveDeck(t1, t2, t3) {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify({ t1: t1 || null, t2: t2 || null, t3: t3 || null }));
}
function isDeckEmpty() {
  const d = loadDeck();
  return !d || (!d.t1 && !d.t2 && !d.t3);
}

// ── 덱 목록 (5슬롯) ──────────────────────────────────────────
const DECK_LIST_KEY = 'caligo_deck_list';
const DECK_LIST_SIZE = 5;
function loadDeckList() {
  try {
    const raw = localStorage.getItem(DECK_LIST_KEY);
    if (!raw) return Array(DECK_LIST_SIZE).fill(null);
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      while (arr.length < DECK_LIST_SIZE) arr.push(null);
      return arr.slice(0, DECK_LIST_SIZE);
    }
  } catch (e) {}
  return Array(DECK_LIST_SIZE).fill(null);
}
function saveDeckList(list) {
  localStorage.setItem(DECK_LIST_KEY, JSON.stringify(list));
}
// 지정 슬롯 저장 (slotIdx = null이면 빈 슬롯 자동 선택)
function addToDeckList(t1, t2, t3, name, slotIdx) {
  const list = loadDeckList();
  // 중복 검사 (다른 슬롯에 같은 조합)
  const dupIdx = list.findIndex((d, i) => d && d.t1 === t1 && d.t2 === t2 && d.t3 === t3 && i !== slotIdx);
  if (dupIdx !== -1) {
    showSkillToast('이미 같은 덱이 있습니다.', false, undefined, 'event');
    renderDeckList();
    return false;
  }
  let targetIdx = slotIdx;
  if (targetIdx === null || targetIdx === undefined) {
    targetIdx = list.findIndex(d => !d);
    if (targetIdx === -1) {
      showSkillToast('덱 슬롯이 부족합니다.', false, undefined, 'event');
      renderDeckList();
      return false;
    }
  }
  list[targetIdx] = { t1, t2, t3, name: (name || '').slice(0, 10) };
  saveDeckList(list);
  renderDeckList();
  return true;
}
function updateDeckName(slotIdx, newName) {
  const list = loadDeckList();
  if (!list[slotIdx]) return;
  list[slotIdx].name = (newName || '').slice(0, 10);
  saveDeckList(list);
  renderDeckList();
}
function renderDeckList() {
  const container = document.getElementById('deck-list');
  if (!container) return;
  const list = loadDeckList();
  container.innerHTML = '';
  list.forEach((deck, idx) => {
    // 래퍼: 슬롯 + 바깥쪽 액션 버튼
    const wrap = document.createElement('div');
    wrap.className = 'deck-list-row';
    const slot = document.createElement('div');
    slot.className = 'deck-list-slot' + (deck ? ' filled' : ' empty');
    if (deck) {
      const chars = [1, 2, 3].map(tier => {
        const key = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';
        return findLocalChar(deck[key], tier);
      });
      // 팩션별 원 배경색 (왕실=노랑 / 악인=보라 / 무소속=회색)
      const factionCls = (tag) => tag === 'royal' ? 'faction-royal'
                                : tag === 'villain' ? 'faction-villain'
                                : 'faction-none';
      const iconsHtml = chars.map(c => c
        ? `<span class="deck-list-icon ${factionCls(c.tag)}" title="${c.name}">${c.icon}</span>`
        : '').join('');
      const isSelected = S.deckSavedState && S.deckSavedState.t1 === deck.t1 && S.deckSavedState.t2 === deck.t2 && S.deckSavedState.t3 === deck.t3;
      if (isSelected) slot.classList.add('selected');
      const deckName = deck.name || '';
      slot.innerHTML = `
        <div class="deck-list-icons">${iconsHtml}</div>
        <span class="deck-list-name">${deckName || '<span style="color:var(--muted);font-style:italic">이름 없음</span>'}</span>`;
      slot.addEventListener('click', (e) => {
        if (e.target.closest('.deck-list-actions')) return;
        // 덱 불러오기 + 메인 덱으로 저장 (로비 기본 덱으로 사용됨)
        S.draftSelected = { 1: deck.t1, 2: deck.t2, 3: deck.t3 };
        S.deckSavedState = { t1: deck.t1, t2: deck.t2, t3: deck.t3 };
        S.deckSaved = true;
        saveDeck(deck.t1, deck.t2, deck.t3);
        buildDraftStepUI();
        renderDeckList();
        showSkillToast('덱을 불러왔습니다.', false, undefined, 'event');
      });
    } else {
      slot.innerHTML = `<span class="deck-list-empty-label">빈 슬롯</span>`;
      slot.addEventListener('click', () => {
        // 빈 슬롯 클릭 → 현재 선택된 덱이 모두 채워져있으면 이 슬롯에 저장
        const allSelected = S.draftSelected[1] && S.draftSelected[2] && S.draftSelected[3];
        if (!allSelected) {
          showSkillToast('캐릭터를 모두 선택하지 않았습니다.', false, undefined, 'event');
          return;
        }
        S._pendingSaveSlotIdx = idx;
        openDeckNameModal('');
      });
    }
    wrap.appendChild(slot);
    // 채워진 슬롯만 바깥쪽에 액션 버튼 추가
    if (deck) {
      const actions = document.createElement('div');
      actions.className = 'deck-list-actions';
      actions.innerHTML = `
        <button class="deck-list-rename" data-idx="${idx}" title="이름 수정">✏</button>
        <button class="deck-list-del" data-idx="${idx}" title="삭제">×</button>`;
      wrap.appendChild(actions);
    }
    container.appendChild(wrap);
  });
  // 삭제 버튼 이벤트
  container.querySelectorAll('.deck-list-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      S._pendingDeleteIdx = idx;
      document.getElementById('deck-delete-modal').classList.remove('hidden');
    });
  });
  // 이름 수정 버튼 / 이름 자체 클릭 이벤트
  const openRename = (idx) => {
    const list = loadDeckList();
    if (!list[idx]) return;
    S._pendingRenameIdx = idx;
    openDeckNameModal(list[idx].name || '', true);
  };
  container.querySelectorAll('.deck-list-rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRename(parseInt(btn.dataset.idx));
    });
  });
  // 이름 텍스트 자체 클릭은 더 이상 이름 수정으로 가지 않음 (연필 버튼 전용)
}

// 덱 이름 모달
function openDeckNameModal(initial, isRename) {
  const modal = document.getElementById('deck-name-modal');
  if (!modal) return;
  document.getElementById('deck-name-modal-title').textContent = isRename ? '덱 이름 수정' : '덱 이름 설정';
  const input = document.getElementById('deck-name-input');
  input.value = initial || '';
  input.maxLength = 10;
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
}

// 덱 삭제 모달 핸들러 (한번만 바인딩)
document.getElementById('deck-delete-confirm').addEventListener('click', () => {
  document.getElementById('deck-delete-modal').classList.add('hidden');
  const idx = S._pendingDeleteIdx;
  if (idx === undefined || idx === null) return;
  const list = loadDeckList();
  const removed = list[idx];
  list[idx] = null;
  saveDeckList(list);
  // 삭제한 덱이 현재 활성 덱(caligo_my_deck)과 일치하면 활성 덱도 정리
  if (removed) {
    const cur = loadDeck();
    if (cur && cur.t1 === removed.t1 && cur.t2 === removed.t2 && cur.t3 === removed.t3) {
      // 리스트에 남은 덱이 있으면 첫 번째 덱을 활성으로, 없으면 완전 비움
      const next = list.find(d => d && d.t1 && d.t2 && d.t3);
      if (next) saveDeck(next.t1, next.t2, next.t3);
      else saveDeck(null, null, null);
    }
  }
  renderDeckList();
  try { updateLobbyDeckButton(); } catch (e) {}
  S._pendingDeleteIdx = null;
});
document.getElementById('deck-delete-cancel').addEventListener('click', () => {
  document.getElementById('deck-delete-modal').classList.add('hidden');
  S._pendingDeleteIdx = null;
});

// 덱 이름 모달 확인/취소
document.getElementById('deck-name-confirm').addEventListener('click', () => {
  const input = document.getElementById('deck-name-input');
  const name = (input.value || '').trim().slice(0, 10);
  if (!name) {
    showSkillToast('덱 이름을 입력해주세요.', false, undefined, 'event');
    return;
  }
  const modal = document.getElementById('deck-name-modal');
  modal.classList.add('hidden');
  // 이름 수정 모드
  if (S._pendingRenameIdx !== undefined && S._pendingRenameIdx !== null) {
    updateDeckName(S._pendingRenameIdx, name);
    S._pendingRenameIdx = null;
    showSkillToast('덱 이름이 수정되었습니다.', false, undefined, 'event');
    return;
  }
  // 저장 모드 (지정 슬롯 또는 자동)
  const slotIdx = S._pendingSaveSlotIdx;
  S._pendingSaveSlotIdx = null;
  const t1 = S.draftSelected[1], t2 = S.draftSelected[2], t3 = S.draftSelected[3];
  if (!t1 || !t2 || !t3) return;
  const saved = addToDeckList(t1, t2, t3, name, slotIdx);
  if (saved) {
    saveDeck(t1, t2, t3);
    S.deckSaved = true;
    S.deckSavedState = { t1, t2, t3 };
    renderDraftSlots();
    playSfxDeckSave();
    showSkillToast('덱이 저장되었습니다.', false, undefined, 'event');
  }
});
document.getElementById('deck-name-cancel').addEventListener('click', () => {
  document.getElementById('deck-name-modal').classList.add('hidden');
  S._pendingRenameIdx = null;
  S._pendingSaveSlotIdx = null;
});
// Enter 키로 확인
document.getElementById('deck-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('deck-name-confirm').click();
  }
});

// ── 덱 빌더 ─────────────────────────────────────────────────
// 현재 draftSelected가 실제로 덱 리스트에 저장된 덱과 일치하는지 판정
function isCurrentSelectionSaved() {
  const t1 = S.draftSelected?.[1], t2 = S.draftSelected?.[2], t3 = S.draftSelected?.[3];
  if (!t1 || !t2 || !t3) return false;
  const list = loadDeckList();
  return list.some(d => d && d.t1 === t1 && d.t2 === t2 && d.t3 === t3);
}

function openDeckBuilder() {
  S.deckBuilderMode = true;
  S.draftStep = 1;
  S.draftPicked = [];
  // 저장된 덱이 있으면 불러오기
  const deck = loadDeck();
  S.draftSelected = {};
  if (deck) {
    if (deck.t1 && S.characters[1]?.find(c => c.type === deck.t1)) S.draftSelected[1] = deck.t1;
    if (deck.t2 && S.characters[2]?.find(c => c.type === deck.t2)) S.draftSelected[2] = deck.t2;
    if (deck.t3 && S.characters[3]?.find(c => c.type === deck.t3)) S.draftSelected[3] = deck.t3;
  }
  // 덱 리스트에 실제로 존재하는지 기준으로 '저장됨' 판단
  S.deckSaved = isCurrentSelectionSaved();
  S.deckSavedState = S.deckSaved
    ? { t1: S.draftSelected[1], t2: S.draftSelected[2], t3: S.draftSelected[3] } : null;
  document.getElementById('btn-deck-back').classList.remove('hidden');
  document.getElementById('btn-draft-random').disabled = false;
  document.getElementById('btn-draft-recommend').disabled = false;
  const deckListEl = document.getElementById('deck-list');
  if (deckListEl) deckListEl.classList.remove('hidden');
  buildDraftStepUI();
  renderDeckList();
  showScreen('screen-draft');
}

document.getElementById('btn-deck').addEventListener('click', () => {
  if (S.characters) {
    openDeckBuilder();
  } else {
    socket.emit('request_characters');
    socket.once('characters_data', ({ characters }) => {
      S.characters = characters;
      openDeckBuilder();
      updateLobbyDeckButton();
    });
  }
});

document.getElementById('btn-deck-back').addEventListener('click', () => {
  const allSelected = S.draftSelected[1] && S.draftSelected[2] && S.draftSelected[3];
  // 덱 리스트에 실제로 존재하는지 실시간 검사 (리스트에서 삭제된 경우 대응)
  const savedInList = isCurrentSelectionSaved();
  S.deckSaved = savedInList;
  if (!allSelected) {
    document.getElementById('deck-exit-msg').textContent = '캐릭터를 모두 선택하지 않았습니다. 그래도 나가시겠습니까?';
    document.getElementById('deck-exit-modal').classList.remove('hidden');
    return;
  } else if (!savedInList) {
    document.getElementById('deck-exit-msg').textContent = '덱이 저장되지 않았습니다. 그래도 나가시겠습니까?';
    document.getElementById('deck-exit-modal').classList.remove('hidden');
    return;
  }
  S.deckBuilderMode = false;
  document.getElementById('btn-deck-back').classList.add('hidden');
  const _deckListEl1 = document.getElementById('deck-list');
  if (_deckListEl1) _deckListEl1.classList.add('hidden');
  showScreen('screen-lobby');
});
document.getElementById('deck-exit-confirm').addEventListener('click', () => {
  document.getElementById('deck-exit-modal').classList.add('hidden');
  S.deckBuilderMode = false;
  document.getElementById('btn-deck-back').classList.add('hidden');
  const _deckListEl2 = document.getElementById('deck-list');
  if (_deckListEl2) _deckListEl2.classList.add('hidden');
  showScreen('screen-lobby');
});
document.getElementById('deck-exit-cancel').addEventListener('click', () => {
  document.getElementById('deck-exit-modal').classList.add('hidden');
});

// ── 오디오 토글 버튼 ──
function initAudioToggle() {
  document.querySelectorAll('.btn-bgm-toggle').forEach(btn => {
    btn.textContent = bgmMuted ? '🔇' : '🎵';
    btn.title = bgmMuted ? '음악 켜기' : '음악 끄기';
    btn.addEventListener('click', () => {
      bgmMuted = !bgmMuted;
      document.querySelectorAll('.btn-bgm-toggle').forEach(b => {
        b.textContent = bgmMuted ? '🔇' : '🎵';
        b.title = bgmMuted ? '음악 켜기' : '음악 끄기';
      });
      if (bgmMuted) { bgmStop(); BGM.pendingTrack = null; }
      else {
        // 뮤트 해제: 대기 중이던 트랙 또는 현재 화면에 맞는 트랙 재생
        let track = BGM.pendingTrack;
        if (!track) {
          const active = document.querySelector('.screen.active');
          if (active) {
            const id = active.id;
            const setupScreens = ['screen-initial-reveal','screen-exchange','screen-final-reveal','screen-hp','screen-placement','screen-draft','screen-reveal'];
            if (id === 'screen-lobby' || (id === 'screen-draft' && S.deckBuilderMode)) track = 'lobby';
            else if (setupScreens.includes(id)) track = 'setup';
            else if (id === 'screen-game') track = 'game';
          }
        }
        BGM.pendingTrack = null;
        if (track) bgmPlay(track);
      }
    });
  });
  document.querySelectorAll('.btn-sfx-toggle').forEach(btn => {
    btn.textContent = sfxMuted ? '🔕' : '🔔';
    btn.title = sfxMuted ? '효과음 켜기' : '효과음 끄기';
    btn.addEventListener('click', () => {
      sfxMuted = !sfxMuted;
      document.querySelectorAll('.btn-sfx-toggle').forEach(b => {
        b.textContent = sfxMuted ? '🔕' : '🔔';
        b.title = sfxMuted ? '효과음 켜기' : '효과음 끄기';
      });
    });
  });
}
initAudioToggle();

// 페이지 로드 시 로비 덱 버튼 초기 렌더 (빈 원 3개 표시 보장)
try { updateLobbyDeckButton(); } catch (e) {}

// 페이지 로드 직후 캐릭터 데이터 요청 — 저장된 덱의 아이콘을 로비에서 즉시 표시
socket.on('connect', () => {
  if (!S.characters) {
    socket.emit('request_characters');
  }
});
socket.on('characters_data', ({ characters }) => {
  if (characters && !S.characters) {
    S.characters = characters;
    try { updateLobbyDeckButton(); } catch (e) {}
  }
});

// 닉네임 localStorage 저장/복구
const NICKNAME_KEY = 'caligo_nickname';
try {
  const saved = localStorage.getItem(NICKNAME_KEY);
  const nameInput = document.getElementById('input-name');
  if (saved && nameInput && !nameInput.value) nameInput.value = saved;
} catch (e) {}
document.getElementById('input-name').addEventListener('input', (e) => {
  try { localStorage.setItem(NICKNAME_KEY, (e.target.value || '').slice(0, 12)); } catch (e) {}
});

// ── 로비 ──────────────────────────────────────────────────────
document.getElementById('btn-join').addEventListener('click', () => {
  const name   = document.getElementById('input-name').value.trim();
  const roomId = document.getElementById('input-room').value.trim();
  if (!name || !roomId) { showSkillToast('닉네임과 방 코드를 입력하세요.', false, undefined, 'event'); return; }
  if (isDeckEmpty()) { showSkillToast('내 덱을 채워주세요.', false, undefined, 'event'); return; }
  const deck = loadDeck();
  S.myName = name; S.roomId = roomId;
  socket.emit('join_room', { roomId, playerName: name, deck });
});

document.getElementById('btn-ai').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showSkillToast('닉네임을 입력하세요.', false, undefined, 'event'); return; }
  if (isDeckEmpty()) { showSkillToast('내 덱을 채워주세요.', false, undefined, 'event'); return; }
  const deck = loadDeck();
  S.myName = name; S.opponentName = 'AI 🤖'; socket.emit('join_ai', { playerName: name, deck });
});

// ── 2vs2 팀전 입장 ──
// 방 코드가 비어 있으면 랜덤 생성해서 즉시 방 만들기
document.getElementById('btn-join-team').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showSkillToast('닉네임을 먼저 입력하세요.', false, undefined, 'event'); return; }
  let roomId = document.getElementById('input-room').value.trim();
  if (!roomId) {
    // 랜덤 방 코드 (6자리)
    roomId = 'T' + Math.random().toString(36).substr(2, 5).toUpperCase();
    const roomInput = document.getElementById('input-room');
    if (roomInput) roomInput.value = roomId;
  }
  S.myName = name; S.roomId = roomId; S.isTeamMode = true;
  socket.emit('join_team_room', { roomId, playerName: name });
});

document.getElementById('input-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('input-room').focus();
});
document.getElementById('input-room').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// ── 관전하기 버튼 ──
document.getElementById('btn-spectate').addEventListener('click', () => {
  const modal = document.getElementById('spectate-modal');
  modal.classList.remove('hidden');
  modal.dataset.mode = 'spectate';
  const titleEl = document.getElementById('spectate-modal-title');
  if (titleEl) titleEl.textContent = '👁 관전 가능한 방';
  document.getElementById('spectate-room-list').innerHTML = '<p class="muted">방 목록을 불러오는 중...</p>';
  socket.emit('list_rooms');
});
document.getElementById('spectate-modal-close').addEventListener('click', () => {
  document.getElementById('spectate-modal').classList.add('hidden');
});

// ── 방목록 버튼 (입장 가능한 대기 방) ──
const _btnRoomlist = document.getElementById('btn-roomlist');
if (_btnRoomlist) {
  _btnRoomlist.addEventListener('click', () => {
    const modal = document.getElementById('spectate-modal');
    modal.classList.remove('hidden');
    modal.dataset.mode = 'join';
    const titleEl = document.getElementById('spectate-modal-title');
    if (titleEl) titleEl.textContent = '🚪 입장 가능한 방';
    document.getElementById('spectate-room-list').innerHTML = '<p class="muted">대기 중인 방 목록을 불러오는 중...</p>';
    socket.emit('list_waiting_rooms');
  });
}

// 방목록·관전 모달 필터 상태
S.roomListFilter = 'all';

function applyRoomListFilter(items, render) {
  const container = document.getElementById('spectate-room-list');
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="muted">표시할 방이 없습니다.</p>';
    return;
  }
  const filtered = items.filter(r => {
    if (S.roomListFilter === 'all') return true;
    return r.mode === S.roomListFilter;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<p class="muted">선택한 필터에 해당하는 방이 없습니다.</p>';
    return;
  }
  render(filtered);
}

function renderRoomListFilterTabs(rawList, renderFn, afterRender) {
  const container = document.getElementById('spectate-room-list');
  const tabs = `
    <div class="room-filter-tabs">
      <button class="room-filter-tab${S.roomListFilter === 'all' ? ' active' : ''}" data-f="all">전체</button>
      <button class="room-filter-tab${S.roomListFilter === 'ai' ? ' active' : ''}" data-f="ai">AI 대전</button>
      <button class="room-filter-tab${S.roomListFilter === '1v1' ? ' active' : ''}" data-f="1v1">1대1</button>
      <button class="room-filter-tab${S.roomListFilter === 'team' ? ' active' : ''}" data-f="team">2대2</button>
    </div>
    <div id="room-list-body"></div>`;
  container.innerHTML = tabs;
  container.querySelectorAll('.room-filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      S.roomListFilter = btn.dataset.f;
      renderRoomListFilterTabs(rawList, renderFn, afterRender);
    });
  });
  const body = document.getElementById('room-list-body');
  const filtered = rawList.filter(r => S.roomListFilter === 'all' || r.mode === S.roomListFilter);
  if (filtered.length === 0) {
    body.innerHTML = '<p class="muted">선택한 필터에 해당하는 방이 없습니다.</p>';
    return;
  }
  body.innerHTML = renderFn(filtered);
  if (typeof afterRender === 'function') afterRender();
}

function attachWaitingRoomClicks() {
  const container = document.getElementById('spectate-room-list');
  container.querySelectorAll('.spectate-room-item').forEach(el => {
    el.addEventListener('click', () => {
      const roomId = el.dataset.room;
      const mode = el.dataset.mode;
      const name = document.getElementById('input-name').value.trim();
      if (!name) {
        showSkillToast('닉네임을 먼저 입력하세요.', false, undefined, 'event');
        return;
      }
      S.myName = name;
      S.roomId = roomId;
      document.getElementById('spectate-modal').classList.add('hidden');
      if (mode === 'team') {
        S.isTeamMode = true;
        socket.emit('join_team_room', { roomId, playerName: name });
      } else {
        if (isDeckEmpty()) { showSkillToast('내 덱을 채워주세요.', false, undefined, 'event'); return; }
        socket.emit('join_room', { roomId, playerName: name, deck: loadDeck() });
      }
    });
  });
}

socket.on('waiting_room_list', (list) => {
  const container = document.getElementById('spectate-room-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="muted">현재 입장 가능한 방이 없습니다.</p>';
    return;
  }
  const renderFn = (items) => items.map(r => {
    const modeLabel = r.mode === 'team' ? '2v2 팀전' : '1v1';
    return `
    <div class="spectate-room-item" data-room="${r.roomId}" data-mode="${r.mode}">
      <div class="spectate-room-players">${escapeHtmlGlobal(r.players.join(', ') || '빈 방')}</div>
      <div class="spectate-room-meta">
        <span class="spectate-phase">${modeLabel}</span>
        <span class="spectate-viewers">${r.playerCount}/${r.maxPlayers}</span>
      </div>
    </div>
  `;}).join('');
  renderRoomListFilterTabs(list, renderFn, attachWaitingRoomClicks);
  // 기존 함수 흐름은 여기서 종료
  return;
  container.innerHTML = list.map(r => {
    const modeLabel = r.mode === 'team' ? '2v2 팀전' : '1v1';
    return `
    <div class="spectate-room-item" data-room="${r.roomId}" data-mode="${r.mode}">
      <div class="spectate-room-players">${escapeHtmlGlobal(r.players.join(', ') || '빈 방')}</div>
      <div class="spectate-room-meta">
        <span class="spectate-phase">${modeLabel}</span>
        <span class="spectate-viewers">${r.playerCount}/${r.maxPlayers}</span>
      </div>
    </div>
  `;}).join('');
  container.querySelectorAll('.spectate-room-item').forEach(el => {
    el.addEventListener('click', () => {
      const roomId = el.dataset.room;
      const mode = el.dataset.mode;
      const name = document.getElementById('input-name').value.trim();
      if (!name) {
        showSkillToast('닉네임을 먼저 입력하세요.', false, undefined, 'event');
        return;
      }
      S.myName = name;
      S.roomId = roomId;
      document.getElementById('spectate-modal').classList.add('hidden');
      if (mode === 'team') {
        S.isTeamMode = true;
        socket.emit('join_team_room', { roomId, playerName: name });
      } else {
        if (isDeckEmpty()) { showSkillToast('내 덱을 채워주세요.', false, undefined, 'event'); return; }
        socket.emit('join_room', { roomId, playerName: name, deck: loadDeck() });
      }
    });
  });
});

function attachSpectateRoomClicks() {
  const container = document.getElementById('spectate-room-list');
  container.querySelectorAll('.spectate-room-item').forEach(el => {
    el.addEventListener('click', () => {
      const roomId = el.dataset.room;
      let name = document.getElementById('input-name').value.trim();
      if (!name) name = '관전자' + Math.floor(Math.random() * 1000);
      S.myName = name;
      S.roomId = roomId;
      document.getElementById('spectate-modal').classList.add('hidden');
      socket.emit('join_room', { roomId, playerName: name });
    });
  });
}

socket.on('room_list', (list) => {
  const container = document.getElementById('spectate-room-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="muted">현재 진행 중인 방이 없습니다.</p>';
    return;
  }
  const phaseNames = { draft: '드래프트', hp_distribution: 'HP 분배', reveal: '캐릭터 공개', placement: '배치', game: '전투 중' };
  const renderFn = (items) => items.map(r => {
    const modeLabel = r.mode === 'ai' ? '🤖 AI' : (r.mode === 'team' ? '👥 2v2' : '⚔ 1v1');
    return `
    <div class="spectate-room-item" data-room="${r.roomId}" data-mode="${r.mode || '1v1'}">
      <div class="spectate-room-players">${escapeHtmlGlobal(r.p0Name)} <span class="spectate-vs">vs</span> ${escapeHtmlGlobal(r.p1Name)}</div>
      <div class="spectate-room-meta">
        <span class="spectate-mode">${modeLabel}</span>
        <span class="spectate-phase">${phaseNames[r.phase] || r.phase}</span>
        ${r.turnNumber > 0 ? `<span class="spectate-turn">턴 ${r.turnNumber}</span>` : ''}
        <span class="spectate-viewers">👁 ${r.spectators}</span>
      </div>
    </div>
  `;}).join('');
  renderRoomListFilterTabs(list, renderFn, attachSpectateRoomClicks);
});

function escapeHtmlGlobal(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ═══════════════════════════════════════════════════════════════
// ── 소켓 이벤트 핸들러 ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

socket.on('joined', ({ idx, roomId, characters, sessionToken, reconnected }) => {
  S.playerIdx = idx;
  S.characters = characters;
  // #9: 세션 토큰 저장 (재접속용)
  if (sessionToken) {
    S.sessionToken = sessionToken;
    try {
      sessionStorage.setItem('caligo_session', JSON.stringify({
        roomId, token: sessionToken, playerName: S.myName,
        isTeam: false, ts: Date.now(),
      }));
    } catch (e) {}
  }
  if (reconnected) {
    showSkillToast('재접속', false, undefined, 'event');
    return;
  }
  document.getElementById('waiting-room-code').textContent = `방 코드: ${roomId}`;
  showScreen('screen-waiting');
});

socket.on('waiting', () => showScreen('screen-waiting'));

// ═══════════════════════════════════════════════════════════════
// ── 팀전 (2v2) 대기실 ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
socket.on('team_joined', ({ idx, roomId, playerName, sessionToken }) => {
  S.playerIdx = idx;
  S.roomId = roomId;
  S.isTeamMode = true;
  // #9: 세션 토큰 저장
  if (sessionToken) {
    S.sessionToken = sessionToken;
    try {
      sessionStorage.setItem('caligo_session', JSON.stringify({
        roomId, token: sessionToken, playerName,
        isTeam: true, ts: Date.now(),
      }));
    } catch (e) {}
  }
  const codeEl = document.getElementById('team-waiting-room-code');
  if (codeEl) codeEl.textContent = roomId;  // "방 코드" 라벨은 별도 div로 분리됨
  showScreen('screen-team-waiting');
});

socket.on('team_room_state', ({ players, teams, count, myIdx }) => {
  S.teamPlayers = players || [];
  S.teamTeams = teams || [[], []];
  if (typeof myIdx === 'number') {
    S.playerIdx = myIdx;
    const me = S.teamPlayers.find(p => p.idx === myIdx);
    if (me) S.teamId = me.teamId;
  }
  renderTeamWaitingRoom();
});

socket.on('team_left', () => {
  S.isTeamMode = false;
  S.teamId = null;
  S.teamPlayers = [];
  S.teamTeams = [[], []];
  S.playerIdx = null;
  S.roomId = null;
  showScreen('screen-lobby');
});

socket.on('team_countdown', ({ seconds }) => {
  const el = document.getElementById('team-countdown');
  if (!el) return;
  el.classList.remove('hidden');
  let remain = seconds;
  el.textContent = remain;
  // 시작 버튼 잠금
  const startBtn = document.getElementById('btn-team-start');
  const leaveBtn = document.getElementById('btn-team-leave');
  if (startBtn) startBtn.disabled = true;
  if (leaveBtn) leaveBtn.disabled = true;
  if (window._teamCountdownInterval) clearInterval(window._teamCountdownInterval);
  window._teamCountdownInterval = setInterval(() => {
    remain -= 1;
    if (remain <= 0) {
      clearInterval(window._teamCountdownInterval);
      window._teamCountdownInterval = null;
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = remain;
    }
  }, 1000);
});

socket.on('team_countdown_cancel', () => {
  if (window._teamCountdownInterval) { clearInterval(window._teamCountdownInterval); window._teamCountdownInterval = null; }
  const el = document.getElementById('team-countdown');
  if (el) { el.classList.add('hidden'); el.textContent = ''; }
  const startBtn = document.getElementById('btn-team-start');
  const leaveBtn = document.getElementById('btn-team-leave');
  if (leaveBtn) leaveBtn.disabled = false;
  // 시작 버튼은 renderTeamWaitingRoom에서 업데이트
  if (startBtn && S.teamPlayers && S.teamPlayers.length < 4) {
    startBtn.disabled = true;
  }
  showSkillToast('카운트다운이 취소되었습니다.', false, undefined, 'event');
});

socket.on('team_start_ready', ({ players, teams, characters }) => {
  if (window._teamCountdownInterval) { clearInterval(window._teamCountdownInterval); window._teamCountdownInterval = null; }
  const el = document.getElementById('team-countdown');
  if (el) { el.classList.add('hidden'); el.textContent = ''; }
  S.teamPlayers = players || [];
  S.teamTeams = teams || [[], []];
  if (characters) S.characters = characters;
  const me = S.teamPlayers.find(p => p.idx === S.playerIdx);
  if (me) S.teamId = me.teamId;
  // 실제 screen 전환은 team_draft_start 수신 시
});

// ═══════════════════════════════════════════════════════════════
// ── 팀전 드래프트 ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
socket.on('team_draft_start', ({ myIdx, teamId, players, teams, characters }) => {
  S.playerIdx = myIdx;
  S.teamId = teamId;
  S.teamPlayers = players || [];
  S.teamTeams = teams || [[], []];
  if (characters) S.characters = characters;
  S.teamDraftMode = true;
  S.deckBuilderMode = false;
  S.teamDraftConfirmed = false;
  S.teamDraft = { pick1: null, pick2: null };  // 내 2픽 슬롯
  S.teamTeammatePicks = { pick1: null, pick2: null };  // 팀원 2픽
  S.draftSelected = {};  // 1v1과 호환 — 티어 인덱스. 팀에선 사용 X
  S.draftStep = 1;
  S.draftPicked = [];
  // 덱 관련 버튼 숨김
  const deckBackBtn = document.getElementById('btn-deck-back');
  if (deckBackBtn) deckBackBtn.classList.add('hidden');
  const deckListEl = document.getElementById('deck-list');
  if (deckListEl) deckListEl.classList.add('hidden');
  const randomBtn = document.getElementById('btn-draft-random');
  if (randomBtn) randomBtn.style.display = 'none';
  const recBtn = document.getElementById('btn-draft-recommend');
  if (recBtn) recBtn.style.display = 'none';
  // 사이드바: 3번째 슬롯 숨기고, 1/2번은 "1번 캐릭터" 라벨로
  const slot1 = document.getElementById('draft-slot-1');
  const slot2 = document.getElementById('draft-slot-2');
  const slot3 = document.getElementById('draft-slot-3');
  if (slot3) slot3.classList.add('hidden');
  buildDraftStepUI();
  showScreen('screen-draft');
});

socket.on('team_draft_pick_update', ({ playerIdx, slot, type, teamDrafts }) => {
  if (teamDrafts) {
    const teammateEntry = teamDrafts.find(d => d.idx !== S.playerIdx);
    if (teammateEntry) {
      S.teamTeammatePicks = {
        pick1: teammateEntry.draft.pick1,
        pick2: teammateEntry.draft.pick2,
      };
    }
  }
  if (S.teamDraftMode) {
    // 부분 갱신 — 슬라이드 전체 재렌더는 깜빡임을 만들기 때문에 잠금 상태/사이드바만 업데이트
    if (typeof updateDraftLockState === 'function') updateDraftLockState();
    renderTeamDraftSlots();
  }
});

// 슬라이드 자체는 재렌더하지 않고 select 버튼 + 잠금 오버레이만 갱신
function updateDraftLockState() {
  if (!S.teamDraftMode || !S.characters) return;
  const step = S.draftStep;
  const chars = S.characters[step];
  if (!chars || !chars.length) return;
  const c = chars[slideIndex];
  if (!c) return;
  const selectBtn = document.getElementById('btn-draft-select');
  if (selectBtn) {
    const tmPicks = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
    const teamLocked = tmPicks.includes(c.type);
    const isAlreadySelected = S.teamDraft?.pick1 === c.type || S.teamDraft?.pick2 === c.type;
    if (teamLocked) {
      selectBtn.textContent = '🔒 팀원이 선택함';
      selectBtn.className = 'btn btn-muted btn-select-char';
      selectBtn.disabled = true;
    } else if (isAlreadySelected) {
      selectBtn.textContent = '✔ 선택됨';
      selectBtn.className = 'btn btn-select-char btn-current-select';
      selectBtn.disabled = false;
    } else {
      selectBtn.textContent = '캐릭터 선택';
      selectBtn.className = 'btn btn-accent btn-select-char';
      selectBtn.disabled = false;
    }
  }
  // 잠금 오버레이만 토글
  const slideViewer = document.querySelector('#screen-draft .slide-viewer');
  if (slideViewer) {
    const tmPicks2 = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
    const thisLocked = tmPicks2.includes(c.type);
    slideViewer.classList.toggle('team-dimmed', !!thisLocked);
    let badge = slideViewer.querySelector('.team-dim-overlay');
    if (thisLocked) {
      const tm = S.teamPlayers?.find(p => p.idx !== S.playerIdx && p.teamId === S.teamId);
      const tmName = tm ? tm.name : '팀원';
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'team-dim-overlay';
        slideViewer.appendChild(badge);
      }
      badge.textContent = `🔒 ${tmName}${조사(tmName, '이', '가')} 선택한 캐릭터`;
    } else if (badge) {
      badge.remove();
    }
  }
}

socket.on('team_draft_confirmed', ({ pick1, pick2 }) => {
  S.teamDraft = { pick1, pick2 };
  S.teamDraftConfirmed = true;
  document.getElementById('btn-draft-confirm').disabled = true;
  document.getElementById('btn-draft-select').disabled = true;
  // 대기 토스트 불필요 — 사이드바 진행도로 충분히 확인 가능
});

// 팀 드래프트 사이드바 — 내 2슬롯 + 팀원 2슬롯
function renderTeamDraftSlots() {
  const all = [...(S.characters?.[1]||[]), ...(S.characters?.[2]||[]), ...(S.characters?.[3]||[])];
  const findChar = (t) => all.find(c => c.type === t);

  // 내 슬롯
  const renderMine = (slotId, label, type) => {
    const el = document.getElementById(slotId);
    if (!el) return;
    const c = type ? findChar(type) : null;
    el.classList.remove('empty', 'filled');
    if (c) {
      el.classList.add('filled');
      const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
      el.innerHTML = `
        <span class="slot-tier">${label}</span>
        <span class="slot-icon">${c.icon}</span>
        <div class="slot-info">
          <span class="slot-name">${c.name} ${tagHtml}</span>
          <span class="slot-stats">ATK ${c.atk}</span>
        </div>
        <span class="slot-remove" title="선택 해제">×</span>`;
      el.onclick = (e) => {
        if (S.teamDraftConfirmed) return;
        if (e.target.classList.contains('slot-remove')) {
          const slot = slotId === 'draft-slot-1' ? 'pick1' : 'pick2';
          S.teamDraft[slot] = null;
          socket.emit('team_draft_pick', { slot, type: null });
          renderTeamDraftSlots();
          renderSlide();
        }
      };
    } else {
      el.classList.add('empty');
      el.innerHTML = `<span class="slot-tier">${label}</span><span class="slot-empty-text">미선택</span>`;
      el.onclick = null;
    }
  };
  renderMine('draft-slot-1', '1번 캐릭터', S.teamDraft?.pick1);
  renderMine('draft-slot-2', '2번 캐릭터', S.teamDraft?.pick2);

  // 팀원 픽 (사이드바 하단에 동적 추가)
  let tmContainer = document.getElementById('team-draft-teammate-slots');
  if (!tmContainer) {
    const sidebar = document.querySelector('#screen-draft .draft-sidebar');
    if (sidebar) {
      tmContainer = document.createElement('div');
      tmContainer.id = 'team-draft-teammate-slots';
      tmContainer.className = 'team-draft-teammate-slots';
      sidebar.appendChild(tmContainer);
    }
  }
  if (tmContainer) {
    const tm = S.teamPlayers?.find(p => p.idx !== S.playerIdx && p.teamId === S.teamId);
    const tmName = tm ? tm.name : '팀원';
    const renderTmSlot = (type, label) => {
      const c = type ? findChar(type) : null;
      if (c) {
        const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
        return `<div class="draft-slot filled teammate-slot" data-tm-jump="${c.type}">
          <span class="slot-tier">${label}</span>
          <span class="slot-icon">${c.icon}</span>
          <div class="slot-info">
            <span class="slot-name">${c.name} ${tagHtml}</span>
            <span class="slot-stats">ATK ${c.atk}</span>
          </div>
        </div>`;
      }
      return `<div class="draft-slot empty teammate-slot">
        <span class="slot-tier">${label}</span>
        <span class="slot-empty-text">미선택</span>
      </div>`;
    };
    tmContainer.innerHTML = `
      <h4 class="teammate-slots-title">${escapeHtmlGlobal(tmName)}의 조합</h4>
      ${renderTmSlot(S.teamTeammatePicks?.pick1, '1번 캐릭터')}
      ${renderTmSlot(S.teamTeammatePicks?.pick2, '2번 캐릭터')}
    `;
    // 팀원 슬롯 클릭 → 해당 캐릭터 슬라이드로 이동
    tmContainer.querySelectorAll('[data-tm-jump]').forEach(el => {
      el.addEventListener('click', () => {
        const targetType = el.dataset.tmJump;
        // 모든 티어를 통합 검색
        const allCh = [...(S.characters?.[1]||[]), ...(S.characters?.[2]||[]), ...(S.characters?.[3]||[])];
        const targetIdx = allCh.findIndex(c => c.type === targetType);
        if (targetIdx < 0) return;
        // 어느 티어에 속하는지 결정 → draftStep 변경 후 슬라이드 인덱스 설정
        let runIdx = targetIdx;
        for (const tier of [1, 2, 3]) {
          const tierChars = S.characters?.[tier] || [];
          if (runIdx < tierChars.length) {
            S.draftStep = tier;
            slideIndex = runIdx;
            break;
          }
          runIdx -= tierChars.length;
        }
        if (typeof buildDraftStepUI === 'function') buildDraftStepUI();
        if (typeof renderSlide === 'function') renderSlide();
      });
    });
  }
}

socket.on('team_draft_status', ({ draftDone, doneNames }) => {
  // 1v1 드래프트 화면(screen-draft)을 재활용 — 사이드바에 구슬 컨테이너 동적 추가
  let statusEl = document.getElementById('team-draft-status');
  if (!statusEl) {
    const sidebar = document.querySelector('#screen-draft .draft-sidebar');
    if (sidebar) {
      statusEl = document.createElement('div');
      statusEl.id = 'team-draft-status';
      statusEl.className = 'confirm-beads-wrap';
      sidebar.appendChild(statusEl);
    }
  }
  if (statusEl) {
    statusEl.classList.add('confirm-beads-wrap');
    statusEl.innerHTML = renderConfirmBeads(draftDone);
  }
});

function renderTeamDraft() {
  const grid = document.getElementById('team-draft-grid');
  if (!grid || !S.characters) return;
  // 모든 캐릭터 통합 (티어 구분 X)
  const all = [
    ...(S.characters[1] || []),
    ...(S.characters[2] || []),
    ...(S.characters[3] || []),
  ];
  const myPick1 = S.teamDraft?.pick1;
  const myPick2 = S.teamDraft?.pick2;
  const tmPicks = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
  grid.innerHTML = all.map(c => {
    const selected1 = myPick1 === c.type;
    const selected2 = myPick2 === c.type;
    const selected = selected1 || selected2;
    const disabled = tmPicks.includes(c.type) || S.teamDraftConfirmed;
    const classes = ['team-draft-card'];
    if (selected) classes.push('selected');
    if (disabled) classes.push('disabled');
    const badge = selected1 ? '<div class="team-draft-card-slot-badge">1</div>'
                : selected2 ? '<div class="team-draft-card-slot-badge">2</div>' : '';
    return `<div class="${classes.join(' ')}" data-type="${c.type}">
      <div class="team-draft-card-icon">${c.icon || '❔'}</div>
      <div class="team-draft-card-name">${escapeHtmlGlobal(c.name || c.type)}</div>
      <div class="team-draft-card-atk">ATK ${c.atk}</div>
      ${badge}
    </div>`;
  }).join('');
  // 슬롯 UI
  updateTeamDraftSlot('team-draft-slot-1', '1번 캐릭터', myPick1);
  updateTeamDraftSlot('team-draft-slot-2', '2번 캐릭터', myPick2);
  // 팀원 정보
  const tmInfo = document.getElementById('team-draft-teammate-info');
  if (tmInfo) {
    const teammateEntry = S.teamPlayers.find(p => p.idx !== S.playerIdx && p.teamId === S.teamId);
    if (teammateEntry) {
      const tmName = escapeHtmlGlobal(teammateEntry.name || '팀원');
      const tp1 = S.teamTeammatePicks?.pick1;
      const tp2 = S.teamTeammatePicks?.pick2;
      const findChar = (t) => all.find(x => x.type === t);
      const tp1Str = tp1 ? `${findChar(tp1)?.icon || ''}${findChar(tp1)?.name || tp1}` : '—';
      const tp2Str = tp2 ? `${findChar(tp2)?.icon || ''}${findChar(tp2)?.name || tp2}` : '—';
      tmInfo.innerHTML = `<strong>${tmName}</strong><br>1번: ${tp1Str}<br>2번: ${tp2Str}`;
    } else {
      tmInfo.textContent = '팀원 없음';
    }
  }
  // 확정 버튼
  const confirmBtn = document.getElementById('btn-team-draft-confirm');
  if (confirmBtn) {
    const pickCount = (myPick1 ? 1 : 0) + (myPick2 ? 1 : 0);
    confirmBtn.textContent = S.teamDraftConfirmed ? '✅ 확정됨' : `선택 확정 · ${pickCount}/2`;
    confirmBtn.disabled = S.teamDraftConfirmed || pickCount !== 2;
  }
  // 카드 클릭
  grid.querySelectorAll('.team-draft-card').forEach(card => {
    card.addEventListener('click', () => {
      if (S.teamDraftConfirmed) return;
      if (card.classList.contains('disabled')) return;
      const type = card.dataset.type;
      // 이미 선택된 슬롯이면 취소
      if (myPick1 === type) {
        S.teamDraft.pick1 = null;
        socket.emit('team_draft_pick', { slot: 'pick1', type: null });
        renderTeamDraft();
        return;
      }
      if (myPick2 === type) {
        S.teamDraft.pick2 = null;
        socket.emit('team_draft_pick', { slot: 'pick2', type: null });
        renderTeamDraft();
        return;
      }
      // 빈 슬롯에 할당
      const slot = !myPick1 ? 'pick1' : !myPick2 ? 'pick2' : null;
      if (!slot) {
        showSkillToast('슬롯이 모두 찼습니다.', false, undefined, 'event');
        return;
      }
      S.teamDraft[slot] = type;
      socket.emit('team_draft_pick', { slot, type });
      renderTeamDraft();
    });
  });
}

function updateTeamDraftSlot(slotId, label, type) {
  const el = document.getElementById(slotId);
  if (!el) return;
  if (!type) {
    el.classList.add('empty');
    el.classList.remove('filled');
    el.innerHTML = `<span class="slot-tier">${label}</span><span class="slot-empty-text">미선택</span>`;
    return;
  }
  const all = [
    ...(S.characters?.[1] || []),
    ...(S.characters?.[2] || []),
    ...(S.characters?.[3] || []),
  ];
  const c = all.find(x => x.type === type);
  if (!c) return;
  el.classList.remove('empty');
  el.classList.add('filled');
  el.innerHTML = `<span class="slot-tier">${label}</span>
    <span class="slot-icon-big">${c.icon || ''}</span>
    <span class="slot-name-sm">${escapeHtmlGlobal(c.name || c.type)}</span>`;
}

// 확정 버튼
const _btnTeamDraftConfirm = document.getElementById('btn-team-draft-confirm');
if (_btnTeamDraftConfirm) {
  _btnTeamDraftConfirm.addEventListener('click', () => {
    if (_btnTeamDraftConfirm.disabled) return;
    socket.emit('team_draft_confirm');
  });
}

// ═══════════════════════════════════════════════════════════════
// ── 팀전 HP 분배 ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
socket.on('team_hp_phase', ({ draft, hasTwins, teammateDraft }) => {
  S.teamHpMode = true;
  S.teamDraft = { pick1: draft.pick1, pick2: draft.pick2 };
  S.teamTeammateDraft = teammateDraft || null;
  S.teamTeammateHps = {};
  S.hasTwins = hasTwins;
  buildTeamHpUIOnSharedScreen();
  showScreen('screen-hp');
});

socket.on('team_hp_ok', () => {
  showSkillToast('HP 분배 완료!', false, undefined, 'event');
  const btn = document.getElementById('btn-hp-confirm');
  if (btn) btn.disabled = true;
});

// 팀원 HP 실시간 공유
socket.on('team_hp_browse', ({ playerIdx, hps }) => {
  S.teamTeammateHps = S.teamTeammateHps || {};
  S.teamTeammateHps[playerIdx] = hps;
  updateTeammateHpPanel();
});

// 1v1 screen-hp에 팀전 2슬롯 HP UI를 렌더
function buildTeamHpUIOnSharedScreen() {
  const draft = S.teamDraft;
  S.hpValues = [5, 5];  // 2슬롯 합 10
  const types = [draft.pick1, draft.pick2];
  const container = document.getElementById('hp-pieces');
  container.innerHTML = '';
  const rows = document.createElement('div');
  rows.className = 'hp-piece-rows';
  for (let i = 0; i < 2; i++) {
    const charData = findChar(types[i]);
    if (!charData) continue;
    const row = document.createElement('div');
    row.className = 'hp-piece-row';
    const tagHtml = charData.tag ? tagBadgeHtml(charData.tag) : '';
    row.innerHTML = `
      <span class="char-icon">${charData.icon}</span>
      <div class="hp-piece-label">
        <strong>${charData.name}${tagHtml}</strong>
      </div>
      <div class="hp-input-group">
        <button class="hp-btn" data-i="${i}" data-delta="-1">−</button>
        <span class="hp-value" id="hp-val-${i}">${S.hpValues[i]}</span>
        <button class="hp-btn" data-i="${i}" data-delta="1">+</button>
      </div>`;
    rows.appendChild(row);
  }
  container.appendChild(rows);
  container.querySelectorAll('.hp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.i);
      const delta = parseInt(btn.dataset.delta);
      adjustTeamHp(idx, delta);
    });
  });
  document.getElementById('hp-twin-split').classList.add('hidden');
  updateTeamHpUIShared();
  // 팀원 패널 구축
  buildTeammateHpPanel();
}

function adjustTeamHp(idx, delta) {
  const next = S.hpValues[idx] + delta;
  if (next < 1 || next > 9) return;
  const total = S.hpValues.reduce((a, b) => a + b, 0);
  if (delta > 0 && total >= 10) return;
  // 쌍둥이: 해당 슬롯 최소 2
  const types = [S.teamDraft.pick1, S.teamDraft.pick2];
  if (types[idx] === 'twins' && next < 2) return;
  S.hpValues[idx] = next;
  updateTeamHpUIShared();
  socket.emit('team_hp_browse', { hps: [...S.hpValues] });
}

function updateTeamHpUIShared() {
  for (let i = 0; i < 2; i++) {
    const el = document.getElementById(`hp-val-${i}`);
    if (el) el.textContent = S.hpValues[i];
  }
  const total = S.hpValues.reduce((a, b) => a + b, 0);
  const remEl = document.getElementById('hp-remaining');
  if (remEl) remEl.textContent = 10 - total;
  document.getElementById('btn-hp-confirm').disabled = total !== 10;
}

function buildTeammateHpPanel() {
  let panel = document.getElementById('team-hp-teammate-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'team-hp-teammate-panel';
    panel.className = 'team-hp-teammate-panel';
    const hpContainer = document.querySelector('#screen-hp .hp-container');
    if (hpContainer) hpContainer.appendChild(panel);
  }
  updateTeammateHpPanel();
}

function updateTeammateHpPanel() {
  const panel = document.getElementById('team-hp-teammate-panel');
  if (!panel) return;
  const tm = S.teamPlayers?.find(p => p.idx !== S.playerIdx && p.teamId === S.teamId);
  if (!tm || !S.teamTeammateDraft) {
    panel.innerHTML = `
      <h4 class="teammate-hp-title">${tm ? escapeHtmlGlobal(tm.name) : '팀원'}</h4>
      <div class="muted" style="font-size:0.82rem">분배 중...</div>
    `;
    return;
  }
  const hps = (S.teamTeammateHps && S.teamTeammateHps[tm.idx]) || [0, 0];
  // 내 HP 행과 동일 구조 — char-icon + hp-piece-label + 읽기전용 HP 값 (라벨/총합 제거)
  const types = [S.teamTeammateDraft.pick1, S.teamTeammateDraft.pick2];
  const rows = types.map((t, i) => {
    const c = findChar(t);
    if (!c) return '';
    const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
    return `<div class="hp-piece-row hp-piece-row-readonly">
      <span class="char-icon">${c.icon}</span>
      <div class="hp-piece-label">
        <strong>${escapeHtmlGlobal(c.name)}${tagHtml}</strong>
      </div>
      <div class="hp-input-group hp-input-readonly">
        <span class="hp-value">${hps[i]}</span>
      </div>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <h4 class="teammate-hp-title">${escapeHtmlGlobal(tm.name)}</h4>
    <div class="hp-piece-rows">${rows}</div>
  `;
}

// 팀전 HP UI — 2슬롯 슬라이더
function renderTeamHpUI(hasTwins) {
  const area = document.getElementById('team-hp-area');
  if (!area) return;
  const all = [...(S.characters?.[1]||[]), ...(S.characters?.[2]||[]), ...(S.characters?.[3]||[])];
  const find = (t) => all.find(c => c.type === t);
  const p1 = S.teamDraft.pick1, p2 = S.teamDraft.pick2;
  const c1 = find(p1), c2 = find(p2);
  if (!c1 || !c2) { area.innerHTML = '<p class="error-msg">드래프트 데이터 없음</p>'; return; }

  const t1IsTwin = p1 === 'twins', t2IsTwin = p2 === 'twins';
  const min1 = t1IsTwin ? 2 : 1, min2 = t2IsTwin ? 2 : 1;

  area.innerHTML = `
    <div class="hp-row" data-slot="pick1">
      <span class="hp-row-icon">${c1.icon}</span>
      <span class="hp-row-name">${escapeHtmlGlobal(c1.name)}</span>
      <input type="range" min="${min1}" max="${10-min2}" value="5" class="hp-slider" data-slot="pick1">
      <span class="hp-row-val" id="hp-val-pick1">5</span>
    </div>
    <div class="hp-row" data-slot="pick2">
      <span class="hp-row-icon">${c2.icon}</span>
      <span class="hp-row-name">${escapeHtmlGlobal(c2.name)}</span>
      <input type="range" min="${min2}" max="${10-min1}" value="5" class="hp-slider" data-slot="pick2">
      <span class="hp-row-val" id="hp-val-pick2">5</span>
    </div>
    <div class="hp-total-row">총합 <span id="hp-total">10</span> / 10</div>
  `;

  // 슬라이더 연동: 한쪽 변경 시 다른쪽 10-X 자동 조정
  const s1 = area.querySelector('.hp-slider[data-slot="pick1"]');
  const s2 = area.querySelector('.hp-slider[data-slot="pick2"]');
  const v1 = area.querySelector('#hp-val-pick1');
  const v2 = area.querySelector('#hp-val-pick2');
  function update(from) {
    let a = parseInt(s1.value, 10), b = parseInt(s2.value, 10);
    if (from === 's1') b = 10 - a;
    else b = parseInt(s2.value, 10), a = 10 - b;
    a = Math.max(min1, Math.min(10 - min2, a));
    b = 10 - a;
    s1.value = a; s2.value = b; v1.textContent = a; v2.textContent = b;
    const totalEl = area.querySelector('#hp-total'); if (totalEl) totalEl.textContent = (a+b);
  }
  s1.addEventListener('input', () => update('s1'));
  s2.addEventListener('input', () => update('s2'));
}

socket.on('team_hp_status', ({ hpDone, doneNames }) => {
  const statusEl = document.getElementById('team-hp-status');
  if (statusEl) {
    statusEl.classList.add('confirm-beads-wrap');
    statusEl.innerHTML = renderConfirmBeads(hpDone);
  }
});

function renderTeamHp(hasTwins) {
  const area = document.getElementById('team-hp-area');
  if (!area) return;
  const all = [
    ...(S.characters?.[1] || []),
    ...(S.characters?.[2] || []),
    ...(S.characters?.[3] || []),
  ];
  const p1 = S.teamDraft?.pick1;
  const p2 = S.teamDraft?.pick2;
  const c1 = all.find(x => x.type === p1);
  const c2 = all.find(x => x.type === p2);
  if (!c1 || !c2) { area.innerHTML = '<p class="error-msg">드래프트 데이터가 없습니다.</p>'; return; }

  const slotHtml = (slotId, c, defaultVal, minVal) => `
    <div class="team-hp-slot" data-slot="${slotId}">
      <div class="team-hp-slot-row">
        <span class="icon">${c.icon || ''}</span>
        <span>${escapeHtmlGlobal(c.name || c.type)}</span>
        <input type="number" min="${minVal}" max="${10 - minVal}" value="${defaultVal}" class="team-hp-input" data-slot="${slotId}">
        <span>HP</span>
      </div>
    </div>`;

  const isTwinsP1 = p1 === 'twins';
  const isTwinsP2 = p2 === 'twins';
  const p1Min = isTwinsP1 ? 2 : 1;
  const p2Min = isTwinsP2 ? 2 : 1;

  let html = slotHtml('pick1', c1, 5, p1Min) + slotHtml('pick2', c2, 5, p2Min);
  if (isTwinsP1 || isTwinsP2) {
    html += `<div class="team-hp-slot">
      <div class="team-hp-slot-row">
        <span>👫 남매 내부 분배:</span>
      </div>
      <div class="team-hp-slot-row">
        <span>누나:</span><input type="number" min="1" value="1" class="team-hp-twin-input" data-slot="twinElder"><span>HP</span>
        <span>동생:</span><input type="number" min="1" value="1" class="team-hp-twin-input" data-slot="twinYounger"><span>HP</span>
      </div>
    </div>`;
  }
  area.innerHTML = html;
}

const _btnTeamHpConfirm = document.getElementById('btn-team-hp-confirm');
if (_btnTeamHpConfirm) {
  _btnTeamHpConfirm.addEventListener('click', () => {
    if (_btnTeamHpConfirm.disabled) return;
    const s1 = document.querySelector('.hp-slider[data-slot="pick1"]');
    const s2 = document.querySelector('.hp-slider[data-slot="pick2"]');
    if (!s1 || !s2) return;
    const p1 = parseInt(s1.value, 10);
    const p2 = parseInt(s2.value, 10);
    if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 + p2 !== 10) {
      showError('team-hp-error', 'HP 합계는 10이어야 합니다.');
      return;
    }
    socket.emit('team_hp_distribute', { hps: [p1, p2] });
  });
}

// ═══════════════════════════════════════════════════════════════
// ── 팀전 공개 ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
socket.on('team_reveal_phase', ({ myIdx, teamId, teams, allPlayerPieces }) => {
  S.playerIdx = myIdx;
  S.teamId = teamId;
  S.teamTeams = teams || S.teamTeams;
  renderTeamReveal(allPlayerPieces);
  showScreen('screen-team-reveal');
});

socket.on('team_reveal_status', () => {
  // optional: show waiting state
});

function renderTeamReveal(allPlayerPieces) {
  if (!allPlayerPieces) return;
  const aChars = document.getElementById('team-reveal-a-chars');
  const bChars = document.getElementById('team-reveal-b-chars');
  if (!aChars || !bChars) return;
  aChars.innerHTML = '';
  bChars.innerHTML = '';

  const blue = allPlayerPieces.filter(p => p.teamId === 0);
  const red = allPlayerPieces.filter(p => p.teamId === 1);

  // 플레이어 헤더(라인) + 카드 행 — 박스 중첩 없이 평탄한 구조
  const buildPlayerSection = (pl, container) => {
    const head = document.createElement('div');
    head.className = 'team-reveal-player-header' + (pl.idx === S.playerIdx ? ' is-me' : '');
    head.textContent = pl.name;
    container.appendChild(head);
    const row = document.createElement('div');
    row.className = 'reveal-pieces-row';
    container.appendChild(row);
    return row;
  };

  const blueRows = blue.map(pl => buildPlayerSection(pl, aChars));
  const redRows = red.map(pl => buildPlayerSection(pl, bChars));

  // 쌍둥이 강도(elder+younger 두 piece)는 하나의 카드로 묶어서 표시 — 양식 통일
  const groupTwins = (pieces) => {
    const out = [];
    const twinSeen = new Set();
    for (const pc of (pieces || [])) {
      const isTwin = pc.subUnit === 'elder' || pc.subUnit === 'younger';
      if (isTwin) {
        // 쌍둥이는 한 번만 — 합쳐진 표시 객체 생성
        if (twinSeen.has('twins')) continue;
        twinSeen.add('twins');
        const elder = (pieces || []).find(p => p.subUnit === 'elder');
        const younger = (pieces || []).find(p => p.subUnit === 'younger');
        out.push({
          ...pc,
          type: 'twins',
          name: '쌍둥이 강도',
          icon: '👫',
          atk: pc.atk,
          tier: pc.tier,
          tag: pc.tag,
          isTwinGroup: true,
          twinElder: elder,
          twinYounger: younger,
        });
      } else {
        out.push(pc);
      }
    }
    return out;
  };
  // 카드 등장 — 슬롯별 600ms 딜레이로 순차 등장 + 사운드
  const allCards = [];
  blue.forEach((pl, i) => groupTwins(pl.pieces).forEach((pc, j) => allCards.push({ pc, row: blueRows[i], side: 'left', orderIdx: i*2 + j })));
  red.forEach((pl, i) => groupTwins(pl.pieces).forEach((pc, j) => allCards.push({ pc, row: redRows[i], side: 'right', orderIdx: i*2 + j })));

  allCards.sort((a, b) => a.orderIdx - b.orderIdx);
  let curOrder = -1;
  for (const c of allCards) {
    const delay = 400 + c.orderIdx * 600;
    setTimeout(() => {
      if (c.orderIdx !== curOrder) {
        curOrder = c.orderIdx;
        try { playSfxRevealAppear(); } catch (e) {}
      }
      // 1v1 최종 공개 카드 재사용 — 미니 헤더 + 왕실/악인 태그 + 호버 툴팁 포함
      // 툴팁 방향: 화면 바깥쪽으로 (블루팀=왼쪽, 레드팀=오른쪽) — 중앙 VS 표시·반대편 카드에 가리지 않도록
      const tooltipSide = c.side;  // 'left' | 'right'
      const card = createDraftRevealCard(c.pc, c.pc.tier, tooltipSide, '');
      card.style.animation = 'revealSlide 0.5s ease-out both';
      c.row.appendChild(card);
    }, delay);
  }
}

const _btnTeamRevealContinue = document.getElementById('btn-team-reveal-continue');
if (_btnTeamRevealContinue) {
  _btnTeamRevealContinue.addEventListener('click', () => {
    socket.emit('team_reveal_continue');
    _btnTeamRevealContinue.disabled = true;
    _btnTeamRevealContinue.textContent = '대기 중...';
  });
}

// ═══════════════════════════════════════════════════════════════
// ── 팀전 배치 ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
S.teamPlacement = {
  myPieces: [],
  teammates: [],         // [{ idx, name, pieces }]
  selectedPieceIdx: null,
  zone: null,            // { rowMin, rowMax }
  boardBounds: null,
  confirmed: false,
};

socket.on('team_placement_phase', ({ myIdx, teamId, teams, boardBounds, myPieces, teammates, opponents }) => {
  S.playerIdx = myIdx;
  S.teamId = teamId;
  S.teamTeams = teams || S.teamTeams;
  S.boardBounds = boardBounds || { min: 0, max: 6 };
  S.isTeamMode = true;
  S.teamPlacementMode = true;
  S.myPieces = myPieces || [];
  S.oppPieces = [];  // 좌표는 숨김 (생존 여부만)
  S.teamPlacementTeammates = teammates || [];
  S.teamPlacementEnemies = opponents || [];  // 1v1처럼 상대팀 양 플레이어의 full 정보
  // 1v1 placement UI 재활용
  buildPlacementUI();
  showScreen('screen-placement');
});

socket.on('team_placement_update', ({ teamPieces }) => {
  if (!teamPieces) return;
  const mine = teamPieces.find(t => t.idx === S.playerIdx);
  if (mine) S.myPieces = mine.pieces;
  S.teamPlacementTeammates = teamPieces.filter(t => t.idx !== S.playerIdx);
  // 1v1 placement UI 재렌더
  updatePlacementUI();
  if (typeof buildPlacementOppPanel === 'function') buildPlacementOppPanel();
});

socket.on('team_placed_ok', ({ pieceIdx, col, row }) => {
  if (S.myPieces[pieceIdx]) {
    S.myPieces[pieceIdx].col = col;
    S.myPieces[pieceIdx].row = row;
  }
  // 선택 유지 — 사용자가 같은 캐릭터를 다른 칸으로 자유롭게 재배치할 수 있도록
  // (이전 동작: placementSelected = null 으로 매번 캐릭터 재선택 강제)
  updatePlacementUI();
});

socket.on('team_confirm_placement_ok', () => {
  S.teamPlacementConfirmed = true;
  document.getElementById('btn-placement-confirm').disabled = true;
  document.getElementById('btn-placement-confirm').textContent = '✅ 확정됨';
  // 대기 토스트 불필요
});

socket.on('team_placement_status', ({ placementDone, doneNames }) => {
  // 하단에 구슬 UI로 확정 상태 표시 (블루 2 + 레드 2)
  let statusEl = document.getElementById('team-placement-status-bar');
  if (!statusEl) {
    const panel = document.querySelector('#screen-placement .placement-board-wrap')
      || document.querySelector('#screen-placement');
    if (panel) {
      statusEl = document.createElement('div');
      statusEl.id = 'team-placement-status-bar';
      statusEl.className = 'confirm-beads-wrap';
      panel.appendChild(statusEl);
    }
  }
  if (statusEl) {
    statusEl.innerHTML = renderConfirmBeads(placementDone);
  }
});

// 4명 확정 상태를 구슬로 표시 — 블루 2개 + 레드 2개
function renderConfirmBeads(doneArr) {
  const teams = S.teamTeams || [[],[]];
  const blueTeam = teams[0] || [];
  const redTeam = teams[1] || [];
  const beadHtml = (idx, color) => {
    const done = !!(doneArr || [])[idx];
    return `<span class="confirm-bead bead-${color}${done ? ' bead-done' : ''}" title="${done ? '확정 완료' : '대기 중'}">${done ? '✓' : ''}</span>`;
  };
  const blue = (blueTeam.length > 0 ? blueTeam : [-1, -1]).slice(0, 2).map(idx => beadHtml(idx, 'blue')).join('');
  const red = (redTeam.length > 0 ? redTeam : [-1, -1]).slice(0, 2).map(idx => beadHtml(idx, 'red')).join('');
  // 슬롯이 부족할 때 빈 구슬로 보충
  const blueFill = '<span class="confirm-bead bead-blue"></span>'.repeat(Math.max(0, 2 - blueTeam.length));
  const redFill = '<span class="confirm-bead bead-red"></span>'.repeat(Math.max(0, 2 - redTeam.length));
  return `<div class="confirm-beads"><div class="confirm-beads-side">${blue}${blueFill}</div><div class="confirm-beads-divider">·</div><div class="confirm-beads-side">${red}${redFill}</div></div>`;
}

function renderTeamPlacement() {
  const titleEl = document.getElementById('team-placement-title');
  if (titleEl) {
    const teamLabel = S.teamId === 0 ? '블루팀' : '레드팀';
    titleEl.textContent = `배치 — ${teamLabel}`;
  }
  // 보드 렌더 (7x7)
  const board = document.getElementById('team-placement-board');
  if (!board) return;
  const b = S.teamPlacement.boardBounds || { min: 0, max: 6 };
  // 팀 점유 맵
  const occupied = {};  // key = `${c},${r}`, val = { owner: idx, piece }
  for (const pc of S.teamPlacement.myPieces || []) {
    if (pc.col >= 0) occupied[`${pc.col},${pc.row}`] = { owner: 'me', piece: pc };
  }
  for (const tm of S.teamPlacement.teammates || []) {
    for (const pc of tm.pieces || []) {
      if (pc.col >= 0) occupied[`${pc.col},${pc.row}`] = { owner: 'teammate', piece: pc, teammateName: tm.name };
    }
  }
  let html = '';
  for (let r = b.min; r <= b.max; r++) {
    for (let c = b.min; c <= b.max; c++) {
      const classes = ['cell'];
      // 팀원 점유: 다른 말이 차지함을 표시
      const occ = occupied[`${c},${r}`];
      let inner = `<span class="coord-label">${coord(c, r)}</span>`;
      if (occ) {
        inner += `<span class="piece-icon">${occ.piece.icon || ''}</span>`;
        if (occ.owner === 'teammate') classes.push('occupied-other');
      }
      html += `<div class="${classes.join(' ')}" data-col="${c}" data-row="${r}">${inner}</div>`;
    }
  }
  board.innerHTML = html;
  // 보드 7x7 그리드 강제
  const totalSize = b.max - b.min + 1;
  board.style.gridTemplateColumns = `repeat(${totalSize}, 44px)`;
  board.style.gridTemplateRows = `repeat(${totalSize}, 44px)`;
  // 클릭: 선택된 piece를 해당 위치에 배치 — 구역 제한 없음
  board.querySelectorAll('.cell').forEach(cellEl => {
    cellEl.addEventListener('click', () => {
      if (S.teamPlacement.confirmed) return;
      const c = parseInt(cellEl.dataset.col, 10);
      const r = parseInt(cellEl.dataset.row, 10);
      const pIdx = S.teamPlacement.selectedPieceIdx;
      if (pIdx === null || pIdx === undefined) { showSkillToast('먼저 말을 선택하세요.', false, undefined, 'event'); return; }
      socket.emit('team_place_piece', { pieceIdx: pIdx, col: c, row: r });
    });
  });
  // 내 pieces 리스트
  const myList = document.getElementById('team-placement-my-pieces');
  if (myList) {
    myList.innerHTML = (S.teamPlacement.myPieces || []).map((pc, i) => {
      const placed = pc.col >= 0;
      const selected = S.teamPlacement.selectedPieceIdx === i;
      return `<div class="team-placement-piece ${placed ? 'placed' : ''} ${selected ? 'selected' : ''}" data-idx="${i}">
        <span class="piece-icon">${pc.icon || ''}</span>
        <span class="piece-name">${escapeHtmlGlobal(pc.name || pc.type)}</span>
        <span class="piece-hp">HP ${pc.hp}</span>
      </div>`;
    }).join('');
    myList.querySelectorAll('.team-placement-piece').forEach(el => {
      el.addEventListener('click', () => {
        if (S.teamPlacement.confirmed) return;
        const i = parseInt(el.dataset.idx, 10);
        S.teamPlacement.selectedPieceIdx = S.teamPlacement.selectedPieceIdx === i ? null : i;
        renderTeamPlacement();
      });
    });
  }
  // 팀원 pieces
  const tmList = document.getElementById('team-placement-teammate-pieces');
  if (tmList) {
    const teammates = S.teamPlacement.teammates || [];
    if (!teammates.length) {
      tmList.innerHTML = '<p class="muted" style="font-size:0.78rem">팀원 정보 없음</p>';
    } else {
      tmList.innerHTML = teammates.map(tm => {
        const placedCnt = (tm.pieces || []).filter(p => p.col >= 0).length;
        const totalCnt = (tm.pieces || []).length;
        return `<div class="team-placement-piece">
          <span class="piece-name"><strong>${escapeHtmlGlobal(tm.name)}</strong></span>
          <span class="piece-hp">${placedCnt}/${totalCnt} 배치</span>
        </div>`;
      }).join('');
    }
  }
  // 확정 버튼
  const btn = document.getElementById('btn-team-placement-confirm');
  if (btn) {
    const allPlaced = (S.teamPlacement.myPieces || []).every(p => p.col >= 0);
    btn.disabled = S.teamPlacement.confirmed || !allPlaced;
    btn.textContent = S.teamPlacement.confirmed ? '✅ 확정됨' : allPlaced ? '배치 확정' : '모든 말을 배치하세요';
  }
}

const _btnTeamPlacementConfirm = document.getElementById('btn-team-placement-confirm');
if (_btnTeamPlacementConfirm) {
  _btnTeamPlacementConfirm.addEventListener('click', () => {
    if (_btnTeamPlacementConfirm.disabled) return;
    socket.emit('team_confirm_placement');
  });
}

// ═══════════════════════════════════════════════════════════════
// ── 팀전 게임 루프 ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
function applyTeamGameState(state) {
  if (!state) return;
  S.playerIdx = state.myIdx;
  S.teamId = state.myTeamId;
  S.teamTeams = state.teams || S.teamTeams;
  S.turnNumber = state.turnNumber;
  S.boardBounds = state.boardBounds;
  S.sp = state.sp;
  S.instantSp = state.instantSp;
  S.currentPlayerIdx = state.currentPlayerIdx;
  S.isMyTurn = !!state.isMyTurn;
  S.teamGamePlayers = state.players || [];
  S.boardObjects = state.boardObjects || [];
  // 내 pieces / 팀원 pieces / 적팀 pieces 재구성
  const me = S.teamGamePlayers.find(p => p.idx === S.playerIdx);
  const teammate = S.teamGamePlayers.find(p => p.teamId === S.teamId && p.idx !== S.playerIdx);
  const enemies = S.teamGamePlayers.filter(p => p.teamId !== S.teamId);
  S.myPieces = me ? me.pieces : [];
  S.teammatePieces = teammate ? teammate.pieces : [];
  // 적 2명의 pieces를 합쳐서 oppPieces처럼 다룸 (oppSummary 포맷)
  S.oppPieces = enemies.flatMap(e => (e.pieces || []).map(pc => ({ ...pc, ownerIdx: e.idx, ownerName: e.name, ownerTeamId: e.teamId })));
}

socket.on('team_game_start', (state) => {
  S.isTeamMode = true;          // buildBoard가 7x7로 그리도록 보장
  applyTeamGameState(state);
  if (typeof buildGameUI === 'function') {
    try { buildGameUI(); } catch (e) {}
  }
  showScreen('screen-game');
  // 팀전 시작 — 데미지 도장 초기 스냅샷
  if (typeof snapshotTurnStartHps === 'function') snapshotTurnStartHps();
  renderTeamGameSnapshot();
  showActionBar(S.isMyTurn);
  if (S.isMyTurn) try { playTurnBell(); } catch (e) {}
  // 재접속 vs 신규 게임 시작 구분 — 1v1과 동일하게 turnNumber > 1 또는 reconnect 플래그
  const isReconnect = !!state.reconnect || (state.turnNumber && state.turnNumber > 1);
  if (isReconnect) {
    const cur = (S.teamGamePlayers || []).find(p => p.idx === S.currentPlayerIdx);
    const turnOwnerName = cur ? (cur.idx === S.playerIdx ? (myN() || cur.name) : cur.name) : '?';
    addLog(`${turnOwnerName}의 턴`, 'system');
    playGameStartAnimation(S.isMyTurn, true, turnOwnerName);
  } else {
    // 팀전 시작 애니메이션
    playGameStartAnimation(S.isMyTurn);
  }
});

socket.on('team_game_update', (state) => {
  const wasMyTurn = S.isMyTurn;
  const prevTurnIdx = S.currentPlayerIdx;
  const prevSnap = (typeof snapshotTeamHps === 'function') ? snapshotTeamHps() : null;
  applyTeamGameState(state);
  // 내가 쌍둥이 이동 중이었는데 턴이 넘어가는 케이스 (타이머 만료/강제 종료 등) — UI 정리
  if (wasMyTurn && !S.isMyTurn && S.twinPhaseActive && typeof exitTwinMovePhase === 'function') {
    exitTwinMovePhase(/*emitToast=*/false);
  }
  // 스킬·패시브로 HP가 변한 piece에 hit/heal 애니메이션 — 1v1 skill_result/status_update와 동일
  const currSnap = (typeof snapshotTeamHps === 'function') ? snapshotTeamHps() : null;
  const changes = (typeof detectTeamHpChanges === 'function') ? detectTeamHpChanges(prevSnap, currSnap) : [];
  // 내 턴 새로 들어왔을 때 — 1v1의 your_turn처럼 액션 플래그 전체 리셋
  if (S.isMyTurn && !wasMyTurn) {
    S.action = null;
    S.selectedPiece = null;
    S.targetSelectMode = false;
    S.actionDone = false;
    S.moveDone = false;
    S.actionUsedSkillReplace = false;
    S.twinMovePending = false;
    S.twinMovedSub = null;
    S.twinElderSkipped = false;
    S.twinYoungerSkipped = false;
    S.skillsUsedThisTurn = [];
    S.lastActionType = null;
    S.lastActionPieceType = null;
    try { playTurnBell(); } catch (e) {}
  }
  // 턴이 바뀌었으면 — 1v1처럼 로그·토스트로 누구 차례인지 명확히 알림
  if (prevTurnIdx !== S.currentPlayerIdx && S.currentPlayerIdx !== undefined) {
    // 이전 턴 동안 켜져 있던 turn-bright 카드 모두 해제 — 다음 턴부터 다시 dim 으로
    clearAllTurnBright();
    const cur = (S.teamGamePlayers || []).find(p => p.idx === S.currentPlayerIdx);
    if (cur) {
      const isMine = cur.idx === S.playerIdx;
      const isAlly = cur.teamId === S.teamId && !isMine;
      const label = isMine ? `${myN() || cur.name}` : cur.name;
      const turnMsg = `${S.turnNumber}턴 : ${label} 차례`;
      addLog(turnMsg, 'system');
      // 내 차례만 토스트 (사용자 요청: 다른 플레이어 차례 알림 불필요)
      if (isMine) {
        showSkillToast(`내 차례`, false, S.playerIdx, 'event');
      }
    }
    // 새 턴 시작 — 데미지 도장/HP 빨간 마킹 초기화 (팀모드 turn change 시점)
    // preCurseHps (서버 제공) 로 startHp 캡처해 저주 보라 도장 표시 가능
    if (typeof snapshotTurnStartHps === 'function') snapshotTurnStartHps(state.preCurseHps);
  }
  renderTeamGameSnapshot();
  showActionBar(S.isMyTurn);
  // 보드 외곽 팀 컬러 갱신 (현재 차례 플레이어의 팀)
  if (typeof setTurnBackground === 'function') setTurnBackground(S.isMyTurn);
  if (state.extra_msg) showSkillToast(state.extra_msg, false, undefined, 'event');
  // 스냅샷 비교 — HP 줄어든 piece에 profile-hit, HP 회복된 piece에 heal flash
  if (changes && changes.length > 0) {
    const damaged = changes.filter(c => !c.healed);
    const healed = changes.filter(c => c.healed);
    // 회복량 추적 — 녹색 도장 + HP 바 녹색 오버레이용 (skill_result 외 경로의 회복도 캡처)
    for (const ch of healed) {
      const delta = (ch.newHp || 0) - (ch.oldHp || 0);
      if (delta > 0) addHeal(`${ch.playerIdx}:${ch.pieceIdx}`, delta);
    }
    requestAnimationFrame(() => {
      for (const ch of damaged) {
        // 직전 curse_tick 으로 처리된 piece는 빨간 일반 피격 애니 스킵 (보라 애니가 이미 발동)
        const player = (S.teamGamePlayers || []).find(p => p.idx === ch.playerIdx);
        const piece = player?.pieces?.[ch.pieceIdx];
        if (piece && S._recentCurseDamageKeys?.has(`${ch.playerIdx}:${piece.name}`)) {
          continue;
        }
        const isOwnTeam = player?.teamId === S.teamId;
        const containerId = isOwnTeam ? '#my-pieces-info' : '#opp-pieces-info';
        const card = document.querySelector(`${containerId} .team-profile-block[data-player-idx="${ch.playerIdx}"] [data-piece-idx="${ch.pieceIdx}"]`);
        applyHitFlashWithBrighten(card);
      }
      // 힐 효과 제거 — skill_result / team_skill_notice 가 T+1500ms 에 flashHealPieces 호출
      // (team_game_update 가 즉시 발동하면 중복 + SP 마법구 도중에 노출되므로 차단)
      const _legacyHealLoop = false;
      for (const ch of (_legacyHealLoop ? healed : [])) {
        const isOwnTeam = (S.teamGamePlayers || []).find(p => p.idx === ch.playerIdx)?.teamId === S.teamId;
        const containerId = isOwnTeam ? '#my-pieces-info' : '#opp-pieces-info';
        const card = document.querySelector(`${containerId} .team-profile-block[data-player-idx="${ch.playerIdx}"] [data-piece-idx="${ch.pieceIdx}"]`);
        if (card) {
          card.classList.remove('heal-flash');
          void card.offsetWidth;
          card.classList.add('heal-flash');
          setTimeout(() => card.classList.remove('heal-flash'), 1800);
        }
      }
    });
  }
});

// 팀전 플레이어 전멸 알림 — 토스트 + 로그
// 같은 팀의 살아남은 멤버가 탈락자의 슬롯을 대신 채우게 됨 (renderTurnOrderDots 자동 갱신)
socket.on('team_player_eliminated', ({ playerIdx, playerName, teamId }) => {
  if (playerIdx == null || !playerName) return;
  const isMyTeam = (teamId === S.teamId);
  const txt = `${playerName} 탈락`;
  // 효과음: 우리 팀이면 무거운 톤, 상대 팀이면 일반 톤
  try { playSfx(isMyTeam ? 'opp_skill' : 'skill'); } catch (e) {}
  // 'event' 토스트 — 중립(어두운 회색) 시스템 이벤트 톤
  showSkillToast(txt, false, playerIdx, 'event');
  addLog(txt, 'system');
});

socket.on('team_skill_notice', ({ casterIdx, casterName, casterTeamId, skillUsed, msg, casterPieceIdx, sp, instantSp, hits }) => {
  const myTeam = casterTeamId === S.teamId;
  const label = skillUsed?.skillName ? `${skillUsed.skillName}` : '스킬';
  const icon = skillUsed?.icon || '✨';
  const hasMsg = !!msg;

  // 마법구 비행 + dim 시퀀스 (skill_result/status_update 와 동일)
  const oldSpSnap = Array.isArray(S.sp) ? [...S.sp] : [0, 0];
  const oldInstantSnap = Array.isArray(S.instantSp) ? [...S.instantSp] : [0, 0];
  const newSp = sp || S.sp;
  const newInstant = instantSp || S.instantSp;

  // 시전자 카드 찾기 — 팀 모드 프로필 마크업 [data-player-idx][data-piece-idx]
  const casterCard = (typeof casterPieceIdx === 'number')
    ? document.querySelector(`.team-profile-block[data-player-idx="${casterIdx}"] [data-piece-idx="${casterPieceIdx}"]`)
    : null;
  const _spotlightTarget = (typeof casterPieceIdx === 'number' && casterIdx != null)
    ? { playerIdx: casterIdx, pieceIdx: casterPieceIdx }
    : null;
  startSkillCastDim(casterCard, _spotlightTarget);
  try { spendSPAttention(oldSpSnap, newSp, oldInstantSnap, newInstant); } catch (e) {}

  // ★ 시전자 말풍선 — 팀모드 시점에서도 시전자 카드에서 보드 쪽으로 표시
  if (casterCard && typeof casterPieceIdx === 'number' && casterIdx != null) {
    const casterPlayer = (S.teamGamePlayers || []).find(p => p.idx === casterIdx);
    const casterPc = casterPlayer?.pieces?.[casterPieceIdx];
    const skName = skillUsed?.skillName || label || (msg ? (msg.match(/[가-힣A-Za-z]+(?=:)/) || [])[0] : null);
    if (skName) {
      const stype = getSkillTypeFromPiece(casterPc, skName);
      showSkillCastBubble(casterCard, skName, stype);
    }
  }

  // ★ 통일된 시퀀스 — SP 비행 종료 시점에 SFX + 토스트/로그 동시 발사
  const _spCost = spCostFromDelta(oldSpSnap, newSp, oldInstantSnap, newInstant);
  const TOAST_DELAY_MS = getSpFlightEndMs(_spCost);

  // T+SP_END: SFX + dim 해제 + sp 동기화 + 토스트·로그 (HP/보드는 team_game_update 가 동시 처리)
  //   ★ 기폭 msg 는 SFX 스킵 — detonation_intro blast 가 폭발 SFX 담당
  const _isDetonateMsgTeam = msg && msg.indexOf('💥기폭') === 0;
  setTimeout(() => {
    if (!_isDetonateMsgTeam) {
      const sfxRoute = (typeof pickSkillSfxByMsg === 'function') ? pickSkillSfxByMsg(msg || label) : null;
      if (sfxRoute) sfxRoute();
      else playSfx(myTeam ? 'skill' : 'opp_skill');
    }

    endSkillCastDim(casterCard);
    if (sp) { S.sp = sp; }
    if (instantSp) { S.instantSp = instantSp; }
    if (sp || instantSp) { try { updateSPBar(); } catch (e) {} }

    // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 빨간 도장 / 충성 파란 도장.
    //   팀모드 키 형식: `${defOwnerIdx}:${defPieceIdx}` — owner 별 인덱스로 통일.
    if (Array.isArray(hits) && hits.length > 0) {
      const hitCells = hits.filter(h => h.col != null && h.row != null).map(h => ({ col: h.col, row: h.row }));
      if (hitCells.length > 0) animateAttack([], hitCells);
      for (const h of hits) {
        const dmg = (typeof h.damage === 'number') ? h.damage : 0;
        if (dmg <= 0 || h.defPieceIdx == null || h.defOwnerIdx == null) continue;
        const key = `${h.defOwnerIdx}:${h.defPieceIdx}`;
        if (h.bodyguardRedirect) {
          addLoyaltyDamage(key, dmg);
        } else if (!h.redirectedToBodyguard) {
          addBodyDamage(key, dmg);
        }
      }
    }

    if (hasMsg) {
      showSkillToast(msg, !myTeam, casterIdx, 'skill');
      addLog(msg, 'skill');
    }
  }, TOAST_DELAY_MS);
});

// 팀 모드: HP 감소 감지를 위한 이전 상태 스냅샷
S._prevTeamHpSnap = null;
function snapshotTeamHps() {
  if (!S.teamGamePlayers) return null;
  return S.teamGamePlayers.map(p => ({
    idx: p.idx,
    hps: (p.pieces || []).map(pc => pc.hp),
  }));
}
function detectTeamHpChanges(prev, curr) {
  if (!prev || !curr) return [];
  const changes = [];  // [{ playerIdx, pieceIdx, oldHp, newHp, healed }]
  for (const pl of curr) {
    const old = prev.find(p => p.idx === pl.idx);
    if (!old) continue;
    const ply = (S.teamGamePlayers || []).find(p => p.idx === pl.idx);
    if (!ply) continue;
    for (let i = 0; i < (pl.hps || []).length; i++) {
      const newHp = pl.hps[i];
      const oldHp = old.hps[i];
      if (newHp !== oldHp && oldHp != null) {
        changes.push({ playerIdx: pl.idx, pieceIdx: i, oldHp, newHp, healed: newHp > oldHp });
      }
    }
  }
  return changes;
}

socket.on('team_game_over', ({ win, winnerTeamId, winTeamLabel, loseTeamLabel, winners, losers, reason, spectator }) => {
  stopClientTimer();
  const inGame = _isInGameScreen();
  const isShrinkEnd = reason && reason.type === 'shrink';
  const delay = inGame ? (isShrinkEnd ? 1800 : 1000) : 0;
  setTimeout(() => {
    _showGameOverScreen(!inGame);
    if (!spectator) bgmPlay(win ? 'victory' : 'defeat');
    const r = reason || {};
    const W = winTeamLabel || (winnerTeamId === 0 ? '블루팀' : '레드팀');
    const L = loseTeamLabel || (winnerTeamId === 0 ? '레드팀' : '블루팀');
    const killer = r.killer || '';

    const iconEl = document.getElementById('gameover-icon');
    const titleEl = document.getElementById('gameover-title');
    const subEl = document.getElementById('gameover-sub');

    // 무승부 (양 팀 동시 전멸 또는 unreachable)
    if (r.type === 'draw' || r.type === 'unreachable_draw') {
      if (iconEl) iconEl.textContent = '🤝';
      if (titleEl) { titleEl.textContent = '무승부'; titleEl.style.color = 'var(--muted)'; }
      const subMsg = r.type === 'unreachable_draw'
        ? '게임을 끝낼 수 없어 무승부입니다.'
        : '보드 축소로 양 팀 모든 말이 전멸해 무승부입니다.';
      if (subEl) subEl.innerHTML = subMsg;
      return;
    }

    const isSpec = spectator || S.isSpectator;
    let sub = '';

    if (isSpec) {
      // 관전자 메시지 — 1v1 카피
      if (iconEl) iconEl.textContent = '👁';
      if (titleEl) { titleEl.textContent = '게임 종료'; titleEl.style.color = 'var(--accent)'; }
      switch (r.type) {
        case 'surrender': sub = `${L}의 기권으로, ${W}의 승리입니다.`; break;
        case 'shrink': sub = `보드 축소로 ${L}의 말이 전멸해 ${W}의 승리`; break;
        case 'trap': sub = `덫으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
        case 'bomb': sub = `폭탄으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
        case 'sulfur': sub = `유황범람으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
        case 'nightmare': sub = `악몽으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
        case 'attack': sub = `${W}의 승리`; break;
        default: sub = `${W}의 승리`;
      }
    } else if (win) {
      // 승리 메시지 — 기권은 1v1과 동일한 디자인(🏆 + 승리!), 그 외는 팀전 컨텍스트 유지
      if (iconEl) iconEl.textContent = '🏆';
      if (titleEl) {
        titleEl.textContent = r.type === 'surrender' ? '승리' : '팀 승리';
        titleEl.style.color = 'var(--accent)';
      }
      switch (r.type) {
        case 'surrender': sub = `${L}의 기권입니다.`; break;
        case 'shrink': sub = `${L}${조사(L, '이', '가')} 보드 축소를 피하지 못해 승리했습니다.`; break;
        case 'trap': sub = `덫으로 ${L}의 모든 유닛을 제거해 승리했습니다.`; break;
        case 'bomb': sub = `폭탄으로 ${L}의 모든 유닛을 제거해 승리했습니다.`; break;
        case 'sulfur': sub = `유황범람으로 ${L}의 모든 유닛을 제거해 승리했습니다.`; break;
        case 'nightmare': sub = `악몽으로 ${L}의 모든 유닛을 제거해 승리했습니다.`; break;
        case 'attack': sub = `${L}의 모든 유닛을 제거해 승리했습니다.`; break;
        default: sub = `${L}의 모든 유닛을 제거해 승리했습니다.`;
      }
    } else {
      // 패배 메시지 — 기권은 1v1과 동일한 디자인(🏳 + 기권), 그 외는 팀전 컨텍스트 유지
      if (iconEl) iconEl.textContent = r.type === 'surrender' ? '🏳' : '💀';
      if (titleEl) {
        titleEl.textContent = r.type === 'surrender' ? '기권' : '팀 패배';
        titleEl.style.color = 'var(--danger)';
      }
      switch (r.type) {
        case 'surrender': sub = `기권하여 패배했습니다.`; break;
        case 'shrink': sub = `보드 축소를 피하지 못해 패배하였습니다.`; break;
        case 'trap': sub = `덫으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
        case 'bomb': sub = `폭탄으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
        case 'sulfur': sub = `유황범람으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
        case 'nightmare': sub = `악몽으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
        case 'attack': sub = `${L}에게 패배했습니다.`; break;
        default: sub = `${L}에게 패배했습니다.`;
      }
    }
    if (subEl) {
      // 팀 구분(🟦 블루팀: ... 🟥 레드팀: ...) 중복 표시 제거 — 위 sub 문구만 노출
      subEl.innerHTML = sub;
    }
  }, delay);
});

// 팀전 게임 화면 렌더 — 4인 프로필 + 턴 표시 (턴 배너는 updateTurnBanner가 통일)
function renderTeamGameSnapshot() {
  try {
    if (typeof renderGameBoard === 'function') renderGameBoard();
    renderTeamProfiles();  // 1v1의 renderMyPieces/renderOppPieces 대체
    // 사용자 #14 수정: spotlight 진행 중에 재렌더되면 caster-spotlight 가 사라지므로 즉시 재적용.
    if (typeof reapplyCasterSpotlight === 'function') reapplyCasterSpotlight();
    if (typeof updateSPBar === 'function') updateSPBar();
    updateTurnBanner();  // 1v1과 통일된 턴 배너 + 팀전 턴 오더 도트
  } catch (e) {
    console.error('[team render] error:', e);
  }
}

// 팀전 프로필 렌더 — 누가 보든 위치 고정:
//   blue 팀 → 왼쪽 컨테이너 (my-pieces-info)
//   red  팀 → 오른쪽 컨테이너 (opp-pieces-info)
//   각 팀 내에서 slotPos 오름차순 = 위/아래 (slot 0/1) — idx 기준이 아닌 슬롯 위치 기준
function renderTeamProfiles() {
  const leftContainer = document.getElementById('my-pieces-info');   // 항상 blue 팀
  const rightContainer = document.getElementById('opp-pieces-info'); // 항상 red 팀
  if (!leftContainer || !rightContainer) return;

  const players = S.teamGamePlayers || [];
  const myTeam = S.teamId;

  // 팀 색상별 분류 — 각 팀은 slotPos 오름차순 (slot 0=상단, slot 1=하단)
  // slotPos 동률 시 idx 로 tiebreak (안정 정렬)
  const teamSort = (a, b) => {
    const pa = a.slotPos ?? 99;
    const pb = b.slotPos ?? 99;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  };
  const blueTeam = players.filter(p => p.teamId === 0).sort(teamSort);
  const redTeam  = players.filter(p => p.teamId === 1).sort(teamSort);

  // isAlly = 해당 player의 teamId가 viewer의 teamId와 같으면 true
  leftContainer.innerHTML  = blueTeam.map(pl => renderTeamPlayerBlock(pl, pl.teamId === myTeam)).join('');
  rightContainer.innerHTML = redTeam.map(pl => renderTeamPlayerBlock(pl, pl.teamId === myTeam)).join('');

  // 내 pieces 카드에 클릭 리스너 연결 — 내 팀이 left든 right든 무관하게 my-piece-idx 가 박힌 카드만
  document.querySelectorAll('#my-pieces-info [data-my-piece-idx], #opp-pieces-info [data-my-piece-idx]').forEach(card => {
    card.addEventListener('click', () => {
      if (!S.isMyTurn) return;
      const idx = parseInt(card.dataset.myPieceIdx, 10);
      const pc = S.myPieces[idx];
      if (!pc || !pc.alive) return;
      S.selectedPiece = idx;
      renderGameBoard();
      renderTeamProfiles();
    });
  });

  // 호버 시 공격범위 팝업 — 좌측 컨테이너는 'left', 우측 컨테이너는 'right' 방향
  const attachTooltips = (container, side) => {
    container.querySelectorAll('.team-profile-block').forEach(block => {
      const idxAttr = block.getAttribute('data-player-idx');
      const playerIdx = idxAttr != null ? parseInt(idxAttr, 10) : null;
      if (playerIdx == null) return;
      const player = (S.teamGamePlayers || []).find(p => p.idx === playerIdx);
      if (!player) return;
      block.querySelectorAll('[data-team-piece]').forEach(card => {
        const pcIdx = parseInt(card.getAttribute('data-piece-idx'), 10);
        const pc = (!isNaN(pcIdx)) ? player.pieces?.[pcIdx] : null;
        if (pc && pc.alive) card.appendChild(buildPieceTooltip(pc, side));
      });
    });
  };
  attachTooltips(leftContainer, 'left');
  attachTooltips(rightContainer, 'right');

  // 추리 토큰 드래그 — 상대팀 카드에서만 (좌·우 컨테이너 어디든 적팀이면 가능)
  document.querySelectorAll('#my-pieces-info [data-deduction-key], #opp-pieces-info [data-deduction-key]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      const pieceKey = card.dataset.deductionKey;
      const icon = card.dataset.deductionIcon;
      const name = card.dataset.deductionName;
      e.dataTransfer.setData('text/plain', JSON.stringify({ pieceKey, icon, name, fromBoard: false }));
      e.dataTransfer.effectAllowed = 'move';
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = icon;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 14, 14);
      requestAnimationFrame(() => ghost.remove());
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
}

function renderTeamPlayerBlock(playerData, isAlly) {
  const isMe = playerData.idx === S.playerIdx;
  const currentPlayer = playerData.idx === S.currentPlayerIdx;
  const pieces = playerData.pieces || [];
  const aliveCount = pieces.filter(p => p.alive).length;

  // 팀 컬러 절대 기준: 블루팀은 항상 파랑, 레드팀은 항상 빨강 (관점 무관)
  const teamColorClass = playerData.teamId === 0 ? 'team-block-blue' : 'team-block-red';
  const meClass = isMe ? 'team-block-self-mark' : '';
  const blockClass = `${teamColorClass} ${meClass}`.trim();
  const blockLabel = isMe ? '내 캐릭터' : escapeHtmlGlobal(playerData.name);
  const teamLetter = playerData.teamId === 0 ? 'BLUE' : 'RED';

  // 지휘관 버프 — 내 팀(나+팀원) 지휘관에 인접한 같은 팀 말이면 +1
  const teamPlayers = (S.teamGamePlayers || []).filter(p => p.teamId === playerData.teamId);
  const teamCommanders = teamPlayers.flatMap(p => (p.pieces || []).filter(pp => pp.alive && pp.type === 'commander'));

  const piecesHtml = pieces.map((pc, i) => {
    // 카드 베이스 클래스 — 1v1 대전과 동일하게 통일: 아군=my-piece-card, 적=opp-piece-card
    const isCursedTm = pc.alive && (pc.statusEffects || []).some(e => e.type === 'curse');
    const baseCardClass = `${isAlly ? 'my-piece-card' : 'opp-piece-card'}${isCursedTm ? ' curse-active' : ''}`;
    if (!pc.alive) {
      // 사망 — 아이콘만 💀 로 변경. "격파" 텍스트는 제거 (피격 애니 + .turn-bright 가 사망 알림 역할).
      // 도장(damage stamp) 은 그 턴 동안 카드에 남아 마지막 일격 시각화.
      const _deadDmgOv = (typeof buildDamageOverlay === 'function')
        ? buildDamageOverlay(`${playerData.idx}:${i}`, 0, pc.maxHp || 1)
        : { stamp: '' };
      return `<div class="${baseCardClass} dead" data-team-piece="1" data-piece-idx="${i}">
        ${_deadDmgOv.stamp || ''}
        <div class="my-piece-header"><span class="p-icon">💀</span><strong>${escapeHtmlGlobal(pc.name || pc.type)}</strong></div>
      </div>`;
    }
    const hpPct = (pc.hp / pc.maxHp) * 100;
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const miniHeaders = (typeof buildMiniHeaders === 'function') ? buildMiniHeaders(pc) : '';
    const myPieceAttr = (isAlly && isMe) ? `data-my-piece-idx="${i}"` : '';
    const selectedClass = (isAlly && isMe && S.selectedPiece === i) ? 'active-piece' : '';

    // 스킬·패시브 텍스트 라인은 제거됨 — 미니 헤더 (mini-header)가 이미 표시
    let skillHtml = '', passiveHtml = '', directionHtml = '', moraleHtml = '', statusHtml = '';
    if (isAlly) {
      if (pc.type === 'archer') {
        const dir = pc.toggleState === 'right' ? '우측 대각선' : '좌측 대각선';
        directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
      }
      if (pc.type === 'weaponSmith') {
        const dir = pc.toggleState === 'vertical' ? '세로' : '가로';
        directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
      }
      // 지휘관 사기증진 — 같은 팀 지휘관 인접 시
      const commanderBuff = pc.type !== 'commander' && teamCommanders.some(cm =>
        (Math.abs(cm.col - pc.col) === 1 && cm.row === pc.row) ||
        (Math.abs(cm.row - pc.row) === 1 && cm.col === pc.col)
      );
      if (commanderBuff) {
        moraleHtml = '<span class="status-badge" style="color:#22c55e;background:rgba(34,197,94,0.15)">📋 사기증진</span>';
      }
      statusHtml = renderStatusBadges(pc);
    } else {
      // 적 — 스킬·패시브 텍스트 라인 제거 (미니 헤더로 대체)
      // 궁수·무기상 공격 방향 — 1v1에서 보이는 것과 동일하게
      if (pc.type === 'archer') {
        const dir = pc.toggleState === 'right' ? '우측 대각선' : '좌측 대각선';
        directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
      }
      if (pc.type === 'weaponSmith') {
        const dir = pc.toggleState === 'vertical' ? '세로' : '가로';
        directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
      }
      // 적팀 사기증진 — 적팀 지휘관 인접한 같은 적팀 piece에 표시
      if (pc.type !== 'commander' && pc.col != null) {
        const oppTeamCommanders = teamPlayers.flatMap(pp => (pp.pieces || []).filter(p => p.alive && p.type === 'commander' && p.col != null));
        const enemyMorale = oppTeamCommanders.some(cm =>
          (Math.abs(cm.col - pc.col) === 1 && cm.row === pc.row) ||
          (Math.abs(cm.row - pc.row) === 1 && cm.col === pc.col));
        if (enemyMorale) {
          moraleHtml = '<span class="status-badge" style="color:#22c55e;background:rgba(34,197,94,0.15)">📋 사기증진</span>';
        }
      }
      // 표식 + 기타 상태이상도 표시 (그림자·저주는 적에게 보임)
      statusHtml = renderStatusBadges(pc);
    }

    const atkDisplay = (isAlly && pc.type !== 'commander' && teamCommanders.some(cm =>
      (Math.abs(cm.col - pc.col) === 1 && cm.row === pc.row) ||
      (Math.abs(cm.row - pc.row) === 1 && cm.col === pc.col)
    )) ? `<span style="color:#22c55e;font-weight:800">${(pc.atk || 0) + 1}</span>` : `${pc.atk}`;

    // 위치 표시 — 아군은 항상 / 적은 표식만
    let posText = '';
    if (isAlly) posText = `${coord(pc.col, pc.row)}`;
    else {
      const marked = (pc.statusEffects || []).find(e => e.type === 'mark');
      if (marked && pc.col != null) posText = `${coord(pc.col, pc.row)}`;
    }

    // 적 카드 — 추리 토큰 드래그 소스 + 배지 (ownerIdx 포함된 unique key)
    let placedBadge = '';
    let dragAttrs = '';
    if (!isAlly && pc.alive) {
      const pieceKey = `${pc.type}:${pc.subUnit || ''}@${playerData.idx}`;
      const placedToken = (S.deductionTokens || []).find(t => t.pieceKey === pieceKey);
      if (placedToken) {
        placedBadge = `<span class="deduction-badge" title="추리 토큰: ${coord(placedToken.col, placedToken.row)}">📌${coord(placedToken.col, placedToken.row)}</span>`;
      }
      dragAttrs = ` draggable="true" data-deduction-key="${pieceKey}" data-deduction-icon="${pc.icon || ''}" data-deduction-name="${escapeHtmlGlobal(pc.name || pc.type)}"`;
    }

    // 위치/생존 표시 — 1v1과 동일: 아군은 좌표, 적은 '생존' 또는 표식 시 좌표
    const posDisplayHtml = isAlly
      ? `<span class="my-piece-pos">${posText}</span>`
      : `<span style="color:${pc.alive ? 'var(--success)' : 'var(--danger)'};font-size:0.68rem">${posText ? `📍${posText}` : '생존'}</span>`;
    const nameLenCls = getNameLengthClass(pc.name || pc.type);
    // 이번 턴 데미지 도장 + HP 바 오버레이 (팀모드는 playerIdx 기반 키)
    const dmgOv = (typeof buildDamageOverlay === 'function')
      ? buildDamageOverlay(`${playerData.idx}:${i}`, pc.alive ? (pc.hp ?? 0) : 0, pc.maxHp || 1)
      : { stamp: '', barOverlay: '' };
    // HP 바 폭 — 회복 시 시작 HP 위치 유지, 피해 시 현재 HP 위치 (overlay 가 차이 표시)
    const _displayHpPct = (dmgOv.displayHpPct != null) ? dmgOv.displayHpPct : hpPct;
    return `<div class="${baseCardClass} ${selectedClass}" ${myPieceAttr} data-team-piece="1" data-piece-idx="${i}"${dragAttrs}>
      ${dmgOv.stamp /* 격파된 적·아군에도 데미지 도장 유지 — 사망 마지막 일격까지 보임 */}
      <div class="my-piece-header">
        <span class="p-icon">${pc.icon || ''}</span>
        <strong class="${nameLenCls.trim()}">${escapeHtmlGlobal(pc.name || pc.type)}</strong>
        ${pc.tier ? `<span class="tier-badge">${pc.tier}T</span>` : ''}
        ${tagHtml}
        ${placedBadge}
      </div>
      ${miniHeaders ? `<div class="piece-mini-headers">${miniHeaders}</div>` : ''}
      <div class="hp-bar-bg hp-bar-with-text">
        <div class="hp-bar" style="width:${_displayHpPct}%"></div>
        ${pc.alive ? dmgOv.barOverlay : ''}
        <span class="hp-bar-text">${pc.hp}/${pc.maxHp}</span>
      </div>
      <div class="piece-stat-row">
        <span class="piece-stat-atk"><span class="stat-label">ATK</span> ${atkDisplay}</span>
        ${posDisplayHtml}
      </div>
      ${skillHtml}${passiveHtml}${directionHtml}${statusHtml}${moraleHtml}
    </div>`;
  }).join('');

  // #24: 보드 파괴로 *완전 탈락*한 플레이어 블록에 큰 '탈락' 도장 (사용자 요청: 캐릭터 카드가 아니라 플레이어 프로필 위)
  const isShrunkElim = S._shrunkEliminatedPlayers && S._shrunkEliminatedPlayers.has(playerData.idx);
  return `
    <div class="team-profile-block ${blockClass}${currentPlayer ? ' is-current-turn' : ''}${isShrunkElim ? ' player-eliminated' : ''}" data-player-idx="${playerData.idx}">
      ${isShrunkElim ? '<div class="player-elim-stamp">탈락</div>' : ''}
      <div class="team-profile-header">
        <div class="team-profile-header-left">
          <span class="team-letter team-${teamLetter.toLowerCase()}">${teamLetter}</span>
          <span class="team-block-label">${blockLabel}</span>
          ${currentPlayer ? '<span class="team-turn-mark">현재 차례</span>' : ''}
        </div>
      </div>
      ${piecesHtml}
    </div>
  `;
}

// 팀 대기실 렌더
function renderTeamWaitingRoom() {
  const statusMsg = document.getElementById('team-status-msg');
  const startBtn = document.getElementById('btn-team-start');
  const total = (S.teamPlayers || []).length;
  const teamAOk = (S.teamTeams[0] || []).length === 2;
  const teamBOk = (S.teamTeams[1] || []).length === 2;
  const ready = total === 4 && teamAOk && teamBOk;
  if (statusMsg) {
    if (total < 4) statusMsg.textContent = '4명이 모이면 게임을 시작하세요.';
    else if (!ready) statusMsg.textContent = '각 팀에 2명씩 배정해주세요.';
    else statusMsg.textContent = '모두 준비 완료!';
  }
  if (startBtn) {
    startBtn.disabled = !ready;
    startBtn.textContent = '게임 시작';
  }
  // 슬롯 렌더 — slotPos 기반 정확한 자리 표시
  document.querySelectorAll('#screen-team-waiting .team-slot').forEach(slotEl => {
    const teamId = parseInt(slotEl.dataset.team, 10);
    const pos = parseInt(slotEl.dataset.pos, 10);
    const player = (S.teamPlayers || []).find(p => p.teamId === teamId && (p.slotPos ?? -1) === pos);
    slotEl.classList.remove('filled', 'self', 'ai-bot');
    if (player) {
      const isMe = player.idx === S.playerIdx;
      const isBot = !!player.isAI || /^(블루봇|레드봇)/.test(player.name || '');
      slotEl.classList.add('filled');
      if (isMe) slotEl.classList.add('self');
      if (isBot) slotEl.classList.add('ai-bot');
      slotEl.innerHTML = `
        <span class="slot-nickname">${escapeHtmlGlobal(player.name)}</span>
        ${isMe ? '<span class="slot-you-badge">나</span>' : ''}
        ${isBot ? '<button class="slot-bot-remove" data-bot-remove="1" title="AI 봇 제거">×</button>' : ''}
      `;
    } else {
      slotEl.innerHTML = `
        <span class="team-slot-label">빈 슬롯</span>
        <button class="slot-add-bot" data-add-bot="1" title="이 자리에 AI 봇 추가">🤖 AI 봇 추가</button>
      `;
    }
  });
}

// 팀 슬롯 클릭 — 빈 슬롯이면 자리 이동, AI 봇 추가/제거 버튼이면 별도 처리
document.querySelectorAll('#screen-team-waiting .team-slot').forEach(slotEl => {
  slotEl.addEventListener('click', (e) => {
    if (!S.isTeamMode) return;
    const teamId = parseInt(slotEl.dataset.team, 10);
    const pos = parseInt(slotEl.dataset.pos, 10);
    // AI 봇 추가
    if (e.target.dataset?.addBot === '1') {
      e.stopPropagation();
      socket.emit('team_add_bot', { targetTeam: teamId, targetPos: pos });
      return;
    }
    // AI 봇 제거
    if (e.target.dataset?.botRemove === '1') {
      e.stopPropagation();
      socket.emit('team_remove_bot', { targetTeam: teamId, targetPos: pos });
      return;
    }
    // 차있는 슬롯 (사람) 클릭은 무시
    if (slotEl.classList.contains('filled')) return;
    socket.emit('team_change', { targetTeam: teamId, targetPos: pos });
  });
});

// 게임 시작 버튼
const btnTeamStart = document.getElementById('btn-team-start');
if (btnTeamStart) {
  btnTeamStart.addEventListener('click', () => {
    if (btnTeamStart.disabled) return;
    socket.emit('team_start_request');
  });
}
// 나가기 버튼
const btnTeamLeave = document.getElementById('btn-team-leave');
if (btnTeamLeave) {
  btnTeamLeave.addEventListener('click', () => {
    if (window._teamCountdownInterval) { clearInterval(window._teamCountdownInterval); window._teamCountdownInterval = null; }
    socket.emit('team_leave');
  });
}

// ── 관전자 모드 ──
socket.on('spectator_joined', ({ roomId, phase, gameState, draftState, hpState, placementState, characters, p0Name, p1Name }) => {
  S.isSpectator = true;
  S.playerIdx = -1;
  S.specP0Name = p0Name;
  S.specP1Name = p1Name;
  if (characters) S.specCharacters = characters;
  // 관전자 전용 채팅 표시
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.placeholder = '관전자 채팅';

  if (phase === 'game' && gameState) {
    buildBoard('game-board', () => {});
    renderSpectatorGame(gameState);
    showScreen('screen-game');
  } else if (phase === 'draft' && draftState) {
    S.specDraft = { ...draftState, p0Browse: {}, p1Browse: {} };
    renderSpectatorDraft();
    showScreen('screen-draft');
  } else if (phase === 'hp_distribution' && hpState) {
    S.specDraft = draftState;
    S.specHp = { ...hpState, p0Hps: null, p1Hps: null, p0Draft: draftState?.p0 || null, p1Draft: draftState?.p1 || null };
    renderSpectatorHp();
    showScreen('screen-hp');
  } else if (phase === 'reveal' && hpState) {
    S.specReveal = { p0Pieces: hpState.p0Pieces, p1Pieces: hpState.p1Pieces, p0Name, p1Name };
    renderSpectatorReveal();
    showScreen('screen-reveal');
  } else if (phase === 'placement' && placementState) {
    S.specPlacement = placementState;
    S.boardBounds = placementState.boardBounds;
    renderSpectatorPlacement();
    showScreen('screen-placement');
  } else {
    document.getElementById('waiting-title').textContent = `👁 관전 모드 — ${p0Name} vs ${p1Name}`;
    document.getElementById('waiting-sub').textContent = phase === 'waiting' ? '게임이 아직 시작되지 않았습니다. 잠시 기다려주세요...' :
      '게임이 진행 중입니다. 잠시 기다려주세요...';
    document.getElementById('waiting-room-code').textContent = `방 코드: ${roomId}`;
    showScreen('screen-waiting');
  }
});

// ── 팀전 관전자 ──
socket.on('team_spectator_joined', ({ roomId, phase, gameState, characters, players, teams }) => {
  S.isSpectator = true;
  S.isTeamMode = true;
  S.playerIdx = -1;
  S.teamId = 0;
  if (characters) S.characters = characters;
  S.teamPlayers = players || [];
  S.teamTeams = teams || [[],[]];
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.placeholder = '관전자 채팅';

  if (phase === 'game' && gameState) {
    buildBoard('game-board', () => {});
    applyTeamSpectatorState(gameState);
    if (typeof renderTeamGameSnapshot === 'function') renderTeamGameSnapshot();
    showScreen('screen-game');
    showActionBar(false);
  } else {
    document.getElementById('waiting-title').textContent = `👁 팀전 관전 모드`;
    document.getElementById('waiting-sub').textContent = phase === 'waiting'
      ? '팀전이 아직 시작되지 않았습니다. 잠시 기다려주세요...'
      : '팀전이 진행 중입니다. 잠시 기다려주세요...';
    document.getElementById('waiting-room-code').textContent = `방 코드: ${roomId}`;
    showScreen('screen-waiting');
  }
});

socket.on('team_spectator_update', (state) => {
  if (!S.isSpectator || !S.isTeamMode) return;
  const board = document.getElementById('game-board');
  if (board && !board.querySelector('.cell')) buildBoard('game-board', () => {});
  applyTeamSpectatorState(state);
  if (!document.getElementById('screen-game').classList.contains('active')) {
    showScreen('screen-game');
  }
  if (typeof renderTeamGameSnapshot === 'function') renderTeamGameSnapshot();
  showActionBar(false);
});

function applyTeamSpectatorState(state) {
  S.isSpectator = true;
  S.isTeamMode = true;
  S.isMyTurn = false;
  S.playerIdx = -1;
  S.teamId = 0;
  S.turnNumber = state.turnNumber;
  S.boardBounds = state.boardBounds;
  S.sp = state.sp;
  S.instantSp = state.instantSp;
  S.currentPlayerIdx = state.currentPlayerIdx;
  S.teamGamePlayers = state.players || [];
  S.boardObjects = state.boardObjects || [];
  S.teamTeams = state.teams || S.teamTeams;
  // 관전자 보드 표시 — A팀=내팀 슬롯, B팀=상대 슬롯 (적 좌표는 marked로 모두 노출)
  const teamA = (S.teamGamePlayers || []).filter(p => p.teamId === 0);
  const teamB = (S.teamGamePlayers || []).filter(p => p.teamId === 1);
  S.myPieces = teamA[0] ? teamA[0].pieces : [];
  S.teammatePieces = teamA[1] ? teamA[1].pieces : [];
  S.oppPieces = teamB.flatMap(p => (p.pieces || []).map(pc => ({
    ...pc, marked: true,
    ownerIdx: p.idx, ownerName: p.name, ownerTeamId: p.teamId,
  })));
}

socket.on('spectator_update', (gameState) => {
  if (!S.isSpectator) return;
  // 보드가 비어있으면 먼저 빌드
  const board = document.getElementById('game-board');
  if (board && !board.querySelector('.cell')) {
    buildBoard('game-board', () => {});
  }
  renderSpectatorGame(gameState);
  if (!document.getElementById('screen-game').classList.contains('active')) {
    showScreen('screen-game');
  }
});

// ── 관전자 1v1 스킬 시전 애니 (마법구 비행 + dim) ──
// 1v1 모드에서만 사용 (팀모드는 team_skill_notice 가 동일 역할).
// 페이로드: casterIdx, casterName, casterPieceIdx, sp, instantSp, skillUsed
socket.on('spectator_skill_anim', ({ casterIdx, casterPieceIdx, sp, instantSp, skillUsed, twinJoin, msg, hits }) => {
  if (!S.isSpectator) return;

  // ★ 분신 비행 — 관전자도 동일 애니메이션 + SFX
  if (twinJoin && typeof playTwinJoinFlight === 'function') {
    const moverIcon = twinJoin.moverSub === 'elder' ? '👧' : '👦';
    playTwinJoinFlight(moverIcon, twinJoin.fromCol, twinJoin.fromRow, twinJoin.toCol, twinJoin.toRow);
    if (typeof playSfxTwinsJoin === 'function') playSfxTwinsJoin();
  }

  const oldSpSnap = Array.isArray(S.sp) ? [...S.sp] : [0, 0];
  const oldInstantSnap = Array.isArray(S.instantSp) ? [...S.instantSp] : [0, 0];

  // 1v1 관전자 화면: P0 카드는 #my-pieces-info, P1 카드는 #opp-pieces-info
  const containerSel = (casterIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
  const cardSel = (casterIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
  const casterCard = (typeof casterPieceIdx === 'number')
    ? document.querySelectorAll(`${containerSel} ${cardSel}`)[casterPieceIdx]
    : null;
  startSkillCastDim(casterCard);
  try { spendSPAttention(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp); } catch (e) {}

  // ★ 시전자 말풍선 (관전자 시점)
  if (casterCard && typeof casterPieceIdx === 'number') {
    // 관전자 — 양쪽 piece 데이터 모두 접근. 카드의 컨테이너로 누구 piece 인지 결정
    const sourcePieces = (casterIdx === 0) ? (S.myPieces || S.specP0Pieces) : (S.oppPieces || S.specP1Pieces);
    const casterPc = sourcePieces?.[casterPieceIdx];
    const skName = skillUsed?.skillName || (msg ? (msg.match(/[가-힣A-Za-z]+(?=:)/) || [])[0] : null);
    if (skName) {
      const stype = getSkillTypeFromPiece(casterPc, skName);
      showSkillCastBubble(casterCard, skName, stype);
    }
  }

  // ★ 통일 — SP 비행 종료 시점에 dim 해제 + sp 동기화
  const _spCost = spCostFromDelta(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp);
  const SP_END_MS = getSpFlightEndMs(_spCost);
  setTimeout(() => {
    endSkillCastDim(casterCard);
    if (sp) S.sp = sp;
    if (instantSp) S.instantSp = instantSp;
    if (sp || instantSp) try { updateSPBar(); } catch (e) {}

    // ★ 데미지 스킬 hits — 관전자 시점에서도 셀 hit 애니 + 카드 hit flash + turn-bright + 본체 도장.
    //   1v1 관전자: p0 → #my-pieces-info, p1 → #opp-pieces-info 매핑.
    if (Array.isArray(hits) && hits.length > 0) {
      const hitCells = hits.filter(h => h.col != null && h.row != null).map(h => ({ col: h.col, row: h.row }));
      if (hitCells.length > 0) animateAttack([], hitCells);
      for (const h of hits) {
        if (h.defPieceIdx == null || h.defOwnerIdx == null) continue;
        const dmg = (typeof h.damage === 'number') ? h.damage : 0;
        if (dmg > 0) {
          const key = (h.defOwnerIdx === 0) ? `my:${h.defPieceIdx}` : `opp:${h.defPieceIdx}`;
          if (h.bodyguardRedirect) addLoyaltyDamage(key, dmg);
          else if (!h.redirectedToBodyguard) addBodyDamage(key, dmg);
        }
        if (h.redirectedToBodyguard && !h.bodyguardRedirect) continue;
        const containerSel = (h.defOwnerIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
        const cardSel = (h.defOwnerIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
        const cards = document.querySelectorAll(`${containerSel} ${cardSel}`);
        const card = cards[h.defPieceIdx];
        if (card) applyHitFlashWithBrighten(card);
      }
      if (S.specGameState) renderSpectatorGame(S.specGameState);
    }
  }, SP_END_MS);
});

// ── 관전자 일반 공격 애니메이션 ──
//   서버가 each being_attacked emit 옆에 같이 emit 함. defOwnerIdx 0/1 → my/opp 패널 매핑.
socket.on('spectator_attack_anim', ({ atkCells, hits }) => {
  if (!S.isSpectator) return;
  // 셀 hit 번쩍임 (공격 범위 + 피격 셀)
  const hitCellList = (hits || []).filter(h => h.col != null && h.row != null).map(h => ({ col: h.col, row: h.row }));
  if (Array.isArray(atkCells) || hitCellList.length > 0) {
    animateAttack(atkCells || [], hitCellList);
  }
  // 효과음 — kill / hit
  if ((hits || []).some(h => h.destroyed)) {
    try { playSfx('kill'); } catch (e) {}
  } else if (hitCellList.length > 0) {
    try { playSfx('hit'); } catch (e) {}
  }
  // 1v1 관전자 — defOwnerIdx 0=p0(#my-pieces-info), 1=p1(#opp-pieces-info) 매핑.
  if (!S.isTeamMode) {
    for (const h of (hits || [])) {
      if (h.defPieceIdx == null || h.defOwnerIdx == null) continue;
      const dmg = (typeof h.damage === 'number') ? h.damage : 0;
      // 본체 빨간 도장 / 충성 파란 도장 누적
      if (dmg > 0) {
        const key = (h.defOwnerIdx === 0) ? `my:${h.defPieceIdx}` : `opp:${h.defPieceIdx}`;
        if (h.bodyguardRedirect) addLoyaltyDamage(key, dmg);
        else if (!h.redirectedToBodyguard) addBodyDamage(key, dmg);
      }
      // 카드 hit flash + turn-bright (호위무사가 본체 가로챈 경우는 BG 카드만 빛남)
      if (h.redirectedToBodyguard && !h.bodyguardRedirect) continue;
      const containerSel = (h.defOwnerIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
      const cardSel = (h.defOwnerIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
      const card = document.querySelectorAll(`${containerSel} ${cardSel}`)[h.defPieceIdx];
      if (card) applyHitFlashWithBrighten(card);
    }
    // spectator 패널 재렌더 — 도장 반영
    if (S.specGameState) renderSpectatorGame(S.specGameState);
    return;
  }
  // 팀모드 관전자 — team-profile-block[data-player-idx][data-piece-idx] 마크업 매핑.
  for (const h of (hits || [])) {
    if (h.defPieceIdx == null || h.defOwnerIdx == null) continue;
    const dmg = (typeof h.damage === 'number') ? h.damage : 0;
    if (dmg > 0) {
      const key = `${h.defOwnerIdx}:${h.defPieceIdx}`;
      if (h.bodyguardRedirect) addLoyaltyDamage(key, dmg);
      else if (!h.redirectedToBodyguard) addBodyDamage(key, dmg);
    }
    if (h.redirectedToBodyguard && !h.bodyguardRedirect) continue;
    const card = document.querySelector(`.team-profile-block[data-player-idx="${h.defOwnerIdx}"] [data-piece-idx="${h.defPieceIdx}"]`);
    if (card) applyHitFlashWithBrighten(card);
  }
});

// ── 관전자 전투 로그 ──
socket.on('spectator_log', ({ msg, type, playerIdx }) => {
  if (!S.isSpectator) return;
  addLog(msg, type || 'system');
  if (type === 'event') {
    showSkillToast(msg, false, undefined, 'event');
  } else if (type === 'skill' || type === 'hit' || type === 'passive' || type === 'move' || type === 'miss' || type === 'attack') {
    showSkillToast(msg, false, playerIdx);
  }
  // 관전자 전용 효과음: 메시지 내용으로 판단
  if (type === 'passive' && msg.startsWith('☠ 저주:') && msg.includes('0.5 피해')) {
    playSfxCurseDamage();
  } else if (type === 'passive') {
    // 그 외 패시브는 전용 차임
    playSfxPassive();
  } else if (type === 'skill' && msg.startsWith('⛓ 악몽:')) {
    playSfxNightmare();
  } else if (type === 'hit' && msg.includes('🪤')) {
    playSfxTrapSnap();
  } else if (type === 'hit' && msg.includes('💥')) {
    playSfxBombExplode();
  } else if (msg.includes('🐀') && (msg.includes('격파') || msg.includes('사라'))) {
    playSfxRatDeath();
  }
});

// ── 관전자: 페이즈 전환 알림 ──
socket.on('spectator_phase', ({ phase, p0Name, p1Name, characters, p0Draft, p1Draft }) => {
  if (!S.isSpectator) return;
  S.specP0Name = p0Name;
  S.specP1Name = p1Name;
  if (characters) S.specCharacters = characters;
  if (phase === 'draft') {
    S.specDraft = { p0: null, p1: null, draftDone: [false, false] };
    renderSpectatorDraft();
    showScreen('screen-draft');
  } else if (phase === 'hp') {
    S.specDraft = { p0: p0Draft, p1: p1Draft };
    S.specHp = {
      p0Pieces: [], p1Pieces: [], hpDone: [false, false],
      p0Hps: [4, 3, 3], p1Hps: [4, 3, 3],
      p0Draft: p0Draft, p1Draft: p1Draft,
    };
    renderSpectatorHp();
    showScreen('screen-hp');
  }
});

// ── 관전자: 드래프트 실시간 브라우징 ──
socket.on('spectator_draft_browse', ({ playerIdx, playerName, step, type, selected }) => {
  if (!S.isSpectator) return;
  if (!S.specDraft) S.specDraft = { p0: null, p1: null, draftDone: [false, false], p0Browse: {}, p1Browse: {} };
  const key = playerIdx === 0 ? 'p0Browse' : 'p1Browse';
  S.specDraft[key] = selected || {};
  renderSpectatorDraft();
});

// ── 관전자: 드래프트 최종 확정 ──
socket.on('spectator_draft_update', ({ playerIdx, playerName, draft, draftDone }) => {
  if (!S.isSpectator) return;
  if (!S.specDraft) S.specDraft = { p0: null, p1: null, draftDone: [false, false], p0Browse: {}, p1Browse: {} };
  if (playerIdx === 0) { S.specDraft.p0 = draft; S.specDraft.p0Browse = { 1: draft.t1, 2: draft.t2, 3: draft.t3 }; }
  else { S.specDraft.p1 = draft; S.specDraft.p1Browse = { 1: draft.t1, 2: draft.t2, 3: draft.t3 }; }
  S.specDraft.draftDone = draftDone;
  renderSpectatorDraft();
});

// ── 관전자: HP 실시간 조정 ──
socket.on('spectator_hp_browse', ({ playerIdx, playerName, draft, hps }) => {
  if (!S.isSpectator) return;
  if (!S.specHp) S.specHp = { p0Pieces: [], p1Pieces: [], hpDone: [false, false], p0Hps: null, p1Hps: null, p0Draft: null, p1Draft: null };
  const key = playerIdx === 0 ? 'p0' : 'p1';
  S.specHp[key + 'Hps'] = hps;
  S.specHp[key + 'Draft'] = draft;
  renderSpectatorHp();
});

// ── 관전자: HP 최종 확정 ──
socket.on('spectator_hp_update', ({ playerIdx, playerName, pieces, hpDone }) => {
  if (!S.isSpectator) return;
  if (!S.specHp) S.specHp = { p0Pieces: [], p1Pieces: [], hpDone: [false, false], p0Hps: null, p1Hps: null, p0Draft: null, p1Draft: null };
  if (playerIdx === 0) S.specHp.p0Pieces = pieces;
  else S.specHp.p1Pieces = pieces;
  S.specHp.hpDone = hpDone;
  renderSpectatorHp();
});

// ── 관전자: 공개 페이즈 ──
socket.on('spectator_reveal', ({ p0Pieces, p1Pieces, p0Name, p1Name }) => {
  if (!S.isSpectator) return;
  S.specReveal = { p0Pieces, p1Pieces, p0Name, p1Name };
  renderSpectatorReveal();
  showScreen('screen-reveal');
});

// ── 관전자: 배치 페이즈 시작 ──
socket.on('spectator_placement_start', ({ p0Pieces, p1Pieces, boardBounds }) => {
  if (!S.isSpectator) return;
  S.specPlacement = { p0Pieces, p1Pieces, boardBounds };
  S.boardBounds = boardBounds;
  renderSpectatorPlacement();
  showScreen('screen-placement');
});

// ── 관전자: 배치 업데이트 ──
socket.on('spectator_placement_update', ({ p0Pieces, p1Pieces, boardBounds }) => {
  if (!S.isSpectator) return;
  S.specPlacement = { p0Pieces, p1Pieces, boardBounds };
  S.boardBounds = boardBounds;
  renderSpectatorPlacement();
});

socket.on('opponent_joined', ({ opponentName }) => {
  S.opponentName = opponentName;
});

socket.on('phase_change', ({ phase }) => {
  if (phase === 'draft') {
    S.deckBuilderMode = false;
    document.getElementById('btn-deck-back').classList.add('hidden');
    const deckListEl = document.getElementById('deck-list');
    if (deckListEl) deckListEl.classList.add('hidden');
    S.draftStep = 1;
    S.draftPicked = [];
    // 저장된 덱에서 프리필
    const deck = loadDeck();
    if (deck && S.characters) {
      S.draftSelected = {};
      if (deck.t1 && S.characters[1]?.find(c => c.type === deck.t1)) S.draftSelected[1] = deck.t1;
      if (deck.t2 && S.characters[2]?.find(c => c.type === deck.t2)) S.draftSelected[2] = deck.t2;
      if (deck.t3 && S.characters[3]?.find(c => c.type === deck.t3)) S.draftSelected[3] = deck.t3;
    } else {
      S.draftSelected = {};
    }
    buildDraftStepUI();
    showScreen('screen-draft');
    // 프리필된 덱이 있으면 관전자에게도 알림
    if (deck && (deck.t1 || deck.t2 || deck.t3)) {
      socket.emit('draft_browse', { step: S.draftStep, type: S.draftSelected[S.draftStep], selected: { ...S.draftSelected } });
    }
  }
});

// ── 드래프트 확정 ──
socket.on('draft_ok', ({ t1, t2, t3, timeout, timeoutMsg }) => {
  S.myDraft = { t1, t2, t3 };
  if (timeout) {
    if (typeof playSfxTimeout === 'function') playSfxTimeout();
    // 서버 timeoutMsg: '자동 확정' (이미 다 채웠을 때) / '랜덤 선택' (빈 슬롯 채운 경우)
    const msg = `⏰ ${timeoutMsg || '랜덤 선택'}`;
    addLog(msg, 'system');
    showSkillToast(msg, false, undefined, 'event');
  }
});

// ── HP 분배 페이즈 ──
socket.on('hp_phase', ({ draft, hasTwins }) => {
  S.myDraft = draft;
  S.hasTwins = !!hasTwins;
  S.teamHpMode = false;
  // 1v1 모드 진입 시 팀전 패널 제거
  const tmPanel = document.getElementById('team-hp-teammate-panel');
  if (tmPanel) tmPanel.remove();
  buildHpUI();
  showScreen('screen-hp');
});

socket.on('hp_ok', ({ timeout }) => {
  if (timeout) {
    if (typeof playSfxTimeout === 'function') playSfxTimeout();
    addLog('⏰ 랜덤 분배', 'system');
    showSkillToast('⏰ 랜덤 분배', false, undefined, 'event');
  }
});

socket.on('twin_split_needed', ({ twinTierHp }) => {
  S.twinTierHp = twinTierHp;
  showTwinSplit(twinTierHp);
});

// ── 캐릭터 공개 (레거시 — 새 흐름에서는 사용 안 함) ──
socket.on('reveal_phase', ({ yourPieces, oppPieces }) => {
  S.myPieces = yourPieces;
  S.oppPieces = oppPieces;
  buildRevealUI(yourPieces, oppPieces);
  showScreen('screen-reveal');
});

// ── 초기 공개 (드래프트 직후) ──
socket.on('initial_reveal_phase', ({ myDraft, oppChars, myDeckName, oppDeckName, myName, oppName }) => {
  S.phase = 'initial_reveal';
  S.myDraft = myDraft;
  S.oppRevealChars = oppChars;
  S.myDeckName = myDeckName || '';
  S.oppDeckName = oppDeckName || '';
  buildInitialRevealUI(myDraft, oppChars);
  applyRevealDeckNames(myName, oppName, myDeckName, oppDeckName);
  showScreen('screen-initial-reveal');
});

// ── 교환 드래프트 ── 캐릭터 딕셔너리처럼 우측에서 슬라이드 인하는 오버레이로 표시.
//   뒤의 screen-initial-reveal 은 그대로 active 유지 → 백드롭 너머로 보임.
socket.on('exchange_draft_phase', ({ myDraft, available, oppDraft }) => {
  S.phase = 'exchange_draft';
  S.exchangeAvailable = available;
  S.exchangeMyDraft = { ...myDraft };
  S.exchangeSelected = null;
  S.myDraft = myDraft;
  buildExchangeDraftUI(myDraft, available, oppDraft);
  openOverlayScreen('screen-exchange');
});

socket.on('exchange_done', ({ draft, exchanged, timeout }) => {
  S.exchangeMyDraft = draft;
  S.myDraft = draft;  // 교체 페이즈 카드 갱신용 — 페이즈 종료 후 다른 핸들러도 일관된 데이터 사용
  if (timeout) {
    if (typeof playSfxTimeout === 'function') playSfxTimeout();
    addLog('⏰ 자동 확정', 'system');
    showSkillToast('⏰ 자동 확정', false, undefined, 'event');
  } else if (exchanged) {
    // 토스트 제거 — 시각적으로 카드 자체가 바뀌므로 텍스트 안내 불필요
    // 내 슬롯에 즉시 swap-reveal: 기존 카드 페이드아웃 → 빈 슬롯 → 새 카드 등장
    animateMySwapInReveal(exchanged);
  }
});

// 내 측 교체 애니메이션 — exchange_done 도착 즉시 실행 (오버레이 슬라이드 아웃과 동시).
//   1) 기존 카드 fade-out (400ms)
//   2) 빈 슬롯 placeholder (200ms)
//   3) 새 캐릭터 카드 fade-in (900ms)  → 총 1.5초
//   대기 중에도 내 슬롯에는 이미 새 캐릭터가 자리잡고 있음.
function animateMySwapInReveal(exchanged) {
  if (!exchanged) return;
  const myContainer = document.getElementById('irev-my-chars');
  if (!myContainer) return;
  const cards = [...myContainer.querySelectorAll('.reveal-piece-card')];
  const targetIdx = exchanged.tier - 1;  // tier 1/2/3 → idx 0/1/2
  const oldEl = cards[targetIdx];
  if (!oldEl) return;
  // 진행 중 표시 — playExchangeRevealAnimation 가 동시에 끼어들어도 my 측 tier 를 건너뛰게.
  S._mySwapAnimatingTier = exchanged.tier;
  // SFX (기존 swap reveal 동일)
  try { playSfxSwapBlink(); } catch (e) {}
  setTimeout(() => { try { playSfxSwapReveal(); } catch (e) {} }, 400);
  // (1) fade-out
  oldEl.classList.add('swap-out');
  // (2) 400ms 후 빈 슬롯으로 교체
  setTimeout(() => {
    const emptySlot = document.createElement('div');
    emptySlot.className = 'reveal-slot-empty reveal-slot-swap-empty';
    // ★ 버그 수정: data-tier 부착 — 인덱스 기반 매핑이 placeholder 를 건너뛰고 어긋나는 문제 차단.
    emptySlot.dataset.tier = String(exchanged.tier);
    oldEl.replaceWith(emptySlot);
    // (3) 200ms 후 새 카드 fade-in
    setTimeout(() => {
      const newCard = createDraftRevealCard(exchanged.newChar, exchanged.tier, 'left');
      newCard.classList.add('swap-in', 'exchanged-highlight');
      emptySlot.replaceWith(newCard);
      // 애니메이션 완료 — 락 해제
      if (S._mySwapAnimatingTier === exchanged.tier) S._mySwapAnimatingTier = null;
    }, 200);
  }, 400);
}

// ── 교체 페이즈 (구 final_reveal) ── 통합된 교체 페이즈의 마지막 단계.
//   화면 전환 없이 screen-initial-reveal 위에서 변경된 티어의 카드만 swap-reveal 애니메이션 진행 (1.5초).
//   양측 모두 교체했으면 동시 진행, 변경 없으면 즉시 다음 단계로 진행.
//   "교체됨" 태그(exchanged-highlight) + SFX(playSfxSwapBlink/playSfxSwapReveal) 유지.
socket.on('final_reveal_phase', ({ myDraft, oppChars, myDeckName, oppDeckName, myName, oppName }) => {
  S.phase = 'final_reveal';
  S.myDeckName = myDeckName || S.myDeckName || '';
  S.oppDeckName = oppDeckName || S.oppDeckName || '';
  // 교환 드래프트 화면에서 돌아오는 경우 — 대기 오버레이 + 교환 드래프트 오버레이 + AI 카운트다운 모두 정리
  clearAiWaitCountdown();
  const waitOverlay = document.getElementById('exchange-waiting-overlay');
  if (waitOverlay) waitOverlay.remove();
  applyRevealDeckNames(myName, oppName, myDeckName, oppDeckName, /*final=*/false);
  // 교환 드래프트 오버레이가 떠 있으면 우측으로 슬라이드 아웃 (뒤의 교체 페이즈가 자연스럽게 노출)
  const exScreen = document.getElementById('screen-exchange');
  const isOverlayOpen = exScreen && exScreen.classList.contains('is-overlay');
  if (isOverlayOpen) {
    closeOverlayScreen('screen-exchange');
    S.phase = 'final_reveal';
    // 오버레이가 빠진 후 swap 애니메이션 시작 (화면이 자리 잡은 다음)
    //   ★ 진단 #7 — 440ms 사이에 disconnected/game_over 등이 도착해 화면이 다른 곳으로 넘어갔으면 중단.
    //     phase 가 final_reveal 이 아니거나 active screen 이 screen-initial-reveal 이 아니면 swap 애니 스킵.
    setTimeout(() => {
      const cur = document.querySelector('.screen.active');
      if (S.phase !== 'final_reveal' || !cur || cur.id !== 'screen-initial-reveal') return;
      playExchangeRevealAnimation(myDraft, oppChars);
    }, OVERLAY_ANIM_MS + 20);
  } else {
    // 인간이 ✗/미선택으로 그 자리(교체 페이즈) 에서 대기 중이거나 재접속 — 화면 전환 없이 곧장 swap 애니메이션
    const cur = document.querySelector('.screen.active');
    if (!cur || cur.id !== 'screen-initial-reveal') showScreen('screen-initial-reveal');
    else S.phase = 'final_reveal';
    playExchangeRevealAnimation(myDraft, oppChars);
  }
});

// 캐릭터 공개 화면에 닉네임 + 덱 이름 표시
function applyRevealDeckNames(myName, oppName, myDeckName, oppDeckName, isFinal) {
  const screenId = isFinal ? 'screen-final-reveal' : 'screen-initial-reveal';
  const screen = document.getElementById(screenId);
  if (!screen) return;
  // h3 .reveal-side-name (있으면 갱신, 없으면 buildXxxRevealUI가 만들어두므로 후행 갱신)
  const sides = screen.querySelectorAll('.reveal-side');
  if (sides.length >= 2) {
    const renderSide = (sideEl, name, deckName) => {
      let label = sideEl.querySelector('h3.reveal-side-name');
      if (!label) {
        label = sideEl.querySelector('h3');
      }
      if (label) {
        label.innerHTML = `${escapeHtmlGlobal(name || '')}${deckName ? `<div class="reveal-deck-name">${escapeHtmlGlobal(deckName)}</div>` : ''}`;
      }
    };
    renderSide(sides[0], myName || S.myName, myDeckName);
    renderSide(sides[1], oppName || S.opponentName, oppDeckName);
  }
}

// ── 배치 ──
socket.on('placement_phase', ({ pieces, oppPieces }) => {
  S.myPieces = pieces;
  if (oppPieces) S.oppPieces = oppPieces;
  S.teamPlacementMode = false;
  S.teamPlacementTeammates = [];
  const tmStatus = document.getElementById('team-placement-status-bar');
  if (tmStatus) tmStatus.remove();
  buildPlacementUI();
  showScreen('screen-placement');
});

socket.on('placed_ok', ({ pieceIdx, col, row }) => {
  S.myPieces[pieceIdx].col = col;
  S.myPieces[pieceIdx].row = row;
  updatePlacementUI();
});

// ── 게임 시작 ──
socket.on('game_start', (data) => {
  S._gameEnded = false;  // 게임 종료 플래그 리셋 (재시작/다음 판 대비)
  S.myPieces = data.yourPieces || [];
  S.oppPieces = data.oppPieces || [];
  S.turnNumber = data.turnNumber;
  S.isMyTurn = data.isYourTurn;
  S.sp = data.sp || [1, 1];
  S.instantSp = data.instantSp || [0, 0];
  S.boardBounds = data.boardBounds || { min: 0, max: 4 };
  S.boardObjects = data.boardObjects || [];
  S.attackLog = [];
  S.action = null;
  S.selectedPiece = null;
  // 게임 시작 — 데미지 도장 초기 스냅샷
  if (typeof snapshotTurnStartHps === 'function') snapshotTurnStartHps();

  buildGameUI();
  showScreen('screen-game');
  // 패널 제목을 닉네임으로 갱신
  const leftH3 = document.querySelector('.left-panel h3');
  if (leftH3) leftH3.textContent = `${myN()}의 말`;
  const rightH3 = document.querySelector('.right-panel h3');
  if (rightH3) rightH3.textContent = `${oppN()}의 말`;
  refreshGameView();
  showActionBar(S.isMyTurn);
  updateSPBar();
  // 재접속 (data.reconnect 또는 turnNumber > 1) — 다른 안내 메시지
  const isReconnect = !!data.reconnect || (data.turnNumber && data.turnNumber > 1);
  if (isReconnect) {
    const turnOwnerName = S.isMyTurn ? (myN() || '나') : (oppN() || '상대');
    addLog(`${turnOwnerName}의 턴`, 'system');
    playGameStartAnimation(S.isMyTurn, true, turnOwnerName);
  } else {
    addLog(`${S.isMyTurn ? '선공' : '후공'}`, 'system');
    playGameStartAnimation(S.isMyTurn);
  }
});

// 보드 파괴 첫 발동 풀스크린 연출 — 게임 시작과 비슷한 임팩트
function playBoardShrinkIntro() {
  let overlay = document.getElementById('board-shrink-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'board-shrink-overlay';
    overlay.className = 'game-start-overlay shrink-intro';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="game-start-title shrink-intro-title">보드 파괴 시작</div>
    <div class="game-start-sub shrink-intro-sub">안쪽으로 대피하세요.</div>
  `;
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  // 사운드 — 보드 흔들림 SFX 보강 (오버레이용 톤 다운된 베이스)
  try {
    const ctx = getAudioCtx(); if (ctx) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(55, ctx.currentTime + 0.7);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.85);
    }
  } catch (e) {}
  setTimeout(() => {
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
  }, 3000);
}

// 게임 시작 애니메이션 — 오버레이 "FIGHT!" + 1.2초 scale-up 페이드
function playGameStartAnimation(isMyTurn, isReconnect, turnOwnerName) {
  let overlay = document.getElementById('game-start-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'game-start-overlay';
    overlay.className = 'game-start-overlay';
    document.body.appendChild(overlay);
  }
  const title = isReconnect ? '재접속' : '전투 개시';
  const sub = isReconnect
    ? `${turnOwnerName || (isMyTurn ? '나' : '상대')}의 턴`
    : (isMyTurn ? '선공' : '후공');
  overlay.innerHTML = `
    <div class="game-start-title">${title}</div>
    <div class="game-start-sub">${sub}</div>
  `;
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.start(); o.stop(ctx.currentTime + 0.8);
  } catch (e) {}
  setTimeout(() => {
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
  }, 1800);
}

// ── 내 턴 ──
socket.on('your_turn', (data) => {
  // 새 턴 진입 시 이전 턴 동안 유지된 turn-bright 카드 일괄 해제 (1v1)
  if (typeof clearAllTurnBright === 'function') clearAllTurnBright();
  // 방어적 — 이전 턴의 쌍둥이 페이즈 잔재 정리 (정상 흐름이면 이미 종료됐어야 함)
  if (S.twinPhaseActive && typeof exitTwinMovePhase === 'function') {
    exitTwinMovePhase(/*emitToast=*/false);
  }
  S.isMyTurn = true;
  S.turnNumber = data.turnNumber;
  S.myPieces = data.yourPieces || S.myPieces;
  S.oppPieces = data.oppPieces || S.oppPieces;
  S.sp = data.sp || S.sp;
  S.instantSp = data.instantSp || S.instantSp;
  S.boardBounds = data.boardBounds || S.boardBounds;
  S.boardObjects = data.boardObjects || S.boardObjects;
  S.action = null;
  S.selectedPiece = null;
  S.targetSelectMode = false;
  S.actionDone = false;
  S.moveDone = false;
  S.skillsUsedThisTurn = [];
  S.actionUsedSkillReplace = false;
  S.twinMovePending = false;
  S.twinMovedSub = null;
  S.twinElderSkipped = false;
  S.twinYoungerSkipped = false;
  S.lastActionType = null;
  S.lastActionPieceType = null;
  // 새 턴 시작 — 데미지 도장/HP 빨간 마킹 초기화 (preCurseHps 로 저주 보라 도장 표시)
  if (typeof snapshotTurnStartHps === 'function') snapshotTurnStartHps(data.preCurseHps);

  refreshGameView();
  showActionBar(true);
  updateSPBar();
  addLog(`${data.turnNumber}턴 : ${myN()} 차례`, 'system');
  setTurnBackground(true);
  updateTurnBanner();
  playTurnBell();
});

// ── 상대 턴 ──
socket.on('opp_turn', (data) => {
  // 새 턴 진입 시 이전 턴 동안 유지된 turn-bright 카드 일괄 해제 (1v1)
  if (typeof clearAllTurnBright === 'function') clearAllTurnBright();
  // 내가 쌍둥이 이동 중이었는데 턴이 넘어가는 케이스 (타이머 만료/강제 종료) — UI 정리 필수
  if (S.twinPhaseActive && typeof exitTwinMovePhase === 'function') {
    exitTwinMovePhase(/*emitToast=*/false);
  }
  S.isMyTurn = false;
  S.turnNumber = data.turnNumber;
  S.oppPieces = data.oppPieces || S.oppPieces;
  S.sp = data.sp || S.sp;
  S.instantSp = data.instantSp || S.instantSp;
  S.boardBounds = data.boardBounds || S.boardBounds;
  S.boardObjects = data.boardObjects || S.boardObjects;
  S.action = null;
  S.selectedPiece = null;
  // 새 턴 시작 — 데미지 도장/HP 빨간 마킹 초기화 (preCurseHps 로 저주 보라 도장 표시)
  if (typeof snapshotTurnStartHps === 'function') snapshotTurnStartHps(data.preCurseHps);

  refreshGameView();
  showActionBar(false);
  updateSPBar();
  addLog(`${data.turnNumber}턴 : ${oppN()} 차례`, 'system');
  setTurnBackground(false);
  updateTurnBanner();
});

// ── 이동 결과 ──
socket.on('move_ok', ({ pieceIdx, prev, col, row, yourPieces, boardObjects, twinMovePending, twinMovedSub }) => {
  const pc = yourPieces[pieceIdx];
  animateMove(pc.icon, prev.col, prev.row, col, row);
  playSfx('move');
  S.myPieces = yourPieces;
  if (boardObjects) S.boardObjects = boardObjects;

  // 쌍둥이 이동 페이즈 — 토스트/로그는 페이즈 종료 시점에 단 한 번만 (개별 이동마다 X)
  if (S.twinPhaseActive) {
    if (twinMovePending) {
      // 첫 이동 끝남 — 두 번째 이동 대기
      S.twinFirstSubMoved = twinMovedSub;
      S.selectedPiece = null;
      S.moveDone = true;
      S.actionDone = true;
      S.lastActionType = 'move';
      S.lastActionPieceType = pc.type;
      renderGameBoard();
      renderMyPieces();
      // 두 번째 이동 안내 — 합류 상태면 picker, 아니면 floating 버튼
      refreshTwinPhaseButtons();
      setActionHint('두 번째 쌍둥이를 선택하거나 턴을 종료하세요.');
      showActionBar(true);
    } else {
      // 두 번째 이동 끝남 — 페이즈 종료 + 단일 토스트/로그
      S.moveDone = true;
      S.actionDone = true;
      S.lastActionType = 'move';
      S.lastActionPieceType = pc.type;
      exitTwinMovePhase(/*emitToast=*/true);
      showActionBar(true);
    }
    return;
  }

  // 일반 이동 — 기존 로직
  addLog(`${pc.name} 이동`, 'move');
  showSkillToast(`${pc.name} 이동`);
  S.action = null;
  S.selectedPiece = null;
  S.twinMovePending = false;
  S.twinMovedSub = null;
  S.moveDone = true;
  S.actionDone = true;
  S.lastActionType = 'move';
  S.lastActionPieceType = pc.type;
  setActionButtonMode(null);
  renderGameBoard();
  renderMyPieces();
  showActionBar(true);
});

// 팀모드: 팀원이 이동했을 때 실시간 애니메이션
socket.on('team_ally_moved', ({ moverName, pieceType, pieceIcon, pieceName, subUnit, prevCol, prevRow, col, row }) => {
  // 팀원 이동 SFX — 1v1의 자기 이동(playSfx('move'))과 동일하게 발화
  try { playSfx('move'); } catch (e) {}
  if (!Array.isArray(S.teammatePieces)) return;
  // S.teammatePieces 좌표 즉시 갱신 (broadcastTeamGameState 도착 직전 시각효과용)
  let target = null;
  if (subUnit) {
    target = S.teammatePieces.find(p => p.alive && p.type === pieceType && p.subUnit === subUnit && p.col === prevCol && p.row === prevRow);
  }
  if (!target) {
    target = S.teammatePieces.find(p => p.alive && p.type === pieceType && p.col === prevCol && p.row === prevRow);
  }
  if (target) { target.col = col; target.row = row; }
  if (typeof renderGameBoard === 'function') renderGameBoard();
  // 새 위치 셀 강조 + 이전 위치는 잔상
  const boardEl = document.getElementById('game-board');
  if (boardEl) {
    const newCell = boardEl.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
    const oldCell = boardEl.querySelector(`.cell[data-col="${prevCol}"][data-row="${prevRow}"]`);
    if (newCell) {
      newCell.classList.add('teammate-move-flash');
      setTimeout(() => newCell.classList.remove('teammate-move-flash'), 800);
    }
    if (oldCell) {
      oldCell.classList.add('teammate-move-trail');
      setTimeout(() => oldCell.classList.remove('teammate-move-trail'), 600);
    }
  }
  // 팀원 이동 — "[name] 이동" (인벤토리 B2 row)
  const moveMsg = `${moverName} 이동`;
  addLog(moveMsg, 'move');
  showSkillToast(moveMsg, false, undefined, 'move');
});

socket.on('opp_moved', ({ msg, prevCol, prevRow, col, row }) => {
  // 적 이동 SFX — 자기 이동과 동일 톤
  try { playSfx('move'); } catch (e) {}
  // 표식된 적이면 실시간 위치 업데이트 + 이동 애니메이션 (팝업/로그 없이 시각적 강조만)
  if (S.oppPieces && prevCol !== undefined && prevRow !== undefined && col !== undefined && row !== undefined) {
    const markedMover = S.oppPieces.find(p => p.marked && p.alive && p.col === prevCol && p.row === prevRow);
    if (markedMover) {
      markedMover.col = col;
      markedMover.row = row;
      renderGameBoard();
      renderOppPieces();
      const boardEl = document.getElementById('game-board');
      const cellEl = boardEl && boardEl.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
      if (cellEl) {
        cellEl.classList.add('marked-move-flash');
        setTimeout(() => cellEl.classList.remove('marked-move-flash'), 700);
      }
      // 팝업/로그 제거 — 시각 효과(셀 플래시)만 유지
      return;
    }
  }
  addLog(`상대가 이동했습니다.`, 'move');
  showSkillToast(`상대가 이동했습니다.`, true);
});

// ── 공격 결과 ──
socket.on('attack_result', ({ pieceIdx, cellResults, anyHit, oppPieces, yourPieces }) => {
  // 쥐 격파 감지: 공격 범위에 있던 상대 쥐 찾기 (서버가 자동 제거)
  const destroyedRats = [];
  if (S.boardObjects) {
    for (const c of cellResults) {
      const rat = S.boardObjects.find(o => o.type === 'rat' && o.owner !== S.playerIdx && o.col === c.col && o.row === c.row);
      if (rat) destroyedRats.push({ col: rat.col, row: rat.row });
    }
    for (const dr of destroyedRats) {
      S.boardObjects = S.boardObjects.filter(o => !(o.type === 'rat' && o.owner !== S.playerIdx && o.col === dr.col && o.row === dr.row));
    }
  }

  // 그림자 상태의 적은 공격자 입장에서도 빈 셀 — hit 정보 자체를 숨김 (피격 셀 흔들림 X)
  const isShadowAtOpp = (col, row) => {
    const p = (S.oppPieces || []).find(pc => pc.alive && pc.col === col && pc.row === row);
    return !!(p && (p.statusEffects || []).some(e => e.type === 'shadow'));
  };
  cellResults = (cellResults || []).map(c => {
    if (c.hit && isShadowAtOpp(c.col, c.row)) {
      // 빈 셀처럼 — hit=false 로 변경 (피격 표식·셀 흔들림·로그 전부 차단)
      return { ...c, hit: false, damage: 0, destroyed: false };
    }
    return c;
  });

  // 공격 모션 애니메이션 (그림자 셀은 위에서 hit=false 로 처리되어 흔들림 X)
  const atkCells = cellResults.map(c => ({ col: c.col, row: c.row }));
  const hitCells = cellResults.filter(c => c.hit).map(c => ({ col: c.col, row: c.row }));
  animateAttack(atkCells, hitCells);
  playSfx('attack');

  // 아군 피해 감지용: 업데이트 전 HP 스냅샷 (학살 영웅 등)
  const oldMyHps = S.myPieces.map(p => p.hp);

  if (oppPieces) { S.oppPieces = oppPieces; }
  if (yourPieces) { S.myPieces = yourPieces; }
  // 사망한 말의 추리 토큰 즉시 제거 (다음 렌더에서 사라지도록)
  pruneDeductionTokens();
  const pc = S.myPieces[pieceIdx];

  for (const c of cellResults) {
    S.attackLog.push({ col: c.col, row: c.row, hit: c.hit, turn: S.turnNumber });
  }
  // 본체 직접 피해 / 충성 가로채기 — 데이터 종류별로 명시적 분류 (HP delta 가 아닌 별도 트래킹)
  for (const c of cellResults) {
    if (!c.hit) continue;
    const dmg = (typeof c.damage === 'number') ? c.damage : 0;
    if (dmg <= 0 || c.defPieceIdx === undefined) continue;
    const key = (S.isTeamMode && c.defOwnerIdx !== undefined)
      ? `${c.defOwnerIdx}:${c.defPieceIdx}`
      : `opp:${c.defPieceIdx}`;
    if (c.bodyguardRedirect) {
      // 호위무사가 대신 받음 → 파란 충성 도장 (BG 카드)
      addLoyaltyDamage(key, dmg);
    } else if (!c.redirectedToBodyguard) {
      // 본체에 직접 들어간 피해 → 빨간 도장 (피격 카드)
      addBodyDamage(key, dmg);
    }
    // c.redirectedToBodyguard === true: 본체는 0 피해라 도장 없음 (BG 가 받음)
  }

  if (!anyHit) {
    // 본인 공격 빗나감 — 인벤토리 C1 본인 셀: "빗나감"
    addLog(`빗나감`, 'miss');
    showSkillToast(`빗나감`);
  } else {
    // 호위무사 가로채기·0데미지 비격파 hit은 토스트/로그 생략
    // (호위무사의 충성 패시브 알림과 본체 피격 애니메이션이 별도로 표시됨)
    const meaningfulHits = cellResults.filter(c => c.hit && !c.redirectedToBodyguard && !(c.damage === 0 && !c.destroyed));
    // 메시지는 호위무사 가로채기 hit도 제외 (passive_alert가 따로 알림). 호위무사 격파 시는 사망 알림만 노출.
    const messageHits = meaningfulHits.filter(c => !c.bodyguardRedirect || c.destroyed);
    // 사용자 요청: 모든 공격 반응의 원인은 공격이므로 "명중!" 이 항상 먼저,
    //   그 후 0.8초 텀 두고 격파 알림이 따름. (공격받았습니다와 동일 패턴, 대칭)
    const killed = messageHits.filter(h => h.destroyed);
    const hitOnly = messageHits.filter(h => !h.destroyed);
    if (killed.length > 0) playSfx('kill');
    else if (hitOnly.length > 0) playSfx('hit');
    // ① 명중! — 즉시 (격파/명중 무관)
    showSkillToast(`명중!`);
    // ① 로그 — 명중 좌표 (생존자만 — 격파는 별도 알림)
    if (hitOnly.length > 0) {
      const coords = hitOnly.map(h => coord(h.col, h.row)).join(', ');
      addLog(`${coords} 명중`, 'hit');
    }
    // ② 격파 알림 — 명중 이후 0.8초 텀
    if (killed.length > 0) {
      const labels = killed.map(h => `${h.revealedIcon||''}${h.revealedName||'유닛'}`).join(', ');
      const coords = killed.map(h => coord(h.col, h.row)).join(', ');
      setTimeout(() => {
        showSkillToast(`${labels} 격파!`);
        addLog(`${coords} ${labels} 격파`, 'hit');
      }, 800);
    }
  }
  // 공격자 측에도 동일 — '명중!/격파!' 출력 후 방어형 패시브(충성 등) flush
  // #19: 격파가 있었다면 데미지 감소형 패시브(폭정·가호·아이언스킨)는 토스트 생략(로그만)
  const _attackKilled = (cellResults || []).some(c => c.hit && c.destroyed);
  if (typeof flushDefensiveAlerts === 'function') flushDefensiveAlerts({ skipReduction: _attackKilled });

  // #10/#13: 단일 피격이라면 추리 토큰 자동 배치 (위치 확인 — 토스트·로그 없음).
  //   1v1: pieceKey = "type:subUnit"
  //   팀모드: pieceKey = "type:subUnit@ownerIdx" (renderTeamProfiles 와 동일 형식)
  // 단, 격파된 대상은 자연스럽게 사라지므로 토큰 생성 의미 없음 → 살아있는 hit 만 카운트
  const _aliveHits = (cellResults || []).filter(c => c.hit && !c.destroyed && !c.redirectedToBodyguard && c.defPieceIdx !== undefined);
  if (_aliveHits.length === 1) {
    const c = _aliveHits[0];
    let piece = null;
    let pieceKey = null;
    if (S.isTeamMode && c.defOwnerIdx !== undefined) {
      const ownerPlayer = (S.teamGamePlayers || []).find(p => p.idx === c.defOwnerIdx);
      if (ownerPlayer && ownerPlayer.pieces && ownerPlayer.pieces[c.defPieceIdx]) {
        piece = ownerPlayer.pieces[c.defPieceIdx];
        pieceKey = `${piece.type}:${piece.subUnit || ''}@${c.defOwnerIdx}`;
      }
    } else {
      piece = S.oppPieces?.[c.defPieceIdx];
      if (piece) pieceKey = `${piece.type}:${piece.subUnit || ''}`;
    }
    if (piece && pieceKey) {
      try {
        S.deductionTokens = (S.deductionTokens || []).filter(t => t.pieceKey !== pieceKey && !(t.col === c.col && t.row === c.row));
        S.deductionTokens.push({ pieceKey, icon: piece.icon, name: piece.name, col: c.col, row: c.row });
      } catch (e) {}
    }
  }

  S.action = null;
  S.selectedPiece = null;
  S.targetSelectMode = false;
  S.actionDone = true;
  S.lastActionType = 'attack';
  S.lastActionPieceType = pc ? pc.type : null;
  setActionButtonMode(null);

  // 피격 인덱스 수집: 상대 유닛 — 호위무사 가로채기는 본체 애니메이션 스킵
  const oppHitIndices = [];
  // 보호됨 인덱스 — 0 피해 + !destroyed (호위무사 가로채기 / 아이언스킨 / 폭정 등)
  // 단, 그림자 상태인 piece 는 피격 정보 자체가 숨겨져야 하므로 보호 애니 제외
  const oppProtectedIndices = [];
  for (const c of cellResults) {
    if (!c.hit) continue;
    const isProtected = (c.damage === 0 && !c.destroyed);
    if (isProtected) {
      if (c.defPieceIdx !== undefined) {
        const piece = S.oppPieces?.[c.defPieceIdx];
        const isShadow = piece && (piece.statusEffects || []).some(e => e.type === 'shadow');
        if (!isShadow && !oppProtectedIndices.includes(c.defPieceIdx)) {
          oppProtectedIndices.push(c.defPieceIdx);
        }
      }
      continue;
    }
    if (c.redirectedToBodyguard) continue;
    if (c.defPieceIdx !== undefined && !oppHitIndices.includes(c.defPieceIdx)) {
      oppHitIndices.push(c.defPieceIdx);
    }
  }
  // 아군 피해 인덱스 (학살 영웅 등 friendly fire)
  const myFriendlyFireIndices = [];
  for (let i = 0; i < S.myPieces.length; i++) {
    if (S.myPieces[i].hp < oldMyHps[i]) myFriendlyFireIndices.push(i);
  }

  renderGameBoard();
  renderMyPieces();
  renderOppPieces();
  showActionBar(true);

  // 상대 유닛 피격 애니메이션 — 1v1 만 (팀모드는 team_game_update 가 player-idx 기반으로 처리)
  if (!S.isTeamMode) {
    applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppHitIndices);
    applyProfileHitAnim('#my-pieces-info .my-piece-card', myFriendlyFireIndices);
    applyProtectedAnimByIndex('#opp-pieces-info .opp-piece-card', oppProtectedIndices);
  }

  // 쥐 격파 피드백
  if (destroyedRats.length > 0) {
    const msg = ratDestroyMsg(destroyedRats, false);
    showSkillToast(`🐀 ${msg}`);
    addLog(`🐀 ${msg}`, 'hit');
    animateRatDestruction(destroyedRats, false);
  }
});

// ── 피격 ──
socket.on('being_attacked', ({ atkCells, hitPieces, yourPieces }) => {
  // 적 공격 휘두름 SFX — 1v1 attack_result 의 'attack' 과 동일 톤 (피격자 측에도 들림)
  try { playSfx('attack'); } catch (e) {}
  if (S._bodyguardIntercepted) {
    S._bodyguardIntercepted = false;
  }

  // 그림자 상태 유닛은 빈 셀처럼 취급 — hitPieces 에서 완전 제거 (피격 셀 흔들림·도장·로그 모두 안 나옴)
  const isShadowAt = (col, row) => {
    const p = (S.myPieces || []).find(pc => pc.alive && pc.col === col && pc.row === row);
    return !!(p && (p.statusEffects || []).some(e => e.type === 'shadow'));
  };
  hitPieces = (hitPieces || []).filter(h => !isShadowAt(h.col, h.row));

  // 쥐 격파 감지: 상대 공격 범위에 있던 내 쥐
  const myDestroyedRats = [];
  if (S.boardObjects && atkCells) {
    for (const c of atkCells) {
      const rat = S.boardObjects.find(o => o.type === 'rat' && o.owner === S.playerIdx && o.col === c.col && o.row === c.row);
      if (rat) myDestroyedRats.push({ col: rat.col, row: rat.row });
    }
    for (const dr of myDestroyedRats) {
      S.boardObjects = S.boardObjects.filter(o => !(o.type === 'rat' && o.owner === S.playerIdx && o.col === dr.col && o.row === dr.row));
    }
  }

  // 피격 셀만 흔들림 (그림자 상태 유닛 셀은 위에서 hitPieces 에서 제거되어 흔들림도 X)
  const hitCells = hitPieces.map(h => ({ col: h.col, row: h.row }));
  animateAttack([], hitCells);

  S.myPieces = yourPieces;
  // 본체 직접 피해 / 충성 가로채기 — 데이터 종류별로 명시적 분류
  // 키 형식: 1v1 = 'my:idx' / 팀모드 = '${myPlayerIdx}:idx' (renderTeamProfiles 와 일치).
  const _selfStampKey = (idx) => S.isTeamMode ? `${S.playerIdx}:${idx}` : `my:${idx}`;
  for (const h of hitPieces) {
    const dmg = (typeof h.damage === 'number') ? h.damage : 0;
    if (dmg <= 0) continue;
    if (h.bodyguardRedirect) {
      // 호위무사가 대신 받은 1 피해 → 파란 충성 도장 (BG 카드)
      let bgIdx = (typeof h.defPieceIdx === 'number') ? h.defPieceIdx : -1;
      if (bgIdx < 0) {
        bgIdx = (S.myPieces || []).findIndex(p => p.alive && p.col === h.col && p.row === h.row && p.type === 'bodyguard');
      }
      if (bgIdx < 0) continue;
      addLoyaltyDamage(_selfStampKey(bgIdx), dmg);
    } else if (!h.redirectedToBodyguard) {
      // 본체 직접 피해 → 빨간 도장 (피격 카드)
      let pieceIdx = (typeof h.defPieceIdx === 'number') ? h.defPieceIdx : -1;
      if (pieceIdx < 0) {
        pieceIdx = (S.myPieces || []).findIndex(p => p.alive && p.col === h.col && p.row === h.row);
      }
      if (pieceIdx < 0) continue;
      addBodyDamage(_selfStampKey(pieceIdx), dmg);
    }
  }
  // 호위무사 가로채기 / 0데미지 비격파 hit은 토스트·로그 생략
  const meaningfulHits = hitPieces.filter(h => !h.redirectedToBodyguard && !(h.damage === 0 && !h.destroyed));
  // ★ directHits = 본체로 직접 피해를 받은 hit (호위무사 가로채기 제외).
  //    "공격받았습니다!" 토스트는 본체 직접 피격이 있을 때만 출력.
  //    호위무사가 모두 가로챈 경우는 passive_alert("🛡 충성: ...") 가 알림 담당.
  const directHits = meaningfulHits.filter(h => !h.bodyguardRedirect);
  if (hitPieces.length === 0) {
    addLog(`${oppN()} 공격 빗나감`, 'miss');
    showSkillToast(`${oppN()} 공격 빗나감`, true);
  } else if (directHits.length > 0) {
    // 본체에 직접 피격 발생 → 공격받았습니다 즉시, 사망 알림 0.8초 텀 후
    const killedSelf = directHits.filter(h => h.destroyed);
    const hitOnlySelf = directHits.filter(h => !h.destroyed);
    if (killedSelf.length > 0) playSfx('kill');
    else if (hitOnlySelf.length > 0) playSfx('hit');
    // ① 공격받았습니다 — 항상 먼저 (사망/피격 무관)
    showSkillToast(`공격받았습니다!`, true);
    if (hitOnlySelf.length > 0) {
      const hitLabels = hitOnlySelf.map(h => h.icon && h.name ? `${h.icon}${h.name}` : '유닛').join(', ');
      addLog(`${hitLabels} 피격`, 'hit');
    }
    // ② 사망 — 본인 유닛 사망은 카드에서 보이므로 토스트 생략, 로그만
    if (killedSelf.length > 0) {
      const killedLabels = killedSelf.map(h => h.icon && h.name ? `${h.icon}${h.name}` : '유닛').join(', ');
      setTimeout(() => {
        addLog(`${killedLabels} 사망`, 'hit');
      }, 800);
    }
  }
  // ★ "공격받았습니다!" (있으면) 출력 후 → 방어형 패시브 알림(충성·폭정·아이언스킨·가호) flush.
  //   directHits 가 0 일 때는 (BG-only intercept) 위에서 토스트 안 나갔지만 패시브는 여전히 flush.
  const _selfKilled = directHits.some(h => h.destroyed);
  if (typeof flushDefensiveAlerts === 'function') flushDefensiveAlerts({ skipReduction: _selfKilled });
  // 피격 유닛 인덱스 — 본체 애니메이션은 의미 있는 피격에 한정 (가로채기·0데미지 제외)
  const hitIndices = findPieceIndices(S.myPieces, meaningfulHits);
  // 보호됨 유닛 — 0 피해 + !destroyed. 그림자 상태는 피격 정보 자체를 숨기므로 제외
  const isShadowMine = (h) => {
    const p = (S.myPieces || []).find(pc => pc.alive && pc.col === h.col && pc.row === h.row);
    return p && (p.statusEffects || []).some(e => e.type === 'shadow');
  };
  const protectedHits = hitPieces.filter(h => h.damage === 0 && !h.destroyed && !isShadowMine(h));
  const protectedIndices = findPieceIndices(S.myPieces, protectedHits);

  renderGameBoard();
  renderMyPieces();

  // 피격 유닛 프로필 흔들림 + 금색 플래시
  // 팀모드에서는 #my-pieces-info 가 팀원 카드까지 포함하므로 인덱스가 어긋남 → team_game_update 의 player-idx 기반 처리가 담당. 1v1 만 적용
  if (!S.isTeamMode) {
    applyProfileHitAnim('#my-pieces-info .my-piece-card', hitIndices);
    applyProtectedAnimByIndex('#my-pieces-info .my-piece-card', protectedIndices);
  } else {
    // 팀모드 — being_attacked 의 victim 은 항상 본인. 본인 player-idx + piece-idx 로 정확 매칭
    for (const i of protectedIndices) {
      applyProtectedAnimTeam(S.playerIdx, i);
    }
  }

  // 쥐 격파 피드백
  if (myDestroyedRats.length > 0) {
    const msg = ratDestroyMsg(myDestroyedRats, true);
    showSkillToast(`🐀 ${msg}`, true);
    addLog(`🐀 ${msg}`, 'hit');
    animateRatDestruction(myDestroyedRats, true);
  }
});

// ── SP 업데이트 ──
socket.on('sp_update', ({ sp, instantSp }) => {
  S.sp = sp;
  if (instantSp) S.instantSp = instantSp;
  playSfx('sp');
  updateSPBar();
});

// ── 턴 이벤트 알림 ──
// 행동 없이 턴 종료한 플레이어 알림 — 모든 플레이어/관전자에게 동등하게 표시
socket.on('no_action_notice', ({ playerIdx, name, msg }) => {
  if (!msg) return;
  addLog(msg, 'event');
  showSkillToast(msg, false, playerIdx, 'event');
});

socket.on('turn_event', (payload) => {
  const { type, msg, sp: finalSp, instantSp: finalInstantSp } = payload || {};
  if (S.isSpectator) return; // 관전자는 spectator_log 경로로 수신
  // 1대1 대치는 풀스크린 알림 — 페이드 인 1s + 유지 1s + 페이드 아웃 1s
  if (type === 'stalemate_shrink') {
    addLog(msg, 'system');
    runFullscreenLocked(() => playStalemateShrinkAlert(msg), 3000);
    return;
  }
  // SP 지급 — 풀스크린 애니(4.4s) + 1.5s 버퍼 = 5.9s 동안 모든 토스트/로그 차단
  if (type === 'sp_grant') {
    addLog(msg, 'system');
    // 사용자 요청: SP 증정 애니는 강제 시청 — 디바이스 무관 스크롤 최상단으로 이동
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {
      try { window.scrollTo(0, 0); } catch (e2) {}
    }
    // 사용자 요청: SP 숫자는 애니 시작 시점이 아닌, 구슬이 숫자에 합쳐지는 순간에 변경되어야 함.
    // 서버가 페이로드에 final sp/instantSp 를 함께 보내므로 OLD 상태(=현재 S.sp)를 유지하다가
    // 애니 끝나는 흡수 시점에 NEW 로 갱신 (S.sp 동기화는 playSpGrantAnimation 내부에서 수행).
    runFullscreenLocked(() => playSpGrantAnimation(finalSp, finalInstantSp), 6000);
    return;
  }
  showSkillToast(`⚡ ${msg}`, false, undefined, 'event');
  addLog(`⚡ ${msg}`, 'system');
});

// 스킬 시전 시 SP 차감 집중 연출 — SP 바 위에서 마법 구슬이 시전자 → 상대 숫자로 이동
// 순서: 인스턴트 SP 먼저 소멸 → 0.5s 간격 → 일반 SP 마법구 비행
// 비행/소멸마다 카운터 숫자가 한 칸씩 변화 (시각적 tick + 효과음)
// ── SP 오브 비행 종료 시점 계산 ──
//   spendSPAttention 의 nextMs(80) + (cost-1)*130 + flight(700) 공식.
//   cost 0 (기폭) → 다른 스킬과 시각 호흡 통일 위해 cost 1 (780ms) 로 처리.
//   SP_END_OFFSET_MS — SP 오브 도착 후 추가로 더 기다리는 텀 (살짝 호흡).
const SP_END_OFFSET_MS = 200;
function getSpFlightEndMs(cost) {
  const c = Math.max(1, cost | 0);  // 0 → 1 로 처리
  return 780 + (c - 1) * 130 + SP_END_OFFSET_MS;
}
// 이벤트 payload 에 spCost 가 없을 때 fallback (SP delta 로 추정)
function spCostFromDelta(oldSp, newSp, oldInstantSp, newInstantSp) {
  if (!oldSp || !newSp) return 1;
  const mySlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const reg = (oldSp[mySlot] || 0) - (newSp[mySlot] || 0);
  const ins = ((oldInstantSp || [])[mySlot] || 0) - ((newInstantSp || [])[mySlot] || 0);
  return Math.max(1, (reg > 0 ? reg : 0) + (ins > 0 ? ins : 0));
}

function spendSPAttention(oldSp, newSp, oldInstantSp, newInstantSp) {
  const sec = document.querySelector('.sp-section');
  if (sec) {
    sec.classList.remove('sp-spend-attn');
    void sec.offsetWidth;
    sec.classList.add('sp-spend-attn');
    setTimeout(() => sec.classList.remove('sp-spend-attn'), 2000);
  }
  if (!oldSp || !newSp) return;
  // 가드 ON — 애니 진행 중 외부 updateSPBar 가 큰 숫자/pip 트레이를 NEW 값으로 덮어쓰지 못하게.
  // SP_ATTN_MS(1500) 이후 외부에서 실제 동기화. 안전하게 2s 후 자동 해제.
  S._spAnimGuard = true;
  if (S._spAnimGuardTimer) clearTimeout(S._spAnimGuardTimer);
  S._spAnimGuardTimer = setTimeout(() => { S._spAnimGuard = false; }, 2000);

  const mySlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const oppSlot = 1 - mySlot;
  const myDelta = (newSp[mySlot] || 0) - (oldSp[mySlot] || 0);
  const oppDelta = (newSp[oppSlot] || 0) - (oldSp[oppSlot] || 0);
  const myInstantDelta = ((newInstantSp || [])[mySlot] || 0) - ((oldInstantSp || [])[mySlot] || 0);
  const oppInstantDelta = ((newInstantSp || [])[oppSlot] || 0) - ((oldInstantSp || [])[oppSlot] || 0);
  const regularConsumed = myDelta < 0 ? -myDelta : 0;
  const transferToOpp = oppDelta > 0 ? Math.min(oppDelta, regularConsumed) : 0;
  const instantConsumed = myInstantDelta < 0 ? -myInstantDelta : 0;
  const oppInstantConsumed = oppInstantDelta < 0 ? -oppInstantDelta : 0;  // 상대(시전자) 측 인스턴트 소비 — 1v1 상대/관전 시점에서 보임
  const oppCastedRegular = oppDelta < 0 ? -oppDelta : 0;
  const transferToMe = (myDelta > 0 && oppCastedRegular > 0) ? Math.min(myDelta, oppCastedRegular) : 0;

  const myNumEl = document.getElementById('sp-my-num');
  const oppNumEl = document.getElementById('sp-opp-num');
  if (!myNumEl || !oppNumEl) return;

  const rectCenter = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const my = rectCenter(myNumEl);
  const opp = rectCenter(oppNumEl);

  // 표시되는 숫자(displayed)를 OLD 값으로 보유 — 마법구 도착마다 1씩 변경
  let displayMyNum = oldSp[mySlot] || 0;
  let displayOppNum = oldSp[oppSlot] || 0;
  myNumEl.textContent = String(displayMyNum);
  oppNumEl.textContent = String(displayOppNum);
  const tickDown = (el, val) => { el.textContent = String(val); el.classList.remove('sp-num-tick'); void el.offsetWidth; el.classList.add('sp-num-tick'); };
  const tickUp   = (el, val) => { el.textContent = String(val); el.classList.remove('sp-num-tick-up'); void el.offsetWidth; el.classList.add('sp-num-tick-up'); };

  let nextMs = 80;
  // ① 인스턴트 SP 소비 (mine 측) — 사용자 요청 #16:
  //    숫자랑 *멀리* 있는 pip 부터 순차 소비.
  //    mine 트레이는 row-reverse 라 DOM 끝(last)이 시각적으로 가장 왼쪽(숫자에서 멀리). → last 부터 빨아들임.
  for (let i = 0; i < instantConsumed; i++) {
    const t = nextMs;
    setTimeout(() => {
      const trayId = 'sp-instant-tray-mine';
      const tray = document.getElementById(trayId);
      const pips = tray ? tray.querySelectorAll('.sp-instant-pip:not(.sp-pip-consume)') : [];
      const targetPip = pips.length > 0 ? pips[pips.length - 1] : null;
      let from = my;
      if (targetPip) {
        const r = targetPip.getBoundingClientRect();
        from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        targetPip.classList.add('sp-pip-consume');
        setTimeout(() => { if (targetPip.parentNode) targetPip.remove(); }, 420);
      }
      spawnSpOrbFlight(from, my, 'instant');
      try { playSfxInstantConsume(); } catch (e) {}
    }, t);
    nextMs += 130;
  }
  // ①' 인스턴트 SP 소비 (opp 측) — 상대/관전 시점.
  //    opp 트레이는 default row 이고 숫자가 *왼쪽*에 있음. DOM 끝(last)이 시각적으로 가장 오른쪽(숫자에서 멀리).
  for (let i = 0; i < oppInstantConsumed; i++) {
    const t = nextMs;
    setTimeout(() => {
      const trayId = 'sp-instant-tray-opp';
      const tray = document.getElementById(trayId);
      const pips = tray ? tray.querySelectorAll('.sp-instant-pip:not(.sp-pip-consume)') : [];
      const targetPip = pips.length > 0 ? pips[pips.length - 1] : null;
      let from = opp;
      if (targetPip) {
        const r = targetPip.getBoundingClientRect();
        from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        targetPip.classList.add('sp-pip-consume');
        setTimeout(() => { if (targetPip.parentNode) targetPip.remove(); }, 420);
      }
      spawnSpOrbFlight(from, opp, 'instant');
      try { playSfxInstantConsume(); } catch (e) {}
    }, t);
    nextMs += 130;
  }
  // ② 인스턴트 소비 후 0.5초 텀
  if (instantConsumed > 0 || oppInstantConsumed > 0) nextMs += 500;
  // ③ 일반 SP 마법구 비행 — 출발 시점에 시전자 -1, 도착 시점에 상대 +1
  if (transferToOpp > 0) {
    for (let i = 0; i < transferToOpp; i++) {
      const t = nextMs;
      setTimeout(() => {
        // 출발 시점: 시전자 카운트 -1 + 효과음
        displayMyNum = Math.max(0, displayMyNum - 1);
        tickDown(myNumEl, displayMyNum);
        try { playSfxSpOrbDepart(); } catch (e) {}
        // 비행 (0.7s) 후 도착
        spawnSpOrbFlight(my, opp, 'mine', () => {
          displayOppNum = displayOppNum + 1;
          tickUp(oppNumEl, displayOppNum);
          try { playSfxSpOrbArrive(); } catch (e) {}
        });
      }, t);
      nextMs += 200;
    }
  }
  // ④ 상대가 시전한 경우 (opp → my 방향)
  if (transferToMe > 0) {
    for (let i = 0; i < transferToMe; i++) {
      const t = nextMs;
      setTimeout(() => {
        displayOppNum = Math.max(0, displayOppNum - 1);
        tickDown(oppNumEl, displayOppNum);
        try { playSfxSpOrbDepart(); } catch (e) {}
        spawnSpOrbFlight(opp, my, 'opp', () => {
          displayMyNum = displayMyNum + 1;
          tickUp(myNumEl, displayMyNum);
          try { playSfxSpOrbArrive(); } catch (e) {}
        });
      }, t);
      nextMs += 200;
    }
  }
}

// 인스턴트 SP 트레이 동기화 — count 만큼 .sp-instant-pip 유지
// 새로 추가되는 pip 은 .sp-pip-spawn 으로 등장 애니. 줄어들 때는 spendSPAttention 측에서 별도 비행 처리.
function syncInstantTray(trayId, count) {
  const tray = document.getElementById(trayId);
  if (!tray) return;
  const cur = tray.querySelectorAll('.sp-instant-pip:not(.sp-pip-consume)').length;
  if (cur < count) {
    // 부족한 pip 추가 (등장 애니)
    for (let i = 0; i < count - cur; i++) {
      const pip = document.createElement('div');
      pip.className = 'sp-instant-pip sp-pip-spawn';
      tray.appendChild(pip);
    }
  } else if (cur > count) {
    // 많은 pip 제거 (consume 애니가 이미 적용된 것은 제외)
    const pips = tray.querySelectorAll('.sp-instant-pip:not(.sp-pip-consume)');
    const overflow = cur - count;
    for (let i = 0; i < overflow; i++) {
      // 가장 안쪽(숫자 가까운) pip 부터 제거 — mine: 첫 번째, opp: 마지막
      const idx = (trayId.endsWith('-mine')) ? 0 : pips.length - 1 - i;
      const pip = pips[idx + (trayId.endsWith('-mine') ? i : 0)];
      if (pip) pip.remove();
    }
  }
}

// 인스턴트 SP 획득 (마법사 인스턴트 매직 발동) — 황금 마법구가 마법사 프로필 카드에서 출발 → SP 숫자 옆 트레이 슬롯으로 합류
function spawnInstantGainOrb(targetSlot) {
  const isMine = (targetSlot === 'mine');
  // 출발지: 해당 플레이어의 마법사 프로필 카드
  const fromPos = getWizardCardCenter(isMine) || (() => {
    // 마법사 카드 못찾을 때 — SP 숫자 위쪽으로 폴백
    const numEl = isMine ? document.getElementById('sp-my-num') : document.getElementById('sp-opp-num');
    if (!numEl) return null;
    const r = numEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 - 80 };
  })();
  if (!fromPos) return;
  // 도착지: 트레이의 다음 슬롯 위치 (현재 pip 개수 기준)
  const trayId = isMine ? 'sp-instant-tray-mine' : 'sp-instant-tray-opp';
  const tray = document.getElementById(trayId);
  if (!tray) return;
  // sp_update가 이미 도착해 새 pip 이 트레이에 추가되어 있을 가능성 — 가장 최근 pip(=새로 추가된 것) 위치 사용
  const lastPip = isMine
    ? tray.lastElementChild
    : tray.firstElementChild;
  let toPos;
  if (lastPip) {
    // pip 위치를 비행 도착지로 사용 + 비행 동안 잠시 숨김
    const r = lastPip.getBoundingClientRect();
    toPos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    lastPip.style.opacity = '0';
  } else {
    // 트레이가 비어있으면 트레이 자체 중심으로 (sp_update 가 아직 안 옴)
    const r = tray.getBoundingClientRect();
    toPos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // 비행 — 페어리 트레일 포함
  const orb = document.createElement('div');
  orb.className = 'sp-orb sp-orb-instant';
  orb.style.left = fromPos.x + 'px';
  orb.style.top = fromPos.y + 'px';
  document.body.appendChild(orb);
  const dur = 800;
  const startT = performance.now();
  const mid = { x: (fromPos.x + toPos.x) / 2, y: (fromPos.y + toPos.y) / 2 - 50 };
  // 트레일 더스트
  const trailIv = setInterval(() => {
    const r = orb.getBoundingClientRect();
    const dust = document.createElement('div');
    dust.className = 'sp-dust sp-dust-instant';
    dust.style.left = (r.left + r.width / 2) + 'px';
    dust.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(dust);
    setTimeout(() => dust.remove(), 700);
  }, 35);
  function step(now) {
    const t = Math.min(1, (now - startT) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = (1 - e) * (1 - e) * fromPos.x + 2 * (1 - e) * e * mid.x + e * e * toPos.x;
    const y = (1 - e) * (1 - e) * fromPos.y + 2 * (1 - e) * e * mid.y + e * e * toPos.y;
    const wobble = Math.sin(t * Math.PI * 6) * 4 * (1 - t);
    orb.style.left = (x + wobble) + 'px';
    orb.style.top = (y - wobble) + 'px';
    if (t < 1) requestAnimationFrame(step);
    else {
      clearInterval(trailIv);
      orb.classList.add('sp-orb-arrive');
      try { playSfxInstantGain(); } catch (e) {}
      // pip 노출 + 등장 애니 재시작
      if (lastPip) {
        lastPip.style.opacity = '1';
        lastPip.classList.remove('sp-pip-spawn');
        void lastPip.offsetWidth;
        lastPip.classList.add('sp-pip-spawn');
      }
      setTimeout(() => orb.remove(), 320);
    }
  }
  requestAnimationFrame(step);
}

// ── 강화된 폭탄 폭발 애니메이션 ──
//   detonation_intro 의 blast phase 에서 호출. 셀 좌표 기준 💥 burst + 파편 비산.
//   기존 .bomb-blast 셀 플래시 + .bomb-marker-explode (💣 이모지 폭발) 와 함께 동작.
function playBombExplosion(cell) {
  if (!cell) return;
  const r = cell.getBoundingClientRect();
  if (!r.width) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // ① 💥 큰 burst 이모지 (셀 위에 떠오름)
  const burst = document.createElement('div');
  burst.className = 'bomb-burst-emoji';
  burst.textContent = '💥';
  burst.style.left = cx + 'px';
  burst.style.top = cy + 'px';
  document.body.appendChild(burst);
  setTimeout(() => { if (burst.parentNode) burst.remove(); }, 720);

  // ② 8개 파편 — 사방으로 비산 (랜덤 거리 + 각도)
  const FRAG_CHARS = ['💢', '✦', '⚡', '🔥', '✨', '💥'];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const p = document.createElement('div');
    p.className = 'bomb-fragment';
    p.textContent = FRAG_CHARS[Math.floor(Math.random() * FRAG_CHARS.length)];
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 55 + Math.random() * 40;
    p.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
    p.style.animationDelay = (Math.random() * 0.06).toFixed(2) + 's';
    document.body.appendChild(p);
    setTimeout(() => { if (p.parentNode) p.remove(); }, 950);
  }
}

// ── 스킬 시전 말풍선 ──
//   시전자 프로필에서 보드 방향으로 꼬리 달린 oval 말풍선 — 스킬명 표시.
//   유형별 색상 (action 빨강 / once 노랑 / free 초록).
//   2초 유지 후 페이드아웃.
function getSkillTypeFromPiece(piece, skillName) {
  if (!piece || !skillName) return 'free';
  const skill = (piece.skills || []).find(s => s.name === skillName);
  if (skill) {
    if (skill.replacesAction) return 'action';
    if (skill.oncePerTurn) return 'once';
    return 'free';
  }
  // 폴백 — pc 자체 플래그 (구버전 데이터 호환)
  if (piece.skillReplacesAction) return 'action';
  if (piece.skillOncePerTurn) return 'once';
  return 'free';
}
function showSkillCastBubble(casterCard, skillName, skillType) {
  if (!casterCard || !skillName) return;
  const board = document.getElementById('game-board');
  if (!board) return;
  const cardRect = casterCard.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  if (!cardRect.width || !boardRect.width) return;
  // 보드가 카드의 어느 방향에 있는지 (꼬리는 카드 쪽으로 향함, 본체는 보드 쪽)
  const cardCx = cardRect.left + cardRect.width / 2;
  const boardCx = boardRect.left + boardRect.width / 2;
  const boardIsRight = boardCx > cardCx;
  const type = ['action', 'once', 'free', 'passive'].includes(skillType) ? skillType : 'free';

  const bubble = document.createElement('div');
  bubble.className = `skill-cast-bubble bubble-${type} bubble-tail-${boardIsRight ? 'left' : 'right'}`;
  bubble.textContent = skillName;
  // 카드 가장자리(보드 쪽) 에 붙이고, 살짝 보드 쪽으로 띄움
  if (boardIsRight) {
    bubble.style.left = (cardRect.right + 14) + 'px';
  } else {
    bubble.style.right = (window.innerWidth - cardRect.left + 14) + 'px';
  }
  bubble.style.top = (cardRect.top + cardRect.height / 2) + 'px';
  document.body.appendChild(bubble);
  // 다음 프레임에 visible 클래스 → CSS 로 pop-in
  requestAnimationFrame(() => { bubble.classList.add('bubble-show'); });
  // 2초 유지 후 페이드아웃
  setTimeout(() => { bubble.classList.add('bubble-fade'); }, 2000);
  setTimeout(() => { if (bubble.parentNode) bubble.remove(); }, 2600);
}

// ── 스킬 시전 dim 오버레이 — 화면 어둡게, SP 바·시전자 프로필만 spotlight ──
function startSkillCastDim(casterCard, targetInfo) {
  const dim = document.getElementById('skill-cast-dim');
  if (dim) dim.classList.remove('hidden');
  const sec = document.querySelector('.sp-section');
  if (sec) sec.classList.add('caster-spotlight');
  if (casterCard) casterCard.classList.add('caster-spotlight');
  S._castSpotlightCard = casterCard || null;
  // 팀모드: team_game_update 가 곧이어 도착해 renderTeamProfiles 가 DOM 을 재생성하면
  //   .caster-spotlight 클래스가 날아감. {playerIdx, pieceIdx} 를 저장해 reapplyCasterSpotlight() 가
  //   재렌더 직후 다시 클래스 부여하도록.
  S._castSpotlightTarget = targetInfo || null;
}
function endSkillCastDim(casterCard) {
  const dim = document.getElementById('skill-cast-dim');
  if (dim) dim.classList.add('hidden');
  const sec = document.querySelector('.sp-section');
  if (sec) sec.classList.remove('caster-spotlight');
  const card = casterCard || S._castSpotlightCard;
  if (card) card.classList.remove('caster-spotlight');
  // 또한 target 정보로 현재 DOM 의 매칭 카드도 클린업 (재렌더 사본까지 처리)
  if (S._castSpotlightTarget) {
    const t = S._castSpotlightTarget;
    document.querySelectorAll(`.team-profile-block[data-player-idx="${t.playerIdx}"] [data-piece-idx="${t.pieceIdx}"].caster-spotlight`)
      .forEach(el => el.classList.remove('caster-spotlight'));
  }
  S._castSpotlightCard = null;
  S._castSpotlightTarget = null;
}
// renderTeamProfiles 직후 호출 — spotlight 가 진행 중이면 매칭 카드에 다시 클래스 부여.
function reapplyCasterSpotlight() {
  const t = S._castSpotlightTarget;
  if (!t) return;
  const card = document.querySelector(`.team-profile-block[data-player-idx="${t.playerIdx}"] [data-piece-idx="${t.pieceIdx}"]`);
  if (card) {
    card.classList.add('caster-spotlight');
    S._castSpotlightCard = card;
  }
}

// #18 헬퍼: 피격 / 회복이 발생한 캐릭터 카드에 'turn-bright' 부여 — 그 턴 동안 계속 풀 밝기 유지.
//   사용자 요청: 한 번 피격되면 다음 턴 시작 전까지 계속 밝게. 블록 전체가 아니라 해당 카드만 밝게.
//   profile-hit / heal-flash 는 짧은 플래시 애니메이션 (자동 해제), turn-bright 는 turn change 시 일괄 해제.
function applyHitFlashWithBrighten(card, durationMs) {
  if (!card) return;
  card.classList.remove('profile-hit');
  void card.offsetWidth;
  card.classList.add('profile-hit');
  card.classList.add('turn-bright');  // 그 턴 동안 풀 밝기 유지
  setTimeout(() => {
    card.classList.remove('profile-hit');
  }, durationMs || 1800);
}
function applyHealFlashWithBrighten(card, durationMs) {
  if (!card) return;
  card.classList.remove('heal-flash');
  void card.offsetWidth;
  card.classList.add('heal-flash');
  card.classList.add('turn-bright');  // 그 턴 동안 풀 밝기 유지
  setTimeout(() => {
    card.classList.remove('heal-flash');
  }, durationMs || 2000);
}
// 턴 변경 시 모든 turn-bright 해제 — 다음 턴부터 다시 dim 상태로 돌아감.
function clearAllTurnBright() {
  document.querySelectorAll('.turn-bright').forEach(el => el.classList.remove('turn-bright'));
}

// 마법사 카드 위치 찾기 (instant gain 출발지)
function getWizardCardCenter(isMine) {
  const containerSel = isMine ? '#my-pieces-info' : '#opp-pieces-info';
  const cardSel = isMine ? '.my-piece-card' : '.opp-piece-card';
  const pieces = isMine ? S.myPieces : S.oppPieces;
  if (!pieces) return null;
  const wizIdx = pieces.findIndex(p => p && p.alive && p.type === 'wizard');
  if (wizIdx < 0) return null;
  const cards = document.querySelectorAll(`${containerSel} ${cardSel}`);
  const card = cards[wizIdx];
  if (!card) return null;
  const r = card.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// 마법 구슬 — 두 점 사이를 부드러운 곡선으로 비행 (요정처럼)
// onArrive 콜백 — 도착 시 SP 숫자 tick 등을 호출
function spawnSpOrbFlight(from, to, kind, onArrive) {
  const orb = document.createElement('div');
  orb.className = 'sp-orb sp-orb-' + (kind || 'mine');
  document.body.appendChild(orb);
  const dur = 700;
  const startT = performance.now();
  const dx = to.x - from.x, dy = to.y - from.y;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - Math.abs(dx) * 0.2 - 30 };
  // 페어리 더스트 — 비행 경로를 따라 작은 입자 흩뿌림
  const trailIv = setInterval(() => {
    const r = orb.getBoundingClientRect();
    const dust = document.createElement('div');
    dust.className = 'sp-dust sp-dust-' + (kind || 'mine');
    dust.style.left = (r.left + r.width / 2) + 'px';
    dust.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(dust);
    setTimeout(() => dust.remove(), 700);
  }, 35);
  function step(now) {
    const t = Math.min(1, (now - startT) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * mid.x + e * e * to.x;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * mid.y + e * e * to.y;
    const wobble = Math.sin(t * Math.PI * 6) * 4 * (1 - t);
    orb.style.left = (x + wobble) + 'px';
    orb.style.top = (y - wobble) + 'px';
    if (t < 1) requestAnimationFrame(step);
    else {
      clearInterval(trailIv);
      orb.classList.add('sp-orb-arrive');
      setTimeout(() => orb.remove(), 320);
      if (typeof onArrive === 'function') onArrive();
    }
  }
  requestAnimationFrame(step);
}

// 인스턴트 SP 소멸 — 위로 떠오르며 페이드아웃
function spawnSpOrbVanish(from, kind) {
  const orb = document.createElement('div');
  orb.className = 'sp-orb sp-orb-' + (kind || 'instant');
  orb.style.left = from.x + 'px';
  orb.style.top = from.y + 'px';
  document.body.appendChild(orb);
  requestAnimationFrame(() => {
    orb.style.transition = 'top 0.7s ease-out, opacity 0.7s ease-out, transform 0.7s ease-out';
    orb.style.top = (from.y - 60) + 'px';
    orb.style.opacity = '0';
    orb.style.transform = 'scale(0.4)';
  });
  setTimeout(() => orb.remove(), 750);
}

// ── 쌍둥이 분신 비행 애니메이션 ──
//   mover (불려오는 쪽) 가 caller 위치로 빠르게 날아가며 잔상(작은 ghost copy) 을 남김.
//   SP 마법구 비행과 유사한 베지어 곡선 + 트레일 인터벌. 도착 시 작은 합체 펄스.
//   비행 동안 mover 의 보드 위 piece-marker 를 hidden 처리 (skill_result 의 yourPieces 적용 전까지).
//
// ★ 디버그 미리보기 — 실제 게임 흐름과 무관하게 비행 + SFX 만 미리 재생.
//   콘솔에서 `previewTwinJoin()` 호출. 게임 보드가 있으면 그 위에서, 없으면 화면 가운데에서 임의 좌표로 비행.
window.previewTwinJoin = function(moverIcon = '👦') {
  const board = document.getElementById('game-board');
  if (board && board.querySelectorAll('.cell').length >= 2) {
    // 보드 위에서 비행 — 임의의 두 셀 선택
    const cells = board.querySelectorAll('.cell');
    const fromCell = cells[0];
    const toCell = cells[Math.min(cells.length - 1, 7)];
    const fromCol = parseInt(fromCell.dataset.col), fromRow = parseInt(fromCell.dataset.row);
    const toCol = parseInt(toCell.dataset.col), toRow = parseInt(toCell.dataset.row);
    try { if (typeof playSfxTwinsJoin === 'function') playSfxTwinsJoin(); } catch(e) {}
    playTwinJoinFlight(moverIcon, fromCol, fromRow, toCol, toRow);
    return `Flying ${moverIcon} from (${fromCol},${fromRow}) → (${toCol},${toRow})`;
  }
  // 보드 없을 때 — 화면 좌→우로 비행 (셀 없이 fixed 좌표 사용 위해 임시 가짜 호출)
  const W = window.innerWidth, H = window.innerHeight;
  const fromX = W * 0.25, fromY = H * 0.5;
  const toX = W * 0.75, toY = H * 0.5;
  // playTwinJoinFlight 는 셀 기반이라 fallback 으로 직접 비행 객체 생성
  const flyer = document.createElement('div');
  flyer.className = 'twin-join-flyer';
  flyer.textContent = moverIcon;
  flyer.style.left = fromX + 'px';
  flyer.style.top = fromY + 'px';
  document.body.appendChild(flyer);
  try { if (typeof playSfxTwinsJoin === 'function') playSfxTwinsJoin(); } catch(e) {}
  const dur = 700, startT = performance.now();
  const mid = { x: (fromX + toX) / 2, y: fromY - Math.abs(toX - fromX) * 0.18 - 24 };
  const trailIv = setInterval(() => {
    const r = flyer.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'twin-join-trail';
    ghost.textContent = moverIcon;
    ghost.style.left = (r.left + r.width / 2) + 'px';
    ghost.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(ghost);
    setTimeout(() => ghost.remove(), 480);
  }, 35);
  function step(now) {
    const t = Math.min(1, (now - startT) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = (1 - e) * (1 - e) * fromX + 2 * (1 - e) * e * mid.x + e * e * toX;
    const y = (1 - e) * (1 - e) * fromY + 2 * (1 - e) * e * mid.y + e * e * toY;
    flyer.style.left = x + 'px';
    flyer.style.top = y + 'px';
    if (t < 1) requestAnimationFrame(step);
    else { clearInterval(trailIv); flyer.classList.add('twin-join-arrive'); setTimeout(() => flyer.remove(), 320); }
  }
  requestAnimationFrame(step);
  return `Preview flight ${moverIcon} (no board)`;
};

function playTwinJoinFlight(moverIcon, fromCol, fromRow, toCol, toRow) {
  const board = document.getElementById('game-board');
  if (!board) return;
  const fromCell = board.querySelector(`.cell[data-col="${fromCol}"][data-row="${fromRow}"]`);
  const toCell   = board.querySelector(`.cell[data-col="${toCol}"][data-row="${toRow}"]`);
  if (!fromCell || !toCell) return;

  // mover 의 piece-marker 일시 숨김 — 비행 끝나고 보드 재렌더 시 자연 복귀
  const moverMarker = fromCell.querySelector('.piece-marker');
  if (moverMarker) moverMarker.classList.add('twin-flying');

  const fromR = fromCell.getBoundingClientRect();
  const toR   = toCell.getBoundingClientRect();
  const fromX = fromR.left + fromR.width  / 2;
  const fromY = fromR.top  + fromR.height / 2;
  const toX   = toR.left   + toR.width    / 2;
  const toY   = toR.top    + toR.height   / 2;

  // 비행 객체 (이모지 자체)
  const flyer = document.createElement('div');
  flyer.className = 'twin-join-flyer';
  flyer.textContent = moverIcon;
  flyer.style.left = fromX + 'px';
  flyer.style.top  = fromY + 'px';
  document.body.appendChild(flyer);

  // ── 사용자 요청: 곡선 → "준비 동작 + 일직선" 모션 ──
  //   ① 준비(wind-up): 0~180ms — target 반대 방향으로 살짝 후퇴 + scale 1.15 부풀어 오름
  //   ② 비행(launch):  180~700ms — wind-up 위치에서 target 까지 직선 이동 (ease-out)
  //   잔상 트레일은 비행 구간에서만 발사.
  const WINDUP_MS = 180;
  const FLIGHT_MS = 520;
  const TOTAL_MS = WINDUP_MS + FLIGHT_MS;
  const startT = performance.now();
  // wind-up 후퇴 거리 — target 반대 방향으로 진행 거리의 8% (작게)
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;        // target 방향 단위벡터
  const WINDUP_DIST = 14;                       // 14px 후퇴
  const windupX = fromX - ux * WINDUP_DIST;
  const windupY = fromY - uy * WINDUP_DIST;

  // 잔상 트레일 — 비행 구간(180ms 이후)에만 발사
  const trailIv = setInterval(() => {
    if (performance.now() - startT < WINDUP_MS) return;  // 준비 동작 중엔 잔상 X
    const r = flyer.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'twin-join-trail';
    ghost.textContent = moverIcon;
    ghost.style.left = (r.left + r.width / 2) + 'px';
    ghost.style.top  = (r.top  + r.height / 2) + 'px';
    document.body.appendChild(ghost);
    setTimeout(() => ghost.remove(), 480);
  }, 30);

  function step(now) {
    const elapsed = now - startT;
    let x, y, scale;
    if (elapsed < WINDUP_MS) {
      // ① 준비 — easeOut 으로 후퇴 + 1.0 → 1.15 스케일
      const t = elapsed / WINDUP_MS;
      const e = 1 - Math.pow(1 - t, 3);
      x = fromX + (windupX - fromX) * e;
      y = fromY + (windupY - fromY) * e;
      scale = 1 + 0.15 * e;
    } else {
      // ② 일직선 비행 — wind-up 위치 → target. easeOutCubic 으로 빠르게 가속 후 살짝 감속.
      const t = Math.min(1, (elapsed - WINDUP_MS) / FLIGHT_MS);
      const e = 1 - Math.pow(1 - t, 3);
      x = windupX + (toX - windupX) * e;
      y = windupY + (toY - windupY) * e;
      scale = 1.15 - 0.15 * e;  // 1.15 → 1.0
    }
    flyer.style.left = x + 'px';
    flyer.style.top  = y + 'px';
    flyer.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;

    if (elapsed < TOTAL_MS) {
      requestAnimationFrame(step);
    } else {
      clearInterval(trailIv);
      // ★ 사용자 요청: 도착 펄스는 mover 가 아닌 합류 이모지(👫) 로 표시.
      flyer.textContent = '👫';
      flyer.classList.add('twin-join-arrive');
      setTimeout(() => flyer.remove(), 320);
    }
  }
  requestAnimationFrame(step);
}

// SP 지급 풀스크린 애니메이션 — 통합 스파이럴 모션 (수영하듯이 매끄럽게)
// 한 RAF 안에서 angle 과 radius 가 함께 변화 → 페이즈 사이 멈칫 없음, 빠른 템포, 2회 회전
//
// finalSp / finalInstantSp (선택): 서버가 turn_event sp_grant 로 보낸 NEW 값.
//   주어지면 애니메이션 동안에는 OLD(=현재 S.sp) 유지, 구슬 흡수 시점에 NEW 로 전환.
//   미제공(레거시 호출)일 경우 textContent 에서 NEW 를 추정해 fallback.
function playSpGrantAnimation(finalSp, finalInstantSp) {
  const overlay = document.getElementById('sp-grant-overlay');
  const orbL = document.getElementById('sp-grant-orb-left');
  const orbR = document.getElementById('sp-grant-orb-right');
  const textBox = overlay && overlay.querySelector('.sp-grant-text');
  if (!overlay || !orbL || !orbR || !textBox) return;
  document.body.classList.add('sp-granting');
  overlay.classList.remove('hidden', 'fading-out');
  textBox.classList.remove('show');
  textBox.style.opacity = '';

  const W = window.innerWidth, H = window.innerHeight;
  const cx = W / 2, cy = H / 2;
  const orbitR = 130;

  // 페이즈 비율 (전체 t in [0,1])
  const tEntryEnd = 0.20;     // 0~20%   진입 (반경 large → orbitR, 0.5바퀴)
  const tOrbitEnd = 0.78;     // 20~78%  궤도 (orbitR 유지, 2바퀴 회전)
  // 78~100% 분리 비행 (orbitR → SP 숫자)
  const TOTAL_MS = 2400;       // 더 빠르게 (이전 3500ms → 2400ms)

  // 좌 마법구 base angle = π, 우 = 0. 둘 다 시계방향 회전 (angle 양의 방향).
  const angleEntrySweep = Math.PI;     // 진입에서 절반 바퀴 (180°)
  const angleOrbits = Math.PI * 4;     // 2 회전 (720°)
  const angleDispatchSweep = Math.PI * 0.5;  // 분리에서 90° 추가
  const totalAngleSweep = angleEntrySweep + angleOrbits + angleDispatchSweep;

  const myNumEl = document.getElementById('sp-my-num');
  const oppNumEl = document.getElementById('sp-opp-num');

  // 숫자 증가는 구슬이 숫자에 합쳐지는 순간에 발생 — finalSp 가 주어지면 그 값을 NEW 로,
  //   주어지지 않은 경우엔 textContent 에서 추정 (레거시 호환).
  const mySlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const oppSlot = 1 - mySlot;
  const oldMyNum = (S.sp && S.sp[mySlot] != null) ? S.sp[mySlot] : (parseInt((myNumEl && myNumEl.textContent) || '0', 10) || 0);
  const oldOppNum = (S.sp && S.sp[oppSlot] != null) ? S.sp[oppSlot] : (parseInt((oppNumEl && oppNumEl.textContent) || '0', 10) || 0);
  const finalMyNum = (Array.isArray(finalSp) && finalSp[mySlot] != null) ? finalSp[mySlot] : (oldMyNum + 1);
  const finalOppNum = (Array.isArray(finalSp) && finalSp[oppSlot] != null) ? finalSp[oppSlot] : (oldOppNum + 1);
  let _myAbsorbed = false, _oppAbsorbed = false;
  // 애니 동안 OLD 유지 (sp_update 가 더 이상 안 옴 → S.sp 도 OLD)
  if (myNumEl) myNumEl.textContent = String(oldMyNum);
  if (oppNumEl) oppNumEl.textContent = String(oldOppNum);

  setOrbPos(orbL, cx - W * 0.6, cy);  // 멀리 좌측
  setOrbPos(orbR, cx + W * 0.6, cy);  // 멀리 우측
  orbL.style.opacity = '0';
  orbR.style.opacity = '0';

  // 트레일 더스트 — 비행 내내
  let trailIv = setInterval(() => {
    [[orbL, 'sp-dust-grant-l'], [orbR, 'sp-dust-grant-r']].forEach(([orb, cls]) => {
      if (orb.style.opacity === '0' || orb.style.opacity === '') return;
      const r = orb.getBoundingClientRect();
      // 메인 dust 1개 + 작은 sparkle 1~2개 (팅커벨 느낌)
      for (let k = 0; k < 2; k++) {
        const dust = document.createElement('div');
        dust.className = 'sp-dust ' + cls;
        if (k === 1) dust.style.transform = 'translate(-50%, -50%) scale(0.55)';
        dust.style.left = (r.left + r.width / 2 + (Math.random() - 0.5) * 8) + 'px';
        dust.style.top = (r.top + r.height / 2 + (Math.random() - 0.5) * 8) + 'px';
        document.body.appendChild(dust);
        setTimeout(() => dust.remove(), 700);
      }
    });
  }, 28);

  const t0 = performance.now();
  let dispatchTargetL = null, dispatchTargetR = null;
  let dispatchStartL = null, dispatchStartR = null;

  function animate() {
    const elapsed = performance.now() - t0;
    const t = Math.min(1, elapsed / TOTAL_MS);

    // 통합 angle progression — easeInOutCubic 으로 부드럽게 가속/감속
    // 진입 부분은 빠른 가속으로 시작 (수영의 발차기처럼)
    const eAngle = easeInOutCubic(t);
    const angle = eAngle * totalAngleSweep;

    // 페이즈 결정 (radius 와 dispatch 처리)
    let radius;
    let blendDispatch = 0;
    if (t < tEntryEnd) {
      const sub = t / tEntryEnd;
      radius = lerp(W * 0.6, orbitR, easeOutCubic(sub));
      // 텍스트는 진입 후반부터 페이드인
      if (sub > 0.6 && !textBox.classList.contains('show')) textBox.classList.add('show');
      // 페이드 인 (0~50% 구간)
      const fadeT = Math.min(1, sub / 0.5);
      orbL.style.opacity = String(fadeT);
      orbR.style.opacity = String(fadeT);
    } else if (t < tOrbitEnd) {
      radius = orbitR;
      orbL.style.opacity = '1';
      orbR.style.opacity = '1';
      if (!textBox.classList.contains('show')) textBox.classList.add('show');
    } else {
      // 분리 비행 — radius 그대로 유지하면서 target 으로 블렌드
      radius = orbitR;
      const sub = (t - tOrbitEnd) / (1 - tOrbitEnd);
      blendDispatch = easeInOutCubic(sub);
      if (sub > 0.6) textBox.style.opacity = String(1 - (sub - 0.6) / 0.4);
    }

    // 궤도 위치 (각도 + 반경)
    const baseLeft = Math.PI, baseRight = 0;
    let lx = cx + Math.cos(baseLeft + angle) * radius;
    let ly = cy + Math.sin(baseLeft + angle) * radius * 0.55;
    let rx = cx + Math.cos(baseRight + angle) * radius;
    let ry = cy + Math.sin(baseRight + angle) * radius * 0.55;

    // 분리 비행 시 — 궤도 위치와 SP 숫자 위치를 보간
    if (blendDispatch > 0) {
      if (!dispatchTargetL && myNumEl) dispatchTargetL = rectCenterEl(myNumEl);
      if (!dispatchTargetR && oppNumEl) dispatchTargetR = rectCenterEl(oppNumEl);
      if (!dispatchStartL) dispatchStartL = { x: lx, y: ly };
      if (!dispatchStartR) dispatchStartR = { x: rx, y: ry };
      if (dispatchTargetL) {
        // lift — 위로 살짝 솟았다가 내려옴
        const lift = -Math.sin(blendDispatch * Math.PI) * 50;
        lx = lerp(dispatchStartL.x, dispatchTargetL.x, blendDispatch);
        ly = lerp(dispatchStartL.y, dispatchTargetL.y, blendDispatch) + lift;
      }
      if (dispatchTargetR) {
        const lift = -Math.sin(blendDispatch * Math.PI) * 50;
        rx = lerp(dispatchStartR.x, dispatchTargetR.x, blendDispatch);
        ry = lerp(dispatchStartR.y, dispatchTargetR.y, blendDispatch) + lift;
      }
      // 흡수 직전 (95% 이상) — 숫자 증가 + 하얀 팝 (한 번만)
      if (blendDispatch >= 0.95) {
        if (!_myAbsorbed && myNumEl) {
          _myAbsorbed = true;
          myNumEl.textContent = String(finalMyNum);
          myNumEl.classList.remove('sp-num-tick-up');
          void myNumEl.offsetWidth;
          myNumEl.classList.add('sp-num-tick-up');
          // S.sp 도 흡수 시점에 NEW 로 동기화 (sp_update 가 안 오므로 여기서 갱신)
          if (Array.isArray(finalSp)) {
            if (!Array.isArray(S.sp)) S.sp = [0, 0];
            S.sp[mySlot] = finalMyNum;
          }
        }
        if (!_oppAbsorbed && oppNumEl) {
          _oppAbsorbed = true;
          oppNumEl.textContent = String(finalOppNum);
          oppNumEl.classList.remove('sp-num-tick-up');
          void oppNumEl.offsetWidth;
          oppNumEl.classList.add('sp-num-tick-up');
          if (Array.isArray(finalSp)) {
            if (!Array.isArray(S.sp)) S.sp = [0, 0];
            S.sp[oppSlot] = finalOppNum;
          }
          // instantSp 도 NEW 로 동기화
          if (Array.isArray(finalInstantSp)) {
            S.instantSp = [...finalInstantSp];
          }
        }
      }
    }

    setOrbPos(orbL, lx, ly);
    setOrbPos(orbR, rx, ry);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      // 종료
      if (trailIv) { clearInterval(trailIv); trailIv = null; }
      orbL.style.opacity = '0';
      orbR.style.opacity = '0';
      // 흡수가 미처 안 일어났을 경우 안전장치 — 최종 숫자 동기화 + S.sp/S.instantSp 갱신
      if (myNumEl && !_myAbsorbed) {
        myNumEl.textContent = String(finalMyNum);
        myNumEl.classList.remove('sp-num-tick-up');
        void myNumEl.offsetWidth;
        myNumEl.classList.add('sp-num-tick-up');
      }
      if (oppNumEl && !_oppAbsorbed) {
        oppNumEl.textContent = String(finalOppNum);
        oppNumEl.classList.remove('sp-num-tick-up');
        void oppNumEl.offsetWidth;
        oppNumEl.classList.add('sp-num-tick-up');
      }
      if (Array.isArray(finalSp)) S.sp = [...finalSp];
      if (Array.isArray(finalInstantSp)) S.instantSp = [...finalInstantSp];
      try { if (typeof updateSPBar === 'function') updateSPBar(); } catch (e) {}
      // 1초 페이드 아웃
      overlay.classList.add('fading-out');
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('fading-out');
        textBox.classList.remove('show');
        textBox.style.opacity = '';
        document.body.classList.remove('sp-granting');
      }, 1000);
    }
  }
  requestAnimationFrame(animate);

  try { playSpGrantChime(); } catch (e) {}
}

// 내부 헬퍼들
function setOrbPos(el, x, y) {
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}
function rectCenterEl(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

// ── SP 마법구 효과음 (4가지 옵션) ──────────────────────────────────
// 사용자가 미리듣고 결정 후 선호하는 것으로 PROD 톤 고정.
// 기본은 옵션 1 (가장 매끄러운 페어리 톤). 옵션 변경: SP_ORB_SFX_VARIANT
const SP_ORB_SFX_VARIANT = 1;  // 1: 페어리 (기본 — 사용자 확정)

function playSfxSpOrbDepart() { _spOrbDepart(SP_ORB_SFX_VARIANT); }
function playSfxSpOrbArrive() { _spOrbArrive(SP_ORB_SFX_VARIANT); }
function _spOrbDepart(variant) {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    if (variant === 1) {
      // 페어리 출발 — 부드러운 상승 휘릭
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(700, now); o.frequency.exponentialRampToValueAtTime(1300, now + 0.18);
      g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.16, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.25);
    } else if (variant === 2) {
      // 짧은 글래스 핑
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1800, now);
      g.gain.setValueAtTime(0.16, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.2);
    } else if (variant === 3) {
      // 깃털 — 부드러운 화이트노이즈 슬라이드
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.15 * (1 - i / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(out); src.start(now);
    } else {
      // 종 톡- (단톤)
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(990, now);
      g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.18, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.28);
    }
  } catch (e) {}
}
function _spOrbArrive(variant) {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    if (variant === 1) {
      // 도착 — 종소리 chime + 살짝 sparkle
      const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
      o1.type = 'triangle'; o1.frequency.setValueAtTime(1568, now);
      g1.gain.setValueAtTime(0.0001, now); g1.gain.linearRampToValueAtTime(0.20, now + 0.02); g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      o1.connect(g1); g1.connect(out); o1.start(now); o1.stop(now + 0.5);
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.setValueAtTime(2349, now + 0.04);
      g2.gain.setValueAtTime(0.0001, now + 0.04); g2.gain.linearRampToValueAtTime(0.10, now + 0.06); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o2.connect(g2); g2.connect(out); o2.start(now + 0.04); o2.stop(now + 0.36);
    } else if (variant === 2) {
      // 단순 핑 — 1500Hz
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1500, now);
      g.gain.setValueAtTime(0.22, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.35);
    } else if (variant === 3) {
      // 도착 통통 — 나무 상자 풍
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(420, now); o.frequency.exponentialRampToValueAtTime(180, now + 0.1);
      g.gain.setValueAtTime(0.18, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.2);
    } else {
      // 푹- (저음 임팩트 + 고음 sparkle)
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(220, now);
      g.gain.setValueAtTime(0.20, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.2);
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'triangle'; o2.frequency.setValueAtTime(2640, now);
      g2.gain.setValueAtTime(0.10, now); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o2.connect(g2); g2.connect(out); o2.start(now); o2.stop(now + 0.2);
    }
  } catch (e) {}
}

// 인스턴트 SP 소비/획득 효과음 — 사용자 확정: 둘 다 SFX 3
const SP_INSTANT_CONSUME_VARIANT = 3;  // 3: 흩날림 (3음 빠른 캐스케이드)
const SP_INSTANT_GAIN_VARIANT = 3;     // 3: 황홀 sparkle (5음 1500→3300 상승)
function playSfxInstantConsume() { _spInstantConsume(SP_INSTANT_CONSUME_VARIANT); }
function playSfxInstantGain() { _spInstantGain(SP_INSTANT_GAIN_VARIANT); }
function _spInstantConsume(variant) {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    if (variant === 1) {
      // 황금 풉— 빠르게 사라지는 톤
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(2200, now); o.frequency.exponentialRampToValueAtTime(900, now + 0.25);
      g.gain.setValueAtTime(0.18, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.32);
    } else if (variant === 2) {
      // 빠른 허밍 — 인스턴트 소비 (단발)
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(1320, now);
      g.gain.setValueAtTime(0.16, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.2);
    } else if (variant === 3) {
      // 흩날림 — 3음 빠른 캐스케이드 (1800/2400/3000 Hz)
      [1800, 2400, 3000].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        const t = now + i * 0.04;
        o.type = 'sine'; o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.22);
      });
    } else {
      // 휘릭 (상승)
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(800, now); o.frequency.exponentialRampToValueAtTime(2200, now + 0.18);
      g.gain.setValueAtTime(0.10, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.25);
    }
  } catch (e) {}
}
function _spInstantGain(variant) {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    if (variant === 1) {
      // 풍성한 화음 — 마법사 인스턴트 매직 (메이저 트라이어드 + 종)
      [1047, 1319, 1568].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        const t = now + i * 0.05;
        o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
      });
    } else if (variant === 2) {
      // 단순 황금 핑
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1760, now);
      g.gain.setValueAtTime(0.20, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.4);
    } else if (variant === 3) {
      // 황홀 sparkle (빠른 5음 상승)
      [1500, 1800, 2200, 2700, 3300].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        const t = now + i * 0.045;
        o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.27);
      });
    } else {
      // 둥— + 차임
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(440, now);
      g.gain.setValueAtTime(0.18, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.connect(g); g.connect(out); o.start(now); o.stop(now + 0.5);
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'triangle'; o2.frequency.setValueAtTime(1760, now + 0.05);
      g2.gain.setValueAtTime(0.0001, now + 0.05); g2.gain.linearRampToValueAtTime(0.12, now + 0.07); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o2.connect(g2); g2.connect(out); o2.start(now + 0.05); o2.stop(now + 0.35);
    }
  } catch (e) {}
}

// SP 지급 마법 차임 — 부드러운 종소리 (페어리 톤)
function playSpGrantChime() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // 종소리 5음 — C5, E5, G5, C6, E6 부드럽게 캐스케이드
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, now + i * 0.18);
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.linearRampToValueAtTime(0.16, now + i * 0.18 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.7);
      o.connect(g); g.connect(out);
      o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.8);
    });
    // 후반부 더스트 — 고음 sparkle
    setTimeout(() => {
      [2400, 3200, 4000].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        const t = ctx.currentTime + i * 0.06;
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + 0.5);
      });
    }, 1200);
  } catch (e) {}
}

// 1대1 대치 풀스크린 알림 — 게임 시작 오버레이와 동일 스타일
function playStalemateShrinkAlert(msg) {
  let overlay = document.getElementById('stalemate-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'stalemate-overlay';
    overlay.className = 'game-start-overlay stalemate-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="game-start-title" style="color:var(--danger)">1대1 대치</div>
    <div class="game-start-sub">5턴 후 보드가 축소됩니다.</div>
  `;
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  // 긴장감 있는 사운드 — 저음 임팩트 + 경고 톤
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // 저음 임팩트
    const boom = ctx.createOscillator(); const bg = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(150, now);
    boom.frequency.exponentialRampToValueAtTime(60, now + 0.5);
    bg.gain.setValueAtTime(0.25, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    boom.connect(bg); bg.connect(out);
    boom.start(now); boom.stop(now + 0.6);
    // 경고 트럼펫
    const trumpet = ctx.createOscillator(); const tg = ctx.createGain();
    trumpet.type = 'square';
    trumpet.frequency.setValueAtTime(440, now + 0.2);
    trumpet.frequency.setValueAtTime(660, now + 0.4);
    trumpet.frequency.setValueAtTime(880, now + 0.6);
    tg.gain.setValueAtTime(0.15, now + 0.2);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    trumpet.connect(tg); tg.connect(out);
    trumpet.start(now + 0.2); trumpet.stop(now + 1.0);
  } catch (e) {}
  setTimeout(() => {
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
  }, 3000);
}

// ── 보드 축소 경고 ──
// 사용자 요청: 토스트·로그 출력 제거. 보드 최상단 #shrink-warning 텍스트와 카운트다운=10 오버레이만 유지.
socket.on('board_shrink_warning', ({ turnsRemaining }) => {
  const el = document.getElementById('shrink-warning');
  if (el) {
    el.classList.remove('hidden');
    el.textContent = `외곽 파괴까지 ${turnsRemaining}턴`;
  }
  // 카운트다운이 10턴 남았을 때 — 풀스크린 인트로 강제 재생 (페이드 1s + 유지 1s + 페이드 1s)
  if (turnsRemaining === 10) {
    runFullscreenLocked(() => playBoardShrinkIntro(), 3000);
  }
});

// ── 보드 축소 실행 ──
//   사용자 #24: 애니메이션 페이즈 소속. runFullscreenLocked 로 큐잉되어 다른 phase 애니와
//   0.5s 텀으로 순차 재생. SP 지급은 항상 이 다음.
socket.on('board_shrink', ({ bounds, eliminated }) => {
  runFullscreenLocked(() => _executeBoardShrinkAnim(bounds, eliminated), 3000);
});

function _executeBoardShrinkAnim(bounds, eliminated) {
  playSfx('shrink');
  try { playBoardQuake(); } catch (e) {}
  S.boardBounds = bounds;
  S._shrinkOccurredCount = (S._shrinkOccurredCount || 0) + 1;
  // #24: 보드 파괴로 *완전 탈락*한 플레이어 추적 — 프로필 블록 위에 '탈락' 도장 표시용.
  //   사용자 요청: 도장은 캐릭터 카드가 아니라 *플레이어 프로필* 블록에 (두 캐릭터 위를 덮음).
  if (!S._shrunkEliminatedPlayers) S._shrunkEliminatedPlayers = new Set();
  // 이번 emit 에서 영향 받은 owner 들 수집
  const affectedOwners = new Set();
  for (const e of (eliminated || [])) affectedOwners.add(e.owner);
  // 각 owner 의 모든 piece 가 dead 면 (= 보드 파괴로 풀 탈락) 도장 부착
  for (const ownerIdx of affectedOwners) {
    if (S.isTeamMode) {
      const pl = (S.teamGamePlayers || []).find(p => p.idx === ownerIdx);
      if (pl && pl.pieces && pl.pieces.length > 0 && pl.pieces.every(p => !p.alive)) {
        S._shrunkEliminatedPlayers.add(ownerIdx);
      }
    } else {
      const arr = (ownerIdx === S.playerIdx) ? S.myPieces : S.oppPieces;
      if (arr && arr.length > 0 && arr.every(p => !p.alive)) {
        S._shrunkEliminatedPlayers.add(ownerIdx);
      }
    }
  }
  if (!S.isSpectator) {
    showSkillToast('🔥 보드 외곽 파괴', false, undefined, 'event');
    addLog(`🔥 보드 외곽 파괴`, 'shrink');
  }
  if (eliminated && eliminated.length > 0) {
    // 같은 편(내 편/적 편)끼리 묶어서 한 번에 표시 (인벤토리 #F 외곽 말 파괴 row 빨간 피드백)
    // 1v1: e.owner === S.playerIdx 면 내 편, 아니면 적 편
    // 팀전: e.owner의 팀이 내 팀이면 내 편, 아니면 적 편
    // 관전자: 팀/플레이어 인덱스 0,1 별로 분리
    const formatGroup = (group) => group.map(e => `${e.icon}${e.name}`).join(', ');
    if (S.isSpectator) {
      // 관전자는 두 팀(또는 두 플레이어)로 분리. 사용자 #24: 토스트 X, 로그만.
      const groups = new Map();
      for (const e of eliminated) {
        const key = e.owner;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      for (const [ownerIdx, list] of groups.entries()) {
        addLog(`💀 ${formatGroup(list)} 탈락`, 'shrink');
      }
    } else {
      const isAllyOwner = (ownerIdx) => {
        if (S.isTeamMode) {
          const owner = (S.teamGamePlayers || []).find(p => p.idx === ownerIdx);
          return owner ? owner.teamId === S.teamId : false;
        }
        return ownerIdx === S.playerIdx;
      };
      const myGroup = [];
      const oppGroup = [];
      for (const e of eliminated) {
        (isAllyOwner(e.owner) ? myGroup : oppGroup).push(e);
      }
      const myLabel = S.isTeamMode ? '우리 편' : myN();
      const oppLabel = S.isTeamMode ? '적 편' : oppN();
      // 사용자 #24: 보드 파괴 사망은 토스트 X, 로그만 ([name 탈락]).
      if (myGroup.length > 0) addLog(`💀 ${myLabel}의 ${formatGroup(myGroup)} 탈락`, 'shrink');
      if (oppGroup.length > 0) addLog(`💀 ${oppLabel}의 ${formatGroup(oppGroup)} 탈락`, 'shrink');
    }
  }
  const sw = document.getElementById('shrink-warning');
  if (sw) sw.classList.add('hidden');
  renderGameBoard();
  if (S.isTeamMode) {
    if (typeof renderTeamProfiles === 'function') renderTeamProfiles();
  } else {
    renderMyPieces();
    renderOppPieces();
  }
  // 외곽이 destroyed 클래스로 보이는 상태에서 흔들림
  const boardEl = document.getElementById('game-board');
  if (boardEl) {
    boardEl.classList.add('board-shake');
    setTimeout(() => boardEl.classList.remove('board-shake'), 1000);
  }
}

// 힐 애니메이션: 지정된 인덱스의 piece 카드 2초간 초록 glow
function flashHealPieces(indexes, opts) {
  const o = opts || {};
  const containerSelector = o.opp ? '#opp-pieces-info' : '#my-pieces-info';
  const cardSelector = o.opp ? '.opp-piece-card' : '.my-piece-card';
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const cards = container.querySelectorAll(cardSelector);
  for (const idx of indexes) {
    const card = cards[idx];
    if (!card) continue;
    card.classList.add('heal-flash');
    setTimeout(() => card.classList.remove('heal-flash'), 2000);
    // 파티클 반짝이 추가
    spawnHealSparkles(card);
  }
}

// flashCursePieces 제거됨 — 사용자 요청으로 저주 점멸 효과 비활성화 (보라 도장 + 상시 배경으로 대체)

// 회복 시 카드 위에 반짝이는 파티클 6개를 짧게 띄움
function spawnHealSparkles(card) {
  const rect = card.getBoundingClientRect();
  const sparkleChars = ['✨', '✦', '★', '✧', '⭐', '✨'];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const sp = document.createElement('div');
    sp.className = 'heal-sparkle';
    sp.textContent = sparkleChars[i % sparkleChars.length];
    const sx = rect.left + Math.random() * rect.width;
    const sy = rect.top + Math.random() * rect.height;
    sp.style.left = sx + 'px';
    sp.style.top = sy + 'px';
    sp.style.animationDelay = (Math.random() * 0.4) + 's';
    document.body.appendChild(sp);
    setTimeout(() => sp.remove(), 1500);
  }
}

// ── 저주 파티클 (불씨 도트) ──
// 저주 상태 카드의 바닥에서 작은 도트가 랜덤 시점에 생겨 위로 떠오름. 좌우로 살짝 흔들림.
const CURSE_PARTICLE_COLORS = ['#d8b4fe', '#c084fc', '#a855f7', '#e9d5ff', '#c4b5fd'];
const CURSE_RISE_KEYFRAMES = ['curse-rise-a', 'curse-rise-b', 'curse-rise-c'];
function spawnCurseParticle(card) {
  if (!card || !card.classList.contains('curse-active')) return;
  const p = document.createElement('div');
  p.className = 'curse-particle';
  // 위치·크기·색·키프레임·지속시간 모두 랜덤
  const size = 3 + Math.floor(Math.random() * 3);   // 3~5px 정사각형 도트
  p.style.width = size + 'px';
  p.style.height = size + 'px';
  p.style.left = (5 + Math.random() * 90) + '%';
  p.style.background = CURSE_PARTICLE_COLORS[Math.floor(Math.random() * CURSE_PARTICLE_COLORS.length)];
  // 박스섀도우로 약한 글로우
  p.style.boxShadow = `0 0 4px ${p.style.background}`;
  const kf = CURSE_RISE_KEYFRAMES[Math.floor(Math.random() * CURSE_RISE_KEYFRAMES.length)];
  const dur = 1.6 + Math.random() * 1.4;             // 1.6~3.0s
  p.style.animation = `${kf} ${dur}s linear forwards`;
  // 카드 높이를 --rise 변수로 부여 → 파티클이 카드 전체를 가로질러 상단까지 상승
  const cardH = card.getBoundingClientRect().height || 100;
  p.style.setProperty('--rise', cardH + 'px');
  card.appendChild(p);
  setTimeout(() => { if (p.parentNode) p.remove(); }, dur * 1000 + 100);
}
// 모든 .curse-active 카드를 주기적으로 순회하며 확률적으로 파티클 스폰 → 자연스러운 랜덤 등장
function _curseParticleTick() {
  const cards = document.querySelectorAll('.my-piece-card.curse-active, .opp-piece-card.curse-active');
  cards.forEach(card => {
    // 카드당 확률 60% — 매 tick 마다 결정
    if (Math.random() < 0.6) spawnCurseParticle(card);
  });
}
// 200ms 마다 tick (카드당 평균 0.6/0.2s = 초당 3개 정도 스폰)
setInterval(_curseParticleTick, 200);

// 쿠구궁 효과음 — Web Audio로 생성 (저주파 + 노이즈)
function playBoardQuake() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    // 저주파 rumble
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(60, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.9);
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.0);
  } catch (e) {}
}

// ── 스킬 결과 ──
// 시전 시퀀스 (사용자 요청):
//   ① 화면 dim 오버레이 등장 — SP 바·시전자 프로필만 spotlight (밝게 유지)
//   ② SP 차감 집중 + 마법구 비행 (~2s)
//   ③ 화면 dim 해제 (밝아짐)
//   ④ 0.5초 후 — 스킬 효과 시전 (HP/보드 업데이트, 셀 애니, 토스트, 로그)
socket.on('skill_result', ({ msg, success, yourPieces, oppPieces, sp, instantSp, boardObjects, actionDone, actionUsedSkillReplace, skillsUsed, data, effects, pieceIdx, casterPieceIdx }) => {
  const oldOppHps = S.oppPieces ? S.oppPieces.map(p => p.hp) : [];
  const oldMyHps = S.myPieces.map(p => p.hp);
  const oldSpSnap = Array.isArray(S.sp) ? [...S.sp] : [0, 0];
  const oldInstantSnap = Array.isArray(S.instantSp) ? [...S.instantSp] : [0, 0];

  // 1단계 — 즉시: 행동 플래그 + dim 오버레이 + SP 차감 집중 (마법구 비행)
  //   ★ SFX 는 SP 비행 종료 시점(SP_END) 으로 이동 — 보드 효과/토스트 와 동기화.
  if (actionDone !== undefined) S.actionDone = actionDone;
  if (actionUsedSkillReplace !== undefined) S.actionUsedSkillReplace = actionUsedSkillReplace;
  if (skillsUsed) S.skillsUsedThisTurn = skillsUsed;
  // dim 오버레이 + 시전자 프로필 spotlight (mine: 본인 카드)
  // 시전자 인덱스: 서버가 casterPieceIdx 로 보내며, 구 버전 호환을 위해 pieceIdx 도 fallback
  const _casterIdx = (typeof casterPieceIdx === 'number') ? casterPieceIdx
                    : (typeof pieceIdx === 'number') ? pieceIdx : null;
  const casterCard = (_casterIdx !== null)
    ? (S.isTeamMode
        ? document.querySelector(`#my-pieces-info .team-profile-block[data-player-idx="${S.playerIdx}"] [data-piece-idx="${_casterIdx}"]`)
        : document.querySelectorAll('#my-pieces-info .my-piece-card')[_casterIdx])
    : null;
  // targetInfo: 팀모드에서 재렌더 후 spotlight 재적용을 위해 caster 식별자 저장
  const _targetInfo = (S.isTeamMode && _casterIdx !== null && S.playerIdx != null)
    ? { playerIdx: S.playerIdx, pieceIdx: _casterIdx }
    : null;
  startSkillCastDim(casterCard, _targetInfo);
  // SP 마법구 이동
  try { spendSPAttention(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp); } catch (e) {}
  if (typeof setActionButtonMode === 'function') setActionButtonMode(null);

  // ★ 시전자 말풍선 — 시전자 카드에서 보드 쪽으로 꼬리 달린 스킬명 말풍선 (2초 유지)
  if (casterCard && _casterIdx != null) {
    const casterPc = (S.myPieces || [])[_casterIdx];
    const skName = (casterPc?.skills || []).find(s => (s.cost || 0) > 0)?.name
                 || casterPc?.skillName
                 || (msg ? (msg.match(/[가-힣A-Za-z]+(?=:)/) || [])[0] : null);
    // skillsUsed 의 마지막 사용 스킬을 우선 (정확)
    const lastUsed = skillsUsed && skillsUsed.length > 0 ? skillsUsed[skillsUsed.length - 1] : null;
    const lastSkillId = lastUsed ? lastUsed.split(':').pop() : null;
    const matchedSkill = casterPc && lastSkillId
      ? (casterPc.skills || []).find(s => s.id === lastSkillId)
      : null;
    const finalName = matchedSkill?.name || skName;
    if (finalName) {
      const stype = getSkillTypeFromPiece(casterPc, finalName);
      showSkillCastBubble(casterCard, finalName, stype);
    }
  }

  // ★ 분신 비행 애니메이션 — msg 가 "👫 분신" 으로 시작하면 mover 가 잔상 남기며 target 으로 빠르게 비행.
  //   비교: OLD S.myPieces 위치 vs NEW yourPieces 위치 → 좌표가 변한 쪽이 mover.
  //   비행 동안 mover 의 piece-marker 는 visibility:hidden, 도착 시 보드 재렌더로 합류 emoji 출현.
  if (msg && msg.indexOf('👫 분신') === 0 && yourPieces && typeof playTwinJoinFlight === 'function') {
    const oldElder   = (S.myPieces || []).find(p => p.subUnit === 'elder' && p.alive);
    const oldYounger = (S.myPieces || []).find(p => p.subUnit === 'younger' && p.alive);
    const newElder   = (yourPieces || []).find(p => p.subUnit === 'elder' && p.alive);
    const newYounger = (yourPieces || []).find(p => p.subUnit === 'younger' && p.alive);
    let moverIcon = null, fromCol, fromRow, toCol, toRow;
    if (oldElder && newElder && (oldElder.col !== newElder.col || oldElder.row !== newElder.row)) {
      moverIcon = '👧'; fromCol = oldElder.col; fromRow = oldElder.row; toCol = newElder.col; toRow = newElder.row;
    } else if (oldYounger && newYounger && (oldYounger.col !== newYounger.col || oldYounger.row !== newYounger.row)) {
      moverIcon = '👦'; fromCol = oldYounger.col; fromRow = oldYounger.row; toCol = newYounger.col; toRow = newYounger.row;
    }
    if (moverIcon) playTwinJoinFlight(moverIcon, fromCol, fromRow, toCol, toRow);
  }

  // ★ 통일된 시퀀스 — SP 오브 비행 종료 시점에 SFX/보드 효과/토스트/로그 동시 발사.
  //   SP_END(cost) = 780 + (cost-1) * 130 ms.  cost 0 (기폭) → 1 로 처리해 780ms.
  //   T+0       : 마법구 비행 시작 + 시전자 spotlight (dim)
  //   T+SP_END  : SFX + 스킬 효과(HP/보드) + 토스트/로그 + dim 해제 — 모두 동시
  const _spCost = spCostFromDelta(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp);
  const TOAST_DELAY_MS = getSpFlightEndMs(_spCost);
  const isDetonate = data && Array.isArray(data.deferredBombEmits) && data.deferredBombEmits.length > 0;

  // 2단계 — T+SP_END: SFX + 스킬 효과 + 토스트·로그 + dim 해제 (모두 동시)
  setTimeout(() => {
    // SFX — 보드 효과와 정확히 같은 순간에 재생
    //   ★ 기폭(isDetonate) 은 detonation_intro 의 blast 단계(T+SP_END+550) 에서 폭발 SFX 재생 →
    //     여기서 또 호출하면 시전 시점에 폭발음이 미리 들림. 스킵.
    if (msg && !isDetonate) {
      const sfxRoute = pickSkillSfxByMsg(msg);
      if (sfxRoute) sfxRoute(); else playSfx('skill');
    }
    endSkillCastDim(casterCard);
    if (sp) { S.sp = sp; }
    if (instantSp) { S.instantSp = instantSp; }
    if (sp || instantSp) { updateSPBar(); }

    // 스킬 효과 적용 — 기폭은 별도 detonation_intro/bomb_detonated 흐름이라 HP 업데이트 스킵
    if (!isDetonate) {
      if (yourPieces) S.myPieces = yourPieces;
      if (oppPieces) S.oppPieces = oppPieces;
      pruneDeductionTokens();
      if (boardObjects) S.boardObjects = boardObjects;

      const oppSkillDmgIdx = [];
      if (S.oppPieces) {
        for (let i = 0; i < S.oppPieces.length; i++) {
          if (i < oldOppHps.length && S.oppPieces[i].hp < oldOppHps[i]) oppSkillDmgIdx.push(i);
        }
      }
      const mySkillDmgIdx = [];
      for (let i = 0; i < S.myPieces.length; i++) {
        if (i < oldMyHps.length && S.myPieces[i].hp < oldMyHps[i]) mySkillDmgIdx.push(i);
      }
      // 회복 추적 — HP 가 늘어난 pieces 의 delta 를 healThisTurn 에 누적 (녹색 도장 + HP 바 녹색 오버레이)
      const _myStampPrefix = S.isTeamMode ? `${S.playerIdx}` : 'my';
      const _oppStampPrefix = S.isTeamMode
        ? null  // 팀 모드는 owner 별 키이므로 별도 처리 필요 (skill_result 에서 opp 회복은 드뭄)
        : 'opp';
      for (let i = 0; i < S.myPieces.length; i++) {
        if (i < oldMyHps.length && S.myPieces[i].hp > oldMyHps[i]) {
          addHeal(`${_myStampPrefix}:${i}`, S.myPieces[i].hp - oldMyHps[i]);
        }
      }
      if (S.oppPieces && _oppStampPrefix) {
        for (let i = 0; i < S.oppPieces.length; i++) {
          if (i < oldOppHps.length && S.oppPieces[i].hp > oldOppHps[i]) {
            addHeal(`${_oppStampPrefix}:${i}`, S.oppPieces[i].hp - oldOppHps[i]);
          }
        }
      }

      renderGameBoard();
      renderMyPieces();
      renderOppPieces();
      if (S.isMyTurn) showActionBar(true);

      if (!S.isTeamMode) {
        applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppSkillDmgIdx);
        applyProfileHitAnim('#my-pieces-info .my-piece-card', mySkillDmgIdx);
      }

      const healedIdxs = (data && data.healedPieceIdxs) || (effects && effects.healedPieceIdxs);
      if (Array.isArray(healedIdxs) && healedIdxs.length > 0) {
        setTimeout(() => flashHealPieces(healedIdxs), 50);
      }

      const hitsData = data && Array.isArray(data.hits) ? data.hits : null;
      if (hitsData && hitsData.length > 0) {
        const cells = hitsData.filter(h => h.col != null && h.row != null).map(h => ({ col: h.col, row: h.row }));
        if (cells.length > 0) animateAttack([], cells);

        // ★ 본체 빨간 도장 / 호위무사 파란 도장 — being_attacked 와 동일하게 처리.
        //   유황범람·악몽 등 데미지 스킬에서 빠져 있던 처리. defPieceIdx + defOwnerIdx 기반.
        for (const h of hitsData) {
          const dmg = (typeof h.damage === 'number') ? h.damage : 0;
          if (dmg <= 0 || h.defPieceIdx == null) continue;
          // 키 결정: 1v1 → opp:idx (시전자 시점에서 피해는 항상 상대), 팀모드 → ownerIdx:idx
          const key = (S.isTeamMode && h.defOwnerIdx !== undefined)
            ? `${h.defOwnerIdx}:${h.defPieceIdx}`
            : `opp:${h.defPieceIdx}`;
          if (h.bodyguardRedirect) {
            // 호위무사가 대신 받음 → 파란 충성 도장 (BG 카드)
            addLoyaltyDamage(key, dmg);
          } else if (!h.redirectedToBodyguard) {
            // 본체에 직접 들어간 피해 → 빨간 도장 (피격 카드)
            addBodyDamage(key, dmg);
          }
        }

        const aliveHits = hitsData.filter(h => !h.destroyed && !h.redirectedToBodyguard && h.defPieceIdx !== undefined);
        if (aliveHits.length === 1) {
          const c = aliveHits[0];
          let piece = null;
          let pieceKey = null;
          if (S.isTeamMode && c.defOwnerIdx !== undefined) {
            const ownerPlayer = (S.teamGamePlayers || []).find(p => p.idx === c.defOwnerIdx);
            if (ownerPlayer && ownerPlayer.pieces && ownerPlayer.pieces[c.defPieceIdx]) {
              piece = ownerPlayer.pieces[c.defPieceIdx];
              pieceKey = `${piece.type}:${piece.subUnit || ''}@${c.defOwnerIdx}`;
            }
          } else {
            piece = S.oppPieces?.[c.defPieceIdx];
            if (piece) pieceKey = `${piece.type}:${piece.subUnit || ''}`;
          }
          if (piece && pieceKey) {
            try {
              S.deductionTokens = (S.deductionTokens || []).filter(t => t.pieceKey !== pieceKey && !(t.col === c.col && t.row === c.row));
              S.deductionTokens.push({ pieceKey, icon: piece.icon, name: piece.name, col: c.col, row: c.row });
              renderGameBoard();
            } catch (e) {}
          }
        }
      }
    }

    // 토스트·로그 — 스킬 효과와 동시
    if (msg) {
      addLog(msg, 'skill');
      showSkillToast(msg);
    }
  }, TOAST_DELAY_MS);
});

// ── 상태 업데이트 (상대의 스킬 사용 시) ──
socket.on('status_update', ({ oppPieces, yourPieces, sp, instantSp, boardObjects, msg, skillUsed, healedPieceIdxs, casterPieceIdx, twinJoin, hits }) => {
  // ★ 분신 비행 애니메이션 — 상대(시전자) 시점에서도 보이도록.
  //   server 가 twinJoin 좌표를 fog-of-war 우회로 전달.
  if (twinJoin && typeof playTwinJoinFlight === 'function') {
    const moverIcon = twinJoin.moverSub === 'elder' ? '👧' : '👦';
    playTwinJoinFlight(moverIcon, twinJoin.fromCol, twinJoin.fromRow, twinJoin.toCol, twinJoin.toRow);
  }

  // 마법구 비행 + dim 오버레이 — skill_result(시전자) 와 동일한 시퀀스로 재현.
  // 시전자 카드는 1v1 상대 시점이므로 #opp-pieces-info 에 위치.
  const oldMyHpsCaptured = S.myPieces.map(p => p.hp);
  const oldOppHpsCaptured = S.oppPieces ? S.oppPieces.map(p => p.hp) : [];
  const oldSpSnap = Array.isArray(S.sp) ? [...S.sp] : [0, 0];
  const oldInstantSnap = Array.isArray(S.instantSp) ? [...S.instantSp] : [0, 0];

  const oppCasterCard = (typeof casterPieceIdx === 'number')
    ? document.querySelectorAll('#opp-pieces-info .opp-piece-card')[casterPieceIdx]
    : null;
  startSkillCastDim(oppCasterCard);
  // SP 마법구 비행 — opp 측이 SP 를 소비해 본인 측으로 transfer 되므로 transferToMe 경로(빨간 마법구)가 발동
  try { spendSPAttention(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp); } catch (e) {}

  // ★ 시전자 말풍선 (1v1 상대 시전 시점)
  if (oppCasterCard && typeof casterPieceIdx === 'number') {
    const oppPc = (S.oppPieces || [])[casterPieceIdx];
    const skName = skillUsed?.skillName || (msg ? (msg.match(/[가-힣A-Za-z]+(?=:)/) || [])[0] : null);
    if (skName) {
      const stype = getSkillTypeFromPiece(oppPc, skName);
      showSkillCastBubble(oppCasterCard, skName, stype);
    }
  }

  // ★ 통일된 시퀀스 — SP 비행 종료 시점에 SFX + 보드 효과 + 토스트/로그 동시 발사
  const _spCost = spCostFromDelta(oldSpSnap, sp || S.sp, oldInstantSnap, instantSp || S.instantSp);
  const TOAST_DELAY_MS = getSpFlightEndMs(_spCost);

  // T+SP_END: SFX + dim 해제 + sp 동기화 + HP/보드 + 토스트·로그 (모두 동시)
  //   ★ 기폭 msg 는 SFX 스킵 — detonation_intro blast 가 폭발 SFX 담당
  const _isDetonateMsg = msg && msg.indexOf('💥기폭') === 0;
  setTimeout(() => {
    if (msg && !_isDetonateMsg) {
      const sfxRoute = pickSkillSfxByMsg(msg);
      if (sfxRoute) sfxRoute(); else playSfx('opp_skill');
    }
    endSkillCastDim(oppCasterCard);
    if (sp) { S.sp = sp; }
    if (instantSp) { S.instantSp = instantSp; }
    if (sp || instantSp) { updateSPBar(); }

    if (yourPieces) S.myPieces = yourPieces;
    if (oppPieces) S.oppPieces = oppPieces;
    pruneDeductionTokens();
    if (boardObjects) S.boardObjects = boardObjects;

    const mySkillDmgIdx = [];
    for (let i = 0; i < S.myPieces.length; i++) {
      if (i < oldMyHpsCaptured.length && S.myPieces[i].hp < oldMyHpsCaptured[i]) mySkillDmgIdx.push(i);
    }
    // 회복 추적 — 1v1 상대 시점에서 상대 pieces 회복 (heal 스킬)
    for (let i = 0; i < (S.oppPieces || []).length; i++) {
      if (i < oldOppHpsCaptured.length && S.oppPieces[i].hp > oldOppHpsCaptured[i]) {
        addHeal(`opp:${i}`, S.oppPieces[i].hp - oldOppHpsCaptured[i]);
      }
    }
    // (혹시 모를 본인 측 회복)
    for (let i = 0; i < S.myPieces.length; i++) {
      if (i < oldMyHpsCaptured.length && S.myPieces[i].hp > oldMyHpsCaptured[i]) {
        addHeal(`my:${i}`, S.myPieces[i].hp - oldMyHpsCaptured[i]);
      }
    }

    renderGameBoard();
    renderMyPieces();
    renderOppPieces();

    if (!S.isTeamMode) {
      applyProfileHitAnim('#my-pieces-info .my-piece-card', mySkillDmgIdx);
    }
    if (Array.isArray(healedPieceIdxs) && healedPieceIdxs.length > 0) {
      setTimeout(() => flashHealPieces(healedPieceIdxs, { opp: true }), 50);
    }

    // ★ 데미지 스킬 hits 처리 — 셀 hit 애니 + 본체 빨간 도장 / 충성 파란 도장.
    //   server status_update 가 hits 를 보내며, defPieceIdx 는 받는 쪽의 yourPieces (= S.myPieces) 인덱스.
    if (Array.isArray(hits) && hits.length > 0) {
      const hitCells = hits.filter(h => h.col != null && h.row != null).map(h => ({ col: h.col, row: h.row }));
      if (hitCells.length > 0) animateAttack([], hitCells);
      for (const h of hits) {
        const dmg = (typeof h.damage === 'number') ? h.damage : 0;
        if (dmg <= 0 || h.defPieceIdx == null) continue;
        // 1v1 status_update 받는 쪽 = 피해 받는 쪽 → 본인 카드 (my:idx)
        const key = `my:${h.defPieceIdx}`;
        if (h.bodyguardRedirect) {
          addLoyaltyDamage(key, dmg);
        } else if (!h.redirectedToBodyguard) {
          addBodyDamage(key, dmg);
        }
      }
    }

    if (msg) {
      showSkillToast(msg, true);
      addLog(msg, 'skill-enemy');
    }
  }, TOAST_DELAY_MS);
});

// ── 정찰 결과 ──
socket.on('scout_result', ({ axis, value, targetName }) => {
  const label = axis === 'row' ? `${ROW_LABELS[value] || value}열` : `${value+1}행`;
  if (typeof playSfxScout === 'function') playSfxScout(); else playSfx('skill');
  // 인벤토리 E1 본인 셀: "🔭 정찰: 상대 [target]의 위치는 [label]"
  addLog(`🔭 정찰: 상대 ${targetName}의 위치는 ${label}`, 'skill');
  showSkillToast(`🔭 정찰: 상대 ${targetName}의 위치는 ${label}`);
});

// ── 쥐 소환 ──
socket.on('rats_spawned', ({ rats, owner, spCost }) => {
  // ★ 통일 — SP 비행 종료 시점에 SFX + 보드 + 토스트/로그 동시 발사
  const SP_END_MS = getSpFlightEndMs(spCost || 2);
  const isMine = owner === S.playerIdx;
  const isAlly = S.isTeamMode && (S.teamGamePlayers || []).some(p => p.idx === owner && p.teamId === S.teamId && p.idx !== S.playerIdx);
  setTimeout(() => {
    if (typeof playSfxRatSummon === 'function') playSfxRatSummon(); else playSfx('skill');
    if (isMine) {
      addLog(`🐀 역병의 자손들: 쥐 ${rats.length}마리 소환`, 'skill');
      showSkillToast(`🐀 역병의 자손들: 쥐 ${rats.length}마리 소환`);
    } else if (isAlly) {
      addLog(`🐀 역병의 자손들: 쥐 ${rats.length}마리 소환`, 'skill');
      showSkillToast(`🐀 역병의 자손들: 쥐 ${rats.length}마리 소환`);
    } else {
      addLog(`🐀 역병의 자손들: 상대가 쥐 소환. 쥐는 공격으로 제거 가능`, 'skill');
      showSkillToast(`🐀 역병의 자손들: 상대가 쥐 소환. 쥐는 공격으로 제거 가능`, true);
    }
    renderGameBoard();
  }, SP_END_MS);
});

// ── 드래곤 소환 ──
socket.on('dragon_spawned', ({ dragon, owner, spCost }) => {
  // ★ 통일 — SP 비행 종료 시점에 SFX + 토스트/로그 (드래곤 5 SP → 1300ms)
  const SP_END_MS = getSpFlightEndMs(spCost || 5);
  const isMine = owner === S.playerIdx;
  const isAlly = S.isTeamMode && (S.teamGamePlayers || []).some(p => p.idx === owner && p.teamId === S.teamId && p.idx !== S.playerIdx);
  setTimeout(() => {
    if (typeof playSfxDragonSummon === 'function') playSfxDragonSummon(); else playSfx('skill');
    if (isMine || isAlly) {
      addLog(`🐉 드래곤 소환: ${coord(dragon.col,dragon.row)}에 드래곤 소환`, 'skill');
      showSkillToast(`🐉 드래곤 소환: ${coord(dragon.col,dragon.row)}에 드래곤 소환`);
    } else {
      addLog(`🐉 드래곤 소환: 상대가 ${coord(dragon.col,dragon.row)}에 드래곤 소환`, 'skill');
      showSkillToast(`🐉 드래곤 소환: 상대가 ${coord(dragon.col,dragon.row)}에 드래곤 소환`, true);
    }
  }, SP_END_MS);
});

// ── 함정 발동 ──
socket.on('trap_triggered', ({ col, row, pieceInfo, damage, owner, destroyed, newHp, victimOwnerIdx }) => {
  // 트랩 전용 사운드 + 일반 피격/격파 사운드 레이어링
  playSfxTrapSnap();
  if (destroyed) playSfx('kill'); else playSfx('hit');

  // ★ 1v1 관전자 — 별도 처리: spectator 의 S.myPieces/oppPieces 가 비어있어 일반 경로가 무동작.
  //   victimOwnerIdx 0=p0(#my-pieces-info), 1=p1(#opp-pieces-info) 매핑.
  if (S.isSpectator && !S.isTeamMode) {
    addLog(`🪤 덫 발동!`, 'hit');
    showSkillToast(`🪤 덫 발동!`);
    S.attackLog.push({ col, row, hit: true, turn: S.turnNumber });
    animateAttack([], [{ col, row }]);
    if (victimOwnerIdx != null) {
      const arr = (victimOwnerIdx === 0) ? (S.specGameState?.p0Pieces || []) : (S.specGameState?.p1Pieces || []);
      let idx = arr.findIndex(p => p.alive && p.name === pieceInfo?.name && p.col === col && p.row === row);
      if (idx < 0) idx = arr.findIndex(p => p.alive && p.name === pieceInfo?.name);
      if (idx >= 0) {
        if (typeof damage === 'number' && damage > 0) {
          const key = (victimOwnerIdx === 0) ? `my:${idx}` : `opp:${idx}`;
          addBodyDamage(key, damage);
        }
        const containerSel = (victimOwnerIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
        const cardSel = (victimOwnerIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
        const card = document.querySelectorAll(`${containerSel} ${cardSel}`)[idx];
        if (card) applyHitFlashWithBrighten(card);
      }
    }
    if (S.specGameState) renderSpectatorGame(S.specGameState);
    return;
  }

  // 인벤토리 E7 트랩 발동 — `🪤 덫 발동!` 모두 동일 (원본 유지)
  const msg = `🪤 덫 발동!`;
  addLog(msg, 'hit');
  showSkillToast(msg);
  S.attackLog.push({ col, row, hit: true, turn: S.turnNumber });

  // HP 즉시 갱신 — 일반 피격과 동일하게 클라이언트에서 바로 반영
  // 이름·좌표로 매칭 (트랩 발동 시점은 이동 직후라 좌표가 정확)
  const updatePiece = (arr) => {
    if (!Array.isArray(arr)) return -1;
    let idx = arr.findIndex(p => p.alive && p.name === pieceInfo.name && p.col === col && p.row === row);
    if (idx < 0) idx = arr.findIndex(p => p.alive && p.name === pieceInfo.name);
    if (idx >= 0) {
      if (newHp != null) arr[idx].hp = newHp;
      if (destroyed) arr[idx].alive = false;
    }
    return idx;
  };
  const myIdx = updatePiece(S.myPieces);
  const oppIdx = updatePiece(S.oppPieces);
  const tmIdx = updatePiece(S.teammatePieces);

  // 본체 직접 피해 추적 (덫은 본체에 직접 들어가는 피해)
  if (damage > 0) {
    if (myIdx >= 0) addBodyDamage(`my:${myIdx}`, damage);
    else if (oppIdx >= 0) addBodyDamage(`opp:${oppIdx}`, damage);
    else if (tmIdx >= 0 && victimOwnerIdx != null) addBodyDamage(`${victimOwnerIdx}:${tmIdx}`, damage);
  }

  // 사망 시 추리 토큰 즉시 제거
  if (destroyed && typeof pruneDeductionTokens === 'function') pruneDeductionTokens();

  // 셀 + 보드 아이콘 피격 애니메이션 (일반 공격과 동일)
  animateAttack([], [{ col, row }]);

  renderGameBoard();
  if (S.isTeamMode) {
    if (typeof renderTeamProfiles === 'function') renderTeamProfiles();
  } else {
    renderMyPieces();
    renderOppPieces();
  }

  // 프로필 카드 흔들림 + 금색 플래시 — 1v1 만 (팀모드는 별도 처리)
  if (!S.isTeamMode) {
    if (myIdx >= 0) applyProfileHitAnim('#my-pieces-info .my-piece-card', [myIdx]);
    if (oppIdx >= 0) applyProfileHitAnim('#opp-pieces-info .opp-piece-card', [oppIdx]);
  }
  // 팀모드: 팀원이 트랩에 걸렸으면 팀원 카드 hit 애니
  if (tmIdx >= 0 && S.isTeamMode) {
    const teammate = (S.teamGamePlayers || []).find(p => p.teamId === S.teamId && p.idx !== S.playerIdx);
    if (teammate) {
      requestAnimationFrame(() => {
        const card = document.querySelector(`#my-pieces-info .team-profile-block[data-player-idx="${teammate.idx}"] [data-piece-idx="${tmIdx}"]`);
        if (card) {
          card.classList.remove('profile-hit');
          void card.offsetWidth;
          card.classList.add('profile-hit');
          setTimeout(() => card.classList.remove('profile-hit'), 1800);
        }
      });
    }
  }
});

// ── 기폭 인트로 (폭탄 노출 → 빨강 전환 애니) ──
// #18: SP 강조(2s) 후 시작. 전체 1.5s 로 압축.
// 폭탄 이모지는 인게임 보드 렌더 흐름과 무관하게 인트로 핸들러가 직접 셀에 마커 부착 →
// skill_result 로 boardObjects 가 업데이트돼 폭탄이 사라져도 애니 동안 시각적으로 유지됨.
socket.on('detonation_intro', ({ bombs }) => {
  if (!Array.isArray(bombs) || bombs.length === 0) return;
  const board = document.getElementById('game-board');
  if (!board) return;
  // ★ 통일 — 기폭은 SP cost 0 이지만 cost 1 (780ms) 시점에 spotlight 종료 후 폭탄 시퀀스 시작.
  //   기존 SP_ATTN_MS(2000) + SKILL_GAP_MS(500) = 2500ms → 780ms 로 단축.
  //   폭탄 시퀀스 자체(reveal→arm→blast→cleanup) 는 950ms 로 그대로 유지.
  const SKILL_START_MS = getSpFlightEndMs(1);  // 780ms — 다른 1 cost 스킬과 동일 호흡
  // ★ 기폭으로 발동된 폭탄들 — 클라가 보드에서 즉시 제거할 수 있게 표시 + bomb_detonated 의 중복 SFX 차단
  S._suppressNextBombSfx = (S._suppressNextBombSfx || 0) + bombs.length;
  const markers = [];
  // 단계 1: 노출 (0ms) — 마커 부착 + 황색 후광
  setTimeout(() => {
    for (const b of bombs) {
      const cell = board.querySelector(`.cell[data-col="${b.col}"][data-row="${b.row}"]`);
      if (!cell) continue;
      cell.classList.add('bomb-reveal');
      const existing = cell.querySelector('.bomb-anim-marker');
      if (!existing) {
        const m = document.createElement('span');
        m.className = 'bomb-anim-marker';
        m.textContent = '💣';
        m.style.cssText = 'position:absolute;top:1px;right:2px;font-size:0.6rem;z-index:6;pointer-events:none;animation:bomb-marker-fade-in 0.35s ease-out forwards;';
        cell.appendChild(m);
        markers.push(m);
      }
    }
  }, SKILL_START_MS);
  // 단계 2: 빨강 (450ms 후)
  setTimeout(() => {
    for (const b of bombs) {
      const cell = board.querySelector(`.cell[data-col="${b.col}"][data-row="${b.row}"]`);
      if (cell) cell.classList.add('bomb-arming');
    }
  }, SKILL_START_MS + 450);
  // 단계 3: 폭발 (550ms — 빨강 변환 100ms 후 즉시 폭발) + SFX 1번만 + 강화 애니메이션
  setTimeout(() => {
    for (const b of bombs) {
      const cell = board.querySelector(`.cell[data-col="${b.col}"][data-row="${b.row}"]`);
      if (!cell) continue;
      cell.classList.add('bomb-blast');
      // 셀 흔들림
      cell.classList.add('bomb-cell-shake');
      setTimeout(() => cell.classList.remove('bomb-cell-shake'), 450);
      // 기존 💣 마커 — 커지며 회전 후 사라짐
      const marker = cell.querySelector('.bomb-anim-marker');
      if (marker) marker.classList.add('bomb-marker-explode');
      // 💥 burst + 파편
      try { playBombExplosion(cell); } catch (e) {}
    }
    // ★ 폭발 SFX — 시각 폭발 순간에 1번만 (bomb_detonated 의 SFX 는 _suppressNextBombSfx 로 차단)
    try { playSfxBombExplode(); } catch (e) {}
  }, SKILL_START_MS + 550);
  // 단계 4: 정리 (950ms 후) — 마커 제거 + 보드에서 폭탄 즉시 제거 (사용자 요청: 턴 종료 안 기다림)
  setTimeout(() => {
    for (const b of bombs) {
      const cell = board.querySelector(`.cell[data-col="${b.col}"][data-row="${b.row}"]`);
      if (cell) cell.classList.remove('bomb-reveal', 'bomb-arming', 'bomb-blast');
    }
    for (const m of markers) {
      if (m && m.parentNode) m.remove();
    }
    // S.boardObjects 에서 해당 좌표의 bomb 제거 + 보드 재렌더 (즉시 사라지게)
    if (Array.isArray(S.boardObjects)) {
      const coordSet = new Set(bombs.map(b => `${b.col},${b.row}`));
      S.boardObjects = S.boardObjects.filter(o => !(o.type === 'bomb' && coordSet.has(`${o.col},${o.row}`)));
      try { renderGameBoard(); } catch (e) {}
    }
  }, SKILL_START_MS + 950);
});

// ── 폭탄 폭발 ──
socket.on('bomb_detonated', ({ col, row, hits }) => {
  // ★ 기폭 스킬로 발동된 경우 — detonation_intro 가 이미 SFX 재생했으므로 중복 차단.
  //   화약상 사망 자동 폭발 등 다른 경로는 정상 SFX 재생.
  if (S._suppressNextBombSfx && S._suppressNextBombSfx > 0) {
    S._suppressNextBombSfx--;
  } else {
    playSfxBombExplode();
  }
  // ★ 1v1 관전자 — 별도 처리: spectator 의 S.myPieces/oppPieces 가 비어있어 일반 경로가 무동작.
  //   defOwnerIdx 0=p0(#my-pieces-info), 1=p1(#opp-pieces-info) 매핑으로 카드 hit flash 적용.
  if (S.isSpectator && !S.isTeamMode) {
    if (Array.isArray(S.boardObjects)) {
      S.boardObjects = S.boardObjects.filter(o => !(o.type === 'bomb' && o.col === col && o.row === row));
    }
    animateAttack([], hits.map(h => ({ col: h.col, row: h.row })));
    for (const h of hits) {
      if (h.defPieceIdx == null || h.defOwnerIdx == null) continue;
      const dmg = (typeof h.damage === 'number') ? h.damage : 0;
      if (dmg > 0) {
        const key = (h.defOwnerIdx === 0) ? `my:${h.defPieceIdx}` : `opp:${h.defPieceIdx}`;
        addBodyDamage(key, dmg);
      }
      const containerSel = (h.defOwnerIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
      const cardSel = (h.defOwnerIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
      const card = document.querySelectorAll(`${containerSel} ${cardSel}`)[h.defPieceIdx];
      if (card) applyHitFlashWithBrighten(card);
    }
    if (S.specGameState) renderSpectatorGame(S.specGameState);
    return;
  }
  // 보드에서 해당 폭탄 제거 (자동 폭발 케이스 등)
  if (Array.isArray(S.boardObjects)) {
    S.boardObjects = S.boardObjects.filter(o => !(o.type === 'bomb' && o.col === col && o.row === row));
  }
  // #13: 폭탄 폭발은 skill_result(기폭 시전자)에서 이미 메시지 출력됨.
  // 여기서는 토스트 중복 방지 — 로그도 생략 (위치 정보가 필요하면 stamp/HP바로 충분).
  // (자동 발화 — 화약상 사망 시 트리거 등 — 도 별도 패시브 알림으로 처리되므로 OK)
  for (const h of hits) {
    S.attackLog.push({ col: h.col, row: h.row, hit: true, turn: S.turnNumber });
  }
  if (hits.length === 0) {
    S.attackLog.push({ col, row, hit: false, turn: S.turnNumber });
  }

  // ★ HP 갱신 + 본체 데미지 도장 — 트랩(`trap_triggered`)과 동일하게 처리.
  //   원래는 후속 game_state/team_game_update 가 HP 를 가져왔지만, 그 사이 시각적으로
  //   HP 바·도장·사망 아이콘이 누락되는 문제가 있어 즉시 반영.
  let bombAnyDestroyed = false;
  for (const h of hits) {
    const updateInArr = (arr) => {
      if (!Array.isArray(arr)) return -1;
      let idx = arr.findIndex(p => p.alive && p.name === h.name && p.col === h.col && p.row === h.row);
      if (idx < 0) idx = arr.findIndex(p => p.alive && p.name === h.name);
      if (idx >= 0) {
        if (typeof h.newHp === 'number') arr[idx].hp = h.newHp;
        if (h.destroyed) arr[idx].alive = false;
      }
      return idx;
    };
    const myI  = updateInArr(S.myPieces);
    const oppI = updateInArr(S.oppPieces);
    const tmI  = (S.isTeamMode && S.teammatePieces) ? updateInArr(S.teammatePieces) : -1;
    if (h.destroyed) bombAnyDestroyed = true;
    if (typeof h.damage === 'number' && h.damage > 0) {
      if (myI >= 0) addBodyDamage(`my:${myI}`, h.damage);
      else if (oppI >= 0) addBodyDamage(`opp:${oppI}`, h.damage);
      else if (tmI >= 0 && S.isTeamMode) {
        const teammate = (S.teamGamePlayers || []).find(p => p.teamId === S.teamId && p.idx !== S.playerIdx);
        if (teammate) addBodyDamage(`${teammate.idx}:${tmI}`, h.damage);
      }
    }
  }
  // 사망 시 추리 토큰 즉시 제거 (트랩과 동일)
  if (bombAnyDestroyed && typeof pruneDeductionTokens === 'function') pruneDeductionTokens();
  // 셀 + 보드 아이콘 피격 애니메이션 (트랩과 동일하게 — 일반 공격 hit 애니)
  animateAttack([], hits.map(h => ({ col: h.col, row: h.row })));

  // 폭탄 피격 애니메이션: 내 유닛 & 상대 유닛 모두 (팀모드는 팀원도 포함)
  const myBombIdx = findPieceIndices(S.myPieces, hits);
  const oppBombIdx = findPieceIndices(S.oppPieces, hits);
  const tmBombIdx = (S.isTeamMode && S.teammatePieces) ? findPieceIndices(S.teammatePieces, hits) : [];

  renderGameBoard();
  if (S.isTeamMode && typeof renderTeamProfiles === 'function') {
    renderTeamProfiles();
  } else {
    renderMyPieces();
    renderOppPieces();
  }

  if (!S.isTeamMode) {
    applyProfileHitAnim('#my-pieces-info .my-piece-card', myBombIdx);
    applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppBombIdx);
  }
  // 팀모드: 팀원 카드 — data-piece-idx 기반 정확 매칭
  if (tmBombIdx.length > 0 && S.isTeamMode) {
    const teammate = (S.teamGamePlayers || []).find(p => p.teamId === S.teamId && p.idx !== S.playerIdx);
    if (teammate) {
      requestAnimationFrame(() => {
        for (const i of tmBombIdx) {
          const card = document.querySelector(`#my-pieces-info .team-profile-block[data-player-idx="${teammate.idx}"] [data-piece-idx="${i}"]`);
          if (card) {
            card.classList.remove('profile-hit');
            void card.offsetWidth;
            card.classList.add('profile-hit');
            setTimeout(() => card.classList.remove('profile-hit'), 1800);
          }
        }
      });
    }
  }
});

// ── 저주 지속 데미지 — 토스트·로그 없음. 프로필 애니메이션 + 보라 데미지 도장 (3초)만 ──
// 사용자 요청: 절대 토스트 출력 X. 일반 피격 애니메이션과도 구별되어야 함.
// 그래서 다음 team_game_update 의 빨간 profile-hit 트리거를 스킵하기 위해 _recentCurseDamageKeys 마킹.
socket.on('curse_tick', ({ playerIdx, targetName, damage, newHp }) => {
  if (!targetName) return;
  try { playSfxCurseDamage(); } catch (e) {}
  // 일반 피격 애니메이션이 후속 team_game_update 에서 발동되지 않게 마킹
  if (!S._recentCurseDamageKeys) S._recentCurseDamageKeys = new Set();
  const key = `${playerIdx}:${targetName}`;
  S._recentCurseDamageKeys.add(key);
  setTimeout(() => { if (S._recentCurseDamageKeys) S._recentCurseDamageKeys.delete(key); }, 800);

  // 1v1: 도장 데이터 누적 + piece HP 동기화 (HP 바 즉시 반영 + buildDamageOverlay 가 보라 도장을 표시)
  const myIdx = S.myPieces?.findIndex(p => p.alive && p.name === targetName) ?? -1;
  const oppIdx = S.oppPieces?.findIndex(p => p.alive && p.name === targetName) ?? -1;
  if (myIdx >= 0) {
    addCurseDamageStampValue(`my:${myIdx}`, damage);
    if (typeof newHp === 'number' && S.myPieces[myIdx]) S.myPieces[myIdx].hp = newHp;
  }
  if (oppIdx >= 0) {
    addCurseDamageStampValue(`opp:${oppIdx}`, damage);
    if (typeof newHp === 'number' && S.oppPieces[oppIdx]) S.oppPieces[oppIdx].hp = newHp;
  }
  // 팀모드: 플레이어별 인덱스 키 사용
  if (S.isTeamMode) {
    for (const pl of (S.teamGamePlayers || [])) {
      const idxInPl = (pl.pieces || []).findIndex(p => p.alive && p.name === targetName);
      if (idxInPl < 0) continue;
      addCurseDamageStampValue(`${pl.idx}:${idxInPl}`, damage);
      if (typeof newHp === 'number' && pl.pieces[idxInPl]) pl.pieces[idxInPl].hp = newHp;
    }
  }
  // 저주 지속 데미지 로그 (토스트는 없음) — 해골 이모지 (저주 관련 통일)
  try {
    const dmgStr = Number.isInteger(damage) ? `${damage}` : `${damage.toFixed(1)}`;
    addLog(`☠ 저주: ${targetName} ${dmgStr} 피해`, 'skill');
  } catch (e) {}
  // 즉시 재렌더 — 보라 도장 반영
  try {
    if (S.isTeamMode && typeof renderTeamProfiles === 'function') renderTeamProfiles();
    else { renderMyPieces(); renderOppPieces(); }
  } catch (e) {}
  // ★ 데미지 종류 무관 — 피격된 카드는 그 턴 동안 dim 해제 (turn-bright).
  //   저주는 빨간 profile-hit 대신 보라 도장이 visual cue 라서 turn-bright 만 추가.
  requestAnimationFrame(() => {
    if (S.isTeamMode) {
      const card = document.querySelector(`.team-profile-block[data-player-idx="${playerIdx}"] [data-piece-idx="${(S.teamGamePlayers || []).find(p => p.idx === playerIdx)?.pieces?.findIndex(p => p.name === targetName) ?? -1}"]`);
      if (card) card.classList.add('turn-bright');
    } else {
      // 1v1 — 본인/상대 카드 모두 후보
      const myI = S.myPieces?.findIndex(p => p.name === targetName) ?? -1;
      const oppI = S.oppPieces?.findIndex(p => p.name === targetName) ?? -1;
      if (myI >= 0) {
        const card = document.querySelectorAll('#my-pieces-info .my-piece-card')[myI];
        if (card) card.classList.add('turn-bright');
      }
      if (oppI >= 0) {
        const card = document.querySelectorAll('#opp-pieces-info .opp-piece-card')[oppI];
        if (card) card.classList.add('turn-bright');
      }
    }
  });
});
// (구) DOM 기반 저주 도장 함수 — 더 이상 호출되지 않음.
// 새 시스템: S.curseDamageThisTurn 누적 → buildDamageOverlay 가 카드 마크업에 도장 포함.
function attachCurseDamageStamp(card, damage) {
  // no-op (호환용 빈 스텁)
  return;
  // 이전 코드 (참고용 보존):
  if (!card) return;
  const existing = card.querySelector('.dmg-stamp.curse');
  if (existing) existing.remove();
  const stamp = document.createElement('div');
  stamp.className = 'dmg-stamp curse';
  const dmgText = Number.isInteger(damage) ? `${damage} 데미지` : `${damage.toFixed(1)} 데미지`;
  stamp.textContent = dmgText;
  if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
  card.appendChild(stamp);
  setTimeout(() => { if (stamp.parentNode) stamp.remove(); }, 3000);
}

// ── 패시브 알림 ──
// '공격받았습니다!' 가 항상 먼저 나오도록 — 공격 반응형 패시브(bodyguard/monk/count/armoredWarrior 등)는
// being_attacked 처리 후로 출력 순서를 미룬다.
// 공격 반응형 패시브 — 'wizard' 도 포함 (토스트·로그 출력 + 마법구 애니메이션 동시)
const DEFENSIVE_PASSIVE_TYPES = new Set(['bodyguard', 'monk', 'count', 'armoredWarrior', 'wizard']);
S._pendingDefensiveAlerts = S._pendingDefensiveAlerts || [];

// 패시브 type → { pieceType, displayName } — 말풍선 표시 대상
const PASSIVE_BUBBLE_INFO = {
  wizard:         { pieceType: 'wizard',         name: '인스턴트매직' },
  monk:           { pieceType: 'monk',           name: '가호' },
  monk_attack:    { pieceType: 'monk',           name: '가호' },
  armoredWarrior: { pieceType: 'armoredWarrior', name: '아이언스킨' },
  count:          { pieceType: 'count',          name: '폭정' },
  bodyguard:      { pieceType: 'bodyguard',      name: '충성' },
  torturer:       { pieceType: 'torturer',       name: '표식' },
};

// 패시브 발동 시 — 해당 piece 카드에서 보드 쪽으로 주황 말풍선 (스킬 시전 말풍선과 동일 디자인)
function showPassiveBubble(type, playerIdx) {
  const info = PASSIVE_BUBBLE_INFO[type];
  if (!info) return;
  // 카드 찾기 — 1v1 / 팀 모드 분기
  let card = null;
  if (S.isTeamMode) {
    const player = (S.teamGamePlayers || []).find(p => p.idx === playerIdx);
    const idx = (player?.pieces || []).findIndex(pc => pc.type === info.pieceType);
    if (idx >= 0) {
      card = document.querySelector(`.team-profile-block[data-player-idx="${playerIdx}"] [data-piece-idx="${idx}"]`);
    }
  } else if (S.isSpectator) {
    // 관전자 — playerIdx 별 컨테이너 + my-piece-card / opp-piece-card 구분
    const containerSel = (playerIdx === 0) ? '#my-pieces-info' : '#opp-pieces-info';
    const cardSel = (playerIdx === 0) ? '.my-piece-card' : '.opp-piece-card';
    const sourcePieces = (playerIdx === 0) ? (S.specP0Pieces || S.myPieces) : (S.specP1Pieces || S.oppPieces);
    const idx = (sourcePieces || []).findIndex(pc => pc.type === info.pieceType);
    if (idx >= 0) {
      card = document.querySelectorAll(`${containerSel} ${cardSel}`)[idx];
    }
  } else {
    // 1v1 — playerIdx 가 본인이면 my, 아니면 opp
    const isMine = (playerIdx === S.playerIdx);
    const sourcePieces = isMine ? S.myPieces : S.oppPieces;
    const idx = (sourcePieces || []).findIndex(pc => pc.type === info.pieceType);
    if (idx >= 0) {
      const containerSel = isMine ? '#my-pieces-info' : '#opp-pieces-info';
      const cardSel = isMine ? '.my-piece-card' : '.opp-piece-card';
      card = document.querySelectorAll(`${containerSel} ${cardSel}`)[idx];
    }
  }
  if (card && typeof showSkillCastBubble === 'function') {
    showSkillCastBubble(card, info.name, 'passive');
  }
}

function _renderPassiveAlert({ type, msg, playerIdx, targetName }) {
  addLog(msg, 'skill');
  if (type !== 'curse_tick') {
    const passiveSfx = pickPassiveSfxByType(type);
    if (passiveSfx) passiveSfx(); else playSfxPassive();
  }
  // ★ 패시브 말풍선 — 해당 piece 카드에서 주황 말풍선 (저주 관련 type 은 스킬·패시브 와 무관해 제외)
  if (typeof playerIdx === 'number' && PASSIVE_BUBBLE_INFO[type]) {
    showPassiveBubble(type, playerIdx);
  }
  const isCurseToast = (type === 'curse_tick' || type === 'curse_removed');
  if (S.isSpectator) {
    showSkillToast(msg, false, playerIdx, isCurseToast ? 'curse' : undefined);
    return;
  }
  const isEnemy = (playerIdx !== undefined) ? (playerIdx !== S.playerIdx) : false;
  showSkillToast(msg, isEnemy, undefined, isCurseToast ? 'curse' : undefined);
}

// 데미지 감소형 패시브(가호/폭정/아이언스킨) — 격파 발생 시 토스트 생략, 로그는 유지
const REDUCTION_PASSIVE_TYPES = new Set(['monk', 'count', 'armoredWarrior']);
function flushDefensiveAlerts(opts) {
  if (!S._pendingDefensiveAlerts || S._pendingDefensiveAlerts.length === 0) return;
  const skipReduction = !!(opts && opts.skipReduction);
  const list = S._pendingDefensiveAlerts;
  S._pendingDefensiveAlerts = [];
  for (const item of list) {
    if (skipReduction && REDUCTION_PASSIVE_TYPES.has(item.type)) {
      // 로그만 작성 (토스트 생략)
      addLog(item.msg, 'skill');
      continue;
    }
    _renderPassiveAlert(item);
  }
}

socket.on('passive_alert', (payload) => {
  const { type, playerIdx } = payload || {};
  // 호위무사 가로채기 플래그는 being_attacked 측 보호 애니메이션 분기에 사용
  if (type === 'bodyguard') S._bodyguardIntercepted = true;
  // 마법사 인스턴트 매직 — 황금 마법구 합류 애니 트리거. 토스트·로그는 _renderPassiveAlert 가 처리.
  if (type === 'wizard') {
    let targetSlot = 'mine';
    if (S.isTeamMode) {
      const owner = (S.teamGamePlayers || []).find(p => p.idx === playerIdx);
      if (owner) targetSlot = (owner.teamId === S.teamId) ? 'mine' : 'opp';
    } else {
      targetSlot = (playerIdx === S.playerIdx) ? 'mine' : 'opp';
    }
    try { spawnInstantGainOrb(targetSlot); } catch (e) {}
  }
  // 공격 반응형 패시브는 버퍼에 쌓아두고 being_attacked 직후 flush
  if (DEFENSIVE_PASSIVE_TYPES.has(type)) {
    S._pendingDefensiveAlerts.push(payload);
    return;
  }
  _renderPassiveAlert(payload);
});

// ── 게임 오버 ──
socket.on('game_over', ({ win, draw, opponentName, winnerName, loserName, spectator, reason, replayWinnerPieces, replayBoardObjects, replayBounds }) => {
  // 게임 간 stale 데이터 차단 — 다음 게임의 교환 배지 오탐 방지
  S.oppRevealChars = null;
  // 무승부 시에도 타이머 절대 재가동 안 되게 차단
  S._gameEnded = true;
  stopClientTimer();
  // 세팅 단계 기권: 즉시 + 페이드 없음 / 게임 중: 1초 대기 + 느린 페이드
  // 보드 축소로 인한 종료: 축소 애니메이션(흔들림 + bounds 업데이트)이 완료된 후 표시
  const inGame = _isInGameScreen();
  const isShrinkEnd = reason && reason.type === 'shrink';
  const delay = inGame ? (isShrinkEnd ? 1800 : 1000) : 0;
  setTimeout(() => {
    _showGameOverScreen(!inGame);
    runGameOverRender();
  }, delay);
  function runGameOverRender() {
  if (!spectator) bgmPlay(win ? 'victory' : (draw ? 'victory' : 'defeat'));
  const r = reason || {};
  const victims = (r.victims || []).join(', ');
  const killer = r.killer || '';

  // Helper: build victim string (e.g. "궁수, 장군, 기사")
  function victimStr(vs) {
    const arr = vs || [];
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]}${조사(arr[0], '과', '와')} ${arr[1]}`;
    return arr.join(', ');
  }

  // ── 무승부 (보드 축소 양측 전멸 또는 unreachable) ──
  if (draw) {
    document.getElementById('gameover-icon').textContent = '🤝';
    document.getElementById('gameover-title').textContent = '무승부';
    document.getElementById('gameover-title').style.color = 'var(--muted)';
    const drawMsg = (reason && reason.type === 'unreachable_draw')
      ? '게임을 끝낼 수 없어 무승부입니다.'
      : '보드 축소로 양 팀 모든 말이 전멸해 무승부입니다.';
    document.getElementById('gameover-sub').textContent = drawMsg;
    return;
  }

  const isSpec = spectator || S.isSpectator;
  const W = winnerName || opponentName || '?';
  const L = loserName || opponentName || '?';
  const vs = victimStr(r.victims);

  if (isSpec) {
    // ── 관전자 메시지 ──
    document.getElementById('gameover-icon').textContent = '👁';
    document.getElementById('gameover-title').textContent = '게임 종료';
    document.getElementById('gameover-title').style.color = 'var(--accent)';
    let sub = '';
    switch (r.type) {
      case 'surrender': sub = `${L}의 기권으로, ${W}의 승리입니다.`; break;
      case 'shrink': sub = `보드 축소로 ${L}의 말이 전멸해 ${W}의 승리`; break;
      case 'trap': sub = `덫으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
      case 'bomb': sub = `폭탄으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
      case 'sulfur': sub = `유황범람으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
      case 'nightmare': sub = `악몽으로 상대의 모든 말을 제거해 ${W}의 승리`; break;
      case 'attack': sub = `${W}의 승리`; break;
      default: sub = `${W}의 승리`;
    }
    document.getElementById('gameover-sub').textContent = sub;
  } else if (win) {
    // ── 승리 메시지 ──
    document.getElementById('gameover-icon').textContent = '🏆';
    document.getElementById('gameover-title').textContent = '승리';
    document.getElementById('gameover-title').style.color = 'var(--accent)';
    let sub = '';
    switch (r.type) {
      case 'surrender': sub = `${opponentName}의 기권입니다.`; break;
      case 'shrink': sub = `상대가 보드 축소를 피하지 못해 승리했습니다.`; break;
      case 'trap': sub = `덫으로 상대의 모든 말을 제거해 승리했습니다.`; break;
      case 'bomb': sub = `폭탄으로 상대의 모든 말을 제거해 승리했습니다.`; break;
      case 'sulfur': sub = `유황범람으로 상대의 모든 말을 제거해 승리했습니다.`; break;
      case 'nightmare': sub = `악몽으로 상대의 모든 말을 제거해 승리했습니다.`; break;
      case 'attack': sub = `${opponentName}의 모든 유닛을 제거해 승리했습니다.`; break;
      default: sub = `${opponentName}의 모든 유닛을 제거해 승리했습니다.`;
    }
    document.getElementById('gameover-sub').textContent = sub;
  } else {
    // ── 패배 메시지 ──
    // #15: 일반 패배는 해골 이모지 제거 + 상대 마지막 배치 그리드 노출.
    //      단, 기권·세팅 단계 이탈로 인한 패배는 그리드가 무의미하므로 기존대로 💀 유지.
    document.getElementById('gameover-icon').textContent = r.type === 'surrender' ? '💀' : '';
    document.getElementById('gameover-title').textContent = r.type === 'surrender' ? '기권' : '패배';
    document.getElementById('gameover-title').style.color = 'var(--danger)';
    let sub = '';
    switch (r.type) {
      case 'surrender': sub = `기권하여 패배했습니다.`; break;
      case 'shrink': sub = `보드 축소를 피하지 못해 패배하였습니다.`; break;
      case 'trap': sub = `덫으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'bomb': sub = `폭탄으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'sulfur': sub = `유황범람으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'nightmare': sub = `악몽으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'attack': sub = `${opponentName}에게 패배했습니다.`; break;
      default: sub = `${opponentName}에게 패배했습니다.`;
    }
    document.getElementById('gameover-sub').textContent = sub;
    // 상대 마지막 배치 그리드 렌더 (기권은 의미 없음 → 표시 안함)
    if (r.type !== 'surrender' && Array.isArray(replayWinnerPieces) && replayBounds) {
      try { renderDefeatReplayBoard(replayWinnerPieces, replayBoardObjects || [], replayBounds); } catch (e) {}
    }
  }
  }  // end runGameOverRender
});

// #15: 패배 화면 — 상대 마지막 배치 그리드 렌더 (인게임 보드와 동일한 셀 스타일·마크업)
function renderDefeatReplayBoard(winnerPieces, objects, bounds) {
  const wrap = document.getElementById('gameover-replay');
  const board = document.getElementById('gameover-replay-board');
  if (!wrap || !board) return;
  wrap.classList.remove('hidden');
  const total = (bounds.max - bounds.min + 1);
  const cellPx = 56;  // 인게임 .cell 과 동일 사이즈
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${total}, ${cellPx}px)`;
  board.style.gridTemplateRows = `repeat(${total}, ${cellPx}px)`;
  for (let r = 0; r < total; r++) {
    for (let c = 0; c < total; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const realCol = bounds.min + c;
      const realRow = bounds.min + r;
      cell.dataset.col = realCol;
      cell.dataset.row = realRow;
      const pcs = (winnerPieces || []).filter(p => p.alive && p.col === realCol && p.row === realRow);
      if (pcs.length > 0) {
        const pc = pcs[0];
        cell.classList.add('has-piece');
        // 인게임 piece-marker 와 동일 마크업
        cell.innerHTML = `<div class="piece-marker"><span class="p-icon">${pc.icon}</span><span class="p-hp">${pc.hp}</span></div>`;
      }
      const objHere = (objects || []).find(o => o.col === realCol && o.row === realRow);
      if (objHere) {
        if (objHere.type === 'trap') cell.classList.add('has-trap');
        else if (objHere.type === 'bomb') cell.classList.add('has-bomb');
        else if (objHere.type === 'rat') cell.classList.add('has-rat');
      }
      board.appendChild(cell);
    }
  }
}

// 게임오버 화면 전환 — instant=true면 즉시, 아니면 느린 페이드인 (1.5초)
function _showGameOverScreen(instant) {
  const scr = document.getElementById('screen-gameover');
  if (scr) {
    scr.classList.remove('fade-in', 'fade-in-slow');
    if (!instant) scr.classList.add('fade-in-slow');
    document.querySelectorAll('.screen').forEach(s => { if (s !== scr) s.classList.remove('active'); });
    scr.classList.add('active');
    if (!instant) setTimeout(() => scr.classList.remove('fade-in-slow'), 1550);
  }
  // 게임 종료 시 세션 토큰 정리
  try { sessionStorage.removeItem('caligo_session'); } catch (e) {}
}

// 현재 화면이 게임 중인지 (세팅 단계면 false)
function _isInGameScreen() {
  const active = document.querySelector('.screen.active')?.id;
  return active === 'screen-game';
}

socket.on('disconnected', ({ msg }) => {
  stopClientTimer();
  addLog(msg, 'system');
  // #8: 0.2초 대기 + 페이드인
  setTimeout(() => {
    _showGameOverScreen();
    document.getElementById('gameover-icon').textContent = '🔌';
    document.getElementById('gameover-title').textContent = '연결 끊김';
    document.getElementById('gameover-title').style.color = 'var(--muted)';
    document.getElementById('gameover-sub').textContent = msg;
  }, 200);
});

socket.on('err', ({ msg }) => {
  showError('placement-error', msg);
  showError('hp-error', msg);
  showError('draft-error', msg);
  addLog(`⚠ ${msg}`, 'system');
  // 사용자에게 즉시 피드백 — 어떤 화면에서든 토스트로 알림 (버튼이 응답 없이 멈춰있다는 오해 방지)
  try { showSkillToast(`⚠ ${msg}`, false, undefined, 'event'); } catch (e) {}
  // ── 응답 없이 버튼이 잠긴 채로 머무는 문제 방지 ──
  // 세팅/게임 단계의 '대기 중...' 버튼들을 자동 복구하여 재시도 가능하게 함
  const RECOVER_BTN_IDS = [
    'btn-draft-confirm', 'btn-draft-select', 'btn-draft-random', 'btn-draft-recommend',
    'btn-team-draft-confirm', 'btn-team-reveal-continue',
    'btn-hp-confirm',
    'btn-reveal-confirm', 'btn-irev-confirm', 'btn-frev-confirm',
    'btn-exchange-confirm',
    'btn-placement-confirm',
  ];
  for (const id of RECOVER_BTN_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.disabled && /대기 중/.test(el.textContent || '')) {
      el.disabled = false;
      // 원래 텍스트는 다음 렌더에서 복구되므로 임시 라벨만 정리
      el.textContent = '재시도';
    }
  }
});

socket.on('wait_msg', () => {
  // 의미: 세팅 단계에서 본인 확정 후 다른 플레이어 대기 (재접속/턴과 무관)
  // 사이드바의 n/4 진행도로 이미 충분히 표시됨 → UI는 변경하지 않음 (no-op)
});

// ═══════════════════════════════════════════════════════════════
// ── 드래프트 UI (단계별) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const TIER_INFO = {
  1: { label: '1티어', desc: '정찰과 견제 - 10명 중 1명을 선택하세요' },
  2: { label: '2티어', desc: '전략적 전투 - 10명 중 1명을 선택하세요' },
  3: { label: '3티어', desc: '핵심 전력 - 10명 중 1명을 선택하세요' },
};

/* ── 캐릭터 상세 설명 ── */
// ── 스킬 헤더 템플릿 헬퍼 ──────────────────────────────────────
// 스킬 이름 박스 = 스킬 유형 색상 (미니헤더와 동일 팔레트)
// 타입 텍스트 = 박스 없이 글자만
// tagCls: 'tag-action' | 'tag-once' | 'tag-free'  → 이름 박스 색도 여기에 맞춤
const TAG_TO_BLOCK_CLASS = {
  'tag-action':  'mini-header-action',   // 빨강
  'tag-once':    'mini-header-once',     // 노랑
  'tag-free':    'mini-header-free',     // 초록
  'tag-passive': 'mini-header-passive',  // 주황
};
const mkSkillHead = (name, tagCls, tagLabel) => ({
  head: name,
  headCls: TAG_TO_BLOCK_CLASS[tagCls] || '',
  tag: tagCls ? `<span class="skill-type-text ${tagCls}">${tagLabel}</span>` : '',
});
const mkPassiveHead = (name) => ({
  head: name,
  headCls: 'mini-header-passive',
  tag: `<span class="skill-type-text tag-passive">패시브</span>`,
});
// SP 텍스트 — 블록 오른쪽에 붙을 작은 라벨용
const spLabel = (sp) => {
  if (sp === 0 || sp === '0') return 'SP 소모 없음';
  if (sp == null) return '';
  return `SP ${sp} 소모`;
};
// 상태 태그 인라인 — 게임 중 사용되는 아이콘 포함
const STATUS_ICONS = { curse: '☠', shadow: '👻', mark: '🎯', morale: '📋' };
const stBadge = (cls, label) => {
  const icon = STATUS_ICONS[cls] || '';
  return `<span class="status-badge ${cls}">${icon ? icon + ' ' : ''}${label}</span>`;
};

const CHAR_DETAILS = {
  // ── 1티어 ──
  archer: {
    blocks: [
      { ...mkSkillHead('정비', 'tag-once', '자유시전·1회'), sp: 1, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 공격 범위의 대각선 방향을 영구적으로 좌우 반전시킵니다.',
    flavor: '어디서든 한 발의 화살로 심장을 꿰뚫는다. 유연한 사격술로 사방의 적도 손 쉽게 제압한다.',
  },
  spearman: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '긴 창을 앞세워 세로축을 완전히 차단한다. 왕실 근위대의 굳은 심지.',
  },
  cavalry: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '질주하는 말굽으로 전장을 횡단하며 인정사정 없이 적을 쓸어버린다.',
  },
  watchman: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '잠들지 않는 눈은 빈틈 없는 감시망으로 적의 접근을 허락하지 않는다.',
  },
  twins: {
    blocks: [
      { ...mkSkillHead('분신', 'tag-action', '행동소비형'), sp: 2, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 한쪽의 위치를 다른 쪽으로 합류시켜 업어옵니다.',
    flavor: '피로 이어진 남매. 그 핏줄이 두 남매가 어디에 있든지 서로를 강하게 끌어당긴다.',
  },
  scout: {
    blocks: [
      { ...mkSkillHead('정찰', 'tag-free', '자유시전형'), sp: 2, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 랜덤한 상대방 말 1개의 행 또는 열을 알아낼 수 있습니다.',
    flavor: '안개 너머 숨어있는 적의 정보를 수집한다. 정보는 칼보다 날카로운 법.',
  },
  manhunter: {
    blocks: [
      { ...mkSkillHead('덫 설치', 'tag-action', '행동소비형'), sp: 2, color: '#a78bfa' },
    ],
    body: '현재 위치에 덫 설치. 작동 시 2 피해.',
    flavor: '소리 없는 사냥꾼. 당하기 전까지는 아무도 그의 함정을 눈치챌 수 없다.',
  },
  messenger: {
    blocks: [
      { ...mkSkillHead('질주', 'tag-once', '자유시전·1회'), sp: 1, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 해당 턴에 전령은 이동을 2회 실행할 수 있습니다.',
    flavor: '바람보다 빠른 발놀림으로 전장의 누비며 적의 포위망을 빠져나가는 길앞잡이.',
  },
  gunpowder: {
    blocks: [
      { ...mkSkillHead('폭탄 설치', 'tag-free', '자유시전형'), sp: 2, color: '#a78bfa', desc: '스킬 사용 시 화약상의 주변 8칸 중 한 곳에 폭탄을 설치합니다.' },
      { ...mkSkillHead('기폭', 'tag-once', '자유시전·1회'), sp: 0, color: '#a78bfa', desc: '스킬 사용 시 보드 위에 설치한 폭탄을 전부 폭발시켜, 해당 칸에 위치한 모든 적에게 1 피해를 줍니다. 해당 스킬은 화약상이 사망할 때도 자동으로 발동됩니다.' },
    ],
    flavor: '불꽃의 시인. 첨예하게 계산된 폭발로 전장을 긴장시키는 위험한 예술가.',
  },
  herbalist: {
    blocks: [
      { ...mkSkillHead('약초학', 'tag-free', '자유시전형'), sp: 2, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 자신 주변 8칸 내에 위치한 모든 아군의 체력을 1 회복시킵니다. 약초전문가는 이 스킬로 스스로 회복할 수 없습니다.',
    flavor: '전장에서 피어나는 작은 희망. 그의 손끝이 스치면 곪은 상처도 아문다.',
  },
  // ── 2티어 ──
  general: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '전장의 기둥. 그가 자리를 지키면 사방 어느 방향의 적도 두렵지 않다.',
  },
  knight: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '기사도 정신으로 대각선의 모든 적을 베어내며 진격한다.',
  },
  shadowAssassin: {
    blocks: [
      { ...mkSkillHead('그림자 숨기', 'tag-once', '자유시전·1회'), sp: 1, color: '#a78bfa' },
    ],
    body: `스킬 사용 시 ${stBadge('shadow', '그림자')} 상태가 되어 다음 턴까지 공격과 상태 이상에 완전 면역이 됩니다.`,
    flavor: '어둠을 입고 움직이는 자. 그가 기척을 숨겨 접근해오면 막을 방법은 없다.',
  },
  wizard: {
    blocks: [
      { ...mkPassiveHead('인스턴트 매직'), color: '#f59e0b' },
    ],
    body: '피격 시 1회용 SP 1개 획득',
    flavor: '신체가 마력으로 이루어진 신비의 존재. 그의 몸은 기꺼이 전우의 연료가 된다.',
  },
  armoredWarrior: {
    blocks: [
      { ...mkPassiveHead('아이언 스킨'), color: '#f59e0b' },
    ],
    body: '갑주무사가 받는 모든 공격 피해는 항상 0.5 씩 감소합니다. 하지만 상태 이상으로 받는 피해는 감소되지 않습니다.',
    flavor: '움직이는 요새. 두꺼운 갑주 앞에선 그 어떤 공격도 의지가 꺾여 버린다.',
  },
  witch: {
    blocks: [
      { ...mkSkillHead('저주', 'tag-action', '행동소비형'), sp: 3, color: '#a78bfa' },
    ],
    body: `스킬 사용 시 체력이 1 이상인 적 한 명을 선택해 ${stBadge('curse', '저주')} 상태로 만듭니다. 저주 상태의 적은 차례마다 0.5 피해를 받으며 스킬을 사용할 수 없게 됩니다. 저주는 마녀가 죽거나, 저주 상태의 캐릭터 체력이 1 이하가 되면 즉시 해제됩니다.`,
    flavor: '죽음의 속삭임으로 적의 목숨을 서서히 앗아가는 수상한 여인.',
  },
  dualBlade: {
    blocks: [
      { ...mkSkillHead('쌍검무', 'tag-once', '자유시전·1회'), sp: 2, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 해당 턴에 양손 검객은 공격을 2회 실행할 수 있습니다.',
    flavor: '양손에 쥔 검이 춤을 추면 두 번의 죽음을 선사한다.',
  },
  ratMerchant: {
    blocks: [
      { ...mkSkillHead('역병의 자손들', 'tag-free', '자유시전형'), sp: 2, color: '#a78bfa' },
    ],
    body: '스킬 사용시 보드 위 쥐가 없는 타일 세 곳에 쥐를 소환합니다. 쥐가 있는 칸은 쥐 장수의 공격 범위에 포함됩니다. 쥐는 적에게 공격 받으면 즉시 사라집니다.',
    flavor: '쥐떼를 거느리는 어둠의 왕. 그의 휘파람 한번에 역병이 퍼져나간다.',
  },
  weaponSmith: {
    blocks: [
      { ...mkSkillHead('정비', 'tag-once', '자유시전·1회'), sp: 1, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 가로에서 세로로, 혹은 세로에서 가로로 공격 방향을 영구적으로 전환합니다.',
    flavor: '갖가지 무기를 들고 참전한 유능한 용사. 대부분의 무기는 그가 직접 만들었다.',
  },
  bodyguard: {
    blocks: [
      { ...mkPassiveHead('충성'), color: '#f59e0b' },
    ],
    body: '호위 무사는 다른 왕실 아군이 받을 공격 피해를 1로 줄이고, 그 피해를 모두 대신 받습니다. 다른 왕실 아군이 받게 될 상태 이상 또한 호위 무사가 대신 받습니다.',
    flavor: '왕실의 믿을 수 있는 방패. 그의 존재만으로 왕가는 안전하다.',
  },
  // ── 3티어 ──
  prince: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '왕실의 적법한 후계자. 젊은 패기로 날선 검을 휘두르며 왕좌의 수호한다.',
  },
  princess: {
    blocks: [ { head: '스킬 없음', color: '#6b7280' } ],
    flavor: '왕실의 적법한 후계자. 수년간 연마한 왕실의 호신술로 왕좌를 수호한다.',
  },
  king: {
    blocks: [
      { ...mkSkillHead('절대복종 반지', 'tag-free', '자유시전형'), sp: 3, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 적 한 명을 선택하고 위치를 지정하면, 그 적을 해당 위치로 강제 이동시킵니다.',
    flavor: '왕좌에 앉은 자. 그의 명령은 곧 신의 뜻처럼 거역할 수 없다.',
  },
  dragonTamer: {
    blocks: [
      { ...mkSkillHead('드래곤 소환', 'tag-once', '자유시전·1회'), sp: 5, color: '#a78bfa' },
    ],
    body: '스킬 사용시 강력한 드래곤 유닛을 원하는 위치에 소환합니다. 보드 위 드래곤은 최대 1마리까지만 소환 가능합니다.',
    flavor: '고대의 계약으로 잠든 용을 깨우는 자. 그의 부름에 하늘이 진동한다.',
  },
  monk: {
    blocks: [
      { ...mkPassiveHead('가호'), color: '#f59e0b', desc: '악인 적을 공격할 때 공격력이 3으로 증가하며, 악인에게 받는 모든 공격 피해는 0.5로 감소합니다.' },
      { ...mkSkillHead('신성', 'tag-free', '자유시전형'), sp: 3, color: '#a78bfa', desc: '스킬 사용 시 아군 1명을 선택합니다. 해당 아군의 체력을 2 회복시키고 상태 이상을 제거합니다. 수도승은 이 스킬로 스스로 회복할 수 없습니다.' },
    ],
    flavor: '신의 뜻을 전하는 자. 악을 응징하고 선한 자를 치유하는 성스러운 손길.',
  },
  slaughterHero: {
    blocks: [
      { ...mkPassiveHead('배반자'), color: '#f59e0b' },
    ],
    body: '학살 영웅은 공격 시 아군에게도 피해를 입힙니다.',
    flavor: '한때 영웅이라 불렸던 자. 피에 취한 그의 도끼는 적과 아군을 구분하지 못한다.',
  },
  commander: {
    blocks: [
      { ...mkPassiveHead('사기증진'), color: '#f59e0b' },
    ],
    body: `지휘관과 인접한 아군은 ${stBadge('morale', '사기증진')} 상태가 됩니다. 사기증진 상태의 모든 아군은 공격력이 1 상승합니다.`,
    flavor: '왕실 전투력의 핵심. 그의 함성 한 마디면 병사들의 칼 끝은 더욱 무거워진다.',
  },
  sulfurCauldron: {
    blocks: [
      { ...mkSkillHead('유황범람', 'tag-action', '행동소비형'), sp: 3, color: '#a78bfa' },
    ],
    body: '스킬 사용 시 현재 보드의 테두리 전체에 피해 2의 대규모 공격을 가합니다.',
    flavor: '끓어오르는 지옥의 용암. 뚜껑이 열리는 순간 전장은 불바다로 변한다.',
  },
  torturer: {
    blocks: [
      { ...mkPassiveHead('표식'), color: '#f59e0b', desc: `고문 기술자는 공격한 대상에게 표식을 부여합니다. ${stBadge('mark', '표식')} 상태의 적은 위치가 항상 노출됩니다.` },
      { ...mkSkillHead('악몽', 'tag-free', '자유시전형'), sp: 2, color: '#a78bfa', desc: `${stBadge('mark', '표식')} 상태의 모든 적에게 1 피해를 줍니다.` },
    ],
    flavor: '표식을 남기는 인두와 채찍. 한 번 그의 눈에 띈 자는 끝없는 악몽에서 벗어날 수 없다.',
  },
  count: {
    blocks: [
      { ...mkPassiveHead('폭정'), color: '#f59e0b' },
    ],
    body: '백작은 1티어와 2티어 유닛에게 받는 모든 피해가 0.5 감소합니다.',
    flavor: '피와 공포로 군림하는 영주. 그 존재 앞에 굴종자들은 한낱 미물일 뿐이다.',
  },
};

// ══════════════════════════════════════════════════════════════════
// ── 캐릭터 스탯 그래프 (오각형 레이더) ─────────────────────────
// ══════════════════════════════════════════════════════════════════
// 5개 축 (1~5): 공격(ATK) / 견제(PRS) / 생존(DUR) / 지원(UTL) / 기동(MOB)
const CHAR_STATS = {
  // 1티어
  archer:        { atk: 4, prs: 2, dur: 2, utl: 3, mob: 2 },
  spearman:      { atk: 4, prs: 3, dur: 2, utl: 1, mob: 2 },
  cavalry:       { atk: 4, prs: 3, dur: 2, utl: 1, mob: 2 },
  watchman:      { atk: 1, prs: 2, dur: 2, utl: 5, mob: 2 },
  twins:         { atk: 3, prs: 3, dur: 3, utl: 2, mob: 5 },
  scout:         { atk: 3, prs: 2, dur: 2, utl: 5, mob: 2 },
  manhunter:     { atk: 3, prs: 5, dur: 2, utl: 2, mob: 2 },
  messenger:     { atk: 1, prs: 1, dur: 2, utl: 3, mob: 5 },
  gunpowder:     { atk: 3, prs: 5, dur: 2, utl: 3, mob: 2 },
  herbalist:     { atk: 2, prs: 1, dur: 4, utl: 5, mob: 2 },
  // 2티어
  general:       { atk: 5, prs: 3, dur: 3, utl: 1, mob: 2 },
  knight:        { atk: 5, prs: 3, dur: 3, utl: 1, mob: 2 },
  shadowAssassin:{ atk: 4, prs: 3, dur: 5, utl: 2, mob: 3 },
  wizard:        { atk: 4, prs: 4, dur: 2, utl: 4, mob: 2 },
  armoredWarrior:{ atk: 3, prs: 2, dur: 5, utl: 1, mob: 2 },
  witch:         { atk: 3, prs: 5, dur: 2, utl: 3, mob: 2 },
  dualBlade:     { atk: 5, prs: 3, dur: 2, utl: 2, mob: 3 },
  ratMerchant:   { atk: 3, prs: 4, dur: 3, utl: 4, mob: 2 },
  weaponSmith:   { atk: 4, prs: 3, dur: 2, utl: 3, mob: 2 },
  bodyguard:     { atk: 2, prs: 2, dur: 4, utl: 5, mob: 2 },
  // 3티어
  prince:        { atk: 5, prs: 3, dur: 4, utl: 1, mob: 2 },
  princess:      { atk: 5, prs: 3, dur: 4, utl: 1, mob: 2 },
  king:          { atk: 2, prs: 5, dur: 3, utl: 5, mob: 2 },
  dragonTamer:   { atk: 4, prs: 5, dur: 3, utl: 4, mob: 3 },
  monk:          { atk: 1, prs: 1, dur: 4, utl: 5, mob: 2 },
  slaughterHero: { atk: 5, prs: 4, dur: 4, utl: 1, mob: 2 },
  commander:     { atk: 3, prs: 2, dur: 3, utl: 5, mob: 2 },
  sulfurCauldron:{ atk: 1, prs: 5, dur: 3, utl: 3, mob: 1 },
  torturer:      { atk: 4, prs: 5, dur: 3, utl: 3, mob: 2 },
  count:         { atk: 4, prs: 3, dur: 5, utl: 2, mob: 2 },
};

// 오각형 레이더 SVG 생성 — 5축, 값 1~5
function buildStatRadarSVG(stats) {
  if (!stats) return '';
  const W = 170, H = 116;          // 슬라이드 좌측 컬럼 빈 공간에 들어가는 크기
  const cx = W / 2, cy = H / 2 + 2;
  const R = 44;                     // 최대 반경
  // 축 정의: top → top-right → bottom-right → bottom-left → top-left (시계방향)
  const axes = [
    { key: 'atk', label: '공격', angle: -Math.PI/2 },
    { key: 'prs', label: '견제', angle: -Math.PI/2 + (2*Math.PI*1/5) },
    { key: 'dur', label: '생존', angle: -Math.PI/2 + (2*Math.PI*2/5) },
    { key: 'utl', label: '지원', angle: -Math.PI/2 + (2*Math.PI*3/5) },
    { key: 'mob', label: '기동', angle: -Math.PI/2 + (2*Math.PI*4/5) },
  ];
  const point = (axis, val) => {
    const r = R * (val / 5);
    return [cx + r*Math.cos(axis.angle), cy + r*Math.sin(axis.angle)];
  };
  // 배경 격자 (1~5단계)
  let grid = '';
  for (let lv = 1; lv <= 5; lv++) {
    const pts = axes.map(a => {
      const r = R * (lv / 5);
      return [cx + r*Math.cos(a.angle), cy + r*Math.sin(a.angle)];
    });
    const d = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const op = lv === 5 ? 0.35 : 0.15;
    grid += `<polygon points="${d}" fill="none" stroke="#94a3b8" stroke-opacity="${op}" stroke-width="1"/>`;
  }
  // 축선
  let spokes = '';
  axes.forEach(a => {
    const [ex, ey] = [cx + R*Math.cos(a.angle), cy + R*Math.sin(a.angle)];
    spokes += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#94a3b8" stroke-opacity="0.18" stroke-width="1"/>`;
  });
  // 데이터 폴리곤
  const dataPts = axes.map(a => point(a, stats[a.key] || 0));
  const dataD = dataPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  // 라벨
  let labels = '';
  axes.forEach(a => {
    const labelR = R + 12;
    const lx = cx + labelR*Math.cos(a.angle);
    const ly = cy + labelR*Math.sin(a.angle);
    const anchor = Math.abs(Math.cos(a.angle)) < 0.2 ? 'middle' : (Math.cos(a.angle) > 0 ? 'start' : 'end');
    labels += `<text x="${lx.toFixed(1)}" y="${(ly+3).toFixed(1)}" font-size="9" fill="#cbd5e1" text-anchor="${anchor}" font-weight="700">${a.label}</text>`;
  });
  return `<svg class="stat-radar-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${grid}${spokes}
    <polygon points="${dataD}" fill="rgba(226,168,75,0.28)" stroke="#e2a84b" stroke-width="1.6" stroke-linejoin="round"/>
    ${dataPts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="#e2a84b"/>`).join('')}
    ${labels}
  </svg>`;
}

function renderStatRadar(charType, container) {
  if (!container) return;
  const stats = CHAR_STATS[charType];
  if (!stats) { container.innerHTML = ''; return; }
  container.innerHTML = buildStatRadarSVG(stats);
}

/* ── 슬라이드 인덱스 ── */
let slideIndex = 0;

function buildDraftStepUI() {
  const step = S.draftStep;

  // 스텝 인디케이터 업데이트 (클릭 가능)
  const steps = document.querySelectorAll('#draft-step-indicator .step');
  steps.forEach((el, i) => {
    const tierNum = i + 1;
    el.className = 'step clickable';
    if (S.draftSelected[tierNum]) el.classList.add('done');
    if (tierNum === step) el.classList.add('active');
    // 클릭 이벤트 (매번 새로 바인딩하기 위해 clone)
    const newEl = el.cloneNode(true);
    newEl.addEventListener('click', () => {
      S.draftStep = tierNum;
      buildDraftStepUI();
    });
    el.parentNode.replaceChild(newEl, el);
  });

  const chars = S.characters[step];
  if (!chars) return;

  // 아이콘 인덱스 생성
  const iconIndex = document.getElementById('draft-icon-index');
  if (iconIndex) {
    const DARK_ICONS = new Set(['👁','🎖','🗡','🛡','⚔','⚒','♛','⛓']);
    iconIndex.innerHTML = '';
    chars.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'icon-index-btn';
      btn.title = c.name;
      const darkCls = DARK_ICONS.has(c.icon) ? ' dark-icon' : '';
      btn.innerHTML = `<span class="icon-index-emoji${darkCls}">${c.icon}</span>`;
      btn.addEventListener('click', () => goToSlide(i));
      iconIndex.appendChild(btn);
    });
  }

  // 미리보기 보드 생성
  buildBoard('draft-preview-board', () => {});

  // 페이저 도트 숨김 (아이콘 인덱스로 대체)
  const pager = document.getElementById('slide-pager');
  if (pager) pager.innerHTML = '';

  // 이전 선택이 있으면 해당 슬라이드로, 아니면 첫 슬라이드
  const prevSelected = S.draftSelected[step];
  if (prevSelected) {
    const idx = chars.findIndex(c => c.type === prevSelected);
    slideIndex = idx >= 0 ? idx : 0;
  } else {
    slideIndex = 0;
  }
  renderSlide();
  updateDraftConfirmBtn();
}

// 캐릭터 슬라이드 콘텐츠 렌더 — 드래프트(=내 덱)와 캐릭터 딕셔너리가 공유.
//   prefix: 'slide' (드래프트) 또는 'dict-slide' (딕셔너리)
//   이전에는 두 함수가 동일 로직을 별도 복제로 유지해 typeof 가드 추가/누락 등
//   미세한 가공 차이가 발생했음. 단일 헬퍼로 통합되어 모든 변경이 자동 동기화됨.
function populateSlideContent(c, prefix) {
  // 아이콘 / 이름 + 태그 / ATK / 미니 헤더
  const iconEl = document.getElementById(`${prefix}-icon`);
  if (iconEl) iconEl.textContent = c.icon;
  const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
  const nameEl = document.getElementById(`${prefix}-name`);
  if (nameEl) nameEl.innerHTML = `<span>${c.name}</span>${tagHtml}`;
  const atkEl = document.getElementById(`${prefix}-atk`);
  if (atkEl) atkEl.innerHTML = `⚔ 공격력 ${c.atk}`;
  const miniEl = document.getElementById(`${prefix}-mini-headers`);
  if (miniEl) miniEl.innerHTML = buildMiniHeaders(c);
  // 사용하지 않는 desc 영역은 항상 숨김
  const descEl = document.getElementById(`${prefix}-desc`);
  if (descEl) { descEl.innerHTML = ''; descEl.classList.add('hidden'); }

  // 상세 설명 블록 + 플레이버 + 레이더
  const detail = CHAR_DETAILS[c.type];
  const flavorEl = document.getElementById(`${prefix}-flavor`);
  if (flavorEl) flavorEl.textContent = (detail && detail.flavor) ? detail.flavor : '';
  const radarEl = document.getElementById(`${prefix}-stat-radar`);
  if (radarEl) renderStatRadar(c.type, radarEl);

  const blocksEl = document.getElementById(`${prefix}-detail-blocks`);
  const bodyEl = document.getElementById(`${prefix}-detail-body`);
  if (!blocksEl || !bodyEl) return;
  if (detail) {
    const hasPerBlockDesc = detail.blocks.some(b => b.desc);
    const renderHeadLine = (b) => {
      const cls = b.headCls || '';
      const name = cls
        ? `<span class="slide-skill-name ${cls}">${b.head}</span>`
        : `<span class="slide-skill-name slide-skill-none">${b.head}</span>`;
      const tag = b.tag || '';
      const sp = (b.sp != null) ? `<span class="slide-sp-box">${spLabel(b.sp)}</span>` : '';
      return `<div class="slide-head-line">${name}${tag}${sp}</div>`;
    };
    if (hasPerBlockDesc) {
      blocksEl.innerHTML = detail.blocks.map(b => {
        return `<div style="margin-bottom:10px">` +
          renderHeadLine(b) +
          (b.desc ? `<div class="slide-detail-body" style="margin-top:4px">${b.desc}</div>` : '') +
          `</div>`;
      }).join('');
      bodyEl.textContent = '';
    } else {
      blocksEl.innerHTML = detail.blocks.map(renderHeadLine).join('');
      bodyEl.innerHTML = detail.body || '';
    }
  } else {
    blocksEl.innerHTML = '';
    bodyEl.innerHTML = '';
  }
}

function renderSlide() {
  const step = S.draftStep;
  const chars = S.characters[step];
  if (!chars || !chars.length) return;
  const c = chars[slideIndex];
  // 슬라이드 변경 시 항상 공격 범위 보기로 초기화
  slidePreviewMode = 'attack';

  // 공유 헬퍼 — 아이콘/이름/ATK/미니헤더/플레이버/레이더/상세블록 일괄 갱신
  populateSlideContent(c, 'slide');
  // 실제 오버플로 감지 — 내용이 좌측 컬럼을 넘치면만 살짝 축소 (드래프트 화면 한정)
  const leftCol = document.querySelector('#screen-draft .slide-left-col');
  if (leftCol) autoFitLeftCol(leftCol);

  // 공격 범위 미리보기
  updateDraftPreview(c);

  // 아이콘 인덱스 활성 상태 업데이트
  document.querySelectorAll('.icon-index-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === slideIndex);
  });

  // 캐릭터 선택 버튼 상태 업데이트
  const selectBtn = document.getElementById('btn-draft-select');
  if (selectBtn) {
    let isAlreadySelected, teamLocked;
    if (S.teamDraftMode) {
      const tmPicks = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
      teamLocked = tmPicks.includes(c.type);
      isAlreadySelected = S.teamDraft?.pick1 === c.type || S.teamDraft?.pick2 === c.type;
    } else {
      teamLocked = false;
      isAlreadySelected = S.draftSelected[step] === c.type;
    }
    if (teamLocked) {
      selectBtn.textContent = '🔒 팀원이 선택함';
      selectBtn.className = 'btn btn-muted btn-select-char';
      selectBtn.disabled = true;
    } else if (isAlreadySelected) {
      selectBtn.textContent = '✔ 선택됨';
      selectBtn.className = 'btn btn-select-char btn-current-select';
      selectBtn.disabled = false;
    } else {
      selectBtn.textContent = '캐릭터 선택';
      selectBtn.className = 'btn btn-accent btn-select-char';
      selectBtn.disabled = false;
    }
  }
  // 팀 모드: 팀원이 선택한 캐릭터 슬라이드 흐림 + 오버레이 라벨
  const slideViewer = document.querySelector('#screen-draft .slide-viewer');
  if (slideViewer) {
    const tmPicks2 = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
    const thisLocked = S.teamDraftMode && tmPicks2.includes(c.type);
    slideViewer.classList.toggle('team-dimmed', !!thisLocked);
    // 오버레이 배지
    let badge = slideViewer.querySelector('.team-dim-overlay');
    if (thisLocked) {
      const tm = S.teamPlayers?.find(p => p.idx !== S.playerIdx && p.teamId === S.teamId);
      const tmName = tm ? tm.name : '팀원';
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'team-dim-overlay';
        slideViewer.appendChild(badge);
      }
      badge.innerHTML = `<span class="team-dim-label">🔒 <strong>${escapeHtmlGlobal(tmName)}</strong> 선택함</span>`;
    } else if (badge) {
      badge.remove();
    }
  }
  updateDraftConfirmBtn();
  // 관전자 브라우징은 1v1에서만
  if (!S.teamDraftMode) {
    socket.emit('draft_browse', { step, type: c.type, selected: { ...S.draftSelected } });
  }

  // 스텝 인디케이터 done 상태 갱신
  document.querySelectorAll('#draft-step-indicator .step').forEach((el, i) => {
    const tierNum = i + 1;
    el.classList.toggle('done', !!S.draftSelected[tierNum]);
  });

  // 슬라이드 진입 애니메이션
  const content = document.querySelector('.slide-content');
  content.style.animation = 'none';
  content.offsetHeight; // reflow
  content.style.animation = '';
}

function goToSlide(idx) {
  const chars = S.characters[S.draftStep];
  if (!chars) return;
  slideIndex = ((idx % chars.length) + chars.length) % chars.length;
  renderSlide();
}

document.getElementById('btn-slide-prev').addEventListener('click', () => goToSlide(slideIndex - 1));
document.getElementById('btn-slide-next').addEventListener('click', () => goToSlide(slideIndex + 1));

// 캐릭터 선택 버튼
// 드래프트 — 선택 상태만 부분 업데이트 (캐릭터 슬라이드 콘텐츠는 그대로)
function draftUpdateSelectionState() {
  const step = S.draftStep;
  const chars = S.characters?.[step];
  if (!chars || !chars[slideIndex]) return;
  const c = chars[slideIndex];

  // 1) 선택 버튼 라벨/클래스
  const selectBtn = document.getElementById('btn-draft-select');
  if (selectBtn) {
    let isAlreadySelected, teamLocked;
    if (S.teamDraftMode) {
      const tmPicks = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
      teamLocked = tmPicks.includes(c.type);
      isAlreadySelected = S.teamDraft?.pick1 === c.type || S.teamDraft?.pick2 === c.type;
    } else {
      teamLocked = false;
      isAlreadySelected = S.draftSelected[step] === c.type;
    }
    if (teamLocked) {
      selectBtn.textContent = '🔒 팀원이 선택함';
      selectBtn.className = 'btn btn-muted btn-select-char';
      selectBtn.disabled = true;
    } else if (isAlreadySelected) {
      selectBtn.textContent = '✔ 선택됨';
      selectBtn.className = 'btn btn-select-char btn-current-select';
      selectBtn.disabled = false;
    } else {
      selectBtn.textContent = '캐릭터 선택';
      selectBtn.className = 'btn btn-accent btn-select-char';
      selectBtn.disabled = false;
    }
  }

  // 2) 팀 드래프트 슬라이드 잠금 표시 (팀원이 같은 캐릭터 픽 시)
  const slideViewer = document.querySelector('#screen-draft .slide-viewer');
  if (slideViewer && S.teamDraftMode) {
    const tmPicks2 = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
    const thisLocked = tmPicks2.includes(c.type);
    slideViewer.classList.toggle('team-dimmed', !!thisLocked);
  }

  // 3) 슬롯·확정 버튼 갱신 (가벼운 작업)
  if (typeof renderTeamDraftSlots === 'function' && S.teamDraftMode) renderTeamDraftSlots();
  if (typeof updateDraftConfirmBtn === 'function') updateDraftConfirmBtn();
}

document.getElementById('btn-draft-select').addEventListener('click', () => {
  const step = S.draftStep;
  const chars = S.characters[step];
  if (!chars || !chars[slideIndex]) return;
  const c = chars[slideIndex];

  // ── 팀 드래프트 모드: 2픽 슬롯 방식 ──
  if (S.teamDraftMode) {
    // 팀원 픽 차단
    const tmPicks = [S.teamTeammatePicks?.pick1, S.teamTeammatePicks?.pick2].filter(Boolean);
    if (tmPicks.includes(c.type)) {
      showSkillToast('팀원이 이미 선택한 캐릭터입니다.', false, undefined, 'event');
      return;
    }
    // 이미 내 슬롯에 있으면 해제
    if (S.teamDraft.pick1 === c.type) {
      S.teamDraft.pick1 = null;
      socket.emit('team_draft_pick', { slot: 'pick1', type: null });
      draftUpdateSelectionState();
      return;
    }
    if (S.teamDraft.pick2 === c.type) {
      S.teamDraft.pick2 = null;
      socket.emit('team_draft_pick', { slot: 'pick2', type: null });
      draftUpdateSelectionState();
      return;
    }
    // 빈 슬롯에 할당
    const slot = !S.teamDraft.pick1 ? 'pick1' : !S.teamDraft.pick2 ? 'pick2' : null;
    if (!slot) {
      showSkillToast('슬롯이 모두 찼습니다.', false, undefined, 'event');
      return;
    }
    S.teamDraft[slot] = c.type;
    socket.emit('team_draft_pick', { slot, type: c.type });
    playSfxCharSelect();
    showSkillToast(`${c.icon} ${c.name} 선택 완료`, false, undefined, 'event');
    draftUpdateSelectionState();
    return;
  }

  // ── 1v1 모드 ──
  const isDuplicate = S.draftSelected[step] === c.type;
  S.draftSelected[step] = c.type;
  if (S.deckBuilderMode) S.deckSaved = false;
  // 슬라이드 콘텐츠는 그대로 — 선택 상태만 부분 업데이트
  draftUpdateSelectionState();
  socket.emit('draft_browse', { step, type: c.type, selected: { ...S.draftSelected } });
  if (!isDuplicate) {
    playSfxCharSelect();
    showSkillToast(`${c.icon} ${c.name} 선택 완료`, false, undefined, 'event');
  }
});

// 키보드 좌우 화살표로도 슬라이드 이동
document.addEventListener('keydown', (e) => {
  const draft = document.getElementById('screen-draft');
  if (!draft || !draft.classList.contains('active')) return;
  if (e.key === 'ArrowLeft') goToSlide(slideIndex - 1);
  if (e.key === 'ArrowRight') goToSlide(slideIndex + 1);
});

// 스킬별 미리보기 범위 데이터 — 중앙(2,2) 기준
// category: 'heal' | 'attack' | 'target' | 'dragon'
const SKILL_PREVIEW = {
  // ── 공격류 (주황) ──
  archer:        { cells: archerReversedCells, cat: 'attack', label: '공격 범위 영구 반전' },
  weaponSmith:   { cells: armorerToggledCells, cat: 'attack', label: '공격 범위 영구 전환' },
  ratMerchant:   { cells: ratLordRandomCells,  cat: 'attack', label: '보드 위 랜덤 위치 쥐 소환', randomEachClick: true, showRats: true },
  manhunter:     { cells: selfOnly,            cat: 'place',  label: '덫 설치 가능 지역' },
  gunpowder:     { cells: surrounding8WithSelf,cat: 'place',  label: '폭탄 설치 가능 지역' },
  sulfurCauldron:{ cells: boardEdge,           cat: 'attack', label: '유황범람 공격 범위' },
  // 드래곤 조련사: 드래곤만 중앙(조련사 사라짐) + 십자 5칸
  dragonTamer:   { cells: dragonOnlyCrossCells,cat: 'attack', label: '체력 3 / 공격력 3의 드래곤 소환', showDragonOnly: true },

  // ── 회복/버프류 (연한 초록) ──
  herbalist:     { cells: surrounding8,        cat: 'heal',   label: '약초학 회복 범위' },
  commander:     { cells: commanderBuffCells,  cat: 'heal',   label: '사기증진 부여 범위' },

  // ── 합류 (쌍둥이 전용 합체) ──
  twins:         { cells: twinJoinedCells,     cat: 'attack', label: '누나와 동생의 위치 합류', joinedTwins: true },
};
// 궁수 — 반전된 대각선(/ 방향). 기본은 \ 방향이라 / 만 표시.
function archerReversedCells(cc, cr) {
  const out = [];
  const d = cc - cr;
  for (let c = 0; c < 5; c++) { const r = c - d; if (r >= 0 && r < 5) out.push({ col: c, row: r }); }
  return out;
}
// 무기상 — 전환된 세로 3칸(자기+위아래)
function armorerToggledCells(cc, cr) {
  const out = [{ col: cc, row: cr }];
  if (cr - 1 >= 0) out.push({ col: cc, row: cr - 1 });
  if (cr + 1 < 5) out.push({ col: cc, row: cr + 1 });
  return out;
}
// 쥐 장수 — 클릭마다 랜덤 3칸 + 본체 위치
function ratLordRandomCells(cc, cr) {
  const all = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    if (c === cc && r === cr) continue;
    all.push({ col: c, row: r });
  }
  // Fisher–Yates shuffle, take 3
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return [{ col: cc, row: cr }, ...all.slice(0, 3)];
}
// 드래곤 조련사 — 드래곤만 중앙(2,2) + 드래곤 십자 5칸
function dragonOnlyCrossCells(cc, cr) {
  const out = [{ col: cc, row: cr }];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const c = cc + dc, r = cr + dr;
    if (c >= 0 && c < 5 && r >= 0 && r < 5) out.push({ col: c, row: r });
  }
  return out;
}
// 지휘관 — 사기증진 4방향 인접(자기 제외)
function commanderBuffCells(cc, cr) {
  const out = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const c = cc + dc, r = cr + dr;
    if (c >= 0 && c < 5 && r >= 0 && r < 5) out.push({ col: c, row: r });
  }
  return out;
}
// 쌍둥이 합류 — 합체 시 자기+상하좌우 (가로3+세로3 합집합)
function twinJoinedCells(cc, cr) {
  const out = [{ col: cc, row: cr }];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const c = cc + dc, r = cr + dr;
    if (c >= 0 && c < 5 && r >= 0 && r < 5) out.push({ col: c, row: r });
  }
  return out;
}
function surrounding8(cc, cr) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const c = cc + dc, r = cr + dr;
    if (c >= 0 && c < 5 && r >= 0 && r < 5) out.push({ col: c, row: r });
  }
  return out;
}
function surrounding8WithSelf(cc, cr) {
  return [...surrounding8(cc, cr), { col: cc, row: cr }];
}
function selfOnly(cc, cr) { return [{ col: cc, row: cr }]; }
function boardEdge() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push({ col: i, row: 0 });
    out.push({ col: i, row: 4 });
    if (i > 0 && i < 4) {
      out.push({ col: 0, row: i });
      out.push({ col: 4, row: i });
    }
  }
  return out;
}
// 드래곤의 공격 범위: 자신 포함 십자 5칸 (드래곤 아이콘은 중앙이 아닌 인접 위치에 소환)
function dragonCrossCells(cc, cr) {
  // 소환된 드래곤이 조련사 옆 (cc+1, cr) 가정 — 드래곤 기준 십자 5칸
  const dc = cc + 1, dr = cr;
  const out = [{ col: dc, row: dr }];
  for (const [ddc, ddr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const c = dc + ddc, r = dr + ddr;
    if (c >= 0 && c < 5 && r >= 0 && r < 5) out.push({ col: c, row: r });
  }
  return out;
}
function allCells() {
  const out = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) out.push({ col: c, row: r });
  return out;
}

function hasSkillPreview(charData) {
  if (!charData || !charData.type) return false;
  return !!SKILL_PREVIEW[charData.type];
}

// 슬라이드 미리보기 모드 — 'attack' | 'skill'
let slidePreviewMode = 'attack';
// 탭 클릭 바인딩 (최초 1회) — 드래프트 슬라이더 안의 탭만. exchange 쪽은 별도 핸들러에서 처리.
document.querySelectorAll('.slide-preview-tab').forEach(tab => {
  if (tab.closest('.ex-preview-tabs')) return;  // 교환 탭은 건너뜀 — 별도 핸들러
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    slidePreviewMode = tab.dataset.mode;
    // 그리드만 부분 갱신 (다른 정보는 그대로)
    const step = S.draftStep;
    if (S.characters && S.characters[step]) {
      const chars = S.characters[step];
      const c = chars[slideIndex];
      if (c) updateDraftPreview(c);
    }
  });
});

// 캐릭터 미리보기 그리드 렌더링 — 드래프트/내 덱/캐릭터 딕셔너리 공통.
//   opts.boardEl    : 5×5 미리보기 보드 DOM (default: #draft-preview-board)
//   opts.infoEl     : 보드 아래 안내 텍스트 DOM (default: #draft-preview-info)
//   opts.tabsRoot   : 모드 탭 컨테이너 (default: document) — 딕셔너리는 overlay 내부로 한정
//   opts.tabAttr    : 모드 data 속성 ('mode' or 'dict-mode'; default: 'mode')
//   opts.mode       : 현재 미리보기 모드 ('attack' | 'skill'; default: slidePreviewMode)
// 이전에는 updateDictPreview 가 별도 복제로 존재해 쌍둥이 분리·색 분기·shouldShowDesc 처리가 일치하지 않았음.
//   이제 단일 구현으로 통합되어 미래 변경이 양쪽에 자동 반영됨.
function updateDraftPreview(charData, opts = {}) {
  const board = opts.boardEl || document.getElementById('draft-preview-board');
  if (!board) return;
  const infoEl = opts.infoEl || document.getElementById('draft-preview-info');
  const tabsRoot = opts.tabsRoot || document;
  const tabAttr = opts.tabAttr || 'mode';
  // dataset 키는 camelCase ('mode' / 'dictMode')
  const datasetKey = tabAttr.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  const mode = opts.mode || slidePreviewMode;

  // 탭 상태 업데이트
  const tabs = tabsRoot.querySelectorAll(`.slide-preview-tab[data-${tabAttr}]`);
  const hasSkill = hasSkillPreview(charData);
  tabs.forEach(t => {
    const m = t.dataset[datasetKey];
    t.classList.toggle('active', m === mode && (m === 'attack' || hasSkill));
    if (m === 'skill') t.disabled = !hasSkill;
  });
  // 스킬 미리보기가 없으면 자동으로 attack 모드로 복귀
  const effectiveMode = (mode === 'skill' && hasSkill) ? 'skill' : 'attack';

  // 스킬 미리보기 모드
  if (effectiveMode === 'skill' && hasSkill) {
    const skill = SKILL_PREVIEW[charData.type];
    const centerCol = 2, centerRow = 2;
    // 쌍둥이 합류 — 누나(가로 3칸)와 동생(세로 3칸) 색을 분리해서 표시. 겹침은 attack-range
    if (skill.joinedTwins) {
      const elderRange = getAttackCells('twins_elder', centerCol, centerRow);
      const youngerRange = getAttackCells('twins_younger', centerCol, centerRow);
      const elderSet = new Set(elderRange.map(c => `${c.col},${c.row}`));
      const youngerSet = new Set(youngerRange.map(c => `${c.col},${c.row}`));
      board.querySelectorAll('.cell').forEach(cell => {
        const col = parseInt(cell.dataset.col);
        const row = parseInt(cell.dataset.row);
        cell.className = 'cell';
        cell.innerHTML = '';
        if (col === centerCol && row === centerRow) {
          cell.innerHTML = `<span style="font-size:1.1rem">👫</span>`;
          cell.classList.add('has-piece');
        }
        const inE = elderSet.has(`${col},${row}`);
        const inY = youngerSet.has(`${col},${row}`);
        if (inE && inY) cell.classList.add('attack-range');
        else if (inE) cell.classList.add('attack-range');
        else if (inY) cell.classList.add('skill-range');
      });
      if (infoEl) infoEl.textContent = skill.label;
      return;
    }
    const cells = skill.cells(centerCol, centerRow);
    const cellsSet = new Set(cells.map(c => `${c.col},${c.row}`));
    // 쥐 위치 (자기 제외)
    const ratSet = skill.showRats
      ? new Set(cells.filter(c => !(c.col === centerCol && c.row === centerRow)).map(c => `${c.col},${c.row}`))
      : null;
    board.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col);
      const row = parseInt(cell.dataset.row);
      cell.className = 'cell';
      cell.innerHTML = '';
      if (col === centerCol && row === centerRow) {
        let centerIcon = charData.icon;
        if (skill.showDragonOnly) centerIcon = '🐲';
        cell.innerHTML = `<span style="font-size:1.1rem">${centerIcon}</span>`;
        cell.classList.add('has-piece');
      } else if (ratSet && ratSet.has(`${col},${row}`)) {
        // 실제 게임처럼 작게 + 우상단 코너에 배치
        cell.innerHTML = `<span style="position:absolute;top:1px;right:2px;font-size:0.5rem;color:#52b788">🐀</span>`;
      }
      if (cellsSet.has(`${col},${row}`)) {
        cell.classList.add('skill-preview-' + skill.cat);
      }
    });
    if (infoEl) infoEl.textContent = skill.label;
    return;
  }

  // 쌍둥이: 형(1,2)과 동생(3,2) 따로 배치
  if (charData.isTwin) {
    const elderCol = 1, elderRow = 2;
    const youngerCol = 3, youngerRow = 2;
    const rangeE = getAttackCells('twins_elder', elderCol, elderRow);
    const rangeY = getAttackCells('twins_younger', youngerCol, youngerRow);

    board.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col);
      const row = parseInt(cell.dataset.row);
      cell.className = 'cell';
      cell.innerHTML = '';

      // 누나 위치
      if (col === elderCol && row === elderRow) {
        cell.innerHTML = `<span style="font-size:1rem">👧</span>`;
        cell.classList.add('has-piece');
      }
      // 동생 위치
      if (col === youngerCol && row === youngerRow) {
        cell.innerHTML = `<span style="font-size:1rem">👦</span>`;
        cell.classList.add('has-piece');
      }

      const inE = rangeE.some(c => c.col === col && c.row === row);
      const inY = rangeY.some(c => c.col === col && c.row === row);

      if (inE && inY) {
        cell.classList.add('attack-range'); // 겹치는 범위
      } else if (inE) {
        cell.classList.add('attack-range'); // 형 범위 (금색)
      } else if (inY) {
        cell.classList.add('skill-range');  // 동생 범위 (보라)
      }
    });

    if (infoEl) infoEl.textContent = shouldShowDesc(charData) ? charData.desc : '';
    return;
  }

  // 일반 캐릭터: 중앙 배치
  const centerCol = 2, centerRow = 2;
  let previewType = charData.type;
  const range = getAttackCells(previewType, centerCol, centerRow);

  board.querySelectorAll('.cell').forEach(cell => {
    const col = parseInt(cell.dataset.col);
    const row = parseInt(cell.dataset.row);
    cell.className = 'cell';
    cell.innerHTML = '';

    const inRange = range.some(c => c.col === col && c.row === row);
    if (col === centerCol && row === centerRow) {
      cell.innerHTML = `<span style="font-size:1.1rem">${charData.icon}</span>`;
      cell.classList.add('has-piece');
      // 제자리 공격범위 추가 강조 제거 — 쌍둥이처럼 attack-range 단일 표현으로 통일.
    }
    if (inRange) cell.classList.add('attack-range');
  });

  if (infoEl) infoEl.textContent = shouldShowDesc(charData) ? charData.desc : '';
}

function updateDraftConfirmBtn() {
  const btn = document.getElementById('btn-draft-confirm');

  if (S.teamDraftMode) {
    // 팀 모드 — 2픽
    const tmCount = (S.teamDraft?.pick1 ? 1 : 0) + (S.teamDraft?.pick2 ? 1 : 0);
    if (S.teamDraftConfirmed) {
      btn.disabled = true;
      btn.textContent = '✅ 확정됨';
    } else if (tmCount === 2) {
      btn.disabled = false;
      btn.textContent = '선택 확정';
    } else {
      btn.disabled = true;
      btn.textContent = `선택 확정 · ${tmCount}/2`;
    }
    renderTeamDraftSlots();
    return;
  }

  const allSelected = S.draftSelected[1] && S.draftSelected[2] && S.draftSelected[3];
  const count = [1,2,3].filter(t => S.draftSelected[t]).length;
  if (S.deckBuilderMode) {
    btn.disabled = false;
    btn.textContent = allSelected ? '덱 저장' : `덱 저장 · ${count}/3`;
  } else if (allSelected) {
    btn.disabled = false;
    btn.textContent = '최종 확정';
  } else {
    btn.disabled = true;
    btn.textContent = `선택 확정 · ${count}/3`;
  }
  renderDraftSlots();
}

function charDataToPieceLike(c) {
  return {
    type: c.type, name: c.name, icon: c.icon, tier: c.tier, atk: c.atk,
    tag: c.tag, desc: c.desc,
    skills: c.skills || [],
    hasSkill: c.skills && c.skills.length > 0,
    skillName: c.skills?.[0]?.name || '',
    skillCost: c.skills?.[0]?.cost || 0,
    passiveName: c.passives?.[0] ? getPassiveLabel(c.passives[0]) : '',
    passives: c.passives || [],
  };
}

function renderDraftSlots() {
  for (let tier = 1; tier <= 3; tier++) {
    const slot = document.getElementById(`draft-slot-${tier}`);
    if (!slot) continue;
    const selectedType = S.draftSelected[tier];
    const chars = S.characters?.[tier];
    const c = chars?.find(ch => ch.type === selectedType);

    // 기존 툴팁 제거
    const oldTip = slot.querySelector('.piece-tooltip');
    if (oldTip) oldTip.remove();

    if (c) {
      slot.className = 'draft-slot filled';
      const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
      slot.innerHTML = `
        <span class="slot-tier">${tier}티어</span>
        <span class="slot-icon">${c.icon}</span>
        <div class="slot-info">
          <span class="slot-name">${c.name} ${tagHtml}</span>
          <span class="slot-stats">ATK ${c.atk}</span>
          <div>${buildMiniHeaders(c)}</div>
        </div>
        <span class="slot-remove" title="선택 해제">×</span>`;

      // 호버 팝업
      const pieceLike = charDataToPieceLike(c);
      const tooltip = buildPieceTooltip(pieceLike, 'left');
      slot.appendChild(tooltip);

      // 슬롯 클릭 → 해당 티어로 이동
      slot.onclick = (e) => {
        if (e.target.classList.contains('slot-remove')) {
          S.draftSelected[tier] = null;
          if (S.deckBuilderMode) S.deckSaved = false;
          S.draftStep = tier;
          buildDraftStepUI();
          socket.emit('draft_browse', { step: tier, type: null, selected: { ...S.draftSelected } });
          return;
        }
        S.draftStep = tier;
        buildDraftStepUI();
      };

      // 저장 상태 녹색 밴드
      const savedKey = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';
      const isSavedSlot = S.deckSavedState && S.deckSavedState[savedKey] === selectedType;
      slot.style.borderLeft = isSavedSlot ? '3px solid #22c55e' : '';
      // 현재 보고 있는 티어 강조
      if (tier === S.draftStep) {
        slot.style.borderColor = 'var(--accent)';
        slot.style.boxShadow = '0 0 8px rgba(226,168,75,0.2)';
      } else {
        slot.style.borderColor = 'var(--success)';
        slot.style.boxShadow = 'none';
      }
    } else {
      slot.className = 'draft-slot empty';
      slot.innerHTML = `
        <span class="slot-tier">${tier}티어</span>
        <span class="slot-empty-text">미선택</span>`;
      slot.onclick = () => {
        S.draftStep = tier;
        buildDraftStepUI();
      };
      // 현재 보고 있는 티어 강조
      if (tier === S.draftStep) {
        slot.style.borderColor = 'var(--accent)';
        slot.style.borderStyle = 'solid';
        slot.style.opacity = '0.8';
      } else {
        slot.style.borderColor = '';
        slot.style.borderStyle = '';
        slot.style.opacity = '';
      }
    }
  }
}

document.getElementById('btn-draft-confirm').addEventListener('click', () => {
  // ── 팀 드래프트 2픽 확정 ──
  if (S.teamDraftMode) {
    const p1 = S.teamDraft?.pick1;
    const p2 = S.teamDraft?.pick2;
    if (!p1 || !p2) return;
    socket.emit('team_draft_confirm');
    document.getElementById('btn-draft-confirm').disabled = true;
    return;
  }

  const allSelected = S.draftSelected[1] && S.draftSelected[2] && S.draftSelected[3];

  // 덱 빌더 모드: 덱 이름 모달을 먼저 띄움 (이름 입력 후 저장)
  if (S.deckBuilderMode) {
    if (!allSelected) {
      showSkillToast('캐릭터를 모두 선택하지 않았습니다.', false, undefined, 'event');
      return;
    }
    // 덱 리스트 사전 검증
    const t1 = S.draftSelected[1], t2 = S.draftSelected[2], t3 = S.draftSelected[3];
    const list = loadDeckList();
    // 동일한 캐릭터 조합이 이미 있으면 덮어쓰기 의도로 그 슬롯 선택
    const dupIdx = list.findIndex(d => d && d.t1 === t1 && d.t2 === t2 && d.t3 === t3);
    if (dupIdx !== -1) {
      showSkillToast('이미 같은 덱이 있습니다.', false, undefined, 'event');
      return;
    }
    const emptyIdx = list.findIndex(d => !d);
    if (emptyIdx === -1) {
      showSkillToast('덱 슬롯이 부족합니다.', false, undefined, 'event');
      return;
    }
    // 덱 이름 모달 띄우고, 확인 시 저장
    S._pendingSaveSlotIdx = emptyIdx;
    openDeckNameModal('');
    return;
  }

  if (!allSelected) return;

  S.draftPicked = [S.draftSelected[1], S.draftSelected[2], S.draftSelected[3]];
  socket.emit('select_pieces', {
    t1: S.draftSelected[1],
    t2: S.draftSelected[2],
    t3: S.draftSelected[3],
  });
  document.getElementById('btn-draft-confirm').disabled = true;
  document.querySelector('.draft-main .slide-viewer').innerHTML = '<div class="spinner" style="text-align:center;padding:40px;color:var(--muted)">상대방의 선택을 기다리는 중...</div>';
  const pager = document.getElementById('slide-pager');
  if (pager) pager.innerHTML = '';
  // 사이드바 버튼 비활성화
  document.getElementById('btn-draft-random').disabled = true;
  document.getElementById('btn-draft-recommend').disabled = true;
});

// ── 랜덤 선택 (슬롯 채우기) ──
document.getElementById('btn-draft-random').addEventListener('click', () => {
  if (!S.characters) return;
  const t1 = S.characters[1][Math.floor(Math.random() * S.characters[1].length)];
  const t2 = S.characters[2][Math.floor(Math.random() * S.characters[2].length)];
  const t3 = S.characters[3][Math.floor(Math.random() * S.characters[3].length)];
  S._randomPick = { t1: t1.type, t2: t2.type, t3: t3.type };

  const modal = document.getElementById('random-confirm-modal');
  document.getElementById('random-confirm-body').innerHTML = `
    <p style="margin-bottom:14px;color:var(--muted)">캐릭터를 랜덤 선택합니다.</p>
    <div class="random-pick-list">
      <div class="random-pick-item"><span class="random-tier">1티어</span> ${t1.icon} <strong>${t1.name}</strong> ${buildMiniHeaders(t1)}</div>
      <div class="random-pick-item"><span class="random-tier">2티어</span> ${t2.icon} <strong>${t2.name}</strong> ${buildMiniHeaders(t2)}</div>
      <div class="random-pick-item"><span class="random-tier">3티어</span> ${t3.icon} <strong>${t3.name}</strong> ${buildMiniHeaders(t3)}</div>
    </div>
  `;
  modal.classList.remove('hidden');
});

document.getElementById('random-confirm-ok').addEventListener('click', () => {
  const pick = S._randomPick;
  if (!pick) return;
  document.getElementById('random-confirm-modal').classList.add('hidden');
  // 슬롯만 채우기 (확정은 별도)
  S.draftSelected = { 1: pick.t1, 2: pick.t2, 3: pick.t3 };
  showSkillToast('🎲 슬롯이 랜덤으로 채워졌습니다!', false, undefined, 'event');
  buildDraftStepUI();
});

document.getElementById('random-confirm-cancel').addEventListener('click', () => {
  document.getElementById('random-confirm-modal').classList.add('hidden');
  S._randomPick = null;
});

// ── 추천 조합 ──
const RECOMMENDED_COMBOS = [
  {
    style: '⚔️ 화력 집중형',
    desc: '강력한 화력으로 적을 빠르게 제압하는 스타일',
    picks: [
      { tier: 1, type: 'archer', reason: '대각선 전체 공격으로 넓은 범위 커버' },
      { tier: 2, type: 'dualBlade', reason: '쌍검무로 한 턴에 2회 공격 가능' },
      { tier: 3, type: 'slaughterHero', reason: '9칸의 최대 범위 공격' },
    ]
  },
  {
    style: '🛡️ 방어형',
    desc: '높은 생존력과 지원으로 장기전으로 끌고가는 스타일',
    picks: [
      { tier: 1, type: 'herbalist', reason: '아군 힐링으로 팀 생존력 확보' },
      { tier: 2, type: 'armoredWarrior', reason: '패시브 스킬로 피해 감소' },
      { tier: 3, type: 'monk', reason: '아군 회복과 더불어 상태이상 제거' },
    ]
  },
  {
    style: '🎯 저격형',
    desc: '가로 세로 모두 긴 사거리로 안전하게 플레이하는 스타일',
    picks: [
      { tier: 1, type: 'spearman', reason: '세로줄 전체 관통 공격' },
      { tier: 2, type: 'weaponSmith', reason: '자유로운 공격 범위 전환' },
      { tier: 3, type: 'prince', reason: '강력한 가로 공격' },
    ]
  },
  {
    style: '🗡️ 트릭형',
    desc: '기습과 교란으로 상대를 혼란에 빠뜨리는 스타일',
    picks: [
      { tier: 1, type: 'manhunter', reason: '예측되는 경로에 함정 설치' },
      { tier: 2, type: 'shadowAssassin', reason: '그림자 숨기 스킬의 질긴 생존력' },
      { tier: 3, type: 'torturer', reason: '표식과 악몽 콤보로 보드 전체를 장악' },
    ]
  },
  {
    style: '✨ 스킬 폭발형',
    desc: 'SP를 적극 활용해 스킬로 전장을 지배하는 스타일',
    picks: [
      { tier: 1, type: 'gunpowder', reason: '폭탄 설치로 폭 넓은 견제' },
      { tier: 2, type: 'wizard', reason: '피격 시 지급되는 SP1로 스킬 자원 펌핑' },
      { tier: 3, type: 'dragonTamer', reason: 'SP5를 지불해 판세를 뒤흔들 드래곤 소환' },
    ]
  },
  {
    style: '👑 시너지 특화형',
    desc: '왕실 태그 유닛끼리의 시너지를 활용하는 스타일',
    picks: [
      { tier: 1, type: 'cavalry', reason: '가로줄 전체 공격의 우수한 색적' },
      { tier: 2, type: 'bodyguard', reason: '충성 패시브로 왕실 아군을 보호' },
      { tier: 3, type: 'commander', reason: '사기증진 패시브로 아군의 공격력 버프' },
    ]
  },
];

document.getElementById('btn-draft-recommend').addEventListener('click', () => {
  const modal = document.getElementById('recommend-modal');
  const body = document.getElementById('recommend-body');
  body.innerHTML = RECOMMENDED_COMBOS.map((combo, ci) => {
    const findChar = (type) => {
      for (const tier of [1,2,3]) {
        const c = (S.characters || {})[tier]?.find(ch => ch.type === type);
        if (c) return c;
      }
      return null;
    };
    return `
      <div class="recommend-combo">
        <div class="recommend-header">
          <strong>${combo.style}</strong>
          <span class="recommend-desc">${combo.desc}</span>
        </div>
        <div class="recommend-picks">
          ${combo.picks.map(p => {
            const c = findChar(p.type);
            return c ? `<div class="recommend-pick">
              <span class="recommend-pick-tier">${p.tier}티어</span>
              <span class="recommend-pick-icon">${c.icon}</span>
              <strong>${c.name}</strong>
              <span class="recommend-pick-reason">${p.reason}</span>
            </div>` : '';
          }).join('')}
        </div>
        <button class="btn btn-small btn-primary recommend-apply-btn" data-combo="${ci}">이 조합 적용</button>
      </div>
    `;
  }).join('');

  // "이 조합 적용" 버튼
  body.querySelectorAll('.recommend-apply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const combo = RECOMMENDED_COMBOS[parseInt(btn.dataset.combo)];
      combo.picks.forEach(p => {
        S.draftSelected[p.tier] = p.type;
      });
      S.draftStep = 1;
      buildDraftStepUI();
      modal.classList.add('hidden');
    });
  });

  modal.classList.remove('hidden');
});

document.getElementById('recommend-close').addEventListener('click', () => {
  document.getElementById('recommend-modal').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════
// ── HP 분배 UI ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildHpUI() {
  renderProgressStepper('screen-hp', 'hp');
  const draft = S.myDraft;
  S.hpValues = [4, 3, 3];
  const types = [draft.t1, draft.t2, draft.t3];
  const tierLabels = ['1티어', '2티어', '3티어'];
  const container = document.getElementById('hp-pieces');
  container.innerHTML = '';
  const rows = document.createElement('div');
  rows.className = 'hp-piece-rows';

  for (let i = 0; i < 3; i++) {
    const charData = findChar(types[i]);
    if (!charData) continue;
    const row = document.createElement('div');
    row.className = 'hp-piece-row';
    const tagHtml = charData.tag
      ? tagBadgeHtml(charData.tag)
      : '';
    row.innerHTML = `
      <span class="char-icon">${charData.icon}</span>
      <div class="hp-piece-label">
        <strong>${charData.name}${tagHtml}</strong>
        <span>${tierLabels[i]}</span>
      </div>
      <div class="hp-input-group">
        <button class="hp-btn" data-i="${i}" data-delta="-1">−</button>
        <span class="hp-value" id="hp-val-${i}">${S.hpValues[i]}</span>
        <button class="hp-btn" data-i="${i}" data-delta="1">+</button>
      </div>`;
    rows.appendChild(row);
  }
  container.appendChild(rows);

  container.querySelectorAll('.hp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.i);
      const delta = parseInt(btn.dataset.delta);
      adjustHp(idx, delta);
    });
  });

  // 쌍둥이 패널 숨기기
  document.getElementById('hp-twin-split').classList.add('hidden');
  updateHpUI();
}

function adjustHp(idx, delta) {
  const next = S.hpValues[idx] + delta;
  const total = S.hpValues.reduce((a, b) => a + b, 0);
  if (next < 1 || next > 8) return;
  if (delta > 0 && total >= 10) return;
  // 쌍둥이: 1티어 최소 2
  if (S.hasTwins && idx === 0 && next < 2) return;
  S.hpValues[idx] = next;
  updateHpUI();
  // 관전자에게 실시간 HP 조정 전송
  socket.emit('hp_browse', { hps: [...S.hpValues] });
}

function updateHpUI() {
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(`hp-val-${i}`);
    if (el) el.textContent = S.hpValues[i];
  }
  const total = S.hpValues.reduce((a, b) => a + b, 0);
  document.getElementById('hp-remaining').textContent = 10 - total;
  document.getElementById('btn-hp-confirm').disabled = total !== 10;
}

function showTwinSplit(twinTierHp) {
  const panel = document.getElementById('hp-twin-split');
  panel.classList.remove('hidden');
  const controls = document.getElementById('hp-twin-controls');

  // 쌍둥이 분배 진입 시 — 메인 HP 분배 UI 잠금 (+/- 버튼·슬라이더 비활성, 시각적으로도 흐림)
  const hpPiecesEl = document.getElementById('hp-pieces');
  if (hpPiecesEl) {
    hpPiecesEl.classList.add('hp-locked-during-twin');
    hpPiecesEl.querySelectorAll('.hp-btn, .hp-slider').forEach(el => {
      el.disabled = true;
      el.setAttribute('data-twin-locked', '1');
    });
  }

  // 패널 우측 상단에 X 버튼 추가 (덱 슬롯과 동일 스타일) — 클릭 시 분배 취소하고 메인으로 복귀
  let closeBtn = panel.querySelector('.hp-twin-close');
  if (!closeBtn) {
    closeBtn = document.createElement('button');
    closeBtn.className = 'hp-twin-close deck-list-del';
    closeBtn.type = 'button';
    closeBtn.title = '쌍둥이 분배 취소';
    closeBtn.textContent = '×';
    panel.appendChild(closeBtn);
  }
  // 핸들러 갱신 (panel 매번 열릴 때 새로)
  closeBtn.onclick = () => {
    unlockMainHpUI();
    panel.classList.add('hidden');
    const cBtn = document.getElementById('btn-hp-confirm');
    cBtn.textContent = '확정';
    cBtn.onclick = null;
    cBtn.disabled = false;
    if (typeof updateHpUI === 'function') updateHpUI();
    if (typeof updateTeamHpUIShared === 'function') updateTeamHpUIShared();
  };

  let elderHp = Math.ceil(twinTierHp / 2);
  let youngerHp = twinTierHp - elderHp;

  function render() {
    controls.innerHTML = `
      <div class="hp-twin-unit hp-twin-unit-compact">
        <strong>👧 누나</strong>
        <div class="hp-input-group" style="justify-content:center">
          <button class="hp-btn twin-btn" data-who="elder" data-delta="-1">−</button>
          <span class="hp-value">${elderHp}</span>
          <button class="hp-btn twin-btn" data-who="elder" data-delta="1">+</button>
        </div>
      </div>
      <div class="hp-twin-unit hp-twin-unit-compact">
        <strong>👦 동생</strong>
        <div class="hp-input-group" style="justify-content:center">
          <button class="hp-btn twin-btn" data-who="younger" data-delta="-1">−</button>
          <span class="hp-value">${youngerHp}</span>
          <button class="hp-btn twin-btn" data-who="younger" data-delta="1">+</button>
        </div>
      </div>`;

    controls.querySelectorAll('.twin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.delta);
        if (btn.dataset.who === 'elder') {
          const next = elderHp + delta;
          if (next < 1 || next >= twinTierHp) return;
          elderHp = next;
          youngerHp = twinTierHp - elderHp;
        } else {
          const next = youngerHp + delta;
          if (next < 1 || next >= twinTierHp) return;
          youngerHp = next;
          elderHp = twinTierHp - youngerHp;
        }
        render();
      });
    });
  }

  render();

  // HP 확인 버튼을 쌍둥이 분배 전송으로 변경
  const btn = document.getElementById('btn-hp-confirm');
  btn.disabled = false;
  btn.textContent = '쌍둥이 분배 확정';
  btn.onclick = () => {
    const ev = S.teamHpMode ? 'team_hp_distribute' : 'distribute_hp';
    socket.emit(ev, { twinSplit: [elderHp, youngerHp] });
    btn.disabled = true;
    btn.onclick = null;
    unlockMainHpUI();   // 분배 확정 시에도 잠금 해제 (다음 화면 진입 전 상태 복원)
  };
}

// 쌍둥이 분배 종료 시 메인 HP UI 잠금 해제
function unlockMainHpUI() {
  const hpPiecesEl = document.getElementById('hp-pieces');
  if (!hpPiecesEl) return;
  hpPiecesEl.classList.remove('hp-locked-during-twin');
  hpPiecesEl.querySelectorAll('[data-twin-locked="1"]').forEach(el => {
    el.disabled = false;
    el.removeAttribute('data-twin-locked');
  });
}

document.getElementById('btn-hp-confirm').addEventListener('click', () => {
  const ev = S.teamHpMode ? 'team_hp_distribute' : 'distribute_hp';
  socket.emit(ev, { hps: S.hpValues });
  document.getElementById('btn-hp-confirm').disabled = true;
});

// ═══════════════════════════════════════════════════════════════
// ── 캐릭터 공개 UI ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildRevealUI(myPieces, oppPieces) {
  document.getElementById('reveal-my-name').textContent = S.myName || '나';
  document.getElementById('reveal-opp-name').textContent = S.opponentName || '상대방';

  const myContainer = document.getElementById('reveal-my-pieces');
  const oppContainer = document.getElementById('reveal-opp-pieces');
  myContainer.innerHTML = '';
  oppContainer.innerHTML = '';

  for (const pc of myPieces) {
    myContainer.appendChild(createRevealCard(pc, 'left'));
  }
  for (const pc of oppPieces) {
    oppContainer.appendChild(createRevealCard(pc, 'right'));
  }
}

function createRevealCard(pc, tooltipSide) {
  const card = document.createElement('div');
  card.className = 'reveal-piece-card';
  card.style.position = 'relative';
  const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
  const grid = buildMiniRangeGrid(pc.type, { toggleState: pc.toggleState }, pc.icon);
  card.innerHTML = `
    <span class="char-icon" style="font-size:1.6rem">${pc.icon}</span>
    <div class="piece-info">
      <strong>${pc.name}${tagHtml}</strong>
      <span>T${pc.tier} · ATK ${pc.atk} · HP ${pc.hp}/${pc.maxHp}</span>
    </div>`;
  const tooltip = buildPieceTooltip(pc, tooltipSide || 'right');
  card.appendChild(tooltip);
  return card;
}

function getSkillDescForPiece(pc) {
  const charData = S.characters || S.specCharacters;
  if (!charData) return '';
  const baseType = (pc.type === 'twins_elder' || pc.type === 'twins_younger') ? 'twins' : pc.type;
  for (const tier of [1, 2, 3]) {
    const chars = charData[tier];
    if (!chars) continue;
    const ch = chars.find(c => c.type === baseType);
    if (ch && ch.skills && ch.skills.length > 0) return ch.skills[0].desc;
  }
  return '';
}

document.getElementById('btn-reveal-confirm').addEventListener('click', () => {
  socket.emit('confirm_reveal');
  document.getElementById('btn-reveal-confirm').disabled = true;
  document.getElementById('btn-reveal-confirm').textContent = '대기 중...';
});

// ═══════════════════════════════════════════════════════════════
// ── 세팅 진행도 그래프 ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

const SETUP_STEPS = [
  { id: 'initial_reveal', label: '초기 공개' },
  { id: 'exchange',       label: '교환 드래프트' },
  { id: 'final_reveal',   label: '최종 공개' },
  { id: 'hp',             label: 'HP 분배' },
  { id: 'placement',      label: '말 배치' },
];

function renderProgressStepper(containerId, currentStepId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let existing = container.querySelector('.progress-stepper');
  if (existing) existing.remove();

  const stepper = document.createElement('div');
  stepper.className = 'progress-stepper';
  const currentIdx = SETUP_STEPS.findIndex(s => s.id === currentStepId);

  for (let i = 0; i < SETUP_STEPS.length; i++) {
    const step = SETUP_STEPS[i];
    const dot = document.createElement('div');
    dot.className = `step-item${i < currentIdx ? ' done' : ''}${i === currentIdx ? ' active' : ''}`;
    dot.innerHTML = `<div class="step-circle">${i + 1}</div><div class="step-label">${step.label}</div>`;
    stepper.appendChild(dot);
    if (i < SETUP_STEPS.length - 1) {
      const line = document.createElement('div');
      line.className = `step-line${i < currentIdx ? ' done' : ''}`;
      stepper.appendChild(line);
    }
  }
  container.insertBefore(stepper, container.firstChild);
}

// ═══════════════════════════════════════════════════════════════
// ── 초기 공개 UI ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// 교체 페이즈 결정 윈도우 (10초) 상태
const IREV_DECISION_MS = 10000;
let _irevDecisionState = null;       // 'yes' | 'no' | null  (10초 동안 자유 토글)
let _irevDecisionTimeoutId = null;
let _irevDecisionTickIv = null;
let _irevDecisionLocked = false;     // 10초 종료 후 잠금
let _irevAnimRunning = false;        // 교체 공개 애니메이션 중인지

function buildInitialRevealUI(myDraft, oppChars, opts = {}) {
  // opts.skipIntroAnim: 교체 후 final_reveal 재진입 시 등장 애니메이션 생략하고 즉시 카드 표시 + 변경 슬롯만 swap-reveal
  const skipIntroAnim = !!opts.skipIntroAnim;
  renderProgressStepper('screen-initial-reveal', 'initial_reveal');
  document.getElementById('irev-my-name').textContent = S.myName || '나';
  document.getElementById('irev-opp-name').textContent = S.opponentName || '상대방';

  const myContainer = document.getElementById('irev-my-chars');
  const oppContainer = document.getElementById('irev-opp-chars');
  myContainer.innerHTML = '';   // 이전 라운드의 카드/라벨/플레이스홀더 모두 정리
  oppContainer.innerHTML = '';

  const btn = document.getElementById('btn-irev-confirm');
  if (btn) {
    btn.classList.add('hidden');  // 새 라운드 진입 — swap 애니메이션 종료 후 다시 보이도록 초기 숨김
    btn.disabled = true;
    btn.style.opacity = '0';
    btn.style.animation = '';
    btn.textContent = 'HP 분배로';
    delete btn.dataset.confirmStage;
  }

  // 결정 영역 — 새 라운드 시작 시 초기 상태로 리셋
  resetIrevDecisionUI();

  // 카드 데이터 준비
  const myCards = [];
  for (const [key, tier] of [['t1', 1], ['t2', 2], ['t3', 3]]) {
    const type = myDraft[key];
    const ch = findLocalChar(type, tier);
    if (ch) myCards.push({ ch, tier });
  }
  const oppCards = oppChars.map(ch => ({ ch, tier: ch.tier }));

  if (skipIntroAnim) {
    // 즉시 카드 표시 (애니메이션 없이) — final_reveal 화면이 첫 진입이 아니라 이미 노출된 카드의 차분 갱신용
    for (let i = 0; i < 3; i++) {
      if (myCards[i]) {
        myContainer.appendChild(createDraftRevealCard(myCards[i].ch, myCards[i].tier, 'left'));
      }
      if (oppCards[i]) {
        oppContainer.appendChild(createDraftRevealCard(oppCards[i].ch, oppCards[i].tier, 'right'));
      }
    }
    return;
  }

  // 빈 슬롯 3개씩 미리 표시 — 등장 애니메이션을 위한 placeholder
  for (let i = 0; i < 3; i++) {
    const ms = document.createElement('div'); ms.className = 'reveal-slot-empty';
    myContainer.appendChild(ms);
    const os = document.createElement('div'); os.className = 'reveal-slot-empty';
    oppContainer.appendChild(os);
  }

  // 슬롯 등장 타이밍: 첫 0.5s, 이후 0.75s 간격 (좌우 동시)
  const mySlots = myContainer.querySelectorAll('.reveal-slot-empty');
  const oppSlots = oppContainer.querySelectorAll('.reveal-slot-empty');
  const delays = [500, 1250, 2000]; // 0.5, 1.25, 2.0
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      playSfxRevealAppear();
      if (myCards[i]) {
        const card = createDraftRevealCard(myCards[i].ch, myCards[i].tier, 'left');
        card.style.animation = 'revealSlide 0.5s ease-out both';
        mySlots[i].replaceWith(card);
      }
      if (oppCards[i]) {
        const card = createDraftRevealCard(oppCards[i].ch, oppCards[i].tier, 'right');
        card.style.animation = 'revealSlide 0.5s ease-out both';
        oppSlots[i].replaceWith(card);
      }
    }, delays[i]);
  }

  // 공개 애니메이션이 완전히 끝난 뒤 ✓/✗ 결정 영역 페이드인 + 10초 카운트다운 시작
  setTimeout(() => {
    showIrevDecisionAndStartTimer();
  }, 2600);
}

// 결정 영역을 새 라운드 시작 상태로 리셋
function resetIrevDecisionUI() {
  if (_irevDecisionTimeoutId) { clearTimeout(_irevDecisionTimeoutId); _irevDecisionTimeoutId = null; }
  if (_irevDecisionTickIv)    { clearInterval(_irevDecisionTickIv); _irevDecisionTickIv = null; }
  _irevDecisionState = null;
  _irevDecisionLocked = false;
  // 이전 라운드 대기 오버레이 흔적 제거
  clearAiWaitCountdown();
  const row = document.getElementById('irev-decision-row');
  if (!row) return;
  row.classList.remove('visible');
  row.classList.remove('timer-active');
  row.querySelectorAll('.reveal-decision-note').forEach(n => n.remove());
  const status = document.getElementById('irev-decision-status');
  if (status) status.textContent = '';
  const yesBtn = document.getElementById('btn-irev-yes');
  const noBtn  = document.getElementById('btn-irev-no');
  if (yesBtn) { yesBtn.disabled = false; yesBtn.classList.remove('is-selected'); }
  if (noBtn)  { noBtn.disabled  = false; noBtn.classList.remove('is-selected'); }
  // 링 진행 리셋
  row.querySelectorAll('.ring-progress').forEach(r => {
    r.style.transition = 'none';
    r.style.strokeDashoffset = '0';
  });
}

// 결정 영역 페이드인 + 10초 카운트다운 시작
function showIrevDecisionAndStartTimer() {
  const row = document.getElementById('irev-decision-row');
  if (!row) return;
  row.classList.add('visible');

  // 다음 프레임에 timer-active 부여 → 링 페이드인 + 진행 애니메이션 시작
  requestAnimationFrame(() => {
    row.classList.add('timer-active');
    const RING_LEN = 169.65; // 2π·27
    row.querySelectorAll('.ring-progress').forEach(r => {
      // 강제 리플로우 후 transition 설정 → 0 → RING_LEN 으로 비워지는 애니메이션
      r.style.transition = 'none';
      r.style.strokeDashoffset = '0';
      // eslint-disable-next-line no-unused-expressions
      r.getBoundingClientRect();
      r.style.transition = `stroke-dashoffset ${IREV_DECISION_MS}ms linear`;
      r.style.strokeDashoffset = String(RING_LEN);
    });
  });

  // 10초 종료 시 결정 잠금 + 서버로 emit
  _irevDecisionTimeoutId = setTimeout(() => {
    finalizeIrevDecision();
  }, IREV_DECISION_MS);
}

// 사용자 토글 — ✓ / ✗ 버튼 클릭 시
function toggleIrevDecision(target /* 'yes' | 'no' */) {
  if (_irevDecisionLocked) return;
  // 같은 버튼 다시 누르면 해제 (라디오/토글 혼합)
  if (_irevDecisionState === target) _irevDecisionState = null;
  else _irevDecisionState = target;
  refreshIrevDecisionUI();
}

function refreshIrevDecisionUI() {
  const yesBtn = document.getElementById('btn-irev-yes');
  const noBtn  = document.getElementById('btn-irev-no');
  if (yesBtn) yesBtn.classList.toggle('is-selected', _irevDecisionState === 'yes');
  if (noBtn)  noBtn.classList.toggle('is-selected',  _irevDecisionState === 'no');
}

// 10초 종료 — 최종 결정을 서버로 emit (미선택 시 false 로 패스)
function finalizeIrevDecision() {
  if (_irevDecisionLocked) return;
  _irevDecisionLocked = true;
  const wantsExchange = _irevDecisionState === 'yes';
  const yesBtn = document.getElementById('btn-irev-yes');
  const noBtn  = document.getElementById('btn-irev-no');
  if (yesBtn) yesBtn.disabled = true;
  if (noBtn)  noBtn.disabled  = true;
  // 결정 후 상태 텍스트는 표시하지 않음 — 대기 카운트다운은 상대 카드 슬롯 위 오버레이로 별도 노출됨.
  const status = document.getElementById('irev-decision-status');
  if (status) status.textContent = '';
  socket.emit('confirm_initial_reveal', { wantsExchange });
}

// 교체 공개 애니메이션 — screen-initial-reveal 에서 변경된 티어의 카드만 in-place 갱신.
//   1.5초 안에 끝나도록: 0.5s fade-out → 1s fade-in (총 1.5s).
//   양측 모두 교체했으면 동시 재생. 변경 없으면 즉시 "교체하지 않음" 라벨 + 확인 버튼 노출.
//   카드 비교는 기존 DOM 의 reveal-piece-card 와 새 데이터(myDraft/oppChars)를 대조.
//   교체된 측에는 카드 위에 "🔄 교체됨" 태그 (.exchanged-highlight),
//   교체되지 않은 측에는 카드 영역 아래에 "교체하지 않음" 라벨 표시.
function playExchangeRevealAnimation(myDraft, oppChars) {
  if (_irevAnimRunning) return;
  _irevAnimRunning = true;

  // ★ 진단 #3 deadman switch — 어떤 경로로든 (예외, DOM 분리, 화면 전환 등) 함수가 도중에 끊겨도
  //   3초 뒤엔 무조건 락 해제. 이 안전망 없으면 _irevAnimRunning=true 영구 잠김 → 다음 final_reveal_phase
  //   가 이른 early-return 으로 화면 멈춤.
  setTimeout(() => { _irevAnimRunning = false; }, 3000);

  // 결정 영역은 즉시 페이드아웃 (10초 윈도우 종료 후에는 사용 안 함)
  const row = document.getElementById('irev-decision-row');
  if (row) row.classList.remove('visible');

  const myContainer = document.getElementById('irev-my-chars');
  const oppContainer = document.getElementById('irev-opp-chars');
  if (!myContainer || !oppContainer) {
    // 예상치 못한 상태 — 안전하게 통과
    showFinalConfirmButton();
    _irevAnimRunning = false;
    return;
  }

  // 이전 라운드의 "교체하지 않음" 라벨 정리 — 항상 새로 생성
  myContainer.querySelectorAll('.no-exchange-label').forEach(n => n.remove());
  oppContainer.querySelectorAll('.no-exchange-label').forEach(n => n.remove());

  // 재접속/페이즈 점프 등으로 카드가 비어있는 경우 — 즉시 빌드 후 라벨 + 확인 버튼
  const tiers = [['t1', 1], ['t2', 2], ['t3', 3]];
  const myCardsExisting = myContainer.querySelectorAll('.reveal-piece-card');
  const oppCardsExisting = oppContainer.querySelectorAll('.reveal-piece-card');
  if (myCardsExisting.length === 0 || oppCardsExisting.length === 0) {
    // 카드 즉시 표시 (애니메이션 없음)
    showScreen('screen-initial-reveal');
    buildInitialRevealUI(myDraft, oppChars, { skipIntroAnim: true });
    setTimeout(() => {
      showFinalConfirmButton();
      _irevAnimRunning = false;
    }, 200);
    return;
  }

  // 새 데이터 매핑
  const myNew = {};
  for (const [key, tier] of tiers) {
    const type = myDraft[key];
    const ch = findLocalChar(type, tier);
    if (ch) myNew[tier] = { ch, tier };
  }
  const oppNew = {};
  for (const ch of oppChars) {
    oppNew[ch.tier] = { ch, tier: ch.tier };
  }

  // ★ 버그 수정: 인덱스 기반 매핑은 my 측이 animateMySwapInReveal 로 placeholder 상태일 때 어긋남
  //   (T1 placeholder 면 querySelectorAll('.reveal-piece-card') 가 [T2, T3] 만 반환 → i=0 이 T2 카드를 잡아 T1 처리하는 식).
  //   해결: data-tier 기반으로 element 매핑.
  const myByTier = {};
  for (const el of myContainer.querySelectorAll('.reveal-piece-card[data-tier]')) {
    const t = parseInt(el.dataset.tier);
    if (t) myByTier[t] = el;
  }
  const oppByTier = {};
  for (const el of oppContainer.querySelectorAll('.reveal-piece-card[data-tier]')) {
    const t = parseInt(el.dataset.tier);
    if (t) oppByTier[t] = el;
  }

  // 어떤 티어가 교체되었는지 — DOM 에 저장된 dataset 으로 대조
  const swapTasks = []; // { side: 'my'|'opp', oldEl, newCh, tier }
  for (let tier = 1; tier <= 3; tier++) {
    const myEl = myByTier[tier];
    const newMy = myNew[tier];
    // animateMySwapInReveal 가 이 tier 를 처리 중이면 my 측 swap-task 추가 안 함 (이미 별도 애니로 진행 중).
    const myMidAnim = S._mySwapAnimatingTier === tier;
    if (myEl && newMy && !myMidAnim) {
      const oldType = myEl.dataset.charType;
      if (oldType && oldType !== newMy.ch.type) {
        swapTasks.push({ side: 'my', oldEl: myEl, newCh: newMy.ch, tier });
      }
    }
    const oppEl = oppByTier[tier];
    const newOpp = oppNew[tier];
    if (oppEl && newOpp) {
      const oldType = oppEl.dataset.charType;
      if (oldType && oldType !== newOpp.ch.type) {
        swapTasks.push({ side: 'opp', oldEl: oppEl, newCh: newOpp.ch, tier });
      }
    }
  }

  // 양측의 swap 여부를 미리 계산 — "교체하지 않음" 라벨 표시 결정에 사용
  //   (my 측은 animateMySwapInReveal 진행 중인 경우도 swap 으로 인식해야 라벨 잘못 붙는 것 방지)
  const mySwapped = swapTasks.some(t => t.side === 'my') || (S._mySwapAnimatingTier != null);
  const oppSwapped = swapTasks.some(t => t.side === 'opp');
  const addNoExchangeLabel = (container) => {
    const label = document.createElement('div');
    label.className = 'no-exchange-label';
    label.textContent = '교체하지 않음';
    container.appendChild(label);
    return label;
  };

  // 변경 없음 → 짧은 페이드 후 양측 모두에 "교체하지 않음" 라벨 + 확인 버튼 노출
  if (swapTasks.length === 0) {
    setTimeout(() => {
      addNoExchangeLabel(myContainer);
      addNoExchangeLabel(oppContainer);
      showFinalConfirmButton();
      _irevAnimRunning = false;
    }, 200);
    return;
  }

  // 효과음 — 깜박임 + 공개음 (기존 SFX 재사용)
  try { playSfxSwapBlink(); } catch (e) {}
  setTimeout(() => { try { playSfxSwapReveal(); } catch (e) {} }, 400);

  // (1) 0~400ms: 기존 카드 fade-out
  for (const task of swapTasks) {
    task.oldEl.classList.add('swap-out');
  }
  // (2) 400~600ms: 빈 슬롯 placeholder
  setTimeout(() => {
    for (const task of swapTasks) {
      const emptySlot = document.createElement('div');
      emptySlot.className = 'reveal-slot-empty reveal-slot-swap-empty';
      emptySlot.dataset.task = task.side + ':' + task.tier;
      task.oldEl.replaceWith(emptySlot);
      task._emptySlot = emptySlot;
    }
  }, 400);
  // (3) 600~1500ms: 새 카드 fade-in
  setTimeout(() => {
    for (const task of swapTasks) {
      const tooltipSide = task.side === 'my' ? 'left' : 'right';
      const newCard = createDraftRevealCard(task.newCh, task.tier, tooltipSide);
      newCard.classList.add('swap-in', 'exchanged-highlight');
      if (task._emptySlot) task._emptySlot.replaceWith(newCard);
    }
  }, 600);

  // 1.5s 후 — 교체하지 않은 측에 "교체하지 않음" 라벨 + 확인 버튼 노출
  setTimeout(() => {
    if (!mySwapped) addNoExchangeLabel(myContainer);
    if (!oppSwapped) addNoExchangeLabel(oppContainer);
    showFinalConfirmButton();
    _irevAnimRunning = false;
  }, 1500);
}

// 결정 종료 후 한쪽이 ✗/미선택으로 대기 중 — 결정 영역(✓/✗ 버튼 + 링) 통째로 페이드아웃,
//   상대 캐릭터 슬롯(.reveal-side, opp 측) 위에 카운트다운 오버레이 표시. 다음 스테이지에서 정상 부활.
let _aiWaitTickIv = null;
function clearAiWaitCountdown() {
  if (_aiWaitTickIv) { clearInterval(_aiWaitTickIv); _aiWaitTickIv = null; }
  // 카운트다운 오버레이 제거
  document.querySelectorAll('.opp-cards-wait-overlay').forEach(el => el.remove());
  document.querySelectorAll('.reveal-side.has-wait-overlay').forEach(el => el.classList.remove('has-wait-overlay'));
}

function startWaitCountdown(label, waitMs) {
  clearAiWaitCountdown();
  // 내 턴 타이머(#timer-clock)는 잠시 숨김 — 다음 페이즈의 timer_start 가 자동으로 다시 표시.
  const timerClock = document.getElementById('timer-clock');
  if (timerClock) timerClock.classList.add('hidden');
  // 결정 영역(✓/✗ 버튼 + 링)은 그대로 유지 (선택 결과 확인용).
  // 상대 캐릭터 슬롯 컨테이너 위로 카운트다운 오버레이 표시.
  const oppContainer = document.getElementById('irev-opp-chars');
  if (!oppContainer) return;
  const oppSide = oppContainer.closest('.reveal-side') || oppContainer;
  oppSide.classList.add('has-wait-overlay');

  const overlay = document.createElement('div');
  overlay.className = 'opp-cards-wait-overlay';
  let remaining = Math.ceil((waitMs || 7000) / 1000);
  overlay.innerHTML = `<div class="wait-label">${label}</div><div class="wait-count">${remaining}</div>`;
  oppSide.appendChild(overlay);

  _aiWaitTickIv = setInterval(() => {
    remaining--;
    const countEl = overlay.querySelector('.wait-count');
    if (countEl) countEl.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) clearAiWaitCountdown();
  }, 1000);
}

socket.on('ai_decision_wait', ({ waitMs }) => {
  // 인간이 ✓로 교환 드래프트 중이었다면(=screen-exchange 오버레이 떠 있음) 닫고 reveal 로 복귀 후 대기 표시
  const exScreen = document.getElementById('screen-exchange');
  if (exScreen && exScreen.classList.contains('is-overlay')) {
    closeOverlayScreen('screen-exchange');
  }
  startWaitCountdown('상대 교체 대기 중', waitMs);
});

// 교체 공개 애니메이션 종료 후 — "HP 분배로" 확인 버튼 노출.
//   기존 buildInitialRevealUI 의 카드 등장 단계에서 사용된 버튼(btn-irev-confirm)을 재활용.
function showFinalConfirmButton() {
  const btn = document.getElementById('btn-irev-confirm');
  if (!btn) return;
  btn.classList.remove('hidden');
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.animation = 'revealSlide 0.5s ease-out both';
  btn.textContent = 'HP 분배로';
  btn.dataset.confirmStage = 'final';  // 클릭 핸들러에서 분기
}

function findLocalChar(type, tier) {
  const charData = S.characters;
  if (!charData || !charData[tier]) return { type, name: type, icon: '?', tier };
  const ch = charData[tier].find(c => c.type === type);
  if (!ch) return { type, name: type, icon: '?', tier };
  return { ...ch, tier };
}

function createDraftRevealCard(ch, tier, tooltipSide, extraLabel) {
  const card = document.createElement('div');
  card.className = 'reveal-piece-card';
  card.style.position = 'relative';
  // 교체 공개 애니메이션이 어느 카드를 교체할지 비교에 사용 — 캐릭터 type 과 tier 를 dataset 으로 보관
  card.dataset.charType = ch.type || '';
  card.dataset.tier = String(tier);
  const tagHtml = ch.tag ? tagBadgeHtml(ch.tag) : '';
  const labelHtml = extraLabel ? `<span class="reveal-extra-label">${extraLabel}</span>` : '';
  card.innerHTML = `
    <span class="char-icon" style="font-size:1.6rem">${ch.icon}</span>
    <div class="piece-info">
      <div class="piece-name-row"><strong>${ch.name}</strong>${tagHtml}</div>
      <div class="piece-stats">${tier}티어 · ATK ${ch.atk || '?'}</div>
      <div class="piece-mini-headers">${buildMiniHeaders(ch)}</div>
      ${labelHtml}
    </div>`;
  const tooltip = buildPieceTooltip(ch, tooltipSide || 'right');
  card.appendChild(tooltip);
  return card;
}

document.getElementById('btn-irev-confirm').addEventListener('click', () => {
  const btn = document.getElementById('btn-irev-confirm');
  // 단계 분기: 'final' 스테이지(swap 애니 종료 후) 면 confirm_final_reveal, 아니면 레거시 confirm_initial_reveal
  if (btn.dataset.confirmStage === 'final') {
    socket.emit('confirm_final_reveal');
    btn.disabled = true;
    btn.textContent = '대기 중...';
    return;
  }
  // 레거시 단일 버튼 — YES 결정으로 처리
  socket.emit('confirm_initial_reveal', { wantsExchange: true });
  btn.disabled = true;
  btn.textContent = '대기 중...';
});

// 교체 페이즈 — ✓/✗ 토글 핸들러 (10초 동안 자유 변경)
const _irevYes = document.getElementById('btn-irev-yes');
const _irevNo  = document.getElementById('btn-irev-no');
if (_irevYes) _irevYes.addEventListener('click', () => toggleIrevDecision('yes'));
if (_irevNo)  _irevNo.addEventListener('click',  () => toggleIrevDecision('no'));

// 인간 vs 인간 — 한쪽만 교체 신청, 다른 쪽 ✗/미선택일 때 60초 대기.
//   슬라이드 인 화면 없이 그 자리(교체 페이즈)에서 대기. 상대 카드 슬롯 위로 카운트다운 오버레이.
socket.on('exchange_waiting_phase', ({ myDraft, oppDraft, oppExchanging, waitingMs }) => {
  startWaitCountdown('상대 교체 대기 중', waitingMs || 60000);
});

// final_reveal 도착 시 waiting 오버레이 정리
socket.on('final_reveal_phase', () => {
  const overlay = document.getElementById('exchange-waiting-overlay');
  if (overlay) overlay.remove();
});

// ═══════════════════════════════════════════════════════════════
// ── 교환 드래프트 UI ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// ── 교환 드래프트 상태 ──
let exSlideIndex = 0;
let exCurrentTier = 1;

function buildExchangeDraftUI(myDraft, available, oppDraft) {
  renderProgressStepper('screen-exchange', 'exchange');
  S.exchangeSelected = null;
  S.exAvailable = available;
  S.exMyDraft = { ...myDraft }; // 현재 내 덱 (교환 시 업데이트)
  S.exOriginalDraft = { ...myDraft }; // 원본 저장
  S.exOppDraft = oppDraft;
  S.exSwapped = null; // { tier, newType } — 한 번만 교환 가능

  exCurrentTier = 1;
  exSlideIndex = 0;

  // 상대 캐릭터 사이드바
  const oppContainer = document.getElementById('ex-opp-chars');
  if (oppContainer && oppDraft) {
    oppContainer.innerHTML = '';
    for (const [key, tier] of [['t1', 1], ['t2', 2], ['t3', 3]]) {
      const type = oppDraft[key];
      const ch = findLocalChar(type, tier);
      if (!ch) continue;
      const card = document.createElement('div');
      card.className = 'draft-slot filled opp-slot';
      card.style.cssText = 'border-color:rgba(239,68,68,0.4);cursor:pointer;position:relative';
      card.innerHTML = `
        <span class="slot-tier">${tier}티어</span>
        <span class="slot-icon">${ch.icon}</span>
        <div class="slot-info">
          <span class="slot-name">${ch.name} ${ch.tag ? tagBadgeHtml(ch.tag) : ''}</span>
          <div>${buildMiniHeaders(ch)}</div>
        </div>`;
      card.addEventListener('click', () => {
        exCurrentTier = tier;
        exSlideIndex = 0;
        exBuildStepUI();
        // 상대 캐릭터 슬라이드로 이동. S._exAllChars에 없으면 강제 삽입 (내가 못 가진 상대 전용 캐릭터)
        let idx = (S._exAllChars || []).findIndex(c => c.type === type);
        if (idx < 0) {
          S._exAllChars.push(ch);
          idx = S._exAllChars.length - 1;
          // 아이콘 인덱스에도 이 상대 캐릭터 버튼 추가 (빨간 강조)
          const iconIndex = document.getElementById('ex-icon-index');
          if (iconIndex) {
            const DARK_ICONS = new Set(['👁','🎖','🗡','🛡','⚔','⚒','♛','⛓']);
            const btn = document.createElement('button');
            btn.className = 'icon-index-btn';
            btn.title = ch.name + ' (상대)';
            const darkCls = DARK_ICONS.has(ch.icon) ? ' dark-icon' : '';
            btn.style.boxShadow = '0 0 6px rgba(239,68,68,0.6)';
            btn.innerHTML = `<span class="icon-index-emoji${darkCls}">${ch.icon}</span>`;
            btn.addEventListener('click', () => { exSlideIndex = idx; exRenderSlide(); });
            iconIndex.appendChild(btn);
          }
        }
        exSlideIndex = idx;
        exRenderSlide();
      });
      const tooltip = buildPieceTooltip(ch, 'right');
      card.appendChild(tooltip);
      oppContainer.appendChild(card);
    }
  }

  exBuildStepUI();
  exUpdateSlots();
  exUpdateConfirmBtn();
}

function exBuildStepUI() {
  const tier = exCurrentTier;
  document.getElementById('ex-draft-sub').textContent = `상대방 말을 견제할 주요 전력을\n    하나 교체 할 수 있습니다!`;

  // 스텝 인디케이터
  const steps = document.querySelectorAll('#ex-step-indicator .step');
  steps.forEach((el, i) => {
    const t = i + 1;
    const newEl = el.cloneNode(true);
    newEl.className = 'step clickable';
    if (t === tier) newEl.classList.add('active');
    // 교환된 티어 표시
    if (S.exSwapped && S.exSwapped.tier === t) newEl.classList.add('done');
    newEl.addEventListener('click', () => {
      exCurrentTier = t;
      exSlideIndex = 0;
      exBuildStepUI();
    });
    el.parentNode.replaceChild(newEl, el);
  });

  // 현재 티어의 교환 가능 캐릭터 목록 (내 현재 캐릭터 포함)
  const myKey = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';
  const myCurrent = S.exMyDraft[myKey];
  const myCurrentCh = findLocalChar(myCurrent, tier);
  const avail = S.exAvailable[tier] || [];
  // 현재 내 캐릭터를 첫 번째로, 나머지는 available 순서
  const allChars = myCurrentCh ? [myCurrentCh, ...avail.filter(c => c.type !== myCurrent)] : [...avail];
  S._exAllChars = allChars;

  // 아이콘 인덱스
  const iconIndex = document.getElementById('ex-icon-index');
  if (iconIndex) {
    const DARK_ICONS = new Set(['👁','🎖','🗡','🛡','⚔','⚒','♛','⛓']);
    iconIndex.innerHTML = '';
    allChars.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'icon-index-btn';
      btn.title = c.name;
      const darkCls = DARK_ICONS.has(c.icon) ? ' dark-icon' : '';
      // 현재 내 캐릭터 표시
      if (c.type === myCurrent) btn.style.boxShadow = '0 0 6px rgba(59,130,246,0.6)';
      btn.innerHTML = `<span class="icon-index-emoji${darkCls}">${c.icon}</span>`;
      btn.addEventListener('click', () => { exSlideIndex = i; exRenderSlide(); });
      iconIndex.appendChild(btn);
    });
  }

  // 미리보기 보드
  buildBoard('ex-preview-board', () => {});

  // 페이저 도트 숨김 (아이콘 인덱스로 대체)
  const pager = document.getElementById('ex-slide-pager');
  if (pager) pager.innerHTML = '';

  // 현재 내 캐릭터로 시작
  exSlideIndex = 0;
  exRenderSlide();
}

function exRenderSlide() {
  const allChars = S._exAllChars;
  if (!allChars || !allChars.length) return;
  const c = allChars[exSlideIndex];
  const tier = exCurrentTier;
  const myKey = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';
  const isCurrentPick = c.type === S.exMyDraft[myKey];
  // 슬라이드 변경 시 항상 공격 범위 보기로 초기화
  if (typeof exSlidePreviewMode !== 'undefined') exSlidePreviewMode = 'attack';

  document.getElementById('ex-slide-icon').textContent = c.icon;
  const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
  document.getElementById('ex-slide-name').innerHTML = `<span>${c.name}</span>${tagHtml}`;
  // 이름 아래 공격력
  document.getElementById('ex-slide-atk').innerHTML = `⚔ 공격력 ${c.atk}`;
  // 그 아래 미니 헤더
  const exMiniEl = document.getElementById('ex-slide-mini-headers');
  if (exMiniEl) exMiniEl.innerHTML = buildMiniHeaders(c);
  // 실제 오버플로 감지
  const exLeftCol = document.querySelector('#screen-exchange .slide-left-col');
  if (exLeftCol) autoFitLeftCol(exLeftCol);
  // slide-desc는 숨김 (사용 안 함)
  const exDescEl = document.getElementById('ex-slide-desc');
  if (exDescEl) { exDescEl.innerHTML = ''; exDescEl.classList.add('hidden'); }

  // 상세 설명
  const detail = CHAR_DETAILS[c.type];
  const blocksEl = document.getElementById('ex-slide-detail-blocks');
  const bodyEl = document.getElementById('ex-slide-detail-body');
  // 좌측 컬럼 플레이버 텍스트 (교환 드래프트)
  const exFlavorEl = document.getElementById('ex-slide-flavor');
  if (exFlavorEl) exFlavorEl.textContent = (detail && detail.flavor) ? detail.flavor : '';
  // 캐릭터 개성 그래프 (오각형 레이더)
  renderStatRadar(c.type, document.getElementById('ex-slide-stat-radar'));

  if (detail) {
    const hasPerBlockDesc = detail.blocks.some(b => b.desc);
    const renderHeadLine = (b) => {
      const cls = b.headCls || '';
      const name = cls
        ? `<span class="slide-skill-name ${cls}">${b.head}</span>`
        : `<span class="slide-skill-name slide-skill-none">${b.head}</span>`;
      const tag = b.tag || '';
      const sp = (b.sp != null) ? `<span class="slide-sp-box">${spLabel(b.sp)}</span>` : '';
      return `<div class="slide-head-line">${name}${tag}${sp}</div>`;
    };
    if (hasPerBlockDesc) {
      blocksEl.innerHTML = detail.blocks.map(b => {
        return `<div style="margin-bottom:10px">` +
          renderHeadLine(b) +
          (b.desc ? `<div class="slide-detail-body" style="margin-top:4px">${b.desc}</div>` : '') +
          `</div>`;
      }).join('');
      bodyEl.textContent = '';
    } else {
      blocksEl.innerHTML = detail.blocks.map(renderHeadLine).join('');
      bodyEl.innerHTML = detail.body || '';
    }
  } else {
    blocksEl.innerHTML = '';
    bodyEl.innerHTML = '';
  }

  // 공격 범위 미리보기 (ex용)
  exUpdatePreview(c);

  document.querySelectorAll('#ex-icon-index .icon-index-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === exSlideIndex);
  });

  // 슬라이드 뷰어 어둡게 (다른 티어이고 이미 교체한 경우)
  const slideViewer = document.querySelector('#screen-exchange .slide-viewer');
  const iconIndex = document.getElementById('ex-icon-index');
  const stepIndicator = document.getElementById('ex-step-indicator');
  const isDimmedTier = S.exSwapped && S.exSwapped.tier !== tier;
  if (slideViewer) slideViewer.classList.toggle('slide-dimmed', !!isDimmedTier);
  if (iconIndex) iconIndex.classList.toggle('slide-dimmed', !!isDimmedTier);
  if (stepIndicator) stepIndicator.classList.toggle('slide-dimmed', !!S.exSwapped);

  // 교체 선택 버튼 상태 업데이트
  const exSelectBtn = document.getElementById('btn-ex-select');
  if (exSelectBtn) {
    const isCurrentDraft = c.type === S.exMyDraft[myKey]; // 현재 이 티어에 배정된 캐릭터인가
    const isOriginal = c.type === S.exOriginalDraft[myKey];
    const isCurrentSwap = S.exSwapped && S.exSwapped.tier === tier && S.exSwapped.newType === c.type;
    const canSwap = !S.exSwapped || S.exSwapped.tier === tier;

    // 초기화
    exSelectBtn.style.opacity = '';
    exSelectBtn.style.pointerEvents = '';

    if (isCurrentDraft && !isCurrentSwap) {
      // 이 티어에 현재 배정된 캐릭터 (변동 없음) → "현재 선택" (파란색 강조)
      exSelectBtn.textContent = '✔ 현재 선택';
      exSelectBtn.className = 'btn btn-select-char btn-current-select';
    } else if (isCurrentSwap) {
      // 이미 이 캐릭터로 교체한 상태
      exSelectBtn.textContent = '✔ 교체 선택됨';
      exSelectBtn.className = 'btn btn-select-char btn-current-select';
    } else if (isOriginal && S.exSwapped && S.exSwapped.tier === tier) {
      // 다른 캐릭터로 교체한 상태에서 원래 캐릭터 보기 → "원래대로 되돌리기"
      exSelectBtn.textContent = '↩ 원래대로 되돌리기';
      exSelectBtn.className = 'btn btn-accent btn-select-char';
    } else if (!canSwap) {
      // 다른 티어에서 이미 교환함 → 교환 불가
      exSelectBtn.textContent = '다른 티어에서 교체함';
      exSelectBtn.className = 'btn btn-accent btn-select-char';
      exSelectBtn.style.opacity = '0.35';
      exSelectBtn.style.pointerEvents = 'none';
    } else {
      // 교체 가능
      exSelectBtn.textContent = '이 캐릭터로 교체';
      exSelectBtn.className = 'btn btn-accent btn-select-char';
    }
  }
  exUpdateSlots();
  exUpdateConfirmBtn();

  // 슬라이드 애니메이션
  const content = document.getElementById('ex-slide-content');
  if (content) { content.style.animation = 'none'; content.offsetHeight; content.style.animation = ''; }
}

// 교환/팀전 슬라이드도 동일한 미리보기 모드(공격/스킬) 지원
let exSlidePreviewMode = 'attack';
(function bindExPreviewTabs(){
  const tabs = document.querySelectorAll('.ex-preview-tabs .slide-preview-tab');
  if (!tabs.length) return;
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      exSlidePreviewMode = tab.dataset.mode;
      // 그리드만 부분 갱신 — 슬라이드 전체 재렌더 X.
      //   ※ 버그 수정: 이전 구현은 S.characters[1..3] 전체 30개를 flatten 한 뒤 exSlideIndex 로 인덱싱했는데,
      //     exSlideIndex 는 현재 티어의 _exAllChars(약 10개) 안의 인덱스라서 완전히 다른 캐릭터를 불러옴.
      //     올바른 소스는 S._exAllChars 임.
      try {
        const all = S._exAllChars || [];
        const idx = (typeof exSlideIndex === 'number') ? exSlideIndex : 0;
        const c = all[idx];
        if (c) exUpdatePreview(c);
      } catch (e) {}
    });
  });
})();
function exUpdatePreview(charData) {
  const board = document.getElementById('ex-preview-board');
  if (!board) return;
  const infoEl = document.getElementById('ex-preview-info');

  // 탭 상태 동기화
  const tabs = document.querySelectorAll('.ex-preview-tabs .slide-preview-tab');
  const hasSkill = hasSkillPreview(charData);
  tabs.forEach(t => {
    const m = t.dataset.mode;
    t.classList.toggle('active', m === exSlidePreviewMode && (m === 'attack' || hasSkill));
    if (m === 'skill') t.disabled = !hasSkill;
  });
  const effectiveMode = (exSlidePreviewMode === 'skill' && hasSkill) ? 'skill' : 'attack';

  // 스킬 미리보기 모드
  if (effectiveMode === 'skill' && hasSkill) {
    const skill = SKILL_PREVIEW[charData.type];
    const centerCol = 2, centerRow = 2;
    // 쌍둥이 합류 — 색 분리 (누나=공격, 동생=보라/스킬)
    if (skill.joinedTwins) {
      const elderRange = getAttackCells('twins_elder', centerCol, centerRow);
      const youngerRange = getAttackCells('twins_younger', centerCol, centerRow);
      const elderSet = new Set(elderRange.map(c => `${c.col},${c.row}`));
      const youngerSet = new Set(youngerRange.map(c => `${c.col},${c.row}`));
      board.querySelectorAll('.cell').forEach(cell => {
        const col = parseInt(cell.dataset.col); const row = parseInt(cell.dataset.row);
        cell.className = 'cell'; cell.innerHTML = '';
        if (col === centerCol && row === centerRow) {
          cell.innerHTML = `<span style="font-size:1rem">👫</span>`;
          cell.classList.add('has-piece');
        }
        const inE = elderSet.has(`${col},${row}`);
        const inY = youngerSet.has(`${col},${row}`);
        if (inE && inY) cell.classList.add('attack-range');
        else if (inE) cell.classList.add('attack-range');
        else if (inY) cell.classList.add('skill-range');
      });
      infoEl.textContent = skill.label;
      return;
    }
    const cells = skill.cells(centerCol, centerRow);
    const cellsSet = new Set(cells.map(c => `${c.col},${c.row}`));
    const ratSet = skill.showRats
      ? new Set(cells.filter(c => !(c.col === centerCol && c.row === centerRow)).map(c => `${c.col},${c.row}`))
      : null;
    board.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col); const row = parseInt(cell.dataset.row);
      cell.className = 'cell'; cell.innerHTML = '';
      if (col === centerCol && row === centerRow) {
        let centerIcon = charData.icon;
        if (skill.showDragonOnly) centerIcon = '🐲';
        cell.innerHTML = `<span style="font-size:1rem">${centerIcon}</span>`;
        cell.classList.add('has-piece');
      } else if (ratSet && ratSet.has(`${col},${row}`)) {
        // 실제 게임처럼 작게 + 우상단 코너에 배치
        cell.innerHTML = `<span style="position:absolute;top:1px;right:2px;font-size:0.5rem;color:#52b788">🐀</span>`;
      }
      if (cellsSet.has(`${col},${row}`)) cell.classList.add('skill-preview-' + skill.cat);
    });
    infoEl.textContent = skill.label;
    return;
  }

  // 공격 범위 — 쌍둥이는 누나/동생 분리
  if (charData.isTwin) {
    const elderCol = 1, elderRow = 2;
    const youngerCol = 3, youngerRow = 2;
    const rangeE = getAttackCells('twins_elder', elderCol, elderRow);
    const rangeY = getAttackCells('twins_younger', youngerCol, youngerRow);
    board.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col); const row = parseInt(cell.dataset.row);
      cell.className = 'cell'; cell.innerHTML = '';
      if (col === elderCol && row === elderRow) { cell.innerHTML = `<span style="font-size:1rem">👧</span>`; cell.classList.add('has-piece'); }
      if (col === youngerCol && row === youngerRow) { cell.innerHTML = `<span style="font-size:1rem">👦</span>`; cell.classList.add('has-piece'); }
      const inE = rangeE.some(c => c.col === col && c.row === row);
      const inY = rangeY.some(c => c.col === col && c.row === row);
      if (inE || inY) cell.classList.add(inE ? 'attack-range' : 'skill-range');
    });
    infoEl.textContent = shouldShowDesc(charData) ? charData.desc : '';
    return;
  }

  const centerCol = 2, centerRow = 2;
  const range = getAttackCells(charData.type, centerCol, centerRow);
  board.querySelectorAll('.cell').forEach(cell => {
    const col = parseInt(cell.dataset.col); const row = parseInt(cell.dataset.row);
    cell.className = 'cell'; cell.innerHTML = '';
    const inRange = range.some(c => c.col === col && c.row === row);
    if (col === centerCol && row === centerRow) {
      cell.innerHTML = `<span style="font-size:1rem">${charData.icon}</span>`;
      cell.classList.add('has-piece');
      // 제자리 공격범위 추가 강조 제거 — 쌍둥이처럼 attack-range 단일 표현으로 통일.
    }
    if (inRange) cell.classList.add('attack-range');
  });
  infoEl.textContent = shouldShowDesc(charData) ? charData.desc : '';
}

function exUpdateSlots() {
  for (const [key, tier] of [['t1', 1], ['t2', 2], ['t3', 3]]) {
    const slot = document.getElementById(`ex-slot-${tier}`);
    if (!slot) continue;
    const type = S.exMyDraft[key];
    const ch = findLocalChar(type, tier);
    const isSwapped = S.exSwapped && S.exSwapped.tier === tier;
    const isOriginal = type === S.exOriginalDraft[key];
    if (ch) {
      slot.className = `draft-slot filled${isSwapped ? ' swapped' : ''}`;
      slot.innerHTML = `
        <span class="slot-tier">${tier}티어</span>
        <span class="slot-icon">${ch.icon}</span>
        <div class="slot-info">
          <span class="slot-name">${ch.name} ${ch.tag ? tagBadgeHtml(ch.tag) : ''}</span>
          <div>${buildMiniHeaders(ch)}</div>
        </div>`;
      // 교체된 슬롯에만 X 버튼 (원래대로 되돌리기)
      if (isSwapped) {
        const xBtn = document.createElement('span');
        xBtn.className = 'slot-remove';
        xBtn.title = '교체 취소';
        xBtn.textContent = '×';
        xBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          S.exSwapped = null;
          S.exMyDraft[key] = S.exOriginalDraft[key];
          S.exchangeSelected = null;
          exUpdateSlots();
          exUpdateConfirmBtn();
          exRenderSlide();
        });
        slot.appendChild(xBtn);
      }
      slot.style.cursor = 'pointer';
      slot.onclick = (e) => {
        if (e.target.classList.contains('slot-remove')) return;
        exCurrentTier = tier; exSlideIndex = 0; exBuildStepUI();
      };
    } else {
      slot.className = 'draft-slot empty';
      slot.innerHTML = `<span class="slot-tier">${tier}티어</span><span class="slot-empty-text">미선택</span>`;
      slot.onclick = () => { exCurrentTier = tier; exSlideIndex = 0; exBuildStepUI(); };
    }
    // 현재 보고 있는 티어 강조 + 교체된 슬롯 황금 글로우
    if (tier === exCurrentTier) {
      slot.style.borderColor = 'var(--accent)';
      slot.style.boxShadow = isSwapped ? '0 0 12px rgba(226,168,75,0.6)' : '0 0 8px rgba(226,168,75,0.2)';
    } else if (isSwapped) {
      slot.style.borderColor = 'var(--accent)';
      slot.style.boxShadow = '0 0 12px rgba(226,168,75,0.6)';
    } else {
      slot.style.borderColor = '';
      slot.style.boxShadow = '';
    }
    // Task #4: 교체 확정 시 다른 티어 흐리게
    if (S.exSwapped && !isSwapped) {
      slot.classList.add('exchange-dimmed');
    } else {
      slot.classList.remove('exchange-dimmed');
    }
  }
}

function exUpdateConfirmBtn() {
  const btn = document.getElementById('btn-exchange-confirm');
  btn.textContent = '최종 출격';
  btn.disabled = false;
}

// 교환 드래프트 슬라이드 화살표
document.getElementById('btn-ex-slide-prev').addEventListener('click', () => {
  if (!S._exAllChars) return;
  exSlideIndex = (exSlideIndex - 1 + S._exAllChars.length) % S._exAllChars.length;
  exRenderSlide();
});
document.getElementById('btn-ex-slide-next').addEventListener('click', () => {
  if (!S._exAllChars) return;
  exSlideIndex = (exSlideIndex + 1) % S._exAllChars.length;
  exRenderSlide();
});

// 교환 드래프트 — 선택 상태만 부분 업데이트 (캐릭터 슬라이드는 그대로)
function exUpdateSelectionState() {
  const allChars = S._exAllChars;
  if (!allChars || !allChars[exSlideIndex]) return;
  const c = allChars[exSlideIndex];
  const tier = exCurrentTier;
  const myKey = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';

  // 1) dim 상태 (교체 완료 후 다른 티어 어둡게)
  const slideViewer = document.querySelector('#screen-exchange .slide-viewer');
  const iconIndex = document.getElementById('ex-icon-index');
  const stepIndicator = document.getElementById('ex-step-indicator');
  const isDimmedTier = S.exSwapped && S.exSwapped.tier !== tier;
  if (slideViewer) slideViewer.classList.toggle('slide-dimmed', !!isDimmedTier);
  if (iconIndex) iconIndex.classList.toggle('slide-dimmed', !!isDimmedTier);
  if (stepIndicator) stepIndicator.classList.toggle('slide-dimmed', !!S.exSwapped);

  // 2) 선택 버튼 라벨/클래스
  const exSelectBtn = document.getElementById('btn-ex-select');
  if (exSelectBtn) {
    const isCurrentDraft = c.type === S.exMyDraft[myKey];
    const isOriginal = c.type === S.exOriginalDraft[myKey];
    const isCurrentSwap = S.exSwapped && S.exSwapped.tier === tier && S.exSwapped.newType === c.type;
    const canSwap = !S.exSwapped || S.exSwapped.tier === tier;
    exSelectBtn.style.opacity = '';
    exSelectBtn.style.pointerEvents = '';
    if (isCurrentDraft && !isCurrentSwap) {
      exSelectBtn.textContent = '✔ 현재 선택';
      exSelectBtn.className = 'btn btn-select-char btn-current-select';
    } else if (isCurrentSwap) {
      exSelectBtn.textContent = '✔ 교체 선택됨';
      exSelectBtn.className = 'btn btn-select-char btn-current-select';
    } else if (canSwap) {
      exSelectBtn.textContent = isOriginal ? '↩ 원래대로 되돌리기' : '🔄 이 캐릭터로 교체';
      exSelectBtn.className = 'btn btn-accent btn-select-char';
    } else {
      exSelectBtn.textContent = '🔒 다른 티어 교체됨';
      exSelectBtn.className = 'btn btn-accent btn-select-char';
      exSelectBtn.style.opacity = '0.4';
      exSelectBtn.style.pointerEvents = 'none';
    }
  }

  // 3) 슬롯 표시 갱신 (1티어/2티어/3티어 카드 미리보기)
  if (typeof exUpdateSlots === 'function') exUpdateSlots();
}

// 교환 드래프트 캐릭터 선택 버튼
document.getElementById('btn-ex-select').addEventListener('click', () => {
  const allChars = S._exAllChars;
  if (!allChars || !allChars[exSlideIndex]) return;
  const c = allChars[exSlideIndex];
  const tier = exCurrentTier;
  const myKey = tier === 1 ? 't1' : tier === 2 ? 't2' : 't3';
  const isOriginal = c.type === S.exOriginalDraft[myKey];
  const canSwap = !S.exSwapped || S.exSwapped.tier === tier;

  if (!canSwap && !isOriginal) return; // 다른 티어에서 교환 완료 — 불가

  if (isOriginal) {
    if (S.exSwapped && S.exSwapped.tier === tier) {
      S.exSwapped = null;
      S.exMyDraft[myKey] = S.exOriginalDraft[myKey];
      S.exchangeSelected = null;
    }
  } else {
    S.exSwapped = { tier, newType: c.type };
    S.exMyDraft[myKey] = c.type;
    S.exchangeSelected = { tier, newType: c.type };
  }
  // 슬라이드 콘텐츠는 그대로 — 선택 상태만 부분 업데이트
  exUpdateSelectionState();
});

document.getElementById('btn-exchange-confirm').addEventListener('click', () => {
  if (!S.exchangeSelected) {
    document.getElementById('exchange-noswap-modal').classList.remove('hidden');
    return;
  }
  socket.emit('exchange_pick', { tier: S.exchangeSelected.tier, newType: S.exchangeSelected.newType });
  // 즉시 교환 오버레이 슬라이드 아웃 → 뒤의 교체 페이즈(공개 화면)로 복귀.
  //   서버 응답 (ai_decision_wait 또는 final_reveal_phase) 을 그 화면에서 받음:
  //   - 상대 미완료 → 상대 카드 슬롯 위에 대기 카운트다운
  //   - 상대 완료 / 교체 안 함 → 즉시 swap-reveal 애니메이션
  if (typeof closeOverlayScreen === 'function') closeOverlayScreen('screen-exchange');
});
document.getElementById('exchange-noswap-confirm').addEventListener('click', () => {
  document.getElementById('exchange-noswap-modal').classList.add('hidden');
  socket.emit('exchange_pick', {});
  if (typeof closeOverlayScreen === 'function') closeOverlayScreen('screen-exchange');
});
document.getElementById('exchange-noswap-cancel').addEventListener('click', () => {
  document.getElementById('exchange-noswap-modal').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════
// ── 최종 공개 UI ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildFinalRevealUI(myDraft, oppChars) {
  renderProgressStepper('screen-final-reveal', 'final_reveal');
  document.getElementById('frev-my-name').textContent = S.myName || '나';
  document.getElementById('frev-opp-name').textContent = S.opponentName || '상대방';

  const myContainer = document.getElementById('frev-my-chars');
  const oppContainer = document.getElementById('frev-opp-chars');
  myContainer.innerHTML = '';
  oppContainer.innerHTML = '';

  const btn = document.getElementById('btn-frev-confirm');
  btn.disabled = true;
  btn.style.opacity = '0';
  btn.textContent = 'HP 분배로';

  // 교체 여부 판단
  const initialDeck = loadDeck();
  const initialOpp = S.oppRevealChars || [];
  let myExchanged = false;
  let oppExchanged = false;

  // 카드 데이터 준비
  const myCards = [];
  for (const [key, tier] of [['t1', 1], ['t2', 2], ['t3', 3]]) {
    const type = myDraft[key];
    const ch = findLocalChar(type, tier);
    const wasExchanged = initialDeck && initialDeck[key] && initialDeck[key] !== type;
    if (wasExchanged) myExchanged = true;
    if (ch) myCards.push({ ch, tier, wasExchanged });
  }
  const oppCards = [];
  for (const ch of oppChars) {
    const initial = initialOpp.find(o => o.tier === ch.tier);
    const wasExchanged = initial && initial.type !== ch.type;
    if (wasExchanged) oppExchanged = true;
    oppCards.push({ ch, tier: ch.tier, wasExchanged });
  }

  // 빈 슬롯 3개 + "교체하지 않음" 라벨 placeholder 미리 생성 (레이아웃 완전 고정)
  for (let i = 0; i < 3; i++) {
    const ms = document.createElement('div'); ms.className = 'reveal-slot-empty';
    myContainer.appendChild(ms);
    const os = document.createElement('div'); os.className = 'reveal-slot-empty';
    oppContainer.appendChild(os);
  }
  // 라벨은 반드시 양쪽 동일하게 처음부터 존재 (보이기/안보이기만 토글)
  const myLabel = document.createElement('div');
  myLabel.className = 'no-exchange-label invisible-placeholder';
  myLabel.textContent = '교체하지 않음';
  myContainer.appendChild(myLabel);
  const oppLabel = document.createElement('div');
  oppLabel.className = 'no-exchange-label invisible-placeholder';
  oppLabel.textContent = '교체하지 않음';
  oppContainer.appendChild(oppLabel);

  // 슬롯 등장 타이밍: 첫 0.5s, 이후 0.75s 간격 (좌우 동시)
  const mySlots = myContainer.querySelectorAll('.reveal-slot-empty');
  const oppSlots = oppContainer.querySelectorAll('.reveal-slot-empty');
  const delays = [500, 1250, 2000];
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      // 교체된 캐릭터 등장 시 삐로~ 사운드, 일반은 둥-
      const hasSwap = (myCards[i]?.wasExchanged) || (oppCards[i]?.wasExchanged);
      if (hasSwap) {
        playSfxSwapBlink();
        setTimeout(() => playSfxSwapReveal(), 400);
      } else {
        playSfxRevealAppear();
      }

      if (myCards[i]) {
        const { ch, tier, wasExchanged } = myCards[i];
        const card = createDraftRevealCard(ch, tier, 'left', '');
        card.style.animation = 'revealSlide 0.5s ease-out both';
        if (wasExchanged) card.classList.add('exchanged-highlight');
        mySlots[i].replaceWith(card);
      }
      if (oppCards[i]) {
        const { ch, tier, wasExchanged } = oppCards[i];
        const card = createDraftRevealCard(ch, tier, 'right', '');
        card.style.animation = 'revealSlide 0.5s ease-out both';
        if (wasExchanged) card.classList.add('exchanged-highlight');
        oppSlots[i].replaceWith(card);
      }
    }, delays[i]);
  }

  // 모든 등장 후 라벨 visibility 토글 (높이 변화 없음 — 이미 placeholder로 예약됨)
  setTimeout(() => {
    if (!myExchanged) myLabel.classList.remove('invisible-placeholder');
    if (!oppExchanged) oppLabel.classList.remove('invisible-placeholder');
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.animation = 'revealSlide 0.5s ease-out both';
  }, 2500);
}

document.getElementById('btn-frev-confirm').addEventListener('click', () => {
  socket.emit('confirm_final_reveal');
  document.getElementById('btn-frev-confirm').disabled = true;
  document.getElementById('btn-frev-confirm').textContent = '대기 중...';
});

// ═══════════════════════════════════════════════════════════════
// ── 배치 UI ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

let placementSelected = null;

function buildPlacementUI() {
  renderProgressStepper('screen-placement', 'placement');
  placementSelected = null;
  buildBoard('placement-board', handlePlacementCellClick);
  buildPlacementOppPanel();
  updatePlacementUI();
}

function buildPlacementOppPanel() {
  const container = document.getElementById('placement-opp-pieces');
  if (!container) return;
  const header = document.querySelector('#placement-opp-info h4');

  // 팀 모드: 오른쪽 패널 — 상단에 팀원(블루/레드 컬러), 그 아래 상대팀(반대 컬러)
  if (S.teamPlacementMode) {
    if (header) header.textContent = '';
    if (header) header.style.display = 'none';
    container.innerHTML = '';
    const myTeamColor = S.teamId === 0 ? 'blue' : 'red';
    const oppTeamColor = S.teamId === 0 ? 'red' : 'blue';
    // 1) 팀원 블록 — 내 팀 컬러로 표시 (상단)
    const teammates = S.teamPlacementTeammates || [];
    for (const tm of teammates) {
      const block = document.createElement('div');
      block.className = `placement-enemy-block placement-team-block placement-team-${myTeamColor}`;
      block.innerHTML = `<h5 class="enemy-block-header team-color-${myTeamColor}">${escapeHtmlGlobal(tm.name)}</h5>`;
      for (const pc of (tm.pieces || [])) {
        const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
        const card = document.createElement('div');
        card.className = `placement-opp-card placement-team-card placement-team-card-${myTeamColor}`;
        card.style.position = 'relative';
        const placedHp = (pc.col >= 0 && pc.row >= 0) ? `HP ${pc.hp}` : `HP ${pc.maxHp ?? pc.hp}`;
        card.innerHTML = `
          <span class="char-icon">${pc.icon}</span>
          <div class="opp-info">
            <strong>${pc.name}${tagHtml}</strong>
            <span>T${pc.tier} · ATK ${pc.atk} · ${placedHp}</span>
          </div>`;
        const tooltip = buildPieceTooltip(pc, 'left');
        card.appendChild(tooltip);
        block.appendChild(card);
      }
      container.appendChild(block);
    }
    // 2) 상대팀 블록 — 반대 팀 컬러
    const enemies = S.teamPlacementEnemies || [];
    if (enemies.length === 0 && teammates.length === 0) {
      container.innerHTML = '<p class="muted" style="font-size:0.78rem">팀 정보 없음</p>';
      return;
    }
    for (const en of enemies) {
      const block = document.createElement('div');
      block.className = `placement-enemy-block placement-team-block placement-team-${oppTeamColor}`;
      block.innerHTML = `<h5 class="enemy-block-header team-color-${oppTeamColor}">${escapeHtmlGlobal(en.name)}</h5>`;
      for (const pc of (en.pieces || [])) {
        const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
        const card = document.createElement('div');
        card.className = `placement-opp-card placement-team-card placement-team-card-${oppTeamColor}`;
        card.style.position = 'relative';
        card.innerHTML = `
          <span class="char-icon">${pc.icon}</span>
          <div class="opp-info">
            <strong>${pc.name}${tagHtml}</strong>
            <span>T${pc.tier} · ATK ${pc.atk} · HP ${pc.hp}</span>
          </div>`;
        const tooltip = buildPieceTooltip(pc, 'right');
        card.appendChild(tooltip);
        block.appendChild(card);
      }
      container.appendChild(block);
    }
    return;
  }

  if (header) header.textContent = '상대방 캐릭터';
  if (!S.oppPieces || S.oppPieces.length === 0) return;
  container.innerHTML = '';
  for (const pc of S.oppPieces) {
    const card = document.createElement('div');
    card.className = 'placement-opp-card';
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const skillDesc = getSkillDescForPiece(pc);
    const skillHtml = pc.hasSkill
      ? `<span class="skill-line">스킬: ${pc.skillName} (${pc.skillCost || '?'}SP) — ${skillDesc}</span>`
      : '';
    const passiveDesc = pc.passives && pc.passives.length > 0 ? getPassiveLabel(pc.passives[0]) : '';
    const passiveHtml = pc.passiveName
      ? `<span class="passive-line">패시브: ${passiveDesc}</span>`
      : '';
    card.style.position = 'relative';
    card.innerHTML = `
      <span class="char-icon">${pc.icon}</span>
      <div class="opp-info">
        <strong>${pc.name}${tagHtml}</strong>
        <span>${pc.tier}티어 · ATK ${pc.atk}</span>
        <div>${buildMiniHeaders(pc)}</div>
      </div>`;

    // 호버 팝업 (바깥 방향 = 오른쪽)
    const tooltip = buildPieceTooltip(pc, 'right');
    card.appendChild(tooltip);

    container.appendChild(card);
  }
}

function updatePlacementUI() {
  // 팀 모드: 오른쪽 상대팀 패널 갱신
  if (S.teamPlacementMode && typeof buildPlacementOppPanel === 'function') {
    buildPlacementOppPanel();
  }
  const list = document.getElementById('placement-piece-list');
  list.innerHTML = '';

  // 내 pieces 렌더
  renderPlacementPieceCards(list, S.myPieces, /*interactive=*/true, null);

  // 팀 모드: 팀원 pieces는 buildPlacementOppPanel에서 상대팀 위에 함께 표시됨 (내 패널 X)

  // 확정 버튼 상태 (내 것만)
  const allPlaced = S.myPieces.every(p => p.col >= 0);
  document.getElementById('btn-placement-confirm').disabled = !allPlaced;
  updatePlacementBoard();
}

// 배치 UI 카드 렌더 (내 것 or 팀원)
function renderPlacementPieceCards(container, pieces, interactive, ownerName) {
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    const placed = pc.col >= 0;
    const card = document.createElement('div');
    const selectedCls = (interactive && placementSelected === i) ? 'selected' : '';
    const teammateCls = interactive ? '' : 'teammate-piece-card';
    card.className = `piece-card placement-detail-card ${placed ? 'placed' : ''} ${selectedCls} ${teammateCls}`;
    const grid = buildMiniRangeGrid(pc.type, { toggleState: pc.toggleState }, pc.icon);
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    // 스킬/패시브 정보 — 캐릭터 슬라이드(buildPieceTooltip)와 동일한 미니헤더 스타일로 통일.
    //   slide-head-line + slide-skill-name (mini-header-XXX 색상이 곧 스킬 유형) + slide-sp-box (SP 비용)
    //   별도 "(N SP)" 괄호 텍스트나 "스킬:" prefix 사용 안 함 — 색상·박스가 정보를 전달.
    const spBoxFor = (cost) => `<span class="slide-sp-box">${(typeof spLabel === 'function') ? spLabel(cost) : ('SP ' + cost)}</span>`;
    const headClassFor = (sk) => {
      if (!sk) return 'mini-header-action';
      if (sk.replacesAction) return 'mini-header-action';
      if (sk.oncePerTurn) return 'mini-header-once';
      return 'mini-header-free';
    };
    let skillHtml = '';
    if (pc.skills && pc.skills.length > 0) {
      for (const sk of pc.skills) {
        const cls = headClassFor(sk);
        skillHtml += `<div class="slide-head-line">` +
          `<span class="slide-skill-name ${cls}">${sk.name}</span>` +
          spBoxFor(sk.cost) +
          `</div>`;
        skillHtml += `<div class="slide-detail-body">${sk.desc}</div>`;
      }
    } else if (pc.hasSkill) {
      const cls = pc.skillReplacesAction ? 'mini-header-action' : (pc.skillOncePerTurn ? 'mini-header-once' : 'mini-header-free');
      const skillDesc = getSkillDescForPiece(pc);
      skillHtml = `<div class="slide-head-line">` +
        `<span class="slide-skill-name ${cls}">${pc.skillName}</span>` +
        spBoxFor(pc.skillCost) +
        `</div>`;
      skillHtml += `<div class="slide-detail-body">${skillDesc}</div>`;
    }
    let passiveHtml = '';
    if (pc.passives && pc.passives.length > 0) {
      for (const pid of pc.passives) {
        const name = getPassiveName(pid);
        const desc = getPassiveLabel(pid);
        passiveHtml += `<div class="slide-head-line">` +
          `<span class="slide-skill-name mini-header-passive">${name}</span>` +
          `</div>`;
        passiveHtml += `<div class="slide-detail-body">${desc}</div>`;
      }
    } else if (pc.passiveName) {
      passiveHtml = `<div class="slide-head-line">` +
        `<span class="slide-skill-name mini-header-passive">${pc.passiveName}</span>` +
        `</div>`;
    }
    const hasAnySkill = (pc.skills && pc.skills.length > 0) || pc.hasSkill;
    const hasAnyPassive = (pc.passives && pc.passives.length > 0) || pc.passiveName;

    card.innerHTML = `
      <div class="placement-card-header">
        <span class="piece-icon">${pc.icon}</span>
        <div class="piece-info">
          <strong>${pc.name} ${tagHtml}</strong>
          <span>T${pc.tier} · ATK ${pc.atk} · HP ${pc.hp}</span>
          ${placed ? `<span style="color:var(--success);font-size:0.7rem"> ✓ ${coord(pc.col,pc.row)}</span>` : ''}
        </div>
      </div>
      <div class="placement-card-detail">
        <div class="placement-grid-section">
          <div class="placement-grid-label">공격 범위</div>
          ${grid}
        </div>
        <div class="placement-info-section">
          ${!hasAnySkill && !hasAnyPassive ? '<div class="slide-head-line" style="color:var(--muted)">스킬 없음</div>' : ''}
          ${skillHtml}
          ${passiveHtml}
        </div>
      </div>`;
    if (interactive) {
      card.addEventListener('click', () => {
        placementSelected = placementSelected === i ? null : i;
        updatePlacementUI();
      });
    }
    container.appendChild(card);
  }
}

function updatePlacementBoard() {
  const board = document.getElementById('placement-board');
  if (!board) return;

  // 내 공격 범위 통합
  const atkSet = new Set();
  for (const pc of S.myPieces) {
    if (pc.col >= 0) {
      const cells = getAttackCells(pc.type, pc.col, pc.row, { toggleState: pc.toggleState });
      for (const c of cells) atkSet.add(`${c.col},${c.row}`);
    }
  }
  // 팀원 공격 범위도 추가 (팀 모드)
  const tmAtkSet = new Set();
  if (S.teamPlacementMode && S.teamPlacementTeammates) {
    for (const tm of S.teamPlacementTeammates) {
      for (const pc of (tm.pieces || [])) {
        if (pc.col >= 0) {
          const cells = getAttackCells(pc.type, pc.col, pc.row, { toggleState: pc.toggleState });
          for (const c of cells) tmAtkSet.add(`${c.col},${c.row}`);
        }
      }
    }
  }
  // 팀원 pieces 맵
  const teammateAt = {};
  if (S.teamPlacementMode && S.teamPlacementTeammates) {
    for (const tm of S.teamPlacementTeammates) {
      for (const pc of (tm.pieces || [])) {
        if (pc.col >= 0) teammateAt[`${pc.col},${pc.row}`] = { piece: pc, ownerName: tm.name };
      }
    }
  }

  const bounds = S.boardBounds || { min: 0, max: 4 };
  board.querySelectorAll('.cell').forEach(cell => {
    const col = parseInt(cell.dataset.col);
    const row = parseInt(cell.dataset.row);
    cell.className = 'cell';
    cell.innerHTML = `<span class="coord-label">${coord(col,row)}</span>`;

    // 파괴된 셀 (범위 밖) — 팀모드 7x7에서 bounds 밖일 수 있음
    if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) {
      cell.classList.add('destroyed');
      return;
    }

    // 공격 범위 표시 (내 + 팀원 통합)
    if (atkSet.has(`${col},${row}`) || tmAtkSet.has(`${col},${row}`)) {
      cell.classList.add('attack-range');
    }

    // 팀원 말 표시 (파랑/다른 스타일)
    const tmOcc = teammateAt[`${col},${row}`];
    if (tmOcc) {
      cell.innerHTML += `<div class="piece-marker teammate-piece"><span class="p-icon">${tmOcc.piece.icon}</span></div>`;
      cell.classList.add('has-teammate-piece');
      return;
    }

    const pc = S.myPieces.find(p => p.col === col && p.row === row);
    if (pc) {
      cell.innerHTML += `<div class="piece-marker"><span class="p-icon">${pc.icon}</span></div>`;
      cell.classList.add('has-piece');
      const idx = S.myPieces.indexOf(pc);
      if (idx === placementSelected) cell.classList.add('selected-piece');
    }
  });
}

function handlePlacementCellClick(col, row) {
  // 사용자 요청 #10: 클릭한 셀에 이미 배치된 내 말이 있으면, 그 말을 다시 선택 (재배치 가능 상태로)
  // 쌍둥이의 경우 같은 칸에 형/동생 둘 다 배치되므로 첫 번째 매치를 사용
  const placedHere = (S.myPieces || []).find(p => p.col === col && p.row === row);
  if (placedHere) {
    const idx = S.myPieces.indexOf(placedHere);
    placementSelected = idx;
    if (typeof updatePlacementBoard === 'function') { try { updatePlacementBoard(); } catch (e) {} }
    // 디테일 카드(우측 패널) 도 재렌더 — selected 상태 동기화
    const detailContainer = document.querySelector('#screen-placement .placement-detail-list');
    if (detailContainer && typeof renderPlacementPieceCards === 'function') {
      try { renderPlacementPieceCards(detailContainer, S.myPieces, true, myN()); } catch (e) {}
    }
    return;
  }
  if (placementSelected === null) return;
  // 팀 모드 분기
  if (S.teamPlacementMode) {
    socket.emit('team_place_piece', { pieceIdx: placementSelected, col, row });
  } else {
    socket.emit('place_piece', { pieceIdx: placementSelected, col, row });
  }
}

document.getElementById('btn-placement-confirm').addEventListener('click', () => {
  if (S.teamPlacementMode) {
    socket.emit('team_confirm_placement');
  } else {
    socket.emit('confirm_placement');
  }
  document.getElementById('btn-placement-confirm').disabled = true;
});

// ═══════════════════════════════════════════════════════════════
// ── 게임 UI ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildGameUI() {
  buildBoard('game-board', handleGameCellClick);
}

function refreshGameView() {
  updateTurnBanner();
  renderGameBoard();
  renderMyPieces();
  renderOppPieces();
}

function updateTurnBanner() {
  const banner = document.getElementById('turn-banner');
  if (!banner) return;

  // 팀전: 1v1과 동일 포맷 + 팀 레이블 + 턴 오더 표시. 색은 절대 팀 컬러로.
  if (S.isTeamMode && S.teamGamePlayers) {
    const cur = S.teamGamePlayers.find(p => p.idx === S.currentPlayerIdx);
    if (cur) {
      const isMine = cur.idx === S.playerIdx;
      const isAlly = cur.teamId === S.teamId;
      // 절대 팀 컬러 — 현재 차례 팀이 블루면 파랑, 레드면 빨강
      const teamCls = cur.teamId === 0 ? 'team-turn-blue' : 'team-turn-red';
      banner.className = 'turn-banner ' + teamCls;
      const teamLabel = cur.teamId === 0 ? '블루팀' : '레드팀';
      const whoseLabel = isMine ? '당신' : (isAlly ? `팀원 ${cur.name}` : cur.name);
      banner.innerHTML = `
        <div class="turn-banner-main">${S.turnNumber}턴 : [${teamLabel}] ${escapeHtmlGlobal(whoseLabel)}의 차례</div>
        <div class="turn-order-row">${renderTurnOrderDots()}</div>
      `;
      // 타이머 색상 — 절대 팀 컬러로
      const timerClock = document.querySelector('.timer-clock');
      if (timerClock) {
        timerClock.classList.toggle('timer-team-blue', cur.teamId === 0);
        timerClock.classList.toggle('timer-team-red', cur.teamId === 1);
        timerClock.classList.remove('my-turn-timer', 'opp-turn-timer');
      }
    }
    return;
  }

  // 1v1
  banner.className = 'turn-banner ' + (S.isMyTurn ? 'my-turn' : 'opp-turn');
  const whose = S.isMyTurn ? myN() : oppN();
  banner.textContent = `${S.turnNumber}턴 : ${whose}의 차례`;

  // 현재 턴 플레이어 패널 강조 (1v1 전용)
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');
  if (leftPanel) leftPanel.classList.toggle('turn-active', S.isMyTurn);
  if (rightPanel) rightPanel.classList.toggle('turn-active', !S.isMyTurn);

  // 타이머 색상 변경
  const timerClock = document.querySelector('.timer-clock');
  if (timerClock) {
    timerClock.classList.toggle('my-turn-timer', S.isMyTurn);
    timerClock.classList.toggle('opp-turn-timer', !S.isMyTurn);
  }
}

// 팀전 턴 오더 — 항상 4슬롯 (1·2·3·4). slotPos 데이터에 의존하지 않고
// 팀 멤버를 idx 오름차순으로 정렬해 첫번째=상단, 두번째=하단으로 강제 매핑.
//   pos 1 (좌상) = blue 팀 첫 번째 멤버
//   pos 2 (우상) = red  팀 첫 번째 멤버
//   pos 3 (좌하) = blue 팀 두 번째 멤버
//   pos 4 (우하) = red  팀 두 번째 멤버
// 게임은 항상 2v2로 시작 — 탈락자가 발생하면 같은 팀의 살아남은 멤버가 그 슬롯을 대체.
function renderTurnOrderDots() {
  const players = S.teamGamePlayers || [];
  if (players.length === 0) return '';
  // slotPos 기준 정렬 — 화면 분할 위치(top/bottom)를 따름. idx 동률 fallback.
  const teamSort = (a, b) => {
    const pa = a.slotPos ?? 99;
    const pb = b.slotPos ?? 99;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  };
  const blue = players.filter(p => p.teamId === 0).sort(teamSort);
  const red  = players.filter(p => p.teamId === 1).sort(teamSort);
  const slotOwners = [blue[0], red[0], blue[1], red[1]];
  const isElim = (p) => !!(p && (p.eliminated || (Array.isArray(p.pieces) && p.pieces.length > 0 && p.pieces.every(pc => pc && (pc.alive === false || pc.hp <= 0)))));
  const items = [];
  for (let i = 0; i < 4; i++) {
    let p = slotOwners[i];
    if (!p) continue;  // 비어있는 슬롯은 표시 안 함 (정상 4인 게임에서는 발생 X)
    if (isElim(p)) {
      const teamArr = p.teamId === 0 ? blue : red;
      const survivor = teamArr.find(pl => !isElim(pl));
      if (survivor) p = survivor;
      else continue;  // 팀 전체 탈락 — 이 시점에 게임 종료
    }
    const isMe = p.idx === S.playerIdx;
    const isCurrent = p.idx === S.currentPlayerIdx;
    const teamCls = p.teamId === 0 ? 'team-blue' : 'team-red';
    const cls = ['turn-order-dot', teamCls, isCurrent ? 'current' : '', isMe ? 'me' : ''].filter(Boolean).join(' ');
    items.push(`<span class="${cls}">${escapeHtmlGlobal(p.name)}</span>`);
  }
  return items.join('');
}

function updateSPBar() {
  // 팀전: sp 배열이 [teamA풀, teamB풀] 이므로 teamId 기반으로 인덱싱
  // 1v1: sp 배열이 [p0, p1] 이므로 playerIdx 기반 인덱싱
  const mySlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const oppSlot = 1 - mySlot;
  const mySP = S.sp[mySlot] || 0;
  const oppSP = S.sp[oppSlot] || 0;
  const myInstant = (S.instantSp && S.instantSp[mySlot]) || 0;
  const oppInstant = (S.instantSp && S.instantSp[oppSlot]) || 0;
  const total = mySP + oppSP || 1;
  // 스킬 시전 애니 중에는 spendSPAttention 이 큰 숫자/pip 트레이를 직접 관리.
  // updateSPBar 가 끼어들어 NEW 값으로 덮어쓰지 않도록 _spAnimGuard 동안 부분 스킵.
  const skipBigNumsAndTray = !!S._spAnimGuard;

  const myInstantStr = myInstant > 0 ? ` (+${myInstant}✨)` : '';
  const oppInstantStr = oppInstant > 0 ? ` (+${oppInstant}✨)` : '';
  // 팀모드 라벨: 절대 팀 컬러 기준 — 블루팀/레드팀 명시 + 컬러 매핑
  let myLabel, oppLabel;
  if (S.isTeamMode) {
    const myTeamName = S.teamId === 0 ? '블루팀' : '레드팀';
    const oppTeamName = S.teamId === 0 ? '레드팀' : '블루팀';
    myLabel = `${myTeamName} SP: ${mySP}${myInstantStr}`;
    oppLabel = `${oppTeamName} SP: ${oppSP}${oppInstantStr}`;
  } else {
    myLabel = `내 SP: ${mySP}${myInstantStr}`;
    oppLabel = `상대 SP: ${oppSP}${oppInstantStr}`;
  }
  const myLabelEl = document.getElementById('sp-my-label');
  const oppLabelEl = document.getElementById('sp-opp-label');
  if (myLabelEl) myLabelEl.textContent = myLabel;
  if (oppLabelEl) oppLabelEl.textContent = oppLabel;
  // 팀모드: 라벨 컬러를 절대 팀 컬러로 (블루는 항상 파랑, 레드는 항상 빨강)
  if (S.isTeamMode) {
    if (myLabelEl) myLabelEl.style.color = S.teamId === 0 ? '#60a5fa' : '#ef4444';
    if (oppLabelEl) oppLabelEl.style.color = S.teamId === 0 ? '#ef4444' : '#60a5fa';
  } else {
    if (myLabelEl) myLabelEl.style.color = '';
    if (oppLabelEl) oppLabelEl.style.color = '';
  }
  // v2 큰 숫자 표기 — 일반 SP만 표시 (인스턴트 SP는 카운트다운 영역으로 분리 표시)
  const myNumEl = document.getElementById('sp-my-num');
  const oppNumEl = document.getElementById('sp-opp-num');
  if (myNumEl && !skipBigNumsAndTray) {
    const newText = String(mySP);
    if (myNumEl.textContent !== newText) {
      myNumEl.textContent = newText;
      myNumEl.classList.remove('sp-bump');
      void myNumEl.offsetWidth;
      myNumEl.classList.add('sp-bump');
    }
  }
  if (oppNumEl && !skipBigNumsAndTray) {
    const newText = String(oppSP);
    if (oppNumEl.textContent !== newText) {
      oppNumEl.textContent = newText;
      oppNumEl.classList.remove('sp-bump');
      void oppNumEl.offsetWidth;
      oppNumEl.classList.add('sp-bump');
    }
  }
  if (S.isTeamMode) {
    if (myNumEl) myNumEl.style.color = S.teamId === 0 ? '#60a5fa' : '#ef4444';
    if (oppNumEl) oppNumEl.style.color = S.teamId === 0 ? '#ef4444' : '#60a5fa';
  } else {
    if (myNumEl) myNumEl.style.color = '';
    if (oppNumEl) oppNumEl.style.color = '';
  }
  // 인스턴트 SP 트레이 — 숫자 옆에 작은 황금 구슬 나열 (사용 시 숫자로 빨려 들어감)
  // 스킬 시전 애니 중에는 spendSPAttention 이 트레이의 pip 를 직접 제거 (sp-pip-consume) 하므로 sync 스킵
  if (!skipBigNumsAndTray) {
    syncInstantTray('sp-instant-tray-mine', myInstant);
    syncInstantTray('sp-instant-tray-opp', oppInstant);
  }

  const myFillEl = document.getElementById('sp-my-fill');
  const oppFillEl = document.getElementById('sp-opp-fill');
  myFillEl.style.width = `${(mySP / total) * 100}%`;
  oppFillEl.style.width = `${(oppSP / total) * 100}%`;
  // 팀모드: SP 바 fill 그라데이션을 절대 팀 컬러로 (블루팀=파랑, 레드팀=빨강)
  // 위치(좌/우 둥근 모서리)는 그대로 두고 색만 변경
  if (S.isTeamMode) {
    myFillEl.classList.toggle('sp-fill-blue', S.teamId === 0);
    myFillEl.classList.toggle('sp-fill-red', S.teamId === 1);
    oppFillEl.classList.toggle('sp-fill-blue', S.teamId === 1);
    oppFillEl.classList.toggle('sp-fill-red', S.teamId === 0);
  } else {
    myFillEl.classList.remove('sp-fill-blue', 'sp-fill-red');
    oppFillEl.classList.remove('sp-fill-blue', 'sp-fill-red');
  }

  // SP 카운트다운 표시
  const spCountdown = document.getElementById('sp-countdown');
  if (spCountdown && S.turnNumber) {
    if (S.turnNumber >= 40) {
      spCountdown.textContent = 'SP 지급 종료 · 40턴 이후';
      spCountdown.style.color = 'var(--danger)';
    } else {
      const turnsUntilSP = 10 - (S.turnNumber % 10);
      const displayTurns = turnsUntilSP === 10 ? 10 : turnsUntilSP;
      if (mySP >= 10 && oppSP >= 10) {
        spCountdown.textContent = 'SP 최대';
        spCountdown.style.color = 'var(--accent)';
      } else {
        spCountdown.textContent = `다음 SP 지급까지 ${displayTurns}턴`;
        spCountdown.style.color = 'var(--text-dim)';
      }
    }
  }
}

// 각 스킬별 실제 타겟/조건 체크 — 타겟이 하나도 없으면 false
// 특정 piece 가 이번 턴에 기본 행동(이동/공격) 을 할 수 있는지.
//   기본 행동 소진 = S.actionDone, 단 다음 예외에선 가능:
//     1) 전령 질주 활성 + 추가 이동 남음
//     2) 쌍둥이 첫 이동 후 다른 쌍둥이 (twinMovePending + 다른 sub)
//     3) 양손검객 쌍검무 활성 + 추가 공격 남음
function pieceCanTakeBasicAction(pc) {
  if (!pc || !pc.alive) return false;
  if (S.actionUsedSkillReplace) return false;
  if (pc.messengerSprintActive && pc.messengerMovesLeft > 0) return true;
  if (S.twinMovePending && pc.subUnit && S.twinMovedSub !== pc.subUnit) return true;
  if (pc.dualBladeAttacksLeft > 0) return true;
  return !S.actionDone;
}

// piece 가 스킬을 보유하는지 (사용 가능 여부와 무관 — 보유 자체).
function pieceHasAnySkill(pc) {
  if (!pc) return false;
  return !!pc.hasSkill || (Array.isArray(pc.skills) && pc.skills.length > 0);
}

// 특정 piece 가 지금 시점에 사용 가능한 스킬을 하나라도 가지고 있는지.
//   부채꼴 메뉴 스킬 버튼 활성/비활성 판정에 사용. SP / 저주 / 행동소비 / oncePerTurn / 스킬별 타겟 조건 모두 검사.
function canPieceUseAnySkill(pieceIdx) {
  const pc = S.myPieces && S.myPieces[pieceIdx];
  if (!pc || !pc.alive) return false;
  if (!pc.hasSkill && !(pc.skills && pc.skills.length > 0)) return false;
  const isCursed = pc.statusEffects && pc.statusEffects.some(e => e.type === 'curse');
  if (isCursed) return false;
  const spSlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const totalSP = ((S.sp && S.sp[spSlot]) || 0) + ((S.instantSp && S.instantSp[spSlot]) || 0);
  const skills = (pc.skills && pc.skills.length > 0)
    ? pc.skills
    : (pc.hasSkill ? [{ id: pc.skillId, cost: pc.skillCost, replacesAction: !!pc.skillReplacesAction, oncePerTurn: !!pc.skillOncePerTurn }] : []);
  for (const sk of skills) {
    if ((sk.cost || 0) > totalSP) continue;
    if (sk.replacesAction && S.actionDone) continue;
    if (sk.oncePerTurn && S.skillsUsedThisTurn && S.skillsUsedThisTurn.includes(`${pieceIdx}:${sk.id}`)) continue;
    // sprint/dualStrike 플래그 기반 사용완료 (서버는 messengerSprintActive / dualBladeAttacksLeft 로 추적)
    if (sk.id === 'sprint' && pc.messengerSprintActive) continue;
    if (sk.id === 'dualStrike' && pc.dualBladeAttacksLeft > 0) continue;
    if (!skillHasValidTarget(pc, sk)) continue;
    return true;
  }
  return false;
}

function skillHasValidTarget(piece, sk) {
  const skillId = sk.id || piece.skillId;
  const type = piece.type;
  const alive = (arr) => (arr || []).filter(p => p.alive);

  // 마녀 저주: HP>=1 + 아직 저주 안 걸린 살아있는 적이 있어야 함
  if (type === 'witch' || skillId === 'curse') {
    const candidates = alive(S.oppPieces).filter(p => p.hp >= 1 && !(p.statusEffects || []).some(e => e.type === 'curse'));
    return candidates.length > 0;
  }
  // 수도승 신성: 자신 외 살아있는 아군
  if (skillId === 'divine') {
    return alive(S.myPieces).some(p => p.type !== 'monk');
  }
  // 국왕 절대복종 반지: 살아있는 적
  if (skillId === 'ring') {
    return alive(S.oppPieces).length > 0;
  }
  // 고문 기술자 악몽: 표식 상태의 적이 1명 이상
  if (skillId === 'nightmare') {
    return alive(S.oppPieces).some(p => (p.statusEffects || []).some(e => e.type === 'mark'));
  }
  // 화약상 기폭: 설치된 폭탄이 있어야 함
  if (skillId === 'detonate') {
    return (S.boardObjects || []).some(o => o.type === 'bomb' && o.owner === S.playerIdx);
  }
  // 쥐 장수 역병의 자손들: 보드 위 쥐가 없는 빈 타일이 3곳 이상 (느슨히 1곳 이상으로도 시도 가능)
  if (skillId === 'rats') {
    const bounds = S.boardBounds || { min: 0, max: 4 };
    let emptyCount = 0;
    for (let c = bounds.min; c <= bounds.max; c++) {
      for (let r = bounds.min; r <= bounds.max; r++) {
        const hasRat = (S.boardObjects || []).some(o => o.type === 'rat' && o.col === c && o.row === r);
        if (!hasRat) emptyCount++;
      }
    }
    return emptyCount >= 1;
  }
  // 드래곤 소환: 보드에 드래곤이 없어야 + 빈 칸 존재
  if (skillId === 'dragon') {
    const myDragon = alive(S.myPieces).some(p => p.type === 'dragon' || p.isDragon);
    if (myDragon) return false;
    return true; // 빈 칸 판정은 서버에서
  }
  // 나머지 (그림자 숨기, 쌍검무, 정찰, 질주, 정비, 덫 설치, 분신, 약초학, 폭탄 설치, 유황범람)
  // — 기본적으로 자신/주변 기반이라 SP/행동 조건만 통과하면 가능
  return true;
}

function showActionBar(enabled) {
  const bar = document.getElementById('action-bar');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.style.display = 'flex';

  const btnMove = document.getElementById('btn-move');
  const btnAttack = document.getElementById('btn-attack');
  const btnSkill = document.getElementById('btn-skill');
  const btnEnd = document.getElementById('btn-end-turn');

  const btnSurrender = document.getElementById('btn-surrender');

  // 탈락 상태 감지 — 내 모든 말이 죽으면 기권 버튼을 "방 나가기"로 변환
  const myAllDead = S.myPieces && S.myPieces.length > 0 && S.myPieces.every(p => !p.alive);
  if (btnSurrender) {
    if (myAllDead) {
      btnSurrender.textContent = '방 나가기';
      btnSurrender.dataset.mode = 'leave';
      // 탈락 후엔 항상 활성화 (관전 중 아무때나 떠날 수 있게)
      btnSurrender.disabled = false;
    } else {
      btnSurrender.textContent = '기권';
      btnSurrender.dataset.mode = 'surrender';
    }
  }

  if (!enabled) {
    // 상대 턴 — 모두 비활성화 (단, 탈락한 경우 방 나가기는 가능)
    btnMove.disabled = true;
    btnAttack.disabled = true;
    btnSkill.disabled = true;
    btnEnd.disabled = true;
    btnSurrender.disabled = !myAllDead;  // 탈락 시 항상 활성
    btnMove.classList.remove('action-dimmed');
    btnAttack.classList.remove('action-dimmed');
    btnSkill.classList.remove('action-dimmed');
  } else {
    // 내 턴 — 상황에 따라 비활성화/흐림
    const alivePieces = S.myPieces ? S.myPieces.filter(p => p.alive) : [];
    const hasAlive = alivePieces.length > 0;

    // ── 이동 가능 여부 ──
    // actionDone이면 이동 불가 (이미 이동 또는 공격함)
    // 단, 전령 질주 활성 또는 쌍둥이 한쪽만 이동했을 때 추가 이동 가능
    const hasSprintMove = alivePieces.some(p => p.messengerSprintActive && p.messengerMovesLeft > 0);
    const hasTwinPending = !!S.twinMovePending;
    const canMove = hasAlive && (!S.actionDone || hasSprintMove || hasTwinPending) && !S.actionUsedSkillReplace;
    btnMove.disabled = !canMove;
    btnMove.classList.toggle('action-dimmed', !canMove);

    // ── 공격 가능 여부 ──
    // actionDone이면 공격 불가 (이미 이동 또는 공격함)
    // 이동했으면 공격 불가 (moveDone 또는 twinMovePending)
    // 단, 쌍검무 추가 공격이 남아있으면 가능
    const hasDualBlade = alivePieces.some(p => p.dualBladeAttacksLeft > 0);
    const movedAlready = S.moveDone || S.twinMovePending;
    const canAttack = hasAlive && (!S.actionDone || hasDualBlade) && !movedAlready && !S.actionUsedSkillReplace;
    btnAttack.disabled = !canAttack;
    btnAttack.classList.toggle('action-dimmed', !canAttack);

    // ── 스킬 가능 여부 ──
    // 스킬 보유 말이 살아있어야 함
    // + 사용 가능한 스킬이 하나라도 남아있는지 확인
    // 팀모드: SP 풀이 [팀A, 팀B] 인덱싱이라 S.teamId 사용 / 1v1: S.playerIdx
    const skSpSlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
    const mySp = (S.sp[skSpSlot] || 0) + (S.instantSp[skSpSlot] || 0);
    let hasUsableSkill = false;
    for (const p of alivePieces) {
      if (!p.hasSkill && (!p.skills || p.skills.length === 0)) continue;
      // 저주 상태인 말은 스킬 사용 불가
      const isCursed = p.statusEffects && p.statusEffects.some(e => e.type === 'curse');
      if (isCursed) continue;
      const skills = p.skills && p.skills.length > 0 ? p.skills : (p.hasSkill ? [{ id: p.skillId, cost: p.skillCost, replacesAction: p.skillReplacesAction, oncePerTurn: !!p.skillOncePerTurn }] : []);
      for (const sk of skills) {
        // SP 체크
        if ((sk.cost || 0) > mySp) continue;
        // 행동소비형인데 이미 행동했으면 불가
        if (sk.replacesAction && S.actionDone) continue;
        // 턴당 1회인데 이미 사용했으면 불가
        if (sk.oncePerTurn && S.skillsUsedThisTurn && S.skillsUsedThisTurn.includes(`${p.index}:${sk.id}`)) continue;
        // 스킬별 실제 대상/조건 체크
        if (!skillHasValidTarget(p, sk)) continue;
        hasUsableSkill = true;
        break;
      }
      if (hasUsableSkill) break;
    }
    btnSkill.disabled = !hasUsableSkill;
    btnSkill.classList.toggle('action-dimmed', !hasUsableSkill);

    // 턴 종료: 항상 가능
    btnEnd.disabled = false;
    // 기권: 내 턴에만 가능
    btnSurrender.disabled = false;

    // 다른 행동이 모두 막혔을 때 — 턴 종료 버튼에 펄스 강조 (사용자가 명시적으로 클릭하도록 유도)
    btnEnd.classList.toggle('pulse-end-turn', !canMove && !canAttack && !hasUsableSkill);

    // ── 자동 턴 종료 힌트 ──
    if (!canMove && !canAttack && !hasUsableSkill) {
      setActionHint('더 이상 할 수 있는 행동이 없습니다. 턴을 종료하세요.');
      return;
    }
  }
  document.getElementById('btn-cancel').classList.add('hidden');
  setActionHint(enabled ? '행동할 캐릭터의 아이콘을 클릭하세요.' : `${oppN()}의 턴입니다.`);
}

// 액션 힌트 헬퍼 — urgent=true면 빨강 볼드
function setActionHint(msg, urgent) {
  const el = document.getElementById('action-hint');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('urgent', !!urgent);
}

// ── 게임 보드 렌더링 ──────────────────────────────────────────
function renderGameBoard() {
  const board = document.getElementById('game-board');
  if (!board) return;
  const bounds = S.boardBounds;

  board.querySelectorAll('.cell').forEach(cell => {
    const col = parseInt(cell.dataset.col);
    const row = parseInt(cell.dataset.row);
    cell.className = 'cell';
    cell.innerHTML = `<span class="coord-label">${coord(col,row)}</span>`;

    // 파괴된 셀
    if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) {
      cell.classList.add('destroyed');
      return;
    }

    // 내 말
    const pc = S.myPieces.find(p => p.col === col && p.row === row && p.alive);
    if (pc) {
      const statusIcons = getStatusIcons(pc);
      // 딤 통일: 쌍둥이/쌍검무/질주 중 — 해당 piece 외 전부 흐리게
      const isTwinDimmed = S.twinMovePending && S.twinMovedSub && pc.subUnit === S.twinMovedSub;
      const dualActive = S.myPieces.find(p => p.alive && p.dualBladeAttacksLeft > 0);
      const sprintActive = S.myPieces.find(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
      const lockedDim = (dualActive && pc !== dualActive) || (sprintActive && pc !== sprintActive);
      const dimClass = isTwinDimmed ? 'twin-board-dimmed' : (lockedDim ? 'locked-board-dim' : '');
      // 남매(twins): 같은 칸에 누나·동생 둘 다 있으면 손잡은 이모지로 표시 + HP 합계
      const isTwin = pc.subUnit === 'elder' || pc.subUnit === 'younger';
      const otherTwin = isTwin ? S.myPieces.find(p => p.alive && p !== pc &&
        (p.subUnit === 'elder' || p.subUnit === 'younger') &&
        p.col === col && p.row === row) : null;
      const displayIcon = otherTwin ? '👫' : pc.icon;
      const hpText = otherTwin
        ? `${pc.hp + otherTwin.hp}/${pc.maxHp + otherTwin.maxHp}`
        : `${pc.hp}/${pc.maxHp}`;
      // 팀모드: 내 말도 팀 절대 컬러로 — 관전자/일관성을 위해
      const myTeamColorCls = S.isTeamMode ? (S.teamId === 0 ? 'piece-team-blue' : 'piece-team-red') : '';
      // 쌍둥이 dim 면제 — 사용자 요청: 둘 다 살아있는 한 쌍둥이 둘 다 항상 면제 (한 몸 취급).
      //   모드 무관 (이동·공격·스킬·twin_move) — 한쪽 쌍둥이가 선택돼도 나머지 한쪽도 함께 면제.
      //   ★ 단, twin_move 페이즈에서 분리 상태로 이미 이동을 마친 쪽은 'twin-spent' 로 dim 처리 (행동 끝난 한쪽).
      let twinPhaseCls = '';
      if (isTwin) {
        const _myOtherSub = pc.subUnit === 'elder' ? 'younger' : 'elder';
        const _myOtherAlive = (S.myPieces || []).some(p => p.subUnit === _myOtherSub && p.alive);
        if (_myOtherAlive) {
          twinPhaseCls = ' twin-active';
          // twin_move 페이즈에서 분리 상태 + 이동을 마친 쪽 → spent (dim)
          if (S.twinPhaseActive && !otherTwin && pc.subUnit === S.twinFirstSubMoved) {
            twinPhaseCls = ' twin-spent';
          }
        }
        // _myOtherAlive=false 면 외톨이 쌍둥이 — 일반 유닛처럼 dim 적용 (twinPhaseCls 빈 문자열).
      }
      const twinCls = isTwin ? (' twin-piece' + twinPhaseCls) : '';
      cell.innerHTML += `
        <div class="piece-marker${dimClass ? ' ' + dimClass : ''} ${myTeamColorCls}${twinCls}">
          <span class="p-icon">${displayIcon}</span>
          <span class="p-hp">${hpText}</span>
        </div>`;
      if (statusIcons) cell.innerHTML += `<span class="cell-mark">${statusIcons}</span>`;
      cell.classList.add('has-piece');
      if (isTwinDimmed) cell.classList.add('twin-dimmed-cell');
      else if (lockedDim) cell.classList.add('locked-dim-cell');
      const idx = S.myPieces.indexOf(pc);
      // ★ 합류 셀 글로우: 같은 칸의 어느 쌍둥이가 선택돼도 selected-piece 적용 (둘 다 쌍둥이 강도이므로)
      const otherTwinIdx = otherTwin ? S.myPieces.indexOf(otherTwin) : -1;
      if (idx === S.selectedPiece || (otherTwinIdx >= 0 && otherTwinIdx === S.selectedPiece)) {
        cell.classList.add('selected-piece');
      }
    }

    // 팀원 말 (팀전 전용) — 내 말이 같은 칸에 없을 때만 표시. 팀 절대 컬러 사용.
    if (S.isTeamMode && Array.isArray(S.teammatePieces) && !pc) {
      const tmPc = S.teammatePieces.find(p => p.col === col && p.row === row && p.alive);
      if (tmPc) {
        const isTwin = tmPc.subUnit === 'elder' || tmPc.subUnit === 'younger';
        const otherTwin = isTwin ? S.teammatePieces.find(p => p.alive && p !== tmPc &&
          (p.subUnit === 'elder' || p.subUnit === 'younger') &&
          p.col === col && p.row === row) : null;
        const tmDisplayIcon = otherTwin ? '👫' : tmPc.icon;
        const tmHpText = otherTwin
          ? `${tmPc.hp + otherTwin.hp}/${tmPc.maxHp + otherTwin.maxHp}`
          : `${tmPc.hp}/${tmPc.maxHp}`;
        const tmStatus = getStatusIcons(tmPc);
        // 팀 절대 컬러: S.teamId === 0 → 블루, 1 → 레드
        const teamColorCls = S.teamId === 0 ? 'piece-team-blue' : 'piece-team-red';
        cell.innerHTML += `
          <div class="piece-marker teammate-piece ${teamColorCls}" data-teammate-key="${tmPc.col},${tmPc.row}">
            <span class="p-icon">${tmDisplayIcon}</span>
            <span class="p-hp">${tmHpText}</span>
          </div>`;
        if (tmStatus) cell.innerHTML += `<span class="cell-mark teammate-mark">${tmStatus}</span>`;
        cell.classList.add('has-piece');
        cell.classList.add(`teammate-cell-${S.teamId === 0 ? 'blue' : 'red'}`);
      }
    }

    // 표식 상태인 적 — 위치 공개. 팀모드에선 적 팀 컬러로 표시.
    const markedOpp = S.oppPieces?.find(p => p.marked && p.alive && p.col === col && p.row === row);
    if (markedOpp && !pc) {
      // 팀모드: 적 팀 절대 컬러로 (적 팀 = 내 팀의 반대)
      let oppColorCls = '';
      if (S.isTeamMode) {
        const oppTeamId = S.teamId === 0 ? 1 : 0;
        oppColorCls = oppTeamId === 0 ? 'piece-team-blue' : 'piece-team-red';
      }
      cell.innerHTML += `
        <div class="piece-marker opp-marked ${oppColorCls}">
          <span class="p-icon">${markedOpp.icon}</span>
          <span class="p-hp">${markedOpp.hp}/${markedOpp.maxHp}</span>
        </div>`;
      cell.innerHTML += `<span class="cell-mark">🎯</span>`;
      cell.classList.add('has-piece');
    }

    // 보드 오브젝트 (내 것만 보임)
    if (S.boardObjects) {
      for (const obj of S.boardObjects) {
        if (obj.col === col && obj.row === row) {
          if (obj.type === 'trap') {
            cell.classList.add('has-trap');
            cell.innerHTML += '<span style="position:absolute;bottom:1px;right:2px;font-size:0.5rem">🪤</span>';
          }
          if (obj.type === 'bomb') cell.innerHTML += '<span style="position:absolute;top:1px;right:2px;font-size:0.5rem">💣</span>';
          if (obj.type === 'rat') {
            const isMyRat = obj.owner === S.playerIdx;
            const ratColor = isMyRat ? 'color:#52b788' : 'color:#e05252';
            const ratPos = isMyRat ? 'top:1px;right:2px' : 'bottom:1px;left:2px';
            cell.innerHTML += `<span style="position:absolute;${ratPos};font-size:0.5rem;${ratColor}">${isMyRat ? '🐀' : '🐁'}</span>`;
          }
        }
      }
    }

    // 지휘관/약초전문가 영역 표시 (초록색)
    for (const myPc of S.myPieces) {
      if (!myPc.alive) continue;
      if (myPc.type === 'commander') {
        // 지휘관: 십자 인접 4칸 버프 영역
        const adjCells = [[0,-1],[0,1],[-1,0],[1,0]];
        if (adjCells.some(([dc, dr]) => myPc.col + dc === col && myPc.row + dr === row)) {
          cell.classList.add('support-range');
        }
      }
      if (myPc.type === 'herbalist') {
        // 약초전문가: 주변 3x3 힐 영역 (자기 제외)
        const dc = Math.abs(myPc.col - col), dr = Math.abs(myPc.row - row);
        if (dc <= 1 && dr <= 1 && !(dc === 0 && dr === 0)) {
          cell.classList.add('support-range');
        }
      }
    }

    // 공격/피격 기록
    const atk = [...S.attackLog].reverse().find(a => a.col === col && a.row === row && a.turn === S.turnNumber);
    if (atk) {
      cell.classList.add(atk.hit ? 'hit-mark' : 'miss-mark');
      if (!pc) cell.innerHTML += `<span class="cell-mark">${atk.hit ? '💥' : '·'}</span>`;
    }

    // 이동 범위 — 일반 이동 / 쌍둥이 이동 페이즈 모두 동일한 십자 1칸
    if ((S.action === 'move' || S.action === 'twin_move') && S.selectedPiece !== null) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc && isCrossAdjacent(selPc.col, selPc.row, col, row) &&
          col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max) {
        cell.classList.add('move-range');
      }
    }

    // 팀원 공격 범위 오버레이 (토글)
    if (S.isTeamMode && S.teammateRangePiece) {
      const tmPc = S.teammateRangePiece;
      const extra = { toggleState: tmPc.toggleState };
      let tmRange = getAttackCells(tmPc.type, tmPc.col, tmPc.row, extra);
      if (tmPc.subUnit) {
        const otherSub = tmPc.subUnit === 'elder' ? 'younger' : 'elder';
        const ot = S.teammatePieces.find(p => p.subUnit === otherSub && p.alive);
        if (ot) {
          const otRange = getAttackCells(ot.type, ot.col, ot.row, extra);
          for (const tc of otRange) if (!tmRange.some(c => c.col === tc.col && c.row === tc.row)) tmRange.push(tc);
        }
      }
      if (tmRange.some(c => c.col === col && c.row === row)) {
        cell.classList.add('teammate-range');
      }
    }

    // 공격 범위
    if (S.action === 'attack' && S.selectedPiece !== null && !S.targetSelectMode) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc) {
        const extra = { toggleState: selPc.toggleState };
        let range = getAttackCells(selPc.type, selPc.col, selPc.row, extra);
        // ★ 쌍둥이: 다른 쪽의 공격 범위도 합산 표시
        if (selPc.subUnit) {
          const otherSub = selPc.subUnit === 'elder' ? 'younger' : 'elder';
          const otherTwin = S.myPieces.find(p => p.subUnit === otherSub && p.alive);
          if (otherTwin) {
            const twinRange = getAttackCells(otherTwin.type, otherTwin.col, otherTwin.row, extra);
            for (const tc of twinRange) {
              if (!range.some(c => c.col === tc.col && c.row === tc.row)) range.push(tc);
            }
          }
        }
        if (range.some(c => c.col === col && c.row === row)) {
          cell.classList.add('attack-range');
        }
      }
    }

    // 대상 선택 모드 (shadowAssassin: 자신 주변 9칸, witch: 전체 보드)
    if (S.targetSelectMode && S.selectedPiece !== null) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc && col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max) {
        let inRange = true;
        if (selPc.type === 'shadowAssassin') {
          inRange = Math.abs(col - selPc.col) <= 1 && Math.abs(row - selPc.row) <= 1;
        }
        if (inRange) cell.classList.add('assassin-target');
      }
    }

    // 스킬 대상 선택 모드
    if (S.action === 'skill_target' && S.skillTargetData) {
      const std = S.skillTargetData;
      let inSkillRange = false;
      if (std.type === 'bomb_place') {
        // 화약상: 자신 + 인접 8칸만 표시
        const src = S.myPieces[std.pieceIdx];
        if (src && Math.abs(col - src.col) <= 1 && Math.abs(row - src.row) <= 1 &&
            col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max) {
          inSkillRange = true;
        }
      } else {
        if (col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max) {
          inSkillRange = true;
        }
      }
      if (inSkillRange) cell.classList.add('skill-range');
    }

    // ── 추리 토큰 렌더링 ──
    const token = S.deductionTokens.find(t => t.col === col && t.row === row);
    if (token) {
      const tokenEl = document.createElement('span');
      tokenEl.className = 'deduction-token';
      tokenEl.textContent = token.icon;
      tokenEl.title = `추리: ${token.name}`;
      tokenEl.draggable = true;
      tokenEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', JSON.stringify({
          pieceKey: token.pieceKey,
          icon: token.icon,
          name: token.name,
          fromBoard: true,
          fromCol: col,
          fromRow: row
        }));
        e.dataTransfer.effectAllowed = 'move';
      });
      // 우클릭 제거
      tokenEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.deductionTokens = S.deductionTokens.filter(t => t.pieceKey !== token.pieceKey);
        refreshDeductionTokens();
        // 프로필 전체 재렌더 대신 배지만 in-place 갱신
        updateDeductionBadgesInPlace();
      });
      cell.appendChild(tokenEl);
    }

    // ── 셀 드롭 수신 ──
    cell.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) return;
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        // 같은 칸에 이미 다른 토큰이 있는 경우 처리:
        // - 보드의 기존 토큰을 옮긴 거라면 (fromBoard=true) → 두 토큰 위치 스왑
        // - 카드(프로필)에서 새로 끌어온 토큰이라면 → 기존 토큰 자동 제거(대체)
        const existingHere = S.deductionTokens.find(t => t.col === col && t.row === row && t.pieceKey !== data.pieceKey);
        const movedFromBoard = !!data.fromBoard;
        const draggedToken = S.deductionTokens.find(t => t.pieceKey === data.pieceKey);
        if (existingHere && movedFromBoard && draggedToken) {
          // 두 토큰 자리 교환 — 드래그한 토큰은 새 위치(=기존 토큰 자리)로,
          // 기존 토큰은 드래그한 토큰의 원래 위치로 이동
          const fromCol = draggedToken.col, fromRow = draggedToken.row;
          existingHere.col = fromCol; existingHere.row = fromRow;
          draggedToken.col = col; draggedToken.row = row;
        } else {
          // 같은 칸의 다른 토큰은 자동 제거(대체) + 동일 pieceKey 의 기존 토큰도 제거
          S.deductionTokens = S.deductionTokens.filter(t => {
            if (t.pieceKey === data.pieceKey) return false;
            if (t.col === col && t.row === row) return false;
            return true;
          });
          S.deductionTokens.push({ pieceKey: data.pieceKey, icon: data.icon, name: data.name, col, row });
        }
        refreshDeductionTokens();
        // 프로필 전체 재렌더 대신 배지만 in-place 갱신
        updateDeductionBadgesInPlace();
      } catch (err) { /* ignore */ }
    });
  });

  // 부채꼴 메뉴 활성 셀 클래스 보존 — cell.className='cell' 로 리셋된 후 다시 부여.
  //   외부에서 renderGameBoard 가 호출되어도 활성 표시(스케일업/z-index/dim)가 깨지지 않도록.
  if (S._radialMenuPiece != null) {
    const pc = S.myPieces && S.myPieces[S._radialMenuPiece];
    if (pc && pc.alive) {
      const activeCell = board.querySelector(`.cell[data-col="${pc.col}"][data-row="${pc.row}"]`);
      if (activeCell) activeCell.classList.add('radial-active');
    }
  }
  // 쌍둥이 페이즈 floating 버튼 재부여 — 셀이 재생성되면 자식 버튼이 사라지므로 다시 붙임.
  if (S.twinPhaseActive && typeof refreshTwinPhaseButtons === 'function') {
    refreshTwinPhaseButtons();
  }
}

// ── 추리 토큰 배지만 in-place 갱신 (프로필 전체 재렌더 없이) ──
// 적 프로필 카드의 deduction-badge 만 추가/갱신/제거 — 카드 자체는 재생성하지 않음
function updateDeductionBadgesInPlace() {
  // 1v1 적 프로필 카드 + 팀모드 적팀 카드 둘 다 처리
  const cards = document.querySelectorAll('.opp-piece-card[data-piece-key], [data-deduction-key]');
  cards.forEach(card => {
    const pieceKey = card.dataset.deductionKey || card.dataset.pieceKey;
    if (!pieceKey) return;
    const token = (S.deductionTokens || []).find(t => t.pieceKey === pieceKey);
    let badge = card.querySelector('.deduction-badge');
    if (token) {
      const txt = `📌${coord(token.col, token.row)}`;
      const title = `추리 토큰: ${coord(token.col, token.row)}`;
      if (badge) {
        badge.textContent = txt;
        badge.title = title;
      } else {
        const newBadge = document.createElement('span');
        newBadge.className = 'deduction-badge';
        newBadge.title = title;
        newBadge.textContent = txt;
        // 헤더(.my-piece-header)에 추가, 없으면 카드 자체에 추가
        const header = card.querySelector('.my-piece-header') || card;
        header.appendChild(newBadge);
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

// ── 추리 토큰만 가볍게 갱신 (보드 전체 재렌더 없이) ──
function refreshDeductionTokens() {
  const board = document.getElementById('game-board');
  if (!board) return;
  // 기존 토큰 전부 제거
  board.querySelectorAll('.deduction-token').forEach(el => el.remove());
  const bounds = S.boardBounds;
  // 현재 토큰 다시 배치
  for (const token of S.deductionTokens) {
    const cell = board.querySelector(`.cell[data-col="${token.col}"][data-row="${token.row}"]`);
    if (!cell) continue;
    const tokenEl = document.createElement('span');
    tokenEl.className = 'deduction-token';
    tokenEl.textContent = token.icon;
    tokenEl.title = `추리: ${token.name}`;
    tokenEl.draggable = true;
    tokenEl.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', JSON.stringify({
        pieceKey: token.pieceKey,
        icon: token.icon,
        name: token.name,
        fromBoard: true,
        fromCol: token.col,
        fromRow: token.row
      }));
      e.dataTransfer.effectAllowed = 'move';
    });
    tokenEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      S.deductionTokens = S.deductionTokens.filter(t => t.pieceKey !== token.pieceKey);
      refreshDeductionTokens();
      // 프로필 전체 재렌더 대신 배지만 in-place 갱신
      updateDeductionBadgesInPlace();
    });
    cell.appendChild(tokenEl);
  }
}

function getStatusIcons(pc) {
  if (!pc.statusEffects || pc.statusEffects.length === 0) return '';
  const icons = [];
  for (const e of pc.statusEffects) {
    if (e.type === 'curse') icons.push('☠');
    if (e.type === 'shadow') icons.push('👻');
    if (e.type === 'mark') icons.push('🎯');
  }
  return icons.join('');
}

// ── 턴 데미지 추적 — 매 턴 시작 시 모든 piece HP 스냅샷, 변화량을 도장·HP바로 표시 ──
// `S.turnStartHps[key] = hpAtTurnStart`. key = 'my:<idx>' / 'opp:<idx>' (1v1) / `<playerIdx>:<idx>` (팀모드)
//
// preCurseHps (서버에서 옴): { [playerIdx]: [hp0, hp1, ...] } — curse 가 적용되기 *전* 의 HP.
//   주어지면 startHp 로 사용 → 저주 데미지를 단독으로 받은 piece 는 (preHp - currentHp) 만큼이
//   curseDamageThisTurn 으로 자동 도출되어 buildDamageOverlay 가 보라 도장을 출력함.
function snapshotTurnStartHps(preCurseHps) {
  const snap = {};
  const newCurseDmg = {};
  const _myIdx = S.playerIdx;
  if (S.isTeamMode && Array.isArray(S.teamGamePlayers)) {
    for (const pl of S.teamGamePlayers) {
      const pieces = pl.pieces || [];
      const preHps = preCurseHps ? preCurseHps[pl.idx] : null;
      for (let i = 0; i < pieces.length; i++) {
        const pc = pieces[i];
        if (!pc) continue;
        const currentHp = (pc.alive === false ? 0 : (pc.hp ?? 0));
        const startHp = (preHps && i < preHps.length) ? preHps[i] : currentHp;
        snap[`${pl.idx}:${i}`] = startHp;
        // 저주 보라 도장 — preHp - currentHp 가 곧 이번 턴 저주 데미지
        const diff = startHp - currentHp;
        if (diff > 0) newCurseDmg[`${pl.idx}:${i}`] = diff;
      }
    }
  } else {
    const my = S.myPieces || [];
    const preMy = preCurseHps && _myIdx != null ? preCurseHps[_myIdx] : null;
    for (let i = 0; i < my.length; i++) {
      const currentHp = (my[i].alive === false ? 0 : (my[i].hp ?? 0));
      const startHp = (preMy && i < preMy.length) ? preMy[i] : currentHp;
      snap[`my:${i}`] = startHp;
      const diff = startHp - currentHp;
      if (diff > 0) newCurseDmg[`my:${i}`] = diff;
    }
    const opp = S.oppPieces || [];
    const oppPlayerIdx = (_myIdx == null) ? null : (1 - _myIdx);
    const preOpp = (preCurseHps && oppPlayerIdx != null) ? preCurseHps[oppPlayerIdx] : null;
    for (let i = 0; i < opp.length; i++) {
      const currentHp = (opp[i].alive === false ? 0 : (opp[i].hp ?? 0));
      const startHp = (preOpp && i < preOpp.length) ? preOpp[i] : currentHp;
      snap[`opp:${i}`] = startHp;
      const diff = startHp - currentHp;
      if (diff > 0) newCurseDmg[`opp:${i}`] = diff;
    }
  }
  S.turnStartHps = snap;
  S.loyaltyDamageThisTurn = {};
  S.bodyDamageThisTurn = {};   // 본체 직접 피해 — 매 턴 초기화
  S.healThisTurn = {};         // 회복 — 매 턴 초기화 (녹색 도장 + HP 바 녹색 오버레이)
  // 저주 데미지: preHps 가 주어졌으면 새로운 턴이라 이전 누적을 버리고 newCurseDmg 로 덮어씀.
  // preHps 없이 호출된 경우(게임 시작 등)는 그대로 비움.
  S.curseDamageThisTurn = newCurseDmg;
}
// 호위무사가 충성으로 대신 받은 피해를 누적
function addLoyaltyDamage(key, dmg) {
  if (!S.loyaltyDamageThisTurn) S.loyaltyDamageThisTurn = {};
  S.loyaltyDamageThisTurn[key] = (S.loyaltyDamageThisTurn[key] || 0) + dmg;
}
// 저주(curse) 지속 데미지 — 매 턴 재렌더에도 보존되도록 도장 데이터로 누적
function addCurseDamageStampValue(key, dmg) {
  if (!S.curseDamageThisTurn) S.curseDamageThisTurn = {};
  S.curseDamageThisTurn[key] = (S.curseDamageThisTurn[key] || 0) + dmg;
}
// 직접 피격(공격/스킬/덫/폭탄) 으로 본체가 받은 데미지를 누적.
// HP delta 에서 끌어내지 않고 명시적으로 분류 — 빨간 도장이 충성/저주 데미지를 흡수해
// 가로채는 일이 없도록 (사용자 요청: 정보처리 자체를 막아 가로채지 못하게).
function addBodyDamage(key, dmg) {
  if (!S.bodyDamageThisTurn) S.bodyDamageThisTurn = {};
  S.bodyDamageThisTurn[key] = (S.bodyDamageThisTurn[key] || 0) + dmg;
}
// 회복(신성/약초학) 누적 — 녹색 회복 도장 + HP 바 녹색 오버레이용.
function addHeal(key, amount) {
  if (!S.healThisTurn) S.healThisTurn = {};
  S.healThisTurn[key] = (S.healThisTurn[key] || 0) + amount;
}
// 데미지(이번 턴 기준): 시작 HP − 현재 HP. 음수면 0(회복 등).
function getTurnDamage(key, currentHp) {
  if (!S.turnStartHps || !(key in S.turnStartHps)) return 0;
  const startHp = S.turnStartHps[key];
  const cur = (currentHp == null ? 0 : currentHp);
  const d = startHp - cur;
  return d > 0 ? d : 0;
}
// 데미지 도장 + HP 바 빨간 오버레이 HTML 빌더
// 도장 구성 — 사용자 요청 (정보처리 자체를 분리해 빨강이 충성/저주를 가로채지 못하게):
//   ① 빨강(dmg-stamp) — 본체 직접 피해 (S.bodyDamageThisTurn)
//   ② 보라(dmg-stamp curse) — 본체 직접 피해가 0 이고 저주 데미지만 있는 경우
//   ③ 파랑(dmg-stamp loyalty) — 충성(호위무사 대신 받음). 빨강·보라와 공존 가능.
// 각 도장의 데이터는 명시적 add* 함수로만 누적되며 HP delta 에서 추론하지 않음.
function buildDamageOverlay(key, hp, maxHp) {
  const bodyDmg    = (S.bodyDamageThisTurn    && S.bodyDamageThisTurn[key])    || 0;
  const loyaltyDmg = (S.loyaltyDamageThisTurn && S.loyaltyDamageThisTurn[key]) || 0;
  const curseDmg   = (S.curseDamageThisTurn   && S.curseDamageThisTurn[key])   || 0;
  const healAmt    = (S.healThisTurn          && S.healThisTurn[key])          || 0;
  const fmtDmg = (d) => Number.isInteger(d) ? `${d} 데미지` : `${d.toFixed(1)} 데미지`;
  const fmtHeal = (d) => Number.isInteger(d) ? `${d} 회복` : `${d.toFixed(1)} 회복`;
  let stamp = '';
  if (bodyDmg > 0) {
    stamp += `<div class="dmg-stamp">${fmtDmg(bodyDmg)}</div>`;
  } else if (curseDmg > 0) {
    stamp += `<div class="dmg-stamp curse">${fmtDmg(curseDmg)}<span class="curse-tag">저주</span></div>`;
  } else if (healAmt > 0) {
    stamp += `<div class="dmg-stamp heal">${fmtHeal(healAmt)}</div>`;
  }
  if (loyaltyDmg > 0) {
    stamp += `<div class="dmg-stamp loyalty">${fmtDmg(loyaltyDmg)}<span class="loyalty-tag">충성</span></div>`;
  }
  // HP 바 표시 로직 (사용자 요청):
  //   기본 HP 바 자체는 *시작 HP 와 현재 HP 중 더 작은 쪽*에 머물러 있음.
  //   - 피해 (startHp > currentHp): hp-bar 가 currentHp 위치 (작아짐) + 빨간 오버레이가 currentHp~startHp 구간 표시.
  //   - 회복 (startHp < currentHp): hp-bar 는 startHp 위치 그대로 (차오르지 않음) + 더 밝은 녹색 오버레이가 startHp~currentHp 구간 표시.
  //     이 임시 회복 오버레이는 다음 턴 시작 시 (snapshotTurnStartHps 가 startHp 갱신) 또는 같은 턴에 새 데미지 받을 때
  //     일반 hp-bar 로 통합되어 사라짐.
  const startHp = S.turnStartHps?.[key] ?? hp;
  const startPct = Math.max(0, Math.min(100, (startHp / maxHp) * 100));
  const curPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  // 표시용 HP 바 폭 — 시작 HP 와 현재 HP 중 작은 쪽 (피해 시 currentHp, 회복 시 startHp)
  const displayHpPct = Math.min(startPct, curPct);
  let barOverlay = '';
  if (hp < startHp) {
    const widthPct = Math.max(0, startPct - curPct);
    if (widthPct > 0) barOverlay = `<div class="hp-bar-damage" style="left:${curPct}%;width:${widthPct}%"></div>`;
  } else if (hp > startHp) {
    const widthPct = Math.max(0, curPct - startPct);
    if (widthPct > 0) barOverlay = `<div class="hp-bar-heal" style="left:${startPct}%;width:${widthPct}%"></div>`;
  }
  return { stamp, barOverlay, displayHpPct };
}

// ── 내 말 정보 패널 ──────────────────────────────────────────
function renderMyPieces() {
  // 팀 모드에서는 1v1 함수가 팀 프로필을 덮어쓰지 않도록 위임
  if (S.isTeamMode && typeof renderTeamProfiles === 'function') { renderTeamProfiles(); return; }
  const container = document.getElementById('my-pieces-info');
  if (!container) return;
  container.innerHTML = '';
  // #2/#7: 쌍검무/질주 잠금 판정 — 해당 piece 외 흐리게
  const dualActive = S.myPieces.find(p => p.alive && p.dualBladeAttacksLeft > 0);
  const sprintActive = S.myPieces.find(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
  for (let i = 0; i < S.myPieces.length; i++) {
    const pc = S.myPieces[i];
    const card = document.createElement('div');
    const isActive = S.selectedPiece === i;
    // 쌍둥이: 이미 이동한 쪽 흐리게 표시
    const twinDimmed = S.twinMovePending && S.twinMovedSub && pc.subUnit === S.twinMovedSub;
    // #2/#7: 쌍검무/질주 활성 시 다른 유닛 흐리게
    const skillLockDimmed = (dualActive && pc !== dualActive) || (sprintActive && pc !== sprintActive);
    const lockedClass = skillLockDimmed ? 'skill-locked-dimmed' : '';
    const isCursed = pc.alive && (pc.statusEffects || []).some(e => e.type === 'curse');
    card.className = `my-piece-card ${pc.alive ? '' : 'dead'} ${isActive ? 'active-piece' : ''} ${lockedClass} ${isCursed ? 'curse-active' : ''}`;
    const hpPct = pc.alive ? (pc.hp / pc.maxHp * 100) : 0;
    // 이번 턴 데미지 도장 + HP 바 빨간 오버레이
    const dmgOv = buildDamageOverlay(`my:${i}`, pc.alive ? pc.hp : 0, pc.maxHp);

    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const statusHtml = renderStatusBadges(pc);
    // 스킬·패시브 텍스트 라인은 제거됨 — 미니 헤더(mini-header)가 이미 표시
    const skillHtml = '';
    const passiveHtml = '';

    // 궁수/무기상 방향 표시
    let directionHtml = '';
    if (pc.alive && pc.type === 'archer') {
      const dir = pc.toggleState === 'right' ? '우측 대각선' : '좌측 대각선';
      directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
    }
    if (pc.alive && pc.type === 'weaponSmith') {
      const dir = pc.toggleState === 'vertical' ? '세로' : '가로';
      directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
    }

    // 지휘관 사기증진 버프 체크 (십자 인접 4칸)
    const commanderBuff = pc.alive && pc.type !== 'commander' && S.myPieces.some(
      p => p.alive && p.type === 'commander' &&
      ((Math.abs(p.col - pc.col) === 1 && p.row === pc.row) || (Math.abs(p.row - pc.row) === 1 && p.col === pc.col))
    );
    const atkDisplay = commanderBuff
      ? `<span style="color:#22c55e;font-weight:800">${(pc.atk || 0) + 1}</span>`
      : `${pc.atk}`;
    const moraleHtml = commanderBuff ? '<span class="status-badge" style="color:#22c55e;background:rgba(34,197,94,0.15)">📋 사기증진</span>' : '';

    card.style.position = 'relative';
    const miniHeaders = (typeof buildMiniHeaders === 'function') ? buildMiniHeaders(pc) : '';
    const nameLenCls = (typeof getNameLengthClass === 'function') ? getNameLengthClass(pc.name) : '';
    // HP 바 폭 — 회복 시 시작 HP 위치 유지 (overlay 가 임시 회복 표시)
    const _displayHpPct = (dmgOv.displayHpPct != null) ? dmgOv.displayHpPct : hpPct;
    card.innerHTML = `
      ${dmgOv.stamp /* 격파된 적·아군에도 데미지 도장 유지 — 사망 마지막 일격까지 보임 */}
      <div class="my-piece-header">
        <span class="p-icon">${pc.alive ? pc.icon : '💀'}</span>
        <strong class="${nameLenCls.trim()}">${pc.name}</strong>
        <span class="tier-badge">${pc.tier}T</span>
        ${tagHtml}
      </div>
      ${miniHeaders ? `<div class="piece-mini-headers">${miniHeaders}</div>` : ''}
      <div class="hp-bar-bg hp-bar-with-text">
        <div class="hp-bar" style="width:${_displayHpPct}%"></div>
        ${pc.alive ? dmgOv.barOverlay : ''}
        <span class="hp-bar-text">${pc.alive ? pc.hp : 0}/${pc.maxHp}</span>
      </div>
      <div class="piece-stat-row">
        <span class="piece-stat-atk"><span class="stat-label">ATK</span> ${atkDisplay}</span>
        <span class="my-piece-pos">${pc.alive ? `${coord(pc.col,pc.row)}` : ''}</span>
      </div>
      ${skillHtml}${passiveHtml}${directionHtml}${statusHtml}${moraleHtml}`;

    // 호버 시 공격범위 팝업 (바깥쪽으로 표시)
    if (pc.alive) {
      const tooltip = buildPieceTooltip(pc, 'left');
      card.appendChild(tooltip);
    }

    card.addEventListener('click', () => {
      if (!S.isMyTurn || !pc.alive) return;
      // #2/#7: 쌍검무/질주 중 해당 유닛 외 클릭 차단
      if (skillLockDimmed) {
        const hint = document.getElementById('action-hint');
        if (hint) {
          if (dualActive) setActionHint('양손검객의 쌍검무 중입니다. 양손 검객으로 추가 공격하세요.', true);
          else if (sprintActive) setActionHint('전령의 질주 중입니다. 전령은 한번 더 이동할 수 있습니다.', true);
        }
        return;
      }
      S.selectedPiece = i;
      renderGameBoard();
      renderMyPieces();
    });

    container.appendChild(card);
  }
}

// 이름 길이별 폰트 축소 클래스 — 한글 7+자면 살짝, 8+자면 더 줄임 (사이드 240px 한계 안에서 태그 잘림 방지)
function getNameLengthClass(name) {
  if (!name) return '';
  const len = (name + '').length;
  if (len >= 8) return ' name-vlong';
  if (len >= 7) return ' name-long';
  return '';
}

function renderStatusBadges(pc) {
  if (!pc.statusEffects || pc.statusEffects.length === 0) return '';
  let html = '<div class="status-badges">';
  for (const e of pc.statusEffects) {
    const labels = { curse: '☠ 저주', shadow: '👻 그림자', mark: '🎯 표식' };
    const cls = e.type;
    html += `<span class="status-badge ${cls}">${labels[e.type] || e.type}</span>`;
  }
  html += '</div>';
  return html;
}

// 추리 토큰 청소 — 사망한 말의 토큰 즉시 제거 (보드/패널 렌더 직전에 호출)
function pruneDeductionTokens() {
  if (!S.oppPieces || !S.deductionTokens) return;
  // 팀모드: ownerIdx 포함된 키 / 1v1: 기존 키
  const aliveKeys = new Set(S.oppPieces.filter(p => p.alive).map(p => {
    const ownerSuffix = (p.ownerIdx != null) ? `@${p.ownerIdx}` : '';
    return `${p.type}:${p.subUnit || ''}${ownerSuffix}`;
  }));
  S.deductionTokens = S.deductionTokens.filter(t => aliveKeys.has(t.pieceKey));
}

// ── 상대 말 정보 ─────────────────────────────────────────────
function renderOppPieces() {
  // 팀 모드에서는 1v1 함수가 팀 프로필을 덮어쓰지 않도록 위임
  if (S.isTeamMode && typeof renderTeamProfiles === 'function') { renderTeamProfiles(); return; }
  const container = document.getElementById('opp-pieces-info');
  if (!container) return;
  container.innerHTML = '';
  if (!S.oppPieces) return;

  // 추리 토큰 정리 (renderGameBoard 보다 먼저 호출되었어야 하지만 보장 차원)
  pruneDeductionTokens();

  for (let pi = 0; pi < S.oppPieces.length; pi++) {
    const pc = S.oppPieces[pi];
    const card = document.createElement('div');
    const isCursedOpp = pc.alive && (pc.statusEffects || []).some(e => e.type === 'curse');
    card.className = `opp-piece-card ${pc.alive ? '' : 'dead'} ${isCursedOpp ? 'curse-active' : ''}`;
    card.style.position = 'relative';

    // ── 추리 토큰 드래그 시작 ──
    if (pc.alive) {
      card.draggable = true;
      card.dataset.pieceKey = `${pc.type}:${pc.subUnit || ''}`;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          pieceKey: card.dataset.pieceKey,
          icon: pc.icon,
          name: pc.name,
          fromBoard: false
        }));
        e.dataTransfer.effectAllowed = 'move';
        // 커스텀 드래그 이미지: 작은 아이콘만 표시
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = pc.icon;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 14, 14);
        requestAnimationFrame(() => ghost.remove());
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    }
    const hpPct = pc.alive ? (pc.hp / pc.maxHp * 100) : 0;
    const dmgOv = buildDamageOverlay(`opp:${pi}`, pc.alive ? pc.hp : 0, pc.maxHp);
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const statusHtml = renderStatusBadges(pc);
    // 스킬·패시브 텍스트 라인은 제거됨 — 미니 헤더(mini-header)가 이미 표시
    const skillHtml = '';
    const passiveHtml = '';
    // 궁수/무기상 방향 표시
    let directionHtml = '';
    if (pc.alive && pc.type === 'archer') {
      const dir = pc.toggleState === 'right' ? '우측 대각선' : '좌측 대각선';
      directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
    }
    if (pc.alive && pc.type === 'weaponSmith') {
      const dir = pc.toggleState === 'vertical' ? '세로' : '가로';
      directionHtml = `<div style="font-size:0.68rem;color:#60a5fa;margin-top:1px">현재 공격 방향 : ${dir}</div>`;
    }

    const pieceKey = `${pc.type}:${pc.subUnit || ''}`;
    const placedToken = S.deductionTokens.find(t => t.pieceKey === pieceKey);
    const placedBadge = placedToken
      ? `<span class="deduction-badge" title="추리 토큰: ${coord(placedToken.col, placedToken.row)}">📌${coord(placedToken.col, placedToken.row)}</span>`
      : '';

    const miniHeaders = (typeof buildMiniHeaders === 'function') ? buildMiniHeaders(pc) : '';
    const nameLenCls = (typeof getNameLengthClass === 'function') ? getNameLengthClass(pc.name) : '';
    // #24: 보드 파괴 탈락 도장 (1v1 — opp 카드)
    const _oppElimKey = `opp:${pi}`;
    const _isOppShrunkElim = !pc.alive && S._shrunkEliminated && S._shrunkEliminated.has(_oppElimKey);
    const _displayHpPct = (dmgOv.displayHpPct != null) ? dmgOv.displayHpPct : hpPct;
    card.innerHTML = `
      ${dmgOv.stamp /* 격파된 적·아군에도 데미지 도장 유지 — 사망 마지막 일격까지 보임 */}
      ${_isOppShrunkElim ? '<div class="elim-stamp">탈락</div>' : ''}
      <div class="my-piece-header">
        <span class="p-icon">${pc.alive ? pc.icon : '💀'}</span>
        <strong class="${nameLenCls.trim()}">${pc.name}</strong>
        <span class="tier-badge">${pc.tier}T</span>
        ${tagHtml}
        ${placedBadge}
      </div>
      ${miniHeaders ? `<div class="piece-mini-headers">${miniHeaders}</div>` : ''}
      <div class="hp-bar-bg hp-bar-with-text">
        <div class="hp-bar" style="width:${_displayHpPct}%"></div>
        ${pc.alive ? dmgOv.barOverlay : ''}
        <span class="hp-bar-text">${pc.alive ? pc.hp : 0}/${pc.maxHp}</span>
      </div>
      <div class="piece-stat-row">
        <span class="piece-stat-atk"><span class="stat-label">ATK</span> ${pc.atk}</span>
        <span style="color:${pc.alive ? 'var(--success)' : 'var(--danger)'}; font-size:0.7rem">
          ${pc.alive ? (pc.marked ? `📍${coord(pc.col,pc.row)}` : '생존') : ''}
        </span>
      </div>
      ${skillHtml}${passiveHtml}${directionHtml}${statusHtml}`;

    // 호버 팝업 (바깥쪽으로 표시)
    if (pc.alive) {
      const tooltip = buildPieceTooltip(pc, 'right');
      card.appendChild(tooltip);
    }

    container.appendChild(card);
  }

  // 추리 토큰 안내 (한 번만)
  if (!container.querySelector('.deduction-hint')) {
    const hint = document.createElement('div');
    hint.className = 'deduction-hint';
    hint.textContent = '📌 상대 말 프로필을 보드로 드래그해 추리 토큰을 생성해보세요. 우클릭으로 제거할 수 있습니다.';
    container.appendChild(hint);
  }
}

// ═══════════════════════════════════════════════════════════════
// ── 미니 공격범위 그리드 생성 ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildMiniRangeGrid(type, extra, icon) {
  // 5x5 미니 그리드, 중앙(2,2)을 기준으로 공격범위 계산
  const fakeExtra = { ...(extra || {}), toggleState: extra?.toggleState };
  let cells;
  if (type === 'twins') {
    const elderCells = getAttackCells('twins_elder', 2, 2, fakeExtra);
    const youngerCells = getAttackCells('twins_younger', 2, 2, fakeExtra);
    cells = [...elderCells, ...youngerCells];
  } else {
    cells = getAttackCells(type, 2, 2, fakeExtra);
  }
  const atkSet = new Set(cells.map(c => `${c.col},${c.row}`));

  let html = '<div class="mini-range-grid">';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isCenter = (c === 2 && r === 2);
      const isAtk = atkSet.has(`${c},${r}`);
      if (isCenter) {
        html += `<div class="mini-cell center-icon${isAtk ? ' atk' : ''}">${icon || ''}</div>`;
      } else {
        html += `<div class="${isAtk ? 'mini-cell atk' : 'mini-cell'}"></div>`;
      }
    }
  }
  html += '</div>';
  return html;
}

function getSkillTypeTag(skill) {
  if (!skill) return '';
  if (skill.replacesAction) return '<span class="skill-tag tag-action">행동소비형</span>';
  if (skill.oncePerTurn) return '<span class="skill-tag tag-once">자유시전·1회</span>';
  return '<span class="skill-tag tag-free">자유시전형</span>';
}

function buildMiniHeaders(ch) {
  if (!ch) return '';
  let html = '';
  if (ch.skills && ch.skills.length > 0) {
    for (const sk of ch.skills) {
      let cls;
      if (sk.replacesAction) cls = 'mini-header-action';
      else if (sk.oncePerTurn) cls = 'mini-header-once';
      else cls = 'mini-header-free';
      html += `<span class="mini-header ${cls}">${sk.name}</span>`;
    }
  }
  if (ch.passives && ch.passives.length > 0) {
    for (const pid of ch.passives) {
      const name = getPassiveName(pid);
      html += `<span class="mini-header mini-header-passive">${name}</span>`;
    }
  }
  return html;
}

function getSkillTypeTagFromChar(pc) {
  // 서버 CHARACTERS에서 스킬 정보 가져오기
  const charData = S.characters || S.specCharacters;
  if (!charData || !pc.hasSkill) return '';
  const baseType = (pc.type === 'twins_elder' || pc.type === 'twins_younger') ? 'twins' : pc.type;
  for (const tier of [1, 2, 3]) {
    const chars = charData[tier];
    if (!chars) continue;
    const ch = chars.find(c => c.type === baseType);
    if (ch && ch.skills && ch.skills.length > 0) {
      return getSkillTypeTag(ch.skills[0]);
    }
  }
  return '';
}

function buildPieceTooltip(pc, side) {
  const grid = buildMiniRangeGrid(pc.type, { toggleState: pc.toggleState }, pc.icon);

  // 캐릭터 도감(slide-content)과 동일 양식으로 통일:
  //   <slide-head-line>
  //     <slide-skill-name mini-header-XXX>스킬이름</slide-skill-name>  ← 유형 색상 박스(이게 곧 유형 표시)
  //     <slide-sp-box>SP 비용</slide-sp-box>
  //   </slide-head-line>
  //   <slide-detail-body>설명</slide-detail-body>
  // ※ 별도의 [행동소비형/자유시전형/...] 태그는 제거 (이름 박스 색상이 곧 유형이므로 중복 정보)
  const spBox = (cost) => `<span class="slide-sp-box">${(typeof spLabel === 'function') ? spLabel(cost) : ('SP ' + cost)}</span>`;
  const headClassFor = (sk) => {
    if (!sk) return 'mini-header-action';
    if (sk.replacesAction) return 'mini-header-action';
    if (sk.oncePerTurn) return 'mini-header-once';
    return 'mini-header-free';
  };

  let skillHtml = '';
  const hasActiveSkill = (pc.skills && pc.skills.length > 0) || pc.hasSkill;
  const hasPassive = (pc.passives && pc.passives.length > 0) || pc.passiveName;
  if (pc.skills && pc.skills.length > 0) {
    for (const sk of pc.skills) {
      const cls = headClassFor(sk);
      skillHtml += `<div class="slide-head-line">` +
        `<span class="slide-skill-name ${cls}">${sk.name}</span>` +
        spBox(sk.cost) +
        `</div>`;
      skillHtml += `<div class="slide-detail-body">${sk.desc}</div>`;
    }
  } else if (pc.hasSkill) {
    const cls = pc.skillReplacesAction ? 'mini-header-action' : (pc.skillOncePerTurn ? 'mini-header-once' : 'mini-header-free');
    const skillDesc = getSkillDescForPiece(pc);
    skillHtml = `<div class="slide-head-line">` +
      `<span class="slide-skill-name ${cls}">${pc.skillName}</span>` +
      spBox(pc.skillCost) +
      `</div>`;
    skillHtml += `<div class="slide-detail-body">${skillDesc}</div>`;
  } else if (!hasPassive) {
    skillHtml = '<div class="tooltip-line" style="color:var(--muted)">스킬 없음</div>';
  }

  // 패시브 — 동일 양식, 색상은 mini-header-passive
  let passiveHtml = '';
  if (pc.passives && pc.passives.length > 0) {
    for (const pid of pc.passives) {
      const name = getPassiveName(pid);
      const desc = getPassiveLabel(pid);
      passiveHtml += `<div class="slide-head-line">` +
        `<span class="slide-skill-name mini-header-passive">${name}</span>` +
        `</div>`;
      passiveHtml += `<div class="slide-detail-body">${desc}</div>`;
    }
  } else if (pc.passiveName) {
    passiveHtml = `<div class="slide-head-line">` +
      `<span class="slide-skill-name mini-header-passive">${pc.passiveName}</span>` +
      `</div>`;
  }

  // 상태이상 배지
  let statusHtml = '';
  if (pc.statusEffects && pc.statusEffects.length > 0) {
    const labels = { curse: '☠ 저주', shadow: '👻 그림자', mark: '🎯 표식', morale: '📋 사기증진' };
    const badges = pc.statusEffects.map(e => `<span class="status-badge status-${e.type}">${labels[e.type] || e.type}</span>`).join(' ');
    statusHtml = `<div class="tooltip-line" style="margin-top:4px">${badges}</div>`;
  }

  const tooltip = document.createElement('div');
  tooltip.className = `piece-tooltip tooltip-${side}`;
  tooltip.innerHTML = `
    <div class="tooltip-title">${pc.icon} ${pc.name}</div>
    <div class="tooltip-section">${grid}</div>
    ${skillHtml}
    ${passiveHtml}
    ${statusHtml}`;
  return tooltip;
}

// ═══════════════════════════════════════════════════════════════
// ── 액션 버튼 ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// 행동 모드별 액션 바 시각 표시 — 선택된 버튼은 글로우, 나머지는 잠금 표시
function setActionButtonMode(mode) {
  // mode: 'move' | 'attack' | 'skill' | null
  const buttons = {
    move:    document.getElementById('btn-move'),
    attack:  document.getElementById('btn-attack'),
    skill:   document.getElementById('btn-skill'),
  };
  const btnEnd = document.getElementById('btn-end-turn');
  const btnCancel = document.getElementById('btn-cancel');
  const btnSurrender = document.getElementById('btn-surrender');
  for (const [key, btn] of Object.entries(buttons)) {
    if (!btn) continue;
    btn.classList.remove('action-active', 'action-locked');
    if (mode === null) continue;
    if (key === mode) btn.classList.add('action-active');
    else btn.classList.add('action-locked');
  }
  if (btnEnd) btnEnd.classList.toggle('action-locked', mode !== null);
  if (btnSurrender) btnSurrender.classList.toggle('action-locked', mode !== null);
  // 취소 버튼: 활성 행동이 있을 때만 표시 + 글로우. 모드 해제 시 숨김 (취소할 행동 없음)
  if (btnCancel) {
    btnCancel.classList.toggle('action-active', mode !== null);
    btnCancel.classList.toggle('hidden', mode === null);
  }
  // body 액션 락 — 행동 진행 중 다른 유닛 상호작용(클릭/호버/스케일업) 모두 차단.
  if (mode === null) document.body.classList.remove('action-locked');
  else document.body.classList.add('action-locked');
}

function resetAction() {
  // 쌍둥이 이동 페이즈 — 첫 이동 전에는 취소 가능, 첫 이동 후에는 페이즈 종료(토스트 송출).
  if (S.twinPhaseActive) {
    if (S.twinFirstSubMoved == null) {
      // 아직 이동 실행 안 함 — 그냥 취소
      exitTwinMovePhase(/*emitToast=*/false);
    } else {
      // 첫 이동 끝났으면 페이즈 정상 종료 (토스트 1회)
      exitTwinMovePhase(/*emitToast=*/true);
    }
    return;
  }
  S.action = null;
  S.selectedPiece = null;
  S.targetSelectMode = false;
  S.skillTargetData = null;
  document.body.classList.remove('action-locked');
  document.getElementById('btn-cancel').classList.add('hidden');
  const skipBtn = document.getElementById('btn-twin-skip-elder');
  if (skipBtn) skipBtn.classList.add('hidden');
  const hint = document.getElementById('action-hint');
  if (hint) hint.textContent = '행동할 캐릭터의 아이콘을 클릭하세요.';
  setActionButtonMode(null);
  renderGameBoard();
  renderMyPieces();
}

// 이동 버튼
document.getElementById('btn-move').addEventListener('click', () => {
  if (!S.isMyTurn) return;
  S.action = 'move';
  S.selectedPiece = null;
  S.targetSelectMode = false;
  document.body.classList.add('action-locked');  // 행동 중 다른 유닛 상호작용 완전 차단
  document.getElementById('btn-cancel').classList.remove('hidden');
  // 쌍둥이가 같은 칸에 겹쳐 있고 둘 다 살아있다면 — 누나 먼저 이동 안내 + 스킵 버튼
  const elderPc = (S.myPieces || []).find(p => p.subUnit === 'elder' && p.alive);
  const youngerPc = (S.myPieces || []).find(p => p.subUnit === 'younger' && p.alive);
  const stackedTwins = elderPc && youngerPc &&
    elderPc.col === youngerPc.col && elderPc.row === youngerPc.row;
  const elderAlreadyMoved = S.twinMovedSub === 'elder' || S.twinElderSkipped;
  if (stackedTwins && !elderAlreadyMoved) {
    document.getElementById('action-hint').textContent = '👫 누나가 먼저 이동합니다. 이동할 칸을 선택하세요.';
    const skipBtn = document.getElementById('btn-twin-skip-elder');
    if (skipBtn) skipBtn.classList.remove('hidden');
  } else {
    document.getElementById('action-hint').textContent = '이동할 유닛을 클릭하세요.';
    const skipBtn = document.getElementById('btn-twin-skip-elder');
    if (skipBtn) skipBtn.classList.add('hidden');
  }
  setActionButtonMode('move');
  renderGameBoard();
});

// 쌍둥이 누나 이동 넘기기 버튼
{
  const _btnTwinSkip = document.getElementById('btn-twin-skip-elder');
  if (_btnTwinSkip) {
    _btnTwinSkip.addEventListener('click', () => {
      if (!S.isMyTurn) return;
      if (S.twinElderSkipped || S.twinMovedSub === 'elder') return;
      socket.emit('skip_twin_move', { subUnit: 'elder' });
      _btnTwinSkip.classList.add('hidden');
    });
  }
}

// 서버 confirm — 누나 이동 스킵 처리됨
socket.on('twin_skip_ok', ({ subUnit }) => {
  if (subUnit === 'elder') {
    S.twinElderSkipped = true;
    S.twinMovePending = true;       // 동생 이동 가능 상태
    S.twinMovedSub = 'elder';       // 동생만 이동 가능하도록 표시
    document.getElementById('action-hint').textContent = '👫 누나 이동 스킵됨. 동생을 이동시키거나 턴을 종료할 수 있습니다.';
  } else if (subUnit === 'younger') {
    S.twinYoungerSkipped = true;
    S.twinMovePending = true;
    S.twinMovedSub = 'younger';
  }
});

// 공격 버튼
document.getElementById('btn-attack').addEventListener('click', () => {
  if (!S.isMyTurn) return;
  if (S.twinMovePending) {
    document.getElementById('action-hint').textContent = '쌍둥이가 이동 중입니다. 나머지를 이동하거나 턴을 종료하세요.';
    return;
  }
  S.action = 'attack';
  S.selectedPiece = null;
  S.targetSelectMode = false;
  document.body.classList.add('action-locked');  // 행동 중 다른 유닛 상호작용 완전 차단
  document.getElementById('btn-cancel').classList.remove('hidden');
  document.getElementById('action-hint').textContent = '공격할 말을 클릭하세요.';
  setActionButtonMode('attack');
  renderGameBoard();
});

// 스킬 버튼
document.getElementById('btn-skill').addEventListener('click', () => {
  if (!S.isMyTurn) return;
  setActionButtonMode('skill');
  openSkillModal();
});

// 턴 종료 버튼 (행동 없이 누르면 확인 모달)
document.getElementById('btn-end-turn').addEventListener('click', () => {
  if (!S.isMyTurn) return;
  // 쌍둥이 이동 페이즈 — 첫 이동을 아직 실행하지 않은 상태로는 턴 종료 차단.
  //   이미 첫 이동을 끝낸 후 두 번째 미이동 상태에선 턴 종료 가능 (페이즈 종료 토스트 송출).
  if (S.twinPhaseActive) {
    if (S.twinFirstSubMoved == null) {
      setActionHint('첫 쌍둥이의 이동을 먼저 실행하세요.', true);
      return;
    }
    // 첫 이동 끝남, 두 번째 안 함 — 페이즈 종료 + 단일 토스트
    exitTwinMovePhase(/*emitToast=*/true);
    socket.emit('end_turn');
    S.isMyTurn = false;
    showActionBar(false);
    return;
  }
  // #3: 쌍검무 활성 + 추가 공격 남음
  const dualBladeLeft = S.myPieces && S.myPieces.some(p => p.alive && p.dualBladeAttacksLeft > 0);
  if (dualBladeLeft) {
    document.getElementById('dualblade-endturn-modal').classList.remove('hidden');
    return;
  }
  // #7: 전령 질주 활성 + 추가 이동 남음
  const sprintLeft = S.myPieces && S.myPieces.some(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
  if (sprintLeft) {
    document.getElementById('sprint-endturn-modal').classList.remove('hidden');
    return;
  }
  // 쌍둥이 한쪽만 이동했고 다른 쪽 미이동 → 확인 모달
  // (단, 누나 이동을 의도적으로 스킵한 경우는 컨펌 완료된 것으로 보고 모달 생략)
  if (S.twinMovePending && !S.twinElderSkipped && !S.twinYoungerSkipped) {
    document.getElementById('twin-endturn-modal').classList.remove('hidden');
    return;
  }
  // 쌍둥이 누나 이동을 의도적으로 스킵했다면 — 컨펌은 이미 완료된 것으로 보고 모달 생략
  if (!S.moveDone && !S.actionDone && !S.twinElderSkipped && !S.twinYoungerSkipped) {
    document.getElementById('endturn-modal').classList.remove('hidden');
    return;
  }
  socket.emit('end_turn');
  S.isMyTurn = false;
  showActionBar(false);
});
document.getElementById('endturn-confirm').addEventListener('click', () => {
  document.getElementById('endturn-modal').classList.add('hidden');
  socket.emit('end_turn');
  S.isMyTurn = false;
  showActionBar(false);
});
document.getElementById('endturn-cancel').addEventListener('click', () => {
  document.getElementById('endturn-modal').classList.add('hidden');
});

// 쌍둥이 미이동 턴 종료 모달
document.getElementById('twin-endturn-confirm').addEventListener('click', () => {
  document.getElementById('twin-endturn-modal').classList.add('hidden');
  S.twinMovePending = false;
  S.twinMovedSub = null;
  socket.emit('end_turn');
  S.isMyTurn = false;
  showActionBar(false);
  renderBoard();
});
document.getElementById('twin-endturn-cancel').addEventListener('click', () => {
  document.getElementById('twin-endturn-modal').classList.add('hidden');
});

// #3: 쌍검무 미완료 턴 종료 모달
const dualbladeEndturnConfirm = document.getElementById('dualblade-endturn-confirm');
if (dualbladeEndturnConfirm) {
  dualbladeEndturnConfirm.addEventListener('click', () => {
    document.getElementById('dualblade-endturn-modal').classList.add('hidden');
    socket.emit('end_turn');
    S.isMyTurn = false;
    showActionBar(false);
  });
}
const dualbladeEndturnCancel = document.getElementById('dualblade-endturn-cancel');
if (dualbladeEndturnCancel) {
  dualbladeEndturnCancel.addEventListener('click', () => {
    document.getElementById('dualblade-endturn-modal').classList.add('hidden');
  });
}

// #7: 전령 질주 미완료 턴 종료 모달
const sprintEndturnConfirm = document.getElementById('sprint-endturn-confirm');
if (sprintEndturnConfirm) {
  sprintEndturnConfirm.addEventListener('click', () => {
    document.getElementById('sprint-endturn-modal').classList.add('hidden');
    socket.emit('end_turn');
    S.isMyTurn = false;
    showActionBar(false);
  });
}
const sprintEndturnCancel = document.getElementById('sprint-endturn-cancel');
if (sprintEndturnCancel) {
  sprintEndturnCancel.addEventListener('click', () => {
    document.getElementById('sprint-endturn-modal').classList.add('hidden');
  });
}

// 기권 버튼
document.getElementById('btn-surrender').addEventListener('click', () => {
  const btn = document.getElementById('btn-surrender');
  // 탈락 후 — '방 나가기' 모드
  if (btn && btn.dataset.mode === 'leave') {
    // 즉시 로비로 — 게임은 다른 플레이어들이 계속 진행
    try { sessionStorage.removeItem('caligo_session'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}
    setTimeout(() => { try { socket.connect(); } catch (e) {} }, 200);
    showScreen('screen-lobby');
    return;
  }
  // 일반 — 기권 모달
  if (!S.isMyTurn) return;
  document.getElementById('surrender-modal').classList.remove('hidden');
});
document.getElementById('surrender-confirm').addEventListener('click', () => {
  document.getElementById('surrender-modal').classList.add('hidden');
  socket.emit('surrender');
  S.isMyTurn = false;
  showActionBar(false);
  // #9: 기권은 의도적 나가기 → 세션 정리
  try { sessionStorage.removeItem('caligo_session'); } catch (e) {}
});
document.getElementById('surrender-cancel').addEventListener('click', () => {
  document.getElementById('surrender-modal').classList.add('hidden');
});

// #7 설정 단계 나가기 버튼
document.getElementById('btn-setup-exit').addEventListener('click', () => {
  document.getElementById('setup-exit-modal').classList.remove('hidden');
});
document.getElementById('setup-exit-confirm').addEventListener('click', () => {
  document.getElementById('setup-exit-modal').classList.add('hidden');
  stopClientTimer();
  socket.emit('surrender');
  showScreen('screen-lobby');
});
document.getElementById('setup-exit-cancel').addEventListener('click', () => {
  document.getElementById('setup-exit-modal').classList.add('hidden');
});

// 취소 버튼
document.getElementById('btn-cancel').addEventListener('click', resetAction);

// ═══════════════════════════════════════════════════════════════
// ── 스킬 모달 ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// targetPieceIdx 가 주어지면 그 piece 의 스킬만 (캐릭터 전용 탭 — 부채꼴 메뉴에서 호출).
//   주어지지 않으면 모든 piece 의 스킬 (전역 — 레거시 btn-skill 클릭).
function openSkillModal(targetPieceIdx) {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  body.innerHTML = '';

  // 모달 제목 — 캐릭터 전용일 때 이름 표시
  const titleEl = document.getElementById('skill-modal-title');
  if (titleEl) {
    if (targetPieceIdx != null && S.myPieces[targetPieceIdx]) {
      const pc = S.myPieces[targetPieceIdx];
      titleEl.textContent = `${pc.icon} ${pc.name} — 스킬`;
    } else {
      titleEl.textContent = '스킬 선택';
    }
  }

  // 팀모드: SP 풀이 [팀A, 팀B]로 인덱싱됨 → S.teamId / 1v1: [p0, p1] → S.playerIdx
  const spSlot = S.isTeamMode ? (S.teamId ?? 0) : (S.playerIdx ?? 0);
  const mySP = S.sp[spSlot] || 0;
  const myInstant = (S.instantSp && S.instantSp[spSlot]) || 0;
  const totalSP = mySP + myInstant;
  let hasAnySkill = false;

  // 캐릭터 전용 모드면 그 인덱스만, 아니면 전체 순회
  const indices = (targetPieceIdx != null) ? [targetPieceIdx] : Array.from({ length: S.myPieces.length }, (_, i) => i);
  // 남매(twins): 분신은 한 쌍에 1회만 표시 — 첫 번째 등장(주로 elder)에서만 출력
  let twinSkillShown = false;
  for (const i of indices) {
    const pc = S.myPieces[i];
    if (!pc.alive || !pc.hasSkill) continue;
    if (pc.type === 'twins_elder' || pc.type === 'twins_younger') {
      if (twinSkillShown) continue;
      twinSkillShown = true;
    }
    hasAnySkill = true;

    // 다중 스킬 지원 (화약상 등): skills 배열이 있으면 각각 표시
    const skillList = pc.skills && pc.skills.length > 1 ? pc.skills : null;
    // 저주 상태이면 모든 스킬 차단 — 1v1·팀전 양쪽 동일하게 적용
    const isCursed = pc.statusEffects && pc.statusEffects.some(e => e.type === 'curse');

    if (skillList) {
      // 다중 스킬: 각 스킬을 별도 옵션으로 표시
      for (const sk of skillList) {
        const canAfford = totalSP >= sk.cost;
        const instantLabel = myInstant > 0 ? ` + ✨${myInstant}` : '';

        // 행동소비형인데 이미 행동했으면 비활성화
        let extraDisabled = false;
        let extraNote = '';
        if (isCursed) {
          extraDisabled = true;
          extraNote = ' (저주 상태 — 사용 불가)';
        }
        if (sk.replacesAction && S.actionDone) {
          extraDisabled = true;
          extraNote = ' (행동 이미 소비됨)';
        }
        // 턴당 1회인데 이미 사용했으면 비활성화
        let oncePerTurnUsed = false;
        if (sk.oncePerTurn && S.skillsUsedThisTurn && S.skillsUsedThisTurn.includes(`${i}:${sk.id}`)) {
          oncePerTurnUsed = true;
          extraDisabled = true;
          extraNote = ' (사용 완료)';
        }
        // 기폭의 경우 폭탄이 없으면 비활성화
        if (sk.id === 'detonate') {
          const bombs = (S.boardObjects || []).filter(o => o.type === 'bomb');
          if (bombs.length === 0) {
            extraDisabled = true;
            extraNote = ' (설치된 폭탄 없음)';
          } else {
            extraNote = ` (폭탄 ${bombs.length}개)`;
          }
        }

        const opt = document.createElement('div');
        opt.className = 'skill-option';
        if (oncePerTurnUsed) {
          opt.style.opacity = '0.3';
          opt.style.pointerEvents = 'none';
          opt.style.cursor = 'not-allowed';
        } else {
          opt.style.opacity = (canAfford && !extraDisabled) ? '1' : '0.4';
        }
        const skTag = getSkillTypeTag(sk);
        opt.innerHTML = `
          <div class="skill-name">${pc.icon} ${pc.name} — ${sk.name} ${skTag}</div>
          <div class="skill-cost">SP 비용: ${sk.cost}${extraNote}</div>
          <div class="skill-desc">${sk.desc}</div>`;

        if (canAfford && !extraDisabled) {
          const skillId = sk.id;
          const pieceIdx = i;
          opt.addEventListener('click', () => {
            modal.classList.add('hidden');
            handleSkillUse(pieceIdx, pc, skillId);
          });
        }
        body.appendChild(opt);
      }
    } else {
      // 단일 스킬
      const canAfford = totalSP >= pc.skillCost;
      const instantLabel = myInstant > 0 ? ` + ✨${myInstant}` : '';
      let singleDisabled = false;
      let singleNote = '';
      // 저주 상태이면 모든 스킬 차단
      if (isCursed) {
        singleDisabled = true;
        singleNote = ' (저주 상태 — 사용 불가)';
      }
      if (pc.skillReplacesAction && S.actionDone) {
        singleDisabled = true;
        singleNote = ' (행동 이미 소비됨)';
      }
      let singleOncePerTurnUsed = false;
      const firstSkillDef = pc.skills && pc.skills[0];
      if (firstSkillDef && firstSkillDef.oncePerTurn) {
        const usedByTracker = S.skillsUsedThisTurn && S.skillsUsedThisTurn.includes(`${i}:${pc.skillId}`);
        const usedByFlag = (pc.messengerSprintActive && pc.skillId === 'sprint') ||
                           (pc.dualBladeAttacksLeft > 0 && pc.skillId === 'dualStrike');
        if (usedByTracker || usedByFlag) {
          singleOncePerTurnUsed = true;
          singleDisabled = true;
          singleNote = ' (사용 완료)';
        }
      }
      // 고문기술자: 표식 적이 없으면 악몽 비활성화
      if (pc.type === 'torturer') {
        const hasMarked = (S.oppPieces || []).some(p => p.alive && p.statusEffects && p.statusEffects.some(e => e.type === 'mark'));
        if (!hasMarked) { singleDisabled = true; singleNote = ' (표식 대상 없음)'; }
      }
      // 드래곤 조련사: 드래곤이 이미 존재하면 비활성화
      if (pc.type === 'dragonTamer') {
        const hasDragon = S.myPieces.some(p => p.isDragon && p.alive);
        if (hasDragon) { singleDisabled = true; singleNote = ' (드래곤 이미 소환됨)'; }
      }
      // 쌍둥이 분신: 두 명 모두 살아있어야 사용 가능 + 같은 칸에 겹쳐있으면 잠금
      let twinsDisabled = false;
      if (pc.type === 'twins_elder' || pc.type === 'twins_younger') {
        const elderPc = S.myPieces.find(p => p.subUnit === 'elder');
        const youngerPc = S.myPieces.find(p => p.subUnit === 'younger');
        const elderAlive = elderPc && elderPc.alive;
        const youngerAlive = youngerPc && youngerPc.alive;
        if (!elderAlive || !youngerAlive) {
          twinsDisabled = true;
          singleDisabled = true;
          singleNote = ' (사용 불가)';
        } else if (elderPc.col === youngerPc.col && elderPc.row === youngerPc.row) {
          // 이미 같은 칸에 있음 → 분신 의미 없음
          twinsDisabled = true;
          singleDisabled = true;
          singleNote = ' (이미 겹쳐 있음 — 사용 불가)';
        }
      }
      // 쌍검무: 이번 턴 공격 2회 — 이동 후 / 다른 유닛이 공격한 경우 사용 불가
      if (pc.skillId === 'dualStrike') {
        if (S.moveDone) {
          singleDisabled = true;
          singleNote = ' (이미 이동함 — 사용 불가)';
        } else if (S.actionDone && pc.type !== 'dualBlade') {
          // 본인이 공격한 경우만 OK, 다른 유닛이 공격했으면 차단
          // (사실 pc.type === 'dualBlade'이지만 미래 호환을 위해 분리)
          singleDisabled = true;
          singleNote = ' (다른 유닛이 행동함 — 사용 불가)';
        } else if (S.actionDone && S.lastActionPieceType && S.lastActionPieceType !== 'dualBlade') {
          singleDisabled = true;
          singleNote = ' (다른 유닛이 행동함 — 사용 불가)';
        }
      }
      // 전령 질주: 누구든 공격 후 / 다른 유닛이 이동한 경우 사용 불가
      if (pc.skillId === 'sprint') {
        if (S.lastActionType === 'attack') {
          singleDisabled = true;
          singleNote = ' (이미 공격함 — 사용 불가)';
        } else if (S.lastActionType === 'move' && S.lastActionPieceType && S.lastActionPieceType !== 'messenger') {
          singleDisabled = true;
          singleNote = ' (다른 유닛이 이동함 — 사용 불가)';
        } else if (S.actionDone && pc.type !== 'messenger' && !pc.messengerSprintActive) {
          // fallback: actionDone이지만 lastActionType 정보가 없으면 보수적으로 차단
          singleDisabled = true;
          singleNote = ' (행동 후 — 사용 불가)';
        }
      }
      const opt = document.createElement('div');
      opt.className = 'skill-option';
      if (singleOncePerTurnUsed || twinsDisabled) {
        opt.style.opacity = '0.3';
        opt.style.pointerEvents = 'none';
        opt.style.cursor = 'not-allowed';
      } else {
        opt.style.opacity = (canAfford && !singleDisabled) ? '1' : '0.4';
      }
      const singleTag = getSkillTypeTagFromChar(pc);
      // 쌍둥이는 스킬탭에서 누나/동생 구분 없이 '쌍둥이 강도'로 통일 표기
      const skillTabName = (pc.type === 'twins_elder' || pc.type === 'twins_younger')
        ? '쌍둥이 강도' : pc.name;
      const skillTabIcon = (pc.type === 'twins_elder' || pc.type === 'twins_younger')
        ? '👫' : pc.icon;
      opt.innerHTML = `
        <div class="skill-name">${skillTabIcon} ${skillTabName} — ${pc.skillName} ${singleTag}</div>
        <div class="skill-cost">SP 비용: ${pc.skillCost}${singleNote}</div>
        <div class="skill-desc">${getSkillDesc(pc)}</div>`;

      if (canAfford && !singleDisabled) {
        opt.addEventListener('click', () => {
          modal.classList.add('hidden');
          handleSkillUse(i, pc);
        });
      }
      body.appendChild(opt);
    }
  }

  if (!hasAnySkill) {
    body.innerHTML = '<p class="muted" style="text-align:center;padding:20px">사용 가능한 스킬이 없습니다.</p>';
  }

  modal.classList.remove('hidden');
}

function getSkillDesc(pc) {
  // 서버 데이터에서 스킬 설명 가져오기
  if (!S.characters) return '';
  const baseType = (pc.type === 'twins_elder' || pc.type === 'twins_younger') ? 'twins' : pc.type;
  for (const tier of [1, 2, 3]) {
    const chars = S.characters[tier];
    if (!chars) continue;
    const ch = chars.find(c => c.type === baseType);
    if (ch && ch.skills && ch.skills.length > 0) {
      return ch.skills[0].desc;
    }
  }
  return '';
}

function handleSkillUse(pieceIdx, pc, overrideSkillId) {
  const skillId = overrideSkillId || pc.skillId;
  const type = pc.type;

  // 파라미터가 필요한 스킬들
  if (type === 'gunpowder' && skillId === 'bomb') {
    // 시한폭탄 설치: 위치 선택 필요
    S.action = 'skill_target';
    S.skillTargetData = { pieceIdx, skillId: 'bomb', type: 'bomb_place' };
    document.getElementById('btn-cancel').classList.remove('hidden');
    document.getElementById('action-hint').textContent = `💣 폭탄 설치 위치를 선택하세요.`;
    renderGameBoard();
    return;
  }

  if (type === 'gunpowder' && skillId === 'detonate') {
    // 기폭: 즉시 실행
    socket.emit('use_skill', { pieceIdx, skillId: 'detonate', params: {} });
    return;
  }

  if (type === 'witch') {
    // 마녀: 적 캐릭터 선택 모달
    showWitchCurseUI(pieceIdx);
    return;
  }

  if (type === 'dragonTamer') {
    S.action = 'skill_target';
    S.skillTargetData = { pieceIdx, skillId, type: 'dragon_place' };
    document.getElementById('btn-cancel').classList.remove('hidden');
    document.getElementById('action-hint').textContent = `🐉 드래곤 소환 위치를 선택하세요`;
    renderGameBoard();
    return;
  }

  if (type === 'king') {
    // 국왕 스킬: 적 말 이름 + 위치 선택
    showKingSkillUI(pieceIdx);
    return;
  }

  if (type === 'monk') {
    // 수도승: 아군 선택
    showMonkSkillUI(pieceIdx);
    return;
  }

  if (type === 'twins_elder' || type === 'twins_younger') {
    // 쌍둥이: 합류 방향 선택
    showTwinsSkillUI(pieceIdx, pc);
    return;
  }

  // 파라미터 불필요 스킬 → 바로 전송
  socket.emit('use_skill', { pieceIdx, skillId, params: {} });
}

function showKingSkillUI(pieceIdx) {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  document.getElementById('skill-modal-title').textContent = '절대복종 반지 — 대상 선택';
  body.innerHTML = '';

  for (const opc of S.oppPieces) {
    if (!opc.alive) continue;
    const opt = document.createElement('div');
    opt.className = 'skill-option';
    opt.innerHTML = `<div class="skill-name">${opc.icon} ${opc.name}</div>
      <div class="skill-desc">이 적을 선택 후 강제 이동할 위치를 지정합니다</div>`;
    opt.addEventListener('click', () => {
      modal.classList.add('hidden');
      S.action = 'skill_target';
      // 팀모드: ownerIdx 포함해 어느 적의 어떤 캐릭터인지 명확히
      S.skillTargetData = { pieceIdx, skillId: 'ring', type: 'king_move', targetName: opc.type, targetOwnerIdx: opc.ownerIdx };
      document.getElementById('btn-cancel').classList.remove('hidden');
      document.getElementById('action-hint').textContent = `♛ 대상을 강제 이동시킬 위치를 클릭하세요.`;
      renderGameBoard();
    });
    body.appendChild(opt);
  }
  modal.classList.remove('hidden');
}

function showWitchCurseUI(pieceIdx) {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  document.getElementById('skill-modal-title').textContent = '저주 — 대상 선택';
  body.innerHTML = '';

  for (let i = 0; i < S.oppPieces.length; i++) {
    const opc = S.oppPieces[i];
    if (!opc.alive) continue;
    // 이미 저주 상태이거나 HP ≤ 1이면 비활성화
    const alreadyCursed = opc.statusEffects && opc.statusEffects.some(e => e.type === 'curse');
    const tooLowHp = opc.hp <= 1;
    const disabled = alreadyCursed || tooLowHp;
    const reason = alreadyCursed ? '이미 저주 상태' : tooLowHp ? 'HP 1 이하 — 저주 불가' : '';
    const opt = document.createElement('div');
    opt.className = 'skill-option';
    opt.style.opacity = disabled ? '0.4' : '1';
    opt.innerHTML = `<div class="skill-name">${opc.icon} ${opc.name}</div>
      <div class="skill-desc">${disabled ? reason : '턴당 0.5 피해 + 스킬 봉인'}</div>`;
    if (!disabled) {
      opt.addEventListener('click', () => {
        modal.classList.add('hidden');
        // 팀모드: ownerIdx + 해당 적 player의 pieces 배열 내 idx 찾아 전송
        const params = { targetPieceIdx: i };
        if (S.isTeamMode && opc.ownerIdx != null) {
          const ownerPlayer = (S.teamGamePlayers || []).find(p => p.idx === opc.ownerIdx);
          if (ownerPlayer && Array.isArray(ownerPlayer.pieces)) {
            const realIdx = ownerPlayer.pieces.findIndex(pp =>
              pp.type === opc.type && (pp.subUnit || '') === (opc.subUnit || '') && pp.alive);
            params.targetPieceIdx = realIdx >= 0 ? realIdx : i;
            params.targetOwnerIdx = opc.ownerIdx;
          }
        }
        socket.emit('use_skill', { pieceIdx, skillId: 'curse', params });
      });
    }
    body.appendChild(opt);
  }
  modal.classList.remove('hidden');
}

function showMonkSkillUI(pieceIdx) {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  document.getElementById('skill-modal-title').textContent = '신성 — 치유 대상 선택';
  body.innerHTML = '';

  for (let i = 0; i < S.myPieces.length; i++) {
    const apc = S.myPieces[i];
    if (!apc.alive || i === pieceIdx) continue;
    const opt = document.createElement('div');
    opt.className = 'skill-option';
    opt.innerHTML = `<div class="skill-name">${apc.icon} ${apc.name}</div>
      <div class="skill-desc">HP ${apc.hp}/${apc.maxHp} — 치유 +2, 상태이상 제거</div>`;
    opt.addEventListener('click', () => {
      modal.classList.add('hidden');
      socket.emit('use_skill', { pieceIdx, skillId: 'divine', params: { targetPieceIdx: i } });
    });
    body.appendChild(opt);
  }
  modal.classList.remove('hidden');
}

function showTwinsSkillUI(pieceIdx, pc) {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  document.getElementById('skill-modal-title').textContent = '분신 — 합류 방향';
  body.innerHTML = '';

  // 어느 쪽이 누구의 위치로 합류할지 — 두 방향 모두 표시
  const elderIdx = S.myPieces.findIndex(p => p.subUnit === 'elder' && p.alive);
  const youngerIdx = S.myPieces.findIndex(p => p.subUnit === 'younger' && p.alive);
  const options = [
    { target: 'younger', moverIdx: youngerIdx, label: '동생이 누나 위치로 합류' },
    { target: 'elder',   moverIdx: elderIdx,   label: '누나가 동생 위치로 합류' },
  ];

  for (const o of options) {
    const opt = document.createElement('div');
    opt.className = 'skill-option';
    opt.innerHTML = `<div class="skill-name">👫 ${o.label}</div>`;
    opt.addEventListener('click', () => {
      modal.classList.add('hidden');
      // 서버는 params.target === 'elder' 면 elder가 mover.
      // UI 라벨 "누나가 동생 위치로 합류" → mover=elder → params.target='elder'
      // "동생이 누나 위치로 합류" → mover=younger → params.target='younger'
      socket.emit('use_skill', { pieceIdx: o.moverIdx, skillId: 'brothers', params: { target: o.target } });
    });
    body.appendChild(opt);
  }
  modal.classList.remove('hidden');
}

document.getElementById('skill-modal-close').addEventListener('click', () => {
  document.getElementById('skill-modal').classList.add('hidden');
  document.getElementById('skill-modal-title').textContent = '스킬 선택';
  // 스킬 모달 취소 시 액션 모드 글로우 해제 (실제 시전 안 했으므로)
  setActionButtonMode(null);
});

// ═══════════════════════════════════════════════════════════════
// ── 게임 보드 셀 클릭 핸들러 ───────────────────────────────
// ═══════════════════════════════════════════════════════════════

// #9 — 보드 위 부채꼴 행동 메뉴 (이동/공격/스킬)
function _closeRadialActionMenu() {
  const m = document.getElementById('radial-action-menu');
  if (m) m.remove();
  // 활성 셀 클래스 + body 모드 해제 — 다른 캐릭터 dim 도 함께 해제
  document.querySelectorAll('#game-board .cell.radial-active').forEach(c => c.classList.remove('radial-active'));
  document.body.classList.remove('radial-mode-active');
  S._radialMenuPiece = null;
}

// ── 쌍둥이 이동 페이즈 ─────────────────────────────────────
// 쌍둥이는 "둘이 한 세트" — 한 턴에 양쪽 모두 이동권을 가짐. 일반 이동 흐름과 별도 상태 머신으로 처리.
//   진입 조건: 라디얼 메뉴에서 쌍둥이 캐릭터의 "이동" 클릭.
//   상태:
//     - S.twinPhaseActive: 페이즈 진행 중 boolean
//     - S.twinFirstSubMoved: 첫 이동을 끝낸 sub ('elder' / 'younger' / null)
//     - S.action='twin_move' 로 설정하여 handleGameCellClick 가 분기 처리
//     - S.selectedPiece: 이번 이동에서 움직일 쌍둥이 idx (null=아직 미선택)
//   특수 처리:
//     - 두 쌍둥이가 같은 칸에 있을 때 (합류) → 누나/동생 picker 모달
//     - 첫 이동 후에도 "다른 한쪽" 의 이동권 보존
//     - 첫 이동 실행 전에는 턴 종료 차단, 이후엔 가능
//     - 토스트/로그는 페이즈 종료 시 단 한 번만 송출 (S._twinPhaseLogPending 으로 누적 → 종료 시 emit)
function enterTwinMovePhase() {
  if (!S.isMyTurn) return;
  S.twinPhaseActive = true;
  S.twinFirstSubMoved = null;
  S.action = 'twin_move';
  S.selectedPiece = null;
  S._twinPhaseToastShown = false;
  document.getElementById('btn-cancel').classList.remove('hidden');
  if (typeof setActionButtonMode === 'function') setActionButtonMode('move');
  document.body.classList.add('twin-phase-active');
  document.body.classList.add('action-locked');  // 행동 중 — 다른 비-쌍둥이 유닛 상호작용 차단
  setActionHint('쌍둥이 위 [이동 선택] 버튼을 클릭하세요.');
  renderGameBoard();
  if (typeof renderMyPieces === 'function') renderMyPieces();
  // 두 쌍둥이 머리 위로 [이동 선택] 버튼 (또는 합류 상태면 picker)
  refreshTwinPhaseButtons();
}

function exitTwinMovePhase(emitToast) {
  S.twinPhaseActive = false;
  S.twinFirstSubMoved = null;
  S.action = null;
  S.selectedPiece = null;
  document.body.classList.remove('twin-phase-active');
  document.body.classList.remove('action-locked');
  _closeTwinPicker();
  _closeTwinPhaseButtons();
  _closeTwinDisabledButton();
  if (typeof setActionButtonMode === 'function') setActionButtonMode(null);
  document.getElementById('btn-cancel').classList.add('hidden');
  // 페이즈 종료 시 단일 토스트/로그 (이미 표시 안 했고 실제 이동이 일어났을 때만)
  if (emitToast && !S._twinPhaseToastShown) {
    addLog(`👫 쌍둥이 강도 이동`, 'move');
    showSkillToast(`👫 쌍둥이 강도 이동`);
    S._twinPhaseToastShown = true;
  }
  renderGameBoard();
  if (typeof renderMyPieces === 'function') renderMyPieces();
}

function _closeTwinPicker() {
  const p = document.getElementById('twin-picker-menu');
  if (p) p.remove();
  // board 위에 부착된 picker 버튼들도 제거
  document.querySelectorAll('.twin-phase-btn[data-picker="1"]').forEach(b => b.remove());
}
function _closeTwinPhaseButtons() {
  // picker 버튼은 별도 라이프사이클 — _closeTwinPicker 가 관리. 여기서는 비-picker 만 제거.
  document.querySelectorAll('.twin-phase-btn:not([data-picker="1"])').forEach(b => b.remove());
}

// 쌍둥이 페이즈 — 두 쌍둥이 머리 위에 [이동 선택] 버튼 표시.
//   합류(같은 칸) 상태면 picker(누나/동생) 로 대체.
//   이미 이동한 쌍둥이는 이 버튼 표시 안 함 (대신 클릭 시 [행동불가] 표시).
//   ★ incremental — 이미 존재하는 버튼은 유지 (pop 애니메이션이 매번 다시 트리거되지 않게).
//   상태 변화(is-selected, sub 매칭, 셀 위치)만 갱신하고, 새로 만들 필요 있는 것만 createElement.
function refreshTwinPhaseButtons() {
  if (!S.twinPhaseActive) {
    _closeTwinPhaseButtons();
    _closeTwinPicker();
    return;
  }
  const elderPc = (S.myPieces || []).find(p => p.subUnit === 'elder' && p.alive);
  const youngerPc = (S.myPieces || []).find(p => p.subUnit === 'younger' && p.alive);
  if (!elderPc || !youngerPc) return;
  // 합류 상태
  if (elderPc.col === youngerPc.col && elderPc.row === youngerPc.row) {
    if (S.twinFirstSubMoved) {
      // 한쪽이 이미 이동 → 미이동 쌍둥이의 [이동 선택] 버튼만 유지 (이동한 쪽 버튼은 제거).
      //   picker 는 닫음 — 사용자는 명확히 미이동 쪽만 선택할 수 있음.
      _closeTwinPicker();
      const movedSub = S.twinFirstSubMoved;
      const remainingSub = movedSub === 'elder' ? 'younger' : 'elder';
      const remainingPc = remainingSub === 'elder' ? elderPc : youngerPc;
      const board = document.getElementById('game-board');
      // 이동한 쪽 버튼 제거
      const movedBtn = board.querySelector(`.twin-phase-btn[data-sub="${movedSub}"]`);
      if (movedBtn) movedBtn.remove();
      // 미이동 쪽 버튼 위치 동기화 / 생성
      const cellEl = board.querySelector(`.cell[data-col="${remainingPc.col}"][data-row="${remainingPc.row}"]`);
      if (cellEl) {
        let btn = board.querySelector(`.twin-phase-btn[data-sub="${remainingSub}"]`);
        if (btn) {
          btn.style.left = (cellEl.offsetLeft + cellEl.offsetWidth / 2) + 'px';
          btn.style.top = cellEl.offsetTop + 'px';
          const currentlySelected = S.selectedPiece != null && S.myPieces[S.selectedPiece] === remainingPc;
          btn.classList.toggle('is-selected', currentlySelected);
        } else {
          _placeTwinMoveBtn(remainingPc);
        }
      }
      return;
    }
    // 둘 다 미이동 (시작부터 합류) → picker 사용
    //   ★ incremental — 이미 있으면 위치/선택 상태만 갱신, 새로 만들지 않음.
    _closeTwinPhaseButtons();
    showTwinPickerAt(elderPc.col, elderPc.row);  // 함수 내부에서 incremental 처리
    return;
  }
  // 비합류 — picker 닫기, 개별 버튼 incremental 갱신.
  //   ★ 버튼들은 game-board 의 자식으로 absolute 배치되어 있음 → 셀 innerHTML 재렌더에 영향받지 않음.
  //   기존 버튼이 같은 sub 로 살아있으면 위치만 갱신 (pop 애니메이션 재발 방지).
  _closeTwinPicker();
  const board = document.getElementById('game-board');
  for (const pc of [elderPc, youngerPc]) {
    const moved = S.twinFirstSubMoved === pc.subUnit;
    const cellEl = board.querySelector(`.cell[data-col="${pc.col}"][data-row="${pc.row}"]`);
    if (!cellEl) continue;
    let btn = board.querySelector(`.twin-phase-btn[data-sub="${pc.subUnit}"]`);
    if (moved) {
      if (btn) btn.remove();
      continue;
    }
    if (btn) {
      // 기존 버튼 유지 — is-selected 만 갱신 + 위치 동기화 (보드 크기 변화 대응)
      btn.style.left = (cellEl.offsetLeft + cellEl.offsetWidth / 2) + 'px';
      btn.style.top = cellEl.offsetTop + 'px';
      const currentlySelected = S.selectedPiece != null && S.myPieces[S.selectedPiece] === pc;
      btn.classList.toggle('is-selected', currentlySelected);
    } else {
      _placeTwinMoveBtn(pc);
    }
  }
}

function _placeTwinMoveBtn(pc) {
  const board = document.getElementById('game-board');
  if (!board) return;
  const cellEl = board.querySelector(`.cell[data-col="${pc.col}"][data-row="${pc.row}"]`);
  if (!cellEl) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'twin-phase-btn';
  const sub = pc.subUnit;
  btn.dataset.sub = sub;
  btn.innerHTML = `<span class="ic">${sub === 'elder' ? '👧' : '👦'}</span><span class="lbl">이동 선택</span>`;
  const left = cellEl.offsetLeft + cellEl.offsetWidth / 2;
  const top = cellEl.offsetTop;
  btn.style.left = left + 'px';
  btn.style.top = top + 'px';
  const currentlySelected = S.selectedPiece != null && S.myPieces[S.selectedPiece] === pc;
  if (currentlySelected) btn.classList.add('is-selected');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 다른 쌍둥이가 이미 이동 선택 상태면 — 선택 전환은 차단.
    //   단, 클릭된 쌍둥이의 셀이 현재 selected 쌍둥이의 인접 칸이면 → 이동 (합류) 으로 진행.
    if (S.selectedPiece != null) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc && selPc.subUnit && selPc.subUnit !== sub) {
        // 인접 1칸이면 정상 이동(합류) 으로 진행 — selectedPiece 는 그대로, 이동 emit
        const targetPc = (S.myPieces || []).find(p => p.subUnit === sub && p.alive);
        if (targetPc) {
          const dCol = Math.abs(targetPc.col - selPc.col);
          const dRow = Math.abs(targetPc.row - selPc.row);
          const inRange = (dCol === 1 && dRow === 0) || (dCol === 0 && dRow === 1);
          if (inRange) {
            socket.emit('move_piece', { pieceIdx: S.selectedPiece, col: targetPc.col, row: targetPc.row });
          }
        }
        return;  // 인접 아니면 그냥 차단 (선택 전환 방지)
      }
    }
    // ★ 버그 수정: pc 를 closure 로 캡처하면 move_ok 후 S.myPieces 가 새 배열로 교체되어 indexOf=-1.
    //   클릭 시점에 data-sub 로 현재 piece 객체 재검색.
    const currentPc = (S.myPieces || []).find(p => p.subUnit === sub && p.alive);
    if (!currentPc) return;
    S.selectedPiece = S.myPieces.indexOf(currentPc);
    setActionHint(`${sub === 'elder' ? '👧 누나' : '👦 동생'} 이동할 칸을 클릭하세요.`);
    refreshTwinPhaseButtons();
    renderGameBoard();
  });
  board.appendChild(btn);
}

// ※ 사용자 보관 요청: 가장 처음 도입했던 살짝 긴 사각형의 [행동 불가] 버튼 — 코드/CSS 보존.
//   현재 흐름에선 호출하지 않음 (대신 라디얼 메뉴에서 이동·공격 dim 으로 처리).
//   추후 다시 사용할 수 있도록 그대로 둠.
function _showTwinDisabledButton(col, row) {
  _closeTwinDisabledButton();
  const cellEl = document.querySelector(`#game-board .cell[data-col="${col}"][data-row="${row}"]`);
  if (!cellEl) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'twin-disabled-btn';
  btn.disabled = true;
  btn.innerHTML = `<span class="ic">🚫</span><span class="lbl">행동 불가</span>`;
  cellEl.appendChild(btn);
}
function _closeTwinDisabledButton() {
  document.querySelectorAll('.twin-disabled-btn').forEach(b => b.remove());
}

// 합류 상태에서 어느 쪽을 움직일지 선택하는 picker (라디얼과 동일 양식 — 누나/동생 두 버튼)
//   셀의 화면 좌표 기준으로 fixed 배치. renderGameBoard 후 refreshTwinPhaseButtons 가 다시 호출되며 재배치됨.
// ── 합류 상태 picker ──
//   사용자 요청: 비합류 [이동 선택] 버튼과 동일 디자인 (twin-phase-btn).
//   합류 셀에 두 개를 양쪽으로 배치 (누나=왼쪽, 동생=오른쪽).
//   game-board 의 absolute 자식으로 배치 → 셀 innerHTML 재렌더에도 살아남음.
//   클릭 시 picker 자체는 유지 (제거하지 않음). 선택 상태만 is-selected 로 표시.
function showTwinPickerAt(col, row) {
  // incremental: 이미 있으면 유지·갱신만
  const board = document.getElementById('game-board');
  if (!board) return;
  const cellEl = board.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
  if (!cellEl) return;
  const cx = cellEl.offsetLeft + cellEl.offsetWidth / 2;
  const top = cellEl.offsetTop;
  // 합류 picker — 셀 위쪽 양옆으로 배치. 라벨은 비합류 버튼과 동일한 "이동 선택" — 이모지(👧/👦)로 구분.
  //   안 겹치는 최소 offset (≈ 버튼 절반폭 + 소량 갭).
  const SPLIT = 38;
  const placements = [
    { sub: 'elder',   icon: '👧', label: '이동 선택', x: cx - SPLIT },
    { sub: 'younger', icon: '👦', label: '이동 선택', x: cx + SPLIT },
  ];
  for (const it of placements) {
    let btn = board.querySelector(`.twin-phase-btn[data-sub="${it.sub}"][data-picker="1"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'twin-phase-btn twin-picker-btn';
      btn.dataset.sub = it.sub;
      btn.dataset.picker = '1';
      btn.innerHTML = `<span class="ic">${it.icon}</span><span class="lbl">${it.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pc = (S.myPieces || []).find(p => p.subUnit === it.sub && p.alive);
        if (!pc) return;
        S.selectedPiece = S.myPieces.indexOf(pc);
        const subLabel = it.sub === 'elder' ? '누나' : '동생';
        setActionHint(`${it.icon} ${subLabel} 이동할 칸을 클릭하세요.`);
        // ★ picker 유지 — 재생성 안 함. is-selected 만 갱신.
        refreshTwinPickerSelection();
        renderGameBoard();
      });
      board.appendChild(btn);
    }
    btn.style.left = it.x + 'px';
    btn.style.top = top + 'px';
  }
  refreshTwinPickerSelection();
  // 합류 picker 표식 (id 유지 — 다른 코드가 querySelector('#twin-picker-menu') 로 존재 확인하기 때문)
  if (!document.getElementById('twin-picker-menu')) {
    const marker = document.createElement('div');
    marker.id = 'twin-picker-menu';
    marker.style.display = 'none';
    document.body.appendChild(marker);
  }
}

// 합류 picker 의 is-selected 클래스만 갱신 (DOM 재생성 없이)
function refreshTwinPickerSelection() {
  const board = document.getElementById('game-board');
  if (!board) return;
  const selPc = (S.selectedPiece != null) ? S.myPieces[S.selectedPiece] : null;
  const selSub = selPc?.subUnit || null;
  board.querySelectorAll('.twin-phase-btn[data-picker="1"]').forEach(btn => {
    btn.classList.toggle('is-selected', btn.dataset.sub === selSub);
  });
}
function _showRadialActionMenu(col, row, pieceIdx) {
  _closeRadialActionMenu();
  const cellEl = document.querySelector(`#game-board .cell[data-col="${col}"][data-row="${row}"]`);
  if (!cellEl) return;
  cellEl.classList.add('radial-active');
  document.body.classList.add('radial-mode-active');
  const r = cellEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const radius = 68;
  const menu = document.createElement('div');
  menu.id = 'radial-action-menu';
  menu.className = 'radial-action-menu';

  // 두 가지 모드:
  //   (A) 기본 행동 가능 → [이동, 공격, 스킬] (현재 동작)
  //   (B) 기본 행동 소진 → [행동 불가] + [스킬 (있을 때만)] (스킬 dim if 사용 불가)
  const pc = S.myPieces && S.myPieces[pieceIdx];
  const canBasic = pieceCanTakeBasicAction(pc);
  const hasSkill = pieceHasAnySkill(pc);
  const canSkill = canPieceUseAnySkill(pieceIdx);

  // 라디얼 항목은 항상 이동/공격/스킬 동일 라벨·아이콘. 사용 가능 여부는 disabled (dim) 로만 표시 — 스킬과 동일 패턴.
  //   기본 행동 소진 시 → 이동·공격 둘 다 disabled. 스킬은 별도 canSkill 로 결정.
  //   스킬 미보유 캐릭터는 -45° 자리 비움 (hideIfMissing).
  const items = [
    { angle: -135, key: 'move',   icon: '🏃', label: '이동',   disabled: !canBasic },
    { angle:  -90, key: 'attack', icon: '⚔',  label: '공격',   disabled: !canBasic },
    { angle:  -45, key: 'skill',  icon: '✨',  label: '스킬',   disabled: !canSkill, hideIfMissing: !hasSkill },
  ].filter(it => !it.hideIfMissing);

  for (const it of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'radial-btn' + ((it.key && it.key.indexOf('unable') === 0) ? ' radial-btn-unable' : '');
    btn.dataset.key = it.key;
    btn.innerHTML = `<span class="ic">${it.icon}</span><span class="lbl">${it.label}</span>`;
    const rad = it.angle * Math.PI / 180;
    const x = cx + Math.cos(rad) * radius;
    const y = cy + Math.sin(rad) * radius;
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
    if (it.disabled) btn.disabled = true;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      _closeRadialActionMenu();
      if (it.key === 'skill') {
        if (!S.isMyTurn) return;
        if (typeof setActionButtonMode === 'function') setActionButtonMode('skill');
        openSkillModal(pieceIdx);
        return;
      }
      if (it.key === 'move') {
        const pc2 = S.myPieces && S.myPieces[pieceIdx];
        // 쌍둥이 이동 페이즈는 두 쌍둥이 모두 생존해 있을 때만 진입.
        //   한 쌍이 사망했으면 일반 이동 흐름으로 처리 (쌍둥이 한 명 = 일반 유닛처럼 단일 이동).
        if (pc2 && pc2.subUnit && typeof enterTwinMovePhase === 'function') {
          const elderAlive = (S.myPieces || []).some(p => p.subUnit === 'elder' && p.alive);
          const youngerAlive = (S.myPieces || []).some(p => p.subUnit === 'younger' && p.alive);
          if (elderAlive && youngerAlive) {
            enterTwinMovePhase();
            return;
          }
        }
      }
      const targetBtn = document.getElementById('btn-' + it.key);
      if (targetBtn && !targetBtn.disabled) {
        targetBtn.click();
        S.selectedPiece = pieceIdx;
        renderGameBoard();
      }
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  S._radialMenuPiece = pieceIdx;
}
// 다른 곳 누르면 자동 닫힘
document.addEventListener('click', (e) => {
  const m = document.getElementById('radial-action-menu');
  if (m && !m.contains(e.target)) {
    // 보드 셀 클릭은 handleGameCellClick 이 별도로 처리하므로 여기서는 그 외만 닫음
    if (!e.target.closest('#game-board .cell')) _closeRadialActionMenu();
  }
  // [행동불가] 라디얼 — 다른 곳 클릭 시 닫힘 (보드 클릭은 handleGameCellClick 이 처리)
  const disabledBtn = document.querySelector('.twin-disabled-btn');
  if (disabledBtn && !disabledBtn.contains(e.target) && !e.target.closest('#game-board .cell')) {
    _closeTwinDisabledButton();
  }
});
// 라디얼 모드 활성화 — 보드 아래 행동 버튼 숨김
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('radial-menu-mode');
});
if (document.readyState !== 'loading') {
  document.body.classList.add('radial-menu-mode');
}

function handleGameCellClick(col, row) {
  const bounds = S.boardBounds;
  if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) return;

  // #9 — 행동이 진행 중이지 않을 때 내 말 셀을 누르면 라디얼 메뉴 표시
  if (S.isMyTurn && !S.action) {
    const myPc = (S.myPieces || []).find(p => p.alive && p.col === col && p.row === row);
    if (myPc) {
      const idx = S.myPieces.indexOf(myPc);
      _showRadialActionMenu(col, row, idx);
      return;
    } else {
      // 빈 셀 / 적 셀 클릭 — 라디얼 닫기
      _closeRadialActionMenu();
    }
  }
  // 행동 진행 중 (move/attack/skill_target/twin_move) — 다른 내 유닛 클릭 차단.
  //   사용자가 selected piece 의 행동만 완료할 수 있게 (취소 버튼으로만 해제 가능).
  //   단, twin_move 페이즈에서는 위 분기에서 별도 처리 (이동한 쌍둥이 [행동불가] / 그린 셀 이동).
  if (S.isMyTurn && S.action && S.action !== 'twin_move') {
    const myPc = (S.myPieces || []).find(p => p.alive && p.col === col && p.row === row);
    const selPc = (S.selectedPiece != null) ? S.myPieces[S.selectedPiece] : null;
    if (myPc && selPc && myPc !== selPc) {
      // 다른 내 유닛 클릭 — 차단 (selected piece 의 행동을 끝내거나 취소 후 다시 시도)
      return;
    }
  }

  // ── 팀원 공격 범위 오버레이 토글 (턴/행동 무관, 단 내 행동 대상셀이 아닐 때만) ──
  if (S.isTeamMode && Array.isArray(S.teammatePieces)) {
    const tmPc = S.teammatePieces.find(p => p.col === col && p.row === row && p.alive);
    const myAtCell = S.myPieces?.find(p => p.col === col && p.row === row && p.alive);
    const isMyActionTargeting = S.isMyTurn && (S.action === 'attack' || S.action === 'skill_target' || S.action === 'move') && S.selectedPiece !== null;
    if (tmPc && !myAtCell && !isMyActionTargeting) {
      const key = `${tmPc.col},${tmPc.row}`;
      if (S.teammateRangeKey === key) {
        S.teammateRangeKey = null;
        S.teammateRangePiece = null;
      } else {
        S.teammateRangeKey = key;
        S.teammateRangePiece = tmPc;
      }
      renderGameBoard();
      return;
    }
  }

  if (!S.isMyTurn) return;

  // ── 쌍둥이 이동 페이즈 ──
  //   floating 버튼 (이동 선택) 클릭으로만 selectedPiece 가 결정됨.
  //   여기서는 (1) 이미 이동한 쌍둥이 셀 클릭 → [행동 불가] 라디얼 표시, (2) 그린 셀 클릭 → 이동 emit.
  //   다른 캐릭터 셀 / 빈 셀 / 중립 클릭은 무시.
  if (S.action === 'twin_move') {
    // ★ 사용자 요청: 쌍둥이 이동 페이즈 클릭 정책
    //   - [이동 선택] 버튼은 separate 한 핸들러 (selectedPiece 결정).
    //   - 이미 이동한 쌍둥이 (분리 상태) : 라디얼/선택/이동 어떤 상호작용도 ❌ — 완전 비활성.
    //   - selectedPiece 가 있고 인접 그린 셀 클릭 : 이동 emit (다른 쌍둥이 칸이면 합류).
    //   - 그 외 모든 클릭 (비인접 칸, 빈 칸, 적 셀 등) : 무시.
    _closeTwinDisabledButton();  // 보관된 함수 — 잔존 시 정리
    if (S.selectedPiece !== null) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc) {
        const dCol = Math.abs(col - selPc.col);
        const dRow = Math.abs(row - selPc.row);
        const inRange = (dCol === 1 && dRow === 0) || (dCol === 0 && dRow === 1);
        if (inRange) {
          socket.emit('move_piece', { pieceIdx: S.selectedPiece, col, row });
        }
      }
    }
    return;
  }

  // ── 스킬 대상 선택 모드 ──
  if (S.action === 'skill_target' && S.skillTargetData) {
    const data = S.skillTargetData;
    if (data.type === 'bomb_place') {
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params: { col, row } });
    } else if (data.type === 'dragon_place') {
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params: { col, row } });
    } else if (data.type === 'king_move') {
      const params = { targetName: data.targetName, col, row };
      if (data.targetOwnerIdx != null) params.targetOwnerIdx = data.targetOwnerIdx;
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params });
    }
    resetAction();
    return;
  }

  // ── 이동 ──
  if (S.action === 'move') {
    if (S.selectedPiece === null) {
      // 말 선택
      const pc = S.myPieces.find(p => p.col === col && p.row === row && p.alive);
      if (pc) {
        // 쌍둥이 이동 중: 이미 이동한 쪽 차단
        if (S.twinMovePending && S.twinMovedSub && pc.subUnit === S.twinMovedSub) {
          setActionHint('이미 이동한 쌍둥이입니다. 다른 쪽을 이동하세요.', true);
          return;
        }
        // 쌍둥이 이동 중: 쌍둥이가 아닌 유닛 선택 차단
        if (S.twinMovePending && !pc.subUnit) {
          setActionHint('쌍둥이 이동 중입니다. 나머지 쌍둥이를 이동시키세요.', true);
          return;
        }
        // #7: 전령 질주 중 — 해당 전령만 이동 가능
        const sprintActive = S.myPieces.find(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
        if (sprintActive && pc !== sprintActive) {
          setActionHint('전령의 질주 중입니다. 전령은 한번 더 이동할 수 있습니다.', true);
          return;
        }
        S.selectedPiece = S.myPieces.indexOf(pc);
        document.getElementById('action-hint').textContent = `${pc.name} 선택. 이동할 칸을 클릭하세요.`;
        renderGameBoard();
        renderMyPieces();
      }
    } else {
      const selPc = S.myPieces[S.selectedPiece];
      // 같은 말 클릭 → 해제
      if (col === selPc.col && row === selPc.row) {
        S.selectedPiece = null;
        document.getElementById('action-hint').textContent = '이동할 유닛을 클릭하세요.';
        renderGameBoard();
        renderMyPieces();
        return;
      }
      // 다른 내 말 → 선택 변경
      const otherPc = S.myPieces.find(p => p.col === col && p.row === row && p.alive && S.myPieces.indexOf(p) !== S.selectedPiece);
      if (otherPc) {
        S.selectedPiece = S.myPieces.indexOf(otherPc);
        document.getElementById('action-hint').textContent = `${otherPc.name} 선택. 이동할 칸을 클릭하세요.`;
        renderGameBoard();
        renderMyPieces();
        return;
      }
      // 이동 범위 체크
      if (!isCrossAdjacent(selPc.col, selPc.row, col, row)) {
        setActionHint('상하좌우 1칸만 이동 가능합니다.', true);
        return;
      }
      socket.emit('move_piece', { pieceIdx: S.selectedPiece, col, row });
      S.action = null;
      S.selectedPiece = null;
    }
    return;
  }

  // ── 공격 ──
  if (S.action === 'attack') {
    if (S.selectedPiece === null) {
      // 말 선택
      const pc = S.myPieces.find(p => p.col === col && p.row === row && p.alive);
      if (pc) {
        // #2: 쌍검무 활성 — 해당 양손검객만 선택 가능
        const dualActive = S.myPieces.find(p => p.alive && p.dualBladeAttacksLeft > 0);
        if (dualActive && pc !== dualActive) {
          setActionHint('양손검객의 쌍검무 중입니다. 양손 검객으로 추가 공격하세요.', true);
          return;
        }
        S.selectedPiece = S.myPieces.indexOf(pc);
        // 타겟 선택이 필요한 캐릭터
        if (pc.type === 'shadowAssassin' || pc.type === 'witch') {
          S.targetSelectMode = true;
          document.getElementById('action-hint').textContent = `${pc.icon} ${pc.name} 선택. 공격할 칸을 선택하세요.`;
        } else {
          S.targetSelectMode = false;
          document.getElementById('action-hint').textContent = `${pc.icon} ${pc.name} 선택. 더블 클릭 시 공격합니다.`;
        }
        renderGameBoard();
        renderMyPieces();
      }
    } else if (S.targetSelectMode) {
      // shadowAssassin / witch 대상 선택
      socket.emit('attack', { pieceIdx: S.selectedPiece, tCol: col, tRow: row });
      S.action = null;
      S.selectedPiece = null;
      S.targetSelectMode = false;
    } else {
      const selPc = S.myPieces[S.selectedPiece];
      // 같은 칸 클릭(쌍둥이 겹쳐 있음 포함) → 공격 확정 (선택 변경 아님)
      const sameCellAsSel = (selPc && col === selPc.col && row === selPc.row);
      if (sameCellAsSel) {
        socket.emit('attack', { pieceIdx: S.selectedPiece });
        S.action = null;
        S.selectedPiece = null;
        return;
      }
      // 다른 칸의 내 말 클릭 → 선택 변경
      const clickedOther = S.myPieces.find(p => p.col === col && p.row === row && p.alive && S.myPieces.indexOf(p) !== S.selectedPiece);
      if (clickedOther) {
        // #2: 쌍검무 중에는 양손검객 외 선택 차단
        const dualActive2 = S.myPieces.find(p => p.alive && p.dualBladeAttacksLeft > 0);
        if (dualActive2 && clickedOther !== dualActive2) {
          setActionHint('양손검객의 쌍검무 중입니다. 양손 검객으로 추가 공격하세요.', true);
          return;
        }
        S.selectedPiece = S.myPieces.indexOf(clickedOther);
        if (clickedOther.type === 'shadowAssassin' || clickedOther.type === 'witch') {
          S.targetSelectMode = true;
          document.getElementById('action-hint').textContent = `${clickedOther.icon} ${clickedOther.name} 선택. 공격할 칸을 선택하세요.`;
        } else {
          S.targetSelectMode = false;
          document.getElementById('action-hint').textContent = `${clickedOther.icon} ${clickedOther.name} 선택. 더블 클릭 시 공격합니다.`;
        }
        renderGameBoard();
        renderMyPieces();
        return;
      }
      // 범위 내 클릭 → 공격 확정
      socket.emit('attack', { pieceIdx: S.selectedPiece });
      S.action = null;
      S.selectedPiece = null;
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// ── 보드 생성 헬퍼 ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

function buildBoard(containerId, clickHandler) {
  const board = document.getElementById(containerId);
  if (!board) return;
  // 팀모드에서 7x7: 게임 보드 + 배치 보드. 드래프트 미리보기는 항상 5x5.
  const is7x7 = S.isTeamMode && (containerId === 'game-board' || containerId === 'placement-board');
  const totalSize = is7x7 ? 7 : 5;
  const cellPx = is7x7 ? 44 : 56;
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${totalSize}, ${cellPx}px)`;
  board.style.gridTemplateRows = `repeat(${totalSize}, ${cellPx}px)`;
  // 게임 보드의 실제 폭 (cell + gap + padding + border)을 CSS 변수로 노출 — 턴 배너·전투 로그가 이를 따라 폭 맞춤
  if (containerId === 'game-board') {
    const gap = 4, padding = 8, border = 2;
    const boardWidth = totalSize * cellPx + (totalSize - 1) * gap + padding * 2 + border * 2;
    const center = document.querySelector('#screen-game .center-panel');
    if (center) center.style.setProperty('--board-w', boardWidth + 'px');
  }
  // 팀모드 플래그를 body에도 반영 — 모바일 CSS가 7x7을 인식하도록
  if (S.isTeamMode) document.body.classList.add('team-mode');
  else document.body.classList.remove('team-mode');
  for (let row = 0; row < totalSize; row++) {
    for (let col = 0; col < totalSize; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      cell.style.width = cellPx + 'px';
      cell.style.height = cellPx + 'px';
      cell.innerHTML = `<span class="coord-label">${coord(col,row)}</span>`;
      cell.addEventListener('click', () => clickHandler(col, row));
      board.appendChild(cell);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ── 공격 범위 계산 (클라이언트용, 30캐릭터) ─────────────────
// ═══════════════════════════════════════════════════════════════

function getAttackCells(type, col, row, extra) {
  extra = extra || {};
  const cells = [];
  const bMin = (S.boardBounds && S.boardBounds.min) || 0;
  const bMax = (S.boardBounds && S.boardBounds.max) || 4;
  const push = (c, r) => { if (c >= bMin && c <= bMax && r >= bMin && r <= bMax) cells.push({ col: c, row: r }); };

  switch (type) {
    // ── TIER 1 ──
    case 'archer': {
      if (extra.toggleState === 'right') {
        const d = col - row;
        for (let c = bMin; c <= bMax; c++) { const r = c - d; if (r >= bMin && r <= bMax) push(c, r); }
      } else {
        const d = col + row;
        for (let c = bMin; c <= bMax; c++) { const r = d - c; if (r >= bMin && r <= bMax) push(c, r); }
      }
      break;
    }
    case 'spearman':
      for (let r = bMin; r <= bMax; r++) push(col, r);
      break;
    case 'cavalry':
      for (let c = bMin; c <= bMax; c++) push(c, row);
      break;
    case 'watchman':
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (dc !== 0 || dr !== 0) push(col+dc, row+dr);
      break;
    case 'twins_elder':
      push(col, row); push(col-1, row); push(col+1, row);
      break;
    case 'twins_younger':
      push(col, row); push(col, row-1); push(col, row+1);
      break;
    case 'scout':
      push(col, row); push(col-1, row); push(col+1, row);
      break;
    case 'manhunter':
      push(col, row); push(col, row-1); push(col, row+1);
      break;
    case 'messenger':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'gunpowder':
      push(col, row-1); push(col, row-2); push(col, row+1); push(col, row+2);
      break;
    case 'herbalist':
      push(col-1, row); push(col-2, row); push(col+1, row); push(col+2, row);
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
      if (extra.tCol !== undefined) push(extra.tCol, extra.tRow);
      else {
        // 미니 그리드용: 자신 포함 주변 9칸 모두 표시
        push(col, row);
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (dc !== 0 || dr !== 0) push(col+dc, row+dr);
      }
      break;
    case 'wizard':
      push(col, row-2); push(col, row+2); push(col-2, row); push(col+2, row);
      break;
    case 'armoredWarrior':
      push(col, row); push(col-1, row+1); push(col, row+1); push(col+1, row+1);
      break;
    case 'witch':
      if (extra.tCol !== undefined) push(extra.tCol, extra.tRow);
      break;
    case 'dualBlade':
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'ratMerchant':
      push(col, row);
      // 자기 쥐 위치만 공격 범위에 포함
      if (S.boardObjects) {
        for (const obj of S.boardObjects) {
          if (obj.type === 'rat' && obj.owner === S.playerIdx) push(obj.col, obj.row);
        }
      }
      break;
    case 'weaponSmith':
      if (extra.toggleState === 'vertical') {
        push(col, row); push(col, row-1); push(col, row+1);
      } else {
        push(col, row); push(col-1, row); push(col+1, row);
      }
      break;
    case 'bodyguard':
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;

    // ── TIER 3 ──
    case 'prince':
      push(col, row); push(col-1, row); push(col+1, row);
      break;
    case 'princess':
      push(col, row); push(col, row-1); push(col, row+1);
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
      push(col, row-1); push(col, row+1);
      break;
    case 'slaughterHero':
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) push(col+dc, row+dr);
      break;
    case 'commander':
      push(col-1, row); push(col+1, row);
      break;
    case 'sulfurCauldron':
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (dc !== 0 || dr !== 0) push(col+dc, row+dr);
      break;
    case 'torturer':
      push(col, row); push(col, row+1);
      break;
    case 'count':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
  }
  return cells;
}

function isCrossAdjacent(c1, r1, c2, r2) {
  const dc = Math.abs(c1 - c2), dr = Math.abs(r1 - r2);
  return (dc === 1 && dr === 0) || (dc === 0 && dr === 1);
}

// ═══════════════════════════════════════════════════════════════
// ── 유틸리티 ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// 스킬·패시브 메시지의 "{icon} {name}: {body}" 패턴을 감지해 헤더를 미니 헤더 스타일로 + 콜론 시각적 제거
// 메시지 텍스트는 서버에서 그대로 받음 — 렌더 단계에서만 스타일 적용 (인벤토리 #D/#E 빨간 피드백)
function formatMsgMiniHeader(msg) {
  if (!msg || typeof msg !== 'string') return msg;
  // [N]턴 : / T123 형식의 시스템 카운터는 변환하지 않음
  if (/^\s*\[?\d+\]?\s*턴\s*:/.test(msg)) return msg;
  // 첫 ': ' 위치에서 헤더 / 본문 분리
  const colonIdx = msg.indexOf(': ');
  if (colonIdx <= 0 || colonIdx > 18) return msg;  // 헤더 너무 길면 패턴 아님
  const head = msg.slice(0, colonIdx);
  const body = msg.slice(colonIdx + 2);
  // 헤더는 이모지/특수기호로 시작해야 (ASCII 영문/숫자로 시작하면 변환하지 않음)
  const first = head.codePointAt(0) || 0;
  const isAsciiAlnum = (first >= 0x30 && first <= 0x39) || (first >= 0x41 && first <= 0x5A) || (first >= 0x61 && first <= 0x7A);
  if (isAsciiAlnum) return msg;
  // 본문이 비면 그대로
  if (!body) return msg;
  const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  return `<span class="msg-skill-head">${esc(head)}</span> ${esc(body)}`;
}

function addLog(msg, type = 'system') {
  // 풀스크린 오버레이 재생 중에는 로그도 일시 정지 → 종료 후 일괄 출력
  if (S._fullscreenBusy) {
    if (!S._eventDuringFullscreen) S._eventDuringFullscreen = [];
    S._eventDuringFullscreen.push(() => addLog(msg, type));
    return;
  }
  const log = document.getElementById('game-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const formatted = formatMsgMiniHeader(msg);
  entry.innerHTML = `<span class="turn-num">T${S.turnNumber}</span> ${formatted}`;
  log.prepend(entry);
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

// ── 풀스크린 오버레이 큐/락 ─────────────────────────────────────
// 1대1 대치, 보드 축소(파괴 시작), SP 지급 — 동시 재생 금지. 하나 끝나면 다음.
// 재생 중에는 모든 토스트·로그·passive_alert·curse_tick 이 버퍼로 들어가 종료 후 드레인.
S._fullscreenBusy = false;
S._fullscreenQueue = [];          // [{fn, durationMs}]
S._eventDuringFullscreen = [];    // [() => effect()]

// 애니메이션 페이즈 #24 — 연속 풀스크린 사이에 0.5s 텀.
//   여러 turn-event (보드 파괴 경고/실행, SP 지급) 가 동시 발사되면 큐로 순차 재생.
const ANIM_PHASE_GAP_MS = 500;
function runFullscreenLocked(playFn, durationMs) {
  if (S._fullscreenBusy) {
    S._fullscreenQueue.push({ fn: playFn, durationMs });
    return;
  }
  S._fullscreenBusy = true;
  try { playFn(); } catch (e) { console.error('[fullscreen]', e); }
  setTimeout(() => {
    S._fullscreenBusy = false;
    drainFullscreenBuffer();
    if (S._fullscreenQueue.length > 0) {
      const next = S._fullscreenQueue.shift();
      // 0.5s 텀 후 다음 애니 시작
      setTimeout(() => runFullscreenLocked(next.fn, next.durationMs), ANIM_PHASE_GAP_MS);
    }
  }, durationMs);
}
function drainFullscreenBuffer() {
  const buf = S._eventDuringFullscreen || [];
  S._eventDuringFullscreen = [];
  for (const ev of buf) {
    try { ev(); } catch (e) {}
  }
}
// #17/#22 안전장치 — 풀스크린 lock 이 어떤 이유로 stuck 되어도 버퍼된 토스트/로그가 영구 누락되지 않게.
//   1초마다 점검: lock 이 풀려있고 버퍼에 미발송 이벤트가 쌓여있으면 강제 드레인.
setInterval(() => {
  try {
    if (!S._fullscreenBusy && (S._eventDuringFullscreen || []).length > 0) {
      drainFullscreenBuffer();
    }
  } catch (e) {}
}, 1000);

// ── #11 모바일/태블릿 길게 누르기 → 호버 툴팁 표시 ──
// 마우스가 없는 디바이스에서 :hover 가 동작 안 함. 길게 누르기(500ms)로 .piece-tooltip 을 표시.
//   다른 곳을 탭하면 자동 해제. 한 번에 하나만 표시.
(function setupLongPressTooltips() {
  let pressTimer = null;
  let pressTarget = null;
  let activePinnedEl = null;
  const LONG_PRESS_MS = 500;

  function findTooltipHost(el) {
    // 가장 가까운 piece-tooltip 자식을 가진 ancestor 를 찾음
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.querySelector && cur.querySelector(':scope > .piece-tooltip')) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function pinTooltip(el) {
    if (activePinnedEl && activePinnedEl !== el) {
      activePinnedEl.classList.remove('tooltip-pinned');
    }
    activePinnedEl = el;
    el.classList.add('tooltip-pinned');
  }
  function unpinTooltip() {
    if (activePinnedEl) {
      activePinnedEl.classList.remove('tooltip-pinned');
      activePinnedEl = null;
    }
  }

  document.addEventListener('touchstart', (e) => {
    if (pressTimer) clearTimeout(pressTimer);
    const host = findTooltipHost(e.target);
    pressTarget = host;
    if (!host) {
      // 빈 곳 탭 → 기존 툴팁 해제
      unpinTooltip();
      return;
    }
    pressTimer = setTimeout(() => {
      pressTimer = null;
      // 길게 누름 — 같은 카드면 토글, 다른 카드면 새로 pin
      if (activePinnedEl === host) {
        unpinTooltip();
      } else {
        pinTooltip(host);
      }
    }, LONG_PRESS_MS);
  }, { passive: true });

  document.addEventListener('touchmove', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }, { passive: true });

  // pinned 상태에서 click 으로 다른 곳 누르면 해제
  document.addEventListener('click', (e) => {
    if (!activePinnedEl) return;
    if (!activePinnedEl.contains(e.target)) unpinTooltip();
  });
})();

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; setTimeout(() => { if (el) el.textContent = ''; }, 3000); }
}

function findChar(type) {
  const charData = S.characters || S.specCharacters;
  if (!charData) return null;
  for (const tier of [1, 2, 3]) {
    const chars = charData[tier];
    if (!chars) continue;
    const found = chars.find(c => c.type === type);
    if (found) return found;
  }
  return null;
}

function getPassiveLabel(passiveId) {
  const map = {
    instantMagic: '피격 시 일회용 SP 1개 획득',
    ironSkin: '받는 모든 공격 피해가 0.5씩 감소',
    grace: '악인을 공격할 때 3 피해 · 악인의 공격 피해 0.5로 감소',
    betrayer: '공격 범위 내 모든 아군에게도 1 피해',
    wrath: '인접한 아군에게 사기 증진 부여',
    markPassive: '공격 시 대상에게 표식 부여',
    tyranny: '1티어 · 2티어에게 받는 모든 공격 피해 0.5씩 감소',
    loyalty: '다른 왕실 아군이 받을 피해를 1로 감소시켜 대신 받음 · 상태 이상 대신 받음',
  };
  return map[passiveId] || passiveId;
}
// 패시브의 공식 이름 (미니 헤더용) — server.js의 passiveName과 일치
function getPassiveName(passiveId) {
  const map = {
    instantMagic: '인스턴트매직',
    ironSkin: '아이언스킨',
    grace: '가호',
    betrayer: '배반자',
    wrath: '사기증진',
    markPassive: '표식',
    tyranny: '폭정',
    loyalty: '충성',
  };
  return map[passiveId] || passiveId;
}

// ── 관전자: 드래프트 UI ──────────────────────────────────────
function renderSpectatorDraft() {
  const chars = S.specCharacters || {};
  const draft = S.specDraft || {};
  const container = document.querySelector('.draft-layout');
  if (!container) return;

  const mainEl = document.querySelector('.draft-main');
  const sideEl = document.querySelector('.draft-sidebar');
  if (!mainEl || !sideEl) return;

  // 대칭 레이아웃으로 양쪽 패널 완전 동일 크기
  container.style.display = 'flex';
  container.style.gap = '20px';
  container.style.alignItems = 'stretch';
  container.style.justifyContent = 'center';

  mainEl.style.cssText = 'flex:1; max-width:400px; min-width:0; width:0;';
  mainEl.innerHTML = `
    <div class="spec-draft-panel">
      <h3 style="color:#60a5fa;text-align:center">${S.specP0Name} ${draft.draftDone?.[0] ? '✅' : '⏳'}</h3>
      <div class="spec-draft-slots" id="spec-draft-p0"></div>
    </div>`;

  sideEl.style.cssText = 'flex:1; max-width:400px; min-width:0; width:0;';
  sideEl.innerHTML = `
    <div class="spec-draft-panel">
      <h3 style="color:#f87171;text-align:center">${S.specP1Name} ${draft.draftDone?.[1] ? '✅' : '⏳'}</h3>
      <div class="spec-draft-slots" id="spec-draft-p1"></div>
    </div>`;

  for (const [pIdx, key] of [[0, 'p0'], [1, 'p1']]) {
    const slotsEl = document.getElementById(`spec-draft-${key}`);
    if (!slotsEl) continue;
    // 실시간 브라우징 데이터 우선, 확정 데이터 폴백
    const browse = draft[key + 'Browse'] || {};
    const confirmed = draft[key]; // { t1, t2, t3 } or null
    const isDone = draft.draftDone?.[pIdx];

    for (let tier = 1; tier <= 3; tier++) {
      const slot = document.createElement('div');
      // 브라우징 중이면 실시간 선택, 확정이면 확정 데이터
      const typeKey = isDone && confirmed ? confirmed[`t${tier}`] : (browse[tier] || browse[String(tier)] || null);
      const charList = chars[tier] || [];
      const c = typeKey ? charList.find(ch => ch.type === typeKey) : null;
      if (c) {
        slot.className = `draft-slot filled ${isDone ? 'confirmed' : 'browsing'}`;
        const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
        slot.innerHTML = `<span class="slot-tier">${tier}티어</span>
          <span class="slot-icon">${c.icon}</span>
          <div class="slot-info"><span class="slot-name">${c.name} ${tagHtml}</span>
          <span class="slot-stats">ATK ${c.atk}</span>
          <div>${buildMiniHeaders(c)}</div></div>`;
        if (isDone) slot.innerHTML += '<span class="slot-confirmed-badge">확정</span>';
        slot.style.position = 'relative';
        const pieceLike = charDataToPieceLike(c);
        slot.appendChild(buildPieceTooltip(pieceLike, pIdx === 0 ? 'right' : 'left'));
      } else {
        slot.className = 'draft-slot empty';
        slot.innerHTML = `<span class="slot-tier">${tier}티어</span><span class="slot-empty-text">미선택</span>`;
      }
      slotsEl.appendChild(slot);
    }
  }
}

// ── 관전자: HP 분배 UI ──────────────────────────────────────
function renderSpectatorHp() {
  const hp = S.specHp || {};
  const chars = S.specCharacters || {};
  const container = document.querySelector('.hp-container');
  if (!container) return;

  container.innerHTML = `
    <h2>👁 관전 중 — HP 분배</h2>
    <p class="muted">${S.specP0Name} vs ${S.specP1Name} · 총 10 HP를 3명에게 분배</p>
    <div class="spec-hp-layout">
      <div class="spec-hp-side">
        <h3 style="color:#60a5fa">${S.specP0Name} ${hp.hpDone?.[0] ? '✅ 확정' : '⏳ 분배 중'}</h3>
        <div id="spec-hp-p0" class="spec-hp-pieces"></div>
      </div>
      <div class="spec-hp-side">
        <h3 style="color:#f87171">${S.specP1Name} ${hp.hpDone?.[1] ? '✅ 확정' : '⏳ 분배 중'}</h3>
        <div id="spec-hp-p1" class="spec-hp-pieces"></div>
      </div>
    </div>`;

  for (const [pIdx, key] of [[0, 'p0'], [1, 'p1']]) {
    const el = document.getElementById(`spec-hp-${key}`);
    if (!el) continue;
    const isDone = hp.hpDone?.[pIdx];
    const pieces = hp[key + 'Pieces'] || [];
    const browseHps = hp[key + 'Hps'];
    const draft = hp[key + 'Draft'] || S.specDraft?.[key === 'p0' ? 'p0' : 'p1'];

    // 확정된 경우: 확정 피스 데이터 표시
    if (isDone && pieces.length > 0) {
      for (const pc of pieces) {
        const div = document.createElement('div');
        div.className = 'spec-hp-piece confirmed';
        div.innerHTML = `<span class="p-icon">${pc.icon}</span>
          <strong>${pc.name}</strong> <span class="muted">T${pc.tier}</span>
          <span style="color:var(--success);font-weight:600">HP ${pc.hp}/${pc.maxHp}</span>
          <span class="slot-confirmed-badge">확정</span>`;
        div.style.position = 'relative';
        div.appendChild(buildPieceTooltip(pc, key === 'p0' ? 'right' : 'left'));
        el.appendChild(div);
      }
    }
    // 브라우징 중: 실시간 HP 값 표시
    else if (browseHps && draft) {
      const types = [draft.t1, draft.t2, draft.t3];
      const tierLabels = ['1티어', '2티어', '3티어'];
      const total = browseHps.reduce((a, b) => a + b, 0);
      for (let i = 0; i < types.length; i++) {
        const charData = findCharInData(chars, types[i]);
        if (!charData) continue;
        const div = document.createElement('div');
        div.className = 'spec-hp-piece';
        div.innerHTML = `<span class="p-icon">${charData.icon}</span>
          <strong>${charData.name}</strong> <span class="muted">${tierLabels[i]}</span>
          <span style="color:var(--accent);font-weight:600;font-size:1rem">HP ${browseHps[i]}</span>`;
        div.style.position = 'relative';
        const pieceLike = charDataToPieceLike(charData);
        div.appendChild(buildPieceTooltip(pieceLike, key === 'p0' ? 'right' : 'left'));
        el.appendChild(div);
      }
      const remaining = document.createElement('div');
      remaining.className = 'spec-hp-remaining';
      remaining.innerHTML = `남은 HP: <strong>${10 - total}</strong> / 10`;
      el.appendChild(remaining);
    }
    // 아직 데이터 없음
    else if (draft) {
      const types = [draft.t1, draft.t2, draft.t3];
      for (let i = 0; i < types.length; i++) {
        const charData = findCharInData(chars, types[i]);
        if (!charData) continue;
        const div = document.createElement('div');
        div.className = 'spec-hp-piece';
        div.innerHTML = `<span class="p-icon">${charData.icon}</span>
          <strong>${charData.name}</strong> <span class="muted">HP ?</span>`;
        el.appendChild(div);
      }
    } else {
      el.innerHTML = '<p class="muted">대기 중...</p>';
    }
  }
}

function findCharInData(chars, type) {
  if (!type) return null;
  for (const tier of [1, 2, 3]) {
    const list = chars[tier];
    if (!list) continue;
    const found = list.find(c => c.type === type);
    if (found) return found;
  }
  return null;
}

// ── 관전자: 공개 페이즈 UI ──────────────────────────────────
function renderSpectatorReveal() {
  const rev = S.specReveal || {};
  const myNameEl = document.getElementById('reveal-my-name');
  const oppNameEl = document.getElementById('reveal-opp-name');
  const myPcsEl = document.getElementById('reveal-my-pieces');
  const oppPcsEl = document.getElementById('reveal-opp-pieces');
  const btn = document.getElementById('btn-reveal-confirm');
  if (myNameEl) myNameEl.textContent = rev.p0Name || S.specP0Name;
  if (oppNameEl) oppNameEl.textContent = rev.p1Name || S.specP1Name;
  if (btn) btn.style.display = 'none'; // 관전자는 버튼 숨기기

  // 플레이어와 동일한 카드 UI + 툴팁 사용
  for (const [el, pieces, side] of [[myPcsEl, rev.p0Pieces || [], 'left'], [oppPcsEl, rev.p1Pieces || [], 'right']]) {
    if (!el) continue;
    el.innerHTML = '';
    for (const pc of pieces) {
      el.appendChild(createRevealCard(pc, side));
    }
  }
}

// ── 관전자: 배치 페이즈 UI (색상별 공격범위) ─────────────────
function getAttackCellsWithBounds(type, col, row, bounds, extra) {
  extra = extra || {};
  const cells = [];
  const bMin = bounds.min, bMax = bounds.max;
  const push = (c, r) => { if (c >= bMin && c <= bMax && r >= bMin && r <= bMax) cells.push({ col: c, row: r }); };
  switch (type) {
    case 'archer': {
      if (extra.toggleState === 'right') { const d = col - row; for (let c = bMin; c <= bMax; c++) { const r = c - d; if (r >= bMin && r <= bMax) push(c, r); } }
      else { const d = col + row; for (let c = bMin; c <= bMax; c++) { const r = d - c; if (r >= bMin && r <= bMax) push(c, r); } } break; }
    case 'spearman': for (let r = bMin; r <= bMax; r++) push(col, r); break;
    case 'cavalry': for (let c = bMin; c <= bMax; c++) push(c, row); break;
    case 'watchman': for (let dc=-1;dc<=1;dc++) for(let dr=-1;dr<=1;dr++) if(dc||dr) push(col+dc,row+dr); break;
    case 'twins_elder': push(col,row);push(col-1,row);push(col+1,row); break;
    case 'twins_younger': push(col,row);push(col,row-1);push(col,row+1); break;
    case 'scout': push(col,row);push(col-1,row);push(col+1,row); break;
    case 'manhunter': push(col,row);push(col,row-1);push(col,row+1); break;
    case 'messenger': push(col,row); for(const[dc,dr]of[[-1,-1],[1,-1],[-1,1],[1,1]])push(col+dc,row+dr); break;
    case 'gunpowder': push(col,row-1);push(col,row-2);push(col,row+1);push(col,row+2); break;
    case 'herbalist': push(col-1,row);push(col-2,row);push(col+1,row);push(col+2,row); break;
    case 'general': push(col,row); for(const[dc,dr]of[[0,-1],[0,1],[-1,0],[1,0]])push(col+dc,row+dr); break;
    case 'knight': push(col,row); for(const[dc,dr]of[[-1,-1],[1,-1],[-1,1],[1,1]])push(col+dc,row+dr); break;
    case 'shadowAssassin': push(col,row); for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++)if(dc||dr)push(col+dc,row+dr); break;
    case 'wizard': push(col,row-2);push(col,row+2);push(col-2,row);push(col+2,row); break;
    case 'armoredWarrior': push(col,row);push(col-1,row+1);push(col,row+1);push(col+1,row+1); break;
    case 'witch': push(col,row); break;
    case 'dualBlade': for(const[dc,dr]of[[-1,-1],[1,-1],[-1,1],[1,1]])push(col+dc,row+dr); break;
    case 'ratMerchant': push(col,row); break;
    case 'weaponSmith':
      if(extra.toggleState==='vertical'){push(col,row);push(col,row-1);push(col,row+1);}
      else{push(col,row);push(col-1,row);push(col+1,row);} break;
    case 'bodyguard': for(const[dc,dr]of[[0,-1],[0,1],[-1,0],[1,0]])push(col+dc,row+dr); break;
    case 'prince': push(col,row);push(col-1,row);push(col+1,row); break;
    case 'princess': push(col,row);push(col,row-1);push(col,row+1); break;
    case 'king': push(col,row); break;
    case 'dragonTamer': for(const[dc,dr]of[[-1,-1],[1,-1],[-1,1],[1,1]])push(col+dc,row+dr); break;
    case 'monk': push(col,row-1);push(col,row+1); break;
    case 'slaughterHero': for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++)push(col+dc,row+dr); break;
    case 'commander': push(col-1,row);push(col+1,row); break;
    case 'sulfurCauldron': for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++)if(dc||dr)push(col+dc,row+dr); break;
    case 'torturer': push(col,row);push(col,row+1); break;
    case 'count': push(col,row); for(const[dc,dr]of[[-1,-1],[1,-1],[-1,1],[1,1]])push(col+dc,row+dr); break;
  }
  return cells;
}

function renderSpectatorPlacement() {
  const pl = S.specPlacement;
  if (!pl) return;
  const bounds = pl.boardBounds;
  const container = document.querySelector('.placement-container');
  if (!container) return;

  container.innerHTML = `
    <h2>👁 관전 중 — 말 배치</h2>
    <p class="muted">${S.specP0Name} vs ${S.specP1Name} · 실시간 배치 현황</p>
    <div class="placement-layout" style="justify-content:center">
      <div class="spec-placement-side" id="spec-pl-left">
        <h4 style="color:#60a5fa">${S.specP0Name}</h4>
        <div id="spec-pl-p0-list"></div>
      </div>
      <div id="spec-placement-board" class="board"></div>
      <div class="spec-placement-side" id="spec-pl-right">
        <h4 style="color:#f87171">${S.specP1Name}</h4>
        <div id="spec-pl-p1-list"></div>
      </div>
    </div>`;

  // 보드 빌드
  const board = document.getElementById('spec-placement-board');
  board.innerHTML = '';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.col = c;
      cell.dataset.row = r;
      cell.innerHTML = `<span class="coord-label">${coord(c, r)}</span>`;
      if (c < bounds.min || c > bounds.max || r < bounds.min || r > bounds.max) {
        cell.classList.add('destroyed');
      }
      board.appendChild(cell);
    }
  }

  // 공격 범위 계산
  const p0Range = new Set();
  const p1Range = new Set();
  for (const pc of (pl.p0Pieces || [])) {
    if (pc.col >= 0 && pc.row >= 0 && pc.alive) {
      const cells = getAttackCellsWithBounds(pc.type, pc.col, pc.row, bounds, { toggleState: pc.toggleState });
      cells.forEach(c => p0Range.add(`${c.col},${c.row}`));
    }
  }
  for (const pc of (pl.p1Pieces || [])) {
    if (pc.col >= 0 && pc.row >= 0 && pc.alive) {
      const cells = getAttackCellsWithBounds(pc.type, pc.col, pc.row, bounds, { toggleState: pc.toggleState });
      cells.forEach(c => p1Range.add(`${c.col},${c.row}`));
    }
  }

  // 범위 색칠 + 말 배치
  document.querySelectorAll('#spec-placement-board .cell').forEach(cell => {
    const c = parseInt(cell.dataset.col), r = parseInt(cell.dataset.row);
    if (cell.classList.contains('destroyed')) return;
    const key = `${c},${r}`;
    const inP0 = p0Range.has(key);
    const inP1 = p1Range.has(key);
    if (inP0 && inP1) cell.classList.add('range-both');
    else if (inP0) cell.classList.add('range-p0');
    else if (inP1) cell.classList.add('range-p1');

    // 말 표시
    const p0pc = (pl.p0Pieces || []).find(p => p.col === c && p.row === r && p.alive);
    if (p0pc) cell.innerHTML += `<div class="spec-piece p0"><span class="p-icon">${p0pc.icon}</span></div>`;
    const p1pc = (pl.p1Pieces || []).find(p => p.col === c && p.row === r && p.alive);
    if (p1pc) cell.innerHTML += `<div class="spec-piece p1"><span class="p-icon">${p1pc.icon}</span></div>`;
  });

  // 양쪽 말 목록
  for (const [key, pieces] of [['p0', pl.p0Pieces || []], ['p1', pl.p1Pieces || []]]) {
    const list = document.getElementById(`spec-pl-${key}-list`);
    if (!list) continue;
    list.innerHTML = '';
    for (const pc of pieces) {
      const placed = pc.col >= 0 && pc.row >= 0;
      const div = document.createElement('div');
      div.className = `my-piece-card ${placed ? '' : 'unplaced'}`;
      div.style.position = 'relative';
      div.innerHTML = `<span class="p-icon">${pc.icon}</span>
        <div><strong>${pc.name}</strong> <span class="muted">T${pc.tier}</span>
        <br><span style="font-size:0.72rem">${placed ? coord(pc.col, pc.row) : '미배치'}</span></div>`;
      div.appendChild(buildPieceTooltip(pc, key === 'p0' ? 'right' : 'left'));
      list.appendChild(div);
    }
  }
}

// ── 관전자 렌더링 ─────────────────────────────────────────
function renderSpectatorGame(gs) {
  // ★ 턴 변경 감지 — 1v1 관전자도 매 턴 데미지 도장/HP 바 오버레이 초기화 + turn-bright 일괄 해제.
  //   snapshotTurnStartHps 가 S.bodyDamageThisTurn 등을 매 턴 비움.
  const _prevTurn = S._specPrevTurn;
  const turnChanged = (_prevTurn != null && _prevTurn !== gs.turnNumber);
  if (turnChanged) {
    if (typeof clearAllTurnBright === 'function') clearAllTurnBright();
    // 1v1 관전자 HP 스냅샷 — gs.p0Pieces / p1Pieces 로 자체 스냅 (snapshotTurnStartHps 는 S.myPieces 의존이라 직접 구성).
    const snap = {};
    for (let i = 0; i < (gs.p0Pieces || []).length; i++) {
      const pc = gs.p0Pieces[i];
      snap[`my:${i}`] = (pc.alive === false ? 0 : (pc.hp ?? 0));
    }
    for (let i = 0; i < (gs.p1Pieces || []).length; i++) {
      const pc = gs.p1Pieces[i];
      snap[`opp:${i}`] = (pc.alive === false ? 0 : (pc.hp ?? 0));
    }
    S.turnStartHps = snap;
    S.bodyDamageThisTurn = {};
    S.loyaltyDamageThisTurn = {};
    S.curseDamageThisTurn = {};
    S.healThisTurn = {};
  }
  S._specPrevTurn = gs.turnNumber;
  S.turnNumber = gs.turnNumber;
  S.sp = gs.sp;
  S.instantSp = gs.instantSp;
  S.boardBounds = gs.boardBounds;

  // SP 바 업데이트 (플레이어와 동일 방식)
  const mySP = gs.sp[0] || 0, oppSP = gs.sp[1] || 0;
  const myInstant = (gs.instantSp && gs.instantSp[0]) || 0;
  const oppInstant = (gs.instantSp && gs.instantSp[1]) || 0;
  const total = mySP + oppSP || 1;
  const p0InstantStr = myInstant > 0 ? ` (+${myInstant})` : '';
  const p1InstantStr = oppInstant > 0 ? ` (+${oppInstant})` : '';
  document.getElementById('sp-my-label').textContent = `${gs.p0Name}: ${mySP}${p0InstantStr} SP`;
  document.getElementById('sp-opp-label').textContent = `${gs.p1Name}: ${oppSP}${p1InstantStr} SP`;
  document.getElementById('sp-my-fill').style.width = `${(mySP / total) * 100}%`;
  document.getElementById('sp-opp-fill').style.width = `${(oppSP / total) * 100}%`;
  const spCountdown = document.getElementById('sp-countdown');
  if (spCountdown && gs.turnNumber) {
    if (gs.turnNumber >= 40) {
      spCountdown.textContent = 'SP 지급 종료 · 40턴 이후';
      spCountdown.style.color = 'var(--danger)';
    } else {
      const turnsUntilSP = 10 - (gs.turnNumber % 10);
      const displayTurns = turnsUntilSP === 10 ? 10 : turnsUntilSP;
      if (mySP >= 10 && oppSP >= 10) {
        spCountdown.textContent = 'SP 최대';
        spCountdown.style.color = 'var(--accent)';
      } else {
        spCountdown.textContent = `다음 SP 지급까지 ${displayTurns}턴`;
        spCountdown.style.color = 'var(--text-dim)';
      }
    }
  }

  // 턴 배너
  const banner = document.getElementById('turn-banner');
  const curName = gs.currentPlayerIdx === 0 ? gs.p0Name : gs.p1Name;
  banner.innerHTML = `👁 관전 중 — 턴 ${gs.turnNumber} · <strong>${curName}</strong>의 차례`;

  // 액션바 숨기기
  const bar = document.getElementById('action-bar');
  if (bar) bar.classList.add('hidden');
  const hint = document.getElementById('action-hint');
  if (hint) hint.textContent = '';

  // 보드 렌더링 — 양쪽 모두 표시
  const board = document.getElementById('game-board');
  if (!board) return;
  // 셀이 없으면 보드 빌드
  if (!board.querySelector('.cell')) {
    buildBoard('game-board', () => {});
  }

  // 관전자 게임 상태 저장 (클릭용)
  S.specGameState = gs;
  S.specSelectedPiece = S.specSelectedPiece || null;

  // 선택된 말의 공격범위 계산
  let specRange = null;
  let specRangeOwner = null;
  if (S.specSelectedPiece) {
    const sp = S.specSelectedPiece;
    const allPieces = [...(gs.p0Pieces || []), ...(gs.p1Pieces || [])];
    const found = allPieces.find(p => p.type === sp.type && p.col === sp.col && p.row === sp.row && p.alive);
    if (found) {
      specRange = new Set();
      const cells = getAttackCellsWithBounds(found.type, found.col, found.row, gs.boardBounds, { toggleState: found.toggleState });
      cells.forEach(c => specRange.add(`${c.col},${c.row}`));
      specRangeOwner = sp.owner; // 'p0' or 'p1'
    } else {
      S.specSelectedPiece = null;
    }
  }

  document.querySelectorAll('#game-board .cell').forEach(cell => {
    const col = parseInt(cell.dataset.col), row = parseInt(cell.dataset.row);
    cell.className = 'cell';
    cell.innerHTML = `<span class="coord-label">${coord(col,row)}</span>`;
    const bounds = gs.boardBounds;
    if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) {
      cell.classList.add('destroyed'); return;
    }

    // 관전자 선택 공격범위 표시
    if (specRange && specRange.has(`${col},${row}`)) {
      cell.classList.add(specRangeOwner === 'p0' ? 'range-p0' : 'range-p1');
    }

    // P0 말 (파란색)
    const p0 = (gs.p0Pieces || []).find(p => p.col === col && p.row === row && p.alive);
    if (p0) {
      const hpPct0 = Math.round((p0.hp / p0.maxHp) * 100);
      const isSelected = S.specSelectedPiece && S.specSelectedPiece.type === p0.type && S.specSelectedPiece.col === col && S.specSelectedPiece.row === row;
      cell.innerHTML += `<div class="spec-piece p0 ${isSelected ? 'spec-selected' : ''}" data-spec-click="p0" data-type="${p0.type}" data-col="${col}" data-row="${row}">
        <span class="p-icon">${p0.icon}</span>
        <div class="spec-hp-bar"><div class="spec-hp-fill p0-fill" style="width:${hpPct0}%"></div></div>
      </div>`;
      cell.classList.add('has-piece');
    }
    // P1 말 (빨간색)
    const p1 = (gs.p1Pieces || []).find(p => p.col === col && p.row === row && p.alive);
    if (p1) {
      const hpPct1 = Math.round((p1.hp / p1.maxHp) * 100);
      const isSelected = S.specSelectedPiece && S.specSelectedPiece.type === p1.type && S.specSelectedPiece.col === col && S.specSelectedPiece.row === row;
      cell.innerHTML += `<div class="spec-piece p1 ${isSelected ? 'spec-selected' : ''}" data-spec-click="p1" data-type="${p1.type}" data-col="${col}" data-row="${row}">
        <span class="p-icon">${p1.icon}</span>
        <div class="spec-hp-bar"><div class="spec-hp-fill p1-fill" style="width:${hpPct1}%"></div></div>
      </div>`;
      cell.classList.add('has-piece');
    }
    // 보드 오브젝트
    if (gs.boardObjects) {
      for (const obj of gs.boardObjects) {
        if (obj.col === col && obj.row === row) {
          if (obj.type === 'trap') cell.innerHTML += '<span style="position:absolute;bottom:1px;right:2px;font-size:0.5rem">🪤</span>';
          if (obj.type === 'bomb') cell.innerHTML += '<span style="position:absolute;top:1px;right:2px;font-size:0.5rem">💣</span>';
          if (obj.type === 'rat') cell.innerHTML += '<span style="position:absolute;top:1px;right:2px;font-size:0.5rem;color:#52b788">🐀</span>';
        }
      }
    }
  });

  // 관전자 말 클릭 이벤트
  document.querySelectorAll('#game-board [data-spec-click]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const owner = el.dataset.specClick;
      const type = el.dataset.type;
      const col = parseInt(el.dataset.col);
      const row = parseInt(el.dataset.row);
      // 토글: 같은 말 재클릭 시 해제
      if (S.specSelectedPiece && S.specSelectedPiece.type === type && S.specSelectedPiece.col === col && S.specSelectedPiece.row === row) {
        S.specSelectedPiece = null;
      } else {
        S.specSelectedPiece = { type, col, row, owner };
      }
      renderSpectatorGame(S.specGameState);
    });
  });

  // 빈 셀 클릭 시 선택 해제
  document.querySelectorAll('#game-board .cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (S.specSelectedPiece) {
        S.specSelectedPiece = null;
        renderSpectatorGame(S.specGameState);
      }
    });
  });

  // 좌측: P0 말 정보
  // ★ 관전자 패널에도 데미지 도장 + HP 바 빨간 오버레이 적용 (1v1 spec 기준 my:idx / opp:idx 키).
  const leftPanel = document.getElementById('my-pieces-info');
  if (leftPanel) {
    document.querySelector('.left-panel h3').textContent = gs.p0Name;
    leftPanel.innerHTML = '';
    for (let i = 0; i < (gs.p0Pieces || []).length; i++) {
      const pc = gs.p0Pieces[i];
      const overlay = buildDamageOverlay(`my:${i}`, pc.alive ? pc.hp : 0, pc.maxHp);
      const div = document.createElement('div');
      div.className = `my-piece-card ${pc.alive ? '' : 'dead'}`;
      div.style.position = 'relative';
      div.dataset.pieceIdx = i;
      const hpPct = overlay.displayHpPct;
      div.innerHTML = `<span class="p-icon">${pc.alive ? pc.icon : '💀'}</span>
        <div><strong>${pc.name} <span style="font-size:0.65rem;color:var(--muted)">T${pc.tier}</span></strong>
        <div class="hp-bar-bg"><div class="hp-bar ${hpPct <= 25 ? 'low' : ''}" style="width:${hpPct}%"></div>${overlay.barOverlay}</div>
        <span style="font-size:0.72rem">HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${pc.atk}</span></div>${overlay.stamp}`;
      if (pc.alive) div.appendChild(buildPieceTooltip(pc, 'left'));
      leftPanel.appendChild(div);
    }
  }

  // 우측: P1 말 정보
  const rightPanel = document.getElementById('opp-pieces-info');
  if (rightPanel) {
    document.querySelector('.right-panel h3').textContent = gs.p1Name;
    const sub = document.querySelector('.right-panel p');
    if (sub) sub.textContent = '';
    rightPanel.innerHTML = '';
    for (let i = 0; i < (gs.p1Pieces || []).length; i++) {
      const pc = gs.p1Pieces[i];
      const overlay = buildDamageOverlay(`opp:${i}`, pc.alive ? pc.hp : 0, pc.maxHp);
      const div = document.createElement('div');
      div.className = `opp-piece-card ${pc.alive ? '' : 'dead'}`;
      div.style.position = 'relative';
      div.dataset.pieceIdx = i;
      const hpPct = overlay.displayHpPct;
      div.innerHTML = `<span class="p-icon">${pc.alive ? pc.icon : '💀'}</span>
        <div class="opp-info"><strong>${pc.name} <span style="font-size:0.65rem;color:var(--muted)">T${pc.tier}</span></strong>
        <div class="hp-bar-bg"><div class="hp-bar ${hpPct <= 25 ? 'low' : ''}" style="width:${hpPct}%"></div>${overlay.barOverlay}</div>
        <span style="font-size:0.72rem">HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${pc.atk}</span></div>${overlay.stamp}`;
      if (pc.alive) div.appendChild(buildPieceTooltip(pc, 'right'));
      rightPanel.appendChild(div);
    }
  }
}

// ── 스킬 사용 토스트 알림 (큐 기반 순차 등장) ──────────────
const _toastQueue = [];
let _toastProcessing = false;
const TOAST_INTERVAL = 1000; // 순차 등장 간격 (ms) — 한 개씩 1초 텀
const TOAST_DURATION = 4000; // 체류 시간
const TOAST_MAX_VISIBLE = 4;  // 화면에 동시 표시 최대 수
const _toastVisible = [];     // 현재 화면에 보이는 토스트 목록

function _getToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    // ★ z-index: 9700 — skill-cast-dim(8500) / caster-spotlight(9000) 보다 위 + twin-join-flyer(9500) 보다도 위.
    container.style.cssText = `
      position:fixed; top:60px; left:50%; transform:translateX(-50%);
      z-index:9700; pointer-events:none; display:flex; flex-direction:column;
      align-items:center; gap:6px; width:max-content; max-width:90vw;
    `;
    document.body.appendChild(container);
  }
  return container;
}

function _showToastNow(msg, isEnemy, specPlayerIdx, toastType) {
  const container = _getToastContainer();
  const toast = document.createElement('div');
  toast.style.cssText = `
    color:#fff; padding:10px 24px;
    border-radius:8px; font-size:0.9rem; font-weight:600;
    pointer-events:none; opacity:0;
    transition:opacity 0.35s ease, transform 0.35s ease;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);
    transform:translateY(-20px);
    white-space:nowrap;
  `;

  if (toastType === 'curse') {
    // 저주 관련 토스트는 보라색 — 아군/적군/관전자 구분 없이 통일
    toast.style.background = 'rgba(139, 92, 246, 0.92)';   // violet-500
    toast.style.border = '1px solid #c4b5fd';              // violet-300
  } else if (S.isSpectator && specPlayerIdx !== undefined) {
    const isP1 = specPlayerIdx === 1;
    toast.style.background = isP1 ? 'rgba(220,50,50,0.92)' : 'rgba(96,165,250,0.92)';
    toast.style.border = isP1 ? '1px solid #ff6b6b' : '1px solid #93c5fd';
  } else if (toastType === 'event') {
    toast.style.background = 'rgba(30,30,30,0.92)';
    toast.style.border = '1px solid #555';
  } else {
    toast.style.background = isEnemy ? 'rgba(220,50,50,0.92)' : 'rgba(59,130,246,0.92)';
    toast.style.border = isEnemy ? '1px solid #ff6b6b' : '1px solid #93c5fd';
  }
  // 미니 헤더 스타일 적용 — 스킬/패시브 메시지의 "{icon} {name}:" 부분 강조 + 콜론 시각적 제거
  const formatted = (typeof formatMsgMiniHeader === 'function') ? formatMsgMiniHeader(msg) : null;
  if (formatted && formatted !== msg) {
    toast.innerHTML = formatted;
  } else {
    toast.textContent = msg;
  }

  // 최신 토스트를 맨 위(컨테이너 첫 자식)에 삽입
  if (container.firstChild) {
    container.insertBefore(toast, container.firstChild);
  } else {
    container.appendChild(toast);
  }
  _toastVisible.unshift(toast);

  // 최대 표시 수 초과 시 오래된 것 즉시 제거
  while (_toastVisible.length > TOAST_MAX_VISIBLE) {
    const old = _toastVisible.pop();
    if (old.parentNode) {
      old.style.opacity = '0';
      old.style.transform = 'translateY(10px)';
      setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 300);
    }
  }

  // 위에서 아래로 슬라이드 인
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // 체류 후 페이드아웃
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      const idx = _toastVisible.indexOf(toast);
      if (idx >= 0) _toastVisible.splice(idx, 1);
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 350);
  }, TOAST_DURATION);
}

function _processToastQueue() {
  if (_toastQueue.length === 0) { _toastProcessing = false; return; }
  _toastProcessing = true;
  const { msg, isEnemy, specPlayerIdx, toastType } = _toastQueue.shift();
  _showToastNow(msg, isEnemy, specPlayerIdx, toastType);
  // 다음 토스트는 반드시 TOAST_INTERVAL 후에 (큐에 남아있든 없든)
  setTimeout(() => {
    if (_toastQueue.length > 0) {
      _processToastQueue();
    } else {
      _toastProcessing = false;
    }
  }, TOAST_INTERVAL);
}

function showSkillToast(msg, isEnemy = false, specPlayerIdx = undefined, toastType = undefined) {
  // 풀스크린 오버레이 재생 중에는 토스트도 보류 → 종료 후 출력
  if (S._fullscreenBusy) {
    if (!S._eventDuringFullscreen) S._eventDuringFullscreen = [];
    S._eventDuringFullscreen.push(() => showSkillToast(msg, isEnemy, specPlayerIdx, toastType));
    return;
  }
  _toastQueue.push({ msg, isEnemy, specPlayerIdx, toastType });
  if (!_toastProcessing) _processToastQueue();
}

// ── 턴 보드 테두리 전환 ──
function setTurnBackground(isMyTurn) {
  const board = document.getElementById('game-board');
  if (!board) return;
  board.style.transition = 'border-color 0.5s, box-shadow 0.5s';
  // 팀모드: 현재 차례 플레이어의 팀 컬러로 — 1v1과 동등한 보드 외곽 강조
  if (S.isTeamMode) {
    const cur = (S.teamGamePlayers || []).find(p => p.idx === S.currentPlayerIdx);
    const isBlueTurn = cur ? cur.teamId === 0 : false;
    board.style.borderColor = isBlueTurn ? '#60a5fa' : '#ef4444';
    board.style.borderWidth = '3px';
    board.style.boxShadow = isBlueTurn
      ? '0 0 15px rgba(96,165,250,0.4), inset 0 0 10px rgba(96,165,250,0.07)'
      : '0 0 15px rgba(239,68,68,0.4), inset 0 0 10px rgba(239,68,68,0.07)';
    return;
  }
  board.style.borderColor = isMyTurn ? '#3b82f6' : '#ef4444';
  board.style.borderWidth = '3px';
  board.style.boxShadow = isMyTurn
    ? '0 0 15px rgba(59,130,246,0.3), inset 0 0 10px rgba(59,130,246,0.05)'
    : '0 0 15px rgba(239,68,68,0.3), inset 0 0 10px rgba(239,68,68,0.05)';
}

// ── 나의 턴 팝업: 더 이상 토스트 표시하지 않음 (턴 배너로 대체) ──
function showTurnPopup(isMyTurn) {
  updateTurnBanner();
}

// ── 이동 모션 애니메이션 ──
function animateMove(icon, fromCol, fromRow, toCol, toRow) {
  const board = document.getElementById('game-board');
  if (!board) return;
  const cells = board.querySelectorAll('.cell');
  const fromCell = [...cells].find(c => parseInt(c.dataset.col) === fromCol && parseInt(c.dataset.row) === fromRow);
  const toCell = [...cells].find(c => parseInt(c.dataset.col) === toCol && parseInt(c.dataset.row) === toRow);
  if (!fromCell || !toCell) return;

  const boardRect = board.getBoundingClientRect();
  const fromRect = fromCell.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();

  const el = document.createElement('div');
  el.textContent = icon;
  el.style.cssText = `
    position:fixed; z-index:2500; font-size:1.6rem; pointer-events:none;
    left:${fromRect.left + fromRect.width/2}px; top:${fromRect.top + fromRect.height/2}px;
    transform:translate(-50%,-50%); transition: left 0.35s ease, top 0.35s ease;
    filter: drop-shadow(0 0 8px rgba(82,183,136,0.8));
  `;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.left = `${toRect.left + toRect.width/2}px`;
    el.style.top = `${toRect.top + toRect.height/2}px`;
  });
  setTimeout(() => el.remove(), 400);
}

// ── 공격 모션 애니메이션 ──
// ── 피격 프로필 애니메이션 헬퍼 ──
function applyProfileHitAnim(selector, indices) {
  if (!indices || indices.length === 0) return;
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll(selector);
    for (const idx of indices) {
      // 팀모드에서도 호출될 수 있으니 helper 사용 — 부모 블록까지 밝아짐
      if (cards[idx]) applyHitFlashWithBrighten(cards[idx]);
    }
  });
}

// ── 보호됨 애니메이션 — 유리 표면 사선 빛 sheen sweep ──
// 공격 받았으나 0 피해 (호위무사 가로채기·아이언스킨·폭정 등)
// 현재 default = v3 (1회 sweep + 둔둔 펄스, 1s). animation-test.html 에서 v1~v4 비교 가능.
const PROTECTED_VARIANT = 'v3';
const PROTECTED_DURATIONS = { v1: 1050, v2: 1550, v3: 1050, v4: 1550 };
function applyProtectedAnim(card) {
  if (!card) return;
  card.classList.remove('profile-protected', 'v1', 'v2', 'v3', 'v4');
  void card.offsetWidth;
  card.classList.add('profile-protected', PROTECTED_VARIANT);
  setTimeout(() => card.classList.remove('profile-protected', PROTECTED_VARIANT), PROTECTED_DURATIONS[PROTECTED_VARIANT] || 1100);
  // SFX (PROTECTED_SFX 상수로 변종 선택)
  try {
    const sfxFn = (typeof PROTECTED_SFX_FUNCS !== 'undefined') && PROTECTED_SFX_FUNCS[PROTECTED_SFX];
    if (sfxFn) sfxFn();
  } catch (e) {}
}
// 1v1 — querySelectorAll + 인덱스
function applyProtectedAnimByIndex(selector, indices) {
  if (!indices || indices.length === 0) return;
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll(selector);
    for (const idx of indices) {
      if (cards[idx]) applyProtectedAnim(cards[idx]);
    }
  });
}
// 팀모드 — data-player-idx + data-piece-idx 셀렉터
function applyProtectedAnimTeam(playerIdx, pieceIdx) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`.team-profile-block[data-player-idx="${playerIdx}"] [data-piece-idx="${pieceIdx}"]`);
    if (card) applyProtectedAnim(card);
  });
}

// 좌표/이름으로 피스 배열에서 인덱스 찾기 (살아있는 유닛만)
function findPieceIndices(pieces, hitList, matchByCoord = true) {
  const indices = [];
  for (const h of hitList) {
    let idx = -1;
    // ★ 서버가 defPieceIdx 를 직접 보내면 그것을 1순위로 사용 (사망한 piece 도 정확히 매칭).
    if (typeof h.defPieceIdx === 'number' && pieces[h.defPieceIdx]) {
      idx = h.defPieceIdx;
    }
    // p.alive 검사 제거 — 이번 턴에 죽은 piece 도 carrd 애니메이션 (turn-bright) 받아야 함.
    if (idx < 0 && matchByCoord && h.col !== undefined && h.row !== undefined) {
      idx = pieces.findIndex(p => p.col === h.col && p.row === h.row);
    }
    if (idx < 0 && h.name) {
      idx = pieces.findIndex(p => p.name === h.name);
    }
    if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
  }
  return indices;
}

function animateAttack(atkCells, hitCells) {
  const board = document.getElementById('game-board');
  if (!board) return;
  const cells = board.querySelectorAll('.cell');

  // 공격 범위 번쩍임
  for (const ac of atkCells) {
    const cell = [...cells].find(c => parseInt(c.dataset.col) === ac.col && parseInt(c.dataset.row) === ac.row);
    if (cell) {
      cell.style.transition = 'background 0.1s';
      cell.style.background = 'rgba(226,168,75,0.4)';
      setTimeout(() => { cell.style.background = ''; }, 300);
    }
  }

  // 피격 셀 빨간 플래시 + 흔들림
  for (const hc of hitCells) {
    const cell = [...cells].find(c => parseInt(c.dataset.col) === hc.col && parseInt(c.dataset.row) === hc.row);
    if (cell) {
      cell.style.transition = 'background 0.1s';
      cell.style.background = 'rgba(239,68,68,0.5)';
      cell.style.animation = 'shake 0.3s ease';
      setTimeout(() => { cell.style.background = ''; cell.style.animation = ''; }, 400);
    }
  }
  // 보드 위 아이콘 피격 애니메이션 — 셀 안의 piece-marker .p-icon 흔들림+빨간 글로우
  animateBoardIconHit(hitCells);
}

// 보드 위 말 아이콘 피격 모션 — 쥐와 동일한 톤의 애니메이션
function animateBoardIconHit(cells) {
  const board = document.getElementById('game-board');
  if (!board) return;
  for (const c of cells) {
    const cell = board.querySelector(`.cell[data-col="${c.col}"][data-row="${c.row}"]`);
    if (!cell) continue;
    const icon = cell.querySelector('.piece-marker .p-icon');
    if (icon) {
      icon.classList.remove('p-icon-hit');
      // 강제 리플로우 — 같은 셀 연속 피격에서도 애니메이션 재생
      void icon.offsetWidth;
      icon.classList.add('p-icon-hit');
      setTimeout(() => icon.classList.remove('p-icon-hit'), 720);
    }
  }
}

// ── 팀모드: 팀원이 피격됨 ──
socket.on('team_ally_hit', ({ atkCells, victimIdx, victimName, hitPieces }) => {
  // 적 공격 휘두름 SFX — 팀원이 공격 받을 때 관전 시점에서도 들림
  try { playSfx('attack'); } catch (e) {}
  // 본체 직접 피해 / 충성 가로채기 — 데이터 종류별로 명시적 분류
  for (const h of (hitPieces || [])) {
    const dmg = (typeof h.damage === 'number') ? h.damage : 0;
    if (dmg <= 0 || h.defPieceIdx == null) continue;
    if (h.bodyguardRedirect) {
      addLoyaltyDamage(`${victimIdx}:${h.defPieceIdx}`, dmg);
    } else if (!h.redirectedToBodyguard) {
      addBodyDamage(`${victimIdx}:${h.defPieceIdx}`, dmg);
    }
  }
  // 호위무사 가로채기·0데미지 비격파는 본체 흔들림 제외 (1v1 being_attacked와 동일)
  const meaningful = (hitPieces || []).filter(h => !h.redirectedToBodyguard && !(h.damage === 0 && !h.destroyed));
  const hitCells = meaningful.map(h => ({ col: h.col, row: h.row }));
  animateAttack([], hitCells);
  // ★ directHits = 본체로 직접 피해 받은 hit (호위무사 가로채기 제외) — "공격받았습니다!" 트리거 기준
  const directHits = meaningful.filter(h => !h.bodyguardRedirect);
  const killedAlly = directHits.filter(h => h.destroyed);
  const hitAlly = directHits.filter(h => !h.destroyed);
  if (killedAlly.length > 0) playSfx('kill');
  else if (hitAlly.length > 0) playSfx('hit');
  // ① 공격받았습니다 — 본체 직접 피격이 있을 때만 (BG-only intercept 는 passive_alert 가 처리)
  if (directHits.length > 0) {
    showSkillToast(`공격받았습니다!`, true);
    if (hitAlly.length > 0) {
      const hitLabels = hitAlly.map(h => h.icon && h.name ? `${h.icon}${h.name}` : '유닛').join(', ');
      addLog(`${hitLabels} 피격`, 'hit');
    }
  }
  // ② 사망 — 우리 편(팀원) 유닛 사망은 카드에서 보이므로 토스트 생략, 로그만
  if (killedAlly.length > 0) {
    const labels = killedAlly.map(h => h.icon && h.name ? `${h.icon}${h.name}` : '유닛').join(', ');
    setTimeout(() => {
      addLog(`${labels} 사망`, 'hit');
    }, 800);
  }
  // 호위무사 가로채기 — passive_alert가 메시지 담당 (중복 토스트 제거)
  // 팀원 프로필 카드에 hit 애니메이션 — 호위무사 가로채기 시 본체 카드는 제외
  if (typeof applyProfileHitAnim === 'function' && victimIdx != null) {
    const tmPlayer = (S.teamGamePlayers || []).find(p => p.idx === victimIdx);
    if (tmPlayer && tmPlayer.pieces) {
      const hitIdxs = [];
      const protectedIdxs = [];
      // 보호됨: 0 피해 + !destroyed. 그림자 상태는 피격 정보 숨김이므로 제외
      const protectedHits = (hitPieces || []).filter(h => {
        if (!(h.damage === 0 && !h.destroyed)) return false;
        const p = tmPlayer.pieces.find(pc => pc.alive && pc.col === h.col && pc.row === h.row);
        const isShadow = p && (p.statusEffects || []).some(e => e.type === 'shadow');
        return !isShadow;
      });
      for (let i = 0; i < tmPlayer.pieces.length; i++) {
        const pc = tmPlayer.pieces[i];
        if (meaningful.some(h => h.col === pc.col && h.row === pc.row)) hitIdxs.push(i);
        if (protectedHits.some(h => h.col === pc.col && h.row === pc.row)) protectedIdxs.push(i);
      }
      if (hitIdxs.length > 0) {
        requestAnimationFrame(() => {
          for (const i of hitIdxs) {
            const card = document.querySelector(`#my-pieces-info .team-profile-block[data-player-idx="${victimIdx}"] [data-piece-idx="${i}"]`);
            applyHitFlashWithBrighten(card);
          }
        });
      }
      // 보호됨 애니메이션 — 좌·우 컨테이너 모두 적용 (팀원이 어느 쪽이든)
      for (const i of protectedIdxs) {
        applyProtectedAnimTeam(victimIdx, i);
      }
    }
  }
});

// ── 캐릭터 등장 사운드 (둥-) ──
// ── 쥐 격파 사운드 (꽥!) ──
// ── 보호됨 SFX 5종 ──
// 사용자가 미리 듣고 고를 수 있도록 5개 변종 제공.
// 게임 실제 발화 시점은 applyProtectedAnim 안에서 호출 (PROTECTED_SFX 상수로 선택).

// SFX1 — 팅! (날카로운 금속 튕김. 칼날 막아낸 듯한 짧고 깔끔한 톤)
function playSfxProtected1Ting() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(2400, now);
    o1.frequency.exponentialRampToValueAtTime(1700, now + 0.5);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(0.28, now + 0.005);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    o1.connect(g1); g1.connect(out);
    o1.start(now); o1.stop(now + 0.6);
    // 금속성 하모닉
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(3800, now);
    o2.frequency.exponentialRampToValueAtTime(2400, now + 0.4);
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(0.13, now + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    o2.connect(g2); g2.connect(out);
    o2.start(now); o2.stop(now + 0.5);
  } catch (e) {}
}

// SFX2 — 유리 반짝임 (빠른 상승 sparkle 5음)
function playSfxProtected2Shimmer() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const freqs = [2600, 3200, 3900, 3300, 4500];  // 상승+반짝
    freqs.forEach((f, i) => {
      const t = now + i * 0.05;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.25);
    });
  } catch (e) {}
}

// SFX3 — 둔둔 (저음 더블 임팩트. 단단함·묵직함 강조)
function playSfxProtected3Solid() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // 1번째 둔
    const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(140, now);
    o1.frequency.exponentialRampToValueAtTime(60, now + 0.28);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(0.42, now + 0.01);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    o1.connect(g1); g1.connect(out);
    o1.start(now); o1.stop(now + 0.35);
    // 2번째 둔 (살짝 약함)
    const t2 = now + 0.16;
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(120, t2);
    o2.frequency.exponentialRampToValueAtTime(55, t2 + 0.25);
    g2.gain.setValueAtTime(0.0001, t2);
    g2.gain.linearRampToValueAtTime(0.32, t2 + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.3);
    o2.connect(g2); g2.connect(out);
    o2.start(t2); o2.stop(t2 + 0.35);
  } catch (e) {}
}

// SFX4 — 마법 차임 (벨 + 하모닉. 마법 방어막 같은 느낌)
function playSfxProtected4Chime() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // 벨 — fundamental + 비조화 하모닉으로 차임 특유의 톤
    const fundamental = 880;
    const harmonics = [
      { mult: 1.0,  gain: 0.20, len: 0.9 },
      { mult: 2.76, gain: 0.11, len: 0.7 },
      { mult: 5.40, gain: 0.06, len: 0.5 },
    ];
    harmonics.forEach(h => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = fundamental * h.mult;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(h.gain, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + h.len);
      o.connect(g); g.connect(out);
      o.start(now); o.stop(now + h.len + 0.05);
    });
  } catch (e) {}
}

// SFX5 — 차르륵 (크리스탈 캐스케이드. 8개 빠른 sparkle 무작위 톤)
function playSfxProtected5Crystal() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    for (let i = 0; i < 8; i++) {
      const t = now + i * 0.045;
      const f = 1800 + Math.random() * 2400;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.18);
    }
  } catch (e) {}
}

const PROTECTED_SFX_FUNCS = {
  1: playSfxProtected1Ting,
  2: playSfxProtected2Shimmer,
  3: playSfxProtected3Solid,
  4: playSfxProtected4Chime,
  5: playSfxProtected5Crystal,
};
const PROTECTED_SFX = 4;  // 마법 차임 (벨톤) — 사용자 선택

function playSfxRatDeath() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const sq = ctx.createOscillator();
    const sqG = ctx.createGain();
    sq.type = 'square';
    sq.frequency.setValueAtTime(1400, now);
    sq.frequency.exponentialRampToValueAtTime(2400, now + 0.06);
    sq.frequency.exponentialRampToValueAtTime(400, now + 0.2);
    sqG.gain.setValueAtTime(0.2, now);
    sqG.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    sq.connect(sqG); sqG.connect(out);
    sq.start(now); sq.stop(now + 0.25);
    const slide = ctx.createOscillator();
    const slG = ctx.createGain();
    slide.type = 'triangle';
    slide.frequency.setValueAtTime(800, now + 0.08);
    slide.frequency.exponentialRampToValueAtTime(200, now + 0.28);
    slG.gain.setValueAtTime(0.12, now + 0.08);
    slG.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    slide.connect(slG); slG.connect(out);
    slide.start(now + 0.08); slide.stop(now + 0.35);
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.08, now + 0.18);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 1800; bpf.Q.value = 2;
    noise.connect(bpf); bpf.connect(nG); nG.connect(out);
    noise.start(now + 0.18); noise.stop(now + 0.26);
  } catch (e) {}
}

// ── 폭탄 폭발 사운드 ──
function playSfxBombExplode() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const boom = ctx.createOscillator();
    const bG = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120, now);
    boom.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    bG.gain.setValueAtTime(0.5, now);
    bG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    boom.connect(bG); bG.connect(out);
    boom.start(now); boom.stop(now + 0.55);
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1) * (1 - j / nData.length);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.35, now);
    nG.gain.exponentialRampToValueAtTime(0.05, now + 0.3);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 1500;
    noise.connect(lpf); lpf.connect(nG); nG.connect(out);
    noise.start(now); noise.stop(now + 0.8);
    const crunch = ctx.createOscillator();
    const crG = ctx.createGain();
    crunch.type = 'sawtooth';
    crunch.frequency.setValueAtTime(200, now + 0.05);
    crunch.frequency.exponentialRampToValueAtTime(60, now + 0.3);
    crG.gain.setValueAtTime(0.18, now + 0.05);
    crG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    crunch.connect(crG); crG.connect(out);
    crunch.start(now + 0.05); crunch.stop(now + 0.45);
  } catch (e) {}
}

// ── 덫 발동 사운드 (콱!) ──
function playSfxTrapSnap() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const thud = ctx.createOscillator();
    const tG = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, now);
    thud.frequency.exponentialRampToValueAtTime(35, now + 0.3);
    tG.gain.setValueAtTime(0.55, now);
    tG.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    thud.connect(tG); tG.connect(out);
    thud.start(now); thud.stop(now + 0.5);
    const crunch = ctx.createOscillator();
    const crG = ctx.createGain();
    crunch.type = 'sawtooth';
    crunch.frequency.setValueAtTime(180, now);
    crunch.frequency.exponentialRampToValueAtTime(55, now + 0.25);
    crG.gain.setValueAtTime(0.3, now);
    crG.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 900;
    crunch.connect(lpf); lpf.connect(crG); crG.connect(out);
    crunch.start(now); crunch.stop(now + 0.4);
    const snap = ctx.createOscillator();
    const sG = ctx.createGain();
    snap.type = 'square';
    snap.frequency.setValueAtTime(1400, now);
    snap.frequency.exponentialRampToValueAtTime(300, now + 0.03);
    sG.gain.setValueAtTime(0.18, now);
    sG.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    snap.connect(sG); sG.connect(out);
    snap.start(now); snap.stop(now + 0.08);
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.35, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1) * (1 - j / nData.length);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.22, now);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    const lpf2 = ctx.createBiquadFilter();
    lpf2.type = 'lowpass'; lpf2.frequency.value = 700;
    noise.connect(lpf2); lpf2.connect(nG); nG.connect(out);
    noise.start(now); noise.stop(now + 0.38);
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(45, now);
    sub.frequency.exponentialRampToValueAtTime(25, now + 0.4);
    subG.gain.setValueAtTime(0.35, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sub.connect(subG); subG.connect(out);
    sub.start(now); sub.stop(now + 0.52);
  } catch (e) {}
}

// ── 저주 피해 사운드 (레이어링: 일반 피격 + 어둠) ──
function playSfxCurseDamage() {
  if (sfxMuted) return;
  // 레이어 1: 일반 피격음
  playSfx('hit');
  // 레이어 2: 어두운 저주 속삭임
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const d1 = ctx.createOscillator();
    const d1G = ctx.createGain();
    d1.type = 'sine';
    d1.frequency.setValueAtTime(180, now);
    d1.frequency.linearRampToValueAtTime(130, now + 0.5);
    d1G.gain.setValueAtTime(0.1, now);
    d1G.gain.linearRampToValueAtTime(0.15, now + 0.2);
    d1G.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    d1.connect(d1G); d1G.connect(out);
    d1.start(now); d1.stop(now + 0.85);
    const d2 = ctx.createOscillator();
    const d2G = ctx.createGain();
    d2.type = 'sine';
    d2.frequency.setValueAtTime(193, now);
    d2.frequency.linearRampToValueAtTime(138, now + 0.5);
    d2G.gain.setValueAtTime(0.08, now);
    d2G.gain.linearRampToValueAtTime(0.12, now + 0.2);
    d2G.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    d2.connect(d2G); d2G.connect(out);
    d2.start(now); d2.stop(now + 0.85);
    const whistle = ctx.createOscillator();
    const wG = ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(800, now + 0.15);
    whistle.frequency.linearRampToValueAtTime(400, now + 0.75);
    wG.gain.setValueAtTime(0.06, now + 0.15);
    wG.gain.linearRampToValueAtTime(0.04, now + 0.4);
    wG.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    whistle.connect(wG); wG.connect(out);
    whistle.start(now + 0.15); whistle.stop(now + 0.85);
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.05, now);
    nG.gain.linearRampToValueAtTime(0.08, now + 0.3);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 600; bpf.Q.value = 1.5;
    noise.connect(bpf); bpf.connect(nG); nG.connect(out);
    noise.start(now); noise.stop(now + 0.7);
  } catch (e) {}
}

// ── 채팅 수신 사운드 (부드러운 팝) ──
function playSfxChat() {
  if (sfxMuted) return;
  if (chatMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    o.connect(g); g.connect(out);
    o.start(now); o.stop(now + 0.17);
  } catch (e) {}
}

// ── 캐릭터 선택 사운드 (짧은 확인 딩) ──
function playSfxCharSelect() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // 가벼운 C6 → G6 상승 딩
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(1047, now);
    o1.frequency.exponentialRampToValueAtTime(1568, now + 0.12);
    g1.gain.setValueAtTime(0.18, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o1.connect(g1); g1.connect(out);
    o1.start(now); o1.stop(now + 0.22);
    // 배음
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.value = 2093;
    g2.gain.setValueAtTime(0.06, now + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    o2.connect(g2); g2.connect(out);
    o2.start(now + 0.03); o2.stop(now + 0.17);
  } catch (e) {}
}

// ── 덱 저장 사운드 (딩동) ──
function playSfxDeckSave() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    const n1 = ctx.createOscillator();
    const n1G = ctx.createGain();
    n1.type = 'sine';
    n1.frequency.value = 1047;
    n1G.gain.setValueAtTime(0.22, now);
    n1G.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    n1.connect(n1G); n1G.connect(out);
    n1.start(now); n1.stop(now + 0.32);
    const n2 = ctx.createOscillator();
    const n2G = ctx.createGain();
    n2.type = 'sine';
    n2.frequency.value = 1318;
    n2G.gain.setValueAtTime(0.22, now + 0.12);
    n2G.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    n2.connect(n2G); n2G.connect(out);
    n2.start(now + 0.12); n2.stop(now + 0.52);
    const h1 = ctx.createOscillator();
    const h1G = ctx.createGain();
    h1.type = 'triangle';
    h1.frequency.value = 2094;
    h1G.gain.setValueAtTime(0.08, now);
    h1G.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    h1.connect(h1G); h1G.connect(out);
    h1.start(now); h1.stop(now + 0.38);
    const sp = ctx.createOscillator();
    const spG = ctx.createGain();
    sp.type = 'sine';
    sp.frequency.setValueAtTime(2637, now + 0.22);
    sp.frequency.exponentialRampToValueAtTime(3136, now + 0.4);
    spG.gain.setValueAtTime(0.1, now + 0.22);
    spG.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sp.connect(spG); spG.connect(out);
    sp.start(now + 0.22); sp.stop(now + 0.52);
  } catch (e) {}
}

function playSfxRevealAppear() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // ① 둥- 저음 임팩트
    const bass = ctx.createOscillator();
    const bG = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(180, now);
    bass.frequency.exponentialRampToValueAtTime(60, now + 0.2);
    bG.gain.setValueAtTime(0.25, now);
    bG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    bass.connect(bG); bG.connect(out);
    bass.start(now); bass.stop(now + 0.45);
    // ② 밝은 어택 (존재감)
    const mid = ctx.createOscillator();
    const mG = ctx.createGain();
    mid.type = 'triangle';
    mid.frequency.setValueAtTime(500, now);
    mid.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    mG.gain.setValueAtTime(0.1, now);
    mG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    mid.connect(mG); mG.connect(out);
    mid.start(now); mid.stop(now + 0.25);
  } catch (e) {}
}

// ── 교체 깜빡임 사운드 (삐로- 1회, 깜빡임마다 호출) ──
function playSfxSwapBlink() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // ① 삐~ 고음 시작 → 로~ 하강 슬라이드
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.25);
    g.gain.setValueAtTime(0.15, now);
    g.gain.setValueAtTime(0.15, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(g); g.connect(out);
    osc.start(now); osc.stop(now + 0.38);
    // ② 배음 (풍성한 울림)
    const h = ctx.createOscillator();
    const hG = ctx.createGain();
    h.type = 'triangle';
    h.frequency.setValueAtTime(2100, now);
    h.frequency.exponentialRampToValueAtTime(1050, now + 0.25);
    hG.gain.setValueAtTime(0.06, now);
    hG.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    h.connect(hG); hG.connect(out);
    h.start(now); h.stop(now + 0.33);
  } catch (e) {}
}

// ── 교체 공개 사운드 (뿅! 팝) ──
function playSfxSwapReveal() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // ① 팝! 임팩트 (짧고 밝은 타격)
    const pop = ctx.createOscillator();
    const popG = ctx.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(1200, now);
    pop.frequency.exponentialRampToValueAtTime(300, now + 0.08);
    popG.gain.setValueAtTime(0.3, now);
    popG.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    pop.connect(popG); popG.connect(out);
    pop.start(now); pop.stop(now + 0.18);
    // ② 밝은 스파클 상승음 (뿅~ 느낌)
    const sparkle = ctx.createOscillator();
    const spG = ctx.createGain();
    sparkle.type = 'sine';
    sparkle.frequency.setValueAtTime(600, now + 0.03);
    sparkle.frequency.exponentialRampToValueAtTime(1800, now + 0.2);
    spG.gain.setValueAtTime(0.15, now + 0.03);
    spG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    sparkle.connect(spG); spG.connect(out);
    sparkle.start(now + 0.03); sparkle.stop(now + 0.45);
    // ③ 하모닉 배음 (풍성함 추가)
    const harm = ctx.createOscillator();
    const hG = ctx.createGain();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(900, now + 0.05);
    harm.frequency.exponentialRampToValueAtTime(2400, now + 0.18);
    hG.gain.setValueAtTime(0.08, now + 0.05);
    hG.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    harm.connect(hG); hG.connect(out);
    harm.start(now + 0.05); harm.stop(now + 0.4);
    // ④ 에어 버스트 (뿅 공기 느낌)
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const nData = nBuf.getChannelData(0);
    for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(0.1, now);
    nG.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 4000;
    noise.connect(hpf); hpf.connect(nG); nG.connect(out);
    noise.start(now); noise.stop(now + 0.12);
  } catch (e) {}
}

// ── 타이머 틱 사운드 (15초 이하) — 초시계 딸깍 ──
function playTimerTick() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;

    // ① 딸- (초시계 메커니즘 클릭)
    const click = ctx.createOscillator();
    const cG = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(3200, now);
    click.frequency.exponentialRampToValueAtTime(1200, now + 0.008);
    cG.gain.setValueAtTime(0.2, now);
    cG.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    click.connect(cG); cG.connect(out);
    click.start(now); click.stop(now + 0.05);

    // ② 깍- (약간 뒤의 반동 클릭)
    const click2 = ctx.createOscillator();
    const c2G = ctx.createGain();
    click2.type = 'sine';
    click2.frequency.setValueAtTime(2800, now + 0.05);
    click2.frequency.exponentialRampToValueAtTime(1000, now + 0.058);
    c2G.gain.setValueAtTime(0.12, now + 0.05);
    c2G.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    click2.connect(c2G); c2G.connect(out);
    click2.start(now + 0.05); click2.stop(now + 0.1);

    // ③ 미세 공명 (시계 울림)
    const res = ctx.createOscillator();
    const rG = ctx.createGain();
    res.type = 'triangle';
    res.frequency.setValueAtTime(1800, now);
    rG.gain.setValueAtTime(0.03, now);
    rG.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    res.connect(rG); rG.connect(out);
    res.start(now); res.stop(now + 0.14);
  } catch (e) {}
}

// ── 턴 벨소리 (Web Audio) ──
// ── 회복(약초학·신성) 전용 효과음 — 부드러운 상승 화음 + 반짝이 ──
function playSfxHeal() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;
    // ① 상승 아르페지오 (C5 → E5 → G5 → C6) — 따뜻한 화음
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = notes[i];
      const t = now + i * 0.06;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.10, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.5);
    }
    // ② 잔잔한 지속 톤 (G5) — 따뜻함
    const sus = ctx.createOscillator();
    const sg = ctx.createGain();
    sus.type = 'triangle';
    sus.frequency.value = 783.99;
    sg.gain.setValueAtTime(0.001, now + 0.1);
    sg.gain.linearRampToValueAtTime(0.06, now + 0.25);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    sus.connect(sg); sg.connect(out);
    sus.start(now + 0.1); sus.stop(now + 0.95);
    // ③ 고역 반짝이 (짧은 노이즈 펄스 3회)
    for (let i = 0; i < 3; i++) {
      const t = now + 0.05 + i * 0.12;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.05, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = 6500;
      src.connect(hpf); hpf.connect(ng); ng.connect(out);
      src.start(t); src.stop(t + 0.04);
    }
  } catch (e) {}
}

// ── 유황범람 — 시네마틱 분화 (긴 럼블 + 시간차 폭발 3회 + 용암 쉭) ──
function playSfxSulfur() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime, out = ctx.destination;
    // ① 긴 저음 럼블 (1초+)
    const rumble = ctx.createOscillator();
    const rg = ctx.createGain();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(40, now);
    rumble.frequency.linearRampToValueAtTime(60, now + 1.2);
    rg.gain.setValueAtTime(0.001, now);
    rg.gain.linearRampToValueAtTime(0.32, now + 0.4);
    rg.gain.linearRampToValueAtTime(0.32, now + 1.0);
    rg.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    rumble.connect(rg); rg.connect(out);
    rumble.start(now); rumble.stop(now + 1.3);
    // ② 다중 폭발 (3회 시간차)
    const blasts = [0.2, 0.45, 0.72];
    for (const bt of blasts) {
      const t = now + bt;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.4);
      // 폭발 노이즈
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 1500;
      src.connect(lpf); lpf.connect(ng); ng.connect(out);
      src.start(t); src.stop(t + 0.25);
    }
    // ③ 용암 쉭 소리 (지속 화염)
    const lavaT = now + 0.6;
    const lavaBuf = ctx.createBuffer(1, ctx.sampleRate * 0.7, ctx.sampleRate);
    const ld = lavaBuf.getChannelData(0);
    for (let j = 0; j < ld.length; j++) ld[j] = (Math.random() * 2 - 1);
    const lava = ctx.createBufferSource(); lava.buffer = lavaBuf;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.001, lavaT);
    lg.gain.linearRampToValueAtTime(0.10, lavaT + 0.2);
    lg.gain.exponentialRampToValueAtTime(0.001, lavaT + 0.7);
    const lFilter = ctx.createBiquadFilter();
    lFilter.type = 'bandpass'; lFilter.frequency.value = 4000; lFilter.Q.value = 1.5;
    lava.connect(lFilter); lFilter.connect(lg); lg.connect(out);
    lava.start(lavaT); lava.stop(lavaT + 0.7);
  } catch (e) {}
}

// ── 악몽 — 서브베이스 드론 + 5음 디소넌스 + 깊은 종 + 우물 메아리 ──
function playSfxNightmare() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime, out = ctx.destination;
    // ① 서브베이스 드론 (40Hz, 매우 깊음, 1.85초)
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 40;
    subG.gain.setValueAtTime(0.001, now);
    subG.gain.linearRampToValueAtTime(0.32, now + 0.4);
    subG.gain.linearRampToValueAtTime(0.32, now + 1.4);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    sub.connect(subG); subG.connect(out);
    sub.start(now); sub.stop(now + 1.85);
    // ② 5음 디소넌스 클러스터 (반음·증4도)
    const cluster = [110, 117, 138.59, 146.83, 165];
    for (let i = 0; i < cluster.length; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = cluster[i];
      const t = now + i * 0.05;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.9);
    }
    // ③ 깊은 종 1회 (D2 + 배음, 1.4초 잔향)
    const bellT = now + 0.3;
    const bell = ctx.createOscillator();
    const bg = ctx.createGain();
    bell.type = 'triangle';
    bell.frequency.value = 73.42;  // D2
    bg.gain.setValueAtTime(0.001, bellT);
    bg.gain.linearRampToValueAtTime(0.22, bellT + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.001, bellT + 1.4);
    bell.connect(bg); bg.connect(out);
    bell.start(bellT); bell.stop(bellT + 1.45);
    const bell2 = ctx.createOscillator();
    const bg2 = ctx.createGain();
    bell2.type = 'sine';
    bell2.frequency.value = 146.83;
    bg2.gain.setValueAtTime(0.001, bellT);
    bg2.gain.linearRampToValueAtTime(0.06, bellT + 0.04);
    bg2.gain.exponentialRampToValueAtTime(0.001, bellT + 1.0);
    bell2.connect(bg2); bg2.connect(out);
    bell2.start(bellT); bell2.stop(bellT + 1.05);
    // ④ 우물 메아리 3회 (점점 약해짐)
    for (let r = 0; r < 3; r++) {
      const t = now + 0.5 + r * 0.32;
      const e = ctx.createOscillator();
      const eg = ctx.createGain();
      e.type = 'sine';
      e.frequency.setValueAtTime(82, t);
      e.frequency.exponentialRampToValueAtTime(38, t + 0.55);
      eg.gain.setValueAtTime(0.18 * Math.pow(0.6, r), t);
      eg.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      e.connect(eg); eg.connect(out);
      e.start(t); e.stop(t + 0.7);
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
// ── 캐릭터별 전용 스킬/패시브 효과음 (Web Audio 절차 생성) ────
// ═══════════════════════════════════════════════════════════════

// ── 패시브 type → 전용 SFX 라우터 ──
function pickPassiveSfxByType(type) {
  switch (type) {
    case 'monk':                   // 가호 (피격 시) — 서버 emit 실제 type
    case 'monk_attack':
    case 'monk_defend':
      return playSfxMonkBlessing;
    case 'wizard':       return playSfxWizardInstant;
    case 'armoredWarrior':
    case 'iron_skin':    return playSfxIronSkin;
    case 'bodyguard':    return playSfxBodyguardLoyalty;
    case 'count':        return playSfxCountTyranny;
    case 'commander':    return playSfxCommanderWrath;
    case 'butcher':
    case 'slaughterHero': return playSfxButcherBetrayer;
    case 'mark':
    case 'torturer':     return playSfxTorturerMark;
    case 'nightmare_kill': return playSfxNightmare;  // 악몽으로 격파 시
    case 'curse_removed':  return playSfxWitchCurse; // 저주 해제
    default:             return null;
  }
}

// ── 스킬 메시지 prefix → 전용 SFX 라우터 ──
// 서버 result.msg / oppMsg 와 정확히 매칭
function pickSkillSfxByMsg(msg) {
  if (!msg || typeof msg !== 'string') return null;
  if (msg.startsWith('⛓ 악몽:')) return playSfxNightmare;
  if (msg.startsWith('🌿 약초학:') || msg.startsWith('🙏 신성:')) return (typeof playSfxHeal === 'function' ? playSfxHeal : null);
  if (msg.startsWith('🔥 유황범람:')) return (typeof playSfxSulfur === 'function' ? playSfxSulfur : null);
  if (msg.startsWith('🏹 정비')) return playSfxArcherTune;       // 궁수 정비 (반전)
  if (msg.startsWith('🔭 정찰')) return playSfxScout;            // 척후병 정찰
  if (msg.startsWith('👫 분신')) return playSfxTwinsJoin;        // 쌍둥이 합체
  if (msg.startsWith('🪤 덫 설치')) return playSfxBombPlace;     // 사냥꾼 덫 설치 (폭탄 설치와 톤 비슷)
  if (msg.startsWith('📯 질주')) return playSfxMessengerSprint;  // 전령 질주
  if (msg.startsWith('💣 폭탄 설치')) return playSfxBombPlace;   // 폭파병 폭탄 설치
  if (msg.startsWith('💥기폭') || msg.startsWith('💥 기폭')) return playSfxBombExplode;  // 폭파병 기폭
  if (msg.startsWith('👻 그림자 숨기') || msg.startsWith('🗡 그림자 숨기')) return playSfxShadowHide; // 그림자 암살자
  if (msg.startsWith('☠ 저주')) return playSfxWitchCurse;  // 마녀 저주 (시전·데미지·해제 모두 ☠)
  if (msg.startsWith('⚔ 쌍검무')) return playSfxDualBlade;       // 양손검객
  if (msg.startsWith('🐀 역병')) return playSfxRatSummon;        // 쥐 장수
  if (msg.startsWith('🐉 드래곤')) return playSfxDragonSummon;   // 드래곤 조련사
  if (msg.startsWith('⚒ 정비')) return playSfxArmorerTune;       // 무기상
  if (msg.startsWith('♛ 절대복종') || msg.startsWith('♛ 반지')) return playSfxKingRing;  // 국왕
  return null;
}

// 작은 헬퍼 — 짧은 톤
// ── 시간 초과 SFX (옵션 1: 클래식 따르릉) ──
//   850/1100Hz 두 톤을 0.18s 간격으로 6번 번갈아 울림 (~1.1s).
//   각 펄스는 sine 메인 + square 1.5x 하모닉으로 부저 느낌 약하게.
function playSfxTimeout() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const t = now + i * 0.18;
      const f = (i % 2 === 0) ? 850 : 1100;
      _sfxTone(ctx, t, f,       0.13, 'sine',   0.12);
      _sfxTone(ctx, t, f * 1.5, 0.13, 'square', 0.025);
    }
  } catch (e) {}
}

function _sfxTone(ctx, time, freq, dur, type, gain, glide) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, time);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, time + dur);
  g.gain.setValueAtTime(0.001, time);
  g.gain.linearRampToValueAtTime(gain || 0.1, time + Math.min(0.02, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(time); o.stop(time + dur + 0.02);
}
function _sfxNoise(ctx, time, dur, gain, hpFreq, lpFreq) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain || 0.1, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  let node = src;
  if (hpFreq) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpFreq; node.connect(f); node = f; }
  if (lpFreq) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpFreq; node.connect(f); node = f; }
  node.connect(g); g.connect(ctx.destination);
  src.start(time); src.stop(time + dur);
}

// ── 1. 궁수 정비 (공격범위 반전) — 기계 부품 회전 + 짧은 클릭 ──
function playSfxArcherTune() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxTone(ctx, now, 800, 0.05, 'square', 0.08);
    _sfxTone(ctx, now + 0.06, 1200, 0.05, 'square', 0.06);
    _sfxTone(ctx, now + 0.18, 600, 0.18, 'sawtooth', 0.06, 1100);  // pitch slide up
  } catch (e) {}
}

// ── 2. 척후병 척후 (정찰) — 레이더 핑 ──
function playSfxScout() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxTone(ctx, now,        1800, 0.15, 'sine', 0.1);
    _sfxTone(ctx, now + 0.18, 2200, 0.18, 'sine', 0.07);
    _sfxNoise(ctx, now + 0.05, 0.06, 0.03, 4000);
  } catch (e) {}
}

// ── 3. 쌍둥이 분신 (합체) — 비행 휘이익 + 도착 화음 + 반짝 chime ──
//   비행 700ms 와 동기화 — 0~600ms 에 상승 글라이드 (휘이익), 도착 시점(~650ms)에 화음 합주.
function playSfxTwinsJoin() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // ① 비행 휘이익 — 350Hz → 1100Hz 상승 글라이드, 0~0.6s
    _sfxTone(ctx, now,         350, 0.6,  'sine',     0.05, 1100);
    // ② 도착 펄스 — 합체 화음 (C major triad: C5+E5+G5)
    _sfxTone(ctx, now + 0.62,  523, 0.45, 'sine',     0.09);  // C5
    _sfxTone(ctx, now + 0.62,  659, 0.45, 'sine',     0.08);  // E5
    _sfxTone(ctx, now + 0.62,  784, 0.45, 'sine',     0.07);  // G5
    // ③ 반짝 chime — 한 옥타브 위 (C6) 짧게
    _sfxTone(ctx, now + 0.68, 1047, 0.30, 'triangle', 0.06);  // C6 sparkle
  } catch (e) {}
}

// ── 4. 전령 질주 — 빠른 발걸음 + 휘이익 ──
function playSfxMessengerSprint() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 발걸음 3번
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.08;
      _sfxNoise(ctx, t, 0.04, 0.08, 200, 800);
    }
    // 휘이익
    _sfxTone(ctx, now + 0.05, 400, 0.3, 'sawtooth', 0.05, 1200);
  } catch (e) {}
}

// ── 5. 폭파병 폭탄 설치 — 째깍거림 + 클릭 ──
function playSfxBombPlace() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 똑딱 3번 (시한폭탄)
    for (let i = 0; i < 3; i++) {
      _sfxTone(ctx, now + i * 0.1, 1500, 0.04, 'square', 0.07);
    }
    // 무거운 설치 thud
    _sfxTone(ctx, now + 0.32, 80, 0.18, 'sine', 0.15, 50);
  } catch (e) {}
}

// ── 7. 그림자 암살자 그림자 숨기 — 휘이익 + 페이드 ──
function playSfxShadowHide() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 그림자 휘이익 (하강 글라이드)
    _sfxTone(ctx, now, 1400, 0.5, 'sine', 0.08, 200);
    // 어두운 노이즈 layer
    _sfxNoise(ctx, now, 0.5, 0.04, 80, 600);
  } catch (e) {}
}

// ── 8. 마녀 저주 시전 — 신비로운 와류 + 보컬 톤 ──
function playSfxWitchCurse() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 신비로운 글라이드 (하강)
    _sfxTone(ctx, now, 600, 0.6, 'sawtooth', 0.06, 200);
    // 보컬 같은 톤 (사인파 진동)
    _sfxTone(ctx, now + 0.1, 350, 0.5, 'sine', 0.09);
    // 어두운 종소리
    _sfxTone(ctx, now + 0.3, 200, 0.4, 'triangle', 0.07);
  } catch (e) {}
}

// ── 9. 양손검객 쌍검무 — 옵션 B (거친 파칭!) 적용 중 ──
function playSfxDualBlade() {
  playSfxDualBladeB();
}
// 후보 A: 묵직한 강철 슬래시 두 번 (저음 thud + 고음 슬래시)
function playSfxDualBladeA() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 첫 번째 슬래시 — "차앙!"
    _sfxNoise(ctx, now, 0.04, 0.18, 4000, 12000);  // 날카로운 메탈
    _sfxTone(ctx, now, 3200, 0.15, 'square', 0.08, 1600);  // 고음 → 저음 글라이드
    _sfxNoise(ctx, now + 0.02, 0.18, 0.08, 200, 600);  // 저음 thud
    // 두 번째 슬래시 — "차아앙!" (180ms 후, 약간 더 높은 톤)
    _sfxNoise(ctx, now + 0.18, 0.05, 0.20, 4000, 12000);
    _sfxTone(ctx, now + 0.18, 3600, 0.18, 'square', 0.09, 1800);
    _sfxNoise(ctx, now + 0.20, 0.20, 0.09, 200, 600);
    _sfxTone(ctx, now + 0.18, 180, 0.25, 'sine', 0.06);  // 잔향
  } catch (e) {}
}
// 후보 B: 전기톱 같은 거친 파칭! (sawtooth dominant)
function playSfxDualBladeB() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 첫 슬래시 — sawtooth "파칭!"
    _sfxTone(ctx, now, 2000, 0.12, 'sawtooth', 0.12, 4000);
    _sfxNoise(ctx, now, 0.08, 0.15, 3000, 10000);
    _sfxTone(ctx, now, 120, 0.18, 'sine', 0.08);  // 저음 충격
    // 두 번째 슬래시 — 한 옥타브 위
    _sfxTone(ctx, now + 0.15, 2400, 0.14, 'sawtooth', 0.13, 5000);
    _sfxNoise(ctx, now + 0.15, 0.1, 0.16, 3000, 10000);
    _sfxTone(ctx, now + 0.15, 140, 0.22, 'sine', 0.09);
    // 끝 잔향
    _sfxTone(ctx, now + 0.32, 800, 0.3, 'triangle', 0.06, 200);
  } catch (e) {}
}
// 후보 C: 웅장한 파칭! — 종소리 같은 잔향 + 검 슬래시
function playSfxDualBladeC() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 첫 슬래시 — 종소리 chime
    _sfxNoise(ctx, now, 0.03, 0.18, 5000, 14000);
    _sfxTone(ctx, now, 1760, 0.5, 'sine', 0.10);   // 종 (A6)
    _sfxTone(ctx, now, 2640, 0.4, 'sine', 0.07);   // 5th
    _sfxTone(ctx, now, 880, 0.3, 'sine', 0.05);    // 옥타브 아래
    // 두 번째 슬래시
    _sfxNoise(ctx, now + 0.20, 0.04, 0.20, 5000, 14000);
    _sfxTone(ctx, now + 0.20, 2349, 0.6, 'sine', 0.10);  // D7 (위)
    _sfxTone(ctx, now + 0.20, 3520, 0.45, 'sine', 0.08); // 5th 위
    _sfxTone(ctx, now + 0.20, 1175, 0.35, 'sine', 0.06); // 옥타브 아래
    // 굵은 저음 woom
    _sfxTone(ctx, now, 80, 0.6, 'sine', 0.10);
  } catch (e) {}
}

// ── 10. 쥐 장수 역병의 자손들 — 쥐들 끽끽 ──
function playSfxRatSummon() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 다수의 짧은 끽끽 소리
    for (let i = 0; i < 5; i++) {
      const t = now + i * 0.07;
      const f = 1800 + Math.random() * 800;
      _sfxTone(ctx, t, f, 0.06, 'square', 0.06);
    }
    // 긁히는 노이즈
    _sfxNoise(ctx, now, 0.4, 0.04, 1500, 4000);
  } catch (e) {}
}

// ── 11. 무기상 정비 (가로↔세로 전환) — 망치질 + 클릭 ──
function playSfxArmorerTune() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 망치 두 번
    _sfxNoise(ctx, now, 0.04, 0.18, 200, 1200);
    _sfxTone(ctx, now, 180, 0.05, 'square', 0.1);
    _sfxNoise(ctx, now + 0.12, 0.04, 0.14, 200, 1200);
    _sfxTone(ctx, now + 0.12, 220, 0.05, 'square', 0.08);
    // 끝 클릭
    _sfxTone(ctx, now + 0.25, 1500, 0.04, 'square', 0.06);
  } catch (e) {}
}

// ── 12. 국왕 절대복종 반지 — 웅장한 종소리 + 반지 광채 ──
function playSfxKingRing() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 큰 종소리 (저음)
    _sfxTone(ctx, now,       220, 0.8, 'sine', 0.12);
    _sfxTone(ctx, now,       330, 0.6, 'sine', 0.08);  // 3rd harmonic
    // 광채 (고음 떨림)
    for (let i = 0; i < 4; i++) {
      _sfxTone(ctx, now + 0.15 + i * 0.08, 1760 + i * 220, 0.12, 'sine', 0.05);
    }
  } catch (e) {}
}

// ── 13. 드래곤 조련사 드래곤 소환 — 깊은 으르렁 + 사이렌 ──
function playSfxDragonSummon() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 깊은 으르렁 (저주파 sawtooth)
    _sfxTone(ctx, now, 80, 0.8, 'sawtooth', 0.18, 50);
    _sfxTone(ctx, now + 0.05, 100, 0.7, 'sawtooth', 0.12, 70);
    // 고음 사이렌 (드래곤의 비명)
    _sfxTone(ctx, now + 0.3, 400, 0.5, 'sawtooth', 0.08, 1200);
    // 거대 노이즈 (날갯짓)
    _sfxNoise(ctx, now + 0.4, 0.4, 0.08, 100, 800);
  } catch (e) {}
}

// ──────── 패시브 SFX (8종) ────────

// 14. 가호 (수도승) — 교회 종소리 한 점
function playSfxMonkBlessing() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxTone(ctx, now, 880, 0.6, 'sine', 0.12);
    _sfxTone(ctx, now, 1320, 0.5, 'sine', 0.06);  // 5th
    _sfxTone(ctx, now + 0.05, 660, 0.4, 'sine', 0.05);  // 3rd
  } catch (e) {}
}
// 15. 인스턴트 매직 (마법사) — 반짝이 상승음
function playSfxWizardInstant() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxTone(ctx, now, 800, 0.3, 'sine', 0.08, 2400);  // glide up
    _sfxTone(ctx, now + 0.1, 1600, 0.3, 'sine', 0.06, 3200);
    _sfxNoise(ctx, now + 0.05, 0.2, 0.03, 6000);  // sparkle
  } catch (e) {}
}
// 16. 아이언 스킨 (갑주무사) — 금속 둔탁한 깡
function playSfxIronSkin() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxNoise(ctx, now, 0.05, 0.18, 800, 3000);
    _sfxTone(ctx, now, 180, 0.25, 'square', 0.1, 100);
  } catch (e) {}
}
// 17. 충성 (호위무사) — 방패 부딪힘 + 짧은 함성
function playSfxBodyguardLoyalty() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxNoise(ctx, now, 0.08, 0.2, 400, 2000);
    _sfxTone(ctx, now + 0.04, 200, 0.18, 'sawtooth', 0.1);
    _sfxTone(ctx, now + 0.12, 350, 0.15, 'square', 0.06);
  } catch (e) {}
}
// 18. 폭정 (백작) — 어두운 저음 + 음산
function playSfxCountTyranny() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxTone(ctx, now, 110, 0.6, 'sawtooth', 0.1);
    _sfxTone(ctx, now, 165, 0.5, 'sawtooth', 0.07);  // imperfect 5th
    _sfxNoise(ctx, now, 0.5, 0.04, 50, 300);
  } catch (e) {}
}
// 19. 사기증진 (지휘관) — 짧은 북 + 호른
function playSfxCommanderWrath() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxNoise(ctx, now, 0.06, 0.15, 50, 200);  // 북
    _sfxTone(ctx, now + 0.08, 392, 0.3, 'square', 0.08);  // 호른 G4
    _sfxTone(ctx, now + 0.18, 587, 0.25, 'square', 0.07);  // D5
  } catch (e) {}
}
// 20. 배반자 (학살영웅) — 어두운 슬래시 + 비명
function playSfxButcherBetrayer() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    _sfxNoise(ctx, now, 0.15, 0.2, 1500, 5000);  // 슬래시
    _sfxTone(ctx, now + 0.08, 200, 0.25, 'sawtooth', 0.1, 80);  // 어두운 비명
  } catch (e) {}
}
// 21. 표식 (고문 기술자) — 사슬 짤랑 + 날카로운 클릭
function playSfxTorturerMark() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return; const now = ctx.currentTime;
    // 사슬
    for (let i = 0; i < 4; i++) {
      _sfxNoise(ctx, now + i * 0.04, 0.025, 0.07, 3000, 8000);
    }
    // 날카로운 클릭
    _sfxTone(ctx, now + 0.2, 2200, 0.06, 'square', 0.1);
  } catch (e) {}
}

// ── 패시브 발동 전용 효과음 — 부드러운 2음 차임 ──
function playSfxPassive() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.destination;

    // ① 작고 부드러운 두 음 (E5 → A5) — 알림 차임
    const notes = [{ f: 659.25, t: 0 }, { f: 880, t: 0.08 }];
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = n.f;
      g.gain.setValueAtTime(0.001, now + n.t);
      g.gain.linearRampToValueAtTime(0.10, now + n.t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + n.t + 0.25);
      o.connect(g); g.connect(out);
      o.start(now + n.t); o.stop(now + n.t + 0.3);
    }
    // ② 살짝 스파클 (고역 노이즈 한 점)
    const sparkleT = now + 0.04;
    const sBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const sd = sBuf.getChannelData(0);
    for (let j = 0; j < sd.length; j++) sd[j] = (Math.random() * 2 - 1);
    const sp = ctx.createBufferSource();
    sp.buffer = sBuf;
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(0.04, sparkleT);
    sG.gain.exponentialRampToValueAtTime(0.001, sparkleT + 0.05);
    const sF = ctx.createBiquadFilter();
    sF.type = 'highpass'; sF.frequency.value = 7000;
    sp.connect(sF); sF.connect(sG); sG.connect(out);
    sp.start(sparkleT); sp.stop(sparkleT + 0.05);
  } catch (e) {}
}

// ── 단일 공유 AudioContext (브라우저 autoplay 정책 회피 + 동시 재생 안정성) ──
let _sharedAudioCtx = null;
function getAudioCtx() {
  if (!_sharedAudioCtx) {
    try {
      _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return null; }
  }
  // suspended 상태면 resume 시도 (사용자 제스처 후 호출되면 깨어남)
  if (_sharedAudioCtx.state === 'suspended') {
    try { _sharedAudioCtx.resume(); } catch (e) {}
  }
  return _sharedAudioCtx;
}
// 첫 사용자 인터랙션에서 컨텍스트 깨우기 (자동재생 정책)
document.addEventListener('click', () => { getAudioCtx(); }, { once: false });
document.addEventListener('keydown', () => { getAudioCtx(); }, { once: false });

function playTurnBell() {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

// ── 효과음 (Web Audio) ──
function playSfx(type) {
  if (sfxMuted) return;
  try {
    const ctx = getAudioCtx(); if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case 'move':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.setValueAtTime(500, ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
        break;
      case 'attack':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
        break;
      case 'hit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.setValueAtTime(150, ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
        break;
      case 'kill':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
        break;
      case 'skill': {
        // 메인 오실레이터 비활성
        osc.type = 'sine'; osc.frequency.value = 0; gain.gain.value = 0;
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.01);
        const now = ctx.currentTime;
        const out = ctx.destination;
        // ① 스파클 아르페지오 (G5→B5→D6→F#6→G6→A6)
        const sparkleNotes = [784, 988, 1175, 1397, 1568, 1760];
        for (let i = 0; i < sparkleNotes.length; i++) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = sparkleNotes[i];
          g.gain.setValueAtTime(0.12, now + i * 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.2);
          o.connect(g); g.connect(out);
          o.start(now + i * 0.05); o.stop(now + i * 0.05 + 0.25);
        }
        // ② 마법 화음 (C5+E5+G5+C6)
        const chordTime = now + 0.3;
        const chordFreqs = [523.25, 659.25, 783.99, 1046.5];
        for (const freq of chordFreqs) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.08, chordTime);
          g.gain.linearRampToValueAtTime(0.06, chordTime + 0.15);
          g.gain.exponentialRampToValueAtTime(0.001, chordTime + 0.7);
          o.connect(g); g.connect(out);
          o.start(chordTime); o.stop(chordTime + 0.75);
        }
        // ③ 고음 심벌 반짝임
        const nBuf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
        const nData = nBuf.getChannelData(0);
        for (let j = 0; j < nData.length; j++) nData[j] = (Math.random() * 2 - 1);
        const noise = ctx.createBufferSource();
        noise.buffer = nBuf;
        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0.06, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass'; hpf.frequency.value = 6000;
        noise.connect(hpf); hpf.connect(nGain); nGain.connect(out);
        noise.start(now); noise.stop(now + 0.15);
        break;
      }
      case 'opp_skill': {
        // 상대 스킬 — 위협적이고 긴장되는 사운드
        osc.type = 'sine'; osc.frequency.value = 0; gain.gain.value = 0;
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.01);
        const now2 = ctx.currentTime;
        const out2 = ctx.destination;
        // ① 저음 임팩트 (위협적인 시작)
        const boom = ctx.createOscillator();
        const boomG = ctx.createGain();
        boom.type = 'sawtooth';
        boom.frequency.setValueAtTime(90, now2);
        boom.frequency.exponentialRampToValueAtTime(35, now2 + 0.4);
        boomG.gain.setValueAtTime(0.18, now2);
        boomG.gain.exponentialRampToValueAtTime(0.001, now2 + 0.5);
        boom.connect(boomG); boomG.connect(out2);
        boom.start(now2); boom.stop(now2 + 0.5);
        // ② 불길한 하강 아르페지오 (D마이너 계열)
        const darkNotes = [1175, 1047, 880, 784, 659, 587, 440];
        for (let i = 0; i < darkNotes.length; i++) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'square';
          o.frequency.value = darkNotes[i];
          g.gain.setValueAtTime(0.07, now2 + i * 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, now2 + i * 0.06 + 0.25);
          o.connect(g); g.connect(out2);
          o.start(now2 + i * 0.06); o.stop(now2 + i * 0.06 + 0.3);
        }
        // ③ 어둠 화음 (마이너 — 긴장감)
        const darkChordT = now2 + 0.45;
        const darkChord = [293.66, 349.23, 440, 587.33];
        for (const freq of darkChord) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.09, darkChordT);
          g.gain.linearRampToValueAtTime(0.06, darkChordT + 0.2);
          g.gain.exponentialRampToValueAtTime(0.001, darkChordT + 0.8);
          o.connect(g); g.connect(out2);
          o.start(darkChordT); o.stop(darkChordT + 0.85);
        }
        // ④ 노이즈 스웰 (불안한 바람 소리)
        const windBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const windData = windBuf.getChannelData(0);
        for (let j = 0; j < windData.length; j++) windData[j] = (Math.random() * 2 - 1);
        const wind = ctx.createBufferSource();
        wind.buffer = windBuf;
        const wGain = ctx.createGain();
        wGain.gain.setValueAtTime(0.001, now2);
        wGain.gain.linearRampToValueAtTime(0.08, now2 + 0.15);
        wGain.gain.exponentialRampToValueAtTime(0.001, now2 + 0.3);
        const wFilter = ctx.createBiquadFilter();
        wFilter.type = 'bandpass'; wFilter.frequency.value = 3000; wFilter.Q.value = 1.5;
        wind.connect(wFilter); wFilter.connect(wGain); wGain.connect(out2);
        wind.start(now2); wind.stop(now2 + 0.3);
        break;
      }
      case 'shrink':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 0.8);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.0);
        break;
      case 'sp':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.08);
        osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
        break;
      case 'btn_click':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
        break;
    }
  } catch (e) {}
}

// ── 전역 버튼 클릭 효과음 ──
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) playSfx('btn_click');
});

// ═══════════════════════════════════════════════════════════════
// ── BGM 시스템 (Web Audio API 프로시저럴) ────────────────────
// ═══════════════════════════════════════════════════════════════
const BGM = {
  ctx: null,
  currentTrack: null,
  gainNode: null,
  nodes: [],
  timers: [],      // setTimeout ID 추적 (루프 취소용)
  volume: 0.12,
  muted: false,
};

function bgmGetCtx() {
  if (!BGM.ctx) {
    BGM.ctx = new (window.AudioContext || window.webkitAudioContext)();
    BGM.gainNode = BGM.ctx.createGain();
    BGM.gainNode.gain.value = BGM.volume;
    BGM.gainNode.connect(BGM.ctx.destination);
  }
  if (BGM.ctx.state === 'suspended') BGM.ctx.resume();
  return BGM.ctx;
}

// 첫 사용자 인터랙션 시 현재 화면에 맞는 BGM 자동 재생.
//   재접속 시 페이지 리로드 → 게임 진행 중인 화면(screen-game / 세팅 페이즈)에서도 BGM 이 자동 시작되도록 분기 추가.
document.addEventListener('click', function _bgmFirstClick() {
  document.removeEventListener('click', _bgmFirstClick);
  if (!BGM.currentTrack && !bgmMuted) {
    const active = document.querySelector('.screen.active');
    if (active) {
      const id = active.id;
      const setupScreens = ['screen-initial-reveal','screen-exchange','screen-final-reveal','screen-hp','screen-placement','screen-draft','screen-reveal'];
      if (id === 'screen-lobby' || (id === 'screen-draft' && S.deckBuilderMode)) bgmPlay('lobby');
      else if (setupScreens.includes(id)) bgmPlay('setup');
      else if (id === 'screen-game') bgmPlay('game');
      else if (id === 'screen-gameover') {
        // 게임오버 트랙은 game_over 핸들러가 별도 호출 — 여기선 무시
      }
    }
  }
}, { once: true });

function bgmStop() {
  for (const t of BGM.timers) clearTimeout(t);
  BGM.timers = [];
  for (const n of BGM.nodes) { try { n.stop(); } catch(e){} try { n.disconnect(); } catch(e){} }
  BGM.nodes = [];
  BGM.currentTrack = null;
}

function bgmPlay(trackName) {
  if (bgmMuted) { BGM.pendingTrack = trackName; return; }
  if (BGM.currentTrack === trackName) return;
  bgmStop();
  BGM.currentTrack = trackName;
  const ctx = bgmGetCtx();
  const gain = BGM.gainNode;

  switch (trackName) {
    case 'lobby': bgmLobby(ctx, gain); break;
    case 'setup': bgmSetup(ctx, gain); break;
    case 'game':  bgmGame(ctx, gain); break;
    case 'victory': bgmVictory(ctx, gain); break;
    case 'defeat':  bgmDefeat(ctx, gain); break;
  }
}

// ── 로비 BGM: 기대감 있는 준비 선율 (루프) ──
function bgmLobby(ctx, dest) {
  const notes = [261.63,329.63,392,349.23,329.63,293.66,261.63,329.63, 349.23,392,440,392,349.23,329.63,293.66,261.63];
  const dur = 0.4;
  function playLoop() {
    if (BGM.currentTrack !== 'lobby') return;
    const now = ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = notes[i];
      g.gain.setValueAtTime(0.12, now + i*dur);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*0.85);
      osc.connect(g); g.connect(dest);
      osc.start(now + i*dur); osc.stop(now + i*dur + dur);
      BGM.nodes.push(osc);
    }
    // 저음 드론
    const drone = ctx.createOscillator();
    const dg = ctx.createGain();
    drone.type = 'sine';
    drone.frequency.value = 130.81;
    dg.gain.value = 0.04;
    drone.connect(dg); dg.connect(dest);
    drone.start(now); drone.stop(now + notes.length*dur);
    BGM.nodes.push(drone);
    BGM.timers.push(setTimeout(playLoop, notes.length * dur * 1000));
  }
  playLoop();
}

// ── 세팅 BGM: 평화로운 중세 선율 (루프) ──
function bgmSetup(ctx, dest) {
  const notes = [329.63,392,440,392,329.63,293.66,329.63,392, 440,523.25,493.88,440,392,329.63,293.66,329.63];
  const dur = 0.5;
  function playLoop() {
    if (BGM.currentTrack !== 'setup') return;
    const now = ctx.currentTime;
    // 멜로디
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      g.gain.setValueAtTime(0.15, now + i*dur);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*0.9);
      osc.connect(g); g.connect(dest);
      osc.start(now + i*dur); osc.stop(now + i*dur + dur);
      BGM.nodes.push(osc);
    }
    // 배경 패드
    const pad = ctx.createOscillator();
    const pg = ctx.createGain();
    pad.type = 'triangle';
    pad.frequency.value = 164.81;
    pg.gain.setValueAtTime(0.06, now);
    pg.gain.setValueAtTime(0.06, now + notes.length*dur - 0.1);
    pg.gain.exponentialRampToValueAtTime(0.001, now + notes.length*dur);
    pad.connect(pg); pg.connect(dest);
    pad.start(now); pad.stop(now + notes.length*dur);
    BGM.nodes.push(pad);
    BGM.timers.push(setTimeout(playLoop, notes.length * dur * 1000));
  }
  playLoop();
}

// ── 본게임 BGM: 장엄한 전투 선율 (루프) ──
function bgmGame(ctx, dest) {
  // D 마이너 계열 — 무겁고 장엄한 행진
  const bass = [73.42,73.42,87.31,82.41, 73.42,73.42,65.41,69.30, 73.42,73.42,87.31,82.41, 73.42,82.41,73.42,73.42];
  const melody = [293.66,349.23,440,392, 349.23,293.66,261.63,293.66, 349.23,440,523.25,493.88, 440,392,349.23,293.66];
  const horn = [146.83,0,174.61,164.81, 146.83,0,130.81,138.59, 146.83,0,174.61,164.81, 146.83,164.81,146.83,0];
  const dur = 0.38;
  const loopLen = melody.length * dur;

  function playLoop() {
    if (BGM.currentTrack !== 'game') return;
    const now = ctx.currentTime;

    // 깊은 서브베이스 드론 (D2)
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 73.42;
    sg.gain.setValueAtTime(0.10, now);
    sg.gain.setValueAtTime(0.10, now + loopLen - 0.1);
    sg.gain.exponentialRampToValueAtTime(0.001, now + loopLen);
    sub.connect(sg); sg.connect(dest);
    sub.start(now); sub.stop(now + loopLen);
    BGM.nodes.push(sub);

    // 베이스라인 (sawtooth — 무거운 질감)
    for (let i = 0; i < bass.length; i++) {
      if (bass[i] === 0) continue;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = bass[i];
      g.gain.setValueAtTime(0.05, now + i*dur);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*0.9);
      osc.connect(g); g.connect(dest);
      osc.start(now + i*dur); osc.stop(now + i*dur + dur);
      BGM.nodes.push(osc);
    }

    // 호른 레이어 (triangle — 중후한 금관 느낌)
    for (let i = 0; i < horn.length; i++) {
      if (horn[i] === 0) continue;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = horn[i];
      g.gain.setValueAtTime(0.07, now + i*dur);
      g.gain.linearRampToValueAtTime(0.04, now + i*dur + dur*0.5);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*0.95);
      osc.connect(g); g.connect(dest);
      osc.start(now + i*dur); osc.stop(now + i*dur + dur);
      BGM.nodes.push(osc);
    }

    // 멜로디 (square — 장엄한 선율)
    for (let i = 0; i < melody.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = melody[i];
      g.gain.setValueAtTime(0.04, now + i*dur);
      g.gain.linearRampToValueAtTime(0.06, now + i*dur + dur*0.15);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*0.85);
      osc.connect(g); g.connect(dest);
      osc.start(now + i*dur); osc.stop(now + i*dur + dur);
      BGM.nodes.push(osc);
    }

    // 퍼커션 (노이즈 버스트 — 행진 드럼 느낌, 매 2비트마다)
    for (let i = 0; i < melody.length; i += 2) {
      const bufSize = ctx.sampleRate * 0.08;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < bufSize; j++) data[j] = (Math.random()*2-1);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.10, now + i*dur);
      ng.gain.exponentialRampToValueAtTime(0.001, now + i*dur + 0.08);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 150;
      noise.connect(filter); filter.connect(ng); ng.connect(dest);
      noise.start(now + i*dur); noise.stop(now + i*dur + 0.1);
      BGM.nodes.push(noise);
    }

    BGM.timers.push(setTimeout(playLoop, loopLen * 1000));
  }
  playLoop();
}

// ── 승리 BGM: 밝은 팡파레 (~5초) ──
function bgmVictory(ctx, dest) {
  const notes = [523.25,659.25,783.99, 659.25,783.99,1046.5, 783.99,1046.5,1318.5];
  const dur = 0.35;
  const now = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    g.gain.setValueAtTime(0.2, now + i*dur);
    g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*2);
    osc.connect(g); g.connect(dest);
    osc.start(now + i*dur); osc.stop(now + i*dur + dur*2);
    BGM.nodes.push(osc);
  }
  // 마무리 화음
  const chord = [523.25, 659.25, 783.99];
  for (const freq of chord) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.12, now + notes.length*dur);
    g.gain.exponentialRampToValueAtTime(0.001, now + notes.length*dur + 2);
    osc.connect(g); g.connect(dest);
    osc.start(now + notes.length*dur); osc.stop(now + notes.length*dur + 2);
    BGM.nodes.push(osc);
  }
}

// ── 패배 BGM: 어둡고 슬픈 선율 (~5초) ──
function bgmDefeat(ctx, dest) {
  const notes = [329.63,293.66,261.63,246.94, 220,196,174.61,164.81];
  const dur = 0.45;
  const now = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    g.gain.setValueAtTime(0.15, now + i*dur);
    g.gain.exponentialRampToValueAtTime(0.001, now + i*dur + dur*1.5);
    osc.connect(g); g.connect(dest);
    osc.start(now + i*dur); osc.stop(now + i*dur + dur*1.5);
    BGM.nodes.push(osc);
  }
  // 마이너 화음 마무리
  const chord = [164.81, 196, 233.08];
  for (const freq of chord) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.08, now + notes.length*dur);
    g.gain.exponentialRampToValueAtTime(0.001, now + notes.length*dur + 1.5);
    osc.connect(g); g.connect(dest);
    osc.start(now + notes.length*dur); osc.stop(now + notes.length*dur + 1.5);
    BGM.nodes.push(osc);
  }
}

// ═══════════════════════════════════════════════════════════════
// ── 채팅 ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

(function initChat() {
  const widget = document.getElementById('chat-widget');
  const toggle = document.getElementById('chat-toggle');
  const closeBtn = document.getElementById('chat-close');
  const muteBtn = document.getElementById('chat-mute');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const msgBox = document.getElementById('chat-messages');
  const badge = document.getElementById('chat-badge');
  let unread = 0;

  // 채팅 무음 토글 초기화
  const syncMuteBtn = () => {
    if (!muteBtn) return;
    muteBtn.textContent = chatMuted ? '알림켜기' : '알림끄기';
    muteBtn.title = chatMuted ? '채팅 알림 소리 켜기' : '채팅 알림 소리 끄기';
    muteBtn.classList.toggle('muted', chatMuted);
  };
  syncMuteBtn();
  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatMuted = !chatMuted;
      try { localStorage.setItem('caligo_chat_muted', chatMuted ? '1' : '0'); } catch (e) {}
      syncMuteBtn();
    });
  }

  function isOpen() { return !widget.classList.contains('chat-collapsed'); }

  toggle.addEventListener('click', () => {
    if (isOpen()) {
      widget.classList.add('chat-collapsed');
    } else {
      widget.classList.remove('chat-collapsed');
      unread = 0;
      badge.classList.add('hidden');
      msgBox.scrollTop = msgBox.scrollHeight;
      input.focus();
    }
  });

  closeBtn.addEventListener('click', () => {
    widget.classList.add('chat-collapsed');
  });

  // 현재 선택된 채팅 범위 ('all' or 'team') — 분리된 메시지 컨테이너 사용
  let currentChatScope = 'all';
  const scopeTabs = document.getElementById('chat-scope-tabs');
  const scopeAllBtn = document.getElementById('chat-scope-all');
  const scopeTeamBtn = document.getElementById('chat-scope-team');
  const msgBoxAll = document.getElementById('chat-messages');
  const msgBoxTeam = document.getElementById('chat-messages-team');
  function applyChatScopeView() {
    if (currentChatScope === 'team') {
      msgBoxAll?.classList.add('hidden');
      msgBoxTeam?.classList.remove('hidden');
    } else {
      msgBoxAll?.classList.remove('hidden');
      msgBoxTeam?.classList.add('hidden');
    }
  }
  function showChatScopeTabs() {
    if (scopeTabs) scopeTabs.classList.remove('hidden');
  }
  function hideChatScopeTabs() {
    if (scopeTabs) scopeTabs.classList.add('hidden');
    currentChatScope = 'all';
    applyChatScopeView();
  }
  // 팀전 진입 시 탭 표시 (S.isTeamMode 변경 감지용 간이 polling)
  setInterval(() => {
    if (S.isTeamMode) showChatScopeTabs();
    else hideChatScopeTabs();
  }, 500);
  if (scopeAllBtn) scopeAllBtn.addEventListener('click', () => {
    currentChatScope = 'all';
    scopeAllBtn.classList.add('active'); scopeTeamBtn?.classList.remove('active');
    if (input) input.placeholder = '메시지 입력 (전체)...';
    applyChatScopeView();
  });
  if (scopeTeamBtn) scopeTeamBtn.addEventListener('click', () => {
    if (!S.isTeamMode) {
      showSkillToast('팀전 모드에서만 팀 채팅을 사용할 수 있습니다.', false, undefined, 'event');
      return;
    }
    currentChatScope = 'team';
    scopeTeamBtn.classList.add('active'); scopeAllBtn?.classList.remove('active');
    if (input) input.placeholder = '메시지 입력 (팀)...';
    applyChatScopeView();
  });

  function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    const scope = (S.isTeamMode && currentChatScope === 'team') ? 'team' : 'all';
    socket.emit('chat_msg', { text, scope });
    input.value = '';
    input.focus();
  }

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMsg(); }
  });

  socket.on('chat_msg', ({ sender, text, pIdx, color, isSpectator: senderIsSpec, scope, teamId }) => {
    const myName = document.getElementById('input-name').value;
    const isSelf = (S.isSpectator && pIdx === -1 && sender === myName) ||
                   (!S.isSpectator && pIdx === S.playerIdx);
    const div = document.createElement('div');
    div.className = `chat-msg ${isSelf ? 'mine' : 'other'}`;
    if (scope === 'team') div.classList.add('scope-team');

    // Scope 배지
    let scopeBadge = '';
    if (S.isTeamMode && scope) {
      if (scope === 'team') scopeBadge = '<span class="scope-badge team">팀</span>';
      else scopeBadge = '<span class="scope-badge all">전체</span>';
    }
    // 팀 표시 (BLUE/RED)
    let teamBadge = '';
    if (S.isTeamMode && (teamId === 0 || teamId === 1)) {
      const isBlue = teamId === 0;
      teamBadge = `<span class="scope-badge team-color-badge" style="color:${isBlue ? '#60a5fa' : '#ef4444'};border:1px solid ${isBlue ? '#60a5fa' : '#ef4444'}">${isBlue ? 'B' : 'R'}</span>`;
    }

    const senderLabel = senderIsSpec ? `${escapeHtml(sender)} (관전자)` : escapeHtml(sender);
    const senderColor = isSelf ? '#ffffff' : (color || '#aaa');
    if (!isSelf && color && scope !== 'team') {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      if (!isNaN(r)) {
        div.style.background = `rgba(${r},${g},${b},0.12)`;
        div.style.borderColor = `rgba(${r},${g},${b},0.3)`;
        div.style.color = color;
      }
    }
    div.innerHTML = `${scopeBadge}${teamBadge}<span class="chat-sender" style="color:${senderColor}">${senderLabel}</span>${escapeHtml(text)}`;
    // 팀 채팅과 전체 채팅을 별도 컨테이너에 격리
    const targetBox = (scope === 'team') ? msgBoxTeam : msgBoxAll;
    if (targetBox) {
      targetBox.appendChild(div);
      targetBox.scrollTop = targetBox.scrollHeight;
    }

    if (!isSelf) {
      playSfxChat();
      if (!isOpen()) {
        unread++;
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.classList.remove('hidden');
      }
    }
  });

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();

// ═══════════════════════════════════════════════════════════════
// ── 튜토리얼 ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

let tutStep = 0;

const TUTORIAL_STEPS = [
  // 0: 인트로
  () => `
    <div class="tut-title">📖 CALIGO 튜토리얼</div>
    <div class="tut-subtitle">게임의 기초와 원리를 하나씩 배워봅시다!</div>
    <div class="tut-section">
      <div class="tut-section-title">🎯 게임 목표</div>
      <div class="tut-text">
        CALIGO는 <strong>1대1 전략 보드게임</strong>입니다.<br>
        5×5 격자판 위에서 각자 <strong>3개의 말</strong>을 조종하며,<br>
        <strong>상대의 말을 모두 처치</strong>하면 승리합니다!
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">⚡ 핵심 특징</div>
      <div class="tut-text">
        • 상대 말의 위치가 <strong>보이지 않습니다</strong> — 추리와 예측이 핵심!<br>
        • 각 말은 고유한 <strong>공격 범위, 스킬, 패시브</strong>를 가집니다<br>
        • 30종의 캐릭터 중 3개를 골라 나만의 전략을 세우세요
      </div>
    </div>
    <div class="tut-highlight">💡 이 튜토리얼은 약 2분이면 완료됩니다. 화살표를 눌러 진행하세요!</div>
  `,

  // 1: 보드와 턴
  () => `
    <div class="tut-title">🗺️ 보드와 턴</div>
    <div class="tut-subtitle">5×5 격자판에서 번갈아 행동합니다</div>
    <div class="tut-section">
      <div class="tut-section-title">격자판</div>
      <div class="tut-text">게임은 <strong>5×5 보드</strong> 위에서 진행됩니다. 각 칸에 좌표가 표시됩니다.</div>
      <div class="tut-board-demo">
        ${Array.from({length:25}, (_,i) => {
          const c = i % 5, r = Math.floor(i / 5);
          return `<div class="tut-cell"><span style="font-size:0.5rem;color:var(--muted)">${ROW_LABELS[r]}${c+1}</span></div>`;
        }).join('')}
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">⏱ 턴 구조</div>
      <div class="tut-text">
        매 턴마다 <strong>하나의 행동</strong>을 선택합니다:<br><br>
        🦶 <strong>이동</strong> — 말을 인접한 칸으로 옮기기<br>
        ⚔️ <strong>공격</strong> — 공격 범위 내 적에게 피해 주기<br>
        ✨ <strong>스킬</strong> — SP를 소비해 특수 능력 사용<br>
        ⏭ <strong>턴 넘기기</strong> — 아무 행동도 하지 않기
      </div>
    </div>
    <div class="tut-highlight">💡 일부 스킬은 행동을 소비하지 않아 스킬 + 이동/공격 조합이 가능합니다!</div>
  `,

  // 2: 이동
  () => `
    <div class="tut-title">🦶 이동</div>
    <div class="tut-subtitle">십자 방향으로 1칸씩 이동합니다</div>
    <div class="tut-section">
      <div class="tut-text">말은 <strong>상하좌우 인접 1칸</strong>으로만 이동할 수 있습니다. 대각선 이동은 불가합니다.</div>
      <div class="tut-board-demo">
        ${Array.from({length:25}, (_,i) => {
          const c = i % 5, r = Math.floor(i / 5);
          const isCenter = c === 2 && r === 2;
          const isUp = c === 2 && r === 1;
          const isDown = c === 2 && r === 3;
          const isLeft = r === 2 && c === 1;
          const isRight = r === 2 && c === 3;
          const isMove = isUp || isDown || isLeft || isRight;
          const arrow = isUp ? '↑' : isDown ? '↓' : isLeft ? '←' : isRight ? '→' : '';
          return `<div class="tut-cell ${isCenter ? 'tut-piece' : isMove ? 'tut-move' : ''}">${isCenter ? '🏹' : arrow}</div>`;
        }).join('')}
      </div>
      <div class="tut-text" style="text-align:center;margin-top:6px">
        <span style="color:var(--sp-mine)">■</span> 내 말 &nbsp;
        <span style="color:var(--success)">■</span> 이동 가능 칸
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">⚠ 겹침 규칙</div>
      <div class="tut-text">아군 유닛은 <strong>같은 칸에 있을 수 없습니다.</strong><br>단, <strong>쌍둥이 강도</strong>는 예외로 같은 칸에 위치할 수 있습니다.</div>
    </div>
    <div class="tut-highlight">💡 이동으로 적의 공격 범위를 피하거나, 유리한 위치를 선점하세요!</div>
  `,

  // 3: 공격 범위
  () => `
    <div class="tut-title">⚔️ 공격</div>
    <div class="tut-subtitle">각 말마다 고유한 공격 범위가 있습니다</div>
    <div class="tut-section">
      <div class="tut-text">공격 시 말의 <strong>공격 범위 내 모든 칸</strong>에 동시에 피해를 줍니다. 적이 있는 칸에 명중하면 HP가 깎입니다.</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">공격 범위 예시</div>
      <div class="tut-grid-row">
        <div class="tut-char-card">
          <span class="tut-char-icon">🔱</span>
          <div class="tut-char-name">창병</div>
          <div class="tut-char-sub">세로줄 전체</div>
          ${buildMiniRangeGrid('spearman', {}, '🔱')}
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🐎</span>
          <div class="tut-char-name">기마병</div>
          <div class="tut-char-sub">가로줄 전체</div>
          ${buildMiniRangeGrid('cavalry', {}, '🐎')}
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🎖</span>
          <div class="tut-char-name">장군</div>
          <div class="tut-char-sub">자신 포함 십자 5칸</div>
          ${buildMiniRangeGrid('general', {}, '🎖')}
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🗡</span>
          <div class="tut-char-name">그림자 암살자</div>
          <div class="tut-char-sub">주변 9칸 중 1칸 선택</div>
          ${buildMiniRangeGrid('shadowAssassin', {}, '🗡')}
        </div>
      </div>
    </div>
    <div class="tut-highlight">
      💡 <span style="color:#e2a84b">■</span> 금색 = 공격 범위 &nbsp;
      <span style="color:#648cff">■</span> 파란색 = 내 말 위치<br>
      상대 위치를 모르므로, 넓은 범위 공격은 명중 확률이 높습니다!
    </div>
  `,

  // 4: HP와 ATK
  () => `
    <div class="tut-title">❤️ HP와 ATK</div>
    <div class="tut-subtitle">체력과 공격력의 이해</div>
    <div class="tut-section">
      <div class="tut-section-title">❤️ HP (체력)</div>
      <div class="tut-text">
        게임 시작 시 총 <strong>10 HP</strong>를 3개의 말에 자유롭게 배분합니다 (최소 1, 최대 8).<br>
        HP가 0이 되면 그 말은 <strong>탈락</strong>합니다.
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">⚔️ ATK (공격력)</div>
      <div class="tut-text">
        공격이 명중하면 <strong>ATK만큼 피해</strong>를 줍니다.<br><br>
        • <strong>1티어:</strong> ATK 0.5 ~ 1 (견제·정찰용)<br>
        • <strong>2티어:</strong> ATK 1 ~ 2 (주력 전투 유닛)<br>
        • <strong>3티어:</strong> ATK 1 ~ 3 (강력하지만 고유한 제약)
      </div>
    </div>
    <div class="tut-highlight">💡 HP 배분이 핵심 전략! 핵심 유닛에 HP를 몰아줄지, 균등하게 분산할지 선택하세요.</div>
  `,

  // 5: 티어 시스템
  () => `
    <div class="tut-title">🏆 티어 시스템</div>
    <div class="tut-subtitle">1티어 · 2티어 · 3티어에서 각 1명씩 선택합니다</div>
    <div class="tut-section">
      <div class="tut-section-title">🥉 1티어 — 정찰과 견제</div>
      <div class="tut-text">넓은 범위나 유틸리티 스킬이 특징. 공격력은 낮지만 정보 수집과 견제에 특화.</div>
      <div class="tut-grid-row">
        <div class="tut-char-card">
          <span class="tut-char-icon">🏹</span>
          <div class="tut-char-name">궁수</div>
          <div class="tut-char-sub">대각선 전체 공격. 더불어 공격 방향 전환 가능.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🔭</span>
          <div class="tut-char-name">척후병</div>
          <div class="tut-char-sub">적 위치를 알아내는 정찰.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">💣</span>
          <div class="tut-char-name">화약상</div>
          <div class="tut-char-sub">폭탄 설치로 맵을 견제.</div>
        </div>
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">🥈 2티어 — 전략적 전투</div>
      <div class="tut-text">강력한 스킬과 적절한 전투력. 팀의 핵심 전력.</div>
      <div class="tut-grid-row">
        <div class="tut-char-card">
          <span class="tut-char-icon">🗡</span>
          <div class="tut-char-name">그림자 암살자</div>
          <div class="tut-char-sub">은신 스킬을 활용한 교란.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">⚔</span>
          <div class="tut-char-name">양손 검객</div>
          <div class="tut-char-sub">쌍검무로 2회 공격.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🧹</span>
          <div class="tut-char-name">마녀</div>
          <div class="tut-char-sub">저주로 상대 핵심 유닛의 스킬을 막고 턴당 0.5 피해 부여.</div>
        </div>
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">🥇 3티어 — 핵심 전력</div>
      <div class="tut-text">극강의 능력치와 독보적인 스킬. 하지만 제약도 큽니다.</div>
      <div class="tut-grid-row">
        <div class="tut-char-card">
          <span class="tut-char-icon">🐉</span>
          <div class="tut-char-name">드래곤 조련사</div>
          <div class="tut-char-sub">드래곤 유닛 소환. 대량의 SP 필요.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🙏</span>
          <div class="tut-char-name">수도승</div>
          <div class="tut-char-sub">힐링과 상태이상 제거에 능통. 약한 공격 능력.</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🪓</span>
          <div class="tut-char-name">학살 영웅</div>
          <div class="tut-char-sub">최대규모의 범위 공격. 아군도 피해를 보는 양날의 검.</div>
        </div>
      </div>
    </div>
  `,

  // 6: 스킬 시스템
  () => `
    <div class="tut-title">✨ 스킬 시스템</div>
    <div class="tut-subtitle">SP를 소비해 특수 능력을 사용합니다</div>
    <div class="tut-section">
      <div class="tut-section-title">💎 SP (스킬 포인트)</div>
      <div class="tut-text">
        • 양 팀이 <strong>공유하는 SP 풀</strong>에서 소비합니다<br>
        • 시작 시 각자 <strong>1 SP</strong> 보유<br>
        • 최대 <strong>10 SP</strong>까지 보유 가능 (풀 한도 10)
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">📅 SP 추가 지급</div>
      <div class="tut-text">
        <strong>10턴마다</strong> 양 팀 모두에게 <strong>+1 SP</strong>가 지급됩니다.<br>
        게임 중 화면 상단에 <strong>"다음 SP 지급까지 X턴"</strong>이 표시됩니다.
      </div>
      <div style="margin:10px 0; text-align:center">
        <table style="margin:0 auto;border-collapse:collapse;font-size:0.78rem">
          <tr style="color:var(--accent)">
            <th style="padding:4px 12px;border-bottom:1px solid var(--border)">턴</th>
            <th style="padding:4px 12px;border-bottom:1px solid var(--border)">이벤트</th>
            <th style="padding:4px 12px;border-bottom:1px solid var(--border)">누적 SP</th>
          </tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">1턴</td><td style="padding:4px 12px">게임 시작</td><td style="padding:4px 12px">각 1</td></tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">10턴</td><td style="padding:4px 12px;color:var(--success)">+1 SP 지급</td><td style="padding:4px 12px">각 2</td></tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">20턴</td><td style="padding:4px 12px;color:var(--success)">+1 SP 지급</td><td style="padding:4px 12px">각 3</td></tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">30턴</td><td style="padding:4px 12px;color:var(--success)">+1 SP 지급</td><td style="padding:4px 12px">각 4</td></tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">40턴</td><td style="padding:4px 12px;color:var(--success)">+1 SP 지급</td><td style="padding:4px 12px">각 5</td></tr>
          <tr><td style="padding:4px 12px;color:var(--text-dim)">50턴</td><td style="padding:4px 12px;color:var(--danger)">SP 지급 중단</td><td style="padding:4px 12px">최대 각 10</td></tr>
        </table>
      </div>
      <div class="tut-text" style="color:var(--muted);font-size:0.75rem">
        ※ 마법사의 패시브 <strong>인스턴트 매직</strong>으로 얻는 SP는 별도의 1회용 SP입니다.
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">🏷️ 스킬 유형 — 3가지</div>
      <div class="tut-text" style="margin-bottom:10px">스킬은 세 가지 유형으로 분류됩니다:</div>
      <div style="margin-bottom:10px">
        <span class="tut-tag-demo tut-tag-action">행동소비형</span><br>
        <span class="tut-text">사용하면 그 턴의 <strong>행동을 소비</strong>합니다. 이동이나 공격 불가.</span><br>
        <span class="tut-text" style="color:var(--muted)">예: 쌍둥이·분신, 마녀·저주, 인간사냥꾼·덫 설치</span>
      </div>
      <div style="margin-bottom:10px">
        <span class="tut-tag-demo tut-tag-once">자유시전·1회</span><br>
        <span class="tut-text">행동을 소비하지 않지만, <strong>턴당 1회</strong>만 사용 가능.</span><br>
        <span class="tut-text" style="color:var(--muted)">예: 궁수·정비, 양손검객·쌍검무, 전령·질주</span>
      </div>
      <div>
        <span class="tut-tag-demo tut-tag-free">자유시전형</span><br>
        <span class="tut-text">행동 소비 없이 <strong>SP만 있으면 무제한</strong> 사용 가능.</span><br>
        <span class="tut-text" style="color:var(--muted)">예: 척후병·정찰, 약초전문가·약초학, 국왕·절대복종 반지</span>
      </div>
    </div>
    <div class="tut-highlight">💡 자유시전 스킬은 이동/공격과 함께 사용 가능해서 한 턴에 여러 행동이 가능합니다!</div>
  `,

  // 7: 패시브
  () => `
    <div class="tut-title">🛡️ 패시브 능력</div>
    <div class="tut-subtitle">SP 소비 없이 자동으로 발동되는 고유 능력</div>
    <div class="tut-section">
      <div class="tut-text">일부 캐릭터는 <strong>패시브</strong>를 보유합니다. 별도 조작 없이 조건만 맞으면 자동 발동됩니다.</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title" style="color:#f59e0b">⭐ 패시브 예시</div>
      <div class="tut-grid-row">
        <div class="tut-char-card">
          <span class="tut-char-icon">🛡</span>
          <div class="tut-char-name">갑주무사</div>
          <div class="tut-char-sub" style="color:#f59e0b">아이언 스킨</div>
          <div class="tut-char-sub">공격 피해 0.5 감소</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">📋</span>
          <div class="tut-char-name">지휘관</div>
          <div class="tut-char-sub" style="color:#f59e0b">사기증진</div>
          <div class="tut-char-sub">인접 아군의 공격력 1 증가</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">🧙</span>
          <div class="tut-char-name">마법사</div>
          <div class="tut-char-sub" style="color:#f59e0b">인스턴트 매직</div>
          <div class="tut-char-sub">피격 시 1회용 SP 제공</div>
        </div>
        <div class="tut-char-card">
          <span class="tut-char-icon">⛓</span>
          <div class="tut-char-name">고문 기술자</div>
          <div class="tut-char-sub" style="color:#f59e0b">표식</div>
          <div class="tut-char-sub">표식 상태의 적의 위치 공개</div>
        </div>
      </div>
    </div>
    <div class="tut-highlight">💡 패시브는 보이지 않는 곳에서 큰 차이를 만듭니다. 캐릭터 선택 시 패시브도 꼭 확인하세요!</div>
  `,

  // 8: 태그 시스템
  () => `
    <div class="tut-title">🏰 태그 시스템</div>
    <div class="tut-subtitle">왕실과 악인 — 태그 간 시너지가 존재합니다</div>
    <div class="tut-section">
      <div class="tut-section-title">${tagBadgeHtml('royal')} 왕실 태그</div>
      <div class="tut-text">
        왕실 유닛들은 서로 연계된 능력으로 시너지가 좋습니다.
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">${tagBadgeHtml('villain')} 악인 태그</div>
      <div class="tut-text">
        마녀, 쥐 장수, 그림자 암살자 등 변칙 계열의 유닛들이 다수 포진되어 있습니다.
      </div>
    </div>
    <div class="tut-highlight">💡 수도승 vs 악인은 치명적! 태그 조합을 고려해 전략을 짜세요.</div>
  `,

  // 9: 게임 흐름
  () => `
    <div class="tut-title">🎮 게임 흐름</div>
    <div class="tut-subtitle">로비부터 승리까지의 전체 과정</div>
    <div class="tut-section">
      <div class="tut-section-title">1️⃣ 덱 구성 (로비)</div>
      <div class="tut-text">로비에서 <strong>1티어 · 2티어 · 3티어 각 1명씩 총 3명</strong>으로 덱을 구성합니다.</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">2️⃣ 초기 공개</div>
      <div class="tut-text">양측이 선택한 캐릭터를 <strong>서로 공개</strong>합니다. 상대의 구성을 확인하세요!</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">3️⃣ 교환 드래프트</div>
      <div class="tut-text">상대의 구성을 본 뒤, 내 덱에서 <strong>1명까지 교체</strong>할 수 있습니다. 같은 티어의 다른 캐릭터로 바꿔 전략을 조정하세요.</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">4️⃣ 최종 공개</div>
      <div class="tut-text">교환 결과가 <strong>동시에 공개</strong>됩니다. 교체된 캐릭터는 깜빡이며 변환됩니다!</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">5️⃣ HP 분배</div>
      <div class="tut-text">총 <strong>10 HP</strong>를 3개의 말에 자유롭게 분배합니다 (최소 1, 최대 8).</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">6️⃣ 말 배치</div>
      <div class="tut-text"><strong>5×5 보드에 3개의 말을 비밀리에 배치</strong>합니다. 상대는 어디에 놓았는지 모릅니다.</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">7️⃣ 전투</div>
      <div class="tut-text">번갈아 턴을 진행하며 <strong>이동, 공격, 스킬</strong>을 사용합니다. 상대 말을 전멸시키면 승리!</div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title" style="color:var(--danger)">⚠️ 보드 축소 이벤트</div>
      <div class="tut-text">
        장기전을 방지하기 위해, 일정 턴이 지나면 <strong>보드가 축소</strong>됩니다.
      </div>
      <div style="margin:10px 0; text-align:center">
        <table style="margin:0 auto;border-collapse:collapse;font-size:0.78rem">
          <tr style="color:var(--danger)">
            <th style="padding:4px 14px;border-bottom:1px solid var(--border)">턴</th>
            <th style="padding:4px 14px;border-bottom:1px solid var(--border)">이벤트</th>
          </tr>
          <tr><td style="padding:4px 14px;color:var(--text-dim)">40턴</td><td style="padding:4px 14px">⚠️ <strong>경고 표시</strong> — "10턴 후 보드가 축소됩니다!"</td></tr>
          <tr><td style="padding:4px 14px;color:var(--text-dim)">50턴</td><td style="padding:4px 14px">💥 <strong>테두리 파괴</strong> — 5×5 → 3×3으로 축소</td></tr>
          <tr><td style="padding:4px 14px;color:var(--text-dim)">대치 시</td><td style="padding:4px 14px"><strong>1대1 대치 상황</strong> — 양쪽 모두 1유닛만 남으면 5턴 후 보드가 축소됩니다.</td></tr>
        </table>
      </div>
      <div class="tut-text" style="display:flex;gap:16px;justify-content:center;align-items:center;margin:10px 0">
        <div style="text-align:center">
          <div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px">50턴 이전</div>
          <div class="tut-board-demo" style="width:120px">
            ${Array.from({length:25}, (_,i) => {
              const c = i % 5, r = Math.floor(i / 5);
              const isEdge = c === 0 || c === 4 || r === 0 || r === 4;
              return `<div class="tut-cell" style="${isEdge ? 'background:rgba(220,80,80,0.15);border-color:rgba(220,80,80,0.3)' : ''}">${isEdge ? '⚠' : ''}</div>`;
            }).join('')}
          </div>
        </div>
        <div style="font-size:1.2rem;color:var(--danger)">→</div>
        <div style="text-align:center">
          <div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px">50턴 이후</div>
          <div class="tut-board-demo" style="width:120px">
            ${Array.from({length:25}, (_,i) => {
              const c = i % 5, r = Math.floor(i / 5);
              const isEdge = c === 0 || c === 4 || r === 0 || r === 4;
              const isInner = c >= 1 && c <= 3 && r >= 1 && r <= 3;
              return `<div class="tut-cell" style="${isEdge ? 'background:rgba(220,80,80,0.3);border-color:transparent;opacity:0.3' : ''}"></div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="tut-text" style="color:var(--danger);font-size:0.78rem;text-align:center">
        💀 축소 시 테두리에 있던 말은 <strong>즉사</strong>합니다! 미리 안쪽으로 대피하세요.
      </div>
    </div>
  `,

  // 10: 실전 팁 + 마무리
  () => `
    <div class="tut-title">🎓 실전 팁</div>
    <div class="tut-subtitle">승리를 위한 핵심 전략들</div>
    <div class="tut-section">
      <div class="tut-section-title">🧠 추리하기</div>
      <div class="tut-text">
        공격의 명중/빗나감 결과로 적 위치를 <strong>추리</strong>하세요.<br>
        척후병의 정찰, 고문 기술자의 표식 등으로 정보를 수집하면 유리합니다.
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">📐 배치 전략</div>
      <div class="tut-text">
        • 공격 범위가 <strong>겹치는 위치</strong>에 배치하면 효율적<br>
        • 지휘관·약초전문가 등 <strong>서포터는 아군 가까이</strong> 배치<br>
        • 너무 모이면 범위 공격에 한꺼번에 당할 수 있으니 주의
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">⚡ SP 관리</div>
      <div class="tut-text">
        SP는 양 팀 <strong>공유 자원</strong>입니다. 아낄수록 나중에 강력한 스킬을 쓸 수 있지만,<br>
        타이밍을 놓치면 의미가 없습니다. <strong>적절한 순간에 과감하게!</strong>
      </div>
    </div>
    <div class="tut-section">
      <div class="tut-section-title">🎯 시너지 조합</div>
      <div class="tut-text">
        • <strong>고문 기술자 + 넓은 범위 공격</strong> → 표식으로 위치 파악 후 집중 공격<br>
        • <strong>지휘관 + 근접 딜러</strong> → ATK 버프로 화력 극대화<br>
        • <strong>약초전문가 + 탱커</strong> → 지속 회복으로 전선 유지
      </div>
    </div>
    <div class="tut-highlight" style="text-align:center;font-size:1rem">
      🎮 준비가 되셨나요?<br>
      <strong>AI 연습 모드</strong>로 직접 체험해보세요!
    </div>
  `,
];

function openTutorial() {
  tutStep = 0;
  showScreen('screen-tutorial');
  renderTutorial();
}

function renderTutorial() {
  const content = document.getElementById('tutorial-content');
  content.innerHTML = TUTORIAL_STEPS[tutStep]();
  // re-trigger animation
  content.style.animation = 'none';
  content.offsetHeight;
  content.style.animation = '';

  // progress dots
  const prog = document.getElementById('tutorial-progress');
  prog.innerHTML = TUTORIAL_STEPS.map((_, i) =>
    `<div class="tut-dot ${i < tutStep ? 'done' : ''} ${i === tutStep ? 'active' : ''}"></div>`
  ).join('');

  // step label
  document.getElementById('tutorial-step-label').textContent = `${tutStep + 1} / ${TUTORIAL_STEPS.length}`;

  // nav buttons
  document.getElementById('btn-tut-prev').style.visibility = tutStep === 0 ? 'hidden' : 'visible';
  const nextBtn = document.getElementById('btn-tut-next');
  if (tutStep === TUTORIAL_STEPS.length - 1) {
    nextBtn.textContent = '🎮 게임 시작!';
    nextBtn.className = 'btn btn-secondary';
  } else {
    nextBtn.textContent = '다음 →';
    nextBtn.className = 'btn btn-primary';
  }
}

document.getElementById('btn-tutorial').addEventListener('click', openTutorial);
document.getElementById('btn-tutorial-back').addEventListener('click', () => showScreen('screen-lobby'));
document.getElementById('btn-tut-prev').addEventListener('click', () => {
  if (tutStep > 0) { tutStep--; renderTutorial(); }
});
document.getElementById('btn-tut-next').addEventListener('click', () => {
  if (tutStep < TUTORIAL_STEPS.length - 1) {
    tutStep++;
    renderTutorial();
  } else {
    // 마지막 페이지 → 로비로 돌아가기
    showScreen('screen-lobby');
  }
});

// ═══════════════════════════════════════════════════════════════
// ── 캐릭터 사전 (게임 중 열람) — '내 덱' 메뉴 슬라이드 동일 구성
// ═══════════════════════════════════════════════════════════════
(function setupCharacterDictionary() {
  const overlay = document.getElementById('char-dict-overlay');
  const btnOpen = document.getElementById('btn-char-dict');
  const btnClose = document.getElementById('char-dict-close');
  if (!overlay || !btnOpen) return;

  let dictTier = 1;
  let dictIdx = 0;
  let dictPreviewMode = 'attack';

  function getChars(tier) {
    return (S.characters || S.specCharacters || {})[tier] || [];
  }

  // dict-preview-board 5x5 그리드 빌드 (한 번만) — 드래프트 미리보기와 동일 사이즈
  function ensureDictBoard() {
    const board = document.getElementById('dict-preview-board');
    if (!board || board.dataset.built === '1') return;
    const totalSize = 5;
    const cellPx = 56;
    board.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(${totalSize}, ${cellPx}px)`;
    board.style.gridTemplateRows = `repeat(${totalSize}, ${cellPx}px)`;
    for (let r = 0; r < totalSize; r++) {
      for (let cc = 0; cc < totalSize; cc++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.col = cc;
        cell.dataset.row = r;
        board.appendChild(cell);
      }
    }
    board.dataset.built = '1';
  }

  // 미리보기 보드 갱신 — 단일 구현(updateDraftPreview)에 위임.
  //   이전에는 별도 복제 함수로 인해 쌍둥이 강도 분리 배치/색 분기/joinedTwins 색 분리가
  //   드래프트(=내 덱) 슬라이드와 일치하지 않았음. 이제 한 함수로 통합되어 모든 변경이 자동 동기화됨.
  function updateDictPreview(charData) {
    updateDraftPreview(charData, {
      boardEl: document.getElementById('dict-preview-board'),
      infoEl: document.getElementById('dict-preview-info'),
      tabsRoot: overlay,
      tabAttr: 'dict-mode',
      mode: dictPreviewMode,
    });
  }

  function renderDictSlide() {
    const chars = getChars(dictTier);
    if (chars.length === 0) return;
    if (dictIdx < 0) dictIdx = chars.length - 1;
    if (dictIdx >= chars.length) dictIdx = 0;
    const c = chars[dictIdx];
    dictPreviewMode = 'attack';

    // 공유 헬퍼 — 드래프트(=내 덱) 슬라이드와 동일 콘텐츠 렌더
    populateSlideContent(c, 'dict-slide');

    ensureDictBoard();
    updateDictPreview(c);

    // 아이콘 인덱스 활성 상태
    overlay.querySelectorAll('#dict-icon-index .icon-index-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === dictIdx);
    });
    // 스텝 인디케이터 활성/완료 상태
    overlay.querySelectorAll('#dict-step-indicator .dict-bookmark').forEach(el => {
      const tier = Number(el.dataset.tier);
      el.classList.toggle('active', tier === dictTier);
    });
  }

  function buildIconIndex() {
    const chars = getChars(dictTier);
    const wrap = document.getElementById('dict-icon-index');
    if (!wrap) return;
    const DARK_ICONS = new Set(['👁','🎖','🗡','🛡','⚔','⚒','♛','⛓']);
    wrap.innerHTML = '';
    chars.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'icon-index-btn';
      btn.title = c.name;
      const darkCls = DARK_ICONS.has(c.icon) ? ' dark-icon' : '';
      btn.innerHTML = `<span class="icon-index-emoji${darkCls}">${c.icon}</span>`;
      btn.addEventListener('click', () => { dictIdx = i; renderDictSlide(); });
      wrap.appendChild(btn);
    });
  }

  function setTier(tier) {
    if (!getChars(tier).length) return;
    dictTier = tier;
    dictIdx = 0;
    buildIconIndex();
    renderDictSlide();
  }

  function openDict() {
    if (!getChars(dictTier).length) {
      // 캐릭터 데이터가 아직 없으면 1티어부터 다시 시도 — 게임 시작 후 항상 채워짐
      dictTier = 1;
    }
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    buildIconIndex();
    renderDictSlide();
  }
  function closeDict() {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  btnOpen.addEventListener('click', openDict);
  if (btnClose) btnClose.addEventListener('click', closeDict);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDict(); });

  // 화살표
  const prevBtn = document.getElementById('dict-slide-prev');
  const nextBtn = document.getElementById('dict-slide-next');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    const chars = getChars(dictTier);
    if (chars.length === 0) return;
    dictIdx = ((dictIdx - 1) % chars.length + chars.length) % chars.length;
    renderDictSlide();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const chars = getChars(dictTier);
    if (chars.length === 0) return;
    dictIdx = (dictIdx + 1) % chars.length;
    renderDictSlide();
  });

  // 티어 탭
  overlay.querySelectorAll('#dict-step-indicator .dict-bookmark').forEach(el => {
    el.addEventListener('click', () => {
      const tier = Number(el.dataset.tier);
      if (tier) setTier(tier);
    });
  });

  // 공격범위 / 스킬 미리보기 탭
  overlay.querySelectorAll('.slide-preview-tab[data-dict-mode]').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      dictPreviewMode = t.dataset.dictMode;
      const chars = getChars(dictTier);
      if (chars[dictIdx]) updateDictPreview(chars[dictIdx]);
    });
  });

  // ESC 로 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeDict();
  });
})();
