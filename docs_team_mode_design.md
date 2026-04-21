# CALIGO 4인 팀전 (2v2) 구현 설계 문서

## 핵심 원칙
1. **1v1 모드 절대 손상 금지** — 기존 코드 경로는 건드리지 않고, 팀전은 추가 경로로 구현
2. **코드 재사용 최대화** — 1v1의 문구/스타일/흐름을 그대로 사용
3. **점진적 구현** — Phase별 커밋, 각 단계 후 1v1 회귀 테스트

---

## 게임 규칙 요약 (사용자 확정)

### 플레이어 구성
- **4명** (같은 룸 코드 입장)
- **자동 팀 배정** (랜덤)
- **대기실에서 팀 변경 가능** (4/4 채워지기 전까지)
- **4/4 충족 시 "게임 시작" 버튼 활성화**
- **시작 버튼 → 3초 카운트다운 → 게임 시작**

### 이탈자 처리
- AI 대체 없음
- **이탈 = 해당 팀 즉시 패배**

### 드래프트 (150초 제한)
- 각자 **2개 캐릭터 선택** (티어 구분 없음, 왕/왕자/공주 등 같은 티어 OK)
- **팀원끼리 중복 불가** — 팀원이 고른 캐릭터 슬라이드 흐림 처리
- **상대 팀과는 중복 OK**
- 내 덱 메뉴에는 팀전용 덱 저장 **없음** — 매 게임 새로 구성
- 슬라이드 UI는 1v1과 동일하게 사용
- 팀 채팅 가능

### HP 분배
- **10 HP / 각 플레이어** (개인 배분, 공유 아님)
- 2개 캐릭터에 10을 분배 (최소 각 1HP)
- 쌍둥이 출전 시 1v1과 동일 규칙 (최소 2 + 형/동생 나누기)

### SP 시스템
- **팀 풀 공유** — 팀원이 스킬 쓰면 팀 전체 SP 감소
- **초기 팀당 1 SP** (1v1과 동일)
- **10턴마다 +1 SP** (팀 풀, 1v1 룰 동일)
- **40턴 이후 SP 지급 종료** (1v1과 동일)
- 인스턴트 매직 패시브 발동 시에도 **팀 풀로 편입**

### 보드 크기
- **시작: 7×7**
- **25턴: 5×5 축소** (외곽 파괴, 파괴된 칸에 있는 말 사망)
- **50턴: 3×3 축소**
- **20턴 경고** (5턴 전)
- **45턴 경고** (5턴 전)
- 확대된 보드에 맞춰 배치 페이즈 UI 조정 필요

### 턴 순서
- 기본: **A1 → B1 → A2 → B2 → (반복)**
- **A2 탈락**: A1 → B1 → A1 → B2 (A1이 2회 처리)
- **B2 탈락**: A1 → B1 → A2 → B1 (B1이 2회 처리)
- **한 팀 전멸/이탈/기권 → 반대 팀 승리**

### 팀 정보 공유
- 팀원 위치: **완전 공개**
- 팀원이 발견한 적 위치: **공유** (표식, 정찰 등)
- 팀원 HP/잔여 SP/스킬 사용 기록: **모두 공개**

### 채팅
- **전체 채팅**: 4명 + 관전자
- **팀 채팅**: 2명만 (상대 팀 안 보임)
- **관전자**: 전체 채팅만 접근
- UI: 탭 전환 방식 (전체 / 팀)

### 승리 조건
- **상대 팀 전멸** 또는
- **상대 팀 1명 이상 이탈(연결 끊김/기권)** — 즉시 승리

### 스킬 밸런스 조정 (팀 맥락)
- 🛡 **호위 무사 (충성)**: 자신 + **팀원의 왕실 유닛**도 보호 대상
- 📋 **지휘관 (사기증진)**: 인접 **팀원의 유닛**도 ATK+1 버프
- 🌿 **약초전문가 (약초학)**: 주변 **팀원 아군**도 회복
- 🪓 **학살 영웅 (배반자)**: 공격 시 **팀원의 유닛에도** 아군 피해

---

## 아키텍처 요약

### 룸 구조 확장
```js
room = {
  // 공통
  mode: 'pvp' | 'team',        // NEW
  playerCount: 2 | 4,           // NEW (팀모드 = 4)
  players: [p0, p1, ...],       // 길이 동적
  currentPlayerIdx: 0,
  turnNumber: 1,
  phase: 'waiting' | ...,

  // 팀전 전용
  teams: [[0, 1], [2, 3]],      // NEW: [A팀, B팀]
  eliminatedPlayers: new Set(), // NEW: 이탈/기권 플레이어

  // SP/상태 (길이 동적)
  sp: [team0_sp, team1_sp],     // 1v1=[p0, p1], 팀전=[teamA, teamB]
  instantSp: [...],
  rats: [...],                  // player 기준 (모드 무관)
  boardObjects: [...],          // player 기준

  // 배치/공개 상태
  draftDone: [...],             // 길이 동적
  hpDone: [...],
  placementDone: [...],

  // 보드
  boardBounds: { min, max },
  boardShrunk: false,           // 50턴 완전 축소 플래그 (사용 안 함, 2단계 축소로 변경)
  boardShrinkStage: 0,          // NEW: 0(초기 5x5 or 7x7) → 1(중간) → 2(최종 3x3)
}

player = {
  // 공통
  socketId, name, color, idx,
  pieces: [...],
  draft: { ... },                // 1v1=t1/t2/t3, 팀전=pick1/pick2
  hp: { ... },

  // 팀전 전용
  teamId: 0 | 1,                // NEW
}
```

