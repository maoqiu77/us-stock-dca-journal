import assert from 'node:assert/strict';
import test from 'node:test';
import {canConfirm, emptyRequest, conversationRequest, followUpRequest, runIsActive} from './state.ts';
import type {JournalPreview} from './api.ts';

test('legacy drafts confirm against server defaults and property order',()=>{
 const draft=emptyRequest();draft.question='synthetic';
 const request={engine:'llm' as const,agent_version:1 as const,market_policy:'frozen' as const,memory_mode:'selected' as const,memory_excluded_ids:[],...draft};
 const preview={request,expires_at:'2026-09-30T12:00:00Z'} as JournalPreview;
 assert.equal(canConfirm(preview,draft,0),true);
 assert.equal(canConfirm(preview,{...draft,question:'changed'},0),false);
 assert.equal(canConfirm(preview,draft,Date.parse(preview.expires_at)),false);
});

test('follow-up retains scope, assumptions and minimal prior turn',()=>{
 const request={...emptyRequest('US:XNAS:NVDA:STOCK'),engine:'agent' as const,question:'synthetic',
  note_ids:['n'],trade_ids:['t'],plan_tickers:['NVDA'],quantity:'3',cost:'12',cost_currency:'USD',memory_excluded_ids:['excluded']};
 const preview={id:'snapshot',request} as JournalPreview;
 const next=followUpRequest(preview,'session','prior-turn');
 assert.deepEqual(next.note_ids,['n']);assert.deepEqual(next.trade_ids,['t']);assert.deepEqual(next.plan_tickers,['NVDA']);
 assert.deepEqual(next.history_turn_ids,['prior-turn']);assert.deepEqual(next.memory_excluded_ids,['excluded']);
 assert.equal(next.quantity,'3');assert.equal(next.cost,'12');assert.equal(next.engine,'agent');
 assert.equal(next.reuse_snapshot_id,'snapshot');
});

test('automatic conversations refresh current scope and unknown runs never auto-resend',()=>{
 const request=conversationRequest();assert.equal(request.task_type,'conversation');assert.equal(request.auto_context,true);
 const next=followUpRequest({id:'old',request} as JournalPreview,'session','prior');
 assert.equal(next.reuse_snapshot_id,null);
 assert.equal(runIsActive('running'),true);assert.equal(runIsActive('queued'),true);
 assert.equal(runIsActive('outcome_unknown'),false);assert.equal(runIsActive('cancelled'),false);
});

test('Agent option changes invalidate confirmation',()=>{
 const draft={...emptyRequest(),engine:'agent' as const};
 const preview={request:draft,expires_at:'2026-09-30T12:00:00Z'} as JournalPreview;
 for(const changed of [{engine:'llm' as const},{market_policy:'refresh_within_scope' as const},{memory_mode:'suggest_related' as const},{memory_excluded_ids:['a']}]){
  assert.equal(canConfirm(preview,{...draft,...changed},0),false);
 }
});
