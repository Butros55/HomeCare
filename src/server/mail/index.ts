import 'server-only';

/**
 * E-Mail-Adapter.
 *
 * Der Provider wird über die Umgebungsvariable MAIL_PROVIDER gewählt:
 *  - "console" (Standard): Links/Nachrichten landen im Server-Log (Entwicklung).
 *  - "resend":  Versand über die Resend-HTTP-API (RESEND_API_KEY, MAIL_FROM);
 *               benötigt keine zusätzliche Abhängigkeit (reiner fetch-Aufruf).
 *  - "smtp":    Versand über einen SMTP-Server (SMTP_HOST/PORT/USER/PASS,
 *               MAIL_FROM); lädt nodemailer dynamisch (muss installiert sein).
 *
 * Der Versand ist bewusst „best effort": Schlägt er fehl, wird der Fehler
 * protokolliert, aber nicht geworfen – Einladungen funktionieren weiter über den
 * anzeigbaren Link, und der Passwort-Reset bleibt (bewusst) rückmeldungsneutral.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    console.info(
      [
        '',
        '┌──────────────────────── E-Mail (console) ────────────────────────',
        `│ An:      ${message.to}`,
        `│ Betreff: ${message.subject}`,
        '│',
        ...message.text.split('\n').map((line) => `│ ${line}`),
        '└──────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

/** Resend HTTP-API (https://resend.com) – ohne zusätzliche Abhängigkeit. */
class ResendMailProvider implements MailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend-Versand fehlgeschlagen (${response.status}): ${detail}`);
    }
  }
}

/** SMTP-Versand über nodemailer (dynamisch geladen; Paket muss installiert sein). */
class SmtpMailProvider implements MailProvider {
  constructor(
    private readonly options: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
    },
  ) {}

  async send(message: MailMessage): Promise<void> {
    // Indirekter Specifier + lokaler Typ: nodemailer wird nicht zur Bauzeit
    // aufgelöst und ist nur bei aktivem SMTP-Provider erforderlich.
    const moduleName = 'nodemailer';
    const nodemailer = (await import(/* @vite-ignore */ moduleName).catch(() => {
      throw new Error('MAIL_PROVIDER=smtp benötigt das Paket "nodemailer" (npm i nodemailer).');
    })) as {
      createTransport: (options: unknown) => {
        sendMail: (message: unknown) => Promise<unknown>;
      };
    };
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth:
        this.options.user && this.options.pass
          ? { user: this.options.user, pass: this.options.pass }
          : undefined,
    });
    await transport.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

let provider: MailProvider | null = null;

/**
 * Provider anhand der Umgebung wählen (einmalig gecacht). Fehlt bei einem
 * konfigurierten Provider eine Pflichtangabe, wird auf den Konsolen-Adapter
 * zurückgefallen und gewarnt – so bleibt die Anwendung startfähig.
 */
export function getMailProvider(): MailProvider {
  if (provider) return provider;

  const kind = (process.env.MAIL_PROVIDER ?? 'console').toLowerCase();
  const from = process.env.MAIL_FROM ?? '';

  if (kind === 'resend') {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    if (apiKey && from) {
      provider = new ResendMailProvider(apiKey, from);
      return provider;
    }
    console.warn('[mail] MAIL_PROVIDER=resend, aber RESEND_API_KEY/MAIL_FROM fehlt – nutze Konsole.');
  } else if (kind === 'smtp') {
    const host = process.env.SMTP_HOST ?? '';
    if (host && from) {
      provider = new SmtpMailProvider({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
        user: process.env.SMTP_USER || undefined,
        pass: process.env.SMTP_PASS || undefined,
        from,
      });
      return provider;
    }
    console.warn('[mail] MAIL_PROVIDER=smtp, aber SMTP_HOST/MAIL_FROM fehlt – nutze Konsole.');
  }

  provider = new ConsoleMailProvider();
  return provider;
}

/**
 * Nachricht senden. Best effort: Provider-Fehler werden protokolliert, aber nicht
 * weitergeworfen, damit einladende/anfordernde Abläufe nicht daran scheitern.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  try {
    await getMailProvider().send(message);
  } catch (error) {
    console.error('[mail] Versand fehlgeschlagen:', error);
  }
}
