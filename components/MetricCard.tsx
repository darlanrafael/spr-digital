interface MetricCardProps {
  title: string
  value: string
  subtitle?: string
  trend?: { value: string; positive: boolean }
  color?: 'default' | 'green' | 'red' | 'blue' | 'purple'
  icon?: React.ReactNode
}

const colorMap = {
  default: 'border-white/10',
  green: 'border-emerald-500/30',
  red: 'border-red-500/30',
  blue: 'border-blue-500/30',
  purple: 'border-purple-500/30',
}

export default function MetricCard({ title, value, subtitle, trend, color = 'default', icon }: MetricCardProps) {
  return (
    <div className={`bg-gray-900 rounded-xl border ${colorMap[color]} p-4`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-gray-400 font-medium">{title}</p>
        {icon && <div className="text-gray-500">{icon}</div>}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      {trend && (
        <p className={`text-xs mt-1 font-medium ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend.positive ? '▲' : '▼'} {trend.value}
        </p>
      )}
    </div>
  )
}
