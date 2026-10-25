# render-vast

Imagen Docker pública para renderizar composiciones de [HyperFrames](https://www.npmjs.com/package/hyperframes) con
WebGL por GPU NVIDIA en máquinas alquiladas de Vast.ai. Trae preinstalado lo que antes se instalaba en cada máquina, para
que la preparación baje de varios minutos a lo que tarda en bajar la imagen.

```
ghcr.io/futurials/render-vast
```

El mismo paquete tiene tres imágenes, con tags separados:

| imagen | para qué | Dockerfile | comprimida |
|---|---|---|---|
| WebGL (tags `hf…-chrome…-node…`) | render de HyperFrames con GPU (motion, `launch-video`) y trabajos de `vast-run` con GPU | [`Dockerfile`](Dockerfile) | 575 MiB |
| CPU (tags `cpu-…`) | trabajos de `vast-run` sin GPU: codificar video con libx264, procesar lotes | [`Dockerfile.cpu`](Dockerfile.cpu) | 197 MiB |
| Remotion (tags `remotion-…`) | render por CPU de bundles de Remotion ya construidos (`motion-local`) con `vast-run`; se pide con `"imagen"`, ver [`vast-run/`](vast-run/README.md#remotion) · vigente `remotion-4.0.538-node24.22.0-20a8e8a32a79`, `sha256:e2bd304442c72f9f4fff4bb4fe8e15961bd40b7c993619463cb4b570e84620f9` | [`Dockerfile.remotion`](Dockerfile.remotion) | 449 MiB |

La de CPU existe porque el arranque de la máquina se comía la ganancia de codificar en Vast: la de WebGL baja CUDA,
Chrome y HyperFrames que un trabajo de ffmpeg no usa (MOT-019: 131 s de arranque en CPU, 409 s en GPU).

## Despachar otros trabajos pesados: `vast-run/`

[`vast-run/`](vast-run/README.md) usa estas imágenes (la de CPU con `perfil.gpu: "no"`, la de WebGL con GPU) para correr cualquier trabajo pesado (codificar video, renderizar,
procesar lotes) en una máquina de Vast.ai en vez de en el VPS: sube una carpeta con su `trabajo.json`, corre el comando,
baja las salidas, deja un `informe.json` con tiempos y costo, y destruye la máquina siempre. Sólo acepta datos sintéticos
o públicos.

## Qué trae la imagen de WebGL

| componente | versión | cómo se verifica en el build |
|---|---|---|
| base | `nvidia/cuda:13.4.2-base-ubuntu24.04` (Ubuntu 24.04) | fijada por digest `sha256:b395ba68…14a4` |
| paquetes del sistema | `ffmpeg` 6.1.1, `python3` + `python3-pil`, `unzip`, `curl`, `time`, `fonts-liberation` y las bibliotecas gráficas que pide Chrome (EGL, GLES, GL, Vulkan, NSS, ATK, GBM, Pango, Cairo y otras) | el build imprime las versiones de ffmpeg, Pillow y unzip |
| Node.js | v24.21.0, tarball oficial en `/opt/node-v24.21.0-linux-x64`, enlazado en `/usr/local/bin` | SHA-256 del tarball |
| HyperFrames | 0.8.140 en `/opt/hyperframes`, con `gsap` 3.14.2 y `three` 0.181.2; `hyperframes` en `/usr/local/bin` | el árbol npm se resuelve como estaba publicado el 2026-10-07 (`npm --before`) y se compara contra una huella SHA-256 de sus 125 paquetes; además `hyperframes --version` |
| Chrome Headless Shell | 152.0.7977.30, de Chrome for Testing, en `/opt/chrome-headless-shell-linux64/` | SHA-256 del binario, `ldd` sin bibliotecas faltantes y `hyperframes browser path` tiene que devolver ese Chrome |

Variables de entorno de la imagen:

- `HYPERFRAMES_BROWSER_PATH=/opt/chrome-headless-shell-linux64/chrome-headless-shell`: HyperFrames usa este Chrome sin
  `hyperframes browser ensure`.
- `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`, `HYPERFRAMES_NO_AUTO_INSTALL=1`,
  `HYPERFRAMES_SKIP_SKILLS=1`: sin telemetría, sin chequeos de versión y sin instalaciones automáticas.
- `CI=true`, `NO_COLOR=1`, `TERM=dumb`, `npm_config_progress=false`: nada interactivo, sin spinners.

La imagen no trae composiciones, código de skills, assets ni secretos. Eso se sube en cada corrida.

La GPU para WebGL necesita que el contenedor arranque con `NVIDIA_DRIVER_CAPABILITIES=all` (la base sólo pide
`compute,utility`, y sin `graphics` no aparecen las bibliotecas EGL de NVIDIA).

## Qué trae la imagen de CPU

| componente | versión | cómo se verifica en el build |
|---|---|---|
| base | `ubuntu:24.04` (sin CUDA), la misma distribución que el VPS | fijada por digest `sha256:534baea6…eb55` |
| paquetes del sistema | `ffmpeg` 6.1.1 de apt (con libx264; el mismo que el VPS, así un video armado en Vast sale igual), `python3` + `python3-pil` 10.2.0, `curl`, `procps`, `tar`, `time` | el build exige ffmpeg 6.1.1, el codificador libx264 y una codificación de prueba (libx264 + AAC + `loudnorm`) |
| Node.js | v24.22.0 (LTS), tarball oficial en `/opt/node-v24.22.0-linux-x64`, enlazado en `/usr/local/bin` | SHA-256 del tarball |

No trae CUDA, HyperFrames, Chrome ni bibliotecas gráficas. El ffmpeg de apt arrastra el driver OpenGL de Mesa
(`libgl1-mesa-dri`, `mesa-libgallium`, `libllvm20`: 220 MB de 560) como dependencia de `libavdevice`; ffmpeg no lo
enlaza y en una máquina sin pantalla no se usa, así que el build lo saca con `dpkg --force-depends` y comprueba con `ldd`
que ni ffmpeg ni las libav quedan con bibliotecas faltantes. Sin eso la imagen pesaba 250 MiB comprimida. Como queda un
paquete con dependencias rotas a propósito, no hay que correr `apt-get install` encima de esta imagen.

## Versión vigente

| imagen | tag | digest |
|---|---|---|
| WebGL | `hf0.8.140-chrome152.0.7977.30-node24.21.0` | `sha256:4e1a7ecc11a82982acf6d9dab71184ddb96ae9d6e80ab35d5d820728a5498515` (575 MiB comprimidos) |
| CPU | `cpu-ffmpeg6.1.1-node24.22.0-a9428aab0060` | `sha256:7736e548eb1269336bf8e5d43c109654fb8b995bbebefb570baf8b53041f6a91` (197 MiB comprimidos) |

Usala siempre por digest (`ghcr.io/futurials/render-vast@sha256:…`), no por tag: el tag se reescribe si se reconstruye.

## Cómo se reconstruye

### La imagen de CPU

El workflow [`build-image-cpu.yml`](.github/workflows/build-image-cpu.yml) corre en cada PR y cada push a `main` que
toquen `Dockerfile.cpu` o el workflow, y a mano. El tag lleva las versiones y los primeros 12 caracteres del SHA-256 del
`Dockerfile.cpu`: si ese tag ya existe no reconstruye, así que cada `Dockerfile.cpu` se publica una sola vez, en el PR
que lo cambia, y el digest que ese PR fija en `vast-run` es el que queda (una reconstrucción daría otro digest). Para
cambiar una versión: editá el `ARG` (con su SHA-256), `VERSIONES` en el workflow, y después de la corrida del PR el
digest en `vast-run/vast-run` y en la tabla de arriba. La imagen de WebGL no se toca.

### La imagen de WebGL

El workflow [`build-image.yml`](.github/workflows/build-image.yml) construye y publica la imagen en GHCR con el
`GITHUB_TOKEN` del repositorio. Corre solo con cada push a `main` que toque el `Dockerfile` o el workflow, y a mano desde
Actions → build-image → Run workflow. El resumen de la corrida muestra el digest y el tamaño comprimido.

Para cambiar una versión: editá el `ARG` en el `Dockerfile` (con su SHA-256 nuevo), el `TAG` del workflow y la tabla de
arriba. Si cambia HyperFrames, hay que recalcular `NPM_BEFORE` y `NPM_TREE_SHA256`:

```bash
node -e 'const p=require(process.argv[1]).packages;process.stdout.write(Object.keys(p).filter(k=>k).sort().map(k=>k+" "+p[k].version+" "+p[k].integrity).join("\n")+"\n")' package-lock.json | sha256sum
```

Para probar el build en local, sin publicar:

```bash
docker buildx build --load -t render-vast:local .
docker buildx build --load -f Dockerfile.cpu -t render-vast-cpu:local .
```
