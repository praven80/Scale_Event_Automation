import { useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Link from '@cloudscape-design/components/link'
import { AppState, OppRecord, ActivityPlan, DivisionSummary } from '../types'
import MetricCard from '../components/MetricCard'
import { parseCsv } from '../utils/csvParser'
import { useTableState } from '../utils/useTableState'
import { downloadCsv } from '../utils/csvExport'

const EXCLUDE_STAGES = new Set(['Closed Lost', 'Closed Incomplete'])

interface Props { state: AppState; update: (u: Partial<AppState>) => void }

export default function MatchOppsStep({ state, update }: Props) {
  const [loading, setLoading] = useState(false)

  const runMatch = async () => {
    if (!state.oppsFile && !state.oppsCsvText) return
    setLoading(true)

    const oppsSource = state.oppsFile || new Blob([state.oppsCsvText], { type: 'text/csv' })
    const opps = await parseCsv<OppRecord>(oppsSource)
    const accountIds = new Set(state.enriched.filter(e => e.Status === 'Matched').map(e => e['Account ID']))

    const acctAttendees = new Map<string, { names: string[]; accountName: string; domain: string }>()
    for (const att of state.enriched) {
      if (att.Status !== 'Matched') continue
      const aid = att['Account ID']
      if (!acctAttendees.has(aid)) acctAttendees.set(aid, { names: [], accountName: att['SFDC Account Name'], domain: att.Domain })
      acctAttendees.get(aid)!.names.push(`${att.Visitor} (${att.Email})`)
    }

    const plan: ActivityPlan[] = []
    const seenOpps = new Set<string>()
    for (const opp of opps) {
      const cid = (opp['Customer ID'] || '').trim()
      if (!accountIds.has(cid)) continue
      if (EXCLUDE_STAGES.has((opp.Stage || '').trim())) continue
      const oid = (opp['Opp ID'] || '').trim()
      if (seenOpps.has(oid)) continue
      seenOpps.add(oid)

      const acct = acctAttendees.get(cid)
      if (!acct) continue

      const config = state.config!
      const attendeeList = acct.names.map(n => `- ${n}`).join('\n')
      const desc = config.description_template
        .replace('{campaign_code}', config.campaign_code)
        .replace('{event_name}', config.event_name)
        .replace('{event_date}', config.event_date)
        .replace('{registration_url}', config.registration_url)
        .replace('{attendee_list}', attendeeList)
        .replace('{event_summary}', config.event_summary)

      plan.push({
        'Account ID': cid,
        'SFDC Account Name': acct.accountName,
        Domain: acct.domain,
        'Opp ID': oid,
        'Opp Name': (opp['Opp Name'] || '').trim(),
        Stage: (opp.Stage || '').trim(),
        Description: desc,
        Attendees: acct.names.join(', '),
        'ARR($)': (opp['ARR($)'] || '0').trim(),
        Division: (opp.Division || opp['Division'] || '').trim(),
      })
    }

    const matchedAccounts = new Set(plan.map(p => p['Account ID']))

    // Build enriched lookup for Territory
    const enrichedByAccount = new Map(state.enriched.map(e => [e['Account ID'], e]))

    const skipped = Array.from(acctAttendees.entries())
      .filter(([aid]) => !matchedAccounts.has(aid))
      .map(([aid, info]) => ({
        'Account ID': aid,
        'SFDC Account Name': info.accountName,
        Domain: info.domain,
        Attendees: info.names.join(', '),
        Reason: 'No matching opps',
        Territory: enrichedByAccount.get(aid)?.Territory || 'Unknown',
      }))

    // Compute division summary (accounts with opps)
    const divMap = new Map<string, { accounts: Set<string>; pipelineARR: number; launchedARR: number; totalARR: number }>()
    for (const p of plan) {
      const div = p.Division || 'Unknown'
      if (!divMap.has(div)) divMap.set(div, { accounts: new Set(), pipelineARR: 0, launchedARR: 0, totalARR: 0 })
      const entry = divMap.get(div)!
      entry.accounts.add(p['Account ID'])
      const arr = parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0
      entry.totalARR += arr
      if (p.Stage === 'Launched') entry.launchedARR += arr
      else entry.pipelineARR += arr
    }
    const divisionSummary: DivisionSummary[] = [...divMap.entries()].map(([division, d]) => ({
      division, accounts: d.accounts.size, pipelineARR: d.pipelineARR, launchedARR: d.launchedARR, totalARR: d.totalARR,
    })).sort((a, b) => b.totalARR - a.totalARR)

    // Compute no-opps breakdown by Territory
    const noOppsMap = new Map<string, Set<string>>()
    for (const s of skipped) {
      const territory = s.Territory || 'Unknown'
      if (!noOppsMap.has(territory)) noOppsMap.set(territory, new Set())
      noOppsMap.get(territory)!.add(s['Account ID'])
    }
    const noOppsByTerritory = [...noOppsMap.entries()]
      .map(([territory, accts]) => ({ territory, accounts: accts.size }))
      .sort((a, b) => b.accounts - a.accounts)

    update({ matchResults: { plan, skipped }, divisionSummary, noOppsByTerritory })
    setLoading(false)
  }

  const { plan, skipped } = state.matchResults
  const planTable = useTableState(plan, { defaultSortField: 'SFDC Account Name' })
  const skippedTable = useTableState(skipped, { defaultSortField: 'SFDC Account Name' })

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Match Opportunities</Header>}>
        <SpaceBetween size="m">
          <Button variant="primary" loading={loading} onClick={runMatch} disabled={state.enriched.length === 0 || (!state.oppsFile && !state.oppsCsvText)}>
            Run Opp Matching
          </Button>
          {plan.length > 0 && <StatusIndicator type="success">{plan.length} activities across {new Set(plan.map(p => p['Account ID'])).size} accounts</StatusIndicator>}
        </SpaceBetween>
      </Container>

      {plan.length > 0 && (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Summary</Header>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              <MetricCard label="Activities to Create" value={plan.length} color="blue" />
              <MetricCard label="Accounts with Opps" value={new Set(plan.map(p => p['Account ID'])).size} color="green" />
              <MetricCard label="Accounts Skipped" value={skipped.length} color="red" />
              <MetricCard label="Unique Opps" value={new Set(plan.map(p => p['Opp ID'])).size} color="purple" />
              <MetricCard label="Total ARR Influenced" value={`$${plan.reduce((s, p) => s + (parseFloat((p['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="orange" />
            </div>
          </Container>

          <Container header={<Header variant="h2" counter={`(${plan.length})`} actions={<Button iconName="download" onClick={() => downloadCsv(plan, 'activity_plan.csv', [{ field: 'SFDC Account Name', header: 'Account' }, { field: 'Opp ID', header: 'Opp ID' }, { field: 'Opp Name', header: 'Opportunity' }, { field: 'Stage', header: 'Stage' }, { field: 'ARR($)', header: 'ARR($)' }, { field: 'Division', header: 'Division' }, { field: 'Attendees', header: 'Attendees' }])}>Download CSV</Button>}>Activity Plan</Header>}>
            <Table
              columnDefinitions={[
                { id: 'account', header: 'Account', cell: (e: ActivityPlan) => e['SFDC Account Name'], sortingField: 'SFDC Account Name' },
                { id: 'opp', header: 'Opportunity', cell: (e: ActivityPlan) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${e['Opp ID']}/view`} external>{e['Opp Name']}</Link>, sortingField: 'Opp Name' },
                { id: 'stage', header: 'Stage', cell: (e: ActivityPlan) => e.Stage, sortingField: 'Stage' },
                { id: 'arr', header: 'ARR($)', cell: (e: ActivityPlan) => `$${(parseFloat((e['ARR($)'] || '0').replace(/[^0-9.-]/g, '')) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sortingField: 'ARR($)' },
                { id: 'division', header: 'Division', cell: (e: ActivityPlan) => e.Division || '—', sortingField: 'Division' },
              ]}
              items={planTable.paged}
              sortingColumn={planTable.sortField ? { sortingField: planTable.sortField } : undefined}
              sortingDescending={!planTable.sortAsc}
              onSortingChange={({ detail }) => planTable.onSort(detail.sortingColumn.sortingField!)}
              filter={<TextFilter filteringText={planTable.filterText} filteringPlaceholder="Filter activities..." onChange={({ detail }) => planTable.setFilterText(detail.filteringText)} />}
              pagination={<Pagination currentPageIndex={planTable.currentPage} pagesCount={planTable.totalPages} onChange={({ detail }) => planTable.setCurrentPage(detail.currentPageIndex)} />}
              variant="embedded"
              stripedRows
              stickyHeader
            />
          </Container>

          {state.divisionSummary.length > 0 && (
            <Container header={<Header variant="h2">Division Breakdown</Header>}>
              <Table
                columnDefinitions={[
                  { id: 'div', header: 'Division', cell: (e: DivisionSummary) => e.division || 'Unknown', sortingField: 'division' },
                  { id: 'accts', header: 'Accounts', cell: (e: DivisionSummary) => e.accounts },
                  { id: 'pipeline', header: 'Pipeline ARR', cell: (e: DivisionSummary) => `$${e.pipelineARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                  { id: 'launched', header: 'Launched ARR', cell: (e: DivisionSummary) => `$${e.launchedARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                  { id: 'total', header: 'Total ARR', cell: (e: DivisionSummary) => `$${e.totalARR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                ]}
                items={state.divisionSummary}
                variant="embedded"
                stripedRows
              />
            </Container>
          )}

          {skipped.length > 0 && (
            <Container header={<Header variant="h2" counter={`(${skipped.length})`} actions={<Button iconName="download" onClick={() => downloadCsv(skipped, 'skipped_accounts.csv', [{ field: 'SFDC Account Name', header: 'Account' }, { field: 'Domain', header: 'Domain' }, { field: 'Attendees', header: 'Attendees' }, { field: 'Reason', header: 'Reason' }])}>Download CSV</Button>}>Skipped (No Matching Opps)</Header>}>
              <Table
                columnDefinitions={[
                  { id: 'account', header: 'Account', cell: (e: any) => e['SFDC Account Name'], sortingField: 'SFDC Account Name' },
                  { id: 'domain', header: 'Domain', cell: (e: any) => e.Domain, sortingField: 'Domain' },
                  { id: 'attendees', header: 'Attendees', cell: (e: any) => e.Attendees?.substring(0, 80) },
                ]}
                items={skippedTable.paged}
                sortingColumn={skippedTable.sortField ? { sortingField: skippedTable.sortField } : undefined}
                sortingDescending={!skippedTable.sortAsc}
                onSortingChange={({ detail }) => skippedTable.onSort(detail.sortingColumn.sortingField!)}
                filter={<TextFilter filteringText={skippedTable.filterText} filteringPlaceholder="Filter skipped..." onChange={({ detail }) => skippedTable.setFilterText(detail.filteringText)} />}
                pagination={<Pagination currentPageIndex={skippedTable.currentPage} pagesCount={skippedTable.totalPages} onChange={({ detail }) => skippedTable.setCurrentPage(detail.currentPageIndex)} />}
                variant="embedded"
                stripedRows
              />
            </Container>
          )}
        </SpaceBetween>
      )}
    </SpaceBetween>
  )
}
