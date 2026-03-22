-- Introduce SSH keychain domain and migrate server-scoped credentials into hidden keychains.
PRAGMA foreign_keys=OFF;

CREATE TABLE "SshKeychainFolder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "iconKey" TEXT NOT NULL DEFAULT 'Folder',
  "colorKey" TEXT NOT NULL DEFAULT 'slate',
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SshKeychainFolder_name_key" ON "SshKeychainFolder"("name");

CREATE TABLE "SshKeychainTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SshKeychainTag_name_key" ON "SshKeychainTag"("name");

CREATE TABLE "SshKeychain" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "iconKey" TEXT NOT NULL DEFAULT 'KeyRound',
  "colorKey" TEXT NOT NULL DEFAULT 'emerald',
  "authType" TEXT NOT NULL,
  "passwordEncrypted" TEXT,
  "privateKeyEncrypted" TEXT,
  "privateKeyPassphraseEncrypted" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'hidden',
  "note" TEXT,
  "folderId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SshKeychain_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SshKeychainFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SshKeychain_folderId_idx" ON "SshKeychain"("folderId");

CREATE TABLE "SshKeychainTagLink" (
  "keychainId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "SshKeychainTagLink_keychainId_fkey" FOREIGN KEY ("keychainId") REFERENCES "SshKeychain" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SshKeychainTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "SshKeychainTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SshKeychainTagLink_keychainId_tagId_key" ON "SshKeychainTagLink"("keychainId", "tagId");
CREATE INDEX "SshKeychainTagLink_tagId_idx" ON "SshKeychainTagLink"("tagId");

ALTER TABLE "SshServer" ADD COLUMN "keychainId" TEXT;

CREATE TEMP TABLE "_SshServerKeychainMap" AS
SELECT
  "id" AS "serverId",
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))) AS "keychainId"
FROM "SshServer";

INSERT INTO "SshKeychain" (
  "id",
  "name",
  "iconKey",
  "colorKey",
  "authType",
  "passwordEncrypted",
  "privateKeyEncrypted",
  "privateKeyPassphraseEncrypted",
  "visibility",
  "note",
  "folderId",
  "createdAt",
  "updatedAt"
)
SELECT
  m."keychainId",
  CASE
    WHEN s."name" IS NULL OR trim(s."name") = '' THEN 'Imported Keychain'
    ELSE trim(s."name") || ' Keychain'
  END AS name,
  'KeyRound' AS iconKey,
  'emerald' AS colorKey,
  s."authType",
  s."passwordEncrypted",
  s."privateKeyEncrypted",
  s."privateKeyPassphraseEncrypted",
  'hidden' AS visibility,
  NULL AS note,
  NULL AS folderId,
  s."createdAt",
  s."updatedAt"
FROM "SshServer" s
JOIN "_SshServerKeychainMap" m ON m."serverId" = s."id";

UPDATE "SshServer"
SET "keychainId" = (
  SELECT "keychainId"
  FROM "_SshServerKeychainMap"
  WHERE "serverId" = "SshServer"."id"
  LIMIT 1
);

CREATE TABLE "new_SshServer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "iconKey" TEXT NOT NULL DEFAULT 'Server',
  "colorKey" TEXT NOT NULL DEFAULT 'blue',
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 22,
  "username" TEXT NOT NULL,
  "strictHostKey" BOOLEAN NOT NULL DEFAULT true,
  "keychainId" TEXT NOT NULL,
  "note" TEXT,
  "folderId" TEXT,
  "systemHostname" TEXT,
  "systemOs" TEXT,
  "systemArch" TEXT,
  "systemKernel" TEXT,
  "lastSystemSyncAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SshServer_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SshFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SshServer_keychainId_fkey" FOREIGN KEY ("keychainId") REFERENCES "SshKeychain" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_SshServer" (
  "id",
  "name",
  "iconKey",
  "colorKey",
  "host",
  "port",
  "username",
  "strictHostKey",
  "keychainId",
  "note",
  "folderId",
  "systemHostname",
  "systemOs",
  "systemArch",
  "systemKernel",
  "lastSystemSyncAt",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "name",
  "iconKey",
  "colorKey",
  "host",
  "port",
  "username",
  "strictHostKey",
  "keychainId",
  "note",
  "folderId",
  "systemHostname",
  "systemOs",
  "systemArch",
  "systemKernel",
  "lastSystemSyncAt",
  "createdAt",
  "updatedAt"
FROM "SshServer";

DROP TABLE "SshServer";
ALTER TABLE "new_SshServer" RENAME TO "SshServer";

CREATE UNIQUE INDEX "SshServer_host_port_username_key" ON "SshServer"("host", "port", "username");
CREATE INDEX "SshServer_folderId_idx" ON "SshServer"("folderId");
CREATE INDEX "SshServer_keychainId_idx" ON "SshServer"("keychainId");

DROP TABLE "_SshServerKeychainMap";

PRAGMA foreign_keys=ON;
