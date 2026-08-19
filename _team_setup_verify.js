const S = require('./server.js');
const { createRoom, createPiece, initPatronBonus, initUndeadState, buildSetupAnnouncements, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
const room=createRoom('ts'+Math.random().toString(36).slice(2,6),{mode:'team'});
room.phase='game';
function pc(t){const p=createPiece(t,3,3);p.alive=true;return p;}
function pl(i,tid,pcs){return {socketId:'AI',name:'P'+i,index:i,teamId:tid,pieces:pcs};}
// team0: idx0(공주=후원자, 창병), idx1(골렘=낡은심장)
// team1: idx2(언데드=부패한영혼), idx3(마왕=어둠장막)
room.players=[
  pl(0,0,[pc('princess'),pc('spearman')]),
  pl(1,0,[pc('golem')]),
  pl(2,1,[pc('undead')]),
  pl(3,1,[pc('demonKing')]),
];
room.teams=[[0,1],[2,3]];
rooms[room.id]=room;
console.log('== 팀전 세팅 안내 + 후공 SP 검증 ==');
const before=room.players.map(p=>p.pieces.map(x=>({hp:x.hp,maxHp:x.maxHp})));
initPatronBonus(room);
initUndeadState(room);
// 후공 SP: startTeam=0 가정, otherTeam=1
const otherTeam=1;
room.instantSp[otherTeam]=Math.min(10,(room.instantSp[otherTeam]||0)+1);
ok('후공 팀(1) 인스턴트 SP +1', room.instantSp[1]===1, room.instantSp);
// 플레이 순서: 선 플레이어 idx0 부터 → [0,2,1,3] (blue0,red0,blue1,red1)
const playOrder=[0,2,1,3];
const anns=buildSetupAnnouncements(room,before,playOrder);
const keys=anns.map(a=>a.key+'@'+a.ownerIdx);
console.log('  안내:',JSON.stringify(keys));
ok('부패한영혼(언데드) 안내 존재', anns.some(a=>a.key==='rottenSoul'));
ok('낡은심장(골렘) 안내 존재', anns.some(a=>a.key==='oldHeart'));
ok('후원자(공주) 안내 존재', anns.some(a=>a.key==='patron'));
ok('어둠의장막(마왕) 안내 존재', anns.some(a=>a.key==='darkVeil'));
// 순서: 선 플레이어(0)의 안내가 idx2/1/3 보다 앞
const firstOwnerIdx=anns[0].ownerIdx;
ok('선 플레이어(0) 안내가 맨 앞', firstOwnerIdx===0, {firstOwnerIdx, order:anns.map(a=>a.ownerIdx)});
// 언데드 HP0
ok('언데드 HP 0(부패한영혼)', room.players[2].pieces[0].hp===0, room.players[2].pieces[0].hp);
// 골렘 HP -2
ok('골렘 HP 감소(낡은심장)', room.players[1].pieces[0].hp < before[1][0].hp, {before:before[1][0].hp, after:room.players[1].pieces[0].hp});
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
