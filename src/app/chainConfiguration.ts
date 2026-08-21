export const ETHEREUM_MAINNET_CHAIN_ID = 1n
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
export const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

type BalanceTokenConfiguration = { readonly symbol: string, readonly address: bigint }
type TokenDeployment = { readonly symbol: string, readonly address: bigint }
export type ChainConfiguration = {
	readonly nativeSymbol: string
	readonly tokens: readonly TokenDeployment[]
	readonly balanceTokens?: { readonly usdc: BalanceTokenConfiguration }
}

const MAINNET_USDC_ADDRESS = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n
const MAINNET_TOKENS: readonly TokenDeployment[] = [
	{ symbol: 'UNI', address: 0x1f9840a85d5af5bf1d1762f925bdaddc4201f984n },
	{ symbol: 'BAT', address: 0x0d8775f648430679a709e98d2b0cb6250d2887efn },
	{ symbol: 'USDT', address: 0xdac17f958d2ee523a2206206994597c13d831ec7n },
	{ symbol: 'USDC', address: MAINNET_USDC_ADDRESS },
	{ symbol: 'WETH', address: 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n },
	{ symbol: 'WBTC', address: 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599n },
	{ symbol: 'DAI', address: 0x6b175474e89094c44da98b954eedeac495271d0fn },
	{ symbol: 'COMP', address: 0xc00e94cb662c3520282e6f5717214004a7f26888n },
	{ symbol: 'MKR', address: 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2n },
	{ symbol: 'AMPL', address: 0xd46ba6d942050d489dbd938a2c909a5d5039a161n },
]
const SEPOLIA_WETH_ADDRESS = 0x7b79995e5f793a07bc00c21412e50ecae098e7f9n
const SEPOLIA_USDC_ADDRESS = 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n
export const CHAIN_CONFIGURATIONS: Readonly<Record<string, ChainConfiguration>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: {
		nativeSymbol: 'ETH',
		tokens: MAINNET_TOKENS,
		balanceTokens: { usdc: { symbol: 'USDC', address: MAINNET_USDC_ADDRESS } },
	},
	[ETHEREUM_SEPOLIA_CHAIN_ID.toString()]: {
		nativeSymbol: 'SepoliaETH',
		tokens: [{ symbol: 'WETH', address: SEPOLIA_WETH_ADDRESS }, { symbol: 'USDC', address: SEPOLIA_USDC_ADDRESS }],
		balanceTokens: { usdc: { symbol: 'SepoliaUSDC', address: SEPOLIA_USDC_ADDRESS } },
	},
}

export function getChainConfiguration(chainId: bigint): ChainConfiguration {
	return CHAIN_CONFIGURATIONS[chainId.toString()] ?? { nativeSymbol: 'ETH', tokens: [] }
}
