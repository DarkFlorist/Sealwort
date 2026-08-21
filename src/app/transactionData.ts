import { createContract, Decoder, type ContractABI, type SignatureInfo } from 'micro-eth-signer/advanced/abi.js'
import { formatTokenBalance } from './accountBalances.js'
import { ERC721_INTERFACE_ID } from './abis/erc721Interface.js'
import { TOKEN_METADATA_ABI } from './abis/tokenMetadata.js'
import { transactionAbisForDestination } from './abis/transaction.js'
import { addressString, bytesFromHex, bytesToHex, ensureHex, type Hex } from './ethereum.js'
import type { InjectedProvider } from './safeStackValidation.js'

function decodeWithAbi(destination: string, data: Uint8Array, abi: ContractABI) {
	const decoder = new Decoder()
	decoder.add(destination, abi)
	return decoder.decode(destination, data)
}

function decodeWithTransactionAbis(destination: bigint, data: Uint8Array) {
	const destinationAddress = addressString(destination)
	return transactionAbisForDestination(destinationAddress).flatMap((abi) => {
		const decoded = decodeWithAbi(destinationAddress, data, abi)
		return decoded === undefined ? [] : Array.isArray(decoded) ? decoded : [decoded]
	})
}

export type DecodedTransactionData = {
	readonly name: string
	readonly signature: string
	readonly arguments: Readonly<Record<string, unknown>> | readonly unknown[] | undefined
}

export type TransactionDataDecodeResult =
	| { readonly status: 'empty' }
	| { readonly status: 'unknown' }
	| { readonly status: 'error', readonly error: string }
	| { readonly status: 'decoded', readonly call: DecodedTransactionData }

function uniqueCandidates(decoded: SignatureInfo | readonly SignatureInfo[]) {
	const candidates = Array.isArray(decoded) ? decoded : [decoded]
	return candidates.filter((candidate, index) => candidates.findIndex(({ signature }) => signature === candidate.signature) === index)
}

export function decodeTransactionData(destination: bigint, data: Uint8Array): TransactionDataDecodeResult {
	if (data.length === 0) return { status: 'empty' }
	try {
		const decoded = decodeWithTransactionAbis(destination, data)
		if (decoded.length === 0) return { status: 'unknown' }
		const candidates = uniqueCandidates(decoded)
		// The requested payment helper shares its selector with ERC-721's three-argument
		// safeTransferFrom. Prefer the helper's descriptive argument names; the four-
		// argument ERC-721 overload remains unambiguous.
		const call = candidates[0]?.signature === 'safeTransferFrom(address,address,uint256)'
			? [...decoded].reverse().find(({ signature }) => signature === 'safeTransferFrom(address,address,uint256)')
			: candidates[0]
		if (call === undefined) return { status: 'unknown' }
		return {
			status: 'decoded',
			call: {
				name: call.name,
				signature: call.signature,
				arguments: call.value as Readonly<Record<string, unknown>> | readonly unknown[] | undefined,
			},
		}
	} catch (decodeError) {
		return { status: 'error', error: decodeError instanceof Error ? decodeError.message : 'Calldata is malformed.' }
	}
}

export function decodedArguments(call: DecodedTransactionData): readonly { readonly name: string, readonly value: unknown }[] {
	if (call.arguments === undefined) return []
	if (Array.isArray(call.arguments)) return call.arguments.map((value, index) => ({ name: `Argument ${ index + 1 }`, value }))
	return Object.entries(call.arguments).map(([name, value]) => ({ name: name.replace(/^_/u, '') || 'Argument', value }))
}

export type AmountTokenReference = 'destination' | 'liquidity' | 'native' | 'vaultAsset' | bigint
const NATIVE_TOKEN_SENTINEL = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen

function recordValue(scope: Readonly<Record<string, unknown>>, name: string) {
	const value = scope[name]
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/u.test(value)) return undefined
	const address = BigInt(value)
	return address === NATIVE_TOKEN_SENTINEL ? 'native' as const : address
}

function pathToken(scope: Readonly<Record<string, unknown>>, end: 'first' | 'last') {
	const path = scope.path
	if (Array.isArray(path)) {
		const value = path[end === 'first' ? 0 : path.length - 1]
		return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value) ? BigInt(value) : undefined
	}
	if (!(path instanceof Uint8Array) || path.length < 43 || (path.length - 20) % 23 !== 0) return undefined
	const offset = end === 'first' ? 0 : path.length - 20
	return BigInt(bytesToHex(path.slice(offset, offset + 20)))
}

