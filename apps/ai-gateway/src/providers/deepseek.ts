import { analysisResultV2Schema, type ResearchTurnEnvelopeV1 } from '@portfolio/ai-context';

export type CredentialMode = 'sponsored' | 'byok';
export type ProviderResult = { result: ReturnType<typeof analysisResultV2Schema.parse>; providerId: string; protocol: string; model: string; credentialMode: CredentialMode; inputUnits: number; outputUnits: number };
export interface ModelProvider { invoke(envelope: ResearchTurnEnvelopeV1, executionToken: string): Promise<ProviderResult>; }
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
All array fields are required and may be empty. Use only supplied source IDs and instrument IDs. Do not return schema_version, request_id, classification, or mode; the server owns those fields. Never invent market data, tools, trades, or writes.`;

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
            { role: 'system', content: responseContract },
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
