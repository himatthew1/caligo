// ═══════════════════════════════════════════════════════════════
// CALIGO — 서버측 계정 데이터 접근 (Supabase, service_role)
// ───────────────────────────────────────────────────────────────
// 닉네임 + 설정 + 덱(jsonb) 은 profiles 에, 전적은 stats 에 저장.
// (덱은 5슬롯 고정 모델이라 정규화 대신 profiles.settings jsonb 에 통째 보관)
// admin 없으면 모든 함수 no-op → 게스트 모드 안전.
// ═══════════════════════════════════════════════════════════════
const supa = require('./supabase-admin');

function nowIso() { return new Date().toISOString(); }

// 계정 전체 로드 → { nickname, settings, stats } | null
async function loadAccount(userId) {
  const admin = supa.admin;
  if (!admin || !userId) return null;
  try {
    const { data: prof, error } = await admin
      .from('profiles').select('nickname, settings').eq('id', userId).maybeSingle();
    if (error) { console.error('[data] loadAccount profiles:', error.message); }
    let stats = null;
    try {
      const r = await admin.from('stats')
        .select('wins, losses, draws, records').eq('user_id', userId).maybeSingle();
      stats = r.data || null;
    } catch (e) {}
    return {
      nickname: (prof && prof.nickname) || '',
      settings: (prof && prof.settings) || {},
      stats: stats || { wins: 0, losses: 0, draws: 0, records: {} },
    };
  } catch (e) {
    console.error('[data] loadAccount:', e.message);
    return null;
  }
}

// 닉네임/설정(+덱 포함) 저장 (upsert)
async function saveAccount(userId, payload) {
  const admin = supa.admin;
  if (!admin || !userId || !payload) return false;
  try {
    const patch = { id: userId, updated_at: nowIso() };
    // 닉네임은 비어있지 않을 때만 갱신 (빈 값으로 트리거 기본값을 지우지 않도록)
    if (typeof payload.nickname === 'string' && payload.nickname.trim()) patch.nickname = payload.nickname.slice(0, 12);
    if (payload.settings && typeof payload.settings === 'object') patch.settings = payload.settings;
    const { error } = await admin.from('profiles').upsert(patch, { onConflict: 'id' });
    if (error) { console.error('[data] saveAccount:', error.message); return false; }
    return true;
  } catch (e) {
    console.error('[data] saveAccount:', e.message);
    return false;
  }
}

// 전적 1 증가 (result: 'win' | 'loss' | 'draw')
async function bumpStats(userId, result) {
  const admin = supa.admin;
  if (!admin || !userId) return;
  const col = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : result === 'draw' ? 'draws' : null;
  if (!col) return;
  try {
    const { data } = await admin.from('stats')
      .select('wins, losses, draws').eq('user_id', userId).maybeSingle();
    const cur = data || { wins: 0, losses: 0, draws: 0 };
    cur[col] = (cur[col] || 0) + 1;
    await admin.from('stats').upsert(
      { user_id: userId, wins: cur.wins, losses: cur.losses, draws: cur.draws, updated_at: nowIso() },
      { onConflict: 'user_id' });
  } catch (e) {
    console.error('[data] bumpStats:', e.message);
  }
}

module.exports = { loadAccount, saveAccount, bumpStats };
