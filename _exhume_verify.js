const S = require('./server.js');
const { createRoom, createPiece, executeSkill, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
function mk(){ const room=createRoom('ex'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
  room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=0;room.sp=[5,5];room.instantSp=[0,0];
  const gk=createPiece('gravekeeper',1,3); gk.col=2;gk.row=2;gk.alive=true;   // 십자(상하좌우) 사거리
  const undead=createPiece('undead',3,0); undead.col=2;undead.row=1;undead.alive=true; undead.hp=0;undead.maxHp=0;  // 사거리 내(2,1)
  room.players[0]={socketId:'s0',name:'H',index:0,pieces:[gk],actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[]};
  room.players[1]={socketId:'s1',name:'E',index:1,pieces:[undead],actionDone:false,skillsUsedBeforeAction:[]};
  rooms[room.id]=room; return {room,gk,undead}; }
console.log('== 도굴 가시성(표식) 가드 검증 ==');
// 1) 표식 안 된 적 언데드 → 거부
{ const {room,undead}=mk(); undead.statusEffects=[];
  const r=executeSkill(room,0,0,'exhume',{col:2,row:1});
  ok('표식 안 된 적 언데드 도굴 거부', !(r&&r.ok) && /표식|보이지/.test(r&&r.msg||''), r&&r.msg);
  ok('거부 시 언데드 생존', undead.alive===true); }
// 2) 표식된 적 언데드 → 허용(소멸)
{ const {room,undead}=mk(); undead.statusEffects=[{type:'mark',source:0}];
  const r=executeSkill(room,0,0,'exhume',{col:2,row:1});
  ok('표식된 적 언데드 도굴 성공', r&&r.ok, r&&r.msg);
  ok('도굴 후 언데드 소멸', undead.alive===false, undead.alive); }
// 3) 유해(remains)는 표식 무관 도굴 가능
{ const {room}=mk(); room.remains=[{col:2,row:1,type:'spearman'}];
  // 언데드 제거(유해만 남기게) — 새 방
  room.players[1].pieces=[];
  const r=executeSkill(room,0,0,'exhume',{col:2,row:1});
  ok('유해 도굴 성공(표식 무관)', r&&r.ok, r&&r.msg); }
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
