'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bus, MapPin, TriangleAlert, UserRound } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney, formatPercent } from '@/lib/utils';
import { formatClock } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Route {
  id: string;
  name: string;
  code: string;
  baseFare: string;
  isActive: boolean;
  startTime: string | null;
  endTime: string | null;
  distanceKm: string | null;
  studentCount: number;
  seatsRemaining: number | null;
  isOverCapacity: boolean;
  vehicle: { id: string; registrationNumber: string; name: string | null; capacity: number } | null;
  driver: { id: string; name: string; phone: string } | null;
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    pickupTime: string | null;
    dropTime: string | null;
  }>;
}

interface Vehicle {
  id: string;
  registrationNumber: string;
  name: string | null;
  capacity: number;
  status: string;
  trackingEnabled: boolean;
  occupancy?: number;
  expiringDocuments?: string[];
}

interface TransportStats {
  activeVehicles: number;
  activeDrivers: number;
  activeRoutes: number;
  studentsUsingTransport: number;
  totalCapacity: number;
  utilisationPercent: number;
}

export default function TransportPage() {
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';

  const { data: stats } = useQuery({
    queryKey: ['transport', 'statistics'],
    queryFn: () => api.get<TransportStats>('/transport/statistics'),
    staleTime: 60_000,
  });

  const routes = useQuery({
    queryKey: ['transport', 'routes'],
    queryFn: () => api.get<Route[]>('/transport/routes'),
  });

  const vehicles = useQuery({
    queryKey: ['transport', 'vehicles'],
    queryFn: () => api.get<{ items: Vehicle[] }>('/transport/vehicles', { limit: 100 }),
  });

  return (
    <>
      <PageHeader
        title="Transport"
        description="Fleet, routes and how full each bus is running."
      />

      {stats ? (
        <StatGrid columns={5} className="mb-4">
          <StatCard label="Vehicles" value={stats.activeVehicles} icon={<Bus />} />
          <StatCard label="Drivers" value={stats.activeDrivers} icon={<UserRound />} />
          <StatCard label="Routes" value={stats.activeRoutes} icon={<MapPin />} />
          <StatCard label="Students riding" value={stats.studentsUsingTransport} />
          <StatCard
            label="Fleet utilisation"
            value={formatPercent(stats.utilisationPercent)}
            hint={`${stats.totalCapacity} seats`}
          />
        </StatGrid>
      ) : null}

      <Tabs defaultValue="routes">
        <TabsList>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
        </TabsList>

        <TabsContent value="routes">
          {routes.isLoading ? (
            <LoadingState label="Loading routes" />
          ) : routes.error ? (
            <ErrorState error={routes.error} onRetry={() => routes.refetch()} />
          ) : (routes.data ?? []).length === 0 ? (
            <EmptyState
              icon={<MapPin />}
              title="No routes yet"
              description="Create a route and add its stops to start assigning students."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {(routes.data ?? []).map((route) => {
                const capacity = route.vehicle?.capacity ?? 0;
                const fillPercent = capacity > 0 ? (route.studentCount / capacity) * 100 : 0;

                return (
                  <Card key={route.id}>
                    <CardHeader
                      title={route.name}
                      description={`${route.code}${
                        route.distanceKm ? ` · ${route.distanceKm} km` : ''
                      }`}
                      actions={
                        route.isOverCapacity ? (
                          <Badge tone="danger">Over capacity</Badge>
                        ) : !route.isActive ? (
                          <Badge>Inactive</Badge>
                        ) : null
                      }
                    />
                    <CardBody className="space-y-3">
                      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                        <dt className="text-[var(--color-ink-muted)]">Bus</dt>
                        <dd className="font-medium">
                          {route.vehicle?.registrationNumber ?? '—'}
                        </dd>
                        <dt className="text-[var(--color-ink-muted)]">Driver</dt>
                        <dd className="font-medium">{route.driver?.name ?? '—'}</dd>
                        <dt className="text-[var(--color-ink-muted)]">Runs</dt>
                        <dd className="font-medium tabular">
                          {formatClock(route.startTime)} – {formatClock(route.endTime)}
                        </dd>
                        <dt className="text-[var(--color-ink-muted)]">Annual fare</dt>
                        <dd className="font-medium tabular">
                          {formatMoney(route.baseFare, currency)}
                        </dd>
                      </dl>

                      <div>
                        <div className="mb-1 flex items-center justify-between text-2xs">
                          <span className="text-[var(--color-ink-muted)]">Occupancy</span>
                          <span className="font-medium tabular">
                            {route.studentCount} / {capacity || '—'}
                            {route.seatsRemaining !== null
                              ? ` · ${route.seatsRemaining} free`
                              : ''}
                          </span>
                        </div>
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                          role="img"
                          aria-label={`${fillPercent.toFixed(0)} percent full`}
                        >
                          <div
                            className="h-full rounded-full transition-[width]"
                            style={{
                              width: `${Math.min(100, fillPercent)}%`,
                              background:
                                fillPercent >= 100
                                  ? 'var(--color-danger)'
                                  : fillPercent >= 85
                                    ? 'var(--color-warning)'
                                    : 'var(--color-accent)',
                            }}
                          />
                        </div>
                      </div>

                      {route.stops.length > 0 ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-xs text-[var(--color-accent)]">
                            {route.stops.length} stops
                          </summary>
                          <ol className="mt-2 space-y-1 border-l border-[var(--color-border)] pl-3">
                            {route.stops
                              .slice()
                              .sort((a, b) => a.sequence - b.sequence)
                              .map((stop) => (
                                <li
                                  key={stop.id}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span>{stop.name}</span>
                                  <span className="tabular text-[var(--color-ink-muted)]">
                                    {formatClock(stop.pickupTime)}
                                  </span>
                                </li>
                              ))}
                          </ol>
                        </details>
                      ) : null}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="fleet">
          {vehicles.isLoading ? (
            <LoadingState label="Loading fleet" />
          ) : vehicles.error ? (
            <ErrorState error={vehicles.error} onRetry={() => vehicles.refetch()} />
          ) : (vehicles.data?.items ?? []).length === 0 ? (
            <EmptyState icon={<Bus />} title="No vehicles yet" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(vehicles.data?.items ?? []).map((vehicle) => (
                <Card key={vehicle.id}>
                  <CardBody>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium tabular">
                          {vehicle.registrationNumber}
                        </p>
                        <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                          {vehicle.name ?? 'Vehicle'}
                        </p>
                      </div>
                      <StatusBadge status={vehicle.status} />
                    </div>

                    <dl className="grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-[var(--color-ink-muted)]">Seats</dt>
                      <dd className="font-medium tabular">{vehicle.capacity}</dd>
                      <dt className="text-[var(--color-ink-muted)]">Tracking</dt>
                      <dd className="font-medium">
                        {vehicle.trackingEnabled ? 'Enabled' : 'Off'}
                      </dd>
                    </dl>

                    {vehicle.expiringDocuments && vehicle.expiringDocuments.length > 0 ? (
                      <p className="mt-2 flex items-start gap-1 text-2xs text-[var(--color-warning)]">
                        <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                        {vehicle.expiringDocuments.map(humanise).join(', ')} expiring
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