### 핵심 헬퍼 함수 (새로 추가)
```js
getTeamOf(room, idx)         // player의 팀 번호
getTeammates(room, idx)      // 같은 팀의 나머지 멤버 인덱스 배열
getEnemyIndices(room, idx)   // 상대 팀 모든 인덱스 배열
getEnemyTeamOf(room, idx)    // 상대 팀 번호
isTeammate(room, a, b)
isAlly(room, pc1, pc2)       // 같은 플레이어 or 같은 팀인 말
getNextPlayerIdx(room)       // 턴 순환 헬퍼 (탈락자 스킵)
isTeamEliminated(room, teamId)
```

### 1-idx 리팩토링
- 1v1 모드: `getEnemyIndices(room, idx)[0] === 1 - idx` (행동 동일)
- 팀모드: 2명 반환 or 맥락에 따라 팀 전체

---

## Phase 구현 계획

### Phase 1: 기반 리팩토링 (1v1 동일 동작 유지)
- [ ] `room.mode = 'pvp'` 기본값 추가
- [ ] `player.teamId` 추가 (1v1 기본값: 0, 1)
- [ ] `getTeamOf/getTeammates/getEnemyIndices/isTeammate/isAlly` 헬퍼 추가
- [ ] `1 - playerIdx` 구문을 헬퍼 함수 호출로 점진적 교체
- [ ] 테스트: 1v1 게임 풀 플레이 가능한지 확인

### Phase 2: 4인 로비 + 팀 배정
- [ ] 팀전용 조인 경로: `join_team_room` or 모드 플래그
- [ ] 4/4 대기 UI
- [ ] 팀 A/B 슬롯 + 드래그/클릭 변경
- [ ] 게임 시작 버튼 + 3초 카운트다운

### Phase 3: 보드 7×7 + 2단 축소 + 턴 순환
- [ ] `room.boardBounds`를 팀모드에서 { min: 0, max: 6 } 초기화
- [ ] 20/25/45/50턴 이벤트
- [ ] 축소 시 영역 밖 유닛 사망 처리 (기존 로직 응용)
- [ ] `getNextPlayerIdx` 구현 — A1→B1→A2→B2, 탈락자 스킵
- [ ] 배치 페이즈 보드 크기 동적

### Phase 4: 팀전 드래프트 + HP + SP 공유
- [ ] 드래프트: 2픽, 티어 무시, 팀원 중복 금지
- [ ] 팀원 픽 실시간 공유 (새 소켓 이벤트)
- [ ] 흐림 처리 UI
- [ ] HP 분배: 10/플레이어
- [ ] SP 풀: `team.sp` 공유

### Phase 5: 팀 정보 공유 + 팀 채팅
- [ ] 팀원 pieces 위치 공유 (oppPieceSummary 제외 대상)
- [ ] 팀원 HP/SP/스킬 쿨다운 공유
- [ ] 표식/정찰 정보 공유
- [ ] 전체/팀 채팅 탭 UI

### Phase 6: 스킬 팀 확장
- [ ] 호위무사 충성: 팀원 왕실 보호
- [ ] 지휘관 사기증진: 팀원 인접 버프
- [ ] 약초전문가: 팀원 힐
- [ ] 학살영웅: 팀원 아군 피해

### Phase 7: 이탈/기권 처리
- [ ] 이탈 시 팀 즉시 패배
- [ ] 관전자 전체 채팅만

---

## 진행 현황 (2026-04-21 기준)

