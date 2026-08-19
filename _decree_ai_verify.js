const S = require('./server.js');
const { createRoom, createPiece, aiTryDecree, initAiBrain, addStatus, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
function mk(cp,ap){const room=createRoom('dc'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
  room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[9,9];room.instantSp=[0,0];
  room.players[0]={socketId:'AI',name:'H',index:0,pieces:cp,actionDone:false,skillsUsedBeforeAction:[]};
  const ap2={socketId:'AI',name:'AI',index:1,pieces:ap,actionDone:true,actionUsedSkillReplace:false,_lastActionType:'attack',skillsUsedBeforeAction:[],_decreeUnit:null,_aiDecreeUsed:false};
  room.players[1]=ap2;
  rooms[room.id]=room; room.aiBrain=initAiBrain(9); room.aiBrain.turnCount=6;
  room.aiBrain.probMap=Array.from({length:9},()=>Array(9).fill(0));
  return room;}
console.log('== AI 칙명 확장 검증 (부대공격/추가타/믿음) ==');

// 1) 표식 없는 적을 '믿음 피크'로 추가타 — prince(가로3) 사거리에 belief 10
{ const msg=createPiece('messenger',1,3); msg.col=4;msg.row=4;msg.alive=true;
  const prince=createPiece('prince',3,3); prince.col=1;prince.row=1;prince.alive=true; // 가로3: (0,1)(1,1)(2,1)
  const enemy=createPiece('spearman',1,3); enemy.col=0;enemy.row=1;enemy.alive=true; enemy.hp=3; /* 표식 없음 */
  const room=mk([enemy],[msg,prince]);
  room.aiBrain.probMap[1][0]=10; room.aiBrain.probMap[1][2]=8;  // 믿음 피크
  const before=enemy.hp;
  const r=aiTryDecree(room);
  ok('표식 없어도 믿음 공격으로 칙명 발동', r===true && room.players[1]._aiDecreeUsed, {r,used:room.players[1]._aiDecreeUsed});
  ok('추가타로 실제 피해(적 HP 감소 or 사망)', enemy.hp<before || !enemy.alive, {before,after:enemy.hp}); }

// 2) 장군 부대공격 재사용 — 장군+공주(왕실2) + SP9 + 믿음 타겟
{ const msg=createPiece('messenger',1,3); msg.col=4;msg.row=4;msg.alive=true;
  const gen=createPiece('general',2,3); gen.col=2;gen.row=2;gen.alive=true;
  const prince=createPiece('prince',3,3); prince.col=1;prince.row=1;prince.alive=true;
  const e=createPiece('spearman',1,4); e.col=2;e.row=1;e.alive=true;  // general 상단(2,1)
  const room=mk([e],[msg,gen,prince]);
  room.aiBrain.probMap[1][2]=9; room.aiBrain.probMap[1][0]=7; room.aiBrain.probMap[1][1]=6;
  const before=e.hp;
  const r=aiTryDecree(room);
  ok('장군 부대공격 재사용으로 칙명 발동', r===true && room.players[1]._aiDecreeUsed, {r});
  ok('부대공격 SP 6 소모(칙명3+부대3)', room.sp[1]===3, {sp:room.sp[1]}); }

// 3) 좋은 공격 없음(믿음 0, 사거리 밖) → 미발동
{ const msg=createPiece('messenger',1,3); msg.col=4;msg.row=4;msg.alive=true;
  const prince=createPiece('prince',3,3); prince.col=1;prince.row=1;prince.alive=true;
  const enemy=createPiece('spearman',1,3); enemy.col=8;enemy.row=8;enemy.alive=true;
  const room=mk([enemy],[msg,prince]); // probMap 전부 0
  const r=aiTryDecree(room);
  ok('의미있는 공격 없으면 칙명 미발동', r===false && !room.players[1]._aiDecreeUsed, {r}); }

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
