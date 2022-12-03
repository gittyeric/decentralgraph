import assert from 'assert';
import memoizee from 'memoizee';
import {
  adjectives,
  animals,
  Config,
  names,
  uniqueNamesGenerator
} from 'unique-names-generator';
import { GraphNode, HexString } from './types';
const ethUnit = require('ethjs-unit')

const lowerHex = require('power-radix-encodings/base16-hexadecimal-lowercase')

export const baseChars: string[] = []
const bannedChars = ['\u0000', ',', '-', ';']
for (let i = 1; i < 256; i++) {
  const str = String.fromCharCode(i)
  if (!bannedChars.includes(str)) {
    baseChars.push(str)
  }
}

// Ensure radix 256 minus special seperators
assert(new Set(baseChars).size === (256 - bannedChars.length))

export const baseNums = baseChars as string[]

export const B62 = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
]
const BIG_ZERO = BigInt(0)

const asRadixMap = memoizee((sourceRadix: string[] | number[]): Record<string, bigint> => {
  const sourceRadixMap = {} as Record<string, bigint>
  for (let i = 0; i < sourceRadix.length; i++) {
    sourceRadixMap[sourceRadix[i] + ''] = BigInt(i)
  }
  return sourceRadixMap
})

const asSrcRadixArray = memoizee((sourceRadix: number) => B62.slice(0, sourceRadix))

const radixInCalc = memoizee((inRadixVal: string | number, inRadix: string[] | number[] | number): bigint => {
  const sourceRadix = Array.isArray(inRadix) ? inRadix : asSrcRadixArray(inRadix)
  const digits = Array.isArray(inRadixVal) ? inRadixVal : (inRadixVal + '').split('')
  const sourceRadixLength = BigInt(sourceRadix.length)
  const sourceRadixMap = asRadixMap(sourceRadix)
  let bignum = BIG_ZERO
  for (const digit of digits) {
    const val = sourceRadixMap[digit + '']
    if (val === undefined) {
      throw new Error('invalid target: ' + digit + ' not found in target encoding ' + digits.join(' '))
    }
    bignum = (bignum * sourceRadixLength) + val
  }
  return bignum
}, {
  max: 500,
})

export function newPowerRadix(inRadixVal: string | number, inRadix: string[] | number[] | number, outRadix: string[] | number): string {
  let converted: string[] = []
  let targetRadixEncoding = Array.isArray(outRadix) ? outRadix : B62
  const targetRadix = BigInt(Array.isArray(outRadix) ? outRadix.length : outRadix)
  let bignum = radixInCalc(inRadixVal, inRadix)

  do {
    let divided = bignum / targetRadix
    let remainder = Number(bignum % targetRadix)
    converted.push(targetRadixEncoding[remainder])
    bignum = divided
  } while (bignum !== BIG_ZERO)
  converted.reverse()
  return converted.join('')
}

export function toRadix252(num: number): string {
  return newPowerRadix(num, 10, baseChars)
}

export function decimalToRadix252(decimalNum: string): string {
  return newPowerRadix(decimalNum, 10, baseChars)
}

export function radix252ToDate(radix252: string): Date {
  const asNum = Number.parseInt(radix252ToDecimal(radix252))
  return new Date(asNum < 153536848800 ? (asNum * 1000) : asNum)
}

export function radix252ToHumanDate(radix252: string): string {
  return radix252ToDate(radix252).toLocaleString()
}

export function radix252ToDecimal(radix252: string): string {
  return newPowerRadix(radix252, baseNums, 10)
}

export function fromRadix252(rad252: string): bigint {
  return BigInt(newPowerRadix(rad252, baseNums, 10))
}

export function hexToRadix252(hex: string): HexString {
  const trimmedHex = hex.startsWith('0x') ? hex.substring(2) : hex
  return newPowerRadix(trimmedHex.toLowerCase(), lowerHex, baseChars)
}

