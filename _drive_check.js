const S = require('./server.js');
const { createRoom, createPiece, executeSkill, rooms } = S;
function mkP(index, teamId, deck){ const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean); return {socketId:'AI',name:'P'+index,index,teamId,pieces,alive:true,sp:20,actionDone:false,actionUsedSkillReplace:false}; }
function setup(mode){
  const room=createRoom('dr-'+Math.random().toString(36).slice(2,7),{mode});
  room.phase='game'; room.isAI=true; room.turnNumber=5; room.currentPlayerIdx=0;
  if(mode==='team'){ room.players=[mkP(0,0,['catapult','monk','watchman']),mkP(1,0,['king','monk','watchman']),mkP(2,1,['king','monk','watchman']),mkP(3,1,['prince','monk','watchman'])]; room.teams=[[0,1],[2,3]]; room.sp=[20,20]; }
  else { room.players=[mkP(0,0,['catapult','monk','watchman']),mkP(1,1,['king','monk','watchman'])]; room.sp=[20,20]; }
  room.instantSp=[0,0]; room.players.forEach(p=>p.pieces.forEach(pc=>pc.alive=true)); rooms[room.id]=room; return room;
}
let pass=0,fail=0; const ok=(n,c,e)=>{ if(c){pass++;console.log('  ✅',n);}else{fail++;console.log('  ❌',n,e!=null?JSON.stringify(e):'');} };

console.log('== 투석기 구동 — 숨은 적 무시 검증 ==');
// 1v1: 투석기(1,1), 숨은 적 왕을 인접칸 (1,2)에 배치 → 구동 (1,2) 성공해야
let room=setup('1v1');
const cata=room.players[0].pieces[0]; cata.col=1; cata.row=1;
const enemy=room.players[1].pieces[0]; enemy.col=1; enemy.row=2; enemy.alive=true;
let r=executeSkill(room,0,0,'drive',{col:1,row:2});
ok('1v1 숨은 적 칸으로 구동 성공', r&&r.ok, r&&r.msg);
ok('1v1 투석기가 목표칸으로 이동', cata.col===1&&cata.row===2, {c:cata.col,rr:cata.row});

// 아군이 있으면 여전히 차단
room=setup('1v1'); const c2=room.players[0].pieces[0]; c2.col=2; c2.row=2;
const ally=room.players[0].pieces[1]; ally.col=2; ally.row=3; ally.alive=true;
r=executeSkill(room,0,0,'drive',{col:2,row:3});
ok('1v1 아군 칸으로 구동 차단', !(r&&r.ok), r&&r.msg);

// 팀전: 팀원 칸 차단 / 적 칸 허용
room=setup('team'); const c3=room.players[0].pieces[0]; c3.col=1; c3.row=1;
const mate=room.players[1].pieces[0]; mate.col=1; mate.row=2; mate.alive=true;
r=executeSkill(room,0,0,'drive',{col:1,row:2});
ok('팀전 팀원 칸으로 구동 차단', !(r&&r.ok), r&&r.msg);
room=setup('team'); const c4=room.players[0].pieces[0]; c4.col=3; c4.row=3;
const en=room.players[2].pieces[0]; en.col=3; en.row=4; en.alive=true;
r=executeSkill(room,0,0,'drive',{col:3,row:4});
ok('팀전 숨은 적 칸으로 구동 성공', r&&r.ok, r&&r.msg);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
