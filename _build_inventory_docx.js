// CALIGO 로그/토스트 인벤토리 — 워드 문서 생성 스크립트
// Usage: node _build_inventory_docx.js
// Output: CALIGO_log_toast_inventory.docx

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageOrientation, PageBreak, LevelFormat,
} = require('docx');

// ---------- Page / width constants (A4 Landscape — wider for 5 cols) ----------
const PAGE_W = 16838;  // A4 long edge
const PAGE_H = 11906;  // A4 short edge
const MARGIN = 720;    // 0.5 inch
const CONTENT_W = PAGE_W - MARGIN * 2;  // 15398 DXA

// Column widths for 4-col tables (1v1)  — Event / Self / Opp / Spec
const COL4 = [3000, 4200, 4200, 4000];   // sum = 15400
// Column widths for 5-col tables (Team) — Event / Self / Opp / Ally / Spec
const COL5 = [2600, 3300, 3300, 3300, 2900]; // sum = 15400

const border = { style: BorderStyle.SINGLE, size: 4, color: "888888" };
const borders = { top: border, bottom: border, left: border, right: border };

// ---------- Helpers ----------
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: text || '', font: 'Arial', size: opts.size || 18, bold: !!opts.bold, color: opts.color || '000000' })],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 0 },
  });
}
function pBold(text, opts = {}) { return p(text, { ...opts, bold: true }); }
function lines(arr, opts = {}) {
  if (!arr || !arr.length) return [p('(없음)', { color: '999999', size: 16 })];
  return arr.map(t => p(t, { size: opts.size || 18 }));
}

function makeCell(content, opts = {}) {
  let children;
  if (Array.isArray(content)) {
    children = content.flat();
  } else if (typeof content === 'string') {
    children = [p(content, { size: 18 })];
  } else {
    children = [content];
  }
  return new TableCell({
    borders,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children,
  });
}

function headerRow(headers, cols) {
  return new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => makeCell([pBold(h, { size: 18, align: AlignmentType.CENTER })], {
      width: cols[i], shading: 'D5E8F0',
    })),
  });
}

// row: { event, self, opp, ally?, spec, note? }
function dataRow(row, cols) {
  const cells = [];
  // event cell (with optional note)
  const evChildren = [pBold(row.event, { size: 18 })];
  if (row.note) evChildren.push(p('▸ ' + row.note, { size: 14, color: '666666' }));
  cells.push(makeCell(evChildren, { width: cols[0] }));
  cells.push(makeCell(lines(row.self), { width: cols[1] }));
  cells.push(makeCell(lines(row.opp), { width: cols[2] }));
  if (cols.length === 5) cells.push(makeCell(lines(row.ally), { width: cols[3] }));
  cells.push(makeCell(lines(row.spec), { width: cols[cols.length - 1] }));
  return new TableRow({ children: cells });
}

function buildTable(rows, cols, isTeam) {
  const headers = isTeam
    ? ['이벤트', '본인', '상대', '팀원', '관전자']
    : ['이벤트', '본인', '상대', '관전자'];
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: cols,
    rows: [headerRow(headers, cols), ...rows.map(r => dataRow(r, cols))],
  });
}

function sectionHeader(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: 'Arial', size: 32, bold: true })],
  });
}
function subHeader(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: '2E75B6' })],
  });
}

// ============================================================================
// DATA — 모든 메시지는 코드에서 직접 추출 (server.js + public/game.js)
// ============================================================================

