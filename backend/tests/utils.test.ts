import assert from "assert"
import { newPowerRadix, baseChars, B62 } from "../../decentralgraph/src/features/graph/global/utils"

describe('radix252', () => {
    it('works', () => {
        assert(newPowerRadix(255, 10, 16) === 'FF', `shit newPowerRadix(255, 10, 16) = ${newPowerRadix(255, 10, 16)}`)
        assert(newPowerRadix(255, 10, 16) === 'FF', `shit newPowerRadix(255, 10, 16) = ${newPowerRadix(255, 10, 16)}`)
        assert(newPowerRadix('FF', 16, 10) === '255', `shit newPowerRadix('FF', B62, 10) = ${newPowerRadix('FF', B62, 10)}`)
        assert(newPowerRadix('FF', 16, 10) === '255', `shit newPowerRadix('FF', B62, 10) = ${newPowerRadix('FF', B62, 10)}`)
        assert(newPowerRadix('FE', 16, 10) === '254', `shit newPowerRadix('FE', B62, 10) = ${newPowerRadix('FE', B62, 10)}`)
        assert(newPowerRadix(10, 10, baseChars), `shit!!! ${newPowerRadix(10, 10, baseChars)}`)
        assert(newPowerRadix(255, 10, baseChars), `shit!!! ${newPowerRadix(10, 10, baseChars)}`)
        assert(newPowerRadix(255, 10, baseChars), `shit!!! ${newPowerRadix(10, 10, baseChars)}`)
        assert(newPowerRadix(10, 10, baseChars), `shit!!! ${newPowerRadix(10, 10, baseChars)}`)
    })
})