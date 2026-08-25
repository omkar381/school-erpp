'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, PackageMinus, PackagePlus, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney, formatNumber } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, Modal } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FilterBar, FilterSelect } from '@/components/ui/filter-bar';
import { Input, Select, Textarea } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';

interface ItemRow {
  id: string;
  name: string;
  code: string;
  unit: string;
  quantity: string;
  reorderLevel: string;
  unitCost: string;
  location: string | null;
  stockValue: number;
  isLowStock: boolean;
  category: { id: string; name: string } | null;
}

interface InventoryStats {
  activeItems: number;
  stockValue: number;
  lowStockItems: number;
  pendingPurchases: number;
  spendThisMonth: number;
}

type MovementKind = 'stock-in' | 'stock-out';

export default function InventoryPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('inventory.manage'),
  );

  const [movement, setMovement] = React.useState<{ item: ItemRow; kind: MovementKind } | null>(
    null,
  );

  const { data: stats } = useQuery({
    queryKey: ['inventory', 'statistics'],
    queryFn: () => api.get<InventoryStats>('/inventory/statistics'),
    staleTime: 60_000,
  });

  const { data: categories } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/inventory/categories'),
    staleTime: 10 * 60_000,
  });

  const list = useListQuery<ItemRow>('inventory-items', '/inventory/items', {
    initialSortBy: 'name',
    initialSortOrder: 'asc',
  });

  const columns: Column<ItemRow>[] = [
    {
      key: 'name',
      header: 'Item',
      sortable: true,
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="block truncate text-2xs text-[var(--color-ink-muted)]">{row.code}</span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (row) => row.category?.name ?? '—',
    },
    {
      key: 'quantity',
      header: 'On hand',
      numeric: true,
      sortable: true,
      cell: (row) => (
        <span className={row.isLowStock ? 'font-medium text-[var(--color-warning)]' : undefined}>
          {formatNumber(row.quantity)} {row.unit}
        </span>
      ),
    },
    {
      key: 'reorderLevel',
      header: 'Reorder at',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatNumber(row.reorderLevel),
    },
    {
      key: 'unitCost',
      header: 'Unit cost',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatMoney(row.unitCost, currency),
    },
    {
      key: 'stockValue',
      header: 'Value',
      numeric: true,
      cell: (row) => formatMoney(row.stockValue, currency),
    },
    {
      key: 'location',
      header: 'Location',
      hideOnMobile: true,
      cell: (row) => row.location ?? '—',
    },
    {
      key: 'flag',
      header: '',
      cell: (row) =>
        Number(row.quantity) <= 0 ? (
          <Badge tone="danger">Out of stock</Badge>
        ) : row.isLowStock ? (
          <Badge tone="warning">Reorder</Badge>
        ) : null,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            width: '5rem',
            cell: (row: ItemRow) => (
              <span className="flex gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Receive stock for ${row.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMovement({ item: row, kind: 'stock-in' });
                  }}
                >
                  <PackagePlus />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Issue stock of ${row.name}`}
                  disabled={Number(row.quantity) <= 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMovement({ item: row, kind: 'stock-out' });
                  }}
                >
                  <PackageMinus />
                </Button>
              </span>
            ),
          } satisfies Column<ItemRow>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand, valuation and movement across the school store."
      />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Active items" value={stats.activeItems} icon={<Boxes />} />
          <StatCard
            label="Stock value"
            value={formatMoney(stats.stockValue, currency, { compact: true })}
          />
          <StatCard
            label="Need reordering"
            value={stats.lowStockItems}
            icon={<TriangleAlert />}
            invertTrend
          />
          <StatCard label="Purchases pending" value={stats.pendingPurchases} />
          <StatCard
            label="Spend this month"
            value={formatMoney(stats.spendThisMonth, currency, { compact: true })}
          />
        </StatGrid>
      ) : null}

      <FilterBar
        search={list.state.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by item name, code or location"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <FilterSelect
          label="Category"
          value={list.state.filters.categoryId}
          onChange={(value) => list.setFilter('categoryId', value)}
          options={(categories ?? []).map((category) => ({
            value: category.id,
            label: category.name,
          }))}
        />
        <FilterSelect
          label="Stock"
          value={list.state.filters.lowStockOnly}
          onChange={(value) => list.setFilter('lowStockOnly', value)}
          allLabel="All stock levels"
          options={[{ value: 'true', label: 'Low stock only' }]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        meta={list.meta}
        onPageChange={list.setPage}
        sortBy={list.state.sortBy}
        sortOrder={list.state.sortOrder}
        onSortChange={list.setSort}
        empty={
          <EmptyState
            icon={<Boxes />}
            title="No items match these filters"
            description="Add an item to start tracking stock."
          />
        }
      />

      {movement ? (
        <StockMovementDialog
          item={movement.item}
          kind={movement.kind}
          currency={currency}
          onClose={() => setMovement(null)}
        />
      ) : null}
    </>
  );
}

function StockMovementDialog({
  item,
  kind,
  currency,
  onClose,
}: {
  item: ItemRow;
  kind: MovementKind;
  currency: string;
  onClose: () => void;
}) {
  const receiving = kind === 'stock-in';
  const onHand = Number(item.quantity);

  const [quantity, setQuantity] = React.useState('');
  const [unitCost, setUnitCost] = React.useState(receiving ? item.unitCost : '');
  const [reference, setReference] = React.useState('');
  const [issuedToType, setIssuedToType] = React.useState('DEPARTMENT');
  const [notes, setNotes] = React.useState('');

  const amount = Number(quantity || 0);
  const tooMuch = !receiving && amount > onHand;

  const move = useAction({
    mutationFn: () =>
      api.post(`/inventory/items/${item.id}/${kind}`, {
        quantity: amount,
        ...(receiving && unitCost ? { unitCost: Number(unitCost) } : {}),
        ...(reference ? { reference } : {}),
        ...(receiving ? {} : { issuedToType }),
        ...(notes ? { notes } : {}),
      }),
    successMessage: receiving ? 'Stock received' : 'Stock issued',
    invalidates: [['inventory-items'], ['inventory']],
    onSuccess: onClose,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Modal
        size="sm"
        title={receiving ? `Receive ${item.name}` : `Issue ${item.name}`}
        description={`${formatNumber(onHand)} ${item.unit} on hand`}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={move.isPending}
              disabled={amount <= 0 || tooMuch}
              onClick={() => move.mutate(undefined)}
            >
              {receiving ? 'Receive' : 'Issue'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label={`Quantity (${item.unit})`}
            required
            error={
              tooMuch
                ? `Only ${formatNumber(onHand)} ${item.unit} remain in stock`
                : amount < 0
                  ? 'Enter a positive quantity'
                  : undefined
            }
          >
            <Input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              autoFocus
              className="text-right tabular"
            />
          </Field>

          {receiving ? (
            <Field
              label="Unit cost"
              help="Updates the item's costing for future valuation"
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                className="text-right tabular"
              />
            </Field>
          ) : (
            <Field label="Issued to">
              <Select
                value={issuedToType}
                onChange={(event) => setIssuedToType(event.target.value)}
              >
                <option value="DEPARTMENT">Department</option>
                <option value="CLASS">Class</option>
                <option value="STAFF">Staff</option>
                <option value="STUDENT">Student</option>
              </Select>
            </Field>
          )}

          <Field label="Reference" help="Purchase order or requisition number">
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Optional"
            />
          </Field>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
            />
          </Field>

          {amount > 0 && !tooMuch ? (
            <p className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2.5 py-2 text-2xs text-[var(--color-ink-secondary)]">
              Balance after this movement:{' '}
              <span className="font-semibold tabular">
                {formatNumber(receiving ? onHand + amount : onHand - amount)} {item.unit}
              </span>
              {receiving && unitCost ? (
                <>
                  {' · '}
                  {formatMoney(amount * Number(unitCost), currency)} received
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </Modal>
    </Dialog>
  );
}
