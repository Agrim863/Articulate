import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Prompt = { id: string; question: string; category: string; difficulty: string | null; suggested_duration_seconds: number };
type Evaluation = {
  id: string; session_id: string; clarity_score: number; structure_score: number; coherence_score: number;
  relevance_score: number; conciseness_score: number; strengths: string[] | null;
  improvement_areas: { title?: string; explanation?: string; example?: string }[] | null;
  transcript_feedback: { quote?: string; suggestion?: string; reason?: string }[] | null;
  rewritten_example: string | null; next_action: string | null; summary: string | null;
};
type Session = {
  id: string; prompt_id: string; transcript: string | null; duration_seconds: number; status: string;
  overall_score: number | null; created_at: string; prompts?: { question?: string; category?: string } | null;
  evaluation?: Evaluation | null;
};
type View = 'home' | 'practice' | 'history' | 'results';
const scores = [['clarity_score','Clarity'],['structure_score','Structure'],['coherence_score','Coherence'],['relevance_score','Relevance'],['conciseness_score','Conciseness']] as const;
const duration = (s:number) => `${Math.floor(s/60) ? `${Math.floor(s/60)}m ` : ''}${String(s%60).padStart(2,'0')}s`;
const dateLabel = (s:string) => new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

async function toWav16k(blob: Blob): Promise<Blob> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio conversion is not supported by this browser. Please try a recent version of Chrome or Edge.');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const targetRate = 16000;
    const sourceLength = decoded.length;
    const targetLength = Math.max(1, Math.floor(sourceLength * targetRate / decoded.sampleRate));
    const mono = new Float32Array(targetLength);
    const channels = Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    for (let i=0;i<targetLength;i++) {
      const sourcePosition = i * decoded.sampleRate / targetRate;
      const left = Math.floor(sourcePosition);
      const right = Math.min(left+1,sourceLength-1);
      const fraction = sourcePosition-left;
      let sample = 0;
      for (const channel of channels) sample += (channel[left]*(1-fraction)+channel[right]*fraction)/channels.length;
      mono[i] = Math.max(-1,Math.min(1,sample));
    }
    const buffer = new ArrayBuffer(44 + mono.length*2);
    const view = new DataView(buffer);
    const writeText = (offset:number,text:string) => { for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i)); };
    writeText(0,'RIFF'); view.setUint32(4,36+mono.length*2,true); writeText(8,'WAVE');
    writeText(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
    view.setUint16(22,1,true); view.setUint32(24,targetRate,true); view.setUint32(28,targetRate*2,true);
    view.setUint16(32,2,true); view.setUint16(34,16,true); writeText(36,'data'); view.setUint32(40,mono.length*2,true);
    for(let i=0;i<mono.length;i++) view.setInt16(44+i*2,mono[i]<0?mono[i]*0x8000:mono[i]*0x7fff,true);
    return new Blob([buffer],{type:'audio/wav'});
  } finally { await context.close(); }
}

