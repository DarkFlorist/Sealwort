import * as assert from 'assert'
import { test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

test('ui:docker publishes the production build to host Kubo and verifies its CID', async () => {
	const packageJson: unknown = await Bun.file(new URL('../package.json', import.meta.url)).json()
	assert.equal(typeof packageJson, 'object')
	assert.notEqual(packageJson, null)
	if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) throw new Error('Missing package scripts')
	const scripts = packageJson.scripts
	if (typeof scripts !== 'object' || scripts === null || !('ui:docker' in scripts)) throw new Error('Missing ui:docker script')
	assert.equal(
		scripts['ui:docker'],
		'bun ./scripts/build-docker.mts sealwort-ui && docker run --rm --add-host=host.docker.internal:host-gateway --env IPFS_API_MULTIADDR sealwort-ui',
	)

	const repositoryRoot = new URL('..', import.meta.url).pathname
	const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sealwort-docker-build-test-'))
	try {
		const dockerStub = path.join(temporaryDirectory, 'docker')
		const argumentLog = path.join(temporaryDirectory, 'arguments.txt')
		await Bun.write(dockerStub, '#!/bin/sh\nprintf "%s\\n" "$@" > "$DOCKER_ARGUMENT_LOG"\n')
		await chmod(dockerStub, 0o755)
		const buildProcess = Bun.spawn(['bun', './scripts/build-docker.mts', 'sealwort-test'], {
			cwd: repositoryRoot,
			env: {
				...process.env,
				PATH: `${ temporaryDirectory }:${ process.env.PATH ?? '' }`,
				DOCKER_ARGUMENT_LOG: argumentLog,
				SEALWORT_RELEASE: 'v1.2.3',
				SEALWORT_COMMIT_HASH: '0123456789abcdef',
				SEALWORT_REPOSITORY_URL: 'https://github.example/example/Sealwort',
			},
			stderr: 'pipe',
			stdout: 'pipe',
		})
		assert.equal(await buildProcess.exited, 0, await new Response(buildProcess.stderr).text())
		assert.deepEqual((await readFile(argumentLog, 'utf8')).trim().split('\n'), [
			'build',
			'--build-arg',
			'SEALWORT_RELEASE=v1.2.3',
			'--build-arg',
			'SEALWORT_COMMIT_HASH=0123456789abcdef',
			'--build-arg',
			'SEALWORT_REPOSITORY_URL=https://github.example/example/Sealwort',
			'--file',
			'Dockerfile',
			'--tag',
			'sealwort-test',
			'.',
		])
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true })
	}

	const dockerfile = await Bun.file(new URL('../Dockerfile', import.meta.url)).text()
	assert.match(dockerfile, /^FROM oven\/bun:1\.3\.14-alpine@sha256:[0-9a-f]{64} AS builder$/mu)
	assert.match(dockerfile, /^ARG SEALWORT_RELEASE=""$/mu)
	assert.match(dockerfile, /^ARG SEALWORT_COMMIT_HASH=""$/mu)
	assert.match(dockerfile, /^ARG SEALWORT_REPOSITORY_URL=""$/mu)
	assert.match(dockerfile, /ipfs add --cid-version 1 --quieter --only-hash --recursive \/export/u)
	assert.match(dockerfile, /IPFS_API_MULTIADDR:-\/dns4\/host\.docker\.internal\/tcp\/5001/u)
	assert.doesNotMatch(dockerfile, /getent ahostsv4/u)
	assert.match(dockerfile, /PUBLISHED_CID=\$\(ipfs add/u)
	assert.match(dockerfile, /--api "\$IPFS_API_ADDRESS"/u)
	assert.match(dockerfile, /--cid-version 1 \\\n\t\t--pin=true \\\n\t\t--quieter \\\n\t\t--recursive/u)
	assert.match(dockerfile, /if \[ "\$PUBLISHED_CID" != "\$BUILD_CID" \]/u)
	assert.match(dockerfile, /http:\/\/\$PUBLISHED_CID\.ipfs\.localhost:8080\//u)

	const dockerignore = await Bun.file(new URL('../.dockerignore', import.meta.url)).text()
	for (const excludedPath of ['.git/', '.env', 'node_modules/', 'src/dist/', '*.log']) {
		assert.match(dockerignore, new RegExp(`^${ excludedPath.replaceAll('.', '\\.').replaceAll('*', '.*') }$`, 'mu'))
	}

	const releaseWorkflow = await Bun.file(new URL('../.github/workflows/ipfs-deploy.yml', import.meta.url)).text()
	assert.match(releaseWorkflow, /BUILD_CID=\$\(cat \/ipfs_hash\.txt\)/u)
	assert.match(releaseWorkflow, /if \[ "\$IPFS_HASH" != "\$BUILD_CID" \]/u)
	assert.match(releaseWorkflow, /printf "%s\\n" "\$IPFS_HASH" > \/output\/ipfs-cid\.txt/u)
	assert.match(releaseWorkflow, /bun \.\/scripts\/build-docker\.mts "\$IMAGE_NAME"/u)
	const reviewWorkflow = await Bun.file(new URL('../.github/workflows/review.yml', import.meta.url)).text()
	assert.match(reviewWorkflow, /actions\/upload-artifact@[0-9a-f]{40}/u)
	const checksWorkflow = await Bun.file(new URL('../.github/workflows/checks.yml', import.meta.url)).text()
	assert.match(checksWorkflow, /oven-sh\/setup-bun@[0-9a-f]{40}/u)
	assert.match(checksWorkflow, /bun \.\/scripts\/build-docker\.mts sealwort-ci/u)

	const buildScript = await Bun.file(new URL('../scripts/build.mts', import.meta.url)).text()
	assert.match(buildScript, /entrypoints: \[path\.join\(sourceDirectory, 'app', 'entrypoint\.tsx'\)\]/u)
	assert.doesNotMatch(buildScript, /bootstrapApplication|getBuildInformation|virtualEntrypoint/u)
	assert.match(buildScript, /sourcemap: 'none'/u)
	assert.match(buildScript, /copyFile\(path\.join\(sourceDirectory, 'assets', 'sealwort-botanical\.svg'\), path\.join\(outputAssetsDirectory, 'sealwort-botanical\.svg'\)\)/u)

	const [indexHtml, responseHeaders] = await Promise.all([
		Bun.file(new URL('../src/index.html', import.meta.url)).text(),
		Bun.file(new URL('../src/_headers', import.meta.url)).text(),
	])
	for (const securityPolicy of [indexHtml, responseHeaders]) {
		assert.match(securityPolicy, /connect-src https: http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\* http:\/\/\[::1\]:\*;/u)
		assert.doesNotMatch(securityPolicy, /connect-src[^;]*'self'/u)
		assert.doesNotMatch(securityPolicy, /connect-src[^;]*http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/u)
	}
})
