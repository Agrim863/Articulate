# Articulate

Articulate is a speaking-practice app: choose a prompt, record a response, receive a transcript and structured feedback, and revisit your progress.

## Stack

- React + TypeScript + Vite
- Supabase Auth, Postgres and Row Level Security
- Supabase Edge Function as the authenticated server-side gateway
- Groq Whisper for speech-to-text
- Groq chat completions for transcript-based coaching feedback
- Vercel for hosting

## Local development

1. Install Node.js (current LTS).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add the public Supabase project URL and publishable key.
4. Run `npm run dev`.

Browser environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Set these same two variables in Vercel for the relevant deployment environments.

## Groq key (server-side only)

In Supabase Dashboard → Edge Functions → Secrets, add `GROQ_API_KEY` with your Groq API key. Do not put it in `.env.local`, GitHub, frontend code, or any `VITE_*` variable. The Edge Function uses the project's server-provided Supabase keys to authenticate the caller and save results safely.

## Data and privacy

The app uses the existing schema: `profiles`, `prompts`, `practice_sessions`, and `evaluations`. The `process-speaking` Edge Function verifies the signed-in user, transcribes the recording using Groq Whisper, requests structured coaching feedback from a Groq chat model, and writes the transcript and evaluation to the user's session. The original audio is not stored by this version; it is sent to Groq for transcription.

The app converts browser recordings to 16 kHz mono WAV before sending them to Groq. The current UI limits uploads to 25 MB. The feedback scores are estimates based on the transcript only; they do not measure pronunciation, vocal delivery, accent, pace, or body language.

Groq's free-tier quotas and model availability can change. Handle rate limits and check Groq's current pricing and terms before using the app at scale or with sensitive recordings.

## Security notes

- The Groq key stays in Supabase Edge Function secrets.
- Browser code uses only the Supabase publishable key and relies on RLS for user data.
- The Edge Function verifies the user's access token before creating or updating session data.
- Never commit `.env.local`, Groq API keys, Supabase secret keys, or service-role keys.