export function hexToNumber(hex: HexString): bigint {
  const trimmedHex = hex.startsWith('0x') ? hex.substring(2) : hex
  return BigInt('0x' + trimmedHex.toLowerCase())
}

export function radix252ToHex(rad252: string): HexString {
  return newPowerRadix(rad252, baseNums, lowerHex)
}

export function radix252To0x(rad252: string): HexString {
  return '0x' + newPowerRadix(rad252, baseNums, lowerHex)
}

const isDebug = true

const bannedDebugComponents = new Set([
  //'graph-reducer',
  'rendering',
  //'graph-saga',
  'fetch-cache',
  'cache-indexdb',
  //'ws-channel',
  'Graph',
])

export type DebugLogger = (msg: string) => unknown
export function instrumentDebug(component: string, preferredLoggers: DebugLogger[] = []) {
  return (msg: string | Error) => {
    debug(`${component}: ${typeof (msg) === 'string' ? msg : msg.message}`, component, preferredLoggers)
  }
}

export function debug(msg: string | Error, component?: string, preferredLoggers: DebugLogger[] = []): void {
  if (isDebug && !bannedDebugComponents.has(component || '')) {
    const message = typeof (msg) === 'string' ? msg : msg.message
    const encodedChars: string[] = []
    for (let i = 0; i < message.length; i++) {
      const c = message.codePointAt(i)!
      if (c < 32 || (c >= 127 && c <= 160) || c === 173) {
        const hexxed = c.toString(16)
        encodedChars.push(`\\x${hexxed.length === 2 ? hexxed : ('0' + hexxed)}`)
      }
      else {
        encodedChars.push(message[i])
      }
    }
    if (preferredLoggers.length === 0) {
      console.log(encodedChars.join(''))
    } else {
      for (const logger of preferredLoggers) {
        logger(encodedChars.join(''))
      }
    }
  }
}

// Convenient marker for debug ensure, then remove or harden into ensure below
export function densure(msg: string, assertion: boolean = false): void {
  const print = !assertion
  if (print) {
    if (assertion) {
      debug(msg)
    } else {
      console.error(new Error(msg))
    }
  }
}

// A softer assert(), basically
export function ensure(msg: string, assertion: boolean = false): void {
  if (!assertion) {
    console.error(msg)
  }
}

// Returns the first promise to resolve as T
// and the rest as an N-1 length pending Promise<T>[]
export async function raceAndRelease<T>(
  promises: Promise<T>[]
): Promise<[T, Promise<T>[], number]> {
  let winningIndex = -1
  const wrapped = promises.map((p, i) => {
    return p.then((t) => {
      if (winningIndex < 0) {
        winningIndex = i
      }
      return t
    })
  })
  const winner = await Promise.race(wrapped)
  const pending = promises.filter((p, i) => i !== winningIndex)
  return [winner, pending, winningIndex]
}

// Merge many like-typed generators together and race the yields
// For each gen's yield, it cannot yield again till the other yields :-( TODO
/*export async function* mergeAll<YIELD, RETURN, TNEXT>(
  generators: AsyncGenerator<YIELD, RETURN, TNEXT>[]
): AsyncGenerator<YIELD, RETURN extends undefined ? undefined : RETURN[], TNEXT> {
  if (generators.length === 0) {
    throw new Error('mergeMany got empty generators array!')
  }
  const remainingGenerators = [...generators]
  const toReturn = [] as RETURN[]
  // Drain all generators
  while (true) {
    let allDone = true
    let allNext = remainingGenerators.map((gen) => gen.next())

    // Drain nexts from remaining generators
    while (allDone) {
      const [winner, remainingNext, winIndex] = await raceAndRelease(allNext)
      if (!winner.done) {
        allDone = false
        yield winner.value
        // Re-insert the next value from the generator
        remainingNext.splice(winIndex, 0, remainingGenerators[winIndex].next())
      } else {
        toReturn.push(winner.value)
        // This generator has completed, remove
        remainingGenerators.splice(winIndex, 1)
      }
      allNext = remainingNext
    }
    if (allDone) {
      return (toReturn[0] === undefined ? undefined : toReturn) as RETURN extends undefined
        ? undefined
        : RETURN[]
    }
  }
}*/

