import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { DiscoDoMac, MotivoEsperaMac, NivelPressao, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { aberto, foraDoMac, leituraDoMac, maquinasDe, memoriaLegivel, noMac, pilulaMac, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe, textoDaEspera } from "../lib/trabalhos.ts";
import { agente } from "./trabalhos.ts";
import { linhaConfig } from "../lib/linha-config.ts";

/**
 * Seu espaço › Este Mac (definido em 2026-10-08, ADR-085; protótipo "Nod — Ritmo do Mac", prancha 3): quanto do Mac os
 * bots estão usando agora, quem está trabalhando (com a memória de cada um) e quem espera a vez, e o quanto eles podem
 * usar antes de trabalho novo em segundo plano esperar. Não há limite de bots: o limite é o Mac (ADR-083).
 */

export const USOS: readonly { id: UsoDoMac; nome: string; explicacao: string }[] = [
  { id: "pouco", nome: "Pouco", explicacao: "Trabalho novo em segundo plano espera assim que o processador ou a fila começam a apertar, ou a memória entra em alerta. Bom para quando você está numa chamada ou precisa do Mac para outra coisa pesada." },
  { id: "equilibrado", nome: "Equilibrado", explicacao: "Trabalho novo em segundo plano espera quando a memória entra em alerta. Processador cheio só deixa tudo mais lento: nada espera por ele. Volta sozinho quando o Mac aliviar." },
  { id: "livre", nome: "O quanto precisar", explicacao: "Nada espera, nem com a memória crítica. Só o disco quase sem espaço segura trabalho novo, em qualquer opção." },
];

export const NOME_MEMORIA: Record<NivelPressao, string> = { verde: "folgada", amarela: "em alerta", vermelha: "crítica" };
export const NOME_PROCESSADOR: Record<NivelPressao, string> = { verde: "folgado", amarela: "apertando", vermelha: "cheio" };
export const NOME_FILA: Record<NivelPressao, string> = { verde: "andando", amarela: "crescendo", vermelha: "engarrafada" };
/**
 * A barra da memória acompanha o nível do macOS (ele não diz a porcentagem). A do processador é o uso da CPU (ADR-091);
 * com app anterior, a carga por núcleo, como na ADR-085.
 */
const FRACAO_MEMORIA: Record<NivelPressao, number> = { verde: 0.35, amarela: 0.7, vermelha: 0.95 };

/**
 * Uma linha de medida: nome, barra e o status curto à vista; o detalhe, quando há, atrás de um clique (revisto em
 * 2026-10-09, #219: memória e disco entram com o porquê da espera — memória `marlon-design-limpo-info-escondida`).
 */
function medidor(nome: string, fracao: number | null, situacao: string, nivel: NivelPressao | null, detalhe = ""): string {
  const largura = fracao === null ? 0 : Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  const miolo = `<b>${esc(nome)}</b><span class="mac-barra nivel-${nivel ?? "sem"}" aria-hidden="true"><i style="width: ${largura}%"></i></span><span>${esc(situacao)}</span>`;
  if (!detalhe) return `<div class="mac-medidor">${miolo}</div>`;
  // Revisão do #228: `data-disclosure` — a releitura de 30 s (ADR-091) regrava a seção, e main.ts reabre o que estava aberto.
  return `<details class="mac-det" data-disclosure="mac-${esc(nome)}"><summary class="mac-medidor">${miolo}</summary><p class="mac-det-txt">${esc(detalhe)}</p></details>`;
}

/**
 * ADR-091: o porquê do processador e da fila, atrás do clique. Sem números de limite: eles moram no domínio (servidor).
 */
function detalheDoProcessador(nivel: NivelPressao, uso: number | null, usoDoMac: UsoDoMac): string {
  const quanto = uso === null ? "" : ` Os núcleos passaram ${Math.round(uso * 100)}% do tempo ocupados no último meio minuto.`;
  const espera = usoDoMac === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa.";
  if (nivel === "verde") return `O processador tem folga.${quanto}`;
  return `${nivel === "vermelha" ? "O processador está cheio." : "O processador está apertando."}${quanto}${usoDoMac === "equilibrado" ? " Deixa tudo mais lento, mas nada espera por isso: no Equilibrado, só a memória e o disco seguram trabalho novo." : nivel === "vermelha" || usoDoMac === "pouco" ? espera : ""}`;
}

function detalheDaFila(nivel: NivelPressao, carga: number | null, usoDoMac: UsoDoMac): string {
  const quantos = carga === null ? "" : ` Há ${carga.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} processos por núcleo querendo a vez.`;
  const espera = usoDoMac === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : usoDoMac === "pouco" ? " Rotinas e pedidos entre bots que ainda não começaram esperam a fila baixar; o que você pede começa." : "";
  return `Mais processos esperando a vez do que núcleos para atendê-los — quase sempre esperando o disco, mesmo com o processador folgado.${quantos}${espera}`;
}

/** "17 GB", "8,4 GB", "900 MB": o disco em números redondos (a casa decimal só abaixo de 10 GB). */
export function discoLegivel(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toLocaleString("pt-BR", { maximumFractionDigits: gb < 10 ? 1 : 0 })} GB`;
}

function detalheDaMemoria(memoria: NivelPressao, uso: UsoDoMac, totalBots: number | null): string {
  const dosBots = totalBots !== null && totalBots > 0 ? ` Os bots usam ${memoriaLegivel(totalBots)} agora.` : "";
  if (memoria === "vermelha") return `O macOS está quase sem memória e pode fechar apps.${uso === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : " Rotinas e pedidos entre bots que ainda não começaram esperam até ele liberar memória, mesmo os que já esperam há mais de 1 hora; o que você pede começa."}${dosBots}`;
  if (memoria === "amarela") return `O macOS avisou pouca memória.${uso === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa."}${dosBots}`;
  return `O macOS diz que a memória está folgada.${dosBots}`;
}

/**
 * ADR-096 §6: "cerca de 6 h", "cerca de 40 min", "menos de 10 min". O servidor só manda a estimativa abaixo de 24 h.
 */
export function tempoAteAcabar(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 10) return "menos de 10 min";
  if (min < 60) return `cerca de ${Math.round(min / 5) * 5} min`;
  return `cerca de ${Math.round(min / 60)} h`;
}

