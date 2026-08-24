'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type { PaginationMeta } from '@erp/shared-types';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { EmptyState, ErrorState, TableSkeleton } from './states';

export interface Column<T> {
  /** Stable identity for the column; also the sort key sent to the API. */
  key: string;
  header: React.ReactNode;
  /** Omit to render `row[key]`. */
  cell?: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  sortable?: boolean;
  /** Hidden below the `sm` breakpoint, for columns that do not survive a phone. */
  hideOnMobile?: boolean;
  /** Numbers get tabular figures so they line up down the column. */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  rowKey: (row: T) => string;

  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;

  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSortChange?: (key: string, order: 'asc' | 'desc') => void;

  onRowClick?: (row: T) => void;
  /** Rendered when the query succeeded but matched nothing. */
  empty?: React.ReactNode;

  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Shown above the table while at least one row is selected. */
  bulkActions?: (selectedIds: string[]) => React.ReactNode;

  className?: string;
  /** Sticks the header while the body scrolls. */
  stickyHeader?: boolean;
}

/**
 * The table every administrative list uses.
 *
 * Sorting and paging are controlled: the parent owns the query state and the
 * server does the work, because these lists routinely run to thousands of rows
 * and must never be sorted or sliced in the browser.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  meta,
  onPageChange,
  sortBy,
  sortOrder = 'desc',
  onSortChange,
  onRowClick,
  empty,
  selectable,
  selectedIds = [],
  onSelectionChange,
  bulkActions,
  className,
  stickyHeader,
}: DataTableProps<T>) {
  const visible = columns;
  const selected = new Set(selectedIds);

  const pageIds = (rows ?? []).map(rowKey);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id)) && !allSelected;

  const headerCheckbox = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    // The indeterminate state is a DOM property, not an attribute.
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(
      allSelected
        ? selectedIds.filter((id) => !pageIds.includes(id))
        : [...new Set([...selectedIds, ...pageIds])],
    );
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    onSelectionChange(
      selected.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id],
    );
  }

  function handleSort(column: Column<T>) {
    if (!column.sortable || !onSortChange) return;
    const next = sortBy === column.key && sortOrder === 'asc' ? 'desc' : 'asc';
    onSortChange(column.key, next);
  }

  const body = (() => {
    if (isLoading) return <TableSkeleton columns={visible.length + (selectable ? 1 : 0)} />;
    if (error) return <ErrorState error={error} onRetry={onRetry} />;
    if (!rows || rows.length === 0) {
      return empty ?? <EmptyState title="No records found" description="Try adjusting the filters." />;
    }
    return null;
  })();

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        className,
      )}
    >
      {selectable && selectedIds.length > 0 && bulkActions ? (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--color-ink)]">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-1.5">
            {bulkActions(selectedIds)}
            <Button size="xs" variant="ghost" onClick={() => onSelectionChange?.([])}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead
            className={cn(
              'bg-[var(--color-surface-sunken)]',
              stickyHeader && 'sticky top-0 z-10',
            )}
          >
            <tr className="hairline">
              {selectable ? (
                <th scope="col" className="w-9 px-3 py-2">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                    className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                  />
                </th>
              ) : null}

              {visible.map((column) => {
                const active = sortBy === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]',
                      column.align === 'right' || column.numeric ? 'text-right' : '',
                      column.align === 'center' ? 'text-center' : '',
                      (!column.align || column.align === 'left') && !column.numeric
                        ? 'text-left'
                        : '',
                      column.hideOnMobile && 'hidden sm:table-cell',
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-[var(--color-ink)] transition-colors',
                          active && 'text-[var(--color-ink)]',
                          column.align === 'right' || column.numeric ? 'flex-row-reverse' : '',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {!body && rows ? (
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row, index) => {
                const id = rowKey(row);
                const isSelected = selected.has(id);

                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'transition-colors',
                      isSelected
                        ? 'bg-[var(--color-accent-soft)]'
                        : 'hover:bg-[var(--color-surface-sunken)]',
                      onRowClick && 'cursor-pointer',
                    )}
                  >
                    {selectable ? (
                      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          aria-label={`Select row ${index + 1}`}
                          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                        />
                      </td>
                    ) : null}

                    {visible.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-3 py-2 text-[var(--color-ink)]',
                          column.numeric && 'numeric',
                          column.align === 'right' && 'text-right',
                          column.align === 'center' && 'text-center',
                          column.hideOnMobile && 'hidden sm:table-cell',
                        )}
                      >
                        {column.cell
                          ? column.cell(row, index)
                          : String((row as Record<string, unknown>)[column.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ) : null}
        </table>
      </div>

      {body}

      {meta && meta.total > 0 ? <Pagination meta={meta} onPageChange={onPageChange} /> : null}
    </div>
  );
}

export function Pagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta;
  onPageChange?: (page: number) => void;
}) {
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-[var(--color-ink-muted)] tabular">
        Showing <span className="font-medium text-[var(--color-ink)]">{from}</span>–
        <span className="font-medium text-[var(--color-ink)]">{to}</span> of{' '}
        <span className="font-medium text-[var(--color-ink)]">
          {meta.total.toLocaleString('en-IN')}
        </span>
      </p>

      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!meta.hasPreviousPage}
          onClick={() => onPageChange?.(meta.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 text-xs text-[var(--color-ink-secondary)] tabular">
          Page {meta.page} of {meta.totalPages}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!meta.hasNextPage}
          onClick={() => onPageChange?.(meta.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
