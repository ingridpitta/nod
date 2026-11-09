import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { EstaMaquina } from "../../src/contracts/desktop-esta-maquina.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConectarMaquina, Estado } from "../estado/reducer.ts";
import { rotuloDoMac } from "../lib/aparelho.ts";
import { ehCelular } from "../lib/celular.ts";
import { ICONE } from "../lib/icones.ts";
import { ICONE_CB, resumoDasTelas } from "../lib/computador-pessoa.ts";
import { botao, dataHora, esc, hora, iconeAgente } from "../lib/render.ts";
import { grupoConfig, itemMenu, linhaConfig, listaAninhada, textoNoMenu, type OpcaoSeletor, type TomStatus } from "../lib/linha-config.ts";
import type { NivelPressao } from "../../src/contracts/trabalho.ts";
import { maquinasDe, memoriaLegivel, seguradoPeloMac } from "../lib/trabalhos.ts";
import { discoLegivel, NOME_FILA, NOME_MEMORIA, NOME_PROCESSADOR, renderEsteMac, tempoAteAcabar, USOS } from "./este-mac.ts";
import { renderContasNaMaquina, type ContextoContas } from "./contas-lista.ts";
import { linhaEmSegundoPlano, renderInstalarSsh } from "./instalar-ssh.ts";
import { acoesDaFalha, avisoDaConta, criandoDaConta, fraseDaCriacao, motivoLegivel, nomeDaZona, nuvemLigada, OPCOES_SONO, REGIOES_CRIAR, rotuloEstadoNuvem, rotuloSono, TAMANHOS_CRIAR, temLinhaDeFalha, urlConsoleGoogle } from "../lib/maquina-nuvem.ts";
import type { MaquinaCriandoDto } from "../../src/contracts/provedor-nuvem.ts";
import { dialogoRemover, telaFimRemover } from "./remover-computador.ts";

/** ADR-147 (2026-11-03): o nome do sistema na lista e no pareamento; null (não conectada) segue como Mac. */
function nomeDaPlataforma(p: string | null | undefined): string {
  return p === "linux" ? "Linux" : p === "win32" ? "Windows" : "Mac";
}

/**
 * Seu espaço › Máquinas (ADR-090; protótipo "Nod — Motor na VM", pranchas 1 e 2): as máquinas da pessoa (o Mac e as VMs
 * em que o motor roda), o que cada uma anunciou, onde cada bot trabalha e o "Conectar uma máquina" por código. A janela
 * continua no Mac ou no navegador; a máquina escolhida roda o Claude Code ou o Codex do bot.
 */

const NOME_IA: Record<string, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };

function nomePlataforma(m: MaquinaDto, ob = false): string {
  // ADA-245: com o texto do onboarding, o status já diz "Offline"; a plataforma conhecida segue (null = sem plataforma).
  if (ob) return m.plataforma ? `${nomeDaPlataforma(m.plataforma)}${soComputador(m) ? " · só computador" : ""}` : "";
  if (!m.conectada) return "não conectada agora";
  return `${nomeDaPlataforma(m.plataforma)}${soComputador(m) ? " · só computador" : ""}`;
}

/** NOD-94: a máquina "só computador" hospeda o computador dos bots e não pega trabalho (não entra nos seletores). */
export const soComputador = (m: Pick<MaquinaDto, "papel">): boolean => m.papel === "computador";
/** As máquinas onde um bot pode trabalhar (sem as só-computador). */
export const maquinasDeTrabalho = <T extends Pick<MaquinaDto, "papel">>(lista: readonly T[]): T[] => lista.filter((m) => !soComputador(m));

/** NOD-94: tirar o computador de uma só-computador (o nod não guarda o acesso SSH: a pessoa roda lá). */
export const COMANDO_DESLIGAR_COMPUTADOR = "sudo systemctl disable --now nod-motor";

/**
 * A máquina de um bot: a dele, senão o padrão da pessoa; null = qualquer uma (com o servidor no Mac, ADR-092: este Mac).
 * Só conta chave que ainda existe.
 */
export function maquinaDoBot(estado: Pick<Estado, "maquinas">, bot: Pick<Agente, "maquinaId">): MaquinaDto | null {
  const lista = maquinasDeTrabalho(estado.maquinas?.maquinas ?? []);
  return lista.find((m) => m.id === bot.maquinaId) ?? lista.find((m) => m.id === estado.maquinas?.padraoId) ?? null;
}

/**
 * ADA-243: o resultado da ponte `estaMaquina`, conferido (a página não confia no formato). Espelha `estaMaquinaDe` de
 * src/domain/esta-maquina.ts (a web não importa o domínio como valor, ADR-018).
 */
export function lerEstaMaquina(v: unknown): EstaMaquina | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.nome !== "string" || typeof o.plataforma !== "string") return null;
  const id = o.id.trim();
  if (!id) return null;
  const plataforma = o.plataforma === "win32" || o.plataforma === "linux" ? o.plataforma : "darwin";
  return { id, nome: o.nome.trim().slice(0, 120) || "este computador", plataforma };
}

/**
 * ADA-243 (definido em 2026-11-07): a IA do bot agora, POR MÁQUINA (antes a barra olhava a máquina que respondeu primeiro e
 * dizia "Disponível" com o Windows novo sem IA). O bot com máquina (a dele ou a padrão) olha ESSA; o "qualquer uma" olha
 * esta máquina (a da ponte). Sem saber qual é esta máquina (web pura) e sem padrão, não há aviso: null.
 */
export type IaDoBotAgora =
  | { tipo: "pronta" }
  | { tipo: "sem_ia_aqui" }
  | { tipo: "maquina_desligada"; nome: string }
  | { tipo: "sem_ia_na_maquina"; nome: string };

export function iaDoBotAgora(estado: Pick<Estado, "maquinas" | "estaMaquina">, bot: Pick<Agente, "maquinaId">): IaDoBotAgora | null {
  const pronta = (m: MaquinaDto): boolean => Object.values(m.ias).includes("pronto");
  const doBot = maquinaDoBot(estado, bot);
  if (doBot) {
    if (!doBot.conectada) return { tipo: "maquina_desligada", nome: doBot.nome };
    if (pronta(doBot)) return { tipo: "pronta" };
    return doBot.id === estado.estaMaquina?.id ? { tipo: "sem_ia_aqui" } : { tipo: "sem_ia_na_maquina", nome: doBot.nome };
  }
  const aqui = estado.estaMaquina ? (estado.maquinas?.maquinas ?? []).find((m) => m.id === estado.estaMaquina?.id) : undefined;
  if (!aqui || !aqui.conectada) return null;
  return pronta(aqui) ? { tipo: "pronta" } : { tipo: "sem_ia_aqui" };
}

/** A linha curta do cabeçalho do bot para cada caso (null = segue o rótulo de antes, "Disponível"). */
export function presencaPorMaquina(ia: IaDoBotAgora | null): string | null {
  if (!ia || ia.tipo === "pronta") return null;
  if (ia.tipo === "sem_ia_aqui") return "Sem IA neste computador";
  if (ia.tipo === "maquina_desligada") return `Trabalha no ${ia.nome}, que está desligado`;
  return `Sem IA no ${ia.nome}`;
}

/** Os bots da pessoa (só a dona escolhe onde o bot trabalha), sem os excluídos. */
export function botsDaPessoa(estado: Estado): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && !a.excluidoEm);
}

/** ADA-245: o nome da IA no texto do onboarding (o protótipo da jornada D: "o Claude ou o ChatGPT"). */
const NOME_IA_ONBOARDING: Record<string, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };

/**
 * ADA-245 (D1): "Claude conectado como ana@…" — as contas prontas neste computador (com o e-mail que a conta anunciou);
 * sem a lista de contas, as IAs prontas que ele anunciou. Nada pronto: "nenhuma IA conectada".
 */
export function iaConectadaEmTexto(estado: Pick<Estado, "contasIa">, m: MaquinaDto): string {
  const contas = estado.contasIa?.disponivel ? estado.contasIa.contas.filter((c) => c.maquinas.some((v) => v.maquinaId === m.id && v.estado === "pronta")) : [];
  const porIa = new Map<string, string | null>();
  for (const c of contas) if (!porIa.has(c.ia) || (!porIa.get(c.ia) && c.email)) porIa.set(c.ia, c.email);
  if (porIa.size === 0) for (const [ia, est] of Object.entries(m.ias)) if (est === "pronto") porIa.set(ia, null);
  if (porIa.size === 0) return "nenhuma IA conectada";
  return [...porIa].map(([ia, email]) => `${NOME_IA_ONBOARDING[ia] ?? ia} conectado${email ? ` como ${email}` : ""}`).join(" · ");
}

