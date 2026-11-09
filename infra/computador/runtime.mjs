import { chromium } from 'playwright-core';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, readdir, stat, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { lerTexto, gravarTexto } from './texto.mjs';
import { codigoDaAcao, codigoDaSubida, falhaDe, primeiraLinha, PRAZO_NAVEGADOR_MS, TRAVAS_DO_PERFIL } from './falhas.mjs';
const exec = promisify(execFile);
const run = (bin,args,options={}) => exec(bin,args,{timeout:25000,maxBuffer:4*1024*1024,...options});
const filhos = [];
let chaveEstado;
// definido em 2026-09-24 (emenda da ADR-037): o socket de comando abre ANTES de tudo. Enquanto a
// máquina sobe, o ping responde {pronto:false}; se a subida para, {pronto:false, falha, detalhe} com
// código fixo — o processo fica de pé em vez de morrer e o Docker reiniciar em loop sem ninguém ver.
let pronto = false;
let falha = null;
let context = null;
let page = null;
let revision = randomBytes(32).toString('hex');
const quadros=new Map();
let dialogo=null;
let salvando = Promise.resolve();
let ocupado=false;
process.umask(0o077);
function start(bin,args) { const p=spawn(bin,args,{stdio:'ignore'});p.on('error',()=>{falha??={codigo:'nao_iniciou',detalhe:`${bin} não iniciou`};});filhos.push(p); }
const mudar = () => {revision=randomBytes(32).toString('hex');quadros.clear();};
// definido em 2026-09-18: checkpoint autenticado dos cookies evita depender do flush assíncrono do SQLite do Chromium.
async function gravarCookies() {
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',chaveEstado,iv);
  const dados=Buffer.concat([cipher.update(JSON.stringify(await context.cookies())),cipher.final()]);
  await writeFile('/home/node/cookies.enc.tmp',Buffer.concat([iv,cipher.getAuthTag(),dados]),{mode:0o600});
  await rename('/home/node/cookies.enc.tmp','/home/node/cookies.enc');
}
function guardarCookies() { const proxima=salvando.catch(()=>{}).then(gravarCookies);salvando=proxima;return proxima; }
function acompanhar(p) {
  p.on('framenavigated', f=>{if(f===p.mainFrame()) mudar();});
  p.on('close', mudar);
  p.on('download', async d=>{try {await d.saveAs('/workspace/downloads/'+path.basename(d.suggestedFilename()));} catch { /* definido em 2026-09-18: falha de download permanece observável no navegador. */ }});
  p.on('dialog', d=>{dialogo=d;mudar();});
}
async function atual() {if(page.isClosed()) page=context.pages().at(-1) ?? await context.newPage();return page;}
async function tela() {
  const p=await atual();
  await run('scrot',['-o','/tmp/tela.png']);
  const quadro=randomBytes(32).toString('hex');
  quadros.set(quadro,{revision,em:Date.now()});
  for(const [id,q] of quadros) if(Date.now()-q.em>120000 || quadros.size>256) quadros.delete(id);
  return {quadro,imagem:(await readFile('/tmp/tela.png')).toString('base64'),largura:1280,altura:800,
    url:p.url(),titulo:dialogo?'Diálogo do navegador':await p.title().catch(()=>''),dialogo:dialogo?{tipo:dialogo.type(),mensagem:dialogo.message()}:undefined,texto:dialogo?dialogo.message():(await p.locator('body').innerText({timeout:1000}).catch(()=>'')).slice(0,12000),
    abas:await Promise.all(context.pages().map(async t=>({url:t.url(),titulo:dialogo?'Navegador':await t.title().catch(()=>''),ativa:t===p})))};
}
async function arquivo(c,novo=false) {
  const absoluto=path.resolve('/workspace',c);
  if(absoluto!=='/workspace' && !absoluto.startsWith('/workspace/')) throw new Error('caminho');
  if(novo) await mkdir(path.dirname(absoluto),{recursive:true});
  const resolvido=await realpath(absoluto).catch(async e=>{if(!novo||e.code!=='ENOENT') throw e;return path.join(await realpath(path.dirname(absoluto)),path.basename(absoluto));});
  if(resolvido!=='/workspace'&&!resolvido.startsWith('/workspace/')) throw new Error('caminho');
  return resolvido;
}
function tecla(k) {
  const nomes={Control:'ctrl',Meta:'super',Enter:'Return',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Space:'space',Backspace:'BackSpace',PageUp:'Prior',PageDown:'Next'};
  return k.split('+').map(x=>nomes[x]??x).join('+');
}
async function acao(a) {
  const observado=quadros.get(a.quadro);
  if('quadro' in a && (!observado || observado.revision!==revision || Date.now()-observado.em>120000)) throw new Error('tela_alterada');
  const p=await atual();
  if(a.tipo==='arquivos') {
    const dir=await arquivo(a.caminho);
    const nomes=(await readdir(dir)).slice(0,200);
    return {arquivos:await Promise.all(nomes.map(async nome=>{const s=await stat(path.join(dir,nome));return {nome,caminho:path.relative('/workspace',path.join(dir,nome)),tamanho:s.size,diretorio:s.isDirectory()};}))};
  }
  if(a.tipo==='ler_arquivo') {const f=await arquivo(a.caminho);if((await stat(f)).size>524288) throw new Error('arquivo_grande');return {arquivo:{nome:path.basename(f),base64:(await readFile(f)).toString('base64')}};}
  if(a.tipo==='ler_texto') return lerTexto(await arquivo(a.caminho),a.inicio,a.revisao);
  if(a.tipo==='gravar_texto') return gravarTexto(await arquivo(a.caminho,true),a.texto,a.revisao);
  if(a.tipo==='gravar_arquivo') {const f=await arquivo(a.caminho,true);await writeFile(f,Buffer.from(a.base64,'base64'));return {saida:'Arquivo gravado.'};}
  if(a.tipo==='audio') {
    await run('ffmpeg',['-y','-f','pulse','-i','nod.monitor','-t',String(a.segundos),'-ac','1','-ar','16000','/tmp/audio.wav']);
    return {audio:{mimeType:'audio/wav',data:(await readFile('/tmp/audio.wav')).toString('base64')}};
  }
  if(a.tipo==='terminal') {
    mudar();
    const resultado = await new Promise(resolve=>{
      const proc=spawn('/bin/bash',['-c',a.comando],{cwd:'/workspace',env:{PATH:process.env.PATH,HOME:process.env.HOME,DISPLAY:':99',HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,http_proxy:process.env.http_proxy,https_proxy:process.env.https_proxy,NO_PROXY:'localhost,127.0.0.1',no_proxy:'localhost,127.0.0.1'},detached:true});
      proc.stdin.end();
      let saida='';let timeout=false;
      const coletar=b=>{saida=(saida+b.toString()).slice(-30000);};
      proc.stdout.on('data',coletar);proc.stderr.on('data',coletar);
      const encerrar=()=>{try{process.kill(-proc.pid,'SIGKILL');}catch{/* grupo encerrado */}};
      const timer=globalThis.setTimeout(()=>{timeout=true;encerrar();},20000);
      proc.on('error',()=>{globalThis.clearTimeout(timer);resolve({saida:'Comando indisponível.',codigoSaida:1});});
      proc.on('close',code=>{globalThis.clearTimeout(timer);resolve({saida:saida+(timeout?'\nLimite de 20 segundos atingido.':''),codigoSaida:code??124});});
    });
    return {...resultado,tela:await tela()};
  }
  switch(a.tipo) {
    case 'observar':break;
    case 'dialogo':{if(!dialogo)throw new Error('dialogo');const d=dialogo;dialogo=null;mudar();if(a.aceitar)await d.accept(a.texto);else await d.dismiss();break;}
    case 'navegar':mudar();await p.goto(a.url,{waitUntil:'domcontentloaded',timeout:20000});await p.bringToFront();break;
    case 'abas':if(a.aba!==undefined){page=context.pages()[a.aba];if(!page)throw new Error('aba');mudar();await page.bringToFront();}break;
    case 'clicar':mudar();await run('xdotool',['mousemove','--sync',String(a.x),String(a.y),'click','--repeat',String(a.vezes??1),String(a.botao??1)]);break;
    case 'arrastar':mudar();await run('xdotool',['mousemove','--sync',String(a.x),String(a.y),'mousedown','1','mousemove','--sync',String(a.destinoX),String(a.destinoY),'mouseup','1']);break;
    case 'digitar': {
      mudar();await writeFile('/tmp/entrada',a.texto,{mode:0o600});
      await run('xclip',['-selection','clipboard','/tmp/entrada']);
      await run('xdotool',['key','--clearmodifiers','ctrl+v']);await delay(150);await unlink('/tmp/entrada');await run('xclip',['-selection','clipboard','/dev/null']);break;
    }
    case 'tecla':mudar();await run('xdotool',['key','--clearmodifiers',tecla(a.tecla)]);break;
    case 'rolar':mudar();await run('xdotool',['click','--repeat',String(Math.max(1,Math.ceil(Math.abs(a.delta)/100))),a.delta<0?'4':'5']);break;
    case 'anexar':mudar();await p.locator('input[type=file]').first().setInputFiles(await arquivo(a.caminho));break;
    default:throw new Error('acao');
  }
  await delay(100);
  return {tela:await tela()};
}

