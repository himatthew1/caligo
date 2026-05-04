// 보드 애니메이션 타이밍 검수 — 사용자 승인 후 통일 적용용 리포트.
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
const goldFill = 'FEF3C7';

function makeTable(columns, rows, columnWidths, highlightRowIdx) {
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
      shading: ri === highlightRowIdx
        ? { fill: goldFill, type: ShadingType.CLEAR }
        : (ri % 2 === 1 ? { fill: altFill, type: ShadingType.CLEAR } : undefined),
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        children: [new TextRun({
          text: cell || '—',
          size: 18,
          bold: ri === highlightRowIdx,
        })],
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
function subTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, color: '4A6478' })],
  });
}
function paraDesc(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({
      text, size: opts.size || 18,
      italics: opts.italics !== false,
      color: opts.color || '666666',
      bold: opts.bold || false,
    })],
  });
}
function paraNormal(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, size: opts.size || 20, bold: opts.bold || false, color: opts.color || '000000' })],
  });
}

// ── 데이터 ───────────────────────────────────────────

// SP 오브 비행 종료 시점 — 비용별
// nextMs(80) + (cost-1)*130 + flight(700) = 780 + (cost-1)*130
const spEndMs = (cost) => 780 + Math.max(0, cost - 1) * 130;

// 보드 애니메이션 catalog
//   컬럼: 이벤트 / 트리거 스킬 / SFX 시점 / 보드 변경 시점 / 토스트·로그 시점 / SP 종료 시점 / GAP 분석
const COLS = [
  '이벤트',
  '관련 스킬·상황',
  'SFX',
  '보드 변경',
  '토스트·로그',
  'SP 종료',
  '비고 / 차이',
];
const COL_WIDTHS = [1900, 2200, 1100, 1300, 1300, 900, 2900];

// 🐀 쥐 장수 = 사용자가 좋다고 한 기준점. 강조 색상.
const animRows = [
  // 이벤트, 스킬, SFX, 보드, 토스트/로그, SP종료, 비고
  ['skill_result',   '대부분 스킬 (시전자)', 'T+0',         'T+1500',                 'T+1500',            '~910ms (cost 2)', 'SFX 너무 빠름. 보드/토스트 590ms 늦음 (SP 종료 후 590ms 후).'],
  ['status_update',  '대부분 스킬 (상대)',   'T+0',         'T+1500',                 'T+1500',            '~910ms (cost 2)', '동일 — SFX 너무 빠름. 보드/토스트 늦음.'],
  ['rats_spawned',   '🐀 역병의 자손들 (cost 2)', 'T+0 (즉시)', 'T+1500 (skill_result 와 함께)', 'T+0 (즉시 addLog/toast)', '910ms', '★ 사용자 평가: 느낌 OK. 그런데 실제로는 보드는 1500ms, SFX/토스트는 0ms — 불일치 있음.'],
  ['dragon_spawned', '🐉 드래곤 소환 (cost 5)',   'T+0',        'T+1500',                 'T+0',               '1300ms',          'SFX/토스트 즉시 → SP 종료(1300ms) 와 600~1300ms 차이.'],
  ['detonation_intro', '💣 기폭 (cost 0)',       '— (단계별 SFX)', 'T+2500 (단계 1) ~ T+3450',   'T+1500 (skill_result)', '780ms (1 cost?)', 'detonation_intro 는 SP_ATTN_MS(2000) + SKILL_GAP_MS(500) = 2500ms 후 시작. 별도 시퀀스.'],
  ['bomb_detonated',  '💣 폭탄 폭발 hit',       'T+0 (즉시)', 'T+0 (즉시 renderGameBoard)', 'T+0 (즉시)',         '— (해당 없음)', 'detonation_intro 후속 — 폭탄별 개별 이벤트. 즉시 SFX+보드+토스트.'],
  ['trap_triggered',  '🪤 덫 발동 (이동 후)',   'T+0 (즉시)', 'T+0',                    'T+0',               '— (해당 없음)', '이동 직후 별도 트리거 (스킬 cast 무관). 즉시 표시 OK.'],
  ['attack_result',   '⚔ 공격 (시전자)',        'T+0',        'T+0',                    'T+0',               '— (해당 없음)', '스킬 아닌 일반 공격 — SP 비용 없음. 즉시 처리.'],
  ['being_attacked',  '⚔ 공격 받음 (상대)',     'T+0',        'T+0',                    'T+0',               '— (해당 없음)', '동일.'],
  ['team_skill_notice', '팀전 — 팀원 스킬 사용 알림', 'T+0',  'T+1500 (team_game_update)', 'T+1500',         '~910ms (cost 2)', '팀모드에서 시전자가 본인이 아닐 때.'],
  ['curse_tick',      '☠ 저주 데미지 (턴 시작)', 'T+0',        'T+0',                    '— (토스트 X, 로그 X)', '— (해당 없음)', '턴 시작 알림 — 별도 SP 시전 없음.'],
  ['twin_join_flight (분신)', '👫 분신 (cost 2)',  'T+0 (playSfxTwinsJoin)', 'T+700 (비행 종료)', 'T+1500 (skill_result)', '910ms', '비행 700ms — SP 종료(910) 보다 약간 일찍 끝남. SFX 도 비행 시작 시점.'],
];

