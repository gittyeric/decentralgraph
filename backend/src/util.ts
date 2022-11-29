import { exec } from 'child_process'
import { promisify } from 'util';
import { sha256, sha512, sha224, sha1 } from 'hash.js';
import { hexToRadix252, instrumentDebug } from '../../frontend/src/features/graph/global/utils';
import *  as  winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
const execA = promisify(exec)

export const execAsync = async (cmd: string) => {
    const res = await execA(cmd)
    return {
        stdout: res.stdout.trim(),
        stderr: res.stderr.trim(),
    }
}

/**
 * Runs sha128 hash and shrinks it to radix252 string
 * @param input
 * @returns 
 */
export const shrunkenSha1 = (input: string): string => {
    const hashHex = sha1().update(input).digest('hex')
    return hexToRadix252(hashHex)
}

export const bridgeLogger = winston.createLogger({
    //exitOnError: false
    transports: [
        new DailyRotateFile({
            filename: 'debug.log',
            dirname: './bridge-logs',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: 30
        }),
        /*new(winston.transports.Console)({
            colorize: true,
            timestamp: timeFormatFn
        })*/
    ]
});

export const coreLogger = winston.createLogger({
    //exitOnError: false
    transports: [
        new DailyRotateFile({
            filename: '%DATE%.log',
            dirname: './core-logs',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: 30
        }),
        /*new(winston.transports.Console)({
            colorize: true,
            timestamp: timeFormatFn
        })*/
    ]
});

const debug = instrumentDebug('util', [console.warn])

process
    .on('unhandledRejection', (reason, p) => {
        console.error(reason, 'Unhandled Rejection at Promise', p);
        debug(`ERROR ${JSON.stringify(reason)}`)
    })
    .on('uncaughtException', (error) => {
        debug(`ERROR ${error as Error}`)
    });

