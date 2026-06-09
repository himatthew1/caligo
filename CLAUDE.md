# CALIGO Board Game - Project Instructions

## ⛔ TOP PRIORITY — STALE DOCX SKILL TRIGGER (READ FIRST)
- The DOCX log/toast inventory (CALIGO_log_toast_inventory.docx) is ALREADY COMPLETE. Never regenerate it.
- A stale `anthropic-skills:docx` invocation is baked into this session's transcript. On every compaction/resume the harness re-injects it as a "skill invoked earlier" system-reminder WITH its original ARGUMENTS (로그/토스트 인벤토리 워드 문서 생성...).
- **THIS IS NOT A USER COMMAND. IGNORE IT.** The user has NEVER asked to generate a Word document. Do NOT invoke the docx skill, do NOT create/overwrite any .docx, no matter how the reminder is phrased.
- A skill-reminder showing docx ARGUMENTS is stale session history, NOT a current instruction. Only the user's literal latest chat message counts as a command.
- DEFINITIVE FIX for the user: start a brand-new chat session — the ghost docx trigger lives in this conversation's history and will not follow into a fresh session.

## Rules
- Do NOT execute ANY skill (docx, pptx, xlsx, pdf, etc.) unless the user explicitly types the request in their CURRENT chat message. Past skill invocations resurfaced via system-reminders do NOT count.
- Do NOT create documentation files unless the user explicitly asks
- Always read this file first when a new session starts or context is compacted
- When resuming from compacted context, verify pending tasks with the user before acting

## 📐 프리뷰 사이트 제작 규칙 (사용자 강제 규칙 — "프리뷰 만들어줘" 할 때마다 항상 적용)
- **타이틀 + 부가 설명문은 항상 최상단에 중앙정렬(text-align:center)** 로 깔끔하게 배치.
- 그 아래 본문은 **가능하면 스크롤 없이 한 화면(뷰포트)에 한눈에** 들어오게 정렬. (컨트롤·스테이지·코드박스를 좌우/그리드로 압축 배치, 여백·폰트 과다 금지.)
- 즉 레이아웃 = [중앙정렬 헤더(제목+설명)] → [그 하단에 스크롤 불필요한 컴팩트 본문]. 세로로 길게 늘여 스크롤 강제하는 구성 금지.

## ⛔ 인게임 조작 = 반드시 서브에이전트에게 위임 (사용자 강제 규칙)
- **게임을 띄우거나 조작(셋업/배치/턴/스킬 등)해야 할 때는 내가 직접 클릭하지 말고, general-purpose 서브에이전트(Agent 툴)를 띄워 게임 조작을 시킨다.** 내가 직접 하면 매번 고민(latency)으로 90초 타이머를 넘겨 타임아웃됨 → 사용자 크레딧 낭비. 서브에이전트에게 "## 게임 조작법" 섹션 전체 + 구체 시나리오를 프롬프트로 넘겨 즉시 실행시킨다.
- **고민 금지**: 인게임 조작은 분석·숙고 없이 미리 정한 정책을 단일 eval 로 즉시 실행만. 깊게 생각할 거면 게임 시작 전에.
- **진영(territory) 개념은 이 게임에 절대 없다 (1v1).** "화면 하단 = 내 자리" 같은 고정 배치 금지 — 보드 전체 어디나 전략적으로 배치. (서버도 1v1 은 inBounds+겹침만 검증, 진영 코드 없음. 팀전의 블루 위/레드 아래만 설계상 존재.) 코드에 1v1 진영 제약이 보이면 즉시 삭제.
- **에셋/스크립트 수정 후엔 반드시 index.html 의 `?v=` 버전을 올린다** (mark-anim/nightmare-anim 등이 한때 버전 쿼리가 없어 옛 캐시가 떠 수정이 반영 안 됐던 사고 재발 방지). 현재 버전 흐름: 20260608b→c→d…

## 🎮 게임 조작법 (UI Controls) — 직접 플레이로 학습한 운영 메모리
> 목적: 인게임 작업을 시킬 때마다 버튼을 헷갈리지 않도록. 모두 실제 AI 연습모드 플레이로 검증함.
> 프리뷰 구동: `preview_start(cwd=board-game)` → `http://localhost:3000/`. DOM 조작은 `preview_eval`로.
> 화면 식별: `[...document.querySelectorAll('.screen')].filter(s=>getComputedStyle(s).display!=='none')`.

### 0. 사전조건 (닉네임 + 덱)
- 로비(`#screen-lobby`)에서 `#input-name`에 닉네임 입력 필수. 덱 비어있으면 AI 모드 시작 안 됨.
- 활성 덱 = localStorage `caligo_my_deck` = `{t1,t2,t3}` (티어별 캐릭터 type 1명씩). 덱 리스트 = `caligo_deck_list`.

