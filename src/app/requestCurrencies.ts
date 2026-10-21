export type RequestCurrency = { readonly currency: string, readonly decimals: number }

// Request's getHash hashes the lowercase, sorted storage currency JSON and takes
// the last 20 bytes. These are currency identifiers, not ERC-20 contracts.
// https://github.com/RequestNetwork/requestNetwork/blob/e7a48e42d55d96f6dbc947895e0677df28942736/packages/currency/src/getHash.ts
// ChainlinkConversionPath uses FIAT_DECIMALS = 8, independently of ISO 4217 digits.
// https://github.com/RequestNetwork/requestNetwork/blob/e7a48e42d55d96f6dbc947895e0677df28942736/packages/smart-contracts/src/contracts/ChainlinkConversionPath.sol
const REQUEST_CURRENCIES: Readonly<Record<string, RequestCurrency>> = {
	'775eb53d00dd0acd3ec1696472105d579b9b386b': { currency: 'USD', decimals: 8 },
}

export function getRequestCurrency(address: bigint) {
	return REQUEST_CURRENCIES[address.toString(16)]
}
