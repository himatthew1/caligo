// CALIGO 로그/토스트 인벤토리 워드 문서 생성
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, Header, Footer, PageNumber, LevelFormat,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };
const headerFill = '2E4057';
const altFill = 'F5F5F0';

// 표 헬퍼
function makeTable(columns, rows, columnWidths) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((c, i) => new TableCell({
      borders,
      width: { size: columnWidths[i], type: WidthType.DXA },
      shading: { fill: headerFill, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', size: 20 })],
      })],
    })),
  });
  const bodyRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      borders,
      width: { size: columnWidths[ci], type: WidthType.DXA },
      shading: ri % 2 === 1 ? { fill: altFill, type: ShadingType.CLEAR } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        children: [new TextRun({ text: cell || '—', size: 18 })],
      })],
    })),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...bodyRows],
  });
}

// 섹션 제목
function sectionTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 32, color: '2E4057' })],
  });
}
function subTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 26, color: '4A6478' })],
  });
}
function paraDesc(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, italics: true, size: 18, color: '666666' })],
  });
}
function paraNormal(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 20 })],
  });
}

// 컬럼 폭 (DXA, 1440 = 1인치) — 가로 9360 기준
// 이벤트 / 본인 / 상대 / 팀원 / 관전자
const COL_WIDTHS = [1800, 2000, 2000, 1760, 1800];
const COLS = ['이벤트', '본인 (시전자/플레이어)', '상대 (적)', '팀원 (팀전 전용)', '관전자'];

// ── 카테고리 데이터 ─────────────────────────────────────────────

// A. 게임 흐름
const sectionA = [
  ['게임 시작 (1v1)', '선공! 먼저 시작합니다. / 후공! 상대가 먼저 시작합니다. (오버레이 + addLog)', '동일 (반대 메시지)', '—', '게임을 시작합니다. 선공은 [name]!'],
  ['게임 시작 (팀전)', '오버레이: 게임 시작 / 선공! 먼저 시작합니다. / 후공! 상대가 먼저 시작합니다.', '동일', '동일', '팀전 게임 시작! 선공: [name]'],
  ['재접속 (모든 모드)', '오버레이: 재접속 / [name]의 턴   addLog: 🔌 재접속! [name]의 턴   토스트: 🔌 재접속 완료!', '—', '—', '—'],
  ['턴 변경 (1v1)', '[N]턴 : [myName] 차례 (addLog)', '[N]턴 : [oppName] 차례 (addLog)', '—', '[턴 N] [name]의 차례 (spectator_log)'],
  ['턴 변경 (팀전)', '🟦/🟥 [턴 N] [내이름]의 차례 (addLog)   토스트: ▶ 내 차례입니다!', '🟦/🟥 [턴 N] [적이름]의 차례   토스트: ⚔ 적 [name]의 차례 (오른쪽 토스트)', '🟦/🟥 [턴 N] [팀원이름]의 차례   토스트: 🤝 팀원 [name]의 차례', '[턴 N] [name]의 차례 (spectator_log)'],
  ['턴 스킵 (행동·스킬 없이 턴 종료)', '[name]의 턴 스킵 (no_action_notice → addLog + 토스트)', '동일', '동일', '[name]의 턴 스킵 (spectator_log)'],
  ['연결 끊김', '—', '—', '—', '🔌 [name] 연결 끊김 (30초 재접속 대기)... (spectator_log)'],
  ['재접속 실패 → 패배 처리', '—', '—', '—', '🔌 [name] 재접속 실패. 패배 처리. (spectator_log)'],
];

// B. 이동
const sectionB = [
  ['자기 말 이동 (1v1)', '🚶 [name]을(를) [coord]로 이동합니다. (addLog)   토스트: 동일', '🚶 [oppName]이(가) 이동했습니다. (addLog) 토스트: 🚶 상대가 이동했습니다. (오른쪽 토스트)', '—', '🚶 [name], [icon][piece]의 위치를 [coord]로 이동합니다.'],
  ['자기 말 이동 (팀전)', '내부 이동 알림 (addLog만, 토스트 X)', '🚶 [name]이(가) 이동했습니다. (토스트 + 좌표 비공개)', '🤝 팀원 [name] — [icon][piece] [prev]→[new] (addLog only, 토스트 X)', 'spectator_log'],
  ['표식된 적 이동', '🚶 [oppName]의 표식된 [piece]이(가) 이동했습니다. + 보드 셀 플래시 애니메이션', 'X (적은 자기 이동을 그렇게 안 봄)', 'X', '—'],
  ['덫 발동으로 이동 후 피해', '(trap_triggered와 합쳐서 처리, 아래 트랩 항목 참조)', '동일', '동일', '동일'],
];

