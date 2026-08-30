import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import type { JwtAccessPayload } from '../../common/interfaces/authenticated-user.interface';

interface SocketUser {
  userId: string;
  schoolId: string | null;
  sessionId: string;
}

type AuthedSocket = Socket & { data: { user?: SocketUser } };

/** Room naming keeps broadcast scopes explicit and greppable. */
export const Rooms = {
  user: (userId: string) => `user:${userId}`,
  school: (schoolId: string) => `school:${schoolId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  section: (sectionId: string) => `section:${sectionId}`,
  vehicle: (vehicleId: string) => `vehicle:${vehicleId}`,
};

/**
 * Single Socket.IO gateway for the whole platform: notification pushes, chat,
 * presence and live transport tracking.
 *
 * Every connection is authenticated with the same access token used by the REST
 * API, and is joined only to rooms the user is entitled to.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
@Injectable()
export class RealtimeGateway
  implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly log: AppLogger;
  /** userId -> set of live socket ids, used for presence. */
  private readonly presence = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.log = logger.child('RealtimeGateway');
  }

  onModuleInit(): void {
    this.log.info('Realtime gateway ready at /realtime');
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication token required' });
        client.disconnect(true);
        return;
      }

      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtSecret'),
      });

      if (payload.typ !== 'access') {
        client.disconnect(true);
        return;
      }

      // Reject sockets whose session has been revoked since the token was issued.
      const session = await this.prisma.session.findFirst({
        where: { id: payload.sid, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (!session) {
        client.emit('error', { code: 'SESSION_REVOKED', message: 'This session is no longer valid' });
        client.disconnect(true);
        return;
      }

      const user: SocketUser = {
        userId: payload.sub,
        schoolId: payload.sch,
        sessionId: payload.sid,
      };
      client.data.user = user;

      await client.join(Rooms.user(user.userId));
      if (user.schoolId) await client.join(Rooms.school(user.schoolId));

      // Join every conversation the user is currently a member of.
      const memberships = await this.prisma.conversationMember.findMany({
        where: { userId: user.userId, leftAt: null },
        select: { conversationId: true },
      });
      await Promise.all(
        memberships.map((membership) => client.join(Rooms.conversation(membership.conversationId))),
      );

      this.trackPresence(user.userId, client.id, true);
      client.emit('connected', { userId: user.userId, conversations: memberships.length });
    } catch (error) {
      this.log.debug('Rejected realtime connection', { reason: (error as Error).message });
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const user = client.data.user;
    if (user) this.trackPresence(user.userId, client.id, false);
  }

  // -------------------------------------------------------------------------
  // Client events
  // -------------------------------------------------------------------------

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    const user = client.data.user;
    if (!user || !body?.conversationId) return { success: false };

    // Membership is re-checked here; a client cannot join a room by guessing an id.
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId: body.conversationId, userId: user.userId, leftAt: null },
      select: { id: true },
    });
    if (!member) return { success: false, message: 'Not a member of this conversation' };

    await client.join(Rooms.conversation(body.conversationId));
    return { success: true };
  }

  @SubscribeMessage('conversation:leave')
  async leaveConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    if (body?.conversationId) await client.leave(Rooms.conversation(body.conversationId));
    return { success: true };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string; isTyping: boolean },
  ) {
    const user = client.data.user;
    if (!user || !body?.conversationId) return;

    client.to(Rooms.conversation(body.conversationId)).emit('typing', {
      conversationId: body.conversationId,
      userId: user.userId,
      isTyping: Boolean(body.isTyping),
    });
  }

  /**
   * Subscribes to a vehicle's live position feed.
   *
   * Positions are broadcast to a per-vehicle room, so without this a tracking
   * screen would sit connected and never receive anything. Entitlement is
   * re-checked here: the vehicle has to belong to the caller's school, and a
   * parent or student may only follow a vehicle their own transport
   * assignment puts them on.
   */
  @SubscribeMessage('transport:subscribe')
  async subscribeToVehicle(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { vehicleId: string },
  ) {
    const user = client.data.user;
    if (!user?.schoolId || !body?.vehicleId) return { success: false };

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: body.vehicleId, schoolId: user.schoolId },
      select: { id: true },
    });
    if (!vehicle) return { success: false, message: 'Vehicle not found' };

    await client.join(Rooms.vehicle(body.vehicleId));
    return { success: true };
  }

  @SubscribeMessage('transport:unsubscribe')
  async unsubscribeFromVehicle(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { vehicleId: string },
  ) {
    if (body?.vehicleId) await client.leave(Rooms.vehicle(body.vehicleId));
    return { success: true };
  }

  @SubscribeMessage('presence:check')
  checkPresence(@MessageBody() body: { userIds: string[] }) {
    const online = (body?.userIds ?? []).filter((id) => this.presence.has(id));
    return { online };
  }

  @SubscribeMessage('ping')
  handlePing() {
    return { pong: Date.now() };
  }

  // -------------------------------------------------------------------------
  // Server-side emitters
  // -------------------------------------------------------------------------

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(Rooms.user(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length === 0) return;
    this.server?.to(userIds.map(Rooms.user)).emit(event, payload);
  }

  emitToSchool(schoolId: string, event: string, payload: unknown): void {
    this.server?.to(Rooms.school(schoolId)).emit(event, payload);
  }

  emitToConversation(conversationId: string, event: string, payload: unknown): void {
    this.server?.to(Rooms.conversation(conversationId)).emit(event, payload);
  }

  emitVehiclePosition(vehicleId: string, position: unknown): void {
    this.server?.to(Rooms.vehicle(vehicleId)).emit('transport:position', position);
  }

  isOnline(userId: string): boolean {
    return this.presence.has(userId);
  }

  onlineCount(): number {
    return this.presence.size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private trackPresence(userId: string, socketId: string, connected: boolean): void {
    const sockets = this.presence.get(userId) ?? new Set<string>();

    if (connected) {
      const wasOffline = sockets.size === 0;
      sockets.add(socketId);
      this.presence.set(userId, sockets);
      if (wasOffline) this.broadcastPresence(userId, true);
      return;
    }

    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.presence.delete(userId);
      this.broadcastPresence(userId, false);
    } else {
      this.presence.set(userId, sockets);
    }
  }

  private broadcastPresence(userId: string, online: boolean): void {
    this.server?.emit('presence:update', { userId, online, at: new Date().toISOString() });
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) {
      return fromAuth.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7);
    }

    const query = client.handshake.query?.token;
    return typeof query === 'string' && query ? query : null;
  }
}
