import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { createContract } from 'micro-eth-signer/advanced/abi.js'
import { addressString, bytesFromHex, bytesToHex, ensureHex } from '../src/app/ethereum.js'
import { createSafeTx } from '../src/app/safeProtocol.js'
import { encodeSafeExecutionCall, readSafeExecutionGasFunding, readSafeExecutionReceipt, submitSafeExecution } from '../src/app/safeExecution.js'
import type { ProviderRequest } from '../src/app/safeStackValidation.js'

const SAFE_EXECUTION_ABI = [{
	type: 'function',
	name: 'execTransaction',
	inputs: [
		{ name: 'to', type: 'address' },
		{ name: 'value', type: 'uint256' },
		{ name: 'data', type: 'bytes' },
		{ name: 'operation', type: 'uint8' },
		{ name: 'safeTxGas', type: 'uint256' },
		{ name: 'baseGas', type: 'uint256' },
		{ name: 'gasPrice', type: 'uint256' },
		{ name: 'gasToken', type: 'address' },
		{ name: 'refundReceiver', type: 'address' },
		{ name: 'signatures', type: 'bytes' },
	],
	outputs: [{ name: 'success', type: 'bool' }],
	stateMutability: 'payable',
}] as const

const SafeExecutionContract = createContract(SAFE_EXECUTION_ABI)
const safeAddress = 0x6d6054f7745a3aaf4d1e4ac5830e4abdc328ab6bn
const safeTx = createSafeTx(1n, safeAddress, {
	to: 0x1111111111111111111111111111111111111111n,
	value: 12n,
	input: Uint8Array.from([0xab, 0xcd]),
}, 7n)

const signatureFor = (byte: string, recoveryByte: '1b' | '1c') => `0x${ byte.repeat(64) }${ recoveryByte }`