// C. 공격
const sectionC = [
  ['공격 빗나감', '⚔ [icon][piece]! 공격 빗나감. (addLog) + 토스트', '⚔ 상대의 공격 빗나감. (addLog) + 토스트', '⚔ 팀원 [name]의 [piece]! 공격 빗나감. (addLog만)', '⚔ [name]의 [icon][piece]! 공격 빗나감. (spectator_log/miss)'],
  ['일반 피격 (피해 1+)', '⚔ [icon][piece]! [target]에 [N] 피해. (addLog) + 토스트', '⚔ [icon][piece] 피격! [N] 피해. (addLog) + 토스트', '🤝 팀원 [name]의 [icon][piece] 피격! [N] 피해. (addLog) + 토스트 (오른쪽)', '⚔ [name]의 [icon][piece]! [target]에 [N] 피해. (spectator_log/hit)'],
  ['격파 (피해로 사망)', '⚔ [icon][piece]! [target] 격파함. 💀 (addLog) + 토스트', '⚔ [icon][piece] 피격! 격파됨. 💀 (addLog) + 토스트', '🤝 팀원 [name]의 [icon][piece] 피격! 격파됨. 💀 (addLog) + 토스트', '⚔ [name]의 [icon][piece]! [target] 격파함. 💀 (spectator_log)'],
];

// D. 패시브
const sectionD = [
  ['🙏 가호 (수도승 공격 시 악인에 3 피해)', '🙏 가호: [name]의 수도승은 악인을 공격할때 3 피해. (passive_alert + 토스트)', '동일 메시지 수신', '동일', '🙏 가호: [name]의 수도승은 악인을 공격할때 3 피해. (spectator_log/passive)'],
  ['🙏 가호 (수도승 피격 시 악인 공격 0.5)', '🙏 가호: [name]의 수도승은 악인의 공격 피해가 0.5로 감소.', '동일', '동일', '동일'],
  ['🛡 아이언 스킨 (갑주무사 -0.5 피해)', '🛡 아이언 스킨: [name]의 갑주무사는 피해 0.5 감소.', '동일', '동일', '동일'],
  ['🦇 폭정 (백작 1·2티어 공격에 -0.5)', '🦇 폭정: [name]의 백작은 [tier]티어 공격 피해 0.5 감소.', '동일', '동일', '동일'],
  ['🛡 충성 (호위무사 1 피해 대신)', '🛡 충성: [name]의 호위무사가 [royalName] 대신 1 피해.', '동일', '🛡 충성: 팀원 [victim]의 호위무사가 대신 받음 (팀전 ally_hit 토스트 추가)', '동일'],
  ['⚔ 배반자 (학살영웅 아군 휘말림 1 피해)', '⚔ 배반자: [name]의 학살 영웅 공격에 [allyName]도 휘말려 1 피해!', '동일', '동일 (팀원이 휘말리면 ally_hit 토스트)', '동일'],
  ['✨ 인스턴트 매직 (마법사 피격 시 +1 SP)', '✨ 인스턴트 매직: 마법사 피격되어 [name]은 인스턴트 SP를 1개 획득합니다.', '동일', '동일', '동일'],
  ['⛓ 표식 (고문기술자 공격 시 표식)', '⛓ 표식: [name]의 고문 기술자가 [target]에게 표식을 새겼습니다.', '동일', '동일', '동일'],
  ['📋 사기증진 (지휘관 인접 +1 ATK)', '카드에 📋 사기증진 배지 표시 (메시지 X)', '카드 표시 (적도 보임)', '카드 표시', '—'],
  ['👻 그림자 숨기 (피해·상태이상 면역)', '👻 그림자 활성: [name]은 다음 턴까지 공격·상태이상 면역. (passive_alert)', '동일', '동일', '동일'],
];

