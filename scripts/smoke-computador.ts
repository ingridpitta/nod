import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { criarDriverDocker } from "../src/adapters/computador/docker.ts";
// NOD-170: o teto é por host e conta os computadores de verdade já ligados; o smoke não mede o teto (o teste unit do
// driver mede), então sobe o máximo para não ser recusado num host em uso.
// NOD-162: NOD_SMOKE_MEDIR=1 só mede o boot (log computador_iniciado), com UMA máquina e o teto do ambiente (padrão 3),
// para caber num host com computadores de verdade ligados: 1 frio, 1 após docker restart, NOD_SMOKE_QUENTES (padrão 5)
// parar+iniciar e, com NOD_SMOKE_STATS=1, docker stats ociosa (após 1 min) e durante uma ação.
const medir = process.env.NOD_SMOKE_MEDIR === "1";
const driver = criarDriverDocker({ NOD_COMPUTADORES: "docker", NOD_COMPUTADOR_IMAGEM: process.env.NOD_COMPUTADOR_IMAGEM, NOD_CREDENTIAL_KEY: randomBytes(32).toString("hex"), NOD_COMPUTADORES_MAX: medir ? (process.env.NOD_COMPUTADORES_MAX ?? "3") : "1000" });
const stats = (id: string, rotulo: string) => process.stdout.write(`stats ${rotulo}: ${execFileSync("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", `nod-computador-${id}`]).toString().trim()}\n`);
if (medir) {
  const id = randomUUID();
  await writeFile("/tmp/nod-computadores-smoke-ids.json", JSON.stringify([id]));
  try {
    await driver.iniciar(id);
    if (process.env.NOD_SMOKE_STATS === "1") {
      await new Promise((r) => setTimeout(r, 60_000));
      stats(id, "ociosa");
      const acao = driver.executar(id, { tipo: "navegar", url: "https://example.com" });
      await new Promise((r) => setTimeout(r, 1500));
      stats(id, "em uso");
      await acao;
    }
    execFileSync("docker", ["restart", "--time", "10", `nod-computador-${id}`], { stdio: "ignore" });
    await driver.iniciar(id);
    for (let i = 0; i < Number(process.env.NOD_SMOKE_QUENTES ?? "5"); i++) { await driver.parar(id); await driver.iniciar(id); }
  } finally {
    await driver.parar(id).catch(() => undefined);
    for (const args of [["rm", "-f", `nod-computador-${id}`, `nod-egress-${id}`], ["network", "rm", `nod-rede-${id}`], ["volume", "rm", `nod-computador-${id}-home`, `nod-computador-${id}-workspace`]]) {
      try { execFileSync("docker", args, { stdio: "ignore" }); } catch { /* recursos que o boot não chegou a criar */ }
    }
  }
  process.exit(0);
}
const ids = [randomUUID(), randomUUID()];
await writeFile("/tmp/nod-computadores-smoke-ids.json", JSON.stringify(ids));
try {
  for (const id of ids) await driver.iniciar(id);
  const id = ids[0]!;
  const executar = (a: Parameters<typeof driver.executar>[1]) => driver.executar(id,a);
  const documento = "Relatório em português 🙂\n".repeat(400);
  const criado = await executar({tipo:"gravar_texto",caminho:"relatorio.txt",texto:documento,revisao:"novo"});
  let inicio = 0;
  let reconstituido = "";
  for (;;) {
    const pagina = await executar({tipo:"ler_texto",caminho:"relatorio.txt",inicio,revisao:criado.revisao});
    assert.ok(JSON.stringify(pagina).length < 6000);
    reconstituido += pagina.texto!.conteudo;
    if (pagina.texto!.proximo === null) break;
    inicio = pagina.texto!.proximo;
  }
  assert.equal(reconstituido, documento);
  await executar({tipo:"gravar_texto",caminho:"relatorio.txt",texto:"Revisado",revisao:criado.revisao!});
  await assert.rejects(executar({tipo:"gravar_texto",caminho:"relatorio.txt",texto:"Perderia revisão",revisao:criado.revisao!}));
  assert.equal((await executar({tipo:"ler_texto",caminho:"relatorio.txt",inicio:0})).texto!.conteudo,"Revisado");
  const html = `<!doctype html><title>Computador nod</title><body style="font:24px sans-serif;padding:40px"><h1>Computador do bot</h1><p id="cookie"></p><input id="texto" autofocus oninput="document.getElementById('eco').textContent=this.value" placeholder="Digite aqui" style="font:24px sans-serif"><p id="eco"></p><input type="file"><a href="/download.txt" download>Baixar arquivo</a><button onclick="confirm('Confirmar teste?')">Diálogo</button><script>document.cookie='teste=persiste; max-age=3600';document.getElementById('cookie').textContent=document.cookie;</script></body>`;
  await executar({tipo:"gravar_arquivo",caminho:"index.html",base64:Buffer.from(html).toString("base64")});
  await executar({tipo:"gravar_arquivo",caminho:"download.txt",base64:Buffer.from("arquivo persistente").toString("base64")});
  const shell = await executar({tipo:"terminal",comando:"python3 --version; node --version; nohup python3 -m http.server 8080 --bind 127.0.0.1 > /workspace/http.log 2>&1 < /dev/null &"});
  assert.equal(shell.codigoSaida,0);
  const navegador = await executar({tipo:"navegar",url:"http://127.0.0.1:8080"});
  assert.match(navegador.tela!.texto,/teste=persiste/);
  await writeFile("/tmp/nod-computador-smoke.png",Buffer.from(navegador.tela!.imagem,"base64"));
  const observado = await executar({tipo:"observar"});
  assert.notEqual(observado.tela!.quadro,navegador.tela!.quadro);
  const digitado = await executar({tipo:"digitar",texto:"Olá, computador!",quadro:navegador.tela!.quadro});
  assert.match(digitado.tela!.texto,/Olá, computador!/);
  await assert.rejects(executar({tipo:"clicar",x:50,y:50,quadro:observado.tela!.quadro}));
  const escrito = await executar({tipo:"terminal",comando:"printf persistente > /workspace/prova.txt"});
  assert.equal(escrito.codigoSaida,0);
  await assert.rejects(driver.executar(ids[1]!,{tipo:"ler_arquivo",caminho:"prova.txt"}));
  const audio = await executar({tipo:"audio",segundos:1});
  assert.equal(Buffer.from(audio.audio!.data,"base64").subarray(0,4).toString(),"RIFF");
  const rede = await executar({tipo:"terminal",comando:"curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://169.254.169.254/"});
  assert.equal(rede.saida,"403");
  const externo = await executar({tipo:"navegar",url:"https://example.com"});
  assert.match(externo.tela!.texto,/Example Domain|documentation examples/);
  const midia = await executar({tipo:"terminal",comando:"ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=160x90:rate=10 -f lavfi -i sine=frequency=440:sample_rate=16000 -t 3 -c:v libvpx -deadline realtime -c:a libvorbis /workspace/video.webm"});
  assert.equal(midia.codigoSaida,0);
  const player = `<body><video id="v" src="/video.webm" controls loop></video><button id="b" onclick="v.paused?v.play():v.pause()">Reproduzir / pausar</button><input type="range" min="0" max="1" step="0.1" value="0.5" oninput="v.volume=this.value"><p id="estado"></p><script>v.volume=0.5;b.focus();setInterval(()=>estado.textContent=JSON.stringify({pausado:v.paused,volume:v.volume,tempo:v.currentTime}),50)</script></body>`;
  await executar({tipo:"gravar_arquivo",caminho:"player.html",base64:Buffer.from(player).toString("base64")});
  let r=await executar({tipo:"navegar",url:"http://127.0.0.1:8080/player.html"});
  r=await executar({tipo:"tecla",tecla:"Space",quadro:r.tela!.quadro});
  assert.match(r.tela!.texto,/"pausado":false/);
  const som=await executar({tipo:"audio",segundos:1});
  const wav=Buffer.from(som.audio!.data,"base64");
  assert.ok(wav.subarray(200).some(b=>b!==0),"o áudio capturado contém amostras, não apenas silêncio");
  r=await executar({tipo:"tecla",tecla:"Space",quadro:r.tela!.quadro});
  assert.match(r.tela!.texto,/"pausado":true/);
  r=await executar({tipo:"tecla",tecla:"Tab",quadro:r.tela!.quadro});
  r=await executar({tipo:"tecla",tecla:"ArrowRight",quadro:r.tela!.quadro});
  assert.match(r.tela!.texto,/"volume":0.6/);
  await executar({tipo:"gravar_arquivo",caminho:"check.html",base64:Buffer.from('<body><script>document.body.textContent=document.cookie</script></body>').toString("base64")});
  await driver.parar(id);
  await assert.rejects(executar({tipo:"observar"}));
  await driver.iniciar(id);
  const arquivo = await executar({tipo:"ler_arquivo",caminho:"prova.txt"});
  assert.equal(Buffer.from(arquivo.arquivo!.base64,"base64").toString(),"persistente");
  await executar({tipo:"terminal",comando:"nohup python3 -m http.server 8080 --bind 127.0.0.1 > /workspace/http.log 2>&1 < /dev/null &"});
  const cookie=await executar({tipo:"navegar",url:"http://127.0.0.1:8080/check.html"});
  assert.match(cookie.tela!.texto,/teste=persiste/);
  const cifrado=await executar({tipo:"terminal",comando:"python3 -c \"b=open('/home/node/cookies.enc','rb').read(); print(len(b)>28 and b'teste' not in b and b'persiste' not in b)\""});
  assert.equal(cifrado.saida!.trim(),"True");
  // NOD-170: reinício do Docker (ou do host) sem o nod desligar antes. O container volta pelo próprio Docker, com o
  // cofre trancado; a próxima ação passa por iniciar, que destranca, e acha o arquivo e o cookie de antes.
  execFileSync("docker",["restart","--time","10",`nod-computador-${id}`],{stdio:"ignore"});
  await driver.iniciar(id);
  const depois = await executar({tipo:"ler_arquivo",caminho:"prova.txt"});
  assert.equal(Buffer.from(depois.arquivo!.base64,"base64").toString(),"persistente");
  await executar({tipo:"terminal",comando:"nohup python3 -m http.server 8080 --bind 127.0.0.1 > /workspace/http.log 2>&1 < /dev/null &"});
  const cookieDepois=await executar({tipo:"navegar",url:"http://127.0.0.1:8080/check.html"});
  assert.match(cookieDepois.tela!.texto,/teste=persiste/);
  process.stdout.write("OK: dois computadores, texto paginado com revisão, navegador público/local, screenshot, quadro, terminal, vídeo (reproduzir/pausar/volume), áudio audível, persistência cifrada (também após docker restart) e bloqueio da rede privada.\n");
} finally {
  for (const id of ids) {
    await driver.parar(id).catch(()=>undefined);
    const nome=`nod-computador-${id}`;
    for (const args of [["rm","-f",nome,`nod-egress-${id}`],["network","rm",`nod-rede-${id}`],["volume","rm",`${nome}-home`,`${nome}-workspace`]]) {
      try { execFileSync("docker",args,{stdio:"ignore"}); } catch { /* definido em 2026-09-18: IDs de teste ficam em /tmp para limpar recursos cujo boot falhou. */ }
    }
  }
}
