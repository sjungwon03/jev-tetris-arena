import {writeFile} from 'node:fs/promises';
import {Game,makeSequence,matrix,placements} from '../public/engine.js';
import {rankPlans,uniquePlacements,guardSelection} from '../worker/proxy.js';
const rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
const seeds=[11,23,37,51,73],results=[];
for(const policy of ['best','unassisted-random-top4','guarded-random-top4']){
  for(const seed of seeds){
    const random=rng(seed),seq=makeSequence(rng(seed)),game=new Game(seq);let turns=0,corrections=0;
    while(!game.dead&&game.lines<40&&turns<180){
      const input={board:game.board,piece:game.type,next:[seq(game.index)]},plans=rankPlans(input,uniquePlacements(game.type,placements(game.board,game.type))),ordered=[...plans.values()];if(!ordered.length)break;
      const selected=policy==='best'?ordered[0].move:ordered[Math.floor(random()*Math.min(4,ordered.length))].move;
      const guarded=guardSelection(selected,plans,policy==='guarded-random-top4');corrections+=Number(guarded.selectionGuard.corrected);const move=guarded.decision;
      game.m=matrix(game.type,move.rotation);game.rotation=move.rotation;game.x=move.x;game.y=move.y;game.lock();turns++;
    }
    results.push({policy,seed,lines:game.lines,turns,dead:game.dead,corrections});
  }
}
const report={kind:'offline-planner-simulation',warning:'No live JEV inference. Random top-4 selection is a stress test, not measured model behavior or win rate.',targetLines:40,turnLimit:180,seeds,results};
await writeFile(new URL('../diagnostics/planner-benchmark.json',import.meta.url),JSON.stringify(report,null,2));for(const policy of ['best','unassisted-random-top4','guarded-random-top4'])console.log(JSON.stringify({policy,results:results.filter(r=>r.policy===policy)}));
