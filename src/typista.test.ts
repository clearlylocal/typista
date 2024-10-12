import Typista from './typista.ts'
import { assertEquals, assertInstanceOf } from '@std/assert'

const SKIP_SLOW_TESTS = Deno.permissions.querySync({ name: 'env' }).state !== 'granted'
	? true
	: !Deno.env.get('INCLUDE_SLOW_TESTS')

const aff = await Deno.readTextFile('./dictionaries/en_US/en_US.aff')
const dic = await Deno.readTextFile('./dictionaries/en_US/en_US.dic')

let _typista: Typista

function getInstance() {
	const t = _typista ?? new Typista(aff, dic)
	_typista = t

	t.initBkTree()
	reset(t)
	return t
}

function reset(typista: Typista) {
	typista.addWord('hospital')
	typista.removeWord('hostipal')
}

Deno.test({
	name: 'instantiate',
	fn() {
		const typista = new Typista(aff, dic)
		assertInstanceOf(typista, Typista)
	},
	ignore: SKIP_SLOW_TESTS,
})

Deno.test({
	name: 'initialize',
	fn() {
		const typista = new Typista(aff, dic)
		typista.initBkTree()
	},
	ignore: SKIP_SLOW_TESTS,
})

Deno.test('check', async (t) => {
	const typista = getInstance()

	await t.step('existing word', () => {
		const result = typista.check('hospital')
		assertEquals(result, true)
	})

	await t.step('typo', () => {
		const result = typista.check('hostipal')
		assertEquals(result, false)
	})

	await t.step('removed word', () => {
		typista.removeWord('hospital')
		const result = typista.check('hospital')
		assertEquals(result, false)
	})

	await t.step('added word', () => {
		typista.addWord('hostipal')
		const result = typista.check('hostipal')
		assertEquals(result, true)
	})
})

Deno.test({
	name: 'really long word',
	async fn(t) {
		const typista = new Typista(
			await Deno.readTextFile('./dictionaries/fr_FR/fr_FR.aff'),
			await Deno.readTextFile('./dictionaries/fr_FR/fr_FR.dic'),
		)

		// force init of bktree
		await t.step('init', () => {
			typista.initBkTree()
		})

		// force init of bktree
		await t.step('some other word', () => {
			assertEquals(typista.suggest('ok', { limit: 3 }), ['o', 'oc', 'oh'])
		})

		await t.step('anticonstituxionnellement', () => {
			const suggestions = typista.suggest('anticonstituxionnellement ', { limit: 6 })
			assertEquals(suggestions[0], 'anticonstitutionnellement')
		})

		await t.step('https://github.com/cfinke/Typo.js/issues/83 - really long word', () => {
			// Using a french dictionary, calling typo.suggest("Anticonstiutni2onlleemnt") takes more than 25 seconds and block the browser
			const suggestions = typista.suggest('Anticonstiutnixonlleemnt', { limit: 6 })
			assertEquals(suggestions, [])
		})
	},
	ignore: SKIP_SLOW_TESTS,
})

Deno.test('suggest', async (t) => {
	const typista = getInstance()

	await t.step('initial', () => {
		const suggestions = typista.suggest('hostipal', { maxDist: 5, limit: 6 })

		assertEquals(suggestions, ['hospital', 'hostile', 'hostilely', 'hostiles', 'hosting', 'hostel'])
	})

	await t.step('repeat', () => {
		const suggestions = typista.suggest('hostipal', { maxDist: 5, limit: 6 })

		assertEquals(suggestions, ['hospital', 'hostile', 'hostilely', 'hostiles', 'hosting', 'hostel'])
	})

	await t.step('removed word', () => {
		typista.removeWord('hospital')

		const suggestions = typista.suggest('hostipal', { maxDist: 5, limit: 6 })
		assertEquals(suggestions, ['hostile', 'hostilely', 'hostiles', 'hosting', 'hostel', 'hospitals'])
	})

	await t.step('added word', () => {
		typista.addWord('hostipal')
		const suggestions = typista.suggest('hostipal', { maxDist: 5, limit: 6 })
		assertEquals(suggestions, ['hostipal', 'hostile', 'hostilely', 'hostiles', 'hosting', 'hostel'])
	})
})

Deno.test('Damerau distance gives single-transposition first', () => {
	const typista = getInstance()

	assertEquals(typista.suggest('whastoever', { maxDist: 2, limit: 3 }), ['whatsoever', 'whatever', 'whosoever'])
})

Deno.test('Suggestions', async (t) => {
	const typista = getInstance()

	await t.step('basic', () => {
		assertEquals(typista.suggest('speling', { maxDist: 2, limit: 3 }), ['spelling', 'spewing', 'spieling'])
	})

	await t.step('Repeated calls function properly', () => {
		assertEquals(typista.suggest('speling', { maxDist: 2, limit: 1 }), ['spelling'])
		assertEquals(typista.suggest('speling', { maxDist: 2, limit: 5 }), [
			'spelling',
			'spewing',
			'spieling',
			'spellings',
			'speeding',
		])
		assertEquals(typista.suggest('speling', { maxDist: 2, limit: 2 }), ['spelling', 'spewing'])
		assertEquals(typista.suggest('speling', { maxDist: 2, limit: 5 }), [
			'spelling',
			'spewing',
			'spieling',
			'spellings',
			'speeding',
		])
	})

	await t.step("Requesting more suggestions than will be returned doesn't break anything.", () => {
		assertEquals(
			typista.suggest('spartang', { maxDist: 2, limit: 50 }),
			[
				'spartan',
				'Spartan',
				'Spartans',
				'sparking',
				'sparling',
				'sparring',
				'sparing',
				'spatting',
				'sporting',
				'spurting',
				'sprang',
				'smarting',
				'starting',
				'parting',
			],
		)

		assertEquals(typista.suggest('spartang', { maxDist: 3, limit: 1 }), ['spartan'])
	})
})
