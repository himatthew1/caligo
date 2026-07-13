// make-tut-seq2.js — CALIGO 튜토리얼 시퀀스 (텍스트 스크립트 형식, 표 없음)
'use strict';
const fs = require('fs');
const DOCX_PATH = 'C:/Users/user/AppData/Roaming/npm/node_modules/docx';
const {
  Document, Packer, Paragraph, TextRun,
  Header, Footer, AlignmentType, BorderStyle, PageNumber,
} = require(DOCX_PATH);

const FONT = 'Malgun Gothic';

// ── 씬 데이터 ─────────────────────────────────────────────────────────────
// kind: DIALOG / REQUIRE / ANIMATE / REVEAL / ENTER
// anchor: 포인팅 대상 (없으면 null)
// side: top/bottom/left/right (없으면 null)
// text: 말풍선·힌트·이벤트 설명
// topic: 이 씬이 소개하는 것

const SCENES = [
  // ── INTRO ──
  { kind:'ENTER',   turn:'—',        anchor:null,   side:null,    text:'intro 페이즈 전환',                                                         topic:'인트로 화면 전환' },
  { kind:'DIALOG',  turn:'인트로',   anchor:null,   side:null,    text:'안녕하세요, 용사님.',                                                        topic:'게임 진입 인사' },
  { kind:'DIALOG',  turn:'인트로',   anchor:null,   side:null,    text:'여기는 CALIGO, 마법의 안개로 뒤덮인 폐허입니다.',                             topic:'세계관 소개' },
  { kind:'ENTER',   turn:'—',        anchor:null,   side:null,    text:'game 페이즈 전환',                                                           topic:'게임 화면 전환' },
  { kind:'ANIMATE', turn:'—',        anchor:null,   side:null,    text:'게임 상태 초기화 + 보드 스폰 애니메이션',                                    topic:'보드 초기화' },
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'보드(#tut-game-board) 등장',                                                 topic:'보드 첫 등장' },
  { kind:'DIALOG',  turn:'인트로',   anchor:'게임 보드 전체',      side:'right', text:'마침 길 잃은 장군이 보입니다.',                                topic:'보드 소개 / 장군 존재 알림' },
  { kind:'DIALOG',  turn:'인트로',   anchor:null,   side:null,    text:'그가 이곳을 무사히 빠져나갈 수 있게 도와봅시다.',                            topic:'튜토리얼 목표 제시' },
  { kind:'DIALOG',  turn:'인트로',   anchor:null,   side:null,    text:'우선 그의 상태부터 살펴볼까요.',                                             topic:'좌측 패널 소개 예고' },

  // ── 보드·패널 공개 ──
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'좌측 패널(.left-panel) 등장',                                               topic:'내 캐릭터 패널 첫 등장' },
  { kind:'DIALOG',  turn:'T1',       anchor:'좌측 패널 (내 캐릭터 카드)',      side:'top',   text:'HP와 공격력, 위치가 보이는 캐릭터 프로필입니다. 장군이 많이 다쳐 있네요.', topic:'프로필 카드 설명 (HP·ATK·위치)' },
  { kind:'DIALOG',  turn:'T1',       anchor:null,   side:null,    text:'일단 첫발을 무작정 내딛어 볼까요. 이동해봅시다.',                            topic:'이동 행동 예고' },
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'턴 배너(#tut-turn-banner) 등장',                                            topic:'턴 표시 UI 첫 등장' },
  { kind:'ANIMATE', turn:'T1',       anchor:null,   side:null,    text:'힌트 표시: "장군의 🎖 아이콘을 눌러 행동하세요" / 보드 D4 스포트라이트',     topic:'첫 행동 유도' },

  // ── T1 — 내 이동 D4→D3 ──
  { kind:'REQUIRE', turn:'T1',       anchor:'보드 D4 칸의 장군 아이콘',        side:'top',   text:'장군 아이콘 클릭 → 래디얼 메뉴 오픈 (이동만 활성)',                        topic:'플레이어 첫 클릭 — 래디얼 메뉴' },
  { kind:'REQUIRE', turn:'T1',       anchor:'래디얼 이동 버튼',                side:'right', text:'이동 버튼 클릭',                                                            topic:'래디얼 메뉴 → 이동 선택' },
  { kind:'REQUIRE', turn:'T1',       anchor:'보드 D3 셀',                      side:'right', text:'D3 셀 클릭 → 이동 목적지 확정',                                            topic:'이동 목적지 지정' },
  { kind:'ANIMATE', turn:'T1',       anchor:null,   side:null,    text:'장군 D4→D3 슬라이드 / 로그: 🎖 장군 이동',                                  topic:'이동 결과 반영' },
  { kind:'ANIMATE', turn:'T1 종료',  anchor:null,   side:null,    text:'상대 창병 C3 배치 (비가시·hidden)',                                          topic:'적 등장 예고 (안개 속)' },
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'우측 패널(.right-panel) 등장',                                              topic:'상대 캐릭터 패널 첫 등장' },
  { kind:'DIALOG',  turn:'T1 종료',  anchor:'우측 패널 (상대 캐릭터 카드)',    side:'top',   text:'상대의 인기척을 느낀 것 같아요.',                                           topic:'상대 패널 소개' },
  { kind:'DIALOG',  turn:'T1 종료',  anchor:null,   side:null,    text:'모습은 볼 수 없지만 분명히 이 곳에 있습니다!',                              topic:'안개(Fog of War) 개념 암시' },
  { kind:'DIALOG',  turn:'T1 종료',  anchor:null,   side:null,    text:'상대의 HP와 공격력, 위치가 보이는 프로필입니다. 클릭해서 더 자세한 정보를 볼 수도 있어요.', topic:'상대 카드 클릭 → 캐릭터 사전 안내' },

  // ── T2 — 상대 차례 (창병 이동) ──
  { kind:'ANIMATE', turn:'T2 시작',  anchor:null,   side:null,    text:'토스트: "2턴 — 상대 차례" / 로그 갱신',                                     topic:'턴 변경 알림' },
  { kind:'DIALOG',  turn:'T2',       anchor:'턴 배너',                         side:'bottom',text:'상대의 차례가 시작됐습니다.',                                               topic:'상대 턴 개념 설명' },
  { kind:'ANIMATE', turn:'T2',       anchor:null,   side:null,    text:'창병 C3→D3 이동 / 토스트: "창병 이동" / 로그: 🔱 창병 이동',                topic:'상대 자동 행동 진행' },
  { kind:'ANIMATE', turn:'T3 시작',  anchor:null,   side:null,    text:'토스트: "3턴 — 내 차례" / 로그 갱신',                                       topic:'턴 변경' },

  // ── T3 — 내 공격 ──
  { kind:'DIALOG',  turn:'T3',       anchor:null,   side:null,    text:'상대가 이동을 했군요.',                                                      topic:'상대 행동 결과 해설' },
  { kind:'DIALOG',  turn:'T3',       anchor:null,   side:null,    text:'근처에 접근했을 수도 있으니 공격으로 견제해봅시다.',                          topic:'공격 행동 예고' },
  { kind:'ANIMATE', turn:'T3',       anchor:null,   side:null,    text:'힌트 표시: "장군의 🎖 아이콘을 눌러 행동하세요" / 보드 D3 스포트라이트',     topic:'공격 행동 유도' },
  { kind:'REQUIRE', turn:'T3',       anchor:'보드 D3 칸의 장군 아이콘',        side:'top',   text:'장군 아이콘 클릭 → 래디얼 메뉴 오픈 (공격만 활성)',                        topic:'장군 선택 — 공격 모드' },
  { kind:'REQUIRE', turn:'T3',       anchor:'래디얼 공격 버튼',                side:'right', text:'공격 버튼 클릭 → 공격 범위 하이라이트',                                    topic:'래디얼 메뉴 → 공격 선택' },
  { kind:'REQUIRE', turn:'T3',       anchor:'공격 확정 버튼',                  side:'top',   text:'공격 확정 버튼 클릭',                                                       topic:'공격 확정 UI' },
  { kind:'ANIMATE', turn:'T3',       anchor:null,   side:null,    text:'장군→창병 공격 애니 / 토스트: "창병 피격! HP 3" / 로그: ATK 2, HP 5→3',     topic:'공격 결과 반영' },
  { kind:'DIALOG',  turn:'T3',       anchor:null,   side:null,    text:'훌륭합니다. 역시 근처에 숨어있었네요.',                                      topic:'공격 명중 결과 해설' },
  { kind:'DIALOG',  turn:'T3',       anchor:null,   side:null,    text:'턴을 종료해서 적이 어떻게 움직일지 지켜봅시다.',                             topic:'턴 종료 버튼 예고' },
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'액션 바(#tut-action-bar) 등장',                                             topic:'행동·턴종료 버튼 첫 등장' },
  { kind:'ANIMATE', turn:'T3',       anchor:null,   side:null,    text:'힌트 표시: "턴 종료 버튼을 누르세요" / 턴 종료 버튼 스포트라이트',            topic:'턴 종료 유도' },
  { kind:'REQUIRE', turn:'T3',       anchor:'턴 종료 버튼',                    side:'top',   text:'턴 종료 버튼 클릭',                                                         topic:'첫 턴 종료' },

  // ── T4 — 상대 역공 ──
  { kind:'ANIMATE', turn:'T4 시작',  anchor:null,   side:null,    text:'토스트: "4턴 — 상대 차례" / 로그 갱신',                                     topic:'턴 변경' },
  { kind:'ANIMATE', turn:'T4',       anchor:null,   side:null,    text:'창병→장군 공격 / 토스트: "장군 피격!" / 로그: 🎖 HP 2→1',                   topic:'장군 피해 반영 (역공)' },
  { kind:'ANIMATE', turn:'T5 시작',  anchor:null,   side:null,    text:'토스트: "5턴 — 내 차례" / 로그 갱신',                                       topic:'턴 변경' },
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'이런, 역공을 당했네요.',                                                     topic:'역공 결과 해설' },

  // ── 공격 범위·행동 규칙 설명 ──
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'상대 말의 공격 범위와 공격력을 파악하는 것은 아주 중요합니다.',               topic:'공격 범위 개념 소개' },
  { kind:'ANIMATE', turn:'T5',       anchor:null,   side:null,    text:'창병 캐릭터 사전 팝업 열기',                                                 topic:'캐릭터 사전 UI 등장' },
  { kind:'DIALOG',  turn:'T5',       anchor:'캐릭터 사전 상세 블록',           side:'left',  text:'창병의 경우 위치한 곳의 세로열 전부를 공격합니다.',                         topic:'창병 공격 범위 설명' },
  { kind:'ANIMATE', turn:'T5',       anchor:null,   side:null,    text:'캐릭터 사전 팝업 닫기',                                                      topic:'팝업 해제' },
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'창병의 공격을 회피하려면 좌우로 대피하는 것이 안전합니다.',                   topic:'회피 전략 힌트' },
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'턴 중에는 하나의 캐릭터를 단 한 번만 조작할 수 있습니다. 이를 행동이라고 합니다.',  topic:'행동 규칙 (1턴 1유닛)' },
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'행동은 이동과 공격, 둘 뿐입니다. 이동한 턴엔 공격할 수 없고, 공격한 턴엔 이동할 수 없습니다.', topic:'이동/공격 상호 배타 규칙' },
  { kind:'DIALOG',  turn:'T5',       anchor:null,   side:null,    text:'이대로 공격해도 다시 역공당할 게 뻔하니 도망쳐야겠습니다.',                   topic:'상황 판단 → 도주 결정' },

  // ── T5 — 내 이동 D3→D2 (도주) ──
  { kind:'ANIMATE', turn:'T5',       anchor:null,   side:null,    text:'힌트 표시: "장군의 🎖 아이콘을 눌러 행동하세요" / 보드 D3 스포트라이트',     topic:'도주 이동 유도' },
  { kind:'REQUIRE', turn:'T5',       anchor:'보드 D3 칸의 장군 아이콘',        side:'top',   text:'장군 아이콘 클릭 → 래디얼 메뉴 오픈 (이동만 활성)',                        topic:'장군 선택 — 이동 모드' },
  { kind:'REQUIRE', turn:'T5',       anchor:'래디얼 이동 버튼',                side:'right', text:'이동 버튼 클릭',                                                            topic:'래디얼 → 이동 선택' },
  { kind:'REQUIRE', turn:'T5',       anchor:'보드 D2 셀',                      side:'right', text:'D2 셀 클릭 → 이동 목적지 확정 (창병 공격 범위 이탈)',                      topic:'이동 목적지 — 안전지대' },
  { kind:'ANIMATE', turn:'T5',       anchor:null,   side:null,    text:'장군 D3→D2 슬라이드 / 로그: 🎖 장군 이동',                                  topic:'도주 이동 결과' },
  { kind:'ANIMATE', turn:'T5',       anchor:null,   side:null,    text:'힌트 표시: "턴 종료 버튼을 누르세요" / 턴 종료 버튼 스포트라이트',            topic:'턴 종료 유도' },
  { kind:'REQUIRE', turn:'T5',       anchor:'턴 종료 버튼',                    side:'top',   text:'턴 종료 버튼 클릭',                                                         topic:'턴 종료' },

  // ── T6 — 상대 빗나감 ──
  { kind:'ANIMATE', turn:'T6 시작',  anchor:null,   side:null,    text:'토스트: "6턴 — 상대 차례" / 로그 갱신',                                     topic:'턴 변경' },
  { kind:'ANIMATE', turn:'T6',       anchor:null,   side:null,    text:'창병 공격 빗나감 / 토스트: "공격 빗나감!" / 로그: — 빗나감',                 topic:'빗나감 이벤트' },
  { kind:'ANIMATE', turn:'T7 시작',  anchor:null,   side:null,    text:'토스트: "7턴 — 내 차례" / 로그 갱신',                                       topic:'턴 변경' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'휴, 상대의 실수로 살아남았습니다.',                                          topic:'빗나감 결과 해설' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'일단 빈사 상태의 장군을 도울 동료들을 더 불러모아야겠습니다.',                topic:'동료 추가 예고' },

  // ── 아군 등장 ──
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'약초전문가(C1) + 지휘관(C2) 동시 등장 (팝 애니메이션)',                      topic:'신규 아군 2명 배치' },
  { kind:'DIALOG',  turn:'T7',       anchor:'좌측 패널 (내 캐릭터 카드)',      side:'top',   text:'약초전문가와 지휘관입니다!',                                                topic:'신규 캐릭터 소개' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'이 둘은 아주 특별한 능력을 지니고 있습니다.',                                topic:'스킬·패시브 예고' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'약초전문가 캐릭터 사전 팝업 열기',                                           topic:'캐릭터 사전 UI' },
  { kind:'DIALOG',  turn:'T7',       anchor:'캐릭터 사전 상세 블록',           side:'left',  text:'약초전문가는 다친 전우들을 광역으로 치료할 수 있습니다.',                   topic:'약초전문가 스킬(약초학) 설명' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'캐릭터 사전 닫기 → 지휘관 사전 열기',                                        topic:'사전 전환' },
  { kind:'DIALOG',  turn:'T7',       anchor:'캐릭터 사전 상세 블록',           side:'left',  text:'지휘관은 인접한 다른 아군들의 공격력을 상승시킵니다.',                      topic:'지휘관 패시브(사기증진) 설명' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'캐릭터 사전 닫기',                                                           topic:'팝업 해제' },

  // ── SP + 스킬 사용 ──
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'장군을 치료하는 게 우선일 것 같습니다.',                                     topic:'치료 필요성 강조' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'약초전문가의 스킬 약초학을 사용해봅시다.',                                   topic:'스킬 사용 예고' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'SP를 지급해드리겠습니다.',                                                   topic:'SP 개념 예고' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'SP 2 지급 + 스킬 버튼(#tut-btn-skill) 등장',                                topic:'SP UI 활성화' },
  { kind:'REVEAL',  turn:'—',        anchor:null,   side:null,    text:'SP 섹션(.sp-section) 등장',                                                 topic:'SP 게이지 첫 등장' },
  { kind:'DIALOG',  turn:'T7',       anchor:'SP 섹션',                         side:'top',   text:'스킬을 사용하기 위한 포인트입니다. 약초학은 2 SP가 필요합니다.',             topic:'SP 시스템 설명' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'약초전문가 스킬 팝업 열기 / 힌트 표시: "시전 버튼을 누르세요"',              topic:'스킬 팝업 UI 등장' },
  { kind:'REQUIRE', turn:'T7',       anchor:'스킬 팝업 시전 버튼',             side:'top',   text:'시전 버튼 클릭 → 약초학 발동 (SP 2 소모)',                                 topic:'스킬 시전 (약초학)' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'치료 플래시 (장군·지휘관) / 토스트: "약초학! 아군 HP +1" / 로그: 🌿 약초학 시전, 🎖 HP 1→2', topic:'광역 치료 결과' },
  { kind:'DIALOG',  turn:'T7',       anchor:null,   side:null,    text:'훌륭합니다! 장군이 회복됐습니다.',                                           topic:'치료 성공 해설' },
  { kind:'ANIMATE', turn:'T7',       anchor:null,   side:null,    text:'힌트 표시: "턴 종료 버튼을 누르세요" / 턴 종료 버튼 스포트라이트',            topic:'턴 종료 유도' },
  { kind:'REQUIRE', turn:'T7',       anchor:'턴 종료 버튼',                    side:'top',   text:'턴 종료 버튼 클릭',                                                         topic:'턴 종료' },

  // ── T8 — 상대 이동 ──
  { kind:'ANIMATE', turn:'T8 시작',  anchor:null,   side:null,    text:'토스트: "8턴 — 상대 차례" / 로그 갱신',                                     topic:'턴 변경' },
  { kind:'ANIMATE', turn:'T8',       anchor:null,   side:null,    text:'창병 이동 (D4→D3 방향) / 토스트: "창병 이동"',                              topic:'상대 이동' },
  { kind:'ANIMATE', turn:'T9 시작',  anchor:null,   side:null,    text:'토스트: "9턴 — 내 차례" / 로그 갱신',                                       topic:'턴 변경' },

  // ── T9 — 지휘관 공격 ──
  { kind:'DIALOG',  turn:'T9',       anchor:null,   side:null,    text:'지휘관에게도 설명할 게 더 있습니다.',                                        topic:'지휘관 추가 설명 예고' },
  { kind:'DIALOG',  turn:'T9',       anchor:null,   side:null,    text:'지휘관의 공격력은 2입니다. 그리고 지휘관 자신도 인접 아군에게 사기증진 버프를 받습니다.', topic:'사기증진 패시브 상세 설명' },
  { kind:'DIALOG',  turn:'T9',       anchor:null,   side:null,    text:'지휘관으로 창병을 공격해봅시다.',                                            topic:'지휘관 공격 유도' },
  { kind:'ANIMATE', turn:'T9',       anchor:null,   side:null,    text:'힌트 표시: "지휘관의 📋 아이콘을 눌러 행동하세요" / 보드 C2 스포트라이트',   topic:'지휘관 선택 유도' },
  { kind:'REQUIRE', turn:'T9',       anchor:'보드 C2 칸의 지휘관 아이콘',      side:'top',   text:'지휘관 아이콘 클릭 → 래디얼 메뉴 오픈 (공격만 활성)',                      topic:'지휘관 선택' },
  { kind:'REQUIRE', turn:'T9',       anchor:'래디얼 공격 버튼',                side:'right', text:'공격 버튼 클릭 → 공격 범위 하이라이트',                                    topic:'래디얼 → 공격 선택' },
  { kind:'REQUIRE', turn:'T9',       anchor:'공격 확정 버튼',                  side:'top',   text:'공격 확정 버튼 클릭',                                                       topic:'공격 확정' },
  { kind:'ANIMATE', turn:'T9',       anchor:null,   side:null,    text:'지휘관→창병 공격 / 토스트: "창병 피격! HP 1" / 로그: ATK 2, HP 3→1',        topic:'지휘관 공격 결과 (창병 HP 1)' },
  { kind:'ANIMATE', turn:'T9',       anchor:null,   side:null,    text:'힌트 표시: "턴 종료 버튼을 누르세요" / 턴 종료 버튼 스포트라이트',            topic:'턴 종료 유도' },
  { kind:'REQUIRE', turn:'T9',       anchor:'턴 종료 버튼',                    side:'top',   text:'턴 종료 버튼 클릭',                                                         topic:'턴 종료' },

  // ── T10 — 공주·쥐장수 등장 ──
  { kind:'ANIMATE', turn:'T10 시작', anchor:null,   side:null,    text:'토스트: "10턴 — 상대 차례" / 로그 갱신',                                    topic:'턴 변경' },
  { kind:'ANIMATE', turn:'T10',      anchor:null,   side:null,    text:'공주(A1) 등장 / 토스트: "새 적 등장 — 공주"',                               topic:'신규 적 공주 배치' },
  { kind:'ANIMATE', turn:'T10',      anchor:null,   side:null,    text:'공주→약초전문가 즉사 공격 / 토스트: "약초전문가 격파!"',                     topic:'약초전문가 사망 (HP 0)' },
  { kind:'ANIMATE', turn:'T10',      anchor:null,   side:null,    text:'쥐장수(E5) 등장 + 쥐 소환 스킬 자동 발동 / 토스트: "쥐장수 등장 + 쥐 소환!"', topic:'신규 적·스킬 자동 발동' },
  { kind:'ANIMATE', turn:'T11 시작', anchor:null,   side:null,    text:'토스트: "11턴 — 내 차례" / 로그 갱신',                                      topic:'턴 변경' },

  // ── 시스템 설명 ──
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'이런! 우리 약초전문가가 쓰러졌습니다.',                                      topic:'아군 격파 결과 해설' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'그 정체는 공주였군요. 그리고 쥐장수의 스킬까지 발동됐어요.',                  topic:'공주·쥐장수 소개' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'쥐장수는 쥐를 소환해서 공격 범위를 확장합니다.',                             topic:'쥐장수 스킬(쥐 소환) 설명' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'SP는 스킬 포인트입니다. 특이하게도 양측이 함께 공유합니다.',                  topic:'SP 공유 규칙' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'10턴마다 양측 모두에게 1씩 지급됩니다. 40턴이 되면 각각 최대 5개까지 쌓입니다.', topic:'SP 지급 주기·한도' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'서로 3개의 유닛을 기용해 상대 유닛을 전멸시키면 승리입니다.',                 topic:'승리 조건 설명' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'약초전문가가 사망했으니 — 궁수를 추가로 드리겠습니다.',                      topic:'궁수 보상 예고' },

  // ── 자유 플레이 + 종료 ──
  { kind:'ANIMATE', turn:'T11',      anchor:null,   side:null,    text:'궁수(E1) 합류 / 토스트: "궁수 합류" / 로그: 🏹 궁수 합류!',                 topic:'신규 아군 궁수 배치' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'이제부터는 진짜 게임처럼 자유롭게 진행해보세요!',                            topic:'자유 플레이 안내' },
  { kind:'DIALOG',  turn:'T11',      anchor:null,   side:null,    text:'남은 적 — 창병(HP 1), 공주(HP 3), 쥐장수(HP 3) — 모두 처치하면 승리입니다.', topic:'최종 목표 제시' },
  { kind:'ANIMATE', turn:'T11',      anchor:null,   side:null,    text:'freePlay 모드 진입 / 힌트·말풍선 초기화',                                    topic:'자유 플레이 시작' },
  { kind:'DIALOG',  turn:'승리',     anchor:null,   side:null,    text:'🎉 승리! 장군이 폐허에서 무사히 살아남았습니다.',                            topic:'승리 메시지' },
  { kind:'DIALOG',  turn:'승리',     anchor:null,   side:null,    text:'CALIGO의 제왕으로 거듭나세요.',                                              topic:'마무리 멘트' },
  { kind:'ANIMATE', turn:'—',        anchor:null,   side:null,    text:'exitTutorial() 호출 → 튜토리얼 종료',                                        topic:'종료' },
];

