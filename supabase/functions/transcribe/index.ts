import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const groqApiKey = Deno.env.get("GROQ_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !groqApiKey) {
    return Response.json({ error: "Server configuration is incomplete" }, { status: 500, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Authentication required" }, { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return Response.json({ error: "Invalid or expired session" }, { status: 401, headers: corsHeaders });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data with an audio file" }, { status: 400, headers: corsHeaders });
  }

  const audio = form.get("file");
  if (!(audio instanceof File)) {
    return Response.json({ error: 'Missing audio file. Send it in the "file" field.' }, { status: 400, headers: corsHeaders });
  }

  const maxBytes = 25 * 1024 * 1024;
  if (audio.size === 0 || audio.size > maxBytes) {
    return Response.json({ error: "Audio must be non-empty and no larger than 25 MB" }, { status: 413, headers: corsHeaders });
  }

  const groqForm = new FormData();
  groqForm.append("file", audio, audio.name || "recording.webm");
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("response_format", "json");

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: groqForm,
    });

    const result = await groqResponse.json().catch(() => ({}));
    if (!groqResponse.ok) {
      return Response.json(
        { error: "Transcription provider returned an error", details: result?.error?.message ?? "Unknown provider error" },
        { status: 502, headers: corsHeaders },
      );
    }

    return Response.json(
      { transcript: typeof result.text === "string" ? result.text : "" },
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    return Response.json({ error: "Could not reach the transcription provider" }, { status: 502, headers: corsHeaders });
  }
});
