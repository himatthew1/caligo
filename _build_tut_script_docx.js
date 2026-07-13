// 튜토리얼 시나리오 텍스트 추출 → Word 문서 생성 (v2: 표 아닌 문장 나열)
//   - 그룹 헤더
//   - 각 신: 메타 라인 + 본문 + (액션 라인)
//   - 신 사이 빈 줄 + 옅은 dash 구분선 → 자유 편집/추가 용이

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  BorderStyle, ShadingType,
} = require('docx');

// ── 1) 파싱 ────────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'public/tutorial-interactive.js'), 'utf8');
const lines = src.split('\n');
const scenes = [];

function stripHtml(s) {
  return s.replace(/<\/?p>/g, '')
          .replace(/<strong>(.*?)<\/strong>/g, '$1')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .trim();
}
function extractText(block) {
  const m = block.match(/text:\s*`([^`]*)`/);
  if (m) return stripHtml(m[1]);
  if (/text:\s*null/.test(block)) return null;
  return undefined;
}
function extractKind(block) {
  const m = block.match(/kind:\s*'([^']+)'/);
  return m ? m[1] : '?';
}
function extractAnchor(block) {
  const m1 = block.match(/anchor:\s*'([^']+)'/);
  if (m1) return m1[1];
  const m2 = block.match(/anchor:\s*`([^`]+)`/);
  if (m2) return m2[1].replace('${SCOPE}', '#screen-tutorial-interactive');
  const m3 = block.match(/anchor:\s*\(\)\s*=>\s*([^,}\n]+)/);
  if (m3) return '(동적) ' + m3[1].trim().replace(/^`/, '').replace(/`$/, '');
  return null;
}
// Anchor 셀렉터를 사용자 친화 라벨로 변환
function anchorLabel(anchor) {
  if (!anchor) return null;
  const map = {
    '#tut-draft-step-indicator': '드래프트 단계 인디케이터',
    '#tut-draft-step-indicator .step.active': '현재 활성 티어 단계',
    '.slide-viewer': '캐릭터 슬라이드 뷰어',
    '#tut-icon': '캐릭터 아이콘',
    '#tut-flavor': '플레이버 텍스트',
    '#tut-atk': '캐릭터 ATK 라벨',
    '#tut-draft-preview-board': '캐릭터 공격 범위 미니 보드',
    '.slide-skill-box': '스킬 박스',
    '.draft-sidebar': '드래프트 사이드바',
    '.draft-slot.filled': '채워진 드래프트 슬롯',
    '#tut-btn-draft-select': '캐릭터 선택 버튼',
    '#tut-btn-hp-confirm': 'HP 확정 버튼',
    '.tut-target-cell': '배치 타겟 셀',
    '#tut-btn-skill': '[스킬] 액션 버튼',
    '#tut-btn-action': '[행동] 액션 버튼',
    '#tut-btn-end-turn': '[턴 종료] 액션 버튼',
    '#tut-btn-surrender': '[기권] 액션 버튼',
    '#tut-radial-menu': '부채꼴 메뉴',
    '.radial-btn[data-tut-radial-key="move"]': '부채꼴 — 🏃 이동 버튼',
    '.radial-btn[data-tut-radial-key="attack"]': '부채꼴 — ⚔ 공격 버튼',
    '.radial-btn[data-tut-radial-key="skill"]': '부채꼴 — ✨ 스킬 버튼',
    '#screen-tutorial-interactive #tut-game-board': '5×5 게임 보드',
    '#screen-tutorial-interactive .left-panel': '내 말 카드 패널 (좌)',
    '#screen-tutorial-interactive .right-panel': '상대 말 카드 패널 (우)',
    '#screen-tutorial-interactive #tut-turn-banner': '턴 배너',
    '#screen-tutorial-interactive #tut-action-bar': '액션 버튼 바',
    '#screen-tutorial-interactive .center-log-wrap': '전투 로그 패널',
    '#screen-tutorial-interactive .sp-section': 'SP 바',
  };
  if (map[anchor]) return map[anchor];
  // 동적 anchor — 좌표 추출
  const cellM = anchor.match(/boardCellSel\((\d+),\s*(\d+)\)/);
  if (cellM) {
    const COLS = ['A','B','C','D','E'];
    const c = parseInt(cellM[1]); const r = parseInt(cellM[2]);
    return `보드 셀 ${COLS[c]}${r+1}` + (anchor.includes('.piece-marker') ? ' 의 유닛' : '');
  }
  const oppCardM = anchor.match(/opp-piece-card\[data-opp-id="op-(\d+)"\]/);
  if (oppCardM) {
    const labels = { '1':'창병', '2':'호위무사', '3':'기마병', '4':'기마병(잔존)' };
    const label = labels[oppCardM[1]] || ('op-' + oppCardM[1]);
    let suffix = '';
    if (anchor.includes('.deduction-badge')) suffix = ' 의 추리 토큰 배지';
    return `상대 카드: ${label}${suffix}`;
  }
  const myCardM = anchor.match(/my-piece-card\[data-my-id="(me-[^"]+)"\]/);
  if (myCardM) return '내 카드: ' + myCardM[1];
  return anchor;
}

