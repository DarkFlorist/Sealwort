import type { Signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { SubmittedExecution, TransactionActionError } from './appTypes.js'
import { ensureHex } from './ethereum.js'
import { readSafeExecutionReceipt } from './safeExecution.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { withWalletRequestTimeout } from './walletProvider.js'

const INITIAL_RECEIPT_POLL_DELAY_MS = 1_000
const MAX_RECEIPT_POLL_DELAY_MS = 10_000
const RECEIPT_POLL_TIMEOUT_MS = 15 * 60 * 1_000

export type ReceiptPollingOptions = {
	readonly initialDelayMs?: number
	readonly maximumDelayMs?: number
	readonly timeoutMs?: number
}

function waitForNextReceiptPoll(signal: AbortSignal, delayMs: number) {
	return new Promise<void>((resolve) => {
		if (signal.aborted) {
			resolve()
			return
		}
		const finish = () => {
			globalThis.clearTimeout(timeout)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timeout = globalThis.setTimeout(finish, delayMs)
		signal.addEventListener('abort', finish, { once: true })
	})
}

export function useSubmittedExecutionReceipts(
	submittedExecutions: Signal<readonly SubmittedExecution[]>,
	transactionActionErrors: Signal<readonly TransactionActionError[]>,
	status: Signal<string | undefined>,
	walletRequestTimeoutMs?: number,
	pollingOptions: ReceiptPollingOptions = {},
) {
	const currentExecutions = submittedExecutions.value
	const initialDelayMs = pollingOptions.initialDelayMs ?? INITIAL_RECEIPT_POLL_DELAY_MS
	const maximumDelayMs = pollingOptions.maximumDelayMs ?? MAX_RECEIPT_POLL_DELAY_MS
	const pollingTimeoutMs = pollingOptions.timeoutMs ?? RECEIPT_POLL_TIMEOUT_MS

	useEffect(() => {
		const pendingExecutions = currentExecutions.filter((execution) => execution.status === 'pending')
		const injectedProvider = window.ethereum
		if (pendingExecutions.length === 0 || injectedProvider === undefined) return
		const provider = withWalletRequestTimeout(injectedProvider, walletRequestTimeoutMs)
		const controller = new AbortController()

		const isStillPending = (expected: SubmittedExecution) => !controller.signal.aborted
			&& submittedExecutions.peek().some((execution) => execution.safeTxHash === expected.safeTxHash
				&& execution.transactionHash === expected.transactionHash
				&& execution.status === 'pending')

		const setActionError = (safeTxHash: bigint, message: string) => {
			transactionActionErrors.value = [
				...transactionActionErrors.peek().filter((entry) => entry.safeTxHash !== safeTxHash),
				{ safeTxHash, message },
			]
		}

		const monitor = async (execution: SubmittedExecution) => {
			const startedAt = Date.now()
			let pollDelayMs = initialDelayMs
			let lastProviderError: unknown
			while (isStillPending(execution) && Date.now() - startedAt < pollingTimeoutMs) {
				try {
					const receipt = await readSafeExecutionReceipt(provider, ensureHex(execution.transactionHash, 'submitted execution transaction hash'))
					if (!isStillPending(execution)) return
					if (receipt !== undefined) {
						if (!receipt.succeeded) {
							submittedExecutions.value = submittedExecutions.peek().filter((entry) => entry.safeTxHash !== execution.safeTxHash || entry.transactionHash !== execution.transactionHash)
							setActionError(execution.safeTxHash, `The execution transaction failed in block ${ receipt.blockNumber.toString() }.`)
							if (status.peek() === execution.submittedStatus) status.value = execution.signatureStatus
							return
						}
						submittedExecutions.value = submittedExecutions.peek().map((entry) => entry.safeTxHash === execution.safeTxHash && entry.transactionHash === execution.transactionHash
							? { ...entry, status: 'confirmed' }
							: entry)
						if (status.peek() === execution.submittedStatus) {
							status.value = `${ execution.signatureStatus === undefined ? '' : `${ execution.signatureStatus } ` }Gnosis Safe execution transaction included in block ${ receipt.blockNumber.toString() }: ${ execution.transactionHash }`
						}
						return
					}
					lastProviderError = undefined
				} catch (providerError) {
					lastProviderError = providerError
				}
				await waitForNextReceiptPoll(controller.signal, pollDelayMs)
				pollDelayMs = Math.min(pollDelayMs * 2, maximumDelayMs)
			}
			if (!isStillPending(execution)) return
			submittedExecutions.value = submittedExecutions.peek().map((entry) => entry.safeTxHash === execution.safeTxHash && entry.transactionHash === execution.transactionHash
				? { ...entry, status: 'unconfirmed' }
				: entry)
			const providerDetail = lastProviderError === undefined ? '' : ` Last provider error: ${ getUserFacingErrorMessage(lastProviderError) }`
			setActionError(execution.safeTxHash, `Sealwort stopped checking before this execution receipt was confirmed.${ providerDetail } Refresh to check its on-chain state before trying again.`)
			if (status.peek() === execution.submittedStatus) status.value = execution.signatureStatus
		}

		void Promise.all(pendingExecutions.map(async (execution) => await monitor(execution)))
		return () => { controller.abort() }
	}, [currentExecutions, initialDelayMs, maximumDelayMs, pollingTimeoutMs, transactionActionErrors, status, submittedExecutions, walletRequestTimeoutMs])
}
