// Barny Branding Co. — public Supabase browser configuration.
// The anon key is intended for frontend use; database security is enforced by RLS.
// NEVER place the Supabase service-role key in this file or any browser-accessible code.
export const SUPABASE_URL = 'https://mnhkcltxhcsqvisqdduy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uaGtjbHR4aGNzcXZpc3FkZHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjg5MzYsImV4cCI6MjEwMzYwNDkzNn0.Rdgu3o1t7z95Ek0LlOOz1_P9_JNeZeu0rwLGuOcAXqs';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  SUPABASE_URL.startsWith('https://')
);