// --- A. 게임 흐름 ---
const A_ROWS_1V1 = [
  {
    event: '게임 시작 (정상 신규)',
    self: ['addLog: "선공" 또는 "후공"', '오버레이 제목: "전투 개시"', '오버레이 부제: "선공" / "후공"'],
    opp:  ['addLog: "선공" 또는 "후공"', '오버레이 제목: "전투 개시"', '오버레이 부제: "선공" / "후공"'],
    spec: ['spectator_log: "전투 개시. 선공은 ${name}"'],
  },
  {
    event: '재접속',
    self: ['addLog: "${turnOwnerName}의 턴"', '오버레이 제목: "재접속"', '오버레이 부제: "${turnOwnerName}의 턴"', '토스트: "재접속" (event)'],
    opp:  ['(없음)'],
    spec: ['(없음 — 본인만)'],
    note: '재접속한 본인에게만 표시',
  },
  {
    event: '턴 변경',
    self: ['addLog: "${turnNumber}턴 : ${myN()} 차례"'],
    opp:  ['addLog: "${turnNumber}턴 : ${oppN()} 차례"'],
    spec: ['spectator_log: "${turnNumber}턴 : ${curPlayer.name} 차례"'],
  },
  {
    event: '턴 스킵 (행동·스킬 없음)',
    self: ['addLog + 토스트: "⏰ ${name}의 턴 스킵"'],
    opp:  ['addLog + 토스트: "⏰ ${name}의 턴 스킵"'],
    spec: ['spectator_log: "⏰ ${name}의 턴 스킵"'],
  },
  {
    event: '턴 강제 종료 (타임아웃)',
    self: ['addLog + 토스트: "⏰ ${name}의 턴 강제 종료"'],
    opp:  ['addLog + 토스트: "⏰ ${name}의 턴 강제 종료"'],
    spec: ['spectator_log: "⏰ ${name}의 턴 강제 종료"'],
  },
  {
    event: 'SP 지급 (sp_grant)',
    self: ['addLog: "새로운 SP가 지급되었습니다"', '(풀스크린 애니, 토스트 없음)'],
    opp:  ['addLog: "새로운 SP가 지급되었습니다"'],
    spec: ['spectator_log: "새로운 SP가 지급되었습니다"'],
  },
  {
    event: '1대1 대치 감지 (stalemate_shrink)',
    self: ['addLog + 풀스크린: "1대1 대치 상황: 5턴 후 보드가 축소됩니다."'],
    opp:  ['addLog + 풀스크린: "1대1 대치 상황: 5턴 후 보드가 축소됩니다."'],
    spec: ['(클라이언트가 관전자에게 표시 차단)'],
  },
  {
    event: '일반 turn_event',
    self: ['addLog + 토스트: "⚡ ${msg}"'],
    opp:  ['addLog + 토스트: "⚡ ${msg}"'],
    spec: ['addLog + 토스트: "⚡ ${msg}"'],
  },
  {
    event: '연결 끊김 (30초 대기)',
    self: ['addLog + 토스트(event): "🔌 ${dcName}${조사} 연결이 끊겼습니다. 30초 동안 재접속을 기다립니다..."'],
    opp:  ['(수신 불가 — 끊긴 사람)'],
    spec: ['spectator_log: "${dcName} 연결 끊김"'],
  },
  {
    event: '재접속 실패 (기권패 처리)',
    self: ['addLog: "${dcName} 기권패"', '게임오버 화면'],
    opp:  ['(수신 불가)'],
    spec: ['spectator_log: "🔌 ${dcName} 재접속 실패. 패배 처리."', 'disconnected msg: "${dcName} 기권패"'],
  },
];

const A_ROWS_TEAM = [
  {
    event: '게임 시작 (팀전)',
    self: ['오버레이: "전투 개시" / "선공" or "후공"'],
    opp:  ['오버레이: "전투 개시" / "선공" or "후공"'],
    ally: ['오버레이: "전투 개시" / "선공" or "후공"'],
    spec: ['spectator_log: "전투 개시. 선공은${first?.name || \'?\'}"'],
    note: "'선공은' 뒤 공백 없음 (코드 상태)",
  },
  {
    event: '턴 변경 (team_game_update)',
    self: ['addLog: "${turn}턴 : ${myN()|cur.name} 차례"', '토스트: "내 차례" (본인 차례인 경우)'],
    opp:  ['addLog: "${turn}턴 : ${cur.name} 차례"', '(토스트 없음)'],
    ally: ['addLog: "${turn}턴 : ${cur.name} 차례"', '(토스트 없음)'],
    spec: ['spectator_log: "${turnNumber}턴 : ${cur.name}의 차례"'],
  },
  {
    event: '턴 스킵 / 강제 종료',
    self: ['(1v1과 동일)'],
    opp:  ['(1v1과 동일)'],
    ally: ['(1v1과 동일)'],
    spec: ['(1v1과 동일)'],
  },
];

// --- B. 이동 ---
const B_ROWS_1V1 = [
  {
    event: '자기 말 이동 (move_ok)',
    self: ['addLog + 토스트: "${pc.name} 이동"'],
    opp:  ['addLog + 토스트: "상대가 이동했습니다."'],
    spec: ['spectator_log: "${player.name}, ${piece.icon}${piece.name} 이동"'],
    note: '서버 payload msg: "${name}${조사} 이동했습니다." (클라 무시, 하드코드 사용)',
  },
  {
    event: '표식된 적 이동',
    self: ['(로그·토스트 없음 — 셀 플래시 애니메이션만)'],
    opp:  ['(없음)'],
    spec: ['(없음)'],
    note: 'marked-move-flash 클래스만 적용',
  },
  {
    event: '쌍둥이 강도 이동 (분신 합류)',
    self: ['addLog + 토스트: "쌍둥이 강도 이동"'],
    opp:  ['(없음 — 분신 합류는 자체 처리)'],
    spec: ['(spectator_log 별도 없음)'],
  },
];

