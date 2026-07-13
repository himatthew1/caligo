// make-tut-seq.js — CALIGO 튜토리얼 시퀀스 워드 문서 생성
'use strict';
const path = require('path');
const fs = require('fs');
const DOCX_PATH = 'C:/Users/user/AppData/Roaming/npm/node_modules/docx';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, LevelFormat,
} = require(DOCX_PATH);

// ── 색상 팔레트 ─────────────────────────────────────────────────────────────
const CLR = {
  headerBg:  '1E1040',  // 헤더 행 배경 (짙은 퍼플)
  headerFg:  'FFFFFF',
  enter:     'F0EBF8',  // 페이즈 전환 행
  animate:   'EFF8FF',  // 자동 애니메이션 행
  reveal:    'EDFDF0',  // UI 등장 행
  dialog:    'FFFFFF',  // 말풍선 행
  require:   'FFF8EC',  // 플레이어 인터랙션 행
  altRow:    'F7F4FC',  // 홀수번째 dialog 행 교차 음영
  turnBg:    'D6EAF8',  // 턴 구분 헤더
};

// ── 테이블 컬럼 너비 (DXA, 전체 9360) ─────────────────────────────────────
const COL = {
  num:    540,   // 씬#
  kind:   760,   // 종류
  turn:   720,   // 턴/타이밍
  text:  2800,   // 말풍선/힌트/토스트 텍스트
  anchor:2200,   // 앵커 (포인팅 대상)
  side:   600,   // side
  topic: 1740,   // 소개 주제
};
const COL_WIDTHS = [COL.num, COL.kind, COL.turn, COL.text, COL.anchor, COL.side, COL.topic];
const TABLE_W = COL_WIDTHS.reduce((a,b)=>a+b, 0); // 9360

