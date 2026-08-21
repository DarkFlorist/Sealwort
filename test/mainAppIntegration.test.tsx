import * as assert from 'node:assert'
import { afterEach, describe, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { addr, signTyped } from 'micro-eth-signer'
import { App } from '../src/app/main.js'
import { bytesToHex, checksummedAddress, encodeSafeReadCall } from '../src/app/ethereum.js'
import { createSafeTx, encodeSafeTransactionHashCall, getSafeTxHash, safeTxToTypedData } from '../src/app/safeProtocol.js'
import { SAFE_STACK_FORMAT_VERSION, SafeStackExport, type SafeStackTransaction } from '../src/app/safeStackProtocol.js'
import type { InjectedProvider } from '../src/app/safeStackValidation.js'
import { PERSISTED_SAFE_STACK_STORAGE_KEY, SAFE_STACK_PERSISTENCE_WARNING } from '../src/app/uiState.js'
import { getWalletRequestTimeoutMessage } from '../src/app/walletProvider.js'
import { SAFE_1_4_1_PROXY_RUNTIME, SAFE_1_4_1_SINGLETON_RUNTIME, SAFE_1_4_1_SINGLETON_STORAGE } from './safeDeploymentFixtures.js'

const ownerPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const otherOwnerPrivateKey = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const ownerAddress = BigInt(addr.fromPrivateKey(ownerPrivateKey))
const otherOwnerAddress = BigInt(addr.fromPrivateKey(otherOwnerPrivateKey))
const nonOwnerAddress = 0x9876n
const safeAddress = 0x1234n
const safeTx = createSafeTx(1n, safeAddress, { to: 0x5678n, value: 0n, input: new Uint8Array() }, 3n)
const safeTxHash = BigInt(getSafeTxHash(safeTx))

function uintWord(value: bigint) {
	const bytes = new Uint8Array(32)
	for (let index = 31; index >= 0; index -= 1) {
		bytes[index] = Number(value & 0xffn)
		value >>= 8n
	}
	return bytes
}

function concat(...values: readonly Uint8Array[]) {
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

function createStack(
	threshold = 2n,
	signatures: SafeStackTransaction['signatures'] = [],
) {
	const transaction: SafeStackTransaction = {
		safeTx,
		safeTxHash,
		created: new Date('2026-01-01T00:00:00.000Z'),
		websiteOrigin: 'https://example.test',
		transactionIdentifier: 1n,
		signatures,
	}
	return {
		name: 'Interceptor Safe Stack',
		version: SAFE_STACK_FORMAT_VERSION,
		stacks: [{
			chainId: 1n,
			safeAddress,
			safeVersion: '1.4.1',
			baseNonce: 3n,
			threshold,
			transactions: [transaction],
		}],
	} as const
}

type ProviderHarness = {
	readonly provider: InjectedProvider
	readonly requestedMethods: readonly string[]
	setAccounts(accounts: readonly string[]): void
	failNextWalletIdentityRequest(): void
	emitAccountsChanged(): void
}

function createProviderHarness(options: {
	readonly rejectFirstSignature?: boolean
	readonly rejectFirstExecution?: boolean
	readonly nativeBalanceResult?: Promise<string>
	readonly accounts?: readonly string[]
	readonly activeSafeSigner?: bigint
	readonly walletCapabilitiesResult?: Promise<unknown>
	readonly threshold?: bigint
	readonly hangingMethod?: string
	readonly hangingMethodRequestCount?: number
	readonly hangingMethodStartAtRequest?: number
	readonly executionReceiptResult?: Promise<unknown> | unknown
} = {}): ProviderHarness {
	let accounts = [...(options.accounts ?? [addr.addChecksum(`0x${ ownerAddress.toString(16).padStart(40, '0') }`)])]
	let signatureRequests = 0
	let executionRequests = 0
	let failNextWalletIdentityRequest = false
	let hangingMethodRequestsRemaining = options.hangingMethodRequestCount ?? Number.POSITIVE_INFINITY
	let matchingHangingMethodRequests = 0
	const requestedMethods: string[] = []
	const accountListeners = new Set<(value: unknown) => void>()
	const selectors = {
		version: encodeSafeReadCall('VERSION'),
		nonce: encodeSafeReadCall('nonce'),
		owners: encodeSafeReadCall('getOwners'),
		threshold: encodeSafeReadCall('getThreshold'),
		transactionHash: encodeSafeTransactionHashCall(safeTx).slice(0, 10),
	}
	const provider: InjectedProvider = {
		on(eventName, listener) {
			if (eventName === 'accountsChanged') accountListeners.add(listener)
		},
		removeListener(eventName, listener) {
			if (eventName === 'accountsChanged') accountListeners.delete(listener)
		},
		async request(request) {
			requestedMethods.push(request.method)
			if (request.method === options.hangingMethod) {
				matchingHangingMethodRequests += 1
				if (matchingHangingMethodRequests >= (options.hangingMethodStartAtRequest ?? 1) && hangingMethodRequestsRemaining > 0) {
					hangingMethodRequestsRemaining -= 1
					return await new Promise<never>(() => undefined)
				}
			}
			switch (request.method) {
				case 'eth_accounts':
					if (failNextWalletIdentityRequest) {
						failNextWalletIdentityRequest = false
						throw new Error('Wallet identity unavailable')
					}
					return accounts
				case 'eth_requestAccounts': return accounts
				case 'eth_chainId': return '0x1'
				case 'eth_blockNumber': return '0x123'
				case 'wallet_getCapabilities': {
					if (options.walletCapabilitiesResult !== undefined) return await options.walletCapabilitiesResult
					if (options.activeSafeSigner === undefined) throw new Error('Unsupported method')
					return {
						'0x1': {
							gnosisSafeExecution: {
								supported: true,
								version: '1.0.0',
								activeSigner: `0x${ options.activeSafeSigner.toString(16).padStart(40, '0') }`,
								submissionMethod: 'eth_sendTransaction',
							},
						},
					}
				}
				case 'eth_getStorageAt': return SAFE_1_4_1_SINGLETON_STORAGE
				case 'eth_getBalance': return await (options.nativeBalanceResult ?? Promise.resolve('0xde0b6b3a7640000'))
				case 'eth_estimateGas': return '0x186a0'
				case 'eth_gasPrice': return '0x3b9aca00'
				case 'eth_maxPriorityFeePerGas': return '0x5f5e100'
				case 'eth_getBlockByNumber': return { baseFeePerGas: '0x3b9aca00' }
				case 'eth_sendTransaction':
					executionRequests += 1
					if (options.rejectFirstExecution === true && executionRequests === 1) throw new Error('The Interceptor failed to process the transaction')
					return '0x1111111111111111111111111111111111111111111111111111111111111111'
				case 'eth_getTransactionReceipt': return await Promise.resolve(options.executionReceiptResult ?? { status: '0x1', blockNumber: '0x124' })
				case 'eth_getCode': {
					if (request.params?.[0] === '0x0000000000000000000000000000000000001234') return SAFE_1_4_1_PROXY_RUNTIME
					if (request.params?.[0] === '0x41675c099f32341bf84bfc5382af534df5c7461a') return SAFE_1_4_1_SINGLETON_RUNTIME
					return '0x'
				}
				case 'eth_signTypedData_v4':
					signatureRequests += 1
					if (options.rejectFirstSignature === true && signatureRequests === 1) throw { code: 4001, message: 'User rejected the request.' }
					return signTyped(safeTxToTypedData(safeTx), ownerPrivateKey)
				case 'eth_call': {
					const call = request.params?.[0]
					if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string') throw new Error('Malformed eth_call')
					switch (call.data.slice(0, 10)) {
						case selectors.version: return encodeStringResult('1.4.1')
						case selectors.nonce: return bytesToHex(uintWord(3n))
						case selectors.owners: return bytesToHex(concat(uintWord(32n), uintWord(2n), uintWord(ownerAddress), uintWord(otherOwnerAddress)))
						case selectors.threshold: return bytesToHex(uintWord(options.threshold ?? 2n))
						case selectors.transactionHash: return bytesToHex(uintWord(safeTxHash))
						default:
							if (call.data.startsWith('0x70a08231')) return bytesToHex(uintWord(0n))
							throw new Error(`Unexpected eth_call selector ${ call.data.slice(0, 10) }`)
					}
				}
				default: throw new Error(`Unexpected provider method ${ request.method }`)
			}
		},
	}
	return {
		provider,
		requestedMethods,
		setAccounts(nextAccounts) { accounts = [...nextAccounts] },
		failNextWalletIdentityRequest() { failNextWalletIdentityRequest = true },
		emitAccountsChanged() {
			for (const listener of accountListeners) listener(accounts)
		},
	}
}

afterEach(() => {
	cleanup()
	window.localStorage.clear()
	delete window.ethereum
})

describe('Sealwort app wallet workflows', () => {
	test('refreshes the rendered connected account when the provider advertises an account change', async () => {
		const harness = createProviderHarness()
		window.ethereum = harness.provider
		render(<App />)

		await screen.findByText(checksummedAddress(ownerAddress))
		harness.setAccounts(['0x0000000000000000000000000000000000009876'])
		harness.emitAccountsChanged()

		await screen.findByText(checksummedAddress(0x9876n))
	})

	test('does not restore stale wallet identity after an account-change refresh fails', async () => {
		const harness = createProviderHarness()
		window.ethereum = harness.provider
		render(<App />)

		const previousAccount = await screen.findByText(checksummedAddress(ownerAddress))
		harness.failNextWalletIdentityRequest()
		harness.emitAccountsChanged()

		await screen.findByText('Wallet identity unavailable')
		assert.equal(previousAccount.isConnected, false)
		assert.equal(screen.queryByText(checksummedAddress(ownerAddress)), null)
		assert.notEqual(screen.getByRole('button', { name: 'Connect signer wallet' }), undefined)
	})

	test('does not request a chain ID until a wallet account is available', async () => {
		const harness = createProviderHarness({ accounts: [] })
		window.ethereum = harness.provider
		render(<App />)

		await screen.findByRole('button', { name: 'Connect signer wallet' })
		assert.equal(harness.requestedMethods.includes('eth_accounts'), true)
		assert.equal(harness.requestedMethods.includes('eth_chainId'), false)
	})

	test('stays disconnected without an error when chain discovery times out and retries on connect', async () => {
		const harness = createProviderHarness({
			hangingMethod: 'eth_chainId',
			hangingMethodRequestCount: 1,
		})
		window.ethereum = harness.provider
		render(<App walletRequestTimeoutMs = { 5 } />)

		const connectButton = await screen.findByRole('button', { name: 'Connect signer wallet' })
		assert.equal(screen.queryByText(getWalletRequestTimeoutMessage('eth_chainId')), null)
		assert.equal(screen.queryByRole('alert'), null)
		assert.equal(harness.requestedMethods.filter((method) => method === 'eth_chainId').length, 1)

		fireEvent.click(connectButton)
		await screen.findByText(checksummedAddress(ownerAddress))
		assert.equal(harness.requestedMethods.filter((method) => method === 'eth_chainId').length, 2)
	})

	test('reports a retryable connection failure without exposing the chain RPC method', async () => {
		const harness = createProviderHarness({ hangingMethod: 'eth_chainId' })
		window.ethereum = harness.provider
		render(<App walletRequestTimeoutMs = { 5 } />)

		const connectButton = await screen.findByRole('button', { name: 'Connect signer wallet' })
		assert.equal(screen.queryByRole('alert'), null)
		fireEvent.click(connectButton)

		await screen.findByText('The wallet connection could not be completed. Try connecting again.')
		assert.equal(screen.queryByText(getWalletRequestTimeoutMessage('eth_chainId')), null)
		assert.notEqual(screen.getByRole('button', { name: 'Connect signer wallet' }), undefined)
	})

	test('reports the same retryable failure when manual wallet refresh cannot discover the chain', async () => {
		const harness = createProviderHarness({
			hangingMethod: 'eth_chainId',
			hangingMethodStartAtRequest: 2,
		})
		window.ethereum = harness.provider
		render(<App walletRequestTimeoutMs = { 5 } />)

		fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))

		await screen.findByText('The wallet connection could not be completed. Try connecting again.')
		assert.equal(screen.queryByText(getWalletRequestTimeoutMessage('eth_chainId')), null)
		assert.notEqual(screen.getByRole('button', { name: 'Connect signer wallet' }), undefined)
	})

	test('ignores a chain discovery timeout from a superseded manual refresh', async () => {
		const harness = createProviderHarness({
			hangingMethod: 'eth_chainId',
			hangingMethodRequestCount: 1,
			hangingMethodStartAtRequest: 2,
		})
		window.ethereum = harness.provider
		render(<App walletRequestTimeoutMs = { 20 } />)

		fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
		await waitFor(() => assert.equal(harness.requestedMethods.filter((method) => method === 'eth_chainId').length, 2))
		harness.emitAccountsChanged()

		await screen.findByRole('button', { name: 'Refresh' })
		await Bun.sleep(30)
		assert.equal(screen.queryByText('The wallet connection could not be completed. Try connecting again.'), null)
		assert.notEqual(screen.getAllByText(checksummedAddress(ownerAddress)).length, 0)
	})

	test('keeps a connected wallet when stack verification chain discovery times out', async () => {
		const harness = createProviderHarness({
			hangingMethod: 'eth_chainId',
			hangingMethodRequestCount: 1,
			hangingMethodStartAtRequest: 3,
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack())),
		)
		render(<App walletRequestTimeoutMs = { 5 } />)

		await screen.findByText(getWalletRequestTimeoutMessage('eth_chainId'))
		assert.notEqual(screen.getAllByText(checksummedAddress(ownerAddress)).length, 0)
		assert.equal(screen.queryByRole('button', { name: 'Connect signer wallet' }), null)
	})

	test('stops loading and identifies the RPC method when Safe account inspection times out', async () => {
		const harness = createProviderHarness({
			accounts: [`0x${ safeAddress.toString(16).padStart(40, '0') }`],
			hangingMethod: 'eth_getCode',
		})
		window.ethereum = harness.provider
		render(<App walletRequestTimeoutMs = { 5 } />)

		await screen.findByText(`Sealwort could not inspect this account: ${ getWalletRequestTimeoutMessage('eth_getCode') }`)
		assert.equal(screen.queryByText('Loading…'), null)
		assert.equal(screen.queryByText('Loading account, Gnosis Safe information, and stack verification…'), null)
		assert.notEqual(screen.getByRole('button', { name: 'Refresh' }), undefined)
	})

	test('restores a persisted stack and remains retryable after a rejected signature request', async () => {
		const harness = createProviderHarness({ rejectFirstSignature: true })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack())),
		)
		render(<App />)

		const signButton = await screen.findByRole('button', { name: 'Add my signature' }, { timeout: 3000 })
		await waitFor(() => assert.equal(signButton.hasAttribute('disabled'), false))
		fireEvent.click(signButton)
		await screen.findByText('The wallet request was rejected.')
		await waitFor(() => assert.equal(signButton.hasAttribute('disabled'), false))

		fireEvent.click(signButton)
		await screen.findByRole('heading', { name: 'Updated Gnosis Safe Stack JSON' })
		await waitFor(() => assert.match(window.localStorage.getItem(PERSISTED_SAFE_STACK_STORAGE_KEY) ?? '', /"signatures":\s*\[/u))
		assert.equal(screen.getByRole('button', { name: 'Already signed' }).hasAttribute('disabled'), true)
	})

	test('keeps signing available while warning that browser storage is unavailable', async () => {
		const harness = createProviderHarness()
		const serializedStack = JSON.stringify(SafeStackExport.serialize(createStack()))
		window.ethereum = harness.provider
		render(<App browserStorage = { {
			getItem: () => serializedStack,
			setItem: () => { throw new Error('Storage blocked') },
			removeItem: () => { throw new Error('Storage blocked') },
		} } />)

		const signButton = await screen.findByRole('button', { name: 'Add my signature' }, { timeout: 3000 })
		await waitFor(() => assert.equal(signButton.hasAttribute('disabled'), false))
		assert.notEqual(screen.getByText(SAFE_STACK_PERSISTENCE_WARNING), undefined)
		fireEvent.click(signButton)

		await screen.findByRole('heading', { name: 'Updated Gnosis Safe Stack JSON' })
		assert.equal(screen.getByRole('button', { name: 'Already signed' }).hasAttribute('disabled'), true)
	})

	test('makes zero-value signing available without waiting for the vault balance request', async () => {
		const harness = createProviderHarness({ nativeBalanceResult: new Promise(() => undefined) })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack())),
		)
		render(<App walletRequestTimeoutMs = { 5 } />)

		const signButton = await screen.findByRole('button', { name: 'Add my signature' }, { timeout: 3000 })
		await waitFor(() => assert.equal(signButton.hasAttribute('disabled'), false))
		assert.equal(screen.queryByText('Retrieving current Gnosis Safe information…'), null)
	})

	test('verifies a stack without waiting for optional wallet capability discovery', async () => {
		const harness = createProviderHarness({ walletCapabilitiesResult: new Promise(() => undefined) })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack())),
		)
		render(<App walletRequestTimeoutMs = { 5 } />)

		const signButton = await screen.findByRole('button', { name: 'Add my signature' }, { timeout: 3000 })
		await waitFor(() => assert.equal(signButton.hasAttribute('disabled'), false))
		assert.equal(harness.requestedMethods.includes('wallet_getCapabilities'), true)
	})

	test('signs and executes through an EOA in the expected wallet-request order', async () => {
		const harness = createProviderHarness({ threshold: 1n })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(1n))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Sign and execute' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		await screen.findByText(/Gnosis Safe execution transaction submitted:/u)
		const signatureIndex = harness.requestedMethods.indexOf('eth_signTypedData_v4')
		const submissionIndex = harness.requestedMethods.indexOf('eth_sendTransaction')
		assert.notEqual(signatureIndex, -1)
		assert.equal(submissionIndex > signatureIndex, true)
	})

	test('preserves the added-signature status when the submitted execution reverts', async () => {
		const harness = createProviderHarness({
			threshold: 1n,
			executionReceiptResult: { status: '0x0', blockNumber: '0x124' },
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(1n))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Sign and execute' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		await screen.findByText('The execution transaction failed in block 292.')
		await screen.findByText(`Signature from ${ checksummedAddress(ownerAddress) } added for Gnosis Safe nonce 3.`)
		assert.match(window.localStorage.getItem(PERSISTED_SAFE_STACK_STORAGE_KEY) ?? '', /"signatures":\s*\[/u)
	})

	test('keeps a failed threshold-ready execution retryable', async () => {
		const ownerSignature = signTyped(safeTxToTypedData(safeTx), ownerPrivateKey)
		const harness = createProviderHarness({ threshold: 1n, rejectFirstExecution: true })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(1n, [{ signer: ownerAddress, signature: ownerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute transaction' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)
		await screen.findByText('The Interceptor failed to process the transaction')
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		await screen.findByText(/Gnosis Safe execution transaction submitted:/u)
		assert.equal(harness.requestedMethods.filter((method) => method === 'eth_sendTransaction').length, 2)
	})

	test('allows a non-owner EOA to execute a threshold-ready transaction', async () => {
		const ownerSignature = signTyped(safeTxToTypedData(safeTx), ownerPrivateKey)
		const harness = createProviderHarness({
			accounts: [`0x${ nonOwnerAddress.toString(16).padStart(40, '0') }`],
			threshold: 1n,
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(1n, [{ signer: ownerAddress, signature: ownerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute transaction' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		await screen.findByText(/Gnosis Safe execution transaction submitted:/u)
		assert.equal(harness.requestedMethods.includes('eth_sendTransaction'), true)
	})

	test('keeps provider-loss execution failures local and retryable', async () => {
		const ownerSignature = signTyped(safeTxToTypedData(safeTx), ownerPrivateKey)
		const harness = createProviderHarness({ threshold: 1n })
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(1n, [{ signer: ownerAddress, signature: ownerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute transaction' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		delete window.ethereum
		fireEvent.click(executeButton)

		await screen.findByText('No injected Ethereum wallet was found.')
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
	})

	test('executes through a connected Safe wallet without requesting a typed-data signature', async () => {
		const otherOwnerSignature = signTyped(safeTxToTypedData(safeTx), otherOwnerPrivateKey)
		const harness = createProviderHarness({
			accounts: [`0x${ safeAddress.toString(16).padStart(40, '0') }`],
			activeSafeSigner: ownerAddress,
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(2n, [{ signer: otherOwnerAddress, signature: otherOwnerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute through connected Safe wallet' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		await screen.findByText(/Gnosis Safe execution transaction submitted:/u)
		assert.equal(harness.requestedMethods.includes('eth_signTypedData_v4'), false)
		assert.equal(harness.requestedMethods.includes('eth_sendTransaction'), true)
	})

	test('keeps a connected Safe execution pending until its receipt is included', async () => {
		const otherOwnerSignature = signTyped(safeTxToTypedData(safeTx), otherOwnerPrivateKey)
		let includeExecution: (receipt: unknown) => void = () => undefined
		const executionReceiptResult = new Promise<unknown>((resolve) => { includeExecution = resolve })
		const harness = createProviderHarness({
			accounts: [`0x${ safeAddress.toString(16).padStart(40, '0') }`],
			activeSafeSigner: ownerAddress,
			executionReceiptResult,
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(2n, [{ signer: otherOwnerAddress, signature: otherOwnerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute through connected Safe wallet' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)

		const waitingButton = await screen.findByRole('button', { name: /Waiting for chain inclusion/u })
		assert.equal(waitingButton.hasAttribute('disabled'), true)
		assert.equal(waitingButton.getAttribute('aria-busy'), 'true')
		includeExecution({ status: '0x1', blockNumber: '0x124' })

		await screen.findByRole('button', { name: 'Execution included' })
		await screen.findByText(/execution transaction included in block 292:/u)
	})

	test('ignores a pending receipt after a wallet refresh supersedes its stack operation', async () => {
		const otherOwnerSignature = signTyped(safeTxToTypedData(safeTx), otherOwnerPrivateKey)
		let includeExecution: (receipt: unknown) => void = () => undefined
		const executionReceiptResult = new Promise<unknown>((resolve) => { includeExecution = resolve })
		const harness = createProviderHarness({
			accounts: [`0x${ safeAddress.toString(16).padStart(40, '0') }`],
			activeSafeSigner: ownerAddress,
			executionReceiptResult,
		})
		window.ethereum = harness.provider
		window.localStorage.setItem(
			PERSISTED_SAFE_STACK_STORAGE_KEY,
			JSON.stringify(SafeStackExport.serialize(createStack(2n, [{ signer: otherOwnerAddress, signature: otherOwnerSignature }]))),
		)
		render(<App />)

		const executeButton = await screen.findByRole('button', { name: 'Execute through connected Safe wallet' }, { timeout: 3000 })
		await waitFor(() => assert.equal(executeButton.hasAttribute('disabled'), false))
		fireEvent.click(executeButton)
		await screen.findByRole('button', { name: /Waiting for chain inclusion/u })

		harness.emitAccountsChanged()
		await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Execute through connected Safe wallet' }).hasAttribute('disabled'), false))
		includeExecution({ status: '0x1', blockNumber: '0x124' })
		await executionReceiptResult
		await new Promise((resolve) => globalThis.setTimeout(resolve, 10))

		assert.equal(screen.queryByText(/execution transaction included in block/u), null)
		assert.equal(screen.queryByRole('button', { name: 'Execution included' }), null)
	})
})
