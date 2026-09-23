import { useEffect, useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Tabs from '@cloudscape-design/components/tabs'
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

interface ExclusionItem {
  email: string
  list: 'CUSTOMER' | 'AM'
  name: string
  reason: string
  addedAt: string
  addedBy: string
}

interface Props {
  onGoHome: () => void
}

export default function ExcludeListPage({ onGoHome }: Props) {
  const [activeList, setActiveList] = useState<'CUSTOMER' | 'AM'>('CUSTOMER')
  const [items, setItems] = useState<{ CUSTOMER: ExclusionItem[]; AM: ExclusionItem[] }>({ CUSTOMER: [], AM: [] })
  const [loading, setLoading] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newReason, setNewReason] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Pagination + filter + sort state for each list (hooks must be at top level).
  const customerTable = useTableState(items.CUSTOMER, { defaultSortField: 'email' })
  const amTable = useTableState(items.AM, { defaultSortField: 'email' })

  const refresh = async (listType?: 'CUSTOMER' | 'AM') => {
    const targets: Array<'CUSTOMER' | 'AM'> = listType ? [listType] : ['CUSTOMER', 'AM']
    setLoading(true)
    try {
      const updates: any = { ...items }
      for (const t of targets) {
        const data = await apiPost('/exclude-list/list', { list: t })
        updates[t] = (data.items || []) as ExclusionItem[]
      }
      setItems(updates)
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Failed to load: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const addOne = async (email: string, name: string, reason: string) => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes('@')) throw new Error(`Invalid email: ${email}`)
    await apiPost('/exclude-list/add', { list: activeList, email: trimmed, name, reason })
  }

  const handleAddSingle = async () => {
    if (!newEmail.trim()) {
      setStatusMsg({ type: 'error', text: 'Email is required' })
      return
    }
    setLoading(true)
    setStatusMsg(null)
    try {
      await addOne(newEmail, newName, newReason)
      setStatusMsg({ type: 'success', text: `Added ${newEmail.trim().toLowerCase()} to ${activeList === 'CUSTOMER' ? 'customer' : 'AM'} exclusion list.` })
      setNewEmail('')
      setNewName('')
      setNewReason('')
      await refresh(activeList)
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkAdd = async () => {
    const lines = bulkText
      .split(/[\n,;]/)
      .map(s => s.trim().toLowerCase())
      .filter(s => s && s.includes('@'))
    if (lines.length === 0) {
      setStatusMsg({ type: 'error', text: 'No valid emails found in bulk input.' })
      return
    }
    setLoading(true)
    setStatusMsg(null)
    let added = 0
    let failed = 0
    for (const email of lines) {
      try {
        // Bulk add doesn't support per-email name; only the shared reason is applied.
        await addOne(email, '', newReason)
        added++
      } catch {
        failed++
      }
    }
    setStatusMsg({
      type: failed === 0 ? 'success' : 'error',
      text: `Bulk add: ${added} added, ${failed} failed (out of ${lines.length}).`,
    })
    setBulkText('')
    await refresh(activeList)
    setLoading(false)
  }

  const handleRemove = async (item: ExclusionItem) => {
    if (!confirm(`Remove ${item.email} from the ${activeList === 'CUSTOMER' ? 'customer' : 'AM'} exclusion list?`)) return
    setLoading(true)
    setStatusMsg(null)
    try {
      await apiPost('/exclude-list/remove', { list: item.list, email: item.email })
      setStatusMsg({ type: 'success', text: `Removed ${item.email}.` })
      await refresh(item.list)
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const renderTable = (listType: 'CUSTOMER' | 'AM') => {
    const tbl = listType === 'CUSTOMER' ? customerTable : amTable
    return (
    <SpaceBetween size="m">
      <Container header={<Header variant="h2">Add to {listType === 'CUSTOMER' ? 'Customer' : 'AM'} Exclusion List</Header>}>
        <SpaceBetween size="m">
          <FormField label="Email address" stretch>
            <Input
              value={newEmail}
              onChange={({ detail }) => setNewEmail(detail.value)}
              placeholder="user@example.com"
              type="email"
            />
          </FormField>
          <FormField label="Name (optional)" stretch>
            <Input
              value={newName}
              onChange={({ detail }) => setNewName(detail.value)}
              placeholder="e.g. John McLaughlin"
            />
          </FormField>
          <FormField label="Reason (optional)" stretch>
            <Input
              value={newReason}
              onChange={({ detail }) => setNewReason(detail.value)}
              placeholder="e.g. Email bounced, Requested to unsubscribe, Internal test"
            />
          </FormField>
          <Button variant="primary" onClick={handleAddSingle} disabled={loading}>
            Add to exclusion list
          </Button>

          <FormField label="Bulk add (one email per line, or comma/semicolon separated)" stretch>
            <Textarea
              value={bulkText}
              onChange={({ detail }) => setBulkText(detail.value)}
              placeholder="user1@example.com&#10;user2@example.com"
              rows={4}
            />
          </FormField>
          <Button onClick={handleBulkAdd} disabled={loading || !bulkText.trim()}>
            Bulk add
          </Button>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2" counter={`(${items[listType].length})`}>{listType === 'CUSTOMER' ? 'Customer' : 'AM'} Exclusion List</Header>}>
        <Table
          loading={loading}
          loadingText="Loading exclusions..."
          columnDefinitions={[
            { id: 'email', header: 'Email', cell: (e: ExclusionItem) => e.email, sortingField: 'email' },
            { id: 'name', header: 'Name', cell: (e: ExclusionItem) => e.name || '-', sortingField: 'name' },
            { id: 'reason', header: 'Reason', cell: (e: ExclusionItem) => e.reason || '-', sortingField: 'reason' },
            { id: 'addedAt', header: 'Added', cell: (e: ExclusionItem) => e.addedAt ? new Date(e.addedAt).toLocaleString() : '-', sortingField: 'addedAt' },
            { id: 'addedBy', header: 'Added by', cell: (e: ExclusionItem) => e.addedBy || '-', sortingField: 'addedBy' },
            {
              id: 'actions',
              header: 'Actions',
              cell: (e: ExclusionItem) => (
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
              filteringPlaceholder="Filter by email, name, reason..."
              onChange={({ detail }) => tbl.setFilterText(detail.filteringText)}
              countText={tbl.filtered.length === items[listType].length
                ? `${items[listType].length} matches`
                : `${tbl.filtered.length} of ${items[listType].length} matches`}
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
              <b>No exclusions</b>
              <Box variant="p" color="inherit">
                Add an email above to suppress all outbound emails to this address.
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

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description="Emails on these lists will be skipped automatically when drafting or sending customer or AM emails."
        actions={<Button onClick={onGoHome}>Back to Home</Button>}
      >
        Email Exclusion Lists
      </Header>

      <Alert type="info">
        Two separate lists: <b>Customer</b> (attendees / customer contacts) and <b>AM</b> (internal account managers). The send/draft endpoints check both lists by default — anyone on either list is skipped.
      </Alert>

      {statusMsg && (
        <StatusIndicator type={statusMsg.type === 'success' ? 'success' : 'error'}>
          {statusMsg.text}
        </StatusIndicator>
      )}

      <Tabs
        activeTabId={activeList}
        onChange={({ detail }) => {
          setActiveList(detail.activeTabId as 'CUSTOMER' | 'AM')
          setStatusMsg(null)
          setNewEmail('')
          setNewName('')
          setNewReason('')
        }}
        tabs={[
          {
            id: 'CUSTOMER',
            label: `Customer Exclusions (${items.CUSTOMER.length})`,
            content: renderTable('CUSTOMER'),
          },
          {
            id: 'AM',
            label: `AM Exclusions (${items.AM.length})`,
            content: renderTable('AM'),
          },
        ]}
      />
    </SpaceBetween>
  )
}