const B_ROWS_TEAM = [
  {
    event: '자기 말 이동',
    self: ['addLog + 토스트: "${pc.name} 이동"'],
    opp:  ['addLog + 토스트: "상대가 이동했습니다."'],
    ally: ['addLog + 토스트: "${moverName} 이동" (team_ally_moved)'],
    spec: ['spectator_log: "${player.name}, ${piece.icon}${piece.name} 이동"'],
  },
  {
    event: '표식된 적 이동',
    self: ['(셀 플래시 애니메이션만)'],
    opp:  ['(없음)'],
    ally: ['(없음)'],
    spec: ['(없음)'],
  },
];

// --- C. 공격 ---
const C_ROWS_1V1 = [
  {
    event: '빗나감 (Miss)',
    self: ['addLog + 토스트: "빗나감"'],
    opp:  ['addLog + 토스트: "${oppN()} 공격 빗나감"'],
    spec: ['spectator_log: "${player.name} 공격 빗나감"'],
  },
  {
    event: '일반 피격 (Hit, 사망 아님)',
    self: ['addLog: "${coords} 명중"', '(토스트 없음 — 사용자 요청)'],
    opp:  ['토스트: "공격받았습니다!"', 'addLog: "${hitLabels} 피격"'],
    spec: ['spectator_log (type=hit) hit/destroyed 분기'],
  },
  {
    event: '격파 (Kill)',
    self: ['토스트: "${labels} 격파!"', 'addLog: "${coords} ${labels} 격파"'],
    opp:  ['토스트: "${killedLabels} 격파!"', 'addLog: "${killedLabels} 격파"'],
    spec: ['spectator_log: "${pl.name}의 ${name} 사망" (분기 결과)'],
  },
  {
    event: '쥐 격파',
    self: ['토스트 + addLog: "🐀 ${coords}의 쥐 격파함"'],
    opp:  ['토스트 + addLog: "🐀 ${coords}의 쥐 격파됨"'],
    spec: ['(동일 메시지 분배)'],
  },
  {
    event: '폭탄 피해 (bomb_detonated)',
    self: ['addLog: "${labels} 폭탄 피해"', '격파 시 추가: 토스트 + addLog "${labels} 격파!"'],
    opp:  ['addLog: "${labels} 폭탄 피해"', '격파 시: 토스트 + addLog "${labels} 격파!"'],
    spec: ['(클라이언트 분배 동일)'],
  },
  {
    event: '덫 발동 (trap_triggered)',
    self: ['addLog + 토스트: "🪤 덫 발동!"'],
    opp:  ['addLog + 토스트: "🪤 덫 발동!"'],
    spec: ['addLog + 토스트: "🪤 덫 발동!"'],
  },
];

const C_ROWS_TEAM = C_ROWS_1V1.map(r => ({
  ...r,
  ally: (() => {
    if (r.event.startsWith('빗나감')) return ['team_ally_attacked: addLog + 토스트 "빗나감"', '(team_ally_hit 본체 빗나감은 메시지 없음)'];
    if (r.event.startsWith('일반 피격')) return ['team_ally_hit: 토스트 "공격받았습니다!" + addLog "${hitLabels} 피격"', 'team_ally_attacked: addLog "${coords} 명중"'];
    if (r.event.startsWith('격파')) return ['team_ally_hit: 토스트 + addLog "${labels} 격파!"', 'team_ally_attacked: 토스트 + addLog "${coords} ${labels} 격파"'];
    if (r.event.startsWith('쥐')) return ['(같은 편 격파 처리)'];
    if (r.event.startsWith('폭탄')) return ['(클라 동일)'];
    if (r.event.startsWith('덫')) return ['addLog + 토스트: "🪤 덫 발동!"'];
    return ['(동일)'];
  })(),
}));

