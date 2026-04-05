# CALIGO - 1v1 전략 보드게임

안개 속 전장에서 펼치는 1v1 전략 보드게임. 30명의 캐릭터 중 3명을 드래프트하여 7×7 보드 위에서 전투합니다.

---

## 요구 사항

- **Node.js** 18 이상 (https://nodejs.org)
- npm (Node.js 설치 시 함께 포함)

---

## 설치 및 실행

```bash
# 1. 프로젝트 폴더로 이동
cd board-game

# 2. 의존성 설치
npm install

# 3. 서버 실행
npm start
```

서버가 실행되면 아래와 같은 메시지가 출력됩니다:

```
CALIGO server running:
   Local: http://localhost:3000
   Network: http://192.168.x.x:3000
```

- **혼자 테스트**: 브라우저에서 `http://localhost:3000` 접속 → AI 대전
- **1v1 대전**: 같은 네트워크의 두 기기에서 `http://<서버IP>:3000` 접속
- **관전**: 로비에서 "관전하기" 버튼 클릭 → 진행 중인 방 선택

> 포트를 변경하려면: `PORT=8080 npm start`

---

## 프로젝트 구조

```
board-game/
├── server.js          # 게임 서버 (Express + Socket.io)
├── package.json       # 의존성 정의
└── public/            # 클라이언트 (브라우저)
    ├── index.html     # 메인 HTML
    ├── game.js        # 게임 로직 + UI
    └── style.css      # 스타일
```

---

## 게임 규칙 요약

| 항목 | 내용 |
|------|------|
| 보드 | 7×7 격자 |
| 드래프트 | 티어별(1/2/3) 10명 중 1명씩, 총 3명 선택 |
| HP 분배 | 총 HP 풀을 3명에게 자유 배분 |
| 턴 행동 | 이동 또는 공격/스킬 중 택 1 (일부 예외 있음) |
| 승리 조건 | 상대 말 전멸 |
| 안개 | 상대 말 위치는 공격 범위 내에서만 보임 |

### 태그 시스템
- **왕실(Royal)**: 왕실 간 시너지 보유
- **악인(Villain)**: 변칙·디버프 계열
- **무소속**: 범용 유닛

---

## 다른 컴퓨터로 옮기기

1. `board-game` 폴더 전체를 복사 (`node_modules` 제외 가능)
2. 새 컴퓨터에 Node.js 설치
3. 폴더에서 `npm install` → `npm start`

USB나 클라우드로 옮길 때 아래 파일만 있으면 됩니다:
```
server.js
package.json
public/index.html
public/game.js
public/style.css
```

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| `npm: command not found` | Node.js가 설치되지 않음 → nodejs.org에서 설치 |
| 포트 3000 사용 중 | `PORT=4000 npm start`로 다른 포트 사용 |
| 다른 기기에서 접속 불가 | 방화벽에서 해당 포트 허용 필요 |
| 화면이 안 뜸 | 브라우저 캐시 삭제 후 새로고침 (Ctrl+Shift+R) |