// E. 스킬
const sectionE = [
  ['🔭 정찰 (척후병)', '🔭 정찰: [target]의 위치는 [label] 입니다. (addLog + 토스트)', '🔭 정찰: 상대가 [target]의 위치를 알아냈습니다. (skill_result)', '—', 'spectator_log/skill'],
  ['🐀 쥐 소환 (쥐 장수)', '🐀 역병의 자손들: 쥐 [N]마리를 소환했습니다.', '🐀 역병의 자손들: 상대가 쥐를 소환. 쥐는 공격으로 제거할 수 있습니다.', '🐀 [팀원이름]이(가) 쥐 [N]마리를 소환했습니다.', 'spectator_log/skill'],
  ['🐉 드래곤 소환 (드래곤 조련사)', '🐉 드래곤 소환: [coord]에 드래곤을 소환했습니다.', '🐉 드래곤 소환: 상대가 [coord]에 드래곤을 소환했습니다.', '🐉 동일 메시지 (팀원 시전 시)', 'spectator_log/skill'],
  ['💣 폭탄 설치 (화약상)', '💣 폭탄 설치: [coord]에 폭탄을 설치했습니다. (skill_result + 토스트)', '💣 폭탄 설치: 상대가 [coord]에 폭탄을 설치했습니다.', '🤝 동일 (팀원 시전)', 'spectator_log/skill'],
  ['💣 폭탄 폭발 (기폭 또는 사망 트리거)', '💥[icon][name] 1 피해. (addLog + 토스트, hit별)', '동일', '동일', 'bomb_detonated 이벤트 → spectator_log'],
  ['🪤 트랩 설치 (인간사냥꾼)', '🪤 덫 설치: 현재 위치에 덫을 숨겼습니다.', '(상대에게는 안 보임 — 추론)', '🤝 팀원이 덫 설치 (메시지 노출은 게임 규칙 따라)', 'spectator_log'],
  ['🪤 트랩 발동', '🪤 [name]의 인간 사냥꾼 덫에 걸려 [icon][piece] [N] 피해. (addLog + 토스트)', '동일 메시지 수신', '🤝 팀원 [piece]가 덫에 걸림 (애니메이션 + 토스트)', 'spectator_log'],
  ['☠ 저주 (마녀)', '☠ 저주: [target]에게 저주를 걸었습니다.', '☠ 저주: 상대 마녀가 [target]에게 저주를 걸었습니다.', '☠ 동일 (팀원 마녀)', 'spectator_log'],
  ['🧙 저주 데미지 (턴마다)', '🧙 저주: 저주 상태의 [name]! 0.5 피해. (passive_alert)', '동일', '동일', '동일'],
  ['🧙 저주 해제 (마녀 사망 / HP 1 / 신성)', '🧙 저주: [reason] [name]의 저주가 해제되었습니다. (passive_alert)', '동일', '동일', '동일'],
  ['🙏 신성 (수도승, +2 회복 + 상태이상 제거)', '🙏 신성: [target]의 상태이상을 제거하고 2 HP를 회복했습니다.', '🙏 신성: 상대가 [target]의 상태이상을 제거하고 2 HP를 회복했습니다.', '🤝 동일 (팀원 시전)', 'spectator_log'],
  ['🌿 약초학 (약초전문가, 주변 아군 +1 회복)', '🌿 약초학: [N]명의 아군을 1 HP 회복시켰습니다.', '🌿 동일 (상대편)', '🤝 동일 (팀원 시전)', 'spectator_log'],
  ['👻 그림자 숨기 (그림자 암살자)', '👻 그림자: 다음 턴까지 면역.', '👻 동일', '🤝 동일', 'spectator_log'],
  ['🏹/⚒ 정비 (궁수·무기상 방향 전환)', '🏹/⚒ 정비: 공격 방향 전환', '동일 — 적도 방향 알 수 있게 → 카드 directionHtml 갱신', '🤝 동일', 'spectator_log'],
  ['📯 질주 (전령, 추가 이동 1회)', '📯 질주 활성: 한 번 더 이동할 수 있습니다.', '📯 동일', '🤝 동일', 'spectator_log'],
  ['👫 분신 (쌍둥이 합류)', '👫 분신: [moverSub]이(가) 다른 쪽 위치로 합류.', '👫 동일', '🤝 동일', 'spectator_log'],
  ['⚔ 쌍검무 (양손검객, 추가 공격 1회)', '⚔ 쌍검무 활성: 추가 공격 가능.', '⚔ 쌍검무 활성! (상대 인지)', '🤝 동일', 'spectator_log'],
  ['♛ 절대복종 반지 (국왕)', '♛ 반지: [target]을 [coord]로 강제 이동.', '♛ 반지: 상대 국왕이 [name]을 [coord]로 강제 이동시켰습니다.', '🤝 동일', 'spectator_log'],
  ['🔥 유황범람 (유황솥)', '🔥 유황범람: 보드 외곽 전체 2 피해.', '🔥 유황범람! 외곽에 2 피해.', '🤝 동일', 'spectator_log'],
  ['⛓ 악몽 (고문기술자, 표식 적 1 피해)', '⛓ 악몽: 표식 상태의 모든 적에게 1 피해.', '⛓ 악몽: 상대 고문기술자가 표식 적에게 1 피해.', '🤝 동일', 'spectator_log'],
];