// ── 씬 데이터 ────────────────────────────────────────────────────────────────
// columns: [씬#, 종류, 턴/타이밍, 말풍선·힌트·토스트, 앵커(포인팅 대상), side, 소개 주제]
const SCENES = [
  // INTRO ──────────────────────────────────────────────────────────────────
  [0,  'ENTER',   '—',       '→ intro 페이즈 전환',                                        '—',                              '—',     '인트로 화면 전환'],
  [1,  'DIALOG',  'intro',   '안녕하세요, 용사님.',                                          '없음 (화면 중앙)',                '—',     '게임 진입 인사'],
  [2,  'DIALOG',  'intro',   '여기는 CALIGO, 마법의 안개로 뒤덮인 폐허입니다.',               '없음 (화면 중앙)',                '—',     '세계관 소개'],
  [3,  'ENTER',   '—',       '→ game 페이즈 전환',                                          '—',                              '—',     '게임 화면 전환'],
  [4,  'ANIMATE', '—',       '게임 상태 초기화 + 보드 스폰 애니메이션',                       '—',                              '—',     '보드 초기화'],
  [5,  'REVEAL',  '—',       '보드(#tut-game-board) 등장',                                  '—',                              '—',     '보드 첫 등장'],
  [6,  'DIALOG',  'intro',   '마침 길 잃은 장군이 보입니다.',                                '게임 보드 전체',                  'right', '보드 소개 / 장군 존재 알림'],
  [7,  'DIALOG',  'intro',   '그가 이곳을 무사히 빠져나갈 수 있게 도와봅시다.',               '없음 (화면 중앙)',                '—',     '튜토리얼 목표 제시'],
  [8,  'DIALOG',  'intro',   '우선 그의 상태부터 살펴볼까요.',                               '없음 (화면 중앙)',                '—',     '좌측 패널 소개 예고'],

  // PHASE 1 — 보드·패널 공개 ───────────────────────────────────────────────
  [9,  'REVEAL',  '—',       '좌측 패널(.left-panel) 등장',                                 '—',                              '—',     '내 캐릭터 패널 첫 등장'],
  [10, 'DIALOG',  'T1',      'HP와 공격력, 위치가 보이는 캐릭터 프로필입니다. 장군이 많이 다쳐 있네요.', '좌측 패널 (내 캐릭터 카드)', 'top', '프로필 카드 설명 (HP·ATK·위치)'],
  [11, 'DIALOG',  'T1',      '일단 첫발을 무작정 내딛어 볼까요. 이동해봅시다.',               '없음 (화면 중앙)',                '—',     '이동 행동 예고'],
  [12, 'REVEAL',  '—',       '턴 배너(#tut-turn-banner) 등장',                              '—',                              '—',     '턴 표시 UI 첫 등장'],
  [13, 'ANIMATE', 'T1',      '힌트: "장군의 🎖 아이콘을 눌러 행동하세요" / 스포트라이트: D4',  '—',                              '—',     '첫 행동 유도'],

  // T1 — 내 이동 (D4→D3) ──────────────────────────────────────────────────
  [14, 'REQUIRE', 'T1',      '힌트: D4의 🎖 클릭 / 래디얼 메뉴 오픈 (이동만 활성)',           '보드 D4 칸의 장군 아이콘',        'top',   '플레이어 첫 클릭 — 래디얼 메뉴'],
  [15, 'REQUIRE', 'T1',      '힌트: 이동 버튼 클릭',                                         '래디얼 이동 버튼',                'right', '래디얼 메뉴 → 이동 선택'],
  [16, 'REQUIRE', 'T1',      '힌트: D3 셀 클릭 → 이동 목적지 확정',                          '보드 D3 셀',                     'right', '이동 목적지 지정'],
  [17, 'ANIMATE', 'T1',      '장군 D4→D3 슬라이드 / 로그: 🎖 장군 이동',                    '—',                              '—',     '이동 결과 반영'],
  [18, 'ANIMATE', 'T1 종료', '상대 창병 C3(hidden) 배치',                                   '—',                              '—',     '적 등장 예고 (비가시)'],
  [19, 'REVEAL',  '—',       '우측 패널(.right-panel) 등장',                                '—',                              '—',     '상대 캐릭터 패널 첫 등장'],
  [20, 'DIALOG',  'T1 종료', '상대의 인기척을 느낀 것 같아요.',                               '우측 패널 (상대 캐릭터 카드)',     'top',   '적 패널 소개'],
  [21, 'DIALOG',  'T1 종료', '모습은 볼 수 없지만 분명히 이 곳에 있습니다!',                  '없음 (화면 중앙)',                '—',     '안개(Fog of War) 개념 암시'],
  [22, 'DIALOG',  'T1 종료', '상대의 HP와 공격력, 위치가 보이는 프로필입니다. 클릭해서 더 자세한 정보를 볼 수도 있어요.', '없음 (화면 중앙)', '—', '상대 카드 클릭 → 캐릭터 사전 안내'],

  // T2 — 상대 차례 (창병 이동) ────────────────────────────────────────────
  [23, 'ANIMATE', 'T2 시작', '토스트: "2턴 — 상대 차례" / 로그: 2턴 시스템',                 '—',                              '—',     '턴 변경 알림'],
  [24, 'DIALOG',  'T2',      '상대의 차례가 시작됐습니다.',                                   '턴 배너(#tut-turn-banner)',       'bottom','상대 턴 개념 설명'],
  [25, 'ANIMATE', 'T2',      '창병 C3→D3 이동 / 토스트: "창병 이동" / 로그: 🔱 창병 이동',   '—',                              '—',     '상대 자동 행동 진행'],
  [26, 'ANIMATE', 'T3 시작', '토스트: "3턴 — 내 차례" / 로그: 3턴 시스템',                   '—',                              '—',     '턴 변경'],

  // T3 — 내 공격 ───────────────────────────────────────────────────────────
  [27, 'DIALOG',  'T3',      '상대가 이동을 했군요.',                                         '없음 (화면 중앙)',                '—',     '상대 행동 결과 해설'],
  [28, 'DIALOG',  'T3',      '근처에 접근했을 수도 있으니 공격으로 견제해봅시다.',              '없음 (화면 중앙)',                '—',     '공격 행동 예고'],
  [29, 'ANIMATE', 'T3',      '힌트: "장군의 🎖 아이콘을 눌러 행동하세요" / 스포트라이트: D3', '—',                              '—',     '공격 행동 유도'],
  [30, 'REQUIRE', 'T3',      '힌트: D3의 🎖 클릭 / 래디얼 메뉴 오픈 (공격만 활성)',           '보드 D3 칸의 장군 아이콘',        'top',   '장군 선택 — 공격 모드'],
  [31, 'REQUIRE', 'T3',      '힌트: 공격 버튼 클릭 → 공격 범위 하이라이트',                   '래디얼 공격 버튼',               'right', '래디얼 메뉴 → 공격 선택'],
  [32, 'REQUIRE', 'T3',      '힌트: 공격 확정 버튼 클릭',                                    '공격 확정 버튼(#tut-attack-confirm-btn)', 'top', '공격 확정 UI'],
  [33, 'ANIMATE', 'T3',      '장군→창병 공격 / 토스트: "창병 피격! HP 3" / 로그: ATK 2, HP 5→3', '—',                          '—',     '공격 애니메이션 + 피해 반영'],
  [34, 'DIALOG',  'T3',      '훌륭합니다. 역시 근처에 숨어있었네요.',                          '없음 (화면 중앙)',                '—',     '공격 명중 결과 해설'],
  [35, 'DIALOG',  'T3',      '턴을 종료해서 적이 어떻게 움직일지 지켜봅시다.',                 '없음 (화면 중앙)',                '—',     '턴 종료 버튼 예고'],
  [36, 'REVEAL',  '—',       '액션 바(#tut-action-bar) 등장',                               '—',                              '—',     '행동·턴종료 버튼 첫 등장'],
  [37, 'ANIMATE', 'T3',      '힌트: "턴 종료 버튼을 누르세요" / 스포트라이트: 턴 종료 버튼',   '—',                              '—',     '턴 종료 유도'],
  [38, 'REQUIRE', 'T3',      '턴 종료 버튼 클릭',                                            '턴 종료 버튼(#tut-btn-end-turn)', 'top',   '첫 턴 종료'],

  // T4 — 상대 역공 ─────────────────────────────────────────────────────────
  [39, 'ANIMATE', 'T4 시작', '토스트: "4턴 — 상대 차례" / 로그: 4턴 시스템',                 '—',                              '—',     '턴 변경'],
  [40, 'ANIMATE', 'T4',      '창병→장군 공격 / 토스트: "장군 피격!" / 로그: 🎖 HP 2→1',      '—',                              '—',     '장군 피해 반영 (역공)'],
  [41, 'ANIMATE', 'T5 시작', '토스트: "5턴 — 내 차례" / 로그: 5턴 시스템',                   '—',                              '—',     '턴 변경'],
  [42, 'DIALOG',  'T5',      '이런, 역공을 당했네요.',                                        '없음 (화면 중앙)',                '—',     '역공 결과 해설'],

  // 공격 범위·행동 규칙 설명 ────────────────────────────────────────────────
  [43, 'DIALOG',  'T5',      '상대 말의 공격 범위와 공격력을 파악하는 것은 아주 중요합니다.',   '없음 (화면 중앙)',                '—',     '공격 범위 개념 소개'],
  [44, 'ANIMATE', 'T5',      '창병 캐릭터 사전 팝업 열기',                                    '—',                              '—',     '캐릭터 사전 UI 등장'],
  [45, 'DIALOG',  'T5',      '창병의 경우 위치한 곳의 세로열 전부를 공격합니다.',               '캐릭터 사전 상세 블록(#dict-slide-detail-blocks)', 'left', '창병 공격 범위 설명'],
  [46, 'ANIMATE', 'T5',      '캐릭터 사전 팝업 닫기',                                         '—',                              '—',     '팝업 해제'],
  [47, 'DIALOG',  'T5',      '창병의 공격을 회피하려면 좌우로 대피하는 것이 안전합니다.',       '없음 (화면 중앙)',                '—',     '회피 전략 힌트'],
  [48, 'DIALOG',  'T5',      '턴 중에는 하나의 캐릭터를 단 한 번만 조작할 수 있습니다. 이를 행동이라고 합니다.', '없음 (화면 중앙)', '—', '행동 규칙 (1턴 1유닛)'],
  [49, 'DIALOG',  'T5',      '행동은 이동과 공격, 둘 뿐입니다. 이동한 턴엔 공격할 수 없고, 공격한 턴엔 이동할 수 없습니다.', '없음 (화면 중앙)', '—', '이동/공격 상호 배타 규칙'],
  [50, 'DIALOG',  'T5',      '이대로 공격해도 다시 역공당할 게 뻔하니 도망쳐야겠습니다.',      '없음 (화면 중앙)',                '—',     '상황 판단 → 도주 결정'],

  // T5 — 내 이동 (D3→D2, 도주) ────────────────────────────────────────────
  [51, 'ANIMATE', 'T5',      '힌트: "장군의 🎖 아이콘을 눌러 행동하세요" / 스포트라이트: D3', '—',                              '—',     '도주 이동 유도'],
  [52, 'REQUIRE', 'T5',      '힌트: D3의 🎖 클릭 / 래디얼 메뉴 오픈 (이동만 활성)',           '보드 D3 칸의 장군 아이콘',        'top',   '장군 선택 — 이동 모드'],
  [53, 'REQUIRE', 'T5',      '힌트: 이동 버튼 클릭',                                         '래디얼 이동 버튼',               'right', '래디얼 → 이동 선택'],
  [54, 'REQUIRE', 'T5',      '힌트: D2 셀 클릭 → 이동 목적지 확정',                          '보드 D2 셀',                     'right', '이동 목적지 — 창병 공격 범위 이탈'],
  [55, 'ANIMATE', 'T5',      '장군 D3→D2 슬라이드 / 로그: 🎖 장군 이동',                    '—',                              '—',     '도주 이동 결과'],
  [56, 'ANIMATE', 'T5',      '힌트: "턴 종료 버튼을 누르세요" / 스포트라이트: 턴 종료 버튼',   '—',                              '—',     '턴 종료 유도'],
  [57, 'REQUIRE', 'T5',      '턴 종료 버튼 클릭',                                            '턴 종료 버튼',                   'top',   '턴 종료'],

  // T6 — 상대 빗나감 ────────────────────────────────────────────────────────
  [58, 'ANIMATE', 'T6 시작', '토스트: "6턴 — 상대 차례" / 로그: 6턴 시스템',                 '—',                              '—',     '턴 변경'],
  [59, 'ANIMATE', 'T6',      '창병 공격 빗나감 / 토스트: "공격 빗나감!" / 로그: — 빗나감',    '—',                              '—',     '빗나감 (Fog of War 효과)'],
  [60, 'ANIMATE', 'T7 시작', '토스트: "7턴 — 내 차례" / 로그: 7턴 시스템',                   '—',                              '—',     '턴 변경'],
  [61, 'DIALOG',  'T7',      '휴, 상대의 실수로 살아남았습니다.',                              '없음 (화면 중앙)',                '—',     '빗나감 결과 해설'],
  [62, 'DIALOG',  'T7',      '일단 빈사 상태의 장군을 도울 동료들을 더 불러모아야겠습니다.',    '없음 (화면 중앙)',                '—',     '동료 추가 예고'],

  // 아군 등장 ──────────────────────────────────────────────────────────────
  [63, 'ANIMATE', 'T7',      '약초전문가(C1) + 지휘관(C2) 등장 (팝 애니메이션)',               '—',                              '—',     '신규 아군 2명 배치'],
  [64, 'DIALOG',  'T7',      '약초전문가와 지휘관입니다!',                                    '좌측 패널 (내 캐릭터 카드)',       'top',   '신규 캐릭터 소개'],
  [65, 'DIALOG',  'T7',      '이 둘은 아주 특별한 능력을 지니고 있습니다.',                    '없음 (화면 중앙)',                '—',     '스킬·패시브 예고'],
  [66, 'ANIMATE', 'T7',      '약초전문가 캐릭터 사전 팝업 열기',                               '—',                              '—',     '캐릭터 사전 UI'],
  [67, 'DIALOG',  'T7',      '약초전문가는 다친 전우들을 광역으로 치료할 수 있습니다.',         '캐릭터 사전 상세 블록',           'left',  '약초전문가 스킬(약초학) 설명'],
  [68, 'ANIMATE', 'T7',      '캐릭터 사전 닫기 → 지휘관 사전 열기',                            '—',                              '—',     '사전 전환'],
  [69, 'DIALOG',  'T7',      '지휘관은 인접한 다른 아군들의 공격력을 상승시킵니다.',            '캐릭터 사전 상세 블록',           'left',  '지휘관 패시브(사기증진) 설명'],
  [70, 'ANIMATE', 'T7',      '캐릭터 사전 닫기',                                               '—',                              '—',     '팝업 해제'],

  // SP + 스킬 사용 ──────────────────────────────────────────────────────────
  [71, 'DIALOG',  'T7',      '장군을 치료하는 게 우선일 것 같습니다.',                          '없음 (화면 중앙)',                '—',     '치료 필요성 강조'],
  [72, 'DIALOG',  'T7',      '약초전문가의 스킬 약초학을 사용해봅시다.',                        '없음 (화면 중앙)',                '—',     '스킬 사용 예고'],
  [73, 'DIALOG',  'T7',      'SP를 지급해드리겠습니다.',                                       '없음 (화면 중앙)',                '—',     'SP 개념 예고'],
  [74, 'ANIMATE', 'T7',      'SP 2 지급 + 스킬 버튼(#tut-btn-skill) 등장',                    '—',                              '—',     'SP UI 활성화'],
  [75, 'REVEAL',  '—',       'SP 섹션(.sp-section) 등장',                                    '—',                              '—',     'SP 게이지 첫 등장'],
  [76, 'DIALOG',  'T7',      '스킬을 사용하기 위한 포인트입니다. 약초학은 2 SP가 필요합니다.',   'SP 섹션(.sp-section)',           'top',   'SP 시스템 설명'],
  [77, 'ANIMATE', 'T7',      '약초전문가 스킬 탭 열기 / 힌트: "시전 버튼을 누르세요"',          '—',                              '—',     '스킬 팝업 UI 등장'],
  [78, 'REQUIRE', 'T7',      '시전 버튼(.cskill-cast-btn) 클릭 → 약초학 발동 (SP 2 소모)',     '스킬 팝업 시전 버튼',            'top',   '스킬 시전 (약초학)'],
  [79, 'ANIMATE', 'T7',      '치료 플래시 (장군·지휘관) / 토스트: "약초학! 아군 HP +1" / 로그: 🌿 약초학', '—',               '—',     '광역 치료 결과 (장군 HP 1→2)'],
  [80, 'DIALOG',  'T7',      '훌륭합니다! 장군이 회복됐습니다.',                                '없음 (화면 중앙)',                '—',     '치료 성공 해설'],
  [81, 'ANIMATE', 'T7',      '힌트: "턴 종료 버튼을 누르세요" / 스포트라이트: 턴 종료 버튼',   '—',                              '—',     '턴 종료 유도'],
  [82, 'REQUIRE', 'T7',      '턴 종료 버튼 클릭',                                             '턴 종료 버튼',                   'top',   '턴 종료'],

  // T8 — 상대 이동 ──────────────────────────────────────────────────────────
  [83, 'ANIMATE', 'T8 시작', '토스트: "8턴 — 상대 차례" / 로그: 8턴 시스템',                  '—',                              '—',     '턴 변경'],
  [84, 'ANIMATE', 'T8',      '창병 이동(D4→D3 방향) / 토스트: "창병 이동"',                   '—',                              '—',     '상대 이동'],
  [85, 'ANIMATE', 'T9 시작', '토스트: "9턴 — 내 차례" / 로그: 9턴 시스템',                    '—',                              '—',     '턴 변경'],

  // T9 — 지휘관 공격 ────────────────────────────────────────────────────────
  [86, 'DIALOG',  'T9',      '지휘관에게도 설명할 게 더 있습니다.',                             '없음 (화면 중앙)',                '—',     '지휘관 추가 설명 예고'],
  [87, 'DIALOG',  'T9',      '지휘관의 공격력은 2입니다. 그리고 지휘관 자신도 인접 아군에게 사기증진 버프를 받습니다.', '없음 (화면 중앙)', '—', '사기증진 패시브 상세 설명'],
  [88, 'DIALOG',  'T9',      '지휘관으로 창병을 공격해봅시다.',                                '없음 (화면 중앙)',                '—',     '지휘관 공격 유도'],
  [89, 'ANIMATE', 'T9',      '힌트: "지휘관의 📋 아이콘을 눌러 행동하세요" / 스포트라이트: C2', '—',                              '—',     '지휘관 선택 유도'],
  [90, 'REQUIRE', 'T9',      '힌트: C2의 📋 클릭 / 래디얼 메뉴 오픈 (공격만 활성)',            '보드 C2 칸의 지휘관 아이콘',      'top',   '지휘관 선택'],
  [91, 'REQUIRE', 'T9',      '힌트: 공격 버튼 클릭 → 공격 범위 하이라이트',                   '래디얼 공격 버튼',               'right', '래디얼 → 공격 선택'],
  [92, 'REQUIRE', 'T9',      '힌트: 공격 확정 버튼 클릭',                                     '공격 확정 버튼',                 'top',   '공격 확정'],
  [93, 'ANIMATE', 'T9',      '지휘관→창병 공격 / 토스트: "창병 피격! HP 1" / 로그: ATK 2, HP 3→1', '—',                        '—',     '지휘관 공격 결과 (창병 HP 1)'],
  [94, 'ANIMATE', 'T9',      '힌트: "턴 종료 버튼을 누르세요" / 스포트라이트: 턴 종료 버튼',   '—',                              '—',     '턴 종료 유도'],
  [95, 'REQUIRE', 'T9',      '턴 종료 버튼 클릭',                                             '턴 종료 버튼',                   'top',   '턴 종료'],

  // T10 — 공주·쥐장수 등장 ──────────────────────────────────────────────────
  [96,  'ANIMATE', 'T10 시작', '토스트: "10턴 — 상대 차례" / 로그: 10턴 시스템',               '—',                              '—',     '턴 변경'],
  [97,  'ANIMATE', 'T10',     '공주(A1) 등장 / 토스트: "새 적 등장 — 공주"',                   '—',                              '—',     '신규 적 공주 배치'],
  [98,  'ANIMATE', 'T10',     '공주→약초전문가 즉사 공격 / 토스트: "약초전문가 격파!"',          '—',                              '—',     '약초전문가 사망 (HP 0)'],
  [99,  'ANIMATE', 'T10',     '쥐장수(E5) 등장 + 쥐 소환 / 토스트: "쥐장수 등장 + 쥐 소환!"',  '—',                              '—',     '신규 적·스킬 자동 발동'],
  [100, 'ANIMATE', 'T11 시작','토스트: "11턴 — 내 차례" / 로그: 11턴 시스템',                  '—',                              '—',     '턴 변경'],

  // 스토리·시스템 설명 라운드 ──────────────────────────────────────────────
  [101, 'DIALOG',  'T11',     '이런! 우리 약초전문가가 쓰러졌습니다.',                          '없음 (화면 중앙)',                '—',     '아군 격파 결과 해설'],
  [102, 'DIALOG',  'T11',     '그 정체는 공주였군요. 그리고 쥐장수의 스킬까지 발동됐어요.',       '없음 (화면 중앙)',                '—',     '공주·쥐장수 소개'],
  [103, 'DIALOG',  'T11',     '쥐장수는 쥐를 소환해서 공격 범위를 확장합니다.',                  '없음 (화면 중앙)',                '—',     '쥐장수 스킬(쥐 소환) 설명'],
  [104, 'DIALOG',  'T11',     'SP는 스킬 포인트입니다. 특이하게도 양측이 함께 공유합니다.',       '없음 (화면 중앙)',                '—',     'SP 공유 규칙 설명'],
  [105, 'DIALOG',  'T11',     '10턴마다 양측 모두에게 1씩 지급됩니다. 40턴이 되면 각각 최대 5개까지 쌓입니다.', '없음 (화면 중앙)', '—', 'SP 지급 주기·한도 설명'],
  [106, 'DIALOG',  'T11',     '서로 3개의 유닛을 기용해 상대 유닛을 전멸시키면 승리입니다.',      '없음 (화면 중앙)',                '—',     '승리 조건 설명'],
  [107, 'DIALOG',  'T11',     '약초전문가가 사망했으니 — 궁수를 추가로 드리겠습니다.',           '없음 (화면 중앙)',                '—',     '궁수 보상 예고'],

  // 궁수 합류 + 자유 플레이 ────────────────────────────────────────────────
  [108, 'ANIMATE', 'T11',     '궁수(E1) 합류 / 토스트: "궁수 합류" / 로그: 🏹 궁수 합류!',     '—',                              '—',     '신규 아군 궁수 배치'],
  [109, 'DIALOG',  'T11',     '이제부터는 진짜 게임처럼 자유롭게 진행해보세요!',                 '없음 (화면 중앙)',                '—',     '자유 플레이 안내'],
  [110, 'DIALOG',  'T11',     '남은 적 — 창병(HP 1), 공주(HP 3), 쥐장수(HP 3) — 모두 처치하면 승리입니다.', '없음 (화면 중앙)', '—', '최종 목표 제시'],
  [111, 'ANIMATE', 'T11',     'freePlay 모드 진입 / 힌트 초기화',                               '—',                              '—',     '자유 플레이 시작'],

  // 승리·마무리 ─────────────────────────────────────────────────────────────
  [112, 'DIALOG',  '승리',    '🎉 승리! 장군이 폐허에서 무사히 살아남았습니다.',                  '없음 (화면 중앙)',                '—',     '승리 메시지'],
  [113, 'DIALOG',  '승리',    'CALIGO의 제왕으로 거듭나세요.',                                  '없음 (화면 중앙)',                '—',     '마무리 멘트'],
  [114, 'ANIMATE', '—',       'exitTutorial() 호출 → 튜토리얼 종료',                            '—',                              '—',     '종료'],
];

