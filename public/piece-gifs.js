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

  // ── 사망 GIF 맵 ──────────────────────────────────────
  // 대부분 캐릭터는 공통 사망 GIF, 드래곤/유황솥만 고유 사망 GIF.
  window.PIECE_DEATH_GIFS = {
    _common:        '/art/death_common.gif',
    dragon:         '/art/death_dragon.gif',
    sulfurCauldron: '/art/death_sulfurCauldron.gif',
  };

  // ── 유해 PNG ──────────────────────────────────────
  window.REMAINS_IMG = '/art/remains.png';
  // ── 유해 단계별 정적 이미지 (stage = hits+1) ──
  //   1 = 공통 유해(피해 없음), 2 = 1타, 3 = 2타. (4타째는 제거되어 이미지 없음)
  window.REMAINS_STAGE_IMGS = {
    1: '/art/remains.png',        // 공통 유해_PNG
    2: '/art/remains_hit1.png',   // 유해피격_1_png
    3: '/art/remains_hit2.png',   // 유해피격_2_png
  };
  // ── 유해 피격 시 재생할 GIF (피격 횟수 N = 1·2·3) ──
  //   1타 → remains_hit1.gif → remains_hit1.png 로 정착
  //   2타 → remains_hit2.gif → remains_hit2.png 로 정착
  //   3타 → remains_hit3.gif → 유해 제거
  window.REMAINS_HIT_GIFS = {
    1: '/art/remains_hit1.gif',   // 유해피격_1_gif
    2: '/art/remains_hit2.gif',   // 유해피격_2_gif
    3: '/art/remains_hit3.gif',   // 유해피격_3_gif
  };

  // ── 폭탄 보드 오브젝트 GIF ──────────────────────────────
  window.BOMB_IDLE_GIF    = '/assets/bomb_idle.gif';
  window.BOMB_EXPLODE_GIF = '/assets/bomb_explode.gif';

  // ── 저주 상태 GIF (보드 위 전용 — 유닛 뒤 망령) ──────────────
  //   idle = 저주 지속 상태(루프, 뒤에 깔림) / summon = 최초 부여(1회) /
  //   damage = 매턴 저주 데미지 틱(1회, 대상 전원 동시) / release = 해제(1회).
  window.CURSE_GIFS = {
    idle:    '/art/curse/curse_idle.gif',
    summon:  '/art/curse/curse_summon.gif',
    damage:  '/art/curse/curse_damage.gif',
    release: '/art/curse/curse_release.gif',
  };
  window.getCurseGifUrl = function (kind) {
    return (window.CURSE_GIFS && window.CURSE_GIFS[kind]) || null;
  };
  // 저주 이동 PNG — 저주 유닛 이동 시 이동 PNG 뒤에 따라붙는 망령 (idle 과 동일 배치/글로우)
  window.CURSE_MOVE_PNG = '/art/curse/curse_move.png';

  // ── 표식/악몽 GIF (저주와 평행 구조: 정수리 위 표식 레이어 + 인두/불꽃/생성·해제·악몽) ──
  //   iron=인두 PNG / summon=생성 1회 / idle=표식 지속(루프) / move=이동 PNG / release=해제 1회 / nightmare=악몽 1회
  window.MARK_GIFS = {
    iron:      '/art/mark/mark_iron.png',
    summon:    '/art/mark/mark_summon.gif',
    idle:      '/art/mark/mark_idle.gif',
    move:      '/art/mark/mark_move.png',
    release:   '/art/mark/mark_release.gif',
    nightmare: '/art/mark/nightmare.gif',
  };
  window.getMarkGifUrl = function (kind) { return (window.MARK_GIFS && window.MARK_GIFS[kind]) || null; };

  // ── 쥐 보드 오브젝트 GIF ────────────────────────────
  // black = 아군 쥐, white = 적군 쥐.
  // 적군 쥐는 대척점 배치: x/y 부호 반전 + scaleX(-1) 좌우반전.
  window.RAT_GIFS = {
    black: { idle:'/art/rat_black_idle.gif', spawn:'/art/rat_black_spawn.gif', attack:'/art/rat_black_attack.gif', death:'/art/rat_black_death.gif' },
    white: { idle:'/art/rat_white_idle.gif', spawn:'/art/rat_white_spawn.gif', attack:'/art/rat_white_attack.gif', death:'/art/rat_white_death.gif' },
  };
  // 모션별 위치/크기 (셀 중앙 기준 % 오프셋). 아군 기준 값 — 적군은 x/y 반전.
  window.RAT_ANIM_CONFIG = {
    idle:   { x:37, y:30, w:50, h:50 },
    spawn:  { x:38.6, y:-1.3, w:100, h:100 },
    attack: { x:37, y:29, w:100, h:100 },
    death:  { x:37, y:30, w:50, h:50 },
  };

  /**
   * 사망 GIF URL 반환
   * @param {string} type  piece.type
   * @returns {string}
   */
  window.getPieceDeathGifUrl = function (type) {
    const map = window.PIECE_DEATH_GIFS;
    if (!map) return '/art/death_common.gif';
    return map[type] || map._common || '/art/death_common.gif';
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

  // ── 드래곤 착지(강림) 에셋 ────────────────────────────
  window.DRAGON_LANDING_GIF = '/art/dragon_landing.gif';
  window.DRAGON_LANDING_PNG = '/art/dragon_landing.png';

  // ── 캐릭터 아이콘 PNG 맵 ────────────────────────────────
  // 모든 UI (보드·프로필·로그·토스트·덱·추론토큰) 에서 이모지 대신 사용.
  // 렌더링은 game.js 의 pieceIconHtml() 헬퍼를 통해 <img> 태그로 출력.
  window.PIECE_ICONS = {
    // ── Tier 1 ──────────────────────────────
    archer:         '/assets/icons/archer.png',
    spearman:       '/assets/icons/spearman.png',
    cavalry:        '/assets/icons/cavalry.png',
    watchman:       '/assets/icons/watchman.png',
    twins:          '/assets/icons/twins.png',
    twins_red:      '/assets/icons/twins.png',
    twins_blue:     '/assets/icons/twins.png',
    scout:          '/assets/icons/scout.png',
    manhunter:      '/assets/icons/manhunter.png',
    messenger:      '/assets/icons/messenger.png',
    gunpowder:      '/assets/icons/gunpowder.png',
    herbalist:      '/assets/icons/herbalist.png',
    // ── Tier 2 ──────────────────────────────
    general:        '/assets/icons/general.png',
    knight:         '/assets/icons/knight.png',
    shadowAssassin: '/assets/icons/shadowAssassin.png',
    wizard:         '/assets/icons/wizard.png',
    armoredWarrior: '/assets/icons/armoredWarrior.png',
    witch:          '/assets/icons/witch.png',
    dualBlade:      '/assets/icons/dualBlade.png',
    ratMerchant:    '/assets/icons/ratMerchant.png',
    weaponSmith:    '/assets/icons/weaponSmith.png',
    bodyguard:      '/assets/icons/bodyguard.png',
    // ── Tier 3 ──────────────────────────────
    prince:         '/assets/icons/prince.png',
    princess:       '/assets/icons/princess.png',
    king:           '/assets/icons/king.png',
    dragonTamer:    '/assets/icons/dragonTamer.png',
    monk:           '/assets/icons/monk.png',
    slaughterHero:  '/assets/icons/slaughterHero.png',
    commander:      '/assets/icons/commander.png',
    sulfurCauldron: '/assets/icons/sulfurCauldron.png',
    torturer:       '/assets/icons/torturer.png',
    count:          '/assets/icons/count.png',
    // ── 소환 유닛 ────────────────────────────
    dragon:         '/assets/icons/dragon.png',
  };

  /**
   * 캐릭터 아이콘 URL 반환
   * @param {string} type       piece.type
   * @param {string} [subUnit]  'elder' | 'younger' (쌍둥이)
   * @param {boolean} [isJoined] 쌍둥이 합류 상태
   * @returns {string|null}
   */
  window.getPieceIconUrl = function (type, subUnit, isJoined) {
    const map = window.PIECE_ICONS;
    if (!map) return null;
    if (isJoined)                  return map.twins || null;
    if (subUnit === 'elder')       return map.twins_red || map.twins || null;
    if (subUnit === 'younger')     return map.twins_blue || map.twins || null;
    return map[type] || null;
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
  // ── 숨김 컨테이너 가져오기 또는 생성 ────────────────────────────────────
  function _getPreloadContainer() {
    let c = document.getElementById('_caligo-preload-cache');
    if (!c) {
      c = document.createElement('div');
      c.id = '_caligo-preload-cache';
      c.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:64px;height:64px;' +
        'overflow:hidden;opacity:0.001;pointer-events:none;z-index:-1';
      // opacity:0.001 — 완전한 0 또는 visibility:hidden 이면 일부 브라우저가
      // 이미지를 아예 렌더링하지 않아 디코드 캐시에 올라가지 않을 수 있음
      document.body.appendChild(c);
    }
    return c;
  }

  // ── 빠른 브라우저 캐시 주입 (DOMContentLoaded 직후용 — 동기) ───────────
  // HTTP fetch 를 병렬로 시작하는 것만으로도 다운로드를 앞당길 수 있음.
  // 실제 디코드 완료(decode cache 채움)는 preloadAllAsync 가 담당한다.
  window.preloadGameImages = function () {
    const knownUrls = new Set([
      ...Object.values(window.PIECE_GIFS        || {}),
      ...Object.values(window.PIECE_HIT_GIFS    || {}),
      ...Object.values(window.PIECE_ATTACK_GIFS || {}),
      ...Object.values(window.PIECE_DEATH_GIFS  || {}),
      ...Object.values(window.PIECE_MOVE_PNGS   || {}),
      ...Object.values(window.PIECE_ICONS       || {}),
      window.REMAINS_IMG,
      ...Object.values(window.REMAINS_STAGE_IMGS || {}),  // ★ 유해 단계별 정적 이미지
      ...Object.values(window.REMAINS_HIT_GIFS   || {}),  // ★ 유해 피격 GIF
      window.DRAGON_LANDING_GIF,                          // ★ 드래곤 착지 GIF 프리로드
      window.BOMB_IDLE_GIF,                               // ★ 폭탄 아이들 GIF
      window.BOMB_EXPLODE_GIF,                             // ★ 폭탄 폭발 GIF
      ...Object.values(window.RAT_GIFS?.black  || {}),
      ...Object.values(window.RAT_GIFS?.white  || {}),
      ...Object.values(window.CURSE_GIFS       || {}),    // ★ 저주 상태 GIF
      window.CURSE_MOVE_PNG,                              // ★ 저주 이동 PNG
      ...Object.values(window.MARK_GIFS        || {}),    // ★ 표식/악몽 GIF
    ]);
    const container = _getPreloadContainer();
    for (const url of knownUrls) {
      if (!url) continue;
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'eager';
      container.appendChild(img);
    }

    // 매니페스트 기반 추가 URL (async — 결과를 window._manifestUrls 에 저장)
    fetch('/api/asset-manifest')
      .then(r => r.json())
      .then(({ urls }) => {
        const extra = (urls || []).filter(u =>
          u && !u.startsWith('/art/') && /\.(png|gif|jpg|jpeg|webp)$/i.test(u)
        );
        window._manifestUrls = extra;
        for (const url of extra) {
          const img = document.createElement('img');
          img.src = url; img.loading = 'eager';
          container.appendChild(img);
        }
      })
      .catch(() => {
        // 폴백: 오프라인·서버 미동작 시 기존 목록 사용
        window._manifestUrls = [
          '/fangs-top.png', '/fangs-bottom.png',
          '/가호.png', '/그림자 숨기.png', '/기폭.png', '/덫 설치.png',
          '/드래곤 소환.png', '/배반자.png', '/분신.png', '/사기증진.png',
          '/신성.png', '/쌍검무.png', '/아이언스킨.png', '/악몽.png',
          '/약초학.png', '/역병의 자손들.png', '/유황범람.png',
          '/인스턴트 매직.png', '/저주.png', '/절대복종 반지.png',
          '/정비.png', '/정찰.png', '/질주.png', '/충성.png',
          '/폭정.png', '/폭탈 설치.png', '/표식.png',
        ];
      });
  };

  // DOM 준비 즉시 HTTP 다운로드 선점 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.preloadGameImages);
  } else {
    window.preloadGameImages();
  }

  // ── 완전 프리로드 (로딩 오버레이용) ─────────────────────────────────────
  //
  // 기존 preloadGifDurationsAsync 의 문제:
  //   fetch() → ArrayBuffer 만 채움 → HTTP 캐시 O, 디코드 캐시 X
  //   → 새 <img> 생성 시 HTTP캐시에서 다시 디코드(10~30ms) → 첫 1~2프레임 잘림
  //
  // 이 함수가 하는 일:
  //   ① GIF: fetch + 바이트 파싱 → _gifDurationCache 채움
  //   ② 모든 이미지: img.decode() await → 브라우저 디코드 캐시 채움
  //      → 이후 새 <img src=url> 는 디코드 캐시에서 즉시 첫 프레임 표시
  //   ③ 디코드된 img 를 숨김 컨테이너에 유지 → 캐시 eviction 방지
  //
  // onProgress(0~1) : 진행률 콜백 (선택).
  window.preloadAllAsync = async function (onProgress) {
    if (!window._gifDurationCache) window._gifDurationCache = {};
    if (!window._gifBlobCache) window._gifBlobCache = {};

    // ── 매니페스트 fetch 완료 대기 (최대 2초) ────────────────────────
    if (window._manifestUrls === undefined) {
      await new Promise(resolve => {
        const deadline = Date.now() + 2000;
        const iv = setInterval(() => {
          if (window._manifestUrls !== undefined || Date.now() > deadline) {
            clearInterval(iv); resolve();
          }
        }, 40);
      });
    }

    // ── 전체 URL 목록 ────────────────────────────────────────────────
    // 공격/피격 GIF 우선 (가장 먼저 디코드 캐시에 올려야 할 것들)
    const allUrls = new Set([
      ...Object.values(window.PIECE_ATTACK_GIFS || {}),  // 공격 GIF
      ...Object.values(window.PIECE_HIT_GIFS    || {}),  // 피격 GIF
      ...Object.values(window.PIECE_DEATH_GIFS  || {}),  // 사망 GIF
      ...Object.values(window.PIECE_GIFS        || {}),  // 아이들 GIF
      ...Object.values(window.PIECE_MOVE_PNGS   || {}),  // 이동 PNG
      ...Object.values(window.PIECE_ICONS       || {}),  // 캐릭터 아이콘 PNG
      window.REMAINS_IMG,                                 // 유해 PNG
      ...Object.values(window.REMAINS_STAGE_IMGS || {}),  // ★ 유해 단계별 정적 PNG
      ...Object.values(window.REMAINS_HIT_GIFS   || {}),  // ★ 유해 피격 GIF (1·2·3타)
      window.DRAGON_LANDING_GIF,                          // ★ 드래곤 착지 GIF
      window.BOMB_IDLE_GIF,                               // ★ 폭탄 아이들 GIF
      window.BOMB_EXPLODE_GIF,                             // ★ 폭탄 폭발 GIF
      ...Object.values(window.RAT_GIFS?.black  || {}),   // 쥐 GIF (아군)
      ...Object.values(window.RAT_GIFS?.white  || {}),   // 쥐 GIF (적군)
      ...(window._manifestUrls                 || []),   // 스킬·패시브 PNG
    ]);
    const urls = [...allUrls].filter(Boolean);
    const total = urls.length;
    if (total === 0) { if (onProgress) onProgress(1); return; }

    let done = 0;
    const inc = () => { done++; if (onProgress) onProgress(done / total); };

    const container = _getPreloadContainer();

    await Promise.all(urls.map(async url => {
      // ① GIF 재생 시간 파싱 (바이트 스캔) — HTTP 캐시에서 즉시 서빙됨
      if (url.endsWith('.gif') && window._gifDurationCache[url] === undefined) {
        try {
          const ab = await (await fetch(url, { cache: 'default' })).arrayBuffer();
          const bytes = new Uint8Array(ab);
          let ms = 0;
          for (let i = 0; i < bytes.length - 7; i++) {
            if (bytes[i] === 0x21 && bytes[i+1] === 0xF9 && bytes[i+2] === 0x04) {
              ms += (bytes[i+4] | (bytes[i+5] << 8)) * 10;
              i += 7;
            }
          }
          window._gifDurationCache[url] = ms || 650;
          // ★ GIF Blob 캐시 — animateAttackGif 에서 ObjectURL 로 사용.
          //   Chrome 의 글로벌 GIF 애니메이션 시계를 우회하여 매번 프레임 0부터 재생.
          window._gifBlobCache[url] = new Blob([ab], { type: 'image/gif' });
        } catch (_) { window._gifDurationCache[url] = 650; }
      }

      // ② img.decode() — 브라우저 디코드 캐시에 첫 프레임 적재
      //    이 await 가 완료된 후 생성되는 모든 <img src=url> 는
      //    decode 없이 즉시 첫 프레임을 표시한다 (프레임 잘림 제거).
      try {
        const img = new Image();
        img.src = url;
        container.appendChild(img);   // DOM 유지 → 브라우저가 캐시 evict 안 함
        await img.decode();           // 첫 프레임 디코드 완료까지 대기
      } catch (_) { /* 실패 무시 — 로딩 화면이 막히지 않도록 */ }

      inc();
    }));
  };

  // 하위 호환 별칭 (기존 코드가 preloadGifDurationsAsync 를 직접 호출하는 경우 대비)
  window.preloadGifDurationsAsync = window.preloadAllAsync;
}());
