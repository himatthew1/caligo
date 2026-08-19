const S = require('./server.js');
const { createRoom, createPiece, processAttack, getAttackCells, rooms } = S;
function mkP(index, teamId, deck){ const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean); return {socketId:'AI',name:'P'+index,index,teamId,pieces,alive:true,sp:20,actionDone:false}; }
const room = createRoom('cc-'+Math.random().toString(36).slice(2,7),{mode:'team'});
room.phase='game'; room.isAI=true; room.turnNumber=5; room.currentPlayerIdx=0;
room.players=[mkP(0,0,['catapult','monk','watchman']), mkP(1,0,['king','monk','watchman']), mkP(2,1,['king','monk','watchman']), mkP(3,1,['prince','monk','watchman'])];
room.teams=[[0,1],[2,3]]; room.sp=[20,20]; room.instantSp=[0,0]; rooms[room.id]=room;
const b=room.boardBounds; console.log('bounds', b);
// 배치
room.players.forEach(p=>p.pieces.forEach(pc=>{pc.alive=true;}));
const cata=room.players[0].pieces[0]; cata.col=1; cata.row=1;
// 적(team1) 왕을 (4,4)에 두고 투석기로 (4,4) 공격
const enemyKing=room.players[2].pieces[0]; enemyKing.col=4; enemyKing.row=4; enemyKing.hp=3;
const extra={tCol:4,tRow:4, toggleState:cata.toggleState};
const cells=getAttackCells(cata.type, cata.col, cata.row, b, extra);
console.log('catapult atkCells for (4,4):', JSON.stringify(cells));
const hits=processAttack(room,0,cata,cells,undefined,{suppressSpUpdate:true});
console.log('hits:', JSON.stringify(hits.map(h=>({col:h.col,row:h.row,dmg:h.damage,defOwner:h.defOwnerIdx,defIdx:h.defPieceIdx}))));
console.log('anyHit(hits.length>0):', hits.length>0);
console.log('enemyKing hp after:', enemyKing.hp);
