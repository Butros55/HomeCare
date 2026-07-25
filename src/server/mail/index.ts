import 'server-only';

/**
 * E-Mail-Adapter.
 *
 * Der Provider wird über die Umgebungsvariable MAIL_PROVIDER gewählt:
 *  - "console" (Standard): Links/Nachrichten landen im Server-Log (Entwicklung).
 *  - "resend":  Versand über die Resend-HTTP-API (RESEND_API_KEY, MAIL_FROM);
 *               benötigt keine zusätzliche Abhängigkeit (reiner fetch-Aufruf).
 *
 * Der Versand ist bewusst „best effort": Schlägt er fehl, wird der Fehler
 * protokolliert, aber nicht geworfen – Einladungen funktionieren weiter über den
 * anzeigbaren Link, und der Passwort-Reset bleibt (bewusst) rückmeldungsneutral.
 *
 * Weitere Provider (z. B. SMTP) lassen sich als eigener MailProvider ergänzen;
 * die Aufrufstellen ändern sich dadurch nicht.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  /** Versendet die Nachricht wirklich (true) oder protokolliert sie nur (false, Konsole)? */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailProvider implements MailProvider {
  readonly delivers = false;

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
  readonly delivers = true;

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

let provider: MailProvider | null = null;

/**
 * Provider anhand der Umgebung wählen (einmalig gecacht). Fehlt bei einem
 * konfigurierten Provider eine Pflichtangabe, wird auf den Konsolen-Adapter
 * zurückgefallen und gewarnt – so bleibt die Anwendung startfähig.
 */
export function getMailProvider(): MailProvider {
  if (provider) return provider;

  const kind = (process.env.MAIL_PROVIDER ?? 'console').toLowerCase();

  if (kind === 'resend') {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    const from = process.env.MAIL_FROM ?? '';
    if (apiKey && from) {
      provider = new ResendMailProvider(apiKey, from);
      return provider;
    }
    console.warn('[mail] MAIL_PROVIDER=resend, aber RESEND_API_KEY/MAIL_FROM fehlt – nutze Konsole.');
  }

  provider = new ConsoleMailProvider();
  return provider;
}

/**
 * Ist ein echter (versendender) Mail-Provider konfiguriert? Der Konsolen-Adapter
 * protokolliert nur und gilt hier als „nicht konfiguriert". So können Aufrufer
 * wahrheitsgemäße Rückmeldungen geben (E-Mail versendet vs. Link kopieren).
 */
export function isMailConfigured(): boolean {
  return getMailProvider().delivers;
}

/**
 * Nachricht senden. Best effort: Provider-Fehler werden protokolliert, aber nicht
 * weitergeworfen, damit einladende/anfordernde Abläufe nicht daran scheitern.
 *
 * Rückgabe `delivered`: true nur, wenn ein echter Provider die Nachricht ohne
 * Fehler übernommen hat – bei Konsole (nur Log) oder Versandfehler false. Damit
 * lässt sich in der Oberfläche zwischen „versendet", „nicht konfiguriert" und
 * „Versand fehlgeschlagen" unterscheiden.
 */
export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  const mailProvider = getMailProvider();
  try {
    await mailProvider.send(message);
    return { delivered: mailProvider.delivers };
  } catch (error) {
    console.error('[mail] Versand fehlgeschlagen:', error);
    return { delivered: false };
  }
}
