import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { ASSINATURA_PNG } from "../../src/adapters/tela/capturador-cdp.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { ACOES_CONHECIDAS_NOD398 } from "../helpers/acoes-conhecidas-nod398.ts";
import { CORPOS_QUEBRADOS, gerarEntradas, lerSemente, type CasoDeFuzz } from "../../src/domain/fuzz/gerador.ts";
import { ehErroDeDominio } from "../../src/domain/erro.ts";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { publicar } from "../../src/use-cases/canvas.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import { removerComputadorPeloChat } from "../../src/use-cases/remover-computador.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { CAMINHOS_DAS_ACOES_DE_CONTA, acoesNovasSemLeitura, acoesSemHandler, bloquearRedeExterna, rotasPublicasSemHandler, vereditoDeDecisao, sementeDoPr, chegouNoHandler, custoDoFuzz, enxugarCasos, executarFuzz, lerN, marcaDoBanco, processosBloqueados, quietude, planoDoServidor, relatarViolacoes, sqlDoRetrato, sqlDoRetratoDaConta, zerarCustoDoFuzz, type AlvoDoFuzz, type Retrato } from "../helpers/fuzz.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";
import { servidorCompleto, type ServidorCompleto, type SessaoDeTeste } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E, limparTenantE2E, varrerSobrasDaPessoa } from "./limpeza-e2e.ts";

/**
 * NOD-398: o fuzz das ações. Percorre TODAS as ações do registro (src/domain/acoes/) — a lista vem do registro, nunca
 * deste arquivo — e manda a cada rota que a declara N entradas absurdas geradas do JSON Schema dela. Invariantes depois
 * de cada chamada: nunca 5xx, /api/saude de pé, erro sem diff no banco da pessoa (o que o RLS dela enxerga) e o banco de
 * outras pessoas intacto (uma do mesmo tenant, uma de outro). Cobertura: toda ação tem de ter ao menos uma chamada que
 * CHEGOU ao handler (não 404 do roteador nem 401 de sessão).
 *
 * Reproduzir: `FUZZ_SEMENTE=<a do log> FUZZ_N=<n> npx vitest run --project concurrency tests/concurrency/fuzz-acoes.test.ts`.
 */

// No PR a semente vem do commit (GITHUB_SHA): o mesmo commit testa sempre as mesmas entradas e o gate não pisca. O noturno
// passa uma FUZZ_SEMENTE nova a cada noite.
function headLocal(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return null;
  }
}
const SEGREDO_DA_OUTRA = { nome: "Da outra zq7x", descricao: "Não pode mudar nem aparecer zq7x." };
// Fora do CI a semente sai do HEAD local (revisão 6): o `npm run check` de um bot não sorteia entradas novas a cada rodada
// e não tropeça num achado alheio à mudança dele; sorteio só no noturno ou com FUZZ_SEMENTE.
const SEMENTE = lerSemente(process.env.FUZZ_SEMENTE, () => sementeDoPr(process.env.GITHUB_SHA) ?? sementeDoPr(headLocal() ?? undefined) ?? randomInt(0, 2 ** 31));
// N=20 cabe no orçamento do job integration (≤ 90 s); a rodada noturna usa FUZZ_N=200.
const N = lerN(process.env.FUZZ_N, 20);
// O prazo cresce com N: medido em 2026-10-28, N=20 leva ~55 s no servidor padrão e ~22 s no compartilhado (saúde e retrato em paralelo);
// ~5 s por unidade de N com folga dobrada. N=200 (noturno) ganha ~33 min, dentro dos 45 do job.
// NOD-417 (o teto de 150 s caindo em lote na CI carregada, com a main a 126,8 s): o executor pula os retratos quando a
// marca do banco (marcaDoBanco) prova que nada foi gravado desde o último. Semente 1530664212 local: 106,5 s → 49,0 s.
const PRAZO_DO_FUZZ_MS = Math.max(600_000, N * 10_000);

/**
 * Duas configurações, porque nem toda rota existe em todo modo: o servidor padrão (local) leva quase tudo; o
 * compartilhado com contas, minha conta e nuvem leva o resto (SSH, nuvem, conta). O segundo fuzza só o que o primeiro
 * não tinha, e o fim exige 100% do registro coberto.
 */
const CONFIGURACOES: { nome: string; env: Record<string, string> }[] = [
  { nome: "padrão", env: { NOD_CAPTURA_TELA: "1", NOD_ONBOARDING_TEXTO: "1" } },
  { nome: "compartilhado + contas + nuvem", env: { NOD_MODO: "compartilhado", NOD_CONTAS: "1", NOD_MINHA_CONTA: "1", NOD_MAQUINA_NUVEM: "gcp", NOD_ONBOARDING_TEXTO: "1" } },
];
/**
 * NOD-445 (ADR-146): ação sem rota nenhuma (`semRotaDePessoa` fora das de conta, que moram nas rotas públicas de
 * /api/conta) não tem o que o fuzz HTTP mandar: a tela leva à conversa e o caminho é a ferramenta, provada no teste de
 * contrato da ação. Sai da cobertura por aqui, derivada do registro (nunca uma lista à mão).
 */
const SO_PELA_CONVERSA = new Set<string>((REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).filter((a) => a.semRotaDePessoa && !Object.hasOwn(CAMINHOS_DAS_ACOES_DE_CONTA, a.id)).map((a) => a.id));
let faltando: readonly string[] = REGISTRO_DE_ACOES.map((a) => a.id).filter((id) => !SO_PELA_CONVERSA.has(id));
/**
 * Revisão 10: as ações que hoje só recebem 404 (o fuzz não semeia a entidade delas) ou 403 (guarda). É um TETO: ação
 * fora desta lista que só receba 404/403 reprova (a cobertura rasa não cresce em silêncio). Semear e tirar daqui: NOD-409.
 */
// Revisão 19: só os corpos que o `lerCorpo` recusa (JSON inválido, `null` no topo); corpo vazio e topo que não é objeto
// chegam à rota, que valida: esse 400 é leitura da entrada. O teste confere que os rótulos ainda existem no gerador.
const ROTULOS_QUEBRADOS = new Set(["json quebrado", "não json", "null no topo"]);
const SO_404_403_ACEITAS = new Set([
  "bots.cobrar_colega", "memoria.desfazer_diario", "apps.sondar", "apps.habilitar", "apps.desabilitar", "maquinas.aprovar_dispositivo",
  "cartoes.reabrir", "cartoes.dispensar", "cartoes.confirmar_proposta", "cartoes.recusar_proposta", "turnos.cancelar", "incidentes.dispensar",
  "modo.contestar", "salas.parar", "trabalhos.parar", "trabalhos.fazer_aqui", "voz.encerrar", "memoria.apagar", "contas_ia.remover",
  "maquinas.revogar_chave", "conversas.tirar_pasta", "voz.apagar_falas",
  "maquinas.confiar_ssh", "maquinas.cancelar_ssh", "nuvem.dormir", "nuvem.acordar", "nuvem.excluir_maquina",
  // Revisão 12: lê o corpo antes de buscar a decisão, mas o fuzz não semeia decisões; sem corpo quebrado, sempre 404.
  "cartoes.decidir",
  // Revisão 11: oscilam pela semente (algumas sementes só sorteiam entradas que passam da validação e caem no 404). Medido
  // com as sementes 1, 424242, 3979170113 e a do HEAD local.
  "contas_ia.tentar_de_novo", "conversas.desfazer_turno", "apps.credenciais", "apps.github_app", "turnos.retomar_decisao",
  // Revisão 13: com 401/429 fora da conta da leitura, oscila também (a semente 3509089577 só lhe deu 404/401/429).
  "maquinas.desconectar",
]);
/**
 * Revisão 16: ação NOVA (fora de ACOES_CONHECIDAS_NOD398) que não dá para semear sai do veredito só por aqui, com a issue
 * que vai semeá-la (o teste exige o id NOD-n). SO_404_403_ACEITAS só pode ter ações da foto: não serve de saída para nova.
 */