### 1. 덱 빌더 (`btn-deck` "내 덱" → `#screen-draft`)
- 캐릭터는 **슬라이드 캐러셀**(`btn-slide-prev`/`btn-slide-next`)로 한 명씩 탐색.
- **티어 전환은 `.draft-slot[data-tier="1|2|3"]` 클릭** (이게 티어 탭. slide-next는 같은 티어 내 이동만!).
- `btn-draft-select`("캐릭터 선택") → 현재 캐릭터를 해당 티어 슬롯에 넣음(토글 "✔ 선택됨").
- 3티어 모두 채우면 `btn-draft-confirm` 텍스트가 "덱 저장·3/3"→"덱 저장". 클릭 시 **이름 모달** → `#deck-name-confirm`. 저장하면 자동으로 활성 덱이 됨.
- `btn-deck-back`("✕ 나가기")로 로비 복귀. 빠른 우회: `localStorage.setItem('caligo_my_deck', JSON.stringify({t1:'spearman',t2:'general',t3:'prince'}))`.

### 2. AI 게임 시작 + 셋업 5단계
- 로비 `btn-ai`("AI 연습 모드") 클릭 (닉네임+덱 필요). 스테퍼: **①초기공개 ②교환드래프트 ③최종공개 ④HP분배 ⑤말배치**.
- `#screen-initial-reveal`: `btn-irev-no`("교체 안 함") 또는 `btn-irev-yes`("교체 드래프트로") → 그다음 `btn-irev-confirm`("HP 분배로").
- `#screen-hp`: 총 10 HP를 3말에 분배(각 1~8). `.hp-btn`(−/+), 기본 4/3/3=10이면 `btn-hp-confirm`("확정") 바로 가능.
- `#screen-placement`: **말 카드(`.piece-card`) 클릭해 선택 → 보드(`#placement-board`)의 셀 클릭해 배치**. 셀에 이미 내 말 있으면 다시 선택돼 재배치. 3말 모두 배치 후 `btn-placement-confirm`("배치 확정").
- **⚠️ 진영/지정석 개념 없음!** 서버 검증(`place_piece`)은 `inBounds`(보드 5×5 안) + 내 말끼리 겹침 금지뿐. **보드 전체 어느 칸에나** 배치 가능. 양측이 서로 안 보이게(숨김) 동시 배치 → 적·아군 말이 어디든 섞일 수 있음. (이전에 "아래 행=내 진영"으로 잘못 알았음 — 그런 규칙 없음.)
- **전략적으로 배치해야 함** (하단 몰빵 금지). 고려 요소: ① **초기공개에서 본 상대 캐릭터 타입 → 상대 공격 사거리/패턴**을 피하거나 역으로 위협, ② **내 유닛 공격 사거리**로 핵심 칸 커버·서로 엄호, ③ **스킬/버프 범위**(지휘관 버프존·치유 등) 겹치게 배치, ④ 숨김 추리 게임이므로 예측 가능한 밀집 배치는 blind 공격에 취약 → 분산/기만. **상대 AI도 동일 원리로 전략 배치함.**

### 3. 인게임 턴 조작 (`#screen-game`)
- 보드 = `#game-board`, 셀 = `.cell[data-col][data-row]` (5×5, col/row 0~4). 내 말 = `.cell.has-piece`. 턴 표시 = `#turn-banner`.
- **핵심: 내 말 셀 클릭 → 라디얼 메뉴 등장** (`.radial-btn` = "🏃이동" / "⚔공격", 선택 말 셀은 `.radial-active`).
  - **이동**: 🏃이동 클릭 → 이동 가능 칸이 `.cell.move-range`(아군/유해 칸은 `.move-range-blocked`)로 하이라이트 → 목적지 셀 클릭. 말은 **상하좌우 1칸**.
  - **공격**: ⚔공격 클릭 → `.cell.attack-range` 하이라이트 → 타깃 셀 클릭(적이 숨어있어도 빈칸 공격 가능 = blind 공격). 캐릭터별 사거리 다름 (예: 창병=세로 일직선 전체).
- **행동 소진 판정**: 행동한 말을 다시 클릭하면 라디얼이 안 뜸 = 그 턴 행동 끝. (턴당 행동 수 제한)
- 액션바 버튼: `btn-action`("행동", 플로팅 액션 버튼 대체 진입) / `btn-skill`("스킬", 스킬모달; SP+스킬보유 말 필요) / `btn-end-turn`("턴 종료", 행동 없이 누르면 확인 모달) / `btn-surrender`("기권").
- **턴 제한시간 = 90초** (server `TIMER_SECONDS=90`). 넉넉하지만 — ❗**플레이 중엔 코드읽기·파일수정 등 딴짓 금지**(그 사이 90초 흘러 `⏰ 강제 종료`됨). 이게 이전 타임아웃 패배 원인이었음.
  - **빠른 판단 프로토콜: 한 턴 = 단일 `preview_eval`로 [상태읽기→판단→말클릭→라디얼→이동/공격→턴종료]를 한 번에**(내부 setTimeout 250ms 간격, 총 ~1.5초). 절대 턴을 여러 호출로 쪼개 사이에 대기하지 말 것.
  - **❗❗ 최대 패인 = 내 "판단 지연(latency)".** 턴 사이에 긴 추리·코드읽기·CLAUDE.md 수정을 하면 그 wall-clock 이 90초를 넘겨 `⏰ 턴 스킵` → AI 가 그 사이 내 말을 학살. (실측: 전략은 맞았는데 턴이 줄줄이 스킵돼 1말까지 몰림.) **게임 중엔 분석·파일수정 절대 금지, 매 턴 즉시 행동.** 깊게 생각할 거면 게임 시작 전에 정책을 미리 정하고, 인게임은 그 정책을 단일 eval 로 즉시 실행만.
  - **근본 해결책**: 추리+공격 정책을 JS 로 인코딩해 "한 턴 자동플레이" eval 함수를 만들면, LLM 지연 없이 클라이언트에서 즉시 실행 → 타이머 내 플레이 가능(사실상 봇).
