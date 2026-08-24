'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeIndianRupee,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  Megaphone,
  PlaneTakeoff,
  Users,
} from 'lucide-react';
import type {
  AdminDashboard,
  Dashboard,
  ParentDashboard,
  PlatformDashboard,
  TeacherDashboard,
} from '@erp/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatMoney, formatNumber, formatPercent } from '@/lib/utils';
import { formatClock, formatDate } from '@/lib/dates';
import { ColumnChart, LineSeriesChart, TrendChart } from '@/components/charts';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid, formatMetric } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const currency = useAuthStore((state) => state.school?.currency) ?? 'INR';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/dashboard'),
    staleTime: 60_000,
  });

  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  if (isLoading) return <LoadingState label="Building your dashboard" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="No dashboard available" />;

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.firstName ?? 'there'}`}
        description={
          'academicYear' in data && data.academicYear
            ? `Academic year ${data.academicYear}`
            : 'Platform overview'
        }
      />

      {data.audience === 'ADMIN' ? <AdminView data={data} currency={currency} /> : null}
      {data.audience === 'TEACHER' ? <TeacherView data={data} /> : null}
      {data.audience === 'PARENT' ? <ParentView data={data} currency={currency} /> : null}
      {data.audience === 'PLATFORM' ? <PlatformView data={data} /> : null}
      {data.audience === 'STUDENT' ? (
        <ParentView
          data={{
            audience: 'PARENT',
            academicYear: data.academicYear,
            children: [data.child],
            notices: data.notices,
          }}
          currency={currency}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function AdminView({ data, currency }: { data: AdminDashboard; currency: string }) {
  const icons = [GraduationCap, Users, ClipboardCheck, BadgeIndianRupee, BadgeIndianRupee, BadgeIndianRupee];

  return (
    <div className="space-y-4">
      <StatGrid columns={6}>
        {data.metrics.map((metric, index) => {
          const Icon = icons[index] ?? GraduationCap;
          return (
            <StatCard
              key={metric.label}
              label={metric.label}
              value={formatMetric(metric, currency)}
              icon={<Icon />}
              // A rising outstanding balance is bad news, not good.
              invertTrend={metric.label.toLowerCase().includes('outstanding')}
              changePercent={metric.changePercent}
            />
          );
        })}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Fee collection"
            description="Received per month over the last year"
            actions={
              <Button size="xs" variant="ghost" asChild>
                <Link href="/fees">
                  Open fees <ArrowRight />
                </Link>
              </Button>
            }
          />
          <CardBody>
            <TrendChart data={data.charts.collectionTrend} name="Collected" format="currency" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Today's attendance" />
          <CardBody>
            {data.attendanceToday.notMarked ? (
              <EmptyState
                className="py-8"
                icon={<ClipboardCheck />}
                title="Register not taken yet"
                description="No attendance has been marked for today."
                action={
                  <Button size="sm" variant="primary" asChild>
                    <Link href="/attendance">Mark attendance</Link>
                  </Button>
                }
              />
            ) : (
              <>
                <p className="text-3xl font-semibold tabular">
                  {formatPercent(
                    (data.attendanceToday.present / Math.max(1, data.attendanceToday.marked)) * 100,
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                  {formatNumber(data.attendanceToday.present)} of{' '}
                  {formatNumber(data.attendanceToday.marked)} marked present
                </p>

                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
                  {[
                    ['Present', data.attendanceToday.present, 'success'],
                    ['Absent', data.attendanceToday.absent, 'danger'],
                    ['Late', data.attendanceToday.late, 'warning'],
                  ].map(([label, value, tone]) => (
                    <div key={label as string}>
                      <dt className="text-2xs text-[var(--color-ink-muted)]">{label}</dt>
                      <dd
                        className="mt-0.5 text-lg font-semibold tabular"
                        style={{ color: `var(--color-${tone})` }}
                      >
                        {formatNumber(value as number)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance trend" description="Last 30 days" />
          <CardBody>
            <LineSeriesChart
              data={data.charts.attendanceTrend}
              name="Attendance"
              format="percent"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Class strength" description="Active enrolment per class" />
          <CardBody>
            <ColumnChart data={data.charts.classStrength} name="Students" />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Needs attention" />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {[
                {
                  label: 'Leave requests pending',
                  value: data.actionQueue.pendingLeave,
                  href: '/leave',
                  icon: PlaneTakeoff,
                },
                {
                  label: 'Support tickets open',
                  value: data.actionQueue.openTickets,
                  href: '/support',
                  icon: Inbox,
                },
                {
                  label: 'Invoices outstanding',
                  value: data.finance.outstandingInvoices,
                  href: '/fees',
                  icon: BadgeIndianRupee,
                },
                {
                  label: 'Notices this week',
                  value: data.actionQueue.noticesThisWeek,
                  href: '/notices',
                  icon: Megaphone,
                },
              ].map((row) => (
                <li key={row.label}>
                  <Link
                    href={row.href}
                    className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-sunken)]"
                  >
                    <row.icon className="size-4 text-[var(--color-ink-faint)]" aria-hidden />
                    <span className="flex-1 text-sm text-[var(--color-ink-secondary)]">
                      {row.label}
                    </span>
                    <span
                      className={`text-sm font-semibold tabular ${
                        row.value > 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'
                      }`}
                    >
                      {formatNumber(row.value)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Upcoming examinations"
            actions={
              <Button size="xs" variant="ghost" asChild>
                <Link href="/exams">
                  All exams <ArrowRight />
                </Link>
              </Button>
            }
          />
          <CardBody className="p-0">
            {data.upcomingExams.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={<BookOpen />}
                title="No exams scheduled"
                description="Upcoming examinations will appear here once they are created."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.upcomingExams.map((exam) => (
                  <li
                    key={exam.id}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-sunken)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{exam.name}</p>
                      <p className="text-2xs text-[var(--color-ink-muted)]">
                        {formatDate(exam.startDate)} — {formatDate(exam.endDate)}
                      </p>
                    </div>
                    <Badge tone="info">{exam.type.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeacherView({ data }: { data: TeacherDashboard }) {
  return (
    <div className="space-y-4">
      <StatGrid columns={4}>
        {data.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={formatMetric(metric)} />
        ))}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's schedule"
            description={`${data.todaySchedule.length} period${
              data.todaySchedule.length === 1 ? '' : 's'
            }`}
          />
          <CardBody className="p-0">
            {data.todaySchedule.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={<CalendarClock />}
                title="No classes today"
                description="Enjoy the quiet one."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {data.todaySchedule.map((period) => (
                  <li key={period.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-16 shrink-0 text-xs tabular text-[var(--color-ink-muted)]">
                      {formatClock(period.startTime)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {period.className} {period.sectionName}
                        <span className="ml-1.5 font-normal text-[var(--color-ink-muted)]">
                          {period.subject}
                        </span>
                      </p>
                      <p className="text-2xs text-[var(--color-ink-faint)]">
                        {period.period}
                        {period.room ? ` · ${period.room}` : ''}
                      </p>
                    </div>
                    {period.attendanceMarked ? (
                      <Badge tone="success">Marked</Badge>
                    ) : (
                      <Button size="xs" variant="primary" asChild>
                        <Link href={`/attendance?sectionId=${period.sectionId ?? ''}`}>
                          Mark attendance
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Your queue" />
            <CardBody className="p-0">
              <ul className="divide-y divide-[var(--color-border)]">
                {[
                  ['Registers not taken', data.actionQueue.attendanceOutstanding, '/attendance'],
                  ['Submissions to review', data.actionQueue.submissionsToReview, '/homework'],
                  ['Marks pending', data.actionQueue.marksPending, '/exams'],
                  ['Unread messages', data.actionQueue.unreadMessages, '/messages'],
                ].map(([label, value, href]) => (
                  <li key={label as string}>
                    <Link
                      href={href as string}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-sunken)]"
                    >
                      <span className="text-sm text-[var(--color-ink-secondary)]">{label}</span>
                      <span
                        className={`text-sm font-semibold tabular ${
                          (value as number) > 0
                            ? 'text-[var(--color-danger)]'
                            : 'text-[var(--color-ink-faint)]'
                        }`}
                      >
                        {formatNumber(value as number)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your classes" description={`${data.classes.length} sections`} />
            <CardBody className="max-h-64 overflow-y-auto p-0">
              <ul className="divide-y divide-[var(--color-border)]">
                {data.classes.map((klass) => (
                  <li
                    key={klass.sectionId}
                    className="flex items-center justify-between px-4 py-2"
                  >
                    <span className="text-sm">
                      {klass.className} {klass.sectionName}
                    </span>
                    <span className="text-xs tabular text-[var(--color-ink-muted)]">
                      {klass.students} students
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ParentView({ data, currency }: { data: ParentDashboard; currency: string }) {
  const [activeChild, setActiveChild] = React.useState(0);
  const child = data.children[activeChild];

  if (!child) {
    return (
      <EmptyState
        title="No children linked to your account"
        description="Contact the school office if this looks wrong."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.children.length > 1 ? (
        <div
          role="tablist"
          aria-label="Select child"
          className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
        >
          {data.children.map((entry, index) => (
            <button
              key={entry.studentId}
              role="tab"
              aria-selected={index === activeChild}
              onClick={() => setActiveChild(index)}
              className={`flex-1 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors ${
                index === activeChild
                  ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                  : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-sunken)]'
              }`}
            >
              {entry.name}
              <span className="ml-1.5 text-2xs text-[var(--color-ink-muted)]">
                {entry.className}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <StatGrid columns={4}>
        <StatCard
          label="Attendance today"
          value={
            child.attendance.today ? (
              <StatusBadge status={child.attendance.today} className="text-sm" />
            ) : (
              <span className="text-base text-[var(--color-ink-muted)]">Not marked yet</span>
            )
          }
          hint={`${child.className} ${child.sectionName}`}
        />
        <StatCard
          label="Attendance this month"
          value={formatPercent(child.attendance.monthPercent)}
          hint={`${child.attendance.monthMarkedDays} days marked`}
        />
        <StatCard
          label="Fees due"
          value={formatMoney(child.fees.outstanding, currency)}
          hint={
            child.fees.unpaidInvoices > 0
              ? `${child.fees.unpaidInvoices} unpaid invoice(s)`
              : 'Nothing outstanding'
          }
        />
        <StatCard
          label="Homework pending"
          value={formatNumber(child.homework.filter((item) => !item.submitted).length)}
          hint={`${child.homework.length} upcoming`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming homework" />
          <CardBody className="p-0">
            {child.homework.length === 0 ? (
              <EmptyState className="py-10" title="Nothing due" description="No homework outstanding." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {child.homework.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-2xs text-[var(--color-ink-muted)]">
                        {item.subject} · due {formatDate(item.dueDate)}
                      </p>
                    </div>
                    <StatusBadge status={item.submitted ? 'SUBMITTED' : 'PENDING'} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Next exam" />
            <CardBody>
              {child.nextExam ? (
                <>
                  <p className="text-sm font-medium">{child.nextExam.subject}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                    {child.nextExam.name} · {formatDate(child.nextExam.date)} at{' '}
                    {formatClock(child.nextExam.startTime)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--color-ink-muted)]">Nothing scheduled.</p>
              )}
            </CardBody>
          </Card>

          {child.transport ? (
            <Card>
              <CardHeader title="Transport" />
              <CardBody>
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-[var(--color-ink-muted)]">Route</dt>
                  <dd className="font-medium">{child.transport.route}</dd>
                  <dt className="text-[var(--color-ink-muted)]">Bus</dt>
                  <dd className="font-medium">{child.transport.bus ?? '—'}</dd>
                  <dt className="text-[var(--color-ink-muted)]">Stop</dt>
                  <dd className="font-medium">{child.transport.stop ?? '—'}</dd>
                  <dt className="text-[var(--color-ink-muted)]">Pickup</dt>
                  <dd className="font-medium">{formatClock(child.transport.pickupTime)}</dd>
                </dl>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader
          title="From the school"
          actions={
            <Button size="xs" variant="ghost" asChild>
              <Link href="/notices">
                All notices <ArrowRight />
              </Link>
            </Button>
          }
        />
        <CardBody className="p-0">
          {data.notices.length === 0 ? (
            <EmptyState className="py-10" icon={<Megaphone />} title="No recent notices" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.notices.map((notice) => (
                <li key={notice.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{notice.title}</p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {formatDate(notice.publishAt)}
                    </p>
                  </div>
                  {notice.priority !== 'NORMAL' ? (
                    <StatusBadge status={notice.priority} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlatformView({ data }: { data: PlatformDashboard }) {
  return (
    <div className="space-y-4">
      <StatGrid columns={4}>
        {data.metrics.map((metric) => (
          <StatCard key={metric.label} label={metric.label} value={formatMetric(metric)} />
        ))}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subscriptions" />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {data.subscriptions.map((row) => (
                <li
                  key={`${row.tier}-${row.status}`}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span className="text-sm">{row.plan}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={row.status} />
                    <span className="text-sm font-semibold tabular">{row.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recently onboarded" />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {data.recentSchools.map((school) => (
                <li key={school.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{school.name}</p>
                    <p className="text-2xs text-[var(--color-ink-muted)]">
                      {school.code} · {formatDate(school.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={school.status} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
