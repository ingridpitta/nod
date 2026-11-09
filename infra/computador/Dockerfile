# definido em 2026-10-22 (NOD-93): multi-arquitetura. `npm run computador:build` (scripts/computador/build.ts) constrói
# linux/arm64 e linux/amd64 pelo buildx a partir deste mesmo arquivo; o FROM fica sem --platform para cada build pegar
# a variante da plataforma pedida (TARGETPLATFORM). Todos os pacotes abaixo existem no Debian bookworm nas duas
# arquiteturas (o chromium inclusive), e o playwright-core do package.json é JS puro, sem binário nativo.
FROM node:24.19.0-bookworm-slim
ARG TARGETARCH
LABEL org.opencontainers.image.title="nod-computador" app.nod.computador.arch="${TARGETARCH}"
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb openbox xdotool scrot xclip dbus-x11 pulseaudio ffmpeg python3 python3-venv git curl xterm fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends gnome-keyring libsecret-1-0 libsecret-tools && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/nod
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
RUN mkdir -p /workspace /home/node/.config && chown -R node:node /workspace /home/node
USER node
ENV DISPLAY=:99 HOME=/home/node HTTP_PROXY=http://egress:3128 HTTPS_PROXY=http://egress:3128 http_proxy=http://egress:3128 https_proxy=http://egress:3128 NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
CMD ["node", "runtime.mjs"]
