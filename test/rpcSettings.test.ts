import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import {
	DEFAULT_ETHEREUM_RPC_URL,
	PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY,
	getEthereumRpcHost,
	persistEthereumRpcUrl,
	readPersistedEthereumRpcUrl,
	validateEthereumRpcUrl,
} from '../src/app/rpcSettings.js'

function memoryStorage(initialValue?: string) {
	const values = new Map<string, string>()
	if (initialValue !== undefined) values.set(PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY, initialValue)
	return {
		storage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => { values.set(key, value) },
			removeItem: (key: string) => { values.delete(key) },
		},
		values,
	}
}

describe('Ethereum RPC settings', () => {
	test('uses the Dark Florist endpoint by default and labels endpoints without exposing their paths', () => {
		assert.equal(readPersistedEthereumRpcUrl(undefined), DEFAULT_ETHEREUM_RPC_URL)
		assert.equal(getEthereumRpcHost('https://rpc.example.test/private-key?token=secret'), 'rpc.example.test')
	})

	test('accepts HTTPS endpoints while rejecting unsafe or ambiguous URLs', () => {
		assert.equal(validateEthereumRpcUrl('  https://rpc.example.test/v1/key  '), 'https://rpc.example.test/v1/key')
		assert.throws(() => validateEthereumRpcUrl('https://?token=abc'), /valid Ethereum RPC URL|include a host/u)
		assert.throws(() => validateEthereumRpcUrl('https://:443'), /valid Ethereum RPC URL|include a host/u)
		assert.throws(() => validateEthereumRpcUrl('http://rpc.example.test'), /must use HTTPS/u)
		assert.throws(() => validateEthereumRpcUrl('https://user:secret@rpc.example.test'), /embedded credentials/u)
		assert.throws(() => validateEthereumRpcUrl('https://rpc.example.test/#configuration'), /fragment/u)
		assert.throws(() => validateEthereumRpcUrl('not a URL'), /valid Ethereum RPC URL/u)
	})

	test('persists custom endpoints, removes the default override, and ignores invalid stored values', () => {
		const { storage, values } = memoryStorage()
		assert.equal(persistEthereumRpcUrl(storage, 'https://rpc.example.test'), true)
		assert.equal(readPersistedEthereumRpcUrl(storage), 'https://rpc.example.test')
		assert.equal(persistEthereumRpcUrl(storage, DEFAULT_ETHEREUM_RPC_URL), true)
		assert.equal(values.has(PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY), false)

		const invalid = memoryStorage('javascript:alert(1)')
		assert.equal(readPersistedEthereumRpcUrl(invalid.storage), DEFAULT_ETHEREUM_RPC_URL)
	})
})
