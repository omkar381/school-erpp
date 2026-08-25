'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart, FileSpreadsheet, FileText, Play, Table2 } from 'lucide-react';
import type { ReportRun, ReportSummaryItem } from '@erp/shared-types';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { cn, saveBlob } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '@/components/ui/states';

type Format = 'xlsx' | 'csv' | 'pdf';

export default function ReportsPage() {
  const params = useSearchParams();
  const canExport = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('reports.export'),
  );

  const [selectedKey, setSelectedKey] = React.useState<string | null>(params.get('report'));
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(1);
  const [ran, setRan] = React.useState(false);
  const [exporting, setExporting] = React.useState<Format | null>(null);

  const catalogue = useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: () => api.get<ReportSummaryItem[]>('/reports'),
    staleTime: 10 * 60_000,
  });

  const definition = (catalogue.data ?? []).find((report) => report.key === selectedKey) ?? null;

  const { data: classes } = useClasses(Boolean(definition));
  const { data: sections } = useSections(filters.classId);

  // A required filter left blank means the server would only refuse the run.
  const missing = (definition?.filters ?? [])
    .filter((filter) => filter.required && !filters[filter.key])
    .map((filter) => filter.label);

  const run = useQuery({
    queryKey: ['reports', 'run', selectedKey, filters, page],
    queryFn: () =>
      api.post<ReportRun>('/reports/run', {
        key: selectedKey,
        filters,
        page,
        limit: 50,
      }),
    enabled: Boolean(selectedKey) && ran && missing.length === 0,
  });

  function selectReport(key: string) {
    setSelectedKey(key);
    setRan(false);
    setPage(1);

    // Date-ranged reports open on the last thirty days rather than empty, so
    // one click actually produces something.
    const report = (catalogue.data ?? []).find((entry) => entry.key === key);
    const defaults: Record<string, string> = {};
    for (const filter of report?.filters ?? []) {
      if (filter.key === 'from') defaults.from = daysAgo(30);
      if (filter.key === 'to') defaults.to = today();
    }
    setFilters(defaults);
  }

  async function exportAs(format: Format) {
    if (!selectedKey) return;
    setExporting(format);
    try {
      const file = await api.download('/reports/export', {
        method: 'POST',
        body: { key: selectedKey, filters, format },
      });
      saveBlob(file.blob, file.fileName);
    } finally {
      setExporting(null);
    }
  }

  if (catalogue.isLoading) return <LoadingState label="Loading reports" />;
  if (catalogue.error) {
    return <ErrorState error={catalogue.error} onRetry={() => catalogue.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Run a report, review it on screen, then export it as a spreadsheet or PDF."
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <CardHeader title="Available reports" />
          <CardBody className="max-h-[32rem] overflow-y-auto p-1.5">
            <ul className="space-y-px">
              {(catalogue.data ?? []).map((report) => (
                <li key={report.key}>
                  <button
                    type="button"
                    onClick={() => selectReport(report.key)}
                    className={cn(
                      'w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors',
                      report.key === selectedKey
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-surface-sunken)]',
                    )}
                  >
                    <span className="block text-sm font-medium">{report.name}</span>
                    <span className="block text-2xs text-[var(--color-ink-muted)]">
                      {humanise(report.module)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          {!definition ? (
            <EmptyState
              icon={<FileBarChart />}
              title="Choose a report"
              description="Pick one from the list to set its filters and run it."
            />
          ) : (
            <>
              <Card>
                <CardHeader title={definition.name} description={definition.description} />
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {definition.filters.map((filter) => {
                      const value = filters[filter.key] ?? '';
                      const set = (next: string) => {
                        setFilters((current) => {
                          const updated = { ...current, [filter.key]: next };
                          if (!next) delete updated[filter.key];
                          // A section from the previous class would filter
                          // everything out, so clear it when the class changes.
                          if (filter.key === 'classId') delete updated.sectionId;
                          return updated;
                        });
                        setPage(1);
                      };

                      if (filter.type === 'date') {
                        return (
                          <Field key={filter.key} label={filter.label} required={filter.required}>
                            <Input
                              type="date"
                              value={value}
                              onChange={(event) => set(event.target.value)}
                            />
                          </Field>
                        );
                      }

                      if (filter.type === 'enum') {
                        return (
                          <Field key={filter.key} label={filter.label} required={filter.required}>
                            <Select value={value} onChange={(event) => set(event.target.value)}>
                              <option value="">All</option>
                              {(filter.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {humanise(option)}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        );
                      }

                      if (filter.source === 'class') {
                        return (
                          <Field key={filter.key} label={filter.label} required={filter.required}>
                            <Select value={value} onChange={(event) => set(event.target.value)}>
                              <option value="">All classes</option>
                              {(classes ?? []).map((klass) => (
                                <option key={klass.id} value={klass.id}>
                                  {klass.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        );
                      }

                      if (filter.source === 'section') {
                        return (
                          <Field key={filter.key} label={filter.label} required={filter.required}>
                            <Select
                              value={value}
                              disabled={!filters.classId}
                              onChange={(event) => set(event.target.value)}
                            >
                              <option value="">All sections</option>
                              {(sections ?? []).map((section) => (
                                <option key={section.id} value={section.id}>
                                  Section {section.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        );
                      }

                      return (
                        <Field
                          key={filter.key}
                          label={filter.label}
                          required={filter.required}
                          help={filter.type === 'uuid' ? 'Paste an id' : undefined}
                        >
                          <Input value={value} onChange={(event) => set(event.target.value)} />
                        </Field>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Play />}
                      disabled={missing.length > 0}
                      loading={run.isFetching && ran}
                      onClick={() => {
                        setPage(1);
                        setRan(true);
                      }}
                    >
                      Run report
                    </Button>

                    {canExport ? (
                      <>
                        <Button
                          size="sm"
                          icon={<FileSpreadsheet />}
                          disabled={missing.length > 0}
                          loading={exporting === 'xlsx'}
                          onClick={() => exportAs('xlsx')}
                        >
                          Excel
                        </Button>
                        <Button
                          size="sm"
                          icon={<Table2 />}
                          disabled={missing.length > 0}
                          loading={exporting === 'csv'}
                          onClick={() => exportAs('csv')}
                        >
                          CSV
                        </Button>
                        <Button
                          size="sm"
                          icon={<FileText />}
                          disabled={missing.length > 0}
                          loading={exporting === 'pdf'}
                          onClick={() => exportAs('pdf')}
                        >
                          PDF
                        </Button>
                      </>
                    ) : null}

                    {missing.length > 0 ? (
                      <span className="text-xs text-[var(--color-warning)]">
                        {missing.join(' and ')} {missing.length > 1 ? 'are' : 'is'} required
                      </span>
                    ) : null}
                  </div>
                </CardBody>
              </Card>

              {!ran ? null : run.isLoading ? (
                <Card>
                  <TableSkeleton rows={8} columns={definition.columns.length} />
                </Card>
              ) : run.error ? (
                <ErrorState error={run.error} onRetry={() => run.refetch()} />
              ) : run.data ? (
                <>
                  {run.data.summary.length > 0 ? (
                    <StatGrid columns={Math.min(4, run.data.summary.length) as 2 | 3 | 4}>
                      {run.data.summary.map((tile) => (
                        <StatCard key={tile.label} label={tile.label} value={tile.value} />
                      ))}
                    </StatGrid>
                  ) : null}

                  <Card>
                    <CardHeader
                      title={`${run.data.total.toLocaleString('en-IN')} rows`}
                      description={`Academic year ${run.data.academicYear}`}
                    />
                    <CardBody className="p-0">
                      {run.data.items.length === 0 ? (
                        <EmptyState
                          title="No rows matched these filters"
                          description="Widen the date range or clear a filter."
                        />
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-[var(--color-surface-sunken)]">
                              <tr className="hairline">
                                {run.data.columns.map((column) => (
                                  <th
                                    key={column.key}
                                    className={cn(
                                      'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]',
                                      ['number', 'currency', 'percent'].includes(column.type ?? '')
                                        ? 'text-right'
                                        : 'text-left',
                                    )}
                                  >
                                    {column.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--color-border)]">
                              {run.data.items.map((row, index) => (
                                <tr key={index} className="hover:bg-[var(--color-surface-sunken)]">
                                  {run.data!.columns.map((column) => (
                                    <td
                                      key={column.key}
                                      className={cn(
                                        'whitespace-nowrap px-3 py-2',
                                        ['number', 'currency', 'percent'].includes(
                                          column.type ?? '',
                                        ) && 'numeric',
                                      )}
                                    >
                                      {row[column.key] ?? '—'}
                                    </td>
                                  ))}
                                </tr>
                              ))}

                              {run.data.totals ? (
                                <tr className="bg-[var(--color-surface-sunken)] font-semibold">
                                  {run.data.columns.map((column, index) => (
                                    <td
                                      key={column.key}
                                      className={cn(
                                        'whitespace-nowrap px-3 py-2',
                                        ['number', 'currency', 'percent'].includes(
                                          column.type ?? '',
                                        ) && 'numeric',
                                      )}
                                    >
                                      {run.data!.totals?.[column.key] ??
                                        (index === 0 ? 'TOTAL' : '')}
                                    </td>
                                  ))}
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardBody>

                    {run.data.total > run.data.limit ? (
                      <Pagination
                        meta={{
                          page: run.data.page,
                          limit: run.data.limit,
                          total: run.data.total,
                          totalPages: run.data.totalPages,
                          hasNextPage: run.data.page < run.data.totalPages,
                          hasPreviousPage: run.data.page > 1,
                        }}
                        onPageChange={setPage}
                      />
                    ) : null}
                  </Card>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
