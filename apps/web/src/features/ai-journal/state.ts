import type {JournalPreview,JournalRequest} from "./api";
export function emptyRequest(key:string|null=null):JournalRequest{return {task_type:key?"instrument_research":"portfolio_review",question:key?"请分析这个标的的主要风险和需要验证的事项。":"",instrument_key:key,primary_period:null,auxiliary_periods:[],quantity:null,cost:null,max_position:null,cost_currency:null,position_tickers:[],plan_tickers:[],trade_ids:[],note_ids:[],history_turn_ids:[],session_id:null,reuse_snapshot_id:null};}
export function conversationRequest(key:string|null=null):JournalRequest{return {...emptyRequest(key),task_type:"conversation",auto_context:true,memory_mode:"suggest_related"};}
function normalizedRequest(request:JournalRequest){const {engine="llm",agent_version=1,market_policy="frozen",memory_mode="selected",memory_excluded_ids=[],auto_context=false,memory_before=null,...legacy}=request;return {...legacy,engine,agent_version,market_policy,memory_mode,memory_excluded_ids,auto_context,memory_before};}
function stable(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
 if(value&&typeof value==="object"){
  const fields=Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`);
  return "{"+fields.join(",")+"}";
 }
 return JSON.stringify(value)??"null";
}
export function canConfirm(preview:JournalPreview|null,draft:JournalRequest,now=Date.now()){return Boolean(preview&&stable(normalizedRequest(preview.request))===stable(normalizedRequest(draft))&&Date.parse(preview.expires_at)>now);}
export function toggleSelection(values:string[],id:string){return values.includes(id)?values.filter(value=>value!==id):[...values,id];}
export function followUpRequest(preview:JournalPreview,sessionId:string,turnId?:string):JournalRequest{
 const request:JournalRequest={...preview.request,question:"",session_id:sessionId,reuse_snapshot_id:preview.id,history_turn_ids:turnId?[turnId]:preview.request.history_turn_ids};
 // Automatic conversations resolve current positions again; old facts are not current observations.
 if(request.auto_context)request.reuse_snapshot_id=null;
 return request;
}
export function runIsActive(status?:string){return status==="queued"||status==="running"||status==="cancel_requested";}
