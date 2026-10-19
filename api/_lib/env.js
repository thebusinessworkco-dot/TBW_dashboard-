export function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

export function optionalEnv(name, fallback = '') {
  const value = process.env[name]
  return (value && value.trim() !== '') ? value.trim() : fallback
}
