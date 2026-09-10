import * as assert from 'node:assert'
import { test } from 'bun:test'
import { getTransactionExplorerUrl } from '../src/app/explorerLinks.js'

test('formats registered transaction explorer links', () => {
	assert.equal(getTransactionExplorerUrl(1n, '0x1234'), 'https://etherscan.io/tx/0x1234')
	assert.equal(getTransactionExplorerUrl(11155111n, '0x1234'), 'https://sepolia.etherscan.io/tx/0x1234')
	assert.equal(getTransactionExplorerUrl(10n, '0x1234'), undefined)
})