describe('Safe execution', () => {
	test('reserves enough signer balance for the EIP-1559 maximum execution fee', async () => {
		const requests: ProviderRequest[] = []
		const executorAddress = 3n
		const safeTransaction = {
			safeTx,
			signatures: [{ signer: 1n, signature: signatureFor('11', '1b') }],
		}
		const funding = await readSafeExecutionGasFunding({
			async request(request) {
				requests.push(request)
				switch (request.method) {
					case 'eth_getBalance': return '0x3d0900'
					case 'eth_estimateGas': return '0x5208'
					case 'eth_gasPrice': return '0x6e'
					case 'eth_getBlockByNumber': return { baseFeePerGas: '0x64' }
					case 'eth_maxPriorityFeePerGas': return '0xa'
					default: throw new Error(`Unexpected method ${ request.method }`)
				}
			},
		}, executorAddress, safeAddress, safeTransaction)

		assert.deepEqual(funding, {
			balance: 4_000_000n,
			estimatedGas: 21_000n,
			maxFeePerGas: 210n,
			requiredBalance: 4_410_000n,
		})
		const estimateRequest = requests.find(({ method }) => method === 'eth_estimateGas')
		assert.deepEqual(estimateRequest?.params?.[0], {
			from: addressString(executorAddress),
			to: addressString(safeAddress),
			data: encodeSafeExecutionCall(safeTransaction.safeTx, safeTransaction.signatures),
		})
	})

	test('uses the legacy gas price when the latest block has no base fee', async () => {
		const funding = await readSafeExecutionGasFunding({
			async request(request) {
				switch (request.method) {
					case 'eth_getBalance': return '0x1e8480'
					case 'eth_estimateGas': return '0x5208'
					case 'eth_gasPrice': return '0x64'
					case 'eth_getBlockByNumber': return {}
					case 'eth_maxPriorityFeePerGas': throw new Error('Unsupported method')
					default: throw new Error(`Unexpected method ${ request.method }`)
				}
			},
		}, 3n, safeAddress, {
			safeTx,
			signatures: [{ signer: 1n, signature: signatureFor('11', '1b') }],
		})

		assert.equal(funding.maxFeePerGas, 100n)
		assert.equal(funding.requiredBalance, 2_100_000n)
	})

	test('estimates a final connected-wallet signature as a Safe prevalidated owner signature', async () => {
		const requests: ProviderRequest[] = []
		const activeSigner = 3n
		await readSafeExecutionGasFunding({
			async request(request) {
				requests.push(request)
				switch (request.method) {
					case 'eth_getBalance': return '0x3d0900'
					case 'eth_estimateGas': return '0x5208'
					case 'eth_gasPrice': return '0x6e'
					case 'eth_getBlockByNumber': return { baseFeePerGas: '0x64' }
					case 'eth_maxPriorityFeePerGas': return '0xa'
					default: throw new Error(`Unexpected method ${ request.method }`)
				}
			},
		}, activeSigner, safeAddress, {
			safeTx,
			signatures: [{ signer: 1n, signature: signatureFor('11', '1b') }],
		}, activeSigner)

		const estimateRequest = requests.find(({ method }) => method === 'eth_estimateGas')
		assert.deepEqual(estimateRequest?.params?.[0], {
			from: addressString(activeSigner),
			to: addressString(safeAddress),
			data: encodeSafeExecutionCall(safeTx, [{ signer: 1n, signature: signatureFor('11', '1b') }], activeSigner),
		})
		const prevalidatedSignature = `${ activeSigner.toString(16).padStart(64, '0') }${ '0'.repeat(64) }01`
		assert.ok(JSON.stringify(estimateRequest?.params?.[0]).includes(prevalidatedSignature))
	})

	test('encodes execTransaction with owner signatures sorted by address', () => {
		const lowerOwnerSignature = signatureFor('11', '1b')
		const higherOwnerSignature = signatureFor('22', '1c')
		const call = encodeSafeExecutionCall(safeTx, [
			{ signer: 2n, signature: higherOwnerSignature },
			{ signer: 1n, signature: lowerOwnerSignature },
		])

		assert.equal(call.slice(0, 10), '0x6a761202')
		assert.ok(call.indexOf(lowerOwnerSignature.slice(2)) < call.indexOf(higherOwnerSignature.slice(2)))
		assert.ok(call.endsWith('00'.repeat(30)))
		assert.equal(call, bytesToHex(SafeExecutionContract.execTransaction.encodeInput({
			to: addressString(safeTx.message.to),
			value: safeTx.message.value,
			data: safeTx.message.data,
			operation: safeTx.message.operation,
			safeTxGas: safeTx.message.safeTxGas,
			baseGas: safeTx.message.baseGas,
			gasPrice: safeTx.message.gasPrice,
			gasToken: addressString(safeTx.message.gasToken),
			refundReceiver: addressString(safeTx.message.refundReceiver),
			signatures: bytesFromHex(ensureHex(`0x${ lowerOwnerSignature.slice(2) }${ higherOwnerSignature.slice(2) }`)),
		})))
	})

	test('submits the encoded execution call to the Safe from the connected EOA', async () => {
		const requests: ProviderRequest[] = []
		const transactionHash = `0x${ 'ab'.repeat(32) }`
		const result = await submitSafeExecution({
			async request(request) {
				requests.push(request)
				return transactionHash
			},
		}, 3n, safeAddress, {
			safeTx,
			signatures: [{ signer: 1n, signature: signatureFor('11', '1b') }],
		})

		assert.equal(result, transactionHash)
		assert.equal(requests.length, 1)
		assert.equal(requests[0]?.method, 'eth_sendTransaction')
		assert.deepEqual(requests[0]?.params?.[0], {
			from: '0x0000000000000000000000000000000000000003',
			to: '0x6d6054f7745a3aaf4d1e4ac5830e4abdc328ab6b',
			data: encodeSafeExecutionCall(safeTx, [{ signer: 1n, signature: signatureFor('11', '1b') }]),
		})
	})

	test('rejects an invalid transaction hash returned by the wallet', async () => {
		await assert.rejects(
			submitSafeExecution({ async request() { return '0x1234' } }, 3n, safeAddress, {
				safeTx,
				signatures: [{ signer: 1n, signature: signatureFor('11', '1b') }],
			}),
			/invalid execution transaction hash/u,
		)
	})

	test('reads whether a submitted execution transaction was included', async () => {
		const transactionHash = ensureHex(`0x${ 'ab'.repeat(32) }`, 'transaction hash')
		const receipt = await readSafeExecutionReceipt({
			async request(request) {
				assert.equal(request.method, 'eth_getTransactionReceipt')
				return { status: '0x1', blockNumber: '0x123' }
			},
		}, transactionHash)

		assert.deepEqual(receipt, { succeeded: true, blockNumber: 0x123n })
	})
})