// ── 그룹 경계 ──────────────────────────────────────────────────────────────
// (씬 인덱스 기준)
const GROUPS = [
  { at: 0,  label: '█ 인트로' },
  { at: 9,  label: '█ 보드 & 패널 공개  +  T1 첫 이동' },
  { at: 19, label: '█ 상대 패널 등장  (T1 종료)' },
  { at: 23, label: '█ T2 상대 차례  /  T3 내 첫 공격' },
  { at: 39, label: '█ T4 역공  /  T5 행동 규칙 설명' },
  { at: 51, label: '█ T5 도주 이동  /  T6 빗나감' },
  { at: 63, label: '█ T7 아군 등장  &  캐릭터 사전' },
  { at: 71, label: '█ T7 SP 시스템  &  스킬 사용 (약초학)' },
  { at: 83, label: '█ T8–T9  지휘관 공격' },
  { at: 96, label: '█ T10 공주·쥐장수 등장  &  시스템 설명' },
  { at: 108,label: '█ 자유 플레이  &  승리·종료' },
];

// ── 종류별 색상 ──────────────────────────────────────────────────────────
const KIND_COLOR = {
  DIALOG:  '1A1A2E',   // 거의 검정
  REQUIRE: '92400E',   // 갈색
  ANIMATE: '1E4D7A',   // 짙은 파랑
  REVEAL:  '14532D',   // 짙은 초록
  ENTER:   '4B1686',   // 짙은 보라
};

