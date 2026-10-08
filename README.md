# render-vast

Imagen Docker pública para renderizar composiciones de [HyperFrames](https://www.npmjs.com/package/hyperframes) con
WebGL por GPU NVIDIA en máquinas alquiladas de Vast.ai. Trae preinstalado lo que antes se instalaba en cada máquina, para
que la preparación baje de varios minutos a lo que tarda en bajar la imagen.

```
ghcr.io/futurials/render-vast
```

## Qué trae

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

## Versión vigente

| tag | digest |
|---|---|
| `hf0.8.140-chrome152.0.7977.30-node24.21.0` | pendiente del primer build |

Usala siempre por digest (`ghcr.io/futurials/render-vast@sha256:…`), no por tag: el tag se reescribe si se reconstruye.

## Cómo se reconstruye

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
```
