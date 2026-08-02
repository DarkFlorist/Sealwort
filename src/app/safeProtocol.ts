import { secp256k1 } from '@noble/curves/secp256k1'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils'
import { addr } from 'micro-eth-signer'
import { addressString, bytes32String, bytesFromHex, bytesToHex, dataStringWith0xStart, ensureHex, keccak256, type Hex } from './ethereum.js'
import type { SafeTransactionStack, SafeTx } from './safeStackProtocol.js'
import { addressWord, encodeDynamicBytes, uint256Word } from './abiEncoding.js'

export const SAFE_TX_FIELDS = [
	{ name: 'to', type: 'address' },
	{ name: 'value', type: 'uint256' },
	{ name: 'data', type: 'bytes' },
	{ name: 'operation', type: 'uint8' },
	{ name: 'safeTxGas', type: 'uint256' },
	{ name: 'baseGas', type: 'uint256' },
	{ name: 'gasPrice', type: 'uint256' },
	{ name: 'gasToken', type: 'address' },
	{ name: 'refundReceiver', type: 'address' },
	{ name: 'nonce', type: 'uint256' },
] as const

export const SAFE_DOMAIN_FIELDS = [
	{ name: 'chainId', type: 'uint256' },
	{ name: 'verifyingContract', type: 'address' },
] as const

const SAFE_TX_TYPE = 'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
const DOMAIN_TYPE = 'EIP712Domain(uint256 chainId,address verifyingContract)'
const GET_TRANSACTION_HASH_SELECTOR = keccak256(utf8ToBytes('getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)')).slice(0, 4)
const SAFE_TRANSACTION_HASH_HEAD_BYTES = 10 * 32
const typeHash = (value: string) => keccak256(utf8ToBytes(value))

export function encodeSafeTransactionHashCall(safeTx: SafeTx) {
	const message = safeTx.message
	return bytesToHex(concatBytes(
		GET_TRANSACTION_HASH_SELECTOR,
		addressWord(message.to, 'Safe transaction destination'),
		uint256Word(message.value, 'Safe transaction value'),
		uint256Word(BigInt(SAFE_TRANSACTION_HASH_HEAD_BYTES), 'Safe transaction data offset'),
		uint256Word(message.operation, 'Safe transaction operation'),
		uint256Word(message.safeTxGas, 'Safe transaction gas'),
		uint256Word(message.baseGas, 'Safe transaction base gas'),
		uint256Word(message.gasPrice, 'Safe transaction gas price'),
		addressWord(message.gasToken, 'Safe transaction gas token'),
		addressWord(message.refundReceiver, 'Safe transaction refund receiver'),
		uint256Word(message.nonce, 'Safe transaction nonce'),
		encodeDynamicBytes(message.data),
	))
}

export function getSafeTxHash(safeTx: SafeTx) {
	if (safeTx.domain.chainId === undefined) throw new Error('Safe transaction chain ID is missing.')
	const message = safeTx.message
	const domainHash = keccak256(concatBytes(
		typeHash(DOMAIN_TYPE),
		uint256Word(safeTx.domain.chainId, 'Safe chain ID'),
		addressWord(safeTx.domain.verifyingContract, 'Safe verifying contract'),
	))
	const messageHash = keccak256(concatBytes(
		typeHash(SAFE_TX_TYPE),
		addressWord(message.to, 'Safe transaction destination'),
		uint256Word(message.value, 'Safe transaction value'),
		keccak256(message.data),
		uint256Word(message.operation, 'Safe transaction operation'),
		uint256Word(message.safeTxGas, 'Safe transaction gas'),
		uint256Word(message.baseGas, 'Safe transaction base gas'),
		uint256Word(message.gasPrice, 'Safe transaction gas price'),
		addressWord(message.gasToken, 'Safe transaction gas token'),
		addressWord(message.refundReceiver, 'Safe transaction refund receiver'),
		uint256Word(message.nonce, 'Safe transaction nonce'),
	))
	return bytesToHex(keccak256(concatBytes(new Uint8Array([0x19, 0x01]), domainHash, messageHash)))
}