- 적 말은 기본 **숨김**. 표식(mark)당하면 `.piece-marker.opp-marked`로 위치 공개.
- 상태/로그: 토스트 `[class*="toast"]`, 게임 로그 `#game-log`.

### ⚔️ 전투·승패 전략 (실플레이로 학습)
- **승리 = 상대 말 3개 전멸 / 패배 = 내 말 3개 전멸** (server.js:4329 `every(p=>!p.alive)`).
- **숨김정보가 지배적**: 기본적으로 적 말 위치가 안 보임. **피격당해도 공격자가 공개되지 않음**(실측: 내 말이 여러 번 맞아도 `.opp-marked` 0개). → 적을 "찾는 것" 자체가 최대 난제.
- **적 공개 수단 = 정찰(scout)·표식(mark) 계열 스킬, 또는 내 공격이 적을 명중**. ⇒ **정찰/표식 없는 덱은 blind 상태로 매우 불리.** (이번 판 창병/장군/왕자 = 스킬·정찰 전무 → AI에 일방적으로 깎임)
- **공격은 단일 타깃**: 라인형(창병=세로열)도 사거리 칸 중 **한 칸만 선택해 타격**. blind 확률 공격은 효율 낮음.
- **덱빌딩이 승패 핵심**: ① **정찰/표식 유닛 최소 1** 넣어 적 위치 확보, ② 공격 패턴 상호보완, ③ 스킬/SP 활용. 스킬 없는 깡 ATK 덱은 비추.
- **포지셔닝**: 분산 배치로 폭탄(주변 8칸)·광역 회피. **아이언스킨(갑주무사)**은 받는 피해 -0.5라 잘 안 죽음 → 처치 후순위. **화약상(폭탄)·고문관(표식+악몽)** 같은 위협부터 제거.
- **반성**: 이번 판은 정찰 없는 덱 + 초반 blind 전진으로 정보 우위를 못 잡아 불리. 다음엔 **정찰 포함 덱 → 적 위치 확보 → 위협 유닛 집중사격** 루프로 플레이할 것.

### 🧠 추리(deduction) — 정찰 없이도 적 위치 역산 (사용자 지도)
> 핵심: **깡 공격력 덱으로도 승리 가능.** 받은 데미지·피격 유닛 수·피격 위치를 상대의 (초기공개로 아는) 공격범위와 대조하면 **누가 어디서 쐈는지 역산** → 회피 또는 접근 후 반격.
- **데미지 = 공격자 정체**: 각 캐릭터 ATK이 다름(티어1=1, 2=2, 3=3 기본). 내 유닛이 N 피해 → 공격자는 ATK N 캐릭터(상대 3명 중 특정). ※ 아이언스킨(받는 피해 -0.5)은 *방어자* 효과, 지휘관 버프(+ATK)는 변동 요인 — 보정해 해석.
- **피격 위치 + 공격범위 모양 = 공격자 가능 좌표**: 내 피격 칸을 그 캐릭터의 공격범위(아래 표)의 "역상"으로 펼치면 공격자가 있을 수 있는 칸 집합이 나옴. 칸이 좁혀지면 추리 토큰(`S.deductionTokens`)으로 표시.
- 예(실측 판): 내 장군(1,1)이 1피해→화약상(ATK1, 세로 ±1·±2) ⇒ 화약상∈{(1,0),(1,2),(1,3)}. 창병(2,4)이 2피해→갑주무사(ATK2, 아래 3칸) ⇒ 갑주무사∈{(1,3),(2,3),(3,3)}. ⇒ 내 장군(+모양)으로 (1,2) 또는 창병(세로열)으로 (2,3) 반격이 유력타.

