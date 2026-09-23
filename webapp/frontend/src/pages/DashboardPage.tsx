import React, { useEffect, useState, useMemo } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Select from '@cloudscape-design/components/select'
import DatePicker from '@cloudscape-design/components/date-picker'
import Table from '@cloudscape-design/components/table'
import Spinner from '@cloudscape-design/components/spinner'
import Modal from '@cloudscape-design/components/modal'
import TextFilter from '@cloudscape-design/components/text-filter'
import Pagination from '@cloudscape-design/components/pagination'
import Link from '@cloudscape-design/components/link'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import MetricCard from '../components/MetricCard'

interface DivisionRow {
  division: string
  accounts: number
  pipelineARR: number
  launchedARR: number
  totalARR: number
}

interface PostEvent {
  eventId: string
  eventName: string
  eventDate: string
  type: string
  primaryHost?: string
  registrations?: number
  attendees?: number
  attendanceRate?: number
  uniqueCompanies?: number
  accountsMatched?: number
  activitiesCreated?: number
  amNotificationsSent?: number
  totalArrInfluenced?: number
  pipelineArr?: number
  launchedArr?: number
  divisionSummary?: DivisionRow[]
  notableCustomers?: string[]
  csat?: string
  services?: string[]
  noOppsByTerritory?: { territory: string; accounts: number }[]
}

type DrilldownType =
  | { type: 'attendees' }
  | { type: 'activities' }
  | { type: 'companies' }
  | { type: 'accounts' }
  | { type: 'noopps' }
  | { type: 'amnotifs' }
  | { type: 'division'; division: string; unique?: boolean }

interface Props {
  onGoHome: () => void
}

const fmtArr = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

const shortName = (name: string) => name.length > 24 ? name.slice(0, 22) + '…' : name

const ClickableCard = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <div
    onClick={onClick}
    style={{ cursor: 'pointer', borderRadius: 8, transition: 'box-shadow 0.15s' }}
    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 0 2px #0073bb')}
    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    title="Click to drill down"
  >
    {children}
  </div>
)

// Generic client-side sort for Cloudscape tables. Columns declare either a
// `sortingField` (direct property) or a `sortingComparator` (computed values).
function sortByColumn<T>(items: T[], sortingColumn: any, descending: boolean): T[] {
  if (!sortingColumn) return items
  const { sortingField, sortingComparator } = sortingColumn
  const base = sortingComparator
    ? [...items].sort(sortingComparator)
    : [...items].sort((a: any, b: any) => {
        const av = a?.[sortingField]
        const bv = b?.[sortingField]
        if (av == null && bv == null) return 0
        if (av == null) return -1
        if (bv == null) return 1
        if (typeof av === 'number' && typeof bv === 'number') return av - bv
        return String(av).localeCompare(String(bv), undefined, { numeric: true })
      })
  return descending ? base.reverse() : base
}

// Small hook to track a table's sort state and produce Cloudscape Table props.
function useSort() {
  const [sortingColumn, setSortingColumn] = useState<any>(undefined)
  const [sortingDescending, setSortingDescending] = useState(false)
  const onSortingChange = ({ detail }: any) => {
    setSortingColumn(detail.sortingColumn)
    setSortingDescending(detail.isDescending)
  }
  const reset = () => { setSortingColumn(undefined); setSortingDescending(false) }
  return { sortingColumn, sortingDescending, onSortingChange, reset }
}

// Comparator helpers
const numCmp = (get: (r: any) => number) => (a: any, b: any) => get(a) - get(b)
const arrNum = (s: any) => parseFloat(String(s ?? '0').replace(/[^0-9.-]/g, '')) || 0

