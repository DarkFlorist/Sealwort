import * as funtypes from 'funtypes'
import { createContract } from 'micro-eth-signer/advanced/abi.js'
import { TOKEN_METADATA_ABI } from './abis/tokenMetadata.js'
import { getNativeAssetSymbol } from './assetFormatting.js'
import { addressString, bytesFromHex, bytesToHex, ensureHex } from './ethereum.js'
import type { InjectedProvider } from './safeStackValidation.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'

const ETHEREUM_MAINNET_CHAIN_ID = 1n
const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111n
const MAINNET_USDC_ADDRESS = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n
const SEPOLIA_USDC_ADDRESS = 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238n
const TokenMetadataContract = createContract(TOKEN_METADATA_ABI)

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
	switch (chainId) {
		case ETHEREUM_MAINNET_CHAIN_ID:
			return {
				nativeSymbol: getNativeAssetSymbol(chainId),
				usdc: { symbol: 'USDC', address: MAINNET_USDC_ADDRESS },
			}
		case ETHEREUM_SEPOLIA_CHAIN_ID:
			return {
				nativeSymbol: getNativeAssetSymbol(chainId),
				usdc: { symbol: 'SepoliaUSDC', address: SEPOLIA_USDC_ADDRESS },
			}
		default:
			return { nativeSymbol: getNativeAssetSymbol(chainId) }
	}
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

async function readTokenBalance(provider: InjectedProvider, tokenAddress: bigint, owner: bigint, symbol: string) {
	const result = funtypes.String.parse(await provider.request({
		method: 'eth_call',
		params: [{
			to: addressString(tokenAddress),
			data: bytesToHex(TokenMetadataContract.balanceOf.encodeInput(addressString(owner))),
		}, 'latest'],
	}))
	return TokenMetadataContract.balanceOf.decodeOutput(bytesFromHex(ensureHex(result, `${ symbol } balanceOf result`)))
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