// F. 보드 축소
const sectionF = [
  ['보드 축소 경고 (warnTurn)', '외곽 파괴까지 [N]턴 (addLog + 토스트, shrink-warning 배너)', '동일', '동일', '⏳ 외곽 파괴까지 [N]턴 (spectator_log)'],
  ['보드 축소 실행 (첫 1회)', '오버레이: ⚠ 보드 파괴 시작 / 외곽이 무너지기 시작합니다 — 안쪽으로 대피하세요!  토스트: 🔥 보드 외곽 파괴', '동일', '동일', '🔥 보드 외곽이 파괴되었습니다.'],
  ['보드 축소 실행 (이후)', '🔥 보드 외곽 파괴 (toast + addLog) + 보드 흔들림 SFX', '동일', '동일', '동일'],
  ['외곽 말 파괴', '💀 [icon][name] 파괴 (addLog + 토스트, 자기 것은 토스트 자기 쪽 / 상대 것은 오른쪽)', '동일 (반대 시점)', '동일', '동일'],
];

// G. 1대1 대치 / 팀전 무행동
const sectionG = [
  ['1대1 대치 감지 (양쪽 1유닛, 5턴 후 축소)', '1대1 대치 상황: 5턴 후 보드가 축소됩니다. (turn_event 풀스크린 알림)', '동일', '—', '동일'],
  ['팀전 무행동 (구현 미완 — #24 항목)', '— (제안: 행동·스킬 없이 N턴 연속 시 강제 축소)', '—', '—', '—'],
];

// H. 게임 종료
const sectionH = [
  ['승리 (격파)', '🏆 승리! / [oppName]의 모든 유닛을 제거해 승리했습니다.', '💀 패배... / [oppName]에게 패배했습니다.', '🏆 팀 승리! / [L]의 모든 유닛을 제거해 승리했습니다.', '게임 종료 / [W]이(가) [L]에게 승리했습니다!'],
  ['승리 (보드 축소로 적 전멸)', '🏆 / 상대가 보드 축소를 피하지 못해 승리했습니다!', '💀 / 보드 축소를 피하지 못해 패배하였습니다.', '동일 (팀 컨텍스트)', 'spectator: 보드 축소로 [L]의 말이 전멸해 [W]의 승리입니다!'],
  ['승리 (트랩/폭탄/유황/악몽)', '🏆 / [skill]으로 상대의 모든 말을 제거해 승리했습니다!', '💀 / [skill]으로 모든 유닛이 쓰러져 패배하였습니다.', '동일', 'spectator/스킬별 메시지'],
  ['기권 승리', '🏆 승리! / [oppName]의 기권입니다!', '🏳 기권 / 기권하여 패배했습니다.', '동일 (팀 통일됨)', '[L]의 기권으로, [W]의 승리입니다!'],
  ['무승부 (양쪽 동시 전멸)', '🤝 무승부 / 보드 축소로 양 팀 모든 말이 전멸해 무승부입니다.', '동일', '동일', '동일'],
  ['무승부 (이번 작업 추가, #24)', '🤝 무승부 / 게임을 끝낼 수 없어 무승부입니다. (생존 유닛 공격범위 상호 외)', '—', '—', '—'],
];

