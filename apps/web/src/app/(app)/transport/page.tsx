'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bus,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { BLOOD_GROUPS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useListQuery } from '@/hooks/use-list-query';
import { formatMoney, formatPercent, initials } from '@/lib/utils';
import { formatClock } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
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
  type?: string;
  make?: string | null;
  model?: string | null;
  insuranceNumber?: string | null;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
  permitExpiry?: string | null;
  pollutionExpiry?: string | null;
  gpsDeviceId?: string | null;
}

interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string | null;
  role: string;
  isActive?: boolean;
}

const TRANSPORT_QUERIES = [['transport']];

const VEHICLE_TYPES = ['BUS', 'VAN', 'CAR', 'OTHER'];

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
  const canManage = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('transport.manage'),
  );

  const [creatingVehicle, setCreatingVehicle] = React.useState(false);
  const [editingVehicle, setEditingVehicle] = React.useState<Vehicle | null>(null);
  const [creatingDriver, setCreatingDriver] = React.useState(false);
  const [creatingRoute, setCreatingRoute] = React.useState(false);
  const [deletingRoute, setDeletingRoute] = React.useState<Route | null>(null);
  const [managingRouteId, setManagingRouteId] = React.useState<string | null>(null);

  const canAssign = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('transport.assign'),
  );

  const removeRoute = useAction({
    mutationFn: (row: Route) => api.delete(`/transport/routes/${row.id}`),
    successMessage: 'Route deleted',
    invalidates: TRANSPORT_QUERIES,
    onSuccess: () => setDeletingRoute(null),
  });

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

  const drivers = useQuery({
    queryKey: ['transport', 'drivers'],
    queryFn: () => api.get<Driver[]>('/transport/drivers'),
  });

  return (
    <>
      <PageHeader
        title="Transport"
        description="Fleet, routes and how full each bus is running."
        actions={
          canManage ? (
            <>
              <Button size="sm" icon={<UserRound />} onClick={() => setCreatingDriver(true)}>
                Add driver
              </Button>
              <Button size="sm" icon={<Bus />} onClick={() => setCreatingVehicle(true)}>
                Add vehicle
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus />}
                onClick={() => setCreatingRoute(true)}
              >
                Add route
              </Button>
            </>
          ) : null
        }
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
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
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
              action={
                canManage ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus />}
                    onClick={() => setCreatingRoute(true)}
                  >
                    Add route
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {(routes.data ?? []).map((route) => {
                const capacity = route.vehicle?.capacity ?? 0;
                const fillPercent = capacity > 0 ? (route.studentCount / capacity) * 100 : 0;

                return (
                  <Card key={route.id}>
                    <CardHeader
                      title={
                        <button
                          type="button"
                          onClick={() => setManagingRouteId(route.id)}
                          className="text-left hover:text-[var(--color-accent)]"
                        >
                          {route.name}
                        </button>
                      }
                      description={`${route.code}${
                        route.distanceKm ? ` · ${route.distanceKm} km` : ''
                      }`}
                      actions={
                        <span className="flex items-center gap-1">
                          {route.isOverCapacity ? (
                            <Badge tone="danger">Over capacity</Badge>
                          ) : !route.isActive ? (
                            <Badge>Inactive</Badge>
                          ) : null}
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setManagingRouteId(route.id)}
                          >
                            Manage
                          </Button>
                          {canManage ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              icon={<Trash2 />}
                              aria-label={`Delete ${route.name}`}
                              onClick={() => setDeletingRoute(route)}
                            />
                          ) : null}
                        </span>
                      }
                    />
                    <CardBody className="space-y-3">
                      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                        <dt className="text-[var(--color-ink-muted)]">Bus</dt>
                        <dd className="font-medium">{route.vehicle?.registrationNumber ?? '—'}</dd>
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
                            {route.seatsRemaining !== null ? ` · ${route.seatsRemaining} free` : ''}
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
            <EmptyState
              icon={<Bus />}
              title="No vehicles yet"
              description="Add the buses and vans the school runs."
              action={
                canManage ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus />}
                    onClick={() => setCreatingVehicle(true)}
                  >
                    Add vehicle
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(vehicles.data?.items ?? []).map((vehicle) => (
                <Card key={vehicle.id}>
                  <CardBody>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium tabular">{vehicle.registrationNumber}</p>
                        <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                          {vehicle.name ?? 'Vehicle'}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <StatusBadge status={vehicle.status} />
                        {canManage ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            icon={<Pencil />}
                            aria-label={`Edit ${vehicle.registrationNumber}`}
                            onClick={() => setEditingVehicle(vehicle)}
                          />
                        ) : null}
                      </span>
                    </div>

                    <dl className="grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-[var(--color-ink-muted)]">Seats</dt>
                      <dd className="font-medium tabular">{vehicle.capacity}</dd>
                      <dt className="text-[var(--color-ink-muted)]">Tracking</dt>
                      <dd className="font-medium">{vehicle.trackingEnabled ? 'Enabled' : 'Off'}</dd>
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

        <TabsContent value="drivers">
          {drivers.isLoading ? (
            <LoadingState label="Loading drivers" />
          ) : drivers.error ? (
            <ErrorState error={drivers.error} onRetry={() => drivers.refetch()} />
          ) : (drivers.data ?? []).length === 0 ? (
            <EmptyState
              icon={<UserRound />}
              title="No drivers yet"
              description="Drivers and attendants can be assigned to routes once added."
              action={
                canManage ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus />}
                    onClick={() => setCreatingDriver(true)}
                  >
                    Add driver
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(drivers.data ?? []).map((driver) => {
                // A licence that has lapsed is the one thing on this card that
                // should stop a route being run, so it is called out in red.
                const licenceExpired =
                  driver.licenseExpiry !== null &&
                  driver.licenseExpiry !== undefined &&
                  new Date(driver.licenseExpiry) < new Date();

                return (
                  <Card key={driver.id}>
                    <CardBody>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{driver.name}</p>
                          <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                            {humanise(driver.role)}
                          </p>
                        </div>
                        {licenceExpired ? <Badge tone="danger">Licence expired</Badge> : null}
                      </div>

                      <dl className="grid grid-cols-2 gap-y-1 text-xs">
                        <dt className="text-[var(--color-ink-muted)]">Phone</dt>
                        <dd className="font-medium tabular">{driver.phone}</dd>
                        <dt className="text-[var(--color-ink-muted)]">Licence</dt>
                        <dd className="truncate font-medium tabular">{driver.licenseNumber}</dd>
                      </dl>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {creatingVehicle ? <VehicleDialog onClose={() => setCreatingVehicle(false)} /> : null}
      {editingVehicle ? (
        <VehicleDialog vehicle={editingVehicle} onClose={() => setEditingVehicle(null)} />
      ) : null}
      {creatingDriver ? <DriverDialog onClose={() => setCreatingDriver(false)} /> : null}
      {creatingRoute ? (
        <RouteDialog
          vehicles={vehicles.data?.items ?? []}
          drivers={drivers.data ?? []}
          onClose={() => setCreatingRoute(false)}
        />
      ) : null}

      {managingRouteId ? (
        <RouteManagerDrawer
          routeId={managingRouteId}
          vehicles={vehicles.data?.items ?? []}
          drivers={drivers.data ?? []}
          canManage={Boolean(canManage)}
          canAssign={Boolean(canAssign)}
          currency={currency}
          onClose={() => setManagingRouteId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deletingRoute !== null}
        onOpenChange={(open) => !open && setDeletingRoute(null)}
        title="Delete this route?"
        description={
          deletingRoute
            ? `${deletingRoute.name} will be removed. This is refused while students are still assigned to it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={removeRoute.isPending}
        onConfirm={() => deletingRoute && removeRoute.mutate(deletingRoute)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

function VehicleDialog({ vehicle, onClose }: { vehicle?: Vehicle; onClose: () => void }) {
  const isEdit = Boolean(vehicle);

  const [registrationNumber, setRegistrationNumber] = React.useState(
    vehicle?.registrationNumber ?? '',
  );
  const [name, setName] = React.useState(vehicle?.name ?? '');
  const [type, setType] = React.useState(vehicle?.type ?? 'BUS');
  const [capacity, setCapacity] = React.useState(vehicle ? String(vehicle.capacity) : '');
  const [make, setMake] = React.useState(vehicle?.make ?? '');
  const [model, setModel] = React.useState(vehicle?.model ?? '');
  const [insuranceNumber, setInsuranceNumber] = React.useState(vehicle?.insuranceNumber ?? '');
  const [insuranceExpiry, setInsuranceExpiry] = React.useState(
    vehicle?.insuranceExpiry?.slice(0, 10) ?? '',
  );
  const [fitnessExpiry, setFitnessExpiry] = React.useState(
    vehicle?.fitnessExpiry?.slice(0, 10) ?? '',
  );
  const [permitExpiry, setPermitExpiry] = React.useState(vehicle?.permitExpiry?.slice(0, 10) ?? '');
  const [pollutionExpiry, setPollutionExpiry] = React.useState(
    vehicle?.pollutionExpiry?.slice(0, 10) ?? '',
  );
  const [gpsDeviceId, setGpsDeviceId] = React.useState(vehicle?.gpsDeviceId ?? '');
  const [trackingEnabled, setTrackingEnabled] = React.useState(vehicle?.trackingEnabled ?? false);

  const capacityNumber = Number(capacity);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit vehicle' : 'Add a vehicle'}
      description="Document expiry dates drive the warnings shown against each vehicle."
      submitLabel={isEdit ? 'Save changes' : 'Add vehicle'}
      values={{
        registrationNumber,
        name,
        type,
        capacity,
        make,
        model,
        insuranceNumber,
        insuranceExpiry,
        fitnessExpiry,
        permitExpiry,
        pollutionExpiry,
        gpsDeviceId,
        trackingEnabled,
      }}
      isValid={
        registrationNumber.trim().length > 0 &&
        Number.isFinite(capacityNumber) &&
        capacityNumber >= 1 &&
        capacityNumber <= 100
      }
      successMessage={isEdit ? 'Vehicle updated' : 'Vehicle added'}
      invalidates={TRANSPORT_QUERIES}
      submit={(values) => {
        const body = {
          registrationNumber: values.registrationNumber.trim().toUpperCase(),
          ...(values.name.trim() ? { name: values.name.trim() } : {}),
          type: values.type,
          capacity: Number(values.capacity),
          ...(values.make.trim() ? { make: values.make.trim() } : {}),
          ...(values.model.trim() ? { model: values.model.trim() } : {}),
          ...(values.insuranceNumber.trim()
            ? { insuranceNumber: values.insuranceNumber.trim() }
            : {}),
          ...(values.insuranceExpiry ? { insuranceExpiry: values.insuranceExpiry } : {}),
          ...(values.fitnessExpiry ? { fitnessExpiry: values.fitnessExpiry } : {}),
          ...(values.permitExpiry ? { permitExpiry: values.permitExpiry } : {}),
          ...(values.pollutionExpiry ? { pollutionExpiry: values.pollutionExpiry } : {}),
          ...(values.gpsDeviceId.trim() ? { gpsDeviceId: values.gpsDeviceId.trim() } : {}),
          trackingEnabled: values.trackingEnabled,
        };

        return isEdit
          ? api.patch(`/transport/vehicles/${vehicle!.id}`, body)
          : api.post('/transport/vehicles', body);
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="Registration number" required error={errors.registrationNumber}>
              <Input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                placeholder="KA01AB1234"
                autoFocus
              />
            </Field>
            <Field label="Name" error={errors.name} help="What people call it">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bus 1" />
            </Field>
            <Field label="Type" error={errors.type}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {VEHICLE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Seats" required error={errors.capacity}>
              <Input
                type="number"
                min={1}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </Field>
            <Field label="Make" error={errors.make}>
              <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Tata" />
            </Field>
            <Field label="Model" error={errors.model}>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field label="Insurance number" error={errors.insuranceNumber}>
              <Input value={insuranceNumber} onChange={(e) => setInsuranceNumber(e.target.value)} />
            </Field>
            <Field label="Insurance expires" error={errors.insuranceExpiry}>
              <Input
                type="date"
                value={insuranceExpiry}
                onChange={(e) => setInsuranceExpiry(e.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Fitness expires" error={errors.fitnessExpiry}>
              <Input
                type="date"
                value={fitnessExpiry}
                onChange={(e) => setFitnessExpiry(e.target.value)}
              />
            </Field>
            <Field label="Permit expires" error={errors.permitExpiry}>
              <Input
                type="date"
                value={permitExpiry}
                onChange={(e) => setPermitExpiry(e.target.value)}
              />
            </Field>
            <Field label="Pollution certificate expires" error={errors.pollutionExpiry}>
              <Input
                type="date"
                value={pollutionExpiry}
                onChange={(e) => setPollutionExpiry(e.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="GPS device id" error={errors.gpsDeviceId}>
              <Input value={gpsDeviceId} onChange={(e) => setGpsDeviceId(e.target.value)} />
            </Field>
            <Field label="Live tracking">
              <label className="flex h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={trackingEnabled}
                  onChange={(e) => setTrackingEnabled(e.target.checked)}
                />
                Broadcast this vehicle&rsquo;s position
              </label>
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

function DriverDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [alternatePhone, setAlternatePhone] = React.useState('');
  const [licenseNumber, setLicenseNumber] = React.useState('');
  const [licenseExpiry, setLicenseExpiry] = React.useState('');
  const [role, setRole] = React.useState('DRIVER');
  const [bloodGroup, setBloodGroup] = React.useState('');
  const [address, setAddress] = React.useState('');

  const phoneOk = /^\+?[0-9]{10,15}$/.test(phone.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Add a driver"
      description="Drivers and attendants can then be assigned to a route."
      submitLabel="Add driver"
      values={{
        name,
        phone,
        alternatePhone,
        licenseNumber,
        licenseExpiry,
        role,
        bloodGroup,
        address,
      }}
      isValid={name.trim().length > 0 && phoneOk && licenseNumber.trim().length > 0}
      successMessage="Driver added"
      invalidates={TRANSPORT_QUERIES}
      submit={(values) =>
        api.post('/transport/drivers', {
          name: values.name.trim(),
          phone: values.phone.trim(),
          ...(values.alternatePhone.trim() ? { alternatePhone: values.alternatePhone.trim() } : {}),
          licenseNumber: values.licenseNumber.trim(),
          ...(values.licenseExpiry ? { licenseExpiry: values.licenseExpiry } : {}),
          role: values.role,
          ...(values.bloodGroup ? { bloodGroup: values.bloodGroup } : {}),
          ...(values.address.trim() ? { address: values.address.trim() } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Phone" required error={errors.phone}>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919845100001"
              />
            </Field>
            <Field label="Alternate phone" error={errors.alternatePhone}>
              <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Licence number" required error={errors.licenseNumber}>
              <Input
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value.toUpperCase())}
                placeholder="KA0120150001234"
              />
            </Field>
            <Field label="Licence expires" error={errors.licenseExpiry}>
              <Input
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
              />
            </Field>
            <Field label="Role" error={errors.role}>
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="DRIVER">Driver</option>
                <option value="ATTENDANT">Attendant</option>
              </Select>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Blood group" error={errors.bloodGroup}>
              <Select value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                <option value="">Not stated</option>
                {BLOOD_GROUPS.map((value) => (
                  <option key={value} value={value}>
                    {value.replace('_POSITIVE', '+').replace('_NEGATIVE', '−')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Address" error={errors.address}>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface StopDraft {
  name: string;
  pickupTime: string;
  dropTime: string;
  fare: string;
}

function RouteDialog({
  vehicles,
  drivers,
  onClose,
}: {
  vehicles: Vehicle[];
  drivers: Driver[];
  onClose: () => void;
}) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [vehicleId, setVehicleId] = React.useState('');
  const [driverId, setDriverId] = React.useState('');
  const [distanceKm, setDistanceKm] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [baseFare, setBaseFare] = React.useState('');
  const [stops, setStops] = React.useState<StopDraft[]>([
    { name: '', pickupTime: '', dropTime: '', fare: '' },
  ]);

  function updateStop(index: number, patch: Partial<StopDraft>) {
    setStops((current) =>
      current.map((stop, position) => (position === index ? { ...stop, ...patch } : stop)),
    );
  }

  // The API requires an uppercase alphanumeric code; catching it here saves a
  // round trip that would only come back as a validation error.
  const codeOk = /^[A-Z0-9_-]{2,20}$/.test(code.trim());
  const namedStops = stops.filter((stop) => stop.name.trim().length > 0);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title="Add a route"
      description="Stops are ordered top to bottom; students are assigned to a stop afterwards."
      submitLabel="Add route"
      values={{
        name,
        code,
        description,
        vehicleId,
        driverId,
        distanceKm,
        startTime,
        endTime,
        baseFare,
        stops: namedStops,
      }}
      isValid={name.trim().length > 0 && codeOk}
      successMessage="Route added"
      invalidates={TRANSPORT_QUERIES}
      submit={(values) =>
        api.post('/transport/routes', {
          name: values.name.trim(),
          code: values.code.trim().toUpperCase(),
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          ...(values.vehicleId ? { vehicleId: values.vehicleId } : {}),
          ...(values.driverId ? { driverId: values.driverId } : {}),
          ...(values.distanceKm ? { distanceKm: Number(values.distanceKm) } : {}),
          ...(values.startTime ? { startTime: values.startTime } : {}),
          ...(values.endTime ? { endTime: values.endTime } : {}),
          ...(values.baseFare ? { baseFare: Number(values.baseFare) } : {}),
          ...(values.stops.length > 0
            ? {
                stops: values.stops.map((stop, index) => ({
                  name: stop.name.trim(),
                  sequence: index + 1,
                  ...(stop.pickupTime ? { pickupTime: stop.pickupTime } : {}),
                  ...(stop.dropTime ? { dropTime: stop.dropTime } : {}),
                  ...(stop.fare ? { fare: Number(stop.fare) } : {}),
                })),
              }
            : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="Route name" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Route A — Sarjapur"
                autoFocus
              />
            </Field>
            <Field
              label="Code"
              required
              error={errors.code}
              help={code && !codeOk ? 'Letters, digits, dash or underscore' : undefined}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="RT-A"
              />
            </Field>
            <Field label="Distance (km)" error={errors.distanceKm}>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field label="Vehicle" error={errors.vehicleId}>
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Unassigned</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber}
                    {vehicle.name ? ` — ${vehicle.name}` : ''} ({vehicle.capacity} seats)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Driver" error={errors.driverId}>
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Unassigned</option>
                {drivers
                  .filter((driver) => driver.role === 'DRIVER')
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Starts at" error={errors.startTime}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Ends at" error={errors.endTime}>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
            <Field label="Annual base fare" error={errors.baseFare}>
              <Input
                type="number"
                min={0}
                value={baseFare}
                onChange={(e) => setBaseFare(e.target.value)}
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

          <Field label="Stops" help="In the order the bus visits them. Blank rows are ignored.">
            <div className="space-y-2">
              {stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-2xs tabular text-[var(--color-ink-muted)]">
                    {index + 1}
                  </span>
                  <Input
                    className="flex-1"
                    value={stop.name}
                    onChange={(e) => updateStop(index, { name: e.target.value })}
                    placeholder="Stop name"
                  />
                  <Input
                    type="time"
                    className="w-28"
                    value={stop.pickupTime}
                    onChange={(e) => updateStop(index, { pickupTime: e.target.value })}
                    aria-label={`Pickup time for stop ${index + 1}`}
                  />
                  <Input
                    type="time"
                    className="w-28"
                    value={stop.dropTime}
                    onChange={(e) => updateStop(index, { dropTime: e.target.value })}
                    aria-label={`Drop time for stop ${index + 1}`}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    icon={<Trash2 />}
                    aria-label={`Remove stop ${index + 1}`}
                    onClick={() =>
                      setStops((current) => current.filter((_, position) => position !== index))
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                size="xs"
                icon={<Plus />}
                onClick={() =>
                  setStops((current) => [
                    ...current,
                    { name: '', pickupTime: '', dropTime: '', fare: '' },
                  ])
                }
              >
                Add stop
              </Button>
            </div>
          </Field>
        </>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Route manager — riders, stops, vehicle/driver
// ---------------------------------------------------------------------------

interface RouteDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  baseFare: string;
  startTime: string | null;
  endTime: string | null;
  distanceKm: string | null;
  isActive: boolean;
  vehicle: { id: string; registrationNumber: string; name: string | null; capacity: number } | null;
  driver: { id: string; name: string; phone: string } | null;
  attendant: { id: string; name: string; phone: string } | null;
  studentCount: number;
  seatsRemaining: number | null;
  isOverCapacity: boolean;
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    pickupTime: string | null;
    dropTime: string | null;
    fare: string | null;
  }>;
  assignments: Array<{
    id: string;
    direction: string;
    fareAmount: string;
    pickupStop: { id: string; name: string; pickupTime: string | null } | null;
    student: {
      id: string;
      admissionNumber: string;
      firstName: string;
      lastName: string | null;
      photoUrl: string | null;
      enrollments: Array<{ class: { name: string } | null; section: { name: string } | null }>;
      guardians: Array<{ guardian: { firstName: string; phone: string } }>;
    };
  }>;
}

function RouteManagerDrawer({
  routeId,
  vehicles,
  drivers,
  canManage,
  canAssign,
  currency,
  onClose,
}: {
  routeId: string;
  vehicles: Vehicle[];
  drivers: Driver[];
  canManage: boolean;
  canAssign: boolean;
  currency: string;
  onClose: () => void;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['transport', 'route', routeId],
    queryFn: () => api.get<RouteDetail>(`/transport/routes/${routeId}`),
  });

  const [assigning, setAssigning] = React.useState(false);
  const [editingRoute, setEditingRoute] = React.useState(false);
  const [editingStops, setEditingStops] = React.useState(false);
  const [removingStudentId, setRemovingStudentId] = React.useState<string | null>(null);

  const routeQueries = [
    ['transport', 'route', routeId],
    ['transport', 'routes'],
    ['transport', 'statistics'],
  ];

  const removeRider = useAction({
    mutationFn: (studentId: string) => api.delete(`/transport/assignments/${studentId}`),
    successMessage: 'Student removed from this route',
    invalidates: routeQueries,
    onSuccess: () => setRemovingStudentId(null),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Drawer
        width="lg"
        title={data ? data.name : 'Route'}
        description={data ? `${data.code} · ${data.studentCount} riders` : undefined}
        footer={
          canAssign && data ? (
            <Button
              size="sm"
              variant="primary"
              icon={<UserPlus />}
              onClick={() => setAssigning(true)}
            >
              Assign student
            </Button>
          ) : null
        }
      >
        {isLoading ? (
          <LoadingState label="Loading route" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data ? (
          <EmptyState title="Route not found" />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Bus</p>
                <p className="font-medium">
                  {data.vehicle
                    ? `${data.vehicle.registrationNumber} · ${data.vehicle.capacity} seats`
                    : 'Unassigned'}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Driver</p>
                <p className="font-medium">
                  {data.driver ? `${data.driver.name} · ${data.driver.phone}` : 'Unassigned'}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Runs</p>
                <p className="font-medium tabular">
                  {formatClock(data.startTime)} – {formatClock(data.endTime)}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Base fare</p>
                <p className="font-medium tabular">{formatMoney(data.baseFare, currency)}</p>
              </div>
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Seats free</p>
                <p className="font-medium tabular">
                  {data.seatsRemaining ?? '—'}
                  {data.isOverCapacity ? (
                    <Badge tone="danger" className="ml-1.5">
                      Over capacity
                    </Badge>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--color-ink-muted)]">Status</p>
                <p className="font-medium">{data.isActive ? 'Active' : 'Inactive'}</p>
              </div>
            </div>

            {canManage ? (
              <div className="flex gap-2">
                <Button size="xs" icon={<Pencil />} onClick={() => setEditingRoute(true)}>
                  Edit route
                </Button>
                <Button size="xs" icon={<MapPin />} onClick={() => setEditingStops(true)}>
                  Edit stops
                </Button>
              </div>
            ) : null}

            <section>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                Stops ({data.stops.length})
              </h3>
              {data.stops.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  No stops yet. Students can still be assigned to the route without a stop.
                </p>
              ) : (
                <ol className="space-y-1 border-l border-[var(--color-border)] pl-3">
                  {data.stops
                    .slice()
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((stop) => (
                      <li key={stop.id} className="flex items-center justify-between text-sm">
                        <span>
                          {stop.sequence}. {stop.name}
                        </span>
                        <span className="tabular text-2xs text-[var(--color-ink-muted)]">
                          {formatClock(stop.pickupTime)}
                          {stop.fare && Number(stop.fare) > 0
                            ? ` · +${formatMoney(stop.fare, currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                Riders ({data.assignments.length})
              </h3>
              {data.assignments.length === 0 ? (
                <EmptyState
                  icon={<UserRound />}
                  title="No students assigned"
                  description="Assign students to this route from here."
                  action={
                    canAssign ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<UserPlus />}
                        onClick={() => setAssigning(true)}
                      >
                        Assign student
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                  {data.assignments.map((assignment) => {
                    const enrollment = assignment.student.enrollments[0];
                    const studentName = [assignment.student.firstName, assignment.student.lastName]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <li key={assignment.id} className="flex items-center gap-2.5 px-3 py-2">
                        <span
                          className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface-sunken)] text-2xs font-semibold"
                          aria-hidden
                        >
                          {assignment.student.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={assignment.student.photoUrl}
                              alt=""
                              className="size-7 object-cover"
                            />
                          ) : (
                            initials(studentName)
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{studentName}</p>
                          <p className="truncate text-2xs text-[var(--color-ink-muted)]">
                            {assignment.student.admissionNumber}
                            {enrollment?.class
                              ? ` · ${enrollment.class.name} ${enrollment.section?.name ?? ''}`
                              : ''}
                            {assignment.pickupStop ? ` · ${assignment.pickupStop.name}` : ''}
                            {` · ${humanise(assignment.direction)}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-2xs tabular text-[var(--color-ink-muted)]">
                          {formatMoney(assignment.fareAmount, currency)}
                        </span>
                        {canAssign ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            icon={<Trash2 />}
                            aria-label={`Remove ${studentName} from this route`}
                            onClick={() => setRemovingStudentId(assignment.student.id)}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {assigning && data ? (
        <AssignStudentDialog route={data} currency={currency} onClose={() => setAssigning(false)} />
      ) : null}
      {editingRoute && data ? (
        <EditRouteDialog
          route={data}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setEditingRoute(false)}
        />
      ) : null}
      {editingStops && data ? (
        <EditStopsDialog route={data} onClose={() => setEditingStops(false)} />
      ) : null}

      <ConfirmDialog
        open={removingStudentId !== null}
        onOpenChange={(open) => !open && setRemovingStudentId(null)}
        title="Remove this student from the route?"
        description="Their transport fee stops accruing from today. They can be re-assigned later."
        confirmLabel="Remove"
        destructive
        loading={removeRider.isPending}
        onConfirm={() => removingStudentId && removeRider.mutate(removingStudentId)}
      />
    </Dialog>
  );
}

function AssignStudentDialog({
  route,
  currency,
  onClose,
}: {
  route: RouteDetail;
  currency: string;
  onClose: () => void;
}) {
  const students = useListQuery<{ id: string; fullName: string; admissionNumber: string }>(
    'transport-student-search',
    '/students',
    { initialLimit: 10 },
  );

  const [studentId, setStudentId] = React.useState('');
  const [pickupStopId, setPickupStopId] = React.useState('');
  const [dropStopId, setDropStopId] = React.useState('');
  const [direction, setDirection] = React.useState('BOTH');
  const [fareAmount, setFareAmount] = React.useState('');

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Assign a student to this route"
      description={`${route.name} — ${route.seatsRemaining ?? 'unknown'} seats free.`}
      submitLabel="Assign student"
      values={{ studentId, pickupStopId, dropStopId, direction, fareAmount }}
      isValid={studentId !== ''}
      successMessage="Student assigned to transport"
      invalidates={[
        ['transport', 'route', route.id],
        ['transport', 'routes'],
        ['transport', 'statistics'],
      ]}
      submit={(values) =>
        api.post('/transport/assignments', {
          studentId: values.studentId,
          routeId: route.id,
          ...(values.pickupStopId ? { pickupStopId: values.pickupStopId } : {}),
          ...(values.dropStopId ? { dropStopId: values.dropStopId } : {}),
          direction: values.direction,
          ...(values.fareAmount ? { fareAmount: Number(values.fareAmount) } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Student" required error={errors.studentId}>
            <div className="space-y-1.5">
              <Input
                placeholder="Search by name or admission number"
                value={students.state.search}
                onChange={(event) => students.setSearch(event.target.value)}
              />
              <Select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">Select a student</option>
                {students.items.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} — {student.admissionNumber}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <FieldRow columns={2}>
            <Field label="Pickup stop" error={errors.pickupStopId}>
              <Select value={pickupStopId} onChange={(e) => setPickupStopId(e.target.value)}>
                <option value="">No specific stop</option>
                {route.stops
                  .slice()
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Drop stop" error={errors.dropStopId}>
              <Select value={dropStopId} onChange={(e) => setDropStopId(e.target.value)}>
                <option value="">Same as pickup</option>
                {route.stops
                  .slice()
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field label="Direction" error={errors.direction}>
              <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="BOTH">Both ways</option>
                <option value="PICKUP">Pickup only</option>
                <option value="DROP">Drop only</option>
              </Select>
            </Field>
            <Field
              label="Annual fare"
              error={errors.fareAmount}
              help={`Blank uses the computed fare (base ${formatMoney(route.baseFare, currency)})`}
            >
              <Input
                type="number"
                min={0}
                value={fareAmount}
                onChange={(e) => setFareAmount(e.target.value)}
              />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}

function EditRouteDialog({
  route,
  vehicles,
  drivers,
  onClose,
}: {
  route: RouteDetail;
  vehicles: Vehicle[];
  drivers: Driver[];
  onClose: () => void;
}) {
  const [name, setName] = React.useState(route.name);
  const [description, setDescription] = React.useState(route.description ?? '');
  const [vehicleId, setVehicleId] = React.useState(route.vehicle?.id ?? '');
  const [driverId, setDriverId] = React.useState(route.driver?.id ?? '');
  const [attendantId, setAttendantId] = React.useState(route.attendant?.id ?? '');
  const [startTime, setStartTime] = React.useState(route.startTime ?? '');
  const [endTime, setEndTime] = React.useState(route.endTime ?? '');
  const [baseFare, setBaseFare] = React.useState(String(Number(route.baseFare)));
  const [distanceKm, setDistanceKm] = React.useState(
    route.distanceKm ? String(Number(route.distanceKm)) : '',
  );
  const [isActive, setIsActive] = React.useState(route.isActive);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Edit route"
      submitLabel="Save changes"
      values={{
        name,
        description,
        vehicleId,
        driverId,
        attendantId,
        startTime,
        endTime,
        baseFare,
        distanceKm,
        isActive,
      }}
      isValid={name.trim().length > 0}
      successMessage="Route updated"
      invalidates={[
        ['transport', 'route', route.id],
        ['transport', 'routes'],
        ['transport', 'statistics'],
      ]}
      submit={(values) =>
        api.patch(`/transport/routes/${route.id}`, {
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          vehicleId: values.vehicleId || null,
          driverId: values.driverId || null,
          attendantId: values.attendantId || null,
          startTime: values.startTime || undefined,
          endTime: values.endTime || undefined,
          baseFare: values.baseFare === '' ? undefined : Number(values.baseFare),
          distanceKm: values.distanceKm === '' ? undefined : Number(values.distanceKm),
          isActive: values.isActive,
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Route name" required error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <FieldRow columns={2}>
            <Field label="Vehicle" error={errors.vehicleId}>
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Unassigned</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber}
                    {vehicle.name ? ` — ${vehicle.name}` : ''} ({vehicle.capacity} seats)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Driver" error={errors.driverId}>
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Unassigned</option>
                {drivers
                  .filter((driver) => driver.role === 'DRIVER')
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Attendant" error={errors.attendantId}>
              <Select value={attendantId} onChange={(e) => setAttendantId(e.target.value)}>
                <option value="">Unassigned</option>
                {drivers
                  .filter((driver) => driver.role === 'ATTENDANT')
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Starts at" error={errors.startTime}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Ends at" error={errors.endTime}>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field label="Annual base fare" error={errors.baseFare}>
              <Input
                type="number"
                min={0}
                value={baseFare}
                onChange={(e) => setBaseFare(e.target.value)}
              />
            </Field>
            <Field label="Distance (km)" error={errors.distanceKm}>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
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

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Route is active
          </label>
        </>
      )}
    </FormModal>
  );
}

function EditStopsDialog({ route, onClose }: { route: RouteDetail; onClose: () => void }) {
  interface Row {
    id?: string;
    name: string;
    pickupTime: string;
    dropTime: string;
    fare: string;
  }

  const [rows, setRows] = React.useState<Row[]>(() =>
    route.stops.length > 0
      ? route.stops
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((stop) => ({
            id: stop.id,
            name: stop.name,
            pickupTime: stop.pickupTime ?? '',
            dropTime: stop.dropTime ?? '',
            fare: stop.fare && Number(stop.fare) > 0 ? String(Number(stop.fare)) : '',
          }))
      : [{ name: '', pickupTime: '', dropTime: '', fare: '' }],
  );

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const named = rows.filter((row) => row.name.trim().length > 0);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Edit stops"
      description="Stops run top to bottom. Removing a stop with riders assigned to it is refused."
      submitLabel="Save stops"
      values={{ named }}
      isValid={named.length > 0}
      successMessage="Stops updated"
      invalidates={[
        ['transport', 'route', route.id],
        ['transport', 'routes'],
      ]}
      submit={(values) =>
        api.patch(`/transport/routes/${route.id}/stops`, {
          stops: values.named.map((row, index) => ({
            ...(row.id ? { id: row.id } : {}),
            name: row.name.trim(),
            sequence: index + 1,
            ...(row.pickupTime ? { pickupTime: row.pickupTime } : {}),
            ...(row.dropTime ? { dropTime: row.dropTime } : {}),
            ...(row.fare ? { fare: Number(row.fare) } : {}),
          })),
        })
      }
    >
      {() => (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id ?? `new-${index}`} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-2xs tabular text-[var(--color-ink-muted)]">
                {index + 1}
              </span>
              <Input
                className="flex-1"
                value={row.name}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="Stop name"
              />
              <Input
                type="time"
                className="w-24"
                value={row.pickupTime}
                onChange={(e) => update(index, { pickupTime: e.target.value })}
                aria-label={`Pickup time for stop ${index + 1}`}
              />
              <Input
                type="number"
                className="w-20"
                min={0}
                value={row.fare}
                onChange={(e) => update(index, { fare: e.target.value })}
                placeholder="Fare"
                aria-label={`Extra fare for stop ${index + 1}`}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                icon={<Trash2 />}
                aria-label={`Remove stop ${index + 1}`}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              />
            </div>
          ))}
          <Button
            type="button"
            size="xs"
            icon={<Plus />}
            onClick={() =>
              setRows((current) => [
                ...current,
                { name: '', pickupTime: '', dropTime: '', fare: '' },
              ])
            }
          >
            Add stop
          </Button>
        </div>
      )}
    </FormModal>
  );
}
