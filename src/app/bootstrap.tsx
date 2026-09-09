import { render } from 'preact'
import { useErrorBoundary } from 'preact/hooks'
import { App } from './main.js'
import type { BuildInformation } from './buildInformation.js'
import { reportUnexpectedFailure, unexpectedFailure } from './unexpectedFailure.js'

function getRejectionMessage(reason: unknown) {
	if (typeof reason !== 'object' || reason === null || !('message' in reason)) return undefined
	return typeof reason.message === 'string' ? reason.message : undefined
}

function isMissingMetaMaskRejection(reason: unknown) {
	const message = getRejectionMessage(reason)
	if (message === 'MetaMask extension not found') return true
	if (message !== 'Failed to connect to MetaMask' || typeof reason !== 'object' || reason === null || !('cause' in reason)) return false
	return getRejectionMessage(reason.cause) === 'MetaMask extension not found'
}

function FailureScreen({ embedded = false }: { readonly embedded?: boolean }) {
	return <main class = 'shell'>
		<section class = 'panel failure-panel' role = 'alert'>
			<p class = 'eyebrow'>Sealwort</p>
			<h1>{ embedded ? 'Open Sealwort in its own tab' : 'Sealwort encountered an unexpected error' }</h1>
			<p class = 'muted'>
				{ embedded
					? 'For your safety, the Gnosis Safe co-signer is available only as a top-level page.'
					: 'Reload the page and re-import the latest Gnosis Safe Stack before continuing.' }
			</p>
			{ embedded ? <></> : <button onClick = { () => { window.location.reload() } }>Reload Sealwort</button> }
		</section>
	</main>
}

function AppBoundary({ buildInformation }: { readonly buildInformation: BuildInformation | undefined }) {
	const [renderError] = useErrorBoundary((caughtError) => {
		console.error('Sealwort render failed.', caughtError)
	})
	if (renderError !== undefined || unexpectedFailure.value) return <FailureScreen />
	return buildInformation === undefined ? <App /> : <App buildInformation = { buildInformation } />
}

export function bootstrapApplication(buildInformation: BuildInformation | undefined) {
	document.documentElement.classList.remove('sealwort-loading')

	const app = document.querySelector('#app')
	if (app === null) throw new Error('Application root is missing.')
	if (window.top !== window.self) {
		render(<FailureScreen embedded = { true } />, app)
	} else {
		window.addEventListener('error', (event) => {
			if (event.error === undefined) return
			reportUnexpectedFailure(event.error)
		})
		window.addEventListener('unhandledrejection', (event) => {
			if (isMissingMetaMaskRejection(event.reason)) return
			event.preventDefault()
			reportUnexpectedFailure(event.reason)
		})
		render(<AppBoundary buildInformation = { buildInformation } />, app)
	}
}
