import type { Signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { SubmittedExecution, TransactionActionError } from './appTypes.js'
import { ensureHex } from './ethereum.js'
import { readSafeExecutionReceipt } from './safeExecution.js'
import { confirmSubmittedExecution, isPendingExecution, markSubmittedExecutionUnconfirmed, removeSubmittedExecution, setTransactionActionError } from './transactionActionState.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { withWalletRequestTimeout } from './walletProvider.js'
import { runBackgroundTask } from './backgroundTasks.js'
import { reportUnexpectedFailure } from './unexpectedFailure.js'

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

		const isStillPending = (expected: SubmittedExecution) => !controller.signal.aborted && isPendingExecution(submittedExecutions, expected)

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
							removeSubmittedExecution(submittedExecutions, execution)
							setTransactionActionError(transactionActionErrors, execution.safeTxHash, `The execution transaction failed in block ${ receipt.blockNumber.toString() }.`)
							return
						}
						confirmSubmittedExecution(submittedExecutions, execution, receipt.blockNumber)
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
			markSubmittedExecutionUnconfirmed(submittedExecutions, execution)
			const providerDetail = lastProviderError === undefined ? '' : ` Last provider error: ${ getUserFacingErrorMessage(lastProviderError) }`
			setTransactionActionError(transactionActionErrors, execution.safeTxHash, `Sealwort stopped checking before this execution receipt was confirmed.${ providerDetail } Refresh to check its on-chain state before trying again.`)
		}

		runBackgroundTask(Promise.all(pendingExecutions.map(async (execution) => await monitor(execution))), reportUnexpectedFailure)
		return () => { controller.abort() }
	}, [currentExecutions, initialDelayMs, maximumDelayMs, pollingTimeoutMs, transactionActionErrors, submittedExecutions, walletRequestTimeoutMs])
}
