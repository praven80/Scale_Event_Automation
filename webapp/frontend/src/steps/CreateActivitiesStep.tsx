import { useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Box from '@cloudscape-design/components/box'
import Link from '@cloudscape-design/components/link'
import { AppState, ActivityPlan } from '../types'
import { apiPost } from '../utils/api'
import { useTableState } from '../utils/useTableState'
import { downloadCsv } from '../utils/csvExport'

interface Props { state: AppState; update: (u: Partial<AppState>) => void; onSave?: () => void }

// localStorage key for the campaign-tag workflow. Distinct from the legacy
// `created_opp_ids_<eventId>` key used by the old Create Activities flow so we never
// surface stale data on load.
const STORAGE_KEY = (eventId: string) => `tagged_opp_ids_${eventId}`

function loadTaggedOppIds(eventId: string): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY(eventId))
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch { return new Set() }
}

function saveTaggedOppIds(eventId: string, ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY(eventId), JSON.stringify([...ids]))
}

export default function CreateActivitiesStep({ state, update, onSave }: Props) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [selected, setSelected] = useState<ActivityPlan[]>([])

  const plan = state.matchResults.plan
  const cfg = state.config

  // Only count rows produced by the campaign-tagging workflow. Legacy rows from the
  // previous "Create Activities" step (identified by `task_id` or missing `campaign_id`)
  // are filtered out so the UI never displays stale info.
  const isTagRow = (d: any) => d && d.campaign_id && !d.task_id
  const tagDetails = state.activityResults.details.filter(isTagRow)

  const successOppIds = new Set([
    ...loadTaggedOppIds(state.eventId),
    ...tagDetails.filter(d => d.status === 'SUCCESS').map(d => d.opp_id),
  ])
  const pending = plan.filter(p => !successOppIds.has(p['Opp ID']))
  const alreadyTagged = plan.filter(p => successOppIds.has(p['Opp ID']))
  const planTable = useTableState(pending, { defaultSortField: 'SFDC Account Name' })

  const tagOpps = async (items: ActivityPlan[]) => {
    if (!cfg) return

    if (!cfg.campaign_id) {
      setStatusMsg('No campaign ID found. Set the campaign code in the Event Setup step (it resolves to a campaign ID via SFDC).')
      return
    }

    const latestIds = new Set([
      ...loadTaggedOppIds(state.eventId),
      ...tagDetails.filter(d => d.status === 'SUCCESS').map(d => d.opp_id),
    ])
    const toTag = items.filter(p => !latestIds.has(p['Opp ID']))
    if (toTag.length === 0) {
      setStatusMsg('All selected opportunities already have the campaign tagged.')
      return
    }

    setLoading(true)
    setProgress(0)
    // Build a map keyed by opp_id (only from non-legacy rows) so retries REPLACE prior
    // outcomes and we never carry forward old activity-creation rows.
    const detailsMap = new Map<string, any>(
      tagDetails.map((d: any) => [d.opp_id, d])
    )
    const batchSize = 10
    const concurrency = 10

    const batches: ActivityPlan[][] = []
    for (let i = 0; i < toTag.length; i += batchSize) {
      batches.push(toTag.slice(i, i + batchSize))
    }

    let completed = 0
    const processBatch = async (batch: ActivityPlan[]) => {
      try {
        const data = await apiPost('/tag-opp-campaigns', {
          campaignId: cfg.campaign_id,
          campaignCode: cfg.campaign_code,
          opportunities: batch.map(p => ({
            opp_id: p['Opp ID'],
            account_name: p['SFDC Account Name'],
            opp_name: p['Opp Name'],
          })),
        })
        for (const r of (data.results || [])) {
          detailsMap.set(r.opp_id, r)
          if (r.status === 'SUCCESS') latestIds.add(r.opp_id)
        }
      } catch (err) {
        batch.forEach(p => detailsMap.set(p['Opp ID'], {
          opp_id: p['Opp ID'],
          account_name: p['SFDC Account Name'],
          opp_name: p['Opp Name'],
          status: 'FAILED',
          error: String(err),
        }))
      }
      completed++
      setProgress(Math.round((completed / batches.length) * 100))
      setStatusMsg(`Tagging campaign... ${Math.min(completed * batchSize, toTag.length)} of ${toTag.length}`)
    }

    for (let i = 0; i < batches.length; i += concurrency) {
      const chunk = batches.slice(i, i + concurrency)
      await Promise.all(chunk.map(processBatch))
    }

    const finalDetails = Array.from(detailsMap.values())
    const tagOnly = finalDetails.filter(isTagRow)
    saveTaggedOppIds(state.eventId, latestIds)
    update({
      activityResults: {
        created: tagOnly.filter(d => d.status === 'SUCCESS').length,
        failed: tagOnly.filter(d => d.status === 'FAILED').length,
        details: finalDetails,
      },
      createdOppIds: latestIds,
    })
    setSelected([])
    setStatusMsg(`Done! ${tagOnly.filter(d => d.status === 'SUCCESS').length} tagged, ${tagOnly.filter(d => d.status === 'FAILED').length} failed.`)
    setLoading(false)
    setTimeout(() => onSave?.(), 500)
  }

  // Counts derived only from tag-workflow rows (legacy activity rows are excluded).
  const created = tagDetails.filter(d => d.status === 'SUCCESS').length
  const failed = tagDetails.filter(d => d.status === 'FAILED').length
  const details = tagDetails
  const detailsTable = useTableState(details)
  const alreadyTaggedTable = useTableState(alreadyTagged, { defaultSortField: 'SFDC Account Name' })

  const clearFailures = () => {
    // Drop only failed tag rows; preserve any legacy rows so we don't lose them on disk.
    const remaining = state.activityResults.details.filter(d => !(isTagRow(d) && d.status === 'FAILED'))
    const remainingTagged = remaining.filter(isTagRow)
    update({
      activityResults: {
        created: remainingTagged.filter(d => d.status === 'SUCCESS').length,
        failed: 0,
        details: remaining,
      },
    })
    setStatusMsg('')
    setTimeout(() => onSave?.(), 200)
  }

  const resetAllResults = () => {
    // Wipe both in-memory tag results and the localStorage cache. Legacy activity-creation
    // rows are also dropped here since the user explicitly asked to start fresh.
    localStorage.removeItem(STORAGE_KEY(state.eventId))
    update({
      activityResults: { created: 0, failed: 0, details: [] },
      createdOppIds: new Set<string>(),
    })
    setSelected([])
    setStatusMsg('Results cleared.')
    setTimeout(() => onSave?.(), 200)
  }

  const campaignCode = cfg?.campaign_code || ''
  const campaignId = cfg?.campaign_id || ''
  const campaignReady = Boolean(campaignId)

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Campaign Tagging</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <Box>
              <Box variant="awsui-key-label">Campaign Code</Box>
              <Box variant="p">{campaignCode || <i>not set</i>}</Box>
            </Box>
            <Box>
              <Box variant="awsui-key-label">Campaign ID</Box>
              <Box variant="p">{campaignId || <i>not resolved</i>}</Box>
            </Box>
          </ColumnLayout>
          {!campaignReady && (
            <Alert type="warning">
              Campaign ID is not resolved. Open the Event Setup step, enter a campaign code, and let it look up the SFDC campaign before tagging here.
            </Alert>
          )}
          {campaignReady && (
            <Alert type="info">
              Each selected opportunity will be updated in SFDC so its <b>Campaign</b> field points to <b>{campaignCode || campaignId}</b>. Already-tagged opportunities (from prior runs) are excluded automatically.
            </Alert>
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2" actions={
        details.length > 0 ? (
          <Button onClick={() => { if (window.confirm(`Reset all results (${details.length} row(s)) and clear "Already Tagged"? This only clears local state — it does NOT untag anything in SFDC.`)) resetAllResults() }}>Reset Results</Button>
        ) : undefined
      }>Tag Campaign Code on Opportunities</Header>}>
        <SpaceBetween size="m">
          <Table
            columnDefinitions={[
              { id: 'account', header: 'Account', cell: (e: ActivityPlan) => e['SFDC Account Name'], sortingField: 'SFDC Account Name' },
              { id: 'opp', header: 'Opportunity', cell: (e: ActivityPlan) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${e['Opp ID']}/view`} external>{e['Opp Name']}</Link>, sortingField: 'Opp Name' },
              { id: 'stage', header: 'Stage', cell: (e: ActivityPlan) => e.Stage, sortingField: 'Stage' },
            ]}
            items={planTable.paged}
            selectionType="multi"
            selectedItems={selected}
            onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
            trackBy="Opp ID"
            sortingColumn={planTable.sortField ? { sortingField: planTable.sortField } : undefined}
            sortingDescending={!planTable.sortAsc}
            onSortingChange={({ detail }) => planTable.onSort(detail.sortingColumn.sortingField!)}
            filter={<TextFilter filteringText={planTable.filterText} filteringPlaceholder="Filter opportunities..." onChange={({ detail }) => planTable.setFilterText(detail.filteringText)} />}
            pagination={<Pagination currentPageIndex={planTable.currentPage} pagesCount={planTable.totalPages} onChange={({ detail }) => planTable.setCurrentPage(detail.currentPageIndex)} />}
            empty={<Box textAlign="center" color="inherit"><b>All opportunities tagged</b><Box padding={{ bottom: 's' }} variant="p" color="inherit">All matched opportunities already carry this campaign.</Box></Box>}
            variant="embedded"
            stripedRows
            stickyHeader
          />

          <SpaceBetween size="s" direction="horizontal">
            <Button
              variant="primary"
              loading={loading}
              onClick={() => { if (window.confirm(`Tag campaign ${campaignCode || campaignId} on ${selected.length} opportunities? This updates the SFDC Campaign field on each opp.`)) tagOpps(selected) }}
              disabled={!campaignReady || selected.length === 0 || loading}
            >
              {loading ? 'Tagging...' : `Tag Selected (${selected.length})`}
            </Button>
            <Button
              loading={loading}
              onClick={() => { if (window.confirm(`Tag campaign ${campaignCode || campaignId} on ${pending.length} opportunities? This updates the SFDC Campaign field on each opp.`)) tagOpps(pending) }}
              disabled={!campaignReady || pending.length === 0 || loading}
            >
              {loading ? 'Tagging...' : `Tag All Remaining (${pending.length})`}
            </Button>
          </SpaceBetween>

          {loading && <ProgressBar value={progress} label={statusMsg} />}
          {!loading && statusMsg && <StatusIndicator type={failed > 0 ? 'warning' : 'success'}>{statusMsg}</StatusIndicator>}
        </SpaceBetween>
      </Container>

      {details.length > 0 && (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Results</Header>}>
            <ColumnLayout columns={3}>
              <Box><Box variant="awsui-key-label">Tagged</Box><Box variant="awsui-value-large">{created}</Box></Box>
              <Box><Box variant="awsui-key-label">Failed</Box><Box variant="awsui-value-large">{failed}</Box></Box>
              <Box><Box variant="awsui-key-label">Total</Box><Box variant="awsui-value-large">{details.length}</Box></Box>
            </ColumnLayout>
          </Container>
          <Container header={<Header variant="h2" actions={
            <SpaceBetween size="xs" direction="horizontal">
              {failed > 0 && <Button onClick={() => { if (window.confirm(`Clear ${failed} failed row(s) from the results? Successful rows are preserved.`)) clearFailures() }}>Clear failures ({failed})</Button>}
              <Button iconName="download" onClick={() => downloadCsv(details, 'campaign_tag_results.csv', [{ field: 'opp_id', header: 'Opp ID' }, { field: 'account_name', header: 'Account' }, { field: 'opp_name', header: 'Opportunity' }, { field: 'campaign_id', header: 'Campaign ID' }, { field: 'status', header: 'Status' }, { field: 'error', header: 'Error' }])}>Download CSV</Button>
            </SpaceBetween>
          }>Details</Header>}>
            <Table
              columnDefinitions={[
                { id: 'opp', header: 'Opp ID', cell: (e: any) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${e.opp_id}/view`} external>{e.opp_id}</Link> },
                { id: 'account', header: 'Account', cell: (e: any) => e.account_name || '' },
                { id: 'opp_name', header: 'Opportunity', cell: (e: any) => e.opp_name || '' },
                { id: 'status', header: 'Status', cell: (e: any) => e.status === 'SUCCESS' ? <StatusIndicator type="success">Tagged</StatusIndicator> : <StatusIndicator type="error">Failed</StatusIndicator> },
                { id: 'error', header: 'Error', cell: (e: any) => e.error || '' },
              ]}
              items={detailsTable.paged}
              filter={<TextFilter filteringText={detailsTable.filterText} filteringPlaceholder="Filter results..." onChange={({ detail }) => detailsTable.setFilterText(detail.filteringText)} />}
              pagination={<Pagination currentPageIndex={detailsTable.currentPage} pagesCount={detailsTable.totalPages} onChange={({ detail }) => detailsTable.setCurrentPage(detail.currentPageIndex)} />}
              variant="embedded"
              stripedRows
              stickyHeader
            />
          </Container>
        </SpaceBetween>
      )}

      {alreadyTagged.length > 0 && (
        <Container header={<Header variant="h2" counter={`(${alreadyTagged.length})`} actions={<Button iconName="download" onClick={() => downloadCsv(alreadyTagged, 'already_tagged.csv', [{ field: 'SFDC Account Name', header: 'Account' }, { field: 'Opp ID', header: 'Opp ID' }, { field: 'Opp Name', header: 'Opportunity' }, { field: 'Stage', header: 'Stage' }])}>Download CSV</Button>}>Already Tagged</Header>}>
          <Table
            columnDefinitions={[
              { id: 'account', header: 'Account', cell: (e: ActivityPlan) => e['SFDC Account Name'], sortingField: 'SFDC Account Name' },
              { id: 'opp', header: 'Opportunity', cell: (e: ActivityPlan) => <Link href={`https://aws-crm.lightning.force.com/lightning/r/Opportunity/${e['Opp ID']}/view`} external>{e['Opp Name']}</Link>, sortingField: 'Opp Name' },
              { id: 'stage', header: 'Stage', cell: (e: ActivityPlan) => e.Stage, sortingField: 'Stage' },
              { id: 'status', header: 'Status', cell: () => <StatusIndicator type="success">Tagged</StatusIndicator> },
            ]}
            items={alreadyTaggedTable.paged}
            sortingColumn={alreadyTaggedTable.sortField ? { sortingField: alreadyTaggedTable.sortField } : undefined}
            sortingDescending={!alreadyTaggedTable.sortAsc}
            onSortingChange={({ detail }) => alreadyTaggedTable.onSort(detail.sortingColumn.sortingField!)}
            filter={<TextFilter filteringText={alreadyTaggedTable.filterText} filteringPlaceholder="Filter tagged..." onChange={({ detail }) => alreadyTaggedTable.setFilterText(detail.filteringText)} />}
            pagination={<Pagination currentPageIndex={alreadyTaggedTable.currentPage} pagesCount={alreadyTaggedTable.totalPages} onChange={({ detail }) => alreadyTaggedTable.setCurrentPage(detail.currentPageIndex)} />}
            variant="embedded"
            stripedRows
            stickyHeader
          />
        </Container>
      )}
    </SpaceBetween>
  )
}
