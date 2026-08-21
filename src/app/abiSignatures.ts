import type { ContractABI } from 'micro-eth-signer/advanced/abi.js'

type AbiInput = ContractABI[number]

function canonicalType(input: AbiInput): string {
	if (!input.type.startsWith('tuple')) return input.type
	const components = input.components ?? []
	return `(${ components.map(canonicalType).join(',') })${ input.type.slice('tuple'.length) }`
}

export function abiFunctionSignatures(abi: ContractABI, names: readonly string[]) {
	const requestedNames = new Set(names)
	return abi.flatMap((entry) => entry.type === 'function' && entry.name !== undefined && requestedNames.has(entry.name)
		? [`${ entry.name }(${ (entry.inputs ?? []).map(canonicalType).join(',') })`]
		: [])
}
