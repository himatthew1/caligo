# CALIGO Board Game - Project Instructions

## Rules
- Do NOT execute any skill (docx, etc.) unless the user explicitly requests it in the current message
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

## Pending
- All changes uncommitted in git
- 유해 제거 스킬 (user will define later)

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