### ✅ 완료 (커밋된 기능)
- **Phase 0**: 설계 문서 작성 (이 파일)
- **Phase 1.1**: 룸/플레이어에 mode/teamId/teams/eliminatedPlayers/playerCount 필드, 헬퍼 (getTeamOf/getTeammates/getEnemyIndices/isTeammate/isAlly/getNextPlayerIdx/getPrevPlayerIdx/isTeamEliminated/broadcastTeamRoomState)
- **Phase 1.2**: endTurn이 getNextPlayerIdx/getPrevPlayerIdx 헬퍼 호출로 교체 (1v1 동일 동작)
- **Phase 2**: 로비 "2vs2 입장하기" 버튼, screen-team-waiting 화면 (슬롯/VS/상태/시작/나가기/카운트다운), 서버 join_team_room/team_change/team_leave/team_start_request 핸들러, 3초 카운트다운, 대기실 disconnect 처리
- **Phase 3**: getBoardShrinkSchedule 헬퍼 기반 축소 (1v1 1단/팀 2단), boardShrinkStage 플래그, 팀 축소 시 isTeamEliminated 기반 승부 체크
- **Phase 4a (서버)**: transitionToTeamDraft/Hp/Reveal/Placement, team_draft_pick/confirm, team_hp_distribute, team_reveal_continue 핸들러, buildTeamPieces 팩토리, teamDraftTimeout/teamHpTimeout 기본 폴백
- **Phase 4b (클라)**: screen-team-draft (카드 그리드, 2픽 토글, 팀원 실시간 공유, 확정 버튼), screen-team-hp (HP 입력 + 쌍둥이 내부 분배), screen-team-reveal (A/B팀 블록)

### ⏳ 남은 작업

#### Phase 4c: 팀전 배치
**서버 측**
- 팀별 배치 존 정의 (예: A팀 row 0-2, B팀 row 4-6, 중앙 3 비움)
- `team_placement_submit` 핸들러: 각 플레이어가 자기 pieces 배치 제출
- 중복/영역 검증
- 4명 모두 제출 → 게임 시작 (transitionToTeamGame)

**클라이언트 측**
- screen-team-placement: 7x7 보드 + 내 캐릭터 드래그 배치 + 팀원 배치 실시간 표시
- 내 존 하이라이트

#### Phase 4d: 팀전 게임 루프 통합
- emitToBoth, getSpectatorGameState 등 기존 2인 전용 함수를 4인 대응으로 확장 (또는 별도 emitToTeamAll 추가)
- 턴 배너: 현재 플레이어 이름 + 팀 색깔
- 게임 UI에 4명 프로필 표시 (위: 적팀 2명, 아래: 내팀 2명 형태?)
- 공격/이동/스킬 명령이 팀원 좌표를 아군으로 처리하도록 isAlly 적용
- 승패 판정: isTeamEliminated 기반 (Phase 1.1 헬퍼 활용)

#### Phase 5: 팀 정보 공유 + 팀 채팅
- `oppPieceSummary` 교체: 팀원 pieces는 aliveSummary(공개)로, 상대팀만 oppSummary
- 팀원 HP/SP/쿨다운 공유 이벤트
- 표식/정찰 결과 팀 공유 (scoutResult, mark 브로드캐스트에 팀 멤버 포함)
- 채팅 탭 UI (전체/팀), `chat` 이벤트에 `scope: 'all' | 'team'` 추가

#### Phase 6: 스킬 팀 확장
- 호위무사(loyalty): 보호 대상 `isAlly` 확장
- 지휘관(morale): `isAlly` 인접 판정
- 약초전문가(herb): 주변 아군 `isAlly`
- 학살영웅(betrayer): 아군 피해에 팀원 포함

#### Phase 7: 이탈/기권 처리 (게임 중)
- 기존 disconnect 로직의 `phase !== 'waiting'` 분기를 팀전 승부 판정으로 확장
- 해당 플레이어를 `eliminatedPlayers`에 추가 → `isTeamEliminated` 체크 → 승리팀 결정
- 관전자: 팀 채팅 접근 차단 (전체만)

### 회귀 테스트 필요 시점
- 1v1 풀 플레이 (드래프트 → 교환 → HP → 배치 → 전투 → 축소 → 승/패): **각 Phase 커밋 후 확인 권장**
- 1v1 AI 모드: Phase 1 이후 동일 동작
- 1v1 관전: Phase 3 이후 `boardShrinkStage` 도입에 따라 축소 타이밍 기록 확인

---

## 파일 영향 범위

### 서버 측 (server.js)
- 룸 생성/조인 로직
- 턴 관리 + 타이머
- 스킬 실행 로직 (팀 맥락)
- 패시브 효과 (팀 맥락)
- 승패 판정
- 이벤트 emit (팀 구분)

### 클라이언트 측 (public/game.js, index.html, style.css)
- 로비 4인 대기실 UI
- 드래프트 UI (2픽, 중복 감지)
- 게임 중 4명 프로필 표시
- 팀원 프로필 스타일 (아군 녹색?)
- 채팅 탭 전환
- 턴 배너 4명 대응

---

## 회귀 테스트 체크리스트 (Phase별)

1v1 모드가 계속 동작해야 함:
- [ ] 로비 입장 → 방 만들기 → 상대 대기
- [ ] 드래프트 3픽 확정
- [ ] 초기 공개 → 교환 드래프트 → 최종 공개
- [ ] HP 분배 → 배치 → 게임 시작
- [ ] 이동/공격/스킬 사용
- [ ] 보드 축소 (50턴)
- [ ] 승/패 처리
- [ ] AI 모드
- [ ] 관전 모드