// ── 씬 종류별 배경 색 ────────────────────────────────────────────────────────
const KIND_COLOR = {
  ENTER:   CLR.enter,
  ANIMATE: CLR.animate,
  REVEAL:  CLR.reveal,
  DIALOG:  CLR.dialog,
  REQUIRE: CLR.require,
};

// ── 테이블 테두리 ─────────────────────────────────────────────────────────────
const B = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: B, bottom: B, left: B, right: B };
const headerB = { style: BorderStyle.SINGLE, size: 1, color: '7C3AED' };
const headerBorders = { top: headerB, bottom: headerB, left: headerB, right: headerB };

// ── 셀 헬퍼 ─────────────────────────────────────────────────────────────────
function cell(text, w, { bg='FFFFFF', bold=false, fg='1E1040', center=false, size=18, isHeader=false }={}) {
  return new TableCell({
    borders: isHeader ? headerBorders : borders,
    width: { size: w, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), bold, color: fg, size, font: 'Malgun Gothic' })],
    })],
  });
}

// ── 헤더 행 ──────────────────────────────────────────────────────────────────
function headerRow() {
  const COLS = ['씬 #', '종류', '턴/타이밍', '말풍선·힌트·토스트 내용', '앵커 (포인팅 대상)', 'Side', '소개 주제 / 기능'];
  return new TableRow({
    tableHeader: true,
    children: COLS.map((t, i) => cell(t, COL_WIDTHS[i], { bg: CLR.headerBg, fg: CLR.headerFg, bold: true, center: true, size: 18, isHeader: true })),
  });
}

