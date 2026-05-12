// ─────────────────────────────────────────────────────────────────────────────
// CALIGO 체험형 튜토리얼 (v6) — 정해진 시나리오를 실제로 클릭하며 체험.
//
//   • 신(scene) 단위 진행. 신 종류:
//       - dialog        : 말풍선만 표시, "➡️" 로 다음.
//       - require       : anchor 강조 + 그 요소만 클릭 가능 → 클릭 시 자동 진행.
//       - animate       : 자동 애니메이션 (이동/공격/스킬/턴 변경) → 끝나면 다음.
//   • 대화체 톤 — 짧은 문장, 멘토가 옆에서 말해주는 듯한 어투.
//   • 실제 게임과 동일한 보드/카드/SP/로그 — 게임 진행하듯 체험.
//   • 시나리오: 드래프트(3) → HP → 배치(3) → 게임 7턴(승리).
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  'use strict';

  const COLS = ['A','B','C','D','E'];
  const SCOPE = '#screen-tutorial-interactive';

  // 캐릭터 카탈로그 (튜토리얼용)
  const CHARS = {
    spearman:    { type:'spearman',    icon:'🔱',  name:'창병',         tier:1, atk:1, baseHp:2 },
    cavalry:     { type:'cavalry',     icon:'🐎',  name:'기마병',       tier:1, atk:1, baseHp:2 },
    bodyguard:   { type:'bodyguard',   icon:'🛡',  name:'호위무사',     tier:2, atk:1, baseHp:3 },
    general:     { type:'general',     icon:'🎖',  name:'장군',         tier:2, atk:2, baseHp:5 },
    herbalist:   { type:'herbalist',   icon:'🌿',  name:'약초전문가',   tier:1, atk:1, baseHp:2 },
    commander:   { type:'commander',   icon:'📋',  name:'지휘관',       tier:3, atk:2, baseHp:3 },
    gunpowder:   { type:'gunpowder',   icon:'💣',  name:'화약상',       tier:2, atk:1, baseHp:3 },
  };

  // (이전의 드래프트/HP/배치 자료구조 폐기 — 새 시나리오는 유닛이 시간차로 등장)

  // ── 런타임 상태 ───────────────────────────────────────────────────────────
  const S = {
    sceneIdx: 0,
    pieces: [],          // 모든 piece (my + opp). 동적으로 추가됨.
    turn: 1,
    whose: 'me',
    spMy: 1, spOpp: 1,   // 인게임처럼 1/1 로 시작 (10턴마다 +1 지급)
    deductionTokens: [],
    logEntries: [],
    _animTimers: [],
    _onClick: null,
    _onClickTarget: null,
    // 신규: opp 카드 표시 여부 (점진적 등장)
    visibleOppIds: new Set(),
  };
  window.tutorialInteractive = S;

  // ─────────────────────────────────────────────────────────────────────────
  //  시나리오 — 모든 scene 의 배열
  // ─────────────────────────────────────────────────────────────────────────
  // scene = { kind, ...옵션 }
  //   dialog  : { kind:'dialog', text, anchor?, side? }
  //   require : { kind:'require', text, anchor, side?, match(el):bool, onClick(el) }
  //   animate : { kind:'animate', text?, anchor?, side?, run: async() }
  //   enter   : { kind:'enter', phase: 'intro'|'draft-t1'|'draft-t2'|'draft-t3'|'hp'|'place-1'|...|'game' }
  //   reveal  : { kind:'reveal', selectors: [...] }   // 게임 UI 요소 등장 + 다음 신은 dialog 가 이어짐
  const SCENARIO = [];

  // ── 인트로 ─────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'intro' });
  SCENARIO.push({ kind:'dialog', text:`<p>안녕하세요, 새로운 전사여 🎓</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>여기는 <strong>CALIGO</strong>, 안개 속의 보드게임.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>한 판 같이 해봅시다.</p>` });

  // ── 게임 등장 — 어둠 속에서 장군 + 그리드 fade-in ────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { setupGameState(); updateUI(); await sleep(100); } });
  SCENARIO.push({ kind:'enter', phase:'game' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 화면 어둠 → 보드 + 장군 등장
      document.body.classList.add('tut-darkness');
      const board = document.getElementById('tut-game-board');
      if (board) board.classList.add('tut-board-spawn');
      await sleep(300);
      document.body.classList.remove('tut-darkness');
      await sleep(500);
    } });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-game-board`] });
  SCENARIO.push({ kind:'dialog', text:`<p>여기가 전장이에요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>5×5 격자판. 가운데 아래 빛나는 게 — 우리 장군이에요.</p>`, anchor:() => boardCellSel(2, 4), side:'right' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .left-panel`] });
  SCENARIO.push({ kind:'dialog', text:`<p>왼쪽이 내 말 카드. HP, ATK, 위치가 보여요.</p>`, anchor:`${SCOPE} .left-panel`, side:'right' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .right-panel`] });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽은 상대 말 자리. 아직 비어있어요.</p>`, anchor:`${SCOPE} .right-panel`, side:'left' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-turn-banner`] });
  SCENARIO.push({ kind:'dialog', text:`<p>위쪽 — 현재 차례. 지금은 1턴, 내 차례.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-action-bar`] });
  SCENARIO.push({ kind:'dialog', text:`<p>아래 — 행동·스킬·턴 종료·기권 버튼.</p>`, anchor:`${SCOPE} #tut-action-bar`, side:'top' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .center-log-wrap`] });
  SCENARIO.push({ kind:'dialog', text:`<p>그 아래 — 전투 로그. 모든 행동이 여기 기록돼요.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .sp-section`] });
  SCENARIO.push({ kind:'dialog', text:`<p>맨 위 — SP 바. 스킬 자원. 양 측이 공유해요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });

  // ── 턴 1 — 장군 첫 이동 ────────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>먼저 — 장군을 한 칸 전진시켜봅시다.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>보드 위 장군을 클릭하면 부채꼴 메뉴가 떠요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 🎖 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 4) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(2, 4); openTutRadial(2, 4, { attackDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이동·공격·스킬 셋 중에서 골라요.</p>`, anchor:'#tut-radial-menu', side:'top' });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(2, 4); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이동 가능 칸이 녹색으로 빛나요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>위쪽 <strong>C4</strong> 로 전진해요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C4</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 3), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(2,4), 2, 3, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 2, 3); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>파란 칸들이 장군 사거리예요. 십자 5칸.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });

  // ── 턴 2 — 적 등장 ────────────────────────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 2; S.whose = 'opp';
      addLog('2턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 상대가 등장해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 창병 등장 (위치는 안개 — hidden:true)
      spawnPiece({ id:'op-1', owner:'opp', char:CHARS.spearman, col:2, row:0, hp:2, maxHp:2, hidden:true });
      await sleep(600);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽 카드에 <strong>창병</strong>이 새로 떴어요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-1"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>위치는 안개. 보드 위엔 안 보여요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 창병 C1 → C2 (안개 속 이동)
      const sp = findPiece('op-1');
      sp.col = 2; sp.row = 1;
      addLog('상대가 이동했습니다.', 'move');
      flashLogPanel();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>"상대가 이동" 만 떴어요. 누가 어디로? 모르죠.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });

  // ── 턴 3 — 장군 공격 (창병 명중) ──────────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 3; S.whose = 'me';
      addLog('3turn : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>3턴 — 내 차례. 이번엔 공격을 해봐요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>창병이 C 열 어디엔가 있을 거에요. 일단 가까운 C3 을 노려봐요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 🎖 클릭.</p>`,
    anchor: () => boardCellSel(2, 3) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(2, 3); openTutRadial(2, 3, { moveDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => { closeTutRadial(); highlightAttackTargetsGeneral(2, 3); } });
  SCENARIO.push({ kind:'dialog', text:`<p>공격 가능 셀이 빨갛게 빛나요. <strong>C2</strong> 를 노려요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C2</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 1), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(2, 1);
      const sp = findPiece('op-1');
      sp.hp -= 2;          // 장군 ATK 2
      sp.hidden = false;   // 명중 → 위치 노출
      animateBoardPieceHit(2, 1);
      flashCard('opp', sp.id);
      addLog('C2 명중', 'hit');
      updateUI();
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>💥 <strong>명중!</strong> 창병 발견.</p>`, anchor:() => boardCellSel(2, 1), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>공격이 적중하면 안개가 걷히고 위치가 드러나요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>창병 HP 2 → 0 — 격파!</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-1"]`, side:'left' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      const sp = findPiece('op-1');
      sp.alive = false;
      sp.col = -1; sp.row = -1;
      addLog('C2 🔱 창병 격파', 'kill');
      updateUI();
      await sleep(600);
    } });

  // ── 턴 4 — 새 적 등장 (호위무사) ───────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 4; S.whose = 'opp';
      addLog('4턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>잠깐 — 적이 새로 등장해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      spawnPiece({ id:'op-2', owner:'opp', char:CHARS.bodyguard, col:2, row:0, hp:3, maxHp:3, hidden:true });
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🛡 <strong>호위무사</strong>. ATK 1, HP 3.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-2"]`, side:'left' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사 C1 → C2 (전진, 안개)
      const bg = findPiece('op-2');
      bg.col = 2; bg.row = 1;
      addLog('상대가 이동했습니다.', 'move');
      flashLogPanel();
      await sleep(600);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>또 안개 속 이동. 누군가 다가오고 있어요.</p>` });

  // ── 턴 5 — 장군 attack — 빗나감 또는 약함 ─────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 5; S.whose = 'me';
      addLog('5턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>5턴 — 내 차례. 호위무사 어딨는지 모르지만 C 열로 또 들이밀어봐요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 클릭.</p>`,
    anchor: () => boardCellSel(2, 3) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(2, 3); openTutRadial(2, 3, { moveDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => { closeTutRadial(); highlightAttackTargetsGeneral(2, 3); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C2</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 1), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(2, 1);
      const bg = findPiece('op-2');
      bg.hp -= 2;
      bg.hidden = false;
      animateBoardPieceHit(2, 1);
      flashCard('opp', bg.id);
      addLog('C2 명중', 'hit');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>또 명중! 호위무사 발견. HP 3 → 1.</p>`, anchor:() => boardCellSel(2, 1), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>한 방 더면 격파.</p>` });

  // ── 턴 6 — 호위무사 반격 (장군 피격) ────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 6; S.whose = 'opp';
      addLog('6턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>상대 호위무사가 반격해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사 (C2) → 장군 (C3) 공격, 호위무사 사거리 십자
      await animateAttackOnCell(2, 2);
      const gen = findMyPiece(2, 2);
      gen.hp -= 1;
      animateBoardPieceHit(2, 2);
      flashCard('my', gen.id);
      addLog('🎖 장군 피격', 'hit');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 한 대 맞았어요. HP 5 → 4.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이대로 계속 맞다간 위험.</p>` });

  // ── 약초전문가 등장 ───────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>그때 — 지원이 도착해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      spawnPiece({ id:'me-herbalist', owner:'me', char:CHARS.herbalist, col:3, row:4, hp:2, maxHp:2 });
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🌿 <strong>약초전문가</strong> 합류! D5 에 도착했어요.</p>`, anchor:() => boardCellSel(3, 4), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>스킬 — 주변 아군 회복. 장군 살리기 딱 좋아요.</p>` });

  // ── 턴 7 — 약초 회복 ────────────────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 7; S.whose = 'me';
      addLog('7턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>약초전문가로 장군을 회복시켜봐요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>약초전문가 🌿 D5 를 클릭하세요.</p>`,
    anchor: () => boardCellSel(3, 4) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(3, 4); openTutRadial(3, 4, { moveDisabled: true, attackDisabled: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>✨ <strong>스킬</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="skill"]', side:'right',
    onClick: () => { closeTutRadial(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>🌿 약초학 — 주변 아군 1 HP 회복.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.spMy = Math.max(0, S.spMy - 2);
      // 인접한 장군 회복
      healPiece('me-general', 1);
      addLog('🌿 약초학: 범위 내 아군 1 HP 회복', 'skill');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 HP 4 → 5 회복!</p>` });

  // ── 턴 8 — 호위무사가 또 공격 ─────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 8; S.whose = 'opp';
      addLog('8턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      await animateAttackOnCell(2, 2);
      const gen = findMyPiece(2, 2);
      gen.hp -= 1;
      animateBoardPieceHit(2, 2);
      flashCard('my', gen.id);
      addLog('🎖 장군 피격', 'hit');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사가 또 때렸어요. 장군 HP 5 → 4.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이번엔 — 우리도 마무리 짓자.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 ATK 2 — 호위무사 HP 1 — 한 방이면 격파.</p>` });

  // ── 지휘관 등장 (사기증진) ──────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>그리고 — 또 한 명 합류!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      spawnPiece({ id:'me-commander', owner:'me', char:CHARS.commander, col:1, row:3, hp:3, maxHp:3 });
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>📋 <strong>지휘관</strong> 합류! B4 위치.</p>`, anchor:() => boardCellSel(1, 3), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관 옆 아군은 <strong>사기증진</strong> — ATK +1.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 C3, 지휘관 B4 — 가까이 있어요. 옆으로 붙이면 사기증진 발동.</p>` });

  // ── 턴 9 — 지휘관 이동 + 장군 인접 → 사기증진 ───────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 9; S.whose = 'me';
      addLog('9턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관을 B3 으로 옮기면 — 장군 C3 과 직교 인접. 사기증진 활성.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>지휘관 📋 B4 를 클릭하세요.</p>`,
    anchor: () => boardCellSel(1, 3) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(1, 3); openTutRadial(1, 3, { attackDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(1, 3); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>B3</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(1, 2), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(1, 3), 1, 2, 350);
      addLog('📋 지휘관 이동', 'move');
      updateUI();
      await sleep(500);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 셀이 청록빛으로 빛나죠? 사기증진 발동!</p>`, anchor:() => boardCellSel(2, 2), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 평타가 실질 ATK 3 으로 강화. 다음 턴 — 격파각.</p>` });

  // ── 턴 10 — 상대 또 공격 (SP 지급도 발생) ───────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 10; S.whose = 'opp';
      addLog('10턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      await animateAttackOnCell(2, 2);
      const gen = findMyPiece(2, 2);
      gen.hp -= 1;
      animateBoardPieceHit(2, 2);
      flashCard('my', gen.id);
      addLog('🎖 장군 피격', 'hit');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 또 한 대 맞음 — HP 4 → 3.</p>` });

  // ── SP 지급 ─────────────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>10턴 종료 — <strong>SP 지급</strong> 이벤트!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playSpGrantCeremony(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>나와 상대 — 각각 SP +1. 스킬 쓸 여유 생겼어요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });

  // ── 턴 11 — 장군 격파 (사기증진 강화 + 처치) ────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 11; S.whose = 'me';
      addLog('11턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>11턴 — 호위무사 정리.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 🎖 C3 클릭.</p>`,
    anchor: () => boardCellSel(2, 2) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(2, 2); openTutRadial(2, 2, { moveDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => { closeTutRadial(); highlightAttackTargetsGeneral(2, 2); } });
  SCENARIO.push({ kind:'require', text:`<p><strong>C2</strong> 호위무사를 공격.</p>`,
    anchor: () => boardCellSel(2, 1), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(2, 1);
      const bg = findPiece('op-2');
      bg.hp -= 3;   // 사기증진 강화 ATK 3
      animateBoardPieceHit(2, 1);
      flashCard('opp', bg.id);
      bg.alive = false;
      bg.col = -1; bg.row = -1;
      addLog('C2 🛡 호위무사 격파', 'kill');
      updateUI();
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🎉 호위무사 격파! 강화된 ATK 3 의 위력.</p>` });

  // ── 새 적 등장 — 화약상 ──────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>하지만 상대도 가만있지 않아요. 새 적 등장.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      spawnPiece({ id:'op-3', owner:'opp', char:CHARS.gunpowder, col:4, row:0, hp:3, maxHp:3, hidden:true });
      S.turn = 12; S.whose = 'opp';
      addLog('12턴 : 상대 차례', 'system');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>💣 <strong>화약상</strong>이 떴어요. 폭탄 스킬을 가졌어요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-3"]`, side:'left' });

  // ── 보드 축소 경고 시작 ────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>그리고 동시에 — 큰 알림이 와요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playShrinkWarningSummary(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>🔥 <strong>보드 축소</strong> 경고. 3턴 후 외곽 칸이 파괴돼요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>외곽에 있는 말은 — 휩쓸려 탈락. 안쪽으로 대피해야 해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>지금 우리 위치 보면 — 약초전문가 D5(외곽), 지휘관 B3(안쪽 OK), 장군 C3(안쪽 OK).</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>약초전문가만 위험. 한 칸 안쪽으로 옮겨야 해요.</p>` });

  // ── 턴 13 — 약초전문가 대피 ──────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 13; S.whose = 'me';
      addLog('13턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'require', text:`<p>약초전문가 🌿 D5 클릭.</p>`,
    anchor: () => boardCellSel(3, 4) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(3, 4); openTutRadial(3, 4, { attackDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(3, 4); } });
  SCENARIO.push({ kind:'require', text:`<p>안쪽 <strong>D4</strong> 셀로.</p>`,
    anchor: () => boardCellSel(3, 3), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(3, 4), 3, 3, 350);
      addLog('🌿 약초전문가 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>약초전문가 안쪽 D4 도착. 외곽 위험 회피.</p>` });

  // ── 턴 14 — 상대 화약상 폭탄 설치 ─────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 14; S.whose = 'opp';
      addLog('14턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>상대가 SP 를 모아 — 화약상이 폭탄 시전!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      addLog('💣 폭탄 설치: 상대의 폭탄 설치', 'skill');
      flashLogPanel();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>어딘가에 폭탄이 깔렸어요. 보드엔 안 보이지만 — 다음 턴 터질 거에요.</p>` });

  // ── 턴 15 — 보드 축소 카운트다운 + 내 행동 ────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 15; S.whose = 'me';
      addLog('15턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 보드 축소까지 1턴 남았어요. 마무리 준비.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>턴 종료로 넘어갑시다.</p>` });
  SCENARIO.push({ kind:'require', text:`<p><strong>턴 종료</strong> 버튼을 클릭.</p>`,
    anchor:`#tut-btn-end-turn`, side:'top',
    onClick: () => {} });

  // ── 턴 16 — 보드 축소 발동! ─────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 16; S.whose = 'opp';
      addLog('16턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🔥 보드 축소 발동!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playBoardShrinkSummary(); } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 외곽에 남은 piece 탈락 — 시나리오 상 화약상(E1) 만 탈락 시킴.
      // 그리고 약초전문가도 시각화를 위해 탈락 (외곽이 아닌데 narrative 상 강제)
      // → 실제로는 화약상 (4,0) 만 외곽이고 약초전문가는 (3,3) 안쪽.
      const dead = destroyOuterRingPieces();
      for (const p of dead) {
        addLog(`💀 ${p.name} 탈락`, 'event');
      }
      updateUI();
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>외곽에 있던 화약상이 탈락! 폭탄도 함께 사라졌어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>잔존 — 우리 3 (장군·약초·지휘관) vs 상대 0.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>...그런데 상대가 마지막 한 명을 더 보내요. 절박한 반격이에요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      spawnPiece({ id:'op-4', owner:'opp', char:CHARS.cavalry, col:3, row:1, hp:2, maxHp:2, hidden:false });
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🐎 기마병이 D2 에 등장. 우리에게 다가와요.</p>`, anchor:() => boardCellSel(3, 1), side:'right' });

  // ── 턴 17 — 최후 공격: 기마병 격파 → 승리 ──────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 17; S.whose = 'me';
      addLog('17턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>마지막 적. 장군으로 끝내요. C3 → D3 이동 → 다음 턴 격파... 보다는, 지휘관이 가깝네요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>아니, 장군의 C3 사거리 — C2/C4/B3/D3. D2 는 닿지 않아요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>약초전문가 D4 에서 보면 — 자기+8방 인접. D3 만 닿음. D2 못 닿음.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 D3 로 전진 → 다음 턴 D2 공격하자.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 🎖 C3 클릭.</p>`,
    anchor: () => boardCellSel(2, 2) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(2, 2); openTutRadial(2, 2, { attackDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(2, 2); } });
  SCENARIO.push({ kind:'require', text:`<p><strong>D3</strong> 셀로.</p>`,
    anchor: () => boardCellSel(3, 2), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(2, 2), 3, 2, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(500);
    } });

  // ── 턴 18 — 기마병 다가옴 ───────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 18; S.whose = 'opp';
      addLog('18턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 기마병이 가로열 sweep 으로 장군 hit (D 행 2 = 장군 D3 위치는 row 2, 기마병 row 1)
      // 기마병 D2 → row 1 sweep — 같은 행 hit. 장군 D3 (row 2) 다른 행.
      // 단순화: 기마병이 D2 → D3 으로 이동 (충돌 없이 한 칸 아래) — D3 에 장군. 불가능.
      // 대신 기마병 D2 → C2 sideways.
      const ca = findPiece('op-4');
      await animatePieceSlide(ca, 2, 1, 350);
      addLog('상대가 이동했습니다.', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>기마병이 C2 로 옆걸음.</p>` });

  // ── 턴 19 — 최후 공격 → 승리 ───────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 19; S.whose = 'me';
      addLog('19턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 D3 사거리 — D2/D4/C3/E3/D3. C2 는 사거리 밖.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>한 칸 더 — C3 로 옮기면 C2 닿아요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 🎖 D3 클릭.</p>`,
    anchor: () => boardCellSel(3, 2) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(3, 2); openTutRadial(3, 2, { attackDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(3, 2); } });
  SCENARIO.push({ kind:'require', text:`<p><strong>C3</strong> 셀로.</p>`,
    anchor: () => boardCellSel(2, 2), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(3, 2), 2, 2, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 20 — 기마병이 도주 시도 ─────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 20; S.whose = 'opp';
      addLog('20턴 : 상대 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>기마병이 도주를 시도해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      const ca = findPiece('op-4');
      await animatePieceSlide(ca, 1, 1, 350);
      addLog('상대가 이동했습니다.', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>기마병 C2 → B2 로 한 칸 옆.</p>` });

  // ── 턴 21 — 최종 공격 ────────────────────────────────
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 21; S.whose = 'me';
      addLog('21턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관(B3)이 가까이 있어 사기증진 활성. 장군 C3 ATK 3.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 사거리 — C2/C4/B3/D3. B2 는 닿지 않아요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관이 직접 — B3 에서 B2 가 사거리에. 지휘관 ATK 2 로 기마병 HP 2 잡을 수 있어요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>지휘관 📋 B3 클릭.</p>`,
    anchor: () => boardCellSel(1, 2) + ' .piece-marker', side:'top',
    onClick: () => { S.selectedPiece = findMyPiece(1, 2); openTutRadial(1, 2, { moveDisabled: true, skillDisabled: true, hideSkill: true }); } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong>.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => {
      closeTutRadial();
      // 지휘관 사거리 — 좌우 1칸 (자기 제외)
      ['B2', 'B4'].forEach(coord => {
        const c = COLS.indexOf(coord[0]);
        const r = parseInt(coord[1]) - 1;
        const cell = document.querySelector(boardCellSel(c, r));
        if (cell) cell.classList.add('tut-attack-target');
      });
    } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>B2</strong> 셀을 클릭. 마지막 공격!</p>`,
    anchor: () => boardCellSel(1, 1), side:'right', onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(1, 1);
      const ca = findPiece('op-4');
      ca.hp -= 2;
      animateBoardPieceHit(1, 1);
      flashCard('opp', ca.id);
      ca.alive = false;
      ca.col = -1; ca.row = -1;
      addLog('B2 🐎 기마병 격파', 'kill');
      updateUI();
      await sleep(900);
    } });

  // ── 승리! ──────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>🎉 <strong>승리!</strong></p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군·약초전문가·지휘관 — 셋이서 안개를 헤쳤어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 직접 한 판 해보세요. 행운을 빌어요 🍀</p>` });

  // ═════════════════════════════════════════════════════════════════════════
  //  엔진 로직
  // ═════════════════════════════════════════════════════════════════════════

  function setupGameState() {
    // ★ 새 시나리오 — 처음엔 장군 1명만. 시나리오 진행 중 유닛이 합류한다.
    S.pieces = [{
      id: 'me-general',
      owner: 'me', char: CHARS.general,
      icon: CHARS.general.icon, name: CHARS.general.name, tier: CHARS.general.tier, atk: CHARS.general.atk,
      col: 2, row: 4,    // C5 (가운데 아래)
      hp: 5, maxHp: 5,
      alive: true, hidden: false,
    }];
    S.turn = 1; S.whose = 'me';
    S.spMy = 1; S.spOpp = 1;
    S.deductionTokens = [];
    S.logEntries = [];
    S.visibleOppIds = new Set();
  }

  // ★ 새 helper — 시나리오 중간에 piece 등장 (페이드인 글로우 애니메이션)
  function spawnPiece(opts) {
    const pc = {
      id: opts.id,
      owner: opts.owner, char: opts.char,
      icon: opts.char.icon, name: opts.char.name, tier: opts.char.tier, atk: opts.char.atk,
      col: opts.col, row: opts.row,
      hp: opts.hp || opts.char.baseHp, maxHp: opts.maxHp || opts.hp || opts.char.baseHp,
      alive: true, hidden: !!opts.hidden,
    };
    S.pieces.push(pc);
    if (opts.owner === 'opp') S.visibleOppIds.add(pc.id);
    updateUI();
    // 등장 셀에 fade-in glow
    const cell = document.querySelector(boardCellSel(pc.col, pc.row));
    if (cell) {
      const marker = cell.querySelector('.piece-marker');
      if (marker) {
        marker.classList.add('tut-piece-spawn');
        setTimeout(() => marker.classList.remove('tut-piece-spawn'), 900);
      }
    }
    return pc;
  }
  // 회복 — 약초전문가 스킬
  function healPiece(pieceId, amount) {
    const pc = S.pieces.find(p => p.id === pieceId);
    if (!pc) return;
    pc.hp = Math.min(pc.maxHp, pc.hp + amount);
    updateUI();
    // 회복 시각 효과 — 셀에 녹색 펄스
    const cell = document.querySelector(boardCellSel(pc.col, pc.row));
    if (cell) {
      cell.classList.add('tut-heal-flash');
      setTimeout(() => cell.classList.remove('tut-heal-flash'), 800);
    }
  }
  // 보드 외곽 파괴 — 외곽 셀의 piece 탈락
  function destroyOuterRingPieces() {
    const dead = [];
    for (const p of S.pieces) {
      if (!p.alive) continue;
      const outer = (p.col === 0 || p.col === 4 || p.row === 0 || p.row === 4);
      if (outer) {
        p.alive = false;
        p.col = -1; p.row = -1;
        dead.push(p);
      }
    }
    return dead;
  }

  function findPiece(id) { return S.pieces.find(p => p.id === id); }
  function findMyPiece(col, row) {
    return S.pieces.find(p => p.owner === 'me' && p.col === col && p.row === row && p.alive);
  }
  function boardCellSel(col, row) {
    return `${SCOPE} #tut-game-board .cell[data-col="${col}"][data-row="${row}"]`;
  }

  // ── 로그 ─────────────────────────────────────────────────────────────────
  function addLog(text, type) {
    S.logEntries.push({ text, type: type || '' });
    const logEl = document.getElementById('tut-game-log');
    if (logEl) {
      const div = document.createElement('div');
      div.className = `log-entry ${type || ''}`;
      div.textContent = text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function flashLogPanel() {
    const w = document.querySelector(`${SCOPE} .center-log-wrap`);
    if (!w) return;
    w.classList.remove('flash-once');
    void w.offsetWidth;
    w.classList.add('flash-once');
  }

  // ── UI 렌더 ──────────────────────────────────────────────────────────────
  function updateUI() {
    renderBoard();
    renderCards();
    const banner = document.getElementById('tut-turn-banner');
    if (banner) {
      banner.textContent = `${S.turn}턴 : ${S.whose === 'me' ? '내 차례' : '상대 차례'}`;
      banner.classList.toggle('opp-turn', S.whose === 'opp');
    }
    const smy = document.getElementById('tut-sp-my-num'); if (smy) smy.textContent = S.spMy;
    const sop = document.getElementById('tut-sp-opp-num'); if (sop) sop.textContent = S.spOpp;
    // ★ 인게임 _syncSpFillBars 와 동일 — 양 측의 비율로 채움.
    //   total = leftSP + rightSP. fill = (sp / total) * 100%.
    const fmy = document.getElementById('tut-sp-my-fill');
    const fop = document.getElementById('tut-sp-opp-fill');
    if (fmy && fop) {
      const total = (S.spMy + S.spOpp) || 1;
      fmy.style.width = `${(S.spMy / total) * 100}%`;
      fop.style.width = `${(S.spOpp / total) * 100}%`;
    }
    // SP 카운트다운 — 인게임 형식
    const cd = document.querySelector(`${SCOPE} .sp-countdown`);
    if (cd) {
      if (S.turn >= 40) cd.textContent = 'SP 지급 종료';
      else {
        const left = 10 - (S.turn % 10 || 10);
        cd.textContent = `다음 SP 지급까지 ${left === 0 ? 10 : left}턴`;
      }
    }
  }

  function renderBoard() {
    const board = document.getElementById('tut-game-board');
    if (!board) return;
    board.innerHTML = '';
    // 지휘관 위치 — 사기증진 morale-zone 표시용
    const commanderPc = S.pieces.find(p => p.alive && p.owner === 'me' && p.char && p.char.type === 'commander');
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.col = c; cell.dataset.row = r;
        const lbl = document.createElement('span');
        lbl.className = 'coord-label';
        lbl.textContent = `${COLS[c]}${r+1}`;
        cell.appendChild(lbl);
        // ★ 사기증진 morale-zone 표시 — 인게임과 동일 클래스
        if (commanderPc) {
          const dc = c - commanderPc.col;
          const dr = r - commanderPc.row;
          if (dc === 0 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-zone-center');
          } else if (dc === 0 && dr === -1) {
            // 셀이 지휘관 위 → 셀 *남쪽* (지휘관 측) 가장 밝음
            cell.classList.add('morale-zone', 'morale-from-s');
          } else if (dc === 0 && dr === 1) {
            cell.classList.add('morale-zone', 'morale-from-n');
          } else if (dc === -1 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-from-e');
          } else if (dc === 1 && dr === 0) {
            cell.classList.add('morale-zone', 'morale-from-w');
          }
        }
        // piece 표시 (안개 가린 opp 는 안 보임)
        const pc = S.pieces.find(p => p.alive && p.col === c && p.row === r && !(p.owner === 'opp' && p.hidden));
        if (pc) {
          const marker = document.createElement('div');
          marker.className = 'piece-marker' + (pc.owner === 'opp' ? ' opp-piece' : '');
          // ★ 사기증진 버프 받는 아군 (인접 셀, 지휘관 본인 제외) 에 morale-buffed 청록 글로우
          if (commanderPc && pc.owner === 'me' && pc !== commanderPc && cell.classList.contains('morale-zone') && !cell.classList.contains('morale-zone-center')) {
            marker.classList.add('morale-buffed');
          }
          marker.innerHTML = `<span class="p-icon">${pc.icon}</span><span class="p-hp">${pc.hp}/${pc.maxHp}</span>`;
          cell.classList.add('has-piece');
          cell.appendChild(marker);
        }
        // ★ morale-zone non-center 셀에 아군 piece 가 있으면 — 청록 파티클 5개 (인게임과 동일)
        if (commanderPc && cell.classList.contains('morale-zone') && !cell.classList.contains('morale-zone-center') && pc && pc.owner === 'me') {
          const sparkleChars = ['✦','✧','✦','✨','✧'];
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
        // ★ 추리 토큰 — 인게임 동일: 셀 좌하단에 적 아이콘 작은 박스로 표시
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
  }

  function renderCards() {
    const myCont = document.getElementById('tut-my-pieces-info');
    if (myCont) {
      const my = S.pieces.filter(p => p.owner === 'me');
      myCont.innerHTML = my.map(buildMyCardHTML).join('');
    }
    const oppCont = document.getElementById('tut-opp-pieces-info');
    if (oppCont) {
      // ★ 시나리오 진행에 따라 등장한 opp 만 카드 노출 (visibleOppIds)
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
          <span class="my-piece-pos">${pc.alive ? `${COLS[pc.col]}${pc.row+1}` : '격파됨'}</span>
        </div>
      </div>`;
  }
  function buildOppCardHTML(pc) {
    const hpPct = pc.alive ? (pc.hp / pc.maxHp) * 100 : 0;
    const deadCls = pc.alive ? '' : ' card-dead';
    // 인게임과 동일 — 추리 토큰이 보드 셀에 놓였으면 카드에 📌좌표 배지.
    const token = (S.deductionTokens || []).find(t => t.pieceKey === pc.id);
    let badgeHTML = '';
    if (token) {
      badgeHTML = `<span class="deduction-badge">📌${COLS[token.col]}${token.row+1}</span>`;
    }
    const posLabel = !pc.alive ? '격파됨'
      : (pc.hidden ? '🌫 위치 불명' : `${COLS[pc.col]}${pc.row+1}`);
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

  // SP 지급 ceremony — 실제 인게임 playSpGrantAnimation 과 동일한 마법구 궤도 + 흡수 애니메이션.
  //   인게임 함수는 #sp-grant-overlay (실제 게임 화면 내부) + #sp-my-num/#sp-opp-num 을 고정 ID 로 참조.
  //   튜토리얼에서는 그 함수를 직접 호출할 수 없으므로 — 같은 시각 효과를 tut- 프리픽스로 재현.
  async function playSpGrantCeremony() {
    // 풀스크린 오버레이 + 텍스트 박스 + 좌·우 마법구
    // ★ 실제 인게임 .sp-grant-overlay / .sp-grant-orb / .sp-grant-text 클래스를 그대로 사용
    //   → CSS·시각 효과 100% 동일.
    const overlay = document.createElement('div');
    overlay.id = 'tut-sp-grant-overlay';
    overlay.className = 'sp-grant-overlay tut-sp-grant-wrap';
    overlay.innerHTML = `
      <div class="sp-grant-content">
        <div class="sp-grant-text">
          <div class="sp-grant-title">SP 지급</div>
          <div class="sp-grant-sub">새로운 SP가 지급되었습니다</div>
        </div>
      </div>
      <div class="sp-grant-orb sp-grant-orb-left" id="tut-sp-grant-orb-left"></div>
      <div class="sp-grant-orb sp-grant-orb-right" id="tut-sp-grant-orb-right"></div>`;
    document.body.appendChild(overlay);
    // 실제 .sp-grant-overlay 는 turn-overlay-fade-in 1s 애니메이션이 자동 — show 추가 불필요

    const orbL = overlay.querySelector('#tut-sp-grant-orb-left');
    const orbR = overlay.querySelector('#tut-sp-grant-orb-right');
    const textBox = overlay.querySelector('.sp-grant-text');

    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2, cy = H / 2;
    const orbitR = 130;
    const tEntryEnd = 0.20;
    const tOrbitEnd = 0.78;
    const TOTAL_MS = 2400;
    const angleEntrySweep = Math.PI;
    const angleOrbits = Math.PI * 4;
    const angleDispatchSweep = Math.PI * 0.5;
    const totalAngleSweep = angleEntrySweep + angleOrbits + angleDispatchSweep;

    const myNumEl = document.getElementById('tut-sp-my-num');
    const oppNumEl = document.getElementById('tut-sp-opp-num');
    const oldMyNum = S.spMy, oldOppNum = S.spOpp;
    const finalMyNum = Math.min(10, oldMyNum + 1), finalOppNum = Math.min(10, oldOppNum + 1);
    let myAbsorbed = false, oppAbsorbed = false;

    function setOrbPos(el, x, y) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
    function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

    setOrbPos(orbL, cx - W * 0.6, cy);
    setOrbPos(orbR, cx + W * 0.6, cy);
    orbL.style.opacity = '0';
    orbR.style.opacity = '0';

    // 트레일 dust — 인게임 .sp-dust .sp-dust-grant-l/r 클래스 그대로
    const trailIv = setInterval(() => {
      [[orbL, 'sp-dust-grant-l'], [orbR, 'sp-dust-grant-r']].forEach(([orb, cls]) => {
        if (orb.style.opacity === '0' || orb.style.opacity === '') return;
        const r = orb.getBoundingClientRect();
        for (let k = 0; k < 2; k++) {
          const dust = document.createElement('div');
          dust.className = 'sp-dust ' + cls;
          if (k === 1) dust.style.transform = 'translate(-50%, -50%) scale(0.55)';
          dust.style.left = (r.left + r.width / 2 + (Math.random() - 0.5) * 8) + 'px';
          dust.style.top = (r.top + r.height / 2 + (Math.random() - 0.5) * 8) + 'px';
          document.body.appendChild(dust);
          setTimeout(() => dust.remove(), 700);
        }
      });
    }, 28);

    const t0 = performance.now();
    let resolve;
    const done = new Promise(r => { resolve = r; });

    function frame() {
      const elapsed = performance.now() - t0;
      const t = Math.min(1, elapsed / TOTAL_MS);
      const eAngle = easeInOutCubic(t);
      const angle = eAngle * totalAngleSweep;

      let radius;
      if (t < tEntryEnd) {
        const tt = t / tEntryEnd;
        radius = W * 0.6 + (orbitR - W * 0.6) * easeInOutCubic(tt);
        orbL.style.opacity = String(0.2 + 0.8 * tt);
        orbR.style.opacity = String(0.2 + 0.8 * tt);
      } else if (t < tOrbitEnd) {
        radius = orbitR;
        orbL.style.opacity = '1';
        orbR.style.opacity = '1';
        if (!textBox.classList.contains('show')) textBox.classList.add('show');
      } else {
        // 분리 비행 — 각 SP 숫자로 흡수
        radius = orbitR;
        const myRect = myNumEl?.getBoundingClientRect();
        const oppRect = oppNumEl?.getBoundingClientRect();
        if (myRect && oppRect) {
          const ttl = (t - tOrbitEnd) / (1 - tOrbitEnd);
          const targetLx = myRect.left + myRect.width / 2;
          const targetLy = myRect.top + myRect.height / 2;
          const targetRx = oppRect.left + oppRect.width / 2;
          const targetRy = oppRect.top + oppRect.height / 2;
          // 궤도에서 떼어내 직선 비행
          const orbitLx = cx + Math.cos(Math.PI + angle) * orbitR;
          const orbitLy = cy + Math.sin(Math.PI + angle) * orbitR;
          const orbitRx = cx + Math.cos(0 + angle) * orbitR;
          const orbitRy = cy + Math.sin(0 + angle) * orbitR;
          const lx = orbitLx + (targetLx - orbitLx) * ttl;
          const ly = orbitLy + (targetLy - orbitLy) * ttl;
          const rx = orbitRx + (targetRx - orbitRx) * ttl;
          const ry = orbitRy + (targetRy - orbitRy) * ttl;
          setOrbPos(orbL, lx, ly);
          setOrbPos(orbR, rx, ry);
          // 흡수 임계점
          if (!myAbsorbed && ttl > 0.85) {
            myAbsorbed = true;
            S.spMy = finalMyNum;
            if (myNumEl) {
              myNumEl.textContent = String(finalMyNum);
              myNumEl.classList.add('sp-bump');
              setTimeout(() => myNumEl.classList.remove('sp-bump'), 500);
            }
            // SP fill bar sync
            const fmy = document.getElementById('tut-sp-my-fill');
            const fop = document.getElementById('tut-sp-opp-fill');
            const total = (S.spMy + S.spOpp) || 1;
            if (fmy) fmy.style.width = `${(S.spMy / total) * 100}%`;
            if (fop) fop.style.width = `${(S.spOpp / total) * 100}%`;
          }
          if (!oppAbsorbed && ttl > 0.85) {
            oppAbsorbed = true;
            S.spOpp = finalOppNum;
            if (oppNumEl) {
              oppNumEl.textContent = String(finalOppNum);
              oppNumEl.classList.add('sp-bump');
              setTimeout(() => oppNumEl.classList.remove('sp-bump'), 500);
            }
            const fmy = document.getElementById('tut-sp-my-fill');
            const fop = document.getElementById('tut-sp-opp-fill');
            const total = (S.spMy + S.spOpp) || 1;
            if (fmy) fmy.style.width = `${(S.spMy / total) * 100}%`;
            if (fop) fop.style.width = `${(S.spOpp / total) * 100}%`;
          }
          if (ttl >= 1) {
            orbL.style.opacity = '0';
            orbR.style.opacity = '0';
          }
        }
        if (t >= 1) {
          clearInterval(trailIv);
          // 실제 게임의 fade-out 시퀀스: .fading-out 추가
          overlay.classList.add('fading-out');
          setTimeout(() => { overlay.remove(); resolve(); }, 1000);
          return;
        }
      }

      // 궤도 phase 동안 — 좌우 마법구 위치 갱신
      if (t < tOrbitEnd) {
        const lAng = Math.PI + angle;
        const rAng = 0 + angle;
        setOrbPos(orbL, cx + Math.cos(lAng) * radius, cy + Math.sin(lAng) * radius);
        setOrbPos(orbR, cx + Math.cos(rAng) * radius, cy + Math.sin(rAng) * radius);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    addLog('새로운 SP가 지급되었습니다', 'event');
    await done;
  }

  // 보드 축소 경고 — 카운트다운 박스 + 풀스크린 인트로
  async function playShrinkWarningSummary() {
    // 풀스크린 인트로
    const intro = document.createElement('div');
    intro.className = 'tut-shrink-intro';
    intro.innerHTML = `
      <div class="tut-shrink-intro-content">
        <div class="tut-shrink-intro-title">🔥 보드 파괴 시작</div>
        <div class="tut-shrink-intro-sub">안쪽으로 대피하세요.</div>
      </div>`;
    document.body.appendChild(intro);
    await sleep(80);
    intro.classList.add('show');
    await sleep(1800);
    intro.classList.remove('show');
    intro.classList.add('hide');
    await sleep(500);
    intro.remove();
    // 경고 박스 — sp-section 안에 카운트다운
    const cont = document.querySelector(`${SCOPE} #shrink-warning-container`);
    if (cont) {
      cont.innerHTML = `<div class="tut-shrink-warning-box">외곽 파괴까지 <strong>3</strong>턴</div>`;
    }
    await sleep(800);
  }
  // 보드 축소 실행 — 외곽 셀 빨갛게 → 점선 → 사라짐
  async function playBoardShrinkSummary() {
    const board = document.getElementById('tut-game-board');
    if (!board) return;
    const outer = [];
    board.querySelectorAll('.cell').forEach(cell => {
      const c = parseInt(cell.dataset.col, 10);
      const r = parseInt(cell.dataset.row, 10);
      if (c === 0 || c === 4 || r === 0 || r === 4) outer.push(cell);
    });
    // 빨갛게 점멸
    outer.forEach(cell => cell.classList.add('tut-shrink-burning'));
    addLog('🔥 보드 외곽 파괴', 'event');
    await sleep(1500);
    // 외곽 셀 visually destroyed
    outer.forEach(cell => cell.classList.add('tut-shrink-destroyed'));
    // 외곽 piece-marker 페이드 아웃
    outer.forEach(cell => {
      const mk = cell.querySelector('.piece-marker');
      if (mk) { mk.style.transition = 'opacity 0.5s'; mk.style.opacity = '0'; }
    });
    await sleep(1200);
    // 경고 박스 제거
    const cont = document.querySelector(`${SCOPE} #shrink-warning-container`);
    if (cont) cont.innerHTML = '';
  }


  async function animatePieceSlide(piece, toCol, toRow, dur) {
    if (!piece) { piece = null; }
    const board = document.getElementById('tut-game-board');
    if (!board || !piece) return;
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
      left:${fr.left + fr.width/2}px; top:${fr.top + fr.height/2}px;
      transform:translate(-50%,-50%);
      transition: left ${dur}ms cubic-bezier(0.4,0,0.2,1), top ${dur}ms cubic-bezier(0.4,0,0.2,1);
      filter: drop-shadow(0 0 8px rgba(82,183,136,0.85));`;
    document.body.appendChild(sprite);
    // 원래 piece 셀의 marker 숨김
    const origMarker = fromCell.querySelector('.piece-marker');
    if (origMarker) origMarker.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      sprite.style.left = `${tr.left + tr.width/2}px`;
      sprite.style.top = `${tr.top + tr.height/2}px`;
    });
    await sleep(dur + 50);
    sprite.remove();
    piece.col = toCol; piece.row = toRow;
    updateUI();
  }

  async function animateAttackOnCell(col, row) {
    const cellSel = boardCellSel(col, row);
    const cell = document.querySelector(cellSel);
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

  // ── 부채꼴 메뉴 (인게임 .radial-action-menu 구조 그대로) ───────────────────
  //   piece 클릭 시 등장. 이동·공격·스킬 3 버튼이 fan 형태로 배치.
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
    // ★ 일부 환경에서 .radial-action-menu 가 position:relative 로 계산되는 버그 회피 — 인라인 스타일 강제
    menu.style.position = 'fixed';
    menu.style.inset = '0';
    menu.style.zIndex = '9200';
    menu.style.pointerEvents = 'none';

    opts = opts || {};
    // 어떤 버튼을 활성/비활성 — 시나리오 의도에 따라.
    const items = [
      { angle: -135, key: 'move',   icon: '🏃', label: '이동',   disabled: !!opts.moveDisabled },
      { angle:  -90, key: 'attack', icon: '⚔',  label: '공격',   disabled: !!opts.attackDisabled },
      { angle:  -45, key: 'skill',  icon: '✨',  label: '스킬',   disabled: !!opts.skillDisabled, hideIfMissing: !!opts.hideSkill },
    ].filter(it => !it.hideIfMissing);

    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'radial-btn';
      btn.dataset.key = it.key;
      btn.dataset.tutRadialKey = it.key;   // 시나리오 anchor 용 식별자
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

  function highlightMoveTargets(col, row) {
    const deltas = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dc, dr] of deltas) {
      const c = col + dc, r = row + dr;
      if (c < 0 || c > 4 || r < 0 || r > 4) continue;
      const occupied = S.pieces.find(p => p.alive && p.owner === 'me' && p.col === c && p.row === r);
      if (occupied) continue;
      const cell = document.querySelector(boardCellSel(c, r));
      if (cell) cell.classList.add('tut-move-target');
    }
  }
  function highlightAttackTargetsGeneral(col, row) {
    // 장군 사거리 — 십자 + 자기
    const offsets = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dc, dr] of offsets) {
      const c = col + dc, r = row + dr;
      if (c < 0 || c > 4 || r < 0 || r > 4) continue;
      const cell = document.querySelector(boardCellSel(c, r));
      if (cell) cell.classList.add('tut-attack-target');
    }
  }
  function clearMoveHighlights() {
    document.querySelectorAll(`${SCOPE} .cell.tut-move-target, ${SCOPE} .cell.tut-attack-target`)
      .forEach(c => c.classList.remove('tut-move-target', 'tut-attack-target'));
  }

  // ── reveal 시퀀스 ─────────────────────────────────────────────────────────
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

  // ── phase 컨테이너 (draft/hp/placement 전용) ─────────────────────────────
  //   실제 인게임 화면 (screen-draft, screen-hp, screen-placement) 와 동일 CSS 클래스 사용
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

    // ★ 새 시나리오 — draft/HP/placement 페이즈 폐기. 아래 분기는 deprecated.
    return;
    cont.classList.add('active', 'tut-mimic-real');

    if (phase.startsWith('draft-')) {
      const tier = phase.split('-')[1]; // t1/t2/t3
      const tierNum = parseInt(tier.slice(1), 10);
      const draft = DRAFT[tier];
      const correctChar = draft.options[draft.correctIdx];

      // ★ 실제 인게임 #screen-draft DOM 구조 그대로 복제 (ID는 tut- 프리픽스).
      //   populateSlideContent(c, 'tut') 호출로 in-game 함수가 직접 채움.
      const layout = document.createElement('div');
      layout.className = 'draft-layout';
      layout.innerHTML = `
        <div class="draft-main">
          <div id="tut-draft-step-indicator" class="step-indicator">
            <span class="step ${tierNum===1?'active':(tierNum>1?'done':'')}">1티어</span>
            <span class="step-arrow">→</span>
            <span class="step ${tierNum===2?'active':(tierNum>2?'done':'')}">2티어</span>
            <span class="step-arrow">→</span>
            <span class="step ${tierNum===3?'active':''}">3티어</span>
          </div>
          <div class="draft-viewer-wrap">
            <div id="tut-draft-icon-index" class="draft-icon-index"></div>
            <div class="slide-viewer">
              <button class="slide-arrow slide-arrow-left tut-disabled-arrow" disabled>‹</button>
              <div class="slide-content">
                <div class="slide-top-row">
                  <div class="slide-left-col">
                    <span id="tut-icon" class="slide-icon-large"></span>
                    <div class="slide-info-col">
                      <div id="tut-name" class="slide-name"></div>
                      <div class="slide-atk-row">
                        <div id="tut-atk" class="slide-atk"></div>
                        <div id="tut-mini-headers" class="slide-mini-headers"></div>
                      </div>
                      <div id="tut-flavor" class="slide-flavor"></div>
                      <div id="tut-stat-radar" class="slide-stat-radar"></div>
                      <div id="tut-desc" class="slide-desc hidden"></div>
                    </div>
                  </div>
                  <div class="slide-right-col">
                    <div class="slide-preview-tabs">
                      <button class="slide-preview-tab active" data-mode="attack">공격 범위</button>
                      <button class="slide-preview-tab tut-disabled-tab" data-mode="skill" disabled>스킬 미리보기</button>
                    </div>
                    <div id="tut-draft-preview-board" class="board preview-board"></div>
                    <div id="tut-draft-preview-info" class="draft-preview-info"></div>
                  </div>
                </div>
                <div class="slide-skill-box">
                  <div id="tut-detail-blocks"></div>
                  <div id="tut-detail-body" class="slide-detail-body"></div>
                </div>
                <button id="tut-btn-draft-select" class="btn btn-accent btn-select-char">캐릭터 선택</button>
              </div>
              <button class="slide-arrow slide-arrow-right tut-disabled-arrow" disabled>›</button>
            </div>
          </div>
          <div class="slide-pager"></div>
        </div>
        <div class="draft-sidebar">
          <h3 class="sidebar-title">내 조합</h3>
        </div>`;
      cont.appendChild(layout);

      // 사이드바 슬롯 채우기 (실제 구조)
      const sidebar = layout.querySelector('.draft-sidebar');
      [1,2,3].forEach(t => {
        const tierKey = 't' + t;
        const picked = S.drafted[tierKey];
        const slot = document.createElement('div');
        slot.className = 'draft-slot ' + (picked ? 'filled' : 'empty');
        if (t === tierNum && !picked) slot.classList.add('tut-active-slot');
        slot.dataset.tier = t;
        if (picked) {
          slot.innerHTML = `
            <span class="slot-icon">${picked.icon}</span>
            <div class="slot-info">
              <div class="slot-name">${picked.name}</div>
              <div class="slot-stats">${t}티어 · ATK ${picked.atk}</div>
            </div>`;
        } else {
          slot.innerHTML = `
            <span class="slot-tier">${t}티어</span>
            <span class="slot-empty-text">미선택</span>`;
        }
        sidebar.appendChild(slot);
      });
      const cntDone = Object.values(S.drafted).filter(Boolean).length;
      const btnRow = document.createElement('div');
      btnRow.className = 'draft-sidebar-btns';
      btnRow.innerHTML = `
        <button class="btn btn-primary" disabled>선택 확정 (${cntDone}/3)</button>
        <div class="draft-sub-btns">
          <button class="btn btn-random-sm" disabled>🎲 랜덤</button>
          <button class="btn btn-recommend-sm" disabled>💡 추천</button>
        </div>`;
      sidebar.appendChild(btnRow);

      // ★ 실제 게임 함수로 캐릭터 정보 채우기
      const charData = buildFullCharData(correctChar);
      try {
        if (typeof window.populateSlideContent === 'function') {
          window.populateSlideContent(charData, 'tut');
        }
      } catch (e) { console.error('[tut] populateSlideContent', e); }
      // 공격 범위 보드 — 실제 5×5 보드 렌더링
      try {
        if (typeof window.updateDraftPreview === 'function') {
          // updateDraftPreview 가 고정 ID '#draft-preview-board' 를 보므로 임시 alias.
          const realPreview = document.getElementById('draft-preview-board');
          const tutPreview = document.getElementById('tut-draft-preview-board');
          // realPreview 가 hidden 상태이므로 직접 tut 컨테이너에 렌더 — 간단히 cell 격자 만들기.
          renderTutDraftPreviewBoard(tutPreview, correctChar);
        } else {
          renderTutDraftPreviewBoard(document.getElementById('tut-draft-preview-board'), correctChar);
        }
      } catch (e) {
        renderTutDraftPreviewBoard(document.getElementById('tut-draft-preview-board'), correctChar);
      }

    } else if (phase === 'hp') {
      // ★ 실제 #screen-hp .hp-container 구조 그대로
      const container = document.createElement('div');
      container.className = 'hp-container';
      container.innerHTML = `
        <h2>HP 분배 페이즈</h2>
        <p class="muted">총 <strong>10 HP</strong>를 말에 분배하세요 각 최소 1, 최대 8</p>
        <div id="tut-hp-pieces"></div>
        <div class="hp-total-bar" aria-hidden="true">
          남은 HP: <span id="tut-hp-remaining">0</span> / 10
        </div>
        <button id="tut-btn-hp-confirm" class="btn btn-primary">확정</button>
        <p class="error-msg"></p>`;
      cont.appendChild(container);
      const piecesHost = container.querySelector('#tut-hp-pieces');
      const rows = document.createElement('div');
      rows.className = 'hp-piece-rows';
      const tierLabels = ['1티어', '2티어', '3티어'];
      ['t1','t2','t3'].forEach((tier, i) => {
        const pc = S.drafted[tier];
        if (!pc) return;
        const row = document.createElement('div');
        row.className = 'hp-piece-row';
        row.dataset.tier = tier;
        row.innerHTML = `
          <span class="char-icon">${pc.icon}</span>
          <div class="hp-piece-label">
            <strong>${pc.name}</strong>
            <span>${tierLabels[i]}</span>
          </div>
          <div class="hp-input-group">
            <button class="hp-btn" disabled data-delta="-1">−</button>
            <span class="hp-value">${HP_PRESET[tier]}</span>
            <button class="hp-btn" disabled data-delta="1">+</button>
          </div>`;
        rows.appendChild(row);
      });
      piecesHost.appendChild(rows);
    } else if (phase.startsWith('place-')) {
      const idx = parseInt(phase.split('-')[1], 10) - 1;
      const target = PLACE_PRESET[idx];
      const targetPc = S.drafted[target.tier];
      // 실제 .placement-layout 구조 그대로
      const container = document.createElement('div');
      container.className = 'placement-container tut-placement-container';
      container.innerHTML = `
        <h2>말 배치 페이즈</h2>
        <p class="muted">말을 선택 후 보드에서 위치를 클릭하세요 (겹치기 불가)</p>`;
      const layout = document.createElement('div');
      layout.className = 'placement-layout tut-placement-layout';
      // 좌: piece-list
      const left = document.createElement('div');
      const list = document.createElement('div');
      list.className = 'piece-list tut-piece-list';
      ['t1','t2','t3'].forEach((tier, i) => {
        const pc = S.drafted[tier];
        const placedAlready = PLACE_PRESET.slice(0, idx).some(p => p.tier === tier);
        const isCurrent = (tier === target.tier);
        const item = document.createElement('div');
        item.className = 'tut-place-piece-item'
          + (placedAlready ? ' placed' : '')
          + (isCurrent ? ' selected' : '');
        item.innerHTML = `
          <span class="hp-piece-icon">${pc.icon}</span>
          <strong>${pc.name}</strong>
          <span class="tut-tier-badge">${i+1}T · HP ${pc.maxHp}</span>
          ${placedAlready ? '<span class="tut-placed-badge">✓ 배치됨</span>' : ''}`;
        list.appendChild(item);
      });
      left.appendChild(list);
      layout.appendChild(left);
      // 중: board
      const boardWrap = document.createElement('div');
      boardWrap.className = 'placement-board-wrap';
      const board = document.createElement('div');
      board.className = 'board tut-placement-board';
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.col = c; cell.dataset.row = r;
          const lbl = document.createElement('span');
          lbl.className = 'coord-label';
          lbl.textContent = `${COLS[c]}${r+1}`;
          cell.appendChild(lbl);
          const placed = PLACE_PRESET.slice(0, idx).find(p => p.col === c && p.row === r);
          if (placed) {
            const pc = S.drafted[placed.tier];
            const marker = document.createElement('div');
            marker.className = 'piece-marker';
            marker.innerHTML = `<span class="p-icon">${pc.icon}</span><span class="p-hp">${pc.hp || pc.maxHp}/${pc.maxHp}</span>`;
            cell.appendChild(marker);
            cell.classList.add('has-piece');
          }
          if (c === target.col && r === target.row && !placed) {
            cell.classList.add('tut-target-cell');
          }
          board.appendChild(cell);
        }
      }
      boardWrap.appendChild(board);
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn btn-primary placement-confirm-btn';
      confirmBtn.textContent = '배치 확정';
      confirmBtn.disabled = true;
      boardWrap.appendChild(confirmBtn);
      layout.appendChild(boardWrap);
      // 우: opp panel
      const oppPanel = document.createElement('div');
      oppPanel.className = 'placement-opp-panel tut-placement-opp';
      oppPanel.innerHTML = '<h4>상대방 캐릭터</h4>';
      const oppPieces = document.createElement('div');
      OPP_INIT.forEach(o => {
        const ch = o.char;
        const pc = document.createElement('div');
        pc.className = 'tut-opp-place-piece';
        pc.innerHTML = `<span class="hp-piece-icon">${ch.icon}</span> <strong>${ch.name}</strong> <span class="tut-tier-badge">${ch.tier}T</span>`;
        oppPieces.appendChild(pc);
      });
      oppPanel.appendChild(oppPieces);
      layout.appendChild(oppPanel);

      container.appendChild(layout);
      cont.appendChild(container);
    }
  }

  // 인게임 캐릭터 객체 형식으로 변환 (populateSlideContent 가 기대하는 shape)
  function buildFullCharData(c) {
    const detail = CHAR_DETAILS[c.type] || {};
    return {
      type: c.type,
      icon: c.icon,
      name: c.name,
      atk: c.atk,
      tier: c.tier,
      tag: null,    // (인게임 character.tag 필드 — 캐릭터 자체에는 없을 수 있음)
      desc: detail.skillBody || '',
      skills: detail.skillLabel ? [{ name: detail.skillLabel, cost: detail.sp || 0 }] : [],
    };
  }

  // 실제 인게임 5×5 미리보기 보드 — updateDraftPreview 와 동일 시각화 (자기 중앙 + attack-range)
  function renderTutDraftPreviewBoard(host, charObj) {
    if (!host) return;
    host.innerHTML = '';
    // 5×5 cells
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.col = c; cell.dataset.row = r;
        host.appendChild(cell);
      }
    }
    const centerCol = 2, centerRow = 2;
    // 공격 범위 — 실제 게임 함수 호출
    let range;
    try {
      if (typeof window.getAttackCells === 'function') {
        range = window.getAttackCells(charObj.type, centerCol, centerRow) || [];
      } else range = [];
    } catch (e) { range = []; }
    const rangeSet = new Set(range.map(c => `${c.col},${c.row}`));
    host.querySelectorAll('.cell').forEach(cell => {
      const col = parseInt(cell.dataset.col);
      const row = parseInt(cell.dataset.row);
      if (col === centerCol && row === centerRow) {
        cell.innerHTML = `<span style="font-size:1.1rem">${charObj.icon}</span>`;
        cell.classList.add('has-piece');
      }
      if (rangeSet.has(`${col},${row}`)) cell.classList.add('attack-range');
    });
  }
  // 보드에 실제 공격 범위를 시각적으로 표시 (좌표 나열 대체).
  // 자신 셀이 col,row 일 때 사거리 안의 셀들을 .tut-range-hilite 로 강조.
  function highlightRangeOnBoard(charType, col, row, hiliteClass = 'tut-range-hilite') {
    clearRangeHighlight();
    let range;
    try {
      if (typeof window.getAttackCells === 'function') {
        range = window.getAttackCells(charType, col, row) || [];
      } else range = [];
    } catch (e) { return; }
    for (const c of range) {
      const cell = document.querySelector(boardCellSel(c.col, c.row));
      if (cell) cell.classList.add(hiliteClass);
    }
  }
  function clearRangeHighlight() {
    document.querySelectorAll(`${SCOPE} .cell.tut-range-hilite, ${SCOPE} .cell.tut-range-attacker`)
      .forEach(c => c.classList.remove('tut-range-hilite', 'tut-range-attacker'));
  }

  // 캐릭터 상세 — 스킬/패시브 설명 + flavor
  const CHAR_DETAILS = {
    scout: {
      flavor: '안개 너머 숨어있는 적의 정보를 수집한다. 정보는 칼보다 날카로운 법.',
      skillLabel: '🔭 정찰',
      skillTag: '자유시전형',
      sp: 2,
      skillBody: '스킬 사용 시 상대 말 1개의 행 또는 열을 알아낼 수 있습니다.',
    },
    spearman: {
      flavor: '한 줄로 모든 적을 꿰뚫는 긴 창의 명수.',
      skillLabel: '스킬 없음',
      skillBody: '공격 범위 — 자신이 있는 세로줄 전체.',
    },
    cavalry: {
      flavor: '말발굽으로 가로지르는 기마병. 한 줄 단위로 적을 짓밟는다.',
      skillLabel: '스킬 없음',
      skillBody: '공격 범위 — 자신이 있는 가로줄 전체.',
    },
    bodyguard: {
      flavor: '주군의 그림자. 충성으로 죽음마저 대신 받는다.',
      skillLabel: '🛡 충성 (패시브)',
      skillBody: '인접한 아군이 피해를 받을 때 호위무사가 대신 1 피해를 받습니다.',
    },
    general: {
      flavor: '전장의 기둥. 그가 자리를 지키면 사방 어느 방향의 적도 두렵지 않다.',
      skillLabel: '스킬 없음',
      skillBody: '공격 범위 — 자신 + 상하좌우 4칸 = 십자 5칸. ATK 2 의 강타자.',
    },
    weaponSmith: {
      flavor: '망치 한 자루로 무기의 결을 바꾼다.',
      skillLabel: '⚒ 정비',
      skillTag: '자유시전형', sp: 1,
      skillBody: '공격 방향을 가로 ↔ 세로로 전환.',
    },
    commander: {
      flavor: '왕실 전투력의 핵심. 그의 함성 한 마디면 병사들의 칼 끝은 더욱 무거워진다.',
      skillLabel: '📋 사기증진 (패시브)',
      skillBody: '지휘관과 인접한 아군은 사기증진 상태가 되어 공격력이 1 상승합니다.',
    },
    monk: {
      flavor: '신성의 손길. 악인은 두려워하고 약한 자는 의지한다.',
      skillLabel: '🙏 가호 (패시브) + 🙏 신성 (스킬)',
      sp: 2,
      skillBody: '악인의 공격 피해를 0.5로 감소. 신성 스킬로 아군 1 HP 회복 + 상태이상 제거.',
    },
    dragonTamer: {
      flavor: '용을 길들이는 자. 한 번 부르면 전장의 균형이 무너진다.',
      skillLabel: '🐉 드래곤 소환',
      skillTag: '자유시전형', sp: 5,
      skillBody: '보드 위에 드래곤 1마리 소환. 드래곤은 별개 유닛으로 강력한 공격력 보유.',
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  Scene 진행
  // ─────────────────────────────────────────────────────────────────────────
  let currentPhase = 'intro';

  function clearClickGuard() {
    if (S._onClickTarget) {
      // 모든 잠재 anchor 의 .tut-require-handler 클래스 제거
      document.querySelectorAll('.tut-require-handler').forEach(el => {
        el.classList.remove('tut-require-handler');
      });
      S._onClickTarget = null;
    }
    if (S._onClick) {
      document.removeEventListener('click', S._onClick, true);
      S._onClick = null;
    }
  }
  function clearSpotlights() {
    document.querySelectorAll('.tut-spotlight').forEach(el => el.classList.remove('tut-spotlight'));
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
    bubble.style.opacity = ''; bubble.style.pointerEvents = '';
    textEl.innerHTML = text;
    // ★ 위치 — 게임 phase 에서는 전투 로그 바로 아래에 붙임.
    repositionBubble(bubble);
    // anchor resolve
    const resolved = (typeof anchorSel === 'function') ? anchorSel() : anchorSel;
    if (!resolved) { hidePointer(); return; }
    const anchor = document.querySelector(resolved);
    if (!anchor) { hidePointer(); return; }
    anchor.classList.add('tut-spotlight');
    drawPointer(anchor);
  }
  // 말풍선 위치 결정 — 전투 로그가 있으면 그 아래, 아니면 화면 하단.
  function repositionBubble(bubble) {
    const log = document.querySelector(`${SCOPE} .center-log-wrap`);
    if (log && log.offsetParent) {
      const r = log.getBoundingClientRect();
      // 로그 박스 바로 아래 — 8px gap. viewport 안쪽으로 clamp.
      const vh = window.innerHeight;
      let top = r.bottom + 8;
      // 만약 bubble 이 viewport 밖으로 나가면 살짝 위로 올림
      const bubH = bubble.getBoundingClientRect().height || 60;
      if (top + bubH > vh - 8) top = Math.max(8, vh - bubH - 8);
      bubble.style.bottom = 'auto';
      bubble.style.top = top + 'px';
    } else {
      bubble.style.top = 'auto';
      bubble.style.bottom = '16px';
    }
  }

  // ★ 하단 고정 말풍선 → 설명 대상까지 점선·화살표.
  //   말풍선 윗변 중앙에서 anchor 의 가장 가까운 가장자리까지.
  function drawPointer(anchor) {
    const svg = document.getElementById('tut-pointer-svg');
    const line = document.getElementById('tut-pointer-line');
    const bubble = document.getElementById('tut-mock-bubble');
    if (!svg || !line || !bubble || !anchor) return;
    const aRect = anchor.getBoundingClientRect();
    const bRect = bubble.getBoundingClientRect();
    // 말풍선 윗변 중앙
    const bx = bRect.left + bRect.width / 2;
    const by = bRect.top + 4;
    // anchor 중앙
    const ax = aRect.left + aRect.width / 2;
    const ay = aRect.top + aRect.height / 2;
    // anchor 가장자리 — 말풍선 방향 (위/아래) 으로 가장 가까운 점
    let endX, endY;
    if (ay > by) {
      // anchor 가 말풍선보다 아래 — anchor 윗변
      endX = ax;
      endY = aRect.top - 6;
    } else {
      // anchor 가 말풍선보다 위 — anchor 아랫변
      endX = ax;
      endY = aRect.bottom + 6;
    }
    line.setAttribute('x1', String(bx));
    line.setAttribute('y1', String(by));
    line.setAttribute('x2', String(endX));
    line.setAttribute('y2', String(endY));
    svg.classList.remove('hidden');
  }
  function hidePointer() {
    const svg = document.getElementById('tut-pointer-svg');
    if (svg) svg.classList.add('hidden');
  }

  function positionBubbleNear(anchor, bubble, sidePref) {
    const aRect = anchor.getBoundingClientRect();
    bubble.style.transform = '';
    bubble.style.left = '0px'; bubble.style.top = '0px';
    bubble.style.visibility = 'hidden';
    const meas = bubble.getBoundingClientRect();
    bubble.style.visibility = '';
    const bubW = meas.width || 340, bubH = meas.height || 200;
    // 스포트라이트 외광이 ~12px 외각으로 펴짐 → bubble 은 그것보다 더 떨어져야 함
    const SPOTLIGHT_HALO = 14;
    const gap = 18;  // anchor 와 bubble 최소 거리
    const vw = window.innerWidth, vh = window.innerHeight;
    // 확장된 anchor — 스포트라이트 외광 포함 영역
    const aHalo = {
      left:   aRect.left   - SPOTLIGHT_HALO,
      right:  aRect.right  + SPOTLIGHT_HALO,
      top:    aRect.top    - SPOTLIGHT_HALO,
      bottom: aRect.bottom + SPOTLIGHT_HALO,
      width:  aRect.width  + 2 * SPOTLIGHT_HALO,
      height: aRect.height + 2 * SPOTLIGHT_HALO,
    };
    const order = (() => {
      const opp = { right:'left', left:'right', top:'bottom', bottom:'top' };
      const first = sidePref || 'right';
      const second = opp[first] || 'left';
      const others = (first==='top'||first==='bottom') ? ['right','left'] : ['top','bottom'];
      return [first, second, ...others];
    })();
    function trySide(side) {
      let left, top;
      if (side==='right')      { left = aHalo.right+gap;             top = aRect.top+aRect.height/2-bubH/2; }
      else if (side==='left')  { left = aHalo.left-bubW-gap;         top = aRect.top+aRect.height/2-bubH/2; }
      else if (side==='top')   { left = aRect.left+aRect.width/2-bubW/2; top = aHalo.top-bubH-gap; }
      else                     { left = aRect.left+aRect.width/2-bubW/2; top = aHalo.bottom+gap; }
      const bRect = { left, top, right: left+bubW, bottom: top+bubH };
      // 화면 밖이면 fitness 매우 낮음
      const offLeft   = Math.max(0, 8 - bRect.left);
      const offRight  = Math.max(0, bRect.right - (vw - 8));
      const offTop    = Math.max(0, 8 - bRect.top);
      const offBottom = Math.max(0, bRect.bottom - (vh - 8));
      const outAmount = offLeft + offRight + offTop + offBottom;
      // halo 와 겹침 검사 (1px margin)
      const overlapsHalo = !(
        bRect.right  < aHalo.left   - 1 ||
        bRect.left   > aHalo.right  + 1 ||
        bRect.bottom < aHalo.top    - 1 ||
        bRect.top    > aHalo.bottom + 1
      );
      return { left, top, side, overlapsHalo, outAmount };
    }
    // 1순위: halo 비겹침 + 화면 내 fully fit
    let best = null, fallback = null;
    for (const s of order) {
      const r = trySide(s);
      if (!r.overlapsHalo && r.outAmount === 0) { best = r; break; }
      if (!fallback || r.outAmount < fallback.outAmount ||
          (r.outAmount === fallback.outAmount && !r.overlapsHalo && fallback.overlapsHalo)) {
        fallback = r;
      }
    }
    if (!best) best = fallback;
    // 마지막 viewport clamp
    best.left = Math.max(8, Math.min(vw - bubW - 8, best.left));
    best.top  = Math.max(8, Math.min(vh - bubH - 8, best.top));
    bubble.style.left = best.left + 'px';
    bubble.style.top = best.top + 'px';
    const tailMap = { right:'tail-left', left:'tail-right', top:'tail-bottom', bottom:'tail-top' };
    bubble.classList.add('with-tail', tailMap[best.side]);
  }

  async function loadScene() {
    clearClickGuard();
    const scene = SCENARIO[S.sceneIdx];
    if (!scene) return;
    updateProgress();

    if (scene.kind === 'enter') {
      currentPhase = scene.phase;
      if (scene.phase === 'game') {
        // 게임 layout 노출 시작 — reveal 은 다음 reveal 신에서 누적
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
      // ★ 사용자 요청: 직전 require 클릭 후 1.5초 텀 후 말풍선 등장
      const delay = S._postClickDelay || 0;
      S._postClickDelay = 0;
      // 말풍선 즉시 숨기고 (이전 신 잔상 제거)
      hideBubbleTemporarily();
      setTimeout(() => {
        // 다른 신으로 이동했을 수 있으니 현재 신 검증
        if (SCENARIO[S.sceneIdx] !== scene) return;
        showBubble(scene.text, scene.anchor || null, scene.side || null);
      }, delay);
      return;
    }

    if (scene.kind === 'require') {
      const next = document.getElementById('tut-mock-bubble-next');
      if (next) next.disabled = false;
      document.body.classList.remove('tut-no-dim');
      const delay = S._postClickDelay || 0;
      S._postClickDelay = 0;
      hideBubbleTemporarily();
      S._requirePending = scene;
      setTimeout(() => {
        if (SCENARIO[S.sceneIdx] !== scene) return;
        showBubble(scene.text, scene.anchor, scene.side || null);
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
    hidePointer();   // ★ 사용자 요청: 말풍선 사라질 때 포인터도 같이 사라짐
  }
  // require 2단계 — 말풍선 + 포인터 숨김. 스포트라이트만 더 강하게 글로우. 클릭 가드 활성.
  //   ★ 사용자 요청: 클릭 후 화면 전환·변동 시 1.5초 텀 두고 다음 말풍선 등장.
  //   pendingPostClickDelay flag 로 loadScene 의 dialog/animate 표시를 지연.
  function enterRequireWaitStage(scene) {
    const bubble = document.getElementById('tut-mock-bubble');
    if (bubble) bubble.classList.add('tut-bubble-hidden');
    hidePointer();
    document.querySelectorAll('.tut-spotlight').forEach(el => el.classList.add('tut-spotlight-strong'));
    const next = document.getElementById('tut-mock-bubble-next');
    if (next) next.disabled = true;
    const targetSel = (typeof scene.anchor === 'function') ? scene.anchor() : scene.anchor;
    requestAnimationFrame(() => {
      attachClickGuard(targetSel, (el) => {
        document.querySelectorAll('.tut-spotlight-strong').forEach(e => e.classList.remove('tut-spotlight-strong'));
        if (bubble) bubble.classList.remove('tut-bubble-hidden');
        try { if (scene.onClick) scene.onClick(el); } catch (e) { console.error(e); }
        // ★ 다음 신부터 1.5초 텀
        S._postClickDelay = 1500;
      });
    });
  }

  function attachClickGuard(targetSel, onClick) {
    if (!targetSel) return;
    const handler = (ev) => {
      // 항상 통과시킬 영역 — 나가기 / 이전 버튼 / 말풍선 자체
      if (ev.target.closest('#tut-mock-back, #tut-mock-bubble-prev, #tut-mock-bubble-next')) return;
      const t = ev.target.closest(targetSel);
      if (!t) {
        // 다른 곳 클릭 차단 + 살짝 흔들
        ev.stopPropagation(); ev.preventDefault();
        flashSpotlight();
        return;
      }
      // 정답 클릭
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
    // 잘못된 클릭 시 스포트라이트를 한 번 더 강조해 안내
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
    if (S.sceneIdx >= SCENARIO.length - 1) {
      exitTutorial();
      return;
    }
    S.sceneIdx++;
    setTimeout(loadScene, 80);
  }
  function rewind() {
    if (S.sceneIdx <= 0) return;
    // 단순 되돌리기 — 한 scene 만 뒤로 (애니메이션은 재실행 안 함)
    S.sceneIdx--;
    setTimeout(loadScene, 80);
  }

  function exitTutorial() {
    clearClickGuard();
    clearSpotlights();
    S.sceneIdx = 0;
    S.drafted = { t1:null, t2:null, t3:null };
    S.placedCount = 0;
    S.pieces = [];
    S.marks = {};
    S.logEntries = [];
    if (typeof showScreen === 'function') showScreen('screen-lobby');
  }

  function startTutorial() {
    S.sceneIdx = 0;
    S.drafted = { t1:null, t2:null, t3:null };
    S.placedCount = 0;
    S.pieces = [];
    S.marks = {};
    S.logEntries = [];
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
      } else if (scene.kind === 'require' && S._requirePending) {
        // 1단계 (설명) → 2단계 (클릭 대기) 전환
        const reqScene = S._requirePending;
        S._requirePending = null;
        enterRequireWaitStage(reqScene);
      }
    });
    document.getElementById('tut-mock-bubble-prev')?.addEventListener('click', () => {
      rewind();
    });
    window.addEventListener('resize', () => {
      // 현재 신의 anchor 위치 재계산
      const scene = SCENARIO[S.sceneIdx];
      if (!scene) return;
      if (scene.kind === 'dialog' || scene.kind === 'require' || (scene.kind === 'animate' && scene.text)) {
        const sel = (typeof scene.anchor === 'function') ? scene.anchor() : scene.anchor;
        showBubble(scene.text, sel || null, scene.side || null);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUp);
  else wireUp();
})();
