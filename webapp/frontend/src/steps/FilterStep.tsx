import { useEffect } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Table from '@cloudscape-design/components/table'
import MetricCard from '../components/MetricCard'
import Pagination from '@cloudscape-design/components/pagination'
import TextFilter from '@cloudscape-design/components/text-filter'
import { AppState, FilteredAttendee } from '../types'
import { classifyEmail, getDomain } from '../utils/csvParser'
import { useTableState } from '../utils/useTableState'

interface Props { state: AppState; update: (u: Partial<AppState>) => void }

export default function FilterStep({ state, update }: Props) {
  useEffect(() => {
    if (state.attendees.length === 0) return
    const searchable: FilteredAttendee[] = []
    const internal: FilteredAttendee[] = []
    const generic: FilteredAttendee[] = []

    for (const att of state.attendees) {
      const email = (att.Email || '').trim().toLowerCase()
      if (!email) continue
      const category = classifyEmail(email)
      const enriched: FilteredAttendee = { ...att, Domain: getDomain(email), Category: category }
      if (category === 'searchable') searchable.push(enriched)
      else if (category === 'internal') internal.push(enriched)
      else generic.push(enriched)
    }
    update({ filtered: { searchable, internal, generic } })
  }, [state.attendees])

  const { searchable, internal, generic } = state.filtered
  const uniqueDomains = new Set(searchable.map(a => a.Domain)).size

  const searchableTable = useTableState(searchable, { defaultSortField: 'Visitor' })
  const skipped = [...internal, ...generic]
  const skippedTable = useTableState(skipped, { defaultSortField: 'Visitor' })

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Classification Results</Header>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <MetricCard label="Checked-in Attendees" value={state.attendees.length} color="blue" />
          <MetricCard label="Searchable Attendees" value={searchable.length} color="green" />
          <MetricCard label="Skipped (Internal)" value={internal.length} color="orange" />
          <MetricCard label="Skipped (Generic)" value={generic.length} color="red" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 16 }}>
          <MetricCard label="Unique Companies (Searchable)" value={new Set(searchable.map(a => a.Company).filter(Boolean)).size} color="purple" />
          <MetricCard label="Unique Domains (Searchable)" value={uniqueDomains} color="teal" />
        </div>
      </Container>

      <Container header={<Header variant="h2" counter={`(${searchable.length})`}>Searchable Attendees</Header>}>
        <Table
          columnDefinitions={[
            { id: 'visitor', header: 'Name', cell: (e: FilteredAttendee) => e.Visitor, sortingField: 'Visitor' },
            { id: 'company', header: 'Company', cell: (e: FilteredAttendee) => e.Company, sortingField: 'Company' },
            { id: 'domain', header: 'Domain', cell: (e: FilteredAttendee) => e.Domain, sortingField: 'Domain' },
            { id: 'email', header: 'Email', cell: (e: FilteredAttendee) => e.Email, sortingField: 'Email' },
          ]}
          items={searchableTable.paged}
          sortingColumn={searchableTable.sortField ? { sortingField: searchableTable.sortField } : undefined}
          sortingDescending={!searchableTable.sortAsc}
          onSortingChange={({ detail }) => searchableTable.onSort(detail.sortingColumn.sortingField!)}
          filter={<TextFilter filteringText={searchableTable.filterText} filteringPlaceholder="Filter attendees..." onChange={({ detail }) => searchableTable.setFilterText(detail.filteringText)} />}
          pagination={<Pagination currentPageIndex={searchableTable.currentPage} pagesCount={searchableTable.totalPages} onChange={({ detail }) => searchableTable.setCurrentPage(detail.currentPageIndex)} />}
          variant="embedded"
          stripedRows
          stickyHeader
        />
      </Container>

      {skipped.length > 0 && (
        <Container header={<Header variant="h2" counter={`(${skipped.length})`}>Skipped Attendees</Header>}>
          <Table
            columnDefinitions={[
              { id: 'visitor', header: 'Name', cell: (e: FilteredAttendee) => e.Visitor, sortingField: 'Visitor' },
              { id: 'email', header: 'Email', cell: (e: FilteredAttendee) => e.Email, sortingField: 'Email' },
              { id: 'reason', header: 'Reason', cell: (e: FilteredAttendee) => e.Category === 'internal' ? 'Internal (Amazon/AWS)' : 'Generic email provider' },
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
  )
}
