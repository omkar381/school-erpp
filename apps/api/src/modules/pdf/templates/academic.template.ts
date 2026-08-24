import type { Column, Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  HAIRLINE,
  INK,
  MUTED,
  type SchoolBrand,
  baseStyles,
  dataTable,
  detailPanel,
  footer,
  formatAddress,
  letterhead,
  safeColor,
  signatureRow,
} from './branding';

export interface ReportCardDocument {
  term: string;
  academicYear: string;
  generatedOn: string;
  student: {
    name: string;
    admissionNumber: string;
    rollNumber: string | null;
    className: string;
    sectionName: string;
    dateOfBirth: string | null;
    guardianName: string | null;
    photoDataUri: string | null;
  };
  subjects: Array<{
    subject: string;
    code: string | null;
    maxMarks: number;
    obtainedMarks: number | null;
    grade: string | null;
    remarks: string | null;
    isAbsent: boolean;
  }>;
  totalMarks: number | null;
  obtainedMarks: number | null;
  percentage: number | null;
  grade: string | null;
  gradePoint: number | null;
  rank: number | null;
  rankOutOf: number | null;
  result: string | null;
  attendedDays: number | null;
  totalDays: number | null;
  attendancePercent: number | null;
  classTeacherRemarks: string | null;
  principalRemarks: string | null;
  gradeScale: Array<{ grade: string; from: number; to: number; description: string | null }>;
  isProvisional: boolean;
}

export interface IdCardHolder {
  name: string;
  identifier: string;
  subtitle: string;
  qrPayload: string;
  photoDataUri: string | null;
  validTill: string | null;
  bloodGroup: string | null;
  guardianPhone: string | null;
  address: string | null;
  rows: Array<[string, string]>;
}

export interface CertificateDocument {
  type: string;
  title: string;
  certificateNumber: string;
  issuedOn: string;
  /** Paragraphs of body copy, already interpolated by the caller. */
  body: string[];
  details: Array<[string, string]>;
  signatories: string[];
}

const RESULT_COLORS: Record<string, string> = {
  PASS: '#15803D',
  FAIL: '#B91C1C',
  PROMOTED: '#15803D',
  DETAINED: '#B91C1C',
};

