import * as funtypes from 'funtypes'
import { concatBytes } from '@noble/hashes/utils'
import { addressString, bytesFromHex, bytesToHex, ensureHex, type Hex } from './ethereum.js'
import { normalizeSafeSignature } from './safeProtocol.js'
import type { SafeStackTransaction, SafeTx } from './safeStackProtocol.js'
import type { InjectedProvider } from './safeStackValidation.js'
import { ABI_WORD_BYTES, addressWord, encodeDynamicBytes, uint256Word } from './abiEncoding.js'

const EXEC_TRANSACTION_SELECTOR = bytesFromHex('0x6a761202')
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u
const EXEC_TRANSACTION_HEAD_BYTES = 10 * ABI_WORD_BYTES
const ETHEREUM_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u
const DEFAULT_PRIORITY_FEE_PER_GAS = 100_000_000n

function prevalidatedSafeSignature(signer: bigint) {
	return `${ signer.toString(16).padStart(64, '0') }${ '0'.repeat(64) }01`
}

function encodeOrderedSignatures(signatures: SafeStackTransaction['signatures'], prevalidatedSigner: bigint | undefined = undefined) {
	const orderedSignatures = [
		...signatures.map(({ signer, signature }) => ({ signer, signature: normalizeSafeSignature(signature).slice(2) })),
		...(prevalidatedSigner === undefined ? [] : [{ signer: prevalidatedSigner, signature: prevalidatedSafeSignature(prevalidatedSigner) }]),
	].sort((left, right) => left.signer < right.signer ? -1 : left.signer > right.signer ? 1 : 0)
	const concatenated = `0x${ orderedSignatures.map(({ signature }) => signature).join('') }`
	return bytesFromHex(ensureHex(concatenated, 'Safe execution signatures'))
}

export function encodeSafeExecutionCall(safeTx: SafeTx, signatures: SafeStackTransaction['signatures'], prevalidatedSigner: bigint | undefined = undefined) {
	if (safeTx.message.operation < 0n || safeTx.message.operation >= 256n) throw new Error('Safe transaction operation is outside the uint8 range.')
	const encodedData = encodeDynamicBytes(safeTx.message.data)
	const encodedSignatures = encodeDynamicBytes(encodeOrderedSignatures(signatures, prevalidatedSigner))
	return bytesToHex(concatBytes(
		EXEC_TRANSACTION_SELECTOR,
		addressWord(safeTx.message.to, 'Safe transaction destination'),
		uint256Word(safeTx.message.value, 'Safe transaction value'),
		uint256Word(BigInt(EXEC_TRANSACTION_HEAD_BYTES), 'Safe transaction data offset'),
		uint256Word(safeTx.message.operation, 'Safe transaction operation'),
		uint256Word(safeTx.message.safeTxGas, 'Safe transaction gas'),
		uint256Word(safeTx.message.baseGas, 'Safe transaction base gas'),
		uint256Word(safeTx.message.gasPrice, 'Safe transaction gas price'),
		addressWord(safeTx.message.gasToken, 'Safe transaction gas token'),
		addressWord(safeTx.message.refundReceiver, 'Safe transaction refund receiver'),
		uint256Word(BigInt(EXEC_TRANSACTION_HEAD_BYTES + encodedData.length), 'Safe execution signatures offset'),
		encodedData,
		encodedSignatures,
	))
}

function parseEthereumQuantity(value: unknown, label: string) {
	const quantity = funtypes.String.parse(value)
	if (!ETHEREUM_QUANTITY_PATTERN.test(quantity)) throw new Error(`${ label } is not a valid Ethereum quantity.`)
	return BigInt(quantity)
}

function safeExecutionRequest(executor: bigint, safeAddress: bigint, transaction: Pick<SafeStackTransaction, 'safeTx' | 'signatures'>, prevalidatedSigner: bigint | undefined = undefined) {
	return {
		from: addressString(executor),
		to: addressString(safeAddress),
		data: encodeSafeExecutionCall(transaction.safeTx, transaction.signatures, prevalidatedSigner),
	}
}

export type SafeExecutionGasFunding = {
	readonly balance: bigint
	readonly estimatedGas: bigint
	readonly maxFeePerGas: bigint
	readonly requiredBalance: bigint
}

function readBaseFeePerGas(block: unknown) {
	if (typeof block !== 'object' || block === null || !('baseFeePerGas' in block)) return undefined
	if (block.baseFeePerGas === undefined || block.baseFeePerGas === null) return undefined
	return parseEthereumQuantity(block.baseFeePerGas, 'Latest block base fee')
}

export async function readSafeExecutionGasFunding(
	provider: InjectedProvider,
	executor: bigint,
	safeAddress: bigint,
	transaction: Pick<SafeStackTransaction, 'safeTx' | 'signatures'>,
	prevalidatedSigner: bigint | undefined = undefined,
): Promise<SafeExecutionGasFunding> {
	const request = safeExecutionRequest(executor, safeAddress, transaction, prevalidatedSigner)
	const priorityFeePromise = provider.request({ method: 'eth_maxPriorityFeePerGas' }).catch(() => undefined)
	const [balanceResult, estimatedGasResult, gasPriceResult, latestBlockResult, priorityFeeResult] = await Promise.all([
		provider.request({ method: 'eth_getBalance', params: [request.from, 'latest'] }),
		provider.request({ method: 'eth_estimateGas', params: [request] }),
		provider.request({ method: 'eth_gasPrice' }),
		provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }),
		priorityFeePromise,
	])
	const balance = parseEthereumQuantity(balanceResult, 'Execution signer balance')
	const estimatedGas = parseEthereumQuantity(estimatedGasResult, 'Gnosis Safe execution gas estimate')
	const gasPrice = parseEthereumQuantity(gasPriceResult, 'Gas price')
	const baseFeePerGas = readBaseFeePerGas(latestBlockResult)
	const fallbackPriorityFeePerGas = baseFeePerGas === undefined || gasPrice <= baseFeePerGas
		? DEFAULT_PRIORITY_FEE_PER_GAS
		: gasPrice - baseFeePerGas
	const priorityFeePerGas = priorityFeeResult === undefined
		? fallbackPriorityFeePerGas
		: parseEthereumQuantity(priorityFeeResult, 'Maximum priority fee')
	const maxFeePerGas = baseFeePerGas === undefined
		? gasPrice
		: baseFeePerGas * 2n + priorityFeePerGas
	return { balance, estimatedGas, maxFeePerGas, requiredBalance: estimatedGas * maxFeePerGas }
}

export async function submitSafeExecution(
	provider: InjectedProvider,
	executor: bigint,
	safeAddress: bigint,
	transaction: Pick<SafeStackTransaction, 'safeTx' | 'signatures'>,
): Promise<Hex> {
	const result = funtypes.String.parse(await provider.request({
		method: 'eth_sendTransaction',
		params: [safeExecutionRequest(executor, safeAddress, transaction)],
	}))
	if (!TRANSACTION_HASH_PATTERN.test(result)) throw new Error('The wallet returned an invalid execution transaction hash.')
	return ensureHex(result, 'Safe execution transaction hash')
}
