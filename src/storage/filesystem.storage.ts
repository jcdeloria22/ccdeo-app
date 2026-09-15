/**
 * Local-filesystem storage, for development.
 *
 * This exists so DC-06 can be built and tested without Docker or a cloud bucket.
 * It implements the same interface R2 will, including refusing to overwrite an
 * existing key with different content.
 *
 * ⚠ Not for anything hosted. The decisions are explicit that Railway's filesystem
 * is ephemeral and must never hold blobs. The point of the seam is that moving to
 * R2 changes this file and nothing else.
 *
 * `presignPut` returns a `file+put://` URL rather than a signed HTTPS one. It is
 * deliberately NOT an http URL: nothing should be able to mistake this for a real
 * pre-signed upload endpoint, and a test that accidentally relies on one will
 * fail loudly instead of silently passing.
 */
import { mkdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  ContentMismatchError,
  ObjectNotFoundError,
  sha256Of,
  type PresignedUpload,
  type Storage,
  type StoredObject,
} from './storage';

export class FilesystemStorage implements Storage {
  constructor(private readonly root: string) {}

  /** Two-level fan-out, the usual content-addressed layout. */
  key(sha256: string): string {
    return `blobs/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }

  private pathFor(key: string): string {
    // Keys are derived from hex hashes, never from user input, but a traversal
    // check costs nothing and the failure mode is writing outside the store.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error(`Refusing key outside the store: ${key}`);
    return full;
  }

  async presignPut(sha256: string, expiresIn = 900): Promise<PresignedUpload> {
    const key = this.key(sha256);
    await mkdir(path.dirname(this.pathFor(key)), { recursive: true });
    return { url: `file+put://${key}`, key, expiresIn };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.pathFor(key));
      const bytes = await readFile(this.pathFor(key));
      return { key, size: s.size, sha256: sha256Of(bytes) };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  async put(bytes: Buffer): Promise<StoredObject> {
    const sha256 = sha256Of(bytes);
    const key = this.key(sha256);
    const file = this.pathFor(key);

    const existing = await this.head(key);
    if (existing) {
      // Same content at the same key is a no-op, not an error: uploading the same
      // document twice is ordinary. Different content would mean a hash collision
      // or a bug, and must not pass quietly.
      if (existing.sha256 !== sha256) throw new ContentMismatchError(key);
      return existing;
    }

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
    return { key, size: bytes.length, sha256 };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }
}