export default function App() {
  const [user,setUser] = useState<{id:string;email?:string}|null>(null);
  const [authReady,setAuthReady] = useState(false);
  const [authMode,setAuthMode] = useState<'signin'|'signup'>('signin');
  const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
  const [authMessage,setAuthMessage] = useState(''); const [authBusy,setAuthBusy] = useState(false);
  const [view,setView] = useState<View>('home'); const [prompts,setPrompts] = useState<Prompt[]>([]);
  const [category,setCategory] = useState('All'); const [selected,setSelected] = useState<Prompt|null>(null);
  const [sessions,setSessions] = useState<Session[]>([]); const [latest,setLatest] = useState<Session|null>(null);
  const [loading,setLoading] = useState(false); const [dataError,setDataError] = useState('');
  const [recording,setRecording] = useState(false); const [elapsed,setElapsed] = useState(0);
  const [audioBlob,setAudioBlob] = useState<Blob|null>(null); const [processing,setProcessing] = useState(false);
  const [recordMessage,setRecordMessage] = useState('');
  const recorderRef = useRef<MediaRecorder|null>(null); const streamRef = useRef<MediaStream|null>(null);
  const chunksRef = useRef<Blob[]>([]); const timerRef = useRef<number|null>(null);

  useEffect(()=>{
    if(!supabase){setAuthReady(true);return;}
    supabase.auth.getSession().then(({data})=>{setUser(data.session?.user?{id:data.session.user.id,email:data.session.user.email}:null);setAuthReady(true);});
    const {data:listener}=supabase.auth.onAuthStateChange((_event,session)=>setUser(session?.user?{id:session.user.id,email:session.user.email}:null));
    return ()=>listener.subscription.unsubscribe();
  },[]);

  const loadData=useCallback(async()=>{
    if(!supabase||!user)return;
    setLoading(true);setDataError('');
    const [p,s,e]=await Promise.all([
      supabase.from('prompts').select('id,question,category,difficulty,suggested_duration_seconds').eq('is_active',true).order('category').order('created_at'),
      supabase.from('practice_sessions').select('id,prompt_id,transcript,duration_seconds,status,overall_score,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50),
      supabase.from('evaluations').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50),
    ]);
    if(p.error)setDataError(`Could not load prompts: ${p.error.message}`);else setPrompts((p.data??[]) as Prompt[]);
    if(s.error)setDataError(old=>old||`Could not load history: ${s.error.message}`);
    if(e.error)setDataError(old=>old||`Could not load feedback: ${e.error.message}`);
    const promptMap=new Map((p.data??[]).map(x=>[x.id,x]));
    const evalMap=new Map((e.data??[]).map(x=>[x.session_id,x as Evaluation]));
    setSessions(((s.data??[]).map(row=>({...row,prompts:promptMap.has(row.prompt_id)?{question:promptMap.get(row.prompt_id)!.question,category:promptMap.get(row.prompt_id)!.category}:null,evaluation:evalMap.get(row.id)??null}))) as Session[]);
    setLoading(false);
  },[user]);
  useEffect(()=>{void loadData();},[loadData]);
  useEffect(()=>{if(!recording)return;timerRef.current=window.setInterval(()=>setElapsed(n=>n+1),1000);return()=>{if(timerRef.current!==null)window.clearInterval(timerRef.current);};},[recording]);
  useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(timerRef.current!==null)window.clearInterval(timerRef.current);},[]);

  const authSubmit=async(e:FormEvent)=>{
    e.preventDefault();if(!supabase)return;setAuthBusy(true);setAuthMessage('');
    try{
      const result=authMode==='signup'?await supabase.auth.signUp({email:email.trim(),password}):await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(result.error)throw result.error;
      setAuthMessage(authMode==='signup'&&!result.data.session?'Account created. Check your email for the confirmation link, then sign in.':'You are signed in.');
    }catch(err){setAuthMessage(err instanceof Error?err.message:'Authentication failed. Please try again.');}finally{setAuthBusy(false);}
  };
  const signOut=async()=>{if(!supabase)return;await supabase.auth.signOut();setView('home');setSelected(null);setLatest(null);};
  const startPrompt=(p:Prompt)=>{setSelected(p);setElapsed(0);setAudioBlob(null);setRecordMessage('');setView('practice');};
  const startRecording=async()=>{
    setRecordMessage('');setAudioBlob(null);setElapsed(0);
    if(!selected)return;
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setRecordMessage('This browser does not support recording. Try a recent version of Chrome or Edge over HTTPS.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;
      const type=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=type?new MediaRecorder(stream,{mimeType:type}):new MediaRecorder(stream);
      chunksRef.current=[];recorder.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data);};
      recorder.onstop=()=>{setAudioBlob(new Blob(chunksRef.current,{type:recorder.mimeType||'audio/webm'}));stream.getTracks().forEach(t=>t.stop());streamRef.current=null;};
      recorderRef.current=recorder;recorder.start(500);setRecording(true);
    }catch(err){setRecordMessage(err instanceof Error?err.message:'Microphone permission was denied. Check browser settings.');}
  };
  const stopRecording=()=>{if(recorderRef.current&&recorderRef.current.state!=='inactive')recorderRef.current.stop();setRecording(false);if(timerRef.current!==null)window.clearInterval(timerRef.current);};
  const submitRecording=async()=>{
    if(!supabase||!selected||!audioBlob)return;
    setProcessing(true);setRecordMessage('Converting audio, transcribing, and preparing your feedback…');
    try{
      const wav=await toWav16k(audioBlob);
      if(wav.size>25*1024*1024)throw new Error('This recording is too large. Please record a shorter response.');
      const form=new FormData();form.append('file',wav,'articulate-recording.wav');form.append('prompt_id',selected.id);form.append('duration_seconds',String(elapsed));
      const {data,error}=await supabase.functions.invoke('process-speaking',{body:form});
      if(error){const response=(error as {context?:Response}).context;const body=response?await response.json().catch(()=>null):null;throw new Error(body?.error||error.message);}
      if(data?.error)throw new Error(data.error);
      const session:Session={id:data.session_id,prompt_id:selected.id,transcript:data.transcript,duration_seconds:data.duration_seconds??elapsed,status:'completed',overall_score:data.overall_score,created_at:new Date().toISOString(),prompts:{question:selected.question,category:selected.category},evaluation:data.evaluation};
      setLatest(session);setAudioBlob(null);setView('results');await loadData();
    }catch(err){setRecordMessage(err instanceof Error?err.message:'Could not process this recording. Please try again.');}
    finally{setProcessing(false);}
  };

  if(!isSupabaseConfigured)return <main className="setup-screen"><section className="setup-card"><a className="wordmark" href="#"><span className="wordmark-mark">A</span> Articulate</a><p className="eyebrow">CONNECTION NEEDED</p><h1>Let's connect your workspace.</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to your local environment and Vercel project settings, then redeploy.</p><a className="primary-button" href="https://supabase.com/dashboard/project/cszcxsnscmoszxdzrvxi">Open Supabase ↗</a></section></main>;
  if(!authReady)return <main className="loading-screen"><span className="spinner"/> Preparing your workspace…</main>;
  if(!user)return <main className="auth-screen"><section className="auth-story"><a className="wordmark" href="#"><span className="wordmark-mark">A</span> Articulate</a><div><p className="eyebrow">✳ YOUR VOICE, WITH MORE CLARITY</p><h1>Think clearly.<br/><em>Speak confidently.</em></h1><p>Practice expressing your ideas, review your words, and build confidence one session at a time.</p><div className="auth-note"><span>✳</span><div><strong>Progress over perfection.</strong><small>Your next conversation is a chance to grow.</small></div></div></div><p className="auth-footer">A thoughtful space to find your words.</p></section><section className="auth-panel"><div className="auth-form-wrap"><p className="eyebrow">YOUR PRACTICE STARTS HERE</p><h2>{authMode==='signin'?'Welcome back.':'Create your space.'}</h2><p className="muted">{authMode==='signin'?'Pick up where your growth left off.':'A small step toward a clearer voice.'}</p><form className="auth-form" onSubmit={authSubmit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com"/><label htmlFor="password">Password</label><input id="password" type="password" minLength={6} autoComplete={authMode==='signin'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="At least 6 characters"/><button className="primary-button full-button" disabled={authBusy}>{authBusy?'Please wait…':authMode==='signin'?'Sign in →':'Create account →'}</button></form>{authMessage&&<p className="notice" role="status">{authMessage}</p>}<p className="auth-switch">{authMode==='signin'?'New to Articulate?':'Already have an account?'} <button className="text-button" onClick={()=>{setAuthMode(authMode==='signin'?'signup':'signin');setAuthMessage('');}}>{authMode==='signin'?'Create an account':'Sign in'}</button></p><p className="privacy-note">Your original audio is processed for transcription and not saved by this version. Your transcript and feedback are saved to your account.</p></div></section></main>;

  const categories=['All',...Array.from(new Set(prompts.map(p=>p.category))).sort()];
  const visiblePrompts=category==='All'?prompts:prompts.filter(p=>p.category===category);
  return <main className="app-shell">
    <nav className="app-nav"><button className="wordmark wordmark-button" onClick={()=>setView('home')}><span className="wordmark-mark">A</span> Articulate</button><div className="app-nav-links"><button className={view==='home'?'nav-tab active':'nav-tab'} onClick={()=>setView('home')}>Practice</button><button className={view==='history'?'nav-tab active':'nav-tab'} onClick={()=>setView('history')}>My progress</button><span className="user-email">{user.email}</span><button className="signout-button" onClick={()=>void signOut()}>Sign out</button></div></nav>
    {view==='home'&&<><section className="dashboard-hero"><div><p className="eyebrow">✳ YOUR VOICE, YOUR PACE</p><h1>Make room for<br/><em>better conversations.</em></h1><p>Choose a prompt, speak your mind, and get feedback you can actually use. No perfect answers required.</p></div><div className="dashboard-stats"><div><strong>{sessions.filter(s=>s.status==='completed').length}</strong><span>Sessions completed</span></div><div><strong>{sessions.filter(s=>s.status==='completed'&&s.overall_score!==null).length?Math.round(sessions.filter(s=>s.status==='completed'&&s.overall_score!==null).reduce((n,s)=>n+(s.overall_score??0),0)/sessions.filter(s=>s.status==='completed'&&s.overall_score!==null).length):'—'}</strong><span>Average score</span></div></div></section><section className="prompt-section"><div className="section-title-row"><div><p className="eyebrow">PICK YOUR NEXT CHALLENGE</p><h2>What would you like to talk about?</h2></div><span className="count-label">{prompts.length} prompts</span></div><div className="filter-row">{categories.map(c=><button key={c} className={category===c?'filter-chip selected':'filter-chip'} onClick={()=>setCategory(c)}>{c}</button>)}</div>{dataError&&<p className="notice">{dataError}</p>}{loading&&!prompts.length?<p className="loading-screen"><span className="spinner"/> Loading prompts…</p>:<div className="prompt-grid">{visiblePrompts.map((p,i)=><article className="prompt-card" key={p.id}><div className="prompt-card-top"><span className="prompt-index">{String(i+1).padStart(2,'0')}</span><span className="difficulty">{p.difficulty||'Open'}</span></div><p className="prompt-category">{p.category}</p><h3>{p.question}</h3><div className="prompt-card-bottom"><span>◷ {Math.max(1,Math.round(p.suggested_duration_seconds/60))} min</span><button onClick={()=>startPrompt(p)}>Practice this →</button></div></article>)}</div>}</section></>}
    {view==='practice'&&selected&&<section className="practice-page"><button className="back-link" onClick={()=>setView('home')}>← Back to prompts</button><p className="eyebrow">{selected.category.toUpperCase()}</p><h1 className="practice-question">{selected.question}</h1><p className="practice-guidance">Take a breath, gather your thoughts, and speak naturally. You don't need to memorize anything.</p><div className="recorder-card"><div className={recording?'recording-orb is-recording':'recording-orb'}><span>{recording?'●':'♫'}</span></div><p className="recording-status">{recording?'Recording in progress':audioBlob?'Your recording is ready':'When you’re ready, begin speaking'}</p><strong className="recording-time">{duration(elapsed)}</strong><div className="recorder-actions">{!recording&&!audioBlob&&<button className="primary-button" onClick={()=>void startRecording()}>Start recording ●</button>}{recording&&<button className="primary-button stop-button" onClick={stopRecording}>Stop recording ■</button>}{audioBlob&&!processing&&<><button className="secondary-button" onClick={()=>{setAudioBlob(null);setElapsed(0);setRecordMessage('');}}>Record again</button><button className="primary-button" onClick={()=>void submitRecording()}>Get my feedback →</button></>}{processing&&<button className="primary-button" disabled><span className="spinner small-spinner"/> Working on it…</button>}</div>{recordMessage&&<p className={processing?'notice processing-notice':'notice'} role="status">{recordMessage}</p>}<p className="recorder-footnote">Audio is converted to WAV in your browser and sent to Groq for transcription. Articulate saves your transcript and feedback, not the original audio.</p></div></section>}
    {view==='results'&&latest&&<section className="results-page"><button className="back-link" onClick={()=>setView('history')}>← View all sessions</button><p className="eyebrow">YOUR SPEAKING REVIEW</p><h1>Good work showing up.</h1><p className="results-question">{latest.prompts?.question}</p><div className="score-overview"><div className="overall-score"><span>Overall score</span><strong>{latest.overall_score??'—'}<small>/100</small></strong><span>{duration(latest.duration_seconds)} spoken</span></div><div className="score-grid">{scores.map(([key,label])=><div className="score-item" key={key}><div><span>{label}</span><strong>{latest.evaluation?.[key]??'—'}/100</strong></div><div className="score-track"><span style={{width:`${latest.evaluation?.[key]??0}%`}}/></div></div>)}</div></div><div className="results-columns"><div className="results-main"><article className="result-card"><p className="eyebrow">THE BIG PICTURE</p><h2>What stood out</h2><p>{latest.evaluation?.summary||'Your transcript has been saved.'}</p></article><article className="result-card"><p className="eyebrow">KEEP DOING THIS</p><h2>Your strengths</h2>{latest.evaluation?.strengths?.length?<ul>{latest.evaluation.strengths.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p>No strengths returned.</p>}</article><article className="result-card"><p className="eyebrow">ONE STEP BETTER</p><h2>Ways to improve</h2>{latest.evaluation?.improvement_areas?.map((x,i)=><div className="feedback-item" key={i}><h3>{x.title}</h3><p>{x.explanation}</p>{x.example&&<blockquote>{x.example}</blockquote>}</div>)}</article>{latest.evaluation?.transcript_feedback?.length?<article className="result-card"><p className="eyebrow">YOUR WORDS, REVISITED</p><h2>Try saying it this way</h2>{latest.evaluation.transcript_feedback.map((x,i)=><div className="feedback-item" key={i}><blockquote>“{x.quote}”</blockquote><p><strong>Try:</strong> {x.suggestion}</p><p className="muted">{x.reason}</p></div>)}</article>:null}{latest.evaluation?.rewritten_example&&<article className="result-card"><p className="eyebrow">A NATURAL REWRITE</p><h2>Example response</h2><p>{latest.evaluation.rewritten_example}</p></article>}</div><aside className="results-side"><article className="next-action-card"><p className="eyebrow">YOUR NEXT REP</p><h2>Focus on one thing.</h2><p>{latest.evaluation?.next_action||'Try another prompt and focus on making your main point clear.'}</p><button className="primary-button full-button" onClick={()=>setView('home')}>Practice again →</button></article><article className="transcript-card"><p className="eyebrow">YOUR TRANSCRIPT</p><p>{latest.transcript}</p></article></aside></div></section>}
    {view==='history'&&<section className="history-page"><p className="eyebrow">SMALL STEPS ADD UP</p><h1>Your progress, <em>in your words.</em></h1><p className="history-intro">Every session is a snapshot of what you can do today—and a starting point for tomorrow.</p>{loading&&!sessions.length?<p className="loading-screen"><span className="spinner"/> Loading history…</p>:!sessions.length?<div className="empty-card"><h2>Your first session is waiting.</h2><p>Choose a prompt and record a short response. Your transcript and feedback will appear here.</p><button className="primary-button" onClick={()=>setView('home')}>Choose a prompt →</button></div>:<div className="history-list">{sessions.map(s=><article className="history-card" key={s.id}><div className="history-score">{s.overall_score??'—'}<small>/100</small></div><div className="history-content"><span className="prompt-category">{s.prompts?.category||'Speaking practice'} · {dateLabel(s.created_at)}</span><h3>{s.prompts?.question||'Speaking session'}</h3><p>{s.evaluation?.summary||s.transcript||'No transcript available.'}</p><span className={s.status==='completed'?'session-status completed':'session-status'}>{s.status}</span></div><button className="history-open" disabled={!s.evaluation} onClick={()=>{setLatest(s);setView('results');}}>Review →</button></article>)}</div>}</section>}
    <footer className="app-footer"><button className="wordmark wordmark-button" onClick={()=>setView('home')}><span className="wordmark-mark">A</span> Articulate</button><span>Progress over perfection. Every single time.</span><span>AI feedback is a practice aid, not an objective measure of your speaking ability.</span></footer>
  </main>;
}
