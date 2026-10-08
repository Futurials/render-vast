# render-vast · imagen para renderizar composiciones de HyperFrames con WebGL por GPU NVIDIA en Vast.ai.
# Trae preinstalado lo que antes se instalaba en cada máquina alquilada: paquetes del sistema, Node, HyperFrames y Chrome
# Headless Shell. No trae composiciones, código de skills, assets ni secretos: eso se sube en cada corrida.
# Cada descarga se verifica por SHA-256 y el build falla si algo no coincide.

# misma base que el setup anterior (mismo tag, fijado además por digest del índice multiplataforma)
FROM nvidia/cuda:13.4.2-base-ubuntu24.04@sha256:b395ba681833b0a9837674516abe258b2934d6ec5511f78745d71ea177da14a4

ARG NODE_VERSION=v24.21.0
ARG NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
ARG HF_VERSION=0.8.140
ARG GSAP_VERSION=3.14.2
ARG THREE_VERSION=0.181.2
# el árbol npm se resuelve como estaba publicado en esta fecha: así sale idéntico al lock con el que se validó
ARG NPM_BEFORE=2026-10-07T21:55:00Z
# sha256 de las líneas "ruta versión integridad" del package-lock, ordenadas (125 paquetes)
ARG NPM_TREE_SHA256=53b69661dd86318398a76e64bc28fc7e66e3561d9c07939d380979081d73f266
ARG CHROME_VERSION=152.0.7977.30
# sha256 del binario chrome-headless-shell (no del zip)
ARG CHROME_SHA256=6642ab58861e8dedcd195e1fe090f76dae4cff8476f971911a11781e7ec7d2da

LABEL org.opencontainers.image.source="https://github.com/Futurials/render-vast" \
      org.opencontainers.image.description="CUDA base + Node, HyperFrames y Chrome Headless Shell para render con GPU en Vast.ai" \
      org.opencontainers.image.licenses="NOASSERTION"

ENV DEBIAN_FRONTEND=noninteractive CI=true NO_COLOR=1 TERM=dumb npm_config_progress=false \
    HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 \
    HYPERFRAMES_SKIP_SKILLS=1 \
    HYPERFRAMES_BROWSER_PATH=/opt/chrome-headless-shell-linux64/chrome-headless-shell

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# paquetes del sistema: los mismos que instalaba el paso apt
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils unzip time ffmpeg python3 python3-pil \
    libegl1 libgles2 libgl1 libglvnd0 libvulkan1 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2t64 libxshmfence1 libdbus-1-3 fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version | sed -n 1p && python3 -c 'import PIL; print("pillow", PIL.__version__)' && unzip -v | sed -n 1p

# Node, tarball oficial
RUN cd /opt \
 && curl -fsS -o node.tar.xz "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  node.tar.xz" | sha256sum -c - \
 && tar xf node.tar.xz && rm node.tar.xz \
 && ln -sf "/opt/node-${NODE_VERSION}-linux-x64/bin/"* /usr/local/bin/ \
 && [ "$(node -v)" = "${NODE_VERSION}" ] && npm -v

# HyperFrames (con GSAP y Three.js, como el runtime de la skill)
RUN mkdir -p /opt/hyperframes && cd /opt/hyperframes \
 && printf '{"private":true,"dependencies":{"gsap":"%s","hyperframes":"%s","three":"%s"}}\n' \
      "${GSAP_VERSION}" "${HF_VERSION}" "${THREE_VERSION}" > package.json \
 && npm install --before="${NPM_BEFORE}" --no-audit --no-fund --no-progress --loglevel=error \
 && got="$(node -e 'const p=require("/opt/hyperframes/package-lock.json").packages;process.stdout.write(Object.keys(p).filter(k=>k).sort().map(k=>k+" "+p[k].version+" "+p[k].integrity).join("\n")+"\n")' | sha256sum | cut -d' ' -f1)" \
 && echo "árbol npm ${got}" && [ "${got}" = "${NPM_TREE_SHA256}" ] \
 && ln -sf /opt/hyperframes/node_modules/.bin/hyperframes /usr/local/bin/hyperframes \
 && npm cache clean --force \
 && v="$(hyperframes --version < /dev/null | tail -1)" && echo "hyperframes ${v}" && [ "${v}" = "${HF_VERSION}" ]

# Chrome Headless Shell de Chrome for Testing
RUN cd /opt \
 && curl -fsS -o chs.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-headless-shell-linux64.zip" \
 && unzip -q chs.zip && rm chs.zip \
 && echo "${CHROME_SHA256}  ${HYPERFRAMES_BROWSER_PATH}" | sha256sum -c - \
 && missing="$(ldd "${HYPERFRAMES_BROWSER_PATH}" | grep 'not found' || true)" && [ -z "${missing}" ] \
 && "${HYPERFRAMES_BROWSER_PATH}" --version 2>/dev/null | grep -F "${CHROME_VERSION}" \
 && p="$(hyperframes browser path < /dev/null 2>/dev/null | tail -1)" && echo "hyperframes usa ${p}" \
 && [ "${p}" = "${HYPERFRAMES_BROWSER_PATH}" ]

WORKDIR /root
