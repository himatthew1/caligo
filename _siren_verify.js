const S = require('./server.js');
const { createRoom, createPiece, aiTakeTurn, initAiBrain, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
function mk(cp,ap){const room=createRoom('sr'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
  room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[5,5];room.instantSp=[0,0];
  room.players[0]={socketId:'AI',name:'H',index:0,pieces:cp,actionDone:false,skillsUsedBeforeAction:[]};
  room.players[1]={socketId:'AI',name:'AI',index:1,pieces:ap,actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[],_decreeUnit:null};
  rooms[room.id]=room; room.aiBrain=initAiBrain(9); room.aiBrain.turnCount=6; return room;}
console.log('== AI 인어 사이렌 송(표식 불문) 검증 ==');
// 1) 표식 없는 적 hp=0.5 → 사이렌 송으로 처치 (표식 불필요!)
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const enemy=createPiece('spearman',1,3); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=0.5; /* 표식 없음 */
  const room=mk([enemy],[merm]);
  aiTakeTurn(room);
  ok('표식 없는 적(0.5HP)도 사이렌 송으로 처치', !enemy.alive, {hp:enemy.hp,alive:enemy.alive}); }
// 2) 아군도 0.5면 순이득 아님 → 보류
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const ally=createPiece('watchman',1,3); ally.col=3;ally.row=3;ally.alive=true; ally.hp=0.5;
  const enemy=createPiece('spearman',1,3); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=0.5;
  const room=mk([enemy],[merm,ally]);
  aiTakeTurn(room);
  ok('아군도 죽으면 보류(아군 생존)', ally.alive, {allyHp:ally.hp}); }
// 3) 고HP 적만 → 미시전
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const enemy=createPiece('spearman',1,4); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=4;
  const room=mk([enemy],[merm]);
  const before=enemy.hp; aiTakeTurn(room);
  ok('처치 불가(고HP)면 미시전', enemy.hp===before, {before,after:enemy.hp}); }
// 4) 적 2명 0.5 + 아군 1명 0.5 → 2>1 순이득 → 시전(적 2 처치)
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const ally=createPiece('watchman',1,3); ally.col=3;ally.row=3;ally.alive=true; ally.hp=0.5;
  const e1=createPiece('spearman',1,3); e1.col=0;e1.row=0;e1.alive=true; e1.hp=0.5;
  const e2=createPiece('knight',2,3); e2.col=1;e2.row=1;e2.alive=true; e2.hp=0.5;
  const room=mk([e1,e2],[merm,ally]);
  aiTakeTurn(room);
  ok('적2 처치 > 아군1 손실 → 시전(적 전멸)', !e1.alive && !e2.alive, {e1:e1.alive,e2:e2.alive}); }
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