// 문서 빌드
const doc = new Document({
  creator: 'CALIGO',
  title: 'CALIGO 로그·토스트 인벤토리',
  styles: {
    default: { document: { run: { font: 'Malgun Gothic', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Malgun Gothic', color: '2E4057' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Malgun Gothic', color: '4A6478' },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },  // US Letter
        margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO 로그·토스트 인벤토리', size: 18, color: '888888' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '페이지 ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
          ],
        })],
      }),
    },
    children: [
      // ── 표지 ──
      new Paragraph({ spacing: { before: 1800 }, children: [new TextRun('')] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: 'CALIGO', size: 96, bold: true, color: '2E4057' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: '로그 · 토스트 인벤토리', size: 44, bold: true, color: '4A6478' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: '게임 내 모든 로그·토스트 메시지 카탈로그', size: 24, italics: true, color: '666666' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 1200 },
        children: [new TextRun({ text: '본인 / 상대 / 팀원 / 관전자 관점별 정리', size: 22, color: '888888' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [new TextRun({ text: '작성 목적', size: 24, bold: true, color: '2E4057' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [new TextRun({ text: '메시지 문구 · 이모티콘 사용 정리 — 사용자가 직접 표에 수정 사항을 기입', size: 20, color: '444444' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '1원칙: 불필요한 이모티콘 제거', size: 20, italics: true, bold: true, color: '8B0000' })],
      }),
      new Paragraph({ children: [new PageBreak()] }),

      // ── A. 게임 흐름 ──
      sectionTitle('A. 게임 흐름'),
      paraDesc('게임 시작 · 턴 변경 · 재접속 · 턴 스킵 · 연결 끊김 등.'),
      makeTable(COLS, sectionA, COL_WIDTHS),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      // ── B. 이동 ──
      sectionTitle('B. 이동'),
      paraDesc('자기 말 / 상대 말 / 팀원 말 이동 시 표시되는 메시지.'),
      makeTable(COLS, sectionB, COL_WIDTHS),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      // ── C. 공격 ──
      sectionTitle('C. 공격'),
      paraDesc('공격 빗나감 · 일반 피격 · 격파.'),
      makeTable(COLS, sectionC, COL_WIDTHS),
      new Paragraph({ children: [new PageBreak()] }),

      // ── D. 패시브 ──
      sectionTitle('D. 패시브 능력'),
      paraDesc('자동 발동되는 패시브 알림 — passive_alert 이벤트로 양 진영에 동등 표시.'),
      makeTable(COLS, sectionD, COL_WIDTHS),
      new Paragraph({ children: [new PageBreak()] }),

      // ── E. 스킬 ──
      sectionTitle('E. 스킬 사용'),
      paraDesc('각 캐릭터의 액티브 스킬 — skill_result(시전자) + status_update(상대) + team_skill_notice(팀전).'),
      makeTable(COLS, sectionE, COL_WIDTHS),
      new Paragraph({ children: [new PageBreak()] }),

      // ── F. 보드 축소 ──
      sectionTitle('F. 보드 축소'),
      paraDesc('외곽 파괴 경고 · 실행 · 외곽 말 파괴.'),
      makeTable(COLS, sectionF, COL_WIDTHS),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      // ── G. 대치 ──
      sectionTitle('G. 1대1 대치 / 팀전 무행동'),
      paraDesc('교착 상태 감지 시 메시지.'),
      makeTable(COLS, sectionG, COL_WIDTHS),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      // ── H. 게임 종료 ──
      sectionTitle('H. 게임 종료'),
      paraDesc('승리 · 패배 · 무승부 · 기권 — 1v1과 팀전 통일됨 (커밋 ee9f087).'),
      makeTable(COLS, sectionH, COL_WIDTHS),
      new Paragraph({ spacing: { after: 480 }, children: [new TextRun('')] }),

      // ── 부록: 사용자 작업 메모 영역 ──
      new Paragraph({ children: [new PageBreak()] }),
      sectionTitle('부록 · 작업 메모'),
      paraDesc('이 페이지에 메시지별 변경 요청을 자유롭게 기재하세요.'),
      paraNormal(''),
      paraNormal('▢ 제거할 이모티콘 목록:'),
      paraNormal('   _____________________________________'),
      paraNormal('   _____________________________________'),
      paraNormal(''),
      paraNormal('▢ 통합·삭제할 메시지:'),
      paraNormal('   _____________________________________'),
      paraNormal('   _____________________________________'),
      paraNormal(''),
      paraNormal('▢ 문구 변경 요청 (현재 → 변경):'),
      paraNormal('   _____________________________________'),
      paraNormal('   _____________________________________'),
      paraNormal('   _____________________________________'),
      paraNormal('   _____________________________________'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:/Users/user/Desktop/board-game/CALIGO_log_toast_inventory.docx';
  fs.writeFileSync(out, buf);
  console.log(`Generated: ${out}`);
  console.log(`Size: ${(buf.length / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
