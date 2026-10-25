// Prueba de humo de la imagen Remotion (Dockerfile.remotion). Corre en el build y sirve de ejemplo en vast-run.
//
//   node /opt/remotion-runtime/humo.cjs <carpeta>
//
// Si <carpeta>/bundle/index.html no existe, escribe una composición mínima (30 cuadros, 1080×1920, 30 fps) en
// <carpeta>/fuente y la empaqueta en <carpeta>/bundle; si existe, usa ese bundle ya construido. Después la renderiza a
// <carpeta>/salida/humo.mp4 con renderMedia y deja los tiempos en <carpeta>/salida/tiempos.json. Sale con error si las
// versiones de Remotion no son REMOTION_VERSION o si el MP4 no tiene 30 cuadros de 1080×1920.
//
// Es CommonJS a propósito: require() respeta NODE_PATH (/opt/remotion-runtime/node_modules) desde cualquier carpeta;
// import de un .mjs no.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RUNTIME = process.env.REMOTION_RUNTIME || '/opt/remotion-runtime';
const ESPERADA = process.env.REMOTION_VERSION;
const CHROME = process.env.REMOTION_BROWSER_EXECUTABLE;
const CUADROS = 30, ANCHO = 1080, ALTO = 1920, FPS = 30;

const falla = (m) => { console.error(`humo: ${m}`); process.exit(1); };

const COMPOSICION = `import React from 'react';
import { AbsoluteFill, Composition, interpolate, registerRoot, useCurrentFrame } from 'remotion';

const Humo = () => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, ${CUADROS - 1}], [-300, 300]);
  return (
    <AbsoluteFill style={{ backgroundColor: \`hsl(\${f * 12}, 60%, 20%)\`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 360, height: 360, borderRadius: 48, background: '#f5c542', transform: \`translateX(\${x}px) rotate(\${f * 6}deg)\` }} />
      <div style={{ position: 'absolute', bottom: 240, color: 'white', fontFamily: 'Liberation Sans, sans-serif', fontSize: 96 }}>
        render-vast {f + 1}/${CUADROS}
      </div>
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Humo" component={Humo} durationInFrames={${CUADROS}} fps={${FPS}} width={${ANCHO}} height={${ALTO}} />
));
`;

async function main() {
  const dir = path.resolve(process.argv[2] || falla('uso: node humo.cjs <carpeta>'));
  if (!ESPERADA) falla('falta REMOTION_VERSION');
  if (!CHROME || !fs.existsSync(CHROME)) falla(`no está el Chrome de la imagen (REMOTION_BROWSER_EXECUTABLE=${CHROME})`);

  const versiones = Object.fromEntries(['remotion', '@remotion/renderer', '@remotion/bundler', '@remotion/cli']
    .map((p) => [p, require(`${p}/package.json`).version]));
  versiones['remotion (VERSION)'] = require('remotion').VERSION;
  for (const [p, v] of Object.entries(versiones)) {
    if (v !== ESPERADA) falla(`${p} es ${v}, se esperaba REMOTION_VERSION=${ESPERADA}`);
  }
  console.log(`humo: remotion ${ESPERADA} en los cuatro paquetes`);

  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const serveUrl = path.join(dir, 'bundle');
  const t = { bundle_s: null };

  if (!fs.existsSync(path.join(serveUrl, 'index.html'))) {
    const { bundle } = require('@remotion/bundler');
    const fuente = path.join(dir, 'fuente');
    fs.mkdirSync(fuente, { recursive: true });
    fs.writeFileSync(path.join(fuente, 'index.jsx'), COMPOSICION);
    const t0 = Date.now();
    await bundle({
      entryPoint: path.join(fuente, 'index.jsx'),
      outDir: serveUrl,
      enableCaching: false,
      // webpack no mira NODE_PATH: que resuelva remotion y react desde el runtime de la imagen
      webpackOverride: (c) => ({
        ...c,
        resolve: { ...c.resolve, modules: ['node_modules', path.join(RUNTIME, 'node_modules')] },
        resolveLoader: { ...c.resolveLoader, modules: ['node_modules', path.join(RUNTIME, 'node_modules')] },
      }),
    });
    t.bundle_s = (Date.now() - t0) / 1000;
    console.log(`humo: bundle en ${t.bundle_s} s`);
  } else {
    console.log(`humo: uso el bundle ya construido de ${serveUrl}`);
  }

  const salida = path.join(dir, 'salida');
  fs.mkdirSync(salida, { recursive: true });
  const mp4 = path.join(salida, 'humo.mp4');
  const t1 = Date.now();
  // browserExecutable explícito: sin él, Remotion busca Chrome según la carpeta actual y lo bajaría de nuevo
  const composition = await selectComposition({ serveUrl, id: 'Humo', browserExecutable: CHROME, logLevel: 'error' });
  await renderMedia({
    serveUrl, composition, codec: 'h264', outputLocation: mp4, overwrite: true,
    browserExecutable: CHROME, logLevel: 'error',
  });
  const render_s = (Date.now() - t1) / 1000;

  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', mp4], { encoding: 'utf8' })).streams[0];
  const cuadros = Number(p.nb_read_frames);
  console.log(`humo: ${mp4}: ${cuadros} cuadros de ${p.width}×${p.height}, render en ${render_s} s`);
  if (cuadros !== CUADROS || p.width !== ANCHO || p.height !== ALTO) {
    falla(`se esperaban ${CUADROS} cuadros de ${ANCHO}×${ALTO}`);
  }

  fs.writeFileSync(path.join(salida, 'tiempos.json'), JSON.stringify({
    remotion: ESPERADA,
    chrome: execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim(),
    nucleos: os.availableParallelism(),
    bundle_s: t.bundle_s,
    render_s,
    cuadros,
    resolucion: `${p.width}x${p.height}`,
  }, null, 2) + '\n');
}

main().catch((e) => falla(e && e.stack ? e.stack : String(e)));
