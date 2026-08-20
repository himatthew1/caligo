const S = require('./server.js');
const { createRoom, createPiece, getAttackCells, rooms } = S;
// applyDarkVeil not exported? check
const av = S.applyDarkVeil;
function mkP(index,teamId,deck){const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean);return{socketId:'AI',name:'P'+index,index,teamId,pieces,alive:true};}
const room=createRoom('dv-'+Math.random().toString(36).slice(2,7),{mode:'1v1'});
room.phase='game';
// me: catapult(+spearman for multi-cell). enemy: demonKing (dark veil source)
room.players=[mkP(0,0,['catapult','spearman','prince']), mkP(1,1,['demonKing','monk','watchman'])];
room.players.forEach(p=>p.pieces.forEach(pc=>pc.alive=true));
const b=room.boardBounds;
const cata=room.players[0].pieces[0]; cata.col=1; cata.row=1; cata._darkVeilSeed=7;
const spear=room.players[0].pieces[1]; spear.col=2; spear.row=2; spear._darkVeilSeed=7;
const dk=room.players[1].pieces[0]; dk.col=4; dk.row=4; dk.alive=true;
rooms[room.id]=room;

let pass=0,fail=0; const ok=(n,c,e)=>{if(c){pass++;console.log('  ✅',n);}else{fail++;console.log('  ❌',n,e!=null?JSON.stringify(e):'');}};
console.log('== 어둠의 장막 vs 투석기(단일 셀) 검증 ==');
console.log('  · applyDarkVeil exported:', typeof av);
// darkVeilActive?
const dva = S.darkVeilActive ? S.darkVeilActive(room) : '(not exported)';
console.log('  · darkVeilActive:', dva);

if (typeof av === 'function') {
  // catapult single cell
  const cCells = getAttackCells('catapult', cata.col, cata.row, b, {tCol:4,tRow:4});
  console.log('  · catapult raw cells:', JSON.stringify(cCells));
  const cAfter = av(room, cata, cCells);
  console.log('  · catapult after darkVeil:', JSON.stringify(cAfter));
  ok('투석기 단일 셀 보존(빗나감 X)', cAfter.length === 1 && cAfter[0].col===4 && cAfter[0].row===4, cAfter);
  // spearman multi-cell (vertical column) still loses 1
  const sCells = getAttackCells('spearman', spear.col, spear.row, b, {});
  const sAfter = av(room, spear, sCells);
  console.log('  · spearman raw:', sCells.length, 'after:', sAfter.length);
  ok('다중 셀 공격은 여전히 1칸 봉인', sAfter.length === sCells.length - 1, {raw:sCells.length,after:sAfter.length});
} else {
  console.log('  applyDarkVeil not exported — testing via processAttack path');
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
