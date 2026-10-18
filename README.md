# Articulate

Articulate is a speaking-practice app: choose a prompt, record a response, receive a transcript and structured feedback, and revisit your progress.

## Stack

- React + TypeScript + Vite
- Supabase Auth, Postgres and Row Level Security
- Supabase Edge Function as the server-side gateway
- xAI Grok API for speech-to-text and transcript-based feedback
- Vercel for hosting

## Local development

1. Install Node.js (current LTS).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add the public Supabase project URL and publishable key.
4. Run `npm run dev`.

The browser environment variables are:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Set these same two variables in Vercel for the relevant deployment environments.

## xAI key (server-side only)

In Supabase Dashboard → Edge Functions → Secrets, add `XAI_API_KEY` with your xAI API key. Do not put it in `.env.local`, GitHub, frontend code, or any `VITE_*` variable. The Edge Function uses Supabase's server-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to authenticate the caller and save results safely.

## Data and privacy

The app uses the existing schema: `profiles`, `prompts`, `practice_sessions`, and `evaluations`. The `process-speaking` Edge Function checks the signed-in user, transcribes the audio using xAI, requests structured coaching feedback, and writes the transcript and evaluation to that user's session. The original audio is not stored by this version; it is sent to xAI for transcription. Check xAI's current terms and pricing before using this with sensitive recordings or at scale.

## Implementation notes

- The UI converts browser recordings to 16 kHz mono WAV because the xAI speech-to-text endpoint documents WAV support.
- The feedback scores assess the transcript only. They do not measure accent, vocal delivery, pronunciation, or body language.
- xAI API usage may be billed; a key does not guarantee free usage.
