import path from 'node:path';

const SFTP_DOWNLOAD_TRANSFER_RETRY_RETENTION_MS = 60_000;

type SftpDownloadTargetAuthorization = {
  reusable: boolean;
};

type SftpDownloadTransferRetryAuthorization = {
  ownerWebContentsId: number;
  normalizedPath: string;
  retryReady: boolean;
  retryExpiresAt?: number;
};

/**
 * Stores exact local paths that one renderer may pass to the SFTP download backend proxy.
 *
 * Authorizations are scoped to the owning webContents so a compromised renderer cannot
 * reuse a path selected by another window.
 */
export class SftpDownloadTargetAuthorizationRegistry {
  private readonly authorizationsByOwner = new Map<number, Map<string, SftpDownloadTargetAuthorization>>();

  private readonly retryAuthorizationsByTransferId = new Map<string, SftpDownloadTransferRetryAuthorization>();

  /**
   * Authorizes one exact local path for an owning renderer.
   *
   * @param ownerWebContentsId Owning renderer webContents id.
   * @param candidatePath Main-selected local destination path.
   * @param options Authorization lifetime behavior.
   * @returns Normalized path that should be returned to the renderer.
   */
  public authorize(ownerWebContentsId: number, candidatePath: string, options: { reusable: boolean }): string {
    this.pruneExpiredTransferRetries();
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
   * Consumes a target and reserves a disabled owner-bound retry for the same transfer id.
   *
   * @param ownerWebContentsId Renderer requesting the backend download.
   * @param candidatePath Renderer-provided local destination path.
   * @param transferId Renderer-generated transfer identifier.
   * @returns Normalized authorized path.
   */
  public consumeForTransfer(ownerWebContentsId: number, candidatePath: string, transferId: string): string {
    this.pruneExpiredTransferRetries();
    const normalizedPath = this.normalizePath(candidatePath);
    const retryAuthorization = this.retryAuthorizationsByTransferId.get(transferId);
    if (retryAuthorization) {
      if (
        retryAuthorization.ownerWebContentsId !== ownerWebContentsId ||
        retryAuthorization.normalizedPath !== normalizedPath ||
        !retryAuthorization.retryReady
      ) {
        throw new Error('SFTP download retry target is not authorized for this renderer.');
      }

      this.retryAuthorizationsByTransferId.delete(transferId);
      return normalizedPath;
    }

    const authorizedPath = this.consume(ownerWebContentsId, normalizedPath);
    this.retryAuthorizationsByTransferId.set(transferId, {
      ownerWebContentsId,
      normalizedPath: authorizedPath,
      retryReady: false,
    });
    return authorizedPath;
  }

  /**
   * Enables the reserved retry only after backend confirms that the SFTP session expired.
   *
   * @param ownerWebContentsId Renderer that owns the transfer.
   * @param transferId Renderer-generated transfer identifier.
   * @returns void.
   */
  public allowTransferRetry(ownerWebContentsId: number, transferId: string): void {
    const retryAuthorization = this.retryAuthorizationsByTransferId.get(transferId);
    if (retryAuthorization?.ownerWebContentsId === ownerWebContentsId) {
      retryAuthorization.retryReady = true;
      retryAuthorization.retryExpiresAt = Date.now() + SFTP_DOWNLOAD_TRANSFER_RETRY_RETENTION_MS;
    }
  }

  /**
   * Revokes any unused retry authorization after a transfer reaches a terminal response.
   *
   * @param ownerWebContentsId Renderer that owns the transfer.
   * @param transferId Renderer-generated transfer identifier.
   * @returns void.
   */
  public completeTransfer(ownerWebContentsId: number, transferId: string): void {
    const retryAuthorization = this.retryAuthorizationsByTransferId.get(transferId);
    if (retryAuthorization?.ownerWebContentsId === ownerWebContentsId) {
      this.retryAuthorizationsByTransferId.delete(transferId);
    }
  }

  /**
   * Revokes every outstanding authorization owned by one renderer.
   *
   * @param ownerWebContentsId Renderer webContents id.
   * @returns void.
   */
  public revokeOwner(ownerWebContentsId: number): void {
    this.authorizationsByOwner.delete(ownerWebContentsId);
    for (const [transferId, authorization] of this.retryAuthorizationsByTransferId) {
      if (authorization.ownerWebContentsId === ownerWebContentsId) {
        this.retryAuthorizationsByTransferId.delete(transferId);
      }
    }
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

  /**
   * Removes enabled retry leases after their bounded reconnect window expires.
   *
   * @returns void.
   */
  private pruneExpiredTransferRetries(): void {
    const now = Date.now();
    for (const [transferId, authorization] of this.retryAuthorizationsByTransferId) {
      if (authorization.retryExpiresAt !== undefined && authorization.retryExpiresAt <= now) {
        this.retryAuthorizationsByTransferId.delete(transferId);
      }
    }
  }
}
