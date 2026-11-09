import { novoEnderecoDaRotina } from "./endereco-webhook.ts";
import { randomUUID } from "node:crypto";
import { proximaDaRotina } from "../domain/rotina-texto.ts";
import type { Agente } from "../contracts/agente.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { nuncaPermanente } from "../domain/aprovacao-permanente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import { nomeDaCopia } from "../domain/nome-da-copia.ts";
import { ordemComCopia } from "../domain/ordem-barra.ts";
import { redigir } from "../domain/redacao.ts";
import { eventoDeRotina, textoRotinaAtiva } from "./apoio-l7.ts";
import { secaoComTime } from "./acoes/times.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { concederLote } from "./conceder.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Duplicate (Grok Bot): nome + ' (cópia)', título, descrição (a missão confirmada), dono, modelo e harness;
 * avatar preservado; conversa própria nova. Histórico e sessão do CLI nunca vêm: a cópia é outra conversa.
 *
 * definido em 2026-09-28 (emenda da ADR-034): a DONA duplicando o próprio bot leva o bot inteiro — memória,
 * acessos (concessões e "Sempre permitir" ativos) e rotinas no MESMO estado: ativa continua ativa. Cada acesso nasce com consentimento NOVO na conversa da cópia, pelo mesmo
 * caminho do "Dar acesso" (concederLote): o clique em Duplicar é o consentimento, e fica citável ali.
 * Bot de equipe duplicado por OUTRA pessoa segue o ADR-034 original: sem memória nem permissões, rotinas
 * pausadas — quem não deu o acesso não o herda.
 *
 * NOD-289 (auditoria de 15/10): a cópia da DONA vai para a mesma máquina do original (ADR-090) se a chave dela estiver
 * viva — revogada ou vencida, sem máquina; de outra pessoa, sem máquina. O nome é o primeiro livre entre "X (cópia)",
 * "X (cópia 2)"… (nome-da-copia.ts), e a pasta distinta sai junto. Pedida ao Nod (`rotinasPausadas`, gerir_bots, com ou
 * sem card), as rotinas da cópia vêm pausadas — sem caixa, ativas rodariam em dobro sem ninguém ver (o gatilho de
 * reversão da ADR-034) — e `rotinasPausadasNaCopia` diz quantas estavam ativas no original, para o aviso.
 *
 * revisto em 2026-10-20 (NOD-316, decisão do Marlon na NOD-231; emenda da ADR-059 §1): a cópia nasce em Aprovar
 * automaticamente (MODO_APROVACAO_INICIAL, gravado por agentes.criar) e NÃO herda o modo do original — nem Manual nem
 * Ignorar todas; a pessoa muda em Aprovações. O `exige_aprovacao` da rotina (campo morto, ninguém decide por ele) não é
 * copiado: vale o DEFAULT da coluna.
 */
export const duplicarAgente: CasoDeUso<{ agenteId: string; rotinasPausadas?: boolean }, { agente: Agente; conversa: Conversa; rotinasPausadasNaCopia: number }> = async (deps, input) => {
  const original = await deps.repos.agentes.buscar(input.agenteId);
  if (!original) throw new ErroDeDominio("nao_encontrado");
  // ADR-081: o Nod é um por pessoa; a cópia seria um bot comum se passando por ele.
  if (ehNod(original)) throw new ErroDeDominio("nod_protegido", { cause: "duplicar" });
  const dona = original.ownerId === deps.escopo.pessoaId;
  const existentes = (await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).map((a) => a.nome);
  const maquinaId = dona && original.maquinaId && (await chaveViva(deps, original.maquinaId)) ? original.maquinaId : null;

  const agente = await deps.repos.agentes.criar({
    nome: nomeDaCopia(original.nome, existentes, randomUUID()),
    titulo: original.titulo,
    descricao: original.descricao,
    dono: original.dono,
    forma: original.forma,
    cor: original.cor,
    modelo: original.modelo,
    harness: original.harness,
    // 0068: o modo, a ordem própria e o modelo e o raciocínio de cada IA vão junto.
    ...(original.inteligencia ? { inteligencia: original.inteligencia } : {}),
    duplicadoDe: original.id,
    confirmado: original.confirmado,
    maquinaId,
  });
  if (!agente) throw new ErroDeDominio("estado_invalido", { cause: "cópia não criada" });
  if (dona) await porLogoAbaixo(deps, original, agente.id);
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente.id, visibility: agente.visibility });
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "conversa não criada" });

  const autoria = autoriaPessoa(deps.escopo);
  const agora = deps.agora();
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: conversa.id, dados: { agente_id: agente.id, acao: "duplicado", duplicado_de: original.id } }),
  ];
  if (dona) {
    for (const m of await deps.repos.memorias.listarDoAgente(original.id)) {
      await deps.repos.memorias.criar({ agenteId: agente.id, tipo: m.tipo, texto: m.texto, origem: m.origem }, { diario: false });
    }
    events.push(...(await copiarConcessoes(deps, original.id, agente.id)));
    events.push(...(await copiarRegrasPermanentes(deps, original.id, agente.id, conversa.id)));
  }

  let rotinasPausadasNaCopia = 0;
  for (const r of await deps.repos.rotinas.listarDoAgente(original.id)) {
    // NOD-84: a rotina webhook da cópia ganha endereço e segredo PRÓPRIOS (o do original continua só dele). Sem a cifra
    // (modo local) não há endereço: a cópia nasce pausada.
    const webhook = r.gatilho === "webhook";
    const pausar = !dona || input.rotinasPausadas === true || (webhook && !deps.services.webhooks);
    if (pausar && r.estado === "ativa") rotinasPausadasNaCopia++;
    const rotina = await deps.repos.rotinas.criar({
      ...r,
      id: undefined,
      agenteId: agente.id,
      conversaId: conversa.id,
      estado: pausar ? "pausada" : r.estado,
      exigeAprovacao: undefined,
      proximaExecucao: proximaDaRotina(r, agora),
    });
    if (!rotina) throw new ErroDeDominio("estado_invalido", { cause: "rotina não copiada" });
    const cifra = deps.services.webhooks;
    if (webhook && cifra) await novoEnderecoDaRotina(deps, rotina.id, (t) => cifra.cifrar(t));
    // Ativa na cópia = a mesma frase de quando a pessoa confirma uma rotina: a conversa diz que ela já roda.
    if (rotina.estado === "ativa") {
      await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "sistema", texto: textoRotinaAtiva(rotina, agora), payload: eventoDeRotina(rotina, "criada"), confianca: "confiavel" });
    }
    events.push(evento(deps.escopo, { kind: "rotina_criada", autoria, agora, conversaId: conversa.id, dados: { rotinaId: rotina.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana } }));
  }
  return { data: { agente: (await deps.repos.agentes.buscar(agente.id)) ?? agente, conversa, rotinasPausadasNaCopia }, events };
};

