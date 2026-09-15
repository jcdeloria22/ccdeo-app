/**
 * Uploads, in the shape the settled decisions require.
 *
 *   > Uploads go browser → pre-signed PUT → bucket; the API never proxies file
 *   > bytes.
 *
 * So there is no route here that accepts a file. The browser asks for a URL,
 * PUTs the bytes to it, and then tells the API what arrived; the API reads the
 * object back from storage to scan it, and refuses if what landed is not what
 * was announced.
 *
 * Locally the "bucket" is a directory and `presignPut` returns a `file+put://`
 * URL that no browser can PUT to — deliberately not an http URL, so nothing
 * mistakes it for a real endpoint. `DevStorageController` closes that gap for
 * development only, and refuses to exist anywhere else. The flow the browser
 * follows is identical either way, which is the point: the seam is exercised in
 * development rather than first tried in production.
 */
import { BadRequestException, Body, Controller, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequiresCapability } from '../policy/policy.guard';
import { UploadsRepository, type Upload } from './uploads.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { CurrentActor } from '../operator/current-actor.decorator';
import type { Actor } from '../operator/operator';
import { STORAGE } from '../storage/storage.token';
import { type Storage } from '../storage/storage';
import { Inject } from '@nestjs/common';

const SHA256 = /^[0-9a-f]{64}$/;

@Controller('projects/:projectId/slots/:slotCode/uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsRepository,
    private readonly projects: ProjectsRepository,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  /** Step one: where to put the bytes. */
  @Post('presign')
  @RequiresCapability('document.create')
  async presign(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    // Part of the route's shape, not of this step: the key is derived from the
    // content hash alone, and whether the slot exists is settled when the upload
    // is registered against it.
    @Param('slotCode') _slotCode: string,
    @Body() body: { sha256?: string },
  ): Promise<{ url: string; key: string; expiresIn: number }> {
    if (!body?.sha256 || !SHA256.test(body.sha256)) {
      throw new BadRequestException('sha256 must be the 64 hex characters of the file you intend to upload');
    }
    if (!(await this.projects.findById(projectId))) throw new NotFoundException(`No project ${projectId}`);

    const presigned = await this.storage.presignPut(body.sha256);
    return { ...presigned, url: this.browserUrl(presigned.url, presigned.key) };
  }

  /**
   * Make the presigned URL something a browser can actually PUT to.
   *
   * `FilesystemStorage` returns `file+put://<key>` on purpose — deliberately not
   * an http URL, so nothing mistakes the development store for a real endpoint or
   * quietly comes to depend on one. That leaves the browser with a URL it cannot
   * use, so the translation happens here: one place, visible, and only for the
   * filesystem implementation. R2's URL is already an https one and passes
   * through untouched.
   */
  private browserUrl(url: string, key: string): string {
    return url.startsWith('file+put://') ? `/dev-storage/${key.replace(/^blobs\//, '')}` : url;
  }

  /**
   * Step two: what arrived.
   *
   * The bytes are read back from storage and re-hashed rather than trusted. A
   * client that announces one hash and uploads another would otherwise put an
   * unscanned file into the register under a hash the audit trail believes.
   */
  @Post('register')
  @RequiresCapability('document.create')
  async register(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('slotCode') slotCode: string,
    @Body() body: { sha256?: string; filename?: string; contentType?: string | null },
    @CurrentActor() actor: Actor,
  ): Promise<{ upload: Upload }> {
    if (!body?.sha256 || !SHA256.test(body.sha256)) throw new BadRequestException('sha256 is required');
    if (!body?.filename?.trim()) throw new BadRequestException('filename is required');

    const key = this.storage.key(body.sha256);
    const head = await this.storage.head(key);
    if (!head) {
      throw new BadRequestException(
        `Nothing has been uploaded to ${key}. PUT the bytes to the presigned URL before registering them.`,
      );
    }
    if (head.sha256 !== body.sha256) {
      throw new BadRequestException(
        `What is stored at ${key} hashes to ${head.sha256}, not the ${body.sha256} you declared.`,
      );
    }

    const bytes = await this.storage.get(key);
    const upload = await this.uploads.upload(
      { projectId, slotCode, filename: body.filename.trim(), contentType: body.contentType ?? null, bytes },
      actor,
    );
    return { upload };
  }

  /**
   * Step three: scan it.
   *
   * Separate from registering because it is slow and can fail on its own. An
   * upload that is never scanned stays Quarantined, which the gate already
   * refuses — the failure mode is a blocked slot, never an admitted file.
   */
  @Post(':uploadId/scan')
  @RequiresCapability('document.create')
  async scan(@Param('uploadId', new ParseUUIDPipe()) uploadId: string): Promise<{ upload: Upload }> {
    return { upload: await this.uploads.scan(uploadId) };
  }
}
