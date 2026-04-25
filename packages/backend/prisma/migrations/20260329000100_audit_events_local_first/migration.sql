-- Add generic local-first audit event storage and sync cursor.

CREATE TABLE "AuditEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "category" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "scopeAccountId" TEXT NOT NULL DEFAULT '',
  "scopeDeviceId" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "sessionId" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  "metadataJson" TEXT NOT NULL,
  "relatedRecordId" TEXT,
  "retentionUntilAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX "AuditEvent_category_occurredAt_idx" ON "AuditEvent"("category", "occurredAt");
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
CREATE INDEX "AuditEvent_scopeAccountId_scopeDeviceId_occurredAt_idx" ON "AuditEvent"("scopeAccountId", "scopeDeviceId", "occurredAt");

CREATE TABLE "AuditSyncCursor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scopeAccountId" TEXT NOT NULL DEFAULT '',
  "scopeDeviceId" TEXT NOT NULL,
  "lastSyncedEventId" TEXT,
  "syncedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AuditSyncCursor_scopeAccountId_scopeDeviceId_key" ON "AuditSyncCursor"("scopeAccountId", "scopeDeviceId");
CREATE INDEX "AuditSyncCursor_scopeDeviceId_idx" ON "AuditSyncCursor"("scopeDeviceId");