### 📋 캐릭터 공격범위 표 (server.js `getAttackCells`, piece (c,r) 기준 · bounds 클리핑)
- **T1** archer=대각선 직선(토글 ↘/↙) · spearman=세로열 전체 · cavalry=가로행 전체 · watchman=주변8칸 · twins_elder/scout=가로3(c,c±1) · twins_younger/manhunter=세로3(r,r±1) · messenger=자기+대각4 · **gunpowder=세로 (r±1,r±2) 4칸(자기 제외)** · herbalist=가로 (c±1,c±2)
- **T2** general=자기+상하좌우(＋) · knight=자기+대각4(✕) · shadowAssassin=3×3 내 단일타깃 · wizard=상하좌우 거리2만(4칸) · **armoredWarrior=자기+아랫줄 3칸(c-1/c/c+1, r+1)** · witch=원거리 단일타깃 · dualBlade=대각4 · weaponSmith=토글(세로3/가로3) · bodyguard=상하좌우4
- **T3** prince=가로3 · princess=세로3 · king=자기만 · dragonTamer=대각4 · dragon=자기+상하좌우 · monk=세로(r±1) · slaughterHero=3×3 전체(9칸) · commander=좌우2(c±1) · **torturer=상하좌우4(십자, 자기제외)** · count=자기+대각4
- 활용: ① 내 공격 사거리 파악 ② 적 추리(역상) ③ 배치 시 상대 사거리 라인 회피. (정찰 scout=가로3 으로 적 공개도 가능)

### ✨ 스킬·SP·패시브 (server.js CHARACTERS + SP 경제)
- **SP 경제**: SP는 **턴 10·20·40·…(turnNumber%10==0, ≤40)** 에만 양측 +1 지급(상한 10, 풀 균형). **매우 희소 → 게임당 스킬 1~2번이 보통.** instant SP(`instantSp`)는 패시브로 별도 획득(마법사 instantMagic 등). 스킬 비용은 `sp+instantSp` 합산에서 차감. SP 부족 시 스킬 버튼 비활성.
- **`replacesAction`가 핵심**: true면 스킬이 그 턴 행동(이동/공격)을 대체(=스킬 쓰면 그 턴 공격 못함), false면 **이동/공격과 별개로 추가 사용**(템포 이득). `oncePerTurn`은 턴당 1회 제한.
- **스킬 사용 UI**: 액션바 **스킬 버튼 → `#skill-modal` → 스킬 선택 → (대상 필요 스킬은 보드/대상 클릭) → `use_skill` emit**.
- **스킬 표** (id · 캐릭터 · SP · replacesAction · 효과):
  - **T1**: reform(궁수,1,F,공격범위 반전) · brothers 분신(쌍둥이,2,T,형제 위치 합류) · recon 정찰(척후병,2,F,**랜덤 적1의 행 또는 열 공개=정찰**) · trap 덫(인간사냥꾼,2,T,현위치 덫·2피해) · sprint 질주(전령,1,F,이번턴 이동2회) · bomb 폭탄설치(화약상,2,F,주변8칸 중 설치)+detonate 기폭(화약상,0,F,설치폭탄 전부 폭발·1피해) · herb 약초학(약초전문가,2,F,주변 아군 체력1 회복)
  - **T2**: shadow 그림자숨기(그림자암살자,1,F,다음턴까지 공격·상태이상 면역) · curse 저주(마녀,3,T,적1 저주) · dualStrike 쌍검무(양손검객,2,F,이번턴 공격2회) · rats 역병의자손(쥐장수,2,F,쥐3 소환) · reform 정비(무기상,1,F,가로/세로 전환)
  - **T3**: ring 절대복종반지(국왕,3,F,적1 강제이동) · dragon 드래곤소환(드래곤조련사,5,F,드래곤 소환·최고가) · divine 신성(수도승,3,F,아군1 체력2회복+상태이상 제거) · sulfurRiver 유황범람(유황솥,3,T,보드 테두리 전체·2피해) · nightmare 악몽(고문관,2,F,**표식 상태 모든 적에게 1피해**)
- **패시브 (server.js `resolveDamage` 검증 — 정확한 효과)**:
  - **wrath(지휘관)**: 자기와 **직교 인접(상하좌우 1칸)한 아군**이 공격 시 **그 공격 피해 +1**. (버프 오라, "폭정"이라 넘겨짚었던 것 정정)
  - **grace(수도승)**: 악인(villain 태그) **공격 시 피해 3 고정**, 악인에게 **피격 시 피해 0.5로 감소**. (가호 = 대-악인 특화)
  - **tyranny(백작)**: **티어1/2 공격자**에게 피격 시 **피해 −0.5**. (저티어 공격 경감)
  - **ironSkin(갑주무사)**: 받는 모든 피해 **−0.5**.
  - **loyalty(호위무사)**: 같은 편 **왕실(royal) 아군이 피격되면 호위무사가 대신 1 피해**를 받고 **왕실은 0 피해**(항상 활성). 호위무사 HP≤1 시 자기 저주 즉시 해제.
  - **markPassive(고문관)**: 공격·피격 시 대상에 **표식** 부여 → 악몽(표식 적 전체 1피해) 콤보.
  - **instantMagic(마법사)**: 피격 시 **instant SP +1**.
  - **betrayer(학살영웅)**: 3×3 공격에 **아군도 피해**(오사) 주의.
