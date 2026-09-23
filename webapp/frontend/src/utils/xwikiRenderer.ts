/**
 * Converts XWiki markup to HTML for preview rendering.
 * Handles: headers, bold, italic, links, tables (including styled cells),
 * {{html}} blocks, list items, and line breaks.
 */
export function xwikiToHtml(markup: string): string {
  if (!markup) return ''

  const lines = markup.split('\n')
  const output: string[] = []
  let inHtmlBlock = false
  let htmlBuffer: string[] = []
  let inTable = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Handle {{html}} blocks — pass through raw HTML
    if (line.trim() === '{{html}}') {
      if (inTable) { output.push('</table>'); inTable = false }
      inHtmlBlock = true
      htmlBuffer = []
      continue
    }
    if (line.trim() === '{{/html}}') {
      inHtmlBlock = false
      output.push(htmlBuffer.join('\n'))
      htmlBuffer = []
      continue
    }
    if (inHtmlBlock) {
      htmlBuffer.push(line)
      continue
    }

    // Skip other macro tags
    if (line.trim().startsWith('{{') && line.trim().endsWith('}}')) continue

    const trimmed = line.trim()

    // Empty line
    if (trimmed === '') {
      if (inTable) { output.push('</table>'); inTable = false }
      output.push('<br/>')
      continue
    }

    // Skip standalone style annotations like (% style="..." %)
    if (/^\(%\s*style="[^"]*"\s*%\)\s*$/.test(trimmed)) continue

    // Headers: = H1 =, == H2 ==, === H3 ===
    const headerMatch = trimmed.match(/^(=+)\s*(.*?)\s*=*\s*$/)
    if (headerMatch && headerMatch[1].length <= 6) {
      if (inTable) { output.push('</table>'); inTable = false }
      const level = headerMatch[1].length
      output.push(`<h${level}>${convertInline(headerMatch[2])}</h${level}>`)
      continue
    }

    // Table rows: |= header | or | cell | or (% style %) cells
    if (trimmed.startsWith('|') || (trimmed.startsWith('(%') && trimmed.includes('|'))) {
      if (!inTable) {
        output.push('<table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;">')
        inTable = true
      }
      // Parse cells - split on | but handle (% style %) prefixes
      const rawLine = trimmed.startsWith('|') ? trimmed : trimmed
      const cells = splitTableCells(rawLine)
      if (cells.length > 0) {
        output.push('<tr>')
        for (const cell of cells) {
          output.push(renderTableCell(cell))
        }
        output.push('</tr>')
      }
      continue
    }

    // Close table if not a table row
    if (inTable) { output.push('</table>'); inTable = false }

    // List items: * item or - item or 1. item
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      output.push(`<li style="margin-left:20px;">${convertInline(trimmed.slice(2))}</li>`)
      continue
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (olMatch) {
      output.push(`<li style="margin-left:20px;">${convertInline(olMatch[1])}</li>`)
      continue
    }

    // Horizontal rule
    if (trimmed === '----') {
      output.push('<hr/>')
      continue
    }

    // Regular paragraph
    output.push(`<p>${convertInline(trimmed)}</p>`)
  }

  if (inTable) output.push('</table>')

  return output.join('\n')
}

/** Split a table row into individual cell strings, handling (% style %) prefixed cells */
function splitTableCells(line: string): string[] {
  const cells: string[] = []
  // Remove leading/trailing pipes
  let content = line.trim()
  if (content.startsWith('|')) content = content.slice(1)
  if (content.endsWith('|')) content = content.slice(0, -1)
  if (!content.trim()) return cells

  // Split on | but be careful with (% ... %) spans
  // Simple approach: split on \t first (XWiki sometimes uses tabs), then |
  const parts = content.split(/\t|\|/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed) cells.push(trimmed)
  }
  return cells
}

/** Render a single table cell, handling (% style="..." %) prefix and |= header syntax */
function renderTableCell(cell: string): string {
  const clean = cell.trim()

  // Check for styled cell: (% style="..." %) content
  const styleMatch = clean.match(/^\(%\s*style="([^"]*?)"\s*%\)\s*(.*)$/)

  if (styleMatch) {
    const style = styleMatch[1]
    const text = styleMatch[2].trim()
    // Detect if it's a header style (dark background)
    const isHeader = style.includes('background-color') && (style.includes('#0f1b2d') || style.includes('#232f3e'))
    const tag = isHeader ? 'th' : 'td'
    return `<${tag} style="${style};padding:8px;border:1px solid #e0e0e0;">${convertInline(text)}</${tag}>`
  }

  // Header cell: =Text
  if (clean.startsWith('=')) {
    const headerText = clean.replace(/^=\s*/, '')
    return `<th style="background-color:#0f1b2d;color:#ffffff;padding:8px;border:1px solid #e0e0e0;text-align:left;">${convertInline(headerText)}</th>`
  }

  // Regular cell
  return `<td style="padding:8px;border:1px solid #e0e0e0;">${convertInline(clean)}</td>`
}

/** Convert inline XWiki markup: bold, italic, links, images */
function convertInline(text: string): string {
  let result = text

  // Strip inline style annotations: (% style="..." %)
  result = result.replace(/\(%\s*style="[^"]*"\s*%\)/g, '')

  // Images: [[image:name||attrs]]
  result = result.replace(/\[\[image:([^\]|]+)(?:\|\|([^\]]*))?\]\]/g, (_m, src, attrs) => {
    const attrStr = attrs ? ` ${attrs.replace(/style="([^"]*)"/, 'style="$1"')}` : ''
    return `<img src="${src}"${attrStr} alt="${src}" style="max-width:320px;border-radius:8px;" />`
  })

  // Links: [[text>>url]]
  result = result.replace(/\[\[([^\]>]+)>>([^\]]+)\]\]/g, '<a href="$2" style="color:#0073bb;">$1</a>')

  // Bold: **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // Italic: //text//
  result = result.replace(/\/\/([^/]+)\/\//g, '<em>$1</em>')

  // Monospace: ##text##
  result = result.replace(/##([^#]+)##/g, '<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px;">$1</code>')

  return result.trim()
}
