import type { Flight } from './types';

export const FLIGHT_DATA_PERIOD = {
  start: '2026-09-01',
  end: '2026-10-24',
} as const;

export const FLIGHT_DATA_PERIOD_LABEL = '2026年9月1日至10月24日';

export const RESTRICTED_PERIODS_666 = [
  {
    start: '2026-09-30',
    end: '2026-10-09',
    label: '2026年9月30日至10月9日',
  },
] as const;

export function getFlightDataPeriod(flights: Flight[]): { start: string; end: string } {
  const compareDates = (a: string, b: string) => a.localeCompare(b);
  const starts = flights.map((flight) => flight.valid_from).filter((date): date is string => Boolean(date)).sort(compareDates);
  const ends = flights.map((flight) => flight.valid_to).filter((date): date is string => Boolean(date)).sort(compareDates);
  if (starts.length === 0 || ends.length === 0) return FLIGHT_DATA_PERIOD;
  return { start: starts[0], end: ends[ends.length - 1] };
}

export function isWithinFlightDataPeriod(
  date: string,
  period: { start: string; end: string } = FLIGHT_DATA_PERIOD,
): boolean {
  return date >= period.start && date <= period.end;
}
