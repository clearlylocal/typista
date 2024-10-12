// Modified from https://github.com/cfinke/Typo.js
// Modified BSD License

import BkTree from './bktree.ts'
import { memoize } from '@std/cache/memoize'
import { LruCache } from '@std/cache/lru-cache'

type HunspellFlags = {
	PFX?: boolean
	SFX?: boolean
	REP?: boolean
	FLAG?: 'UTF-8' | 'long' | 'num'
	COMPOUNDMIN?: number
	COMPOUNDRULE?: boolean
	ONLYINCOMPOUND?: boolean
	KEEPCASE?: boolean
	NOSUGGEST?: boolean
	NEEDAFFIX?: boolean

	TRY?: string
	WORDCHARS?: string
}

type Flag = keyof HunspellFlags

type TypistaOptions = {
	flags: HunspellFlags
}

// TODO: maybe make this more type-safe?
type PermissiveHunspellFlags = {
	// deno-lint-ignore no-explicit-any
	[key: string]: any
}

type AffixEntry = {
	add: string
	continuationClasses?: string[]
	match?: RegExp
	remove?: RegExp | string
}

type AffixRule = {
	type: string
	combineable: boolean
	entries: AffixEntry[]
}

type SuggestOptions = {
	maxDist: number
	limit: number | undefined
}
const defaultSuggestOptions: SuggestOptions = {
	maxDist: 0.2,
	limit: undefined,
}

/**
 * A JavaScript implementation of a spellchecker using Hunspell-style dictionaries.
 */
export default class Typista {
	#rules: Record<string, AffixRule> = Object.create(null)
	#dictionaryTable: Record<string, null | string[][]> = Object.create(null)
	#compoundRuleSources: string[] = []
	#compoundRules: RegExp[] = []
	#compoundRuleCodes: Record<string, string[]> = Object.create(null)
	#replacementTable: [string, string][] = []

	#flags: PermissiveHunspellFlags
	#affData: string
	#wordsData: string

	/**
	 * @param affData The textual data from the dictionary's .aff file.
	 * @param dicData The textual data from the dictionary's .dic file.
	 * @param options `flags` and `editDistance` options.
	 */
	constructor(affData: string, dicData: string, options?: Partial<TypistaOptions>) {
		this.#flags = Object.assign(Object.create(null), options?.flags ?? {})

		this.#affData = affData
		this.#wordsData = dicData

		this.#setup()

		this.suggest = memoize(this.suggest.bind(this), {
			cache: this.#suggestionCache,
			getKey: (word, options) => JSON.stringify({ word, options }),
		})
	}

	// TODO: fix types in @std/cache/memoize to avoid need for `any`
	// deno-lint-ignore no-explicit-any
	#suggestionCache = new LruCache<string, any>(1e4)

	// #softDeleted: Record<string, null | string[][]> = Object.create(null)
	removeWord(word: string): void {
		delete this.#dictionaryTable[word]

		this.#suggestionCache.clear()
	}

	addWord(word: string, flags?: string[][]): void {
		this.#dictionaryTable[word] = flags ?? null

		// otherwise will be added via initialization with `#getBkTree` upon first call to `suggest` or `initBkTree`
		if (this.#bktree) {
			this.#bktree.addWord(word)
		}

		this.#suggestionCache.clear()
	}

	get dictionaryTable(): Record<string, string[][] | null> {
		return this.#dictionaryTable
	}

	get words(): string[] {
		return Object.keys(this.#dictionaryTable)
	}

	#bktree: BkTree | null = null
	#getBkTree() {
		return this.#bktree ??= new BkTree(this.words)
	}

	/**
	 * Populates the BK-Tree, which can be a costly operation.
	 *
	 * The BK-Tree is automatically populated on the first call to `suggest`, but you can call this function explicitly
	 * to give further control over when population happens.
	 */
	initBkTree(): void {
		this.#getBkTree()
	}

