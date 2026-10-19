import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://fbyyjmxrkizlpmxakkdo.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZieXlqbXhya2l6bHBteGFra2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzOTgwODMsImV4cCI6MjEwNzk3NDA4M30.Z8gf8z4LUtvsRyNV8wLL6qGpqIozgpldGFF_giwT7Rg'

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY

export const supabase = (url && publishableKey)
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null