// ── 단락 빌더 ──────────────────────────────────────────────────────────────

// 그룹 제목 단락
function groupHeading(label, sceneNum) {
  return [
    new Paragraph({
      spacing: { before: 480, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '4338CA', space: 4 } },
      children: [
        new TextRun({ text: label, bold: true, size: 24, color: '4338CA', font: FONT }),
      ],
    }),
    new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text: '', size: 2 })] }),
  ];
}

// 씬 헤더 (씬번호 + 종류 + 타이밍)
function sceneHeader(idx, kind, turn) {
  const color = KIND_COLOR[kind] || '374151';
  const kindLabels = {
    DIALOG:'💬 말풍선', REQUIRE:'👆 인터랙션', ANIMATE:'⚙ 자동 진행', REVEAL:'✨ UI 등장', ENTER:'▶ 페이즈 전환'
  };
  const label = kindLabels[kind] || kind;
  return new Paragraph({
    spacing: { before: 240, after: 40 },
    children: [
      new TextRun({ text: `씬 ${idx}`, bold: true, size: 18, color: '888888', font: FONT }),
      new TextRun({ text: '   ', size: 18, font: FONT }),
      new TextRun({ text: label, bold: true, size: 18, color, font: FONT }),
      new TextRun({ text: '   ', size: 18, font: FONT }),
      new TextRun({ text: turn, size: 18, color: '555555', font: FONT }),
    ],
  });
}

