import * as assert from 'assert'
import { describe, test } from 'bun:test'
import { getConnectedSafeWalletDuplicateSignerMessage, getConnectedSafeWalletSigner } from '../src/app/walletCapabilities.js'
import { addressString } from '../src/app/ethereum.js'
import type { InjectedProvider, ProviderRequest } from '../src/app/provider.js'

const safeAddress = 0x1000000000000000000000000000000000000001n
const activeSigner = 0x2000000000000000000000000000000000000002n
const chainId = 11155111n

function createProvider(handler: (request: ProviderRequest) => unknown): InjectedProvider {
	return { request: async (request) => handler(request) }
}

describe('connected Safe wallet capabilities', () => {
	test('matches Interceptor’s wire-level capability request and response', async () => {
		const fixture: { readonly request: ProviderRequest, readonly result: unknown } = JSON.parse(
			await Bun.file(new URL('./fixtures/interceptor-wallet-capabilities.json', import.meta.url)).text(),
		)
		const requests: ProviderRequest[] = []
		const provider = createProvider((request) => {
			requests.push(request)
			return fixture.result
		})

		assert.equal(
			await getConnectedSafeWalletSigner(provider, 0x1616161616161616161616161616161616161616n, 1n),
			0x1717171717171717171717171717171717171717n,
		)
		assert.deepEqual(requests, [fixture.request])
	})

	test('discovers the active execution signer through wallet_getCapabilities', async () => {
		const requests: ProviderRequest[] = []
		const provider = createProvider((request) => {
			requests.push(request)
			return {
				[`0x${ chainId.toString(16) }`]: {
					gnosisSafeExecution: {
						supported: true,
						version: '1.0.0',
						activeSigner: addressString(activeSigner),
						submissionMethod: 'eth_sendTransaction',
					},
				},
			}
		})

		assert.equal(await getConnectedSafeWalletSigner(provider, safeAddress, chainId), activeSigner)
		assert.deepEqual(requests, [{
			method: 'wallet_getCapabilities',
			params: [addressString(safeAddress), [`0x${ chainId.toString(16) }`]],
		}])
	})

	test('treats unsupported and malformed capability replies as unavailable', async () => {
		assert.equal(await getConnectedSafeWalletSigner(createProvider(() => {
			throw new Error('Unsupported method')
		}), safeAddress, chainId), undefined)
		assert.equal(await getConnectedSafeWalletSigner(createProvider(() => ({
			[`0x${ chainId.toString(16) }`]: {
				gnosisSafeExecution: {
					supported: true,
					version: '2.0.0',
					activeSigner: addressString(activeSigner),
					submissionMethod: 'eth_sendTransaction',
				},
			},
		})), safeAddress, chainId), undefined)
	})

	test('explains why an active signer cannot satisfy the threshold twice', () => {
		assert.equal(
			getConnectedSafeWalletDuplicateSignerMessage([activeSigner], activeSigner),
			`The connected Safe wallet’s active signer ${ addressString(activeSigner) } already signed this transaction. Select another active signer in the wallet, then refresh Sealwort.`,
		)
		assert.equal(getConnectedSafeWalletDuplicateSignerMessage([], activeSigner), undefined)
	})
})
