'use client';

import * as React from 'react';
import { GUARDIAN_RELATIONS, humanise } from '@erp/shared-types';
import { api } from '@/lib/api';
import { Field, FieldRow } from '@/components/ui/field';
import { FormModal } from '@/components/ui/form-modal';
import { Input, Select } from '@/components/ui/input';

/** The subset of a guardian the form needs, common to the list row and the
 *  detail response. */
export interface EditableGuardian {
  id: string;
  firstName: string;
  lastName: string | null;
  relation: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  occupation: string | null;
  organization: string | null;
  qualification: string | null;
  addressLine1: string | null;
  city: string | null;
}

export const GUARDIAN_QUERIES = [['guardians'], ['guardian']];

export function GuardianFormDialog({
  guardian,
  onClose,
}: {
  guardian?: EditableGuardian;
  onClose: () => void;
}) {
  const isEdit = Boolean(guardian);

  const [firstName, setFirstName] = React.useState(guardian?.firstName ?? '');
  const [lastName, setLastName] = React.useState(guardian?.lastName ?? '');
  const [relation, setRelation] = React.useState(guardian?.relation ?? 'FATHER');
  const [phone, setPhone] = React.useState(guardian?.phone ?? '');
  const [alternatePhone, setAlternatePhone] = React.useState(guardian?.alternatePhone ?? '');
  const [email, setEmail] = React.useState(guardian?.email ?? '');
  const [occupation, setOccupation] = React.useState(guardian?.occupation ?? '');
  const [organization, setOrganization] = React.useState(guardian?.organization ?? '');
  const [qualification, setQualification] = React.useState(guardian?.qualification ?? '');
  const [addressLine1, setAddressLine1] = React.useState(guardian?.addressLine1 ?? '');
  const [city, setCity] = React.useState(guardian?.city ?? '');

  const phoneOk = /^\+?[0-9]{10,15}$/.test(phone.trim());

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={isEdit ? 'Edit parent' : 'Add parent'}
      description={
        isEdit
          ? 'Contact details here are what the school uses to reach this family.'
          : 'Link them to a student from the student record once saved.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Add parent'}
      values={{
        firstName,
        lastName,
        relation,
        phone,
        alternatePhone,
        email,
        occupation,
        organization,
        qualification,
        addressLine1,
        city,
      }}
      isValid={firstName.trim().length > 0 && phoneOk}
      successMessage={isEdit ? 'Guardian updated' : 'Guardian added'}
      invalidates={GUARDIAN_QUERIES}
      submit={(values) => {
        const body = {
          firstName: values.firstName.trim(),
          ...(values.lastName.trim() ? { lastName: values.lastName.trim() } : {}),
          relation: values.relation,
          phone: values.phone.trim(),
          ...(values.alternatePhone.trim() ? { alternatePhone: values.alternatePhone.trim() } : {}),
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          ...(values.occupation.trim() ? { occupation: values.occupation.trim() } : {}),
          ...(values.organization.trim() ? { organization: values.organization.trim() } : {}),
          ...(values.qualification.trim() ? { qualification: values.qualification.trim() } : {}),
          ...(values.addressLine1.trim() ? { addressLine1: values.addressLine1.trim() } : {}),
          ...(values.city.trim() ? { city: values.city.trim() } : {}),
        };

        return isEdit
          ? api.patch(`/guardians/${guardian!.id}`, body)
          : api.post('/guardians', body);
      }}
    >
      {(errors) => (
        <>
          <FieldRow columns={3}>
            <Field label="First name" required error={errors.firstName}>
              <Input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </Field>
            <Field label="Relation" required error={errors.relation}>
              <Select value={relation} onChange={(event) => setRelation(event.target.value)}>
                {GUARDIAN_RELATIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Phone" required error={errors.phone}>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+919876543210"
              />
            </Field>
            <Field label="Alternate phone" error={errors.alternatePhone}>
              <Input
                value={alternatePhone}
                onChange={(event) => setAlternatePhone(event.target.value)}
              />
            </Field>
            <Field
              label="Email"
              error={errors.email}
              help="Needed before a portal login can be created"
            >
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow columns={3}>
            <Field label="Occupation" error={errors.occupation}>
              <Input value={occupation} onChange={(event) => setOccupation(event.target.value)} />
            </Field>
            <Field label="Organization" error={errors.organization}>
              <Input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
              />
            </Field>
            <Field label="Qualification" error={errors.qualification}>
              <Input
                value={qualification}
                onChange={(event) => setQualification(event.target.value)}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Address" error={errors.addressLine1}>
              <Input
                value={addressLine1}
                onChange={(event) => setAddressLine1(event.target.value)}
              />
            </Field>
            <Field label="City" error={errors.city}>
              <Input value={city} onChange={(event) => setCity(event.target.value)} />
            </Field>
          </FieldRow>
        </>
      )}
    </FormModal>
  );
}