await unlink('/tmp/nod-computer.sock').catch(()=>{});
const server=net.createServer({allowHalfOpen:true},socket=>{
  let corpo='';socket.setTimeout(60000,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('data',chunk=>{corpo+=chunk;if(corpo.length>1000000)socket.destroy();});
  socket.on('end',async()=>{
    let pedido;
    try{pedido=JSON.parse(corpo);}catch{socket.end(JSON.stringify({erro:'acao_falhou'}));return;}
    if(pedido?.tipo==='ping'){socket.end(JSON.stringify({resultado:{pronto,falha:falha?.codigo??null,detalhe:falha?.detalhe??null}}));return;}
    // Ainda subindo, ou parado num código: a ação não roda, e o servidor sabe por quê.
    if(!pronto){socket.end(JSON.stringify({erro:falha?.codigo??'sem_resposta'}));return;}
    if(ocupado){socket.end(JSON.stringify({erro:'ocupado'}));return;}
    ocupado=true;
    const limite=globalThis.setTimeout(()=>process.exit(1),55000);
    try{const resultado=await acao(pedido);await guardarCookies();socket.end(JSON.stringify({resultado}));}
    catch(e){socket.end(JSON.stringify({erro:codigoDaAcao(e)}));}
    finally{globalThis.clearTimeout(limite);ocupado=false;}
  });
});
server.listen('/tmp/nod-computer.sock');
process.on('SIGTERM',()=>{void guardarCookies().catch(()=>{}).then(()=>context?.close()).finally(()=>{filhos.forEach(p=>p.kill());process.exit(0);});});

/**
 * definido em 2026-10-16: parar o container deixa exit_type=Crashed no perfil e o Chromium
 * abre "Restore pages?" no próximo boot. A flag sozinha não basta nesta imagem — a Preferences
 * é que decide. JSON inválido fica como está: pior que o diálogo é perder o perfil.
 */
async function perfilSaiuLimpo() {
  const arquivo = '/home/node/profile/Default/Preferences';
  let texto;
  try { texto = await readFile(arquivo, 'utf8'); } catch { return; }
  let prefs;
  try { prefs = JSON.parse(texto); } catch { return; }
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;
  const perfil = prefs.profile && typeof prefs.profile === 'object' && !Array.isArray(prefs.profile) ? prefs.profile : (prefs.profile = {});
  if (perfil.exit_type === 'Normal' && perfil.exited_cleanly === true) return;
  perfil.exit_type = 'Normal';
  perfil.exited_cleanly = true;
  await writeFile(arquivo, JSON.stringify(prefs));
}

async function subir() {
  await mkdir('/workspace/downloads',{recursive:true});
  await mkdir('/home/node/profile',{recursive:true});
  process.env.DBUS_SESSION_BUS_ADDRESS=(await run('dbus-daemon',['--session','--fork','--print-address=1'])).stdout.trim();
  await unlink('/tmp/nod-keyring.sock').catch(()=>{});
  // definido em 2026-09-18: cofre cifrado; a senha derivada no servidor só entra por stdin/socket, nunca argv, volume ou ambiente.
  await new Promise((resolve,reject)=>{
    const segredo=net.createServer({allowHalfOpen:true},socket=>{
      let chave='';socket.on('error',()=>{});socket.setTimeout(10000,()=>socket.destroy());
      socket.on('data',b=>{chave+=b.toString();if(chave.length>128)socket.destroy();});
      socket.on('end',()=>{
        if(!/^[a-f0-9]{64}$/.test(chave)){socket.end('invalido');return;}
        chaveEstado=createHmac('sha256',Buffer.from(chave,'hex')).update('checkpoint-cookies-v1').digest();
        const p=spawn('gnome-keyring-daemon',['--unlock','--components=secrets'],{stdio:['pipe','ignore','ignore']});
        p.stdin.end(chave);chave='';p.on('error',e=>reject(falhaDe('cofre_invalido',e)));
        p.on('close',code=>{if(code!==0){socket.end('falhou');reject(falhaDe('cofre_invalido','o cofre de logins não abriu'));return;}socket.end('ok');segredo.close();resolve();});
      });
    });segredo.listen('/tmp/nod-keyring.sock');
  });
  start('Xvfb',[':99','-screen','0','1280x800x24','-nolisten','tcp']);
  await delay(500);
  // definido em 2026-10-16: sem decoração e maximizado, o recorte da tela é o navegador, não uma janela
  // no meio do cinza. Medido nesta imagem: janela 1280×760 em 0,30 deixava faixa de wallpaper.
  await writeFile('/tmp/nod-openbox.xml',`<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>yes</maximized>
    </application>
  </applications>
</openbox_config>`);
  start('openbox',['--config-file','/tmp/nod-openbox.xml']);
  await run('pulseaudio',['--start','--exit-idle-time=-1']);
  await run('pactl',['load-module','module-null-sink','sink_name=nod','sink_properties=device.description=nod']);
  await run('pactl',['set-default-sink','nod']);
  // definido em 2026-09-24 (emenda da ADR-037): um container por volume (ADR-037), então a trava do
  // perfil que sobrou é de um container que já morreu — com ela o Chromium não abre (Nina, 22/09).
  for(const nome of TRAVAS_DO_PERFIL) await unlink(path.join('/home/node/profile',nome)).catch(()=>{});
  await perfilSaiuLimpo();
  try {
    context = await chromium.launchPersistentContext('/home/node/profile',{
      executablePath:'/usr/bin/chromium',headless:false,viewport:null,acceptDownloads:true,timeout:PRAZO_NAVEGADOR_MS,
      chromiumSandbox:false,proxy:{server:'http://egress:3128',bypass:'localhost,127.0.0.1'},
      // definido em 2026-10-16: sem sandbox (cap-drop ALL) o Chromium pinta a faixa "unsupported command-line flag: --no-sandbox". --test-type tira a faixa. Medido nesta imagem: a faixa cobria o about:blank.
      // --hide-crash-restore-bubble e perfilSaiuLimpo: o container morre no meio da sessão e o Chromium abre "Restore pages?". Medido nesta imagem depois de docker stop.
      args:['--password-store=gnome-libsecret','--start-maximized','--window-size=1280,800','--window-position=0,0','--disable-dev-shm-usage','--disable-quic','--autoplay-policy=no-user-gesture-required','--test-type','--hide-crash-restore-bubble'],
    });
  } catch(e) { throw falhaDe('navegador_nao_abriu',e); }
  context.setDefaultTimeout(15000);
  try {
    const b=await readFile('/home/node/cookies.enc');
    const decipher=createDecipheriv('aes-256-gcm',chaveEstado,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));
    const cookies=JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString());
    await context.addCookies(cookies);
  } catch(e) { if(e.code!=='ENOENT') throw falhaDe('cofre_invalido','os cookies guardados não abriram'); }
  page = context.pages()[0] ?? await context.newPage();
  // A janela já existe; se o openbox não maximizou, o xdotool encosta no framebuffer. Falha aqui não derruba o boot.
  await exec('xdotool',['search','--onlyvisible','--class','Chromium','windowmove','0','0','windowsize','1280','800'],{timeout:4000}).catch(()=>{});
  context.pages().forEach(acompanhar);
  context.on('page',p=>{acompanhar(p);page=p;mudar();});
  if(falha) return;
  pronto = true;
}
try { await subir(); } catch(e) { falha={codigo:codigoDaSubida(e),detalhe:primeiraLinha(e?.message)}; }
