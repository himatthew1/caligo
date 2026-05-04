// 호버 팁 스킬·패시브 설명 검수 — server.js CHARACTERS 의 desc 원문 그대로 추출.
// 사용자가 직접 표에 검토·수정 사항 기입할 수 있도록 사전 작업 없이 원문만 나열.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, Header, Footer, PageNumber,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };
const headerFill = '2E4057';
const altFill = 'F5F5F0';

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

function sectionTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 32, color: '2E4057' })],
  });
}
function paraDesc(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, italics: true, size: 18, color: '666666' })],
  });
}

// ── 데이터 (server.js CHARACTERS 와 1:1 일치 — 원문 그대로) ─────────────────────

// 컬럼: 티어 / 캐릭터 / 스킬 또는 패시브 / 종류 / SP / 현재 설명 / 수정안
const COL_WIDTHS = [600, 1400, 1300, 900, 600, 3000, 2960];
const COLS = ['티어', '캐릭터', '스킬·패시브', '종류', 'SP', '현재 설명 (원문)', '수정안'];

// 액티브 스킬 ──────────────────────────────────────────
const skillRows = [
  ['1', '🏹 궁수',          '정비',           '자유시전형 · 턴 1회', '1', '공격 범위 반전', ''],
  ['1', '👫 쌍둥이 강도',     '분신',           '행동소비형',          '2', '누나가 동생 위치로, 또는 동생이 누나 위치로 합류합니다.', ''],
  ['1', '🔭 척후병',         '정찰',           '자유시전형',          '2', '랜덤 적 1개의 행 또는 열 공개', ''],
  ['1', '🪤 인간 사냥꾼',     '덫 설치',        '행동소비형',          '2', '현재 위치에 덫 설치. 작동 시 2 피해.', ''],
  ['1', '📯 전령',          '질주',           '자유시전형 · 턴 1회', '1', '이번 턴 이동 2회 실행', ''],
  ['1', '💣 화약상',         '폭탄 설치',      '자유시전형',          '2', '주변 8칸 중 한 곳에 폭탄 설치', ''],
  ['1', '💣 화약상',         '기폭',           '자유시전형 · 턴 1회', '0', '설치된 폭탄 전부 폭발. 1 피해.', ''],
  ['1', '🌿 약초전문가',      '약초학',         '자유시전형',          '2', '자신 제외 주변 모든 아군 체력 1 회복', ''],
  ['2', '🗡 그림자 암살자',    '그림자 숨기',     '자유시전형 · 턴 1회', '1', '다음 턴까지 공격과 상태이상에 면역', ''],
  ['2', '🧹 마녀',          '저주',           '행동소비형',          '3', '적 1명에 저주', ''],
  ['2', '⚔ 양손 검객',       '쌍검무',         '자유시전형 · 턴 1회', '2', '이번 턴 공격 2회 실행', ''],
  ['2', '🐀 쥐 장수',        '역병의 자손들',   '자유시전형',          '2', '쥐가 없는 타일 세 곳에 쥐 소환.', ''],
  ['2', '⚒ 무기상',          '정비',           '자유시전형 · 턴 1회', '1', '가로 혹은 세로 공격 범위 전환', ''],
  ['3', '♛ 국왕',           '절대복종 반지',   '자유시전형',          '3', '적 유닛 하나의 위치 강제 이동', ''],
  ['3', '🐉 드래곤 조련사',    '드래곤 소환',    '자유시전형 · 턴 1회', '5', '드래곤 유닛 소환 · 3HP · 십자5칸 · ATK3', ''],
  ['3', '🙏 수도승',         '신성',           '자유시전형',          '3', '자신 제외 아군 한명 체력을 2 회복하고 상태 이상 제거.', ''],
  ['3', '🔥 유황이 끓는 솥',   '유황범람',       '행동소비형',          '3', '보드 테두리 전체 공격. 2 피해.', ''],
  ['3', '⛓ 고문 기술자',      '악몽',           '자유시전형',          '2', '표식 상태의 모든 적에게 1 피해.', ''],
];

