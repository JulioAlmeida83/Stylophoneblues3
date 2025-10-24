import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Trio Pedal — Sequenciador (64 compassos)
 * ----------------------------------------
 * Hotfix total: elimina definitivamente o erro "'return' outside of function"
 * garantindo que TODO o JSX está **dentro** do componente `App()` e que não há
 * nenhum bloco solto fora de função. Mantém o requisito: baixo e guitarra não
 * sofrem pitch/time-change (audio original quantizado), bateria ajusta o ritmo.
 */

// ====== Tipos ======

type TrackId = "drums" | "bass" | "guitar";

type SampleClip = {
  id: string;
  name: string;
  file?: File;
  url?: string;
  buffer?: AudioBuffer;
};

type GuitarCell = {
  sampleIdx: number;                // índice do sample (Maj/Min/Dim set)
  semitones: number;                // transposição teórica (som não usa)
  label: string;                    // rótulo exibido
  quality: "maj" | "min" | "dim"; // qualidade usada
} | null;                           // null = silêncio

type Arrangement = {
  drums: number[];  // índices por compasso (-1 = silêncio)
  bass: number[];
  guitar: GuitarCell[];
};

// ====== Música util ======

const NOTE_NAMES_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;
const MAJOR_SCALE_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const DEGREE_LABELS = ["I","II","III","IV","V","VI","VII°"] as const;

const KEY_TO_SEMITONE: Record<string, number> = {
  C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6, Gb:6,
  G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11, Cb:11
};

// Armaduras (maior)
const KEY_SIG_MAJOR: Record<string, {acc: '#' | 'b' | 'natural', count: number}> = {
  C: {acc:'natural', count:0},
  G: {acc:'#', count:1}, D:{acc:'#',count:2}, A:{acc:'#',count:3}, E:{acc:'#',count:4}, B:{acc:'#',count:5}, 'F#':{acc:'#',count:6}, 'C#':{acc:'#',count:7},
  F: {acc:'b', count:1}, Bb:{acc:'b',count:2}, Eb:{acc:'b',count:3}, Ab:{acc:'b',count:4}, Db:{acc:'b',count:5}, Gb:{acc:'b',count:6}, Cb:{acc:'b',count:7},
};

// Preferência de nomes por semitom
const SEMI_TO_NAME = [
  {sharp:'C',  flat:'C'},
  {sharp:'C#', flat:'Db'},
  {sharp:'D',  flat:'D'},
  {sharp:'D#', flat:'Eb'},
  {sharp:'E',  flat:'E'},
  {sharp:'F',  flat:'F'},
  {sharp:'F#', flat:'Gb'},
  {sharp:'G',  flat:'G'},
  {sharp:'G#', flat:'Ab'},
  {sharp:'A',  flat:'A'},
  {sharp:'A#', flat:'Bb'},
  {sharp:'B',  flat:'B'},
] as const;

const VARIATIONS = [
  "maj7","6","add9","sus2","sus4","5",
  "m","m7","m6","dim","ø7","7","7sus4",
  "9","m9","maj9","11","13"
];

// ====== Sequencer Config ======

const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const BAR_COUNT = 64;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.20;

function barDurationSeconds(bpm: number) { return (240 / bpm); } // compasso 4/4

// ====== Áudio: Percussivo (bateria) e Original (baixo/guitarra) ======

