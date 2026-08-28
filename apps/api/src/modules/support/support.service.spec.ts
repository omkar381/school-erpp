import { RoleType, TicketPriority, TicketStatus } from '@prisma/client';
import { SupportService } from './support.service';
import { PERMISSIONS } from '../../common/constants/permissions';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TicketQueryDto } from './dto/support.dto';

/** A real DTO instance, so `skip`, `take` and `buildOrderBy` behave as they do in production. */
function query(overrides: Partial<TicketQueryDto> = {}): TicketQueryDto {
  return Object.assign(new TicketQueryDto(), { page: 1, limit: 25, sortOrder: 'desc' }, overrides);
}

function principal(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    schoolId: 'school-1',
    email: 'parent@example.com',
    phone: null,
    firstName: 'Asha',
    lastName: 'Rao',
    displayName: 'Asha Rao',
    avatarUrl: null,
    status: 'ACTIVE',
    locale: 'en',
    timezone: null,
    roles: [RoleType.PARENT],
    permissions: [PERMISSIONS.SUPPORT_TICKETS_VIEW, PERMISSIONS.SUPPORT_TICKETS_CREATE],
    isSuperAdmin: false,
    mustChangePassword: false,
    staffId: null,
    studentId: null,
    guardianId: 'guardian-1',
    sessionId: 'session-1',
    ...overrides,
  } as AuthenticatedUser;
}

const AGENT = principal({
  id: 'agent-1',
  roles: [RoleType.SCHOOL_ADMIN],
  permissions: [
    PERMISSIONS.SUPPORT_TICKETS_VIEW,
    PERMISSIONS.SUPPORT_TICKETS_CREATE,
    PERMISSIONS.SUPPORT_TICKETS_MANAGE,
  ],
});

const PLATFORM = principal({
  id: 'super-1',
  schoolId: null,
  roles: [RoleType.SUPER_ADMIN],
  isSuperAdmin: true,
  permissions: [],
});

function buildService() {
  const prisma = {
    supportTicket: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ticketMessage: { create: jest.fn().mockResolvedValue({ id: 'message-1' }) },
    attachment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn() },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };

  const audit = { record: jest.fn(), diff: jest.fn() };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const sequences = { next: jest.fn().mockResolvedValue('TKT/00001') };
  const storage = { upload: jest.fn() };
  const logger = {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  };

  const service = new SupportService(
    prisma as never,
    audit as never,
    notifications as never,
    sequences as never,
    storage as never,
    logger as never,
  );

  return { service, prisma, audit, notifications };
}

/** Reads the scope clause the service put in front of every other filter. */
function scopeOf(call: { where: { AND: unknown[] } }): Record<string, unknown> {
  return call.where.AND[0] as Record<string, unknown>;
}

describe('SupportService visibility', () => {
  it('shows a requester only the tickets they raised', async () => {
    const { service, prisma } = buildService();

    await service.findAll('school-1', principal(), query());

    expect(scopeOf(prisma.supportTicket.findMany.mock.calls[0][0])).toEqual({
      schoolId: 'school-1',
      requesterId: 'user-1',
    });
  });

  it('shows a school agent every ticket in their own school and no other', async () => {
    const { service, prisma } = buildService();

    await service.findAll('school-1', AGENT, query());

    expect(scopeOf(prisma.supportTicket.findMany.mock.calls[0][0])).toEqual({
      schoolId: 'school-1',
    });
  });

  it('shows platform support every ticket', async () => {
    const { service, prisma } = buildService();

    await service.findAll(null, PLATFORM, query());

    expect(scopeOf(prisma.supportTicket.findMany.mock.calls[0][0])).toEqual({});
  });

  it('ignores a schoolId filter from a caller who is not platform support', async () => {
    const { service, prisma } = buildService();

    await service.findAll('school-1', AGENT, query({ schoolId: 'school-2' }));

    const call = prisma.supportTicket.findMany.mock.calls[0][0];
    expect(scopeOf(call)).toEqual({ schoolId: 'school-1' });
    expect(call.where.AND[1]).not.toHaveProperty('schoolId');
  });

  it('ignores a requesterId filter from a caller who is not an agent', async () => {
    const { service, prisma } = buildService();

    await service.findAll('school-1', principal(), query({ requesterId: 'someone-else' }));

    expect(scopeOf(prisma.supportTicket.findMany.mock.calls[0][0])).toEqual({
      schoolId: 'school-1',
      requesterId: 'user-1',
    });
  });

  it('hides internal notes from the requester and shows them to an agent', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      status: TicketStatus.OPEN,
      messages: [],
    });

    await service.findOne('school-1', principal(), 'ticket-1');
    expect(prisma.supportTicket.findFirst.mock.calls[0][0].include.messages.where).toEqual({
      isInternal: false,
    });

    await service.findOne('school-1', AGENT, 'ticket-1');
    expect(prisma.supportTicket.findFirst.mock.calls[1][0].include.messages.where).toEqual({});
  });
});

