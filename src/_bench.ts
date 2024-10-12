import Typo from 'typo-js'
import Typista from './typista.ts'

const ENABLE_LOGGING = Deno.permissions.requestSync({ name: 'env' }).state !== 'granted'
	? false
	: Deno.env.get('ENABLE_LOGGING')

const aff = await Deno.readTextFile('./dictionaries/en_US/en_US.aff')
const dic = await Deno.readTextFile('./dictionaries/en_US/en_US.dic')

const words = [
	// regular
	'',
	'hellu',
	'hostipal',
	'hospipal',
	'wurd',
	'freind',
	'freinds',
	'feinds',

	// non-english
	'💩',
	'文字',

	// already correct
	'hospital',
	'a',
	'ok',
	'word',

	// long
	'extremelylongwordthatdoesntexist',
	'antidixestablishmentarianism',
	'antidixextablixhmentarianixm',
	'antidisestablishmentarianism',
]

const suts = [
	{
		Ctor: Typista,
		ctorParams: [aff, dic],
	},
	{
		Ctor: Typo,
		ctorParams: ['en_US', aff, dic],
	},
]

const console = {
	...globalThis.console,
	debug(...args: unknown[]) {
		if (ENABLE_LOGGING) {
			globalThis.console.debug(...args)
		}
	},
}

for (const { Ctor, ctorParams } of suts) {
	const name = Ctor.name
	const sut = new Ctor(...ctorParams)

	Deno.test(name, async (t) => {
		await t.step('check', async (t) => {
			for (const word of words) {
				await t.step(JSON.stringify(word), () => {
					console.debug(sut.check(word))
				})
			}
		})

		await t.step('suggest', async (t) => {
			for (const word of words) {
				await t.step(JSON.stringify(word), () => {
					console.debug(sut.suggest(word))
				})
			}
		})
	})
}
