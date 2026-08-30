'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MessageSquareWarning, Plus, ShieldQuestion, Timer } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate, formatRelativeDay } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';

interface ComplaintRow {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  isAnonymous: boolean;
  isOwn: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  reportedBy: { id: string; name: string; email: string | null; phone: string | null } | null;
  student: { id: string; fullName: string; admissionNumber: string } | null;
  createdAt: string;
}

interface ComplaintStats {
  total: number;
  open: number;
  underReview: number;
  resolved: number;
  dismissed: number;
  awaitingOutcome: number;
  averageResolutionDays: number | null;
}

interface Categories {
  categories: Array<{ value: string; label: string }>;
  statuses: string[];
}

const COMPLAINT_QUERIES = [['complaints']];

/** What a complaint in each state may move to, mirroring the API. */
const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ['UNDER_REVIEW', 'RESOLVED', 'DISMISSED'],
  UNDER_REVIEW: ['RESOLVED', 'DISMISSED'],
  RESOLVED: ['UNDER_REVIEW'],
  DISMISSED: ['UNDER_REVIEW'],
};

export default function ComplaintsPage() {
  const canRaise = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('complaints.create'),
  );
  const canHandle = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('complaints.manage'),
  );

  const [creating, setCreating] = React.useState(false);
  const [ruling, setRuling] = React.useState<ComplaintRow | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['complaints', 'statistics'],
    queryFn: () => api.get<ComplaintStats>('/complaints/statistics'),
    staleTime: 60_000,
  });

  const { data: options } = useQuery({
    queryKey: ['complaints', 'categories'],
    queryFn: () => api.get<Categories>('/complaints/categories'),
    staleTime: 10 * 60_000,
  });

  const list = useListQuery<ComplaintRow>('complaints', '/complaints', {
    initialSortBy: 'createdAt',
    initialSortOrder: 'desc',
  });

  return (
    <>
      <PageHeader
        title="Complaints"
        description={
          canHandle
            ? 'Grievances raised by parents, students and staff, and what was done about them.'
            : 'Raise a concern with the school and follow what happens to it.'
        }
        actions={
          canRaise ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Raise a complaint
            </Button>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={4} className="mb-4">
          <StatCard label="Open" value={stats.open} icon={<MessageSquareWarning />} />
          <StatCard label="Under review" value={stats.underReview} icon={<ShieldQuestion />} />
          <StatCard label="Resolved" value={stats.resolved} icon={<CheckCircle2 />} />
          <StatCard
            label="Average time to close"
            value={
              stats.averageResolutionDays === null
                ? '—'
                : `${stats.averageResolutionDays} ${stats.averageResolutionDays === 1 ? 'day' : 'days'}`
            }
            icon={<Timer />}
          />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search complaints"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={(options?.statuses ?? []).map((status) => ({
            value: status,
            label: humanise(status),
          }))}
        />
        <FilterSelect
          label="Category"
          value={list.state.filters.category}
          onChange={(value) => list.setFilter('category', value)}
          options={(options?.categories ?? []).map((category) => ({
            value: category.value,
            label: category.label,
          }))}
        />
        <FilterSelect
          label="Awaiting an outcome"
          value={list.state.filters.openOnly}
          onChange={(value) => list.setFilter('openOnly', value)}
          allLabel="All complaints"
          options={[{ value: 'true', label: 'Still open' }]}
        />
      </FilterBar>

      {list.isLoading ? (
        <Card>
          <TableSkeleton rows={4} columns={3} />
        </Card>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<MessageSquareWarning />}
          title={
            list.activeFilterCount > 0 ? 'No complaints match these filters' : 'No complaints'
          }
          description={
            canHandle
              ? 'Complaints raised by the school community appear here.'
              : 'Anything you raise appears here, along with the school’s response.'
          }
          action={
            canRaise && list.activeFilterCount === 0 ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Raise a complaint
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2.5">
          {list.items.map((complaint) => (
            <Card key={complaint.id}>
              <CardBody>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {complaint.subject}
                  </h3>
                  <Badge>{humanise(complaint.category)}</Badge>
                  <StatusBadge status={complaint.status} />
                </div>

                <p className="whitespace-pre-line text-sm text-[var(--color-ink-secondary)]">
                  {complaint.description}
                </p>

                {complaint.resolution ? (
                  <div className="mt-2 rounded-[var(--radius-xs)] border-l-2 border-[var(--color-accent)] bg-[var(--color-surface-sunken)] px-3 py-2">
                    <p className="text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                      Outcome
                    </p>
                    <p className="text-sm">{complaint.resolution}</p>
                    {complaint.resolvedBy ? (
                      <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">
                        {complaint.resolvedBy.name}
                        {complaint.resolvedAt ? ` · ${formatDate(complaint.resolvedAt)}` : ''}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-[var(--color-ink-muted)]">
                  <span>
                    {/* An anonymous complaint shows no name to anyone but its author. */}
                    {complaint.reportedBy
                      ? complaint.isAnonymous
                        ? `${complaint.reportedBy.name} (anonymous to the school)`
                        : complaint.reportedBy.name
                      : 'Reported anonymously'}
                  </span>
                  <span>{formatRelativeDay(complaint.createdAt)}</span>
                  {complaint.student ? (
                    <span>
                      About {complaint.student.fullName} ({complaint.student.admissionNumber})
                    </span>
                  ) : null}

                  {canHandle && NEXT_STATUSES[complaint.status]?.length ? (
                    <span className="ml-auto">
                      <Button size="xs" variant="ghost" onClick={() => setRuling(complaint)}>
                        Update status
                      </Button>
                    </span>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}

          {list.meta ? (
            <Card>
              <Pagination meta={list.meta} onPageChange={list.setPage} />
            </Card>
          ) : null}
        </div>
      )}

      {creating ? (
        <RaiseComplaintDialog
          categories={options?.categories ?? []}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {ruling ? (
        <UpdateStatusDialog complaint={ruling} onClose={() => setRuling(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

function RaiseComplaintDialog({
  categories,
  onClose,
}: {
  categories: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const [category, setCategory] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [isAnonymous, setIsAnonymous] = React.useState(false);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Raise a complaint"
      description="The school is notified straight away and must record what it does about it."
      submitLabel="Submit complaint"
      values={{ category, subject, description, isAnonymous }}
      isValid={
        Boolean(category) && subject.trim().length >= 5 && description.trim().length >= 10
      }
      successMessage="Complaint raised"
      invalidates={COMPLAINT_QUERIES}
      submit={(values) =>
        api.post('/complaints', {
          category: values.category,
          subject: values.subject.trim(),
          description: values.description.trim(),
          isAnonymous: values.isAnonymous,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="What is this about" required error={errors.category}>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} autoFocus>
              <option value="">Choose a category</option>
              {categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Summary"
            required
            error={errors.subject}
            help="One line — what a reader should see first"
          >
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Bus 12 has been arriving 20 minutes late all week"
            />
          </Field>

          <Field label="What happened" required error={errors.description}>
            <Textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dates, times, who was involved — anything that helps the school look into it."
            />
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
            <span>
              Raise this anonymously
              <span className="block text-2xs text-[var(--color-ink-muted)]">
                Your name is hidden from everyone at the school, including whoever handles it. You
                will still see it in your own list.
              </span>
            </span>
          </label>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Ruling on one
// ---------------------------------------------------------------------------

function UpdateStatusDialog({
  complaint,
  onClose,
}: {
  complaint: ComplaintRow;
  onClose: () => void;
}) {
  const allowed = NEXT_STATUSES[complaint.status] ?? [];
  const [status, setStatus] = React.useState(allowed[0] ?? '');
  const [resolution, setResolution] = React.useState(complaint.resolution ?? '');

  // The API insists on a written outcome before a complaint can be closed.
  const needsResolution = status === 'RESOLVED' || status === 'DISMISSED';

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Update this complaint"
      description={complaint.subject}
      submitLabel="Update"
      values={{ status, resolution }}
      isValid={Boolean(status) && (!needsResolution || resolution.trim().length > 0)}
      successMessage="Complaint updated"
      invalidates={COMPLAINT_QUERIES}
      submit={(values) =>
        api.patch(`/complaints/${complaint.id}/status`, {
          status: values.status,
          ...(values.resolution.trim() ? { resolution: values.resolution.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Move to" required error={errors.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} autoFocus>
              {allowed.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>

          {needsResolution ? (
            <Field
              label="What was done"
              required
              error={errors.resolution}
              help="Shown to whoever raised the complaint"
            >
              <Textarea
                rows={5}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Route timing revised and a relief driver assigned from Monday."
              />
            </Field>
          ) : null}
        </>
      )}
    </FormModal>
  );
}