const ISENCOES_DE_ACOES_NOVAS: Readonly<Record<string, string>> = {
  // A main vermelha em 849a2d14 (semente 2224696596): o fuzz não semeia versão de perfil, e só a semente que sorteia um número
  // existente passa da busca. Semear a versão do perfil no fuzz é da NOD-20.
  "bots.restaurar_versao": "NOD-20",
};
/** As ações do quadro que a NOD-420 mudou (o prazo_min): no PR levam as N entradas; as outras do quadro, metade. */
const ACOES_DO_QUADRO_COM_N = new Set(["quadro.criar_coluna", "quadro.renomear_coluna"]);
const duracoes: number[] = [];
// Revisão 14: a leitura da entrada acumulada entre os servidores, para a regra das ações novas valer só no fim.
const fuzzadasTodas = new Set<string>();
const alemDaBuscaTodas = new Set<string>();

describe("listas do teto das ações só 404/403 (revisão 16 do #590)", () => {
  it("SO_404_403_ACEITAS só tem ações da foto e cada isenção de ação nova cita a issue", () => {
    expect([...SO_404_403_ACEITAS].filter((a) => !ACOES_CONHECIDAS_NOD398.has(a))).toEqual([]);
    expect([...ROTULOS_QUEBRADOS].filter((r) => !CORPOS_QUEBRADOS.some((e) => e.rotulo === r))).toEqual([]);
    const registro = new Set<string>(REGISTRO_DE_ACOES.map((a) => a.id));
    expect(Object.entries(ISENCOES_DE_ACOES_NOVAS).filter(([a, issue]) => ACOES_CONHECIDAS_NOD398.has(a) || !registro.has(a) || !/^NOD-\d+$/.test(issue))).toEqual([]);
  });
});

