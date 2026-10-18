import { useState } from 'react';

const features = [
  { number: '01', title: 'Practice out loud', description: 'Start with a short speaking session. Focus on expressing the thought, not getting every word perfect.' },
  { number: '02', title: 'See what you said', description: 'Turn your recording into a transcript you can revisit and learn from.' },
  { number: '03', title: 'Improve with intention', description: 'Get structured, specific feedback that helps you choose one clear thing to work on next.' },
];

export default function App() {
  const [email, setEmail] = useState('');

  return (
    <main className="page-shell">
      <nav className="nav-bar" aria-label="Main navigation">
        <a className="wordmark" href="#top" aria-label="Articulate home"><span className="wordmark-mark">a.</span> articulate</a>
        <a className="nav-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> YOUR VOICE, WITH MORE CLARITY</p>
          <h1>Think clearly.<br /><em>Speak confidently.</em></h1>
          <p className="hero-description">A little practice can change the way you express yourself. Articulate helps you reflect on your speaking, understand your habits, and grow one conversation at a time.</p>
          <a className="primary-button" href="#get-started">Start your journey <span aria-hidden="true">→</span></a>
          <p className="microcopy">Progress over perfection. Every single time.</p>
        </div>
        <div className="hero-art" aria-label="Illustration of a speaking practice session">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="note note-top"><span className="note-icon">✳</span><span><strong>Your ideas matter.</strong><small>Make them heard.</small></span></div>
          <div className="sound-card">
            <div className="sound-card-top"><span className="record-dot" /> SPEAKING SESSION <span className="sound-time">00:42</span></div>
            <div className="waveform" aria-hidden="true">{Array.from({ length: 39 }, (_, i) => <span key={i} style={{ height: `${12 + Math.abs(Math.sin(i * 1.37) * Math.cos(i * 0.31)) * 48}px` }} />)}</div>
            <div className="sound-card-bottom"><span>Finding your rhythm</span><span className="wave-check">✓</span></div>
          </div>
          <div className="note note-bottom"><span className="quote-mark">“</span><span><strong>One thought at a time.</strong><small>Take your space.</small></span></div>
          <div className="sparkle sparkle-one">✳</div><div className="sparkle sparkle-two">✦</div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-heading"><p className="eyebrow">SMALL STEPS, REAL GROWTH</p><h2>Make every word <em>count.</em></h2><p>Speaking well isn't about sounding perfect. It's about being understood—and feeling good about how you show up.</p></div>
        <div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><span className="feature-number">{feature.number}</span><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div>
      </section>

      <section className="start-section" id="get-started"><div><p className="eyebrow">YOUR NEXT CONVERSATION STARTS HERE</p><h2>Give your voice<br /><em>room to grow.</em></h2></div><form className="signup-form" onSubmit={(event) => { event.preventDefault(); if (email.trim()) window.alert('The sign-in flow will be connected in the next implementation step.'); }}><label htmlFor="email">Get ready to begin</label><div className="input-row"><input id="email" type="email" placeholder="Your email address" value={email} onChange={(event) => setEmail(event.target.value)} required /><button type="submit">Get started <span aria-hidden="true">→</span></button></div><p>Authentication is not connected yet. This is a UI scaffold.</p></form></section>
      <footer className="footer"><a className="wordmark" href="#top"><span className="wordmark-mark">a.</span> articulate</a><span>Find your words. Find your voice.</span><span>Built for growth, not perfection.</span></footer>
    </main>
  );
}
