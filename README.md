# Articulate

A speech-practice app that helps users record speaking sessions, transcribe them, and receive structured feedback.

## Stack

- React + TypeScript + Vite
- Tailwind CSS (to be added with the UI implementation)
- Supabase Auth, Postgres, and Row Level Security
- Supabase Edge Functions for server-side Groq API calls
- Groq for speech transcription and feedback
- Vercel for hosting

## Local development

1. Install Node.js (current LTS).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the public Supabase project URL and publishable key.
4. Run `npm run dev`.

Never commit `.env.local`, Groq API keys, Supabase service-role keys, or other secrets. The Groq key belongs in Supabase Edge Function Secrets, not in browser code or Vercel `VITE_` variables.

## Planned implementation sequence

1. App shell and responsive UI
2. Supabase client and authentication
3. Recording flow and user-owned session records
4. Authenticated Edge Function for Groq transcription
5. Structured speaking feedback
6. Session history and progress views
7. Deployment and security checks

The app is currently a scaffold; features should be implemented and tested incrementally.