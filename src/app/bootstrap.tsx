import { signal } from '@preact/signals'
import { render } from 'preact'
import { useErrorBoundary } from 'preact/hooks'
import { App } from './main.js'
import { getBuildInformation } from './buildInformation.js'
import { commitHash, release, repositoryUrl } from 'sealwort:build-metadata'

const unexpectedFailure = signal(false)
const buildInformation = getBuildInformation(release, commitHash, repositoryUrl)

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

function AppBoundary() {
	const [renderError] = useErrorBoundary((caughtError) => {
		console.error('Sealwort render failed.', caughtError)
	})
	if (renderError !== undefined || unexpectedFailure.value) return <FailureScreen />
	return <App buildInformation = { buildInformation } />
}

document.documentElement.classList.remove('sealwort-loading')

const app = document.querySelector('#app')
if (app === null) throw new Error('Application root is missing.')
if (window.top !== window.self) {
	render(<FailureScreen embedded = { true } />, app)
} else {
	window.addEventListener('error', (event) => {
		if (event.error === undefined) return
		console.error('Unexpected Sealwort error.', event.error)
		unexpectedFailure.value = true
	})
	window.addEventListener('unhandledrejection', (event) => {
		event.preventDefault()
		console.error('Unhandled Sealwort promise rejection.', event.reason)
		unexpectedFailure.value = true
	})
	render(<AppBoundary />, app)
}
