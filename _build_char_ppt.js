// CALIGO 캐릭터 도감 PPT 생성 — 실제 CHARACTERS(30종)만, 더미 제외.
const pptxgen = require("pptxgenjs");
const path = require("path");
const ICON = (t) => path.join(__dirname, "public", "assets", "icons", t + ".png");
// idle GIF (움직이는 스프라이트). 쌍둥이는 전용 키(누나=red) 사용.
const IDLE = (t) => path.join(__dirname, "public", "art", (t === "twins" ? "twins_red" : t) + "_idle.gif");

// ── 테마 ──
const C = {
  bg: "17141F", panel: "241F33", panel2: "2E2842",
  gold: "E2B714", light: "EDE9F0", mut: "A89FB8", line: "453C5C",
  t1: "CD7F32", t2: "B0B7C3", t3: "E2B714",
};
const FAC = {
  royal:   { label: "왕실", fill: "C9A227", txt: "241B0E" },
  villain: { label: "악인", fill: "B23A48", txt: "FFFFFF" },
  null:    { label: "중립", fill: "5C6B73", txt: "FFFFFF" },
};
const tierColor = (t) => (t === 1 ? C.t1 : t === 2 ? C.t2 : C.t3);

// ── 패시브 설명 ──
const PASSIVE = {
  instantMagic: ["인스턴트매직", "피격 시 인스턴트 SP +1"],
  ironSkin:     ["아이언스킨", "받는 모든 피해 −0.5"],
  loyalty:      ["충성", "같은 편 왕실 아군이 피격되면 대신 1 피해(왕실 0 피해)"],
  grace:        ["가호", "악인 공격 시 피해 3 고정 · 악인에게 피격 시 피해 0.5"],
  betrayer:     ["배반자", "3×3 공격에 아군도 피해(오사)"],
  wrath:        ["사기증진", "직교 인접 아군이 공격 시 그 피해 +1"],
  markPassive:  ["표식", "공격·피격 시 대상에 표식 부여(악몽 콤보)"],
  tyranny:      ["폭정", "티어1·2 공격자에게 피격 시 피해 −0.5"],
};

