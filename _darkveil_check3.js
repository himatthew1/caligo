const S = require('./server.js');
const { createRoom, createPiece, getAttackCells, applyDarkVeil, darkVeilActive, isFaction, rooms } = S;
function mkP(index,teamId,deck){const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean);return{socketId:'AI',name:'P'+index,index,teamId,pieces,alive:true};}
const room=createRoom('dv3-'+Math.random().toString(36).slice(2,7),{mode:'1v1'});
room.phase='game';
room.players=[mkP(0,0,['spearman','ratMerchant','hookKiller']), mkP(1,1,['demonKing','monk','watchman'])];
room.players.forEach(p=>p.pieces.forEach(pc=>pc.alive=true));
const b=room.boardBounds; const size=b.max-b.min+1;
room.players[1].pieces[0].col=0; room.players[1].pieces[0].row=0; room.players[1].pieces[0].alive=true;
rooms[room.id]=room;
let pass=0,fail=0; const ok=(n,c,e)=>{if(c){pass++;console.log('  ✅',n);}else{fail++;console.log('  ❌',n,e!=null?JSON.stringify(e):'');}};
const wrap=(v)=>b.min+(((v-b.min)%size)+size)%size;
console.log('== 어둠장막 한줄 루핑 + 쥐장수 제자리 (size='+size+', active='+darkVeilActive(room)+') ==');
console.log('  · villain? spearman='+isFaction(room.players[0].pieces[0],'villain')+' ratMerchant='+isFaction(room.players[0].pieces[1],'villain')+' hookKiller='+isFaction(room.players[0].pieces[2],'villain'));

// 창병(비악인) — 세로 한줄, off=seed%size, sealed row = wrap(unitRow+off)
const spear=room.players[0].pieces[0]; spear._darkVeilSeed=2; const off=2%size;
function sealedOf(pc,c,r,extra){ const raw=getAttackCells(pc.type,c,r,b,extra||{}); const after=applyDarkVeil(room,pc,raw); return raw.filter(x=>!after.some(o=>o.col===x.col&&o.row===x.row)); }
spear.col=3; spear.row=2;
let s1=sealedOf(spear,3,2); const exp1=wrap(2+off);
ok('창병(3,2) 봉인=(3,'+exp1+') 유닛상대오프셋', s1.length===1&&s1[0].col===3&&s1[0].row===exp1, s1);
spear.col=3; spear.row=b.max;   // 최하단 → 루핑
let s2=sealedOf(spear,3,b.max); const exp2=wrap(b.max+off);
ok('창병(3,max) 봉인=(3,'+exp2+') 루핑', s2.length===1&&s2[0].row===exp2, s2);
ok('창병 봉인은 항상 1칸', getAttackCells('spearman',3,2,b,{}).length-applyDarkVeil(room,spear,getAttackCells('spearman',3,2,b,{})).length===1);

// 쥐장수·갈고리살인마 = 악인 → 어둠장막 제외(정상)
const rm=room.players[0].pieces[1]; rm.col=2; rm.row=2; rm._darkVeilSeed=5;
const rc=getAttackCells('ratMerchant',2,2,b,{rats:[{col:4,row:4}]});
ok('쥐장수(악인) 제외 — 봉인 없음', applyDarkVeil(room,rm,rc).length===rc.length, {raw:rc.length,after:applyDarkVeil(room,rm,rc).length});

// 쥐장수 비악인(이단자 가정) → 제자리 봉인
const rm2={type:'ratMerchant', tag:'royal', col:2, row:2, _darkVeilSeed:5, passives:[]};
const rc2=getAttackCells('ratMerchant',2,2,b,{rats:[{col:4,row:4}]});
const rc2After=applyDarkVeil(room,rm2,rc2);
ok('쥐장수 비악인 → 제자리(2,2) 봉인·쥐 유지', !rc2After.some(c=>c.col===2&&c.row===2)&&rc2After.some(c=>c.col===4&&c.row===4), rc2After);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
