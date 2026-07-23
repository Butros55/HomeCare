import 'server-only';

/**
 * E-Mail-Adapter.
 *
 * Im MVP existiert nur der Konsolen-Adapter (Entwicklung): Einladungs- und
 * Passwort-Reset-Links werden in das Server-Log geschrieben. Das Interface
 * ist bewusst schmal, damit SMTP-/API-Provider später als weitere Adapter
 * ergänzt werden können, ohne Aufrufstellen zu ändern (docs/architecture.md).
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

let provider: MailProvider | null = null;

export function getMailProvider(): MailProvider {
  if (!provider) {
    // MAIL_PROVIDER: aktuell nur "console"; weitere Werte sind vorbereitet.
    provider = new ConsoleMailProvider();
  }
  return provider;
}

export async function sendMail(message: MailMessage): Promise<void> {
  await getMailProvider().send(message);
}
