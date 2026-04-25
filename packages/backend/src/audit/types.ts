export type AuditEventOutcome = 'success' | 'failure';

export type AuditEventSeverity = 'info' | 'warning' | 'critical';

export type AuditEventCategory =
  | 'ssh-session'
  | 'ssh-server'
  | 'ssh-keychain'
  | 'settings'
  | 'ssh-host-trust'
  | 'system'
  | (string & {});

export type AuditEventInput = {
  occurredAt?: Date;
  category: AuditEventCategory;
  action: string;
  outcome: AuditEventOutcome;
  severity: AuditEventSeverity;
  scopeAccountId?: string;
  scopeDeviceId?: string;
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  relatedRecordId?: string;
};

export type AuditEventListQuery = {
  page?: number;
  pageSize?: number;
  startAt?: Date;
  endAt?: Date;
  category?: string;
  outcome?: string;
  entityType?: string;
  entityId?: string;
  keyword?: string;
};

export type AuditEventListItem = {
  eventId: string;
  occurredAt: string;
  category: string;
  action: string;
  outcome: AuditEventOutcome;
  severity: AuditEventSeverity;
  scopeAccountId: string;
  scopeDeviceId: string;
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  relatedRecordId?: string;
};

export type AuditEventDetail = AuditEventListItem & {
  metadata: Record<string, unknown>;
  retentionUntilAt: string;
};

export type AuditEventListResult = {
  items: AuditEventListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};
