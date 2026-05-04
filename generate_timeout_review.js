// 시간 초과 메시지 검수 — 게임 내 모든 페이즈의 시간초과 안내문구 원문 그대로.
// 사용자가 직접 표에 통일안을 기입할 수 있도록 사전 작업 없이 원문만 나열.
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

// ── 데이터 ───────────────────────────────────────────
// 컬럼: 페이즈 / 트리거 위치(이벤트) / 출력 채널 / 현재 메시지 (원문) / 수정안
const COL_WIDTHS = [1900, 2200, 1500, 4000, 4400];
const COLS = ['페이즈', '이벤트', '출력 채널', '현재 메시지 (원문)', '수정안'];

// === 1v1 / 공용 ===
const rowsCommon = [
  ['게임 (턴)',         'turn_timeout',           'addLog + 토스트',  '⏰ 시간 초과!', ''],
  ['초기 드래프트',      'draft_ok (timeout=true)', '토스트',           '⏰ 시간 초과로 랜덤 선택되었습니다. (서버가 timeoutMsg 동봉 시: ⏰ + 서버 메시지)', ''],
  ['초기 드래프트 (서버)', 'draftTimeout 내부',       '서버 → timeoutMsg', '시간초과로 자동 확정 됐습니다. / 시간초과로 빈 슬롯이 랜덤으로 선택됐습니다.', ''],
  ['HP 분배',           'hp_ok (timeout=true)',    '토스트',           '⏰ 시간 초과로 랜덤 분배되었습니다.', ''],
  ['초기 공개 (✓/✗)',    'initialRevealTimeout',    '없음 (무음 진행)',   '— (메시지 없음 · 자동 진행)', ''],
  ['교환 드래프트',      'exchange_done (timeout=true)', '토스트',      '시간초과! 교환 없이 확정되었습니다.', ''],
  ['최종 공개',         'finalRevealTimeout',       '없음 (무음 진행)',   '— (메시지 없음 · 자동 진행)', ''],
  ['배치 (1v1)',         'placement_timeout',       '토스트',           '⏰ 시간 초과! 미배치 말이 랜덤 배치됩니다.', ''],
];

// === 팀전 전용 ===
const rowsTeam = [
  ['팀 드래프트',        'teamDraftTimeout',        '없음 (무음 진행)',   '— (메시지 없음 · 자동 픽 후 진행)', ''],
  ['팀 HP 분배',         'teamHpTimeout',           '없음 (무음 진행)',   '— (메시지 없음 · 균등 분할 후 진행)', ''],
  ['팀 캐릭터 공개',      'teamRevealTimeout',       '없음 (무음 진행)',   '— (메시지 없음 · 자동 진행)', ''],
  ['팀 배치',           'teamPlacementTimeout',    '없음 (무음 진행)',   '— (메시지 없음 · 자동 배치 후 진행)', ''],
];

// 문서 빌드
const doc = new Document({
  creator: 'CALIGO',
  title: 'CALIGO 시간 초과 메시지 검수',
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
        size: { width: 15840, height: 12240, orientation: 'landscape' },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'CALIGO 시간 초과 메시지 검수', size: 18, color: '888888' })],
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
        children: [new TextRun({ text: '시간 초과 메시지 검수', size: 56, bold: true, color: '2E4057' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: '게임 내 모든 페이즈의 시간 초과 안내 문구 원문 (server.js / public/game.js)', size: 22, italics: true, color: '666666' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: '"수정안" 컬럼에 변경 문구를 직접 기입하세요. 비워두면 원문 유지.', size: 20, color: '8B0000' })],
      }),
      new Paragraph({ children: [new PageBreak()] }),

      sectionTitle('A. 1v1 / 공용 페이즈'),
      paraDesc('1v1 모드 및 양 모드 공유 페이즈에서 발생하는 시간 초과 안내. "—" 표시는 현재 사용자 안내 메시지가 없는 페이즈.'),
      makeTable(COLS, rowsCommon, COL_WIDTHS),

      new Paragraph({ children: [new PageBreak()] }),

      sectionTitle('B. 팀전 전용 페이즈'),
      paraDesc('현재 팀전 셋업 페이즈는 시간 초과 시 별도 안내 메시지가 없음 (자동 진행).'),
      makeTable(COLS, rowsTeam, COL_WIDTHS),

      new Paragraph({ spacing: { before: 360 }, children: [new TextRun('')] }),
      sectionTitle('참고 사항'),
      paraDesc('1) ⏰ 아이콘 사용 일관성: 일부 메시지에만 ⏰ 가 붙어 있어 통일성이 떨어짐.'),
      paraDesc('2) 출력 채널 차이: turn_timeout 만 addLog + 토스트, 그 외는 토스트만 또는 무음.'),
      paraDesc('3) 띄어쓰기 차이: "시간 초과" / "시간초과" 혼용.'),
      paraDesc('4) 어미 차이: "랜덤 선택되었습니다" / "랜덤 분배되었습니다" / "랜덤 배치됩니다" 등 시제·어미 비통일.'),
      paraDesc('5) 누락 페이즈: 초기 공개, 최종 공개, 팀전 4개 페이즈는 안내 메시지 자체가 없음.'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:/Users/user/Desktop/board-game/CALIGO_timeout_msg_review.docx';
  fs.writeFileSync(out, buf);
  console.log(`Generated: ${out}`);
  console.log(`Size: ${(buf.length / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