	/**
	 * Get suggestions for a word.
	 *
	 * If `options.maxDist` is < 1, it will be set to that fraction of the input word's length.
	 *
	 * @param word The word to get suggestions for.
	 * @param options Options for suggesting.
	 * @returns The suggestions as an array of strings.
	 */
	suggest(word: string, options?: Partial<SuggestOptions>): string[] {
		const opts = { ...defaultSuggestOptions, ...options }
		const { limit } = opts
		let { maxDist } = opts

		if (word.length === 0) {
			return []
		}

		maxDist = word.length === 1
			? 1
			: maxDist < 1
			? Math.min(word.length - 1, Math.ceil(word.length * maxDist))
			: maxDist

		return this.#getBkTree().query(word, maxDist)
			.filter((x) => x in this.#dictionaryTable)
			.slice(0, limit ?? undefined)
	}

	#setup() {
		this.#rules = this.#parseAff(this.#affData)
		// Save the rule codes that are used in compound rules.
		this.#compoundRuleCodes = Object.create(null)
		for (let i = 0, _len = this.#compoundRuleSources.length; i < _len; i++) {
			const rule = this.#compoundRuleSources[i]
			for (let j = 0, _jlen = rule.length; j < _jlen; j++) {
				this.#compoundRuleCodes[rule[j]] = []
			}
		}
		// If we add this ONLYINCOMPOUND flag to this.compoundRuleCodes, then _parseDIC
		// will do the work of saving the list of words that are compound-only.
		if (this.#flags.ONLYINCOMPOUND != null) {
			this.#compoundRuleCodes[this.#flags.ONLYINCOMPOUND] = []
		}
		this.#dictionaryTable = this.#parseDic(this.#wordsData)

		// Get rid of any codes from the compound rule codes that are never used
		// (or that were special regex characters).  Not especially necessary...
		for (const k in this.#compoundRuleCodes) {
			if (this.#compoundRuleCodes[k].length === 0) {
				delete this.#compoundRuleCodes[k]
			}
		}
		// Build the full regular expressions for each compound rule.
		// I have a feeling (but no confirmation yet) that this method of
		// testing for compound words is probably slow.
		for (let i = 0, _len = this.#compoundRuleSources.length; i < _len; i++) {
			const ruleText = this.#compoundRuleSources[i]
			let expressionText = ''
			for (let j = 0, _jlen = ruleText.length; j < _jlen; j++) {
				const character = ruleText[j]
				if (character in this.#compoundRuleCodes) {
					expressionText += '(' + this.#compoundRuleCodes[character].join('|') + ')'
				} else {
					expressionText += character
				}
			}
			this.#compoundRules[i] = new RegExp(expressionText, 'i')
		}
	}

