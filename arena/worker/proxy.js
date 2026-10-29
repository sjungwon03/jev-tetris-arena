import {placements,SHAPES,matrix,placementMetrics,placementOutcome,collides} from '../public/engine.js';
export const INPUT_VERSION='candidate-features-v7-guarded';
export const TETRIS_COACHING='Play a 40-line sprint. Take safe singles/doubles; never stack up waiting for four lines. Keep the surface low and flat. Never roof over empty cells or build deep pits/center towers. Keep room for the next piece; leave an I well only if safe.';
const modelId=value=>typeof value==='string'&&value.length>0&&value.length<=200?value:null;
const reportedModel=body=>modelId(body?.model_id)||modelId(body?.model);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function config(env){
  const style=env.JEV_API_STYLE||'chat';
  const decisions=style==='decisions';
  const baseUrl=(env.JEV_BASE_URL||(decisions?'https://jev.sanhouse.kr/v1':'https://llm.sanhouse.kr/v1')).replace(/\/+$/,'');
  return {baseUrl,model:env.JEV_MODEL||(decisions?'JEV':''),candidateLimit:decisions?(env.JEV_CANDIDATE_LIMIT==='0'?0:Math.max(2,Math.min(20,Number(env.JEV_CANDIDATE_LIMIT)||4))):0,style,inputVersion:decisions?INPUT_VERSION:'llm-harness-v2-coaching',configuredModelId:modelId(env.JEV_UPSTREAM_MODEL_ID),configured:decisions||Boolean(env.JEV_MODEL)};
}
function validInput(input){return input&&Object.hasOwn(SHAPES,input.piece)&&Array.isArray(input.board)&&input.board.length===20&&input.board.every(row=>Array.isArray(row)&&row.length===10&&row.every(v=>v===0||(typeof v==='string'&&Object.hasOwn(SHAPES,v))))&&Array.isArray(input.next)&&input.next.length<=5&&input.next.every(v=>typeof v==='string'&&Object.hasOwn(SHAPES,v))&&(input.assist===undefined||typeof input.assist==='boolean')}
export function parseDecision(text,moves){
  const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');let d;
  try{d=JSON.parse(clean)}catch{throw Error('invalid_model_output')}
  const selected=moves.find(m=>m.rotation===d?.rotation&&m.x===d?.x);
  if(!selected)throw Error('illegal_move');return selected;
}
export function uniquePlacements(type,moves){
  const seen=new Set();return moves.filter(move=>{const cells=[];matrix(type,move.rotation).forEach((row,y)=>row.forEach((v,x)=>{if(v)cells.push((y+move.y)*10+x+move.x)}));const key=cells.sort((a,b)=>a-b).join(',');if(seen.has(key))return false;seen.add(key);return true});
}
const moveKey=m=>`${m.rotation}/${m.x}/${m.y}`;
export function forecastNext(input,move){
  const next=input.next[0];if(!next)return null;
  const after=placementOutcome(input.board,input.piece,move).board,shape=matrix(next),x=Math.floor((10-shape.length)/2),y=next==='I'?-1:0;
  if(collides(after,shape,x,y))return {piece:next,available:false};
  let best=null,bestValue=-Infinity;
  for(const candidate of uniquePlacements(next,placements(after,next))){
    const f=placementMetrics(after,next,candidate);
    const value=f.linesCleared*8-f.aggregateHeight*.51-f.holes*3.5-f.bumpiness*.22-f.maxHeight*.3;
    if(value>bestValue){bestValue=value;best={piece:next,available:true,move:candidate,metrics:f}}
  }
  return best||{piece:next,available:false};
}
export function rankPlans(input,moves){
  const quality=f=>f.linesCleared*8-f.aggregateHeight*.51-f.holes*3.5-f.bumpiness*.22-f.maxHeight*.3;
  const plans=moves.map(move=>{const current=placementMetrics(input.board,input.piece,move),forecast=forecastNext(input,move);const score=forecast&&!forecast.available?-1000000:forecast?current.linesCleared*5+quality(current)*.35+quality(forecast.metrics)*.65:quality(current);return {move,current,forecast,score}}).sort((a,b)=>Number(Boolean(a.forecast&&!a.forecast.available))-Number(Boolean(b.forecast&&!b.forecast.available))||a.current.holes-b.current.holes||b.score-a.score);
  return new Map(plans.map((plan,i)=>[moveKey(plan.move),{...plan,rank:i+1}]));
}
export function decisionRequest(input,moves,forecasts){
  forecasts??=rankPlans(input,moves);
  let currentHoles=0;
  for(let x=0;x<10;x++){let covered=false;for(let y=0;y<20;y++){if(input.board[y][x])covered=true;else if(covered)currentHoles++}}
  return {
    state:JSON.stringify({board:input.board.map(row=>row.map(v=>v?1:0).join('')),piece:input.piece,next:input.next}),
    question:TETRIS_COACHING+' Prefer BEST-PLAN; otherwise LOWEST p rank. Reject BLOCKED-NEXT. SAFE=no new holes. clear=lines; holes=total(change); high=max height; stack=sum heights; rough=unevenness. NEXT=forecast, not guarantee. r/x/y are IDs.',
    options:moves.map(m=>{const f=placementMetrics(input.board,input.piece,m);const delta=f.holes-currentHoles;const plan=forecasts.get(moveKey(m)),next=plan.forecast;const future=!next?'':!next.available?' BLOCKED-NEXT':` NEXT holes${next.metrics.holes} high${next.metrics.maxHeight} clear${next.metrics.linesCleared}`;return `${plan.rank===1?'BEST-PLAN ':''}p${plan.rank} ${delta<=0?'SAFE':'ADDS-HOLES'} r${m.rotation} x${m.x} y${m.y}; clear${f.linesCleared} holes${f.holes}(${delta>=0?'+':''}${delta}) high${f.maxHeight} stack${f.aggregateHeight} rough${f.bumpiness}${future}`})
  };
}
function errorCode(error){return error?.code||(error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'aborted':/^upstream_\d+$/.test(error?.message)?error.message:error?.message==='illegal_move'?'illegal_move':'invalid_response_or_network')}
async function upstreamError(response){
  const error=Error('upstream_'+response.status);error.upstreamStatus=response.status;
  if(response.status===400){
    try{const raw=await response.text(),body=raw.length<=8000?JSON.parse(raw):null;
      const match=typeof body?.error==='string'&&body.error.match(/^branch too long: (\d+) tokens with a (\d+)-token state \(row limit (\d+)\)$/);
      if(match){error.code='input_token_limit';error.tokenUsage={branch:Number(match[1]),state:Number(match[2]),limit:Number(match[3])}}
    }catch{}
  }
  return error;
}
function telemetry(request,c){
  const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:undefined;
  const requestId=safe(request.headers.get('X-JEV-Request-ID'))||crypto.randomUUID();
  const sessionId=safe(request.headers.get('X-JEV-Session-ID'));
  const rawTurn=request.headers.get('X-JEV-Turn'),turn=rawTurn&&/^\d{1,6}$/.test(rawTurn)?Number(rawTurn):undefined;
  const started=performance.now(),events=[];
  const emit=(event,fields={})=>{const data={event,requestId,sessionId,turn,protocol:c.style,inputVersion:c.inputVersion,configuredModelId:c.configuredModelId,timestamp:new Date().toISOString(),offsetMs:Math.round(performance.now()-started),...fields};events.push(data);console.log(JSON.stringify({source:'jev-performance',...data}))};
  return {requestId,events,emit,elapsed:()=>Math.round(performance.now()-started)};
}
export function guardSelection(decision,plans,enabled){
  const selected=plans.get(moveKey(decision)),best=[...plans.values()].find(p=>p.rank===1);
  const tied=selected.current.holes===best.current.holes&&Boolean(selected.forecast?.available)===Boolean(best.forecast?.available)&&Math.abs(selected.score-best.score)<1e-8;
  const corrected=Boolean(enabled&&selected.rank!==1&&!tied),applied=corrected?best:selected;
  return {decision:applied.move,modelDecision:decision,selectionGuard:{enabled,corrected,reason:corrected?'lower_ranked_plan':null,originalRank:selected.rank,appliedRank:applied.rank,originalMetrics:selected.current,appliedMetrics:applied.current}};
}
export async function runJev(input,moves,endpoint,headers,fetcher,emit=()=>{},{candidateLimit=4,guardEnabled=false}={}){
  const legal=uniquePlacements(input.piece,moves),rounds=[],signal=AbortSignal.timeout(20000);let callCount=0;
  const forecastStarted=performance.now(),forecasts=rankPlans(input,legal);
  emit('jev.lookahead.prepared',{candidateCount:legal.length,durationMs:Math.round(performance.now()-forecastStarted),nextPiece:input.next[0]});
  const considered=candidateLimit>0?[...legal].sort((a,b)=>forecasts.get(moveKey(a)).rank-forecasts.get(moveKey(b)).rank).slice(0,candidateLimit):legal;
  emit('jev.candidates.shortlisted',{legalMoveCount:legal.length,consideredMoveCount:considered.length,method:'two-piece-heuristic',candidates:considered.map(move=>({move,rank:forecasts.get(moveKey(move)).rank,score:forecasts.get(moveKey(move)).score}))});
  const probability=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
  async function round(candidates,phase){
    const request=decisionRequest(input,candidates,forecasts),started=performance.now();
    let httpStatus,headersMs,decodeMs;callCount++;
    emit('jev.call.started',{phase,endpoint,optionCount:candidates.length,requestBytes:new TextEncoder().encode(JSON.stringify(request)).length,request});
    try{
    const upstream=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(request),signal});
    httpStatus=upstream.status;headersMs=Math.round(performance.now()-started);
    if(!upstream.ok)throw await upstreamError(upstream);
    const decodeStarted=performance.now(),body=await upstream.json();decodeMs=Math.round(performance.now()-decodeStarted);
    const decision=parseJevDecision(body,request.options,candidates);
    const confidence=probability(body.confidence)?body.confidence:undefined;
    const response={model_id:reportedModel(body),prediction:body.prediction,prediction_index:body.prediction_index,confidence,probabilities:Object.fromEntries(request.options.filter(option=>probability(body.probabilities?.[option])).map(option=>[option,body.probabilities[option]]))};
    const timing={durationMs:Math.round(performance.now()-started),headersMs,decodeMs,httpStatus};
    rounds.push({phase,request,response,timing});
    emit('jev.call.completed',{phase,optionCount:candidates.length,...timing,selected:decision,selectedMetrics:placementMetrics(input.board,input.piece,decision),reportedModelId:reportedModel(body),confidence,response});
    return {decision,confidence,candidates:candidates.map((m,i)=>({...m,probability:response.probabilities[request.options[i]]})).filter(m=>probability(m.probability)).sort((a,b)=>b.probability-a.probability)};
    }catch(error){emit('jev.call.failed',{phase,optionCount:candidates.length,httpStatus,headersMs,decodeMs,durationMs:Math.round(performance.now()-started),error:errorCode(error),tokenUsage:error.tokenUsage});
      if(error.code==='input_token_limit'&&candidates.length>2){
        emit('jev.call.repartitioned',{phase,optionCount:candidates.length,reason:'input_token_limit',tokenUsage:error.tokenUsage});
        const groups=[candidates.filter((_,i)=>i%2===0),candidates.filter((_,i)=>i%2===1)];
        const results=await Promise.allSettled(groups.map((group,i)=>group.length===1?Promise.resolve({decision:group[0]}):round(group,phase+'/분할'+(i+1))));
        const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
        return round(results.map(r=>r.value.decision),phase+'/재선택');
      }
      throw error}

  }
  if(considered.length===1)return {decision:considered[0],forced:true,forecast:forecasts.get(moveKey(legal[0])).forecast,plan:{rank:1,score:forecasts.get(moveKey(legal[0])).score},rounds:[],upstreamCallCount:0,candidates:[],legalMoveCount:1};
  let finalists=considered;
  if(considered.length>20){
    const groupCount=Math.ceil(considered.length/20),groups=Array.from({length:groupCount},()=>[]);
    considered.forEach((m,i)=>groups[i%groupCount].push(m));
    const results=await Promise.allSettled(groups.map((group,i)=>round(group,'예선 '+(i+1))));
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    const winners=results.map(r=>r.value);
    finalists=winners.map(w=>w.decision);
  }
  const result=await round(finalists,considered.length>20?'최종 선택':'선택');
  const guarded=guardSelection(result.decision,forecasts,guardEnabled);
  if(guarded.selectionGuard.corrected)emit('jev.selection.corrected',{modelDecision:guarded.modelDecision,appliedDecision:guarded.decision,selectionGuard:guarded.selectionGuard});
  return {...result,...guarded,forecast:forecasts.get(moveKey(guarded.decision)).forecast,plan:{rank:forecasts.get(moveKey(guarded.decision)).rank,score:forecasts.get(moveKey(guarded.decision)).score},rounds,upstreamCallCount:callCount,consideredMoveCount:considered.length,legalMoveCount:legal.length};
}
export function parseJevDecision(body,options,moves){
  const index=options.indexOf(body?.prediction);
  if(index<0||(body.prediction_index!==undefined&&body.prediction_index!==index))throw Error('illegal_move');
  return moves[index];
}
export async function api(request,env,fetcher=fetch){
  const path=new URL(request.url).pathname,c=config(env);
  if(path==='/api/config'&&request.method==='GET')return json(c);
  if(path==='/api/health'&&request.method==='GET'){
    if(!c.configured)return json({ok:false,error:'JEV_MODEL 환경변수를 설정해 주세요.'},503);
    if(c.style==='decisions'){
      const probe=new Request(new URL('/api/move',request.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:Array.from({length:20},()=>Array(10).fill(0)),piece:'T',next:['I','O']})});
      const result=await api(probe,env,fetcher),body=await result.json();
      return json({ok:result.ok,model:c.model,latencyMs:body.trace?.latencyMs,error:body.error},result.status);
    }
    try{
      const r=await fetcher(c.baseUrl+'/models',{headers:env.JEV_API_KEY?{Authorization:'Bearer '+env.JEV_API_KEY}:{},signal:AbortSignal.timeout(8000)});
      if(!r.ok)return json({ok:false,error:'공급자 인증 또는 연결 오류 ('+r.status+')'},502);
      const body=await r.json(),found=Array.isArray(body.data)&&body.data.some(m=>m.id===c.model);
      return json({ok:found,model:c.model,error:found?undefined:'공급자의 모델 목록에서 설정한 모델 ID를 찾지 못했어요.'},found?200:502);
    }catch{return json({ok:false,error:'모델 공급자에 연결할 수 없어요.'},502)}
  }
  if(path!=='/api/move')return json({error:'Not found'},404);
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin not allowed'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  if(Number(request.headers.get('Content-Length')||0)>16000)return json({error:'Request too large'},413);
  if(!c.configured)return json({error:'JEV_MODEL이 설정되지 않았어요.'},503);
  let input;
  try{const text=await request.text();if(text.length>16000)return json({error:'Request too large'},413);input=JSON.parse(text)}catch{return json({error:'Invalid JSON'},400)}
  if(!validInput(input))return json({error:'Invalid board'},400);
  const log=telemetry(request,c),prepareStarted=performance.now();
  const moves=placements(input.board,input.piece);
  const prepareMs=Math.round(performance.now()-prepareStarted);
  log.emit('turn.started',{piece:input.piece,next:input.next,board:input.board,legalMoveCount:moves.length,prepareMs});
  if(!moves.length){log.emit('turn.failed',{error:'no_legal_moves',durationMs:log.elapsed()});return json({error:'No legal moves',trace:{requestId:log.requestId,events:log.events}},422)}
  const system=TETRIS_COACHING+' You are JEV, a Tetris decision-making agent. Play a 40-line sprint. Choose exactly one legal move supplied by the environment. Minimize holes, keep the stack low and flat, and clear lines. The board has 20 rows (top to bottom) and 10 columns (left to right); 0 is empty. x is the left edge of the piece matrix, rotation is clockwise quarter turns. Return ONLY a JSON object with integer fields rotation and x. Each legal move includes exact after-placement and line-clear metrics: linesCleared (maximize), holes, maxHeight, aggregateHeight and bumpiness (minimize). Use these metrics rather than recalculating the resulting board. Never invent a move. No markdown, explanation or reasoning.';
  const user=JSON.stringify({board:input.board,piece:input.piece,next:input.next,pieceRotations:[0,1,2,3].map(r=>matrix(input.piece,r)),legalMoves:moves.map(move=>({...move,after:placementMetrics(input.board,input.piece,move)}))});
  const headers={'Content-Type':'application/json',...(env.JEV_API_KEY?{Authorization:'Bearer '+env.JEV_API_KEY}:{})};
  const responses=c.style==='responses',jev=c.style==='decisions';
  const payload=responses?{model:c.model,instructions:system,input:user,max_output_tokens:1024}:{model:c.model,messages:[{role:'system',content:system},{role:'user',content:user}],max_completion_tokens:1024};
  const endpoint=c.baseUrl+(jev?'/decisions':responses?'/responses':'/chat/completions');
  const started=Date.now();
  try{
    let decision,text,confidence,candidates,jevResult,chatReportedModel;
    if(jev){
      jevResult=await runJev(input,moves,endpoint,headers,fetcher,log.emit,{candidateLimit:c.candidateLimit,guardEnabled:input.assist===true});
      ({decision,confidence,candidates}=jevResult);
      text=JSON.stringify(jevResult.forced?{forced:true,note:'유일한 배치 · 모델 호출 없음'}:jevResult.rounds.map(r=>({phase:r.phase,...r.response})),null,2);
    }else{
      log.emit('model.call.started',{endpoint,optionCount:moves.length,requestBytes:new TextEncoder().encode(JSON.stringify(payload)).length,request:payload});
      const callStarted=performance.now();
      const upstream=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
      if(!upstream.ok)throw await upstreamError(upstream);
      const body=await upstream.json();chatReportedModel=reportedModel(body);
      text=responses?(body.output_text||body.output?.flatMap(o=>o.content||[]).filter(o=>o.type==='output_text').map(o=>o.text).join('')):body.choices?.[0]?.message?.content;
      if(typeof text!=='string')throw Error('invalid_model_output');decision=parseDecision(text,moves);
      log.emit('model.call.completed',{durationMs:Math.round(performance.now()-callStarted),httpStatus:upstream.status,selected:decision,reportedModelId:chatReportedModel});
    }
    const modelIdentity={displayName:c.model,configuredModelId:c.configuredModelId,reportedModelIds:[...new Set((jevResult?.rounds.map(r=>r.response.model_id)||[chatReportedModel]).filter(Boolean))]};
    modelIdentity.source=modelIdentity.reportedModelIds.length?'api_response':c.configuredModelId?'operator_configuration':'unreported';
    const selectedMetrics=placementMetrics(input.board,input.piece,decision);
    log.emit('turn.completed',{endpoint,durationMs:log.elapsed(),upstreamCallCount:jevResult?.upstreamCallCount??1,uniqueMoveCount:jevResult?.legalMoveCount??moves.length,modelDecision:jevResult?.modelDecision,selectionGuard:jevResult?.selectionGuard,selected:decision,selectedMetrics,modelIdentity,confidence,forced:jevResult?.forced||false});
    return json({...decision,model:c.model,confidence,candidates,forced:jevResult?.forced,trace:{modelDecision:jevResult?.modelDecision,selectionGuard:jevResult?.selectionGuard,consideredMoveCount:jevResult?.consideredMoveCount,plan:jevResult?.plan,forecast:jevResult?.forecast,modelIdentity,inputVersion:c.inputVersion,selectedMetrics,requestId:log.requestId,events:log.events,prepareMs,protocol:c.style,endpoint,request:jev?jevResult.rounds.map(r=>({phase:r.phase,...r.request})):undefined,messages:jev?undefined:[{role:'system',content:system},{role:'user',content:user}],response:text,latencyMs:Date.now()-started,legalMoveCount:jevResult?.legalMoveCount??moves.length}});
  }catch(e){log.emit('turn.failed',{endpoint,error:errorCode(e),upstreamStatus:e.upstreamStatus,tokenUsage:e.tokenUsage,durationMs:log.elapsed()});return json({errorCode:errorCode(e),upstreamStatus:e.upstreamStatus,tokenUsage:e.tokenUsage,trace:{requestId:log.requestId,events:log.events,endpoint,inputVersion:c.inputVersion,latencyMs:log.elapsed()},error:e.code==='input_token_limit'?'JEV 입력 토큰 한도를 초과했어요.':e.name==='TimeoutError'?'모델 응답 시간이 초과됐어요.':e.message==='illegal_move'?'모델이 불가능한 배치를 선택했어요.':/^upstream_\d+$/.test(e.message)?'모델 공급자 응답 오류 ('+e.message.slice(9)+')':'모델 연결 또는 응답 형식을 확인해 주세요.'},502)}
}
