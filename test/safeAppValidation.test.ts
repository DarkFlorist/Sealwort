import * as assert from 'assert'
import { describe, test } from 'bun:test'
import { addr, signTyped } from 'micro-eth-signer'
import { createContract } from 'micro-eth-signer/advanced/abi.js'
import { ChainDiscoveryUnavailableError } from '../src/app/chainDiscoveryError.js'
import { bytesToHex, decodeSafeVersion, encodeSafeReadCall } from '../src/app/ethereum.js'
import type { InjectedProvider } from '../src/app/provider.js'
import { createSafeTx, encodeSafeTransactionHashCall, getSafeTxHash, safeTxToTypedData } from '../src/app/safeProtocol.js'
import { SAFE_STACK_FORMAT_VERSION, SafeStackExport } from '../src/app/safeStackProtocol.js'
import { assertReturnedSafeOwner, getFreshSigningAccount, getSafeSigningAccountMode, hasSafeSignatureFromCurrentRoute, parseSafeStackText, validateSafeStackAgainstProvider, validateSafeStackAtCurrentNonce } from '../src/app/safeStackValidation.js'
import { WalletRequestTimeoutError } from '../src/app/walletProvider.js'
import { SAFE_1_4_1_PROXY_RUNTIME, SAFE_1_4_1_SINGLETON_RUNTIME, SAFE_1_4_1_SINGLETON_STORAGE } from './safeDeploymentFixtures.js'

const ownerPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const otherOwnerPrivateKey = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const ownerAddress = addr.fromPrivateKey(ownerPrivateKey)
const otherOwnerAddress = addr.fromPrivateKey(otherOwnerPrivateKey)
const safeAddress = 0x1234n
const safeTx = createSafeTx(1n, safeAddress, {
	to: 0x5678n,
	value: 0n,
	input: new Uint8Array(),
}, 3n)
const safeHashContract = createContract([{
	type: 'function',
	name: 'getTransactionHash',
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
		{ name: 'nonce', type: 'uint256' },
	],
	outputs: [{ name: '', type: 'bytes32' }],
}] as const)

async function createStackExport(withSignature: boolean): Promise<SafeStackExport> {
	const safeTxHash = BigInt(getSafeTxHash(safeTx))
	const signature = withSignature
		? [{
			signer: BigInt(ownerAddress),
			signature: signTyped(safeTxToTypedData(safeTx), ownerPrivateKey),
		}]
		: []
	return {
		name: 'Interceptor Safe Stack',
		version: SAFE_STACK_FORMAT_VERSION,
		stacks: [{
			chainId: 1n,
			safeAddress,
			safeVersion: '1.4.1',
			baseNonce: 3n,
			threshold: 2n,
			transactions: [{
				safeTx,
				safeTxHash,
				created: new Date('2026-01-01T00:00:00.000Z'),
				websiteOrigin: 'https://example.test',
				transactionIdentifier: 1n,
				signatures: signature,
			}],
		}],
	}
}

function uintWord(value: bigint) {
	const bytes = new Uint8Array(32)
	for (let index = 31; index >= 0; index -= 1) {
		bytes[index] = Number(value & 0xffn)
		value >>= 8n
	}
	return bytes
}

const concat = (...values: readonly Uint8Array[]) => {
	const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0))
	let offset = 0
	for (const value of values) {
		result.set(value, offset)
		offset += value.length
	}
	return result
}

function encodeStringResult(value: string) {
	const content = new TextEncoder().encode(value)
	const padded = new Uint8Array(Math.ceil(content.length / 32) * 32)
	padded.set(content)
	return bytesToHex(concat(uintWord(32n), uintWord(BigInt(content.length)), padded))
}

const encodeUintResult = (value: bigint) => bytesToHex(uintWord(value))

function encodeOwnersResult(owners: readonly bigint[]) {
	return bytesToHex(concat(uintWord(32n), uintWord(BigInt(owners.length)), ...owners.map(uintWord)))
}

