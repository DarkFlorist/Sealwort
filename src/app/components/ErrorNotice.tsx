import type { TransactionDataMetadata } from '../useTransactionDataMetadata.js'

export function ErrorNotice({ error, transactionDataMetadata }: {
	readonly error?: string | undefined
	readonly transactionDataMetadata: TransactionDataMetadata
}) {
	const metadataErrors = transactionDataMetadata.flatMap((stack) => stack.flatMap(({ metadata }) => {
		if (metadata.status === 'failed') return [metadata.message]
		if (metadata.status !== 'ready') return []
		return [
			...(metadata.vaultAssetError === undefined ? [] : [metadata.vaultAssetError]),
			...Object.values(metadata.tokens).flatMap((token) => token.status === 'error' ? [token.message] : []),
		]
	}))
	const messages = [...new Set([...(error === undefined ? [] : [error]), ...metadataErrors])]
	if (messages.length === 0) return <></>
	return <div class = 'notice' role = 'alert'>
		{ metadataErrors.length === 0 ? <></> : <p>Some transaction amounts are shown in base units because token metadata could not be read.</p> }
		{ messages.map((message) => <p key = { message }>{ message }</p>) }
	</div>
}
