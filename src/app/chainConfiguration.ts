import { KYBER_NETWORK_PROXY_CONTRACT, TOKENS, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT } from 'micro-eth-signer/advanced/abi.js'

export const ETHEREUM_MAINNET_CHAIN_ID = 1n
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
export const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

type BalanceTokenConfiguration = { readonly symbol: string, readonly address: bigint }
type TokenDeployment = { readonly symbol: string, readonly address: bigint }
export type TransactionContractDeployments = {
	readonly uniswapV2Router: bigint
	readonly uniswapV3Router: bigint
	readonly kyberNetworkProxy: bigint
	readonly metaMaskSwapRouter: bigint
}
export type ChainConfiguration = {
	readonly nativeSymbol: string
	readonly tokens: readonly TokenDeployment[]
	readonly balanceTokens?: { readonly usdc: BalanceTokenConfiguration }
	readonly transactionContracts?: TransactionContractDeployments
}

const MAINNET_TOKENS = Object.entries(TOKENS).flatMap(([address, { symbol }]) =>
	/^0x[0-9a-fA-F]{40}$/u.test(address) ? [{ address: BigInt(address), symbol }] : [],
)
const MAINNET_USDC = MAINNET_TOKENS.find(({ symbol }) => symbol === 'USDC')
const SEPOLIA_WETH_ADDRESS = 0x7b79995e5f793a07bc00c21412e50ecae098e7f9n
const SEPOLIA_USDC_ADDRESS = 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n
const MAINNET_METAMASK_SWAP_ROUTER_ADDRESS = 0x881d40237659c251811cec9c364ef91dc08d300cn

export const CHAIN_CONFIGURATIONS: Readonly<Record<string, ChainConfiguration>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: {
		nativeSymbol: 'ETH',
		tokens: MAINNET_TOKENS,
		...(MAINNET_USDC === undefined ? {} : { balanceTokens: { usdc: { symbol: 'USDC', address: MAINNET_USDC.address } } }),
		transactionContracts: {
			uniswapV2Router: BigInt(UNISWAP_V2_ROUTER_CONTRACT),
			uniswapV3Router: BigInt(UNISWAP_V3_ROUTER_CONTRACT),
			kyberNetworkProxy: BigInt(KYBER_NETWORK_PROXY_CONTRACT),
			metaMaskSwapRouter: MAINNET_METAMASK_SWAP_ROUTER_ADDRESS,
		},
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
