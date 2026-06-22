// ═══════════════════════════════════════════════════════════════
// CALIGO — 서버용 Supabase 관리 클라이언트 (service_role)
// ───────────────────────────────────────────────────────────────
// 환경변수가 없으면 admin=null → 로그인 기능 전체 비활성, 게스트 플레이는
// 기존대로 정상 동작(안전한 점진 도입). 키를 .env 에 넣는 순간 활성화됨.
//
//   필요한 환경변수:
//     SUPABASE_URL            = https://xxxx.supabase.co   (공개)
//     SUPABASE_ANON_KEY       = eyJ...                      (공개, 클라 전달용)
//     SUPABASE_SERVICE_ROLE   = eyJ...                      (🔒 비밀, 서버 전용)
// ═══════════════════════════════════════════════════════════════

let createClient = null;
try { ({ createClient } = require('@supabase/supabase-js')); }
catch (e) { /* 패키지 미설치 시 graceful */ }

const URL          = process.env.SUPABASE_URL || '';
const ANON         = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';

let admin = null;
if (createClient && URL && SERVICE_ROLE) {
  admin = createClient(URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log('[supabase] admin client ready');
} else {
  const why = !createClient ? '패키지 미설치'
            : !URL ? 'SUPABASE_URL 없음'
            : 'SUPABASE_SERVICE_ROLE 없음';
  console.log(`[supabase] 비활성 (${why}) — 게스트 전용 모드`);
}

// admin: 서버측 JWT 검증·DB 접근 가능 여부 (service_role 필요)
const enabled = () => !!admin;
// public: 클라가 로그인 UI/OAuth 를 띄울 수 있는지 (URL+anon 만 있으면 됨)
const hasPublicConfig = () => !!(URL && ANON);

// 클라이언트에 내려보낼 공개 설정 (anon 키는 공개키라 노출 OK)
function publicConfig() {
  return hasPublicConfig() ? { url: URL, anonKey: ANON } : null;
}

// access_token(JWT) 검증 → Supabase user 객체 또는 null
//   { id, email, user_metadata:{name,avatar_url,...}, ... }
async function verifyJwt(token) {
  if (!admin || !token) return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (e) { return null; }
}

module.exports = { admin, enabled, hasPublicConfig, publicConfig, verifyJwt };