/** As IAs que a máquina anunciou, em texto (sem a lista de contas do ADR-102). */
function iasEmTexto(m: MaquinaDto): string {
  const ias = Object.entries(m.ias).map(([id, est]) => `${NOME_IA[id] ?? id} ${est === "pronto" ? "pronto" : est === "nao_autenticado" ? "sem login" : "ausente"}`);
  if (m.gh) ias.push("GitHub");
  return ias.join(" · ");
}

export type LeituraDaMaquina = { curto: string; nivel: NivelPressao; status: { texto: string; tom: TomStatus }; texto: string };

/**
 * A leitura da máquina (definido em 2026-10-09, a tela fala por máquina): o status curto vai para a linha (o ponto e o
 * texto) e os números para o "…" (NOD-367: "Agora: memória … · processador … · disco … · os bots usam …"). Sem leitura
 * dela (motor anterior, ou sem contato), null.
 */
export function leituraDaMaquina(estado: Pick<Estado, "trabalhos">, id: string): LeituraDaMaquina | null {
  const l = maquinasDe(estado.trabalhos)?.find((x) => x.id === id);
  if (!l) return null;
  const esperam = (estado.trabalhos?.trabalhos ?? []).filter((t) => seguradoPeloMac(t, false) && t.maquina?.id === id).length;
  const oQue = l.motivoEspera === "disco" ? "espaço no disco" : l.motivoEspera === "memoria" ? "ela liberar memória" : "ela aliviar";
  // ADR-096 §6: o disco que acaba em menos de 24 h aparece antes de os bots pararem.
  const acaba = typeof l.disco?.acabaEmMs === "number" ? l.disco.acabaEmMs : null;
  const curto = l.motivoEspera === null ? (acaba !== null ? `Disco acaba em ${tempoAteAcabar(acaba)} no ritmo atual` : "Trabalho novo começa na hora")
    : `${l.motivoEspera === "disco" ? "Pouco espaço no disco" : l.motivoEspera === "memoria" ? "Pouca memória" : "Ocupada"} · ${esperam > 0 ? `${esperam} ${esperam === 1 ? "trabalho espera" : "trabalhos esperam"}` : "trabalho novo espera"} ${oQue}`;
  const nivel: NivelPressao = l.motivoEspera === null ? (acaba !== null ? "amarela" : "verde") : l.seguraTudoNovo || l.pressao === "vermelha" ? "vermelha" : "amarela";
  const status = l.motivoEspera === "memoria" ? { texto: l.pressao === "vermelha" ? "Memória crítica" : "Memória em alerta", tom: nivel === "vermelha" ? "erro" as const : "atencao" as const }
    : l.motivoEspera === "disco" ? { texto: "Pouco espaço no disco", tom: nivel === "vermelha" ? "erro" as const : "atencao" as const }
      : l.motivoEspera === "processador" ? { texto: "Ocupada", tom: "atencao" as const }
        : acaba !== null ? { texto: "Disco acabando", tom: "atencao" as const }
          : { texto: "Conectada", tom: "ok" as const };
  const numeros = [
    `memória ${NOME_MEMORIA[l.pressao]}`,
    l.processador ? `processador ${NOME_PROCESSADOR[l.processador]}${l.usoProcessador !== null ? ` (${Math.round(l.usoProcessador * 100)}% do tempo ocupado)` : ""}` : "processador sem leitura",
    l.fila && l.fila !== "verde" && l.cargaProcessador !== null ? `fila ${NOME_FILA[l.fila]} (${l.cargaProcessador.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} processos por núcleo)` : "",
    l.disco ? `disco com ${discoLegivel(l.disco.livreMb)} livres de ${discoLegivel(l.disco.totalMb)}${acaba !== null ? ` (no ritmo atual, acaba em ${tempoAteAcabar(acaba)}; o Nod limpa o que dá)` : ""}` : "disco sem leitura",
    l.memoriaBotsMb > 0 ? `os bots usam ${memoriaLegivel(l.memoriaBotsMb)}` : "",
  ].filter(Boolean).join(" · ");
  const porque = l.motivoEspera === null ? ""
    : l.seguraTudoNovo ? " Com o disco quase sem espaço, nenhuma task nova começa nela; as que já rodam continuam."
      : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa.";
  return { curto, nivel, status, texto: `Agora: ${numeros}.${porque}` };
}

/** A leitura no "…" da máquina: o status curto e os números. Sem leitura, nada. */
export function leituraNoCartao(estado: Pick<Estado, "trabalhos">, id: string): string {
  const l = leituraDaMaquina(estado, id);
  return l ? textoNoMenu(`<span class="maq-nivel nivel-${l.nivel}" aria-hidden="true"></span>${esc(l.curto)}. ${esc(l.texto)}`, `leitura-${id}`) : "";
}

/** O quanto os bots podem usar (ADR-085): um valor só, no "…" de uma máquina só (NOD-373: o Mac; sem Mac, a padrão). */
export function itensDoUso(estado: Estado): string {
  const radios = USOS.map((u) => itemMenu("uso-do-mac", "", u.nome, { papel: "menuitemradio", marcado: u.id === estado.usoDoMac, dados: { uso: u.id }, nota: u.explicacao })).join("");
  const nota = estado.onboardingTexto ? "Um valor só, o de hoje: vale para todos os computadores. Cada um segura trabalho novo pela própria leitura." : "Um valor só, o de hoje: vale para todas as máquinas. Cada uma segura trabalho novo pela própria leitura.";
  return `<div role="group" aria-labelledby="uso-tit"><span class="cl-menu-tit" id="uso-tit">Quanto os bots podem usar</span>${radios}</div>${textoNoMenu(nota, "uso-nota")}`;
}

/** A máquina que tem o controle do uso (NOD-373): o id e o nome que aparece na lista. */
export type DonoDoUso = { id: string; nome: string };

/**
 * NOD-373: o controle "Quanto os bots podem usar" é um valor global e fica num "…" só — o do Mac; sem Mac, o da máquina
 * padrão (ou, se ela não for de trabalho, a primeira de trabalho). null = nenhuma máquina para guardá-lo.
 */
export function donoDoUso(todas: readonly MaquinaDto[], idsDoMac: ReadonlySet<string>, macSemChave: DonoDoUso | null, padraoId: string | null): DonoDoUso | null {
  if (macSemChave) return macSemChave;
  const mac = todas.find((m) => idsDoMac.has(m.id) && !soComputador(m));
  if (mac) return { id: mac.id, nome: mac.nome };
  const trabalho = maquinasDeTrabalho(todas);
  const padrao = trabalho.find((m) => m.id === padraoId) ?? trabalho[0];
  return padrao ? { id: padrao.id, nome: padrao.nome } : null;
}

/** O uso no "…": o controle na máquina dona; nas outras de trabalho, só a linha que diz onde ele fica. */
function usoNoMenu(estado: Estado, m: MaquinaDto, usoEm: DonoDoUso | null): string {
  if (soComputador(m) || !usoEm) return "";
  if (usoEm.id === m.id) return `${itensDoUso(estado)}<hr>`;
  return textoNoMenu(`O limite de uso fica no “…” ${estado.onboardingTexto ? "do computador" : "da máquina"} ${esc(usoEm.nome)}.`, `uso-onde-${m.id}`);
}

/** ADR-102 (G2-M3) + NOD-367: o "…" da máquina — a leitura, o uso, renomear, contas, bots, a chave e desconectar. */
function itensDaMaquina(estado: Estado, m: MaquinaDto, usoEm: DonoDoUso | null, ehEsteMac: boolean): string {
  const bots = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id).map((b) => b.nome);
  const chave = (estado.chaves ?? []).find((c) => c.id === m.id && !c.revogadaEm);
  const contas = estado.contasIa?.disponivel ? "" : iasEmTexto(m);
  if (estado.onboardingTexto) return itensDoComputador(estado, m, usoEm, ehEsteMac, bots, contas);
  return [
    m.conectada ? leituraNoCartao(estado, m.id) : "",
    contas ? textoNoMenu(esc(contas), `contas-${m.id}`) : "",
    usoNoMenu(estado, m, usoEm),
    ehEsteMac ? itemMenu("maq-abrir", ICONE.monitor, "O que roda agora", { dados: { recolhe: "mac-agora" }, nota: "memória, processador, disco e quem está trabalhando" }) : "",
    itemMenu("maq-renomear", ICONE.lapis, "Renomear máquina", { dados: { maquina: m.id } }),
    estado.contasIa?.disponivel && !soComputador(m) ? itemMenu("cl-gerenciar", ICONE.info, "Gerenciar contas", { dados: { maquina: m.id }, nota: estado.contasIa ? textoDasContas(estado, m) : "" }) : "",
    soComputador(m) ? "" : itemMenu("maq-bots", ICONE.agentes, "Bots desta máquina", { dados: { maquina: m.id }, nota: bots.length === 0 ? "nenhum bot trabalha só aqui" : `${bots.length} ${bots.length === 1 ? "bot" : "bots"}: ${bots.join(", ")}` }),
    podeDormirPeloGoogle(estado, m) ? itemMenu("nuvem-conectar-abrir", ICONE.servidor, "Dormir e acordar pelo Google", { dados: { maquina: m.id }, nota: "ela dorme parada e acorda quando chega trabalho" }) : "",
    itemMenu("maq-abrir", ICONE.cadeado, "Detalhes da chave", { dados: { recolhe: `chave-${m.id}` } }),
    "<hr>",
    m.nuvem?.criadaPeloNod ? itemMenu("nuvem-excluir", ICONE.lixo, "Excluir máquina", { perigo: true, dados: { id: m.id, nome: m.nome }, nota: "apaga a VM na sua conta Google" }) : "",
    itemMenu("maq-desconectar", ICONE.sair, "Desconectar máquina", { perigo: true, dados: { maquina: m.id }, nota: "a chave é cancelada e os bots dela voltam para a padrão" }),
    chave ? itemMenu("revogar-chave", ICONE.lixo, "Revogar chave", { perigo: true, dados: { id: chave.id, nome: chave.nome, maquina: m.id }, nota: m.plataforma === "darwin" ? "o Mac para de trabalhar pela sua conta" : "a máquina para de trabalhar pela sua conta" }) : "",
  ].join("");
}

