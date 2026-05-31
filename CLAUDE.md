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
