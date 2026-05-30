-- CreateTable
CREATE TABLE "PortForwardRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "localBindHost" TEXT,
    "localBindPort" INTEGER,
    "remoteBindHost" TEXT,
    "remoteBindPort" INTEGER,
    "targetHost" TEXT,
    "targetPort" INTEGER,
    "note" TEXT,
    "lastStartedAt" DATETIME,
    "lastStoppedAt" DATETIME,
    "lastFailureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PortForwardRule_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "SshServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PortForwardRule_serverId_idx" ON "PortForwardRule"("serverId");

-- CreateIndex
CREATE INDEX "PortForwardRule_type_idx" ON "PortForwardRule"("type");
