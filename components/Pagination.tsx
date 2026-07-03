interface PaginationProps {
  currentPage: number
  totalPages: number
  onPrevious: () => void
  onNext: () => void
}

export default function Pagination({ currentPage, totalPages, onPrevious, onNext }: PaginationProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs">
      <button
        onClick={onPrevious}
        disabled={currentPage <= 1}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-800 transition-colors"
      >
        ← Anterior
      </button>
      <span className="text-gray-500">
        Página {currentPage} de {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={currentPage >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-gray-800 transition-colors"
      >
        Próxima →
      </button>
    </div>
  )
}
