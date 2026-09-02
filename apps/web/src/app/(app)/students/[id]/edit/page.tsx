'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { BLOOD_GROUPS, GENDERS, humanise } from '@erp/shared-types';
import { ApiClientError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAction } from '@/hooks/use-action';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

interface StudentForm {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  rollNumber: string;
  admissionDate: string;
  nationality: string;
  religion: string;
  category: string;
  motherTongue: string;
  aadhaarNumber: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyRelation: string;
  medicalConditions: string;
  allergies: string;
  medications: string;
  specialNeeds: string;
  previousSchool: string;
  previousClass: string;
  transferCertificateNo: string;
}

const FIELD_KEYS = [
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'gender',
  'bloodGroup',
  'rollNumber',
  'admissionDate',
  'nationality',
  'religion',
  'category',
  'motherTongue',
  'aadhaarNumber',
  'phone',
  'email',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'country',
  'postalCode',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyRelation',
  'medicalConditions',
  'allergies',
  'medications',
  'specialNeeds',
  'previousSchool',
  'previousClass',
  'transferCertificateNo',
] as const satisfies ReadonlyArray<keyof StudentForm>;

const DATE_KEYS = new Set<keyof StudentForm>(['dateOfBirth', 'admissionDate']);

function emptyForm(): StudentForm {
  return Object.fromEntries(
    FIELD_KEYS.map((key) => [key, key === 'bloodGroup' ? 'UNKNOWN' : '']),
  ) as unknown as StudentForm;
}

type StudentRecord = Partial<Record<keyof StudentForm, string | null>> & {
  id: string;
  fullName: string;
  admissionNumber: string;
};

function bloodGroupLabel(value: string): string {
  if (value === 'UNKNOWN') return 'Not known';
  return value.replace(/_POSITIVE$/, ' +').replace(/_NEGATIVE$/, ' −');
}

/**
 * Editing a student's profile.
 *
 * Class, section and guardians are deliberately not here — moving a student is
 * a transfer (with its own audit trail) and guardians are managed from the
 * detail page. This page is the standing personal record only.
 */
