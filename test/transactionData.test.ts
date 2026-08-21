import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { CONTRACTS, createContract, ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { getAddressLabel } from '../src/app/addressLabels.js'
import { ContractMetadataUnavailableError, readIsErc721, readTokenDecimals, readVaultAsset } from '../src/app/contractMetadata.js'
import { decodeTransactionData } from '../src/app/transactionDecoder.js'
import { amountTokenForArgument, amountTokenReferences, argumentLabel, resolveTransactionInterpretation, transactionNeedsErc721Resolution, transactionValuePresentation } from '../src/app/transactionSemantics.js'
import { CUSTOM_PAYMENT_ABI } from '../src/app/abis/customPayment.js'
import { ERC2612_ABI } from '../src/app/abis/erc2612.js'
import { ERC4626_ABI } from '../src/app/abis/erc4626.js'
import { ERC7540_ABI } from '../src/app/abis/erc7540.js'
import { ERC721_SAFE_TRANSFER_WITH_DATA_ABI } from '../src/app/abis/erc721.js'
import { METAMASK_SWAP_ROUTER_ABI } from '../src/app/abis/metaMaskSwapRouter.js'
import { getChainConfiguration } from '../src/app/chainConfiguration.js'
import { MAINNET_ADDRESS_BOUND_TRANSACTION_ABIS } from '../src/app/transactionRegistry.js'
import { abiFunctionSignatures } from '../src/app/abiSignatures.js'
import { MAINNET_METAMASK_SWAP_ROUTER_ADDRESS } from '../src/app/transactionDefinitions.js'

const destination = 0x1234n
const firstAddress = '0x0000000000000000000000000000000000001111'
const secondAddress = '0x0000000000000000000000000000000000002222'

function encodedV3Path(tokens: readonly string[]) {
	const hex = tokens.map((token, index) => `${ index === 0 ? '' : '000bb8' }${ token.slice(2) }`).join('')
	return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16))
}

function mainnetMetaMaskSwapRouterAddress() {
	return MAINNET_METAMASK_SWAP_ROUTER_ADDRESS
}

type AbiInput = { readonly name?: string, readonly type: string, readonly components?: readonly AbiInput[] }

function inputValue(input: AbiInput): unknown {
	if (input.type.endsWith('[]')) return [inputValue({ ...input, type: input.type.slice(0, -2) })]
	if (input.type === 'tuple') return Object.fromEntries((input.components ?? []).map((component, index) => [component.name ?? index.toString(), inputValue(component)]))
	if (input.type === 'address') return firstAddress
	if (input.type === 'bool') return false
	if (input.type === 'string') return 'test'
	if (input.type === 'bytes') return new Uint8Array([1])
	if (/^bytes\d+$/u.test(input.type)) return new Uint8Array(Number(input.type.slice(5)))
	if (/^u?int\d*$/u.test(input.type)) return 1n
	throw new Error(`Unsupported test ABI input ${ input.type }`)
}

function functionSignature(entry: { readonly name?: string, readonly inputs?: readonly AbiInput[] }) {
	const typeName = (input: AbiInput): string => input.type === 'tuple' ? `(${ (input.components ?? []).map(typeName).join(',') })` : input.type
	return `${ entry.name ?? 'function' }(${ (entry.inputs ?? []).map(typeName).join(',') })`
}

function encodedFunctionCalls(abi: ContractABI) {
	const functions = abi.filter((entry) => entry.type === 'function')
	const counts = new Map<string, number>()
	for (const entry of functions) counts.set(entry.name ?? 'function', (counts.get(entry.name ?? 'function') ?? 0) + 1)
	const contract = createContract(abi) as unknown as Record<string, { encodeInput(value?: unknown): Uint8Array }>
	return functions.map((entry) => {
		const name = entry.name ?? 'function'
		const method = contract[(counts.get(name) ?? 0) > 1 ? functionSignature(entry) : name]
		assert.ok(method !== undefined)
		const inputs = (entry.inputs ?? []) as readonly AbiInput[]
		const value = inputs.length === 0
			? undefined
			: inputs.length === 1
				? inputValue(inputs[0]!)
				: inputs.every(({ name }) => name !== undefined && name.length > 0)
					? Object.fromEntries(inputs.map((input) => [input.name!, inputValue(input)]))
					: inputs.map(inputValue)
		return { name, data: method.encodeInput(value) }
	})
}

