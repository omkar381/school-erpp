'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { api, errorMessage, uploadFile } from '@/lib/api';
import { useClasses, useSections } from '@/hooks/use-lookups';
import { saveBlob } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FieldRow } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

interface ImportRowError {
  row: number;
  field?: string;
  message: string;
  value?: string;
}

interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  preview?: Array<Record<string, unknown>>;
}

/**
 * Bulk student import.
 *
 * The flow is deliberately two-pass: a dry run validates the whole file and
 * reports every bad row without writing anything, and only then is the real
 * import offered. Importing a 400-row spreadsheet and discovering row 12 was
 * malformed halfway through is the failure mode this avoids.
 */
export default function ImportStudentsPage() {
  const router = useRouter();

  const [file, setFile] = React.useState<File | null>(null);
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [createGuardianLogins, setCreateGuardianLogins] = React.useState(false);

  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [wasDryRun, setWasDryRun] = React.useState(true);
  const [busy, setBusy] = React.useState<'none' | 'validating' | 'importing' | 'template'>('none');
  const [error, setError] = React.useState<string | null>(null);

  const { data: classes } = useClasses();
  const { data: sections } = useSections(classId || undefined);

  const ready = file !== null && sectionId !== '';

  async function downloadTemplate() {
    setBusy('template');
    try {
      const file = await api.download('/students/import/template');
      saveBlob(file.blob, file.fileName || 'student-import-template.xlsx');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy('none');
    }
  }

  async function run(dryRun: boolean) {
    if (!file || !sectionId) return;

    setBusy(dryRun ? 'validating' : 'importing');
    setError(null);

    try {
      const response = await uploadFile<ImportResult>('/students/import', file, 'file', {
        sectionId,
        dryRun: String(dryRun),
        createGuardianLogins: String(createGuardianLogins),
      });

      setResult(response);
      setWasDryRun(dryRun);
    } catch (caught) {
      setError(errorMessage(caught));
      setResult(null);
    } finally {
      setBusy('none');
    }
  }

  const cleanRun = result !== null && result.failed === 0 && result.totalRows > 0;

  return (
    <>
      <PageHeader
        title="Import students"
        description="Bring a class list in from Excel or CSV."
        actions={
          <Button size="sm" variant="ghost" asChild icon={<ArrowLeft />}>
            <Link href="/students">Back to students</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader
            title="1. Choose the file and destination"
            description="Every row in the file is admitted into the same section."
          />
          <CardBody className="space-y-3">
            <Field
              label="Spreadsheet"
              required
              help="Excel (.xlsx) or CSV, up to 1000 rows"
            >
              <Input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  // A new file invalidates the previous report.
                  setResult(null);
                  setError(null);
                }}
                className="h-auto py-1.5"
              />
            </Field>

            <FieldRow>
              <Field label="Class" required>
                <Select
                  value={classId}
                  onChange={(event) => {
                    setClassId(event.target.value);
                    setSectionId('');
                    setResult(null);
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
              <Field label="Section" required>
                <Select
                  value={sectionId}
                  onChange={(event) => {
                    setSectionId(event.target.value);
                    setResult(null);
                  }}
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

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={createGuardianLogins}
                onChange={(event) => setCreateGuardianLogins(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Create parent portal logins for guardians in the file
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={downloadTemplate}
                loading={busy === 'template'}
                icon={<Download />}
              >
                Download template
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => run(true)}
                loading={busy === 'validating'}
                disabled={!ready || busy !== 'none'}
              >
                Validate file
              </Button>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]"
              >
                {error}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="2. Review, then import"
            description={
              result
                ? wasDryRun
                  ? 'Nothing has been written yet.'
                  : 'The import has been applied.'
                : 'Validate a file to see what would happen.'
            }
          />
          <CardBody className="space-y-3">
            {!result ? (
              <EmptyState
                icon={<FileSpreadsheet />}
                title="No file checked yet"
                description="Pick a spreadsheet and a destination section, then validate it."
              />
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['Rows', result.totalRows, undefined],
                    [wasDryRun ? 'Would import' : 'Imported', result.imported, 'success'],
                    ['Skipped', result.skipped, result.skipped > 0 ? 'warning' : undefined],
                    ['Failed', result.failed, result.failed > 0 ? 'danger' : undefined],
                  ].map(([label, value, tone]) => (
                    <div
                      key={String(label)}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-2"
                    >
                      <p className="text-2xs text-[var(--color-ink-muted)]">{String(label)}</p>
                      <p
                        className={
                          tone === 'danger'
                            ? 'text-lg font-semibold tabular text-[var(--color-danger)]'
                            : tone === 'warning'
                              ? 'text-lg font-semibold tabular text-[var(--color-warning)]'
                              : tone === 'success'
                                ? 'text-lg font-semibold tabular text-[var(--color-success)]'
                                : 'text-lg font-semibold tabular'
                        }
                      >
                        {Number(value)}
                      </p>
                    </div>
                  ))}
                </div>

                {result.errors.length > 0 ? (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                    <p className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium">
                      <TriangleAlert className="size-3.5 text-[var(--color-warning)]" aria-hidden />
                      Rows that need fixing
                    </p>
                    <ul className="max-h-64 divide-y divide-[var(--color-border)] overflow-y-auto">
                      {result.errors.map((rowError, index) => (
                        <li
                          key={`${rowError.row}-${rowError.field ?? index}`}
                          className="flex items-start gap-2 px-3 py-1.5 text-2xs"
                        >
                          <Badge>Row {rowError.row}</Badge>
                          <span className="min-w-0 flex-1">
                            {rowError.field ? (
                              <span className="font-medium">{rowError.field}: </span>
                            ) : null}
                            {rowError.message}
                            {rowError.value ? (
                              <span className="text-[var(--color-ink-muted)]">
                                {' '}
                                (got &ldquo;{rowError.value}&rdquo;)
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {wasDryRun ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Upload />}
                      loading={busy === 'importing'}
                      disabled={!cleanRun || busy !== 'none'}
                      onClick={() => run(false)}
                    >
                      Import {result.imported} student{result.imported === 1 ? '' : 's'}
                    </Button>
                    {!cleanRun ? (
                      <span className="text-2xs text-[var(--color-ink-muted)]">
                        {result.totalRows === 0
                          ? 'The file has no data rows.'
                          : 'Fix the rows above and validate again before importing.'}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => router.push('/students')}>
                    View students
                  </Button>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
