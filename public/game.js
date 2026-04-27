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
    showSkillToast('🔌 재접속 완료!', false, undefined, 'event');
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
  const suffix = mine ? '격파됨.' : '격파함.';
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
  if (!isActiveGamePhase()) return;
  startClientTimer(seconds);
});

socket.on('turn_timeout', () => {
  if (!isActiveGamePhase()) return;
  addLog('⏰ 시간 초과!', 'system');
  showSkillToast('⏰ 시간 초과!', false, undefined, 'event');
});

socket.on('placement_timeout', () => {
  if (!isActiveGamePhase()) return;
  showSkillToast('⏰ 시간 초과! 미배치 말이 랜덤 배치됩니다.', false, undefined, 'event');
});

// ── 화면 전환 ─────────────────────────────────────────────────
function showScreen(id) {
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
    if (d && typeof d === 'object') return { t1: d.t1 || null, t2: d.t2 || null, t3: d.t3 || null };
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
    showSkillToast(`방 코드 [${roomId}] 생성됨. 팀원과 공유하세요.`, false, undefined, 'event');
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

socket.on('waiting_room_list', (list) => {
  const container = document.getElementById('spectate-room-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="muted">현재 입장 가능한 방이 없습니다.</p>';
    return;
  }
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

socket.on('room_list', (list) => {
  const container = document.getElementById('spectate-room-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="muted">현재 진행 중인 방이 없습니다.</p>';
    return;
  }
  const phaseNames = { draft: '드래프트', hp_distribution: 'HP 분배', reveal: '캐릭터 공개', placement: '배치', game: '전투 중' };
  container.innerHTML = list.map(r => `
    <div class="spectate-room-item" data-room="${r.roomId}">
      <div class="spectate-room-players">${escapeHtmlGlobal(r.p0Name)} <span class="spectate-vs">vs</span> ${escapeHtmlGlobal(r.p1Name)}</div>
      <div class="spectate-room-meta">
        <span class="spectate-phase">${phaseNames[r.phase] || r.phase}</span>
        ${r.turnNumber > 0 ? `<span class="spectate-turn">턴 ${r.turnNumber}</span>` : ''}
        <span class="spectate-viewers">👁 ${r.spectators}</span>
      </div>
    </div>
  `).join('');
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
    showSkillToast('🔌 재접속 완료!', false, undefined, 'event');
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
  if (codeEl) codeEl.textContent = `방 코드: ${roomId}`;
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
  showSkillToast('게임 시작. 드래프트 준비 중.', false, undefined, 'event');
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
  if (S.teamDraftMode) { renderSlide(); renderTeamDraftSlots(); }
});

socket.on('team_draft_confirmed', ({ pick1, pick2 }) => {
  S.teamDraft = { pick1, pick2 };
  S.teamDraftConfirmed = true;
  document.getElementById('btn-draft-confirm').disabled = true;
  document.getElementById('btn-draft-select').disabled = true;
  showSkillToast('선택 확정. 다른 플레이어를 기다리는 중.', false, undefined, 'event');
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
        return `<div class="draft-slot filled teammate-slot">
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
      <h4 class="teammate-slots-title">🤝 ${escapeHtmlGlobal(tmName)}의 선택</h4>
      ${renderTmSlot(S.teamTeammatePicks?.pick1, '1번')}
      ${renderTmSlot(S.teamTeammatePicks?.pick2, '2번')}
    `;
  }
}

socket.on('team_draft_status', ({ draftDone, doneNames }) => {
  const statusEl = document.getElementById('team-draft-status');
  if (statusEl) {
    const doneCount = (draftDone || []).filter(d => d).length;
    statusEl.textContent = `확정 ${doneCount}/4${doneNames && doneNames.length ? ` — ${doneNames.join(', ')}` : ''}`;
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
    confirmBtn.textContent = S.teamDraftConfirmed ? '✅ 확정됨' : `선택 확정 (${pickCount}/2)`;
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
  const labels = ['1번 캐릭터', '2번 캐릭터'];
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
        <span>${labels[i]}</span>
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
  const total = hps.reduce((a, b) => a + b, 0);
  // 내 HP 레이아웃과 동일한 행 구조 — +/- 버튼만 생략
  const types = [S.teamTeammateDraft.pick1, S.teamTeammateDraft.pick2];
  const labels = ['1번 캐릭터', '2번 캐릭터'];
  const rows = types.map((t, i) => {
    const c = findChar(t);
    if (!c) return '';
    const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
    return `<div class="hp-piece-row hp-piece-row-readonly">
      <span class="char-icon">${c.icon}</span>
      <div class="hp-piece-label">
        <strong>${c.name}${tagHtml}</strong>
        <span>${labels[i]}</span>
      </div>
      <div class="hp-input-group hp-input-readonly">
        <span class="hp-value">${hps[i]}</span>
      </div>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <h4 class="teammate-hp-title">${escapeHtmlGlobal(tm.name)}</h4>
    <div class="hp-piece-rows">${rows}</div>
    <div class="hp-total-bar teammate-total-bar">총합 <span>${total}</span> / 10</div>
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
    const doneCount = (hpDone || []).filter(d => d).length;
    statusEl.textContent = `확정 ${doneCount}/4${doneNames && doneNames.length ? ` — ${doneNames.join(', ')}` : ''}`;
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
  const pieceCard = (p) => `<div class="reveal-piece">
    <div class="reveal-piece-icon">${p.icon || ''}</div>
    <div class="reveal-piece-name">${escapeHtmlGlobal(p.name || p.type)}</div>
    <div class="reveal-piece-hp">HP ${p.hp}/${p.maxHp}</div>
  </div>`;
  const playerCard = (pl) => {
    const piecesHtml = (pl.pieces || []).map(pieceCard).join('');
    return `<div class="reveal-player-block">
      <h4>${escapeHtmlGlobal(pl.name)}${pl.idx === S.playerIdx ? ' (나)' : ''}</h4>
      <div class="reveal-pieces-row">${piecesHtml}</div>
    </div>`;
  };
  aChars.innerHTML = allPlayerPieces.filter(p => p.teamId === 0).map(playerCard).join('');
  bChars.innerHTML = allPlayerPieces.filter(p => p.teamId === 1).map(playerCard).join('');
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
  placementSelected = null;
  updatePlacementUI();
});

socket.on('team_confirm_placement_ok', () => {
  S.teamPlacementConfirmed = true;
  document.getElementById('btn-placement-confirm').disabled = true;
  document.getElementById('btn-placement-confirm').textContent = '✅ 확정됨';
  showSkillToast('배치 확정! 다른 플레이어를 기다리는 중...', false, undefined, 'event');
});

socket.on('team_placement_status', ({ placementDone, doneNames }) => {
  // 하단에 상태 표시 (btn 근처)
  let statusEl = document.getElementById('team-placement-status-bar');
  if (!statusEl) {
    const panel = document.querySelector('#screen-placement .placement-board-wrap');
    if (panel) {
      statusEl = document.createElement('div');
      statusEl.id = 'team-placement-status-bar';
      statusEl.className = 'muted';
      statusEl.style = 'font-size:0.78rem;text-align:center;margin-top:8px';
      panel.appendChild(statusEl);
    }
  }
  if (statusEl) {
    const doneCount = (placementDone || []).filter(d => d).length;
    statusEl.textContent = `확정 ${doneCount}/4${doneNames && doneNames.length ? ` — ${doneNames.join(', ')}` : ''}`;
  }
});

function renderTeamPlacement() {
  const titleEl = document.getElementById('team-placement-title');
  if (titleEl) {
    const teamLabel = S.teamId === 0 ? 'A팀' : 'B팀';
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
  applyTeamGameState(state);
  if (typeof buildGameUI === 'function') {
    try { buildGameUI(); } catch (e) {}
  }
  showScreen('screen-game');
  renderTeamGameSnapshot();
  showActionBar(S.isMyTurn);
  if (S.isMyTurn) try { playTurnBell(); } catch (e) {}
  // 팀전 시작 애니메이션
  playGameStartAnimation(S.isMyTurn);
});

socket.on('team_game_update', (state) => {
  const wasMyTurn = S.isMyTurn;
  applyTeamGameState(state);
  // 내 턴 새로 들어왔을 때 — 1v1의 your_turn처럼 액션 플래그 전체 리셋
  // (이거 없으면 2라운드 이후 이동/공격 버튼이 계속 막힘)
  if (S.isMyTurn && !wasMyTurn) {
    S.action = null;
    S.selectedPiece = null;
    S.targetSelectMode = false;
    S.actionDone = false;
    S.moveDone = false;
    S.actionUsedSkillReplace = false;
    S.twinMovePending = false;
    S.twinMovedSub = null;
    S.skillsUsedThisTurn = [];
    S.lastActionType = null;
    S.lastActionPieceType = null;
    try { playTurnBell(); } catch (e) {}
  }
  renderTeamGameSnapshot();
  showActionBar(S.isMyTurn);
  if (state.extra_msg) showSkillToast(state.extra_msg, false, undefined, 'event');
});

socket.on('team_skill_notice', ({ casterIdx, casterName, casterTeamId, skillUsed, msg }) => {
  const myTeam = casterTeamId === S.teamId;
  const label = skillUsed?.skillName ? `${skillUsed.skillName}` : '스킬';
  const icon = skillUsed?.icon || '✨';
  const txt = `${icon} ${casterName} — ${label}${msg ? ` (${msg})` : ''}`;
  showSkillToast(txt, !myTeam, casterIdx, 'skill');
  addLog(txt, 'skill');
});

socket.on('team_game_over', ({ win, winnerTeamId, winners, losers, reason }) => {
  stopClientTimer();
  const inGame = _isInGameScreen();
  const delay = inGame ? 1000 : 0;
  setTimeout(() => {
    _showGameOverScreen(!inGame);
    const iconEl = document.getElementById('gameover-icon');
    const titleEl = document.getElementById('gameover-title');
    const subEl = document.getElementById('gameover-sub');
    if (iconEl) iconEl.textContent = win ? '🏆' : '💀';
    if (titleEl) {
      titleEl.textContent = win ? '팀 승리!' : '팀 패배';
      titleEl.style.color = win ? 'var(--accent)' : 'var(--danger)';
    }
    if (subEl) {
      const winStr = (winners || []).join(', ');
      const loseStr = (losers || []).join(', ');
      subEl.innerHTML = `승리팀: <strong>${escapeHtmlGlobal(winStr)}</strong><br>패배팀: ${escapeHtmlGlobal(loseStr)}<br><span class="muted">${reason || ''}</span>`;
    }
  }, 200);
});

// 팀전 게임 화면 렌더 — 4인 프로필 + 턴 표시 (턴 배너는 updateTurnBanner가 통일)
function renderTeamGameSnapshot() {
  try {
    if (typeof renderGameBoard === 'function') renderGameBoard();
    renderTeamProfiles();  // 1v1의 renderMyPieces/renderOppPieces 대체
    if (typeof updateSPBar === 'function') updateSPBar();
    updateTurnBanner();  // 1v1과 통일된 턴 배너 + 팀전 턴 오더 도트
  } catch (e) {
    console.error('[team render] error:', e);
  }
}

// 팀전 프로필 렌더 — 내팀(나+팀원)은 왼쪽, 상대팀은 오른쪽
function renderTeamProfiles() {
  const myContainer = document.getElementById('my-pieces-info');
  const oppContainer = document.getElementById('opp-pieces-info');
  if (!myContainer || !oppContainer) return;

  const players = S.teamGamePlayers || [];
  const myTeam = S.teamId;

  // 내팀 = 나 + 팀원 (나 먼저)
  const myTeamPlayers = players
    .filter(p => p.teamId === myTeam)
    .sort((a, b) => (a.idx === S.playerIdx ? -1 : b.idx === S.playerIdx ? 1 : 0));
  const enemyPlayers = players.filter(p => p.teamId !== myTeam);

  myContainer.innerHTML = myTeamPlayers.map(pl => renderTeamPlayerBlock(pl, true)).join('');
  oppContainer.innerHTML = enemyPlayers.map(pl => renderTeamPlayerBlock(pl, false)).join('');

  // 내 pieces 카드에 클릭 리스너 연결 (1v1 renderMyPieces 동작 유지)
  myContainer.querySelectorAll('[data-my-piece-idx]').forEach(card => {
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
}

function renderTeamPlayerBlock(playerData, isAlly) {
  const isMe = playerData.idx === S.playerIdx;
  const currentPlayer = playerData.idx === S.currentPlayerIdx;
  const teamColor = playerData.teamId === 0 ? '#60a5fa' : '#ef4444';
  const pieces = playerData.pieces || [];
  const aliveCount = pieces.filter(p => p.alive).length;
  const headerBg = currentPlayer ? 'rgba(226,168,75,0.15)' : 'transparent';
  const headerBorder = currentPlayer ? '2px solid var(--accent)' : '1px solid var(--border)';

  const piecesHtml = pieces.map((pc, i) => {
    if (!pc.alive) {
      return `<div class="my-piece-card dead">
        <div class="my-piece-header"><span class="p-icon">${pc.icon || '❔'}</span><strong>${escapeHtmlGlobal(pc.name || pc.type)}</strong></div>
        <div style="font-size:0.72rem;color:var(--muted)">💀 격파</div>
      </div>`;
    }
    const hpPct = (pc.hp / pc.maxHp) * 100;
    const tagHtml = pc.tag ? (pc.tag === 'royal' ? '<span class="tag-stamp stamp-royal">왕실</span>' : pc.tag === 'villain' ? '<span class="tag-stamp stamp-villain">악인</span>' : '') : '';
    const myPieceAttr = (isAlly && isMe) ? `data-my-piece-idx="${i}"` : '';
    const selectedClass = (isAlly && isMe && S.selectedPiece === i) ? 'active-piece' : '';
    return `<div class="my-piece-card ${selectedClass}" ${myPieceAttr}>
      <div class="my-piece-header">
        <span class="p-icon">${pc.icon || ''}</span>
        <strong>${escapeHtmlGlobal(pc.name || pc.type)}</strong>
        ${pc.tier ? `<span class="tier-badge">${pc.tier}T</span>` : ''}
        ${tagHtml}
      </div>
      <div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--muted);display:flex;justify-content:space-between">
        <span>HP ${pc.hp}/${pc.maxHp} · ATK ${pc.atk}</span>
        <span>${pc.col >= 0 ? coord(pc.col, pc.row) : ''}</span>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="team-profile-block" style="margin-bottom:10px;padding:8px;border-radius:8px;background:${headerBg};border:${headerBorder}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:0.85rem">
        <div>
          <span style="color:${teamColor};font-weight:800">${playerData.teamId === 0 ? 'A' : 'B'}</span>
          <strong style="color:${isMe ? 'var(--accent)' : 'var(--text)'}">${escapeHtmlGlobal(playerData.name)}</strong>
          ${isMe ? '<span style="font-size:0.7rem;color:var(--accent)">(나)</span>' : ''}
          ${currentPlayer ? '<span style="font-size:0.7rem;color:var(--accent)">⏰ 턴</span>' : ''}
        </div>
        <span class="muted" style="font-size:0.72rem">${aliveCount}/${pieces.length}</span>
      </div>
      ${piecesHtml}
    </div>
  `;
}

// 팀 대기실 렌더
function renderTeamWaitingRoom() {
  const statusCount = document.getElementById('team-status-count');
  const statusMsg = document.getElementById('team-status-msg');
  const startBtn = document.getElementById('btn-team-start');
  const total = (S.teamPlayers || []).length;
  if (statusCount) statusCount.textContent = `${total} / 4`;
  const teamAOk = (S.teamTeams[0] || []).length === 2;
  const teamBOk = (S.teamTeams[1] || []).length === 2;
  const ready = total === 4 && teamAOk && teamBOk;
  if (statusMsg) {
    if (total < 4) statusMsg.textContent = '참가자를 기다리는 중...';
    else if (!ready) statusMsg.textContent = '각 팀에 2명씩 배정해야 시작할 수 있습니다.';
    else statusMsg.textContent = '모두 준비 완료! 게임을 시작하세요.';
  }
  if (startBtn) {
    startBtn.disabled = !ready;
    startBtn.textContent = ready ? '게임 시작 (3초 카운트다운)' : `게임 시작 (${total}/4 필요)`;
  }
  // 슬롯 렌더
  document.querySelectorAll('#screen-team-waiting .team-slot').forEach(slotEl => {
    const teamId = parseInt(slotEl.dataset.team, 10);
    const pos = parseInt(slotEl.dataset.pos, 10);
    const members = S.teamTeams[teamId] || [];
    const occupantIdx = members[pos];
    slotEl.classList.remove('filled', 'self');
    if (occupantIdx !== undefined && occupantIdx !== null) {
      const player = S.teamPlayers.find(p => p.idx === occupantIdx);
      const name = player ? player.name : `플레이어 ${occupantIdx+1}`;
      const isMe = occupantIdx === S.playerIdx;
      slotEl.classList.add('filled');
      if (isMe) slotEl.classList.add('self');
      slotEl.innerHTML = `
        <span class="slot-nickname">${escapeHtmlGlobal(name)}</span>
        ${isMe ? '<span class="slot-you-badge">나</span>' : ''}
      `;
    } else {
      slotEl.innerHTML = `<span class="team-slot-label">빈 슬롯</span>`;
    }
  });
}

// 팀 슬롯 클릭 → 팀 변경 요청
document.querySelectorAll('#screen-team-waiting .team-slot').forEach(slotEl => {
  slotEl.addEventListener('click', () => {
    if (!S.isTeamMode) return;
    const teamId = parseInt(slotEl.dataset.team, 10);
    const pos = parseInt(slotEl.dataset.pos, 10);
    // 이미 내 팀이면 무시
    if (teamId === S.teamId) return;
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
  if (chatInput) chatInput.placeholder = '관전자 채팅 (관전자끼리만 보입니다)';

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
  if (type === 'passive' && msg.includes('저주 상태의') && msg.includes('0.5 피해')) {
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
  if (timeout) showSkillToast(`⏰ ${timeoutMsg || '시간 초과로 랜덤 선택되었습니다.'}`, false, undefined, 'event');
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
  if (timeout) showSkillToast('⏰ 시간 초과로 랜덤 분배되었습니다.', false, undefined, 'event');
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
socket.on('initial_reveal_phase', ({ myDraft, oppChars }) => {
  S.phase = 'initial_reveal';
  S.myDraft = myDraft;
  S.oppRevealChars = oppChars;
  buildInitialRevealUI(myDraft, oppChars);
  showScreen('screen-initial-reveal');
});

// ── 교환 드래프트 ──
socket.on('exchange_draft_phase', ({ myDraft, available, oppDraft }) => {
  S.phase = 'exchange_draft';
  S.exchangeAvailable = available;
  S.exchangeMyDraft = { ...myDraft };
  S.exchangeSelected = null;
  S.myDraft = myDraft;
  buildExchangeDraftUI(myDraft, available, oppDraft);
  showScreen('screen-exchange');
});

socket.on('exchange_done', ({ draft, exchanged, timeout }) => {
  S.exchangeMyDraft = draft;
  if (timeout) {
    showSkillToast('시간초과! 교환 없이 확정되었습니다.', false, undefined, 'event');
  } else if (exchanged) {
    showSkillToast(`${exchanged.newChar.icon}${exchanged.newChar.name} 교환 완료.`, false, undefined, 'event');
  }
});

// ── 최종 공개 ──
socket.on('final_reveal_phase', ({ myDraft, oppChars }) => {
  S.phase = 'final_reveal';
  buildFinalRevealUI(myDraft, oppChars);
  showScreen('screen-final-reveal');
});

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
  addLog(`${S.isMyTurn ? '선공! 먼저 시작합니다.' : '후공! 상대가 먼저 시작합니다.'}`, 'system');
  // 게임 시작 애니메이션
  playGameStartAnimation(S.isMyTurn);
});

// 게임 시작 애니메이션 — 오버레이 "FIGHT!" + 1.2초 scale-up 페이드
function playGameStartAnimation(isMyTurn) {
  let overlay = document.getElementById('game-start-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'game-start-overlay';
    overlay.className = 'game-start-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="game-start-title">게임 시작</div>
    <div class="game-start-sub">${isMyTurn ? '선공! 먼저 시작합니다.' : '후공! 상대가 먼저 시작합니다.'}</div>
  `;
  overlay.classList.remove('hidden');
  overlay.classList.add('active');
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
  S.lastActionType = null;
  S.lastActionPieceType = null;

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
  S.isMyTurn = false;
  S.turnNumber = data.turnNumber;
  S.oppPieces = data.oppPieces || S.oppPieces;
  S.sp = data.sp || S.sp;
  S.instantSp = data.instantSp || S.instantSp;
  S.boardBounds = data.boardBounds || S.boardBounds;
  S.boardObjects = data.boardObjects || S.boardObjects;
  S.action = null;
  S.selectedPiece = null;

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
  addLog(`🚶 ${pc.name}의 위치를 ${coord(col,row)}로 이동합니다.`, 'move');
  showSkillToast(`🚶 ${pc.name}의 위치를 ${coord(col,row)}로 이동합니다.`);

  if (twinMovePending) {
    // 쌍둥이 첫 이동 — 행동 완료지만 같은 턴에 다른 쪽 이동도 옵션
    S.action = 'move';
    S.selectedPiece = null;
    S.twinMovePending = true;
    S.twinMovedSub = twinMovedSub;
    S.moveDone = true;
    S.actionDone = true;  // 첫 이동만으로 턴 종료 가능
    S.lastActionType = 'move';
    S.lastActionPieceType = pc.type;
    renderGameBoard();
    renderMyPieces();
    const otherFull = pc.subUnit === 'elder' ? '동생도' : '누나도';
    document.getElementById('action-hint').textContent = `👫 쌍둥이 ${otherFull} 추가로 이동시키거나 턴을 종료할 수 있습니다.`;
    showActionBar(true);
  } else {
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
  }
});

socket.on('opp_moved', ({ msg, prevCol, prevRow, col, row }) => {
  // #10: 표식된 적이면 실시간 위치 업데이트 + 이동 애니메이션
  if (S.oppPieces && prevCol !== undefined && prevRow !== undefined && col !== undefined && row !== undefined) {
    const markedMover = S.oppPieces.find(p => p.marked && p.alive && p.col === prevCol && p.row === prevRow);
    if (markedMover) {
      // 실시간 위치 업데이트 후 이동 애니메이션
      markedMover.col = col;
      markedMover.row = row;
      renderGameBoard();
      renderOppPieces();
      // 시각적 하이라이트 (이동 후 셀 강조)
      const boardEl = document.getElementById('game-board');
      const cellEl = boardEl && boardEl.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
      if (cellEl) {
        cellEl.classList.add('marked-move-flash');
        setTimeout(() => cellEl.classList.remove('marked-move-flash'), 700);
      }
      addLog(`🎯 표식된 적이 ${coord(prevCol,prevRow)}에서 ${coord(col,row)}로 이동했습니다.`, 'move');
      showSkillToast(`🎯 표식된 적이 ${coord(col,row)}로 이동!`, true);
      return;
    }
  }
  addLog(`🚶 상대가 이동했습니다.`, 'move');
  showSkillToast(`🚶 상대가 이동했습니다.`, true);
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
    // 로컬에서 파괴된 쥐 제거 (서버에서는 이미 제거됨)
    for (const dr of destroyedRats) {
      S.boardObjects = S.boardObjects.filter(o => !(o.type === 'rat' && o.owner !== S.playerIdx && o.col === dr.col && o.row === dr.row));
    }
  }

  // 공격 모션 애니메이션
  const atkCells = cellResults.map(c => ({ col: c.col, row: c.row }));
  const hitCells = cellResults.filter(c => c.hit).map(c => ({ col: c.col, row: c.row }));
  animateAttack(atkCells, hitCells);
  playSfx('attack');

  // 아군 피해 감지용: 업데이트 전 HP 스냅샷 (학살 영웅 등)
  const oldMyHps = S.myPieces.map(p => p.hp);

  if (oppPieces) { S.oppPieces = oppPieces; }
  if (yourPieces) { S.myPieces = yourPieces; }
  const pc = S.myPieces[pieceIdx];

  for (const c of cellResults) {
    S.attackLog.push({ col: c.col, row: c.row, hit: c.hit, turn: S.turnNumber });
  }

  if (!anyHit) {
    // 쌍둥이: 각 서브유닛별로 빗나감 표시
    if (pc.subUnit) {
      const otherSub = pc.subUnit === 'elder' ? 'younger' : 'elder';
      const otherPc = S.myPieces.find(p => p.subUnit === otherSub && p.alive);
      addLog(`⚔ ${myN()}의 ${pc.name}! 공격 빗나감.`, 'miss');
      showSkillToast(`⚔ ${myN()}의 ${pc.name}! 공격 빗나감.`);
      if (otherPc) {
        addLog(`⚔ ${myN()}의 ${otherPc.name}! 공격 빗나감.`, 'miss');
        showSkillToast(`⚔ ${myN()}의 ${otherPc.name}! 공격 빗나감.`);
      }
    } else {
      addLog(`⚔ ${myN()}의 ${pc.name}! 공격 빗나감.`, 'miss');
      showSkillToast(`⚔ ${myN()}의 ${pc.name}! 공격 빗나감.`);
    }
  } else {
    // 호위무사 가로채기·0데미지 비격파 hit은 토스트/로그 생략
    // (호위무사의 충성 패시브 알림과 본체 피격 애니메이션이 별도로 표시됨)
    const meaningfulHits = cellResults.filter(c => c.hit && !c.redirectedToBodyguard && !(c.damage === 0 && !c.destroyed));
    for (const h of meaningfulHits) {
      if (h.destroyed) playSfx('kill'); else playSfx('hit');
      const atkName = h.attackerName || pc.name;
      const atkIcon = h.attackerIcon || pc.icon;
      const target = h.destroyed ? `${oppN()}의 ${h.revealedIcon||''}${h.revealedName||'유닛'}` : coord(h.col,h.row);
      addLog(h.destroyed
        ? `⚔ ${myN()}의 ${atkName}! ${target} 격파함. 💀`
        : `⚔ ${myN()}의 ${atkName}! ${target}에 ${h.damage} 피해.`, 'hit');
    }
    for (const h of meaningfulHits) {
      const atkName = h.attackerName || pc.name;
      const target = h.destroyed ? `${oppN()}의 ${h.revealedIcon||''}${h.revealedName||'유닛'}` : coord(h.col,h.row);
      showSkillToast(h.destroyed
        ? `⚔ ${myN()}의 ${atkName}! ${target} 격파함. 💀`
        : `⚔ ${myN()}의 ${atkName}! ${target}에 ${h.damage} 피해.`, false);
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
  for (const c of cellResults) {
    if (!c.hit || c.redirectedToBodyguard) continue;
    if (c.damage === 0 && !c.destroyed) continue;
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

  // 상대 유닛 피격 애니메이션
  applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppHitIndices);
  // 아군 피해 애니메이션 (학살 영웅 등)
  applyProfileHitAnim('#my-pieces-info .my-piece-card', myFriendlyFireIndices);

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
  // #1: 호위무사 가로채기 — 원래 대상(damage=0)은 필터링, 호위무사(bodyguardRedirect)는 유지하여 애니메이션 발동
  if (S._bodyguardIntercepted) {
    hitPieces = hitPieces.filter(h => h.damage > 0 || h.bodyguardRedirect);
    S._bodyguardIntercepted = false;
  }

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

  // 피격 셀만 흔들림 (상대 공격 범위는 표시하지 않음 — 추론 게임)
  const hitCells = hitPieces.map(h => ({ col: h.col, row: h.row }));
  animateAttack([], hitCells);

  S.myPieces = yourPieces;
  // 호위무사 가로채기 / 0데미지 비격파 hit은 토스트·로그 생략
  const meaningfulHits = hitPieces.filter(h => !h.redirectedToBodyguard && !(h.damage === 0 && !h.destroyed));
  if (meaningfulHits.length === 0 && hitPieces.length === 0) {
    addLog(`⚔ ${oppN()}의 공격 빗나감.`, 'miss');
    showSkillToast(`⚔ ${oppN()}의 공격 빗나감.`, true);
  } else {
    for (const h of meaningfulHits) {
      if (h.destroyed) playSfx('kill'); else playSfx('hit');
      const unitName = h.icon && h.name ? `${myN()}의 ${h.icon}${h.name}` : coord(h.col,h.row);
      addLog(h.destroyed ? `⚔ ${unitName} 피격! 격파됨. 💀` : `⚔ ${unitName} 피격! ${h.damage} 피해.`, 'hit');
      showSkillToast(h.destroyed ? `⚔ ${unitName} 피격! 격파됨. 💀` : `⚔ ${unitName} 피격! ${h.damage} 피해.`, true);
    }
  }
  // 피격 유닛 인덱스 — 본체 애니메이션은 의미 있는 피격에 한정 (가로채기·0데미지 제외)
  const hitIndices = findPieceIndices(S.myPieces, meaningfulHits);

  renderGameBoard();
  renderMyPieces();

  // 피격 유닛 프로필 흔들림 + 금색 플래시
  applyProfileHitAnim('#my-pieces-info .my-piece-card', hitIndices);

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
socket.on('turn_event', ({ type, msg }) => {
  if (S.isSpectator) return; // 관전자는 spectator_log 경로로 수신
  showSkillToast(`⚡ ${msg}`, false, undefined, 'event');
  addLog(`⚡ ${msg}`, 'system');
});

// ── 보드 축소 경고 ──
socket.on('board_shrink_warning', ({ turnsRemaining }) => {
  const el = document.getElementById('shrink-warning');
  if (el) {
    el.classList.remove('hidden');
    el.textContent = `외곽 파괴까지 ${turnsRemaining}턴`;
  }
  if (S.isSpectator) return;
  showSkillToast(`외곽 파괴까지 ${turnsRemaining}턴`, false, undefined, 'event');
  addLog(`외곽 파괴까지 ${turnsRemaining}턴`, 'shrink');
});

// ── 보드 축소 실행 ──
socket.on('board_shrink', ({ bounds, eliminated }) => {
  playSfx('shrink');
  // 쿠구궁 효과음 + 1초 흔들림
  try { playBoardQuake(); } catch (e) {}
  const boardEl = document.getElementById('game-board');
  if (boardEl) {
    boardEl.classList.add('board-shake');
    setTimeout(() => boardEl.classList.remove('board-shake'), 1000);
  }
  // 1초 흔들림 후 bounds 업데이트 + 렌더 (외곽 파괴 시각 효과)
  setTimeout(() => {
    S.boardBounds = bounds;
    if (!S.isSpectator) {
      showSkillToast('🔥 보드 외곽 파괴', false, undefined, 'event');
      addLog(`🔥 보드 외곽 파괴`, 'shrink');
    }
    if (eliminated && eliminated.length > 0) {
      for (const e of eliminated) {
        addLog(`💀 ${e.icon} ${e.name} 파괴`, 'shrink');
        const ownerName = e.owner === S.playerIdx ? myN() : oppN();
        showSkillToast(`💀 ${ownerName}의 ${e.icon}${e.name} 파괴`, e.owner !== S.playerIdx, undefined, 'event');
      }
    }
    const sw = document.getElementById('shrink-warning');
    if (sw) sw.classList.add('hidden');
    renderGameBoard();
    renderMyPieces();
    renderOppPieces();
  }, 1000);
});

// 힐 애니메이션: 지정된 인덱스의 piece 카드 2초간 초록 glow
function flashHealPieces(indexes) {
  const container = document.getElementById('my-pieces-info');
  if (!container) return;
  const cards = container.querySelectorAll('.my-piece-card');
  for (const idx of indexes) {
    const card = cards[idx];
    if (!card) continue;
    card.classList.add('heal-flash');
    setTimeout(() => card.classList.remove('heal-flash'), 2000);
  }
}

// 쿠구궁 효과음 — Web Audio로 생성 (저주파 + 노이즈)
function playBoardQuake() {
  if (sfxMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
socket.on('skill_result', ({ msg, success, yourPieces, oppPieces, sp, instantSp, boardObjects, actionDone, actionUsedSkillReplace, skillsUsed, data, effects }) => {
  // 피해 감지용: 업데이트 전 HP 스냅샷
  const oldOppHps = S.oppPieces ? S.oppPieces.map(p => p.hp) : [];
  const oldMyHps = S.myPieces.map(p => p.hp);

  if (yourPieces) S.myPieces = yourPieces;
  if (oppPieces) S.oppPieces = oppPieces;
  if (sp) { S.sp = sp; }
  if (instantSp) { S.instantSp = instantSp; }
  if (sp || instantSp) { updateSPBar(); }
  if (boardObjects) S.boardObjects = boardObjects;
  if (actionDone !== undefined) S.actionDone = actionDone;
  if (actionUsedSkillReplace !== undefined) S.actionUsedSkillReplace = actionUsedSkillReplace;
  if (skillsUsed) S.skillsUsedThisTurn = skillsUsed;
  if (msg) {
    // 악몽(고문 기술자) 전용 사운드 우선
    if (msg.startsWith('⛓ 악몽:')) {
      playSfxNightmare();
    } else {
      playSfx('skill');
    }
    addLog(msg, 'skill');
    showSkillToast(msg);
  }
  // 스킬 시전 완료 — 액션 모드 글로우 해제
  if (typeof setActionButtonMode === 'function') setActionButtonMode(null);
  // 힐 애니메이션: data.healedPieceIdxs 있으면 해당 카드 2초 초록 빛
  const healedIdxs = (data && data.healedPieceIdxs) || (effects && effects.healedPieceIdxs);
  if (Array.isArray(healedIdxs) && healedIdxs.length > 0) {
    setTimeout(() => flashHealPieces(healedIdxs), 50);
  }

  // 내 스킬로 상대 유닛이 피해를 받았는지 감지
  const oppSkillDmgIdx = [];
  if (S.oppPieces) {
    for (let i = 0; i < S.oppPieces.length; i++) {
      if (i < oldOppHps.length && S.oppPieces[i].hp < oldOppHps[i]) oppSkillDmgIdx.push(i);
    }
  }
  // 내 스킬로 내 유닛이 피해를 받았는지 감지 (자해 스킬 등)
  const mySkillDmgIdx = [];
  for (let i = 0; i < S.myPieces.length; i++) {
    if (i < oldMyHps.length && S.myPieces[i].hp < oldMyHps[i]) mySkillDmgIdx.push(i);
  }

  renderGameBoard();
  renderMyPieces();
  renderOppPieces();
  if (S.isMyTurn) showActionBar(true);

  applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppSkillDmgIdx);
  applyProfileHitAnim('#my-pieces-info .my-piece-card', mySkillDmgIdx);
});

// ── 상태 업데이트 (상대의 스킬 사용 시) ──
socket.on('status_update', ({ oppPieces, yourPieces, sp, instantSp, boardObjects, msg, skillUsed }) => {
  // 악몽(상대) 전용 사운드 우선
  if (msg && msg.startsWith('⛓ 악몽:')) {
    playSfxNightmare();
  } else {
    playSfx('opp_skill');
  }

  // 피해 감지용: 업데이트 전 HP 스냅샷
  const oldMyHps = S.myPieces.map(p => p.hp);

  if (yourPieces) S.myPieces = yourPieces;
  if (oppPieces) S.oppPieces = oppPieces;
  if (sp) { S.sp = sp; }
  if (instantSp) { S.instantSp = instantSp; }
  if (sp || instantSp) { updateSPBar(); }
  if (boardObjects) S.boardObjects = boardObjects;
  if (msg) {
    showSkillToast(msg, true);
    addLog(msg, 'skill-enemy');
  }
  // skillUsed만 있거나 아무 정보도 없는 경우는 조용히 무시 (🚨 토스트 영구 삭제)

  // 상대 스킬로 내 유닛이 피해를 받았는지 감지
  const mySkillDmgIdx = [];
  for (let i = 0; i < S.myPieces.length; i++) {
    if (S.myPieces[i].hp < oldMyHps[i]) mySkillDmgIdx.push(i);
  }

  renderGameBoard();
  renderMyPieces();
  renderOppPieces();

  applyProfileHitAnim('#my-pieces-info .my-piece-card', mySkillDmgIdx);
});

// ── 정찰 결과 ──
socket.on('scout_result', ({ axis, value, targetName }) => {
  const label = axis === 'row' ? `${ROW_LABELS[value] || value}열` : `${value+1}행`;
  addLog(`🔭 정찰: ${targetName}의 위치는 ${label} 입니다.`, 'skill');
  showSkillToast(`🔭 정찰: ${targetName}의 위치는 ${label} 입니다.`);
});

// ── 쥐 소환 ──
socket.on('rats_spawned', ({ rats, owner }) => {
  playSfx('skill');
  if (owner === S.playerIdx) {
    addLog(`🐀 역병의 자손들: 쥐 ${rats.length}마리를 소환했습니다.`, 'skill');
    showSkillToast(`🐀 역병의 자손들: 쥐 ${rats.length}마리를 소환했습니다.`);
  } else {
    addLog(`🐀 역병의 자손들: 상대가 쥐를 소환. 쥐는 공격으로 제거할 수 있습니다.`, 'skill');
    showSkillToast(`🐀 역병의 자손들: 상대가 쥐를 소환. 쥐는 공격으로 제거할 수 있습니다.`, true);
  }
  renderGameBoard();
});

// ── 드래곤 소환 ──
socket.on('dragon_spawned', ({ dragon, owner }) => {
  playSfx('skill');
  if (owner === S.playerIdx) {
    addLog(`🐉 드래곤 소환: ${coord(dragon.col,dragon.row)}에 드래곤을 소환했습니다.`, 'skill');
    showSkillToast(`🐉 드래곤 소환: ${coord(dragon.col,dragon.row)}에 드래곤을 소환했습니다.`);
  } else {
    addLog(`🐉 드래곤 소환: 상대가 ${coord(dragon.col,dragon.row)}에 드래곤을 소환했습니다.`, 'skill');
    showSkillToast(`🐉 드래곤 소환: 상대가 ${coord(dragon.col,dragon.row)}에 드래곤을 소환했습니다.`, true);
  }
});

// ── 함정 발동 ──
socket.on('trap_triggered', ({ col, row, pieceInfo, damage, owner }) => {
  playSfxTrapSnap();
  const trapOwnerName = (owner !== undefined) ? (owner === S.playerIdx ? myN() : oppN()) : oppN();
  const msg = `🪤 ${trapOwnerName}의 인간 사냥꾼 덫에 걸려 ${pieceInfo.icon}${pieceInfo.name} 1 피해.`;
  addLog(msg, 'hit');
  showSkillToast(msg);
  S.attackLog.push({ col, row, hit: true, turn: S.turnNumber });

  // 덫 피격 애니메이션: 이름으로만 매칭 (좌표 매칭하면 같은 자리의 다른 유닛이 잘못 매칭됨)
  const trapHit = [{ name: pieceInfo.name }];
  const myTrapIdx = findPieceIndices(S.myPieces, trapHit, false);
  const oppTrapIdx = findPieceIndices(S.oppPieces, trapHit, false);

  renderGameBoard();
  renderMyPieces();
  renderOppPieces();

  applyProfileHitAnim('#my-pieces-info .my-piece-card', myTrapIdx);
  applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppTrapIdx);
});

// ── 폭탄 폭발 ──
socket.on('bomb_detonated', ({ col, row, hits }) => {
  playSfxBombExplode();
  for (const h of hits) {
    const bombMsg = `💥${h.icon}${h.name} 1 피해.`;
    addLog(bombMsg, 'hit');
    showSkillToast(bombMsg);
    S.attackLog.push({ col: h.col, row: h.row, hit: true, turn: S.turnNumber });
  }
  if (hits.length === 0) {
    S.attackLog.push({ col, row, hit: false, turn: S.turnNumber });
  }

  // 폭탄 피격 애니메이션: 내 유닛 & 상대 유닛 모두
  const myBombIdx = findPieceIndices(S.myPieces, hits);
  const oppBombIdx = findPieceIndices(S.oppPieces, hits);

  renderGameBoard();
  renderMyPieces();
  renderOppPieces();

  applyProfileHitAnim('#my-pieces-info .my-piece-card', myBombIdx);
  applyProfileHitAnim('#opp-pieces-info .opp-piece-card', oppBombIdx);
});

// ── 패시브 알림 ──
socket.on('passive_alert', ({ type, msg, playerIdx }) => {
  addLog(msg, 'skill');
  // 패시브 전용 효과음 — 저주 틱은 별도 사운드라 제외
  if (type !== 'curse_tick') {
    playSfxPassive();
  }
  if (type === 'bodyguard') {
    S._bodyguardIntercepted = true;
  }
  // 저주 틱 피해: 일반 피격 + 저주 사운드 레이어링 + 피격 애니메이션
  if (type === 'curse_tick') {
    playSfxCurseDamage();
    // 피격 애니메이션: msg에서 이름 추출 (예: "🧙 저주: 저주 상태의 궁수! 0.5 피해.")
    const nameMatch = msg.match(/저주 상태의\s+(.+?)!/);
    if (nameMatch) {
      const pname = nameMatch[1].trim();
      const myIdx = S.myPieces?.findIndex(p => p.alive && p.name === pname) ?? -1;
      const oppIdx = S.oppPieces?.findIndex(p => p.alive && p.name === pname) ?? -1;
      if (myIdx >= 0) applyProfileHitAnim('#my-pieces-info .my-piece-card', [myIdx]);
      if (oppIdx >= 0) applyProfileHitAnim('#opp-pieces-info .opp-piece-card', [oppIdx]);
    }
  }
  if (S.isSpectator) {
    showSkillToast(msg, false, playerIdx);
    return;
  }
  const isEnemy = (playerIdx !== undefined) ? (playerIdx !== S.playerIdx) : false;
  showSkillToast(msg, isEnemy);
});

// ── 게임 오버 ──
socket.on('game_over', ({ win, draw, opponentName, winnerName, loserName, spectator, reason }) => {
  stopClientTimer();
  // 세팅 단계 기권: 즉시 + 페이드 없음 / 게임 중: 1초 대기 + 느린 페이드
  const inGame = _isInGameScreen();
  const delay = inGame ? 1000 : 0;
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
    if (arr.length === 2) return `${arr[0]}와(과) ${arr[1]}`;
    return arr.join(', ');
  }

  // ── 무승부 (보드 축소 양측 전멸) ──
  if (draw) {
    document.getElementById('gameover-icon').textContent = '🤝';
    document.getElementById('gameover-title').textContent = '무승부';
    document.getElementById('gameover-title').style.color = 'var(--muted)';
    document.getElementById('gameover-sub').textContent = '보드 축소로 양측 모든 말이 전멸해 무승부입니다.';
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
      case 'surrender': sub = `${L}의 기권으로, ${W}의 승리입니다!`; break;
      case 'shrink': sub = `보드 축소로 ${L}의 말이 전멸해 ${W}의 승리입니다!`; break;
      case 'trap': sub = `인간 사냥꾼의 덫으로 상대의 모든 유닛을 쓰러트려 ${W}의 승리입니다!`; break;
      case 'bomb': sub = `화약병의 폭탄으로 상대의 모든 유닛을 쓰러트려 ${W}의 승리입니다!`; break;
      case 'sulfur': sub = `${W}의 유황범람으로 상대의 모든 유닛을 쓰러트려 ${W}의 승리입니다!`; break;
      case 'nightmare': sub = `${W}의 고문 기술자 악몽으로 상대의 모든 유닛을 쓰러트려 ${W}의 승리입니다!`; break;
      case 'attack': sub = killer
        ? `${killer}의 공격으로 상대의 모든 유닛을 쓰러트려 ${W}의 승리입니다!`
        : `${L}의 모든 유닛을 제거해, ${W}의 승리입니다.`; break;
      default: sub = `${W}이(가) ${L}에게 승리했습니다!`;
    }
    document.getElementById('gameover-sub').textContent = sub;
  } else if (win) {
    // ── 승리 메시지 ──
    document.getElementById('gameover-icon').textContent = '🏆';
    document.getElementById('gameover-title').textContent = '승리!';
    document.getElementById('gameover-title').style.color = 'var(--accent)';
    let sub = '';
    switch (r.type) {
      case 'surrender': sub = `${opponentName}의 기권입니다!`; break;
      case 'shrink': sub = `상대가 보드 축소를 피하지 못해 승리했습니다!`; break;
      case 'trap': sub = `상대가 인간 사냥꾼의 덫에 걸려 승리했습니다!`; break;
      case 'bomb': sub = `화약병의 폭탄으로 상대의 모든 말을 제거해 승리했습니다!`; break;
      case 'sulfur': sub = `유황범람으로 상대의 모든 말을 제거해 승리했습니다!`; break;
      case 'nightmare': sub = `고문 기술자의 악몽으로 상대의 모든 말을 제거해 승리했습니다!`; break;
      case 'attack': sub = killer
        ? `${killer}의 공격으로 ${opponentName}의 모든 말을 제거해 승리했습니다!`
        : `${opponentName}의 모든 유닛을 제거해 승리했습니다.`; break;
      default: sub = `${opponentName}의 모든 말을 제거했습니다!`;
    }
    document.getElementById('gameover-sub').textContent = sub;
  } else {
    // ── 패배 메시지 ──
    document.getElementById('gameover-icon').textContent = r.type === 'surrender' ? '🏳' : '💀';
    document.getElementById('gameover-title').textContent = r.type === 'surrender' ? '기권' : '패배...';
    document.getElementById('gameover-title').style.color = 'var(--danger)';
    let sub = '';
    switch (r.type) {
      case 'surrender': sub = `기권하여 패배했습니다.`; break;
      case 'shrink': sub = `보드 축소를 피하지 못해 패배하였습니다.`; break;
      case 'trap': sub = `인간 사냥꾼의 덫에 마지막 유닛이 걸려 패배하였습니다.`; break;
      case 'bomb': sub = `화약병의 폭탄으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'sulfur': sub = `유황범람으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'nightmare': sub = `고문 기술자의 악몽으로 모든 유닛이 쓰러져 패배하였습니다.`; break;
      case 'attack': sub = killer
        ? `${killer}의 공격으로 모든 유닛이 쓰러져 패배하였습니다.`
        : `${opponentName}에게 패배했습니다.`; break;
      default: sub = `${opponentName}에게 패배했습니다.`;
    }
    document.getElementById('gameover-sub').textContent = sub;
  }
  }  // end runGameOverRender
});

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
  // 팀 대기실에서도 보이도록 토스트 표시
  if (S.isTeamMode && S.phase === 'team-waiting') {
    try { showSkillToast(msg, false, undefined, 'event'); } catch (e) {}
  }
});

socket.on('wait_msg', ({ msg }) => {
  document.getElementById('waiting-title').textContent = msg;
  document.getElementById('waiting-sub').textContent = '';
  showScreen('screen-waiting');
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
    body: '스킬 사용 시 현재 위치에 몰래 덫을 설치합니다. 적이 덫이 설치 된 칸을 밟으면 덫이 발동하여 1 피해를 입힙니다.',
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
      { ...mkSkillHead('약초학', 'tag-free', '자유시전형'), sp: 3, color: '#a78bfa' },
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
    body: '마법사는 피격 당할 때마다 1회용 SP를 제공합니다. 이 SP는 사용하면 사라집니다.',
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
      { ...mkSkillHead('신성', 'tag-free', '자유시전형'), sp: 4, color: '#a78bfa', desc: '스킬 사용 시 아군 1명을 선택합니다. 해당 아군의 체력을 2 회복시키고 상태 이상을 제거합니다. 수도승은 이 스킬로 스스로 회복할 수 없습니다.' },
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

function renderSlide() {
  const step = S.draftStep;
  const chars = S.characters[step];
  if (!chars || !chars.length) return;
  const c = chars[slideIndex];

  // 아이콘 & 이름 + 태그
  document.getElementById('slide-icon').textContent = c.icon;
  const tagHtml = c.tag ? tagBadgeHtml(c.tag) : '';
  document.getElementById('slide-name').innerHTML = `<span>${c.name}</span>${tagHtml}`;
  // 이름 아래 공격력
  document.getElementById('slide-atk').innerHTML = `⚔ 공격력 ${c.atk}`;
  // 그 아래 미니 헤더
  const miniEl = document.getElementById('slide-mini-headers');
  if (miniEl) miniEl.innerHTML = buildMiniHeaders(c);
  // 실제 오버플로 감지 — 내용이 좌측 컬럼을 넘치면만 살짝 축소
  const leftCol = document.querySelector('#screen-draft .slide-left-col');
  if (leftCol) autoFitLeftCol(leftCol);
  // slide-desc는 숨김 (사용 안 함)
  const descEl = document.getElementById('slide-desc');
  if (descEl) { descEl.innerHTML = ''; descEl.classList.add('hidden'); }

  // 상세 설명 블록
  const detail = CHAR_DETAILS[c.type];
  const blocksEl = document.getElementById('slide-detail-blocks');
  const bodyEl = document.getElementById('slide-detail-body');
  // 좌측 컬럼 플레이버 텍스트 (이름+ATK 아래)
  const flavorEl = document.getElementById('slide-flavor');
  if (flavorEl) flavorEl.textContent = (detail && detail.flavor) ? detail.flavor : '';

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
      selectBtn.textContent = '✔ 선택됨 (해제)';
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
      renderSlide(); renderTeamDraftSlots(); updateDraftConfirmBtn();
      return;
    }
    if (S.teamDraft.pick2 === c.type) {
      S.teamDraft.pick2 = null;
      socket.emit('team_draft_pick', { slot: 'pick2', type: null });
      renderSlide(); renderTeamDraftSlots(); updateDraftConfirmBtn();
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
    showSkillToast(`${c.icon} ${c.name} 선택 완료.`, false, undefined, 'event');
    renderSlide(); renderTeamDraftSlots(); updateDraftConfirmBtn();
    return;
  }

  // ── 1v1 모드 (기존) ──
  const isDuplicate = S.draftSelected[step] === c.type;
  S.draftSelected[step] = c.type;
  if (S.deckBuilderMode) S.deckSaved = false;
  renderSlide();
  updateDraftConfirmBtn();
  socket.emit('draft_browse', { step, type: c.type, selected: { ...S.draftSelected } });
  if (!isDuplicate) {
    playSfxCharSelect();
    showSkillToast(`${c.icon} ${c.name} 선택 완료.`, false, undefined, 'event');
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
  gunpowder: { cells: surrounding8WithSelf, cat: 'attack', label: '폭탄 설치 가능 지역' },
  herbalist: { cells: surrounding8, cat: 'heal', label: '약초학 회복 범위' },
  manhunter: { cells: selfOnly, cat: 'attack', label: '덫 설치 가능 지역' },
  sulfurCauldron: { cells: boardEdge, cat: 'attack', label: '유황범람 공격 범위' },
  // 드래곤 조련사: 소환된 드래곤의 공격 범위(십자5칸) — 특수 렌더
  dragonTamer: { cells: dragonCrossCells, cat: 'dragon', label: '드래곤 십자 5칸 공격', showDragon: true },
  // 나머지 (수도승·국왕·마녀·고문기술자·척후병·쥐장수) — 미리보기 삭제
};
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
// 탭 클릭 바인딩 (최초 1회)
document.querySelectorAll('.slide-preview-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    slidePreviewMode = tab.dataset.mode;
    // 현재 슬라이드 재렌더
    const step = S.draftStep;
    if (S.characters && S.characters[step]) {
      const chars = S.characters[step];
      const c = chars[slideIndex];
      if (c) updateDraftPreview(c);
    }
  });
});

function updateDraftPreview(charData) {
  const board = document.getElementById('draft-preview-board');
  if (!board) return;

  // 탭 상태 업데이트
  const tabs = document.querySelectorAll('.slide-preview-tab');
  const hasSkill = hasSkillPreview(charData);
  tabs.forEach(t => {
    const m = t.dataset.mode;
    t.classList.toggle('active', m === slidePreviewMode && (m === 'attack' || hasSkill));
    if (m === 'skill') t.disabled = !hasSkill;
  });
  // 스킬 범위 없으면 자동으로 attack 모드로 복귀
  const effectiveMode = (slidePreviewMode === 'skill' && hasSkill) ? 'skill' : 'attack';

  // 스킬 범위 모드
  if (effectiveMode === 'skill' && hasSkill) {
    const skill = SKILL_PREVIEW[charData.type];
    const centerCol = 2, centerRow = 2;
    const cells = skill.cells(centerCol, centerRow);
    const cellsSet = new Set(cells.map(c => `${c.col},${c.row}`));
    // 드래곤 소환 — 드래곤 아이콘 위치 (조련사 우측 인접)
    const dragonCol = centerCol + 1, dragonRow = centerRow;
    board.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col);
      const row = parseInt(cell.dataset.row);
      cell.className = 'cell';
      cell.innerHTML = '';
      if (col === centerCol && row === centerRow) {
        cell.innerHTML = `<span style="font-size:1.1rem">${charData.icon}</span>`;
        cell.classList.add('has-piece');
      }
      // 드래곤 소환 특수: 드래곤 아이콘 표시
      if (skill.showDragon && col === dragonCol && row === dragonRow) {
        cell.innerHTML = `<span style="font-size:1.1rem">🐲</span>`;
        cell.classList.add('has-piece');
      }
      if (cellsSet.has(`${col},${row}`)) {
        cell.classList.add('skill-preview-' + skill.cat);
      }
    });
    document.getElementById('draft-preview-info').textContent = skill.label;
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

    document.getElementById('draft-preview-info').textContent = shouldShowDesc(charData) ? charData.desc : '';
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

    if (col === centerCol && row === centerRow) {
      cell.innerHTML = `<span style="font-size:1.1rem">${charData.icon}</span>`;
      cell.classList.add('has-piece');
    }

    if (range.some(c => c.col === col && c.row === row)) {
      cell.classList.add('attack-range');
    }
  });

  document.getElementById('draft-preview-info').textContent = shouldShowDesc(charData) ? charData.desc : '';
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
      btn.textContent = `선택 확정 (${tmCount}/2)`;
    }
    renderTeamDraftSlots();
    return;
  }

  const allSelected = S.draftSelected[1] && S.draftSelected[2] && S.draftSelected[3];
  const count = [1,2,3].filter(t => S.draftSelected[t]).length;
  if (S.deckBuilderMode) {
    btn.disabled = false;
    btn.textContent = allSelected ? '덱 저장' : `덱 저장 (${count}/3)`;
  } else if (allSelected) {
    btn.disabled = false;
    btn.textContent = '최종 확정';
  } else {
    btn.disabled = true;
    btn.textContent = `선택 확정 (${count}/3)`;
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
      { tier: 2, type: 'weaponSmith', reason: '자유로운 공격 범위 전환으로 유연한 사격 라인' },
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

  let elderHp = Math.ceil(twinTierHp / 2);
  let youngerHp = twinTierHp - elderHp;

  function render() {
    controls.innerHTML = `
      <div class="hp-twin-unit">
        <strong>👧 누나</strong>
        <div class="hp-input-group" style="justify-content:center">
          <button class="hp-btn twin-btn" data-who="elder" data-delta="-1">−</button>
          <span class="hp-value">${elderHp}</span>
          <button class="hp-btn twin-btn" data-who="elder" data-delta="1">+</button>
        </div>
      </div>
      <span style="font-size:1.2rem;color:var(--muted)">+</span>
      <div class="hp-twin-unit">
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
  };
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

function buildInitialRevealUI(myDraft, oppChars) {
  renderProgressStepper('screen-initial-reveal', 'initial_reveal');
  document.getElementById('irev-my-name').textContent = S.myName || '나';
  document.getElementById('irev-opp-name').textContent = S.opponentName || '상대방';

  const myContainer = document.getElementById('irev-my-chars');
  const oppContainer = document.getElementById('irev-opp-chars');
  myContainer.innerHTML = '';
  oppContainer.innerHTML = '';

  const btn = document.getElementById('btn-irev-confirm');
  btn.disabled = true;
  btn.style.opacity = '0';
  btn.textContent = '교환 드래프트로';

  // 카드 데이터 준비
  const myCards = [];
  for (const [key, tier] of [['t1', 1], ['t2', 2], ['t3', 3]]) {
    const type = myDraft[key];
    const ch = findLocalChar(type, tier);
    if (ch) myCards.push({ ch, tier });
  }
  const oppCards = oppChars.map(ch => ({ ch, tier: ch.tier }));

  // 빈 슬롯 3개씩 미리 표시
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

  // 모든 등장 후 버튼 표시
  setTimeout(() => {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.animation = 'revealSlide 0.5s ease-out both';
  }, 2500);
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
  socket.emit('confirm_initial_reveal');
  document.getElementById('btn-irev-confirm').disabled = true;
  document.getElementById('btn-irev-confirm').textContent = '대기 중...';
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
  document.getElementById('ex-draft-sub').textContent = `상대방 말을 견제할 주요 전력을 하나 교체할 수 있습니다!`;

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
      exSelectBtn.className = 'btn btn-accent btn-select-char selected';
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

function exUpdatePreview(charData) {
  const board = document.getElementById('ex-preview-board');
  if (!board) return;

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
    document.getElementById('ex-preview-info').textContent = shouldShowDesc(charData) ? charData.desc : '';
    return;
  }

  const centerCol = 2, centerRow = 2;
  const range = getAttackCells(charData.type, centerCol, centerRow);
  board.querySelectorAll('.cell').forEach(cell => {
    const col = parseInt(cell.dataset.col); const row = parseInt(cell.dataset.row);
    cell.className = 'cell'; cell.innerHTML = '';
    if (col === centerCol && row === centerRow) {
      cell.innerHTML = `<span style="font-size:1rem">${charData.icon}</span>`;
      cell.classList.add('has-piece');
    }
    if (range.some(c => c.col === col && c.row === row)) cell.classList.add('attack-range');
  });
  document.getElementById('ex-preview-info').textContent = shouldShowDesc(charData) ? charData.desc : '';
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
    // 원래 캐릭터로 되돌리기
    if (S.exSwapped && S.exSwapped.tier === tier) {
      S.exSwapped = null;
      S.exMyDraft[myKey] = S.exOriginalDraft[myKey];
      S.exchangeSelected = null;
    }
  } else {
    // 새 캐릭터로 교체
    S.exSwapped = { tier, newType: c.type };
    S.exMyDraft[myKey] = c.type;
    S.exchangeSelected = { tier, newType: c.type };
  }
  exRenderSlide();
});

document.getElementById('btn-exchange-confirm').addEventListener('click', () => {
  const btn = document.getElementById('btn-exchange-confirm');
  if (!S.exchangeSelected) {
    document.getElementById('exchange-noswap-modal').classList.remove('hidden');
    return;
  }
  socket.emit('exchange_pick', { tier: S.exchangeSelected.tier, newType: S.exchangeSelected.newType });
  btn.disabled = true;
  btn.textContent = '대기 중...';
});
document.getElementById('exchange-noswap-confirm').addEventListener('click', () => {
  document.getElementById('exchange-noswap-modal').classList.add('hidden');
  socket.emit('exchange_pick', {});
  const btn = document.getElementById('btn-exchange-confirm');
  btn.disabled = true;
  btn.textContent = '대기 중...';
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

  // 팀 모드: 오른쪽 패널에 상대팀 유닛 (enemies)
  if (S.teamPlacementMode) {
    if (header) header.textContent = '상대팀 캐릭터';
    container.innerHTML = '';
    const enemies = S.teamPlacementEnemies || [];
    if (enemies.length === 0) {
      container.innerHTML = '<p class="muted" style="font-size:0.78rem">상대팀 정보 없음</p>';
      return;
    }
    for (const en of enemies) {
      const block = document.createElement('div');
      block.className = 'placement-enemy-block';
      block.innerHTML = `<h5 class="enemy-block-header">${escapeHtmlGlobal(en.name)}</h5>`;
      for (const pc of (en.pieces || [])) {
        const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
        const card = document.createElement('div');
        card.className = 'placement-opp-card';
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

  // 팀 모드: 내 프로필 아래에 팀원 pieces 추가 (읽기 전용)
  if (S.teamPlacementMode && S.teamPlacementTeammates) {
    for (const tm of S.teamPlacementTeammates) {
      const sep = document.createElement('div');
      sep.className = 'placement-teammate-separator';
      sep.innerHTML = `<span class="teammate-sep-label">${escapeHtmlGlobal(tm.name)}</span>`;
      list.appendChild(sep);
      renderPlacementPieceCards(list, tm.pieces || [], /*interactive=*/false, tm.name);
    }
  }

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
    // 스킬/패시브 정보 (동일 로직)
    let skillHtml = '';
    if (pc.skills && pc.skills.length > 1) {
      for (const sk of pc.skills) {
        const skTag = getSkillTypeTag(sk);
        skillHtml += `<div class="placement-skill-line"><span style="color:#a78bfa">스킬: ${sk.name} (${sk.cost}SP)</span> ${skTag}</div>`;
        skillHtml += `<div class="placement-skill-desc">${sk.desc}</div>`;
      }
    } else if (pc.hasSkill) {
      const tag = getSkillTypeTagFromChar(pc);
      const skillDesc = getSkillDescForPiece(pc);
      skillHtml = `<div class="placement-skill-line"><span style="color:#a78bfa">스킬: ${pc.skillName} (${pc.skillCost}SP)</span> ${tag}</div>`;
      skillHtml += `<div class="placement-skill-desc">${skillDesc}</div>`;
    }
    const passiveTagHtml = '<span class="skill-tag tag-passive">패시브</span>';
    let passiveHtml = '';
    if (pc.passives && pc.passives.length > 0) {
      for (const pid of pc.passives) {
        const name = getPassiveName(pid);
        const desc = getPassiveLabel(pid);
        passiveHtml += `<div class="placement-skill-line" style="color:#f59e0b">패시브: ${name} ${passiveTagHtml}</div>`;
        passiveHtml += `<div class="placement-skill-desc">${desc}</div>`;
      }
    } else if (pc.passiveName) {
      passiveHtml = `<div class="placement-skill-line" style="color:#f59e0b">패시브: ${pc.passiveName} ${passiveTagHtml}</div>`;
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
          ${!hasAnySkill && !hasAnyPassive ? '<div class="placement-skill-line" style="color:var(--muted)">스킬 없음</div>' : ''}
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

// 구 updatePlacementUI 로직 (사용 안함 — 위에서 대체)
function _updatePlacementUI_old() {
  const list = document.getElementById('placement-piece-list');
  list.innerHTML = '';
  for (let i = 0; i < S.myPieces.length; i++) {
    const pc = S.myPieces[i];
    const placed = pc.col >= 0;
    const card = document.createElement('div');
    card.className = `piece-card placement-detail-card ${placed ? 'placed' : ''} ${placementSelected === i ? 'selected' : ''}`;

    const grid = buildMiniRangeGrid(pc.type, { toggleState: pc.toggleState }, pc.icon);
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';

    // 스킬 정보
    let skillHtml = '';
    if (pc.skills && pc.skills.length > 1) {
      for (const sk of pc.skills) {
        const skTag = getSkillTypeTag(sk);
        skillHtml += `<div class="placement-skill-line"><span style="color:#a78bfa">스킬: ${sk.name} (${sk.cost}SP)</span> ${skTag}</div>`;
        skillHtml += `<div class="placement-skill-desc">${sk.desc}</div>`;
      }
    } else if (pc.hasSkill) {
      const tag = getSkillTypeTagFromChar(pc);
      const skillDesc = getSkillDescForPiece(pc);
      skillHtml = `<div class="placement-skill-line"><span style="color:#a78bfa">스킬: ${pc.skillName} (${pc.skillCost}SP)</span> ${tag}</div>`;
      skillHtml += `<div class="placement-skill-desc">${skillDesc}</div>`;
    }

    // 패시브 정보 — 툴팁과 동일: 주황색 "패시브: 이름" + 패시브 태그
    const passiveTagHtml = '<span class="skill-tag tag-passive">패시브</span>';
    let passiveHtml = '';
    if (pc.passives && pc.passives.length > 0) {
      for (const pid of pc.passives) {
        const name = getPassiveName(pid);
        const desc = getPassiveLabel(pid);
        passiveHtml += `<div class="placement-skill-line" style="color:#f59e0b">패시브: ${name} ${passiveTagHtml}</div>`;
        passiveHtml += `<div class="placement-skill-desc">${desc}</div>`;
      }
    } else if (pc.passiveName) {
      passiveHtml = `<div class="placement-skill-line" style="color:#f59e0b">패시브: ${pc.passiveName} ${passiveTagHtml}</div>`;
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
          ${skillHtml || (!hasAnyPassive ? '<div class="placement-skill-line" style="color:var(--muted)">스킬 없음</div>' : '')}
          ${passiveHtml}
        </div>
      </div>`;
    card.addEventListener('click', () => {
      placementSelected = i;
      updatePlacementUI();
      updatePlacementBoard();
    });
    list.appendChild(card);
  }

  const allPlaced = S.myPieces.every(p => p.col >= 0);
  document.getElementById('btn-placement-confirm').disabled = !allPlaced;
  updatePlacementBoard();
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

  // 팀전: 1v1과 동일 포맷 + 팀 레이블 + 턴 오더 표시
  if (S.isTeamMode && S.teamGamePlayers) {
    const cur = S.teamGamePlayers.find(p => p.idx === S.currentPlayerIdx);
    if (cur) {
      const isMine = cur.idx === S.playerIdx;
      const isAlly = cur.teamId === S.teamId;
      // 1v1과 동일한 class: my-turn (내 차례) / opp-turn (상대팀 차례). 팀원 턴은 opp-turn으로 간주
      banner.className = 'turn-banner ' + (isMine ? 'my-turn' : (!isAlly ? 'opp-turn' : ''));
      const teamLabel = cur.teamId === 0 ? 'A팀' : 'B팀';
      const whoseLabel = isMine ? '당신' : (isAlly ? `팀원 ${cur.name}` : cur.name);
      banner.innerHTML = `
        <div class="turn-banner-main">${S.turnNumber}턴 : [${teamLabel}] ${escapeHtmlGlobal(whoseLabel)}의 차례</div>
        <div class="turn-order-row">${renderTurnOrderDots()}</div>
      `;
      // 타이머 색상 토글 (1v1과 동일)
      const timerClock = document.querySelector('.timer-clock');
      if (timerClock) {
        timerClock.classList.toggle('my-turn-timer', isMine);
        timerClock.classList.toggle('opp-turn-timer', !isAlly);
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

// 팀전 턴 오더 — A팀·B팀 지그재그 4명 점으로 표시. 현재 플레이어 강조.
function renderTurnOrderDots() {
  if (!S.teamGamePlayers || !S.teamTeams) return '';
  const teamA = S.teamTeams[0] || [];
  const teamB = S.teamTeams[1] || [];
  const order = [];
  const maxLen = Math.max(teamA.length, teamB.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < teamA.length) order.push(teamA[i]);
    if (i < teamB.length) order.push(teamB[i]);
  }
  const parts = order.map(idx => {
    const pl = S.teamGamePlayers.find(p => p.idx === idx);
    if (!pl) return '';
    const isCurrent = idx === S.currentPlayerIdx;
    const isMe = idx === S.playerIdx;
    const isAlly = pl.teamId === S.teamId;
    const dead = pl.eliminated;
    const teamCls = pl.teamId === 0 ? 'team-a' : 'team-b';
    const cls = [
      'turn-order-dot', teamCls,
      isCurrent ? 'current' : '',
      isMe ? 'me' : '',
      dead ? 'eliminated' : '',
    ].filter(Boolean).join(' ');
    const suffix = isMe ? ' (나)' : isAlly ? '' : '';
    return `<span class="${cls}" title="${escapeHtmlGlobal(pl.name)}">${escapeHtmlGlobal(pl.name)}${suffix}</span>`;
  }).filter(Boolean);
  // 화살표로 연결
  return parts.join('<span class="turn-order-arrow">→</span>');
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

  const myInstantStr = myInstant > 0 ? ` (+${myInstant}✨)` : '';
  const oppInstantStr = oppInstant > 0 ? ` (+${oppInstant}✨)` : '';
  const myLabel = S.isTeamMode
    ? `우리팀 SP: ${mySP}${myInstantStr}`
    : `내 SP: ${mySP}${myInstantStr}`;
  const oppLabel = S.isTeamMode
    ? `상대팀 SP: ${oppSP}${oppInstantStr}`
    : `상대 SP: ${oppSP}${oppInstantStr}`;
  document.getElementById('sp-my-label').textContent = myLabel;
  document.getElementById('sp-opp-label').textContent = oppLabel;
  document.getElementById('sp-my-fill').style.width = `${(mySP / total) * 100}%`;
  document.getElementById('sp-opp-fill').style.width = `${(oppSP / total) * 100}%`;

  // SP 카운트다운 표시
  const spCountdown = document.getElementById('sp-countdown');
  if (spCountdown && S.turnNumber) {
    if (S.turnNumber >= 40) {
      spCountdown.textContent = 'SP 지급 종료 (40턴 이후)';
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

  if (!enabled) {
    // 상대 턴 — 모두 비활성화
    btnMove.disabled = true;
    btnAttack.disabled = true;
    btnSkill.disabled = true;
    btnEnd.disabled = true;
    btnSurrender.disabled = true;
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
    const mySp = (S.sp[S.playerIdx] || 0) + (S.instantSp[S.playerIdx] || 0);
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

    // ── 자동 턴 종료 힌트 ──
    if (!canMove && !canAttack && !hasUsableSkill) {
      setActionHint('더 이상 할 수 있는 행동이 없습니다. 턴을 종료하세요.');
      return;
    }
  }
  document.getElementById('btn-cancel').classList.add('hidden');
  setActionHint(enabled ? '행동을 선택하세요.' : `${oppN()}의 턴입니다.`);
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
      cell.innerHTML += `
        <div class="piece-marker${dimClass ? ' ' + dimClass : ''}">
          <span class="p-icon">${displayIcon}</span>
          <span class="p-hp">${hpText}</span>
        </div>`;
      if (statusIcons) cell.innerHTML += `<span class="cell-mark">${statusIcons}</span>`;
      cell.classList.add('has-piece');
      if (isTwinDimmed) cell.classList.add('twin-dimmed-cell');
      else if (lockedDim) cell.classList.add('locked-dim-cell');
      const idx = S.myPieces.indexOf(pc);
      if (idx === S.selectedPiece) cell.classList.add('selected-piece');
    }

    // 표식 상태인 적 — 위치 공개
    const markedOpp = S.oppPieces?.find(p => p.marked && p.alive && p.col === col && p.row === row);
    if (markedOpp && !pc) {
      cell.innerHTML += `
        <div class="piece-marker opp-marked">
          <span class="p-icon">${markedOpp.icon}</span>
          <span class="p-hp" style="color:#e05252">${markedOpp.hp}/${markedOpp.maxHp}</span>
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

    // 이동 범위
    if (S.action === 'move' && S.selectedPiece !== null) {
      const selPc = S.myPieces[S.selectedPiece];
      if (selPc && isCrossAdjacent(selPc.col, selPc.row, col, row) &&
          col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max) {
        cell.classList.add('move-range');
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
        renderOppPieces();
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
        // 기존 토큰 제거 (같은 말)
        S.deductionTokens = S.deductionTokens.filter(t => t.pieceKey !== data.pieceKey);
        // 새 위치에 배치
        S.deductionTokens.push({ pieceKey: data.pieceKey, icon: data.icon, name: data.name, col, row });
        refreshDeductionTokens();
        renderOppPieces();
      } catch (err) { /* ignore */ }
    });
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
      renderOppPieces();
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

// ── 내 말 정보 패널 ──────────────────────────────────────────
function renderMyPieces() {
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
    card.className = `my-piece-card ${pc.alive ? '' : 'dead'} ${isActive ? 'active-piece' : ''} ${lockedClass}`;
    const hpPct = pc.alive ? (pc.hp / pc.maxHp * 100) : 0;

    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const statusHtml = renderStatusBadges(pc);
    const skillHtml = pc.hasSkill
      ? `<div style="font-size:0.7rem;color:#a78bfa;margin-top:2px">스킬: ${pc.skillName} (${pc.skillCost}SP)</div>`
      : '';
    const passiveHtml = pc.passiveName
      ? `<div style="font-size:0.68rem;color:#f59e0b;margin-top:1px">패시브: ${pc.passiveName}</div>`
      : '';

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
    const atkDisplay = commanderBuff ? `${pc.atk}<span style="color:#22c55e">+1</span>` : `${pc.atk}`;
    const moraleHtml = commanderBuff ? '<span class="status-badge" style="color:#22c55e;background:rgba(34,197,94,0.15)">📋 사기증진</span>' : '';

    card.style.position = 'relative';
    card.innerHTML = `
      <div class="my-piece-header">
        <span class="p-icon">${pc.icon}</span>
        <strong>${pc.name}</strong>
        <span class="tier-badge">${pc.tier}T</span>
        ${tagHtml}
      </div>
      <div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--muted);display:flex;justify-content:space-between">
        <span>HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${atkDisplay}</span>
        <span class="my-piece-pos">${pc.alive ? `${coord(pc.col,pc.row)}` : '💀 격파'}</span>
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

// ── 상대 말 정보 ─────────────────────────────────────────────
function renderOppPieces() {
  const container = document.getElementById('opp-pieces-info');
  if (!container) return;
  container.innerHTML = '';
  if (!S.oppPieces) return;

  // 추리 토큰 정리: 사망한 말의 토큰 제거
  const aliveKeys = new Set(S.oppPieces.filter(p => p.alive).map(p => `${p.type}:${p.subUnit || ''}`));
  S.deductionTokens = S.deductionTokens.filter(t => aliveKeys.has(t.pieceKey));

  for (let pi = 0; pi < S.oppPieces.length; pi++) {
    const pc = S.oppPieces[pi];
    const card = document.createElement('div');
    card.className = `opp-piece-card ${pc.alive ? '' : 'dead'}`;
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
    const tagHtml = pc.tag ? tagBadgeHtml(pc.tag) : '';
    const statusHtml = renderStatusBadges(pc);
    const skillHtml = pc.hasSkill
      ? `<div style="font-size:0.7rem;color:#a78bfa;margin-top:2px">스킬: ${pc.skillName} (${pc.skillCost || '?'}SP)</div>`
      : '';
    const passiveHtml = pc.passiveName
      ? `<div style="font-size:0.68rem;color:#f59e0b;margin-top:1px">패시브: ${pc.passiveName}</div>`
      : '';
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

    card.innerHTML = `
      <div class="my-piece-header">
        <span class="p-icon">${pc.icon}</span>
        <strong>${pc.name}</strong>
        <span class="tier-badge">${pc.tier}T</span>
        ${tagHtml}
        ${placedBadge}
      </div>
      <div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--muted);display:flex;justify-content:space-between">
        <span>HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${pc.atk}</span>
        <span style="color:${pc.alive ? 'var(--success)' : 'var(--danger)'}; font-size:0.68rem">
          ${pc.alive ? (pc.marked ? `📍${coord(pc.col,pc.row)}` : '생존') : '💀 격파'}
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

  // 스킬 표시 — skills 배열 우선, 없으면 hasSkill/skillName 폴백
  let skillHtml = '';
  const hasActiveSkill = (pc.skills && pc.skills.length > 0) || pc.hasSkill;
  const hasPassive = (pc.passives && pc.passives.length > 0) || pc.passiveName;
  if (pc.skills && pc.skills.length > 0) {
    for (const sk of pc.skills) {
      const skTag = getSkillTypeTag(sk);
      skillHtml += `<div class="tooltip-line skill-color">스킬: ${sk.name} (${sk.cost}SP) ${skTag}</div>`;
      skillHtml += `<div class="tooltip-line" style="font-size:0.65rem;color:var(--text-dim)">${sk.desc}</div>`;
    }
  } else if (pc.hasSkill) {
    const tag = getSkillTypeTagFromChar(pc);
    const skillDesc = getSkillDescForPiece(pc);
    skillHtml = `<div class="tooltip-line skill-color">스킬: ${pc.skillName} (${pc.skillCost}SP) ${tag}</div>`;
    skillHtml += `<div class="tooltip-line" style="font-size:0.65rem;color:var(--text-dim)">${skillDesc}</div>`;
  } else if (!hasPassive) {
    // 액티브 스킬도, 패시브도 없을 때만 "스킬 없음"
    skillHtml = '<div class="tooltip-line" style="color:var(--muted)">스킬 없음</div>';
  }

  // 패시브 — 스킬 라인과 동일 포맷: 주황색 "패시브: 이름" + 패시브 태그
  let passiveHtml = '';
  const passiveTag = '<span class="skill-tag tag-passive">패시브</span>';
  if (pc.passives && pc.passives.length > 0) {
    for (const pid of pc.passives) {
      const name = getPassiveName(pid);
      const desc = getPassiveLabel(pid);
      passiveHtml += `<div class="tooltip-line passive-color">패시브: ${name} ${passiveTag}</div>`;
      passiveHtml += `<div class="tooltip-line" style="font-size:0.65rem;color:var(--text-dim)">${desc}</div>`;
    }
  } else if (pc.passiveName) {
    passiveHtml = `<div class="tooltip-line passive-color">패시브: ${pc.passiveName} ${passiveTag}</div>`;
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
    <div class="tooltip-title">${pc.icon} ${pc.name} (T${pc.tier})</div>
    <div class="tooltip-section">
      <div class="tooltip-label">공격 범위</div>
      ${grid}
      <div class="tooltip-desc">ATK ${pc.atk}</div>
    </div>
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
  // 취소 버튼도 함께 글로우 — 행동 모드 진입 표시
  if (btnCancel) btnCancel.classList.toggle('action-active', mode !== null);
}

function resetAction() {
  S.action = null;
  S.selectedPiece = null;
  S.targetSelectMode = false;
  S.skillTargetData = null;
  document.getElementById('btn-cancel').classList.add('hidden');
  const hint = document.getElementById('action-hint');
  if (hint) hint.textContent = '행동을 선택하세요.';
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
  document.getElementById('btn-cancel').classList.remove('hidden');
  document.getElementById('action-hint').textContent = '이동할 유닛을 클릭하세요.';
  setActionButtonMode('move');
  renderGameBoard();
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
  // 쌍둥이 한쪽만 이동해도 정상 턴 종료 — 모달 없음 (옵션이므로)
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
  if (!S.moveDone && !S.actionDone) {
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

function openSkillModal() {
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-modal-body');
  body.innerHTML = '';

  const mySP = S.sp[S.playerIdx] || 0;
  const myInstant = (S.instantSp && S.instantSp[S.playerIdx]) || 0;
  const totalSP = mySP + myInstant;
  let hasAnySkill = false;

  // 남매(twins): 분신은 한 쌍에 1회만 표시 — 첫 번째 등장(주로 elder)에서만 출력
  let twinSkillShown = false;
  for (let i = 0; i < S.myPieces.length; i++) {
    const pc = S.myPieces[i];
    if (!pc.alive || !pc.hasSkill) continue;
    if (pc.type === 'twins_elder' || pc.type === 'twins_younger') {
      if (twinSkillShown) continue;
      twinSkillShown = true;
    }
    hasAnySkill = true;

    // 다중 스킬 지원 (화약상 등): skills 배열이 있으면 각각 표시
    const skillList = pc.skills && pc.skills.length > 1 ? pc.skills : null;

    if (skillList) {
      // 다중 스킬: 각 스킬을 별도 옵션으로 표시
      for (const sk of skillList) {
        const canAfford = totalSP >= sk.cost;
        const instantLabel = myInstant > 0 ? ` + ✨${myInstant}` : '';

        // 행동소비형인데 이미 행동했으면 비활성화
        let extraDisabled = false;
        let extraNote = '';
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
      // 쌍둥이 분신: 두 명 모두 살아있어야 사용 가능
      let twinsDisabled = false;
      if (pc.type === 'twins_elder' || pc.type === 'twins_younger') {
        const elderAlive = S.myPieces.some(p => p.subUnit === 'elder' && p.alive);
        const youngerAlive = S.myPieces.some(p => p.subUnit === 'younger' && p.alive);
        if (!elderAlive || !youngerAlive) {
          twinsDisabled = true;
          singleDisabled = true;
          singleNote = ' (사용 불가)';
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
      opt.innerHTML = `
        <div class="skill-name">${pc.icon} ${pc.name} — ${pc.skillName} ${singleTag}</div>
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
      S.skillTargetData = { pieceIdx, skillId: 'ring', type: 'king_move', targetName: opc.type };
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
        socket.emit('use_skill', { pieceIdx, skillId: 'curse', params: { targetPieceIdx: i } });
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

function handleGameCellClick(col, row) {
  if (!S.isMyTurn) return;
  const bounds = S.boardBounds;
  if (col < bounds.min || col > bounds.max || row < bounds.min || row > bounds.max) return;

  // ── 스킬 대상 선택 모드 ──
  if (S.action === 'skill_target' && S.skillTargetData) {
    const data = S.skillTargetData;
    if (data.type === 'bomb_place') {
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params: { col, row } });
    } else if (data.type === 'dragon_place') {
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params: { col, row } });
    } else if (data.type === 'king_move') {
      socket.emit('use_skill', { pieceIdx: data.pieceIdx, skillId: data.skillId, params: { targetName: data.targetName, col, row } });
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
      // 다른 내 말 클릭 → 선택 변경
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
      // 같은 말 또는 범위 내 클릭 → 공격 확정
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

function addLog(msg, type = 'system') {
  const log = document.getElementById('game-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="turn-num">T${S.turnNumber}</span> ${msg}`;
  log.prepend(entry);
  while (log.children.length > 50) log.removeChild(log.lastChild);
}

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
    instantMagic: '피격마다 1회용 SP를 1개 획득',
    ironSkin: '받는 피해가 0.5 감소',
    grace: '악인 공격 시 공격력 3, 악인에게 피격 시 받는 피해 0.5로 감소',
    betrayer: '공격 시 아군도 1 피해',
    wrath: '인접한 아군 공격력 1 증가',
    markPassive: '공격 적중 시 대상에게 표식 부여',
    tyranny: '1티어와 2티어에게 받는 피해 0.5 감소',
    loyalty: '왕실 아군이 받을 피해를 1로 줄이고 모두 대신 받음',
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
      spCountdown.textContent = 'SP 지급 종료 (40턴 이후)';
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
  const leftPanel = document.getElementById('my-pieces-info');
  if (leftPanel) {
    document.querySelector('.left-panel h3').textContent = gs.p0Name;
    leftPanel.innerHTML = '';
    for (const pc of (gs.p0Pieces || [])) {
      const hpPct = pc.alive ? (pc.hp / pc.maxHp * 100) : 0;
      const div = document.createElement('div');
      div.className = `my-piece-card ${pc.alive ? '' : 'dead'}`;
      div.style.position = 'relative';
      div.innerHTML = `<span class="p-icon">${pc.icon}</span>
        <div><strong>${pc.name} <span style="font-size:0.65rem;color:var(--muted)">T${pc.tier}</span></strong>
        <div class="hp-bar-bg"><div class="hp-bar ${hpPct <= 25 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
        <span style="font-size:0.72rem">HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${pc.atk}</span></div>`;
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
    for (const pc of (gs.p1Pieces || [])) {
      const hpPct = pc.alive ? (pc.hp / pc.maxHp * 100) : 0;
      const div = document.createElement('div');
      div.className = `opp-piece-card ${pc.alive ? '' : 'dead'}`;
      div.style.position = 'relative';
      div.innerHTML = `<span class="p-icon">${pc.icon}</span>
        <div class="opp-info"><strong>${pc.name} <span style="font-size:0.65rem;color:var(--muted)">T${pc.tier}</span></strong>
        <div class="hp-bar-bg"><div class="hp-bar ${hpPct <= 25 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
        <span style="font-size:0.72rem">HP ${pc.alive ? pc.hp : 0}/${pc.maxHp} · ATK ${pc.atk}</span></div>`;
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
    container.style.cssText = `
      position:fixed; top:60px; left:50%; transform:translateX(-50%);
      z-index:2000; pointer-events:none; display:flex; flex-direction:column;
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

  if (S.isSpectator && specPlayerIdx !== undefined) {
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
  toast.textContent = msg;

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
  _toastQueue.push({ msg, isEnemy, specPlayerIdx, toastType });
  if (!_toastProcessing) _processToastQueue();
}

// ── 턴 보드 테두리 전환 ──
function setTurnBackground(isMyTurn) {
  const board = document.getElementById('game-board');
  if (board) {
    board.style.transition = 'border-color 0.5s, box-shadow 0.5s';
    board.style.borderColor = isMyTurn ? '#3b82f6' : '#ef4444';
    board.style.borderWidth = '3px';
    board.style.boxShadow = isMyTurn
      ? '0 0 15px rgba(59,130,246,0.3), inset 0 0 10px rgba(59,130,246,0.05)'
      : '0 0 15px rgba(239,68,68,0.3), inset 0 0 10px rgba(239,68,68,0.05)';
  }
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
      if (cards[idx]) {
        cards[idx].classList.remove('profile-hit');
        void cards[idx].offsetWidth; // reflow to restart animation
        cards[idx].classList.add('profile-hit');
        setTimeout(() => cards[idx].classList.remove('profile-hit'), 1800);
      }
    }
  });
}

// 좌표/이름으로 피스 배열에서 인덱스 찾기 (살아있는 유닛만)
function findPieceIndices(pieces, hitList, matchByCoord = true) {
  const indices = [];
  for (const h of hitList) {
    let idx = -1;
    if (matchByCoord && h.col !== undefined && h.row !== undefined) {
      idx = pieces.findIndex(p => p.alive && p.col === h.col && p.row === h.row);
    }
    if (idx < 0 && h.name) {
      idx = pieces.findIndex(p => p.alive && p.name === h.name);
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
}

// ── 캐릭터 등장 사운드 (둥-) ──
// ── 쥐 격파 사운드 (꽥!) ──
function playSfxRatDeath() {
  if (sfxMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
// ── 악몽(고문 기술자) 전용 효과음 — 쇠사슬 + 채찍 + 저음 임팩트 ──
function playSfxNightmare() {
  if (sfxMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const out = ctx.destination;

    // ① 쇠사슬 짤랑임 — 짧고 빠른 메탈릭 노이즈 펄스 4회
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.06;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 4500;
      bp.Q.value = 6;
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 0.05);
    }

    // ② 채찍 휘둘림 — 고음에서 낮게 떨어지는 노이즈 스윕
    const whipStart = now + 0.28;
    const whipBuf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
    const wd = whipBuf.getChannelData(0);
    for (let j = 0; j < wd.length; j++) wd[j] = (Math.random() * 2 - 1);
    const whip = ctx.createBufferSource();
    whip.buffer = whipBuf;
    const whipG = ctx.createGain();
    whipG.gain.setValueAtTime(0.001, whipStart);
    whipG.gain.linearRampToValueAtTime(0.22, whipStart + 0.05);
    whipG.gain.exponentialRampToValueAtTime(0.001, whipStart + 0.18);
    const whipFilter = ctx.createBiquadFilter();
    whipFilter.type = 'bandpass';
    whipFilter.frequency.setValueAtTime(8000, whipStart);
    whipFilter.frequency.exponentialRampToValueAtTime(800, whipStart + 0.15);
    whipFilter.Q.value = 3;
    whip.connect(whipFilter); whipFilter.connect(whipG); whipG.connect(out);
    whip.start(whipStart); whip.stop(whipStart + 0.18);

    // ③ 저음 임팩트 — 무겁게 가라앉는 마무리
    const boomStart = now + 0.42;
    const boom = ctx.createOscillator();
    const boomG = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(110, boomStart);
    boom.frequency.exponentialRampToValueAtTime(40, boomStart + 0.45);
    boomG.gain.setValueAtTime(0.22, boomStart);
    boomG.gain.exponentialRampToValueAtTime(0.001, boomStart + 0.55);
    boom.connect(boomG); boomG.connect(out);
    boom.start(boomStart); boom.stop(boomStart + 0.55);

    // ④ 어두운 마이너 화음 (지속 톤)
    const chordT = now + 0.45;
    const minorChord = [220, 261.63, 329.63];  // A3 / C4 / E4
    for (const f of minorChord) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.06, chordT);
      g.gain.exponentialRampToValueAtTime(0.001, chordT + 0.6);
      o.connect(g); g.connect(out);
      o.start(chordT); o.stop(chordT + 0.65);
    }
  } catch (e) {}
}

// ── 패시브 발동 전용 효과음 — 부드러운 2음 차임 ──
function playSfxPassive() {
  if (sfxMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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

function playTurnBell() {
  if (sfxMuted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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

// 첫 사용자 인터랙션 시 현재 화면에 맞는 BGM 자동 재생
document.addEventListener('click', function _bgmFirstClick() {
  document.removeEventListener('click', _bgmFirstClick);
  if (!BGM.currentTrack) {
    const active = document.querySelector('.screen.active');
    if (active) {
      const id = active.id;
      if (id === 'screen-lobby') bgmPlay('lobby');
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

  // 현재 선택된 채팅 범위 ('all' or 'team')
  let currentChatScope = 'all';
  const scopeTabs = document.getElementById('chat-scope-tabs');
  const scopeAllBtn = document.getElementById('chat-scope-all');
  const scopeTeamBtn = document.getElementById('chat-scope-team');
  function showChatScopeTabs() {
    if (scopeTabs) scopeTabs.classList.remove('hidden');
  }
  function hideChatScopeTabs() {
    if (scopeTabs) scopeTabs.classList.add('hidden');
    currentChatScope = 'all';
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
  });
  if (scopeTeamBtn) scopeTeamBtn.addEventListener('click', () => {
    if (!S.isTeamMode) {
      showSkillToast('팀전 모드에서만 팀 채팅을 사용할 수 있습니다.', false, undefined, 'event');
      return;
    }
    currentChatScope = 'team';
    scopeTeamBtn.classList.add('active'); scopeAllBtn?.classList.remove('active');
    if (input) input.placeholder = '메시지 입력 (팀)...';
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
    // 팀 표시 (A/B)
    let teamBadge = '';
    if (S.isTeamMode && (teamId === 0 || teamId === 1)) {
      teamBadge = `<span class="scope-badge ${teamId === 0 ? 'all' : 'all'}" style="color:${teamId === 0 ? '#60a5fa' : '#ef4444'}">${teamId === 0 ? 'A' : 'B'}</span>`;
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
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;

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
