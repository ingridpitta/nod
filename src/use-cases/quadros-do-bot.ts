import type { AutorLote, OpQuadro, Quadro } from "../contracts/quadro.ts";
import { LIMITES_QUADROS, type OpQuadrosDoBot, type Projeto, type ProjetoDto, type QuadroDoBotDto, type QuadrosDoBotDto } from "../contracts/quadros-do-bot.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Agente } from "../contracts/agente.ts";
import { colunasDe } from "../domain/colunas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { chaveDeBusca, progresso } from "../domain/quadro.ts";
import { acharPorNome, chaveDoNome, nomeDoQuadro, progressoDoProjeto, proximoDono, quadroAoAbrir, separarBotEQuadro, validarNomeProjeto } from "../domain/quadros-do-bot.ts";
import { ehUuid } from "./apoio-l7.ts";
import { agentesDaPessoa, eventoQuadro, experimentoLigado, type FalhaQuadro } from "./quadro.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * ADA-14 (ADR-153): os N quadros de um bot, o quadro em mais de um bot e os projetos. O lote de UM quadro segue no
 * aplicarLoteQuadro (src/use-cases/quadro.ts); aqui moram o que escolhe o quadro (pelo nome, "Bot/Quadro", o do criar) e as
 * ops que não são lote de um quadro (listar, abrir, padrão, vincular, projetos). Sem Desfazer de lote: o inverso é a op
 * contrária (vincular × desvincular, arquivar × restaurar), como diz o plano (S7).
 */

type Falha = { erro: FalhaQuadro; detalhe: string };
const recusa = (erro: FalhaQuadro, detalhe: string): Falha => ({ erro, detalhe });
const ehFalha = (v: unknown): v is Falha => typeof v === "object" && v !== null && "erro" in v && "detalhe" in v;

const botPeloNome = (ref: string, agentes: readonly Agente[]): Agente | null => {
  const r = ref.trim().replace(/^@/, "");
  if (ehUuid(r)) return agentes.find((a) => a.id === r.toLowerCase()) ?? null;
  const achados = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  return achados.length === 1 ? achados[0]! : null;
};

/** O nome que o bot e a pessoa leem: "Ana / Site" (o sem nome sai "Tarefas"). */
export const rotuloDoQuadro = (q: Pick<Quadro, "nome" | "agenteId">, agentes: readonly Agente[]): string => `${agentes.find((a) => a.id === q.agenteId)?.nome ?? "?"} / ${nomeDoQuadro(q)}`;

/**
 * O quadro pelo nome (ou prefixo): "Bot/Quadro" primeiro; depois os quadros do bot `preferido` (o da tela ou o autor);
 * depois todos os da pessoa. null = nenhum; ambíguo = o mesmo nome em mais de um (o bot pergunta com "Bot / Quadro").
 */
export async function quadroPeloNome(deps: Deps, ref: string, agentes: readonly Agente[], preferido?: string | null): Promise<Quadro | { ambiguo: Quadro[] } | null> {
  const repo = deps.repos.quadros;
  const sep = separarBotEQuadro(ref);
  if (sep) {
    const bot = botPeloNome(sep.bot, agentes);
    if (bot) {
      const a = acharPorNome(sep.quadro, await repo.vinculadosAo(bot.id));
      if (a) return "um" in a ? a.um : { ambiguo: a.varios };
    }
  }
  if (preferido) {
    const a = acharPorNome(ref, await repo.vinculadosAo(preferido));
    if (a && "um" in a) return a.um;
  }
  const a = acharPorNome(ref, await repo.listar());
  if (!a) return null;
  return "um" in a ? a.um : { ambiguo: a.varios };
}

/** O projeto do criar/editar: id ou nome de um ativo; null = solto; undefined = não mexe. */
export async function resolverProjeto(deps: Deps, ref: string | null | undefined): Promise<{ projetoId: string | null | undefined } | Falha> {
  if (ref === undefined) return { projetoId: undefined };
  if (ref === null || ref.trim() === "") return { projetoId: null };
  const ativos = (await deps.repos.projetos.listar()).filter((p) => p.arquivadoEm === null);
  const r = ref.trim();
  const p = ehUuid(r) ? ativos.find((x) => x.id === r.toLowerCase()) : ativos.find((x) => chaveDoNome(x.nome) === chaveDoNome(r));
  if (p) return { projetoId: p.id };
  const nomes = ativos.map((x) => x.nome).slice(0, 10);
  return recusa("nao_encontrado", `não há um projeto "${r}"${nomes.length ? `. Os projetos: ${nomes.join(", ")}` : ". A pessoa ainda não tem projeto: crie com criar_projeto"}`);
}

