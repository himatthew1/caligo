const S = require('./server.js');
const { createRoom, createPiece, executeSkill, addStatus, io, rooms } = S;
// intercept io.to().emit to capture passive_alert
const alerts=[];
const origTo = io.to.bind(io);
io.to = (sid)=>{ const r=origTo(sid); const oe=r.emit.bind(r); r.emit=(ev,p)=>{ if(ev==='passive_alert') alerts.push({type:p.type,msg:p.msg,playerIdx:p.playerIdx}); return oe(ev,p); }; return r; };
function mkP(index,teamId,deck){const pieces=deck.map((t,i)=>createPiece(t,i+1,[4,3,3][i]||3)).filter(Boolean);return{socketId:'sock'+index,name:'P'+index,index,teamId,pieces,alive:true,sp:20,actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[]};}
const room=createRoom('sh-'+Math.random().toString(36).slice(2,7),{mode:'1v1'});
room.phase='game'; room.turnNumber=5; room.currentPlayerIdx=0;
room.players=[mkP(0,0,['spearman','witch','king']), mkP(1,1,['unicorn','monk','watchman'])];
room.players.forEach(p=>p.pieces.forEach(pc=>pc.alive=true));
room.sp=[20,20]; room.instantSp=[0,0]; rooms[room.id]=room;
const uni=room.players[1].pieces[0]; uni.col=2; uni.row=2; uni.hp=5;
const witch=room.players[0].pieces[1]; witch.col=1; witch.row=1;
let pass=0,fail=0; const ok=(n,c,e)=>{if(c){pass++;console.log('  ✅',n);}else{fail++;console.log('  ❌',n,e!=null?JSON.stringify(e):'');}};
console.log('== 유니콘 백은의 뿔 말풍선 검증 ==');

// 1) 저주 시전 → 백은의 뿔 말풍선
alerts.length=0;
const wi=room.players[0].pieces.findIndex(p=>p.type==='witch');
const r1=executeSkill(room,0,wi,'curse',{targetOwnerIdx:1,targetPieceIdx:0});
ok('저주 시전 거부(면역)', r1 && !r1.ok, r1);
ok('저주 → silverHorn 말풍선 emit', alerts.some(a=>a.type==='silverHorn'), alerts);

// 2) addStatus(poison, room) 직접 → 말풍선
alerts.length=0;
const applied=addStatus(uni,'poison',{stacks:1},room);
ok('addStatus poison 차단(false)', applied===false);
ok('poison → silverHorn 말풍선 emit', alerts.some(a=>a.type==='silverHorn'), alerts);

// 3) addStatus without room → no emit (하위호환)
alerts.length=0;
addStatus(uni,'frog',{});
ok('room 없으면 emit 안함(하위호환)', !alerts.some(a=>a.type==='silverHorn'));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