/**
 * ADA-245 (D1/D2, prancha D1): o "…" com o texto do onboarding — sem "Ver a chave" nem "Revogar chave" (ficam nos
 * Detalhes), com "Tornar padrão" e "Remover o nod deste computador" no lugar de "Desconectar máquina". O computador só
 * para o computador dos bots não roda bots: segue com o desconectar de antes, renomeado.
 */
function itensDoComputador(estado: Estado, m: MaquinaDto, usoEm: DonoDoUso | null, ehEsteMac: boolean, bots: string[], contas: string): string {
  const padrao = estado.maquinas?.padraoId === m.id;
  return [
    m.conectada ? leituraNoCartao(estado, m.id) : "",
    contas ? textoNoMenu(esc(contas), `contas-${m.id}`) : "",
    usoNoMenu(estado, m, usoEm),
    ehEsteMac ? itemMenu("maq-abrir", ICONE.monitor, "O que roda agora", { dados: { recolhe: "mac-agora" }, nota: "memória, processador, disco e quem está trabalhando" }) : "",
    itemMenu("maq-renomear", ICONE.lapis, "Renomear", { dados: { maquina: m.id } }),
    soComputador(m) || padrao ? "" : itemMenu("maq-tornar-padrao", ICONE.servidor, "Tornar padrão", { dados: { maquina: m.id }, nota: "bot sem computador escolhido trabalha nele" }),
    estado.contasIa?.disponivel && !soComputador(m) ? itemMenu("cl-gerenciar", ICONE.info, "Gerenciar contas", { dados: { maquina: m.id }, nota: estado.contasIa ? textoDasContas(estado, m) : "" }) : "",
    soComputador(m) ? "" : itemMenu("maq-bots", ICONE.agentes, "Bots deste computador", { dados: { maquina: m.id }, nota: bots.length === 0 ? "nenhum bot trabalha só aqui" : `${bots.length} ${bots.length === 1 ? "bot" : "bots"}: ${bots.join(", ")}` }),
    podeDormirPeloGoogle(estado, m) ? itemMenu("nuvem-conectar-abrir", ICONE.servidor, "Dormir e acordar pelo Google", { dados: { maquina: m.id }, nota: "ele dorme parado e acorda quando chega trabalho" }) : "",
    itemMenu("maq-abrir", ICONE.info, "Detalhes", { dados: { recolhe: `chave-${m.id}` } }),
    "<hr>",
    m.nuvem?.criadaPeloNod ? itemMenu("nuvem-excluir", ICONE.lixo, "Excluir na nuvem", { perigo: true, dados: { id: m.id, nome: m.nome }, nota: "apaga a VM na sua conta Google" }) : "",
    soComputador(m)
      ? itemMenu("maq-desconectar", ICONE.sair, "Desconectar", { perigo: true, dados: { maquina: m.id }, nota: "ele sai da sua conta" })
      : itemMenu("rm-abrir", ICONE.sair, "Remover o nod deste computador", { perigo: true, dados: { maquina: m.id } }),
  ].join("");
}

function textoDasContas(estado: Estado, m: MaquinaDto): string {
  const contas = estado.contasIa?.contas ?? [];
  const aqui = contas.filter((c) => c.maquinas.some((v) => v.maquinaId === m.id && v.estado === "pronta")).length;
  return aqui === 0 ? "nenhuma conta de IA aqui ainda" : `${aqui} ${aqui === 1 ? "conta" : "contas"} de IA aqui · abre Provedores de IA`;
}

/**
 * ADR-121 (NOD-92): o ⋯ da VM sem `nuvem` oferece "Dormir e acordar pelo Google" — só com a flag ligada (a conta da nuvem
 * respondeu, ou alguma máquina já tem `nuvem`) e nunca no Mac.
 */
function podeDormirPeloGoogle(estado: Estado, m: MaquinaDto): boolean {
  return !m.nuvem && m.plataforma !== "darwin" && nuvemLigada(estado.nuvem, estado.maquinas?.maquinas ?? []);
}

/** O nome da instância do Google tem de começar por letra minúscula (o form vem com o nome da máquina quando serve). */
const NOME_INSTANCIA = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/** ADR-121 (NOD-92): o formulário do "Dormir e acordar pelo Google" no cartão; o envio leva ao Google (POST nuvem/google). */
function formConectarNuvem(estado: Estado, m: MaquinaDto): string {
  const c = estado.nuvem.conectar;
  if (!c || c.maquinaId !== m.id) return "";
  const campo = (nome: "projeto" | "zona" | "nome", rotulo: string, valor: string, dica: string, foco = false) =>
    `<label class="nv-campo"><span>${esc(rotulo)}</span><input name="${nome}" type="text" value="${esc(valor)}" autocomplete="off" spellcheck="false" maxlength="63" placeholder="${esc(dica)}" data-nuvem-campo="${nome}" data-manter-foco="nuvem-${nome}"${foco ? " data-cl-autofoco" : ""} required></label>`;
  return `<form class="nv-conectar" data-form="nuvem-conectar" data-maquina="${esc(m.id)}" aria-label="Dormir e acordar pelo Google">
      <p class="cx-nota">Onde a ${esc(m.nome)} está no Google Cloud. O Google vai pedir permissão; o nod só liga e desliga esta máquina, nunca a apaga.</p>
      ${campo("projeto", "Projeto", c.projeto, "meu-projeto", true)}
      ${campo("zona", "Zona", c.zona, "southamerica-east1-a")}
      ${campo("nome", "Nome da instância", c.nome, "minha-vm")}
      ${c.erro ? `<p class="cx-erro" role="alert">${esc(c.erro)}</p>` : ""}
      <div class="cx-rodape"><button type="button" class="bt link" data-act="nuvem-conectar-fechar">Cancelar</button><button type="submit" class="bt pri">Entrar com o Google</button></div>
    </form>`;
}

/** O valor inicial do campo "Nome da instância": o nome da máquina, quando é um nome válido no Google. */
export function nomeDeInstanciaSugerido(m: Pick<MaquinaDto, "nome">): string {
  return NOME_INSTANCIA.test(m.nome) ? m.nome : "";
}

/**
 * ADR-121 (NOD-92): o que a nuvem põe no cartão — a linha de falha com o motivo e a ação, a recusa do último "Dormir
 * agora" e a linha do sono (Dorme depois de N · Dormir agora). Sem `nuvem`, nada.
 */
