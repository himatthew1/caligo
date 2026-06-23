// ═══════════════════════════════════════════════════════════════
// CALIGO — AI 학습용 대국 로깅 (Supabase)
// ───────────────────────────────────────────────────────────────
// vs-AI 게임이 끝나면 한 판의 전체 기보(턴별 AI belief + 보드 truth + 결과)를
// match_log 테이블에 1행으로 적재. admin(service_role) 없으면 no-op.
// 분석은 서버측에서 admin 으로 쿼리 (RLS 로 클라 직접 접근 차단).
// ═══════════════════════════════════════════════════════════════
const supa = require('./supabase-admin');

function enabled() { return supa.enabled(); }

async function saveMatchLog(record) {
  const admin = supa.admin;
  if (!admin || !record) return;
  try {
    const { error } = await admin.from('match_log').insert({
      mode: record.mode,
      player_id: record.player_id || null,
      result: record.result,
      turns: record.turns || 0,
      replay: record.replay || null,
      created_at: new Date().toISOString(),
    });
    if (error) console.error('[aiLog] insert:', error.message);
    else console.log(`[aiLog] 대국 기록 저장 (${record.mode}, ${record.result}, ${record.turns}턴)`);
  } catch (e) { console.error('[aiLog] saveMatchLog:', e.message); }
}

module.exports = { enabled, saveMatchLog };
