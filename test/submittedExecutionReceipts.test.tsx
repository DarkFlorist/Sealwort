import * as assert from 'node:assert'
import { signal, type Signal } from '@preact/signals'
import { afterEach, describe, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import type { SubmittedExecution, TransactionActionError } from '../src/app/appTypes.js'
import type { InjectedProvider } from '../src/app/safeStackValidation.js'
import { type ReceiptPollingOptions, useSubmittedExecutionReceipts } from '../src/app/useSubmittedExecutionReceipts.js'

const transactionHash = `0x${ '1'.repeat(64) }`

function ReceiptHarness({
	executions,
	errors,
	status,
	pollingOptions,
}: {
	readonly executions: Signal<readonly SubmittedExecution[]>
	readonly errors: Signal<readonly TransactionActionError[]>
	readonly status: Signal<string | undefined>
	readonly pollingOptions?: ReceiptPollingOptions
}) {
	useSubmittedExecutionReceipts(executions, errors, status, 5_000, pollingOptions)
	return <>
		<p>{ status.value }</p>
		<p>{ executions.value.map(({ status: executionStatus }) => executionStatus).join(',') }</p>
		<p>{ errors.value.map(({ message }) => message).join(',') }</p>
	</>
}

function pendingExecution(): SubmittedExecution {
	return {
		safeTxHash: 1n,
		transactionHash,
		status: 'pending',
		submittedStatus: 'Transaction A submitted',
	}
}

afterEach(() => {
	cleanup()
	delete window.ethereum
})

describe('submitted execution receipt monitoring', () => {
	test('does not overwrite a newer global status when an earlier receipt arrives', async () => {
		let resolveReceipt: (receipt: unknown) => void = () => undefined
		let receiptRequested = false
		const receiptResult = new Promise<unknown>((resolve) => { resolveReceipt = resolve })
		window.ethereum = { async request() {
			receiptRequested = true
			return await receiptResult
		} } satisfies InjectedProvider
		const executions = signal<readonly SubmittedExecution[]>([pendingExecution()])
		const errors = signal<readonly TransactionActionError[]>([])
		const status = signal<string | undefined>('Transaction A submitted')
		const { container } = render(<ReceiptHarness executions = { executions } errors = { errors } status = { status } />)

		await waitFor(() => assert.equal(receiptRequested, true))
		status.value = 'Transaction B submitted'
		resolveReceipt({ status: '0x1', blockNumber: '0x123' })

		await receiptResult
		await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
		assert.match(container.textContent, /confirmed/u)
		assert.equal(status.value, 'Transaction B submitted')
		assert.equal(screen.queryByText(/included in block/u), null)
	})

	test('stops polling after its bounded confirmation window', async () => {
		let receiptRequests = 0
		window.ethereum = { async request() {
			receiptRequests += 1
			return null
		} } satisfies InjectedProvider
		const executions = signal<readonly SubmittedExecution[]>([pendingExecution()])
		const errors = signal<readonly TransactionActionError[]>([])
		const status = signal<string | undefined>('Transaction A submitted')
		render(<ReceiptHarness
			executions = { executions }
			errors = { errors }
			status = { status }
			pollingOptions = { { initialDelayMs: 1, maximumDelayMs: 2, timeoutMs: 5 } }
		/>)

		await screen.findByText('unconfirmed')
		assert.match(errors.value[0]?.message ?? '', /stopped checking before this execution receipt was confirmed/u)
		const requestsAtTimeout = receiptRequests
		await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
		assert.equal(receiptRequests, requestsAtTimeout)
	})
})
