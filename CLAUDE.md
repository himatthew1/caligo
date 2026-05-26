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

## Pending
- All changes uncommitted in git

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
