/**
 * CALIGO Log / Toast Inventory DOCX Generator
 * Generates a comprehensive catalog of all in-game log and toast messages.
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageBreak, PageNumber
} = require('C:/Users/user/AppData/Roaming/npm/node_modules/docx');

// ── Constants ──
const PAGE_W = 15840; // Landscape US Letter width (DXA)
const PAGE_H = 12240; // Landscape US Letter height (DXA)
const MARGIN = 1080;  // 0.75 inch margins
const CONTENT_W = PAGE_W - MARGIN * 2; // 13680

// Colors
const C_PRIMARY = '1B3A5C';   // deep navy
const C_ACCENT  = '2E75B6';   // blue accent
const C_HEAD_BG = 'D5E8F0';   // light blue header
const C_ALT_BG  = 'F2F7FA';   // alternating row
const C_LIGHT   = '999999';   // light gray text
const C_WHITE   = 'FFFFFF';

// Borders
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Helpers ──
function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: C_PRIMARY, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, font: 'Arial', size: 18, color: C_WHITE })]
    })]
  });
}

function dataCell(text, width, isAlt = false) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: isAlt ? { fill: C_ALT_BG, type: ShadingType.CLEAR } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({ text: text || '—', font: 'Arial', size: 17, color: text ? '222222' : 'AAAAAA' })]
    })]
  });
}

// 5-column table: Event / Self / Opponent / Teammate / Spectator
// widths: 2400 / 3000 / 3000 / 2640 / 2640 = 13680
const COL_W = [2400, 3000, 3000, 2640, 2640];
const COL_HEADERS = ['이벤트', '본인', '상대', '팀원 (팀전)', '관전자'];

function makeTable(rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: COL_HEADERS.map((h, i) => headerCell(h, COL_W[i]))
  });
  const dataRows = rows.map((r, idx) => {
    const isAlt = idx % 2 === 1;
    return new TableRow({
      children: r.map((cell, ci) => dataCell(cell, COL_W[ci], isAlt))
    });
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: COL_W,
    rows: [headerRow, ...dataRows]
  });
}

function sectionTitle(letter, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text: `${letter}. ${title}`, bold: true, font: 'Arial', size: 26, color: C_PRIMARY })]
  });
}

function subTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 22, color: C_ACCENT })]
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 60, after: 160 },
    children: [new TextRun({ text, font: 'Arial', size: 16, italics: true, color: C_LIGHT })]
  });
}

// ── Data ──

const dataA = {
  title: '게임 흐름',
  sub: [
    {
      name: '게임 시작',
      rows: [
        ['선공/후공 알림', '선공 / 후공', '—', '—', '전투 개시. 선공은 {name}'],
        ['팀전 게임 시작', '—', '—', '—', '전투 개시. 선공은 {name}'],
      ]
    },
    {
      name: '턴 변경',
      rows: [
        ['내 턴 시작', '{N}턴 : {myName} 차례', '—', '—', '{N}턴 : {name}의 차례'],
        ['상대 턴 시작', '{N}턴 : {oppName} 차례', '—', '—', '{N}턴 : {name} 차례'],
        ['팀전 턴 변경', '{N}턴 : {label} 차례', '—', '—', '{N}턴 : {name}의 차례'],
        ['팀전 내 차례 토스트', '내 차례 (토스트)', '—', '—', '—'],
      ]
    },
    {
      name: '재접속 / 연결 끊김',
      rows: [
        ['재접속 성공', '재접속 (토스트)', '—', '—', '—'],
        ['상대 연결 끊김', '{name}이/가 연결이 끊겼습니다. 30초 대기...', '—', '—', '{name} 연결 끊김'],
        ['재접속 실패', '{name} 재접속 실패. 패배 처리.', '—', '—', '{name} 재접속 실패. 패배 처리.'],
        ['기권패', '—', '{name} 기권패', '—', '{name} 기권패'],
      ]
    },
    {
      name: '기권 / 종료',
      rows: [
        ['1v1 기권', '—', '—', '—', '{name}이/가 기권했습니다!'],
        ['팀전 기권', '—', '—', '—', '{name}이/가 기권했습니다! {team}팀 패배.'],
        ['플레이어 탈락 (팀전)', '{name} 탈락', '{name} 탈락', '{name} 탈락', '{name} 탈락'],
        ['게임 나가기 (설정 중)', '—', '—', '—', '{name}이/가 게임을 나갔습니다.'],
      ]
    },
    {
      name: '타임아웃 / 무행동',
      rows: [
        ['배치 타임아웃', '랜덤 배치 (토스트+로그)', '—', '—', '—'],
        ['초기 공개 타임아웃', '시간 초과 (토스트+로그)', '—', '—', '—'],
        ['최종 공개 타임아웃', '시간 초과 (토스트+로그)', '—', '—', '—'],
        ['팀전 드래프트 타임아웃', '랜덤 선택 (토스트+로그)', '—', '—', '—'],
        ['팀전 HP 타임아웃', '자동 분배 (토스트+로그)', '—', '—', '—'],
        ['팀전 배치 타임아웃', '랜덤 배치 (토스트+로그)', '—', '—', '—'],
        ['턴 스킵 (무행동)', '{name}의 턴 스킵', '—', '—', '{name}의 턴 스킵'],
        ['턴 강제 종료', '{name}의 턴 강제 종료', '—', '—', '{name}의 턴 강제 종료'],
        ['SP 지급', '새로운 SP가 지급되었습니다', '—', '—', '새로운 SP가 지급되었습니다'],
        ['교환 타임아웃', '자동 확정 (토스트+로그)', '—', '—', '—'],
      ]
    },
    {
      name: '대치 / 보드 축소',
      rows: [
        ['1대1 대치 경고', '1대1 대치 상황: 5턴 후 보드가 축소됩니다.', '—', '—', '1대1 대치 상황: 5턴 후 보드가 축소됩니다.'],
        ['보드 외골 파괴', '보드 외골 파괴 (토스트+로그)', '—', '—', '보드 외골 파괴'],
        ['보드 축소 탈락 (관전자)', '—', '—', '—', '{label}의 {list} 탈락'],
        ['보드 축소 탈락 (플레이어)', '{myLabel}의 {myGroup} 탈락 / {oppLabel}의 {oppGroup} 탈락', '—', '—', '—'],
        ['축소까지 남은 턴', '—', '—', '—', '외골 파괴까지 {remaining}턴'],
      ]
    },
  ]
};

const dataB = {
  title: '이동',
  rows: [
    ['내 말 이동', '{name} 이동 (토스트+로그)', '—', '—', '{player}, {icon}{name} 이동'],
    ['상대 이동 (1v1)', '—', '{name}이/가 이동했습니다.', '—', '{player}, {icon}{name} 이동'],
    ['상대 이동 (팀전, 표식)', '—', '{name}의 표식된 {piece}이/가 이동했습니다.', '—', '{player}, {icon}{name} 이동'],
    ['상대 이동 (팀전, 비표식)', '—', '{name}이/가 이동했습니다.', '—', '{player}, {icon}{name} 이동'],
    ['팀원 이동', '—', '—', '{moverName} 이동 (토스트+로그)', '{player}, {icon}{name} 이동'],
    ['쌍둥이 강도 이동', '쌍둥이 강도 이동 (토스트+로그)', '—', '—', '—'],
    ['AI 이동', '—', '{name}이/가 이동했습니다.', '—', '{icon}{name} 이동'],
  ]
};

const dataC = {
  title: '공격',
  sub: [
    {
      name: '공격 결과 (시전자 본인)',
      rows: [
        ['빗나감', '빗나감 (토스트+로그)', '—', '—', '{player} 공격 빗나감'],
        ['명중 (격파 아님)', '{col},{row} 명중 (로그)', '—', '—', '{player}의 공격 명중!'],
        ['격파', '{labels} 격파! (토스트) / {coords} {labels} 격파 (로그)', '—', '—', '{player}의 {targetName} 사망'],
      ]
    },
    {
      name: '피격 (방어자 본인)',
      rows: [
        ['빗나감', '—', '{oppName} 공격 빗나감 (토스트+로그)', '—', '—'],
        ['피격 (격파 아님)', '—', '공격받았습니다! (토스트) / {hitLabels} 피격 (로그)', '—', '—'],
        ['피격 + 격파', '—', '{killedLabels} 격파! (토스트) / {killedLabels} 격파 (로그)', '—', '—'],
      ]
    },
    {
      name: '팀원의 공격 결과',
      rows: [
        ['빗나감', '—', '—', '빗나감 (토스트+로그)', '—'],
        ['명중', '—', '—', '{coords} 명중 (로그)', '—'],
        ['격파', '—', '—', '{labels} 격파! (토스트) / {coords} {labels} 격파 (로그)', '—'],
      ]
    },
    {
      name: '팀원이 피격',
      rows: [
        ['피격 (격파 아님)', '—', '—', '공격받았습니다! (토스트) / {hitLabels} 피격 (로그)', '—'],
        ['피격 + 격파', '—', '—', '{labels} 격파! (토스트) / {labels} 격파 (로그)', '—'],
      ]
    },
    {
      name: '캐릭터 별 공격 관전자 로그',
      rows: [
        ['사살 (관전자)', '—', '—', '—', '{player}의 {targetName} 사망'],
        ['명중 (관전자)', '—', '—', '—', '{player}의 공격 명중!'],
        ['빗나감 (관전자)', '—', '—', '—', '{player} 공격 빗나감'],
        ['캐릭터 결투 로그 (AI)', '—', '—', '—', 'AI의 {icon}{name}! {target} 격파함 / {target}에 {damage} 피해'],
        ['쥐 격파 (관전자)', '—', '—', '—', '{attacker}이/가 {coord}의 쥐 격파함'],
      ]
    },
  ]
};

const dataD = {
  title: '패시브',
  rows: [
    ['가호 (공격용)', '가호: 악인 공격 시 3 피해', '가호: 악인 공격 시 3 피해', '가호: 악인 공격 시 3 피해', '가호: 악인 공격 시 3 피해'],
    ['가호 (방어용)', '가호: 악인 공격 피해 0.5로 감소', '가호: 악인 공격 피해 0.5로 감소', '가호: 악인 공격 피해 0.5로 감소', '가호: 악인 공격 피해 0.5로 감소'],
    ['아이언스킨', '아이언 스킨: 피해 0.5 감소', '아이언 스킨: 피해 0.5 감소', '아이언 스킨: 피해 0.5 감소', '아이언 스킨: 피해 0.5 감소'],
    ['폭정 (백작)', '{tier}티어 공격 피해 0.5 감소', '{tier}티어 공격 피해 0.5 감소', '{tier}티어 공격 피해 0.5 감소', '{tier}티어 공격 피해 0.5 감소'],
    ['충성 (보디가드)', '충성: {namesStr} 대신 1 피해', '충성: {namesStr} 대신 1 피해', '충성: {namesStr} 대신 1 피해', '충성: {namesStr} 대신 1 피해'],
    ['충성 (저주 막기)', '충성: {target} 대신 저주를 받음', '충성: {target} 대신 저주를 받음', '충성: {target} 대신 저주를 받음', '충성: {target} 대신 저주를 받음'],
    ['인스턴트매직', '인스턴트 매직 : SP 획득', '인스턴트 매직 : SP 획득', '인스턴트 매직 : SP 획득', '인스턴트 매직 : SP 획득'],
    ['표식 (브랜드)', '표식: {names}에게 표식 새김', '표식: {names}에게 표식 새김', '표식: {names}에게 표식 새김', '표식: {names}에게 표식 새김'],
    ['표식 발동', '—', '—', '—', '표식 발동'],
    ['저주 해제 (조건충족)', '저주: {reason} {name}의 저주 해제', '저주: {reason} {name}의 저주 해제', '저주: {reason} {name}의 저주 해제', '저주: {reason} {name}의 저주 해제'],
    ['저주 해제 (마녀 사망)', '저주: 마녀가 사망해 {name}의 저주 해제', '저주: 마녀가 사망해 {name}의 저주 해제', '저주: 마녀가 사망해 {name}의 저주 해제', '저주: 마녀가 사망해 {name}의 저주 해제'],
    ['저주 틱 데미지', '저주: {targetName} {dmgStr} 피해 (로그)', '저주: {targetName} {dmgStr} 피해 (로그)', '저주: {targetName} {dmgStr} 피해 (로그)', '저주: {targetName} {dmgStr} 피해 (로그)'],
  ]
};

const dataE = {
  title: '스킬',
  sub: [
    {
      name: '정찰 (스카우트)',
      rows: [
        ['정찰 시전', '—', '정찰: 상대가 {target}의 위치를 알아냈습니다.', '—', '정찰: 상대 {target}의 위치는 {label}'],
        ['정찰 결과', '정찰: 상대 {targetName}의 위치는 {label} (토스트+로그)', '—', '—', '—'],
      ]
    },
    {
      name: '분신 (쌍둥이)',
      rows: [
        ['분신 합류', '분신: {subject} {target} 위치로 합류', '분신: {subject} {target} 위치로 합류', '분신: {subject} {target} 위치로 합류', '— (관전자 별도 포맷)'],
      ]
    },
    {
      name: '정비 (공격 방향 전환)',
      rows: [
        ['궁수 정비', '정비: 공격 방향 전환', '정비: 공격 방향 전환', '정비: 공격 방향 전환', '{player}의 {icon}{name} → 정비'],
        ['무기장인 정비', '정비: 공격 방향 전환', '정비: 공격 방향 전환', '정비: 공격 방향 전환', '{player}의 {icon}{name} → 정비'],
      ]
    },
    {
      name: '덕 설치 / 폭탄 설치',
      rows: [
        ['덕 설치', '덕 설치: 설치 완료', '덕 설치: 상대의 덕 설치', '덕 설치: 설치 완료', '{player}의 덕 설치'],
        ['폭탄 설치', '폭탄 설치: 설치 완료', '폭탄 설치: 상대의 폭탄 설치', '폭탄 설치: 설치 완료', '{player}의 폭탄 설치'],
      ]
    },
    {
      name: '기폭 / 덕 발동',
      rows: [
        ['기폭', '기폭: 폭탄 폭발!', '기폭: 폭탄 폭발!', '기폭: 폭탄 폭발!', '기폭: 폭탄 폭발!'],
        ['폭탄 격파', '{lbl} 격파! (토스트) / {lbl} 격파 (로그)', '—', '—', '{lbl} 격파! / {lbl} 격파'],
        ['폭탄 피해', '{hurtLabels} 폭탄 피해 (로그)', '—', '—', '{hurtLabels} 폭탄 피해'],
        ['덕 발동', '덕 발동! (토스트+로그)', '덕 발동! (토스트+로그)', '덕 발동! (토스트+로그)', '덕 발동!'],
      ]
    },
    {
      name: '질주 (전령)',
      rows: [
        ['질주 사용', '질주: 전령은 추가 이동 가능', '질주: 전령은 추가 이동 가능', '질주: 전령은 추가 이동 가능', '질주: 전령은 추가 이동 가능'],
      ]
    },
    {
      name: '약초학 (약초사)',
      rows: [
        ['약초학 사용', '약초학: 범위 내 아군 1 HP 회복', '약초학: 범위 내 아군 1 HP 회복', '약초학: 범위 내 아군 1 HP 회복', '약초학: 범위 내 아군 1 HP 회복'],
      ]
    },
    {
      name: '그림자 숨기',
      rows: [
        ['그림자 사용', '그림자 숨기: 다음 턴까지 공격\xB7상태이상 면역', '그림자 숨기: 다음 턴까지 공격\xB7상태이상 면역', '그림자 숨기: 다음 턴까지 공격\xB7상태이상 면역', '그림자 숨기: 그림자 암살자는 다음 턴까지 공격\xB7상태이상 면역'],
      ]
    },
    {
      name: '저주 (마녀)',
      rows: [
        ['저주 시전', '저주: {target}을/를 저주', '저주: 상대 마녀가 {target}을/를 저주', '저주: {target}을/를 저주', '저주: {target}을/를 저주'],
      ]
    },
    {
      name: '쌍검무 (양손검객)',
      rows: [
        ['쌍검무 사용', '쌍검무: 양손검객은 추가 공격 가능', '쌍검무: 양손검객은 추가 공격 가능', '쌍검무: 양손검객은 추가 공격 가능', '쌍검무: 양손검객은 추가 공격 가능'],
      ]
    },
    {
      name: '절대복종 반지 (국왕)',
      rows: [
        ['반지 사용', '반지: {piece}을/를 강제 이동', '반지: 상대 국왕이 {piece}을/를 강제 이동', '반지: {piece}을/를 강제 이동', '반지: {player}의 국왕이 {target}을/를 강제 이동'],
      ]
    },
    {
      name: '신성 (수도사)',
      rows: [
        ['신성 사용', '신성: {target}의 상태이상 제거, 2 HP 회복', '신성: {target}의 상태이상 제거, 2 HP 회복', '신성: {target}의 상태이상 제거, 2 HP 회복', '신성: {target}의 상태이상 제거, 2 HP 회복'],
      ]
    },
    {
      name: '유황범람 (마법사)',
      rows: [
        ['유황범람 사용', '유황범람: 보드 외골 전체 2 피해', '유황범람: 보드 외골 전체 2 피해', '유황범람: 보드 외골 전체 2 피해', '유황범람: 보드 외골 전체 2 피해'],
      ]
    },
    {
      name: '악몭 (고문관)',
      rows: [
        ['악몭 사용', '악몭 발동', '악몭 발동', '악몭 발동', '악몭: 모든 표식 상태 유닛 1 피해'],
      ]
    },
    {
      name: '소환수 (역병술사 / 드래곤)',
      rows: [
        ['쥐 소환 (본인)', '역병의 자손들: 쥐 {count}마리 소환', '—', '—', '—'],
        ['쥐 소환 (팀원)', '—', '—', '역병의 자손들: 쥐 {count}마리 소환', '—'],
        ['쥐 소환 (상대)', '—', '역병의 자손들: 상대가 쥐 소환. 쥐은 공격으로 제거 가능', '—', '역병의 자손들: 쥐 {count}마리 소환'],
        ['쥐 격파', '쥐 {msg} (토스트+로그)', '—', '—', '—'],
        ['드래곤 소환 (본인/팀원)', '드래곤 소환: {coord}에 드래곤 소환', '—', '드래곤 소환: {coord}에 드래곤 소환', '드래곤 소환: {coord}에 드래곤 소환'],
        ['드래곤 소환 (상대)', '—', '드래곤 소환: 상대가 {coord}에 드래곤 소환', '—', '—'],
      ]
    },
  ]
};

const dataF = {
  title: '오류 메시지',
  sub: [
    {
      name: '로비 / 입장',
      rows: [
        ['닉네임 미입력', '닉네임과 방 코드를 입력하세요. / 닉네임을 입력하세요. / 닉네임을 먼저 입력하세요.', '—', '—', '—'],
        ['덱 미완성', '내 덱을 채워주세요.', '—', '—', '—'],
        ['방 가득 찰', '방이 가득 찼습니다.', '—', '—', '—'],
        ['팀 가득 찰', '해당 팀이 이미 가득 찼습니다.', '—', '—', '—'],
        ['게임 이미 시작됨', '이미 게임이 시작된 방입니다.', '—', '—', '—'],
        ['팀전 인원 부족', '4명이 모여야 시작할 수 있습니다.', '—', '—', '—'],
        ['팀 불균형', '각 팀에 2명씩 배정해야 합니다.', '—', '—', '—'],
      ]
    },
    {
      name: '드래프트 / HP',
      rows: [
        ['잘못된 선택', '잘못된 선택입니다.', '—', '—', '—'],
        ['팀원 중복 선택', '팀원이 이미 선택한 캐릭터입니다.', '—', '—', '—'],
        ['중복 선택 불가', '같은 캐릭터를 2번 선택할 수 없습니다.', '—', '—', '—'],
        ['슬롯 가득 찰', '슬롯이 모두 찼습니다.', '—', '—', '—'],
        ['드래프트 미완료', '2개 캐릭터를 모두 선택해주세요.', '—', '—', '—'],
        ['HP 합계 오류', 'HP 합계는 10, 각 최소 1 최대 9', '—', '—', '—'],
        ['쌍둥이 HP 오류', '쌍둥이 HP 합계는 {hp}, 각 최소 1이어야 합니다.', '—', '—', '—'],
      ]
    },
    {
      name: '배치',
      rows: [
        ['배치 잠김', '이미 확정한 배치는 수정할 수 없습니다.', '—', '—', '—'],
        ['보드 밖', '보드 밖입니다.', '—', '—', '—'],
        ['칸 중복', '이미 자신의 말이 있는 칸입니다.', '—', '—', '—'],
        ['팀원 칸 중복', '팀원의 말이 이미 있는 칸입니다.', '—', '—', '—'],
        ['배치 미완료', '모든 말을 배치하세요.', '—', '—', '—'],
        ['말 미선택 (팀전)', '먼저 말을 선택하세요.', '—', '—', '—'],
      ]
    },
    {
      name: '이동 / 공격 / 턴',
      rows: [
        ['턴 아님', '당신의 턴이 아닙니다.', '—', '—', '—'],
        ['재접속 처리 중', '재접속 처리 중입니다.', '—', '—', '—'],
        ['이미 행동 사용', '이미 행동을 사용했습니다.', '—', '—', '—'],
        ['행동 대체 스킬 사용 후', '행동 대체 스킬을 사용했으므로 이동/공격할 수 없습니다.', '—', '—', '—'],
        ['쌍둥이 이동 중', '쌍둥이 이동 중입니다. 나머지 쌍둥이를 이동시키세요.', '—', '—', '—'],
        ['전령 질주 중', '전령 질주 중입니다. 해당 전령만 이동할 수 있습니다.', '—', '—', '—'],
        ['이동 범위 초과', '상하좌우 1칸만 이동할 수 있습니다.', '—', '—', '—'],
        ['아군 칸 이동', '아군이 있는 칸으로는 이동할 수 없습니다.', '—', '—', '—'],
        ['팀원 칸 이동', '팀원이 있는 칸으로는 이동할 수 없습니다.', '—', '—', '—'],
        ['공격 범위 초과', '주변 9칸 중에서만 선택 가능합니다.', '—', '—', '—'],
        ['효과 처리 중', '효과 처리 중입니다. 잠시 후 다시 시도하세요.', '—', '—', '—'],
        ['트랩 처리 중', '트랩 처리 중입니다. 잠시 후 다시 시도하세요.', '—', '—', '—'],
      ]
    },
    {
      name: '스킬',
      rows: [
        ['올바르지 않은 말', '올바르지 않은 말입니다.', '—', '—', '—'],
        ['스킬 없음', '이 말은 스킬이 없습니다.', '—', '—', '—'],
        ['저주 상태', '저주 상태에서는 스킬을 사용할 수 없습니다.', '—', '—', '—'],
        ['SP 부족', 'SP가 부족합니다.', '—', '—', '—'],
        ['턴당 1회 제한', '이 스킬은 턴당 1회만 사용할 수 있습니다.', '—', '—', '—'],
        ['이미 행동 후 행동대체', '이미 행동을 사용했습니다. 행동 대체 스킬을 사용할 수 없습니다.', '—', '—', '—'],
        ['분신 불가 (쌍둥이 사망)', '쌍둥이 중 하나가 쓰러져 분신을 사용할 수 없습니다.', '—', '—', '—'],
        ['이미 합류 상태', '이미 합류 상태 — 분신 불필요', '—', '—', '—'],
        ['적 없음 (정찰)', '적이 없습니다.', '—', '—', '—'],
        ['덕/폭탄 칸 중복', '이미 덕/폭탄이 설치된 칸입니다.', '—', '—', '—'],
        ['공격 후 질주 불가', '공격 후에는 질주를 사용할 수 없습니다.', '—', '—', '—'],
        ['다른 유닛 이동 후 질주', '다른 유닛이 이동했으므로 질주를 사용할 수 없습니다.', '—', '—', '—'],
        ['설치된 폭탄 없음', '설치된 폭탄이 없습니다.', '—', '—', '—'],
        ['이미 그림자 상태', '이미 그림자 상태입니다.', '—', '—', '—'],
        ['저주 대상 없음', '저주 대상을 선택하세요.', '—', '—', '—'],
        ['같은 팀 저주 불가', '같은 팀원에게는 저주를 걸 수 없습니다.', '—', '—', '—'],
        ['HP 1 이하 저주 불가', 'HP가 1 이하인 대상에게는 저주를 걸 수 없습니다.', '—', '—', '—'],
        ['이미 저주 상태', '이미 저주 상태입니다.', '—', '—', '—'],
        ['그림자 대상 저주 불가', '그림자 상태의 대상에게는 저주를 걸 수 없습니다.', '—', '—', '—'],
        ['이미 이동 후 쌍검무', '이미 이동했으므로 쌍검무를 사용할 수 없습니다.', '—', '—', '—'],
        ['다른 유닛 행동 후 쌍검무', '다른 유닛이 행동했으므로 쌍검무를 사용할 수 없습니다.', '—', '—', '—'],
        ['반지 대상/목적지 미지정', '대상과 목적지를 지정하세요.', '—', '—', '—'],
        ['반지 같은 팀', '같은 팀원은 강제 이동할 수 없습니다.', '—', '—', '—'],
        ['드래곤 이미 존재', '보드 위에 이미 드래곤이 있습니다.', '—', '—', '—'],
        ['신성 자신 불가', '자신은 치유할 수 없습니다.', '—', '—', '—'],
        ['악몭 불가 (표식 없음)', '표식 상태의 적이 없어 악몭을 사용할 수 없습니다.', '—', '—', '—'],
        ['알 수 없는 스킬', '알 수 없는 스킬입니다.', '—', '—', '—'],
      ]
    },
    {
      name: '교환 / 기타',
      rows: [
        ['잘못된 티어', '잘못된 티어입니다.', '—', '—', '—'],
        ['존재하지 않는 캐릭터', '존재하지 않는 캐릭터입니다.', '—', '—', '—'],
        ['같은 캐릭터 교환 불가', '같은 캐릭터로는 교환할 수 없습니다.', '—', '—', '—'],
        ['폭탄 인덱스 오류', '잘못된 폭탄 인덱스입니다.', '—', '—', '—'],
      ]
    },
  ]
};

const dataG = {
  title: '대기 메시지',
  rows: [
    ['드래프트 대기', '다른 플레이어의 선택을 기다리는 중...', '—', '—', '—'],
    ['HP 대기', '다른 플레이어의 HP 분배를 기다리는 중...', '—', '—', '—'],
    ['배치 대기', '다른 플레이어의 배치를 기다리는 중... / 상대방의 배치를 기다리는 중...', '—', '—', '—'],
    ['교환 대기', '교환 결정 완료. 상대를 기다리는 중...', '—', '—', '—'],
    ['일반 대기', '상대방을 기다리는 중...', '—', '—', '—'],
    ['팀전 카운트다운 취소', '카운트다운이 취소되었습니다. (토스트)', '—', '—', '—'],
    ['팀전 방 리다이렉트', '이 방은 2v2 팀전 방입니다. 팀전으로 입장합니다. (토스트)', '—', '—', '—'],
    ['팀전 채팅 제한', '팀전 모드에서만 팀 채팅을 사용할 수 있습니다. (토스트)', '—', '—', '—'],
  ]
};

const dataH = {
  title: '덱 관리',
  rows: [
    ['덱 이름 미입력', '덱 이름을 입력해주세요.', '—', '—', '—'],
    ['덱 이름 수정', '덱 이름이 수정되었습니다.', '—', '—', '—'],
    ['덱 저장', '덱이 저장되었습니다.', '—', '—', '—'],
    ['덱 불러오기', '덱을 불러왔습니다.', '—', '—', '—'],
    ['중복 덱', '이미 같은 덱이 있습니다.', '—', '—', '—'],
    ['덱 슬롯 부족', '덱 슬롯이 부족합니다.', '—', '—', '—'],
    ['캐릭터 미선택', '캐릭터를 모두 선택하지 않았습니다.', '—', '—', '—'],
    ['랜덤 채우기', '슬롯이 랜덤으로 채워졌습니다!', '—', '—', '—'],
    ['팀 드래프트 선택 완료', '{icon} {name} 선택 완료', '—', '—', '—'],
    ['HP 분배 완료', 'HP 분배 완료!', '—', '—', '—'],
  ]
};

// ── Build Document ──
const children = [];

// -- Cover page --
children.push(new Paragraph({ spacing: { before: 3600 } }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: 'CALIGO', bold: true, font: 'Arial', size: 72, color: C_PRIMARY })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 600 },
  children: [new TextRun({ text: '로그 / 토스트 인벤토리', bold: true, font: 'Arial', size: 36, color: C_ACCENT })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  border: { top: { style: BorderStyle.SINGLE, size: 2, color: C_ACCENT, space: 8 } },
  children: [new TextRun({ text: '작성 목적', bold: true, font: 'Arial', size: 22, color: '444444' })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'CALIGO 보드게임의 1v1 및 팀전 모드에서 발생하는', font: 'Arial', size: 20, color: '555555' })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: '모든 로그 및 토스트 메시지를 카테고리별로 정리한 문서입니다.', font: 'Arial', size: 20, color: '555555' })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: '메시지 문구 수정 및 정리에 활용할 수 있습니다.', font: 'Arial', size: 20, color: '555555' })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 1200 },
  children: [new TextRun({ text: '2025-05-25', font: 'Arial', size: 20, color: C_LIGHT })]
}));
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Table of Contents --
children.push(new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { after: 300 },
  children: [new TextRun({ text: '목차', bold: true, font: 'Arial', size: 32, color: C_PRIMARY })]
}));

const tocItems = [
  ['A', '게임 흐름'],
  ['B', '이동'],
  ['C', '공격'],
  ['D', '패시브'],
  ['E', '스킬'],
  ['F', '오류 메시지'],
  ['G', '대기 메시지'],
  ['H', '덱 관리'],
];
for (const [letter, title] of tocItems) {
  children.push(new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 360 },
    children: [new TextRun({ text: `${letter}. ${title}`, font: 'Arial', size: 22, color: '333333' })]
  }));
}
children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }));
children.push(note('표 컬럼 설명: 이벤트 = 발생 상황, 본인 = 행동 주체에게 표시, 상대 = 상대편에게 표시, 팀원 = 팀전 모드에서 팀원에게 표시, 관전자 = 관전자에게 표시'));
children.push(note('{name}, {target} 등은 동적 변수입니다. 실제 게임에서는 해당 값으로 대체됩니다. — 표시는 해당 없음을 의미합니다.'));
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section A: Game Flow --
children.push(sectionTitle('A', dataA.title));
for (const sub of dataA.sub) {
  children.push(subTitle(sub.name));
  children.push(makeTable(sub.rows));
}
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section B: Movement --
children.push(sectionTitle('B', dataB.title));
children.push(makeTable(dataB.rows));
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section C: Attack --
children.push(sectionTitle('C', dataC.title));
for (const sub of dataC.sub) {
  children.push(subTitle(sub.name));
  children.push(makeTable(sub.rows));
}
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section D: Passive --
children.push(sectionTitle('D', dataD.title));
children.push(makeTable(dataD.rows));
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section E: Skills --
children.push(sectionTitle('E', dataE.title));
for (const sub of dataE.sub) {
  children.push(subTitle(sub.name));
  children.push(makeTable(sub.rows));
}
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section F: Error Messages --
children.push(sectionTitle('F', dataF.title));
for (const sub of dataF.sub) {
  children.push(subTitle(sub.name));
  children.push(makeTable(sub.rows));
}
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section G: Wait Messages --
children.push(sectionTitle('G', dataG.title));
children.push(makeTable(dataG.rows));
children.push(new Paragraph({ children: [new PageBreak()] }));

// -- Section H: Deck Management --
children.push(sectionTitle('H', dataH.title));
children.push(makeTable(dataH.rows));

// ── Assemble ──
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 20 } }
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: C_PRIMARY },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: C_PRIMARY },
        paragraph: { spacing: { before: 200, after: 200 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: C_ACCENT },
        paragraph: { spacing: { before: 160, after: 160 }, outlineLevel: 2 }
      },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H, orientation: 'landscape' },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO — Log / Toast Inventory', font: 'Arial', size: 16, color: C_LIGHT, italics: true })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', font: 'Arial', size: 16, color: C_LIGHT }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: C_LIGHT }),
          ]
        })]
      })
    },
    children
  }]
});

const OUT = 'C:/Users/user/Desktop/board-game/CALIGO_log_toast_inventory.docx';
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log(`Done: ${OUT} (${(buf.length / 1024).toFixed(1)} KB)`);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