export function reportCardTemplate(
  brand: SchoolBrand,
  card: ReportCardDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);
  const { student } = card;

  const identity: Content = {
    columns: [
      {
        width: '*',
        ...detailPanel(
          [
            ['Student', student.name],
            ['Admission No.', student.admissionNumber],
            ['Roll No.', student.rollNumber ?? '—'],
            ['Class', `${student.className} — ${student.sectionName}`],
            ['Date of Birth', student.dateOfBirth ?? '—'],
            ['Guardian', student.guardianName ?? '—'],
            ['Academic Year', card.academicYear],
            ['Term', card.term],
          ],
          2,
        ),
      },
      ...(student.photoDataUri
        ? [
            {
              width: 72,
              stack: [
                {
                  image: student.photoDataUri,
                  fit: [64, 78] as [number, number],
                  alignment: 'center' as const,
                },
              ],
            },
          ]
        : []),
    ],
    columnGap: 12,
  };

  const summaryCards: Content = {
    columns: [
      summaryTile('Total', card.totalMarks !== null ? String(card.totalMarks) : '—', accent),
      summaryTile('Obtained', card.obtainedMarks !== null ? String(card.obtainedMarks) : '—', accent),
      summaryTile(
        'Percentage',
        card.percentage !== null ? `${card.percentage.toFixed(2)}%` : '—',
        accent,
      ),
      summaryTile('Grade', card.grade ?? '—', accent),
      summaryTile(
        'Rank',
        card.rank !== null ? `${card.rank}${card.rankOutOf ? ` / ${card.rankOutOf}` : ''}` : '—',
        accent,
      ),
      summaryTile(
        'Attendance',
        card.attendancePercent !== null
          ? `${card.attendancePercent.toFixed(1)}%`
          : card.attendedDays !== null && card.totalDays
            ? `${card.attendedDays}/${card.totalDays}`
            : '—',
        accent,
      ),
    ],
    columnGap: 6,
    margin: [0, 10, 0, 0],
  };

  const content: Content[] = [
    ...letterhead(brand, `Report Card — ${card.term}`),
    identity,
    { text: 'Subject performance', style: 'sectionTitle' },
    dataTable({
      headers: ['Subject', 'Code', 'Max', 'Obtained', 'Grade', 'Remarks'],
      widths: ['*', 54, 40, 54, 44, 130],
      align: ['left', 'left', 'right', 'right', 'center', 'left'],
      headerColor: accent,
      rows: card.subjects.map((subject) => [
        subject.subject,
        subject.code ?? '—',
        subject.maxMarks,
        subject.isAbsent ? 'AB' : (subject.obtainedMarks ?? '—'),
        subject.grade ?? '—',
        subject.remarks ?? '',
      ]),
      emptyText: 'No marks have been entered for this term',
    }),
    summaryCards,
  ];

  if (card.result) {
    content.push({
      columns: [
        { text: 'Result', style: 'label', width: 'auto', margin: [0, 14, 6, 0] },
        {
          text: card.result,
          width: 'auto',
          bold: true,
          fontSize: 11,
          color: RESULT_COLORS[card.result.toUpperCase()] ?? accent,
          margin: [0, 12, 0, 0],
        },
      ],
    });
  }

  if (card.gradeScale.length > 0) {
    content.push(
      { text: 'Grading scale', style: 'sectionTitle' },
      dataTable({
        headers: ['Grade', 'Range', 'Description'],
        widths: [50, 90, '*'],
        align: ['center', 'center', 'left'],
        headerColor: accent,
        rows: card.gradeScale.map((band) => [
          band.grade,
          `${band.from} – ${band.to}`,
          band.description ?? '',
        ]),
      }),
    );
  }

  const remarks: Array<[string, string]> = [
    ...(card.classTeacherRemarks
      ? ([["Class teacher's remarks", card.classTeacherRemarks]] as Array<[string, string]>)
      : []),
    ...(card.principalRemarks
      ? ([["Principal's remarks", card.principalRemarks]] as Array<[string, string]>)
      : []),
  ];

  if (remarks.length > 0) {
    content.push({ text: 'Remarks', style: 'sectionTitle' });
    for (const [label, text] of remarks) {
      content.push({ text: label, style: 'label' }, { text, style: 'tableCell', margin: [0, 0, 0, 6] });
    }
  }

  content.push(signatureRow(['Class Teacher', 'Principal', 'Parent / Guardian']));

  if (card.isProvisional) {
    content.push({
      text: 'PROVISIONAL — this report card has not been published and may still change.',
      style: 'note',
      color: '#B45309',
      margin: [0, 16, 0, 0],
    });
  }

  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 46],
    info: {
      title: `Report card — ${student.name} — ${card.term}`,
      author: brand.name,
    },
    content,
    footer: footer(brand, `${brand.name} — generated ${card.generatedOn}`),
    styles: {
      ...baseStyles(brand),
      tileLabel: { fontSize: 7, color: MUTED, alignment: 'center' },
      tileValue: { fontSize: 12, bold: true, alignment: 'center' },
    },
  };
}

function summaryTile(label: string, value: string, accent: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              { text: label.toUpperCase(), style: 'tileLabel' },
              { text: value, style: 'tileValue', color: accent, margin: [0, 2, 0, 0] },
            ],
            margin: [0, 6, 0, 6],
          },
        ],
      ],
    },
    layout: {
      fillColor: () => '#F8FAFC',
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => HAIRLINE,
      vLineColor: () => HAIRLINE,
    },
  };
}

/**
 * ID cards, laid out two per row on A4 at roughly CR80 proportions so a school
 * can print a sheet and cut it down.
 */
export function idCardSheetTemplate(
  brand: SchoolBrand,
  holders: IdCardHolder[],
  documentTitle = 'Identity Cards',
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);

  const cards: Column[] = holders.map((holder) => idCard(brand, holder, accent));
  const rows: Content[] = [];

  for (let index = 0; index < cards.length; index += 2) {
    rows.push({
      columns: [cards[index], cards[index + 1] ?? { text: '' }],
      columnGap: 14,
      margin: [0, 0, 0, 14],
    });
  }

  return {
    pageSize: 'A4',
    pageMargins: [30, 30, 30, 36],
    info: { title: documentTitle, author: brand.name },
    content:
      rows.length > 0 ? rows : [{ text: 'No cards to print', style: 'note', alignment: 'center' }],
    footer: footer(brand, `${brand.name} — cut along the card edges`),
    styles: {
      ...baseStyles(brand),
      cardName: { fontSize: 10, bold: true },
      cardMeta: { fontSize: 6.5, color: MUTED },
      cardLabel: { fontSize: 6, color: MUTED },
      cardValue: { fontSize: 7, bold: true },
      cardSchool: { fontSize: 8, bold: true, color: '#FFFFFF' },
      cardStrap: { fontSize: 5.5, color: '#E2E8F0' },
    },
  };
}

