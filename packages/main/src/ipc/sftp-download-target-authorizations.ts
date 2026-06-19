import path from 'node:path';

type SftpDownloadTargetAuthorization = {
  reusable: boolean;
};

/**
 * Stores exact local paths that one renderer may pass to the SFTP download backend proxy.
 *
 * Authorizations are scoped to the owning webContents so a compromised renderer cannot
 * reuse a path selected by another window.
 */
export class SftpDownloadTargetAuthorizationRegistry {
  private readonly authorizationsByOwner = new Map<number, Map<string, SftpDownloadTargetAuthorization>>();

  /**
   * Authorizes one exact local path for an owning renderer.
   *
   * @param ownerWebContentsId Owning renderer webContents id.
   * @param candidatePath Main-selected local destination path.
   * @param options Authorization lifetime behavior.
   * @returns Normalized path that should be returned to the renderer.
   */
  public authorize(ownerWebContentsId: number, candidatePath: string, options: { reusable: boolean }): string {
    const normalizedPath = this.normalizePath(candidatePath);
    const ownerAuthorizations =
      this.authorizationsByOwner.get(ownerWebContentsId) ?? new Map<string, SftpDownloadTargetAuthorization>();

    ownerAuthorizations.set(normalizedPath, {
      reusable: options.reusable,
    });
    this.authorizationsByOwner.set(ownerWebContentsId, ownerAuthorizations);
    return normalizedPath;
  }

  /**
   * Validates and consumes one renderer-owned authorization.
   *
   * @param ownerWebContentsId Renderer requesting the backend download.
   * @param candidatePath Renderer-provided local destination path.
   * @returns Normalized authorized path.
   */
  public consume(ownerWebContentsId: number, candidatePath: string): string {
    const normalizedPath = this.normalizePath(candidatePath);
    const ownerAuthorizations = this.authorizationsByOwner.get(ownerWebContentsId);
    const authorization = ownerAuthorizations?.get(normalizedPath);

    if (!ownerAuthorizations || !authorization) {
      throw new Error('SFTP download target is not authorized for this renderer.');
    }

    if (!authorization.reusable) {
      ownerAuthorizations.delete(normalizedPath);
      if (ownerAuthorizations.size === 0) {
        this.authorizationsByOwner.delete(ownerWebContentsId);
      }
    }

    return normalizedPath;
  }

  /**
   * Revokes every outstanding authorization owned by one renderer.
   *
   * @param ownerWebContentsId Renderer webContents id.
   * @returns void.
   */
  public revokeOwner(ownerWebContentsId: number): void {
    this.authorizationsByOwner.delete(ownerWebContentsId);
  }

  /**
   * Produces the canonical path representation used for authorization matching.
   *
   * @param candidatePath Local path to normalize.
   * @returns Absolute platform-aware path.
   */
  private normalizePath(candidatePath: string): string {
    if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
      throw new Error('SFTP download target path is invalid.');
    }

    const normalizedPath = path.resolve(candidatePath.trim());
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
  }
}