function createProvider(state: {
	readonly version?: string
	readonly nonce?: bigint
	readonly owners?: readonly bigint[]
	readonly threshold?: bigint
	readonly ownerCode?: string
	readonly safeCode?: string
	readonly singletonStorage?: string
	readonly singletonCode?: string
	readonly accounts?: readonly string[]
	readonly blockNumber?: string
	readonly transactionHashes?: readonly bigint[]
	readonly observedBlockTags?: unknown[]
}): InjectedProvider {
	const selectors = {
		version: encodeSafeReadCall('VERSION'),
		nonce: encodeSafeReadCall('nonce'),
		owners: encodeSafeReadCall('getOwners'),
		threshold: encodeSafeReadCall('getThreshold'),
		transactionHash: encodeSafeTransactionHashCall(safeTx).slice(0, 10),
	}
	let transactionHashIndex = 0
	return {
		async request(request) {
			if (request.method === 'eth_chainId') return '0x1'
			if (request.method === 'eth_blockNumber') return state.blockNumber ?? '0x123'
			if (request.method === 'eth_getStorageAt') {
				state.observedBlockTags?.push(request.params?.[2])
				return state.singletonStorage ?? SAFE_1_4_1_SINGLETON_STORAGE
			}
			if (request.method === 'eth_getCode') {
				state.observedBlockTags?.push(request.params?.[1])
				const requestedAddress = request.params?.[0]
				if (requestedAddress === '0x0000000000000000000000000000000000001234') return state.safeCode ?? SAFE_1_4_1_PROXY_RUNTIME
				if (requestedAddress === '0x41675c099f32341bf84bfc5382af534df5c7461a') return state.singletonCode ?? SAFE_1_4_1_SINGLETON_RUNTIME
				return state.ownerCode ?? '0x'
			}
			if (request.method === 'eth_accounts') return state.accounts ?? [ownerAddress]
			if (request.method !== 'eth_call') throw new Error(`Unexpected provider method: ${ request.method }`)
			state.observedBlockTags?.push(request.params?.[1])
			const call = request.params?.[0]
			if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string') {
				throw new Error('Malformed test eth_call')
			}
			switch (call.data.slice(0, 10)) {
				case selectors.version: return encodeStringResult(state.version ?? '1.4.1')
				case selectors.nonce: return encodeUintResult(state.nonce ?? 3n)
				case selectors.owners: return encodeOwnersResult(state.owners ?? [BigInt(ownerAddress)])
				case selectors.threshold: return encodeUintResult(state.threshold ?? 2n)
				case selectors.transactionHash: {
					const transactionHash = state.transactionHashes?.[transactionHashIndex] ?? BigInt(getSafeTxHash(safeTx))
					transactionHashIndex += 1
					return encodeUintResult(transactionHash)
				}
				default: throw new Error('Unexpected Safe call')
			}
		},
	}
}

