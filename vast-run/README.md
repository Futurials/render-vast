# vast-run

Despachador genérico de trabajos pesados (codificar video, renderizar, procesar lotes) a una máquina alquilada de
Vast.ai. Sube una carpeta, corre un comando parado en ella, baja las salidas y destruye la máquina. Usa una de las dos
imágenes de este repo, siempre fijada por digest:

| `perfil.gpu` | imagen | qué trae | arranque medido |
|---|---|---|---|
| `"no"` | CPU, `ghcr.io/futurials/render-vast@sha256:7736e548…6a91` (197 MiB) | Ubuntu 24.04, ffmpeg 6.1.1 (libx264), Node 24, Python 3 con Pillow | 96 a 98 s en frío; 30 s si la máquina ya la tiene (MOT-020) |
| `"cualquiera"` o `"requerida"` | WebGL, `ghcr.io/futurials/render-vast@sha256:4e1a7ecc…8515` (575 MiB) | CUDA, ffmpeg 6.1.1 (con `h264_nvenc`), Node 24, Python 3 con Pillow, HyperFrames y Chrome Headless Shell | 409 s con GPU, 131 s sin GPU (MOT-019) |

Un trabajo que necesita algo que sólo trae la de WebGL (Chrome, HyperFrames) sin GPU la pide con `"imagen"`.

Del arranque en frío de la de CPU, unos 60 s no son la imagen: Vast arma una capa encima que instala su SSH con
`apt-get` (por eso la imagen deja apt consistente; ver el README de la raíz).

```bash
vast-run/vast-run <carpeta>                 # corre el trabajo
vast-run/vast-run <carpeta> --solo-buscar   # muestra las ofertas que elegiría y el peor caso de gasto, sin alquilar
vast-run/vast-run <carpeta> --max-dph 0.20  # precio por hora máximo (por defecto USD 0,35)
```

Necesita en el host: la CLI `vastai`, el envoltorio `vk` (lee la clave de Vast de Bitwarden en cada llamada; por defecto
el de `motion-skills/render/vk`, se cambia con `VAST_RUN_VK`), la clave SSH registrada en Vast (`~/.ssh/id_ed25519_vast`,
se cambia con `VAST_RUN_SSH_KEY`), `systemd-run --user`, `flock` y `python3`.

## El pedido: `trabajo.json`

Va dentro de la carpeta del trabajo.

```json
{
  "comando": "python3 codificar.py libx264",
  "salidas": ["salida/capitulo.mp4", "salida/tiempos.json"],
  "perfil": { "cpu_min": 16, "ram_min_gb": 16, "gpu": "no" },
  "datos": "sinteticos",
  "tope_usd": 0.30,
  "ttl_min": 20,
  "excluir_subida": ["salida"]
}
```

| campo | qué es |
|---|---|
| `comando` | bash que corre en la máquina, parado en la copia de la carpeta (`/root/trabajo`). Corre con `set -euo pipefail`. |
| `salidas` | rutas relativas a la carpeta que se bajan al terminar bien, en el mismo lugar. Nada fuera de la carpeta. |
| `perfil.cpu_min` | núcleos efectivos mínimos de la máquina (por defecto 4). |
| `perfil.ram_min_gb` | RAM mínima en GB (por defecto 8). |
| `perfil.gpu` | `"no"`: la GPU no se usa y se elige por precio. `"cualquiera"`: hace falta una GPU NVIDIA, cualquier modelo; antes de subir se comprueba `nvidia-smi`. `"requerida"`: hace falta uno de los modelos de `perfil.gpu_modelos` (por ejemplo `["RTX 4090", "RTX 3090"]`). |
| `perfil.disco_gb` | disco de la máquina (por defecto 20). |
| `perfil.excluir_maquinas` | `machine_id` de Vast que no se alquilan (por ejemplo, una cuya GPU no abrió NVENC; el `informe.json` trae el `machine_id`). |
| `datos` | `"sinteticos"` o `"publicos"`. Cualquier otro valor se rechaza (ver abajo). |
| `tope_usd` | gasto máximo de la corrida, hasta USD 1,00 (por defecto 0,30). |
| `ttl_min` | minutos de vida máxima de la máquina desde que se pide, entre 5 y 180 (por defecto 30). |
| `excluir_subida` | rutas de la carpeta que no se suben (salidas viejas, por ejemplo). |
| `imagen` | opcional: fuerza una imagen, fijada por digest (`registro/nombre@sha256:<64 hex>`); si no, va la de CPU con `gpu: "no"` y la de WebGL con GPU. |