export default function EditStudentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const canEdit = useAuthStore(
    (state) => state.user?.isSuperAdmin || state.user?.permissions.includes('students.update'),
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentRecord>(`/students/${id}`),
    enabled: Boolean(id),
  });

  const [form, setForm] = React.useState<StudentForm>(emptyForm);
  const [original, setOriginal] = React.useState<StudentForm>(emptyForm);
  const [seededId, setSeededId] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Seed the form from the record once it arrives (and again if the route id
  // changes), without an effect.
  if (data && seededId !== data.id) {
    setSeededId(data.id);
    const seeded = emptyForm();
    for (const key of FIELD_KEYS) {
      const value = data[key];
      if (typeof value === 'string' && value.length > 0) {
        seeded[key] = DATE_KEYS.has(key) ? value.slice(0, 10) : value;
      }
    }
    setForm(seeded);
    setOriginal(seeded);
  }

  const set = (key: keyof StudentForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const phoneOk = form.phone.trim() === '' || /^\+?[0-9]{10,15}$/.test(form.phone.trim());
  const emergencyPhoneOk =
    form.emergencyContactPhone.trim() === '' ||
    /^\+?[0-9]{10,15}$/.test(form.emergencyContactPhone.trim());
  const aadhaarOk =
    form.aadhaarNumber.trim() === '' || /^[0-9]{12}$/.test(form.aadhaarNumber.trim());

  const changed = FIELD_KEYS.some((key) => form[key].trim() !== original[key].trim());

  const isValid =
    form.firstName.trim().length > 0 &&
    form.dateOfBirth !== '' &&
    form.gender !== '' &&
    form.admissionDate !== '' &&
    phoneOk &&
    emergencyPhoneOk &&
    aadhaarOk &&
    changed;

  const save = useAction({
    mutationFn: () => {
      // Only what actually changed is sent, so the audit trail stays honest.
      // A cleared field goes as null — the API's format checks reject an empty
      // string but skip a null, and Prisma stores it as "no value".
      const payload: Record<string, string | null> = {};
      for (const key of FIELD_KEYS) {
        const next = form[key].trim();
        if (next === original[key].trim()) continue;
        payload[key] = next === '' ? null : next;
      }
      return api.patch(`/students/${id}`, payload);
    },
    successMessage: 'Student updated',
    invalidates: [['student', id], ['students']],
    onSuccess: () => router.replace(`/students/${id}`),
    onError: (caught: ApiClientError) => {
      setFieldErrors(caught.isValidation ? caught.byField : {});
    },
  });

  if (isLoading) return <LoadingState label="Loading student" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState title="Student not found" />;
  if (!canEdit) {
    return (
      <EmptyState
        title="You do not have access to edit students"
        description="Ask an administrator for the students.update permission."
        action={
          <Button size="sm" asChild>
            <Link href={`/students/${id}`}>Back to the student</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit ${data.fullName}`}
        description={data.admissionNumber}
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href={`/students/${id}`}>Back to the student</Link>
          </Button>
        }
      />

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldErrors({});
          if (isValid) save.mutate(undefined);
        }}
      >
        <Card>
          <CardHeader
            title="Student"
            description="As it should appear on records and certificates."
          />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field label="First name" required error={fieldErrors.firstName}>
                <Input
                  value={form.firstName}
                  onChange={(e) => set('firstName')(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Middle name" error={fieldErrors.middleName}>
                <Input
                  value={form.middleName}
                  onChange={(e) => set('middleName')(e.target.value)}
                />
              </Field>
              <Field label="Last name" error={fieldErrors.lastName}>
                <Input value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} />
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="Date of birth" required error={fieldErrors.dateOfBirth}>
                <Input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth}
                  onChange={(e) => set('dateOfBirth')(e.target.value)}
                />
              </Field>
              <Field label="Gender" required error={fieldErrors.gender}>
                <Select value={form.gender} onChange={(e) => set('gender')(e.target.value)}>
                  <option value="">Select</option>
                  {GENDERS.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Blood group" error={fieldErrors.bloodGroup}>
                <Select value={form.bloodGroup} onChange={(e) => set('bloodGroup')(e.target.value)}>
                  {BLOOD_GROUPS.map((value) => (
                    <option key={value} value={value}>
                      {bloodGroupLabel(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="Roll number" error={fieldErrors.rollNumber}>
                <Input
                  value={form.rollNumber}
                  onChange={(e) => set('rollNumber')(e.target.value)}
                />
              </Field>
              <Field
                label="Admission date"
                required
                error={fieldErrors.admissionDate}
                help="Moving classes is a transfer, not an edit"
              >
                <Input
                  type="date"
                  value={form.admissionDate}
                  onChange={(e) => set('admissionDate')(e.target.value)}
                />
              </Field>
              <Field
                label="Aadhaar number"
                error={fieldErrors.aadhaarNumber ?? (aadhaarOk ? undefined : 'Must be 12 digits')}
              >
                <Input
                  value={form.aadhaarNumber}
                  onChange={(e) => set('aadhaarNumber')(e.target.value)}
                  inputMode="numeric"
                  maxLength={12}
                />
              </Field>
            </FieldRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Background"
            description="Used on transfer certificates and government returns."
          />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field label="Nationality" error={fieldErrors.nationality}>
                <Input
                  value={form.nationality}
                  onChange={(e) => set('nationality')(e.target.value)}
                />
              </Field>
              <Field label="Religion" error={fieldErrors.religion}>
                <Input value={form.religion} onChange={(e) => set('religion')(e.target.value)} />
              </Field>
              <Field label="Category" error={fieldErrors.category} help="GENERAL, OBC, SC, ST…">
                <Input value={form.category} onChange={(e) => set('category')(e.target.value)} />
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="Mother tongue" error={fieldErrors.motherTongue}>
                <Input
                  value={form.motherTongue}
                  onChange={(e) => set('motherTongue')(e.target.value)}
                />
              </Field>
              <Field label="Previous school" error={fieldErrors.previousSchool}>
                <Input
                  value={form.previousSchool}
                  onChange={(e) => set('previousSchool')(e.target.value)}
                />
              </Field>
              <Field label="Previous class" error={fieldErrors.previousClass}>
                <Input
                  value={form.previousClass}
                  onChange={(e) => set('previousClass')(e.target.value)}
                />
              </Field>
            </FieldRow>

            <Field label="Transfer certificate no." error={fieldErrors.transferCertificateNo}>
              <Input
                value={form.transferCertificateNo}
                onChange={(e) => set('transferCertificateNo')(e.target.value)}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact and address" />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field
                label="Student phone"
                error={fieldErrors.phone ?? (phoneOk ? undefined : 'Enter a valid phone number')}
              >
                <Input
                  value={form.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                  inputMode="tel"
                />
              </Field>
              <Field label="Student email" error={fieldErrors.email}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email')(e.target.value)}
                />
              </Field>
              <Field label="Postal code" error={fieldErrors.postalCode}>
                <Input
                  value={form.postalCode}
                  onChange={(e) => set('postalCode')(e.target.value)}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Address line 1" error={fieldErrors.addressLine1}>
                <Input
                  value={form.addressLine1}
                  onChange={(e) => set('addressLine1')(e.target.value)}
                />
              </Field>
              <Field label="Address line 2" error={fieldErrors.addressLine2}>
                <Input
                  value={form.addressLine2}
                  onChange={(e) => set('addressLine2')(e.target.value)}
                />
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="City" error={fieldErrors.city}>
                <Input value={form.city} onChange={(e) => set('city')(e.target.value)} />
              </Field>
              <Field label="State" error={fieldErrors.state}>
                <Input value={form.state} onChange={(e) => set('state')(e.target.value)} />
              </Field>
              <Field label="Country" error={fieldErrors.country}>
                <Input value={form.country} onChange={(e) => set('country')(e.target.value)} />
              </Field>
            </FieldRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Emergency and medical"
            description="Shown to staff on the student's record."
          />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field label="Emergency contact" error={fieldErrors.emergencyContactName}>
                <Input
                  value={form.emergencyContactName}
                  onChange={(e) => set('emergencyContactName')(e.target.value)}
                />
              </Field>
              <Field
                label="Emergency phone"
                error={
                  fieldErrors.emergencyContactPhone ??
                  (emergencyPhoneOk ? undefined : 'Enter a valid phone number')
                }
              >
                <Input
                  value={form.emergencyContactPhone}
                  onChange={(e) => set('emergencyContactPhone')(e.target.value)}
                  inputMode="tel"
                />
              </Field>
              <Field label="Relationship" error={fieldErrors.emergencyRelation}>
                <Input
                  value={form.emergencyRelation}
                  onChange={(e) => set('emergencyRelation')(e.target.value)}
                  placeholder="Father, aunt…"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Medical conditions" error={fieldErrors.medicalConditions}>
                <Textarea
                  rows={2}
                  value={form.medicalConditions}
                  onChange={(e) => set('medicalConditions')(e.target.value)}
                />
              </Field>
              <Field label="Allergies" error={fieldErrors.allergies}>
                <Textarea
                  rows={2}
                  value={form.allergies}
                  onChange={(e) => set('allergies')(e.target.value)}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Medications" error={fieldErrors.medications}>
                <Textarea
                  rows={2}
                  value={form.medications}
                  onChange={(e) => set('medications')(e.target.value)}
                />
              </Field>
              <Field label="Special needs" error={fieldErrors.specialNeeds}>
                <Textarea
                  rows={2}
                  value={form.specialNeeds}
                  onChange={(e) => set('specialNeeds')(e.target.value)}
                />
              </Field>
            </FieldRow>
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-2 pb-6">
          <Button variant="ghost" asChild>
            <Link href={`/students/${id}`}>Cancel</Link>
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!isValid}>
            Save changes
          </Button>
        </div>
      </form>
    </>
  );
}
