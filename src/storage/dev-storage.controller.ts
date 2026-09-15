/**
 * The development stand-in for a bucket.
 *
 * `presignPut` hands the browser a URL to PUT to. In production that URL points
 * at R2 and the API never sees the bytes. Locally the store is a directory, so
 * something has to accept that PUT — this does, and only this.
 *
 * It exists so the browser follows the SAME flow in development as in
 * production: ask for a URL, PUT to it, register what arrived. A development
 * shortcut that posted bytes to the API instead would mean the real path is
 * first exercised in production, which is where it must not first fail.
 *
 * It refuses to serve unless storage is the local filesystem implementation.
 * That check is the whole safety story: with R2 bound, this route is registered
 * but answers 404, so it cannot become a way to write to a real bucket.
 */
import {
  BadRequestException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../policy/policy.guard';
import { STORAGE } from './storage.token';
import { sha256Of, type Storage } from './storage';
import { FilesystemStorage } from './filesystem.storage';

/** Generous for a document, small enough that a mistake cannot exhaust memory. */
const MAX_BYTES = 64 * 1024 * 1024;

@Controller('dev-storage')
export class DevStorageController {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  /**
   * Public on purpose, and narrowly.
   *
   * A presigned URL carries its own authority — that is what "presigned" means —
   * so the browser PUTs to it without the app's credentials. The authority here
   * is the content hash: the key names the bytes, and bytes that do not hash to
   * it are refused. Nothing can be overwritten with different content, because
   * different content has a different key.
   */
  @Put(':a/:b/:sha256')
  @Public()
  async put(
    @Param('a') a: string,
    @Param('b') b: string,
    @Param('sha256') sha256: string,
    @Req() req: Request,
  ): Promise<{ key: string; size: number; sha256: string }> {
    if (!(this.storage instanceof FilesystemStorage)) {
      throw new NotFoundException('dev-storage is only served when storage is the local filesystem');
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new BadRequestException('the last path segment must be a sha256');

    const expected = this.storage.key(sha256);
    if (expected !== `blobs/${a}/${b}/${sha256}`) {
      throw new BadRequestException(`That is not where ${sha256} belongs. Use the URL presign returned.`);
    }

    const bytes = await this.read(req);
    const actual = sha256Of(bytes);
    if (actual !== sha256) {
      throw new BadRequestException(`Those bytes hash to ${actual}, not the ${sha256} the URL names.`);
    }

    const stored = await this.storage.put(bytes);
    return { key: stored.key, size: stored.size, sha256: stored.sha256 };
  }

  private read(req: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          reject(new BadRequestException(`Upload exceeds ${MAX_BYTES} bytes`));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