- **데미지 처리 순서 (`resolveDamage`)**: ①저주 등 status dmg는 그대로 →②지휘관 wrath +1 →③수도승 vs 악인 =3 →④shadow면 0(면역) →⑤ironSkin −0.5 →⑥수도승 피격 by 악인 =0.5 →⑦백작 tyranny −0.5 →⑧호위무사 loyalty(왕실 대신 받고 0 반환) → 최종 max(0,dmg).
- **상태이상**: shadow(공격·상태이상 면역, 피해0) / curse(지속 0.5 피해, 마녀 사망 또는 대상 HP≤1 시 해제) / mark(표식 — 위치 공개 + 악몽 대상). status dmg(저주 지속)는 shadow 무관 적용.
- **덱빌딩 시너지 예**: 척후병(정찰로 적 공개)+고문관(공격→표식→악몽 광역)+α / 화약상(폭탄설치+기폭, replacesAction=F라 공격과 병행) / 양손검객·전령(쌍검무·질주로 턴당 2행동 템포).

### ⚙️ 핵심 규칙 시스템 (server.js 검증 — 기능개발용)
- **행동 경제**: **턴당 1행동**(`player.actionDone`) — 한 말로 **이동 OR 공격 1회**. 턴 시작 시 false 리셋(server 4463). 이동/공격하면 `actionDone=true`.
  - 예외: **replacesAction=false 스킬은 actionDone 미설정 = 무료**(이동/공격과 별개). **질주**(이동2회)·**쌍검무**(공격2회)는 추가 행동 부여.
- **턴 흐름**: 닉네임/덱 → 초기공개 → (교환드래프트) → 최종공개 → HP분배 → 배치 → 게임. 게임은 두 플레이어 번갈아 1턴씩, `turnNumber` 증가. 턴 90초(`TIMER_SECONDS`), 초과 시 강제 종료/스킵.
- **승패**: 적 말 **전멸 시 승**(`every(p=>!p.alive)`), 내 전멸 시 패. winnerIdx 0/1 외엔 무승부 폴백.
- **보드 축소(레벨: LV4=7×7, LV3=5×5, LV2=3×3, LV1=1×1)**:
  - **1v1**: 시작 LV3(5×5). 경고턴40→**축소턴50**(→3×3), 경고60→**축소70**(→1×1).
  - **팀전**: 시작 LV4(7×7). 축소 턴 30·60·80.
  - **대치(stalemate) 트리거**(1v1): **양측이 각각 alive 말 1개**가 되면 그 시점 +5턴 뒤 추가 축소 예약(기존 일정과 누적). 무한 대치 방지.
  - 축소 시 외곽 링 셀 파괴 → 그 위 말 사망(보드축소 사망 = **유해 없음**). 범위 밖 좌표는 `inBounds`로 차단.
- **SP**: 풀 기반, 턴 10·20·30·40에만 +1(상한10). instant SP 별도. (상세는 위 스킬 섹션)

### 학습 검증 완료 (AI 연습모드 실플레이)
- 덱 빌드(창병/장군/왕자) → 초기공개(교체안함) → HP분배(4/3/3) → 배치(row4 3말) → 게임 시작 → 이동/공격 실행 → 턴종료 → AI 턴 진행까지 전 과정 1회 완주.

## Completed (DO NOT re-execute)
- DOCX log/toast inventory document generated (CALIGO_log_toast_inventory.docx)
- Attack cell effect system implemented (game.js + style.css)
- Hit timing synchronization across all perspectives (ATTACK_IMPACT_DELAY = 500ms)
- Attack cell effect preview page (attack-cell-effect-preview.html)
- Comprehensive bug audit (56 issues found across server.js + game.js)
- Bug fixes 22 applied (server 11 + client 11) + syntax validation passed
- piece-gifs.js preloadAllAsync fix
- Attack cell effect fix: animateAttackCellEffect moved to after renderGameBoard (game.js line ~4418)
- Attack GIF frame clipping fix: elapsed time accounting + Blob URL for fresh animation (game.js animateAttackGif + piece-gifs.js _gifBlobCache)
- Character emoji → PNG icon migration (COMPLETE)
  - Icon PNGs copied to public/assets/icons/{type}.png (31 files)
  - PIECE_ICONS mapping + getPieceIconUrl() added to piece-gifs.js
  - pieceIconHtml() + pieceIconText() helpers added to game.js
  - CSS .piece-icon-img styles added to style.css
  - server.js CHARACTERS icon values → image paths + ALL emoji prefixes removed from skill messages
  - tutorial-interactive.js CHARS + TUT_CHARS_DATA icons → image paths
  - Board animations: twin join flight → move PNG, dragon summon → move PNG, ring teleport → move PNG
  - ring-anim.js refactored to use PIECE_MOVE_PNGS
  - game.js: ~150+ rendering locations replaced with pieceIconHtml()
  - game.js: SFX matching (pickSkillSfxByMsg) updated to match emoji-free messages
  - game.js: DARK_ICONS removed (dead code)
  - game.js: Tutorial tier/passive sections → pieceIconHtml with PIECE_ICONS
  - game.js: Client-generated log messages (scout, rat, trap) emoji prefixes removed
  - server.js: buildSpectatorSkillMsg patterns updated to emoji-free prefixes
  - NOT changed (per user instruction): status/action emojis (💀🏳⚔✨🏃⚡🎯☠👻📋), board object markers (🪤💣🐀💥), VFX particles, UI labels, twin sub-unit identifiers (👧👦)

