export const ETHEREUM_MAINNET_CHAIN_ID = 1n
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
export const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

export type RegisteredAddress = {
	readonly chainId: bigint
	readonly id: string
	readonly address: bigint
	readonly label: string
	readonly kind: 'token' | 'transactionContract'
}

const address = (chainId: bigint, id: string, value: bigint, label: string, kind: RegisteredAddress['kind']): RegisteredAddress => ({ chainId, id, address: value, label, kind })

const MAINNET_USDC = address(ETHEREUM_MAINNET_CHAIN_ID, 'usdc', 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n, 'USDC', 'token')
const SEPOLIA_USDC = address(ETHEREUM_SEPOLIA_CHAIN_ID, 'usdc', 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n, 'USDC', 'token')

export const MAINNET_UNISWAP_V2_ROUTER = address(ETHEREUM_MAINNET_CHAIN_ID, 'uniswapV2Router', 0x7a250d5630b4cf539739df2c5dacb4c659f2488dn, 'Uniswap V2 Router', 'transactionContract')
export const MAINNET_UNISWAP_V3_ROUTER = address(ETHEREUM_MAINNET_CHAIN_ID, 'uniswapV3Router', 0xe592427a0aece92de3edee1f18e0157c05861564n, 'Uniswap V3 Router', 'transactionContract')
export const MAINNET_KYBER_NETWORK_PROXY = address(ETHEREUM_MAINNET_CHAIN_ID, 'kyberNetworkProxy', 0x9aab3f75489902f3a48495025729a0af77d4b11en, 'Kyber Network Proxy', 'transactionContract')
export const MAINNET_METAMASK_SWAP_ROUTER = address(ETHEREUM_MAINNET_CHAIN_ID, 'metaMaskSwapRouter', 0x881d40237659c251811cec9c364ef91dc08d300cn, 'MetaMask Swap Router', 'transactionContract')

type ChainAddressRegistry = {
	readonly nativeSymbol: string
	readonly addresses: readonly RegisteredAddress[]
	readonly balanceTokenIds?: { readonly usdc: string }
}

const CHAIN_ADDRESS_REGISTRIES: Readonly<Record<string, ChainAddressRegistry>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: {
		nativeSymbol: 'ETH',
		addresses: [
			address(ETHEREUM_MAINNET_CHAIN_ID, 'uni', 0x1f9840a85d5af5bf1d1762f925bdaddc4201f984n, 'UNI', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'bat', 0x0d8775f648430679a709e98d2b0cb6250d2887efn, 'BAT', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'usdt', 0xdac17f958d2ee523a2206206994597c13d831ec7n, 'USDT', 'token'),
			MAINNET_USDC,
			address(ETHEREUM_MAINNET_CHAIN_ID, 'weth', 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n, 'WETH', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'wbtc', 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599n, 'WBTC', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'dai', 0x6b175474e89094c44da98b954eedeac495271d0fn, 'DAI', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'comp', 0xc00e94cb662c3520282e6f5717214004a7f26888n, 'COMP', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'mkr', 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2n, 'MKR', 'token'),
			address(ETHEREUM_MAINNET_CHAIN_ID, 'ampl', 0xd46ba6d942050d489dbd938a2c909a5d5039a161n, 'AMPL', 'token'),
			MAINNET_UNISWAP_V2_ROUTER,
			MAINNET_UNISWAP_V3_ROUTER,
			MAINNET_KYBER_NETWORK_PROXY,
			MAINNET_METAMASK_SWAP_ROUTER,
		],
		balanceTokenIds: { usdc: MAINNET_USDC.id },
	},
	[ETHEREUM_SEPOLIA_CHAIN_ID.toString()]: {
		nativeSymbol: 'SepoliaETH',
		addresses: [
			address(ETHEREUM_SEPOLIA_CHAIN_ID, 'weth', 0x7b79995e5f793a07bc00c21412e50ecae098e7f9n, 'WETH', 'token'),
			SEPOLIA_USDC,
		],
		balanceTokenIds: { usdc: SEPOLIA_USDC.id },
	},
}

export function getChainAddressRegistry(chainId: bigint): ChainAddressRegistry {
	return CHAIN_ADDRESS_REGISTRIES[chainId.toString()] ?? { nativeSymbol: 'ETH', addresses: [] }
}

export function getRegisteredAddress(chainId: bigint, value: bigint) {
	return getChainAddressRegistry(chainId).addresses.find(({ address: registeredAddress }) => registeredAddress === value)
}