export function nuvemNoCartao(estado: Estado, m: MaquinaDto): string {
  const n = m.nuvem;
  if (!n) return "";
  const id = esc(m.id);
  const projeto = projetoDaConta(estado);
  const falha = temLinhaDeFalha(n)
    ? `<div class="nv-falha" role="status"><p>${esc(motivoLegivel(n.motivo, m.nome, n.zona))}</p><div class="nv-acoes">${acoesDaFalha(n.motivo).map((a) =>
      a.tipo === "console" ? `<a class="bt link" href="${esc(urlConsoleGoogle(projeto))}" target="_blank" rel="noopener noreferrer">${esc(a.rotulo)}</a>`
        : a.tipo === "reconectar" ? `<button type="button" class="bt link" data-act="nuvem-reconectar">${esc(a.rotulo)}</button>`
          : `<button type="button" class="bt link" data-act="nuvem-acordar" data-maquina="${id}">${esc(a.rotulo)}</button>`).join("")}</div></div>`
    : "";
  const recusa = estado.nuvem.recusa?.maquinaId === m.id ? `<p class="cx-erro" role="alert">${esc(estado.nuvem.recusa.texto)}</p>` : "";
  // A linha do sono some enquanto a permissão não volta (protótipo, "O mesmo motivo no cartão").
  if (n.motivo === "credencial_nuvem" || n.estado === "excluida" || n.estado === "criando") return `<div class="nv-sono">${falha}${recusa}</div>`;
  const aberto = estado.nuvem.sonoMenu === m.id;
  const menu = aberto
    ? `<div class="cl-menu" role="menu" aria-label="Dorme depois de">${OPCOES_SONO.map((o) => {
      const marcado = o.minutos === n.dormirAposMin;
      return `<button type="button" role="menuitemradio" aria-checked="${marcado}" data-act="nuvem-dormir-apos" data-maquina="${id}" data-minutos="${o.minutos ?? ""}"><span>${esc(o.rotulo)}</span></button>`;
    }).join("")}</div>`
    : "";
  const ajuste = `<span class="nv-ajuste-wrap"><button type="button" class="bt sm" data-act="nuvem-sono-menu" data-maquina="${id}" aria-haspopup="menu" aria-expanded="${aberto}">${esc(n.dormirAposMin === null ? "Nunca dormir" : rotuloSono(n.dormirAposMin))} ▾</button>${menu}</span>`;
  const frase = n.dormirAposMin === null ? `<span>Não dorme sozinha</span>${ajuste}` : `<span>Dorme depois de</span>${ajuste}<span>sem trabalho</span>`;
  const agir = n.estado === "acordada" ? `<button type="button" class="bt sm" data-act="nuvem-dormir" data-maquina="${id}">Dormir agora</button>`
    : n.estado === "dormindo" ? `<button type="button" class="bt sm" data-act="nuvem-acordar" data-maquina="${id}">Acordar agora</button>` : "";
  const nota = n.estado === "dormindo" ? `<p class="mac-det-txt">Acorda sozinha quando um bot precisar.</p>` : n.estado === "acordando" && n.motivo === null ? `<p class="mac-det-txt">Acordando: costuma levar 1 a 2 min.</p>` : "";
  return `<div class="nv-sono">${falha}<div class="nv-sono-linha">${frase}${agir}</div>${nota}${recusa}</div>`;
}

function projetoDaConta(estado: Pick<Estado, "nuvem">): string | null {
  const c = estado.nuvem.conta;
  return c && c !== "desligada" ? c.projeto : null;
}

/** ADR-121 (NOD-92): o aviso do topo depois da volta do Google (`?nuvem=preparando|recusado`). */
export function avisoDaNuvem(estado: Estado): string {
  const a = avisoDaConta(estado.nuvem);
  if (!a) return "";
  const reconectar = a.motivo === "credencial_nuvem" ? `<button type="button" class="bt link" data-act="nuvem-reconectar">Reconectar o Google</button>` : "";
  const noConsole = a.motivo === "cota_ou_cobranca" ? `<a class="bt link" href="${esc(urlConsoleGoogle(projetoDaConta(estado)))}" target="_blank" rel="noopener noreferrer">Abrir o console do Google ↗</a>` : "";
  const fechar = a.tom === "espera" ? "" : `<button type="button" class="bt link" data-act="nuvem-aviso-fechar">Fechar</button>`;
  return `<div class="espaco-cartao nv-aviso nv-${a.tom}" role="status">${a.tom === "espera" ? `<span class="ob-gira" aria-hidden="true"></span>` : ""}<span>${esc(a.texto)}</span><span class="nv-acoes">${noConsole}${reconectar}${fechar}</span></div>`;
}

/** ADR-102 (G2-M5): "Desconectar" com "Sair também das contas de IA" (marcada quando há contas lá). */
function dialogoDesconectar(estado: Estado): string {
  const q = estado.contasUi.desconectar;
  const m = q ? estado.maquinas?.maquinas.find((x) => x.id === q.maquinaId) : null;
  if (!q || !m) return "";
  const n = (estado.contasIa?.contas ?? []).filter((c) => c.maquinas.some((v) => v.maquinaId === m.id && v.estado === "pronta")).length;
  const bots = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id).map((b) => b.nome);
  const pareceMac = m.plataforma === "darwin";
  // ADA-243: nomeia para onde vão (a padrão, quando há outra), em vez de "este Mac" no Windows.
  const padrao = estado.maquinas?.maquinas.find((x) => x.id === estado.maquinas?.padraoId && x.id !== m.id && !soComputador(x));
  const destino = padrao ? `o ${padrao.nome}` : estado.maquinas?.servidorNoMac ? "este computador" : "outra máquina";
  const volta = bots.length ? ` ${bots.join(", ")} ${bots.length === 1 ? "volta" : "voltam"} para ${destino} no próximo trabalho; o que está rodando agora termina lá.` : "";
  const caixa = n > 0 ? `<label class="cl-caixa cl-check"><input type="checkbox" data-maq-sair-contas${q.sair ? " checked" : ""}><span>Sair também ${n === 1 ? "da conta" : `das ${n} contas`} de IA ${pareceMac ? "no" : "na"} ${esc(m.nome)}<small>Recomendado se a máquina vai ser apagada ou passar para outra pessoa. Nas outras máquinas as contas continuam.</small></span></label>` : "";
  const corpo = soComputador(m)
    ? `<p>A chave dela é cancelada e o computador dos seus bots volta para as máquinas de trabalho.</p><div class="ssh-manual"><p>O nod não guarda o acesso à ${esc(m.nome)}. Para tirar o computador de lá, rode no servidor:</p><div class="cx-cmd"><code>${esc(COMANDO_DESLIGAR_COMPUTADOR)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: COMANDO_DESLIGAR_COMPUTADOR } })}</div></div>`
    : `<p>A chave dela é cancelada e ela para de pegar trabalho.${esc(volta)}</p>${caixa}`;
  return `<div class="cl-fundo" data-act="maq-desconectar-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="maq-desc-tit"><h3 id="maq-desc-tit">Desconectar ${pareceMac ? "o" : "a"} ${esc(m.nome)}?</h3>${corpo}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="maq-desconectar-fechar" data-cl-autofoco>Cancelar</button><button type="button" class="bt perigo" data-act="maq-desconectar-confirmar">Desconectar ${esc(m.nome)}</button></div></div>`;
}

/** O status da linha: a nuvem manda (dormindo é normal, sem cor de erro); sem contato, "Offline desde"; senão, a leitura. */
export function statusDaMaquina(estado: Pick<Estado, "trabalhos">, m: MaquinaDto, ob = false): { texto: string; tom: TomStatus } {
  const n = m.nuvem;
  if (n && n.estado !== "acordada") {
    const desde = n.estado === "dormindo" ? ` desde ${hora(n.estadoDesde)}` : "";
    return { texto: `${rotuloEstadoNuvem(n.estado)}${desde}`, tom: n.estado === "dormindo" ? "neutro" : "atencao" };
  }
  if (!m.conectada) return { texto: m.ultimoUsoEm ? `Offline desde ${dataHora(m.ultimoUsoEm)}` : "Offline", tom: "erro" };
  const s = leituraDaMaquina(estado, m.id)?.status ?? { texto: n ? "Acordada" : "Conectada", tom: "ok" as const };
  return ob ? noMasculino(s) : s;
}

/** ADA-245: com o texto do onboarding o sujeito é "o computador" (Conectado, Ocupado, Acordado). */
function noMasculino(s: { texto: string; tom: TomStatus }): { texto: string; tom: TomStatus } {
  const t = s.texto === "Conectada" ? "Conectado" : s.texto === "Ocupada" ? "Ocupado" : s.texto === "Acordada" ? "Acordado" : s.texto;
  return { ...s, texto: t };
}

/** "Este Mac · Mac · 11 bots aqui, 10 pela padrão" / "Google Cloud · São Paulo · 1 bot aqui" / "Linux · nenhum bot aqui". */
function detalheDaMaquina(estado: Estado, m: MaquinaDto, ehEsteMac: boolean): string {
  if (soComputador(m)) return `${nomePlataforma(m, estado.onboardingTexto) || "Offline"} · hospeda o computador dos seus bots e não pega trabalho`;
  const aqui = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id);
  const pelaPadrao = aqui.filter((b) => !b.maquinaId || !(estado.maquinas?.maquinas ?? []).some((x) => x.id === b.maquinaId)).length;
  const ob = estado.onboardingTexto;
  const bots = aqui.length === 0 ? "nenhum bot aqui" : `${aqui.length} ${aqui.length === 1 ? "bot" : "bots"} aqui${pelaPadrao > 0 ? `, ${pelaPadrao} ${ob ? "pelo padrão" : "pela padrão"}` : ""}`;
  const onde = m.nuvem ? `Google Cloud · ${nomeDaZona(m.nuvem.zona)}` : nomePlataforma(m, ob);
  // ADA-245 (D1): nome, plataforma, bots aqui, a IA conectada e o e-mail; o status vai à direita.
  if (ob) return [ehEsteMac ? rotuloDoMac() : "", onde, bots, iaConectadaEmTexto(estado, m)].filter(Boolean).join(" · ");
  return `${ehEsteMac ? `${rotuloDoMac()} · ` : ""}${onde} · ${bots}`;
}

