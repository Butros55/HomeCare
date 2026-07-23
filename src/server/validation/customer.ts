import { z } from 'zod';

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Höchstens ${max} Zeichen.`)
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value : undefined));

/** Wochenzeitfenster der Kundenverfügbarkeit (keine Einträge = uneingeschränkt). */
export const customerAvailabilitySlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM.'),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM.'),
  })
  .refine((slot) => slot.startTime < slot.endTime, {
    message: 'Ende muss nach dem Beginn liegen.',
  });

const availabilityListSchema = z
  .array(customerAvailabilitySlotSchema)
  .max(40)
  .default([])
  .refine(
    (slots) => {
      // Fenster desselben Wochentags dürfen sich nicht überlappen.
      const byDay = new Map<number, { start: string; end: string }[]>();
      for (const slot of slots) {
        const list = byDay.get(slot.weekday) ?? [];
        if (list.some((other) => slot.startTime < other.end && other.start < slot.endTime)) {
          return false;
        }
        list.push({ start: slot.startTime, end: slot.endTime });
        byDay.set(slot.weekday, list);
      }
      return true;
    },
    { message: 'Zeitfenster desselben Wochentags dürfen sich nicht überlappen.' },
  );

export const customerFormSchema = z.object({
  salutation: optionalTrimmed(20),
  firstName: z.string().trim().min(1, 'Vorname ist erforderlich.').max(100),
  lastName: z.string().trim().min(1, 'Nachname ist erforderlich.').max(100),
  companyName: optionalTrimmed(150),
  customerNumber: optionalTrimmed(30),
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
  secondaryPhone: optionalTrimmed(40),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).default('ACTIVE'),
  preferredEmployeeId: optionalTrimmed(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Ungültige Farbe.')
    .default('#6c5ce7'),
  accessInstructions: optionalTrimmed(2000),
  cleaningInstructions: optionalTrimmed(2000),
  privateNotes: optionalTrimmed(2000),
  routeNotes: optionalTrimmed(500),
  /** Standarddauer neuer (vorgeschlagener) Einsätze in Minuten. */
  defaultAppointmentDurationMinutes: z
    .number()
    .int()
    .min(15, 'Mindestens 15 Minuten.')
    .max(600, 'Höchstens 10 Stunden.')
    .default(120),
  /** Verfügbarkeits-Zeitfenster (leer = alle Tage und Zeiten möglich). */
  availability: availabilityListSchema,
  address: z.object({
    street: z.string().trim().min(1, 'Straße ist erforderlich.').max(150),
    houseNumber: z.string().trim().min(1, 'Hausnummer ist erforderlich.').max(20),
    addressAddition: optionalTrimmed(100),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{4,5}$/, 'Bitte eine gültige Postleitzahl eingeben.'),
    city: z.string().trim().min(1, 'Ort ist erforderlich.').max(100),
    countryCode: z.string().trim().length(2, 'Ländercode (2 Buchstaben).').default('DE'),
  }),
  /**
   * Vom Geocoding-Auswahl-Dialog bestätigte Koordinate. Ohne Wert entscheidet
   * der Server: eindeutiger Treffer → übernehmen, mehrdeutig → GEOCODING_AMBIGUOUS.
   */
  confirmedCoordinate: z
    .object({ latitude: z.number(), longitude: z.number(), quality: z.string().max(30) })
    .optional(),
});

export type CustomerFormInput = z.input<typeof customerFormSchema>;
export type CustomerFormData = z.output<typeof customerFormSchema>;

export const customerListParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  city: z.string().trim().max(100).optional(),
  employeeId: z.string().trim().max(50).optional(),
  /** Nur Kunden mit offenen (nicht zugewiesenen) Stunden. */
  openHours: z.enum(['1']).optional(),
  sort: z.enum(['name', 'city', 'openMinutes', 'nextAppointment']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  view: z.enum(['table', 'cards']).default('table'),
});
export type CustomerListParams = z.infer<typeof customerListParamsSchema>;