// ── 씬 그룹 헤더 행 ────────────────────────────────────────────────────────
function groupRow(label) {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 7,
        borders: { top: { style: BorderStyle.SINGLE, size: 4, color: '4338CA' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: '4338CA' }, left: B, right: B },
        width: { size: TABLE_W, type: WidthType.DXA },
        shading: { fill: CLR.turnBg, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, color: '1E3A5F', size: 18, font: 'Malgun Gothic' })],
        })],
      }),
    ],
  });
}

// ── 데이터 행 ────────────────────────────────────────────────────────────────
let dialogToggle = false;
function dataRow(scene) {
  const [num, kind, turn, text, anchor, side, topic] = scene;
  let bg = KIND_COLOR[kind] || CLR.dialog;
  if (kind === 'DIALOG') {
    dialogToggle = !dialogToggle;
    if (dialogToggle) bg = CLR.altRow;
  } else {
    dialogToggle = false;
  }
  const kindColor = { ENTER:'7C3AED', ANIMATE:'1D6FA4', REVEAL:'15803D', DIALOG:'374151', REQUIRE:'92400E' }[kind] || '374151';
  return new TableRow({
    children: [
      cell(num,    COL.num,    { bg, center: true, size: 17 }),
      cell(kind,   COL.kind,   { bg, bold: true, fg: kindColor, center: true, size: 17 }),
      cell(turn,   COL.turn,   { bg, size: 17 }),
      cell(text,   COL.text,   { bg, size: 17 }),
      cell(anchor, COL.anchor, { bg, size: 17 }),
      cell(side,   COL.side,   { bg, center: true, size: 17 }),
      cell(topic,  COL.topic,  { bg, size: 17 }),
    ],
  });
}

