'use client';

import * as React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { Paginated } from '@erp/shared-types';
import { api } from '@/lib/api';

export interface ListState {
  page: number;
  limit: number;
  search: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, string | undefined>;
}

/**
 * Query state for a paginated list, plus the request that follows from it.
 *
 * Search is debounced and every filter change resets to page one — without
 * that, narrowing a filter while on page 7 shows an empty table and looks
 * broken. `keepPreviousData` holds the old rows while the next page loads, so
 * paging does not flash a skeleton over a table the user is reading.
 */
export function useListQuery<T>(
  key: string,
  path: string,
  options: {
    initialLimit?: number;
    initialSortBy?: string;
    initialSortOrder?: 'asc' | 'desc';
    initialFilters?: Record<string, string | undefined>;
    /** Extra parameters that are not user-editable filters. */
    extraParams?: Record<string, unknown>;
    enabled?: boolean;
  } = {},
) {
  const [state, setState] = React.useState<ListState>({
    page: 1,
    limit: options.initialLimit ?? 25,
    search: '',
    sortBy: options.initialSortBy,
    sortOrder: options.initialSortOrder ?? 'desc',
    filters: options.initialFilters ?? {},
  });

  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(state.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [state.search]);

  const params = {
    page: state.page,
    limit: state.limit,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(state.sortBy ? { sortBy: state.sortBy, sortOrder: state.sortOrder } : {}),
    ...state.filters,
    ...options.extraParams,
  };

  const query = useQuery({
    queryKey: [key, params],
    queryFn: () => api.get<Paginated<T>>(path, params),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });

  const setPage = React.useCallback((page: number) => setState((s) => ({ ...s, page })), []);

  const setSearch = React.useCallback(
    (search: string) => setState((s) => ({ ...s, search, page: 1 })),
    [],
  );

  const setSort = React.useCallback(
    (sortBy: string, sortOrder: 'asc' | 'desc') =>
      setState((s) => ({ ...s, sortBy, sortOrder, page: 1 })),
    [],
  );

  const setFilter = React.useCallback(
    (key: string, value: string | undefined) =>
      setState((s) => ({
        ...s,
        page: 1,
        // An empty selection removes the filter rather than sending `""`,
        // which the API would treat as a real value to match on.
        filters: { ...s.filters, [key]: value || undefined },
      })),
    [],
  );

  const resetFilters = React.useCallback(
    () => setState((s) => ({ ...s, page: 1, search: '', filters: options.initialFilters ?? {} })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const activeFilterCount = Object.values(state.filters).filter(Boolean).length;

  return {
    ...query,
    items: query.data?.items ?? [],
    meta: query.data?.meta,
    state,
    params,
    setPage,
    setSearch,
    setSort,
    setFilter,
    resetFilters,
    activeFilterCount,
  };
}