/**
 * O criar_quadro num bot (já com a trava do bot na mão): sem quadro, cria; com `nome` que ainda não existe no bot, cria
 * outro (só com a flag NOD_QUADROS_N e dentro dos tetos); sem `nome`, o de sempre (o quadro da tela, ou o padrão: o lote
 * diz "use editar_quadro"). O nome repetido no mesmo bot recusa (diz qual editar).
 */
export async function quadroDoCriar(deps: Deps, anfitriao: string, op: Extract<OpQuadro, { tipo: "criar_quadro" }>, quadroDaTela?: string): Promise<{ quadro: Quadro | null; nome: string | null; projetoId: string | null } | Falha> {
  const repo = deps.repos.quadros;
  const proj = await resolverProjeto(deps, op.projeto);
  if (ehFalha(proj)) return proj;
  const projetoId = proj.projetoId ?? null;
  const nome = op.nome ?? null;
  const vinculados = await repo.vinculadosAo(anfitriao);
  if (vinculados.length === 0) return { quadro: null, nome, projetoId };
  if (op.nome === undefined) return { quadro: (quadroDaTela ? vinculados.find((q) => q.id === quadroDaTela) : undefined) ?? vinculados[0]!, nome, projetoId };
  const igual = vinculados.find((q) => chaveDoNome(nomeDoQuadro(q)) === chaveDoNome(nomeDoQuadro({ nome })));
  if (igual) return recusa("entrada_invalida", `este bot já tem o quadro "${nomeDoQuadro(igual)}": para mudar a meta ou o prazo, editar_quadro com quadro "${nomeDoQuadro(igual)}"; para outro quadro, criar_quadro com outro nome`);
  if (!(await deps.repos.preferencias.quadrosNLiberado())) return recusa("nao_permitido", "este servidor ainda deixa um quadro só por bot (a flag NOD_QUADROS_N está desligada): use editar_quadro no quadro que já existe");
  if (vinculados.length >= LIMITES_QUADROS.quadrosPorBot) return recusa("entrada_invalida", `o bot já tem ${LIMITES_QUADROS.quadrosPorBot} quadros (o teto): arquive ou remova um antes`);
  if ((await repo.contar()) >= LIMITES_QUADROS.quadrosPorPessoa) return recusa("entrada_invalida", `a pessoa já tem ${LIMITES_QUADROS.quadrosPorPessoa} quadros (o teto)`);
  return { quadro: null, nome, projetoId };
}

/**
 * O nome e o projeto que o editar_quadro do lote pede (validados antes do lote; aplicados depois que ele passou). null =
 * o lote não mexe neles. O nome não repete entre os quadros do mesmo bot.
 */
export async function renomeDoLote(deps: Deps, q: Quadro, ops: readonly OpQuadro[]): Promise<{ nome?: string | null; projetoId?: string | null } | null | Falha> {
  let nome: string | null | undefined;
  let projeto: string | null | undefined;
  for (const op of ops) {
    if (op.tipo !== "editar_quadro") continue;
    if (op.nome !== undefined) nome = op.nome;
    if (op.projeto !== undefined) projeto = op.projeto;
  }
  if (nome === undefined && projeto === undefined) return null;
  const r: { nome?: string | null; projetoId?: string | null } = {};
  if (nome !== undefined) {
    const chave = chaveDoNome(nomeDoQuadro({ nome }));
    const outros = (await deps.repos.quadros.vinculadosAo(q.agenteId)).filter((x) => x.id !== q.id);
    const igual = outros.find((x) => chaveDoNome(nomeDoQuadro(x)) === chave);
    if (igual) return recusa("entrada_invalida", `este bot já tem outro quadro "${nomeDoQuadro(igual)}": escolha outro nome`);
    r.nome = nome;
  }
  if (projeto !== undefined) {
    const p = await resolverProjeto(deps, projeto);
    if (ehFalha(p)) return p;
    r.projetoId = p.projetoId ?? null;
  }
  return r;
}

