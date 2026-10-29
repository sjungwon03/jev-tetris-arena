import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function extractRequests(document){
  const result=[],records=document.entries||[document],responses=new Map();
  for(const entry of records){
    if(!entry||typeof entry!=='object')continue;
    const id=entry.requestId||entry.id||null;
    for(const event of [entry,...(entry.events||[])])if(event.event==='jev.call.completed'&&event.response)responses.set((event.requestId||id)+'|'+event.phase,{prediction:event.response.prediction,confidence:event.response.confidence,reportedModelId:event.reportedModelId||null});
    try{const parsed=JSON.parse(entry.response||entry.trace?.response||'null');for(const response of Array.isArray(parsed)?parsed:parsed?[parsed]:[])if(response.prediction)responses.set(id+'|'+(response.phase||entry.phase||null),{prediction:response.prediction,confidence:response.confidence,reportedModelId:response.model_id||null})}catch{}
  }
  const add=(request,entry,phase)=>{if(request&&typeof request.state==='string'&&typeof request.question==='string'&&Array.isArray(request.options)&&request.options.every(o=>typeof o==='string'))result.push({sourceRequestId:entry.requestId||entry.id||null,sourceSessionId:entry.sessionId||null,sourceTurn:entry.turn??null,phase:phase||entry.phase||null,inputVersion:entry.inputVersion||'legacy-unversioned',baselineSelection:responses.get((entry.requestId||entry.id||null)+'|'+(phase||entry.phase||null))||null,sourceModelIdentity:entry.modelIdentity||{source:'unreported',reportedModelIds:[],configuredModelId:null},request:{state:request.state,question:request.question,options:request.options}})};
  for(const entry of records){
    if(!entry||typeof entry!=='object')continue;
    const requests=entry.request||entry.trace?.request;
    if(Array.isArray(requests))for(const request of requests)add(request,entry,request.phase);
    else if(requests?.state)add(requests,entry);
    else if(Array.isArray(entry.events)){for(const event of entry.events)if(event.event==='jev.call.started')add(event.request,{...entry,requestId:event.requestId||entry.requestId},event.phase)}
    else if(entry.state)add(entry,entry);
  }
  return result;
}
export async function replay(requests,{endpoint,key,modelLabel=null,fetcher=fetch}){
  if(!endpoint)return {mode:'dry-run',requestCount:requests.length,requests};
  const target=new URL(endpoint);if(target.protocol!=='https:'&&target.hostname!=='localhost'&&target.hostname!=='127.0.0.1')throw Error('Use HTTPS or a local test endpoint');
  const results=[];
  for(const entry of requests){
    const started=performance.now(),timestamp=new Date().toISOString(),requestHash=createHash('sha256').update(JSON.stringify(entry.request)).digest('hex');
    const base={...entry,requestHash,endpoint:target.href,comparisonModelLabel:modelLabel,startedAt:timestamp};
    try{
      const response=await fetcher(target.href,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(entry.request),signal:AbortSignal.timeout(30000)});
      if(!response.ok){results.push({...base,httpStatus:response.status,durationMs:Math.round(performance.now()-started),error:'upstream_http_error'});continue}
      const body=await response.json(),prediction=body.prediction,index=entry.request.options.indexOf(prediction);
      const valid=index>=0&&(body.prediction_index===undefined||body.prediction_index===index);
      const id=typeof body.model_id==='string'?body.model_id:typeof body.model==='string'?body.model:null;
      const probability=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
      results.push({...base,httpStatus:response.status,durationMs:Math.round(performance.now()-started),valid,selectionChanged:valid&&entry.baselineSelection?entry.baselineSelection.prediction!==prediction:null,modelIdentity:{reportedModelIds:id?[id]:[],configuredModelId:null,source:id?'api_response':'unreported'},prediction:valid?prediction:null,predictionIndex:valid?index:null,confidence:probability(body.confidence)?body.confidence:null,probabilities:Object.fromEntries(entry.request.options.filter(o=>probability(body.probabilities?.[o])).map(o=>[o,body.probabilities[o]])),error:valid?null:'invalid_selection'});
    }catch(error){results.push({...base,durationMs:Math.round(performance.now()-started),error:error.name==='TimeoutError'?'timeout':'network_or_invalid_response'})}
  }
  return {schemaVersion:1,mode:'exact-request-replay',exportedAt:new Date().toISOString(),requestCount:requests.length,results};
}
async function main(){
  const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined};
  const input=value('--input'),output=value('--output');
  if(!input){console.error('Usage: node scripts/replay.mjs --input log.json [--output result.json] [--endpoint https://server/v1/decisions] [--label model-comparison-name]');process.exitCode=1;return}
  const document=JSON.parse(await readFile(input,'utf8')),requests=extractRequests(document);
  if(!requests.length)throw Error('No native JEV requests found in input log');
  const result=await replay(requests,{endpoint:value('--endpoint')||process.env.JEV_REPLAY_URL,key:process.env.JEV_API_KEY,modelLabel:value('--label')||null});
  const serialized=JSON.stringify(result,null,2);
  if(output)await writeFile(output,serialized+'\n');
  console.log(JSON.stringify({mode:result.mode,requestCount:requests.length,output:output||null,results:result.results?.map(r=>({sourceRequestId:r.sourceRequestId,phase:r.phase,durationMs:r.durationMs,valid:r.valid,selectionChanged:r.selectionChanged,modelIdentity:r.modelIdentity,error:r.error}))}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Replay failed. Check input JSON, endpoint, and filesystem permissions.');process.exitCode=1});
