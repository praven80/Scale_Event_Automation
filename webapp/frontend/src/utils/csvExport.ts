import Papa from 'papaparse'

export function downloadCsv(data: object[], filename: string, columns?: { field: string; header: string }[]) {
  if (data.length === 0) return
  let csv: string
  if (columns) {
    const fields = columns.map(c => c.field)
    const headers = columns.map(c => c.header)
    const rows = data.map(row => fields.map(f => (row as any)[f] ?? ''))
    csv = Papa.unparse({ fields: headers, data: rows })
  } else {
    csv = Papa.unparse(data)
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