/** O seletor do app Quadro: os quadros do bot (com os bots de cada um), os projetos e qual abre. */
export async function quadrosDoBot(deps: Deps, agenteId: string): Promise<QuadrosDoBotDto> {
  const repo = deps.repos.quadros;
  const [vinculados, projetos, agentes, aberto, podeCriar] = await Promise.all([repo.vinculadosAo(agenteId), deps.repos.projetos.listar(), agentesDaPessoa(deps), deps.repos.preferencias.quadroAberto(agenteId), deps.repos.preferencias.quadrosNLiberado()]);
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const quadros: QuadroDoBotDto[] = [];
  for (const q of vinculados) {
    const [tarefas, vinculos] = await Promise.all([repo.tarefas(q.id), repo.vinculos(q.id)]);
    const prog = progresso(tarefas, colunasDe(q));
    const ids = vinculos.length ? vinculos.map((v) => v.agenteId) : [q.agenteId];
    quadros.push({
      id: q.id, nome: nomeDoQuadro(q), nomeProprio: q.nome, prefixo: q.prefixo, projetoId: q.projetoId, padrao: q.padrao, meta: q.meta, prazo: q.prazo,
      abertas: prog.total - prog.feitas, feitas: prog.feitas, total: prog.total,
      bots: ids.filter((id) => nomes.has(id)).map((id) => ({ id, nome: nomes.get(id)!, dono: id === q.agenteId })),
    });
  }
  const dtoProjetos: ProjetoDto[] = projetos.map((p) => {
    const deles = quadros.filter((q) => q.projetoId === p.id);
    return { ...p, quadros: deles.length, progresso: progressoDoProjeto(deles) };
  });
  return { quadros, projetos: dtoProjetos, aberto: quadroAoAbrir(vinculados, aberto), padrao: vinculados.find((q) => q.padrao)?.id ?? null, podeCriarOutro: podeCriar && vinculados.length < LIMITES_QUADROS.quadrosPorBot };
}

/** GET /agentes/:id/quadros. */
export const verQuadrosDoBot: CasoDeUso<{ agenteId: string }, QuadrosDoBotDto> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  if (!(await deps.repos.agentes.buscar(input.agenteId))) throw new ErroDeDominio("nao_encontrado", { cause: "bot" });
  return { data: await quadrosDoBot(deps, input.agenteId) };
};

export type PedidoQuadrosDoBot = { autor: AutorLote; anfitriaoId?: string; conversaId?: string | null; turnoId?: string | null; op: OpQuadrosDoBot };
export type ResultadoQuadrosDoBot =
  | { ok: true; instrucao: string; quadros?: QuadrosDoBotDto; projeto?: Projeto; quadroId?: string; todos?: { id: string; rotulo: string; projeto: string | null }[] }
  | { ok: false; erro: FalhaQuadro; detalhe: string };

/** O quadro de uma op: id, nome do quadro, "Bot/Quadro" ou o prefixo (preferindo os do bot da conversa). */
async function quadroDaOp(deps: Deps, ref: string, agentes: readonly Agente[], preferido: string | null): Promise<Quadro | Falha> {
  const r = ref.trim();
  if (ehUuid(r)) {
    const q = await deps.repos.quadros.buscar(r.toLowerCase());
    return q ?? recusa("nao_encontrado", `quadro "${r}" não encontrado`);
  }
  const a = await quadroPeloNome(deps, r, agentes, preferido);
  if (!a) return recusa("nao_encontrado", `não há um quadro "${r}": liste com listar_quadros`);
  if ("ambiguo" in a) return recusa("sem_quadro", `"${r}" acha ${a.ambiguo.length} quadros: ${a.ambiguo.slice(0, 5).map((q) => `${rotuloDoQuadro(q, agentes)} (${q.id})`).join(", ")}. Diga qual como "Bot / Quadro" ou pelo id`);
  return a;
}