// SP 비용별 종료 시점
const spCols = ['SP 비용', '오브 발사 시작', '마지막 오브 도착', '대표 스킬'];
const spWidths = [1500, 2500, 2500, 3360];
const spRows = [
  ['1', 't=80ms', 't=780ms', '🏹 정비 / ⚒ 정비 / 📯 질주 / 🗡 그림자 숨기'],
  ['2', 't=80, 210ms', 't=910ms', '👫 분신 / 🔭 정찰 / 🪤 덫 설치 / 🌿 약초학 / 🐀 역병의 자손들 / ⚔ 쌍검무 / ⛓ 악몽 / 💣 폭탄 설치'],
  ['3', 't=80, 210, 340ms', 't=1040ms', '☠ 저주 / 🙏 신성 / ♛ 절대복종 반지 / 🔥 유황범람'],
  ['5', 't=80~600ms', 't=1300ms', '🐉 드래곤 소환'],
  ['0', '— (오브 없음)', '0ms', '💣 기폭 (별도 detonation_intro 시퀀스)'],
];

// 통일안 제안
const proposalCols = ['항목', '현재', '제안 (쥐 장수 기준)', '계산 기준'];
const proposalWidths = [2400, 2200, 2400, 1860];
const proposalRows = [
  ['SFX 재생 시점',     '대부분 T+0 (스킬 진입 즉시)', 'T+SP_END (SP 비용별 동적)', '780 + (cost-1)*130'],
  ['보드 상태 갱신',     'T+1500 (고정)',             'T+SP_END',                  '동일'],
  ['토스트/로그',        'T+1500 (skill_result) / T+0 (rats/dragon 등)', 'T+SP_END',     '동일'],
  ['SP 비용 1 시점',    '— (SFX T+0, 보드 T+1500)',   'T+780ms',                   '780ms'],
  ['SP 비용 2 시점 (쥐 장수)', 'SFX T+0, 보드 T+1500', 'T+910ms ★',                '910ms'],
  ['SP 비용 3 시점',    '— (SFX T+0, 보드 T+1500)',   'T+1040ms',                  '1040ms'],
  ['SP 비용 5 시점 (드래곤)', 'SFX T+0, 보드 T+1500', 'T+1300ms',                  '1300ms'],
  ['SP 비용 0 시점 (기폭)', 'SFX 단계별, detonation 시작 T+2500', '제안: T+200ms (SP 시점 X, 짧은 텀)', '실제 비용 없음 — 별도 처리'],
  ['토스트 z-index',    '2000 (스킬 dim 8500 에 가려짐)', '9700 ✓ (적용 완료)',   '—'],
];

