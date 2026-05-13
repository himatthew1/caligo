// ─────────────────────────────────────────────────────────────────────────────
// CALIGO 체험형 튜토리얼 (v20260514m) — 길 잃은 장군 이야기.
//
//   • 신(scene) 단위 진행. 신 종류:
//       - dialog  : 말풍선 + "➡️" 로 다음. anchor/side 지원.
//       - require : hintMode=true → 힌트바 + 스포트라이트, 클릭 즉시 진행.
//       - animate : 자동 애니메이션 → 끝나면 다음.
//       - enter   : 페이즈 전환.
//       - reveal  : UI 요소 순차 등장.
//   • 새 설계:
//       - 장군이 D4 에서 HP 2/4 로 시작 (길 잃은 상태).
//       - 플레이어가 직접 클릭해 행동 — 힌트 텍스트가 아래에서 안내.
//       - 말풍선은 행동 결과 후 스토리 설명.
//       - 적 turn 은 토스트+로그로 자동 진행.
//       - 후반부 freePlay 모드로 자유 진행.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const ROW_LABELS = ['A', 'B', 'C', 'D', 'E'];
  function coord(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }
  const SCOPE = '#screen-tutorial-interactive';

  // ── 캐릭터 카탈로그 (새 설계) ───────────────────────────────────────────
  const CHARS = {
    spearman:  { type: 'spearman',  icon: '🔱', name: '창병',       tier: 1, atk: 1, baseHp: 5 },
    general:   { type: 'general',   icon: '🎖',  name: '장군',       tier: 2, atk: 2, baseHp: 4 },
    herbalist: { type: 'herbalist', icon: '🌿',  name: '약초전문가', tier: 1, atk: 1, baseHp: 2 },
    commander: { type: 'commander', icon: '📋',  name: '지휘관',     tier: 3, atk: 2, baseHp: 4 },
    princess:  { type: 'princess',  icon: '👸🏼', name: '공주',       tier: 3, atk: 3, baseHp: 3 },
    ratcatcher:{ type: 'ratcatcher',icon: '🐀',  name: '쥐장수',     tier: 2, atk: 1, baseHp: 3 },
    archer:    { type: 'archer',    icon: '🏹',  name: '궁수',       tier: 1, atk: 1, baseHp: 2 },
  };

  // ── 캐릭터 사전 정보 ────────────────────────────────────────────────────
  const CHAR_DICT = {
    spearman:  { desc: '공격 범위: 자신이 위치한 세로열 전체', passiveDesc: '스킬 없음' },
    herbalist: { desc: '스킬 약초학: 주변 아군 HP 회복 (2 SP)', passiveDesc: '공격력: 1' },
    commander: { desc: '패시브: 인접 아군 ATK +1 (사기증진)', passiveDesc: '스킬: 없음' },
    princess:  { desc: '공격 범위: 십자 3칸 (강력)', passiveDesc: '공격력: 3' },
    ratcatcher:{ desc: '스킬: 쥐 소환 — 보드에 쥐 배치해 공격 범위 확장', passiveDesc: '공격력: 1' },
    general:   { desc: '공격 범위: 상하좌우 + 자기 셀 (십자 5칸)', passiveDesc: '공격력: 2' },
    archer:    { desc: '공격 범위: 상하좌우 2칸 (장거리)', passiveDesc: '공격력: 1' },
  };

  // ── 캐릭터 전체 데이터 (서버 CHARACTERS 와 동일 구조, 인게임 사전·스킬팝업·툴팁 재사용용) ──
  const TUT_CHARS_DATA = {
    1: [
      { type:'archer',     name:'궁수',       tier:1, atk:1, icon:'🏹', tag:null,
        skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'공격 범위 반전'}] },
      { type:'spearman',   name:'창병',       tier:1, atk:1, icon:'🔱', tag:'royal',   skills:[] },
      { type:'cavalry',    name:'기마병',     tier:1, atk:1, icon:'🐎', tag:'royal',   skills:[] },
      { type:'watchman',   name:'파수꾼',     tier:1, atk:0.5, icon:'👁', tag:null,    skills:[] },
      { type:'twins',      name:'쌍둥이 강도', tier:1, atk:1, icon:'👫', tag:'villain',
        skills:[{id:'brothers', name:'분신', cost:2, replacesAction:true, desc:'누나가 동생 위치로, 또는 동생이 누나 위치로 합류'}] },
      { type:'scout',      name:'척후병',     tier:1, atk:1, icon:'🔭', tag:'royal',
        skills:[{id:'recon', name:'정찰', cost:2, replacesAction:false, desc:'랜덤 적 1개의 행 또는 열 공개'}] },
      { type:'manhunter',  name:'인간 사냥꾼', tier:1, atk:1, icon:'🪤', tag:'villain',
        skills:[{id:'trap', name:'덫 설치', cost:2, replacesAction:true, desc:'현재 위치에 덫 설치 · 작동 시 2 피해'}] },
      { type:'messenger',  name:'전령',       tier:1, atk:0.5, icon:'📯', tag:null,
        skills:[{id:'sprint', name:'질주', cost:1, replacesAction:false, oncePerTurn:true, desc:'이번 턴 이동 2회 실행'}] },
      { type:'gunpowder',  name:'화약상',     tier:1, atk:1, icon:'💣', tag:null,
        skills:[
          {id:'bomb',     name:'폭탄 설치', cost:2, replacesAction:false,              desc:'주변 8칸 중 한 곳에 폭탄 설치'},
          {id:'detonate', name:'기폭',       cost:0, replacesAction:false, oncePerTurn:true, desc:'설치된 폭탄 전부 폭발 · 1 피해'}
        ] },
      { type:'herbalist',  name:'약초전문가', tier:1, atk:1, icon:'🌿', tag:null,
        skills:[{id:'herb', name:'약초학', cost:2, replacesAction:false, desc:'자신 제외 주변 모든 아군 체력 1 회복'}] },
    ],
    2: [
      { type:'general',         name:'장군',       tier:2, atk:2, icon:'🎖',  tag:'royal',   skills:[] },
      { type:'knight',          name:'기사',       tier:2, atk:2, icon:'🐴',  tag:'royal',   skills:[] },
      { type:'shadowAssassin',  name:'그림자 암살자', tier:2, atk:2, icon:'🗡', tag:'villain',
        skills:[{id:'shadow', name:'그림자 숨기', cost:1, replacesAction:false, oncePerTurn:true, desc:'다음 턴까지 공격과 상태이상에 면역'}] },
      { type:'wizard',          name:'마법사',     tier:2, atk:2, icon:'🧙',  tag:null,      skills:[], passives:['instantMagic'] },
      { type:'armoredWarrior',  name:'갑주무사',   tier:2, atk:2, icon:'🛡',  tag:null,      skills:[], passives:['ironSkin'] },
      { type:'witch',           name:'마녀',       tier:2, atk:1, icon:'🧹',  tag:'villain',
        skills:[{id:'curse', name:'저주', cost:3, replacesAction:true, desc:'적 1명에게 저주 부여'}] },
      { type:'dualBlade',       name:'양손 검객',  tier:2, atk:2, icon:'⚔',  tag:null,
        skills:[{id:'dualStrike', name:'쌍검무', cost:2, replacesAction:false, oncePerTurn:true, desc:'이번 턴 공격 2회 실행'}] },
      { type:'ratMerchant',     name:'쥐 장수',    tier:2, atk:1, icon:'🐀',  tag:'villain',
        skills:[{id:'rats', name:'역병의 자손들', cost:2, replacesAction:false, desc:'쥐가 없는 랜덤 타일 세 곳에 쥐 소환'}] },
      { type:'weaponSmith',     name:'무기상',     tier:2, atk:2, icon:'⚒',  tag:null,
        skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'가로 혹은 세로 공격 범위 전환'}] },
      { type:'bodyguard',       name:'호위 무사',  tier:2, atk:1, icon:'🛡️', tag:'royal',   skills:[], passives:['loyalty'] },
    ],
    3: [
      { type:'prince',        name:'왕자',         tier:3, atk:3, icon:'🤴🏼', tag:'royal',   skills:[] },
      { type:'princess',      name:'공주',         tier:3, atk:3, icon:'👸🏼', tag:'royal',   skills:[] },
      { type:'king',          name:'국왕',         tier:3, atk:2, icon:'🫅🏼', tag:'royal',
        skills:[{id:'ring', name:'절대복종 반지', cost:3, replacesAction:false, desc:'적 유닛 하나의 위치 강제 이동'}] },
      { type:'dragonTamer',   name:'드래곤 조련사', tier:3, atk:2, icon:'🐉', tag:null,
        skills:[{id:'dragon', name:'드래곤 소환', cost:5, replacesAction:false, oncePerTurn:true, desc:'드래곤 유닛 소환'}] },
      { type:'monk',          name:'수도승',       tier:3, atk:1, icon:'🙏',  tag:null,
        skills:[{id:'divine', name:'신성', cost:3, replacesAction:false, desc:'자신 제외 아군 한명 체력을 2 회복하고 상태 이상 제거'}],
        passives:['grace'] },
      { type:'slaughterHero', name:'학살 영웅',    tier:3, atk:1, icon:'🪓',  tag:'villain', skills:[], passives:['betrayer'] },
      { type:'commander',     name:'지휘관',       tier:3, atk:2, icon:'📋',  tag:'royal',   skills:[], passives:['wrath'] },
      { type:'sulfurCauldron',name:'유황이 끓는 솥', tier:3, atk:0.5, icon:'🔥', tag:'royal',
        skills:[{id:'sulfurRiver', name:'유황범람', cost:3, replacesAction:true, desc:'보드 테두리 전체 공격 · 2 피해'}] },
      { type:'torturer',      name:'고문 기술자',  tier:3, atk:1, icon:'⛓',  tag:'villain',
        skills:[{id:'nightmare', name:'악몽', cost:2, replacesAction:false, desc:'표식 상태의 모든 적에게 1 피해'}],
        passives:['markPassive'] },
      { type:'count',         name:'백작',         tier:3, atk:2, icon:'🦇',  tag:'villain', skills:[], passives:['tyranny'] },
    ],
  };

  // ── 런타임 상태 ───────────────────────────────────────────────────────────
  const S = {
    sceneIdx: 0,
    pieces: [],
    turn: 1,
    whose: 'me',
    spMy: 0, spOpp: 0,
    deductionTokens: [],
    logEntries: [],
    _animTimers: [],
    _onClick: null,
    _onClickTarget: null,
    visibleOppIds: new Set(),
    _requirePending: null,
    _postClickDelay: 0,
    drafted: { t1: null, t2: null, t3: null },
    placedCount: 0,
    marks: {},
    selectedPiece: null,
    freePlay: false,
    actionDone: false,
  };
  window.tutorialInteractive = S;

  // ─────────────────────────────────────────────────────────────────────────
  //  시나리오 배열
  // ─────────────────────────────────────────────────────────────────────────
  const SCENARIO = [];

  // === INTRO ===
  // [0] enter intro
  SCENARIO.push({ kind: 'enter', phase: 'intro' });

  // [1] dialog: 인사
  SCENARIO.push({ kind: 'dialog', text: '<p>안녕하세요, 용사님.</p>' });

  // [3] enter game
  SCENARIO.push({ kind: 'enter', phase: 'game' });

  // [4] animate: setupGameState (보드만, 장군 없음) + board spawn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setupGameState();
      const board = document.getElementById('tut-game-board');
      if (board) {
        board.classList.add('tut-board-spawn');
        setTimeout(() => board.classList.remove('tut-board-spawn'), 900);
      }
      updateUI();
      await sleep(400);
    }
  });

  // [5] reveal board (빈 보드)
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} #tut-game-board`] });

  // [NEW] dialog: 세계 소개 (빈 보드 배경으로 표시)
  SCENARIO.push({ kind: 'dialog', text: '<p>여기는 <strong>CALIGO</strong>, 마법의 안개로 뒤덮인 폐허입니다.</p>' });

  // [NEW] animate: 장군 등장 (빈 보드 위에 아이콘이 나타남)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      spawnGeneral();
      await sleep(600);
    }
  });

  // [6] dialog: 장군 발견
  SCENARIO.push({ kind: 'dialog', text: '<p>안개 속에 길 잃은 장군이 보이네요.</p>', anchor: `${SCOPE} #tut-game-board`, side: 'right' });

  // [7] dialog: 도움 요청
  SCENARIO.push({ kind: 'dialog', text: '<p>그가 이곳을 무사히 빠져나갈 수 있게 도와주실 수 있을까요?</p>' });

  // [8] dialog: 상태 확인
  SCENARIO.push({ kind: 'dialog', text: '<p>우선 그의 상태를 살펴봐야겠습니다.</p>' });

  // [9] reveal left-panel
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} .left-panel`] });

  // [NEW] animate: wait for left panel to be visible before dialog
  SCENARIO.push({ kind: 'animate', run: async () => { await sleep(1500); } });

  // [10] dialog: HP 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>HP와 공격력, 위치가 보이는 캐릭터 프로필입니다. 장군이 많이 다쳐 있네요.</p>', anchor: `${SCOPE} .left-panel`, side: 'top' });

  // [11] dialog: 이동 제안
  SCENARIO.push({ kind: 'dialog', text: '<p>아무것도 보이지 않지만 발을 내딛어 이동해봅시다.</p>' });

  // [12] reveal turn-banner
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} #tut-turn-banner`] });

  // [13] animate: setHint + spotlight
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('장군의 아이콘을 눌러 행동하세요');
      setHintActive();
      spotlightCell(3, 3);
      await sleep(200);
    }
  });

  // === TURN 1 — MY MOVE ===

  // [14] require(hintMode): click general at D4
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: () => boardCellSel(3, 3) + ' .piece-marker', side: 'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(3, 3);
      openTutRadial(3, 3, { attackDisabled: true, skillDisabled: true, hideSkill: true });
    }
  });

  // [15] require(hintMode): click 이동 button
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '.radial-btn[data-tut-radial-key="move"]', side: 'right',
    onClick: () => {
      closeTutRadial();
      highlightSingleMove(3, 3, 2, 3);
      setHint('D3으로 이동하세요');
    }
  });

  // [16] require(hintMode): click D3 cell
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: () => boardCellSel(2, 3), side: 'right',
    onClick: () => {}
  });

  // [17] animate: slide D4→D3
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearMoveHighlights();
      clearSpotlights();
      const gen = findPiece('me-general');
      if (gen) await animatePieceSlide(gen, 2, 3, 380);
      addLog('장군 이동', 'move');
      updateUI();
      clearHint();
      await sleep(800);
    }
  });

  // [NEW] dialog: 이동 규칙
  SCENARIO.push({ kind: 'dialog', text: '<p>잘하셨습니다. 이동은 한 턴에 상하좌우 단 한 칸이 원칙입니다.</p>' });

  // [18] animate: opp spearman appears at C3 (hidden)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      await sleep(1000);
      addOppPiece('op-sp', CHARS.spearman, 2, 1, CHARS.spearman.baseHp, CHARS.spearman.baseHp, true);
      S.visibleOppIds.add('op-sp');
      updateUI();
      await sleep(600);
    }
  });

  // [19] reveal right-panel
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} .right-panel`] });

  // [NEW] animate: wait for right panel to be visible before dialog
  SCENARIO.push({ kind: 'animate', run: async () => { await sleep(1500); } });

  // [20] dialog: 인기척
  SCENARIO.push({ kind: 'dialog', text: '<p>잠시만요! 인기척을 느낀 것 같아요.</p>' });

  // [21] dialog: 위치 불명
  SCENARIO.push({ kind: 'dialog', text: '<p>모습은 볼 순 없지만 분명히 이 곳에 있습니다!</p>' });

  // [22] dialog: 프로필 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>상대의 HP와 공격력, 위치가 보이는 프로필입니다. 클릭해서 더 자세한 정보를 볼 수도 있어요.</p>', anchor: `${SCOPE} .opp-piece-card`, side: 'top' });

  // === TURN 2 — OPP TURN (scripted) ===

  // [23] animate: opp turn start
  SCENARIO.push({
    kind: 'animate', run: async () => {
      // 전투 로그 자연스럽게 등장
      const logWrap = document.querySelector(`${SCOPE} .center-log-wrap`);
      if (logWrap && logWrap.classList.contains('tut-hide-init') && !logWrap.classList.contains('tut-revealed')) {
        logWrap.classList.add('tut-revealed');
      }
      S.turn = 2; S.whose = 'opp';
      updateUI();
      addLog('2턴 : 상대 차례', 'system');
      addToast('상대 차례', true);
      await sleep(1000);
    }
  });

  // [24] dialog: 상대 차례
  SCENARIO.push({ kind: 'dialog', text: '<p>상대도 움직이려 합니다!</p>' });

  // [25] animate: 창병 B3→C3 이동 (안개전쟁 — 적 이동 아이콘 숨김, 위치만 갱신)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const sp = findPiece('op-sp');
      if (sp) { sp.col = 2; sp.row = 2; }   // 애니메이션 없이 위치만 갱신 (인게임 opp_moved 처리와 동일)
      if (typeof playSfx === 'function') playSfx('move');
      updateUI();
      addLog('상대가 이동했습니다.', 'move');
      addToast('상대가 이동했습니다.', true);
      await sleep(700);
    }
  });

  // [26] animate: turn 3 start
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.turn = 3; S.whose = 'me';
      S.actionDone = false;
      updateUI();
      if (typeof playTurnBell === 'function') playTurnBell();
      addLog('3턴 : 내 차례', 'system');
      addToast('내 차례');
      await sleep(800);
    }
  });

  // === TURN 3 — MY ATTACK ===

  // [27] dialog: 상대 이동 확인
  SCENARIO.push({ kind: 'dialog', text: '<p>상대가 이동을 했군요.</p>' });

  // [28] dialog: 공격 제안
  SCENARIO.push({ kind: 'dialog', text: '<p>근처에 접근했을 수도 있으니 공격으로 견제해봅시다.</p>' });

  // [29] animate: setHint
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('장군의 아이콘을 눌러 행동하세요');
      updateUI();
      spotlightCell(2, 3);
      await sleep(200);
    }
  });

  // [30] require(hintMode): click general at D3
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: () => boardCellSel(2, 3) + ' .piece-marker', side: 'top',
    onClick: () => {
      S.selectedPiece = findPiece('me-general');
      openTutRadial(2, 3, { moveDisabled: true, skillDisabled: true, hideSkill: true });
    }
  });

  // [31] require(hintMode): click 공격 button
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '.radial-btn[data-tut-radial-key="attack"]', side: 'right',
    onClick: () => {
      closeTutRadial();
      clearSpotlights();
      highlightAttackTargetsAt(2, 3);
      selectAttackTarget(2, 2);
      showAttackConfirmBtn(2, 2);
      setHint('공격 확정 버튼을 누르세요');
    }
  });

  // [32] require(hintMode): click attack confirm button
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-attack-confirm-btn', side: 'top',
    onClick: () => {
      const sp = findPiece('op-sp');
      if (sp) {
        sp.hp = Math.max(0, sp.hp - 2);
        sp.hidden = false;
        S.deductionTokens.push({ col: sp.col, row: sp.row, icon: sp.icon, name: sp.name, pieceKey: sp.id });
      }
      hideAttackConfirmBtn();
      clearMoveHighlights();
      S.actionDone = true;    // 행동 완료 — 버튼 딤 처리
      updateUI();
    }
  });

  // [33] animate: attack + hit
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const sp = findPiece('op-sp');
      if (sp) {
        await animateAttackOnCell(sp.col, sp.row);
        if (typeof playSfx === 'function') playSfx('hit');
        animateBoardPieceHit(sp.col, sp.row);
        flashCard('opp', 'op-sp');
      }
      updateUI();
      addLog(`${sp ? coord(sp.col, sp.row) : 'C3'} 명중`, 'hit');   // 인게임 형식
      await sleep(400);
      clearHint();
      // 행동+턴종료 버튼 등장
      ['tut-btn-action','tut-btn-end-turn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = ''; el.style.animation = 'tut-btn-appear 0.4s ease'; }
      });
      updateUI(); // 버튼 딤 반영 (S.actionDone = true)
    }
  });

  // [NEW] dialog: 추리토큰 설명1 — 추리토큰 포인팅
  SCENARIO.push({ kind: 'dialog', text: '<p>분명 이 곳에서 상대가 공격에 노출됐습니다.</p>', anchor: `${SCOPE} #tut-game-board`, side: 'top' });
  // [NEW] dialog: 추리토큰 설명2
  SCENARIO.push({ kind: 'dialog', text: '<p>추리 토큰을 놓아 위치를 잊어버리지 않도록 합니다.</p>' });

  // [34] dialog: 명중
  SCENARIO.push({ kind: 'dialog', text: '<p>훌륭합니다. 역시 근처에 숨어있었네요.</p>' });

  // [35] dialog: 턴 종료 제안
  SCENARIO.push({ kind: 'dialog', text: '<p>턴을 종료해서 적이 어떻게 움직일지 지켜봅시다.</p>' });

  // [36] reveal action-bar
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} #tut-action-bar`] });

  // [37] animate: setHint + spotlight end turn btn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('턴 종료 버튼을 누르세요');
      const btn = document.getElementById('tut-btn-end-turn');
      if (btn) btn.classList.add('tut-spotlight');
      await sleep(200);
    }
  });

  // [38] require(hintMode): click end turn
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-btn-end-turn', side: 'top',
    onClick: () => {}
  });

  // === TURN 4 — OPP ATTACKS ===

  // [39] animate: turn 4 opp
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearHint();
      clearSpotlights();
      S.turn = 4; S.whose = 'opp';
      updateUI();
      addLog('4턴 : 상대 차례', 'system');
      addToast('상대 차례', true);
      await sleep(800);
    }
  });

  // [40] animate: spearman attacks general
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const gen = findPiece('me-general');
      if (gen) {
        await animateAttackOnCell(gen.col, gen.row);
        animateBoardPieceHit(gen.col, gen.row);
        flashCard('my', 'me-general');
        gen.hp = Math.max(0, gen.hp - 1);
        updateUI();
      }
      addToast('공격받았습니다!', true);
      if (typeof playSfx === 'function') playSfx('hit');
      addLog(`${CHARS.general.icon}장군 피격`, 'hit');   // 인게임 opp_attack_result 형식
      await sleep(1500);
    }
  });

  // [41] animate: turn 5 my turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.turn = 5; S.whose = 'me';
      S.actionDone = false;
      updateUI();
      if (typeof playTurnBell === 'function') playTurnBell();
      addLog('5턴 : 내 차례', 'system');
      addToast('내 차례');
      await sleep(800);
    }
  });

  // [42] dialog: 역공
  SCENARIO.push({ kind: 'dialog', text: '<p>이런, 역공을 당했네요.</p>' });

  // === EXPLANATIONS ===

  // [43] dialog: 공격 범위 중요성
  SCENARIO.push({ kind: 'dialog', text: '<p>상대 말의 공격 범위와 공격력을 파악하는 것은 아주 중요합니다.</p>' });

  // [44] animate: showCharDict spearman
  SCENARIO.push({
    kind: 'animate', run: async () => {
      showCharDict('spearman');
      await sleep(300);
    }
  });

  // [45] dialog: 창병 설명 — 미니 공격범위 그리드 포인팅 (말풍선이 그리드를 가리지 않도록 bottom)
  SCENARIO.push({ kind: 'dialog', text: '<p>창병의 경우 위치한 곳의 세로열 전부를 공격합니다.</p>', anchor: '#dict-slide-mini-headers', side: 'bottom' });

  // [46] dialog: 회피 방법 (dict still open)
  SCENARIO.push({ kind: 'dialog', text: '<p>때문에 창병의 공격을 회피하려면 좌우로 대피하는 것이 안전합니다.</p>' });

  // [47] animate: hideCharDict (moved after dialog)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      hideCharDict();
      await sleep(300);
    }
  });

  // [48a] new: 공격도 이동도 하면 좋겠지만...
  SCENARIO.push({ kind: 'dialog', text: '<p>공격도 하고, 이동도 하면 좋겠지만…</p>' });
  // [48b] original split: 행동 규칙
  SCENARIO.push({ kind: 'dialog', text: '<p>턴 중에는 하나의 캐릭터를 단 한 번만 조작할 수 있습니다. 이를 <strong>행동</strong>이라고 합니다.</p>' });

  // [NEW animate]: 행동 설명 시작 — 장군의 부채꼴 메뉴 자동 펼치기 (이동버튼과 공격버튼 시각적으로 제시)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.selectedPiece = findPiece('me-general');
      openTutRadial(2, 3, { attackDisabled: true, skillDisabled: true, hideSkill: true });
      await sleep(150);
    }
  });

  // [49a] dialog: 행동 종류 (부채꼴 메뉴 펼쳐진 채로 표시)
  SCENARIO.push({ kind: 'dialog', text: '<p><strong>행동</strong>은 이동과 공격, 둘 뿐입니다.</p>' });
  // [49b] dialog: 택일 규칙 (부채꼴 메뉴 유지)
  SCENARIO.push({ kind: 'dialog', text: '<p>이동한 턴엔 공격할 수 없고, 공격한 턴엔 이동할 수 없습니다.</p>' });

  // [50] dialog: 도망 결정 (부채꼴 메뉴 여전히 열려있음 → 이동 버튼 바로 클릭 유도)
  SCENARIO.push({ kind: 'dialog', text: '<p>이대로 공격해도 다시 역공당할 게 뻔하니 도망쳐야겠습니다.</p>' });

  // === TURN 5 — MY MOVE (escape) ===

  // [51] animate: setHint (부채꼴 메뉴 이미 열려있으므로 이동 버튼 바로 안내)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('이동 버튼을 누르세요');
      await sleep(200);
    }
  });

  // [52-removed]: 장군 아이콘 클릭 불필요 — 부채꼴 메뉴 이미 열려있음

  // [53] require(hintMode): click 이동 button (부채꼴 메뉴에서 바로 클릭)
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '.radial-btn[data-tut-radial-key="move"]', side: 'right',
    onClick: () => {
      closeTutRadial();
      clearSpotlights();
      highlightSingleMove(2, 3, 1, 3);
      setHint('D2로 이동하세요');
    }
  });

  // [54] require(hintMode): click D2 cell (col:1,row:3)
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: () => boardCellSel(1, 3), side: 'right',
    onClick: () => {}
  });

  // [55] animate: slide D3→D2 (col:2,row:3 → col:1,row:3)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearMoveHighlights();
      clearSpotlights();
      const gen = findPiece('me-general');
      if (gen) await animatePieceSlide(gen, 1, 3, 380);
      addLog('장군 이동', 'move');
      S.actionDone = true;
      updateUI();
      clearHint();
      await sleep(800);
    }
  });

  // [56] animate: setHint end turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('턴 종료 버튼을 누르세요');
      const btn = document.getElementById('tut-btn-end-turn');
      if (btn) btn.classList.add('tut-spotlight');
      await sleep(200);
    }
  });

  // [57] require(hintMode): click end turn
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-btn-end-turn', side: 'top',
    onClick: () => {}
  });

  // === TURN 6 — OPP (MISS) ===

  // [58] animate: turn 6 opp
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearHint();
      clearSpotlights();
      S.turn = 6; S.whose = 'opp';
      updateUI();
      addLog('6턴 : 상대 차례', 'system');
      addToast('상대 차례', true);
      await sleep(800);
    }
  });

  // [59] animate: spearman misses
  SCENARIO.push({
    kind: 'animate', run: async () => {
      addLog('창병 공격 빗나감', 'miss');      // 인게임 opp_attack_result 형식 (— 없음)
      addToast('창병 공격 빗나감', true);
      await sleep(1500);
    }
  });

  // [60] animate: turn 7 my turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.turn = 7; S.whose = 'me';
      S.actionDone = false;
      updateUI();
      if (typeof playTurnBell === 'function') playTurnBell();
      addLog('7턴 : 내 차례', 'system');
      addToast('내 차례');
      await sleep(800);
    }
  });

  // [61] dialog: 안도
  SCENARIO.push({ kind: 'dialog', text: '<p>휴, 상대의 실수로 살아남았습니다.</p>' });

  // [62] dialog: 동료 필요
  SCENARIO.push({ kind: 'dialog', text: '<p>일단 빈사 상태의 장군을 도울 동료들을 더 불러모아야겠습니다.</p>' });

  // === ALLIES APPEAR ===

  // [63] animate: herbalist + commander appear (C1=col:0,row:2 and C2=col:1,row:2)
  SCENARIO.push({
    kind: 'animate', run: async () => {
      addMyPiece('me-herbalist', CHARS.herbalist, 0, 2, 2, 2);
      popAnimation('me-herbalist');
      updateUI();
      await sleep(1500);
      addMyPiece('me-commander', CHARS.commander, 1, 2, 3, 4);
      popAnimation('me-commander');
      updateUI();
      await sleep(800);
    }
  });

  // [64] dialog: 동료 소개
  SCENARIO.push({ kind: 'dialog', text: '<p>약초전문가와 지휘관입니다!</p>', anchor: `${SCOPE} .left-panel`, side: 'top' });

  // [65] dialog: 특별 능력
  SCENARIO.push({ kind: 'dialog', text: '<p>이 둘은 아주 특별한 능력을 지니고 있습니다.</p>' });

  // [66] animate: showCharDict herbalist
  SCENARIO.push({
    kind: 'animate', run: async () => {
      showCharDict('herbalist');
      await sleep(300);
    }
  });

  // [67] dialog: 약초전문가 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>약초전문가는 다친 전우들을 광역으로 치료할 수 있습니다.</p>', anchor: '#dict-slide-detail-blocks', side: 'left' });

  // [68] animate: hideCharDict → showCharDict commander
  SCENARIO.push({
    kind: 'animate', run: async () => {
      hideCharDict();
      await sleep(500);
      showCharDict('commander');
      await sleep(300);
    }
  });

  // [69] dialog: 지휘관 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>지휘관은 인접한 다른 아군들의 공격력을 상승시킵니다.</p>', anchor: '#dict-slide-detail-blocks', side: 'left' });

  // [70] animate: hideCharDict
  SCENARIO.push({
    kind: 'animate', run: async () => {
      hideCharDict();
      await sleep(300);
    }
  });

  // [71] dialog: 장군 치료 우선
  SCENARIO.push({ kind: 'dialog', text: '<p>장군을 치료하는 게 우선일 것 같습니다.</p>' });

  // [72] dialog: 약초학 소개
  SCENARIO.push({ kind: 'dialog', text: '<p>약초전문가의 스킬 <strong>약초학</strong>을 사용해봅시다.</p>' });

  // [73] dialog: SP 지급
  SCENARIO.push({ kind: 'dialog', text: '<p>SP를 지급해드리겠습니다.</p>' });

  // === SP + SKILL TUTORIAL ===

  // [74] animate: give SP + reveal skill button
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.spMy = 2; S.spOpp = 0;
      updateUI();
      // 스킬 버튼 등장
      const skillBtn = document.getElementById('tut-btn-skill');
      if (skillBtn) { skillBtn.style.display = ''; skillBtn.style.animation = 'tut-btn-appear 0.4s ease'; }
      await sleep(300);
    }
  });

  // [75] reveal sp-section
  SCENARIO.push({ kind: 'reveal', selectors: [`${SCOPE} .sp-section`] });

  // [76] dialog: SP 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>스킬을 사용하기 위한 포인트입니다. 약초학은 2 SP가 필요합니다.</p>', anchor: `${SCOPE} .sp-section`, side: 'top' });

  // [77] animate: showSkillTab + setHint
  SCENARIO.push({
    kind: 'animate', run: async () => {
      showSkillTab('herbalist');
      setHint('시전 버튼을 누르세요');
      await sleep(300);
    }
  });

  // [78] require(hintMode): click skill cast button
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '.cskill-cast-btn', side: 'top',
    onClick: () => {
      hideSkillTab();
      // 약초학: 자신(약초전문가) 제외 주변 8칸 아군 HP +1
      const herb = findPiece('me-herbalist');
      S.pieces.forEach(p => {
        if (p.owner !== 'me' || !p.alive) return;
        if (herb && p.id === herb.id) return; // 자신 제외
        if (herb) {
          const inRange = Math.abs(p.col - herb.col) <= 1 && Math.abs(p.row - herb.row) <= 1;
          if (!inRange) return;
        }
        p.hp = Math.min(p.maxHp, p.hp + 1);
      });
      S.spMy = Math.max(0, S.spMy - 2);
      S.actionDone = true;
      updateUI();
      clearHint();
    }
  });

  // [79] animate: heal animations
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const gen = findPiece('me-general');
      const cmd = findPiece('me-commander');
      if (gen) healFlash(gen.col, gen.row);
      if (cmd) healFlash(cmd.col, cmd.row);
      if (gen) flashCard('my', 'me-general');
      addLog('약초학 시전', 'skill');
      addLog('장군 HP 1→2 (+1 회복)', 'skill');
      addToast('약초학! 아군 HP +1');
      await sleep(1200);
    }
  });

  // [80] dialog: 회복 성공
  SCENARIO.push({ kind: 'dialog', text: '<p>훌륭합니다! 장군이 회복됐습니다.</p>' });

  // [81] animate: setHint end turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('턴 종료 버튼을 누르세요');
      const btn = document.getElementById('tut-btn-end-turn');
      if (btn) btn.classList.add('tut-spotlight');
      await sleep(200);
    }
  });

  // [82] require(hintMode): click end turn
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-btn-end-turn', side: 'top',
    onClick: () => {}
  });

  // === TURN 8 — OPP MOVES ===

  // [83] animate: turn 8 opp
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearHint();
      clearSpotlights();
      S.turn = 8; S.whose = 'opp';
      updateUI();
      addLog('8턴 : 상대 차례', 'system');
      addToast('상대 차례', true);
      await sleep(800);
    }
  });

  // [84] animate: 창병 공격 — 아군이 세로열 이탈하여 빗나감
  SCENARIO.push({
    kind: 'animate', run: async () => {
      // 창병 세로열(col:2) 공격 — 모든 아군이 col:2 이탈, 빗나감
      await sleep(400);
      await animateAttackOnCell(2, 3);
      addLog('창병 공격 빗나감', 'miss');
      addToast('창병 공격 빗나감', true);
      await sleep(800);
    }
  });

  // [85] animate: turn 9 my turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.turn = 9; S.whose = 'me';
      S.actionDone = false;
      updateUI();
      if (typeof playTurnBell === 'function') playTurnBell();
      addLog('9턴 : 내 차례', 'system');
      addToast('내 차례');
      await sleep(800);
    }
  });

  // === TURN 9 — COMMANDER ATTACKS ===

  // [86] dialog: 지휘관 추가 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>지휘관에게도 설명할 게 더 있습니다.</p>' });

  // [87] dialog: 지휘관 공격력
  SCENARIO.push({ kind: 'dialog', text: '<p>지휘관의 공격력은 2입니다. 그리고 지휘관 자신도 인접 아군에게 사기증진 버프를 받습니다.</p>' });

  // [88] dialog: 지휘관 공격 제안
  SCENARIO.push({ kind: 'dialog', text: '<p>지휘관으로 창병을 공격해봅시다.</p>' });

  // [89] animate: setHint
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('지휘관의 아이콘을 눌러 행동하세요');
      spotlightCell(1, 2);
      await sleep(200);
    }
  });

  // [90] require(hintMode): click commander at C2 (col:1,row:2)
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: () => boardCellSel(1, 2) + ' .piece-marker', side: 'top',
    onClick: () => {
      S.selectedPiece = findPiece('me-commander');
      openTutRadial(1, 2, { moveDisabled: true, skillDisabled: true, hideSkill: true });
    }
  });

  // [91] require(hintMode): click 공격 button
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '.radial-btn[data-tut-radial-key="attack"]', side: 'right',
    onClick: () => {
      closeTutRadial();
      clearSpotlights();
      highlightAttackTargetsAt(1, 2);
      selectAttackTarget(2, 2);
      showAttackConfirmBtn(2, 2);
      setHint('공격 확정 버튼을 누르세요');
    }
  });

  // [92] require(hintMode): click attack confirm
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-attack-confirm-btn', side: 'top',
    onClick: () => {
      const sp = findPiece('op-sp');
      if (sp) {
        sp.hp = Math.max(0, sp.hp - 2);
      }
      hideAttackConfirmBtn();
      clearMoveHighlights();
      S.actionDone = true;
      updateUI();
    }
  });

  // [93] animate: attack + hit
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const sp = findPiece('op-sp');
      if (sp) {
        await animateAttackOnCell(sp.col, sp.row);
        if (typeof playSfx === 'function') playSfx('hit');
        animateBoardPieceHit(sp.col, sp.row);
        flashCard('opp', 'op-sp');
        updateUI();
      }
      addLog(`${sp ? coord(sp.col, sp.row) : 'C3'} 명중`, 'hit');   // 인게임 형식
      await sleep(1000);
      clearHint();
    }
  });

  // [94] animate: setHint end turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      setHint('턴 종료 버튼을 누르세요');
      const btn = document.getElementById('tut-btn-end-turn');
      if (btn) btn.classList.add('tut-spotlight');
      await sleep(200);
    }
  });

  // [95] require(hintMode): click end turn
  SCENARIO.push({
    kind: 'require', hintMode: true,
    anchor: '#tut-btn-end-turn', side: 'top',
    onClick: () => {}
  });

  // === TURN 10 — ENEMY PRINCESS APPEARS ===

  // [96] animate: turn 10 opp
  SCENARIO.push({
    kind: 'animate', run: async () => {
      clearHint();
      clearSpotlights();
      S.turn = 10; S.whose = 'opp';
      updateUI();
      addLog('10턴 : 상대 차례', 'system');
      addToast('상대 차례', true);
      await sleep(800);
    }
  });

  // [97] animate: princess appears at A1
  SCENARIO.push({
    kind: 'animate', run: async () => {
      addOppPiece('op-pr', CHARS.princess, 0, 0, CHARS.princess.baseHp, CHARS.princess.baseHp, false);
      S.visibleOppIds.add('op-pr');
      updateUI();
      await sleep(500);
      addLog('공주 등장!', 'system');
      addToast('새 적 등장 — 공주', true);
      await sleep(800);
    }
  });

  // [98] animate: princess kills herbalist
  SCENARIO.push({
    kind: 'animate', run: async () => {
      const herb = findPiece('me-herbalist');
      if (herb) {
        await animateAttackOnCell(herb.col, herb.row);
        animateBoardPieceHit(herb.col, herb.row);
        flashCard('my', 'me-herbalist');
        herb.hp = 0;
        herb.alive = false;
        herb.col = -1; herb.row = -1;
        updateUI();
      }
      addLog(`${CHARS.herbalist.icon}약초전문가 격파`, 'hit');   // 인게임 kill 로그 형식
      await sleep(1500);
    }
  });

  // [99] animate: ratcatcher appears + skill
  SCENARIO.push({
    kind: 'animate', run: async () => {
      addOppPiece('op-rt', CHARS.ratcatcher, 4, 4, CHARS.ratcatcher.baseHp, CHARS.ratcatcher.baseHp, false);
      S.visibleOppIds.add('op-rt');
      updateUI();
      addLog('쥐장수 스킬 발동', 'skill');
      addLog('쥐 소환 — E5 인근', 'skill');
      addToast('쥐장수 등장 + 쥐 소환!', true);
      await sleep(1000);
    }
  });

  // [100] animate: turn 11 my turn
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.turn = 11; S.whose = 'me';
      S.actionDone = false;
      updateUI();
      if (typeof playTurnBell === 'function') playTurnBell();
      addLog('11턴 : 내 차례', 'system');
      addToast('내 차례');
      await sleep(800);
    }
  });

  // [101] dialog: 약초전문가 격파
  SCENARIO.push({ kind: 'dialog', text: '<p>이런! 우리 약초전문가가 쓰러졌습니다.</p>' });

  // [102] dialog: 공주 + 쥐장수 등장
  SCENARIO.push({ kind: 'dialog', text: '<p>그 정체는 공주였군요. 그리고 쥐장수의 스킬까지 발동됐어요.</p>' });

  // [103] dialog: 쥐장수 설명
  SCENARIO.push({ kind: 'dialog', text: '<p>쥐장수는 쥐를 소환해서 공격 범위를 확장합니다.</p>' });

  // === SP 시스템 설명 ===

  // [104] dialog: SP 공유
  SCENARIO.push({ kind: 'dialog', text: '<p>SP는 스킬 포인트입니다. 특이하게도 양측이 함께 공유합니다.</p>' });

  // [105] dialog: SP 지급 주기
  SCENARIO.push({ kind: 'dialog', text: '<p>10턴마다 양측 모두에게 1씩 지급됩니다. 40턴이 되면 각각 최대 5개까지 쌓입니다.</p>' });

  // [106] dialog: 승리 조건
  SCENARIO.push({ kind: 'dialog', text: '<p>서로 3개의 유닛을 기용해 상대 유닛을 전멸시키면 승리입니다.</p>' });

  // [107] dialog: 궁수 지원
  SCENARIO.push({ kind: 'dialog', text: '<p>약초전문가가 사망했으니 — 궁수를 추가로 드리겠습니다.</p>' });

  // [108] animate: archer appears
  SCENARIO.push({
    kind: 'animate', run: async () => {
      addMyPiece('me-archer', CHARS.archer, 0, 4, 2, 2);
      popAnimation('me-archer');
      updateUI();
      addLog('궁수 합류!', 'system');
      addToast('궁수 합류');
      await sleep(800);
    }
  });

  // [109] dialog: 자유 플레이 안내
  SCENARIO.push({ kind: 'dialog', text: '<p>이제부터는 진짜 게임처럼 자유롭게 진행해보세요!</p>' });

  // [110] dialog: 목표
  SCENARIO.push({ kind: 'dialog', text: '<p>남은 적 — 창병(HP 1), 공주(HP 3), 쥐장수(HP 3) — 모두 처치하면 승리입니다.</p>' });

  // === FREE PLAY MODE ===

  // [111] animate: enter free play
  SCENARIO.push({
    kind: 'animate', run: async () => {
      S.freePlay = true;
      setHint('');
      hideBubbleTemporarily();
      enterFreePlay();
      await sleep(300);
    }
  });

  // Victory (reached by enterFreePlay's win detection):
  // [112] dialog: 승리
  SCENARIO.push({ kind: 'dialog', text: '<p>🎉 <strong>승리!</strong> 장군이 폐허에서 무사히 살아남았습니다.</p>' });

  // [113] dialog: 마무리
  SCENARIO.push({ kind: 'dialog', text: '<p>CALIGO의 제왕으로 거듭나세요.</p>' });

  // [114] animate: exit
  SCENARIO.push({
    kind: 'animate', run: async () => {
      await sleep(1000);
      exitTutorial();
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  엔진 로직
  // ═════════════════════════════════════════════════════════════════════════

  // ── 게임 상태 초기화 ────────────────────────────────────────────────────
  function spawnGeneral() {
    if (S.pieces.find(p => p.id === 'me-general')) return; // 이미 존재
    S.pieces.push({
      id: 'me-general', owner: 'me', char: CHARS.general,
      icon: CHARS.general.icon, name: CHARS.general.name, tier: CHARS.general.tier, atk: CHARS.general.atk,
      col: 3, row: 3, hp: 2, maxHp: CHARS.general.baseHp, alive: true, hidden: false,
    });
    updateUI();
    popAnimation('me-general');
  }

  function setupGameState() {
    S.pieces = []; // 장군은 spawnGeneral() 에서 별도 등장
    S.turn = 1; S.whose = 'me';
    S.spMy = 0; S.spOpp = 0;
    S.deductionTokens = [];
    S.logEntries = [];
    S.visibleOppIds = new Set();
    S.selectedPiece = null;
    S.freePlay = false;
    S.actionDone = false;

    // 버튼 초기 숨김 (지정 타이밍에 순차 등장)
    ['tut-btn-action','tut-btn-skill','tut-btn-end-turn','tut-btn-surrender'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // 피스 마커 호버 툴팁 CSS (piece-tooltip 클래스 재사용)
    if (!document.getElementById('tut-tooltip-hover-css')) {
      const tooltipStyle = document.createElement('style');
      tooltipStyle.id = 'tut-tooltip-hover-css';
      tooltipStyle.textContent = `
        #tut-game-board .piece-marker { position: relative; }
        #tut-game-board .piece-marker:hover .piece-tooltip { display: block; }
      `;
      document.head.appendChild(tooltipStyle);
    }

    // tut-btn-appear 키프레임 주입 (중복 방지)
    if (!document.getElementById('tut-btn-appear-keyframes')) {
      const style = document.createElement('style');
      style.id = 'tut-btn-appear-keyframes';
      style.textContent = `
        @keyframes tut-btn-appear {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    // 행동 버튼 — 이미 행동한 경우 행동불가 스티커 표시 (인게임 action-floating-btn 재사용)
    const actionBtn = document.getElementById('tut-btn-action');
    if (actionBtn && !actionBtn._tutActed) {
      actionBtn._tutActed = true; // 중복 핸들러 방지
      actionBtn.addEventListener('click', () => {
        if (!S.actionDone || S.whose !== 'me' || S.freePlay) return;
        const board = document.getElementById('tut-game-board');
        if (!board) return;
        // 이미 행동불가 스티커 있으면 무시
        if (board.querySelector('.action-floating-btn.unable')) return;
        // 현재 내 피스 중 살아있는 것 (우선순위: 지휘관>장군>기타)
        const pc = S.pieces.find(p => p.alive && p.owner === 'me' && p.id === 'me-commander')
                || S.pieces.find(p => p.alive && p.owner === 'me' && p.id === 'me-general')
                || S.pieces.find(p => p.alive && p.owner === 'me');
        if (!pc) return;
        const cellEl = board.querySelector(`.cell[data-col="${pc.col}"][data-row="${pc.row}"]`);
        if (!cellEl) return;
        const btn = document.createElement('div');
        btn.className = 'action-floating-btn unable';
        btn.textContent = '행동불가';
        btn.style.left = (cellEl.offsetLeft + cellEl.offsetWidth / 2) + 'px';
        btn.style.top = cellEl.offsetTop + 'px';
        board.appendChild(btn);
        setTimeout(() => btn.remove(), 1500);
      });
    }
  }

  // ── 피스 추가 헬퍼 ────────────────────────────────────────────────────
  function addMyPiece(id, charObj, col, row, hp, maxHp) {
    const pc = {
      id, owner: 'me', char: charObj,
      type: charObj.type,
      icon: charObj.icon, name: charObj.name, tier: charObj.tier, atk: charObj.atk,
      col, row, hp: hp || charObj.baseHp, maxHp: maxHp || hp || charObj.baseHp,
      alive: true, hidden: false, statusEffects: [],
    };
    S.pieces.push(pc);
    updateUI();
    return pc;
  }

  function addOppPiece(id, charObj, col, row, hp, maxHp, hidden) {
    const pc = {
      id, owner: 'opp', char: charObj,
      type: charObj.type,
      icon: charObj.icon, name: charObj.name, tier: charObj.tier, atk: charObj.atk,
      col, row, hp: hp || charObj.baseHp, maxHp: maxHp || hp || charObj.baseHp,
      alive: true, hidden: !!hidden, statusEffects: [],
    };
    S.pieces.push(pc);
    updateUI();
    return pc;
  }

  // ── 팝 애니메이션 ─────────────────────────────────────────────────────
  function popAnimation(pieceId) {
    const pc = findPiece(pieceId);
    if (!pc) return;
    const cell = document.querySelector(boardCellSel(pc.col, pc.row));
    if (!cell) return;
    const marker = cell.querySelector('.piece-marker');
    if (marker) {
      marker.classList.add('tut-piece-spawn');
      setTimeout(() => marker.classList.remove('tut-piece-spawn'), 900);
    }
  }

  // ── 힐 플래시 ────────────────────────────────────────────────────────
  function healFlash(col, row) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (!cell) return;
    cell.classList.add('tut-heal-flash');
    setTimeout(() => cell.classList.remove('tut-heal-flash'), 800);
  }

  // ── 적 마커 잠시 표시 후 페이드아웃 ─────────────────────────────────
  async function showThenFade(col, row, delayMs = 800, fadeMs = 1500) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (!cell) return;
    const markers = cell.querySelectorAll('.piece-marker.opp-piece');
    markers.forEach(m => { m.style.transition = `opacity ${fadeMs}ms ease`; m.style.opacity = '1'; });
    await sleep(delayMs);
    markers.forEach(m => { m.style.opacity = '0'; });
    await sleep(fadeMs);
    markers.forEach(m => { m.style.transition = ''; m.style.opacity = ''; });
  }

  // ── 찾기 헬퍼 ────────────────────────────────────────────────────────
  function findPiece(id) { return S.pieces.find(p => p.id === id); }
  function findMyPiece(col, row) {
    return S.pieces.find(p => p.owner === 'me' && p.col === col && p.row === row && p.alive);
  }
  function boardCellSel(col, row) {
    return `${SCOPE} #tut-game-board .cell[data-col="${col}"][data-row="${row}"]`;
  }

  // ── 힌트 바 — 인게임 .action-hint 엘리먼트 직접 사용 ──────────────────
  function setHint(text) {
    // body 에 남아있을 수 있는 구형 tut-hint-bar 제거
    document.getElementById('tut-hint-bar')?.remove();
    const el = document.querySelector(`${SCOPE} .action-hint`);
    if (el) {
      el.textContent = text || '';
      el.classList.toggle('urgent', !!text);
    }
  }
  function clearHint() { setHint(''); }
  function setHintActive() { /* action-hint 는 레이아웃 안에 있어 별도 활성화 불필요 */ }

  // ── 스포트라이트 ────────────────────────────────────────────────────────
  function spotlightCell(col, row) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (cell) cell.classList.add('tut-spotlight');
  }

  // ── 튜토리얼 피스 → 인게임 피스 형태 변환 (buildPieceTooltip 재사용용) ─────
  function buildTutPieceLike(pc) {
    const charType = pc.type || (pc.char && pc.char.type) || '';
    let charData = null;
    for (const tier of [1, 2, 3]) {
      const arr = TUT_CHARS_DATA[tier] || [];
      charData = arr.find(c => c.type === charType);
      if (charData) break;
    }
    return Object.assign({}, pc, {
      type: charType,
      skills:        charData ? (charData.skills   || []) : [],
      passives:      charData ? (charData.passives  || []) : [],
      statusEffects: pc.statusEffects || [],
    });
  }

  // ── 캐릭터 사전 오버레이 (인게임 #char-dict-overlay 재사용) ──────────────
  function showCharDict(charType) {
    hideCharDict();
    // 인게임 #char-dict-overlay 그대로 사용
    // game.js 의 S 는 const 이므로 window.S 로 접근 불가 — 전용 setter 사용
    if (typeof window.setSpecCharactersForTutorial === 'function') {
      window.setSpecCharactersForTutorial(TUT_CHARS_DATA);
    }
    if (typeof window.openCharDictAt === 'function') {
      window.openCharDictAt(charType);
    }
  }

  function hideCharDict() {
    const ov = document.getElementById('char-dict-overlay');
    if (ov) { ov.classList.add('hidden'); ov.setAttribute('aria-hidden', 'true'); }
  }

  // ── 공격 확정 버튼 ───────────────────────────────────────────────────
  let _attackTargetCol = -1, _attackTargetRow = -1;

  function showAttackConfirmBtn(col, row) {
    hideAttackConfirmBtn();
    _attackTargetCol = col; _attackTargetRow = row;
    const board = document.getElementById('tut-game-board');
    const cellEl = document.querySelector(boardCellSel(col, row));
    if (!board || !cellEl) return;
    const btn = document.createElement('button');
    btn.id = 'tut-attack-confirm-btn';
    btn.type = 'button';
    // 인게임 attack-confirm-btn 클래스 그대로 사용 (CSS 포함)
    btn.className = 'attack-confirm-btn';
    btn.innerHTML = '<span class="lbl">공격 확정</span>';
    // position: absolute 기준은 #tut-game-board (position: relative)
    btn.style.left = (cellEl.offsetLeft + cellEl.offsetWidth / 2) + 'px';
    btn.style.top  = cellEl.offsetTop + 'px';
    board.appendChild(btn);
  }

  function hideAttackConfirmBtn() {
    // board 내 또는 document 어디에나 있을 수 있음 (위치 호환성)
    document.querySelectorAll('#tut-attack-confirm-btn').forEach(b => b.remove());
    _attackTargetCol = -1; _attackTargetRow = -1;
  }

  // ── 스킬 팝업 (인게임 char-skill-popup 재사용) ──────────────────────────
  function showSkillTab(charType) {
    hideSkillTab();
    if (typeof window.openCharSkillPopup !== 'function') return;

    // TUT_CHARS_DATA 에서 캐릭터 데이터 조회
    let charData = null;
    for (const tier of [1, 2, 3]) {
      charData = (TUT_CHARS_DATA[tier] || []).find(c => c.type === charType);
      if (charData) break;
    }
    if (!charData || !charData.skills || charData.skills.length === 0) return;

    // 튜토리얼 피스 찾기 (위치 정보용)
    const tutPc = S.pieces.find(p => p.alive && p.owner === 'me' && p.type === charType);

    // 인게임 S.myPieces / sp / actionDone 임시 주입 (game.js setter 사용)
    const pieceLike = Object.assign({}, charData, {
      alive: true,
      col:   tutPc ? tutPc.col : 0,
      row:   tutPc ? tutPc.row : 0,
      hp:    tutPc ? tutPc.hp  : 1,
      maxHp: tutPc ? tutPc.maxHp : 2,
      statusEffects: [],
    });
    if (typeof window.setMyPiecesForTutorial === 'function') {
      window.setMyPiecesForTutorial([pieceLike], { 0: 99 }, false);
    }

    // 스킬 버튼 앵커 위치
    const skillBtn = document.getElementById('tut-btn-skill');
    const anchorRect = skillBtn ? skillBtn.getBoundingClientRect() : null;

    window.openCharSkillPopup(0, anchorRect);

    // 원본 복원
    if (typeof window.restoreMyPiecesAfterTutorial === 'function') {
      window.restoreMyPiecesAfterTutorial(null, null, false);
    }

    // 팝업에 튜토리얼 소유 마킹 (hideSkillTab 에서 식별)
    const popup = document.getElementById('char-skill-popup');
    if (popup) popup.dataset.tutOwned = '1';
  }

  function hideSkillTab() {
    const popup = document.getElementById('char-skill-popup');
    if (popup && popup.dataset.tutOwned) popup.remove();
  }

  // ── 토스트 알림 — 인게임 showSkillToast 위임 ─────────────────────────
  function addToast(text, isEnemy = false) {
    if (typeof showSkillToast === 'function') {
      showSkillToast(text, isEnemy, undefined, 'event');
    }
  }

  // ── 이동 타깃 하이라이트 ──────────────────────────────────────────────
  function highlightMoveTargets(col, row) {
    const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dc, dr] of deltas) {
      const c = col + dc, r = row + dr;
      if (c < 0 || c > 4 || r < 0 || r > 4) continue;
      const occupied = S.pieces.find(p => p.alive && p.col === c && p.row === r);
      if (occupied) continue;
      const cell = document.querySelector(boardCellSel(c, r));
      if (cell) cell.classList.add('tut-move-target');
    }
  }

  function highlightSingleMove(fromCol, fromRow, toCol, toRow) {
    clearMoveHighlights();
    const cell = document.querySelector(boardCellSel(toCol, toRow));
    if (cell) cell.classList.add('tut-move-target');
  }

  function highlightAttackTargetsAt(col, row) {
    // general + commander: cross 5 cells
    const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dc, dr] of offsets) {
      const c = col + dc, r = row + dr;
      if (c < 0 || c > 4 || r < 0 || r > 4) continue;
      const cell = document.querySelector(boardCellSel(c, r));
      if (cell) cell.classList.add('tut-attack-target');
    }
  }

  function selectAttackTarget(col, row) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (cell) cell.classList.add('tut-attack-selected');
  }

  function clearMoveHighlights() {
    document.querySelectorAll(
      `${SCOPE} .cell.tut-move-target, ${SCOPE} .cell.tut-attack-target, ${SCOPE} .cell.tut-attack-selected`
    ).forEach(c => c.classList.remove('tut-move-target', 'tut-attack-target', 'tut-attack-selected'));
  }

  // ── 로그 ─────────────────────────────────────────────────────────────────
  function addLog(msg, type = 'system') {
    S.logEntries.push({ text: msg, type });
    const logEl = document.getElementById('tut-game-log');
    if (!logEl) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const formatted = (typeof formatMsgMiniHeader === 'function') ? formatMsgMiniHeader(msg) : msg;
    entry.innerHTML = `<span class="turn-num">T${S.turn}</span> ${formatted}`;
    logEl.prepend(entry);
    while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
  }

  // ── UI 렌더 ──────────────────────────────────────────────────────────────
  function updateUI() {
    renderBoard();
    renderCards();
    // 인게임과 동일: opp 차례일 때 body.opp-turn → CSS 보드글로우·버튼딤 처리
    const isMyTurn = S.whose === 'me';
    document.body.classList.toggle('opp-turn', !isMyTurn);

    // 인게임 setTurnBackground 와 동일한 보드 테두리 글로우
    const tutBoard = document.getElementById('tut-game-board');
    if (tutBoard) {
      tutBoard.style.transition = 'border-color 0.5s, box-shadow 0.5s';
      tutBoard.style.borderColor  = isMyTurn ? '#3b82f6' : '#ef4444';
      tutBoard.style.borderWidth  = '2px';
      tutBoard.style.boxShadow    = isMyTurn
        ? '0 0 14px rgba(59,130,246,0.28), inset 0 0 8px rgba(59,130,246,0.05)'
        : '0 0 14px rgba(239,68,68,0.28),  inset 0 0 8px rgba(239,68,68,0.05)';
    }

    // 인게임 turn-active 클래스 — 패널 카드 강조/딤 처리
    const leftPanel  = document.querySelector(`${SCOPE} .left-panel`);
    const rightPanel = document.querySelector(`${SCOPE} .right-panel`);
    if (leftPanel)  leftPanel.classList.toggle('turn-active',  isMyTurn);
    if (rightPanel) rightPanel.classList.toggle('turn-active', !isMyTurn);

    const banner = document.getElementById('tut-turn-banner');
    if (banner) {
      banner.textContent = `${S.turn}턴 : ${isMyTurn ? '내 차례' : '상대 차례'}`;
      banner.classList.toggle('opp-turn', !isMyTurn);
    }
    const smy = document.getElementById('tut-sp-my-num'); if (smy) smy.textContent = S.spMy;
    const sop = document.getElementById('tut-sp-opp-num'); if (sop) sop.textContent = S.spOpp;
    const fmy = document.getElementById('tut-sp-my-fill');
    const fop = document.getElementById('tut-sp-opp-fill');
    if (fmy && fop) {
      const total = (S.spMy + S.spOpp) || 1;
      fmy.style.width = `${(S.spMy / total) * 100}%`;
      fop.style.width = `${(S.spOpp / total) * 100}%`;
    }
    const cd = document.querySelector(`${SCOPE} .sp-countdown`);
    if (cd) {
      if (S.turn >= 40) cd.textContent = 'SP 지급 종료';
      else {
        const left = 10 - (S.turn % 10 || 10);
        cd.textContent = `다음 SP 지급까지 ${left === 0 ? 10 : left}턴`;
      }
    }
    // 행동 버튼 딤 — 이미 행동했으면 인게임처럼 흐릿하게
    const actBtn = document.getElementById('tut-btn-action');
    if (actBtn) {
      const acted = S.actionDone && S.whose === 'me';
      actBtn.style.opacity = acted ? '0.38' : '';
      actBtn.style.filter  = acted ? 'grayscale(0.5) brightness(0.7)' : '';
    }

    // Free play: update end-turn button state
    if (S.freePlay) {
      const endBtn = document.getElementById('tut-btn-end-turn');
      if (endBtn) {
        endBtn.disabled = S.whose === 'opp';
      }
    }
  }

  function renderBoard() {
    const board = document.getElementById('tut-game-board');
    if (!board) return;
    board.innerHTML = '';
    const commanderPc = S.pieces.find(p => p.alive && p.owner === 'me' && p.char && p.char.type === 'commander');
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.col = c; cell.dataset.row = r;
        const lbl = document.createElement('span');
        lbl.className = 'coord-label';
        lbl.textContent = coord(c, r);
        cell.appendChild(lbl);
        // 사기증진 morale-zone
        if (commanderPc) {
          const dc = c - commanderPc.col;
          const dr = r - commanderPc.row;
          if (dc === 0 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-zone-center');
          } else if (dc === 0 && dr === -1) {
            cell.classList.add('morale-zone', 'morale-from-s');
          } else if (dc === 0 && dr === 1) {
            cell.classList.add('morale-zone', 'morale-from-n');
          } else if (dc === -1 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-from-e');
          } else if (dc === 1 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-from-w');
          }
        }
        // piece
        const pc = S.pieces.find(p => p.alive && p.col === c && p.row === r && p.owner === 'me');
        if (pc) {
          const marker = document.createElement('div');
          marker.className = 'piece-marker' + (pc.owner === 'opp' ? ' opp-piece' : '');
          if (commanderPc && pc.owner === 'me' && pc !== commanderPc && cell.classList.contains('morale-zone') && !cell.classList.contains('morale-zone-center')) {
            marker.classList.add('morale-buffed');
          }
          marker.innerHTML = `<span class="p-icon">${pc.icon}</span><span class="p-hp">${pc.hp}/${pc.maxHp}</span>`;
          // 호버 툴팁 — 인게임 buildPieceTooltip() 재사용
          if (typeof buildPieceTooltip === 'function') {
            try {
              const pieceLike = buildTutPieceLike(pc);
              const tipSide = c <= 1 ? 'right' : 'left';
              const tip = buildPieceTooltip(pieceLike, tipSide);
              marker.appendChild(tip);
            } catch (e) { /* tooltip 오류 무시 */ }
          }
          cell.classList.add('has-piece');
          cell.appendChild(marker);
          // morale particles
          if (commanderPc && cell.classList.contains('morale-zone') && !cell.classList.contains('morale-zone-center') && pc.owner === 'me') {
            const sparkleChars = ['✦', '✧', '✦', '✨', '✧'];
            for (let i = 0; i < 5; i++) {
              const sp = document.createElement('span');
              sp.className = 'morale-particle';
              sp.textContent = sparkleChars[i % sparkleChars.length];
              sp.style.left = (5 + Math.random() * 90) + '%';
              sp.style.top = (15 + Math.random() * 70) + '%';
              const dx = (Math.random() - 0.5) * 18;
              const dy = -(18 + Math.random() * 18);
              const rot = (Math.random() - 0.5) * 320;
              sp.style.setProperty('--dx', dx + 'px');
              sp.style.setProperty('--dy', dy + 'px');
              sp.style.setProperty('--rot', rot + 'deg');
              sp.style.setProperty('--size', (0.45 + Math.random() * 0.3) + 'rem');
              const dur = 1.4 + Math.random() * 1.0;
              sp.style.setProperty('--dur', dur + 's');
              sp.style.setProperty('--delay', (-Math.random() * dur) + 's');
              cell.appendChild(sp);
            }
          }
        }
        // 추리 토큰
        const token = (S.deductionTokens || []).find(t => t.col === c && t.row === r);
        if (token) {
          const tk = document.createElement('span');
          tk.className = 'deduction-token';
          tk.textContent = token.icon;
          tk.title = `추리: ${token.name}`;
          cell.appendChild(tk);
        }
        board.appendChild(cell);
      }
    }
    // free play: attach cell click handlers
    if (S.freePlay && S.whose === 'me') {
      attachFreePlayBoardHandlers();
    }
  }

  function renderCards() {
    const myCont = document.getElementById('tut-my-pieces-info');
    if (myCont) {
      const my = S.pieces.filter(p => p.owner === 'me');
      myCont.innerHTML = my.map(buildMyCardHTML).join('');
    }
    const oppCont = document.getElementById('tut-opp-pieces-info');
    if (oppCont) {
      const opp = S.pieces.filter(p => p.owner === 'opp' && S.visibleOppIds.has(p.id));
      oppCont.innerHTML = opp.length ? opp.map(buildOppCardHTML).join('') : '<div class="tut-opp-empty">— 아직 적이 나타나지 않음 —</div>';
    }
  }

  function buildMyCardHTML(pc) {
    const hpPct = pc.alive ? (pc.hp / pc.maxHp) * 100 : 0;
    const deadCls = pc.alive ? '' : ' card-dead';
    return `
      <div class="my-piece-card${deadCls}" data-my-id="${pc.id}">
        <div class="my-piece-header">
          <span class="p-icon">${pc.icon}</span>
          <strong>${pc.name}</strong>
          <span class="tier-badge">${pc.tier}T</span>
        </div>
        <div class="hp-bar-bg hp-bar-with-text">
          <div class="hp-bar" style="width:${hpPct}%"></div>
          <span class="hp-bar-text">${pc.alive ? pc.hp : 0}/${pc.maxHp}</span>
        </div>
        <div class="piece-stat-row">
          <span class="piece-stat-atk"><span class="stat-label">ATK</span> ${pc.atk}</span>
          <span class="my-piece-pos">${pc.alive ? coord(pc.col, pc.row) : '격파됨'}</span>
        </div>
      </div>`;
  }

  function buildOppCardHTML(pc) {
    const hpPct = pc.alive ? (pc.hp / pc.maxHp) * 100 : 0;
    const deadCls = pc.alive ? '' : ' card-dead';
    const token = (S.deductionTokens || []).find(t => t.pieceKey === pc.id);
    let badgeHTML = '';
    if (token) badgeHTML = `<span class="deduction-badge">📌${coord(token.col, token.row)}</span>`;
    const posLabel = !pc.alive ? '격파됨' : (pc.hidden ? '🌫 위치 불명' : coord(pc.col, pc.row));
    return `
      <div class="opp-piece-card${deadCls}" data-opp-id="${pc.id}">
        <div class="my-piece-header">
          <span class="p-icon">${pc.icon}</span>
          <strong>${pc.name}</strong>
          <span class="tier-badge">${pc.tier}T</span>${badgeHTML}
        </div>
        <div class="hp-bar-bg hp-bar-with-text">
          <div class="hp-bar" style="width:${hpPct}%"></div>
          <span class="hp-bar-text">${pc.alive ? pc.hp : 0}/${pc.maxHp}</span>
        </div>
        <div class="piece-stat-row">
          <span class="piece-stat-atk"><span class="stat-label">ATK</span> ${pc.atk}</span>
          <span class="my-piece-pos">${posLabel}</span>
        </div>
      </div>`;
  }

  // ── 애니메이션 헬퍼 ──────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function animatePieceSlide(piece, toCol, toRow, dur) {
    if (!piece) return;
    const fromSel = boardCellSel(piece.col, piece.row);
    const toSel = boardCellSel(toCol, toRow);
    const fromCell = document.querySelector(fromSel);
    const toCell = document.querySelector(toSel);
    if (!fromCell || !toCell) {
      piece.col = toCol; piece.row = toRow;
      updateUI(); return;
    }
    const fr = fromCell.getBoundingClientRect();
    const tr = toCell.getBoundingClientRect();
    const sprite = document.createElement('div');
    sprite.textContent = piece.icon;
    sprite.style.cssText = `
      position:fixed; z-index:5000; font-size:1.7rem; pointer-events:none;
      left:${fr.left + fr.width / 2}px; top:${fr.top + fr.height / 2}px;
      transform:translate(-50%,-50%);
      transition: left ${dur}ms cubic-bezier(0.4,0,0.2,1), top ${dur}ms cubic-bezier(0.4,0,0.2,1);
      filter: drop-shadow(0 0 8px rgba(82,183,136,0.85));`;
    document.body.appendChild(sprite);
    const origMarker = fromCell.querySelector('.piece-marker');
    if (origMarker) origMarker.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      sprite.style.left = `${tr.left + tr.width / 2}px`;
      sprite.style.top = `${tr.top + tr.height / 2}px`;
    });
    await sleep(dur + 50);
    sprite.remove();
    piece.col = toCol; piece.row = toRow;
    updateUI();
  }

  async function animateAttackOnCell(col, row) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (!cell) return;
    cell.classList.add('tut-attack-flash');
    setTimeout(() => cell.classList.remove('tut-attack-flash'), 600);
    await sleep(400);
  }

  function animateBoardPieceHit(col, row) {
    const cell = document.querySelector(boardCellSel(col, row));
    if (!cell) return;
    const icon = cell.querySelector('.piece-marker .p-icon');
    if (icon) {
      icon.classList.remove('tut-p-icon-hit');
      void icon.offsetWidth;
      icon.classList.add('tut-p-icon-hit');
      setTimeout(() => icon.classList.remove('tut-p-icon-hit'), 700);
    }
  }

  function flashCard(side, pieceId) {
    const sel = side === 'my'
      ? `${SCOPE} .my-piece-card[data-my-id="${pieceId}"]`
      : `${SCOPE} .opp-piece-card[data-opp-id="${pieceId}"]`;
    const card = document.querySelector(sel);
    if (!card) return;
    card.classList.remove('tut-card-hit');
    void card.offsetWidth;
    card.classList.add('tut-card-hit');
    setTimeout(() => card.classList.remove('tut-card-hit'), 800);
  }

  // ── 부채꼴 메뉴 ──────────────────────────────────────────────────────────
  function openTutRadial(col, row, opts) {
    closeTutRadial();
    const cellEl = document.querySelector(boardCellSel(col, row));
    if (!cellEl) return;
    cellEl.classList.add('radial-active');
    document.body.classList.add('radial-mode-active');
    const r = cellEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = 68;
    const menu = document.createElement('div');
    menu.id = 'tut-radial-menu';
    menu.className = 'radial-action-menu';
    menu.style.position = 'fixed';
    menu.style.inset = '0';
    menu.style.zIndex = '9200';
    menu.style.pointerEvents = 'none';

    opts = opts || {};
    const items = [
      { angle: -135, key: 'move',   icon: '🏃', label: '이동', disabled: !!opts.moveDisabled },
      { angle: -90,  key: 'attack', icon: '⚔',  label: '공격', disabled: !!opts.attackDisabled },
      { angle: -45,  key: 'skill',  icon: '✨',  label: '스킬', disabled: !!opts.skillDisabled, hideIfMissing: !!opts.hideSkill },
    ].filter(it => !it.hideIfMissing);

    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'radial-btn';
      btn.dataset.key = it.key;
      btn.dataset.tutRadialKey = it.key;
      btn.innerHTML = `<span class="ic">${it.icon}</span><span class="lbl">${it.label}</span>`;
      const rad = it.angle * Math.PI / 180;
      const x = cx + Math.cos(rad) * radius;
      const y = cy + Math.sin(rad) * radius;
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      if (it.disabled) btn.disabled = true;
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
  }

  function closeTutRadial() {
    document.getElementById('tut-radial-menu')?.remove();
    document.body.classList.remove('radial-mode-active');
    document.querySelectorAll(`${SCOPE} .cell.radial-active`).forEach(c => c.classList.remove('radial-active'));
  }

  // ── reveal ─────────────────────────────────────────────────────────────
  const REVEAL_TARGETS = [
    `${SCOPE} .sp-section`,
    `${SCOPE} .left-panel`,
    `${SCOPE} .right-panel`,
    `${SCOPE} #tut-turn-banner`,
    `${SCOPE} #tut-game-board`,
    `${SCOPE} #tut-action-bar`,
    `${SCOPE} .center-log-wrap`,
  ];

  function initHideAll() {
    REVEAL_TARGETS.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) { el.classList.add('tut-hide-init'); el.classList.remove('tut-revealed'); }
    });
  }

  function revealEl(sel) {
    const el = document.querySelector(sel);
    if (el) el.classList.add('tut-revealed');
  }

  function revealAll() {
    REVEAL_TARGETS.forEach(revealEl);
  }

  // ── phase 컨테이너 ───────────────────────────────────────────────────────
  function renderPhase(phase) {
    const cont = document.getElementById('tut-phase-container');
    const gameLayout = document.querySelector(`${SCOPE} .game-layout`);
    if (!cont) return;
    cont.innerHTML = '';
    cont.classList.remove('active');
    if (phase === 'game') {
      if (gameLayout) gameLayout.style.display = '';
      return;
    }
    if (gameLayout) gameLayout.style.display = 'none';
    if (phase === 'intro') return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  FREE PLAY 모드
  // ─────────────────────────────────────────────────────────────────────────
  let _freePlaySelectedPiece = null;
  let _freePlayPhase = 'none'; // 'none' | 'move-targets' | 'attack-targets'
  let _freePlayPieceActed = new Set(); // ids of pieces that acted this turn

  function enterFreePlay() {
    _freePlaySelectedPiece = null;
    _freePlayPhase = 'none';
    _freePlayPieceActed = new Set();
    // Reveal everything
    revealAll();
    updateUI();
    setHint('자유롭게 행동하세요! (말 클릭 → 이동/공격)');
    // Wire end turn button
    const endBtn = document.getElementById('tut-btn-end-turn');
    if (endBtn) {
      endBtn.style.display = '';
      endBtn.onclick = freePlayEndTurn;
      endBtn.disabled = false;
    }
    // 기권 버튼 등장
    const surrenderBtn = document.getElementById('tut-btn-surrender');
    if (surrenderBtn) { surrenderBtn.style.display = ''; }
    addLog('자유 플레이 시작!', 'system');
    addToast('자유 플레이 — 직접 해보세요!');
  }

  function attachFreePlayBoardHandlers() {
    const board = document.getElementById('tut-game-board');
    if (!board) return;
    board.querySelectorAll('.cell').forEach(cell => {
      cell.addEventListener('click', freePlayCellClick, { once: false });
    });
  }

  function freePlayCellClick(ev) {
    if (!S.freePlay || S.whose !== 'me') return;
    const cell = ev.currentTarget;
    const col = parseInt(cell.dataset.col, 10);
    const row = parseInt(cell.dataset.row, 10);

    if (_freePlayPhase === 'move-targets') {
      if (cell.classList.contains('tut-move-target')) {
        freePlayDoMove(col, row);
      } else {
        // Cancel
        clearMoveHighlights();
        closeTutRadial();
        _freePlaySelectedPiece = null;
        _freePlayPhase = 'none';
      }
      return;
    }

    if (_freePlayPhase === 'attack-targets') {
      if (cell.classList.contains('tut-attack-target')) {
        freePlaySelectAttackTarget(col, row);
      } else {
        clearMoveHighlights();
        hideAttackConfirmBtn();
        closeTutRadial();
        _freePlaySelectedPiece = null;
        _freePlayPhase = 'none';
      }
      return;
    }

    // Select a piece
    const pc = S.pieces.find(p => p.alive && p.owner === 'me' && p.col === col && p.row === row);
    if (pc) {
      if (_freePlayPieceActed.has(pc.id)) {
        addToast('이미 행동한 말입니다.');
        return;
      }
      _freePlaySelectedPiece = pc;
      openTutRadial(col, row, { skillDisabled: true, hideSkill: true });
      // Wire radial buttons
      setTimeout(() => {
        const movBtn = document.querySelector('.radial-btn[data-tut-radial-key="move"]');
        const atkBtn = document.querySelector('.radial-btn[data-tut-radial-key="attack"]');
        if (movBtn && !movBtn.disabled) movBtn.addEventListener('click', freePlayRadialMove);
        if (atkBtn && !atkBtn.disabled) atkBtn.addEventListener('click', freePlayRadialAttack);
      }, 50);
    } else {
      closeTutRadial();
      _freePlaySelectedPiece = null;
    }
  }

  // ── 자유 진행 — 캐릭터 타입별 공격 범위 반환 ────────────────────────────
  function getFreePlayAttackCells(pc) {
    const col = pc.col, row = pc.row;
    const type = (pc.char && pc.char.type) || pc.type || '';
    const cells = [];
    const add = (c, r) => { if (c >= 0 && c <= 4 && r >= 0 && r <= 4) cells.push([c, r]); };
    switch (type) {
      case 'spearman':
        // 세로열 전체 (자신 제외)
        for (let r = 0; r <= 4; r++) { if (r !== row) add(col, r); }
        break;
      case 'archer':
        // 상하좌우 2칸
        for (let i = 1; i <= 2; i++) { add(col, row - i); add(col, row + i); add(col - i, row); add(col + i, row); }
        break;
      case 'princess':
        // 십자 1칸 (자신 제외)
        add(col, row - 1); add(col, row + 1); add(col - 1, row); add(col + 1, row);
        break;
      default:
        // 기본 십자 5칸 (자신 포함)
        add(col, row); add(col, row - 1); add(col, row + 1); add(col - 1, row); add(col + 1, row);
        break;
    }
    return cells;
  }

  function freePlayHighlightAttackTargets(pc) {
    const cells = getFreePlayAttackCells(pc);
    for (const [c, r] of cells) {
      const cell = document.querySelector(boardCellSel(c, r));
      if (cell) cell.classList.add('tut-attack-target');
    }
  }

  function freePlayRadialMove() {
    if (!_freePlaySelectedPiece) return;
    closeTutRadial();
    highlightMoveTargets(_freePlaySelectedPiece.col, _freePlaySelectedPiece.row);
    _freePlayPhase = 'move-targets';
    setHint('이동할 칸을 선택하세요');
  }

  function freePlayRadialAttack() {
    if (!_freePlaySelectedPiece) return;
    closeTutRadial();
    clearMoveHighlights();
    freePlayHighlightAttackTargets(_freePlaySelectedPiece);
    _freePlayPhase = 'attack-targets';
    setHint('공격할 칸을 선택하세요');
  }

  async function freePlayDoMove(toCol, toRow) {
    const pc = _freePlaySelectedPiece;
    clearMoveHighlights();
    _freePlayPhase = 'none';
    _freePlaySelectedPiece = null;
    if (!pc) return;
    await animatePieceSlide(pc, toCol, toRow, 350);
    if (typeof playSfx === 'function') { try { playSfx('move'); } catch(e) {} }
    _freePlayPieceActed.add(pc.id);
    addLog(`${pc.name} 이동`, 'move');
    updateUI();
    clearHint();
    setHint('다른 말을 행동시키거나 턴 종료를 누르세요');
  }

  function freePlaySelectAttackTarget(col, row) {
    _freePlayPhase = 'none';
    selectAttackTarget(col, row);
    const pc = _freePlaySelectedPiece;
    if (!pc) { clearMoveHighlights(); return; }
    showAttackConfirmBtn(col, row);
    setHint('공격 확정 버튼을 누르세요');
    // Wire confirm button
    setTimeout(() => {
      const confirmBtn = document.getElementById('tut-attack-confirm-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => freePlayDoAttack(col, row));
      }
    }, 50);
  }

  async function freePlayDoAttack(col, row) {
    const pc = _freePlaySelectedPiece;
    hideAttackConfirmBtn();
    clearMoveHighlights();
    _freePlaySelectedPiece = null;
    if (!pc) return;

    // Find target
    const target = S.pieces.find(p => p.alive && p.col === col && p.row === row && p.owner === 'opp');
    await animateAttackOnCell(col, row);
    if (target) {
      const dmg = pc.atk + (isCommanderAdjacent(pc) ? 1 : 0);
      target.hp = Math.max(0, target.hp - dmg);
      target.hidden = false;
      animateBoardPieceHit(col, row);
      flashCard('opp', target.id);
      if (typeof playSfx === 'function') { try { playSfx(target.hp <= 0 ? 'kill' : 'hit'); } catch(e) {} }
      addLog(`${pc.name} → ${target.name} 명중 (ATK ${dmg})`, 'hit');
      if (target.hp <= 0) {
        target.alive = false;
        target.col = -1; target.row = -1;
        addLog(`${target.name} 격파!`, 'hit');
      }
    } else {
      if (typeof playSfx === 'function') { try { playSfx('miss'); } catch(e) {} }
      addLog(`${pc.name} 공격 — 빗나감`, 'miss');
    }
    _freePlayPieceActed.add(pc.id);
    updateUI();
    clearHint();
    setHint('다른 말을 행동시키거나 턴 종료를 누르세요');
    // Check win
    checkFreePlayWin();
  }

  function isCommanderAdjacent(pc) {
    const cmd = S.pieces.find(p => p.alive && p.owner === 'me' && p.char && p.char.type === 'commander');
    if (!cmd) return false;
    return Math.abs(cmd.col - pc.col) + Math.abs(cmd.row - pc.row) === 1;
  }

  async function freePlayEndTurn() {
    if (S.whose !== 'me') return;
    closeTutRadial();
    clearMoveHighlights();
    hideAttackConfirmBtn();
    _freePlaySelectedPiece = null;
    _freePlayPhase = 'none';
    _freePlayPieceActed = new Set();
    clearHint();

    S.turn++;
    S.whose = 'opp';
    updateUI();
    addLog(`${S.turn}턴 : 상대 차례`, 'system');
    addToast('상대 차례', true);
    await sleep(800);

    // Opp scripted AI
    await freePlayOppTurn();

    // Check if opp has anyone alive
    const oppAlive = S.pieces.filter(p => p.owner === 'opp' && p.alive);
    if (oppAlive.length === 0) {
      checkFreePlayWin();
      return;
    }

    S.turn++;
    S.whose = 'me';
    S.actionDone = false;
    _freePlayPieceActed = new Set(); // 새 턴 — 행동 가능 초기화
    updateUI();
    addLog(`${S.turn}턴 : 내 차례`, 'system');
    addToast('내 차례');
    if (typeof playTurnBell === 'function') playTurnBell();

    const endBtn = document.getElementById('tut-btn-end-turn');
    if (endBtn) endBtn.disabled = false;
    setHint('자유롭게 행동하세요! (말 클릭 → 이동/공격)');
    updateUI();
  }

  async function freePlayOppTurn() {
    const oppPieces = S.pieces.filter(p => p.owner === 'opp' && p.alive);
    const myPieces  = S.pieces.filter(p => p.owner === 'me'  && p.alive);
    if (!myPieces.length || !oppPieces.length) return;

    await sleep(700); // 상대 턴 시작 페이싱

    // 가장 가까운 적 1개만 행동
    let best = oppPieces[0], bestDist = 999;
    for (const opp of oppPieces) {
      for (const my of myPieces) {
        const d = Math.abs(opp.col - my.col) + Math.abs(opp.row - my.row);
        if (d < bestDist) { bestDist = d; best = opp; }
      }
    }

    const nearest = myPieces.reduce((a, b) =>
      Math.abs(best.col - a.col) + Math.abs(best.row - a.row) < Math.abs(best.col - b.col) + Math.abs(best.row - b.row) ? a : b
    );

    // 캐릭터 공격 범위 내에 있는지 확인
    const attackCells = getFreePlayAttackCells(best);
    const canAttack = attackCells.some(([c, r]) => c === nearest.col && r === nearest.row);

    if (canAttack) {
      // 공격
      await sleep(400);
      await animateAttackOnCell(nearest.col, nearest.row);
      const hit = Math.random() > 0.2;
      if (hit) {
        nearest.hp -= best.atk;
        if (nearest.hp <= 0) { nearest.hp = 0; nearest.alive = false; nearest.col = -1; nearest.row = -1; }
        animateBoardPieceHit(nearest.col >= 0 ? nearest.col : 0, nearest.row >= 0 ? nearest.row : 0);
        flashCard('my', nearest.id);
        if (typeof playSfx === 'function') { try { playSfx(nearest.hp <= 0 ? 'kill' : 'hit'); } catch(e) {} }
        addLog(`${best.name} → ${nearest.name} 명중 (ATK ${best.atk})`, 'hit');
        addToast('공격받았습니다!', true);
      } else {
        if (typeof playSfx === 'function') { try { playSfx('miss'); } catch(e) {} }
        addLog(`${best.name} 공격 — 빗나감`, 'miss');
      }
      await sleep(900);
    } else {
      // 이동 (최대 1칸, 가장 가까운 아군 방향)
      await sleep(300);
      const dc = Math.sign(nearest.col - best.col);
      const dr = Math.sign(nearest.row - best.row);
      const nc = dc !== 0 ? best.col + dc : best.col;
      const nr = dc !== 0 ? best.row : best.row + dr;
      const blocked = S.pieces.some(p => p.alive && p.col === nc && p.row === nr);
      if (!blocked) { best.col = nc; best.row = nr; }
      if (typeof playSfx === 'function') { try { playSfx('move'); } catch(e) {} }
      addLog(`${best.name} 이동`, 'move');
      await sleep(600);
    }
    updateUI();
    // 내 유닛 전멸 체크
    if (!S.pieces.some(p => p.owner === 'me' && p.alive)) {
      addLog('모든 아군이 격파됐습니다...', 'system');
      addToast('패배...');
    }
  }

  function checkFreePlayWin() {
    const oppAlive = S.pieces.filter(p => p.owner === 'opp' && p.alive);
    if (oppAlive.length === 0) {
      // Victory — disable freePlay so advance() works for outro scenes
      S.freePlay = false;
      clearHint();
      addToast('승리!');
      // Jump to victory dialog (scene 112)
      S.sceneIdx = SCENARIO.findIndex((sc, i) => i >= 111 && sc.kind === 'dialog');
      if (S.sceneIdx < 0) S.sceneIdx = SCENARIO.length - 3;
      setTimeout(loadScene, 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Scene 진행 엔진
  // ─────────────────────────────────────────────────────────────────────────
  let currentPhase = 'intro';

  function clearClickGuard() {
    document.querySelectorAll('.tut-require-handler').forEach(el => {
      el.classList.remove('tut-require-handler');
    });
    S._onClickTarget = null;
    if (S._onClick) {
      document.removeEventListener('click', S._onClick, true);
      S._onClick = null;
    }
  }

  function clearSpotlights() {
    document.querySelectorAll('.tut-spotlight, .tut-spotlight-strong')
      .forEach(el => el.classList.remove('tut-spotlight', 'tut-spotlight-strong'));
  }

  function showBubble(text, anchorSel, side) {
    const bubble = document.getElementById('tut-mock-bubble');
    const textEl = document.getElementById('tut-mock-bubble-text');
    if (!bubble || !textEl) return;
    clearSpotlights();
    bubble.className = 'tut-mock-bubble';
    if (!text) {
      bubble.style.opacity = '0';
      bubble.style.pointerEvents = 'none';
      hidePointer();
      return;
    }
    bubble.style.opacity = '';
    bubble.style.pointerEvents = '';
    textEl.innerHTML = text;
    repositionBubble(bubble);
    const resolved = (typeof anchorSel === 'function') ? anchorSel() : anchorSel;
    if (!resolved) { hidePointer(); return; }
    const anchor = document.querySelector(resolved);
    if (!anchor) { hidePointer(); return; }
    anchor.classList.add('tut-spotlight');
    // 먼저 위치를 확정한 뒤 포인터 그리기 (순서 중요)
    positionBubbleNear(anchor, bubble, side);
    drawPointer(anchor);
  }

  function repositionBubble(bubble) {
    if (S.sceneIdx >= 9) {
      // 하단 정렬
      bubble.style.bottom = '80px';
      bubble.style.top = '';
      bubble.style.left = '50%';
      bubble.style.transform = 'translateX(-50%)';
    } else {
      // 중앙 정렬
      bubble.style.top = '50%';
      bubble.style.bottom = 'auto';
      bubble.style.left = '50%';
      bubble.style.transform = 'translate(-50%,-50%)';
    }
  }

  function drawPointer(anchor) {
    const svg  = document.getElementById('tut-pointer-svg');
    const line = document.getElementById('tut-pointer-line');
    const bubble = document.getElementById('tut-mock-bubble');
    if (!svg || !line || !bubble || !anchor) return;

    const aRect = anchor.getBoundingClientRect();
    const bRect = bubble.getBoundingClientRect();

    // positionBubbleNear 에서 저장한 방향 (말풍선이 앵커의 어느 쪽에 있는지)
    const side = bubble.dataset.bubbleSide || 'bottom';

    // clamp 헬퍼 — 앵커/버블 범위 안에 끝점이 들어오도록
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    let x1, y1, x2, y2;
    const PAD = 8; // 엣지에서 약간 안쪽

    if (side === 'left') {
      // 말풍선이 앵커 왼쪽 → 말풍선 오른쪽 엣지 → 앵커 왼쪽 엣지
      x1 = bRect.right;
      y1 = bRect.top + bRect.height / 2;
      x2 = aRect.left;
      y2 = clamp(y1, aRect.top + PAD, aRect.bottom - PAD);
    } else if (side === 'right') {
      // 말풍선이 앵커 오른쪽 → 말풍선 왼쪽 엣지 → 앵커 오른쪽 엣지
      x1 = bRect.left;
      y1 = bRect.top + bRect.height / 2;
      x2 = aRect.right;
      y2 = clamp(y1, aRect.top + PAD, aRect.bottom - PAD);
    } else if (side === 'top') {
      // 말풍선이 앵커 위쪽 → 말풍선 하단 → 앵커 상단
      x1 = bRect.left + bRect.width / 2;
      y1 = bRect.bottom;
      x2 = clamp(x1, aRect.left + PAD, aRect.right - PAD);
      y2 = aRect.top;
    } else {
      // 말풍선이 앵커 아래쪽(또는 기본) → 말풍선 상단 → 앵커 하단
      x1 = bRect.left + bRect.width / 2;
      y1 = bRect.top;
      x2 = clamp(x1, aRect.left + PAD, aRect.right - PAD);
      y2 = aRect.bottom;
    }

    line.setAttribute('x1', String(Math.round(x1)));
    line.setAttribute('y1', String(Math.round(y1)));
    line.setAttribute('x2', String(Math.round(x2)));
    line.setAttribute('y2', String(Math.round(y2)));
    svg.classList.remove('hidden');
  }

  function hidePointer() {
    const svg = document.getElementById('tut-pointer-svg');
    if (svg) svg.classList.add('hidden');
  }

  function positionBubbleNear(anchor, bubble, sidePref) {
    const aRect = anchor.getBoundingClientRect();
    bubble.style.transform = 'none'; // CSS의 translateX(-50%) 가 다시 적용되지 않도록 명시적으로 'none'
    bubble.style.bottom = 'auto'; // top/bottom 동시 설정으로 늘어나는 현상 방지
    bubble.style.left = '0px'; bubble.style.top = '0px';
    bubble.style.visibility = 'hidden';
    const meas = bubble.getBoundingClientRect();
    bubble.style.visibility = '';
    const bubW = meas.width || 340, bubH = meas.height || 200;
    const SPOTLIGHT_HALO = 14;
    const gap = 18;
    const vw = window.innerWidth, vh = window.innerHeight;
    const aHalo = {
      left: aRect.left - SPOTLIGHT_HALO, right: aRect.right + SPOTLIGHT_HALO,
      top: aRect.top - SPOTLIGHT_HALO, bottom: aRect.bottom + SPOTLIGHT_HALO,
      width: aRect.width + 2 * SPOTLIGHT_HALO, height: aRect.height + 2 * SPOTLIGHT_HALO,
    };
    const order = (() => {
      const opp = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
      const first = sidePref || 'right';
      const second = opp[first] || 'left';
      const others = (first === 'top' || first === 'bottom') ? ['right', 'left'] : ['top', 'bottom'];
      return [first, second, ...others];
    })();
    function trySide(side) {
      let left, top;
      if (side === 'right')     { left = aHalo.right + gap;            top = aRect.top + aRect.height / 2 - bubH / 2; }
      else if (side === 'left') { left = aHalo.left - bubW - gap;      top = aRect.top + aRect.height / 2 - bubH / 2; }
      else if (side === 'top')  { left = aRect.left + aRect.width / 2 - bubW / 2; top = aHalo.top - bubH - gap; }
      else                      { left = aRect.left + aRect.width / 2 - bubW / 2; top = aHalo.bottom + gap; }
      const bRect = { left, top, right: left + bubW, bottom: top + bubH };
      const offLeft = Math.max(0, 8 - bRect.left);
      const offRight = Math.max(0, bRect.right - (vw - 8));
      const offTop = Math.max(0, 8 - bRect.top);
      const offBottom = Math.max(0, bRect.bottom - (vh - 8));
      const outAmount = offLeft + offRight + offTop + offBottom;
      const overlapsHalo = !(bRect.right < aHalo.left - 1 || bRect.left > aHalo.right + 1 || bRect.bottom < aHalo.top - 1 || bRect.top > aHalo.bottom + 1);
      return { left, top, side, overlapsHalo, outAmount };
    }
    let best = null, fallback = null;
    for (const s of order) {
      const r = trySide(s);
      if (!r.overlapsHalo && r.outAmount === 0) { best = r; break; }
      if (!fallback || r.outAmount < fallback.outAmount || (r.outAmount === fallback.outAmount && !r.overlapsHalo && fallback.overlapsHalo)) {
        fallback = r;
      }
    }
    if (!best) best = fallback;
    best.left = Math.max(8, Math.min(vw - bubW - 8, best.left));
    best.top = Math.max(8, Math.min(vh - bubH - 8, best.top));
    bubble.style.left = best.left + 'px';
    bubble.style.top = best.top + 'px';
    const tailMap = { right: 'tail-left', left: 'tail-right', top: 'tail-bottom', bottom: 'tail-top' };
    bubble.dataset.bubbleSide = best.side; // drawPointer 가 읽는 방향 키
    bubble.classList.add('with-tail', tailMap[best.side]);
  }

  // ── loadScene ────────────────────────────────────────────────────────────
  async function loadScene() {
    clearClickGuard();
    const scene = SCENARIO[S.sceneIdx];
    if (!scene) return;
    updateProgress();

    if (scene.kind === 'enter') {
      currentPhase = scene.phase;
      if (scene.phase === 'game') {
        initHideAll();
        renderPhase('game');
        updateUI();
      } else {
        renderPhase(scene.phase);
      }
      advance();
      return;
    }

    if (scene.kind === 'reveal') {
      (scene.selectors || []).forEach(revealEl);
      advance();
      return;
    }

    if (scene.kind === 'dialog') {
      const next = document.getElementById('tut-mock-bubble-next');
      if (next) next.disabled = false;
      const delay = S._postClickDelay || 0;
      S._postClickDelay = 0;
      hideBubbleTemporarily();
      setTimeout(() => {
        if (SCENARIO[S.sceneIdx] !== scene) return;
        showBubble(scene.text, scene.anchor || null, scene.side || null);
      }, delay);
      return;
    }

    if (scene.kind === 'require') {
      // hintMode: skip bubble, go straight to click guard
      if (scene.hintMode) {
        const delay = S._postClickDelay || 0;
        S._postClickDelay = 0;
        if (delay > 0) await sleep(delay);
        hideBubbleTemporarily();
        // Spotlight the anchor
        const targetSel = (typeof scene.anchor === 'function') ? scene.anchor() : scene.anchor;
        if (targetSel) {
          const el = document.querySelector(targetSel);
          if (el) {
            el.classList.add('tut-spotlight', 'tut-spotlight-strong');
            if (el.classList.contains('radial-btn')) {
              el.style.transform = 'translate(-50%,-50%) scale(1)';
            }
          }
        }
        const next = document.getElementById('tut-mock-bubble-next');
        if (next) next.disabled = true;
        requestAnimationFrame(() => {
          attachClickGuard(targetSel, (el) => {
            document.querySelectorAll('.tut-spotlight-strong').forEach(e => {
              e.classList.remove('tut-spotlight-strong', 'tut-spotlight');
            });
            try { if (scene.onClick) scene.onClick(el); } catch (e) { console.error(e); }
            S._postClickDelay = 600;
          });
        });
        return;
      }

      // Normal require (non-hintMode)
      const next = document.getElementById('tut-mock-bubble-next');
      if (next) next.disabled = false;
      const delay = S._postClickDelay || 0;
      S._postClickDelay = 0;
      hideBubbleTemporarily();
      S._requirePending = scene;
      setTimeout(() => {
        if (SCENARIO[S.sceneIdx] !== scene) return;
        showBubble(scene.text || '', scene.anchor, scene.side || null);
      }, delay);
      return;
    }

    if (scene.kind === 'animate') {
      const next = document.getElementById('tut-mock-bubble-next');
      if (next) next.disabled = true;
      const delay = S._postClickDelay || 0;
      S._postClickDelay = 0;
      if (delay > 0) await sleep(delay);
      if (scene.text) showBubble(scene.text, scene.anchor || null, scene.side || null);
      else hideBubbleTemporarily();
      try {
        await scene.run();
      } catch (e) { console.error('[tut] animate error', e); }
      advance();
      return;
    }
  }

  function hideBubbleTemporarily() {
    const bubble = document.getElementById('tut-mock-bubble');
    if (bubble) { bubble.style.opacity = '0'; bubble.style.pointerEvents = 'none'; }
    clearSpotlights();
    hidePointer();
  }

  function enterRequireWaitStage(scene) {
    const bubble = document.getElementById('tut-mock-bubble');
    if (bubble) bubble.classList.add('tut-bubble-hidden');
    hidePointer();
    document.querySelectorAll('.tut-spotlight').forEach(el => {
      el.classList.add('tut-spotlight-strong');
      if (el.classList.contains('radial-btn')) {
        el.style.transform = 'translate(-50%,-50%) scale(1)';
      }
    });
    const next = document.getElementById('tut-mock-bubble-next');
    if (next) next.disabled = true;
    const targetSel = (typeof scene.anchor === 'function') ? scene.anchor() : scene.anchor;
    requestAnimationFrame(() => {
      attachClickGuard(targetSel, (el) => {
        document.querySelectorAll('.tut-spotlight-strong').forEach(e => e.classList.remove('tut-spotlight-strong'));
        if (bubble) bubble.classList.remove('tut-bubble-hidden');
        try { if (scene.onClick) scene.onClick(el); } catch (e) { console.error(e); }
        S._postClickDelay = 1500;
      });
    });
  }

  function attachClickGuard(targetSel, onClick) {
    if (!targetSel) return;
    const handler = (ev) => {
      if (ev.target.closest('#tut-mock-back, #tut-mock-bubble-prev, #tut-mock-bubble-next')) return;
      const t = ev.target.closest(targetSel);
      if (!t) {
        ev.stopPropagation(); ev.preventDefault();
        flashSpotlight();
        return;
      }
      ev.stopPropagation();
      try { if (onClick) onClick(t); } catch (e) { console.error('[tut] onClick error', e); }
      clearClickGuard();
      advance();
    };
    document.addEventListener('click', handler, true);
    S._onClick = handler;
    S._onClickTarget = targetSel;
  }

  function flashSpotlight() {
    document.querySelectorAll('.tut-spotlight').forEach(el => {
      el.classList.remove('tut-spotlight-bump');
      void el.offsetWidth;
      el.classList.add('tut-spotlight-bump');
      setTimeout(() => el.classList.remove('tut-spotlight-bump'), 500);
    });
  }

  function updateProgress() {
    const el = document.getElementById('tut-mock-progress');
    if (el) el.textContent = `${S.sceneIdx + 1} / ${SCENARIO.length}`;
  }

  function advance() {
    if (S.freePlay) return; // Free play manages its own flow
    if (S.sceneIdx >= SCENARIO.length - 1) {
      exitTutorial();
      return;
    }
    S.sceneIdx++;
    setTimeout(loadScene, 80);
  }

  function rewind() {
    if (S.sceneIdx <= 0) return;
    S.sceneIdx--;
    setTimeout(loadScene, 80);
  }

  function exitTutorial() {
    clearClickGuard();
    clearSpotlights();
    closeTutRadial();
    hideBubbleTemporarily();
    hideCharDict();
    hideAttackConfirmBtn();
    hideSkillTab();
    clearHint();

    S.sceneIdx = 0;
    S.drafted = { t1: null, t2: null, t3: null };
    S.placedCount = 0;
    S.pieces = [];
    S.marks = {};
    S.logEntries = [];
    S.freePlay = false;
    S.selectedPiece = null;
    _freePlaySelectedPiece = null;
    _freePlayPhase = 'none';
    _freePlayPieceActed = new Set();

    const logEl = document.getElementById('tut-game-log');
    if (logEl) logEl.innerHTML = '';
    const board = document.getElementById('tut-game-board');
    if (board) board.innerHTML = '';
    const myCont = document.getElementById('tut-my-pieces-info');
    if (myCont) myCont.innerHTML = '';
    const oppCont = document.getElementById('tut-opp-pieces-info');
    if (oppCont) oppCont.innerHTML = '';
    const shrinkCont = document.getElementById('tut-shrink-warning-container');
    if (shrinkCont) shrinkCont.innerHTML = '';
    const gameLayout = document.querySelector(`${SCOPE} .game-layout`);
    if (gameLayout) gameLayout.style.display = 'none';
    REVEAL_TARGETS.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) { el.classList.remove('tut-hide-init', 'tut-revealed'); }
    });
    if (typeof showScreen === 'function') showScreen('screen-lobby');
  }

  function startTutorial() {
    S.sceneIdx = 0;
    S.drafted = { t1: null, t2: null, t3: null };
    S.placedCount = 0;
    S.pieces = [];
    S.marks = {};
    S.logEntries = [];
    S.visibleOppIds = new Set();
    S.deductionTokens = [];
    S.turn = 1; S.whose = 'me';
    S.spMy = 0; S.spOpp = 0;
    S._postClickDelay = 0;
    S._requirePending = null;
    S.freePlay = false;
    S.selectedPiece = null;
    _freePlaySelectedPiece = null;
    _freePlayPhase = 'none';
    _freePlayPieceActed = new Set();
    hideBubbleTemporarily();
    clearClickGuard();
    clearSpotlights();
    hideCharDict();
    hideAttackConfirmBtn();
    hideSkillTab();
    clearHint();
    if (typeof showScreen === 'function') showScreen('screen-tutorial-interactive');
    requestAnimationFrame(() => requestAnimationFrame(loadScene));
  }

  function wireUp() {
    const btnTut = document.getElementById('btn-tutorial');
    if (btnTut) {
      btnTut.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        startTutorial();
      }, true);
    }
    document.getElementById('tut-mock-back')?.addEventListener('click', exitTutorial);
    document.getElementById('tut-mock-bubble-next')?.addEventListener('click', () => {
      const scene = SCENARIO[S.sceneIdx];
      if (!scene) return;
      if (scene.kind === 'dialog') {
        advance();
      } else if (scene.kind === 'require' && !scene.hintMode && S._requirePending) {
        const reqScene = S._requirePending;
        S._requirePending = null;
        enterRequireWaitStage(reqScene);
      }
    });
    document.getElementById('tut-mock-bubble-prev')?.addEventListener('click', () => {
      rewind();
    });
    window.addEventListener('resize', () => {
      const scene = SCENARIO[S.sceneIdx];
      if (!scene) return;
      if (scene.kind === 'dialog' || scene.kind === 'require' || (scene.kind === 'animate' && scene.text)) {
        const sel = (typeof scene.anchor === 'function') ? scene.anchor() : scene.anchor;
        showBubble(scene.text || '', sel || null, scene.side || null);
      }
      // Reposition attack confirm button
      if (_attackTargetCol >= 0) {
        showAttackConfirmBtn(_attackTargetCol, _attackTargetRow);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUp);
  else wireUp();
})();
