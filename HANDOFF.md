# 🎮 안개 전쟁 (Fog of War) — 프로젝트 인수인계 문서

> 최종 업데이트: 2026-03-26
> 다른 컴퓨터에서 이어서 개발하기 위한 완전한 가이드

---

## 📌 프로젝트 개요

**보드게임 스타일의 실시간 1대1 온라인 대전 게임**
- 5x5 공유 보드 위에서 서로의 위치를 모르는 채 추리하며 대전
- 전함(Battleship) 게임처럼 안개 전쟁(Fog of War) 메커니즘
- 턴제 전략 (이동 OR 공격 중 택 1)

---

## 🛠 기술 스택 (현재)

| 항목 | 사용 기술 |
|------|-----------|
| 서버 | Node.js + Express + Socket.io |
| 클라이언트 | Vanilla HTML/CSS/JavaScript |
| 통신 | WebSocket (Socket.io) |
| DB | 없음 (인메모리) |
| 배포 | 미배포 (로컬 개발 중) |

### 미래 목표 (CLAUDE.md 참조)
- React + TypeScript 프론트엔드
- Node.js + TypeScript + Express 백엔드
- HTML Canvas + 픽셀아트 렌더링
- PostgreSQL
- Docker + Nginx 배포

---

## 📁 프로젝트 구조

```
board-game/
├── package.json          # 의존성 (express, socket.io)
├── server.js             # 서버 + 게임 로직 + AI (872줄)
├── HANDOFF.md            # 이 문서
├── memory.md             # AI 모드 메모
└── public/
    ├── index.html        # 전체 UI 구조 (128줄)
    ├── style.css         # 다크 테마 스타일 (285줄)
    └── game.js           # 클라이언트 로직 (818줄)
```

---

## 🚀 실행 방법

```bash
cd board-game
npm install          # 최초 1회
node server.js       # 서버 시작
```

콘솔에 표시되는 주소로 접속:
- 로컬: `http://localhost:3000`
- 같은 네트워크: `http://192.168.x.x:3000` (콘솔에 표시됨)

**테스트**: 브라우저 탭 2개로 같은 방 코드 입력해서 접속

---

## 🎲 게임 규칙 상세

### 게임 흐름
1. **로비** → 방 입장 또는 AI 연습모드 선택
2. **드래프트** → 각 티어에서 말 1개씩 비공개 선택 (총 3개)
3. **HP 분배** → 총 10 HP를 3개 말에 자유 분배 (각 최소 1, 최대 8)
4. **배치** → 5x5 보드 어디든 자유 배치 (초기에는 겹치기 불가)
5. **게임** → 턴마다 이동 OR 공격 택 1
6. **승리** → 상대방 말 3개 전부 격파

### 핵심 메커니즘: 안개 전쟁
- 하나의 5x5 보드를 공유하지만 **상대 말의 위치는 보이지 않음**
- 공격 시 게임이 **히트/미스 피드백** 제공
- 서로의 **캐릭터 스탯은 게임 시작 후 공개** (위치만 비공개)
- 이동 시 **"상대방이 이동했습니다"만 표시** (어느 말이, 어디로 이동했는지 비공개)

### 이동 규칙
- **상하좌우 십자 방향 1칸만** (대각선 이동 불가)
- 제자리 이동 불가
- 게임 중 말 겹치기 가능 (초기 배치 때만 불가)
- 모든 말 동일 이동력

### 캐릭터 데이터

#### 1티어 (전체공격 타입) — ATK 1
| 이름 | 아이콘 | 공격 범위 | 설명 |
|------|--------|-----------|------|
| 졸병 | ⚔ | `/` 대각선 전체 | 자기 칸을 지나는 anti-diagonal 전체 (col+row 일정) |
| 궁수 | 🏹 | 가로줄 전체 | 자기 행의 5칸 전부 |
| 전차병 | 🪖 | 세로줄 전체 | 자기 열의 5칸 전부 |