function idCard(brand: SchoolBrand, holder: IdCardHolder, accent: string): Column {
  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [
        // Coloured masthead.
        [
          {
            columns: [
              ...(brand.logoDataUri
                ? [{ image: brand.logoDataUri, fit: [20, 20] as [number, number], width: 24 }]
                : []),
              {
                stack: [
                  { text: brand.name.toUpperCase(), style: 'cardSchool' },
                  { text: formatAddress(brand) || brand.phone, style: 'cardStrap' },
                ],
              },
            ],
            columnGap: 5,
            fillColor: accent,
            margin: [7, 6, 7, 6],
          },
        ],
        [
          {
            columns: [
              ...(holder.photoDataUri
                ? [
                    {
                      width: 54,
                      image: holder.photoDataUri,
                      fit: [50, 62] as [number, number],
                    },
                  ]
                : []),
              {
                width: '*',
                stack: [
                  { text: holder.name, style: 'cardName' },
                  { text: holder.subtitle, style: 'cardMeta', margin: [0, 0, 0, 4] },
                  {
                    table: {
                      widths: ['auto', '*'],
                      body: [
                        [
                          { text: 'ID', style: 'cardLabel' },
                          { text: holder.identifier, style: 'cardValue' },
                        ],
                        ...holder.rows.map(([label, value]) => [
                          { text: label, style: 'cardLabel' },
                          { text: value || '—', style: 'cardValue' },
                        ]),
                        ...(holder.bloodGroup
                          ? [
                              [
                                { text: 'Blood', style: 'cardLabel' },
                                { text: holder.bloodGroup.replace('_', ' '), style: 'cardValue' },
                              ],
                            ]
                          : []),
                      ],
                    },
                    layout: 'noBorders',
                  },
                ],
              },
              {
                width: 52,
                stack: [
                  { qr: holder.qrPayload, fit: 50, alignment: 'right' },
                  ...(holder.validTill
                    ? [
                        {
                          text: `Valid to ${holder.validTill}`,
                          style: 'cardStrap',
                          color: MUTED,
                          alignment: 'right' as const,
                          margin: [0, 2, 0, 0] as [number, number, number, number],
                        },
                      ]
                    : []),
                ],
              },
            ],
            columnGap: 7,
            margin: [7, 7, 7, 7],
          },
        ],
        [
          {
            text: [
              holder.guardianPhone ? `Emergency: ${holder.guardianPhone}` : '',
              holder.address ? `  •  ${holder.address}` : '',
            ]
              .join('')
              .trim() || `If found, please return to ${brand.name}, ${brand.phone}`,
            style: 'cardStrap',
            color: MUTED,
            margin: [7, 0, 7, 6],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: (index: number, node: { table: { body: unknown[] } }) =>
        index === 0 || index === node.table.body.length ? 0.8 : 0,
      vLineWidth: () => 0.8,
      hLineColor: () => HAIRLINE,
      vLineColor: () => HAIRLINE,
    },
  };
}

export function certificateTemplate(
  brand: SchoolBrand,
  certificate: CertificateDocument,
): TDocumentDefinitions {
  const accent = safeColor(brand.primaryColor, INK);
  const secondary = safeColor(brand.secondaryColor, accent);

  return {
    pageSize: 'A4',
    pageMargins: [56, 56, 56, 56],
    info: { title: `${certificate.title} — ${certificate.certificateNumber}`, author: brand.name },
    // A double rule border, drawn per page so a long certificate stays framed.
    background: () => ({
      canvas: [
        {
          type: 'rect',
          x: 24,
          y: 24,
          w: 547,
          h: 794,
          lineWidth: 2,
          lineColor: accent,
        },
        {
          type: 'rect',
          x: 30,
          y: 30,
          w: 535,
          h: 782,
          lineWidth: 0.6,
          lineColor: secondary,
        },
      ],
    }),
    content: [
      ...letterhead(brand, certificate.title),
      {
        columns: [
          { text: `No. ${certificate.certificateNumber}`, style: 'value' },
          { text: `Date: ${certificate.issuedOn}`, style: 'value', alignment: 'right' },
        ],
        margin: [0, 0, 0, 18],
      },
      ...certificate.body.map((paragraph) => ({
        text: paragraph,
        fontSize: 10.5,
        lineHeight: 1.6,
        alignment: 'justify' as const,
        margin: [0, 0, 0, 10] as [number, number, number, number],
      })),
      ...(certificate.details.length > 0
        ? [
            { text: 'Particulars', style: 'sectionTitle' },
            detailPanel(certificate.details, 2),
          ]
        : []),
      signatureRow(certificate.signatories),
      {
        text: 'This certificate is issued on the request of the applicant for whatever purpose it may serve.',
        style: 'note',
        margin: [0, 26, 0, 0],
      },
    ],
    footer: footer(brand),
    styles: baseStyles(brand),
  };
}
