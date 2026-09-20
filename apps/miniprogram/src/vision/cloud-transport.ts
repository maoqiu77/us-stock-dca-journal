import { visionCapabilitiesSchema, visionDraftSchema, type VisionTransport } from './transport.ts';

type CloudCall = (options: { name: string; data: any }) => Promise<{ result?: unknown }>;
type Upload = (options: { cloudPath: string; filePath: string }) => Promise<{ fileID: string }>;

export function createCloudVisionTransport(callFunction: CloudCall, uploadFile: Upload, functionName: string): VisionTransport {
  if (!functionName.trim()) throw Error('云函数名未配置。');
  async function call(data: any) {
    const response = await callFunction({ name: functionName, data });
    const result = response.result as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
    if (!result?.ok) throw Error(result?.error?.message ?? result?.error?.code ?? '云函数返回无效。');
    return result.data;
  }
  return {
    capabilities: async () => visionCapabilitiesSchema.parse(await call({ action: 'visionCapabilities' })),
    async recognizeFile(input) {
      const upload = await call({ action: 'createHoldingUpload', requestId: input.uploadRequestId, contentLength: input.size, mimeType: input.mimeType }) as { uploadTaskId: string; cloudPath: string };
      try {
        const object = await uploadFile({ cloudPath: upload.cloudPath, filePath: input.tempFilePath });
        await call({ action: 'completeHoldingUpload', uploadTaskId: upload.uploadTaskId, fileId: object.fileID });
        return visionDraftSchema.parse(await call({ action: 'recognizeHoldings', requestId: input.recognitionRequestId, uploadTaskId: upload.uploadTaskId }));
      } catch (error) {
        try { await call({ action: 'cancelHoldingUpload', uploadTaskId: upload.uploadTaskId }); } catch { /* server expiry cleanup remains the fallback */ }
        throw error;
      }
    },
  };
}
