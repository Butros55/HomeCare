'use client';

import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { parseCsv } from '@/lib/csv';
import { importCustomersAction } from '@/server/actions/customer-actions';
import type { CustomerImportResult } from '@/server/services/customer-service';

import {
  CUSTOMER_CSV_COLUMNS,
  customerCsvTemplateRows,
  matchCsvHeaders,
} from './csv-schema';

/** Export-Link + Import-Dialog für die Kundenliste. */
export function CustomerCsvActions({ canManage }: { canManage: boolean }) {
  return (
    <>
      <Button asChild variant="secondary">
        <a href="/api/customers/export" download>
          <Download aria-hidden /> CSV-Export
        </a>
      </Button>
      {canManage ? <CustomerImportDialog /> : null}
    </>
  );
}

type Preview = {
  fileName: string;
  csvText: string;
  rowCount: number;
  recognized: number;
  unknown: string[];
  missingRequired: string[];
};

function CustomerImportDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [updateExisting, setUpdateExisting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CustomerImportResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setUpdateExisting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const readFile = (file: File) => {
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const csvText = String(reader.result ?? '');
      const parsed = parseCsv(csvText);
      const { mapping, unknown, missingRequired } = matchCsvHeaders(parsed.header);
      setPreview({
        fileName: file.name,
        csvText,
        rowCount: parsed.records.length,
        recognized: mapping.filter(Boolean).length,
        unknown,
        missingRequired,
      });
    };
    reader.onerror = () => setError('Die Datei konnte nicht gelesen werden.');
    reader.readAsText(file, 'utf-8');
  };

  const downloadTemplate = () => {
    const csv = `﻿${customerCsvTemplateRows()
      .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kunden-import-vorlage.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const submit = () => {
    if (!preview) return;
    startTransition(async () => {
      const response = await importCustomersAction({
        csvText: preview.csvText,
        updateExisting,
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResult(response.data);
      router.refresh();
    });
  };

  const canImport = preview !== null && preview.rowCount > 0 && preview.missingRequired.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" data-tour="customers-import-button">
          <Upload aria-hidden /> CSV-Import
        </Button>
      </DialogTrigger>
      <DialogContent
        wide
        title="Kunden aus CSV importieren"
        description="Alle Kunden auf einmal anlegen – z. B. beim Umstieg aus Excel oder einem anderen System."
      >
        {result ? (
          <ImportResultView result={result} onReset={reset} onClose={() => setOpen(false)} />
        ) : (
          <div className="space-y-4">
            {/* Dateiauswahl */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) readFile(file);
              }}
              className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-line)] bg-[var(--color-panel-sunken)] px-4 py-7 text-center transition-colors hover:border-[var(--color-brand)]"
            >
              <FileSpreadsheet className="size-7 text-[var(--color-ink-subtle)]" aria-hidden />
              {preview ? (
                <span className="text-[length:var(--text-sm)] font-medium">{preview.fileName}</span>
              ) : (
                <>
                  <span className="text-[length:var(--text-sm)] font-medium">
                    CSV-Datei auswählen oder hierher ziehen
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
                    Semikolon oder Komma, UTF-8 (Excel-Export funktioniert direkt)
                  </span>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="CSV-Datei wählen"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
            />

            {/* Vorschau der erkannten Struktur */}
            {preview ? (
              <div className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3.5 py-3 text-[length:var(--text-sm)]">
                <p>
                  <strong>{preview.rowCount}</strong>{' '}
                  {preview.rowCount === 1 ? 'Datenzeile' : 'Datenzeilen'} ·{' '}
                  <strong>{preview.recognized}</strong> von {CUSTOMER_CSV_COLUMNS.length} Spalten
                  erkannt
                </p>
                {preview.missingRequired.length > 0 ? (
                  <p className="text-[var(--color-danger)]">
                    Pflichtspalten fehlen: {preview.missingRequired.join(', ')}
                  </p>
                ) : null}
                {preview.unknown.length > 0 ? (
                  <p className="text-[var(--color-ink-muted)]">
                    Ignoriert: {preview.unknown.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <label className="flex items-start gap-2.5 text-[length:var(--text-sm)]">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              <span>
                Bestehende Kunden aktualisieren
                <span className="block text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                  Zeilen mit bereits vergebener Kundennummer überschreiben den Kunden – sonst werden
                  sie übersprungen.
                </span>
              </span>
            </label>

            <FormAlert>{error}</FormAlert>

            {/* Spalten-Schema aufklappbar */}
            <details className="rounded-[var(--radius-md)] border border-[var(--color-line-subtle)]">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[length:var(--text-sm)] font-medium">
                Welche Spalten versteht der Import?
              </summary>
              <div className="max-h-56 overflow-y-auto border-t border-[var(--color-line-subtle)] px-3.5 py-2">
                <table className="w-full text-[length:var(--text-xs)]">
                  <tbody>
                    {CUSTOMER_CSV_COLUMNS.map((column) => (
                      <tr key={column.key} className="align-top">
                        <td className="w-44 py-1 pr-3 font-medium whitespace-nowrap">
                          {column.label}
                          {column.required ? (
                            <span className="text-[var(--color-danger)]"> *</span>
                          ) : null}
                        </td>
                        <td className="py-1 text-[var(--color-ink-muted)]">{column.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <DialogFooter>
              <Button variant="ghost" onClick={downloadTemplate}>
                <Download aria-hidden /> Vorlage herunterladen
              </Button>
              <Button variant="primary" onClick={submit} disabled={!canImport} loading={pending}>
                {preview ? `${preview.rowCount} ${preview.rowCount === 1 ? 'Zeile' : 'Zeilen'} importieren` : 'Importieren'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportResultView({
  result,
  onReset,
  onClose,
}: {
  result: CustomerImportResult;
  onReset: () => void;
  onClose: () => void;
}) {
  const counters = [
    { label: 'Neu angelegt', value: result.created, tone: 'var(--color-success)' },
    { label: 'Aktualisiert', value: result.updated, tone: 'var(--color-brand)' },
    { label: 'Übersprungen', value: result.skipped, tone: 'var(--color-ink-muted)' },
    { label: 'Fehler', value: result.errors.length, tone: result.errors.length > 0 ? 'var(--color-danger)' : 'var(--color-ink-muted)' },
  ];
  return (
    <div className="space-y-4">
      <FormAlert tone={result.errors.length === 0 ? 'success' : 'error'}>
        {result.errors.length === 0
          ? 'Import abgeschlossen – alle Zeilen wurden verarbeitet.'
          : `Import abgeschlossen – ${result.errors.length} ${result.errors.length === 1 ? 'Zeile konnte' : 'Zeilen konnten'} nicht übernommen werden.`}
      </FormAlert>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counters.map((counter) => (
          <div
            key={counter.label}
            className="rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5 text-center"
          >
            <p className="text-[length:var(--text-xl)] font-semibold" style={{ color: counter.tone }}>
              {counter.value}
            </p>
            <p className="text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">{counter.label}</p>
          </div>
        ))}
      </div>

      {result.errors.length > 0 || result.warnings.length > 0 ? (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-line-subtle)] px-3.5 py-2.5 text-[length:var(--text-xs)]">
          {result.errors.map((issue, index) => (
            <p key={`e-${index}`} className="text-[var(--color-danger)]">
              Zeile {issue.line}: {issue.message}
            </p>
          ))}
          {result.warnings.map((issue, index) => (
            <p key={`w-${index}`} className="text-[var(--color-warning,#b45309)]">
              Zeile {issue.line}: {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onReset}>
          Weitere Datei importieren
        </Button>
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      </DialogFooter>
    </div>
  );
}
