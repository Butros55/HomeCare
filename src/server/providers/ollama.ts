import 'server-only';

import { z } from 'zod';

/**
 * Ollama-Anbindung für Routen-Vorschläge (optional, ausfallsicher).
 *
 * Rolle der KI: Sie priorisiert bereits deterministisch geprüfte Vorschläge
 * und liefert kurze Begründungen – sie entscheidet NIEMALS über Machbarkeit
 * oder Zeiten. Fällt der Dienst aus (kein Schlüssel, Timeout, ungültige
 * Antwort), greift die regelbasierte Reihenfolge unverändert.
 *
 * Datenschutz: An die API gehen ausschließlich kurzlebige Kandidatenkürzel
 * ("K1", "K2", …) und numerische Kennzahlen – keine Namen, Adressen, Notizen,
 * Koordinaten oder Datenbank-IDs.
 *
 * Konfiguration (.env):
 *  - OLLAMA_API_KEY   (erforderlich, sonst bleibt die KI aus)
 *  - OLLAMA_BASE_URL  (optional, Standard https://ollama.com – Ollama Cloud)
 *  - OLLAMA_MODEL     (optional, Standard gpt-oss:20b)
 *  - OLLAMA_TIMEOUT_MS(optional, Standard 8000)
 */

export interface OllamaCandidateMetrics {
  /** Kurzlebiges Kürzel innerhalb einer Generierung, z. B. "K1". */
  key: string;
  extraTravelMinutes: number;
  extraDistanceKm: number;
  extraWaitMinutes: number;
  workdayDeltaMinutes: number;
  durationMinutes: number;
  openHours: number;
  /** Uhrzeit des vorgeschlagenen Beginns ("HH:mm"). */
  startTime: string;
  hasExistingAllocation: boolean;
  isPreferredEmployee: boolean;
}

export interface OllamaRankingEntry {
  key: string;
  /** 1 = höchste Priorität. */
  priority: number;
  reason: string;
}

const rankingSchema = z
  .object({
    ranking: z
      .array(
        z.object({
          key: z.string().min(1).max(10),
          priority: z.number().int().min(1).max(50),
          reason: z.string().min(1).max(240),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

export function isOllamaConfigured(): boolean {
  return Boolean(process.env.OLLAMA_API_KEY);
}

function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? 'https://ollama.com').replace(/\/+$/, '');
}

function timeoutMs(): number {
  const parsed = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 8000;
}

/** JSON aus einer Modellantwort extrahieren (Codefences/Fließtext tolerieren). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1]! : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Kandidaten durch Ollama priorisieren lassen. Gibt null zurück, wenn kein
 * Schlüssel konfiguriert ist oder die Antwort unbrauchbar ist – der Aufrufer
 * nutzt dann seine deterministische Reihenfolge.
 */
export async function rankSuggestionsWithOllama(
  candidates: OllamaCandidateMetrics[],
): Promise<OllamaRankingEntry[] | null> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey || candidates.length === 0) return null;

  const model = process.env.OLLAMA_MODEL ?? 'gpt-oss:20b';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  const system = [
    'Du priorisierst Terminvorschläge für die Tagesroutenplanung eines Haushaltshilfe-Dienstes.',
    'Alle Vorschläge sind bereits geprüft und machbar – du änderst keine Zeiten und erfindest keine Kandidaten.',
    'Bewerte: wenig zusätzliche Fahrzeit ist am wichtigsten, dann wenig Wartezeit, dann kurzer Arbeitstag.',
    'Bestehende Stundenzuweisung oder Wunschmitarbeiter (Flags) sind ein starkes Plus.',
    'Viele offene Stunden bei geringem Mehraufwand sprechen für einen Vorschlag.',
    'Antworte NUR mit JSON in exakt dieser Form:',
    '{"ranking":[{"key":"K1","priority":1,"reason":"kurze deutsche Begründung (max. 1 Satz)"}]}',
    'Jeder übergebene key muss genau einmal vorkommen.',
    'Die Kürzel (K1, K2, …) dürfen im reason-Text NICHT erwähnt werden – formuliere neutral („dieser Einsatz …“).',
  ].join('\n');

  try {
    const response = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ kandidaten: candidates }) },
        ],
        options: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[ollama] Antwort ${response.status} – nutze regelbasierte Reihenfolge.`);
      return null;
    }
    const data = (await response.json()) as { message?: { content?: string } };
    const content = data.message?.content;
    if (!content) return null;

    // Ollama Cloud liefert derzeit keine Structured Outputs – Antwort strikt prüfen.
    const parsed = rankingSchema.safeParse(extractJson(content));
    if (!parsed.success) {
      console.warn('[ollama] Unerwartetes Antwortformat – nutze regelbasierte Reihenfolge.');
      return null;
    }

    // Nur bekannte Kürzel übernehmen; erfundene Einträge verwerfen. Interne
    // Kürzel aus dem Begründungstext entfernen (dürfen Nutzern nie erscheinen).
    const known = new Set(candidates.map((c) => c.key));
    const seen = new Set<string>();
    const ranking = parsed.data.ranking
      .filter((entry) => {
        if (!known.has(entry.key) || seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      })
      .map((entry) => ({
        ...entry,
        reason: entry.reason.replace(/\bK\d+\b/g, 'dieser Einsatz').trim(),
      }));
    return ranking.length > 0 ? ranking : null;
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.warn('[ollama] Anfrage fehlgeschlagen – nutze regelbasierte Reihenfolge.', error);
    } else {
      console.warn('[ollama] Zeitüberschreitung – nutze regelbasierte Reihenfolge.');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
