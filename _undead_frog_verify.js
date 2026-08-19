const S = require('./server.js');
const { createRoom, createPiece, aiRunTroopAttack, aiScoreAttack, initAiBrain, aiKnownEnemies, addStatus, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
function mk(cp,ap){ const room=createRoom('uf'+Math.random().toString(36).slice(2,6),{mode:'1v1'}); room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[9,9];room.instantSp=[0,0];
  room.players[0]={socketId:'s0',name:'H',index:0,pieces:cp,actionDone:false,skillsUsedBeforeAction:[]};
  room.players[1]={socketId:'AI',name:'AI',index:1,pieces:ap,actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[],_decreeUnit:null};
  rooms[room.id]=room; room.aiBrain=initAiBrain(9); room.aiBrain.turnCount=6; return room; }
console.log('== 언데드 스코어링 + 프로그 장군 부대공격 검증 ==');

// (1) 프로그 장군 부대공격 차단
{ const gen=createPiece('general',2,3); gen.col=2;gen.row=2;gen.alive=true; addStatus(gen,'frog',{data:{source:0}});
  const prince=createPiece('prince',3,3); prince.col=2;prince.row=3;prince.alive=true;
  const e=createPiece('spearman',1,3); e.col=0;e.row=0;e.alive=true;
  const room=mk([e],[gen,prince]);
  const r=aiRunTroopAttack(room,1,0);
  ok('프로그 장군 부대공격 거부(false 반환)', r===false, r);
  ok('부대공격 미실행(SP 유지)', room.sp[1]===9, room.sp[1]); }

// (2) 언데드 스코어링 — 확인된 언데드 칸은 스코어 0
{ const undead=createPiece('undead',3,0); undead.col=1;undead.row=1;undead.alive=true;
  const room=mk([undead],[createPiece('prince',3,3)]);
  const brain=room.aiBrain;
  // 믿음맵: 언데드 칸(1,1)에만 높은 믿음
  for(let r=0;r<9;r++)for(let c=0;c<9;c++)brain.probMap[r][c]=0;
  brain.probMap[1][1]=10;
  // 언데드를 marked(위치 확인) 처리
  undead.statusEffects=[{type:'mark',source:1}];
  // 프린스를 언데드 옆(가로3 사거리로 언데드 칸 커버)에 배치
  const prince=room.players[1].pieces[0]; prince.col=1; prince.row=1; // 겹침 회피 위해 아래에서 재배치
  prince.col=0; prince.row=1;  // prince=가로3 (c-1,c,c+1,row=1) → (−1,1)(0,1)(1,1) → 언데드(1,1) 포함
  // aiKnownEnemies 가 marked 언데드를 반환하는지 확인
  const known=aiKnownEnemies(room,1).filter(e=>e.marked&&e.piece.type==='undead');
  ok('언데드 marked 인식', known.length===1 && known[0].col===1, known.map(k=>({c:k.col,r:k.row})));
  const score=aiScoreAttack(brain,prince,room,{});
  ok('언데드만 있는 칸 공격 스코어 ≈0(무가치)', score < 1, score); }

// (3) 언데드 + killable 동시 커버 시 killable 점수는 유효
{ const undead=createPiece('undead',3,0); undead.col=1;undead.row=1;undead.alive=true; undead.statusEffects=[{type:'mark',source:1}];
  const room=mk([undead],[createPiece('prince',3,3)]);
  const brain=room.aiBrain;
  for(let r=0;r<9;r++)for(let c=0;c<9;c++)brain.probMap[r][c]=0;
  brain.probMap[1][1]=10;  // 언데드 칸
  brain.probMap[1][0]=8;   // 옆 칸(killable 믿음)
  const prince=room.players[1].pieces[0]; prince.col=0; prince.row=1;  // 가로3 → (−1,1)(0,1)(1,1)
  const score=aiScoreAttack(brain,prince,room,{});
  ok('언데드+killable 동시 커버 → killable(8) 점수 유효(>3)', score > 3, score); }

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
