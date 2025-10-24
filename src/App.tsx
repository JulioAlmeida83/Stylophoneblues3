import React, { useEffect, useMemo, useRef, useState } from "react";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

type PitchClass = 0|1|2|3|4|5|6|7|8|9|10|11;

type Chord = { root: PitchClass; qual: "7" };

type Bar = { chord: Chord; repeats?: number };

function I_IV_V(key: PitchClass): {I:Chord; IV:Chord; V:Chord} {
  const I:Chord = { root: key, qual: "7" };
  const IV:Chord = { root: ((key + 5) % 12) as PitchClass, qual: "7" };
  const V:Chord = { root: ((key + 7) % 12) as PitchClass, qual: "7" };
  return { I, IV, V };
}

function make12Bar(key: PitchClass, variation: "basic"|"quickChange"|"turnaroundV"|"minorBlues" = "basic"): Bar[] {
  const {I, IV, V} = I_IV_V(key);
  const bars: Bar[] = [];
  if (variation === "minorBlues") {
    const i:Chord = {root:key, qual:"7"};
    const iv:Chord = {root:((key+5)%12) as PitchClass, qual:"7"};
    const v:Chord = {root:((key+7)%12) as PitchClass, qual:"7"};
    return [
      {chord:i},{chord:i},{chord:i},{chord:i},
      {chord:iv},{chord:iv},{chord:i},{chord:i},
      {chord:v},{chord:iv},{chord:i},{chord:v},
    ];
  }
  if (variation === "quickChange") bars.push({chord:I},{chord:IV},{chord:I},{chord:I});
  else bars.push({chord:I},{chord:I},{chord:I},{chord:I});
  bars.push({chord:IV},{chord:IV},{chord:I},{chord:I});
  bars.push({chord:V},{chord:IV},{chord:I},{chord:V});
  return bars;
}

const BLUES_OFFSETS = [0, 3, 5, 6, 7, 10];
function bluesScalePitchesForChord(ch: Chord): Set<number> {
  const set = new Set<number>();
  for (const off of BLUES_OFFSETS) set.add((ch.root + off) % 12);
  return set;
}
function pcToName(pc: PitchClass): string { return NOTE_NAMES[pc]; }
function midiToFreq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }

const SEQUENCES: { id: string; title: string; key: PitchClass; variation: "basic"|"quickChange"|"turnaroundV"|"minorBlues"; groove: "shuffle"|"swing"|"straight"|"slow" }[] = [
  {id:"C1", title:"C Blues — Shuffle", key:0, variation:"basic", groove:"shuffle"},
  {id:"C2", title:"C Blues — Quick Change", key:0, variation:"quickChange", groove:"shuffle"},
  {id:"C3", title:"C Blues — Turnaround V", key:0, variation:"turnaroundV", groove:"swing"},
  {id:"D1", title:"D Blues — Shuffle", key:2, variation:"basic", groove:"shuffle"},
  {id:"D2", title:"D Blues — Straight", key:2, variation:"basic", groove:"straight"},
  {id:"Eb1", title:"Eb Blues — Slow", key:3, variation:"basic", groove:"slow"},
  {id:"Eb2", title:"Eb Blues — Quick Change", key:3, variation:"quickChange", groove:"swing"},
  {id:"F1", title:"F Blues — Shuffle", key:5, variation:"basic", groove:"shuffle"},
  {id:"F2", title:"F Blues — Turnaround V", key:5, variation:"turnaroundV", groove:"swing"},
  {id:"G1", title:"G Blues — Shuffle", key:7, variation:"basic", groove:"shuffle"},
  {id:"G2", title:"G Blues — Straight", key:7, variation:"basic", groove:"straight"},
  {id:"G3", title:"G Minor Blues", key:7, variation:"minorBlues", groove:"swing"},
  {id:"A1", title:"A Blues — Shuffle", key:9, variation:"basic", groove:"shuffle"},
  {id:"A2", title:"A Blues — Quick Change", key:9, variation:"quickChange", groove:"swing"},
  {id:"A3", title:"A Blues — Slow", key:9, variation:"basic", groove:"slow"},
  {id:"Bb1", title:"Bb Blues — Shuffle", key:10, variation:"basic", groove:"shuffle"},
  {id:"Bb2", title:"Bb Blues — Straight", key:10, variation:"basic", groove:"straight"},
  {id:"Bb3", title:"Bb Minor Blues", key:10, variation:"minorBlues", groove:"swing"},
  {id:"C4", title:"C Blues — Fast Swing", key:0, variation:"basic", groove:"swing"},
  {id:"F3", title:"F Blues — Slow Drag", key:5, variation:"basic", groove:"slow"},
];
function sequenceBars(seqId: string): Bar[] {
  const seq = SEQUENCES.find(s => s.id === seqId) || SEQUENCES[0];
  return make12Bar(seq.key, seq.variation);
}

type Mixer = {
  ctx: AudioContext,
  master: GainNode,
  drumBus: GainNode,
  bassBus: GainNode,
  guitarBus: GainNode,
  leadBus: GainNode,
  leadIn: GainNode,
  leadDry: GainNode,
  leadWet: GainNode,
  delay: DelayNode,
  delayFB: GainNode,
  delayWet: GainNode,
  reverb: ConvolverNode,
  reverbWet: GainNode,
};

function createImpulseResponse(ctx: AudioContext, seconds=1.6): AudioBuffer {
  const rate = ctx.sampleRate; const len = Math.max(1, Math.floor(seconds*rate));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch=0; ch<2; ch++){
    const data = buf.getChannelData(ch);
    for (let i=0;i<len;i++) data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 3);
  }
  return buf;
}

function createMixer(): Mixer {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) { throw new Error("WebAudio não suportado neste navegador."); }
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const drumBus = ctx.createGain(); drumBus.gain.value = 0.9; drumBus.connect(master);
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.8; bassBus.connect(master);
  const guitarBus = ctx.createGain(); guitarBus.gain.value = 0.7; guitarBus.connect(master);
  const leadBus = ctx.createGain(); leadBus.gain.value = 0.9; leadBus.connect(master);

  const leadIn = ctx.createGain();
  const leadDry = ctx.createGain(); leadDry.gain.value = 1.0;
  const leadWet = ctx.createGain(); leadWet.gain.value = 0.0;

  const delay = ctx.createDelay(2.5); delay.delayTime.value = 0.28;
  const delayFB = ctx.createGain(); delayFB.gain.value = 0.3;
  const delayWet = ctx.createGain(); delayWet.gain.value = 0.25;
  delay.connect(delayFB).connect(delay);

  const reverb = ctx.createConvolver(); reverb.buffer = createImpulseResponse(ctx, 1.6);
  const reverbWet = ctx.createGain(); reverbWet.gain.value = 0.22;

  leadIn.connect(leadDry).connect(leadBus);
  leadIn.connect(delay).connect(delayWet).connect(leadWet);
  leadIn.connect(reverb).connect(reverbWet).connect(leadWet);
  leadWet.connect(leadBus);

  return { ctx, master, drumBus, bassBus, guitarBus, leadBus, leadIn, leadDry, leadWet, delay, delayFB, delayWet, reverb, reverbWet };
}

function playBufferOnce(m: Mixer, buffer: AudioBuffer, dest: AudioNode, time:number, vol=1, detuneCents=0){
  const src = m.ctx.createBufferSource();
  src.buffer = buffer;
  src.detune.value = detuneCents;
  const g = m.ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(dest);
  src.start(time);
  src.stop(time + buffer.duration + 0.01);
}