function extractRunSummary(block) {
  const runM = block.match(/run:\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\}/);
  if (!runM) return null;
  const body = runM[1];
  const acts = [];
  const logs = body.match(/addLog\(['`]([^'`]+)['`]/g) || [];
  logs.forEach(l => {
    const m = l.match(/addLog\(['`]([^'`]+)['`]/);
    if (m) acts.push('로그: ' + m[1]);
  });
  if (/spawnPiece\(\s*\{[^}]*id:\s*'([^']+)'/.test(body)) {
    const m = body.match(/spawnPiece\(\s*\{[^}]*id:\s*'([^']+)'/);
    acts.push('유닛 등장: ' + (m[1] || '?'));
  }
  if (/healPiece\(/.test(body)) acts.push('회복');
  if (/animatePieceSlide/.test(body)) acts.push('유닛 이동 애니');
  if (/animateAttackOnCell/.test(body)) acts.push('공격 애니');
  if (/playSpGrantCeremony/.test(body)) acts.push('SP 지급 풀스크린 애니');
  if (/playShrinkWarningSummary/.test(body)) acts.push('보드 축소 경고');
  if (/playBoardShrinkSummary/.test(body)) acts.push('보드 축소 실행');
  if (/destroyOuterRingPieces/.test(body)) acts.push('외곽 piece 탈락');
  if (/highlightMoveTargets/.test(body)) acts.push('이동 가능 셀 표시');
  if (/highlightAttackTargetsGeneral/.test(body)) acts.push('공격 가능 셀 표시');
  if (/highlightRangeOnBoard/.test(body)) acts.push('사거리 시각화');
  if (/clearRangeHighlight/.test(body)) acts.push('사거리 해제');
  const tM = body.match(/S\.turn\s*=\s*(\d+)/);
  if (tM) acts.push('턴 → ' + tM[1] + '턴');
  const wM = body.match(/S\.whose\s*=\s*'(me|opp)'/);
  if (wM) acts.push('차례: ' + (wM[1] === 'me' ? '내 차례' : '상대 차례'));
  return acts.length ? acts.join(' · ') : null;
}
function extractOnClickSummary(block) {
  const m = block.match(/onClick:\s*\(\)\s*=>\s*\{([^}]*)\}/);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;
  const acts = [];
  if (/S\.selectedPiece\s*=\s*findMyPiece/.test(body)) acts.push('유닛 선택');
  if (/openTutRadial/.test(body)) acts.push('부채꼴 메뉴 열기');
  if (/closeTutRadial/.test(body)) acts.push('부채꼴 메뉴 닫기');
  if (/highlightMoveTargets/.test(body)) acts.push('이동 셀 표시');
  if (/highlightAttackTargetsGeneral/.test(body)) acts.push('공격 셀 표시');
  return acts.length ? acts.join(' · ') : null;
}

let inScenario = false, pushDepth = 0, block = '', groupName = '인트로';
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const groupM = line.match(/^\s*\/\/\s*──\s*(.+?)\s*──/);
  if (groupM) {
    const g = groupM[1].trim();
    if (g && !/엔진/.test(g)) groupName = g;
  }
  if (line.includes('SCENARIO.push(')) {
    inScenario = true; pushDepth = 0; block = '';
  }
  if (inScenario) {
    block += line + '\n';
    for (const ch of line) {
      if (ch === '{') pushDepth++;
      else if (ch === '}') pushDepth--;
    }
    if (pushDepth === 0 && line.includes('})')) {
      scenes.push({
        group: groupName,
        kind: extractKind(block),
        text: extractText(block),
        anchor: extractAnchor(block),
        anchorLabel: anchorLabel(extractAnchor(block)),
        runSummary: extractRunSummary(block),
        clickSummary: extractOnClickSummary(block),
      });
      inScenario = false; block = '';
    }
  }
}
console.log('파싱된 신 수:', scenes.length);

// ── 2) Word 문서 빌드 (문장 나열식) ──────────────────────────────────────────
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text: text || '',
      font: 'Arial',
      size: opts.size || 22,
      bold: !!opts.bold,
      color: opts.color || '000000',
      italics: !!opts.italics,
    })],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 0 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });
}
function emptyLine() {
  return new Paragraph({ children: [new TextRun({ text: '' })], spacing: { before: 0, after: 0 } });
}
// 옅은 점선 구분 (paragraph with bottom border)
function dashedDivider() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: {
      bottom: { color: 'CCCCCC', style: BorderStyle.DASHED, size: 6, space: 1 },
    },
    spacing: { before: 60, after: 60 },
  });
}