export function amountTokenForArgument(call: DecodedTransactionData, argumentName: string, scope: Readonly<Record<string, unknown>>): AmountTokenReference | undefined {
	const name = argumentName.replace(/^_/u, '')
	const normalized = name.toLowerCase()
	const signature = call.signature
	if (signature === 'transfer(address,uint256)' || signature === 'approve(address,uint256)' || signature === 'transferFrom(address,address,uint256)' || signature.startsWith('permit(address,address,uint256,')) return normalized === 'value' ? 'destination' : undefined
	if (signature === 'withdraw(uint256)') return normalized === 'wad' ? 'destination' : undefined
	if (signature === 'transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)') return normalized === 'amount' || normalized === 'feeamount' ? recordValue(scope, '_tokenAddress') ?? recordValue(scope, 'tokenAddress') : undefined
	if (signature === 'safeTransferFrom(address,address,uint256)') return normalized === 'amount' ? recordValue(scope, '_tokenAddress') ?? recordValue(scope, 'tokenAddress') : undefined
	if (/^(?:deposit|withdraw|requestDeposit)\(uint256,address(?:,address)?\)$/u.test(signature)) return normalized === 'assets' ? 'vaultAsset' : undefined
	if (/^(?:mint|redeem|requestRedeem)\(uint256,address(?:,address)?\)$/u.test(signature)) return normalized === 'shares' ? 'destination' : undefined
	if (call.name === 'swap' && normalized === 'amount') return recordValue(scope, 'tokenFrom')
	if (normalized === 'srcamount' || normalized === 'srcqty') return recordValue(scope, 'src')
	if (normalized === 'maxdestamount') return recordValue(scope, 'dest')
	if (normalized.startsWith('amounta')) return recordValue(scope, 'tokenA')
	if (normalized.startsWith('amountb')) return recordValue(scope, 'tokenB')
	if (normalized === 'liquidity') return 'liquidity'
	if (normalized.includes('eth')) return 'native'
	if (normalized === 'amounttokenmin' || normalized === 'amounttokendesired') return recordValue(scope, 'token')
	if (normalized === 'amountin' || normalized === 'amountinmax') return recordValue(scope, 'tokenIn') ?? pathToken(scope, 'first')
	if (normalized === 'amountout') return call.name.includes('ForETH') ? 'native' : recordValue(scope, 'tokenOut') ?? pathToken(scope, Object.hasOwn(scope, 'amountInMaximum') ? 'first' : 'last')
	if (normalized === 'amountoutmin') return call.name.includes('ForETH') ? 'native' : recordValue(scope, 'tokenOut') ?? pathToken(scope, 'last')
	if (normalized === 'amountinmaximum') return recordValue(scope, 'tokenIn') ?? pathToken(scope, 'last')
	if (normalized === 'amountoutminimum') return recordValue(scope, 'tokenOut') ?? pathToken(scope, 'last')
	if (normalized === 'amountminimum' && call.name.startsWith('unwrapWETH9')) return 'native'
	if ((normalized === 'value' && call.name.startsWith('selfPermit')) || normalized === 'amountminimum') return recordValue(scope, 'token')
	return undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

export function amountTokenReferences(call: DecodedTransactionData) {
	const references: AmountTokenReference[] = []
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry)
			return
		}
		if (!isRecord(value)) return
		for (const [name, entry] of Object.entries(value)) {
			if (typeof entry === 'bigint') {
				const reference = amountTokenForArgument(call, name, value)
				if (reference !== undefined) references.push(reference)
			}
			visit(entry)
		}
	}
	visit(call.arguments)
	return references.filter((reference, index) => references.findIndex((candidate) => candidate === reference) === index)
}

export function formatDecodedValue(value: unknown): string {
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'boolean') return value ? 'Yes' : 'No'
	if (typeof value === 'string') return value
	if (value instanceof Uint8Array) return bytesToHex(value)
	if (Array.isArray(value)) return value.map(formatDecodedValue).join(', ')
	return String(value)
}

export function formatTokenAmount(value: bigint, decimals: number, symbol = 'tokens') {
	return `${ formatTokenBalance(value, decimals, Math.min(decimals, 12)) } ${ symbol }`
}

const TokenMetadataContract = createContract(TOKEN_METADATA_ABI)

async function readContract(provider: InjectedProvider, contractAddress: bigint, data: Uint8Array, label: string) {
	return bytesFromHex(ensureHex(String(await provider.request({
		method: 'eth_call',
		params: [{ to: addressString(contractAddress), data: bytesToHex(data) }, 'latest'],
	})), label))
}

export async function readTokenDecimals(provider: InjectedProvider, tokenAddress: bigint) {
	const response = await readContract(provider, tokenAddress, TokenMetadataContract.decimals.encodeInput(), 'Token decimals result')
	const decimals = TokenMetadataContract.decimals.decodeOutput(response)
	return Number(decimals)
}

export async function readIsErc721(provider: InjectedProvider, tokenAddress: bigint) {
	const call = TokenMetadataContract.supportsInterface.encodeInput(ERC721_INTERFACE_ID)
	const response = await readContract(provider, tokenAddress, call, 'ERC-721 interface result')
	return TokenMetadataContract.supportsInterface.decodeOutput(response)
}

export async function readVaultAsset(provider: InjectedProvider, vaultAddress: bigint) {
	const response = await readContract(provider, vaultAddress, TokenMetadataContract.asset.encodeInput(), 'Vault asset result')
	return BigInt(TokenMetadataContract.asset.decodeOutput(response))
}

export function hasErc721AmountAmbiguity(call: DecodedTransactionData) {
	return call.signature === 'approve(address,uint256)'
		|| call.signature === 'transferFrom(address,address,uint256)'
		|| call.signature === 'safeTransferFrom(address,address,uint256)'
}

export function rawTransactionData(data: Uint8Array): Hex {
	return bytesToHex(data)
}
