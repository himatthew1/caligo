// CALIGO 튜토리얼 시퀀스 텍스트 인벤토리 빌드 스크립트 (v20260514m)
// 실행: node _build_tut_seq_v20260514m.js
// 출력: CALIGO_tutorial_sequence_v20260514m.docx

'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, ImageRun,
} = require('docx');
const fs = require('fs');

// ─── 컬럼 폭 (DXA, US Letter 1" margin, content=9360) ───────────────────────
const COL_SCENE  =  680;   // 씬#
const COL_TYPE   = 1200;   // 요소
const COL_TEXT   = 5800;   // 텍스트
const COL_ANCHOR = 1680;   // 앵커/비고
const TABLE_W    = COL_SCENE + COL_TYPE + COL_TEXT + COL_ANCHOR; // 9360

// ─── 색상 ────────────────────────────────────────────────────────────────────
const C = {
  navy:      '1B2A4A',
  phaseBlue: '2E5D9E',
  phaseGray: '4A4A5A',
  headerFill:'D6E4F7',
  rowAlt:    'F5F8FF',
  rowWhite:  'FFFFFF',
  typeDialog:'0D47A1',
  typeHint:  '5D4037',
  typeLog:   '1B5E20',
  typeToast: '4A148C',
  typeSys:   '555555',
  border:    'C8D4E8',
  red:       'BB0000',
};

// ─── 헬퍼: 셀 기본 테두리 ────────────────────────────────────────────────────
const bdr = (color = C.border) => ({
  top:    { style: BorderStyle.SINGLE, size: 1, color },
  bottom: { style: BorderStyle.SINGLE, size: 1, color },
  left:   { style: BorderStyle.SINGLE, size: 1, color },
  right:  { style: BorderStyle.SINGLE, size: 1, color },
});

// ─── 헬퍼: 셀 생성 ───────────────────────────────────────────────────────────
function cell(text, width, opts = {}) {
  const {
    bold = false, color = '222222', size = 18, fill = C.rowWhite,
    italic = false, align = AlignmentType.LEFT, vAlign = VerticalAlign.TOP,
  } = opts;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: bdr(),
    shading: { fill, type: ShadingType.CLEAR },
    verticalAlign: vAlign,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text), bold, color, size, font: 'Arial', italics: italic })],
    })],
  });
}

// ─── 헬퍼: 헤더 행 ──────────────────────────────────────────────────────────
function headerRow() {
  const hOpts = { bold: true, color: 'FFFFFF', size: 18, fill: C.phaseBlue };
  return new TableRow({
    tableHeader: true,
    children: [
      cell('씬#',     COL_SCENE,  hOpts),
      cell('요소',    COL_TYPE,   hOpts),
      cell('텍스트',  COL_TEXT,   hOpts),
      cell('앵커/비고', COL_ANCHOR, hOpts),
    ],
  });
}

// ─── 헬퍼: 요소 표시 + 색상 ─────────────────────────────────────────────────
const TYPE_MAP = {
  '말풍선':   { prefix: '💬 ', color: C.typeDialog },
  '힌트':     { prefix: '💡 ', color: C.typeHint   },
  '힌트→':    { prefix: '💡▶', color: C.typeHint   },  // onClick 내부 setHint
  '로그':     { prefix: '📋 ', color: C.typeLog    },
  '토스트':   { prefix: '🔔 ', color: C.typeToast  },
  '토스트▲':  { prefix: '🔔▲', color: C.typeToast  },  // isEnemy=true 토스트
  '시스템':   { prefix: '⚙️ ', color: C.typeSys    },
};

function typeCell(typeKey, width, fill) {
  const tm = TYPE_MAP[typeKey] || { prefix: typeKey, color: '444444' };
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: bdr(),
    shading: { fill, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({ text: tm.prefix + typeKey, bold: false, color: tm.color, size: 18, font: 'Arial' })],
    })],
  });
}

