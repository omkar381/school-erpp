'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, CalendarDays, DoorOpen, Layers, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { useClasses, useDepartments, useSubjects, useTeachers } from '@/hooks/use-lookups';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select, Textarea } from '@/components/ui/input';
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

const SUBJECT_CATEGORIES = ['CORE', 'ELECTIVE', 'LANGUAGE', 'ACTIVITY', 'CO_SCHOLASTIC'] as const;

/** Invalidated together, because every one of these feeds the lookups. */
const ACADEMIC_KEYS = [['lookup'], ['academics']];

export default function AcademicsPage() {
  const canManage = useAuthStore(
    (state) =>
      state.user?.isSuperAdmin || state.user?.permissions.includes('classes.manage'),
  );
  const canManageYears = useAuthStore(
    (state) =>
      state.user?.isSuperAdmin || state.user?.permissions.includes('academic_years.manage'),
  );

  const [dialog, setDialog] = React.useState<
    | { kind: 'class' }
    | { kind: 'section'; classId: string; className: string }
    | { kind: 'subject' }
    | { kind: 'department' }
    | { kind: 'year' }
    | null
  >(null);

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
          {canManage ? (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'class' })}>
                Add class
              </Button>
            </div>
          ) : null}

          {classesLoading ? (
            <LoadingState label="Loading classes" />
          ) : (classes ?? []).length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title="No classes configured"
              description="Add the first class to start building the academic structure."
              action={
                canManage ? (
                  <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'class' })}>
                    Add class
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(classes ?? []).map((klass) => (
                <Card key={klass.id}>
                  <CardHeader
                    title={klass.name}
                    description={`${klass.studentCount ?? 0} students`}
                    actions={
                      canManage ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Add a section to ${klass.name}`}
                          onClick={() =>
                            setDialog({ kind: 'section', classId: klass.id, className: klass.name })
                          }
                        >
                          <Plus />
                        </Button>
                      ) : null
                    }
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
          {canManage ? (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'subject' })}>
                Add subject
              </Button>
            </div>
          ) : null}

          {(subjects ?? []).length === 0 ? (
            <EmptyState
              icon={<BookMarked />}
              title="No subjects configured"
              description="Subjects drive the timetable, marks entry and report cards."
              action={
                canManage ? (
                  <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'subject' })}>
                    Add subject
                  </Button>
                ) : null
              }
            />
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
          {canManage ? (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'department' })}>
                Add department
              </Button>
            </div>
          ) : null}

          {(departments ?? []).length === 0 ? (
            <EmptyState
              title="No departments configured"
              description="Departments group staff and subjects for reporting."
              action={
                canManage ? (
                  <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'department' })}>
                    Add department
                  </Button>
                ) : null
              }
            />
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
          {canManageYears ? (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'year' })}>
                Create academic year
              </Button>
            </div>
          ) : null}

          {(years ?? []).length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title="No academic years configured"
              description="Every enrolment, exam and invoice is scoped to an academic year."
              action={
                canManageYears ? (
                  <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setDialog({ kind: 'year' })}>
                    Create academic year
                  </Button>
                ) : null
              }
            />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--color-border)]">
                  {(years ?? []).map((year) => (
                    <YearRow key={year.id} year={year} canManage={Boolean(canManageYears)} />
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {dialog?.kind === 'class' ? <ClassDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'section' ? (
        <SectionDialog
          classId={dialog.classId}
          className={dialog.className}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'subject' ? (
        <SubjectDialog departments={departments ?? []} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'department' ? <DepartmentDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'year' ? (
        <YearDialog years={years ?? []} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Academic year row
// ---------------------------------------------------------------------------

function YearRow({ year, canManage }: { year: AcademicYear; canManage: boolean }) {
  const [confirming, setConfirming] = React.useState(false);

  const setCurrent = useAction({
    mutationFn: () => api.post(`/academics/years/${year.id}/set-current`, {}),
    successMessage: `${year.name} is now the current academic year`,
    invalidates: ACADEMIC_KEYS,
    onSuccess: () => setConfirming(false),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{year.name}</p>
        <p className="text-2xs text-[var(--color-ink-muted)]">
          {formatDate(year.startDate)} – {formatDate(year.endDate)}
        </p>
      </div>
      {year.isCurrent ? <Badge tone="success">Current</Badge> : null}
      {year.isLocked ? <Badge tone="warning">Locked</Badge> : null}
      {canManage && !year.isCurrent && !year.isLocked ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Make current
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Make ${year.name} the current year?`}
        description="New enrolments, invoices and exams will default to this year. Existing records are not moved."
        confirmLabel="Make current"
        loading={setCurrent.isPending}
        onConfirm={() => setCurrent.mutate(undefined)}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Create dialogs
// ---------------------------------------------------------------------------

function ClassDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [level, setLevel] = React.useState('');
  const [stream, setStream] = React.useState('');
  const [medium, setMedium] = React.useState('');
  const [sections, setSections] = React.useState('A');

  const sectionNames = sections
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add class"
      description="A class is a year group; sections divide it into teachable rooms."
      submitLabel="Create class"
      values={{ name, level, stream, medium, sectionNames }}
      isValid={name.trim().length > 0 && level.trim().length > 0}
      successMessage="Class created"
      invalidates={ACADEMIC_KEYS}
      submit={(values) =>
        api.post('/academics/classes', {
          name: values.name.trim(),
          level: Number(values.level),
          ...(values.stream ? { stream: values.stream.trim() } : {}),
          ...(values.medium ? { medium: values.medium.trim() } : {}),
          ...(values.sectionNames.length > 0 ? { sections: values.sectionNames } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Class name" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Grade 1"
                autoFocus
              />
            </Field>
            <Field
              label="Level"
              required
              error={errors.level}
              help="Orders classes; 1 for the youngest year"
            >
              <Input
                type="number"
                min="0"
                max="20"
                inputMode="numeric"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                className="text-right tabular"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Stream" error={errors.stream} help="Science, Commerce — senior years only">
              <Input
                value={stream}
                onChange={(event) => setStream(event.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Medium" error={errors.medium}>
              <Input
                value={medium}
                onChange={(event) => setMedium(event.target.value)}
                placeholder="English"
              />
            </Field>
          </FieldRow>

          <Field
            label="Sections"
            error={errors.sections}
            help="Comma separated. Created with the class; more can be added later."
          >
            <Input
              value={sections}
              onChange={(event) => setSections(event.target.value)}
              placeholder="A, B, C"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function SectionDialog({
  classId,
  className,
  onClose,
}: {
  classId: string;
  className: string;
  onClose: () => void;
}) {
  const [name, setName] = React.useState('');
  const [capacity, setCapacity] = React.useState('40');
  const [classTeacherId, setClassTeacherId] = React.useState('');

  const { data: teachers } = useTeachers();

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={`Add a section to ${className}`}
      submitLabel="Create section"
      values={{ name, capacity, classTeacherId }}
      isValid={name.trim().length > 0}
      successMessage="Section created"
      invalidates={ACADEMIC_KEYS}
      submit={(values) =>
        api.post('/academics/sections', {
          classId,
          name: values.name.trim().toUpperCase(),
          ...(values.capacity ? { capacity: Number(values.capacity) } : {}),
          ...(values.classTeacherId ? { classTeacherId: values.classTeacherId } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Section name" required error={errors.name}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="A"
              maxLength={10}
              autoFocus
            />
          </Field>

          <Field label="Capacity" error={errors.capacity} help="Admissions are blocked once this is reached">
            <Input
              type="number"
              min="1"
              max="200"
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              className="text-right tabular"
            />
          </Field>

          <Field label="Class teacher" error={errors.classTeacherId}>
            <Select
              value={classTeacherId}
              onChange={(event) => setClassTeacherId(event.target.value)}
            >
              <option value="">Not assigned</option>
              {(teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName ?? `${teacher.firstName} ${teacher.lastName ?? ''}`.trim()}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </FormModal>
  );
}

function SubjectDialog({
  departments,
  onClose,
}: {
  departments: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [category, setCategory] = React.useState<string>('CORE');
  const [colorHex, setColorHex] = React.useState('#2563EB');
  const [hasPractical, setHasPractical] = React.useState(false);
  const [isGradedOnly, setIsGradedOnly] = React.useState(false);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add subject"
      submitLabel="Create subject"
      values={{ name, code, departmentId, category, colorHex, hasPractical, isGradedOnly }}
      isValid={name.trim().length > 0 && /^[A-Za-z0-9_-]{2,20}$/.test(code.trim())}
      successMessage="Subject created"
      invalidates={ACADEMIC_KEYS}
      submit={(values) =>
        api.post('/academics/subjects', {
          name: values.name.trim(),
          code: values.code.trim().toUpperCase(),
          ...(values.departmentId ? { departmentId: values.departmentId } : {}),
          category: values.category,
          // The category is the single source of truth for electiveness; the
          // flag is derived so the two can never disagree.
          isElective: values.category === 'ELECTIVE',
          hasPractical: values.hasPractical,
          isGradedOnly: values.isGradedOnly,
          colorHex: values.colorHex,
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Subject name" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Mathematics"
                autoFocus
              />
            </Field>
            <Field
              label="Code"
              required
              error={errors.code}
              help="2–20 characters: letters, digits, dash or underscore"
            >
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="MATH"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Department" error={errors.departmentId}>
              <Select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" error={errors.category}>
              <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                {SUBJECT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <Field label="Colour" error={errors.colorHex} help="Used on the timetable">
            <Input
              type="color"
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              className="h-8 w-16 cursor-pointer p-1"
            />
          </Field>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hasPractical}
                onChange={(event) => setHasPractical(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Has a practical component
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isGradedOnly}
                onChange={(event) => setIsGradedOnly(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Graded only — excluded from percentage and rank
            </label>
          </div>
        </>
      )}
    </FormModal>
  );
}

function DepartmentDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [headStaffId, setHeadStaffId] = React.useState('');

  const { data: teachers } = useTeachers();

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Add department"
      submitLabel="Create department"
      values={{ name, code, description, headStaffId }}
      isValid={name.trim().length > 0 && code.trim().length >= 2}
      successMessage="Department created"
      invalidates={ACADEMIC_KEYS}
      submit={(values) =>
        api.post('/academics/departments', {
          name: values.name.trim(),
          code: values.code.trim().toUpperCase(),
          ...(values.description ? { description: values.description.trim() } : {}),
          ...(values.headStaffId ? { headStaffId: values.headStaffId } : {}),
        })
      }
    >
      {(errors) => (
        <>
          <FieldRow>
            <Field label="Department name" required error={errors.name}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Science"
                autoFocus
              />
            </Field>
            <Field label="Code" required error={errors.code}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="SCI"
              />
            </Field>
          </FieldRow>

          <Field label="Head of department" error={errors.headStaffId}>
            <Select value={headStaffId} onChange={(event) => setHeadStaffId(event.target.value)}>
              <option value="">Not assigned</option>
              {(teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName ?? `${teacher.firstName} ${teacher.lastName ?? ''}`.trim()}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Description" error={errors.description}>
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function YearDialog({ years, onClose }: { years: AcademicYear[]; onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [isCurrent, setIsCurrent] = React.useState(years.length === 0);
  const [copyStructureFromId, setCopyStructureFromId] = React.useState('');

  const datesValid = Boolean(startDate && endDate && startDate < endDate);

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Create academic year"
      description="Enrolments, exams and invoices are all scoped to a year."
      submitLabel="Create year"
      values={{ name, startDate, endDate, isCurrent, copyStructureFromId }}
      isValid={name.trim().length > 0 && datesValid}
      successMessage="Academic year created"
      invalidates={ACADEMIC_KEYS}
      submit={(values) =>
        api.post('/academics/years', {
          name: values.name.trim(),
          startDate: values.startDate,
          endDate: values.endDate,
          isCurrent: values.isCurrent,
          ...(values.copyStructureFromId
            ? { copyStructureFromId: values.copyStructureFromId }
            : {}),
        })
      }
    >
      {(errors) => (
        <>
          <Field label="Year name" required error={errors.name} help="For example 2026-27">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="2026-27"
              autoFocus
            />
          </Field>

          <FieldRow>
            <Field label="Starts" required error={errors.startDate}>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field
              label="Ends"
              required
              error={
                errors.endDate ??
                (startDate && endDate && startDate >= endDate
                  ? 'The year must end after it starts'
                  : undefined)
              }
            >
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </FieldRow>

          {years.length > 0 ? (
            <Field
              label="Copy structure from"
              error={errors.copyStructureFromId}
              help="Recreates classes, sections and subjects in the new year"
            >
              <Select
                value={copyStructureFromId}
                onChange={(event) => setCopyStructureFromId(event.target.value)}
              >
                <option value="">Start empty</option>
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isCurrent}
              onChange={(event) => setIsCurrent(event.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Make this the current academic year
          </label>
        </>
      )}
    </FormModal>
  );
}
