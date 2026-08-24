// ═══════════════════════════════════════════════════════════════
// CALIGO — 클라이언트 로그인(구글 OAuth via Supabase)
// ───────────────────────────────────────────────────────────────
// 서버에 키가 없으면(/api/config → null) 조용히 게스트 모드로 동작:
// 로그인 바를 숨기고 기존 localStorage 흐름 그대로 유지.
// 전역 window.CaligoAuth 로 상태/메서드 노출.
// ═══════════════════════════════════════════════════════════════
(function () {
  // ── 1회성 덱 리셋 (가챠/소유권 도입) ──
  //   기존 덱이 새 보유 시스템과 헷갈릴 수 있어 로컬 저장 덱을 한 번 비운다.
  //   (서버 덱은 별도로 정리됨.) 브라우저당 1회만 — 플래그로 반복 방지.
  //   ★ setItem 프록시 정의 전에 실행 → 동기화 트리거 없음.
  try {
    if (!localStorage.getItem('caligo_deck_reset_v1')) {
      localStorage.removeItem('caligo_my_deck');
      localStorage.removeItem('caligo_deck_list');
      localStorage.setItem('caligo_deck_reset_v1', '1');
    }
  } catch (e) {}

  // 로그인 없이도 항상 보유하는 기본 9종 (서버 /api/config.base 를 우선 사용, 실패 시 이 폴백)
  const DEFAULT_BASE = ['spearman', 'manhunter', 'herbalist', 'knight', 'shadowAssassin', 'wizard', 'prince', 'slaughterHero', 'dragonTamer'];

  const Auth = {
    enabled: false,    // 로그인 기능 사용 가능 여부 (공개설정 존재)
    sb: null,          // supabase 클라이언트
    user: null,        // { id, email, name, avatar }
    token: null,       // access_token (JWT) — 소켓 인증용
    ready: false,
    // ── 지갑/보유 ──
    base: DEFAULT_BASE.slice(),   // 기본 공개 9종
    owned: [],                    // 가챠로 획득한 type 목록 (로그인 시만 채워짐)
    credits: 0,
    tierCost: { 1: 10, 2: 20, 3: 30 },
    ownedSet: new Set(DEFAULT_BASE),   // 유효 보유 = base ∪ owned (게이팅 기준)
    _listeners: [],
    _walletListeners: [],
    onChange(fn) { this._listeners.push(fn); if (this.ready) { try { fn(this.user); } catch (e) {} } },
    _emit() { this._listeners.forEach(fn => { try { fn(this.user); } catch (e) {} }); },
    // 지갑 변경 구독 (덱빌더/딕셔너리/가챠 UI 갱신용)
    onWallet(fn) { this._walletListeners.push(fn); try { fn(this.wallet()); } catch (e) {} },
    _emitWallet() { const w = this.wallet(); this._walletListeners.forEach(fn => { try { fn(w); } catch (e) {} }); },
    wallet() { return { credits: this.credits, owned: this.owned.slice(), base: this.base.slice(), ownedSet: this.ownedSet, loggedIn: !!this.user }; },
    isOwned(type) { return this.ownedSet.has(type); },
    _recompute() { this.ownedSet = new Set([...this.base, ...this.owned]); this._emitWallet(); },
  };
  window.CaligoAuth = Auth;

  // 크레딧 변동 시 로비 계정 옆 배지 실시간 갱신 (로그인 시에만 존재)
  Auth.onWallet(function () {
    const el = document.getElementById('auth-credit');
    if (el) el.textContent = '✦ ' + Auth.credits;
  });

  // ── 계정 동기화 (localStorage ↔ DB) ──────────────────────────
  const SYNC_KEYS = ['caligo_nickname', 'caligo_my_deck', 'caligo_deck_list', 'caligo_chat_muted'];
  let _suppressSync = false;   // 서버→로컬 적용 중엔 푸시 안 함
  let _pushTimer = null;
  let _syncedUser = null;      // account_load 중복 방지

  // localStorage.setItem 프록시: 동기화 키가 바뀌고 로그인 상태면 서버로 디바운스 푸시
  const _setItem = localStorage.setItem.bind(localStorage);
  try {
    localStorage.setItem = function (k, v) {
      _setItem(k, v);
      if (!_suppressSync && Auth.user && SYNC_KEYS.indexOf(k) !== -1) schedulePush();
    };
  } catch (e) {}

  function _safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function localSnapshot() {
    return {
      nickname: localStorage.getItem('caligo_nickname') || '',
      settings: {
        chatMuted: localStorage.getItem('caligo_chat_muted') || '0',
        deck: _safeParse(localStorage.getItem('caligo_my_deck')),
        deckList: _safeParse(localStorage.getItem('caligo_deck_list')),
      },
    };
  }

  function schedulePush() {
    if (!Auth.user || !window.socket) return;
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      try { window.socket.emit('account_save', localSnapshot()); } catch (e) {}
    }, 800);
  }

  function settingsHasDeck(s) {
    if (!s) return false;
    if (s.deck && (s.deck.t1 || s.deck.t2 || s.deck.t3)) return true;
    if (Array.isArray(s.deckList) && s.deckList.some(x => x && (x.t1 || x.t2 || x.t3))) return true;
    return false;
  }

  // 서버 계정 데이터 → 로컬 반영 (푸시 트리거 없이) + 로비 새로고침
  function applyAccount(acc) {
    if (!acc) return;
    _suppressSync = true;
    try {
      const s = acc.settings || {};
      if (acc.nickname) _setItem('caligo_nickname', acc.nickname);
      if (s.chatMuted != null) _setItem('caligo_chat_muted', String(s.chatMuted));
      if (s.deck) _setItem('caligo_my_deck', JSON.stringify(s.deck));
      if (s.deckList) _setItem('caligo_deck_list', JSON.stringify(s.deckList));
    } finally { _suppressSync = false; }
    refreshLobby(acc);
  }

  function refreshLobby(acc) {
    try {
      const nameInput = document.getElementById('input-name');
      if (nameInput && acc && acc.nickname) nameInput.value = acc.nickname;
    } catch (e) {}
    try { if (typeof window.updateLobbyDeckButton === 'function') window.updateLobbyDeckButton(); } catch (e) {}
    try { if (typeof window.renderDeckList === 'function') window.renderDeckList(); } catch (e) {}
  }

  // 로그인 직후: 계정 로드 → 비었으면 게스트 데이터 흡수, 있으면 로컬에 반영
  function syncOnLogin(userId) {
    if (!window.socket || _syncedUser === userId) return;
    _syncedUser = userId;
    window.socket.emit('account_load');
  }
  function onAccountData(msg) {
    if (!msg) return;
    if (Array.isArray(msg.base) && msg.base.length) Auth.base = msg.base;
    // 지갑(크레딧+보유) 반영 — 로그인 계정이면 account 에 실려옴
    if (msg.account) {
      Auth.credits = (typeof msg.account.credits === 'number') ? msg.account.credits : Auth.credits;
      Auth.owned = Array.isArray(msg.account.owned) ? msg.account.owned : Auth.owned;
    }
    Auth._recompute();
    if (!msg.ok || !msg.account) return;
    const acc = msg.account;
    // 계정에 덱이 없으면 = 첫 로그인 → 이 기기 게스트 데이터(덱+닉네임) 흡수.
    // 덱이 있으면 = 계정이 소스 → 로컬에 풀.
    if (!settingsHasDeck(acc.settings)) {
      try { window.socket.emit('account_save', localSnapshot()); } catch (e) {}
    } else {
      applyAccount(acc);
    }
  }

  async function init() {
    let cfg = null;
    try {
      const r = await fetch('/api/config');
      const j = await r.json();
      cfg = j.supabase;
      if (Array.isArray(j.base) && j.base.length) Auth.base = j.base;   // 서버 기준 기본9
      if (j.tierCost) Auth.tierCost = j.tierCost;
      Auth._recompute();   // 게스트 기본: ownedSet = base
    } catch (e) { /* 서버 응답 없음 → 게스트 */ }

    if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) {
      Auth.enabled = false; Auth.ready = true;
      renderBar(); Auth._emit();
      return;
    }

    Auth.enabled = true;
    wireSocket();
    Auth.sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    // 리다이렉트로 돌아온 직후 URL 해시(#access_token=...) 정리 + 세션 로드
    try {
      const { data } = await Auth.sb.auth.getSession();
      applySession(data && data.session, true);
    } catch (e) { applySession(null, true); }

    // 로그인/로그아웃/토큰갱신 구독
    Auth.sb.auth.onAuthStateChange((_event, session) => applySession(session, false));
  }

  function applySession(session, first) {
    if (session && session.user) {
      const u = session.user;
      const m = u.user_metadata || {};
      Auth.user = {
        id: u.id,
        email: u.email || '',
        name: m.name || m.full_name || (u.email ? u.email.split('@')[0] : '플레이어'),
        avatar: m.avatar_url || m.picture || '',
      };
      Auth.token = session.access_token || null;
    } else {
      Auth.user = null;
      Auth.token = null;
      Auth.owned = []; Auth.credits = 0; Auth._recompute();   // 로그아웃 → 기본9만
    }
    Auth.ready = true;
    renderBar();
    pushAuthToSocket();
    Auth._emit();
  }

  // 로그인 상태를 소켓으로 전송 → 서버가 계정 바인딩(또는 게스트 해제)
  let _lastPushedToken;
  function pushAuthToSocket() {
    const s = window.socket;
    if (!s) return;
    const tok = Auth.token || null;
    if (tok === _lastPushedToken) return;   // applySession 중복 emit 억제
    _lastPushedToken = tok;
    if (tok) s.emit('auth_login', { token: tok });
    else { s.emit('auth_logout'); _syncedUser = null; }
  }
  // 소켓 연결/재연결 시 인증 재전송 + 계정 동기화 이벤트 구독
  function wireSocket() {
    const s = window.socket;
    if (!s || s._caligoAuthWired) return;
    s._caligoAuthWired = true;
    s.on('connect', () => { _lastPushedToken = undefined; pushAuthToSocket(); });  // 재연결 시 강제 재전송
    s.on('auth_ok', (d) => { if (d && d.userId) syncOnLogin(d.userId); });
    s.on('account_data', onAccountData);
    // ── 지갑 상태 중앙 갱신 (게이팅/가챠 UI 는 onWallet 구독) ──
    s.on('wallet_data', (d) => {
      if (!d) return;
      if (typeof d.credits === 'number') Auth.credits = d.credits;
      if (Array.isArray(d.owned)) Auth.owned = d.owned;
      if (Array.isArray(d.base) && d.base.length) Auth.base = d.base;
      Auth._recompute();
    });
    s.on('gacha_result', (d) => {
      if (!d) return;
      if (typeof d.credits === 'number') Auth.credits = d.credits;
      if (d.ok && d.drawn && Auth.owned.indexOf(d.drawn) < 0) Auth.owned.push(d.drawn);
      Auth._recompute();   // 새 캐릭터 즉시 보유 반영 (덱빌더/딕셔너리 갱신)
    });
    s.on('credit_reward', (d) => { if (d && typeof d.credits === 'number') { Auth.credits = d.credits; Auth._emitWallet(); } });
    s.on('attendance_result', (d) => { if (d && d.ok && typeof d.credits === 'number') { Auth.credits = d.credits; Auth._emitWallet(); } });
  }

  Auth.signIn = async function () {
    if (!Auth.enabled || !Auth.sb) return;
    await Auth.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  };
  Auth.signOut = async function () {
    if (!Auth.enabled || !Auth.sb) return;
    await Auth.sb.auth.signOut();
  };

  // ── 로비 로그인 바 렌더 ──
  function renderBar() {
    const bar = document.getElementById('auth-bar');
    if (!bar) return;
    if (!Auth.enabled) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    if (Auth.user) {
      const av = Auth.user.avatar
        ? `<img class="auth-avatar" src="${esc(Auth.user.avatar)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="auth-avatar auth-avatar-blank">${esc((Auth.user.name[0] || '?').toUpperCase())}</span>`;
      bar.innerHTML =
        `<div class="auth-user">${av}<span class="auth-name">${esc(Auth.user.name)}</span>` +
          `<span class="auth-credit" id="auth-credit" title="보유 크레딧">✦ ${Auth.credits}</span></div>` +
        `<button id="auth-signout" class="btn-auth-out" type="button">로그아웃</button>`;
      const out = document.getElementById('auth-signout');
      if (out) out.onclick = () => Auth.signOut();
    } else {
      bar.innerHTML =
        `<button id="auth-signin" class="btn-auth-google" type="button">${GOOGLE_G}<span>구글로 로그인</span></button>`;
      const inb = document.getElementById('auth-signin');
      if (inb) inb.onclick = () => Auth.signIn();
    }
  }

  const GOOGLE_G =
    '<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92A8.78 8.78 0 0 0 17.64 9.2z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.01-2.34z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>' +
    '</svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