// Percussivo: copia/repete cortes com crossfade curto.
function stretchPercussive(buffer: AudioBuffer, targetDur: number, ctx: AudioContext, xfMs=8){
  const sr = ctx.sampleRate;
  const srcL = buffer.getChannelData(0);
  const srcR = buffer.numberOfChannels>1 ? buffer.getChannelData(1) : null;
  const outLen = Math.max(1, Math.floor(targetDur*sr));
  const outL = new Float32Array(outLen);
  const outR = new Float32Array(outLen);
  const xf = Math.max(1, Math.floor(xfMs/1000*sr));
  const seg = Math.max(128, Math.floor(buffer.length/8)); // 8 cortes básicos
  let pos = 0;
  while(pos < outLen){
    const take = Math.min(seg, outLen - pos);
    const srcStart = Math.floor((pos % buffer.length));
    for(let i=0;i<take;i++){
      const sIdx = (srcStart + i) % buffer.length;
      const aL = srcL[sIdx]; const aR = srcR ? srcR[sIdx] : aL;
      let win = 1;
      if(i < xf) win *= (i / xf);
      if(i > take-xf) win *= ((take - i) / xf);
      outL[pos+i] += aL * win;
      outR[pos+i] += aR * win;
    }
    pos += take;
  }
  // Normalização de pico
  let peak = 0; for(let i=0;i<outLen;i++){ const a=Math.max(Math.abs(outL[i]), Math.abs(outR[i])); if(a>peak) peak=a; }
  const target = 0.7; if(peak>target && peak>0){ const g = target/peak; for(let i=0;i<outLen;i++){ outL[i]*=g; outR[i]*=g; } }
  const outBuf = ctx.createBuffer(2, outLen, sr);
  outBuf.copyToChannel(outL, 0); outBuf.copyToChannel(outR, 1);
  return outBuf;
}

// ====== Estilos (CSS) ======

const styles = `
:root{ --bg:#0c0f1a; --panel:#121830; --ink:#e6ecff; --muted:#9db1ff; --accent:#6ea8ff; --grid:#1a2140; --gridAlt:#151b33; --playing:#2a3a74; --cell:#0f1428; }
*{box-sizing:border-box} html,body,#root{height:100%}
body{margin:0;background:radial-gradient(1200px 600px at 80% -10%, #1e2650 0%, #0c0f1a 40%, #0c0f1a 100%);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}
.app{max-width:1200px;margin:0 auto;padding:16px 16px 48px}
h1{font-weight:800;letter-spacing:.4px;margin:0 0 12px;font-size:22px}
.subtitle{color:var(--muted);margin-bottom:14px;font-size:13px}
.panel{background:linear-gradient(180deg, #121830, #0f1530);border:1px solid #1f2750;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:12px;margin-bottom:14px}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button{background:#1b2550;border:1px solid #2b3675;color:var(--ink);padding:10px 14px;border-radius:12px;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.08)}
button.play{background:linear-gradient(180deg,#2a7c2e,#1f5f23);border-color:#2f8933}
button.stop{background:linear-gradient(180deg,#7c2a2a,#5f1f1f);border-color:#893333}
label{font-size:12px;color:var(--muted)}
input[type="number"], input[type="text"], select{background:#0f1428;border:1px solid #273168;color:var(--ink);padding:8px 10px;border-radius:10px}
.range{display:flex;align-items:center;gap:8px}
.range input[type="range"]{width:180px}
.loaderRow{display:flex;flex-wrap:wrap;gap:10px}
.loader{flex:1;min-width:260px;background:#0f1428;border:1px dashed #2b3675;border-radius:12px;padding:10px}
.loader h3{margin:0 0 8px;font-size:14px;color:var(--muted)}
.clipList{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tag{font-size:12px;padding:6px 8px;border-radius:999px;background:#131a36;border:1px solid #2b3675}
.gridWrap{overflow:auto;border-radius:14px;border:1px solid #263162}
.grid{display:grid;grid-template-columns: 220px repeat(64, 42px);} /* + espaço para rótulos */
.gridHeader{position:sticky;top:0;z-index:2}
.grid .th, .grid .cellTitle{background:#0f1428;color:var(--muted);font-weight:700}
.grid .th, .grid .cellTitle, .grid .cell{border-bottom:1px solid #212a57;border-right:1px solid #212a57;min-height:40px;display:flex;align-items:center;justify-content:center}
.grid .th{font-size:11px}
.grid .rowLabel{position:sticky;left:0;z-index:1;background:#0f1428}
.cell{background:var(--cell)} .cell.playing{background:var(--playing)}
.cell select{width:100%;height:100%;background:transparent;border:none;color:var(--ink);text-align:center}
.cell option{background:#0f1428}
.footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:10px}
.small{font-size:12px;color:var(--muted)}
.badge{padding:2px 8px;border-radius:999px;border:1px solid #2b3675;background:#0f1428;color:var(--ink);font-size:12px}
.clearBtn{background:#1a203f}
.keyRow{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
`;