for (const [ordem, config] of CONFIGURACOES.entries()) {
  describeIntegracao(`fuzz das ações do registro (NOD-398), servidor ${config.nome}`, () => {
    let srv: ServidorCompleto;
    let outra: SessaoDeTeste;
    let deOutroTenant: SessaoDeTeste;
    let sessao: SessaoDeTeste;
    let sqlRetrato: string;
    let sqlConta: string;
    let desbloquear: () => void;
    let home = "";
    const outraEscopo: Escopo = { tenantId: "", pessoaId: randomUUID() };
    const outroTenant: Escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };

    beforeAll(async () => {
      // Revisão 9: o servidor do fuzz não toca o ~/.nod de verdade (workspaces, pastas, arquivos da pessoa): NOD_HOME
      // temporário, apagado no fim, e só os sockets unix dele (e o do Postgres) liberados.
      home = mkdtempSync(join(tmpdir(), "nod-fuzz-home-"));
      desbloquear = bloquearRedeExterna({ unixPermitidos: [home] });
      // tela.capturar entra no fuzz com a flag ligada e um capturador falso: mede a validação da rota sem subir Chrome.
      srv = await servidorCompleto({ env: { ...config.env, NOD_HOME: home }, capturador: { capturar: async () => ASSINATURA_PNG }, intervalos: { orquestradorMs: 3_600_000, schedulerMs: 3_600_000, expiracaoMs: 3_600_000, outboxMs: 3_600_000, leaseMs: 3_600_000 } });
      sessao = srv.pessoa;
      outraEscopo.tenantId = srv.pessoa.tenantId;
      await srv.dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${outraEscopo.tenantId}, ${outraEscopo.pessoaId}, 'Outra do fuzz', 'OF') on conflict do nothing`;
      outra = srv.sessaoDe(outraEscopo);
      await srv.dbDono`insert into tenants (id, nome) values (${outroTenant.tenantId}, 'Outro tenant do fuzz') on conflict do nothing`;
      await srv.dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${outroTenant.tenantId}, ${outroTenant.pessoaId}, 'De outro tenant', 'OT') on conflict do nothing`;
      deOutroTenant = srv.sessaoDe(outroTenant);
      sqlRetrato = await sqlDoRetrato(srv.dbDono);
      sqlConta = await sqlDoRetratoDaConta(srv.dbDono);
    }, 60_000);

    afterAll(async () => {
      desbloquear?.();
      if (home) rmSync(home, { recursive: true, force: true });
      if (!srv) return;
      await srv.fechar();
      // Primeiro a varredura pelo catálogo (toda tabela com owner_id, apagada pela própria pessoa), depois a limpeza do e2e
      // (conta, sessões, pessoa). Ela apaga e só então conta: a falha aqui é linha que NÃO DÁ para apagar como a dona (FK
      // sem par, policy sem delete, tabela fora do grant), não "a limpeza esqueceu uma tabela" — o catálogo cobre isso.
      const sobras: string[] = [];
      for (const escopo of [{ tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, outraEscopo, outroTenant]) {
        sobras.push(...(await varrerSobrasDaPessoa(srv.db, srv.dbDono, escopo)).map((t) => `${escopo.pessoaId.slice(0, 8)}/${t}`));
        await limparPessoaE2E(srv.db, srv.dbDono, escopo, { agentes: [], conversas: [] });
      }
      await limparTenantE2E(srv.dbDono, outroTenant.tenantId);
      await srv.desligar();
      expect(sobras, "linhas do fuzz que a dona não consegue apagar").toEqual([]);
    }, 60_000);

    // ADA-241: um app da pessoa com uma ferramenta de ler e uma de alterar (o nível Ler e alterar existe nele).
    const conectorDe = (s: SessaoDeTeste, nome: string) =>
      srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, async (d) => {
        const suf = randomUUID().slice(0, 8);
        const c = await d.repos.conectores.criar({ nome: `${nome} ${suf}`, slug: `${nome}-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
        if (!c) throw new Error("conector do fuzz");
        const cap = (n: string, readOnlyHint: boolean) => ({ nome: n, descricao: n.toLowerCase(), schema: { type: "object" as const }, readOnlyHint });
        await d.repos.conectores.registrarSonda(c.id, { ok: true, catalogo: [cap("FUZZ_LER", true), cap("FUZZ_ALTERAR", false)], agora: d.agora() });
        return { id: c.id, slug: c.slug };
      });

    // O que o RLS da pessoa enxerga + as tabelas de conta dela (sem RLS, lidas pelo dono e filtradas pela pessoa). As de
    // conta só são escritas pelas rotas de conta, que só existem com NOD_CONTAS: no servidor sem contas o retrato delas
    // custaria uma consulta a mais por chamada (o orçamento de 90 s) sem poder pegar nada.
    const retratoDe = async (s: SessaoDeTeste): Promise<Retrato> => {
      const [doRls, daConta] = await Promise.all([
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => Object.fromEntries((await trx.unsafe<{ t: string; h: string }[]>(sqlRetrato)).map((l) => [l.t, l.h]))),
        ),
        srv.app.contas ? srv.dbDono.unsafe<{ t: string; h: string }[]>(sqlConta, [s.tenantId, s.pessoaId]) : Promise.resolve([]),
      ]);
      return { ...doRls, ...Object.fromEntries(daConta.map((l) => [l.t, l.h])) };
    };

    it("cada ação recebe N entradas absurdas e nenhum invariante cai", async () => {
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: FUZZ_SEMENTE=${SEMENTE} FUZZ_N=${N}`);
      // Ids reais: um bot da pessoa e um da outra (o RLS tem de esconder o segundo), com a conversa e uma rotina de cada
      // (revisão 9): a rota `/rotinas/:id` recebe id de rotina e passa da busca, em vez de só exercitar o "não achei".
      type Criado = { agente: { id: string }; conversa: { id: string } };
      const meu = await srv.json<Criado>("POST", "agentes", { dono: "pessoa", nome: "Alvo do fuzz", descricao: "Recebe o fuzz." });
      const dela = await srv.json<Criado>("POST", "agentes", { dono: "pessoa", ...SEGREDO_DA_OUTRA }, outra);
      const rotinaDe = (s: SessaoDeTeste, b: Criado) =>
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => {
            // Próxima execução daqui a 30 dias: o agendador não a roda durante o fuzz.
            const [r] = await trx<{ id: string }[]>`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
              values (${s.tenantId}, ${s.pessoaId}, ${b.agente.id}, ${b.conversa.id}, '0 8 * * *', 'UTC', 'Rotina do fuzz', 'f', 'e', 'l', 'p', now() + interval '30 days') returning id`;
            return r!.id;
          }),
        );
      const [minhaRotina, rotinaDela] = [await rotinaDe(sessao, meu), await rotinaDe(outra, dela)];
      // NOD-442: um quadro com um lote no bot da pessoa. Sem ele o `quadro.desfazer` só passava da busca na semente em que um
      // `quadro.criar` válido saía antes, com o experimento ligado por um `preferencias.salvar` sorteado (a main vermelha com
      // a semente 1644694243). O experimento Quadro fica ligado para o fuzz passar da guarda dele.
      await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
      await srv.json("POST", `agentes/${meu.agente.id}/quadro`, { meta: "Quadro do fuzz" });
      // Uma coluna removível (id `c-…`): o primeiro `quadro.remover_coluna` que a sortear remove de verdade.
      const comColuna = await srv.json<{ quadro: { colunas: { id: string; nome: string }[] } }>("POST", `agentes/${meu.agente.id}/quadro/colunas`, { nome: "Coluna do fuzz", grupo: "iniciado" });
      const colunaDoFuzz = comColuna.quadro.colunas.find((c) => c.nome === "Coluna do fuzz")!.id;
      // NOD-417: uma tarefa (em Backlog, sem acionar ninguém) para o `:tid` (`quadro.terminei` só passava da busca com ela).
      const comTarefa = await srv.json<{ quadro: { tarefas: { id: string; titulo: string }[] } }>("POST", `agentes/${meu.agente.id}/quadro/tarefas`, { titulo: "Tarefa do fuzz", status: "backlog" });
      const tarefaDoFuzz = comTarefa.quadro.tarefas.find((t) => t.titulo === "Tarefa do fuzz")!.id;
      // Um movimento desfazível da tarefa do fuzz para o `:mid` (`quadro.desfazer_movimento` só passava da busca na semente
      // em que um id quebrado caía no `:mid`; o #630 ficou vermelho com a semente 1563796334, os 10 casos em 404).
      const movimentoDoFuzz = await srv.app.dentro({ tenantId: sessao.tenantId, pessoaId: sessao.pessoaId }, (d) =>
        d.tx(async (trx) => {
          const [r] = await trx<{ id: string }[]>`insert into quadro_movimentos (tenant_id, owner_id, quadro_id, tarefa_id, tipo, de, para, autor)
            select tenant_id, owner_id, quadro_id, id, 'mover', 'iniciado', 'backlog', 'pessoa' from quadro_tarefas where id = ${tarefaDoFuzz} returning id`;
          return r!.id;
        }),
      );
      // NOD-443: a outra pessoa do tenant no quadro, para o `:pid` (`quadro.tirar_pessoa` só passava da busca na semente em
      // que um `quadro.adicionar_pessoa` sorteado acertava o nome dela antes; a 443 ficou vermelha com a semente 1735492939).
      const comPessoa = await srv.json<{ ok: boolean; detalhe?: string }>("POST", `agentes/${meu.agente.id}/quadro/pessoas`, { pessoa: outraEscopo.pessoaId });
      if (!comPessoa.ok) throw new Error(`a pessoa do fuzz não entrou no quadro: ${comPessoa.detalhe}`);
      // NOD-445: um app ativo e um removido no bot da pessoa e um no da outra, para `paginas.remover_app` e
      // `paginas.restaurar_app` passarem da busca (o `:app` recebe estes ids pelo segmento `apps`).
      const appDe = (s: SessaoDeTeste, b: Criado, nome: string, removido: boolean) =>
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => {
            const [r] = await trx<{ id: string }[]>`insert into apps_do_bot (tenant_id, owner_id, agente_id, nome, nome_chave, fonte, forma, removido_em)
              values (${s.tenantId}, ${s.pessoaId}, ${b.agente.id}, ${nome}, ${nome.toLowerCase()}, 'bot', 'lista', ${removido ? new Date() : null}) returning id`;
            return r!.id;
          }),
        );
      const [meuApp, meuAppRemovido, appDela] = [await appDe(sessao, meu, "Vagas", false), await appDe(sessao, meu, "Leads", true), await appDe(outra, dela, "Vagas", false)];
      // NOD-437: um time de cada pessoa (e o Sem time da pessoa) para o `/times/:id`: renomear e excluir passam da busca.
      type ComTime = { time: { id: string } };
      const timeDoFuzz = (await srv.json<ComTime>("POST", "times", { nome: "Time do fuzz" })).time.id;
      const timeDela = (await srv.json<ComTime>("POST", "times", { nome: "Time dela" }, outra)).time.id;
      const semTimeDoFuzz = (await srv.json<{ times: { id: string; semTime: boolean }[] }>("POST", "times/sincronizar", {})).times.find((t) => t.semTime)!.id;
      // ADA-13 (#649): um canvas com uma tela e um comentário em cada pessoa, para `canvas.comentar` (`/canvas/:id`) e
      // `canvas.resolver_comentario` (`/canvas/comentarios/:id`) passarem da busca.
      const canvasDe = (s: SessaoDeTeste, b: Criado) =>
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => {
            const escopo = { tenantId: s.tenantId, pessoaId: s.pessoaId };
            const repos = criarRepos(trx, escopo);
            const r = await publicar(depsSobre(repos, escopo, { trx }), { agenteId: b.agente.id, bruto: { titulo: "Canvas do fuzz", jornadas: [{ titulo: "J", telas: [{ html: "<p>fuzz</p>" }] }] }, origemUrl: null, confianca: "confiavel" });
            if (!r.ok) throw new Error(`canvas do fuzz: ${r.detalhe}`);
            const c = await repos.canvas.comentar({ canvasId: r.canvas.id, telaId: "J1-1", jornada: null, tipo: "pino", x: 0.5, y: 0.5, texto: "do fuzz", autorTipo: "pessoa", autorId: s.pessoaId, autorNome: null, paiId: null, versao: 1, confianca: "confiavel", criadoEm: Date.now() });
            return { canvas: r.canvas.id, comentario: c.id };
          }),
        );
      const [meuCanvas, canvasDela] = [await canvasDe(sessao, meu), await canvasDe(outra, dela)];
      // ADA-14 (ADR-153): o quadro do fuzz com um segundo bot vinculado e um projeto, para `quadro.definir_padrao`
      // (`/agentes/:id/quadros/:qid`), `quadro.desvincular_bot` (`/quadros/:qid/bots/:bot`, sem ser o último bot) e
      // `quadro.arquivar_projeto`/`restaurar_projeto` (`/projetos/:pid`) passarem da busca.
      const quadrosDoMeu = await srv.json<{ quadros?: { quadros?: { id: string }[] } }>("GET", `agentes/${meu.agente.id}/quadros`);
      const quadroDoFuzz = quadrosDoMeu.quadros?.quadros?.[0]?.id;
      if (!quadroDoFuzz) throw new Error(`o quadro do fuzz não veio na lista: ${JSON.stringify(quadrosDoMeu)}`);
      const segundo = await srv.json<Criado>("POST", "agentes", { dono: "pessoa", nome: "Segundo do fuzz", descricao: "Divide o quadro do fuzz." });
      await srv.json("POST", `quadros/${quadroDoFuzz}/bots`, { bot: segundo.agente.id });
      const comProjeto = await srv.json<{ projeto?: { id: string }; quadros?: { projetos?: { id: string; nome: string }[] } }>("POST", "projetos", { nome: "Projeto do fuzz" });
      const projetoDoFuzz = comProjeto.projeto?.id ?? comProjeto.quadros?.projetos?.find((p) => p.nome === "Projeto do fuzz")?.id;
      if (!projetoDoFuzz) throw new Error(`o projeto do fuzz não foi criado: ${JSON.stringify(comProjeto)}`);
      // ADA-241 (CI do PR #706, semente 2570060255): um app conectado e um lote de acessos no bot da pessoa, para o
      // `acessos.desfazer_lote` (`/acessos/lotes/:id/desfazer`) passar da busca; sem o lote, o id sorteado só dava 404.
      const conectorDoFuzz = await conectorDe(sessao, `fuzz-${config.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      const loteDoFuzz = (await srv.json<{ lote_id: string }>("POST", `conectores/${conectorDoFuzz.id}/acessos/lote`, { nivel: "leitura", bots: [meu.agente.id], chave: `fuzz:${randomUUID()}` })).lote_id;
      // O app instalado, para o `canvas.dar_acesso` (`/canvas/app/acessos/:bot`) passar da guarda "instale antes".
      await srv.json("PUT", "canvas/app", {});
      const plano = planoDoServidor({
        registro: REGISTRO_DE_ACOES as readonly DefinicaoAcao[],
        pendentes: faltando,
        rotas: [...srv.app.rotas, ...(srv.app.contas?.rotas ?? [])],
        semente: SEMENTE + ordem,
        n: N,
        ids: {
          daPessoa: [meu.agente.id],
          deOutraPessoa: [dela.agente.id],
          porRecurso: {
            conversas: { daPessoa: [meu.conversa.id], deOutraPessoa: [dela.conversa.id] },
            rotinas: { daPessoa: [minhaRotina], deOutraPessoa: [rotinaDela] },
            // NOD-415: a main ficou vermelha com a semente 3044290320 porque `bots.excluir` e `quadro.remover` rodavam antes
            // de `quadro.remover_coluna` (o plano agora vai do DELETE mais fundo ao mais raso). O `:cid` recebe ainda ids
            // reais: a coluna semeada (a remoção de verdade) e as fixas (o id não muda ao renomear; remover dá 400).
            colunas: { daPessoa: [colunaDoFuzz, "voce", "cancelado"], deOutraPessoa: [] },
            tarefas: { daPessoa: [tarefaDoFuzz], deOutraPessoa: [] },
            movimentos: { daPessoa: [movimentoDoFuzz], deOutraPessoa: [] },
            pessoas: { daPessoa: [outraEscopo.pessoaId], deOutraPessoa: [] },
            apps: { daPessoa: [meuApp, meuAppRemovido], deOutraPessoa: [appDela] },
            times: { daPessoa: [timeDoFuzz, semTimeDoFuzz], deOutraPessoa: [timeDela] },
            canvas: { daPessoa: [meuCanvas.canvas], deOutraPessoa: [canvasDela.canvas] },
            comentarios: { daPessoa: [meuCanvas.comentario], deOutraPessoa: [canvasDela.comentario] },
            acessos: { daPessoa: [meu.agente.id], deOutraPessoa: [dela.agente.id] },
            quadros: { daPessoa: [quadroDoFuzz], deOutraPessoa: [] },
            bots: { daPessoa: [segundo.agente.id, meu.agente.id], deOutraPessoa: [dela.agente.id] },
            projetos: { daPessoa: [projetoDoFuzz], deOutraPessoa: [] },
            lotes: { daPessoa: [loteDoFuzz], deOutraPessoa: [] },
            conectores: { daPessoa: [conectorDoFuzz.id], deOutraPessoa: [] },
          },
        },
      });
      // NOD-445, custo no PR (N <= 20; a noturna fica inteira): as rotas de remover e restaurar app não leem o corpo, então
      // as N entradas viravam N sorteios do mesmo caminho (com a semente 1257342993: 2 de 20 e 1 de 20 passaram da busca).
      // Cada uma fica com um caso por id que importa (o app vivo, o removido, o da outra pessoa pelo bot dela e pelo meu,
      // um id quebrado), na posição do plano. A ordenar lê o corpo: fica com as 10 primeiras entradas (as fixas + 7).
      if (N <= 20) {
        const apps = [meuApp, meuAppRemovido, appDela, "nao-e-uuid"].map((app) => ({ bot: meu.agente.id, app }));
        apps.push({ bot: dela.agente.id, app: appDela });
        const enxuto: typeof plano.casos = [];
        const vistos = new Map<string, number>();
        for (const c of plano.casos) {
          const n = (vistos.get(c.acao) ?? 0) + 1;
          vistos.set(c.acao, n);
          if (c.acao === "paginas.ordenar" && n > 10) continue;
          // ADA-14: `quadro.definir_padrao` também não lê o corpo; fica com um caso por par (bot, quadro) que importa: o
          // dono, o 2º bot vinculado, o bot da outra pessoa e um id quebrado.
          if (c.acao === "quadro.definir_padrao") {
            if (n > 1) continue;
            const pares: [string, string][] = [[meu.agente.id, quadroDoFuzz], [segundo.agente.id, quadroDoFuzz], [dela.agente.id, quadroDoFuzz], [meu.agente.id, "nao-e-uuid"]];
            for (const [b, q] of pares) enxuto.push({ ...c, caminho: `/agentes/${b}/quadros/${encodeURIComponent(q)}/padrao` });
            continue;
          }
          // ADA-14: `quadro.desvincular_bot` também não lê o corpo, e o sorteio de (quadro, bot) podia nunca juntar o quadro
          // real com o 2º bot (a CI do #697 caiu com a semente 945627893). Um caso por par que importa: o bot da outra
          // pessoa, um quadro quebrado, o 2º bot (sai de verdade) e, por último, o dono, que aí é o último bot e fica (com o
          // dono antes, ele saía, o quadro passava ao 2º bot e o `quadro.remover` só via 404: a semente 1882859186).
          if (c.acao === "quadro.desvincular_bot") {
            if (n > 1) continue;
            const pares: [string, string][] = [[quadroDoFuzz, dela.agente.id], ["00000000-0000-4000-8000-000000000000", segundo.agente.id], [quadroDoFuzz, segundo.agente.id], [quadroDoFuzz, meu.agente.id]];
            for (const [q, b] of pares) enxuto.push({ ...c, caminho: `/quadros/${q}/bots/${b}`, entrada: { rotulo: "base plausível", corpo: null } });
            continue;
          }
          // ADA-14: as outras ações novas com o quadro ou o projeto na rota levam, além do sorteio, um caso válido com o id
          // real ("base plausível": o enxugar das ações do quadro sempre o mantém). Sem ele, o sorteio de ids podia nunca
          // acertar o quadro real (a CI do #697 caiu no `quadro.vincular_bot` com a semente 3626997374).
          const validoDaAda14: Record<string, { caminho: string; corpo: unknown }> = {
            "quadro.vincular_bot": { caminho: `/quadros/${quadroDoFuzz}/bots`, corpo: { bot: segundo.agente.id } },
            "quadro.editar_projeto": { caminho: `/projetos/${projetoDoFuzz}`, corpo: { nome: "Projeto do fuzz" } },
            "quadro.arquivar_projeto": { caminho: `/projetos/${projetoDoFuzz}/arquivar`, corpo: null },
            "quadro.restaurar_projeto": { caminho: `/projetos/${projetoDoFuzz}/restaurar`, corpo: null },
          };
          const valido = validoDaAda14[c.acao];
          if (valido && n === 1) enxuto.push({ ...c, caminho: valido.caminho, entrada: { rotulo: "base plausível", corpo: valido.corpo === null ? null : JSON.stringify(valido.corpo) } });
          if (c.acao === "paginas.remover_app" || c.acao === "paginas.restaurar_app") {
            if (n > 1) continue;
            const fim = c.acao === "paginas.restaurar_app" ? "/restaurar" : "";
            for (const a of apps) enxuto.push({ ...c, caminho: `/agentes/${a.bot}/apps/${encodeURIComponent(a.app)}${fim}` });
            continue;
          }
          enxuto.push(c);
        }
        plano.casos.splice(0, plano.casos.length, ...enxuto);
      }
      // NOD-420: no PR (N ≤ 20) as ações do quadro levam metade das entradas por rota (as fixas e um caso que passa da
      // busca sempre ficam), menos as que a NOD-420 mudou (criar_coluna e renomear_coluna, o prazo_min), que levam N.
      // O quadro é 17 rotas das ~150 do padrão; a noturna (N ≥ 100) fuzza tudo com N.
      if (N <= 20) {
        const antes = plano.casos.length;
        plano.casos = enxugarCasos(plano.casos, {
          acoes: (a) => a.startsWith("quadro.") && !ACOES_DO_QUADRO_COM_N.has(a),
          k: Math.ceil(N / 2),
          idsDaPessoa: new Set([meu.agente.id, colunaDoFuzz, "voce", "cancelado", tarefaDoFuzz, movimentoDoFuzz, outraEscopo.pessoaId]),
        });
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes[${config.nome}]: ações do quadro com ${Math.ceil(N / 2)} entradas por rota: ${antes} → ${plano.casos.length} casos`);
      }
      // A main ficou vermelha com a semente 1264666071: um `quadro.mudar_tarefa` sorteado com `excluir: true` apagou a
      // tarefa do fuzz antes do primeiro `quadro.terminei`, que só deu 404. O `terminei` roda antes do `mudar_tarefa`
      // (a ordem relativa do resto do plano não muda), e a tarefa ainda existe quando ele chega.
      // A main ficou vermelha de novo com a semente 477150545, agora no `quadro.cancelar_trabalho`: o mesmo
      // `mudar_tarefa` com `excluir` apagou a tarefa antes dele. Cancelar sem trabalho vivo não muda nada e responde
      // 200, então basta a tarefa existir: as ações que só saem do 404 com a tarefa do fuzz (não leem corpo) rodam
      // antes do primeiro `mudar_tarefa`. `repetir_trabalho` (400 "sem agente") e `desfazer_movimento` (o movimento
      // semeado) estavam no mesmo caso e só passavam na semente que sorteava o id de 300 caracteres.
      const PRECISAM_DA_TAREFA = new Set(["quadro.terminei", "quadro.desfazer_movimento", "quadro.repetir_trabalho", "quadro.cancelar_trabalho"]);
      // O PR #643 ficou vermelho com a semente 2453916776 no `desfazer_movimento`: nenhum dos casos sorteados juntava o
      // bot, a tarefa e o movimento do fuzz (o `enxugarCasos` só guarda um caso fundo se o sorteio fizer um). Cada uma
      // destas ações ganha um caso com os ids semeados, na posição do primeiro caso dela, para passar com qualquer semente.
      // A main ficou vermelha com a semente 806451066 (3011777, #689) no `quadro.tirar_pessoa`: a pessoa do fuzz está no
      // quadro desde a NOD-443, mas nenhum caso sorteado levava o id dela no `:pid` (todos em 404). Ganha o caso semeado
      // também; não entra em PRECISAM_DA_TAREFA porque não depende da tarefa e não precisa vir antes do `mudar_tarefa`.
      const SEMEADOS: Record<string, string> = { agentes: meu.agente.id, tarefas: tarefaDoFuzz, movimentos: movimentoDoFuzz, pessoas: outraEscopo.pessoaId };
      for (const acao of [...PRECISAM_DA_TAREFA, "quadro.tirar_pessoa"]) {
        const i = plano.casos.findIndex((c) => c.acao === acao);
        if (i < 0) continue;
        // A entrada é a plausível do gerador (o corpo não importa: estas rotas não o leem); só o caminho muda.
        const base = plano.casos.find((c) => c.acao === acao && c.entrada.rotulo === "base plausível") ?? plano.casos[i]!;
        const segs = base.caminho.split("/");
        const caminho = segs.map((s, j) => (j > 0 && SEMEADOS[segs[j - 1]!] !== undefined ? encodeURIComponent(SEMEADOS[segs[j - 1]!]!) : s)).join("/");
        plano.casos.splice(i, 0, { ...base, caminho });
      }
      // O #685 e a main 6efd24bd ficaram vermelhos com a semente 2841792856 no `canvas.comentar`: os casos que caíam no canvas
      // semeado traziam um `pai_id` sorteado (404 "o comentário a responder não está neste canvas") ou um corpo quebrado.
      // Cada ação do canvas ganha um caso com o id semeado e um corpo válido, na posição do primeiro caso dela.
      const DO_CANVAS: Record<string, { caminho: string; corpo: Record<string, unknown> }> = {
        "canvas.comentar": { caminho: `/canvas/${meuCanvas.canvas}/comentarios`, corpo: { texto: "caso semeado do fuzz", endereco: "#J1-1", tipo: "pino", x: 0.25, y: 0.75 } },
        "canvas.resolver_comentario": { caminho: `/canvas/comentarios/${meuCanvas.comentario}/resolver`, corpo: { resolvido: true } },
      };
      for (const [acao, semeado] of Object.entries(DO_CANVAS)) {
        const i = plano.casos.findIndex((c) => c.acao === acao);
        if (i < 0) continue;
        const base = plano.casos[i]!;
        plano.casos.splice(i, 0, { ...base, caminho: semeado.caminho, entrada: { ...base.entrada, rotulo: "semeado válido", corpo: JSON.stringify(semeado.corpo) } });
      }
      const primeiraQueTira = plano.casos.findIndex((c) => c.acao === "quadro.mudar_tarefa");
      if (primeiraQueTira >= 0) {
        const depois = (c: (typeof plano.casos)[number], i: number) => i > primeiraQueTira && PRECISAM_DA_TAREFA.has(c.acao);
        const antecipados = plano.casos.filter(depois);
        const resto = plano.casos.filter((c, i) => !depois(c, i));
        resto.splice(primeiraQueTira, 0, ...antecipados);
        plano.casos = resto;
      }
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: ${plano.acoes} ações, ${plano.casos.length} casos; sem rota:${plano.semRota.join(", ") || "nenhuma"}`);
      expect(plano.casos.length, "o plano do fuzz saiu vazio: nada seria testado").toBeGreaterThan(0);

      // O cliente do fuzz age como o navegador: adota o cookie novo que o servidor manda (as rotas de conta trocam o
      // cookie antigo, sem sid, por uma sessão registrada no primeiro pedido, por desenho). Sem isso cada pedido criava
      // uma sessão nova e o retrato da conta acusava erro mexendo no banco. Se o servidor apaga o cookie (sair), volta ao
      // cookie de partida e o troca de novo na hora, como quem entra de novo, antes do retrato.
      const cookieInicial = sessao.cookie;
      const adotarCookie = async (r: Response): Promise<void> => {
        const novo = r.headers.getSetCookie().map((c) => /^nod_sessao=([^;]*)/.exec(c)?.[1]).find((v) => v !== undefined);
        if (novo === undefined) return;
        if (novo) { sessao = { ...sessao, cookie: `nod_sessao=${novo}` }; return; }
        sessao = { ...sessao, cookie: cookieInicial };
        if (srv.app.contas) await adotarCookie(await fetch(`${srv.url}/api/conta`, { headers: { cookie: cookieInicial }, signal: AbortSignal.timeout(15_000) }));
      };
      // Entra antes do fuzz: a troca do cookie de partida acontece aqui, e não no meio de um caso que deu erro.
      if (srv.app.contas) await adotarCookie(await fetch(`${srv.url}/api/conta`, { headers: { cookie: cookieInicial }, signal: AbortSignal.timeout(15_000) }));
      const contagem = new Map<number, number>();
      const chegaram = new Set<string>();
      const alemDaBusca = new Set<string>();
      const rotasQueChegaram = new Set<string>();
      const vazamentos: string[] = [];
      const alvo: AlvoDoFuzz = {
        chamar: async (c: CasoDeFuzz) => {
          const base = c.publica ? `${srv.url}/api` : `${srv.url}/api/t/${sessao.tenantId}`;
          const r = await fetch(`${base}${c.caminho}`, {
            method: c.metodo,
            // A origem do próprio servidor: as rotas de conta recusam POST sem ela antes de olhar a entrada.
            headers: { cookie: sessao.cookie, "content-type": "application/json", origin: srv.url },
            body: c.metodo === "GET" || c.entrada.corpo === null ? undefined : c.entrada.corpo,
            signal: AbortSignal.timeout(15_000),
          });
          await adotarCookie(r);
          contagem.set(r.status, (contagem.get(r.status) ?? 0) + 1);
          const corpo = await r.text();
          // Vazamento por leitura: o nome e a descrição do bot da outra pessoa nunca entram numa entrada do fuzz (só o id,
          // que a rota pode ecoar num erro), então aparecer numa resposta é leitura através da RLS.
          if (corpo.includes(SEGREDO_DA_OUTRA.nome) || corpo.includes(SEGREDO_DA_OUTRA.descricao)) vazamentos.push(`${r.status} ${c.metodo} ${c.caminho}: ${corpo.slice(0, 160)}`);
          if (chegouNoHandler(c, r.status, corpo)) {
            chegaram.add(c.acao);
            rotasQueChegaram.add(c.rota);
          }
          // Revisão 9: chegar ao handler com 404 ("não achei") ou 403 (guarda) não lê a entrada. A ação que só teve esses
          // sai no log, para a cobertura rasa aparecer em vez de contar como 100%.
          // Revisão 11: o 400 de um corpo quebrado sai do `lerCorpo`, antes de a rota ler qualquer campo; não conta.
          // Revisão 12: 401 (sessão) e 429 (limite) também barram antes da entrada; não contam.
          // Revisões 17 a 19: o 400 do `lerCorpo` (JSON inválido, `null` no topo, ou byte nulo/surrogate solto num campo) sai quando a rota
          // pede o corpo, antes de ler qualquer campo; não conta. Só o 400: outro status desses casos é da própria rota. 5xx
          // já é violação e não conta (o log não sugere tirar da lista uma ação que só deu 500). 413 o fuzz não alcança.
          const barradoNoCorpo = r.status === 400 && (ROTULOS_QUEBRADOS.has(c.entrada.rotulo) || /: (byte nulo|surrogate solto)$/.test(c.entrada.rotulo));
          if (chegouNoHandler(c, r.status, corpo) && r.status < 500 && r.status !== 404 && r.status !== 403 && r.status !== 401 && r.status !== 429 && !barradoNoCorpo) alemDaBusca.add(c.acao);
          // eslint-disable-next-line no-console
          if (process.env.FUZZ_DEBUG) console.log(`FZ ${r.status} ${c.acao} ${c.metodo} ${c.caminho} ${corpo.slice(0, 80)}`);
          return { status: r.status, corpo };
        },
        saude: async () => (await fetch(`${srv.url}/api/saude`, { signal: AbortSignal.timeout(5_000) })).ok,
        retrato: () => retratoDe(srv.pessoa),
        // O custo no PR (o teto de 150 s): o caso que não gravou nada no banco não paga os retratos (ver marcaDoBanco).
        marca: () => marcaDoBanco(srv.dbDono),
        retratoDaOutra: async () => {
          const [a, b] = await Promise.all([retratoDe(outra), retratoDe(deOutroTenant)]);
          return { ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`mesmo tenant/${k}`, v])), ...Object.fromEntries(Object.entries(b).map(([k, v]) => [`outro tenant/${k}`, v])) };
        },
      };
      const inicio = Date.now();
      const violacoes = await executarFuzz(alvo, plano.casos, {
        quieto: {
          prazoMs: 5_000,
          intervaloMs: 100,
          // Sem turno da pessoa na fila ou rodando: o trabalho que um sucesso disparou já escreveu o que tinha a escrever.
          ocioso: () =>
            srv.app.dentro({ tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, (d) =>
              d.tx(async (trx) => (await trx<{ n: number }[]>`select count(*)::int as n from turnos where owner_id = ${srv.pessoa.pessoaId} and estado in ('pendente', 'despachando')`)[0]!.n === 0),
            ),
        },
      });
      const segundos = (Date.now() - inicio) / 1000;
      // O custo deste servidor (contagens e ms por etapa), para medir corte de custo com a mesma FUZZ_SEMENTE.
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: custo ${JSON.stringify({ ...custoDoFuzz, ms: Object.fromEntries(Object.entries(custoDoFuzz.ms).map(([k, v]) => [k, Math.round(v)])) })}`);
      zerarCustoDoFuzz();
      duracoes.push(segundos);
      const semHandler = acoesSemHandler(plano.casos, chegaram);
      const rotasSemHandler = rotasPublicasSemHandler(plano.casos, rotasQueChegaram);
      // Revisão 14: só quem chegou ao handler neste servidor; quem não chegou vai ao próximo (`faltando`).
      const so404 = [...chegaram].filter((a) => !alemDaBusca.has(a)).sort();
      for (const a of chegaram) fuzzadasTodas.add(a);
      for (const a of alemDaBusca) alemDaBuscaTodas.add(a);
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: só 404/403/401/429 (não passaram da busca ou da guarda): ${so404.join(", ") || "nenhuma"}`);
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: ${plano.casos.length} chamadas em ${segundos.toFixed(1)} s; status: ${JSON.stringify(Object.fromEntries([...contagem].sort((a, b) => a[0] - b[0])))}; sem chegar ao handler: ${semHandler.join(", ") || "nenhuma"}; rotas de conta sem chegar: ${rotasSemHandler.join(", ") || "nenhuma"}`);
      // A semente impressa é a BASE (a do log de cima): cada servidor soma a própria ordem por dentro, então rodar de novo
      // com ela refaz exatamente os mesmos casos neste servidor (revisão 2: imprimir SEMENTE + ordem reproduzia outra coisa).
      // Antes de qualquer expect (QA do #590): uma falha aqui não pode deixar `faltando` com o registro inteiro e fazer o
      // próximo servidor fuzzar tudo (e acusar em cascata o que só vale no padrão).
      faltando = [...plano.semRota.filter((a) => !SO_PELA_CONVERSA.has(a)), ...semHandler.filter((a) => (REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).some((d) => d.id === a))];
      // Revisão 15: soft e antes dos outros expects, para aparecer junto de qualquer outra falha do último servidor. A
      // ação nova que não dá para semear sai por ISENCOES_DE_ACOES_NOVAS, com a issue de semear.
      if (ordem === CONFIGURACOES.length - 1) expect.soft(acoesNovasSemLeitura({ fuzzadas: fuzzadasTodas, alemDaBusca: alemDaBuscaTodas, conhecidas: new Set([...ACOES_CONHECIDAS_NOD398, ...Object.keys(ISENCOES_DE_ACOES_NOVAS)]) }), `semente ${SEMENTE}: ações novas do registro que em nenhum servidor passaram de 404/403/401/429 (semear a entidade no fuzz; se não der, pôr em ISENCOES_DE_ACOES_NOVAS com a issue)`).toEqual([]);
      expect(vazamentos, `servidor ${config.nome}: respostas com o bot da outra pessoa`).toEqual([]);
      expect(violacoes, `servidor ${config.nome}\n${relatarViolacoes(SEMENTE, N, violacoes)}`).toEqual([]);
      // Cada rota de conta montada neste servidor tem de ter lido a entrada pelo menos uma vez (não só 403/429).
      // Teto (revisões 10 a 14): ação fora da lista que só recebe 404/403/401/429. Com N pequeno (PR) a amostra muda a cada
      // push e o resultado das ações que já existiam oscila, então para elas só avisa e reprova com N >= 100 (noturno). As
      // ações NOVAS (fora de ACOES_CONHECIDAS_NOD398) reprovam já no PR, no fim, se em nenhum servidor passaram da busca.
      // Revisão 17: a isenção de ação nova vale também no noturno.
      const novas = so404.filter((a) => !SO_404_403_ACEITAS.has(a) && !Object.hasOwn(ISENCOES_DE_ACOES_NOVAS, a));
      const sairamDaLista = [...SO_404_403_ACEITAS].filter((a) => alemDaBusca.has(a));
      // eslint-disable-next-line no-console
      if (novas.length || sairamDaLista.length) console.log(`fuzz-acoes[${config.nome}]: semente ${SEMENTE}; só 404/403/401/429 fora da lista: ${novas.join(", ") || "nenhuma"}; da lista que já leram a entrada (tirar de SO_404_403_ACEITAS): ${sairamDaLista.join(", ") || "nenhuma"}`);
      if (N >= 100) expect(novas, `servidor ${config.nome}, semente ${SEMENTE}: ações fora de SO_404_403_ACEITAS que não passaram da busca (404/403/401/429 ou corpo barrado no lerCorpo; semear, ou pôr na lista com a NOD-409 se for da foto, ou em ISENCOES_DE_ACOES_NOVAS com a issue se for nova)`).toEqual([]);
      expect(rotasSemHandler, `servidor ${config.nome}: rotas de conta que só barraram antes do handler`).toEqual([]);
      // Quem não chegou ao handler aqui ficou pendente (acima) para o próximo servidor; no fim, tem de ter chegado em algum.
      // Depois da última configuração, nenhuma ação do registro pode ter ficado sem fuzz.
      if (ordem === CONFIGURACOES.length - 1) {
        expect(faltando, "ações do registro que nenhum servidor do fuzz fez chegar ao handler").toEqual([]);
        // Critério 7 (NOD-398): no PR (N=20) o fuzz cabe em 90 s somando os dois servidores; a noturna (N maior) não tem teto aqui.
        const total = duracoes.reduce((x, y) => x + y, 0);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: total ${total.toFixed(1)} s (orçamento do PR: 90 s com FUZZ_N=20)`);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: esperas pelo banco quieto que estouraram o prazo: ${quietude.esgotou}`);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: processos-filho barrados: ${[...new Set(processosBloqueados)].join(", ") || "nenhum"}`);
        // O teto só vale onde o ci.yml o define (FUZZ_TETO_S no job integration, revisão 6): no desktop-release o mesmo
        // `npm run check` roda num runner hospedado mais lento, e uma oscilação de tempo não pode derrubar um release.
        // No CI, o tempo vai ao resumo do job: é a medida do critério 7 (90 s), lida da rodada. O teto que reprova (FUZZ_TETO_S)
        // tem folga para a fila da VM compartilhada (revisão 7): pega a regressão grande, não a oscilação do runner.
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `fuzz-acoes (N=${N}): ${duracoes.map((d) => d.toFixed(1)).join(" s + ")} s = **${total.toFixed(1)} s** (meta do PR: < 90 s; só executarFuzz dos dois servidores, sem boot)\n\n`);
        const teto = Number(process.env.FUZZ_TETO_S ?? "");
        if (N <= 20 && teto > 0) expect(total, `o fuzz do PR passou de ${teto} s (critério 7 do NOD-398)`).toBeLessThan(teto);
      }
    // Sem retry (o vitest.config dá 1 na CI): a semente é a mesma, então refazer repete as entradas, e o beforeAll não
    // roda de novo; o fuzz do servidor de contas já encerrou a sessão de partida (sair de todos), e a segunda tentativa só
    // dava "POST agentes → 401 Sua sessão terminou" por cima da falha de verdade (o #685, run 42061739845).
    }, { timeout: PRAZO_DO_FUZZ_MS, retry: 0 });

    // Critério 4 (NOD-398): ação arriscada ou pessoa_confirma nunca roda sem decisão. Lista e risco vêm do registro (lote +
    // riscoDe), os argumentos do gerador. Para cada item e cada modo em que ela tem de esperar, o gerir_bots do Nod (o
    // caminho do chat) tem de recusar a entrada ou deixá-la esperando num cartão; nunca "feita", e o bot alvo intacto.
    if (ordem === 0) it("ação arriscada ou pessoa_confirma nunca roda sem decisão, em nenhum modo em que deve esperar", async () => {
      const alvo = await srv.json<{ agente: { id: string } }>("POST", "agentes", { dono: "pessoa", nome: "Alvo do invariante", descricao: "Não pode mudar sem decisão." });
      const botId = alvo.agente.id;
      // Revisão 8: entra também a ação cujo risco depende da entrada (`riscoDe`); o risco efetivo de cada item decide abaixo.
      const arriscadas = (REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).filter((d) => d.lote && (d.lote.riscoDe !== undefined || d.risco === "arriscada" || d.risco === "pessoa_confirma"));
      expect(arriscadas.map((d) => d.id).sort(), "o registro perdeu as ações arriscadas do lote").toEqual(expect.arrayContaining(["bots.excluir", "bots.mudar_modo"]));
      const linha = async () => (await srv.dbDono<{ l: string }[]>`select row_to_json(a)::text as l from (select nome, descricao, modo_aprovacao, excluido_em from agentes where id = ${botId}) a`)[0]?.l;
      // NOD-437: times.excluir (arriscada) tem a via do gerir_times: o time do invariante, com o bot alvo dentro, não pode sumir.
      const TIME_DO_INVARIANTE = "Time do invariante";
      await srv.json("POST", "times", { nome: TIME_DO_INVARIANTE, bots: [botId] });
      // ADA-245: maquinas.remover (pessoa_confirma) tem a via do remover_computador: o computador do invariante não pode sair.
      const COMPUTADOR_DO_INVARIANTE = "Computador do invariante";
      const computadorId = await srv.app.dentro(srv.pessoa, async (d) => (await d.repos.maquinaTokens.criar({ nome: COMPUTADOR_DO_INVARIANTE, prefixo: randomUUID().slice(0, 8), hash: randomBytes(32) }))!.id);
      const linhaDoComputador = async () => (await srv.dbDono<{ l: string }[]>`select row_to_json(m)::text as l from (select nome, expira_em, revogado_em from maquina_tokens where id = ${computadorId}) m`)[0]?.l;
      const linhaDoBot = async () => `${await linha()} | ${await linhaDoComputador()}`;
      const linhaDoTime = async () => (await srv.dbDono<{ l: string }[]>`select coalesce((select row_to_json(t)::text from (select nome, nome_chave from times where nome_chave = 'time do invariante' and owner_id = ${srv.pessoa.pessoaId}) t), 'sumiu') as l`)[0]?.l;
      const ambas = async () => `${await linhaDoBot()} | ${await linhaDoTime()}`;
      const antes = await ambas();
      const violacoes: { acao: string; caso: string; motivo: string }[] = [];
      const esperas = new Map<string, number>();
      // ADA-241 (CI do PR #706): o acesso de vários bots e o padrão do app são do gerir_acessos (o gerir_bots os recusa), e o
      // risco sai do nível (Ler e alterar é pessoa_confirma). A entrada fixa é válida: o app conectado com Ler e alterar.
      const appDoInvariante = await conectorDe(srv.pessoa, "invariante");
      const ACAO_DO_GERIR_ACESSOS: Record<string, "lote" | "padrao"> = { acessos_em_lote: "lote", padrao_acesso: "padrao" };
      for (const def of arriscadas) {
        const viaAcessos = def.chat.estado === "vivo" && def.chat.via.ferramenta === "gerir_acessos";
        const fixos: Record<string, unknown>[] = def.lote!.tipo === "mudar_modo" ? [{ modo: "total" }, { modo: "manual" }, { modo: "automatico" }] : viaAcessos ? [{ app: appDoInvariante.slug, nivel: "escrita" }] : [{}];
        const doFuzz = gerarEntradas(def.schema, SEMENTE, N).flatMap((e) => {
          try { const v = e.corpo === null ? null : JSON.parse(e.corpo); return v && typeof v === "object" && !Array.isArray(v) ? [{ rotulo: e.rotulo, v: v as Record<string, unknown> }] : []; } catch { return []; }
        });
        const itens = [...fixos.map((v, i) => ({ rotulo: `fixo ${i}`, v })), ...doFuzz];
        for (const { rotulo, v } of itens) {
          const viaTimes = def.chat.estado === "vivo" && def.chat.via.ferramenta === "gerir_times";
          const viaRemover = def.chat.estado === "vivo" && def.chat.via.ferramenta === "remover_computador";
          const item = { ...v, tipo: def.lote!.tipo, bot: botId } as unknown as AcaoLote;
          // No gerir_acessos o nível chega como `nivel` e vira o `nivel_lote` do item do card.
          const risco = def.lote!.riscoDe?.(viaAcessos ? ({ ...item, nivel_lote: v.nivel } as unknown as AcaoLote) : item) ?? def.risco;
          if (risco !== "arriscada" && risco !== "pessoa_confirma") continue;
          const modos: ModoAprovacao[] = risco === "pessoa_confirma" ? ["manual", "automatico", "total"] : ["manual", "automatico"];
          for (const modo of modos) {
            const caso = `${rotulo} (${JSON.stringify(v).slice(0, 60)}) no modo ${modo}`;
            try {
              const r = await srv.app.dentro(srv.pessoa, async (d) => {
                const r0 = await garantirNod(d, {});
                if (r0.events?.length) await d.repos.events.gravarComOutbox(r0.events);
                const nod = r0.data.nod;
                await d.repos.agentes.definirModoAprovacao(nod.id, modo);
                const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "fuzz do invariante", entradaConfianca: "confiavel", modelo: "auto" });
                if (viaAcessos) {
                  const r1 = await gerirAcessos(d, { ...v, turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", acao: ACAO_DO_GERIR_ACESSOS[def.lote!.tipo]! } as never);
                  if (r1.events?.length) await d.repos.events.gravarComOutbox(r1.events);
                  // O gerir_acessos devolve `esperando: true` (um item só), não a lista de índices do gerir_bots.
                  const dado = r1.data as { ok: boolean; esperando?: boolean; decisao_id?: string | null; feito?: unknown };
                  return { ok: dado.ok, ...(dado.esperando ? { esperando: [0], decisao_id: dado.decisao_id ?? null } : { feitas: dado.ok ? [dado.feito] : [] }) };
                }
                const lote = viaRemover
                  ? await removerComputadorPeloChat(d, { turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", computador: COMPUTADOR_DO_INVARIANTE, ...v } as never)
                  : viaTimes
                  ? await gerirTimes(d, { turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", acoes: [{ time: TIME_DO_INVARIANTE, ...v, tipo: "excluir" } as never] })
                  : await gerirBots(d, { turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", acoes: [item] });
                if (lote.events?.length) await d.repos.events.gravarComOutbox(lote.events);
                return lote.data;
              });
              // Ok: esperando num cartão (com decisão) ou recusada (falha). Nunca feita.
              // ADA-245: o remover_computador sempre propõe (um item, sem `feitas`): ok com decisão = esperou num cartão; a linha
              // do computador do invariante, conferida abaixo, prova que nada mudou antes do ok da pessoa.
              const veredito = viaRemover ? (r.ok ? (r as { decisao_id?: string }).decisao_id ? "esperou" : "rodou" : "recusou") : vereditoDeDecisao(r as never);
              // eslint-disable-next-line no-console
              if (process.env.FUZZ_DEBUG && rotulo.startsWith("fixo")) console.log(`INV ${def.id} ${caso} ${veredito} ${JSON.stringify(r).slice(0, 200)}`);
              // NOD-437: no gerir_times, excluir um time VAZIO roda direto (emenda da ADR-135); a violação é o time com bots
              // sumir sem decisão, que a linha do time do invariante confere logo abaixo.
              if (veredito === "rodou" && !viaTimes) violacoes.push({ acao: def.id, caso, motivo: `rodou sem decisão (${risco}): ${JSON.stringify(r).slice(0, 160)}` });
              if (veredito === "esperou") esperas.set(def.id, (esperas.get(def.id) ?? 0) + 1);
            } catch (e) {
              if (!ehErroDeDominio(e)) violacoes.push({ acao: def.id, caso, motivo: `erro inesperado: ${(e as Error).message.slice(0, 160)}` });
            }
            const depois = await ambas();
            if (depois !== antes) violacoes.push({ acao: def.id, caso, motivo: `o bot alvo mudou sem decisão: ${antes} → ${depois}` });
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[invariante de decisão]: esperas por ação ${JSON.stringify(Object.fromEntries(esperas))}; ${violacoes.length} violação(ões)`);
      expect(violacoes, relatarViolacoes(SEMENTE, N, violacoes)).toEqual([]);
      // Por AÇÃO (revisão 4): sem espera numa delas, o invariante não foi exercitado nela (tudo recusado na validação), e uma
      // regressão só nela passaria. As entradas fixas são válidas, então cada ação arriscada tem de esperar ao menos uma vez.
      const semEspera = arriscadas.map((d) => d.id).filter((id) => !esperas.get(id));
      expect(semEspera, "ações arriscadas em que nenhuma chamada chegou a esperar o cartão").toEqual([]);
    }, PRAZO_DO_FUZZ_MS);
  });
}
