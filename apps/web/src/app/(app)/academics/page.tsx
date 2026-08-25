'use client';

import { useQuery } from '@tanstack/react-query';
import { BookMarked, CalendarDays, DoorOpen, Layers } from 'lucide-react';
import { humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { useClasses, useDepartments, useSubjects } from '@/hooks/use-lookups';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isLocked?: boolean;
}

export default function AcademicsPage() {
  const { data: classes, isLoading: classesLoading } = useClasses();
  const { data: subjects } = useSubjects();
  const { data: departments } = useDepartments();

  const { data: years } = useQuery({
    queryKey: ['academics', 'years'],
    queryFn: () => api.get<AcademicYear[]>('/academics/years'),
    staleTime: 10 * 60_000,
  });

  const totalSections = (classes ?? []).reduce(
    (sum, klass) => sum + (klass.sections?.length ?? 0),
    0,
  );
  const totalStudents = (classes ?? []).reduce((sum, klass) => sum + (klass.studentCount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Classes & subjects"
        description="The academic structure this school is organised around."
      />

      <StatGrid columns={4} className="mb-4">
        <StatCard label="Classes" value={classes?.length ?? 0} icon={<Layers />} />
        <StatCard label="Sections" value={totalSections} icon={<DoorOpen />} />
        <StatCard label="Subjects" value={subjects?.length ?? 0} icon={<BookMarked />} />
        <StatCard label="Students enrolled" value={totalStudents} />
      </StatGrid>

      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="subjects">Subjects</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="years">Academic years</TabsTrigger>
        </TabsList>

        <TabsContent value="classes">
          {classesLoading ? (
            <LoadingState label="Loading classes" />
          ) : (classes ?? []).length === 0 ? (
            <EmptyState icon={<Layers />} title="No classes configured" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(classes ?? []).map((klass) => (
                <Card key={klass.id}>
                  <CardHeader
                    title={klass.name}
                    description={`${klass.studentCount ?? 0} students`}
                  />
                  <CardBody className="p-0">
                    {(klass.sections ?? []).length === 0 ? (
                      <p className="px-4 py-4 text-xs text-[var(--color-ink-muted)]">
                        No sections yet
                      </p>
                    ) : (
                      <ul className="divide-y divide-[var(--color-border)]">
                        {(klass.sections ?? []).map((section) => (
                          <li
                            key={section.id}
                            className="flex items-center justify-between px-4 py-2 text-sm"
                          >
                            <span>Section {section.name}</span>
                            <span className="text-2xs tabular text-[var(--color-ink-muted)]">
                              {section.studentCount ?? 0} / {section.capacity}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="subjects">
          {(subjects ?? []).length === 0 ? (
            <EmptyState icon={<BookMarked />} title="No subjects configured" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(subjects ?? []).map((subject) => (
                <Card key={subject.id}>
                  <CardBody className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: subject.colorHex ?? 'var(--color-ink-faint)' }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{subject.name}</span>
                      <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                        {subject.code}
                      </span>
                    </span>
                    {subject.isElective ? <Badge tone="info">Elective</Badge> : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="departments">
          {(departments ?? []).length === 0 ? (
            <EmptyState title="No departments configured" />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {(departments ?? []).map((department) => (
                    <li
                      key={department.id}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <span className="text-sm font-medium">{department.name}</span>
                      <Badge>{department.code}</Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="years">
          {(years ?? []).length === 0 ? (
            <EmptyState icon={<CalendarDays />} title="No academic years configured" />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {(years ?? []).map((year) => (
                    <li key={year.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{year.name}</p>
                        <p className="text-2xs text-[var(--color-ink-muted)]">
                          {formatDate(year.startDate)} – {formatDate(year.endDate)}
                        </p>
                      </div>
                      {year.isCurrent ? <Badge tone="success">Current</Badge> : null}
                      {year.isLocked ? <Badge tone="warning">Locked</Badge> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <p className="mt-4 text-2xs text-[var(--color-ink-faint)]">
        {humanise('read_only')} view — structural changes are made in Settings.
      </p>
    </>
  );
}
