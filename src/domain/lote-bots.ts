import { MODOS_APROVACAO, type Agente, type ModoAprovacao } from "../contracts/agente.ts";
import { acharTextoMalFormado } from "./texto-bem-formado.ts";
import type { MotivoCardDoLote } from "../contracts/conversa.ts";
import type { AcaoLote, AppConectado, TipoAcaoLote } from "../contracts/ferramentas-do-nod.ts";
import { MAX_ACOES_LOTE } from "../contracts/ferramentas-do-nod.ts";
import { VERSAO_MAXIMA } from "../contracts/versoes-perfil.ts";
import { deForaNoLote, riscoNoLote } from "./acoes/index.ts";
import { decidirPeloModo, semRevisor } from "./modo-aprovacao.ts";
import { ehNod, nomeReservadoAoNod } from "./nod.ts";

/**
 * O lote do Nod, puro (definido em 2026-10-07, ADR-082): validar TUDO antes de fazer qualquer coisa, resolver os bots
 * alvo (id, nome exato ou "@ref" de uma ação anterior), classificar o risco de cada ação e deixar o modo decidir o que
 * roda agora e o que espera a pessoa. Quem executa é o caso de uso (gerir-bots.ts).
 *
 * Arriscado, no lote: excluir e mudar o modo de outro bot sempre; dar acesso a um app, e duplicar um bot que tem acessos
 * (a cópia os leva), depois de conteúdo de fora no turno — a cerca 3. O Nod NÃO usa o alívio de `conversaComAPessoa`:
 * pedir na conversa não tira o risco de excluir (decisão do Marlon no /spec de 2026-10-07).
 *
 * definido em 2026-10-18 (Fase 4, PR 2; emenda da ADR-059): pôr um bot em "Ignorar todas as aprovações" é sempre card,
 * em QUALQUER modo do Nod, inclusive no total (`ligar_total`). Na tela, ligar esse modo pede um segundo clique; sem
 * esta cerca, o Nod em total ligava o modo em outro bot sem a pessoa.
 */

/** O que o lote enxerga de um bot da pessoa. */
export type BotDoLote = Pick<Agente, "id" | "nome" | "ownerId" | "dono" | "papel" | "excluidoEm">;

/** Uma ação já validada: o alvo resolvido (um bot existente, ou o índice da ação que cria o bot). */
export type AcaoResolvida = AcaoLote & {
  i: number;
  /** O bot existente em que a ação roda; null em criar e quando o alvo é "@ref". */
  alvoId: string | null;
  /** O índice da ação (criar/duplicar) que produz o alvo, quando o alvo é "@ref". */
  alvoDaAcao: number | null;
  /** O nome que o card mostra: o do bot alvo, ou o do bot que vai nascer. */
  alvoNome: string;
};

export type Problema = { i: number; motivo: string };

const PRECISA_DE_BOT: ReadonlySet<TipoAcaoLote> = new Set(["duplicar", "editar", "mover", "excluir", "criar_rotina", "dar_acesso", "mudar_modo", "restaurar_versao"]);
const CRIA_BOT: ReadonlySet<TipoAcaoLote> = new Set(["criar", "duplicar"]);

