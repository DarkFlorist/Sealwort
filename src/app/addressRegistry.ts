export const ETHEREUM_MAINNET_CHAIN_ID = 1n
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
export const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

export type RegisteredToken = {
	readonly address: bigint
	readonly symbol: string
	readonly label: string
}

type NativeAssetIdentity = { readonly symbol: string, readonly label: string }
type BalanceTokenRegistry = { readonly usdc?: RegisteredToken }

const token = (address: bigint, symbol: string, label: string): RegisteredToken => ({ address, symbol, label })

function transactionContracts<const Definitions extends Readonly<Record<string, { readonly address: bigint, readonly label: string }>>>(definitions: Definitions) {
	return Object.fromEntries(Object.entries(definitions).map(([decoder, identity]) => [decoder, { decoder, chainId: ETHEREUM_MAINNET_CHAIN_ID, ...identity }])) as {
		readonly [Decoder in keyof Definitions]: { readonly decoder: Decoder, readonly chainId: typeof ETHEREUM_MAINNET_CHAIN_ID } & Definitions[Decoder]
	}
}

const MAINNET_USDC = token(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n, 'USDC', 'USDC')
const SEPOLIA_USDC = token(0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n, 'USDC', 'USDC')

export const MAINNET_TRANSACTION_CONTRACTS = transactionContracts({
	uniswapV2Router: { address: 0x7a250d5630b4cf539739df2c5dacb4c659f2488dn, label: 'Uniswap V2 Router' },
	uniswapV3Router: { address: 0xe592427a0aece92de3edee1f18e0157c05861564n, label: 'Uniswap V3 Router' },
	kyberNetworkProxy: { address: 0x9aab3f75489902f3a48495025729a0af77d4b11en, label: 'Kyber Network Proxy' },
	metaMaskSwapRouter: { address: 0x881d40237659c251811cec9c364ef91dc08d300cn, label: 'MetaMask Swap Router' },
})

export type RegisteredTransactionContract = (typeof MAINNET_TRANSACTION_CONTRACTS)[keyof typeof MAINNET_TRANSACTION_CONTRACTS]

type ChainAddressRegistry = {
	readonly nativeAsset: NativeAssetIdentity
	readonly tokens: Readonly<Record<string, RegisteredToken>>
	readonly transactionContracts: Readonly<Record<string, RegisteredTransactionContract>>
	readonly balanceTokens: BalanceTokenRegistry
}

const CHAIN_ADDRESS_REGISTRIES: Readonly<Record<string, ChainAddressRegistry>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: {
		nativeAsset: { symbol: 'ETH', label: 'ETH native asset' },
		tokens: {
			uni: token(0x1f9840a85d5af5bf1d1762f925bdaddc4201f984n, 'UNI', 'UNI'),
			bat: token(0x0d8775f648430679a709e98d2b0cb6250d2887efn, 'BAT', 'BAT'),
			usdt: token(0xdac17f958d2ee523a2206206994597c13d831ec7n, 'USDT', 'USDT'),
			usdc: MAINNET_USDC,
			weth: token(0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n, 'WETH', 'WETH'),
			wbtc: token(0x2260fac5e5542a773aa44fbcfedf7c193bc2c599n, 'WBTC', 'WBTC'),
			dai: token(0x6b175474e89094c44da98b954eedeac495271d0fn, 'DAI', 'DAI'),
			comp: token(0xc00e94cb662c3520282e6f5717214004a7f26888n, 'COMP', 'COMP'),
			mkr: token(0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2n, 'MKR', 'MKR'),
			ampl: token(0xd46ba6d942050d489dbd938a2c909a5d5039a161n, 'AMPL', 'AMPL'),
		},
		transactionContracts: MAINNET_TRANSACTION_CONTRACTS,
		balanceTokens: { usdc: MAINNET_USDC },
	},
	[ETHEREUM_SEPOLIA_CHAIN_ID.toString()]: {
		nativeAsset: { symbol: 'SepoliaETH', label: 'SepoliaETH native asset' },
		tokens: {
			weth: token(0x7b79995e5f793a07bc00c21412e50ecae098e7f9n, 'WETH', 'WETH'),
			usdc: SEPOLIA_USDC,
		},
		transactionContracts: {},
		balanceTokens: { usdc: SEPOLIA_USDC },
	},
}

const UNKNOWN_CHAIN_REGISTRY: ChainAddressRegistry = {
	nativeAsset: { symbol: 'ETH', label: 'ETH native asset' },
	tokens: {},
	transactionContracts: {},
	balanceTokens: {},
}

function chainRegistry(chainId: bigint) {
	return CHAIN_ADDRESS_REGISTRIES[chainId.toString()] ?? UNKNOWN_CHAIN_REGISTRY
}

export function getNativeAssetIdentity(chainId: bigint) {
	return chainRegistry(chainId).nativeAsset
}

export function getRegisteredTokens(chainId: bigint) {
	return Object.values(chainRegistry(chainId).tokens)
}

export function getRegisteredTransactionContracts(chainId: bigint) {
	return Object.values(chainRegistry(chainId).transactionContracts)
}

export function getBalanceToken(chainId: bigint, tokenName: keyof BalanceTokenRegistry) {
	return chainRegistry(chainId).balanceTokens[tokenName]
}

export function getRegisteredAddressLabel(chainId: bigint, value: bigint) {
	const registry = chainRegistry(chainId)
	const tokenDefinition = Object.values(registry.tokens).find(({ address }) => address === value)
	if (tokenDefinition !== undefined) return tokenDefinition.label
	return Object.values(registry.transactionContracts).find(({ address }) => address === value)?.label
}
