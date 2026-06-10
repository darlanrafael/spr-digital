export default function PlatformBadge({ platform }: { platform: string }) {
  const isKiwify = platform.toLowerCase() === 'kiwify'
  const label = isKiwify ? 'Kiwify' : 'Hubla'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        isKiwify
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
      }`}
    >
      {label}
    </span>
  )
}
