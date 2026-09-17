import { randomBytes } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

export interface StoredDocument {
  url: string;
  publicId: string;
}

export interface DocumentStorage {
  upload(input: {
    buffer: Buffer;
    schoolId: string;
    mimeType: string;
    originalName: string;
  }): Promise<StoredDocument>;
}

// Non-guessable public IDs (§13.5): random hex, never sequential names,
// never the original filename (which can leak PII like a child's name).
export function documentPublicId(): string {
  return `doc_${randomBytes(16).toString("hex")}`;
}

// School folder (§13.5): every file lands under its own tenant's prefix,
// so a leaked URL never ambiguates ownership.
export function documentFolder(schoolId: string): string {
  return `schools/${schoolId}/documents`;
}

class CloudinaryStorage implements DocumentStorage {
  async upload(input: {
    buffer: Buffer;
    schoolId: string;
    mimeType: string;
    originalName: string;
  }): Promise<StoredDocument> {
    const dataUri = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: documentFolder(input.schoolId),
      public_id: documentPublicId(),
      overwrite: false,
      resource_type: "auto",
    });
    return { url: uploaded.secure_url as string, publicId: uploaded.public_id as string };
  }
}

// The SDK reads CLOUDINARY_URL from the environment itself; constructing
// the provider performs no network I/O, so a missing/invalid URL only
// fails at upload time — surfaced as 503, never a crash at boot.
function cloudinaryConfigured(): boolean {
  return (process.env.CLOUDINARY_URL ?? "").length > 0;
}

let override: DocumentStorage | null = null;

// Test seam: tests inject a stub that records args (folder asserted) and
// returns a fake URL — no network, no account needed. Production always
// uses Cloudinary; there is no local-disk fallback (spec §2).
export function setDocumentStorage(storage: DocumentStorage | null): void {
  override = storage;
}

export function documentStorage(): DocumentStorage {
  if (override) {
    return override;
  }
  if (!cloudinaryConfigured()) {
    throw new StorageUnconfiguredError();
  }
  return new CloudinaryStorage();
}

export class StorageUnconfiguredError extends Error {
  constructor() {
    super("Document storage is not configured. Set CLOUDINARY_URL (see .env.example).");
  }
}
