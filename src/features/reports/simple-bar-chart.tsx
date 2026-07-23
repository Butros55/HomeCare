/**
 * Schlanke, abhängigkeitsfreie Balkendiagramme (Anforderung 20: „einfache
 * Diagramme“). Serverseitig gerendert, responsiv, mit zugänglichen Labels.
 */
export function SimpleBarChart({
  items,
  unit,
  legend,
}: {
  items: { label: string; value: number; secondaryValue?: number }[];
  unit: string;
  legend?: { primary: string; secondary?: string };
}) {
  if (items.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
        Keine Daten im gewählten Zeitraum.
      </p>
    );
  }
  const max = Math.max(...items.map((item) => Math.max(item.value, item.secondaryValue ?? 0)), 1);

  return (
    <div>
      {legend ? (
        <div className="mb-3 flex gap-4 text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[var(--color-brand)]" aria-hidden /> {legend.primary}
          </span>
          {legend.secondary ? (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[var(--color-line-strong)]" aria-hidden />{' '}
              {legend.secondary}
            </span>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                {item.label}
              </span>
              <span className="tabular shrink-0 text-[length:var(--text-xs)] font-semibold">
                {item.value.toLocaleString('de-DE')}
                {unit ? ` ${unit}` : ''}
                {item.secondaryValue != null
                  ? ` / ${item.secondaryValue.toLocaleString('de-DE')}${unit ? ` ${unit}` : ''}`
                  : ''}
              </span>
            </div>
            <div
              className="relative h-2.5 overflow-hidden rounded-full bg-[var(--color-panel-sunken)]"
              role="img"
              aria-label={`${item.label}: ${item.value}${unit ? ` ${unit}` : ''}`}
            >
              {item.secondaryValue != null ? (
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-line-strong)]"
                  style={{ width: `${(item.secondaryValue / max) * 100}%` }}
                />
              ) : null}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-brand)]"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
