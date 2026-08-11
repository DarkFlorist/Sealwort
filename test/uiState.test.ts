import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { createSafeTx } from '../src/app/safeProtocol.js'
import { submitSafeExecution } from '../src/app/safeExecution.js'
import type { InjectedProvider } from '../src/app/safeStackValidation.js'
import { getAutomaticStackVerificationAction, getExecutionDisabledReason, getExecutionGasFundingDisabledReason, getNativeTransferDisabledReason, getSafeStackTextAction, getSignatureDisabledReason, persistSafeStackText, PERSISTED_SAFE_STACK_STORAGE_KEY, readPersistedSafeStackText, resizeTextareaToContent, shouldInvalidateExecutionVerification } from '../src/app/uiState.js'

const availableSignature = {
	connectedAccount: 1n,
	walletChainId: 1n,
	safeChainId: 1n,
	safeVerified: true,
	safeNonce: 7n,
	transactionNonce: 7n,
	connectedAccountCanSign: true,
} as const

const availableExecution = {
	connectedAccount: 1n,
	connectedAccountCanExecute: true,
	walletChainId: 1n,
	safeChainId: 1n,
	safeVerified: true,
	safeNonce: 7n,
	transactionNonce: 7n,
	signatureCount: 2,
	threshold: 2n,
} as const

