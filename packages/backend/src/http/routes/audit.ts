import {
  API_CODES,
  API_PATHS,
  type ApiAuditEventDetailResponse,
  type ApiAuditEventListResponse,
  createApiSuccess,
} from '@cosmosh/api-contract';

import type { AuditEventListQuery } from '../../audit/types.js';
import { buildErrorPayload } from '../errors.js';
import { type BackendHttpApp, type BackendHttpContext, getTranslator } from '../i18n.js';
import type { BackendAppContext } from '../types.js';

/**
 * Parses a positive integer query value.
 *
 * @param value Query string value.
 * @returns Parsed integer or undefined when input is empty.
 */
const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.NaN;
  }

  return parsed;
};

/**
 * Parses an ISO date-time query value.
 *
 * @param value Query string value.
 * @returns Parsed date or undefined when input is empty.
 */
const parseDate = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Number.NaN);
  }

  return parsed;
};

/**
 * Parses and validates list endpoint query parameters.
 *
 * @param c Hono request context.
 * @returns Normalized query object or null when validation fails.
 */
const parseListQuery = (c: BackendHttpContext): AuditEventListQuery | null => {
  const page = parsePositiveInteger(c.req.query('page'));
  const pageSize = parsePositiveInteger(c.req.query('pageSize'));
  const startAt = parseDate(c.req.query('startAt'));
  const endAt = parseDate(c.req.query('endAt'));

  if (Number.isNaN(page) || Number.isNaN(pageSize)) {
    return null;
  }

  if ((startAt && Number.isNaN(startAt.getTime())) || (endAt && Number.isNaN(endAt.getTime()))) {
    return null;
  }

  if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
    return null;
  }

  const category = c.req.query('category')?.trim();
  const outcome = c.req.query('outcome')?.trim();
  const entityType = c.req.query('entityType')?.trim();
  const entityId = c.req.query('entityId')?.trim();
  const keyword = c.req.query('keyword')?.trim();

  return {
    page,
    pageSize,
    startAt,
    endAt,
    category: category && category.length > 0 ? category : undefined,
    outcome: outcome && outcome.length > 0 ? outcome : undefined,
    entityType: entityType && entityType.length > 0 ? entityType : undefined,
    entityId: entityId && entityId.length > 0 ? entityId : undefined,
    keyword: keyword && keyword.length > 0 ? keyword : undefined,
  };
};

/**
 * Registers audit list/detail routes.
 */
export const registerAuditRoutes = (app: BackendHttpApp, context: BackendAppContext): void => {
  app.get(API_PATHS.auditListEvents, async (c) => {
    const t = getTranslator(c);
    const query = parseListQuery(c);

    if (!query) {
      return c.json(buildErrorPayload(API_CODES.auditValidationFailed, t('errors.validation.invalidPayload')), 400);
    }

    const data = await context.auditEventService.listEvents(query);

    const payload: ApiAuditEventListResponse = createApiSuccess({
      code: API_CODES.auditEventListOk,
      message: t('success.audit.eventsFetched'),
      data,
    });

    return c.json(payload);
  });

  app.get(API_PATHS.auditGetEventById.replace('{eventId}', ':eventId'), async (c) => {
    const t = getTranslator(c);
    const eventId = c.req.param('eventId')?.trim();

    if (!eventId) {
      return c.json(buildErrorPayload(API_CODES.auditValidationFailed, t('errors.validation.invalidPayload')), 400);
    }

    const item = await context.auditEventService.getEventById(eventId);
    if (!item) {
      return c.json(buildErrorPayload(API_CODES.auditEventNotFound, t('errors.audit.eventNotFound')), 404);
    }

    const payload: ApiAuditEventDetailResponse = createApiSuccess({
      code: API_CODES.auditEventDetailOk,
      message: t('success.audit.eventFetched'),
      data: {
        item,
      },
    });

    return c.json(payload);
  });
};
