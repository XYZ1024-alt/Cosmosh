-- Reuse SSH folders/tags for keychain folder/tag ownership.
PRAGMA foreign_keys=OFF;

-- Merge keychain folders into shared SSH folders by unique name.
INSERT OR IGNORE INTO "SshFolder" (
  "id",
  "name",
  "iconKey",
  "colorKey",
  "note",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "name",
  "iconKey",
  "colorKey",
  "note",
  "createdAt",
  "updatedAt"
FROM "SshKeychainFolder";

CREATE TEMP TABLE "_SshKeychainFolderMap" AS
SELECT
  keychainFolder."id" AS "oldFolderId",
  sshFolder."id" AS "newFolderId"
FROM "SshKeychainFolder" keychainFolder
JOIN "SshFolder" sshFolder ON sshFolder."name" = keychainFolder."name";

-- Merge keychain tags into shared SSH tags by unique name.
INSERT OR IGNORE INTO "SshTag" (
  "id",
  "name",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "name",
  "createdAt",
  "updatedAt"
FROM "SshKeychainTag";

CREATE TEMP TABLE "_SshKeychainTagMap" AS
SELECT
  keychainTag."id" AS "oldTagId",
  sshTag."id" AS "newTagId"
FROM "SshKeychainTag" keychainTag
JOIN "SshTag" sshTag ON sshTag."name" = keychainTag."name";

CREATE TABLE "new_SshKeychain" (
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
  CONSTRAINT "SshKeychain_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SshFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SshKeychain" (
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
  keychain."id",
  keychain."name",
  keychain."iconKey",
  keychain."colorKey",
  keychain."authType",
  keychain."passwordEncrypted",
  keychain."privateKeyEncrypted",
  keychain."privateKeyPassphraseEncrypted",
  keychain."visibility",
  keychain."note",
  mappedFolder."newFolderId",
  keychain."createdAt",
  keychain."updatedAt"
FROM "SshKeychain" keychain
LEFT JOIN "_SshKeychainFolderMap" mappedFolder ON mappedFolder."oldFolderId" = keychain."folderId";

DROP TABLE "SshKeychain";
ALTER TABLE "new_SshKeychain" RENAME TO "SshKeychain";
CREATE INDEX "SshKeychain_folderId_idx" ON "SshKeychain"("folderId");

CREATE TABLE "new_SshKeychainTagLink" (
  "keychainId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "SshKeychainTagLink_keychainId_fkey" FOREIGN KEY ("keychainId") REFERENCES "SshKeychain" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SshKeychainTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "SshTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "new_SshKeychainTagLink" (
  "keychainId",
  "tagId"
)
SELECT
  link."keychainId",
  mappedTag."newTagId"
FROM "SshKeychainTagLink" link
JOIN "_SshKeychainTagMap" mappedTag ON mappedTag."oldTagId" = link."tagId";

DROP TABLE "SshKeychainTagLink";
ALTER TABLE "new_SshKeychainTagLink" RENAME TO "SshKeychainTagLink";
CREATE UNIQUE INDEX "SshKeychainTagLink_keychainId_tagId_key" ON "SshKeychainTagLink"("keychainId", "tagId");
CREATE INDEX "SshKeychainTagLink_tagId_idx" ON "SshKeychainTagLink"("tagId");

DROP TABLE "SshKeychainFolder";
DROP TABLE "SshKeychainTag";
DROP TABLE "_SshKeychainFolderMap";
DROP TABLE "_SshKeychainTagMap";

PRAGMA foreign_keys=ON;