describe('Safe co-signer app provider validation', () => {
	test('describes incomplete VERSION data without implying Sealwort truncated it', () => {
		assert.throws(
			() => decodeSafeVersion('0x'),
			/Safe VERSION\(\) did not return a complete ABI-encoded string/u,
		)
	})

	test('reports malformed JSON and wrong export schemas without exposing runtime type internals', () => {
		assert.throws(() => parseSafeStackText('{'), /not valid JSON/u)
		assert.throws(() => parseSafeStackText('{}'), /^Error: This is not a valid Interceptor Gnosis Safe Stack export\.$/u)
		assert.throws(
			() => parseSafeStackText(JSON.stringify({ name: 'Interceptor Safe Stack', version: '2.0.0', stacks: [] })),
			/Gnosis Safe Stack format version 2.0.0 is not supported. Supported versions: 1.0.0/u,
		)
	})

	test('keeps Safe Stack 1.0.0 hashing and serialization stable', async () => {
		const stackExport = await createStackExport(false)
		const transaction = stackExport.stacks[0]?.transactions[0]
		if (transaction === undefined) throw new Error('Missing test Safe transaction')

		assert.equal(
			getSafeTxHash(transaction.safeTx),
			'0x562418427618ff7fdd8817f2b4ebc7531623d418cb485012b8c5e02f56765c0a',
		)
		const serializedExport = SafeStackExport.serialize(stackExport)
		const wireExport = SafeStackExport.parse(serializedExport)
		assert.deepEqual(wireExport, stackExport)
		assert.equal(wireExport.version, SAFE_STACK_FORMAT_VERSION)
	})

	test('parses and reproduces an unmodified Interceptor Safe Stack wire fixture', async () => {
		const fixtureText = await Bun.file(new URL('./fixtures/interceptor-safe-stack.json', import.meta.url)).text()
		const fixtureWire: unknown = JSON.parse(fixtureText)
		const parsed = parseSafeStackText(fixtureText)
		const transaction = parsed.stacks[0]?.transactions[0]
		if (transaction === undefined) throw new Error('The Interceptor fixture is missing its Safe transaction.')

		assert.equal(parsed.stacks[0]?.safeAddress, 0x1234567890123456789012345678901234567890n)
		assert.equal(transaction.safeTxHash, 0xfad24652122e73522ccfff8d1b88206cc396dcc83cf7a9b438b8113cf144d028n)
		assert.equal(BigInt(getSafeTxHash(transaction.safeTx)), transaction.safeTxHash)
		assert.deepEqual(SafeStackExport.serialize(parsed), fixtureWire)
	})

	test('encodes getTransactionHash with the standard Gnosis Safe ABI', () => {
		const expectedCall = bytesToHex(safeHashContract.getTransactionHash.encodeInput({
			to: '0x0000000000000000000000000000000000005678',
			value: 0n,
			data: new Uint8Array(),
			operation: 0n,
			safeTxGas: 0n,
			baseGas: 0n,
			gasPrice: 0n,
			gasToken: '0x0000000000000000000000000000000000000000',
			refundReceiver: '0x0000000000000000000000000000000000000000',
			nonce: 3n,
		}))

		assert.equal(encodeSafeTransactionHashCall(safeTx), expectedCall)
	})

	test('accepts a stack only when its recorded Safe state matches the current chain', async () => {
		const stackExport = await createStackExport(true)

		const states = await validateSafeStackAgainstProvider(createProvider({}), stackExport)

		assert.equal(states.length, 1)
		assert.equal(states[0]?.nonce, 3n)
		assert.equal(states[0]?.threshold, 2n)
	})

	test('translates chain discovery timeouts at the validation boundary', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAtCurrentNonce({
				async request() { throw new WalletRequestTimeoutError('eth_chainId') },
			}, stackExport),
			(error) => error instanceof ChainDiscoveryUnavailableError && error.context === 'stack-verification',
		)
	})

	test('rejects contracts that mimic the Safe interface without an official proxy runtime', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ safeCode: '0x6000' }), stackExport),
			/supported official Gnosis Safe proxy runtime/u,
		)
	})

	test('rejects official Safe proxies that point to an unrecognized singleton', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ singletonStorage: encodeUintResult(1n) }), stackExport),
			/unrecognized 1\.4\.1 singleton implementation/u,
		)
	})

	test('rejects a recognized singleton address containing unexpected runtime code', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ singletonCode: '0x6000' }), stackExport),
			/Gnosis Safe singleton does not contain the expected official runtime code/u,
		)
	})

	test('rejects stacks without transactions before reading the provider', async () => {
		const stackExport = await createStackExport(false)
		const emptyStack = {
			...stackExport,
			stacks: stackExport.stacks.map((stack) => ({ ...stack, transactions: [] })),
		}

		await assert.rejects(validateSafeStackAgainstProvider({
			async request() { throw new Error('Provider should not be called') },
		}, emptyStack), /does not contain any transactions/u)
	})

	test('rejects a stack whose nonce no longer matches the on-chain Safe nonce', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ nonce: 4n }), stackExport),
			/The Gnosis Safe nonce is now 4; this stack starts at 3/u,
		)
	})

	test('accepts the next contiguous transaction after an earlier stack nonce executes', async () => {
		const stackExport = await createStackExport(false)
		const stack = stackExport.stacks[0]
		const firstTransaction = stack?.transactions[0]
		if (stack === undefined || firstTransaction === undefined) throw new Error('Missing test Safe transaction')
		const nextSafeTx = createSafeTx(1n, safeAddress, {
			to: 0x9abcn,
			value: 0n,
			input: new Uint8Array(),
		}, 4n)
		const progressedStack = {
			...stackExport,
			stacks: [{
				...stack,
				transactions: [firstTransaction, {
					...firstTransaction,
					safeTx: nextSafeTx,
					safeTxHash: BigInt(getSafeTxHash(nextSafeTx)),
					transactionIdentifier: 2n,
				}],
			}],
		}

		const transactionHashes = [firstTransaction.safeTxHash, BigInt(getSafeTxHash(nextSafeTx))]
		const states = await validateSafeStackAtCurrentNonce(createProvider({ nonce: 4n, transactionHashes }), progressedStack)

		assert.equal(states[0]?.nonce, 4n)
		await assert.rejects(
			validateSafeStackAtCurrentNonce(createProvider({ nonce: 5n, transactionHashes }), progressedStack),
			/This stack is stale: the Gnosis Safe has advanced to nonce 5, but the stack only contains nonces 3 through 4/u,
		)
	})

	test('does not require historical executed-prefix signatures to belong to current owners', async () => {
		const stackExport = await createStackExport(true)
		const stack = stackExport.stacks[0]
		const firstTransaction = stack?.transactions[0]
		if (stack === undefined || firstTransaction === undefined) throw new Error('Missing test Safe transaction')
		const nextSafeTx = createSafeTx(1n, safeAddress, {
			to: 0x9abcn,
			value: 0n,
			input: new Uint8Array(),
		}, 4n)
		const nextTransaction = {
			...firstTransaction,
			safeTx: nextSafeTx,
			safeTxHash: BigInt(getSafeTxHash(nextSafeTx)),
			transactionIdentifier: 2n,
			signatures: [],
		}
		const progressedStack = {
			...stackExport,
			stacks: [{ ...stack, transactions: [firstTransaction, nextTransaction] }],
		}

		const states = await validateSafeStackAtCurrentNonce(createProvider({
			nonce: 4n,
			owners: [BigInt(otherOwnerAddress), 0x9876n],
			transactionHashes: [firstTransaction.safeTxHash, nextTransaction.safeTxHash],
		}), progressedStack)

		assert.equal(states[0]?.nonce, 4n)
	})

	test('pins Safe state, transaction hash, and owner-code reads to one block', async () => {
		const stackExport = await createStackExport(true)
		const observedBlockTags: unknown[] = []

		await validateSafeStackAgainstProvider(createProvider({ blockNumber: '0xabc', observedBlockTags }), stackExport)

		assert.equal(observedBlockTags.length > 0, true)
		assert.deepEqual(new Set(observedBlockTags), new Set(['0xabc']))
	})

	test('rejects a transaction hash that does not match the Gnosis Safe contract', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ transactionHashes: [1n] }), stackExport),
			/Gnosis Safe contract returned a different transaction hash/u,
		)
	})

	test('reports an undeployed Safe address instead of an ABI truncation error', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ safeCode: '0x' }), stackExport),
			/No Gnosis Safe contract is deployed at 0x0000000000000000000000000000000000001234 on chain 1/u,
		)
	})

	test('rejects a valid signature from an address that is no longer a Safe owner', async () => {
		const stackExport = await createStackExport(true)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ owners: [BigInt(otherOwnerAddress)] }), stackExport),
			/signed this stack but is not a current Gnosis Safe owner/u,
		)
	})

	test('rejects changed Safe versions and thresholds before signing or export', async () => {
		const stackExport = await createStackExport(false)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ version: '1.4.0' }), stackExport),
			/Gnosis Safe version 1.4.0 is not supported/u,
		)
		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ threshold: 3n }), stackExport),
			/The Gnosis Safe threshold is now 3, but this stack records 2/u,
		)
	})

	test('rejects imported signatures attributed to current contract owners', async () => {
		const stackExport = await createStackExport(true)

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({ ownerCode: '0x6000' }), stackExport),
			/supports EOA owners only/u,
		)
	})

	test('rejects duplicate top-level stacks for the same Safe and chain', async () => {
		const stackExport = await createStackExport(false)
		const stack = stackExport.stacks[0]
		if (stack === undefined) throw new Error('Missing test Safe stack')

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({}), {
				...stackExport,
				stacks: [stack, stack],
			}),
			/duplicate entries for the same Safe and chain/u,
		)
	})

	test('rejects imported delegatecall transactions even when their hashes match', async () => {
		const stackExport = await createStackExport(false)
		const stack = stackExport.stacks[0]
		const transaction = stack?.transactions[0]
		if (stack === undefined || transaction === undefined) throw new Error('Missing test Safe transaction')
		const delegateCallSafeTx = {
			...transaction.safeTx,
			message: { ...transaction.safeTx.message, operation: 1n },
		}

		await assert.rejects(
			validateSafeStackAgainstProvider(createProvider({}), {
				...stackExport,
				stacks: [{
					...stack,
					transactions: [{
						...transaction,
						safeTx: delegateCallSafeTx,
						safeTxHash: BigInt(getSafeTxHash(delegateCallSafeTx)),
					}],
				}],
			}),
			/CALL operations only/u,
		)
	})

	test('re-reads and rejects a changed wallet account immediately before signing', async () => {
		await assert.rejects(
			getFreshSigningAccount(createProvider({ accounts: [otherOwnerAddress] }), BigInt(ownerAddress)),
			/active wallet account changed/u,
		)
		assert.equal(
			await getFreshSigningAccount(createProvider({ accounts: [ownerAddress] }), BigInt(ownerAddress)),
			BigInt(ownerAddress),
		)
	})

	test('accepts a connected Safe wallet when its returned signature belongs to a current owner', () => {
		const owner = BigInt(ownerAddress)
		const mode = getSafeSigningAccountMode(safeAddress, [owner], safeAddress)

		assert.equal(mode, 'connected-safe-wallet')
		assert.doesNotThrow(() => assertReturnedSafeOwner(mode, [owner], safeAddress, owner))
		assert.throws(
			() => assertReturnedSafeOwner(mode, [owner], safeAddress, BigInt(otherOwnerAddress)),
			/not created by a current owner/u,
		)
	})

	test('recognizes a signature from the EOA recovered behind a connected Safe wallet', () => {
		const routedOwner = BigInt(ownerAddress)

		assert.equal(hasSafeSignatureFromCurrentRoute([routedOwner], safeAddress, routedOwner), true)
		assert.equal(hasSafeSignatureFromCurrentRoute([routedOwner], safeAddress, undefined), false)
	})
})
