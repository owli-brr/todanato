import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const TZ = 'Asia/Manila';

export const peso = (n: number | string | null | undefined, decimals = 0) =>
  '₱' + Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-PH');

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: TZ }) : '—';

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';

export const toInputDate = (d: string | Date | null | undefined) => {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
};

export function relTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return 'just now';
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), 'minute');
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return fmt.format(-Math.round(diff / 86400), 'day');
  return fmtDate(d);
}

export const daysUntil = (d: string | Date | null | undefined) =>
  d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;

export const titleCase = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name: string) =>
  name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const LABELS: Record<string, string> = {
  DRIVERS_LICENSE: "Driver's license",
  GOVERNMENT_ID: 'Government ID',
  BARANGAY_CLEARANCE: 'Barangay clearance',
  NBI_CLEARANCE: 'NBI clearance',
  POLICE_CLEARANCE: 'Police clearance',
  MEDICAL_CERTIFICATE: 'Medical certificate',
  DRUG_TEST: 'Drug test result',
  MEMBERSHIP_FORM: 'Membership form',
  OFFICIAL_RECEIPT: 'LTO Official Receipt (OR)',
  CERTIFICATE_OF_REGISTRATION: 'LTO Certificate of Registration (CR)',
  FRANCHISE_MTOP: 'Franchise / MTOP',
  INSURANCE: 'Insurance (CTPL)',
  INSPECTION_CERTIFICATE: 'Inspection certificate',
  DEED_OF_SALE: 'Deed of sale',
  UNDER_MAINTENANCE: 'Under maintenance',
  DRIVER_OPERATOR: 'Driver-operator',
  VICE_PRESIDENT: 'Vice President',
  PRO: 'P.R.O.',
  BOARD_MEMBER: 'Board member',
  DAILY_CONTRIBUTION: 'Daily contribution',
  MONTHLY_DUES: 'Monthly dues',
  MEMBERSHIP_FEE: 'Membership fee',
  GCASH: 'GCash',
  MAYA: 'Maya',
  PASSENGER_PICKED_UP: 'Picked up',
  DRIVER_ARRIVING: 'Driver arriving',
  DRIVER_ASSIGNED: 'Driver assigned',
  IN_TRANSIT: 'In transit',
  ON_TRIP: 'On trip',
};
export const label = (k: string | null | undefined) => (k ? LABELS[k] ?? titleCase(k) : '—');
