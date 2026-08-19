const S = require('./server.js');
const { createRoom, createPiece, aiTakeTurn, initAiBrain, addStatus, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
function mk(cp,ap){const room=createRoom('sr'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
  room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[5,5];room.instantSp=[0,0];
  room.players[0]={socketId:'AI',name:'H',index:0,pieces:cp,actionDone:false,skillsUsedBeforeAction:[]};
  room.players[1]={socketId:'AI',name:'AI',index:1,pieces:ap,actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[],_decreeUnit:null};
  rooms[room.id]=room; room.aiBrain=initAiBrain(9); room.aiBrain.turnCount=6; return room;}
console.log('== AI 인어 사이렌 송 검증 ==');
// 1) 표식된 적 hp=0.5 → 사이렌 송으로 처치
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const enemy=createPiece('spearman',1,3); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=0.5;
  addStatus(enemy,'mark',{data:{source:1}});
  const room=mk([enemy],[merm]);
  aiTakeTurn(room);
  ok('표식 적(0.5HP)을 사이렌 송으로 처치', !enemy.alive, {hp:enemy.hp,alive:enemy.alive}); }
// 2) 아군도 0.5면(순이득 아님) 미시전 — 적 0.5 1명 + 아군 0.5 1명 → enemyKills(1) > selfKills(1) false
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const ally=createPiece('watchman',1,3); ally.col=3;ally.row=3;ally.alive=true; ally.hp=0.5;
  const enemy=createPiece('spearman',1,3); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=0.5; addStatus(enemy,'mark',{data:{source:1}});
  const room=mk([enemy],[merm,ally]);
  aiTakeTurn(room);
  ok('아군도 죽는 상황이면 사이렌 송 보류(아군 생존)', ally.alive, {allyHp:ally.hp}); }
// 3) 표식 적이 고HP뿐이면 미시전(처치 없음)
{ const merm=createPiece('mermaid',1,3); merm.col=4;merm.row=4;merm.alive=true;
  const enemy=createPiece('spearman',1,4); enemy.col=0;enemy.row=0;enemy.alive=true; enemy.hp=4; addStatus(enemy,'mark',{data:{source:1}});
  const room=mk([enemy],[merm]);
  const before=enemy.hp; aiTakeTurn(room);
  ok('처치 불가(고HP)면 사이렌 송 미시전(적 HP 유지)', enemy.hp===before, {before,after:enemy.hp}); }
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
