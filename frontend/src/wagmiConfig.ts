import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: {
    [base.id]: http(),
  },
})

export const BASE_ID = base.id
