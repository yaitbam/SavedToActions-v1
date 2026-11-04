import { useEffect, useRef, useState } from "react";
import { Chip } from "../../ui/Chip";
import { Button } from "../../ui/Button";

const posts = [
  { handle: "build.weekend", initials: "bw", category: "THE NEXT THING YOU’LL BUILD", title: "A weekend.\nOne working idea.", body: "Bring a small idea to life. Submit your working prototype by Nov 14, 18:00 UTC.", quote: "Nov 14, 18:00 UTC", caption: "A hackathon worth entering", kind: "01 / OPPORTUNITY" },
  { handle: "practice.studio", initials: "ps", category: "MAKE SPACE TO LEARN", title: "Less watching.\nMore making.", body: "A practical course in visual storytelling. Build a three-frame story with your own photographs.", quote: "three-frame story", caption: "A course you meant to start", kind: "02 / LEARNING" },
  { handle: "prompt.notes", initials: "pn", category: "FROM NOTES TO NEXT STEPS", title: "Good notes\ndeserve action.", body: "Try this prompt: Turn these meeting notes into three concrete next steps. Keep each step under 20 words.", quote: "under 20 words", caption: "A prompt to put to work", kind: "03 / PRACTICE" },
];
export function SocialCapture({ index = 0, highlight = false }: { index?: number; highlight?: boolean }) {
  const post = posts[index];
  const [before, after] = post.body.split(post.quote);
  return <article className={`social-capture capture-${index}`} aria-label={`Illustrative post by ${post.handle}`}>
    <div className="capture-status"><span>9:41</span><span>▰ ▰ ▰</span></div>
    <header><span className="capture-avatar">{post.initials}</span><div><strong>{post.handle}</strong><small>Original post · Fictional account</small></div><span>···</span></header>
    <div className="capture-art"><span>{post.category}</span><h3>{post.title}</h3><div className="capture-art-grid" aria-hidden="true"><i/><i/><i/><i/></div></div>
    <div className="capture-body"><div className="capture-actions" aria-hidden="true">♡　↗ <span>▣</span></div><p>{before}<mark className={highlight ? "quote-lit" : ""}>{post.quote}</mark>{after}</p><small>Saved for later</small></div>
  </article>;
}
export function CalendarBlock({ state, title = "Build your prototype", minutes = 45, moved = false }: { state: "proposed" | "verified" | "conflict"; title?: string; minutes?: number; moved?: boolean }) {
  return <div className={`calendar-block ${state}`}><time>{moved ? "14:00" : "10:00"} — {moved ? "14" : "10"}:{minutes === 60 ? "00 +1h" : String(minutes).padStart(2,"0")} · {minutes} MIN</time><strong>{title}</strong><div className="mt-3"><Chip tone={state === "verified" ? "fits" : state === "conflict" ? "conflict" : "neutral"}>{state === "verified" ? "✓ Read-back verified" : state === "conflict" ? "Conflict" : "Proposed"}</Chip></div></div>;
}
export function BookmarkToCalendar() {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState(0);
  const [minutes, setMinutes] = useState(45);
  return <div className="hero-machine">
    <div className="machine-head"><span>INTENTION → COMMITMENT</span><Chip>Interactive demo</Chip></div>
    <div className="machine-split"><div className="graveyard"><div className="ghost-capture ghost-one"/><div className="ghost-capture ghost-two"/><SocialCapture index={index}/><div className="capture-picker">{posts.map((p,i)=><button key={p.handle} aria-label={p.caption} aria-pressed={i===index} onClick={()=>{setIndex(i);setStage(0);}}>{String(i+1).padStart(2,"0")}</button>)}</div></div>
    <div className="calendar-reality"><svg className={`transfer-path ${stage > 0 ? "active" : ""}`} viewBox="0 0 240 40" aria-hidden="true"><path d="M0 20 H95 Q120 20 120 10 Q120 0 145 0 H240"/></svg><p className="eyebrow">YOUR TIME, PROTECTED</p><div className="calendar-day"><span>FRIDAY</span><strong>13</strong><span>NOV 2026 · UTC</span></div><div className="calendar-rules"><span>09:00</span><span>10:00</span><span>11:00</span></div><div className="calendar-position"><CalendarBlock state={stage===2 ? "verified":"proposed"} minutes={minutes} title={["Build your prototype","Practise visual storytelling","Try the meeting prompt"][index]}/></div>
    <div className="demo-controls">{stage===0 ? <><label className="mono">Your minutes <select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[30,45,60].map(n=><option key={n}>{n}</option>)}</select></label><Button onClick={()=>setStage(1)}>Confirm duration →</Button></> : stage===1 ? <Button onClick={()=>setStage(2)}>Approve demo block →</Button> : <><p role="status" className="text-small text-fits">Start, end & timezone matched.</p><Button variant="text" onClick={()=>setStage(0)}>Replay</Button></>}</div></div></div><p className="demo-caption">Fictional posts · Simulated calendar · Nothing is booked</p>
  </div>;
}
export function EvidenceInspector() {
  const [field,setField]=useState<string|null>("deadline");
  return <div className="inspection-grid"><div className="inspection-source"><SocialCapture highlight={field==="deadline"}/><p className="demo-caption">Illustrative source capture</p></div><div className="inspection-fields"><p className="eyebrow">EXTRACTED, WITH RECEIPTS</p><h3>Every fact has a source.</h3><p className="section-copy">Select a field. See exactly where it came from.</p>{[{id:"deadline",label:"Deadline",value:posts[0].quote},{id:"location",label:"Location",value:"Missing"},{id:"link",label:"Registration link",value:"Missing"}].map(f=><button className={`evidence-row ${field===f.id ? "selected":""}`} key={f.id} onMouseEnter={()=>setField(f.id)} onFocus={()=>setField(f.id)} onClick={()=>setField(f.id)} aria-pressed={field===f.id}><span>{f.label}<strong>{f.value}</strong></span><Chip tone={f.id==="deadline" ? "fits":"missing"}>{f.id==="deadline" ? "Quote matched":"Missing"}</Chip></button>)}<div className="source-excerpt" aria-live="polite"><span className="eyebrow">{field==="deadline" ? "EXACT TRANSCRIPTION QUOTE":"NO SUPPORTING EVIDENCE"}</span><p>{field==="deadline" ? `“${posts[0].body}”` : "Not stated in the source. Left missing, never filled in by guesswork."}</p></div></div></div>;
}
export function PipelineDemo() {
  const [step,setStep]=useState(0);
  const [running,setRunning]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{if(!entry.isIntersecting)setRunning(false);});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!running || step>=3)return;const timer=setTimeout(()=>{setStep(n=>n+1);},2300);return()=>clearTimeout(timer);},[step,running]);
  const labels=["Downscale image to 1280px","Extract & match quote evidence","Validate date & IANA timezone","Ready to review extraction","get_availability() → find_slot()","Ready for your approval"];
  return <div ref={ref} className="pipeline-demo"><div className="machine-head"><span>EXTRACTION / PLANNING</span><Chip>Simulation</Chip></div><ol>{labels.map((label,i)=><li key={label} className={i<step ? "complete":i===step ? "current":""}><span>{String(i+1).padStart(2,"0")}</span><span>{label}</span><span>{i<step ? "✓":i===step ? "←":"·"}</span></li>)}</ol><div className="demo-controls">{step<3 ? <Button onClick={()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches){setStep(3);}else setRunning(!running);}}>{running ? "Pause":"Play extraction"}</Button> : step===3 ? <Button onClick={()=>{setStep(4);setRunning(false);}}>Confirm 45 minutes</Button> : step===4 ? <Button onClick={()=>setStep(5)}>Find a demo slot</Button> : <Chip>Awaiting explicit approval</Chip>}<Button variant="text" onClick={()=>{setStep(0);setRunning(false);}}>Reset</Button></div><p className="demo-caption">~7 seconds observed average extraction. Planning starts after you confirm effort.</p></div>;
}
export function RescheduleDemo() {
  const [step,setStep]=useState(0);
  return <div className="reschedule-demo"><div className="machine-head"><span>WHEN YOUR WEEK CHANGES</span><Chip>Simulation</Chip></div><div className="reschedule-slots"><div><p className="eyebrow">ORIGINAL · 10:00</p><div className={step===3 ? "superseded":""}><CalendarBlock state={step===0 || step===3 ? "verified":"conflict"}/></div>{step===3 && <Chip tone="missing">Superseded</Chip>}{step>0 && <div className="meeting-collision">Team meeting · 10:00–11:00</div>}</div><div><p className="eyebrow">ALTERNATIVE · 14:00</p>{step>=2 ? <CalendarBlock moved state={step===3 ? "verified":"proposed"}/> : <div className="empty-slot">Room for a new plan.</div>}</div></div><div className="demo-controls"><Button onClick={()=>setStep((step+1)%4)}>{["Add a meeting collision","Propose a new time","Approve demo move","Replay"][step]}</Button><p className="text-small text-muted" aria-live="polite">{["Your approved block is protected.","Overlap detected. Your approval is needed.","A free slot is proposed. Nothing has moved.","Replacement verified. Old block superseded."][step]}</p></div></div>;
}