// ---- CSV export helpers ----
const csvEscape = (v: any): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const exportRowsToCsv = (filename: string, headers: string[], rows: any[][]) => {
  const lines = [headers, ...rows].map(r => r.map(csvEscape).join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
// Small right-aligned "Export CSV" button to place in a table's header slot.
const CsvExportButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <Button iconName="download" onClick={onClick} disabled={disabled}>Export CSV</Button>
)

export default function DashboardPage({ onGoHome }: Props) {
  const [events, setEvents] = useState<PostEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEventId, setSelectedEventId] = useState<string>('__all__')
  // Date range filter (empty = no bound; by default show all events)
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  // Drill-down state
  const [drilldown, setDrilldown] = useState<DrilldownType | null>(null)
  const [eventCache, setEventCache] = useState<Record<string, any>>({})
  const [loadingDrilldown, setLoadingDrilldown] = useState(false)
  const [drillFilter, setDrillFilter] = useState('')
  const [subAccountId, setSubAccountId] = useState<string | null>(null)
  // Pagination state for the two long tables
  const [noOppsPage, setNoOppsPage] = useState(1)
  const [eventDetailsPage, setEventDetailsPage] = useState(1)
  const PAGE_SIZE = 20
  // Pagination for the (potentially very large) drill-down modal tables.
  // Keeps only one page of rows in the DOM at a time to avoid memory spikes.
  const [drillPage, setDrillPage] = useState(1)
  const [drillPage2, setDrillPage2] = useState(1)
  const DRILL_PAGE_SIZE = 50
  // Sort state per table
  const divSort = useSort()
  const noOppsSort = useSort()
  const eventSort = useSort()
  const drillSort = useSort()   // shared by the currently-open drill-down table
  const drillSort2 = useSort()  // second table when two are shown together (division sub-view)

  const exportPDF = () => window.print()

  useEffect(() => {
    fetch('/api/events/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100 }),
    })
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => {
        const post: PostEvent[] = (data.events || []).filter((e: any) => e.type === 'POST')
        post.sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''))
        setEvents(post)
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(
    () => events.filter(e => {
      if (selectedEventId !== '__all__' && e.eventId !== selectedEventId) return false
      const d = e.eventDate || ''
      if (fromDate && d < fromDate) return false
      if (toDate && d > toDate) return false
      return true
    }),
    [events, selectedEventId, fromDate, toDate],
  )

  // Auto-load per-event detail data (from S3) for the "Unique Across All Events"
  // section so it's populated without requiring a drill-down click.
  useEffect(() => {
    if (events.length > 0) {
      loadFilteredEventData()
    }
    setNoOppsPage(1)
    setEventDetailsPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, selectedEventId, fromDate, toDate])

  // Reset the drill-down table's sort whenever the open drill-down changes.
  useEffect(() => {
    drillSort.reset()
    drillSort2.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drilldown, subAccountId])

  // Reset drill-down pagination when the open view, sub-account, filter or sort changes.
  useEffect(() => {
    setDrillPage(1)
    setDrillPage2(1)
  }, [drilldown, subAccountId, drillFilter, drillSort.sortingColumn, drillSort.sortingDescending, drillSort2.sortingColumn, drillSort2.sortingDescending])

  const metrics = useMemo(() => {
    const totalEvents = filtered.length
    const totalRegistrations = filtered.reduce((s, e) => s + (e.registrations || 0), 0)
    const totalAttendees = filtered.reduce((s, e) => s + (e.attendees || 0), 0)
    const totalCompanies = filtered.reduce((s, e) => s + (e.uniqueCompanies || 0), 0)
    const totalAccounts = filtered.reduce((s, e) => s + (e.accountsMatched || 0), 0)
    const totalActivities = filtered.reduce((s, e) => s + (e.activitiesCreated || 0), 0)
    const totalAMNotifs = filtered.reduce((s, e) => s + (e.amNotificationsSent || 0), 0)
    const totalPipeline = filtered.reduce((s, e) => s + (e.pipelineArr || 0), 0)
    const totalLaunched = filtered.reduce((s, e) => s + (e.launchedArr || 0), 0)
    const totalARR = totalPipeline + totalLaunched
    const csatValues = filtered.map(e => parseFloat(e.csat || '0')).filter(v => v > 0)
    const avgCsat = csatValues.length > 0
      ? (csatValues.reduce((s, v) => s + v, 0) / csatValues.length).toFixed(2)
      : '-'
    const avgAttendance = filtered.length > 0
      ? Math.round(
          filtered.reduce((s, e) => {
            const rate = e.attendanceRate ?? (e.registrations ? Math.round((e.attendees || 0) / e.registrations * 100) : 0)
            return s + rate
          }, 0) / filtered.length,
        )
      : 0
    return { totalEvents, totalRegistrations, totalAttendees, totalCompanies, totalAccounts, totalActivities, totalAMNotifs, totalARR, totalPipeline, totalLaunched, avgCsat, avgAttendance }
  }, [filtered])

  // ---- Unique-across-all-events metrics ----
  // These deduplicate people/companies/accounts/opps that recur across multiple
  // events, using the per-event S3 detail data (loaded into eventCache).
  const uniqueReady = useMemo(
    () => filtered.length > 0 && filtered.every(e => e.eventId in eventCache),
    [filtered, eventCache],
  )

  // Build a de-duplicated opp map once (keyed by Opp ID across all events).
  const dedupedOpps = useMemo(() => {
    const oppMap = new Map<string, { arr: number; stage: string; division: string; accountId: string }>()
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const p of (cache.matchResultsData?.plan || [])) {
        const oid = (p['Opp ID'] || '').trim()
        if (!oid || oppMap.has(oid)) continue
        const arr = parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0
        oppMap.set(oid, {
          arr,
          stage: (p.Stage || '').trim(),
          division: (p.Division || 'Unknown').trim() || 'Unknown',
          accountId: (p['Account ID'] || '').trim(),
        })
      }
    }
    return oppMap
  }, [filtered, eventCache])

  const uniqueMetrics = useMemo(() => {
    const emails = new Set<string>()
    const companies = new Set<string>()
    const accounts = new Set<string>()
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const a of (cache.enrichedData || [])) {
        const email = (a.Email || '').trim().toLowerCase()
        if (email) emails.add(email)
        const comp = (a.Domain || '').trim().toLowerCase() || (a.Company || '').trim().toLowerCase()
        if (comp) companies.add(comp)
        if (a.Status === 'Matched') {
          const aid = (a['Account ID'] || '').trim()
          if (aid && aid !== 'Not Found') accounts.add(aid)
        }
      }
    }
    let uPipeline = 0, uLaunched = 0
    for (const o of dedupedOpps.values()) {
      if (o.stage === 'Launched') uLaunched += o.arr
      else uPipeline += o.arr
    }
    // Blended attendance rate = total attendees / total registrations across events
    const blendedAttendance = metrics.totalRegistrations > 0
      ? Math.round((metrics.totalAttendees / metrics.totalRegistrations) * 100)
      : 0
    return {
      uniquePeople: emails.size,
      uniqueCompanies: companies.size,
      uniqueAccounts: accounts.size,
      uniqueOpps: dedupedOpps.size,
      uniquePipeline: uPipeline,
      uniqueLaunched: uLaunched,
      uniqueTotalArr: uPipeline + uLaunched,
      blendedAttendance,
    }
  }, [filtered, eventCache, dedupedOpps, metrics.totalRegistrations, metrics.totalAttendees])

  // Unique ARR by Division (opps de-duplicated by Opp ID across all events)
  const uniqueDivisionSummary = useMemo(() => {
    const map = new Map<string, { division: string; accounts: Set<string>; pipelineARR: number; launchedARR: number; totalARR: number }>()
    for (const o of dedupedOpps.values()) {
      const key = o.division || 'Unknown'
      if (!map.has(key)) map.set(key, { division: key, accounts: new Set(), pipelineARR: 0, launchedARR: 0, totalARR: 0 })
      const e = map.get(key)!
      if (o.accountId) e.accounts.add(o.accountId)
      if (o.stage === 'Launched') e.launchedARR += o.arr
      else e.pipelineARR += o.arr
      e.totalARR += o.arr
    }
    return Array.from(map.values())
      .map(e => ({ division: e.division, accounts: e.accounts.size, pipelineARR: e.pipelineARR, launchedARR: e.launchedARR, totalARR: e.totalARR }))
      .sort((a, b) => b.totalARR - a.totalARR)
  }, [dedupedOpps])

  const divisionSummary = useMemo(() => {
    const map = new Map<string, DivisionRow>()
    for (const ev of filtered) {
      for (const d of (ev.divisionSummary || [])) {
        const key = d.division || 'Unknown'
        const existing = map.get(key)
        if (existing) {
          existing.accounts += d.accounts || 0
          existing.pipelineARR += d.pipelineARR || 0
          existing.launchedARR += d.launchedARR || 0
          existing.totalARR += d.totalARR || 0
        } else {
          map.set(key, {
            division: key,
            accounts: d.accounts || 0,
            pipelineARR: d.pipelineARR || 0,
            launchedARR: d.launchedARR || 0,
            totalARR: d.totalARR || 0,
          })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalARR - a.totalARR)
  }, [filtered])

  const notableCustomers = useMemo(() => {
    const set = new Set<string>()
    for (const ev of filtered) {
      for (const c of (ev.notableCustomers || [])) if (c) set.add(c)
    }
    return Array.from(set).sort()
  }, [filtered])

  const noOppsByTerritory = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of filtered) {
      for (const t of (ev.noOppsByTerritory || [])) {
        map.set(t.territory, (map.get(t.territory) || 0) + t.accounts)
      }
    }
    return Array.from(map.entries())
      .map(([territory, accounts]) => ({ territory, accounts }))
      .sort((a, b) => b.accounts - a.accounts)
  }, [filtered])

  // ---- Drill-down helpers ----
  const loadFilteredEventData = async () => {
    const toFetch = filtered.filter(e => !(e.eventId in eventCache))
    if (toFetch.length === 0) return
    setLoadingDrilldown(true)
    try {
      const results = await Promise.all(
        toFetch.map(ev =>
          fetch('/api/events/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: ev.eventId }),
          })
            .then(r => r.json())
            .then(d => [ev.eventId, d.post] as [string, any])
            .catch(() => [ev.eventId, null] as [string, any])
        )
      )
      setEventCache(prev => {
        const next = { ...prev }
        for (const [id, data] of results) next[id] = data
        return next
      })
    } finally {
      setLoadingDrilldown(false)
    }
  }

  const openDrilldown = async (type: DrilldownType) => {
    setDrilldown(type)
    setDrillFilter('')
    setSubAccountId(null)
    await loadFilteredEventData()
  }

  const closeDrilldown = () => {
    setDrilldown(null)
    setDrillFilter('')
    setSubAccountId(null)
  }

  // ---- Merged S3 data ----
  const mergedPlan = useMemo(() => {
    const plans: any[] = []
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const p of (cache.matchResultsData?.plan || [])) {
        plans.push({ ...p, _eventName: ev.eventName, _eventDate: ev.eventDate })
      }
    }
    return plans
  }, [filtered, eventCache])

  const mergedSkipped = useMemo(() => {
    const items: any[] = []
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const s of (cache.matchResultsData?.skipped || [])) {
        items.push({ ...s, _eventName: ev.eventName, _eventDate: ev.eventDate })
      }
    }
    return items
  }, [filtered, eventCache])

  const mergedEnriched = useMemo(() => {
    const seen = new Set<string>()
    const result: any[] = []
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const att of (cache.enrichedData || [])) {
        const key = `${ev.eventId}:${att.Email}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ ...att, _eventName: ev.eventName, _eventDate: ev.eventDate })
      }
    }
    return result
  }, [filtered, eventCache])

  const mergedEmailPayloads = useMemo(() => {
    const items: any[] = []
    for (const ev of filtered) {
      const cache = eventCache[ev.eventId]
      if (!cache) continue
      for (const p of (cache.emailPayloadsData || [])) {
        items.push({ ...p, _eventName: ev.eventName, _eventDate: ev.eventDate })
      }
    }
    return items
  }, [filtered, eventCache])

  // ---- Drill-down paging helpers (limit DOM rows to avoid memory spikes) ----
  const pageSlice = (arr: any[], page: number) => arr.slice((page - 1) * DRILL_PAGE_SIZE, page * DRILL_PAGE_SIZE)
  const drillPagination = (total: number, page: number, setPage: (n: number) => void) => (
    <Pagination
      currentPageIndex={page}
      pagesCount={Math.max(1, Math.ceil(total / DRILL_PAGE_SIZE))}
      onChange={({ detail }) => setPage(detail.currentPageIndex)}
    />
  )

  // ---- Drill-down modal content ----
  const renderDrilldownContent = () => {
    if (!drilldown) return null
    if (loadingDrilldown) {
      return (
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: 'm' }}>Loading data…</Box>
        </Box>
      )
    }

    const q = drillFilter.toLowerCase()

    if (drilldown.type === 'attendees') {
      const rows = mergedEnriched
        .filter(a => a.Status === 'Matched')
        .filter(a => !q || a.Visitor?.toLowerCase().includes(q) || a.Email?.toLowerCase().includes(q) || a['SFDC Account Name']?.toLowerCase().includes(q))
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'name', header: 'Name', cell: (r: any) => r.Visitor, sortingField: 'Visitor' },
            { id: 'email', header: 'Email', cell: (r: any) => r.Email, sortingField: 'Email' },
            { id: 'account', header: 'SFDC Account', cell: (r: any) => r['SFDC Account Name'], sortingField: 'SFDC Account Name' },
            { id: 'territory', header: 'Territory', cell: (r: any) => r.Territory || '-', sortingField: 'Territory' },
            { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('attendees.csv',
            ['Name', 'Email', 'SFDC Account', 'Territory', 'Event'],
            sorted.map((r: any) => [r.Visitor, r.Email, r['SFDC Account Name'], r.Territory || '', r._eventName]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter attendees…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No attendees found</Box>}
        />
      )
    }

    if (drilldown.type === 'companies') {
      const companies = Array.from(new Set(mergedEnriched.map((a: any) => a.Company).filter(Boolean))).sort() as string[]
      const rows = companies.filter(c => !q || c.toLowerCase().includes(q)).map(c => ({ company: c }))
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'company', header: 'Company', cell: (r: any) => r.company, sortingField: 'company' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('companies.csv',
            ['Company'],
            sorted.map((r: any) => [r.company]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter companies…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data</Box>}
        />
      )
    }

    if (drilldown.type === 'accounts') {
      const seen = new Map<string, string>()
      for (const a of mergedEnriched) {
        if (a['Account ID'] && a['SFDC Account Name'] && !seen.has(a['Account ID'])) {
          seen.set(a['Account ID'], a['SFDC Account Name'])
        }
      }
      const rows = Array.from(seen.entries())
        .map(([id, name]) => ({ id, name }))
        .filter(r => !q || r.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'name', header: 'SFDC Account Name', cell: (r: any) => r.name, sortingField: 'name' },
            { id: 'id', header: 'Account ID', cell: (r: any) => r.id, sortingField: 'id' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('sfdc-accounts.csv',
            ['SFDC Account Name', 'Account ID'],
            sorted.map((r: any) => [r.name, r.id]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter accounts…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data</Box>}
        />
      )
    }

    if (drilldown.type === 'activities') {
      const rows = mergedPlan.filter(p =>
        !q || p['SFDC Account Name']?.toLowerCase().includes(q) || p['Opp Name']?.toLowerCase().includes(q) || p.Division?.toLowerCase().includes(q)
      )
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'account', header: 'Account', cell: (r: any) => r['SFDC Account Name'], sortingField: 'SFDC Account Name' },
            { id: 'opp', header: 'Opportunity', cell: (r: any) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${r['Opp ID']}/view`} external>{r['Opp Name']}</Link>, sortingField: 'Opp Name' },
            { id: 'stage', header: 'Stage', cell: (r: any) => r.Stage, sortingField: 'Stage' },
            { id: 'arr', header: 'ARR($)', cell: (r: any) => r['ARR($)'] ? `$${arrNum(r['ARR($)']).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-', sortingComparator: numCmp(r => arrNum(r['ARR($)'])) },
            { id: 'division', header: 'Division', cell: (r: any) => r.Division || '-', sortingField: 'Division' },
            { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('activities.csv',
            ['Account', 'Opportunity', 'Stage', 'ARR($)', 'Division', 'Event'],
            sorted.map((r: any) => [r['SFDC Account Name'], r['Opp Name'], r.Stage, arrNum(r['ARR($)']), r.Division || '', r._eventName]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter activities…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data</Box>}
        />
      )
    }

    if (drilldown.type === 'noopps') {
      const rows = mergedSkipped.filter(s =>
        !q || s['SFDC Account Name']?.toLowerCase().includes(q) || s.Territory?.toLowerCase().includes(q)
      )
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'account', header: 'Account', cell: (r: any) => r['SFDC Account Name'], sortingField: 'SFDC Account Name' },
            { id: 'domain', header: 'Domain', cell: (r: any) => r.Domain, sortingField: 'Domain' },
            { id: 'territory', header: 'Territory', cell: (r: any) => r.Territory || '-', sortingField: 'Territory' },
            { id: 'attendees', header: 'Attendees', cell: (r: any) => r.Attendees?.substring(0, 80), sortingField: 'Attendees' },
            { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('accounts-no-genai-opps.csv',
            ['Account', 'Domain', 'Territory', 'Attendees', 'Event'],
            sorted.map((r: any) => [r['SFDC Account Name'], r.Domain, r.Territory || '', r.Attendees || '', r._eventName]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data</Box>}
        />
      )
    }

    if (drilldown.type === 'amnotifs') {
      const rows = mergedEmailPayloads.filter(p =>
        !q || p.am_name?.toLowerCase().includes(q) || p.am_alias?.toLowerCase().includes(q) || p._eventName?.toLowerCase().includes(q)
      )
      const sorted = sortByColumn(rows, drillSort.sortingColumn, drillSort.sortingDescending)
      return (
        <Table
          columnDefinitions={[
            { id: 'am', header: 'AM Name', cell: (r: any) => r.am_name, sortingField: 'am_name' },
            { id: 'alias', header: 'Alias', cell: (r: any) => r.am_alias, sortingField: 'am_alias' },
            { id: 'email', header: 'Email', cell: (r: any) => r.am_email, sortingField: 'am_email' },
            { id: 'accounts', header: 'Accounts', cell: (r: any) => r.account_count ?? '-', sortingComparator: numCmp(r => r.account_count || 0) },
            { id: 'attendees', header: 'Attendees', cell: (r: any) => r.attendee_count ?? '-', sortingComparator: numCmp(r => r.attendee_count || 0) },
            { id: 'opps', header: 'Opps', cell: (r: any) => r.opp_count ?? '-', sortingComparator: numCmp(r => r.opp_count || 0) },
            { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
          ]}
          items={pageSlice(sorted, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sorted.length})`} actions={<CsvExportButton disabled={rows.length === 0} onClick={() => exportRowsToCsv('am-notifications.csv',
            ['AM Name', 'Alias', 'Email', 'Accounts', 'Attendees', 'Opps', 'Event'],
            sorted.map((r: any) => [r.am_name, r.am_alias, r.am_email, r.account_count ?? '', r.attendee_count ?? '', r.opp_count ?? '', r._eventName]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sorted.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data</Box>}
        />
      )
    }

    if (drilldown.type === 'division') {
      const { division } = drilldown

      // When drilling down from the "Unique ARR by Division" table, de-duplicate
      // opps by Opp ID across events so the detail matches the unique totals.
      const planSource = drilldown.unique
        ? (() => {
            const seenOpp = new Set<string>()
            const out: any[] = []
            for (const p of mergedPlan) {
              const oid = (p['Opp ID'] || '').trim()
              if (!oid || seenOpp.has(oid)) continue
              seenOpp.add(oid)
              out.push(p)
            }
            return out
          })()
        : mergedPlan

      if (subAccountId) {
        // Sub-view: opps + attendees for this account within this division
        const accountOpps = planSource.filter(p => p['Account ID'] === subAccountId && (p.Division || 'Unknown') === division)
        const accountAttendees = mergedEnriched.filter(a => a['Account ID'] === subAccountId && a.Status === 'Matched')
        const accountName = accountOpps[0]?.['SFDC Account Name'] || accountAttendees[0]?.['SFDC Account Name'] || subAccountId
        return (
          <SpaceBetween size="m">
            <Button iconName="arrow-left" onClick={() => { setSubAccountId(null); setDrillFilter('') }}>
              Back to {division} accounts
            </Button>
            <Header variant="h3">{accountName}</Header>
            <Container header={<Header variant="h3">Opportunities ({accountOpps.length})</Header>}>
              <Table
                columnDefinitions={[
                  { id: 'opp', header: 'Opportunity', cell: (r: any) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${r['Opp ID']}/view`} external>{r['Opp Name']}</Link>, sortingField: 'Opp Name' },
                  { id: 'stage', header: 'Stage', cell: (r: any) => r.Stage, sortingField: 'Stage' },
                  { id: 'arr', header: 'ARR($)', cell: (r: any) => r['ARR($)'] ? `$${arrNum(r['ARR($)']).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-', sortingComparator: numCmp(r => arrNum(r['ARR($)'])) },
                  { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
                ]}
                sortingColumn={drillSort.sortingColumn}
                sortingDescending={drillSort.sortingDescending}
                onSortingChange={drillSort.onSortingChange}
                items={pageSlice(sortByColumn(accountOpps, drillSort.sortingColumn, drillSort.sortingDescending), drillPage)}
                variant="embedded"
                stripedRows
                header={<Header actions={<CsvExportButton disabled={accountOpps.length === 0} onClick={() => exportRowsToCsv(`${accountName}-opportunities.csv`,
                  ['Opportunity', 'Stage', 'ARR($)', 'Event'],
                  sortByColumn(accountOpps, drillSort.sortingColumn, drillSort.sortingDescending).map((r: any) => [r['Opp Name'], r.Stage, arrNum(r['ARR($)']), r._eventName]))} />} />}
                pagination={drillPagination(accountOpps.length, drillPage, setDrillPage)}
                empty={<Box textAlign="center" color="inherit">No opps</Box>}
              />
            </Container>
            <Container header={<Header variant="h3">Attendees ({accountAttendees.length})</Header>}>
              <Table
                columnDefinitions={[
                  { id: 'name', header: 'Name', cell: (r: any) => r.Visitor, sortingField: 'Visitor' },
                  { id: 'email', header: 'Email', cell: (r: any) => r.Email, sortingField: 'Email' },
                  { id: 'event', header: 'Event', cell: (r: any) => r._eventName, sortingField: '_eventName' },
                ]}
                sortingColumn={drillSort2.sortingColumn}
                sortingDescending={drillSort2.sortingDescending}
                onSortingChange={drillSort2.onSortingChange}
                items={pageSlice(sortByColumn(accountAttendees, drillSort2.sortingColumn, drillSort2.sortingDescending), drillPage2)}
                variant="embedded"
                stripedRows
                header={<Header actions={<CsvExportButton disabled={accountAttendees.length === 0} onClick={() => exportRowsToCsv(`${accountName}-attendees.csv`,
                  ['Name', 'Email', 'Event'],
                  sortByColumn(accountAttendees, drillSort2.sortingColumn, drillSort2.sortingDescending).map((r: any) => [r.Visitor, r.Email, r._eventName]))} />} />}
                pagination={drillPagination(accountAttendees.length, drillPage2, setDrillPage2)}
                empty={<Box textAlign="center" color="inherit">No attendees</Box>}
              />
            </Container>
          </SpaceBetween>
        )
      }

      // Top level: accounts in this division
      const accountIds = new Set(planSource.filter(p => (p.Division || 'Unknown') === division).map(p => p['Account ID']))
      const accountRows = Array.from(accountIds).map(aid => {
        const opps = planSource.filter(p => p['Account ID'] === aid && (p.Division || 'Unknown') === division)
        const totalArr = opps.reduce((s, p) => s + (parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0), 0)
        return {
          accountId: aid,
          accountName: opps[0]?.['SFDC Account Name'] || aid,
          opps: opps.length,
          arr: totalArr,
        }
      }).filter(r => !q || r.accountName.toLowerCase().includes(q)).sort((a, b) => b.arr - a.arr)
      const sortedAccts = sortByColumn(accountRows, drillSort.sortingColumn, drillSort.sortingDescending)

      return (
        <Table
          columnDefinitions={[
            {
              id: 'account', header: 'Account',
              cell: (r: any) => (
                <Button variant="link" onClick={() => { setSubAccountId(r.accountId); setDrillFilter('') }}>
                  {r.accountName}
                </Button>
              ),
              sortingField: 'accountName',
            },
            { id: 'opps', header: 'Opps', cell: (r: any) => r.opps, sortingField: 'opps' },
            { id: 'arr', header: 'Total ARR', cell: (r: any) => r.arr > 0 ? `$${r.arr.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-', sortingField: 'arr' },
          ]}
          items={pageSlice(sortedAccts, drillPage)}
          sortingColumn={drillSort.sortingColumn}
          sortingDescending={drillSort.sortingDescending}
          onSortingChange={drillSort.onSortingChange}
          variant="embedded"
          stripedRows
          header={<Header counter={`(${sortedAccts.length})`} actions={<CsvExportButton disabled={accountRows.length === 0} onClick={() => exportRowsToCsv(`${division}-accounts.csv`,
            ['Account', 'Opps', 'Total ARR'],
            sortedAccts.map((r: any) => [r.accountName, r.opps, r.arr]))} />} />}
          filter={<TextFilter filteringText={drillFilter} filteringPlaceholder="Filter accounts…" onChange={({ detail }) => setDrillFilter(detail.filteringText)} />}
          pagination={drillPagination(sortedAccts.length, drillPage, setDrillPage)}
          empty={<Box textAlign="center" color="inherit">No data (S3 data not yet loaded — try again)</Box>}
        />
      )
    }

    return null
  }

  const drilldownTitle = () => {
    if (!drilldown) return ''
    if (drilldown.type === 'attendees') return 'Attendees Detail'
    if (drilldown.type === 'activities') return 'Activities / Opportunities Detail'
    if (drilldown.type === 'companies') return 'Unique Companies'
    if (drilldown.type === 'accounts') return 'SFDC Accounts Matched'
    if (drilldown.type === 'noopps') return 'Accounts with No GenAI Opps'
    if (drilldown.type === 'amnotifs') return 'AM Notifications Detail'
    if (drilldown.type === 'division') {
      const suffix = drilldown.unique ? ' (Unique)' : ''
      if (subAccountId) return `${drilldown.division} — Account Detail${suffix}`
      return `Division: ${drilldown.division}${suffix}`
    }
    return ''
  }

  // ---- Charts data ----
  const arrChartData = filtered.map(e => ({
    name: shortName(e.eventName),
    Pipeline: parseFloat(((e.pipelineArr || 0) / 1_000_000).toFixed(2)),
    Launched: parseFloat(((e.launchedArr || 0) / 1_000_000).toFixed(2)),
  }))

  const attendanceChartData = filtered.map(e => ({
    name: shortName(e.eventName),
    Registrations: e.registrations || 0,
    Attendees: e.attendees || 0,
  }))

  const csatChartData = filtered.map(e => ({
    name: shortName(e.eventName),
    CSAT: parseFloat(e.csat || '0') || 0,
  }))

  const activitiesChartData = filtered.map(e => ({
    name: shortName(e.eventName),
    Activities: e.activitiesCreated || 0,
    'AM Notifications': e.amNotificationsSent || 0,
  }))

  const eventOptions = [
    { label: `All Events (${events.length})`, value: '__all__' },
    ...events.map(e => ({ label: `${e.eventDate} — ${e.eventName}`, value: e.eventId })),
  ]

  const dateRange = useMemo(() => {
    const dates = filtered.map(e => e.eventDate).filter(Boolean).sort()
    if (dates.length === 0) return ''
    const fmt = (d: string) => {
      const [year, month] = d.split('-')
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${months[parseInt(month) - 1]} ${year}`
    }
    return dates[0] === dates[dates.length - 1] ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
  }, [filtered])

  if (loading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: 'm' }}>Loading dashboard...</Box>
      </Box>
    )
  }

  const cloudscapeFont = '"Open Sans", "Helvetica Neue", Roboto, Arial, sans-serif'
  const tickStyle = { fontSize: 11, fontFamily: cloudscapeFont }
  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color: '#687078',
    marginBottom: 10,
    paddingBottom: 6,
    borderBottom: '2px solid #e9ebed',
  }
  const filterLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    color: '#a8c8e8',
    marginBottom: 6,
  }

  return (
    <div style={{ fontFamily: cloudscapeFont }}>
    <SpaceBetween size="l">
      {/* Hero Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2d4a 0%, #1b5276 100%)',
        borderRadius: 12,
        padding: '28px 32px',
        marginTop: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'nowrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#ff9900', marginBottom: 6 }}>
              AGS Scale Events Toolkit
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#ffffff', lineHeight: 1.3 }}>
              Events Performance Dashboard
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'nowrap', gap: 20, fontSize: 13, color: '#a8c8e8' }}>
              {dateRange && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 15 }}>📅</span> {dateRange}
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 15 }}>📊</span> {filtered.length} events
              </span>
              {metrics.totalAttendees > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 15 }}>👥</span> {metrics.totalAttendees.toLocaleString()} attendees
                </span>
              )}
              {metrics.totalARR > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 15 }}>💰</span> {fmtArr(metrics.totalARR)} ARR influenced
                </span>
              )}
              {metrics.avgCsat !== '-' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 15 }}>⭐</span> {metrics.avgCsat} avg CSAT
                </span>
              )}
            </div>
          </div>

          <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end', flex: '0 0 auto' }}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button onClick={onGoHome} iconName="arrow-left">Back to Home</Button>
              <Button
                iconName="download"
                variant="primary"
                onClick={exportPDF}
                disabled={events.length === 0}
              >
                Export PDF
              </Button>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              <div style={{ width: 200 }}>
                <div style={filterLabelStyle}>Filter by Event</div>
                <Select
                  selectedOption={eventOptions.find(o => o.value === selectedEventId) ?? eventOptions[0]}
                  onChange={({ detail }) => setSelectedEventId(detail.selectedOption.value ?? '__all__')}
                  options={eventOptions}
                />
              </div>
              <div style={{ width: 130 }}>
                <div style={filterLabelStyle}>From Date</div>
                <DatePicker
                  value={fromDate}
                  onChange={({ detail }) => setFromDate(detail.value)}
                  placeholder="YYYY/MM/DD"
                />
              </div>
              <div style={{ width: 130 }}>
                <div style={filterLabelStyle}>To Date</div>
                <DatePicker
                  value={toDate}
                  onChange={({ detail }) => setToDate(detail.value)}
                  placeholder="YYYY/MM/DD"
                />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <Button
                  onClick={() => { setFromDate(''); setToDate(''); setSelectedEventId('__all__') }}
                  iconName="close"
                  disabled={!(fromDate || toDate || selectedEventId !== '__all__')}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {events.length === 0 ? (
        <Box textAlign="center" color="inherit" padding="xxl">
          <b>No post-event data yet</b>
          <Box variant="p" color="inherit">Complete a Post-Event Wizard to see analytics.</Box>
        </Box>
      ) : (
        <div>
        <SpaceBetween size="l">
          {/* Metrics row 1: attendance */}
          <div>
            <div style={sectionLabelStyle}>Attendance</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <MetricCard label="Events" value={metrics.totalEvents} color="blue" />
              <MetricCard label="Total Registrations" value={metrics.totalRegistrations} color="green" />
              <ClickableCard onClick={() => openDrilldown({ type: 'attendees' })}>
                <MetricCard label="Total Attendees" value={metrics.totalAttendees} color="teal" />
              </ClickableCard>
              <MetricCard label="Avg Attendance Rate" value={`${metrics.avgAttendance}%`} color="purple" />
            </div>
          </div>

          {/* Metrics row 2: ARR */}
          <div>
            <div style={sectionLabelStyle}>Financial Impact</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <ClickableCard onClick={() => openDrilldown({ type: 'activities' })}>
                <MetricCard label="Total ARR Influenced" value={fmtArr(metrics.totalARR)} color="orange" />
              </ClickableCard>
              <ClickableCard onClick={() => openDrilldown({ type: 'activities' })}>
                <MetricCard label="Pipeline ARR" value={fmtArr(metrics.totalPipeline)} color="red" />
              </ClickableCard>
              <ClickableCard onClick={() => openDrilldown({ type: 'activities' })}>
                <MetricCard label="Launched ARR" value={fmtArr(metrics.totalLaunched)} color="green" />
              </ClickableCard>
              <MetricCard label="Avg CSAT" value={metrics.avgCsat} color="teal" />
            </div>
          </div>

          {/* Metrics row 3: engagement */}
          <div>
            <div style={sectionLabelStyle}>Engagement</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <ClickableCard onClick={() => openDrilldown({ type: 'companies' })}>
                <MetricCard label="Company Attendances (per-event)" value={metrics.totalCompanies} color="blue" />
              </ClickableCard>
              <ClickableCard onClick={() => openDrilldown({ type: 'accounts' })}>
                <MetricCard label="SFDC Accounts Matched" value={metrics.totalAccounts} color="purple" />
              </ClickableCard>
              <ClickableCard onClick={() => openDrilldown({ type: 'activities' })}>
                <MetricCard label="Activities Logged" value={metrics.totalActivities} color="orange" />
              </ClickableCard>
              <ClickableCard onClick={() => openDrilldown({ type: 'amnotifs' })}>
                <MetricCard label="AM Notifications Sent" value={metrics.totalAMNotifs} color="red" />
              </ClickableCard>
            </div>
          </div>

          {/* Metrics row 4: UNIQUE across all events (de-duplicated) */}
          <div>
            <div style={sectionLabelStyle}>
              Unique Across All Events (de-duplicated)
              {!uniqueReady && (
                <span style={{ fontWeight: 400, textTransform: 'none', color: '#5f6b7a', marginLeft: 8 }}>
                  <Spinner size="normal" /> loading detail data…
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <MetricCard label="Unique Registrations" value={uniqueReady ? uniqueMetrics.uniquePeople : '—'} color="green" />
              <MetricCard label="Unique Attendees" value={uniqueReady ? uniqueMetrics.uniquePeople : '—'} color="teal" />
              <MetricCard label="Unique Avg Attendance" value={uniqueReady ? `${uniqueMetrics.blendedAttendance}%` : '—'} color="purple" />
              <MetricCard label="Unique Companies" value={uniqueReady ? uniqueMetrics.uniqueCompanies : '—'} color="blue" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 16 }}>
              <MetricCard label="Unique SFDC Accounts" value={uniqueReady ? uniqueMetrics.uniqueAccounts : '—'} color="purple" />
              <MetricCard label="Unique Total ARR Influenced" value={uniqueReady ? fmtArr(uniqueMetrics.uniqueTotalArr) : '—'} color="orange" />
              <MetricCard label="Unique Pipeline ARR" value={uniqueReady ? fmtArr(uniqueMetrics.uniquePipeline) : '—'} color="red" />
              <MetricCard label="Unique Launched ARR" value={uniqueReady ? fmtArr(uniqueMetrics.uniqueLaunched) : '—'} color="green" />
            </div>
            <Box variant="small" color="text-status-inactive" padding={{ top: 'xs' }}>
              De-duplicated across all events: people by email, companies by domain, accounts by SFDC Account ID, and ARR by distinct Opportunity ID.
              "Unique Registrations" and "Unique Attendees" reflect distinct people in the attendance data (registrant-level identity isn't separately tracked).
              "Unique Avg Attendance" is the blended rate (total attendees ÷ total registrations).
            </Box>
          </div>

          {/* Charts row 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Container header={<Header variant="h2">ARR Influenced by Event ($M)</Header>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={arrChartData} margin={{ top: 8, right: 16, left: 8, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" tick={tickStyle} interval={0} />
                  <YAxis tickFormatter={v => `$${v}M`} tick={tickStyle} />
                  <Tooltip formatter={(v: number) => [`$${v}M`]} />
                  <Legend />
                  <Bar dataKey="Pipeline" stackId="a" fill="#0073bb" />
                  <Bar dataKey="Launched" stackId="a" fill="#1a8754" />
                </BarChart>
              </ResponsiveContainer>
            </Container>

            <Container header={<Header variant="h2">Registrations vs Attendees</Header>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={attendanceChartData} margin={{ top: 8, right: 16, left: 8, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" tick={tickStyle} interval={0} />
                  <YAxis tick={tickStyle} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Registrations" fill="#0073bb" />
                  <Bar dataKey="Attendees" fill="#ff9900" />
                </BarChart>
              </ResponsiveContainer>
            </Container>
          </div>

          {/* Charts row 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Container header={<Header variant="h2">CSAT by Event</Header>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={csatChartData} margin={{ top: 8, right: 16, left: 8, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" tick={tickStyle} interval={0} />
                  <YAxis domain={[0, 5]} tick={tickStyle} />
                  <Tooltip />
                  <Bar dataKey="CSAT" fill="#7b61ff" />
                </BarChart>
              </ResponsiveContainer>
            </Container>

            <Container header={<Header variant="h2">Activities & AM Notifications</Header>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={activitiesChartData} margin={{ top: 8, right: 16, left: 8, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" tick={tickStyle} interval={0} />
                  <YAxis tick={tickStyle} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Activities" fill="#0073bb" />
                  <Bar dataKey="AM Notifications" fill="#ff9900" />
                </BarChart>
              </ResponsiveContainer>
            </Container>
          </div>

          {/* Unique ARR by Division — de-duplicated by Opp ID, with drill-down */}
          {uniqueReady && uniqueDivisionSummary.length > 0 && (() => {
            const uniqueAcctsWithOpps = new Set(
              Array.from(dedupedOpps.values()).map(o => o.accountId).filter(Boolean)
            ).size
            const totalWithoutOpps = Math.max(0, uniqueMetrics.uniqueAccounts - uniqueAcctsWithOpps)
            const totalPipeline = uniqueDivisionSummary.reduce((s, d) => s + d.pipelineARR, 0)
            const totalLaunched = uniqueDivisionSummary.reduce((s, d) => s + d.launchedARR, 0)
            const totalARR = uniqueDivisionSummary.reduce((s, d) => s + d.totalARR, 0)
            const statBox = (label: string, value: string | number, color: string) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#687078' }}>{label}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
              </div>
            )
            return (
              <Container header={
                <Header
                  variant="h2"
                  description="Opportunities de-duplicated by Opp ID across all events. Click a division row to drill down."
                  actions={<CsvExportButton disabled={uniqueDivisionSummary.length === 0} onClick={() => exportRowsToCsv('unique-arr-by-division.csv',
                    ['Division', 'Accts w/ Opps', 'Pipeline ARR', 'Launched ARR', 'Total ARR'],
                    sortByColumn(uniqueDivisionSummary, divSort.sortingColumn, divSort.sortingDescending).map((d: DivisionRow) => [d.division, d.accounts, d.pipelineARR, d.launchedARR, d.totalARR]))} />}
                >
                  Unique ARR by Division
                </Header>
              }>
                <SpaceBetween size="m">
                  <Table
                    columnDefinitions={[
                      { id: 'division', header: 'Division', cell: (d: DivisionRow) => (
                        <Button variant="link" onClick={() => openDrilldown({ type: 'division', division: d.division, unique: true })}>
                          {d.division}
                        </Button>
                      ), sortingField: 'division' },
                      { id: 'accounts', header: 'Accts w/ Opps', cell: (d: DivisionRow) => d.accounts, sortingField: 'accounts' },
                      {
                        id: 'pipeline', header: 'Pipeline ARR',
                        cell: (d: DivisionRow) => d.pipelineARR > 0 ? `$${d.pipelineARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-',
                        sortingField: 'pipelineARR',
                      },
                      {
                        id: 'launched', header: 'Launched ARR',
                        cell: (d: DivisionRow) => d.launchedARR > 0 ? `$${d.launchedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-',
                        sortingField: 'launchedARR',
                      },
                      {
                        id: 'total', header: 'Total ARR',
                        cell: (d: DivisionRow) => d.totalARR > 0 ? `$${d.totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-',
                        sortingField: 'totalARR',
                      },
                    ]}
                    items={sortByColumn(uniqueDivisionSummary, divSort.sortingColumn, divSort.sortingDescending)}
                    sortingColumn={divSort.sortingColumn}
                    sortingDescending={divSort.sortingDescending}
                    onSortingChange={divSort.onSortingChange}
                    variant="embedded"
                    stripedRows
                  />
                  <div style={{
                    display: 'flex',
                    gap: 32,
                    padding: '14px 20px',
                    background: '#f8f9fa',
                    borderRadius: 8,
                    border: '1px solid #e9ebed',
                    flexWrap: 'wrap',
                  }}>
                    {statBox('Accts w/ Opps', uniqueAcctsWithOpps, '#1a8754')}
                    <div style={{ width: 1, background: '#e9ebed' }} />
                    {statBox('Accts w/o Opps', totalWithoutOpps, '#d91515')}
                    <div style={{ width: 1, background: '#e9ebed' }} />
                    {statBox('Unique SFDC Accounts', uniqueMetrics.uniqueAccounts, '#0073bb')}
                    <div style={{ width: 1, background: '#e9ebed', marginLeft: 'auto' }} />
                    {statBox('Pipeline ARR', `$${totalPipeline.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#0073bb')}
                    <div style={{ width: 1, background: '#e9ebed' }} />
                    {statBox('Launched ARR', `$${totalLaunched.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#1a8754')}
                    <div style={{ width: 1, background: '#e9ebed' }} />
                    {statBox('Total ARR', `$${totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '#ff9900')}
                  </div>
                </SpaceBetween>
              </Container>
            )
          })()}

          {/* No-opp accounts by Territory */}
          {noOppsByTerritory.length > 0 && (
            <Container header={
              <Header
                variant="h2"
                description="Accounts that attended but have no Bedrock / AgentCore / Kiro opportunities in SFDC — grouped by SFDC Territory"
                actions={<CsvExportButton disabled={noOppsByTerritory.length === 0} onClick={() => exportRowsToCsv('accounts-no-genai-opps-by-territory.csv',
                  ['Territory', 'Accounts with No Opps'],
                  sortByColumn(noOppsByTerritory, noOppsSort.sortingColumn, noOppsSort.sortingDescending).map((r: any) => [r.territory, r.accounts]))} />}
              >
                Accounts with No GenAI Opps — by Territory
              </Header>
            }>
              <Table
                columnDefinitions={[
                  { id: 'territory', header: 'Territory', cell: (r: { territory: string; accounts: number }) => r.territory, sortingField: 'territory' },
                  { id: 'accounts', header: 'Accounts with No Opps', cell: (r: { territory: string; accounts: number }) => r.accounts, sortingField: 'accounts' },
                ]}
                items={sortByColumn(noOppsByTerritory, noOppsSort.sortingColumn, noOppsSort.sortingDescending).slice((noOppsPage - 1) * PAGE_SIZE, noOppsPage * PAGE_SIZE)}
                sortingColumn={noOppsSort.sortingColumn}
                sortingDescending={noOppsSort.sortingDescending}
                onSortingChange={noOppsSort.onSortingChange}
                variant="embedded"
                stripedRows
                pagination={
                  <Pagination
                    currentPageIndex={noOppsPage}
                    pagesCount={Math.max(1, Math.ceil(noOppsByTerritory.length / PAGE_SIZE))}
                    onChange={({ detail }) => setNoOppsPage(detail.currentPageIndex)}
                  />
                }
                footer={
                  <Box textAlign="right">
                    <strong>Total: {noOppsByTerritory.reduce((s, r) => s + r.accounts, 0)} accounts across {noOppsByTerritory.length} territories</strong>
                  </Box>
                }
              />
            </Container>
          )}

          {/* Notable customers */}
          {notableCustomers.length > 0 && (
            <Container header={<Header variant="h2">Notable Customers</Header>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {notableCustomers.map(c => (
                  <span
                    key={c}
                    style={{
                      background: '#f0f4f8',
                      border: '1px solid #d1d5db',
                      borderRadius: 16,
                      padding: '4px 12px',
                      fontSize: 13,
                      color: '#0d1926',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </Container>
          )}

          {/* Per-event detail table */}
          <Container header={<Header
            variant="h2"
            actions={<CsvExportButton disabled={filtered.length === 0} onClick={() => exportRowsToCsv('event-details.csv',
              ['Date', 'Event', 'Host', 'Registrations', 'Attendees', 'Att. %', 'Companies', 'Accounts', 'Activities', 'AM Notifs', 'ARR', 'CSAT'],
              sortByColumn(filtered, eventSort.sortingColumn, eventSort.sortingDescending).map((e: PostEvent) => {
                const rate = e.attendanceRate ?? (e.registrations ? Math.round((e.attendees || 0) / e.registrations * 100) : 0)
                return [e.eventDate, e.eventName, e.primaryHost || '', e.registrations ?? '', e.attendees ?? '', rate > 0 ? `${rate}%` : '', e.uniqueCompanies ?? '', e.accountsMatched ?? '', e.activitiesCreated ?? '', e.amNotificationsSent ?? '', e.totalArrInfluenced || 0, e.csat || '']
              }))} />}
          >Event Details</Header>}>
            <Table
              columnDefinitions={[
                { id: 'date', header: 'Date', cell: (e: PostEvent) => e.eventDate, sortingField: 'eventDate' },
                { id: 'name', header: 'Event', cell: (e: PostEvent) => e.eventName, sortingField: 'eventName' },
                { id: 'host', header: 'Host', cell: (e: PostEvent) => e.primaryHost || '-', sortingField: 'primaryHost' },
                { id: 'reg', header: 'Registrations', cell: (e: PostEvent) => e.registrations ?? '-', sortingComparator: numCmp(e => e.registrations || 0) },
                { id: 'att', header: 'Attendees', cell: (e: PostEvent) => e.attendees ?? '-', sortingComparator: numCmp(e => e.attendees || 0) },
                {
                  id: 'rate', header: 'Att. %',
                  cell: (e: PostEvent) => {
                    const r = e.attendanceRate ?? (e.registrations ? Math.round((e.attendees || 0) / e.registrations * 100) : 0)
                    return r > 0 ? `${r}%` : '-'
                  },
                  sortingComparator: numCmp(e => e.attendanceRate ?? (e.registrations ? Math.round((e.attendees || 0) / e.registrations * 100) : 0)),
                },
                { id: 'companies', header: 'Companies', cell: (e: PostEvent) => e.uniqueCompanies ?? '-', sortingComparator: numCmp(e => e.uniqueCompanies || 0) },
                { id: 'accounts', header: 'Accounts', cell: (e: PostEvent) => e.accountsMatched ?? '-', sortingComparator: numCmp(e => e.accountsMatched || 0) },
                { id: 'activities', header: 'Activities', cell: (e: PostEvent) => e.activitiesCreated ?? '-', sortingComparator: numCmp(e => e.activitiesCreated || 0) },
                { id: 'amnotifs', header: 'AM Notifs', cell: (e: PostEvent) => e.amNotificationsSent ?? '-', sortingComparator: numCmp(e => e.amNotificationsSent || 0) },
                {
                  id: 'arr', header: 'ARR',
                  cell: (e: PostEvent) => {
                    const arr = e.totalArrInfluenced || 0
                    return arr > 0 ? fmtArr(arr) : '-'
                  },
                  sortingComparator: numCmp(e => e.totalArrInfluenced || 0),
                },
                { id: 'csat', header: 'CSAT', cell: (e: PostEvent) => e.csat || '-', sortingComparator: numCmp(e => parseFloat(e.csat || '0') || 0) },
              ]}
              items={sortByColumn(filtered, eventSort.sortingColumn, eventSort.sortingDescending).slice((eventDetailsPage - 1) * PAGE_SIZE, eventDetailsPage * PAGE_SIZE)}
              sortingColumn={eventSort.sortingColumn}
              sortingDescending={eventSort.sortingDescending}
              onSortingChange={eventSort.onSortingChange}
              variant="embedded"
              stripedRows
              pagination={
                <Pagination
                  currentPageIndex={eventDetailsPage}
                  pagesCount={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
                  onChange={({ detail }) => setEventDetailsPage(detail.currentPageIndex)}
                />
              }
            />
          </Container>
        </SpaceBetween>
        </div>
      )}
    </SpaceBetween>

    {/* Drill-down Modal */}
    <Modal
      visible={drilldown !== null}
      onDismiss={closeDrilldown}
      size="max"
      header={drilldownTitle()}
    >
      {renderDrilldownContent()}
    </Modal>
    </div>
  )
}
