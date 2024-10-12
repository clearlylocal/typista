import Typista from './typista.ts'
import BkTree from './bktree.ts'
import { assertEquals } from '@std/assert'

const aff = await Deno.readTextFile('./dictionaries/en_US/en_US.aff')
const dic = await Deno.readTextFile('./dictionaries/en_US/en_US.dic')

Deno.test('suggest (empty case)', async (t) => {
	const bkTree = new BkTree([])

	await t.step('initial', () => {
		const suggestions = bkTree.query('hostipal', 2)
		assertEquals(suggestions, [])
	})

	await t.step('suggest empty word', () => {
		const suggestions = bkTree.query('', 2)
		assertEquals(suggestions, [])
	})

	await t.step('added word', () => {
		bkTree.addWord('xyz')
		const suggestions = bkTree.query('xy', 2)
		assertEquals(suggestions, ['xyz'])
	})
})

Deno.test('suggest', async (t) => {
	const typista = new Typista(aff, dic)
	const bkTree = new BkTree(typista.words)

	await t.step('initial', () => {
		const suggestions = bkTree.query('hostipal', 3).slice(0, 6)

		assertEquals(suggestions, ['hospital', 'hostile', 'hostilely', 'hostiles', 'hosting', 'hostel'])
	})

	await t.step('repeat', () => {
		const suggestions = bkTree.query('hostipal', 3).slice(0, 6)

		assertEquals(suggestions, ['hospital', 'hostile', 'hostilely', 'hostiles', 'hosting', 'hostel'])
	})

	await t.step('really long word', () => {
		const suggestions = bkTree.query('dfgkjhdfjskhgsjkhsjkhjkfg', 3).slice(0, 6)

		assertEquals(suggestions, [])
	})

	await t.step('added word', () => {
		bkTree.addWord('hostipal')
		const suggestions = bkTree.query('hostipal', 3).slice(0, 6)

		assertEquals(suggestions, ['hostipal', 'hospital', 'hostile', 'hostilely', 'hostiles', 'hosting'])
	})
})
