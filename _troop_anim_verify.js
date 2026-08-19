const S = require('./server.js');
const { createRoom, createPiece, aiRunTroopAttack, initAiBrain, rooms } = S;
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log('  ✅',n)):(fail++,console.log('  ❌',n,x!=null?'→'+JSON.stringify(x):''));};
const room=createRoom('ta'+Math.random().toString(36).slice(2,6),{mode:'1v1'});
room.isAI=true;room._headless=true;room.phase='game';room.turnNumber=6;room.currentPlayerIdx=1;room.sp=[9,9];room.instantSp=[0,0];
// AI(1): general(자기+상하좌우) + prince(가로3) at (2,2)/(2,3)
const gen=createPiece('general',2,3); gen.col=2;gen.row=2;gen.alive=true;
const prince=createPiece('prince',3,3); prince.col=2;prince.row=4;prince.alive=true;
// human(0): 창병 두 명을 사거리에 — general 상하좌우(1,2)/(3,2)/(2,1)/(2,3); prince 가로3 (1,4)(2,4)(3,4)
const h1=createPiece('spearman',1,4); h1.col=3;h1.row=2;h1.alive=true;   // general 사거리
const h2=createPiece('knight',2,4); h2.col=1;h2.row=4;h2.alive=true;      // prince 사거리
room.players[0]={socketId:'AI',name:'H',index:0,pieces:[h1,h2],actionDone:false,skillsUsedBeforeAction:[]};  // socketId AI → 헤드리스(emit 무시)
room.players[1]={socketId:'AI',name:'AI',index:1,pieces:[gen,prince],actionDone:false,actionUsedSkillReplace:false,skillsUsedBeforeAction:[],_decreeUnit:null};
rooms[room.id]=room; room.aiBrain=initAiBrain(9); room.aiBrain.turnCount=6;
const h1hp0=h1.hp, h2hp0=h2.hp;
console.log('== 부대공격 순차 애니 개편 후 데미지 정상 처리 검증 ==');
const r=aiRunTroopAttack(room,1,0);
ok('aiRunTroopAttack 성공', r===true, r);
ok('SP 3 차감', room.sp[1]===6, room.sp[1]);
ok('일반 유닛 피격(창병 HP 감소)', h1.hp < h1hp0, {before:h1hp0,after:h1.hp});
ok('두번째 유닛 피격(기사 HP 감소)', h2.hp < h2hp0, {before:h2hp0,after:h2.hp});
ok('actionDone/actionUsedSkillReplace 설정', room.players[1].actionDone && room.players[1].actionUsedSkillReplace);
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
