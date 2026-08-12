import type { Signal } from '@preact/signals'
import type { SubmittedExecution, TransactionActionError } from './appTypes.js'

export function clearTransactionActionError(
	errors: Signal<readonly TransactionActionError[]>,
	safeTxHash: bigint,
) {
	errors.value = errors.peek().filter((entry) => entry.safeTxHash !== safeTxHash)
}

export function setTransactionActionError(
	errors: Signal<readonly TransactionActionError[]>,
	safeTxHash: bigint,
	message: string,
) {
	errors.value = [
		...errors.peek().filter((entry) => entry.safeTxHash !== safeTxHash),
		{ safeTxHash, message },
	]
}

export function recordSubmittedExecution(
	executions: Signal<readonly SubmittedExecution[]>,
	safeTxHash: bigint,
	transactionHash: string,
) {
	executions.value = [
		...executions.peek().filter((execution) => execution.safeTxHash !== safeTxHash),
		{ safeTxHash, transactionHash, status: 'pending' },
	]
}

export function hasSubmittedExecution(executions: Signal<readonly SubmittedExecution[]>, safeTxHash: bigint) {
	return executions.peek().some((execution) => execution.safeTxHash === safeTxHash)
}

export function isPendingExecution(
	executions: Signal<readonly SubmittedExecution[]>,
	expected: Pick<SubmittedExecution, 'safeTxHash' | 'transactionHash'>,
) {
	return executions.peek().some((execution) => execution.safeTxHash === expected.safeTxHash
		&& execution.transactionHash === expected.transactionHash
		&& execution.status === 'pending')
}

export function confirmSubmittedExecution(
	executions: Signal<readonly SubmittedExecution[]>,
	expected: Pick<SubmittedExecution, 'safeTxHash' | 'transactionHash'>,
	blockNumber: bigint,
) {
	executions.value = executions.peek().map((execution): SubmittedExecution => execution.safeTxHash === expected.safeTxHash
		&& execution.transactionHash === expected.transactionHash
		&& execution.status === 'pending'
		? { safeTxHash: execution.safeTxHash, transactionHash: execution.transactionHash, status: 'confirmed', blockNumber }
		: execution)
}

export function markSubmittedExecutionUnconfirmed(
	executions: Signal<readonly SubmittedExecution[]>,
	expected: Pick<SubmittedExecution, 'safeTxHash' | 'transactionHash'>,
) {
	executions.value = executions.peek().map((execution): SubmittedExecution => execution.safeTxHash === expected.safeTxHash
		&& execution.transactionHash === expected.transactionHash
		&& execution.status === 'pending'
		? { safeTxHash: execution.safeTxHash, transactionHash: execution.transactionHash, status: 'unconfirmed' }
		: execution)
}

export function removeSubmittedExecution(
	executions: Signal<readonly SubmittedExecution[]>,
	expected: Pick<SubmittedExecution, 'safeTxHash' | 'transactionHash'>,
) {
	executions.value = executions.peek().filter((execution) => execution.safeTxHash !== expected.safeTxHash
		|| execution.transactionHash !== expected.transactionHash)
}
