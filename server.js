// .env 는 cwd 가 아니라 server.js 위치 기준으로 로드 (프리뷰/배포 환경 cwd 무관)
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); }
catch (e) { /* dotenv 없으면 무시 */ }
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

// #9: 재접속용 토큰 생성
function genSessionToken() {
  return crypto.randomBytes(16).toString('hex');
}
const RECONNECT_GRACE_MS = 30000;  // 30초 유예

// ── 글로벌 에러 핸들러 (서버 크래시 방지) ──
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err.message, err.stack);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});

const ROW_LABELS = ['A','B','C','D','E','F','G'];
function coord(col, row) { return `${ROW_LABELS[row] || row}${col + 1}`; }

// 한국어 조사 자동 변환 — 마지막 글자의 받침 유무로 with받침/without받침 선택.
//   한글이 아니거나 빈 문자열이면 without받침 반환.
//   사용: `${name}${조사(name, '이', '가')} 이동` → 받침 있으면 '이', 없으면 '가'
function 조사(word, with받침, without받침) {
  if (!word || typeof word !== 'string') return without받침;
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return without받침;
  const hasJongseong = (last - 0xAC00) % 28 !== 0;
  return hasJongseong ? with받침 : without받침;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// ── 정적 파일 캐시 정책 ──
//   ❗ 기본 express.static 은 Cache-Control: max-age=0 → 브라우저가 매 렌더마다 모든
//      이미지/GIF 를 재검증(conditional GET → 304)함. 보드/프로필/스킬 메뉴가 재렌더될 때마다
//      <img> 가 새로 생성되므로, 클릭·상호작용 한 번에 수십 개의 304 요청이 발생("끊임없이 새로 로드").
//   ✅ 해결: 이미지·오디오·폰트 등 "내용이 바뀌면 어차피 파일을 교체하는" 정적 에셋은 길게 캐시 →
//      브라우저가 네트워크 요청 없이 메모리/디스크 캐시에서 즉시 페인트. (에셋 교체 시 강력 새로고침)
//   - 코드 파일(html/js/css)은 코드 수정이 즉시 반영되도록 no-cache(매번 재검증, 변경 없으면 304).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|woff2?|ttf|otf)$/i.test(filePath)) {
      // 정적 에셋 — 1일 캐시 (한 세션 내 재로드 0). 에셋 교체 시엔 Ctrl+Shift+R 로 강제 새로고침.
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      // html/js/css — 코드 갱신 즉시 반영. 변경 없으면 304(본문 미전송)로 가볍게.
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use(express.json({ limit: '8mb' }));

// ── Supabase(로그인/계정) ──
//   키 미설정 시 supa.enabled()=false → 클라가 게스트 모드로 동작.
const supa = require('./supabase-admin');
const accountData = require('./supabase-data');
const aiLog = require('./supabase-log');
app.get('/api/config', (req, res) => {
  res.json({ supabase: supa.publicConfig() });  // 비활성 시 null
});

// ── 진단용: 현재 서버 프로세스/방 상태를 외부에서 확인 ──
// 같은 방 코드인데 다른 방으로 접속되는 문제를 진단하기 위함.
// 여러 기기에서 http://<서버IP>:3000/debug/rooms 를 열어:
//   - pid 가 기기마다 다르면 → 서버 프로세스가 여러 개 떠 있는 것(근본 원인)
//   - booted 시각이 자꾸 바뀌면 → 서버가 재시작되고 있는 것
const SERVER_BOOT_TS = new Date().toISOString();
app.get('/debug/rooms', (req, res) => {
  const list = Object.keys(rooms).map((id) => {
    const r = rooms[id];
    return {
      id,
      mode: r.mode,
      phase: r.phase,
      players: (r.players || []).map((p, i) => ({
        idx: i,
        name: p && p.name,
        connected: !!(p && p.connected),
        isAI: !!(p && p.isAI),
        hasSession: !!(p && p.sessionToken),
      })),
      spectators: (r.spectators ? r.spectators.length : 0),
    };
  });
  res.json({
    pid: process.pid,
    booted: SERVER_BOOT_TS,
    uptimeSec: Math.round(process.uptime()),
    roomCount: list.length,
    rooms: list,
  });
});

// ── 에셋 매니페스트 — public/ 의 이미지 파일을 자동 스캔해서 반환 ──
// 새 스킬 아이콘·패시브 이미지를 추가할 때 클라이언트 코드를 수정할 필요 없이
// 로딩 오버레이가 자동으로 새 에셋을 프리로드한다.
// art/ 하위 GIF/PNG 는 piece-gifs.js 맵으로 이미 관리되므로 여기서는 루트 PNG/GIF 만 포함.
(function setupAssetManifest() {
  const publicDir = path.join(__dirname, 'public');
  const IMG_EXT = /\.(png|gif|jpg|jpeg|webp|svg)$/i;
  const SKIP_DIRS = new Set(['art']);  // art/ 는 piece-gifs.js 가 관리

  function scanDir(dir, baseUrl) {
    const entries = [];
    try {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (!SKIP_DIRS.has(name)) entries.push(...scanDir(full, baseUrl + name + '/'));
        } else if (IMG_EXT.test(name)) {
          entries.push(baseUrl + name);
        }
      }
    } catch (_) {}
    return entries;
  }

  let _manifest = null;
  app.get('/api/asset-manifest', (req, res) => {
    // 첫 요청 시 한 번 스캔 후 메모리에 캐시
    if (!_manifest) _manifest = scanDir(publicDir, '/');
    res.json({ urls: _manifest });
  });
}());

// ── 커스텀 모드 — 캐릭터 목록 조회 (히든 모드용) ──
app.get('/characters', (req, res) => {
  res.json(CHARACTERS);
});

// 스크린샷 저장 엔드포인트 — 클라이언트가 보낸 dataURL을 screenshots/ 폴더에 저장
const fs = require('fs');
const screenshotDir = path.join(__dirname, 'screenshots');
try { if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true }); } catch (e) {}
app.post('/__save_shot', (req, res) => {
  try {
    const { name, data } = req.body || {};
    if (!name || !data) return res.status(400).json({ ok: false, msg: 'name/data required' });
    const safeName = String(name).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 80);
    const m = String(data).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, msg: 'invalid data URL' });
    const buf = Buffer.from(m[2], 'base64');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = path.join(screenshotDir, `${safeName}.${ext}`);
    fs.writeFileSync(file, buf);
    res.json({ ok: true, path: file });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// ── 캐릭터 데이터 (30 characters across 3 tiers) ────────────────
// ══════════════════════════════════════════════════════════════════

const CHARACTERS = {
  1: [
    { type:'archer', name:'궁수', tier:1, atk:1, icon:'/assets/icons/archer.png', tag:null, desc:'위치한 곳 좌측 대각선 전체 공격',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'공격 범위 반전'}] },
    { type:'spearman', name:'창병', tier:1, atk:1, icon:'/assets/icons/spearman.png', tag:'royal', desc:'위치한 곳 세로줄 전체 공격', skills:[] },
    { type:'cavalry', name:'기마병', tier:1, atk:1, icon:'/assets/icons/cavalry.png', tag:'royal', desc:'위치한 곳 가로줄 전체 공격', skills:[] },
    { type:'watchman', name:'파수꾼', tier:1, atk:0.5, icon:'/assets/icons/watchman.png', tag:null, desc:'주변 8칸 · 자기 제외', skills:[] },
    { type:'twins', name:'쌍둥이 강도', tier:1, atk:1, icon:'/assets/icons/twins.png', tag:'villain', desc:'누나 가로 3칸 / 동생 세로 3칸', isTwin:true,
      skills:[{id:'brothers', name:'분신', cost:2, replacesAction:true, desc:'누나가 동생 위치로, 또는 동생이 누나 위치로 합류'}] },
    { type:'scout', name:'척후병', tier:1, atk:1, icon:'/assets/icons/scout.png', tag:'royal', desc:'자신 포함 가로 3칸',
      skills:[{id:'recon', name:'정찰', cost:2, replacesAction:false, desc:'랜덤 적 1개의 행 또는 열 공개'}] },
    { type:'manhunter', name:'인간 사냥꾼', tier:1, atk:1, icon:'/assets/icons/manhunter.png', tag:'villain', desc:'자신 포함 세로 3칸',
      skills:[{id:'trap', name:'덫 설치', cost:2, replacesAction:true, desc:'현재 위치에 덫 설치 · 작동 시 2 피해'}] },
    { type:'messenger', name:'전령', tier:1, atk:0.5, icon:'/assets/icons/messenger.png', tag:null, desc:'X대각선 5칸 · 자신 포함',
      skills:[{id:'sprint', name:'질주', cost:1, replacesAction:false, oncePerTurn:true, desc:'이번 턴 이동 2회 실행'}] },
    { type:'gunpowder', name:'화약상', tier:1, atk:1, icon:'/assets/icons/gunpowder.png', tag:null, desc:'상하 각2칸 · 자기 제외',
      skills:[
        {id:'bomb', name:'폭탄 설치', cost:2, replacesAction:false, desc:'주변 8칸 중 한 곳에 폭탄 설치'},
        {id:'detonate', name:'기폭', cost:0, replacesAction:false, oncePerTurn:true, desc:'설치된 폭탄 전부 폭발 · 1 피해'}
      ] },
    { type:'herbalist', name:'약초전문가', tier:1, atk:1, icon:'/assets/icons/herbalist.png', tag:null, desc:'좌우 각2칸 · 자기 제외',
      skills:[{id:'herb', name:'약초학', cost:2, replacesAction:false, desc:'자신 제외 주변 모든 아군 체력 1 회복'}] },
  ],
  2: [
    { type:'general', name:'장군', tier:2, atk:2, icon:'/assets/icons/general.png', tag:'royal', desc:'자신 포함 십자 5칸', skills:[] },
    { type:'knight', name:'기사', tier:2, atk:2, icon:'/assets/icons/knight.png', tag:'royal', desc:'자신 포함 X대각선 5칸', skills:[] },
    { type:'shadowAssassin', name:'그림자 암살자', tier:2, atk:2, icon:'/assets/icons/shadowAssassin.png', tag:'villain', desc:'주변 9칸 중 1칸 선택 공격',
      skills:[{id:'shadow', name:'그림자 숨기', cost:1, replacesAction:false, oncePerTurn:true, desc:'다음 턴까지 공격과 상태이상에 면역'}] },
    { type:'wizard', name:'마법사', tier:2, atk:2, icon:'/assets/icons/wizard.png', tag:null, desc:'한칸 건너뛴 십자 4칸',
      skills:[], passives:['instantMagic'] },
    { type:'armoredWarrior', name:'갑주무사', tier:2, atk:2, icon:'/assets/icons/armoredWarrior.png', tag:null, desc:'자신 + 아래 가로3칸 · 총 4칸',
      skills:[], passives:['ironSkin'] },
    { type:'witch', name:'마녀', tier:2, atk:1, icon:'/assets/icons/witch.png', tag:'villain', desc:'전체 보드 중 1칸 선택 공격',
      skills:[{id:'curse', name:'저주', cost:3, replacesAction:true, desc:'적 1명에게 저주 부여'}] },
    { type:'dualBlade', name:'양손 검객', tier:2, atk:2, icon:'/assets/icons/dualBlade.png', tag:null, desc:'좌우 대각선 4칸 · col±1, row±1',
      skills:[{id:'dualStrike', name:'쌍검무', cost:2, replacesAction:false, oncePerTurn:true, desc:'이번 턴 공격 2회 실행'}] },
    { type:'ratMerchant', name:'쥐 장수', tier:2, atk:1, icon:'/assets/icons/ratMerchant.png', tag:'villain', desc:'제자리와 쥐가 소환된 칸 공격',
      skills:[{id:'rats', name:'역병의 자손들', cost:2, replacesAction:false, desc:'쥐가 없는 랜덤 타일 세 곳에 쥐 소환'}] },
    { type:'weaponSmith', name:'무기상', tier:2, atk:2, icon:'/assets/icons/weaponSmith.png', tag:null, desc:'가로 3칸을 공격',
      skills:[{id:'reform', name:'정비', cost:1, replacesAction:false, oncePerTurn:true, desc:'가로 혹은 세로 공격 범위 전환'}] },
    { type:'bodyguard', name:'호위 무사', tier:2, atk:1, icon:'/assets/icons/bodyguard.png', tag:'royal', desc:'십자 4칸 · 자기 제외',
      skills:[], passives:['loyalty'] },
  ],
  3: [
    { type:'prince', name:'왕자', tier:3, atk:3, icon:'/assets/icons/prince.png', tag:'royal', desc:'자신 포함 좌우 3칸', skills:[] },
    { type:'princess', name:'공주', tier:3, atk:3, icon:'/assets/icons/princess.png', tag:'royal', desc:'자신 포함 상하 3칸', skills:[] },
    { type:'king', name:'국왕', tier:3, atk:2, icon:'/assets/icons/king.png', tag:'royal', desc:'자신의 칸',
      skills:[{id:'ring', name:'절대복종 반지', cost:3, replacesAction:false, desc:'적 유닛 하나의 위치 강제 이동'}] },
    { type:'dragonTamer', name:'드래곤 조련사', tier:3, atk:2, icon:'/assets/icons/dragonTamer.png', tag:null, desc:'X대각선 4칸 · 자기 제외',
      skills:[{id:'dragon', name:'드래곤 소환', cost:5, replacesAction:false, oncePerTurn:true, desc:'드래곤 유닛 소환'}] },
    { type:'monk', name:'수도승', tier:3, atk:1, icon:'/assets/icons/monk.png', tag:null, desc:'상하 각1칸 · 자기 제외',
      skills:[{id:'divine', name:'신성', cost:3, replacesAction:false, desc:'자신 제외 아군 한명 체력을 2 회복하고 상태 이상 제거'}],
      passives:['grace'] },
    { type:'slaughterHero', name:'학살 영웅', tier:3, atk:1, icon:'/assets/icons/slaughterHero.png', tag:'villain', desc:'3x3 전체 9칸',
      skills:[], passives:['betrayer'] },
    { type:'commander', name:'지휘관', tier:3, atk:2, icon:'/assets/icons/commander.png', tag:'royal', desc:'좌우 각1칸 · 자기 제외',
      skills:[], passives:['wrath'] },
    { type:'sulfurCauldron', name:'유황이 끓는 솥', tier:3, atk:0.5, icon:'/assets/icons/sulfurCauldron.png', tag:'royal', desc:'주변 8칸 · 자기 제외',
      skills:[{id:'sulfurRiver', name:'유황범람', cost:3, replacesAction:true, desc:'보드 테두리 전체 공격 · 2 피해'}] },
    { type:'torturer', name:'고문 기술자', tier:3, atk:1, icon:'/assets/icons/torturer.png', tag:'villain', desc:'십자 4방향 · 자기 제외 · 총 4칸',
      skills:[{id:'nightmare', name:'악몽', cost:2, replacesAction:false, desc:'표식 상태의 모든 적에게 1 피해'}],
      passives:['markPassive'] },
    { type:'count', name:'백작', tier:3, atk:2, icon:'/assets/icons/count.png', tag:'villain', desc:'X대각선 5칸 · 자신 포함',
      skills:[], passives:['tyranny'] },
  ]
};

const ALL_CHARS = Object.values(CHARACTERS).flat();
const getChar = (type) => ALL_CHARS.find(c => c.type === type);

// ══════════════════════════════════════════════════════════════════
// ── 더미 캐릭터 (미정 — 추후 커스텀 모드 전용) ────────────────────
// ══════════════════════════════════════════════════════════════════
//   ⚠️ 의도적으로 CHARACTERS / ALL_CHARS 에 합치지 않음.
//      → 드래프트·AI 선택·공격범위(getAttackCells)·커스텀 모드 등 어떤 게임 로직도 이 배열을
//         참조하지 않으므로, 현재로선 어디에서도 선택/플레이 불가능(완전 비활성 데이터).
//   📝 채우는 방법: 각 항목의 tier / name / atk / icon / tag / desc / skills / 공격범위(아래 참고)를
//      직접 채운 뒤, 나중에 정식 합류 시 CHARACTERS[tier] 로 옮기거나 커스텀 모드 풀에 연결.
//      - 공격범위: getAttackCells() 의 switch 문에 해당 type case 를 추가해야 실제 공격 패턴이 생김.
//      - 그래픽: 클라(public/piece-gifs.js)의 PIECE_ICONS / PIECE_GIFS 등에 type→경로를 추가.
//      - 스킬: skills:[{ id, name, cost, replacesAction, oncePerTurn?, desc }] 형태.
//      - 패시브: passives:['...'] (선택).
//   현재 값은 전부 임의 placeholder 이며 playable:false 로 명시해 둠.
const DUMMY_CHARACTERS = [
  { type:'dummy1',  name:'더미 1',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy2',  name:'더미 2',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy3',  name:'더미 3',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy4',  name:'더미 4',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy5',  name:'더미 5',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy6',  name:'더미 6',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy7',  name:'더미 7',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy8',  name:'더미 8',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy9',  name:'더미 9',  tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy10', name:'더미 10', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy11', name:'더미 11', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy12', name:'더미 12', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy13', name:'더미 13', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy14', name:'더미 14', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy15', name:'더미 15', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy16', name:'더미 16', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy17', name:'더미 17', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy18', name:'더미 18', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy19', name:'더미 19', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy20', name:'더미 20', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy21', name:'더미 21', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy22', name:'더미 22', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy23', name:'더미 23', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy24', name:'더미 24', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy25', name:'더미 25', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy26', name:'더미 26', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy27', name:'더미 27', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy28', name:'더미 28', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy29', name:'더미 29', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
  { type:'dummy30', name:'더미 30', tier:null, atk:0, icon:'/assets/icons/placeholder.png', tag:null, desc:'(미정)', skills:[], passives:[], placeholder:true, playable:false },
];
// (의도적으로 어디에서도 참조하지 않음 — 정식 합류 전까지 완전 비활성)
void DUMMY_CHARACTERS;

// Helper: find skill data from CHARACTERS definition
function getSkillData(pieceType, skillId) {
  const baseType = pieceType === 'twins_elder' || pieceType === 'twins_younger' ? 'twins' : pieceType;
  const charDef = ALL_CHARS.find(c => c.type === baseType);
  if (!charDef || !charDef.skills) return null;
  return charDef.skills.find(s => s.id === skillId) || null;
}

// ══════════════════════════════════════════════════════════════════
// ── 공격 범위 계산 ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function inBounds(col, row, bounds) {
  return col >= bounds.min && col <= bounds.max && row >= bounds.min && row <= bounds.max;
}

function getAttackCells(type, col, row, bounds, extra) {
  extra = extra || {};
  const b = bounds || { min: 0, max: 4 };
  const cells = [];
  const push = (c, r) => { if (inBounds(c, r, b)) cells.push({ col: c, row: r }); };

  switch (type) {
    // ── TIER 1 ──
    case 'archer': {
      if (extra.toggleState === 'right') {
        const d = col - row;
        for (let c = b.min; c <= b.max; c++) {
          const r = c - d;
          if (r >= b.min && r <= b.max) push(c, r);
        }
      } else {
        const d = col + row;
        for (let c = b.min; c <= b.max; c++) {
          const r = d - c;
          if (r >= b.min && r <= b.max) push(c, r);
        }
      }
      break;
    }
    case 'spearman':
      for (let r = b.min; r <= b.max; r++) push(col, r);
      break;
    case 'cavalry':
      for (let c = b.min; c <= b.max; c++) push(c, row);
      break;
    case 'watchman':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          if (dc !== 0 || dr !== 0) push(col + dc, row + dr);
      break;
    case 'twins_elder':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'twins_younger':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'scout':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'manhunter':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'messenger':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'gunpowder':
      push(col, row - 1); push(col, row - 2);
      push(col, row + 1); push(col, row + 2);
      break;
    case 'herbalist':
      push(col - 1, row); push(col - 2, row);
      push(col + 1, row); push(col + 2, row);
      break;

    // ── TIER 2 ──
    case 'general':
      push(col, row);
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;
    case 'knight':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'shadowAssassin':
      if (extra.tCol !== undefined && extra.tRow !== undefined) {
        // ★ 사용자 보고: 공격 범위가 witch 처럼 맵 전역으로 잘못 동작 → 3x3 가드 강제.
        //   socket.on('attack') 에 이미 가드 있지만 AI processAttack 직접 호출 등 다른 경로 대비.
        if (Math.abs(extra.tCol - col) <= 1 && Math.abs(extra.tRow - row) <= 1) {
          push(extra.tCol, extra.tRow);
        } else {
          push(col, row);   // 범위 밖이면 자기 칸으로 폴백 (안전 — 적 미타격)
        }
      } else {
        push(col, row);
      }
      break;
    case 'wizard':
      push(col, row - 2); push(col, row + 2);
      push(col - 2, row); push(col + 2, row);
      break;
    case 'armoredWarrior':
      push(col, row);
      push(col - 1, row + 1); push(col, row + 1); push(col + 1, row + 1);
      break;
    case 'witch':
      if (extra.tCol !== undefined && extra.tRow !== undefined) {
        push(extra.tCol, extra.tRow);
      }
      break;
    case 'dualBlade':
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'ratMerchant':
      push(col, row);
      if (extra.rats) {
        for (const rat of extra.rats) push(rat.col, rat.row);
      }
      break;
    case 'weaponSmith':
      if (extra.toggleState === 'vertical') {
        push(col, row); push(col, row - 1); push(col, row + 1);
      } else {
        push(col, row); push(col - 1, row); push(col + 1, row);
      }
      break;
    case 'bodyguard':
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;

    // ── TIER 3 ──
    case 'prince':
      push(col, row); push(col - 1, row); push(col + 1, row);
      break;
    case 'princess':
      push(col, row); push(col, row - 1); push(col, row + 1);
      break;
    case 'king':
      push(col, row);
      break;
    case 'dragonTamer':
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
    case 'dragon':
      push(col, row);
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) push(col+dc, row+dr);
      break;
    case 'monk':
      push(col, row - 1);
      push(col, row + 1);
      break;
    case 'slaughterHero':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          push(col + dc, row + dr);
      break;
    case 'commander':
      push(col - 1, row);
      push(col + 1, row);
      break;
    case 'sulfurCauldron':
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++)
          if (dc !== 0 || dr !== 0) push(col + dc, row + dr);
      break;
    case 'torturer':
      // ★ 사용자 밸런스 조정: 자기 셀 제외 — 십자 4방향만 (총 4칸).
      push(col, row - 1);
      push(col, row + 1);
      push(col - 1, row);
      push(col + 1, row);
      break;
    case 'count':
      push(col, row);
      for (const [dc, dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]) push(col+dc, row+dr);
      break;
  }
  return cells;
}

// Get border cells for sulfurCauldron skill
function getBorderCells(bounds) {
  const cells = [];
  for (let c = bounds.min; c <= bounds.max; c++) {
    cells.push({ col: c, row: bounds.min });
    cells.push({ col: c, row: bounds.max });
  }
  for (let r = bounds.min + 1; r < bounds.max; r++) {
    cells.push({ col: bounds.min, row: r });
    cells.push({ col: bounds.max, row: r });
  }
  return cells;
}

function isCrossAdjacent(c1, r1, c2, r2) {
  const dc = Math.abs(c1 - c2), dr = Math.abs(r1 - r2);
  return (dc === 1 && dr === 0) || (dc === 0 && dr === 1);
}

// ══════════════════════════════════════════════════════════════════
// ── 방(Room) 관리 ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const rooms = {};

function createRoom(id, opts = {}) {
  const mode = opts.mode || 'pvp';             // 'pvp' (1v1) | 'team' (2v2)
  const playerCount = mode === 'team' ? 4 : 2;
  return {
    id,
    mode,                                       // NEW
    playerCount,                                // NEW
    players: [],
    phase: 'waiting',      // waiting -> draft -> initial_reveal -> exchange_draft -> final_reveal -> hp_distribution -> placement -> game -> ended
    currentPlayerIdx: 0,
    turnNumber: 0,
    // 인원수에 따라 동적으로 초기화
    draftDone:         Array(playerCount).fill(false),
    hpDone:            Array(playerCount).fill(false),
    initialRevealDone: Array(playerCount).fill(false),
    exchangeDone:      Array(playerCount).fill(false),
    finalRevealDone:   Array(playerCount).fill(false),
    revealDone:        Array(playerCount).fill(false),   // kept for legacy compatibility
    placementDone:     Array(playerCount).fill(false),
    isAI: false,
    // SP system: 1v1은 플레이어당, 팀전은 팀 풀. 인덱스 0/1은 1v1=p0/p1, 팀전=teamA/teamB
    sp: [1, 1],
    instantSp: [0, 0],
    // Board bounds — 팀전은 7×7로 시작
    boardBounds: mode === 'team' ? { min: 0, max: 6 } : { min: 0, max: 4 },
    // 보드 축소 레벨 — LV4=7×7, LV3=5×5, LV2=3×3, LV1=1×1.
    //   1v1 init=LV3 (full 5×5), 팀전 init=LV4 (full 7×7).
    //   매 트리거(turn-based, 1대1교전)마다 -1 까지 감소.
    boardShrinkLevel: mode === 'team' ? 4 : 3,
    boardShrunk: false,
    boardShrinkStage: 0,   // 0=초기, 1=첫 축소, 2=최종 축소
    stalemateShrinkTriggered: false,
    stalemateShrinkTurn: null,
    // Board objects: traps, bombs (per player arrays)
    boardObjects: Array(playerCount).fill(null).map(() => []),
    // Rats per player
    rats: Array(playerCount).fill(null).map(() => []),
    // 유해 (remains) — 사망 시 남는 시체, 양 진영 공유
    remains: [],
    // Teams (팀전 전용, 1v1에서도 편의상 채워둠: teamA=[0], teamB=[1])
    teams: mode === 'team' ? [[], []] : [[0], [1]],
    eliminatedPlayers: new Set(),
    // Spectators
    spectators: [],
    // Timer
    timer: null,
    timerDeadline: null,
    // Chat colors
    chatColors: {},        // socketId -> color
    chatColorPool: ['#f87171','#fb923c','#fbbf24','#4ade80','#60a5fa','#a78bfa'],
    chatColorIdx: 0,
  };
}

// ── 팀/인덱스 헬퍼 ───────────────────────────────────────
function getTeamOf(room, idx) {
  if (room.mode !== 'team') return idx;  // 1v1: 팀=인덱스
  for (let t = 0; t < room.teams.length; t++) {
    if (room.teams[t].includes(idx)) return t;
  }
  return -1;
}
function getTeammates(room, idx) {
  if (room.mode !== 'team') return [];    // 1v1: 팀원 없음
  const t = getTeamOf(room, idx);
  if (t < 0) return [];
  return room.teams[t].filter(i => i !== idx);
}
function getEnemyIndices(room, idx) {
  if (room.mode !== 'team') return [1 - idx];
  const myTeam = getTeamOf(room, idx);
  const enemyTeam = 1 - myTeam;
  return [...(room.teams[enemyTeam] || [])];
}
function getEnemyTeamOf(room, idx) {
  if (room.mode !== 'team') return 1 - idx;
  return 1 - getTeamOf(room, idx);
}
function isTeammate(room, a, b) {
  if (a === b) return false;
  return getTeamOf(room, a) === getTeamOf(room, b);
}
// 두 말이 같은 편(본인 or 같은 팀)인지
function isAlly(room, pieceOwnerIdxA, pieceOwnerIdxB) {
  if (pieceOwnerIdxA === pieceOwnerIdxB) return true;
  return room.mode === 'team' && isTeammate(room, pieceOwnerIdxA, pieceOwnerIdxB);
}
// 본인 + 팀원 인덱스 배열 (아군 맥락)
function getAllyIndices(room, idx) {
  if (room.mode !== 'team') return [idx];
  const t = getTeamOf(room, idx);
  if (t < 0) return [idx];
  return [...room.teams[t]];
}
// 기본 상대 인덱스 (1v1 호환) — 단일 상대가 필요할 때
function getOpponentIdx(room, idx) {
  if (room.mode !== 'team') return 1 - idx;
  const enemies = getEnemyIndices(room, idx);
  return enemies[0];   // 팀모드에서 단일 상대 의미가 모호하니 사용처에서 주의
}
// SP/상태 배열 인덱스 — 1v1에서는 playerIdx, 팀전에서는 teamId
function teamSlotIdx(room, idx) {
  return room.mode === 'team' ? getTeamOf(room, idx) : idx;
}
// 탈락자(전멸/이탈/기권)인지
function isPlayerEliminated(room, idx) {
  if (room.eliminatedPlayers && room.eliminatedPlayers.has(idx)) return true;
  const p = room.players[idx];
  if (!p || !p.pieces) return false;
  return p.pieces.every(piece => !piece.alive);
}
// 팀 전멸 여부
function isTeamEliminated(room, teamId) {
  if (room.mode !== 'team') return false;
  const team = room.teams[teamId] || [];
  return team.every(idx => isPlayerEliminated(room, idx));
}
// 다음 턴 플레이어 계산
// 1v1: 단순 토글
// 팀전: 위치 기반 4-슬롯 순환 — 화면 분할 좌표 기준
//   pos 1 (좌상, slot 0): teamId=0, slotPos=0
//   pos 2 (우상, slot 1): teamId=1, slotPos=0
//   pos 3 (좌하, slot 2): teamId=0, slotPos=1
//   pos 4 (우하, slot 3): teamId=1, slotPos=1
// 정방향(1→2→3→4→1)으로 순환. 선이 누구든 wrap-around 로 진행.
// 슬롯의 본래 주인이 탈락하면 "같은 팀의 살아남은 멤버"가 그 슬롯의 차례를 대신 수행.
//   예: pos 2 탈락 시 [1, 4, 3, 4] (pos 4 가 자기 슬롯과 pos 2 슬롯을 모두 진행)
//   예: pos 1·2 탈락 시 [3, 4, 3, 4]
const TEAM_SLOT_KEYS = [
  [0, 0],  // slot 0 = pos 1
  [1, 0],  // slot 1 = pos 2
  [0, 1],  // slot 2 = pos 3
  [1, 1],  // slot 3 = pos 4
];

function getSlotIdxOfPlayer(player, room) {
  if (!player) return 0;
  const teamId = player.teamId ?? 0;
  // 팀 멤버 순서로 위치 결정 — slotPos 데이터에 의존하지 않음
  let posInTeam = 0;
  if (room && Array.isArray(room.teams?.[teamId])) {
    const teamArr = room.teams[teamId];
    posInTeam = teamArr.indexOf(player.index);
    if (posInTeam < 0) posInTeam = 0;
  } else {
    posInTeam = player.slotPos ?? 0;  // fallback
  }
  return posInTeam * 2 + teamId;
}

function buildTeamTurnOrder(room) {
  // slotPos 데이터에 의존하지 않음 — room.teams 배열의 멤버 순서를 슬롯 순서로 사용
  // pos 1 = blue[0], pos 2 = red[0], pos 3 = blue[1], pos 4 = red[1]
  const blue = (room.teams[0] || []).slice();
  const red  = (room.teams[1] || []).slice();
  const slotOwners = [blue[0], red[0], blue[1], red[1]];
  const order = [];
  for (let slotIdx = 0; slotIdx < slotOwners.length; slotIdx++) {
    let idx = slotOwners[slotIdx];
    if (idx == null) { order.push(-1); continue; }
    if (isPlayerEliminated(room, idx)) {
      // 본 슬롯 주인이 탈락 → 같은 팀의 살아있는 멤버로 대체
      const teamArr = (slotIdx === 0 || slotIdx === 2) ? blue : red;
      const survivor = teamArr.find(j => !isPlayerEliminated(room, j));
      if (survivor != null) idx = survivor;
      else { order.push(-1); continue; }
    }
    order.push(idx);
  }
  return order;
}

function getNextPlayerIdx(room) {
  if (room.mode !== 'team') return 1 - room.currentPlayerIdx;
  if (typeof room.turnSlotIdx !== 'number') {
    // 보호: turnSlotIdx 가 초기화 안된 상황 → currentPlayerIdx 의 슬롯에서 시작
    const cur = room.players[room.currentPlayerIdx];
    room.turnSlotIdx = getSlotIdxOfPlayer(cur, room);
  }
  // 정방향으로 다음 슬롯 (4슬롯 고정 순환)
  for (let offset = 1; offset <= TEAM_SLOT_KEYS.length; offset++) {
    const nextSlot = (room.turnSlotIdx + offset) % TEAM_SLOT_KEYS.length;
    const order = buildTeamTurnOrder(room);
    const candidate = order[nextSlot];
    if (candidate >= 0 && !isPlayerEliminated(room, candidate)) {
      room.turnSlotIdx = nextSlot;
      return candidate;
    }
  }
  // ★ 유효한 다음 플레이어를 못 찾은 경우 — 모든 팀이 전멸 또는 동시 탈락 직전.
  //   -1 을 반환해 endTurn 호출 측에서 즉시 게임 종료 처리를 트리거.
  return -1;
}
// 팀전 대기실 상태 방송
function broadcastTeamRoomState(room) {
  if (!room || room.mode !== 'team') return;
  const payload = {
    roomId: room.id,
    players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId, slotPos: p.slotPos ?? 0, isAI: p.socketId === 'AI' })),
    teams: room.teams,
    count: room.players.length,
  };
  // 각 플레이어에게 자신의 idx도 포함해서 전송
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_room_state', { ...payload, myIdx: p.index });
  }
}

// 이전 턴 플레이어 (오류 메시지/로그용)
// turnSlotIdx 기반 — 현재 슬롯의 직전 슬롯의 주인
function getPrevPlayerIdx(room, curIdx) {
  if (room.mode !== 'team') return 1 - curIdx;
  if (typeof room.turnSlotIdx !== 'number') return curIdx;
  const order = buildTeamTurnOrder(room);
  for (let offset = 1; offset <= TEAM_SLOT_KEYS.length; offset++) {
    const prevSlot = (room.turnSlotIdx - offset + TEAM_SLOT_KEYS.length) % TEAM_SLOT_KEYS.length;
    const candidate = order[prevSlot];
    if (candidate >= 0) return candidate;
  }
  return curIdx;
}

function assignChatColor(room, socketId) {
  if (room.chatColors[socketId]) return room.chatColors[socketId];
  const pool = room.chatColorPool;
  const color = pool[room.chatColorIdx % pool.length];
  room.chatColorIdx++;
  room.chatColors[socketId] = color;
  return color;
}

// ── 타이머 시스템 ─────────────────────────────────────
const TIMER_SECONDS = 90;
const DRAFT_TIMER_SECONDS = 150;

function startTimer(room, phase, callback) {
  clearTimer(room);
  // 팀전 드래프트는 150초, 교환 드래프트는 60초, 그 외 팀 페이즈는 90초
  const longPhases = new Set(['draft', 'team_draft']);
  let sec;
  if (longPhases.has(phase)) sec = DRAFT_TIMER_SECONDS;
  else if (phase === 'exchange_draft') sec = 60;
  else sec = TIMER_SECONDS;
  room.timerDeadline = Date.now() + sec * 1000;
  emitToBothAndSpectators(room, 'timer_start', { seconds: sec, phase });
  room.timer = setTimeout(() => {
    room.timer = null;
    room.timerDeadline = null;
    if (room.phase !== 'ended') callback();
  }, sec * 1000);
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.timerDeadline = null;
  // ※ _aiThinkTimer 는 여기서 정리 안 함 — startTimer 가 내부에서 clearTimer 를 호출하기 때문에,
  //   transitionToExchangeDraft 처럼 [_aiThinkTimer 설정 → startTimer(60s 안전망) 설정] 순서일 때
  //   safety timer 가 AI 사고 타이머를 즉시 wipe 해버림. 게임 종료 경로에서 별도 호출(clearAiThinkState).
}

// 교환 페이즈 남은 시간 계산 — 페이즈 시작 시각 기준 공유 카운트다운.
//   누가 먼저 끝내든 "그 시점의 남은 시간" 으로 카운트다운 표시 (60초 풀타임 X).
function exchangeRemainingMs(room) {
  if (!room || !room._exchangeStart) return 60000;
  const max = room._exchangeMaxMs || 60000;
  return Math.max(500, max - (Date.now() - room._exchangeStart));
}

// AI 사고 타이머/메타데이터 명시적 정리 — endGame/endTeamGame/disconnect 등 stale fire 방지가 필요한 곳에서만 호출.
function clearAiThinkState(room) {
  if (!room) return;
  if (room._aiThinkTimer) {
    clearTimeout(room._aiThinkTimer);
    room._aiThinkTimer = null;
  }
  delete room._aiThinkStart;
  delete room._aiThinkMs;
}

function emitToBothAndSpectators(room, event, data) {
  for (const p of room.players) {
    if (p.socketId && p.socketId !== 'AI') io.to(p.socketId).emit(event, data);
  }
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

// ── 타이머 타임아웃 핸들러 ──────────────────────────────────

// 드래프트 타임아웃: 미선택 플레이어 랜덤 픽
function draftTimeout(room) {
  if (room.phase !== 'draft') return;
  for (let i = 0; i < 2; i++) {
    if (!room.draftDone[i] && room.players[i].socketId !== 'AI') {
      const browse = room.players[i]._browseDraft || {};
      const had1 = browse[1] || null;
      const had2 = browse[2] || null;
      const had3 = browse[3] || null;
      const t1 = had1 || randomPick(CHARACTERS[1]).type;
      const t2 = had2 || randomPick(CHARACTERS[2]).type;
      const t3 = had3 || randomPick(CHARACTERS[3]).type;
      room.players[i].draft = { t1, t2, t3 };
      room.draftDone[i] = true;
      const sock = io.sockets.sockets.get(room.players[i].socketId);
      if (sock) {
        const allFilled = had1 && had2 && had3;
        const timeoutMsg = allFilled ? '자동 확정' : '랜덤 선택';
        sock.emit('draft_ok', { t1, t2, t3, timeout: true, timeoutMsg });
      }
    }
  }
  if (room.draftDone.every(d => d)) {
    transitionToInitialReveal(room);
  }
}

// HP 분배 타임아웃: 미완료 플레이어 랜덤 HP
function hpTimeout(room) {
  if (room.phase !== 'hp_distribution') return;
  for (let i = 0; i < 2; i++) {
    if (!room.hpDone[i] && room.players[i].socketId !== 'AI') {
      const player = room.players[i];
      const hasTwins = player.draft.t1 === 'twins';
      // 랜덤 HP 분배 (합계 10, 각 최소 1, 최대 8)
      let hps;
      if (hasTwins) {
        hps = randomHpSplit(3, 10, 2); // twins tier min 2
      } else {
        hps = randomHpSplit(3, 10, 1);
      }
      player.hpDist = hps;
      const d = player.draft;
      if (hasTwins) {
        // 쌍둥이 자동 분배
        const twinHp = hps[0];
        const elder = Math.max(1, Math.floor(Math.random() * (twinHp - 1)) + 1);
        const younger = twinHp - elder;
        player.pieces = [
          createPiece('twins', 1, elder, { subUnit: 'elder', parentType: 'twins' }),
          createPiece('twins', 1, younger, { subUnit: 'younger', parentType: 'twins' }),
          createPiece(d.t2, 2, hps[1]),
          createPiece(d.t3, 3, hps[2]),
        ];
        player.pieces[0].type = 'twins_elder';
        player.pieces[1].type = 'twins_younger';
        player.twinSplitDone = true;
      } else {
        player.pieces = [
          createPiece(d.t1, 1, hps[0]),
          createPiece(d.t2, 2, hps[1]),
          createPiece(d.t3, 3, hps[2]),
        ];
      }
      room.hpDone[i] = true;
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('hp_ok', { hps, timeout: true });
    }
  }
  if (room.hpDone.every(d => d)) {
    transitionToPlacement(room);
  }
}

// 랜덤 HP 분배 헬퍼
function randomHpSplit(count, total, minVal) {
  const arr = new Array(count).fill(minVal);
  let remaining = total - count * minVal;
  while (remaining > 0) {
    const idx = Math.floor(Math.random() * count);
    if (arr[idx] < 8) { arr[idx]++; remaining--; }
  }
  return arr;
}

// 배치 타임아웃: 미배치 말 랜덤 배치
function placementTimeout(room) {
  if (room.phase !== 'placement') return;
  for (let i = 0; i < 2; i++) {
    if (!room.placementDone[i] && room.players[i].socketId !== 'AI') {
      const player = room.players[i];
      const bounds = room.boardBounds;
      // 미배치 말들 랜덤 배치
      const allPos = [];
      for (let r = bounds.min; r <= bounds.max; r++)
        for (let c = bounds.min; c <= bounds.max; c++)
          allPos.push({ col: c, row: r });
      for (const piece of player.pieces) {
        if (piece.col < 0) {
          const used = player.pieces.filter(p => p.col >= 0 && !p.subUnit).map(p => `${p.col},${p.row}`);
          const available = allPos.filter(p => !used.includes(`${p.col},${p.row}`));
          if (available.length > 0) {
            const pos = randomPick(available);
            piece.col = pos.col;
            piece.row = pos.row;
          }
        }
      }
      room.placementDone[i] = true;
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('placement_timeout', {});
    }
  }
  if (room.placementDone.every(d => d)) {
    startGameFromRoom(room);
  }
}

// 턴 타임아웃: 현재 턴 강제 종료
function turnTimeout(room) {
  if (room.phase !== 'game') return;
  // ★ 폭발 체인/표식 페이즈 처리 중 타이머 만료 → 짧은 지연 후 재시도 (chain이 끝나야 endTurn 가능)
  if (room._phaseDeferredGameEndCheck) {
    room._turnTimeoutRetries = (room._turnTimeoutRetries || 0) + 1;
    if (room._turnTimeoutRetries >= 20) {
      // 최대 재시도 초과 (10초) — 플래그 강제 해제 후 진행
      room._phaseDeferredGameEndCheck = false;
      room._turnTimeoutRetries = 0;
    } else {
      setTimeout(() => turnTimeout(room), 500);
      return;
    }
  } else {
    room._turnTimeoutRetries = 0;
  }
  const idx = room.currentPlayerIdx;
  if (room.players[idx].socketId === 'AI') {
    // AI 턴 안전 워치독: 15초 후에도 턴이 안 넘어갔으면 강제 종료
    if (!room._aiWatchdog) {
      room._aiWatchdog = setTimeout(() => {
        room._aiWatchdog = null;
        if (!rooms[room.id] || room.phase !== 'game') return;
        if (room.currentPlayerIdx === idx) {
          endTurn(room, { timeout: true });
        }
      }, 15000);
    }
    return;
  }
  emitToBothAndSpectators(room, 'turn_timeout', { playerIdx: idx });
  // ★ timeout 플래그 — endTurn 이 "턴 강제 종료" vs "턴 스킵" 분기에 사용
  endTurn(room, { timeout: true });
}

// ── 페이즈 전환 헬퍼 (타이머 연동) ─────────────────────────

// ══════════════════════════════════════════════════════════════════
// ── 팀전 (2v2) 페이즈 전환 ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function transitionToTeamDraft(room) {
  clearTimer(room);
  room.phase = 'team_draft';
  // 팀전 드래프트 — 2픽 (티어 무관)
  for (const p of room.players) {
    p.draft = { pick1: null, pick2: null };
  }
  room.draftDone = Array(room.playerCount).fill(false);
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_draft_start', {
      myIdx: p.index,
      teamId: p.teamId,
      players: room.players.map(pl => ({ name: pl.name, idx: pl.index, teamId: pl.teamId })),
      teams: room.teams,
      characters: CHARACTERS,
    });
  }
  startTimer(room, 'team_draft', () => teamDraftTimeout(room));
  // AI 봇 자동 픽 (각 봇마다 1.5초 ~ 3.5초 사이 무작위 지연)
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 1500 + Math.random() * 2000;
      setTimeout(() => aiTeamDraftPick(room, p.index), delay);
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ── 팀전 AI 자동 행동 ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// AI 드래프트 — 팀원과 안 겹치는 캐릭터 2개 무작위 픽
function aiTeamDraftPick(room, idx) {
  if (!room || room.phase !== 'team_draft') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.draftDone[idx]) return;
  const teammates = getTeammates(room, idx);
  const forbidden = new Set();
  for (const tIdx of teammates) {
    const tmDraft = room.players[tIdx]?.draft || {};
    if (tmDraft.pick1) forbidden.add(tmDraft.pick1);
    if (tmDraft.pick2) forbidden.add(tmDraft.pick2);
  }
  // 모든 티어에서 후보 — 다양한 티어가 섞이도록
  const allTypes = ALL_CHARS.map(c => c.type).filter(t => !forbidden.has(t));
  const shuffled = allTypes.slice().sort(() => Math.random() - 0.5);
  const pick1 = shuffled[0];
  const pick2 = shuffled.find(t => t !== pick1);
  if (!pick1 || !pick2) return;
  p.draft = { pick1, pick2 };
  // 팀원에게 진행 상황 브로드캐스트
  const teamMembers = room.teams[p.teamId] || [];
  const teamDrafts = teamMembers.map(i => ({
    idx: i,
    name: room.players[i]?.name,
    draft: { pick1: room.players[i]?.draft?.pick1 || null, pick2: room.players[i]?.draft?.pick2 || null },
    confirmed: !!room.draftDone[i],
  }));
  for (const tIdx of teamMembers) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_draft_pick_update', { playerIdx: idx, slot: 'pick2', type: pick2, teamDrafts });
    }
  }
  // 확정
  room.draftDone[idx] = true;
  io.to(room.id).emit('team_draft_status', {
    draftDone: [...room.draftDone],
    doneNames: room.players.filter((_, i) => room.draftDone[i]).map(p2 => p2.name),
  });
  // 모두 확정되면 다음 페이즈로
  if (room.draftDone.every(d => d)) {
    transitionToTeamHp(room);
  }
}

// AI HP 분배 — 5/5 기본, 쌍둥이 있으면 그쪽 6/4
function aiTeamHpDistribute(room, idx) {
  if (!room || room.phase !== 'team_hp') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.hpDone[idx]) return;
  const draft = p.draft || {};
  const t1Twin = draft.pick1 === 'twins';
  const t2Twin = draft.pick2 === 'twins';
  let hps = [5, 5];
  if (t1Twin) hps = [6, 4];
  else if (t2Twin) hps = [4, 6];
  p.hpDist = { pick1: hps[0], pick2: hps[1] };
  // 쌍둥이 분할
  if (t1Twin || t2Twin) {
    const twinHp = t1Twin ? hps[0] : hps[1];
    const elder = Math.ceil(twinHp / 2);
    const younger = twinHp - elder;
    p.hpDist.twinElder = elder;
    p.hpDist.twinYounger = younger;
  }
  // 실제 pieces 생성 (이게 누락되면 alive=0으로 게임 시작됨)
  p.pieces = buildTeamPieces(p.draft, p.hpDist);
  // 팀원 HP 패널이 실시간 갱신되도록 — 팀 멤버에게 team_hp_browse 전송
  const teammates = getTeammates(room, idx);
  for (const tIdx of teammates) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_hp_browse', {
        playerIdx: idx,
        hps: [hps[0], hps[1]],
      });
    }
  }
  room.hpDone[idx] = true;
  io.to(room.id).emit('team_hp_status', {
    hpDone: [...room.hpDone],
    doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p2 => p2.name),
  });
  if (room.hpDone.every(d => d)) {
    transitionToTeamReveal(room);
  }
}

// ══════════════════════════════════════════════════════════════════
// ── AI 휴리스틱 가중치 (튜닝 대상 / 셀프플레이 학습) ───────────────────
//   기본값 = 기존 손튜닝 상수 → 변경 없이 동작 동일.
//   ai-weights.json 있으면 머지(라이브 챔피언 로드). 셀프플레이는 brain._weights 로 per-side override.
//   1v1(aiScoreMove)·팀전(aiTeamScoreMove) 둘 다 같은 키 사용 → 튜닝이 라이브 1v1 에도 전이.
// ══════════════════════════════════════════════════════════════════
const AI_WEIGHTS_DEFAULT = {
  commanderAdj: 6,       // 사기증진 인접 시 보너스
  shrinkAvoid: 25,       // 보드축소 영역 밖 진입 페널티 (×urgency)
  escapeOutside: 30,     // (팀) 외곽→안쪽 탈출 보너스 (×urgency)
  edgePenaltyMul: 0.5,   // 후반(턴≥25) 가장자리 점수 배율
  centerReturn: 5,       // (팀) 가장자리→중앙 회귀 보너스
  fleeBonus: 25,         // 피격기억 도주 보너스 (×HP항; 팀 버전은 ×(3-hp))
  approachMul: 2.5,      // 적 확률질량 추격 유도
  threatMul: 1.0,        // 위협 회피 감점 배율
  infoGainMul: 0.4,      // 정보획득(정찰) 가산
  commanderAuraMul: 3,   // 지휘관 본인 오라 진형 유지
};
let AI_WEIGHTS = { ...AI_WEIGHTS_DEFAULT };
try {
  const _wf = require('path').join(__dirname, 'ai-weights.json');
  if (require('fs').existsSync(_wf)) {
    AI_WEIGHTS = { ...AI_WEIGHTS_DEFAULT, ...JSON.parse(require('fs').readFileSync(_wf, 'utf8')) };
    console.log('[AI] ai-weights.json 로드됨 (학습된 챔피언 가중치 적용)');
  }
} catch (e) { console.warn('[AI] ai-weights.json 로드 실패 — 기본값 사용:', e.message); }
// 점수 함수에서: const W = (brain && brain._weights) || AI_WEIGHTS;

// AI 배치 — 전략적 배치 (적팀 공격범위 회피 + 시너지 형성)
// 자동 배치 후에도 다른 플레이어 배치가 갱신되면 재평가 (확정 X — 보드 위 배치만)
// ── 배치 점수 공유 헬퍼 (1v1 aiPlacePieces 와 팀전 aiTeamPlace 가 동일 로직 사용) ──
//   사용자 요청: "1v1 AI 와 팀전 AI 가 정확히 똑같이 동작". 배치도 동일 점수식으로 통일.
function aiIsAggressivePiece(pc) { return ['archer','spearman','cavalry','knight','general','dualBlade','prince','princess','slaughterHero','shadowAssassin','torturer','dragonTamer'].includes(pc.type); }
function aiIsSupportPiece(pc) { return ['herbalist','monk','watchman','scout','commander','wizard','ratMerchant','bodyguard','king'].includes(pc.type); }
function aiIsFragilePiece(pc) { return pc.maxHp <= 2 || ['watchman','messenger','sulfurCauldron','herbalist','monk'].includes(pc.type); }
function aiIsHealerPiece(pc) { return pc.type === 'herbalist' || pc.type === 'monk'; }

// 배치 후보 셀 점수. ctx: { room, bounds, occupied(Set), enemyAttackCells(Set),
//   futureShrinkBounds(array), teamId, friendlyIdxs(시너지 대상=자기+팀원),
//   teammateIdxs(밀집 회피 대상) }
function aiPlacementCellScore(piece, c, r, ctx) {
  const { room, bounds, occupied, enemyAttackCells, futureShrinkBounds, teamId, friendlyIdxs, teammateIdxs } = ctx;
  if (occupied.has(`${c},${r}`)) return -Infinity;
  if (r < bounds.min || r > bounds.max || c < bounds.min || c > bounds.max) return -Infinity;
  let score = 0;
  // 1. 적 공격범위 안이면 페널티 (공격형 약, 약한 유닛 강)
  if (enemyAttackCells.has(`${c},${r}`)) {
    if (aiIsFragilePiece(piece)) score -= 25;
    else if (aiIsAggressivePiece(piece)) score -= 5;
    else score -= 12;
  }
  // 2. 역할별 행 선호
  const dRow = teamId === 0 ? r - bounds.min : bounds.max - r;
  if (aiIsAggressivePiece(piece)) score += dRow * 6;
  else if (aiIsSupportPiece(piece) || aiIsFragilePiece(piece)) score += (2 - Math.min(2, dRow)) * 8;
  else score += dRow === 1 ? 5 : 2;
  // 3. 가장자리 + 보드 축소 회피
  if (c === bounds.min || c === bounds.max) score -= 6;
  if (r === bounds.min || r === bounds.max) score -= 4;
  for (let sIdx = 0; sIdx < futureShrinkBounds.length; sIdx++) {
    const sB = futureShrinkBounds[sIdx];
    if (c < sB.min || c > sB.max || r < sB.min || r > sB.max) score -= sIdx === 0 ? 40 : 15;
  }
  const centerC = (bounds.min + bounds.max) / 2;
  const centerR = (bounds.min + bounds.max) / 2;
  score -= (Math.abs(c - centerC) + Math.abs(r - centerR)) * 0.8;
  // 4. 밀집 회피 (AoE/덫에 휘말리지 않게) — 호위무사 예외
  if (piece.type !== 'bodyguard') {
    for (const tIdx of teammateIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (!tpc.alive || tpc.col < 0 || tpc === piece) continue;
        if (Math.abs(tpc.col - c) + Math.abs(tpc.row - r) === 1) score -= 6;
      }
    }
  }
  // 5. commander 사기증진 시너지
  if (piece.type !== 'commander') {
    for (const tIdx of friendlyIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (tpc.type === 'commander' && tpc.col >= 0 &&
            Math.abs(tpc.col - c) + Math.abs(tpc.row - r) === 1) score += 10;
      }
    }
  } else {
    let adjCount = 0;
    for (const tIdx of friendlyIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (tpc.type === 'commander' || !tpc.alive || tpc.col < 0) continue;
        if (Math.abs(tpc.col - c) + Math.abs(tpc.row - r) === 1) adjCount++;
      }
    }
    score += adjCount * 6;
  }
  // 6. 약한/royal — 호위무사 인접 보너스
  if (aiIsFragilePiece(piece) || piece.tag === 'royal') {
    for (const tIdx of friendlyIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (tpc.type === 'bodyguard' && tpc.col >= 0) {
          const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
          if (dist === 1) score += 8; else if (dist === 2) score += 3;
        }
      }
    }
  }
  // 6b. 호위무사 본인 — royal/fragile 가까이
  if (piece.type === 'bodyguard') {
    for (const tIdx of friendlyIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (!tpc.alive || tpc.col < 0 || tpc === piece) continue;
        if (tpc.tag === 'royal' || aiIsFragilePiece(tpc)) {
          const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
          if (dist === 1) score += 10; else if (dist === 2) score += 4;
        }
      }
    }
  }
  // 7. 힐러 coverage
  if (aiIsHealerPiece(piece)) {
    let coverage = 0;
    for (const tIdx of friendlyIdxs) {
      const tp = room.players[tIdx]; if (!tp) continue;
      for (const tpc of (tp.pieces || [])) {
        if (!tpc.alive || tpc.col < 0 || tpc === piece) continue;
        const dist = Math.abs(tpc.col - c) + Math.abs(tpc.row - r);
        if (piece.type === 'herbalist' && dist <= 2) coverage++;
        else if (piece.type === 'monk' && dist === 1) coverage++;
      }
    }
    score += coverage * 4;
  }
  // 8. 공격형 — 자기 공격범위가 중앙 3x3 커버
  if (aiIsAggressivePiece(piece)) {
    try {
      const attackCells = getAttackCells(piece.type, c, r, bounds, { toggleState: piece.toggleState });
      let coverCenter = 0;
      for (const ac of attackCells) {
        if (!inBounds(ac.col, ac.row, bounds)) continue;
        if (Math.abs(ac.col - centerC) <= 1 && Math.abs(ac.row - centerR) <= 1) coverCenter++;
      }
      score += coverCenter * 1.2;
    } catch (e) {}
  }
  // 9. 동점 미세 분산
  score += Math.random() * 2;
  return score;
}

function aiTeamPlace(room, idx) {
  if (!room || room.phase !== 'team_placement') return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI' || room.placementDone[idx]) return;
  const bounds = room.boardBounds || { min: 0, max: 6 };
  const teamId = p.teamId;
  const enemyIdxs = getEnemyIndices(room, idx);
  const teammates = getTeammates(room, idx);
  // 자기 팀 진영 (블루: 위 0~2, 레드: 아래 4~6)
  const zoneRows = teamId === 0
    ? [bounds.min, bounds.min + 1, bounds.min + 2]
    : [bounds.max, bounds.max - 1, bounds.max - 2];

  // 점유된 칸
  const occupied = new Set();
  for (const tIdx of [idx, ...teammates]) {
    const tp = room.players[tIdx];
    if (!tp) continue;
    for (const pc of (tp.pieces || [])) {
      if (pc.col >= 0 && pc.row >= 0) occupied.add(`${pc.col},${pc.row}`);
    }
  }

  // 적팀 배치된 piece들의 공격 셀 합집합 — 회피 후보
  const enemyAttackCells = new Set();
  for (const ei of enemyIdxs) {
    const ep = room.players[ei];
    if (!ep) continue;
    for (const epc of (ep.pieces || [])) {
      if (epc.col < 0 || epc.row < 0) continue;
      const cells = getAttackCells(epc.type, epc.col, epc.row, bounds, { toggleState: epc.toggleState });
      for (const c of cells) enemyAttackCells.add(`${c.col},${c.row}`);
    }
  }

  const isAggressive = aiIsAggressivePiece;
  const isSupport = aiIsSupportPiece;
  const isFragile = aiIsFragilePiece;

  // ★ 사용자 보고 (외곽 위주 배치): 보드 축소 일정을 배치 단계에서 인식하여, 곧 사라질 외곽 셀에
  //   강한 페널티 부여 → 처음부터 중앙 쪽에 모이도록 강제.
  //   팀모드: bounds 0~6 (7x7). 첫 축소 후 5x5 (1~5), 두번째 4x4 (1.5~4.5? 실제 _levelToBounds 사용).
  const shrinkSchedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  const futureShrinkBounds = [];
  for (const ev of shrinkSchedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const _bs = room.mode === 'team' ? 7 : 5;
    const _nl = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
    const evBounds = ev.newBounds || (typeof _levelToBounds === 'function' ? _levelToBounds(_nl, _bs) : null);
    if (evBounds) futureShrinkBounds.push(evBounds);
  }

  // 셀 점수 — 공유 헬퍼 aiPlacementCellScore 사용 (1v1 과 동일 로직).
  const placeCtx = {
    room, bounds, occupied, enemyAttackCells, futureShrinkBounds, teamId,
    friendlyIdxs: [...teammates, idx],   // 시너지 대상 = 자기 + 팀원
    teammateIdxs: teammates,             // 밀집 회피 대상 = 팀원
  };
  const scoreCell = (piece, c, r) => aiPlacementCellScore(piece, c, r, placeCtx);

  // 각 piece 별로 진영 내 모든 셀 점수 계산 후 최고점에 배치
  // piece 처리 순서: 공격형 먼저 (앞 행 선점), 지원/약한 유닛 나중 (남은 자리에 안전 배치)
  const piecesOrdered = p.pieces
    .map((pc, pi) => ({ pc, pi }))
    .filter(o => o.pc.col < 0)
    .sort((a, b) => {
      const aPri = isAggressive(a.pc) ? 0 : (isSupport(a.pc) || isFragile(a.pc) ? 2 : 1);
      const bPri = isAggressive(b.pc) ? 0 : (isSupport(b.pc) || isFragile(b.pc) ? 2 : 1);
      return aPri - bPri;
    });

  for (const { pc: piece, pi } of piecesOrdered) {
    if (piece.col >= 0) continue;
    let best = { col: -1, row: -1, score: -Infinity };
    // 자기 진영 내 모든 셀 평가
    for (const r of zoneRows) {
      for (let c = bounds.min; c <= bounds.max; c++) {
        const s = scoreCell(piece, c, r);
        if (s > best.score) best = { col: c, row: r, score: s };
      }
    }
    if (best.col >= 0) {
      piece.col = best.col;
      piece.row = best.row;
      occupied.add(`${best.col},${best.row}`);
    }
  }
  // 모든 piece 배치되면 — 즉시 확정 X. 다른 플레이어 배치 보고 한 번만 재평가하도록 placementDone은 늦게 셋
  // 단, 모든 휴먼 + 다른 봇이 확정한 상태면 자기도 확정해야 게임이 진행됨
  // → 배치 자체는 완료 표시하고, 일부 휴먼이 아직 배치 중이면 그들이 변경할 때마다 우리 placement도 재평가 가능
  // 현재 구현: 즉시 확정 (이전 동작 유지) — 추후 reactive 재평가는 별도 hook
  if (p.pieces.every(pc => pc.col >= 0)) {
    room.placementDone[idx] = true;
    // 팀 내부에 즉시 보이도록 broadcastTeamPlacementUpdate
    if (typeof broadcastTeamPlacementUpdate === 'function') broadcastTeamPlacementUpdate(room, idx);
    io.to(room.id).emit('team_placement_status', {
      placementDone: [...room.placementDone],
      doneNames: room.players.filter((_, i) => room.placementDone[i]).map(p2 => p2.name),
    });
    if (room.placementDone.every(d => d)) {
      startTeamGameFromRoom(room);
    }
  }
}

// ── 팀전 AI 점수 헬퍼 (1v1 aiScoreAttack/aiScoreMove의 팀모드 적응판) ──
// probMap 대신 실제 적 위치 + 가중치(HP, tier, 스킬 보유) 기반 점수
// ── 팀전 AI 브레인 — 팀별 확률맵(fog-of-war 존중). 1v1 room.aiBrain 과 완전히 동일한 구조·학습. ──
//   사용자 요청: "팀전 AI 를 1대1 AI 와 정확히 똑같이 동작시키고, 실제 플레이어와 같은 정보만 보게 하라."
//   이전 구현(aiTeamCellThreatScore 전수조사)은 적의 실제 위치를 fog 무시하고 들여다보는 치트였고,
//   추격 로직이 없어 정보 우위도 전혀 못 살렸다. 이제 1v1 과 동일하게 "추론된 확률맵"만 보고 싸운다.
function getTeamBrain(room, teamId) {
  if (!room.aiTeamBrains) room.aiTeamBrains = {};
  if (!room.aiTeamBrains[teamId]) {
    const size = room.boardBounds ? room.boardBounds.max + 1 : 7;
    room.aiTeamBrains[teamId] = initAiBrain(size);
  }
  return room.aiTeamBrains[teamId];
}

// 팀 학습 훅 — 공격 1건이 처리될 때마다 호출(인간/AI 공격 공통).
//   공격자 팀이 AI → 내 hit/miss 로 적 확률맵 갱신(aiProcessAttackResult).
//   피격당한 적 팀이 AI → 공격자(상대 팀) 위치를 역추론(aiObserveEnemyAttack).
//   → 정보가 끝없이 누적·정제됨 (사용자 요청: "끝없이 플레이 정보를 스택킹해서 발전").
function aiTeamLearnFromAttack(room, attackerIdx, atkCells, hitResults) {
  if (room.mode !== 'team') return;
  const playersOfTeam = (tid) => room.players.filter(pl => pl && pl.teamId === tid);
  const teamHasAI = (tid) => playersOfTeam(tid).some(pl => pl.socketId === 'AI');
  const teamPieces = (tid) => playersOfTeam(tid).flatMap(pl => pl.pieces || []);
  const atkTeam = getTeamOf(room, attackerIdx);
  if (teamHasAI(atkTeam)) {
    aiProcessAttackResult(getTeamBrain(room, atkTeam), atkCells,
      hitResults.map(h => ({ col: h.col, row: h.row, destroyed: h.destroyed })));
  }
  const enemyTeam = atkTeam === 0 ? 1 : 0;
  if (teamHasAI(enemyTeam)) {
    aiObserveEnemyAttack(getTeamBrain(room, enemyTeam), room,
      teamPieces(enemyTeam), teamPieces(atkTeam), atkCells, hitResults);
  }
}

function aiTeamScoreAttack(room, idx, piece, extra) {
  const brain = getTeamBrain(room, getTeamOf(room, idx));
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, piece.col, piece.row, bounds, extra || {});
  let score = 0;
  for (const c of cells) score += brain.probMap[c.row]?.[c.col] || 0;
  // ★ commander 사기증진 버프 반영 — 인접 시 +1 ATK
  const effAtk = _effectiveAtkForAi(piece, room, idx);
  score *= (1 + effAtk * 0.1);
  // ★ 처치·고가치 타겟 보너스 — 표식된 적 한정(공개 HP). 1v1 과 동일.
  score += aiAttackTargetBonus(room, idx, cells, effAtk);
  // ★ 보드축소 우선 — 곧 파괴될 칸에서 공격(제자리)하면 페널티 (1v1 과 동일).
  score -= _aiCellDoomPenalty(room, piece.col, piece.row);
  return score;
}

// 팀전 이동 점수 — 1v1 aiScoreMove 와 동일한 항목 구성(확률맵 공격 잠재력 + 축소회피 + commander
//   + 가장자리회피 + 중앙회귀 + 피격기억 도주 + 추격). 오직 브레인·ownerIdx 만 다름.
function aiTeamScoreMove(room, idx, piece, newCol, newRow) {
  const brain = getTeamBrain(room, getTeamOf(room, idx));
  const W = (brain && brain._weights) || AI_WEIGHTS;
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, newCol, newRow, bounds);
  let score = 0;
  for (const c of cells) score += brain.probMap[c.row]?.[c.col] || 0;
  // ── 보드 축소 회피 + 외곽 탈출 (사용자 요청: 축소에서 절대 도망쳐라) ──
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  let curIsOutside = false, newIsOutside = false, mostUrgentTurns = 99;
  for (const ev of schedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const turnsToShrink = ev.shrinkTurn - room.turnNumber;
    if (turnsToShrink > 10 || turnsToShrink < 0) continue;
    const evBaseSize = room.mode === 'team' ? 7 : 5;
    const evNextLevel = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
    const evBounds = ev.newBounds || _levelToBounds(evNextLevel, evBaseSize);
    const willBeOutside = newCol < evBounds.min || newCol > evBounds.max ||
                          newRow < evBounds.min || newRow > evBounds.max;
    const curOutside = piece.col < evBounds.min || piece.col > evBounds.max ||
                       piece.row < evBounds.min || piece.row > evBounds.max;
    if (willBeOutside) { score -= W.shrinkAvoid * Math.max(1, 11 - turnsToShrink); newIsOutside = true; }
    if (curOutside) curIsOutside = true;
    if (turnsToShrink < mostUrgentTurns) mostUrgentTurns = turnsToShrink;
  }
  if (curIsOutside && !newIsOutside) score += W.escapeOutside * Math.max(1, 11 - mostUrgentTurns);
  // commander 인접 보너스
  const _teamEffAtk = _effectiveAtkAtCellForAi(piece, room, idx, newCol, newRow);
  if (_teamEffAtk > (piece.atk || 0)) score += W.commanderAdj;
  // 일반 가장자리 회피
  if (room.turnNumber >= 25 && !room.boardShrunk) {
    if (newCol === bounds.min || newCol === bounds.max || newRow === bounds.min || newRow === bounds.max) score *= W.edgePenaltyMul;
  }
  // 중앙 회귀 약한 인센티브
  const isCurEdge = piece.col === bounds.min || piece.col === bounds.max || piece.row === bounds.min || piece.row === bounds.max;
  const isNewEdge = newCol === bounds.min || newCol === bounds.max || newRow === bounds.min || newRow === bounds.max;
  if (isCurEdge && !isNewEdge) score += W.centerReturn;
  // 피격 기억(fog 존중) 기반 도주 — 맞은 위치에서 멀어지면 보너스. ★ 1v1 aiScoreMove 와 동일화:
  //   HP<=2 게이트 제거(맞으면 HP 무관 회피 고려) + 가중치를 maxHp 비율 기반으로(저HP일수록 ↑).
  //   (이전: hp<=2 일 때만 + (3-hp) 선형 → 팀 AI 가 맞고도 같은 자리에서 또 맞는 원인.)
  const mem = brain.hitMemory[piece.type];
  if (mem && brain.turnCount - mem.turn <= 2) {
    const distFromHit = Math.abs(newCol - mem.col) + Math.abs(newRow - mem.row);
    const curDistFromHit = Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row);
    if (distFromHit > curDistFromHit) score += W.fleeBonus * (1 + (piece.maxHp - piece.hp) / piece.maxHp);
  }
  // ★ 추격 — 적 확률질량으로 능동 접근 (사거리 밖 적에게 다가감)
  score += aiApproachScore(brain, piece.col, piece.row, newCol, newRow, bounds) * W.approachMul;
  // ★ 위협 회피 + 정보 획득 — 1v1 aiScoreMove 와 동일. 치팅 X (표식+확률맵만).
  score -= aiThreatPenalty(piece, brain._dangerMap, newCol, newRow) * W.threatMul;
  score += aiInfoGain(brain, piece.type, newCol, newRow, bounds, piece.toggleState) * W.infoGainMul;
  // ★ 지휘관 본인 — 버프 가능한 아군 수만큼 가산 (사기증진 진형 유지). 1v1 과 동일.
  score += aiCommanderAuraScore(piece, room, idx, newCol, newRow) * W.commanderAuraMul;
  return score;
}
// 팀전 마녀·그림자 암살자 best target — 1v1 aiBestTargetCell 과 동일하게 팀 확률맵만 본다.
//   그림자 암살자는 주변 3x3 만, 마녀는 전역. fog 존중 → 추론된 확률 질량이 가장 큰 셀을 노린다.
function aiTeamBestTargetCell(room, idx, piece) {
  const bounds = room.boardBounds;
  const brain = getTeamBrain(room, getTeamOf(room, idx));
  const isShadow = piece && piece.type === 'shadowAssassin';
  let best = { col: piece.col, row: piece.row, score: 0 };
  for (let r = bounds.min; r <= bounds.max; r++) {
    for (let c = bounds.min; c <= bounds.max; c++) {
      if (c === piece.col && r === piece.row) continue;
      if (isShadow && (Math.abs(c - piece.col) > 1 || Math.abs(r - piece.row) > 1)) continue;
      const sc = brain.probMap[r]?.[c] || 0;
      if (sc > best.score) { best = { col: c, row: r, score: sc }; }
    }
  }
  return best;
}

// 팀전 AI 스킬 실행 — 1v1 aiExecSkill의 팀모드판 (idx를 받음)
function aiTeamExecSkill(room, idx, pidx, skillId, params) {
  // ★ 사망 기폭 페이즈 — 팀모드 AI 스킬로 화약상 사망 시 큐.
  startPhase(room);
  // ★ FIX (팀 AI 스킬 무한 재시전 루프): 자유 스킬을 *시도한* piece 를 이번 턴 동안 기록(성공/실패 무관) →
  //   aiTeamUsePreSkills 가 같은 piece 의 자유 스킬을 재시전하지 않도록 한다. 실패 시에도 마킹해야 함 —
  //   bomb 등이 실패해도 aiTeamUsePreSkills 는 결과와 무관하게 return true(재진입)하므로, 실패를
  //   마킹 안 하면 같은 piece 가 같은 실패 스킬을 무한 재시도(헤드리스 무한재귀 / 실게임 스킬 스팸)했음.
  //   한 piece 는 한 턴에 자유 스킬 1회만(메인 행동은 별개로 가능).
  const result = executeSkill(room, idx, pidx, skillId, params || {});
  {
    const _pl = room.players[idx];
    if (_pl) { if (!_pl._aiFreeSkillUsedPieces) _pl._aiFreeSkillUsedPieces = new Set(); _pl._aiFreeSkillUsedPieces.add(pidx); }
  }
  // 모든 비-AI 플레이어 + 관전자에게 스킬 사용 알림 (인간 use_skill 경로와 동일)
  // 누락되면 팀원/적의 스킬 사용을 인지 불가 → 토스트·로그 누락
  const skillPiece = room.players[idx]?.pieces[pidx];
  if (skillPiece) {
    // ★ 사용자 보고 (팀모드 AI 스킬 애니 누락): 인간 use_skill 의 team_skill_notice 페이로드와
    //   동일하게 모든 애니/도장/플래시 데이터를 포함시켜야 receiver/관전자 측에서 회복 플래시,
    //   라바, 반지 순간이동, 저주 turn-bright, 분신 비행, 약초학·신성 보드 애니가 정상 작동.
    //   특히 회복 (healedPieces) 누락이 가장 두드러져 보고 — 팀원 회복도 적팀 영향 없음 (사용자 요청).
    const basePayload = {
      casterIdx: idx,
      casterName: room.players[idx].name,
      casterTeamId: room.players[idx].teamId,
      casterPieceIdx: pidx,                 // 시전자 카드 spotlight 용
      sp: room.sp,                           // 마법구 비행 애니용
      instantSp: room.instantSp,
      skillUsed: {
        icon: skillPiece.icon,
        name: skillPiece.name,
        skillName: skillPiece.skillName,
      },
      // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용 (AI 시전 경로)
      hits: result.data?.hits || null,
      // ★ 저주 부여 정보 — turn-bright 적용
      cursedPieceIdx: result.data?.cursedPieceIdx,
      cursedOwnerIdx: result.data?.cursedOwnerIdx,
      // ★ 유황범람 borderCells — 라바 애니
      borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
      // ★ 회복 애니 — { ownerIdx, pieceIdx } 페어 (heal-flash + 스파클)
      healedPieces: result.data?.healedPieces || null,
      // ★ 분신 비행 — fog-of-war 우회용 좌표
      twinJoin: result.data?.twinJoin || null,
      // ★ 절대복종 반지 순간이동
      ringTeleport: result.data?.ringTeleport || null,
      // ★ 약초학/신성 보드 시전 애니 (같은 팀만 표시 — 클라가 팀 분기 처리)
      herbCenter: result.data?.herbCenter || null,
      divineTarget: result.data?.divineTarget || null,
      // ★ 악몽 시전 — 표식 적 셀 보라 펄스 + scale 애니용
      nightmareCells: result.data?.nightmareCells || null,
    };
    // 본인/팀원/적 분기 (use_skill 핸들러의 explicitAlly/explicitOpp 와 동일 로직)
    const explicitAlly = (result.allyMsg !== undefined) ? result.allyMsg : (result.msg || null);
    const explicitOpp  = (result.oppMsg  !== undefined) ? result.oppMsg  : (result.msg || null);
    // 반드시 broadcastTeamGameState 보다 먼저 보냄 — 그래야 클라가 oldSpSnap 캡처 후 마법구 비행 가능
    for (const p of room.players) {
      if (!p.socketId || p.socketId === 'AI' || p.index === idx) continue;
      const isAlly = (p.teamId === room.players[idx].teamId);
      io.to(p.socketId).emit('team_skill_notice', { ...basePayload, msg: isAlly ? explicitAlly : explicitOpp });
    }
    for (const s of (room.spectators || [])) {
      io.to(s.socketId).emit('team_skill_notice', { ...basePayload, msg: explicitOpp });
    }
  }
  // 마지막에 전체 상태 브로드캐스트 (팀_skill_notice 가 먼저 도착해야 마법구 애니 동작)
  broadcastTeamGameState(room);

  // ★ 기폭 (detonate) — 폭발 애니메이션 emit. 인간 use_skill 경로와 동일.
  //   누락 시 팀모드 AI 기폭이 다른 플레이어에게 폭발 애니가 안 보임.
  let _aiBombAnimEndsAt = 0;
  if (result && result.data && Array.isArray(result.data.deferredBombEmits)) {
    const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row, owner: b.owner }));
    if (bombList.length > 0) {
      emitToBoth(room, 'detonation_intro', { bombs: bombList });
      // ★ 폭발 애니 종료 시각 — 마지막 적이 폭탄으로 사망 시 게임종료 판정을 이 시점까지 지연.
      _aiBombAnimEndsAt = Date.now() + bombAnimDurationMs(bombList.length);
    }
    const deferred = [...result.data.deferredBombEmits];
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      for (const bd of deferred) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
      // ★ 사용자 보고: 마법사가 폭탄에 피격 시 인스턴트 SP 즉시 반영 누락.
      //   detonateBomb({deferEmit:true}) 는 suppressSpUpdate=true 로 호출되어 emitSPUpdate 가 생략됨.
      //   bomb_detonated 페이로드도 sp/instantSp 미포함 → 다음 state sync (턴 종료 등) 까지 클라가 모름.
      //   해결: deferred 폭발 직후 emitSPUpdate 로 즉시 동기화.
      if (typeof emitSPUpdate === 'function') emitSPUpdate(room);
    }, 1930);
  }

  // ★ 사망 기폭 페이즈 flush — 팀모드 AI 스킬로 화약상 사망 시 cast/intro/bomb_detonated 시퀀스 emit.
  //   폭탄 기폭으로 마지막 적이 사망하는 경우 폭발/사망/토스트 애니 종료까지 game_over 지연.
  flushPhase(room, () => {
    checkGameEndAfterBombPhase(room, _aiBombAnimEndsAt);
  });

  // AI 토스트 추적 — 스킬은 ~7.6s 동안 표시
  aiTrackToastEnd(room, 'skill');
  return result;
}

// AI 토스트 추적기 — 두 시점 추적:
//   ① _aiNextActionEarliest : 토스트가 *나타나는* 시점 — AI의 다음 행동(intra-turn) 이 이 전에는 안 됨.
//                              그래야 발생 순서대로 토스트가 줄지어 표시됨.
//   ② _aiEndTurnEarliest    : 토스트가 *사라지는* 시점 — AI의 endTurn 이 이 시각 + 0.5s 버퍼까지 지연.
//                              그래야 다음 플레이어 턴오버 토스트가 직전 토스트보다 먼저 오지 않음.
function aiTrackToast(room, kind) {
  // 토스트 노출 시점 (appear) — 새 시퀀스 기준:
  //   skill: T+1500ms (마법구 비행 1.5s 끝나면 스킬 효과 + 토스트 동시 노출)
  //   attack/move/passive: 즉시 (~100ms)
  //   detonation: 1.5s + 폭탄 애니(0.95s) ≈ 2500ms
  //   sp_grant: 풀스크린 애니
  // 토스트 종료 시점 (disappear) — appear + TOAST_DURATION(4000) + fade(350).
  let appearMs = 100;
  let totalMs  = 4500;
  if (kind === 'skill')          { appearMs = 1500; totalMs = 5900; }
  else if (kind === 'detonation') { appearMs = 2500; totalMs = 7000; }
  else if (kind === 'sp_grant')   { appearMs = 0;    totalMs = 6000; }
  const now = Date.now();
  const appearAt = now + appearMs;
  const finishAt = now + totalMs;
  if (!room._aiNextActionEarliest || appearAt > room._aiNextActionEarliest) {
    room._aiNextActionEarliest = appearAt;
  }
  if (!room._aiEndTurnEarliest || finishAt > room._aiEndTurnEarliest) {
    room._aiEndTurnEarliest = finishAt;
  }
}
// 호환용 별칭 — aiTeamExecSkill 등 기존 호출처가 사용
function aiTrackToastEnd(room, kind) { aiTrackToast(room, kind); }
// AI 인트라 턴 다음 행동까지 대기할 시간 (ms) — 토스트가 나타날 때까지 + 작은 마진
function aiNextActionWaitMs(room, fallbackMs) {
  const now = Date.now();
  const earliest = room._aiNextActionEarliest || 0;
  const remain = Math.max(0, earliest - now);
  // 토스트 출력 직후 최소 200ms 마진 — 사용자가 토스트를 인지할 시간
  return Math.max(fallbackMs || 0, remain + 200);
}

// ── 팀전 AI 턴 종료 안전 스케줄러 ──
// 기존 setTimeout(...endTurn..., 4000) 패턴은 4초 대기 중 다른 곳에서 endTurn이 먼저 호출되면
// currentPlayerIdx가 바뀌어 조건이 false가 되고 게임이 멈출 위험이 있었다.
// 이 헬퍼는 핸들을 추적해 중복 스케줄/취소를 안전하게 처리하고, 30초 워치독으로 강제 endTurn 보장.
// ── AI 무행동(패스) 알림 ─────────────────────────────────────────────────────
//   ※ 별도 알림 함수는 제거함. endTurn() 이 이미 "행동·스킬 모두 안 함"을 감지해
//      no_action_notice 로 "⏰ {name}의 턴 스킵" 을 모든 플레이어/관전자에게 송신한다
//      (emitToBoth → 팀 4명 전원 포함). AI 패스도 endTurn 을 거치므로 자동 처리됨.

function scheduleAITurnEnd(room, idx, delayMs) {
  if (!room) return;
  // ★ 헤드리스(셀프플레이): 연출 딜레이 없이 즉시 동기 턴 종료.
  if (room._headless) { room._aiEndTurnEarliest = 0; if (room.currentPlayerIdx === idx) endTurn(room); return; }
  if (!room._aiTurnEndHandle) room._aiTurnEndHandle = {};
  if (!room._aiTurnEndWatchdog) room._aiTurnEndWatchdog = {};
  // 이미 예약된 핸들이 있으면 취소 (중복 방지)
  if (room._aiTurnEndHandle[idx]) {
    clearTimeout(room._aiTurnEndHandle[idx]);
    room._aiTurnEndHandle[idx] = null;
  }
  if (room._aiTurnEndWatchdog[idx]) {
    clearTimeout(room._aiTurnEndWatchdog[idx]);
    room._aiTurnEndWatchdog[idx] = null;
  }
  // 사용자 요청: 토스트가 모두 사라지고 0.5초 버퍼까지 대기 후 endTurn.
  //   호출자가 넘긴 delayMs 와 _aiEndTurnEarliest 중 더 큰 값 적용.
  const now = Date.now();
  const earliest = room._aiEndTurnEarliest || 0;
  const remainingToastMs = Math.max(0, earliest - now);
  const finalDelay = Math.max(delayMs, remainingToastMs + 500);
  // 메인 endTurn 콜백
  room._aiTurnEndHandle[idx] = setTimeout(() => {
    room._aiTurnEndHandle[idx] = null;
    if (!room || room.phase !== 'game') return;
    if (room.currentPlayerIdx === idx) {
      // 워치독 취소
      if (room._aiTurnEndWatchdog[idx]) {
        clearTimeout(room._aiTurnEndWatchdog[idx]);
        room._aiTurnEndWatchdog[idx] = null;
      }
      room._aiEndTurnEarliest = 0;
      endTurn(room);
    }
    // 다른 곳에서 endTurn이 먼저 호출됐다면 정상 — 그냥 종료 (워치독은 이미 무관)
  }, finalDelay);
  // 워치독 — 최종 delay의 2배 시간 후에도 currentPlayerIdx가 여전히 idx면 강제 endTurn
  // (게임 멈춤 방지용 안전망)
  room._aiTurnEndWatchdog[idx] = setTimeout(() => {
    room._aiTurnEndWatchdog[idx] = null;
    if (!room || room.phase !== 'game') return;
    if (room.currentPlayerIdx === idx) {
      console.warn('[AI watchdog] forcing endTurn for stalled AI', idx);
      room._aiEndTurnEarliest = 0;
      endTurn(room);
    }
  }, finalDelay * 2 + 5000);
}

// ── 팀전 AI 자유 스킬 사용 (그림자/정비/질주/약초학/정찰/기폭/신성/반지) ──
function aiTeamUsePreSkills(room, idx) {
  const p = room.players[idx];
  if (!p || p.actionDone) return false;
  const allyIdxs = getAllyIndices(room, idx);
  const enemyIdxs = getEnemyIndices(room, idx);
  for (let pi = 0; pi < p.pieces.length; pi++) {
    const piece = p.pieces[pi];
    if (!piece.alive || !piece.hasSkill || piece.skillReplacesAction) continue;
    if ((room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow')) continue;
    // ★ FIX (팀 AI 스킬 무한 재시전): 이번 턴에 이미 자유 스킬을 시전한 piece 는 재시전 금지.
    if (p._aiFreeSkillUsedPieces && p._aiFreeSkillUsedPieces.has(pi)) continue;
    // ★ FIX (팀 AI 루프 버그 — 질주 등 oncePerTurn 스킬 반복 시전): skillsUsedBeforeAction 은
    //   `${pieceIdx}:${skillId}` 형식으로 저장(executeSkill 5973)되는데 여기서 bare skillId 로
    //   검사해 절대 매치 안 됨 → 질주(oncePerTurn)를 질주 이동 재진입마다 재시전(SP 소진까지 루프)했음.
    if (p.skillsUsedBeforeAction && p.skillsUsedBeforeAction.includes(`${pi}:${piece.skillId}`)) continue;
    // shadow — 방어 스킬. 적 위치는 직접 알 수 없으므로(치팅 금지) '표식' 찍힌 적이
    //   인접하거나, 위협맵상 자기 칸의 예상 피격치가 높을 때 시전.
    if (piece.skillId === 'shadow') {
      const brain = getTeamBrain(room, getTeamOf(room, idx));
      const dm = (brain._dangerMap && brain._dangerTurn === brain.turnCount)
        ? brain._dangerMap : aiBuildDangerMap(room, idx, brain);
      const markedAdj = aiKnownEnemies(room, idx).some(e => e.marked &&
        Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row) <= 2);
      const danger = dm?.[piece.row]?.[piece.col] || 0;
      if (markedAdj || danger >= (piece.hp || 1)) { aiTeamExecSkill(room, idx, pi, 'shadow'); return true; }
    }
    // reform — 더 좋은 공격 점수 방향이면
    if (piece.skillId === 'reform') {
      const curScore = aiTeamScoreAttack(room, idx, piece, { toggleState: piece.toggleState });
      const altState = piece.type === 'archer' ? (piece.toggleState === 'right' ? 'left' : 'right') : (piece.toggleState === 'vertical' ? 'horizontal' : 'vertical');
      const altScore = aiTeamScoreAttack(room, idx, piece, { toggleState: altState });
      // ★ SP 수읽기 — 정규 SP 이관 문턱까지 넘는 확실한 이득일 때만 (1v1 과 동일 정책).
      if (altScore > curScore + 8 + _aiSpTransferBar(room, getTeamOf(room, idx), piece.skillCost)) {
        aiTeamExecSkill(room, idx, pi, 'reform'); return true;
      }
    }
    // sprint — 위급(HP≤1) + 도망 필요시에만. 1v1 AI 와 동일한 정책.
    if (piece.skillId === 'sprint') {
      const critical = piece.hp <= 1;
      if (critical) { aiTeamExecSkill(room, idx, pi, 'sprint'); return true; }
    }
    // herb — 인접 아군 부상 시
    if (piece.skillId === 'herb') {
      const woundedAlly = allyIdxs.flatMap(ai => room.players[ai]?.pieces || [])
        .some(a => a.alive && a !== piece && a.hp < a.maxHp &&
          Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1);
      if (woundedAlly) { aiTeamExecSkill(room, idx, pi, 'herb'); return true; }
    }
    // recon — 적 위치 정보가 빈약할 때만 (확률맵 최대값이 낮음 = 적 위치 불확실).
    //   1v1 aiUsePreSkills 의 scout 정책과 동일. 의미없는 랜덤 사용 금지(사용자 요청).
    if (piece.skillId === 'recon') {
      const brain = getTeamBrain(room, getTeamOf(room, idx));
      if (brain.mode === 'scan' && aiMaxProb(brain) < 6) {
        aiTeamExecSkill(room, idx, pi, 'recon'); return true;
      }
    }
    // bomb — 폭탄 설치 (적 인접 셀 우선)
    if (piece.skillId === 'bomb') {
      const adj = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
      const cands = [];
      for (const [dc, dr] of adj) {
        const c = piece.col + dc, r = piece.row + dr;
        if (!inBounds(c, r, room.boardBounds)) continue;
        const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === c && pc.row === r));
        if (occ) continue;
        // ★ FIX: executeSkill(5698) 의 거부 조건과 일치시켜야 함 — 팀 전체의 덫/폭탄 칸 제외.
        //   (이전엔 자기 폭탄만 검사 → 팀원 덫/폭탄 칸을 골라 설치 실패 → 재시도 루프의 원인이었음.)
        const _teamIdxs = (room.mode === 'team') ? getAllyIndices(room, idx) : [idx];
        const hasObstacle = _teamIdxs.some(ai => (room.boardObjects[ai] || []).some(o => (o.type === 'bomb' || o.type === 'trap') && o.col === c && o.row === r));
        if (hasObstacle) continue;
        // ★ 적 확률질량이 높은 칸에 설치 — 적이 밟을 가능성이 큰 곳(의도된 배치, 랜덤 금지).
        const brain = getTeamBrain(room, getTeamOf(room, idx));
        cands.push({ col: c, row: r, score: brain.probMap[r]?.[c] || 0 });
      }
      if (cands.length > 0) {
        cands.sort((a, b) => b.score - a.score);
        const t = cands[0];
        aiTeamExecSkill(room, idx, pi, 'bomb', { col: t.col, row: t.row }); return true;
      }
    }
    // detonate — 폭탄 영향권 적 존재. 위치는 '표식' 찍힌 적만 공정하게 확인,
    //   그 외엔 확률맵으로 폭탄 주변 적 존재 가능성 추산 (치팅 금지).
    if (piece.skillId === 'detonate') {
      const brain = getTeamBrain(room, getTeamOf(room, idx));
      const myBombs = (room.boardObjects[idx] || []).filter(o => o.type === 'bomb');
      const marked = aiKnownEnemies(room, idx).filter(e => e.marked);
      let markedInBlast = 0, probInBlast = 0;
      for (const b of myBombs) {
        for (const e of marked) {
          if (Math.abs(e.col - b.col) <= 1 && Math.abs(e.row - b.row) <= 1) markedInBlast++;
        }
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++)
            probInBlast += brain.probMap[b.row + dr]?.[b.col + dc] || 0;
      }
      if (markedInBlast >= 1 || probInBlast >= 16) { aiTeamExecSkill(room, idx, pi, 'detonate'); return true; }
    }
    // divine (수도승 신성) — 부상 아군에게
    if (piece.skillId === 'divine') {
      // 자기 외 아군 중 가장 부상자 우선
      let target = null, targetIdx = -1, targetOwnerIdx = -1;
      for (const ai of allyIdxs) {
        const ap = room.players[ai];
        for (let api = 0; api < (ap?.pieces || []).length; api++) {
          const pc = ap.pieces[api];
          if (!pc.alive || pc === piece) continue;
          if (pc.hp >= pc.maxHp) continue;
          if (!target || (pc.maxHp - pc.hp) > (target.maxHp - target.hp)) {
            target = pc; targetIdx = api; targetOwnerIdx = ai;
          }
        }
      }
      if (target) {
        aiTeamExecSkill(room, idx, pi, 'divine', { targetPieceIdx: targetIdx, targetOwnerIdx }); return true;
      }
    }
    // dragon — 5SP 충분하면 한 번 소환 (게임당 1회 시도)
    if (piece.skillId === 'dragon' && (room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) >= 5) {
      // 자기 인접 빈 칸
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const c = piece.col + dc, r = piece.row + dr;
        if (!inBounds(c, r, room.boardBounds)) continue;
        const occ = room.players.some(pl => (pl.pieces || []).some(pc => pc.alive && pc.col === c && pc.row === r));
        if (!occ) { aiTeamExecSkill(room, idx, pi, 'dragon', { col: c, row: r }); return true; }
      }
    }
    // ring (국왕) — 사용자 요청 전략적 사용만 (남발 금지).
    //   1. 보드 축소 임박 시 적을 외곽 파괴 영역으로 / 2. AI 공격범위 즉사 연계 /
    //   3. AI 덫·폭탄·쥐 위로 / 4. AI 유닛 위협 적을 위협 안 닿는 곳으로.
    //   _aiPickRingPlay 헬퍼가 4가지 조건을 점수화하여 최선의 play 반환 (없으면 null).
    if (piece.skillId === 'ring') {
      // ★ 같은 팀 멤버는 적이 아니므로 _aiPickRingPlay 의 enemyOwnerIdxs 에서 제외 (이중 안전장치).
      const enemyOwners = (enemyIdxs || []).filter(ei => {
        const o = room.players[ei];
        return o && o.teamId !== room.players[idx].teamId;
      });
      const play = _aiPickRingPlay(room, idx, enemyOwners);
      if (play) {
        aiTeamExecSkill(room, idx, pi, 'ring', {
          targetName: play.target.type,
          targetOwnerIdx: play.targetOwnerIdx,
          col: play.destCol, row: play.destRow,
        });
        // ★ 반지로 옮긴 적 위치는 AI 가 직접 정했으므로 확실히 앎 → 확률맵 스파이크로 후속 공격 유도.
        const _rb = getTeamBrain(room, getTeamOf(room, idx));
        if (_rb.probMap[play.destRow]) _rb.probMap[play.destRow][play.destCol] = 10;
        return true;
      }
    }
  }
  return false;
}

// ── 팀전 AI 보드 축소 대피 ──
// 다음 축소가 임박했고 외곽에 내 말이 있으면 안쪽으로 즉시 대피 (1v1 aiFindEvacuation과 동등)
function aiTeamFindEvacuation(room, idx) {
  const p = room.players[idx];
  if (!p) return null;
  const bounds = room.boardBounds;
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  // 다음 축소 이벤트
  const nextShrink = schedule.find(ev => room.boardShrinkStage < ev.stage && room.turnNumber < ev.shrinkTurn);
  if (!nextShrink) return null;
  const turnsLeft = nextShrink.shrinkTurn - room.turnNumber;
  if (turnsLeft > 5) return null;  // 5턴 이내만 대피 모드
  // 곧 파괴될 외곽에 있는 내 말 찾기
  // ★ AI freeze 버그 수정 — schedule 이벤트에 newBounds 없음. _levelToBounds 로 사후 계산.
  const baseSize = room.mode === 'team' ? 7 : 5;
  const nextLevel = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
  const newBounds = nextShrink.newBounds || _levelToBounds(nextLevel, baseSize);
  const myAlive = p.pieces.filter(pc => pc.alive && pc.col >= 0);
  const trapped = myAlive.filter(pc => pc.col < newBounds.min || pc.col > newBounds.max ||
                                       pc.row < newBounds.min || pc.row > newBounds.max);
  if (trapped.length === 0) return null;
  // 가장 임박한(보드 축소 영역 밖) 첫 piece부터 안쪽으로 1칸 이동
  for (const piece of trapped) {
    const pieceIdx = p.pieces.indexOf(piece);
    const candidates = [];
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = piece.col + dc, nr = piece.row + dr;
      if (!inBounds(nc, nr, bounds)) continue;
      // 유해 차단
      if (room.remains && room.remains.some(r => r.col === nc && r.row === nr)) continue;
      // 다른 piece 점유 체크
      const occ = room.players.some(pl => (pl.pieces || []).some(pc =>
        pc.alive && pc !== piece && pc.col === nc && pc.row === nr));
      if (occ) continue;
      // 새 위치가 안전 영역(newBounds) 안인지 우선
      const inSafe = nc >= newBounds.min && nc <= newBounds.max &&
                     nr >= newBounds.min && nr <= newBounds.max;
      candidates.push({ col: nc, row: nr, score: inSafe ? 100 : 30 });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.score - a.score);
    return { piece, pieceIdx, col: candidates[0].col, row: candidates[0].row };
  }
  return null;
}

// ── 팀전 AI 메인 턴 — 1v1과 동일한 STEP 구조 ──
function aiTeamTakeTurn(room, idx) {
  if (!room || room.phase !== 'game') return;
  if (room.currentPlayerIdx !== idx) return;
  const p = room.players[idx];
  if (!p || p.socketId !== 'AI') return;
  const bounds = room.boardBounds;
  const myAlive = p.pieces.filter(pc => pc.alive);
  if (myAlive.length === 0) { endTurn(room); return; }
  const enemyIdxs = getEnemyIndices(room, idx);

  // ★ 턴 시작 브레인 갱신 — 1v1 aiTakeTurn 의 aiSpreadProbability/enemiesAlive 와 동등.
  //   확률맵을 시간 경과만큼 번지게(불확실성 증가) + 살아있는 적 수 추산. fog 존중.
  //   재진입(스킬 후) 시 중복 spread 방지 위해 turnNumber 가드.
  {
    const brain = getTeamBrain(room, getTeamOf(room, idx));
    if (brain._lastSpreadTurn !== room.turnNumber) {
      brain._lastSpreadTurn = room.turnNumber;
      brain.turnCount = (brain.turnCount || 0) + 1;
      aiSpreadProbability(brain);
      let alive = 0;
      for (const ei of enemyIdxs) {
        const ep = room.players[ei];
        if (ep && ep.pieces) alive += ep.pieces.filter(pc => pc.alive).length;
      }
      brain.enemiesAlive = alive;
      aiLogTurnStart(room, idx);  // AI 학습 로깅 — 턴 시작 belief+보드 스냅샷
      // ★ 확률맵 정화 + 위협맵 — 1v1 과 동일. 내 팀 말 칸은 적 없음(공정), 위험 칸 회피용.
      aiClearOwnCells(brain, room, idx);
      brain._dangerMap = aiBuildDangerMap(room, idx, brain);
      brain._dangerTurn = brain.turnCount;
    }
  }

  // ★ STEP 0: 보드 축소 임박 시 외곽 말 대피 (최우선) — 1v1 aiFindEvacuation 동등
  const evac = aiTeamFindEvacuation(room, idx);
  if (evac && !p.actionDone) {
    aiTeamExecuteMove(room, idx, evac.pieceIdx, evac.col, evac.row);
    return;
  }

  // ★ STEP 1: free 스킬 사용 (그림자/정비/질주/약초/정찰/폭탄·기폭/신성/반지/드래곤)
  // 사용자 요청: 행동 사이 3초 딜레이 — pre-skill 썼으면 3초 후 다시 진입해 다음 액션 평가
  // ★ usedPreSkill 은 aiTeamUsePreSkills 의 반환값으로 판정.
  //   ❌ 이전 버그: skillsUsedBeforeAction.length 비교는 oncePerTurn 스킬에서만 push 되므로
  //      recon/bomb/herb/divine/ring 등 비-oncePerTurn 스킬은 잘못된 false 가 나와
  //      AI 가 즉시 액션으로 폴-스루 → 스킬+액션 동시 시전.
  const usedPreSkill = aiTeamUsePreSkills(room, idx);
  if (p.actionDone) {
    // pre-skill이 actionDone을 셋했으면 (드물지만 예외) — 턴 종료
    scheduleAITurnEnd(room, idx, 3000);
    return;
  }
  if (usedPreSkill) {
    // ★ 헤드리스: 연출 대기 없이 즉시 동기 재진입(스킬→다음 행동).
    if (room._headless) { aiTeamTakeTurn(room, idx); return; }
    // 사용자 요청: 이전 스킬의 토스트·애니메이션이 화면에서 사라질 때까지 freeze.
    //   _aiEndTurnEarliest 기준 (skill = now + 5900ms) + 1500ms 마진. 최소 6000ms 보장.
    //   사용자 요청: 스킬과 다음 행동 사이 명확한 호흡 텀.
    const _now = Date.now();
    const _earliest = room._aiEndTurnEarliest || 0;
    // ★ #6 프리징 체감 완화: 토스트 종료 시점(_earliest)은 그대로 존중하되 여분 마진을 단축
    //   (1500→600, 바닥 6000→4000). 토스트 길이 자체는 안 줄여 스킬↔행동 겹침 위험 없음.
    const waitMs = Math.max(4000, (_earliest - _now) + 600);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === idx) {
        aiTeamTakeTurn(room, idx);
      }
    }, waitMs);
    // ★ 직전 iteration 이 스킬 시전이었음을 마킹 — 다음 iteration 에서 액션으로 fall-through 시 추가 버퍼.
    room._aiLastWasSkill = true;
    return;
  }

  // ★ 직전 iteration 이 스킬이었고 이번에 더 이상 스킬을 안 쓴다면, 액션으로 넘어가기 전 추가 버퍼.
  //   사용자 요청: AI 가 스킬과 일반 행동을 거의 동시에 하는 느낌 제거.
  if (room._aiLastWasSkill) {
    room._aiLastWasSkill = false;
    const _now = Date.now();
    const _earliest = room._aiEndTurnEarliest || 0;
    const remain = Math.max(0, _earliest - _now);
    const waitMs = remain + 600;  // ★ #6: 여분 마진 1500→600 단축 (토스트 종료는 remain 으로 존중)
    if (waitMs >= 200) {
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === idx) {
          aiTeamTakeTurn(room, idx);
        }
      }, waitMs);
      return;
    }
  }

  // ★ STEP 1.5 (FIX: 피격 후 제자리 멍청한 짓): 도주 vs 반격 — 1v1 STEP2(server 7407) 동등.
  //   행동대체 스킬(덫 등, 아래 STEP 2)보다 먼저 평가해, 위험한 자리에서 덫만 깔지 않도록 한다.
  //   팀 브레인(getTeamBrain)의 hitMemory 를 공유하므로 최근 피격 위치를 안다(치팅 아님).
  {
    const brain = getTeamBrain(room, getTeamOf(room, idx));
    let fleePiece = null, fleeIdx = -1, fleeMem = null, fleeUrg = -1;
    for (let pi = 0; pi < p.pieces.length; pi++) {
      const piece = p.pieces[pi];
      if (!piece.alive) continue;
      const mem = brain.hitMemory && brain.hitMemory[piece.type];
      if (!mem || (brain.turnCount - mem.turn) > 2) continue;
      if (Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row) > 1) continue;
      const urg = (piece.maxHp - piece.hp) / piece.maxHp;
      if (urg > fleeUrg) { fleeUrg = urg; fleePiece = piece; fleeIdx = pi; fleeMem = mem; }
    }
    if (fleePiece && !p.actionDone) {
      const piece = fleePiece, mem = fleeMem;
      // 반격 가치 (현재 자리에서 공격 점수)
      const counterExtra = {};
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
        const bt = aiBestTargetCell(brain, piece, room);
        counterExtra.tCol = bt.col; counterExtra.tRow = bt.row;
      }
      if (piece.toggleState) counterExtra.toggleState = piece.toggleState;
      const counterScore = aiTeamScoreAttack(room, idx, piece, counterExtra);
      // 최적 도주 위치 (피격 위치에서 멀수록 + 이동 후 점수 높을수록)
      let bestMove = null, bestFleeScore = -1;
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        if (!_canMoveTo(room, piece, nc, nr)) continue;
        const dist = Math.abs(nc - mem.col) + Math.abs(nr - mem.row);
        const fleeScore = dist * 15 + aiTeamScoreMove(room, idx, piece, nc, nr);
        if (fleeScore > bestFleeScore) { bestFleeScore = fleeScore; bestMove = { col: nc, row: nr }; }
      }
      // 반격 우선 판단 — 확정/유력 적 위치를 칠 수 있고 위급(HP≤2)하지 않으면 반격, 아니면 도주.
      const criticalHp = piece.hp <= 2;
      let sureHit = false, canHitProb = false;
      const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState });
      for (const c of atkCells) {
        const v = brain.probMap[c.row]?.[c.col] || 0;
        if (v >= 9) sureHit = true;
        if (v >= 6) canHitProb = true;
      }
      const shouldCounter = sureHit || (!criticalHp && (canHitProb || (counterScore > bestFleeScore * 1.05 && counterScore > 4)));
      if (shouldCounter) { aiTeamExecuteAttack(room, idx, fleeIdx, counterExtra); return; }
      if (bestMove) { aiTeamExecuteMove(room, idx, fleeIdx, bestMove.col, bestMove.row); return; }
    }
  }

  // ★ STEP 2: 행동 대체 스킬 (덫/저주/유황범람/분신)
  for (const piece of myAlive) {
    if (!piece.hasSkill || !piece.skillReplacesAction) continue;
    if ((room.sp[getTeamOf(room, idx)] + room.instantSp[getTeamOf(room, idx)]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
    const pi = p.pieces.indexOf(piece);

    if (piece.type === 'manhunter') {
      // ★ 치팅 제거 — 비표식 적 실위치 안 봄. 표식 적이 인접(≤2)하거나, 내 칸 주변에
      //   적 확률질량이 높을(곧 밟을) 때만 결정적으로 덫 설치.
      const brain = getTeamBrain(room, getTeamOf(room, idx));
      const markedDists = aiKnownEnemies(room, idx).filter(e => e.marked)
        .map(e => Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row));
      const nearestMarked = markedDists.length ? Math.min(...markedDists) : 99;
      let probAround = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        probAround += brain.probMap[piece.row + dr]?.[piece.col + dc] || 0;
      }
      const hasTrap = (room.boardObjects[idx] || []).some(o => o.type === 'trap' && o.col === piece.col && o.row === piece.row);
      if (!hasTrap && (nearestMarked <= 2 || probAround >= 14)) {
        aiTeamExecSkill(room, idx, pi, 'trap');
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
    if (piece.type === 'witch') {
      // 학습 메모리 — 같은 타겟에 저주가 계속 해소되면 회피
      // p._curseHistory: { 'ownerIdx:type:subUnit': cleansedCount }
      if (!p._curseHistory) p._curseHistory = {};
      // ★ 사용자 정정: 수도승 자신을 0순위 저주 — 신성 스킬 봉인 → 다른 아군 저주 해소 차단.
      //   적팀에 수도승이 있고 살아있을 때 monk 가 후보에 포함되어 최우선 선택됨.
      const candidates = enemyIdxs.flatMap(ei => (room.players[ei]?.pieces || [])
        .map((pc, ti) => ({ pc, ownerIdx: ei, idxInOwner: ti }))
        .filter(o => o.pc.alive && o.pc.hp > 1 &&
          !o.pc.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow')));

      if (candidates.length > 0) {
        // 정렬: 저주 가치(aiCurseValue: 수도승=100 > 강스킬·고가치) > 정화 메모리 적음 > HP > tier
        //   사용자 요청: 저주는 '스킬 봉인'이므로 봉인 가치가 큰 핵심 유닛(수도승·강스킬)을 노린다.
        candidates.sort((a, b) => {
          const va = aiCurseValue(a.pc), vb = aiCurseValue(b.pc);
          if (va !== vb) return vb - va;  // 저주 가치 높은 쪽 우선
          const ka = `${a.ownerIdx}:${a.pc.type}:${a.pc.subUnit || ''}`;
          const kb = `${b.ownerIdx}:${b.pc.type}:${b.pc.subUnit || ''}`;
          const ca = p._curseHistory[ka] || 0;
          const cb = p._curseHistory[kb] || 0;
          if (ca !== cb) return ca - cb;  // 정화 횟수 적은 쪽이 우선
          if ((b.pc.hasSkill ? 1 : 0) !== (a.pc.hasSkill ? 1 : 0)) return (b.pc.hasSkill ? 1 : 0) - (a.pc.hasSkill ? 1 : 0);
          if (b.pc.hp !== a.pc.hp) return b.pc.hp - a.pc.hp;
          return (b.pc.tier || 0) - (a.pc.tier || 0);
        });
        const t = candidates[0];
        const targetKey = `${t.ownerIdx}:${t.pc.type}:${t.pc.subUnit || ''}`;
        const cleansedTimes = p._curseHistory[targetKey] || 0;
        // ★ 사용자 정정: 같은 monk 가 자기 자신 저주를 풀 수 없으므로 (저주 상태에서 스킬 봉인),
        //   monk 자체에는 cleansed 추적 무의미 — 무조건 시전. monk 아닌 다른 타겟은 기존 cleansed 2회 가드 유지.
        if (t.pc.type !== 'monk' && cleansedTimes >= 2) {
          // 저주 스킵 — 다음 행동 후보로 넘어감
        } else {
          aiTeamExecSkill(room, idx, pi, 'curse', { targetPieceIdx: t.idxInOwner, targetOwnerIdx: t.ownerIdx });
          // 저주 시전 시점 기록 (해소 추적용 키 생성)
          p._lastCurseTarget = { key: targetKey, ownerIdx: t.ownerIdx, type: t.pc.type, subUnit: t.pc.subUnit, turnNumber: room.turnNumber };
          scheduleAITurnEnd(room, idx, 3000);
          return;
        }
      }
    }
    if (piece.type === 'sulfurCauldron') {
      // ★ 치팅 제거 — 비표식 적 실위치 안 봄. 표식된 외곽 적 + 외곽 확률질량으로 판단.
      const brain = getTeamBrain(room, getTeamOf(room, idx));
      const markedBorder = aiKnownEnemies(room, idx).filter(e => e.marked &&
        (e.col === bounds.min || e.col === bounds.max || e.row === bounds.min || e.row === bounds.max)).length;
      let borderScore = 0;
      const borderCells = (typeof getBorderCells === 'function') ? getBorderCells(bounds) : [];
      for (const c of borderCells) borderScore += brain.probMap[c.row]?.[c.col] || 0;
      if (markedBorder >= 2 || (markedBorder >= 1 && borderScore >= 10) || borderScore >= 16) {
        aiTeamExecSkill(room, idx, pi, 'sulfurRiver');
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
    if (piece.type === 'twins_elder' || piece.type === 'twins_younger') {
      // ★ 사용자 요청: 의미있는 합류만 (이미 합쳐졌거나 random 차단).
      const elder = p.pieces.find(pc => pc.subUnit === 'elder' && pc.alive);
      const younger = p.pieces.find(pc => pc.subUnit === 'younger' && pc.alive);
      const alreadyMerged = elder && younger && elder.col === younger.col && elder.row === younger.row;
      const dist = (elder && younger) ? Math.abs(elder.col - younger.col) + Math.abs(elder.row - younger.row) : 99;
      if (elder && younger && !alreadyMerged && Math.min(elder.hp, younger.hp) <= 1 && dist <= 3) {
        const moverSub = elder.hp < younger.hp ? 'elder' : 'younger';
        aiTeamExecSkill(room, idx, pi, 'brothers', { target: moverSub });
        scheduleAITurnEnd(room, idx, 3000);
        return;
      }
    }
  }

  // ★ STEP 3: 공격 vs 이동 점수 비교 (dual-blade는 강제 공격)
  let bestAction = null;
  const dualPiece = myAlive.find(pc => pc.dualBladeAttacksLeft > 0);
  if (dualPiece) {
    const dpi = p.pieces.indexOf(dualPiece);
    const sc = aiTeamScoreAttack(room, idx, dualPiece, { toggleState: dualPiece.toggleState });
    bestAction = { type: 'attack', piece: dualPiece, pieceIdx: dpi, score: sc };
  } else {
    for (const piece of myAlive) {
      if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow')) continue;
      const pi = p.pieces.indexOf(piece);
      const extra = { toggleState: piece.toggleState };
      if (piece.type === 'ratMerchant') extra.rats = room.rats[idx];
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
        const bt = aiTeamBestTargetCell(room, idx, piece);
        extra.tCol = bt.col; extra.tRow = bt.row;
      }
      // 공격 점수
      const atkScore = aiTeamScoreAttack(room, idx, piece, extra);
      if (!bestAction || atkScore > bestAction.score) {
        bestAction = { type: 'attack', piece, pieceIdx: pi, score: atkScore, extra };
      }
      // 이동 점수 (4방향 × 0.7 가중)
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        // ★ 룰 통일: 쌍둥이 합류 예외 포함 점유 검사.
        if (!_canMoveTo(room, piece, nc, nr)) continue;
        const moveScore = aiTeamScoreMove(room, idx, piece, nc, nr) * 0.7;
        if (!bestAction || moveScore > bestAction.score) {
          bestAction = { type: 'move', piece, pieceIdx: pi, score: moveScore, col: nc, row: nr };
        }
      }
    }
  }

  if (!bestAction || bestAction.score <= 0) {
    // 안전한 행동 없음 — 랜덤 금지(사용자 요청). 추론된 적 확률질량 쪽으로 결정적 접근.
    //   가능한 모든 (말×4방향) 중 접근 포텐셜이 최대인 이동을 선택. 동점이면 중앙 회귀.
    const brain = getTeamBrain(room, getTeamOf(room, idx));
    const center = (bounds.min + bounds.max) / 2;
    let fb = null;
    for (const piece of myAlive) {
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        if (!_canMoveTo(room, piece, nc, nr)) continue;
        const appr = aiApproachScore(brain, piece.col, piece.row, nc, nr, bounds);
        // 접근 정보가 전무할 때 대비한 중앙 회귀 미세 가산(결정적 tie-break).
        const centerPull = -(Math.abs(nc - center) + Math.abs(nr - center)) * 0.01;
        const sc = appr + centerPull;
        if (!fb || sc > fb.score) {
          fb = { pieceIdx: p.pieces.indexOf(piece), col: nc, row: nr, score: sc };
        }
      }
    }
    if (fb) { aiTeamExecuteMove(room, idx, fb.pieceIdx, fb.col, fb.row); return; }
    // 모든 말이 완전히 막힘(보드축소·아군/유해로 둘러싸임) + 유효 행동 없음 → 종료.
    //   endTurn 이 무행동을 감지해 "⏰ {name}의 턴 스킵" no_action_notice 를 송신한다.
    endTurn(room);
    return;
  }

  if (bestAction.type === 'move') {
    aiTeamExecuteMove(room, idx, bestAction.pieceIdx, bestAction.col, bestAction.row);
  } else {
    aiTeamExecuteAttack(room, idx, bestAction.pieceIdx, bestAction.extra);
  }
}

// ── AI 자동조작(플레이어 대리): 실행 없이 "이번 수 최선 행동"만 결정해 반환 ──────────
//   서버 AI 지능(evac·정찰·도주·공격/이동 점수)을 그대로 재사용. 클라가 이 행동을 정상 인간
//   경로(move_piece/attack/use_skill)로 실행 → 렌더·페이즈·타이밍·검증을 모두 인간 경로가 처리.
//   반환: {type:'move',pieceIdx,col,row} | {type:'attack',pieceIdx[,tCol,tRow]} | {type:'skill',pieceIdx,skillId,params} | {type:'end'} | null
function aiDecideAction(room, idx) {
  if (!room || room.phase !== 'game' || room.currentPlayerIdx !== idx) return null;
  const p = room.players[idx]; if (!p) return null;
  const bounds = room.boardBounds;
  const myAlive = p.pieces.filter(pc => pc.alive);
  if (myAlive.length === 0) return { type: 'end' };
  const teamId = getTeamOf(room, idx);
  const brain = getTeamBrain(room, teamId);
  // 브레인 갱신 (aiTeamTakeTurn 초기화와 동일 — 확률 spread + 위협맵)
  if (brain._lastSpreadTurn !== room.turnNumber) {
    brain._lastSpreadTurn = room.turnNumber; brain.turnCount = (brain.turnCount || 0) + 1;
    aiSpreadProbability(brain);
    let alive = 0; for (const ei of getEnemyIndices(room, idx)) { const ep = room.players[ei]; if (ep && ep.pieces) alive += ep.pieces.filter(x => x.alive).length; }
    brain.enemiesAlive = alive;
    aiClearOwnCells(brain, room, idx);
    brain._dangerMap = aiBuildDangerMap(room, idx, brain); brain._dangerTurn = brain.turnCount;
  }
  // STEP 0: 보드축소 대피
  const evac = aiTeamFindEvacuation(room, idx);
  if (evac) return { type: 'move', pieceIdx: evac.pieceIdx, col: evac.col, row: evac.row };
  // STEP 1: 자유 스킬 (정찰=정보부족 시 / 약초·신성=부상 아군)
  for (let pi = 0; pi < p.pieces.length; pi++) {
    const piece = p.pieces[pi];
    if (!piece.alive || !piece.hasSkill || piece.skillReplacesAction) continue;
    if (p.skillsUsedBeforeAction && p.skillsUsedBeforeAction.includes(`${pi}:${piece.skillId}`)) continue;
    if ((room.sp[teamId] + room.instantSp[teamId]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow')) continue;
    if (piece.skillId === 'recon' && brain.mode === 'scan' && aiMaxProb(brain) < 6) return { type: 'skill', pieceIdx: pi, skillId: 'recon', params: {} };
    if (piece.skillId === 'herb') {
      const wounded = getAllyIndices(room, idx).flatMap(ai => room.players[ai] ? room.players[ai].pieces : []).some(a => a.alive && a !== piece && a.hp < a.maxHp && Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1);
      if (wounded) return { type: 'skill', pieceIdx: pi, skillId: 'herb', params: {} };
    }
  }
  // STEP 1.5: 피격 후 도주 vs 반격 (aiTeamTakeTurn STEP 1.5 동일 — 실행 대신 반환)
  {
    let fleePiece = null, fleeIdx = -1, fleeMem = null, fleeUrg = -1;
    for (let pi = 0; pi < p.pieces.length; pi++) {
      const piece = p.pieces[pi]; if (!piece.alive) continue;
      const mem = brain.hitMemory && brain.hitMemory[piece.type];
      if (!mem || (brain.turnCount - mem.turn) > 2) continue;
      if (Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row) > 1) continue;
      const urg = (piece.maxHp - piece.hp) / piece.maxHp;
      if (urg > fleeUrg) { fleeUrg = urg; fleePiece = piece; fleeIdx = pi; fleeMem = mem; }
    }
    if (fleePiece) {
      const piece = fleePiece, mem = fleeMem;
      const counterExtra = {};
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') { const bt = aiBestTargetCell(brain, piece, room); counterExtra.tCol = bt.col; counterExtra.tRow = bt.row; }
      if (piece.toggleState) counterExtra.toggleState = piece.toggleState;
      const counterScore = aiTeamScoreAttack(room, idx, piece, counterExtra);
      let bestMove = null, bestFleeScore = -1;
      for (const d of [[0,-1],[0,1],[-1,0],[1,0]]) { const nc = piece.col + d[0], nr = piece.row + d[1]; if (!inBounds(nc, nr, bounds) || !_canMoveTo(room, piece, nc, nr)) continue; const fs = (Math.abs(nc - mem.col) + Math.abs(nr - mem.row)) * 15 + aiTeamScoreMove(room, idx, piece, nc, nr); if (fs > bestFleeScore) { bestFleeScore = fs; bestMove = { col: nc, row: nr }; } }
      const criticalHp = piece.hp <= 2; let sureHit = false, canHitProb = false;
      for (const c of getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState })) { const v = brain.probMap[c.row] ? (brain.probMap[c.row][c.col] || 0) : 0; if (v >= 9) sureHit = true; if (v >= 6) canHitProb = true; }
      const shouldCounter = sureHit || (!criticalHp && (canHitProb || (counterScore > bestFleeScore * 1.05 && counterScore > 4)));
      if (shouldCounter) { const a = { type: 'attack', pieceIdx: fleeIdx }; if (typeof counterExtra.tCol === 'number') { a.tCol = counterExtra.tCol; a.tRow = counterExtra.tRow; } return a; }
      if (bestMove) return { type: 'move', pieceIdx: fleeIdx, col: bestMove.col, row: bestMove.row };
    }
  }
  // STEP 3: 공격 vs 이동 점수 (aiTeamTakeTurn STEP 3 동일)
  let bestAction = null;
  const dualPiece = myAlive.find(pc => pc.dualBladeAttacksLeft > 0);
  if (dualPiece) { const dpi = p.pieces.indexOf(dualPiece); bestAction = { type: 'attack', pieceIdx: dpi, score: aiTeamScoreAttack(room, idx, dualPiece, { toggleState: dualPiece.toggleState }), extra: { toggleState: dualPiece.toggleState } }; }
  else {
    for (const piece of myAlive) {
      if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow')) continue;
      const pi = p.pieces.indexOf(piece); const extra = { toggleState: piece.toggleState };
      if (piece.type === 'ratMerchant') extra.rats = room.rats[idx];
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') { const bt = aiTeamBestTargetCell(room, idx, piece); extra.tCol = bt.col; extra.tRow = bt.row; }
      const atkScore = aiTeamScoreAttack(room, idx, piece, extra);
      if (!bestAction || atkScore > bestAction.score) bestAction = { type: 'attack', pieceIdx: pi, score: atkScore, extra };
      for (const d of [[0,-1],[0,1],[-1,0],[1,0]]) { const nc = piece.col + d[0], nr = piece.row + d[1]; if (!inBounds(nc, nr, bounds) || !_canMoveTo(room, piece, nc, nr)) continue; const ms = aiTeamScoreMove(room, idx, piece, nc, nr) * 0.7; if (!bestAction || ms > bestAction.score) bestAction = { type: 'move', pieceIdx: pi, score: ms, col: nc, row: nr }; }
    }
  }
  if (!bestAction || bestAction.score <= 0) {
    const center = (bounds.min + bounds.max) / 2; let fb = null;
    for (const piece of myAlive) for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) { const nc = piece.col + d[0], nr = piece.row + d[1]; if (!inBounds(nc, nr, bounds) || !_canMoveTo(room, piece, nc, nr)) continue; const sc = aiApproachScore(brain, piece.col, piece.row, nc, nr, bounds) - (Math.abs(nc - center) + Math.abs(nr - center)) * 0.01; if (!fb || sc > fb.score) fb = { pieceIdx: p.pieces.indexOf(piece), col: nc, row: nr, score: sc }; }
    if (fb) return { type: 'move', pieceIdx: fb.pieceIdx, col: fb.col, row: fb.row };
    return { type: 'end' };
  }
  if (bestAction.type === 'move') return { type: 'move', pieceIdx: bestAction.pieceIdx, col: bestAction.col, row: bestAction.row };
  const a = { type: 'attack', pieceIdx: bestAction.pieceIdx };
  if (bestAction.extra && typeof bestAction.extra.tCol === 'number') { a.tCol = bestAction.extra.tCol; a.tRow = bestAction.extra.tRow; }
  return a;
}

// 팀전 AI 이동 실행 — 1v1 aiExecuteMove의 팀모드판
function aiTeamExecuteMove(room, idx, pieceIdx, nc, nr) {
  const p = room.players[idx];
  const piece = p.pieces[pieceIdx];
  if (!piece || !piece.alive) { endTurn(room); return; }
  const prevCol = piece.col, prevRow = piece.row;
  piece.col = nc; piece.row = nr;
  p._lastActionType = 'move';
  // 트랩 체크 (적팀의 트랩만) — ★ 그림자 숨기 면역
  // ★ 사용자 요청: 이동 → 트랩 순차 처리. 트랩 데이터만 저장하고 emit/효과는 setTimeout 후.
  const isShadowedTeamAI = piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow');
  let teamAiTrapPending = null;
  for (const eIdx of (isShadowedTeamAI ? [] : getEnemyIndices(room, idx))) {
    const arr = room.boardObjects[eIdx] || [];
    const ti = arr.findIndex(o => o.type === 'trap' && o.col === nc && o.row === nr);
    if (ti >= 0) {
      teamAiTrapPending = { trapOwnerIdx: eIdx, col: nc, row: nr };
      break;
    }
  }
  p.actionDone = true;
  // 같은 팀에게 이동 알림 (팀원 애니메이션)
  for (const tIdx of getTeammates(room, idx)) {
    const tp = room.players[tIdx];
    if (tp && tp.socketId && tp.socketId !== 'AI') {
      io.to(tp.socketId).emit('team_ally_moved', {
        moverName: p.name, pieceType: piece.type, pieceIcon: piece.icon, pieceName: piece.name,
        subUnit: piece.subUnit, prevCol, prevRow, col: nc, row: nr,
      });
    }
  }
  // 적팀에게도 1v1처럼 이동 알림 (토스트/로그)
  const isMarked = (piece.statusEffects || []).some(e => e.type === 'mark');
  for (const enIdx of getEnemyIndices(room, idx)) {
    const en = room.players[enIdx];
    if (en && en.socketId && en.socketId !== 'AI') {
      io.to(en.socketId).emit('opp_moved', {
        msg: isMarked
          ? `${p.name}의 표식된 ${piece.name}${조사(piece.name, '이', '가')} 이동했습니다.`
          : `${p.name}${조사(p.name, '이', '가')} 이동했습니다.`,
        prevCol: isMarked ? prevCol : undefined,
        prevRow: isMarked ? prevRow : undefined,
        col: isMarked ? nc : undefined,
        row: isMarked ? nr : undefined,
      });
    }
  }
  // Sprint 카운트 처리 — 첫 이동 후 messengerMovesLeft 감소
  if (piece.alive && piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
    piece.messengerMovesLeft--;
    if (piece.messengerMovesLeft <= 0) piece.messengerSprintActive = false;
  }
  // ★ FIX (관전자 이동 모션): 팀 AI 이동 — broadcast(상태 동기화) 전에 슬라이드 애니용 좌표 전송.
  emitToSpectators(room, 'spectator_move_anim', { prevCol, prevRow, col: nc, row: nr, pieceType: piece.type, pieceSubUnit: piece.subUnit || null, owner: idx });
  // 트랩 보류 시 broadcast 도 지연 — 이동 직후엔 piece 가 alive=true 인 상태로 보드에 노출.
  if (!teamAiTrapPending) broadcastTeamGameState(room);

  // 트랩 발동 — 이동 emit 후 700ms 지연
  const _continueAfterTrap = () => {
    // 후속 sprint 이동 가능 — 3초 후 aiTeamTakeTurn 재진입 (다음 최적 이동 계산)
    if (piece.alive && piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === idx) {
          aiTeamTakeTurn(room, idx);
        }
      }, 3000);
      return;
    }
    scheduleAITurnEnd(room, idx, 3000);
  };

  if (teamAiTrapPending) {
    room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, Date.now() + 1500);
    const tp = teamAiTrapPending;
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') { _continueAfterTrap(); return; }
      const trapArr = room.boardObjects[tp.trapOwnerIdx] || [];
      const ti2 = trapArr.findIndex(o => o.type === 'trap' && o.col === tp.col && o.row === tp.row);
      if (ti2 < 0) { _continueAfterTrap(); return; }
      trapArr.splice(ti2, 1);
      const aiPiece2 = (p.pieces || []).find(pp => pp.alive && pp.col === tp.col && pp.row === tp.row);
      if (!aiPiece2) { _continueAfterTrap(); return; }
      // ★ 패시브 dedupe Set 초기화 (이전 attack 잔재 방지) — 새 damage 이벤트.
      room._attackPassivesFired = new Set();
      room._pendingBodyguardPassive = null;
      const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: tp.col, row: tp.row }, aiPiece2, tp.trapOwnerIdx, 2, false, idx);
      aiPiece2.hp = Math.max(0, aiPiece2.hp - dmg);
      if (aiPiece2.type === 'wizard' && dmg > 0) {
        const wizSpSlot = teamSlotIdx(room, idx);
        room.instantSp[wizSpSlot] += 1;
        emitSPUpdate(room);
        emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: idx, msg: `인스턴트 매직 : SP 획득` });
        emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: idx });
      }
      const willDie = aiPiece2.hp <= 0;
      if (willDie) handleDeath(room, aiPiece2, idx);
      emitToBoth(room, 'trap_triggered', {
        col: tp.col, row: tp.row,
        pieceInfo: { type: aiPiece2.type, name: aiPiece2.name, icon: aiPiece2.icon },
        damage: dmg,
        destroyed: willDie,
        newHp: aiPiece2.hp,
        victimOwnerIdx: idx,
        trapOwnerIdx: tp.trapOwnerIdx,  // 덫 설치자 (사냥꾼 owner)
      });
      broadcastTeamGameState(room);
      _continueAfterTrap();
    }, 700);
  } else {
    _continueAfterTrap();
  }
}

// ── 표식 적 공격 모션 공유용 — 공격자 piece 의 셀/타입/방향 정보 패키징 ──
//   표식 부여자(고문기술자 소유자) 클라이언트가 animateAttackGif 로 공격자 캐릭터의
//   공격 모션을 재생할 수 있게 함. 표식 적은 보드에 렌더되므로 모션도 보여야 자연스러움.
//   isJoined: 합류 쌍둥이 여부 (같은 칸에 살아있는 다른 쌍둥이 존재).
function markedAttackerMotion(piece, ownerPieces) {
  if (!piece) return null;
  let isJoined = false;
  if (piece.subUnit === 'elder' || piece.subUnit === 'younger') {
    isJoined = (ownerPieces || []).some(q =>
      q !== piece && q.alive && (q.subUnit === 'elder' || q.subUnit === 'younger') &&
      q.col === piece.col && q.row === piece.row);
  }
  return { col: piece.col, row: piece.row, type: piece.type, subUnit: piece.subUnit || null, isJoined };
}

// AI 공격 헬퍼 — processAttack을 직접 호출 (extra: shadowAssassin/witch의 tCol/tRow + ratMerchant rats)
function aiTeamExecuteAttack(room, idx, pieceIdx, extra) {
  const p = room.players[idx];
  const piece = p.pieces[pieceIdx];
  if (!piece || !piece.alive) { endTurn(room); return; }
  const bounds = room.boardBounds;
  const atkExtra = extra || { toggleState: piece.toggleState };
  if (!atkExtra.rats && piece.type === 'ratMerchant') atkExtra.rats = room.rats[idx];
  const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, atkExtra);
  // ★ FIX (팀 AI 공격 페이즈 누락 — 1v1 통일): 사망 기폭/표식 페이즈 시작. 이게 없어 표식이 적용
  //   안 되고(flushMarkPhase 미호출), 화약상 사망 시 폭탄이 연출 페이즈 없이 즉시 폭발했었음.
  startPhase(room);
  const hitResults = processAttack(room, idx, piece, atkCells, undefined, { suppressSpUpdate: true });
  // ★ 팀 브레인 학습 — AI 공격은 socket 을 안 타므로 여기서 직접 호출(끝없는 정보 누적).
  //   내 hit/miss → 적 확률맵 갱신. (피격당한 적팀이 AI 라면 역추론도 함께 처리됨.)
  aiTeamLearnFromAttack(room, idx, atkCells, hitResults);
  p.actionDone = true;
  // 사용자 요청: 학살영웅 / 쥐 격파 등 임팩트 발생 시 빗나감 토스트 X.
  const _atkOwnRats = (room._attackerOwnRatsDestroyedCount || 0);
  const _atkFf = (room._attackerFriendlyFireCount || 0);
  const attackerImpactedAnything = hitResults.length > 0 || _atkOwnRats > 0 || _atkFf > 0;
  // 모든 인간에게 결과 브로드캐스트 (broadcastTeamGameState로 자연스럽게 갱신됨)
  // 피격된 각 적 플레이어에게 being_attacked
  const defenderHitsByOwner = new Map();
  for (const h of hitResults) {
    if (h.defOwnerIdx === undefined) continue;
    if (!defenderHitsByOwner.has(h.defOwnerIdx)) defenderHitsByOwner.set(h.defOwnerIdx, []);
    defenderHitsByOwner.get(h.defOwnerIdx).push(h);
  }
  for (const [ownerIdx, hits] of defenderHitsByOwner.entries()) {
    const defPlayer = room.players[ownerIdx];
    if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
    io.to(defPlayer.socketId).emit('being_attacked', {
      atkCells,
      attackerImpactedAnything,
      friendlyFireHits: room._friendlyFireHits || [],   // ★ #6 적(AI 공격자) 오사 피해 실시간 공유
      hitPieces: hits.map(h => {
        // ★ 합류 쌍둥이 버그 수정: col/row 기반 find 는 같은 칸의 첫 매치(누나)만 반환 → 동생 hit 도 누나 이름/도장으로 잘못 매핑.
        //   대신 defPieceIdx 로 정확히 해당 piece 를 찾고, 클라에 defPieceIdx 도 함께 전달.
        const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
        return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          name: dp?.name, icon: dp?.icon,
          defPieceIdx: h.defPieceIdx,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false };
      }),
      yourPieces: pieceSummary(defPlayer.pieces),
    });
  }
  // 적팀 멤버 중 hits 안 받은 자에게도 attackerImpactedAnything 알림 (빗나감 억제용)
  if (attackerImpactedAnything) {
    const enemyIdxs = getEnemyIndices(room, idx);
    for (const enIdx of enemyIdxs) {
      if (defenderHitsByOwner.has(enIdx)) continue;
      const en = room.players[enIdx];
      if (!en || !en.socketId || en.socketId === 'AI') continue;
      io.to(en.socketId).emit('being_attacked', {
        atkCells, attackerImpactedAnything,
        hitPieces: [],
        friendlyFireHits: room._friendlyFireHits || [],   // ★ #6 적 오사 피해 실시간 공유
        yourPieces: pieceSummary(en.pieces),
      });
    }
  }
  // ★ FIX (AI 동료 공격 알림 누락): 인간 공격(server 9836)은 team_ally_attacked 를 보내 동료가
  //   공격 모션·데미지 도장·자동 추리토큰을 받지만, AI 공격(이 함수)엔 이게 빠져 있어 — 2v2 에서
  //   동료가 AI 면 그 공격에 대한 정보를 인간이 전혀 못 받았음. 인간 공격과 동일하게 시전자(AI)의
  //   ally 에게 team_ally_attacked emit. (room._friendlyFireHits 리셋 전이라 오사 정보도 포함.)
  {
    const casterAllyIdxs = getAllyIndices(room, idx).filter(i => i !== idx);
    if (casterAllyIdxs.length > 0) {
      const _attackedPayload = {
        casterIdx: idx,
        casterName: p.name,
        atkPieceType: piece.type,
        atkPieceIcon: piece.icon,
        atkPieceName: piece.name,
        atkCol: piece.col, atkRow: piece.row, atkPieceSubUnit: piece.subUnit || null,
        atkCells,
        attackerImpactedAnything,
        hits: hitResults.map(h => ({
          col: h.col, row: h.row, damage: h.damage, destroyed: h.destroyed,
          defOwnerIdx: h.defOwnerIdx, defPieceIdx: h.defPieceIdx,
          hitName: h.hitName, hitIcon: h.hitIcon,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false,
        })),
        friendlyFireHits: (room._friendlyFireHits || []).map(ff => ({
          col: ff.col, row: ff.row, damage: ff.damage, destroyed: ff.destroyed,
          defOwnerIdx: ff.ownerIdx, defPieceIdx: ff.defPieceIdx,
        })),
      };
      for (const aIdx of casterAllyIdxs) {
        const ally = room.players[aIdx];
        if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
        io.to(ally.socketId).emit('team_ally_attacked', _attackedPayload);
      }
    }
  }
  room._attackerFriendlyFireCount = 0;
  room._attackerOwnRatsDestroyedCount = 0;
  room._friendlyFireHits = [];
  // 같은 팀에게 team_ally_hit — payload 는 victim 당 1회 빌드 후 ally 들에게 재사용
  for (const [defOwnerIdx, hits] of defenderHitsByOwner.entries()) {
    const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
    if (allyIdxs.length === 0) continue;
    const defPieces = room.players[defOwnerIdx].pieces;
    const _hitPieces = hits.map(h => {
      // ★ 합류 쌍둥이 버그 수정 — 동일.
      const dp = (typeof h.defPieceIdx === 'number') ? defPieces[h.defPieceIdx] : null;
      return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
        name: dp?.name, icon: dp?.icon,
        defPieceIdx: h.defPieceIdx,
        redirectedToBodyguard: h.redirectedToBodyguard || false,
        bodyguardRedirect: h.bodyguardRedirect || false };
    });
    const _payload = {
      atkCells,
      victimIdx: defOwnerIdx,
      victimName: room.players[defOwnerIdx].name,
      hitPieces: _hitPieces,
    };
    for (const allyIdx of allyIdxs) {
      const ally = room.players[allyIdx];
      if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
      io.to(ally.socketId).emit('team_ally_hit', _payload);
    }
  }
  // ★ 관전자 일반 공격 애니메이션 — 팀모드. defOwnerIdx 포함 hits.
  emitToSpectators(room, 'spectator_attack_anim', {
    atkCells,
    atkCol: piece.col, atkRow: piece.row, atkType: piece.type, atkSubUnit: piece.subUnit || null,  // ★ 관전자 공격 모션
    hits: hitResults.map(h => ({
      col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
      defPieceIdx: h.defPieceIdx,
      defOwnerIdx: h.defOwnerIdx,
      redirectedToBodyguard: h.redirectedToBodyguard || false,
      bodyguardRedirect: h.bodyguardRedirect || false,
    })),
  });

  emitToSpectators(room, 'spectator_log', {
    msg: hitResults.length > 0
      ? `${p.name}의 공격 명중!`
      : `${p.name} 공격 빗나감`,
    type: 'hit', playerIdx: idx,
  });
  // ★ 표식 공격 모션 공유 — AI 팀전 공격 경로
  const _markEffectAiTeam = (piece.statusEffects || []).find(e => e.type === 'mark');
  if (_markEffectAiTeam && typeof _markEffectAiTeam.source === 'number') {
    const _moIdx = _markEffectAiTeam.source;
    // ★ 표식 부여자 팀 전체에 공유 (같은 편이면 표식 적 위치를 알므로 공격 모션도 봄)
    const _viewers = (room.mode === 'team') ? getAllyIndices(room, _moIdx) : [_moIdx];
    const _mePayload = {
      atkCells,
      hitCells: hitResults.map(h => ({ col: h.col, row: h.row, damage: h.damage, destroyed: h.destroyed })),
      attacker: markedAttackerMotion(piece, p.pieces),
    };
    for (const _vIdx of _viewers) {
      if (_vIdx === idx) continue;
      const _v = room.players[_vIdx];
      if (_v && _v.socketId && _v.socketId !== 'AI') io.to(_v.socketId).emit('marked_enemy_attack', _mePayload);
    }
  }
  // 전체 상태 동기화
  broadcastTeamGameState(room);
  // ★ 공격 처리 완료 — suppressed SP 업데이트 emit
  emitSPUpdate(room);
  // ★ FIX (팀 AI 공격 페이즈 — 1v1 통일): 표식 적용(flushMarkPhase) + 사망 기폭 체인 연출 + 게임종료
  //   판정을 페이즈 종료까지 지연. (인간 팀 공격 핸들러 9921 과 동일.)
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') checkGameEndAfterPhase(room);
  });
  // 쌍검무 — 두 번째 공격 (1v1과 동일하게 4초 딜레이)
  if (piece.dualBladeAttacksLeft > 0 && piece.alive) {
    const DUAL_BLADE_DELAY = 4000;
    setTimeout(() => {
      if (room.phase !== 'game' || room.currentPlayerIdx !== idx) return;
      if (!piece.alive) { setTimeout(() => endTurn(room), 100); return; }
      piece.dualBladeAttacksLeft--;
      const extra2Cells = getAttackCells(piece.type, piece.col, piece.row, bounds, atkExtra);
      startPhase(room);  // ★ FIX (팀 AI 쌍검무 2타 페이즈): 표식/사망 기폭 페이즈 (1v1 통일)
      const extra2Hits = processAttack(room, idx, piece, extra2Cells);
      // 두 번째 공격 결과 emit
      const hitsByOwner2 = new Map();
      for (const h of extra2Hits) {
        if (h.defOwnerIdx === undefined) continue;
        if (!hitsByOwner2.has(h.defOwnerIdx)) hitsByOwner2.set(h.defOwnerIdx, []);
        hitsByOwner2.get(h.defOwnerIdx).push(h);
      }
      for (const [ownerIdx, hits] of hitsByOwner2.entries()) {
        const defPlayer = room.players[ownerIdx];
        if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
        io.to(defPlayer.socketId).emit('being_attacked', {
          atkCells: extra2Cells,
          hitPieces: hits.map(h => {
            const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
            return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx };
          }),
          yourPieces: pieceSummary(defPlayer.pieces),
        });
      }
      for (const [defOwnerIdx, hits] of hitsByOwner2.entries()) {
        const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
        if (allyIdxs.length === 0) continue;
        const defPieces2 = room.players[defOwnerIdx].pieces;
        const _hitPieces2 = hits.map(h => {
          const dp = (typeof h.defPieceIdx === 'number') ? defPieces2[h.defPieceIdx] : null;
          return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            name: dp?.name, icon: dp?.icon,
            defPieceIdx: h.defPieceIdx,
            redirectedToBodyguard: h.redirectedToBodyguard || false };
        });
        const _payload2 = {
          atkCells: extra2Cells,
          victimIdx: defOwnerIdx,
          victimName: room.players[defOwnerIdx].name,
          hitPieces: _hitPieces2,
        };
        for (const allyIdx of allyIdxs) {
          const ally = room.players[allyIdx];
          if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
          io.to(ally.socketId).emit('team_ally_hit', _payload2);
        }
      }
      // ★ 관전자 — 쌍검무 두 번째 공격 애니
      emitToSpectators(room, 'spectator_attack_anim', {
        atkCells: extra2Cells,
        atkCol: piece.col, atkRow: piece.row, atkType: piece.type, atkSubUnit: piece.subUnit || null,  // ★ 관전자 공격 모션
        hits: extra2Hits.map(h => ({
          col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          defPieceIdx: h.defPieceIdx, defOwnerIdx: h.defOwnerIdx,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false,
        })),
      });
      broadcastTeamGameState(room);
      // ★ FIX (팀 AI 쌍검무 2타 페이즈): 표식 적용 + 사망 기폭 + 게임종료 판정 지연.
      flushPhase(room, () => {
        if (rooms[room.id] && room.phase === 'game') checkGameEndAfterPhase(room);
      });
      scheduleAITurnEnd(room, idx, 3000);
    }, DUAL_BLADE_DELAY);
    return;
  }
  scheduleAITurnEnd(room, idx, 3000);
}

function teamDraftTimeout(room) {
  if (room.phase !== 'team_draft') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_draft' });
  for (let i = 0; i < room.playerCount; i++) {
    if (room.draftDone[i]) continue;
    const p = room.players[i];
    if (!p.draft) p.draft = { pick1: null, pick2: null };
    const teammates = getTeammates(room, i);
    const forbidden = new Set();
    for (const tIdx of teammates) {
      const tmDraft = room.players[tIdx]?.draft || {};
      if (tmDraft.pick1) forbidden.add(tmDraft.pick1);
      if (tmDraft.pick2) forbidden.add(tmDraft.pick2);
    }
    const available = ALL_CHARS.map(c => c.type).filter(t => !forbidden.has(t));
    if (!p.draft.pick1) {
      const pool = available.filter(t => t !== p.draft.pick2);
      p.draft.pick1 = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!p.draft.pick2) {
      const pool = available.filter(t => t !== p.draft.pick1);
      p.draft.pick2 = pool[Math.floor(Math.random() * pool.length)];
    }
    room.draftDone[i] = true;
  }
  transitionToTeamHp(room);
}

function transitionToTeamHp(room) {
  clearTimer(room);
  room.phase = 'team_hp';
  room.hpDone = Array(room.playerCount).fill(false);
  // 각 플레이어에게 HP 분배 페이즈 알림 (팀원 draft도 포함)
  for (const p of room.players) {
    if (!p.socketId) continue;
    const hasTwins = p.draft?.pick1 === 'twins' || p.draft?.pick2 === 'twins';
    // 팀원 draft 정보 (팀 내 다른 멤버)
    const teammateDraft = room.teams[p.teamId]
      .filter(i => i !== p.index)
      .map(i => ({ idx: i, name: room.players[i].name, draft: room.players[i].draft }))[0] || null;
    io.to(p.socketId).emit('team_hp_phase', {
      draft: p.draft,
      hasTwins,
      teammateDraft: teammateDraft ? teammateDraft.draft : null,
    });
  }
  startTimer(room, 'team_hp', () => teamHpTimeout(room));
  // AI 봇 자동 분배
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 1500 + Math.random() * 1500;
      setTimeout(() => aiTeamHpDistribute(room, p.index), delay);
    }
  }
}

function teamHpTimeout(room) {
  if (room.phase !== 'team_hp') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_hp' });
  // 미완료 플레이어: 균등 분할 (10을 반반 = 5/5, 쌍둥이면 2/4/4 등)
  for (let i = 0; i < room.playerCount; i++) {
    if (room.hpDone[i]) continue;
    const p = room.players[i];
    if (!p.draft?.pick1 || !p.draft?.pick2) continue;
    const hasTwins = p.draft.pick1 === 'twins' || p.draft.pick2 === 'twins';
    if (hasTwins) {
      // 쌍둥이: 슬롯1=쌍둥이 4 (형2/동생2), 슬롯2=6
      const twinSlot = p.draft.pick1 === 'twins' ? 'pick1' : 'pick2';
      const otherSlot = twinSlot === 'pick1' ? 'pick2' : 'pick1';
      p.hpDist = {
        [twinSlot]: 4,
        [otherSlot]: 6,
        twinElder: 2, twinYounger: 2,
      };
      p.pieces = buildTeamPieces(p.draft, p.hpDist);
    } else {
      p.hpDist = { pick1: 5, pick2: 5 };
      p.pieces = buildTeamPieces(p.draft, p.hpDist);
    }
    room.hpDone[i] = true;
  }
  transitionToTeamReveal(room);
}

// 팀전 pieces 빌더 — 티어 구분 없이 2개 캐릭터 생성
function buildTeamPieces(draft, hpDist) {
  const pieces = [];
  for (const slot of ['pick1', 'pick2']) {
    const type = draft[slot];
    if (!type) continue;
    const charDef = ALL_CHARS.find(c => c.type === type);
    const tier = charDef?.tier || 1;
    if (type === 'twins') {
      const elderHp = hpDist.twinElder || 1;
      const youngerHp = hpDist.twinYounger || 1;
      const elder = createPiece('twins', tier, elderHp, { subUnit: 'elder', parentType: 'twins' });
      elder.type = 'twins_elder';
      const younger = createPiece('twins', tier, youngerHp, { subUnit: 'younger', parentType: 'twins' });
      younger.type = 'twins_younger';
      pieces.push(elder, younger);
    } else {
      pieces.push(createPiece(type, tier, hpDist[slot] || 1));
    }
  }
  return pieces;
}

function transitionToTeamReveal(room) {
  clearTimer(room);
  room.phase = 'team_reveal';
  room.revealDone = Array(room.playerCount).fill(false);
  // AI 봇은 즉시 자동 확인
  for (const p of room.players) {
    if (p.socketId === 'AI') room.revealDone[p.index] = true;
  }
  // 4명의 모든 pieces를 전체 공개
  const allPlayerPieces = room.players.map(p => ({
    idx: p.index,
    name: p.name,
    teamId: p.teamId,
    pieces: pieceSummary(p.pieces),
  }));
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_reveal_phase', {
      myIdx: p.index,
      teamId: p.teamId,
      teams: room.teams,
      allPlayerPieces,
    });
  }
  startTimer(room, 'team_reveal', () => teamRevealTimeout(room));
  // 모두 봇이면 즉시 다음 페이즈로 (이론상 가능)
  if (room.revealDone.every(d => d)) {
    setTimeout(() => {
      if (room.phase === 'team_reveal') transitionToTeamPlacement(room);
    }, 3000);
  }
}

function teamRevealTimeout(room) {
  if (room.phase !== 'team_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_reveal' });
  transitionToTeamPlacement(room);
}

function transitionToTeamPlacement(room) {
  clearTimer(room);
  room.phase = 'team_placement';
  room.placementDone = Array(room.playerCount).fill(false);
  // 모든 pieces를 미배치 상태로 리셋 (col=-1, row=-1)
  for (const p of room.players) {
    for (const pc of p.pieces) {
      pc.col = -1; pc.row = -1;
    }
  }
  for (const p of room.players) {
    if (!p.socketId) continue;
    // 1v1과 동일하게 상대팀 양 플레이어의 full piece 정보(스킬·패시브 포함) 제공
    const oppTeamId = 1 - p.teamId;
    const opponents = (room.teams[oppTeamId] || []).map(i => ({
      idx: i,
      name: room.players[i].name,
      pieces: room.players[i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      })),
    }));
    io.to(p.socketId).emit('team_placement_phase', {
      myIdx: p.index,
      teamId: p.teamId,
      teams: room.teams,
      boardBounds: room.boardBounds,
      zone: getTeamPlacementZone(p.teamId),
      myPieces: pieceSummary(p.pieces),
      teammates: getTeammates(room, p.index).map(i => ({
        idx: i,
        name: room.players[i].name,
        pieces: pieceSummary(room.players[i].pieces),
      })),
      opponents,
    });
  }
  startTimer(room, 'team_placement', () => teamPlacementTimeout(room));
  // AI 봇 자동 배치 — 즉시 (사용자 요청: 내가 배치할 때까지 기다리지 말 것)
  for (const p of room.players) {
    if (p.socketId === 'AI') {
      const delay = 300 + Math.random() * 400;
      setTimeout(() => aiTeamPlace(room, p.index), delay);
    }
  }
}

// 팀 배치 구역
function getTeamPlacementZone(teamId) {
  if (teamId === 0) return { rowMin: 0, rowMax: 2 };  // A팀 상단
  return { rowMin: 4, rowMax: 6 };                    // B팀 하단
}

// 팀 배치 상태를 팀원에게 브로드캐스트
function broadcastTeamPlacementUpdate(room, changedIdx) {
  if (!room || room.mode !== 'team') return;
  const teamId = room.players[changedIdx]?.teamId;
  if (teamId === undefined || teamId === null) return;
  const teamMembers = room.teams[teamId] || [];
  // 팀 내 모두에게 팀 전체 pieces 상태 전송
  const teamPieces = teamMembers.map(i => ({
    idx: i,
    name: room.players[i].name,
    pieces: pieceSummary(room.players[i].pieces),
  }));
  for (const tIdx of teamMembers) {
    const tp = room.players[tIdx];
    if (!tp || !tp.socketId) continue;
    io.to(tp.socketId).emit('team_placement_update', { teamPieces });
  }
}

function teamPlacementTimeout(room) {
  if (room.phase !== 'team_placement') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'team_placement' });
  // 미배치 유닛은 자동 배치 (팀 구역 내 빈 칸)
  for (let i = 0; i < room.playerCount; i++) {
    if (room.placementDone[i]) continue;
    const p = room.players[i];
    const zone = getTeamPlacementZone(p.teamId);
    // 팀 내 점유된 칸 수집
    const occupied = new Set();
    for (const tIdx of room.teams[p.teamId]) {
      for (const pc of room.players[tIdx].pieces) {
        if (pc.col >= 0 && pc.row >= 0) occupied.add(`${pc.col},${pc.row}`);
      }
    }
    // 미배치 pieces 순회하며 빈 칸에 자동 배치
    for (const pc of p.pieces) {
      if (pc.col >= 0) continue;
      for (let r = zone.rowMin; r <= zone.rowMax; r++) {
        let placed = false;
        for (let c = room.boardBounds.min; c <= room.boardBounds.max; c++) {
          const key = `${c},${r}`;
          if (!occupied.has(key)) {
            pc.col = c; pc.row = r;
            occupied.add(key);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    room.placementDone[i] = true;
  }
  startTeamGameFromRoom(room);
}

// 팀전 게임 시작 — A1 먼저
function startTeamGameFromRoom(room) {
  clearTimer(room);
  room.phase = 'game';
  // ── 슬롯 정규화: 각 팀이 정확히 slotPos 0/1 한 명씩 갖도록 강제 ──
  // 기존 slotPos 가 명시되어 있으면 그 값을 우선 보존 (봇 추가 시 명시적 slotPos 가 join 순서와 다를 수 있음)
  // 정렬 후 인덱스로 재정규화 — 충돌·결손이 있을 때만 변경됨
  for (let teamId = 0; teamId < 2; teamId++) {
    const teamMembers = room.teams[teamId] || [];
    // 1) 기존 slotPos 기준으로 팀 배열 정렬 (없거나 동일하면 join 순서 유지)
    teamMembers.sort((a, b) => {
      const pa = room.players[a]?.slotPos;
      const pb = room.players[b]?.slotPos;
      const na = (pa == null) ? 99 : pa;
      const nb = (pb == null) ? 99 : pb;
      if (na !== nb) return na - nb;
      return a - b;
    });
    // 2) 정렬된 순서로 slotPos 재할당 (충돌·결손 자동 보정)
    teamMembers.forEach((idx, slotIdx) => {
      const p = room.players[idx];
      if (p) p.slotPos = slotIdx;  // 0 or 1
    });
  }
  // 선공 무작위 — 팀 / 팀 내 슬롯 모두 랜덤 (사용자 요청: 항상 블루팀이 먼저 X)
  const startTeam = Math.random() < 0.5 ? 0 : 1;
  const startTeamMembers = (room.teams[startTeam] || []);
  const startSlot = startTeamMembers.length > 0 ? Math.floor(Math.random() * startTeamMembers.length) : 0;
  room.currentPlayerIdx = startTeamMembers[startSlot] ?? 0;
  room.turnNumber = 1;
  // turnSlotIdx 초기화 — 4슬롯 순환의 시작점
  const firstPlayer = room.players[room.currentPlayerIdx];
  room.turnSlotIdx = getSlotIdxOfPlayer(firstPlayer, room);
  // 팀 내부 round-robin 인덱스 — 시작팀의 다음 멤버, 반대팀은 0번부터
  const otherTeam = 1 - startTeam;
  room.teamRotationIdx = [];
  room.teamRotationIdx[startTeam] = (startSlot + 1) % Math.max(startTeamMembers.length, 1);
  room.teamRotationIdx[otherTeam] = 0;
  // 첫 플레이어 턴 리셋
  const first = room.players[room.currentPlayerIdx];
  if (first) {
    first.actionDone = false;
    first.actionUsedSkillReplace = false;
    first.skillsUsedBeforeAction = [];
    first.twinMovedSubs = [];
  }
  // 초기 게임 상태 브로드캐스트 — 팀별 base state 1회 빌드 후 viewer 별 override
  {
    const byTeam = _buildTeamBaseStates(room);
    for (const p of room.players) {
      if (!p.socketId) continue;
      const base = byTeam[p.teamId];
      if (!base) continue;
      io.to(p.socketId).emit('team_game_start', {
        ...base,
        myIdx: p.index,
        isMyTurn: room.currentPlayerIdx === p.index,
        teams: room.teams,
      });
    }
  }
  // 관전자 (Phase 5에서 보강)
  emitToSpectators(room, 'spectator_log', { msg: `전투 개시. 선공은${first?.name || '?'}`, type: 'event' });
  // 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));
  // 첫 플레이어가 AI라면 자동으로 턴 시작
  if (first && first.socketId === 'AI') {
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === first.index) {
        aiTeamTakeTurn(room, first.index);
      }
    }, 3000);
  }
}

// ── 초기 공개: 드래프트 직후, 상대 캐릭터 타입 공개 ──
function transitionToInitialReveal(room) {
  clearTimer(room);
  room.phase = 'initial_reveal';
  if (room.isAI) {
    room.initialRevealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppDraft = room.players[1 - i].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      io.to(p.socketId).emit('initial_reveal_phase', {
        myDraft: p.draft,
        oppChars,
        myDeckName: p.deckName || '',
        oppDeckName: room.players[1 - i].deckName || '',
        myName: p.name,
        oppName: room.players[1 - i].name,
      });
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'initial_reveal',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'initial_reveal', () => initialRevealTimeout(room));
}

function initialRevealTimeout(room) {
  if (room.phase !== 'initial_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'initial_reveal' });
  for (let i = 0; i < 2; i++) {
    if (!room.initialRevealDone[i]) room.initialRevealDone[i] = true;
  }
  transitionToExchangeDraft(room);
}

// 덱 유효성 검사 (무효하면 랜덤)
function validateDeck(deck) {
  if (!deck || !deck.t1 || !deck.t2 || !deck.t3) {
    return { t1: randomPick(CHARACTERS[1]).type, t2: randomPick(CHARACTERS[2]).type, t3: randomPick(CHARACTERS[3]).type };
  }
  const t1 = CHARACTERS[1].find(c => c.type === deck.t1) ? deck.t1 : randomPick(CHARACTERS[1]).type;
  const t2 = CHARACTERS[2].find(c => c.type === deck.t2) ? deck.t2 : randomPick(CHARACTERS[2]).type;
  const t3 = CHARACTERS[3].find(c => c.type === deck.t3) ? deck.t3 : randomPick(CHARACTERS[3]).type;
  return { t1, t2, t3 };
}

// AI 덱 이름 — 조합 분석해서 그럴싸한 별칭 생성
function aiGenerateDeckName(draft) {
  if (!draft) return '뉴비 정찰대';
  const types = [draft.t1, draft.t2, draft.t3].filter(Boolean);
  if (types.length === 0) return '미정 부대';
  const chars = types.map((t, i) => findCharData(t, i + 1));
  const tags = chars.map(c => c.tag).filter(Boolean);
  const royalCount = tags.filter(t => t === 'royal').length;
  const villainCount = tags.filter(t => t === 'villain').length;
  const setHas = (xs) => types.some(t => xs.includes(t));
  if (setHas(['gunpowder', 'sulfurCauldron'])) return '화염 분대';
  if (setHas(['shadowAssassin', 'witch', 'torturer'])) return '암흑 첩보대';
  if (setHas(['bodyguard', 'armoredWarrior'])) return '철벽 수비대';
  if (setHas(['herbalist']) && setHas(['monk'])) return '신성 치유단';
  if (setHas(['herbalist']) || setHas(['monk'])) return '서포트 부대';
  if (royalCount >= 2) return '왕실 근위대';
  if (villainCount >= 2) return '어둠의 패거리';
  if (setHas(['cavalry', 'messenger', 'twins'])) return '기동 정찰대';
  if (setHas(['ratMerchant', 'manhunter'])) return '음습한 사냥꾼';
  if (setHas(['dragonTamer'])) return '드래곤의 군단';
  if (setHas(['king', 'commander'])) return '지휘 사령부';
  return '균형 부대';
}

// 캐릭터 데이터 조회 헬퍼
function findCharData(type, tier) {
  const ch = CHARACTERS[tier]?.find(c => c.type === type);
  if (!ch) return { type, name: type, icon: '?', desc: '' };
  return { type: ch.type, name: ch.name, icon: ch.icon, desc: ch.desc, tag: ch.tag, atk: ch.atk, range: ch.range, skills: ch.skills || [], passives: ch.passives || [] };
}

// ── AI 교환 드래프트 카운터픽 결정 ──
// 상대 조합 분석 → 가장 가치 높은 카운터 1티어 결정. 없으면 null (교환 안 함)
function aiDecideExchange(myDraft, oppDraft) {
  if (!myDraft || !oppDraft) return null;
  const opp = [oppDraft.t1, oppDraft.t2, oppDraft.t3];
  const my = { 1: myDraft.t1, 2: myDraft.t2, 3: myDraft.t3 };
  const ROYAL = new Set(['spearman','cavalry','watchman','general','bodyguard','prince','princess','king','commander','monk']);
  const VILLAIN = new Set(['twins','manhunter','witch','ratMerchant','shadowAssassin','torturer','count','slaughterHero','sulfurCauldron']);
  const TANK = new Set(['bodyguard','armoredWarrior','count']);
  const RANGED = new Set(['archer','spearman','cavalry','wizard','ratMerchant','dragonTamer','sulfurCauldron']);
  const HEAL = new Set(['herbalist','monk']);
  const oppRoyal = opp.filter(t => ROYAL.has(t)).length;
  const oppVillain = opp.filter(t => VILLAIN.has(t)).length;
  const oppRanged = opp.filter(t => RANGED.has(t)).length;
  const oppHeal = opp.filter(t => HEAL.has(t)).length;
  const oppHasTank = opp.some(t => TANK.has(t));
  const oppHasShadow = opp.includes('shadowAssassin');
  const oppHasWizard = opp.includes('wizard');
  const oppHasHerbalist = opp.includes('herbalist');
  const oppHasMonk = opp.includes('monk');
  const oppHasTwins = opp.includes('twins');
  const oppHasRats = opp.includes('ratMerchant');
  const myAlready = (type) => my[1] === type || my[2] === type || my[3] === type;

  // 후보 수집 — priority + variety boost (작은 무작위 가산점으로 같은 우선순위 후보 중 다양화)
  const counters = [];
  const addCounter = (tier, newType, basePriority) => {
    if (myAlready(newType)) return;
    if (my[tier] === newType) return;  // 안전망: 이미 같은 자리에 있는 캐릭터면 제외
    const variety = Math.random() * 8;  // 0~8 랜덤 가산
    counters.push({ tier, newType, priority: basePriority + variety, _base: basePriority });
  };

  // ── 왕실 다수 → 저주/악몽 콤보 ──
  if (oppRoyal >= 2) {
    addCounter(3, 'torturer',     85);
    addCounter(2, 'witch',        75);
    addCounter(1, 'manhunter',    55);  // 덫으로 견제
  }
  // ── 악인 다수 → 수도승 가호 ──
  if (oppVillain >= 2) {
    addCounter(3, 'monk',         80);
    addCounter(3, 'commander',    50);  // 사기증진
  }
  // ── 탱커 보유 → 저주(우회) / 학살영웅 / 마법사(원거리) / 폭탄 ──
  if (oppHasTank) {
    addCounter(2, 'witch',        70);
    addCounter(3, 'slaughterHero',60);
    addCounter(2, 'wizard',       55);
    addCounter(1, 'gunpowder',    50);
  }
  // ── 그림자 암살자 → 수도승/마녀(저주로 스킬봉인) ──
  if (oppHasShadow) {
    addCounter(3, 'monk',         65);
    addCounter(2, 'witch',        60);
  }
  // ── 약초+왕실 → 표식+악몽 콤보 ──
  if (oppHasHerbalist && oppRoyal >= 2) {
    addCounter(3, 'torturer',     90);
  }
  // ── 마법사 → 우회/회피형 ──
  if (oppHasWizard) {
    addCounter(1, 'gunpowder',    58);
    addCounter(1, 'manhunter',    52);
    addCounter(2, 'shadowAssassin', 50);
  }
  // ── 적 수도승 → 영역 공격 ──
  if (oppHasMonk) {
    addCounter(3, 'sulfurCauldron', 65);
    addCounter(1, 'gunpowder',    50);
  }
  // ── 적 쌍둥이 → 영역 공격 (좁은 범위에 둘 다 잡을 수 있음) ──
  if (oppHasTwins) {
    addCounter(3, 'sulfurCauldron', 60);
    addCounter(1, 'gunpowder',    55);
  }
  // ── 적 쥐 장수 → 표식/광역 (쥐 청소) ──
  if (oppHasRats) {
    addCounter(2, 'wizard',       55);
    addCounter(3, 'sulfurCauldron', 50);
  }
  // ── 원거리 다수 → 그림자 암살자/전령 (기동) ──
  if (oppRanged >= 2) {
    addCounter(2, 'shadowAssassin', 55);
    addCounter(1, 'messenger',    48);
  }
  // ── 적 회복 다수 → 학살영웅/유황 ──
  if (oppHeal >= 1) {
    addCounter(3, 'slaughterHero', 55);
  }
  // ── 일반적 강력 픽 (베이스라인 다양성) ──
  addCounter(3, 'king',           35);  // 안정적 3티어
  addCounter(2, 'armoredWarrior', 30);
  addCounter(1, 'archer',         25);

  if (counters.length === 0) return null;
  counters.sort((a, b) => b.priority - a.priority);
  // 상위 3개 중 가중 랜덤 — 항상 #1만 뽑지 않도록
  const topN = counters.slice(0, Math.min(3, counters.length));
  const totalWeight = topN.reduce((s, c) => s + c.priority, 0);
  let r = Math.random() * totalWeight;
  let pick = topN[0];
  for (const c of topN) { r -= c.priority; if (r <= 0) { pick = c; break; } }
  // 베이스 우선순위 50 미만 카운터는 35% 확률로 패스 (확실하지 않으면 안 바꿈)
  if (pick._base < 50 && Math.random() < 0.35) return null;
  // priority(_base) 노출 — confirm_initial_reveal 핸들러에서 YES/NO 결정에 활용.
  return { tier: pick.tier, newType: pick.newType, priority: pick._base };
}

// ── 교환 드래프트: 같은 티어 내 1캐릭터 교환 가능 (60초) ──
//   #12 단일측 흐름: exchangeDecisions 가 NO 인 측은 자동 done 처리, 'exchange_waiting' 상태로 emit.
// AI 시나리오 — final_reveal 로 진행할 때 7~15초 무작위 "AI 가 고민 중" 딜레이.
//   인간이 ✓로 교환 드래프트를 진행했든, ✗로 그 자리에서 대기했든 동일하게 적용 →
//   인간이 swap 결과를 보기 전에 항상 7~15초 대기 UI 를 거침. (둘 다 NO 케이스만 예외 — 진입조차 안 함)
function transitionToExchangeDraft(room) {
  clearTimer(room);
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  room.phase = 'exchange_draft';
  if (!room.exchangeDecisions) room.exchangeDecisions = [null, null];
  // 교환 페이즈 공유 타이머 시작 시각 — 양측 동시에 60초 카운트가 흐름.
  //   누군가 일찍 끝낸 후 보는 카운트다운은 "남은 시간" 기준 (실시간 동기화).
  room._exchangeStart = Date.now();
  room._exchangeMaxMs = 60000;

  // AI 가 YES 한 경우 — AI 가 "고민하고 캐릭터 픽 확정" 하는 데 7~15초 강제 딜레이.
  //   서버 내부에서는 _pendingSwap 즉시 계산 (게임 로직 결정성), 하지만 exchangeDone[1] 은 7-15s 후 설정 →
  //   인간 입장에서는 AI 가 이 시간동안 "고민 중" 인 것처럼 보임.
  const aiYes = room.isAI && room.exchangeDecisions[1] === true;
  const aiThinkMs = aiYes ? (7000 + Math.floor(Math.random() * 8001)) : 0;

  if (room.isAI) {
    const aiPlayer = room.players[1];
    const human = room.players[0];
    aiPlayer._exchangeOriginal = { ...aiPlayer.draft };
    if (aiYes) {
      // _pendingSwap 즉시 계산 (외부에서 보이지 않음)
      const swap = aiPlayer._aiPrecomputedSwap || aiDecideExchange(aiPlayer.draft, human.draft);
      if (swap) {
        const key = swap.tier === 1 ? 't1' : swap.tier === 2 ? 't2' : 't3';
        const currentType = aiPlayer.draft[key];
        const conflictsOtherSlot =
          (key !== 't1' && aiPlayer.draft.t1 === swap.newType) ||
          (key !== 't2' && aiPlayer.draft.t2 === swap.newType) ||
          (key !== 't3' && aiPlayer.draft.t3 === swap.newType);
        if (currentType !== swap.newType && !conflictsOtherSlot) {
          aiPlayer._pendingSwap = { tier: swap.tier, key, newType: swap.newType };
        }
      }
      // exchangeDone[1] 은 일부러 false 유지 — 7-15초 setTimeout 안에서 true 로 전환
    } else {
      // AI NO — 즉시 done
      room.exchangeDone[1] = true;
    }
    delete aiPlayer._aiPrecomputedSwap;
  }

  // 인간 측 처리
  //   - NO/✗ 측: 자동 done + 카운트다운 (AI YES 면 ai_decision_wait, 그 외 exchange_waiting_phase)
  //   - YES/✓ 측: exchange_draft_phase 로 정상 교환 드래프트 화면
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const wantsExchange = room.exchangeDecisions[i] === true;
      if (!wantsExchange) {
        room.exchangeDone[i] = true;
        // 페이즈 시작 시점이라 remaining = 60000. 동일 이벤트로 AI/인간 분기 제거.
        const remainingMs = exchangeRemainingMs(room);
        io.to(p.socketId).emit('ai_decision_wait', { waitMs: remainingMs });
        console.log(`[transitionToExchangeDraft] NO side waitMs=${remainingMs}${aiYes ? ` (AI internal think=${aiThinkMs}ms)` : ''}`);
      } else {
        const available = {};
        for (const tier of [1, 2, 3]) {
          const myType = tier === 1 ? p.draft.t1 : tier === 2 ? p.draft.t2 : p.draft.t3;
          available[tier] = CHARACTERS[tier]
            .filter(c => c.type !== myType)
            .map(c => ({ type: c.type, name: c.name, icon: c.icon, desc: c.desc, tag: c.tag, atk: c.atk, range: c.range, isTwin: !!c.isTwin, skills: c.skills, passives: c.passives }));
        }
        io.to(p.socketId).emit('exchange_draft_phase', {
          myDraft: p.draft,
          available,
          oppDraft: room.players[1 - i].draft,
        });
      }
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'exchange_draft',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
  });

  // AI thinking 타이머 (AI 가 YES 인 경우만) — 7-15s 후 exchangeDone[1]=true + 양측 done 체크
  if (aiYes) {
    room._aiThinkStart = Date.now();
    room._aiThinkMs = aiThinkMs;
    console.log(`[transitionToExchangeDraft] starting AI think timer ${aiThinkMs}ms`);
    room._aiThinkTimer = setTimeout(() => {
      room._aiThinkTimer = null;
      // ★ 진단 #1/#2: phase 가 이미 다른 상태로 넘어갔으면 (게임 종료/연결끊김 등) 즉시 중단.
      //   stale 콜백이 ended room 의 exchangeDone 를 건드리거나 transitionToFinalReveal 을 잘못 호출하지 않도록.
      if (!room || room.phase !== 'exchange_draft') return;
      room.exchangeDone[1] = true;
      console.log(`[ai think timer fired] phase=${room.phase} exchangeDone=${JSON.stringify(room.exchangeDone)}`);
      if (room.exchangeDone.every(d => d)) {
        transitionToFinalReveal(room);
      }
      // 인간이 아직 픽 중이면 그냥 기다림 — 인간이 submit 할 때 exchange_pick 핸들러에서 transition
    }, aiThinkMs);
  }

  // 즉시 양측 done 체크 (사실상 이 함수 진입 시 양측 done 인 경우는 거의 없음 —
  //   anyYes=true 라서 진입하므로 적어도 한쪽은 ✓ 하거나 AI YES, 그쪽이 picking 중)
  if (room.exchangeDone.every(d => d)) {
    transitionToFinalReveal(room);
  } else {
    startTimer(room, 'exchange_draft', () => exchangeDraftTimeout(room));
  }
}

function exchangeDraftTimeout(room) {
  if (room.phase !== 'exchange_draft') return;
  // AI thinking 타이머도 정리 (어차피 timeout 으로 전체 종료)
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  for (let i = 0; i < 2; i++) {
    if (!room.exchangeDone[i]) {
      room.exchangeDone[i] = true;
      const sock = io.sockets.sockets.get(room.players[i].socketId);
      if (sock) sock.emit('exchange_done', { draft: room.players[i].draft, timeout: true });
    }
  }
  transitionToFinalReveal(room);
}

// ── 최종 공개: 교환 후 상대 캐릭터 공개 ──
function transitionToFinalReveal(room) {
  clearTimer(room);
  // AI thinking 타이머 / 관련 메타데이터 정리 + 교환 페이즈 시작 시각 정리
  if (room._aiThinkTimer) { clearTimeout(room._aiThinkTimer); room._aiThinkTimer = null; }
  delete room._aiThinkStart;
  delete room._aiThinkMs;
  delete room._exchangeStart;
  delete room._exchangeMaxMs;
  room.phase = 'final_reveal';
  if (room.isAI) {
    // 보류된 AI 교체를 여기서 적용 — 사용자가 본 exchange_draft_phase는 교체 전 조합
    const aiPlayer = room.players[1];
    if (aiPlayer && aiPlayer._pendingSwap) {
      aiPlayer.draft[aiPlayer._pendingSwap.key] = aiPlayer._pendingSwap.newType;
      delete aiPlayer._pendingSwap;
    }
    delete aiPlayer._exchangeOriginal;
    room.finalRevealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppDraft = room.players[1 - i].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      io.to(p.socketId).emit('final_reveal_phase', {
        myDraft: p.draft,
        oppChars,
        myDeckName: p.deckName || '',
        oppDeckName: room.players[1 - i].deckName || '',
        myName: p.name,
        oppName: room.players[1 - i].name,
      });
    }
  });
  emitToSpectators(room, 'spectator_phase', {
    phase: 'final_reveal',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'final_reveal', () => finalRevealTimeout(room));
}

function finalRevealTimeout(room) {
  if (room.phase !== 'final_reveal') return;
  emitToBothAndSpectators(room, 'phase_timeout', { phase: 'final_reveal' });
  for (let i = 0; i < 2; i++) {
    if (!room.finalRevealDone[i]) room.finalRevealDone[i] = true;
  }
  transitionToHpPhase(room);
}

function transitionToHpPhase(room) {
  clearTimer(room);
  room.phase = 'hp_distribution';
  if (room.isAI) {
    const hasTwins = room.players[1].draft.t1 === 'twins';
    const aiHps = aiDistributeHp(hasTwins);
    const aiD = room.players[1].draft;
    if (aiD.t1 === 'twins') {
      room.players[1].pieces = [
        createPiece('twins', 1, aiHps[0], { subUnit: 'elder', parentType: 'twins' }),
        createPiece('twins', 1, aiHps[1], { subUnit: 'younger', parentType: 'twins' }),
        createPiece(aiD.t2, 2, aiHps[2]),
        createPiece(aiD.t3, 3, aiHps[3]),
      ];
      room.players[1].pieces[0].type = 'twins_elder';
      room.players[1].pieces[1].type = 'twins_younger';
    } else {
      room.players[1].pieces = [
        createPiece(aiD.t1, 1, aiHps[0]),
        createPiece(aiD.t2, 2, aiHps[1]),
        createPiece(aiD.t3, 3, aiHps[2]),
      ];
    }
    room.players[1].hpDist = aiHps;
    room.hpDone[1] = true;
  }
  room.players.forEach((p) => {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit('hp_phase', { draft: p.draft, hasTwins: p.draft.t1 === 'twins' });
    }
  });
  // 관전자에게 HP 페이즈 시작 알림
  emitToSpectators(room, 'spectator_phase', {
    phase: 'hp',
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
    p0Draft: room.players[0].draft,
    p1Draft: room.players[1].draft,
    characters: CHARACTERS,
  });
  startTimer(room, 'hp_distribution', () => hpTimeout(room));
}

function startRevealPhaseFromRoom(room) {
  clearTimer(room);
  room.phase = 'reveal';
  if (room.isAI) {
    room.revealDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppPieces = room.players[1 - i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      io.to(p.socketId).emit('reveal_phase', {
        yourPieces: pieceSummary(p.pieces),
        oppPieces,
      });
    }
  });
  // 관전자에게 공개 페이즈 알림
  emitToSpectators(room, 'spectator_reveal', {
    p0Pieces: pieceSummary(room.players[0].pieces),
    p1Pieces: pieceSummary(room.players[1].pieces),
    p0Name: room.players[0].name,
    p1Name: room.players[1].name,
  });
  startTimer(room, 'reveal', () => revealTimeout(room));
}

function revealTimeout(room) {
  if (room.phase !== 'reveal') return;
  for (let i = 0; i < 2; i++) {
    if (!room.revealDone[i] && room.players[i].socketId !== 'AI') {
      room.revealDone[i] = true;
    }
  }
  if (room.revealDone.every(d => d)) {
    transitionToPlacement(room);
  }
}

function transitionToPlacement(room) {
  clearTimer(room);
  room.phase = 'placement';
  if (room.isAI) {
    aiPlacePieces(room);
    room.placementDone[1] = true;
  }
  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      const oppPieces = room.players[1 - i].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      io.to(p.socketId).emit('placement_phase', { pieces: pieceSummary(p.pieces), oppPieces });
    }
  });
  // 관전자에게 배치 페이즈 시작 알림
  emitToSpectators(room, 'spectator_placement_start', {
    p0Pieces: pieceSummary(room.players[0].pieces),
    p1Pieces: pieceSummary(room.players[1].pieces),
    boardBounds: room.boardBounds,
  });
  startTimer(room, 'placement', () => placementTimeout(room));
}

function startGameFromRoom(room) {
  clearTimer(room);
  room.phase = 'game';
  const firstPlayer = Math.random() < 0.5 ? 0 : 1;
  room.currentPlayerIdx = firstPlayer;
  room.turnNumber = 1;

  room.players[firstPlayer].actionDone = false;
  room.players[firstPlayer].actionUsedSkillReplace = false;
  room.players[firstPlayer].skillsUsedBeforeAction = [];
  room.players[firstPlayer].twinMovedSubs = [];

  room.players.forEach((p, i) => {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit('game_start', {
        yourPieces: pieceSummary(p.pieces),
        oppPieces: oppPieceSummary(room.players[1 - i].pieces),
        currentPlayerIdx: firstPlayer,
        turnNumber: 1,
        isYourTurn: i === firstPlayer,
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardBounds: room.boardBounds,
        boardObjects: boardObjectsSummary(room, i),
        remains: room.remains || [],
      });
    }
  });
  // 관전자에게 게임 시작 알림
  emitToSpectators(room, 'spectator_log', { msg: '전투 개시. 선공은 ' + room.players[room.currentPlayerIdx].name, type: 'event' });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
  // 첫 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));

  // AI가 선공인 경우 AI 턴 실행
  if (room.isAI && firstPlayer === 1) {
    setTimeout(() => {
      if (room.phase === 'game') aiTakeTurn(room);
    }, 3000);
  }
}

function createPiece(type, tier, hp, extra) {
  const baseType = (type === 'twins_elder' || type === 'twins_younger') ? 'twins' : type;
  const c = getChar(baseType);
  if (!c) return null;

  const skillList = c.skills || [];
  const hasSkill = skillList.length > 0;
  const firstSkill = skillList[0] || null;

  // 쌍둥이: subUnit별 개별 아이콘/이름 (관계 설정은 남매 — 누나·동생)
  let pieceIcon = c.icon;
  let pieceName = c.name;
  if (extra?.subUnit === 'elder') {
    pieceIcon = '/assets/icons/twins.png';
    pieceName = '쌍둥이 강도 누나';
  } else if (extra?.subUnit === 'younger') {
    pieceIcon = '/assets/icons/twins.png';
    pieceName = '쌍둥이 강도 동생';
  }

  const base = {
    type, tier, name: pieceName, icon: pieceIcon, atk: c.atk, tag: c.tag,
    desc: c.desc, hp, maxHp: hp, col: -1, row: -1, alive: true,
    statusEffects: [],
    // Skill state from CHARACTERS definition
    hasSkill,
    skillName: firstSkill ? firstSkill.name : null,
    skillId: firstSkill ? firstSkill.id : null,
    skillCost: firstSkill ? firstSkill.cost : 0,
    skillReplacesAction: firstSkill ? firstSkill.replacesAction : false,
    // Multi-skill support: store all skills for characters with multiple skills
    skills: skillList,
    // Passives
    passives: c.passives || [],
    passiveName: null,
    // Toggle state for archer/weaponSmith
    toggleState: null,
    // Wizard one-time SP passive used
    wizardPassiveUsed: false,
    // DualBlade attacks left this turn (쌍검무 활성 시 2)
    dualBladeAttacksLeft: 0,
    // Messenger sprint active this turn
    messengerSprintActive: false,
    messengerMovesLeft: 0,
    // Dragon summoned flag (for dragonTamer)
    dragonSummoned: false,
    // Sub-unit info for twins
    subUnit: extra?.subUnit || null,
    parentType: extra?.parentType || null,
    // Is this a summoned dragon?
    isDragon: extra?.isDragon || false,
    ownerIdx: extra?.ownerIdx ?? -1,
  };

  // Set passive display names
  if (base.passives.includes('instantMagic')) base.passiveName = '인스턴트매직';
  if (base.passives.includes('ironSkin')) base.passiveName = '아이언스킨';
  if (base.passives.includes('grace')) base.passiveName = '가호';
  if (base.passives.includes('betrayer')) base.passiveName = '배반자';
  if (base.passives.includes('wrath')) base.passiveName = '사기증진';
  if (base.passives.includes('markPassive')) base.passiveName = '표식';
  if (base.passives.includes('tyranny')) base.passiveName = '폭정';
  if (base.passives.includes('loyalty')) base.passiveName = '충성';

  return base;
}

function pieceSummary(pieces) {
  return pieces.map((pc, idx) => ({
    index: idx, type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
    hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, desc: pc.desc, tag: pc.tag,
    col: pc.col, row: pc.row, alive: pc.alive,
    statusEffects: pc.statusEffects,
    hasSkill: pc.hasSkill, skillName: pc.skillName, skillId: pc.skillId,
    skillCost: pc.skillCost, skillReplacesAction: pc.skillReplacesAction,
    skills: pc.skills || [],
    passiveName: pc.passiveName, passives: pc.passives,
    toggleState: pc.toggleState,
    subUnit: pc.subUnit,
    isDragon: pc.isDragon,
    wizardPassiveUsed: pc.wizardPassiveUsed,
    dualBladeAttacksLeft: pc.dualBladeAttacksLeft || 0,
    messengerSprintActive: pc.messengerSprintActive,
    messengerMovesLeft: pc.messengerMovesLeft,
    dragonSummoned: pc.dragonSummoned,
  }));
}

function oppPieceSummary(pieces) {
  return pieces.map((pc, idx) => {
    const hasMark = pc.statusEffects.some(e => e.type === 'mark');
    return {
      index: idx, type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
      hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, desc: pc.desc, tag: pc.tag,
      alive: pc.alive,
      statusEffects: pc.statusEffects.filter(e => e.type !== 'trap'),
      hasSkill: pc.hasSkill, skillName: pc.skillName,
      skillCost: pc.skillCost,
      skills: pc.skills || [],
      passives: pc.passives || [],
      passiveName: pc.passiveName,
      subUnit: pc.subUnit,
      isDragon: pc.isDragon,
      range: pc.range,
      toggleState: pc.toggleState,
      // 표식 상태인 적은 위치 공개
      col: hasMark ? pc.col : undefined,
      row: hasMark ? pc.row : undefined,
      marked: hasMark,
    };
  });
}

function boardObjectsSummary(room, playerIdx) {
  const own = room.boardObjects[playerIdx].map(o => ({ ...o }));
  const enemyIndices = (room.mode === 'team') ? getEnemyIndices(room, playerIdx) : [1 - playerIdx];
  const allyIndices = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
  const oppRats = enemyIndices.flatMap(ei => (room.rats[ei] || []).map(r => ({ type: 'rat', col: r.col, row: r.row, owner: ei })));
  const ownRats = allyIndices.flatMap(ai => (room.rats[ai] || []).map(r => ({ type: 'rat', col: r.col, row: r.row, owner: ai })));
  return [...own, ...oppRats, ...ownRats];
}

// ══════════════════════════════════════════════════════════════════
// ── Damage Resolution Pipeline ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function resolveDamage(room, attackerPiece, defenderPiece, attackerIdx, baseDamage, isStatusDmg, defIdx) {
  // 팀전: 실제 방어자 인덱스를 인자로 받음 / 1v1: 1-attackerIdx
  const defenderIdx = (defIdx !== undefined && defIdx !== null) ? defIdx : (1 - attackerIdx);
  const defender = room.players[defenderIdx];
  const attacker = room.players[attackerIdx];
  let dmg = baseDamage;

  // Status damage pipeline (curse): 기존 저주는 shadow 무관 정상 적용 (사용자 정정).
  //   shadow 면역 범위는 새 데미지/상태이상 부여만 — 이미 걸려있던 저주의 지속 데미지는 유효.
  if (isStatusDmg) {
    return dmg;
  }

  // Step 2: Commander buff — 팀모드에서는 팀원 지휘관 인접도 버프 적용
  if (attacker) {
    const commanderSources = (room.mode === 'team')
      ? getAllyIndices(room, attackerIdx).flatMap(i => room.players[i].pieces)
      : attacker.pieces;
    for (const p of commanderSources) {
      if (p.alive && p.type === 'commander' && p !== attackerPiece) {
        const dc = Math.abs(p.col - attackerPiece.col);
        const dr = Math.abs(p.row - attackerPiece.row);
        if ((dc === 0 && dr === 1) || (dc === 1 && dr === 0)) {
          dmg += 1;
          break;
        }
      }
    }
  }

  // Step 3: Monk attacking villain => damage = 3
  if (attackerPiece.type === 'monk' && defenderPiece.tag === 'villain') {
    dmg = 3;
    if (room._attackPassivesFired && !room._attackPassivesFired.has('monk_attack')) {
      emitToBoth(room, 'passive_alert', { type: 'monk_attack', playerIdx: attackerIdx, msg: `가호: 악인 공격 시 3 피해` });
      emitToSpectators(room, 'spectator_log', { msg: `가호: 악인 공격 시 3 피해`, type: 'passive', playerIdx: attackerIdx });
      room._attackPassivesFired.add('monk_attack');
    }
  }

  // Step 4: Shadow => damage = 0
  if (defenderPiece.statusEffects.some(e => e.type === 'shadow')) {
    return 0;
  }

  // Step 5: ArmoredWarrior iron skin: -0.5 (not status dmg)
  if (defenderPiece.type === 'armoredWarrior') {
    const before = dmg;
    dmg = Math.max(0, dmg - 0.5);
    if (before !== dmg) {
      if (room._attackPassivesFired && !room._attackPassivesFired.has('armoredWarrior')) {
        emitToBoth(room, 'passive_alert', { type: 'armoredWarrior', playerIdx: defenderIdx, msg: `아이언 스킨: 피해 0.5 감소` });
        emitToSpectators(room, 'spectator_log', { msg: `아이언 스킨: 피해 0.5 감소`, type: 'passive', playerIdx: defenderIdx });
        room._attackPassivesFired.add('armoredWarrior');
      }
    }
  }

  // Step 6: Monk being attacked by villain => damage = 0.5
  if (defenderPiece.type === 'monk' && attackerPiece.tag === 'villain') {
    dmg = 0.5;
    if (room._attackPassivesFired && !room._attackPassivesFired.has('monk')) {
      emitToBoth(room, 'passive_alert', { type: 'monk', playerIdx: defenderIdx, msg: `가호: 악인 공격 피해 0.5로 감소` });
      emitToSpectators(room, 'spectator_log', { msg: `가호: 악인 공격 피해 0.5로 감소`, type: 'passive', playerIdx: defenderIdx });
      room._attackPassivesFired.add('monk');
    }
  }

  // Step 7: Count hit by tier 1 or 2 => -0.5
  if (defenderPiece.type === 'count' && (attackerPiece.tier === 1 || attackerPiece.tier === 2)) {
    const before = dmg;
    dmg = Math.max(0, dmg - 0.5);
    if (before !== dmg) {
      if (room._attackPassivesFired && !room._attackPassivesFired.has('count')) {
        emitToBoth(room, 'passive_alert', { type: 'count', playerIdx: defenderIdx, msg: `폭정: ${attackerPiece.tier}티어 공격 피해 0.5 감소` });
        emitToSpectators(room, 'spectator_log', { msg: `폭정: ${attackerPiece.tier}티어 공격 피해 0.5 감소`, type: 'passive', playerIdx: defenderIdx });
        room._attackPassivesFired.add('count');
      }
    }
  }

  // Step 8: Bodyguard passive — 왕실 아군 피해를 1로 줄이고 대신 받음 (항상 활성)
  // 팀모드: 방어자의 팀 전체에서 호위무사 탐색 + 대상 왕실은 팀원 것도 가능
  if (defenderPiece.tag === 'royal' && defenderPiece.type !== 'bodyguard') {
    const defenderTeamIdx = (room.mode === 'team')
      ? getAllyIndices(room, defenderIdx)
      : [defenderIdx];
    // 호위무사 탐색 (가장 먼저 찾은 것)
    let bodyguardPiece = null, bodyguardOwnerIdx = null;
    for (const bIdx of defenderTeamIdx) {
      const bg = room.players[bIdx].pieces.find(p => p.type === 'bodyguard' && p.alive);
      if (bg) { bodyguardPiece = bg; bodyguardOwnerIdx = bIdx; break; }
    }
    if (bodyguardPiece) {
      bodyguardPiece.hp = Math.max(0, bodyguardPiece.hp - 1);
      // ★ 사용자 요청: 한 공격으로 여러 왕실이 호위무사로부터 보호받아도 emit 1회.
      //   이름들 수집 후 processAttack 종료 시 통합 emit.
      if (!room._pendingBodyguardPassive) {
        room._pendingBodyguardPassive = { ownerIdx: bodyguardOwnerIdx, names: [] };
      }
      room._pendingBodyguardPassive.names.push(defenderPiece.name);
      // #1: 호위무사 피격 애니메이션을 위해 pending hit 정보를 사이드채널로 전달
      if (!room._pendingBodyguardHits) room._pendingBodyguardHits = [];
      const bgDefender = room.players[bodyguardOwnerIdx];
      const bgPieceIdx = bgDefender.pieces.indexOf(bodyguardPiece);
      room._pendingBodyguardHits.push({
        col: bodyguardPiece.col, row: bodyguardPiece.row,
        damage: 1, newHp: bodyguardPiece.hp, destroyed: bodyguardPiece.hp <= 0,
        hitName: bodyguardPiece.name, hitIcon: bodyguardPiece.icon,
        defPieceIdx: bgPieceIdx,
        defOwnerIdx: bodyguardOwnerIdx,  // 팀모드 라우팅용
        attackerSub: attackerPiece.subUnit || null,
        attackerName: attackerPiece.name,
        attackerIcon: attackerPiece.icon,
        bodyguardRedirect: true,
      });
      // #11: 호위무사 HP가 1이면 저주 즉시 해제 (패시브)
      checkCurseRemoval(room, bodyguardPiece, bodyguardOwnerIdx);
      if (bodyguardPiece.hp <= 0) {
        bodyguardPiece.alive = false;
        handleDeath(room, bodyguardPiece, bodyguardOwnerIdx);
      }
      return 0;
    }
  }

  return Math.max(0, dmg);
}

function setKillInfo(room, type, killer, victims) {
  room.lastKillInfo = { type, killer, victims: (victims || []).map(v => v.name || v) };
}

// #11: 저주 해제 조건 — 마녀 사망 또는 대상 HP ≤ 1 시 즉시 해제
function checkCurseRemoval(room, piece, ownerIdx) {
  if (!piece || !piece.statusEffects) return;
  const curse = piece.statusEffects.find(e => e.type === 'curse');
  if (!curse) return;
  const sourceIdx = curse.source;
  const sourceWitch = room.players[sourceIdx]?.pieces.find(pc => pc.type === 'witch' && pc.alive);
  if (!sourceWitch || piece.hp <= 1) {
    piece.statusEffects = piece.statusEffects.filter(e => e.type !== 'curse');
    const reason = !sourceWitch ? '마녀가 사망해' : '체력 고갈로';
    emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: ownerIdx, targetName: piece.name, msg: `저주: ${reason} ${piece.name}의 저주 해제` });
    emitToSpectators(room, 'spectator_log', { msg: `저주: ${reason} ${piece.name}의 저주 해제`, type: 'passive', playerIdx: ownerIdx });
    // AI 마녀 학습 — 같은 대상에 저주가 정화될 때마다 _curseHistory 카운트 증가 → 다음 시전 시 회피
    const witchOwner = room.players[sourceIdx];
    if (witchOwner && witchOwner.socketId === 'AI') {
      if (!witchOwner._curseHistory) witchOwner._curseHistory = {};
      const key = `${ownerIdx}:${piece.type}:${piece.subUnit || ''}`;
      witchOwner._curseHistory[key] = (witchOwner._curseHistory[key] || 0) + 1;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ── Animation Phase System ─────────────────────────────────────────
// 트리거 액션의 부산물 (사망 효과 등) 을 한꺼번에 휘몰아치지 않게 순차 페이즈로 묶음.
//
// 사용 패턴:
//   startPhase(room) → 액션 처리 (handleDeath 가 페이즈 큐에 효과 push)
//                   → flushPhase(room, onComplete)
// 페이즈 진행 중 _animPhaseEndsAt + _aiEndTurnEarliest 가 미래 시각으로 설정됨 →
// AI 행동 / 턴 전환 / 다음 액션이 이 시각까지 대기.
//
// 사용자 요구: 한 트리거의 모든 결과는 즉시(서버 사이드) 계산되지만, 클라가 보는
// 애니메이션은 사망 → 사망 효과 → 체인 효과 순으로 호흡감 있게 노출.
// ══════════════════════════════════════════════════════════════════

function startPhase(room) {
  room._currentPhase = {
    pendingDeathDetonations: [],  // 1세대 사망 화약상 (액션의 직접 결과)
  };
  // ★ 액션 간 누수 방지 — _tempChainQueue 는 flushPhase 의 wave 루프 안에서만 일시적으로 non-null.
  //   이전 flushPhase 가 예외로 중단되면 stale 배열이 남아 queueDeathDetonation 이 엉뚱한 큐에 push 할 수 있음.
  room._tempChainQueue = null;
}

function isPhaseActive(room) {
  return !!room._currentPhase;
}

// 사망 기폭 — handleDeath 가 화약상 분기에서 호출. 페이즈 큐에 push.
//   체인 wave 처리 중이면 다음 wave 큐로, 아니면 1세대 큐로.
//   페이즈 비활성 시 false 반환 (호출자가 즉시 처리 fallback).
function queueDeathDetonation(room, ownerIdx, casterPieceIdx) {
  if (room._tempChainQueue) {
    room._tempChainQueue.push({ ownerIdx, casterPieceIdx });
    return true;
  }
  if (room._currentPhase) {
    room._currentPhase.pendingDeathDetonations.push({ ownerIdx, casterPieceIdx });
    return true;
  }
  return false;
}

// ★ 사용자 요청: 표식 발동 전용 페이즈 — 모든 패시브/스킬 연쇄 처리 후 *최후반* 에 시전.
//   processAttack 가 inline 으로 표식을 적용/emit 하지 않고 room._pendingMarks 에 큐잉.
//   flushPhase (사망 기폭) 가 끝난 후 이 함수가 cast intro + 적용 + brand 애니 시퀀스를 처리.
//   타임라인:
//     T+0     : mark_cast emit (시전자 카드 spotlight + "표식" 말풍선)
//     T+780ms : spotlight 해제 + statusEffect 적용 + passive_alert emit (markCells)
//               → 클라가 animateMarkBrand 발동 (인두 낙하 1.8s)
//     T+780ms + 1800ms = T+2580ms : onComplete 호출
function flushMarkPhase(room, onComplete) {
  const rawMarks = (room._pendingMarks || []).slice();
  room._pendingMarks = [];
  // ★ 사용자 요청: 이미 표식 상태인 유닛은 표식 대상이 안 됨.
  //   공격한 모든 유닛이 이미 표식 상태이면 — 표식 페이즈가 아예 발동 안 함 (mark_cast 도 X).
  //   일부만 표식 상태가 아니면 — 그 일부에 대해서만 표식 발동.
  //   기존엔 cast 후 적용 시점에 필터링 → cast 애니메이션은 발생했음. 이제 cast 전에 필터링.
  const marks = rawMarks.filter(m => {
    const t = m.target;
    if (!t || !t.alive) return false;
    if (t.statusEffects && t.statusEffects.some(e => e.type === 'shadow')) return false;
    if (t.statusEffects && t.statusEffects.some(e => e.type === 'mark')) return false;
    return true;
  });
  if (marks.length === 0) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  // 시전자 그룹화 — 표식이 실제로 적용될 마크만 기준 (이미 표식인 대상만 공격한 시전자는 캐스터 X).
  const seen = new Set();
  const casters = [];
  for (const m of marks) {
    if (m.sourceOwnerIdx == null || m.sourcePieceIdx == null) continue;
    const k = `${m.sourceOwnerIdx}:${m.sourcePieceIdx}`;
    if (seen.has(k)) continue;
    seen.add(k);
    casters.push({ ownerIdx: m.sourceOwnerIdx, pieceIdx: m.sourcePieceIdx });
  }
  // ★ 사용자 요청: 피격 데미지 도장 등장 후 0.5초 텀.
  //   도장 fade-in 약 0.4s + 추가 0.5s = 0.9s 대기 후 mark_cast 시작.
  //   사망 기폭 페이즈 후엔 이미 충분히 시간이 지났지만, 통일성 위해 동일 텀 적용.
  const PRE_MARK_DELAY = 900;
  setTimeout(() => {
    if (!rooms[room.id]) { if (typeof onComplete === 'function') onComplete(); return; }
    _flushMarkPhaseInner(room, marks, casters, onComplete);
  }, PRE_MARK_DELAY);
}
function _flushMarkPhaseInner(room, marks, casters, onComplete) {
  // ★ 사용자 요청 (분리):
  //   - 적 위치 노출 (시전자가 안개 너머의 적 피규어를 볼 수 있게) → 시전 시작 시점 (T+0)
  //   - 표식 🎯 아이콘 + statusEffects (게임 로직상의 mark 상태) → 인두 낙하 시점 (T+780)
  //   두 시각 효과를 분리. statusEffects.push 는 T+780 시점에서 수행.

  // (0) 시전 시점에 보낼 — markedTargets 사전 계산 (실제 적용은 아직 안 함)
  // 필터: shadow 면 표식 안 됨 / 이미 mark 면 안 됨 (flushMarkPhase 도 필터링하지만 PRE_MARK_DELAY
  // 900ms 사이에 상태 변경 가능 → 한 번 더 검증)
  const targetsForCast = [];
  const targetsForApply = [];  // T+780 에 실제 적용할 마크
  for (const m of marks) {
    const t = m.target;
    if (!t || !t.alive) continue;
    if (t.statusEffects && t.statusEffects.some(e => e.type === 'shadow')) continue;
    if (t.statusEffects && t.statusEffects.some(e => e.type === 'mark')) continue;
    let targetOwnerIdx = null, targetPieceIdx = null;
    for (let pi = 0; pi < room.players.length; pi++) {
      const idx = room.players[pi].pieces.indexOf(t);
      if (idx >= 0) { targetOwnerIdx = pi; targetPieceIdx = idx; break; }
    }
    targetsForCast.push({
      sourceOwnerIdx: m.sourceOwnerIdx,
      targetOwnerIdx,
      targetPieceIdx,
      col: t.col, row: t.row,
      name: t.name, icon: t.icon,
    });
    targetsForApply.push(m);
  }

  // ★ 사용자 요청: 표식 대상이 전부 무효 (이미 표식·shadow·사망) 이면 시전 자체 발동 X.
  //   mark_cast 인트로 / 인두 낙하 / passive_alert 모두 emit 안 함.
  if (targetsForCast.length === 0) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  // 시전자 재계산 — 실제 표식 적용되는 대상의 source 만. (이미 표식인 대상만 친 토르처러는 caster X)
  const effectiveCasters = [];
  const seenSrc = new Set();
  for (const t of targetsForCast) {
    if (t.sourceOwnerIdx == null) continue;
    // 원래 marks 에서 sourcePieceIdx 매칭
    const orig = marks.find(m => m.sourceOwnerIdx === t.sourceOwnerIdx &&
      room.players[t.sourceOwnerIdx]?.pieces.indexOf(m.target) === t.targetPieceIdx);
    const srcPi = orig?.sourcePieceIdx;
    if (srcPi == null) continue;
    const k = `${t.sourceOwnerIdx}:${srcPi}`;
    if (seenSrc.has(k)) continue;
    seenSrc.add(k);
    effectiveCasters.push({ ownerIdx: t.sourceOwnerIdx, pieceIdx: srcPi });
  }

  // (1) mark_cast emit — markedTargets + 재계산된 casters 만
  emitToBoth(room, 'mark_cast', { casters: effectiveCasters.length ? effectiveCasters : casters, markedTargets: targetsForCast });
  emitToSpectators(room, 'spectator_log', { msg: '표식 발동', type: 'passive' });

  const CAST_DURATION = 780;
  const BRAND_DURATION = 1800;
  setTimeout(() => {
    if (!rooms[room.id]) { if (typeof onComplete === 'function') onComplete(); return; }
    // (2) 인두 낙하 시점 — statusEffects 실제 적용 + passive_alert (animateMarkBrand 트리거)
    const byOwner = new Map();
    for (const m of targetsForApply) {
      const t = m.target;
      if (!t || !t.alive) continue;
      if (t.statusEffects && t.statusEffects.some(e => e.type === 'shadow')) continue;
      if (t.statusEffects && t.statusEffects.some(e => e.type === 'mark')) continue;
      t.statusEffects.push({ type: 'mark', source: m.sourceOwnerIdx });
      if (!byOwner.has(m.sourceOwnerIdx)) byOwner.set(m.sourceOwnerIdx, { names: [], cells: [] });
      const grp = byOwner.get(m.sourceOwnerIdx);
      grp.names.push(m.targetName);
      grp.cells.push({ col: t.col, row: t.row });
    }
    for (const [ownerIdx, { names, cells }] of byOwner) {
      if (names.length === 0) continue;
      emitToBoth(room, 'passive_alert', {
        type: 'torturer', playerIdx: ownerIdx,
        msg: `표식: ${names.join(', ')}에게 표식 새김`,
        markCells: cells,
      });
      emitToSpectators(room, 'spectator_log', {
        msg: `표식: ${names.join(', ')}에게 표식 새김`,
        type: 'passive', playerIdx: ownerIdx,
        markCells: cells,
      });
    }
    // (3) After brand animation finishes — onComplete
    setTimeout(() => {
      if (typeof onComplete === 'function') onComplete();
    }, BRAND_DURATION);
  }, CAST_DURATION);
}

// 페이즈 종료 — 사망 기폭 wave 들 사전 계산 (state 즉시 변경) + emit 만 시간차 스케줄링.
// ★ 사용자 요청: 사망 기폭 처리 후 표식 페이즈를 체이닝 (flushMarkPhase).
function flushPhase(room, onComplete) {
  // ★ 표식 페이즈를 onComplete 직전에 항상 체이닝 — 모든 flushPhase callsite 자동 적용.
  const wrappedComplete = () => flushMarkPhase(room, onComplete);
  if (!room._currentPhase) {
    wrappedComplete();
    return;
  }
  const phase = room._currentPhase;
  room._currentPhase = null;

  // ★ 사용자 요청: 데미지 도장이 화면에 모두 출력된 후 사망 기폭 시작.
  //   트리거 액션 (공격·스킬) 의 hit 애니 + addBodyDamage 도장 표시 + profile-hit 흔들림이
  //   완전히 화면에 노출되려면 약 2초 필요 (도장 stamp 가 1.8s 동안 fade-in/visible).
  // ★ 사망 기폭은 항상 "유해 생성 이후"에 시작 — 트리거 스킬의 사망 애니가 길면 그만큼 지연(겹침 방지).
  //   기본 2000ms(공격/도장 텀). 악몽/유황 등은 사망 애니 시작이 늦어(클라 game.js _lavaDeathDelay) 유해가
  //   더 늦게 생기므로 phase.detonationDelay 로 더 길게 설정(executeSkill 에서 지정).
  const RECOGNITION_DELAY = (phase && phase.detonationDelay) || 2000;
  const CAST_DURATION = 780;       // "사망 기폭" 말풍선 + spotlight
  const BOMB_DURATION = 1930;      // detonation_intro + bomb_detonated
  const POST_SETTLE = 500;         // wave 간 마진

  // === 1) 모든 wave 사전 계산 ===
  const waves = [];
  let waveQueue = phase.pendingDeathDetonations.slice();
  let safetyCounter = 0;

  while (waveQueue.length > 0 && safetyCounter < 30) {  // 안전 상한 8→30 (폭화약상 최대 = 2팀×5유닛, 체인이 30회를 넘을 수 없음)
    safetyCounter++;
    const wave = waveQueue;
    const newPending = [];

    // 이번 wave 의 detonateBomb 안에서 발생하는 사망(=체인) 은 newPending 으로
    room._tempChainQueue = newPending;

    const deferredEmits = [];
    for (const dd of wave) {
      const bombs = (room.boardObjects[dd.ownerIdx] || []).filter(o => o.type === 'bomb');
      for (const bomb of bombs) {
        const hits = detonateBomb(room, dd.ownerIdx, bomb, { deferEmit: true });
        // ★ owner 추가 — 클라가 팀 컬러 (mine 파랑 / enemy 빨강) 결정
        //   remainsHits — 이 폭탄 셀 유해 피격 (blast 타이밍에 클라가 재생)
        //   destroyedRats — 이 폭탄 셀 적 쥐 격파 (blast 타이밍에 클라가 사망 애니 재생)
        deferredEmits.push({ col: bomb.col, row: bomb.row, hits, owner: dd.ownerIdx, remainsHits: room._lastBombRemainsHits || [], destroyedRats: room._lastBombDestroyedRats || [] });
      }
      room.boardObjects[dd.ownerIdx] = (room.boardObjects[dd.ownerIdx] || []).filter(o => o.type !== 'bomb');
    }

    room._tempChainQueue = null;

    waves.push({
      casters: wave.map(dd => ({ ownerIdx: dd.ownerIdx, pieceIdx: dd.casterPieceIdx })),
      deferredEmits,
    });

    waveQueue = newPending;  // 다음 wave (체인)
  }

  // ★ emitSPUpdate 는 wave emit 스케줄링 루프 마지막에 지연 호출 (아래 참조).
  //   즉시 호출하면 인스턴트 SP 스택킹이 기폭 애니보다 먼저 도착하는 순서 오류 발생.

  // === 2) emit 스케줄링 (각 wave 순차 노출) ===
  let cursor = 0;
  for (const wave of waves) {
    const allBombs = wave.deferredEmits.map(b => ({ col: b.col, row: b.row, owner: b.owner }));

    cursor += RECOGNITION_DELAY;
    const c1 = cursor;
    setTimeout(() => {
      if (rooms[room.id]) {
        emitToBoth(room, 'death_detonate_cast', { casters: wave.casters, bombs: allBombs });
      }
    }, c1);

    cursor += CAST_DURATION;
    const c2 = cursor;
    setTimeout(() => {
      if (rooms[room.id]) {
        emitToBoth(room, 'detonation_intro', { bombs: allBombs });
      }
    }, c2);

    cursor += BOMB_DURATION;
    const c3 = cursor;
    setTimeout(() => {
      if (!rooms[room.id]) return;
      for (const bd of wave.deferredEmits) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
    }, c3);

    cursor += POST_SETTLE;
  }

  // ★ emitSPUpdate — 마지막 bomb_detonated 후 지연 emit (인스턴트 SP 스택킹 순서 보장).
  //   사망 기폭 → 애니 재생 → 피격 판정 → 인스턴트 매직 → SP 스택킹 순서.
  if (waves.length > 0) {
    const _spEmitDelay = cursor; // 마지막 wave 의 POST_SETTLE 포함 시점
    setTimeout(() => {
      if (rooms[room.id]) emitSPUpdate(room);
    }, _spEmitDelay);
  }

  // === 3) 페이즈 종료 시각 마킹 + AI 차단 + 게임종료 검사 지연 플래그 ===
  if (cursor > 0) {
    const phaseEnd = Date.now() + cursor + 200;
    room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, phaseEnd);
    if (!room._aiEndTurnEarliest || phaseEnd > room._aiEndTurnEarliest) {
      room._aiEndTurnEarliest = phaseEnd;
    }
    if (!room._aiNextActionEarliest || phaseEnd > room._aiNextActionEarliest) {
      room._aiNextActionEarliest = phaseEnd;
    }
    // ★ sync 게임종료 검사가 미리 fire 되지 않게 방지하는 플래그.
    //   호출자가 동기 흐름에서 endGame 호출 직전에 이 플래그 체크 → true 면 skip.
    //   onComplete callback 안에서 checkGameEndAfterPhase 가 처리.
    room._phaseDeferredGameEndCheck = true;
  }

  // === 4) 모든 wave 종료 후 callback (표식 페이즈 자동 체이닝) ===
  setTimeout(() => {
    if (!rooms[room.id]) return;
    // ★ 플래그는 콜백 실행 여부와 무관하게 항상 먼저 해제.
    //   (이전: wrappedComplete()가 예외로 죽으면 _phaseDeferredGameEndCheck 가 영원히 true 로 남아
    //    이후 들어오는 end_turn 이 9105 에서 영구 차단 → 턴이 멈추는 프리징.)
    room._phaseDeferredGameEndCheck = false;
    room._turnTimeoutRetries = 0;
    try {
      wrappedComplete();
    } catch (e) {
      console.error('[flushPhase] onComplete 예외 — 턴 정지 방지를 위해 로그만 남김:', e);
    }
  }, cursor + 100);
}

// 페이즈 종료 후 게임 종료 검사 — 양측 동시 전멸이면 simultaneous_draw, 아니면 일반 승패.
// 게임 종료 시 true 반환, 계속 진행해야 하면 false (호출자가 정상 흐름 진행).
function checkGameEndAfterPhase(room) {
  if (room.mode === 'team') {
    const team0Elim = isTeamEliminated(room, 0);
    const team1Elim = isTeamEliminated(room, 1);
    if (team0Elim && team1Elim) {
      setKillInfo(room, 'simultaneous_draw', null, []);
      endTeamGame(room, 0, 'simultaneous_draw');
      return true;
    }
    if (team0Elim) { endTeamGame(room, 1); return true; }
    if (team1Elim) { endTeamGame(room, 0); return true; }
  } else {
    const p0Dead = checkWin(room, 0);
    const p1Dead = checkWin(room, 1);
    if (p0Dead && p1Dead) {
      setKillInfo(room, 'simultaneous_draw', null, []);
      endGame(room, -1, 'simultaneous_draw');
      return true;
    }
    if (p0Dead) { endGame(room, 1); return true; }
    if (p1Dead) { endGame(room, 0); return true; }
  }
  return false;
}

// 페이즈 종료 시점에 게임이 끝나는 상태(어느 한쪽 전멸)인지 — endGame 호출 없이 검사만.
function isGameEndingState(room) {
  if (room.mode === 'team') {
    return isTeamEliminated(room, 0) || isTeamEliminated(room, 1);
  }
  return checkWin(room, 0) || checkWin(room, 1);
}

// 폭탄 기폭 애니가 끝난 뒤 게임종료 판정 — flushPhase 콜백에서 사용.
// ★ 버그 수정: 폭탄 기폭으로 마지막 적이 사망할 때, 사망 기폭 체인이 없으면 flushPhase cursor=0 →
//   onComplete(checkGameEndAfterPhase)가 ~100ms 에 fire → 폭발/사망/격파 토스트 애니가 끝나기도 전에
//   game_over 가 전송되던 문제. deferredBombEmits 가 있고 이 기폭으로 게임이 끝나는 상태면,
//   detonation_intro 시점에 계산한 bombAnimEndsAt(폭발+사망+유해 애니 종료 시각)까지 판정을 지연한다.
//   사망 기폭 체인이 있던 경우엔 flushPhase 가 이미 그만큼 지연했으므로 bombAnimEndsAt 는 이미 지나
//   _remain≈0 → 즉시 판정 (이중 지연 없음).
function checkGameEndAfterBombPhase(room, bombAnimEndsAt) {
  if (!rooms[room.id] || room.phase !== 'game') return;
  const _remain = bombAnimEndsAt ? Math.max(0, bombAnimEndsAt - Date.now()) : 0;
  if (_remain > 50 && isGameEndingState(room)) {
    room._phaseDeferredGameEndCheck = true;
    const _pe = Date.now() + _remain;
    room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, _pe);
    if (!room._aiEndTurnEarliest || _pe > room._aiEndTurnEarliest) room._aiEndTurnEarliest = _pe;
    if (!room._aiNextActionEarliest || _pe > room._aiNextActionEarliest) room._aiNextActionEarliest = _pe;
    setTimeout(() => {
      room._phaseDeferredGameEndCheck = false;
      if (!rooms[room.id] || room.phase !== 'game') return;
      checkGameEndAfterPhase(room);
    }, _remain);
    return;
  }
  checkGameEndAfterPhase(room);
}

// 클라 폭발 시퀀스 총 길이(ms) — detonation_intro emit 시점 기준.
//   SP 마법구 비행(780) + (n-1)*폭탄 stagger(350) + impact(1300)
//   + 사망 GIF 시작 지연(400) + 사망 GIF/유해 정착(~1200).
function bombAnimDurationMs(bombCount) {
  const n = Math.max(1, bombCount || 1);
  return 780 + (n - 1) * 350 + 1300 + 400 + 1200;
}

function handleDeath(room, deadPiece, ownerIdx) {
  deadPiece.alive = false;
  const owner = room.players[ownerIdx];

  // 팀전: 플레이어 전멸 감지 → team_player_eliminated 이벤트 (1회성)
  if (room.mode === 'team' && owner) {
    if (!room.eliminatedPlayers) room.eliminatedPlayers = new Set();
    if (!room.eliminatedPlayers.has(ownerIdx)) {
      const allDead = owner.pieces && owner.pieces.every(p => !p.alive);
      if (allDead) {
        room.eliminatedPlayers.add(ownerIdx);
        const payload = {
          playerIdx: ownerIdx,
          playerName: owner.name,
          teamId: owner.teamId,
          slotPos: owner.slotPos ?? 0,
        };
        emitToBoth(room, 'team_player_eliminated', payload);
      }
    }
  }

  // (저주 전파 기능 제거 — 게임 룰에 없음)

  // 화약상 사망 → 사망 기폭. 페이즈가 active 면 큐로 넘김 (시퀀스), 아니면 즉시 처리(레거시).
  if (deadPiece.type === 'gunpowder') {
    const bombs = (room.boardObjects[ownerIdx] || []).filter(o => o.type === 'bomb');
    if (bombs.length > 0) {
      const casterPieceIdx = (owner && owner.pieces) ? owner.pieces.indexOf(deadPiece) : -1;
      const queued = queueDeathDetonation(room, ownerIdx, casterPieceIdx);
      if (!queued) {
        // 페이즈 비활성 — 즉시 폭발 (보드 축소 등 레거시 경로)
        for (const bomb of bombs) {
          detonateBomb(room, ownerIdx, bomb);
        }
        room.boardObjects[ownerIdx] = (room.boardObjects[ownerIdx] || []).filter(o => o.type !== 'bomb');
      }
      // 큐로 들어간 경우 — flushPhase 에서 폭탄 처리 + 보드 정리
    }
  }

  // Dragon tamer dies: dragon stays alive (independent unit)

  // Witch death: remove all curses sourced from this player + 즉시 알림
  if (deadPiece.type === 'witch') {
    for (let pi = 0; pi < room.players.length; pi++) {
      const pl = room.players[pi];
      for (const p of pl.pieces) {
        if (p.alive) {
          const had = p.statusEffects.some(e => e.type === 'curse' && e.source === ownerIdx);
          if (had) {
            p.statusEffects = p.statusEffects.filter(e => !(e.type === 'curse' && e.source === ownerIdx));
            emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: pi, targetName: p.name, msg: `저주: 마녀가 사망해 ${p.name}의 저주 해제` });
            emitToSpectators(room, 'spectator_log', { msg: `저주: 마녀가 사망해 ${p.name}의 저주 해제`, type: 'passive', playerIdx: pi });
          }
        }
      }
    }
  }

  // ── 유해 (remains) 생성 ──
  // rat, dragon, sulfurCauldron 은 유해를 남기지 않음
  // 보드 축소로 인한 사망은 handleDeath 호출 전에 room._boardShrinkDeaths = true 로 표시
  const NO_REMAINS_TYPES = ['rat', 'dragon', 'sulfurCauldron'];
  if (!NO_REMAINS_TYPES.includes(deadPiece.type) && !room._boardShrinkDeaths) {
    if (!room.remains) room.remains = [];
    room.remains.push({
      col: deadPiece.col,
      row: deadPiece.row,
      type: deadPiece.type,
      name: deadPiece.name,
      icon: deadPiece.icon,
      owner: ownerIdx,
      turnCreated: room.turnNumber,
      hits: 0,        // 유해 피격 누적 — 3 이 되면 파괴. stage = hits+1 (1=무피해,2=1타,3=2타)
    });
  }
}

// ── 유해 3타 파괴 ──
// 공격 범위(atkCells)에 들어온 유해는 공격력과 무관하게 공격 1회당 hits 1 증가.
//   stage: 1=막 생성(무피해), 2=1타, 3=2타. hits 가 3 이 되면 파괴(제거)되어 칸이 해제됨.
// 반환: 이번 공격으로 영향받은 유해 [{col,row,stage,destroyed}] (클라 그래픽/피드백용).
function processRemainsHits(room, atkCells, opts) {
  opts = opts || {};
  if (!room.remains || room.remains.length === 0 || !atkCells || atkCells.length === 0) return [];
  const touched = [];
  const survivors = [];
  for (const rem of room.remains) {
    const inRange = atkCells.some(c => c.col === rem.col && c.row === rem.row);
    // ★ onlyExisting — 이번 공격 *이전부터* 있던 유해만 피격 대상. 이번 공격으로 유닛이 죽어
    //   방금 생성된 유해(=같은 칸)는 제외 → "유닛 사망 시점 = 유해 생성(1단계)"이지 피격이 아님.
    const preExisting = !opts.onlyExisting || opts.onlyExisting.has(`${rem.col},${rem.row}`);
    // ★ alreadyHit — 한 공격 액션(합류 쌍둥이 본체+겹침 등)에서 같은 유해를 2번 카운트하지 않도록 dedupe.
    const _rkey = `${rem.col},${rem.row}`;
    const _already = opts.alreadyHit && opts.alreadyHit.has(_rkey);
    if (!inRange || !preExisting || _already) { survivors.push(rem); continue; }
    if (opts.alreadyHit) opts.alreadyHit.add(_rkey);
    rem.hits = (rem.hits || 0) + 1;
    if (rem.hits >= 3) {
      touched.push({ col: rem.col, row: rem.row, stage: 4, destroyed: true });
      // survivors 에 넣지 않음 → 제거
    } else {
      touched.push({ col: rem.col, row: rem.row, stage: rem.hits + 1, destroyed: false });
      survivors.push(rem);
    }
  }
  if (touched.length > 0) {
    room.remains = survivors;
    // skipEmit — 호출부(폭탄 등)가 자체 이벤트(bomb_detonated)에 remainsHits 를 실어 보내고
    //   blast 타이밍에 직접 재생한다. 이 경우 별도 remains_update 를 보내지 않는다(이중·오타이밍 방지).
    if (!opts.skipEmit) {
      const payload = { remains: room.remains.slice(), hits: touched };
      // ★ 타이밍 — 공격 임팩트 이벤트(attack_result/being_attacked/spectator_attack_anim)보다
      //   뒤에 도착하도록 다음 tick 에 emit. processAttack 은 그 이벤트들보다 먼저 실행되므로,
      //   동기 emit 이면 유해 피격 연출이 일반 유닛 피격보다 이르게 터진다. nextTick 으로 미뤄
      //   클라가 직전 공격 핸들러가 세팅한 임팩트 시각(S._impactAtTs)에 맞춰 정렬하게 한다.
      process.nextTick(() => {
        if (!rooms[room.id]) return;
        emitToBoth(room, 'remains_update', payload);
        emitToSpectators(room, 'spectator_remains_update', payload);
      });
    }
  }
  return touched;
}

function detonateBomb(room, ownerIdx, bomb, options) {
  const opts = options || {};
  const deferEmit = !!opts.deferEmit;
  // 기폭 스킬에서 호출 시(=deferEmit) sp_update 가 skill_result 보다 먼저 도착해
  // 시전자의 마법구 비행 애니가 무동작이 되므로, 이 경우엔 sp_update emit 을 생략하고
  // 후속 skill_result 가 sp/instantSp 를 일괄 전달.
  const suppressSpUpdate = deferEmit;
  // ★ 사용자 보고 (패시브 누설): _attackPassivesFired 가 stale 인 채로 resolveDamage 호출되면
  //   passive dedupe 가 잘못 동작 (이전 attack 의 fired set 이 남아 새 alert 가 차단되거나,
  //   알 수 없는 잔재가 남아있음). bomb 폭발마다 fresh Set 으로 초기화.
  room._attackPassivesFired = new Set();
  room._pendingBodyguardPassive = null;
  // ★ 폭발 이전부터 있던 유해만 피격 대상 (이 폭발로 죽어 새로 생긴 유해 제외 — 사망=생성).
  const _preRemainsCellsBomb = new Set((room.remains || []).map(r => `${r.col},${r.row}`));
  const enemyIndices = (room.mode === 'team') ? getEnemyIndices(room, ownerIdx) : [1 - ownerIdx];
  const hits = [];
  for (const defOwnerIdx of enemyIndices) {
    const opponent = room.players[defOwnerIdx];
    if (!opponent) continue;
    for (let epi = 0; epi < opponent.pieces.length; epi++) {
      const ep = opponent.pieces[epi];
      if (ep.alive && ep.col === bomb.col && ep.row === bomb.row) {
        // ★ 그림자 숨기 면역 — 폭탄도 그림자 상태 piece 에는 무효 (사용자 요청).
        if (ep.statusEffects && ep.statusEffects.some(e => e.type === 'shadow')) continue;
        // ★ FIX (팀 모드 폭탄→왕실 적 크래시): defIdx(=defOwnerIdx) 미전달 시 resolveDamage 의
        //   호위무사 로직이 getAllyIndices(undefined) → room.players[undefined].pieces 로 크래시했음.
        const dmg = resolveDamage(room, { type: 'gunpowder', tag: null, tier: 1, col: bomb.col, row: bomb.row }, ep, ownerIdx, 1, false, defOwnerIdx);
        ep.hp = Math.max(0, ep.hp - dmg);
        if (ep.hp <= 0) {
          handleDeath(room, ep, defOwnerIdx);
        }
        // Wizard passive: SP on bomb hit — 마법사 소속 플레이어/팀에 SP 추가
        if (ep.type === 'wizard') {
          // ep는 적의 wizard. ep의 소유자 idx를 찾아야 함
          let wizOwnerIdx = -1;
          for (let pi = 0; pi < room.players.length; pi++) {
            if (room.players[pi].pieces.includes(ep)) { wizOwnerIdx = pi; break; }
          }
          if (wizOwnerIdx < 0) wizOwnerIdx = defOwnerIdx;  // fallback
          const wizSpSlot = teamSlotIdx(room, wizOwnerIdx);
          room.instantSp[wizSpSlot] += 1;
          if (!suppressSpUpdate) emitSPUpdate(room);
          const wizOwnerName = room.players[wizOwnerIdx].name;
          emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: wizOwnerIdx, msg: `인스턴트 매직 : SP 획득` });

          emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: wizOwnerIdx });

        }
        hits.push({ col: ep.col, row: ep.row, damage: dmg, newHp: ep.hp, destroyed: !ep.alive, type: ep.type, name: ep.name, icon: ep.icon, defPieceIdx: epi, defOwnerIdx });
      }
    }
  }
  // ★ 유해도 폭발 피해 — 폭탄 셀에 유해가 있으면 1 hit (일반 공격과 동일 카운트, 3타째 제거).
  //   skipEmit:true → 별도 remains_update 안 보냄. 대신 bomb_detonated 페이로드에 remainsHits 를 실어
  //   클라가 폭발 임팩트(blast) 순간에 직접 재생 → 폭탄 유닛 피격과 동일 타이밍.
  const remainsHits = processRemainsHits(room, [{ col: bomb.col, row: bomb.row }], { skipEmit: true, onlyExisting: _preRemainsCellsBomb });
  room._lastBombRemainsHits = remainsHits;   // deferEmit 경로(기폭 스킬)에서 deferredBombEmits 에 싣기 위한 side-channel
  // ★ FIX (폭탄으로 쥐 격파 누락): 일반 공격(processAttack 4298-4310)은 쥐를 격파하지만 detonateBomb
  //   엔 쥐 제거 로직이 빠져 있었음. 폭탄 셀의 적 쥐를 제거하고 destroyedRats 로 클라에 전달
  //   (클라가 폭발 임팩트 순간에 쥐 사망 애니 재생). deferEmit 경로용 side-channel 도 저장.
  const destroyedRats = [];
  for (const defOwnerIdx of enemyIndices) {
    const before = (room.rats[defOwnerIdx] || []).length;
    room.rats[defOwnerIdx] = (room.rats[defOwnerIdx] || []).filter(
      r => !(r.col === bomb.col && r.row === bomb.row)
    );
    if (room.rats[defOwnerIdx].length < before) {
      destroyedRats.push({ col: bomb.col, row: bomb.row, owner: defOwnerIdx });
    }
  }
  room._lastBombDestroyedRats = destroyedRats;
  // 기폭 스킬에서 호출 시(deferEmit) bomb_detonated 는 skill_result 다음에 외부에서 emit
  if (!deferEmit) {
    emitToBoth(room, 'bomb_detonated', { col: bomb.col, row: bomb.row, hits, remainsHits, destroyedRats });
  }
  const bombKilled = hits.filter(h => h.destroyed);
  if (bombKilled.length > 0) {
    setKillInfo(room, 'bomb', null, bombKilled.map(k => ({ name: k.name })));
  }
  return hits;
}

function processAttack(room, attackerIdx, atkPiece, atkCells, extraDamage, opts) {
  const attacker = room.players[attackerIdx];
  const baseDmg = (extraDamage !== undefined) ? extraDamage : atkPiece.atk;
  // ★ 이번 공격 *이전*에 존재하던 유해 칸 스냅샷 — 공격으로 죽어 새로 생긴 유해를 피격에서 제외하기 위함.
  //   (유닛 사망 = 유해 생성. 생성 즉시 피격 카운트되면 안 됨.)
  //   opts.preRemainsOverride: 합류 쌍둥이처럼 한 액션에서 여러 번 호출될 때 액션-시작 시점 스냅샷 공유.
  const _preRemainsCells = (opts && opts.preRemainsOverride) || new Set((room.remains || []).map(r => `${r.col},${r.row}`));
  // ★ 쥐 공격 모션 — *쥐장수(ratMerchant)가 공격할 때만* 본인 소유 쥐 전부가 공격 모션을 재생.
  //   이전엔 클라가 "atkCells 에 쥐가 있으면 쥐장수 공격"이라고 자동 추정 → 일반 유닛의 공격 범위가
  //   우연히 쥐 셀을 덮으면 그 쥐가 잘못 공격 모션을 재생하는 버그(특히 상대 쥐). 서버가 공격자 신원을
  //   정확히 알므로, 쥐장수 공격일 때만 전용 이벤트로 알린다. (피격/사망 모션은 별도 경로.)
  if (atkPiece.type === 'ratMerchant') {
    emitToBothAndSpectators(room, 'rat_attack_anim', { owner: attackerIdx });  // ★ 관전자도 쥐 공격 모션
  }
  // 스킬(유황범람 등)에서 호출 시 sp_update 가 후속 skill_result 보다 먼저 가지 않도록 suppress.
  const suppressSpUpdate = !!(opts && opts.suppressSpUpdate);
  room._suppressSpUpdate = suppressSpUpdate;
  const hitResults = [];
  // #1: 호위무사 hit 사이드채널 초기화
  room._pendingBodyguardHits = [];
  // ★ 사용자 요청: 표식은 모든 패시브/스킬 연쇄 처리 후 *최후반* 에 시전.
  //   processAttack 안에서는 statusEffect 적용·emit 안 함 — room._pendingMarks 큐에 push.
  //   flushPhase callback 의 flushMarkPhase 가 cast intro + 적용 + brand 애니 처리.
  if (!room._pendingMarks) room._pendingMarks = [];
  // ★ 사용자 요청: 한 공격으로 여러 대상에 같은 패시브 (가호/아이언스킨/폭정/충성) 가 발동돼도
  //   토스트·로그는 단 한 번만 출력. resolveDamage 가 피격자마다 호출되므로 dedupe 필요.
  //   - 메시지가 generic 한 패시브 (monk_attack/monk/armoredWarrior/count): type 별로 1회만 emit
  //   - 메시지가 대상 이름을 포함하는 패시브 (bodyguard): 이름 수집 후 attack 종료 시 통합 emit
  room._attackPassivesFired = new Set();
  room._pendingBodyguardPassive = null;

  // 팀전: 적 = 적팀 멤버만 / 1v1: 적 = 상대
  // (이전 버그: !isTeammate(self,self)는 true이므로 공격자 본인이 enemy에 포함되어 friendly-fire 발생)
  const enemyIndices = getEnemyIndices(room, attackerIdx);

  for (const defIdx of enemyIndices) {
    const defender = room.players[defIdx];
    if (!defender) continue;
    for (const cell of atkCells) {
      for (let dpi = 0; dpi < defender.pieces.length; dpi++) {
        const defPiece = defender.pieces[dpi];
        if (defPiece.alive && defPiece.col === cell.col && defPiece.row === cell.row) {
          // ★ 사용자 요청: 그림자 숨기 상태는 모든 데미지 면역 + 빗나감 처리.
          //   처음부터 hitResults 에 추가하지 않음 → 클라가 빗나감으로 인식 (피격 표시·도장·자동 추리토큰 모두 X).
          //   torturer 표식, wizard 인스턴트 SP, 호위무사 가로채기 등 부수효과도 모두 차단.
          if (defPiece.statusEffects && defPiece.statusEffects.some(e => e.type === 'shadow')) {
            continue;
          }
          // 호위무사 가로채기 감지: resolveDamage 직전후 _pendingBodyguardHits 길이 비교
          const bgBefore = (room._pendingBodyguardHits || []).length;
          const dmg = resolveDamage(room, atkPiece, defPiece, attackerIdx, baseDmg, false, defIdx);
          const redirectedToBodyguard = ((room._pendingBodyguardHits || []).length > bgBefore);
          defPiece.hp = Math.max(0, defPiece.hp - dmg);
          // #11: 피격 후 HP=1 이하로 내려가면 저주 즉시 해제
          if (defPiece.alive && dmg > 0) {
            checkCurseRemoval(room, defPiece, defIdx);
          }
          const destroyed = defPiece.hp <= 0;
          if (destroyed) {
            handleDeath(room, defPiece, defIdx);
          }
          hitResults.push({
            col: cell.col, row: cell.row,
            damage: dmg, newHp: defPiece.hp, destroyed,
            revealedType: destroyed ? defPiece.type : undefined,
            revealedName: destroyed ? defPiece.name : undefined,
            revealedIcon: destroyed ? defPiece.icon : undefined,
            hitName: defPiece.name,
            hitIcon: defPiece.icon,
            defPieceIdx: dpi,          // 피격 대상의 배열 인덱스 (프로필 애니메이션용)
            defOwnerIdx: defIdx,       // 팀모드: 어느 적 플레이어의 말인지
            // 호위무사가 대신 받음 — 클라에서 토스트·애니메이션 스킵
            redirectedToBodyguard,
            attackerSub: atkPiece.subUnit || null,
            attackerName: atkPiece.name,
            attackerIcon: atkPiece.icon,
          });

          // Post-damage: torturer 표식 — 큐에 push (즉시 적용/emit 안 함).
          //   flushMarkPhase 가 cast intro + 적용 + brand 시퀀스를 최후반에 처리.
          if (atkPiece.type === 'torturer' && !destroyed) {
            let markTarget = defPiece;
            // 호위무사 패시브: 왕실 아군 상태이상도 대신 받음
            if (defPiece.tag === 'royal' && defPiece.type !== 'bodyguard') {
              const bg = defender.pieces.find(p => p.type === 'bodyguard' && p.alive);
              if (bg) markTarget = bg;
            }
            // 그림자 상태 면역 — 큐에 넣지 않음. (이미 표식 / 사망 등의 final check 는 flushMarkPhase 에서.)
            if (!markTarget.statusEffects.some(e => e.type === 'shadow')) {
              const srcPieceIdx = attacker.pieces.indexOf(atkPiece);
              room._pendingMarks.push({
                type: 'forward',
                sourceOwnerIdx: attackerIdx,
                sourcePieceIdx: srcPieceIdx,
                target: markTarget,
                targetName: markTarget.name,
              });
            }
          }

          // ★ 리워크 (역방향 표식): 고문기술자가 *피격* 당하면 공격자에게 표식 부여 — 큐에 push.
          //   공격 접촉만으로 적용 (0 데미지 / 사망 여부 무관). 호위무사 가로채기는 제외.
          //   공격자 그림자 상태도 큐에 넣지 않음. ('이미 표식' 체크는 flushMarkPhase 의 final check.)
          if (defPiece.type === 'torturer' &&
              !redirectedToBodyguard &&
              !atkPiece.statusEffects.some(e => e.type === 'shadow')) {
            room._pendingMarks.push({
              type: 'reverse',
              sourceOwnerIdx: defIdx,
              sourcePieceIdx: dpi,
              target: atkPiece,
              targetName: atkPiece.name,
            });
          }

          // (마녀 저주는 이제 직접 대상 지정 스킬로 변경됨)

          // Post-damage: wizard passive (defender is wizard, gain 1 instant SP per hit, even on death)
          if (defPiece.type === 'wizard') {
            const wizSpSlot = teamSlotIdx(room, defIdx);
            room.instantSp[wizSpSlot] += 1;
            // 스킬 컨텍스트에서는 sp_update suppress (skill_result 가 일괄 sp/instantSp 전달)
            if (!room._suppressSpUpdate) emitSPUpdate(room);
            const defName = room.players[defIdx].name;
            emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: defIdx, msg: `인스턴트 매직 : SP 획득` });

            emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: defIdx });
          }
        }
      }
    }
  }

  // SlaughterHero passive: 공격 범위 내 "아군"(팀모드: 자기+팀원) 1 피해
  // ★ 사용자 요청: 학살영웅의 공격이 적군은 못때리고 아군/자기쥐/적쥐만 때렸어도
  //   "무언가 피격이 있었다면" 빗나감 토스트 X. 그 판단을 위해 friendlyFire / 자기쥐격파 카운트 사이드채널 저장.
  room._attackerFriendlyFireCount = 0;
  room._attackerOwnRatsDestroyedCount = 0;
  room._friendlyFireHits = [];                 // ★ 아군 피격 상세 데이터 수집
  if (atkPiece.type === 'slaughterHero') {
    const attackerName = room.players[attackerIdx].name;
    const allyIndices = (room.mode === 'team') ? getAllyIndices(room, attackerIdx) : [attackerIdx];
    for (const cell of atkCells) {
      for (const aIdx of allyIndices) {
        const allyPlayer = room.players[aIdx];
        for (let _ffPi = 0; _ffPi < allyPlayer.pieces.length; _ffPi++) {
          const allyPiece = allyPlayer.pieces[_ffPi];
          if (allyPiece.alive && allyPiece !== atkPiece && allyPiece.col === cell.col && allyPiece.row === cell.row) {
            allyPiece.hp = Math.max(0, allyPiece.hp - 1);
            room._attackerFriendlyFireCount++;
            const whose = aIdx === attackerIdx ? '' : `${allyPlayer.name}의 `;
            // 배반자 토스트·로그 출력 제거 — 데미지 도장으로 충분히 표현됨 (사용자 요청)
            // ★ 피격 상세 기록 — 클라이언트 사망/피격 GIF 재생용 + defPieceIdx 추가 (도장 키용)
            room._friendlyFireHits.push({
              col: cell.col, row: cell.row, damage: 1, newHp: allyPiece.hp,
              destroyed: allyPiece.hp <= 0, type: allyPiece.type,
              ownerIdx: aIdx, defPieceIdx: _ffPi,
            });
            // Wizard passive: 배반자로 마법사가 피격되면 인스턴트 SP 1 획득
            if (allyPiece.type === 'wizard') {
              const wizSpSlot = teamSlotIdx(room, aIdx);
              room.instantSp[wizSpSlot] += 1;
              if (!room._suppressSpUpdate) emitSPUpdate(room);
              emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: aIdx, msg: `인스턴트 매직 : SP 획득` });
              emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: aIdx });
            }
            if (allyPiece.hp <= 0) {
              handleDeath(room, allyPiece, aIdx);
            }
          }
        }
      }
    }
    // 배반자 — 아군 쥐도 격파 (피격 유효)
    for (const cell of atkCells) {
      for (const aIdx of allyIndices) {
        const before = (room.rats[aIdx] || []).length;
        room.rats[aIdx] = (room.rats[aIdx] || []).filter(
          r => !(r.col === cell.col && r.row === cell.row)
        );
        if (room.rats[aIdx].length < before) {
          room._attackerOwnRatsDestroyedCount += (before - room.rats[aIdx].length);
          // 배반자로 아군 쥐 격파 — 토스트·로그 출력 제거 (사용자 요청)
        }
      }
    }
  }

  // Destroy rats hit by attacks — 팀전 시 모든 적 플레이어의 쥐
  const destroyedRatCells = [];
  for (const defIdx of enemyIndices) {
    for (const cell of atkCells) {
      const before = (room.rats[defIdx] || []).length;
      room.rats[defIdx] = (room.rats[defIdx] || []).filter(
        r => !(r.col === cell.col && r.row === cell.row)
      );
      if (room.rats[defIdx].length < before) {
        destroyedRatCells.push({ col: cell.col, row: cell.row, owner: defIdx });
      }
    }
  }
  // ★ 사이드 채널 — 스킬(유황범람 등)이 result.data.destroyedRats 로 실어 클라 사망 애니에 사용.
  room._destroyedRatCellsThisAttack = destroyedRatCells;
  if (destroyedRatCells.length > 0) {
    const attackerName = room.players[attackerIdx].name;
    const coordStr = destroyedRatCells.map(c => coord(c.col, c.row)).join(', ');
    emitToSpectators(room, 'spectator_log', {
      msg: `${attackerName}${조사(attackerName, '이', '가')} ${coordStr}의 쥐 격파함`,
      type: 'hit',
      playerIdx: attackerIdx,
    });
  }
  // ★ 사이드 채널 — 핸들러에서 attackerImpactedAnything 계산용 (적쥐 격파 카운트).
  room._destroyedEnemyRatsCount = destroyedRatCells.length;

  // Track kill info for game-over messages
  const killed = hitResults.filter(h => h.destroyed);
  if (killed.length > 0) {
    setKillInfo(room, 'attack', atkPiece.name, killed.map(k => ({ name: k.revealedName })));
  }

  // #1: 호위무사 hit을 hitResults에 추가 (클라이언트 피격 애니메이션용)
  if (room._pendingBodyguardHits && room._pendingBodyguardHits.length > 0) {
    hitResults.push(...room._pendingBodyguardHits);
    room._pendingBodyguardHits = [];
  }
  // sp_update suppress 플래그 정리
  room._suppressSpUpdate = false;

  // ★ 사용자 요청 (표식 전용 페이즈): 표식은 inline 으로 emit 안 함.
  //   processAttack 안에서는 room._pendingMarks 에 큐만 쌓고, flushPhase callback 의
  //   flushMarkPhase 가 모든 패시브/스킬 연쇄 처리 후 최후반에 cast intro + 적용 + brand 시퀀스 처리.

  // ★ 사용자 요청: 호위무사 충성 통합 알림 — 한 공격으로 보호한 모든 왕실 이름 한 번에 출력.
  if (room._pendingBodyguardPassive) {
    const { ownerIdx, names } = room._pendingBodyguardPassive;
    const namesStr = names.join(', ');
    emitToBoth(room, 'passive_alert', { type: 'bodyguard', playerIdx: ownerIdx, msg: `충성: ${namesStr} 대신 1 피해` });
    emitToSpectators(room, 'spectator_log', { msg: `충성: ${namesStr} 대신 1 피해`, type: 'passive', playerIdx: ownerIdx });
    room._pendingBodyguardPassive = null;
  }

  // ── 유해 3타 파괴 — 공격 범위에 든 유해 카운트 (공격력 무관, 공격 1회당 1) ──
  //   onlyExisting — 이번 공격으로 방금 죽어 생성된 유해는 제외 (사망=생성이지 피격 아님).
  room._remainsHitsThisAttack = processRemainsHits(room, atkCells, { onlyExisting: _preRemainsCells, alreadyHit: opts && opts.remainsAlreadyHit });

  return hitResults;
}

function checkWin(room, defenderIdx) {
  const defender = room.players[defenderIdx];
  // 드래곤 포함 모든 유닛이 죽어야 패배 (드래곤 살아있으면 패배 불가)
  return defender.pieces.every(p => !p.alive);
}

// ══════════════════════════════════════════════════════════════════
// ── SP System Helpers ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function spendSP(room, playerIdx, amount) {
  // 팀모드: SP 풀은 [블루팀, 레드팀] = teamId로 인덱싱 / 1v1: [p0, p1] = playerIdx
  const slot = (room.mode === 'team')
    ? (getTeamOf(room, playerIdx))
    : playerIdx;
  const oppSlot = 1 - slot;
  const totalSp = room.sp[slot] + room.instantSp[slot];
  if (totalSp < amount) return false;
  // Consume instant SP first (disappears permanently, no transfer to opponent)
  let remaining = amount;
  const instantUsed = Math.min(room.instantSp[slot], remaining);
  room.instantSp[slot] -= instantUsed;
  remaining -= instantUsed;
  // Then consume regular SP (transfers to opponent)
  if (remaining > 0) {
    room.sp[slot] -= remaining;
    room.sp[oppSlot] = Math.min(room.sp[oppSlot] + remaining, 10);
  }
  // ❌ emitSPUpdate(room) 제거 — sp_update 가 skill_result/status_update/team_game_update 보다 먼저 도착하면
  //    클라이언트에서 S.sp 가 미리 갱신되어 oldSpSnap=newSp 가 되고, spendSPAttention 의 마법구·인스턴트
  //    pip 비행 애니가 delta=0 으로 한 개도 발생 안 함. 후속 결과 이벤트들이 sp/instantSp 를 직접 포함하므로
  //    여기서 별도 sp_update 를 보낼 필요가 없음.
  return true;
}

function emitSPUpdate(room) {
  emitToBoth(room, 'sp_update', {
    sp: room.sp,
    instantSp: room.instantSp,
    skillPoints: room.sp,
  });
}

// ══════════════════════════════════════════════════════════════════
// ── Turn Management ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// 관전자용 스킬 메시지 빌드 — result.msg 기반으로 플레이어 이름 추가
function buildSpectatorSkillMsg(playerName, piece, result) {
  const msg = result.msg || '';
  // 스킬명 패턴에서 플레이어 이름 삽입
  // "정비: ..." → "{이름}의 궁수가 정비를 사용! ..."
  const patterns = [
    { prefix: '정비:', rewrite: (m) => `정비: 공격 방향 전환` },
    { prefix: '분신:', rewrite: (m) => m },
    { prefix: '덫 설치:', rewrite: (m) => `덫 설치: ${playerName}의 덫 설치` },
    { prefix: '질주:', rewrite: (m) => `질주: 전령은 추가 이동 가능` },
    { prefix: '기폭:', rewrite: (m) => `기폭: 폭탄 폭발!` },
    { prefix: '폭탄 설치:', rewrite: (m) => `폭탄 설치: ${playerName}의 폭탄 설치` },
    { prefix: '약초학:', rewrite: (m) => `약초학: 범위 내 아군 1 HP 회복` },
    { prefix: '그림자 숨기:', rewrite: (m) => `그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역` },
    { prefix: '저주:', rewrite: (m) => {
        const tMatch = m.match(/^저주: (.+?)[을를] 저주/);
        const tName = tMatch ? tMatch[1] : '대상';
        return `저주: ${tName}${조사(tName, '을', '를')} 저주`;
      } },
    { prefix: '쌍검무:', rewrite: (m) => `쌍검무: 양손검객은 추가 공격 가능` },
    { prefix: '절대복종 반지:', rewrite: (m) => {
        const kMatch = m.match(/^절대복종 반지: (.+?)[을를] 강제 이동/);
        const target = kMatch ? kMatch[1] : '대상';
        return `반지: ${playerName}의 국왕이 ${target}${조사(target, '을', '를')} 강제 이동`;
      } },
    { prefix: '신성:', rewrite: (m) => {
        const mMatch = m.match(/^신성: (.+?)의 상태이상/);
        const tName = mMatch ? mMatch[1] : '대상';
        return `신성: ${tName}의 상태이상 제거, 2 HP 회복`;
      } },
    { prefix: '유황범람:', rewrite: (m) => `유황범람: 보드 외곽 전체 2 피해` },
    { prefix: '악몽', rewrite: (m) => `악몽: 모든 표식 상태 유닛 1 피해` },
  ];
  for (const p of patterns) {
    if (msg.startsWith(p.prefix)) return p.rewrite(msg);
  }
  // 매칭 안 되면 기본 포맷
  return `✦ ${playerName}의 ${piece.name} → ${piece.skillName || msg}`;
}

function emitToBoth(room, event, data) {
  for (const p of room.players) {
    if (p.socketId !== 'AI') {
      io.to(p.socketId).emit(event, data);
    }
  }
  // 관전자에게도 동일 이벤트 전달
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

function emitToPlayer(room, idx, event, data) {
  const p = room.players[idx];
  if (p && p.socketId !== 'AI') {
    io.to(p.socketId).emit(event, data);
  }
}

function emitToSpectators(room, event, data) {
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit(event, data);
  }
}

function getSpectatorGameState(room) {
  const p0 = room.players[0], p1 = room.players[1];
  return {
    turnNumber: room.turnNumber,
    currentPlayerIdx: room.currentPlayerIdx,
    sp: room.sp,
    instantSp: room.instantSp,
    boardBounds: room.boardBounds,
    p0Pieces: p0 ? pieceSummary(p0.pieces) : [],
    p1Pieces: p1 ? pieceSummary(p1.pieces) : [],
    p0Name: p0 ? p0.name : '?',
    p1Name: p1 ? p1.name : '?',
    boardObjects: [
      ...boardObjectsSummary(room, 0),
      ...boardObjectsSummary(room, 1),
    ],
    remains: room.remains || [],
  };
}

function processTurnStart(room) {
  const idx = room.currentPlayerIdx;
  const player = room.players[idx];

  // Reset turn flags
  player.actionDone = false;
  player.actionUsedSkillReplace = false;
  player.skillsUsedBeforeAction = [];
  player._aiFreeSkillUsedPieces = null;  // ★ FIX: 팀 AI 자유 스킬 1회/턴 기록 리셋
  player.twinMovedSubs = [];
  player._lastActionType = null;  // 'move' | 'attack' | null
  player._anySkillUsedThisTurn = false;  // 턴스킵 판정용 (oncePerTurn 외 자유 스킬 포함)

  // Reset per-turn skill states for current player
  for (const p of player.pieces) {
    p.dualBladeAttacksLeft = 0;
    p.messengerSprintActive = false;
    p.messengerMovesLeft = 0;
  }

  // Remove shadow effects from THIS player's pieces (shadow lasts until own next turn)
  for (const p of player.pieces) {
    p.statusEffects = p.statusEffects.filter(e => e.type !== 'shadow');
  }

  // ★ Pre-curse HP 스냅샷은 보드 축소 *이후* 캡처해야 함 (사용자 보고:
  //    축소 사망 piece 의 HP 0 이 저주 데미지로 잘못 인식되어 보라 도장 출력).
  //    snapshot 은 축소 처리 후 line 3876 부근에서 캡처. 여기서는 placeholder 만 초기화.

  // ── 애니메이션 페이즈 시작 (#24) ──
  //   여러 turn-event 가 한 턴에 발생할 때, 0.5s 텀으로 순차 재생.
  //   전체 페이즈 동안 게임 일시정지 (AI/curse_tick 모두). 페이즈 종료 + 1.5s 버퍼 후 정상화.
  //   순서: 보드 파괴 경고 → 보드 파괴 → 1대1 대치 → ... → SP 지급 (항상 마지막)
  //   각 애니메이션의 server-side 추정 duration:
  const ANIM_GAP = 500;
  const DUR_SHRINK_WARN = 3000;
  const DUR_SHRINK_INTRO = 3000;
  const DUR_BOARD_SHRINK = 3000;
  const DUR_STALEMATE = 3000;
  const DUR_SP_GRANT = 5400;
  let animTotalMs = 0;
  const queueAnim = (durMs) => {
    if (animTotalMs > 0) animTotalMs += ANIM_GAP;
    animTotalMs += durMs;
  };

  // 1. 1대1 대치 감지 (즉시 trigger, 별도 애니메이션 없음 — 기존 5턴 후 축소만 예약)
  detectStalemateShrink(room);

  // ── 보드 축소 스케줄 (애니메이션 페이즈) ──
  const schedule = getBoardShrinkSchedule(room);
  if (!room._boardShrinkIntroFired) room._boardShrinkIntroFired = {};
  for (const ev of schedule) {
    if (room.turnNumber >= ev.warnTurn && room.turnNumber < ev.shrinkTurn && room.boardShrinkStage < ev.stage) {
      const remaining = ev.shrinkTurn - room.turnNumber;
      if (remaining > 0) {
        emitToBoth(room, 'board_shrink_warning', {
          turnsRemaining: remaining, turnsLeft: remaining,
          stage: ev.stage,
          key: ev.key,                        // 안정적 식별자 (예: '1v1-50', 'stalemate-25')
          stalemate: !!ev.stalemate,          // 1대1 대치 트리거 여부
        });
        emitToSpectators(room, 'spectator_log', { msg: `외곽 파괴까지 ${remaining}턴`, type: 'event' });
        // ★ 픽스: 풀스크린 인트로 (3000ms 락) 는 클라가 turnsRemaining === 10 일 때만 재생.
        //   이전엔 매 턴 queueAnim(3000) 호출해 9턴 동안 4.5s 락이 누적 — 사용자가 턴종료 눌러도
        //   서버가 anim phase 처리 중이라 아무것도 안 일어나는 freeze 증상의 직접 원인.
        //   이제 stage 별 인트로는 1회만 (== 10) 큐잉, 나머지 턴은 카운트다운 텍스트만.
        if (remaining === 10 && !room._boardShrinkIntroFired[ev.stage]) {
          room._boardShrinkIntroFired[ev.stage] = true;
          queueAnim(DUR_SHRINK_WARN);
        }
      }
    }
    if (room.turnNumber >= ev.shrinkTurn && room.boardShrinkStage < ev.stage) {
      room.boardShrinkStage = ev.stage;
      decreaseBoardShrinkLevel(room);
      if (room.boardShrinkLevel === 1) room.boardShrunk = true;
      const eliminated = [];
      // ★ 보드 축소로 죽는 piece 들 — handleDeath 경로로 통일.
      //   사용자 요청: 화약상이 축소로 죽으면 사망 기폭이 시전돼야 함.
      //   페이즈 시작 → 축소 처리 → 사망 처리 (handleDeath 가 사망 기폭 큐로 push) → flushPhase
      startPhase(room);
      const deadPieces = [];
      for (let pi = 0; pi < room.players.length; pi++) {
        const pl = room.players[pi];
        for (const p of pl.pieces) {
          if (p.alive && !inBounds(p.col, p.row, room.boardBounds)) {
            // p.alive 는 handleDeath 가 처리 — 여기서는 hp 만 0 으로 (handleDeath 안에서 sequencing)
            p.hp = 0;
            eliminated.push({ type: p.type, name: p.name, icon: p.icon, col: p.col, row: p.row, owner: pi });
            deadPieces.push({ piece: p, ownerIdx: pi });
          }
        }
      }
      // boardObjects 정리는 handleDeath 후 (화약상 사망 기폭 큐가 폭탄 위치 참조해야 하므로 그 전)
      // 하지만 축소 영역 밖의 폭탄은 사라져야 함 — handleDeath 가 필요한 폭탄을 큐로 옮겨놓음.
      // detonateBomb 가 deferEmit 으로 호출되며 큐의 폭탄 좌표 그대로 사용 가능 — 단, 축소 영역 안에 들어있는 폭탄만.
      room._boardShrinkDeaths = true;
      for (const dp of deadPieces) {
        handleDeath(room, dp.piece, dp.ownerIdx);
      }
      room._boardShrinkDeaths = false;
      for (let i = 0; i < room.players.length; i++) {
        if (room.boardObjects[i]) room.boardObjects[i] = room.boardObjects[i].filter(o => inBounds(o.col, o.row, room.boardBounds));
        if (room.rats[i]) room.rats[i] = room.rats[i].filter(r => inBounds(r.col, r.row, room.boardBounds));
      }
      // 유해도 축소 범위 밖 제거
      if (room.remains) room.remains = room.remains.filter(r => inBounds(r.col, r.row, room.boardBounds));
      emitToBoth(room, 'board_shrink', {
        newBounds: room.boardBounds, bounds: room.boardBounds,
        eliminated, stage: ev.stage,
        key: ev.key,                          // 같은 식별자 — 클라가 매칭되는 경고 박스 제거에 사용
        stalemate: !!ev.stalemate,
      });
      emitToSpectators(room, 'spectator_log', { msg: '보드 외곽 파괴', type: 'event' });
      queueAnim(DUR_BOARD_SHRINK);
      // 축소 애니 후 사망 기폭 시퀀스 — flushPhase 가 적절한 cursor 로 emit 들 스케줄.
      //   onComplete 에서 무승부/승패 검사
      flushPhase(room, () => {
        if (rooms[room.id] && room.phase === 'game') {
          checkGameEndAfterPhase(room);
        }
      });
      // 축소로 인한 승부 체크는 페이즈 종료 후 처리되도록 큐잉
      // (즉시 endGame 하면 애니메이션 도중 게임 종료 → 후속 SP 지급 등 끊김)
      // 현재 위치에서는 일단 그대로 두고, 후속 코드의 win check 가 해결하게 함.
    }
  }

  // ★ Pre-curse HP 스냅샷 — 보드 축소 후 캡처 (이때 축소 사망 piece 는 hp=0).
  //   curse_tick 이 0.5 데미지 적용하기 전 시점이므로, (preHp - currentHp) 차이는 곧 저주 데미지만 반영.
  //   축소 사망 piece 는 preHp=0/currentHp=0 → diff=0 → 보라 도장 X. (사용자 보고된 버그 수정).
  const preCurseHpsSnap = {};
  for (let i = 0; i < room.players.length; i++) {
    preCurseHpsSnap[i] = (room.players[i].pieces || []).map(p => (p && p.alive === false) ? 0 : (p && p.hp != null ? p.hp : 0));
  }
  room._preCurseHpsSnap = preCurseHpsSnap;

  // ── SP 지급 (애니메이션 페이즈의 *마지막* — 사용자 요청 #24) ──
  let spGrantedThisTurn = false;
  if (room.turnNumber > 0 && room.turnNumber % 10 === 0 && room.turnNumber <= 40) {
    const poolTotal = room.sp[0] + room.sp[1];
    if (poolTotal < 10) {
      room.sp[0] = Math.min(room.sp[0] + 1, 10);
      room.sp[1] = Math.min(room.sp[1] + 1, 10);
      const newTotal = room.sp[0] + room.sp[1];
      if (newTotal > 10) {
        const excess = newTotal - 10;
        // ★ 초과분은 SP가 더 많은 쪽에서 차감 (이전: 항상 sp[1]만 차감 → 인덱스1/팀1 고정 불이익).
        //   동점이면 sp[0] 기준으로 차감하여 결정적(deterministic)으로 동작.
        if (room.sp[0] >= room.sp[1]) room.sp[0] = Math.max(0, room.sp[0] - excess);
        else room.sp[1] = Math.max(0, room.sp[1] - excess);
      }
    }
    emitToBoth(room, 'turn_event', {
      type: 'sp_grant',
      msg: '새로운 SP가 지급되었습니다',
      sp: room.sp,
      instantSp: room.instantSp,
    });
    emitToSpectators(room, 'spectator_log', { msg: '새로운 SP가 지급되었습니다', type: 'event' });
    queueAnim(DUR_SP_GRANT);
    spGrantedThisTurn = true;
  }

  // 애니메이션 페이즈 종료 시각 기록 — AI/저주틱 등 후속 처리 대기 시각.
  // ★ 사용자 요청: 애니메이션 종료 직후 곧바로 저주 데미지 발동 — 버퍼 1500ms → 200ms 로 단축.
  const ANIM_PHASE_TAIL_BUFFER = 200;
  if (animTotalMs > 0) {
    room._animPhaseEndsAt = Date.now() + animTotalMs + ANIM_PHASE_TAIL_BUFFER;
  } else {
    room._animPhaseEndsAt = 0;
  }
  // 레거시 호환
  room._spGrantBlockedUntil = room._animPhaseEndsAt || 0;

  // 저주 틱·축소 처리는 애니메이션 페이즈 이후로 미룸
  const continueTurnStart = () => {
    // 지연 실행 중 다른 플레이어 턴으로 넘어갔으면 저주 틱 스킵 (타이머 만료+즉시 턴 종료 경쟁 방지)
    if (!rooms[room.id] || room.phase !== 'game' || room.currentPlayerIdx !== idx) return;
    // Process curse damage at the start of this player's turn
    for (const p of player.pieces) {
      if (p.alive) {
        const curse = p.statusEffects.find(e => e.type === 'curse');
        if (curse) {
          const sourceIdx = curse.source;
          const sourceWitch = room.players[sourceIdx]?.pieces.find(pc => pc.type === 'witch' && pc.alive);
          if (!sourceWitch || p.hp <= 1) {
            p.statusEffects = p.statusEffects.filter(e => e.type !== 'curse');
            const reason = !sourceWitch ? '마녀가 사망해' : '체력 고갈로';
            emitToBoth(room, 'passive_alert', { type: 'curse_removed', playerIdx: idx, targetName: p.name, msg: `저주: ${reason} ${p.name}의 저주 해제` });
            emitToSpectators(room, 'spectator_log', { msg: `저주: ${reason} ${p.name}의 저주 해제`, type: 'passive', playerIdx: idx });
          } else {
            p.hp = Math.max(0, p.hp - 0.5);
            emitToBoth(room, 'curse_tick', { playerIdx: idx, targetName: p.name, damage: 0.5, newHp: p.hp });
            // 관전자에게도 저주 데미지 모션 공유 — col/row 직접 전달(이름 역조회 불필요). 1v1·팀 모두 동일 처리.
            emitToSpectators(room, 'spectator_curse_tick', { playerIdx: idx, targetName: p.name, col: p.col, row: p.row, damage: 0.5, newHp: p.hp });
            if (p.hp <= 0) {
              handleDeath(room, p, idx);
            } else {
              checkCurseRemoval(room, p, idx);
            }
          }
        }
      }
    }
  };
  // continueTurnStart — 저주 틱 + 후속 처리. 애니메이션 페이즈가 있으면 그 종료 + 짧은 버퍼 후 실행.
  // ★ 사용자 요청: 1500ms 버퍼 → 200ms 로 단축 (애니 종료 직후 곧바로 저주 데미지 발동).
  const _phaseDelay = animTotalMs > 0 ? (animTotalMs + ANIM_PHASE_TAIL_BUFFER) : 0;
  if (_phaseDelay > 0) {
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      continueTurnStart();
    }, _phaseDelay);
  } else {
    continueTurnStart();
  }
  room._spGrantedThisTurn = spGrantedThisTurn;  // endTurn 측 AI 트리거 지연용 (레거시)

  // ── 보드 축소 후 승부 체크 ──
  //   축소로 인해 누군가 탈락했으면 승부 결과 emit. 애니메이션 페이즈는 클라에서 이미 진행 중이라
  //   server-side 승부 처리만 즉시 (game_over 이벤트는 client 가 받지만 내부적으로 전환되도 OK).
  //   ★ 사망 기폭 페이즈가 deferred 되어 있으면 sync 검사 skip — flushPhase callback 이 처리.
  if (room.boardShrinkStage > 0 && (animTotalMs > 0) && !room._phaseDeferredGameEndCheck) {
    if (room.mode === 'team') {
      const aElim = isTeamEliminated(room, 0);
      const bElim = isTeamEliminated(room, 1);
      // ★ 픽스: 이전엔 1v1 전용 endGame 을 호출 + player-idx 인자로 잘못 넘겨 winner 가 undefined → uncaught (room.players[?].pieces TypeError) → 게임 freeze.
      //   팀모드에선 endTeamGame(room, winnerTeamId, reason) 가 정답.
      if (aElim && bElim) { setKillInfo(room, 'shrink', null, []); endTeamGame(room, 0, 'simultaneous_draw'); return; }
      if (aElim) { setKillInfo(room, 'shrink', null, []); endTeamGame(room, 1, 'shrink'); return; }
      if (bElim) { setKillInfo(room, 'shrink', null, []); endTeamGame(room, 0, 'shrink'); return; }
    } else {
      const p0Dead = checkWin(room, 0);
      const p1Dead = checkWin(room, 1);
      if (p0Dead && p1Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, -1, 'draw'); return; }
      if (p0Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 1, 'shrink'); return; }
      if (p1Dead) { setKillInfo(room, 'shrink', null, []); endGame(room, 0, 'shrink'); return; }
    }
    // LV1 + unreachable 무승부
    if (room.boardShrinkLevel === 1 && checkUnreachableDraw(room)) {
      setKillInfo(room, 'unreachable', null, []);
      if (room.mode === 'team') endTeamGame(room, 0, 'unreachable_draw');
      else endGame(room, -1, 'unreachable_draw');
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 자동 무승부 판정 — 두 조건 모두 만족 시에만 무승부
//   ① 보드 외곽 파괴가 2회 모두 완료 (보드가 1x1 — 이동 불가)
//   ② 이 상태에서 살아있는 모든 유닛 중 누구의 공격범위에도 '자기 자신의 위치'가 포함되지 않음
//      (1x1 에서 모두 같은 칸에 스택되므로, 자기-공격 가능한 유닛이 하나라도 있으면 누군가 칠 수 있음 → 무승부 아님)
// ═══════════════════════════════════════════════════════════════
function checkUnreachableDraw(room) {
  const bounds = room.boardBounds;
  // 조건 ①: 보드가 1x1 (= max-min+1 == 1)
  const cells = (bounds.max - bounds.min + 1);
  if (cells > 1) return false;
  // 살아있는 모든 유닛 중 누구라도 자기 위치를 공격할 수 있으면 무승부 아님
  for (const player of (room.players || [])) {
    for (const piece of (player.pieces || [])) {
      if (!piece.alive) continue;
      if (!inBounds(piece.col, piece.row, bounds)) continue;
      const atk = getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState });
      if (atk.some(c => c.col === piece.col && c.row === piece.row)) {
        return false;  // 자기 위치 공격 가능 → 누군가 스택된 적을 칠 수 있음 → 무승부 아님
      }
    }
  }
  // 조건 ②: 모두 자기-공격 불가 → 무승부
  return true;
}

// 보드 축소 스케줄 (모드별)
// 사용자 요청 (#24): 1v1은 70턴에 마지막 외곽 파괴, 10턴 전부터 카운트다운 경고
//                   팀전은 80턴에 마지막 외곽 파괴 (60턴 첫 축소 후 더 좁혀짐)
// 레벨 → 보드 칸 수 (LV4=7, LV3=5, LV2=3, LV1=1)
function _shrinkLevelToSize(level) {
  return ({ 4: 7, 3: 5, 2: 3, 1: 1 })[level] || 1;
}
// 레벨 → bounds (모드별 base 사이즈에 중앙 정렬)
function _levelToBounds(level, baseSize) {
  const targetSize = _shrinkLevelToSize(level);
  const offset = Math.floor((baseSize - targetSize) / 2);
  return { min: offset, max: baseSize - 1 - offset };
}
// 한 단계 축소 — LV1 이면 노옵
function decreaseBoardShrinkLevel(room) {
  if (room.boardShrinkLevel <= 1) return false;
  room.boardShrinkLevel--;
  const baseSize = room.mode === 'team' ? 7 : 5;
  room.boardBounds = _levelToBounds(room.boardShrinkLevel, baseSize);
  return true;
}

// schedule — 트리거 시점 (warn/shrink) 의 array. 매 트리거마다 -1 LV.
//   1대1교전(stalemate) 은 기존 schedule 과 *cumulative* — replace 하지 않고 추가 트리거.
function getBoardShrinkSchedule(room) {
  const events = [];
  if (room.mode === 'team') {
    events.push({ warnTurn: 20, shrinkTurn: 30, key: 'team-30' });
    events.push({ warnTurn: 50, shrinkTurn: 60, key: 'team-60' });
    events.push({ warnTurn: 70, shrinkTurn: 80, key: 'team-80' });
  } else {
    events.push({ warnTurn: 40, shrinkTurn: 50, key: '1v1-50' });
    events.push({ warnTurn: 60, shrinkTurn: 70, key: '1v1-70' });
  }
  if (room.stalemateShrinkTurn != null) {
    events.push({
      warnTurn: Math.max(0, room.stalemateShrinkTurn - 5),
      shrinkTurn: room.stalemateShrinkTurn,
      key: `stalemate-${room.stalemateShrinkTurn}`,
      stalemate: true,
    });
  }
  events.sort((a, b) => a.shrinkTurn - b.shrinkTurn);
  // boardShrinkStage 호환을 위해 stage 필드 부여 (1부터 누적)
  let stage = 1;
  for (const ev of events) {
    ev.stage = stage++;
    ev.final = (stage > events.length);
  }
  return events;
}

// 1대1 대치 감지 — 양 플레이어 각 1유닛 alive 시 5턴 후 보드 축소 예약.
// 레벨 시스템 (#25): 이미 LV1 이면 의미 없으므로 스킵.
// 한 번 트리거 되면 cumulative — 기존 turn 50/70 schedule 과 함께 작동.
function detectStalemateShrink(room) {
  if (!room || room.mode === 'team') return;
  if (room.stalemateShrinkTriggered) return;   // 이미 트리거됨
  if (room.boardShrinkLevel <= 1) return;      // 더 이상 축소 불가 (LV1)
  const a = room.players[0]?.pieces.filter(p => p.alive).length || 0;
  const b = room.players[1]?.pieces.filter(p => p.alive).length || 0;
  if (a !== 1 || b !== 1) return;
  room.stalemateShrinkTriggered = true;
  room.stalemateShrinkTurn = room.turnNumber + 5;
  emitToBoth(room, 'turn_event', {
    type: 'stalemate_shrink',
    msg: '1대1 대치 상황: 5턴 후 보드가 축소됩니다.',
  });
  emitToSpectators(room, 'spectator_log', {
    msg: '1대1 대치 상황: 5턴 후 보드가 축소됩니다.',
    type: 'event',
  });
}

// ★ 쌍둥이 첫 이동 후 보류된 opp_moved 를 단일 알림으로 flush.
//   - 두번째 쌍둥이 이동 시: 그 자리에서 자연스럽게 발송되므로 호출 X (보류 플래그가 0).
//   - 첫 이동만 하고 턴 종료 / 스킵 / 타임아웃 시: 이 함수가 단일 알림 발송.
//   사용자 요청: 시전자가 페이즈 마무리에 단 한 번 받듯이, 상대도 같은 타이밍에 단 한 번만 받음.
function flushPendingTwinOppMove(room, idx) {
  if (!room || idx == null) return;
  const player = room.players[idx];
  if (!player || !player._pendingTwinOppMoveAt) return;
  player._pendingTwinOppMoveAt = 0;
  const moverName = player.name;
  const msg = `${moverName}${조사(moverName, '이', '가')} 이동했습니다.`;
  if (room.mode === 'team') {
    const enemyIdxs = getEnemyIndices(room, idx);
    for (const enIdx of enemyIdxs) {
      const en = room.players[enIdx];
      if (en && en.socketId && en.socketId !== 'AI') {
        io.to(en.socketId).emit('opp_moved', { msg });
      }
    }
  } else {
    const opp = room.players[1 - idx];
    if (opp && opp.socketId && opp.socketId !== 'AI') {
      io.to(opp.socketId).emit('opp_moved', { msg });
    }
  }
}

function endTurn(room, opts) {
  const isTimeout = !!(opts && opts.timeout);
  // AI 워치독 정리
  if (room._aiWatchdog) {
    clearTimeout(room._aiWatchdog);
    room._aiWatchdog = null;
  }
  // AI 턴 종료 핸들 정리 — 이중 endTurn 호출이나 stale setTimeout 방지
  const prevPlayerIdx = room.currentPlayerIdx;
  // ★ 쌍둥이 첫 이동만 하고 턴 종료한 경우 보류된 opp_moved 를 여기서 flush (모든 종료 경로 일괄 처리).
  flushPendingTwinOppMove(room, prevPlayerIdx);
  if (room._aiTurnEndHandle && room._aiTurnEndHandle[prevPlayerIdx]) {
    clearTimeout(room._aiTurnEndHandle[prevPlayerIdx]);
    room._aiTurnEndHandle[prevPlayerIdx] = null;
  }
  if (room._aiTurnEndWatchdog && room._aiTurnEndWatchdog[prevPlayerIdx]) {
    clearTimeout(room._aiTurnEndWatchdog[prevPlayerIdx]);
    room._aiTurnEndWatchdog[prevPlayerIdx] = null;
  }
  // ★ 사용자 요청: 턴 종료 알림 분기.
  //   1. 행동·스킬 모두 안 한 경우 → "턴 스킵" (자의 종료든 타임아웃이든 동일)
  //   2. 행동 또는 스킬 사용 + 타임아웃 → "턴 강제 종료"
  //   3. 행동 또는 스킬 사용 + 자의 종료 → 토스트 없음 (정상 턴 종료)
  //   skillsUsedBeforeAction 만 봐서는 자유 스킬 (정찰·정비·신성 등) 누락 → _anySkillUsedThisTurn 사용.
  const prevPlayer = room.players[prevPlayerIdx];
  if (prevPlayer && prevPlayer.alive !== false) {
    const usedAction = !!prevPlayer.actionDone
      || !!prevPlayer.actionUsedSkillReplace
      || prevPlayer._lastActionType === 'move'
      || prevPlayer._lastActionType === 'attack';
    const usedSkill = !!prevPlayer._anySkillUsedThisTurn
      || (prevPlayer.skillsUsedBeforeAction && prevPlayer.skillsUsedBeforeAction.length > 0);
    const didNothing = !usedAction && !usedSkill;
    if (didNothing && prevPlayer.name) {
      // ★ 사용자 요청: 턴 스킵 관련 문구에 시계 이모지 prefix.
      const msg = `⏰ ${prevPlayer.name}의 턴 스킵`;
      if (typeof emitToBoth === 'function') emitToBoth(room, 'no_action_notice', { playerIdx: prevPlayerIdx, name: prevPlayer.name, msg, kind: 'skip' });
      emitToSpectators(room, 'spectator_log', { msg, type: 'event', playerIdx: prevPlayerIdx });
    } else if (isTimeout && prevPlayer.name) {
      // 행동/스킬은 했지만 타임아웃으로 강제 종료된 케이스
      const msg = `⏰ ${prevPlayer.name}의 턴 강제 종료`;
      if (typeof emitToBoth === 'function') emitToBoth(room, 'no_action_notice', { playerIdx: prevPlayerIdx, name: prevPlayer.name, msg, kind: 'forced' });
      emitToSpectators(room, 'spectator_log', { msg, type: 'event', playerIdx: prevPlayerIdx });
    }
    // 자의 종료 + 행동/스킬 사용 → 토스트 없음 (정상)
  }

  room.currentPlayerIdx = getNextPlayerIdx(room);
  room.turnNumber++;

  // ★ -1 반환 = 유효한 다음 플레이어 없음 (모든 팀 동시 전멸 등) → 즉시 게임 종료
  if (room.currentPlayerIdx === -1) {
    console.warn('[endTurn] getNextPlayerIdx returned -1, triggering game end');
    setKillInfo(room, 'simultaneous', null, []);
    if (room.mode === 'team') {
      const aElim = isTeamEliminated(room, 0);
      const bElim = isTeamEliminated(room, 1);
      if (aElim && bElim) { endTeamGame(room, 0, 'simultaneous_draw'); }
      else if (aElim)     { endTeamGame(room, 1); }
      else                { endTeamGame(room, 0); }
    } else {
      endGame(room, -1, 'draw');
    }
    return;
  }

  const curIdx = room.currentPlayerIdx;
  const prevIdx = getPrevPlayerIdx(room, curIdx);
  const cur = room.players[curIdx];
  const prev = room.players[prevIdx];

  // Process turn-start effects
  processTurnStart(room);

  // 승부 체크 (모드별)
  if (room.mode === 'team') {
    if (isTeamEliminated(room, 0)) { endTeamGame(room, 1); return; }
    if (isTeamEliminated(room, 1)) { endTeamGame(room, 0); return; }
  } else {
    if (checkWin(room, 0)) { endGame(room, 1); return; }
    if (checkWin(room, 1)) { endGame(room, 0); return; }
  }
  // 자동 무승부 — 보드 1x1 상태에서 어느 유닛도 자기-공격 불가일 때 (조건 1+2 모두 만족)
  if (checkUnreachableDraw(room)) {
    setKillInfo(room, 'unreachable', null, []);
    if (room.mode === 'team') endTeamGame(room, 0, 'unreachable_draw');
    else endGame(room, -1, 'unreachable_draw');
    return;
  }

  // ★ 헤드리스(셀프플레이): 상태 전이만 끝내고 emit/타이머/AI 스케줄은 스킵. 다음 턴은 드라이버가 구동.
  if (room._headless) return;

  const turnData = {
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    skillPoints: room.sp,
    boardBounds: room.boardBounds,
    preCurseHps: room._preCurseHpsSnap || null,   // 저주 보라 도장 표시용 (curse 적용 전 HP)
  };

  // ── 팀 모드 분기 ──
  if (room.mode === 'team') {
    broadcastTeamGameState(room, turnData);
    emitToSpectators(room, 'spectator_log', { msg: `${room.turnNumber}턴 : ${cur.name}의 차례`, type: 'system', playerIdx: curIdx });
    startTimer(room, 'game', () => turnTimeout(room));
    // 현재 차례가 AI라면 자동 행동 트리거. 애니메이션 페이즈 진행 중이면 그 종료 + 1.5s 까지 대기.
    if (cur && cur.socketId === 'AI') {
      const phaseRemain = Math.max(0, (room._animPhaseEndsAt || 0) - Date.now());
      // ★ #6: 턴 시작 지연 2500→2000 단축. ★ 상한 7000 — 폭탄 체인 등으로 _animPhaseEndsAt 가
      //   먼 미래로 누적돼 AI 턴 시작이 수십 초 지연(=프리징 체감)되는 것 방지(정상 페이즈는 7s 이내).
      const aiDelay = Math.min(7000, Math.max(2000, phaseRemain));
      // ★ epoch 토큰 — 동일 슬롯 재진입/중복 스케줄 시 stale 콜백이 aiTeamTakeTurn 을 중복 실행하지 못하게 차단.
      const _epoch = (room._aiSchedEpoch = (room._aiSchedEpoch || 0) + 1);
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === curIdx && room._aiSchedEpoch === _epoch) {
          aiTeamTakeTurn(room, curIdx);
        }
      }, aiDelay);
      // ★ FIX (#6 팀전 AI 프리징): 턴 시작 시 "턴 레벨" 안전 워치독.
      //   aiTeamTakeTurn 의 재진입 setTimeout 경로(스킬 후 재평가 등)는 scheduleAITurnEnd 워치독을
      //   거치지 않아, 그 경로에서 턴이 끝나지 못하면 무한 정지했다(실측: 한 AI 턴 18초 정지).
      //   이 워치독은 경로와 무관하게 turn 이 여전히 curIdx 면 강제 종료해 정지 구간을 없앤다.
      //   정상 복잡 턴(스킬+행동+애니)도 ~13s 안에 끝나므로 여유 마진을 둔 16s 캡.
      if (room._aiTurnWatchdog) clearTimeout(room._aiTurnWatchdog);
      const _wdEpoch = _epoch;
      room._aiTurnWatchdog = setTimeout(() => {
        room._aiTurnWatchdog = null;
        if (room.phase === 'game' && room.currentPlayerIdx === curIdx && room._aiSchedEpoch === _wdEpoch) {
          console.warn('[AI turn watchdog] forcing endTurn for stalled team AI', curIdx);
          room._aiEndTurnEarliest = 0;
          endTurn(room);
        }
      }, aiDelay + 16000);
    }
    return;
  }

  // AI turn
  if (room.isAI && curIdx === 1) {
    emitToPlayer(room, prevIdx, 'opp_turn', {
      ...turnData,
      oppPieces: oppPieceSummary(cur.pieces),
      boardObjects: boardObjectsSummary(room, prevIdx),
      remains: room.remains || [],
    });
    // AI 턴에도 타이머 리셋 (플레이어에게 시각적 표시)
    startTimer(room, 'game', () => turnTimeout(room));
    // 애니메이션 페이즈 진행 중이면 그 종료 + 1.5s 까지 대기, 그 외 3s.
    const phaseRemain = Math.max(0, (room._animPhaseEndsAt || 0) - Date.now());
    const aiDelay = Math.max(3000, phaseRemain);
    // ★ currentPlayerIdx === 1 확인 + epoch 토큰 — 턴이 이미 넘어갔거나 중복 스케줄된 경우
    //   stale 콜백이 aiTakeTurn 을 중복 실행하지 못하게 차단 (이전: phase 만 확인).
    const _epoch = (room._aiSchedEpoch = (room._aiSchedEpoch || 0) + 1);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === 1 && room._aiSchedEpoch === _epoch) aiTakeTurn(room);
    }, aiDelay);
    return;
  }

  // Human turn
  emitToPlayer(room, curIdx, 'your_turn', {
    ...turnData,
    yourPieces: pieceSummary(cur.pieces),
    oppPieces: oppPieceSummary(prev.pieces),
    boardObjects: boardObjectsSummary(room, curIdx),
    remains: room.remains || [],
    isYourTurn: true,
  });
  emitToPlayer(room, prevIdx, 'opp_turn', {
    ...turnData,
    oppPieces: oppPieceSummary(cur.pieces),
    boardObjects: boardObjectsSummary(room, prevIdx),
    remains: room.remains || [],
  });

  // 관전자에게 전체 상태 전송
  const curPlayer = room.players[room.currentPlayerIdx];
  emitToSpectators(room, 'spectator_log', { msg: `${room.turnNumber}턴 : ${curPlayer.name} 차례`, type: 'system', playerIdx: room.currentPlayerIdx });
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  // 턴 타이머 시작
  startTimer(room, 'game', () => turnTimeout(room));
}

// ── 팀전 게임 상태 브로드캐스트 ──
// 같은 팀끼리는 동일 페이로드 → 팀당 한 번만 빌드 (viewerIdx/myTeamId/isMyTurn 만 viewer 별 override).
function _buildTeamBaseStates(room) {
  const numPlayers = room.players.length;
  // 캐시: 모든 플레이어의 pieceSummary / oppPieceSummary / eliminated 1회 계산
  const piecesFull = new Array(numPlayers);
  const piecesOpp  = new Array(numPlayers);
  const eliminated = new Array(numPlayers);
  for (let i = 0; i < numPlayers; i++) {
    const pcs = room.players[i].pieces || [];
    piecesFull[i] = pieceSummary(pcs);
    piecesOpp[i]  = oppPieceSummary(pcs);
    eliminated[i] = isPlayerEliminated(room, i);
  }
  // 팀별 base state
  const teamIds = [...new Set(room.players.map(p => p.teamId))];
  const byTeam = {};
  for (const tid of teamIds) {
    const players = room.players.map(p => ({
      idx: p.index,
      name: p.name,
      teamId: p.teamId,
      slotPos: p.slotPos ?? 0,
      pieces: (p.teamId === tid) ? piecesFull[p.index] : piecesOpp[p.index],
      actionDone: !!p.actionDone,
      eliminated: eliminated[p.index],
    }));
    const boardObjects = [];
    for (let i = 0; i < numPlayers; i++) {
      const pTeam = room.players[i].teamId;
      if (pTeam === tid) {
        for (const o of (room.boardObjects[i] || [])) boardObjects.push({ ...o });
        for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
      } else {
        for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
      }
    }
    byTeam[tid] = {
      currentPlayerIdx: room.currentPlayerIdx,
      // ★ 사용자 보고 (턴오더 양쪽 슬롯 빛남 버그): 팀원 사망으로 슬롯이 대체되는 경우, 활성 슬롯을
      //   currentPlayerIdx 로만 판정하면 같은 플레이어가 차지한 두 슬롯이 모두 빛남.
      //   서버에서 turnSlotIdx (4슬롯 중 활성 슬롯 인덱스) 를 함께 보내 클라가 단일 슬롯만 빛나게.
      turnSlotIdx: room.turnSlotIdx,
      turnNumber: room.turnNumber,
      sp: room.sp,
      instantSp: room.instantSp,
      boardBounds: room.boardBounds,
      boardShrinkStage: room.boardShrinkStage,
      players,
      boardObjects,
      remains: room.remains || [],
      myTeamId: tid,
    };
  }
  return byTeam;
}

function getTeamGameStateFor(room, viewerIdx) {
  // 외부 호출자(개별 emit) 호환용 — 단일 viewer 계산.
  const byTeam = _buildTeamBaseStates(room);
  const viewerTeamId = room.players[viewerIdx]?.teamId;
  const base = byTeam[viewerTeamId];
  return {
    ...base,
    myIdx: viewerIdx,
    isMyTurn: room.currentPlayerIdx === viewerIdx,
  };
}

function broadcastTeamGameState(room, extra) {
  if (!room || room.mode !== 'team') return;
  // 팀 단위 base state — 각 팀당 1회 빌드 (4 viewer × 4 piece summary = 16회 → 4회로 감축).
  const byTeam = _buildTeamBaseStates(room);
  for (const p of room.players) {
    if (!p.socketId) continue;
    const base = byTeam[p.teamId];
    if (!base) continue;
    // viewer 별 override 만 얹어서 emit (얕은 복사 — players/boardObjects 배열은 팀 내 공유 OK).
    const state = {
      ...base,
      myIdx: p.index,
      isMyTurn: room.currentPlayerIdx === p.index,
    };
    if (extra) Object.assign(state, extra);
    io.to(p.socketId).emit('team_game_update', state);
  }
  // 관전자 — 풀데이터 (1회 빌드 후 전 관전자에게 동일 payload 재사용)
  const specs = (room.spectators || []);
  if (specs.length > 0) {
    const specState = getTeamSpectatorGameState(room);
    if (extra) Object.assign(specState, extra);
    for (const s of specs) {
      io.to(s.socketId).emit('team_spectator_update', specState);
    }
  }
}

// 팀전 관전자 — 4명 전원 풀데이터(좌표/상태/스킬 모두 가시)
function getTeamSpectatorGameState(room) {
  const players = room.players.map(p => ({
    idx: p.index,
    name: p.name,
    teamId: p.teamId,
    slotPos: p.slotPos ?? 0,
    deckName: p.deckName || '',
    pieces: pieceSummary(p.pieces),
    actionDone: !!p.actionDone,
    eliminated: isPlayerEliminated(room, p.index),
  }));
  const boardObjects = [];
  for (let i = 0; i < room.players.length; i++) {
    for (const o of (room.boardObjects[i] || [])) boardObjects.push({ ...o });
    for (const r of (room.rats[i] || [])) boardObjects.push({ type: 'rat', col: r.col, row: r.row, owner: i });
  }
  return {
    currentPlayerIdx: room.currentPlayerIdx,
    turnSlotIdx: room.turnSlotIdx,  // ★ 관전자도 단일 슬롯 강조용
    turnNumber: room.turnNumber,
    sp: room.sp,
    instantSp: room.instantSp,
    boardBounds: room.boardBounds,
    boardShrinkStage: room.boardShrinkStage,
    players,
    boardObjects,
    isSpectator: true,
    teams: room.teams,
    p0Name: room.players[0]?.name || '',
    p1Name: room.players[1]?.name || '',
    p2Name: room.players[2]?.name || '',
    p3Name: room.players[3]?.name || '',
  };
}

// 팀전 게임 종료
function endTeamGame(room, winnerTeamId, reason) {
  if (!room || room.phase === 'ended') return;  // ★ 재진입 방지 (동시 이중 호출로 game_over 2회 emit 차단)
  clearTimer(room);
  clearAiThinkState(room);
  room.phase = 'ended';
  const winners = (room.teams[winnerTeamId] || []).map(i => room.players[i]?.name).filter(Boolean);
  const losers = (room.teams[1 - winnerTeamId] || []).map(i => room.players[i]?.name).filter(Boolean);
  // 1v1처럼 구조화된 reason 객체 (type/killer/victims) 전달
  const killInfo = room.lastKillInfo || {};
  const reasonObj = reason === 'surrender' ? { type: 'surrender' }
    : reason === 'shrink' ? { type: 'shrink' }
    : reason === 'draw' ? { type: 'draw' }
    : reason === 'unreachable_draw' ? { type: 'unreachable_draw' }
    : reason === 'simultaneous_draw' ? { type: 'simultaneous_draw' }
    : reason === 'disconnect' ? { type: 'disconnect' }
    : { type: killInfo.type || 'attack', killer: killInfo.killer || null, victims: killInfo.victims || [] };
  const isDraw = reason === 'draw' || reason === 'unreachable_draw' || reason === 'simultaneous_draw';
  // 팀 컬러 라벨
  const winTeamLabel = winnerTeamId === 0 ? '블루팀' : '레드팀';
  const loseTeamLabel = winnerTeamId === 0 ? '레드팀' : '블루팀';
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('team_game_over', {
      win: isDraw ? null : (p.teamId === winnerTeamId),
      winnerTeamId: isDraw ? null : winnerTeamId,
      winTeamLabel, loseTeamLabel,
      winners, losers,
      reason: reasonObj,
    });
  }
  emitToSpectators(room, 'team_game_over', {
    winnerTeamId: isDraw ? null : winnerTeamId,
    winTeamLabel, loseTeamLabel, winners, losers,
    reason: reasonObj, spectator: true,
  });
  // ★ S-7: 종료된 방 자동 정리 (60초 후 메모리 해제)
  setTimeout(() => { if (rooms[room.id] && room.phase === 'ended') delete rooms[room.id]; }, 60000);
}

// ── 팀전: 재접속 실패한 플레이어 처리 ──
// 살아있는 팀원이 있으면 끊긴 플레이어만 탈락 처리하고 1v2 로 게임 속행.
// 팀에 남은 사람이 없으면(=팀 전멸) 팀 패배 처리.
function forfeitTeamPlayerByDisconnect(room, idx, name) {
  if (!room || room.mode !== 'team' || room.phase === 'ended') return;
  const player = room.players[idx];
  if (!player) return;
  const teamId = player.teamId;
  if (teamId !== 0 && teamId !== 1) return;

  // 같은 팀에 아직 탈락하지 않은 멤버가 있는지 확인 (끊긴 본인 제외).
  const teammates = (room.teams[teamId] || []).filter(j => j !== idx);
  const livingTeammate = teammates.some(j => {
    const tp = room.players[j];
    return tp && !isPlayerEliminated(room, j);
  });

  // 끊긴 플레이어의 말을 모두 제거 — 유해/폭발 등 연쇄 없이 깔끔히 탈락.
  if (player.pieces) {
    for (const pc of player.pieces) pc.alive = false;
  }
  if (!room.eliminatedPlayers) room.eliminatedPlayers = new Set();
  const alreadyElim = room.eliminatedPlayers.has(idx);
  room.eliminatedPlayers.add(idx);

  // 팀에 남은 사람이 없음 → 팀 패배.
  if (!livingTeammate) {
    emitToSpectators(room, 'spectator_log', { msg: `${name} 재접속 실패. ${teamId === 0 ? '블루' : '레드'}팀 패배.`, type: 'system', playerIdx: idx });
    endTeamGame(room, 1 - teamId, 'disconnect');
    return;
  }

  // 1v2 속행: 끊긴 플레이어만 탈락, 게임은 계속.
  if (!alreadyElim) {
    emitToBoth(room, 'team_player_eliminated', {
      playerIdx: idx,
      playerName: name,
      teamId,
      slotPos: player.slotPos ?? 0,
    });
  }
  emitToBoth(room, 'team_dc_continue', {
    playerIdx: idx,
    msg: `${name}${조사(name, '이', '가')} 재접속하지 못해 탈락했습니다. 남은 팀원이 계속 플레이합니다.`,
  });
  emitToSpectators(room, 'spectator_log', { msg: `${name} 재접속 실패 — 탈락. 팀원이 1v2로 속행.`, type: 'system', playerIdx: idx });

  // 안전 차원의 팀 전멸 재확인 (아군 탈락이라 보통 미충족).
  if (isTeamEliminated(room, teamId)) {
    endTeamGame(room, 1 - teamId, 'disconnect');
    return;
  }

  // 현재 차례가 끊긴 플레이어였다면 턴을 넘겨 팀원/다음 슬롯이 진행하게 함.
  if (room.phase === 'game' && room.currentPlayerIdx === idx) {
    endTurn(room, { timeout: false });
  } else {
    // 차례가 아니면 보드 갱신만 방송 (탈락한 말 제거 반영).
    broadcastTeamGameState(room);
  }
}

// ══════════════════════════════════════════════════════════════════
// ── AI 학습용 대국 로깅 (belief + 보드 truth + 결과 → Supabase) ──
//   vs-AI 게임에서만 동작. 모든 호출은 방어적(throw 시 게임 무영향).
// ══════════════════════════════════════════════════════════════════
function _aiIsVsAi(room) {
  if (!room) return false;
  if (room.isAI) return true;
  return (room.players || []).some(p => p && p.socketId === 'AI');
}
function _aiResolveBrain(room, idx) {
  try {
    if (room.mode === 'team') return getTeamBrain(room, getTeamOf(room, idx));
    return room.aiBrain || null;
  } catch (e) { return null; }
}
function _aiRound2Map(m) {
  if (!Array.isArray(m)) return null;
  return m.map(r => Array.isArray(r) ? r.map(v => Math.round((v || 0) * 100) / 100) : r);
}
function _aiPieceSt(pc) {
  const s = [];
  if (pc.cursed || pc.curse) s.push('curse');
  if (pc.marked || pc.mark) s.push('mark');
  if (pc.shadow || pc.shadowed) s.push('shadow');
  return s;
}
function _aiBoardSnap(room) {
  const pieces = [];
  (room.players || []).forEach((pl, idx) => {
    (pl.pieces || []).forEach((pc, pi) => {
      pieces.push({ idx, pi, type: pc.type, c: pc.col, r: pc.row,
        hp: pc.hp, mhp: pc.maxHp, alive: !!pc.alive, st: _aiPieceSt(pc) });
    });
  });
  return { pieces, bounds: room.boardBounds, turn: room.turnNumber };
}
function _aiBelief(brain) {
  if (!brain) return null;
  return { probMap: _aiRound2Map(brain.probMap), danger: _aiRound2Map(brain._dangerMap),
    mode: brain.mode, enemiesAlive: brain.enemiesAlive, hitMemory: brain.hitMemory || null };
}
function _aiTurnRec(room, idx) {
  if (!_aiIsVsAi(room)) return null;
  if (!room._aiLog) room._aiLog = { turns: [] };
  const log = room._aiLog;
  if (log._cur && log._cur.t === room.turnNumber && log._cur.idx === idx) return log._cur;
  const rec = { t: room.turnNumber, idx, belief: _aiBelief(_aiResolveBrain(room, idx)),
    board: _aiBoardSnap(room), sp: (room.players[idx] && room.players[idx].sp) || 0, actions: [] };
  log.turns.push(rec);
  log._cur = rec;
  return rec;
}
function aiLogTurnStart(room, idx) { try { _aiTurnRec(room, idx); } catch (e) {} }
function aiLogAction(room, idx, action) {
  try { const rec = _aiTurnRec(room, idx); if (rec) rec.actions.push(action); } catch (e) {}
}
function aiLogFlush(room, winnerIdx, reason) {
  try {
    if (!room || !room._aiLog || !room._aiLog.turns || !room._aiLog.turns.length) return;
    if (!aiLog.enabled()) { room._aiLog = null; return; }
    const drawish = /draw/.test(String(reason || ''));
    const aiIdxs = (room.players || []).map((p, i) => (p && p.socketId === 'AI') ? i : -1).filter(i => i >= 0);
    let result = 'draw';
    if (!drawish && typeof winnerIdx === 'number' && winnerIdx >= 0) {
      result = aiIdxs.includes(winnerIdx) ? 'ai_win' : 'ai_loss';
    }
    let playerId = null;
    (room.players || []).forEach(p => {
      if (p && p.socketId && p.socketId !== 'AI') {
        const sock = io.sockets.sockets.get(p.socketId);
        const uid = sock && sock.data && sock.data.user && sock.data.user.id;
        if (uid) playerId = uid;
      }
    });
    aiLog.saveMatchLog({
      mode: (room.mode === 'team') ? 'team' : '1v1',
      player_id: playerId, result, turns: room._aiLog.turns.length,
      replay: { winnerIdx, reason, aiIdxs, turns: room._aiLog.turns },
    });
    room._aiLog = null;  // 중복 flush 방지
  } catch (e) { console.error('[aiLog] flush', e.message); }
}

function endGame(room, winnerIdx, reason) {
  if (!room || room.phase === 'ended') return;  // ★ 재진입 방지 (이중 game_over emit 차단)
  try { aiLogFlush(room, winnerIdx, reason); } catch (e) {}  // AI 학습 로깅 (방어적)
  clearTimer(room);
  clearAiThinkState(room);
  room.phase = 'ended';
  const killInfo = room.lastKillInfo || {};
  const reasonObj = reason === 'surrender' ? { type: 'surrender' }
    : reason === 'shrink' ? { type: 'shrink' }
    : reason === 'draw' ? { type: 'draw' }
    : reason === 'unreachable_draw' ? { type: 'unreachable_draw' }
    : reason === 'simultaneous_draw' ? { type: 'simultaneous_draw' }
    : reason === 'disconnect' ? { type: 'disconnect' }
    : { type: killInfo.type || 'attack', killer: killInfo.killer || null, victims: killInfo.victims || [] };

  // Draw (양 팀 전멸 또는 unreachable — 게임 끝낼 수 없음)
  if (reason === 'draw' || reason === 'unreachable_draw' || reason === 'simultaneous_draw') {
    for (let i = 0; i < 2; i++) {
      emitToPlayer(room, i, 'game_over', { win: null, draw: true, reason: reasonObj });
    }
    emitToSpectators(room, 'game_over', { win: null, draw: true, spectator: true, reason: reasonObj,
      winnerName: room.players[0].name, loserName: room.players[1].name });
    // ★ S-7: 종료된 방 자동 정리 (60초 후 메모리 해제)
    setTimeout(() => { if (rooms[room.id] && room.phase === 'ended') delete rooms[room.id]; }, 60000);
    return;
  }

  // ★ winnerIdx 범위 검증 — draw 가 아닌데 winnerIdx 가 0/1 이 아니면 room.players[-1]/players[2]
  //   접근으로 서버 크래시. 안전하게 무승부로 폴백.
  if (winnerIdx !== 0 && winnerIdx !== 1) {
    console.error(`[endGame] 잘못된 winnerIdx=${winnerIdx} (reason=${reason}) — 무승부로 폴백`);
    for (let i = 0; i < 2; i++) {
      emitToPlayer(room, i, 'game_over', { win: null, draw: true, reason: { type: 'draw' } });
    }
    emitToSpectators(room, 'game_over', { win: null, draw: true, spectator: true, reason: { type: 'draw' },
      winnerName: room.players[0]?.name, loserName: room.players[1]?.name });
    setTimeout(() => { if (rooms[room.id] && room.phase === 'ended') delete rooms[room.id]; }, 60000);
    return;
  }

  const winner = room.players[winnerIdx];
  const loser = room.players[1 - winnerIdx];
  const finalPiecesW = { yours: pieceSummary(winner.pieces), opps: pieceSummary(loser.pieces) };
  const finalPiecesL = { yours: pieceSummary(loser.pieces), opps: pieceSummary(winner.pieces) };

  // #15: 패배 측에 승자의 모든 piece 좌표(살아있는 것만) + 보드 오브젝트(덫·폭탄·쥐) + boardBounds 노출
  // — 패배 시 마지막 보드 상태 그리드 재현 용도
  const replayWinnerPieces = winner.pieces.map(pc => ({
    type: pc.type, name: pc.name, icon: pc.icon, hp: pc.hp, maxHp: pc.maxHp,
    col: pc.col, row: pc.row, alive: pc.alive, subUnit: pc.subUnit || null,
  }));
  const replayBoardObjects = [
    ...((room.boardObjects?.[winnerIdx] || []).map(o => ({ ...o, owner: 'opp' }))),
    ...((room.boardObjects?.[1 - winnerIdx] || []).map(o => ({ ...o, owner: 'me' }))),
  ];

  emitToPlayer(room, winnerIdx, 'game_over', { win: true, opponentName: loser.name, finalPieces: finalPiecesW, reason: reasonObj });
  emitToPlayer(room, 1 - winnerIdx, 'game_over', {
    win: false, opponentName: winner.name, finalPieces: finalPiecesL, reason: reasonObj,
    replayWinnerPieces, replayBoardObjects, replayBounds: room.boardBounds,
  });
  emitToSpectators(room, 'game_over', { win: null, winnerName: winner.name, loserName: loser.name, spectator: true, reason: reasonObj });
  // ★ S-7: 종료된 방 자동 정리 (60초 후 메모리 해제)
  setTimeout(() => { if (rooms[room.id] && room.phase === 'ended') delete rooms[room.id]; }, 60000);
}

// ══════════════════════════════════════════════════════════════════
// ── Skill Execution ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function executeSkill(room, playerIdx, pieceIdx, skillId, params) {
  const player = room.players[playerIdx];
  const piece = player.pieces[pieceIdx];
  if (!piece || !piece.alive) return { ok: false, msg: '올바르지 않은 말입니다.' };
  if (!piece.hasSkill) return { ok: false, msg: '이 말은 스킬이 없습니다.' };

  // 저주 상태이면 스킬 봉인
  if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) {
    return { ok: false, msg: '저주 상태에서는 스킬을 사용할 수 없습니다.' };
  }

  // Look up skill cost — 다중 스킬 지원 (화약상 등)
  let cost = piece.skillCost;
  const baseChar = getChar(piece.type === 'twins_elder' || piece.type === 'twins_younger' ? 'twins' : piece.type);
  if (baseChar && baseChar.skills.length > 1 && skillId) {
    const matchedSkill = baseChar.skills.find(s => s.id === skillId);
    if (matchedSkill) cost = matchedSkill.cost;
  }

  // Check SP (regular + instant) — 팀모드는 teamId 슬롯
  const spSlot = teamSlotIdx(room, playerIdx);
  if ((room.sp[spSlot] + room.instantSp[spSlot]) < cost) return { ok: false, msg: 'SP가 부족합니다.' };

  // 턴당 1회 제한 체크 (oncePerTurn)
  const effectiveSkillId = skillId || piece.skillId;
  const matchedSkillForOnce = baseChar ? baseChar.skills.find(s => s.id === effectiveSkillId) : null;
  if (matchedSkillForOnce && matchedSkillForOnce.oncePerTurn) {
    const usedKey = `${pieceIdx}:${effectiveSkillId}`;
    if (player.skillsUsedBeforeAction.includes(usedKey)) {
      return { ok: false, msg: '이 스킬은 턴당 1회만 사용할 수 있습니다.' };
    }
  }

  // Determine if this is a replacesAction skill (다중 스킬 지원)
  let replacesAction = piece.skillReplacesAction;
  if (baseChar && baseChar.skills.length > 1 && skillId) {
    const matchedSkill = baseChar.skills.find(s => s.id === skillId);
    if (matchedSkill) replacesAction = matchedSkill.replacesAction;
  }

  // If skill replaces action and action already done, can't use
  if (replacesAction && player.actionDone) {
    return { ok: false, msg: '이미 행동을 사용했습니다. 행동 대체 스킬을 사용할 수 없습니다.' };
  }

  const result = { ok: true, msg: '', data: {} };
  const bounds = room.boardBounds;

  // Resolve skill by piece type
  const effectiveType = piece.type;

  switch (effectiveType) {
    // ── ARCHER: 정비 (toggle diagonal direction) ──
    case 'archer': {
      piece.toggleState = (piece.toggleState === 'right') ? null : 'right';
      spendSP(room, playerIdx, cost);
      result.msg = `정비: 공격 방향 전환`;
      result.oppMsg = `정비: 공격 방향 전환`;
      result.data.toggleState = piece.toggleState;
      break;
    }

    // ── TWINS: 의좋은형제 (move one twin to the other) ──
    case 'twins_elder':
    case 'twins_younger': {
      const elderTwin = player.pieces.find(p => p.subUnit === 'elder' && p.alive);
      const youngerTwin = player.pieces.find(p => p.subUnit === 'younger' && p.alive);
      if (!elderTwin || !youngerTwin) return { ok: false, msg: '쌍둥이 중 하나가 쓰러져 분신을 사용할 수 없습니다.' };

      const mover = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'elder' && p.alive)
        : player.pieces.find(p => p.subUnit === 'younger' && p.alive);
      const target = params?.target === 'elder'
        ? player.pieces.find(p => p.subUnit === 'younger' && p.alive)
        : player.pieces.find(p => p.subUnit === 'elder' && p.alive);

      if (!mover || !target) return { ok: false, msg: '대상이 없습니다.' };
      // ★ 사용자 보고: 이미 같은 칸에 합류된 상태라면 분신 사용 불가 (이동이 무의미).
      if (mover.col === target.col && mover.row === target.row) {
        return { ok: false, msg: '이미 합류 상태 — 분신 불필요' };
      }
      // 유해 차단 — 대상 쌍둥이 위치에 유해가 있으면 합류 불가
      if (room.remains && room.remains.some(r => r.col === target.col && r.row === target.row)) {
        return { ok: false, msg: '유해가 있는 위치로는 합류할 수 없습니다.' };
      }
      // ★ 비행 애니메이션용 — 이동 전 좌표를 캡쳐 (시전자/상대방/관전자 모두 동일 from→to 사용)
      const _twinFromCol = mover.col, _twinFromRow = mover.row;
      const _twinToCol   = target.col, _twinToRow   = target.row;
      mover.col = target.col;
      mover.row = target.row;
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      const moverSubject = mover.subUnit === 'elder' ? '누나가' : '동생이';
      const moverObject  = mover.subUnit === 'elder' ? '누나를' : '동생을';
      const targetLabel  = target.subUnit === 'elder' ? '누나' : '동생';
      result.msg = `분신: ${moverSubject} ${targetLabel} 위치로 합류`;
      result.oppMsg = `분신: ${moverSubject} ${targetLabel} 위치로 합류`;
      // 시전자/상대/관전자 모두에게 비행 애니메이션 정보 전달 (fog of war 우회용)
      result.data = result.data || {};
      result.data.twinJoin = {
        moverSub: mover.subUnit,
        fromCol: _twinFromCol, fromRow: _twinFromRow,
        toCol:   _twinToCol,   toRow:   _twinToRow,
      };
      break;
    }

    // ── SCOUT: 정찰 (reveal random enemy's row or col) ──
    case 'scout': {
      // 팀모드: 모든 상대팀 유닛 중에서 랜덤 / 1v1: 상대 1명
      let enemyPieces;
      if (room.mode === 'team') {
        const enemyIndices = getEnemyIndices(room, playerIdx);
        enemyPieces = enemyIndices.flatMap(ei => (room.players[ei]?.pieces || []).filter(p => p.alive && !p.isDragon));
      } else {
        enemyPieces = room.players[1 - playerIdx].pieces.filter(p => p.alive && !p.isDragon);
      }
      if (enemyPieces.length === 0) return { ok: false, msg: '적이 없습니다.' };
      const target = enemyPieces[Math.floor(Math.random() * enemyPieces.length)];
      const axis = Math.random() < 0.5 ? 'row' : 'col';
      const value = axis === 'row' ? target.row : target.col;
      spendSP(room, playerIdx, cost);
      // scout_result — 시전자 + 팀원에게 위치 정보 전달 (자체 addLog/toast 처리)
      if (room.mode === 'team') {
        const allies = getAllyIndices(room, playerIdx);
        for (const aIdx of allies) {
          emitToPlayer(room, aIdx, 'scout_result', { axis, value, targetName: target.name });
        }
      } else {
        emitToPlayer(room, playerIdx, 'scout_result', { axis, value, targetName: target.name });
      }
      // 적 측 메시지는 use_skill 핸들러의 status_update / team_skill_notice 로 자동 전달.
      // ★ 중복된 "[이름] - 정찰" 메시지 제거: scout_result 가 시전자/팀원을 커버하므로
      //   team_skill_notice 의 폴백 텍스트가 추가되지 않도록 result.allyMsg = '' (빈 문자열) 명시.
      result.oppMsg = `정찰: 상대가 ${target.name}의 위치를 알아냈습니다.`;
      result.allyMsg = '';   // 빈 문자열 — 팀원 시점에 team_skill_notice 의 fallback 출력 차단
      // 인벤토리 E1 관전자 셀: "정찰: 상대 [target]의 위치는 [label]"
      const labelStr = axis === 'row' ? `${['A','B','C','D','E','F','G'][value] || value}열` : `${value+1}행`;
      emitToSpectators(room, 'spectator_log', { msg: `정찰: 상대 ${target.name}의 위치는 ${labelStr}`, type: 'skill', playerIdx: playerIdx });
      result.skipLog = true;
      break;
    }

    // ── MANHUNTER: 덫 설치 ──
    case 'manhunter': {
      // ★ 사용자 보고: 같은 팀의 덫/폭탄만 중복 차단 (상대 placement 는 fog-of-war — 무관).
      //   1v1 → 본인만, 팀모드 → 같은 팀 전원.
      const ownTeamIndices = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
      const allyObjAtCell = ownTeamIndices.some(idx =>
        (room.boardObjects[idx] || []).some(o =>
          (o.type === 'trap' || o.type === 'bomb') && o.col === piece.col && o.row === piece.row));
      if (allyObjAtCell) {
        return { ok: false, msg: '이미 덫/폭탄이 설치된 칸입니다.' };
      }
      room.boardObjects[playerIdx].push({ type: 'trap', col: piece.col, row: piece.row, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `덫 설치: 설치 완료`;
      result.oppMsg = `덫 설치: 상대의 덫 설치`;
      break;
    }

    // ── MESSENGER: 질주 — 이동권 +1회 ──
    // 사용 가능: 아직 행동 없음 / 본인(전령) 이동 후
    // 사용 불가: 누구든 공격함 / 다른 유닛이 이동함
    case 'messenger': {
      if (player._lastActionType === 'attack') {
        return { ok: false, msg: '공격 후에는 질주를 사용할 수 없습니다.' };
      }
      if (player._lastActionType === 'move' &&
          (player._lastActionPieceType !== 'messenger')) {
        return { ok: false, msg: '다른 유닛이 이동했으므로 질주를 사용할 수 없습니다.' };
      }
      // 질주 활성화 — 이번 턴 이동권 1회 추가 제공
      piece.messengerSprintActive = true;
      // 이동권: 아직 이동 안 했으면 2회, 이미 1회 이동했으면 1회 더 남음
      piece.messengerMovesLeft = player.actionDone ? 1 : 2;
      // ★ 사용자 정정: 질주는 자유 시전형 1회 (replacesAction:false, oncePerTurn:true) —
      //   actionUsedSkillReplace 부여 금지. 본 라인이 클라 측 모든 행동 차단을 유발했음.
      //   공격 차단이 필요하다면 별도 플래그를 도입해야 하지만, 자유시전형 정의상 공격도 가능.
      spendSP(room, playerIdx, cost);
      result.msg = `질주: 전령은 추가 이동 가능`;
      result.oppMsg = `질주: 전령은 추가 이동 가능`;
      break;
    }

    // ── GUNPOWDER: 시한폭탄 설치 / 기폭 ──
    case 'gunpowder': {
      if (skillId === 'detonate') {
        // 기폭: 설치한 폭탄 모두 폭발 (SP 0)
        const bombs = room.boardObjects[playerIdx].filter(o => o.type === 'bomb');
        if (bombs.length === 0) return { ok: false, msg: '설치된 폭탄이 없습니다.' };
        const allHits = [];
        const deferredBombEmits = [];  // skill_result 이후에 emit할 폭탄 데이터
        for (const bomb of bombs) {
          const hits = detonateBomb(room, playerIdx, bomb, { deferEmit: true });
          allHits.push(...hits);
          // ★ owner 추가 — 클라가 팀 컬러 (mine 파랑 / enemy 빨강) 결정
          //   remainsHits — 이 폭탄 셀 유해 피격 (blast 타이밍에 클라가 재생)
          //   destroyedRats — 이 폭탄 셀 적 쥐 격파 (blast 타이밍에 클라가 사망 애니 재생)
          deferredBombEmits.push({ col: bomb.col, row: bomb.row, hits, owner: playerIdx, remainsHits: room._lastBombRemainsHits || [], destroyedRats: room._lastBombDestroyedRats || [] });
        }
        room.boardObjects[playerIdx] = room.boardObjects[playerIdx].filter(o => o.type !== 'bomb');
        result.msg = `기폭: 폭탄 폭발!`;
        result.oppMsg = `기폭: 폭탄 폭발!`;
        result.data.hits = allHits;
        result.data.deferredBombEmits = deferredBombEmits;  // 외부에서 사용
        break;
      }
      // 시한폭탄 설치 — 자기 칸 제외, 인접 8칸만 가능
      const tc = params?.col;
      const tr = params?.row;
      if (tc === undefined || tr === undefined) {
        return { ok: false, msg: '설치 위치를 지정하세요.' };
      }
      if (Math.abs(tc - piece.col) > 1 || Math.abs(tr - piece.row) > 1) {
        return { ok: false, msg: '인접 8칸에만 설치 가능합니다.' };
      }
      if (tc === piece.col && tr === piece.row) {
        return { ok: false, msg: '자신의 칸에는 설치할 수 없습니다.' };
      }
      if (!inBounds(tc, tr, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      // ★ 사용자 보고: 같은 팀의 덫/폭탄만 중복 차단. 상대 placement 는 fog-of-war — 무관.
      const ownTeamIndicesB = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
      const bombOverlap = ownTeamIndicesB.some(idx =>
        (room.boardObjects[idx] || []).some(o =>
          (o.type === 'trap' || o.type === 'bomb') && o.col === tc && o.row === tr));
      if (bombOverlap) {
        return { ok: false, msg: '이미 덫/폭탄이 설치된 칸입니다.' };
      }
      room.boardObjects[playerIdx].push({ type: 'bomb', col: tc, row: tr, owner: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `폭탄 설치: 설치 완료`;
      result.oppMsg = `폭탄 설치: 상대의 폭탄 설치`;
      break;
    }

    // ── HERBALIST: 약초학 (heal 3x3 allies +1 HP, not self) ──
    // 팀모드: 팀원 아군도 대상 포함
    case 'herbalist': {
      let healed = 0;
      const healedIdxs = [];                     // 시전자 자신의 pieces 인덱스만 (1v1 backward compat)
      const healedPieces = [];                   // ★ 모든 회복 대상 — { ownerIdx, pieceIdx } (팀모드 팀원 포함)
      const allyIndices = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
      for (const aIdx of allyIndices) {
        const allyPlayer = room.players[aIdx];
        for (const ally of allyPlayer.pieces) {
          if (ally.alive && ally !== piece && Math.abs(ally.col - piece.col) <= 1 && Math.abs(ally.row - piece.row) <= 1) {
            if (ally.hp < ally.maxHp) {
              ally.hp = Math.min(ally.maxHp, ally.hp + 1);
              healed++;
              const pIdx = allyPlayer.pieces.indexOf(ally);
              healedPieces.push({ ownerIdx: aIdx, pieceIdx: pIdx });
              if (aIdx === playerIdx) healedIdxs.push(pIdx);
            }
          }
        }
      }
      spendSP(room, playerIdx, cost);
      result.data.healedPieceIdxs = healedIdxs;
      result.data.healedPieces = healedPieces;
      // ★ 약초학 시전 애니용 — 시전자(약초전문가) 위치를 보드 애니의 중심으로.
      result.data.herbCenter = { col: piece.col, row: piece.row };
      result.msg = `약초학: 범위 내 아군 1 HP 회복`;
      result.oppMsg = `약초학: 범위 내 아군 1 HP 회복`;
      break;
    }

    // ── SHADOW ASSASSIN: 그림자 숨기 ──
    case 'shadowAssassin': {
      if (piece.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '이미 그림자 상태입니다.' };
      }
      piece.statusEffects.push({ type: 'shadow', source: playerIdx });
      spendSP(room, playerIdx, cost);
      result.msg = `그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역`;
      result.oppMsg = `그림자 숨기: 그림자 암살자는 다음 턴까지 공격·상태이상 면역`;
      break;
    }

    // ── WITCH: 저주 (직접 대상 지정 — 턴당 0.5 피해 + 스킬 봉인) ──
    case 'witch': {
      const tIdx = params?.targetPieceIdx;
      // 팀모드: targetOwnerIdx로 적팀 멤버 식별, 1v1: 상대 단일
      const targetOwnerIdx = (params?.targetOwnerIdx != null) ? params.targetOwnerIdx : (1 - playerIdx);
      const opponent = room.players[targetOwnerIdx];
      if (!opponent || tIdx === undefined || !opponent.pieces[tIdx]) {
        return { ok: false, msg: '저주 대상을 선택하세요.' };
      }
      // 팀모드: 적팀 검증 (자신/팀원에는 못 검)
      if (room.mode === 'team' && opponent.teamId === room.players[playerIdx].teamId) {
        return { ok: false, msg: '같은 팀원에게는 저주를 걸 수 없습니다.' };
      }
      const target = opponent.pieces[tIdx];
      if (!target.alive || target.hp <= 1) {
        return { ok: false, msg: 'HP가 1 이하인 대상에게는 저주를 걸 수 없습니다.' };
      }
      if (target.statusEffects.some(e => e.type === 'curse')) {
        return { ok: false, msg: '이미 저주 상태입니다.' };
      }
      // 그림자 상태 면역
      if (target.statusEffects.some(e => e.type === 'shadow')) {
        return { ok: false, msg: '그림자 상태의 대상에게는 저주를 걸 수 없습니다.' };
      }
      // 호위 무사 충성 — 왕실 아군이 받을 상태이상도 호위무사가 대신 받음
      let curseTarget = target;
      let curseTargetOwnerIdx = targetOwnerIdx;
      if (target.tag === 'royal' && target.type !== 'bodyguard') {
        // 같은 팀(1v1: 같은 플레이어)의 살아있는 호위무사 탐색
        const bgOwners = (room.mode === 'team') ? getAllyIndices(room, targetOwnerIdx) : [targetOwnerIdx];
        for (const bgOwnerIdx of bgOwners) {
          const bg = room.players[bgOwnerIdx]?.pieces.find(p => p.type === 'bodyguard' && p.alive);
          if (bg && !bg.statusEffects.some(e => e.type === 'curse') && bg.hp > 1 && !bg.statusEffects.some(e => e.type === 'shadow')) {
            curseTarget = bg;
            curseTargetOwnerIdx = bgOwnerIdx;
            const bgOwnerName = room.players[bgOwnerIdx].name;
            emitToBoth(room, 'passive_alert', { type: 'bodyguard', playerIdx: bgOwnerIdx, msg: `충성: ${target.name} 대신 저주를 받음` });
            emitToSpectators(room, 'spectator_log', { msg: `충성: ${target.name} 대신 저주를 받음`, type: 'passive', playerIdx: bgOwnerIdx });
            break;
          }
        }
      }
      curseTarget.statusEffects.push({ type: 'curse', source: playerIdx });
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `저주: ${curseTarget.name}${조사(curseTarget.name, '을', '를')} 저주`;
      result.oppMsg = `저주: 상대 마녀가 ${curseTarget.name}${조사(curseTarget.name, '을', '를')} 저주`;
      // ★ 저주 대상 정보 — 클라가 turn-bright 적용용
      const _cursedPieceIdx = room.players[curseTargetOwnerIdx].pieces.indexOf(curseTarget);
      result.data.cursedPieceIdx = _cursedPieceIdx;
      result.data.cursedOwnerIdx = curseTargetOwnerIdx;
      break;
    }

    // ── DUAL BLADE: 쌍검무 (양손검객 공격권 +1 — 총 최대 2회) ──
    case 'dualBlade': {
      // 가드: 이동 후 사용 불가 (이번 턴 공격 2회 — 이동 후엔 의미 없음)
      if (player._lastActionType === 'move') {
        return { ok: false, msg: '이미 이동했으므로 쌍검무를 사용할 수 없습니다.' };
      }
      // 가드: 다른 유닛이 공격했다면 사용 불가 (이 양손검객 본인은 OK)
      if (player._lastActionType === 'attack' &&
          (player._lastActionPieceType !== 'dualBlade')) {
        return { ok: false, msg: '다른 유닛이 행동했으므로 쌍검무를 사용할 수 없습니다.' };
      }
      piece.dualBladeAttacksLeft = 1;  // +1 공격권
      spendSP(room, playerIdx, cost);
      // 시전자·상대팀·관전자 모두 동일한 문장 사용
      result.msg = `쌍검무: 양손검객은 추가 공격 가능`;
      result.oppMsg = `쌍검무: 양손검객은 추가 공격 가능`;
      break;
    }

    // ── RAT MERCHANT: 역병의 자손들 (summon 3 rats) ──
    case 'ratMerchant': {
      // 보드 전체에서 랜덤 3곳 (이미 쥐가 있는 곳 제외)
      const existingRats = room.rats[playerIdx];
      const allCells = [];
      for (let c = bounds.min; c <= bounds.max; c++)
        for (let r = bounds.min; r <= bounds.max; r++) {
          if (!existingRats.some(er => er.col === c && er.row === r))
            allCells.push({ col: c, row: r });
        }
      const numRats = Math.min(3, allCells.length);
      const newRats = [];
      for (let i = 0; i < numRats; i++) {
        const ri = Math.floor(Math.random() * allCells.length);
        newRats.push(allCells.splice(ri, 1)[0]);
      }
      room.rats[playerIdx].push(...newRats);
      spendSP(room, playerIdx, cost);
      // 쥐장수 위치 — 보드 비행 시작점 (사용자 요청)
      emitToBothAndSpectators(room, 'rats_spawned', {  // ★ 관전자도 쥐 소환 모션(팀 관전자)
        rats: newRats, owner: playerIdx, spCost: cost,
        casterCol: piece.col, casterRow: piece.row,
      });
      emitToSpectators(room, 'spectator_log', { msg: `역병의 자손들: 쥐 ${newRats.length}마리 소환`, type: 'skill', playerIdx });
      result.msg = ``;
      result.skipLog = true;
      break;
    }

    // ── WEAPON SMITH: 정비 (toggle horizontal/vertical) ──
    case 'weaponSmith': {
      piece.toggleState = (piece.toggleState === 'vertical') ? null : 'vertical';
      spendSP(room, playerIdx, cost);
      const wsDir = piece.toggleState === 'vertical' ? '세로' : '가로';
      result.msg = `정비: 공격 방향 전환`;
      result.oppMsg = `정비: 공격 방향 전환`;
      result.data.toggleState = piece.toggleState;
      break;
    }

    // (호위 무사는 패시브로 변경됨 — 스킬 핸들러 불필요)

    // ── KING: 절대복종 반지 (force move enemy) ──
    case 'king': {
      const targetName = params?.targetName;
      const destCol = params?.col;
      const destRow = params?.row;
      if (targetName === undefined || destCol === undefined || destRow === undefined) {
        return { ok: false, msg: '대상과 목적지를 지정하세요.' };
      }
      if (!inBounds(destCol, destRow, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      // 유해 차단 — 유해가 있는 칸으로 강제 이동 불가
      if (room.remains && room.remains.some(r => r.col === destCol && r.row === destRow)) {
        return { ok: false, msg: '유해가 있는 위치로는 이동할 수 없습니다.' };
      }
      // 팀모드: 양 적팀 멤버 모두 검색, 1v1: 단일 상대
      const kingTargetOwnerIdx = (params?.targetOwnerIdx != null) ? params.targetOwnerIdx : (1 - playerIdx);
      const kingTargetOwner = room.players[kingTargetOwnerIdx];
      if (!kingTargetOwner) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
      if (room.mode === 'team' && kingTargetOwner.teamId === room.players[playerIdx].teamId) {
        return { ok: false, msg: '같은 팀원은 강제 이동할 수 없습니다.' };
      }
      const enemyPiece = kingTargetOwner.pieces.find(p => p.alive && p.type === targetName);
      if (!enemyPiece) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
      // ★ 사용자 정정: 그림자 암살자는 그림자 상태여도 절대복종 반지의 대상이 됨.
      //   공격·새 상태이상 면역일 뿐, 강제 이동은 상태이상이 아니므로 정상 적용.
      // ★ 순간이동 애니용 — 이전 좌표 캡쳐 (피해자만 자기 piece 의 사라짐 → 등장 애니 가능)
      const _ringFromCol = enemyPiece.col, _ringFromRow = enemyPiece.row;
      enemyPiece.col = destCol;
      enemyPiece.row = destRow;
      spendSP(room, playerIdx, cost);
      result.msg = `절대복종 반지: ${enemyPiece.name}${조사(enemyPiece.name, '을', '를')} 강제 이동`;
      result.oppMsg = `반지: 상대 국왕이 ${enemyPiece.name}${조사(enemyPiece.name, '을', '를')} 강제 이동`;
      // ★ 사용자 요청: 절대복종반지 애니 — 오로라 펄스 + 순간이동 + 화이트 페이드.
      //   클라가 좌표/owner/pieceIdx 로 시각화. 자동 추리 토큰 (드래곤처럼 영구).
      const _ringVictimPieceIdx = kingTargetOwner.pieces.indexOf(enemyPiece);
      result.data.ringTeleport = {
        fromCol: _ringFromCol, fromRow: _ringFromRow,
        toCol: destCol, toRow: destRow,
        victimOwnerIdx: kingTargetOwnerIdx,
        victimPieceIdx: _ringVictimPieceIdx,
        victimType: enemyPiece.type,
        victimName: enemyPiece.name,
        victimIcon: enemyPiece.icon,
      };

      // ★ 사용자 요청: 절대복종반지 시전과 덫 발동을 시각적으로 분리.
      //   ring cast (이동) 가 SP_END_MS 시점에 마무리 → 그때 덫이 별도 phase 로 발동.
      //   여기서는 "트랩에 걸렸다" 사실만 deferred 데이터에 보관 — HP/사망/SP 처리는 모두 나중에.
      const trapIdx2 = room.boardObjects[playerIdx].findIndex(o => o.type === 'trap' && o.col === destCol && o.row === destRow);
      if (trapIdx2 >= 0) {
        room.boardObjects[playerIdx].splice(trapIdx2, 1);
        const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: destCol, row: destRow }, enemyPiece, playerIdx, 2, false);
        // ★ HP/사망/SP 변경은 모두 deferred — skill_result 시점에는 변경 X.
        //   wizard 패시브 SP 도 deferred (이동확정 후 덫 발동 시점에서 처리).
        result.data.deferredKingTrap = {
          col: destCol, row: destRow,
          victimOwnerIdx: kingTargetOwnerIdx,
          trapOwnerIdx: playerIdx,
          dmg,
          pieceType: enemyPiece.type,
          pieceName: enemyPiece.name,
          pieceIcon: enemyPiece.icon,
          wizardSpSlot: (enemyPiece.type === 'wizard' && dmg > 0)
            ? teamSlotIdx(room, kingTargetOwnerIdx)
            : null,
        };
      }
      break;
    }

    // ── DRAGON TAMER: 드래곤 소환 ──
    case 'dragonTamer': {
      // 보드 위 드래곤이 이미 1마리 있으면 소환 불가
      const existingDragon = player.pieces.find(p => p.isDragon && p.alive);
      if (existingDragon) return { ok: false, msg: '보드 위에 이미 드래곤이 있습니다.' };
      const dc = params?.col;
      const dr = params?.row;
      if (dc === undefined || dr === undefined) return { ok: false, msg: '소환 위치를 지정하세요.' };
      if (!inBounds(dc, dr, bounds)) return { ok: false, msg: '보드 밖입니다.' };
      // 유해 차단 — 유해가 있는 칸에 소환 불가
      if (room.remains && room.remains.some(r => r.col === dc && r.row === dr)) {
        return { ok: false, msg: '유해가 있는 위치에는 소환할 수 없습니다.' };
      }
      const dragon = createPiece('dragonTamer', 3, 3, { isDragon: true, ownerIdx: playerIdx });
      dragon.type = 'dragon';
      dragon.name = '드래곤';
      dragon.icon = '/assets/icons/dragon.png';
      dragon.atk = 3;
      dragon.hp = 3;
      dragon.maxHp = 3;
      dragon.col = dc;
      dragon.row = dr;
      dragon.hasSkill = false;
      dragon.skillName = null;
      dragon.skillId = null;
      dragon.skillCost = 0;
      dragon.skillReplacesAction = false;
      dragon.skills = [];        // ★ 사용자 보고: dragonTamer 의 skills 배열이 그대로 복사돼 [드래곤 소환] 미니헤더가 부착됨.
      dragon.passives = [];      // 드래곤은 패시브도 없음
      dragon.passiveName = null;
      dragon.tag = null;
      dragon.tier = 3;
      dragon.desc = '자신 + 십자4칸 · 총 5칸';
      player.pieces.push(dragon);
      spendSP(room, playerIdx, cost);
      emitToBothAndSpectators(room, 'dragon_spawned', { dragon: { col: dc, row: dr, hp: 3 }, owner: playerIdx, spCost: cost });  // ★ 관전자도 드래곤 소환 모션(팀 관전자)
      emitToSpectators(room, 'spectator_log', { msg: `드래곤 소환: ${coord(dc,dr)}에 드래곤 소환`, type: 'skill', playerIdx });
      result.msg = ``;
      result.skipLog = true;
      break;
    }

    // ── MONK: 신성 (heal ally +2, remove status effects) ──
    case 'monk': {
      const targetIdx2 = params?.targetPieceIdx;
      if (targetIdx2 === undefined) return { ok: false, msg: '대상을 지정하세요.' };
      // ★ FIX (팀전 신성 — 팀원 회복 대상 지목): targetOwnerIdx 로 시전자 본인 OR 팀원 지정 가능.
      //   (이전엔 player.pieces 본인 말만 가능 → 팀전에서 팀원을 치유 대상으로 못 골랐음.)
      //   대상 제약은 "아군(같은 팀)" + "수도승 본인 제외" 만 — 풀체력·무상태 대상도 허용(상태이상
      //   제거 유틸/사용자 요청). 아군이 모두 풀체력·무상태여도 시전 가능.
      const targetOwnerIdx = (typeof params?.targetOwnerIdx === 'number') ? params.targetOwnerIdx : playerIdx;
      const allyIdxs = (room.mode === 'team') ? getAllyIndices(room, playerIdx) : [playerIdx];
      if (!allyIdxs.includes(targetOwnerIdx)) return { ok: false, msg: '아군만 치유할 수 있습니다.' };
      const targetPlayer = room.players[targetOwnerIdx];
      const target = targetPlayer && targetPlayer.pieces[targetIdx2];
      if (!target || !target.alive) return { ok: false, msg: '대상이 없습니다.' };
      if (target === piece) return { ok: false, msg: '자신은 치유할 수 없습니다.' };
      target.hp = Math.min(target.maxHp, target.hp + 2);
      // AI 마녀 학습 — 신성으로 저주 정화 시 시전자 마녀의 _curseHistory 카운트 증가
      const hadCurse = (target.statusEffects || []).find(e => e.type === 'curse');
      if (hadCurse) {
        const witchOwner = room.players[hadCurse.source];
        if (witchOwner && witchOwner.socketId === 'AI') {
          if (!witchOwner._curseHistory) witchOwner._curseHistory = {};
          const key = `${targetOwnerIdx}:${target.type}:${target.subUnit || ''}`;
          witchOwner._curseHistory[key] = (witchOwner._curseHistory[key] || 0) + 1;
        }
      }
      target.statusEffects = [];
      spendSP(room, playerIdx, cost);
      result.data.healedPieceIdxs = [targetIdx2];
      result.data.healedPieces = [{ ownerIdx: targetOwnerIdx, pieceIdx: targetIdx2 }];
      // ★ 신성 시전 애니용 — 대상의 위치 (빛 기둥이 내려올 곳).
      result.data.divineTarget = { col: target.col, row: target.row };
      result.msg = `신성: ${target.name}의 상태이상 제거, 2 HP 회복`;
      result.oppMsg = `신성: ${target.name}의 상태이상 제거, 2 HP 회복`;
      break;
    }

    // ── SULFUR CAULDRON: 유황의 강 (border attack, dmg 3) ──
    case 'sulfurCauldron': {
      const borderCells = getBorderCells(bounds);
      // suppressSpUpdate=true — 시전자 마법구 비행 애니가 race 안 나도록
      const hits = processAttack(room, playerIdx, { ...piece, atk: 2, type: 'sulfurCauldron' }, borderCells, 2, { suppressSpUpdate: true });
      const sulfurKilled = hits.filter(h => h.destroyed);
      if (sulfurKilled.length > 0) {
        setKillInfo(room, 'sulfur', null, sulfurKilled.map(k => ({ name: k.revealedName })));
      }
      spendSP(room, playerIdx, cost);
      player.actionUsedSkillReplace = true;
      player.actionDone = true;
      result.msg = `유황범람: 보드 외곽 전체 2 피해`;
      result.oppMsg = `유황범람: 보드 외곽 전체 2 피해`;
      result.data.hits = hits;
      result.data.borderCells = borderCells;
      // ★ 화약상이 유황범람으로 죽으면 — 사망 애니가 라바 후(클라 +1600ms)라 유해가 늦게 생김.
      //   사망 기폭은 항상 유해 생성 이후 → detonationDelay 를 그만큼 늘림(겹침 방지).
      if (room._currentPhase && room._currentPhase.pendingDeathDetonations.length > 0) {
        room._currentPhase.detonationDelay = Math.max(room._currentPhase.detonationDelay || 0, 3700);
      }
      // ★ 유황범람으로 파괴된 쥐 — 클라가 사망 모션 재생하도록 좌표/소유자 전달.
      result.data.destroyedRats = room._destroyedRatCellsThisAttack || [];
      break;
    }

    // ── TORTURER: 악몽 (damage all marked enemies — 팀모드는 양 적팀 모두) ──
    case 'torturer': {
      // 팀모드: getEnemyIndices로 양 적팀 멤버 모두, 1v1: 단일 상대
      const enemyIndices = (room.mode === 'team') ? getEnemyIndices(room, playerIdx) : [1 - playerIdx];
      const enemyEntries = enemyIndices.map(ei => ({ idx: ei, pieces: room.players[ei].pieces.filter(p => p.alive) }));
      const allEnemies = enemyEntries.flatMap(e => e.pieces);
      const hasMarked = allEnemies.some(p => p.statusEffects.some(e => e.type === 'mark'));
      if (!hasMarked) return { ok: false, msg: '표식 상태의 적이 없어 악몽을 사용할 수 없습니다.' };
      const hits = [];
      for (const ee of enemyEntries) {
        for (const m of ee.pieces.filter(p => p.statusEffects.some(e => e.type === 'mark'))) {
          const dmg = resolveDamage(room, piece, m, playerIdx, 1, false);
          m.hp = Math.max(0, m.hp - dmg);
          // Wizard passive: 악몽으로 마법사가 피격되어도 인스턴트 SP 1 획득 (피격마다 트리거)
          if (m.type === 'wizard' && dmg > 0) {
            const wizSpSlot = teamSlotIdx(room, ee.idx);
            room.instantSp[wizSpSlot] += 1;
            // ❌ emitSPUpdate 제거 — skill_result 가 sp/instantSp 를 자동 전달함.
            emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: ee.idx, msg: `인스턴트 매직 : SP 획득` });

            emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: ee.idx });

          }
          if (m.hp <= 0) handleDeath(room, m, ee.idx);
          hits.push({ col: m.col, row: m.row, damage: dmg, newHp: m.hp, destroyed: !m.alive, name: m.name, ownerIdx: ee.idx });
        }
      }
      const nightmareKilled = hits.filter(h => h.destroyed);
      if (nightmareKilled.length > 0) {
        setKillInfo(room, 'nightmare', piece.name, nightmareKilled.map(k => ({ name: k.name })));
        // ★ 사용자 요청 (리워크): 악몽 시전 시 격파/피해 토스트 제거 — "악몽 발동" 토스트만 노출.
        //   사망 자체는 데미지 도장/HP 갱신/profile-hit 등 기존 시각 피드백으로 전달됨.
      }
      spendSP(room, playerIdx, cost);
      // ★ 사용자 요청: 시전 토스트는 "악몽 발동" 한 줄만. 피해·격파 정보 제거.
      result.msg = `악몽 발동`;
      result.oppMsg = `악몽 발동`;
      result.data.hits = hits;
      // ★ 클라이언트 애니메이션용: 표식 상태 적 셀 좌표 (보라 펄스 + scale 타깃).
      result.data.nightmareCells = hits.map(h => ({ col: h.col, row: h.row }));
      // ★ 화약상이 악몽으로 죽으면 — 사망 애니가 악몽 임팩트 후(클라 +500ms) 시작 → 사망 GIF → 유해.
      //   사망 기폭은 항상 "유해 생성 이후" 에 시작(악몽 먼저, 그 다음 기폭 — 겹침 금지) → detonationDelay 상향.
      if (room._currentPhase && room._currentPhase.pendingDeathDetonations.length > 0) {
        room._currentPhase.detonationDelay = Math.max(room._currentPhase.detonationDelay || 0, 2600);
      }
      break;
    }

    default:
      return { ok: false, msg: '알 수 없는 스킬입니다.' };
  }

  // 턴당 1회 제한 스킬 사용 기록
  if (matchedSkillForOnce && matchedSkillForOnce.oncePerTurn) {
    const usedKey = `${pieceIdx}:${effectiveSkillId}`;
    player.skillsUsedBeforeAction.push(usedKey);
  }
  // ★ 사용자 보고: 턴스킵 토스트가 자유시전형 스킬 사용 후에도 잘못 발동.
  //   skillsUsedBeforeAction 은 oncePerTurn 만 기록 → 자유 스킬은 누락.
  //   _anySkillUsedThisTurn 플래그로 모든 스킬 사용 추적 (정찰·정비·약초학·신성·반지·드래곤 등 포함).
  player._anySkillUsedThisTurn = true;

  return result;
}

// ══════════════════════════════════════════════════════════════════
// ── AI Brain ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function initAiBrain(boardSize) {
  const size = boardSize || 5;
  const prob = [];
  for (let r = 0; r < size; r++) {
    prob[r] = [];
    for (let c = 0; c < size; c++) prob[r][c] = 1.0;
  }
  return {
    probMap: prob,
    confirmedEmpty: new Set(),
    hits: [],
    mode: 'scan',
    huntTargets: [],
    enemiesAlive: 3,
    turnCount: 0,
    lastHitTurn: -10,
    // 피격 기억: { pieceType: { col, row, turn } } — 맞은 위치를 기억해서 도망
    hitMemory: {},
    // 반격 실패 도주 충동: { pieceType: turnCount } — 피격 후 반격이 빗나가면(추론 실패)
    //   다음 턴 그 자리에서 또 맞지 말고 도주하도록 마킹.
    fleeUrge: {},
  };
}

function aiSpreadProbability(brain) {
  const size = brain.probMap.length;
  const old = brain.probMap.map(r => [...r]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (old[r][c] <= 0) continue;
      const spread = old[r][c] * 0.15;
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < size && nr >= 0 && nr < size) {
          brain.probMap[nr][nc] += spread;
        }
      }
    }
  }
  normalizeProbMap(brain);
}

function normalizeProbMap(brain) {
  // ★ size-agnostic — 1v1(5x5)·팀전(7x7) 공용. 이전엔 5 하드코딩으로 팀 7x7 의
  //   바깥 행·열(5,6)이 정규화 누락되어 확률맵이 망가졌음.
  const size = brain.probMap.length;
  let max = 0;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (brain.probMap[r][c] > max) max = brain.probMap[r][c];
  if (max > 0) {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        brain.probMap[r][c] = brain.probMap[r][c] / max * 10;
  }
}

// ── 확률맵 최대값 — 정보 신뢰도 판단용 (정찰 스킬 등 결정에 사용) ──
function aiMaxProb(brain) {
  const size = brain.probMap.length;
  let max = 0;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (brain.probMap[r][c] > max) max = brain.probMap[r][c];
  return max;
}

// ── 추격(접근) 포텐셜 — 적 확률질량으로 능동 접근하도록 이동 점수에 가산 ──
//   사용자 요청: "공격 사거리에 적이 올 때까지 멍청하게 기다리지 말고 추리·추산해 다가가라."
//   포텐셜필드: 각 셀의 확률값을 거리로 나눠 합산 → 새 위치가 확률질량에 더 가까우면 +.
//   공격이 즉시 가능한 강한 칸(원점수 6~10+)은 이 보너스를 압도하므로, 접근은
//   "딱히 더 좋은 공격이 없을 때" 적 쪽으로 한 칸씩 좁혀가는 약한 유도력으로 작동.
function aiApproachScore(brain, fromC, fromR, toC, toR, bounds) {
  let potFrom = 0, potTo = 0;
  for (let r = bounds.min; r <= bounds.max; r++) {
    for (let c = bounds.min; c <= bounds.max; c++) {
      const p = brain.probMap[r]?.[c] || 0;
      if (p <= 0.5) continue;
      const dFrom = Math.abs(c - fromC) + Math.abs(r - fromR);
      const dTo = Math.abs(c - toC) + Math.abs(r - toR);
      potFrom += p / (dFrom + 1);
      potTo += p / (dTo + 1);
    }
  }
  return potTo - potFrom;
}

// ══════════════════════════════════════════════════════════════════
// ── 공정 정보 헬퍼 (치팅 금지) ─────────────────────────────────────
//   CALIGO fog-of-war: 적의 정체/HP/타입/스킬/패시브는 항상 공개(oppPieceSummary),
//   위치(col/row)는 '표식(mark)' 상태일 때만 공개. → AI 도 딱 이 범위만 본다.
//   - 정체/HP 기반 판단(누구를 저주할까, 처치 가능한가)은 공정.
//   - 위치 기반 판단(어디로 도망/공격)은 표식된 적의 실위치 + 확률맵 추정만 사용.
// ══════════════════════════════════════════════════════════════════
function aiIsMarked(piece) {
  return !!(piece && piece.statusEffects && piece.statusEffects.some(e => e.type === 'mark'));
}
// 살아있는 적 목록(공정). marked=true 일 때만 col/row 신뢰. 그 외 위치는 null(확률맵으로 추정).
function aiKnownEnemies(room, ownerIdx) {
  const enemyIdxs = (typeof getEnemyIndices === 'function') ? getEnemyIndices(room, ownerIdx) : [1 - ownerIdx];
  const out = [];
  for (const ei of enemyIdxs) {
    const owner = room.players[ei];
    if (!owner) continue;
    (owner.pieces || []).forEach((pc, ti) => {
      if (!pc.alive) return;
      const marked = aiIsMarked(pc);
      out.push({ piece: pc, ownerIdx: ei, idxInOwner: ti, marked,
                 col: marked ? pc.col : null, row: marked ? pc.row : null });
    });
  }
  return out;
}
// 유닛 전략 가치 — 고가치 처치·위협 가중·타겟 우선에 공용. (정체/티어/스킬 = 공개 정보)
function aiUnitValue(piece) {
  if (!piece) return 0;
  let v = (piece.tier || 1) * 2 + (piece.atk || 0);
  const STRONG = { monk: 6, commander: 6, king: 5, witch: 5, count: 5,
    sulfurCauldron: 5, dragonKnight: 5, slaughterHero: 4, shadowAssassin: 4,
    torturer: 3, manhunter: 2, ratMerchant: 2 };
  v += (STRONG[piece.type] || 0);
  return v;
}
// 저주 타겟 가치 — 저주는 '스킬 봉인'이므로 스킬 가치 = 저주 가치. 수도승은 저주 해제원이라 최우선.
function aiCurseValue(piece) {
  if (!piece) return 0;
  if (piece.type === 'monk') return 100;  // 신성=아군 저주 해제 → 봉인이 최우선
  return aiUnitValue(piece) + (piece.hasSkill ? 3 : 0);
}
// ── 공격 타겟 보너스 — 표식된 적(실위치 공개)이 공격칸에 들어올 때 처치/고가치 가중. ──
//   공개 정보(HP·타입)만 사용 → 치팅 아님. 비표식 적은 확률맵 점수로만 평가(위치 모름).
//   사용자 요청: 한 방의 의도 — 끝낼 수 있으면 끝내고, 핵심 유닛을 노린다.
function aiAttackTargetBonus(room, ownerIdx, cells, effAtk) {
  const enemies = aiKnownEnemies(room, ownerIdx).filter(e => e.marked);
  if (enemies.length === 0) return 0;
  let bonus = 0;
  for (const c of cells) {
    const tgt = enemies.find(e => e.col === c.col && e.row === c.row);
    if (!tgt) continue;
    // 처치 가능 — 최우선 (패시브 경감은 무시한 근사). 고가치일수록 처치 가치 ↑.
    if ((effAtk || 0) >= (tgt.piece.hp || 1)) {
      bonus += 12 + aiUnitValue(tgt.piece) * 1.5;
    } else {
      // 처치 불가라도 고가치 적을 깎는 건 가치 있음.
      bonus += aiUnitValue(tgt.piece) * 0.4;
    }
  }
  return bonus;
}
// ── 위협맵 — 각 칸에 머무를 때 받게 될 예상 피격량. 표식=실위치, 비표식=확률맵 추정. ──
//   사용자 요청: "제 발로 사거리에 걸어 들어가지 마라" — 사람처럼 위험 칸을 피하게 하는 핵심.
function aiBuildDangerMap(room, ownerIdx, brain) {
  const bounds = room.boardBounds;
  const size = brain.probMap.length;
  const danger = [];
  for (let r = 0; r < size; r++) danger[r] = new Array(size).fill(0);
  const enemies = aiKnownEnemies(room, ownerIdx);
  const unmarkedTypes = [];
  const seen = new Set();
  for (const e of enemies) {
    if (e.marked) {
      let cells; try { cells = getAttackCells(e.piece.type, e.col, e.row, bounds, { toggleState: e.piece.toggleState }); } catch (err) { cells = []; }
      for (const c of cells) {
        if (c.row >= 0 && c.row < size && c.col >= 0 && c.col < size) danger[c.row][c.col] += (e.piece.atk || 1);
      }
    } else {
      const k = e.piece.type + (e.piece.toggleState || '');
      if (!seen.has(k)) { seen.add(k); unmarkedTypes.push({ type: e.piece.type, atk: e.piece.atk || 1, toggleState: e.piece.toggleState }); }
    }
  }
  if (unmarkedTypes.length) {
    for (let sr = bounds.min; sr <= bounds.max; sr++) {
      for (let sc = bounds.min; sc <= bounds.max; sc++) {
        const p = brain.probMap[sr]?.[sc] || 0;
        if (p < 3) continue;  // 확신 낮은 칸 무시 (노이즈 차단)
        const presence = Math.min(1, p / 10);
        for (const t of unmarkedTypes) {
          let cells; try { cells = getAttackCells(t.type, sc, sr, bounds, t.toggleState ? { toggleState: t.toggleState } : {}); } catch (err) { continue; }
          for (const c of cells) {
            if (c.row >= 0 && c.row < size && c.col >= 0 && c.col < size) danger[c.row][c.col] += presence * t.atk * 0.5;
          }
        }
      }
    }
  }
  return danger;
}
// 위협 페널티 — 부상·고가치 유닛일수록 위험 칸을 더 강하게 회피.
function aiThreatPenalty(piece, danger, col, row) {
  const d = danger?.[row]?.[col] || 0;
  if (d <= 0) return 0;
  const vuln = 1 + Math.max(0, (piece.maxHp || piece.hp || 1) - (piece.hp || 1)) * 0.6;  // 이미 다쳤으면 ↑
  const valueW = 1 + (piece.tier || 1) * 0.2;
  return d * 1.2 * vuln * valueW;
}
// ── 정보 획득(정찰) — 새 위치의 공격범위가 '불확실' 영역을 얼마나 덮는가. ──
//   불확실 = 적이 있을 법하나(중간 확률) 아직 확정 못한 칸. 다가가 다음 턴 공격→확정 유도.
function aiInfoGain(brain, type, newCol, newRow, bounds, toggleState) {
  let cells; try { cells = getAttackCells(type, newCol, newRow, bounds, toggleState ? { toggleState } : {}); } catch (e) { return 0; }
  let g = 0;
  for (const c of cells) {
    const p = brain.probMap[c.row]?.[c.col] || 0;
    if (p > 1.5 && p < 7) g += 1;  // 중간 불확실 밴드
  }
  return g;
}
// ── 확률맵 정화 — 내 말이 있는 칸엔 적이 없다(내 위치는 내가 안다=공정). 적 존재 가능성 0. ──
function aiClearOwnCells(brain, room, ownerIdx) {
  const allyIdxs = (typeof getAllyIndices === 'function') ? getAllyIndices(room, ownerIdx) : [ownerIdx];
  for (const ai of allyIdxs) {
    for (const pc of (room.players[ai]?.pieces || [])) {
      if (pc.alive && pc.col != null && brain.probMap[pc.row]) brain.probMap[pc.row][pc.col] = 0;
    }
  }
}

function aiProcessAttackResult(brain, atkCells, hitResults, attackPiece) {
  for (const cell of atkCells) {
    const hit = hitResults.find(h => h.col === cell.col && h.row === cell.row);
    if (hit) {
      brain.hits.push({ col: cell.col, row: cell.row, turn: brain.turnCount, destroyed: hit.destroyed });
      brain.lastHitTurn = brain.turnCount;
      brain.mode = 'hunt';
      if (hit.destroyed) {
        brain.enemiesAlive--;
        brain.probMap[cell.row][cell.col] = 0;
        if (brain.enemiesAlive <= 1) brain.mode = 'finish';
      } else {
        boostHuntArea(brain, cell.col, cell.row);
      }
    } else {
      brain.probMap[cell.row][cell.col] *= 0.1;
    }
  }
  // ★ 반격 실패 → 도주 충동: 피격당해 위치를 기억 중인 말이 반격했는데 전부 빗나갔다면
  //   추론이 틀렸고 그 자리에 계속 있으면 또 맞는다 → 다음 턴 도주하도록 마킹 (사용자 보고).
  if (attackPiece && brain.fleeUrge && hitResults.length === 0) {
    const mem = brain.hitMemory[attackPiece.type];
    if (mem && brain.turnCount - mem.turn <= 2) {
      brain.fleeUrge[attackPiece.type] = brain.turnCount;
    }
  }
  if (brain.turnCount - brain.lastHitTurn > 5) brain.mode = 'scan';
}

function boostHuntArea(brain, col, row) {
  const size = brain.probMap.length;
  // 적중 셀: 최고 확신 — 상대가 도망가기 전까지 같은 칸 지속 공격
  brain.probMap[row][col] = 9;
  // 인접 4방: 상대가 도망갈 가능성 — 두번째 우선순위
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = col + dc, nr = row + dr;
    if (nc >= 0 && nc < size && nr >= 0 && nr < size) {
      brain.probMap[nr][nc] = Math.max(brain.probMap[nr][nc], 6);
    }
  }
}

// ── 적의 공격을 관측해 공격자 위치를 역추론 (fog-of-war 존중, 1v1·팀전 공용) ──
//   사용자 요청: "실제 플레이어와 같은 정보만 보고 추리·추산해 정보를 끝없이 스택킹하라."
//   AI 는 적의 정확한 위치를 직접 볼 수 없다. 대신 "내가 어느 칸에서 맞았는가"(atkCells/hitResults)
//   + "적이 보유한 유닛 타입"(초기 공개로 알고 있음) 을 결합해, 그 타입들이 실제로 그 칸을
//   때릴 수 있는 후보 위치만 확률맵에 가산한다. 후보가 적을수록 신뢰도↑. 회피 후 재피격 시
//   직전 후보군과의 교집합으로 위치를 거의 확정(9). 빗나가면 직전 후보군을 감쇠.
//   → 1v1 socket('attack') 핸들러 인라인 로직을 그대로 추출 (동작 보존) + size/진영-무관 일반화.
function aiObserveEnemyAttack(brain, room, ownPieces, attackerPieces, atkCells, hitResults) {
  const size = brain.probMap.length;
  // 피격 기억 — 어느 내 말이 어디서 맞았는지 (도망 판단용)
  for (const h of hitResults) {
    const hitPiece = ownPieces.find(p => p.col === h.col && p.row === h.row && p.alive);
    if (hitPiece) aiRecordHit(brain, hitPiece);
  }
  if (hitResults.length > 0) {
    const aliveEnemyTypes = (attackerPieces || []).filter(p => p.alive)
      .map(p => ({ type: p.type, atk: p.atk, toggleState: p.toggleState }));
    if (aliveEnemyTypes.length === 0) {
      // 폴백 — 타입 정보 없으면 hit 셀 주변 8칸 가산
      for (const h of hitResults) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = h.col + dc, nr = h.row + dr;
          if (nc >= 0 && nc < size && nr >= 0 && nr < size)
            brain.probMap[nr][nc] = Math.max(brain.probMap[nr][nc], 5);
        }
      }
    } else {
      // 각 hit 별 후보 셀 — 그 타입이 어딘가에서 hit 셀을 공격범위에 포함하는 위치
      const newCandidates = new Set();
      for (const h of hitResults) {
        for (const et of aliveEnemyTypes) {
          for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
            // 내 말이 있는 칸엔 적이 있을 수 없음
            if (ownPieces.some(p => p.alive && p.col === c && p.row === r)) continue;
            const extra = et.toggleState ? { toggleState: et.toggleState } : {};
            let cells;
            try { cells = getAttackCells(et.type, c, r, room.boardBounds, extra); } catch (e) { continue; }
            if (cells.some(cc => cc.col === h.col && cc.row === h.row)) {
              newCandidates.add(`${c},${r}`);
            }
          }
        }
      }
      const candList = [...newCandidates];
      const baseConf = candList.length <= 3 ? 8 : (candList.length <= 6 ? 7 : 6);
      // 회피 후 재피격 추론 — 직전 후보군과 교집합이 작으면 거의 확정
      const prevCands = brain.lastHitCandidates;
      if (prevCands && prevCands.size > 0) {
        const intersect = candList.filter(k => prevCands.has(k));
        if (intersect.length > 0 && intersect.length <= 4) {
          for (const key of intersect) {
            const [c, r] = key.split(',').map(Number);
            brain.probMap[r][c] = 9;
          }
        }
      }
      for (const key of candList) {
        const [c, r] = key.split(',').map(Number);
        brain.probMap[r][c] = Math.max(brain.probMap[r][c], baseConf);
      }
      brain.lastHitCandidates = newCandidates;
      brain.lastHitTurn = brain.turnCount;
    }
  } else {
    // 빗나감 — 직전 후보군 유지하되 회피 성공으로 감쇠
    if (brain.lastHitCandidates) {
      for (const key of brain.lastHitCandidates) {
        const [c, r] = key.split(',').map(Number);
        brain.probMap[r][c] = Math.max(0, (brain.probMap[r][c] || 0) * 0.7);
      }
    }
  }
  // 공격 범위 셀 자체도 적이 있을 수 있음
  if (atkCells.length > 0) {
    for (const c of atkCells) {
      if (c.row >= 0 && c.row < size && c.col >= 0 && c.col < size) {
        brain.probMap[c.row][c.col] = Math.max(brain.probMap[c.row][c.col], 4);
      }
    }
    const avgCol = atkCells.reduce((s, c) => s + c.col, 0) / atkCells.length;
    const avgRow = atkCells.reduce((s, c) => s + c.row, 0) / atkCells.length;
    const cr = Math.round(avgRow), cc = Math.round(avgCol);
    if (cr >= 0 && cr < size && cc >= 0 && cc < size) {
      brain.probMap[cr][cc] = Math.max(brain.probMap[cr][cc], 7);
    }
  }
}

// ★ 사용자 요청: AI 가 사기증진(commander 버프) 을 활용해야 함.
//   commander 와 인접한 아군은 +1 ATK 효과. 이 effective atk 를 점수에 반영하면
//   AI 는 commander 옆으로 이동·공격을 선호하게 됨.
function _effectiveAtkForAi(piece, room, ownerIdx) {
  if (!piece || piece.type === 'commander') return piece?.atk || 0;
  // ★ 팀전: 같은 팀 모든 플레이어의 지휘관 체크 (getAllyIndices)
  const allyIdxs = (typeof getAllyIndices === 'function') ? getAllyIndices(room, ownerIdx) : [ownerIdx];
  for (const ai of allyIdxs) {
    const allies = (room.players[ai]?.pieces || []).filter(p =>
      p.alive && p !== piece && p.type === 'commander');
    for (const cmd of allies) {
      if ((Math.abs(cmd.col - piece.col) === 1 && cmd.row === piece.row) ||
          (Math.abs(cmd.row - piece.row) === 1 && cmd.col === piece.col)) {
        return (piece.atk || 0) + 1;
      }
    }
  }
  return piece.atk || 0;
}
function _effectiveAtkAtCellForAi(piece, room, ownerIdx, newCol, newRow) {
  // 가상의 위치(newCol, newRow) 에서 commander 인접 여부 — 이동 점수용.
  if (!piece || piece.type === 'commander') return piece?.atk || 0;
  const allyIdxs = (typeof getAllyIndices === 'function') ? getAllyIndices(room, ownerIdx) : [ownerIdx];
  for (const ai of allyIdxs) {
    const allies = (room.players[ai]?.pieces || []).filter(p =>
      p.alive && p !== piece && p.type === 'commander');
    for (const cmd of allies) {
      if ((Math.abs(cmd.col - newCol) === 1 && cmd.row === newRow) ||
          (Math.abs(cmd.row - newRow) === 1 && cmd.col === newCol)) {
        return (piece.atk || 0) + 1;
      }
    }
  }
  return piece.atk || 0;
}
// ★ 지휘관 본인 이동 점수 — 새 위치에서 사기증진(+1 ATK)을 줄 수 있는 아군 수.
//   지휘관은 자기 공격력(2)만으로 움직이면 아군 곁을 떠나 버프가 사장됨(사용자 지적).
//   공격 가능한 아군과 직교 인접할수록 가산 → 지휘관이 의도적으로 버프 진형을 유지.
function aiCommanderAuraScore(piece, room, ownerIdx, newCol, newRow) {
  if (!piece || piece.type !== 'commander') return 0;
  const allyIdxs = (typeof getAllyIndices === 'function') ? getAllyIndices(room, ownerIdx) : [ownerIdx];
  let aura = 0;
  for (const ai of allyIdxs) {
    for (const a of (room.players[ai]?.pieces || [])) {
      if (!a.alive || a === piece || a.col == null || a.col < 0) continue;
      if (a.type === 'commander' || (a.atk || 0) <= 0) continue;   // 지휘관끼리/비전투 유닛 제외
      if (Math.abs(a.col - newCol) + Math.abs(a.row - newRow) === 1) aura += 1 + (a.atk || 0) * 0.3;
    }
  }
  return aura;
}

// ── AI 공용 헬퍼 (1v1·팀전 동일 적용) ───────────────────────────────
// 주어진 셀이 임박한 보드 축소로 곧 파괴되는지에 따른 위험 점수(>=0).
//   공격(=제자리 유지)·이동 평가 양쪽에서 "곧 사라질 칸에 머무는 것"을 일관되게 페널티.
//   → 사용자 보고: AI 가 보드축소를 1순위로 안 두고 공격만 남발하다 사망. 공격 점수에서 차감해
//      doom 셀에 머무르며 공격하는 선택보다 안전한 칸으로의 이동이 우선되게 한다.
function _aiCellDoomPenalty(room, col, row) {
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  let penalty = 0;
  for (const ev of schedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const turnsToShrink = ev.shrinkTurn - room.turnNumber;
    if (turnsToShrink > 8 || turnsToShrink < 0) continue;
    const baseSize = room.mode === 'team' ? 7 : 5;
    const nextLevel = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
    const evB = ev.newBounds || (typeof _levelToBounds === 'function' ? _levelToBounds(nextLevel, baseSize) : null);
    if (!evB) continue;
    const willBeOutside = col < evB.min || col > evB.max || row < evB.min || row > evB.max;
    if (willBeOutside) {
      const urgency = Math.max(1, 9 - turnsToShrink);
      penalty = Math.max(penalty, 30 * urgency);
    }
  }
  return penalty;
}

// 스킬 비용 중 "정규 SP"(쓰면 상대에게 이관됨) 분량. instant SP 우선 소진 가정.
function _aiRegularSpCost(room, slot, cost) {
  const inst = (room.instantSp && room.instantSp[slot]) || 0;
  return Math.max(0, (cost || 0) - inst);
}
// 상대에게 SP 를 넘겨주는 위험도(0~3). 적이 스킬 보유 말을 많이 살려둘수록 큼(공개 정보만 사용).
function _aiOppSpThreat(room, mySlot) {
  const oppSlot = 1 - mySlot;
  let danger = 0;
  for (let pi = 0; pi < room.players.length; pi++) {
    const pl = room.players[pi];
    if (!pl) continue;
    const plSlot = (room.mode === 'team') ? getTeamOf(room, pi) : pi;
    if (plSlot !== oppSlot) continue;
    for (const p of (pl.pieces || [])) {
      if (p.alive && p.hasSkill) danger += 0.5;
    }
  }
  return Math.min(3, danger);
}
// 한계가치 스킬(쌍검무·전령질주·토글 등)의 시전 문턱 가산치.
//   정규 SP 를 상대에게 넘기면서까지 쓸 가치가 있는지 — 수읽기(상대가 받은 SP 로 스킬 시전 가능).
//   instant SP 로 충당되면 이관이 없어 문턱 0.
function _aiSpTransferBar(room, slot, cost) {
  const regSp = _aiRegularSpCost(room, slot, cost);
  if (regSp <= 0) return 0;
  const oppThreat = _aiOppSpThreat(room, slot); // 0~3
  return regSp * (3 + oppThreat * 2);           // 정규 SP 1당 +3~9 문턱
}

function aiScoreAttack(brain, piece, room, extra) {
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, piece.col, piece.row, bounds, extra);
  let score = 0;
  for (const cell of cells) {
    if (inBounds(cell.col, cell.row, bounds)) {
      score += brain.probMap[cell.row][cell.col];
    }
  }
  // ★ commander 버프 반영 — 인접 시 +1 ATK 로 점수 증폭.
  const effAtk = _effectiveAtkForAi(piece, room, 1);
  score *= (1 + effAtk * 0.1);
  // ★ 처치·고가치 타겟 보너스 — 표식된 적 한정(공개 HP). 끝낼 수 있으면 끝낸다.
  score += aiAttackTargetBonus(room, 1, cells, effAtk);
  // ★ 보드축소 우선 — 곧 파괴될 칸에서 공격(=제자리 유지)하면 강한 페널티 → 안전한 이동 우선.
  score -= _aiCellDoomPenalty(room, piece.col, piece.row);
  return score;
}

function aiScoreMove(brain, piece, newCol, newRow, room) {
  const W = (brain && brain._weights) || AI_WEIGHTS;
  const bounds = room.boardBounds;
  const cells = getAttackCells(piece.type, newCol, newRow, bounds);
  let score = 0;
  for (const cell of cells) {
    if (inBounds(cell.col, cell.row, bounds)) {
      score += brain.probMap[cell.row][cell.col];
    }
  }
  // ★ commander 인접 보너스 — 새 위치에서 사기증진 받으면 점수 증폭.
  const effAtkAtNew = _effectiveAtkAtCellForAi(piece, room, 1, newCol, newRow);
  if (effAtkAtNew > (piece.atk || 0)) {
    score += W.commanderAdj;
  }
  // 보드 축소 회피 — 다음 축소 영역(newBounds) 밖에 들어가면 강한 페널티 (팀모드와 동일 로직)
  // 임박할수록 강한 페널티 (10턴 전: -25, 1턴 전: -250)
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  for (const ev of schedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const turnsToShrink = ev.shrinkTurn - room.turnNumber;
    if (turnsToShrink > 10 || turnsToShrink < 0) continue;
    // ★ AI freeze 버그 수정 — ev.newBounds 미설정 → undefined.min throw 방어.
    const _bs = room.mode === 'team' ? 7 : 5;
    const _nl = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
    const _evB = ev.newBounds || _levelToBounds(_nl, _bs);
    const willBeOutside = newCol < _evB.min || newCol > _evB.max ||
                          newRow < _evB.min || newRow > _evB.max;
    if (willBeOutside) {
      const urgency = Math.max(1, 11 - turnsToShrink);
      score -= W.shrinkAvoid * urgency;
    }
  }
  // 일반 가장자리 페널티 (보드 축소 임박 안 해도)
  if (room.turnNumber >= 25 && !room.boardShrunk) {
    if (newCol === bounds.min || newCol === bounds.max || newRow === bounds.min || newRow === bounds.max) {
      score *= W.edgePenaltyMul;
    }
  }

  // ★ 피격 기억: 최근에 맞은 말은 현재 위치에서 벗어나는 것에 높은 점수
  const mem = brain.hitMemory[piece.type];
  if (mem && brain.turnCount - mem.turn <= 2) {
    // 현재 위치가 맞은 위치와 같거나 인접 → 이동하면 생존 보너스
    const distFromHit = Math.abs(newCol - mem.col) + Math.abs(newRow - mem.row);
    const curDistFromHit = Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row);
    if (distFromHit > curDistFromHit) {
      // 맞은 곳에서 멀어지는 방향 → 큰 보너스
      score += W.fleeBonus * (1 + (piece.maxHp - piece.hp) / piece.maxHp); // HP 낮을수록 더 도망
    }
  }

  // ★ 추격 — 적 확률질량으로 한 칸씩 다가가는 유도력 (사거리 밖 적에게도 능동 접근).
  //   강한 즉시공격(원점수 6~10) 은 이 약한 보너스를 압도하므로 공격 기회는 그대로 우선.
  //   HP 낮은 도망 상황에서는 위 도주 보너스(25↑) 가 압도 → 추격이 도주를 방해하지 않음.
  score += aiApproachScore(brain, piece.col, piece.row, newCol, newRow, bounds) * W.approachMul;

  // ★ 위협 회피 — 새 위치에서 받을 예상 피격량만큼 감점 (사람처럼 사거리 회피). 치팅 X.
  score -= aiThreatPenalty(piece, brain._dangerMap, newCol, newRow) * W.threatMul;
  // ★ 정보 획득(정찰) — 새 위치 공격범위가 불확실 영역을 덮으면 소액 가산 (다음 턴 확정 유도).
  score += aiInfoGain(brain, piece.type, newCol, newRow, bounds, piece.toggleState) * W.infoGainMul;
  // ★ 지휘관 본인 — 버프 가능한 아군 수만큼 가산 (사기증진 진형 유지).
  score += aiCommanderAuraScore(piece, room, 1, newCol, newRow) * W.commanderAuraMul;

  return score;
}

function aiBestTargetCell(brain, piece, room) {
  const bounds = room.boardBounds;
  // ★ 사용자 보고 (치명적 결함): 그림자 암살자는 자신 + 주변 8칸 (3x3) 만 공격 범위.
  //   이전엔 witch 와 동일하게 보드 전역에서 best target 을 찾아 → AI 그림자가 맵 끝에서도 공격.
  //   piece.type 으로 분기: shadowAssassin = 3x3 제한, witch = 전역.
  const isShadow = piece && piece.type === 'shadowAssassin';
  let bestCol = piece.col, bestRow = piece.row, bestScore = -1;
  for (let r = bounds.min; r <= bounds.max; r++) {
    for (let c = bounds.min; c <= bounds.max; c++) {
      if (c === piece.col && r === piece.row) continue;
      // 그림자 암살자 — 주변 3x3 안만 후보
      if (isShadow && (Math.abs(c - piece.col) > 1 || Math.abs(r - piece.row) > 1)) continue;
      const score = brain.probMap[r][c];
      if (score > bestScore) { bestScore = score; bestCol = c; bestRow = r; }
    }
  }
  return { col: bestCol, row: bestRow };
}

function aiSelectPieces() {
  const t1 = CHARACTERS[1];
  const t2 = CHARACTERS[2];
  const t3 = CHARACTERS[3];
  return {
    t1: randomPick(t1.filter(c => c.type !== 'twins')).type,
    t2: randomPick(t2).type,
    t3: randomPick(t3).type,
  };
}

function aiDistributeHp(hasTwins) {
  if (hasTwins) {
    const patterns = [[2,2,3,3],[1,1,4,4],[2,1,3,4],[1,2,4,3],[2,2,2,4]];
    return randomPick(patterns);
  }
  const patterns = [
    [3,3,4],[2,4,4],[3,4,3],[2,3,5],[3,3,4],
    [2,4,4],[4,3,3],[3,5,2],[2,5,3],[4,4,2],
  ];
  return randomPick(patterns);
}

// 1v1 AI 배치 — 팀전 aiTeamPlace 와 동일한 점수식(aiPlacementCellScore) 사용.
//   ★ 사용자 요청: 1v1 과 팀전 AI 동일 동작 + 초반배치도 공격범위/지휘관 버프 의식.
//   1v1 은 안개로 적 위치를 모른 채(AI 가 먼저 배치) 진행 → enemyAttackCells 는 보통 비어 있음.
//   대신 지휘관 인접(사기증진), 호위무사 보호, 힐러 커버리지, 자기 말 밀집(AoE) 회피,
//   보드 축소 회피, 중앙 통제력을 점수화한다. 1v1 은 보드 전체(진영 구분 없음)에 배치.
function aiPlacePieces(room) {
  const ownerIdx = 1;                       // 1v1 AI 는 항상 인덱스 1
  const p = room.players[ownerIdx];
  if (!p) return;
  const bounds = room.boardBounds || { min: 0, max: 4 };
  const enemyIdxs = (typeof getEnemyIndices === 'function') ? getEnemyIndices(room, ownerIdx) : [0];

  // 점유 칸 (자기 말만 — 적은 안개)
  const occupied = new Set();
  for (const pc of (p.pieces || [])) {
    if (pc.col >= 0 && pc.row >= 0) occupied.add(`${pc.col},${pc.row}`);
  }
  // 적 공격범위 — 적 위치가 공개된 경우에만 (보통 1v1 배치 시점엔 비어 있음)
  const enemyAttackCells = new Set();
  for (const ei of enemyIdxs) {
    for (const epc of (room.players[ei]?.pieces || [])) {
      if (epc.col < 0 || epc.row < 0) continue;
      try {
        for (const c of getAttackCells(epc.type, epc.col, epc.row, bounds, { toggleState: epc.toggleState }))
          enemyAttackCells.add(`${c.col},${c.row}`);
      } catch (e) {}
    }
  }
  // 보드 축소 일정
  const shrinkSchedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  const futureShrinkBounds = [];
  for (const ev of shrinkSchedule) {
    if (room.boardShrinkStage >= ev.stage) continue;
    const _bs = room.mode === 'team' ? 7 : 5;
    const _nl = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
    const evBounds = ev.newBounds || (typeof _levelToBounds === 'function' ? _levelToBounds(_nl, _bs) : null);
    if (evBounds) futureShrinkBounds.push(evBounds);
  }

  const placeCtx = {
    room, bounds, occupied, enemyAttackCells, futureShrinkBounds,
    teamId: 1,                       // 행 선호 그라디언트용 (하단 진영처럼 처리)
    friendlyIdxs: [ownerIdx],        // 시너지 대상 = 자기 말 전체
    teammateIdxs: [ownerIdx],        // 밀집 회피 대상 = 자기 말 (AoE 회피)
  };

  // 처리 순서: 공격형 먼저(전방 선점), 지원/약한 유닛 나중(남은 안전 자리)
  const piecesOrdered = (p.pieces || [])
    .filter(pc => pc.alive && pc.col < 0)
    .sort((a, b) => {
      const aPri = aiIsAggressivePiece(a) ? 0 : (aiIsSupportPiece(a) || aiIsFragilePiece(a) ? 2 : 1);
      const bPri = aiIsAggressivePiece(b) ? 0 : (aiIsSupportPiece(b) || aiIsFragilePiece(b) ? 2 : 1);
      return aPri - bPri;
    });

  for (const piece of piecesOrdered) {
    if (piece.col >= 0) continue;
    let best = { col: -1, row: -1, score: -Infinity };
    for (let r = bounds.min; r <= bounds.max; r++) {
      for (let c = bounds.min; c <= bounds.max; c++) {
        const s = aiPlacementCellScore(piece, c, r, placeCtx);
        if (s > best.score) best = { col: c, row: r, score: s };
      }
    }
    if (best.col >= 0) {
      piece.col = best.col;
      piece.row = best.row;
      occupied.add(`${best.col},${best.row}`);
    }
  }
}

// ── AI Main Turn Logic ──────────────────────────────────────────

// AI가 피격당했을 때 기억 저장 (being_attacked 처리 시 호출)
function aiRecordHit(brain, piece) {
  brain.hitMemory[piece.type] = { col: piece.col, row: piece.row, turn: brain.turnCount };
}

// AI 스킬 사용 후 플레이어+관전자에게 알림
function aiNotifySkill(room, pieceIdx, result, skillId) {
  if (!result || !result.ok) return;
  const piece = room.players[1].pieces[pieceIdx];
  // ★ 다중 스킬 캐릭터 (화약상의 폭탄 설치 vs 기폭 등) — 실제 시전된 스킬 이름을 정확히 전달.
  //   piece.skillName 만 쓰면 첫 번째 스킬명 (폭탄 설치) 만 노출돼 말풍선이 잘못 표시됨.
  let actualSkillName = piece.skillName || '';
  if (skillId && Array.isArray(piece.skills)) {
    const matched = piece.skills.find(s => s.id === skillId);
    if (matched && matched.name) actualSkillName = matched.name;
  }
  // 플레이어에게 status_update — 시전자 카드 spotlight + 마법구 비행 트리거
  // ★ 사용자 보고 (애니/도장 누락): AI 1v1 status_update 가 hits/borderCells/ringTeleport/healed*/
  //   cursed*/twinJoin 을 모두 누락하고 있어 receiver 가 데미지 도장·라바·반지·회복 플래시·저주
  //   turn-bright·분신 비행을 모두 출력 못함. 인간 use_skill 경로 (8480 부근) 와 동일한 페이로드로 통일.
  const human = room.players[0];
  if (human.socketId !== 'AI') {
    io.to(human.socketId).emit('status_update', {
      oppPieces: oppPieceSummary(room.players[1].pieces),
      yourPieces: pieceSummary(human.pieces),
      sp: room.sp,
      instantSp: room.instantSp,
      boardObjects: boardObjectsSummary(room, 0),
      remains: room.remains || [],
      msg: result.oppMsg || null,
      skillUsed: {
        icon: piece.icon,
        name: piece.name,
        skillName: actualSkillName,
      },
      casterPieceIdx: pieceIdx,
      // ★ 회복 애니 — 1v1 receiver 측에서 #opp-pieces-info 카드에 heal-flash 적용용.
      healedPieceIdxs: result.data?.healedPieceIdxs || null,
      // ★ 회복 (newer owner-aware) — { ownerIdx, pieceIdx } 페어
      healedPieces: result.data?.healedPieces || null,
      // ★ 분신 비행 애니 — fog-of-war 우회용 좌표 정보
      twinJoin: result.data?.twinJoin || null,
      // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 빨간 도장 / 충성 파란 도장용 (defPieceIdx, defOwnerIdx 포함)
      hits: result.data?.hits || null,
      // ★ 유황범람 borderCells — 라바 애니 적용용
      borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
      // ★ 저주 부여 정보 — 1v1 receiver 시점에서도 turn-bright 적용
      cursedPieceIdx: result.data?.cursedPieceIdx,
      cursedOwnerIdx: result.data?.cursedOwnerIdx,
      // ★ 절대복종 반지 — 1v1 receiver (피해자) 시점 순간이동 애니용
      ringTeleport: result.data?.ringTeleport || null,
      // ★ 악몽 시전 — 표식 적 셀 보라 펄스용 좌표
      nightmareCells: result.data?.nightmareCells || null,
      // ※ herbCenter / divineTarget — 적팀에는 비공개 (사용자 요청).
    });
  }
  // 1v1 관전자: 마법구 비행 + spotlight 전용 이벤트
  // ★ 사용자 보고 동일 — 관전자도 동일한 페이로드 전달 (인간 use_skill 의 spectator_skill_anim 경로와 통일).
  for (const s of (room.spectators || [])) {
    io.to(s.socketId).emit('spectator_skill_anim', {
      casterIdx: 1,
      casterName: 'AI',
      casterPieceIdx: pieceIdx,
      sp: room.sp,
      instantSp: room.instantSp,
      skillUsed: { icon: piece.icon, name: piece.name, skillName: actualSkillName },
      // ★ 분신 비행 애니메이션 — 좌표 정보 (있을 때만)
      twinJoin: result.data?.twinJoin || null,
      msg: result.msg || null,
      // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용
      hits: result.data?.hits || null,
      // ★ 회복 애니메이션 — { ownerIdx, pieceIdx } 페어
      healedPieces: result.data?.healedPieces || null,
      // ★ 유황범람 borderCells — 라바 애니
      borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
      // ★ 저주 부여 정보 — turn-bright
      cursedPieceIdx: result.data?.cursedPieceIdx,
      cursedOwnerIdx: result.data?.cursedOwnerIdx,
      // ★ 절대복종 반지 순간이동 (관전자 시점)
      ringTeleport: result.data?.ringTeleport || null,
      // ★ 악몽 시전 — 관전자도 표식 적 셀 보라 펄스 표시
      nightmareCells: result.data?.nightmareCells || null,
      // ★ 약초학/신성 — 1v1 관전자에게 항상 공유 (관전자는 모든 정보 시각화).
      herbCenter: result.data?.herbCenter || null,
      divineTarget: result.data?.divineTarget || null,
    });
  }
  // 관전자 로그
  if (!result.skipLog && result.msg) {
    const specMsg = buildSpectatorSkillMsg('AI', piece, result);
    emitToSpectators(room, 'spectator_log', { msg: specMsg, type: 'skill', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  // ★ 기폭 (detonate) — 폭발 애니메이션 emit. 인간 use_skill 경로와 동일.
  //   누락 시 AI가 기폭을 써도 상대방에게 폭발 애니가 안 보임 (사용자 보고).
  if (result.data && Array.isArray(result.data.deferredBombEmits)) {
    const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row, owner: b.owner }));
    if (bombList.length > 0) {
      emitToBoth(room, 'detonation_intro', { bombs: bombList });
      // emitToBoth 가 이미 spectators 포함 (중복 방지)
    }
    const deferred = [...result.data.deferredBombEmits];
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      for (const bd of deferred) {
        emitToBoth(room, 'bomb_detonated', bd);
      }
      // ★ 사용자 보고: 마법사 폭탄 피격 시 인스턴트 SP 즉시 반영 누락.
      //   detonateBomb({deferEmit:true}) suppressSpUpdate=true 로 호출 → bomb_detonated 직후 emit.
      if (typeof emitSPUpdate === 'function') emitSPUpdate(room);
    }, 1930);
  }

  // AI 토스트 추적 — 1v1 AI 스킬도 인트라 턴 행동 순서 보장
  aiTrackToast(room, 'skill');
}

// AI executeSkill wrapper — 실행 후 알림
function aiExecSkill(room, pidx, skillId, params) {
  // ★ 사망 기폭 페이즈 — 스킬 (학살영웅 attack 비슷한 효과 / 유황범람 / 악몽 등) 로 화약상 사망 시 큐.
  startPhase(room);
  const result = executeSkill(room, 1, pidx, skillId, params || {});
  aiNotifySkill(room, pidx, result, skillId);  // skillId 전달 — 다중스킬 캐릭터의 정확한 스킬명용
  // 사망 기폭 페이즈 flush — checkGameEndAfterPhase 는 별도 (AI는 endTurn 따로)
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') {
      checkGameEndAfterPhase(room);
    }
  });
  return result;
}

// ── AI 절대복종 반지 전략 헬퍼 (사용자 요청) ──
//   다음 4가지 명확한 이득이 있을 때만 사용 — 그 외 남발 금지:
//   1. 보드 축소 임박 (≤5턴) 시 적을 보드 파괴 영역으로 이동
//   2. AI 공격범위에 적을 옮겨 즉사 / 다대미지 연계 (즉사 우선)
//   3. AI 덫/폭탄/쥐 설치물 위로 적을 이동 → 자동 발동 또는 후속 기폭
//   4. AI 유닛을 위협하는 적을 위협 안 닿는 곳으로 옮겨 방어
//   returns: { target, destCol, destRow, score, reasons } | null
//   ★ aiIdx = 시전자 인덱스, enemyOwnerIdxs = 적 owner 인덱스들 (1v1 [1-aiIdx], 팀모드 enemyIdxs)
function _aiPickRingPlay(room, aiIdx, enemyOwnerIdxs) {
  const bounds = room.boardBounds;
  const aiPlayer = room.players[aiIdx];

  // ★ 사용자 정정: 절대복종 반지는 '이름(공개정보)'으로 대상을 지정해 강제 이동시키는 능력.
  //   따라서 적의 '현재 위치'를 몰라도 사용 가능 — 공격 활용은 전부 AI 자신의 정보(설치물·공격범위·
  //   축소일정) + 공개 HP 기반이며, 이동 목적지는 AI 가 직접 정한다. marked 여부와 무관하게 모든 적 대상.
  //   (단, [4] 방어 플레이만은 적의 현재 위치가 필요 → marked 적에만 적용.)
  const enemies = [];
  for (const eIdx of enemyOwnerIdxs) {
    const owner = room.players[eIdx];
    if (!owner) continue;
    for (const p of (owner.pieces || [])) {
      if (p.alive) enemies.push({ piece: p, ownerIdx: eIdx, marked: aiIsMarked(p) });
    }
  }
  if (enemies.length === 0) return null;

  // 목적지 차단 셀 — 자기 말(위치 앎: 공정) + 유해(공개). 적 위치는 안개이므로 쓰지 않음.
  //   (서버 ring 은 점유 칸도 허용하지만, 자기 말과 겹치는 무의미한 이동은 배제.)
  const blocked = new Set();
  const allyIdxs = (typeof getAllyIndices === 'function') ? getAllyIndices(room, aiIdx) : [aiIdx];
  for (const ai of allyIdxs) {
    for (const pc of (room.players[ai]?.pieces || [])) {
      if (pc.alive && pc.col != null && pc.col >= 0) blocked.add(`${pc.col},${pc.row}`);
    }
  }
  for (const rm of (room.remains || [])) blocked.add(`${rm.col},${rm.row}`);

  // AI 공격 가능 셀 → maxAtk (commander 사기증진 버프 반영, 공정: 자기 위치 앎)
  const aiAttackMap = new Map();
  for (const p of aiPlayer.pieces) {
    if (!p.alive || p.col == null || (p.atk || 0) <= 0) continue;
    if ((p.statusEffects || []).some(e => e.type === 'shadow')) continue;  // 그림자 상태는 공격 불가
    const eff = (typeof _effectiveAtkForAi === 'function') ? _effectiveAtkForAi(p, room, aiIdx) : (p.atk || 0);
    const cells = getAttackCells(p.type, p.col, p.row, bounds, { toggleState: p.toggleState });
    for (const c of cells) {
      const key = `${c.col},${c.row}`;
      const entry = aiAttackMap.get(key) || { maxAtk: 0 };
      if (eff > entry.maxAtk) entry.maxAtk = eff;
      aiAttackMap.set(key, entry);
    }
  }

  // AI 보드 설치물 (덫/폭탄/쥐)
  const aiObjs = room.boardObjects[aiIdx] || [];
  const trapCells = new Set(aiObjs.filter(o => o.type === 'trap').map(o => `${o.col},${o.row}`));
  const bombCells = new Set(aiObjs.filter(o => o.type === 'bomb').map(o => `${o.col},${o.row}`));
  const ratCells  = new Set(aiObjs.filter(o => o.type === 'rat' ).map(o => `${o.col},${o.row}`));

  // 보드 축소 임박 영역
  let shrinkDoomCells = null;
  const schedule = (typeof getBoardShrinkSchedule === 'function') ? getBoardShrinkSchedule(room) : [];
  const nextShrink = schedule.find(ev => room.boardShrinkStage < (ev.stage || 0) && room.turnNumber < ev.shrinkTurn);
  if (nextShrink) {
    const turnsLeft = nextShrink.shrinkTurn - room.turnNumber;
    if (turnsLeft <= 5) {
      const baseSize = room.mode === 'team' ? 7 : 5;
      const nextLevel = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
      const newBounds = nextShrink.newBounds || _levelToBounds(nextLevel, baseSize);
      shrinkDoomCells = new Set();
      for (let r = bounds.min; r <= bounds.max; r++) {
        for (let c = bounds.min; c <= bounds.max; c++) {
          const inSafe = c >= newBounds.min && c <= newBounds.max && r >= newBounds.min && r <= newBounds.max;
          if (!inSafe) shrinkDoomCells.add(`${c},${r}`);
        }
      }
    }
  }

  // AI 유닛 셀 (방어 플레이 — marked 적이 위협 중인지 판정용)
  const aiCellSet = new Set(aiPlayer.pieces.filter(p => p.alive && p.col != null).map(p => `${p.col},${p.row}`));
  const TRAP_DMG = 2;

  const candidates = [];
  for (const { piece: target, ownerIdx: targetOwnerIdx, marked } of enemies) {
    const tgtVal = (typeof aiUnitValue === 'function') ? aiUnitValue(target) : (target.tier || 1) * 2;
    // 방어 플레이 사전 판정 — marked 적이 현재 AI 유닛을 위협 중인지 (위치 앎이 필요).
    let threatensNow = false;
    if (marked && target.col != null) {
      const curAttack = getAttackCells(target.type, target.col, target.row, bounds, { toggleState: target.toggleState });
      threatensNow = curAttack.some(ac => aiCellSet.has(`${ac.col},${ac.row}`));
    }
    // 모든 칸을 목적지 후보로 평가 (적 현재 위치 불필요 — 목적지 가치는 전부 AI 자신의 정보)
    for (let r = bounds.min; r <= bounds.max; r++) {
      for (let c = bounds.min; c <= bounds.max; c++) {
        const cellKey = `${c},${r}`;
        if (blocked.has(cellKey)) continue;       // 자기 말/유해 위로는 이동 안 함
        let score = 0;
        const reasons = [];

        // [1] 보드 축소 도착지 — 곧 파괴될 외곽으로 끌어내 확정 처치
        if (shrinkDoomCells && shrinkDoomCells.has(cellKey)) {
          score += 80 + tgtVal * 2;
          reasons.push('shrink');
        }

        // [2] AI 공격범위로 끌어와 즉사/다대미지 — 이동 목적지는 AI 가 정하므로
        //     이후(반지는 행동 대체 X) 다른 유닛이 확정 위치를 공격 가능. 공개 HP 로 즉사 판정.
        const atkEntry = aiAttackMap.get(cellKey);
        if (atkEntry && atkEntry.maxAtk > 0) {
          if (atkEntry.maxAtk >= target.hp) {
            score += 100 + tgtVal * 2;               // 즉사 가능 — 최고 점수
            reasons.push('oneShot');
          } else {
            score += 25 + atkEntry.maxAtk * 8;       // 다대미지 (HP 손실)
            reasons.push('attackCombo');
          }
        }

        // [3] 설치물 위로 이동 — 덫은 즉시 2 피해(공개 HP≤2 면 확정 처치)
        if (trapCells.has(cellKey)) {
          score += (target.hp <= TRAP_DMG) ? (90 + tgtVal * 2) : 55;
          reasons.push('trap');
        } else if (bombCells.has(cellKey)) {
          score += 45; reasons.push('bomb');
        } else if (ratCells.has(cellKey)) {
          score += 12; reasons.push('rat');
        }

        // [4] 방어 — 위협 중인(marked) 적을 위협 안 닿는 곳으로
        if (threatensNow) {
          const newAttack = getAttackCells(target.type, c, r, bounds, { toggleState: target.toggleState });
          const stillThreat = newAttack.some(ac => aiCellSet.has(`${ac.col},${ac.row}`));
          if (!stillThreat) { score += 40; reasons.push('defense'); }
        }

        if (score > 0) candidates.push({ target, targetOwnerIdx, destCol: c, destRow: r, score, reasons });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // 임계값 — SP 3 가치 이상의 이득이 명확할 때만 시전 (남발 방지).
  if (best.score < 40) return null;
  return best;
}

// AI 스킬 사용 판단 (free skills — 행동 전에 사용)
// 적극적 사용: 명백한 이득이 있으면 사용. SP 보존보다 스킬 가치 우선.
function aiUsePreSkills(room) {
  const aiPlayer = room.players[1];
  const human = room.players[0];
  const brain = room.aiBrain;
  const alivePieces = aiPlayer.pieces.filter(p => p.alive);
  const bounds = room.boardBounds;

  // ★ 사용자 요청 — AI 는 한 번에 한 개의 스킬만 사용. 시전 후 모든 애니메이션·토스트가
  //   화면에서 사라질 때까지 freeze. 다음 스킬은 aiTakeTurn 의 setTimeout 재진입으로 처리.
  //   _execed 가 true 이면 이번 호출에서는 더 이상 시전하지 않고 즉시 리턴 (다른 piece 도 스킵).
  let _execed = false;
  const _tryExec = (pidx, skillId, params) => {
    if (_execed) return false;
    const r = aiExecSkill(room, pidx, skillId, params);
    if (r && r.ok) { _execed = true; return true; }
    return false;
  };

  for (const piece of alivePieces) {
    if (_execed) break;  // 이미 한 개 시전 — 이번 호출 종료
    if (!piece.hasSkill || piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
    if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
    const pidx = aiPlayer.pieces.indexOf(piece);

    switch (piece.type) {
      // 그림자 암살자: 실제 위협이 있을 때만 사용 (사용자 요청 — 의미없는 random 사용 차단).
      //   조건: 이미 그림자 X + (최근 피격 기억 + 가까운 적 OR 위급 HP)
      case 'shadowAssassin': {
        const mem = brain.hitMemory[piece.type];
        const recentlyHit = mem && brain.turnCount - mem.turn <= 2;
        const hasShadow = piece.statusEffects.some(e => e.type === 'shadow');
        // 가까운 적 — 인접 4방 안에 적이 있을 가능성 (probMap 기반)
        let adjacentThreat = 0;
        for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nc = piece.col + dc, nr = piece.row + dr;
          adjacentThreat += brain.probMap[nr]?.[nc] || 0;
        }
        const inImmediateDanger = (recentlyHit && adjacentThreat >= 4) || piece.hp <= 1;
        if (!hasShadow && inImmediateDanger) {
          _tryExec(pidx, 'shadow');
        }
        break;
      }
      // 궁수/무기상: 대안 공격범위가 더 좋으면 토글 (SP 1 — 자유롭게)
      case 'archer':
      case 'weaponSmith': {
        const curCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds, { toggleState: piece.toggleState });
        let curScore = 0;
        for (const c of curCells) curScore += brain.probMap[c.row]?.[c.col] || 0;
        const altState = piece.type === 'archer'
          ? (piece.toggleState === 'right' ? null : 'right')
          : (piece.toggleState === 'vertical' ? null : 'vertical');
        const altCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds, { toggleState: altState });
        let altScore = 0;
        for (const c of altCells) altScore += brain.probMap[c.row]?.[c.col] || 0;
        // ★ SP 수읽기 — 토글로 얻는 이득이 정규 SP 이관 문턱까지 넘을 때만.
        if (altScore > curScore * 1.3 && altScore >= 4 + _aiSpTransferBar(room, 1, piece.skillCost)) {
          _tryExec(pidx, 'reform');
        }
        break;
      }
      // 전령 질주 — 사용자 요청: SP 1을 함부로 쓰지 말 것. 확실한 이득이 있을 때만.
      //   기존: 최근 피격 기억만 있어도 무조건 사용 → 자주 의미없는 SP 소모.
      //   개선:
      //     (1) HP ≤ 1 인 위급 상황 (도망용 추가 이동) — 피격 기억 + 저체력
      //     (2) 적과 멀리 떨어져 있는데 attack score 가 0 이라 "다가가기" 위해 추가 이동이 필요한 경우 — 정찰/접근용
      //   그 외엔 보류.
      case 'messenger': {
        const mem = brain.hitMemory[piece.type];
        const recentlyHit = mem && brain.turnCount - mem.turn <= 1;
        // (1) 위급 도주
        const critical = piece.hp <= 1;
        // (2) 공격 가치 없을 때 — 현재 위치 공격범위 내 적 점수가 0 이고 적 가까이 갈 필요가 있는 경우
        const curAtkCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds);
        let curThreatScore = 0;
        for (const c of curAtkCells) curThreatScore += brain.probMap[c.row]?.[c.col] || 0;
        // ★ SP 수읽기 — 위급 도주(critical)는 항상 가치 있음. 단순 재배치는 정규 SP 를 상대에게
        //   넘기면서까지 할 가치가 없으므로, 이관 없이(instant SP 충당) 가능할 때만 시전.
        const reposNoTransfer = _aiSpTransferBar(room, 1, piece.skillCost) <= 1;
        const needsRepositioning = curThreatScore < 0.5 && recentlyHit && reposNoTransfer;
        if ((critical && recentlyHit) || needsRepositioning) {
          _tryExec(pidx, 'sprint');
        }
        break;
      }
      // 척후병: 정찰 — 사용자 요청(무의미한 random 금지). "정보가 부족할 때만" 의도적으로 시전.
      //   확률맵 최대값이 낮다 = 적 위치 단서가 약하다 → 정찰로 정보를 캐낸다.
      //   강한 추론(≥6) 이 이미 있으면 SP 낭비 안 함.
      case 'scout': {
        if (brain.mode === 'scan' && aiMaxProb(brain) < 6) {
          _tryExec(pidx, 'recon');
        }
        break;
      }
      // 약초전문가: 인접 아군 부상 시 적극적으로 회복 (SP 2)
      case 'herbalist': {
        const nearbyInjured = alivePieces.filter(a =>
          a !== piece && a.hp < a.maxHp &&
          Math.abs(a.col - piece.col) <= 1 && Math.abs(a.row - piece.row) <= 1
        );
        if (nearbyInjured.length >= 1) {
          _tryExec(pidx, 'herb');
        }
        break;
      }
      // 쥐장수: 쥐가 부족하면 소환 (SP 2). 사용자 요청 — random 제거, 부족분만 결정적으로 보충.
      case 'ratMerchant': {
        if (room.rats[1].length < 3) {
          _tryExec(pidx, 'rats');
        }
        break;
      }
      // 고문기술자: 표식된 적 있으면 즉시 악몽 (SP 3)
      case 'torturer': {
        const marked = human.pieces.filter(p => p.alive && p.statusEffects.some(e => e.type === 'mark'));
        if (marked.length >= 1) {
          _tryExec(pidx, 'nightmare');
        }
        break;
      }
      // 양손검객: 쌍검무(2회 공격) — 사용자 요청(random 금지). "때릴 표적이 있을 때만" 의도적 시전.
      //   현재 위치 공격범위의 확률질량(probMap 합)이 충분(≥4)하면 두 번 때릴 가치가 있다.
      case 'dualBlade': {
        const dbCells = getAttackCells(piece.type, piece.col, piece.row, room.boardBounds, { toggleState: piece.toggleState });
        let dbScore = 0, dbBest = 0;
        for (const c of dbCells) {
          const v = brain.probMap[c.row]?.[c.col] || 0;
          dbScore += v; if (v > dbBest) dbBest = v;
        }
        // ★ 의미없는 쌍검무 금지 — 집중된 실제 표적(한 칸 ≥6)이 있고, 정규 SP 이관 문턱을 넘는
        //   확실한 이득이 있을 때만. 분산된 확률질량(diffuse)만으로는 시전 안 함.
        const dbBar = 4 + _aiSpTransferBar(room, 1, piece.skillCost);
        if (dbBest >= 6 && dbScore >= dbBar) {
          _tryExec(pidx, 'dualStrike');
        }
        break;
      }
      // 수도승: 아군 부상 시 신성 (SP 3) — 회복 + 상태이상 제거
      case 'monk': {
        const injured = alivePieces.filter(a => a !== piece && a.hp < a.maxHp).sort((a, b) => a.hp - b.hp);
        const cursed = alivePieces.filter(a => a.statusEffects.some(e => e.type === 'curse' || e.type === 'mark'));
        const target = cursed[0] || injured[0];
        if (target && (cursed.length > 0 || target.hp <= target.maxHp * 0.6)) {
          const targetIdx = aiPlayer.pieces.indexOf(target);
          _tryExec(pidx, 'divine', { targetPieceIdx: targetIdx });
        }
        break;
      }
      // 국왕: 절대복종 반지 (SP 3) — 사용자 요청 전략적 사용만 (남발 금지).
      //   1. 보드 축소 임박 시 적을 외곽 파괴 영역으로 / 2. AI 공격범위 즉사 연계 /
      //   3. AI 덫·폭탄·쥐 위로 / 4. AI 유닛 위협 적을 위협 안 닿는 곳으로.
      case 'king': {
        const play = _aiPickRingPlay(room, 1, [0]);
        if (play) {
          const ok = _tryExec(pidx, 'ring', {
            targetName: play.target.type,
            col: play.destCol, row: play.destRow,
          });
          // ★ 반지로 옮긴 적 위치는 AI 가 직접 정했으므로 확실히 앎 → 확률맵 스파이크로 후속 공격 유도.
          if (ok && brain.probMap[play.destRow]) brain.probMap[play.destRow][play.destCol] = 10;
        }
        break;
      }
      // 드래곤 조련사: SP 5 충분하면 적극 소환
      case 'dragonTamer': {
        const aiHasDragon = aiPlayer.pieces.some(p => p.isDragon && p.alive);
        if (!aiHasDragon && (room.sp[1] + room.instantSp[1]) >= 5) {
          // 적과 가까운 빈 칸 우선
          const emptyCells = [];
          for (let r = bounds.min; r <= bounds.max; r++)
            for (let c = bounds.min; c <= bounds.max; c++) {
              const occ = room.players.some(pl => pl.pieces.some(p => p.alive && p.col === c && p.row === r));
              const hasRemains = room.remains && room.remains.some(rm => rm.col === c && rm.row === r);
              if (!occ && !hasRemains) emptyCells.push({ col: c, row: r });
            }
          if (emptyCells.length > 0) {
            // 적 위치는 직접 알 수 없으므로(치팅 금지) 확률맵상 적 존재 가능성이
            // 높은 칸 근처에 소환. 각 빈 칸의 3x3 확률 합으로 점수화해 최고점 선택.
            emptyCells.forEach(cell => {
              let s = 0;
              for (let dr = -1; dr <= 1; dr++)
                for (let dc = -1; dc <= 1; dc++)
                  s += brain.probMap[cell.row + dr]?.[cell.col + dc] || 0;
              cell._score = s;
            });
            emptyCells.sort((a, b) => b._score - a._score);
            const pos = emptyCells[0];
            _tryExec(pidx, 'dragon', { col: pos.col, row: pos.row });
          }
        }
        break;
      }
      // 화약상: 폭탄 설치 (replacesAction=false 분리 — 행동 후에도 사용 가능)
      case 'gunpowder': {
        // 기폭이 우선 — 설치된 폭탄 있고 적이 폭탄 인접 시 즉시 기폭
        const myBombs = (room.boardObjects[1] || []).filter(o => o.type === 'bomb');
        if (myBombs.length > 0) {
          // 적이 폭탄 영향권에 있는지 — 위치는 '표식' 찍힌 적만 공정하게 확인,
          // 그 외에는 확률맵으로 폭탄 주변 적 존재 가능성 추산 (치팅 금지).
          const marked = aiKnownEnemies(room, 1).filter(e => e.marked);
          let markedInBlast = 0;
          let probInBlast = 0;
          for (const b of myBombs) {
            for (const e of marked) {
              if (Math.abs(e.col - b.col) <= 1 && Math.abs(e.row - b.row) <= 1) markedInBlast++;
            }
            for (let dr = -1; dr <= 1; dr++)
              for (let dc = -1; dc <= 1; dc++)
                probInBlast += brain.probMap[b.row + dr]?.[b.col + dc] || 0;
          }
          // 표식으로 확인된 적이 있으면 즉시 기폭, 아니면 확률맵상 매우 높을 때만 기폭
          if (markedInBlast >= 1 || probInBlast >= 16) {
            _tryExec(pidx, 'detonate');
            break;
          }
        }
        // 신규 설치 — 인접 8칸 (자기 칸 제외) 중 적 있을 가능성 높은 위치
        if ((room.sp[1] + room.instantSp[1]) >= 2) {
          let bestCell = null, bestScore = -1;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dc === 0 && dr === 0) continue;          // 자기 칸 제외 (룰)
              const nc = piece.col + dc, nr = piece.row + dr;
              if (!inBounds(nc, nr, bounds)) continue;
              if (room.boardObjects[1].some(o => o.col === nc && o.row === nr)) continue;
              const score = brain.probMap[nr]?.[nc] || 0;
              if (score > bestScore) { bestScore = score; bestCell = { col: nc, row: nr }; }
            }
          }
          if (bestCell && bestScore >= 2) {
            _tryExec(pidx, 'bomb', { col: bestCell.col, row: bestCell.row });
          }
        }
        break;
      }
    }
  }
  return _execed;
}

// AI가 보드 축소 임박 시 외곽 셀에 있는 말을 안쪽으로 대피시킬 행동 찾기
// 반환: { piece, pieceIdx, col, row } 또는 null
function aiFindEvacuation(room) {
  const aiPlayer = room.players[1];
  const bounds = room.boardBounds;
  // 다음 축소 이벤트의 newBounds 가져오기 (turnNumber + 5턴 이내일 때만 발동)
  const schedule = getBoardShrinkSchedule(room);
  let nextShrink = null;
  for (const ev of schedule) {
    if (room.boardShrinkStage < ev.stage) {
      nextShrink = ev;
      break;
    }
  }
  if (!nextShrink) return null;
  const turnsLeft = nextShrink.shrinkTurn - room.turnNumber;
  if (turnsLeft > 5 || turnsLeft < 0) return null;
  // ★ AI freeze 버그 수정 — schedule 이벤트에 newBounds 없음 (사후 계산 안 됨).
  //   _levelToBounds 로 다음 LV 의 bounds 계산. 이전엔 undefined → inBounds() 가 throw → AI 멈춤.
  const baseSize = room.mode === 'team' ? 7 : 5;
  const nextLevel = Math.max(1, (room.boardShrinkLevel || (room.mode === 'team' ? 4 : 3)) - 1);
  const newB = nextShrink.newBounds || _levelToBounds(nextLevel, baseSize);
  // 곧 파괴될 셀 = 현재 bounds 안이지만 newBounds 밖
  const willBeDestroyed = (col, row) =>
    inBounds(col, row, bounds) && !inBounds(col, row, newB);
  // 외곽 위험 셀에 있는 내 살아있는 말들
  const danger = aiPlayer.pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && willBeDestroyed(p.col, p.row));
  if (danger.length === 0) return null;
  // 가장 위험한 말 1개 선택 (HP 낮은 우선)
  danger.sort((a, b) => a.p.hp - b.p.hp);
  const target = danger[0].p;
  const targetIdx = danger[0].i;
  // 안쪽으로 이동 가능한 인접 셀 찾기 (newBounds 안 + 점유되지 않음)
  const candidates = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nc = target.col + dc, nr = target.row + dr;
    if (!inBounds(nc, nr, bounds)) continue;
    if (!inBounds(nc, nr, newB)) continue;  // 안쪽으로만 이동
    // 유해 차단
    if (room.remains && room.remains.some(r => r.col === nc && r.row === nr)) continue;
    // 점유 검사 (자기/팀원 등 — 1v1: 자기 외 다른 말)
    const occupied = room.players.some(pl =>
      pl.pieces.some(p => p.alive && p !== target && p.col === nc && p.row === nr)
    );
    if (occupied) {
      // 쌍둥이끼리는 같은 칸 OK
      const sameTwin = target.subUnit && room.players.some(pl =>
        pl.pieces.some(p => p.alive && p !== target && p.col === nc && p.row === nr && p.subUnit && p.parentType === target.parentType)
      );
      if (!sameTwin) continue;
    }
    // 안쪽 깊이 점수 (newBounds 중심에 가까울수록 높음)
    const cx = (newB.min + newB.max) / 2, cy = (newB.min + newB.max) / 2;
    const dist = Math.abs(nc - cx) + Math.abs(nr - cy);
    candidates.push({ col: nc, row: nr, score: -dist });
  }
  if (candidates.length === 0) {
    // 인접 셀로는 못 빠지면 다른 위험 말로 폴백
    if (danger.length > 1) {
      // 임시 폴백: 두번째 위험 말 시도
      // (단순화 — 실제로는 모든 말을 순회하는 것이 정석)
    }
    return null;
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { piece: target, pieceIdx: targetIdx, col: best.col, row: best.row };
}

// AI가 피격 후 도망해야 하는 말 찾기
function aiFindFleeingPieces(room) {
  const brain = room.aiBrain;
  const aiPlayer = room.players[1];
  const fleeing = [];

  for (const piece of aiPlayer.pieces) {
    if (!piece.alive) continue;
    const mem = brain.hitMemory[piece.type];
    if (!mem || brain.turnCount - mem.turn > 2) continue;

    // 현재 위치가 맞은 위치와 같거나 인접 → 도망 필요
    const dist = Math.abs(piece.col - mem.col) + Math.abs(piece.row - mem.row);
    if (dist <= 1) {
      const urgency = (piece.maxHp - piece.hp) / piece.maxHp; // HP 많이 깎였을수록 긴급
      fleeing.push({ piece, urgency, pieceIdx: aiPlayer.pieces.indexOf(piece) });
    }
  }

  return fleeing.sort((a, b) => b.urgency - a.urgency);
}

const AI_ACTION_DELAY = 3000;
function aiEndTurn(room) {
  // 사용자 요청: AI 는 자신의 턴에 발생한 모든 토스트가 사라진 후 0.5초 버퍼까지 대기 후 endTurn.
  //   - 토스트 발생 순서대로 표시되어야 하고,
  //   - 다음 플레이어의 턴오더 토스트가 직전 스킬/공격 토스트보다 먼저 오는 일이 없도록.
  const now = Date.now();
  const earliest = room._aiEndTurnEarliest || 0;
  const remainingToastMs = Math.max(0, earliest - now);
  const delay = Math.max(AI_ACTION_DELAY, remainingToastMs + 500);
  setTimeout(() => {
    if (room.phase === 'game') endTurn(room);
  }, delay);
  room._aiEndTurnEarliest = 0;  // 다음 AI 턴 위해 리셋 (stale future-time 으로 인한 freeze 방지)
}

// ★ 사용자 룰: 한 셀에 여러 아군 유닛 겹쳐놓기 금지. 예외:
//   1. 쌍둥이끼리 (같은 owner + 같은 parentType + 둘 다 subUnit) 한 셀에 합류 가능.
//   2. 절대복종반지로 강제이동된 경우 (별도 흐름 — 이 함수와 무관).
//   AI 가 자기 아군 위로 이동을 선택하지 않도록 점유 검사 시 사용.
function _canMoveTo(room, piece, nc, nr) {
  // 유해 차단
  if (room.remains && room.remains.some(r => r.col === nc && r.row === nr)) return false;
  for (const pl of (room.players || [])) {
    for (const pc of (pl.pieces || [])) {
      if (pc.alive && pc !== piece && pc.col === nc && pc.row === nr) {
        // 쌍둥이 합류 예외 — 같은 owner + 같은 parentType + 둘 다 subUnit.
        const sameOwner = pl.pieces.includes(piece);
        if (sameOwner && piece.subUnit && pc.subUnit && piece.parentType && piece.parentType === pc.parentType) {
          return true;
        }
        return false;
      }
    }
  }
  return true;
}

function aiTakeTurn(room) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const bounds = room.boardBounds;

  // ★ Intra-turn 버퍼 — 직전 (같은 턴 내) 스킬·액션의 토스트가 아직 화면에 있으면 대기.
  //   _aiEndTurnEarliest 는 aiEndTurn 에서 리셋되므로 cross-turn 에는 영향 없음. 단, 안전 cap (5s).
  //   사용자 요청: 액션 ↔ 스킬 양방향 모두 명확한 호흡 텀.
  const _now = Date.now();
  const _earliest = room._aiEndTurnEarliest || 0;
  if (_earliest > _now) {
    const remain = _earliest - _now;
    // 안전 cap — stale value 로 인한 freeze 방지 (정상값은 ~6초 이내)
    const waitMs = Math.min(7500, remain + 1500);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === 1) {
        aiTakeTurn(room);
      }
    }, waitMs);
    return;
  }

  brain.turnCount++;
  aiSpreadProbability(brain);
  // ★ enemiesAlive 동적화 — 이전엔 3 하드코딩이라 실제 적 말 수와 어긋나 finish 모드 전환이 틀어짐.
  //   매 턴 실제 살아있는 적 말 수로 갱신 → aiProcessAttackResult 의 finish(≤1) 판정이 정확.
  brain.enemiesAlive = humanPlayer.pieces.filter(p => p.alive).length;
  aiLogTurnStart(room, 1);  // AI 학습 로깅 — 턴 시작 belief+보드 스냅샷
  // ★ 확률맵 정화 + 위협맵 — 내 말 칸은 적 없음(공정), 위험 칸 회피용 dangerMap 1회 구축.
  aiClearOwnCells(brain, room, 1);
  brain._dangerMap = aiBuildDangerMap(room, 1, brain);
  brain._dangerTurn = brain.turnCount;

  const alivePieces = aiPlayer.pieces.filter(p => p.alive);
  if (alivePieces.length === 0) return;

  // ★ STEP 0: 보드 축소 임박 — 외곽 말 즉시 대피 최우선
  // 다음 축소까지 5턴 이내이고, 외곽(곧 파괴될 셀)에 있는 내 말이 있으면 안쪽으로 이동
  const evacAction = aiFindEvacuation(room);
  if (evacAction && !aiPlayer.actionDone) {
    aiExecuteMove(room, evacAction);
    return;
  }

  // ★ STEP 1: 행동 전 free 스킬 사용
  //   사용자 요청: AI 는 한 번에 한 개의 스킬만 시전. 시전 후 모든 애니메이션·토스트·팝업이
  //   화면에서 완전히 사라질 때까지 freeze. 그 다음에야 다음 스킬·행동 가능.
  //   → aiUsePreSkills 가 한 번에 한 개만 시전 (내부 _execed 가드).
  //   → 재진입 대기 시간은 _aiEndTurnEarliest (토스트가 사라지는 시점) 기준 + 안전 마진.
  // ★ usedPreSkill 은 aiUsePreSkills 의 반환값으로 판정.
  //   ❌ 이전 버그: skillsUsedBeforeAction.length 비교는 oncePerTurn 스킬에서만 push 되므로
  //      recon/bomb/herb/divine/ring 등 비-oncePerTurn 스킬은 잘못된 false 가 나와
  //      AI 가 즉시 액션으로 폴-스루 → 스킬+액션 동시 시전.
  const usedPreSkill = aiUsePreSkills(room);
  if (usedPreSkill) {
    // 이전 스킬의 토스트/애니메이션이 화면에서 사라질 때까지 대기 — _aiEndTurnEarliest 활용.
    //   skill 의 경우 _aiEndTurnEarliest = now + 5900ms (appear 1500 + display 4000 + fade 350 + 50 buffer).
    //   사용자 요청: 스킬과 다음 행동(다른 스킬/일반 액션) 사이 명확한 호흡 텀 — 1500ms 버퍼.
    //   토스트 사라진 후에도 1.5초 가량 정적 → 다음 스킬/액션의 토스트가 명확히 분리되어 보임.
    const now = Date.now();
    const earliest = room._aiEndTurnEarliest || 0;
    const waitMs = Math.max(2500, (earliest - now) + 1500);
    setTimeout(() => {
      if (room.phase === 'game' && room.currentPlayerIdx === 1) {
        aiTakeTurn(room);
      }
    }, waitMs);
    // ★ 직전 iteration 이 스킬 시전이었음을 마킹 — 다음 iteration 에서 액션으로 fall-through 시 추가 버퍼.
    room._aiLastWasSkill = true;
    return;
  }

  // ★ 직전 iteration 이 스킬이었고 이번에 더 이상 스킬을 안 쓴다면, 액션으로 넘어가기 전 추가 버퍼.
  //   사용자 요청: AI 가 스킬과 일반 행동을 거의 동시에 하는 느낌 제거. 스킬 phase 끝 → 명확한 텀 → 액션 phase.
  if (room._aiLastWasSkill) {
    room._aiLastWasSkill = false;
    const now = Date.now();
    const earliest = room._aiEndTurnEarliest || 0;
    const remain = Math.max(0, earliest - now);
    const waitMs = remain + 1500;  // 토스트 끝난 후 1.5초 추가 텀
    if (waitMs >= 200) {
      setTimeout(() => {
        if (room.phase === 'game' && room.currentPlayerIdx === 1) {
          aiTakeTurn(room);
        }
      }, waitMs);
      return;
    }
  }

  // ★ STEP 2: 피격된 말 — 도망 vs 반격 비교 (#6)
  // 도망만 하지 말고, 현재 공격으로 상대 격파가 가능하면 공격을 우선 고려
  const fleeList = aiFindFleeingPieces(room);
  if (fleeList.length > 0 && !aiPlayer.actionDone) {
    const flee = fleeList[0];
    const piece = flee.piece;
    const mem = brain.hitMemory[piece.type];

    // 반격 가치: 현재 위치에서 공격 시 예상 점수 (probMap 기반)
    let counterExtra = {};
    if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
      const bt = aiBestTargetCell(brain, piece, room);
      counterExtra.tCol = bt.col; counterExtra.tRow = bt.row;
    }
    if (piece.toggleState) counterExtra.toggleState = piece.toggleState;
    const counterAttackScore = aiScoreAttack(brain, piece, room, counterExtra);

    // 최적 도망 위치 평가
    let bestMove = null, bestFleeScore = -1;
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nc = piece.col + dc, nr = piece.row + dr;
      if (!inBounds(nc, nr, bounds)) continue;
      // ★ 룰 통일: 모든 플레이어 점유 검사 + 쌍둥이 합류 예외.
      if (!_canMoveTo(room, piece, nc, nr)) continue;
      const dist = Math.abs(nc - mem.col) + Math.abs(nr - mem.row);
      const atkAfterMove = aiScoreMove(brain, piece, nc, nr, room);
      const fleeScore = dist * 15 + atkAfterMove;
      if (fleeScore > bestFleeScore) {
        bestFleeScore = fleeScore;
        bestMove = { col: nc, row: nr };
      }
    }

    // 반격 우선 판단 — 상대 유닛 위치를 추론하고 격파 가능하면 반격
    const criticalHp = piece.hp <= 2;
    // 상대 위치 추론: probMap에서 가장 높은 셀이 공격 범위 내인지
    let canHitProbTarget = false;
    let probTargetScore = 0;
    let sureHit = false;  // 9점 셀 (확정에 가까운 적 위치) 공격 가능 여부
    const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, { toggleState: piece.toggleState });
    for (const c of atkCells) {
      const v = brain.probMap[c.row]?.[c.col] || 0;
      if (v >= 9) sureHit = true;
      if (v >= 6) { canHitProbTarget = true; probTargetScore += v; }
    }
    // ★ 직전 턴 반격이 빗나갔다면(추론 실패) 같은 자리에서 또 때리지 말고 도주 — 사용자 보고.
    //   단, 지금 확정 타겟(probMap=9, 표식 등)이 보이면 도주 충동보다 격파를 우선.
    const fu = brain.fleeUrge && brain.fleeUrge[piece.type];
    const justMissedCounter = (typeof fu === 'number') && (brain.turnCount - fu <= 1);
    // 확정 격파 가능 (probMap=9 셀 공격 가능)이면 HP 위험 무시하고 공격 — 적의 사망이 더 가치 있음
    const shouldCounterAttack = sureHit || (
      !justMissedCounter && !criticalHp && (
        canHitProbTarget ||
        (counterAttackScore > bestFleeScore * 1.05 && counterAttackScore > 4)
      )
    );

    if (shouldCounterAttack) {
      aiExecuteAttack(room, { piece, pieceIdx: flee.pieceIdx, score: counterAttackScore, extra: counterExtra });
      return;
    }
    if (bestMove) {
      aiExecuteMove(room, { piece, pieceIdx: flee.pieceIdx, col: bestMove.col, row: bestMove.row });
      return;
    }
  }

  // ★ STEP 3: 행동 대체 스킬 사용 (manhunter 덫, witch 저주, sulfurCauldron 유황범람)
  // 적극적 사용: 명백한 이득이 있으면 즉시 시전.
  if (!aiPlayer.actionDone) {
    for (const piece of alivePieces) {
      if (!piece.hasSkill || !piece.skillReplacesAction || (room.sp[1] + room.instantSp[1]) < piece.skillCost) continue;
      if (piece.statusEffects && piece.statusEffects.some(e => e.type === 'curse')) continue;
      const pidx = aiPlayer.pieces.indexOf(piece);

      if (piece.type === 'manhunter') {
        // ★ 치팅 제거 — 비표식 적 실위치 안 봄. 표식 적이 인접(≤2)하거나, 내 칸 주변
        //   적 확률질량이 높을(곧 밟을) 때만 결정적으로 덫 설치.
        const markedDists = aiKnownEnemies(room, 1).filter(e => e.marked)
          .map(e => Math.abs(e.col - piece.col) + Math.abs(e.row - piece.row));
        const nearestMarked = markedDists.length ? Math.min(...markedDists) : 99;
        let probAround = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          probAround += brain.probMap[piece.row + dr]?.[piece.col + dc] || 0;
        }
        // 같은 자리에 이미 덫이 있으면 X
        const hasTrap = (room.boardObjects[1] || []).some(o => o.type === 'trap' && o.col === piece.col && o.row === piece.row);
        if (!hasTrap && (nearestMarked <= 2 || probAround >= 14)) {
          aiExecSkill(room, pidx, 'trap');
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'witch') {
        // ★ 사용자 정정: 수도승은 신성 스킬로 다른 아군의 저주를 해소함 — 수도승 본인을 저주하면
        //   저주 상태인 piece 는 스킬 봉인됨 ([server.js:4507](server.js:4507)) → 신성 차단 = 저주 해소 차단.
        //   따라서 수도승을 0순위로 저주 (가호 패시브는 villain 공격 데미지에만 적용, 저주 status 와 무관).
        const enemies = room.players[0].pieces.filter(p => p.alive && p.hp > 1 &&
          !p.statusEffects.some(e => e.type === 'curse' || e.type === 'shadow'));
        if (enemies.length > 0) {
          // 우선순위: 저주 가치(aiCurseValue: 수도승=100 > 강스킬·고가치) > HP > 티어.
          //   저주=스킬 봉인 → 봉인 가치 큰 핵심 유닛 우선 (사용자 요청).
          enemies.sort((a, b) =>
            (aiCurseValue(b) - aiCurseValue(a)) ||
            b.hp - a.hp ||
            (b.tier || 0) - (a.tier || 0)
          );
          const target = enemies[0];
          const tIdx = room.players[0].pieces.indexOf(target);
          aiExecSkill(room, pidx, 'curse', { targetPieceIdx: tIdx });
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'sulfurCauldron' && (room.sp[1] + room.instantSp[1]) >= piece.skillCost) {
        // 보드 외곽에 적 있을 확률 높거나, 외곽이 좁아져 적이 외곽으로 몰릴 때
        const borderCells = getBorderCells(bounds);
        let borderScore = 0;
        for (const c of borderCells) borderScore += brain.probMap[c.row]?.[c.col] || 0;
        // ★ 치팅 제거 — 비표식 적의 실위치를 보지 않는다. 표식된(공개) 적만 외곽 카운트.
        const markedBorderEnemies = aiKnownEnemies(room, 1).filter(e => e.marked &&
          (e.col === bounds.min || e.col === bounds.max || e.row === bounds.min || e.row === bounds.max)
        ).length;
        if (markedBorderEnemies >= 1 || borderScore >= 12) {
          aiExecSkill(room, pidx, 'sulfurRiver');
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
      if (piece.type === 'twins_elder' || piece.type === 'twins_younger') {
        // 분신: 사용자 요청 — 의미있는 합류만. 이미 같은 칸이거나 의미없는 random 차단.
        const elder = aiPlayer.pieces.find(p => p.subUnit === 'elder' && p.alive);
        const younger = aiPlayer.pieces.find(p => p.subUnit === 'younger' && p.alive);
        const alreadyMerged = elder && younger && elder.col === younger.col && elder.row === younger.row;
        // 약한 쪽 HP ≤ 1 + 분리 상태 + 가까이 갈 만한 거리 (맨해튼 ≤ 3)
        const dist = (elder && younger) ? Math.abs(elder.col - younger.col) + Math.abs(elder.row - younger.row) : 99;
        if (elder && younger && !alreadyMerged && Math.min(elder.hp, younger.hp) <= 1 && dist <= 3) {
          // 약한 쪽이 강한 쪽 위치로 합류
          const moverSub = elder.hp < younger.hp ? 'elder' : 'younger';
          aiExecSkill(room, pidx, 'brothers', { target: moverSub });
          aiPlayer.actionDone = true;
          aiEndTurn(room);
          return;
        }
      }
    }
  }

  // ★ STEP 4: 일반 공격 vs 이동 판단
  // #5: 쌍검무 활성화 유닛이 있으면 "공격만" 허용 — 이동 고려 안 함
  const dualPiece = alivePieces.find(p => p.dualBladeAttacksLeft > 0);
  let bestAction = null;

  if (dualPiece) {
    // 쌍검무 활성 — 해당 양손검객이 반드시 공격해야 함
    const pieceIdx = aiPlayer.pieces.indexOf(dualPiece);
    let extra = {};
    if (dualPiece.toggleState) extra.toggleState = dualPiece.toggleState;
    const atkScore = aiScoreAttack(brain, dualPiece, room, extra);
    bestAction = { type: 'attack', piece: dualPiece, pieceIdx, score: atkScore, extra };
  } else {
    for (const piece of alivePieces) {
      const pieceIdx = aiPlayer.pieces.indexOf(piece);
      let extra = {};
      if (piece.type === 'ratMerchant') extra.rats = room.rats[1];
      if (piece.toggleState) extra.toggleState = piece.toggleState;

      // Attack score
      let atkExtra = { ...extra };
      if (piece.type === 'shadowAssassin' || piece.type === 'witch') {
        const bt = aiBestTargetCell(brain, piece, room);
        atkExtra.tCol = bt.col;
        atkExtra.tRow = bt.row;
      }
      const atkScore = aiScoreAttack(brain, piece, room, atkExtra);
      if (!bestAction || atkScore > bestAction.score) {
        bestAction = { type: 'attack', piece, pieceIdx, score: atkScore, extra: atkExtra };
      }

      // Move score (일반 이동 — 도망이 아닌 전략적 이동)
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nc = piece.col + dc, nr = piece.row + dr;
        if (!inBounds(nc, nr, bounds)) continue;
        // ★ 사용자 보고 (룰): 아군 유닛이 있는 칸으로 이동 금지 (쌍둥이 합류 제외).
        if (!_canMoveTo(room, piece, nc, nr)) continue;
        const moveScore = aiScoreMove(brain, piece, nc, nr, room) * 0.7;
        if (!bestAction || moveScore > bestAction.score) {
          bestAction = { type: 'move', piece, pieceIdx, score: moveScore, col: nc, row: nr };
        }
      }
    }
  }

  if (!bestAction) {
    aiPlayer.actionDone = true;
    aiEndTurn(room);
    return;
  }

  if (bestAction.type === 'move') {
    aiExecuteMove(room, bestAction);
  } else {
    aiExecuteAttack(room, bestAction);
  }
}

function aiExecuteMove(room, action) {
  const aiPlayer = room.players[1];
  const piece = action.piece;
  const prevCol = piece.col, prevRow = piece.row;

  piece.col = action.col;
  piece.row = action.row;

  // Check trap — ★ 그림자 숨기 면역: 트랩 자체가 발동하지 않음 (제거도 X, 그대로 남음).
  // ★ 사용자 요청: 이동 → 트랩 순차 처리. 이동 emit 먼저, 700ms 후 트랩 효과/emit.
  const trapIdx = room.boardObjects[0].findIndex(o => o.type === 'trap' && o.col === action.col && o.row === action.row);
  const isShadowedAI = piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow');
  let aiTrapPending = null;
  if (trapIdx >= 0 && !isShadowedAI) {
    aiTrapPending = { trapIdx, col: action.col, row: action.row };
  }

  emitToPlayer(room, 0, 'opp_moved', { msg: `${room.players[1].name}${조사(room.players[1].name, '이', '가')} 이동했습니다.`, prevCol, prevRow, col: action.col, row: action.row });
  emitToSpectators(room, 'spectator_log', { msg: `${piece.name} 이동`, type: 'move', playerIdx: 1 });
  // ★ FIX (관전자 이동 모션): 1v1 AI 이동 — spectator_update 전에 슬라이드 애니용 좌표 전송.
  emitToSpectators(room, 'spectator_move_anim', { prevCol, prevRow, col: action.col, row: action.row, pieceType: piece.type, pieceSubUnit: piece.subUnit || null, owner: 1 });
  if (!aiTrapPending) emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  aiTrackToast(room, 'move');
  aiPlayer.actionDone = true;

  if (aiTrapPending) {
    // 이동 애니가 끝난 후 트랩 처리. AI 턴 종료도 그 후에.
    room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, Date.now() + 1500);
    const tp = aiTrapPending;
    setTimeout(() => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      const trapArr = room.boardObjects[0] || [];
      const ti = trapArr.findIndex(o => o.type === 'trap' && o.col === tp.col && o.row === tp.row);
      if (ti < 0) { aiEndTurn(room); return; }
      trapArr.splice(ti, 1);
      const aiPiece = (room.players[1].pieces || []).find(p => p.alive && p.col === tp.col && p.row === tp.row);
      if (!aiPiece) { aiEndTurn(room); return; }
      // ★ 패시브 dedupe Set 초기화.
      room._attackPassivesFired = new Set();
      room._pendingBodyguardPassive = null;
      const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: tp.col, row: tp.row }, aiPiece, 0, 2, false);
      aiPiece.hp = Math.max(0, aiPiece.hp - dmg);
      if (aiPiece.type === 'wizard' && dmg > 0) {
        const wizSpSlot = (room.mode === 'team') ? getTeamOf(room, 1) : 1;
        room.instantSp[wizSpSlot] += 1;
        emitSPUpdate(room);
        emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: 1, msg: `인스턴트 매직 : SP 획득` });
        emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: 1 });
      }
      const willDie3 = aiPiece.hp <= 0;
      if (willDie3) {
        handleDeath(room, aiPiece, 1);
        setKillInfo(room, 'trap', null, [{ name: aiPiece.name }]);
      }
      emitToBoth(room, 'trap_triggered', {
        col: tp.col, row: tp.row,
        pieceInfo: { type: aiPiece.type, name: aiPiece.name, icon: aiPiece.icon },
        damage: dmg,
        destroyed: willDie3,
        newHp: aiPiece.hp,
        victimOwnerIdx: 1,
        trapOwnerIdx: 0,  // 1v1 AI 가 인간(0)의 덫을 밟음
      });
      emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
      aiEndTurn(room);
    }, 700);
  } else {
    aiEndTurn(room);
  }
}

function aiExecuteAttack(room, action) {
  const aiPlayer = room.players[1];
  const humanPlayer = room.players[0];
  const brain = room.aiBrain;
  const piece = action.piece;
  const bounds = room.boardBounds;

  // ★ 사망 기폭 페이즈 시작 — 학살영웅 등으로 화약상이 죽으면 큐에 push.
  startPhase(room);

  const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds, action.extra);
  const hitResults = processAttack(room, 1, piece, atkCells, undefined, { suppressSpUpdate: true });

  aiProcessAttackResult(brain, atkCells, hitResults, piece);
  // ★ 자동조작(서버 AI 오토파일럿) — 인간(0) 팀 브레인이 AI 공격을 관측해 적(AI) 위치 역추론.
  //   1v1 AI연습에서 내 팀(0)엔 AI 멤버가 없어 getTeamBrain(0) 이 평소 학습되지 않으므로 여기서 보강.
  aiObserveEnemyAttack(getTeamBrain(room, getTeamOf(room, 0)), room, room.players[0].pieces, room.players[1].pieces, atkCells, hitResults);

  // ★ 학살영웅 등 임팩트 발생 시 빗나감 토스트 X (사용자 요청). 적쥐 격파는 hitResults 후처리에 포함.
  const _atkOwnRats = (room._attackerOwnRatsDestroyedCount || 0);
  const _atkFf = (room._attackerFriendlyFireCount || 0);
  emitToPlayer(room, 0, 'being_attacked', {
    atkCells,
    attackerImpactedAnything: hitResults.length > 0 || _atkOwnRats > 0 || _atkFf > 0,
    hitPieces: hitResults.map(h => {
      // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
      const dp = (typeof h.defPieceIdx === 'number') ? humanPlayer.pieces[h.defPieceIdx] : null;
      return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
        name: dp?.name, icon: dp?.icon, defPieceIdx: h.defPieceIdx,
        redirectedToBodyguard: h.redirectedToBodyguard || false,
        bodyguardRedirect: h.bodyguardRedirect || false };
    }),
    yourPieces: pieceSummary(humanPlayer.pieces),
  });
  // ★ FIX (표식 적 공격 모션 누락 — 1v1 AI 경로): AI 의 *표식된* 말이 공격하면 표식 부여자에게
  //   공격 캐릭터 모션 전송(인간 attack 핸들러 10160-10176, 팀 AI 2521 과 동일 패턴). 이게 없어
  //   1v1 에서 AI 표식 유닛 공격 시 marked_enemy_attack 이 안 와 공격 GIF 가 안 떴음.
  {
    const _markEffect = (piece.statusEffects || []).find(e => e.type === 'mark');
    if (_markEffect && typeof _markEffect.source === 'number') {
      const _v = room.players[_markEffect.source];
      if (_v && _v.socketId && _v.socketId !== 'AI') {
        io.to(_v.socketId).emit('marked_enemy_attack', {
          atkCells,
          hitCells: hitResults.map(h => ({ col: h.col, row: h.row, damage: h.damage, destroyed: h.destroyed })),
          attacker: markedAttackerMotion(piece, aiPlayer.pieces),
        });
      }
    }
  }
  room._attackerFriendlyFireCount = 0;
  room._attackerOwnRatsDestroyedCount = 0;
  room._friendlyFireHits = [];
  // ★ 관전자 일반 공격 애니 (1v1 AI 공격) — defOwnerIdx 0 (인간 = p0)
  emitToSpectators(room, 'spectator_attack_anim', {
    atkCells,
    atkCol: piece.col, atkRow: piece.row, atkType: piece.type, atkSubUnit: piece.subUnit || null,  // ★ 관전자 공격 모션
    hits: hitResults.map(h => ({
      col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
      defPieceIdx: h.defPieceIdx, defOwnerIdx: 0,
      redirectedToBodyguard: h.redirectedToBodyguard || false,
      bodyguardRedirect: h.bodyguardRedirect || false,
    })),
  });
  // 관전자에게 공격 결과 전송
  if (hitResults.length > 0) {
    for (const h of hitResults) {
      const dp = humanPlayer.pieces.find(p => p.col === h.col && p.row === h.row);
      const targetName = dp ? `${dp.name}` : coord(h.col,h.row);
      emitToSpectators(room, 'spectator_log', { msg: h.destroyed
        ? `⚔ AI의 ${piece.name}! ${targetName} 격파함 💀`
        : `⚔ AI의 ${piece.name}! ${targetName}에 ${h.damage} 피해`, type: 'hit', playerIdx: 1 });
    }
  } else {
    emitToSpectators(room, 'spectator_log', { msg: `AI 공격 빗나감`, type: 'miss', playerIdx: 1 });
  }
  emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

  aiTrackToast(room, 'attack');

  // ★ 공격 처리 완료 — suppressed SP 업데이트 emit
  emitSPUpdate(room);

  // ★ 게임종료 검사 — 사망 기폭 페이즈가 deferred 면 callback 으로 지연.
  //   simultaneous_draw 케이스도 checkGameEndAfterPhase 가 처리.
  //   dualBlade 후속 공격은 setTimeout(4000ms) 라 페이즈 끝난 뒤 실행됨 (room.phase 자체 체크).
  flushPhase(room, () => {
    if (rooms[room.id] && room.phase === 'game') {
      checkGameEndAfterPhase(room);
    }
  });

  // ★ 공격 후 dualBlade 추가 공격 (4초 대기 — 클라이언트 애니메이션 + 인지 시간 포함)
  if (piece.dualBladeAttacksLeft > 0) {
    const DUAL_BLADE_DELAY = 4000;
    setTimeout(() => {
      if (room.phase !== 'game') return;
      if (!piece.alive) { aiPlayer.actionDone = true; aiEndTurn(room); return; }
      piece.dualBladeAttacksLeft--;
      const extraCells = getAttackCells(piece.type, piece.col, piece.row, bounds);
      const extraHits = processAttack(room, 1, piece, extraCells);
      aiProcessAttackResult(brain, extraCells, extraHits, piece);
      // ★ 자동조작 — 인간(0) 팀 브레인이 AI 쌍검무 2타도 관측해 적 위치 역추론.
      aiObserveEnemyAttack(getTeamBrain(room, getTeamOf(room, 0)), room, room.players[0].pieces, room.players[1].pieces, extraCells, extraHits);
      emitToPlayer(room, 0, 'being_attacked', {
        atkCells: extraCells,
        hitPieces: extraHits.map(h => {
          const dp = (typeof h.defPieceIdx === 'number') ? humanPlayer.pieces[h.defPieceIdx] : null;
          return { col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            name: dp?.name, icon: dp?.icon, defPieceIdx: h.defPieceIdx,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false };
        }),
        yourPieces: pieceSummary(humanPlayer.pieces),
      });
      // ★ 관전자 — 쌍검무 두 번째 공격 (1v1 AI). defOwnerIdx 0
      emitToSpectators(room, 'spectator_attack_anim', {
        atkCells: extraCells,
        atkCol: piece.col, atkRow: piece.row, atkType: piece.type, atkSubUnit: piece.subUnit || null,  // ★ 관전자 공격 모션
        hits: extraHits.map(h => ({
          col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
          defPieceIdx: h.defPieceIdx, defOwnerIdx: 0,
          redirectedToBodyguard: h.redirectedToBodyguard || false,
          bodyguardRedirect: h.bodyguardRedirect || false,
        })),
      });
      if (hitResults.length > 0 || extraHits.length > 0) {
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
      }
      if (checkWin(room, 0)) { endGame(room, 1); return; }
      aiPlayer.actionDone = true;
      aiEndTurn(room);
    }, DUAL_BLADE_DELAY);
    return;  // setTimeout 콜백에서 턴 종료 처리
  }

  aiPlayer.actionDone = true;
  aiEndTurn(room);
}

// ══════════════════════════════════════════════════════════════════
// ── Socket Events ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {

  // 소켓 이벤트 안전 래퍼 (에러 시 서버 크래시 방지)
  const _on = socket.on.bind(socket);
  socket.on = (event, handler) => {
    _on(event, (...args) => {
      try { handler(...args); }
      catch (err) { console.error(`[Socket Error] ${event}:`, err.message, err.stack); }
    });
  };

  // ── 로그인 인증 (구글/Supabase) ──
  //   클라가 access_token(JWT)을 보내면 검증해 socket.data.user 에 계정을 바인딩.
  //   service_role 미설정 시 verifyJwt→null → 게스트로 남음(안전, 게임은 정상).
  socket.on('auth_login', async ({ token } = {}) => {
    const user = await supa.verifyJwt(token);
    if (user) {
      const m = user.user_metadata || {};
      socket.data.user = {
        id: user.id,
        email: user.email || '',
        name: m.name || m.full_name || (user.email ? user.email.split('@')[0] : ''),
      };
      console.log('[auth] 로그인:', socket.data.user.name || socket.data.user.email, '·', user.id);
      socket.emit('auth_ok', { userId: user.id, name: socket.data.user.name });
    } else {
      socket.data.user = null;
      socket.emit('auth_guest', { reason: supa.enabled() ? 'invalid_token' : 'server_no_keys' });
    }
  });
  socket.on('auth_logout', () => { socket.data.user = null; });

  // ── 계정 데이터 로드 (로그인 직후) ──
  socket.on('account_load', async () => {
    if (!socket.data.user) { socket.emit('account_data', { ok: false }); return; }
    const account = await accountData.loadAccount(socket.data.user.id);
    socket.emit('account_data', { ok: true, account });
  });
  // ── 계정 데이터 저장 (덱/닉네임/설정 변경, 게스트 흡수) ──
  socket.on('account_save', async (payload) => {
    if (!socket.data.user || !payload) return;
    await accountData.saveAccount(socket.data.user.id, payload);
  });

  // ── 캐릭터 데이터 요청 (덱빌더용) ──
  socket.on('request_characters', () => {
    // ★ FIX (덱빌더/딕셔너리/추천/랜덤 전부 빈 화면): 재접속 경로(아래)는 characters_data 를
    //   래핑 없이 CHARACTERS 로 보내는데 여기서만 { characters: CHARACTERS } 로 래핑해 불일치였다.
    //   전역 핸들러가 S.characters = payload 로 받으면 S.characters[1/2/3] 가 undefined → 전부 빈 화면.
    //   → 래핑 제거로 통일.
    socket.emit('characters_data', CHARACTERS);
  });

  // ── #9: 재접속 (새로고침/연결 끊김 복구) ──
  // 새로고침 = 현재 페이즈 복원 (로비 이동 아님). 각 단계별로 해당 페이즈의 phase 이벤트 재전송.
  socket.on('reconnect_game', ({ roomId, sessionToken }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('reconnect_failed', { reason: 'room_not_found' }); return; }
    const player = room.players.find(p => p.sessionToken === sessionToken);
    if (!player) { socket.emit('reconnect_failed', { reason: 'token_mismatch' }); return; }
    if (room.phase === 'ended') { socket.emit('reconnect_failed', { reason: 'game_ended' }); return; }
    // 유예 타이머 취소 (게임 중 + 대기 중 둘 다)
    if (player._disconnectTimer) {
      clearTimeout(player._disconnectTimer);
      player._disconnectTimer = null;
    }
    if (player._waitDisconnectTimer) {
      clearTimeout(player._waitDisconnectTimer);
      player._waitDisconnectTimer = null;
    }
    // 소켓 재할당
    player.socketId = socket.id;
    socket.data.roomId = roomId;
    socket.data.idx = player.index;
    socket.data.sessionToken = sessionToken;
    socket.join(roomId);

    const idx = player.index;
    const phase = room.phase;

    // ★ S-10: 재접속 중 동시 이벤트 방지 — 상태 전송 완료까지 brief lock
    player._reconnecting = true;
    try {

    // ★ FIX: 재접속(새로고침) 시 클라 캐릭터 DB(S.characters) 가 비어 findLocalChar 가 모두 '?' 반환 →
    //   초기공개/교환/최종공개/HP 등 세팅 화면이 전부 깨짐. phase 이벤트보다 먼저 DB 전송(순서 보장).
    socket.emit('characters_data', CHARACTERS);

    // ★ FIX: 재접속 시 현재 페이즈 타이머 재전송 (게임뿐 아니라 HP/드래프트/배치 등 세팅 페이즈도).
    //   기존엔 game 페이즈에서만 재전송 → 세팅 중 새로고침 시 타이머가 사라져 보이지 않던 문제.
    if (room.timerDeadline) {
      const _remainSec = Math.ceil(Math.max(0, room.timerDeadline - Date.now()) / 1000);
      if (_remainSec > 0) socket.emit('timer_start', { seconds: _remainSec, phase: room.phase, reconnected: true });
    }

    // ── 페이즈별 상태 재전송 ──
    if (phase === 'game') {
      if (room.mode === 'team') {
        const state = getTeamGameStateFor(room, idx);
        socket.emit('team_game_start', { ...state, teams: room.teams, reconnected: true });
      } else {
        const opp = room.players[1 - idx];
        socket.emit('game_start', {
          // ★ 재접속 시 클라이언트가 새로고침으로 잃어버린 신원 복원 (playerIdx/상대 이름).
          //   playerIdx 가 없으면 facing 키·피격자 판정·보드 방향이 깨짐.
          playerIdx: idx,
          opponentName: opp.name,
          yourPieces: pieceSummary(player.pieces),
          oppPieces: oppPieceSummary(opp.pieces),
          currentPlayerIdx: room.currentPlayerIdx,
          turnNumber: room.turnNumber,
          isYourTurn: room.currentPlayerIdx === idx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillPoints: room.sp,
          boardBounds: room.boardBounds,
          boardObjects: boardObjectsSummary(room, idx),
          remains: room.remains || [],
          // ★ 재접속 시 이번 턴 행동 소진 상태 복원 (이미 행동했는데 새로고침하면 다시 가능해 보이던 버그).
          actionDone: !!player.actionDone,
          actionUsedSkillReplace: !!player.actionUsedSkillReplace,
          skillsUsed: player.skillsUsedBeforeAction || [],
          lastActionPieceType: player._lastActionPieceType || null,
          lastActionType: player._lastActionType || null,
          reconnected: true,
        });
      }
      // (타이머 재전송은 위 페이즈 공통 블록에서 처리)
      // ★ 재접속 시 보드 축소 경고(카운트다운) 재전송 — 다음 축소 예정 경고가 활성이면 복원.
      try {
        const _sched = getBoardShrinkSchedule(room);
        for (const ev of _sched) {
          if (room.boardShrinkStage >= ev.stage) continue;
          if (room.turnNumber >= ev.warnTurn && room.turnNumber < ev.shrinkTurn) {
            const remaining = ev.shrinkTurn - room.turnNumber;
            if (remaining > 0) {
              socket.emit('board_shrink_warning', {
                turnsRemaining: remaining, turnsLeft: remaining,
                stage: ev.stage, key: ev.key, stalemate: !!ev.stalemate, reconnected: true,
              });
            }
            break;
          }
        }
      } catch (e) {}
    } else if (phase === 'waiting') {
      if (room.mode === 'team') {
        // team_joined 먼저 — 클라가 (전체 새로고침이었더라도) 팀 대기 화면으로 복귀.
        socket.emit('team_joined', { idx, roomId, playerName: player.name, sessionToken, reconnected: true });
        socket.emit('team_room_state', { players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId })), teams: room.teams });
      } else {
        socket.emit('joined', { idx, roomId, characters: CHARACTERS, sessionToken, reconnected: true });
      }
    } else if (phase === 'team_draft') {
      socket.emit('team_draft_start', {
        myIdx: idx, teamId: player.teamId,
        players: room.players.map(pl => ({ name: pl.name, idx: pl.index, teamId: pl.teamId })),
        teams: room.teams, characters: CHARACTERS,
      });
      // 이미 골랐던 픽 복원
      if (player.draft) {
        socket.emit('team_draft_pick_update', { idx, draft: player.draft });
      }
    } else if (phase === 'team_hp') {
      if (room.hpDone[idx]) {
        // ★ FIX #7: 이미 HP 분배 완료한 플레이어 재접속 — HP UI 재전송 금지 (silent reject 무한 대기 방지)
        socket.emit('wait_msg', { msg: '다른 플레이어의 HP 분배를 기다리는 중...' });
      } else {
        const teammates = getTeammates(room, idx);
        const teammateDraft = teammates[0] != null ? room.players[teammates[0]].draft : null;
        const hasTwins = player.draft?.pick1 === 'twins' || player.draft?.pick2 === 'twins';
        // ★ FIX #7: 쌍둥이 분리 단계 중 재접속 — twin_split_needed 재전송으로 해당 단계 복원
        if (hasTwins && player.hpDist && !player.twinSplitDone) {
          const twinSlot = player.draft.pick1 === 'twins' ? 'pick1' : 'pick2';
          socket.emit('twin_split_needed', { twinTierHp: player.hpDist[twinSlot] });
        } else {
          socket.emit('team_hp_phase', {
            draft: player.draft,
            hasTwins,
            teammateDraft,
          });
        }
      }
    } else if (phase === 'team_reveal') {
      const allPlayerPieces = room.players.map(p => ({
        idx: p.index, name: p.name, teamId: p.teamId,
        pieces: p.pieces.map(pc => ({
          type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
          hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag, desc: pc.desc,
          subUnit: pc.subUnit, hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
          passiveName: pc.passiveName, passives: pc.passives,
        })),
      }));
      socket.emit('team_reveal_phase', { myIdx: idx, teamId: player.teamId, teams: room.teams, allPlayerPieces });
    } else if (phase === 'team_placement') {
      const oppTeamId = 1 - player.teamId;
      const opponents = (room.teams[oppTeamId] || []).map(i => ({
        idx: i, name: room.players[i].name,
        pieces: room.players[i].pieces.map(pc => ({
          type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
          hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag, desc: pc.desc, subUnit: pc.subUnit,
          hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
          passiveName: pc.passiveName, passives: pc.passives,
        })),
      }));
      socket.emit('team_placement_phase', {
        myIdx: idx, teamId: player.teamId, teams: room.teams,
        boardBounds: room.boardBounds, zone: getTeamPlacementZone(player.teamId),
        myPieces: pieceSummary(player.pieces),
        teammates: getTeammates(room, idx).map(i => ({ idx: i, name: room.players[i].name, pieces: pieceSummary(room.players[i].pieces) })),
        opponents,
      });
      // ★ 이미 배치 확정한 경우 — 대기 중임을 알려 재클릭 혼란 방지
      if (room.placementDone[idx]) {
        socket.emit('wait_msg', { msg: '배치 완료. 다른 플레이어를 기다리는 중...' });
      }
    } else if (phase === 'initial_reveal') {
      const oppDraft = room.players[1 - idx].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      socket.emit('initial_reveal_phase', { myDraft: player.draft, oppChars, alreadyDecided: !!room.initialRevealDone[idx] });
    } else if (phase === 'exchange_draft') {
      const available = {};
      for (const tier of [1, 2, 3]) {
        const myType = tier === 1 ? player.draft.t1 : tier === 2 ? player.draft.t2 : player.draft.t3;
        available[tier] = CHARACTERS[tier]
          .filter(c => c.type !== myType)
          .map(c => ({ type: c.type, name: c.name, icon: c.icon, desc: c.desc, tag: c.tag, atk: c.atk, range: c.range }));
      }
      socket.emit('exchange_draft_phase', {
        myDraft: player.draft, available, oppDraft: room.players[1 - idx].draft,
        alreadyExchanged: !!room.exchangeDone[idx],
      });
      // ★ 재접속 시 이미 확정한 경우 — 대기 중임을 알려 클라가 다시 확인 버튼을 클릭하는 혼란 방지
      if (room.exchangeDone[idx]) {
        const remainingMs = Math.max(0, (room.timerDeadline || 0) - Date.now());
        socket.emit('wait_msg', { msg: '교환 결정 완료. 상대를 기다리는 중...', remainingMs });
      }
    } else if (phase === 'final_reveal') {
      const oppDraft = room.players[1 - idx].draft;
      const oppChars = [
        { ...findCharData(oppDraft.t1, 1), tier: 1 },
        { ...findCharData(oppDraft.t2, 2), tier: 2 },
        { ...findCharData(oppDraft.t3, 3), tier: 3 },
      ];
      socket.emit('final_reveal_phase', { myDraft: player.draft, oppChars, reconnected: true });
    } else if (phase === 'hp_distribution') {
      socket.emit('hp_phase', { draft: player.draft, hasTwins: player.draft.t1 === 'twins', hpDist: player.hpDist || null });
    } else if (phase === 'reveal') {
      const oppPieces = room.players[1 - idx].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      socket.emit('reveal_phase', { yourPieces: pieceSummary(player.pieces), oppPieces });
    } else if (phase === 'placement') {
      const oppPieces = room.players[1 - idx].pieces.map(pc => ({
        type: pc.type, name: pc.name, icon: pc.icon, tier: pc.tier,
        hp: pc.hp, maxHp: pc.maxHp, atk: pc.atk, tag: pc.tag,
        desc: pc.desc, subUnit: pc.subUnit,
        hasSkill: pc.hasSkill, skillName: pc.skillName, skillCost: pc.skillCost,
        passiveName: pc.passiveName, passives: pc.passives,
      }));
      socket.emit('placement_phase', { pieces: pieceSummary(player.pieces), oppPieces, alreadyConfirmed: !!room.placementDone[idx] });
    } else {
      // 그 외(드래프트 단일 단계 등) — 기본 resume 이벤트만
      socket.emit('reconnect_phase_resume', { phase, idx });
    }
    socket.emit('reconnect_ok', { idx, phase });
    } catch (e) {
      console.error('[reconnect_game]', e && e.message);
      try { socket.emit('reconnect_failed', { reason: 'internal_error' }); } catch (_) {}
    } finally {
      // ★ FIX (영구 프리징 방지): 재접속 처리 중 예외가 나도 _reconnecting 을 반드시 해제.
      //   안 하면 이후 move/attack/skill/end_turn 이 '재접속 처리 중'으로 영구 차단됨(워치독 없음).
      player._reconnecting = false;
    }
  });

  // ── 방 입장 ──
  socket.on('join_room', ({ roomId, playerName, deck, asSpectator }) => {
    // ★ 방 코드 정규화 — 대소문자/공백 차이로 같은 코드가 다른 방으로 갈리던 문제 방지.
    //   (특히 iPad 등 모바일 키보드 자동 대문자화 때문에 'abc'→'Abc' 로 변형되어 별개 방 생성)
    roomId = (typeof roomId === 'string') ? roomId.trim().toUpperCase() : '';
    if (!roomId) { socket.emit('err', { msg: '방 코드가 올바르지 않습니다.' }); return; }
    if (rooms[roomId] && rooms[roomId].phase === 'ended') {
      delete rooms[roomId];
    }
    // ★ 관전 의도(asSpectator)로 들어왔는데 아직 시작 안 한 방이면 — 플레이어로 앉히거나
    //   팀 로비로 리다이렉트하지 않고 명확히 거부. (관전 클릭이 게임을 꼬이게 만들던 원인)
    if (asSpectator && (!rooms[roomId] || rooms[roomId].phase === 'waiting')) {
      socket.emit('spectate_unavailable', { msg: '아직 시작되지 않은 방입니다. 관전할 수 없습니다.' });
      return;
    }
    const _existed = !!rooms[roomId];
    if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    console.log(`[JOIN] pid=${process.pid} sock=${socket.id} code="${roomId}" name="${playerName}" existed=${_existed} mode=${room.mode} phase=${room.phase} players=${room.players.length} spectator=${!!asSpectator}`);

    // 이 방이 팀전 방이면 join_team_room 흐름으로 자동 전환 — 게임 진행 중/만석은 관전자
    if (room.mode === 'team') {
      const teamFull = room.players.length >= 4;
      const teamInProgress = room.phase !== 'waiting';
      if (teamInProgress || teamFull) {
        // 관전자로 입장
        room.spectators = room.spectators || [];
        room.spectators.push({ socketId: socket.id, name: playerName });
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.isSpectator = true;
        socket.emit('team_spectator_joined', {
          roomId,
          phase: room.phase,
          gameState: room.phase === 'game' ? getTeamSpectatorGameState(room) : null,
          characters: CHARACTERS,
          players: room.players.map(p => ({ idx: p.index, name: p.name, teamId: p.teamId })),
          teams: room.teams,
        });
        return;
      }
      socket.emit('team_room_redirect', { roomId, playerName });
      return;
    }

    if (room.players.length >= 2 || room.phase !== 'waiting') {
      // 관전자로 입장
      room.spectators = room.spectators || [];
      room.spectators.push({ socketId: socket.id, name: playerName });
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.isSpectator = true;
      // 현재 페이즈별 스냅샷 전달
      let draftState = null, hpState = null, placementState = null;
      // ★ 페이즈 문자열 정정: 실제 페이즈는 'hp_distribution' (이전엔 'hp' 오타로 매칭 실패 → 관전 입장 시 빈 화면).
      //   초기/교환/최종 공개(initial_reveal/exchange_draft/final_reveal) 구간에도 드래프트 정보 제공.
      const _revealPhases = ['initial_reveal', 'exchange_draft', 'final_reveal', 'reveal'];
      const _postDraft = room.phase === 'hp_distribution' || _revealPhases.includes(room.phase)
        || room.phase === 'placement' || room.phase === 'game';
      if (room.phase === 'draft' || _postDraft) {
        draftState = {
          p0: room.players[0]?.draft || null,
          p1: room.players[1]?.draft || null,
          draftDone: [...(room.draftDone || [false, false])],
        };
      }
      if (_postDraft) {
        hpState = {
          p0Pieces: room.players[0]?.pieces ? pieceSummary(room.players[0].pieces) : [],
          p1Pieces: room.players[1]?.pieces ? pieceSummary(room.players[1].pieces) : [],
          hpDone: [...(room.hpDone || [false, false])],
        };
      }
      if (room.phase === 'placement') {
        placementState = {
          p0Pieces: pieceSummary(room.players[0].pieces),
          p1Pieces: pieceSummary(room.players[1].pieces),
          boardBounds: room.boardBounds,
        };
      }
      socket.emit('spectator_joined', {
        roomId,
        phase: room.phase,
        gameState: room.phase === 'game' ? getSpectatorGameState(room) : null,
        draftState,
        hpState,
        placementState,
        characters: CHARACTERS,
        p0Name: room.players[0]?.name || '?',
        p1Name: room.players[1]?.name || '?',
      });
      return;
    }

    const idx = room.players.length;
    const playerDraft = validateDeck(deck);
    const deckName = (deck && typeof deck.deckName === 'string') ? deck.deckName.slice(0, 16) : '';
    const sessionToken = genSessionToken();
    room.players.push({
      socketId: socket.id, name: playerName, index: idx,
      pieces: [], draft: playerDraft, hpDist: null,
      deckName,  // 캐릭터 공개 등에서 닉네임 아래 표시용
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      sessionToken,  // #9: 재접속용
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = idx;
    socket.data.sessionToken = sessionToken;
    room.draftDone[idx] = true;

    socket.emit('joined', { idx, roomId, playerName, characters: CHARACTERS, sessionToken });

    if (room.players.length === 2) {
      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('opponent_joined', { opponentName: room.players[1 - i].name });
      });
      // 드래프트 건너뛰기 → 바로 초기 공개
      transitionToInitialReveal(room);
    } else {
      socket.emit('waiting', {});
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ── 팀전 (2v2) 대기실 ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  socket.on('join_team_room', ({ roomId, playerName }) => {
    // ★ 방 코드 정규화 (join_room 과 동일) — 대소문자/공백 차이로 다른 방이 되는 문제 방지.
    roomId = (typeof roomId === 'string') ? roomId.trim().toUpperCase() : '';
    if (!roomId) { socket.emit('err', { msg: '방 코드가 올바르지 않습니다.' }); return; }
    if (rooms[roomId] && rooms[roomId].phase === 'ended') {
      delete rooms[roomId];
    }
    const _existedT = !!rooms[roomId];
    if (!rooms[roomId]) {
      rooms[roomId] = createRoom(roomId, { mode: 'team' });
    }
    const room = rooms[roomId];
    console.log(`[JOIN_TEAM] pid=${process.pid} sock=${socket.id} code="${roomId}" name="${playerName}" existed=${_existedT} phase=${room.phase} players=${room.players.length}`);
    if (room.mode !== 'team') {
      socket.emit('err', { msg: '이미 1대1 전용 방입니다.' });
      return;
    }
    if (room.phase !== 'waiting') {
      socket.emit('err', { msg: '이미 게임이 시작된 방입니다.' });
      return;
    }
    // 방이 꽉 찼는데 AI 봇이 있으면 — 사람이 자리를 가져갈 수 있도록 봇 하나 자동 퇴장
    if (room.players.length >= 4) {
      const botIdx = room.players.findIndex(p => p.socketId === 'AI');
      if (botIdx >= 0) {
        // 봇 제거 + 팀/인덱스 재정렬
        room.players.splice(botIdx, 1);
        for (let t = 0; t < 2; t++) {
          room.teams[t] = room.teams[t].filter(i => i !== botIdx).map(i => i > botIdx ? i - 1 : i);
        }
        room.players.forEach((p, i) => { p.index = i; });
      } else {
        socket.emit('err', { msg: '방이 가득 찼습니다. 4/4' });
        return;
      }
    }
    const idx = room.players.length;
    const sessionToken = genSessionToken();
    room.players.push({
      socketId: socket.id, name: playerName, index: idx,
      pieces: [], draft: null, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: null,  // 배정 후 채워짐
      sessionToken,  // #9: 재접속용
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = idx;
    socket.data.sessionToken = sessionToken;
    socket.data.isTeamMode = true;

    // 팀 자동 배정 — A팀이 덜 찼으면 A, 아니면 B. 자리는 첫 빈 슬롯.
    const teamACount = room.teams[0].length;
    const teamBCount = room.teams[1].length;
    const targetTeam = teamACount <= teamBCount ? 0 : 1;
    const usedPos = new Set(room.teams[targetTeam].map(i => room.players[i]?.slotPos));
    const slotPos = !usedPos.has(0) ? 0 : (!usedPos.has(1) ? 1 : 0);
    room.teams[targetTeam].push(idx);
    room.players[idx].teamId = targetTeam;
    room.players[idx].slotPos = slotPos;

    socket.emit('team_joined', { idx, roomId, playerName, sessionToken });
    broadcastTeamRoomState(room);
  });

  // 팀 변경 요청 — targetPos가 비어있으면 그 자리로, 아니면 거절
  socket.on('team_change', ({ targetTeam, targetPos }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    const idx = socket.data.idx;
    if (idx === undefined) return;
    if (targetTeam !== 0 && targetTeam !== 1) return;
    const wantPos = (targetPos === 0 || targetPos === 1) ? targetPos : null;
    // 같은 팀 내 같은 자리면 무시
    if (room.players[idx].teamId === targetTeam && room.players[idx].slotPos === wantPos) return;
    // 현재 팀에서 제거
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== idx);
    }
    // 가용 자리 검사
    const occupiedSlots = new Set(room.teams[targetTeam].map(i => room.players[i]?.slotPos));
    let assignedPos = wantPos;
    if (assignedPos == null || occupiedSlots.has(assignedPos)) {
      // wantPos가 비지 않았거나 미지정 → 첫 빈 자리 할당
      assignedPos = !occupiedSlots.has(0) ? 0 : (!occupiedSlots.has(1) ? 1 : null);
    }
    if (assignedPos == null) {
      // 양 자리 다 차있음 → 원복
      const original = room.players[idx].teamId;
      room.teams[original].push(idx);
      socket.emit('err', { msg: '해당 팀이 이미 가득 찼습니다.' });
      broadcastTeamRoomState(room);
      return;
    }
    room.teams[targetTeam].push(idx);
    room.players[idx].teamId = targetTeam;
    room.players[idx].slotPos = assignedPos;
    broadcastTeamRoomState(room);
  });

  // AI 봇 추가 — 빈 슬롯에 AI 플레이어 삽입 (혼자/소수 인원으로 4인 팀전 즐길 수 있게)
  socket.on('team_add_bot', ({ targetTeam, targetPos } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (room.players.length >= 4) {
      socket.emit('err', { msg: '방이 가득 찼습니다.' });
      return;
    }
    // 어느 슬롯에 넣을지 결정 (지정 우선, 없으면 자동 균형)
    let team, pos;
    if (targetTeam === 0 || targetTeam === 1) {
      team = targetTeam;
      const occupied = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = (targetPos === 0 || targetPos === 1) && !occupied.has(targetPos)
        ? targetPos
        : (!occupied.has(0) ? 0 : (!occupied.has(1) ? 1 : null));
      if (pos == null) {
        socket.emit('err', { msg: '해당 팀에 빈 자리가 없습니다.' });
        return;
      }
    } else {
      team = (room.teams[0].length <= room.teams[1].length) ? 0 : 1;
      const occupied = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = !occupied.has(0) ? 0 : (!occupied.has(1) ? 1 : null);
      if (pos == null) team = 1 - team;
      const occupied2 = new Set(room.teams[team].map(i => room.players[i]?.slotPos));
      pos = !occupied2.has(0) ? 0 : (!occupied2.has(1) ? 1 : null);
      if (pos == null) {
        socket.emit('err', { msg: '빈 자리가 없습니다.' });
        return;
      }
    }
    const idx = room.players.length;
    // 봇 이름 부여 — 팀 색상 + 슬롯 번호 (예: "블루봇 MK-1", "레드봇 MK-2")
    const teamLabel = team === 0 ? '블루봇' : '레드봇';
    const botName = `${teamLabel} MK-${pos + 1}`;
    room.players.push({
      socketId: 'AI', name: botName, index: idx,
      pieces: [], draft: null, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: team, slotPos: pos,
    });
    room.teams[team].push(idx);
    if (!room.aiBrain) room.aiBrain = initAiBrain(room.boardBounds ? room.boardBounds.max + 1 : 7);
    broadcastTeamRoomState(room);
  });

  // AI 봇 제거 — 빈 슬롯에 다른 사람을 들이고 싶을 때
  socket.on('team_remove_bot', ({ targetTeam, targetPos } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (targetTeam !== 0 && targetTeam !== 1) return;
    const ti = (room.teams[targetTeam] || []).find(i =>
      room.players[i]?.socketId === 'AI' && room.players[i]?.slotPos === targetPos
    );
    if (ti === undefined) return;
    // 제거 + 인덱스 재정렬
    room.players.splice(ti, 1);
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== ti).map(i => i > ti ? i - 1 : i);
    }
    room.players.forEach((p, i) => { p.index = i; });
    broadcastTeamRoomState(room);
  });

  // 대기실 나가기
  socket.on('team_leave', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    const idx = socket.data.idx;
    if (idx === undefined) return;
    // 제거
    room.players.splice(idx, 1);
    for (let t = 0; t < 2; t++) {
      room.teams[t] = room.teams[t].filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
    }
    // 인덱스 재조정
    room.players.forEach((p, i) => {
      p.index = i;
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.data.idx = i;
      }
    });
    socket.leave(room.id);
    socket.data.roomId = null;
    socket.data.idx = undefined;
    socket.emit('team_left');
    if (room.players.length === 0) {
      delete rooms[room.id];
    } else {
      broadcastTeamRoomState(room);
    }
  });

  // 게임 시작 요청 (4/4일 때만)
  socket.on('team_start_request', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'waiting') return;
    if (room.players.length < 4) {
      socket.emit('err', { msg: '4명이 모여야 시작할 수 있습니다.' });
      return;
    }
    if (room.teams[0].length !== 2 || room.teams[1].length !== 2) {
      socket.emit('err', { msg: '각 팀에 2명씩 배정해야 합니다.' });
      return;
    }
    // 3초 카운트다운 방송
    io.to(room.id).emit('team_countdown', { seconds: 3 });
    room._teamStartTimeout = setTimeout(() => {
      if (room.phase !== 'waiting') return;  // 이미 취소됨
      io.to(room.id).emit('team_start_ready', {
        players: room.players.map(p => ({ name: p.name, idx: p.index, teamId: p.teamId })),
        teams: room.teams,
        characters: CHARACTERS,
      });
      transitionToTeamDraft(room);
    }, 3000);
  });

  // ── 팀전 드래프트 ──
  // 각자 2개 캐릭터 선택 (티어 구분 없음, 팀원 중복 불가)
  // 팀전 드래프트 — 2픽 슬롯 (티어 무관). slot = 'pick1' | 'pick2'
  socket.on('team_draft_pick', ({ slot, type }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_draft') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.draftDone[idx]) return;
    if (slot !== 'pick1' && slot !== 'pick2') return;
    if (type !== null) {
      if (!ALL_CHARS.find(c => c.type === type)) {
        socket.emit('err', { msg: '잘못된 선택입니다.' }); return;
      }
      // 팀원이 이미 선택한 캐릭터 금지
      const teammates = getTeammates(room, idx);
      for (const tIdx of teammates) {
        const tmDraft = room.players[tIdx]?.draft || {};
        if (tmDraft.pick1 === type || tmDraft.pick2 === type) {
          socket.emit('err', { msg: '팀원이 이미 선택한 캐릭터입니다.' }); return;
        }
      }
      // 자기 다른 슬롯과 중복 방지
      const otherSlot = slot === 'pick1' ? 'pick2' : 'pick1';
      if (player.draft?.[otherSlot] === type) {
        socket.emit('err', { msg: '같은 캐릭터를 2번 선택할 수 없습니다.' }); return;
      }
    }
    if (!player.draft) player.draft = { pick1: null, pick2: null };
    player.draft[slot] = type;
    const myTeam = player.teamId;
    const teamMembers = room.teams[myTeam] || [];
    const teamDrafts = teamMembers.map(i => ({
      idx: i,
      name: room.players[i]?.name,
      draft: {
        pick1: room.players[i]?.draft?.pick1 || null,
        pick2: room.players[i]?.draft?.pick2 || null,
      },
      confirmed: !!room.draftDone[i],
    }));
    for (const tIdx of teamMembers) {
      const tp = room.players[tIdx];
      if (!tp || !tp.socketId) continue;
      io.to(tp.socketId).emit('team_draft_pick_update', { playerIdx: idx, slot, type, teamDrafts });
    }
  });

  socket.on('team_draft_confirm', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_draft') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.draftDone[idx]) return;
    const { pick1, pick2 } = player.draft || {};
    if (!pick1 || !pick2) {
      socket.emit('err', { msg: '2개 캐릭터를 모두 선택해주세요.' }); return;
    }
    if (pick1 === pick2) {
      socket.emit('err', { msg: '같은 캐릭터를 2번 선택할 수 없습니다.' }); return;
    }
    // 팀원과 중복 검사
    const teammates = getTeammates(room, idx);
    for (const tIdx of teammates) {
      const tmDraft = room.players[tIdx]?.draft || {};
      if (tmDraft.pick1 === pick1 || tmDraft.pick2 === pick1 ||
          tmDraft.pick1 === pick2 || tmDraft.pick2 === pick2) {
        socket.emit('err', { msg: '팀원과 겹치는 캐릭터가 있습니다.' }); return;
      }
    }
    room.draftDone[idx] = true;
    socket.emit('team_draft_confirmed', { pick1, pick2 });
    io.to(room.id).emit('team_draft_status', {
      draftDone: [...room.draftDone],
      doneNames: room.players.filter((_, i) => room.draftDone[i]).map(p => p.name),
    });
    if (room.draftDone.every(done => done)) {
      transitionToTeamHp(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 선택을 기다리는 중...' });
    }
  });

  // 팀전 HP 실시간 브라우징 — 팀원에게 내 현재 분배 값 공유
  socket.on('team_hp_browse', ({ hps }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_hp') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const teamMembers = room.teams[room.players[idx].teamId] || [];
    for (const tIdx of teamMembers) {
      if (tIdx === idx) continue;
      const tp = room.players[tIdx];
      if (tp && tp.socketId) {
        io.to(tp.socketId).emit('team_hp_browse', { playerIdx: idx, hps });
      }
    }
  });

  // ── 팀전 HP 분배 — 2픽 포맷 ──
  // hps = [pick1Hp, pick2Hp] 합계 10, 각 최소 1
  // 쌍둥이 포함 시: 해당 pick 슬롯은 최소 2 + twinSplit=[elder,younger]
  socket.on('team_hp_distribute', ({ hps, twinSplit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_hp') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player || room.hpDone[idx]) return;
    const draft = player.draft || {};
    if (!draft.pick1 || !draft.pick2) {
      socket.emit('err', { msg: '드래프트가 완료되지 않았습니다.' }); return;
    }
    const hasTwins = draft.pick1 === 'twins' || draft.pick2 === 'twins';
    const twinSlot = draft.pick1 === 'twins' ? 'pick1' : draft.pick2 === 'twins' ? 'pick2' : null;

    // twin split 단계
    if (twinSplit && hasTwins && player.hpDist) {
      const twinSlotHp = player.hpDist[twinSlot];
      if (!Array.isArray(twinSplit) || twinSplit.length !== 2 ||
          twinSplit[0] < 1 || twinSplit[1] < 1 ||
          twinSplit[0] + twinSplit[1] !== twinSlotHp) {
        socket.emit('err', { msg: `쌍둥이 HP 합계는 ${twinSlotHp}, 각 최소 1이어야 합니다.` }); return;
      }
      player.hpDist = { ...player.hpDist, twinElder: twinSplit[0], twinYounger: twinSplit[1] };
      player.pieces = buildTeamPieces(draft, player.hpDist);
      player.twinSplitDone = true;
      room.hpDone[idx] = true;
      socket.emit('hp_ok', { hps: [player.hpDist.pick1, player.hpDist.pick2], twinSplit });
      io.to(room.id).emit('team_hp_status', {
        hpDone: [...room.hpDone],
        doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p => p.name),
      });
      if (room.hpDone.every(d => d)) transitionToTeamReveal(room);
      else socket.emit('wait_msg', { msg: '다른 플레이어의 HP 분배를 기다리는 중...' });
      return;
    }

    // 일반 — hps 2개
    if (!Array.isArray(hps) || hps.length !== 2 ||
        hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 9)) {
      socket.emit('err', { msg: 'HP 합계는 10, 각 최소 1 최대 9 · 2개 필요' }); return;
    }
    if (hasTwins) {
      const twinIdx = twinSlot === 'pick1' ? 0 : 1;
      if (hps[twinIdx] < 2) { socket.emit('err', { msg: '쌍둥이는 최소 2 HP 필요합니다.' }); return; }
      player.hpDist = { pick1: hps[0], pick2: hps[1] };
      socket.emit('twin_split_needed', { twinTierHp: hps[twinIdx] });
      return;
    }
    player.hpDist = { pick1: hps[0], pick2: hps[1] };
    player.pieces = buildTeamPieces(draft, player.hpDist);
    room.hpDone[idx] = true;
    socket.emit('hp_ok', { hps });
    io.to(room.id).emit('team_hp_status', {
      hpDone: [...room.hpDone],
      doneNames: room.players.filter((_, i) => room.hpDone[i]).map(p => p.name),
    });
    if (room.hpDone.every(d => d)) {
      transitionToTeamReveal(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 HP 분배를 기다리는 중...' });
    }
  });

  // ── 팀전 배치 ──
  socket.on('team_place_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_placement') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player) return;
    if (room.placementDone[idx]) {
      socket.emit('err', { msg: '이미 확정한 배치는 수정할 수 없습니다.' }); return;
    }
    const bounds = room.boardBounds;
    if (pieceIdx < 0 || pieceIdx >= player.pieces.length) return;
    if (!inBounds(col, row, bounds)) { socket.emit('err', { msg: '보드 밖입니다.' }); return; }
    const piece = player.pieces[pieceIdx];
    // 자기 말 중복 체크 (쌍둥이는 서로 공유 허용)
    if (piece.subUnit) {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row && !p.subUnit)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    } else {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    }
    // 팀원 말 중복 체크
    for (const tIdx of getTeammates(room, idx)) {
      const tp = room.players[tIdx];
      if (tp.pieces.some(p => p.col === col && p.row === row)) {
        socket.emit('err', { msg: '팀원의 말이 이미 있는 칸입니다.' }); return;
      }
    }
    piece.col = col; piece.row = row;
    socket.emit('team_placed_ok', { pieceIdx, col, row });
    broadcastTeamPlacementUpdate(room, idx);
    // 사용자 요청: AI 봇은 진입 즉시 자기 자리에 배치하고 그대로 유지 (인간 행동마다 wipe 금지).
    // 봇이 아직 배치되지 않은 상태(col<0)인 경우만 한 번 더 재시도 — 그 외에는 그대로 둠.
    for (const p of room.players) {
      if (p.socketId === 'AI' && !room.placementDone[p.index]) {
        const allPlaced = (p.pieces || []).every(pc => pc.col >= 0);
        if (!allPlaced) {
          // 아직 배치 안 된 piece가 남아있으면 즉시 재시도 (긴 대기 X)
          setTimeout(() => {
            if (room.phase === 'team_placement' && !room.placementDone[p.index]) {
              aiTeamPlace(room, p.index);
            }
          }, 200);
        }
      }
    }
  });

  socket.on('team_confirm_placement', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_placement') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    const player = room.players[idx];
    if (!player) return;
    if (player.pieces.some(p => p.col < 0)) {
      socket.emit('err', { msg: '모든 말을 배치하세요.' }); return;
    }
    room.placementDone[idx] = true;
    socket.emit('team_confirm_placement_ok');
    io.to(room.id).emit('team_placement_status', {
      placementDone: [...room.placementDone],
      doneNames: room.players.filter((_, i) => room.placementDone[i]).map(p => p.name),
    });
    if (room.placementDone.every(d => d)) {
      startTeamGameFromRoom(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어의 배치를 기다리는 중...' });
    }
  });

  // ── 팀전 공개 단계 '다음' 버튼 ──
  socket.on('team_reveal_continue', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.mode !== 'team' || room.phase !== 'team_reveal') return;
    const idx = socket.data.idx;
    if (idx === undefined || idx < 0) return;
    if (room.revealDone[idx]) return;
    room.revealDone[idx] = true;
    io.to(room.id).emit('team_reveal_status', { revealDone: [...room.revealDone] });
    if (room.revealDone.every(d => d)) {
      transitionToTeamPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '다른 플레이어를 기다리는 중...' });
    }
  });

  // ── AI 연습 모드 ──
  socket.on('join_ai', ({ playerName, deck }) => {
    const roomId = `ai_${socket.id}_${Date.now()}`;
    rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    room.isAI = true;
    room.aiBrain = initAiBrain();

    // 덱 유효성 검사 후 드래프트로 사용
    const playerDraft = validateDeck(deck);

    const humanDeckName = (deck && typeof deck.deckName === 'string') ? deck.deckName.slice(0, 16) : '';
    const sessionToken = genSessionToken();  // #9: AI전도 새로고침 재접속 지원
    room.players.push({
      socketId: socket.id, name: playerName, index: 0,
      pieces: [], draft: playerDraft, hpDist: null,
      deckName: humanDeckName,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      sessionToken,
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = 0;
    socket.data.sessionToken = sessionToken;

    room.players.push({
      socketId: 'AI', name: 'AI', index: 1,
      pieces: [], draft: null, hpDist: null,
      deckName: aiGenerateDeckName(null),  // AI 덱 이름 — 드래프트 후 다시 갱신
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });

    socket.emit('joined', { idx: 0, roomId, playerName, characters: CHARACTERS, sessionToken });
    socket.emit('opponent_joined', { opponentName: 'AI' });

    const aiDraft = aiSelectPieces();
    room.players[1].draft = aiDraft;
    room.players[1].deckName = aiGenerateDeckName(aiDraft);
    room.draftDone[0] = true;
    room.draftDone[1] = true;

    // 드래프트 건너뛰기 → 바로 초기 공개
    transitionToInitialReveal(room);
  });

  // ── 커스텀 1v1 AI 모드 — 사용자가 AI 덱까지 직접 픽 (히든 모드) ──
  // 작동: join_ai 와 동일하나 aiSelectPieces() 대신 사용자가 보낸 aiDeck 적용.
  socket.on('join_ai_custom', ({ playerName, deck, aiDeck }) => {
    const roomId = `aic_${socket.id}_${Date.now()}`;
    rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];
    room.isAI = true;
    room.aiBrain = initAiBrain();

    const playerDraft = validateDeck(deck);
    const aiDraftCustom = validateDeck(aiDeck);

    const humanDeckName = (deck && typeof deck.deckName === 'string') ? deck.deckName.slice(0, 16) : '';
    const sessionToken = genSessionToken();  // #9: 커스텀 AI전도 새로고침 재접속 지원
    room.players.push({
      socketId: socket.id, name: playerName, index: 0,
      pieces: [], draft: playerDraft, hpDist: null,
      deckName: humanDeckName,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      sessionToken,
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = 0;
    socket.data.sessionToken = sessionToken;

    room.players.push({
      socketId: 'AI', name: 'AI', index: 1,
      pieces: [], draft: aiDraftCustom, hpDist: null,
      deckName: aiGenerateDeckName(aiDraftCustom),
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
    });

    socket.emit('joined', { idx: 0, roomId, playerName, characters: CHARACTERS, sessionToken });
    socket.emit('opponent_joined', { opponentName: 'AI' });

    room.draftDone[0] = true;
    room.draftDone[1] = true;
    // 사용자 요청: 커스텀 1v1 은 캐릭터 선정 후 초기공개·교환 단계 모두 스킵하고 곧장 HP 분배로.
    transitionToHpPhase(room);
  });

  // ── 커스텀 2v2 풀 AI 모드 — 사용자 1명 + AI 봇 3명, 사용자가 모든 AI 덱 직접 픽 (히든 모드) ──
  // drafts: { my: {pick1, pick2}, ally: {pick1, pick2}, enemy1: {pick1, pick2}, enemy2: {pick1, pick2} }
  socket.on('join_team_custom_ai', ({ playerName, drafts }) => {
    const roomId = `tac_${socket.id}_${Date.now()}`;
    rooms[roomId] = createRoom(roomId, { mode: 'team' });
    const room = rooms[roomId];
    if (!room.aiBrain) room.aiBrain = initAiBrain(room.boardBounds ? room.boardBounds.max + 1 : 7);

    // 픽 정규화 — 잘못된/누락된 픽은 무작위로 채움
    const allTypes = ALL_CHARS.map(c => c.type);
    const normalizePair = (d, forbidden) => {
      const pickValid = (t) => allTypes.includes(t) && !forbidden.has(t);
      let p1 = d?.pick1 && pickValid(d.pick1) ? d.pick1 : null;
      let p2 = d?.pick2 && pickValid(d.pick2) && d.pick2 !== p1 ? d.pick2 : null;
      const fallback = allTypes.filter(t => !forbidden.has(t)).sort(() => Math.random() - 0.5);
      if (!p1) p1 = fallback.find(t => t !== p2);
      if (!p2) p2 = fallback.find(t => t !== p1);
      return { pick1: p1, pick2: p2 };
    };

    const my = normalizePair(drafts?.my, new Set());
    const ally = normalizePair(drafts?.ally, new Set([my.pick1, my.pick2]));
    const enemy1 = normalizePair(drafts?.enemy1, new Set());
    const enemy2 = normalizePair(drafts?.enemy2, new Set([enemy1.pick1, enemy1.pick2]));

    // 플레이어 슬롯: idx 0 = 사용자 (블루팀 자리 0), idx 1 = 팀원 AI (블루팀 자리 1),
    //                idx 2 = 적 AI 1 (레드팀 자리 0),  idx 3 = 적 AI 2 (레드팀 자리 1).
    const sessionToken = genSessionToken();
    room.players.push({
      socketId: socket.id, name: playerName, index: 0,
      pieces: [], draft: my, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: 0, slotPos: 0, sessionToken,
    });
    room.teams[0].push(0);

    const allyName = '아군봇';
    room.players.push({
      socketId: 'AI', name: allyName, index: 1,
      pieces: [], draft: ally, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: 0, slotPos: 1,
    });
    room.teams[0].push(1);

    room.players.push({
      socketId: 'AI', name: '적봇 MK-1', index: 2,
      pieces: [], draft: enemy1, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: 1, slotPos: 0,
    });
    room.teams[1].push(2);

    room.players.push({
      socketId: 'AI', name: '적봇 MK-2', index: 3,
      pieces: [], draft: enemy2, hpDist: null,
      actionDone: false, actionUsedSkillReplace: false,
      skillsUsedBeforeAction: [],
      teamId: 1, slotPos: 1,
    });
    room.teams[1].push(3);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.idx = 0;
    socket.data.sessionToken = sessionToken;
    socket.data.isTeamMode = true;

    socket.emit('team_joined', { idx: 0, roomId, playerName, sessionToken });

    // 모든 드래프트 확정 → team_draft 단계 건너뛰고 바로 HP 분배 단계로
    room.draftDone = [true, true, true, true];
    transitionToTeamHp(room);
  });

  // ── 드래프트 실시간 브라우징 (관전자용) ──
  socket.on('draft_browse', ({ step, type, selected }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'draft') return;
    const idx = socket.data.idx;
    // 부분 선택 저장 (스마트 타임아웃용)
    if (selected) room.players[idx]._browseDraft = selected;
    emitToSpectators(room, 'spectator_draft_browse', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      step, type, selected,
    });
  });

  // ── HP 실시간 조정 (관전자용) ──
  socket.on('hp_browse', ({ hps }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'hp_distribution') return;
    const idx = socket.data.idx;
    emitToSpectators(room, 'spectator_hp_browse', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      draft: room.players[idx].draft,
      hps,
    });
  });

  // ── 드래프트 선택 ──
  socket.on('select_pieces', ({ t1, t2, t3 }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'draft') return;
    const idx = socket.data.idx;

    if (!CHARACTERS[1].find(c => c.type === t1) ||
        !CHARACTERS[2].find(c => c.type === t2) ||
        !CHARACTERS[3].find(c => c.type === t3)) {
      socket.emit('err', { msg: '잘못된 선택입니다.' }); return;
    }

    room.players[idx].draft = { t1, t2, t3 };
    room.draftDone[idx] = true;
    socket.emit('draft_ok', { t1, t2, t3 });
    // 관전자에게 드래프트 슬롯 업데이트
    emitToSpectators(room, 'spectator_draft_update', {
      playerIdx: idx,
      playerName: room.players[idx].name,
      draft: { t1, t2, t3 },
      draftDone: [...room.draftDone],
    });

    if (room.draftDone.every(d => d)) {
      transitionToInitialReveal(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 선택을 기다리는 중...' });
    }
  });

  // ── HP 분배 ──
  // Supports two modes:
  //   1) Non-twins: {hps: [t1, t2, t3]} sum=10, each >= 1
  //   2) Twins step 1: {hps: [twinTier, t2, t3]} where twinTier >= 2, sum=10
  //      Twins step 2: {twinSplit: [elder, younger]} sum = twinTier HP, each >= 1
  socket.on('distribute_hp', ({ hps, twinSplit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'hp_distribution') return;
    const idx = socket.data.idx;
    const player = room.players[idx];
    const hasTwins = player.draft.t1 === 'twins';

    // If this is a twin split step
    if (twinSplit && hasTwins && player.hpDist) {
      const twinTierHp = player.hpDist[0]; // HP assigned to twins tier
      if (!Array.isArray(twinSplit) || twinSplit.length !== 2 ||
          twinSplit[0] < 1 || twinSplit[1] < 1 ||
          twinSplit[0] + twinSplit[1] !== twinTierHp) {
        socket.emit('err', { msg: `쌍둥이 HP 합계는 ${twinTierHp}, 각 최소 1이어야 합니다.` }); return;
      }

      const d = player.draft;
      player.pieces = [
        createPiece('twins', 1, twinSplit[0], { subUnit: 'elder', parentType: 'twins' }),
        createPiece('twins', 1, twinSplit[1], { subUnit: 'younger', parentType: 'twins' }),
        createPiece(d.t2, 2, player.hpDist[1]),
        createPiece(d.t3, 3, player.hpDist[2]),
      ];
      player.pieces[0].type = 'twins_elder';
      player.pieces[1].type = 'twins_younger';
      player.twinSplitDone = true;
      room.hpDone[idx] = true;
      socket.emit('hp_ok', { hps: player.hpDist, twinSplit });
      emitToSpectators(room, 'spectator_hp_update', { playerIdx: idx, playerName: player.name, pieces: pieceSummary(player.pieces), hpDone: [...room.hpDone] });

      if (room.hpDone.every(d2 => d2)) {
        transitionToPlacement(room);
      } else {
        socket.emit('wait_msg', { msg: '상대방의 HP 분배를 기다리는 중...' });
      }
      return;
    }

    // Standard HP distribution
    if (hasTwins) {
      // For twins: 3 values [twinTierTotal, t2, t3], twinTierTotal >= 2
      if (!Array.isArray(hps) || hps.length !== 3 ||
          hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 8)) {
        socket.emit('err', { msg: 'HP 합계는 10, 각 최소 1 최대 8 · 3개 필요' }); return;
      }
      if (hps[0] < 2) {
        socket.emit('err', { msg: '쌍둥이 티어는 최소 2 HP 필요합니다.' }); return;
      }
      player.hpDist = hps;
      // Request twin split
      socket.emit('twin_split_needed', { twinTierHp: hps[0] });
      return;
    }

    // Non-twins: standard 3 values
    if (!Array.isArray(hps) || hps.length !== 3 ||
        hps.reduce((a, b) => a + b, 0) !== 10 || hps.some(h => h < 1 || h > 8)) {
      socket.emit('err', { msg: 'HP 합계는 10, 각 유닛 최소 1 최대 8 · 3개 필요' }); return;
    }

    player.hpDist = hps;
    const d = player.draft;
    player.pieces = [
      createPiece(d.t1, 1, hps[0]),
      createPiece(d.t2, 2, hps[1]),
      createPiece(d.t3, 3, hps[2]),
    ];
    room.hpDone[idx] = true;
    socket.emit('hp_ok', { hps });
    emitToSpectators(room, 'spectator_hp_update', { playerIdx: idx, playerName: player.name, pieces: pieceSummary(player.pieces), hpDone: [...room.hpDone] });

    if (room.hpDone.every(d2 => d2)) {
      transitionToPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 HP 분배를 기다리는 중...' });
    }
  });

  // startRevealPhase moved to global scope as startRevealPhaseFromRoom

  // ── Reveal 확인 (레거시 — 새 흐름에서는 사용 안 함) ──
  socket.on('confirm_reveal', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'reveal') return;
    const idx = socket.data.idx;
    room.revealDone[idx] = true;

    if (room.revealDone.every(d => d)) {
      transitionToPlacement(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방을 기다리는 중...' });
    }
  });

  // ── 초기 공개 확인 (#12: YES/NO 결정도 함께) ──
  // wantsExchange = true → 교체 드래프트 진행 측, false → 그대로 확정 측.
  // 양측 모두 결정되면 분기:
  //   둘 다 NO → final_reveal 로 직행 (교환 없음)
  //   하나라도 YES → exchange_draft 로 진입 (NO 측은 자동 done 처리, 60s 대기)
  // 교체 페이즈 — 10초 결정 윈도우 종료 후 클라이언트가 최종 결정을 emit.
  //   클라이언트가 자체 10초 타이머로 토글 후 한 번만 emit (조기 emit 도 수용 — 서버는 마지막 값으로 갱신).
  //   양측 모두 수신 시 즉시 다음 단계. 둘 다 NO → final_reveal 직행. 하나라도 YES → exchange_draft.
  //   서버는 상대 측의 결정을 broadcast 하지 않음 — 결정 윈도우 동안 익명성 유지.
  socket.on('confirm_initial_reveal', (payload) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'initial_reveal') return;
    const idx = socket.data.idx;
    if (!room.exchangeDecisions) room.exchangeDecisions = [null, null];
    const wantsExchange = !!(payload && payload.wantsExchange);
    room.exchangeDecisions[idx] = wantsExchange;
    room.initialRevealDone[idx] = true;
    console.log(`[confirm_initial_reveal] idx=${idx} wantsExchange=${wantsExchange} initialRevealDone=${JSON.stringify(room.initialRevealDone)} exchangeDecisions=${JSON.stringify(room.exchangeDecisions)} isAI=${room.isAI}`);

    if (room.initialRevealDone.every(d => d)) {
      // AI 결정 — aiDecideExchange 의 카운터 점수에 기반한 분석적 판단.
      //   강력한 카운터(점수 70+) 발견 → 거의 확실히 YES
      //   보통 카운터(50-69) → 70% YES
      //   약한 카운터(35-49) → 30% YES
      //   카운터 없거나 매우 약함 → NO
      // 무작위 50% 동전 던지기 대신 "상대 조합을 보고 판단" 하는 동작으로 자연스러움 강화.
      if (room.isAI) {
        if (room.exchangeDecisions[1] == null) {
          const aiPlayer = room.players[1];
          const humanPlayer = room.players[0];
          const swap = aiDecideExchange(aiPlayer.draft, humanPlayer.draft);
          let aiYes;
          if (swap && swap.priority >= 70) aiYes = true;
          else if (swap && swap.priority >= 50) aiYes = (Math.random() < 0.7);
          else if (swap && swap.priority >= 35) aiYes = (Math.random() < 0.3);
          else aiYes = false;
          room.exchangeDecisions[1] = aiYes;
          // YES 결정 시 미리 계산된 swap 을 보관 — transitionToExchangeDraft 에서 재사용
          if (aiYes && swap) {
            aiPlayer._aiPrecomputedSwap = { tier: swap.tier, newType: swap.newType };
          }
        }
      }
      const anyYes = room.exchangeDecisions.some(d => d === true);
      console.log(`[confirm_initial_reveal] both done, anyYes=${anyYes}, exchangeDecisions=${JSON.stringify(room.exchangeDecisions)}`);
      if (!anyYes) {
        // 둘 다 NO → final_reveal 직행 (대기 없음 — 양측 모두 교체하지 않으므로 보여줄 게 없음)
        console.log('[confirm_initial_reveal] both NO → transitionToFinalReveal');
        transitionToFinalReveal(room);
      } else {
        console.log('[confirm_initial_reveal] anyYes → transitionToExchangeDraft');
        transitionToExchangeDraft(room);
      }
    }
    // 상대가 아직 결정 안 했어도 wait_msg 보내지 않음 — 결정 사실 자체가 정보가 됨.
  });

  // ── 교환 드래프트: 1캐릭터 교환 ──
  socket.on('exchange_pick', ({ tier, newType }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'exchange_draft') return;
    const idx = socket.data.idx;
    if (room.exchangeDone[idx]) return;

    const player = room.players[idx];

    // 교환하지 않고 확정
    if (!tier || !newType) {
      room.exchangeDone[idx] = true;
      socket.emit('exchange_done', { draft: player.draft });
      if (room.exchangeDone.every(d => d)) {
        transitionToFinalReveal(room);
      } else {
        // 상대가 아직 안 끝남 — 페이즈 시작부터 흐른 시간 빼고 남은 시간 카운트다운
        socket.emit('ai_decision_wait', { waitMs: exchangeRemainingMs(room) });
      }
      return;
    }

    // 유효성 검사
    if (![1, 2, 3].includes(tier)) {
      socket.emit('err', { msg: '잘못된 티어입니다.' }); return;
    }
    const charExists = CHARACTERS[tier]?.find(c => c.type === newType);
    if (!charExists) {
      socket.emit('err', { msg: '존재하지 않는 캐릭터입니다.' }); return;
    }
    const currentType = tier === 1 ? player.draft.t1 : tier === 2 ? player.draft.t2 : player.draft.t3;
    if (newType === currentType) {
      socket.emit('err', { msg: '같은 캐릭터로는 교환할 수 없습니다.' }); return;
    }

    // 교환 실행
    if (tier === 1) player.draft.t1 = newType;
    else if (tier === 2) player.draft.t2 = newType;
    else player.draft.t3 = newType;

    room.exchangeDone[idx] = true;
    socket.emit('exchange_done', { draft: player.draft, exchanged: { tier, newType, newChar: findCharData(newType, tier) } });
    emitToSpectators(room, 'spectator_exchange', { playerIdx: idx, playerName: player.name });

    if (room.exchangeDone.every(d => d)) {
      transitionToFinalReveal(room);
    } else {
      // 상대가 아직 안 끝남 — 페이즈 시작부터 흐른 시간 빼고 남은 시간 카운트다운
      socket.emit('ai_decision_wait', { waitMs: exchangeRemainingMs(room) });
    }
  });

  // ── 최종 공개 확인 ──
  socket.on('confirm_final_reveal', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'final_reveal') return;
    const idx = socket.data.idx;
    room.finalRevealDone[idx] = true;

    if (room.finalRevealDone.every(d => d)) {
      transitionToHpPhase(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방을 기다리는 중...' });
    }
  });

  // ── 말 배치 ──
  socket.on('place_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const idx = socket.data.idx;
    const player = room.players[idx];
    const bounds = room.boardBounds;

    if (pieceIdx < 0 || pieceIdx >= player.pieces.length) return;
    if (!inBounds(col, row, bounds)) return;

    const piece = player.pieces[pieceIdx];
    if (piece.subUnit) {
      // Twins can share cell with other twin
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row && !p.subUnit)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    } else {
      if (player.pieces.some((p, i) => i !== pieceIdx && p.col === col && p.row === row)) {
        socket.emit('err', { msg: '이미 자신의 말이 있는 칸입니다.' }); return;
      }
    }

    player.pieces[pieceIdx].col = col;
    player.pieces[pieceIdx].row = row;
    socket.emit('placed_ok', { pieceIdx, col, row });
    // 관전자에게 배치 실시간 업데이트
    emitToSpectators(room, 'spectator_placement_update', {
      p0Pieces: pieceSummary(room.players[0].pieces),
      p1Pieces: pieceSummary(room.players[1].pieces),
      boardBounds: room.boardBounds,
    });
  });

  // ── 배치 확정 ──
  socket.on('confirm_placement', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'placement') return;
    const idx = socket.data.idx;
    const player = room.players[idx];

    if (player.pieces.some(p => p.col < 0)) {
      socket.emit('err', { msg: '모든 말을 배치하세요.' }); return;
    }

    room.placementDone[idx] = true;

    if (room.placementDone.every(d => d)) {
      startGameFromRoom(room);
    } else {
      socket.emit('wait_msg', { msg: '상대방의 배치를 기다리는 중...' });
    }
  });

  // ── 이동 ──
  socket.on('move_piece', ({ pieceIdx, col, row }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.players[idx] && room.players[idx]._reconnecting) { socket.emit('err', { msg: '재접속 처리 중입니다.' }); return; }
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const player = room.players[idx];

    // Check if action already done (unless messenger sprint OR twin's other half not yet moved)
    {
      const _pc = player.pieces[pieceIdx];
      const _twinSecondMove = _pc && (_pc.subUnit === 'elder' || _pc.subUnit === 'younger') &&
        Array.isArray(player.twinMovedSubs) && !player.twinMovedSubs.includes(_pc.subUnit);
      if (player.actionDone && !_pc?.messengerSprintActive && !_twinSecondMove) {
        socket.emit('err', { msg: '이미 행동을 사용했습니다.' }); return;
      }
    }

    const piece = player.pieces[pieceIdx];
    if (!piece || !piece.alive) { socket.emit('err', { msg: '올바르지 않은 말입니다.' }); return; }

    // Action-replace skill used => can't move (질주는 예외 — 이동을 위한 스킬이므로)
    if (player.actionUsedSkillReplace && !piece.messengerSprintActive) {
      socket.emit('err', { msg: '행동 대체 스킬을 사용했으므로 이동할 수 없습니다.' }); return;
    }

    // 쌍둥이 이동 중에는 쌍둥이만 이동 가능
    if (player.twinMovedSubs && player.twinMovedSubs.length > 0 && !piece.subUnit) {
      socket.emit('err', { msg: '쌍둥이 이동 중입니다. 나머지 쌍둥이를 이동시키세요.' }); return;
    }
    // 전령 질주 중에는 해당 전령만 이동 가능
    const anySprintingMsg = player.pieces.find(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0);
    if (anySprintingMsg && anySprintingMsg !== piece) {
      socket.emit('err', { msg: '전령 질주 중입니다. 해당 전령만 이동할 수 있습니다.' }); return;
    }
    if (!inBounds(col, row, room.boardBounds)) { socket.emit('err', { msg: '보드 밖입니다.' }); return; }
    if (!isCrossAdjacent(piece.col, piece.row, col, row)) {
      socket.emit('err', { msg: '상하좌우 1칸만 이동할 수 있습니다.' }); return;
    }

    // Block friendly unit stacking (except twins of the SAME player)
    const friendlyOccupant = player.pieces.find(p => p.alive && p.col === col && p.row === row);
    if (friendlyOccupant) {
      const bothAreTwins = piece.subUnit && friendlyOccupant.subUnit;
      if (!bothAreTwins) {
        socket.emit('err', { msg: '아군이 있는 칸으로는 이동할 수 없습니다.' }); return;
      }
    }
    // 팀모드: 팀원의 말도 같은 칸에 있으면 이동 차단 (쌍둥이는 같은 플레이어 한정 — 팀원 쌍둥이와는 공유 X)
    if (room.mode === 'team') {
      for (const tIdx of getTeammates(room, idx)) {
        const tp = room.players[tIdx];
        if (!tp) continue;
        if ((tp.pieces || []).some(p => p.alive && p.col === col && p.row === row)) {
          socket.emit('err', { msg: '팀원이 있는 칸으로는 이동할 수 없습니다.' }); return;
        }
      }
    }
    // 유해 차단 — 유해가 있는 칸으로 이동 불가
    if (room.remains && room.remains.some(r => r.col === col && r.row === row)) {
      socket.emit('err', { msg: '유해가 있는 칸으로는 이동할 수 없습니다.' }); return;
    }

    const prev = { col: piece.col, row: piece.row };
    piece.col = col;
    piece.row = row;

    // Check trap (팀전: 모든 적팀 플레이어의 덫 확인)
    const enemyIndicesForTrap = (room.mode === 'team')
      ? room.players.map(p => p.index).filter(i => !isTeammate(room, idx, i))
      : [1 - idx];
    let trapIdx = -1, trapOwnerIdx = -1;
    for (const eIdx of enemyIndicesForTrap) {
      const arr = room.boardObjects[eIdx] || [];
      const ti = arr.findIndex(o => o.type === 'trap' && o.col === col && o.row === row);
      if (ti >= 0) { trapIdx = ti; trapOwnerIdx = eIdx; break; }
    }
    // ★ 그림자 숨기 면역 — 트랩 발동 자체 차단 (제거도 X, 그대로 남음).
    const isShadowedHuman = piece.statusEffects && piece.statusEffects.some(e => e.type === 'shadow');
    // ★ 사용자 요청: 트랩 발동을 이동 직후 동시 처리에서 분리.
    //   먼저 이동 emit (move_ok / opp_moved / team_ally_moved / broadcast) 까지 끝낸 후
    //   ~700ms 지연으로 트랩 효과 적용 + 알림. 클라이언트는 이동 애니 → 트랩 애니 순으로 보임.
    let trapPending = null;
    if (trapIdx >= 0 && !isShadowedHuman) {
      // ★ 트랩을 밟은 정확한 piece 인덱스 저장 — 지연 발동(700ms) 사이 같은 칸에 다른 말이
      //   겹쳐 들어와도 엉뚱한 말이 피격되지 않도록 신원 확인용.
      trapPending = { trapIdx, trapOwnerIdx, col, row, idx, pieceIdx: player.pieces.indexOf(piece) };
    }

    // ★ 쌍둥이 이동: 한쪽만 이동해도 행동 완료. 같은 턴에 다른 쪽 이동은 옵션.
    if (piece.subUnit) {
      if (!player.twinMovedSubs) player.twinMovedSubs = [];
      if (player.twinMovedSubs.includes(piece.subUnit)) {
        socket.emit('err', { msg: '이미 이동한 쌍둥이입니다. 다른 쪽을 이동시키세요.' }); return;
      }
      player.twinMovedSubs.push(piece.subUnit);
      player.actionDone = true;  // 첫 이동만으로 턴 종료 가능
    } else if (piece.messengerSprintActive && piece.messengerMovesLeft > 0) {
      // Messenger sprint: handle multi-move
      piece.messengerMovesLeft--;
      if (piece.messengerMovesLeft <= 0) {
        piece.messengerSprintActive = false;
        player.actionDone = true;
      }
    } else {
      player.actionDone = true;
    }
    // 행동 추적 — 쌍검무/질주 가드용
    player._lastActionType = 'move';
    player._lastActionPieceType = piece.type;
    player._lastActionSubUnit = piece.subUnit || null;

    // twinMovePending: 쌍둥이 첫 이동 후 나머지 한쪽이 아직 이동 안 했으면 true.
    //   client 가 새 "쌍둥이 이동 페이즈" 를 유지하기 위한 플래그.
    const stillCanMoveOtherTwin = piece.subUnit
      && Array.isArray(player.twinMovedSubs) && player.twinMovedSubs.length === 1
      && player.pieces.some(p => p.alive && p.subUnit && p.subUnit !== piece.subUnit);
    socket.emit('move_ok', {
      pieceIdx, prev, col, row,
      yourPieces: pieceSummary(player.pieces),
      boardObjects: boardObjectsSummary(room, idx),
      remains: room.remains || [],
      twinMovePending: stillCanMoveOtherTwin,
      twinMovedSub: piece.subUnit || null,
    });

    // ★ 사용자 요청: 쌍둥이 이동은 시전자가 페이즈 마무리에 단 한 번 알림을 받듯이,
    //   상대도 페이즈 마무리에 단 한 번만 opp_moved 받음.
    //   첫 쌍둥이 이동 → 알림 보류. 두번째 이동 OR end_turn 시 단일 알림 발송.
    const isTwinMove = !!piece.subUnit;
    const suppressOppEmit = isTwinMove && stillCanMoveOtherTwin;
    if (suppressOppEmit) {
      // 첫 쌍둥이 이동 — opp_moved 보류. end_turn 또는 두번째 이동 시 단일 발송.
      player._pendingTwinOppMoveAt = Date.now();
    } else {
      // 두번째 쌍둥이 이동이라면 보류 플래그 정리
      player._pendingTwinOppMoveAt = 0;
    }

    if (room.mode === 'team') {
      // 팀모드: 팀원에게 실시간 이동 이벤트(애니메이션용) — payload 1회 빌드 후 ally 들에게 재사용
      const allyIdxs = getAllyIndices(room, idx).filter(i => i !== idx);
      if (allyIdxs.length > 0) {
        const _allyMovedPayload = {
          moverIdx: idx,
          moverName: room.players[idx].name,
          pieceType: piece.type,
          pieceIcon: piece.icon,
          pieceName: piece.name,
          subUnit: piece.subUnit || null,
          prevCol: prev.col, prevRow: prev.row,
          col, row,
        };
        for (const alIdx of allyIdxs) {
          const ally = room.players[alIdx];
          if (ally && ally.socketId && ally.socketId !== 'AI') {
            io.to(ally.socketId).emit('team_ally_moved', _allyMovedPayload);
          }
        }
      }
      // 적팀 모두에게 이동 알림 — 1v1과 동일한 토스트/로그 표시. payload 1회 빌드.
      // 단, 쌍둥이 첫 이동은 보류 (suppressOppEmit). 두번째 이동·end_turn 시 단일 발송.
      if (!suppressOppEmit) {
        const enemyIdxs = getEnemyIndices(room, idx);
        const isMarked = (piece.statusEffects || []).some(e => e.type === 'mark');
        const _oppMovedPayload = {
          msg: isMarked
            ? `${room.players[idx].name}의 표식된 ${piece.name}${조사(piece.name, '이', '가')} 이동했습니다.`
            : `${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 이동했습니다.`,
          prevCol: isMarked ? prev.col : undefined,
          prevRow: isMarked ? prev.row : undefined,
          col: isMarked ? col : undefined,
          row: isMarked ? row : undefined,
        };
        for (const enIdx of enemyIdxs) {
          const en = room.players[enIdx];
          if (en && en.socketId && en.socketId !== 'AI') {
            io.to(en.socketId).emit('opp_moved', _oppMovedPayload);
          }
        }
      }
      // ★ FIX (관전자 이동 모션): 상태 동기화(broadcast) 전에 슬라이드 애니용 좌표 전송 → 옛 위치에서 시작.
      emitToSpectators(room, 'spectator_move_anim', { prevCol: prev.col, prevRow: prev.row, col, row, pieceType: piece.type, pieceSubUnit: piece.subUnit || null, owner: idx });
      // 트랩 발동 보류 시 broadcast 도 지연 — 이동 후 piece 가 alive=true 상태로 보드에 노출되도록.
      if (!trapPending) broadcastTeamGameState(room);
    } else {
      // 1v1 — 쌍둥이 첫 이동은 보류
      if (!suppressOppEmit) {
        const opp = room.players[1 - idx];
        if (opp.socketId !== 'AI') {
          io.to(opp.socketId).emit('opp_moved', { msg: `${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 이동했습니다.`, prevCol: prev.col, prevRow: prev.row, col, row });
        }
      }
      // ★ FIX (관전자 이동 모션): 1v1 — spectator_update(아래) 전에 슬라이드 애니용 좌표 전송.
      emitToSpectators(room, 'spectator_move_anim', { prevCol: prev.col, prevRow: prev.row, col, row, pieceType: piece.type, pieceSubUnit: piece.subUnit || null, owner: idx });
    }
    emitToSpectators(room, 'spectator_log', { msg: `${player.name}, ${piece.name} 이동`, type: 'move', playerIdx: idx });
    if (!trapPending) emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // 트랩이 보류된 경우 — 승리 검사도 트랩 setTimeout 안에서 수행
    if (!trapPending) {
      if (room.mode === 'team') {
        if (isTeamEliminated(room, 0)) { endTeamGame(room, 1); return; }
        if (isTeamEliminated(room, 1)) { endTeamGame(room, 0); return; }
      } else {
        if (checkWin(room, idx)) {
          endGame(room, 1 - idx);
          return;
        }
      }
    }

    // ★ 트랩 지연 발동 — 이동 emit (move_ok / opp_moved / team_ally_moved / broadcast) 가
    //   끝난 후 ~700ms 뒤 트랩 효과 적용 + 알림. 클라이언트는 이동 애니가 끝난 후 트랩 애니를 봄.
    if (trapPending) {
      // AI 다음 행동을 트랩 종료까지 지연 (이동 700ms + 트랩 처리 마진)
      room._animPhaseEndsAt = Math.max(room._animPhaseEndsAt || 0, Date.now() + 1500);
      room._trapPending = true;
      const tp = trapPending;
      setTimeout(() => {
        room._trapPending = false;
        if (!rooms[room.id] || room.phase !== 'game') return;
        const ownerArr = room.boardObjects[tp.trapOwnerIdx] || [];
        const tIdx = ownerArr.findIndex(o => o.type === 'trap' && o.col === tp.col && o.row === tp.row);
        if (tIdx < 0) return;
        ownerArr.splice(tIdx, 1);
        const player2 = room.players[tp.idx];
        if (!player2) return;
        // ★ 저장해 둔 pieceIdx 로 정확한 말 조회 — 좌표 기반 find 는 같은 칸에 겹친 다른 말을 잘못 집을 수 있음.
        const piece2 = (typeof tp.pieceIdx === 'number' && tp.pieceIdx >= 0)
          ? (player2.pieces || [])[tp.pieceIdx]
          : (player2.pieces || []).find(p => p.alive && p.col === tp.col && p.row === tp.row);
        // 그 사이 죽었거나 트랩 칸을 떠났으면 발동 취소.
        if (!piece2 || !piece2.alive || piece2.col !== tp.col || piece2.row !== tp.row) return;
        // ★ 패시브 dedupe Set 초기화.
        room._attackPassivesFired = new Set();
        room._pendingBodyguardPassive = null;
        const dmg = resolveDamage(room, { type: 'manhunter', tag: 'villain', tier: 1, col: tp.col, row: tp.row }, piece2, tp.trapOwnerIdx, 2, false, tp.idx);
        piece2.hp = Math.max(0, piece2.hp - dmg);
        if (piece2.type === 'wizard') {
          const wizSpSlot = teamSlotIdx(room, tp.idx);
          room.instantSp[wizSpSlot] += 1;
          emitSPUpdate(room);
          emitToBoth(room, 'passive_alert', { type: 'wizard', playerIdx: tp.idx, msg: `인스턴트 매직 : SP 획득` });
          emitToSpectators(room, 'spectator_log', { msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: tp.idx });
        }
        const willDie = piece2.hp <= 0;
        if (willDie) {
          handleDeath(room, piece2, tp.idx);
          setKillInfo(room, 'trap', null, [{ name: piece2.name }]);
        }
        emitToBoth(room, 'trap_triggered', {
          col: tp.col, row: tp.row,
          pieceInfo: { type: piece2.type, name: piece2.name, icon: piece2.icon },
          damage: dmg,
          destroyed: willDie,
          newHp: piece2.hp,
          victimOwnerIdx: tp.idx,
          trapOwnerIdx: tp.trapOwnerIdx,  // 덫 설치자 (사냥꾼 owner) — 시전 강조용
        });
        if (room.mode === 'team') broadcastTeamGameState(room);
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
        // 트랩 후 승리 검사
        if (room.mode === 'team') {
          if (isTeamEliminated(room, 0)) { endTeamGame(room, 1); return; }
          if (isTeamEliminated(room, 1)) { endTeamGame(room, 0); return; }
        } else {
          if (checkWin(room, tp.idx)) {
            endGame(room, 1 - tp.idx);
            return;
          }
        }
      }, 700);
    }

    // DON'T auto end turn - wait for 'end_turn' event
  });

  // ── 공격 ──
  // ── AI 자동조작: 클라가 "내 턴 최선수"를 요청 → 서버 AI 결정 후 반환(실행은 클라가 인간 경로로). ──
  socket.on('request_ai_move', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') { socket.emit('ai_move', { action: null }); return; }
    // ★ 공정성: 사람 간 PvP 에서 "최선수 힌트" 로 악용 방지 — AI 연습 룸에서만 자동조작 응답.
    if (!room.isAI) { socket.emit('ai_move', { action: null }); return; }
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('ai_move', { action: null }); return; }
    if (room.players[idx] && room.players[idx]._reconnecting) { socket.emit('ai_move', { action: null }); return; }
    let action = null;
    try { action = aiDecideAction(room, idx); } catch (e) { console.error('[request_ai_move]', e.message); action = null; }
    socket.emit('ai_move', { action });
  });

  socket.on('attack', ({ pieceIdx, tCol, tRow }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.players[idx] && room.players[idx]._reconnecting) { socket.emit('err', { msg: '재접속 처리 중입니다.' }); return; }
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const player = room.players[idx];

    // ★ 사용자 요청: 전령 질주 활성 시 공격 차단 (자유시전형이지만 sprint 동안은 공격 금지).
    if (player.pieces.some(p => p.alive && p.messengerSprintActive && p.messengerMovesLeft > 0)) {
      socket.emit('err', { msg: '전령 질주 중에는 공격할 수 없습니다.' });
      return;
    }

    if (player.actionDone) {
      // 쌍검무: 2회 공격 중 2번째 공격
      const piece = player.pieces[pieceIdx];
      if (piece && piece.dualBladeAttacksLeft > 0) {
        piece.dualBladeAttacksLeft--;
        const bounds = room.boardBounds;
        const atkCells = getAttackCells(piece.type, piece.col, piece.row, bounds);
        const hitResults = processAttack(room, idx, piece, atkCells);
        const cellResults = atkCells.map(cell => {
          const hit = hitResults.find(h => h.col === cell.col && h.row === cell.row);
          return {
            col: cell.col, row: cell.row, hit: !!hit,
            damage: hit ? hit.damage : 0, destroyed: hit ? hit.destroyed : false,
            revealedType: hit?.revealedType, revealedName: hit?.revealedName, revealedIcon: hit?.revealedIcon,
            hitName: hit?.hitName, hitIcon: hit?.hitIcon,
            defPieceIdx: hit?.defPieceIdx,
            defOwnerIdx: hit?.defOwnerIdx,
            redirectedToBodyguard: hit?.redirectedToBodyguard || false,
            bodyguardRedirect: hit?.bodyguardRedirect || false,
          };
        });
        // ★ 호위무사 가로채기 — 프로필 충성 도장 + 피격 애니용 (좌표 미포함)
        const bodyguardHits = hitResults.filter(h => h.bodyguardRedirect).map(h => ({
          defPieceIdx: h.defPieceIdx, defOwnerIdx: h.defOwnerIdx,
          damage: h.damage, destroyed: h.destroyed,
        }));
        // 쌍검무 추가공격도 임팩트 플래그 전달
        const _atkOwnRats = (room._attackerOwnRatsDestroyedCount || 0);
        const _atkFf = (room._attackerFriendlyFireCount || 0);
        const attackerImpactedAnything2 = hitResults.length > 0 || _atkOwnRats > 0 || _atkFf > 0;
        if (room.mode === 'team') {
          // ── 팀전: 1v1용 1-idx 절대 사용 금지 (idx=2,3 이면 room.players[-1]/[-2] 크래시)
          socket.emit('attack_result', {
            pieceIdx, cellResults, anyHit: hitResults.length > 0,
            attackerImpactedAnything: attackerImpactedAnything2,
            yourPieces: pieceSummary(player.pieces),
            friendlyFireHits: room._friendlyFireHits || [],
            bodyguardHits,
          });
          // being_attacked: 실제 피격된 각 적 플레이어에게 각각 전송
          const defHitsByOwner = new Map();
          for (const h of hitResults) {
            if (h.defOwnerIdx === undefined) continue;
            if (!defHitsByOwner.has(h.defOwnerIdx)) defHitsByOwner.set(h.defOwnerIdx, []);
            defHitsByOwner.get(h.defOwnerIdx).push(h);
          }
          for (const [ownerIdx, hits] of defHitsByOwner.entries()) {
            const defPlayer = room.players[ownerIdx];
            if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
            io.to(defPlayer.socketId).emit('being_attacked', {
              atkCells,
              attackerImpactedAnything: attackerImpactedAnything2,
              hitPieces: hits.map(h => {
                const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
                return {
                  col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
                  name: dp?.name, icon: dp?.icon,
                  redirectedToBodyguard: h.redirectedToBodyguard || false,
                  bodyguardRedirect: h.bodyguardRedirect || false,
                  defPieceIdx: h.defPieceIdx,
                };
              }),
              yourPieces: pieceSummary(defPlayer.pieces),
            });
          }
          broadcastTeamGameState(room);
        } else {
          // ── 1v1
          socket.emit('attack_result', {
            pieceIdx, cellResults, anyHit: hitResults.length > 0,
            attackerImpactedAnything: attackerImpactedAnything2,
            oppPieces: oppPieceSummary(room.players[1 - idx].pieces),
            yourPieces: pieceSummary(player.pieces),
            friendlyFireHits: room._friendlyFireHits || [],
            bodyguardHits,
          });
          const defender = room.players[1 - idx];
          if (defender && defender.socketId !== 'AI') {
            io.to(defender.socketId).emit('being_attacked', {
              atkCells,
              attackerImpactedAnything: attackerImpactedAnything2,
              hitPieces: hitResults.map(h => {
                const dp = (typeof h.defPieceIdx === 'number') ? defender.pieces[h.defPieceIdx] : null;
                return {
                  col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
                  name: dp?.name, icon: dp?.icon,
                  redirectedToBodyguard: h.redirectedToBodyguard || false,
                  bodyguardRedirect: h.bodyguardRedirect || false,
                  defPieceIdx: h.defPieceIdx,
                };
              }),
              yourPieces: pieceSummary(defender.pieces),
            });
          }
        }
        // ★ 관전자 — 쌍검무 추가 공격 (1v1·팀전 공통)
        emitToSpectators(room, 'spectator_attack_anim', {
          atkCells,
          atkCol: piece.col, atkRow: piece.row, atkType: piece.type, atkSubUnit: piece.subUnit || null,  // ★ 관전자 공격 모션
          hits: hitResults.map(h => ({
            col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            defPieceIdx: h.defPieceIdx, defOwnerIdx: h.defOwnerIdx ?? (1 - idx),
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false,
          })),
        });
        // 관전자 로그: 쌍검무 추가 공격
        if (hitResults.length > 0) {
          for (const h of hitResults) {
            const ownerIdx = h.defOwnerIdx ?? (1 - idx);
            const ownerPlayer = room.players[ownerIdx];
            const dp = ownerPlayer ? ownerPlayer.pieces.find(p => p.col === h.col && p.row === h.row) : null;
            const targetName = dp ? `${dp.name}` : coord(h.col, h.row);
            emitToSpectators(room, 'spectator_log', { msg: h.destroyed
              ? `${player.name}의 ${targetName} 사망`
              : `${player.name}의 공격 명중!`, type: 'hit', playerIdx: idx });
          }
        } else {
          emitToSpectators(room, 'spectator_log', { msg: `${player.name} 공격 빗나감`, type: 'miss', playerIdx: idx });
        }
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
        // 승리 체크 — 모드별 분기
        flushPhase(room, () => {
          if (!rooms[room.id] || room.phase !== 'game') return;
          checkGameEndAfterPhase(room);
        });
        return;
      }
      socket.emit('err', { msg: '이미 행동을 사용했습니다.' }); return;
    }

    if (player.actionUsedSkillReplace) {
      socket.emit('err', { msg: '행동 대체 스킬을 사용했으므로 공격할 수 없습니다.' }); return;
    }

    // 쌍둥이 이동 중이면 공격 불가 (이동과 공격을 섞을 수 없음)
    if (player.twinMovedSubs && player.twinMovedSubs.length > 0) {
      socket.emit('err', { msg: '쌍둥이가 이동 중입니다. 나머지 쌍둥이도 이동하거나 턴을 종료하세요.' }); return;
    }

    const attacker = player;
    const defender = room.players[1 - idx];
    const atkPiece = attacker.pieces[pieceIdx];
    if (!atkPiece || !atkPiece.alive) { socket.emit('err', { msg: '올바르지 않은 말입니다.' }); return; }

    // Validate target for target-picking types
    if ((atkPiece.type === 'shadowAssassin' || atkPiece.type === 'witch') &&
        (tCol === undefined || tRow === undefined || !inBounds(tCol, tRow, room.boardBounds))) {
      socket.emit('err', { msg: '대상 칸을 선택하세요.' }); return;
    }
    // shadowAssassin: 자기 주변 9칸(자신 포함) 이내만 허용
    if (atkPiece.type === 'shadowAssassin') {
      if (Math.abs(tCol - atkPiece.col) > 1 || Math.abs(tRow - atkPiece.row) > 1) {
        socket.emit('err', { msg: '주변 9칸 중에서만 선택 가능합니다.' }); return;
      }
    }

    const bounds = room.boardBounds;
    const extra = {
      tCol, tRow,
      toggleState: atkPiece.toggleState,
      rats: room.rats[idx],
    };

    // ★ 쌍둥이 동시 공격: 형+동생 공격 범위 합산
    // ★ 본체 공격 범위 1회만 계산 — 이전: 아래 processAttack/필터에서 동일 인자로 매번 재계산
    //   (특히 filter 내부 .some() 은 twinCell 개수만큼 반복 호출됨).
    const baseAtkCells = getAttackCells(atkPiece.type, atkPiece.col, atkPiece.row, bounds, extra);
    let atkCells = baseAtkCells.slice();  // 쌍둥이 합산용 (아래에서 push 되므로 baseAtkCells 보존 위해 복사)
    let twinAtkPiece = null;
    if (atkPiece.subUnit) {
      const otherSub = atkPiece.subUnit === 'elder' ? 'younger' : 'elder';
      twinAtkPiece = attacker.pieces.find(p => p.subUnit === otherSub && p.alive);
      if (twinAtkPiece) {
        const twinCells = getAttackCells(twinAtkPiece.type, twinAtkPiece.col, twinAtkPiece.row, bounds, extra);
        // 중복 제거하여 합산
        for (const tc of twinCells) {
          if (!atkCells.some(c => c.col === tc.col && c.row === tc.row)) {
            atkCells.push(tc);
          }
        }
      }
    }

    // ★ 사망 기폭 페이즈 시작 — processAttack 안 handleDeath 가 화약상 죽이면 큐에 push.
    //   handler 끝의 flushPhase 가 cast/intro/bomb_detonated emit 들 시간차로 스케줄링.
    startPhase(room);

    // 본체 공격 처리 — ★ suppressSpUpdate: 공격 애니 재생 전에 SP 바가 바뀌는 것 방지
    // ★ 유해 카운트 dedupe (합류 쌍둥이 협공 버그): 공격 *시작 전* 유해 스냅샷 + 이미-타격 집합을
    //   본체/쌍둥이/겹침 3개 processAttack 호출이 공유 → 한 공격 액션에서 같은 유해는 1회만 카운트.
    //   (이전엔 겹침 패스가 본체 패스로 막 생성된 유해까지 +1 → 유해가 즉시 1데미지 더 받던 버그.)
    const _atkOpts = {
      suppressSpUpdate: true,
      preRemainsOverride: new Set((room.remains || []).map(r => `${r.col},${r.row}`)),
      remainsAlreadyHit: new Set(),
    };
    const hitResults = processAttack(room, idx, atkPiece, baseAtkCells.slice(), undefined, _atkOpts);
    // 쌍둥이 다른 쪽 공격 처리 (겹치는 셀은 이미 본체에서 처리됨 — 중복 피해 방지)
    if (twinAtkPiece) {
      const twinCells = getAttackCells(twinAtkPiece.type, twinAtkPiece.col, twinAtkPiece.row, bounds, extra);
      const twinOnlyCells = twinCells.filter(tc => !baseAtkCells.some(c => c.col === tc.col && c.row === tc.row));
      const twinHits = processAttack(room, idx, twinAtkPiece, twinOnlyCells, undefined, _atkOpts);
      hitResults.push(...twinHits);
      // 겹치는 셀은 두 번 공격 (형과 동생 각각 피해)
      const overlapCells = twinCells.filter(tc => baseAtkCells.some(c => c.col === tc.col && c.row === tc.row));
      if (overlapCells.length > 0) {
        const overlapHits = processAttack(room, idx, twinAtkPiece, overlapCells, undefined, _atkOpts);
        hitResults.push(...overlapHits);
      }
    }

    // 각 셀별로 모든 hit를 보존 (쌍둥이 중첩 공격 시 같은 셀에 2개의 hit 가능)
    const cellResults = [];
    for (const cell of atkCells) {
      const cellHits = hitResults.filter(h => h.col === cell.col && h.row === cell.row);
      if (cellHits.length === 0) {
        cellResults.push({ col: cell.col, row: cell.row, hit: false, damage: 0, destroyed: false });
      } else {
        for (const hit of cellHits) {
          cellResults.push({
            col: cell.col, row: cell.row, hit: true,
            damage: hit.damage, destroyed: hit.destroyed,
            revealedType: hit.revealedType, revealedName: hit.revealedName, revealedIcon: hit.revealedIcon,
            hitName: hit.hitName, hitIcon: hit.hitIcon,
            defPieceIdx: hit.defPieceIdx,
            defOwnerIdx: hit.defOwnerIdx,
            attackerSub: hit.attackerSub, attackerName: hit.attackerName, attackerIcon: hit.attackerIcon,
            // 호위무사 가로채기 플래그 — 클라이언트 토스트/애니메이션 분기용
            redirectedToBodyguard: hit.redirectedToBodyguard || false,
            bodyguardRedirect: hit.bodyguardRedirect || false,
          });
        }
      }
    }
    // ★ 호위무사 가로채기 hit — 보드 좌표는 공격자에게 노출하면 안 되므로
    //   cellResults 에는 bodyguardRedirect 히트를 추가하지 않는다.
    //   대신 bodyguardHits 필드로 defPieceIdx/damage 만 전달 → 프로필 충성 도장 + 피격 애니용.
    const bodyguardHits = hitResults.filter(h => h.bodyguardRedirect).map(h => ({
      defPieceIdx: h.defPieceIdx,
      defOwnerIdx: h.defOwnerIdx,
      damage: h.damage,
      destroyed: h.destroyed,
    }));
    // ★ 사용자 요청: 학살영웅 / 쥐 격파 등 어떤 종류의 피격 임팩트가 있었으면 빗나감 토스트 X.
    //   - 학살영웅 friendly fire (room._attackerFriendlyFireCount > 0)
    //   - 학살영웅 자기쥐 격파 (room._attackerOwnRatsDestroyedCount > 0)
    //   - 적쥐 격파 (room._destroyedEnemyRatsCount > 0)
    //   클라가 빗나감 토스트 출력 여부 판단할 때 anyHit 와 함께 참조.
    const attackerImpactedAnything =
      hitResults.length > 0 ||
      (room._attackerFriendlyFireCount || 0) > 0 ||
      (room._attackerOwnRatsDestroyedCount || 0) > 0 ||
      (room._destroyedEnemyRatsCount || 0) > 0;
    if (room.mode === 'team') {
      // 팀전: attack_result에 단일 oppPieces는 의미 없음 (team_game_update로 전체 동기)
      socket.emit('attack_result', {
        pieceIdx, cellResults, anyHit: hitResults.length > 0,
        attackerImpactedAnything,
        yourPieces: pieceSummary(player.pieces),
        friendlyFireHits: room._friendlyFireHits || [],
        bodyguardHits,
      });
      // being_attacked를 실제 피격된 각 적 플레이어에게 각각 전송
      const defenderHitsByOwner = new Map();
      for (const h of hitResults) {
        if (h.defOwnerIdx === undefined) continue;
        if (!defenderHitsByOwner.has(h.defOwnerIdx)) defenderHitsByOwner.set(h.defOwnerIdx, []);
        defenderHitsByOwner.get(h.defOwnerIdx).push(h);
      }
      for (const [ownerIdx, hits] of defenderHitsByOwner.entries()) {
        const defPlayer = room.players[ownerIdx];
        if (!defPlayer || !defPlayer.socketId || defPlayer.socketId === 'AI') continue;
        io.to(defPlayer.socketId).emit('being_attacked', {
          atkCells,
          attackerImpactedAnything,
          friendlyFireHits: room._friendlyFireHits || [],   // ★ #6 적(공격자) 오사 피해 실시간 공유
          hitPieces: hits.map(h => {
            // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
            const dp = (typeof h.defPieceIdx === 'number') ? defPlayer.pieces[h.defPieceIdx] : null;
            return {
              col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx,
            };
          }),
          yourPieces: pieceSummary(defPlayer.pieces),
        });
      }
      // ★ 사용자 보고 (fog-of-war 복원): 빗나감 시 적팀에 emit 금지.
      //   pure miss (impact 0) 인데 atkCells 가 적에게 노출되면 공격 범위가 누출됨.
      //   attackerImpactedAnything (학살영웅 friendly fire / 자기쥐 격파 등) 시에만 emit.
      if (attackerImpactedAnything) {
        const enemyIdxs = getEnemyIndices(room, idx);
        for (const enIdx of enemyIdxs) {
          if (defenderHitsByOwner.has(enIdx)) continue;
          const en = room.players[enIdx];
          if (!en || !en.socketId || en.socketId === 'AI') continue;
          io.to(en.socketId).emit('being_attacked', {
            atkCells,
            attackerImpactedAnything,
            hitPieces: [],
            friendlyFireHits: room._friendlyFireHits || [],   // ★ #6 적 오사 피해 실시간 공유
            yourPieces: pieceSummary(en.pieces),
          });
        }
      }
      // 팀원 피격 알림 — 같은 팀의 다른 멤버에게 애니메이션용 이벤트
      // hitPieces / 페이로드는 victim 당 1회 빌드 후 ally 들에게 재사용 (이전엔 ally 수만큼 .map 반복).
      for (const [defOwnerIdx, hits] of defenderHitsByOwner.entries()) {
        const allyIdxs = getAllyIndices(room, defOwnerIdx).filter(i => i !== defOwnerIdx);
        if (allyIdxs.length === 0) continue;
        const defPieces = room.players[defOwnerIdx].pieces;
        const _hitPieces = hits.map(h => {
          // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
          const dp = (typeof h.defPieceIdx === 'number') ? defPieces[h.defPieceIdx] : null;
          return {
            col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
            name: dp?.name, icon: dp?.icon,
            defPieceIdx: h.defPieceIdx,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false,
          };
        });
        const _allyHitPayload = {
          atkCells,
          victimIdx: defOwnerIdx,
          victimName: room.players[defOwnerIdx].name,
          hitPieces: _hitPieces,
        };
        for (const allyIdx of allyIdxs) {
          const ally = room.players[allyIdx];
          if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
          io.to(ally.socketId).emit('team_ally_hit', _allyHitPayload);
        }
      }
      // ★ 사용자 보고: 시전자 팀의 다른 멤버가 "우리팀이 공격했다"는 알림을 못 받았음.
      //   같은 팀의 ALLY (시전자 본인 제외) 에게 team_ally_attacked emit — 로그/토스트/애니메이션용.
      const casterAllyIdxs = getAllyIndices(room, idx).filter(i => i !== idx);
      if (casterAllyIdxs.length > 0) {
        const _attackedPayload = {
          casterIdx: idx,
          casterName: player.name,
          atkPieceType: atkPiece.type,
          atkPieceIcon: atkPiece.icon,
          atkPieceName: atkPiece.name,
          // ★ FIX (팀원 공격 모션 부재): 공격자 위치/subUnit — ally 가 공격자 칸에 공격 GIF 재생용.
          atkCol: atkPiece.col,
          atkRow: atkPiece.row,
          atkPieceSubUnit: atkPiece.subUnit || null,
          atkCells,
          attackerImpactedAnything,
          // hits 요약 — 어떤 적을 어디서 맞췄는지 ally 측이 셀 흔들림 + 로그용
          hits: hitResults.map(h => ({
            col: h.col, row: h.row, damage: h.damage, destroyed: h.destroyed,
            defOwnerIdx: h.defOwnerIdx, defPieceIdx: h.defPieceIdx,
            hitName: h.hitName, hitIcon: h.hitIcon,
            redirectedToBodyguard: h.redirectedToBodyguard || false,
            bodyguardRedirect: h.bodyguardRedirect || false,
          })),
          // ★ FIX (팀원 공격 — 아군 오사 데미지 도장): 학살영웅 등 betrayer 오사로 피격된 아군 정보.
          friendlyFireHits: (room._friendlyFireHits || []).map(ff => ({
            col: ff.col, row: ff.row, damage: ff.damage, destroyed: ff.destroyed,
            defOwnerIdx: ff.ownerIdx, defPieceIdx: ff.defPieceIdx,
          })),
        };
        for (const aIdx of casterAllyIdxs) {
          const ally = room.players[aIdx];
          if (!ally || !ally.socketId || ally.socketId === 'AI') continue;
          io.to(ally.socketId).emit('team_ally_attacked', _attackedPayload);
        }
      }
    } else {
      socket.emit('attack_result', {
        pieceIdx, cellResults, anyHit: hitResults.length > 0,
        attackerImpactedAnything,
        oppPieces: oppPieceSummary(defender.pieces),
        yourPieces: pieceSummary(player.pieces),
        friendlyFireHits: room._friendlyFireHits || [],
        bodyguardHits,
      });
      if (defender.socketId !== 'AI') {
        io.to(defender.socketId).emit('being_attacked', {
          atkCells,
          attackerImpactedAnything,
          friendlyFireHits: room._friendlyFireHits || [],   // ★ #6 적(공격자) 오사 피해 실시간 공유
          hitPieces: hitResults.map(h => {
            // ★ 합류 쌍둥이 — defPieceIdx 로 정확한 piece 매핑.
            const dp = (typeof h.defPieceIdx === 'number') ? defender.pieces[h.defPieceIdx] : null;
            return {
              col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
              name: dp?.name, icon: dp?.icon,
              redirectedToBodyguard: h.redirectedToBodyguard || false,
              bodyguardRedirect: h.bodyguardRedirect || false,
              defPieceIdx: h.defPieceIdx,
            };
          }),
          yourPieces: pieceSummary(defender.pieces),
        });
      }
    }
    // 사이드채널 정리
    room._attackerFriendlyFireCount = 0;
    room._attackerOwnRatsDestroyedCount = 0;
    room._destroyedEnemyRatsCount = 0;
    room._friendlyFireHits = [];

    // ★ 관전자 일반 공격 애니메이션 — 셀 hit 번쩍임 + 카드 hit flash + 본체 도장.
    //   defOwnerIdx 가 hits 에 들어있어 클라가 패널 매핑 가능.
    //   ★ FIX (관전자 공격 모션): 공격자 위치/타입 — 관전자가 공격자 칸에 공격 GIF 재생용.
    emitToSpectators(room, 'spectator_attack_anim', {
      atkCells,
      atkCol: atkPiece.col, atkRow: atkPiece.row, atkType: atkPiece.type, atkSubUnit: atkPiece.subUnit || null,
      hits: hitResults.map(h => ({
        col: h.col, row: h.row, damage: h.damage, newHp: h.newHp, destroyed: h.destroyed,
        defPieceIdx: h.defPieceIdx,
        defOwnerIdx: (h.defOwnerIdx !== undefined) ? h.defOwnerIdx : (1 - idx),
        redirectedToBodyguard: h.redirectedToBodyguard || false,
        bodyguardRedirect: h.bodyguardRedirect || false,
      })),
      friendlyFireHits: room._friendlyFireHits || [],
    });

    // ★ 표식 공격 모션 공유 — 표식된 적이 공격하면 표식 부여자(mark source)에게 공격 셀 + hit 정보 전송.
    //   mark source 가 이미 being_attacked 를 받는 경우(자기 말이 피격)에도 atkCells 는 공유하지 않으므로 별도 필요.
    const _markEffect = (atkPiece.statusEffects || []).find(e => e.type === 'mark');
    if (_markEffect && typeof _markEffect.source === 'number') {
      const _markOwnerIdx = _markEffect.source;
      // ★ 표식 부여자 *팀 전체* 에게 공유 — 같은 편이면 표식 적이 보이므로 공격 모션도 보여야 함.
      //   (이전엔 부여자 1명에게만 → 팀전에서 같은 팀 다른 멤버/피격 당사자가 모션을 못 받았음.)
      const _viewers = (room.mode === 'team') ? getAllyIndices(room, _markOwnerIdx) : [_markOwnerIdx];
      const _mePayload = {
        atkCells,
        hitCells: hitResults.map(h => ({ col: h.col, row: h.row, damage: h.damage, destroyed: h.destroyed })),
        attacker: markedAttackerMotion(atkPiece, attacker.pieces),
      };
      for (const _vIdx of _viewers) {
        if (_vIdx === idx) continue;   // 공격자 본인 제외 (이미 attack_result 수신)
        const _v = room.players[_vIdx];
        if (_v && _v.socketId && _v.socketId !== 'AI') io.to(_v.socketId).emit('marked_enemy_attack', _mePayload);
      }
    }

    // 관전자 로그: 일반 공격 (쌍둥이는 각 공격자별로 메시지 분리)
    if (hitResults.length > 0) {
      for (const h of hitResults) {
        const defOwner = (h.defOwnerIdx !== undefined) ? room.players[h.defOwnerIdx] : defender;
        const defPieces = defOwner ? defOwner.pieces : [];
        const dp = defPieces.find(p => p.col === h.col && p.row === h.row) || defPieces.find(p => !p.alive && p.hp === 0 && p.lastCol === h.col && p.lastRow === h.row);
        const targetName = (h.hitName) ? `${h.hitName}` : (dp ? `${dp.name}` : coord(h.col,h.row));
        // 실제 공격자 (쌍둥이의 경우 attackerSub로 구분)
        const atkName = h.attackerName || atkPiece.name;
        const atkIcon = h.attackerIcon || atkPiece.icon;
        emitToSpectators(room, 'spectator_log', { msg: h.destroyed
          ? `${player.name}의 ${targetName} 사망`
          : `${player.name}의 공격 명중!`, type: 'hit', playerIdx: idx });
      }
    } else {
      emitToSpectators(room, 'spectator_log', { msg: `${player.name} 공격 빗나감`, type: 'miss', playerIdx: idx });
    }

    // ★ 자동조작(서버 AI 오토파일럿) — 1v1 AI연습에서 내 팀(0) 브레인이 내 공격 hit/miss 를 학습.
    //   (헛맞은 칸 확률 감쇠 → 같은 칸 반복공격 방지 / 명중 칸 주변 hunt 강화).
    //   팀전은 아래 aiTeamLearnFromAttack 가 공격자 팀 브레인까지 처리하므로 여기선 1v1 만.
    if (room.mode !== 'team') {
      aiProcessAttackResult(getTeamBrain(room, getTeamOf(room, idx)), atkCells,
        hitResults.map(h => ({ col: h.col, row: h.row, destroyed: h.destroyed })));
    }
    // AI 피격 기억 + 공격자 위치 추론 — 공유 헬퍼로 통일 (1v1·팀전 동일 알고리즘)
    if (room.isAI && 1 - idx === 1 && room.aiBrain) {
      // 1v1: AI(1) 가 인간(0) 에게 맞음 → AI brain 이 인간 공격자 위치 추론
      aiObserveEnemyAttack(room.aiBrain, room, room.players[1].pieces, room.players[0].pieces, atkCells, hitResults);
    } else if (room.mode === 'team') {
      // 팀전: 인간이 공격 → 피격당한 AI 팀의 brain 이 공격자(인간 팀) 위치 추론.
      //   AI 가 공격하는 경우는 socket 을 안 타므로 (aiTeamExecuteAttack 에서 직접 학습) 여기 없음.
      aiTeamLearnFromAttack(room, idx, atkCells, hitResults);
    }

    // 일반(첫) 공격 종료 — actionDone 만 표시, dualBladeAttacksLeft는 건드리지 않음
    // (추가 공격 크레딧은 actionDone 분기 안의 두 번째 공격 처리에서만 차감)
    player.actionDone = true;
    // 행동 추적
    player._lastActionType = 'attack';
    player._lastActionPieceType = atkPiece.type;
    player._lastActionSubUnit = atkPiece.subUnit || null;

    if (room.mode === 'team') {
      // 팀모드: 공격 후 전체 상태 재브로드캐스트
      broadcastTeamGameState(room);
    }
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // ★ 공격 처리 완료 — suppressed SP 업데이트 emit (공격 애니보다 먼저 SP 바 갱신 방지)
    emitSPUpdate(room);

    // ★ 승리 체크 — 사망 기폭 페이즈가 큐에 있으면 flushPhase callback 으로 지연.
    //   simultaneous_draw 케이스 (양측 동시 전멸) 도 checkGameEndAfterPhase 가 처리.
    flushPhase(room, () => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      checkGameEndAfterPhase(room);
    });

    // DON'T auto end turn - wait for 'end_turn' event
  });

  // ── 턴 종료 ──
  // ── 기권 ──
  socket.on('surrender', () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    const idx = socket.data.idx;
    // 이미 종료된 방은 무시
    if (room.phase === 'ended' || room.phase === 'waiting') return;

    // ── 팀전: 한 명 기권 = 팀 즉시 패배 ──
    if (room.mode === 'team') {
      const teamSetupPhases = ['team_draft', 'team_hp', 'team_reveal', 'team_placement'];
      const surrenderedTeam = room.players[idx]?.teamId;
      if (surrenderedTeam === undefined || surrenderedTeam === null) return;
      const winnerTeamId = 1 - surrenderedTeam;
      if (room.phase === 'game' || teamSetupPhases.includes(room.phase)) {
        emitToSpectators(room, 'spectator_log', { msg: `🏳 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 기권했습니다! ${surrenderedTeam === 0 ? '블루' : '레드'}팀 패배.`, type: 'system', playerIdx: idx });
        endTeamGame(room, winnerTeamId, 'surrender');
      }
      return;
    }

    // 세팅 단계(초기공개/교환/최종공개/HP/배치)에서 나가기 — 상대 승리.
    // 사용자 요청: 게임 시작 전 이탈은 그리드 화면 출력 안 함, 해골 화면(=기권 처리)으로 송출.
    const setupPhases = ['initial_reveal','exchange_draft','final_reveal','hp_distribution','placement'];
    if (setupPhases.includes(room.phase)) {
      emitToSpectators(room, 'spectator_log', { msg: `🚪 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 게임을 나갔습니다.`, type: 'system', playerIdx: idx });
      endGame(room, 1 - idx, 'surrender');  // surrender 처리 → 해골 화면 + 그리드 미노출
      return;
    }
    // 게임 중 기권 — 본인 턴이 아니어도 언제든지 항복 가능
    if (room.phase !== 'game') return;
    emitToSpectators(room, 'spectator_log', { msg: `🏳 ${room.players[idx].name}${조사(room.players[idx].name, '이', '가')} 기권했습니다!`, type: 'system', playerIdx: idx });
    endGame(room, 1 - idx, 'surrender');
  });

  socket.on('end_turn', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.players[idx] && room.players[idx]._reconnecting) { socket.emit('err', { msg: '재접속 처리 중입니다.' }); return; }
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }
    // ★ 폭발 체인/표식 페이즈 처리 중 end_turn 차단 — 타이머로 예약된 bomb_detonated emit 들이
    //   다음 턴에 잘못 발동되는 현상(상태 desync) 방지.
    if (room._phaseDeferredGameEndCheck) {
      socket.emit('err', { msg: '효과 처리 중입니다. 잠시 후 다시 시도하세요.' }); return;
    }
    // ★ 트랩 지연 발동 중 end_turn 차단 — 700ms setTimeout 트랩이 완료되기 전 턴 종료 방지
    if (room._trapPending) {
      socket.emit('err', { msg: '트랩 처리 중입니다. 잠시 후 다시 시도하세요.' }); return;
    }

    // Allow ending turn even without action (player may choose to only use free skills)
    // (쌍둥이 첫 이동만 하고 턴 종료한 경우 보류된 opp_moved 는 endTurn 안에서 flush)
    endTurn(room);
  });

  // ── 쌍둥이 누나 이동 넘기기 (스택 시) ──
  socket.on('skip_twin_move', ({ subUnit }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }
    const player = room.players[idx];
    if (!subUnit || (subUnit !== 'elder' && subUnit !== 'younger')) return;
    if (!player.twinMovedSubs) player.twinMovedSubs = [];
    if (player.twinMovedSubs.includes(subUnit)) return;
    player.twinMovedSubs.push(subUnit);
    // 행동 자체는 소비되지 않음 — 단지 해당 쌍둥이의 이동만 컨펌으로 스킵
    player._twinSkipConfirmed = true;
    socket.emit('twin_skip_ok', {
      subUnit,
      twinMovedSubs: [...player.twinMovedSubs],
    });
  });

  // ── 스킬 사용 ──
  socket.on('use_skill', ({ pieceIdx, skillId, params }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    // ★ 사망 기폭 페이즈 시작 — executeSkill 안 handleDeath 가 화약상 죽이면 큐에 push.
    //   handler 끝의 flushPhase 가 cast/bomb_detonated 시간차 스케줄링 + 게임종료 검사 지연.
    startPhase(room);

    const result = executeSkill(room, idx, pieceIdx, skillId, params || {});
    if (!result.ok) {
      socket.emit('err', { msg: result.msg });
      // ★ FIX #26: 스킬 실패 시 startPhase가 열어 둔 _currentPhase를 flushPhase로 정리
      //   정리 안 하면 다음 startPhase 호출까지 stale phase가 남아 queueDeathDetonation 오동작 가능
      flushPhase(room, () => {});
      return;
    }

    const skillPiece = room.players[idx].pieces[pieceIdx];

    if (room.mode === 'team') {
      // 팀모드: 시전자에게 skill_result 먼저
      socket.emit('skill_result', {
        msg: result.skipLog ? '' : result.msg,
        data: result.data,
        success: true,
        effects: result.data,
        yourPieces: pieceSummary(room.players[idx].pieces),
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardObjects: boardObjectsSummary(room, idx),
        remains: room.remains || [],
        actionDone: room.players[idx].actionDone,
        actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
        skillsUsed: room.players[idx].skillsUsedBeforeAction,
        casterPieceIdx: pieceIdx,
      });
      // 시전자 외 모두에게 skill 알림 — 반드시 broadcastTeamGameState 보다 먼저 보냄.
      // 그렇지 않으면 team_game_update 가 먼저 도착해 S.sp 가 NEW 값으로 갱신되고,
      // 후속 team_skill_notice 핸들러의 oldSpSnap=newSp 가 되어 마법구 delta=0 으로 무동작이 됨.
      // 상수 부분 1회 빌드 후 재사용 — 루프 내 객체 생성 비용 감축.
      const _casterTeamId = room.players[idx].teamId;
      const _explicitAlly = (result.allyMsg !== undefined) ? result.allyMsg : (result.msg || null);
      const _explicitOpp  = (result.oppMsg  !== undefined) ? result.oppMsg  : (result.msg || null);
      const _baseNotice = {
        casterIdx: idx,
        casterName: room.players[idx].name,
        casterTeamId: _casterTeamId,
        casterPieceIdx: pieceIdx,
        sp: room.sp,
        instantSp: room.instantSp,
        skillUsed: {
          icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName,
        },
        // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용. defOwnerIdx + defPieceIdx 포함.
        hits: result.data?.hits || null,
        // ★ 저주 부여 정보 — 클라가 turn-bright 적용용 (사용자 요청).
        cursedPieceIdx: result.data?.cursedPieceIdx,
        cursedOwnerIdx: result.data?.cursedOwnerIdx,
        // ★ 유황범람 borderCells — 라바 애니 적용용 (사용자 요청).
        borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
        // ★ 회복 애니메이션 — { ownerIdx, pieceIdx } 페어로 모든 회복 대상 (팀모드 팀원 포함)
        healedPieces: result.data?.healedPieces || null,
        // ★ 분신 비행 — 모든 비시전자에게 좌표 전달. 클라가 같은 팀이면 표시, 적팀이면 무시.
        twinJoin: result.data?.twinJoin || null,
        // ★ 절대복종 반지 순간이동 — 좌표 + 피해자 정보 전달.
        ringTeleport: result.data?.ringTeleport || null,
        // ★ 약초학 / 신성 시전 — 보드 애니용 좌표. 클라가 같은 팀일 때만 표시.
        herbCenter: result.data?.herbCenter || null,
        divineTarget: result.data?.divineTarget || null,
        // ★ 악몽 시전 — 표식 적 셀 보라 펄스 + scale (적/팀원/관전자 모두 표시)
        nightmareCells: result.data?.nightmareCells || null,
      };
      for (const p of room.players) {
        if (!p.socketId || p.index === idx) continue;
        const isAlly = (p.teamId === _casterTeamId);
        io.to(p.socketId).emit('team_skill_notice', {
          ..._baseNotice,
          msg: isAlly ? _explicitAlly : _explicitOpp,
        });
      }
      const specs = room.spectators || [];
      if (specs.length > 0) {
        const _specNotice = { ..._baseNotice, msg: result.oppMsg || result.msg || null };
        for (const s of specs) {
          io.to(s.socketId).emit('team_skill_notice', _specNotice);
        }
      }
      // 마지막에 전체 상태 브로드캐스트 — 모든 클라가 이미 시전자 카드/마법구 애니를 트리거한 후 도착
      broadcastTeamGameState(room);
    } else {
      // 1v1 기존 로직
      socket.emit('skill_result', {
        msg: result.skipLog ? '' : result.msg,
        data: result.data,
        success: true,
        effects: result.data,
        yourPieces: pieceSummary(room.players[idx].pieces),
        oppPieces: oppPieceSummary(room.players[1 - idx].pieces),
        sp: room.sp,
        instantSp: room.instantSp,
        skillPoints: room.sp,
        boardObjects: boardObjectsSummary(room, idx),
        remains: room.remains || [],
        actionDone: room.players[idx].actionDone,
        actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
        skillsUsed: room.players[idx].skillsUsedBeforeAction,
        casterPieceIdx: pieceIdx,           // 시전자 카드 spotlight 용
      });

      // Update opponent with skill details
      const opp = room.players[1 - idx];
      if (opp.socketId !== 'AI') {
        io.to(opp.socketId).emit('status_update', {
          oppPieces: oppPieceSummary(room.players[idx].pieces),
          yourPieces: pieceSummary(opp.pieces),
          sp: room.sp,
          instantSp: room.instantSp,
          skillPoints: room.sp,
          boardObjects: boardObjectsSummary(room, 1 - idx),
          remains: room.remains || [],
          msg: result.oppMsg || null,
          skillUsed: {
            icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName,
          },
          casterPieceIdx: pieceIdx,         // 상대 시점에서 시전자 카드 spotlight 용
          // 상대 측에서도 회복 애니메이션 — 시전자 piece 인덱스 그대로 전달 (상대 oppPieces 동일 순서)
          healedPieceIdxs: result.data?.healedPieceIdxs || null,
          // ★ 회복 애니 (newer owner-aware 형태) — { ownerIdx, pieceIdx } 페어
          healedPieces: result.data?.healedPieces || null,
          // 분신 비행 애니메이션 — fog of war 우회용 좌표 정보 (있을 때만)
          twinJoin: result.data?.twinJoin || null,
          // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 빨간 도장 / 충성 파란 도장용
          //   defPieceIdx 는 server 의 opp.pieces (= 받는 쪽의 yourPieces) 인덱스와 일치.
          hits: result.data?.hits || null,
          // ★ 유황범람 borderCells — 라바 애니 적용용 (1v1 상대 시점 누락 수정)
          borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
          // ★ 저주 부여 정보 — 1v1 상대 시점에서도 turn-bright 적용 (누락 수정)
          cursedPieceIdx: result.data?.cursedPieceIdx,
          cursedOwnerIdx: result.data?.cursedOwnerIdx,
          // ★ 절대복종 반지 — 1v1 상대 (피해자) 시점 순간이동 애니용
          ringTeleport: result.data?.ringTeleport || null,
          // ★ 악몽 시전 — 표식 적 셀 보라 펄스 (1v1 상대 시점)
          nightmareCells: result.data?.nightmareCells || null,
          // ※ herbCenter / divineTarget — 1v1 상대 (적팀) 에는 비공개 (사용자 요청).
        });
      }
    }

    // 1v1 관전자에게도 마법구 비행 + 시전자 spotlight 트리거 (팀모드는 위 team_skill_notice 가 이미 처리)
    if (room.mode !== 'team') {
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('spectator_skill_anim', {
          casterIdx: idx,
          casterName: room.players[idx].name,
          casterPieceIdx: pieceIdx,
          sp: room.sp,
          instantSp: room.instantSp,
          skillUsed: { icon: skillPiece.icon, name: skillPiece.name, skillName: skillPiece.skillName },
          // 분신 비행 애니메이션 — 좌표 정보 (있을 때만)
          twinJoin: result.data?.twinJoin || null,
          msg: result.msg || null,
          // ★ 데미지 스킬 hits — 셀 hit 애니 + 본체 도장용
          hits: result.data?.hits || null,
          // ★ 회복 애니메이션 — { ownerIdx, pieceIdx } 페어
          healedPieces: result.data?.healedPieces || null,
          // ★ 유황범람 borderCells — 라바 애니 (1v1 관전자 시점 누락 수정)
          borderCells: result.data?.borderCells || null,
      destroyedRats: result.data?.destroyedRats || [],
          // ★ 저주 부여 정보 — 1v1 관전자 시점에서도 turn-bright (누락 수정)
          cursedPieceIdx: result.data?.cursedPieceIdx,
          cursedOwnerIdx: result.data?.cursedOwnerIdx,
          // ★ 절대복종 반지 순간이동 (관전자 시점)
          ringTeleport: result.data?.ringTeleport || null,
          // ★ 악몽 시전 — 표식 적 셀 보라 펄스 (관전자 시점)
          nightmareCells: result.data?.nightmareCells || null,
          // ★ 약초학/신성 — 1v1 관전자에게 항상 공유 (관전자는 모든 정보 시각화).
          herbCenter: result.data?.herbCenter || null,
          divineTarget: result.data?.divineTarget || null,
        });
      }
    }
    // 관전자에게 상세 스킬 로그 전송
    if (!result.skipLog) {
      const specSkillMsg = buildSpectatorSkillMsg(room.players[idx].name, skillPiece, result);
      emitToSpectators(room, 'spectator_log', { msg: specSkillMsg, type: 'skill', playerIdx: idx });
    }
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));

    // ★ 사용자 요청: 절대복종반지 → 덫 발동 시퀀스 분리.
    //   ring SP cost 3 → SP_END_MS = 1240ms. 이동 visual 마무리 + breath buffer = 1500ms 후 덫 발동.
    //   이 시점에 HP 변경/사망/wizard 패시브 SP/passive_alert/trap_triggered 모두 일제히 발동.
    if (result.data && result.data.deferredKingTrap) {
      const dt = result.data.deferredKingTrap;
      setTimeout(() => {
        if (!rooms[room.id] || room.phase !== 'game') return;
        // 시점에 도달 — 피해 적용
        const victim = (room.players[dt.victimOwnerIdx]?.pieces || []).find(p => p.alive && p.col === dt.col && p.row === dt.row);
        if (!victim) return;   // 그 사이에 다른 효과로 사라졌으면 무시
        victim.hp = Math.max(0, victim.hp - dt.dmg);
        const willDie = victim.hp <= 0;
        // wizard 패시브 SP — 덫 발동과 동시에 SP 갱신 + alert 발사
        if (dt.wizardSpSlot != null) {
          room.instantSp[dt.wizardSpSlot] += 1;
          if (typeof emitSPUpdate === 'function') emitSPUpdate(room);
          emitToBoth(room, 'passive_alert', {
            type: 'wizard', playerIdx: dt.victimOwnerIdx,
            msg: `인스턴트 매직 : SP 획득`,
          });
          emitToSpectators(room, 'spectator_log', {
            msg: `인스턴트 매직 : SP 획득`, type: 'passive', playerIdx: dt.victimOwnerIdx,
          });
        }
        startPhase(room);   // 덫 사망 시 화약상 폭발 체인 큐 수용
        if (willDie) handleDeath(room, victim, dt.victimOwnerIdx);
        // 덫 발동 emit — 기존 trap_triggered 핸들러 (cast intro 700ms + fang snap 등)
        emitToBoth(room, 'trap_triggered', {
          col: dt.col, row: dt.row,
          pieceInfo: { type: dt.pieceType, name: dt.pieceName, icon: dt.pieceIcon },
          damage: dt.dmg,
          destroyed: willDie,
          newHp: victim.hp,
          victimOwnerIdx: dt.victimOwnerIdx,
          trapOwnerIdx: dt.trapOwnerIdx,
        });
        // 팀모드: 변경된 보드 상태 broadcast (사망 시 alive=false 반영)
        if (room.mode === 'team') broadcastTeamGameState(room);
        emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
        // ★ 승리 체크 — flushPhase 는 use_skill 핸들러 종료 시점에 이미 호출됐으므로
        //   여기서 직접 재검사 (deferred trap이 마지막 적 유닛을 죽인 경우)
        flushPhase(room, () => {
          if (!rooms[room.id] || room.phase !== 'game') return;
          checkGameEndAfterPhase(room);
        });
      }, 3500);  // ★ 사용자 요청: 애니메이션 종료가 이동확정 — SP_END(1240) + intro(1000) + main(~1700) ≈ 3940. 3500ms 후 트랩 발동.
    }

    // 기폭 스킬: SP_END(1) + offset 200ms = 980ms + 폭탄 애니(950ms) = ~1930ms
    // 1) 즉시 detonation_intro emit — 클라가 980ms 후 시퀀스 시작
    // 2) 1930ms 후 bomb_detonated 이벤트로 피해 적용 (클라 시퀀스 종료 시점)
    let _bombAnimEndsAt = 0;
    if (result.data && Array.isArray(result.data.deferredBombEmits)) {
      const bombList = result.data.deferredBombEmits.map(b => ({ col: b.col, row: b.row, owner: b.owner }));
      if (bombList.length > 0) {
        // emitToBoth 가 spectators 까지 포함 — 중복 emit 제거.
        emitToBoth(room, 'detonation_intro', { bombs: bombList });
        // ★ 폭발 애니 종료 시각 — 마지막 적이 폭탄으로 사망 시 게임종료 판정을 이 시점까지 지연.
        _bombAnimEndsAt = Date.now() + bombAnimDurationMs(bombList.length);
      }
      const deferred = [...result.data.deferredBombEmits];
      setTimeout(() => {
        if (!rooms[room.id] || room.phase !== 'game') return;
        for (const bd of deferred) {
          emitToBoth(room, 'bomb_detonated', bd);
        }
        // ★ 사용자 보고: 마법사 폭탄 피격 시 인스턴트 SP 즉시 반영 누락.
        //   detonateBomb({deferEmit:true}) suppressSpUpdate=true 로 호출 → bomb_detonated 직후 emit.
        if (typeof emitSPUpdate === 'function') emitSPUpdate(room);
      }, 1930);
    }

    // Check win after skill effects (모드별)
    // ★ 게임종료 검사 — 사망 기폭 페이즈 deferred 면 flushPhase callback 이 처리 (simultaneous_draw 포함).
    //   추가로 폭탄 기폭(deferredBombEmits)으로 게임이 끝나는 경우엔 폭발/사망/토스트 애니가
    //   끝난 뒤 game_over 가 가도록 checkGameEndAfterBombPhase 가 지연 처리.
    flushPhase(room, () => {
      checkGameEndAfterBombPhase(room, _bombAnimEndsAt);
    });
  });

  // ── 폭탄 기폭 ──
  socket.on('detonate_bomb', ({ bombIdx }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== 'game') return;
    const idx = socket.data.idx;
    if (room.currentPlayerIdx !== idx) { socket.emit('err', { msg: '당신의 턴이 아닙니다.' }); return; }

    const bombs = room.boardObjects[idx].filter(o => o.type === 'bomb');
    if (bombIdx < 0 || bombIdx >= bombs.length) {
      socket.emit('err', { msg: '잘못된 폭탄 인덱스입니다.' }); return;
    }

    const bomb = bombs[bombIdx];
    startPhase(room);   // 폭발 체인 사망 큐 수용
    detonateBomb(room, idx, bomb);
    room.boardObjects[idx] = room.boardObjects[idx].filter(o => !(o.type === 'bomb' && o.col === bomb.col && o.row === bomb.row));

    const skillResultPayload = {
      msg: `폭탄 기폭: ${coord(bomb.col, bomb.row)}`,
      success: true,
      yourPieces: pieceSummary(room.players[idx].pieces),
      sp: room.sp,
      instantSp: room.instantSp,
      skillPoints: room.sp,
      boardObjects: boardObjectsSummary(room, idx),
      remains: room.remains || [],
      actionDone: room.players[idx].actionDone,
      actionUsedSkillReplace: room.players[idx].actionUsedSkillReplace,
      skillsUsed: room.players[idx].skillsUsedBeforeAction,
    };
    // 1v1에서만 oppPieces 첨부 (팀전 idx 2/3이면 1-idx 가 음수 → 크래시)
    if (room.mode !== 'team') {
      skillResultPayload.oppPieces = oppPieceSummary(room.players[1 - idx].pieces);
    }
    socket.emit('skill_result', skillResultPayload);

    if (room.mode === 'team') broadcastTeamGameState(room);
    emitToSpectators(room, 'spectator_update', getSpectatorGameState(room));
    // 승리 체크는 flushPhase 콜백으로 — 폭발 체인 완전 종료 후 판정
    flushPhase(room, () => {
      if (!rooms[room.id] || room.phase !== 'game') return;
      checkGameEndAfterPhase(room);
    });
  });

  // ── 관전 가능한 방 목록 ──
  socket.on('list_rooms', () => {
    const list = [];
    for (const [id, room] of Object.entries(rooms)) {
      if (room.phase === 'game' || room.phase === 'draft' || room.phase === 'hp_distribution' || room.phase === 'reveal' || room.phase === 'placement') {
        const mode = room.isAI ? 'ai' : (room.mode === 'team' ? 'team' : '1v1');
        list.push({
          roomId: id,
          p0Name: room.players[0]?.name || '?',
          p1Name: room.players[1]?.name || '?',
          phase: room.phase,
          spectators: (room.spectators || []).length,
          turnNumber: room.turnNumber || 0,
          mode,  // 'ai' | '1v1' | 'team' — 클라 필터용
        });
      }
    }
    socket.emit('room_list', list);
  });

  // 대기 중(입장 가능) 방 목록
  socket.on('list_waiting_rooms', () => {
    const list = [];
    for (const [id, room] of Object.entries(rooms)) {
      if (room.phase !== 'waiting') continue;
      if (room.isAI) continue;
      const max = room.mode === 'team' ? 4 : 2;
      if (room.players.length >= max) continue;
      list.push({
        roomId: id,
        mode: room.mode === 'team' ? 'team' : '1v1',
        playerCount: room.players.length,
        maxPlayers: max,
        players: room.players.map(p => p.name),
      });
    }
    socket.emit('waiting_room_list', list);
  });

  // ── 채팅 ──
  socket.on('chat_msg', ({ text, scope }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    const isSpec = socket.data.isSpectator;
    let name;
    if (pIdx >= 0) {
      name = room.players[pIdx].name || (pIdx === 0 ? '플레이어1' : '플레이어2');
    } else if (isSpec) {
      const spec = (room.spectators || []).find(s => s.socketId === socket.id);
      name = spec ? spec.name : '관전자';
    } else {
      return;
    }
    const color = assignChatColor(room, socket.id);
    // 관전자는 scope 무시하고 항상 전체 채팅만 가능
    const effectiveScope = isSpec ? 'all' : (scope === 'team' ? 'team' : 'all');
    const msg = {
      sender: name, text: String(text).slice(0, 200),
      pIdx: isSpec ? -1 : pIdx, color,
      isSpectator: !!isSpec,
      scope: effectiveScope,
      teamId: pIdx >= 0 ? room.players[pIdx].teamId : null,
    };
    if (isSpec) {
      // 관전자 메시지 → 관전자끼리만
      for (const s of (room.spectators || [])) {
        io.to(s.socketId).emit('chat_msg', msg);
      }
      return;
    }
    // ── 팀 채팅 ──: 팀 내 멤버에게만
    if (effectiveScope === 'team' && room.mode === 'team') {
      const senderTeam = room.players[pIdx].teamId;
      if (senderTeam !== 0 && senderTeam !== 1) return;
      for (const tIdx of (room.teams[senderTeam] || [])) {
        const tp = room.players[tIdx];
        if (tp && tp.socketId && tp.socketId !== 'AI') {
          io.to(tp.socketId).emit('chat_msg', msg);
        }
      }
      // 팀 채팅은 관전자/상대팀에게 안 감
      return;
    }
    // ── 전체 채팅 ──: 모든 플레이어 + 관전자
    for (const p of room.players) {
      if (p.socketId !== 'AI') {
        io.to(p.socketId).emit('chat_msg', msg);
      }
    }
    for (const s of (room.spectators || [])) {
      io.to(s.socketId).emit('chat_msg', msg);
    }
  });

  // ── 연결 끊김 ──
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      // 관전자 제거
      if (socket.data.isSpectator) {
        room.spectators = (room.spectators || []).filter(s => s.socketId !== socket.id);
        return;
      }
      // ── 팀전 대기실 중 한 명 이탈 처리 ──
      if (room.mode === 'team' && room.phase === 'waiting') {
        clearTimer(room);
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (dcIdx >= 0) {
          const dcp = room.players[dcIdx];
          // 카운트다운이 진행 중이면 취소 (인원 확정 전이므로)
          if (room._teamStartTimeout) {
            clearTimeout(room._teamStartTimeout);
            room._teamStartTimeout = null;
            io.to(room.id).emit('team_countdown_cancel');
          }
          // ★ 즉시 splice 하지 말고 유예 — iPad Safari 백그라운드 전환 등 순간 끊김 시
          //   같은 자리로 재접속할 수 있게 한다. (기존엔 즉시 제거돼 재접속이 token_mismatch
          //   로 실패 → 같은 코드로 다시 들어가도 새 슬롯/꼬인 상태가 되던 문제.)
          dcp.socketId = null;
          if (dcp._waitDisconnectTimer) clearTimeout(dcp._waitDisconnectTimer);
          dcp._waitDisconnectTimer = setTimeout(() => {
            const r3 = rooms[roomId];
            if (!r3 || r3.phase !== 'waiting') return;       // 이미 시작/삭제됨
            const gi = r3.players.findIndex(p => p === dcp);
            if (gi < 0 || r3.players[gi].socketId) return;   // 이미 정리/재접속됨
            // 유예 후에도 끊겨 있으면 실제 제거 + 재인덱싱
            r3.players.splice(gi, 1);
            for (let t = 0; t < 2; t++) {
              r3.teams[t] = (r3.teams[t] || []).filter(i => i !== gi).map(i => i > gi ? i - 1 : i);
            }
            r3.players.forEach((p, i) => {
              p.index = i;
              if (p.socketId) {
                const s = io.sockets.sockets.get(p.socketId);
                if (s) s.data.idx = i;
              }
            });
            if (r3.players.length === 0) delete rooms[roomId];
            else broadcastTeamRoomState(r3);
          }, RECONNECT_GRACE_MS);
          broadcastTeamRoomState(room);  // 자리는 유지한 채 끊김 상태만 반영
          return;
        }
      }
      // ── #9: 게임/세팅 중 연결 끊김 — 30초 유예 (재접속 대기) ──
      if (room.phase !== 'waiting' && room.phase !== 'ended') {
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (dcIdx < 0) return;  // 이미 빠져나간 소켓
        const player = room.players[dcIdx];
        const dcName = player.name;

        // 소켓만 비우고 유예 타이머 설정 — 재접속 시 cancel
        player.socketId = null;
        if (player._disconnectTimer) clearTimeout(player._disconnectTimer);
        emitToSpectators(room, 'spectator_log', { msg: `${dcName} 연결 끊김`, type: 'system', playerIdx: dcIdx });
        // 상대에게도 알림 (승리 처리 아직 안 함)
        for (const p of room.players) {
          if (p.socketId && p.socketId !== 'AI') {
            io.to(p.socketId).emit('opp_disconnected_pending', { msg: `${dcName}${조사(dcName, '이', '가')} 연결이 끊겼습니다. 30초 동안 재접속을 기다립니다...`, graceMs: RECONNECT_GRACE_MS });
          }
        }

        player._disconnectTimer = setTimeout(() => {
          if (!rooms[roomId]) return;
          const r2 = rooms[roomId];
          const p2 = r2.players[dcIdx];
          if (!p2 || p2.socketId) return;  // 이미 재접속 또는 방이 바뀜
          // 재접속 안 함 → 기존 패배 처리
          emitToSpectators(r2, 'spectator_log', { msg: `🔌 ${dcName} 재접속 실패. 패배 처리.`, type: 'system', playerIdx: dcIdx });
          if (r2.mode === 'team' && (p2.teamId === 0 || p2.teamId === 1)) {
            // 팀원 1v2 속행: 살아있는 팀원이 있으면 끊긴 플레이어만 탈락 처리.
            forfeitTeamPlayerByDisconnect(r2, dcIdx, dcName);
            return;
          }
          clearTimer(r2);
          const otherIdx = 1 - dcIdx;
          const other = r2.players[otherIdx];
          if (other && other.socketId && other.socketId !== 'AI') {
            io.to(other.socketId).emit('disconnected', { msg: `${dcName} 기권패` });
          }
          emitToSpectators(r2, 'disconnected', { msg: `${dcName} 기권패` });
          r2.phase = 'ended';
        }, RECONNECT_GRACE_MS);
        return;
      }
      if (room.phase === 'waiting') {
        // ★ 1v1 대기 중 연결 끊김 — 즉시 방을 삭제하지 말고 유예(grace)를 둔다.
        //   iPad Safari 가 탭을 백그라운드로 보내면 websocket 이 수 초 내 끊기는데,
        //   기존엔 그 순간 방이 통째로 삭제돼 재접속이 room_not_found 로 실패했다.
        //   그 사이 상대가 같은 코드로 다시 들어오면 새 방이 생성되어
        //   "같은 코드인데 다른 방" 증상이 발생했다. → 유예 후에도 비어 있으면 삭제.
        const dcIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (dcIdx >= 0) {
          const dcp = room.players[dcIdx];
          dcp.socketId = null;  // 소켓만 비우고 재접속 대기
          if (dcp._waitDisconnectTimer) clearTimeout(dcp._waitDisconnectTimer);
          dcp._waitDisconnectTimer = setTimeout(() => {
            const r3 = rooms[roomId];
            if (!r3 || r3.phase !== 'waiting') return;  // 이미 게임 시작/삭제됨
            const me = r3.players[dcIdx];
            const stillGone = me && !me.socketId;          // 아직 재접속 안 함
            const anyConnected = r3.players.some(p => p.socketId && p.socketId !== 'AI');
            if (stillGone && !anyConnected) delete rooms[roomId];
          }, RECONNECT_GRACE_MS);
        } else {
          // 소켓이 플레이어 목록에 없고(이미 정리됨) 연결된 플레이어도 없으면 빈 방 삭제
          const anyConnected = room.players.some(p => p.socketId && p.socketId !== 'AI');
          if (!anyConnected) delete rooms[roomId];
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// ── Server Start ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
// ★ 직접 실행(`node server.js`) 시에만 리스닝. require 시엔 부작용 없음 → AI 셀프플레이 하니스가
//   순수 게임/AI 로직을 재사용할 수 있도록 함. (헤드리스 학습 인프라 1단계)
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CALIGO server running:`);
    console.log(`   Local: http://localhost:${PORT}`);
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   Network: http://${net.address}:${PORT}`);
        }
      }
    }
  });
}

// ★ 헤드리스 셀프플레이/테스트용 export — 순수 게임/AI 로직 재사용.
//   (소켓 emit 은 클라이언트가 없으면 무해한 no-op. 타이머 기반 페이싱은 하니스가 자체 동기 루프로 대체.)
module.exports = {
  app, server, io, rooms,
  CHARACTERS,
  getAttackCells, resolveDamage, processAttack,
  inBounds, getBorderCells, getBoardShrinkSchedule,
  handleDeath, setKillInfo, checkCurseRemoval, detectStalemateShrink,
  // ★ 헤드리스 셀프플레이용
  createRoom, createPiece, initAiBrain, getTeamBrain,
  aiTeamTakeTurn, endTurn, getNextPlayerIdx, checkWin,
  processTurnStart, getEnemyIndices, endGame,
  // ★ AI 가중치 (튜닝/학습용)
  AI_WEIGHTS_DEFAULT, getAiWeights: () => AI_WEIGHTS, setAiWeights: (w) => { AI_WEIGHTS = { ...AI_WEIGHTS_DEFAULT, ...w }; },
};