function playKickSynth(m: Mixer, time: number, vol=1) {
  const { ctx, drumBus } = m;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = "sine"; osc.frequency.setValueAtTime(120, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  gain.gain.setValueAtTime(0.8*vol, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
  osc.connect(gain).connect(drumBus); osc.start(time); osc.stop(time + 0.22);
}
function playSnareSynth(m: Mixer, time: number, vol=1) {
  const { ctx, drumBus } = m;
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate*0.2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * Math.pow(1 - i/data.length, 2);
  noise.buffer = buffer;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.6;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(0.6*vol, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  noise.connect(bp).connect(gain).connect(drumBus);
  noise.start(time); noise.stop(time + 0.21);
}
function playHatSynth(m: Mixer, time: number, vol=1, closed=true) {
  const { ctx, drumBus } = m;
  const noise = ctx.createBufferSource();
  const dur = closed ? 0.05 : 0.35;
  const buffer = ctx.createBuffer(1, ctx.sampleRate*dur, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1);
  noise.buffer = buffer;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
  const gain = ctx.createGain(); gain.gain.value = 0.35*vol;
  gain.gain.setValueAtTime(gain.gain.value, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  noise.connect(hp).connect(gain).connect(drumBus);
  noise.start(time); noise.stop(time + dur + 0.02);
}

function playBassNote(m: Mixer, midi: number, time: number, length=0.45, vol=0.9) {
  const { ctx, bassBus } = m;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200; lp.Q.value = 0.4;
  osc.type = "sawtooth"; osc.frequency.value = midiToFreq(midi);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.7*vol, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
  osc.connect(lp).connect(gain).connect(bassBus);
  osc.start(time); osc.stop(time + length + 0.02);
}

function playGuitarChord(m: Mixer, rootMidi: number, _quality: "7", time: number, vol=0.6) {
  const { ctx, guitarBus } = m;
  const pcs = [0,4,7,10];
  const notes = pcs.map(semi => rootMidi + semi);
  notes.forEach((midi, idx) => {
    const osc = ctx.createOscillator(); osc.type = "square";
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 1800 - idx*150;
    const gain = ctx.createGain();
    osc.frequency.value = midiToFreq(midi);
    const t = time + idx*0.005;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4*vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + Math.random()*0.08);
    osc.connect(filt).connect(gain).connect(guitarBus);
    osc.start(t); osc.stop(t + 0.4);
  });
}

type ADSR = { attack: number; decay: number; sustain: number; release: number };

type SynthSettings = {
  waveA: string; waveB: string; mixA: number; mixB: number; detune: number; cutoff: number; resonance: number; drive: number;
  glideSec: number; adsr: ADSR
};

class SynthVoice {
  oscA: OscillatorNode; oscB: OscillatorNode; mixA: GainNode; mixB: GainNode; lp: BiquadFilterNode; shaper: WaveShaperNode; comp: DynamicsCompressorNode; vca: GainNode; ctx: AudioContext; glide: number; adsr: ADSR;
  constructor(ctx: AudioContext, dest: AudioNode, settings: SynthSettings){
    this.ctx = ctx; this.glide = settings.glideSec; this.adsr = settings.adsr;
    this.oscA = ctx.createOscillator(); this.oscB = ctx.createOscillator();
    this.mixA = ctx.createGain(); this.mixB = ctx.createGain();
    this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass";
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = makeDistortionCurve(settings.drive);
    this.comp = ctx.createDynamicsCompressor();
    this.vca = ctx.createGain(); this.vca.gain.value = 0.0;

    this.oscA.type = settings.waveA as OscillatorType;
    this.oscB.type = settings.waveB as OscillatorType;
    this.oscB.detune.value = settings.detune * 100;
    this.mixA.gain.value = settings.mixA; this.mixB.gain.value = settings.mixB;
    this.lp.frequency.value = settings.cutoff; this.lp.Q.value = settings.resonance;

    this.oscA.connect(this.mixA).connect(this.lp);
    this.oscB.connect(this.mixB).connect(this.lp);
    this.lp.connect(this.shaper).connect(this.comp).connect(this.vca).connect(dest);

    const now = ctx.currentTime; const a=this.adsr.attack, d=this.adsr.decay, s=Math.max(0, Math.min(1, this.adsr.sustain));
    this.vca.gain.setValueAtTime(0, now);
    this.vca.gain.linearRampToValueAtTime(1, now + Math.max(0.001, a));
    this.vca.gain.linearRampToValueAtTime(s, now + Math.max(0.001, a) + Math.max(0.001, d));

    this.oscA.start(); this.oscB.start();
  }
  setFreq(freq:number){ const now=this.ctx.currentTime; const t = Math.max(0.001, this.glide); this.oscA.frequency.setTargetAtTime(freq, now, t); this.oscB.frequency.setTargetAtTime(freq, now, t); }
  stop(){ const now=this.ctx.currentTime; const r=Math.max(0.001,this.adsr.release); this.vca.gain.cancelScheduledValues(now); this.vca.gain.setValueAtTime(this.vca.gain.value, now); this.vca.gain.linearRampToValueAtTime(0, now + r); this.oscA.stop(now + r + 0.02); this.oscB.stop(now + r + 0.02); }
}

function makeDistortionCurve(amount=140) {
  const n = 44100, curve = new Float32Array(n); const deg = Math.PI/180;
  for (let i=0;i<n;i++) { const x = i*2/n - 1; curve[i] = (3+amount)*x*20*deg/(Math.PI + amount*Math.abs(x)); }
  return curve;
}

class SamplerVoice {
  src: AudioBufferSourceNode; vca: GainNode; ctx: AudioContext; adsr: ADSR;
  constructor(ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer, midi:number, rootMidi:number, adsr:ADSR){
    this.ctx = ctx; this.adsr = adsr;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    const cents = (midi - rootMidi) * 100;
    this.src.detune.value = cents;
    this.vca = ctx.createGain(); this.vca.gain.value = 0.0;
    this.src.connect(this.vca).connect(dest);
    const now = ctx.currentTime; const a=adsr.attack, d=adsr.decay, s=Math.max(0, Math.min(1, adsr.sustain));
    this.vca.gain.setValueAtTime(0, now);
    this.vca.gain.linearRampToValueAtTime(1, now + Math.max(0.001, a));
    this.vca.gain.linearRampToValueAtTime(s, now + Math.max(0.001, a) + Math.max(0.001, d));
    this.src.start();
  }
  stop(){ const now=this.ctx.currentTime; const r=Math.max(0.001,this.adsr.release); this.vca.gain.cancelScheduledValues(now); this.vca.gain.setValueAtTime(this.vca.gain.value, now); this.vca.gain.linearRampToValueAtTime(0, now + r); this.src.stop(now + r + 0.02); }
}

async function decodeFileToBuffer(ctx: AudioContext, file: File): Promise<AudioBuffer> { const arrBuf = await file.arrayBuffer(); return await ctx.decodeAudioData(arrBuf.slice(0)); }

type Transport = { isPlaying: boolean, tempo: number, step: number, barIndex: number, nextTickTime: number };

function useTransport(mixerRef: React.MutableRefObject<Mixer|null>, currentSeqId: string, volumes: {drum:number; bass:number; guitar:number}, drumAssign:{kick:number|null; snare:number|null; hat:number|null}, drumBank: (AudioBuffer|null)[] ) {
  const [t, setT] = useState<Transport>({isPlaying:false, tempo:90, step:0, barIndex:0, nextTickTime:0});
  const timerRef = useRef<number|null>(null);
  const stateRef = useRef<Transport>({isPlaying:false, tempo:90, step:0, barIndex:0, nextTickTime:0});

  const bars = useMemo(()=>sequenceBars(currentSeqId), [currentSeqId]);
  const seqMeta = useMemo(()=>SEQUENCES.find(s=>s.id===currentSeqId)!, [currentSeqId]);

  useEffect(()=>{
    let tempo = 100; if (seqMeta?.groove === "slow") tempo = 70; else if (seqMeta?.groove === "swing") tempo = 110; else if (seqMeta?.groove === "straight") tempo = 105;
    setT(prev=>({...prev, tempo})); stateRef.current.tempo = tempo;
  }, [currentSeqId, seqMeta]);

  useEffect(()=>{ stateRef.current.tempo = t.tempo; }, [t.tempo]);

  const swingAmount = seqMeta?.groove === "swing" || seqMeta?.groove === "shuffle" ? 0.6 : 0.5;

  function scheduleStep() {
    const m = mixerRef.current; if (!m) return; const s = stateRef.current; const ctx = m.ctx;
    const secondsPerBeat = 60/s.tempo; const sixteenth = secondsPerBeat/4;
    let stepDur = s.step % 2 === 1 ? sixteenth * (swingAmount*2) : sixteenth * ((1 - (swingAmount-0.5)*2));
    const now = ctx.currentTime; const time = Math.max(s.nextTickTime || now + 0.05, now + 0.02);
    if (!bars || bars.length === 0) return;
    const bar = bars[s.barIndex % bars.length]; const chord = bar.chord;
    const stepInBeat = s.step % 4; const beat = Math.floor(s.step/4); const beatPos = beat;

    const kickBuf = drumAssign.kick!=null ? drumBank[drumAssign.kick] : null;
    const snareBuf = drumAssign.snare!=null ? drumBank[drumAssign.snare] : null;
    const hatBuf = drumAssign.hat!=null ? drumBank[drumAssign.hat] : null;

    { const isOffbeat = stepInBeat===2; if (hatBuf) playBufferOnce(m, hatBuf, m.drumBus, time, volumes.drum*(isOffbeat?0.5:0.35)); else playHatSynth(m, time, volumes.drum * (isOffbeat?0.5:0.35), true); }
    if (stepInBeat===0 && (beatPos===0 || beatPos===2)) { if (kickBuf) playBufferOnce(m, kickBuf, m.drumBus, time, volumes.drum); else playKickSynth(m, time, volumes.drum); }
    if (stepInBeat===0 && (beatPos===1 || beatPos===3)) { if (snareBuf) playBufferOnce(m, snareBuf, m.drumBus, time, volumes.drum); else playSnareSynth(m, time, volumes.drum); }

    if (stepInBeat===0) { const rootMidi = 36 + chord.root; const walk = [0,7,10,12]; const note = rootMidi + walk[beatPos % walk.length]; playBassNote(m, note, time, secondsPerBeat*0.9, volumes.bass); }

    if (stepInBeat===0 && (beatPos===1 || beatPos===3)) { const rootMidi = 48 + chord.root; playGuitarChord(m, rootMidi, "7", time, volumes.guitar); }

    const nextStep = (s.step + 1) % 16; let nextBar = s.barIndex; if (nextStep === 0) nextBar = (nextBar + 1) % bars.length;
    stateRef.current = { isPlaying:true, tempo:s.tempo, step:nextStep, barIndex:nextBar, nextTickTime: time + stepDur };
    setT(stateRef.current);
    timerRef.current = window.setTimeout(scheduleStep, Math.max(0, (stepDur-0.01)*1000));
  }

  function start() {
    const m = mixerRef.current; if (!m) return; const ctx = m.ctx; if (ctx.state === "suspended") { ctx.resume().catch(()=>{}); }
    const now = ctx.currentTime + 0.05; stateRef.current = { isPlaying:true, tempo: stateRef.current.tempo || 100, step:0, barIndex:0, nextTickTime: now };
    setT(stateRef.current); if (timerRef.current) window.clearTimeout(timerRef.current); timerRef.current = window.setTimeout(scheduleStep, 10);
  }
  function stop() { if (timerRef.current) window.clearTimeout(timerRef.current); timerRef.current = null; stateRef.current = { ...stateRef.current, isPlaying:false, step:0, barIndex:0, nextTickTime:0 }; setT(stateRef.current); }
  useEffect(()=>() => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  return { t, setT, start, stop, bars };
}

const KEYBOARD_RANGE = { firstMidi: 60, lastMidi: 84 };

type LeadEngine = "synth" | "sampler";

type SampleBank = { buffers: AudioBuffer[]; roots: number[] };

function nearestSampleIndex(bank: SampleBank, midi:number): number { if (bank.buffers.length===0) return -1; let best=0, bestDist=1e9; for(let i=0;i<bank.roots.length;i++){ const d=Math.abs(bank.roots[i]-midi); if(d<bestDist){best=i; bestDist=d;} } return best; }

function quantizeMidiToSet(midi:number, allowed:Set<number>): number {
  if (allowed.size===0) return midi;
  const pc = midi % 12; if (allowed.has(pc)) return midi;
  let up = midi, down = midi; for(let i=1;i<=6;i++){ if (allowed.has((pc+i)%12)) { up = midi + i; break; } } for(let i=1;i<=6;i++){ if (allowed.has((pc+12-i)%12)) { down = midi - i; break; } } return (Math.abs(up-midi) < Math.abs(midi-down)) ? up : down;
}

const WHITE_KEYS = ['q','w','e','r','t','y','u','i','o'];
const WHITE_OFFS = [0,2,4,5,7,9,11,12,14];
const BLACK_KEYS = ['2','3','5','6','7'];
const BLACK_OFFS = [1,3,6,8,10];
const BASE_MIDI = 60;

function Piano({ mixerRef, highlightPCs, disabled, leadEngine, synthSettings, sampleBank, sampleRootFallback, maxVoices, quantize }:{
  mixerRef: React.MutableRefObject<Mixer|null>, highlightPCs: Set<number>, disabled?: boolean,
  leadEngine: LeadEngine, synthSettings: SynthSettings, sampleBank: SampleBank, sampleRootFallback: number, maxVoices: number, quantize:boolean
}){
  const keys: number[] = []; for (let m = KEYBOARD_RANGE.firstMidi; m <= KEYBOARD_RANGE.lastMidi; m++) keys.push(m);
  const activeVoices = useRef<Map<number, SynthVoice|SamplerVoice>>(new Map());
  const keyVoices = useRef<Map<string, SynthVoice|SamplerVoice>>(new Map());

  useEffect(()=>{
    function up(ev: PointerEvent){ const id = (ev as any).pointerId; if (typeof id === 'number') { const v = activeVoices.current.get(id); if (v){ v.stop(); activeVoices.current.delete(id); } } }
    window.addEventListener('pointerup', up, {capture:true});
    window.addEventListener('pointercancel', up, {capture:true});
    return ()=>{ window.removeEventListener('pointerup', up, {capture:true} as any); window.removeEventListener('pointercancel', up, {capture:true} as any); };
  }, []);

  function midiFromKey(key:string): {midi:number,label:string}|null {
    const k = key.toLowerCase();
    const wi = WHITE_KEYS.indexOf(k); if (wi>=0) return {midi: BASE_MIDI + WHITE_OFFS[wi], label: k};
    const bi = BLACK_KEYS.indexOf(k); if (bi>=0) return {midi: BASE_MIDI + BLACK_OFFS[bi], label: k};
    return null;
  }

  useEffect(()=>{
    function onKeyDown(e: KeyboardEvent){
      if (disabled) return; const map = midiFromKey(e.key); if (!map) return; if (e.repeat) return;
      const totalVoices = activeVoices.current.size + keyVoices.current.size; if (totalVoices >= maxVoices) return;
      const m = mixerRef.current; if (!m) return; const targetMidi = quantize ? quantizeMidiToSet(map.midi, highlightPCs) : map.midi;
      if (leadEngine === "synth"){
        const v = new SynthVoice(m.ctx, m.leadIn, synthSettings); v.setFreq(midiToFreq(targetMidi)); keyVoices.current.set(map.label, v);
      } else {
        const idx = nearestSampleIndex(sampleBank, targetMidi); if (idx<0) return; const root = sampleBank.roots[idx] ?? sampleRootFallback; const buf = sampleBank.buffers[idx];
        const v = new SamplerVoice(m.ctx, m.leadIn, buf, targetMidi, root, synthSettings.adsr); keyVoices.current.set(map.label, v);
      }
    }
    function onKeyUp(e: KeyboardEvent){ const map = midiFromKey(e.key); if (!map) return; const v = keyVoices.current.get(map.label); if (!v) return; v.stop(); keyVoices.current.delete(map.label); }
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return ()=>{ window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [disabled, leadEngine, synthSettings, sampleBank, sampleRootFallback, maxVoices, quantize, highlightPCs, mixerRef]);

  function startPointer(pointerId:number, midi:number){
    const m = mixerRef.current; if (!m) return; if (activeVoices.current.size + keyVoices.current.size >= maxVoices) return;
    const targetMidi = quantize ? quantizeMidiToSet(midi, highlightPCs) : midi;
    if (leadEngine === "synth") {
      const v = new SynthVoice(m.ctx, m.leadIn, synthSettings); v.setFreq(midiToFreq(targetMidi)); activeVoices.current.set(pointerId, v);
    } else {
      const bank = sampleBank; const idx = nearestSampleIndex(bank, targetMidi); if (idx<0) return; const root = bank.roots[idx] ?? sampleRootFallback; const buf = bank.buffers[idx];
      const v = new SamplerVoice(m.ctx, m.leadIn, buf, targetMidi, root, synthSettings.adsr); activeVoices.current.set(pointerId, v);
    }
  }
  function movePointer(pointerId:number, midi:number){
    const m = mixerRef.current; if (!m) return; const v = activeVoices.current.get(pointerId); if (!v) return;
    const targetMidi = quantize ? quantizeMidiToSet(midi, highlightPCs) : midi;
    if (v instanceof SynthVoice) { v.setFreq(midiToFreq(targetMidi)); }
    else if (v instanceof SamplerVoice) { v.stop(); const bank = sampleBank; const idx = nearestSampleIndex(bank, targetMidi); if (idx<0) return; const root = bank.roots[idx] ?? sampleRootFallback; const buf = bank.buffers[idx]; const nv = new SamplerVoice(m.ctx, m.leadIn, buf, targetMidi, root, synthSettings.adsr); activeVoices.current.set(pointerId, nv); }
  }
  function stopPointer(pointerId:number){ const v = activeVoices.current.get(pointerId); if (!v) return; v.stop(); activeVoices.current.delete(pointerId); }

  function midiFromEl(el: HTMLElement|null): number|null { if (!el) return null; const a = el.getAttribute('data-midi'); if (!a) return null; const n = parseInt(a,10); return isNaN(n)?null:n; }

  function onPointerDown(e: React.PointerEvent){ if (disabled) return; const m = midiFromEl(e.target as HTMLElement); if (m==null) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); startPointer(e.pointerId, m); }
  function onPointerMove(e: React.PointerEvent){ const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement|null; const m = midiFromEl(el); if (m==null){ stopPointer(e.pointerId); return; } movePointer(e.pointerId, m); }
  function onPointerUp(e: React.PointerEvent){ stopPointer(e.pointerId); (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); }
  function onPointerCancel(e: React.PointerEvent){ stopPointer(e.pointerId); }

  const qwertyLabels = new Map<number,string>(); WHITE_OFFS.forEach((off,i)=>{ qwertyLabels.set(BASE_MIDI+off, WHITE_KEYS[i]); }); BLACK_OFFS.forEach((off,i)=>{ qwertyLabels.set(BASE_MIDI+off, BLACK_KEYS[i]); });

  return (
    <div className="keyboard" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerCancel} onPointerCancel={onPointerCancel}>
      {keys.map((midi)=>{ const pc = midi % 12; const isBlack = [1,3,6,8,10].includes(pc); const isGood = highlightPCs.has(pc); const mapLabel = qwertyLabels.get(midi);
        return (
          <button key={midi} className={"key "+(isBlack?"black":"white")+(isGood?" good":"")} data-midi={midi} title={`${NOTE_NAMES[pc]} (${midi})`}>
            <span className="label">{NOTE_NAMES[pc]}{mapLabel?` • ${mapLabel.toUpperCase()}`:''}</span>
          </button>
        );
      })}
    </div>
  );
}

function Strip({name, value, onChange, muted, onToggleMute}: {name:string; value:number; onChange:(v:number)=>void; muted:boolean; onToggleMute:()=>void}){
  return (
    <div className="strip">
      <h3>{name}</h3>
      <input type="range" className="vol" min={0} max={1} step={0.01} value={value} onChange={e=>onChange(parseFloat(e.target.value))} />
      <div className="muterow">
        <button className="btn" onClick={onToggleMute}>{muted?'Unmute':'Mute'}</button>
      </div>
    </div>
  );
}

function Collapsible({title, children, defaultOpen=false}: {title:string; children:React.ReactNode; defaultOpen?:boolean}){
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={'collapsible'+(open?' open':'')}>
      <div className="collapsible-header" onClick={()=>setOpen(!open)}>
        <h3 style={{margin:0}}>{title}</h3>
        <span className="collapsible-toggle">▼</span>
      </div>
      <div className="collapsible-content">{children}</div>
    </div>
  );
}

const CSS = `
  :root{ --bg:#0a0f14; --card:#0f1a28; --ink:#e9f2ff; --muted:#a9b9d2; --accent:#64d6ff; --good:#8CFF98; --danger:#ff5c7a; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html, body{ height:100%; overflow-x:hidden; }
  body{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; background:var(--bg); color:var(--ink); overscroll-behavior-y: none; }
  .app{ max-width:1600px; margin:0 auto; padding:12px; }
  h1{ font-weight:800; margin:0 0 4px; letter-spacing:.5px; font-size:24px; }
  h2{ font-weight:700; margin:12px 0 8px; letter-spacing:.3px; font-size:18px; }
  h3{ font-weight:600; margin:4px 0; font-size:14px; }
  .sub{ color:var(--muted); margin-bottom:12px; font-size:12px; line-height:1.4; }
  .panel{ background:linear-gradient(180deg, rgba(22,31,48,.9), rgba(13,19,31,.9)); border:1px solid rgba(255,255,255,.08); box-shadow:0 20px 50px rgba(0,0,0,.25) inset, 0 8px 30px rgba(0,0,0,.35); border-radius:12px; padding:12px; margin:8px 0; }
  .row{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  label{ display:block; margin-bottom:2px; font-size:11px; }
  select, input[type="range"], input[type="number"], input[type="text"]{ background:#1a2332; color:var(--ink); border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:6px; font-size:12px; }
  select{ width:180px; }
  input[type="range"]{ width:100%; cursor:pointer; }
  input[type="number"]{ width:60px; }
  input[type="checkbox"]{ width:auto; cursor:pointer; }
  .kbdDock{ margin-top:8px; overflow-x:auto; }
  @media (max-width: 760px){ .kbdDock{ position: sticky; bottom: 0; z-index: 20; } }
  .keyboard{ user-select:none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none; display:flex; gap:1px; padding:6px; background:#08101a; border-radius:12px; border:1px solid rgba(255,255,255,.06); box-shadow: inset 0 10px 30px rgba(0,0,0,.35); }
  .key{ position:relative; width:32px; height:110px; border:none; border-radius:6px; cursor:pointer; outline:none; display:flex; align-items:flex-end; justify-content:center; padding-bottom:4px; transition:transform .02s; }
  @media (max-width: 768px){ .key{ width:28px; height:90px; } }
  .key.white{ background: linear-gradient(180deg,#f8fbff,#cfd9ea); color:#1b2430; }
  .key.black{ background: linear-gradient(180deg,#222938,#0c101a); height:75px; margin:0 -16px; width:28px; z-index:2; color:#d7e5ff; }
  @media (max-width: 768px){ .key.black{ height:60px; margin:0 -14px; width:24px; } }
  .key.good{ box-shadow: 0 0 0 2px var(--good) inset, 0 0 12px rgba(140,255,152,.2); }
  .key:active{ transform: translateY(2px); }
  .label{ font-size:9px; opacity:.7; text-align:center; line-height:1.2; }
  .mixer{ display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; }
  @media (max-width: 768px){ .mixer{ grid-template-columns: repeat(2, 1fr); } }
  .strip{ background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:8px; }
  .strip h3{ margin:0 0 6px; font-size:11px; letter-spacing:.5px; color:var(--muted); text-transform:uppercase; }
  .vol{ width:100%; }
  .muterow{ display:flex; gap:4px; margin-top:4px; }
  .btn{ background: #12233a; color:var(--ink); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:6px 10px; cursor:pointer; font-size:11px; transition:all .2s; }
  .btn:hover{ background:#1a2f4a; border-color:rgba(255,255,255,.15); }
  .btn.primary{ background: linear-gradient(180deg,#3aa2ff,#1659bd); border-color:rgba(0,0,0,.2); font-weight:600; }
  .btn.primary:hover{ background: linear-gradient(180deg,#4fb2ff,#2070d5); }
  .btn.stop{ background: linear-gradient(180deg,#ff6d6d,#b81616); font-weight:600; }
  .btn.stop:hover{ background: linear-gradient(180deg,#ff8585,#d02828); }
  .grid{ display:grid; grid-template-columns: 1.2fr .8fr; gap:12px; }
  @media (max-width: 1024px){ .grid{ grid-template-columns: 1fr; } }
  .controls{ display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; }
  @media (max-width: 640px){ .controls{ grid-template-columns: 1fr; } }
  .controls label{ display:flex; flex-direction:column; font-size:11px; color:var(--muted); gap:2px; }
  .slots{ display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:12px; }
  @media (max-width: 1024px){ .slots{ grid-template-columns: 1fr; } }
  .slotCol{ background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:8px; }
  .slotCol > h3{ margin:0 0 8px; font-size:13px; color:var(--accent); text-transform:uppercase; letter-spacing:.5px; }
  .slotGrid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:6px; max-height:300px; overflow-y:auto; }
  @media (max-width: 640px){ .slotGrid{ grid-template-columns: 1fr; max-height:250px; } }
  .slot{ background:#0f1724; border:1px solid rgba(255,255,255,.08); border-radius:6px; padding:8px; font-size:11px; }
  .slot .slotName{ font-weight:600; margin-bottom:4px; color:var(--accent); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .slot input[type="file"]{ display:none; }
  .slot .btn{ width:100%; margin-top:3px; padding:4px; font-size:10px; }
  .slotActions{ display:flex; gap:3px; margin-top:4px; }
  .slotActions button{ flex:1; padding:3px; font-size:9px; }
  .checkRow{ display:flex; align-items:center; gap:4px; margin-top:3px; font-size:10px; }
  .checkRow input[type="checkbox"]{ margin:0; }
  .loopSlot{ background:#1a1f2e; border-color:rgba(100,214,255,.15); }
  .loopControls{ margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,.08); }
  .loopControls label{ display:block; }
  .collapsible{ border:1px solid rgba(255,255,255,.08); border-radius:8px; margin:8px 0; }
  .collapsible-header{ background:rgba(255,255,255,.05); padding:10px 12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; }
  .collapsible-header:hover{ background:rgba(255,255,255,.08); }
  .collapsible-content{ padding:12px; display:none; }
  .collapsible.open .collapsible-content{ display:block; }
  .collapsible-toggle{ font-size:14px; transition:transform .2s; }
  .collapsible.open .collapsible-toggle{ transform:rotate(180deg); }
`;

export default function App(){
  const [seqId, setSeqId] = useState<string>(SEQUENCES[0].id);
  const [tempo, setTempo] = useState<number>(100);
  const [volumes, setVolumes] = useState({drum:1, bass:0.9, guitar:0.8, lead:1});
  const [mutes, setMutes] = useState({drum:false, bass:false, guitar:false});
  const [drumSource, setDrumSource] = useState<'sequence'|'loops'>('sequence');
  const [bassSource, setBassSource] = useState<'sequence'|'loops'>('sequence');
  const [ctxReady, setCtxReady] = useState(false);
  const [quantize, setQuantize] = useState(true);
  const [maxVoices, setMaxVoices] = useState(8);

  const [leadEngine, setLeadEngine] = useState<LeadEngine>("synth");
  const [synth, setSynth] = useState<SynthSettings>({
    waveA:"sawtooth", waveB:"square", mixA:0.6, mixB:0.6, detune:0.06, cutoff:2200, resonance:0.7, drive:140,
    glideSec: 0.015, adsr: { attack:0.01, decay:0.08, sustain:0.85, release:0.07 }
  });

  const mixerRef = useRef<Mixer|null>(null);
  useEffect(()=>{ const style = document.createElement('style'); style.innerHTML = CSS; document.head.appendChild(style); return ()=>{ style.remove(); }; },[]);
  function ensureCtx(){ if (!mixerRef.current){ const m = createMixer(); m.master.gain.value = 0.9; mixerRef.current = m; setCtxReady(true);} }

  const [delayTime, setDelayTime] = useState<number>(0.28);
  const [delayFeedback, setDelayFeedback] = useState<number>(0.30);
  const [delayMix, setDelayMix] = useState<number>(0.25);
  const [reverbSec, setReverbSec] = useState<number>(1.6);
  const [reverbMix, setReverbMix] = useState<number>(0.22);

  useEffect(()=>{ const m = mixerRef.current; if(!m) return; m.drumBus.gain.value = mutes.drum ? 0 : volumes.drum; m.bassBus.gain.value = mutes.bass ? 0 : volumes.bass; m.guitarBus.gain.value = mutes.guitar ? 0 : volumes.guitar; m.leadBus.gain.value = volumes.lead; }, [volumes, mutes]);
  useEffect(()=>{ const m = mixerRef.current; if(!m) return; m.delay.delayTime.value = delayTime; m.delayFB.gain.value = delayFeedback; m.delayWet.gain.value = delayMix; m.reverbWet.gain.value = reverbMix; }, [delayTime, delayFeedback, delayMix, reverbMix]);
  useEffect(()=>{ const m = mixerRef.current; if(!m) return; m.reverb.buffer = createImpulseResponse(m.ctx, reverbSec); }, [reverbSec]);

  type Slot = { name:string; buffer:AudioBuffer|null; root?:number; selected?:boolean };
  const [guitarSlots, setGuitarSlots] = useState<Slot[]>(Array.from({length:20}, (_,i)=>({name:'Guitar '+(i+1), buffer:null, root:64, selected:false})));
  const [drumSlots, setDrumSlots] = useState<Slot[]>(Array.from({length:30}, (_,i)=>({name:'Drum '+(i+1), buffer:null})));
  const [bassSlots, setBassSlots] = useState<Slot[]>(Array.from({length:30}, (_,i)=>({name:'Bass '+(i+1), buffer:null, root:40})));

  type LoopSlot = { name:string; buffer:AudioBuffer|null; volume:number; enabled:boolean; bars:number };
  const [drumLoops, setDrumLoops] = useState<LoopSlot[]>(Array.from({length:8}, (_,i)=>({name:'Drum Loop '+(i+1), buffer:null, volume:0.8, enabled:false, bars:4})));
  const [bassLoops, setBassLoops] = useState<LoopSlot[]>(Array.from({length:8}, (_,i)=>({name:'Bass Loop '+(i+1), buffer:null, volume:0.7, enabled:false, bars:4})));

  const activeLoopsRef = useRef<Map<string, {src: AudioBufferSourceNode; gain: GainNode; startTime: number}>>(new Map());

  const [drumAssign, setDrumAssign] = useState<{kick:number|null; snare:number|null; hat:number|null}>({kick:null, snare:null, hat:null});

  const sampleBank = useMemo(()=>{
    const m: SampleBank = { buffers: [], roots: [] };
    guitarSlots.forEach(s=>{ if (s.selected && s.buffer){ m.buffers.push(s.buffer); m.roots.push((s.root ?? 64)|0); } });
    return m;
  }, [guitarSlots]);

  async function loadIntoSlot(file: File, kind: 'guitar'|'drum'|'bass'|'drumloop'|'bassloop', index:number){
    ensureCtx(); const ctx = mixerRef.current!.ctx; const buf = await decodeFileToBuffer(ctx, file);
    if (kind==='guitar'){ setGuitarSlots(prev=>{ const p=[...prev]; p[index] = {...p[index], name:file.name, buffer:buf}; return p; }); }
    else if (kind==='drum'){ setDrumSlots(prev=>{ const p=[...prev]; p[index] = {...p[index], name:file.name, buffer:buf}; return p; }); }
    else if (kind==='bass'){ setBassSlots(prev=>{ const p=[...prev]; p[index] = {...p[index], name:file.name, buffer:buf}; return p; }); }
    else if (kind==='drumloop'){ setDrumLoops(prev=>{ const p=[...prev]; p[index] = {...p[index], name:file.name, buffer:buf}; return p; }); }
    else if (kind==='bassloop'){ setBassLoops(prev=>{ const p=[...prev]; p[index] = {...p[index], name:file.name, buffer:buf}; return p; }); }
  }

  function clearSlot(kind:'guitar'|'drum'|'bass'|'drumloop'|'bassloop', index:number){
    if (kind==='guitar') setGuitarSlots(prev=>{ const p=[...prev]; p[index]={...p[index], buffer:null}; return p; });
    else if (kind==='drum') setDrumSlots(prev=>{ const p=[...prev]; p[index]={...p[index], buffer:null}; return p; });
    else if (kind==='bass') setBassSlots(prev=>{ const p=[...prev]; p[index]={...p[index], buffer:null}; return p; });
    else if (kind==='drumloop') setDrumLoops(prev=>{ const p=[...prev]; p[index]={...p[index], buffer:null, enabled:false}; return p; });
    else if (kind==='bassloop') setBassLoops(prev=>{ const p=[...prev]; p[index]={...p[index], buffer:null, enabled:false}; return p; });
  }

  function audition(kind:'guitar'|'drum'|'bass'|'drumloop'|'bassloop', index:number){
    const m=mixerRef.current;
    if(!m) return;
    let slot: {buffer: AudioBuffer|null} | undefined;
    let dest: AudioNode;
    if (kind==='guitar'){ slot=guitarSlots[index]; dest=m.leadBus; }
    else if (kind==='drum'){ slot=drumSlots[index]; dest=m.drumBus; }
    else if (kind==='bass'){ slot=bassSlots[index]; dest=m.bassBus; }
    else if (kind==='drumloop'){ slot=drumLoops[index]; dest=m.drumBus; }
    else { slot=bassLoops[index]; dest=m.bassBus; }
    if(!slot?.buffer) return;
    playBufferOnce(m, slot.buffer, dest, m.ctx.currentTime+0.01, 1);
  }

  function startLoop(kind: 'drumloop'|'bassloop', index:number, startTime?: number, barIndex?:number, isPlaying: boolean = false){
    const m=mixerRef.current;
    if(!m) return;
    const loop = kind==='drumloop' ? drumLoops[index] : bassLoops[index];
    if(!loop?.buffer || !loop.enabled) return;
    const key = kind+index;
    stopLoop(key);

    const secondsPerBeat = 60 / tempo;
    const loopDurationInBeats = loop.bars * 4;
    const targetDuration = loopDurationInBeats * secondsPerBeat;
    const playbackRate = loop.buffer.duration / targetDuration;

    const src = m.ctx.createBufferSource();
    src.buffer = loop.buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = loop.buffer.duration;
    src.playbackRate.value = playbackRate;

    const gain = m.ctx.createGain();
    gain.gain.value = loop.volume;
    const dest = kind==='drumloop' ? m.drumBus : m.bassBus;
    src.connect(gain).connect(dest);

    let when = startTime ?? m.ctx.currentTime;

    if(barIndex !== undefined && isPlaying){
      const barOffsetInLoop = barIndex % loop.bars;
      const offsetTime = (barOffsetInLoop * 4 * secondsPerBeat) % loop.buffer.duration;
      src.start(when, offsetTime);
    } else {
      src.start(when, 0);
    }
    activeLoopsRef.current.set(key, {src, gain, startTime: when});
  }

  function stopLoop(key: string){
    const node = activeLoopsRef.current.get(key);
    if(node){
      try { node.src.stop(); } catch(e){}
      activeLoopsRef.current.delete(key);
    }
  }

  function updateActiveLoopVolume(key: string, volume: number){
    const node = activeLoopsRef.current.get(key);
    if(node) node.gain.gain.value = volume;
  }

  function updateLoopVolume(kind: 'drumloop'|'bassloop', index:number, volume:number){
    const key = kind+index;
    updateActiveLoopVolume(key, volume);
    if(kind==='drumloop') setDrumLoops(prev=>{ const p=[...prev]; p[index]={...p[index], volume}; return p; });
    else setBassLoops(prev=>{ const p=[...prev]; p[index]={...p[index], volume}; return p; });
  }

  function updateLoopBars(kind: 'drumloop'|'bassloop', index:number, bars:number){
    if(kind==='drumloop') setDrumLoops(prev=>{ const p=[...prev]; p[index]={...p[index], bars}; return p; });
    else setBassLoops(prev=>{ const p=[...prev]; p[index]={...p[index], bars}; return p; });
    const key = kind+index;
    const loop = kind==='drumloop' ? drumLoops[index] : bassLoops[index];
    if(t.isPlaying && loop.enabled){
      stopLoop(key);
      setTimeout(()=> startLoop(kind, index, undefined, t.barIndex), 50);
    }
  }

  function toggleLoop(kind: 'drumloop'|'bassloop', index:number){
    const loop = kind==='drumloop' ? drumLoops[index] : bassLoops[index];
    const newEnabled = !loop.enabled;
    if(kind==='drumloop') setDrumLoops(prev=>{ const p=[...prev]; p[index]={...p[index], enabled:newEnabled}; return p; });
    else setBassLoops(prev=>{ const p=[...prev]; p[index]={...p[index], enabled:newEnabled}; return p; });

    const key = kind+index;
    if(newEnabled && t.isPlaying){
      const m=mixerRef.current;
      if(m) startLoop(kind, index, t.nextTickTime || m.ctx.currentTime, t.barIndex, true);
    } else {
      stopLoop(key);
    }
  }

  const drumBank = useMemo(()=> drumSlots.map(s=> s.buffer ?? null), [drumSlots]);
  const { t, setT, start, stop, bars } = useTransport(mixerRef, seqId, {drum: (mutes.drum || drumSource==='loops')?0:volumes.drum, bass:(mutes.bass || bassSource==='loops')?0:volumes.bass, guitar:mutes.guitar?0:volumes.guitar}, drumAssign, drumBank);

  const startAllEnabledLoops = (startTime?: number, barIndex?: number, isPlaying: boolean = true) => {
    drumLoops.forEach((loop, i)=> {
      if(loop.enabled && loop.buffer) startLoop('drumloop', i, startTime, barIndex, isPlaying);
    });
    bassLoops.forEach((loop, i)=> {
      if(loop.enabled && loop.buffer) startLoop('bassloop', i, startTime, barIndex, isPlaying);
    });
  };

  useEffect(()=>{ setT(prev=>({...prev, tempo})) }, [tempo, setT]);

  useEffect(()=>{
    const m=mixerRef.current;
    if(!m) return;
    if(t.isPlaying){
      const startTime = m.ctx.currentTime + 0.05;
      startAllEnabledLoops(startTime, t.barIndex, true);
    } else {
      activeLoopsRef.current.forEach((_, key)=> stopLoop(key));
    }
  }, [t.isPlaying]);

  useEffect(()=>{
    if(t.isPlaying){
      activeLoopsRef.current.forEach((_, key)=>{
        const [kind, indexStr] = key.match(/(drumloop|bassloop)(\d+)/)?.slice(1) || [];
        const index = parseInt(indexStr);
        if(kind && !isNaN(index)){
          const loop = kind==='drumloop' ? drumLoops[index] : bassLoops[index];
          if(loop?.enabled){
            stopLoop(key);
            setTimeout(()=> startLoop(kind as 'drumloop'|'bassloop', index, undefined, t.barIndex, true), 50);
          }
        }
      });
    }
  }, [tempo]);

  useEffect(()=>{
    if(t.isPlaying){
      const m=mixerRef.current;
      if(!m) return;
      activeLoopsRef.current.forEach((_, key)=> stopLoop(key));
      const startTime = m.ctx.currentTime + 0.05;
      startAllEnabledLoops(startTime, t.barIndex, true);
    }
  }, [drumSource, bassSource]);

  useEffect(()=>{
    drumLoops.forEach((loop, i)=>{
      const key = 'drumloop'+i;
      const active = activeLoopsRef.current.get(key);
      if(active) active.gain.gain.value = loop.volume;
    });
  }, [drumLoops]);

  useEffect(()=>{
    bassLoops.forEach((loop, i)=>{
      const key = 'bassloop'+i;
      const active = activeLoopsRef.current.get(key);
      if(active) active.gain.gain.value = loop.volume;
    });
  }, [bassLoops]);

  const currentChord = bars[t.barIndex % bars.length]?.chord || {root:0, qual:"7" as const};
  const highlightPCs = useMemo(()=> bluesScalePitchesForChord(currentChord), [currentChord]);

  useEffect(()=>{
    try {
      console.assert(bars.length === 12, 'Esperava 12 compassos, obtive '+bars.length);
      console.assert(highlightPCs.size === 6, 'Escala de blues deve ter 6 notas, obtive '+highlightPCs.size);
      const ids = new Set(SEQUENCES.map(s=>s.id)); console.assert(ids.size === SEQUENCES.length, 'IDs de SEQUENCES devem ser únicos');
    } catch (e) {}
  }, [bars, highlightPCs]);

  return (
    <div className="app" onMouseDown={ensureCtx} onTouchStart={(e)=>{ e.stopPropagation(); ensureCtx(); }}>
      <h1>BluesLooper</h1>
      <div className="sub">12-bar blues + lead (Synth/Sampler/FX) • 20 guitar, 30 drum, 30 bass slots • 8 drum + 8 bass loops</div>

      <div className="panel grid">
        <div>
          <div className="row" style={{gap:16, alignItems:'center'}}>
            <select value={seqId} onChange={e=>setSeqId(e.target.value)} onFocus={ensureCtx}>{SEQUENCES.map(s=> <option key={s.id} value={s.id}>{s.title}</option>)}</select>
            <label>Tempo: {tempo} bpm</label>
            <input type="range" min={60} max={160} value={tempo} onChange={e=>setTempo(parseInt(e.target.value))} onMouseDown={ensureCtx} />
            {!t.isPlaying ? (<button className="btn primary" onClick={()=>{ ensureCtx(); start(); }}>Play</button>):(<button className="btn stop" onClick={stop}>Stop</button>)}
          </div>

          <div className="panel" style={{marginTop:14}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
              <div>Compasso: <strong>{(t.barIndex%bars.length)+1}</strong> / {bars.length}</div>
              <div>Acorde: <strong>{pcToName(currentChord.root)}{currentChord.qual}</strong></div>
            </div>
            <div className="kbdDock">
              <Piano mixerRef={mixerRef} highlightPCs={highlightPCs} disabled={!ctxReady} leadEngine={leadEngine} synthSettings={synth} sampleBank={sampleBank} sampleRootFallback={64} maxVoices={maxVoices} quantize={quantize} />
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3 style={{marginTop:0}}>Mixer</h3>
            <div style={{display:'grid', gridTemplateColumns:'auto auto', gap:'12px', marginBottom:'12px', fontSize:'11px'}}>
              <label style={{display:'flex', alignItems:'center', gap:'6px'}}>
                Drum Source:
                <select value={drumSource} onChange={e=>setDrumSource(e.target.value as 'sequence'|'loops')} style={{fontSize:'11px', padding:'4px'}}>
                  <option value="sequence">Sequence</option>
                  <option value="loops">Loops</option>
                </select>
              </label>
              <label style={{display:'flex', alignItems:'center', gap:'6px'}}>
                Bass Source:
                <select value={bassSource} onChange={e=>setBassSource(e.target.value as 'sequence'|'loops')} style={{fontSize:'11px', padding:'4px'}}>
                  <option value="sequence">Sequence</option>
                  <option value="loops">Loops</option>
                </select>
              </label>
            </div>
            <div className="mixer">
              <Strip name="Drums" value={volumes.drum} onChange={v=>setVolumes({...volumes, drum:v})} muted={mutes.drum} onToggleMute={()=>setMutes({...mutes, drum:!mutes.drum})}/>
              <Strip name="Bass" value={volumes.bass} onChange={v=>setVolumes({...volumes, bass:v})} muted={mutes.bass} onToggleMute={()=>setMutes({...mutes, bass:!mutes.bass})}/>
              <Strip name="Guitar" value={volumes.guitar} onChange={v=>setVolumes({...volumes, guitar:v})} muted={mutes.guitar} onToggleMute={()=>setMutes({...mutes, guitar:!mutes.guitar})}/>
              <Strip name="Lead" value={volumes.lead} onChange={v=>setVolumes({...volumes, lead:v})} muted={false} onToggleMute={()=>{}}/>
            </div>
          </div>

          <Collapsible title="Lead Engine" defaultOpen={false}>
            <div className="controls">
              <label>Motor de Lead
                <select value={leadEngine} onChange={e=>setLeadEngine(e.target.value as LeadEngine)}>
                  <option value="synth">Synth</option>
                  <option value="sampler">Sampler</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={quantize} onChange={e=>setQuantize(e.target.checked)} /> Quantizar para escala blues
              </label>
              <label>Max Vozes
                <input type="number" min={1} max={16} value={maxVoices} onChange={e=>setMaxVoices(parseInt(e.target.value)||1)} />
              </label>
              <label>Wave A
                <select value={synth.waveA} onChange={e=>setSynth({...synth, waveA:e.target.value})}><option>sine</option><option>triangle</option><option>square</option><option>sawtooth</option></select>
              </label>
              <label>Wave B
                <select value={synth.waveB} onChange={e=>setSynth({...synth, waveB:e.target.value})}><option>sine</option><option>triangle</option><option>square</option><option>sawtooth</option></select>
              </label>
              <label>Mix A<input type="range" min={0} max={1} step={0.01} value={synth.mixA} onChange={e=>setSynth({...synth, mixA: parseFloat(e.target.value)})} /></label>
              <label>Mix B<input type="range" min={0} max={1} step={0.01} value={synth.mixB} onChange={e=>setSynth({...synth, mixB: parseFloat(e.target.value)})} /></label>
              <label>Detune<input type="range" min={-0.5} max={0.5} step={0.01} value={synth.detune} onChange={e=>setSynth({...synth, detune: parseFloat(e.target.value)})} /></label>
              <label>Cutoff<input type="range" min={200} max={8000} step={1} value={synth.cutoff} onChange={e=>setSynth({...synth, cutoff: parseFloat(e.target.value)})} /></label>
              <label>Resonância<input type="range" min={0.1} max={10} step={0.1} value={synth.resonance} onChange={e=>setSynth({...synth, resonance: parseFloat(e.target.value)})} /></label>
              <label>Drive<input type="range" min={0} max={200} step={1} value={synth.drive} onChange={e=>setSynth({...synth, drive: parseFloat(e.target.value)})} /></label>
              <label>Glide<input type="range" min={0} max={0.5} step={0.001} value={synth.glideSec} onChange={e=>setSynth({...synth, glideSec: parseFloat(e.target.value)})} /></label>
            </div>
          </Collapsible>

          <Collapsible title="FX Lead" defaultOpen={false}>
            <div className="controls">
              <label>Delay Time<input type="range" min={0.01} max={1} step={0.01} value={delayTime} onChange={e=>setDelayTime(parseFloat(e.target.value))} /></label>
              <label>Delay Feedback<input type="range" min={0} max={0.9} step={0.01} value={delayFeedback} onChange={e=>setDelayFeedback(parseFloat(e.target.value))} /></label>
              <label>Delay Mix<input type="range" min={0} max={1} step={0.01} value={delayMix} onChange={e=>setDelayMix(parseFloat(e.target.value))} /></label>
              <label>Reverb Sec<input type="range" min={0.2} max={4} step={0.1} value={reverbSec} onChange={e=>setReverbSec(parseFloat(e.target.value))} /></label>
              <label>Reverb Mix<input type="range" min={0} max={1} step={0.01} value={reverbMix} onChange={e=>setReverbMix(parseFloat(e.target.value))} /></label>
            </div>
          </Collapsible>
        </div>
      </div>

      <Collapsible title="Slots de Samples" defaultOpen={false}>
        <div className="slots">
          <div className="slotCol">
            <h3>Guitarra (Lead)</h3>
            <div className="slotGrid">
              {guitarSlots.map((slot, i)=>(
                <div key={i} className="slot">
                  <div className="slotName">{slot.name}</div>
                  {slot.buffer && <div>Root: <input type="number" min={0} max={127} value={slot.root||64} onChange={e=>setGuitarSlots(prev=>{const p=[...prev]; p[i]={...p[i], root:parseInt(e.target.value)||64}; return p;})} /></div>}
                  <input type="file" id={'g'+i} accept="audio/*" onChange={e=>e.target.files?.[0] && loadIntoSlot(e.target.files[0], 'guitar', i)} />
                  <label htmlFor={'g'+i} className="btn">{slot.buffer?'Replace':'Load'}</label>
                  <div className="slotActions">
                    {slot.buffer && <><button className="btn" onClick={()=>audition('guitar', i)}>Play</button><button className="btn" onClick={()=>clearSlot('guitar', i)}>Clear</button></>}
                  </div>
                  {slot.buffer && <div className="checkRow"><input type="checkbox" checked={!!slot.selected} onChange={e=>setGuitarSlots(prev=>{const p=[...prev]; p[i]={...p[i], selected:e.target.checked}; return p;})} /> <span>Use in bank</span></div>}
                </div>
              ))}
            </div>
          </div>

          <div className="slotCol">
            <h3>Bateria</h3>
            <div style={{marginBottom:12}}>
              <label>Kick: <select value={drumAssign.kick??''} onChange={e=>setDrumAssign({...drumAssign, kick:e.target.value?parseInt(e.target.value):null})}><option value="">Synth</option>{drumSlots.map((s,i)=>s.buffer&&<option key={i} value={i}>{s.name}</option>)}</select></label>
              <label>Snare: <select value={drumAssign.snare??''} onChange={e=>setDrumAssign({...drumAssign, snare:e.target.value?parseInt(e.target.value):null})}><option value="">Synth</option>{drumSlots.map((s,i)=>s.buffer&&<option key={i} value={i}>{s.name}</option>)}</select></label>
              <label>Hat: <select value={drumAssign.hat??''} onChange={e=>setDrumAssign({...drumAssign, hat:e.target.value?parseInt(e.target.value):null})}><option value="">Synth</option>{drumSlots.map((s,i)=>s.buffer&&<option key={i} value={i}>{s.name}</option>)}</select></label>
            </div>
            <div className="slotGrid">
              {drumSlots.map((slot, i)=>(
                <div key={i} className="slot">
                  <div className="slotName">{slot.name}</div>
                  <input type="file" id={'d'+i} accept="audio/*" onChange={e=>e.target.files?.[0] && loadIntoSlot(e.target.files[0], 'drum', i)} />
                  <label htmlFor={'d'+i} className="btn">{slot.buffer?'Replace':'Load'}</label>
                  <div className="slotActions">
                    {slot.buffer && <><button className="btn" onClick={()=>audition('drum', i)}>Play</button><button className="btn" onClick={()=>clearSlot('drum', i)}>Clear</button></>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="slotCol">
            <h3>Baixo</h3>
            <div className="slotGrid">
              {bassSlots.map((slot, i)=>(
                <div key={i} className="slot">
                  <div className="slotName">{slot.name}</div>
                  {slot.buffer && <div>Root: <input type="number" min={0} max={127} value={slot.root||40} onChange={e=>setBassSlots(prev=>{const p=[...prev]; p[i]={...p[i], root:parseInt(e.target.value)||40}; return p;})} /></div>}
                  <input type="file" id={'b'+i} accept="audio/*" onChange={e=>e.target.files?.[0] && loadIntoSlot(e.target.files[0], 'bass', i)} />
                  <label htmlFor={'b'+i} className="btn">{slot.buffer?'Replace':'Load'}</label>
                  <div className="slotActions">
                    {slot.buffer && <><button className="btn" onClick={()=>audition('bass', i)}>Play</button><button className="btn" onClick={()=>clearSlot('bass', i)}>Clear</button></>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Loops Contínuos" defaultOpen={false}>
        <div className="sub" style={{marginTop:8}}>Use o Mixer para escolher entre Sequence (bateria/baixo sintetizados) ou Loops (seus samples). Loops habilitados tocam continuamente.</div>
        <div className="slots" style={{gridTemplateColumns:'repeat(2, 1fr)'}}>
          <div className="slotCol">
            <h3>Drum Loops</h3>
            <div className="slotGrid">
              {drumLoops.map((loop, i)=>(
                <div key={i} className="slot loopSlot">
                  <div className="slotName">{loop.name}</div>
                  <input type="file" id={'dl'+i} accept="audio/*" onChange={e=>e.target.files?.[0] && loadIntoSlot(e.target.files[0], 'drumloop', i)} />
                  <label htmlFor={'dl'+i} className="btn">{loop.buffer?'Replace':'Load'}</label>
                  {loop.buffer && (
                    <>
                      <div className="slotActions">
                        <button className="btn" onClick={()=>audition('drumloop', i)}>Play</button>
                        <button className="btn" onClick={()=>clearSlot('drumloop', i)}>Clear</button>
                      </div>
                      <div className="loopControls">
                        <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px', marginTop:'8px'}}>
                          <input type="checkbox" checked={loop.enabled} onChange={()=>toggleLoop('drumloop', i)} />
                          <span>Enable Loop</span>
                        </label>
                        <label style={{fontSize:'11px', marginTop:'6px', display:'block'}}>
                          Bars: <input type="number" min={1} max={16} value={loop.bars} onChange={e=>updateLoopBars('drumloop', i, parseInt(e.target.value)||1)} style={{width:'50px'}} />
                        </label>
                        <label style={{fontSize:'11px', marginTop:'6px'}}>
                          Vol: {loop.volume.toFixed(2)}
                          <input type="range" min={0} max={1} step={0.01} value={loop.volume} onChange={e=>updateLoopVolume('drumloop', i, parseFloat(e.target.value))} style={{width:'100%'}} />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="slotCol">
            <h3>Bass Loops</h3>
            <div className="slotGrid">
              {bassLoops.map((loop, i)=>(
                <div key={i} className="slot loopSlot">
                  <div className="slotName">{loop.name}</div>
                  <input type="file" id={'bl'+i} accept="audio/*" onChange={e=>e.target.files?.[0] && loadIntoSlot(e.target.files[0], 'bassloop', i)} />
                  <label htmlFor={'bl'+i} className="btn">{loop.buffer?'Replace':'Load'}</label>
                  {loop.buffer && (
                    <>
                      <div className="slotActions">
                        <button className="btn" onClick={()=>audition('bassloop', i)}>Play</button>
                        <button className="btn" onClick={()=>clearSlot('bassloop', i)}>Clear</button>
                      </div>
                      <div className="loopControls">
                        <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px', marginTop:'8px'}}>
                          <input type="checkbox" checked={loop.enabled} onChange={()=>toggleLoop('bassloop', i)} />
                          <span>Enable Loop</span>
                        </label>
                        <label style={{fontSize:'11px', marginTop:'6px', display:'block'}}>
                          Bars: <input type="number" min={1} max={16} value={loop.bars} onChange={e=>updateLoopBars('bassloop', i, parseInt(e.target.value)||1)} style={{width:'50px'}} />
                        </label>
                        <label style={{fontSize:'11px', marginTop:'6px'}}>
                          Vol: {loop.volume.toFixed(2)}
                          <input type="range" min={0} max={1} step={0.01} value={loop.volume} onChange={e=>updateLoopVolume('bassloop', i, parseFloat(e.target.value))} style={{width:'100%'}} />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