describe('SupportService replies', () => {
  const ticket = {
    id: 'ticket-1',
    schoolId: 'school-1',
    ticketNumber: 'TKT/00001',
    subject: 'Cannot log in',
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    category: 'ACCOUNT',
    requesterId: 'user-1',
    assigneeId: null,
    firstResponseAt: null,
  };

  it('refuses an internal note from a requester and posts it as a visible reply', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await service.reply('school-1', principal(), 'ticket-1', {
      body: 'still broken',
      isInternal: true,
    } as never);

    expect(prisma.ticketMessage.create.mock.calls[0][0].data.isInternal).toBe(false);
  });

  it('lets an agent post a genuine internal note', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await service.reply('school-1', AGENT, 'ticket-1', {
      body: 'checked the audit log',
      isInternal: true,
    } as never);

    expect(prisma.ticketMessage.create.mock.calls[0][0].data.isInternal).toBe(true);
  });

  it('records the first response only for a visible agent reply', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await service.reply('school-1', AGENT, 'ticket-1', { body: 'looking into it' } as never);
    expect(prisma.supportTicket.update.mock.calls[0][0].data.firstResponseAt).toBeInstanceOf(Date);

    prisma.supportTicket.update.mockClear();
    await service.reply('school-1', principal(), 'ticket-1', { body: 'thanks' } as never);
    expect(prisma.supportTicket.update.mock.calls[0][0].data.firstResponseAt).toBeUndefined();
  });

  it('refuses a reply on a closed ticket', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue({ ...ticket, status: TicketStatus.CLOSED });

    await expect(
      service.reply('school-1', principal(), 'ticket-1', { body: 'hello' } as never),
    ).rejects.toThrow(/closed/i);
  });

  it('moves an open ticket to in progress when an agent answers', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await service.reply('school-1', AGENT, 'ticket-1', { body: 'on it' } as never);

    expect(prisma.supportTicket.update.mock.calls[0][0].data.status).toBe(
      TicketStatus.IN_PROGRESS,
    );
  });

  it('reopens a resolved ticket when the requester says it is not fixed', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue({
      ...ticket,
      status: TicketStatus.RESOLVED,
    });

    await service.reply('school-1', principal(), 'ticket-1', { body: 'still broken' } as never);

    const data = prisma.supportTicket.update.mock.calls[0][0].data;
    expect(data.status).toBe(TicketStatus.IN_PROGRESS);
    expect(data.resolvedAt).toBeNull();
  });
});

describe('SupportService management', () => {
  const ticket = {
    id: 'ticket-1',
    schoolId: 'school-1',
    ticketNumber: 'TKT/00001',
    subject: 'Cannot log in',
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    category: 'ACCOUNT',
    requesterId: 'user-1',
    assigneeId: null,
    firstResponseAt: null,
  };

  it('refuses to let a requester change status or priority', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await expect(
      service.update('school-1', principal(), 'ticket-1', {
        priority: TicketPriority.CRITICAL,
      } as never),
    ).rejects.toThrow(/support staff/i);
  });

  it('refuses to let a requester assign a ticket', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);

    await expect(
      service.assign('school-1', principal(), 'ticket-1', { assigneeId: 'agent-1' } as never),
    ).rejects.toThrow(/support staff/i);
  });

  it('refuses to assign a school ticket to somebody from another school', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);
    prisma.user.findFirst.mockResolvedValue({
      id: 'outsider',
      firstName: 'Ravi',
      lastName: null,
      schoolId: 'school-2',
    });

    await expect(
      service.assign('school-1', AGENT, 'ticket-1', { assigneeId: 'outsider' } as never),
    ).rejects.toThrow(/your own school/i);
  });

  it('clears the resolution timestamps when a ticket is reopened', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue({
      ...ticket,
      status: TicketStatus.RESOLVED,
    });
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1',
      ticketNumber: 'TKT/00001',
      status: TicketStatus.OPEN,
      priority: TicketPriority.MEDIUM,
      category: 'ACCOUNT',
    });

    await service.update('school-1', AGENT, 'ticket-1', { status: TicketStatus.OPEN } as never);

    expect(prisma.supportTicket.update.mock.calls[0][0].data).toMatchObject({
      status: TicketStatus.OPEN,
      resolvedAt: null,
      closedAt: null,
    });
  });

  it('stamps resolvedAt when a ticket is resolved', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.findFirst.mockResolvedValue(ticket);
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1',
      ticketNumber: 'TKT/00001',
      status: TicketStatus.RESOLVED,
      priority: TicketPriority.MEDIUM,
      category: 'ACCOUNT',
    });

    await service.update('school-1', AGENT, 'ticket-1', {
      status: TicketStatus.RESOLVED,
    } as never);

    expect(prisma.supportTicket.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it('claims only the author’s own unattached uploads', async () => {
    const { service, prisma } = buildService();
    prisma.supportTicket.create.mockResolvedValue({
      id: 'ticket-1',
      ticketNumber: 'TKT/00001',
      subject: 'Cannot log in',
      category: 'ACCOUNT',
      priority: TicketPriority.MEDIUM,
    });

    await service.create('school-1', principal(), {
      subject: 'Cannot log in',
      description: 'The password reset email never arrives.',
      attachmentIds: ['file-1'],
    } as never);

    expect(prisma.attachment.updateMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ['file-1'] },
      uploadedById: 'user-1',
      ticketId: null,
      ticketMessageId: null,
    });
  });

  it('audits every ticket creation', async () => {
    const { service, prisma, audit } = buildService();
    prisma.supportTicket.create.mockResolvedValue({
      id: 'ticket-1',
      ticketNumber: 'TKT/00001',
      subject: 'Cannot log in',
      category: 'ACCOUNT',
      priority: TicketPriority.MEDIUM,
    });

    await service.create('school-1', principal(), {
      subject: 'Cannot log in',
      description: 'The password reset email never arrives.',
    } as never);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'support', entity: 'SupportTicket' }),
    );
  });
});
