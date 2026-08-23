/**
 * Transactional email templates.
 *
 * Rendered server-side into inline-styled HTML, since email clients strip
 * stylesheets. Values are HTML-escaped before interpolation.
 */

export type EmailTemplateName =
  | 'password-reset'
  | 'email-verification'
  | 'welcome'
  | 'account-created'
  | 'fee-reminder'
  | 'payment-receipt'
  | 'attendance-absence'
  | 'result-published'
  | 'notice'
  | 'leave-status'
  | 'generic';

const escape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const COLORS = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#2563eb',
  danger: '#dc2626',
  success: '#059669',
};

function layout(content: string, appName: string, year: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(appName)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.surface};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid ${COLORS.border};">
            <span style="font-size:15px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;">${escape(appName)}</span>
          </td>
        </tr>
        <tr><td style="padding:32px;color:${COLORS.body};font-size:14px;line-height:1.6;">${content}</td></tr>
        <tr>
          <td style="padding:20px 32px;background-color:${COLORS.surface};border-top:1px solid ${COLORS.border};color:${COLORS.muted};font-size:12px;line-height:1.5;">
            This is an automated message &mdash; please do not reply to it.<br>
            &copy; ${year} ${escape(appName)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const heading = (text: string): string =>
  `<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;">${escape(text)}</h1>`;

const paragraph = (html: string): string =>
  `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${COLORS.body};">${html}</p>`;

const button = (label: string, url: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background-color:${COLORS.accent};border-radius:6px;">
    <a href="${escape(url)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">${escape(label)}</a>
  </td></tr></table>`;

const muted = (text: string): string =>
  `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};">${text}</p>`;

const detailRows = (rows: Array<[string, string]>): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${COLORS.border};border-radius:6px;">
    ${rows
      .map(
        ([label, value], index) => `<tr>
        <td style="padding:10px 14px;font-size:13px;color:${COLORS.muted};${index ? `border-top:1px solid ${COLORS.border};` : ''}">${escape(label)}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:500;color:${COLORS.ink};text-align:right;${index ? `border-top:1px solid ${COLORS.border};` : ''}">${escape(value)}</td>
      </tr>`,
      )
      .join('')}
  </table>`;

type TemplateData = Record<string, unknown>;

const templates: Record<EmailTemplateName, (d: TemplateData) => string> = {
  'password-reset': (d) =>
    heading('Reset your password') +
    paragraph(`Hello ${escape(d.firstName)},`) +
    paragraph(
      'We received a request to reset the password for your account. Use the button below to choose a new one.',
    ) +
    button('Reset password', String(d.resetUrl)) +
    paragraph(
      `This link expires in <strong>${escape(d.expiryMinutes)} minutes</strong> and can be used once.`,
    ) +
    muted(
      'If you did not request this, you can safely ignore this email &mdash; your password will not change.',
    ),

  'email-verification': (d) =>
    heading('Verify your email address') +
    paragraph(`Hello ${escape(d.firstName)},`) +
    paragraph('Please confirm your email address to finish setting up your account.') +
    button('Verify email', String(d.verifyUrl)) +
    muted(`This link expires in ${escape(d.expiryHours)} hours.`),

  welcome: (d) =>
    heading(`Welcome to ${escape(d.schoolName)}`) +
    paragraph(`Hello ${escape(d.firstName)},`) +
    paragraph(
      `Your ${escape(d.roleName)} account has been created. You can sign in with the credentials below and will be asked to set a new password on first use.`,
    ) +
    detailRows([
      ['Username', String(d.username ?? '')],
      ['Temporary password', String(d.temporaryPassword ?? '')],
    ]) +
    button('Sign in', String(d.loginUrl)) +
    muted('For your security, please change this password immediately after signing in.'),

  'account-created': (d) =>
    heading('Your account is ready') +
    paragraph(`Hello ${escape(d.firstName)},`) +
    paragraph(`An account has been created for you at ${escape(d.schoolName)}.`) +
    detailRows([
      ['Username', String(d.username ?? '')],
      ['Temporary password', String(d.temporaryPassword ?? '')],
      ['Role', String(d.roleName ?? '')],
    ]) +
    button('Sign in', String(d.loginUrl)),

  'fee-reminder': (d) =>
    heading('Fee payment reminder') +
    paragraph(`Dear ${escape(d.guardianName)},`) +
    paragraph(
      `This is a reminder that a fee payment for <strong>${escape(d.studentName)}</strong> is due.`,
    ) +
    detailRows([
      ['Invoice', String(d.invoiceNumber ?? '')],
      ['Amount due', `${escape(d.currency)} ${escape(d.amount)}`],
      ['Due date', String(d.dueDate ?? '')],
    ]) +
    button('Pay now', String(d.paymentUrl)) +
    muted('If you have already made this payment, please disregard this reminder.'),

  'payment-receipt': (d) =>
    heading('Payment received') +
    paragraph(`Dear ${escape(d.guardianName)},`) +
    paragraph(
      `We have received your payment for <strong>${escape(d.studentName)}</strong>. Thank you.`,
    ) +
    detailRows([
      ['Receipt number', String(d.receiptNumber ?? '')],
      ['Amount paid', `${escape(d.currency)} ${escape(d.amount)}`],
      ['Payment method', String(d.method ?? '')],
      ['Date', String(d.paidAt ?? '')],
    ]) +
    (d.receiptUrl ? button('Download receipt', String(d.receiptUrl)) : ''),

  'attendance-absence': (d) =>
    heading('Absence notification') +
    paragraph(`Dear ${escape(d.guardianName)},`) +
    paragraph(
      `<strong>${escape(d.studentName)}</strong> was marked <strong style="color:${COLORS.danger};">${escape(d.status)}</strong> on ${escape(d.date)}.`,
    ) +
    paragraph(
      'If this is unexpected, please contact the class teacher or the school office.',
    ),

  'result-published': (d) =>
    heading('Examination results published') +
    paragraph(`Dear ${escape(d.recipientName)},`) +
    paragraph(
      `Results for <strong>${escape(d.examName)}</strong> are now available for ${escape(d.studentName)}.`,
    ) +
    button('View results', String(d.resultUrl)),

  notice: (d) =>
    heading(String(d.title ?? 'School notice')) +
    paragraph(String(d.body ?? '')) +
    (d.noticeUrl ? button('View notice', String(d.noticeUrl)) : ''),

  'leave-status': (d) =>
    heading(`Leave request ${escape(d.status)}`) +
    paragraph(`Dear ${escape(d.applicantName)},`) +
    paragraph(
      `Your leave request from ${escape(d.fromDate)} to ${escape(d.toDate)} has been <strong>${escape(d.status)}</strong>.`,
    ) +
    (d.remarks ? paragraph(`<em>Remarks: ${escape(d.remarks)}</em>`) : ''),

  generic: (d) => heading(String(d.title ?? '')) + paragraph(String(d.body ?? '')),
};

export function renderEmailTemplate(name: EmailTemplateName, data: TemplateData): string {
  const render = templates[name] ?? templates.generic;
  return layout(
    render(data),
    String(data.appName ?? 'School ERP'),
    Number(data.year ?? new Date().getFullYear()),
  );
}