/** NOD-367: a chave da máquina, aberta pelo "Detalhes da chave" do "…" (a chave inteira só aparece ao criar). */
function detalhesDaChave(estado: Estado, m: MaquinaDto): string {
  if (!estado.configUi.abertos.includes(`chave-${m.id}`)) return "";
  const c = (estado.chaves ?? []).find((x) => x.id === m.id);
  const uso = c?.ultimoUsoEm ?? m.ultimoUsoEm;
  return `<div class="cfg-chave" role="region" aria-label="Chave de ${esc(m.nome)}"><dl>
      <dt>Prefixo</dt><dd><code>…${esc(m.prefixo)}</code></dd>
      ${c ? `<dt>Criada em</dt><dd>${esc(dataHora(c.criadaEm))}</dd>` : ""}
      <dt>Último uso</dt><dd>${uso ? esc(dataHora(uso)) : "nunca usada"}</dd>
    </dl><p class="lc-nota">A chave inteira só aparece uma vez, quando é criada. Perdeu? Revogue esta e conecte de novo.</p>${revogarNosDetalhes(estado, m, c)}</div>`;
}

/** ADA-245: com o texto do onboarding, "Revogar chave" sai do "…" e fica aqui, nos Detalhes. */
function revogarNosDetalhes(estado: Estado, m: MaquinaDto, c: NonNullable<Estado["chaves"]>[number] | undefined): string {
  if (!estado.onboardingTexto || !c || c.revogadaEm) return "";
  return `<div class="cx-rodape"><button type="button" class="bt sm perigo" data-act="revogar-chave" data-id="${esc(c.id)}" data-nome="${esc(c.nome)}" data-maquina="${esc(m.id)}">Revogar chave</button></div>`;
}

/** Uma máquina: a linha (ícone, nome, detalhe, status e "…") e, embaixo, o que se abre dela. */
function linhaDaMaquina(estado: Estado, m: MaquinaDto, usoEm: DonoDoUso | null, ehEsteMac: boolean): string {
  const renomear = estado.contasUi.maquinaRenomear === m.id
    ? `<form class="cl-renomear maq-renomear" data-form="maq-renomear" data-maquina="${esc(m.id)}"><input name="nome" maxlength="60" value="${esc(m.nome)}" aria-label="${estado.onboardingTexto ? "Nome do computador" : "Nome da máquina"}" data-cl-autofoco data-manter-foco="maq-renomear"><button type="submit" class="bt sm">Salvar</button><button type="button" class="bt link sm" data-act="maq-renomear-fechar">Cancelar</button></form>`
    : "";
  const linha = linhaConfig({
    titulo: m.nome,
    detalhe: detalheDaMaquina(estado, m, ehEsteMac),
    icone: m.plataforma === "darwin" || m.plataforma === "win32" ? ICONE.laptop : ICONE.servidor,
    status: statusDaMaquina(estado, m, estado.onboardingTexto),
    controle: { tipo: "menu", acao: "maq-menu", aberto: estado.contasUi.maquinaMenu === m.id, rotulo: m.nome, itens: itensDaMaquina(estado, m, usoEm, ehEsteMac), dados: { maquina: m.id } },
  });
  const extras = soComputador(m) ? "" : `${nuvemNoCartao(estado, m)}${formConectarNuvem(estado, m)}`;
  return `<div class="cfg-maq" data-maquina-linha="${esc(m.id)}">${linha}${renomear}${detalhesDaChave(estado, m)}${extras}${telasNaMaquina(estado, m)}${ehEsteMac ? oQueRodaNoMac(estado) : ""}</div>`;
}

/** NOD-96 (v2): a máquina que hospeda o computador do bot diz as telas abertas nele, com o caminho para o painel. */
function telasNaMaquina(estado: Estado, m: MaquinaDto): string {
  const pc = estado.computadorPessoa;
  if (!pc || pc.maquina?.id !== m.id) return "";
  return `<div class="maq-quem pc-na-maquina"><span class="maq-avatares" aria-hidden="true">${ICONE_CB.pcBot}</span><span>${esc(resumoDasTelas(pc, botsDaPessoa(estado)))}</span><button type="button" class="cb-link" data-act="ver-computador-do-bot">Ver</button></div>`;
}

/** ADR-085: o que roda no Mac agora (os medidores e quem trabalha ou espera), atrás do "O que roda agora" do "…". */
function oQueRodaNoMac(estado: Estado): string {
  return estado.configUi.abertos.includes("mac-agora") ? `<div class="cfg-mac-agora" role="region" aria-label="O que roda no Mac agora">${renderEsteMac(estado)}</div>` : "";
}

/** O Mac do servidor (ADR-092) sem chave: a linha "Este Mac" só com a leitura e o uso. */
function linhaDoMacSemChave(estado: Estado, id: string, nome: string): string {
  const l = leituraDaMaquina(estado, id);
  const linha = linhaConfig({
    titulo: nome,
    detalhe: `${rotuloDoMac()} · ${detalheDosBotsNoMac(estado)}`,
    icone: ICONE.laptop,
    status: estado.onboardingTexto ? noMasculino(l?.status ?? { texto: "Conectada", tom: "ok" }) : l?.status ?? { texto: "Conectada", tom: "ok" },
    controle: { tipo: "menu", acao: "maq-menu", aberto: estado.contasUi.maquinaMenu === id, rotulo: nome, dados: { maquina: id }, itens: `${leituraNoCartao(estado, id)}${itensDoUso(estado)}<hr>${itemMenu("maq-abrir", ICONE.monitor, "O que roda agora", { dados: { recolhe: "mac-agora" }, nota: "memória, processador, disco e quem está trabalhando" })}` },
  });
  return `<div class="cfg-maq" data-maquina-linha="${esc(id)}">${linha}${oQueRodaNoMac(estado)}</div>`;
}

function detalheDosBotsNoMac(estado: Estado): string {
  const n = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b) === null).length;
  return n === 0 ? "nenhum bot aqui" : `${n} ${n === 1 ? "bot" : "bots"} aqui`;
}

/** PR 2 (protótipo da NOD-92): "Criar minha máquina na nuvem" — provedor, região e tamanho; o Google pede a permissão. */
function painelCriar(estado: Estado): string {
  const c = estado.nuvem.criar;
  if (!c) return "";
  const conta = estado.nuvem.conta;
  const conectada = !!conta && conta !== "desligada" && conta.conectada;
  const provedores = `<div class="nv-provedores" role="radiogroup" aria-label="Provedor"><label class="nv-opcao"><input type="radio" name="provedor" value="gcp" checked><span><b>Google Cloud</b><small>a VM fica na sua conta Google</small></span></label><label class="nv-opcao desligada"><input type="radio" name="provedor" value="aws" disabled><span><b>AWS</b><small>Em breve</small></span></label><label class="nv-opcao desligada"><input type="radio" name="provedor" value="azure" disabled><span><b>Azure</b><small>Em breve</small></span></label></div>`;
  const regioes = REGIOES_CRIAR.map((r) => `<label class="nv-opcao"><input type="radio" name="regiao" value="${esc(r.regiao)}"${c.regiao === r.regiao ? " checked data-cl-autofoco" : ""} data-nuvem-criar="regiao"><span><b>${esc(r.nome)}</b>${r.nota ? `<small>${esc(r.nota)}</small>` : ""}</span></label>`).join("");
  const tamanhos = TAMANHOS_CRIAR.map((t) => `<label class="nv-opcao"><input type="radio" name="tamanho" value="${esc(t.tamanho)}"${c.tamanho === t.tamanho ? " checked" : ""} data-nuvem-criar="tamanho"><span><b>${esc(t.nome)}</b><small>${esc(t.nota)}</small></span></label>`).join("");
  const erro = c.erro ? `<p class="nv-erro" role="alert">${esc(c.erro)}</p>` : "";
  const enviar = conectada ? "Criar máquina" : "Entrar com o Google e criar";
  const nota = conectada ? "O nod cria a VM na sua conta Google, instala o motor e conecta sozinho. Você paga o Google pelo uso; ela dorme quando fica parada." : "O Google pede para você permitir que o nod crie e ligue máquinas na sua conta. Depois o nod instala o motor e conecta sozinho.";
  return `<form class="espaco-cartao nv-criar" data-form="nuvem-criar" aria-labelledby="nv-criar-tit">
    <div class="nv-criar-cab"><h3 id="nv-criar-tit">Criar minha máquina na nuvem</h3><button type="button" class="bt link" data-act="nuvem-criar-fechar">Cancelar</button></div>
    <fieldset><legend>Onde</legend>${provedores}</fieldset>
    <fieldset><legend>Região</legend><div class="nv-opcoes">${regioes}</div></fieldset>
    <fieldset><legend>Tamanho</legend><div class="nv-opcoes">${tamanhos}</div></fieldset>
    <p class="mac-det-txt">${esc(nota)}</p>${erro}
    <div class="nv-criar-acoes"><button type="submit" class="bt pri"${c.enviando ? " disabled" : ""}>${c.enviando ? "Enviando…" : esc(enviar)}</button></div>
  </form>`;
}

