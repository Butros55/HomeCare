import { z } from 'zod';

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Höchstens ${max} Zeichen.`)
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value : undefined));

/** Dauerfelder kommen als Text ("20", "20,5", "8:00") und werden clientseitig geparst. */
const minutesField = z
  .number()
  .int()
  .min(0)
  .max(600_000)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

export const employeeFormSchema = z.object({
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
  lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value.toLowerCase() : undefined))
    .refine((value) => !value || z.email().safeParse(value).success, {
      message: 'Bitte eine gültige E-Mail-Adresse eingeben.',
    }),
  phone: optionalTrimmed(40),
  personnelNumber: optionalTrimmed(30),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'MINI_JOB', 'FREELANCE']).default('PART_TIME'),
  managerEmployeeId: optionalTrimmed(50),
  targetMinutesPerWeek: minutesField,
  targetMinutesPerMonth: minutesField,
  maximumMinutesPerDay: minutesField,
  canRecruitEmployees: z.boolean().default(false),
  canReceiveHours: z.boolean().default(true),
  notes: optionalTrimmed(2000),
});
export type EmployeeFormInput = z.input<typeof employeeFormSchema>;
export type EmployeeFormData = z.output<typeof employeeFormSchema>;

export const employeeListParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
  /** Nur Mitarbeiter mit fehlenden Zielstunden. */
  missingHours: z.enum(['1']).optional(),
  view: z.enum(['table', 'cards', 'hierarchy']).default('table'),
});
export type EmployeeListParams = z.infer<typeof employeeListParamsSchema>;

export const availabilitySlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM.'),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM.'),
  })
  .refine((slot) => slot.startTime < slot.endTime, {
    message: 'Ende muss nach dem Beginn liegen.',
  });

export const availabilityFormSchema = z.object({
  employeeId: z.string().min(1),
  slots: z.array(availabilitySlotSchema).max(40),
});
export type AvailabilityFormInput = z.infer<typeof availabilityFormSchema>;

export const absenceFormSchema = z
  .object({
    employeeId: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum wählen.'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum wählen.'),
    type: z.enum(['VACATION', 'SICK', 'TRAINING', 'OTHER']),
    note: optionalTrimmed(500),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'Das Ende darf nicht vor dem Beginn liegen.',
  });
export type AbsenceFormInput = z.input<typeof absenceFormSchema>;

export const inviteEmployeeSchema = z.object({
  employeeId: z.string().min(1),
  email: z
    .string()
    .trim()
    .min(1, 'E-Mail-Adresse ist erforderlich.')
    .pipe(z.email('Bitte eine gültige E-Mail-Adresse eingeben.'))
    .transform((value) => value.toLowerCase()),
  role: z.enum(['ADMIN', 'DISPATCHER', 'TEAM_MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
});
export type InviteEmployeeInput = z.input<typeof inviteEmployeeSchema>;