// 텍스트 본문 (말풍선/힌트/이벤트 내용)
function sceneText(kind, text) {
  // DIALOG, REQUIRE: 더 크고 진하게 / ANIMATE, REVEAL, ENTER: 작고 흐리게
  const isPrimary = kind === 'DIALOG' || kind === 'REQUIRE';
  return new Paragraph({
    spacing: { before: 0, after: isPrimary ? 60 : 40 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: isPrimary ? '▶  ' : '↪  ', size: isPrimary ? 22 : 18, color: isPrimary ? '374151' : 'AAAAAA', font: FONT }),
      new TextRun({ text, size: isPrimary ? 22 : 18, color: isPrimary ? '1A1A2E' : '888888', font: FONT }),
    ],
  });
}

// 앵커/주제 메타 라인
function sceneMeta(anchor, side, topic) {
  const parts = [];
  if (anchor) {
    parts.push(new TextRun({ text: '포인팅: ', bold: true, size: 17, color: '6B7280', font: FONT }));
    parts.push(new TextRun({ text: anchor, size: 17, color: '374151', font: FONT }));
    if (side) {
      parts.push(new TextRun({ text: `  (${side})`, size: 17, color: '9CA3AF', font: FONT }));
    }
    parts.push(new TextRun({ text: '     ', size: 17, font: FONT }));
  }
  parts.push(new TextRun({ text: '주제: ', bold: true, size: 17, color: '6B7280', font: FONT }));
  parts.push(new TextRun({ text: topic, size: 17, color: '374151', font: FONT }));
  return new Paragraph({
    spacing: { before: 0, after: 100 },
    indent: { left: 360 },
    children: parts,
  });
}

