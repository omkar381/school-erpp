'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { cn, initials } from '@/lib/utils';
import { formatAgo, formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface Conversation {
  id: string;
  type: string;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount?: number;
  members?: Array<{
    userId: string;
    user?: { firstName: string; lastName: string | null; avatarUrl: string | null } | null;
  }>;
}

interface Message {
  id: string;
  body: string | null;
  senderId: string;
  createdAt: string;
  sender?: { firstName: string; lastName: string | null } | null;
}

export default function MessagesPage() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const endRef = React.useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => api.get<{ items: Conversation[] }>('/chat/conversations', { limit: 50 }),
    refetchInterval: 30_000,
  });

  const messages = useQuery({
    queryKey: ['chat', 'messages', activeId],
    queryFn: () =>
      api.get<{ items: Message[] }>(`/chat/conversations/${activeId}/messages`, { limit: 100 }),
    enabled: Boolean(activeId),
    refetchInterval: activeId ? 15_000 : false,
  });

  const send = useAction({
    mutationFn: (body: string) =>
      api.post(`/chat/conversations/${activeId}/messages`, { body, type: 'TEXT' }),
    invalidates: [['chat']],
    onSuccess: () => setDraft(''),
  });

  // Newest message at the bottom, so jump there whenever the thread changes.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data, activeId]);

  const list = conversations.data?.items ?? [];
  const active = list.find((conversation) => conversation.id === activeId) ?? null;

  function nameOf(conversation: Conversation): string {
    if (conversation.title) return conversation.title;
    const other = conversation.members?.find((member) => member.userId !== currentUserId);
    return other?.user
      ? `${other.user.firstName} ${other.user.lastName ?? ''}`.trim()
      : 'Conversation';
  }

  return (
    <>
      <PageHeader title="Messages" description="Direct conversations with parents and staff." />

      <Card className="overflow-hidden">
        <div className="grid h-[calc(100vh-16rem)] min-h-96 grid-cols-1 md:grid-cols-[18rem_1fr]">
          {/* Conversation list */}
          <div
            className={cn(
              'flex flex-col border-r border-[var(--color-border)]',
              activeId && 'hidden md:flex',
            )}
          >
            {conversations.isLoading ? (
              <LoadingState label="Loading conversations" />
            ) : conversations.error ? (
              <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<MessageSquare />}
                title="No conversations"
                description="Messages from parents and staff appear here."
              />
            ) : (
              <ul className="flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
                {list.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(conversation.id)}
                      className={cn(
                        'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                        conversation.id === activeId
                          ? 'bg-[var(--color-accent-soft)]'
                          : 'hover:bg-[var(--color-surface-sunken)]',
                      )}
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                        aria-hidden
                      >
                        {initials(nameOf(conversation))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {nameOf(conversation)}
                          </span>
                          {conversation.unreadCount ? (
                            <span className="shrink-0 rounded-full bg-[var(--color-danger)] px-1.5 text-2xs font-semibold text-white tabular">
                              {conversation.unreadCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                          {conversation.lastMessagePreview ?? 'No messages yet'}
                        </span>
                        {conversation.lastMessageAt ? (
                          <span className="block text-2xs text-[var(--color-ink-faint)]">
                            {formatAgo(conversation.lastMessageAt)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Thread */}
          <div className={cn('flex flex-col', !activeId && 'hidden md:flex')}>
            {!active ? (
              <EmptyState
                icon={<MessageSquare />}
                title="Select a conversation"
                description="Choose a thread on the left to read and reply."
              />
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="md:hidden"
                    onClick={() => setActiveId(null)}
                    aria-label="Back to conversations"
                  >
                    ←
                  </Button>
                  <span className="text-sm font-semibold">{nameOf(active)}</span>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {messages.isLoading ? (
                    <LoadingState label="Loading messages" />
                  ) : (messages.data?.items ?? []).length === 0 ? (
                    <p className="py-8 text-center text-xs text-[var(--color-ink-muted)]">
                      No messages yet — say hello.
                    </p>
                  ) : (
                    (messages.data?.items ?? [])
                      .slice()
                      .reverse()
                      .map((message) => {
                        const mine = message.senderId === currentUserId;
                        return (
                          <div
                            key={message.id}
                            className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                          >
                            <div
                              className={cn(
                                'max-w-[75%] rounded-[var(--radius-md)] px-3 py-2',
                                mine
                                  ? 'bg-[var(--color-accent)] text-white'
                                  : 'bg-[var(--color-surface-sunken)]',
                              )}
                            >
                              {!mine && message.sender ? (
                                <p className="mb-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">
                                  {message.sender.firstName} {message.sender.lastName ?? ''}
                                </p>
                              ) : null}
                              <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                              <p
                                className={cn(
                                  'mt-0.5 text-2xs',
                                  mine ? 'text-white/70' : 'text-[var(--color-ink-faint)]',
                                )}
                              >
                                {formatDateTime(message.createdAt)}
                              </p>
                            </div>
                          </div>
                        );
                      })
                  )}
                  <div ref={endRef} />
                </div>

                <form
                  className="flex items-end gap-2 border-t border-[var(--color-border)] p-2.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (draft.trim()) send.mutate(draft.trim());
                  }}
                >
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter sends; Shift-Enter starts a new line, which is what
                      // every chat app has trained people to expect.
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (draft.trim()) send.mutate(draft.trim());
                      }
                    }}
                    rows={1}
                    placeholder="Write a message…"
                    aria-label="Message"
                    className="max-h-32 min-h-8 flex-1 resize-none"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="icon"
                    aria-label="Send"
                    loading={send.isPending}
                    disabled={!draft.trim()}
                  >
                    <Send />
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
