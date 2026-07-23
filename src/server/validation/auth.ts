import { z } from 'zod';

/**
 * Auth-Schemas – identisch für Client-Formulare (react-hook-form) und
 * Server-Validierung (Actions). Meldungen deutsch.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'E-Mail-Adresse ist erforderlich.')
  .max(254, 'E-Mail-Adresse ist zu lang.')
  .pipe(z.email('Bitte eine gültige E-Mail-Adresse eingeben.'))
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Das Passwort braucht mindestens 8 Zeichen.')
  .max(128, 'Das Passwort ist zu lang.')
  .refine(
    (value) => /[a-zäöüß]/i.test(value) && /\d/.test(value),
    'Das Passwort braucht mindestens einen Buchstaben und eine Ziffer.',
  );

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Pflichtfeld.')
  .max(100, 'Höchstens 100 Zeichen.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Passwort ist erforderlich.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, 'Der Organisationsname braucht mindestens 2 Zeichen.')
    .max(120, 'Höchstens 120 Zeichen.'),
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** 'solo' = organisiert (noch) nur sich selbst; 'team' = hat bereits Mitarbeiter. */
  startMode: z.enum(['solo', 'team']).default('solo'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(200),
  firstName: nameSchema,
  lastName: nameSchema,
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Aktuelles Passwort ist erforderlich.').max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phone: z.string().trim().max(40, 'Höchstens 40 Zeichen.').optional().or(z.literal('')),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
