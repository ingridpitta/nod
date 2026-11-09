import type { AcaoComputador, ComputadorDto, ResultadoComputador, TelaComputador } from "../../src/contracts/computador.ts";
import type { Api } from "../lib/api.ts";
import { agruparAtividade, aoFecharATela, AVISO_CLIQUE_SO_ASSUMIU, criarCliqueQueAssume, esperaParaAssumir, estadoEmPalavras, falhaQuePassaAoAssumir, foraDoAr, htmlDialogoComputador, htmlPilula, marcarTelaFechadaNaAjuda, mensagemDoLimite, MOTIVO_FALHA_TEXTO, rotuloDaAtividade, rotuloDoEstado, rotuloDoFechar, tituloDaFalha, type FaseDaPilula, type OrigemDoAssumir } from "../lib/computador.ts";
import { dataHora, esc } from "../lib/render.ts";
import { lembrarTela } from "./tela-do-bot.ts";

/** O diálogo aberto acompanha o Modo dev sem fechar: ⌘⇧D no meio da tela mostra ou esconde as ferramentas. */
export function aplicarModoDevNoComputador(ligado: boolean): void {
  document.querySelector(".computador-dialog")?.classList.toggle("computador-dev", ligado);
}

export function abrirComputador(api: Api, agente: { id: string; nome: string }, opcoes: { assumir?: boolean; dev?: () => boolean; aoFechar?: () => void } = {}): void {
  document.querySelector<HTMLDialogElement>(".computador-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "computador-dialog";
  if (opcoes.dev?.()) dialog.classList.add("computador-dev");
  dialog.setAttribute("aria-label", `Computador de ${agente.nome}`);
  dialog.innerHTML = htmlDialogoComputador(agente.nome);
  document.body.append(dialog); dialog.showModal();
  const q = <T extends Element = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  let dto: ComputadorDto | undefined;
  let tela: TelaComputador | undefined;
  let ocupado = false;
  let operando = false;
  let configuracao: string | null = null;
  let terminou = false;
  let audioUrl: string | undefined;
  let proximaLeitura = 0;
  let fila: Promise<void> = Promise.resolve();
  let teclas = "";
  let timerTeclas: number | undefined;
  let timerClique: number | undefined;
  let timerAviso: number | undefined;
  let avisou = false;
  let fasePintada: FaseDaPilula | null = null;
  // Aberta de novo pelo cartão: enquanto a tela está aberta, o cartão não diz "Você fechou a tela".
  marcarTelaFechadaNaAjuda(agente.id, null);
  const erro = (texto: string) => { q(".computador-erro").textContent = texto; };
  const controla = () => dto?.computador.controle === "pessoa" && dto.ativo && !foraDoAr(dto);
  /**
   * definido em 2026-09-24 (emenda da ADR-037): fora do ar, a tela diz o que quebrou, desde quando e o
   * que fazer ("Tentar de novo" = ligar de novo), com os detalhes técnicos recolhidos.
   */
  function pintarForaDoAr(d: ComputadorDto) {
    const c = d.computador;
    const card = q(".computador-fora");
    const fora = foraDoAr(d);
    card.hidden = !fora;
    if (!fora) { card.innerHTML = ""; return; }
    const motivo = c.falhaMotivo ?? "sem_resposta";
    const ultima = d.atividade.find((a) => a.estado === "falhou");
    const reinicios = d.reinicios ? ` O computador reiniciou ${d.reinicios} ${d.reinicios === 1 ? "vez" : "vezes"} tentando.` : "";
    card.innerHTML = `<b>${esc(tituloDaFalha(motivo))}</b><p>Fora do ar desde ${esc(dataHora(c.indisponivelDesde ?? 0))}.${esc(reinicios)}</p><p>Enquanto isso, ${esc(agente.nome)} trabalha sem o computador: as rotinas continuam pelos acessos que tem.</p>
      <button type="button" class="bt pri" data-c="iniciar">Tentar de novo</button>
      <details class="computador-dev-only"><summary>Detalhes técnicos</summary><p class="computador-tecnico">motivo: ${esc(motivo)}<br>falhas seguidas: ${c.falhasSeguidas}${d.reinicios !== undefined && d.reinicios !== null ? `<br>reinícios: ${d.reinicios}` : ""}${ultima ? `<br>última falha: ${esc(dataHora(ultima.em))} · ${esc(rotuloDaAtividade(ultima.tipo).toLowerCase())}` : ""}</p></details>`;
    q(".computador-vazio").hidden = true;
    q<HTMLImageElement>("img").hidden = true;
  }
  function pintarEstado() {
    dialog.classList.toggle("computador-dev", Boolean(opcoes.dev?.()));
    if (!dto) return;
    const c = dto.computador;
    const fora = foraDoAr(dto);
    const pessoa = Boolean(controla());
    pintarPilula(Boolean(dto.ativo && !fora), pessoa);
    q(".computador-status").textContent = estadoEmPalavras(dto, Date.now(), configuracao);
    if (!q<HTMLImageElement>("img").getAttribute("src")) q(".computador-vazio").innerHTML = configuracao === "iniciar" ? `Abrindo a tela de ${esc(agente.nome)}.<small>O desktop deste bot está ligando.</small>` : `Um espaço de trabalho só deste bot.<small>Ligue o computador para abrir a tela.</small>`;
    q(".computador-status").classList.toggle("fora-do-ar", fora);
    q(".computador-ajuda").textContent = fora ? "Tirei o computador das próximas execuções até você religá-lo." : mensagemDoLimite(dto) ?? (c.falhasSeguidas > 0 && c.falhaMotivo ? `A última tentativa falhou: ${MOTIVO_FALHA_TEXTO[c.falhaMotivo]}.` : dto.motivo ?? c.ajuda ?? "Entre nos seus apps uma vez neste computador. Toque em Parar quando terminar.");
    q<HTMLSelectElement>("select").value = c.politica;
    pintarForaDoAr(dto);
    const barra = (cmd: string) => q<HTMLButtonElement>(`.computador-toolbar [data-c="${cmd}"]`);
    barra("iniciar").textContent = fora ? "Tentar de novo" : "Ligar computador";
    barra("iniciar").disabled = operando || !dto.disponivel || (dto.ativo && !fora);
    barra("parar").disabled = !dto.ativo && configuracao !== "iniciar";
    barra("assumir").disabled = operando || !dto.ativo || c.controle === "pessoa";
    barra("devolver").disabled = operando || !dto.ativo || c.controle === "bot";
    q<HTMLImageElement>("img").classList.toggle("controlavel", Boolean(controla()));
    // definido em 2026-09-24 (emenda da ADR-037): vizinhos iguais viram uma linha com ×N e o intervalo.
    q(".computador-atividade").innerHTML = agruparAtividade(dto.atividade).slice(0, 12).map((l) => {
      const quando = l.n > 1 ? `${dataHora(l.de)} → ${dataHora(l.ate)}` : dataHora(l.ate);
      const motivo = l.motivo ? ` · ${MOTIVO_FALHA_TEXTO[l.motivo]}` : "";
      return `<li class="atividade-${esc(l.estado)}"><b>${l.autor === "pessoa" ? "Você" : esc(agente.nome)}</b> · ${esc(rotuloDaAtividade(l.tipo))} <span class="tag ${l.estado === "falhou" ? "tag-vermelha" : "tag-cinza"}">${esc(rotuloDoEstado(l.estado))}${l.n > 1 ? ` ×${l.n}` : ""}</span><small>${esc(quando)}${esc(motivo)}</small></li>`;
    }).join("") || "<li>Nenhuma ação ainda.</li>";
  }
  /** A pílula (NOD-97): o HTML só troca quando a fase muda, para o foco do leitor de tela não pular a cada 2 s. */
  function pintarPilula(viva: boolean, pessoa: boolean) {
    const fase: FaseDaPilula = portao.assumindo() ? "assumindo" : pessoa ? "controle" : "assistindo";
    if (fase !== fasePintada) {
      // Quem acionou a pílula pelo teclado não perde o foco quando o nó é trocado: vai ao botão novo ou à tela.
      const tinhaFoco = q(".computador-pilula").contains(document.activeElement);
      q(".computador-pilula").outerHTML = htmlPilula(agente.nome, fase);
      fasePintada = fase;
      if (tinhaFoco) (dialog.querySelector<HTMLElement>(".computador-pilula button") ?? imagem).focus();
    }
    q(".computador-pilula").hidden = !viva;
    dialog.classList.toggle("computador-assistindo", viva && fase === "assistindo");
    // No controle, o ✕ avisa que fechar devolve; com o pedido de ajuda aberto, que o pedido continua (protótipo v1.1).
    const fechar = q(".computador-fechar");
    const { rotulo, dica } = rotuloDoFechar(agente.nome, viva && pessoa, dto?.computador.ajudaDecisaoId ?? null);
    fechar.setAttribute("aria-label", rotulo); fechar.title = rotulo;
    const dicaFechar = q(".computador-fechar-dica");
    dicaFechar.textContent = dica ?? "";
    dicaFechar.hidden = dica === null;
  }
  /** Uma vez por abertura: o gesto que assumiu não chegou ao site. Some sozinho; aria-live lê. */
  function avisarQueSoAssumiu() {
    if (avisou || terminou) return;
    avisou = true;
    const aviso = q(".computador-assumiu");
    aviso.textContent = AVISO_CLIQUE_SO_ASSUMIU;
    aviso.classList.add("visivel");
    timerAviso = window.setTimeout(() => { aviso.classList.remove("visivel"); aviso.textContent = ""; }, 5000);
  }
  /**
   * definido em 2026-10-22 (NOD-97): assumir pelo clique (ou pela pílula, ou pelo Abrir do cartão). A falha que passa
   * sozinha (bot no meio de uma ação, rede, 5xx) não vira erro: a pílula fica em "Assumindo…" e tenta de novo em 0,5 s,
   * 1 s, 2 s e daí a cada 4 s. Para quando assume, quando a tela fecha ou quando o computador cai (o cartão fora do ar).
   */
  async function assumirComInsistencia(origem: OrigemDoAssumir) {
    pintarEstado();
    let falhou = false;
    let assumiu = false;
    for (let n = 0; !terminou; n++) {
      try {
        await api.configurarComputador(agente.id, "assumir", origem);
        assumiu = true;
        break;
      } catch (e) {
        if (!falhaQuePassaAoAssumir(e)) { falhou = true; break; }
        await new Promise<void>((r) => window.setTimeout(r, esperaParaAssumir(n)));
        if (terminou) break;
        await atualizar().catch(() => undefined);
        if (!dto?.ativo || foraDoAr(dto) || dto.computador.controle === "pessoa") break;
      }
    }
    await atualizar().catch(() => undefined);
    portao.concluiu();
    if (terminou) {
      // A tela fechou no meio do "Assumindo…" e o assumir chegou depois: o close já passou sem controle, então aplica
      // aqui o mesmo efeito de fechar (sem isso o controle ficava com a pessoa e a máquina sem dormir).
      if (assumiu) fecharNoControle();
      return;
    }
    pintarEstado();
    if (falhou && !controla()) erro("Não foi possível assumir o controle. Atualize a tela e tente de novo.");
    if (controla()) {
      imagem.focus();
      if (origem === "clique") avisarQueSoAssumiu();
    }
  }
  const portao = criarCliqueQueAssume({
    assistindo: () => Boolean(dto?.ativo && !foraDoAr(dto) && dto.computador.controle !== "pessoa"),
    assumir: (origem) => { void assumirComInsistencia(origem); },
  });
  function resultado(r: ResultadoComputador) {
    if (terminou) return;
    if (r.tela) {
      tela = r.tela;
      q(".computador-browser-dialog").hidden = !tela.dialogo;
      q(".computador-browser-dialog p").textContent = tela.dialogo?.mensagem ?? "";
      const img = q<HTMLImageElement>("img"); img.src = `data:image/png;base64,${tela.imagem}`; img.hidden = false;
      lembrarTela(agente.id, tela.imagem);
      q(".computador-vazio").hidden = true;
      const url = q<HTMLInputElement>(".computador-url input"); if (document.activeElement !== url) url.value = tela.url;
      q(".computador-abas").innerHTML = tela.abas.map((a,i) => `<button data-aba="${i}" class="${a.ativa ? "ativa" : ""}">${esc(a.titulo || a.url || "Nova aba")}</button>`).join("");
    }
    if (r.saida !== undefined) q(".computador-saida").textContent = r.saida + (r.codigoSaida === undefined ? "" : `\nCódigo de saída: ${r.codigoSaida}`);
    if (r.arquivos) q(".computador-arquivos").innerHTML = r.arquivos.map(a => `<button data-arquivo="${esc(a.caminho)}" data-diretorio="${a.diretorio}">${a.diretorio ? "▸" : "↓"} ${esc(a.nome)} <small>${a.diretorio ? "pasta" : `${Math.ceil(a.tamanho / 1024)} KB`}</small></button>`).join("") || "<p>Pasta vazia.</p>";
    if (r.arquivo) baixar(r.arquivo.nome, r.arquivo.base64);
    if (r.audio) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob(r.audio.data, "audio/wav"));
      const audio = q<HTMLAudioElement>("audio"); audio.src = audioUrl; audio.hidden = false; void audio.play().catch(() => undefined);
    }
  }
  async function atualizar() { dto = await api.computador(agente.id); if (!terminou) pintarEstado(); }
  async function fazer(fn: () => Promise<void>, silencioso = false) {
    if (terminou || (silencioso && ocupado)) return;
    while (ocupado && !terminou) await new Promise<void>(r=>window.setTimeout(r,30));
    if (terminou) return;
    ocupado = true; operando = !silencioso; if (!silencioso) erro(""); pintarEstado();
    try { await fn(); }
    catch { if (!silencioso) erro("Não foi possível concluir. Atualize a tela antes de tentar novamente. Uma ação já iniciada pode ter ocorrido."); }
    finally { ocupado = false; operando = false; pintarEstado(); }
  }
  async function acao(a: AcaoComputador) { resultado(await api.acaoComputador(agente.id, a)); }
  async function interagir(a: AcaoComputador) {
    // Em Assistindo o portão do clique já assumiu ou descartou o gesto da imagem; o que chega aqui sem controle vem dos
    // campos do Modo dev (digitar, Enter, diálogo), que avisam em vez de perder a entrada calados.
    if (!controla()) { erro("Assuma o controle antes de interagir: clique na tela ou use Assumir controle."); return; }
    fila = fila.then(async () => {
      while (ocupado && !terminou) await new Promise<void>(r => window.setTimeout(r,30));
      if (terminou || !controla()) return;
      // definido em 2026-09-18: teclado preserva ordem e foco da pessoa; cliques mantêm o quadro visto ao clicar.
      const entrada = (a.tipo === "digitar" || a.tipo === "tecla") && tela ? { ...a, quadro: tela.quadro } : a;
      await fazer(async () => { await acao(entrada); await atualizar(); });
    });
    await fila;
  }
  function enviarTeclas() { if (timerTeclas) window.clearTimeout(timerTeclas);const texto=teclas;teclas="";if(texto&&tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro}); }
  const imagem = q<HTMLImageElement>("img");
  const ponto = (e: MouseEvent) => { const b = imagem.getBoundingClientRect(); return { x: Math.min(1279,Math.max(0,Math.floor((e.clientX-b.left)*1280/b.width))), y: Math.min(799,Math.max(0,Math.floor((e.clientY-b.top)*800/b.height))) }; };
  let inicio: { x: number; y: number } | undefined;
  // NOD-97: em Assistindo, o primeiro mousedown assume e é consumido com o mouseup do mesmo gesto; durante o
  // "Assumindo…" tudo é descartado. O próximo clique já chega ao site.
  imagem.addEventListener("mousedown", e => { e.preventDefault(); imagem.focus(); if (portao.apertar()) { inicio = undefined; return; } inicio = ponto(e); });
  imagem.addEventListener("mouseup", e => {
    if (portao.soltar()) { inicio = undefined; return; }
    if (!tela || !inicio) return;
    const fim = ponto(e); const ini = inicio; inicio = undefined;
    if (Math.abs(fim.x-ini.x)+Math.abs(fim.y-ini.y)>8) void interagir({ tipo:"arrastar",...ini,destinoX:fim.x,destinoY:fim.y,quadro:tela.quadro });
    else {
      if (timerClique) window.clearTimeout(timerClique);
      const acao: AcaoComputador = { tipo:"clicar",...fim,quadro:tela.quadro,botao:e.button===2?3:1,vezes:e.detail>=2?2:1 };
      timerClique=window.setTimeout(()=>{void interagir(acao);},e.detail>=2?0:230);
    }
  });
  imagem.addEventListener("contextmenu", e => e.preventDefault());
  imagem.addEventListener("wheel", e => {if(portao.rolar()){e.preventDefault();return;}if(!controla() || document.activeElement !== imagem)return;e.preventDefault();if(tela)void interagir({tipo:"rolar",delta:Math.max(-2000,Math.min(2000,e.deltaY)),quadro:tela.quadro});},{passive:false});
  imagem.addEventListener("keydown", e => {
    // Tab, Shift+Tab, Esc e as modificadoras sozinhas não assumem (teclaAssume). Esc fecha a tela (e devolve).
    if (portao.tecla(e)) { e.preventDefault(); return; }
    if (e.key === "Escape") return;
    if (!tela || !controla() || ["Control","Meta","Alt","Shift"].includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {teclas+=e.key;if(timerTeclas)window.clearTimeout(timerTeclas);timerTeclas=window.setTimeout(enviarTeclas,150);}
    else {
      enviarTeclas();
      const tecla = `${e.ctrlKey?"Control+":""}${e.metaKey?"Control+":""}${e.altKey?"Alt+":""}${e.shiftKey?"Shift+":""}${e.key===" "?"Space":e.key}`;
      void interagir({tipo:"tecla",tecla,quadro:tela.quadro});
    }
  });
  imagem.addEventListener("paste",e=>{e.preventDefault();enviarTeclas();const texto=e.clipboardData?.getData("text/plain");if(texto&&tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro});});
  dialog.addEventListener("click", e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button"); if (!el) return;
    const cmd = el.dataset.c;
    if (cmd === "fechar") dialog.close();
    // A pílula em Assistindo: o mesmo assumir do clique, sem gesto a engolir.
    else if (cmd === "assumir" && el.closest(".computador-pilula")) portao.botao();
    else if (cmd === "parar") { configuracao="parar";pintarEstado();void api.configurarComputador(agente.id,"parar").then(atualizar).catch(()=>erro("Não foi possível desligar o computador.")).finally(()=>{configuracao=null;pintarEstado();}); }
    else if ((cmd === "aceitar-dialogo" || cmd === "recusar-dialogo") && tela) void interagir({tipo:"dialogo",aceitar:cmd === "aceitar-dialogo",texto:q<HTMLInputElement>(".computador-browser-dialog input").value,quadro:tela.quadro});
    else if (cmd === "atualizar") void fazer(async()=>{await atualizar();if(dto?.ativo && !foraDoAr(dto))await acao({tipo:"observar"});});
    else if (cmd === "audio") void fazer(()=>acao({tipo:"audio",segundos:5}));
    else if (["enter","tab","esc"].includes(cmd??"") && tela) void interagir({tipo:"tecla",tecla:cmd==="enter"?"Enter":cmd==="tab"?"Tab":"Escape",quadro:tela.quadro});
    // Ligar e "Tentar de novo" são o mesmo iniciar. Falhou: relê o estado (o cartão diz o motivo).
    else if (cmd) void fazer(async()=>{configuracao=cmd;pintarEstado();try{await api.configurarComputador(agente.id,cmd);await atualizar();if(dto?.ativo && !foraDoAr(dto))await acao({tipo:"observar"});if(cmd==="assumir")imagem.focus();}catch(e){configuracao=null;await atualizar().catch(()=>undefined);throw e;}finally{configuracao=null;}});
    else if (el.dataset.aba) void interagir({tipo:"abas",aba:Number(el.dataset.aba)});
    else if (el.dataset.arquivo) void fazer(async()=>{if(el.dataset.diretorio==="true")q<HTMLInputElement>(".computador-pasta input").value=el.dataset.arquivo!;await acao({tipo:el.dataset.diretorio==="true"?"arquivos":"ler_arquivo",caminho:el.dataset.arquivo!});});
  });
  q<HTMLSelectElement>("select").addEventListener("change", e=>{const v=(e.target as HTMLSelectElement).value;void fazer(async()=>{await api.configurarComputador(agente.id,v);await atualizar();});});
  q<HTMLFormElement>(".computador-url").onsubmit = e=>{e.preventDefault();void interagir({tipo:"navegar",url:q<HTMLInputElement>(".computador-url input").value});};
  q<HTMLFormElement>(".computador-texto").onsubmit = e=>{e.preventDefault();const input=q<HTMLInputElement>(".computador-texto input");const texto=input.value;input.value="";if(tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro});};
  q<HTMLFormElement>(".computador-pasta").onsubmit = e=>{e.preventDefault();void fazer(()=>acao({tipo:"arquivos",caminho:q<HTMLInputElement>(".computador-pasta input").value}));};
  q<HTMLFormElement>(".computador-terminal").onsubmit = e=>{e.preventDefault();void interagir({tipo:"terminal",comando:q<HTMLTextAreaElement>("textarea").value});};
  q<HTMLInputElement>('input[type="file"]').onchange = e=>{
    const input=e.target as HTMLInputElement;const f=input.files?.[0];input.value="";if(!f)return;
    if(f.size>524288){erro("Envie arquivos de até 512 KB. Para arquivos maiores, use o navegador ou o terminal do computador.");return;}
    void f.arrayBuffer().then(b=>interagir({tipo:"gravar_arquivo",caminho:f.name,base64:btoa(Array.from(new Uint8Array(b),c=>String.fromCharCode(c)).join(""))}));
  };
  const timer = window.setInterval(()=>{
    // Fora do ar não há tela para ler: o laço de 2 s para até "Tentar de novo" (emenda da ADR-037).
    if(document.hidden || terminou || Date.now()<proximaLeitura || (dto && foraDoAr(dto))) return;
    proximaLeitura=Date.now()+2000;
    void fazer(async()=>{await atualizar();if(dto?.ativo && (dto.computador.ocupadoAte ?? 0) <= Date.now()) await acao({tipo:"observar"});},true);
  },2000);
  /**
   * definido em 2026-10-22 (NOD-97): fechar a tela no controle devolve ao bot (keepalive: a aba pode estar saindo). Com o
   * pedido de ajuda aberto, não: o bot espera a pessoa, e o cartão da conversa ganha Abrir e Terminei.
   */
  function fecharNoControle() {
    const efeito = aoFecharATela(Boolean(controla()), dto?.computador.ajudaDecisaoId ?? null);
    if (efeito === "devolver") api.devolverComputadorAoSair(agente.id);
    // Fora do close (o assumir chegou depois), o cartão da conversa ainda não repintou: repinta aqui.
    else if (efeito === "esperar") { marcarTelaFechadaNaAjuda(agente.id, dto?.computador.ajudaDecisaoId ?? null); if (terminou) opcoes.aoFechar?.(); }
  }
  const devolverAoSair = () => { if (aoFecharATela(Boolean(controla()), dto?.computador.ajudaDecisaoId ?? null) === "devolver") api.devolverComputadorAoSair(agente.id); };
  window.addEventListener("pagehide", devolverAoSair);
  dialog.addEventListener("close",()=>{
    window.removeEventListener("pagehide", devolverAoSair);
    fecharNoControle();
    if(timerAviso)window.clearTimeout(timerAviso);
    terminou=true;window.clearInterval(timer);if(timerTeclas)window.clearTimeout(timerTeclas);if(timerClique)window.clearTimeout(timerClique);teclas="";if(audioUrl)URL.revokeObjectURL(audioUrl);dialog.remove();opcoes.aoFechar?.();});
  // definido em 2026-10-16: Abrir liga o computador se estiver desligado (ou fora do ar) e, no cartão da
  // conversa, assume o controle — a pessoa entra na tela sem um passo extra de "Ligar".
  void fazer(async () => {
    await atualizar();
    if (dto?.disponivel && (!dto.ativo || foraDoAr(dto))) {
      configuracao = "iniciar";
      pintarEstado();
      try { await api.configurarComputador(agente.id, "iniciar"); }
      finally { configuracao = null; }
      await atualizar();
    }
    // O Abrir do cartão entra já no controle, pelo mesmo assumir com insistência da pílula.
    if (opcoes.assumir) portao.botao();
    if (dto?.ativo && !foraDoAr(dto)) await acao({ tipo: "observar" });
    if (controla()) imagem.focus();
  });
}
function blob(base64: string, type: string): Blob { return new Blob([Uint8Array.from(atob(base64), c=>c.charCodeAt(0))],{type}); }
function baixar(nome: string, base64: string) { const url=URL.createObjectURL(blob(base64,"application/octet-stream"));const a=document.createElement("a");a.href=url;a.download=nome;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