#### 2티어 (부분공격 타입) — ATK 2
| 이름 | 아이콘 | 공격 범위 | 설명 |
|------|--------|-----------|------|
| 장군 | 🎖 | 십자(+) 인접 | 상하좌우 인접 4칸 |
| 암살자 | 🗡 | 자신의 칸 + 임의 1칸 | 2칸 동시 공격, 추가 칸 선택 필요 |
| 기사 | 🐴 | X자 대각선 인접 | 대각선 인접 4칸 |

#### 3티어 (고화력 타입) — ATK 3~4
| 이름 | 아이콘 | 공격 범위 | ATK | 설명 |
|------|--------|-----------|-----|------|
| 왕자 | 👑 | 좌우 인접 | 3 | 양옆 가로 2칸 |
| 공주 | 🌸 | 위아래 인접 | 3 | 위아래 세로 2칸 |
| 왕 | ♛ | 자신의 칸 | 4 | 자기 위치만 공격 (겹친 적에게 피해) |

---

## 🏗 서버 아키텍처 (server.js)

### 구조 요약
```
server.js
├── 캐릭터 데이터 (CHARACTERS 객체)
├── 공격 범위 계산 (getAttackCells)
├── 이동 검증 (isCrossAdjacent)
├── 방 관리 (createRoom, rooms 객체)
├── 말 생성 (createPiece, pieceSummary, oppPieceSummary)
├── 추리형 AI 시스템
│   ├── initAiBrain()         — 5x5 확률맵 초기화
│   ├── aiSpreadProbability() — 매 턴 확률 퍼뜨리기
│   ├── aiProcessAttackResult() — 히트/미스 결과로 확률맵 갱신
│   ├── boostHuntArea()       — 적중 시 인접 셀 확률 상승
│   ├── aiScoreAttack()       — 공격 기대값 계산
│   ├── aiScoreMove()         — 이동 후 기대값 계산
│   ├── aiBestAssassinTarget() — 암살자 최적 타겟 계산
│   ├── aiSelectPieces()      — 드래프트
│   ├── aiDistributeHp()      — HP 분배
│   ├── aiPlacePieces()       — 분산 배치
│   └── aiTakeTurn()          — 메인 턴 로직
├── Socket 이벤트 핸들러
│   ├── join_room / join_ai
│   ├── select_pieces
│   ├── distribute_hp
│   ├── place_piece / confirm_placement
│   ├── move_piece / attack
│   └── disconnect
└── endTurn() — 턴 전환 + AI 자동 턴
```

### 소켓 이벤트 목록

**Client → Server:**
| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `join_room` | `{roomId, playerName}` | 방 입장 |
| `join_ai` | `{playerName}` | AI 연습모드 |
| `select_pieces` | `{t1, t2, t3}` | 티어별 캐릭터 선택 |
| `distribute_hp` | `{hps: [n,n,n]}` | HP 분배 (합 10) |
| `place_piece` | `{pieceIdx, col, row}` | 말 배치 |
| `confirm_placement` | — | 배치 확정 |
| `move_piece` | `{pieceIdx, col, row}` | 이동 |
| `attack` | `{pieceIdx, tCol?, tRow?}` | 공격 (암살자만 tCol/tRow) |

**Server → Client:**
| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `joined` | `{idx, roomId, playerName, characters}` | 입장 확인 |
| `waiting` | — | 상대 대기 |
| `opponent_joined` | `{opponentName}` | 상대 입장 |
| `phase_change` | `{phase}` | 페이즈 전환 |
| `draft_ok` | `{t1, t2, t3}` | 드래프트 확정 |
| `hp_phase` | `{draft}` | HP 분배 페이즈 |
| `hp_ok` | `{hps}` | HP 확정 |
| `placement_phase` | `{pieces}` | 배치 페이즈 |
| `placed_ok` | `{pieceIdx, col, row}` | 배치 확인 |
| `game_start` | `{yourPieces, oppPieces, isYourTurn, ...}` | 게임 시작 |
| `your_turn` | `{turnNumber, yourPieces, oppPieces}` | 내 턴 |
| `opp_turn` | `{turnNumber, oppPieces}` | 상대 턴 |
| `move_ok` | `{pieceIdx, prev, col, row, yourPieces}` | 이동 결과 |
| `opp_moved` | `{msg}` | 상대 이동 알림 (위치 비공개) |
| `attack_result` | `{pieceIdx, cellResults, anyHit, oppPieces}` | 공격 결과 |
| `being_attacked` | `{atkCells, hitPieces, yourPieces}` | 피격 결과 |
| `game_over` | `{win, opponentName, finalPieces}` | 게임 종료 |
| `err` | `{msg}` | 에러 |
| `wait_msg` | `{msg}` | 대기 메시지 |
| `disconnected` | `{msg}` | 연결 끊김 |

