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

  // ── 피격 GIF 맵 ──────────────────────────────────────
  window.PIECE_HIT_GIFS = {
    // ── Tier 1 ──────────────────────────────
    archer:         '/art/archer_hit.gif',
    spearman:       '/art/spearman_hit.gif',
    cavalry:        '/art/cavalry_hit.gif',
    watchman:       '/art/watchman_hit.gif',
    scout:          '/art/scout_hit.gif',
    manhunter:      '/art/manhunter_hit.gif',
    messenger:      '/art/messenger_hit.gif',
    gunpowder:      '/art/gunpowder_hit.gif',
    herbalist:      '/art/herbalist_hit.gif',
    twins_red:      '/art/twins_red_hit.gif',
    twins_blue:     '/art/twins_blue_hit.gif',
    twins_joined:   '/art/twins_joined_hit.gif',
    // ── Tier 2 ──────────────────────────────
    general:        '/art/general_hit.gif',
    knight:         '/art/knight_hit.gif',
    shadowAssassin: '/art/shadowAssassin_hit.gif',
    wizard:         '/art/wizard_hit.gif',
    armoredWarrior: '/art/armoredWarrior_hit.gif',
    witch:          '/art/witch_hit.gif',
    dualBlade:      '/art/dualBlade_hit.gif',
    ratMerchant:    '/art/ratMerchant_hit.gif',
    ratcatcher:     '/art/ratMerchant_hit.gif',
    weaponSmith:    '/art/weaponSmith_hit.gif',
    bodyguard:      '/art/bodyguard_hit.gif',
    // ── Tier 3 ──────────────────────────────
    prince:         '/art/prince_hit.gif',
    princess:       '/art/princess_hit.gif',
    king:           '/art/king_hit.gif',
    dragonTamer:    '/art/dragonTamer_hit.gif',
    monk:           '/art/monk_hit.gif',
    slaughterHero:  '/art/slaughterHero_hit.gif',
    commander:      '/art/commander_hit.gif',
    sulfurCauldron: '/art/sulfurCauldron_hit.gif',
    torturer:       '/art/torturer_hit.gif',
    count:          '/art/count_hit.gif',
    // ── 소환 유닛 ────────────────────────────
    dragon:         '/art/dragon_hit.gif',
  };

  /**
   * 피격 GIF URL 반환
   * @param {string} type
   * @param {string} [subUnit]  'elder' | 'younger'
   * @param {boolean} [isJoined]
   */
  window.getPieceHitUrl = function (type, subUnit, isJoined) {
    const map = window.PIECE_HIT_GIFS;
    if (!map) return null;
    let url;
    if (isJoined)                  url = map.twins_joined;
    else if (subUnit === 'elder')   url = map.twins_red;
    else if (subUnit === 'younger') url = map.twins_blue;
    else                            url = map[type];
    return url || null;
  };

  // ── 공격 GIF 맵 (64×64) ──────────────────────────────
  window.PIECE_ATTACK_GIFS = {
    // ── Tier 1 ──────────────────────────────
    archer:         '/art/archer_attack.gif',
    spearman:       '/art/spearman_attack.gif',
    cavalry:        '/art/cavalry_attack.gif',
    watchman:       '/art/watchman_attack.gif',
    scout:          '/art/scout_attack.gif',
    manhunter:      '/art/manhunter_attack.gif',
    messenger:      '/art/messenger_attack.gif',
    gunpowder:      '/art/gunpowder_attack.gif',
    herbalist:      '/art/herbalist_attack.gif',
    twins_red:      '/art/twins_red_attack.gif',
    twins_blue:     '/art/twins_blue_attack.gif',
    twins_joined:   '/art/twins_joined_attack.gif',
    // ── Tier 2 ──────────────────────────────
    general:        '/art/general_attack.gif',
    knight:         '/art/knight_attack.gif',
    shadowAssassin: '/art/shadowAssassin_attack.gif',
    wizard:         '/art/wizard_attack.gif',
    armoredWarrior: '/art/armoredWarrior_attack.gif',
    witch:          '/art/witch_attack.gif',
    dualBlade:      '/art/dualBlade_attack.gif',
    ratMerchant:    '/art/ratMerchant_attack.gif',
    ratcatcher:     '/art/ratMerchant_attack.gif',
    weaponSmith:    '/art/weaponSmith_attack.gif',
    bodyguard:      '/art/bodyguard_attack.gif',
    // ── Tier 3 ──────────────────────────────
    prince:         '/art/prince_attack.gif',
    princess:       '/art/princess_attack.gif',
    king:           '/art/king_attack.gif',
    dragonTamer:    '/art/dragonTamer_attack.gif',
    monk:           '/art/monk_attack.gif',
    slaughterHero:  '/art/slaughterHero_attack.gif',
    commander:      '/art/commander_attack.gif',
    sulfurCauldron: '/art/sulfurCauldron_attack.gif',
    torturer:       '/art/torturer_attack.gif',
    count:          '/art/count_attack.gif',
    // ── 소환 유닛 ────────────────────────────
    dragon:         '/art/dragon_attack.gif',
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
  // ── 이미지 프리로드 헬퍼 — url 배열을 받아 숨겨진 img 태그로 브라우저 캐시에 적재 ──
  function _injectPreloadImgs(urls) {
    if (document.getElementById('_caligo-preload-cache')) {
      // 이미 컨테이너가 있으면 추가만
      const c = document.getElementById('_caligo-preload-cache');
      for (const url of urls) {
        if (!url) continue;
        const img = document.createElement('img');
        img.src = url; img.decoding = 'async'; img.loading = 'eager';
        c.appendChild(img);
      }
      return;
    }
    const container = document.createElement('div');
    container.id = '_caligo-preload-cache';
    container.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;' +
      'overflow:hidden;opacity:0;pointer-events:none;z-index:-1';
    for (const url of urls) {
      if (!url) continue;
      const img = document.createElement('img');
      img.src = url; img.decoding = 'async'; img.loading = 'eager';
      container.appendChild(img);
    }
    document.body.appendChild(container);
  }

  window.preloadGameImages = function () {
    // ① piece-gifs.js 가 직접 관리하는 캐릭터 에셋 (맵 기반 — 신규 캐릭터 추가 시 자동 포함)
    const knownUrls = new Set([
      ...Object.values(window.PIECE_GIFS        || {}),
      ...Object.values(window.PIECE_HIT_GIFS    || {}),
      ...Object.values(window.PIECE_ATTACK_GIFS || {}),
      ...Object.values(window.PIECE_MOVE_PNGS   || {}),
    ]);
    _injectPreloadImgs([...knownUrls]);

    // ② 서버 매니페스트로 public/ 의 모든 이미지 자동 적재
    //    새 스킬 아이콘·패시브 PNG 를 추가해도 이 코드를 수정할 필요 없음
    fetch('/api/asset-manifest')
      .then(r => r.json())
      .then(({ urls }) => {
        const extra = (urls || []).filter(u => {
          // art/ 는 이미 위에서 처리, HTML/CSS/JS 제외
          if (u.startsWith('/art/')) return false;
          return /\.(png|gif|jpg|jpeg|webp)$/i.test(u);
        });
        _injectPreloadImgs(extra);
        // 서버 매니페스트에 포함된 GIF 도 duration 캐시 대상에 등록
        if (!window._manifestGifUrls) window._manifestGifUrls = [];
        window._manifestGifUrls.push(...extra.filter(u => u.endsWith('.gif')));
      })
      .catch(() => {
        // 매니페스트 fetch 실패 시 하드코딩 폴백 (오프라인 환경 등)
        _injectPreloadImgs([
          '/fangs-top.png', '/fangs-bottom.png',
          '/가호.png', '/그림자 숨기.png', '/기폭.png', '/덫 설치.png',
          '/드래곤 소환.png', '/배반자.png', '/분신.png', '/사기증진.png',
          '/신성.png', '/쌍검무.png', '/아이언스킨.png', '/악몽.png',
          '/약초학.png', '/역병의 자손들.png', '/유황범람.png',
          '/인스턴트 매직.png', '/저주.png', '/절대복종 반지.png',
          '/정비.png', '/정찰.png', '/질주.png', '/충성.png',
          '/폭정.png', '/폭탈 설치.png', '/표식.png',
        ]);
      });
  };

  // DOM 준비 즉시 프리로드 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.preloadGameImages);
  } else {
    window.preloadGameImages();
  }

  // ── GIF 재생 시간 사전 캐싱 ──────────────────────────────────────────────
  // 게임 중 _fetchGifDuration() 가 첫 호출 시 fetch + 바이트 파싱을 실행하면
  // 첫 공격/피격 애니메이션에서 수백 ms 지연이 발생한다.
  // 이 함수를 페이지 로드 직후에 호출해 _gifDurationCache 를 모두 채워두면
  // 이후 게임 중 모든 GIF 재생이 즉시(캐시 히트)로 동작한다.
  // onProgress(0~1) : 로딩 진행률 콜백 (선택).
  window.preloadGifDurationsAsync = async function (onProgress) {
    if (!window._gifDurationCache) window._gifDurationCache = {};

    // 공격 GIF 를 가장 먼저 — 가장 자주 쓰이는 동작
    // _manifestGifUrls : preloadGameImages() 가 /api/asset-manifest 로 받은 추가 GIF 목록
    const urls = new Set([
      ...Object.values(window.PIECE_ATTACK_GIFS || {}),
      ...Object.values(window.PIECE_HIT_GIFS    || {}),
      ...Object.values(window.PIECE_GIFS        || {}),
      ...(window._manifestGifUrls             || []),  // 매니페스트 기반 추가 GIF 자동 포함
    ]);
    const toFetch = [...urls].filter(
      u => u && u.endsWith('.gif') && window._gifDurationCache[u] === undefined
    );
    const total = toFetch.length;
    if (total === 0) { if (onProgress) onProgress(1); return; }

    let done = 0;
    // 병렬 fetch — 이미지는 preloadGameImages() 로 캐시됐으므로 실제 네트워크 요청 없음
    await Promise.all(toFetch.map(async url => {
      try {
        const bytes = new Uint8Array(
          await (await fetch(url, { cache: 'default' })).arrayBuffer()
        );
        let ms = 0;
        for (let i = 0; i < bytes.length - 7; i++) {
          if (bytes[i] === 0x21 && bytes[i+1] === 0xF9 && bytes[i+2] === 0x04) {
            ms += (bytes[i+4] | (bytes[i+5] << 8)) * 10;
            i += 7;
          }
        }
        window._gifDurationCache[url] = ms || 650;
      } catch (_) {
        window._gifDurationCache[url] = 650;  // 실패 시 기본값
      }
      done++;
      if (onProgress) onProgress(done / total);
    }));
  };
}());
