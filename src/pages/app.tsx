import Head from 'next/head'
import TerminalShell from '@/components/TerminalShell'

export default function App() {
  return (
    <>
      <Head>
        <title>PolyTerminal</title>
        <meta name="description" content="Open-source Polymarket terminal for weather, sports, politics, crypto, and more." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
      </Head>
      <TerminalShell />
    </>
  )
}