// ====== Componente ======

export default function App(){
  // Estado
  const [key, setKey] = useState<string>("C"); // Tonalidade (concert)
  const [displayForBb, setDisplayForBb] = useState<boolean>(false); // apenas rótulos/armadura

  const [bpm, setBpm] = useState<number>(96);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBarView, setCurrentBarView] = useState(0);

  const [clips, setClips] = useState<Record<TrackId, SampleClip[]>>({ drums: [], bass: [], guitar: [] });

  const emptyRow = useMemo(() => Array(BAR_COUNT).fill(-1), []);
  const emptyGuitarRow = useMemo<GuitarCell[]>(() => Array(BAR_COUNT).fill(null), []);
  const [arr, setArr] = useState<Arrangement>({ drums: [...emptyRow], bass: [...emptyRow], guitar: [...emptyGuitarRow] });

  // Kit de acordes
  const [gtrMajIdx, setGtrMajIdx] = useState<number | null>(null);
  const [gtrMinIdx, setGtrMinIdx] = useState<number | null>(null);
  const [gtrDimIdx, setGtrDimIdx] = useState<number | null>(null);

  // Áudio & scheduler
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<{in: GainNode, hpf: BiquadFilterNode, comp: DynamicsCompressorNode, shaper: WaveShaperNode, out: GainNode} | null>(null);
  const startTimeRef = useRef(0);
  const nextBarTimeRef = useRef(0);
  const currBarRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const ensureCtx = () => {
    if(!audioCtxRef.current){
      // @ts-ignore Safari
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current!;
  };

  // Curva identidade (sem distorção)
  const makeIdentityCurve = () => { const n=65536; const c=new Float32Array(n); for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=x; } return c; };

  /** Master bus: HPF→Comp→SoftClip(identidade)→Gain */
  const ensureGraph = () => {
    const ctx = ensureCtx();
    if(!masterRef.current){
      const input = ctx.createGain(); input.gain.value = 0.9;
      const hpf = ctx.createBiquadFilter(); hpf.type='highpass'; hpf.frequency.value = 30; hpf.Q.value = 0.707;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 9; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.18;
      const shaper = ctx.createWaveShaper(); shaper.curve = makeIdentityCurve(); // linear
      const out = ctx.createGain(); out.gain.value = 0.7; // headroom
      input.connect(hpf); hpf.connect(comp); comp.connect(shaper); shaper.connect(out); out.connect(ctx.destination);
      masterRef.current = { in: input, hpf, comp, shaper, out };
    }
    return { ctx, dest: masterRef.current!.in };
  };

  const decodeFileToBuffer = async (file: File): Promise<AudioBuffer> => {
    const { ctx } = ensureGraph();
    const ab = await file.arrayBuffer();
    return await ctx.decodeAudioData(ab.slice(0));
  };

  const handleFiles = async (track: TrackId, files: FileList | null) => {
    if(!files || files.length === 0) return;
    const arrNew: SampleClip[] = [];
    for(const f of Array.from(files)){
      try{ const buffer = await decodeFileToBuffer(f); const url = URL.createObjectURL(f); arrNew.push({ id: uuid(), name: f.name, file: f, url, buffer }); }
      catch(e){ console.warn("Falha ao decodificar:", f.name, e); }
    }
    setClips(prev => ({...prev, [track]: [...prev[track], ...arrNew]}));
  };

  const clearRow = (track: TrackId) => {
    if(track === 'guitar') setArr(prev => ({...prev, guitar: Array(BAR_COUNT).fill(null)}));
    else setArr(prev => ({...prev, [track]: Array(BAR_COUNT).fill(-1)} as Arrangement));
  };

  const barDur = useMemo(() => barDurationSeconds(bpm), [bpm]);

  // ====== Nomes/armadura (USAM `key`) ======
  const pickNameForSemis = (semi:number, preferFlats:boolean) => preferFlats ? SEMI_TO_NAME[semi].flat : SEMI_TO_NAME[semi].sharp;
  const concertKeySemi = () => KEY_TO_SEMITONE[key] ?? 0;
  const writtenKeySemiForBb = () => (concertKeySemi() + 2) % 12; // instrumentos em Bb leem 1 tom acima
  const writtenKeyNameForBb = () => pickNameForSemis(writtenKeySemiForBb(), true);
  const keySigLabel = (name:string) => { const sig = KEY_SIG_MAJOR[name] || {acc:'natural',count:0}; if(sig.acc==='natural'||sig.count===0) return '♮ (0)'; return sig.acc==='#' ? `${sig.count}#` : `${sig.count}♭`; };

  // ====== Música helpers ======
  const degreeRootConcert = (degreeIndex: number): { semisFromC: number; noteConcert: string } => {
    const base = (concertKeySemi() + MAJOR_SCALE_DEGREES[degreeIndex]) % 12;
    const noteConcert = NOTE_NAMES_FLAT[base];
    return { semisFromC: base, noteConcert };
  };

  const displayNoteForDegree = (degreeIndex:number): string => {
    if(!displayForBb){ return degreeRootConcert(degreeIndex).noteConcert; }
    const baseWritten = (writtenKeySemiForBb() + MAJOR_SCALE_DEGREES[degreeIndex]) % 12;
    return NOTE_NAMES_FLAT[baseWritten];
  };

  // Semitons sempre em concert (som); rótulos podem ser para Bb
  const semitonesForDegreeConcert = (degreeIndex: number): number => degreeRootConcert(degreeIndex).semisFromC;

  // ====== Scheduler ======
  const scheduleBar = (barIndex: number, whenSec: number) => {
    const { ctx, dest } = ensureGraph();

    const schedulePercussive = (buf: AudioBuffer, targetDur: number, when: number) => {
      const outBuf = stretchPercussive(buf, targetDur, ctx, 8);
      const src = ctx.createBufferSource();
      src.buffer = outBuf;
      const g = ctx.createGain(); g.gain.value = 0.6; // gain staging
      src.connect(g); g.connect(dest);
      const delay = Math.max(0, when - ctx.currentTime);
      src.start(ctx.currentTime + delay);
    };

    // Tocar sample original (sem pitch/time change), apenas quantizado e com fade de saída
    const scheduleOriginal = (buf: AudioBuffer, targetDur: number, when: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1.0; // mantém velocidade
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.6, when + 0.02); // fade-in curto
      const stopAt = when + Math.min(targetDur, buf.duration);
      g.gain.setValueAtTime(0.6, stopAt - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, stopAt); // fade-out curto
      src.connect(g); g.connect(dest);
      const delay = Math.max(0, when - ctx.currentTime);
      src.start(ctx.currentTime + delay);
      src.stop(stopAt);
    };

    // DRUMS: percussivo
    const dIdx = arr.drums[barIndex]; if(dIdx !== -1 && clips.drums[dIdx]?.buffer){ schedulePercussive(clips.drums[dIdx].buffer!, barDur, whenSec); }

    // BASS & GUITAR: sample original (som não muda)
    const bIdx = arr.bass[barIndex]; if(bIdx !== -1 && clips.bass[bIdx]?.buffer){ scheduleOriginal(clips.bass[bIdx].buffer!, barDur, whenSec); }
    const cell = arr.guitar[barIndex]; if(cell && clips.guitar[cell.sampleIdx]?.buffer){ scheduleOriginal(clips.guitar[cell.sampleIdx].buffer!, barDur, whenSec); }
  };

  const schedulerTick = () => {
    const ctx = ensureCtx();
    while (nextBarTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleBar(currBarRef.current, nextBarTimeRef.current);
      nextBarTimeRef.current += barDur;
      currBarRef.current = (currBarRef.current + 1) % BAR_COUNT;
    }
  };

  const start = async () => {
    const ctx = ensureCtx();
    if(ctx.state === "suspended") await ctx.resume();
    ensureGraph(); // garante master

    setIsPlaying(true);
    startTimeRef.current = ctx.currentTime + 0.05;
    nextBarTimeRef.current = startTimeRef.current;
    currBarRef.current = 0;

    timerRef.current = window.setInterval(schedulerTick, LOOKAHEAD_MS);
    const raf = () => {
      const t = ctx.currentTime - startTimeRef.current;
      const n = t < 0 ? 0 : Math.floor(t / barDur) % BAR_COUNT;
      setCurrentBarView(n);
      rafRef.current = requestAnimationFrame(raf);
    };
    rafRef.current = requestAnimationFrame(raf);
  };

  const stop = () => {
    setIsPlaying(false);
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current = null; }
    if(rafRef.current){ cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setCurrentBarView(0);
  };

  useEffect(() => { if(isPlaying){ stop(); start(); } }, [bpm]);

  // ====== Export/Import ======
  const exportJSON = () => {
    const data = { bpm, key, displayForBb, gtrMajIdx, gtrMinIdx, gtrDimIdx, arr };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "trio-pedal-arranjo.json"; a.click(); URL.revokeObjectURL(url);
  };

  const importJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if(!f) return; const txt = await f.text();
    try{ const data = JSON.parse(txt); if(data){ setBpm(data.bpm ?? 96); setKey(data.key ?? 'C'); setDisplayForBb(!!data.displayForBb); setArr(data.arr); setGtrMajIdx(data.gtrMajIdx ?? null); setGtrMinIdx(data.gtrMinIdx ?? null); setGtrDimIdx(data.gtrDimIdx ?? null); } }
    catch{ alert("Arquivo inválido"); }
  };

  // ====== UI helpers ======
  const optionsFor = (track: TrackId) => {
    const ops = clips[track].map((c, i) => ({ value: i, label: `${i+1}: ${c.name}` }));
    return [{ value: -1, label: "—" }, ...ops];
  };

  const setCell = (track: TrackId, bar: number, value: number) => {
    setArr(prev => ({...prev, [track]: (prev[track] as number[]).map((v, i) => i===bar ? value : v)}));
  };

  // ====== GUITARRA: Qualidade por grau (maior) ======
  const degreeQuality = (d:number): 'maj'|'min'|'dim' => {
    switch(d){
      case 0: return 'maj'; // I
      case 1: return 'min'; // II
      case 2: return 'min'; // III
      case 3: return 'maj'; // IV
      case 4: return 'maj'; // V
      case 5: return 'min'; // VI
      case 6: return 'dim'; // VII°
      default: return 'maj';
    }
  };

  const qualityToSampleIdx = (q:'maj'|'min'|'dim'): number | null => {
    if(q==='maj') return gtrMajIdx ?? gtrMinIdx ?? gtrDimIdx ?? null;
    if(q==='min') return gtrMinIdx ?? gtrMajIdx ?? gtrDimIdx ?? null;
    return gtrDimIdx ?? gtrMinIdx ?? gtrMajIdx ?? null;
  };

  const labelFor = (degree: number, note: string, q:'maj'|'min'|'dim') => {
    const suf = q==='maj' ? '' : (q==='min' ? 'm' : 'dim');
    const deg = DEGREE_LABELS[degree];
    return `${deg} (${note}${suf})`;
  };

  // Dropdown para GUITARRA com qualidade correta
  function guitarOptions(): { value: string; cell: GuitarCell; label: string }[] {
    const out: { value: string; cell: GuitarCell; label: string }[] = [];
    out.push({ value: "silence", cell: null, label: "—" });

    for(let d=0; d<7; d++){
      const semis = semitonesForDegreeConcert(d);   // som em concert
      const note  = displayNoteForDegree(d);        // rótulo (concert ou Bb)
      const q = degreeQuality(d);
      const idx = qualityToSampleIdx(q);
      const effIdx = (idx ?? 0);
      const lab = labelFor(d, note, q);
      const cell: GuitarCell = { sampleIdx: effIdx, semitones: semis, label: lab, quality: q };
      out.push({ value: `deg-${d}`, cell, label: lab });
    }

    // Variações — mesma base de qualidade (som não muda; rótulo informativo)
    for(let d=0; d<7; d++){
      const semis = semitonesForDegreeConcert(d);
      const note  = displayNoteForDegree(d);
      const q = degreeQuality(d);
      const idx = qualityToSampleIdx(q);
      const effIdx = (idx ?? 0);
      for(const v of VARIATIONS){
        const lab = `${labelFor(d, note, q)} ${v}`;
        const cell: GuitarCell = { sampleIdx: effIdx, semitones: semis, label: lab, quality: q };
        out.push({ value: `deg-${d}-${v}`, cell, label: lab });
      }
    }

    if(clips.guitar.length){
      out.push({ value: "sep", cell: null, label: "──────── Samples (brutos) ────────" });
      clips.guitar.forEach((c,i)=>{
        const lab = `Sample ${i+1}: ${c.name}`;
        const cell: GuitarCell = { sampleIdx:i, semitones:0, label:lab, quality:'maj' };
        out.push({ value: `raw-${i}`, cell, label: lab });
      });
    }

    return out;
  }

  const setGuitarCellFromValue = (bar: number, value: string) => {
    const opts = guitarOptions(); const found = opts.find(o => o.value === value); const cell = found ? found.cell : null;
    setArr(prev => ({...prev, guitar: prev.guitar.map((v,i)=> i===bar ? cell : v)}));
  };

  const currentValueForBar = (bar:number): string => {
    const cell = arr.guitar[bar]; if(cell === null) return "silence";
    const opts = guitarOptions(); const match = opts.find(o => o.cell && cell && o.cell.sampleIdx===cell.sampleIdx && o.cell.semitones===cell.semitones && o.label===cell.label);
    return match ? match.value : "silence";
  };

  // ====== Self‑tests ======
  useEffect(() => {
    console.assert(typeof key === 'string' && key.length >= 1, '`key` deve existir e ser string');
    console.assert(Math.abs(barDurationSeconds(120) - 2) < 1e-6, 'barDurationSeconds(120) == 2s');
    console.assert(Math.abs(barDurationSeconds(60) - 4) < 1e-6, 'barDurationSeconds(60) == 4s');

    // Escrita para Bb (C concert → D escrito)
    const name = (():string=>{ const idx=(KEY_TO_SEMITONE['C']+2)%12; return (SEMI_TO_NAME as any)[idx].sharp; })();
    console.assert(name==='D', 'C concert → escrito p/ Bb deve ser D');
    console.assert(KEY_SIG_MAJOR['D'].acc==='#' && KEY_SIG_MAJOR['D'].count===2, 'D maior tem 2 sustenidos');

    // Semitons concert
    const semiI = (KEY_TO_SEMITONE['C'] + MAJOR_SCALE_DEGREES[0])%12; const semiII = (KEY_TO_SEMITONE['C'] + MAJOR_SCALE_DEGREES[1])%12;
    console.assert(semiI===0 && semiII===2, 'Graus I/II em C (concert) = C/D');

    // Qualidades diatônicas (maior)
    const expected = ['maj','min','min','maj','maj','min','dim'] as const; for(let i=0;i<7;i++) console.assert(degreeQuality(i)===expected[i], `Qualidade do grau ${i} correta`);

    // Teste percussivo: duração alvo
    const fakeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = fakeCtx.createBuffer(1, 44100, 44100);
    const ch = src.getChannelData(0); for(let i=0;i<ch.length;i++){ ch[i]=Math.sin(2*Math.PI*220*i/44100); }
    const out = stretchPercussive(src, 2.0, fakeCtx, 8);
    console.assert(Math.abs(out.duration - 2.0) < 1/44100, 'Percussivo: duração alvo OK');

    const { ctx, dest } = ensureGraph();
    console.assert(ctx.sampleRate > 0 && !!dest, 'ensureGraph inicializa master corretamente');
  }, []);

  // ====== Subcomponentes ======
  const TrackRowSimple = ({ track, title }: { track: TrackId; title: string }) => {
    const opts = optionsFor(track);
    return (
      <>
        <div className="cellTitle rowLabel">{title}</div>
        {Array.from({length: BAR_COUNT}).map((_, col) => (
          <div key={col} className={`cell ${currentBarView===col && isPlaying ? 'playing' : ''}`}>
            <select value={(arr[track] as number[])[col]} onChange={(e)=> setCell(track, col, Number(e.target.value))} aria-label={`${title} compasso ${col+1}`}>
              {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}
      </>
    );
  };

  const TrackRowGuitar = () => {
    const opts = guitarOptions();
    return (
      <>
        <div className="cellTitle rowLabel">Guitarra</div>
        {Array.from({length: BAR_COUNT}).map((_, col) => (
          <div key={col} className={`cell ${currentBarView===col && isPlaying ? 'playing' : ''}`}>
            <select value={currentValueForBar(col)} onChange={(e)=> setGuitarCellFromValue(col, e.target.value)} aria-label={`Guitarra compasso ${col+1}`}>
              {opts.map((o,idx) => (
                <option key={idx} value={o.value} disabled={o.value==="sep"}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </>
    );
  };

  // ====== Render ======
  const concertKeyName = pickNameForSemis(concertKeySemi(), false);
  const writtenNameBb = writtenKeyNameForBb();
  const writtenSigBb = keySigLabel(writtenNameBb);

  return (
    <div className="app">
      <style>{styles}</style>
      <h1>Trio Pedal — Sequenciador (64 compassos)</h1>
      <div className="subtitle">Som em <b>concert</b>; opção de exibir tonalidade <b>para Bb</b> com armadura correspondente (apenas rótulos).</div>

      <div className="panel">
        <div className="controls">
          {!isPlaying ? (
            <button className="play" onClick={start}>▶ Play</button>
          ) : (
            <button className="stop" onClick={stop}>■ Stop</button>
          )}
          <div className="range">
            <label>BPM</label>
            <input type="range" min={60} max={180} value={bpm} onChange={(e)=> setBpm(Number(e.target.value))} />
            <input type="number" min={40} max={240} value={bpm} onChange={(e)=> setBpm(Number(e.target.value))} />
          </div>
          <span className="badge">Compasso atual: {currentBarView+1}/{BAR_COUNT}</span>
          <button onClick={exportJSON}>Exportar arranjo</button>
          <label className="small">Importar arranjo <input type="file" accept="application/json" onChange={importJSON} /></label>
        </div>
      </div>

      <div className="panel">
        <div className="keyRow">
          <div>
            <label>Tonalidade (concert)</label><br/>
            <select value={key} onChange={(e)=> setKey(e.target.value)}>
              {Object.keys(KEY_TO_SEMITONE).map(k=> <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label>Exibir escrita para Bb (armadura)</label><br/>
            <input type="checkbox" checked={displayForBb} onChange={(e)=> setDisplayForBb(e.target.checked)} />
          </div>
          <div className="badge">Concert: {concertKeyName}</div>
          {displayForBb && (<div className="badge">Para Bb: {writtenNameBb} — armadura: {writtenSigBb}</div>)}
        </div>
      </div>

      <div className="panel">
        <div className="keyRow">
          <div>
            <label>Guitarra — Kit de Acordes</label>
            <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
              <span className="small">Maj:</span>
              <select value={gtrMajIdx ?? ''} onChange={(e)=> setGtrMajIdx(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">(vazio)</option>
                {clips.guitar.map((c,i)=> <option key={i} value={i}>{`${i+1}: ${c.name}`}</option>)}
              </select>
              <span className="small">Min:</span>
              <select value={gtrMinIdx ?? ''} onChange={(e)=> setGtrMinIdx(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">(vazio)</option>
                {clips.guitar.map((c,i)=> <option key={i} value={i}>{`${i+1}: ${c.name}`}</option>)}
              </select>
              <span className="small">Dim:</span>
              <select value={gtrDimIdx ?? ''} onChange={(e)=> setGtrDimIdx(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">(vazio)</option>
                {clips.guitar.map((c,i)=> <option key={i} value={i}>{`${i+1}: ${c.name}`}</option>)}
              </select>
            </div>
            <div className="small" style={{marginTop:6}}>Dica: carregue 3 samples base (maior, menor e diminuto). O app seleciona a qualidade correta por grau (som permanece original).</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="loaderRow">
          <div className="loader">
            <h3>Samples de Bateria</h3>
            <input type="file" accept="audio/*" multiple onChange={(e)=> handleFiles('drums', e.target.files)} />
            <div className="clipList">{clips.drums.map((c,i)=> <span className="tag" key={c.id}>{i+1}</span>)}</div>
            <div style={{marginTop:8, display:'flex', gap:8}}><button className="clearBtn" onClick={()=> clearRow('drums')}>Limpar linha</button></div>
          </div>
          <div className="loader">
            <h3>Samples de Baixo</h3>
            <input type="file" accept="audio/*" multiple onChange={(e)=> handleFiles('bass', e.target.files)} />
            <div className="clipList">{clips.bass.map((c,i)=> <span className="tag" key={c.id}>{i+1}</span>)}</div>
            <div style={{marginTop:8, display:'flex', gap:8}}><button className="clearBtn" onClick={()=> clearRow('bass')}>Limpar linha</button></div>
          </div>
          <div className="loader">
            <h3>Samples de Guitarra</h3>
            <input type="file" accept="audio/*" multiple onChange={(e)=> handleFiles('guitar', e.target.files)} />
            <div className="clipList">{clips.guitar.map((c,i)=> <span className="tag" key={c.id}>{i+1}</span>)}</div>
            <div style={{marginTop:8, display:'flex', gap:8}}><button className="clearBtn" onClick={()=> clearRow('guitar')}>Limpar linha</button></div>
          </div>
        </div>
      </div>

      <div className="panel gridWrap">
        <div className="grid">
          <div className="th rowLabel gridHeader">Trilha</div>
          {Array.from({length: BAR_COUNT}).map((_,i)=> <div className="th gridHeader" key={i}>{i+1}</div>)}
          <TrackRowSimple track="drums" title="Bateria" />
          <TrackRowSimple track="bass" title="Baixo" />
          <TrackRowGuitar />
        </div>
        <div className="footer">
          <div className="small">“Exibir escrita para Bb” altera apenas rótulos e armadura. O som permanece em concert.</div>
          <div className="small">Se quiser, adiciono modo menor (natural/harmônica/melódica) e modos (Dórico etc.).</div>
        </div>
      </div>
    </div>
  );
}
