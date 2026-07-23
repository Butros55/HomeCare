'use client';

import { CalendarPlus, Repeat } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * „Termin anlegen“ auf der Kundendetailseite: öffnet das Terminformular im
 * Kalender, vorbefüllt mit dem Kunden (Einzeltermin oder Serie).
 */
export function CustomerAppointmentButtons({ customerId }: { customerId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <CalendarPlus aria-hidden /> Termin
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/calendar?neu=1&kunde=${customerId}`}>
            <CalendarPlus aria-hidden /> Einzeltermin anlegen
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/calendar?neu=1&kunde=${customerId}&serie=1`}>
            <Repeat aria-hidden /> Serientermin anlegen
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
