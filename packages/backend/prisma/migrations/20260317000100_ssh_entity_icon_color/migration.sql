-- Persist SSH folder and server visual metadata.
ALTER TABLE "SshFolder" ADD COLUMN "iconKey" TEXT NOT NULL DEFAULT 'Folder';
ALTER TABLE "SshFolder" ADD COLUMN "colorKey" TEXT NOT NULL DEFAULT 'slate';

ALTER TABLE "SshServer" ADD COLUMN "iconKey" TEXT NOT NULL DEFAULT 'Server';
ALTER TABLE "SshServer" ADD COLUMN "colorKey" TEXT NOT NULL DEFAULT 'blue';
