'use client';

import { io, type Socket } from 'socket.io-client';
import { readTokens } from './auth-store';

/**
 * Events the server sends. Keeping them in one place means a rename on the
 * gateway shows up as a type error here rather than as a listener that quietly
 * never fires.
 */
export interface ServerEvents {
  connected: { userId: string; conversations: number };
  error: { code: string; message: string };

  'notification:new': {
    id: string;
    type: string;
    title: string;
    body: string | null;
    priority: string;
    actionUrl: string | null;
    createdAt: string;
  };

  'message:new': {
    id: string;
    conversationId: string;
    senderId: string | null;
    body: string | null;
    type: string;
    createdAt: string;
    [key: string]: unknown;
  };
  'message:read': { conversationId: string; userId: string; readAt: string };
  'message:deleted': { conversationId: string; messageId: string };
  'conversation:created': { conversationId: string; [key: string]: unknown };
  'conversation:locked': { conversationId: string; [key: string]: unknown };

  typing: { conversationId: string; userId: string; isTyping: boolean };
  'presence:update': { userId: string; online: boolean; at: string };

  'transport:position': {
    vehicleId: string;
    registrationNumber: string;
    latitude: unknown;
    longitude: unknown;
    speedKph: unknown;
    recordedAt: string;
  };
}

export type ServerEventName = keyof ServerEvents;

/** Events the client sends, with the acknowledgement each one returns. */
export interface ClientEvents {
  'conversation:join': [{ conversationId: string }, { success: boolean; message?: string }];
  'conversation:leave': [{ conversationId: string }, { success: boolean }];
  'transport:subscribe': [{ vehicleId: string }, { success: boolean; message?: string }];
  'transport:unsubscribe': [{ vehicleId: string }, { success: boolean }];
  typing: [{ conversationId: string; isTyping: boolean }, void];
  'presence:check': [{ userIds: string[] }, { online: string[] }];
  ping: [undefined, { pong: number }];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * The socket namespace lives on the API host, not under the REST path prefix,
 * so `/api/v1` is stripped before `/realtime` is appended.
 */
function realtimeUrl(): string {
  try {
    const url = new URL(API_URL);
    return `${url.origin}/realtime`;
  } catch {
    return 'http://localhost:4000/realtime';
  }
}

let socket: Socket | null = null;

/**
 * The one socket the app uses.
 *
 * Created lazily on first use and reused thereafter, because Socket.IO
 * multiplexes every room over a single connection — opening one per screen
 * would multiply handshakes and presence churn for no benefit.
 *
 * The token is read from the auth store at connect time rather than captured,
 * so a refresh that rotates the pair is picked up by the next reconnect.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;

  const tokens = readTokens();
  if (!tokens) return null;

  if (socket) return socket;

  socket = io(realtimeUrl(), {
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: readTokens()?.accessToken ?? '' }),
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    // Backs off to 10s rather than hammering a server that is restarting.
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  });

  return socket;
}

/**
 * Tears the connection down.
 *
 * Called on sign-out: the socket is authenticated with the session that just
 * ended, and leaving it open would keep delivering another user's rooms to a
 * browser that is no longer entitled to them.
 */
export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/**
 * Connection status as an external store.
 *
 * Exposed this way so React can read it with `useSyncExternalStore` instead of
 * mirroring it into component state — the socket is the source of truth, and
 * copying it into `useState` from an effect is what produces the cascading
 * render this avoids.
 */
export function subscribeToConnection(onChange: () => void): () => void {
  const active = getSocket();
  if (!active) return () => {};

  active.on('connect', onChange);
  active.on('disconnect', onChange);

  return () => {
    active.off('connect', onChange);
    active.off('disconnect', onChange);
  };
}

export function getConnectionSnapshot(): boolean {
  return socket?.connected ?? false;
}

/** The server snapshot: there is no socket during rendering on the server. */
export function getServerConnectionSnapshot(): boolean {
  return false;
}

/** Emits an event and resolves with the server's acknowledgement. */
export function emitWithAck<E extends keyof ClientEvents>(
  event: E,
  payload: ClientEvents[E][0],
  timeoutMs = 5_000,
): Promise<ClientEvents[E][1] | null> {
  const active = getSocket();
  if (!active) return Promise.resolve(null);

  return new Promise((resolve) => {
    active
      .timeout(timeoutMs)
      .emit(event as string, payload, (error: unknown, response: ClientEvents[E][1]) => {
        resolve(error ? null : response);
      });
  });
}