export function createSafeTx(chainId: bigint, safeAddress: bigint, transaction: {
	readonly to: bigint
	readonly value: bigint
	readonly input: Uint8Array
}, nonce: bigint): SafeTx {
	return {
		types: { SafeTx: SAFE_TX_FIELDS, EIP712Domain: SAFE_DOMAIN_FIELDS },
		primaryType: 'SafeTx',
		domain: { chainId, verifyingContract: safeAddress },
		message: {
			to: transaction.to,
			value: transaction.value,
			data: transaction.input,
			operation: 0n,
			safeTxGas: 0n,
			baseGas: 0n,
			gasPrice: 0n,
			gasToken: 0n,
			refundReceiver: 0n,
			nonce,
		},
	}
}

export function safeTxToTypedData(safeTx: SafeTx) {
	if (safeTx.domain.chainId === undefined) throw new Error('Safe transaction chain ID is missing.')
	return {
		types: { SafeTx: SAFE_TX_FIELDS, EIP712Domain: SAFE_DOMAIN_FIELDS },
		primaryType: 'SafeTx' as const,
		domain: {
			chainId: safeTx.domain.chainId,
			verifyingContract: addressString(safeTx.domain.verifyingContract),
		},
		message: {
			to: addressString(safeTx.message.to),
			value: safeTx.message.value,
			data: safeTx.message.data,
			operation: safeTx.message.operation,
			safeTxGas: safeTx.message.safeTxGas,
			baseGas: safeTx.message.baseGas,
			gasPrice: safeTx.message.gasPrice,
			gasToken: addressString(safeTx.message.gasToken),
			refundReceiver: addressString(safeTx.message.refundReceiver),
			nonce: safeTx.message.nonce,
		},
	}
}

export function safeTxToTypedDataJson(safeTx: SafeTx) {
	const typedData = safeTxToTypedData(safeTx)
	return JSON.stringify({
		...typedData,
		domain: { ...typedData.domain, chainId: typedData.domain.chainId.toString() },
		message: {
			...typedData.message,
			value: typedData.message.value.toString(),
			data: dataStringWith0xStart(typedData.message.data),
			operation: typedData.message.operation.toString(),
			safeTxGas: typedData.message.safeTxGas.toString(),
			baseGas: typedData.message.baseGas.toString(),
			gasPrice: typedData.message.gasPrice.toString(),
			nonce: typedData.message.nonce.toString(),
		},
	})
}

export function normalizeSafeSignature(signature: string): Hex {
	const hex = ensureHex(signature, 'Safe owner signature')
	if (hex.length !== 132) throw new Error('Safe owner signature must be exactly 65 bytes.')
	const recoveryByte = Number.parseInt(hex.slice(-2), 16)
	if (recoveryByte !== 0 && recoveryByte !== 1 && recoveryByte !== 27 && recoveryByte !== 28) {
		throw new Error('Safe owner signature has an unsupported recovery byte.')
	}
	const normalizedRecoveryByte = recoveryByte < 27 ? recoveryByte + 27 : recoveryByte
	return ensureHex(`${ hex.slice(0, -2) }${ normalizedRecoveryByte.toString(16).padStart(2, '0') }`, 'Normalized Safe owner signature')
}

export async function recoverSafeSignatureOwner(safeTxHash: bigint, signature: string) {
	const normalized = normalizeSafeSignature(signature)
	const compact = normalized.slice(2, -2)
	const recovery = Number.parseInt(normalized.slice(-2), 16) - 27
	const publicKey = secp256k1.Signature
		.fromCompact(compact)
		.addRecoveryBit(recovery)
		.recoverPublicKey(bytesFromHex(bytes32String(safeTxHash)))
	return BigInt(addr.fromPublicKey(publicKey.toRawBytes(false)))
}

export function assertUniqueSafeTransactionStacks(stacks: readonly SafeTransactionStack[]) {
	const keys = stacks.map((stack) => `${ stack.chainId.toString() }:${ addressString(stack.safeAddress) }`)
	if (new Set(keys).size !== keys.length) throw new Error('The Safe stack export contains duplicate entries for the same Safe and chain.')
}

export function assertInterceptorSafeTransactionPolicy(safeTx: SafeTx) {
	if (safeTx.message.operation !== 0n) {
		throw new Error('Interceptor Safe stacks support CALL operations only. DELEGATECALL transactions cannot be signed.')
	}
	if (
		safeTx.message.safeTxGas !== 0n
		|| safeTx.message.baseGas !== 0n
		|| safeTx.message.gasPrice !== 0n
		|| safeTx.message.gasToken !== 0n
		|| safeTx.message.refundReceiver !== 0n
	) {
		throw new Error('Interceptor Safe stacks require zero gas reimbursement fields.')
	}
}
