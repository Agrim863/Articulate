import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function keyFromMap(variable: string): string | null {
  try {
    const parsed = JSON.parse(Deno.env.get(variable) ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

function asScore(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 8);
}

function asObjectArray(value: unknown, keys: string[]): Record<string, string>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return keys.some((key) => typeof (item as Record<string, unknown>)[key] === "string");
  }).map((item) => {
    const safe: Record<string, string> = {};
    for (const key of keys) {
      const field = (item as Record<string, unknown>)[key];
      if (typeof field === "string") safe[key] = field.slice(0, 1200);
    }
    return safe;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? keyFromMap("SUPABASE_PUBLISHABLE_KEYS");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? keyFromMap("SUPABASE_SECRET_KEYS");
  const groqApiKey = Deno.env.get("GROQ_API_KEY");

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json({ error: "Supabase server configuration is incomplete. Check the Edge Function environment." }, 500);
  }
  if (!groqApiKey) {
    return json({ error: "Groq is not configured yet. Add GROQ_API_KEY under Supabase Edge Function Secrets." }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Please sign in before processing a recording." }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Your session has expired. Please sign in again." }, 401);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let sessionId: string | null = null;
  let savedTranscript: string | null = null;

  try {
    const form = await req.formData();
    const audio = form.get("file");
    const promptId = form.get("prompt_id");
    const rawDuration = Number(form.get("duration_seconds") ?? 0);

    if (!(audio instanceof File)) return json({ error: 'Missing audio file. Send it in the "file" field.' }, 400);
    if (audio.size === 0 || audio.size > 25 * 1024 * 1024) {
      return json({ error: "Audio must be non-empty and no larger than 25 MB." }, 413);
    }
    if (typeof promptId !== "string" || !promptId.trim()) return json({ error: "Choose a speaking prompt first." }, 400);

    const durationSeconds = Number.isFinite(rawDuration) ? Math.max(0, Math.min(3600, Math.round(rawDuration))) : 0;
    const { data: prompt, error: promptError } = await admin
      .from("prompts")
      .select("id, question, category")
      .eq("id", promptId)
      .eq("is_active", true)
      .maybeSingle();

    if (promptError || !prompt) return json({ error: "That prompt is unavailable. Please choose another prompt." }, 404);

    const { data: session, error: sessionError } = await admin
      .from("practice_sessions")
      .insert({
        user_id: user.id,
        prompt_id: prompt.id,
        duration_seconds: durationSeconds,
        status: "transcribing",
        attempt_number: 1,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      return json({ error: "Could not create your speaking session. Please try again." }, 500);
    }
    sessionId = session.id;

    const transcriptionForm = new FormData();
    transcriptionForm.append("file", audio, audio.name || "articulate-recording.wav");
    transcriptionForm.append("model", "whisper-large-v3-turbo");
    transcriptionForm.append("response_format", "json");

    const transcriptionResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: transcriptionForm,
    });
    const transcriptionPayload = await transcriptionResponse.json().catch(() => ({}));
    if (!transcriptionResponse.ok) {
      const providerMessage = transcriptionPayload?.error?.message;
      const message = transcriptionResponse.status === 429
        ? "Groq's rate limit was reached. Please wait a little and try again."
        : "Groq could not transcribe this recording. Please try again.";
      await admin.from("practice_sessions").update({ status: "failed" }).eq("id", sessionId).eq("user_id", user.id);
      return json({ error: message, details: typeof providerMessage === "string" ? providerMessage : undefined, session_id: sessionId }, 502);
    }

    savedTranscript = typeof transcriptionPayload.text === "string" ? transcriptionPayload.text.trim() : "";
    if (!savedTranscript) {
      await admin.from("practice_sessions").update({ status: "failed" }).eq("id", sessionId).eq("user_id", user.id);
      return json({ error: "We couldn't detect speech in that recording. Try speaking a little longer and recording again.", session_id: sessionId }, 422);
    }

    await admin.from("practice_sessions")
      .update({ transcript: savedTranscript, status: "evaluating" })
      .eq("id", sessionId)
      .eq("user_id", user.id);

    const chatResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        temperature: 0.2,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are Articulate, a supportive and honest speaking-practice coach. Evaluate only the transcript text, not audio qualities you cannot hear. Do not infer pronunciation, accent, volume, pace, confidence, facial expression, or body language. Be specific, fair, kind, and practical. A short answer should not be penalized merely for being short if it fits the prompt and target. Return only a valid JSON object with exactly these fields: clarity_score (integer 0-100), structure_score (integer 0-100), coherence_score (integer 0-100), relevance_score (integer 0-100), conciseness_score (integer 0-100), strengths (array of 2-4 short strings), improvement_areas (array of 1-4 objects with title, explanation, and optional example), transcript_feedback (array of 0-4 objects with quote, suggestion, reason; quote must be an exact short excerpt from the transcript), rewritten_example (string showing a natural improved version without changing the speaker's core meaning), next_action (one practical exercise for the next session), summary (2-3 sentence balanced summary). Scores should reflect evidence in the transcript. If the transcript is very short, say that confidence in the evaluation is limited and avoid inventing errors.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              speaking_prompt: prompt.question,
              prompt_category: prompt.category,
              transcript: savedTranscript,
            }),
          },
        ],
      }),
    });

    const chatPayload = await chatResponse.json().catch(() => ({}));
    if (!chatResponse.ok) {
      const providerMessage = chatPayload?.error?.message;
      const message = chatResponse.status === 429
        ? "Groq's AI feedback rate limit was reached. Your transcript is saved; please try again later."
        : "Groq transcribed your speech, but feedback generation failed. Please try again.";
      await admin.from("practice_sessions")
        .update({ transcript: savedTranscript, status: "failed" })
        .eq("id", sessionId)
        .eq("user_id", user.id);
      return json({ error: message, details: typeof providerMessage === "string" ? providerMessage : undefined, session_id: sessionId, transcript: savedTranscript }, 502);
    }

    const content = chatPayload?.choices?.[0]?.message?.content;
    let rawFeedback: Record<string, unknown>;
    try {
      rawFeedback = typeof content === "string" ? JSON.parse(content) : {};
    } catch {
      throw new Error("Groq returned feedback in an unexpected format. Please retry.");
    }

    const clarity = asScore(rawFeedback.clarity_score);
    const structure = asScore(rawFeedback.structure_score);
    const coherence = asScore(rawFeedback.coherence_score);
    const relevance = asScore(rawFeedback.relevance_score);
    const conciseness = asScore(rawFeedback.conciseness_score);
    const overallScore = Math.round((clarity + structure + coherence + relevance + conciseness) / 5);

    const evaluation = {
      session_id: sessionId,
      user_id: user.id,
      clarity_score: clarity,
      structure_score: structure,
      coherence_score: coherence,
      relevance_score: relevance,
      conciseness_score: conciseness,
      strengths: asStringArray(rawFeedback.strengths),
      improvement_areas: asObjectArray(rawFeedback.improvement_areas, ["title", "explanation", "example"]),
      transcript_feedback: asObjectArray(rawFeedback.transcript_feedback, ["quote", "suggestion", "reason"]),
      rewritten_example: typeof rawFeedback.rewritten_example === "string" ? rawFeedback.rewritten_example.slice(0, 5000) : null,
      next_action: typeof rawFeedback.next_action === "string" ? rawFeedback.next_action.slice(0, 1200) : null,
      summary: typeof rawFeedback.summary === "string" ? rawFeedback.summary.slice(0, 2000) : null,
    };

    const { data: savedEvaluation, error: evaluationError } = await admin
      .from("evaluations")
      .insert(evaluation)
      .select("*")
      .single();

    if (evaluationError || !savedEvaluation) {
      throw new Error("Your transcript was created, but the feedback could not be saved. Please try again.");
    }

    const { error: updateError } = await admin
      .from("practice_sessions")
      .update({ transcript: savedTranscript, status: "completed", overall_score: overallScore })
      .eq("id", sessionId)
      .eq("user_id", user.id);

    if (updateError) throw new Error("Feedback was generated, but the session status could not be updated.");

    return json({
      session_id: sessionId,
      transcript: savedTranscript,
      duration_seconds: durationSeconds,
      overall_score: overallScore,
      evaluation: savedEvaluation,
    });
  } catch (error) {
    if (sessionId) {
      await admin.from("practice_sessions")
        .update({ ...(savedTranscript ? { transcript: savedTranscript } : {}), status: "failed" })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }
    const message = error instanceof Error ? error.message : "Unable to process this recording.";
    return json({ error: message, session_id: sessionId ?? undefined, transcript: savedTranscript ?? undefined }, 500);
  }
});