export function* pipe<YIELD, RETURN, TNEXT>(
  generators: Generator<YIELD, RETURN, TNEXT>[]
): Generator<YIELD, RETURN extends undefined ? undefined : RETURN[], TNEXT> {
  const toReturn = [] as RETURN[]
  while (true) {
    let allDone = true
    for (const gen of generators) {
      const next = gen.next()
      if (!next.done) {
        allDone = false
        yield next.value
      } else {
        toReturn.push(next.value)
      }
    }
    if (allDone) {
      return (toReturn[0] === undefined ? undefined : toReturn) as RETURN extends undefined
        ? undefined
        : RETURN[]
    }
  }
}

/*export async function* pipeAsync<YIELD, RETURN, TNEXT>(
  generators: AsyncGenerator<YIELD, RETURN, TNEXT>[]
): AsyncGenerator<YIELD, RETURN extends undefined ? undefined : RETURN[], TNEXT> {
  const toReturn = [] as RETURN[]
  while (true) {
    let allDone = true
    for (const gen of generators) {
      const next = await gen.next()
      if (!next.done) {
        allDone = false
        yield next.value
      } else {
        toReturn.push(next.value)
      }
    }
    if (allDone) {
      return (toReturn[0] === undefined ? undefined : toReturn) as RETURN extends undefined
        ? undefined
        : RETURN[]
    }
  }
}

// Merge 2 generators together that race to yield and return
export async function* merge<A_YIELD, B_YIELD, A_RETURN, B_RETURN, TNEXT>(
  genA: AsyncGenerator<A_YIELD, A_RETURN, TNEXT>,
  genB: AsyncGenerator<B_YIELD, B_RETURN, TNEXT>
): AsyncGenerator<A_YIELD | B_YIELD, [A_RETURN, B_RETURN], TNEXT> {
  let nextA = genA.next()
  let nextB = genB.next()
  while (true) {
    const both = [nextA, nextB] as Promise<IteratorResult<A_YIELD, A_RETURN>>[]
    const [winner, remainder] = await raceAndRelease(both)
    if (!winner.done) {
      yield winner.value
    }
    const loser = await remainder[0]
    if (!loser.done) {
      yield loser.value
    }

    const a = await nextA
    const b = await nextB
    if (a.done && b.done) {
      return [a.value, b.value]
    }

    nextA = genA.next()
    nextB = genB.next()
  }
}*/

export async function sleep(ms: number): Promise<void> {
  return new Promise((res, rej) => {
    setTimeout(() => {
      res()
    }, ms)
  })
}

export function makeupShortName(id: GraphNode['id']): string {
  return makeupName(id).split(' ')[1]
}

export function makeupName(id: GraphNode['id']): string {
  if (id === 'a,') {
    return 'Null Address'
  }
  const config: Config = {
    dictionaries: [adjectives, [...animals, ...names]],
    separator: ',',
    seed: id,
  }
  const csv = uniqueNamesGenerator(config)
  const split = csv.split(',')
  const caps = split.map((s) => s[0].toUpperCase() + s.slice(1))
  return caps.join(' ')
}

export const weiToEth = function (number: bigint): string {
  return ethUnit.fromWei(number.toString(), 'ether').toString(10)
}

export const weiToEth252 = function (number: bigint): string {
  const weiToE = weiToEth(number)
  return decimalToRadix252(weiToE)
}

export const ethToWei = function (number: number | string): bigint {
  return BigInt(ethUnit.toWei(number, 'ether').toString(10))
}

export const wei252ToBigInt = function (number: string): bigint {
  return BigInt(radix252ToDecimal(number))
}

export function assertUnreachable(x: never): never {
  throw new Error("Didn't expect to get here");
}
