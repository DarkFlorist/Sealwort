import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { getStackAccountCompatibility, inspectConnectedAccount } from '../src/app/accountInspection.js'
import { bytesToHex, encodeSafeReadCall } from '../src/app/ethereum.js'
import type { InjectedProvider } from '../src/app/provider.js'
import type { VerifiedSafeState } from '../src/app/safeStackValidation.js'
import { formatTokenBalance, getPreferredNativeAssetBalance, readConnectedSafeBalances } from '../src/app/accountBalances.js'
import { SAFE_1_4_1_PROXY_RUNTIME, SAFE_1_4_1_SINGLETON_RUNTIME, SAFE_1_4_1_SINGLETON_STORAGE } from './safeDeploymentFixtures.js'

const safeAddress = 0x1234n
const otherSafeAddress = 0x2345n
const ownerAddress = 0x5678n

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

const safeState: VerifiedSafeState = {
	version: '1.4.1',
	nonce: 3n,
	owners: [ownerAddress],
	threshold: 2n,
}

function createSafeProvider(): InjectedProvider {
	const selectors = {
		version: encodeSafeReadCall('VERSION'),
		nonce: encodeSafeReadCall('nonce'),
		owners: encodeSafeReadCall('getOwners'),
		threshold: encodeSafeReadCall('getThreshold'),
	}
	return {
		async request(request) {
			if (request.method === 'eth_getCode') {
				if (request.params?.[0] === '0x0000000000000000000000000000000000001234') return SAFE_1_4_1_PROXY_RUNTIME
				if (request.params?.[0] === '0x41675c099f32341bf84bfc5382af534df5c7461a') return SAFE_1_4_1_SINGLETON_RUNTIME
				return '0x'
			}
			if (request.method === 'eth_getStorageAt') return SAFE_1_4_1_SINGLETON_STORAGE
			if (request.method === 'eth_getBalance') return '0x1bc16d674ec80000'
			if (request.method !== 'eth_call') throw new Error(`Unexpected method ${ request.method }`)
			const call = request.params?.[0]
			if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string') {
				throw new Error('Malformed eth_call')
			}
			switch (call.data) {
				case '0x70a082310000000000000000000000000000000000000000000000000000000000001234': return bytesToHex(uintWord(12_345_678n))
				case selectors.version: return encodeStringResult(safeState.version)
				case selectors.nonce: return bytesToHex(uintWord(safeState.nonce))
				case selectors.owners: return bytesToHex(concat(uintWord(32n), uintWord(1n), uintWord(ownerAddress)))
				case selectors.threshold: return bytesToHex(uintWord(safeState.threshold))
				default: throw new Error('Unexpected Safe selector')
			}
		},
	}
}

const matchingStack = {
	chainId: 1n,
	safeAddress,
	safeVersion: '1.4.1',
	baseNonce: 3n,
	threshold: 2n,
	transactions: [{ safeTx: { message: { nonce: 3n } } }],
}

