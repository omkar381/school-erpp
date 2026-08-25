import type { Metadata } from 'next';
import { ClipboardList, Phone } from 'lucide-react';
import { getPage, getSchool } from '@/lib/site/api';
import { ContentBlocks, Section, SectionHeading } from '@/components/site/blocks';
import { EnquiryForm } from '@/components/site/enquiry-form';

export async function generateMetadata({
  params,
}: PageProps<'/[school]/admissions'>): Promise<Metadata> {
  const { school: slug } = await params;
  const page = await getPage(slug, 'admissions');

  return {
    title: 'Admissions',
    description:
      page?.metaDescription ??
      page?.excerpt ??
      'Admission process, eligibility and how to apply.',
  };
}

const STEPS = [
  {
    title: 'Submit an enquiry',
    body: 'Fill in the form below with your child’s details and the class you are applying for.',
  },
  {
    title: 'We call you back',
    body: 'Our admissions team will phone to answer your questions and arrange a school visit.',
  },
  {
    title: 'Visit and assessment',
    body: 'Meet the teachers, see the campus, and complete an age-appropriate interaction.',
  },
  {
    title: 'Confirm the seat',
    body: 'Submit the documents, pay the admission fee, and your child’s place is confirmed.',
  },
];

export default async function AdmissionsPage({ params }: PageProps<'/[school]/admissions'>) {
  const { school: slug } = await params;
  const [school, page] = await Promise.all([getSchool(slug), getPage(slug, 'admissions')]);

  if (!school) return null;

  return (
    <>
      <Section>
        <SectionHeading
          eyebrow="Admissions"
          title={page?.title ?? 'Join our school'}
          lead={
            page?.excerpt ??
            'We admit students throughout the year, subject to seats being available in the class applied for.'
          }
        />

        {page && page.content.length > 0 ? (
          <div className="mt-8 max-w-3xl">
            <ContentBlocks blocks={page.content} />
          </div>
        ) : null}
      </Section>

      {/* How admission works */}
      <Section muted>
        <SectionHeading eyebrow="The process" title="Four steps to a confirmed seat" />

        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            >
              <span
                className="flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: 'var(--site-accent)' }}
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Enquiry form */}
      <Section>
        <div id="enquiry" className="grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <SectionHeading
              eyebrow="Start here"
              title="Admission enquiry"
              lead="Tell us about your child. Fields marked with an asterisk are required."
            />
            <div className="mt-7 max-w-2xl">
              <EnquiryForm slug={slug} />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-5">
              <Phone className="size-5" style={{ color: 'var(--site-accent)' }} aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">Prefer to call?</h3>
              <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">
                Our admissions desk is open during school hours
                {school.timings?.startTime && school.timings?.endTime
                  ? `, ${school.timings.startTime} to ${school.timings.endTime}`
                  : ''}
                .
              </p>
              <a
                href={`tel:${school.phone}`}
                className="mt-3 inline-block text-sm font-medium hover:underline"
                style={{ color: 'var(--site-accent)' }}
              >
                {school.phone}
              </a>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-5">
              <ClipboardList
                className="size-5"
                style={{ color: 'var(--site-accent)' }}
                aria-hidden
              />
              <h3 className="mt-3 text-sm font-semibold">Documents to keep ready</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-secondary)]">
                {[
                  'Birth certificate',
                  'Previous school report card',
                  'Transfer certificate, if applicable',
                  'Passport photographs',
                  'Address and ID proof',
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{ background: 'var(--site-accent)' }}
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
