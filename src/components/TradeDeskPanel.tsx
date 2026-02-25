import { useEffect, useMemo, useState } from 'react'
import { useWalletMonitor } from '@/hooks/useWalletMonitor'
import { useClobTrading } from '@/hooks/useClobTrading'
import { extractUniqueOutcomeNames } from '@/lib/outcome-names'
import type { MarketEvent } from '@/types'
import type { LivePrice } from '@/hooks/useLivePrices'

type DeskTab = 'portfolio' | 'ticket' | 'orders' | 'resolved'
type OrderMode = 'market' | 'limit'
type OrderSide = 'BUY' | 'SELL'
type TradeFilter = 'today' | 'yesterday' | 'week' | 'all'

interface TradeDeskPanelProps {
  selectedEvent: MarketEvent | null
  address: string | null
  signer: unknown
  connected: boolean
  chainId: number | null
  livePrices: Record<string, LivePrice>
  connecting: boolean
  walletError: string | null
  onConnect: () => void
}

interface TicketOutcome {
  tokenId: string
  label: string
}

function shortAddress(value: string | null) {
  if (!value) return 'Not connected'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function shortTokenId(value: string) {
  if (!value || value.length < 14) return value || '—'
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value)
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}¢`
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `$${value.toFixed(2)}`
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatTime(value: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

export default function TradeDeskPanel({
  selectedEvent,
  address,
  signer,
  connected,
  chainId,
  connecting,
  walletError,
  livePrices,
  onConnect
}: TradeDeskPanelProps) {
  const [tab, setTab] = useState<DeskTab>('portfolio')
  const [orderMode, setOrderMode] = useState<OrderMode>('market')
  const [orderSide, setOrderSide] = useState<OrderSide>('BUY')
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>('all')
  const [tokenId, setTokenId] = useState('')
  const [limitPrice, setLimitPrice] = useState('0.50')
  const [size, setSize] = useState('5')
  const [amount, setAmount] = useState('5')
  const [postOnly, setPostOnly] = useState(false)
  const [executionNote, setExecutionNote] = useState<string | null>(null)

  // Auto-enable when wallet is connected on Polygon - no need for manual session start
  const walletEnabled = connected && chainId === 137
  const monitor = useWalletMonitor(address, walletEnabled)
  const trading = useClobTrading({
    address,
    signer,
    enabled: walletEnabled
  })

  const ticketOutcomes = useMemo(() => {
    if (!selectedEvent) return []

    const items: TicketOutcome[] = []
    for (const outcome of selectedEvent.outcomes) {
      if (outcome.yesTokenId) {
        items.push({
          tokenId: outcome.yesTokenId,
          label: `${outcome.question} · YES`
        })
      }
      if (outcome.noTokenId) {
        items.push({
          tokenId: outcome.noTokenId,
          label: `${outcome.question} · NO`
        })
      }
    }

    return items
  }, [selectedEvent])

  useEffect(() => {
    if (!ticketOutcomes.length) {
      setTokenId('')
      return
    }

    if (!ticketOutcomes.some((outcome) => outcome.tokenId === tokenId)) {
      setTokenId(ticketOutcomes[0].tokenId)
    }
  }, [ticketOutcomes, tokenId])

  const handleSubmit = async () => {
    setExecutionNote(null)

    if (!walletEnabled) {
      setExecutionNote('Connect a Polygon wallet first.')
      return
    }
    if (!tokenId) {
      setExecutionNote('Select an outcome token first.')
      return
    }

    if (orderMode === 'limit') {
      const parsedPrice = Number(limitPrice)
      const parsedSize = Number(size)
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0 || parsedPrice >= 1) {
        setExecutionNote('Limit price must be between 0 and 1.')
        return
      }
      if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
        setExecutionNote('Size must be greater than zero.')
        return
      }

      const result = await trading.placeLimitOrder({
        tokenId,
        side: orderSide,
        price: parsedPrice,
        size: parsedSize,
        postOnly
      })

      setExecutionNote(result.success
        ? `Limit order placed${result.orderId ? ` (${result.orderId})` : ''}.`
        : `Order failed: ${result.message || 'unknown error'}`)
      return
    }

    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setExecutionNote('Amount must be greater than zero.')
      return
    }

    const result = await trading.placeMarketOrder({
      tokenId,
      side: orderSide,
      amount: parsedAmount
    })

    setExecutionNote(result.success
      ? `Market order submitted${result.orderId ? ` (${result.orderId})` : ''}.`
      : `Order failed: ${result.message || 'unknown error'}`)
  }

  return (
    <div className="trade-desk">
      <div className="trade-desk-header">
        <div>
          <div className="panel-title">Trade Desk</div>
          <div className="trade-desk-wallet">Wallet: {shortAddress(address)}</div>
        </div>
        {!connected && (
          <button className="btn" onClick={onConnect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>

      {!connected && (
        <div className="trade-desk-note">Connect your wallet to enable trading.</div>
      )}
      {connected && chainId !== 137 && (
        <div className="trade-desk-error">Switch to Polygon Mainnet to trade.</div>
      )}
      {walletError && <div className="trade-desk-error">{walletError}</div>}
      {trading.error && <div className="trade-desk-error">{trading.error}</div>}

      <div className="trade-desk-tabs">
        <button className={`trade-desk-tab ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => setTab('portfolio')}>
          Portfolio Watch
        </button>
        <button className={`trade-desk-tab ${tab === 'ticket' ? 'active' : ''}`} onClick={() => setTab('ticket')}>
          Order Ticket
        </button>
        <button className={`trade-desk-tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          Open Orders
        </button>
        <button className={`trade-desk-tab ${tab === 'resolved' ? 'active' : ''}`} onClick={() => setTab('resolved')}>
          Resolved
        </button>
      </div>

      {tab === 'portfolio' && (() => {
        const activePositions = monitor.positions.filter(p => p.resolutionStatus === 'active')
        const activeValue = activePositions.reduce((sum, p) => sum + p.currentValue, 0)

        // Filter trades by date
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
        const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000)

        const filteredTrades = monitor.trades.filter(trade => {
          if (tradeFilter === 'all') return true
          const tradeDate = new Date(trade.timestamp)
          if (tradeFilter === 'today') return tradeDate >= todayStart
          if (tradeFilter === 'yesterday') return tradeDate >= yesterdayStart && tradeDate < todayStart
          if (tradeFilter === 'week') return tradeDate >= weekStart
          return true
        })

        return (
        <div className="trade-desk-section">
          <div className="trade-desk-actions" style={{ marginBottom: '10px' }}>
            <button className="btn" onClick={() => void monitor.refresh()} disabled={!walletEnabled || monitor.loading}>
              {monitor.loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <span className="badge">{activePositions.length} positions</span>
            <span className="badge">{formatMoney(activeValue)}</span>
            <span className="badge">{monitor.fetchedAt ? formatTime(monitor.fetchedAt) : '—'}</span>
          </div>

          {monitor.error && <div className="trade-desk-error">{monitor.error}</div>}

          <div className="table-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Size</th>
                  <th>Avg</th>
                  <th>Now</th>
                  <th>Value</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {!activePositions.length && (
                  <tr>
                    <td colSpan={7} className="empty-state">No active positions.</td>
                  </tr>
                )}
                {activePositions.slice(0, 30).map((position) => {
                  const pnlPercent = position.avgPrice > 0
                    ? ((position.currentPrice - position.avgPrice) / position.avgPrice) * 100
                    : 0
                  return (
                    <tr key={`${position.tokenId}-${position.outcome}`} className="trade-row">
                      <td className="trade-market-cell" title={position.title}>
                        <div className="trade-market-title">{position.title}</div>
                        <div className="trade-market-sub">{shortTokenId(position.tokenId)}</div>
                      </td>
                      <td>{position.outcome || '—'}</td>
                      <td>{formatCompact(position.size)}</td>
                      <td>{formatPrice(position.avgPrice)}</td>
                      <td>{formatPrice(position.currentPrice)}</td>
                      <td>{formatMoney(position.currentValue)}</td>
                      <td className={position.unrealizedPnl >= 0 ? 'trade-buy' : 'trade-sell'}>
                        {formatMoney(position.unrealizedPnl)} ({formatPercent(pnlPercent)})
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="trade-desk-actions" style={{ marginTop: '16px', marginBottom: '10px' }}>
            <span className="panel-title" style={{ marginRight: '12px' }}>Trade History</span>
            <button className={`btn btn-small ${tradeFilter === 'today' ? 'active' : ''}`} onClick={() => setTradeFilter('today')}>Today</button>
            <button className={`btn btn-small ${tradeFilter === 'yesterday' ? 'active' : ''}`} onClick={() => setTradeFilter('yesterday')}>Yesterday</button>
            <button className={`btn btn-small ${tradeFilter === 'week' ? 'active' : ''}`} onClick={() => setTradeFilter('week')}>Week</button>
            <button className={`btn btn-small ${tradeFilter === 'all' ? 'active' : ''}`} onClick={() => setTradeFilter('all')}>All</button>
          </div>

          <div className="table-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {!filteredTrades.length && (
                  <tr>
                    <td colSpan={7} className="empty-state">No trades for this period.</td>
                  </tr>
                )}
                {filteredTrades.slice(0, 30).map((trade) => (
                  <tr key={trade.id} className="trade-row">
                    <td>{formatTime(trade.timestamp)}</td>
                    <td className="trade-market-cell" title={trade.marketTitle}>
                      <div className="trade-market-title">{trade.marketTitle || '—'}</div>
                    </td>
                    <td>{trade.outcome || '—'}</td>
                    <td className={trade.side === 'BUY' ? 'trade-buy' : 'trade-sell'}>{trade.side}</td>
                    <td>{formatPrice(trade.price)}</td>
                    <td>{formatCompact(trade.size)}</td>
                    <td>{formatMoney(trade.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )
      })()}

      {tab === 'ticket' && (() => {
        const activeOutcomes = selectedEvent?.outcomes.filter(o => o.yesPrice !== null || o.volume > 0) || []
        const uniqueNames = extractUniqueOutcomeNames(activeOutcomes)

        return (
        <div className="trade-desk-section">
          <div className="trade-desk-actions" style={{ marginBottom: '12px' }}>
            <label className="trade-field" style={{ flex: 0 }}>
              <span>Amount ($)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                style={{ width: '80px' }}
              />
            </label>
          </div>

          {executionNote && <div className="trade-desk-note" style={{ marginBottom: '12px' }}>{executionNote}</div>}

          {!selectedEvent && <div className="empty-state">Select an event to trade</div>}

          {selectedEvent && (
            <>
            <div className="panel-title" style={{ marginBottom: '10px', fontSize: '12px' }}>
              {selectedEvent.title}
            </div>
            <div className="quick-trade-list">
              {activeOutcomes.slice(0, 12).map((outcome) => {
                  const yesPrice = livePrices[outcome.yesTokenId]
                  const noPrice = livePrices[outcome.noTokenId]
                  const yesAsk = yesPrice?.bestAsk ?? (outcome.yesPrice ? outcome.yesPrice + 0.02 : 0)
                  const noAsk = noPrice?.bestAsk ?? (outcome.noPrice ? outcome.noPrice + 0.02 : 0)
                  const displayName = uniqueNames.get(outcome.marketId) || outcome.question || '—'

                  const handleQuickTrade = async (tkn: string, side: 'BUY' | 'SELL') => {
                    if (!walletEnabled) {
                      setExecutionNote('Connect wallet first')
                      return
                    }
                    const amt = Number(amount)
                    if (!amt || amt <= 0) {
                      setExecutionNote('Enter amount first')
                      return
                    }
                    setExecutionNote(null)
                    const result = await trading.placeMarketOrder({ tokenId: tkn, side, amount: amt })
                    setExecutionNote(result.success
                      ? `Order placed${result.orderId ? ` (${result.orderId})` : ''}`
                      : `Failed: ${result.message || 'unknown'}`)
                  }

                  return (
                    <div key={outcome.marketId} className="quick-trade-row">
                      <div className="quick-trade-outcome" title={outcome.question}>
                        {displayName}
                      </div>
                      <div className="quick-trade-buttons">
                        <button
                          className="btn quick-trade-yes"
                          disabled={!walletEnabled || trading.actionLoading || !yesAsk}
                          onClick={() => void handleQuickTrade(outcome.yesTokenId, 'BUY')}
                          title={`Buy YES at ${Math.round(yesAsk * 100)}¢`}
                        >
                          YES {yesAsk ? `${Math.round(yesAsk * 100)}¢` : '—'}
                        </button>
                        <button
                          className="btn quick-trade-no"
                          disabled={!walletEnabled || trading.actionLoading || !noAsk}
                          onClick={() => void handleQuickTrade(outcome.noTokenId, 'BUY')}
                          title={`Buy NO at ${Math.round(noAsk * 100)}¢`}
                        >
                          NO {noAsk ? `${Math.round(noAsk * 100)}¢` : '—'}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
            </>
          )}
        </div>
        )
      })()}

      {tab === 'orders' && (
        <div className="trade-desk-section">
          {!walletEnabled ? (
            <div className="empty-state">Connect wallet on Polygon to view open orders.</div>
          ) : (
            <>
            <div className="trade-desk-actions">
              <button
                className="btn"
                onClick={() => void trading.refreshOpenOrders()}
                disabled={trading.initializing || trading.actionLoading}
              >
                {trading.initializing ? 'Initializing...' : 'Refresh open orders'}
              </button>
            </div>

            <div className="table-wrap">
              <table className="trade-table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Side</th>
                    <th>Outcome</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Matched</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!trading.openOrders.length && (
                    <tr>
                      <td colSpan={8} className="empty-state">No open orders.</td>
                    </tr>
                  )}
                {trading.openOrders.map((order) => (
                  <tr key={order.orderId} className="trade-row">
                    <td>{formatTime(order.createdAt)}</td>
                    <td className={order.side === 'BUY' ? 'trade-buy' : 'trade-sell'}>{order.side}</td>
                    <td className="trade-market" title={order.outcome}>{order.outcome || '—'}</td>
                    <td>{formatPrice(order.price)}</td>
                    <td>{formatCompact(order.size)}</td>
                    <td>{formatCompact(order.matchedSize)}</td>
                    <td>{order.status}</td>
                    <td>
                      <button
                        className="btn btn-small"
                        onClick={() => void trading.cancelOrder(order.orderId)}
                        disabled={trading.actionLoading}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </div>
      )}

      {tab === 'resolved' && (() => {
        const resolvedPositions = monitor.positions.filter(p => p.resolutionStatus !== 'active')
        return (
        <div className="trade-desk-section">
          <div className="trade-desk-actions">
            <button className="btn" onClick={() => void monitor.refresh()} disabled={!walletEnabled || monitor.loading}>
              {monitor.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="table-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Size</th>
                  <th>Avg Cost</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!resolvedPositions.length && (
                  <tr>
                    <td colSpan={6} className="empty-state">No resolved positions.</td>
                  </tr>
                )}
                {resolvedPositions.slice(0, 30).map((position) => (
                  <tr key={`${position.tokenId}-${position.outcome}`} className="trade-row">
                    <td className="trade-market-cell" title={position.title}>
                      <div className="trade-market-title">{position.title}</div>
                      <div className="trade-market-sub">{shortTokenId(position.tokenId)}</div>
                    </td>
                    <td>{position.outcome || '—'}</td>
                    <td>{formatCompact(position.size)}</td>
                    <td>{formatPrice(position.avgPrice)}</td>
                    <td className={position.resolutionStatus === 'won' ? 'trade-buy' : 'trade-sell'}>
                      {position.resolutionStatus === 'won' ? 'Won' : 'Lost'}
                    </td>
                    <td>
                      {position.resolutionStatus === 'won' ? (
                        <button className="btn btn-small" disabled>
                          Redeem
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