// ── 캐릭터 데이터 (server.js CHARACTERS — 실제 30종) ──
const CH = {
1: [
 ["archer","궁수",1,1,null,"좌측 대각선 직선 전체(토글 ↘/↙)",[["정비","reform",1,false,"공격 범위 좌우 반전"]],[]],
 ["spearman","창병",1,1,"royal","위치한 세로줄 전체",[],[]],
 ["cavalry","기마병",1,1,"royal","위치한 가로줄 전체",[],[]],
 ["watchman","파수꾼",1,0.5,null,"주변 8칸(자기 제외)",[],[]],
 ["twins","쌍둥이 강도",1,1,"villain","누나 가로3 / 동생 세로3",[["분신","brothers",2,true,"누나↔동생 위치로 합류(한 칸에 합체)"]],[]],
 ["scout","척후병",1,1,"royal","자신 포함 가로 3칸",[["정찰","recon",2,false,"랜덤 적 1명의 행 또는 열 공개"]],[]],
 ["manhunter","인간 사냥꾼",1,1,"villain","자신 포함 세로 3칸",[["덫 설치","trap",2,true,"현 위치에 덫 설치 · 작동 시 2 피해"]],[]],
 ["messenger","전령",1,0.5,null,"자신 포함 X대각선 5칸",[["질주","sprint",1,false,"이번 턴 이동 2회 실행"]],[]],
 ["gunpowder","화약상",1,1,null,"상하 각 2칸(자기 제외) · 세로 4칸",[["폭탄 설치","bomb",2,false,"주변 8칸 중 한 곳에 폭탄 설치"],["기폭","detonate",0,false,"설치된 폭탄 전부 폭발 · 1 피해"]],[]],
 ["herbalist","약초전문가",1,1,null,"좌우 각 2칸(자기 제외) · 가로 4칸",[["약초학","herb",2,false,"자신 제외 주변 모든 아군 체력 1 회복"]],[]],
],
2: [
 ["general","장군",2,2,"royal","자신 포함 십자(상하좌우) 5칸",[],[]],
 ["knight","기사",2,2,"royal","자신 포함 X대각선 5칸",[],[]],
 ["shadowAssassin","그림자 암살자",2,2,"villain","주변 3×3 중 1칸 선택 타격",[["그림자 숨기","shadow",1,false,"다음 턴까지 공격·상태이상 면역"]],[]],
 ["wizard","마법사",2,2,null,"한 칸 건너뛴 십자 4칸(거리 2)",[],["instantMagic"]],
 ["armoredWarrior","갑주무사",2,2,null,"자신 + 아랫줄 가로 3칸(총 4칸)",[],["ironSkin"]],
 ["witch","마녀",2,1,"villain","전체 보드 중 1칸 선택 원거리 타격",[["저주","curse",3,true,"적 1명에게 저주 부여(지속 0.5 피해)"]],[]],
 ["dualBlade","양손 검객",2,2,null,"좌우 대각선 4칸(col±1, row±1)",[["쌍검무","dualStrike",2,false,"이번 턴 공격 2회 실행"]],[]],
 ["ratMerchant","쥐 장수",2,1,"villain","제자리 + 소환된 쥐 칸 공격",[["역병의 자손들","rats",2,false,"쥐 없는 랜덤 타일 세 곳에 쥐 소환"]],[]],
 ["weaponSmith","무기상",2,2,null,"가로 3칸(정비로 세로 전환)",[["정비","reform",1,false,"가로 ↔ 세로 공격 범위 전환"]],[]],
 ["bodyguard","호위 무사",2,1,"royal","십자 상하좌우 4칸(자기 제외)",[],["loyalty"]],
],
3: [
 ["prince","왕자",3,3,"royal","자신 포함 좌우 3칸",[],[]],
 ["princess","공주",3,3,"royal","자신 포함 상하 3칸",[],[]],
 ["king","국왕",3,2,"royal","자신의 칸만",[["절대복종 반지","ring",3,false,"적 유닛 하나의 위치 강제 이동"]],[]],
 ["dragonTamer","드래곤 조련사",3,2,null,"X대각선 4칸(자기 제외)",[["드래곤 소환","dragon",5,false,"드래곤 유닛 소환(최고가 5 SP)"]],[]],
 ["monk","수도승",3,1,null,"상하 각 1칸(자기 제외) · 세로",[["신성","divine",3,false,"아군 1명 체력 2 회복 + 상태이상 제거"]],["grace"]],
 ["slaughterHero","학살 영웅",3,1,"villain","3×3 전체 9칸",[],["betrayer"]],
 ["commander","지휘관",3,2,"royal","좌우 각 1칸(자기 제외)",[],["wrath"]],
 ["sulfurCauldron","유황이 끓는 솥",3,0.5,"royal","주변 8칸(자기 제외)",[["유황범람","sulfurRiver",3,true,"보드 테두리 전체 공격 · 2 피해"]],[]],
 ["torturer","고문 기술자",3,1,"villain","십자 4방향(자기 제외) 4칸",[["악몽","nightmare",2,false,"표식 상태의 모든 적에게 1 피해"]],["markPassive"]],
 ["count","백작",3,2,"villain","자신 포함 X대각선 5칸",[],["tyranny"]],
],
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "CALIGO"; pres.title = "CALIGO 캐릭터 도감";
const SW = 13.3, SH = 7.5;
const HEAD = "Georgia", BODY = "맑은 고딕";
const sh = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 135, opacity: 0.35 });