// 씬 구분선 (얇은 점선)
function sceneDivider() {
  return new Paragraph({
    spacing: { before: 80, after: 0 },
    border: { bottom: { style: BorderStyle.DASHED, size: 1, color: 'E5E7EB', space: 1 } },
    children: [new TextRun({ text: '', size: 2 })],
  });
}

// ── 문서 단락 빌드 ──────────────────────────────────────────────────────────
const children = [];

// 제목
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 120 },
  children: [new TextRun({ text: 'CALIGO  튜토리얼 시퀀스 스크립트', bold: true, size: 44, color: '1E1040', font: FONT })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 60 },
  children: [new TextRun({ text: '씬별 등장 시점 · 포인팅 대상 · 말풍선 내용 정리  —  문구 수정·삽입용 시트', size: 20, color: '6D28D9', font: FONT })],
}));

// 범례
children.push(new Paragraph({
  spacing: { before: 40, after: 60 },
  children: [
    new TextRun({ text: '💬 말풍선', size: 18, color: KIND_COLOR.DIALOG, font: FONT, bold: true }),
    new TextRun({ text: '   |   ', size: 18, color: 'CCCCCC', font: FONT }),
    new TextRun({ text: '👆 인터랙션', size: 18, color: KIND_COLOR.REQUIRE, font: FONT, bold: true }),
    new TextRun({ text: '   |   ', size: 18, color: 'CCCCCC', font: FONT }),
    new TextRun({ text: '⚙ 자동 진행', size: 18, color: KIND_COLOR.ANIMATE, font: FONT, bold: true }),
    new TextRun({ text: '   |   ', size: 18, color: 'CCCCCC', font: FONT }),
    new TextRun({ text: '✨ UI 등장', size: 18, color: KIND_COLOR.REVEAL, font: FONT, bold: true }),
    new TextRun({ text: '   |   ', size: 18, color: 'CCCCCC', font: FONT }),
    new TextRun({ text: '▶ 페이즈 전환', size: 18, color: KIND_COLOR.ENTER, font: FONT, bold: true }),
  ],
}));
children.push(new Paragraph({
  spacing: { before: 0, after: 240 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1E1040', space: 6 } },
  children: [new TextRun({ text: '', size: 2 })],
}));

// 씬 목록
SCENES.forEach((sc, idx) => {
  const group = GROUPS.find(g => g.at === idx);
  if (group) {
    groupHeading(group.label, idx).forEach(p => children.push(p));
  }
  children.push(sceneHeader(idx, sc.kind, sc.turn));
  children.push(sceneText(sc.kind, sc.text));
  if (sc.anchor || sc.topic) {
    children.push(sceneMeta(sc.anchor, sc.side, sc.topic));
  }
  children.push(sceneDivider());
});

// 끝 여백
children.push(new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '', size: 2 })] }));

// ── 문서 생성 ──────────────────────────────────────────────────────────────
const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },  // US Letter 세로
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO  튜토리얼 시퀀스 스크립트  v20260513', size: 16, color: '888888', font: FONT })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '— ', size: 16, color: '888888', font: FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888', font: FONT }),
            new TextRun({ text: ' —', size: 16, color: '888888', font: FONT }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = 'C:/Users/user/Desktop/board-game/CALIGO_tutorial_sequence.docx';
  fs.writeFileSync(out, buf);
  console.log('Done:', out, '/', (buf.length/1024).toFixed(1)+'KB');
}).catch(err => { console.error(err); process.exit(1); });
