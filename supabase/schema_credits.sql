-- ═══════════════════════════════════════════════════════════════
-- CALIGO 크레딧/가챠 시스템 — Supabase Postgres 스키마 추가분
-- 적용: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
--       (schema.sql 을 먼저 적용한 뒤 이 파일 실행. 모두 idempotent — 재실행 안전.)
-- ═══════════════════════════════════════════════════════════════

-- ── profiles 에 지갑/보유/출석 컬럼 추가 ─────────────────────────
--   credits     : 보유 크레딧 (신규/기존 계정 모두 기본 30 = 최초 지급)
--   owned       : 가챠로 획득한 캐릭터 type 목록 (기본 9종은 저장 안 함 — 항상 보유로 간주)
--   last_attend : 마지막 출석 날짜 (유저 로컬 'YYYY-MM-DD') — 자국 자정 기준 하루 1회
alter table public.profiles add column if not exists credits     int         not null default 30;
alter table public.profiles add column if not exists owned       text[]      not null default '{}'::text[];
alter table public.profiles add column if not exists last_attend text;

-- ── 가챠 뽑기 (원자적: 잔액확인 → 보유제외 랜덤 → 차감 → 지급) ─────
--   p_pool = 해당 티어의 뽑기 가능 풀(서버가 CHARACTERS − 기본9 로 계산해 전달).
--   반환 jsonb: {ok, reason?, drawn?, tier?, credits, remaining?}
create or replace function public.gacha_draw(p_user uuid, p_tier int, p_cost int, p_pool text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_credits int; v_owned text[]; v_cand text[]; v_pick text; v_n int;
begin
  select credits, owned into v_credits, v_owned from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_credits < p_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'credits', v_credits);
  end if;
  -- 후보 = 풀 − 이미 보유
  select array_agg(x) into v_cand
    from unnest(p_pool) x
    where not (x = any(coalesce(v_owned, '{}'::text[])));
  v_n := coalesce(array_length(v_cand, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'complete', 'credits', v_credits);
  end if;
  v_pick := v_cand[1 + floor(random() * v_n)::int];
  update public.profiles
    set credits = credits - p_cost,
        owned   = array_append(coalesce(owned, '{}'::text[]), v_pick),
        updated_at = now()
    where id = p_user
    returning credits into v_credits;
  return jsonb_build_object('ok', true, 'drawn', v_pick, 'tier', p_tier,
                            'credits', v_credits, 'remaining', v_n - 1);
end; $$;

-- ── 크레딧 가감 (게임 보상 등) — 음수 방지 ───────────────────────
create or replace function public.add_credits(p_user uuid, p_amount int)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update public.profiles set credits = greatest(0, credits + p_amount), updated_at = now()
    where id = p_user returning credits into v;
  return v;
end; $$;

-- ── 일일 출석 (자국 로컬 날짜 문자열 기준, 하루 1회) ──────────────
--   반환 jsonb: {ok, granted(bool), credits}
create or replace function public.claim_attendance(p_user uuid, p_date text, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last text; v_credits int;
begin
  select last_attend, credits into v_last, v_credits from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_last is not distinct from p_date then
    return jsonb_build_object('ok', true, 'granted', false, 'credits', v_credits);
  end if;
  update public.profiles set last_attend = p_date, credits = credits + p_amount, updated_at = now()
    where id = p_user returning credits into v_credits;
  return jsonb_build_object('ok', true, 'granted', true, 'credits', v_credits);
end; $$;
