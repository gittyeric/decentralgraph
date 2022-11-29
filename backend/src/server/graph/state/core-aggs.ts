import puppeteer from 'puppeteer';
import arrayShuffle from 'shuffle-array';
import { ethTimelineDB } from '../../lmdb';
import { instrumentDebug, sleep, toRadix252 } from '../../../../../frontend/src/features/graph/global/utils';

export type EthAggregates = {
    usd: number,
    gasFee: number,
}

// Must be between 1-59 minutes!!!
const FETCH_INTERVAL = 1000 * 60 * 15  // 15 Minutes

const pendingBrowser = puppeteer.launch();

const debug = instrumentDebug('core-aggs')

// Randomly try different sources
async function fetchFromMany<R>(...factories: (() => Promise<R>)[]): Promise<R> {
    const errors = [] as string[]
    const shuffled = arrayShuffle([...factories])
    for (let i = 0; i < shuffled.length; i++) {
        try {
            const res = await shuffled[i]()
            return res
        } catch (e) {
            const msg = (e as Error).message
            debug(msg)
            errors.push(msg)
        }
    }

    throw new Error('All fetch methods failed!\n' + errors.join('  \n'))
}

async function fetchEtherscanEthPrice(): Promise<EthAggregates> {
    debug("Fetch ETH Etherscan")
    const page = await (await pendingBrowser).newPage()
    page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:101.0) Gecko/20100101 Firefox/101.0')
    await page.goto('https://etherscan.io/');
    await page.waitForSelector("a[data-original-title='View Historical Ether Price']", { timeout: 5000 });

    const body = await page.evaluate(() => {
        const usd = document.querySelector("a[data-original-title='View Historical Ether Price']")?.innerHTML;
        const gasFee = document.querySelector("div[title='GasTracker Estimate for Average Gas'] a")?.textContent;
        return {
            usd, gasFee
        }
    });
    const cleanUsd = body.usd!.substring(1, body.usd!.indexOf('<')).replace(/,/, '')
    const cleanUsdNum = Number.parseFloat(cleanUsd)
    if (cleanUsdNum > 0 && cleanUsdNum < 999999999) {
        const cleanGas = body.gasFee!.substring(0, body.gasFee!.indexOf(' '))
        const cleanGasNum = Number.parseInt(cleanGas)
        if (cleanGasNum > 0 && cleanGasNum < 9999999999) {
            return {
                usd: cleanUsdNum,
                gasFee: cleanGasNum,
            }
        }
    }

    throw new Error(`Invalid Etherscan ETH Price from body ${JSON.stringify(body)}`)
}

async function fetchCoinMarketCapEthPrice(): Promise<EthAggregates> {
    debug("Fetch ETH CoinMarketCap")
    const page = await (await pendingBrowser).newPage()
    page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:101.0) Gecko/20100101 Firefox/101.0')
    await page.goto('https://coinmarketcap.com/currencies/ethereum/');
    await page.waitForSelector(".priceValue span", { timeout: 5000 });

    const body = await page.evaluate(() => {
        const usd = document.querySelector(".priceValue span")?.innerHTML
        const gas = document.querySelector("div.container div span:last-child a")?.innerHTML
        return { usd, gas }
    });
    const cleanUsdStr = body.usd!.substring(1).replace(/,/, '')
    const cleanUsdNum = Number.parseFloat(cleanUsdStr)
    if (cleanUsdNum > 0 && cleanUsdNum < 999999999) {
        const cleanGas = body.gas!.substring(0, body.gas!.indexOf(' '))
        const cleanGasNum = Number.parseInt(cleanGas)
        if (cleanGasNum > 0 && cleanGasNum < 9999999999) {
            return {
                usd: cleanUsdNum,
                gasFee: cleanGasNum,
            }
        }
    }

    throw new Error(`Invalid Etherscan ETH Price from body ${JSON.stringify(body)}`)
}

async function fetchEthPrice(): Promise<EthAggregates> {
    const fetchedAmount = await fetchFromMany(
        fetchEtherscanEthPrice,
        fetchCoinMarketCapEthPrice,
    )
    // Add random noise, because, you know
    const noise = (1 - Math.random()) / 10
    return {
        usd: fetchedAmount.usd + noise,
        gasFee: fetchedAmount.gasFee,
    }
}

function roundToNearestInterval(date: Date) {
    const d = new Date(date)
    d.setMinutes(0)
    d.setSeconds(0)
    d.setSeconds(0)
    d.setMilliseconds(0)

    const intervalInMins = FETCH_INTERVAL / (1000 * 60.0)
    const scaledMins = Math.round(date.getMinutes() / intervalInMins)
    d.setMinutes(scaledMins * intervalInMins)
    return d
}

async function snapshotAggregates() {
    // Throw off the pattern a lil
    await sleep(Math.random() * 1000 * 60)
    const roundedDate = roundToNearestInterval(new Date())
    const ethAggs = fetchEthPrice()
    debug(`${roundedDate}: ${JSON.stringify(await ethAggs)}`)
    const dateStr = toRadix252(roundedDate.getTime())
    ethTimelineDB.put(dateStr, await ethAggs)
}

export async function startFetchingTimelineAggs(): Promise<void> {
    snapshotAggregates().catch((e) => debug(e))
    setInterval(() => {
        snapshotAggregates().catch((e) => debug(e))
    }, FETCH_INTERVAL)
}
