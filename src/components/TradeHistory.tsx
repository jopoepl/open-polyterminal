import type { Trade } from '@/hooks/useTrades'

interface TradeHistoryProps {
  trades: Trade[]
  status: 'ok' | 'unavailable' | 'loading'
}

function formatTime(timestamp: string) {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp
  // Compact format: "13/02 09:15"
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const hours = d.getHours().toString().padStart(2, '0')
  const mins = d.getMinutes().toString().padStart(2, '0')
  return `${day}/${month} ${hours}:${mins}`
}

function formatPrice(price: number) {
  return `${Math.round(price * 100)}¢`
}

function formatSize(size: number) {
  if (size >= 1000) return `${(size / 1000).toFixed(1)}k`
  return size.toFixed(2)
}

function shortenAddress(address: string) {
  if (!address || address.length < 10) return address || '—'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function polymarketProfileUrl(address: string) {
  if (!address) return null
  return `https://polymarket.com/profile/${encodeURIComponent(address)}`
}

function formatMarketLabel(title: string) {
  if (!title) return '—'

  const range = title.match(/(?:between\s+)?(-?\d+)-(-?\d+)°([CF])/i)
  if (range) return `${range[1]}-${range[2]}°${range[3].toUpperCase()}`

  const above = title.match(/(-?\d+)°([CF])\s+or\s+higher/i)
  if (above) return `≥${above[1]}°${above[2].toUpperCase()}`

  const below = title.match(/(-?\d+)°([CF])\s+or\s+below/i)
  if (below) return `≤${below[1]}°${below[2].toUpperCase()}`

  const exact = title.match(/(?:be\s+)?(-?\d+)°([CF])\s+on/i)
  if (exact) return `=${exact[1]}°${exact[2].toUpperCase()}`

  return title.length > 28 ? `${title.slice(0, 27)}…` : title
}

export default function TradeHistory({ trades, status }: TradeHistoryProps) {
  if (status === 'loading') {
    return <div className="empty-state">Loading trades…</div>
  }

  if (status === 'unavailable') {
    return <div className="empty-state">Trade data unavailable for this event.</div>
  }

  if (!trades.length) {
    return <div className="empty-state">No recent trades.</div>
  }

  return (
    <table className="trade-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Outcome</th>
          <th>Token</th>
          <th>Side</th>
          <th>Price</th>
          <th>Size</th>
          <th>User</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => {
          const profileUrl = polymarketProfileUrl(trade.user)

          return (
            <tr key={trade.id || `${trade.timestamp}-${trade.price}-${trade.size}`} className="trade-row">
              <td>{formatTime(trade.timestamp)}</td>
              <td className="trade-market" title={trade.marketTitle || ''}>{formatMarketLabel(trade.marketTitle)}</td>
              <td>{trade.outcome || '—'}</td>
              <td className={trade.side === 'BUY' ? 'trade-buy' : 'trade-sell'}>{trade.side}</td>
              <td>{formatPrice(trade.price)}</td>
              <td>{formatSize(trade.size)}</td>
              <td>
                {profileUrl ? (
                  <a
                    className="trade-user-link"
                    href={profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={trade.user}
                  >
                    {shortenAddress(trade.user)}
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
