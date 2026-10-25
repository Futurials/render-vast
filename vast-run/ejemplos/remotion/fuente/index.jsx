import React from 'react';
import { AbsoluteFill, Composition, interpolate, registerRoot, useCurrentFrame } from 'remotion';

const Humo = () => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, 29], [-300, 300]);
  return (
    <AbsoluteFill style={{ backgroundColor: `hsl(${f * 12}, 60%, 20%)`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 360, height: 360, borderRadius: 48, background: '#f5c542', transform: `translateX(${x}px) rotate(${f * 6}deg)` }} />
      <div style={{ position: 'absolute', bottom: 240, color: 'white', fontFamily: 'Liberation Sans, sans-serif', fontSize: 96 }}>
        render-vast {f + 1}/30
      </div>
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Humo" component={Humo} durationInFrames={30} fps={30} width={1080} height={1920} />
));
