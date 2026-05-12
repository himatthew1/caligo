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
    spearman:    { type:'spearman',    icon:'🔱',  name:'창병',         tier:1, atk:1, baseHp:2, desc:'세로줄 전체 공격' },
    scout:       { type:'scout',       icon:'🔭',  name:'척후병',       tier:1, atk:1, baseHp:2, desc:'자신+좌우 / 🔭 정찰 스킬' },
    cavalry:     { type:'cavalry',     icon:'🐎',  name:'기마병',       tier:1, atk:1, baseHp:2, desc:'가로줄 전체 공격' },
    bodyguard:   { type:'bodyguard',   icon:'🛡️',  name:'호위무사',     tier:2, atk:1, baseHp:3, desc:'십자 4방향 · 자기 제외' },
    general:     { type:'general',     icon:'🎖',  name:'장군',         tier:2, atk:2, baseHp:3, desc:'십자 5칸 · 자기 포함' },
    weaponSmith: { type:'weaponSmith', icon:'⚒',  name:'무기상',       tier:2, atk:1, baseHp:2, desc:'세로/가로 토글' },
    commander:   { type:'commander',   icon:'📋',  name:'지휘관',       tier:3, atk:2, baseHp:3, desc:'좌우 1칸 / 사기증진 패시브' },
    monk:        { type:'monk',        icon:'🙏',  name:'수도승',       tier:3, atk:1, baseHp:3, desc:'위/아래 · 가호 패시브' },
    dragonTamer: { type:'dragonTamer', icon:'🐉',  name:'드래곤조련사', tier:3, atk:2, baseHp:3, desc:'X 대각선 4칸 / 🐉 드래곤' },
  };

  // 드래프트 선택지 (정답은 척후병/장군/지휘관)
  const DRAFT = {
    t1: { options: [CHARS.spearman, CHARS.scout, CHARS.cavalry],     correctIdx: 1 },
    t2: { options: [CHARS.bodyguard, CHARS.general, CHARS.weaponSmith], correctIdx: 1 },
    t3: { options: [CHARS.commander, CHARS.monk, CHARS.dragonTamer],   correctIdx: 0 },
  };

  // 정해진 HP (총 10 — 실제 게임 규칙과 동일)
  const HP_PRESET = { t1: 2, t2: 5, t3: 3 };
  const HP_TOTAL = 10;

  // 배치 위치 — 사기증진 버프 활용: 지휘관이 장군 옆에 붙어 ATK +1
  //   척후병 A5 가장자리, 장군 C5 중앙, 지휘관 D5 장군 우측 인접 → 사기증진 active
  const PLACE_PRESET = [
    { tier:'t1', col:0, row:4 },   // 척후병 A5
    { tier:'t2', col:2, row:4 },   // 장군    C5
    { tier:'t3', col:3, row:4 },   // 지휘관  D5 (장군 오른쪽 — 사기증진 인접)
  ];

  // 상대 초기 위치 — 보드 위쪽에 위치한 진형
  const OPP_INIT = [
    { id:'op-1', char:CHARS.spearman,  col:1, row:0, hp:2, maxHp:2 }, // 🔱 B1
    { id:'op-2', char:CHARS.bodyguard, col:2, row:0, hp:3, maxHp:3 }, // 🛡 C1
    { id:'op-3', char:CHARS.cavalry,   col:4, row:0, hp:2, maxHp:2 }, // 🐎 E1 코너
  ];

  // ── 런타임 상태 ───────────────────────────────────────────────────────────
  const S = {
    sceneIdx: 0,
    drafted: { t1:null, t2:null, t3:null },
    placedCount: 0,
    pieces: [],          // 모든 piece (my + opp). 안개 가린 opp 는 hidden:true.
    turn: 1,
    whose: 'me',         // 'me' | 'opp'
    spMy: 3, spOpp: 3,
    // ★ 인게임과 동일한 추리 토큰 모델 — 보드 셀에 배치된 추측.
    //   각 토큰: { pieceKey, icon, name, col, row }. pieceKey 로 어떤 적인지 구분.
    deductionTokens: [],
    logEntries: [],      // [{ text, type }]
    _animTimers: [],
    _onClick: null,      // 현재 require 신의 클릭 핸들러
    _onClickTarget: null,
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

  // ── Welcome ─────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'intro' });
  SCENARIO.push({ kind:'dialog', text:`<p>안녕하세요, 새로운 전사여 🎓</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>여기는 <strong>CALIGO</strong>.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>안개 속에서 펼쳐지는 두뇌 싸움이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>보드 위 어딘가에 적이 숨어있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그 위치는 안개로 가려져 있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>추리·정찰·공격으로 안개를 뚫어내며 한 명씩 잡는 게 목표입니다.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>오늘은 실제 게임 흐름을 그대로 따라가 볼게요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>순서는 — 캐릭터 선택, HP 분배, 배치, 전투.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>먼저 <strong>캐릭터 선택</strong>부터 가봅시다.</p>` });

  // ── Draft T1 ────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'draft-t1' });
  SCENARIO.push({ kind:'dialog', text:`<p>이게 <strong>캐릭터 선택 화면</strong>이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>위쪽에 단계 표시 — <strong>1티어, 2티어, 3티어</strong> 순서대로 뽑아요.</p>`, anchor:'#tut-draft-step-indicator', side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>지금은 1티어 차례.</p>`, anchor:'#tut-draft-step-indicator .step.active', side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>왼쪽 영역이 캐릭터 정보예요.</p>`, anchor:'.slide-viewer', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>이 친구 — <strong>척후병</strong>입니다.</p>`, anchor:'#tut-icon', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>한 줄 소개 — "안개 너머 숨어있는 적의 정보를 수집한다."</p>`, anchor:'#tut-flavor', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽 작은 그림이 <strong>공격 범위</strong>예요.</p>`, anchor:'#tut-draft-preview-board', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병은 자기 자리 + 좌우 = <strong>3칸</strong>. 사거리는 좁아요.</p>`, anchor:'#tut-draft-preview-board', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>대신 — <strong>강력한 스킬</strong>이 있어요.</p>`, anchor:'.slide-skill-box', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>🔭 <strong>정찰</strong> — 적의 행 또는 열을 알아내요.</p>`, anchor:'.slide-skill-box', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>안개 속 적의 위치를 좁히는 핵심 스킬이에요.</p>`, anchor:'.slide-skill-box', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽이 <strong>내 조합</strong> — 지금은 비어있죠.</p>`, anchor:'.draft-sidebar', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>1티어로 척후병을 골라봅시다.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>아래 <strong>[캐릭터 선택]</strong> 버튼을 클릭하세요.</p>`, anchor:'#tut-btn-draft-select', side:'top',
    onClick: () => { S.drafted.t1 = CHARS.scout; } });

  // ── Draft T2 (간소화 — 첫 캐릭터만 자세히 설명, 나머지는 핵심만) ─────
  SCENARIO.push({ kind:'enter', phase:'draft-t2' });
  SCENARIO.push({ kind:'dialog', text:`<p>2티어 — 메인 딜러 <strong>장군</strong>이에요.</p>`, anchor:'#tut-icon', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>ATK 2, 십자 5칸 사거리. 평타가 강해요.</p>`, anchor:'#tut-draft-preview-board', side:'left' });
  SCENARIO.push({ kind:'require', text:`<p><strong>[캐릭터 선택]</strong>으로 확정.</p>`, anchor:'#tut-btn-draft-select', side:'top',
    onClick: () => { S.drafted.t2 = CHARS.general; } });

  // ── Draft T3 (간소화) ───────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'draft-t3' });
  SCENARIO.push({ kind:'dialog', text:`<p>3티어 — <strong>지휘관</strong>이에요.</p>`, anchor:'#tut-icon', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p><strong>사기증진 패시브</strong> — 인접 아군 ATK +1.</p>`, anchor:'.slide-skill-box', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 옆에 붙이면 장군이 ATK 3 으로 강화돼요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p><strong>[캐릭터 선택]</strong>으로 확정.</p>`, anchor:'#tut-btn-draft-select', side:'top',
    onClick: () => { S.drafted.t3 = CHARS.commander; } });

  // ── HP 분배 ─────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'hp' });
  SCENARIO.push({ kind:'dialog', text:`<p>세 명 다 뽑았어요!</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 <strong>HP 분배 화면</strong>이에요.</p>`, anchor:'.tut-hp-container h2', side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>총 <strong>10 HP</strong>를 세 유닛에게 나눠줘야 합니다.</p>`, anchor:'.tut-hp-container .muted', side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>각 유닛은 최소 1, 최대 8 HP.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>실제 게임에선 +/- 버튼으로 직접 조절해요.</p>`, anchor:'.hp-input-group', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>튜토리얼은 <strong>추천값</strong>이 미리 입력돼 있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병 <strong>2</strong> — 정찰꾼은 뒤에 있어 적게.</p>`, anchor:'.hp-piece-row[data-tier="t1"]', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 <strong>5</strong> — 메인 딜러는 두텁게.</p>`, anchor:'.hp-piece-row[data-tier="t2"]', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관 <strong>3</strong> — 중간 정도.</p>`, anchor:'.hp-piece-row[data-tier="t3"]', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>합 — 2 + 5 + 3 = 10. 정확히 다 썼어요.</p>`, anchor:'.hp-total-bar', side:'top' });
  SCENARIO.push({ kind:'require', text:`<p>아래 <strong>[확정]</strong> 버튼을 클릭하세요.</p>`, anchor:'#tut-btn-hp-confirm', side:'top',
    onClick: () => {
      ['t1','t2','t3'].forEach(t => { S.drafted[t].hp = HP_PRESET[t]; S.drafted[t].maxHp = HP_PRESET[t]; });
    } });

  // ── 배치 1 (척후병 A5) ──────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'place-1' });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 <strong>말 배치 화면</strong>이에요.</p>`, anchor:'.tut-placement-container h2', side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>왼쪽이 내가 배치할 유닛 목록.</p>`, anchor:'.tut-piece-list', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>빛나고 있는 게 — 지금 차례인 <strong>척후병</strong>.</p>`, anchor:'.tut-place-piece-item.selected', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>가운데 — 배치할 <strong>5×5 보드</strong>.</p>`, anchor:'.tut-placement-board', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽 — 상대 캐릭터 미리보기.</p>`, anchor:'.tut-placement-opp', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>상대는 누구인지 다 공개돼 있어요 — <strong>창병·호위무사·기마병</strong>.</p>`, anchor:'.tut-placement-opp', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>대신 — <strong>위치는 비공개</strong>. 전투가 시작되면 안개로 가려져요.</p>`, anchor:'.tut-placement-opp', side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>배치 룰은 없어요 — 어디든 자유롭게.</p>`, anchor:'.tut-placement-board', side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병은 사거리가 좁으니 — <strong>가장자리</strong>에 두면 좋아요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>좌측 끝 <strong>A5</strong> 에 둬봅시다.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>A5</strong> 셀을 클릭하세요.</p>`, anchor:'.tut-target-cell', side:'right',
    onClick: () => { S.placedCount = 1; } });

  // ── 배치 2 (장군 C5) — 간소화 ──────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'place-2' });
  SCENARIO.push({ kind:'dialog', text:`<p>다음은 장군 — 중앙 <strong>C5</strong> 에 둬봅시다.</p>`, anchor:'.tut-place-piece-item.selected', side:'right' });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C5</strong> 셀을 클릭하세요.</p>`, anchor:'.tut-target-cell', side:'right',
    onClick: () => { S.placedCount = 2; } });

  // ── 배치 3 (지휘관 D5 — 사기증진 인접 활용) — 간소화 ─────────────────
  SCENARIO.push({ kind:'enter', phase:'place-3' });
  SCENARIO.push({ kind:'dialog', text:`<p>지휘관은 장군 오른쪽 <strong>D5</strong> 에. 사기증진 발동을 위해서요.</p>`, anchor:'.tut-place-piece-item.selected', side:'right' });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>D5</strong> 셀을 클릭하세요.</p>`, anchor:'.tut-target-cell', side:'right',
    onClick: () => { S.placedCount = 3; setupGameState(); } });

  // ── 게임 시작 ────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'game' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-game-board`] });
  SCENARIO.push({ kind:'dialog', text:`<p>전투 개시! 🎉</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>가운데 — 5×5 격자판이에요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>아래쪽에 우리 세 말이 보이죠?</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>📋 지휘관을 장군 바로 옆에 뒀어요. <strong>사기증진</strong> 인접 위치예요.</p>`, anchor:() => boardCellSel(3, 4), side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>실제 전투에선 장군 평타가 +1 강화돼요. 전략적 배치죠.</p>` });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .left-panel`] });
  SCENARIO.push({ kind:'dialog', text:`<p>왼쪽 — <strong>내 말 카드</strong>.</p>`, anchor:`${SCOPE} .left-panel`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>HP 막대와 ATK, 그리고 위치가 보여요.</p>`, anchor:`${SCOPE} .left-panel`, side:'right' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .right-panel`] });
  SCENARIO.push({ kind:'dialog', text:`<p>오른쪽 — <strong>상대 카드</strong>.</p>`, anchor:`${SCOPE} .right-panel`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>누가 무슨 캐릭터인지 다 공개돼 있어요.</p>`, anchor:`${SCOPE} .right-panel`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>대신 — 위치는 <strong>"위치 불명"</strong>.</p>`, anchor:`${SCOPE} .right-panel`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>보드 위쪽이 비어보이죠? 적이 거기 있지만 안개에 가려져 안 보여요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>이걸 추리하면서 잡아내는 게 CALIGO 입니다.</p>` });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .sp-section`] });
  SCENARIO.push({ kind:'dialog', text:`<p>상단 — <strong>SP 바</strong>.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>스킬을 쓸 때 필요한 자원이에요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>나와 상대가 <strong>공유하는 풀 총 10</strong>이에요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>지금 — 나 3 / 상대 3 / 풀에 4 남음.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>튜토리얼은 SP 3 으로 시작 — 실제는 1 부터, 매 10턴 +1 지급</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-turn-banner`] });
  SCENARIO.push({ kind:'dialog', text:`<p>중앙 상단 — <strong>현재 차례</strong>.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>지금은 1턴, 내 차례.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} #tut-action-bar`] });
  SCENARIO.push({ kind:'dialog', text:`<p>아래 버튼 4개.</p>`, anchor:`${SCOPE} #tut-action-bar`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>🟢 <strong>행동</strong> — 이동 또는 공격.</p>`, anchor:`#tut-btn-action`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>🟣 <strong>스킬</strong> — SP를 써서 능력 발동.</p>`, anchor:`#tut-btn-skill`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>🟠 <strong>턴 종료</strong> — 행동 안 하고 넘기기.</p>`, anchor:`#tut-btn-end-turn`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>🔴 <strong>기권</strong> — 패배 인정.</p>`, anchor:`#tut-btn-surrender`, side:'top' });
  SCENARIO.push({ kind:'reveal', selectors: [`${SCOPE} .center-log-wrap`] });
  SCENARIO.push({ kind:'dialog', text:`<p>아래 — <strong>전투 로그</strong>.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>모든 행동·이벤트가 여기 기록돼요.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });

  // ── 턴 1 — 내 차례 (정찰) ─────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>자, 진짜 시작입니다.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>1턴 — 내 차례에요.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>안개 속에 적이 셋. 어떻게 시작할까요?</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>위치를 모르고 마구 공격하면 다 빗나가요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그러니 <strong>정찰</strong>부터 가는 게 정석이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병이 우리 정찰꾼이죠.</p>`, anchor:() => `${SCOPE} .my-piece-card[data-my-id="me-t1"]`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>먼저 척후병을 선택해야 해요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>보드의 <strong>척후병 🔭 A5</strong>을 클릭하세요.</p>`,
    anchor: () => boardCellSel(0, 4) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(0, 4);
      // ★ 인게임처럼 — piece 클릭 시 부채꼴 메뉴 등장
      openTutRadial(0, 4, { moveDisabled: true, attackDisabled: true });
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병 위에 <strong>부채꼴 메뉴</strong>가 떴어요. 인게임과 동일해요.</p>`, anchor:'#tut-radial-menu', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>이동·공격·스킬 셋 중 하나를 골라요.</p>`, anchor:'#tut-radial-menu', side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>지금은 ✨ <strong>스킬</strong>로 정찰을 시전해봅시다.</p>`, anchor:'.radial-btn[data-tut-radial-key="skill"]', side:'right' });
  SCENARIO.push({ kind:'require', text:`<p>부채꼴의 ✨ <strong>스킬</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="skill"]', side:'right',
    onClick: () => { closeTutRadial(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>척후병의 스킬은 🔭 <strong>정찰</strong>이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>SP <strong>2</strong> 차감해서 시전합니다.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>정찰은 <strong>대상을 직접 고르지 않아요</strong>.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>시전 즉시 시스템이 <strong>무작위로 적 한 명 + 축 1개</strong>를 골라 알려줘요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>운에 맡기는 부분이에요. 결과를 봅시다.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.spMy = 1;  // SP 3 → 1 (정찰 비용 2)
      // 인게임과 동일 형식 — 로그에만 결과 출력. 카드에 자동 표시 X.
      addLog('🔭 정찰: 상대 🔱 창병의 위치는 B열', 'skill');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🎯 무작위로 — 🔱 <strong>창병</strong>의 <strong>B열</strong>이 드러났어요.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>결과는 로그에만 남아요. 카드에 자동 표시 안 돼요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 <strong>추리 토큰</strong>을 직접 놓아야 해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>인게임에선 적 카드 아이콘을 잡아 보드 셀로 드래그해요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-1"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>튜토리얼에선 자동으로 — B 열 안쪽 셀에 놔드릴게요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 추리 토큰 자동 배치 — 인게임처럼 보드 셀에. B3 (중간 깊이) 추측.
      S.deductionTokens.push({ pieceKey: 'op-1', icon: '🔱', name: '창병', col: 1, row: 2 });
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>보드 <strong>B3</strong> 셀에 🔱 토큰이 놓였어요.</p>`, anchor:() => boardCellSel(1, 2), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>창병 카드에도 <strong>📌B3</strong> 배지가 붙었어요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-1"] .deduction-badge`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>"창병이 B 열 어딘가에 있다 — 일단 B3 으로 추측"하는 표시예요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>틀려도 괜찮아요. 잘못된 추측을 시각으로 두면 다음 행동이 명확해져요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>SP 도 3 에서 1 로 줄었어요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>행은 아직 몰라요. 다음 정찰이나 추리로 좁혀가요.</p>` });
  SCENARIO.push({ kind:'animate', text:`<p>내 차례 종료. 상대 차례로 넘어가요.</p>`,
    run: async () => {
      S.turn = 2; S.whose = 'opp';
      addLog('2턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 2 — 상대 차례 (안개 속 이동) ──────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>이제 상대 차례에요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사 C1 → C2 (한 칸 전진)
      const bg = findPiece('op-2');
      bg.col = 2; bg.row = 1;
      addLog('상대가 이동했습니다.', 'move');
      flashLogPanel();
      await sleep(900);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>...상대가 뭔가 했어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>로그를 봐요 — "상대가 이동" 만 떴어요.</p>`, anchor:`${SCOPE} .center-log-wrap`, side:'top' });
  SCENARIO.push({ kind:'dialog', text:`<p>누가 어디로 갔는지는 — 알 수 없어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이게 CALIGO 의 핵심 — <strong>정보 비대칭</strong>이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>나는 내 행동만 보여주고, 적은 적의 행동만 봐요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>안개가 짙을수록 추리가 중요해져요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 3; S.whose = 'me';
      addLog('3턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });

  // ── 턴 3 — 내 차례 (장군 전진) ───────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>3턴 — 다시 내 차례.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>창병이 B열에 있다고 정찰로 알아냈죠.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그런데 척후병 A5 사거리는 좁아요 — 자기 + 좌우만.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>B열 위쪽 B1~B4 은 닿지 않아요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그래서 <strong>장군</strong>이 출동할 차례.</p>`, anchor:() => `${SCOPE} .my-piece-card[data-my-id="me-t2"]`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군은 평타 강타자 — 십자 5칸 사거리에 ATK 2.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>한 발씩 전진하면서 적과의 거리를 좁히는 게 핵심.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>보드의 <strong>장군 🎖 C5</strong>을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 4) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(2, 4);
      openTutRadial(2, 4, { attackDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>부채꼴 메뉴 등장. 🏃 이동을 골라요.</p>`, anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right' });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(2, 4); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이동 가능 칸이 녹색으로 빛나요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>상하좌우 1칸 — 4 방향 중 선택.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>위쪽 <strong>C4</strong>로 전진해봅시다.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C4</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 3), side:'top',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(2,4), 2, 3, 350);
      // 인게임 형식 로그 — addLog(`${pc.name} 이동`)
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 한 칸 앞으로 나갔어요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 2, 3); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>지금 장군 사거리예요 — 보드에 빛나는 칸들이 다 들어갑니다.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>적이 저 안에 들어오면 — 잡을 수 있어요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이번 턴은 여기까지.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 4; S.whose = 'opp';
      addLog('4턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 4 — 상대 공격 (빗나감!) ───────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>4턴. 상대가 또 움직여요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사가 C3 를 공격 (장군이 C4 에 있다고 잘못 추리 → 한 칸 빗나감)
      // 호위무사 위치 C2, 사거리 십자 = C1/C3/B2/D2 — C3 공격
      await animateAttackOnCell(2, 2);  // C3
      addLog('상대 공격 — C3 빗나감!', 'miss');
      updateUI();
      await sleep(600);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>아이고, 공격이 와요!</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>빨갛게 빛난 칸 — 거기 떨어졌어요.</p>`, anchor: () => boardCellSel(2, 2), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>다행히 — 우린 거기 없었어요. <strong>빗나감!</strong></p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>빗나가도 — 우린 큰 정보를 얻었어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>공격이 거기 닿았다 = 적 누군가가 그 칸을 사거리에 두고 있다는 거니까요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>적 셋의 사거리를 떠올려 봅시다.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>🔱 창병 — 세로줄 전체.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-1"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>🐎 기마병 — 가로줄 전체.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-3"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>🛡 호위무사 — 인접 4방향 가까운 근거리.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-2"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>창병은 B열이라 정찰로 알아냈죠 — C3 못 닿아요. 제외.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>기마병은 가로줄 — 3행 전체일 때만 C3 닿아요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사라면 C3 바로 옆 어딘가에 있어야 해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>C3 인접 — C2, C4, B3, D3 중 한 칸이에요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사 추측 토큰 — 가장 가능성 큰 C2 셀에 배치
      S.deductionTokens.push({ pieceKey: 'op-2', icon: '🛡', name: '호위무사', col: 2, row: 1 });
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사 추리 토큰을 <strong>C2</strong> 에 놓았어요.</p>`, anchor:() => boardCellSel(2, 1), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>카드 배지도 <strong>📌C2</strong> 로 표시됐어요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-2"] .deduction-badge`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>계속 진행하면서 좁혀가요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 5; S.whose = 'me';
      addLog('5턴 : 내 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 5 — 내 차례 (장군 전진 추가) ──────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>5턴 — 내 차례.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군을 한 번 더 전진시켜요. <strong>C3</strong>으로.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이러면 장군 사거리가 위쪽 C2 까지 닿아요. C2 에 호위무사가 있다면 — 다음 턴에 잡을 수 있죠.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 C4 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 3) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(2, 3);
      openTutRadial(2, 3, { attackDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(2, 3); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C3</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 2), side:'right',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(2,3), 2, 2, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 C3 도착!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 2, 2); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>사거리가 한 칸 위로 — 보드에 빛난 칸을 봐요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 호위무사 추정 위치 C3 옆 어딘가 가 사거리 안에 들어왔어요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 6; S.whose = 'opp';
      addLog('6턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 6 — 상대 공격 (장군 명중) ──────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>6턴. 들이밀었더니 — 상대가 공격해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      await animateAttackOnCell(2, 2);  // 장군 C3 피격
      const gen = findMyPiece(2, 2);
      gen.hp -= 1;
      animateBoardPieceHit(2, 2);
      flashCard('my', gen.id);
      // 실제 형식: 피격자 시점 → `${hitLabels} 피격`
      addLog('🎖 장군 피격', 'hit');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 맞았어요!</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>HP 5, 4. 아직 살아있어요.</p>`, anchor:() => `${SCOPE} .my-piece-card[data-my-id="me-t2"]`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>그리고 — 큰 단서를 얻었어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>공격이 장군 C3 에 적중했다 = 적이 C3 를 사거리에 두고 있다는 뜻.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사는 인접 1칸 사거리. C3 인접 셀 = 4개 중 하나.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      // 호위무사 위치 추정 — 인접 셀들을 보드에 시각화
      const adj = [[2,1],[2,3],[1,2],[3,2]];  // C2,C4,B3,D3
      adj.forEach(([c,r]) => {
        const cell = document.querySelector(boardCellSel(c, r));
        if (cell) cell.classList.add('tut-deduce-hilite');
      });
      await sleep(100);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>빛나는 네 칸 — 호위무사 가능 위치예요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>C4 는 우리 장군 자리 — 비어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>가장 가능성 큰 건 — <strong>C2</strong>.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>상대가 안쪽으로 내려왔다는 정황이 있거든요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      document.querySelectorAll(`${SCOPE} .cell.tut-deduce-hilite`).forEach(c => c.classList.remove('tut-deduce-hilite'));
      // 호위무사 추리 토큰은 이미 C2 에 놓여 있음 — 확신이 더 높아진 상태로 narrative 만.
      updateUI();
      await sleep(200);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사가 C2 에 있다는 추측이 거의 확정됐어요.</p>`, anchor:() => boardCellSel(2, 1), side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 7; S.whose = 'me';
      addLog('7턴 : 내 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 7 — 결정타 호위무사 격파 ──────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>7턴 — 결정의 순간. 반격해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 전진하면서 지휘관과 멀어졌어요. 사기증진은 일시 끊긴 상태.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그래도 — 호위무사가 빈사예요. 지금 잡아야 해요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 C3 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 2) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(2, 2);
      openTutRadial(2, 2, { moveDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => { closeTutRadial(); highlightAttackTargetsGeneral(2, 2); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이번엔 공격 셀이 빨갛게 빛나요. 장군 사거리 5칸 중에서 — <strong>C2</strong> 를 골라요. 거기에 호위무사가 있을 거에요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>C2</strong> 셀을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 1), side:'right',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(2, 1);
      const bg = findPiece('op-2');
      bg.hp -= 2;
      bg.hidden = false;
      // 적 위치 노출 → 추리 토큰 제거 (실제 위치 확인됨)
      S.deductionTokens = S.deductionTokens.filter(t => t.pieceKey !== 'op-2');
      animateBoardPieceHit(2, 1);
      flashCard('opp', bg.id);
      // 실제 형식: 공격자 시점 → addLog `${coords} 명중`
      addLog('C2 명중', 'hit');
      updateUI();
      await sleep(800);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>💥 <strong>명중!</strong></p>`, anchor:() => boardCellSel(2,1), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사 발견! 안개가 걷혔어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>HP 3, 1. 빈사 상태에요.</p>`, anchor:() => `${SCOPE} .opp-piece-card[data-opp-id="op-2"]`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>중요한 규칙 — <strong>공격이 적중하면 위치가 노출돼요</strong>.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>한 번만 더 때리면 격파.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 8; S.whose = 'opp';
      addLog('8턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 8 — 상대 도주 ───────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>상대 차례. 호위무사가 빈사 상태니 — 보통은 도주를 시도해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      const bg = findPiece('op-2');
      await animatePieceSlide(bg, 1, 1, 350);  // C2 → B2
      // 실제 형식: 자기 외 시점 → `상대가 이동했습니다.`
      // 단, 노출된 적의 이동은 보드 위에서 직접 보임 — 로그는 일반 형식 유지.
      addLog('상대가 이동했습니다.', 'move');
      updateUI();
      await sleep(500);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사가 <strong>B2</strong> 로 빠졌어요.</p>`, anchor:() => boardCellSel(1,1), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 사거리에서 벗어났어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그래도 끝까지 따라잡을 수 있어요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 9; S.whose = 'me';
      addLog('9턴 : 내 차례', 'system');
      updateUI();
      await sleep(300);
    } });

  // ── 턴 9 — 격파! ───────────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>9턴. 마지막 일격을 준비해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>장군을 <strong>B3</strong> 으로 전진시키면, B2 의 호위무사가 사거리에 들어옵니다.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 C3 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(2, 2) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(2, 2);
      openTutRadial(2, 2, { attackDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(2, 2); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>B3</strong>.</p>`,
    anchor: () => boardCellSel(1, 2), side:'right',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(2,2), 1, 2, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군이 B3 에 도착.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 1, 2); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 사거리에 호위무사 B2 가 들어왔어요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>중요 규칙 — 한 턴에 <strong>행동은 1회</strong>예요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이번 턴엔 이동을 썼으니 공격은 다음 턴에.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>턴을 자동 종료할게요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 10; S.whose = 'opp';
      addLog('10턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>10턴. 상대가 어떻게 나올까요?</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      const bg = findPiece('op-2');
      await animatePieceSlide(bg, 0, 1, 350);
      addLog('상대가 이동했습니다.', 'move');
      updateUI();
      await sleep(500);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>또 도주.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이번엔 A2 까지 빠졌어요.</p>`, anchor:() => boardCellSel(0,1), side:'right' });

  // ── SP 지급 (10턴 시점) ────────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>잠깐 — 10턴이 끝났어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>매 10턴마다 — <strong>SP 지급</strong> 이벤트가 발생해요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playSpGrantCeremony(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>나와 상대 — <strong>각각 SP +1</strong> 받았어요.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>SP가 다시 차오르면 스킬을 또 쓸 수 있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>SP 지급은 — 10턴, 20턴, 30턴, 40턴 — 총 4번 발생합니다.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 1, 2); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 사거리를 봐요 — A2 는 안 닿아요.</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군을 한 칸 더 앞으로 보내야 해요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 11; S.whose = 'me';
      addLog('11턴 : 내 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 11 — 장군 추가 전진 ────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>11턴 — 내 차례.</p>`, anchor:`${SCOPE} #tut-turn-banner`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>장군을 한 칸 더 — <strong>B2</strong> 로 전진.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그러면 A2 의 호위무사가 다음 턴 사거리에 들어와요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 B3 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(1, 2) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(1, 2);
      openTutRadial(1, 2, { attackDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'require', text:`<p>🏃 <strong>이동</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="move"]', side:'right',
    onClick: () => { closeTutRadial(); highlightMoveTargets(1, 2); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>B2</strong>.</p>`,
    anchor: () => boardCellSel(1, 1), side:'right',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animatePieceSlide(findMyPiece(1,2), 1, 1, 350);
      addLog('🎖 장군 이동', 'move');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>장군 B2 도착!</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { highlightRangeOnBoard('general', 1, 1); await sleep(100); } });
  SCENARIO.push({ kind:'dialog', text:`<p>사거리에 — A2 가 들어왔어요. 호위무사 잡을 준비 끝!</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { clearRangeHighlight(); await sleep(100); } });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 12; S.whose = 'opp';
      addLog('12턴 : 상대 차례', 'system');
      updateUI();
      await sleep(400);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>상대 차례. 호위무사가 더 도망가거나, 다른 유닛이 행동할 거에요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      await animateAttackOnCell(1, 1);
      const gen = findMyPiece(1, 1);
      gen.hp -= 1;
      animateBoardPieceHit(1, 1);
      flashCard('my', gen.id);
      addLog('🎖 장군 피격', 'hit');
      findPiece('op-1').hidden = false;
      // 창병 위치 노출 → 추리 토큰 제거
      S.deductionTokens = S.deductionTokens.filter(t => t.pieceKey !== 'op-1');
      updateUI();
      await sleep(700);
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>또 맞았어요! 장군 HP 3, 2.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이건 — 창병의 세로줄 공격이에요.</p>`, anchor:() => boardCellSel(1, 0), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>창병 사거리 = 자기가 있는 세로줄 전체. 장군이 B 열에 있으니 닿았어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그리고 — 공격이 적중하면서 창병 위치가 노출됐어요. B1 에 보이죠?</p>`, anchor:() => boardCellSel(1, 0), side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>호위무사 A2, 창병 B1 — 두 적이 다 드러났어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 결정타.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      S.turn = 13; S.whose = 'me';
      addLog('13턴 : 내 차례', 'system');
      updateUI();
      await sleep(400);
    } });

  // ── 턴 13 — 호위무사 격파 ──────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>13턴! 빈사의 호위무사부터 처치해요.</p>` });
  SCENARIO.push({ kind:'require', text:`<p>장군 B2 을 클릭하세요.</p>`,
    anchor: () => boardCellSel(1, 1) + ' .piece-marker', side:'top',
    onClick: () => {
      S.selectedPiece = findMyPiece(1, 1);
      openTutRadial(1, 1, { moveDisabled: true, skillDisabled: true, hideSkill: true });
    } });
  SCENARIO.push({ kind:'require', text:`<p>⚔ <strong>공격</strong> 버튼을 클릭하세요.</p>`,
    anchor:'.radial-btn[data-tut-radial-key="attack"]', side:'right',
    onClick: () => { closeTutRadial(); highlightAttackTargetsGeneral(1, 1); } });
  SCENARIO.push({ kind:'require', text:`<p>빛나는 <strong>A2</strong> — 호위무사를 공격!</p>`,
    anchor: () => boardCellSel(0, 1), side:'right',
    onClick: () => {} });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => {
      clearMoveHighlights();
      await animateAttackOnCell(0, 1);
      const bg = findPiece('op-2');
      bg.hp -= 2;
      animateBoardPieceHit(0, 1);
      flashCard('opp', bg.id);
      // 격파!
      bg.alive = false;
      // 실제 형식: 공격자 시점 → `${coords} ${labels} 격파`
      addLog('A2 🛡 호위무사 격파', 'kill');
      updateUI();
      await sleep(800);
      // piece-marker fade out
      const cell = document.querySelector(boardCellSel(0, 1));
      const mk = cell?.querySelector('.piece-marker');
      if (mk) {
        mk.style.transition = 'opacity 0.5s, transform 0.5s';
        mk.style.opacity = '0';
        mk.style.transform = 'scale(0.4) rotate(20deg)';
      }
      await sleep(500);
      bg.col = -1; bg.row = -1;
      updateUI();
    } });
  SCENARIO.push({ kind:'dialog', text:`<p>🎉 <strong>호위무사 격파!</strong> 첫 적 처치!</p>`, anchor:`${SCOPE} #tut-game-board`, side:'right' });
  SCENARIO.push({ kind:'dialog', text:`<p>적 카드 패널을 보면 호위무사가 — 시들어 사라졌어요.</p>`, anchor:`${SCOPE} .right-panel`, side:'left' });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 적 두 명 남았어요. 창병 B1 HP 2, 기마병 위치 미상 HP 2.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>다음은 — 척후병으로 기마병 정찰, 또는 장군으로 창병 직격. 어느 것이든 이길 거에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>여기까지가 한 판의 시작·중반 흐름이에요.</p>` });

  // ── 보드 축소 시퀀스 (요약) ──────────────────────────────────────────
  SCENARIO.push({ kind:'dialog', text:`<p>마지막으로 — 알아둬야 할 큰 시스템이 하나 있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p><strong>보드 축소</strong>.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>게임이 너무 길어지면 — 안 끝나잖아요?</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그래서 일정 턴 50턴 또는 1대1 대치 상황에서 보드가 축소돼요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>10턴 전부터 경고가 떠요.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playShrinkWarningSummary(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>이렇게 — 카운트다운 박스가 등장.</p>`, anchor:`${SCOPE} .sp-section`, side:'bottom' });
  SCENARIO.push({ kind:'dialog', text:`<p>그리고 — 외곽 칸이 파괴됩니다.</p>` });
  SCENARIO.push({ kind:'animate', text:null,
    run: async () => { await playBoardShrinkSummary(); } });
  SCENARIO.push({ kind:'dialog', text:`<p>외곽 칸이 사라졌어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그 영역에 있던 말은 — <strong>탈락</strong>이에요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>그러니 — 보드 안쪽으로 미리 대피하는 게 중요해요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>2단계 축소까지 일어나면 보드는 더 좁아져요.</p>` });

  // ── 마무리 ──────────────────────────────────────────────────────────────
  SCENARIO.push({ kind:'enter', phase:'intro' });
  SCENARIO.push({ kind:'dialog', text:`<p>🎉 튜토리얼 완료!</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>오늘 배운 것:</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 드래프트, HP, 배치, 전투의 흐름</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 정찰로 적 위치 좁히기</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 전진해서 사거리 확보하기</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 빗나간 공격에서도 정보 얻기</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 적 위치는 공격이 맞으면 노출</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• SP 지급 10턴마다 +1</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>• 보드 축소 외곽 칸 파괴</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>실제 게임엔 30종 캐릭터, 더 많은 스킬 저주·드래곤·폭탄·악몽 등, 2v2 팀전이 있어요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>이제 <strong>AI 연습 모드</strong>에서 직접 한 판 해보세요.</p>` });
  SCENARIO.push({ kind:'dialog', text:`<p>행운을 빌어요! 🍀</p>` });

  // ═════════════════════════════════════════════════════════════════════════
  //  엔진 로직
  // ═════════════════════════════════════════════════════════════════════════

  function setupGameState() {
    // 내 piece 3개 — drafted + place
    const my = PLACE_PRESET.map(p => {
      const ch = S.drafted[p.tier];
      return {
        id: 'me-' + p.tier,
        owner: 'me',
        char: ch,
        icon: ch.icon, name: ch.name, tier: ch.tier, atk: ch.atk,
        col: p.col, row: p.row,
        hp: ch.hp, maxHp: ch.maxHp,
        alive: true, hidden: false,
      };
    });
    // 상대 piece 3개 — hidden
    const opp = OPP_INIT.map(o => ({
      id: o.id,
      owner: 'opp',
      char: o.char,
      icon: o.char.icon, name: o.char.name, tier: o.char.tier, atk: o.char.atk,
      col: o.col, row: o.row,
      hp: o.hp, maxHp: o.maxHp,
      alive: true, hidden: true,
    }));
    S.pieces = [...my, ...opp];
    S.turn = 1; S.whose = 'me';
    S.spMy = 3; S.spOpp = 3;
    S.deductionTokens = [];
    S.logEntries = [];
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
      const opp = S.pieces.filter(p => p.owner === 'opp');
      oppCont.innerHTML = opp.map(buildOppCardHTML).join('');
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