---

## 🎨 클라이언트 아키텍처 (game.js)

### 상태 관리 (S 객체)
```javascript
const S = {
  playerIdx,        // 0 또는 1
  myName, opponentName, roomId,
  phase,            // 'lobby' | 'waiting' | 'draft' | 'hp' | 'placement' | 'game' | 'gameover'
  draftSelected,    // { 1: type, 2: type, 3: type }
  hpValues,         // [n, n, n]
  myPieces,         // [{index, type, name, icon, tier, hp, maxHp, atk, desc, col, row, alive}]
  oppPieces,        // 위치 제외한 스탯 정보
  isMyTurn,
  turnNumber,
  action,           // null | 'move' | 'attack'
  selectedPiece,    // pieceIndex 또는 null
  assassinStep,     // 암살자 추가 타겟 선택 중
  attackLog,        // [{col, row, hit, turn}]
};
```

### 화면 구조 (6개 스크린)
```
#screen-lobby      → 로비 (닉네임, 방 코드, AI 모드 버튼)
#screen-waiting    → 대기 (스피너)
#screen-draft      → 드래프트 (3티어 카드 선택)
#screen-hp         → HP 분배 (+/- 버튼)
#screen-placement  → 배치 (보드 + 말 리스트)
#screen-game       → 게임 (좌: 내 말/상대 말 | 중: 보드+액션바 | 우: 로그)
#screen-gameover   → 결과
```

### 주요 함수
| 함수 | 설명 |
|------|------|
| `showScreen(id)` | 화면 전환 |
| `buildDraftUI(characters)` | 드래프트 UI 생성 |
| `buildHpUI(draft)` | HP 분배 UI 생성 |
| `buildPlacementUI()` | 배치 UI 생성 |
| `buildGameUI()` | 게임 보드 생성 |
| `renderGameBoard()` | 보드 렌더링 (말, 공격기록, 범위 하이라이트) |
| `renderMyPieces()` | 좌측 패널: 내 말 정보 |
| `renderOppPieces()` | 좌측 패널: 상대 말 정보 (위치 비공개) |
| `showActionBar(enabled)` | 이동/공격 버튼 표시 |
| `handleGameCellClick(col, row)` | 게임 보드 셀 클릭 핸들러 |
| `getAttackCells(type, col, row)` | 공격 범위 계산 (서버와 동일) |
| `isCrossAdjacent(c1,r1,c2,r2)` | 십자 인접 판정 |
| `addLog(msg, type)` | 전투 로그 추가 |

---

## 🤖 AI 시스템 상세

### AI 브레인 구조
```javascript
{
  probMap: 5x5 float[][]  // 적이 각 칸에 있을 확률 (0~10)
  confirmedEmpty: Set      // 빈 칸 확인
  hits: []                 // 적중 기록
  mode: 'scan'|'hunt'|'finish'
  huntTargets: []          // 추적 대상
  enemiesAlive: 3
  turnCount: 0
  lastHitTurn: -10
  scannedRows/Cols/Diags: Set
}
```