/** As VMs que o nod está criando (ainda sem chave): o que acontece agora e, se falhou, excluir ou criar de novo. */
function listaCriando(estado: Estado): string {
  const lista = criandoDaConta(estado.nuvem);
  if (lista.length === 0) return "";
  return lista.map((c: MaquinaCriandoDto) => {
    const falhou = c.estado !== "criando";
    const acoes = falhou ? `<span class="nv-acoes"><button type="button" class="bt sm" data-act="nuvem-excluir" data-id="${esc(c.id)}" data-nome="${esc(c.nome)}">Excluir</button><button type="button" class="bt sm pri" data-act="nuvem-criar-abrir" data-id="${esc(c.id)}">Criar de novo</button></span>` : "";
    return `<div class="espaco-cartao maq-cartao nv-criando${falhou ? " nv-falha" : ""}" role="status"><div class="maq-cab"><span class="maq-ic" aria-hidden="true">${ICONE.servidor}</span><span class="maq-id"><b>${esc(c.nome)}</b><small>Google Cloud · ${esc(nomeDaZona(c.zona))}</small></span><span class="maq-estado${falhou ? " fora" : ""}">${falhou ? "não deu certo" : `<span class="ob-gira" aria-hidden="true"></span>criando`}</span></div><p class="mac-det-txt">${esc(fraseDaCriacao(c))}</p>${acoes}</div>`;
  }).join("");
}

/** "Excluir a <nome>?": só a VM criada pelo nod; apaga a VM na conta Google da pessoa e cancela a chave. */
function dialogoExcluir(estado: Estado): string {
  const q = estado.nuvem.excluir;
  if (!q) return "";
  const erro = q.erro ? `<p class="nv-erro" role="alert">${esc(q.erro)}</p>` : "";
  return `<div class="cl-fundo" data-act="nuvem-excluir-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="nv-exc-tit"><h3 id="nv-exc-tit">Excluir a ${esc(q.nome)}?</h3><p>O nod apaga a VM na sua conta Google, com o disco e os arquivos dos bots que estão nela, e cancela a chave. Não dá para desfazer.</p>${erro}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="nuvem-excluir-fechar" data-cl-autofoco>Cancelar</button><button type="button" class="bt perigo" data-act="nuvem-excluir-confirmar">Excluir ${esc(q.nome)}</button></div></div>`;
}

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): Configurações › Máquinas é uma lista só, a partir de
 * `GET /maquinas`. Primeiro a máquina padrão; depois uma linha por máquina, com o status (ponto e texto) e o "…" (a
 * leitura, o uso do Mac, renomear, contas, bots, a chave, desconectar e revogar); por último as chaves revogadas,
 * recolhidas, e os caminhos para conectar outra. Onde cada bot trabalha se escolhe na ficha dele.
 */
export function renderMaquinas(estado: Estado): string {
  const dados = estado.maquinas;
  const todas = dados?.maquinas ?? [];
  const maquinas = maquinasDeTrabalho(todas);
  const temComputador = todas.some(soComputador);
  const noMac = !!dados?.servidorNoMac;
  const ui = estado.configUi;
  const leituras = maquinasDe(estado.trabalhos) ?? [];
  // O Mac do servidor que não tem chave (ADR-092) entra como "Este Mac", com a leitura dele.
  const macSemChave = leituras.find((l) => l.ehMac && !todas.some((m) => m.id === l.id)) ?? null;
  // Revisão NOD-373: o Mac se reconhece pela leitura ou pela plataforma (que vem da conexão viva). Mac sem contato conta como
  // "sem Mac" (critério 7 da NOD-373): o controle vai para a padrão até ele voltar.
  const idsDoMac = new Set(leituras.filter((l) => l.ehMac).map((l) => l.id)); // "Este Mac": só o do servidor
  const idsDeMac = new Set([...idsDoMac, ...todas.filter((m) => m.plataforma === "darwin").map((m) => m.id)]);
  const usoEm = donoDoUso(todas, idsDeMac, macSemChave ? { id: macSemChave.id, nome: macSemChave.nome } : null, dados?.padraoId ?? null);
  const ob = estado.onboardingTexto;
  // ADA-245 (D3): a tela de Fim fica no lugar da seção até a pessoa clicar em "Fechar".
  if (ob && estado.removerUi.fim) return telaFimRemover(estado.removerUi);
  const cab = ob
    ? `<h2>Computadores</h2><p class="intro">Onde seus bots trabalham. Cada bot roda o Claude ou o ChatGPT no computador dele; o computador de um bot se escolhe na ficha dele.</p>`
    : `<h2>Máquinas</h2><p class="intro">Onde seus bots trabalham. Cada bot roda o Claude Code ou o Codex na máquina dele; a máquina de um bot se escolhe na ficha dele.</p>`;
  const conectar = estado.conectarMaquina ? renderConectar(estado, estado.conectarMaquina) : "";
  const regras = ob ? regrasDoPadrao(noMac) : noMac
    ? ehCelular() ? `"Seu Mac": o bot roda no Mac onde o Nod está instalado; uma VM só pega o trabalho dos bots escolhidos para ela. Se a máquina de um bot ficar sem contato, a conversa espera por ela.` : `"Este Mac": o bot roda aqui, onde o Nod está aberto; uma VM só pega o trabalho dos bots escolhidos para ela. Se a máquina de um bot ficar sem contato, a conversa espera por ela.`
    : `"Qualquer uma": o primeiro computador conectado que estiver livre pega o trabalho. Se a máquina de um bot ficar sem contato, a conversa espera por ela; na mensagem você pode rodar em outra só daquela vez.`;
  const padrao = maquinas.length > 0
    ? grupoConfig(null, [linhaConfig({
      titulo: ob ? "Computador padrão" : "Máquina padrão",
      detalhe: ob ? "Bot sem computador escolhido (e bot novo) trabalha nele" : "Bot sem máquina escolhida (e bot novo) trabalha nela",
      controle: { tipo: "seletor", acao: "maquina-padrao", rotulo: ob ? "Computador padrão" : "Máquina padrão", opcoes: opcoesDeMaquina(maquinas, dados?.padraoId ?? null, noMac, ob) },
    })], {
      nota: ob
        ? `${regras} Rotinas não mudam de computador sozinhas; os arquivos de cada bot ficam no computador onde ele trabalha.${temComputador ? " Um computador só para o computador dos bots não entra aqui." : ""}`
        : `${regras} Rotinas não mudam de máquina sozinhas; os arquivos de cada bot ficam na máquina onde ele trabalha.${temComputador ? " Uma máquina só computador não entra aqui: ela só hospeda o computador do bot." : ""}`,
    })
    : "";
  const linhas = [
    ...(macSemChave ? [linhaDoMacSemChave(estado, macSemChave.id, macSemChave.nome)] : []),
    ...todas.map((m) => linhaDaMaquina(estado, m, usoEm, idsDoMac.has(m.id))),
  ];
  const tituloSuas = ob ? "Seus computadores" : "Suas máquinas";
  const suas = !dados
    ? grupoConfig(tituloSuas, [], { notaHtml: `<span role="status">Verificando…</span>` })
    : linhas.length === 0
      ? grupoConfig(tituloSuas, [], { nota: ob ? "Nenhum computador conectado ainda. Instale o nod num computador e entre na sua conta; ele aparece aqui sozinho." : noMac ? `Nenhuma máquina conectada ainda. Os bots rodam ${ehCelular() ? "no seu Mac" : "neste Mac"}; conecte uma VM Linux para mandar bots para ela.` : "Nenhuma máquina conectada ainda. Conecte o app do Mac ou uma VM Linux para os bots trabalharem nela." })
      : grupoConfig(tituloSuas, linhas, { classe: "cfg-maquinas", ...(ob ? { contagem: linhas.length } : {}) });
  return `<section class="espaco-secao cfg-secao cfg-maquinas-secao maquinas">
    ${cab}
    ${avisoDaNuvem(estado)}
    ${painelCriar(estado)}
    ${conectar}
    ${linhaEmSegundoPlano(estado)}
    ${padrao}
    ${listaCriando(estado) ? `<div class="maq-lista">${listaCriando(estado)}</div>` : ""}
    ${suas}
    ${grupoFinal(estado, todas, noMac, ui)}
    ${dialogoDesconectar(estado)}
    ${dialogoExcluir(estado)}
    ${ob ? dialogoRemover(estado.removerUi) : ""}
    ${renderInstalarSsh(estado)}
  </section>`;
}

