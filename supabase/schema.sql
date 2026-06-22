-- ═══════════════════════════════════════════════════════════════
-- CALIGO 로그인/계정 시스템 — Supabase Postgres 스키마
-- 적용: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
-- ═══════════════════════════════════════════════════════════════
-- 인증(auth.users)은 Supabase Auth 가 자동 관리. 아래는 게임 데이터 테이블.
-- 서버는 service_role 키로 접근(RLS 우회). RLS 정책은 혹시 클라가
-- anon+JWT 로 직접 읽을 때 "자기 행만" 보이도록 하는 안전망.

-- ── 프로필: 유저당 1행 (닉네임 + 설정) ──────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text,
  settings    jsonb       not null default '{}'::jsonb,  -- chatMuted 등
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 덱: 유저당 N개 (덱 목록) ────────────────────────────────────
create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  t1          text,                                       -- 티어1 캐릭터 type
  t2          text,
  t3          text,
  is_active   boolean     not null default false,         -- 현재 활성 덱
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists decks_user_idx on public.decks(user_id);

-- ── 전적/기록 ──────────────────────────────────────────────────
create table if not exists public.stats (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  wins        int         not null default 0,
  losses      int         not null default 0,
  draws       int         not null default 0,
  records     jsonb       not null default '{}'::jsonb,    -- 랭크/캐릭터별 기록
  updated_at  timestamptz not null default now()
);

-- ── 진행 중 대전 (다른 기기에서 이어하기용) ───────────────────────
-- room_id 로 메모리상 방을 재합류. match_state 는 서버 재배포 생존용 스냅샷(Phase 5).
create table if not exists public.active_match (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  room_id     text        not null,
  match_state jsonb,
  updated_at  timestamptz not null default now()
);

-- ── 가입 시 profiles/stats 행 자동 생성 ─────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
    values (new.id, coalesce(new.raw_user_meta_data->>'name',
                             new.raw_user_meta_data->>'full_name'))
    on conflict (id) do nothing;
  insert into public.stats (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security (자기 행만 접근) ─────────────────────────
alter table public.profiles     enable row level security;
alter table public.decks        enable row level security;
alter table public.stats        enable row level security;
alter table public.active_match enable row level security;

-- profiles
drop policy if exists "own profile"      on public.profiles;
create policy "own profile"      on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
-- decks
drop policy if exists "own decks"        on public.decks;
create policy "own decks"        on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- stats
drop policy if exists "own stats"        on public.stats;
create policy "own stats"        on public.stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- active_match
drop policy if exists "own active match" on public.active_match;
create policy "own active match" on public.active_match
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
