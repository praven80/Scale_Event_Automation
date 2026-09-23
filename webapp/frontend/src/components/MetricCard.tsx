interface MetricCardProps {
  label: string
  value: string | number
  color?: string
}

const METRIC_COLORS: Record<string, string> = {
  blue: '#0073bb',
  green: '#1a8754',
  orange: '#ff9900',
  red: '#d13212',
  purple: '#7b61ff',
  teal: '#00a1c9',
}

export default function MetricCard({ label, value, color = 'blue' }: MetricCardProps) {
  const borderColor = METRIC_COLORS[color] || color
  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      border: '1px solid #e0e0e0',
      borderLeft: `4px solid ${borderColor}`,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: '#687078', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: borderColor, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  )
}