/** ADR-096 §6: o status curto do disco, com a tendência quando ela vem ("12 GB livres · acaba em cerca de 6 h"). */
export function statusDoDisco(d: DiscoDoMac): string {
  const livres = `${discoLegivel(d.livreMb)} livres`;
  return typeof d.acabaEmMs === "number" ? `${livres} · acaba em ${tempoAteAcabar(d.acabaEmMs)}` : livres;
}

/** Os limites vêm do servidor (`DiscoDoMac`): a web só mostra, quem decide é o domínio. */
function detalheDoDisco(d: DiscoDoMac): string {
  // ADR-096 §6: no ritmo das últimas horas, quando o livre chega ao limite; a limpeza já age sozinha.
  const tendencia = typeof d.acabaEmMs === "number"
    ? ` No ritmo das últimas horas, o espaço livre chega a ${discoLegivel(d.criticoMb)} em ${tempoAteAcabar(d.acabaEmMs)}. O Nod apaga sozinho o que dá quando o espaço aperta ou está para acabar: tasks encerradas, cópias paradas e caches. O que não se refaz é guardado compactado antes.`
    : "";
  const base = `${discoLegivel(d.livreMb)} livres de ${discoLegivel(d.totalMb)}.${tendencia} Com menos de ${discoLegivel(d.alertaMb)} livres, rotinas e pedidos entre bots esperam; com menos de ${discoLegivel(d.criticoMb)}, nenhuma task nova começa, em qualquer opção. As que já rodam continuam.`;
  // Revisão do #224: o número é o livre que o macOS informa aos apps (statfs); o Finder soma o espaço que o sistema libera
  // sozinho (purgável) e pode mostrar um pouco mais.
  const comoMede = " É o espaço livre que o macOS informa aos apps; pode ser um pouco menor que o do Finder.";
  return d.nivel === "verde" ? base + comoMede : `${base}${comoMede} As pastas dos bots ficam em ~/nod.`;
}

function linhaBot(estado: Estado, t: TrabalhoDto, fim: string, segurando: boolean): string {
  const bot = agente(estado, t.agenteId);
  return linhaConfig({
    titulo: bot?.nome ?? "bot",
    detalhe: `${t.titulo} · ${situacaoDe(t, [], segurando, estado.agora)}`,
    icone: `${pontoTrabalho(t, bot?.cor)}${bot ? iconeAgente(bot, "sm") : ""}`,
    ...(fim ? { quando: fim } : {}),
    classe: "mac-trabalho",
    controle: { tipo: "link", acao: "abrir-trabalho", dados: { id: t.id } },
  });
}

function grupo(titulo: string, legenda: string, linhas: string[]): string {
  if (linhas.length === 0) return "";
  return `<div class="mac-grupo"><span>${esc(titulo)} · ${linhas.length}</span><span>${esc(legenda)}</span></div><div class="lc-lista">${linhas.join("")}</div>`;
}

