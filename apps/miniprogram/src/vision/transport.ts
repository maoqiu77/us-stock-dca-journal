import { holdingVisionRowSchema, screenshotDocumentSchema } from '@portfolio/ai-context';
import { z } from 'zod';

export const visionCapabilitiesSchema = z.strictObject({ enabled: z.boolean(), providerConfigured: z.boolean(), maxBytes: z.number().int().positive(), maxRows: z.number().int().positive().max(20) });
export { holdingVisionRowSchema as visionRowSchema } from '@portfolio/ai-context';
export const visionDraftSchema = z.strictObject({ requestId: z.string().min(8).max(80), status: z.literal('review_required'), rows: z.array(holdingVisionRowSchema).max(20), document: screenshotDocumentSchema.optional(), truncated: z.boolean().optional() });
export type VisionDraft = z.infer<typeof visionDraftSchema>;
export interface VisionTransport {
  capabilities(): Promise<z.infer<typeof visionCapabilitiesSchema>>;
  recognizeFile(input: { uploadRequestId: string; recognitionRequestId: string; tempFilePath: string; size: number; mimeType: 'image/png' | 'image/jpeg' }): Promise<VisionDraft>;
}
