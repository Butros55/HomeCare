'use client';

import { Check, Copy, Mail, MapPin, Navigation, Phone } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { googleMapsDirectionsUrl, googleMapsSearchUrl } from '@/lib/geo';

/** Klickbare Kontaktaktionen: Anrufen, E-Mail, Adresse kopieren, Navigation. */
export function ContactActions({
  phone,
  secondaryPhone,
  email,
  addressLine,
  latitude,
  longitude,
}: {
  phone?: string | null;
  secondaryPhone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const [copied, setCopied] = React.useState(false);

  const copyAddress = async () => {
    if (!addressLine) return;
    try {
      await navigator.clipboard.writeText(addressLine);
      setCopied(true);
      toast.success('Adresse kopiert.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopieren nicht möglich.');
    }
  };

  const navTarget =
    latitude != null && longitude != null ? { latitude, longitude } : (addressLine ?? '');

  return (
    <div className="flex flex-wrap gap-2">
      {phone ? (
        <Button asChild variant="secondary" size="sm">
          <a href={`tel:${phone.replace(/\s/g, '')}`}>
            <Phone aria-hidden /> Anrufen
          </a>
        </Button>
      ) : null}
      {secondaryPhone ? (
        <Button asChild variant="secondary" size="sm">
          <a href={`tel:${secondaryPhone.replace(/\s/g, '')}`}>
            <Phone aria-hidden /> 2. Nummer
          </a>
        </Button>
      ) : null}
      {email ? (
        <Button asChild variant="secondary" size="sm">
          <a href={`mailto:${email}`}>
            <Mail aria-hidden /> E-Mail
          </a>
        </Button>
      ) : null}
      {addressLine ? (
        <>
          <Button variant="secondary" size="sm" onClick={copyAddress}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} Adresse kopieren
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={googleMapsSearchUrl(navTarget)} target="_blank" rel="noreferrer">
              <MapPin aria-hidden /> In Google Maps öffnen
            </a>
          </Button>
          <Button asChild variant="primary" size="sm">
            <a href={googleMapsDirectionsUrl(navTarget)} target="_blank" rel="noreferrer">
              <Navigation aria-hidden /> Route starten
            </a>
          </Button>
        </>
      ) : null}
    </div>
  );
}
