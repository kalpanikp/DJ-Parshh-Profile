/* PARSHH BOOTH — two media players + 2-ch mixer, all audio generated live with Web Audio */
(function(){
const $ = (s, r=document) => r.querySelector(s), $$ = (s, r=document) => [...r.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- track definitions (synth loops) ---------- */
const TRACKS = [
  { title:'Gold Circuit', artist:'Parshh — booth loop', bpm:122, key:'8A', col:'#E9D2A6',
    bass:[55.00,55.00,65.41,49.00], chord:[[220,261.63,329.63],[220,261.63,329.63],[261.63,329.63,392],[196,246.94,293.66]] },
  { title:'Marigold Hours', artist:'Parshh — booth loop', bpm:118, key:'10A', col:'#FF7A9A',
    bass:[73.42,73.42,82.41,65.41], mel:[587.33,659.25,739.99,880,987.77,880,739.99,659.25] }
];
const MODES = ['Full','Break','Drums','Build'];

/* events per 16th step: [instrument, velocity, extra] */
function events(d, bar, s, mode){
  const ev = [], b4 = bar % 4, full = mode==='Full', brk = mode==='Break', dr = mode==='Drums', bld = mode==='Build';
  if(d === 0){ // deep house
    if(!brk && s%4===0) ev.push(['kick', 1]);
    if(!brk && (s===4||s===12)) ev.push(['clap', .8]);
    if(s%4===2) ev.push(['hatO', brk?.15:.32]);
    if(!brk && s%2===1) ev.push(['hat', .12]);
    if((full||brk) && (s===2||s===6||s===10||s===14||(s===15&&b4%2))) ev.push(['bass', .9, TRACKS[0].bass[b4]]);
    if((full||brk) && (s===3||s===10)) ev.push(['stab', brk?.9:.6, TRACKS[0].chord[b4]]);
    if(brk && s===0) ev.push(['pad', .8, TRACKS[0].chord[b4]]);
    if(bld){ const rate = b4<2 ? 4 : b4<3 ? 2 : 1; if(s%rate===0) ev.push(['snare', .25+.18*b4+.03*s/rate]); if(s%4===0) ev.push(['kick', 1]); }
  } else { // afro house
    if(!brk && s%4===0) ev.push(['kick', .9]);
    if(!brk && (s===3||s===6||s===11||s===14)) ev.push(['congaH', .55]);
    if(!brk && (s===2||s===7||s===10)) ev.push(['congaL', .6]);
    ev.push(['shaker', (s%4===2? .22 : .1) * (brk?.6:1)]);
    if(!brk && (s===4||s===12)) ev.push(['rim', .35]);
    if((full||brk) && (s===0||s===3||s===6||s===10) && !(brk&&s!==0)) ev.push(['log', .9, TRACKS[1].bass[b4]]);
    if((full||brk) && [0,3,6,8,11,14].includes(s)) ev.push(['pluck', brk?.5:.32, TRACKS[1].mel[(s+bar*3)%8]]);
    if(bld){ const rate = b4<2 ? 4 : b4<3 ? 2 : 1; if(s%rate===0) ev.push(['congaH', .3+.2*b4]); if(s%4===0) ev.push(['kick', .9]); }
  }
  return ev;
}
/* waveform band weights + decay (in 1/16-of-a-step units) */
const BAND = { kick:[1,.18,.02,10], clap:[.05,.6,.55,6], snare:[.08,.55,.5,5], hat:[0,.05,.45,2], hatO:[0,.1,.6,5], bass:[.75,.3,.03,8], stab:[.1,.6,.35,6], pad:[.2,.5,.3,40],
  congaH:[.05,.6,.25,4], congaL:[.25,.55,.1,5], shaker:[0,.05,.4,2], rim:[0,.4,.5,2], log:[.85,.25,.02,9], pluck:[.02,.45,.45,6] };
const SUB = 16, CYC = 4*16*SUB; // 4 bars of samples
function buildEnv(d, mode){
  const L = new Float32Array(CYC), M = new Float32Array(CYC), H = new Float32Array(CYC);
  for(let bar=0; bar<4; bar++) for(let s=0; s<16; s++) for(const [ins, v] of events(d, bar, s, mode)){
    const w = BAND[ins]; const s0 = (bar*16+s)*SUB;
    for(let k=0; k<w[3]*4; k++){ const i=(s0+k)%CYC, e=v*Math.exp(-k/w[3]); L[i]+=w[0]*e; M[i]+=w[1]*e; H[i]+=w[2]*e; }
  }
  return {L,M,H};
}
const ENV = [0,1].map(d => Object.fromEntries(MODES.map(m => [m, buildEnv(d, m)])));

/* ---------- audio engine ---------- */
let ctx = null, E = {}, noise = null;
function ensure(){
  if(ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  E.sum = ctx.createGain();
  E.out = ctx.createGain(); E.out.gain.value = .8;
  E.lim = ctx.createDynamicsCompressor(); E.lim.threshold.value = -6; E.lim.ratio.value = 12; E.lim.attack.value = .003; E.lim.release.value = .15;
  E.an = ctx.createAnalyser(); E.an.fftSize = 512; E.fq = new Uint8Array(E.an.frequencyBinCount);
  E.split = ctx.createChannelSplitter(2); E.anL = ctx.createAnalyser(); E.anR = ctx.createAnalyser(); E.anL.fftSize = E.anR.fftSize = 256; E.td = new Float32Array(256);
  E.sum.connect(E.out);
  // beat fx
  E.send = ctx.createGain(); E.send.gain.value = 0; E.sum.connect(E.send);
  E.dl = ctx.createDelay(2); E.fb = ctx.createGain(); E.fb.gain.value = .45; E.dlf = ctx.createBiquadFilter(); E.dlf.type='lowpass'; E.dlf.frequency.value = 5200;
  E.dl.connect(E.dlf); E.dlf.connect(E.fb); E.fb.connect(E.dl);
  E.rv = ctx.createConvolver(); E.rv.buffer = impulse(2.6);
  E.echoIn = ctx.createGain(); E.revIn = ctx.createGain(); E.echoIn.gain.value = 1; E.revIn.gain.value = 0;
  E.send.connect(E.echoIn); E.send.connect(E.revIn); E.echoIn.connect(E.dl); E.revIn.connect(E.rv);
  E.wet = ctx.createGain(); E.wet.gain.value = .8; E.dlf.connect(E.wet); E.rv.connect(E.wet); E.wet.connect(E.out);
  E.out.connect(E.lim); E.lim.connect(E.an); E.lim.connect(ctx.destination); E.lim.connect(E.split); E.split.connect(E.anL,0); E.split.connect(E.anR,1);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const nd = noise.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i] = Math.random()*2-1;
  DECKS.forEach(d => d.init());
  applyXf(); applyFx();
  setInterval(schedule, 25);
  return ctx;
}
function impulse(sec){ const n = ctx.sampleRate*sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for(let c=0;c<2;c++){ const d=b.getChannelData(c); for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n, 2.8); } return b; }

/* instruments — (t, dest, vel, extra) */
const I = {
  kick(t,o,v){ const s=ctx.createOscillator(), g=ctx.createGain(); s.frequency.setValueAtTime(150,t); s.frequency.exponentialRampToValueAtTime(44,t+.16); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(.001,t+.42); s.connect(g).connect(o); s.start(t); s.stop(t+.45);
    const c=ctx.createBufferSource(), cf=ctx.createBiquadFilter(), cg=ctx.createGain(); c.buffer=noise; cf.type='highpass'; cf.frequency.value=3000; cg.gain.setValueAtTime(v*.25,t); cg.gain.exponentialRampToValueAtTime(.001,t+.012); c.connect(cf).connect(cg).connect(o); c.start(t); c.stop(t+.02); },
  nz(t,o,v,f,type,dec,q){ const s=ctx.createBufferSource(), fl=ctx.createBiquadFilter(), g=ctx.createGain(); s.buffer=noise; s.playbackRate.value=.8+Math.random()*.4; fl.type=type; fl.frequency.value=f; if(q) fl.Q.value=q; g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(.001,t+dec); s.connect(fl).connect(g).connect(o); s.start(t, Math.random()*.5); s.stop(t+dec+.02); },
  clap(t,o,v){ [0,.011,.022].forEach((d,i)=>I.nz(t+d,o,v*(i<2?.6:1),1400,'bandpass',i<2?.02:.16,1.2)); },
  snare(t,o,v){ I.nz(t,o,v,1800,'bandpass',.12,.9); const s=ctx.createOscillator(), g=ctx.createGain(); s.frequency.value=190; g.gain.setValueAtTime(v*.5,t); g.gain.exponentialRampToValueAtTime(.001,t+.08); s.connect(g).connect(o); s.start(t); s.stop(t+.1); },
  hat(t,o,v){ I.nz(t,o,v,8000,'highpass',.04); },
  hatO(t,o,v){ I.nz(t,o,v,7000,'highpass',.2); },
  shaker(t,o,v){ I.nz(t,o,v,9000,'highpass',.05); },
  rim(t,o,v){ const s=ctx.createOscillator(), g=ctx.createGain(); s.type='square'; s.frequency.value=1700; g.gain.setValueAtTime(v*.4,t); g.gain.exponentialRampToValueAtTime(.001,t+.03); s.connect(g).connect(o); s.start(t); s.stop(t+.04); },
  conga(t,o,v,f){ const s=ctx.createOscillator(), g=ctx.createGain(); s.frequency.setValueAtTime(f*1.6,t); s.frequency.exponentialRampToValueAtTime(f,t+.03); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(.001,t+.22); s.connect(g).connect(o); s.start(t); s.stop(t+.25); },
  congaH(t,o,v){ I.conga(t,o,v,330); }, congaL(t,o,v){ I.conga(t,o,v,196); },
  bass(t,o,v,hz,spb){ const s=ctx.createOscillator(), f=ctx.createBiquadFilter(), g=ctx.createGain(); s.type='sawtooth'; s.frequency.value=hz; f.type='lowpass'; f.Q.value=6; f.frequency.setValueAtTime(700,t); f.frequency.exponentialRampToValueAtTime(110,t+spb*.4); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(v*.38,t+.008); g.gain.exponentialRampToValueAtTime(.001,t+spb*.45); s.connect(f).connect(g).connect(o); s.start(t); s.stop(t+spb*.5); },
  log(t,o,v,hz){ const s=ctx.createOscillator(), g=ctx.createGain(), ws=ctx.createWaveShaper(); const c=new Float32Array(256); for(let i=0;i<256;i++){const x=i/128-1; c[i]=Math.tanh(x*2.2);} ws.curve=c;
    s.frequency.setValueAtTime(hz*2,t); s.frequency.exponentialRampToValueAtTime(hz,t+.05); g.gain.setValueAtTime(v*.5,t); g.gain.exponentialRampToValueAtTime(.001,t+.32); s.connect(ws).connect(g).connect(o); s.start(t); s.stop(t+.35); },
  stab(t,o,v,ch){ ch.forEach(hz=>{ const s=ctx.createOscillator(), f=ctx.createBiquadFilter(), g=ctx.createGain(); s.type='sawtooth'; s.frequency.value=hz; s.detune.value=(Math.random()-.5)*14; f.type='lowpass'; f.frequency.setValueAtTime(2600,t); f.frequency.exponentialRampToValueAtTime(400,t+.18); g.gain.setValueAtTime(v*.09,t); g.gain.exponentialRampToValueAtTime(.001,t+.22); s.connect(f).connect(g).connect(o); s.start(t); s.stop(t+.25); }); },
  pad(t,o,v,ch,spb){ ch.forEach(hz=>[0,7].forEach(dt=>{ const s=ctx.createOscillator(), g=ctx.createGain(); s.type='triangle'; s.frequency.value=hz; s.detune.value=dt; g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(v*.04,t+spb*4); g.gain.linearRampToValueAtTime(.0001,t+spb*16); s.connect(g).connect(o); s.start(t); s.stop(t+spb*16); })); },
  pluck(t,o,v,hz){ [1,2].forEach((m,i)=>{ const s=ctx.createOscillator(), g=ctx.createGain(); s.type=i?'sine':'triangle'; s.frequency.value=hz*m; g.gain.setValueAtTime(v*(i?.08:.22),t); g.gain.exponentialRampToValueAtTime(.001,t+.35); s.connect(g).connect(o); s.start(t); s.stop(t+.4); }); }
};

/* ---------- deck ---------- */
class Deck {
  constructor(i){ this.i=i; this.t=TRACKS[i]; this.pitch=0; this.range=8; this.bend=1; this.playing=false; this.mode='Full';
    this.step=0; this.nextT=0; this.pos=0; this.buf=null; this.src=null; this.fpos=0; this.fband=null; this.cues=[null,null,null,null]; this.synced=false; this.beatQ=[]; this.angle=0; this.started=null; }
  init(){ const c=ctx; this.in=c.createGain(); this.trim=c.createGain();
    this.lo=c.createBiquadFilter(); this.lo.type='lowshelf'; this.lo.frequency.value=220;
    this.mid=c.createBiquadFilter(); this.mid.type='peaking'; this.mid.frequency.value=1000; this.mid.Q.value=.8;
    this.hi=c.createBiquadFilter(); this.hi.type='highshelf'; this.hi.frequency.value=3800;
    this.flt=c.createBiquadFilter(); this.flt.type='lowpass'; this.flt.frequency.value=22000; this.flt.Q.value=1;
    this.fader=c.createGain(); this.xf=c.createGain(); this.an=c.createAnalyser(); this.an.fftSize=256; this.td=new Float32Array(256);
    this.in.connect(this.trim).connect(this.lo).connect(this.mid).connect(this.hi).connect(this.flt).connect(this.fader).connect(this.xf).connect(E.sum);
    this.fader.connect(this.an); syncNodes(this); }
  get spb(){ return 60/this.bpm; }
  get bpm(){ return (this.buf ? (this.fileBpm||120) : this.t.bpm) * (1+this.pitch/100) * this.bend; }
  get baseBpm(){ return this.buf ? this.fileBpm : this.t.bpm; }
  play(){ ensure(); ctx.resume(); if(this.playing) return; this.playing=true;
    if(this.buf){ this.startSrc(); }
    else { const other=DECKS[1-this.i]; if(this.synced && other.playing && !other.buf){ this.alignTo(other); } else { this.nextT=ctx.currentTime+.04; this.step=Math.round(this.pos); } }
    if(!master() || master()===this) setMaster(this);
    ui(); }
  pause(){ if(!this.playing) return; this.pos=this.curPos(); this.playing=false; if(this.src){ try{this.src.stop()}catch(e){} this.src=null; } if(MASTER===this){ const o=DECKS[1-this.i]; setMaster(o.playing?o:null);} ui(); }
  toggle(){ this.playing ? this.pause() : this.play(); }
  cue(){ ensure(); if(this.buf){ const was=this.playing; this.pause(); this.fpos=0; this.pos=0; if(was) this.play(); }
    else { this.pos=0; this.step=0; if(this.playing){ this.nextT=ctx.currentTime+.04; } } }
  curPos(){ if(!this.playing || !ctx) return this.pos; if(this.buf) return this.fpos; return this.step - Math.max(0,(this.nextT-ctx.currentTime))/(this.spb/4); }
  alignTo(o){ this.nextT=o.nextT; this.step=o.step; }
  startSrc(){ const s=ctx.createBufferSource(); s.buffer=this.buf; s.playbackRate.value=(1+this.pitch/100)*this.bend; s.connect(this.in); s.start(0, this.fpos % this.buf.duration); s.onended=()=>{ if(this.src===s && this.playing){ this.playing=false; this.fpos=0; ui(); } }; this.src=s; this.lastT=ctx.currentTime; }
  sched(now){ if(!this.playing || this.buf) return; const look=now+.12;
    while(this.nextT < look){ const s16=this.step%16, bar=Math.floor(this.step/16), spb=this.spb;
      for(const [ins,v,x] of events(this.i, bar, s16, this.mode)) I[ins](this.nextT, this.in, v, x, spb);
      if(s16%4===0) this.beatQ.push([this.nextT, (s16/4)|0]);
      this.nextT += spb/4; this.step++; } }
  rate(){ if(this.src) this.src.playbackRate.setTargetAtTime(Math.max(.05,(1+this.pitch/100)*this.bend), ctx.currentTime, .02); }
}
const DECKS=[new Deck(0), new Deck(1)];
let MASTER=null; const master=()=>MASTER;
function setMaster(d){ MASTER=d; }
function schedule(){ if(!ctx) return; const now=ctx.currentTime; DECKS.forEach(d=>d.sched(now)); }

/* ---------- file loading ---------- */
async function loadFile(d, file){
  ensure(); const st=$(`#u${d.i} .tt`); st.textContent='Analysing…';
  try{
    const ab=await file.arrayBuffer(); const buf=await ctx.decodeAudioData(ab);
    d.pause(); d.buf=buf; d.fpos=0; d.pos=0; d.mode='Full'; d.cues=[null,null,null,null];
    d.fband=analyseBuf(buf); d.fileBpm=guessBpm(d.fband) ; d.fileName=file.name.replace(/\.[^.]+$/,'');
    ui();
  }catch(e){ st.textContent='Could not read that file'; }
}
function analyseBuf(buf){ const ch=buf.getChannelData(0), ch2=buf.numberOfChannels>1?buf.getChannelData(1):ch, sr=buf.sampleRate, win=Math.round(sr*.01), n=Math.floor(ch.length/win);
  const L=new Float32Array(n),M=new Float32Array(n),H=new Float32Array(n); let lp=0, lp2=0, a1=1-Math.exp(-2*Math.PI*180/sr), a2=1-Math.exp(-2*Math.PI*2500/sr);
  for(let w=0;w<n;w++){ let sl=0,sm=0,sh=0; for(let k=0;k<win;k++){ const x=(ch[w*win+k]+ch2[w*win+k])*.5; lp+=a1*(x-lp); lp2+=a2*(x-lp2); const lo=lp, hi=x-lp2, mi=lp2-lp; sl+=lo*lo; sm+=mi*mi; sh+=hi*hi; }
    L[w]=Math.sqrt(sl/win); M[w]=Math.sqrt(sm/win); H[w]=Math.sqrt(sh/win); }
  const nm=a=>{ let m=1e-6; for(const v of a) if(v>m) m=v; for(let i=0;i<a.length;i++) a[i]=Math.min(1,a[i]/m*1.1); }; nm(L); nm(M); nm(H);
  return {L,M,H,dt:.01}; }
function guessBpm(fb){ // autocorrelate low-band onsets over first 60s
  const L=fb.L, n=Math.min(L.length, 6000), on=new Float32Array(n); for(let i=1;i<n;i++) on[i]=Math.max(0,L[i]-L[i-1]);
  let best=120, bv=-1; for(let bpm=80; bpm<=160; bpm+=.5){ const lag=60/bpm/.01; let s=0; for(let i=0;i+lag*2<n;i+=1){ s+=on[i]*(on[Math.round(i+lag)]+.5*on[Math.round(i+lag*2)]); } if(s>bv){ bv=s; best=bpm; } }
  return best; }

/* ---------- mixer state ---------- */
const MX={ xf:.5, ch:[{trim:0,hi:0,mid:0,lo:0,cfx:0,fader:.85},{trim:0,hi:0,mid:0,lo:0,cfx:0,fader:.85}], master:.8, fx:{type:'Echo',div:1,on:false,depth:.6} };
const DIVS=[[.25,'1/4'],[.5,'1/2'],[.75,'3/4'],[1,'1'],[2,'2']];
function syncNodes(d){ if(!ctx) return; const c=MX.ch[d.i], t=ctx.currentTime;
  d.trim.gain.setTargetAtTime(Math.pow(10,c.trim/20),t,.02); d.hi.gain.setTargetAtTime(c.hi,t,.02); d.mid.gain.setTargetAtTime(c.mid,t,.02); d.lo.gain.setTargetAtTime(c.lo,t,.02);
  d.fader.gain.setTargetAtTime(c.fader*c.fader,t,.02);
  const x=c.cfx; if(Math.abs(x)<.04){ d.flt.type='lowpass'; d.flt.frequency.setTargetAtTime(22000,t,.03); d.flt.Q.value=.7; }
  else if(x<0){ d.flt.type='lowpass'; d.flt.frequency.setTargetAtTime(20000*Math.pow(150/20000,-x),t,.03); d.flt.Q.value=6; }
  else { d.flt.type='highpass'; d.flt.frequency.setTargetAtTime(30*Math.pow(7000/30,x),t,.03); d.flt.Q.value=6; } }
function applyXf(){ if(!ctx) return; const x=MX.xf, t=ctx.currentTime; DECKS[0].xf.gain.setTargetAtTime(Math.cos(x*Math.PI/2)*1.41,t,.01); DECKS[1].xf.gain.setTargetAtTime(Math.sin(x*Math.PI/2)*1.41,t,.01); }
function applyFx(){ if(!ctx) return; const f=MX.fx, t=ctx.currentTime, bpm=(MASTER?MASTER.bpm:120);
  E.dl.delayTime.setTargetAtTime(clamp(DIVS[f.div][0]*60/bpm,.02,1.95),t,.05);
  E.echoIn.gain.setTargetAtTime(f.type==='Echo'?1:0,t,.02); E.revIn.gain.setTargetAtTime(f.type==='Reverb'?1:0,t,.02);
  E.send.gain.setTargetAtTime(f.on?f.depth:0,t,.03); E.out.gain.setTargetAtTime(MX.master,t,.02); }

/* ---------- sampler ---------- */
const SAMP={
  Riser(){ const t=ctx.currentTime, b=(MASTER?MASTER.spb:.5)*8, s=ctx.createBufferSource(), f=ctx.createBiquadFilter(), g=ctx.createGain(); s.buffer=noise; s.loop=true; f.type='bandpass'; f.Q.value=3; f.frequency.setValueAtTime(300,t); f.frequency.exponentialRampToValueAtTime(9000,t+b); g.gain.setValueAtTime(.001,t); g.gain.exponentialRampToValueAtTime(.5,t+b); g.gain.linearRampToValueAtTime(0,t+b+.05); s.connect(f).connect(g).connect(E.sum); s.start(t); s.stop(t+b+.1);
    const o=ctx.createOscillator(), og=ctx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(110,t); o.frequency.exponentialRampToValueAtTime(880,t+b); og.gain.setValueAtTime(.001,t); og.gain.exponentialRampToValueAtTime(.06,t+b); og.gain.linearRampToValueAtTime(0,t+b+.05); o.connect(og).connect(E.sum); o.start(t); o.stop(t+b+.1); return b; },
  Impact(){ const t=ctx.currentTime, o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(28,t+1.4); g.gain.setValueAtTime(1,t); g.gain.exponentialRampToValueAtTime(.001,t+1.8); o.connect(g).connect(E.sum); o.start(t); o.stop(t+1.9); I.nz(t,E.sum,.7,900,'lowpass',.9); return 1; },
  Horn(){ const t=ctx.currentTime; [0,.22,.44,.62].forEach((d,k)=>{ const len=k===3?.55:.16; [311,466,622].forEach(hz=>{ const o=ctx.createOscillator(), f=ctx.createBiquadFilter(), g=ctx.createGain(), l=ctx.createOscillator(), lg=ctx.createGain(); o.type='sawtooth'; o.frequency.value=hz; l.frequency.value=7; lg.gain.value=6; l.connect(lg).connect(o.frequency); f.type='lowpass'; f.frequency.value=3200; g.gain.setValueAtTime(.0001,t+d); g.gain.linearRampToValueAtTime(.09,t+d+.02); g.gain.setValueAtTime(.09,t+d+len-.03); g.gain.linearRampToValueAtTime(.0001,t+d+len); o.connect(f).connect(g).connect(E.sum); o.start(t+d); l.start(t+d); o.stop(t+d+len+.02); l.stop(t+d+len+.02); }); }); return 1.2; },
  Roll(){ const t=ctx.currentTime, spb=(MASTER?MASTER.spb:.5); for(let i=0;i<16;i++) I.clap(t+i*spb/8, E.sum, .15+i*.045); return spb*2; }
};

/* ---------- UI ---------- */
const icoPlay='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l10 8-10 8z" fill="currentColor"/><rect x="17" y="4" width="2.2" height="16" fill="currentColor"/><rect x="20.3" y="4" width="2.2" height="16" fill="currentColor"/></svg>';
const PADC=['#FF3B5C','#FF8A1F','#2BFF6A','#3FA9F5'];
function deckHTML(i){ const t=TRACKS[i]; return `
<div class="unit deck" id="u${i}" data-d="${i}" aria-label="Deck ${i+1}">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:0 14px"><span class="brand"><b>PARSHH</b> PLAYER</span><span class="sub">Deck ${i+1} · Media player</span></div>
  <div class="screen"><div class="glass">
    <div class="srow"><div class="trk"><span class="dn">${i+1}</span><span class="tt">${t.title}</span><span class="ta">${t.artist}</span></div>
      <div class="tags"><i class="ms">MASTER</i><i class="sy">SYNC</i><i class="lp">LOOP</i></div></div>
    <canvas class="wave" width="900" height="192" aria-label="Scrolling waveform, low frequencies blue, mids orange, highs white"></canvas>
    <canvas class="ov" width="900" height="40" aria-hidden="true"></canvas>
    <div class="info">
      <div><div class="k">Time</div><div class="v tm">00:00<small>.0</small></div></div>
      <div><div class="k">Tempo</div><div class="v tp">0.00<small>%</small></div></div>
      <div><div class="k">Key</div><div class="v ky">${t.key}</div></div>
      <div><div class="k">BPM</div><div class="v bp">${t.bpm.toFixed(1)}</div><div class="bb"><i></i><i></i><i></i><i></i></div></div>
    </div>
  </div></div>
  <div class="dbody">
    <div class="lcol">
      <label class="sq ld" title="Load your own track">Load<input type="file" accept="audio/*" aria-label="Load an audio file to deck ${i+1}"></label>
      <button class="sq vinyl on" type="button" style="--led:#3FA9F5" aria-pressed="true">Vinyl</button>
      <button class="rb cue" type="button" aria-label="Cue deck ${i+1}"><span style="font-family:var(--mono);font-size:11px;letter-spacing:.1em">CUE</span></button>
      <button class="rb play" type="button" aria-label="Play or pause deck ${i+1}" aria-pressed="false">${icoPlay}</button>
    </div>
    <div>
      <div class="jog" role="slider" aria-label="Jog wheel deck ${i+1} — drag to scratch or nudge" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0" tabindex="0">
        <div class="ledr"></div><div class="plat"></div>
        <div class="disp"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="#1b2430" stroke-width="4"/><circle class="prg" cx="50" cy="50" r="44" fill="none" stroke="${t.col}" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 50 50)"/><g class="rot"><circle cx="50" cy="10" r="4" fill="#fff"/></g></svg><span class="num">${i+1}</span><span class="md">VINYL</span></div>
      </div>
      <div class="pads8">${MODES.map((m,k)=>`<button class="pad pm${k===0?' on':''}" type="button" style="--pc:${PADC[k]}" data-k="${k}">${m}</button>`).join('')}</div>
    </div>
    <div class="rcol">
      <button class="sq sync" type="button" style="--led:#3FA9F5" aria-pressed="false">Sync</button>
      <button class="sq rng" type="button" style="--led:#F5A623">±8%</button>
      <div class="tempo"><div class="tslot"><input class="tf" type="range" min="-8" max="8" step=".05" value="0" aria-label="Tempo deck ${i+1}"></div><span class="tv">0.00%</span></div>
      <button class="sq rst" type="button">Reset</button>
    </div>
  </div>
</div>`; }
function knob(cls, label, min, max, val, step, extra=''){ return `<label class="knob ${cls}" ${extra}><span class="arc"></span><span class="kv"></span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}"><span class="kl">${label.split(' ').pop()}</span></label>`; }
function meter(id){ let h=''; for(let k=0;k<15;k++) h+=`<i class="${k<10?'g':k<13?'a':'r'}"></i>`; return `<div class="meter" id="${id}">${h}</div>`; }
function stripHTML(i){ return `<div class="strip" data-c="${i}">
  <span class="chl">CH ${i+1}</span>
  ${knob('k-trim',`CH${i+1} Trim`,-12,12,0,.5,'style="--kc:#d9d3db"')}
  ${knob('k-hi',`CH${i+1} Hi`,-26,6,0,.5)}
  ${knob('k-mid',`CH${i+1} Mid`,-26,6,0,.5)}
  ${knob('k-lo',`CH${i+1} Low`,-26,6,0,.5)}
  ${knob('k-cfx big colorfx',`CH${i+1} Filter`,-1,1,0,.01)}
  <div class="fsec">${meter('m'+i)}<input class="cf" type="range" min="0" max="1" step=".01" value=".85" aria-label="Channel ${i+1} fader"></div>
</div>`; }
function mixerHTML(){ return `<div class="unit mixer" aria-label="Mixer">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:0 14px"><span class="brand"><b>PARSHH</b> MIXER</span><span class="sub">2-ch · Beat FX</span></div>
  <div class="mx">${stripHTML(0)}
    <div class="center">
      <span class="sub">Master</span><div class="mm">${meter('mL')}${meter('mR')}</div>
      ${knob('k-mst',`Master Level`,0,1,.8,.01,'style="--kc:#FF8A1F"')}
      <div style="height:6px"></div>
      <span class="sub">Beat FX</span>
      <div class="fxd" aria-live="polite"><div class="n" id="fxn">ECHO</div><div class="b" id="fxb">1/2</div></div>
      <div class="mini"><button class="sq" id="fxdl" type="button" aria-label="Shorter beat">◀</button><button class="sq" id="fxdr" type="button" aria-label="Longer beat">▶</button></div>
      <div class="mini"><button class="sq on" id="fxe" type="button" style="--led:#3FA9F5">Echo</button><button class="sq" id="fxr" type="button" style="--led:#3FA9F5">Verb</button></div>
      ${knob('k-dep',`FX Depth`,0,1,.6,.01,'style="--kc:#3FA9F5"')}
      <div style="height:4px"></div>
      <button class="sq fxon" id="fxon" type="button" style="--led:#FF3B5C" aria-pressed="false">FX On</button>
    </div>
    ${stripHTML(1)}</div>
  <div class="sampler">${['Riser','Impact','Horn','Roll'].map((s,k)=>`<button class="pad samp" type="button" style="--pc:${['#B07CFF','#FF3B5C','#FF8A1F','#2BFF6A'][k]}" data-s="${s}">${s}</button>`).join('')}</div>
  <div class="xfbox"><div class="sub"><span>CH 1</span><span>Crossfader</span><span>CH 2</span></div><input class="xf" type="range" min="0" max="1" step=".005" value=".5" aria-label="Crossfader"></div>
</div>`; }

const rig=$('#rig'); if(!rig) return;
rig.innerHTML = deckHTML(0) + mixerHTML() + deckHTML(1);

function setKnob(lab){ const inp=$('input',lab), mn=+inp.min, mx=+inp.max, v=+inp.value, p=(v-mn)/(mx-mn); $('.kv',lab).style.setProperty('--a', (-135+p*270)+'deg'); lab.style.setProperty('--p', (p*75)+'%'); }
$$('.knob',rig).forEach(l=>{ setKnob(l); const inp=$('input',l); inp.addEventListener('input',()=>{ setKnob(l); onKnob(l,+inp.value); });
  l.addEventListener('dblclick',()=>{ inp.value = l.classList.contains('k-mst')?.8 : l.classList.contains('k-dep')?.6 : 0; setKnob(l); onKnob(l,+inp.value); }); });
function onKnob(l,v){ const st=l.closest('.strip');
  if(st){ const c=+st.dataset.c, m=MX.ch[c]; if(l.classList.contains('k-trim')) m.trim=v; else if(l.classList.contains('k-hi')) m.hi=v; else if(l.classList.contains('k-mid')) m.mid=v; else if(l.classList.contains('k-lo')) m.lo=v; else if(l.classList.contains('k-cfx')) m.cfx=v; if(ctx) syncNodes(DECKS[c]); }
  else if(l.classList.contains('k-mst')){ MX.master=v; applyFx(); } else if(l.classList.contains('k-dep')){ MX.fx.depth=v; applyFx(); } }
$$('.strip input.cf',rig).forEach(f=>f.addEventListener('input',()=>{ const c=+f.closest('.strip').dataset.c; MX.ch[c].fader=+f.value; if(ctx) syncNodes(DECKS[c]); }));
$('input.xf',rig).addEventListener('input',e=>{ MX.xf=+e.target.value; applyXf(); });
$('#fxe').onclick=()=>{ MX.fx.type='Echo'; fxui(); applyFx(); }; $('#fxr').onclick=()=>{ MX.fx.type='Reverb'; fxui(); applyFx(); };
$('#fxdl').onclick=()=>{ MX.fx.div=Math.max(0,MX.fx.div-1); fxui(); applyFx(); }; $('#fxdr').onclick=()=>{ MX.fx.div=Math.min(DIVS.length-1,MX.fx.div+1); fxui(); applyFx(); };
$('#fxon').onclick=()=>{ ensure(); MX.fx.on=!MX.fx.on; fxui(); applyFx(); };
function fxui(){ $('#fxn').textContent=MX.fx.type.toUpperCase(); $('#fxb').textContent=MX.fx.type==='Echo'?DIVS[MX.fx.div][1]:'2.6s'; $('#fxe').classList.toggle('on',MX.fx.type==='Echo'); $('#fxr').classList.toggle('on',MX.fx.type==='Reverb'); $('#fxon').classList.toggle('on',MX.fx.on); $('#fxon').setAttribute('aria-pressed',MX.fx.on); }
$$('.samp',rig).forEach(b=>b.addEventListener('click',()=>{ ensure(); ctx.resume(); const dur=SAMP[b.dataset.s](); b.classList.add('hit'); setTimeout(()=>b.classList.remove('hit'), Math.min(1200,dur*1000)); }));

DECKS.forEach(d=>{ const u=$('#u'+d.i);
  $('.play',u).onclick=()=>d.toggle(); $('.cue',u).onclick=()=>{ d.cue(); flash($('.cue',u)); };
  $('.ld input',u).addEventListener('change',e=>{ const f=e.target.files[0]; if(f) loadFile(d,f); });
  $('.sync',u).onclick=()=>{ const o=DECKS[1-d.i]; d.synced=!d.synced; if(d.synced && o.baseBpm){ d.pitch=clamp((o.bpm/d.baseBpm-1)*100,-d.range*2,d.range*2); if(d.pitch>d.range||d.pitch<-d.range){ d.range=16; } $('.tf',u).min=-d.range; $('.tf',u).max=d.range; $('.tf',u).value=d.pitch; d.rate(); if(d.playing && o.playing && !d.buf && !o.buf) d.alignTo(o); } ui(); };
  $('.rng',u).onclick=()=>{ d.range = d.range===8?16:8; const tf=$('.tf',u); tf.min=-d.range; tf.max=d.range; d.pitch=clamp(d.pitch,-d.range,d.range); tf.value=d.pitch; d.rate(); ui(); };
  $('.rst',u).onclick=()=>{ d.pitch=0; $('.tf',u).value=0; d.synced=false; d.rate(); ui(); };
  $('.tf',u).addEventListener('input',e=>{ d.pitch=+e.target.value; d.synced=false; d.rate(); ui(); });
  $('.vinyl',u).onclick=e=>{ d.vinyl=!(d.vinyl??true); e.currentTarget.classList.toggle('on',d.vinyl); e.currentTarget.setAttribute('aria-pressed',d.vinyl); $('.md',u).textContent=d.vinyl?'VINYL':'CDJ'; };
  $$('.pm',u).forEach(p=>p.onclick=()=>{ ensure(); const k=+p.dataset.k;
    if(d.buf){ if(d.cues[k]==null){ d.cues[k]=d.curPos(); p.textContent='Cue '+(k+1); p.classList.add('on'); } else { const was=d.playing; d.pause(); d.fpos=d.cues[k]; d.pos=d.fpos; d.play(); if(!was){} } flash(p); return; }
    d.mode=MODES[k]; $$('.pm',u).forEach(q=>q.classList.toggle('on',q===p)); flash(p); });
  jog(d,u);
});
function flash(el){ el.classList.add('hit'); setTimeout(()=>el.classList.remove('hit'),140); }

/* jog: drag = scratch (vinyl) / nudge */
function jog(d,u){ const j=$('.jog',u); let drag=false, la=0, lt=0, vel=0, sn=null, sf=null, sg=null;
  const ang=e=>{ const r=j.getBoundingClientRect(); return Math.atan2(e.clientY-(r.top+r.height/2), e.clientX-(r.left+r.width/2)); };
  j.addEventListener('pointerdown',e=>{ ensure(); ctx.resume(); drag=true; j.setPointerCapture(e.pointerId); la=ang(e); lt=performance.now(); vel=0;
    if(d.vinyl??true){ sn=ctx.createBufferSource(); sn.buffer=noise; sn.loop=true; sf=ctx.createBiquadFilter(); sf.type='bandpass'; sf.Q.value=4; sg=ctx.createGain(); sg.gain.value=0; sn.connect(sf).connect(sg).connect(d.trim); sn.start(); } });
  j.addEventListener('pointermove',e=>{ if(!drag) return; const a=ang(e), now=performance.now(); let da=a-la; if(da>Math.PI) da-=2*Math.PI; if(da<-Math.PI) da+=2*Math.PI; const dt=Math.max(1,now-lt); vel=da/dt*1000; la=a; lt=now;
    d.angle += da*180/Math.PI;
    const scratch = d.vinyl??true;
    if(scratch){ const sp=Math.min(1,Math.abs(vel)/18); if(sg){ sg.gain.setTargetAtTime(sp*.5,ctx.currentTime,.01); sf.frequency.setTargetAtTime(300+sp*3200,ctx.currentTime,.01); }
      d.bend = d.playing ? clamp(1+vel/14,.25,2.2) : 1; }
    else { d.bend = clamp(1+vel/60,.85,1.15); }
    d.rate(); j.setAttribute('aria-valuenow', clamp(vel/20,-1,1).toFixed(2)); });
  const up=()=>{ if(!drag) return; drag=false; d.bend=1; d.rate(); if(sg){ sg.gain.setTargetAtTime(0,ctx.currentTime,.02); const s=sn; setTimeout(()=>{try{s.stop()}catch(e){}},120); sn=sf=sg=null; } };
  j.addEventListener('pointerup',up); j.addEventListener('pointercancel',up);
  j.addEventListener('keydown',e=>{ if(e.key==='ArrowLeft'||e.key==='ArrowRight'){ e.preventDefault(); d.bend=e.key==='ArrowRight'?1.06:.94; d.rate(); setTimeout(()=>{d.bend=1; d.rate();},180); } });
}

function ui(){ DECKS.forEach(d=>{ const u=$('#u'+d.i);
  u.classList.toggle('playing',d.playing);
  const pb=$('.play',u); pb.classList.toggle('on',d.playing); pb.classList.toggle('blink',!d.playing); pb.setAttribute('aria-pressed',d.playing);
  $('.cue',u).classList.toggle('on',!d.playing);
  $('.ms',u).classList.toggle('on',MASTER===d); $('.sy',u).classList.toggle('on',d.synced); $('.sync',u).classList.toggle('on',d.synced); $('.sync',u).setAttribute('aria-pressed',d.synced);
  $('.lp',u).classList.toggle('on',!d.buf);
  $('.rng',u).textContent='±'+d.range+'%'; $('.rng',u).classList.toggle('on',d.range===16);
  $('.tp',u).innerHTML=(d.pitch>=0?'+':'')+d.pitch.toFixed(2)+'<small>%</small>'; $('.tv',u).textContent=(d.pitch>=0?'+':'')+d.pitch.toFixed(2)+'%';
  $('.tt',u).textContent = d.buf ? d.fileName : d.t.title; $('.ta',u).textContent = d.buf ? 'Your track' : d.t.artist; $('.ky',u).textContent = d.buf ? '—' : d.t.key;
  $$('.pm',u).forEach((p,k)=>{ if(d.buf){ p.textContent = d.cues[k]==null ? 'Set '+(k+1) : 'Cue '+(k+1); p.classList.toggle('on', d.cues[k]!=null); } else { p.textContent=MODES[k]; p.classList.toggle('on', d.mode===MODES[k]); } });
}); window.dispatchEvent(new Event('booth:state')); }
ui(); fxui();

/* ---------- render loop: screens, jogs, meters ---------- */
const WCOL={L:'#1F5BFF',M:'#FF9A2E',H:'#F4F6FF'};
function drawWave(d,u,now){ const cv=$('.wave',u), g=cv.getContext('2d'), W=cv.width, H=cv.height, mid=H/2; g.clearRect(0,0,W,H);
  const pos=d.curPos();
  if(d.buf){ const fb=d.fband, span=8/ (fb.dt), x0=pos/fb.dt - span/2;
    for(const [k,sc] of [['L',1],['M',.78],['H',.5]]){ g.fillStyle=WCOL[k]; const A=fb[k];
      for(let x=0;x<W;x+=2){ const i=Math.floor(x0 + x/W*span); if(i<0||i>=A.length) continue; const h=A[i]*mid*sc; g.fillRect(x,mid-h,2,h*2); } }
  } else { const env=ENV[d.i][d.mode], pps=W/32;
    for(const [k,sc] of [['L',.95],['M',.72],['H',.48]]){ g.fillStyle=WCOL[k]; const A=env[k];
      for(let x=0;x<W;x+=2){ const sp=pos+(x-W/2)/pps; if(sp<0) continue; const i=Math.floor(sp*SUB)%CYC; const h=Math.min(1,A[i])*mid*sc; g.fillRect(x,mid-h,2,h*2); } }
    g.fillStyle='rgba(255,255,255,.22)'; for(let b=Math.ceil((pos-16)/4)*4; b<pos+16; b+=4){ const x=W/2+(b-pos)*pps; if(b<0) continue; g.fillStyle= b%16===0?'rgba(255,59,59,.9)':'rgba(255,255,255,.2)'; g.fillRect(x,0,b%16===0?2:1,b%16===0?14:8); } }
  g.fillStyle='rgba(0,0,0,.35)'; g.fillRect(0,0,W/2,H);
  g.fillStyle='#fff'; g.fillRect(W/2-1,0,2,H); g.fillStyle='#FF3B3B'; g.beginPath(); g.moveTo(W/2-7,0); g.lineTo(W/2+7,0); g.lineTo(W/2,8); g.fill();
  // overview
  const ov=$('.ov',u), o=ov.getContext('2d'), OW=ov.width, OH=ov.height; o.clearRect(0,0,OW,OH);
  if(d.buf){ const A=d.fband.L, Mm=d.fband.M; for(let x=0;x<OW;x+=2){ const i=Math.floor(x/OW*A.length); o.fillStyle=WCOL.L; o.fillRect(x,OH-A[i]*OH,2,A[i]*OH); o.fillStyle=WCOL.M; o.fillRect(x,OH-Mm[i]*OH*.6,2,Mm[i]*OH*.6); }
    const px=(pos/(d.buf.duration))*OW; o.fillStyle='rgba(0,0,0,.45)'; o.fillRect(0,0,px,OH); o.fillStyle='#FF3B3B'; o.fillRect(px-1,0,2,OH);
  } else { const env=ENV[d.i][d.mode]; for(let x=0;x<OW;x+=3){ const i=Math.floor(x/OW*CYC); const h=Math.min(1,env.L[i]*.8+env.M[i]*.3)*OH; o.fillStyle=x%((OW/8)|0)<3?'#3a3f46':WCOL.L; o.fillRect(x,OH-h,2,h); }
    const px=((pos%64)/64)*OW; o.fillStyle='rgba(0,0,0,.45)'; o.fillRect(0,0,px,OH); o.fillStyle='#FF3B3B'; o.fillRect(px-1,0,2,OH); }
  // time + bpm
  const secs = d.buf ? pos : pos*(60/d.t.bpm)/4; const mm=Math.floor(secs/60), ss=Math.floor(secs%60), ds=Math.floor((secs*10)%10);
  $('.tm',u).innerHTML=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}<small>.${ds}</small>`;
  $('.bp',u).textContent = (d.buf && !d.fileBpm) ? '—' : d.bpm.toFixed(1);
  const prog = d.buf ? (pos/d.buf.duration) : ((pos%64)/64); $('.prg',u).setAttribute('stroke-dashoffset', (100-prog*100).toFixed(1));
}
let lastF=performance.now();
function frame(){ requestAnimationFrame(frame); const now=performance.now(), dt=(now-lastF)/1000; lastF=now;
  const vis = rig.getBoundingClientRect(); if(vis.bottom<0 || vis.top>innerHeight) return;
  DECKS.forEach(d=>{ const u=$('#u'+d.i);
    if(d.buf && d.playing && ctx){ d.fpos += dt*(1+d.pitch/100)*d.bend; if(d.fpos>d.buf.duration) d.fpos=d.buf.duration; }
    if(d.playing && !RM) d.angle += dt*200*(d.bpm/120);
    $('.plat',u).style.transform=`rotate(${d.angle}deg)`; $('.rot',u).setAttribute('transform',`rotate(${d.angle*1.0} 50 50)`);
    if(ctx){ while(d.beatQ.length && d.beatQ[0][0]<=ctx.currentTime){ const [,b]=d.beatQ.shift(); $$('.bb i',u).forEach((e,k)=>e.classList.toggle('on',k===b)); } }
    if(!d.playing) $$('.bb i',u).forEach(e=>e.classList.remove('on'));
    drawWave(d,u,now);
    let lv=0; if(ctx){ d.an.getFloatTimeDomainData(d.td); let s=0; for(const v of d.td) s+=v*v; lv=Math.sqrt(s/d.td.length)*3.2; }
    meterSet('m'+d.i, lv); });
  if(ctx){ for(const [an,id] of [[E.anL,'mL'],[E.anR,'mR']]){ an.getFloatTimeDomainData(E.td); let s=0; for(const v of E.td) s+=v*v; meterSet(id, Math.sqrt(s/E.td.length)*3); } }
}
const MLV={};
function meterSet(id,v){ const m=document.getElementById(id); if(!m) return; MLV[id]=Math.max(v, (MLV[id]||0)*.88); const n=Math.round(clamp(MLV[id],0,1)*15); const cs=m.children; for(let k=0;k<15;k++) cs[k].classList.toggle('on',k<n); }
requestAnimationFrame(frame);

/* ---------- public API for the rest of the page ---------- */
window.BOOTH = {
  playing: () => DECKS.some(d=>d.playing),
  toggle: i => { DECKS[i||0].toggle(); },
  energy: () => { if(!ctx || !DECKS.some(d=>d.playing)) return null; E.an.getByteFrequencyData(E.fq); let lo=0; for(let i=1;i<6;i++) lo+=E.fq[i]; let hi=0; for(let i=20;i<60;i++) hi+=E.fq[i]; return [lo/5/255, hi/40/255]; },
  bpm: () => MASTER ? MASTER.bpm : null
};
})();
