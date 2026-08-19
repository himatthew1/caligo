const S = require('./server.js');
const { createRoom, createPiece, doCavalryDash, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
const room=createRoom('dt'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[5,5];room.instantSp=[0,0];
// human(0): 요정(정령) + 오베론(정령, faeKing) + 그리폰(정령, rage)
const fairy=createPiece('fairy',1,3); fairy.col=2;fairy.row=2;fairy.alive=true;
const griffin=createPiece('griffin',2,3); griffin.col=2;griffin.row=1;griffin.alive=true; griffin._rageActive=false;
const oberon=createPiece('oberon',3,3); oberon.col=5;oberon.row=5;oberon.alive=true; oberon._oberonCounter=0;
room.players[0]={socketId:'AI',name:'H',index:0,pieces:[fairy,griffin,oberon],actionDone:false,skillsUsedBeforeAction:[]};
// AI(1): 기마병 (2,3) → 질주 (2,1): 경로 (2,3)(2,2)(2,1) → 요정·그리폰 피격
const cav=createPiece('cavalry',1,3); cav.col=2;cav.row=3;cav.alive=true;
room.players[1]={socketId:'AI',name:'AI',index:1,pieces:[cav],actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[]};
rooms[room.id]=room;
console.log('== 질주 피격 트리거(오베론 카운터·그리폰 격노) 검증 ==');
const before={counter:oberon._oberonCounter, rage:griffin._rageActive};
const r=doCavalryDash(room,1,0,2,1);
ok('질주 성공', r&&r.ok, r&&r.msg);
ok('질주가 요정·그리폰 명중', (r.hits||[]).length>=2, (r.hits||[]).map(h=>({c:h.col,r:h.row,dmg:h.damage})));
ok('요정 피격 → 오베론 카운터 증가', oberon._oberonCounter > before.counter, {before:before.counter, after:oberon._oberonCounter});
ok('그리폰 피격 → 격노 활성', griffin._rageActive===true, {before:before.rage, after:griffin._rageActive});
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
