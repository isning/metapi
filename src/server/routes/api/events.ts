import { FastifyInstance } from 'fastify';

import {
  applyInboxAction,
  clearInboxItems,
  countUnreadInboxItems,
  listInboxItems,
  markAllInboxItemsRead,
  markInboxItemRead,
} from '../../services/inboxService.js';
import type { InboxActionRequest, InboxListQuery } from '../../../shared/inbox.js';

type EventsQuery = {
  limit?: string;
  offset?: string;
  type?: string;
  read?: string;
  scope?: string;
  category?: string;
  state?: string;
  subjectType?: string;
  includeSnoozed?: string;
};

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function toInboxQuery(query: EventsQuery): InboxListQuery & { includeSnoozed?: boolean } {
  return {
    limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
    offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
    type: query.type,
    read: parseBooleanQuery(query.read),
    scope: query.scope as InboxListQuery['scope'],
    category: query.category as InboxListQuery['category'],
    state: query.state as InboxListQuery['state'],
    subjectType: query.subjectType,
    includeSnoozed: parseBooleanQuery(query.includeSnoozed),
  };
}

export async function eventsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: EventsQuery }>('/api/events', async (request) => {
    return await listInboxItems(toInboxQuery(request.query));
  });

  app.get<{ Querystring: Pick<EventsQuery, 'scope' | 'category' | 'state' | 'subjectType'> }>('/api/events/count', async (request) => {
    const count = await countUnreadInboxItems({
      scope: request.query.scope as InboxListQuery['scope'],
      category: request.query.category as InboxListQuery['category'],
      state: request.query.state as InboxListQuery['state'],
      subjectType: request.query.subjectType,
    });
    return { count };
  });

  app.post<{ Params: { id: string } }>('/api/events/:id/read', async (request) => {
    const id = Number.parseInt(request.params.id, 10);
    await markInboxItemRead(id);
    return { success: true };
  });

  app.post<{ Params: { id: string }; Body: InboxActionRequest }>('/api/events/:id/action', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const command = request.body?.command;
    if (!command) {
      reply.code(400);
      return { error: 'command is required' };
    }

    const item = await applyInboxAction(id, command, { snoozeUntil: request.body?.snoozeUntil });
    if (!item) {
      reply.code(404);
      return { error: 'event not found' };
    }
    return { success: true, item };
  });

  app.post<{ Querystring: Pick<EventsQuery, 'scope' | 'category' | 'type' | 'state' | 'subjectType'> }>('/api/events/read-all', async (request) => {
    await markAllInboxItemsRead({
      scope: request.query.scope as InboxListQuery['scope'],
      category: request.query.category as InboxListQuery['category'],
      type: request.query.type,
      state: request.query.state as InboxListQuery['state'],
      subjectType: request.query.subjectType,
    });
    return { success: true };
  });

  app.delete<{ Querystring: Pick<EventsQuery, 'scope' | 'category' | 'type' | 'state' | 'subjectType' | 'read'> }>('/api/events', async (request) => {
    await clearInboxItems({
      scope: request.query.scope as InboxListQuery['scope'],
      category: request.query.category as InboxListQuery['category'],
      type: request.query.type,
      state: request.query.state as InboxListQuery['state'],
      subjectType: request.query.subjectType,
      read: parseBooleanQuery(request.query.read),
    });
    return { success: true };
  });
}