describe('connected account inspection', () => {
	test('identifies an EOA without attempting Safe calls', async () => {
		const requestedMethods: string[] = []
		const accountInformation = await inspectConnectedAccount({
			async request(request) {
				requestedMethods.push(request.method)
				return '0x'
			},
		}, ownerAddress, 1n)

		assert.deepEqual(accountInformation, { address: ownerAddress, chainId: 1n, kind: 'eoa' })
		assert.deepEqual(requestedMethods, ['eth_getCode'])
	})

	test('identifies a Safe and reads its current details', async () => {
		const accountInformation = await inspectConnectedAccount(createSafeProvider(), safeAddress, 1n)

		assert.deepEqual(accountInformation, {
			address: safeAddress,
			chainId: 1n,
			kind: 'safe',
			state: safeState,
		})
	})

	test('keeps individual Safe balance failures local to the affected asset', async () => {
		const provider = createSafeProvider()
		const balances = await readConnectedSafeBalances({
			async request(request) {
				if (request.method === 'eth_getBalance') throw new Error('ETH unavailable')
				return await provider.request(request)
			},
		}, safeAddress, 1n)

		assert.deepEqual(balances, {
			native: {
				symbol: 'ETH',
				balance: { status: 'unavailable', error: 'ETH unavailable' },
			},
			usdc: {
				symbol: 'USDC',
				balance: { status: 'available', value: 12_345_678n },
			},
		})
	})

	test('formats ETH and USDC balances without losing bigint precision', () => {
		assert.equal(formatTokenBalance(2_000_000_000_000_000_000n, 18), '2')
		assert.equal(formatTokenBalance(12_345_678n, 6), '12.345678')
		assert.equal(formatTokenBalance(1n, 18), '<0.000001')
		assert.equal(formatTokenBalance(0n, 6), '0')
	})

	test('prefers any available matching native balance over an unavailable duplicate read', () => {
		const unavailable = { symbol: 'SepoliaETH', balance: { status: 'unavailable', error: 'Temporary provider failure' } } as const
		const available = { symbol: 'SepoliaETH', balance: { status: 'available', value: 1_000_000_000_000_000_000n } } as const

		assert.equal(getPreferredNativeAssetBalance(unavailable, available), available)
		assert.equal(getPreferredNativeAssetBalance(available, unavailable), available)
		assert.equal(getPreferredNativeAssetBalance(unavailable, undefined), unavailable)
	})

	test('reads SepoliaETH and SepoliaUSDC balances using the Sepolia USDC contract', async () => {
		const requestedUsdcAddresses: string[] = []
		const balances = await readConnectedSafeBalances({
			async request(request) {
				if (request.method === 'eth_getBalance') return '0xde0b6b3a7640000'
				if (request.method !== 'eth_call') throw new Error(`Unexpected method ${ request.method }`)
				const call = request.params?.[0]
				if (typeof call !== 'object' || call === null || !('to' in call) || typeof call.to !== 'string') {
					throw new Error('Malformed eth_call')
				}
				requestedUsdcAddresses.push(call.to)
				return bytesToHex(uintWord(2_500_000n))
			},
		}, safeAddress, 11155111n)

		assert.deepEqual(balances, {
			native: {
				symbol: 'SepoliaETH',
				balance: { status: 'available', value: 1_000_000_000_000_000_000n },
			},
			usdc: {
				symbol: 'SepoliaUSDC',
				balance: { status: 'available', value: 2_500_000n },
			},
		})
		assert.deepEqual(requestedUsdcAddresses, ['0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'])
	})

	test('shows only an ETH-labelled native balance on an unrecognized chain', async () => {
		const requestedMethods: string[] = []
		const balances = await readConnectedSafeBalances({
			async request(request) {
				requestedMethods.push(request.method)
				if (request.method === 'eth_getBalance') return '0x2a'
				throw new Error('Unknown-chain token balances should not be requested')
			},
		}, safeAddress, 100n)

		assert.deepEqual(balances, {
			native: {
				symbol: 'ETH',
				balance: { status: 'available', value: 42n },
			},
		})
		assert.deepEqual(requestedMethods, ['eth_getBalance'])
	})

	test('keeps account-inspection failures local to the account panel', async () => {
		const accountInformation = await inspectConnectedAccount({
			async request() {
				throw new Error('Provider unavailable')
			},
		}, ownerAddress, 1n)

		assert.deepEqual(accountInformation, {
			address: ownerAddress,
			chainId: 1n,
			kind: 'unavailable',
			inspectionError: 'Provider unavailable',
		})
	})

	test('distinguishes a non-Safe contract from an unavailable provider', async () => {
		const accountInformation = await inspectConnectedAccount({
			async request(request) {
				if (request.method === 'eth_getCode') return '0x6000'
				return '0x'
			},
		}, otherSafeAddress, 1n)

		assert.equal(accountInformation.kind, 'contract')
		if (accountInformation.kind !== 'contract') throw new Error('Expected contract account information')
		assert.match(accountInformation.safeReadError, /VERSION\(\) did not return a complete ABI-encoded string/u)
	})

	test('compares an imported stack with a connected Safe', () => {
		const connectedSafe = { address: safeAddress, chainId: 1n, kind: 'safe', state: safeState } as const

		assert.deepEqual(getStackAccountCompatibility(connectedSafe, matchingStack, safeState), {
			status: 'match',
			message: 'This stack matches the Gnosis Safe exposed by the connected wallet.',
		})
		assert.match(
			getStackAccountCompatibility(connectedSafe, { ...matchingStack, safeAddress: otherSafeAddress }, safeState)?.message ?? '',
			/connected wallet exposes Gnosis Safe/u,
		)
		assert.match(
			getStackAccountCompatibility(connectedSafe, {
				...matchingStack,
				baseNonce: 4n,
				transactions: [{ safeTx: { message: { nonce: 4n } } }],
			}, safeState)?.message ?? '',
			/no pending transaction at current nonce 3/u,
		)
	})

	test('accepts a connected Safe whose executed stack prefix precedes its current nonce', () => {
		const connectedSafe = { address: safeAddress, chainId: 1n, kind: 'safe', state: safeState } as const
		const progressedStack = {
			...matchingStack,
			baseNonce: 2n,
			transactions: [
				{ safeTx: { message: { nonce: 2n } } },
				{ safeTx: { message: { nonce: 3n } } },
			],
		}

		assert.deepEqual(getStackAccountCompatibility(connectedSafe, progressedStack, safeState), {
			status: 'match',
			message: 'This stack matches the Gnosis Safe exposed by the connected wallet.',
		})
		assert.match(
			getStackAccountCompatibility(connectedSafe, {
				...progressedStack,
				transactions: progressedStack.transactions.slice(0, 1),
			}, safeState)?.message ?? '',
			/no pending transaction at current nonce 3/u,
		)
	})

	test('compares a connected EOA with the imported Safe owners', () => {
		const connectedEoa = { address: ownerAddress, chainId: 1n, kind: 'eoa' } as const

		assert.deepEqual(getStackAccountCompatibility(connectedEoa, matchingStack, safeState), {
			status: 'match',
			message: 'The connected EOA is a current owner of this Gnosis Safe.',
		})
		assert.deepEqual(getStackAccountCompatibility(
			{ ...connectedEoa, address: 0x9999n },
			matchingStack,
			safeState,
		), {
			status: 'mismatch',
			message: 'The connected EOA is not a current owner of the Gnosis Safe in this stack.',
		})
	})
})
