import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { readBuildMetadata } from './buildMetadata.mjs'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const sourceDirectory = path.join(repositoryRoot, 'src')
const outputDirectory = path.join(sourceDirectory, 'dist')
const outputJavascriptDirectory = path.join(outputDirectory, 'js')
const outputStylesDirectory = path.join(outputDirectory, 'styles')
const outputAssetsDirectory = path.join(outputDirectory, 'assets')

const { release, commitHash, repositoryUrl } = await readBuildMetadata(repositoryRoot)

await rm(outputDirectory, { recursive: true, force: true })
await Promise.all([
	mkdir(outputJavascriptDirectory, { recursive: true }),
	mkdir(outputStylesDirectory, { recursive: true }),
	mkdir(outputAssetsDirectory, { recursive: true }),
])

const result = await Bun.build({
	entrypoints: [path.join(sourceDirectory, 'app', 'entrypoint.tsx')],
	outdir: outputJavascriptDirectory,
	target: 'browser',
	format: 'esm',
	minify: true,
	sourcemap: 'linked',
	naming: 'main.js',
	define: {
		SEALWORT_BUILD_RELEASE: JSON.stringify(release ?? ''),
		SEALWORT_BUILD_COMMIT_HASH: JSON.stringify(commitHash ?? ''),
		SEALWORT_BUILD_REPOSITORY_URL: JSON.stringify(repositoryUrl ?? ''),
	},
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	throw new Error('Failed to build the Interceptor Safe co-signer application.')
}

await Promise.all([
	copyFile(path.join(sourceDirectory, 'index.html'), path.join(outputDirectory, 'index.html')),
	copyFile(path.join(sourceDirectory, 'styles', 'styles.css'), path.join(outputStylesDirectory, 'styles.css')),
	copyFile(path.join(sourceDirectory, 'assets', 'sealwort-icon.png'), path.join(outputAssetsDirectory, 'sealwort-icon.png')),
	copyFile(path.join(sourceDirectory, 'assets', 'sealwort-botanical.svg'), path.join(outputAssetsDirectory, 'sealwort-botanical.svg')),
	copyFile(path.join(sourceDirectory, '_headers'), path.join(outputDirectory, '_headers')),
])
