import type { MarketCategoryId } from '@/types'

interface SidebarProps {
  activeCategory: MarketCategoryId
  onCategoryChange: (id: MarketCategoryId) => void
}

const CATEGORY_ITEMS: Array<{ id: MarketCategoryId; label: string; disabled?: boolean }> = [
  { id: 'all', label: 'All', disabled: true },
  { id: 'weather', label: 'Weather' },
  { id: 'sports', label: 'Sports', disabled: true },
  { id: 'politics', label: 'Politics', disabled: true },
  { id: 'crypto', label: 'Crypto', disabled: true },
  { id: 'business', label: 'Business', disabled: true },
  { id: 'culture', label: 'Culture', disabled: true }
]

export default function Sidebar({
  activeCategory,
  onCategoryChange
}: SidebarProps) {
  return (
    <div className="panel panel-sidebar">
      <div className="panel-header">
        <div className="panel-title">Categories</div>
      </div>
      <div className="panel-content sidebar-content">
        {CATEGORY_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${activeCategory === item.id ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={() => !item.disabled && onCategoryChange(item.id)}
            disabled={item.disabled}
            type="button"
          >
            {item.label}{item.disabled ? ' (soon)' : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
