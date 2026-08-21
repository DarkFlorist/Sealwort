import { getChainAddressRegistry } from './addressRegistry.js'

export { ETHEREUM_MAINNET_CHAIN_ID, ETHEREUM_SEPOLIA_CHAIN_ID, NATIVE_TOKEN_SENTINEL } from './addressRegistry.js'

type BalanceTokenConfiguration = { readonly symbol: string, readonly address: bigint }
type TokenDeployment = { readonly symbol: string, readonly address: bigint }
export type ChainConfiguration = {
	readonly nativeSymbol: string
	readonly tokens: readonly TokenDeployment[]
	readonly balanceTokens?: { readonly usdc: BalanceTokenConfiguration }
}

export function getChainConfiguration(chainId: bigint): ChainConfiguration {
	const registry = getChainAddressRegistry(chainId)
	const tokens = registry.addresses.flatMap(({ address, label, kind }) => kind === 'token' ? [{ address, symbol: label }] : [])
	const usdcId = registry.balanceTokenIds?.usdc
	const usdc = usdcId === undefined ? undefined : registry.addresses.find(({ id }) => id === usdcId)
	return {
		nativeSymbol: registry.nativeSymbol,
		tokens,
		...(usdc === undefined ? {} : { balanceTokens: { usdc: { symbol: usdc.label, address: usdc.address } } }),
	}
}
