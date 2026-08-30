'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { BLOOD_GROUPS, GENDERS, GUARDIAN_RELATIONS, humanise } from '@erp/shared-types';
import { ApiClientError, api } from '@/lib/api';
import { useAction } from '@/hooks/use-action';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';

interface GuardianDraft {
  key: string;
  firstName: string;
  lastName: string;
  relation: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

function emptyGuardian(isPrimary: boolean): GuardianDraft {
  return {
    key: Math.random().toString(36).slice(2),
    firstName: '',
    lastName: '',
    relation: isPrimary ? 'FATHER' : 'MOTHER',
    phone: '',
    email: '',
    isPrimary,
  };
}

/**
 * Admitting a student.
 *
 * Long enough to warrant a page rather than a modal, and grouped the way a
 * registrar fills the paper form: who the child is, where they are being
 * admitted, who to contact, then the details that are nice to have.
 */
export default function NewStudentPage() {
  const router = useRouter();

  const [firstName, setFirstName] = React.useState('');
  const [middleName, setMiddleName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [gender, setGender] = React.useState('');
  const [bloodGroup, setBloodGroup] = React.useState('UNKNOWN');

  const [admissionNumber, setAdmissionNumber] = React.useState('');
  const [admissionDate, setAdmissionDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [rollNumber, setRollNumber] = React.useState('');

  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [addressLine1, setAddressLine1] = React.useState('');
  const [city, setCity] = React.useState('');
  const [previousSchool, setPreviousSchool] = React.useState('');
  const [medicalConditions, setMedicalConditions] = React.useState('');

  const [guardians, setGuardians] = React.useState<GuardianDraft[]>([emptyGuardian(true)]);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);

  const selectedSection = (sections ?? []).find((section) => section.id === sectionId);
  const sectionFull = selectedSection ? selectedSection.availableSeats <= 0 : false;

  const isValid =
    firstName.trim().length > 0 &&
    dateOfBirth !== '' &&
    gender !== '' &&
    admissionDate !== '' &&
    classId !== '' &&
    sectionId !== '' &&
    !sectionFull;

  const create = useAction({
    mutationFn: () =>
      api.post<{ id: string; admissionNumber: string }>('/students', {
        firstName: firstName.trim(),
        ...(middleName.trim() ? { middleName: middleName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        dateOfBirth,
        gender,
        ...(bloodGroup !== 'UNKNOWN' ? { bloodGroup } : {}),
        ...(admissionNumber.trim() ? { admissionNumber: admissionNumber.trim() } : {}),
        admissionDate,
        classId,
        sectionId,
        ...(rollNumber.trim() ? { rollNumber: rollNumber.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(addressLine1.trim() ? { addressLine1: addressLine1.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(previousSchool.trim() ? { previousSchool: previousSchool.trim() } : {}),
        ...(medicalConditions.trim() ? { medicalConditions: medicalConditions.trim() } : {}),
        guardians: guardians
          .filter((guardian) => guardian.firstName.trim() && guardian.phone.trim())
          .map((guardian) => ({
            firstName: guardian.firstName.trim(),
            ...(guardian.lastName.trim() ? { lastName: guardian.lastName.trim() } : {}),
            relation: guardian.relation,
            phone: guardian.phone.trim(),
            ...(guardian.email.trim() ? { email: guardian.email.trim() } : {}),
            isPrimary: guardian.isPrimary,
          })),
      }),
    successMessage: 'Student admitted',
    invalidates: [['students'], ['lookup']],
    onSuccess: (student) => router.replace(`/students/${student.id}`),
    onError: (error: ApiClientError) => {
      setFieldErrors(error.isValidation ? error.byField : {});
    },
  });

  function updateGuardian(key: string, patch: Partial<GuardianDraft>) {
    setGuardians((current) =>
      current.map((guardian) => (guardian.key === key ? { ...guardian, ...patch } : guardian)),
    );
  }

  return (
    <>
      <PageHeader
        title="Admit a student"
        description="Creates the student record, the enrolment and any guardians in one step."
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href="/students">Back to students</Link>
          </Button>
        }
      />

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid) create.mutate(undefined);
        }}
      >
        <Card>
          <CardHeader title="Student" description="As it should appear on records and certificates." />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field label="First name" required error={fieldErrors.firstName}>
                <Input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Middle name" error={fieldErrors.middleName}>
                <Input value={middleName} onChange={(event) => setMiddleName(event.target.value)} />
              </Field>
              <Field label="Last name" error={fieldErrors.lastName}>
                <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </Field>
            </FieldRow>

            <FieldRow columns={3}>
              <Field label="Date of birth" required error={fieldErrors.dateOfBirth}>
                <Input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                />
              </Field>
              <Field label="Gender" required error={fieldErrors.gender}>
                <Select value={gender} onChange={(event) => setGender(event.target.value)}>
                  <option value="">Select</option>
                  {GENDERS.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Blood group" error={fieldErrors.bloodGroup}>
                <Select value={bloodGroup} onChange={(event) => setBloodGroup(event.target.value)}>
                  {BLOOD_GROUPS.map((value) => (
                    <option key={value} value={value}>
                      {value === 'UNKNOWN' ? 'Not known' : value.replace(/_(POSITIVE)/, '+').replace(/_(NEGATIVE)/, '−')}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Admission" description="Where and when the student joins." />
          <CardBody className="space-y-3">
            <FieldRow columns={3}>
              <Field
                label="Admission number"
                error={fieldErrors.admissionNumber}
                help="Generated automatically when left blank"
              >
                <Input
                  value={admissionNumber}
                  onChange={(event) => setAdmissionNumber(event.target.value)}
                  placeholder="Auto"
                />
              </Field>
              <Field label="Admission date" required error={fieldErrors.admissionDate}>
                <Input
                  type="date"
                  value={admissionDate}
                  onChange={(event) => setAdmissionDate(event.target.value)}
                />
              </Field>
              <Field label="Roll number" error={fieldErrors.rollNumber}>
                <Input
                  value={rollNumber}
                  onChange={(event) => setRollNumber(event.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Class" required error={fieldErrors.classId}>
                <Select
                  value={classId}
                  onChange={(event) => {
                    setClassId(event.target.value);
                    // A section belongs to exactly one class, so a change here
                    // drops a selection that no longer belongs to it.
                    setSectionId('');
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
                label="Section"
                required
                error={
                  fieldErrors.sectionId ??
                  (sectionFull ? 'This section is full. Choose another.' : undefined)
                }
                help={
                  selectedSection && !sectionFull
                    ? `${selectedSection.availableSeats} seat(s) available`
                    : undefined
                }
              >
                <Select
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                  disabled={!classId}
                >
                  <option value="">{classId ? 'Select a section' : 'Choose a class first'}</option>
                  {(sections ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name} — {section.availableSeats} free
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Guardians"
            description="At least one contact with a phone number is strongly recommended."
            actions={
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus />}
                onClick={() => setGuardians((current) => [...current, emptyGuardian(false)])}
              >
                Add guardian
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {guardians.map((guardian, index) => (
              <div
                key={guardian.key}
                className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
                    Guardian {index + 1}
                    {guardian.isPrimary ? ' · primary contact' : ''}
                  </p>
                  {guardians.length > 1 ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove guardian ${index + 1}`}
                      onClick={() =>
                        setGuardians((current) =>
                          current.filter((entry) => entry.key !== guardian.key),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>

                <FieldRow columns={4}>
                  <Field label="First name">
                    <Input
                      value={guardian.firstName}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { firstName: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Last name">
                    <Input
                      value={guardian.lastName}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { lastName: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Relation">
                    <Select
                      value={guardian.relation}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { relation: event.target.value })
                      }
                    >
                      {GUARDIAN_RELATIONS.map((value) => (
                        <option key={value} value={value}>
                          {humanise(value)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={guardian.phone}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { phone: event.target.value })
                      }
                      placeholder="+91…"
                      inputMode="tel"
                    />
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={guardian.email}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { email: event.target.value })
                      }
                      placeholder="Optional"
                    />
                  </Field>
                  <Field label="Primary contact">
                    <label className="flex h-8 items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="primaryGuardian"
                        checked={guardian.isPrimary}
                        onChange={() =>
                          // Exactly one guardian is primary, so selecting one
                          // clears the rest rather than allowing two.
                          setGuardians((current) =>
                            current.map((entry) => ({
                              ...entry,
                              isPrimary: entry.key === guardian.key,
                            })),
                          )
                        }
                        className="size-3.5 accent-[var(--color-accent)]"
                      />
                      Receives fee and attendance alerts
                    </label>
                  </Field>
                </FieldRow>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact and background" description="All optional." />
          <CardBody className="space-y-3">
            <FieldRow>
              <Field label="Student phone" error={fieldErrors.phone}>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                />
              </Field>
              <Field label="Student email" error={fieldErrors.email}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Address" error={fieldErrors.addressLine1}>
                <Input
                  value={addressLine1}
                  onChange={(event) => setAddressLine1(event.target.value)}
                />
              </Field>
              <Field label="City" error={fieldErrors.city}>
                <Input value={city} onChange={(event) => setCity(event.target.value)} />
              </Field>
            </FieldRow>

            <Field label="Previous school" error={fieldErrors.previousSchool}>
              <Input
                value={previousSchool}
                onChange={(event) => setPreviousSchool(event.target.value)}
              />
            </Field>

            <Field
              label="Medical conditions"
              error={fieldErrors.medicalConditions}
              help="Shown to staff on the student's record"
            >
              <Textarea
                rows={2}
                value={medicalConditions}
                onChange={(event) => setMedicalConditions(event.target.value)}
              />
            </Field>
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-2 pb-6">
          <Button variant="ghost" asChild>
            <Link href="/students">Cancel</Link>
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!isValid}>
            Admit student
          </Button>
        </div>
      </form>
    </>
  );
}
