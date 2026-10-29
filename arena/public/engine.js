export const SHAPES={I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],O:[[1,1],[1,1]],T:[[0,1,0],[1,1,1],[0,0,0]],S:[[0,1,1],[1,1,0],[0,0,0]],Z:[[1,1,0],[0,1,1],[0,0,0]],J:[[1,0,0],[1,1,1],[0,0,0]],L:[[0,0,1],[1,1,1],[0,0,0]]};
export const COLORS={I:'#64d7db',O:'#e4cc65',T:'#b29bdc',S:'#b9e76a',Z:'#df8076',J:'#729acb',L:'#dca66c',G:'#68735d'};
export function rotate(m){return m[0].map((_,x)=>m.map(row=>row[x]).reverse())}
export function matrix(type,r=0){let m=SHAPES[type].map(row=>row.slice());for(let i=0;i<r;i++)m=rotate(m);return m}
export function collides(board,m,x,y){return m.some((row,dy)=>row.some((v,dx)=>v&&(x+dx<0||x+dx>=10||y+dy>=20||(y+dy>=0&&board[y+dy][x+dx]))))}
export function placements(board,type){const out=[];for(let r=0;r<4;r++){const m=matrix(type,r);for(let x=-3;x<10;x++){let y=-m.length;if(collides(board,m,x,y))continue;while(!collides(board,m,x,y+1))y++;if(m.some((row,dy)=>row.some((v,dx)=>v&&y+dy<0)))continue;out.push({rotation:r,x,y})}}return out}
export function placementOutcome(board,type,move){
  const rows=board.map(row=>row.slice()),piece=matrix(type,move.rotation);
  piece.forEach((row,dy)=>row.forEach((v,dx)=>{if(v)rows[move.y+dy][move.x+dx]=type}));
  const remaining=rows.filter(row=>!row.every(Boolean)),linesCleared=20-remaining.length;
  while(remaining.length<20)remaining.unshift(Array(10).fill(0));
  let holes=0;const heights=[];
  for(let x=0;x<10;x++){const top=remaining.findIndex(row=>row[x]);heights[x]=top<0?0:20-top;if(top>=0)for(let y=top;y<20;y++)if(!remaining[y][x])holes++}
  return {board:remaining,metrics:{linesCleared,holes,maxHeight:Math.max(...heights),aggregateHeight:heights.reduce((a,b)=>a+b,0),bumpiness:heights.slice(1).reduce((sum,h,i)=>sum+Math.abs(h-heights[i]),0)}};
}
export function placementMetrics(board,type,move){return placementOutcome(board,type,move).metrics}
export function evaluate(board,type,move){const b=board.map(row=>row.slice()),m=matrix(type,move.rotation);m.forEach((row,dy)=>row.forEach((v,dx)=>{if(v)b[move.y+dy][move.x+dx]=type}));let lines=b.filter(row=>row.every(Boolean)).length;const rows=b.filter(row=>!row.every(Boolean));while(rows.length<20)rows.unshift(Array(10).fill(0));let holes=0;const heights=[];for(let x=0;x<10;x++){let top=rows.findIndex(row=>row[x]);heights[x]=top<0?0:20-top;if(top>=0)for(let y=top;y<20;y++)if(!rows[y][x])holes++}return lines*8-heights.reduce((a,b)=>a+b,0)*.51-holes*3.5-heights.slice(1).reduce((s,v,i)=>s+Math.abs(v-heights[i]),0)*.22-Math.max(...heights)*.3}
export function bestMove(board,type){return placements(board,type).sort((a,b)=>evaluate(board,type,b)-evaluate(board,type,a))[0]}
export class Game{constructor(sequence){this.board=Array.from({length:20},()=>Array(10).fill(0));this.sequence=sequence;this.index=0;this.score=0;this.lines=0;this.level=1;this.held=null;this.canHold=true;this.dead=false;this.spawn()}
spawn(type){this.type=type||this.sequence(this.index++);this.m=matrix(this.type);this.rotation=0;this.x=Math.floor((10-this.m.length)/2);this.y=this.type==='I'?-1:0;if(collides(this.board,this.m,this.x,this.y))this.dead=true}
move(dx,dy){if(this.dead||collides(this.board,this.m,this.x+dx,this.y+dy))return false;this.x+=dx;this.y+=dy;return true}
turn(dir=1){let r=(this.rotation+dir+4)%4,m=matrix(this.type,r);for(const dx of [0,-1,1,-2,2])for(const dy of [0,-1,-2])if(!collides(this.board,m,this.x+dx,this.y+dy)){this.m=m;this.rotation=r;this.x+=dx;this.y+=dy;return true}return false}
ghost(){let y=this.y;while(!collides(this.board,this.m,this.x,y+1))y++;return y}
lock(){let overflow=false;this.m.forEach((row,dy)=>row.forEach((v,dx)=>{if(v){if(this.y+dy<0)overflow=true;else this.board[this.y+dy][this.x+dx]=this.type}}));if(overflow){this.dead=true;return 0}let before=this.board.length;this.board=this.board.filter(row=>!row.every(Boolean));let count=before-this.board.length;while(this.board.length<20)this.board.unshift(Array(10).fill(0));this.score+=[0,100,300,500,800][count]*this.level;this.lines+=count;this.level=1+Math.floor(this.lines/10);this.canHold=true;this.spawn();return count}
drop(){this.score+=(this.ghost()-this.y)*2;this.y=this.ghost();return this.lock()}
hold(){if(!this.canHold||this.dead)return;let old=this.held;this.held=this.type;this.spawn(old);this.canHold=false}
}
export function makeSequence(random=Math.random){const bag=[];return index=>{while(bag.length<=index){let next=Object.keys(SHAPES);for(let i=next.length-1;i>0;i--){let j=Math.floor(random()*(i+1));[next[i],next[j]]=[next[j],next[i]]}bag.push(...next)}return bag[index]}}
