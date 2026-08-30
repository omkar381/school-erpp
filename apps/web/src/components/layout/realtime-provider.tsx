'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import {
  disconnectSocket,
  getConnectionSnapshot,
  getServerConnectionSnapshot,
  getSocket,
  subscribeToConnection,
  type ServerEvents,
} from '@/lib/realtime';

interface RealtimeState {
  /** True once the gateway has accepted the connection. */
  connected: boolean;
  /** User ids currently online, maintained from presence broadcasts. */
  onlineUserIds: ReadonlySet<string>;
}

const NOBODY: ReadonlySet<string> = new Set();

const RealtimeContext = React.createContext<RealtimeState>({
  connected: false,
  onlineUserIds: NOBODY,
});

export function useRealtime(): RealtimeState {
  return React.useContext(RealtimeContext);
}

/**
 * Owns the single socket connection for the authenticated shell.
 *
 * Two jobs live here rather than in the pages: keeping the connection's
 * lifecycle tied to the session, and handling the events that matter
 * everywhere — a new notification has to update the topbar badge whether or
 * not the notifications page happens to be open.
 *
 * Per-screen concerns (a conversation's messages, one vehicle's position) are
 * subscribed by the hooks in `use-realtime`, so this provider does not need to
 * know what the user is looking at.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const tokens = useAuthStore((state) => state.tokens);
  const accessToken = tokens?.accessToken ?? null;

  const [presence, setPresence] = React.useState<ReadonlySet<string>>(NOBODY);

  // Re-subscribes when the session changes, so a sign-in after a sign-out
  // attaches to the new socket rather than the closed one.
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeToConnection(onChange),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken],
  );

  const socketConnected = React.useSyncExternalStore(
    subscribe,
    getConnectionSnapshot,
    getServerConnectionSnapshot,
  );

  React.useEffect(() => {
    if (!accessToken) {
      disconnectSocket();
      return;
    }

    const socket = getSocket();
    if (!socket) return;

    const onError = (payload: ServerEvents['error']) => {
      // A revoked session will not recover by retrying, so the socket is closed
      // rather than left reconnecting in a loop against a token the server has
      // already rejected. The API client handles signing the user out.
      if (payload.code === 'UNAUTHORIZED' || payload.code === 'SESSION_REVOKED') {
        disconnectSocket();
      }
    };

    const onNotification = (payload: ServerEvents['notification:new']) => {
      // The topbar bell and the notifications page use separate query keys,
      // so both are refreshed rather than only whichever happens to be mounted.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });

      toast(payload.title, {
        description: payload.body ?? undefined,
        action: payload.actionUrl
          ? { label: 'View', onClick: () => window.location.assign(payload.actionUrl!) }
          : undefined,
      });
    };

    const onPresence = (payload: ServerEvents['presence:update']) => {
      setPresence((current) => {
        const next = new Set(current);
        if (payload.online) next.add(payload.userId);
        else next.delete(payload.userId);
        return next;
      });
    };

    // A new conversation arrives for members who were not on the screen that
    // created it, so the list has to be refreshed wherever they are.
    const onConversationCreated = () => {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    };

    socket.on('error', onError);
    socket.on('notification:new', onNotification);
    socket.on('presence:update', onPresence);
    socket.on('conversation:created', onConversationCreated);

    return () => {
      socket.off('error', onError);
      socket.off('notification:new', onNotification);
      socket.off('presence:update', onPresence);
      socket.off('conversation:created', onConversationCreated);
    };
  }, [accessToken, queryClient]);

  // Closes the connection when the shell unmounts, e.g. on sign-out.
  React.useEffect(() => () => disconnectSocket(), []);

  const value = React.useMemo(
    () => ({
      // Both are gated on the session rather than cleared from an effect, so a
      // sign-out reports "offline, nobody present" on the very next render.
      connected: Boolean(accessToken) && socketConnected,
      onlineUserIds: accessToken ? presence : NOBODY,
    }),
    [accessToken, socketConnected, presence],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
