'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Inbox, Paperclip, Plus, X } from 'lucide-react';
import { api, uploadFile } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useAuthStore } from '@/lib/auth-store';
import { formatNumber } from '@/lib/utils';
import {
  formatBytes,
  type TicketAttachment,
  type TicketOptions,
  type TicketStats,
} from '@/lib/platform';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { TicketList } from '@/components/support/ticket-list';

export default function SupportPage() {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  const canManage = useAuthStore((state) =>
    Boolean(state.user?.isSuperAdmin || state.user?.permissions.includes('support.tickets.manage')),
  );

  const { data: options } = useQuery({
    queryKey: ['support', 'categories'],
    queryFn: () => api.get<TicketOptions>('/support/categories'),
    staleTime: 60 * 60_000,
  });

  const { data: stats, isLoading } = useQuery({
    queryKey: ['support', 'statistics'],
    queryFn: () => api.get<TicketStats>('/support/statistics'),
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Support"
        description={
          canManage
            ? "Tickets raised inside your school, and the ones you've raised with us."
            : 'Raise a request and follow it through to a fix.'
        }
        actions={
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New ticket
          </Button>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard
          label="Open"
          value={stats ? formatNumber(stats.open) : '—'}
          icon={<Inbox />}
          loading={isLoading}
        />
        <StatCard
          label="In progress"
          value={stats ? formatNumber(stats.inProgress) : '—'}
          loading={isLoading}
        />
        <StatCard
          label="Waiting on you"
          value={stats ? formatNumber(stats.waiting) : '—'}
          loading={isLoading}
        />
        <StatCard
          label="Resolved"
          value={stats ? formatNumber(stats.resolved) : '—'}
          icon={<CheckCircle2 />}
          loading={isLoading}
        />
      </StatGrid>

      <TicketList
        queryKey="support-tickets"
        path="/support/tickets"
        basePath="/support"
        categories={options?.categories}
        queueFilter={canManage}
        emptyAction={
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            Raise a ticket
          </Button>
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        {/* Mounted only while open, so every visit starts from a blank form
            without an effect reaching back to reset it. */}
        {creating ? (
          <NewTicketForm
            onClose={() => setCreating(false)}
            options={options}
            onCreated={(id) => router.push(`/support/${id}`)}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function NewTicketForm({
  onClose,
  options,
  onCreated,
}: {
  onClose: () => void;
  options: TicketOptions | undefined;
  onCreated: (id: string) => void;
}) {
  const [subject, setSubject] = React.useState('');
  const [category, setCategory] = React.useState('GENERAL');
  const [priority, setPriority] = React.useState('MEDIUM');
  const [description, setDescription] = React.useState('');
  const [files, setFiles] = React.useState<TicketAttachment[]>([]);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const fileInput = React.useRef<HTMLInputElement>(null);

  const upload = useAction({
    mutationFn: (file: File) => uploadFile<TicketAttachment>('/support/tickets/attachments', file),
    successMessage: 'File attached',
    onSuccess: (attachment) => setFiles((current) => [...current, attachment]),
  });

  const create = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{ id: string }>('/support/tickets', payload),
    successMessage: 'Ticket raised',
    invalidates: [['support-tickets'], ['support', 'statistics']],
    onSuccess: (ticket) => {
      onClose();
      onCreated(ticket.id);
    },
    onError: (error) => setFieldErrors(error.byField),
  });

  const submit = () => {
    setFieldErrors({});
    create.mutate({
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
      ...(files.length > 0 ? { attachmentIds: files.map((file) => file.id) } : {}),
    });
  };

  return (
    <Modal
      size="lg"
      title="Raise a support ticket"
      description="Tell us what happened and what you expected. Screenshots help."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={create.isPending}
            disabled={subject.trim().length < 5 || description.trim().length < 10}
            onClick={submit}
          >
            Raise ticket
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Subject" required error={fieldErrors.subject}>
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Cannot download the Class 8 attendance report"
          />
        </Field>

        <FieldRow columns={2}>
          <Field label="Category" required error={fieldErrors.category}>
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              {(options?.categories ?? [{ value: 'GENERAL', label: 'General enquiry' }]).map(
                (option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ),
              )}
            </Select>
          </Field>

          <Field
            label="Priority"
            help="Urgent is for something blocking the school today."
            error={fieldErrors.priority}
          >
            <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {(options?.priorities ?? [{ value: 'MEDIUM', label: 'Medium' }]).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <Field label="Description" required error={fieldErrors.description}>
          <Textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What you did, what happened, and what you expected instead."
          />
        </Field>

        <div>
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
            variant="secondary"
            size="sm"
            icon={<Paperclip />}
            loading={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            Attach a file
          </Button>
          <span className="ml-2 text-2xs text-[var(--color-ink-muted)]">
            Images, PDFs and spreadsheets up to 10 MB.
          </span>

          {files.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {files.map((file) => (
                <li key={file.id}>
                  <Badge tone="info">
                    {file.fileName} · {formatBytes(file.sizeBytes)}
                    <button
                      type="button"
                      aria-label={`Remove ${file.fileName}`}
                      onClick={() =>
                        setFiles((current) => current.filter((item) => item.id !== file.id))
                      }
                    >
                      <X className="size-2.5" aria-hidden />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
