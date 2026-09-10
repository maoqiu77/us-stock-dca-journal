import { z } from 'zod';
import { idSchema, dateSchema } from '@portfolio/domain';
import { contextRequirementsSchema, type ContextRequirements } from './contracts.ts';
const inputSchema=z.strictObject({
  question:z.string().trim().min(1).max(10000),
  entities:z.array(z.strictObject({instrument_id:idSchema,ticker:z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/),aliases:z.array(z.string().min(1).max(100)).max(30)})).max(500),
  page_instrument_id:idSchema.optional(),
});
export type IntentInput=z.infer<typeof inputSchema>;
export function classifyIntent(value:IntentInput):ContextRequirements {
  const input=inputSchema.parse(value);
  const text=input.question;
  const tokens=new Set(text.toUpperCase().match(/[A-Z0-9]+(?:[.-][A-Z0-9]+)*/g) ?? []);
  const explicit=input.entities.filter(e=>tokens.has(e.ticker));
  const matchesAlias=(alias:string)=>/^[a-z0-9.-]+$/i.test(alias)?tokens.has(alias.toUpperCase()):text.toLocaleLowerCase('en-US').includes(alias.toLocaleLowerCase('en-US'));
  const matchedAliases=new Map<string,Set<string>>();
  for(const entity of input.entities)for(const alias of entity.aliases)if(matchesAlias(alias)){
    const key=alias.toLocaleLowerCase('en-US');
    const matches=matchedAliases.get(key)??new Set<string>(); matches.add(entity.instrument_id);matchedAliases.set(key,matches);
  }
  const selected=new Set(explicit.map(e=>e.instrument_id));
  let reason:string|null=null;
  if (new Set(input.entities.map(e=>e.instrument_id)).size!==input.entities.length || new Set(input.entities.map(e=>e.ticker)).size!==input.entities.length) reason='实体目录存在重复，请先确认标的。';
  for(const matches of matchedAliases.values()){
    const confirmed=explicit.filter(e=>matches.has(e.instrument_id));
    if(matches.size===1)for(const id of matches)selected.add(id);
    else if(confirmed.length===1)selected.add(confirmed[0]!.instrument_id);
    else reason='名称对应多个标的，请明确 ticker。';
  }
  let ids=input.entities.filter(e=>selected.has(e.instrument_id)).map(e=>e.instrument_id);
  // Uppercase unknown ticker tokens are never silently assigned to the page entity.
  if((text.match(/\b[A-Z][A-Z0-9.-]{1,14}\b/g)??[]).some(token=>!input.entities.some(e=>e.ticker===token||e.aliases.includes(token)))) reason='存在未确认的 ticker，请明确标的。';
  if(!ids.length&&!reason&&input.page_instrument_id){
    if(input.entities.some(e=>e.instrument_id===input.page_instrument_id))ids=[input.page_instrument_id];
    else reason='页面标的尚未确认。';
  }
  const dates=text.match(/\d{4}-\d{2}-\d{2}/g)??[];
  let range:ContextRequirements['date_range']=null;
  if(dates.length>2 || dates.some(date=>!dateSchema.safeParse(date).success))reason='请提供有效的 YYYY-MM-DD 日期范围。';
  else if(dates.length){range={from:dates[0]!, to:dates.at(-1)!};if(range.from>range.to)reason='开始日期晚于结束日期，请确认。';}
  if(/上个月|上周|去年|昨天|前天|最近|last month|last week|yesterday/i.test(text))reason='请明确回看日期范围。';
  let intent:ContextRequirements['intent']=/对比|比较|compare/i.test(text)?'comparison':/为什么|理由|历史|复盘|之前|当时|history|review/i.test(text)?'history_review':/风险|仓位过高|risk/i.test(text)?'risk_review':/持仓|多少股|现金|holdings/i.test(text)?'holdings':'general';
  if(intent==='comparison'&&ids.length<2)reason='请明确至少两个比较标的。';
  if(!ids.length&&!/账户|组合|现金/.test(text))reason??='请明确标的或账户范围。';
  if(reason){intent='needs_clarification';range=null;}
  const required:ContextRequirements['required_sources']=intent==='needs_clarification'?[]:intent==='history_review'?['ledger','journal','policy']:intent==='risk_review'||intent==='comparison'?['ledger','policy','quote']:intent==='holdings'?['ledger']:['ledger','policy'];
  return contextRequirementsSchema.parse({intent,instrument_ids:ids,date_range:range,required_sources:required,clarification:reason});
}
