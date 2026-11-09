import type { EsperaDaConta } from "../../src/contracts/cota.ts";
import type { LeituraDeMaquinaDto, MaquinaDoTrabalho } from "../../src/contracts/maquina.ts";
import type { EstadoTrabalho, MotivoEsperaMac, NivelPressao, TrabalhoDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { Estado, FiltroTrabalhos, Tela } from "../estado/reducer.ts";
import { linhaAtual } from "./atividade.ts";
import { cotaDaIa } from "./execucao.ts";
import { duracaoCurta, quandoCurto } from "./relogio.ts";
import { botao, esc, hora } from "./render.ts";

/**
 * Trabalhos (ADR-083, épico #188): o que a faixa, a barra, a gaveta, "Todos os trabalhos" e as linhas do chat leem dos
 * trabalhos da pessoa. Puro: recebe o estado (ou a lista) e devolve dados ou HTML curto, sem DOM.
 */

/**
 * Os estados em que o trabalho conta como aberto. É a lista de `ESTADOS_ABERTOS_TRABALHO` (src/contracts/trabalho.ts):
 * a web só importa TIPO de src/ (eslint), então ela é repetida aqui e tests/unit/web/trabalhos.test.ts confere as duas.
 */
export const ESTADOS_ABERTOS: readonly EstadoTrabalho[] = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"];

export const aberto = (t: Pick<TrabalhoDto, "estado">): boolean => ESTADOS_ABERTOS.includes(t.estado);

/**
 * Os trabalhos que a tela conhece: a lista de `GET trabalhos` primeiro (é a mais nova a cada `trabalho.mudou`), depois os
 * que a conversa trouxe (`ConversaDto.trabalhos`, os abertos do bot dela) e os das telas de task já abertas.
 */
export function trabalhosConhecidos(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, conversaId?: string | null): TrabalhoDto[] {
  const lista: TrabalhoDto[] = [...(estado.trabalhos?.trabalhos ?? [])];
  const ids = new Set(lista.map((t) => t.id));
  const somar = (t: TrabalhoDto): void => {
    if (ids.has(t.id)) return;
    ids.add(t.id);
    lista.push(t);
  };
  for (const t of conversaId ? estado.conversas[conversaId]?.trabalhos ?? [] : []) somar(t);
  for (const d of Object.values(estado.trabalhoDetalhe)) somar(d.trabalho);
  return lista;
}

export function trabalhoPorId(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, id: string): TrabalhoDto | undefined {
  return estado.trabalhoDetalhe[id]?.trabalho ?? trabalhosConhecidos(estado).find((t) => t.id === id) ?? Object.values(estado.conversas).flatMap((c) => c.trabalhos ?? []).find((t) => t.id === id);
}

/** Os trabalhos abertos de um bot, do mais antigo ao mais novo (a ordem da faixa). */
export function abertosDoBot(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, agenteId: string, conversaId?: string | null): TrabalhoDto[] {
  return trabalhosConhecidos(estado, conversaId)
    .filter((t) => t.agenteId === agenteId && aberto(t))
    .sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * O título para as listas (definido em 2026-10-09, pedido do Marlon): sem o parêntese técnico que o bot copia do sistema
 * de fora — "Orquestrar a etapa … no Linear (team 55113aca-122d-4…)" vira "Orquestrar a etapa … no Linear". Só sai o
 * parêntese com um id (8+ caracteres hexadecimais com algum dígito, inteiro ou cortado em "…"); o título inteiro continua
 * no `title` da linha e na tela da task.
 */
export function tituloCurto(titulo: string): string {
  const limpo = titulo.replace(/\s*\((?=[^()]*?(?<![0-9a-z])(?=[a-z]*\d)[0-9a-f]{8,})[^()]*(?:\)|$)/gi, "").trim();
  return limpo || titulo;
}

/** A etiqueta de origem ("de você", "rotina", "pedido do Chico"): a mesma na faixa, na gaveta e em "Todos os trabalhos". */
export function etiquetaOrigem(t: Pick<TrabalhoDto, "origem" | "pedidoPorNome">): string {
  if (t.origem === "rotina") return "rotina";
  if (t.origem === "colega") return `pedido do ${t.pedidoPorNome ?? "colega"}`;
  return "de você";
}

/** O instante em que o trabalho começou a contar tempo: o início do primeiro turno, ou a criação. */
export const inicioDe = (t: Pick<TrabalhoDto, "iniciadoEm" | "criadoEm">): number => t.iniciadoEm ?? t.criadoEm;

/** "26 min" rodando; terminado, a duração inteira (do início ao fim). */
export function tempoDe(t: Pick<TrabalhoDto, "iniciadoEm" | "criadoEm" | "terminadoEm">, agora: number): string {
  return duracaoCurta((t.terminadoEm ?? agora) - inicioDe(t));
}

/**
 * definido em 2026-10-08 (protótipo "Nod — tempo da task", aprovado): a task rodando sem turno vivo e com pedido a colega
 * em aberto está ESPERANDO esse colega, não trabalhando. A frase base é "esperando X" (combinada com o protótipo do Ritmo).
 */
export function esperandoColega(t: Pick<TrabalhoDto, "estado" | "turnoVivoId" | "esperandoColega">): NonNullable<TrabalhoDto["esperandoColega"]> | null {
  return t.estado === "rodando" && !t.turnoVivoId && t.esperandoColega ? t.esperandoColega : null;
}

/**
 * definido em 2026-10-08 (ADR-086): o bot combinou de voltar a uma hora ("me chame às 16:00") e saiu do Mac até lá —
 * rodando, sem turno vivo, com a volta por vir.
 */
export function voltaMarcada(t: Pick<TrabalhoDto, "estado" | "turnoVivoId" | "acordaEm">): number | null {
  return t.estado === "rodando" && !t.turnoVivoId && t.acordaEm ? t.acordaEm : null;
}

/**
 * ADR-086 (revisão do #212): "às 16:05" hoje, "amanhã às 09:00" no dia seguinte, "em 12/10 às 09:00" depois — a volta
 * pode cair até 24 h à frente, e "volta às 09:00" de amanhã lia como hoje.
 */
export function quandoVolta(instante: number, agora: number): string {
  const dia = (t: number) => new Date(t).toDateString();
  if (dia(instante) === dia(agora)) return `às ${hora(instante)}`;
  if (dia(instante) === dia(agora + 86_400_000)) return `amanhã às ${hora(instante)}`;
  const d = new Date(instante);
  return `em ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} às ${hora(instante)}`;
}

/**
 * ADR-086: a task espera sem nada dela no Mac — um colega ou a hora marcada. Volta sozinha. definido em 2026-10-12
 * (ADR-099, parte 1, "esperar não é trabalhar"): é também a regra do grupo **Esperando** — quem só espera não conta como
 * trabalhando. Espelha `esperaDoTrabalho` (src/domain/trabalho.ts); tests/unit/web/trabalhos.test.ts confere as duas.
 */
export function foraDoMac(t: Pick<TrabalhoDto, "estado" | "turnoVivoId" | "esperandoColega" | "acordaEm"> & Partial<Pick<TrabalhoDto, "esperandoComando">>): boolean {
  return esperandoColega(t) !== null || esperandoComando(t) !== null || voltaMarcada(t) !== null;
}

/**
 * NOD-260 (definido em 2026-10-15, G8/G12): a máquina do trabalho não fala com o servidor há mais de 60 s (a regra do
 * chip) — o servidor manda `maquina.semContatoDesde`. Despachando, o turno não anda: é espera, não trabalho (vai ao grupo
 * Esperando); na fila, ele espera a máquina voltar. Sem atalho para rodar em outra (decisão do NOD-260).
 */
export function esperandoMaquina(t: Pick<TrabalhoDto, "estado"> & Partial<Pick<TrabalhoDto, "maquina">>): { nome: string; desde: number } | null {
  if (t.estado !== "rodando" && t.estado !== "na_fila") return null;
  const desde = t.maquina?.semContatoDesde;
  return t.maquina && desde !== null && desde !== undefined ? { nome: t.maquina.nome, desde } : null;
}

/**
 * Revisão do Gil no #336 (bloqueante 1): a regra única de "só espera" — um colega, um comando, a hora marcada
 * (`foraDoMac`) ou a máquina sem contato (`esperandoMaquina`). Quem espera não pulsa nem diz "trabalhando" em lugar
 * nenhum: ponto, chip da barra, pílula, topo da task e passo ao vivo leem daqui.
 */
export function emEspera(t: Pick<TrabalhoDto, "estado" | "turnoVivoId" | "esperandoColega" | "acordaEm"> & Partial<Pick<TrabalhoDto, "esperandoComando" | "maquina">>): boolean {
  return foraDoMac(t) || esperandoMaquina(t) !== null;
}

/**
 * Desde quando a máquina está sem contato (revisão do Gil no #336): "14:32" hoje, "ontem 14:32", "14/10 14:32" antes —
 * a convenção de `quandoCurto`, sem o "hoje", no fuso da máquina da pessoa (o mesmo de `hora`).
 */
export function desdeCurto(desde: number, agora: number): string {
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return quandoCurto(desde, agora, fuso).replace(/^hoje /, "");
}

/** O `title` do passo "esperando <máquina> · sem contato": o texto inteiro (o passo corta) e o que fazer. */
export function dicaSemContato(t: Pick<TrabalhoDto, "estado"> & Partial<Pick<TrabalhoDto, "maquina">>, agora: number): string {
  const m = esperandoMaquina(t);
  if (!m) return "";
  return `${m.nome} não responde desde ${desdeCurto(m.desde, agora)}. O trabalho segue sozinho quando ela voltar; para rodar em outra máquina desta vez, abra a conversa do bot.`;
}

/**
 * definido em 2026-10-12 (ADR-099, parte 5): a frente deixou um comando rodando (`esperar_comando`, "a CI do #845") e saiu
 * do Mac até ele acabar — rodando, sem turno vivo. Esperar não é trabalhar: conta como Esperando em todo lugar.
 */
export function esperandoComando(t: Pick<TrabalhoDto, "estado" | "turnoVivoId"> & Partial<Pick<TrabalhoDto, "esperandoComando">>): { motivo: string; desde: number } | null {
  return t.estado === "rodando" && !t.turnoVivoId && t.esperandoComando ? t.esperandoComando : null;
}

/** O tempo da task: aberta há (do começo até agora ou o fim), quanto os turnos trabalharam e o resto, que é espera. */
export function temposDaTask(t: Pick<TrabalhoDto, "iniciadoEm" | "criadoEm" | "terminadoEm" | "trabalhouMs">, agora: number): { abertaMs: number; trabalhouMs: number; esperouMs: number } {
  const abertaMs = Math.max(0, (t.terminadoEm ?? agora) - inicioDe(t));
  const trabalhouMs = Math.min(abertaMs, Math.max(0, t.trabalhouMs ?? 0));
  return { abertaMs, trabalhouMs, esperouMs: abertaMs - trabalhouMs };
}

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): a task parada esperando a cota renovar (a retomada marcada pelo servidor,
 * src/domain/espera-da-cota.ts). Só aberta e com a volta ainda no futuro — passada a hora, a linha volta ao de sempre.
 */
export function esperaDaContaDe(t: Pick<TrabalhoDto, "estado"> & Partial<Pick<TrabalhoDto, "esperaDaConta">>, agora: number): EsperaDaConta | null {
  const e = t.esperaDaConta ?? null;
  return e && aberto(t) && e.voltaEm > agora ? e : null;
}

/**
 * definido em 2026-10-15 (NOD-277): "esperando a cota do Claude · volta às 14:00"; com a conta conhecida, "esperando a conta
 * 2 · volta às 14:00" (apelido padrão "Conta 2") ou "esperando a conta Trabalho · volta às 14:00" (apelido dado pela pessoa).
 * O texto mora aqui, como o resto da linha: a web não importa o `redigir` do servidor (só `import type` de src/).
 */
export function textoDaEsperaDaConta(e: EsperaDaConta, agora: number): string {
  const apelido = e.conta?.apelido.trim() ?? "";
  const quem = !apelido ? `a cota do ${e.iaNome}` : /^conta\s/i.test(apelido) ? `a conta ${apelido.replace(/^conta\s+/i, "")}` : `a conta ${apelido}`;
  return `esperando ${quem} · volta ${quandoVolta(e.voltaEm, agora)}`;
}

/**
 * O que o trabalho está fazendo, em poucas palavras: o último passo, quem segura o computador, quem ele espera, ou o
 * estado. Sem o tempo (quem desenha junta o tempo quando cabe).
 */
export function situacaoDe(t: TrabalhoDto, todos: readonly TrabalhoDto[] = [], segurando = false, agora = Date.now()): string {
  if (t.esperandoComputadorDe) return `esperando o computador (em uso por: ${t.esperandoComputadorDe})`;
  const colega = esperandoColega(t);
  // definido em 2026-10-16 (NOD-274, C10): a cota da IA do colega acabou — diz qual e quando ele volta, com o dia
  // (`quandoVolta`: "às 14:00", "amanhã às 14:00", "em 18/10 às 14:00"; revisão do Gil no #340).
  if (colega) return colega.cota ? `esperando ${colega.nome} · ${cotaDaIa(colega.cota.ia)} acabou, volta ${quandoVolta(colega.cota.voltaEm, agora)}` : `esperando ${colega.nome}`;
  const daConta = esperaDaContaDe(t, agora);
  if (daConta) return textoDaEsperaDaConta(daConta, agora);
  // definido em 2026-10-12 (ADR-099 §7): a cota da IA segura a task (o servidor decide, a mesma regra do `reivindicar`); a
  // hora da volta fica na pílula do topo.
  if (t.esperaDaCota) return "esperando a cota da IA";
  const comando = esperandoComando(t);
  if (comando) return `esperando ${comando.motivo}`;
  const semContato = esperandoMaquina(t);
  if (semContato) return t.estado === "rodando" ? `esperando ${semContato.nome} · sem contato desde ${desdeCurto(semContato.desde, agora)}` : `esperando ${semContato.nome} · sem contato`;
  const volta = voltaMarcada(t);
  // Revisão do #224: a volta vencida que o Mac segura (o disco crítico, ou o segundo plano apertado) diz por quê, em vez de
  // "volta às 16:00" já passado. O servidor decide (`esperaDoMac`, a mesma regra do `reivindicar`).
  if (volta) return t.esperaDoMac ? textoDaEspera(t.esperaDoMac, t.maquina) : `volta ${quandoVolta(volta, agora)}`;
  switch (t.estado) {
    case "na_fila": {
      const antes = t.depoisDeTrabalhoId ? todos.find((x) => x.id === t.depoisDeTrabalhoId) : undefined;
      if (antes) return `começa depois da ${antes.titulo}`;
      return seguradoPeloMac(t, segurando) ? textoDaEspera(t.esperaDoMac, t.maquina) : "na fila";
    }
    case "precisa_de_voce":
      return t.ultimoPasso ?? "precisa de você";
    case "fechado_ocioso":
      return "esperando você · fechada para liberar memória";
    case "rodando":
      return t.ultimoPasso ?? "trabalhando";
    case "terminado":
      return "terminou";
    case "parado":
      return "você parou";
    case "falhou":
      return "não terminou";
  }
}

/**
 * O último passo da frente: a narração (ou a última ferramenta) do turno vivo dela, quando roda e o ao vivo chegou; senão
 * `situacaoDe` (o último passo do servidor, quem ela espera, o estado). A linha do dono (web/telas/linha-do-dono.ts) e o
 * progresso na fala (chat limpo, PR 7, web/telas/progresso-na-fala.ts) leem daqui.
 */
export function passoDaFrente(estado: Pick<Estado, "atividades" | "trabalhos" | "agora">, t: TrabalhoDto, todos: readonly TrabalhoDto[]): string {
  const a = t.turnoVivoId ? estado.atividades[t.conversaId]?.[t.turnoVivoId] : undefined;
  return a && t.estado === "rodando" ? linhaAtual(a) : situacaoDe(t, todos, estado.trabalhos?.segurando === true, estado.agora);
}

/**
 * ADR-085 (definido em 2026-10-08): a máquina do trabalho está apertada e ele é dos que esperam — rotina ou pedido de
 * colega que ainda não começou, sem ninguém esperando e dentro da espera máxima. O servidor decide (`esperaDoMac`, a
 * mesma regra do `reivindicar`, pelo portão da máquina do trabalho). Revisto em 2026-10-09 (a tela fala por máquina):
 * `segurando` só vale para o trabalho que veio sem `esperaDoMac` (o da conversa, ou servidor anterior): o "pior Mac"
 * seguraria o trabalho de uma máquina folgada.
 */
export function seguradoPeloMac(t: Pick<TrabalhoDto, "estado" | "seguravel" | "esperaDoMac">, segurando: boolean): boolean {
  if (t.estado !== "na_fila") return false;
  if ((t.esperaDoMac ?? null) !== null) return true;
  return segurando && t.seguravel === true && t.esperaDoMac === undefined;
}

/**
 * A espera na linha da task (definido em 2026-10-09, #219, com a frase base "esperando…" do #208): pela memória ou pelo
 * disco, o motivo; pelo processador (ou servidor anterior, sem motivo), "esperando o Mac aliviar". Revisto em 2026-10-09
 * (a tela fala por máquina): com a máquina que não é Mac, o nome dela ("esperando nod-motor-teste aliviar").
 */
export function textoDaEspera(motivo: MotivoEsperaMac | null | undefined, maquina?: Pick<MaquinaDoTrabalho, "nome" | "ehMac"> | null): string {
  if (maquina && !maquina.ehMac) {
    if (motivo === "memoria") return `esperando ${maquina.nome} liberar memória`;
    if (motivo === "disco") return `esperando espaço no disco em ${maquina.nome}`;
    return `esperando ${maquina.nome} aliviar`;
  }
  if (motivo === "memoria") return "esperando o Mac liberar memória";
  if (motivo === "disco") return "esperando espaço no disco";
  return "esperando o Mac aliviar";
}

/**
 * A tela fala por máquina (2026-10-09): o servidor novo manda cada máquina com a própria leitura. `undefined` = servidor
 * anterior, e quem chama usa os campos de topo (o pior).
 */
export function maquinasDe(dto: Pick<TrabalhosDto, "maquinas"> | null | undefined): readonly LeituraDeMaquinaDto[] | undefined {
  return dto?.maquinas;
}

/**
 * A leitura do Mac (Este Mac, a pílula de memória, o menu da conta): só das máquinas que são Mac, e com dois Macs a pior.
 * Servidor anterior: os campos de topo, como antes. null = nenhum Mac mandou leitura.
 */
export type LeituraDoMac = { pressao: NivelPressao | null; processador: NivelPressao | null; usoProcessador: number | null; cargaProcessador: number | null; fila: NivelPressao | null; memoriaBotsMb: number | null; disco: TrabalhosDto["disco"]; discoSuportado: boolean; motivoEspera: MotivoEsperaMac | null; seguraTudoNovo: boolean };

const GRAVIDADE: Record<NivelPressao, number> = { verde: 0, amarela: 1, vermelha: 2 };
const MOTIVOS: readonly MotivoEsperaMac[] = ["processador", "memoria", "disco"];

export function leituraDoMac(dto: TrabalhosDto | null | undefined): LeituraDoMac {
  const ms = maquinasDe(dto);
  if (ms === undefined) {
    return { pressao: dto?.pressao ?? null, processador: dto?.processador ?? null, usoProcessador: dto?.usoProcessador ?? null, cargaProcessador: dto?.cargaProcessador ?? null, fila: dto?.fila ?? null, memoriaBotsMb: dto?.memoriaTotalMb ?? null, disco: dto?.disco ?? null, discoSuportado: dto?.discoSuportado === true, motivoEspera: dto?.segurando ? (dto.motivoEspera ?? "processador") : null, seguraTudoNovo: dto?.seguraTudoNovo === true };
  }
  const macs = ms.filter((m) => m.ehMac);
  if (macs.length === 0) return { pressao: null, processador: null, usoProcessador: null, cargaProcessador: null, fila: null, memoriaBotsMb: null, disco: null, discoSuportado: false, motivoEspera: null, seguraTudoNovo: false };
  // Com dois Macs (raro), o que segura mais (tudo novo, depois o motivo mais grave) e, empatado, o de pior memória; a
  // memória dos bots é a soma.
  const peso = (m: LeituraDeMaquinaDto): number => (m.seguraTudoNovo ? 100 : 0) + (m.motivoEspera ? 10 + MOTIVOS.indexOf(m.motivoEspera) : 0) + GRAVIDADE[m.pressao];
  const pior = [...macs].sort((a, b) => peso(b) - peso(a))[0]!;
  return { pressao: pior.pressao, processador: pior.processador, usoProcessador: pior.usoProcessador, cargaProcessador: pior.cargaProcessador, fila: pior.fila, memoriaBotsMb: macs.reduce((s, m) => s + m.memoriaBotsMb, 0), disco: pior.disco, discoSuportado: macs.some((m) => m.discoSuportado), motivoEspera: pior.motivoEspera, seguraTudoNovo: pior.seguraTudoNovo };
}

/** O trabalho roda (ou vai rodar) num Mac: sem máquina conhecida também conta (servidor anterior, ou qualquer uma). */
export function noMac(t: Pick<TrabalhoDto, "maquina">): boolean {
  return !t.maquina || t.maquina.ehMac;
}

/**
 * NOD-372 (2026-10-26): os trabalhos que ocupam o Mac agora — `rodando`, fora de espera (colega, comando, hora marcada,
 * máquina sem contato) e numa máquina que é Mac. Diferente de `noMac`, a `maquina` null (na fila, qualquer uma) não conta:
 * ainda não roda em lugar nenhum. É o que decide e conta a pílula de memória do Mac.
 */
export function rodandoNoMac<T extends TrabalhoDto>(lista: readonly T[]): T[] {
  return lista.filter((t) => t.estado === "rodando" && !emEspera(t) && t.maquina?.ehMac === true);
}

/**
 * NOD-372 (revisão do PR #537): as máquinas que entram na pílula do topo depois da de memória. O Mac que segura por
 * memória sem nada rodando nele nem esperando por ele sai: sem ele, o "Seu Mac está ocupado" tomaria o lugar da pílula de
 * memória que sumiu, com tudo na VM. As outras máquinas e os outros motivos do Mac seguem como antes.
 */
export function maquinasDoAviso(maquinas: readonly LeituraDeMaquinaDto[], trabalhos: readonly TrabalhoDto[]): LeituraDeMaquinaDto[] {
  const rodando = rodandoNoMac(trabalhos);
  return maquinas.filter((m) => {
    if (!m.ehMac || m.motivoEspera !== "memoria") return true;
    const daqui = (t: TrabalhoDto): boolean => !t.maquina || t.maquina.id === m.id;
    return rodando.some(daqui) || trabalhos.some((t) => seguradoPeloMac(t, false) && daqui(t));
  });
}

/**
 * A pílula por máquina (2026-10-09, a tela fala por máquina): quem segura trabalho novo agora, pelo nome.
 * - Só o Mac: "Seu Mac está ocupado" (ou o disco), como antes, com o "Ver" para Este Mac.
 * - Só uma outra máquina: "nod-motor-teste está ocupada · 4 trabalhos esperam ela aliviar", com o "Ver" para Máquinas.
 * - Duas ou mais: "2 máquinas ocupadas · 5 trabalhos esperam", com o "Ver" para Máquinas.
 * `trabalhos` são os da tela (a contagem é dos que esperam aquela máquina). Nenhuma segurando: nada.
 */
export function pilulaDasMaquinas(maquinas: readonly LeituraDeMaquinaDto[], trabalhos: readonly TrabalhoDto[], comVer = true): string {
  const segurando = maquinas.filter((m) => m.motivoEspera !== null);
  if (segurando.length === 0) return "";
  const esperam = trabalhos.filter((t) => seguradoPeloMac(t, false));
  if (segurando.length === 1) {
    const m = segurando[0]!;
    const daqui = esperam.filter((t) => !t.maquina || t.maquina.id === m.id).length;
    if (m.ehMac) return pilulaMac(true, daqui, comVer, m.motivoEspera);
    const disco = m.motivoEspera === "disco";
    const oQue = disco ? "espaço no disco" : m.motivoEspera === "memoria" ? "ela liberar memória" : "ela aliviar";
    const titulo = disco ? `Pouco espaço no disco em ${m.nome}` : m.motivoEspera === "memoria" ? `${m.nome} está com pouca memória` : `${m.nome} está ocupada`;
    const n = daqui > 0 ? `${daqui} ${daqui === 1 ? "trabalho espera" : "trabalhos esperam"} ${oQue}` : `trabalho novo espera ${oQue}`;
    return pilula(titulo, n, comVer ? "maquinas" : null);
  }
  const n = esperam.length > 0 ? `${esperam.length} ${esperam.length === 1 ? "trabalho espera" : "trabalhos esperam"}` : "trabalho novo espera";
  return pilula(`${segurando.length} máquinas ocupadas`, n, comVer ? "maquinas" : null);
}

function pilula(titulo: string, detalhe: string, secao: string | null): string {
  const miolo = `${ICONE_MEMORIA}<b>${esc(titulo)}</b><span class="pm-detalhe">· ${esc(detalhe)}</span>`;
  return secao
    ? `<div class="linha-centro-wrap" role="status"><button type="button" class="pilula-memoria amarela" data-act="secao-espaco" data-secao="${secao}">${miolo}<span class="pm-ver">Ver ›</span></button></div>`
    : `<div class="linha-centro-wrap" role="status"><span class="pilula-memoria amarela">${miolo}</span></div>`;
}

/**
 * "os bots usam 0,4 GB do seu Mac e 0,7 GB na nod-motor-teste": a memória dos processos dos bots em cada máquina, só as
 * que têm (sem leitura útil, nada). Servidor anterior: o total, "do seu Mac", como antes.
 */
export function memoriaDosBots(dto: Pick<TrabalhosDto, "maquinas" | "memoriaTotalMb"> | null | undefined): string {
  const ms = maquinasDe(dto);
  if (ms === undefined) {
    const total = dto?.memoriaTotalMb ?? null;
    return total !== null && total > 0 ? `os bots usam ${memoriaLegivel(total)} do seu Mac` : "";
  }
  // O Mac primeiro (é onde a pessoa está), depois as outras na ordem do servidor.
  const partes = [...ms.filter((m) => m.ehMac), ...ms.filter((m) => !m.ehMac)].filter((m) => m.memoriaBotsMb > 0).map((m) => (m.ehMac ? `${memoriaLegivel(m.memoriaBotsMb)} do seu Mac` : `${memoriaLegivel(m.memoriaBotsMb)} na ${m.nome}`));
  return partes.length ? `os bots usam ${juntar(partes)}` : "";
}

/**
 * A pílula "Seu Mac está ocupado" (ADR-085): o Mac passou do que a pessoa escolheu em Este Mac e trabalho novo em
 * segundo plano espera. Mesma forma da pílula de memória (#196), com o "Ver" levando a Este Mac. A de memória, quando
 * existe, já diz o mesmo: esta não entra junto.
 */
export function pilulaMac(segurando: boolean, esperando: number, comVer = true, motivo: MotivoEsperaMac | null = null): string {
  if (!segurando) return "";
  // #219: com o disco quase cheio, a pílula diz o disco (é o que pede a mão da pessoa; o "Ver" leva a Este Mac).
  const disco = motivo === "disco";
  const oQue = disco ? "espaço no disco" : "o Mac aliviar";
  const n = esperando > 0 ? `<span class="pm-detalhe">· ${esperando} ${esperando === 1 ? "trabalho espera" : "trabalhos esperam"} ${oQue}</span>` : `<span class="pm-detalhe">· trabalho novo espera ${oQue}</span>`;
  const miolo = `${ICONE_MEMORIA}<b>${disco ? "Pouco espaço no disco" : "Seu Mac está ocupado"}</b>${n}`;
  return comVer
    ? `<div class="linha-centro-wrap" role="status"><button type="button" class="pilula-memoria amarela" data-act="secao-espaco" data-secao="este-mac">${miolo}<span class="pm-ver">Ver ›</span></button></div>`
    : `<div class="linha-centro-wrap" role="status"><span class="pilula-memoria amarela">${miolo}</span></div>`;
}

/**
 * A pílula da cota da IA (definido em 2026-10-12, ADR-099 §7): com a IA na reserva de 1% ou no limite, o trabalho de fundo
 * espera e a conversa com a pessoa segue. Diz quando ele volta (a renovação da janela que segura) e quantas tasks esperam.
 * Sem "Ver": não há o que a pessoa ajuste; o uso da IA está em Seu espaço › Provedores de IA. Nada segurando (ou servidor anterior): nada.
 */
export function pilulaDaCota(cota: TrabalhosDto["cota"], trabalhos: readonly TrabalhoDto[], agora: number, pedidosNaFila: TrabalhosDto["pedidosNaFila"] = []): string {
  if (!cota) return "";
  const titulo = cota.situacao === "limite" ? "A cota da IA acabou" : "A cota da IA está no fim";
  const volta = cota.voltaEm ? `trabalho de fundo volta ${quandoVolta(cota.voltaEm, agora)}` : "trabalho de fundo volta quando ela renovar";
  // NOD-302: o pedido de colega sem task que a cota segura também espera.
  const esperam = trabalhos.filter((t) => t.esperaDaCota === true).length + (pedidosNaFila?.length ?? 0);
  return pilula(titulo, `${esperam > 0 ? `${esperam} ${esperam === 1 ? "espera" : "esperam"} · ` : ""}${volta} · a conversa com você segue`, null);
}

/** "620 MB", "1,4 GB". */
export function memoriaLegivel(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
}

/** A meia-noite do dia de `agora` no relógio da pessoa: "Terminados hoje" vale a partir dela. */
export function meiaNoiteDe(agora: number): number {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type GruposTrabalhos = { precisa: TrabalhoDto[]; trabalhando: TrabalhoDto[]; esperando: TrabalhoDto[]; fila: TrabalhoDto[]; terminados: TrabalhoDto[] };

/** Os que mais usam memória primeiro; sem leitura, depois deles, do mais novo ao mais antigo. */
const porMemoria = (a: TrabalhoDto, b: TrabalhoDto): number => (b.memoriaMb ?? -1) - (a.memoriaMb ?? -1) || b.criadoEm - a.criadoEm;

/** A volta mais cedo primeiro (é a próxima a acordar); esperando colega, depois, do pedido mais antigo ao mais novo. */
const porVolta = (a: TrabalhoDto, b: TrabalhoDto): number => (a.acordaEm ?? Infinity) - (b.acordaEm ?? Infinity) || (a.esperandoColega?.desde ?? a.criadoEm) - (b.esperandoColega?.desde ?? b.criadoEm);

/**
 * Os grupos da gaveta e de "Todos os trabalhos" (#196): Precisa de você (esperando a pessoa, aberto ou fechado para
 * liberar memória), Trabalhando, Esperando, Na fila e Terminados hoje — o que terminou (ou parou, ou falhou) antes da
 * meia-noite sai. definido em 2026-10-12 (ADR-099, parte 1): Esperando separa de Trabalhando quem está `rodando` sem
 * turno vivo só esperando a volta marcada ou um colega (`foraDoMac`). Em 11/10 a tela dizia "Trabalhando · 13" com um
 * trabalhando de fato: onze voltas marcadas e duas esperas de colega.
 */
export function agrupar(lista: readonly TrabalhoDto[], agora: number): GruposTrabalhos {
  const hoje = meiaNoiteDe(agora);
  const precisa = lista.filter((t) => t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso").sort(porMemoria);
  // NOD-260 (G8): o despachado para máquina sem contato espera, não trabalha.
  const esperaMaquina = (t: TrabalhoDto) => t.estado === "rodando" && esperandoMaquina(t) !== null;
  const trabalhando = lista.filter((t) => t.estado === "rodando" && !emEspera(t)).sort(porMemoria);
  const esperando = lista.filter((t) => foraDoMac(t) || esperaMaquina(t)).sort(porVolta);
  const fila = lista.filter((t) => t.estado === "na_fila").sort((a, b) => a.criadoEm - b.criadoEm);
  const terminados = lista
    .filter((t) => !aberto(t) && (t.terminadoEm ?? t.criadoEm) >= hoje)
    .sort((a, b) => (b.terminadoEm ?? b.criadoEm) - (a.terminadoEm ?? a.criadoEm));
  return { precisa, trabalhando, esperando, fila, terminados };
}

export function filtrar(lista: readonly TrabalhoDto[], filtro: FiltroTrabalhos | undefined): TrabalhoDto[] {
  if (!filtro || filtro === "todos") return [...lista];
  if (filtro === "rotinas") return lista.filter((t) => t.origem === "rotina");
  if (filtro === "bots") return lista.filter((t) => t.origem === "colega");
  return lista.filter((t) => t.origem === "pessoa" || t.origem === "rede");
}

/** "A", "A e B", "A, B e C". */
export function juntar(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O Parar das tasks (a pílula das frentes) pergunta antes (#195): "Parar a task Migrar relatórios?" ou "Parar as 3 tasks do
 * Dev 1?". revisto em 2026-10-22 (NOD-311): o Parar do chat não para mais as tasks e não usa estas listas. definido em 2026-10-08 (QA do épico): com várias tasks, os títulos iam todos no título do diálogo — quatro
 * títulos reais viravam um parágrafo em letra de título; agora vão numa lista no corpo (`listaPararTasks`).
 */
export function textoPararTasks(lista: readonly Pick<TrabalhoDto, "titulo">[], nomeDoBot = "bot"): string {
  if (lista.length === 1) return `Parar a task ${lista[0]?.titulo ?? ""}?`;
  return `Parar as ${lista.length} tasks do ${nomeDoBot}?`;
}

/** Os títulos das tasks que o Parar da pílula vai parar, um por linha (vazio com uma task só: o título já diz). */
export function listaPararTasks(lista: readonly Pick<TrabalhoDto, "titulo">[]): string {
  if (lista.length <= 1) return "";
  return `<ul class="parar-lista">${lista.map((t) => `<li>${esc(t.titulo)}</li>`).join("")}</ul>`;
}

/** O ponto do trabalho: na cor do bot (`c-*`), piscando enquanto roda; azul quando espera a pessoa; vazado na fila. */
export function pontoTrabalho(t: Pick<TrabalhoDto, "estado"> & Partial<Pick<TrabalhoDto, "turnoVivoId" | "esperandoColega" | "esperandoComando" | "acordaEm" | "maquina">>, cor: string | undefined): string {
  if (t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso") return '<span class="ponto-trabalho precisa" aria-hidden="true"></span>';
  // Esperando colega ou a hora marcada (ADR-086): ponto vazado âmbar, sem pulsar (protótipo "Nod — tempo da task").
  // revisto em 2026-10-09: a classe era `esperando`, que já é a caixa "Esperando você entrar no …" do cartão de acesso
  // (interface.css, `.esperando` com padding e fundo) — o ponto de 8 px virava um anel de ~30 px e empurrava a linha.
  // Revisão do Gil no #336: a máquina sem contato também é espera (`emEspera`) — sem pulso no grupo Esperando.
  if (emEspera({ estado: t.estado, turnoVivoId: t.turnoVivoId ?? null, esperandoColega: t.esperandoColega ?? null, esperandoComando: t.esperandoComando ?? null, acordaEm: t.acordaEm ?? null, maquina: t.maquina })) return '<span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span>';
  if (t.estado === "na_fila") return '<span class="ponto-trabalho na-fila" aria-hidden="true"></span>';
  // definido em 2026-10-08 (QA do épico): o ✓ é só de quem terminou; a task parada e a que falhou ganhavam o mesmo ✓
  // verde em "Terminados hoje" e no topo da tela da task, e liam como entregues.
  if (t.estado === "parado") return '<span class="ponto-trabalho feito parado" aria-hidden="true">■</span>';
  if (t.estado === "falhou") return '<span class="ponto-trabalho feito falhou" aria-hidden="true">!</span>';
  if (!aberto(t)) return '<span class="ponto-trabalho feito" aria-hidden="true">✓</span>';
  return `<span class="ponto-trabalho ${esc(cor ?? "")}${t.estado === "rodando" ? " pulso-trab" : ""}" aria-hidden="true"></span>`;
}

/**
 * A pílula da faixa recolhida (revisto em 2026-10-09: ela é o padrão da conversa com task aberta). O ponto diz o estado
 * que mais importa — precisa de você (azul) > trabalhando (cor do bot, pulsando) > esperando fora do Mac (vazado âmbar)
 * > na fila (vazado) — e o texto conta: "3 trabalhando", "2 esperando", com "· 1 precisa de você" quando há.
 */
export function resumoDaPilula(lista: readonly TrabalhoDto[]): { ponto: "precisa" | "trabalhando" | "fora-do-mac" | "na-fila"; texto: string; precisa: number } {
  const precisa = lista.filter((t) => t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso").length;
  const trabalhando = lista.filter((t) => t.estado === "rodando" && !emEspera(t)).length;
  const fora = lista.filter((t) => emEspera(t)).length;
  const ponto = precisa ? "precisa" : trabalhando ? "trabalhando" : fora ? "fora-do-mac" : "na-fila";
  return { ponto, texto: trabalhando ? "trabalhando" : precisa === lista.length ? (precisa === 1 ? "precisa de você" : "precisam de você") : "esperando", precisa };
}

/** O chip de memória das pranchas M1–M3: traço na cor do texto da pílula (currentColor), sem cor própria. */
const ICONE_MEMORIA = '<svg class="pm-icone" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"></rect><path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2"></path></svg>';

/**
 * O que a pílula de memória conta: "rodando" (NOD-372, com as máquinas no DTO: os trabalhos rodando no Mac, "N rodando
 * aqui") ou "abertos" (o servidor anterior, sem `maquinas`: todos os abertos, como antes).
 */
export type RotuloMemoria = "rodando" | "abertos";

export function textoDaContagemDeMemoria(n: number, rotulo: RotuloMemoria): string {
  return rotulo === "rodando" ? `${n} rodando aqui` : `${n} ${n === 1 ? "trabalho aberto" : "trabalhos abertos"}`;
}

/**
 * A pílula de memória (#196): amarela "Pouca memória no seu Mac · N rodando aqui · Ver" e vermelha "Seu Mac está
 * quase sem memória · pode travar; N rodando aqui". NOD-372: só com trabalho rodando no Mac (`rodandoNoMac`).
 * Centralizada; o "Ver" abre "Todos os trabalhos". Verde ou sem leitura, nada.
 */
export function pilulaMemoria(nivel: NivelPressao | null, contagem: number, comVer = true, rotulo: RotuloMemoria = "rodando"): string {
  if (nivel !== "amarela" && nivel !== "vermelha") return "";
  // NOD-372: com as máquinas no DTO, a pílula conta e exige os trabalhos rodando no Mac; sem nenhum, nada.
  if (rotulo === "rodando" && contagem <= 0) return "";
  const n = textoDaContagemDeMemoria(contagem, rotulo);
  const miolo = nivel === "amarela"
    ? `<b>Pouca memória no seu Mac</b><span class="pm-detalhe">· ${n}</span>`
    : `<b>Seu Mac está quase sem memória</b><span class="pm-detalhe">· pode travar; ${n}</span>`;
  const papel = nivel === "vermelha" ? ' role="alert"' : ' role="status"';
  // definido em 2026-10-08 (QA × pranchas M1–M3): o chip de memória abre a pílula e o "Ver" leva a seta, como no protótipo.
  const comIcone = `${ICONE_MEMORIA}${miolo}`;
  return comVer
    ? `<div class="linha-centro-wrap"${papel}><button type="button" class="pilula-memoria ${nivel}" data-act="navegar" data-tela="trabalhos">${comIcone}<span class="pm-ver">Ver ›</span></button></div>`
    : `<div class="linha-centro-wrap"${papel}><span class="pilula-memoria ${nivel}">${comIcone}</span></div>`;
}

/**
 * A tela da task a partir da tela atual (#195): o Fechar volta para onde a pessoa estava. De dentro de outra task (ou de
 * uma linha), o `voltar` de fora continua — Fechar nunca vira uma pilha de tasks.
 */
export function telaDaTask(atual: Tela, id: string): Extract<Tela, { tipo: "trabalho" }> {
  return { tipo: "trabalho", id, voltar: atual.tipo === "trabalho" || atual.tipo === "linha" ? atual.voltar : atual };
}

/** Para onde o Fechar (ou o Esc) da tela da task e da tela provisória leva; null = não é uma delas. */
export function telaAoFechar(atual: Tela): Tela | null {
  return atual.tipo === "trabalho" || atual.tipo === "linha" ? atual.voltar : null;
}

/**
 * O pedido de colega sem task que a cota segura (definido em 2026-10-16, NOD-302, continuação da NOD-253): o servidor manda
 * à parte (`TrabalhosDto.pedidosNaFila`), e a fila do bot em Trabalhos o mostra "na fila (cota)" com a volta.
 */
export function naFilaDaCota(dto: Pick<TrabalhosDto, "pedidosNaFila"> | null | undefined, turnoId: string): NonNullable<TrabalhosDto["pedidosNaFila"]>[number] | undefined {
  return dto?.pedidosNaFila?.find((p) => p.turnoId === turnoId);
}

/** "na fila (cota) · volta às 14:00"; sem a hora, "na fila (cota) · volta quando a cota renovar". */
export function textoNaFilaDaCota(p: { voltaEm: number | null }, agora: number): string {
  return `na fila (cota) · volta ${p.voltaEm ? quandoVolta(p.voltaEm, agora) : "quando a cota renovar"}`;
}

/**
 * Os botões da task que a pessoa pediu (#195): "Fazer depois da <outra>" grava `depois_de_trabalho_id` (só quando há outra
 * task aberta do bot, mais antiga) e "Fazer aqui" cancela a task e manda o pedido como turno da conversa. Só enquanto a task
 * de origem `pessoa` ainda não terminou. Moravam na linha "Abriu a task" do chat; desde 2026-10-18 (chat limpo, PR 2;
 * ADR-114) a linha sai do chat e os botões ficam no topo da tela da task e na linha dela em Trabalhos (a linha do chat
 * continua com eles no servidor de antes).
 *
 * Como no chat de antes, só a task sozinha (ou a frente única do lote) leva os botões: a linha "Começou N frentes" nunca os
 * teve, e cada frente de um lote paralelo com "Fazer depois da <irmã>" e "Fazer aqui" enchia Trabalhos de botões que
 * desfazem o paralelo que o bot escolheu (QA do PR 2).
 */
export function acoesDeFazer(t: TrabalhoDto | undefined, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, conversaId: string | null | undefined): string {
  if (!t || t.origem !== "pessoa" || (t.estado !== "na_fila" && t.estado !== "rodando")) return "";
  if (t.loteId && trabalhosConhecidos(estado, conversaId).filter((x) => x.loteId === t.loteId).length > 1) return "";
  const outras = abertosDoBot(estado, t.agenteId, conversaId).filter((x) => x.id !== t.id && x.criadoEm < t.criadoEm);
  const antes = t.depoisDeTrabalhoId ? trabalhosConhecidos(estado, conversaId).find((x) => x.id === t.depoisDeTrabalhoId) : undefined;
  const depois = antes
    ? `<span class="linha-acao-nota">começa depois da ${esc(antes.titulo)}</span>`
    : outras.length
      ? botao("trabalho-depois", `Fazer depois da ${esc(outras[outras.length - 1]?.titulo ?? "")}`, { classe: "sm", id: t.id, dados: { depois: outras[outras.length - 1]?.id ?? "" } })
      : "";
  return `<div class="linha-acoes">${depois}${botao("trabalho-fazer-aqui", "Fazer aqui", { classe: "sm", id: t.id, titulo: "cancela a task e responde aqui na conversa" })}</div>`;
}