async function projetoDaOp(deps: Deps, ref: string): Promise<Projeto | Falha> {
  const r = ref.trim();
  const todos = await deps.repos.projetos.listar();
  const p = ehUuid(r) ? todos.find((x) => x.id === r.toLowerCase()) : todos.filter((x) => chaveDoNome(x.nome) === chaveDoNome(r)).sort((a, b) => (a.arquivadoEm === null ? -1 : 0) - (b.arquivadoEm === null ? -1 : 0))[0];
  return p ?? recusa("nao_encontrado", `não há um projeto "${r}"`);
}

const ok = (instrucao: string, extra: Omit<Extract<ResultadoQuadrosDoBot, { ok: true }>, "ok" | "instrucao"> = {}): { data: ResultadoQuadrosDoBot } => ({ data: { ok: true, instrucao, ...extra } });
const nao = (f: Falha): { data: ResultadoQuadrosDoBot } => ({ data: { ok: false, ...f } });

/**
 * As ops dos N quadros, pela tela e pelo gerir_quadro (o mesmo caminho: a paridade). O corte das que mexem no que a pessoa
 * organizou (OPS_QUADROS_DO_BOT_DA_PESSOA) é do gerir_quadro, antes de chegar aqui.
 */
export async function aplicarQuadrosDoBot(deps: Deps, p: PedidoQuadrosDoBot): Promise<{ data: ResultadoQuadrosDoBot; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return nao(recusa("experimento_desligado", "o quadro está desligado nos experimentos da pessoa"));
  const repo = deps.repos.quadros;
  const agentes = await agentesDaPessoa(deps);
  const anfitriao = p.anfitriaoId ?? (p.autor.tipo === "agente" ? p.autor.agenteId : null);
  const evento = (q: { id: string; agenteId: string }) => eventoQuadro(deps, p, q, null, []);
  const op = p.op;
  switch (op.tipo) {
    case "listar_quadros": {
      if (op.todos || !anfitriao) {
        const projetos = new Map((await deps.repos.projetos.listar()).map((x) => [x.id, x.nome]));
        const todos = (await repo.listar()).map((q) => ({ id: q.id, rotulo: rotuloDoQuadro(q, agentes), projeto: q.projetoId ? (projetos.get(q.projetoId) ?? null) : null }));
        return ok(`Só leitura: ${todos.length} quadro(s) da pessoa.`, { todos });
      }
      const quadros = await quadrosDoBot(deps, anfitriao);
      return ok(`Só leitura: ${quadros.quadros.length} quadro(s) neste bot.`, { quadros });
    }
    case "abrir_quadro": {
      if (!anfitriao) return nao(recusa("nao_encontrado", "abrir_quadro precisa do bot (a conversa ou a tela)"));
      const q = await quadroDaOp(deps, op.quadro, agentes, anfitriao);
      if (ehFalha(q)) return nao(q);
      if (!(await repo.doBot(anfitriao, q.id))) return nao(recusa("nao_encontrado", `o quadro "${nomeDoQuadro(q)}" não está neste bot: vincule com vincular_bot`));
      await deps.repos.preferencias.abrirQuadro(anfitriao, q.id);
      return ok(`O app Quadro deste bot abre agora em "${nomeDoQuadro(q)}".`, { quadroId: q.id });
    }
    case "definir_padrao": {
      const bot = op.bot ? botPeloNome(op.bot, agentes) : anfitriao ? (agentes.find((a) => a.id === anfitriao) ?? null) : null;
      if (!bot) return nao(recusa("nao_encontrado", `bot "${op.bot ?? ""}" não encontrado`));
      const q = await quadroDaOp(deps, op.quadro, agentes, bot.id);
      if (ehFalha(q)) return nao(q);
      await travarBotsEQuadro(deps, [bot.id, q.agenteId], q.id);
      if (!(await repo.doBot(bot.id, q.id))) return nao(recusa("nao_encontrado", `o quadro "${nomeDoQuadro(q)}" não está no bot ${bot.nome}`));
      await repo.definirPadrao(bot.id, q.id);
      return { ...ok(`"${nomeDoQuadro(q)}" é agora o quadro padrão de ${bot.nome}.`, { quadroId: q.id }), events: [evento(q)] };
    }
    default:
      return aplicarVinculoOuProjeto(deps, p, agentes, anfitriao, evento);
  }
}