describe('transaction calldata parsing', () => {
	test('derives canonical semantic keys from ABI function and tuple declarations', () => {
		const abi = [{
			type: 'function',
			name: 'route',
			inputs: [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
		}] as const
		assert.deepEqual(abiFunctionSignatures(abi, ['route']), ['route((address,uint256)[])'])
		assert.equal(argumentLabel('newAmountField', false), 'New amount field')
	})

	test('decodes ERC-20, ERC-721, ERC-1155, and WETH mint calls', () => {
		const calls = [
			createContract(ERC20).transfer.encodeInput({ to: '0x0000000000000000000000000000000000005678', value: 10n }),
			createContract(ERC721_SAFE_TRANSFER_WITH_DATA_ABI).safeTransferFrom.encodeInput({ from: '0x0000000000000000000000000000000000001234', to: '0x0000000000000000000000000000000000005678', tokenId: 3n, data: new Uint8Array() }),
			createContract(ERC1155).safeTransferFrom.encodeInput({ from: '0x0000000000000000000000000000000000001234', to: '0x0000000000000000000000000000000000005678', id: 3n, amount: 2n, data: new Uint8Array() }),
			createContract(WETH).deposit.encodeInput(),
		]
		assert.deepEqual(calls.map((data) => {
			const result = decodeTransactionData(1n, destination, data)
			return result.status === 'decoded' ? result.call.name : result.status
		}), ['transfer', 'safeTransferFrom', 'safeTransferFrom', 'deposit'])
	})

	test('validates decimals returned by a token contract', async () => {
		const provider = { request: async () => `0x${ '0'.repeat(63) }6` }
		assert.equal(await readTokenDecimals(provider, destination), 6)
		await assert.rejects(readTokenDecimals({ request: async () => '0x' }, destination), ContractMetadataUnavailableError)
		await assert.rejects(readTokenDecimals({ request: async () => { throw new Error('execution reverted') } }, destination), ContractMetadataUnavailableError)
		const unexpected = new Error('Unexpected provider implementation failure.')
		await assert.rejects(readTokenDecimals({ request: async () => { throw unexpected } }, destination), (error) => error === unexpected)
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
		for (const data of calls) assert.equal(decodeTransactionData(1n, destination, data).status, 'decoded')
		const safeTransfer = decodeTransactionData(1n, destination, calls[1]!)
		assert.equal(transactionNeedsErc721Resolution(safeTransfer), true)
		const resolved = resolveTransactionInterpretation(safeTransfer, false)
		assert.equal(resolved.status === 'decoded' && Object.hasOwn(resolved.call.arguments ?? {}, '_tokenAddress'), true)
	})

	test('resolves the shared safeTransferFrom selector without depending on ABI order', () => {
		const erc721 = createContract(ERC721) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const data = erc721['safeTransferFrom(address,address,uint256)']!.encodeInput({ from: firstAddress, to: secondAddress, tokenId: 42n })
		const decoded = decodeTransactionData(1n, destination, data)
		assert.equal(decoded.status, 'decoded')
		if (decoded.status !== 'decoded') return
		const erc721Resolution = resolveTransactionInterpretation(decoded, true)
		const helper = resolveTransactionInterpretation(decoded, false)
		assert.deepEqual(erc721Resolution.status === 'decoded' ? erc721Resolution.call.arguments : undefined, { from: firstAddress, to: secondAddress, tokenId: 42n })
		assert.deepEqual(helper.status === 'decoded' ? helper.call.arguments : undefined, { _tokenAddress: firstAddress, _to: secondAddress, _amount: 42n })
	})

	test('detects ERC-721 through ERC-165 when fungible decimals are absent', async () => {
		const provider = { request: async () => `0x${ '0'.repeat(63) }1` }
		assert.equal(await readIsErc721(provider, destination), true)
	})

	test('decodes every function in the address-bound router ABIs', () => {
		for (const [address, abi] of Object.entries(MAINNET_ADDRESS_BOUND_TRANSACTION_ABIS)) {
			for (const { name, data } of encodedFunctionCalls(abi)) {
				const decoded = decodeTransactionData(1n, BigInt(address), data)
				assert.equal(decoded.status, 'decoded', `${ name } at ${ address }`)
			}
		}
	})

	test('decodes ERC-2612, ERC-4626, and ERC-7540 calls at arbitrary destinations', () => {
		for (const abi of [ERC2612_ABI, ERC4626_ABI, ERC7540_ABI]) {
			for (const { name, data } of encodedFunctionCalls(abi)) {
				const decoded = decodeTransactionData(1n, destination, data)
				assert.equal(decoded.status, 'decoded', name)
			}
		}
	})

	test('associates swap, vault, permit, and aggregator amounts with their tokens', () => {
		const v2Address = Object.entries(CONTRACTS).find(([, contract]) => contract.name === 'UNISWAP V2 ROUTER')?.[0]
		assert.ok(v2Address !== undefined)
		const v2 = createContract(CONTRACTS[v2Address]!.abi as ContractABI) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const swap = decodeTransactionData(1n, BigInt(v2Address), v2.swapExactTokensForTokens!.encodeInput({ amountIn: 100n, amountOutMin: 90n, path: [firstAddress, secondAddress], to: secondAddress, deadline: 1n }))
		assert.deepEqual(swap.status === 'decoded' ? amountTokenReferences(swap.call) : [], [BigInt(firstAddress), BigInt(secondAddress)])

		const vault = createContract(ERC4626_ABI)
		const deposit = decodeTransactionData(1n, destination, vault.deposit.encodeInput({ assets: 100n, receiver: secondAddress }))
		assert.deepEqual(deposit.status === 'decoded' ? amountTokenReferences(deposit.call) : [], ['vaultAsset'])
		const mint = decodeTransactionData(1n, destination, vault.mint.encodeInput({ shares: 100n, receiver: secondAddress }))
		assert.deepEqual(mint.status === 'decoded' ? amountTokenReferences(mint.call) : [], ['destination'])

		const permit = createContract(ERC2612_ABI).permit.encodeInput({ owner: firstAddress, spender: secondAddress, value: 100n, deadline: 1n, v: 1n, r: new Uint8Array(32), s: new Uint8Array(32) })
		const decodedPermit = decodeTransactionData(1n, destination, permit)
		assert.deepEqual(decodedPermit.status === 'decoded' ? amountTokenReferences(decodedPermit.call) : [], ['destination'])

		const metaMask = createContract(METAMASK_SWAP_ROUTER_ABI).swap.encodeInput({ aggregatorId: 'test', tokenFrom: firstAddress, amount: 100n, data: new Uint8Array() })
		const decodedMetaMask = decodeTransactionData(1n, mainnetMetaMaskSwapRouterAddress(), metaMask)
		assert.deepEqual(decodedMetaMask.status === 'decoded' ? amountTokenReferences(decodedMetaMask.call) : [], [BigInt(firstAddress)])

		const kyberAddress = Object.entries(CONTRACTS).find(([, contract]) => contract.name === 'KYBER NETWORK PROXY')?.[0]
		assert.ok(kyberAddress !== undefined)
		const kyber = createContract(CONTRACTS[kyberAddress]!.abi as ContractABI) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const nativeAsset = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
		const trade = decodeTransactionData(1n, BigInt(kyberAddress), kyber.trade!.encodeInput({ src: firstAddress, srcAmount: 100n, dest: nativeAsset, destAddress: secondAddress, maxDestAmount: 90n, minConversionRate: 1n, platformWallet: secondAddress }))
		assert.deepEqual(trade.status === 'decoded' ? amountTokenReferences(trade.call) : [], [BigInt(firstAddress), 'native'])
	})

	test('uses Uniswap V3 exact-output paths in their required reversed encoding', () => {
		const v3Address = Object.entries(CONTRACTS).find(([, contract]) => contract.name === 'UNISWAP V3 ROUTER')?.[0]
		assert.ok(v3Address !== undefined)
		const router = createContract(CONTRACTS[v3Address]!.abi as ContractABI) as unknown as Record<string, { encodeInput(value: unknown): Uint8Array }>
		const middle = '0x0000000000000000000000000000000000003333'
		const exactOutput = router.exactOutput!.encodeInput({
			path: encodedV3Path([secondAddress, middle, firstAddress]),
			recipient: secondAddress,
			deadline: 1n,
			amountOut: 90n,
			amountInMaximum: 100n,
		})
		const decoded = decodeTransactionData(1n, BigInt(v3Address), exactOutput)
		assert.deepEqual(decoded.status === 'decoded' ? amountTokenReferences(decoded.call) : [], [BigInt(secondAddress), BigInt(firstAddress)])

		const multicall = router.multicall!.encodeInput([exactOutput])
		const nested = decodeTransactionData(1n, BigInt(v3Address), multicall)
		assert.deepEqual(nested.status === 'decoded' ? amountTokenReferences(nested.call) : [], [BigInt(secondAddress), BigInt(firstAddress)])
	})

	test('does not infer token semantics from unrelated argument-name substrings', () => {
		const call = { name: 'unrelated', signature: 'unrelated(uint256,uint256)', arguments: { amountETH: 1n, amountIn: 2n } }
		assert.equal(amountTokenForArgument(call, 'amountETH', call.arguments), undefined)
		assert.equal(amountTokenForArgument(call, 'amountIn', call.arguments), undefined)
	})

	test('keeps address-bound router ABIs and labels on their deployment chain', () => {
		const data = createContract(METAMASK_SWAP_ROUTER_ABI).swap.encodeInput({ aggregatorId: 'test', tokenFrom: firstAddress, amount: 100n, data: new Uint8Array() })
		const address = mainnetMetaMaskSwapRouterAddress()
		assert.equal(decodeTransactionData(1n, address, data).status, 'decoded')
		assert.equal(decodeTransactionData(11155111n, address, data).status, 'unknown')
		assert.equal(getAddressLabel(address, 1n), 'MetaMask Swap Router')
		assert.equal(getAddressLabel(address, 11155111n), undefined)
	})

	test('sources WETH deposit value presentation from the function registry', () => {
		const decoded = decodeTransactionData(1n, destination, createContract(WETH).deposit.encodeInput())
		assert.deepEqual(decoded.status === 'decoded' ? transactionValuePresentation(decoded.call) : undefined, {
			label: 'Amount', decimals: 18, token: 'destination', fallbackSymbol: 'WETH',
		})
	})

	test('reads a vault asset through its ABI', async () => {
		const provider = { request: async () => `0x${ secondAddress.slice(2).padStart(64, '0') }` }
		assert.equal(await readVaultAsset(provider, destination), BigInt(secondAddress))
	})

	test('labels every ERC-20 included in the decoder registry', () => {
		const expectedTokens = ['UNI', 'BAT', 'USDT', 'USDC', 'WETH', 'WBTC', 'DAI', 'COMP', 'MKR', 'AMPL']
		assert.deepEqual(getChainConfiguration(1n).tokens.map(({ symbol }) => symbol), expectedTokens)
		for (const { address, symbol } of getChainConfiguration(1n).tokens) assert.equal(getAddressLabel(address, 1n), symbol)
	})
})
