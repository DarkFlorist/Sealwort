import * as assert from 'node:assert'
import { afterEach, describe, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { createRef } from 'preact'
import { createSafeTx, getSafeTxHash } from '../src/app/safeProtocol.js'
import { SAFE_STACK_EXPORT_NAME, SAFE_STACK_FORMAT_VERSION, type SafeStackExport, type SafeTransactionStack } from '../src/app/safeStackProtocol.js'
import type { VerifiedSafeState } from '../src/app/safeStackValidation.js'
import { SafeStackPanel } from '../src/app/components/SafeStackPanel.js'
import { StackJsonInput, UpdatedStackPanel } from '../src/app/components/StackJsonPanels.js'
import { WalletSummary } from '../src/app/components/WalletSummary.js'
import { CONTRACTS, createContract, ERC20, ERC721, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from '../src/app/abis/customPayment.js'
import { ERC4626_ABI } from '../src/app/abis/erc4626.js'
import { dataStringWith0xStart } from '../src/app/ethereum.js'
import { useTransactionDataMetadata } from '../src/app/useTransactionDataMetadata.js'

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

type SafeStackPanelProps = Parameters<typeof SafeStackPanel>[0]
type RenderStackOverrides = Partial<Omit<SafeStackPanelProps, 'transactionDataMetadata'>> & {
	readonly walletRequestTimeoutMs?: number
	readonly transactionDataMetadataOverride?: SafeStackPanelProps['transactionDataMetadata']
}

function SafeStackPanelWithMetadata({ walletRequestTimeoutMs, transactionDataMetadataOverride, ...props }: Omit<SafeStackPanelProps, 'transactionDataMetadata'> & { readonly walletRequestTimeoutMs: number | undefined, readonly transactionDataMetadataOverride: SafeStackPanelProps['transactionDataMetadata'] | undefined }) {
	const stackExport: SafeStackExport = { name: SAFE_STACK_EXPORT_NAME, version: SAFE_STACK_FORMAT_VERSION, stacks: [props.stack] }
	const transactionDataMetadata = useTransactionDataMetadata(stackExport, walletRequestTimeoutMs)
	return <SafeStackPanel { ...props } transactionDataMetadata = { transactionDataMetadataOverride ?? transactionDataMetadata[0] ?? [] } />
}

function renderStack(overrides: RenderStackOverrides = {}) {
	const onSignCalls: { transactionIndex: number, execute: boolean }[] = []
	const onExecuteCalls: number[] = []
	const { walletRequestTimeoutMs, transactionDataMetadataOverride, ...panelOverrides } = overrides
	const props: Omit<SafeStackPanelProps, 'transactionDataMetadata'> = {
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
		submittedExecutions: [],
		transactionActionErrors: [],
		onSign: (transactionIndex, execute) => { onSignCalls.push({ transactionIndex, execute }) },
		onExecute: (transactionIndex) => { onExecuteCalls.push(transactionIndex) },
		...panelOverrides,
	}
	render(<SafeStackPanelWithMetadata { ...props } walletRequestTimeoutMs = { walletRequestTimeoutMs } transactionDataMetadataOverride = { transactionDataMetadataOverride } />)
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
		render(<WalletSummary loading = { false } loadingLabel = 'Loading…' busy = { false } applicationLoading = { false } account = { safeAddress } chainId = { 11155111n } accountInformation = { { kind: 'safe', address: safeAddress, chainId: 11155111n, state: verifiedState } } activeSigner = { owner } activeSignerLoading = { false } balances = { { native: availableNativeAsset, usdc: { symbol: 'USDC', balance: { status: 'available', value: 2_000_000n } } } } balancesLoading = { false } nativeAsset = { availableNativeAsset } onConnect = { () => undefined } onRefresh = { () => undefined } />)

		const summary = screen.getByRole('region', { name: 'Connected wallet summary' })
		assert.equal(summary.textContent?.includes('Vault'), true)
		assert.equal(summary.textContent?.includes('Active signer'), true)
		assert.equal(summary.textContent?.includes('SepoliaETH'), true)
		assert.equal(summary.textContent?.includes('USDC'), true)
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

	test('shows compact human-readable Safe execution configuration', () => {
		renderStack()

		assert.equal(screen.getByText('Call').previousElementSibling?.textContent, 'Operation')
		assert.equal(screen.getByText('Not specified').previousElementSibling?.textContent, 'Safe tx gas')
		assert.equal(screen.getAllByText('None').some((element) => element.previousElementSibling?.textContent === 'Base gas'), true)
		assert.equal(screen.getByText('Gas refund disabled').previousElementSibling?.textContent, 'Gas price')
		assert.equal(screen.getAllByText('Not enabled').length, 2)
	})

	test('shows a local fallback when transaction metadata is absent', () => {
		renderStack({ transactionDataMetadataOverride: [] })
		assert.notEqual(screen.getByText('Invalid calldata: Transaction details unavailable.'), undefined)
	})

	test('defaults to parsed ERC-20 calldata, reads decimals, and toggles to raw data', async () => {
		const data = createContract(ERC20).transfer.encodeInput({
			to: '0x0000000000000000000000000000000000005678',
			value: 1_500_000n,
		})
		const stack = createStack()
		const transaction = stack.transactions[0]
		if (transaction === undefined) throw new Error('Missing transaction fixture.')
		const dataStack: SafeTransactionStack = {
			...stack,
			transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n, data } } }],
		}
		const previousEthereum = window.ethereum
		window.ethereum = {
			request: async ({ method }) => method === 'eth_chainId' ? '0xaa36a7' : `0x${ '0'.repeat(63) }6`,
		}
		try {
			renderStack({ stack: dataStack })
			assert.equal(screen.getByText('transfer').textContent, 'transfer')
			assert.notEqual(await screen.findByText('1.5 tokens'), undefined)
			fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
			assert.notEqual(screen.getByText(dataStringWith0xStart(data)), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('shows unexpected token metadata errors instead of replacing them with a generic message', async () => {
		const data = createContract(ERC20).transfer.encodeInput({
			to: '0x0000000000000000000000000000000000005678',
			value: 1_500_000n,
		})
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method }) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			throw new Error('Token metadata provider failed unexpectedly.')
		} }
		try {
			renderStack({ stack: { ...stack, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n, data } } }] } })
			assert.notEqual(await screen.findByText('Token metadata provider failed unexpectedly.'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('times out a token metadata request that never settles', async () => {
		const data = createContract(ERC20).transfer.encodeInput({ to: '0x0000000000000000000000000000000000005678', value: 1_500_000n })
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method }) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			return await new Promise<never>(() => undefined)
		} }
		try {
			renderStack({
				walletRequestTimeoutMs: 5,
				stack: { ...stack, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n, data } } }] },
			})
			assert.notEqual(await screen.findByText('The wallet did not respond to eth_call. Reconnect the wallet and try again.'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('falls back to a parsed token helper when ERC-721 classification times out', async () => {
		const data = createContract(CUSTOM_PAYMENT_ABI).safeTransferFrom.encodeInput({
			_tokenAddress: '0x0000000000000000000000000000000000001111',
			_to: '0x0000000000000000000000000000000000002222',
			_amount: 1_500_000n,
		})
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method }) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			return await new Promise<never>(() => undefined)
		} }
		try {
			renderStack({
				walletRequestTimeoutMs: 5,
				stack: { ...stack, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0x9999n, data } } }] },
			})
			assert.equal((await screen.findAllByText('The wallet did not respond to eth_call. Reconnect the wallet and try again.')).length > 0, true)
			assert.equal(screen.queryByText('Identifying transfer…'), null)
			assert.notEqual(screen.getByText('Token'), undefined)
			assert.notEqual(screen.getByText('Recipient'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('uses destination ERC-165 support to render the shared selector as an ERC-721 transfer', async () => {
		const erc721 = createContract(ERC721) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const data = erc721['safeTransferFrom(address,address,uint256)']!.encodeInput({
			from: '0x0000000000000000000000000000000000001111',
			to: '0x0000000000000000000000000000000000002222',
			tokenId: 42n,
		})
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method }) => method === 'eth_chainId' ? '0xaa36a7' : `0x${ '0'.repeat(63) }1` }
		try {
			renderStack({ stack: { ...stack, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0x9999n, data } } }] } })
			assert.notEqual(await screen.findByText('Token ID'), undefined)
			assert.equal(screen.getByText('42').previousElementSibling?.textContent, 'Token ID')
			assert.notEqual(screen.getByText('Sender'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('renders the shared selector as the token helper when the destination is not ERC-721', async () => {
		const token = '0x0000000000000000000000000000000000001111'
		const data = createContract(CUSTOM_PAYMENT_ABI).safeTransferFrom.encodeInput({ _tokenAddress: token, _to: '0x0000000000000000000000000000000000002222', _amount: 1_500_000n })
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		let contractCalls = 0
		window.ethereum = { request: async ({ method }) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			contractCalls += 1
			if (contractCalls === 1) throw new Error('execution reverted')
			return `0x${ '0'.repeat(63) }6`
		} }
		try {
			renderStack({ stack: { ...stack, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0x9999n, data } } }] } })
			assert.notEqual(await screen.findByText('1.5 tokens'), undefined)
			assert.equal(screen.getByText('1.5 tokens').previousElementSibling?.textContent, 'Amount')
			assert.notEqual(screen.getByText('Token'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('identifies known and connected addresses inline', () => {
		const stack = createStack()
		const transaction = stack.transactions[0]
		if (transaction === undefined) throw new Error('Missing transaction fixture.')
		renderStack({
			stack: {
				...stack,
				chainId: 1n,
				transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2n } } }],
			},
		})

		assert.match(screen.getByText(/\(WETH\)/u).textContent ?? '', /WETH/u)
		assert.equal(screen.getAllByText(/\(connected wallet\)/u).length > 0, true)
	})

	test('formats both sides of a Uniswap V2 swap with known token metadata', async () => {
		const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
		const router = createContract(CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT]!.abi as ContractABI) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const data = router.swapExactTokensForTokens!.encodeInput({ amountIn: 1_500_000n, amountOutMin: 2_000_000_000_000_000_000n, path: [usdc, weth], to: '0x0000000000000000000000000000000000005678', deadline: 1n })
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method, params }) => {
			if (method === 'eth_chainId') return '0x1'
			const call = params?.[0]
			const to = typeof call === 'object' && call !== null && 'to' in call ? call.to : undefined
			return `0x${ (to === usdc ? 6n : 18n).toString(16).padStart(64, '0') }`
		} }
		try {
			renderStack({ stack: { ...stack, chainId: 1n, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: BigInt(UNISWAP_V2_ROUTER_CONTRACT), data } } }] } })
			assert.notEqual(await screen.findByText('1.5 USDC'), undefined)
			assert.notEqual(await screen.findByText('2 WETH'), undefined)
			assert.notEqual(screen.getByText(/Uniswap V2 Router/u), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('expands decoded calls inside a Uniswap V3 multicall', async () => {
		const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
		const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
		const router = createContract(CONTRACTS[UNISWAP_V3_ROUTER_CONTRACT]!.abi as ContractABI) as unknown as Record<string, { encodeInput(value?: unknown): Uint8Array }>
		const swap = router.exactInputSingle!.encodeInput({ tokenIn: usdc, tokenOut: weth, fee: 3_000n, recipient: '0x0000000000000000000000000000000000005678', deadline: 1n, amountIn: 1_500_000n, amountOutMinimum: 2_000_000_000_000_000_000n, sqrtPriceLimitX96: 0n })
		const data = router.multicall!.encodeInput([swap, router.refundETH!.encodeInput()])
		const stack = createStack()
		const transaction = stack.transactions[0]!
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method, params }) => {
			if (method === 'eth_chainId') return '0x1'
			const call = params?.[0]
			const to = typeof call === 'object' && call !== null && 'to' in call ? call.to : undefined
			return `0x${ (to === usdc ? 6n : 18n).toString(16).padStart(64, '0') }`
		} }
		try {
			renderStack({ stack: { ...stack, chainId: 1n, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: BigInt(UNISWAP_V3_ROUTER_CONTRACT), data } } }] } })
			assert.notEqual(screen.getByText('multicall(exactInputSingle, refundETH)'), undefined)
			assert.notEqual(await screen.findByText('1.5 USDC'), undefined)
			assert.notEqual(await screen.findByText('2 WETH'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
	})

	test('reads an ERC-4626 vault asset before formatting asset amounts', async () => {
		const dai = '0x6b175474e89094c44da98b954eedeac495271d0f'
		const vaultAddress = 0x9999n
		const data = createContract(ERC4626_ABI).deposit.encodeInput({ assets: 2_000_000_000_000_000_000n, receiver: '0x0000000000000000000000000000000000005678' })
		const stack = createStack()
		const transaction = stack.transactions[0]!
		let calls = 0
		const previousEthereum = window.ethereum
		window.ethereum = { request: async ({ method }) => {
			if (method === 'eth_chainId') return '0x1'
			calls += 1
			return calls === 1 ? `0x${ dai.slice(2).padStart(64, '0') }` : `0x${ 18n.toString(16).padStart(64, '0') }`
		} }
		try {
			renderStack({ stack: { ...stack, chainId: 1n, transactions: [{ ...transaction, safeTx: { ...transaction.safeTx, message: { ...transaction.safeTx.message, to: vaultAddress, data } } }] } })
			assert.notEqual(await screen.findByText('2 DAI'), undefined)
		} finally {
			if (previousEthereum === undefined) delete window.ethereum
			else window.ethereum = previousEthereum
		}
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

	test('keeps a connected Safe execution spinning while it awaits chain inclusion', () => {
		renderStack({
			account: safeAddress,
			accountInformation: { kind: 'safe', address: safeAddress, chainId: 11155111n, state: verifiedState },
			routedSigner: owner,
			currentConnectedSafeBalances: { native: availableNativeAsset },
			submittedExecutions: [{ safeTxHash, transactionHash: `0x${ '1'.repeat(64) }`, status: 'pending' }],
		})

		const waitingButton = screen.getByRole('button', { name: /Waiting for chain inclusion/u })
		assert.equal(waitingButton.hasAttribute('disabled'), true)
		assert.equal(waitingButton.getAttribute('aria-busy'), 'true')
		assert.equal(waitingButton.querySelector('svg.spinner') !== null, true)
		assert.equal(screen.queryByRole('button', { name: 'Execute through connected Safe wallet' }), null)
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

	test('a stack-state mismatch keeps Safe information visible without starting a gas spinner', () => {
		const currentState: VerifiedSafeState = { ...verifiedState, nonce: 4n }
		renderStack({
			account: safeAddress,
			accountInformation: { kind: 'safe', address: safeAddress, chainId: 11155111n, state: currentState },
			routedSigner: owner,
			currentSafeInformation: { chainId: 11155111n, safeAddress, loading: false, nativeAssetLoading: false, state: currentState, nativeAsset: availableNativeAsset },
			currentConnectedSafeBalances: { native: availableNativeAsset },
			stackVerified: false,
			verifiedSafeState: undefined,
			executionGasChecks: [],
		})

		assert.equal(screen.getByText('4').previousElementSibling?.textContent, 'Nonce')
		assert.notEqual(screen.getByText(/no pending transaction at current nonce 4/u), undefined)
		assert.notEqual(screen.getByText('Sealwort could not verify this transaction against the current on-chain Gnosis Safe state.'), undefined)
		assert.equal(screen.queryByText('Current Gnosis Safe information is unavailable.'), null)
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