/** ADA-245 (prancha D1): a nota do computador padrão com o texto do onboarding. */
function regrasDoPadrao(noMac: boolean): string {
  if (!noMac) return `"Qualquer um": o primeiro computador conectado que estiver livre pega o trabalho. Se o computador de um bot ficar sem contato, a conversa espera por ele.`;
  return `"${ehCelular() ? "Seu Mac" : "Este Mac"}": o bot roda ${ehCelular() ? "no Mac onde o Nod está instalado" : "aqui, onde o Nod está aberto"}; um servidor só pega o trabalho dos bots escolhidos para ele. Se o computador de um bot ficar sem contato, a conversa espera por ele.`;
}

/** As opções do seletor de máquina: "Qualquer uma" (no servidor no Mac, "Este Mac") e as máquinas de trabalho. */
export function opcoesDeMaquina(maquinas: readonly MaquinaDto[], atual: string | null, noMac: boolean, ob = false): OpcaoSeletor[] {
  const valor = atual && maquinas.some((m) => m.id === atual) ? atual : "";
  return [{ id: "", nome: noMac ? rotuloDoMac() : ob ? "Qualquer um" : "Qualquer uma" }, ...maquinas.map((m) => ({ id: m.id, nome: m.conectada ? m.nome : `${m.nome} (offline)` }))]
    .map((o) => ({ valor: o.id, rotulo: o.nome, selecionado: o.id === valor }));
}

/** O fim da seção: as chaves revogadas (só com alguma), conectar outra máquina, a nuvem, o atalho do computador e a chave à mão. */
function grupoFinal(estado: Estado, todas: readonly MaquinaDto[], noMac: boolean, ui: Estado["configUi"]): string {
  const revogadas = (estado.chaves ?? []).filter((c) => c.revogadaEm !== null);
  const ob = estado.onboardingTexto;
  const linhaRevogada = (c: (typeof revogadas)[number]) => linhaConfig({
    titulo: c.nome,
    detalhe: `…${c.prefixo} · ${c.ultimoUsoEm ? `usada até ${dataHora(c.ultimoUsoEm)}` : "nunca usada"}`,
    status: { texto: `Revogada em ${dataHora(c.revogadaEm!).split(",")[0]}`, tom: "neutro" },
  });
  const linhas: string[] = [];
  if (revogadas.length > 0) {
    linhas.push(linhaConfig({
      titulo: ob ? `Computadores que saíram da conta (${revogadas.length})` : `Chaves revogadas (${revogadas.length})`,
      detalhe: "Não entram mais; ficam aqui para você saber quais foram",
      icone: ICONE.cadeado,
      controle: { tipo: "recolhe", id: "revogadas", acao: "config-recolhe", aberto: ui.abertos.includes("revogadas"), conteudo: listaAninhada(revogadas.map(linhaRevogada)) },
    }));
  }
  if (nuvemLigada(estado.nuvem, todas) && !estado.nuvem.criar) {
    linhas.push(linhaConfig({ titulo: ob ? "Criar meu computador na nuvem" : "Criar minha máquina na nuvem", detalhe: "Uma VM na sua conta Google, que dorme parada e acorda quando chega trabalho", icone: ICONE.mais, controle: { tipo: "link", acao: "nuvem-criar-abrir" } }));
  }
  if (!estado.conectarMaquina) {
    linhas.push(ob
      ? linhaConfig({ titulo: "Conectar outro computador", detalhe: "Instale o nod nele e entre na sua conta; ele aparece aqui sozinho.", icone: ICONE.mais, controle: { tipo: "link", acao: "conectar-maquina" } })
      : linhaConfig({ titulo: "Conectar outra máquina", detalhe: "Um Mac, uma VM ou um computador: o passo a passo gera a chave", icone: ICONE.mais, controle: { tipo: "link", acao: "conectar-maquina" } }));
  }
  // NOD-94: o atalho só no modo compartilhado (no local o Mac já é o computador) e fora do Conectar.
  if (estado.maquinas && !noMac && !estado.conectarMaquina && !estado.instalarSsh) {
    linhas.push(linhaConfig({ titulo: ob ? "Usar um servidor só para o computador dos bots" : "Usar uma máquina só para o computador", detalhe: "Um lugar para o computador do bot, sem terminal", icone: ICONE.monitor, controle: { tipo: "link", acao: "ssh-abrir" } }));
  }
  // ADR-031: a chave gerada à mão (o app do Mac de antes do convite); a crua aparece uma vez.
  const manual = `<form class="cfg-chave-form" data-form="emitir-chave"><label>Nome do computador <input name="nome" required maxlength="60" placeholder="ex.: MacBook do trabalho" data-manter-foco="emitir-chave-nome"></label><button class="bt" type="submit">Gerar chave</button></form>`;
  linhas.push(linhaConfig({
    titulo: ob ? "Conectar à mão" : "Gerar uma chave à mão",
    detalhe: ob ? "Para um computador antigo que pede um código de acesso" : "Para um computador que pede a chave em vez do código",
    icone: ICONE.cadeado,
    controle: { tipo: "recolhe", id: "chave-manual", acao: "config-recolhe", aberto: ui.abertos.includes("chave-manual"), conteudo: `<div class="cfg-chave">${manual}</div>` },
  }));
  return `${chaveEmitida(estado)}${grupoConfig(null, linhas)}`;
}

/** A chave crua, logo depois de gerar (ADR-031): copie agora, ela não volta. */
function chaveEmitida(estado: Estado): string {
  const e = estado.chaveEmitida;
  if (!e) return "";
  return `<div class="cfg-chave chave-emitida" role="status">
      <p><b>Chave do computador "${esc(e.dados.nome)}"</b>: copie agora. Ela <b>não será mostrada de novo</b>; o nod guarda só uma impressão digital dela.</p>
      <code class="chave-crua">${esc(e.chave)}</code>
      <div class="acoes">${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: e.chave } })}${botao("fechar-chave-emitida", "Já copiei", { classe: "sm" })}</div>
    </div>`;
}

function haQuantoPediu(s: number): string {
  if (s < 60) return "agora há pouco";
  const min = Math.round(s / 60);
  return min === 1 ? "há 1 minuto" : `há ${min} minutos`;
}

/** A máquina que apareceu depois do "Conectar" (a chave nova), quando o motor já trocou o código pela chave. */
export function maquinaNova(estado: Estado, c: ConectarMaquina): MaquinaDto | null {
  return (estado.maquinas?.maquinas ?? []).find((m) => !c.chavesAntes.includes(m.id) && !soComputador(m)) ?? null;
}

/** ADR-102: o contexto da lista de contas para o passo "Contas" do Conectar (só VM: o Mac entra pelo app dele). */
function contextoDasContas(estado: Estado): ContextoContas | null {
  if (!estado.contasIa?.disponivel) return null;
  return {
    contas: estado.contasIa, maquinas: estado.maquinas?.maquinas ?? [], detalhes: estado.detalhesContas, ui: estado.contasUi, agora: estado.agora,
    noApp: estado.detalhesContas !== null, botsNaMaquina: () => [], cartaoDoMac: () => "",
  };
}

