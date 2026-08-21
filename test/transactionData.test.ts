import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { createContract, ERC1155, ERC20, WETH } from 'micro-eth-signer/advanced/abi.js'
import { decodeTransactionData, readIsErc721, readTokenDecimals } from '../src/app/transactionData.js'
import { CUSTOM_PAYMENT_ABI } from '../src/app/abis/customPayment.js'
import { ERC721_SAFE_TRANSFER_WITH_DATA_ABI } from '../src/app/abis/erc721.js'

const destination = 0x1234n

describe('transaction calldata parsing', () => {
	test('decodes ERC-20, ERC-721, ERC-1155, and WETH mint calls', () => {
		const calls = [
			createContract(ERC20).transfer.encodeInput({ to: '0x0000000000000000000000000000000000005678', value: 10n }),
			createContract(ERC721_SAFE_TRANSFER_WITH_DATA_ABI).safeTransferFrom.encodeInput({ from: '0x0000000000000000000000000000000000001234', to: '0x0000000000000000000000000000000000005678', tokenId: 3n, data: new Uint8Array() }),
			createContract(ERC1155).safeTransferFrom.encodeInput({ from: '0x0000000000000000000000000000000000001234', to: '0x0000000000000000000000000000000000005678', id: 3n, amount: 2n, data: new Uint8Array() }),
			createContract(WETH).deposit.encodeInput(),
		]
		assert.deepEqual(calls.map((data) => {
			const result = decodeTransactionData(destination, data)
			return result.status === 'decoded' ? result.call.name : result.status
		}), ['transfer', 'safeTransferFrom', 'safeTransferFrom', 'deposit'])
	})

	test('validates decimals returned by a token contract', async () => {
		const provider = { request: async () => `0x${ '0'.repeat(63) }6` }
		assert.equal(await readTokenDecimals(provider, destination), 6)
	})

	test('decodes both requested payment helper signatures', () => {
		const contract = createContract(CUSTOM_PAYMENT_ABI)
		const tokenAddress = '0x0000000000000000000000000000000000001111'
		const to = '0x0000000000000000000000000000000000002222'
		const feeAddress = '0x0000000000000000000000000000000000003333'
		const calls = [
			contract.transferFromWithReferenceAndFee.encodeInput({ _tokenAddress: tokenAddress, _to: to, _amount: 2n, _paymentReference: new Uint8Array([1, 2]), _feeAmount: 1n, _feeAddress: feeAddress }),
			contract.safeTransferFrom.encodeInput({ _tokenAddress: tokenAddress, _to: to, _amount: 2n }),
		]
		for (const data of calls) assert.equal(decodeTransactionData(destination, data).status, 'decoded')
		const safeTransfer = decodeTransactionData(destination, calls[1]!)
		assert.equal(safeTransfer.status === 'decoded' && Object.hasOwn(safeTransfer.call.arguments ?? {}, '_tokenAddress'), true)
	})

	test('detects ERC-721 through ERC-165 when fungible decimals are absent', async () => {
		const provider = { request: async () => `0x${ '0'.repeat(63) }1` }
		assert.equal(await readIsErc721(provider, destination), true)
	})
})
