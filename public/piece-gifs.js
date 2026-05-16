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

  // ── 이동 플로팅용 PNG 맵 ─────────────────────────────
  window.PIECE_MOVE_PNGS = {
    // ── Tier 1 ──────────────────────────────
    archer:         '/art/archer_move.png',
    spearman:       '/art/spearman_move.png',
    cavalry:        '/art/cavalry_move.png',
    watchman:       '/art/watchman_move.png',
    scout:          '/art/scout_move.png',
    manhunter:      '/art/manhunter_move.png',
    messenger:      '/art/messenger_move.png',
    gunpowder:      '/art/gunpowder_move.png',
    herbalist:      '/art/herbalist_move.png',
    twins_red:      '/art/twins_red_move.png',
    twins_blue:     '/art/twins_blue_move.png',
    // ── Tier 2 ──────────────────────────────
    general:        '/art/general_move.png',
    knight:         '/art/knight_move.png',
    shadowAssassin: '/art/shadowAssassin_move.png',
    wizard:         '/art/wizard_move.png',
    armoredWarrior: '/art/armoredWarrior_move.png',
    witch:          '/art/witch_move.png',
    dualBlade:      '/art/dualBlade_move.png',
    ratMerchant:    '/art/ratMerchant_move.png',
    ratcatcher:     '/art/ratMerchant_move.png',
    weaponSmith:    '/art/weaponSmith_move.png',
    bodyguard:      '/art/bodyguard_move.png',
    // ── Tier 3 ──────────────────────────────
    prince:         '/art/prince_move.png',
    princess:       '/art/princess_move.png',
    king:           '/art/king_move.png',
    dragonTamer:    '/art/dragonTamer_move.png',
    monk:           '/art/monk_move.png',
    slaughterHero:  '/art/slaughterHero_move.png',
    commander:      '/art/commander_move.png',
    sulfurCauldron: '/art/sulfurCauldron_move.png',
    torturer:       '/art/torturer_move.png',
    count:          '/art/count_move.png',
    // ── 소환 유닛 ────────────────────────────
    dragon:         '/art/dragon_move.png',
  };

  /**
   * 이동 플로팅용 PNG URL 반환
   * PNG 없으면 idle GIF URL 반환 (폴백)
   *
   * @param {string}  type
   * @param {string}  [subUnit]  'elder' | 'younger' (쌍둥이)
   * @param {boolean} [isJoined] 쌍둥이 합류 상태
   */
  window.getPieceMoveUrl = function (type, subUnit, isJoined) {
    const mmap = window.PIECE_MOVE_PNGS;
    const gmap = window.PIECE_GIFS;
    let url;
    if (isJoined)                  url = null; // 합류 — move PNG 없음
    else if (subUnit === 'elder')   url = mmap && mmap.twins_red;
    else if (subUnit === 'younger') url = mmap && mmap.twins_blue;
    else                            url = mmap && mmap[type];
    if (url) return url;
    // 폴백: idle GIF
    if (isJoined)                  url = gmap && gmap.twins_joined;
    else if (subUnit === 'elder')   url = gmap && gmap.twins_red;
    else if (subUnit === 'younger') url = gmap && gmap.twins_blue;
    else                            url = gmap && gmap[type];
    return url || null;
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

  // ── 전체 이미지 프리로드 ──────────────────────────────────────────────
  // 게임 중 동적으로 생성되는 <img> 요소의 1~2프레임 디코딩 딜레이 방지.
  // 숨겨진 DOM 컨테이너에 모든 이미지를 미리 렌더 → 브라우저가 디코딩 완료 상태 유지.
  // 이후 같은 URL 의 <img src="..."> 는 캐시에서 즉시 페인트.
  window.preloadGameImages = function () {
    if (document.getElementById('_caligo-preload-cache')) return; // 중복 방지

    const container = document.createElement('div');
    container.id = '_caligo-preload-cache';
    container.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;' +
      'overflow:hidden;opacity:0;pointer-events:none;z-index:-1';

    // idle GIF + move PNG
    const allUrls = new Set([
      ...Object.values(window.PIECE_GIFS  || {}),
      ...Object.values(window.PIECE_MOVE_PNGS || {}),
      // 덫·스킬·패시브 이펙트 PNG
      '/fangs-top.png', '/fangs-bottom.png',
      '/가호.png', '/그림자 숨기.png', '/기폭.png', '/덫 설치.png',
      '/드래곤 소환.png', '/배반자.png', '/분신.png', '/사기증진.png',
      '/신성.png', '/쌍검무.png', '/아이언스킨.png', '/악몽.png',
      '/약초학.png', '/역병의 자손들.png', '/유황범람.png',
      '/인스턴트 매직.png', '/저주.png', '/절대복종 반지.png',
      '/정비.png', '/정찰.png', '/질주.png', '/충성.png',
      '/폭정.png', '/폭탈 설치.png', '/표식.png',
    ]);

    for (const url of allUrls) {
      if (!url) continue;
      const img = document.createElement('img');
      img.src = url;
      img.decoding = 'async';   // 메인 스레드 블로킹 방지
      img.loading  = 'eager';
      container.appendChild(img);
    }

    document.body.appendChild(container);
  };

  // DOM 준비 즉시 프리로드 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.preloadGameImages);
  } else {
    window.preloadGameImages();
  }
}());
