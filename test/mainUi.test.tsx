import * as assert from 'node:assert'
import { afterEach, describe, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { createRef } from 'preact'
import { createSafeTx, getSafeTxHash } from '../src/app/safeProtocol.js'
import type { SafeTransactionStack } from '../src/app/safeStackProtocol.js'
import type { VerifiedSafeState } from '../src/app/safeStackValidation.js'
import { SafeStackPanel } from '../src/app/components/SafeStackPanel.js'
import { StackJsonInput, UpdatedStackPanel } from '../src/app/components/StackJsonPanels.js'
import { WalletSummary } from '../src/app/components/WalletSummary.js'

afterEach(cleanup)

const safeAddress = 0x1234n
const owner = 0x5678n
const safeTx = createSafeTx(11155111n, safeAddress, { to: 0x9abcn, value: 1_000_000_000_000_000n, input: new Uint8Array() }, 3n)
const safeTxHash = BigInt(getSafeTxHash(safeTx))
const verifiedState: VerifiedSafeState = { version: '1.4.1', nonce: 3n, threshold: 1n, owners: [owner] }

function createStack(signatures: SafeTransactionStack['transactions'][number]['signatures'] = []): SafeTransactionStack {
	return {
		chainId: 11155111n,
		safeAddress,
		safeVersion: '1.4.1',
		baseNonce: 3n,
		threshold: 1n,
		transactions: [{
			safeTx,
			safeTxHash,
			created: new Date('2026-01-01T00:00:00Z'),
			websiteOrigin: 'example.test',
			transactionIdentifier: 1n,
			signatures,
		}],
	}
}

const availableNativeAsset = { symbol: 'SepoliaETH', balance: { status: 'available', value: 2_000_000_000_000_000n } } as const

function renderStack(overrides: Partial<Parameters<typeof SafeStackPanel>[0]> = {}) {
	const onSignCalls: { transactionIndex: number, execute: boolean }[] = []
	const onExecuteCalls: number[] = []
	const props: Parameters<typeof SafeStackPanel>[0] = {
		stack: createStack(),
		stackIndex: 0,
		account: owner,
		walletChainId: 11155111n,
		accountInformation: { kind: 'eoa', address: owner, chainId: 11155111n },
		routedSigner: undefined,
		currentSafeInformation: { chainId: 11155111n, safeAddress, loading: false, nativeAssetLoading: false, state: verifiedState, nativeAsset: availableNativeAsset },
		currentConnectedSafeBalances: undefined,
		accountInformationLoading: false,
		connectedSafeBalancesLoading: false,
		stackVerificationLoading: false,
		stackVerified: true,
		verifiedSafeState: verifiedState,
		executionGasChecks: [{ safeTxHash, status: 'complete', disabledReason: undefined }],
		pendingAction: undefined,
		busy: false,
		submittedExecutionHashes: [],
		transactionActionErrors: [],
		onSign: (transactionIndex, execute) => { onSignCalls.push({ transactionIndex, execute }) },
		onExecute: (transactionIndex) => { onExecuteCalls.push(transactionIndex) },
		...overrides,
	}
	render(<SafeStackPanel { ...props } />)
	return { onSignCalls, onExecuteCalls }
}

describe('Sealwort rendered UI', () => {
	test('wallet loading hides connection actions and exposes a status', () => {
		render(<WalletSummary loading loadingLabel = 'Loading…' busy = { false } applicationLoading account = { undefined } chainId = { undefined } accountInformation = { undefined } activeSigner = { undefined } activeSignerLoading = { false } balances = { undefined } balancesLoading = { false } nativeAsset = { undefined } onConnect = { () => undefined } onRefresh = { () => undefined } />)

		assert.equal(screen.getByRole('status').textContent?.includes('Loading…'), true)
		assert.equal(screen.queryByRole('button', { name: 'Connect signer wallet' }), null)
	})

	test('wallet connection and refresh controls invoke their handlers', () => {
		let connected = 0
		let refreshed = 0
		render(<WalletSummary loading = { false } loadingLabel = 'Loading…' busy = { false } applicationLoading = { false } account = { undefined } chainId = { undefined } accountInformation = { undefined } activeSigner = { undefined } activeSignerLoading = { false } balances = { undefined } balancesLoading = { false } nativeAsset = { undefined } onConnect = { () => { connected += 1 } } onRefresh = { () => { refreshed += 1 } } />)

		fireEvent.click(screen.getByRole('button', { name: 'Connect signer wallet' }))
		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
		assert.equal(connected, 1)
		assert.equal(refreshed, 1)
	})

	test('connected Safe details distinguish the vault, signer, and vault balances', () => {
		render(<WalletSummary loading = { false } loadingLabel = 'Loading…' busy = { false } applicationLoading = { false } account = { safeAddress } chainId = { 11155111n } accountInformation = { { kind: 'safe', address: safeAddress, chainId: 11155111n, state: verifiedState } } activeSigner = { owner } activeSignerLoading = { false } balances = { { native: availableNativeAsset, usdc: { symbol: 'SepoliaUSDC', balance: { status: 'available', value: 2_000_000n } } } } balancesLoading = { false } nativeAsset = { availableNativeAsset } onConnect = { () => undefined } onRefresh = { () => undefined } />)

		const summary = screen.getByRole('region', { name: 'Connected wallet summary' })
		assert.equal(summary.textContent?.includes('Vault'), true)
		assert.equal(summary.textContent?.includes('Active signer'), true)
		assert.equal(summary.textContent?.includes('SepoliaETH'), true)
		assert.equal(summary.textContent?.includes('SepoliaUSDC'), true)
		assert.equal(screen.getByRole('button', { name: 'Refresh' }).closest('.wallet-refresh-action') !== null, true)
	})

	test('stack JSON input expands and reports pasted text', () => {
		let expanded = false
		let value = ''
		const { rerender } = render(<StackJsonInput textareaRef = { createRef() } value = { value } expanded = { expanded } disabled = { false } onValueChange = { (nextValue) => { value = nextValue } } onToggle = { () => { expanded = !expanded } } onFileChange = { async () => undefined } />)

		fireEvent.input(screen.getByLabelText('Gnosis Safe Stack JSON'), { target: { value: '{"name":"stack"}' } })
		fireEvent.click(screen.getByRole('button', { name: 'Expand stack input' }))
		rerender(<StackJsonInput textareaRef = { createRef() } value = { value } expanded = { expanded } disabled = { false } onValueChange = { (nextValue) => { value = nextValue } } onToggle = { () => { expanded = !expanded } } onFileChange = { async () => undefined } />)

		assert.equal(value, '{"name":"stack"}')
		assert.equal(screen.getByLabelText('Gnosis Safe Stack JSON').classList.contains('expanded'), true)
		assert.equal(screen.getByRole('button', { name: 'Collapse stack input' }).getAttribute('aria-expanded'), 'true')
	})

	test('prettifies valid JSON pasted into the stack input', () => {
		let value = ''
		const { rerender } = render(<StackJsonInput textareaRef = { createRef() } value = { value } expanded = { false } disabled = { false } onValueChange = { (nextValue) => { value = nextValue } } onToggle = { () => undefined } onFileChange = { async () => undefined } />)
		const input = screen.getByLabelText('Gnosis Safe Stack JSON')

		fireEvent.paste(input, { clipboardData: { getData: () => '{"name":"stack","stacks":[]}' } })
		rerender(<StackJsonInput textareaRef = { createRef() } value = { value } expanded = { false } disabled = { false } onValueChange = { (nextValue) => { value = nextValue } } onToggle = { () => undefined } onFileChange = { async () => undefined } />)

		assert.equal(value, '{\n\t"name": "stack",\n\t"stacks": []\n}')
		assert.equal((screen.getByLabelText('Gnosis Safe Stack JSON') as HTMLTextAreaElement).value, value)
	})

	test('updated stack uses the same disclosure behavior and sharing guidance', () => {
		let expanded = false
		const { rerender } = render(<UpdatedStackPanel textareaRef = { createRef() } value = '{"signed":true}' expanded = { expanded } onToggle = { () => { expanded = !expanded } } />)
		fireEvent.click(screen.getByRole('button', { name: 'Expand updated stack' }))
		rerender(<UpdatedStackPanel textareaRef = { createRef() } value = '{"signed":true}' expanded = { expanded } onToggle = { () => { expanded = !expanded } } />)

		assert.equal(screen.getByLabelText('Updated Gnosis Safe Stack JSON').getAttribute('wrap'), 'soft')
		assert.equal(screen.getByLabelText('Updated Gnosis Safe Stack JSON').classList.contains('expanded'), true)
		assert.equal(screen.getByText(/Share this updated stack with the other Gnosis Safe signers/u) !== undefined, true)
	})

	test('a final signer can choose signing only or signing and execution', () => {
		const { onSignCalls } = renderStack()

		fireEvent.click(screen.getByRole('button', { name: 'Add my signature' }))
		fireEvent.click(screen.getByRole('button', { name: 'Sign and execute' }))
		assert.deepEqual(onSignCalls, [{ transactionIndex: 0, execute: false }, { transactionIndex: 0, execute: true }])
		assert.equal(screen.getByRole('heading', { name: 'Gnosis Safe Transaction 3' }) !== undefined, true)
		assert.equal(screen.getByText('0 / 1 signatures') !== undefined, true)
		assert.equal(screen.getByText('Your signature will reach the required threshold. Choose whether to add the signature only or sign and execute.') !== undefined, true)
	})

	test('asks a connected Safe wallet user to review the transaction before approval', () => {
		renderStack({
			account: safeAddress,
			accountInformation: { kind: 'safe', address: safeAddress, chainId: 11155111n, state: verifiedState },
			routedSigner: owner,
			currentConnectedSafeBalances: { native: availableNativeAsset },
		})

		assert.equal(screen.getByText('Review the transaction in your connected Safe wallet before approving it.') !== undefined, true)
	})

	test('a threshold-ready transaction executes and displays action errors below its controls', () => {
		const stack = createStack([{ signer: owner, signature: '0xsignature' }])
		const { onExecuteCalls } = renderStack({ stack, transactionActionErrors: [{ safeTxHash, message: 'Wallet failed' }] })

		fireEvent.click(screen.getByRole('button', { name: 'Execute transaction' }))
		assert.deepEqual(onExecuteCalls, [0])
		const alert = screen.getByRole('alert')
		assert.equal(alert.textContent, 'Wallet failed')
		assert.equal(alert.closest('.transaction-action-control') !== null, true)
	})

	test('an action error replaces a still-loading execution funding check', () => {
		renderStack({
			executionGasChecks: [{ safeTxHash, status: 'loading' }],
			transactionActionErrors: [{ safeTxHash, message: 'Signing failed' }],
		})

		assert.equal(screen.getByRole('alert').textContent, 'Signing failed')
		assert.equal(screen.queryByText('Checking the active signer’s balance and estimated execution gas…'), null)
	})

	test('insufficient vault funds disable execution with an explanation', () => {
		const stack = createStack([{ signer: owner, signature: '0xsignature' }])
		renderStack({ stack, currentSafeInformation: { chainId: 11155111n, safeAddress, loading: false, nativeAssetLoading: false, state: verifiedState, nativeAsset: { symbol: 'SepoliaETH', balance: { status: 'available', value: 1n } } } })

		const executeButton = screen.getByRole('button', { name: 'Execute transaction' })
		assert.equal(executeButton.hasAttribute('disabled'), true)
		assert.equal(screen.getByText(/Gnosis Safe vault has/u).closest('.transaction-action-control') !== null, true)
	})

	test('loading and wallet-pending actions render spinners inside their buttons', () => {
		renderStack({ pendingAction: 'sign:0:0', busy: true })
		const waitingButton = screen.getByRole('button', { name: /Waiting for wallet/u })
		assert.equal(waitingButton.querySelector('svg.spinner') !== null, true)
		assert.equal(waitingButton.getAttribute('aria-busy'), 'true')
	})
})
