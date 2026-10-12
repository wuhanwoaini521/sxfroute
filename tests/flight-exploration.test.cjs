/* eslint-disable @typescript-eslint/no-require-imports -- the test harness registers a TypeScript require hook. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
  }).outputText;
  module._compile(compiled, filename);
};

const { searchAnyDestinations } = require('../lib/flight/exploration-search.ts');
const { loadRawFlights, getFlightDataQuality } = require('../lib/flight/flight-loader.ts');
const { weekStrToBitmap } = require('../lib/flight/utils.ts');

function minutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function makeFlight({
  flightNo,
  origin = '大连',
  destination,
  originAirport = '大连周水子机场',
  destinationAirport = `${destination}机场`,
  dep = '20:00',
  arr = '22:00',
  days = '1234567',
  product = '666/2666',
  validFrom = '2026-09-01',
  validTo = '2026-11-30',
  operatingDates,
}) {
  return {
    flight_no: flightNo,
    carrier_name: '海南航空',
    origin_city: origin,
    origin_airport: originAirport,
    origin_iata_code: 'DLC',
    origin_province: '辽宁',
    dest_city: destination,
    dest_airport: destinationAirport,
    dest_iata_code: 'SHA',
    dest_province: '上海',
    dow_bitmap: weekStrToBitmap(days),
    dep_minutes: minutes(dep),
    arr_minutes: minutes(arr),
    overnight: minutes(arr) < minutes(dep),
    product,
    valid_from: validFrom,
    valid_to: validTo,
    operating_dates: operatingDates,
  };
}

function params(overrides = {}) {
  return {
    origin_city: '大连',
    date: '2026-10-16',
    date_mode: 'weekends',
    weekend_count: 2,
    trip_type: 'roundtrip',
    version: '666',
    windows: ['early', 'late'],
    direct_only: true,
    ...overrides,
  };
}

test('arbitrary-origin search returns every eligible direct destination and exact-city filtering still works', () => {
  const flights = [
    makeFlight({ flightNo: 'HU1001', destination: '上海', days: '5' }),
    makeFlight({ flightNo: 'HU1002', destination: '广州', days: '5' }),
    makeFlight({ flightNo: 'HU1003', destination: '杭州', days: '5', dep: '12:00' }),
    makeFlight({ flightNo: 'HU1004', origin: '上海', destination: '北京', days: '5' }),
  ];
  const all = searchAnyDestinations(flights, params({ date_mode: 'date', trip_type: 'oneway' }));
  assert.deepEqual(new Set(all.itineraries.map((item) => item.destination_city)), new Set(['上海', '广州']));
  assert.ok(all.itineraries.every((item) => item.direct));

  const exact = searchAnyDestinations(flights, params({ date_mode: 'date', trip_type: 'oneway', destination_city: '上海' }));
  assert.deepEqual(exact.itineraries.map((item) => item.destination_city), ['上海']);
});

test('date-range single-trip search checks every date, including weekday schedule and effective dates', () => {
  const flights = [
    makeFlight({ flightNo: 'HU1101', destination: '上海', dep: '20:30', days: '5' }),
    makeFlight({ flightNo: 'HU1102', destination: '广州', dep: '21:00', days: '6' }),
    makeFlight({ flightNo: 'HU1103', destination: '北京', dep: '22:00', days: '6', validFrom: '2026-10-18' }),
  ];
  const result = searchAnyDestinations(flights, params({
    date_mode: 'range', date: '2026-10-16', date_end: '2026-10-17', trip_type: 'oneway',
  }));
  assert.equal(result.itineraries.length, 2);
  assert.deepEqual(new Set(result.itineraries.map((item) => item.outbound.segments[0].dep_time.slice(0, 10))), new Set(['2026-10-16', '2026-10-17']));
});

test('weekend departures allow Friday evening and Saturday night-window flights, not Friday morning', () => {
  const flights = [
    makeFlight({ flightNo: 'HU1901', destination: '周五清晨城市', days: '5', dep: '07:00' }),
    makeFlight({ flightNo: 'HU1902', destination: '周六清晨城市', days: '6', dep: '07:00' }),
    makeFlight({ flightNo: 'HU1903', destination: '周五晚间城市', days: '5', dep: '20:00' }),
  ];
  const result = searchAnyDestinations(flights, params({ trip_type: 'oneway', weekend_count: 1 }));
  assert.deepEqual(new Set(result.itineraries.map((item) => item.destination_city)), new Set(['周六清晨城市', '周五晚间城市']));
});

test('weekend roundtrip prefers a valid Monday return after a Friday departure', () => {
  const flights = [
    makeFlight({ flightNo: 'HU2001', destination: '成都', days: '5', dep: '20:00', arr: '22:00' }),
    makeFlight({ flightNo: 'HU2002', origin: '成都', destination: '大连', originAirport: '成都双流机场', destinationAirport: '大连周水子机场', days: '7', dep: '20:00', arr: '22:00' }),
    makeFlight({ flightNo: 'HU2003', origin: '成都', destination: '大连', originAirport: '成都双流机场', destinationAirport: '大连周水子机场', days: '1', dep: '20:30', arr: '22:30' }),
  ];
  const result = searchAnyDestinations(flights, params({ weekend_count: 1 }));
  const matched = result.itineraries.find((item) => item.return_status === 'matched');
  assert.ok(matched);
  assert.equal(matched.outbound.segments[0].dep_time, '2026-10-16 20:00');
  assert.equal(matched.return.segments[0].dep_time, '2026-10-19 20:30');
  assert.equal(matched.playable_minutes, 70 * 60 + 30);
  assert.equal(matched.outbound.stops, 0);
  assert.equal(matched.return.stops, 0);
});

test('20:00–08:00 night window handles overnight arrival and cross-midnight return ordering', () => {
  const flights = [
    makeFlight({ flightNo: 'HU3001', destination: '厦门', days: '6', dep: '23:50', arr: '01:00' }),
    makeFlight({ flightNo: 'HU3002', origin: '厦门', destination: '大连', originAirport: '厦门高崎机场', days: '7', dep: '08:00', arr: '11:00' }),
    makeFlight({ flightNo: 'HU3003', origin: '厦门', destination: '大连', originAirport: '厦门高崎机场', days: '7', dep: '00:30', arr: '03:00' }),
  ];
  const result = searchAnyDestinations(flights, params({ date: '2026-10-17', weekend_count: 1 }));
  const matched = result.itineraries.find((item) => item.return_status === 'matched');
  assert.ok(matched);
  assert.equal(matched.outbound.segments[0].arr_time, '2026-10-18 01:00');
  assert.equal(matched.return.segments[0].dep_time, '2026-10-18 08:00');
  assert.equal(matched.playable_minutes, 7 * 60);
  assert.equal(matched.qualifies_666, true);
});

test('same-city multi-airport flights stay grouped by city, with exact origin-airport filtering available', () => {
  const flights = [
    makeFlight({ flightNo: 'HU4001', destination: '上海', originAirport: '大连周水子机场', days: '5' }),
    makeFlight({ flightNo: 'HU4002', destination: '上海', originAirport: '大连金州机场', days: '5' }),
  ];
  const all = searchAnyDestinations(flights, params({ date_mode: 'date', trip_type: 'oneway' }));
  assert.equal(all.itineraries.length, 2);
  assert.deepEqual(new Set(all.itineraries.map((item) => item.destination_city)), new Set(['上海']));
  const oneAirport = searchAnyDestinations(flights, params({
    date_mode: 'date', trip_type: 'oneway', origin_airport: '大连金州机场',
  }));
  assert.equal(oneAirport.itineraries.length, 1);
  assert.equal(oneAirport.itineraries[0].outbound.segments[0].origin_airport, '大连金州机场');
});

test('winter/summer schedule boundaries use each row effective dates rather than combining seasons', () => {
  const flights = [
    makeFlight({ flightNo: 'HU5001', destination: '三亚', days: '6', validFrom: '2026-09-01', validTo: '2026-10-24' }),
    makeFlight({ flightNo: 'HU5002', destination: '海口', days: '6', validFrom: '2026-10-25', validTo: '2027-03-27' }),
  ];
  const summerEdge = searchAnyDestinations(flights, params({ date: '2026-10-24', date_mode: 'date', trip_type: 'oneway' }));
  const winterStart = searchAnyDestinations(flights, params({ date: '2026-10-31', date_mode: 'date', trip_type: 'oneway' }));
  assert.deepEqual(summerEdge.itineraries.map((item) => item.destination_city), ['三亚']);
  assert.deepEqual(winterStart.itineraries.map((item) => item.destination_city), ['海口']);
  assert.deepEqual(winterStart.uncoveredDates, []);
});

test('unmatched destinations remain outbound-only and never masquerade as round trips', () => {
  const flights = [makeFlight({ flightNo: 'HU6001', destination: '昆明', days: '5' })];
  const result = searchAnyDestinations(flights, params({ weekend_count: 1 }));
  assert.equal(result.itineraries.length, 1);
  assert.equal(result.itineraries[0].return_status, 'not-found');
  assert.equal(result.itineraries[0].return, undefined);
  assert.equal(result.itineraries[0].playable_minutes, undefined);
});

test('date-specific operations, expired records and partial coverage are reported instead of claiming no flights', () => {
  const flights = [
    makeFlight({ flightNo: 'HU7001', destination: '南京', days: '5', operatingDates: ['2026-10-23'] }),
    makeFlight({ flightNo: 'HU7002', destination: '长沙', days: '5', validTo: '2026-10-15' }),
  ];
  const dateOnly = searchAnyDestinations(flights, params({ date: '2026-10-16', date_mode: 'date', trip_type: 'oneway' }));
  assert.equal(dateOnly.itineraries.length, 0);

  const outside = searchAnyDestinations(flights, params({
    date: '2026-12-11', date_mode: 'date', trip_type: 'oneway',
  }));
  assert.deepEqual(outside.uncoveredDates, ['2026-12-11']);
  assert.ok(outside.dataPeriod.end < '2026-12-11');
});

test('666 blocked holiday dates are excluded', () => {
  const flights = [makeFlight({ flightNo: 'HU8001', destination: '西安', days: '5' })];
  const result = searchAnyDestinations(flights, params({ date: '2026-10-02', date_mode: 'date', trip_type: 'oneway' }));
  assert.equal(result.itineraries.length, 0);
  assert.equal(result.restriction, '666 版本在所选日期受节假日限制');
});

test('duplicate schedule rows do not create duplicate itinerary cards', () => {
  const flight = makeFlight({ flightNo: 'HU9001', destination: '青岛', days: '5' });
  const result = searchAnyDestinations([flight, { ...flight }], params({ date_mode: 'date', trip_type: 'oneway' }));
  assert.equal(result.itineraries.length, 1);
});

test('CSV snapshot is parsed with format, duplicate, freshness and source diagnostics', async () => {
  const flights = await loadRawFlights();
  const quality = getFlightDataQuality();
  assert.ok(flights.length > 0);
  assert.ok(quality);
  assert.equal(quality.validRecords + quality.invalidRecords + quality.duplicateRecords, quality.totalRecords);
  assert.equal(quality.invalidRecords, 0);
  assert.equal(quality.duplicateRecords, 0);
  assert.equal(quality.stale, false);
  assert.ok(quality.snapshotUpdatedAt);
  assert.match(quality.source, /airport\.csv/);
});

test('666 eligibility checks every connecting segment against the blocked-date period', () => {
  const flight = makeFlight({ flightNo: 'HU9201', destination: '郑州', days: '4', product: '666/2666' });
  const route = {
    stops: 1,
    segments: [
      { ...flight, dep_time: '2026-10-08 20:00', arr_time: '2026-10-08 21:00', product: '666' },
      { ...flight, dep_time: '2026-10-08 22:00', arr_time: '2026-10-08 23:00', product: '666' },
    ],
    connect_cities: ['武汉'],
    arrive_time: '23:00',
    total_duration_mins: 180,
  };
  const result = searchAnyDestinations([flight], params({
    date: '2026-10-08', date_mode: 'date', trip_type: 'oneway', direct_only: false, version: '2666',
  }), () => [route]);
  assert.equal(result.itineraries[0].qualifies_666, false);
});

test('non-direct mode can include exact valid connection routes, while direct mode never invents one', () => {
  const flight = makeFlight({ flightNo: 'HU9101', destination: '郑州', days: '5' });
  const oneStopRoute = {
    stops: 1,
    segments: [
      { ...flight, dep_time: '2026-10-16 20:00', arr_time: '2026-10-16 21:00', product: '666' },
      { ...flight, dep_time: '2026-10-16 22:00', arr_time: '2026-10-16 23:00', product: '666' },
    ],
    connect_cities: ['武汉'],
    arrive_time: '23:00',
    total_duration_mins: 180,
  };
  const direct = searchAnyDestinations([flight], params({ date_mode: 'date', trip_type: 'oneway', direct_only: true }));
  const withTransfers = searchAnyDestinations([flight], params({ date_mode: 'date', trip_type: 'oneway', direct_only: false }), () => [oneStopRoute]);
  assert.equal(direct.itineraries[0].direct, true);
  assert.equal(withTransfers.itineraries[0].direct, false);
  assert.equal(withTransfers.itineraries[0].outbound.stops, 1);
});
