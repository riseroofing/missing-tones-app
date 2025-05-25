// File: /root/missing-tones-app/frontend/src/ReferencePlayer.js
import React from 'react';

const ReferencePlayer = ({ freq, duration = 1 }) => {
  const playTone = () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();

    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);

    oscillator.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);

    oscillator.onended = () => audioCtx.close();
  };

  return (
    <button
      onClick={playTone}
      style={{
        marginLeft: '0.5rem',
        padding: '0.2rem 0.4rem',
        fontSize: '0.9rem',
        cursor: 'pointer'
      }}
      aria-label={`Play ${freq.toFixed(2)} Hz tone`}
      title={`Play ${freq.toFixed(2)} Hz`}
    >
      ▶️
    </button>
  );
};

export default ReferencePlayer;
