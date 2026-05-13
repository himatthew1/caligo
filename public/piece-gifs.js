// CALIGO 캐릭터 idle GIF 맵 — game.js + tutorial-interactive.js 공통 사용
// 파일 위치: public/art/{type}_idle.gif
(function () {
  'use strict';

  window.PIECE_GIFS = {
    // ── Tier 1 ──────────────────────────────
    archer:         '/art/archer_idle.gif',
    spearman:       '/art/spearman_idle.gif',
    cavalry:        '/art/cavalry_idle.gif',
    watchman:       '/art/watchman_idle.gif',
    scout:          '/art/scout_idle.gif',
    manhunter:      '/art/manhunter_idle.gif',
    messenger:      '/art/messenger_idle.gif',
    gunpowder:      '/art/gunpowder_idle.gif',
    herbalist:      '/art/herbalist_idle.gif',
    twins_red:      '/art/twins_red_idle.gif',
    twins_blue:     '/art/twins_blue_idle.gif',
    twins_joined:   '/art/twins_joined_idle.gif',
    // ── Tier 2 ──────────────────────────────
    general:        '/art/general_idle.gif',
    knight:         '/art/knight_idle.gif',
    shadowAssassin: '/art/shadowAssassin_idle.gif',
    wizard:         '/art/wizard_idle.gif',
    armoredWarrior: '/art/armoredWarrior_idle.gif',
    witch:          '/art/witch_idle.gif',
    dualBlade:      '/art/dualBlade_idle.gif',
    ratMerchant:    '/art/ratMerchant_idle.gif',
    ratcatcher:     '/art/ratMerchant_idle.gif',  // 튜토리얼 별칭
    weaponSmith:    '/art/weaponSmith_idle.gif',
    bodyguard:      '/art/bodyguard_idle.gif',
    // ── Tier 3 ──────────────────────────────
    prince:         '/art/prince_idle.gif',
    princess:       '/art/princess_idle.gif',
    king:           '/art/king_idle.gif',
    dragonTamer:    '/art/dragonTamer_idle.gif',
    monk:           '/art/monk_idle.gif',
    slaughterHero:  '/art/slaughterHero_idle.gif',
    commander:      '/art/commander_idle.gif',
    sulfurCauldron: '/art/sulfurCauldron_idle.gif',
    torturer:       '/art/torturer_idle.gif',
    count:          '/art/count_idle.gif',
    // ── 소환 유닛 ────────────────────────────
    dragon:         '/art/dragon_idle.gif',
  };

  /**
   * 캐릭터 타입 → <img class="p-gif"> HTML 문자열
   * GIF 없으면 null 반환 → 호출 측에서 이모지 폴백
   *
   * @param {string}  type      캐릭터 type
   * @param {string}  [subUnit] 'elder' | 'younger' (쌍둥이)
   * @param {boolean} [isJoined] 쌍둥이 합류 상태 (같은 칸)
   */
  window.getPieceGifHtml = function (type, subUnit, isJoined) {
    const map = window.PIECE_GIFS;
    if (!map) return null;
    let url;
    if (isJoined)                  url = map.twins_joined;
    else if (subUnit === 'elder')   url = map.twins_red;
    else if (subUnit === 'younger') url = map.twins_blue;
    else                            url = map[type];
    return url ? `<img class="p-gif" src="${url}" alt="">` : null;
  };
}());