describe('Sealwort UI state', () => {
	test('explains each reason that adding a signature is disabled', () => {
		assert.equal(getSignatureDisabledReason({ ...availableSignature, connectedAccount: undefined }), 'Connect a signer wallet before adding your signature.')
		assert.equal(getSignatureDisabledReason({ ...availableSignature, walletChainId: 11155111n }), 'Switch the signer wallet to chain 1 before signing.')
		assert.equal(getSignatureDisabledReason({ ...availableSignature, safeVerified: false }), 'Sealwort could not verify this transaction against the current on-chain Gnosis Safe state.')
		assert.equal(getSignatureDisabledReason({ ...availableSignature, transactionNonce: 6n }), 'This Gnosis Safe transaction nonce has already executed or expired.')
		assert.equal(getSignatureDisabledReason({ ...availableSignature, connectedAccountCanSign: false }), 'The connected account is not an owner of this Gnosis Safe.')
		assert.equal(getSignatureDisabledReason(availableSignature), undefined)
	})

	test('allows only a verified current-nonce Safe transaction to be submitted by an EOA or connected Safe wallet', () => {
		assert.equal(getExecutionDisabledReason({ ...availableExecution, signatureCount: 1 }), 'Collect the required Gnosis Safe owner signatures before executing.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, connectedAccount: undefined }), 'Connect an EOA wallet or a connected Safe wallet to submit the execution transaction.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, walletChainId: 11155111n }), 'Switch the wallet to chain 1 before executing.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, safeVerified: false }), 'Verify the transaction against current on-chain Gnosis Safe information before executing.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, transactionNonce: 6n }), 'This Gnosis Safe transaction nonce has already executed or expired.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, transactionNonce: 8n }), 'Execute earlier Gnosis Safe transactions before this nonce.')
		assert.equal(getExecutionDisabledReason({ ...availableExecution, connectedAccountCanExecute: false }), 'Switch to an EOA wallet account or a connected Safe wallet to submit the execution transaction.')
		assert.equal(getExecutionDisabledReason(availableExecution), undefined)
	})

	test('disables execution when the Gnosis Safe vault cannot fund the native transfer', () => {
		assert.equal(getNativeTransferDisabledReason({
			balance: { status: 'available', value: 2_000_000_000_000_000_000n },
			symbol: 'ETH',
			earlierTransactionValue: 0n,
			transactionValue: 1_000_000_000_000_000_000n,
		}), undefined)
		assert.equal(getNativeTransferDisabledReason({
			balance: { status: 'available', value: 500_000_000_000_000_000n },
			symbol: 'ETH',
			earlierTransactionValue: 0n,
			transactionValue: 1_000_000_000_000_000_000n,
		}), 'The Gnosis Safe vault has 0.5 ETH, but this transaction sends 1 ETH.')
		assert.equal(getNativeTransferDisabledReason({
			balance: { status: 'available', value: 2_000_000_000_000_000_000n },
			symbol: 'SepoliaETH',
			earlierTransactionValue: 1_500_000_000_000_000_000n,
			transactionValue: 1_000_000_000_000_000_000n,
		}), 'After reserving 1.5 SepoliaETH for earlier Gnosis Safe transactions, the vault has 0.5 SepoliaETH available, but this transaction sends 1 SepoliaETH.')
		assert.equal(getNativeTransferDisabledReason({
			balance: { status: 'unavailable', error: 'RPC unavailable' },
			symbol: 'ETH',
			earlierTransactionValue: 0n,
			transactionValue: 1n,
		}), 'The Gnosis Safe vault’s ETH balance is unavailable, so Sealwort cannot confirm that this transfer has enough funds.')
		assert.equal(getNativeTransferDisabledReason({
			balance: undefined,
			symbol: 'ETH',
			earlierTransactionValue: 0n,
			transactionValue: 0n,
		}), undefined)
	})

	test('disables execution when the active signer cannot fund the estimated gas', () => {
		assert.equal(getExecutionGasFundingDisabledReason({
			balance: 3_000_000_000_000_000n,
			estimatedGas: 100_000n,
			maxFeePerGas: 20_000_000_000n,
			requiredBalance: 2_000_000_000_000_000n,
		}, 'ETH'), undefined)
		assert.equal(getExecutionGasFundingDisabledReason({
			balance: 1_000_000_000_000_000n,
			estimatedGas: 100_000n,
			maxFeePerGas: 20_000_000_000n,
			requiredBalance: 2_000_000_000_000_000n,
		}, 'SepoliaETH'), 'The active signer has 0.001 SepoliaETH, but it needs up to 0.002 SepoliaETH to cover the estimated Gnosis Safe execution gas.')
	})

	test('restores the execution action after a wallet submission failure without discarding verification', async () => {
		const provider: InjectedProvider = {
			async request(request) {
				assert.equal(request.method, 'eth_sendTransaction')
				throw new Error('The Interceptor failed to process the transaction')
			},
		}
		let pending = true
		let safeVerified = true
		let submissionAttempted = false
		try {
			submissionAttempted = true
			await submitSafeExecution(provider, 1n, 2n, {
				safeTx: createSafeTx(1n, 2n, { to: 3n, value: 0n, input: new Uint8Array() }, 7n),
				signatures: [],
			})
		} catch {
			if (shouldInvalidateExecutionVerification(submissionAttempted, false)) safeVerified = false
		} finally {
			pending = false
		}

		assert.equal(pending, false)
		assert.equal(safeVerified, true)
		assert.equal(getExecutionDisabledReason({ ...availableExecution, safeVerified }), undefined)
	})

	test('invalidates execution availability when preparation fails before wallet submission', () => {
		const submissionAttempted = false
		let safeVerified = true
		if (shouldInvalidateExecutionVerification(submissionAttempted, false)) safeVerified = false

		assert.equal(safeVerified, false)
		assert.equal(
			getExecutionDisabledReason({ ...availableExecution, safeVerified }),
			'Verify the transaction against current on-chain Gnosis Safe information before executing.',
		)
	})

	test('keeps the stack textarea compact until expansion is requested', () => {
		const textarea = {
			scrollHeight: 768,
			style: { height: '128px' },
		}

		resizeTextareaToContent(textarea, false)

		assert.equal(textarea.style.height, '')

		resizeTextareaToContent(textarea, true)

		assert.equal(textarea.style.height, '768px')
	})

	test('automatically imports changed non-empty JSON without re-importing successful text', () => {
		assert.equal(getSafeStackTextAction('{"name":"stack"}', undefined), 'import')
		assert.equal(getSafeStackTextAction('{"name":"stack"}', '{"name":"stack"}'), 'none')
		assert.equal(getSafeStackTextAction('   ', '{"name":"stack"}'), 'clear')
	})

	test('waits for a selected account before automatically verifying a loaded stack', () => {
		assert.equal(getAutomaticStackVerificationAction(false, undefined), 'no-stack')
		assert.equal(getAutomaticStackVerificationAction(true, undefined), 'await-account')
		assert.equal(getAutomaticStackVerificationAction(true, 1n), 'verify')
	})

	test('persists the current stack and clears it when the input is emptied', () => {
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => { values.set(key, value) },
			removeItem: (key: string) => { values.delete(key) },
		}

		assert.equal(readPersistedSafeStackText(storage), '')
		assert.equal(persistSafeStackText(storage, '{"name":"stack"}'), true)
		assert.equal(values.get(PERSISTED_SAFE_STACK_STORAGE_KEY), '{"name":"stack"}')
		assert.equal(readPersistedSafeStackText(storage), '{"name":"stack"}')
		assert.equal(persistSafeStackText(storage, '  '), true)
		assert.equal(values.has(PERSISTED_SAFE_STACK_STORAGE_KEY), false)
		assert.equal(persistSafeStackText(undefined, '{"name":"stack"}'), false)
		assert.equal(persistSafeStackText({
			getItem: () => null,
			setItem: () => { throw new Error('Storage blocked') },
			removeItem: () => { throw new Error('Storage blocked') },
		}, '{"name":"stack"}'), false)
	})
})
