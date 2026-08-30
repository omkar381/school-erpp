import type { AdmissionEnquiry } from '@prisma/client';

/** The enquiry row as stored, before any derived fields are added. */
export type AdmissionEnquiryRecord = AdmissionEnquiry;

/** Entity name used for every admissions audit-log entry. */
export const AdmissionAuditEntity = 'AdmissionEnquiry';