/**
 * Trava os bots (em ordem de id, sem deadlock entre dois pedidos cruzados), depois a linha do quadro (a ordem do lote).
 * O quadro que o servidor de antes criou sem linha em quadro_bots (a janela entre a 0152 e a troca) ganha a linha do
 * dono aqui: sem ela, vincular outro bot tiraria o quadro do dono (o vínculo implícito some com a 1ª linha) e o
 * desvincular diria que o dono "não estava".
 */
async function travarBotsEQuadro(deps: Deps, bots: readonly string[], quadroId: string): Promise<Quadro | null> {
  const repo = deps.repos.quadros;
  for (const id of [...new Set(bots)].sort()) await repo.travarBot(id);
  const q = await repo.buscarTravado(quadroId);
  if (q && (await repo.vinculos(q.id)).length === 0) await repo.vincular(q.id, q.agenteId);
  return q;
}

async function aplicarVinculoOuProjeto(deps: Deps, p: PedidoQuadrosDoBot, agentes: readonly Agente[], anfitriao: string | null, evento: (q: { id: string; agenteId: string }) => RuntimeEvent): Promise<{ data: ResultadoQuadrosDoBot; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const op = p.op;
  switch (op.tipo) {
    case "vincular_bot": {
      const bot = botPeloNome(op.bot, agentes);
      if (!bot) return nao(recusa("nao_encontrado", `bot "${op.bot}" não encontrado`));
      const achado = await quadroDaOp(deps, op.quadro, agentes, anfitriao);
      if (ehFalha(achado)) return nao(achado);
      // ADR-153 §7: a NOD_QUADROS_N libera o 2º quadro e também o vínculo a outro bot.
      if (!(await deps.repos.preferencias.quadrosNLiberado())) return nao(recusa("nao_permitido", "este servidor ainda deixa um quadro só por bot (a flag NOD_QUADROS_N está desligada): vincular a outro bot ainda não está liberado"));
      const q = await travarBotsEQuadro(deps, [bot.id, achado.agenteId], achado.id);
      if (!q) return nao(recusa("sem_quadro", "o quadro sumiu"));
      if (await repo.doBot(bot.id, q.id)) return ok(`${bot.nome} já estava no quadro "${nomeDoQuadro(q)}". Nada mudou.`, { quadroId: q.id });
      if ((await repo.vinculadosAo(bot.id)).length >= LIMITES_QUADROS.quadrosPorBot) return nao(recusa("entrada_invalida", `${bot.nome} já tem ${LIMITES_QUADROS.quadrosPorBot} quadros (o teto)`));
      await repo.vincular(q.id, bot.id);
      return { data: { ok: true, instrucao: `${bot.nome} agora vê e trabalha no quadro "${rotuloDoQuadro(q, agentes)}" (o dono segue ${agentes.find((a) => a.id === q.agenteId)?.nome ?? "o mesmo"}). Desfaz com desvincular_bot.`, quadroId: q.id }, events: [evento(q)] };
    }
    case "desvincular_bot": {
      const bot = botPeloNome(op.bot, agentes);
      if (!bot) return nao(recusa("nao_encontrado", `bot "${op.bot}" não encontrado`));
      const achado = await quadroDaOp(deps, op.quadro, agentes, bot.id);
      if (ehFalha(achado)) return nao(achado);
      const q = await travarBotsEQuadro(deps, [bot.id, achado.agenteId], achado.id);
      if (!q) return nao(recusa("sem_quadro", "o quadro sumiu"));
      const vinculos = await repo.vinculos(q.id);
      if (!vinculos.some((v) => v.agenteId === bot.id)) return ok(`${bot.nome} não estava no quadro "${nomeDoQuadro(q)}". Nada mudou.`, { quadroId: q.id });
      // O quadro não fica sem bot: o último sai só com remover_quadro (que tem confirmação).
      const dono = proximoDono(vinculos, bot.id);
      if (!dono) return nao(recusa("entrada_invalida", `${bot.nome} é o único bot do quadro "${nomeDoQuadro(q)}": para tirar o quadro, remover_quadro`));
      if (q.agenteId === bot.id) await repo.transferirDono(q.id, dono.agenteId);
      const saiu = await repo.desvincular(q.id, bot.id);
      if (saiu?.eraPadrao) {
        const resto = await repo.vinculadosAo(bot.id);
        if (resto.length && !resto.some((x) => x.padrao)) await repo.definirPadrao(bot.id, resto[0]!.id);
      }
      const novoDono = q.agenteId === bot.id ? ` O dono passou a ser ${agentes.find((a) => a.id === dono.agenteId)?.nome ?? "outro bot"}.` : "";
      return { data: { ok: true, instrucao: `${bot.nome} saiu do quadro "${nomeDoQuadro(q)}".${novoDono} As tarefas dele seguem lá. Desfaz com vincular_bot.`, quadroId: q.id }, events: [evento({ id: q.id, agenteId: q.agenteId === bot.id ? dono.agenteId : q.agenteId })] };
    }
    case "criar_projeto": {
      const n = validarNomeProjeto(op.nome);
      if ("erro" in n) return nao(recusa("entrada_invalida", n.erro));
      await deps.repos.projetos.travar();
      if ((await deps.repos.projetos.contarAtivos()) >= LIMITES_QUADROS.projetos) return nao(recusa("entrada_invalida", `a pessoa já tem ${LIMITES_QUADROS.projetos} projetos ativos (o teto)`));
      const r = await deps.repos.projetos.criar({ nome: n.nome, chave: chaveDoNome(n.nome), descricao: (op.descricao ?? "").slice(0, LIMITES_QUADROS.descricaoProjeto), meta: op.meta ?? null, prazo: op.prazo ?? null });
      if (!r || "emUso" in r) return nao(recusa("entrada_invalida", `já existe um projeto "${n.nome}"`));
      return ok(`Projeto "${r.ok.nome}" criado. Para pôr um quadro nele: editar_quadro com projeto "${r.ok.nome}" (ou criar_quadro com projeto).`, { projeto: r.ok });
    }
    case "editar_projeto": {
      const achado = await projetoDaOp(deps, op.projeto);
      if (ehFalha(achado)) return nao(achado);
      let nome: string | undefined;
      if (op.nome !== undefined) {
        const n = validarNomeProjeto(op.nome);
        if ("erro" in n) return nao(recusa("entrada_invalida", n.erro));
        nome = n.nome;
      }
      await deps.repos.projetos.travar();
      const r = await deps.repos.projetos.editar(achado.id, { ...(nome !== undefined ? { nome, chave: chaveDoNome(nome) } : {}), ...(op.descricao !== undefined ? { descricao: op.descricao.slice(0, LIMITES_QUADROS.descricaoProjeto) } : {}), ...(op.meta !== undefined ? { meta: op.meta } : {}), ...(op.prazo !== undefined ? { prazo: op.prazo } : {}) });
      if (!r) return nao(recusa("nao_encontrado", "o projeto sumiu"));
      if ("emUso" in r) return nao(recusa("entrada_invalida", `já existe um projeto "${nome ?? ""}"`));
      return ok(`Projeto "${r.ok.nome}" atualizado.`, { projeto: r.ok });
    }
    case "arquivar_projeto":
    case "restaurar_projeto": {
      const achado = await projetoDaOp(deps, op.projeto);
      if (ehFalha(achado)) return nao(achado);
      await deps.repos.projetos.travar();
      const arquivar = op.tipo === "arquivar_projeto";
      if (!arquivar && (await deps.repos.projetos.contarAtivos()) >= LIMITES_QUADROS.projetos) return nao(recusa("entrada_invalida", `a pessoa já tem ${LIMITES_QUADROS.projetos} projetos ativos (o teto)`));
      const r = await deps.repos.projetos.arquivar(achado.id, arquivar);
      if (!r) return nao(recusa("nao_encontrado", "o projeto sumiu"));
      if ("emUso" in r) return nao(recusa("entrada_invalida", `já há outro projeto ativo "${achado.nome}": renomeie um deles antes de restaurar`));
      return ok(arquivar ? `Projeto "${r.ok.nome}" arquivado: os quadros dele seguem de pé e aparecem em "Sem projeto". Desfaz com restaurar_projeto.` : `Projeto "${r.ok.nome}" restaurado.`, { projeto: r.ok });
    }
    default:
      return nao(recusa("entrada_invalida", `${op.tipo}: op desconhecida`));
  }
}
