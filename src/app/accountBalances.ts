import * as funtypes from 'funtypes'
import { getBalanceToken, getNativeAssetIdentity } from './addressRegistry.js'
import { getNativeAssetSymbol } from './assetFormatting.js'
import { readTokenBalance } from './contractMetadata.js'
import { addressString } from './ethereum.js'
import type { InjectedProvider } from './provider.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'

export type AssetBalance =
	| { readonly status: 'available', readonly value: bigint }
	| { readonly status: 'unavailable', readonly error: string }

export type ConnectedSafeBalances = {
	readonly native: {
		readonly symbol: string
		readonly balance: AssetBalance
	}
	readonly usdc?: {
		readonly symbol: string
		readonly balance: AssetBalance
	}
}

export type NativeAssetBalance = ConnectedSafeBalances['native']

export function getPreferredNativeAssetBalance(
	primary: NativeAssetBalance | undefined,
	fallback: NativeAssetBalance | undefined,
) {
	if (primary?.balance.status === 'available') return primary
	if (fallback?.balance.status === 'available') return fallback
	return primary ?? fallback
}

type ChainBalanceConfiguration = {
	readonly nativeSymbol: string
	readonly usdc?: {
		readonly symbol: string
		readonly address: bigint
	}
}

function getChainBalanceConfiguration(chainId: bigint): ChainBalanceConfiguration {
	const nativeSymbol = getNativeAssetIdentity(chainId).symbol
	const usdc = getBalanceToken(chainId, 'usdc')
	return usdc === undefined ? { nativeSymbol } : { nativeSymbol, usdc: { symbol: usdc.symbol, address: usdc.address } }
}

function parseEthereumQuantity(value: unknown, label: string) {
	const quantity = funtypes.String.parse(value)
	if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(quantity)) throw new Error(`${ label } is not a valid Ethereum quantity.`)
	return BigInt(quantity)
}

async function readAssetBalance(read: () => Promise<bigint>): Promise<AssetBalance> {
	try {
		return { status: 'available', value: await read() }
	} catch (balanceError) {
		return { status: 'unavailable', error: getUserFacingErrorMessage(balanceError) }
	}
}

export async function readNativeAssetBalance(provider: InjectedProvider, address: bigint, chainId: bigint): Promise<NativeAssetBalance> {
	const symbol = getChainBalanceConfiguration(chainId).nativeSymbol
	return {
		symbol,
		balance: await readAssetBalance(async () => parseEthereumQuantity(
			await provider.request({
				method: 'eth_getBalance',
				params: [addressString(address), 'latest'],
			}),
			`${ symbol } balance`,
		)),
	}
}

export async function readConnectedSafeBalances(provider: InjectedProvider, safeAddress: bigint, chainId: bigint): Promise<ConnectedSafeBalances> {
	const configuration = getChainBalanceConfiguration(chainId)
	const nativeBalancePromise = readNativeAssetBalance(provider, safeAddress, chainId)
	if (configuration.usdc === undefined) {
		return {
			native: await nativeBalancePromise,
		}
	}
	const usdcConfiguration = configuration.usdc
	const [native, usdcBalance] = await Promise.all([
		nativeBalancePromise,
		readAssetBalance(async () => await readTokenBalance(provider, usdcConfiguration.address, safeAddress, usdcConfiguration.symbol)),
	])
	return {
		native,
		usdc: {
			symbol: usdcConfiguration.symbol,
			balance: usdcBalance,
		},
	}
}