// --- D. 패시브 ---
const D_ROWS_1V1 = [
  {
    event: '가호 (공격용) — 수도승 → 악인',
    self: ['passive_alert: "🙏 가호: 악인 공격 시 3 피해"'],
    opp:  ['passive_alert: "🙏 가호: 악인 공격 시 3 피해"'],
    spec: ['spectator_log: "🙏 가호: 악인 공격 시 3 피해"'],
  },
  {
    event: '가호 (방어용) — 수도승 피격 시',
    self: ['passive_alert: "🙏 가호: 악인 공격 피해 0.5로 감소"'],
    opp:  ['passive_alert: "🙏 가호: 악인 공격 피해 0.5로 감소"'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '아이언 스킨 — 갑주무사',
    self: ['passive_alert: "🛡 아이언 스킨: 피해 0.5 감소"'],
    opp:  ['passive_alert: "🛡 아이언 스킨: 피해 0.5 감소"'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '폭정 (백작) — 1·2티어 공격 시',
    self: ['passive_alert: "🦇 폭정: ${tier}티어 공격 피해 0.5 감소"'],
    opp:  ['passive_alert: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '충성 (호위무사) — 1 피해 대신',
    self: ['passive_alert: "🛡 충성: ${namesStr} 대신 1 피해"'],
    opp:  ['passive_alert: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '충성 (호위무사) — 저주 대신 받음',
    self: ['passive_alert: "🛡 충성: ${target.name} 대신 저주를 받음"'],
    opp:  ['passive_alert: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '배반자 (학살영웅)',
    self: ['(별도 텍스트 없음 — friendly fire 일반 피격 메시지만)'],
    opp:  ['(별도 텍스트 없음)'],
    spec: ['(별도 텍스트 없음)'],
    note: '카드 UI 효과로만 표시',
  },
  {
    event: '인스턴트 매직 — 마법사 피격 시 +1 SP',
    self: ['passive_alert: "🧙 인스턴트 매직 : SP 획득"'],
    opp:  ['passive_alert: "🧙 인스턴트 매직 : SP 획득"'],
    spec: ['spectator_log: 동일'],
    note: '이모지 🧙 사용자 검토 필요 (마녀 아이콘으로 보일 수 있음)',
  },
  {
    event: '표식 — 고문기술자 공격 시 (인두 낙하)',
    self: ['passive_alert: "⛓ 표식: ${names}에게 표식 새김"'],
    opp:  ['passive_alert: "⛓ 표식: ${names}에게 표식 새김"'],
    spec: ['spectator_log: "⛓ 표식 발동" + per-owner "⛓ 표식: ${names}에게 표식 새김"'],
  },
  {
    event: '사기증진 — 지휘관 인접',
    self: ['(별도 메시지 없음 — 카드 UI 표시만)'],
    opp:  ['(별도 메시지 없음)'],
    spec: ['(별도 메시지 없음)'],
  },
  {
    event: '저주 지속 피해 (curse_tick)',
    self: ['addLog: "☠ 저주: ${targetName} ${dmgStr} 피해"', '(토스트 없음 — 사용자 요청)'],
    opp:  ['addLog: 동일'],
    spec: ['(curse_tick 별도 spectator emit 없음 — 직접 수신)'],
  },
  {
    event: '저주 해제 — 마녀 사망',
    self: ['passive_alert: "☠ 저주: 마녀가 사망해 ${p.name}의 저주 해제"'],
    opp:  ['passive_alert: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '저주 해제 — 체력 고갈',
    self: ['passive_alert: "☠ 저주: 체력 고갈로 ${p.name}의 저주 해제"'],
    opp:  ['passive_alert: 동일'],
    spec: ['spectator_log: 동일'],
  },
];

const D_ROWS_TEAM = D_ROWS_1V1.map(r => ({
  ...r,
  ally: ['(본인과 동일)'],
}));

// --- E. 스킬 ---
const E_ROWS_1V1 = [
  {
    event: '🔭 정찰 (척후병)',
    self: ['addLog + 토스트 (scout_result): "🔭 정찰: 상대 ${targetName}의 위치는 ${label}"', 'label = "${ROW_LABELS[v]}열" or "${v+1}행"'],
    opp:  ['status_update msg: "🔭 정찰: 상대가 ${target.name}의 위치를 알아냈습니다."'],
    spec: ['spectator_log: "🔭 정찰: 상대 ${target.name}의 위치는 ${labelStr}"'],
  },
  {
    event: '🐀 역병의 자손들 (쥐 장수)',
    self: ['addLog + 토스트: "🐀 역병의 자손들: 쥐 ${rats.length}마리 소환"'],
    opp:  ['addLog + 토스트: "🐀 역병의 자손들: 상대가 쥐 소환. 쥐는 공격으로 제거 가능"'],
    spec: ['spectator_log: "🐀 역병의 자손들: 쥐 ${newRats.length}마리 소환"'],
  },
  {
    event: '🐉 드래곤 소환 (드래곤 조련사)',
    self: ['addLog + 토스트: "🐉 드래곤 소환: ${coord}에 드래곤 소환"'],
    opp:  ['addLog + 토스트: "🐉 드래곤 소환: 상대가 ${coord}에 드래곤 소환"'],
    spec: ['spectator_log: "🐉 드래곤 소환: ${coord(dc,dr)}에 드래곤 소환"'],
  },
  {
    event: '💣 폭탄 설치 (화약상)',
    self: ['skill_result msg: "💣 폭탄 설치: 설치 완료"'],
    opp:  ['status_update msg: "💣 폭탄 설치: 상대의 폭탄 설치"'],
    spec: ['spectator_log: "💣 폭탄 설치: ${playerName}의 폭탄 설치"'],
  },
  {
    event: '💥 기폭 (화약상)',
    self: ['msg: "💥기폭: 폭탄 폭발!"'],
    opp:  ['msg: "💥기폭: 폭탄 폭발!"'],
    spec: ['spectator_log: "💥기폭: 폭탄 폭발!"'],
  },
  {
    event: '🪤 덫 설치 (인간사냥꾼)',
    self: ['msg: "🪤 덫 설치: 설치 완료"'],
    opp:  ['msg: "🪤 덫 설치: 상대의 덫 설치"'],
    spec: ['spectator_log: "🪤 덫 설치: ${playerName}의 덫 설치"'],
  },
  {
    event: '🪤 덫 발동',
    self: ['addLog + 토스트: "🪤 덫 발동!"'],
    opp:  ['addLog + 토스트: "🪤 덫 발동!"'],
    spec: ['spectator_log: "🪤 덫 발동!"'],
  },
  {
    event: '☠ 저주 (마녀)',
    self: ['msg: "☠ 저주: ${target.name}${조사}을/를 저주"'],
    opp:  ['oppMsg: "☠ 저주: 상대 마녀가 ${target.name}${조사}을/를 저주"'],
    spec: ['spectator_log: "☠ 저주: ${tName}${조사}을/를 저주"'],
  },
  {
    event: '🙏 신성 (수도승)',
    self: ['msg: "🙏 신성: ${target.name}의 상태이상 제거, 2 HP 회복"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '🌿 약초학 (약초전문가)',
    self: ['msg: "🌿 약초학: 범위 내 아군 1 HP 회복"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '👻 그림자 숨기 (그림자 암살자)',
    self: ['msg: "👻 그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
    note: '※ 액티브 스킬임 (패시브 아님)',
  },
  {
    event: '🏹 정비 (궁수) — 대각선 방향',
    self: ['msg: "🏹 정비: 공격 방향 전환"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '⚒ 정비 (무기상) — 가로/세로 방향',
    self: ['msg: "⚒ 정비: 공격 방향 전환"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '📯 질주 (전령)',
    self: ['msg: "📯 질주: 전령은 추가 이동 가능"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '👫 분신 (쌍둥이 합류)',
    self: ['msg: "👫 분신: ${moverSubject} ${targetLabel} 위치로 합류"', 'moverSubject = "누나가" or "동생이"', 'targetLabel = "누나" or "동생"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '⚔ 쌍검무 (양손검객)',
    self: ['msg: "⚔ 쌍검무: 양손검객은 추가 공격 가능"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '♛ 절대복종 반지 (국왕)',
    self: ['msg: "♛ 절대복종 반지: ${enemyPiece.name}${조사}을/를 강제 이동"'],
    opp:  ['oppMsg: "♛ 반지: 상대 국왕이 ${enemyPiece.name}${조사}을/를 강제 이동"'],
    spec: ['spectator_log: "♛ 반지: ${playerName}의 국왕이 ${target}${조사}을/를 강제 이동"'],
  },
  {
    event: '🔥 유황범람 (유황솥)',
    self: ['msg: "🔥 유황범람: 보드 외곽 전체 2 피해"'],
    opp:  ['msg: 동일'],
    spec: ['spectator_log: 동일'],
  },
  {
    event: '⛓ 악몽 (고문기술자) — 표식 적 일제 1 피해',
    self: ['msg: "⛓ 악몽 발동"'],
    opp:  ['msg: "⛓ 악몽 발동"'],
    spec: ['spectator_log: "⛓ 악몽: 모든 표식 상태 유닛 1 피해"'],
    note: '사용자 요청으로 "악몽 발동" 한 줄만 노출',
  },
];

const E_ROWS_TEAM = E_ROWS_1V1.map(r => ({
  ...r,
  ally: ['(시전자 메시지와 동일 — team_skill_notice allyMsg fallback)'],
}));

// --- F. 보드 축소 ---
const F_ROWS_1V1 = [
  {
    event: '보드 축소 경고 박스 (board_shrink_warning)',
    self: ['우상단 박스: "외곽 파괴까지 ${turnsRemaining}턴"', '대치 상황: "1대1 대치 외곽 파괴까지 ${turnsRemaining}턴"', '(addLog/토스트 없음)'],
    opp:  ['(동일)'],
    spec: ['spectator_log: "외곽 파괴까지 ${remaining}턴"'],
  },
  {
    event: '보드 축소 첫 경고 (turnsRemaining===10)',
    self: ['풀스크린 오버레이: "보드 파괴 시작" / "안쪽으로 대피하세요."'],
    opp:  ['(동일)'],
    spec: ['(동일)'],
  },
  {
    event: '보드 축소 실행 (board_shrink)',
    self: ['토스트 + addLog: "🔥 보드 외곽 파괴"'],
    opp:  ['토스트 + addLog: "🔥 보드 외곽 파괴"'],
    spec: ['spectator_log: "🔥 보드 외곽 파괴"'],
  },
  {
    event: '외곽 말 파괴',
    self: ['addLog: "💀 ${myLabel}의 ${formatGroup(myGroup)} 탈락"', 'addLog: "💀 ${oppLabel}의 ${formatGroup(oppGroup)} 탈락"', '(토스트 없음)'],
    opp:  ['(동일)'],
    spec: ['addLog: "💀 ${formatGroup(list)} 탈락" (player별 한 줄)'],
    note: 'myLabel: 팀전 "우리 편" / 1v1 myN() | oppLabel: 팀전 "적 편" / 1v1 oppN()',
  },
];

const F_ROWS_TEAM = F_ROWS_1V1.map(r => ({ ...r, ally: ['(본인과 동일)'] }));

// --- G. 1대1 대치 / 무행동 ---
const G_ROWS = [
  {
    event: '1대1 대치 감지 (stalemate_shrink)',
    self: ['addLog: "1대1 대치 상황: 5턴 후 보드가 축소됩니다."', '풀스크린 알림'],
    opp:  ['addLog: 동일', '풀스크린 알림'],
    spec: ['(클라가 isSpectator 조건으로 차단)'],
  },
];

// --- H. 게임 종료 ---
function endRowsByMode(isTeam) {
  // 1v1 / 팀전 공통 종료 사유 매핑 (사용자 카탈로그 — 각자 메시지 직접 확인 가능하도록)
  const rows = [];
  // 승리
  rows.push({
    event: isTeam ? '팀 승리 (surrender)' : '승리 (surrender)',
    self: ['아이콘: 🏆', '제목: ' + (isTeam ? '"승리"' : '"승리"'), '부제: "${L}의 기권입니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(승리한 팀원 — 본인과 동일 메시지)'] : undefined,
    spec: ['아이콘: 👁', '제목: "게임 종료"', '부제: "${L}의 기권으로, ${W}의 승리입니다."'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (shrink)' : '승리 (shrink)',
    self: ['🏆 / 팀 승리', isTeam ? '"${L}${조사}이/가 보드 축소를 피하지 못해 승리했습니다."' : '"상대가 보드 축소를 피하지 못해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / 게임 종료 / "보드 축소로 ${L}의 말이 전멸해 ${W}의 승리"'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (trap)' : '승리 (trap)',
    self: ['🏆 / 팀 승리', isTeam ? '"덫으로 ${L}의 모든 유닛을 제거해 승리했습니다."' : '"덫으로 상대의 모든 말을 제거해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / 게임 종료 / "덫으로 상대의 모든 말을 제거해 ${W}의 승리"'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (bomb)' : '승리 (bomb)',
    self: ['🏆 / 팀 승리', isTeam ? '"폭탄으로 ${L}의 모든 유닛을 제거해 승리했습니다."' : '"폭탄으로 상대의 모든 말을 제거해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / 게임 종료 / "폭탄으로 상대의 모든 말을 제거해 ${W}의 승리"'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (sulfur)' : '승리 (sulfur)',
    self: ['🏆 / 팀 승리', isTeam ? '"유황범람으로 ${L}의 모든 유닛을 제거해 승리했습니다."' : '"유황범람으로 상대의 모든 말을 제거해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / "유황범람으로 상대의 모든 말을 제거해 ${W}의 승리"'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (nightmare)' : '승리 (nightmare)',
    self: ['🏆 / 팀 승리', isTeam ? '"악몽으로 ${L}의 모든 유닛을 제거해 승리했습니다."' : '"악몽으로 상대의 모든 말을 제거해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / "악몽으로 상대의 모든 말을 제거해 ${W}의 승리"'],
  });
  rows.push({
    event: isTeam ? '팀 승리 (attack/default)' : '승리 (attack/default)',
    self: ['🏆 / 팀 승리', isTeam ? '"${L}의 모든 유닛을 제거해 승리했습니다."' : '"${opponentName}의 모든 유닛을 제거해 승리했습니다."'],
    opp:  ['(패배 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['👁 / "${W}의 승리"'],
  });

  // 패배
  rows.push({
    event: isTeam ? '팀 패배 (surrender)' : '패배 (surrender)',
    self: ['아이콘: ' + (isTeam ? '🏳' : '💀'), '제목: "기권"', '부제: "기권하여 패배했습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (shrink)' : '패배 (shrink)',
    self: ['💀 / 패배 / "보드 축소를 피하지 못해 패배하였습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (trap)' : '패배 (trap)',
    self: ['💀 / 패배 / "덫으로 모든 유닛이 쓰러져 패배하였습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (bomb)' : '패배 (bomb)',
    self: ['💀 / 패배 / "폭탄으로 모든 유닛이 쓰러져 패배하였습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (sulfur)' : '패배 (sulfur)',
    self: ['💀 / 패배 / "유황범람으로 모든 유닛이 쓰러져 패배하였습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (nightmare)' : '패배 (nightmare)',
    self: ['💀 / 패배 / "악몽으로 모든 유닛이 쓰러져 패배하였습니다."'],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });
  rows.push({
    event: isTeam ? '팀 패배 (attack/default)' : '패배 (attack/default)',
    self: ['💀 / 패배 / ' + (isTeam ? '"${L}에게 패배했습니다."' : '"${opponentName}에게 패배했습니다."')],
    opp:  ['(승리 행 참조)'],
    ally: isTeam ? ['(본인과 동일)'] : undefined,
    spec: ['(승리 spec 참조)'],
  });

  // 무승부
  rows.push({
    event: '무승부 (unreachable_draw)',
    self: ['🤝 / 무승부 / "게임을 끝낼 수 없어 무승부입니다."'],
    opp:  ['🤝 / 무승부 / "게임을 끝낼 수 없어 무승부입니다."'],
    ally: isTeam ? ['🤝 / 무승부 / "게임을 끝낼 수 없어 무승부입니다."'] : undefined,
    spec: ['🤝 / 무승부 / "게임을 끝낼 수 없어 무승부입니다."'],
  });
  rows.push({
    event: '무승부 (simultaneous_draw)',
    self: ['🤝 / ' + (isTeam ? '"폭탄 폭발로 양 팀 모든 유닛이 동시에 전멸했습니다."' : '"폭탄 폭발로 양 측 모든 유닛이 동시에 전멸했습니다."')],
    opp:  ['(동일)'],
    ally: isTeam ? ['(동일)'] : undefined,
    spec: ['(동일)'],
  });
  rows.push({
    event: '무승부 (default — 양측 전멸)',
    self: ['🤝 / "보드 축소로 양 팀 모든 말이 전멸해 무승부입니다."'],
    opp:  ['(동일)'],
    ally: isTeam ? ['(동일)'] : undefined,
    spec: ['(동일)'],
  });

  return rows;
}

// 기권/이탈 spec 메시지
const H_LEAVE_ROWS = [
  {
    event: '1v1 게임 중 기권',
    self: ['(패배 행 참조)'],
    opp:  ['(승리 행 참조)'],
    spec: ['spectator_log: "🏳 ${name}${조사}이/가 기권했습니다!"'],
  },
  {
    event: '1v1 세팅 단계 이탈',
    self: ['(없음 — 방 나감)'],
    opp:  ['(상대가 빠지면 방 리셋)'],
    spec: ['spectator_log: "🚪 ${name}${조사}이/가 게임을 나갔습니다."'],
  },
  {
    event: '팀전 기권',
    self: ['(팀 패배 처리)'],
    opp:  ['(팀 승리 처리)'],
    spec: ['spectator_log: "🏳 ${name}${조사}이/가 기권했습니다! ${블루|레드}팀 패배."'],
  },
];

// ============================================================================
// DOC BUILD
// ============================================================================
const children = [];

// Cover
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 1200, after: 200 },
  children: [new TextRun({ text: 'CALIGO', font: 'Arial', size: 96, bold: true, color: '1F4E79' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 800 },
  children: [new TextRun({ text: '로그 / 토스트 인벤토리', font: 'Arial', size: 48, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: '1v1 · 팀전 모드 메시지 카탈로그', font: 'Arial', size: 28, color: '666666' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 1600 },
  children: [new TextRun({ text: '작성일: 2026-05-12 · 소스 직접 추출', font: 'Arial', size: 22, color: '888888' })],
}));

// 목적
children.push(subHeader('작성 목적'));
children.push(p('이 문서는 CALIGO 보드게임의 1v1 / 팀전 모드에서 발생하는 모든 로그 및 토스트 메시지를 카테고리별로 정리한 카탈로그입니다.', { size: 20 }));
children.push(p('각 메시지는 코드(server.js / public/game.js)에서 직접 추출했으며, 본인 / 상대 / 팀원 / 관전자 각 시점별 표시 텍스트를 모두 포함합니다.', { size: 20 }));
children.push(p('사용자는 이 카탈로그를 기반으로 메시지 문구를 직접 수정·정리할 수 있습니다 (불필요한 이모티콘 제거, 문장 다듬기 등).', { size: 20 }));

children.push(subHeader('카테고리 구성'));
[
  'A. 게임 흐름 (시작·턴 변경·재접속·종료 등)',
  'B. 이동',
  'C. 공격 (빗나감 / 피격 / 격파)',
  'D. 패시브',
  'E. 스킬',
  'F. 보드 축소',
  'G. 1대1 대치',
  'H. 게임 종료 (승/패/무)',
].forEach(t => children.push(p('• ' + t, { size: 20 })));

children.push(subHeader('표 컬럼 안내'));
children.push(p('• 본인: 행동을 한 플레이어 / 본인 시점에서 표시되는 메시지', { size: 20 }));
children.push(p('• 상대: 적팀 또는 상대 플레이어 시점', { size: 20 }));
children.push(p('• 팀원: (팀전 표만) — 같은 팀의 다른 플레이어 시점', { size: 20 }));
children.push(p('• 관전자: 관전자 시점 (spectator_log)', { size: 20 }));

children.push(new Paragraph({ children: [new PageBreak()] }));

// 카테고리별 표 출력 함수
function appendCategory(title, sectionLabel1v1, rows1v1, sectionLabelTeam, rowsTeam) {
  children.push(sectionHeader(title));
  if (rows1v1 && rows1v1.length) {
    children.push(subHeader(sectionLabel1v1 || '1v1 모드'));
    children.push(buildTable(rows1v1, COL4, false));
  }
  if (rowsTeam && rowsTeam.length) {
    children.push(subHeader(sectionLabelTeam || '팀전 모드'));
    children.push(buildTable(rowsTeam, COL5, true));
  }
  children.push(p('', { size: 8 })); // spacer
}

appendCategory('A. 게임 흐름', '1v1 모드', A_ROWS_1V1, '팀전 모드 (추가/변경 사항)', A_ROWS_TEAM);
appendCategory('B. 이동',     '1v1 모드', B_ROWS_1V1, '팀전 모드',                 B_ROWS_TEAM);
appendCategory('C. 공격',     '1v1 모드', C_ROWS_1V1, '팀전 모드',                 C_ROWS_TEAM);
appendCategory('D. 패시브',   '1v1 모드', D_ROWS_1V1, '팀전 모드',                 D_ROWS_TEAM);
appendCategory('E. 스킬',     '1v1 모드', E_ROWS_1V1, '팀전 모드',                 E_ROWS_TEAM);
appendCategory('F. 보드 축소', '1v1 모드', F_ROWS_1V1, '팀전 모드',                 F_ROWS_TEAM);
appendCategory('G. 1대1 대치', '공통',    G_ROWS,    null,                        null);

// H. 게임 종료
children.push(sectionHeader('H. 게임 종료'));
children.push(subHeader('1v1 모드'));
children.push(buildTable(endRowsByMode(false), COL4, false));
children.push(p('', { size: 8 }));
children.push(subHeader('팀전 모드'));
children.push(buildTable(endRowsByMode(true), COL5, true));
children.push(p('', { size: 8 }));
children.push(subHeader('기권 / 이탈 — 관전자 메시지'));
children.push(buildTable(H_LEAVE_ROWS, COL4, false));

// 끝 — 참고
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(sectionHeader('부록 — 메시지 헬퍼 / 채널 참조'));
children.push(p('addLog(msg, type)               : game.js:14114 — 로그 패널 한 줄 추가', { size: 18 }));
children.push(p('showSkillToast(msg, isEnemy, specIdx, type) : game.js:14972 — 화면 우측 토스트 알림', { size: 18 }));
children.push(p('emitToBoth(room, event, data)   : server.js:3960 — 양 플레이어 동시 전송', { size: 18 }));
children.push(p('emitToPlayer(room, idx, event, data) : server.js:3972 — 특정 플레이어 전송', { size: 18 }));
children.push(p('emitToSpectators(room, event, data) : server.js:3979 — 관전자 전송', { size: 18 }));
children.push(p('buildSpectatorSkillMsg(name, piece, result) : server.js:3919 — 관전자용 스킬 메시지 빌더', { size: 18 }));

children.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: '주요 서버→클라 채널 (log/toast):', font: 'Arial', size: 20, bold: true })] }));
[
  'log / spectator_log / no_action_notice / passive_alert / skill_result',
  'status_update / team_skill_notice / game_over / team_game_over',
  'opp_moved / team_ally_moved / being_attacked / team_ally_hit / team_ally_attacked',
  'disconnected / opp_disconnected_pending / curse_tick',
  'scout_result / rats_spawned / dragon_spawned / trap_triggered / bomb_detonated',
  'board_shrink / board_shrink_warning / turn_event(sp_grant, stalemate_shrink)',
  'err / wait_msg',
].forEach(t => children.push(p('• ' + t, { size: 18 })));

// Build doc
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 18 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '1F4E79' },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H, orientation: PageOrientation.LANDSCAPE },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children,
  }],
});

const OUT = path.join(__dirname, 'CALIGO_log_toast_inventory.docx');
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT, buffer);
  console.log('Generated:', OUT, '(', buffer.length, 'bytes )');
}).catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
