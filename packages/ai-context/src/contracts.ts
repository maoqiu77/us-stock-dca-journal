import { z } from 'zod';
import { idSchema, dateSchema, timestampSchema, policySchema } from '@portfolio/domain';

export const sourceTypeSchema = z.enum(['ledger','policy','quote','journal','user_statement','ai_output','imported_excerpt']);
export const sourceRefSchema = z.strictObject({ id:idSchema, revision:idSchema, type:sourceTypeSchema, asOf:timestampSchema });
export const dateRangeSchema = z.strictObject({from:dateSchema,to:dateSchema}).refine(x=>x.from<=x.to,'reversed_date_range');
export const contextRequirementsSchema = z.strictObject({
  intent:z.enum(['holdings','history_review','risk_review','comparison','general','needs_clarification']),
  instrument_ids:z.array(idSchema).max(20), date_range:dateRangeSchema.nullable(),
  required_sources:z.array(sourceTypeSchema).max(7), clarification:z.string().min(1).max(300).nullable(),
}).refine(x=>(x.intent==='needs_clarification') === (x.clarification!==null),'clarification_state_mismatch');
export const factSchema = z.strictObject({
  kind:z.literal('fact'), name:z.string().min(1).max(120), value:z.union([z.string().max(2000),z.boolean(),z.null()]),
  sources:z.array(sourceRefSchema).min(1).max(100), freshness:z.enum(['current','stale','unknown']),
  completeness:z.enum(['complete','partial','unknown']),
}).refine(x=>x.sources.every(s=>['ledger','policy','quote','user_statement'].includes(s.type)),'untrusted_source_is_not_fact');
export const untrustedExcerptSchema = z.strictObject({
  kind:z.literal('untrusted_excerpt'), text:z.string().min(1).max(20000), source:sourceRefSchema,
  classification:z.enum(['user_original','imported_original','ai_generated']),
}).refine(x=>x.classification==='ai_generated' ? x.source.type==='ai_output' : x.source.type!=='ai_output','ai_source_classification_mismatch');
export const manifestSchema = z.strictObject({
  schema_version:z.literal(1), request_id:idSchema, portfolio_id:idSchema, built_at:timestampSchema,
  known_at:timestampSchema, through_date:dateSchema, requirements:contextRequirementsSchema,
  policy:policySchema, sources:z.array(sourceRefSchema).max(500),
  omissions:z.array(z.strictObject({reason:z.enum(['missing','stale','budget','not_authorized','conflict']),description:z.string().min(1).max(500)})).max(100),
}).refine(x=>x.policy.portfolio_id===x.portfolio_id,'policy_portfolio_mismatch');
export const providerRequestSchema = z.strictObject({
  manifest:manifestSchema, question:z.string().min(1).max(10000), facts:z.array(factSchema).max(300),
  excerpts:z.array(untrustedExcerptSchema).max(100),
}).superRefine((request,ctx)=>{
  const key=(s:SourceRef)=>JSON.stringify([s.id,s.revision,s.type,s.asOf]);
  const sources=new Set(request.manifest.sources.map(key));
  const used=[...request.facts.flatMap(f=>f.sources),...request.excerpts.map(e=>e.source)];
  if(used.some(ref=>!sources.has(key(ref))))ctx.addIssue({code:'custom',message:'source_not_in_manifest'});
  if(request.manifest.sources.some(ref=>Date.parse(ref.asOf)>Date.parse(request.manifest.known_at)))ctx.addIssue({code:'custom',message:'source_after_known_at'});
});
// Model output is a proposal; parsing never executes anything or turns it into ledger facts.
export const providerResponseSchema = z.strictObject({
  request_id:idSchema, classification:z.literal('ai_generated'),
  statements:z.array(z.strictObject({kind:z.enum(['grounded_summary','interpretation','uncertainty']),text:z.string().min(1).max(4000),sources:z.array(sourceRefSchema).max(100)}).refine(x=>x.kind!=='grounded_summary'||x.sources.length>0,'grounded_summary_requires_source')).max(100),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type ContextRequirements = z.infer<typeof contextRequirementsSchema>;
export type Fact = z.infer<typeof factSchema>;
export type UntrustedExcerpt = z.infer<typeof untrustedExcerptSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type ProviderRequest = z.infer<typeof providerRequestSchema>;
export type ProviderResponse = z.infer<typeof providerResponseSchema>;
export type DeepReadonly<T> = T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
export interface ContextRepository {
  readonly readFacts:(query:DeepReadonly<{portfolio_id:string;requirements:ContextRequirements;known_at:string}>)=>Promise<DeepReadonly<Fact[]>>;
  readonly readExcerpts:(query:DeepReadonly<{portfolio_id:string;requirements:ContextRequirements;known_at:string;limit:number}>)=>Promise<DeepReadonly<UntrustedExcerpt[]>>;
  readonly readPolicy:(portfolioId:string,knownAt:string)=>Promise<DeepReadonly<z.infer<typeof policySchema>>>;
}
