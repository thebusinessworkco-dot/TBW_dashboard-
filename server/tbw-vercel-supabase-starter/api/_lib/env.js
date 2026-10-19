export function requiredEnv(name) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`Missing required server environment variable: ${name}`)
  return value.trim()
}
