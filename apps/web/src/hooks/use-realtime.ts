'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { emitWithAck, getSocket, type ServerEvents } from '@/lib/realtime';
import { useRealtime } from '@/components/layout/realtime-provider';

/**
 * Subscribes to one server event for as long as the component is mounted.
 *
 * The handler is held in a ref so a caller can pass an inline arrow function
 * without the listener being torn down and re-added on every render.
 */
export function useRealtimeEvent<E extends keyof ServerEvents>(
  event: E,
  handler: (payload: ServerEvents[E]) => void,
  enabled = true,
): void {
  const saved = React.useRef(handler);

  React.useEffect(() => {
    saved.current = handler;
  }, [handler]);

  React.useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    if (!socket) return;

    const listener = (payload: ServerEvents[E]) => saved.current(payload);
    socket.on(event as string, listener);
    return () => {
      socket.off(event as string, listener);
    };
  }, [event, enabled]);
}

/**
 * Live messages for one conversation.
 *
 * Joining is idempotent on the server and re-checked against membership, so a
 * client cannot listen in on a conversation by passing someone else's id.
 * Incoming messages invalidate the message query rather than being spliced
 * into the cache by hand — the server decides what a message looks like, and
 * a reconciled refetch cannot drift from it.
 */
export function useConversationRealtime(
  conversationId: string | null,
  options: { onMessage?: (payload: ServerEvents['message:new']) => void } = {},
) {
  const queryClient = useQueryClient();
  const { connected } = useRealtime();
  const [typingUserIds, setTypingUserIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!conversationId || !connected) return;

    void emitWithAck('conversation:join', { conversationId });
    return () => {
      void emitWithAck('conversation:leave', { conversationId });
    };
  }, [conversationId, connected]);

  useRealtimeEvent(
    'message:new',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      options.onMessage?.(payload);
    },
    Boolean(conversationId),
  );

  useRealtimeEvent(
    'message:deleted',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
    },
    Boolean(conversationId),
  );

  useRealtimeEvent(
    'message:read',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
    },
    Boolean(conversationId),
  );

  useRealtimeEvent(
    'typing',
    (payload) => {
      if (payload.conversationId !== conversationId) return;

      setTypingUserIds((current) => {
        if (payload.isTyping) {
          return current.includes(payload.userId) ? current : [...current, payload.userId];
        }
        return current.filter((id) => id !== payload.userId);
      });
    },
    Boolean(conversationId),
  );

  // A sender who closes the tab mid-sentence never emits `isTyping: false`, so
  // the indicator is cleared on a timer as well as on the event.
  React.useEffect(() => {
    if (typingUserIds.length === 0) return;
    const timer = setTimeout(() => setTypingUserIds([]), 6_000);
    return () => clearTimeout(timer);
  }, [typingUserIds]);

  const setTyping = React.useCallback(
    (isTyping: boolean) => {
      if (!conversationId) return;
      getSocket()?.emit('typing', { conversationId, isTyping });
    },
    [conversationId],
  );

  return { typingUserIds, setTyping, connected };
}

/**
 * Live position for one vehicle.
 *
 * Returns the most recent position received, or null until the first one
 * arrives — a vehicle that is parked may not report for a while, so the caller
 * should fall back to the last known position from the REST endpoint.
 */
export function useVehicleTracking(vehicleId: string | null) {
  const { connected } = useRealtime();
  // The vehicle the reading belongs to is kept alongside it, so switching
  // vehicles discards the previous one by derivation rather than by resetting
  // state from an effect — which would briefly show one bus at another's
  // position.
  const [latest, setLatest] = React.useState<ServerEvents['transport:position'] | null>(null);

  React.useEffect(() => {
    if (!vehicleId || !connected) return;

    void emitWithAck('transport:subscribe', { vehicleId });
    return () => {
      void emitWithAck('transport:unsubscribe', { vehicleId });
    };
  }, [vehicleId, connected]);

  useRealtimeEvent(
    'transport:position',
    (payload) => {
      if (payload.vehicleId === vehicleId) setLatest(payload);
    },
    Boolean(vehicleId),
  );

  const position = latest && latest.vehicleId === vehicleId ? latest : null;

  return { position, connected };
}

/** Whether each of the given users is currently connected. */
export function usePresence(userIds: string[]) {
  const { onlineUserIds, connected } = useRealtime();
  const [seeded, setSeeded] = React.useState<ReadonlySet<string>>(new Set());

  const key = userIds.join(',');

  // Presence broadcasts only cover changes from now on, so the initial state
  // is asked for once rather than inferred from an empty set.
  React.useEffect(() => {
    if (!connected || userIds.length === 0) return;
    let cancelled = false;

    void emitWithAck('presence:check', { userIds }).then((response) => {
      if (!cancelled && response) setSeeded(new Set(response.online));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connected]);

  return React.useCallback(
    (userId: string) => onlineUserIds.has(userId) || seeded.has(userId),
    [onlineUserIds, seeded],
  );
}
