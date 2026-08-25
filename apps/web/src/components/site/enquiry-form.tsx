'use client';

import * as React from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface FieldErrors {
  [field: string]: string;
}

const CLASSES = [
  'Nursery',
  'LKG',
  'UKG',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

const inputClass =
  'w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] ' +
  'px-3 py-2 text-sm placeholder:text-[var(--color-ink-faint)]';

/**
 * The admission enquiry form on the public site.
 *
 * Posts unauthenticated to the school's public endpoint. It carries a honeypot
 * field that a real applicant never sees, and the API rate-limits this route
 * far harder than the rest of the platform.
 */
export function EnquiryForm({ slug }: { slug: string }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setErrors({});

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(
      [...form.entries()].filter(([, value]) => String(value).trim() !== ''),
    );

    try {
      const response = await fetch(`${BASE}/website/public/${slug}/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        if (Array.isArray(result.errors) && result.errors.length > 0) {
          setErrors(
            Object.fromEntries(
              result.errors.map((error: { field: string; message: string }) => [
                error.field,
                error.message,
              ]),
            ),
          );
        } else if (response.status === 429) {
          setFormError(
            'Too many enquiries from this connection. Please try again in a few minutes, or call the school directly.',
          );
        } else {
          setFormError(result.message ?? 'Could not submit the enquiry. Please try again.');
        }
        return;
      }

      setDone(result.data?.enquiryNumber ?? 'received');
    } catch {
      setFormError(
        'Could not reach the school right now. Please check your connection or call us instead.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-success-border)] bg-[var(--color-success-soft)] p-6 text-center">
        <CheckCircle2
          className="mx-auto size-8 text-[var(--color-success)]"
          aria-hidden
        />
        <h3 className="mt-3 text-base font-semibold">Enquiry received</h3>
        <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">
          Our admissions team will call you shortly.
        </p>
        {done !== 'received' ? (
          <p className="mt-3 text-sm">
            Your reference number is{' '}
            <span className="font-semibold tabular">{done}</span> — please quote it when you
            call.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {formError}
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          About the child
        </legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" name="studentFirstName" error={errors.studentFirstName} required>
            <input name="studentFirstName" required className={inputClass} autoComplete="off" />
          </Field>
          <Field label="Last name" name="studentLastName" error={errors.studentLastName}>
            <input name="studentLastName" className={inputClass} autoComplete="off" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date of birth" name="dateOfBirth" error={errors.dateOfBirth}>
            <input name="dateOfBirth" type="date" className={inputClass} />
          </Field>
          <Field label="Gender" name="gender" error={errors.gender}>
            <select name="gender" className={inputClass} defaultValue="">
              <option value="">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Applying for" name="seekingClass" error={errors.seekingClass} required>
            <select name="seekingClass" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Select a class
              </option>
              {CLASSES.map((klass) => (
                <option key={klass} value={klass}>
                  {klass}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Present school" name="previousSchool" error={errors.previousSchool}>
          <input name="previousSchool" className={inputClass} placeholder="If any" />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          How we reach you
        </legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" name="parentName" error={errors.parentName} required>
            <input name="parentName" required className={inputClass} autoComplete="name" />
          </Field>
          <Field label="Relation" name="relation" error={errors.relation}>
            <select name="relation" className={inputClass} defaultValue="FATHER">
              <option value="FATHER">Father</option>
              <option value="MOTHER">Mother</option>
              <option value="GUARDIAN">Guardian</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" name="phone" error={errors.phone} required>
            <input
              name="phone"
              type="tel"
              required
              inputMode="tel"
              className={inputClass}
              placeholder="9845012345"
              autoComplete="tel"
            />
          </Field>
          <Field label="Email" name="email" error={errors.email}>
            <input
              name="email"
              type="email"
              className={inputClass}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
        </div>

        <Field label="City" name="city" error={errors.city}>
          <input name="city" className={inputClass} autoComplete="address-level2" />
        </Field>

        <Field label="Anything else we should know" name="notes" error={errors.notes}>
          <textarea name="notes" rows={3} className={cn(inputClass, 'resize-y')} />
        </Field>
      </fieldset>

      {/* Honeypot: hidden from people, irresistible to bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website-field">Website</label>
        <input id="website-field" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: 'var(--site-accent)' }}
      >
        <Send className="size-4" aria-hidden />
        {submitting ? 'Sending…' : 'Submit enquiry'}
      </button>

      <p className="text-xs text-[var(--color-ink-muted)]">
        We use these details only to contact you about admission. They are not shared with
        anyone else.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
