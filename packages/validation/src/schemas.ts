import { z } from 'zod';

/**
 * Form schemas shared between the web app and the API's expectations.
 *
 * These mirror the server DTOs so a form catches what the server would reject
 * before a round trip. The server still validates everything — this is for the
 * user's benefit, never a substitute for the backend check.
 */

const PHONE = /^\+?[0-9]{10,15}$/;

export const phoneSchema = z
  .string()
  .trim()
  .regex(PHONE, 'Enter a valid phone number');

export const optionalPhone = z
  .union([z.literal(''), phoneSchema])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address');

export const optionalEmail = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/** `yyyy-MM-dd`, the format every date field on the API accepts. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a real date');

export const optionalDate = z
  .union([z.literal(''), dateSchema])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');

export const uuidSchema = z.string().uuid('Select a valid option');

export const optionalUuid = z
  .union([z.literal(''), uuidSchema])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const moneySchema = z
  .coerce.number({ invalid_type_error: 'Enter an amount' })
  .min(0, 'Cannot be negative')
  .max(100_000_000, 'That amount looks wrong');

// --- Authentication --------------------------------------------------------

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or phone number'),
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The password rule the API enforces. Kept in one place so the strength meter,
 * the change-password form and the reset form cannot drift apart.
 */
export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128, 'At most 128 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here before',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or phone number'),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

// --- Students --------------------------------------------------------------

export const studentSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  dateOfBirth: dateSchema,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  bloodGroup: z
    .enum([
      'A_POSITIVE',
      'A_NEGATIVE',
      'B_POSITIVE',
      'B_NEGATIVE',
      'AB_POSITIVE',
      'AB_NEGATIVE',
      'O_POSITIVE',
      'O_NEGATIVE',
      'UNKNOWN',
    ])
    .optional(),
  admissionDate: dateSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  rollNumber: z.string().trim().max(20).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  addressLine1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(12).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: optionalPhone,
  medicalConditions: z.string().trim().max(1000).optional(),
  previousSchool: z.string().trim().max(200).optional(),
});
export type StudentInput = z.infer<typeof studentSchema>;

export const guardianSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: z.string().trim().max(80).optional(),
  relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER']),
  phone: phoneSchema,
  email: optionalEmail,
  occupation: z.string().trim().max(120).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  isPrimary: z.boolean().optional(),
});
export type GuardianInput = z.infer<typeof guardianSchema>;

// --- Attendance ------------------------------------------------------------

export const markAttendanceSchema = z.object({
  date: dateSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  entries: z
    .array(
      z.object({
        studentId: uuidSchema,
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'EXCUSED']),
        remarks: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, 'Mark at least one student'),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

// --- Fees ------------------------------------------------------------------

export const collectPaymentSchema = z.object({
  studentId: uuidSchema,
  amount: moneySchema.refine((value) => value > 0, 'Enter an amount greater than zero'),
  method: z.enum([
    'CASH',
    'UPI',
    'CARD',
    'NET_BANKING',
    'CHEQUE',
    'BANK_TRANSFER',
    'ONLINE_GATEWAY',
  ]),
  referenceNumber: z.string().trim().max(60).optional(),
  bankName: z.string().trim().max(80).optional(),
  chequeNumber: z.string().trim().max(40).optional(),
  chequeDate: optionalDate,
  invoiceIds: z.array(uuidSchema).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;

// --- Communication ---------------------------------------------------------

export const noticeSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  body: z.string().trim().min(1, 'Write the notice').max(10_000),
  audience: z.enum(['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF', 'CLASS', 'SECTION']),
  priority: z.enum(['LOW', 'NORMAL', 'IMPORTANT', 'URGENT']).optional(),
  classId: optionalUuid,
  sectionId: optionalUuid,
  publishAt: z.string().optional(),
  expiresAt: z.string().optional(),
  isPinned: z.boolean().optional(),
});
export type NoticeInput = z.infer<typeof noticeSchema>;

// --- Library ---------------------------------------------------------------

export const bookSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(250),
  author: z.string().trim().min(1, 'Enter an author').max(150),
  isbn: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .transform((value) => value.replace(/[\s-]/g, ''))
        .refine((value) => /^(\d{9}[\dX]|\d{13})$/.test(value), 'Enter a valid 10 or 13 digit ISBN'),
    ])
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  publisher: z.string().trim().max(150).optional(),
  categoryId: optionalUuid,
  rackLocation: z.string().trim().max(40).optional(),
  price: moneySchema.optional(),
  copies: z.coerce.number().int().min(1, 'At least one copy').max(500),
});
export type BookInput = z.infer<typeof bookSchema>;

// --- Inventory -------------------------------------------------------------

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter an item name').max(150),
  code: z.string().trim().min(1, 'Enter a code').max(40),
  categoryId: optionalUuid,
  unit: z.string().trim().max(10).optional(),
  reorderLevel: z.coerce.number().min(0).max(1_000_000).optional(),
  unitCost: moneySchema.optional(),
  location: z.string().trim().max(120).optional(),
  openingQuantity: z.coerce.number().min(0).max(1_000_000).optional(),
});
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

export const stockMovementSchema = z.object({
  quantity: z.coerce
    .number({ invalid_type_error: 'Enter a quantity' })
    .positive('Enter a quantity greater than zero')
    .max(1_000_000),
  unitCost: moneySchema.optional(),
  reference: z.string().trim().max(60).optional(),
  issuedToType: z.enum(['STAFF', 'STUDENT', 'CLASS', 'DEPARTMENT']).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

// --- Transport -------------------------------------------------------------

export const vehicleSchema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .min(1, 'Enter a registration number')
    .max(20)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1, 'Enter the seat count').max(100),
  trackingEnabled: z.boolean().optional(),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

// --- Leave -----------------------------------------------------------------

export const leaveRequestSchema = z
  .object({
    leaveTypeId: optionalUuid,
    fromDate: dateSchema,
    toDate: dateSchema,
    reason: z.string().trim().min(5, 'Give a reason').max(1000),
    isHalfDay: z.boolean().optional(),
  })
  .refine((value) => value.toDate >= value.fromDate, {
    path: ['toDate'],
    message: 'The end date cannot be before the start date',
  });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