// ════ 1. 표지 ════
(() => {
  const s = pres.addSlide(); s.background = { color: C.bg };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SW, h: 0.18, fill: { color: C.gold } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: SH - 0.18, w: SW, h: 0.18, fill: { color: C.gold } });
  s.addText("CALIGO", { x: 0, y: 2.05, w: SW, h: 1.3, align: "center", fontFace: HEAD, fontSize: 76, bold: true, color: C.gold, charSpacing: 8 });
  s.addText("캐릭터 도감", { x: 0, y: 3.35, w: SW, h: 0.9, align: "center", fontFace: HEAD, fontSize: 34, color: C.light, charSpacing: 4 });
  s.addText("티어 · 팩션 · 공격력 · 공격 범위 · 스킬 · 패시브 — 전체 30종", { x: 0, y: 4.4, w: SW, h: 0.5, align: "center", fontFace: BODY, fontSize: 15, color: C.mut });
})();

// ════ 2. 개요 / 범례 ════
(() => {
  const s = pres.addSlide(); s.background = { color: C.bg };
  s.addText("개요 · 범례", { x: 0.6, y: 0.4, w: 12, h: 0.7, fontFace: HEAD, fontSize: 30, bold: true, color: C.gold });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.12, w: 4.2, h: 0.05, fill: { color: C.line } });

  const panel = (x, y, w, h, title) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.panel }, line: { color: C.line, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.09, h, fill: { color: C.gold } });
    s.addText(title, { x: x + 0.25, y: y + 0.12, w: w - 0.4, h: 0.4, fontFace: HEAD, fontSize: 16, bold: true, color: C.light });
  };
  // 팩션
  panel(0.6, 1.4, 5.9, 1.95, "팩션 (소속)");
  const facRows = [["왕실","FAC","royal","왕실 보호·충성 시너지(호위무사 등)"],["악인","FAC","villain","수도승 가호의 표적(악인 특화 효과)"],["중립","FAC","null","소속 없음 — 패시브 시너지와 무관"]];
  facRows.forEach((r, i) => {
    const yy = 1.92 + i * 0.46; const f = FAC[r[2]];
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: yy, w: 1.0, h: 0.34, fill: { color: f.fill }, rectRadius: 0.05 });
    s.addText(f.label, { x: 0.9, y: yy, w: 1.0, h: 0.34, align: "center", valign: "middle", fontFace: BODY, fontSize: 12, bold: true, color: f.txt });
    s.addText(r[3], { x: 2.1, y: yy, w: 4.3, h: 0.34, valign: "middle", fontFace: BODY, fontSize: 12, color: C.mut });
  });
  // 티어
  panel(6.8, 1.4, 5.9, 1.95, "티어 (등급)");
  [["1","기본 ATK 1","bronze",C.t1],["2","기본 ATK 2","silver",C.t2],["3","기본 ATK 3 · 고급 스킬","gold",C.t3]].forEach((r, i) => {
    const yy = 1.92 + i * 0.46;
    s.addShape(pres.shapes.OVAL, { x: 7.1, y: yy, w: 0.34, h: 0.34, fill: { color: r[3] } });
    s.addText("T" + r[0], { x: 7.1, y: yy, w: 0.34, h: 0.34, align: "center", valign: "middle", fontFace: HEAD, fontSize: 12, bold: true, color: "1A1422" });
    s.addText("티어 " + r[0] + " — " + r[1], { x: 7.6, y: yy, w: 4.9, h: 0.34, valign: "middle", fontFace: BODY, fontSize: 12, color: C.mut });
  });
  // SP / 스킬 규칙
  panel(0.6, 3.55, 5.9, 1.55, "SP · 스킬 규칙");
  s.addText([
    { text: "SP 지급: ", options: { bold: true, color: C.light } }, { text: "턴 10·20·30·40에만 +1(상한 10) — 매우 희소", options: { color: C.mut, breakLine: true } },
    { text: "행동 대체: ", options: { bold: true, color: C.light } }, { text: "그 턴의 이동/공격을 대신 소모", options: { color: C.mut, breakLine: true } },
    { text: "무료(병행): ", options: { bold: true, color: C.light } }, { text: "이동/공격과 별개로 추가 사용 가능", options: { color: C.mut } },
  ], { x: 0.9, y: 4.0, w: 5.4, h: 1.0, fontFace: BODY, fontSize: 12, paraSpaceAfter: 4 });
  // 패시브
  panel(6.8, 3.55, 5.9, 3.4, "패시브 (자동 효과)");
  const pv = Object.values(PASSIVE);
  s.addText(pv.map((p, i) => ([
    { text: p[0] + " ", options: { bold: true, color: C.gold } },
    { text: "— " + p[1], options: { color: C.mut, breakLine: true } },
  ])).flat(), { x: 7.1, y: 4.0, w: 5.4, h: 2.85, fontFace: BODY, fontSize: 11.5, paraSpaceAfter: 5, valign: "top" });
  // 통계
  s.addText("승리 = 상대 말 3개 전멸 · 패배 = 내 말 3개 전멸   |   덱 = 티어별 1명씩 3유닛", { x: 0.6, y: 6.95, w: 12.1, h: 0.4, align: "center", fontFace: BODY, fontSize: 12, italic: true, color: C.mut });
})();

