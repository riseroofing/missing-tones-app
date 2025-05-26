import React, { useState, useRef, useEffect } from 'react';
import Meyda from 'meyda';
import ReferencePlayer from './ReferencePlayer';
import './App.css';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';

// Configuration
const RECORD_DURATION_MS = 5000;
const WAVEFORM_FFT_SIZE  = 2048;
const SPECTRUM_FFT_SIZE  = 4096;
const COUNTDOWN_INTERVAL = 1000; // 1 second
const THRESHOLD_DB       = -10;  // stricter detection threshold (dB)

const NOISE_FLOOR = 0.02; // RMS below this is considered silence

const TARGET_FREQUENCIES = [
  261.63, 277.18, 293.66, 311.13,
  329.63, 349.23, 369.99, 392.00,
  415.30, 440.00, 466.16, 493.88
];

const MIN_PEAK = 0.01; // Minimum peak magnitude to consider as valid voice input

function App() {
  const [stage, setStage]         = useState('idle');
  const [secondsLeft, setSeconds] = useState(0);
  const [currentMags, setMags]    = useState(TARGET_FREQUENCIES.map(() => 0));
  const [missing, setMissing]     = useState([]);
  const [error, setError]         = useState(null);

  const intervalRef   = useRef(null);
  const audioCtxRef   = useRef(null);
  const analyzerRef   = useRef(null);
  const maxMag        = useRef({});
  const gainRef       = useRef(0);
  const canvasRef     = useRef(null);
  const animationRef  = useRef(null);
  const noiseProfileRef = useRef(null);

  // Draw waveform helper
  const drawWaveform = analyser => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.fftSize;
    const data = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(data);
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f0';
    ctx.beginPath();
    const slice = canvas.width / bufferLength;
    let x = 0;
    data.forEach((v,i) => {
      const y = (v/128 - 1)*(canvas.height/2) + canvas.height/2;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      x += slice;
    });
    ctx.stroke();
    animationRef.current = requestAnimationFrame(() => drawWaveform(analyser));
  };

  // Reset state
  const reset = () => {
    setError(null);
    setMissing([]);
    setMags(TARGET_FREQUENCIES.map(() => 0));
    gainRef.current = 0;
    maxMag.current = {};
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  // Internal noise calibration (2s) using amplitudeSpectrum
  const calibrateNoiseInternal = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const frames = [];
    const analyzer = Meyda.createMeydaAnalyzer({
      audioContext: audioCtx,
      source,
      bufferSize: SPECTRUM_FFT_SIZE,
      featureExtractors: ['amplitudeSpectrum'],
      callback: features => {
        // store a copy of the spectrum frame
        frames.push(Array.from(features.amplitudeSpectrum));
      }
    });
    analyzer.start();
    // collect for 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    analyzer.stop();
    // average per bin
    const avg = frames[0].map((_, i) =>
      frames.reduce((sum, f) => sum + f[i], 0) / frames.length
    );
    // cleanup
    audioCtx.close();
    stream.getTracks().forEach(t => t.stop());
    return avg;
  };

  // Start recording with spectral subtraction
  const startRecording = async () => {
    reset();
    if (!noiseProfileRef.current) {
      // Calibrate ambient noise
      noiseProfileRef.current = await calibrateNoiseInternal();
    }
    setStage('recording');
    setSeconds(RECORD_DURATION_MS/COUNTDOWN_INTERVAL);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio:{ noiseSuppression:true, echoCancellation:true, autoGainControl:true }
      });
      const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // Filters
      const hp = audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=85;
      const lp = audioCtx.createBiquadFilter(); lp.type='lowpass';  lp.frequency.value=8000;
      const notch = audioCtx.createBiquadFilter(); notch.type='notch'; notch.frequency.value=60; notch.Q.value=30;
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value=-50; comp.knee.value=40; comp.ratio.value=12; comp.attack.value=0; comp.release.value=0.25;

      // Analyser
      const analyser = audioCtx.createAnalyser(); analyser.fftSize=WAVEFORM_FFT_SIZE;
      source.connect(hp).connect(lp).connect(notch).connect(comp).connect(analyser);

      drawWaveform(analyser);

      // Countdown
      intervalRef.current = setInterval(()=>{
        setSeconds(prev=> prev<=1 ? (clearInterval(intervalRef.current),0) : prev-1);
      }, COUNTDOWN_INTERVAL);

      // Meyda analyzer
      analyzerRef.current = Meyda.createMeydaAnalyzer({
        audioContext:audioCtx,
        source:comp,
        bufferSize:SPECTRUM_FFT_SIZE,
        featureExtractors:['amplitudeSpectrum', 'rms'],
        callback:features=>{
          const { amplitudeSpectrum: spec, rms } = features;
          // Gate out frames below noise floor
          if (rms < NOISE_FLOOR) {
            setMags(TARGET_FREQUENCIES.map(() => 0));
            return;
          }
          const peak = Math.max(...spec);
          gainRef.current = peak;
          const mags = TARGET_FREQUENCIES.map(freq=>{
            const bin = Math.round(freq*SPECTRUM_FFT_SIZE/audioCtx.sampleRate);
            // Spectral subtraction
            const raw = spec[bin]||0;
            const noiseVal = (noiseProfileRef.current && noiseProfileRef.current[bin]) || 0;
            const cleaned = Math.max(raw - noiseVal, 0);
            if(cleaned> (maxMag.current[freq]||0)) maxMag.current[freq]=cleaned;
            return peak>0 ? cleaned/peak : 0;
          });
          setMags(mags);
        }
      });
      analyzerRef.current.start();

      // Stop
      setTimeout(()=>{
          // Check for any voice input
          if (gainRef.current < MIN_PEAK) {
            setError('No voice detected. Please speak louder.');
            setStage('idle');
            // Stop tracks and cleanup
            stream.getTracks().forEach(t => t.stop());
            return;
          }
        analyzerRef.current.stop();
        audioCtx.close();
        cancelAnimationFrame(animationRef.current);
        clearInterval(intervalRef.current);
        const missingList = TARGET_FREQUENCIES.filter(freq=>{
          const mag = maxMag.current[freq];
          const db  = 20*Math.log10(mag/gainRef.current);
          return db<THRESHOLD_DB;
        });
        setMissing(missingList);
        setStage('done');
        stream.getTracks().forEach(t=>t.stop());
      }, RECORD_DURATION_MS);
    } catch(err) {
      console.error(err);
      setError('Recording failed');
      setStage('idle');
    }
  };

  return (
    <div className="App">
      <h1>Read Aloud</h1>
      {stage==='idle' && (
        <button onClick={startRecording}>Start 5s Recording</button>
      )}
      {error && <div className="error" style={{color:'red'}}>{error}</div>}

      {stage==='recording' && (
        <>
          <div>Recording: {secondsLeft}s</div>
          <canvas ref={canvasRef} width={600} height={100} style={{border:'1px solid #444'}}/>
          <div style={{width:'100%',height:200}}>
            <ResponsiveContainer>
              <BarChart data={TARGET_FREQUENCIES.map((f,i)=>({freq:f.toFixed(0),value:currentMags[i]}))}>
                <XAxis dataKey="freq"/>
                <YAxis domain={[0,1]}/>
                <Tooltip formatter={v=>`${Math.round(v*100)}%`}/>
                <Bar dataKey="value">
                  {TARGET_FREQUENCIES.map((_,i)=>(
                    <Cell key={i} fill={currentMags[i]*100>Math.abs(THRESHOLD_DB)?'#4caf50':'#888'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {stage==='done' && (
        <>
          {error ? (
            <div className="error" style={{ color: 'red' }}>{error}</div>
          ) : (
            <>
              <h2>Missing Tones</h2>
              {missing.length===0
                ? <p>All tones detected!</p>
                : <ul>
                    {missing.map(f => (
                      <li key={f}>{f.toFixed(2)} Hz missing <ReferencePlayer freq={f} /></li>
                    ))}
                  </ul>
              }
            </>
          )}
          <button onClick={() => { reset(); setStage('idle'); }} className="start-btn">
            Reset
          </button>
        </>
      )}
    </div>
  );
}

export default App;