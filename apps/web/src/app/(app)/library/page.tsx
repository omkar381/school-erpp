'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, BookX, Copy, Library, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { useStaffOptions } from '@/hooks/use-lookups';
import { formatMoney } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, FieldRow } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  publisher: string | null;
  rackLocation: string | null;
  totalCopies: number;
  availableCopies: number;
  isAvailable: boolean;
  category: { id: string; name: string } | null;
}

interface IssueRow {
  id: string;
  issueDate: string;
  dueDate: string;
  returnDate: string | null;
  status: string;
  daysOverdue: number;
  outstandingFine: number;
  bookCopy: { accessionNumber: string; book: { id: string; title: string; author: string } };
  student: {
    id: string;
    admissionNumber: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

interface LibraryStats {
  titles: number;
  copies: number;
  currentlyIssued: number;
  overdue: number;
  available: number;
  unavailable: number;
  outstandingFines: number;
}

const LIBRARY_QUERIES = [['library'], ['library-books'], ['library-issues']];

const BOOK_CONDITIONS = ['GOOD', 'FAIR', 'DAMAGED', 'LOST'];

export default function LibraryPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('library.manage'),
  );
  const canIssue = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('library.issue'),
  );
  const canReturn = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('library.return'),
  );

  const [cataloguing, setCataloguing] = React.useState(false);
  const [addingCopies, setAddingCopies] = React.useState<BookRow | null>(null);
  const [issuing, setIssuing] = React.useState<BookRow | null>(null);
  const [returning, setReturning] = React.useState<IssueRow | null>(null);

  const renew = useAction({
    mutationFn: (row: IssueRow) => api.post(`/library/issues/${row.id}/renew`, {}),
    successMessage: 'Loan renewed',
    invalidates: LIBRARY_QUERIES,
  });

  const { data: stats } = useQuery({
    queryKey: ['library', 'statistics'],
    queryFn: () => api.get<LibraryStats>('/library/statistics'),
    staleTime: 60_000,
  });

  const books = useListQuery<BookRow>('library-books', '/library/books', {
    initialSortBy: 'title',
    initialSortOrder: 'asc',
  });

  const issues = useListQuery<IssueRow>('library-issues', '/library/issues', {
    initialFilters: { status: 'ISSUED' },
  });

  const bookColumns: Column<BookRow>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.author}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (row) => row.category?.name ?? '—',
    },
    { key: 'isbn', header: 'ISBN', hideOnMobile: true, cell: (row) => row.isbn ?? '—' },
    {
      key: 'rackLocation',
      header: 'Rack',
      hideOnMobile: true,
      cell: (row) => row.rackLocation ?? '—',
    },
    {
      key: 'availableCopies',
      header: 'Available',
      numeric: true,
      cell: (row) => (
        <span
          className={
            row.availableCopies === 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
          }
        >
          {row.availableCopies} / {row.totalCopies}
        </span>
      ),
    },
    {
      key: 'status',
      header: '',
      cell: (row) =>
        row.availableCopies > 0 ? (
          <Badge tone="success">On shelf</Badge>
        ) : (
          <Badge tone="danger">All out</Badge>
        ),
    },
  ];

  if (canManage || canIssue) {
    bookColumns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {canIssue && row.availableCopies > 0 ? (
            <Button size="xs" variant="ghost" onClick={() => setIssuing(row)}>
              Issue
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="icon-sm"
              variant="ghost"
              icon={<Copy />}
              aria-label={`Add copies of ${row.title}`}
              onClick={() => setAddingCopies(row)}
            />
          ) : null}
        </div>
      ),
    });
  }

  const issueColumns: Column<IssueRow>[] = [
    {
      key: 'book',
      header: 'Book',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.bookCopy.book.title}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
            {row.bookCopy.accessionNumber}
          </span>
        </span>
      ),
    },
    {
      key: 'borrower',
      header: 'Borrower',
      cell: (row) =>
        row.student ? (
          <span className="min-w-0">
            <span className="block truncate">
              {row.student.firstName} {row.student.lastName ?? ''}
            </span>
            <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
              {row.student.admissionNumber}
            </span>
          </span>
        ) : (
          'Staff'
        ),
    },
    { key: 'issueDate', header: 'Issued', hideOnMobile: true, cell: (row) => formatDate(row.issueDate) },
    {
      key: 'dueDate',
      header: 'Due',
      cell: (row) => (
        <span
          className={row.daysOverdue > 0 ? 'font-medium text-[var(--color-danger)]' : undefined}
        >
          {formatDate(row.dueDate)}
          {row.daysOverdue > 0 ? (
            <span className="block text-2xs">{row.daysOverdue} days late</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'outstandingFine',
      header: 'Fine',
      numeric: true,
      cell: (row) =>
        row.outstandingFine > 0 ? (
          <span className="font-medium text-[var(--color-danger)]">
            {formatMoney(row.outstandingFine, currency)}
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canIssue || canReturn) {
    issueColumns.push({
      key: 'actions',
      header: '',
      width: '1%',
      cell: (row) =>
        // A returned or lost loan has nothing left to act on.
        row.returnDate ? null : (
          <div className="flex items-center justify-end gap-1">
            {canIssue ? (
              <Button
                size="icon-sm"
                variant="ghost"
                icon={<RotateCcw />}
                aria-label={`Renew ${row.bookCopy.book.title}`}
                loading={renew.isPending}
                onClick={() => renew.mutate(row)}
              />
            ) : null}
            {canReturn ? (
              <Button size="xs" variant="ghost" icon={<Undo2 />} onClick={() => setReturning(row)}>
                Return
              </Button>
            ) : null}
          </div>
        ),
    });
  }

  return (
    <>
      <PageHeader
        title="Library"
        description="Catalogue, circulation and outstanding fines."
        actions={
          canManage ? (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCataloguing(true)}>
              Catalogue a book
            </Button>
          ) : null
        }
      />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Titles" value={stats.titles} icon={<Library />} />
          <StatCard label="Copies" value={stats.copies} />
          <StatCard label="On loan" value={stats.currentlyIssued} />
          <StatCard label="Overdue" value={stats.overdue} icon={<BookX />} invertTrend />
          <StatCard
            label="Fines outstanding"
            value={formatMoney(stats.outstandingFines, currency)}
          />
        </StatGrid>
      ) : null}

      <Tabs defaultValue="catalogue">
        <TabsList>
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="circulation">Circulation</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue">
          <FilterBar
            search={books.state.search}
            onSearchChange={books.setSearch}
            searchPlaceholder="Search by title, author, ISBN or publisher"
            activeFilterCount={books.activeFilterCount}
            onReset={books.resetFilters}
          >
            <FilterSelect
              label="Availability"
              value={books.state.filters.availableOnly}
              onChange={(value) => books.setFilter('availableOnly', value)}
              allLabel="All titles"
              options={[{ value: 'true', label: 'On shelf only' }]}
            />
          </FilterBar>

          <DataTable
            columns={bookColumns}
            rows={books.items}
            rowKey={(row) => row.id}
            isLoading={books.isLoading}
            error={books.error}
            onRetry={() => books.refetch()}
            meta={books.meta}
            onPageChange={books.setPage}
            sortBy={books.state.sortBy}
            sortOrder={books.state.sortOrder}
            onSortChange={books.setSort}
            empty={
              <EmptyState
                icon={<BookOpen />}
                title="No books match this search"
                description="Catalogue a title to get started."
                action={
                  canManage && books.activeFilterCount === 0 ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus />}
                      onClick={() => setCataloguing(true)}
                    >
                      Catalogue a book
                    </Button>
                  ) : null
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="circulation">
          <FilterBar
            search={issues.state.search}
            onSearchChange={issues.setSearch}
            searchPlaceholder="Search circulation"
            activeFilterCount={issues.activeFilterCount}
            onReset={issues.resetFilters}
          >
            <FilterSelect
              label="Status"
              value={issues.state.filters.status}
              onChange={(value) => issues.setFilter('status', value)}
              options={[
                { value: 'ISSUED', label: 'On loan' },
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'RETURNED', label: 'Returned' },
                { value: 'LOST', label: 'Lost' },
              ]}
            />
            <FilterSelect
              label="Overdue"
              value={issues.state.filters.overdueOnly}
              onChange={(value) => issues.setFilter('overdueOnly', value)}
              allLabel="All loans"
              options={[{ value: 'true', label: 'Overdue only' }]}
            />
          </FilterBar>

          <DataTable
            columns={issueColumns}
            rows={issues.items}
            rowKey={(row) => row.id}
            isLoading={issues.isLoading}
            error={issues.error}
            onRetry={() => issues.refetch()}
            meta={issues.meta}
            onPageChange={issues.setPage}
            empty={
              <EmptyState
                icon={<BookOpen />}
                title="No loans match these filters"
                description="Issued books appear here with their due dates."
              />
            }
          />
        </TabsContent>
      </Tabs>

      {cataloguing ? <CatalogueBookDialog onClose={() => setCataloguing(false)} /> : null}
      {addingCopies ? (
        <AddCopiesDialog book={addingCopies} onClose={() => setAddingCopies(null)} />
      ) : null}
      {issuing ? <IssueBookDialog book={issuing} onClose={() => setIssuing(null)} /> : null}
      {returning ? (
        <ReturnBookDialog issue={returning} onClose={() => setReturning(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function CatalogueBookDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = React.useState('');
  const [author, setAuthor] = React.useState('');
  const [isbn, setIsbn] = React.useState('');
  const [publisher, setPublisher] = React.useState('');
  const [edition, setEdition] = React.useState('');
  const [language, setLanguage] = React.useState('English');
  const [publishYear, setPublishYear] = React.useState('');
  const [pages, setPages] = React.useState('');
  const [rackLocation, setRackLocation] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [copies, setCopies] = React.useState('1');
  const [description, setDescription] = React.useState('');

  // The API accepts only a 10- or 13-digit ISBN, and rejects anything else
  // outright — so an empty field is fine but a half-typed one is not.
  const isbnOk = isbn.trim() === '' || /^(\d{9}[\dX]|\d{13})$/.test(isbn.trim());
  const copiesNumber = Number(copies);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Catalogue a book"
      description="Each physical copy is accessioned automatically and can then be issued."
      submitLabel="Add to catalogue"
      values={{
        title,
        author,
        isbn,
        publisher,
        edition,
        language,
        publishYear,
        pages,
        rackLocation,
        price,
        copies,
        description,
      }}
      isValid={
        title.trim().length > 0 &&
        author.trim().length > 0 &&
        isbnOk &&
        Number.isFinite(copiesNumber) &&
        copiesNumber >= 1
      }
      successMessage="Book catalogued"
      invalidates={LIBRARY_QUERIES}
      submit={(values) =>
        api.post('/library/books', {
          title: values.title.trim(),
          author: values.author.trim(),
          ...(values.isbn.trim() ? { isbn: values.isbn.trim() } : {}),
          ...(values.publisher.trim() ? { publisher: values.publisher.trim() } : {}),
          ...(values.edition.trim() ? { edition: values.edition.trim() } : {}),
          ...(values.language.trim() ? { language: values.language.trim() } : {}),
          ...(values.publishYear ? { publishYear: Number(values.publishYear) } : {}),
          ...(values.pages ? { pages: Number(values.pages) } : {}),
          ...(values.rackLocation.trim() ? { rackLocation: values.rackLocation.trim() } : {}),
          ...(values.price ? { price: Number(values.price) } : {}),
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          copies: Number(values.copies),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Title" required error={errors.title}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>
            <Field label="Author" required error={errors.author}>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field
              label="ISBN"
              error={errors.isbn}
              help={isbn && !isbnOk ? 'Must be 10 or 13 digits' : undefined}
            >
              <Input value={isbn} onChange={(e) => setIsbn(e.target.value)} />
            </Field>
            <Field label="Publisher" error={errors.publisher}>
              <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </Field>
            <Field label="Edition" error={errors.edition}>
              <Input
                value={edition}
                onChange={(e) => setEdition(e.target.value)}
                placeholder="3rd"
              />
            </Field>
          </FieldRow>

          <FieldRow columns={4}>
            <Field label="Language" error={errors.language}>
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
            </Field>
            <Field label="Published" error={errors.publishYear}>
              <Input
                type="number"
                min={1400}
                max={new Date().getFullYear() + 1}
                value={publishYear}
                onChange={(e) => setPublishYear(e.target.value)}
              />
            </Field>
            <Field label="Pages" error={errors.pages}>
              <Input
                type="number"
                min={1}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </Field>
            <Field label="Price" error={errors.price} help="Used to charge for a lost copy">
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Rack location" error={errors.rackLocation}>
              <Input
                value={rackLocation}
                onChange={(e) => setRackLocation(e.target.value)}
                placeholder="R3-S2"
              />
            </Field>
            <Field label="Copies" required error={errors.copies} help="Physical copies to accession">
              <Input
                type="number"
                min={1}
                max={500}
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </Field>
          </FieldRow>

          <Field label="Description" error={errors.description}>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function AddCopiesDialog({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const [count, setCount] = React.useState('1');
  const countNumber = Number(count);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add copies"
      description={`${book.title} — currently ${book.totalCopies} ${
        book.totalCopies === 1 ? 'copy' : 'copies'
      } on the catalogue.`}
      submitLabel="Add copies"
      values={{ count }}
      isValid={Number.isFinite(countNumber) && countNumber >= 1 && countNumber <= 500}
      successMessage="Copies added"
      invalidates={LIBRARY_QUERIES}
      submit={(values) =>
        api.post(`/library/books/${book.id}/copies`, { count: Number(values.count) })
      }
    >
      {(errors) => (
        <Field label="How many" required error={errors.count}>
          <Input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            autoFocus
          />
        </Field>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Circulation
// ---------------------------------------------------------------------------

function IssueBookDialog({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const [borrowerType, setBorrowerType] = React.useState<'STUDENT' | 'STAFF'>('STUDENT');
  const [studentQuery, setStudentQuery] = React.useState('');
  const [studentId, setStudentId] = React.useState('');
  const [staffId, setStaffId] = React.useState('');
  const [days, setDays] = React.useState('');
  const [remarks, setRemarks] = React.useState('');

  const { data: staff } = useStaffOptions(borrowerType === 'STAFF');

  // Only search once the term is worth a round trip.
  const students = useQuery({
    queryKey: ['library', 'student-search', studentQuery],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; firstName: string; lastName: string | null; admissionNumber: string }> }>(
        '/students',
        { search: studentQuery, limit: 10 },
      ),
    enabled: borrowerType === 'STUDENT' && studentQuery.trim().length >= 2,
  });

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Issue a book"
      description={`${book.title} — ${book.availableCopies} available`}
      submitLabel="Issue"
      values={{ borrowerType, studentId, staffId, days, remarks }}
      isValid={borrowerType === 'STUDENT' ? Boolean(studentId) : Boolean(staffId)}
      successMessage="Book issued"
      invalidates={LIBRARY_QUERIES}
      submit={(values) =>
        api.post('/library/issues', {
          bookId: book.id,
          ...(values.borrowerType === 'STUDENT'
            ? { studentId: values.studentId }
            : { staffId: values.staffId }),
          ...(values.days ? { days: Number(values.days) } : {}),
          ...(values.remarks.trim() ? { remarks: values.remarks.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Borrower">
            <Select
              value={borrowerType}
              onChange={(e) => {
                setBorrowerType(e.target.value as 'STUDENT' | 'STAFF');
                setStudentId('');
                setStaffId('');
              }}
            >
              <option value="STUDENT">Student</option>
              <option value="STAFF">Staff member</option>
            </Select>
          </Field>

          {borrowerType === 'STUDENT' ? (
            <>
              <Field label="Find the student" required error={errors.studentId}>
                <Input
                  value={studentQuery}
                  onChange={(e) => {
                    setStudentQuery(e.target.value);
                    setStudentId('');
                  }}
                  placeholder="Name or admission number"
                  autoFocus
                />
              </Field>

              {(students.data?.items ?? []).length > 0 ? (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-1">
                  {(students.data?.items ?? []).map((student) => (
                    <label
                      key={student.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-surface-sunken)]"
                    >
                      <input
                        type="radio"
                        name="borrower"
                        checked={studentId === student.id}
                        onChange={() => setStudentId(student.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {student.firstName} {student.lastName ?? ''}
                        </span>
                        <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                          {student.admissionNumber}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <Field label="Staff member" required error={errors.staffId}>
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} autoFocus>
                <option value="">Choose a staff member</option>
                {(staff ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName ?? `${member.firstName} ${member.lastName ?? ''}`} (
                    {member.employeeId})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <FieldRow>
            <Field
              label="Loan length (days)"
              error={errors.days}
              help="Leave blank for the library default"
            >
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <Field label="Remarks" error={errors.remarks}>
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

function ReturnBookDialog({ issue, onClose }: { issue: IssueRow; onClose: () => void }) {
  const [condition, setCondition] = React.useState('GOOD');
  const [replacementCost, setReplacementCost] = React.useState('');
  const [remarks, setRemarks] = React.useState('');

  const chargeable = condition === 'DAMAGED' || condition === 'LOST';

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Return a book"
      description={`${issue.bookCopy.book.title} — ${issue.bookCopy.accessionNumber}${
        issue.daysOverdue > 0 ? ` · ${issue.daysOverdue} days overdue` : ''
      }`}
      submitLabel="Record return"
      values={{ condition, replacementCost, remarks }}
      successMessage="Return recorded"
      invalidates={LIBRARY_QUERIES}
      submit={(values) =>
        api.post(`/library/issues/${issue.id}/return`, {
          condition: values.condition,
          ...(chargeable && values.replacementCost
            ? { replacementCost: Number(values.replacementCost) }
            : {}),
          ...(values.remarks.trim() ? { remarks: values.remarks.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Condition" error={errors.condition}>
            <Select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              autoFocus
            >
              {BOOK_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0) + value.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          {chargeable ? (
            <Field
              label="Replacement cost"
              error={errors.replacementCost}
              help="Leave blank to charge the catalogued price"
            >
              <Input
                type="number"
                min={0}
                value={replacementCost}
                onChange={(e) => setReplacementCost(e.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Remarks" error={errors.remarks}>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
