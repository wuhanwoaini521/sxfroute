"use client"

import { useState } from "react"
import { Calendar, Clock, Plane, Search, ArrowLeftRight, ChevronDown, ChevronUp, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { CitySelector } from "./city-selector"
import { FlightStats } from "./flight-stats"
import { SearchResults } from "./search-results"
import { AnyDestinationResults } from "./any-destination-results"
import { Disclaimer } from "./disclaimer"
import { DestinationItinerary, DestinationSearchResponse, Route, RoundtripRoute } from "@/lib/flight/types"

interface SearchParams {
  origin_city: string
  dest_city: string
  date: string
  windows: string[]
  max_stops: number
  version: "666" | "2666"
  trip_type: "oneway" | "roundtrip"  // 新增：行程类型
  return_date?: string               // 新增：返程日期
  return_windows?: string[]          // 新增：返程时间窗口
  direct_only?: boolean
}

function getDefaultDate() {
  const today = new Date();
  const todayText = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return todayText;
}

export function FlightSearch() {
  const [searchMode, setSearchMode] = useState<'any' | 'precise'>('any')
  const [searchModeAtSearch, setSearchModeAtSearch] = useState<'any' | 'precise'>('any')
  const [dateMode, setDateMode] = useState<'date' | 'range' | 'weekends'>('weekends')
  const [weekendCount, setWeekendCount] = useState<2 | 4 | 8>(2)
  const [dateEnd, setDateEnd] = useState('')
  const [anyItineraries, setAnyItineraries] = useState<DestinationItinerary[]>([])
  const [anyMeta, setAnyMeta] = useState<DestinationSearchResponse['meta'] | undefined>(undefined)
  const [searchParams, setSearchParams] = useState<SearchParams>({
    origin_city: "",
    dest_city: "",
    date: getDefaultDate(),
    windows: ["early", "late"],
    max_stops: 0,
    version: "666",
    trip_type: "roundtrip",
    direct_only: true,
    return_date: "",
    return_windows: ["early", "late"],
  })
  const [loading, setLoading] = useState(false)
  const [routes, setRoutes] = useState<Route[]>([])
  const [roundtripRoutes, setRoundtripRoutes] = useState<RoundtripRoute[]>([])
  const [searched, setSearched] = useState(false)
  const [restriction, setRestriction] = useState<string | undefined>(undefined)
  const [searchTripType, setSearchTripType] = useState<'oneway' | 'roundtrip'>('roundtrip')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const toggleWindowField = (field: 'windows' | 'return_windows', value: string) => {
    setSearchParams((prev) => {
      const current = field === 'windows' ? prev.windows : (prev.return_windows || [])
      const updated = current.includes(value)
        ? current.filter((w) => w !== value)
        : [...current, value]
      return { ...prev, [field]: updated }
    })
  }

  const toggleWindow = (window: string) => toggleWindowField('windows', window)

  const handleSearch = async () => {
    if (!searchParams.origin_city || !searchParams.date || (searchMode === 'precise' && !searchParams.dest_city)) return
    if (searchMode === 'any' && dateMode === 'range' && !dateEnd) return
    if (searchMode === 'precise' && searchParams.trip_type === 'roundtrip' && !searchParams.return_date) {
      alert('请选择返程日期')
      return
    }

    setLoading(true)
    setSearched(true)
    setSearchModeAtSearch(searchMode)
    setSearchTripType(searchParams.trip_type)

    try {
      const requestBody = searchMode === 'any'
        ? {
            ...searchParams,
            search_mode: 'any',
            date_mode: dateMode,
            date_end: dateMode === 'range' ? dateEnd : undefined,
            weekend_count: weekendCount,
            direct_only: searchParams.trip_type === 'roundtrip' ? true : searchParams.direct_only,
          }
        : searchParams
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => undefined)
        throw new Error(errorBody?.error || '搜索失败')
      }

      const data = await response.json()
      if (searchMode === 'any') {
        setAnyItineraries(data.itineraries || [])
        setAnyMeta(data.meta)
        setRoutes([])
        setRoundtripRoutes([])
      } else if (data.meta?.trip_type === 'roundtrip') {
        setRoundtripRoutes(data.roundtrip_routes || [])
        setRoutes([])
        setAnyItineraries([])
        setAnyMeta(undefined)
      } else {
        setRoutes(data.routes || [])
        setRoundtripRoutes([])
        setAnyItineraries([])
        setAnyMeta(undefined)
      }
      setRestriction(data.meta?.restriction)
    } catch (error) {
      console.error('搜索出错:', error)
      setRoutes([])
      setRoundtripRoutes([])
      setAnyItineraries([])
      setAnyMeta(undefined)
      setRestriction(error instanceof Error ? error.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSwapCities = () => {
    setSearchParams((prev) => ({
      ...prev,
      origin_city: prev.dest_city,
      dest_city: prev.origin_city
    }))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* 搜索表单 */}
      <div className="lg:col-span-1">
        <Card className="shadow-md border-sky-100 bg-gradient-to-br from-white to-sky-50/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Search className="w-5 h-5 sm:w-6 sm:h-6" />
              航班搜索
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-6">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="搜索模式">
              <Button type="button" variant={searchMode === "any" ? "default" : "ghost"} aria-pressed={searchMode === "any"} onClick={() => setSearchMode("any")} className={searchMode === "any" ? "bg-sky-700 text-white hover:bg-sky-800" : "text-slate-700"}>
                目的地：任意
              </Button>
              <Button type="button" variant={searchMode === "precise" ? "default" : "ghost"} aria-pressed={searchMode === "precise"} onClick={() => setSearchMode("precise")} className={searchMode === "precise" ? "bg-sky-700 text-white hover:bg-sky-800" : "text-slate-700"}>
                指定目的地
              </Button>
            </div>

            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              <Button type="button" variant="ghost" aria-pressed={searchParams.trip_type === "oneway"} className={`flex-1 h-9 text-sm ${searchParams.trip_type === "oneway" ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md font-medium" : "text-gray-600"}`} onClick={() => setSearchParams((prev) => ({ ...prev, trip_type: "oneway", max_stops: searchMode === "precise" ? 1 : 0 }))}>
                <Plane className="mr-1.5 h-4 w-4" aria-hidden="true" />单程
              </Button>
              <Button type="button" variant="ghost" aria-pressed={searchParams.trip_type === "roundtrip"} className={`flex-1 h-9 text-sm ${searchParams.trip_type === "roundtrip" ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md font-medium" : "text-gray-600"}`} onClick={() => {
                setSearchParams((prev) => ({ ...prev, trip_type: "roundtrip", return_date: prev.return_date || prev.date, max_stops: 0, direct_only: true }))
                if (searchMode === "any") setDateMode("weekends")
              }}>
                <ArrowLeftRight className="mr-1.5 h-4 w-4" aria-hidden="true" />{searchMode === "any" ? "周末往返" : "往返"}
              </Button>
            </div>

            <div className="space-y-1 sm:space-y-2">
              <Label className="text-xs sm:text-sm">{searchMode === "any" ? "出发城市" : "选择城市"}</Label>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CitySelector value={searchParams.origin_city} onChange={(value) => setSearchParams((prev) => ({ ...prev, origin_city: value }))} placeholder="出发城市" />
                </div>
                {searchMode === "any" ? (
                  <div className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-sky-300 bg-sky-50 px-2 text-sm text-sky-900" aria-label="目的地：任意">
                    <span>目的地</span><Badge className="bg-sky-700">任意</Badge>
                  </div>
                ) : (
                  <>
                    <Button type="button" onClick={handleSwapCities} disabled={!searchParams.origin_city || !searchParams.dest_city} className="h-10 w-10 flex-shrink-0 rounded-full" variant="ghost" aria-label="交换出发地和目的地">
                      <ArrowLeftRight className="h-4 w-4 text-sky-600" aria-hidden="true" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <CitySelector value={searchParams.dest_city} onChange={(value) => setSearchParams((prev) => ({ ...prev, dest_city: value }))} placeholder="到达城市" />
                    </div>
                  </>
                )}
              </div>
            </div>

              {searchMode === "any" && (
                <div className="space-y-1 sm:space-y-2">
                  <Label className="text-xs sm:text-sm">日期范围</Label>
                  <Select value={dateMode} onValueChange={(value: "date" | "range" | "weekends") => {
                    setDateMode(value)
                    setSearchParams((prev) => ({ ...prev, trip_type: value === "weekends" ? "roundtrip" : "oneway", direct_only: true }))
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekends">未来周末往返</SelectItem>
                      <SelectItem value="date">指定日期</SelectItem>
                      <SelectItem value="range">日期范围</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateMode === "weekends" && (
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">未来周末数量</Label>
                      <Select value={String(weekendCount)} onValueChange={(value) => setWeekendCount(Number(value) as 2 | 4 | 8)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">未来 2 个周末</SelectItem>
                          <SelectItem value="4">未来 4 个周末</SelectItem>
                          <SelectItem value="8">未来 8 个周末</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1 sm:space-y-2">
                <Label htmlFor="date" className="text-xs sm:text-sm">
                  {searchMode === "any" && dateMode === "weekends" ? "从该日期起探索周末" : searchMode === "any" ? "开始日期" : searchParams.trip_type === "roundtrip" ? "去程日期" : "出发日期"}
                </Label>
                <div className="relative w-full max-w-full overflow-hidden rounded-lg border border-transparent">
                  <Calendar className="absolute left-3 top-2.5 sm:top-3 h-4 w-4 pointer-events-none text-gray-400" aria-hidden="true" />
                  <Input
                    id="date"
                    type="date"
                    value={searchParams.date}
                    onChange={(e) => setSearchParams((prev) => ({
                      ...prev,
                      date: e.target.value,
                      return_date: prev.return_date && prev.return_date < e.target.value ? e.target.value : prev.return_date,
                    }))}
                    className="h-9 w-full min-w-0 max-w-full cursor-pointer pl-10 text-left text-sm sm:h-10"
                  />
                </div>
                {searchMode === "any" && dateMode === "range" && (
                  <div className="space-y-1">
                    <Label htmlFor="date_end" className="text-xs text-slate-600">结束日期</Label>
                    <Input id="date_end" type="date" value={dateEnd} min={searchParams.date} onChange={(event) => setDateEnd(event.target.value)} />
                  </div>
                )}
              </div>

            {/* 精确往返搜索的返程日期 */}
            {searchMode === "precise" && searchParams.trip_type === "roundtrip" && (
              <div className="space-y-1 sm:space-y-2">
                <Label htmlFor="return_date" className="text-xs sm:text-sm">返程日期</Label>
                <div className="relative w-full max-w-full overflow-hidden rounded-lg border border-transparent">
                  <Calendar className="absolute left-3 top-2.5 sm:top-3 w-4 h-4 text-gray-400 pointer-events-none" />
                  <Input
                    id="return_date"
                    type="date"
                    value={searchParams.return_date}
                    onChange={(e) => setSearchParams((prev) => ({ ...prev, return_date: e.target.value }))}
                    className="w-full max-w-full min-w-0 pl-10 text-sm h-9 sm:h-10 cursor-pointer text-left appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    min={searchParams.date}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1 sm:space-y-2">
              <Label className="text-xs sm:text-sm">会员版本</Label>
              <Select
                value={searchParams.version}
                onValueChange={(value: "666" | "2666") =>
                  setSearchParams((prev) => ({ ...prev, version: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="666">666版本 (20:00-08:00)</SelectItem>
                  <SelectItem value="2666">2666版本 (19:00-09:00)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {searchMode === "any" ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <label className="flex min-h-6 items-center gap-2 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={searchParams.trip_type === "roundtrip" || searchParams.direct_only !== false}
                    disabled={searchParams.trip_type === "roundtrip" || dateMode === "weekends"}
                    onChange={(event) => setSearchParams((prev) => ({ ...prev, direct_only: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  只看直飞
                </label>
                <p className="mt-1 text-xs text-slate-500">周末探索去返程均强制直飞；指定日期/范围单程可取消勾选查看中转。</p>
              </div>
            ) : (
              <div className="space-y-1 sm:space-y-2">
                <Label className="text-xs sm:text-sm">最大中转次数</Label>
                <Select value={searchParams.max_stops.toString()} onValueChange={(value) => setSearchParams((prev) => ({ ...prev, max_stops: Number.parseInt(value) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">直飞</SelectItem>
                    <SelectItem value="1">最多1次中转</SelectItem>
                    <SelectItem value="2">最多2次中转</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 高级选项折叠区域 */}
            <div className="space-y-3">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between text-xs sm:text-sm font-normal hover:bg-gray-50"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  <span>高级选项</span>
                  {/* 显示当前选中的选项数量 */}
                  {(searchParams.windows.length < 2 || 
                    (searchMode === "precise" && searchParams.trip_type === "roundtrip" && searchParams.return_windows && searchParams.return_windows.length < 2)) && (
                    <Badge variant="secondary" className="text-xs">
                      已筛选
                    </Badge>
                  )}
                </span>
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
              
              {showAdvanced && (
                <div className="space-y-3 pl-4 ml-2 border-l-2 border-gray-200 animate-in slide-in-from-top-2 duration-200">
                  {/* 去程时间窗口 */}
                  <div className="space-y-2">
                    <Label className="text-xs sm:text-sm">
                      {searchParams.trip_type === "roundtrip" ? searchMode === "any" ? "去返程起飞窗口" : "去程时间窗口" : "时间窗口"}
                    </Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="early"
                          checked={searchParams.windows.includes("early")}
                          onChange={() => toggleWindow("early")}
                          className="rounded border-gray-300"
                        />
                        <Label htmlFor="early" className="flex items-center gap-1 cursor-pointer text-xs sm:text-sm">
                          <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                          <span className="sm:hidden">凌晨</span>
                          <span className="hidden sm:inline">
                            凌晨窗 ({searchParams.version === "666" ? "00:00-08:00" : "00:00-09:00"})
                          </span>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="late"
                          checked={searchParams.windows.includes("late")}
                          onChange={() => toggleWindow("late")}
                          className="rounded border-gray-300"
                        />
                        <Label htmlFor="late" className="flex items-center gap-1 cursor-pointer text-xs sm:text-sm">
                          <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                          <span className="sm:hidden">夜晚</span>
                          <span className="hidden sm:inline">
                            夜晚窗 ({searchParams.version === "666" ? "20:00-23:59" : "19:00-23:59"})
                          </span>
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* 返程时间窗口 - 仅在往返模式下显示 */}
                  {searchMode === "precise" && searchParams.trip_type === "roundtrip" && (
                    <div className="space-y-2">
                      <Label className="text-xs sm:text-sm">返程时间窗口</Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:space-y-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="return_early"
                            checked={searchParams.return_windows?.includes("early")}
                            onChange={() => toggleWindowField('return_windows', 'early')}
                            className="rounded border-gray-300"
                          />
                          <Label htmlFor="return_early" className="flex items-center gap-1 cursor-pointer text-xs sm:text-sm">
                            <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                            <span className="sm:hidden">凌晨</span>
                            <span className="hidden sm:inline">
                              凌晨窗 ({searchParams.version === "666" ? "00:00-08:00" : "00:00-09:00"})
                            </span>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="return_late"
                            checked={searchParams.return_windows?.includes("late")}
                            onChange={() => toggleWindowField('return_windows', 'late')}
                            className="rounded border-gray-300"
                          />
                          <Label htmlFor="return_late" className="flex items-center gap-1 cursor-pointer text-xs sm:text-sm">
                            <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                            <span className="sm:hidden">夜晚</span>
                            <span className="hidden sm:inline">
                              夜晚窗 ({searchParams.version === "666" ? "20:00-23:59" : "19:00-23:59"})
                            </span>
                          </Label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={handleSearch}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-md hover:shadow-lg transition-all"
              type="submit"
              disabled={loading || !searchParams.origin_city || !searchParams.date || (searchMode === "precise" && !searchParams.dest_city) || (searchMode === "any" && dateMode === "range" && !dateEnd)}
            >
              {loading ? "搜索中..." : "搜索航班"}
            </Button>
          </CardContent>
        </Card>
        
        {/* 移动端如何使用 - 只在移动端未搜索时显示 */}
        {!searched && (
          <Card className="shadow-md mt-4 block sm:hidden bg-gradient-to-br from-sky-50/30 to-blue-50/20 border-sky-100">
            <CardContent className="p-4">
              <h3 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                快速上手指南
              </h3>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="w-8 h-8 bg-gradient-to-br from-sky-500 to-blue-500 text-white rounded-lg flex items-center justify-center text-sm font-bold shadow-sm">
                    1
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm font-medium text-gray-800">输入出发城市</p>
                    <p className="text-xs text-gray-500 mt-0.5">目的地默认任意，无需逐条查询</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-sky-400 text-white rounded-lg flex items-center justify-center text-sm font-bold shadow-sm">
                    2
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm font-medium text-gray-800">选择日期和时间窗口</p>
                    <p className="text-xs text-gray-500 mt-0.5">凌晨窗或夜晚窗</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-sky-500 text-white rounded-lg flex items-center justify-center text-sm font-bold shadow-sm">
                    3
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm font-medium text-gray-800">点击搜索查看结果</p>
                    <p className="text-xs text-gray-500 mt-0.5">智能规划最优航线</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
      </div>

      {/* 搜索结果或欢迎界面 */}
      <div className="lg:col-span-2">
        <div className="space-y-4">
          {!searched && <FlightStats />}
          {searchModeAtSearch === "any" ? (
            <AnyDestinationResults itineraries={anyItineraries} meta={anyMeta} loading={loading} searched={searched} requestError={anyMeta ? undefined : restriction} />
          ) : (
            <SearchResults
              routes={routes}
              loading={loading}
              searched={searched}
              restriction={restriction}
              roundtripRoutes={roundtripRoutes}
              tripType={searchTripType}
            />
          )}
          {/* PC端免责声明保持原位置 */}
          {!searched && <div className="hidden sm:block"><Disclaimer /></div>}
        </div>
      </div>
    </div>
  )
}