// ════ 캐릭터 카드 ════
function renderTierSlides(tier) {
  const list = CH[tier];
  const tc = tierColor(tier);
  for (let part = 0; part < 2; part++) {
    const group = list.slice(part * 5, part * 5 + 5);
    const s = pres.addSlide(); s.background = { color: C.bg };
    // 헤더
    s.addShape(pres.shapes.OVAL, { x: 0.6, y: 0.42, w: 0.62, h: 0.62, fill: { color: tc } });
    s.addText("T" + tier, { x: 0.6, y: 0.42, w: 0.62, h: 0.62, align: "center", valign: "middle", fontFace: HEAD, fontSize: 20, bold: true, color: "1A1422" });
    s.addText("티어 " + tier + " 캐릭터", { x: 1.4, y: 0.42, w: 8, h: 0.62, valign: "middle", fontFace: HEAD, fontSize: 26, bold: true, color: C.light });
    s.addText((part + 1) + " / 2", { x: 11.4, y: 0.5, w: 1.3, h: 0.5, align: "right", valign: "middle", fontFace: BODY, fontSize: 13, color: C.mut });

    const cw = 2.4, gap = 0.18, n = group.length;
    const totalW = n * cw + (n - 1) * gap;
    const x0 = (SW - totalW) / 2, cy = 1.35, chH = 5.75;
    group.forEach((ch, i) => {
      const [type, name, t, atk, fac, range, skills, passives] = ch;
      const x = x0 + i * (cw + gap);
      const f = FAC[fac];
      // 카드 배경 + 티어 상단바
      s.addShape(pres.shapes.RECTANGLE, { x, y: cy, w: cw, h: chH, fill: { color: C.panel }, line: { color: C.line, width: 1 }, shadow: sh() });
      s.addShape(pres.shapes.RECTANGLE, { x, y: cy, w: cw, h: 0.1, fill: { color: tc } });
      // idle GIF (메인, 원형 배경) — PowerPoint 슬라이드쇼에서 애니메이션 재생
      const icSz = 1.15, icx = x + (cw - icSz) / 2, icy = cy + 0.34;
      s.addShape(pres.shapes.OVAL, { x: icx - 0.12, y: icy - 0.12, w: icSz + 0.24, h: icSz + 0.24, fill: { color: C.panel2 }, line: { color: tc, width: 1.5 } });
      if (type === "twins") {
        // 쌍둥이 — 누나(red) + 동생(blue) 둘 다 나란히
        const gz = 0.66, gy = icy + (icSz - gz) / 2, mid = x + cw / 2;
        s.addImage({ path: path.join(__dirname, "public", "art", "twins_red_idle.gif"),  x: mid - gz - 0.02, y: gy, w: gz, h: gz, sizing: { type: "contain", w: gz, h: gz } });
        s.addImage({ path: path.join(__dirname, "public", "art", "twins_blue_idle.gif"), x: mid + 0.02,       y: gy, w: gz, h: gz, sizing: { type: "contain", w: gz, h: gz } });
      } else {
        s.addImage({ path: IDLE(type), x: icx, y: icy, w: icSz, h: icSz, sizing: { type: "contain", w: icSz, h: icSz } });
      }
      // 아이콘 PNG 배지 (좌상단 작은 원)
      const bz = 0.4;
      s.addShape(pres.shapes.OVAL, { x: x + 0.08, y: cy + 0.16, w: bz, h: bz, fill: { color: C.bg }, line: { color: tc, width: 1 } });
      s.addImage({ path: ICON(type), x: x + 0.08 + 0.05, y: cy + 0.16 + 0.05, w: bz - 0.1, h: bz - 0.1 });
      // 이름
      s.addText(name, { x: x + 0.1, y: cy + 1.75, w: cw - 0.2, h: 0.5, align: "center", valign: "middle", fontFace: HEAD, fontSize: 16, bold: true, color: C.light });
      // 팩션 + ATK 한 줄
      const pillW = 0.86, atkW = 0.96, rowY = cy + 2.28, rowGap = 0.12;
      const rowStart = x + (cw - (pillW + atkW + rowGap)) / 2;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rowStart, y: rowY, w: pillW, h: 0.36, fill: { color: f.fill }, rectRadius: 0.05 });
      s.addText(f.label, { x: rowStart, y: rowY, w: pillW, h: 0.36, align: "center", valign: "middle", fontFace: BODY, fontSize: 11.5, bold: true, color: f.txt });
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rowStart + pillW + rowGap, y: rowY, w: atkW, h: 0.36, fill: { color: C.panel2 }, line: { color: tc, width: 1 }, rectRadius: 0.05 });
      s.addText("ATK " + atk, { x: rowStart + pillW + rowGap, y: rowY, w: atkW, h: 0.36, align: "center", valign: "middle", fontFace: BODY, fontSize: 11.5, bold: true, color: C.gold });
      // 구분선
      s.addShape(pres.shapes.RECTANGLE, { x: x + 0.22, y: cy + 2.82, w: cw - 0.44, h: 0.015, fill: { color: C.line } });
      // 공격 범위
      s.addText([
        { text: "공격 범위", options: { bold: true, color: tc, breakLine: true } },
        { text: range, options: { color: C.light } },
      ], { x: x + 0.2, y: cy + 2.95, w: cw - 0.4, h: 0.95, fontFace: BODY, fontSize: 11, valign: "top", paraSpaceAfter: 2 });
      // 스킬 / 패시브
      const blocks = [];
      skills.forEach(sk => {
        const [sn, sid, cost, repl, sdesc] = sk;
        blocks.push({ text: "스킬 ", options: { bold: true, color: C.gold } });
        blocks.push({ text: sn + " ", options: { bold: true, color: C.light } });
        blocks.push({ text: "(SP " + cost + " · " + (repl ? "행동대체" : "무료") + ")", options: { color: C.mut, breakLine: true } });
        blocks.push({ text: sdesc, options: { color: C.light, breakLine: true } });
      });
      passives.forEach(pid => {
        const p = PASSIVE[pid];
        blocks.push({ text: "패시브 ", options: { bold: true, color: "7FB3D5" } });
        blocks.push({ text: p[0], options: { bold: true, color: C.light, breakLine: true } });
        blocks.push({ text: p[1], options: { color: C.light, breakLine: true } });
      });
      if (blocks.length === 0) blocks.push({ text: "보유 스킬·패시브 없음 (기본 공격형)", options: { italic: true, color: C.mut } });
      s.addText(blocks, { x: x + 0.2, y: cy + 4.0, w: cw - 0.4, h: 1.65, fontFace: BODY, fontSize: 10.5, valign: "top", paraSpaceAfter: 2 });
    });
  }
}
[1, 2, 3].forEach(renderTierSlides);

