'use client';

import * as React from 'react';

import { FieldError, FieldHint, Input } from '@/components/ui/input';
import { formatMinutesAsHours, parseDurationInput } from '@/lib/duration';

/**
 * Dauer-Eingabefeld: Nutzer tippen „20“, „2,5“, „2:30“ oder „150 Minuten“;
 * gespeichert werden ganzzahlige Minuten. Zeigt die Interpretation live an.
 *
 * Der Text-State wird einmalig aus `value` initialisiert. Soll das Feld von
 * außen zurückgesetzt werden, von der Elternkomponente ein anderes `key`
 * vergeben (Standard-React-Muster für Reset).
 */
export function DurationInput({
  id,
  value,
  onChange,
  placeholder = 'z. B. „20“ oder „20:30“',
  allowEmpty = true,
  invalid,
}: {
  id?: string;
  /** Minuten oder null (leer). */
  value: number | null;
  onChange: (minutes: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = React.useState<string>(() =>
    value != null ? formatMinutesAsHours(value).replace(' h', '') : '',
  );
  const [touched, setTouched] = React.useState(false);

  const parsed = parseDurationInput(text);
  const showError = touched && text.trim() !== '' && !parsed.ok;

  return (
    <div>
      <Input
        id={id}
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        invalid={invalid || showError}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const result = parseDurationInput(next);
          if (result.ok) onChange(result.minutes);
          else if (next.trim() === '' && allowEmpty) onChange(null);
        }}
        onBlur={() => setTouched(true)}
        autoComplete="off"
      />
      {showError ? (
        <FieldError>Eingabe nicht erkannt – z. B. „2,5“, „2:30“ oder „150 Minuten“.</FieldError>
      ) : parsed.ok && text.trim() !== '' ? (
        <FieldHint>= {parsed.minutes} Minuten ({formatMinutesAsHours(parsed.minutes)})</FieldHint>
      ) : null}
    </div>
  );
}
