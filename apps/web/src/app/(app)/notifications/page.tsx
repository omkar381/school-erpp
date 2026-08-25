'use client';

import { useQueryClient } from '@tanstack/react-query';
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
import { Card, CardBody } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';

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
        description="Everything the system has sent you."
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
                              notification.isRead ? 'text-[var(--color-ink-secondary)]' : 'font-medium',
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
    </>
  );
}