// ════ 특수 유닛: 드래곤 (소환) ════
(() => {
  const s = pres.addSlide(); s.background = { color: C.bg };
  const tc = C.t3;
  s.addShape(pres.shapes.OVAL, { x: 0.6, y: 0.42, w: 0.62, h: 0.62, fill: { color: tc } });
  s.addText("★", { x: 0.6, y: 0.4, w: 0.62, h: 0.62, align: "center", valign: "middle", fontFace: HEAD, fontSize: 22, bold: true, color: "1A1422" });
  s.addText("특수 유닛 — 드래곤", { x: 1.4, y: 0.42, w: 9, h: 0.62, valign: "middle", fontFace: HEAD, fontSize: 26, bold: true, color: C.light });
  s.addText("소환 전용 (드래프트 불가)", { x: 9.5, y: 0.5, w: 3.2, h: 0.5, align: "right", valign: "middle", fontFace: BODY, fontSize: 13, italic: true, color: C.mut });

  // 좌측: 큰 idle GIF + 아이콘 배지
  const big = 3.0, bx = 1.5, by = 2.0;
  s.addShape(pres.shapes.OVAL, { x: bx - 0.25, y: by - 0.25, w: big + 0.5, h: big + 0.5, fill: { color: C.panel2 }, line: { color: tc, width: 2 }, shadow: sh() });
  s.addImage({ path: IDLE("dragon"), x: bx, y: by, w: big, h: big, sizing: { type: "contain", w: big, h: big } });
  const dbz = 0.7;
  s.addShape(pres.shapes.OVAL, { x: bx - 0.1, y: by - 0.1, w: dbz, h: dbz, fill: { color: C.bg }, line: { color: tc, width: 1.5 } });
  s.addImage({ path: ICON("dragon"), x: bx - 0.1 + 0.09, y: by - 0.1 + 0.09, w: dbz - 0.18, h: dbz - 0.18 });

  // 우측: 정보 패널
  const px = 6.0, pw = 6.7, py = 1.55;
  s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: pw, h: 5.1, fill: { color: C.panel }, line: { color: C.line, width: 1 }, shadow: sh() });
  s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: pw, h: 0.1, fill: { color: tc } });
  s.addText("드래곤", { x: px + 0.4, y: py + 0.3, w: pw - 0.8, h: 0.7, fontFace: HEAD, fontSize: 32, bold: true, color: C.light });
  // 배지 행
  const ry = py + 1.15;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px + 0.4, y: ry, w: 1.1, h: 0.42, fill: { color: FAC.null.fill }, rectRadius: 0.05 });
  s.addText("중립", { x: px + 0.4, y: ry, w: 1.1, h: 0.42, align: "center", valign: "middle", fontFace: BODY, fontSize: 13, bold: true, color: FAC.null.txt });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px + 1.65, y: ry, w: 1.2, h: 0.42, fill: { color: C.panel2 }, line: { color: tc, width: 1 }, rectRadius: 0.05 });
  s.addText("ATK 3", { x: px + 1.65, y: ry, w: 1.2, h: 0.42, align: "center", valign: "middle", fontFace: BODY, fontSize: 13, bold: true, color: C.gold });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px + 3.0, y: ry, w: 1.2, h: 0.42, fill: { color: C.panel2 }, line: { color: tc, width: 1 }, rectRadius: 0.05 });
  s.addText("HP 3", { x: px + 3.0, y: ry, w: 1.2, h: 0.42, align: "center", valign: "middle", fontFace: BODY, fontSize: 13, bold: true, color: "7FD49A" });
  // 상세
  s.addText([
    { text: "공격 범위", options: { bold: true, color: tc, breakLine: true } },
    { text: "자신 + 상하좌우 십자 5칸", options: { color: C.light, breakLine: true } },
    { text: " ", options: { fontSize: 6, breakLine: true } },
    { text: "소환 방법", options: { bold: true, color: tc, breakLine: true } },
    { text: "드래곤 조련사의 스킬 '드래곤 소환'(SP 5, 최고가)으로 빈 칸(유해 제외)에 소환되는 특수 유닛.", options: { color: C.light, breakLine: true } },
    { text: " ", options: { fontSize: 6, breakLine: true } },
    { text: "특징", options: { bold: true, color: tc, breakLine: true } },
    { text: "사망 시 유해를 남기지 않음. 보드 위 최강의 단일 전력.", options: { color: C.light } },
  ], { x: px + 0.4, y: ry + 0.7, w: pw - 0.8, h: 2.9, fontFace: BODY, fontSize: 14, valign: "top", paraSpaceAfter: 4 });
})();

