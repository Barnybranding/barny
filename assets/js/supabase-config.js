// Barny Branding Co. — public Supabase browser configuration.
// The anon key is intended for frontend use; database security is enforced by RLS.
// NEVER place the Supabase service-role key in this file or any browser-accessible code.
export const SUPABASE_URL = 'https://yrazvsrgiawfdhsailyj.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyYXp2c3JnaWF3ZmRoc2FpbHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTg5NDIsImV4cCI6MjEwMzY3NDk0Mn0.U-Jevx-6E5QARX0s4I89YDJCnDSJoVdH3Ft7NTCmbRY';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  SUPABASE_URL.startsWith('https://')
);
