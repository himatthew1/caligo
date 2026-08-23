const S = require('./server.js');
const { aiDecideExchange } = S;
let pass=0,fail=0; const ok=(n,c,e)=>{if(c){pass++;console.log('  ✅',n);}else{fail++;console.log('  ❌',n,e!=null?JSON.stringify(e):'');}};
console.log('== AI 견제픽: 공주 vs 마녀 검증 ==');
// 상대가 공주(왕실 2+) → 마녀 견제 안 나와야
const my = { t1:'spearman', t2:'general', t3:'prince' };
let witchCount=0, N=200;
for(let i=0;i<N;i++){ const s=aiDecideExchange(my, {t1:'watchman',t2:'armoredWarrior',t3:'princess'}); if(s && s.newType==='witch') witchCount++; }
console.log('  · 상대(파수꾼/갑주/공주) 200회 중 마녀 견제:', witchCount);
ok('상대 공주 → 마녀 견제 0회', witchCount===0, witchCount);
// 상대가 마녀 → 공주가 후보에 (여러번 중 등장)
let princessCount=0;
for(let i=0;i<N;i++){ const s=aiDecideExchange({t1:'archer',t2:'knight',t3:'king'}, {t1:'spearman',t2:'witch',t3:'monk'}); if(s && s.newType==='princess') princessCount++; }
console.log('  · 상대(마녀 포함) 200회 중 공주 견제:', princessCount);
ok('상대 마녀 → 공주 견제 등장', princessCount>0, princessCount);
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
