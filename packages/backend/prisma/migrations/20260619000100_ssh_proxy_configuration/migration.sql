ALTER TABLE "SshServer" ADD COLUMN "proxyMode" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "SshServer" ADD COLUMN "proxyUrl" TEXT;