	/**
	 * Parse the rules out from a .aff file.
	 *
	 * @param {string} data The contents of the affix file.
	 * @returns object The rules from the file.
	 */
	#parseAff(data: string): Record<string, AffixRule> {
		const rules: Record<string, AffixRule> = Object.create(null)
		let line, subline, numEntries, lineParts
		// let i, j, _len, _jlen
		const lines = data.split(/\r?\n/)
		for (let i = 0, _len = lines.length; i < _len; i++) {
			// Remove comment lines
			line = this.#removeAffixComments(lines[i])
			line = line.trim()
			if (!line) {
				continue
			}

			const definitionParts = line.split(/\s+/)
			const ruleType = definitionParts[0]

			switch (ruleType) {
				case 'PFX':
				case 'SFX': {
					const ruleCode = definitionParts[1]
					const combineable = definitionParts[2]
					numEntries = parseInt(definitionParts[3], 10)
					const entries: AffixEntry[] = []
					for (let j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
						subline = lines[j]
						lineParts = subline.split(/\s+/)
						const charactersToRemove = lineParts[2]
						const additionParts = lineParts[3].split('/')
						let charactersToAdd = additionParts[0]
						if (charactersToAdd === '0') {
							charactersToAdd = ''
						}
						const continuationClasses = this.#parseRuleCodes(additionParts[1])
						const regexToMatch = lineParts[4]
						const entry: AffixEntry = {
							add: charactersToAdd,
						}

						if (continuationClasses.length > 0) {
							entry.continuationClasses = continuationClasses
						}

						if (regexToMatch !== '.') {
							if (ruleType === 'SFX') {
								entry.match = new RegExp(regexToMatch + '$')
							} else {
								entry.match = new RegExp('^' + regexToMatch)
							}
						}
						if (charactersToRemove != '0') {
							if (ruleType === 'SFX') {
								entry.remove = new RegExp(charactersToRemove + '$')
							} else {
								entry.remove = charactersToRemove
							}
						}
						entries.push(entry)
					}
					rules[ruleCode] = {
						type: ruleType,
						combineable: combineable === 'Y',
						entries: entries,
					}
					i += numEntries

					break
				}
				case 'COMPOUNDRULE': {
					numEntries = parseInt(definitionParts[1], 10)
					for (let j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
						line = lines[j]
						lineParts = line.split(/\s+/)
						this.#compoundRuleSources.push(lineParts[1])
					}
					i += numEntries

					break
				}
				case 'REP': {
					lineParts = line.split(/\s+/)
					if (lineParts.length === 3) {
						this.#replacementTable.push([lineParts[1], lineParts[2]])
					}

					break
				}
				case 'ONLYINCOMPOUND':
				case 'COMPOUNDMIN':
				case 'FLAG':
				case 'KEEPCASE':
				case 'NEEDAFFIX': {
					this.#flags[ruleType] = definitionParts[1]

					break
				}
				default: {
					// SET, TRY, MAP, ICONV, WORDCHARS, NOSUGGEST, KEY, FORBIDDENWORD, CIRCUMFIX, BREAK, COMPOUNDFLAG, etc.
					this.#flags[ruleType] = definitionParts[1]
				}
			}
		}
		return rules
	}

	/**
	 * Removes comments.
	 *
	 * @param {string} data A line from an affix file.
	 * @return {string} The cleaned-up line.
	 */
	#removeAffixComments(line: string): string {
		// This used to remove any string starting with '#' up to the end of the line,
		// but some COMPOUNDRULE definitions include '#' as part of the rule.
		// So, only remove lines that begin with a comment, optionally preceded by whitespace.
		if (line.match(/^\s*#/)) {
			return ''
		}
		return line
	}

	/**
	 * Parses the words out from the .dic file.
	 *
	 * @param data The data from the dictionary file.
	 * @returns The lookup table containing all of the words and
	 *                 word forms from the dictionary.
	 */
	#parseDic(data: string): Record<string, string[][] | null> {
		data = this.#removeDicComments(data)
		const lines = data.split(/\r?\n/)
		const dictionaryTable: Record<string, string[][] | null> = Object.create(null)
		const addWord = (word: string, rules: string[]) => {
			// Some dictionaries will list the same word multiple times with different rule sets.
			if (!(word in dictionaryTable)) {
				dictionaryTable[word] = null
			}
			if (rules.length > 0) {
				if (dictionaryTable[word] == null) {
					dictionaryTable[word] = []
				}
				dictionaryTable[word].push(rules)
			}
		}
		// The first line is the number of words in the dictionary.
		for (let i = 1, _len = lines.length; i < _len; i++) {
			const line = lines[i]
			if (!line) {
				// Ignore empty lines.
				continue
			}
			const parts = line.split('/', 2)
			const word = parts[0]
			// Now for each affix rule, generate that form of the word.
			if (parts.length > 1) {
				const ruleCodesArray = this.#parseRuleCodes(parts[1])
				// Save the ruleCodes for compound word situations.
				if (this.#flags.NEEDAFFIX == null || !ruleCodesArray.includes(this.#flags.NEEDAFFIX)) {
					addWord(word, ruleCodesArray)
				}
				for (let j = 0, _jlen = ruleCodesArray.length; j < _jlen; j++) {
					const code = ruleCodesArray[j]
					const rule = this.#rules[code]
					if (rule) {
						const newWords = this.#applyRule(word, rule)
						for (let ii = 0, _iilen = newWords.length; ii < _iilen; ii++) {
							const newWord = newWords[ii]
							addWord(newWord, [])
							if (rule.combineable) {
								for (let k = j + 1; k < _jlen; k++) {
									const combineCode = ruleCodesArray[k]
									const combineRule = this.#rules[combineCode]
									if (combineRule) {
										if (combineRule.combineable && (rule.type != combineRule.type)) {
											const otherNewWords = this.#applyRule(newWord, combineRule)
											for (let iii = 0, _iiilen = otherNewWords.length; iii < _iiilen; iii++) {
												const otherNewWord = otherNewWords[iii]
												addWord(otherNewWord, [])
											}
										}
									}
								}
							}
						}
					}
					if (code in this.#compoundRuleCodes) {
						this.#compoundRuleCodes[code].push(word)
					}
				}
			} else {
				addWord(word.trim(), [])
			}
		}
		return dictionaryTable
	}

	/**
	 * Removes comment lines and then cleans up blank lines and trailing whitespace.
	 *
	 * @param {string} data The data from a .dic file.
	 * @return {string} The cleaned-up data.
	 */
	#removeDicComments(data: string): string {
		// I can't find any official documentation on it, but at least the de_DE
		// dictionary uses tab-indented lines as comments.
		// Remove comments
		data = data.replace(/^\t.*$/mg, '')
		return data
	}

	#parseRuleCodes(textCodes: string) {
		if (!textCodes) {
			return []
		} else if (!('FLAG' in this.#flags)) {
			// The flag symbols are single characters
			return textCodes.split('')
		} else if (this.#flags.FLAG === 'long') {
			// The flag symbols are two characters long.
			const flags = []
			for (let i = 0, _len = textCodes.length; i < _len; i += 2) {
				flags.push(textCodes.slice(i, i + 2))
			}
			return flags
		} else if (this.#flags.FLAG === 'num') {
			// The flag symbols are a CSV list of numbers.
			return textCodes.split(',')
		} else if (this.#flags.FLAG === 'UTF-8') {
			// The flags are single UTF-8 characters.
			// @see https://github.com/cfinke/Typo.js/issues/57
			return Array.from(textCodes)
		} else {
			// It's possible that this fallback case will not work for all FLAG values,
			// but I think it's more likely to work than not returning anything at all.
			return textCodes.split('')
		}
	}

	/**
	 * Applies an affix rule to a word.
	 *
	 * @param {string} word The base word.
	 * @param {Object} rule The affix rule.
	 * @returns {string[]} The new words generated by the rule.
	 */
	#applyRule(word: string, rule: AffixRule): string[] {
		const entries = rule.entries
		let newWords: string[] = []
		for (let i = 0, _len = entries.length; i < _len; i++) {
			const entry = entries[i]
			if (!entry.match || word.match(entry.match)) {
				let newWord = word
				if (entry.remove) {
					newWord = newWord.replace(entry.remove, '')
				}
				if (rule.type === 'SFX') {
					newWord = newWord + entry.add
				} else {
					newWord = entry.add + newWord
				}
				newWords.push(newWord)
				if (entry.continuationClasses != null) {
					for (let j = 0, _jlen = entry.continuationClasses.length; j < _jlen; j++) {
						const continuationRule = this.#rules[entry.continuationClasses[j]]
						if (continuationRule) {
							newWords = newWords.concat(this.#applyRule(newWord, continuationRule))
						}
						/*
                        else {
                            // This shouldn't happen, but it does, at least in the de_DE dictionary.
                            // I think the author mistakenly supplied lower-case rule codes instead
                            // of upper-case.
                        }
                        */
					}
				}
			}
		}
		return newWords
	}

	/**
	 * Checks whether a word or a capitalization letiant exists in the current dictionary.
	 * The word is trimmed and several letiations of capitalizations are checked.
	 * If you want to check a word without any changes made to it, call checkExact()
	 *
	 * @see http://blog.stevenlevithan.com/archives/faster-trim-javascript re:trimming function
	 *
	 * @param word The word to check.
	 */
	check(word: string): boolean {
		if (!word) {
			return false
		}
		// Remove leading and trailing whitespace
		const trimmedWord = word.replace(/^\s\s*/, '').replace(/\s\s*$/, '')
		if (this.checkExact(trimmedWord)) {
			return true
		}
		// The exact word is not in the dictionary.
		if (trimmedWord.toUpperCase() === trimmedWord) {
			// The word was supplied in all uppercase.
			// Check for a capitalized form of the word.
			const capitalizedWord = trimmedWord[0] + trimmedWord.slice(1).toLowerCase()
			if (this.#hasFlag(capitalizedWord, 'KEEPCASE')) {
				// Capitalization letiants are not allowed for this word.
				return false
			}
			if (this.checkExact(capitalizedWord)) {
				// The all-caps word is a capitalized word spelled correctly.
				return true
			}
			if (this.checkExact(trimmedWord.toLowerCase())) {
				// The all-caps is a lowercase word spelled correctly.
				return true
			}
		}
		const uncapitalizedWord = trimmedWord[0].toLowerCase() + trimmedWord.slice(1)
		if (uncapitalizedWord !== trimmedWord) {
			if (this.#hasFlag(uncapitalizedWord, 'KEEPCASE')) {
				// Capitalization letiants are not allowed for this word.
				return false
			}
			// Check for an uncapitalized form
			if (this.checkExact(uncapitalizedWord)) {
				// The word is spelled correctly but with the first letter capitalized.
				return true
			}
		}
		return false
	}

	/**
	 * Checks whether a word exists in the current dictionary.
	 *
	 * @param {string} word The word to check.
	 * @returns {boolean}
	 */
	checkExact(word: string): boolean {
		const ruleCodes = this.#dictionaryTable[word]
		if (typeof ruleCodes === 'undefined') {
			// Check if this might be a compound word.
			if (this.#flags.COMPOUNDMIN != null && word.length >= this.#flags.COMPOUNDMIN) {
				for (const rule of this.#compoundRules) {
					if (word.match(rule)) {
						return true
					}
				}
			}
		} else if (ruleCodes == null) {
			// a null (but not undefined) value for an entry in the dictionary table
			// means that the word is in the dictionary but has no flags.
			return true
		} else if (typeof ruleCodes === 'object') {
			for (const rule of ruleCodes) {
				if (!this.#hasFlag(word, 'ONLYINCOMPOUND', rule)) {
					return true
				}
			}
		}
		return false
	}

	/**
	 * Looks up whether a given word is flagged with a given flag.
	 *
	 * @param {string} word The word in question.
	 * @param {string} flag The flag in question.
	 * @return {boolean}
	 */
	#hasFlag(word: string, flag: Flag, wordFlags?: string[]): boolean {
		wordFlags ??= Array.prototype.concat.apply([], this.#dictionaryTable[word] ?? [])

		if (flag in this.#flags) {
			if (wordFlags.includes(this.#flags[flag])) {
				return true
			}
		}
		return false
	}
}