const children = [];

// 표지
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 600, after: 200 },
  children: [new TextRun({ text: 'CALIGO', font: 'Arial', size: 72, bold: true, color: '1F4E79' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 600 },
  children: [new TextRun({ text: '튜토리얼 시나리오 스크립트', font: 'Arial', size: 36, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 1200 },
  children: [new TextRun({ text: `총 ${scenes.length}신 · 자유 편집 형식`, font: 'Arial', size: 22, color: '666666' })],
}));

// 사용 안내
children.push(new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 200, after: 120 },
  children: [new TextRun({ text: '읽고 편집하는 법', font: 'Arial', size: 26, bold: true, color: '2E75B6' })],
}));
[
  '· 각 신은 3-4줄 단위로 나열되어 있어요.',
  '· [번호] 종류 · 가리킴 → 메타 정보 (작은 회색 글씨)',
  '· 본문 줄 → 말풍선 텍스트. 자유롭게 고쳐도 됩니다.',
  '· └ 액션 줄 → 애니메이션/로그/클릭 동작 요약 (참고용)',
  '· 신 사이 점선 — 거기에 새 신 추가 / 메모 자유롭게 적어주세요.',
  '· "[삭제]" 또는 "[새 dialog: ...]" 같은 식의 지시도 OK.',
].forEach(t => children.push(p(t, { size: 20 })));

// 그룹별 신 나열
let curGroup = null;

scenes.forEach((sc, i) => {
  if (sc.group !== curGroup) {
    curGroup = sc.group;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 480, after: 160 },
      pageBreakBefore: i > 5,  // 첫 그룹 외엔 페이지 시작
      children: [new TextRun({ text: '── ' + curGroup + ' ──', font: 'Arial', size: 28, bold: true, color: '1F4E79' })],
    }));
  }

  // 메타 라인 — 작은 회색
  const num = String(i + 1).padStart(3, '0');
  const kindKor = { dialog: '말풍선', require: '클릭 대기', animate: '애니메이션', enter: '페이즈 전환', reveal: 'UI 등장' }[sc.kind] || sc.kind;
  let metaParts = [`[${num}]`, kindKor];
  if (sc.anchorLabel) metaParts.push('가리킴: ' + sc.anchorLabel);
  children.push(p(metaParts.join(' · '), { size: 16, color: '888888' }));

  // 본문 — text
  if (sc.text === null) {
    children.push(p('(텍스트 없음 — 자동 진행)', { size: 18, color: 'AAAAAA', italics: true }));
  } else if (sc.text === undefined) {
    children.push(p('(추출 실패)', { size: 18, color: 'BB0000' }));
  } else if (sc.text === '') {
    children.push(p('(빈 텍스트)', { size: 18, color: 'AAAAAA', italics: true }));
  } else {
    children.push(p(sc.text, { size: 24 }));
  }

  // 액션 라인 — 작은 회색 (있으면)
  const actNote = sc.runSummary || sc.clickSummary;
  if (actNote) {
    children.push(p('└ ' + actNote, { size: 16, color: '888888', indent: 280 }));
  }

  // 신 사이 구분선
  children.push(dashedDivider());
});

// 마무리
children.push(new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 480, after: 120 },
  pageBreakBefore: true,
  children: [new TextRun({ text: '편집 가이드', font: 'Arial', size: 26, bold: true, color: '2E75B6' })],
}));
[
  '편집 의도를 적는 예시 — 점선 사이나 메타 줄 아래 자유롭게:',
  '',
  '  [005] 말풍선 ··· (기존)',
  '  안녕하세요, 새로운 전사여',
  '  ─────────',
  '  [삭제] 이 신 통째로 제거',
  '  [신규 dialog 추가] "잠깐, 먼저 보드를 둘러봅시다." 가리킴: 보드',
  '',
  '아래 표기를 사용해 주세요:',
  '· [삭제] — 이 신 제거',
  '· [수정] — 위 본문 텍스트 그대로 교체',
  '· [신규 dialog] / [신규 require] / [신규 animate] — 이 자리에 신 추가',
  '· [순서 변경] N번 신을 앞/뒤로 — 어디로 옮길지 명시',
  '· 자유 메모 — 마음대로',
].forEach(t => children.push(p(t, { size: 20 })));

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '1F4E79' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },   // US Letter
        margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
      },
    },
    children,
  }],
});

const OUT = path.join(__dirname, 'CALIGO_tutorial_script_v2.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('생성:', OUT, '·', buf.length, 'bytes');
}).catch(err => { console.error('실패:', err); process.exit(1); });