/** A chave da máquina ainda vale? `listar()` já trata a vencida como revogada (ADR-102). */
async function chaveViva(deps: Deps, maquinaId: string): Promise<boolean> {
  return (await deps.repos.maquinaTokens.listar()).some((c) => c.id === maquinaId && c.revogadaEm === null);
}

/**
 * definido em 2026-10-06 (pedido do Marlon): a cópia entra no grupo do original (fixados ou a mesma seção) logo abaixo
 * dele. Antes nascia sem seção nem posição e caía no fim de "Meus agentes", e a pessoa arrastava de volta. A ordem
 * gravada é a do grupo inteiro, como no arrasto (0041).
 */
async function porLogoAbaixo(deps: Deps, original: Agente, copiaId: string): Promise<void> {
  if (original.secao) await deps.repos.agentes.organizar(copiaId, { secao: await secaoComTime(deps, original.secao) });
  if (original.fixado) await deps.repos.agentes.fixar(copiaId, true);
  const frota = await deps.repos.agentes.listar({ incluirOcultos: true });
  await deps.repos.agentes.ordenar(ordemComCopia(frota, original, copiaId));
}

/**
 * Uma chamada de concederLote por conector: a cópia ganha a mesma mensagem "Concedido por … em …" e os
 * mesmos eventos `concessao_criada` de um "Dar acesso". Capacidade que saiu do catálogo desde a concessão
 * original fica de fora — concederLote recusaria o lote inteiro, e ela não daria alcance a nada.
 */
async function copiarConcessoes(deps: Deps, de: string, para: string): Promise<RuntimeEvent[]> {
  const porConector = new Map<string, string[]>();
  for (const c of await deps.repos.concessoes.doAgente(de)) porConector.set(c.conectorId, [...(porConector.get(c.conectorId) ?? []), c.capacidade]);
  const events: RuntimeEvent[] = [];
  for (const [conectorId, capacidades] of porConector) {
    const conector = await deps.repos.conectores.buscar(conectorId);
    const vigentes = capacidades.filter((cap) => conector?.catalogo.some((f) => f.nome === cap));
    if (!conector || vigentes.length === 0) continue;
    events.push(...((await concederLote(deps, { agenteId: para, conectorId, capacidades: vigentes })).events ?? []));
  }
  return events;
}

/**
 * "Sempre permitir" ativos (ADR-042): mesma capacidade, mesmo item de origem (o que a pessoa estava vendo
 * quando decidiu) e UMA mensagem de consentimento nova na conversa da cópia, como em permitir-sempre.ts.
 * Regra que hoje não poderia nascer (`nuncaPermanente`, ADR-047) não é propagada.
 */
async function copiarRegrasPermanentes(deps: Deps, de: string, para: string, conversaId: string): Promise<RuntimeEvent[]> {
  const regras: { conectorId: string; capacidade: string; itemOrigemId: string; regraVersao: number; nome: string }[] = [];
  for (const p of await deps.repos.permissoesPermanentes.ativasDoAgente(de)) {
    const conector = await deps.repos.conectores.buscar(p.conectorId);
    if (!conector || nuncaPermanente(p.capacidade, conector.catalogo.find((f) => f.nome === p.capacidade)?.readOnlyHint)) continue;
    regras.push({ ...p, nome: `${conector.slug}.${p.capacidade}` });
  }
  if (regras.length === 0) return [];
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId,
    turnoId: null,
    kind: "consentimento",
    texto: redigir("permissao-permanente", deps.agora(), { pessoa: pessoa?.nome ?? "a pessoa", ferramentas: regras.map((r) => r.nome).join(", ") }),
    confianca: "confiavel",
    autoria,
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "consentimento não gravado" });
  let criadas = 0;
  for (const r of regras) {
    const p = await deps.repos.permissoesPermanentes.criar({ agenteId: para, conectorId: r.conectorId, capacidade: r.capacidade, itemOrigemId: r.itemOrigemId, mensagemId: mensagem.id, regraVersao: r.regraVersao });
    if (p) criadas++;
  }
  return [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: mensagem.id, kind: "consentimento", regras: criadas } })];
}