function vazio(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

/**
 * Valida o lote inteiro e resolve os alvos. Qualquer problema devolve TODOS os problemas e nada roda (o Nod corrige e
 * chama de novo). `bots` são os bots da pessoa que o lote pode tocar (já filtrados por dona; excluídos e o Nod entram
 * para a mensagem de erro dizer por quê); `apps`, os que ela conectou.
 */
export function validarLote(acoes: readonly AcaoLote[], bots: readonly BotDoLote[], apps: readonly AppConectado[], pessoaId: string, resumo?: string): { ok: true; acoes: AcaoResolvida[] } | { ok: false; problemas: Problema[] } {
  const problemas: Problema[] = [];
  // Revisão 8 do #590: o resumo vai ao cartão (jsonb) e à frase da decisão; byte nulo ou surrogate solto nele dava 500.
  if (resumo !== undefined && acharTextoMalFormado(resumo) !== null) problemas.push({ i: -1, motivo: "texto inválido no resumo (byte nulo ou caractere partido)" });
  if (acoes.length === 0) problemas.push({ i: -1, motivo: "nenhuma ação" });
  if (acoes.length > MAX_ACOES_LOTE) problemas.push({ i: -1, motivo: `no máximo ${MAX_ACOES_LOTE} ações por pedido; divida em partes` });
  const refs = new Map<string, number>();
  const resolvidas: AcaoResolvida[] = [];

  acoes.forEach((a, i) => {
    const erro = (motivo: string) => problemas.push({ i, motivo });
    // NOD-398 (revisão 6): byte nulo ou surrogate solto em qualquer campo virava cartão e estourava no jsonb (500). Vale
    // também para a rota interna do gerir_bots, que não passa pelo filtro do corpo da pessoa.
    const malFormado = acharTextoMalFormado(a);
    if (malFormado !== null) erro(`texto inválido em ${malFormado.replace(/^\$\.?/, "") || "um campo"} (byte nulo ou caractere partido)`);
    let alvoId: string | null = null;
    let alvoDaAcao: number | null = null;
    let alvoNome = "";

    if (a.ref !== undefined) {
      if (!CRIA_BOT.has(a.tipo)) erro("ref só vale em criar e duplicar");
      else if (refs.has(a.ref)) erro(`ref "${a.ref}" repetido`);
      else refs.set(a.ref, i);
    }

    if (PRECISA_DE_BOT.has(a.tipo)) {
      const alvo = (a.bot ?? "").trim();
      if (alvo === "") erro(`${a.tipo} precisa do bot alvo`);
      else if (alvo.startsWith("@")) {
        const origem = refs.get(alvo.slice(1));
        // A própria ação registrou o ref acima: um "@ref" que aponta para si mesmo não é anterior.
        if (origem === undefined || origem === i) erro(`"${alvo}" não é o ref de uma ação anterior`);
        else {
          alvoDaAcao = origem;
          alvoNome = resolvidas[origem]?.tipo === "criar" ? acoes[origem]?.nome ?? alvo : `${resolvidas[origem]?.alvoNome ?? alvo} (cópia)`;
        }
      } else {
        const r = resolverBot(alvo, bots, pessoaId);
        if ("motivo" in r) erro(r.motivo);
        else { alvoId = r.bot.id; alvoNome = r.bot.nome; }
      }
      if (alvoDaAcao !== null && a.tipo === "duplicar") erro("duplicar precisa de um bot que já existe");
    } else if (a.bot !== undefined) erro(`${a.tipo} não leva bot`);

    switch (a.tipo) {
      case "criar":
        if (vazio(a.nome)) erro("criar precisa do nome");
        else if (nomeReservadoAoNod(a.nome ?? "")) erro("o nome Nod é do bot fixo");
        if (vazio(a.descricao)) erro("criar precisa da descrição do que o bot faz");
        alvoNome = (a.nome ?? "").trim();
        break;
      case "editar":
        if ([a.nome, a.titulo, a.descricao, a.modelo, a.esforco].every((v) => v === undefined)) erro("editar sem nada para mudar");
        if (a.nome !== undefined && (vazio(a.nome) || nomeReservadoAoNod(a.nome))) erro(vazio(a.nome) ? "nome vazio" : "o nome Nod é do bot fixo");
        break;
      case "mover":
        if (a.secao === undefined) erro("mover precisa da seção (\"\" tira da seção)");
        break;
      case "criar_rotina":
        if (vazio(a.cron) || vazio(a.fuso_iana) || vazio(a.instrucao)) erro("criar_rotina precisa de cron, fuso_iana e instrucao");
        break;
      case "dar_acesso": {
        const app = apps.find((x) => x.slug === a.app);
        if (vazio(a.app) || !a.nivel) erro("dar_acesso precisa do app e do nível");
        else if (!app) erro(`o app "${a.app}" não está conectado: a pessoa conecta no Marketplace`);
        else if (!app.niveis.includes(a.nivel)) erro(`o app "${a.app}" não tem ferramentas de ${a.nivel}`);
        break;
      }
      case "mudar_modo":
        // NOD-398 (achado do fuzz): o modo fora da lista ia para o cartão e o texto com byte nulo estourava no JSON do Postgres.
        if (!a.modo) erro("mudar_modo precisa do modo");
        // O modo mal formado já saiu acima, sem repetir o texto ruim no motivo (revisão 9).
        else if (malFormado === null && !(MODOS_APROVACAO as readonly string[]).includes(a.modo)) erro(`modo "${[...String(a.modo)].slice(0, 20).join("")}" não existe: manual, automatico ou total`);
        break;
      case "restaurar_versao":
        // NOD-20: o número da versão (o Histórico do perfil); se ela existe e muda algo, quem diz é o caso de uso.
        if (typeof a.versao !== "number" || !Number.isSafeInteger(a.versao) || a.versao < 1 || a.versao > VERSAO_MAXIMA) erro("restaurar_versao precisa da versao (inteiro a partir de 1)");
        break;
      case "excluir_time":
        // NOD-437: excluir um time é do gerir_times (que monta o card); o gerir_bots não o recebe.
        erro("excluir um time é com gerir_times");
        break;
      case "remover_computador":
        // ADA-245: remover um computador é do remover_computador (que monta o card); o gerir_bots não o recebe.
        erro("remover um computador é com remover_computador");
        break;
      case "acessos_em_lote":
      case "padrao_acesso":
      case "desfazer_acessos":
        // ADA-241: o acesso em lote e o padrão do app são do gerir_acessos (que monta o card); o gerir_bots não os recebe.
        erro("acesso de vários bots ou padrão do app é com gerir_acessos");
        break;
      default:
        break;
    }
    resolvidas.push({ ...a, i, alvoId, alvoDaAcao, alvoNome });
  });

  return problemas.length ? { ok: false, problemas } : { ok: true, acoes: resolvidas };
}

/** Um bot da pessoa por id ou nome exato (sem diferenciar maiúsculas); o motivo diz por que não serve. */
export function resolverBot(alvo: string, bots: readonly BotDoLote[], pessoaId: string): { bot: BotDoLote } | { motivo: string } {
  const porId = bots.find((b) => b.id === alvo);
  const candidatos = porId ? [porId] : bots.filter((b) => b.nome.trim().toLowerCase() === alvo.trim().toLowerCase() && b.excluidoEm === null);
  if (candidatos.length === 0) return { motivo: `não achei o bot "${alvo}" entre os seus` };
  if (candidatos.length > 1) return { motivo: `há mais de um bot chamado "${alvo}": use o id (ver_colegas)` };
  const bot = candidatos[0]!;
  if (ehNod(bot)) return { motivo: "o Nod não mexe em si mesmo" };
  if (bot.ownerId !== pessoaId || bot.dono !== "pessoa") return { motivo: `"${bot.nome}" não é um bot seu` };
  if (bot.excluidoEm !== null) return { motivo: `"${bot.nome}" foi excluído` };
  return { bot };
}

/**
 * O risco de uma ação no lote; null = não é arriscada. revisto em 2026-10-28 (NOD-391, ADR-135): sai do registro de ações
 * (src/domain/acoes/), pelo mapa risco → modo: `pessoa_confirma` espera a pessoa em todo modo (`ligar_total`),
 * `arriscada` vira cartão no manual e no automático, e `leitura`/`muda` seguem o modo — salvo a cerca 3.
 */
export function riscoDaAcao(a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo" | "nivel_lote">, s: { contaminado: boolean; alvoTemAcessos: boolean }): MotivoCardDoLote | null {
  const risco = riscoNoLote(a);
  if (risco === "pessoa_confirma") return "ligar_total";
  if (risco === "arriscada") return "arriscada";
  // Cerca 3: depois de conteúdo de fora, o que dá ou reaproveita acesso, e o que grava instrução que um bot vai seguir
  // depois (a descrição vira o prompt dele; a rotina roda sozinha) — revisão de 2026-10-07: sem isto, uma página lida
  // pelo Nod no automático plantava uma rotina num bot que já tem o Gmail. Cada id diz a sua (`lote.deFora`).
  if (s.contaminado && deForaNoLote(a, { alvoTemAcessos: s.alvoTemAcessos })) return "conteudo_de_fora";
  return null;
}

/**
 * O que roda agora e o que espera a pessoa, pelo modo do Nod (menos `ligar_total`, que espera em todo modo). Uma ação
 * cujo alvo é o bot que outra ação (que espera) vai criar também espera: ela só pode rodar depois. Devolve, por ação, `null` (roda agora) ou o motivo do card.
 */
export function decidirLote(acoes: readonly AcaoResolvida[], modo: ModoAprovacao | undefined, riscos: readonly (MotivoCardDoLote | null)[]): (MotivoCardDoLote | null)[] {
  const espera: (MotivoCardDoLote | null)[] = [];
  for (const a of acoes) {
    const risco = riscos[a.i] ?? null;
    const d = semRevisor(decidirPeloModo(modo, { arriscada: risco !== null, credencial: false }));
    let motivo: MotivoCardDoLote | null = risco === "ligar_total" ? risco : d?.automatico ? null : (risco ?? "manual");
    if (motivo === null && a.alvoDaAcao !== null && espera[a.alvoDaAcao] !== null) motivo = espera[a.alvoDaAcao] ?? "manual";
    espera.push(motivo);
  }
  return espera;
}
