'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { cn } from '@/lib/utils';
import { formatAgo, formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '@/components/ui/states';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const list = useListQuery<NotificationRow>('notifications-page', '/notifications', {
    initialLimit: 30,
  });

  const markRead = useAction({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    invalidates: [['notifications-page'], ['notifications']],
  });

  const markAll = useAction({
    mutationFn: () => api.post('/notifications/read-all'),
    successMessage: 'All notifications marked as read',
    invalidates: [['notifications-page'], ['notifications']],
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything the system has sent you, and how you want to be told."
        actions={
          <Button
            size="sm"
            loading={markAll.isPending}
            onClick={() => markAll.mutate(undefined)}
            icon={<CheckCheck />}
          >
            Mark all read
          </Button>
        }
      />

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="preferences">
          <PreferencesPanel />
        </TabsContent>

        <TabsContent value="inbox">
          {list.isLoading ? (
            <Card>
              <TableSkeleton rows={6} columns={2} />
            </Card>
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.items.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title="Nothing here yet"
              description="Alerts about fees, attendance and stock arrive here."
            />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {list.items.map((notification) => {
                    const content = (
                      <>
                        <span className="flex items-start gap-2">
                          {!notification.isRead ? (
                            <span
                              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                              aria-label="Unread"
                            />
                          ) : (
                            <span className="mt-1.5 size-1.5 shrink-0" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  'text-sm',
                                  notification.isRead
                                    ? 'text-[var(--color-ink-secondary)]'
                                    : 'font-medium',
                                )}
                              >
                                {notification.title}
                              </span>
                              <Badge>{humanise(notification.type)}</Badge>
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                              {notification.body}
                            </span>
                            <span
                              className="mt-1 block text-2xs text-[var(--color-ink-faint)]"
                              title={formatDateTime(notification.createdAt)}
                            >
                              {formatAgo(notification.createdAt)}
                            </span>
                          </span>
                        </span>
                      </>
                    );

                    return (
                      <li
                        key={notification.id}
                        className={cn(
                          'transition-colors',
                          !notification.isRead && 'bg-[var(--color-accent-soft)]',
                        )}
                      >
                        {notification.actionUrl ? (
                          <Link
                            href={notification.actionUrl}
                            onClick={() => {
                              // Opening it is the read signal; no separate click needed.
                              if (!notification.isRead) markRead.mutate(notification.id);
                              void queryClient;
                            }}
                            className="block px-4 py-3 hover:bg-[var(--color-surface-sunken)]"
                          >
                            {content}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (!notification.isRead) markRead.mutate(notification.id);
                            }}
                            className="block w-full px-4 py-3 text-left hover:bg-[var(--color-surface-sunken)]"
                          >
                            {content}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>

              {list.meta ? <Pagination meta={list.meta} onPageChange={list.setPage} /> : null}
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

interface Preference {
  type: string;
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
}

const CHANNELS: Array<{ key: keyof Omit<Preference, 'type'>; label: string }> = [
  { key: 'inApp', label: 'In-app' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

function PreferencesPanel() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<Preference[]>('/notifications/preferences'),
  });

  const update = useAction<
    { type: string; channel: keyof Omit<Preference, 'type'>; value: boolean },
    unknown
  >({
    mutationFn: ({ type, channel, value }) =>
      api.patch('/notifications/preferences', { type, [channel]: value }),
    invalidates: [['notification-preferences']],
  });

  if (isLoading) return <LoadingState label="Loading preferences" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <Card>
      <CardHeader
        title="How you are notified"
        description="In-app alerts always reach the bell; the other channels need the school's email or SMS set up."
      />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-sunken)] text-2xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-2 text-left">Notification</th>
                {CHANNELS.map((channel) => (
                  <th key={channel.key} className="px-3 py-2 text-center">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {(data ?? []).map((preference) => (
                <tr key={preference.type}>
                  <td className="px-4 py-2 font-medium">{humanise(preference.type)}</td>
                  {CHANNELS.map((channel) => (
                    <td key={channel.key} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={preference[channel.key]}
                        onChange={(e) =>
                          update.mutate({
                            type: preference.type,
                            channel: channel.key,
                            value: e.target.checked,
                          })
                        }
                        disabled={update.isPending}
                        aria-label={`${channel.label} for ${humanise(preference.type)}`}
                        className="size-3.5 accent-[var(--color-accent)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
