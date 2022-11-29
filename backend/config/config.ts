import prod from './prod'
import dev from './dev'

export const config: (typeof prod | typeof dev) = process.env['NODE_ENV'] === 'prod' ? prod : dev;
const x = 1