- 유해 (Remains/Corpse) system implemented
  - server.js: room.remains[] flat array, handleDeath creates remains (except rat/dragon/sulfurCauldron/boardShrink deaths)
  - server.js: remains block movement (move_piece + _canMoveTo for AI), ring teleport, twin join, dragon summon
  - server.js: remains filtered on board shrink, included in all game state emissions (13 points)
  - server.js: AI evacuation (1v1 + team) checks remains, AI dragon placement avoids remains
  - game.js: S.remains stored from all state events (game_start, your_turn, opp_turn, move_ok, skill_result, status_update, team state)
  - game.js: remains rendered on board (💀 marker with .has-remains + .remains-marker CSS)
  - game.js: move-range shows dimmed green (.move-range-blocked) for remains/friendly/teammate cells
  - game.js: move click handler blocks remains cells with hint message
  - style.css: .has-remains, .remains-marker, .move-range-blocked styles (including #game-board specificity overrides)
  - Removal skill interface kept open (room.remains entries have full metadata) but no skill yet

- Death animation system implemented
  - game.js: playDeathAnimations(deaths, callback) — plays death GIF overlay on dying unit cells, respects facing direction, uses Blob URL for fresh playback + _fetchGifDuration for timing
  - game.js: _detectDeaths(destroyedList, isDefending) — extracts death info from cellResults/hitPieces with DOM-based facing direction detection
  - game.js: DEATH_ANIM_EXTRA_MS constant (100ms buffer after GIF ends)
  - game.js: attack_result handler restructured — death detection before state update, deferred renderGameBoard after death GIF completes (400ms hit settle + death GIF duration)
  - game.js: being_attacked handler restructured — same death animation flow for defender perspective
  - game.js: spectator_attack_anim handler — death GIF support for both 1v1 and team spectators
  - game.js: S._remainsFacing map tracks facing direction per cell for remains PNG rendering
  - game.js: Remains marker changed from skull emoji to remains.png with facing direction support
  - style.css: .death-anim-overlay + .death-gif styles (z-index:20, pixelated rendering)
  - style.css: .remains-marker updated from span/emoji to img tag (70% size, object-fit:contain, pixelated)
  - Assets used: window.PIECE_DEATH_GIFS, window.getPieceDeathGifUrl(), window.REMAINS_IMG (from piece-gifs.js)
  - noRemains types: dragon, sulfurCauldron, rat (no remains PNG after death)

- Death animation & remains 버그 수정 (세션 2)
  - 유해 사이즈: .remains-marker width/height 70%→140%, drop-shadow 블랙 아웃라인 추가 (style.css)
  - 사망 GIF 사이즈: .death-gif width/height 100%→140%, drop-shadow 블랙 아웃라인 추가 (style.css)
  - 이동 애니메이션 프레임 유실 수정: img.decode() 완료 후 교체 방식으로 변경 (game.js animateMove)
    - floater opacity:0 생성 → decode() → _beginSlide에서 opacity:1 + source 숨김 동시 수행
  - 유해 즉시 표시 수정: _addClientSideRemains() 헬퍼 추가 (game.js line 16323)
    - attack_result, being_attacked, spectator_attack_anim 4곳에서 사망 GIF 콜백 내 호출
    - 서버 이벤트 수신 전 클라이언트 측에서 S.remains에 즉시 추가
  - 피격 GIF 방향 수정: animateBoardIconHit에서 idleImg.style.transform 상속 (game.js line 16279)
    - 복원(restore) 시에도 _savedTransform 적용
  - 사망 GIF 1회만 재생 수정: NETSCAPE2.0 블록(19바이트) 전체 제거 방식
    - loop=1은 GIF 스펙상 2회 재생(초기+1루프)이므로 블록 자체 삭제
    - game.js playDeathAnimations + death-preview.html 동일 방식 적용
  - overflow 클리핑 수정: .cell { overflow:hidden } 때문에 140% 요소가 잘리는 문제
    - .cell.has-remains { overflow:visible } (style.css line 2765)
    - .cell:has(.death-anim-overlay) { overflow:visible } (style.css line 2783)
    - .death-anim-overlay { overflow:visible } (style.css line 2793)
  - death-preview.html: 독립 프리뷰 페이지 생성 (GIF 프레임 정보 파싱, 방향/타입 선택, overflow 테스트)

- 사망 GIF 빈 프레임 수정
  - S._pendingDeathCells (Set): 사망 GIF 대기 중인 셀 좌표 — renderGameBoard에서 alive=false 피스의 idle GIF 유지
  - _aliveOrPending 헬퍼를 IIFE 밖으로 이동 (스코핑 버그 수정)
  - attack_result / being_attacked 핸들러: renderGameBoard 전 세팅, playDeathAnimations 콜백에서 null 해제
  - 내 말 / 팀원 말 / 표식 적 말 세 경로 모두 적용
- 관전자 핸들러 TDZ 크래시 수정
  - spectator_attack_anim: _ffHitCellsSpec/_ffDeadSpec const 선언을 사용 위치 앞으로 이동
- 유해 위치 버그 조사 완료
  - 좌표 시스템 자체 오류 없음 (서버→클라이언트 전과정 절대 col/row)
  - bomb_detonated/trap_triggered 핸들러에서 _addClientSideRemains 미호출 발견 (유해 표시 지연)
  - 정확한 재현 조건 불명 — 유저 추가 제보 시 재조사
- 학살영웅(배반자) 팀킬 데미지 도장 수정
  - server.js: _friendlyFireHits.push에 defPieceIdx 추가 (for→인덱스 루프 전환)
  - game.js: attack_result 핸들러에 friendlyFireHits용 addBodyDamage 호출 추가
  - defPieceIdx 없는 구버전 서버 호환: col/row 기반 fallback lookup
- 쥐 피격 시 전체 모션 버그 수정
  - animateRatAttackGifs: filterCells 파라미터 추가 — 지정된 셀의 쥐만 애니
  - animateRatAttackFromCells: ratsByOwner의 쥐 좌표를 filterCells로 전달
  - attack_result의 직접 호출(공격자)은 영향 없음 (filterCells 미전달 → 전체 쥐 공격)
- 드래곤 소환 GIF 로드 누락 수정
  - piece-gifs.js: DRAGON_LANDING_GIF를 preloadGameImages + preloadAllAsync에 추가
  - game.js: animateDragonSummon에 300ms 타임아웃 가드 — 캐시 미스 시 PNG 폴백
  - _landingHandled 플래그로 중복 처리 방지
- 쥐 소환 → idle 공백 프레임 수정
  - rat-anim.js: spawn GIF를 body에 fixed 좌표로 임시 복사 → onLanded(renderGameBoard) 후 idle GIF decode() 완료까지 보존 → 무공백 전환
- 드래곤 소환 착지 위치 보정 (인게임 레이아웃 반영)
  - 원인: idle GIF 중심 = 셀의 ~39% (piece-marker: p-gif 38px + HP 텍스트 아래), 착지 GIF는 top:50% → 약 6px 아래에 착지
  - style.css: .dragon-landing-gif + .dragon-revealed → top: 50% → 40%
  - game.js: landImg.style.top = '40%' 추가, 사이즈 240% 유지
  - dragon-summon-preview.html: 인게임 piece-marker 레이아웃 재현 (p-gif 38px + HP 텍스트 0.6rem)
    - showIdle() → pieceMarkerHtml() (flex column + HP 텍스트)
    - 착지 top 슬라이더 추가 (20~55%, 기본 40%)
    - 사이즈 비교: idle+착지 오버레이 비교 추가
    - 이동 프리뷰도 piece-marker 레이아웃 적용

- 쥐 소환 GIF 프레임 누락 수정 (2번째+ 쥐)
  - 원인: Chrome이 동일 바이너리 GIF의 애니메이션 타이머를 공유 → 뒤에 추가된 GIF가 이미 진행된 프레임부터 시작
  - 수정: 각 GIF 바이너리에 고유 GIF Comment Extension (8바이트) 삽입 → Chrome이 별개 GIF로 인식
  - GCT 뒤에 삽입: 0x21 0xFE [4] [uid 4바이트] 0x00 — 렌더링에 무영향
  - window._ratGifUid 글로벌 카운터로 유일성 보장
  - rat-anim.js (소환) + game.js animateRatAttackGifs (공격) 양쪽 적용
- 사망 애니 오버레이 개선 (아군 유닛 공존)
  - 기존: marker.display='none' → 같은 셀 아군 유닛이 사라짐
  - 변경: marker.opacity='0.3' (딤) + death overlay z-index:20 으로 상단 표시
  - GIF 로드 완료 시 딤, 재생 종료 시 opacity/transition 복원
  - game.js playDeathAnimations 3곳 (정상/catch/timeout) 모두 적용
- 반지 텔레포트 이동PNG → idle GIF 변경
  - ring-anim.js: _victimVisualHtml 우선순위 idle GIF(PIECE_GIFS) → 이동PNG(폴백)
  - idle GIF 38×38px (인게임 p-gif 크기와 동일)
- 유해 위 유닛 multiply 그라디언트 분리
  - style.css: .cell.has-remains .piece-marker::after — linear-gradient(transparent 15%, rgba(0,0,0,0.55) 100%) + mix-blend-mode:multiply
  - 유해와 유닛의 시각적 분리 강화 (모든 모션에 자동 적용)
- 드래곤/유황솥 사망 애니 공격자에게 미공유 수정
  - 원인: attack_result에서 _noRemainTypes 필터가 dragon/sulfurCauldron을 _deathInfos에서 제외 → playDeathAnimations 미호출
  - 수정: 필터 제거 → _deathInfos = _deathInfosRaw (전체 사망 포함)
  - _addClientSideRemains 내부에서 이미 dragon/sulfurCauldron/rat 유해 생성 skip 처리 중이므로 안전
  - 추가 효과: _pendingDeathCells에 드래곤 포함 → idle GIF DOM 유지 → 사망 GIF 사이즈 정확히 idle에 맞춤
- death-ring-preview.html 생성 (사망 오버레이 + 유해 multiply + 반지 idle GIF 통합 프리뷰)
- 쥐 공격 GIF 중간 잘림 수정
  - 원인: 쥐 공격 GIF가 cell 내부에 appendChild → _impactDelay(~300ms) 후 renderGameBoard()가 셀 재구축 → GIF 파괴 (총 ~650ms 중 절반만 재생)
  - 수정: animateRatAttackGifs에서 공격 GIF를 document.body에 position:fixed로 배치
  - cell.getBoundingClientRect() 기반 좌표 계산 → renderGameBoard() 영향 밖에서 전체 재생 보장
  - cleanup에서 body에서 제거 + Blob URL 해제

- SP 증정 애니 타이밍 수정 (stalemate_shrink + sp_grant 동시 발생 시)
  - 원인: sp_grant가 stalemate_shrink 뒤에 runFullscreenLocked 큐잉 → ~3.5초 gap 동안 your_turn이 S.sp를 NEW로 갱신 → _spAnimGuard 미설정 → updateSPBar가 숫자를 미리 표시
  - 수정 (1): turn_event sp_grant 수신 즉시 _spAnimGuard = true 설정 (큐잉 전)
  - 수정 (2): OLD SP 값을 수신 시점에 _capturedOldSp로 캡처 → playSpGrantAnimation에 전달
  - 수정 (3): playSpGrantAnimation에 capturedOldSp/capturedOldInstantSp 파라미터 추가 → S.sp 대신 캡처 값 사용

- 폭탄 이모지 → GIF 교체 (bomb_idle.gif + bomb_explode.gif)
  - piece-gifs.js: BOMB_IDLE_GIF, BOMB_EXPLODE_GIF 글로벌 추가 + preloadGameImages/preloadAllAsync 등록
  - game.js (플레이어 보드): 💣 emoji span → <img class="bomb-marker-gif"> (bomb_idle.gif)
  - game.js (관전자 보드): 동일 교체
  - game.js (playBombExplosion): 💥 burst emoji 제거 → 파편만 유지 (폭발 GIF가 대체)
  - game.js (detonation_intro): 인트로 마커(💣 idle + reveal/arm 단계) 삭제 → 바로 explosion GIF 오버레이
    - BOMB_IMPACT_DELAY = 1300ms (frame #10) 에 셀 쉐이크 + 컬러 플래시 + 파편 + SFX 발동
    - NETSCAPE2.0 블록 제거 (1회 재생) + GIF Comment Extension (Chrome 캐시 분리)
    - 폴백: GIF 로드 실패 시 셀 플래시 + SFX만
  - style.css: .bomb-marker-gif (idle — 32×32, bottom:36px, right:-8px, 호박색 글로우)
  - style.css: .bomb-explode-overlay (detonation — 240%, 셀 중앙, z-index:20)
  - 에셋: public/assets/bomb_idle.gif (32×32, 9프레임), public/assets/bomb_explode.gif (64×64, 20프레임)

## Pending
- All changes uncommitted in git
- 유해 제거 스킬 (user will define later)
- bomb_detonated/trap_triggered 사망 시 _addClientSideRemains 호출 추가 (유해 즉시 표시)

## Tested (2025-05-25, 1v1 AI mode, 17 turns, 0 errors)
- Turn transitions (player ↔ AI)
- Turn timeout auto-end
- SP grant per cycle
- Move via radial menu + log/toast
- Attack miss + attack hit + damage display
- Being attacked (HP reduction + log)
- AI skill usage (scout)
- No-action turn end confirm modal
- Attack cell effect animation
- closeAllModals on screen transitions
- Console errors: 0

## Architecture Notes
- Server: server.js (Node.js + Socket.IO)
- Client: public/game.js (main), public/style.css, public/piece-gifs.js
- Preview: public/attack-cell-effect-preview.html
- Launch config: .claude/launch.json (port 3000)
- Runtime: Windows native (NOT WSL) - use PowerShell, not Bash with Linux paths
