import Head from 'next/head'
import Link from 'next/link'

export default function Landing() {
  const tallyFormUrl = 'https://tally.so/r/gDM7d1'

  return (
    <>
      <Head>
        <title>PolyTerminal - Real-time Polymarket Data</title>
        <meta name="description" content="Real-time data and insights for Polymarket. Charts, prices, and tools to understand prediction markets." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
      </Head>

      <div className="landing">
        {/* Hero Section */}
        <header className="landing-hero">
          <div className="landing-logo">PolyTerminal</div>
          <h1 className="landing-tagline">Understand prediction markets with data</h1>
          <p className="landing-subtext">
            Stop guessing. Start seeing clearly.<br />
            Charts, order book, trades, and analysis — all in one place.
          </p>
          <div className="landing-cta-row">
            <Link href="/app" className="landing-btn landing-btn-primary">
              Explore Live Markets
            </Link>
          </div>
          <a href={tallyFormUrl} target="_blank" rel="noopener noreferrer" className="landing-updates-link">
            Want updates? Sign up here
          </a>
        </header>

        {/* Screenshot Section */}
        <section className="landing-screenshot">
          <img src="/screenshot.png" alt="PolyTerminal chart view" className="landing-screenshot-img" />
        </section>

        {/* Live Now Section */}
        <section className="landing-section">
          <div className="landing-section-header">
            <span className="landing-section-tag">Live Now</span>
          </div>
          <div className="landing-features">
            <div className="landing-feature">
              <span className="landing-feature-check">&#10003;</span>
              <span>Real-time prices, order book, and volume</span>
            </div>
            <div className="landing-feature">
              <span className="landing-feature-check">&#10003;</span>
              <span>Multi-outcome charts with trade history</span>
            </div>
            <div className="landing-feature">
              <span className="landing-feature-check">&#10003;</span>
              <span>Weather analysis with live forecasts</span>
            </div>
            <div className="landing-feature">
              <span className="landing-feature-check">&#10003;</span>
              <span>Market comparison tools</span>
            </div>
          </div>
          <p className="landing-section-note">Currently optimized for weather markets — more categories coming soon.</p>
        </section>

        {/* Coming Soon Section */}
        <section className="landing-section">
          <div className="landing-section-header">
            <span className="landing-section-tag">Coming Soon</span>
          </div>
          <div className="landing-roadmap">
            <div className="landing-roadmap-item">
              <span className="landing-roadmap-arrow">&rarr;</span>
              <div className="landing-roadmap-content">
                <span className="landing-roadmap-title">Monitoring</span>
                <span className="landing-roadmap-desc">Track markets &amp; price movements</span>
              </div>
            </div>
            <div className="landing-roadmap-item">
              <span className="landing-roadmap-arrow">&rarr;</span>
              <div className="landing-roadmap-content">
                <span className="landing-roadmap-title">Alerts</span>
                <span className="landing-roadmap-desc">Get notified on conditions</span>
              </div>
            </div>
            <div className="landing-roadmap-item">
              <span className="landing-roadmap-arrow">&rarr;</span>
              <div className="landing-roadmap-content">
                <span className="landing-roadmap-title">API Access</span>
                <span className="landing-roadmap-desc">Plug into your workflow</span>
              </div>
            </div>
            <div className="landing-roadmap-item">
              <span className="landing-roadmap-arrow">&rarr;</span>
              <div className="landing-roadmap-content">
                <span className="landing-roadmap-title">More Markets</span>
                <span className="landing-roadmap-desc">Sports, Politics, Crypto</span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="landing-footer">
          <Link href="/app" className="landing-btn landing-btn-primary">
            Explore Live Markets
          </Link>
          <div className="landing-footer-links">
            <a href={tallyFormUrl} target="_blank" rel="noopener noreferrer" className="landing-footer-link">Get Updates</a>
            <span className="landing-footer-divider">|</span>
            <a href={tallyFormUrl} target="_blank" rel="noopener noreferrer" className="landing-footer-link">Feedback</a>
          </div>
          <p className="landing-disclaimer">
            Data provided by third-party sources. Verify all information independently before making decisions.
            Not financial advice. Use at your own risk. We are not responsible for any losses or damages.
          </p>
        </footer>
      </div>
    </>
  )
}