// 문서 빌드
const doc = new Document({
  creator: 'CALIGO',
  title: 'CALIGO 보드 애니메이션 타이밍 검수',
  styles: {
    default: { document: { run: { font: 'Malgun Gothic', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Malgun Gothic', color: '2E4057' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Malgun Gothic', color: '4A6478' },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
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
          children: [new TextRun({ text: 'CALIGO 보드 애니메이션 타이밍 검수', size: 18, color: '888888' })],
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
        children: [new TextRun({ text: '보드 애니메이션 타이밍 검수', size: 56, bold: true, color: '2E4057' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        children: [new TextRun({
          text: '스킬·공격·외곽 파괴 등 보드 위에서 일어나는 모든 애니메이션의 현재 타이밍 측정 + 통일안 제안',
          size: 22, italics: true, color: '666666',
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({
          text: '★ 쥐 장수 = 사용자 평가 기준 (cost 2, t=910ms)',
          size: 22, bold: true, color: '8B0000',
        })],
      }),
      new Paragraph({ children: [new PageBreak()] }),

      // 1. SP 오브 비행 시간 공식
      sectionTitle('1. SP 오브 비행 종료 시점 공식'),
      paraDesc(
        'spendSPAttention 함수 기준: 첫 오브는 t=80ms 에 출발, 이후 130ms 간격으로 추가 발사. 각 오브 비행 시간은 700ms.'
      ),
      paraNormal('  → SP_END(cost) = 80 + (cost - 1) × 130 + 700 = 780 + (cost - 1) × 130 ms', { bold: true, color: '8B0000', size: 22 }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),
      makeTable(spCols, spRows, spWidths),
      new Paragraph({ children: [new PageBreak()] }),

      // 2. 현재 보드 애니메이션 타이밍
      sectionTitle('2. 현재 보드 애니메이션 이벤트별 타이밍'),
      paraDesc('각 이벤트가 SFX / 보드 변경 / 토스트·로그 를 어느 시점에 발사하는지 측정.'),
      paraDesc('★ 표시 행 (쥐 장수) = 사용자 기준 — 단, 측정해보니 실제로는 SFX 즉시 / 보드 1500ms / 토스트 즉시로 분산되어 있어 사용자 perceptual 인상과 다소 다름.'),
      makeTable(COLS, animRows, COL_WIDTHS, 2 /* rats_spawned 행 */),
      new Paragraph({ children: [new PageBreak()] }),

      // 3. 통일안
      sectionTitle('3. 통일안 — 쥐 장수 기준'),
      paraDesc(
        '제안: 모든 스킬 관련 SFX / 보드 상태 변경 / 토스트 / 로그 를 SP 오브 비행 종료 시점에 동시 발사. SP 비용에 따라 동적으로 계산.'
      ),
      paraDesc(
        '예외: SP 비용 0 인 기폭 — 즉시 발동하면 너무 갑작스러우니 짧은 텀(약 200ms) 후 발동. 또는 별도 cast-effect 시퀀스 그대로 유지.'
      ),
      makeTable(proposalCols, proposalRows, proposalWidths),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      sectionTitle('4. 적용 방식 (코드 변경 계획)'),
      paraNormal('① 헬퍼 함수 추가:', { bold: true, size: 22 }),
      paraNormal('   function getSpFlightEndMs(cost) { return 780 + Math.max(0, cost - 1) * 130; }'),
      paraNormal('② skill_result 핸들러 (game.js:5038):', { bold: true, size: 22 }),
      paraNormal('   현재: T+0 SFX, T+1500 보드/토스트'),
      paraNormal('   변경: T+SP_END(cost) 에 SFX + 보드 + 토스트 + addLog 동시 발사', { color: '8B0000' }),
      paraNormal('③ status_update 핸들러 (game.js:5189): 동일 패턴 적용'),
      paraNormal('④ team_skill_notice (game.js:2212): 동일'),
      paraNormal('⑤ rats_spawned / dragon_spawned: 즉시 발사 → setTimeout 으로 SP_END 까지 지연', { color: '8B0000' }),
      paraNormal('⑥ detonation_intro: SP_ATTN_MS(2000) → SP_END(0+200) 로 단축 검토'),
      paraNormal('⑦ bomb_detonated (detonation 후속): 그대로 유지 (이미 detonation_intro 가 SP 흐름 마친 후 시점)'),
      paraNormal('⑧ trap_triggered / attack_result / being_attacked: SP 비용 없음 → 그대로 즉시 유지'),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('')] }),

      sectionTitle('5. 사용자 결정 필요'),
      paraDesc('통일 적용 진행하시겠습니까? Yes/No.'),
      paraDesc('또는 SP_END 공식의 기준 시점을 변경 (예: rats 가 살짝 늦게 보이길 원하시면 +100ms 오프셋 등)?'),
      paraDesc('기폭 (SP 비용 0) 처리 방식 — 짧은 텀(200ms) / 즉시 / 또는 다른 값?'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:/Users/user/Desktop/board-game/CALIGO_animation_timing_review.docx';
  fs.writeFileSync(out, buf);
  console.log(`Generated: ${out}`);
  console.log(`Size: ${(buf.length / 1024).toFixed(1)} KB`);
}).catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