// ─── 데이터 행 생성 ──────────────────────────────────────────────────────────
// row(씬#, 요소종류, 텍스트, 앵커='', isAlt=false)
function dataRow(scene, typeKey, text, anchor = '', isAlt = false) {
  const fill = isAlt ? C.rowAlt : C.rowWhite;
  return new TableRow({
    children: [
      cell(scene,  COL_SCENE,  { fill, size: 17, color: '555555', align: AlignmentType.CENTER }),
      typeCell(typeKey, COL_TYPE, fill),
      cell(text,   COL_TEXT,  { fill, size: 18 }),
      cell(anchor, COL_ANCHOR,{ fill, size: 16, color: '888888', italic: true }),
    ],
  });
}

// ─── 섹션 헤더 (Heading 2) ──────────────────────────────────────────────────
function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 360, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.phaseBlue, space: 2 } },
    children: [new TextRun({ text, bold: true, size: 28, color: C.phaseBlue, font: 'Arial' })],
  });
}

function spacer(before = 80, after = 0) {
  return new Paragraph({ spacing: { before, after }, children: [] });
}

// ─── 표 생성 ────────────────────────────────────────────────────────────────
function makeTable(rows) {
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: [COL_SCENE, COL_TYPE, COL_TEXT, COL_ANCHOR],
    rows: [headerRow(), ...rows],
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  본문 섹션 데이터
// ═════════════════════════════════════════════════════════════════════════════

// ─── A. 인트로 / 보드 등장 ────────────────────────────────────────────────
const introRows = [
  dataRow('[1]',    '말풍선', '안녕하세요, 용사님.',                                                     '', false),
  dataRow('[NEW]',  '말풍선', '여기는 CALIGO, 마법의 안개로 뒤덮인 폐허입니다.',                         '', true),
  dataRow('[6]',    '말풍선', '안개 속에 길 잃은 장군이 보이네요.',                                      'board › right', false),
  dataRow('[7]',    '말풍선', '그가 이곳을 무사히 빠져나갈 수 있게 도와주실 수 있을까요?',               '', true),
  dataRow('[8]',    '말풍선', '우선 그의 상태를 살펴봐야겠습니다.',                                      '', false),
  dataRow('[10]',   '말풍선', 'HP와 공격력, 위치가 보이는 캐릭터 프로필입니다. 장군이 많이 다쳐 있네요.','.left-panel › top', true),
  dataRow('[11]',   '말풍선', '아무것도 보이지 않지만 발을 내딛어 이동해봅시다.',                        '', false),
  dataRow('[13]',   '힌트',   '장군의 아이콘을 눌러 행동하세요',                                         '', true),
];

// ─── B. 1턴 — 내 이동 ────────────────────────────────────────────────────
const turn1Rows = [
  dataRow('[15]→',  '힌트→',  'D3으로 이동하세요',                                                      '이동 셀 하이라이트 후', false),
  dataRow('[17]',   '로그',   '장군 이동',                                                               'type: move', true),
  dataRow('[NEW]',  '말풍선', '잘하셨습니다. 이동은 한 턴에 상하좌우 단 한 칸이 원칙입니다.',           '', false),
];

// ─── C. 2턴 — 상대 이동 ──────────────────────────────────────────────────
const turn2Rows = [
  dataRow('[23]',   '시스템', '2턴 : 상대 차례',                                                         'type: system', false),
  dataRow('[23]',   '토스트▲','상대 차례',                                                               'isEnemy=true', true),
  dataRow('[24]',   '말풍선', '상대도 움직이려 합니다!',                                                  '', false),
  dataRow('[25]',   '로그',   '상대가 이동했습니다.',                                                     'type: move', true),
  dataRow('[25]',   '토스트▲','상대가 이동했습니다.',                                                    'isEnemy=true', false),
  dataRow('[26]',   '시스템', '3턴 : 내 차례',                                                           'type: system', true),
  dataRow('[26]',   '토스트', '내 차례',                                                                 '', false),
];

// ─── D. 3턴 — 내 공격 ────────────────────────────────────────────────────
const turn3Rows = [
  dataRow('[27]',   '말풍선', '상대가 이동을 했군요.',                                                    '', false),
  dataRow('[28]',   '말풍선', '근처에 접근했을 수도 있으니 공격으로 견제해봅시다.',                       '', true),
  dataRow('[29]',   '힌트',   '장군의 아이콘을 눌러 행동하세요',                                         '', false),
  dataRow('[31]→',  '힌트→',  '공격 확정 버튼을 누르세요',                                               '공격 타깃 하이라이트 후', true),
  dataRow('[33]',   '로그',   'C3 명중',                                                                 'type: hit (coord 동적)', false),
  dataRow('[NEW]',  '말풍선', '분명 이 곳에서 상대가 공격에 노출됐습니다.',                              'board › top', true),
  dataRow('[NEW]',  '말풍선', '추리 토큰을 놓아 위치를 잊어버리지 않도록 합니다.',                       '', false),
  dataRow('[34]',   '말풍선', '훌륭합니다. 역시 근처에 숨어있었네요.',                                   '', true),
  dataRow('[35]',   '말풍선', '턴을 종료해서 적이 어떻게 움직일지 지켜봅시다.',                          '', false),
  dataRow('[37]',   '힌트',   '턴 종료 버튼을 누르세요',                                                 '', true),
];

// ─── E. 4턴 — 상대 공격 ──────────────────────────────────────────────────
const turn4Rows = [
  dataRow('[39]',   '시스템', '4턴 : 상대 차례',                                                         'type: system', false),
  dataRow('[39]',   '토스트▲','상대 차례',                                                               'isEnemy=true', true),
  dataRow('[40]',   '토스트▲','공격받았습니다!',                                                         'isEnemy=true', false),
  dataRow('[40]',   '로그',   '🎖장군 피격',                                                              'type: hit', true),
  dataRow('[41]',   '시스템', '5턴 : 내 차례',                                                           'type: system', false),
  dataRow('[41]',   '토스트', '내 차례',                                                                 '', true),
];

// ─── F. 5턴 — 설명 (이동·행동·공격범위) + 도주 ─────────────────────────
const turn5ExplainRows = [
  dataRow('[42]',   '말풍선', '이런, 역공을 당했네요.',                                                   '', false),
  dataRow('[43]',   '말풍선', '상대 말의 공격 범위와 공격력을 파악하는 것은 아주 중요합니다.',            '', true),
  dataRow('[45]',   '말풍선', '창병의 경우 위치한 곳의 세로열 전부를 공격합니다.',                        '#dict-slide-mini-headers › bottom', false),
  dataRow('[46]',   '말풍선', '때문에 창병의 공격을 회피하려면 좌우로 대피하는 것이 안전합니다.',         '', true),
  dataRow('[48a]',  '말풍선', '공격도 하고, 이동도 하면 좋겠지만…',                                      '', false),
  dataRow('[48b]',  '말풍선', '턴 중에는 하나의 캐릭터를 단 한 번만 조작할 수 있습니다. 이를 행동이라고 합니다.', '', true),
  dataRow('[49a]',  '말풍선', '행동은 이동과 공격, 둘 뿐입니다.',                                        '레이디얼 자동 오픈 상태', false),
  dataRow('[49b]',  '말풍선', '이동한 턴엔 공격할 수 없고, 공격한 턴엔 이동할 수 없습니다.',             '레이디얼 유지', true),
  dataRow('[50]',   '말풍선', '이대로 공격해도 다시 역공당할 게 뻔하니 도망쳐야겠습니다.',              '레이디얼 유지', false),
];

// ─── G. 5턴 — 내 이동 (도주) ─────────────────────────────────────────────
const turn5MoveRows = [
  dataRow('[51]',   '힌트',   '이동 버튼을 누르세요',                                                    '레이디얼 이미 열림', false),
  dataRow('[53]→',  '힌트→',  'D2로 이동하세요',                                                        '이동 셀 하이라이트 후', true),
  dataRow('[55]',   '로그',   '장군 이동',                                                               'type: move', false),
  dataRow('[56]',   '힌트',   '턴 종료 버튼을 누르세요',                                                 '', true),
];

// ─── H. 6턴 — 상대 빗나감 ────────────────────────────────────────────────
const turn6Rows = [
  dataRow('[58]',   '시스템', '6턴 : 상대 차례',                                                         'type: system', false),
  dataRow('[58]',   '토스트▲','상대 차례',                                                               'isEnemy=true', true),
  dataRow('[59]',   '로그',   '창병 공격 빗나감',                                                        'type: miss', false),
  dataRow('[59]',   '토스트▲','창병 공격 빗나감',                                                       'isEnemy=true', true),
  dataRow('[60]',   '시스템', '7턴 : 내 차례',                                                           'type: system', false),
  dataRow('[60]',   '토스트', '내 차례',                                                                 '', true),
];

// ─── I. 7턴 — 동료 등장 + 캐릭터 설명 ────────────────────────────────────
const turn7Rows = [
  dataRow('[61]',   '말풍선', '휴, 상대의 실수로 살아남았습니다.',                                       '', false),
  dataRow('[62]',   '말풍선', '일단 빈사 상태의 장군을 도울 동료들을 더 불러모아야겠습니다.',            '', true),
  dataRow('[64]',   '말풍선', '약초전문가와 지휘관입니다!',                                              '.left-panel › top', false),
  dataRow('[65]',   '말풍선', '이 둘은 아주 특별한 능력을 지니고 있습니다.',                             '', true),
  dataRow('[67]',   '말풍선', '약초전문가는 다친 전우들을 광역으로 치료할 수 있습니다.',                 '#dict-slide-detail-blocks › left', false),
  dataRow('[69]',   '말풍선', '지휘관은 인접한 다른 아군들의 공격력을 상승시킵니다.',                    '#dict-slide-detail-blocks › left', true),
  dataRow('[71]',   '말풍선', '장군을 치료하는 게 우선일 것 같습니다.',                                  '', false),
  dataRow('[72]',   '말풍선', '약초전문가의 스킬 약초학을 사용해봅시다.',                                '', true),
  dataRow('[73]',   '말풍선', 'SP를 지급해드리겠습니다.',                                                '', false),
];

// ─── J. 7턴 — SP + 스킬 (약초학) ─────────────────────────────────────────
const turn7SkillRows = [
  dataRow('[76]',   '말풍선', '스킬을 사용하기 위한 포인트입니다. 약초학은 2 SP가 필요합니다.',          '.sp-section › top', false),
  dataRow('[77]',   '힌트',   '시전 버튼을 누르세요',                                                    '', true),
  dataRow('[79]',   '로그',   '약초학 시전',                                                             'type: skill', false),
  dataRow('[79]',   '로그',   '장군 HP 1→2 (+1 회복)',                                                   'type: skill', true),
  dataRow('[79]',   '토스트', '약초학! 아군 HP +1',                                                      '', false),
  dataRow('[80]',   '말풍선', '훌륭합니다! 장군이 회복됐습니다.',                                        '', true),
  dataRow('[81]',   '힌트',   '턴 종료 버튼을 누르세요',                                                 '', false),
];

// ─── K. 8턴 — 상대 빗나감 ────────────────────────────────────────────────
const turn8Rows = [
  dataRow('[83]',   '시스템', '8턴 : 상대 차례',                                                         'type: system', false),
  dataRow('[83]',   '토스트▲','상대 차례',                                                               'isEnemy=true', true),
  dataRow('[84]',   '로그',   '창병 공격 빗나감',                                                        'type: miss', false),
  dataRow('[84]',   '토스트▲','창병 공격 빗나감',                                                       'isEnemy=true', true),
  dataRow('[85]',   '시스템', '9턴 : 내 차례',                                                           'type: system', false),
  dataRow('[85]',   '토스트', '내 차례',                                                                 '', true),
];

// ─── L. 9턴 — 지휘관 공격 ────────────────────────────────────────────────
const turn9Rows = [
  dataRow('[86]',   '말풍선', '지휘관에게도 설명할 게 더 있습니다.',                                     '', false),
  dataRow('[87]',   '말풍선', '지휘관의 공격력은 2입니다. 그리고 지휘관 자신도 인접 아군에게 사기증진 버프를 받습니다.', '', true),
  dataRow('[88]',   '말풍선', '지휘관으로 창병을 공격해봅시다.',                                         '', false),
  dataRow('[89]',   '힌트',   '지휘관의 아이콘을 눌러 행동하세요',                                       '', true),
  dataRow('[91]→',  '힌트→',  '공격 확정 버튼을 누르세요',                                               '공격 타깃 하이라이트 후', false),
  dataRow('[93]',   '로그',   'C3 명중',                                                                 'type: hit (coord 동적)', true),
  dataRow('[94]',   '힌트',   '턴 종료 버튼을 누르세요',                                                 '', false),
];

// ─── M. 10턴 — 공주·쥐장수 등장 ──────────────────────────────────────────
const turn10Rows = [
  dataRow('[96]',   '시스템', '10턴 : 상대 차례',                                                        'type: system', false),
  dataRow('[96]',   '토스트▲','상대 차례',                                                               'isEnemy=true', true),
  dataRow('[97]',   '로그',   '공주 등장!',                                                              'type: system', false),
  dataRow('[97]',   '토스트▲','새 적 등장 — 공주',                                                      'isEnemy=true', true),
  dataRow('[98]',   '로그',   '🌿약초전문가 격파',                                                        'type: hit', false),
  dataRow('[99]',   '로그',   '쥐장수 스킬 발동',                                                        'type: skill', true),
  dataRow('[99]',   '로그',   '쥐 소환 — E5 인근',                                                       'type: skill', false),
  dataRow('[99]',   '토스트▲','쥐장수 등장 + 쥐 소환!',                                                  'isEnemy=true', true),
  dataRow('[100]',  '시스템', '11턴 : 내 차례',                                                          'type: system', false),
  dataRow('[100]',  '토스트', '내 차례',                                                                 '', true),
];

// ─── N. 11턴 — 게임 설명 + 자유 진행 안내 ───────────────────────────────
const turn11Rows = [
  dataRow('[101]',  '말풍선', '이런! 우리 약초전문가가 쓰러졌습니다.',                                   '', false),
  dataRow('[102]',  '말풍선', '그 정체는 공주였군요. 그리고 쥐장수의 스킬까지 발동됐어요.',              '', true),
  dataRow('[103]',  '말풍선', '쥐장수는 쥐를 소환해서 공격 범위를 확장합니다.',                          '', false),
  dataRow('[104]',  '말풍선', 'SP는 스킬 포인트입니다. 특이하게도 양측이 함께 공유합니다.',              '', true),
  dataRow('[105]',  '말풍선', '10턴마다 양측 모두에게 1씩 지급됩니다. 40턴이 되면 각각 최대 5개까지 쌓입니다.', '', false),
  dataRow('[106]',  '말풍선', '서로 3개의 유닛을 기용해 상대 유닛을 전멸시키면 승리입니다.',            '', true),
  dataRow('[107]',  '말풍선', '약초전문가가 사망했으니 — 궁수를 추가로 드리겠습니다.',                  '', false),
  dataRow('[108]',  '로그',   '궁수 합류!',                                                              'type: system', true),
  dataRow('[108]',  '토스트', '궁수 합류',                                                               '', false),
  dataRow('[109]',  '말풍선', '이제부터는 진짜 게임처럼 자유롭게 진행해보세요!',                        '', true),
  dataRow('[110]',  '말풍선', '남은 적 — 창병(HP 1), 공주(HP 3), 쥐장수(HP 3) — 모두 처치하면 승리입니다.', '', false),
];

// ─── O. 승리 ─────────────────────────────────────────────────────────────
const victoryRows = [
  dataRow('[112]',  '말풍선', '🎉 승리! 장군이 폐허에서 무사히 살아남았습니다.',                        '', false),
  dataRow('[113]',  '말풍선', 'CALIGO의 제왕으로 거듭나세요.',                                           '', true),
];

// ═════════════════════════════════════════════════════════════════════════════
//  문서 조립
// ═════════════════════════════════════════════════════════════════════════════

function makeLegend() {
  const items = [
    { key: '💬 말풍선', desc: 'dialog — 나레이터 말풍선 텍스트' },
    { key: '💡 힌트',   desc: 'setHint() — 하단 행동 안내 바' },
    { key: '💡▶힌트→',  desc: '클릭 핸들러 내부의 setHint()' },
    { key: '📋 로그',   desc: 'addLog() — 전투 로그 패널' },
    { key: '🔔 토스트', desc: 'addToast() — 아군 측 토스트 (흰색)' },
    { key: '🔔▲토스트▲',desc: 'addToast(…, true) — 적 측 토스트 (붉은색)' },
    { key: '⚙️ 시스템', desc: 'addLog(…, system) — 시스템 로그 (턴 구분선)' },
  ];
  const rows = items.map((it, i) =>
    new TableRow({ children: [
      new TableCell({
        width: { size: 2200, type: WidthType.DXA },
        borders: bdr(),
        shading: { fill: i % 2 === 0 ? C.rowWhite : C.rowAlt, type: ShadingType.CLEAR },
        margins: { top: 50, bottom: 50, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: it.key, bold: true, size: 17, font: 'Arial', color: '222222' })] })],
      }),
      new TableCell({
        width: { size: 7160, type: WidthType.DXA },
        borders: bdr(),
        shading: { fill: i % 2 === 0 ? C.rowWhite : C.rowAlt, type: ShadingType.CLEAR },
        margins: { top: 50, bottom: 50, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: it.desc, size: 17, font: 'Arial', color: '444444' })] })],
      }),
    ]})
  );
  return new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: [2200, 7160], rows });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 20 } } },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.phaseBlue, space: 2 } },
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'CALIGO 튜토리얼 시퀀스 텍스트 인벤토리  ', bold: true, size: 18, color: C.navy, font: 'Arial' }),
          new TextRun({ text: 'v20260514m', size: 18, color: '888888', font: 'Arial' }),
        ],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: '- ', size: 17, color: '888888', font: 'Arial' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '888888', font: 'Arial' }),
          new TextRun({ text: ' -', size: 17, color: '888888', font: 'Arial' }),
        ],
      })] }),
    },
    children: [
      // ── 표지 ──────────────────────────────────────────────────────────────
      new Paragraph({ spacing: { before: 2400, after: 120 }, children: [
        new TextRun({ text: 'CALIGO', bold: true, size: 72, color: C.navy, font: 'Arial' }),
      ]}),
      new Paragraph({ spacing: { before: 0, after: 120 }, children: [
        new TextRun({ text: '튜토리얼 시퀀스 텍스트 인벤토리', bold: true, size: 40, color: C.phaseBlue, font: 'Arial' }),
      ]}),
      new Paragraph({ spacing: { before: 60, after: 600 }, children: [
        new TextRun({ text: 'v20260514m  ·  수정 편집용', size: 22, color: '888888', font: 'Arial' }),
      ]}),
      new Paragraph({ spacing: { before: 0, after: 120 }, children: [
        new TextRun({ text: '작성 목적', bold: true, size: 22, color: C.navy, font: 'Arial' }),
      ]}),
      new Paragraph({ spacing: { before: 0, after: 80 }, children: [
        new TextRun({ text: '이 문서에는 튜토리얼에 등장하는 모든 텍스트 요소(말풍선·힌트·로그·토스트)가 씬 순서대로 정리되어 있습니다.', size: 20, font: 'Arial', color: '333333' }),
      ]}),
      new Paragraph({ spacing: { before: 0, after: 80 }, children: [
        new TextRun({ text: '텍스트 내용을 직접 수정한 뒤, 해당 씬 번호를 tutorial-interactive.js 에서 찾아 반영하세요.', size: 20, font: 'Arial', color: '333333' }),
      ]}),
      new Paragraph({ spacing: { before: 0, after: 80 }, children: [
        new TextRun({ text: '앵커/비고 열은 말풍선 위치 등 참고용이며 수정 대상이 아닙니다.', size: 20, color: '888888', font: 'Arial', italics: true }),
      ]}),
      spacer(400, 0),

      // ── 범례 ──────────────────────────────────────────────────────────────
      new Paragraph({ spacing: { before: 0, after: 120 }, children: [
        new TextRun({ text: '요소 범례', bold: true, size: 22, color: C.navy, font: 'Arial' }),
      ]}),
      makeLegend(),
      spacer(600, 0),

      // ── A. 인트로 ─────────────────────────────────────────────────────────
      sectionHeading('A.  인트로 / 보드 등장'),
      spacer(60, 0),
      makeTable(introRows),
      spacer(360, 0),

      // ── B. 1턴 — 내 이동 ──────────────────────────────────────────────────
      sectionHeading('B.  1턴 — 내 이동'),
      spacer(60, 0),
      makeTable(turn1Rows),
      spacer(360, 0),

      // ── C. 2턴 — 상대 이동 ────────────────────────────────────────────────
      sectionHeading('C.  2턴 — 상대 이동  /  3턴 시작'),
      spacer(60, 0),
      makeTable(turn2Rows),
      spacer(360, 0),

      // ── D. 3턴 — 내 공격 ──────────────────────────────────────────────────
      sectionHeading('D.  3턴 — 내 공격'),
      spacer(60, 0),
      makeTable(turn3Rows),
      spacer(360, 0),

      // ── E. 4턴 — 상대 공격 ────────────────────────────────────────────────
      sectionHeading('E.  4턴 — 상대 공격  /  5턴 시작'),
      spacer(60, 0),
      makeTable(turn4Rows),
      spacer(360, 0),

      // ── F. 5턴 — 설명 ─────────────────────────────────────────────────────
      sectionHeading('F.  5턴 — 공격범위 · 행동 규칙 설명'),
      spacer(60, 0),
      makeTable(turn5ExplainRows),
      spacer(360, 0),

      // ── G. 5턴 — 이동(도주) ───────────────────────────────────────────────
      sectionHeading('G.  5턴 — 내 이동 (도주)'),
      spacer(60, 0),
      makeTable(turn5MoveRows),
      spacer(360, 0),

      // ── H. 6턴 — 빗나감 ───────────────────────────────────────────────────
      sectionHeading('H.  6턴 — 상대 빗나감  /  7턴 시작'),
      spacer(60, 0),
      makeTable(turn6Rows),
      spacer(360, 0),

      // ── I. 7턴 — 동료 + 설명 ─────────────────────────────────────────────
      sectionHeading('I.  7턴 — 동료 등장 · 캐릭터 설명'),
      spacer(60, 0),
      makeTable(turn7Rows),
      spacer(360, 0),

      // ── J. 7턴 — SP + 스킬 ───────────────────────────────────────────────
      sectionHeading('J.  7턴 — SP · 약초학 스킬'),
      spacer(60, 0),
      makeTable(turn7SkillRows),
      spacer(360, 0),

      // ── K. 8턴 ───────────────────────────────────────────────────────────
      sectionHeading('K.  8턴 — 상대 빗나감  /  9턴 시작'),
      spacer(60, 0),
      makeTable(turn8Rows),
      spacer(360, 0),

      // ── L. 9턴 — 지휘관 ──────────────────────────────────────────────────
      sectionHeading('L.  9턴 — 지휘관 공격'),
      spacer(60, 0),
      makeTable(turn9Rows),
      spacer(360, 0),

      // ── M. 10턴 — 공주·쥐장수 ────────────────────────────────────────────
      sectionHeading('M.  10턴 — 공주 · 쥐장수 등장  /  11턴 시작'),
      spacer(60, 0),
      makeTable(turn10Rows),
      spacer(360, 0),

      // ── N. 11턴 — 자유 진행 ───────────────────────────────────────────────
      sectionHeading('N.  11턴 — 게임 설명 · 자유 진행 안내'),
      spacer(60, 0),
      makeTable(turn11Rows),
      spacer(360, 0),

      // ── O. 승리 ───────────────────────────────────────────────────────────
      sectionHeading('O.  승리'),
      spacer(60, 0),
      makeTable(victoryRows),
      spacer(300, 0),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = 'CALIGO_tutorial_sequence_v20260514m.docx';
  fs.writeFileSync(outPath, buf);
  console.log('✅ 생성 완료:', outPath);
}).catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