### AI 행동 로직
1. **매 턴 확률 퍼뜨리기** — 적이 이동할 수 있으므로 인접 칸에 15%씩 전파
2. **모든 살아있는 말에 대해 공격 점수 vs 이동 점수 비교**
3. **최고 기대값 행동 선택** (이동은 0.7배 보정 — 공격을 포기하는 비용)
4. **hunt 모드일 때 공격 우선** (점수 3 이상이면 강제 공격)
5. **적중 후 인접 십자 칸 확률 대폭 상승** (적이 이동했을 곳 추적)
6. **5턴 이상 못 맞추면 scan 모드 복귀**

### AI 현재 한계점 & 개선 방향
- ⚠ 아직 적의 캐릭터 타입 기반 추론 미구현 (이 적이 어떤 이동 패턴일지)
- ⚠ 피격 당했을 때 자기 말 보호(회피) 로직 없음
- ⚠ 여러 적의 위치를 독립적으로 추적하는 로직 부족
- ⚠ 게임 후반 전략 (남은 적 1명일 때 집중 추적) 미세 조정 필요

---

## ✅ 완료된 기능

- [x] 1대1 온라인 대전 (같은 방 코드로 매칭)
- [x] 안개 전쟁 메커니즘 (상대 위치 비공개)
- [x] 드래프트 → HP 분배 → 배치 → 게임 전체 흐름
- [x] 9종 캐릭터 (티어별 3종)
- [x] 각 캐릭터 고유 공격 패턴
- [x] 이동: 십자 방향 1칸만
- [x] 상대 캐릭터 스탯 공개 (위치만 비공개)
- [x] 이동 은닉 ("상대방이 이동했습니다"만 표시)
- [x] AI 연습 모드 (추리형 AI)
- [x] 같은 방 이름 재사용 (게임 종료 후)
- [x] 같은 네트워크 다른 기기 접속 (`0.0.0.0` 바인딩)
- [x] 다크 테마 UI

---

## 🔜 TODO (우선순위순)

### 1순위: 기능/버그
- [ ] AI 더 똑똑하게 (개별 적 위치 추적, 회피 로직, 캐릭터 기반 추론)
- [ ] 게임 중 방 이탈/재접속 처리
- [ ] 동일 좌표에 여러 말 겹쳤을 때 공격 처리 확인

### 2순위: 콘텐츠
- [ ] 캐릭터 추가 (티어별 확장)
- [ ] 특수 능력 시스템 (2칸 이동 등)
- [ ] 밸런스 조정

### 3순위: 배포
- [ ] Render/Railway 등 온라인 배포
- [ ] 서버 상태 관리 (방 자동 정리)

### 4순위: 디자인
- [ ] React + TypeScript 재구축
- [ ] HTML Canvas + 픽셀아트 렌더링
- [ ] 애니메이션, 사운드
- [ ] 모바일 대응 강화

---

## 🔧 다른 컴퓨터에서 이어서 개발하기

### 방법 1: 폴더 복사
1. `board-game` 폴더 전체를 USB/클라우드로 복사 (node_modules 제외 가능)
2. 새 컴퓨터에서:
```bash
cd board-game
npm install
node server.js
```

### 방법 2: Git 사용 (추천)
```bash
# 현재 컴퓨터에서
cd board-game
git init
git add -A
git commit -m "초기 커밋: 안개전쟁 프로토타입"
git remote add origin <github-url>
git push -u origin main

# 새 컴퓨터에서
git clone <github-url>
cd board-game
npm install
node server.js
```

### 필수 환경
- Node.js v18 이상
- npm

---

## 📎 참고 파일

- `C:\Users\user\Downloads\claude.md` — 미래 아키텍처 설계 문서 (React+TS+Canvas 목표)
- `memory.md` — AI 모드 관련 메모

---

## 💡 Claude에게 이어서 개발 요청 시 팁

이 문서를 먼저 보여주고 아래처럼 요청하세요:

```
HANDOFF.md를 읽고 프로젝트 현황을 파악해줘.
그리고 [원하는 작업]을 해줘.
```

예시:
- "AI를 더 똑똑하게 만들어줘"
- "새 캐릭터를 추가하고 싶어"
- "React + TypeScript로 재구축하자"
- "Render에 배포해줘"