function renderConectar(estado: Estado, c: ConectarMaquina): string {
  // ADR-102 (CMJ): com o convite, a tela vê a máquina chegar — sem o passo de digitar o código.
  const comConvite = Boolean(c.convite);
  const passos = comConvite
    ? ([["comando", "Instalar"], ["confirmar", "Confirmar"], ["ias", "Contas"], ["bots", "Escolher os bots"]] as const)
    : ([
      ["comando", "Instalar"],
      ["codigo", "Digitar o código"],
      ["confirmar", "Confirmar"],
      ["ias", "Entrar nas IAs"],
      ["bots", "Escolher os bots"],
    ] as const);
  const indice = (passos as readonly (readonly [string, string])[]).findIndex(([id]) => id === (comConvite && c.passo === "codigo" ? "comando" : c.passo));
  const trilha = `<ol class="cx-trilha">${passos.map(([id, nome], i) => `<li class="${i < indice ? "feito" : i === indice ? "agora" : ""}"${id === c.passo ? ' aria-current="step"' : ""}><span>${i < indice ? "✓" : i + 1}</span>${esc(nome)}</li>`).join("")}</ol>`;
  const erro = c.erro ? `<p class="cx-erro" role="alert">${esc(c.erro)}</p>` : "";
  const fechar = botao("fechar-conectar-maquina", "Fechar", { classe: "link" });
  const nova = maquinaNova(estado, c);
  let corpo = "";
  if (c.passo === "comando" && comConvite) {
    const origem = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    const cmd = `curl -fsSL "${origem}/motor?convite=${c.convite}" | sh`;
    corpo = `<h3>Rode este comando na sua máquina Linux</h3>
      <p>Debian ou Ubuntu, em qualquer provedor (2 vCPU e 4 GB para começar; 4 vCPU e 8 GB com vários bots). Ele instala o motor com o Claude Code e o Codex. A máquina não precisa de porta aberta: é ela que procura trabalho no Nod.</p>
      <div class="cx-cmd"><code>${esc(cmd)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: cmd }, vivo: true })}</div>
      <div class="cx-espera" role="status"><span class="ob-gira" aria-hidden="true"></span><span>Esperando a máquina aparecer…</span><small>o convite vale ${c.conviteAte ? `até ${esc(hora(c.conviteAte))}` : "por 30 min"} e uma vez</small></div>
      ${erro}
      <div class="cx-rodape">${fechar}<span class="cx-segue">Esta tela segue sozinha · ${botao("passo-conectar-maquina", "apareceu um código?", { classe: "link", dados: { passo: "codigo" } })}</span></div>`;
  } else if (c.passo === "comando") {
    // O endereço deste Nod (a página é servida por ele); os testes de render rodam sem DOM.
    const origem = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    // ADR-092: com o servidor no Mac, a VM chega à API deste Mac por um túnel SSH aberto daqui (nada fica exposto na
    // internet); o motor guarda o endereço da API, então o túnel e o comando usam a porta dela, não a desta página.
    const noMac = estado.maquinas?.servidorNoMac ?? null;
    const cmd = noMac ? `curl -fsSL ${noMac.api}/api/motor/instalar | sh` : `curl -fsSL ${origem}/motor | sh`;
    const porta = noMac ? (/:(\d+)$/.exec(noMac.api)?.[1] ?? "8888") : "";
    const tunel = `ssh -N -R ${porta}:127.0.0.1:${porta} voce@sua-vm`;
    corpo = `<h3>Rode este comando na sua máquina Linux</h3>
      <p>Debian ou Ubuntu, em qualquer provedor. Para começar, 2 vCPU e 4 GB; com vários bots rodando testes e builds, 4 vCPU e 8 GB. Ela não precisa de porta aberta: é a máquina que procura trabalho no Nod. Use a máquina só para o Nod.</p>
      ${noMac ? `<p>Este Nod roda no seu Mac. Antes, abra no Mac um túnel SSH para a VM e deixe-o aberto: com ele a VM enxerga o Nod em ${esc(noMac.api)}, só ela e sem porta aberta na internet.</p>
      <div class="cx-cmd"><code>${esc(tunel)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: tunel }, vivo: true })}</div>
      <p>Depois, no terminal da VM:</p>` : ""}
      <div class="cx-cmd"><code>${esc(cmd)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: cmd }, vivo: true })}</div>
      <p class="cx-nota">Ele instala o motor, cria o usuário nod e, no fim, mostra um código.</p>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Apareceu um código", { classe: "pri", dados: { passo: "codigo" } })}</div>`;
  } else if (c.passo === "codigo") {
    corpo = `<h3>Digite o código da máquina</h3>
      <p>Ele aparece no fim da instalação e vale por alguns minutos.</p>
      <label class="cx-codigo" for="codigo-maquina"><span>Código</span><input id="codigo-maquina" type="text" value="${esc(c.codigo)}" autocomplete="off" spellcheck="false" maxlength="12" placeholder="K7QM-4F2X"></label>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: "comando" } })}${botao("ver-codigo-maquina", "Continuar", { classe: "pri" })}</div>`;
  } else if (c.passo === "confirmar" && c.pedido) {
    corpo = `<h3>Conectar ${esc(c.pedido.nome)}?</h3>
      <div class="cx-confirma"><span class="maq-ic" aria-hidden="true">${ICONE.servidor}</span><div><b>${esc(c.pedido.nome)}</b><small>${nomeDaPlataforma(c.pedido.plataforma)} · código ${esc(c.codigo.toUpperCase())} · pediu ${esc(haQuantoPediu(c.pedido.pedidoHaS))}</small></div></div>
      <p class="cx-nota">Confira se o terminal da máquina mostra o código <b>${esc(c.codigo.toUpperCase())}</b>. Conecte só se foi você quem rodou o comando nessa máquina agora. Quem conecta uma máquina passa a receber o trabalho dos bots que você mover para ela.</p>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: comConvite ? "comando" : "codigo" } })}${botao("aprovar-maquina", `Conectar ${esc(c.pedido.nome)}`, { classe: "pri" })}</div>`;
  } else if (c.passo === "ias" && contextoDasContas(estado)) {
    const nome = nova?.nome ?? c.pedido?.nome ?? "a máquina";
    const ctx = contextoDasContas(estado)!;
    corpo = `<h3>Entre nas suas contas de IA na ${esc(nome)}</h3>
      <p>O login abre aqui na tela: você entra na página da Anthropic ou da OpenAI e a ${esc(nome)} fica com a conta. O Nod não vê sua senha, e o código que você cola vai cifrado direto para a máquina.</p>
      ${nova ? renderContasNaMaquina(ctx, nova.id) : `<div class="cx-espera" role="status"><span class="ob-gira" aria-hidden="true"></span><span>Esperando a ${esc(nome)} terminar de conectar…</span></div>`}
      <p class="cx-nota">GitHub (opcional), no terminal da máquina: <code>nod-motor entrar github</code></p>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Continuar", { classe: "pri", dados: { passo: "bots" }, desabilitado: !nova })}</div>`;
  } else if (c.passo === "ias") {
    const nome = nova?.nome ?? c.pedido?.nome ?? "a máquina";
    const claude = nova?.ias["claude-cli"];
    const estadoClaude = !nova ? "esperando a máquina terminar de conectar…" : claude === "pronto" ? "pronto" : "aguardando o login";
    corpo = `<h3>Entre nas suas IAs na ${esc(nome)}</h3>
      <p>Rode cada comando no terminal da máquina. O login é seu, direto com a Anthropic, a OpenAI e o GitHub: o Nod não vê sua senha nem sua chave. Esta tela percebe sozinha quando ficar pronto.</p>
      <div class="espaco-cartao">
        <div class="cx-ia"><span class="cx-ia-txt"><b>Claude Code</b><code>nod-motor entrar claude</code></span><span class="cx-st${claude === "pronto" ? " ok" : ""}"><i aria-hidden="true"></i>${esc(estadoClaude)}</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>Codex</b><code>nod-motor entrar codex</code></span><span class="cx-st">opcional (instale com NOD_COM_CODEX=1)</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>GitHub</b><code>nod-motor entrar github</code></span><span class="cx-st">opcional</span></div>
      </div>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Continuar", { classe: "pri", dados: { passo: "bots" }, desabilitado: !nova })}</div>`;
  } else if (c.passo === "bots") {
    const bots = botsDaPessoa(estado);
    const n = c.marcados.length;
    const linhas = bots.map((b) => {
      const marcado = c.marcados.includes(b.id);
      return `<button type="button" class="cx-bot" role="checkbox" aria-checked="${marcado}" data-act="marcar-bot-maquina" data-id="${esc(b.id)}"><span class="cx-check" aria-hidden="true">${marcado ? "✓" : ""}</span>${iconeAgente(b, "sm")}<span>${esc(b.nome)}</span><small>${esc(b.titulo)}</small></button>`;
    }).join("");
    corpo = `<h3>Quem passa a trabalhar na ${esc(nova?.nome ?? "máquina")}?</h3>
      <p>Eles saem do seu Mac a partir do próximo trabalho. O que está rodando agora termina onde começou.${estado.maquinas?.servidorNoMac ? " Os outros, e bot novo, continuam neste Mac." : " Bot novo também passa a trabalhar nela."}</p>
      <div class="espaco-cartao cx-bots"><div class="cx-bots-cab"><span>${n} de ${bots.length} bots</span>${botao("marcar-bots-maquina", "Marcar todos", { classe: "link", dados: { todos: "1" }, desabilitado: n === bots.length })}${botao("marcar-bots-maquina", "Nenhum", { classe: "link", dados: { todos: "0" }, desabilitado: n === 0 })}</div>${linhas}</div>
      ${erro}
      <div class="cx-rodape">${botao("fechar-conectar-maquina", "Agora não", { classe: "link" })}${botao("mover-bots-maquina", n === 0 ? "Concluir" : n === 1 ? "Mover 1 bot" : `Mover ${n} bots`, { classe: "pri" })}</div>`;
  }
  return `<div class="espaco-cartao cx-painel" aria-label="Conectar uma máquina">${trilha}<div class="cx-corpo">${corpo}</div></div>`;
}
