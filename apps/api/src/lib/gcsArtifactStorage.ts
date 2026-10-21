import { Storage } from '@google-cloud/storage';
import type { ArtifactStorageAdapter } from './CloudDeckService';

/**
 * Google Cloud Storage adapter for Cloud Deck artifacts.
 * Stores large binaries (images, PDFs, etc.) in a private GCS bucket.
 */
export class GcsArtifactStorage implements ArtifactStorageAdapter {
  private storage: Storage;
  private bucketName: string;

  constructor(options?: { projectId?: string; bucketName?: string }) {
    this.storage = new Storage(options?.projectId ? { projectId: options.projectId } : {});
    this.bucketName = options?.bucketName ?? `${options?.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'stratemark-agentic'}-artifacts`;
  }

  async uploadArtifact(path: string, buffer: Buffer, mimeType: string): Promise<void> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        // Prevent public access
        acl: [],
      },
    });
  }

  async downloadArtifact(path: string): Promise<Buffer | null> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buffer] = await file.download();
      return buffer;
    } catch {
      return null;
    }
  }

  async deleteArtifact(path: string): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(path);
      await file.delete({ ignoreNotFound: true });
    } catch {
      // Best-effort deletion — ignore errors
    }
  }
}
