import { TOKENS } from 'micro-eth-signer/advanced/abi.js'

export const ETHEREUM_MAINNET_CHAIN_ID = 1n
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
export const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

type BalanceTokenConfiguration = { readonly symbol: string, readonly address: bigint }
export type ChainConfiguration = {
	readonly nativeSymbol: string
	readonly addressLabels: Readonly<Record<string, string>>
	readonly balanceTokens?: { readonly usdc: BalanceTokenConfiguration }
}

const addressKey = (address: bigint) => `0x${ address.toString(16).padStart(40, '0') }`
const MAINNET_TOKEN_LABELS = Object.fromEntries(Object.entries(TOKENS).map(([address, { symbol }]) => [address, symbol]))
const MAINNET_USDC_ENTRY = Object.entries(TOKENS).find(([, token]) => token.symbol === 'USDC')
if (MAINNET_USDC_ENTRY === undefined) throw new Error('The token registry does not include mainnet USDC.')
const MAINNET_USDC_ADDRESS = BigInt(MAINNET_USDC_ENTRY[0])
const SEPOLIA_WETH_ADDRESS = 0x7b79995e5f793a07bc00c21412e50ecae098e7f9n
const SEPOLIA_USDC_ADDRESS = 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n

export const CHAIN_CONFIGURATIONS: Readonly<Record<string, ChainConfiguration>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: {
		nativeSymbol: 'ETH',
		addressLabels: {
			...MAINNET_TOKEN_LABELS,
			[addressKey(NATIVE_TOKEN_SENTINEL)]: 'native asset',
		},
		balanceTokens: { usdc: { symbol: 'USDC', address: MAINNET_USDC_ADDRESS } },
	},
	[ETHEREUM_SEPOLIA_CHAIN_ID.toString()]: {
		nativeSymbol: 'SepoliaETH',
		addressLabels: {
			[addressKey(SEPOLIA_WETH_ADDRESS)]: 'WETH',
			[addressKey(SEPOLIA_USDC_ADDRESS)]: 'USDC',
		},
		balanceTokens: { usdc: { symbol: 'SepoliaUSDC', address: SEPOLIA_USDC_ADDRESS } },
	},
}

export function getChainConfiguration(chainId: bigint): ChainConfiguration {
	return CHAIN_CONFIGURATIONS[chainId.toString()] ?? { nativeSymbol: 'ETH', addressLabels: {} }
}
