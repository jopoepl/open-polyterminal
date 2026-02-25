import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketOutcome } from '@/types'
import type { LivePrice } from '@/hooks/useLivePrices'
import { getOutcomeColorByYesToken, sortOutcomesForDisplay } from '@/lib/outcome-visuals'

interface PriceLevel {
  price: number
  size: number
}

interface DepthData {
  bids: PriceLevel[]
  asks: PriceLevel[]
  bestBid: number
  bestAsk: number
}

interface OutcomeTableProps {
  outcomes: MarketOutcome[]
  livePrices: Record<string, LivePrice>
}

function formatPrice(value: number | null) {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value * 100)}¢`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

function formatTarget(outcome: MarketOutcome) {
  if (!outcome.target) return outcome.question || '—'
  const t = outcome.target
  if (t.type === 'exact') return `=${t.value}°${t.unit}`
  if (t.type === 'range') return `${t.value}-${t.value2}°${t.unit}`
  if (t.type === 'above') return `≥${t.value}°${t.unit}`
  if (t.type === 'below') return `≤${t.value}°${t.unit}`
  return '—'
}

function formatBidAsk(tokenId: string, livePrices: Record<string, LivePrice>, fallbackPrice: number | null) {
  const data = livePrices[tokenId]
  if (data && (data.bestBid > 0 || data.bestAsk > 0)) {
    return `${Math.round(data.bestBid * 100)}¢ / ${Math.round(data.bestAsk * 100)}¢`
  }
  // Fallback to market price if no bid/ask
  if (fallbackPrice !== null) return `${Math.round(fallbackPrice * 100)}¢`
  return '—'
}

function formatSize(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toFixed(0)
}

function DepthLadder({ label, data }: { label: string; data: DepthData | null }) {
  if (!data) {
    return (
      <div className="depth-ladder">
        <div className="depth-ladder-header">{label}</div>
        <div className="depth-ladder-empty">No depth data</div>
      </div>
    )
  }

  const maxSize = Math.max(
    ...data.bids.map((b) => b.size),
    ...data.asks.map((a) => a.size),
    1
  )

  const asksReversed = [...data.asks].reverse()
  const bidsOrdered = data.bids
  const spread = data.bestAsk && data.bestBid ? data.bestAsk - data.bestBid : null

  return (
    <div className="depth-ladder">
      <div className="depth-ladder-header">{label}</div>
      <div className="depth-ladder-stacked">
        {/* Asks section - top */}
        <div className="depth-asks-section">
          {asksReversed.length === 0 && <div className="depth-ladder-empty">No asks</div>}
          {asksReversed.map((level, i) => (
            <div key={i} className="depth-row-stacked depth-ask">
              <span className="depth-price">{Math.round(level.price * 100)}¢</span>
              <span className="depth-size">{formatSize(level.size)}</span>
              <div
                className="depth-bar-stacked depth-bar-ask"
                style={{ width: `${(level.size / maxSize) * 100}%` }}
              />
            </div>
          ))}
        </div>

        {/* Spread */}
        <div className="depth-spread">
          <span className="depth-spread-value">{spread !== null ? `${Math.round(spread * 100)}¢ spread` : '—'}</span>
        </div>

        {/* Bids section - bottom */}
        <div className="depth-bids-section">
          {bidsOrdered.length === 0 && <div className="depth-ladder-empty">No bids</div>}
          {bidsOrdered.map((level, i) => (
            <div key={i} className="depth-row-stacked depth-bid">
              <span className="depth-price">{Math.round(level.price * 100)}¢</span>
              <span className="depth-size">{formatSize(level.size)}</span>
              <div
                className="depth-bar-stacked depth-bar-bid"
                style={{ width: `${(level.size / maxSize) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function OutcomeTable({ outcomes, livePrices }: OutcomeTableProps) {
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null)
  const [depthData, setDepthData] = useState<{ yes: DepthData | null; no: DepthData | null }>({ yes: null, no: null })
  const [depthLoading, setDepthLoading] = useState(false)

  const sortedOutcomes = useMemo(() => {
    const baseline = sortOutcomesForDisplay(outcomes)
    return [...baseline].sort((a, b) => {
      const aYes = a.yesPrice ?? -1
      const bYes = b.yesPrice ?? -1
      if (bYes !== aYes) return bYes - aYes
      return (a.question || '').localeCompare(b.question || '')
    })
  }, [outcomes])
  const colorsByToken = useMemo(() => getOutcomeColorByYesToken(outcomes), [outcomes])

  const fetchDepth = useCallback(async (yesTokenId: string, noTokenId: string) => {
    setDepthLoading(true)
    try {
      const params = new URLSearchParams({ tokenIds: `${yesTokenId},${noTokenId}` })
      const res = await fetch(`/api/orderbook?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        const yesBook = json.books?.[yesTokenId]
        const noBook = json.books?.[noTokenId]
        setDepthData({
          yes: yesBook ? {
            bids: yesBook.bids || [],
            asks: yesBook.asks || [],
            bestBid: yesBook.bestBid || 0,
            bestAsk: yesBook.bestAsk || 0
          } : null,
          no: noBook ? {
            bids: noBook.bids || [],
            asks: noBook.asks || [],
            bestBid: noBook.bestBid || 0,
            bestAsk: noBook.bestAsk || 0
          } : null
        })
      }
    } catch (err) {
      console.warn('Failed to fetch depth', err)
    } finally {
      setDepthLoading(false)
    }
  }, [])

  const [expandedTokens, setExpandedTokens] = useState<{ yes: string; no: string } | null>(null)

  const handleRowClick = useCallback((outcome: MarketOutcome) => {
    if (expandedMarketId === outcome.marketId) {
      setExpandedMarketId(null)
      setExpandedTokens(null)
      setDepthData({ yes: null, no: null })
    } else {
      setExpandedMarketId(outcome.marketId)
      setExpandedTokens({ yes: outcome.yesTokenId, no: outcome.noTokenId })
      setDepthData({ yes: null, no: null })
      fetchDepth(outcome.yesTokenId, outcome.noTokenId)
    }
  }, [expandedMarketId, fetchDepth])

  // Poll depth every 30s while expanded
  useEffect(() => {
    if (!expandedTokens) return

    const interval = setInterval(() => {
      fetchDepth(expandedTokens.yes, expandedTokens.no)
    }, 30000)

    return () => clearInterval(interval)
  }, [expandedTokens, fetchDepth])

  // Reset expansion when outcomes change
  useEffect(() => {
    setExpandedMarketId(null)
    setExpandedTokens(null)
    setDepthData({ yes: null, no: null })
  }, [outcomes])

  if (!outcomes.length) {
    return <div className="empty-state">No outcomes available.</div>
  }

  return (
    <table className="outcome-table">
      <thead>
        <tr>
          <th>Outcome</th>
          <th>YES <span className="th-hint">(bid/ask)</span></th>
          <th>NO <span className="th-hint">(bid/ask)</span></th>
          <th>Liq</th>
          <th>Vol</th>
        </tr>
      </thead>
      <tbody>
        {sortedOutcomes.map((outcome) => {
          const rowColor = colorsByToken[outcome.yesTokenId]
          const isExpanded = expandedMarketId === outcome.marketId
          return (
          <React.Fragment key={outcome.marketId}>
            <tr
              className={`outcome-row ${isExpanded ? 'expanded' : ''}`}
              onClick={() => handleRowClick(outcome)}
              style={{ cursor: 'pointer' }}
            >
              <td className="outcome-target-cell">
                <span
                  className="outcome-color-dot"
                  style={rowColor ? { backgroundColor: rowColor, borderColor: rowColor } : undefined}
                />
                <span style={rowColor ? { color: rowColor } : undefined}>
                  {formatTarget(outcome)}
                </span>
                <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
              </td>
              <td>{formatBidAsk(outcome.yesTokenId, livePrices, outcome.yesPrice)}</td>
              <td>{formatBidAsk(outcome.noTokenId, livePrices, outcome.noPrice)}</td>
              <td>{formatNumber(outcome.liquidity)}</td>
              <td>{formatNumber(outcome.volume)}</td>
            </tr>
            {isExpanded && (
              <tr className="depth-row">
                <td colSpan={5}>
                  <div className="depth-container">
                    {depthLoading && <div className="depth-loading">Loading depth...</div>}
                    {!depthLoading && (
                      <div className="depth-panels">
                        <DepthLadder label="YES" data={depthData.yes} />
                        <DepthLadder label="NO" data={depthData.no} />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
