const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
}

const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString()
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`
}

export const logger = {
  error(message, meta) {
    if (LOG_LEVELS[currentLevel] >= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, meta))
    }
  },
  warn(message, meta) {
    if (LOG_LEVELS[currentLevel] >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta))
    }
  },
  info(message, meta) {
    if (LOG_LEVELS[currentLevel] >= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, meta))
    }
  },
  debug(message, meta) {
    if (LOG_LEVELS[currentLevel] >= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, meta))
    }
  }
}
