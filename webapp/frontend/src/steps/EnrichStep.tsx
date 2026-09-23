import { useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Table from '@cloudscape-design/components/table'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import Modal from '@cloudscape-design/components/modal'
import Box from '@cloudscape-design/components/box'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Spinner from '@cloudscape-design/components/spinner'
import { AppState, EnrichedAttendee, AccountCandidate } from '../types'
import MetricCard from '../components/MetricCard'
import { apiPost } from '../utils/api'
import { useTableState } from '../utils/useTableState'
import { downloadCsv } from '../utils/csvExport'

interface Props { state: AppState; update: (u: Partial<AppState>) => void }

export default function EnrichStep({ state, update }: Props) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  // --- AM override modal state ---
  const [overrideRow, setOverrideRow] = useState<EnrichedAttendee | null>(null)
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [overrideError, setOverrideError] = useState('')
  const [manualAccountId, setManualAccountId] = useState('')

  const closeOverride = () => {
    setOverrideRow(null)
    setOverrideError('')
    setManualAccountId('')
  }

  // Apply a chosen account (either a candidate or a manually-entered ID) to all
  // attendees sharing the same domain as the row that opened the modal.
  const applyOverride = async (accountId: string) => {
    if (!overrideRow || !accountId.trim()) return
    setOverrideLoading(true)
    setOverrideError('')
    try {
      const data = await apiPost('/resolve-account', {
        accountId: accountId.trim(),
        domain: overrideRow.Domain,
      })
      const r = data.result
      if (!r || !r.account_id) {
        setOverrideError('Account not found or insufficient access.')
        setOverrideLoading(false)
        return
      }
      const targetDomain = overrideRow.Domain
      const updated = state.enriched.map(att => {
        if (att.Domain !== targetDomain) return att
        return {
          ...att,
          'SFDC Account Name': r.account_name || 'Not Found',
          'Account ID': r.account_id,
          'AM Name': r.am_name || 'Not Found',
          'AM Alias': r.am_alias || 'Not Found',
          'AM Email': r.am_alias && r.am_alias !== 'Not Found' ? `${r.am_alias}@amazon.com` : 'Not Found',
          'AM ID': r.am_id || '',
          Territory: r.territory || 'Not Found',
          Region: r.region || '',
          Division: r.division || '',
          Status: 'Matched' as const,
          Confidence: 'MANUAL' as const,
          IsManualOverride: true,
        }
      })
      update({ enriched: updated })
      closeOverride()
    } catch (err: any) {
      setOverrideError(err.message || String(err))
    } finally {
      setOverrideLoading(false)
    }
  }

  const uniqueDomains = [...new Set(state.filtered.searchable.map(a => a.Domain))]
  const [failedDomains, setFailedDomains] = useState<string[]>([])

  const enrichDomains = async (domains: string[], existingResults?: Map<string, any>) => {
    setLoading(true)
    setProgress(0)
    setErrors([])
    setStatusMsg('Starting SFDC lookups...')

    const domainResults = existingResults || new Map<string, any>()
    const errList: string[] = []
    const failed: string[] = []
    const concurrency = 5

    let completed = 0
    const processDomain = async (domain: string) => {
      try {
        const data = await apiPost('/enrich', { domains: [domain] })
        if (data.error) {
          errList.push(`${domain}: ${data.error}`)
          failed.push(domain)
        } else {
          for (const r of (data.results || [])) {
            domainResults.set(r.domain, r)
            if (r.error) {
              errList.push(`${r.domain}: ${r.error}`)
              failed.push(r.domain)
            }
          }
        }
      } catch (err: any) {
        errList.push(`${domain}: ${err.message}`)
        failed.push(domain)
      }
      completed++
      setProgress(Math.round((completed / domains.length) * 100))
      setStatusMsg(`Looking up domains... ${completed} of ${domains.length}`)
    }

    // Run `concurrency` domains in parallel
    for (let i = 0; i < domains.length; i += concurrency) {
      const chunk = domains.slice(i, i + concurrency)
      await Promise.all(chunk.map(processDomain))
    }

    const enriched: EnrichedAttendee[] = state.filtered.searchable.map(att => {
      const result = domainResults.get(att.Domain)
      if (result && result.account_id) {
        return {
          ...att,
          'SFDC Account Name': result.account_name || 'Not Found',
          'Account ID': result.account_id,
          'AM Name': result.am_name || 'Not Found',
          'AM Alias': result.am_alias || 'Not Found',
          'AM Email': result.am_alias && result.am_alias !== 'Not Found' ? `${result.am_alias}@amazon.com` : 'Not Found',
          'AM ID': result.am_id || '',
          Territory: result.territory || 'Not Found',
          Region: result.region || '',
          Division: result.division || '',
          Status: 'Matched' as const,
          Confidence: result.confidence || 'LOW',
          Candidates: result.candidates || [],
          IsManualOverride: false,
        }
      }
      return {
        ...att,
        'SFDC Account Name': 'Not Found', 'Account ID': 'Not Found',
        'AM Name': 'Not Found', 'AM Alias': 'Not Found', 'AM Email': 'Not Found',
        'AM ID': '',
        Territory: 'Not Found', Region: '', Division: '', Status: 'Not Found' as const,
        Confidence: 'NONE' as const,
        Candidates: [],
        IsManualOverride: false,
      }
    })

    update({ enriched })
    setErrors(errList)
    setFailedDomains(failed)
    const matched = enriched.filter(e => e.Status === 'Matched').length
    setStatusMsg(`Done! ${matched} matched, ${enriched.length - matched} not found.${failed.length > 0 ? ` ${failed.length} errors.` : ''}`)
    setLoading(false)
  }

  const runEnrichment = () => enrichDomains(uniqueDomains)

  const retryFailed = () => {
    // Collect existing successful results to preserve them
    const existingResults = new Map<string, any>()
    for (const att of state.enriched) {
      if (att.Status === 'Matched' && att['Account ID'] !== 'Not Found') {
        existingResults.set(att.Domain, {
          domain: att.Domain,
          account_name: att['SFDC Account Name'],
          account_id: att['Account ID'],
          am_name: att['AM Name'],
          am_alias: att['AM Alias'],
          territory: att.Territory,
          confidence: att.Confidence || 'LOW',
          candidates: att.Candidates || [],
        })
      }
    }
    enrichDomains(failedDomains, existingResults)
  }

  const matched = state.enriched.filter(e => e.Status === 'Matched')
  const notFound = state.enriched.filter(e => e.Status === 'Not Found')
  const matchedTable = useTableState(matched, { defaultSortField: 'SFDC Account Name' })
  const notFoundTable = useTableState(notFound, { defaultSortField: 'Visitor' })

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">SFDC Account Lookup</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">
            Searches SFDC for each unique email domain ({uniqueDomains.length} domains) to find account details and AM info.
          </Alert>
          <SpaceBetween size="s" direction="horizontal">
            <Button variant="primary" loading={loading} onClick={runEnrichment} disabled={uniqueDomains.length === 0}>
              {loading ? 'Enriching...' : `Start Enrichment (${uniqueDomains.length} domains)`}
            </Button>
            {failedDomains.length > 0 && !loading && (
              <Button onClick={retryFailed}>
                Retry Failed ({failedDomains.length})
              </Button>
            )}
          </SpaceBetween>
          {loading && <ProgressBar value={progress} label={statusMsg} />}
          {!loading && statusMsg && <StatusIndicator type={errors.length > 0 ? 'warning' : 'success'}>{statusMsg}</StatusIndicator>}
          {errors.length > 0 && (
            <Alert type="warning" header={`${errors.length} errors`}>
              {errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
              {errors.length > 5 && <div>...and {errors.length - 5} more</div>}
            </Alert>
          )}
        </SpaceBetween>
      </Container>

      {state.enriched.length > 0 && (
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Enrichment Summary</Header>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              <MetricCard label="Total Enriched" value={state.enriched.length} color="blue" />
              <MetricCard label="Matched Attendees" value={matched.length} color="green" />
              <MetricCard label="Unique Accounts" value={new Set(matched.map(m => m['Account ID'])).size} color="purple" />
              <MetricCard
                label="Low Confidence"
                value={matched.filter(m => (m.Confidence || 'LOW') === 'LOW').length}
                color="orange"
              />
              <MetricCard label="Not Found" value={notFound.length} color="red" />
            </div>
          </Container>
          <Container header={<Header variant="h2" counter={`(${matched.length})`} actions={<Button iconName="download" onClick={() => downloadCsv(matched, 'matched_accounts.csv', [{ field: 'Visitor', header: 'Name' }, { field: 'Email', header: 'Email' }, { field: 'Company', header: 'Company' }, { field: 'Domain', header: 'Domain' }, { field: 'SFDC Account Name', header: 'SFDC Account' }, { field: 'Account ID', header: 'Account ID' }, { field: 'AM Name', header: 'AM Name' }, { field: 'AM Alias', header: 'AM Alias' }, { field: 'AM Email', header: 'AM Email' }, { field: 'Territory', header: 'Territory' }, { field: 'Confidence', header: 'Confidence' }])}>Download CSV</Button>}>Matched Accounts</Header>}>
            {(() => {
              const lowCount = matched.filter(m => (m.Confidence || 'LOW') === 'LOW').length
              if (lowCount === 0) return null
              return (
                <Box padding={{ bottom: 's' }}>
                  <Alert type="warning">
                    <b>{lowCount}</b> of {matched.length} matches have <b>LOW</b> confidence — the SFDC account's website doesn't exactly match the email domain.
                    Click "Change AM" on a row to pick a better candidate before drafting AM emails.
                  </Alert>
                </Box>
              )
            })()}
            <Table
              columnDefinitions={[
                { id: 'name', header: 'Name', cell: (e: EnrichedAttendee) => e.Visitor, sortingField: 'Visitor' },
                { id: 'account', header: 'SFDC Account', cell: (e: EnrichedAttendee) => e['SFDC Account Name'], sortingField: 'SFDC Account Name' },
                { id: 'am', header: 'AM', cell: (e: EnrichedAttendee) => e['AM Name'], sortingField: 'AM Name' },
                { id: 'territory', header: 'Territory', cell: (e: EnrichedAttendee) => e.Territory, sortingField: 'Territory' },
                { id: 'domain', header: 'Domain', cell: (e: EnrichedAttendee) => e.Domain, sortingField: 'Domain' },
                {
                  id: 'confidence',
                  header: 'Confidence',
                  sortingField: 'Confidence',
                  cell: (e: EnrichedAttendee) => {
                    const c = e.Confidence || 'LOW'
                    if (c === 'HIGH') return <StatusIndicator type="success">High</StatusIndicator>
                    if (c === 'MANUAL') return <StatusIndicator type="info">Manual</StatusIndicator>
                    if (c === 'LOW') return <StatusIndicator type="warning">Low</StatusIndicator>
                    return <StatusIndicator type="stopped">—</StatusIndicator>
                  },
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: (e: EnrichedAttendee) => (
                    <Button
                      variant="inline-link"
                      onClick={() => {
                        setOverrideRow(e)
                        setManualAccountId('')
                        setOverrideError('')
                      }}
                    >
                      Change AM
                    </Button>
                  ),
                },
              ]}
              items={matchedTable.paged}
              sortingColumn={matchedTable.sortField ? { sortingField: matchedTable.sortField } : undefined}
              sortingDescending={!matchedTable.sortAsc}
              onSortingChange={({ detail }) => matchedTable.onSort(detail.sortingColumn.sortingField!)}
              filter={<TextFilter filteringText={matchedTable.filterText} filteringPlaceholder="Filter matched..." onChange={({ detail }) => matchedTable.setFilterText(detail.filteringText)} />}
              pagination={<Pagination currentPageIndex={matchedTable.currentPage} pagesCount={matchedTable.totalPages} onChange={({ detail }) => matchedTable.setCurrentPage(detail.currentPageIndex)} />}
              variant="embedded"
              stripedRows
              stickyHeader
            />
          </Container>
          {notFound.length > 0 && (
            <Container header={<Header variant="h2" counter={`(${notFound.length})`} actions={<Button iconName="download" onClick={() => downloadCsv(notFound, 'not_found.csv', [{ field: 'Visitor', header: 'Name' }, { field: 'Email', header: 'Email' }, { field: 'Domain', header: 'Domain' }, { field: 'Company', header: 'Company' }])}>Download CSV</Button>}>Not Found</Header>}>
              <Table
                columnDefinitions={[
                  { id: 'visitor', header: 'Name', cell: (e: EnrichedAttendee) => e.Visitor, sortingField: 'Visitor' },
                  { id: 'email', header: 'Email', cell: (e: EnrichedAttendee) => e.Email, sortingField: 'Email' },
                  { id: 'domain', header: 'Domain', cell: (e: EnrichedAttendee) => e.Domain, sortingField: 'Domain' },
                  { id: 'company', header: 'Company', cell: (e: EnrichedAttendee) => e.Company, sortingField: 'Company' },
                ]}
                items={notFoundTable.paged}
                sortingColumn={notFoundTable.sortField ? { sortingField: notFoundTable.sortField } : undefined}
                sortingDescending={!notFoundTable.sortAsc}
                onSortingChange={({ detail }) => notFoundTable.onSort(detail.sortingColumn.sortingField!)}
                filter={<TextFilter filteringText={notFoundTable.filterText} filteringPlaceholder="Filter not found..." onChange={({ detail }) => notFoundTable.setFilterText(detail.filteringText)} />}
                pagination={<Pagination currentPageIndex={notFoundTable.currentPage} pagesCount={notFoundTable.totalPages} onChange={({ detail }) => notFoundTable.setCurrentPage(detail.currentPageIndex)} />}
                variant="embedded"
                stripedRows
              />
            </Container>
          )}
        </SpaceBetween>
      )}

      {/* AM-override modal — surfaces alternate candidates for LOW-confidence matches */}
      {overrideRow && (
        <Modal
          visible
          onDismiss={closeOverride}
          size="max"
          header={`Change AM for domain "${overrideRow.Domain}"`}
          footer={
            <Box float="right">
              <SpaceBetween size="xs" direction="horizontal">
                <Button onClick={closeOverride} disabled={overrideLoading}>Cancel</Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Box>
              <b>Current match:</b> {overrideRow['SFDC Account Name']} — {overrideRow['AM Name']} ({overrideRow['AM Alias']})
              <br />
              <Box variant="small" color="text-status-inactive">
                Account ID: {overrideRow['Account ID']} • Territory: {overrideRow.Territory}
              </Box>
            </Box>

            {(overrideRow.Candidates || []).length > 0 ? (
              <>
                <Box variant="strong">Suggested alternatives:</Box>
                <Table
                  variant="embedded"
                  trackBy="account_id"
                  columnDefinitions={[
                    { id: 'name', header: 'Account Name', cell: (c: AccountCandidate) => c.account_name },
                    { id: 'website', header: 'Website', cell: (c: AccountCandidate) => c.website || '—' },
                    { id: 'country', header: 'Country', cell: (c: AccountCandidate) => c.billing_country || '—' },
                    { id: 'tshirt', header: 'T-Size', cell: (c: AccountCandidate) => c.t_shirt_size || '—' },
                    { id: 'am', header: 'AM', cell: (c: AccountCandidate) => c.am_alias || '—' },
                    { id: 'territory', header: 'Territory', cell: (c: AccountCandidate) => c.territory || '—' },
                    {
                      id: 'pick',
                      header: '',
                      minWidth: 90,
                      cell: (c: AccountCandidate) => (
                        <Button
                          variant="primary"
                          loading={overrideLoading}
                          onClick={() => applyOverride(c.account_id)}
                        >
                          <span style={{ whiteSpace: 'nowrap' }}>Use this</span>
                        </Button>
                      ),
                    },
                  ]}
                  items={overrideRow.Candidates || []}
                  empty={<Box textAlign="center" color="inherit">No candidates returned by SFDC search.</Box>}
                />
              </>
            ) : (
              <Alert type="info">
                No alternate candidates were returned for this domain.
              </Alert>
            )}

            <FormField
              label="Or enter an SFDC Account ID manually"
              description="18-character ID (e.g. 0015000000…). The override applies to all attendees from this domain in this event."
            >
              <Input
                value={manualAccountId}
                onChange={({ detail }) => setManualAccountId(detail.value)}
                placeholder="0015000000abcDEF"
                disabled={overrideLoading}
              />
            </FormField>
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                variant="primary"
                loading={overrideLoading}
                disabled={!manualAccountId.trim()}
                onClick={() => applyOverride(manualAccountId)}
              >
                Apply manual ID
              </Button>
              {overrideLoading && <Spinner />}
            </SpaceBetween>

            {overrideError && <Alert type="error">{overrideError}</Alert>}

            <Box variant="small" color="text-status-inactive">
              The override only changes the account/AM mapping locally for this event.
              It does not write anything back to SFDC.
            </Box>
          </SpaceBetween>
        </Modal>
      )}
    </SpaceBetween>
  )
}
