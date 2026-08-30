'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, GraduationCap } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useAcademicYears, useClasses, useSections } from '@/hooks/use-lookups';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { EmptyState, LoadingState } from '@/components/ui/states';

interface StudentRow {
  id: string;
  admissionNumber: string;
  fullName: string;
  enrollment: {
    rollNumber: string | null;
    section: { id: string; name: string } | null;
  } | null;
}

/**
 * End-of-year promotion.
 *
 * The whole section moves together, so the screen is built around the two
 * sections rather than around individual students: pick where they come from
 * and where they go, then mark the exceptions. Detained students stay in the
 * current class in the new year rather than being left behind in the old one.
 */
export default function PromoteStudentsPage() {
  const [fromSectionId, setFromSectionId] = React.useState('');
  const [fromClassId, setFromClassId] = React.useState('');
  const [toClassId, setToClassId] = React.useState('');
  const [toSectionId, setToSectionId] = React.useState('');
  const [toAcademicYearId, setToAcademicYearId] = React.useState('');
  const [detained, setDetained] = React.useState<string[]>([]);
  const [regenerateRollNumbers, setRegenerateRollNumbers] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);

  const { data: classes } = useClasses();
  const { data: years } = useAcademicYears();
  const { data: fromSections } = useSections(fromClassId || undefined);
  const { data: toSections } = useSections(toClassId || undefined);

  const roster = useQuery({
    queryKey: ['students', 'roster', fromSectionId],
    queryFn: () =>
      api.get<{ items: StudentRow[] }>('/students', {
        sectionId: fromSectionId,
        status: 'ACTIVE',
        limit: 200,
      }),
    enabled: fromSectionId !== '',
  });

  const students = roster.data?.items ?? [];
  const promotingCount = students.length - detained.length;

  const ready =
    fromSectionId !== '' &&
    toSectionId !== '' &&
    toAcademicYearId !== '' &&
    fromSectionId !== toSectionId &&
    students.length > 0;

  const promote = useAction({
    mutationFn: () =>
      api.post('/students/promote', {
        fromSectionId,
        toSectionId,
        toAcademicYearId,
        ...(detained.length > 0 ? { detainedStudentIds: detained } : {}),
        regenerateRollNumbers,
      }),
    successMessage: 'Students promoted',
    invalidates: [['students'], ['lookup']],
    onSuccess: () => {
      setConfirming(false);
      setDetained([]);
      setFromSectionId('');
    },
  });

  return (
    <>
      <PageHeader
        title="Promote students"
        description="Move a section into the next academic year."
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href="/students">Back to students</Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader
          title="Where they move"
          description="Detained students stay in the current class, in the new year."
        />
        <CardBody className="space-y-3">
          <FieldRow columns={3}>
            <Field label="Promote into year" required>
              <Select
                value={toAcademicYearId}
                onChange={(event) => setToAcademicYearId(event.target.value)}
              >
                <option value="">Select a year</option>
                {(years ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                    {year.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From class" required>
              <Select
                value={fromClassId}
                onChange={(event) => {
                  setFromClassId(event.target.value);
                  setFromSectionId('');
                  setDetained([]);
                }}
              >
                <option value="">Select a class</option>
                {(classes ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From section" required>
              <Select
                value={fromSectionId}
                onChange={(event) => {
                  setFromSectionId(event.target.value);
                  setDetained([]);
                }}
                disabled={!fromClassId}
              >
                <option value="">{fromClassId ? 'Select a section' : 'Choose a class first'}</option>
                {(fromSections ?? []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name} — {section.studentCount} students
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <div className="hidden sm:block" />
            <Field label="To class" required>
              <Select
                value={toClassId}
                onChange={(event) => {
                  setToClassId(event.target.value);
                  setToSectionId('');
                }}
              >
                <option value="">Select a class</option>
                {(classes ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="To section"
              required
              error={
                toSectionId !== '' && toSectionId === fromSectionId
                  ? 'Choose a section other than the one they are leaving'
                  : undefined
              }
            >
              <Select
                value={toSectionId}
                onChange={(event) => setToSectionId(event.target.value)}
                disabled={!toClassId}
              >
                <option value="">{toClassId ? 'Select a section' : 'Choose a class first'}</option>
                {(toSections ?? []).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name} — {section.availableSeats} free
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={regenerateRollNumbers}
              onChange={(event) => setRegenerateRollNumbers(event.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Renumber roll numbers alphabetically in the new section
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who moves"
          description={
            fromSectionId
              ? `${promotingCount} promoting, ${detained.length} detained`
              : 'Pick a section to see its roster.'
          }
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<ArrowRight />}
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              Promote {promotingCount > 0 ? promotingCount : ''} student
              {promotingCount === 1 ? '' : 's'}
            </Button>
          }
        />
        <CardBody className="p-0">
          {!fromSectionId ? (
            <EmptyState
              icon={<GraduationCap />}
              title="No section selected"
              description="Choose the class and section the students are leaving."
            />
          ) : roster.isLoading ? (
            <LoadingState label="Loading roster" />
          ) : students.length === 0 ? (
            <EmptyState
              icon={<GraduationCap />}
              title="No active students in this section"
              description="There is nobody here to promote."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {students.map((student) => {
                const isDetained = detained.includes(student.id);
                return (
                  <li key={student.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{student.fullName}</span>
                      <span className="block truncate text-2xs text-[var(--color-ink-muted)]">
                        {student.admissionNumber}
                        {student.enrollment?.rollNumber
                          ? ` · Roll ${student.enrollment.rollNumber}`
                          : ''}
                      </span>
                    </span>
                    {isDetained ? <Badge tone="warning">Detained</Badge> : null}
                    <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-[var(--color-ink-secondary)]">
                      <input
                        type="checkbox"
                        checked={isDetained}
                        onChange={(event) =>
                          setDetained((current) =>
                            event.target.checked
                              ? [...current, student.id]
                              : current.filter((id) => id !== student.id),
                          )
                        }
                        className="size-3.5 accent-[var(--color-warning)]"
                      />
                      Detain
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Promote ${promotingCount} student${promotingCount === 1 ? '' : 's'}?`}
        description={
          <>
            Their current enrolment is closed and a new one is created in the selected year.
            {detained.length > 0
              ? ` ${detained.length} detained student${detained.length === 1 ? '' : 's'} will repeat the current class.`
              : ''}{' '}
            This cannot be undone from the interface.
          </>
        }
        confirmLabel="Promote"
        loading={promote.isPending}
        onConfirm={() => promote.mutate(undefined)}
      />
    </>
  );
}
