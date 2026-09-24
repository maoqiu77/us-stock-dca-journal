import { analysisResultV2Schema, type ResearchTurnEnvelopeV1, type ResearchTurnEnvelopeV2 } from '@portfolio/ai-context';

export type CredentialMode = 'sponsored' | 'byok';
export type ProviderResult = { result: ReturnType<typeof analysisResultV2Schema.parse>; providerId: string; protocol: string; model: string; credentialMode: CredentialMode; inputUnits: number; outputUnits: number };
export interface ModelProvider { invoke(envelope: ResearchTurnEnvelopeV1 | ResearchTurnEnvelopeV2, executionToken: string): Promise<ProviderResult>; }
export type DeepSeekConfig = { baseUrl: string; apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number; credentialMode: CredentialMode };

const responseContract = `Return exactly one JSON object with these model-owned fields:
{
  "summary": "non-empty string",
  "stance": "consider_increase | consider_reduce | maintain | observe | insufficient_data | not_applicable",
  "evidence": [{ "statement": "non-empty string", "source_ids": ["supplied source UUID"] }],
  "counterarguments": [{ "statement": "non-empty string", "source_ids": ["supplied source UUID"] }],
  "conditions": [{ "text": "non-empty string", "basis": "observed | user_assumption" }],
  "missing_information": ["non-empty string"],
  "candidates": [{ "instrument_ref": "supplied instrument UUID", "reason": "non-empty string", "source_ids": ["supplied source UUID"] }],
  "next_questions": ["non-empty string"]
}
Write a concise Chinese report: summary at most 200 Chinese characters; at most 4 evidence items, 2 counterarguments, 3 conditions, 4 missing-information items and 2 next questions. Each statement or question at most 80 Chinese characters. Cite only 1-2 source IDs per item. Summarize trends rather than listing individual candles. Lead with the trend and its main risk, without repeating evidence in the summary. For instrument research, address each requested period, MA5/MA20/MA60, support/resistance and risks in evidence and conditions, or explicitly explain unavailable inputs in missing_information. For portfolio review, assess available daily K series for held instruments, including MA5/MA20/MA60 and trend when enough bars exist; distinguish unavailable series from available ones. Compute moving averages only from enough supplied bars, merging chunks of the same receipt and series and deduplicating by bar time; never invent missing prices or indicators. Give the window and method for any support/resistance level; observed range extremes are references, not confirmed support/resistance. Conditions must explain what would strengthen or invalidate the conclusion, distinguishing observation from hypothetical future triggers. Missing personal cost/quantity limits personal P&L and sizing scenarios, not market trend analysis; describe this as optional personal information. Never say information is missing in the summary while returning no corresponding missing_information. Do not emit placeholder missing items such as 无 or none. Suggest up to two specific next questions. Mention adjustment limitations once, and distinguish trading date, market observation time and retrieval time. All array fields are required and may be empty. Use only supplied source IDs and instrument IDs. Do not return schema_version, request_id, classification, or mode; the server owns those fields. Never invent market data, tools, trades, or writes.
For portfolio_review and instrument_research, make the summary sound like a thoughtful person speaking to the user in natural Chinese: 2-3 short sentences, a clear judgment first, then the main reason and a practical next step. Address the actual holding or symbol where known. Examples of tone, not facts to copy: “这只股票目前走势偏弱，先不建议您急着加仓；等趋势改善再重新评估。” “这几只持仓的走势并不一致，您可以先关注波动较大的那一只。” Avoid cold report openings such as “当前仅有…” or “数据不足导致的误判”; when data really is missing, say plainly and kindly what cannot yet be judged. A brief “恭喜🎉” is appropriate only when supplied personal records confirm a gain; a rising candle alone does not prove this user made money. Say “今天” only when the supplied observation is from the current, completed trading day. Say “暂不建议加仓” only when the observed risk supports it; say “可考虑小幅加仓” only as a conditional possibility when trend evidence and the user's cash and position limits support it. Never infer a trade size or promise a return. Keep evidence, counterarguments, conditions, and missing_information precise and source-grounded; a warmer tone must not weaken the data rules above.`;

export function createDeepSeekProvider(config: DeepSeekConfig, fetchImpl: typeof fetch = fetch): ModelProvider {
  if (config.baseUrl !== 'https://api.deepseek.com' || !config.apiKey || config.model !== 'deepseek-flash') throw Error('PROVIDER_CONFIG_INVALID');
  return { async invoke(envelope, executionToken) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', 'x-idempotency-key': executionToken },
        body: JSON.stringify({
          model: config.model, stream: false, thinking: { type: 'disabled' }, max_tokens: config.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${responseContract}${envelope.request.mode === 'follow_up' ? '\nFor follow_up, answer only the latest user question in a natural conversational summary. Do not repeat the initial report. Keep evidence, counterarguments, conditions, missing_information, candidates, and next_questions empty unless the user explicitly asks for one of those lists.' : ''}` },
            ...envelope.history.map(item => ({ role: item.role, content: item.content })),
            { role: 'user', content: JSON.stringify({ request: envelope.request, target: envelope.target, source_snapshots: envelope.source_snapshots }) },
          ],
        }),
      });
      if (!response.ok) throw Error(`PROVIDER_HTTP_${response.status}`);
      const body = await response.json() as { model?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const choice = body.choices?.[0], content = choice?.message?.content;
      if (choice?.finish_reason === 'length') throw Error('PROVIDER_OUTPUT_TRUNCATED');
      if (typeof content !== 'string' || !content.trim()) throw Error('PROVIDER_RESPONSE_INVALID');
      let parsed: unknown; try { parsed = JSON.parse(content); } catch { throw Error('PROVIDER_JSON_INVALID'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('PROVIDER_RESPONSE_INVALID');
      const semantic = parsed as Record<string, unknown>;
      const validated = analysisResultV2Schema.safeParse({
        schema_version: 2,
        request_id: envelope.request.request_id,
        classification: 'ai_generated',
        mode: envelope.request.mode,
        summary: semantic.summary,
        stance: semantic.stance,
        evidence: semantic.evidence,
        counterarguments: semantic.counterarguments,
        conditions: semantic.conditions,
        missing_information: semantic.missing_information,
        candidates: semantic.candidates,
        next_questions: semantic.next_questions,
      });
      if (!validated.success) throw Error('PROVIDER_RESPONSE_INVALID');
      const result = validated.data;
      return { result, providerId: 'deepseek', protocol: 'openai-compatible-chat-completions', model: typeof body.model === 'string' ? body.model : config.model, credentialMode: config.credentialMode, inputUnits: body.usage?.prompt_tokens ?? 0, outputUnits: body.usage?.completion_tokens ?? 0 };
    } finally { clearTimeout(timer); }
  } };
}
