-- Add strict host key policy persistence on SSH servers.
ALTER TABLE "SshServer"
ADD COLUMN "strictHostKey" BOOLEAN NOT NULL DEFAULT true;
