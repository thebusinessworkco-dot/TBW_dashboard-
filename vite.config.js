import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_SUPABASE_URL = 'https://fbyyjmxrkizlpmxakkdo.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZieXlqbXhya2l6bHBteGFra2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzOTgwODMsImV4cCI6MjEwNzk3NDA4M30.Z8gf8z4LUtvsRyNV8wLL6qGpqIozgpldGFF_giwT7Rg'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const REAL_SUPABASE_URL = 'https://fbyyjmxrkizlpmxakkdo.supabase.co'

  // Prioritize VITE_SUPABASE_URL or fallback to verified project URL
  const candidateUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const supabaseUrl = (candidateUrl && candidateUrl.includes('fbyyjmxrkizlpmxakkdo'))
    ? candidateUrl
    : REAL_SUPABASE_URL

  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_SUPABASE_ANON_KEY

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabaseAnonKey)
    }
  }
})

