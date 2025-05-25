// File: /root/missing-tones-app/frontend/src/App.js

import React, { useState, useEffect, useRef } from 'react';
import Meyda from 'meyda';
import ReferencePlayer from './ReferencePlayer';
import './App.css';

// Configuration constants
const RECORD_DURATION_MS = 20_000;
const WAVEFORM_FFT_SIZE = 2048;
const SPECTRUM_FFT_SIZE = 4096;
const COUNTDOWN_INTERVAL = 1000; // 1 second

const TARGET_FREQUENCIES = [
  261.63, 277.18, 293.66, 311.13,
  329.63, 349.23, 369.99, 392.00,
  415.30, 440.00, 466.16, 493.88
];
const THRESHOLD_DB = -40; // relative to peak

function App() {
  const [stage, setStage] = useState('idle');
  const [missing, setMissing] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyzerRef = useRef(null);
  const gainRef = useRef(0);
  const maxMag = useRef({});
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // Reset state
  const reset = () => {
    maxMag.current = {};
    TARGET_FREQUENCIES.forEach(f => { maxMag.current[f] = 0; });
    gainRef.current = 0;
    setMissing([]);
    setSecondsLeft(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  // Draw waveform on canvas
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
    for (let i = 0; i < bufferLength; i++) {
      const v = data[i] / 128 - 1;
      const y = (v * canvas.height / 2) + canvas.height / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.stroke();
    animationRef.current = requestAnimationFrame(() => drawWaveform(analyser));
  };

  // Start 20s recording and analysis
  const startRecording = async () => {
    reset();
    setStage('recording');
    setSecondsLeft(RECORD_DURATION_MS / COUNTDOWN_INTERVAL);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // Waveform analyser
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = WAVEFORM_FFT_SIZE;
      source.connect(analyserNode);
      drawWaveform(analyserNode);

      // Countdown timer
      intervalRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, COUNTDOWN_INTERVAL);

      // Spectrum analyser via Meyda
      analyzerRef.current = Meyda.createMeydaAnalyzer({
        audioContext: audioCtx,
        source,
        bufferSize: SPECTRUM_FFT_SIZE,
        featureExtractors: ['amplitudeSpectrum'],
        callback: features => {
          const spec = features.amplitudeSpectrum;
          const sr = audioCtx.sampleRate;
          const peak = Math.max(...spec);
          gainRef.current = peak;

          TARGET_FREQUENCIES.forEach(freq => {
            const bin = Math.round(freq * SPECTRUM_FFT_SIZE / sr);
            const mag = spec[bin] || 0;
            if (mag > maxMag.current[freq]) maxMag.current[freq] = mag;
          });
        }
      });
      analyzerRef.current.start();

      // Stop recording after 20s
      setTimeout(() => {
        analyzerRef.current.stop();
        audioCtx.close();
        cancelAnimationFrame(animationRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        // Compute missing tones
        const missingList = TARGET_FREQUENCIES.filter(freq => {
          const mag = maxMag.current[freq];
          const db = 20 * Math.log10(mag / gainRef.current);
          return db < THRESHOLD_DB;
        });
        setMissing(missingList);
        setStage('done');
      }, RECORD_DURATION_MS);

    } catch (err) {
      console.error('Recording error:', err);
      reset();
      setStage('idle');
    }
  };

  return (
    <div className="App">
      <h1>Read Aloud</h1>
      <p>Please read the following passage:</p>
      <blockquote className="passage">
        “The quick brown fox jumps over the lazy dog.”<br />
        This sentence contains every letter of the alphabet.
      </blockquote>

      <button
        onClick={startRecording}
        className="start-btn"
        disabled={stage === 'recording'}
      >
        {stage === 'recording'
          ? `Recording (${secondsLeft}s)`
          : 'Start 20s Recording'}
      </button>

      {stage === 'recording' && (
        <canvas
          ref={canvasRef}
          width={600}
          height={100}
          style={{ border: '1px solid #444' }}
        />
      )}

      {stage === 'done' && (
        <>
          <h2>Missing Tones</h2>
          {missing.length === 0 ? (
            <p>Great job—you hit all target frequencies!</p>
          ) : (
            <ul>
              {missing.map(freq => (
                <li key={freq}>
                  {freq.toFixed(2)} Hz is missing
                  <ReferencePlayer freq={freq} />
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setStage('idle')}
            className="start-btn"
          >
            Record Again
          </button>
        </>
      )}
    </div>
  );
}

export default App;
