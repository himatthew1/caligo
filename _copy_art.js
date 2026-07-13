const fs = require('fs');
const path = require('path');

const ART  = path.join(__dirname, 'ART');
const DEST = path.join(__dirname, 'public', 'art');
fs.mkdirSync(DEST, { recursive: true });

// [type, 폴더, 소스파일명]
const MAP = [
  // Tier 1
  ['archer',          '궁수',          '아이들_gif.gif'],
  ['spearman',        '창병',          '아이들_gif.gif'],
  ['cavalry',         '기마병',        '아이들_gif.gif'],
  ['watchman',        '파수꾼',        '아이들_gif.gif'],
  ['scout',           '척후병',        '아이들_gif.gif'],
  ['manhunter',       '인간사냥꾼',    '아이들_gif.gif'],
  ['messenger',       '전령',          '아이들_gif.gif'],
  ['gunpowder',       '화약상',        '아이들_gif.gif'],
  ['herbalist',       '약초전문가',    '아이들_gif.gif'],
  ['twins_red',       '쌍둥이 강도',   '아이들_레드_gif.gif'],
  ['twins_blue',      '쌍둥이 강도',   '아이들_블루_gif.gif'],
  ['twins_joined',    '쌍둥이 강도',   '아이들_합류_gif.gif'],
  // Tier 2
  ['general',         '장군',          '아이들_gif.gif'],
  ['knight',          '기사',          '아이들_gif.gif'],
  ['shadowAssassin',  '그림자 암살자', '아이들_gif.gif'],
  ['wizard',          '마법사',        '아이들_gif.gif'],
  ['armoredWarrior',  '갑주무사',      '아이들_gif.gif'],
  ['witch',           '마녀',          '아이들_gif.gif'],
  ['dualBlade',       '양손검객',      '아이들_gif.gif'],
  ['ratMerchant',     '쥐장수',        '아이들_gif.gif'],
  ['weaponSmith',     '무기상',        '아이들_gif.gif'],
  ['bodyguard',       '호위무사',      '아이들_gif.gif'],
  // Tier 3
  ['prince',          '왕자',          '아이들_gif.gif'],
  ['princess',        '공주',          '아이들 GIF.gif'],   // 공백+대문자 주의
  ['king',            '국왕',          '아이들_gif.gif'],
  ['dragonTamer',     '드래곤 조련사', '아이들_gif.gif'],
  ['monk',            '수도승',        '아이들_gif.gif'],
  ['slaughterHero',   '학살영웅',      '아이들_gif.gif'],
  ['commander',       '지휘관',        '아이들_gif.gif'],
  ['sulfurCauldron',  '유황이 끓는 솥','아이들_gif.gif'],
  ['torturer',        '고문기술자',    '아이들.gif'],        // 파일명 다름
  ['count',           '백작',          '아이들_gif.gif'],
  // Special
  ['dragon',          '드래곤',        '아이들_gif.gif'],
];

let ok = 0, fail = 0;
for (const [type, folder, file] of MAP) {
  const src  = path.join(ART, folder, file);
  const dest = path.join(DEST, `${type}_idle.gif`);
  if (!fs.existsSync(src)) { console.error(`MISSING: ${src}`); fail++; continue; }
  fs.copyFileSync(src, dest);
  console.log(`  ✓ ${type}_idle.gif`);
  ok++;
}
console.log(`\n완료: ${ok}개 복사, ${fail}개 실패`);
