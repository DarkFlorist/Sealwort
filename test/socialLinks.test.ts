import * as assert from 'node:assert'
import { test } from 'bun:test'
import { DARK_FLORIST_SOCIAL_LINKS } from '../src/app/socialLinks.js'

test('Dark Florist social links match the Lunaria footer destinations', () => {
	assert.deepEqual(DARK_FLORIST_SOCIAL_LINKS, [
		{ label: 'Discord', href: 'https://discord.gg/BeFnJA5Kjb' },
		{ label: 'Twitter', href: 'https://twitter.com/DarkFlorist' },
		{ label: 'GitHub', href: 'https://github.com/DarkFlorist' },
	])
})