export function renderEsteMac(estado: Estado): string {
  const dto = estado.trabalhos;
  // Revisto em 2026-10-09 (a tela fala por máquina): Este Mac é só do Mac — a leitura dele e os trabalhos que rodam (ou
  // vão rodar) nele. A VM aparece em Máquinas.
  const mac = leituraDoMac(dto);
  const outras = (maquinasDe(dto) ?? []).filter((m) => !m.ehMac);
  const lista = (dto?.trabalhos ?? []).filter((t) => aberto(t) && noMac(t));
  const segurando = mac.motivoEspera !== null;
  const motivo: MotivoEsperaMac | null = mac.motivoEspera;
  const tudoNovo = mac.seguraTudoNovo;
  const disco = mac.disco ?? null;
  const porMemoria = (a: TrabalhoDto, b: TrabalhoDto) => (b.memoriaMb ?? 0) - (a.memoriaMb ?? 0);
  const trabalhando = lista.filter((t) => t.estado === "rodando" && t.turnoVivoId !== null).sort(porMemoria);
  const esperandoVez = lista.filter((t) => seguradoPeloMac(t, segurando));
  // ADR-086: quem espera um colega ou a hora marcada não ocupa o Mac — aparece à parte, para a pessoa ver que a espera
  // não custa nada aqui (protótipo "Nod — Ritmo do Mac", quadros 1–2).
  const fora = lista.filter((t) => foraDoMac(t));
  const memoria = mac.pressao;
  const processador = mac.processador;
  const carga = mac.cargaProcessador;
  // ADR-091: com o uso, a barra é a CPU de verdade e a fila aparece à parte, só quando aperta (design limpo).
  const usoCpu = mac.usoProcessador;
  const fila = mac.fila;
  const total = mac.memoriaBotsMb;
  const usam = trabalhando.length === 0 ? "nenhum processo dos bots agora"
    : total !== null && total > 0 ? `${trabalhando.length === 1 ? "usa" : "usam"} ${memoriaLegivel(total)} do seu Mac` : "sem leitura de memória";
  // #219: "esperando o Mac liberar memória" / "esperando espaço no disco" / "esperando o Mac aliviar".
  const esperandoO = textoDaEspera(motivo);
  const oQue = esperandoO.replace(/^esperando /, "");
  const espera = !segurando ? { titulo: "Nada esperando", legenda: "trabalho novo começa na hora" }
    : esperandoVez.length === 0 ? { titulo: "Nada esperando ainda", legenda: `trabalho novo${tudoNovo ? "" : " em segundo plano"} espera ${oQue}` }
      : { titulo: `${esperandoVez.length} ${esperandoO}`, legenda: tudoNovo ? "começam sozinhos, na ordem da fila, quando houver folga" : "começam sozinhos, um de cada vez, quando ele aliviar" };
  const resumo = `<div class="mac-agora">
      <div><b>${trabalhando.length} trabalhando</b><span>${esc(usam)}</span></div>
      <div><b>${esc(espera.titulo)}</b><span>${esc(espera.legenda)}</span></div>
    </div>`;
  const medidores = memoria === null && processador === null
    ? '<p class="mac-sem-leitura">O Mac ainda não mandou leitura. Ela chega com o app aberto e conectado.</p>'
    : medidor("Memória", memoria ? FRACAO_MEMORIA[memoria] : null, memoria ? NOME_MEMORIA[memoria] : "sem leitura", memoria, memoria ? detalheDaMemoria(memoria, estado.usoDoMac, total) : "")
      + medidor("Processador", usoCpu ?? carga, processador ? NOME_PROCESSADOR[processador] : "sem leitura (atualize o app)", processador, processador && usoCpu !== null ? detalheDoProcessador(processador, usoCpu, estado.usoDoMac) : "")
      + (fila && fila !== "verde" && carga !== null ? medidor("Fila", carga / 3, NOME_FILA[fila], fila, detalheDaFila(fila, carga, estado.usoDoMac)) : "")
      // #219: o disco ocupado na barra, o livre no status; a cor pelo nível que o servidor mandou.
      + (disco
        ? medidor("Disco", 1 - disco.livreMb / disco.totalMb, statusDoDisco(disco), disco.nivel === "verde" && typeof disco.acabaEmMs === "number" ? "amarela" : disco.nivel, detalheDoDisco(disco))
        // Revisão do #224: "atualize o app" só quando nenhum app manda o disco; o app novo que não conseguiu medir, "sem leitura".
        : medidor("Disco", null, mac.discoSuportado ? "sem leitura" : "sem leitura (atualize o app)", null));
  const grupos = grupo("Trabalhando", "os que mais usam memória primeiro", trabalhando.map((t) => linhaBot(estado, t, t.memoriaMb ? memoriaLegivel(t.memoriaMb) : tempoDe(t, estado.agora), segurando)))
    + grupo(esperandoO.charAt(0).toUpperCase() + esperandoO.slice(1), "começam sozinhos, na ordem da fila", esperandoVez.map((t) => linhaBot(estado, t, "", segurando)))
    + grupo("Fora do Mac", "esperando sem ocupar o Mac; voltam sozinhas", fora.map((t) => linhaBot(estado, t, "", segurando)));
  // NOD-367: o quanto os bots podem usar mora no "…" da máquina; aqui fica só o que roda agora.
  return `<div class="este-mac">
      ${pilulaMac(segurando, esperandoVez.length, false, motivo)}
      <div class="espaco-cartao mac-cartao">${resumo}${medidores}${grupos}</div>
      ${outras.length ? `<p class="lc-nota">O quanto os bots podem usar vale também para ${outras.length === 1 ? esc(outras[0]!.nome) : "as outras máquinas"}: cada uma segura trabalho novo pela própria leitura.</p>` : ""}
    </div>`;
}