// 패시브 ──────────────────────────────────────────
// 캐릭터 / 패시브 / 현재 설명 (game.js 의 getPassiveLabel 등에서 추출) / 수정안
const PASSIVE_COL_WIDTHS = [600, 1700, 1400, 3500, 3560];
const PASSIVE_COLS = ['티어', '캐릭터', '패시브', '현재 설명 (원문)', '수정안'];

// game.js 11849-11865 의 getPassiveLabel 매핑에서 가져온 원문 그대로
// (수동 추출 — 실제 코드 변경 시 동기화 필요)
const passiveRows = [
  ['2', '🛡️ 호위 무사',     '충성',         '왕실 아군 대신 1 피해를 받습니다 (그림자 상태 제외)', ''],
  ['2', '🧙 마법사',         '인스턴트 매직', '피격 시 인스턴트 SP +1 획득 (덫·폭탄·휘말림 등 모든 피해)', ''],
  ['2', '🛡 갑주무사',       '아이언 스킨',   '받는 모든 공격 피해가 0.5 감소 (최소 0.5)', ''],
  ['3', '🙏 수도승',         '가호',         '악인 적을 공격할 때 공격력이 3으로 증가하며, 악인에게 받는 모든 공격 피해는 0.5로 감소합니다.', ''],
  ['3', '🪓 학살 영웅',      '배반자',       '공격 시 공격 범위 내 자신 외 모든 아군에게도 1 피해를 입힙니다.', ''],
  ['3', '📋 지휘관',         '사기증진',     '주변(좌우 1칸)의 아군은 공격력 +1 (지휘관 자신은 적용 X)', ''],
  ['3', '⛓ 고문 기술자',     '표식',         '공격 시 대상에게 표식을 새깁니다. 표식 상태의 적은 위치가 공개되며 악몽 스킬의 표적이 됩니다.', ''],
  ['3', '🦇 백작',           '폭정',         '1티어와 2티어에게 받는 피해 0.5 감소', ''],
];

// 문서 빌드 ──────────────────────────────────────────
const doc = new Document({
  creator: 'CALIGO',
  title: 'CALIGO 호버 팁 스킬·패시브 설명 검수',
  styles: {
    default: { document: { run: { font: 'Malgun Gothic', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Malgun Gothic', color: '2E4057' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 15840, height: 12240, orientation: 'landscape' },  // 가로
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO 호버 팁 스킬·패시브 설명 검수', size: 18, color: '888888' })],
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
      // 표지
      new Paragraph({ spacing: { before: 600 }, children: [new TextRun('')] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: '호버 팁 스킬·패시브 설명 검수', size: 56, bold: true, color: '2E4057' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: '캐릭터 프로필 호버 시 표시되는 스킬·패시브 설명 원문 (server.js CHARACTERS · game.js getPassiveLabel)', size: 22, italics: true, color: '666666' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: '"수정안" 컬럼에 변경 문구를 직접 기입하세요. 비워두면 원문 유지.', size: 20, color: '8B0000' })],
      }),
      new Paragraph({ children: [new PageBreak()] }),

      sectionTitle('A. 액티브 스킬'),
      paraDesc('호버 팁 / 캐릭터 도감 / 게임 중 스킬 모달에서 동일하게 노출되는 설명. server.js CHARACTERS 의 skills[].desc 원문 그대로.'),
      makeTable(COLS, skillRows, COL_WIDTHS),

      new Paragraph({ children: [new PageBreak()] }),

      sectionTitle('B. 패시브'),
      paraDesc('public/game.js 의 getPassiveLabel · 캐릭터 도감 본문에서 노출되는 패시브 설명 원문.'),
      makeTable(PASSIVE_COLS, passiveRows, PASSIVE_COL_WIDTHS),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:/Users/user/Desktop/board-game/CALIGO_skill_desc_review.docx';
  fs.writeFileSync(out, buf);
  console.log(`Generated: ${out}`);
  console.log(`Size: ${(buf.length / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
