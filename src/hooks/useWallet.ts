// Stubbed until wallet integration is ready
// TODO: Re-enable ethers dependency and full implementation when needed

export function useWallet() {
  return {
    address: null,
    chainId: null,
    provider: null,
    signer: null,
    connecting: false,
    connected: false,
    isPolygon: false,
    error: null,
    connect: async () => {
      console.warn('Wallet integration not yet enabled')
    },
    disconnect: () => {}
  }
}
