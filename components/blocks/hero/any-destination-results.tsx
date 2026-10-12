"use client"

import { useMemo, useState } from "react"
import { CalendarDays, Clock3, Map as MapIcon, MapPin, Plane, Route as RouteIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DestinationItinerary, FlightDataQuality } from "@/lib/flight/types"
import { getAirportCoordinatesByCity } from "@/lib/flight/airport-coordinates"

interface DestinationMeta {
  count: number
  destinationCount: number
  trip_type: "oneway" | "roundtrip"
  restriction?: string
  requestedDates: string[]
  uncoveredDates: string[]
  dataPeriod: { start: string; end: string }
  dataQuality: FlightDataQuality
}

interface AnyDestinationResultsProps {
  itineraries: DestinationItinerary[]
  meta?: DestinationMeta
  loading: boolean
  searched: boolean
  requestError?: string
}

type SortMode = "playtime" | "departure" | "destination"

function formatDateTime(value: string) {
  const [date, time] = value.split(" ")
  return `${date} ${time}`
}

function formatHours(minutes?: number) {
  if (minutes === undefined) return "—"
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return `${hours}小时${remaining ? `${remaining}分钟` : ""}`
}

function FlightLeg({ title, itinerary, returning = false }: {
  title: string
  itinerary: DestinationItinerary
  returning?: boolean
}) {
  const route = returning ? itinerary.return : itinerary.outbound
  const segments = route?.segments ?? []
  if (segments.length === 0) return null

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => (
        <div key={`${segment.flight_no}-${segment.dep_time}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-slate-50 p-3 sm:p-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}{segments.length > 1 ? ` · 第 ${index + 1} 段` : ""}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(segment.dep_time)}</p>
            <p className="mt-1 break-words text-[11px] leading-4 text-slate-600">{segment.origin_city} · {segment.origin_airport}</p>
            <p className="text-xs text-slate-500">{segment.carrier_name} {segment.flight_no}</p>
          </div>
          <Plane aria-hidden="true" className="h-4 w-4 rotate-90 text-sky-600" />
          <div className="min-w-0 text-right">
            <p className="text-xs font-medium text-transparent">{title}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(segment.arr_time)}</p>
            <p className="mt-1 break-words text-[11px] leading-4 text-slate-600">{segment.dest_city} · {segment.dest_airport}</p>
            <p className="text-xs text-slate-500">到达时刻（含跨日）</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DestinationMap({ itineraries }: { itineraries: DestinationItinerary[] }) {
  const points = useMemo(() => {
    const originCity = itineraries[0]?.outbound.segments[0]?.origin_city
    const origin = originCity ? getAirportCoordinatesByCity(originCity) : undefined
    const destinations = [...new Map(itineraries.map((itinerary) => {
      const point = getAirportCoordinatesByCity(itinerary.destination_city)
      return [itinerary.destination_city, point] as const
    })).entries()].filter((entry) => entry[1])
    const cities = [
      ...(origin ? [{ city: originCity!, point: origin, origin: true }] : []),
      ...destinations.map(([city, point]) => ({ city, point: point!, origin: false })),
    ]
    const project = (lat: number, lng: number) => ({
      x: 34 + ((lng - 73) / 62) * 572,
      y: 28 + ((54 - lat) / 36) * 310,
    })
    const projectedCities = cities.map((city) => ({ ...city, ...project(city.point.lat, city.point.lng) }))
    const labelOffsets = [
      { dx: 10, dy: -10 }, { dx: 10, dy: 4 }, { dx: 10, dy: 18 }, { dx: 10, dy: 32 },
      { dx: -10, dy: -10 }, { dx: -10, dy: 4 }, { dx: -10, dy: 18 }, { dx: -10, dy: 32 },
      { dx: 0, dy: -24 }, { dx: 0, dy: 44 }, { dx: 20, dy: -18 }, { dx: -20, dy: -18 },
    ]
    const placedLabels: { left: number; right: number; top: number; bottom: number }[] = []
    const labeledCities = projectedCities.map((city) => {
      const width = Math.max(city.city.length * 11, 28)
      const candidates = labelOffsets.map((offset) => {
        const anchor = offset.dx < 0 ? "end" as const : "start" as const
        const x = city.x + offset.dx
        const y = city.y + offset.dy
        const left = anchor === "end" ? x - width : x
        return { x, y, anchor, left, right: left + width, top: y - 10, bottom: y + 3 }
      })
      const label = candidates.find((candidate) =>
        candidate.left >= 4 && candidate.right <= 636 && candidate.top >= 12 && candidate.bottom <= 344 &&
        placedLabels.every((placed) => candidate.right + 3 < placed.left || candidate.left - 3 > placed.right || candidate.bottom + 3 < placed.top || candidate.top - 3 > placed.bottom)
      ) ?? candidates[0]
      placedLabels.push(label)
      return { ...city, labelX: label.x, labelY: label.y, labelAnchor: label.anchor }
    })
    return { originCity, cities: labeledCities }
  }, [itineraries])

  const origin = points.cities.find((city) => city.origin)
  if (!origin) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-600">当前机场坐标资料不完整，暂时无法绘制地图；请使用列表查看全部结果。</div>
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-sky-50 via-white to-amber-50 p-2 sm:p-5">
      <div className="mb-3 flex items-center gap-2 px-2 text-sm font-medium text-slate-700">
        <MapPin className="h-4 w-4 text-sky-600" aria-hidden="true" />
        {points.originCity} 出发 · {points.cities.length - 1} 个可绘制目的地
      </div>
      <svg role="img" aria-label={`${points.originCity} 到各目的地的航线分布图`} viewBox="0 0 640 370" className="h-auto w-full">
        <defs>
          <pattern id="map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e2e8f0" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="640" height="370" rx="14" fill="url(#map-grid)" />
        {points.cities.filter((city) => !city.origin).map((city) => (
          <line key={`line-${city.city}`} x1={origin.x} y1={origin.y} x2={city.x} y2={city.y} stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.5" />
        ))}
        {points.cities.map((city) => (
          <g key={city.city}>
            {(Math.abs(city.labelX - city.x) > 14 || Math.abs(city.labelY - city.y) > 16) && (
              <line x1={city.x} y1={city.y} x2={city.labelX} y2={city.labelY - 4} stroke="#64748b" strokeOpacity="0.5" strokeWidth="0.8" />
            )}
            <circle cx={city.x} cy={city.y} r={city.origin ? 8 : 5} fill={city.origin ? "#f97316" : "#0284c7"} stroke="white" strokeWidth="2" />
            <text x={city.labelX} y={city.labelY} textAnchor={city.labelAnchor} fontSize="11" fill="#334155">{city.city}</text>
          </g>
        ))}
        <text x="18" y="354" fontSize="10" fill="#64748b">航线位置为机场坐标投影示意，不代表实际航迹</text>
      </svg>
    </div>
  )
}

export function AnyDestinationResults({ itineraries, meta, loading, searched, requestError }: AnyDestinationResultsProps) {
  const [sortBy, setSortBy] = useState<SortMode>("playtime")
  const [viewMode, setViewMode] = useState<"list" | "map">("list")

  const sorted = useMemo(() => [...itineraries].sort((a, b) => {
    if (sortBy === "playtime") return (b.playable_minutes ?? -1) - (a.playable_minutes ?? -1)
    if (sortBy === "departure") return a.outbound.segments[0].dep_time.localeCompare(b.outbound.segments[0].dep_time)
    return a.destination_city.localeCompare(b.destination_city, "zh-CN")
  }), [itineraries, sortBy])

  const grouped = useMemo(() => {
    const result = new Map<string, DestinationItinerary[]>()
    sorted.forEach((itinerary) => {
      const list = result.get(itinerary.destination_city) ?? []
      list.push(itinerary)
      result.set(itinerary.destination_city, list)
    })
    return [...result.entries()]
  }, [sorted])

  if (!searched && !loading) return null
  if (loading) {
    return <Card><CardContent className="py-16 text-center" role="status"><div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-sky-600" /><p>正在遍历数据覆盖期内的所有直飞目的地…</p></CardContent></Card>
  }

  const quality = meta?.dataQuality
  const formattedUpdated = quality?.snapshotUpdatedAt
    ? new Date(quality.snapshotUpdatedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })
    : "无法确认"
  const coverageIncomplete = (meta?.uncoveredDates.length ?? 0) > 0 || quality?.stale || (quality?.invalidRecords ?? 0) > 0

  return (
    <div className="space-y-4">
      <Card className="border-sky-100 bg-white/90">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{meta?.destinationCount ?? grouped.length} 个目的地 · {itineraries.length} 个行程方案</p>
              <p className="mt-1 text-xs text-slate-600">数据覆盖 {meta?.dataPeriod.start ?? "—"} 至 {meta?.dataPeriod.end ?? "—"} · 快照文件更新时间 {formattedUpdated}</p>
            </div>
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">权益票库存：未核实</Badge>
          </div>
          <p className="text-xs leading-5 text-slate-600">来源：{quality?.source ?? "来源信息不可用"}。航班计划存在不代表 199 元会员权益票可订；本工具不登录或抓取海航网站。</p>
          {coverageIncomplete && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              数据覆盖不完整或无法完全确认，未覆盖日期不会被当作“无航班”。{meta?.uncoveredDates.length ? ` 未覆盖：${meta.uncoveredDates.join("、")}` : ""}{quality?.stale ? ` 数据文件解析异常：${quality.staleReason ?? "使用上次成功加载的快照"}` : ""}
              {quality?.warnings.map((warning) => <span key={warning} className="block text-xs">{warning}</span>)}
            </div>
          )}
        </CardContent>
      </Card>

      {requestError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">搜索未能完成：{requestError}</p>}
      {meta?.restriction && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{meta.restriction}</p>}

      {grouped.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border bg-white p-1" aria-label="结果视图">
            <Button type="button" size="sm" variant={viewMode === "list" ? "default" : "ghost"} onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}>
              <RouteIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />列表
            </Button>
            <Button type="button" size="sm" variant={viewMode === "map" ? "default" : "ghost"} onClick={() => setViewMode("map")} aria-pressed={viewMode === "map"}>
              <MapIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />地图
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span>排序</span>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortMode)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="playtime">可游玩时间</SelectItem>
                <SelectItem value="departure">起飞日期</SelectItem>
                <SelectItem value="destination">目的地</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      )}

      {viewMode === "map" && grouped.length > 0 && <DestinationMap itineraries={itineraries} />}

      {viewMode === "list" && grouped.map(([city, options]) => (
        <Card key={city} className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-sky-50 to-white px-4 py-3 sm:px-5">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              <MapPin className="h-5 w-5 text-sky-600" aria-hidden="true" />{city}
              <Badge variant="secondary">{options.length} 个方案</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-3 sm:p-5">
            {options.map((itinerary, index) => (
              <article key={`${itinerary.weekend_start ?? "date"}-${itinerary.outbound.segments[0].flight_no}-${itinerary.outbound.segments[0].dep_time}-${index}`} className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {itinerary.weekend_start && <Badge variant="outline"><CalendarDays className="mr-1 h-3 w-3" aria-hidden="true" />周末 {itinerary.weekend_start}</Badge>}
                  <Badge className={itinerary.direct ? "bg-emerald-600" : "bg-slate-600"}>{itinerary.direct ? "直飞" : "含中转"}</Badge>
                  <Badge variant={itinerary.qualifies_666 ? "default" : "outline"}>{itinerary.qualifies_666 ? "符合 666 产品/时间限制" : "不满足 666 条件"}</Badge>
                  {itinerary.playable_minutes !== undefined && <Badge variant="outline"><Clock3 className="mr-1 h-3 w-3" aria-hidden="true" />可游玩 {formatHours(itinerary.playable_minutes)}</Badge>}
                  {itinerary.return_status === "not-found" && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-900">仅去程 · 未匹配到直飞返程</Badge>}
                  {itinerary.return_status === "not-requested" && <Badge variant="outline">单程查询</Badge>}
                </div>
                <FlightLeg title="去程" itinerary={itinerary} />
                {itinerary.return ? <FlightLeg title="返程" itinerary={itinerary} returning /> : itinerary.return_status === "not-found" ? <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">该目的地保留在仅去程结果中；没有可验证的周日/周一直飞返程，因此不计为完整往返。</p> : null}
                {itinerary.return && <p className="text-xs text-slate-500">去返程均为直飞 · 会员权益票库存未核实</p>}
              </article>
            ))}
          </CardContent>
        </Card>
      ))}

      {grouped.length === 0 && !requestError && (
        <Card><CardContent className="py-12 text-center">
          <Plane className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="font-medium text-slate-900">{coverageIncomplete ? "当前数据覆盖不足，无法判断没有符合航班" : "当前覆盖数据内未找到符合条件的航班计划"}</p>
          <p className="mt-2 text-sm text-slate-600">{coverageIncomplete ? "请核对数据快照覆盖日期或导入新的公开航班计划。" : "这不是实时库存结果；可尝试调整日期、会员版本或出发城市。"}</p>
        </CardContent></Card>
      )}
    </div>
  )
}
