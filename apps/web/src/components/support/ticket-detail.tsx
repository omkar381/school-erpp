'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Paperclip, Send, X } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api, uploadFile } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatAgo } from '@/lib/dates';
import { cn, initials } from '@/lib/utils';
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  formatBytes,
  fullName,
  type TicketAttachment,
  type TicketDetail,
} from '@/lib/platform';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { DetailList } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { priorityTone } from './ticket-list';

export type TicketScope = 'school' | 'platform';

function routes(scope: TicketScope, id: string) {
  const base = scope === 'platform' ? '/platform/support/tickets' : '/support/tickets';
  return {
    detail: `${base}/${id}`,
    replies: `${base}/${id}/replies`,
    update: `${base}/${id}`,
    assignee: `${base}/${id}/assignee`,
    agents: scope === 'platform' ? '/platform/support/agents' : '/support/agents',
    close: `/support/tickets/${id}/close`,
    listHref: scope === 'platform' ? '/super-admin/support' : '/support',
  };
}

/**
 * One ticket, for whoever is looking at it.
 *
 * The requester and the agent see the same component; what differs is what the
 * server sent back — internal notes are simply absent for a requester, and
 * `canManage` decides whether the triage controls render at all. The server
 * re-checks both on every write.
 */
export function TicketDetailView({ scope, id }: { scope: TicketScope; id: string }) {
  const paths = routes(scope, id);
  const currentUserId = useAuthStore((state) => state.user?.id);

  const ticketKey = ['ticket', scope, id];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ticketKey,
    queryFn: () => api.get<TicketDetail>(paths.detail),
  });

  const listKey = scope === 'platform' ? ['platform-tickets'] : ['support-tickets'];
  const invalidates = [ticketKey, listKey, ['support', 'statistics']];

  const [body, setBody] = React.useState('');
  const [internal, setInternal] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<TicketAttachment[]>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const upload = useAction({
    mutationFn: (file: File) =>
      uploadFile<TicketAttachment>('/support/tickets/attachments', file),
    successMessage: 'File attached',
    onSuccess: (attachment) => setPendingFiles((current) => [...current, attachment]),
  });

  const reply = useAction({
    mutationFn: (payload: Record<string, unknown>) => api.post(paths.replies, payload),
    successMessage: 'Reply sent',
    invalidates,
    onSuccess: () => {
      setBody('');
      setInternal(false);
      setPendingFiles([]);
    },
  });

  const update = useAction({
    mutationFn: (payload: Record<string, unknown>) => api.patch(paths.update, payload),
    successMessage: 'Ticket updated',
    invalidates,
  });

  const assign = useAction({
    mutationFn: (payload: Record<string, unknown>) => api.patch(paths.assignee, payload),
    successMessage: 'Ticket assigned',
    invalidates,
  });

  const close = useAction({
    mutationFn: () => api.post(paths.close, {}),
    successMessage: 'Ticket closed',
    invalidates,
  });

  const { data: agents } = useQuery({
    queryKey: ['support', 'agents', scope],
    queryFn: () =>
      api.get<Array<{ id: string; firstName: string; lastName: string | null }>>(paths.agents),
    enabled: Boolean(data?.canManage),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <LoadingState label="Loading ticket" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Ticket not found" />;

  const isRequester = data.requesterId === currentUserId;
  const canClose = data.status === 'RESOLVED' && (isRequester || data.canManage);

  return (
    <>
      <PageHeader
        title={data.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{data.ticketNumber}</span>
            <StatusBadge status={data.status} />
            <Badge tone={priorityTone(data.priority)}>
              {TICKET_PRIORITY_LABELS[data.priority] ?? humanise(data.priority)}
            </Badge>
            <span>{humanise(data.category)}</span>
            {data.school ? <span>· {data.school.name}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<ArrowLeft />} asChild>
              <Link href={paths.listHref}>Back</Link>
            </Button>
            {canClose ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<X />}
                loading={close.isPending}
                onClick={() => close.mutate(undefined)}
              >
                Close ticket
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Conversation"
              description={`Opened ${formatDateTime(data.createdAt)} by ${fullName(data.requester)}`}
            />
            <CardBody className="space-y-4">
              <Message
                author={fullName(data.requester)}
                at={data.createdAt}
                body={data.description}
                attachments={data.attachments}
              />

              {data.messages.map((message) => (
                <Message
                  key={message.id}
                  author={fullName(message.author)}
                  at={message.createdAt}
                  body={message.body}
                  internal={message.isInternal}
                  attachments={message.attachments}
                  own={message.author.id === currentUserId}
                />
              ))}
            </CardBody>

            {data.canReply ? (
              <div className="border-t border-[var(--color-border)] p-4">
                <Textarea
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={
                    internal ? 'Internal note — the requester never sees this' : 'Write a reply…'
                  }
                  aria-label="Reply"
                />

                {pendingFiles.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {pendingFiles.map((file) => (
                      <li key={file.id}>
                        <Badge tone="info">
                          {file.fileName} · {formatBytes(file.sizeBytes)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) upload.mutate(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Paperclip />}
                    loading={upload.isPending}
                    onClick={() => fileInput.current?.click()}
                  >
                    Attach
                  </Button>

                  {data.canManage ? (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[var(--color-accent)]"
                        checked={internal}
                        onChange={(event) => setInternal(event.target.checked)}
                      />
                      Internal note
                    </label>
                  ) : null}

                  <Button
                    className="ml-auto"
                    size="sm"
                    variant="primary"
                    icon={<Send />}
                    loading={reply.isPending}
                    disabled={body.trim().length === 0}
                    onClick={() =>
                      reply.mutate({
                        body: body.trim(),
                        isInternal: internal,
                        ...(pendingFiles.length > 0
                          ? { attachmentIds: pendingFiles.map((file) => file.id) }
                          : {}),
                      })
                    }
                  >
                    {internal ? 'Add note' : 'Send reply'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                This ticket is closed. Raise a new one if the problem comes back.
              </div>
            )}
          </Card>

          {data.canManage && data.history.length > 0 ? (
            <Card>
              <CardHeader title="History" description="Every audited change on this ticket." />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {data.history.map((entry) => (
                    <li key={entry.id} className="px-4 py-2">
                      <p className="text-xs">{entry.description ?? humanise(entry.action)}</p>
                      <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                        {entry.user ? fullName(entry.user) : 'System'} ·{' '}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  { label: 'Ticket', value: data.ticketNumber },
                  { label: 'Status', value: <StatusBadge status={data.status} /> },
                  {
                    label: 'Priority',
                    value: TICKET_PRIORITY_LABELS[data.priority] ?? humanise(data.priority),
                  },
                  { label: 'Category', value: humanise(data.category) },
                  { label: 'Raised by', value: fullName(data.requester) },
                  { label: 'Contact', value: data.requester?.email },
                  { label: 'Assigned to', value: data.assignee ? fullName(data.assignee) : 'Unassigned' },
                  { label: 'Opened', value: formatDateTime(data.createdAt) },
                  {
                    label: 'First response',
                    value: data.firstResponseAt ? formatAgo(data.firstResponseAt) : 'Awaiting',
                  },
                  { label: 'Resolved', value: data.resolvedAt ? formatDateTime(data.resolvedAt) : null },
                  ...(data.school
                    ? [
                        {
                          label: 'School',
                          value: (
                            <Link
                              href={`/super-admin/schools/${data.school.id}`}
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              {data.school.name}
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {data.canManage ? (
            <Card>
              <CardHeader title="Triage" description="Only support staff see these controls." />
              <CardBody className="space-y-3">
                <Field label="Status">
                  <Select
                    value={data.status}
                    disabled={update.isPending}
                    onChange={(event) => update.mutate({ status: event.target.value })}
                  >
                    {TICKET_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {humanise(status)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Priority">
                  <Select
                    value={data.priority}
                    disabled={update.isPending}
                    onChange={(event) => update.mutate({ priority: event.target.value })}
                  >
                    {TICKET_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {TICKET_PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Assigned to">
                  <Select
                    value={data.assigneeId ?? ''}
                    disabled={assign.isPending}
                    onChange={(event) =>
                      assign.mutate({ assigneeId: event.target.value || undefined })
                    }
                  >
                    <option value="">Unassigned</option>
                    {agents?.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {fullName(agent)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Message({
  author,
  at,
  body,
  attachments,
  internal,
  own,
}: {
  author: string;
  at: string;
  body: string;
  attachments?: TicketAttachment[];
  internal?: boolean;
  own?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
          own
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-surface-sunken)] text-[var(--color-ink-secondary)]',
        )}
        aria-hidden
      >
        {initials(author)}
      </span>

      <div
        className={cn(
          'min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2',
          internal
            ? 'border-[var(--color-warning-border)] bg-[var(--color-warning-soft)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">{author}</span>
          <span className="text-2xs text-[var(--color-ink-muted)]">{formatDateTime(at)}</span>
          {internal ? (
            <Badge tone="warning">
              <Lock className="size-2.5" aria-hidden /> Internal
            </Badge>
          ) : null}
        </div>

        <p className="whitespace-pre-wrap text-sm text-[var(--color-ink-secondary)]">{body}</p>

        {attachments && attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <li key={file.id}>
                {file.url ? (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] px-1.5 py-0.5 text-2xs hover:bg-[var(--color-surface-sunken)]"
                  >
                    <Paperclip className="size-3" aria-hidden />
                    {file.fileName}
                    <span className="text-[var(--color-ink-muted)]">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </a>
                ) : (
                  <Badge tone="neutral">
                    <Paperclip className="size-3" aria-hidden /> {file.fileName}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