La máquina se elige entre las ofertas verificadas de Vast con confiabilidad ≥ 0,98, tráfico ≤ USD 0,05/GB, puerto
directo y, salvo con la imagen de CPU (que no trae CUDA), CUDA ≥ 12.4 en el driver: la más barata que cumple el perfil, y a igual precio la de más núcleos. Se prueban
hasta tres en orden, porque una oferta puede desaparecer entre la búsqueda y el alta.

## Regla de datos

`vast-run` sólo despacha trabajos que declaran `"datos": "sinteticos"` o `"datos": "publicos"`. Las máquinas de Vast son
de terceros: datos de clientes, reales o personales no salen del VPS. El rechazo ocurre al leer el pedido, antes de leer
la clave o consultar Vast, y sale con código 3. No hay bandera ni variable para saltearlo; declarar mal los datos es
responsabilidad de quien arma el pedido.

## Qué deja

- `informe.json` en la carpeta: oferta elegida, tiempos por fase (búsqueda, arranque, guardián, subida, comando, bajada,
  baja y total), segundos de máquina viva, costo estimado por tiempo y por crédito, y crédito antes y después.
  El crédito de Vast se descuenta con retraso: el costo por crédito puede quedar corto si se lee enseguida, y con dos
  corridas en paralelo mezcla el gasto de las dos (la cuenta es una). El estimado por tiempo es el de esa máquina sola.
- `vast-run-comando.log` en la carpeta: la salida del comando.
- Las salidas pedidas, si el comando terminó bien.
- El log completo de la corrida en `~/.local/state/vast-run/<etiqueta>/`.

Códigos de salida: 0 bien, 1 falla de la corrida (sin oferta, no arrancó, transferencia), 2 uso, 3 pedido rechazado,
4 el comando salió con error.

## Qué hace ante cada falla

La máquina se destruye siempre. Hay tres capas, cada una independiente de la anterior:

1. **Trampa de salida** del proceso: al terminar bien, al fallar cualquier paso y ante Ctrl-C, `TERM` o `HUP`, destruye
   la máquina por su etiqueta y reintenta hasta que `show instances` ya no la muestra.
2. **Temporizador de systemd** en el host, armado antes del alta: corre `vast-run --destruir <etiqueta>` a los
   `ttl_min + 5` minutos aunque el proceso haya muerto. Se cancela cuando la baja está confirmada.
3. **Guardián dentro de la máquina**, arrancado por `onstart`: espera hasta el plazo (`ttl_min` contados desde que se
   pidió el alta, como hora absoluta) y se borra solo contra la API de Vast con la clave por instancia que Vast inyecta
   en el contenedor (`CONTAINER_API_KEY`). Si el borrado no prospera, apaga el contenedor. Sirve aunque se caiga el host
   entero. Si al conectar el guardián no está corriendo o le falta el ID o la clave, la corrida se corta antes de subir
   nada.

| falla | qué pasa |
|---|---|
| pedido inválido o datos no permitidos | sale con 3 antes de alquilar |
| ninguna oferta cumple el perfil o el peor caso (precio × (`ttl_min` + 5 min) + tráfico) supera `tope_usd` | sale con 1 sin alquilar |
| ya hay 2 corridas en este host | espera una ranura libre (hasta 30 min) |
| ya hay 2 máquinas de `vast-run` vivas en Vast | sale con 1 sin alquilar |
| la oferta desaparece | prueba la siguiente (hasta tres) |
| la máquina no arranca en 15 min, o 5 min sin cambio de estado | destruye y sale con 1 |
| el guardián no quedó armado, o la GPU pedida no responde | destruye y sale con 1 |
| el comando sale con error | guarda el log, no baja salidas, destruye y sale con 4 |
| el comando no termina | se corta 3 minutos antes del plazo del guardián, destruye y sale con 4 |
| se corta la conexión o el proceso recibe una señal | destruye y sale con 1 o 130 |
| se cae el host | el guardián borra la máquina al plazo; el temporizador de systemd, si el host vuelve |

## Límites de esta fase

- Como máximo dos máquinas a la vez por host (ranuras con `flock` más un recuento de máquinas `vast-run-*` en Vast).
- Sin vigilante de progreso: un comando colgado vive hasta su tiempo máximo. Elegí `ttl_min` ajustado.
- La transferencia es `tar` comprimido por SSH (la imagen no trae `rsync`): sube la carpeta entera cada vez.
