import { z } from 'zod';

export const visionCapabilitiesSchema = z.strictObject({ enabled: z.boolean(), providerConfigured: z.boolean(), maxBytes: z.number().int().positive(), maxRows: z.number().int().positive().max(20) });
export const visionRowSchema = z.strictObject({ name: z.string().max(120).nullable(), code: z.string().max(32).nullable(), quantityText: z.string().max(40).nullable(), unitCostText: z.string().max(40).nullable(), costBasis: z.enum(['average_cost', 'breakeven', 'unknown']), currency: z.enum(['CNY', 'USD']).nullable(), accountLabel: z.string().max(80).nullable() });
export const visionDraftSchema = z.strictObject({ requestId: z.string().min(8).max(80), status: z.literal('review_required'), rows: z.array(visionRowSchema).min(1).max(20) });
export type VisionDraft = z.infer<typeof visionDraftSchema>;
export interface VisionTransport {
  capabilities(): Promise<z.infer<typeof visionCapabilitiesSchema>>;
  recognizeFile(input: { uploadRequestId: string; recognitionRequestId: string; tempFilePath: string; size: number; mimeType: 'image/png' | 'image/jpeg' }): Promise<VisionDraft>;
}