// ════ 스킬 전체 표 ════
(() => {
  const s = pres.addSlide(); s.background = { color: C.bg };
  s.addText("스킬 전체 목록", { x: 0.6, y: 0.35, w: 12, h: 0.65, fontFace: HEAD, fontSize: 28, bold: true, color: C.gold });
  const head = ["캐릭터","T","스킬","SP","유형","효과"].map(t => ({ text: t, options: { fill: { color: C.panel2 }, color: C.gold, bold: true, fontFace: BODY, fontSize: 12, align: "center", valign: "middle" } }));
  const rows = [head];
  [1,2,3].forEach(t => CH[t].forEach(ch => {
    const [type,name,tt,atk,fac,range,skills] = ch;
    skills.forEach(sk => {
      const [sn,sid,cost,repl,sdesc] = sk;
      rows.push([
        { text: name, options: { color: C.light, bold: true } },
        { text: "T"+tt, options: { color: C.mut, align: "center" } },
        { text: sn, options: { color: C.gold } },
        { text: String(cost), options: { color: C.light, align: "center" } },
        { text: repl ? "행동대체" : "무료", options: { color: C.mut, align: "center" } },
        { text: sdesc, options: { color: C.light } },
      ]);
    });
  }));
  s.addTable(rows, { x: 0.5, y: 1.15, w: 12.3, colW: [1.9, 0.55, 2.0, 0.55, 1.1, 6.2], rowH: 0.34,
    border: { type: "solid", pt: 0.5, color: C.line }, fill: { color: C.panel }, fontFace: BODY, fontSize: 10.5, valign: "middle", color: C.light, align: "left", autoPage: false });
})();