// ── 그룹 경계 정의 ─────────────────────────────────────────────────────────
const GROUPS = [
  { before: 0,   label: '🎬  인트로 (씬 0–8)' },
  { before: 9,   label: '📋  보드·패널 공개 + 첫 이동 (씬 9–18)' },
  { before: 19,  label: '👤  상대 패널 등장 (씬 19–22)' },
  { before: 23,  label: '⚔️  T2 상대 차례 / T3 내 공격 (씬 23–38)' },
  { before: 39,  label: '🔄  T4 역공 / T5 행동 규칙 설명 (씬 39–50)' },
  { before: 51,  label: '🏃  T5 도주 이동 / T6 빗나감 (씬 51–62)' },
  { before: 63,  label: '🌿  아군 등장 + 캐릭터 사전 (씬 63–70)' },
  { before: 71,  label: '💫  SP 시스템 + 스킬 사용 (씬 71–82)' },
  { before: 83,  label: '📋  T8–T9 지휘관 공격 (씬 83–95)' },
  { before: 96,  label: '👸  T10 공주·쥐장수 등장 + 시스템 설명 (씬 96–107)' },
  { before: 108, label: '🎮  자유 플레이 + 승리·종료 (씬 108–114)' },
];

// ── 테이블 행 빌드 ──────────────────────────────────────────────────────────
const rows = [headerRow()];
SCENES.forEach(scene => {
  const num = scene[0];
  const group = GROUPS.find(g => g.before === num);
  if (group) rows.push(groupRow(group.label));
  rows.push(dataRow(scene));
});

