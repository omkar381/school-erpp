'use client';

import * as React from 'react';
import { Megaphone, Pencil, Pin, Plus, Send, Trash2 } from 'lucide-react';
import { PRIORITIES, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { formatDate, formatRelativeDay } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
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
  classId?: string | null;
  sectionId?: string | null;
}

const AUDIENCES = ['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF', 'CLASS', 'SECTION'];

const NOTICE_KINDS = ['NOTICE', 'CIRCULAR', 'ANNOUNCEMENT'];

const NOTICE_QUERIES = [['notices']];

export default function NoticesPage() {
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('notices.create'),
  );
  const canDelete = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('notices.delete'),
  );

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<NoticeRow | null>(null);
  const [deleting, setDeleting] = React.useState<NoticeRow | null>(null);

  const list = useListQuery<NoticeRow>('notices', '/notices', {
    initialSortBy: 'publishAt',
    initialSortOrder: 'desc',
  });

  const publishNotice = useAction({
    mutationFn: (row: NoticeRow) => api.post(`/notices/${row.id}/publish`, {}),
    successMessage: 'Notice published',
    invalidates: NOTICE_QUERIES,
  });

  const removeNotice = useAction({
    mutationFn: (row: NoticeRow) => api.delete(`/notices/${row.id}`),
    successMessage: 'Notice deleted',
    invalidates: NOTICE_QUERIES,
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Notices"
        description="Announcements and circulars sent to the school."
        actions={
          canManage ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Write notice
            </Button>
          ) : null
        }
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
          action={
            canManage && list.activeFilterCount === 0 ? (
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Write notice
              </Button>
            ) : null
          }
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

                  {canManage || canDelete ? (
                    <span className="ml-auto flex items-center gap-1">
                      {canManage && notice.status !== 'PUBLISHED' ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          icon={<Send />}
                          loading={publishNotice.isPending}
                          onClick={() => publishNotice.mutate(notice)}
                        >
                          Publish
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          icon={<Pencil />}
                          aria-label={`Edit ${notice.title}`}
                          onClick={() => setEditing(notice)}
                        />
                      ) : null}
                      {canDelete ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          icon={<Trash2 />}
                          aria-label={`Delete ${notice.title}`}
                          onClick={() => setDeleting(notice)}
                        />
                      ) : null}
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

      {creating ? <NoticeFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <NoticeFormDialog notice={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this notice?"
        description={
          deleting
            ? `"${deleting.title}" will be removed for everyone it was sent to.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeNotice.isPending}
        onConfirm={() => deleting && removeNotice.mutate(deleting)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Write and edit
// ---------------------------------------------------------------------------

function NoticeFormDialog({ notice, onClose }: { notice?: NoticeRow; onClose: () => void }) {
  const isEdit = Boolean(notice);

  const [title, setTitle] = React.useState(notice?.title ?? '');
  const [body, setBody] = React.useState(notice?.body ?? '');
  const [kind, setKind] = React.useState(notice?.kind ?? 'NOTICE');
  const [audience, setAudience] = React.useState(notice?.audience ?? 'ALL');
  const [classId, setClassId] = React.useState(notice?.classId ?? '');
  const [sectionId, setSectionId] = React.useState(notice?.sectionId ?? '');
  const [priority, setPriority] = React.useState(notice?.priority ?? 'NORMAL');
  const [isPinned, setIsPinned] = React.useState(notice?.isPinned ?? false);
  const [publishAt, setPublishAt] = React.useState(notice?.publishAt?.slice(0, 10) ?? '');
  const [expiresAt, setExpiresAt] = React.useState(notice?.expiresAt?.slice(0, 10) ?? '');
  const [publish, setPublish] = React.useState(true);
  const [sendPush, setSendPush] = React.useState(true);
  const [sendEmail, setSendEmail] = React.useState(false);

  const { data: classes } = useClasses(audience === 'CLASS' || audience === 'SECTION');
  const { data: sections } = useSections(audience === 'SECTION' ? classId || undefined : undefined);

  // The API requires the matching target for these two audiences, so the form
  // must not let them be submitted without one.
  const targetOk =
    audience === 'CLASS' ? Boolean(classId) : audience === 'SECTION' ? Boolean(sectionId) : true;

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit notice' : 'Write a notice'}
      description={
        isEdit
          ? 'Everyone who has already been notified keeps the notice; the text updates for them.'
          : 'Choose who should see this. Parents and students only see notices addressed to them.'
      }
      submitLabel={isEdit ? 'Save changes' : publish ? 'Publish notice' : 'Save as draft'}
      values={{
        title,
        body,
        kind,
        audience,
        classId,
        sectionId,
        priority,
        isPinned,
        publishAt,
        expiresAt,
        publish,
        sendPush,
        sendEmail,
      }}
      isValid={title.trim().length > 0 && body.trim().length > 0 && targetOk}
      successMessage={isEdit ? 'Notice updated' : publish ? 'Notice published' : 'Draft saved'}
      invalidates={NOTICE_QUERIES}
      submit={(values) => {
        if (isEdit) {
          return api.patch(`/notices/${notice!.id}`, {
            title: values.title.trim(),
            body: values.body.trim(),
            priority: values.priority,
            isPinned: values.isPinned,
            ...(values.expiresAt ? { expiresAt: values.expiresAt } : {}),
          });
        }

        return api.post('/notices', {
          title: values.title.trim(),
          body: values.body.trim(),
          kind: values.kind,
          audience: values.audience,
          ...(values.audience === 'CLASS' ? { classId: values.classId } : {}),
          ...(values.audience === 'SECTION' ? { sectionId: values.sectionId } : {}),
          priority: values.priority,
          isPinned: values.isPinned,
          ...(values.publishAt ? { publishAt: values.publishAt } : {}),
          ...(values.expiresAt ? { expiresAt: values.expiresAt } : {}),
          publish: values.publish,
          sendPush: values.sendPush,
          sendEmail: values.sendEmail,
        });
      }}
    >
      {(errors) => (
        <>
          <Field label="Title" required error={errors.title}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </Field>

          <Field label="Message" required error={errors.body}>
            <Textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>

          {!isEdit ? (
            <FieldRow columns={3}>
              <Field label="Kind" error={errors.kind}>
                <Select value={kind} onChange={(event) => setKind(event.target.value)}>
                  {NOTICE_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Audience" required error={errors.audience}>
                <Select
                  value={audience}
                  onChange={(event) => {
                    setAudience(event.target.value);
                    setClassId('');
                    setSectionId('');
                  }}
                >
                  {AUDIENCES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" error={errors.priority}>
                <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          ) : (
            <FieldRow>
              <Field label="Priority" error={errors.priority}>
                <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Expires on" error={errors.expiresAt}>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
            </FieldRow>
          )}

          {!isEdit && (audience === 'CLASS' || audience === 'SECTION') ? (
            <FieldRow>
              <Field label="Class" required error={errors.classId}>
                <Select value={classId} onChange={(event) => setClassId(event.target.value)}>
                  <option value="">Choose a class</option>
                  {(classes ?? []).map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {audience === 'SECTION' ? (
                <Field label="Section" required error={errors.sectionId}>
                  <Select
                    value={sectionId}
                    onChange={(event) => setSectionId(event.target.value)}
                    disabled={!classId}
                  >
                    <option value="">Choose a section</option>
                    {(sections ?? []).map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.class.name} {section.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </FieldRow>
          ) : null}

          {!isEdit ? (
            <FieldRow columns={2}>
              <Field label="Publish on" error={errors.publishAt} help="Leave blank to send now">
                <Input
                  type="date"
                  value={publishAt}
                  onChange={(event) => setPublishAt(event.target.value)}
                />
              </Field>
              <Field label="Expires on" error={errors.expiresAt}>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
            </FieldRow>
          ) : null}

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(event) => setIsPinned(event.target.checked)}
              />
              Pin to the top
            </label>
            {!isEdit ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publish}
                    onChange={(event) => setPublish(event.target.checked)}
                  />
                  Publish now
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sendPush}
                    onChange={(event) => setSendPush(event.target.checked)}
                  />
                  Send a push notification
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(event) => setSendEmail(event.target.checked)}
                  />
                  Send an email
                </label>
              </>
            ) : null}
          </div>
        </>
      )}
    </FormModal>
  );
}