// ════ 패시브 전체 표 ════
(() => {
  const s = pres.addSlide(); s.background = { color: C.bg };
  s.addText("패시브 전체 목록", { x: 0.6, y: 0.35, w: 12, h: 0.65, fontFace: HEAD, fontSize: 28, bold: true, color: C.gold });
  const head = ["캐릭터","T","팩션","패시브","효과"].map(t => ({ text: t, options: { fill: { color: C.panel2 }, color: C.gold, bold: true, fontFace: BODY, fontSize: 12, align: "center", valign: "middle" } }));
  const rows = [head];
  [1,2,3].forEach(t => CH[t].forEach(ch => {
    const [type,name,tt,atk,fac,range,skills,passives] = ch;
    passives.forEach(pid => {
      const p = PASSIVE[pid]; const f = FAC[fac];
      rows.push([
        { text: name, options: { color: C.light, bold: true } },
        { text: "T"+tt, options: { color: C.mut, align: "center" } },
        { text: f.label, options: { color: C.mut, align: "center" } },
        { text: p[0], options: { color: "7FB3D5", bold: true } },
        { text: p[1], options: { color: C.light } },
      ]);
    });
  }));
  s.addTable(rows, { x: 0.9, y: 1.15, w: 11.5, colW: [2.0, 0.55, 1.0, 2.0, 5.95], rowH: 0.42,
    border: { type: "solid", pt: 0.5, color: C.line }, fill: { color: C.panel }, fontFace: BODY, fontSize: 11.5, valign: "middle", color: C.light, align: "left", autoPage: false });
  s.addText("패시브는 조건 충족 시 자동 발동 — 별도 SP·조작 불필요.", { x: 0.9, y: 6.9, w: 11.5, h: 0.4, align: "center", fontFace: BODY, fontSize: 12, italic: true, color: C.mut });
})();

pres.writeFile({ fileName: "CALIGO_캐릭터_도감.pptx" }).then(f => console.log("WROTE", f));