// ── 범례 단락 ─────────────────────────────────────────────────────────────
function legendItem(color, label) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: '  ', highlight: 'white' }),
      new TextRun({ text: `  ${label}  `, bold: false, size: 18, font: 'Malgun Gothic',
        shading: { type: ShadingType.CLEAR, fill: color } }),
    ],
  });
}

// ── 문서 빌드 ────────────────────────────────────────────────────────────────
const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 16838, height: 11906 },  // A4 가로 (landscape)
        margin: { top: 720, right: 720, bottom: 720, left: 720 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO 튜토리얼 시퀀스 카탈로그  v20260513', size: 16, color: '888888', font: 'Malgun Gothic' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '— ', size: 16, color: '888888', font: 'Malgun Gothic' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888', font: 'Malgun Gothic' }),
            new TextRun({ text: ' —', size: 16, color: '888888', font: 'Malgun Gothic' }),
          ],
        })],
      }),
    },
    children: [
      // 제목
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 180 },
        children: [new TextRun({ text: 'CALIGO  튜토리얼 시퀀스 카탈로그', bold: true, size: 40, color: '1E1040', font: 'Malgun Gothic' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: '씬별 등장 시점 · 포인팅 대상 · 소개 내용 정리 — 문구 수정 기준 시트', size: 20, color: '6D28D9', font: 'Malgun Gothic' })],
      }),
      // 범례
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: '■ 색상 범례:  ', bold: true, size: 18, color: '374151', font: 'Malgun Gothic' }),
          new TextRun({ text: 'DIALOG ', size: 18, font: 'Malgun Gothic', shading: { type: ShadingType.CLEAR, fill: CLR.dialog } }),
          new TextRun({ text: '  REQUIRE ', size: 18, font: 'Malgun Gothic', shading: { type: ShadingType.CLEAR, fill: CLR.require } }),
          new TextRun({ text: '  ANIMATE ', size: 18, font: 'Malgun Gothic', shading: { type: ShadingType.CLEAR, fill: CLR.animate } }),
          new TextRun({ text: '  REVEAL ', size: 18, font: 'Malgun Gothic', shading: { type: ShadingType.CLEAR, fill: CLR.reveal } }),
          new TextRun({ text: '  ENTER ', size: 18, font: 'Malgun Gothic', shading: { type: ShadingType.CLEAR, fill: CLR.enter } }),
        ],
      }),
      new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text: '', size: 16, font: 'Malgun Gothic' })] }),
      // 테이블
      new Table({
        width: { size: TABLE_W, type: WidthType.DXA },
        columnWidths: COL_WIDTHS,
        rows,
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:/Users/user/Desktop/board-game/CALIGO_tutorial_sequence.docx', buf);
  console.log('Written to: C:/Users/user/Desktop/board-game/CALIGO_tutorial_sequence.docx');
  console.log('Done: CALIGO_tutorial_sequence.docx');
}).catch(err => { console.error(err); process.exit(1); });
