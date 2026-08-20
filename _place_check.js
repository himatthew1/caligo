const S = require('./server.js');
const { createRoom, createPiece, aiPlacementCellScore, aiEnemyThreatProfile, getEnemyIndices, getTeammates, rooms } = S;
function mkP(index,teamId,deck){const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean);return{socketId:'AI',name:'P'+index,index,teamId,pieces,alive:true};}
const room=createRoom('pl-'+Math.random().toString(36).slice(2,7),{mode:'team'});
room.phase='team_placement'; room.players=[mkP(0,0,['spearman','archer','watchman']),mkP(1,0,['king','monk','watchman']),mkP(2,1,['king','monk','watchman']),mkP(3,1,['king','monk','watchman'])];
room.teams=[[0,1],[2,3]]; rooms[room.id]=room;
const b=room.boardBounds;
// 적/팀원 미배치(col<0), 자기(idx0) 첫 유닛을 (3,1)에 배치
room.players.forEach(p=>p.pieces.forEach(pc=>{pc.col=-1;pc.row=-1;}));
const me=room.players[0]; me.pieces[0].col=3; me.pieces[0].row=1; me.pieces[0].alive=true;
const teammates=[1];
const ctx={room,bounds:b,occupied:new Set(['3,1']),enemyAttackCells:new Set(),futureShrinkBounds:[],teamId:0,
  friendlyIdxs:[...teammates,0], teammateIdxs:teammates, enemyThreat:aiEnemyThreatProfile(room,getEnemyIndices(room,0),b)};
// 2번째 유닛(archer) 점수: (3,1) 인접칸 (3,2) vs 먼칸 (1,4) — 랜덤 제거 위해 여러번 평균
const p2=me.pieces[1];
function avg(c,r){let s=0,N=400;for(let i=0;i<N;i++)s+=aiPlacementCellScore(p2,c,r,ctx);return s/N;}
const adj=avg(3,2), far=avg(1,4);
console.log('인접칸(3,2) 평균점수:', adj.toFixed(2));
console.log('먼칸(1,4) 평균점수:', far.toFixed(2));
console.log('adjacency penalty 적용(먼칸 우선):', far > adj ? 'YES ✅' : 'NO ❌');
