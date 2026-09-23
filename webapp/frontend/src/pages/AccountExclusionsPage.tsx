import { useEffect, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Table from '@cloudscape-design/components/table'
import Button from '@cloudscape-design/components/button'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Textarea from '@cloudscape-design/components/textarea'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import { apiPost } from '../utils/api'
import { useTableState } from '../utils/useTableState'

interface AccountItem {
  accountId: string
  accountName: string
  accountOwner: string
  ownerAlias: string
  territory: string
  bizUnit: string
  geo: string
  namedTerritory: string
  segment: string
  subSegment: string
  addedAt: string
  addedBy: string
}

interface Props {
  onGoHome: () => void
}

export default function AccountExclusionsPage({ onGoHome }: Props) {
  const [items, setItems] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [newTerritory, setNewTerritory] = useState('')
  const [bulkText, setBulkText] = useState('')

  const tbl = useTableState(items, { defaultSortField: 'accountName' })

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await apiPost('/account-exclusions/list', {})
      setItems((data.items || []) as AccountItem[])
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Failed to load: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleAddSingle = async () => {
    const accountId = newId.trim()
    if (!accountId) {
      setStatusMsg({ type: 'error', text: 'Account ID is required' })
      return
    }
    setLoading(true)
    setStatusMsg(null)
    try {
      await apiPost('/account-exclusions/add', {
        accountId,
        accountName: newName.trim(),
        accountOwner: newOwner.trim(),
        territory: newTerritory.trim(),
      })
      setStatusMsg({ type: 'success', text: `Added ${accountId} to AM-email exclusion list.` })
      setNewId('')
      setNewName('')
      setNewOwner('')
      setNewTerritory('')
      await refresh()
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkAdd = async () => {
    // Accept either CSV-like rows or plain account IDs (one per line / comma-separated).
    const rows: any[] = []
    for (const raw of bulkText.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      // CSV row?
      if (line.includes(',')) {
        const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
        // Allow id alone, or id,name, or id,name,owner,territory
        const [id, name = '', owner = '', territory = ''] = parts
        if (id) rows.push({ accountId: id, accountName: name, accountOwner: owner, territory })
      } else {
        rows.push({ accountId: line })
      }
    }
    if (rows.length === 0) {
      setStatusMsg({ type: 'error', text: 'No valid rows found in bulk input.' })
      return
    }
    setLoading(true)
    setStatusMsg(null)
    try {
      const data = await apiPost('/account-exclusions/add', { rows })
      setStatusMsg({ type: 'success', text: `Bulk add: ${data.added || 0} accounts added.` })
      setBulkText('')
      await refresh()
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (item: AccountItem) => {
    if (!confirm(`Remove ${item.accountName || item.accountId} from the AM-email exclusion list?`)) return
    setLoading(true)
    setStatusMsg(null)
    try {
      await apiPost('/account-exclusions/remove', { accountId: item.accountId })
      setStatusMsg({ type: 'success', text: `Removed ${item.accountId}.` })
      await refresh()
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description="Accounts on this list still receive AM post-event emails, but the opportunity list is omitted from the body. Attendees and account name remain."
        actions={<Button onClick={onGoHome}>Back to Home</Button>}
      >
        AM Email — Account Exclusions
      </Header>

      <Alert type="info">
        Use this list when you want to notify the AM that customers attended an event but you don't want to surface
        the customer's GenAI opportunities in the email body. The exclusion is keyed by SFDC <b>Account ID</b>.
      </Alert>

      {statusMsg && (
        <StatusIndicator type={statusMsg.type === 'success' ? 'success' : 'error'}>
          {statusMsg.text}
        </StatusIndicator>
      )}

      <Container header={<Header variant="h2">Add to Exclusion List</Header>}>
        <SpaceBetween size="m">
          <FormField label="Account ID (18-char SFDC ID)" stretch>
            <Input
              value={newId}
              onChange={({ detail }) => setNewId(detail.value)}
              placeholder="0010z00001SZov5AAD"
            />
          </FormField>
          <FormField label="Account Name (optional)" stretch>
            <Input
              value={newName}
              onChange={({ detail }) => setNewName(detail.value)}
              placeholder="e.g. Acme Corp"
            />
          </FormField>
          <FormField label="Account Owner (optional)" stretch>
            <Input
              value={newOwner}
              onChange={({ detail }) => setNewOwner(detail.value)}
              placeholder="e.g. Mike Carrigan"
            />
          </FormField>
          <FormField label="Territory (optional)" stretch>
            <Input
              value={newTerritory}
              onChange={({ detail }) => setNewTerritory(detail.value)}
              placeholder="e.g. NAMED-PS-NAMER-..."
            />
          </FormField>
          <Button variant="primary" onClick={handleAddSingle} disabled={loading}>
            Add to exclusion list
          </Button>

          <FormField
            label="Bulk add"
            description="One per line. Either a bare Account ID, or CSV: accountId,accountName,accountOwner,territory"
            stretch
          >
            <Textarea
              value={bulkText}
              onChange={({ detail }) => setBulkText(detail.value)}
              placeholder="0010z00001SZov5AAD&#10;0010z00001VXBTrAAP,Figaro Castle,Elizabeth Almanza,NAMED-PS-NAMER-..."
              rows={5}
            />
          </FormField>
          <Button onClick={handleBulkAdd} disabled={loading || !bulkText.trim()}>
            Bulk add
          </Button>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2" counter={`(${items.length})`}>Excluded Accounts</Header>}>
        <Table
          loading={loading}
          loadingText="Loading exclusions..."
          columnDefinitions={[
            { id: 'accountId', header: 'Account ID', cell: (e: AccountItem) => e.accountId, sortingField: 'accountId' },
            { id: 'accountName', header: 'Account Name', cell: (e: AccountItem) => e.accountName || '-', sortingField: 'accountName' },
            { id: 'accountOwner', header: 'Account Owner', cell: (e: AccountItem) => e.accountOwner || '-', sortingField: 'accountOwner' },
            { id: 'ownerAlias', header: 'Owner Alias', cell: (e: AccountItem) => e.ownerAlias || '-', sortingField: 'ownerAlias' },
            { id: 'territory', header: 'Territory', cell: (e: AccountItem) => e.territory || '-', sortingField: 'territory' },
            { id: 'segment', header: 'Segment', cell: (e: AccountItem) => e.segment || '-', sortingField: 'segment' },
            { id: 'subSegment', header: 'Sub-Segment', cell: (e: AccountItem) => e.subSegment || '-', sortingField: 'subSegment' },
            { id: 'addedAt', header: 'Added', cell: (e: AccountItem) => e.addedAt ? new Date(e.addedAt).toLocaleString() : '-', sortingField: 'addedAt' },
            {
              id: 'actions',
              header: 'Actions',
              cell: (e: AccountItem) => (
                <Button variant="inline-link" onClick={() => handleRemove(e)} disabled={loading}>
                  Remove
                </Button>
              ),
            },
          ]}
          items={tbl.paged}
          sortingColumn={tbl.sortField ? { sortingField: tbl.sortField } : undefined}
          sortingDescending={!tbl.sortAsc}
          onSortingChange={({ detail }) => tbl.onSort(detail.sortingColumn.sortingField!)}
          filter={
            <TextFilter
              filteringText={tbl.filterText}
              filteringPlaceholder="Filter by ID, name, owner, territory..."
              onChange={({ detail }) => tbl.setFilterText(detail.filteringText)}
              countText={tbl.filtered.length === items.length
                ? `${items.length} matches`
                : `${tbl.filtered.length} of ${items.length} matches`}
            />
          }
          pagination={
            <Pagination
              currentPageIndex={tbl.currentPage}
              pagesCount={tbl.totalPages}
              onChange={({ detail }) => tbl.setCurrentPage(detail.currentPageIndex)}
            />
          }
          empty={
            <Box textAlign="center" color="inherit">
              <b>No excluded accounts</b>
              <Box variant="p" color="inherit">
                Add an Account ID above to omit opportunity details from AM emails for that account.
              </Box>
            </Box>
          }
          variant="embedded"
          stripedRows
          stickyHeader
        />
      </Container>
    </SpaceBetween>
  )
}
