import Papa from 'papaparse'

export function parseCsv<T>(file: File | Blob): Promise<T[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (results) => resolve(results.data as T[]),
      error: (err) => reject(err),
    })
  })
}

const INTERNAL_DOMAINS = new Set([
  'amazon.com', 'aws.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.co.jp',
])

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'ymail.com', 'googlemail.com',
])

export function classifyEmail(email: string): 'searchable' | 'internal' | 'generic' {
  const domain = email.toLowerCase().split('@')[1] || ''
  if (!domain) return 'generic'
  if (INTERNAL_DOMAINS.has(domain) || domain.endsWith('.amazon.com') || domain.endsWith('.aws.com')) return 'internal'
  if (GENERIC_DOMAINS.has(domain)) return 'generic'
  return 'searchable'
}

export function getDomain(email: string): string {
  return (email.toLowerCase().split('@')[1] || '').trim()
}

export function deduplicateByField<T>(rows: T[], field: keyof T): T[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    const val = String(row[field] || '').toLowerCase().trim()
    if (!val || seen.has(val)) return false
    seen.add(val)
    return true
  })
}
