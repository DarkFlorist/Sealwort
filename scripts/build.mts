import { copyFile, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { normalizeRepositoryUrl } from './buildMetadata.mjs'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const sourceDirectory = path.join(repositoryRoot, 'src')
const outputDirectory = path.join(sourceDirectory, 'dist')
const outputJavascriptDirectory = path.join(outputDirectory, 'js')
const outputStylesDirectory = path.join(outputDirectory, 'styles')
const outputAssetsDirectory = path.join(outputDirectory, 'assets')

function readGitValue(arguments_: readonly string[]) {
	try {
		return execFileSync('git', arguments_, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
	} catch {
		return undefined
	}
}

const packageMetadata: unknown = await Bun.file(path.join(repositoryRoot, 'package.json')).json()
const packageRepository = typeof packageMetadata === 'object' && packageMetadata !== null && 'repository' in packageMetadata && typeof packageMetadata.repository === 'string'
	? packageMetadata.repository
	: undefined

const release = process.env.SEALWORT_RELEASE?.trim() || readGitValue(['describe', '--tags', '--exact-match'])
const commitHash = process.env.SEALWORT_COMMIT_HASH?.trim() || process.env.GITHUB_SHA?.trim() || readGitValue(['rev-parse', 'HEAD'])
const repositoryUrlSource = process.env.SEALWORT_REPOSITORY_URL?.trim() || readGitValue(['remote', 'get-url', 'origin']) || packageRepository
if (commitHash === undefined || commitHash.length === 0) {
	throw new Error('Build commit information is unavailable. Set SEALWORT_COMMIT_HASH when building outside a Git checkout.')
}
if (repositoryUrlSource === undefined || repositoryUrlSource.length === 0) {
	throw new Error('Build repository information is unavailable. Set SEALWORT_REPOSITORY_URL when building outside a Git checkout.')
}
const repositoryUrl = normalizeRepositoryUrl(repositoryUrlSource)

await rm(outputDirectory, { recursive: true, force: true })
await Promise.all([
	mkdir(outputJavascriptDirectory, { recursive: true }),
	mkdir(outputStylesDirectory, { recursive: true }),
	mkdir(outputAssetsDirectory, { recursive: true }),
])

const result = await Bun.build({
	entrypoints: [path.join(sourceDirectory, 'app', 'bootstrap.tsx')],
	outdir: outputJavascriptDirectory,
	target: 'browser',
	format: 'esm',
	minify: true,
	sourcemap: 'linked',
	naming: 'main.js',
	plugins: [{
		name: 'sealwort-build-metadata',
		setup(builder) {
			builder.onResolve({ filter: /^sealwort:build-metadata$/u }, () => ({ path: 'sealwort:build-metadata', namespace: 'sealwort-build-metadata' }))
			builder.onLoad({ filter: /.*/u, namespace: 'sealwort-build-metadata' }, () => ({
				contents: [
					`export const release = ${ JSON.stringify(release ?? '') }`,
					`export const commitHash = ${ JSON.stringify(commitHash) }`,
					`export const repositoryUrl = ${ JSON.stringify(repositoryUrl) }`,
				].join('\n'),
				loader: 'js',
			}))
		},
	}],
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
