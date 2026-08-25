'use client';

import { Megaphone, Pin } from 'lucide-react';
import { PRIORITIES, humanise } from '@erp/shared-types';
import { useListQuery } from '@/hooks/use-list-query';
import { formatDate, formatRelativeDay } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';

interface NoticeRow {
  id: string;
  title: string;
  body: string;
  kind: string;
  audience: string;
  priority: string;
  status: string;
  isPinned: boolean;
  publishAt: string | null;
  expiresAt: string | null;
  readCount?: number;
  targetCount?: number;
}

const AUDIENCES = ['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF', 'CLASS', 'SECTION'];

export default function NoticesPage() {
  const list = useListQuery<NoticeRow>('notices', '/notices', {
    initialSortBy: 'publishAt',
    initialSortOrder: 'desc',
  });

  return (
    <>
      <PageHeader
        title="Notices"
        description="Announcements and circulars sent to the school."
      />

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search notices"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Audience"
          value={list.state.filters.audience}
          onChange={(value) => list.setFilter('audience', value)}
          options={AUDIENCES.map((audience) => ({ value: audience, label: humanise(audience) }))}
        />
        <FilterSelect
          label="Priority"
          value={list.state.filters.priority}
          onChange={(value) => list.setFilter('priority', value)}
          options={PRIORITIES.map((priority) => ({ value: priority, label: humanise(priority) }))}
        />
        <FilterSelect
          label="Status"
          value={list.state.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={[
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'SCHEDULED', label: 'Scheduled' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
      </FilterBar>

      {list.isLoading ? (
        <Card>
          <TableSkeleton rows={5} columns={3} />
        </Card>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="No notices match these filters"
          description="Published notices appear here, newest first."
        />
      ) : (
        <div className="space-y-2.5">
          {list.items.map((notice) => (
            <Card key={notice.id}>
              <CardBody>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {notice.isPinned ? (
                    <Pin
                      className="size-3.5 shrink-0 text-[var(--color-accent)]"
                      aria-label="Pinned"
                    />
                  ) : null}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{notice.title}</h3>
                  {notice.priority !== 'NORMAL' ? (
                    <StatusBadge status={notice.priority} />
                  ) : null}
                  <StatusBadge status={notice.status} />
                </div>

                <p className="line-clamp-2 text-sm text-[var(--color-ink-secondary)]">
                  {notice.body}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-2xs text-[var(--color-ink-muted)]">
                  <Badge>{humanise(notice.audience)}</Badge>
                  <span>{formatRelativeDay(notice.publishAt)}</span>
                  {notice.expiresAt ? <span>Expires {formatDate(notice.expiresAt)}</span> : null}
                  {notice.readCount !== undefined && notice.targetCount ? (
                    <span className="tabular">
                      Read by {notice.readCount} of {notice.targetCount}
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
    </>
  );
}
