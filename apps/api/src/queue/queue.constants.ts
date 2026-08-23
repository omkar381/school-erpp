export const QUEUES = {
  NOTIFICATIONS: 'notifications',
  EMAIL: 'email',
  SMS: 'sms',
  PDF: 'pdf',
  IMPORT: 'import',
  EXPORT: 'export',
  REPORTS: 'reports',
  PAYMENTS: 'payments',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  // notifications
  DISPATCH_NOTIFICATION: 'dispatch-notification',
  ABSENCE_ALERT: 'absence-alert',
  PUBLISH_NOTICE: 'publish-notice',

  // email / sms
  SEND_EMAIL: 'send-email',
  SEND_BULK_EMAIL: 'send-bulk-email',
  SEND_SMS: 'send-sms',

  // documents
  GENERATE_INVOICE_PDF: 'generate-invoice-pdf',
  GENERATE_RECEIPT_PDF: 'generate-receipt-pdf',
  GENERATE_REPORT_CARD: 'generate-report-card',
  GENERATE_REPORT_CARD_BATCH: 'generate-report-card-batch',
  GENERATE_ID_CARD_BATCH: 'generate-id-card-batch',
  GENERATE_CERTIFICATE: 'generate-certificate',

  // data movement
  IMPORT_STUDENTS: 'import-students',
  IMPORT_STAFF: 'import-staff',
  EXPORT_DATASET: 'export-dataset',
  BUILD_REPORT: 'build-report',

  // finance
  GENERATE_INVOICES: 'generate-invoices',
  FEE_REMINDERS: 'fee-reminders',
  APPLY_LATE_FEES: 'apply-late-fees',
  RECONCILE_PAYMENTS: 'reconcile-payments',

  // maintenance
  PRUNE_SESSIONS: 'prune-sessions',
  PRUNE_NOTIFICATIONS: 'prune-notifications',
  PRUNE_VEHICLE_POSITIONS: 'prune-vehicle-positions',
  LIBRARY_OVERDUE_SCAN: 'library-overdue-scan',
  DOCUMENT_EXPIRY_SCAN: 'document-expiry-scan',
  SUBSCRIPTION_EXPIRY_SCAN: 'subscription-expiry-scan',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400 * 7 },
};
