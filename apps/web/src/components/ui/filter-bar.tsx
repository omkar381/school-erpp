'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input, Select } from './input';

/** The search-and-filter strip above every list. */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  activeFilterCount = 0,
  onReset,
  children,
  actions,
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  activeFilterCount?: number;
  onReset?: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          icon={<Search />}
          aria-label={searchPlaceholder}
          className={search ? 'pr-7' : undefined}
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {children}

      {activeFilterCount > 0 && onReset ? (
        <Button size="sm" variant="ghost" onClick={onReset} icon={<X />}>
          Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
        </Button>
      ) : null}

      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A labelled dropdown filter with an "all" option built in. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
  className?: string;
}) {
  return (
    <Select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      aria-label={label}
      className={cn('w-auto min-w-32', className)}
    >
      <option value="">{allLabel ?? `All ${label.toLowerCase()}`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
