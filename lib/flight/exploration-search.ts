import {
  CONSTRAINTS,
  DestinationItinerary,
  DestinationSearchParams,
  Flight,
  Route,
  Segment,
} from './types';
import { isInTimeWindow, isProductAvailable, minutesToTime, calculateDuration } from './utils';
import { FLIGHT_DATA_PERIOD, RESTRICTED_PERIODS_666, getFlightDataPeriod, isWithinFlightDataPeriod } from './data-period';

export type RouteSearch = (
  originCity: string,
  destinationCity: string,
  date: string,
  windows: ('early' | 'late')[],
  version: '666' | '2666',
) => Route[];

export interface ExplorationResult {
  itineraries: DestinationItinerary[];
  requestedDates: string[];
  uncoveredDates: string[];
  dataPeriod: { start: string; end: string };
  restriction?: string;
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addCalendarDays(date: string, days: number): string {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayOffset(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

function weekday(date: string): number {
  return utcDate(date).getUTCDay();
}

function isDateRestricted(date: string, version: '666' | '2666'): boolean {
  return version === '666' && RESTRICTED_PERIODS_666.some((period) => date >= period.start && date <= period.end);
}

function isAvailableOnDate(flight: Flight, date: string): boolean {
  if (flight.operating_dates?.length && !flight.operating_dates.includes(date)) return false;
  if (flight.valid_from && date < flight.valid_from) return false;
  if (flight.valid_to && date > flight.valid_to) return false;
  const dow = weekday(date);
  const bitIndex = dow === 0 ? 6 : dow - 1;
  return (flight.dow_bitmap & (1 << bitIndex)) !== 0;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const totalDays = dayOffset(start, end);
  for (let offset = 0; offset <= totalDays; offset++) dates.push(addCalendarDays(start, offset));
  return dates;
}

function getWeekendDates(start: string, count: number): Array<{
  weekendStart: string;
  outboundDates: string[];
  returnDates: string[];
}> {
  const weekends: Array<{ weekendStart: string; outboundDates: string[]; returnDates: string[] }> = [];
  let firstFriday = start;
  if (weekday(start) === 6) {
    firstFriday = addCalendarDays(start, -1);
  } else {
    while (weekday(firstFriday) !== 5) firstFriday = addCalendarDays(firstFriday, 1);
  }
  for (let index = 0; index < count; index++) {
    const friday = addCalendarDays(firstFriday, index * 7);
    weekends.push({
      weekendStart: friday,
      outboundDates: [friday, addCalendarDays(friday, 1)],
      returnDates: [addCalendarDays(friday, 2), addCalendarDays(friday, 3)],
    });
  }
  return weekends;
}

function eligibleFlight(
  flight: Flight,
  date: string,
  params: DestinationSearchParams,
  dataPeriod: { start: string; end: string },
): boolean {
  return isWithinFlightDataPeriod(date, dataPeriod) &&
    !isDateRestricted(date, params.version) &&
    isAvailableOnDate(flight, date) &&
    isProductAvailable(flight.product, params.version) &&
    isInTimeWindow(flight.dep_minutes, params.windows, params.version);
}

function absoluteDateTime(baseDate: string, absoluteMinutes: number): string {
  const offset = Math.floor(absoluteMinutes / 1440);
  const minutes = ((absoluteMinutes % 1440) + 1440) % 1440;
  return `${addCalendarDays(baseDate, offset)} ${minutesToTime(minutes)}`;
}

function routeForFlight(flight: Flight, date: string, baseDate: string): Route {
  const departureAbsolute = dayOffset(baseDate, date) * 1440 + flight.dep_minutes;
  const duration = calculateDuration(flight.dep_minutes, flight.arr_minutes, flight.overnight);
  const arrivalAbsolute = departureAbsolute + duration;
  const departureTime = absoluteDateTime(baseDate, departureAbsolute);
  const arrivalTime = absoluteDateTime(baseDate, arrivalAbsolute);
  const arrivalDayOffset = Math.floor(arrivalAbsolute / 1440);
  const segment: Segment = {
    carrier_name: flight.carrier_name,
    flight_no: flight.flight_no,
    origin_city: flight.origin_city,
    origin_airport: flight.origin_airport,
    origin_iata_code: flight.origin_iata_code,
    origin_province: flight.origin_province,
    dest_city: flight.dest_city,
    dest_airport: flight.dest_airport,
    dest_iata_code: flight.dest_iata_code,
    dest_province: flight.dest_province,
    dep_time: departureTime,
    arr_time: arrivalTime,
    plus_day: dayOffset(baseDate, date),
    product: flight.product,
  };

  return {
    stops: 0,
    segments: [segment],
    connect_cities: [],
    arrive_time: `${arrivalTime.slice(11)}${arrivalDayOffset > 0 ? ` (+${arrivalDayOffset})` : ''}`,
    total_duration_mins: duration,
  };
}

function flightIdentity(flight: Flight): string {
  return [
    flight.carrier_name,
    flight.flight_no,
    flight.origin_iata_code,
    flight.dest_iata_code,
    flight.dep_minutes,
    flight.arr_minutes,
    flight.product ?? '',
  ].join('|');
}

function is666Flight(flight: Flight, date: string): boolean {
  return !isDateRestricted(date, '666') &&
    isProductAvailable(flight.product, '666') &&
    isInTimeWindow(flight.dep_minutes, ['early', 'late'], '666');
}

function departureConvenience(item: DestinationItinerary): number {
  const flight = item.outbound.segments[0];
  const [hour, minute] = flight.dep_time.slice(11).split(':').map(Number);
  const minutes = hour * 60 + minute;
  return minutes >= 1200 ? 0 : 1;
}

export function searchAnyDestinations(
  flights: Flight[],
  params: DestinationSearchParams,
  routeSearch?: RouteSearch,
): ExplorationResult {
  const dataPeriod = getFlightDataPeriod(flights);
  const weekendCount = params.weekend_count ?? 2;
  const weekends = params.date_mode === 'weekends' ? getWeekendDates(params.date, weekendCount) : [];
  const requestedDates = params.date_mode === 'weekends'
    ? [...new Set(weekends.flatMap((weekend) => [...weekend.outboundDates, ...weekend.returnDates]))].sort((a, b) => a.localeCompare(b))
    : params.date_mode === 'range'
      ? dateRange(params.date, params.date_end ?? params.date)
      : [params.date];
  const uncoveredDates = requestedDates.filter((date) => !isWithinFlightDataPeriod(date, dataPeriod));
  const itineraries: DestinationItinerary[] = [];
  const seen = new Set<string>();

  const push = (itinerary: DestinationItinerary) => {
    const outbound = itinerary.outbound.segments[0];
    const returning = itinerary.return?.segments[0];
    const key = [
      itinerary.weekend_start ?? '', itinerary.destination_city,
      outbound.flight_no, outbound.dep_time, returning?.flight_no ?? '', returning?.dep_time ?? '',
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    itineraries.push(itinerary);
  };

  const addOutbound = (flight: Flight, date: string, weekendStart?: string, returnDates: string[] = []) => {
    const outboundRoute = routeForFlight(flight, date, params.date);
    if (params.trip_type === 'oneway') {
      push({
        weekend_start: weekendStart,
        destination_city: flight.dest_city,
        outbound: outboundRoute,
        return_status: 'not-requested',
        direct: outboundRoute.stops === 0,
        qualifies_666: outboundRoute.segments.every((segment) => is666Flight({
          ...flight,
          dep_minutes: Number(segment.dep_time.slice(11, 13)) * 60 + Number(segment.dep_time.slice(14, 16)),
          product: segment.product,
        }, segment.dep_time.slice(0, 10))),
        ticket_inventory: 'unverified',
      });
      return;
    }

    const outboundArrival = dayOffset(params.date, outboundRoute.segments[0].arr_time.slice(0, 10)) * 1440 +
      flight.arr_minutes;
    let best: { flight: Flight; date: string; departure: number; playable: number } | undefined;

    for (const returnDate of returnDates) {
      if (!isWithinFlightDataPeriod(returnDate, dataPeriod) || isDateRestricted(returnDate, params.version)) continue;
      const returnFlights = flights.filter((candidate) =>
        candidate.origin_city === flight.dest_city &&
        candidate.dest_city === params.origin_city &&
        (!params.origin_airport || candidate.dest_airport === params.origin_airport) &&
        eligibleFlight(candidate, returnDate, params, dataPeriod)
      );
      const uniqueReturns = new Map(returnFlights.map((candidate) => [flightIdentity(candidate), candidate]));
      for (const candidate of uniqueReturns.values()) {
        const departure = dayOffset(params.date, returnDate) * 1440 + candidate.dep_minutes;
        if (departure <= outboundArrival) continue;
        const playable = departure - outboundArrival;
        if (!best || playable > best.playable) best = { flight: candidate, date: returnDate, departure, playable };
      }
    }

    if (!best) {
      push({
        weekend_start: weekendStart,
        destination_city: flight.dest_city,
        outbound: outboundRoute,
        return_status: 'not-found',
        direct: true,
        qualifies_666: is666Flight(flight, date),
        ticket_inventory: 'unverified',
      });
      return;
    }

    push({
      weekend_start: weekendStart,
      destination_city: flight.dest_city,
      outbound: outboundRoute,
      return: routeForFlight(best.flight, best.date, params.date),
      playable_minutes: best.playable,
      return_status: 'matched',
      direct: true,
      qualifies_666: is666Flight(flight, date) && is666Flight(best.flight, best.date),
      ticket_inventory: 'unverified',
    });
  };

  if (params.date_mode === 'weekends') {
    for (const weekend of weekends) {
      for (const date of weekend.outboundDates) {
        if (date < params.date || !isWithinFlightDataPeriod(date, dataPeriod) || isDateRestricted(date, params.version)) continue;
        const outboundWindows = weekday(date) === 5
          ? params.windows.filter((window) => window === 'late')
          : params.windows;
        if (outboundWindows.length === 0) continue;
        const outboundParams = { ...params, windows: outboundWindows };
        const outgoing = flights.filter((flight) =>
          flight.origin_city === params.origin_city &&
          (!params.destination_city || flight.dest_city === params.destination_city) &&
          (!params.origin_airport || flight.origin_airport === params.origin_airport) &&
          eligibleFlight(flight, date, outboundParams, dataPeriod)
        );
        const uniqueOutgoing = new Map(outgoing.map((flight) => [flightIdentity(flight), flight]));
        for (const flight of uniqueOutgoing.values()) addOutbound(flight, date, weekend.weekendStart, weekend.returnDates);
      }
    }
  } else {
    const dates = requestedDates.filter((date) => isWithinFlightDataPeriod(date, dataPeriod));
    const destinationCities = [...new Set(flights
      .filter((flight) => flight.origin_city === params.origin_city && flight.dest_city !== params.origin_city &&
        (!params.destination_city || flight.dest_city === params.destination_city))
      .map((flight) => flight.dest_city))].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    if (!params.direct_only && params.trip_type === 'oneway' && routeSearch) {
      for (const date of dates) {
        if (isDateRestricted(date, params.version)) continue;
        for (const destination of destinationCities) {
          for (const route of routeSearch(params.origin_city, destination, date, params.windows, params.version)) {
            if (params.origin_airport && route.segments[0]?.origin_airport !== params.origin_airport) continue;
            const qualifies666 = route.segments.every((segment) => {
              if (segment.product && !isProductAvailable(segment.product, '666')) return false;
              if (isDateRestricted(segment.dep_time.slice(0, 10), '666')) return false;
              const [hour, minute] = segment.dep_time.slice(11).split(':').map(Number);
              return isInTimeWindow(hour * 60 + minute, ['early', 'late'], '666');
            });
            push({
              destination_city: destination,
              outbound: route,
              return_status: 'not-requested',
              direct: route.stops === 0,
              qualifies_666: qualifies666,
              ticket_inventory: 'unverified',
            });
          }
        }
      }
    } else {
      for (const date of dates) {
        if (isDateRestricted(date, params.version)) continue;
        const outgoing = flights.filter((flight) =>
          flight.origin_city === params.origin_city &&
          flight.dest_city !== params.origin_city &&
          (!params.destination_city || flight.dest_city === params.destination_city) &&
          (!params.origin_airport || flight.origin_airport === params.origin_airport) &&
          eligibleFlight(flight, date, params, dataPeriod)
        );
        const uniqueOutgoing = new Map(outgoing.map((flight) => [flightIdentity(flight), flight]));
        for (const flight of uniqueOutgoing.values()) addOutbound(flight, date);
      }
    }
  }

  itineraries.sort((a, b) => {
    const playableDifference = (b.playable_minutes ?? -1) - (a.playable_minutes ?? -1);
    if (playableDifference !== 0) return playableDifference;
    const convenienceDifference = departureConvenience(a) - departureConvenience(b);
    if (convenienceDifference !== 0) return convenienceDifference;
    const departureDifference = a.outbound.segments[0].dep_time.localeCompare(b.outbound.segments[0].dep_time);
    if (departureDifference !== 0) return departureDifference;
    return a.destination_city.localeCompare(b.destination_city, 'zh-CN');
  });

  return {
    itineraries,
    requestedDates,
    uncoveredDates,
    dataPeriod,
    restriction: params.version === '666' && requestedDates.every((date) => isDateRestricted(date, params.version))
      ? '666 版本在所选日期受节假日限制'
      : undefined,
  };
}


export const DEFAULT_DESTINATION_SEARCH_LIMITS = {
  maxRangeDays: CONSTRAINTS.MAX_TRIP_SPAN_DAYS,
  supportedWeekendCounts: [2, 4, 8] as const,
  dataPeriod: FLIGHT_DATA_PERIOD,
};
