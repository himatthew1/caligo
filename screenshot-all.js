// 모든 화면 스크린샷 자동 캡처 → ./screenshots/*.png
// 실행: node screenshot-all.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:3000/';
const OUT_DIR = path.join(__dirname, 'screenshots');

// 캡처할 화면 순서 + 진입 루트 (lobby에서 직접 showScreen으로 강제 표시)
const SCREENS = [
  { id: 'screen-lobby',            label: '01-로비' },
  { id: 'screen-tutorial',         label: '02-튜토리얼' },
  { id: 'screen-waiting',          label: '03-1v1-대기' },
  { id: 'screen-team-waiting',     label: '04-2v2-팀대기실' },
  { id: 'screen-draft',            label: '05-1v1-일반드래프트' },
  { id: 'screen-team-draft',       label: '06-2v2-팀드래프트' },
  { id: 'screen-team-hp',          label: '07-2v2-HP분배' },
  { id: 'screen-team-placement',   label: '08-2v2-말배치' },
  { id: 'screen-team-reveal',      label: '09-2v2-전원공개' },
  { id: 'screen-initial-reveal',   label: '10-1v1-초기공개' },
  { id: 'screen-exchange',         label: '11-1v1-교환드래프트' },
  { id: 'screen-final-reveal',     label: '12-1v1-최종공개' },
  { id: 'screen-hp',               label: '13-1v1-HP분배' },
  { id: 'screen-reveal',           label: '14-1v1-공용공개' },
  { id: 'screen-placement',        label: '15-1v1-말배치' },
  { id: 'screen-game',             label: '16-게임-플레이' },
  { id: 'screen-gameover',         label: '17-게임오버' },
];

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1280, height: 800 },
  });

  // 1) AI 연습 모드 실제 플레이 플로우 — 게임 화면 상태 채워서 캡처
  const pageAI = await browser.newPage();
  await pageAI.setViewport({ width: 1280, height: 800 });
  await pageAI.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(600);

  async function click(p, sel) {
    try { await p.evaluate((s) => document.querySelector(s)?.click(), sel); } catch (e) {}
  }

  // AI 연습 시작 → 각 페이즈 순서대로 캡처
  await click(pageAI, '#btn-ai');
  await sleep(1400);
  await shot(pageAI, 'game-flow-10-initial-reveal');

  await click(pageAI, '#btn-irev-confirm');
  await sleep(1600);
  await shot(pageAI, 'game-flow-11-exchange');

  await click(pageAI, '#btn-exchange-confirm');
  await sleep(500);
  await click(pageAI, '#exchange-noswap-confirm');
  await sleep(1600);
  await shot(pageAI, 'game-flow-12-final-reveal');

  await click(pageAI, '#btn-frev-confirm');
  await sleep(1600);
  await shot(pageAI, 'game-flow-13-hp');

  await pageAI.evaluate(() => {
    const plusBtns = document.querySelectorAll('.hp-btn-plus, .hp-btn.plus, button');
    for (let k = 0; k < 30; k++) for (const b of plusBtns) if (b.textContent?.trim() === '+') b.click();
  });
  await sleep(400);
  await click(pageAI, '#btn-hp-confirm');
  await sleep(1600);
  await shot(pageAI, 'game-flow-15-placement');

  await click(pageAI, '#btn-placement-auto');
  await sleep(600);
  await click(pageAI, '#btn-placement-confirm');
  await sleep(2800);
  await shot(pageAI, 'game-flow-16-game');

  await pageAI.close();

  // 2) 나머지 화면: force-show로 캡처 (빈 프레임이어도 레이아웃만 확인 가능)
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(500);

  await page.evaluate(() => {
    window._showScreen = (id) => {
      document.querySelectorAll('.screen').forEach(s => {
        s.style.display = (s.id === id) ? 'flex' : 'none';
      });
    };
  });

  for (const sc of SCREENS) {
    await page.evaluate((id) => window._showScreen(id), sc.id);
    await sleep(300);
    await shot(page, 'force-show-' + sc.label);
  }

  await browser.close();
  console.log('완료: ' + OUT_DIR);
})().catch(e => { console.error(e); process.exit(1); });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page, name) {
  const file = path.join(OUT_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  console.log('✔', file);
}
