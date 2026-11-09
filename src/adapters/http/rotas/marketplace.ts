import { COMANDO_GITHUB_NATIVO, ENV_TOKEN_GITHUB, SLUG_GITHUB } from "../../../contracts/github.ts";
import { APPS_MARKETPLACE } from "../../../contracts/marketplace.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { fraseSemJeito } from "../../../domain/github.ts";
import { garantirGithubSemConfiguracao, guardarComposioGithub, guardarTokenGithub } from "../../../use-cases/conectar-github.ts";
import { registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector, type SaidaSondarConector } from "../../../use-cases/sondar-conector.ts";
import { aoConectarApp } from "../../../use-cases/ao-conectar-app.ts";
import { criarClienteComposio } from "../../integracoes/composio.ts";
import { criarCatalogoComposio } from "../../integracoes/catalogo-composio.ts";
import { chavePrivadaValida, criarTokenDeInstalacao } from "../../integracoes/github-app.ts";
import { log } from "../../../obs/log.ts";
import { ESPERAS_SONDA_VERIFICAR_MS, VERIFICAR_TETO_MS } from "../../../shared/constantes.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";
import { conferirChaveComposio, conferirTokenGithub } from "./segredos-de-app.ts";

export type OpcoesRotasMarketplace = {
  dentro: DentroDeTx;
  cifrar: (s: string) => string;
  decifrar: (s: string) => string;
  fetchImpl?: typeof fetch;
  /**
   * definido em 2026-09-24 (ADR-048): quem pode cadastrar o GitHub App da organização — e-mails ou ids
   * em NOD_ADMINS. O nod não tem papel de admin no cadastro (pessoas é só identidade, ADR-030); vazio =
   * ninguém cadastra pela tela.
   */
  admins?: readonly string[];
  /** Base da API do GitHub; só teste. */
  apiGithub?: string;
  /** O App do tenant mudou: o token de instalação guardado em memória deixa de valer. */
  aoTrocarApp?: (tenantId: string) => void;
  /** Espera entre as tentativas de sonda do `verificar` (NOD-208); default setTimeout. Injetável no teste. */
  esperar?: (ms: number) => Promise<void>;
  /** Relógio do teto do `verificar` (NOD-208); default Date.now. */
  agora?: () => number;
};

export function rotasMarketplace(op: OpcoesRotasMarketplace): Rota[] {
  const cliente = (chave: string) => criarClienteComposio(chave, op.fetchImpl);
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = op.agora ?? (() => Date.now());
  const catalogo = criarCatalogoComposio({ decifrar: op.decifrar, fetchImpl: op.fetchImpl });
  /**
   * revisto em 2026-09-21 (ADR-041): a curadoria deixou de ser a lista do que EXISTE, então
   * recusar por ausência nela barraria justamente o app recém-criado no painel. Quem valida é o
   * provedor — o `criarSessao` falha para toolkit que ele não conhece. Daqui sai só o nome exibido.
   */
  /** NOD_ADMINS lista e-mails ou ids de pessoa; comparação sem caixa. */
  const ehAdmin = async (escopo: { tenantId: string; pessoaId: string }): Promise<boolean> => {
    const admins = op.admins ?? [];
    if (admins.length === 0) return false;
    if (admins.includes(escopo.pessoaId.toLowerCase())) return true;
    const email = (await op.dentro(escopo, (d) => d.repos.pessoas.buscar(escopo.pessoaId)))?.email?.toLowerCase();
    return !!email && admins.includes(email);
  };
  const acharApp = (slug: string) => {
    if (!/^[a-z0-9_-]{1,64}$/.test(slug)) throw new ErroDeDominio("nao_encontrado");
    return APPS_MARKETPLACE.find((a) => a.slug === slug) ?? { slug, nome: slug, descricao: "", categoria: "" };
  };
  /** definido em 2026-09-25: conectou, os cards "Conecte o X" abertos viram o de permitir na mesma transação. */
  const sondarUmaVez = (escopo: Escopo, conectorId: string, slug: string, orcamentoMs: number): Promise<SaidaSondarConector> =>
    op.dentro(escopo, async (d) => {
      const s = await executar(d, sondarConector, { conectorId, orcamentoMs });
      if (s.ok) await executar(d, aoConectarApp, { slug });
      return s;
    });
  return [
    /**
     * Jeito 3 (ADR-048): token pessoal no campo avançado. O GitHub é perguntado ANTES de guardar
     * (GET /user): token recusado não vira conector "conectado" que falha na primeira chamada. Guardar
     * e sondar são duas transações — a sonda decifra o env da linha já gravada.
     */
    { metodo: "POST", acao: "apps.github_token", padrao: /^\/marketplace\/github\/token$/, async handler(ctx) {
      const body = await ctx.corpo() as { token?: unknown } | null;
      const token = await conferirTokenGithub(body?.token, op);
      const salvo = await op.dentro(ctx.escopo, (d) => guardarTokenGithub(d, { token, cifrar: op.cifrar, decifrar: op.decifrar }));
      const s = await op.dentro(ctx.escopo, async (d) => {
        const r = await executar(d, sondarConector, { conectorId: salvo.id });
        if (r.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
        return r;
      });
      ctx.json(200, { conectado: s.ok, conectorId: salvo.id, conector: s.conector });
    } },
    /**
     * Jeito 5 (ADR-048): o GitHub App da organização, para as rotinas no executor de servidor. A
     * chave privada nunca volta: o GET diz só se há App e quais números. O POST gera um token de
     * instalação ANTES de guardar — app, instalação ou chave errados não viram configuração muda.
     */
    { metodo: "GET", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const c = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      const admin = await ehAdmin(ctx.escopo);
      ctx.json(200, c ? { configurado: true, appId: c.appId, instalacaoId: c.instalacaoId, podeTrocar: admin && c.ownerId === ctx.escopo.pessoaId } : { configurado: false, podeCadastrar: admin });
    } },
    { metodo: "POST", acao: "apps.github_app", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const body = await ctx.corpo() as { appId?: unknown; instalacaoId?: unknown; chavePrivada?: unknown } | null;
      const appId = typeof body?.appId === "string" || typeof body?.appId === "number" ? String(body.appId).trim() : "";
      const instalacaoId = typeof body?.instalacaoId === "string" || typeof body?.instalacaoId === "number" ? String(body.instalacaoId).trim() : "";
      const chavePem = typeof body?.chavePrivada === "string" ? body.chavePrivada.trim() : "";
      if (!(await ehAdmin(ctx.escopo))) throw new ErroDeDominio("nao_permitido");
      if (!/^[0-9]{1,12}$/.test(appId) || !/^[0-9]{1,15}$/.test(instalacaoId) || chavePem.length > 16_384 || !chavePrivadaValida(chavePem)) throw new ErroDeDominio("entrada_invalida");
      const atual = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      if (atual && atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
      await criarTokenDeInstalacao({ appId, instalacaoId, chavePem, agora: Date.now(), base: op.apiGithub, fetchImpl: op.fetchImpl });
      await op.dentro(ctx.escopo, (d) => d.repos.githubApp.salvar({ appId, instalacaoId, chavePrivadaCifrada: op.cifrar(chavePem) }));
      op.aoTrocarApp?.(ctx.escopo.tenantId);
      ctx.json(200, { configurado: true, appId, instalacaoId });
    } },
    { metodo: "POST", acao: "apps.configurar_marketplace", padrao: /^\/marketplace\/configurar$/, async handler(ctx) {
      const body = await ctx.corpo() as { chave?: unknown } | null;
      const chave = await conferirChaveComposio(body?.chave, op.fetchImpl);
      await op.dentro(ctx.escopo, async (d) => { await d.repos.composio.salvarChave(op.cifrar(chave)); });
      ctx.json(200, { configurado: true });
    } },
    { metodo: "POST", acao: "apps.conectar", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/conectar$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      if (app.slug === SLUG_GITHUB) {
        // ADR-048: o que já está pronto ganha. gh logado nesta máquina (ou o App da organização no
        // servidor) = conectado agora, sem login nem campo.
        const r = await op.dentro(ctx.escopo, async (d) => {
          const g = await garantirGithubSemConfiguracao(d, { pelaPessoa: true });
          if (g.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
          return g;
        });
        if (r.ok) { ctx.json(200, { conectado: true, conectorId: r.conector.id }); return; }
        if (r.motivo === "manual") { ctx.json(200, { conectado: false, frase: "Você já tem um conector com o slug github registrado à mão. O nod não o troca: remova ou renomeie esse conector para usar o GitHub do nod." }); return; }
        // Sem gh: o token já colado serve sem nova tela; a sonda escolhe o jeito (token antes do Composio na máquina).
        const comToken = await op.dentro(ctx.escopo, async (d) => {
          const c = await d.repos.conectores.buscarPorSlug(SLUG_GITHUB);
          return c && c.ownerId === ctx.escopo.pessoaId && c.comando === COMANDO_GITHUB_NATIVO && c.env[ENV_TOKEN_GITHUB] ? c.id : null;
        });
        if (comToken) {
          const s = await op.dentro(ctx.escopo, async (d) => {
            const r2 = await executar(d, sondarConector, { conectorId: comToken });
            if (r2.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
            return r2;
          });
          if (s.ok) { ctx.json(200, { conectado: true, conectorId: comToken, jeito: "token" }); return; }
        }
      }
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada && app.slug === SLUG_GITHUB) { ctx.json(200, { conectado: false, frase: fraseSemJeito(false) }); return; }
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      const chave = op.decifrar(cifrada);
      // definido em 2026-09-29 (ADR-057): app do catálogo público não tem curadoria; o conector nasce com
      // o nome que a grade mostrou, não com o slug. O catálogo acabou de ser lido pela tela: sai do cache.
      const nome = APPS_MARKETPLACE.some((a) => a.slug === app.slug) ? app.nome : (await catalogo(ctx.escopo.tenantId, cifrada)).find((a) => a.slug === app.slug)?.nome ?? app.nome;
      const c = cliente(chave);
      const userId = `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
      const sessao = await c.criarSessao(userId, app.slug);
      const link = await c.autorizar(sessao.id, app.slug);
      const conectorId = await op.dentro(ctx.escopo, async (d) => {
        if (app.slug === SLUG_GITHUB) {
          // ADR-048: o Composio é um jeito DENTRO do GitHub nativo; os nomes estáveis e as concessões ficam.
          const g = await guardarComposioGithub(d, { url: sessao.url, chave, cifrar: op.cifrar, decifrar: op.decifrar });
          await d.repos.composio.salvarSessao({ toolkit: app.slug, sessaoId: sessao.id, contaId: link.contaId, conectorId: g.id });
          return g.id;
        }
        const existente = await d.repos.conectores.buscarPorSlug(app.slug);
        if (existente && existente.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
        const anterior = await d.repos.composio.sessao(app.slug);
        if (existente && anterior?.conectorId !== existente.id) throw new ErroDeDominio("estado_invalido");
        const env = { "x-api-key": chave };
        const conector = existente
          ? await d.repos.conectores.atualizarEndpoint(existente.id, sessao.url, op.cifrar(JSON.stringify(env)), Object.keys(env))
          : await executar(d, registrarConector, { nome, slug: app.slug, transporte: "http", url: sessao.url, env, declaracao: "toca", cifrar: op.cifrar });
        if (!conector) throw new ErroDeDominio("estado_invalido");
        await d.repos.composio.salvarSessao({ toolkit: app.slug, sessaoId: sessao.id, contaId: link.contaId, conectorId: conector.id });
        return conector.id;
      });
      ctx.json(200, { url: link.url, conectorId });
    } },
    { metodo: "POST", acao: "apps.verificar", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/verificar$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      const { cifrada, sessao } = await op.dentro(ctx.escopo, async (d) => ({ cifrada: await d.repos.composio.chave(), sessao: await d.repos.composio.sessao(app.slug) }));
      if (!cifrada || !sessao) throw new ErroDeDominio("estado_invalido");
      // Revisão do PR #264: o teto de 20 s conta desde aqui; a consulta da conta e o fixarConta saem dele também.
      const inicio = agora();
      const c = criarClienteComposio(op.decifrar(cifrada), op.fetchImpl, { agora, prazoFinal: inicio + VERIFICAR_TETO_MS });
      const ativo = await c.conectado(sessao.contaId, `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`, app.slug);
      if (!ativo) { ctx.json(200, { conectado: false }); return; }
      const fixada = await c.fixarConta(sessao.sessaoId, app.slug, sessao.contaId);
      // NOD-212: o que o próprio Composio diz que a sessão expõe depois de fixar a conta; separa no log a falha dele da nossa.
      log("info", "marketplace_fixar_conta", { toolkit: app.slug, ferramentas_sessao: fixada.ferramentas, avisos: fixada.avisos.join(",") || null });
      // definido em 2026-10-12 (NOD-208): logo depois do fixarConta a sessão do Composio pode ainda não expor o
      // toolkit; a sonda se repete com espera crescente até o teto. Cada tentativa é uma transação: a espera
      // fica FORA dela e não segura conexão do pool. A falha intermediária grava ultimaFalha; o sucesso a limpa.
      // A conta não é reconsultada a cada volta: revogada no meio, cai no `falhou` e o "Tentar de novo" refaz o login.
      let r: SaidaSondarConector | null = null;
      for (const [i, espera] of ESPERAS_SONDA_VERIFICAR_MS.entries()) {
        if (i > 0 && agora() - inicio + espera >= VERIFICAR_TETO_MS) break;
        if (espera > 0) await esperar(espera);
        // Revisão do PR #264: a sonda http sozinha pode levar até ORCAMENTO_CONECTOR_MS (30 s, com nova tentativa
        // por dentro); sem este corte, uma tentativa começada aos ~19 s levava a resposta para perto de 50 s.
        r = await sondarUmaVez(ctx.escopo, sessao.conectorId, app.slug, VERIFICAR_TETO_MS - (agora() - inicio));
        log(r.ok ? "info" : "aviso", "marketplace_verificar_tentativa", { toolkit: app.slug, tentativa: i + 1, ok: r.ok, motivo: r.ok ? null : r.conector.ultimaFalha?.motivo ?? null, decorrido_ms: agora() - inicio });
        if (r.ok) break;
      }
      if (!r) throw new ErroDeDominio("estado_invalido");
      // NOD-212: falha final com a sessão sem nenhuma ferramenta concreta segundo o próprio Composio é dele, não do app nem
      // do nod: a web diz isso e o "Tentar de novo" vai direto a um login novo (sessão nova), sem re-sondar esta.
      const causa = r.ok ? null : fixada.ferramentas === 0 ? "composio" : "app";
      if (!r.ok) log("aviso", "marketplace_verificar_falhou", { toolkit: app.slug, causa, motivo: r.conector.ultimaFalha?.motivo ?? null, ferramentas_sessao: fixada.ferramentas, decorrido_ms: agora() - inicio });
      // definido em 2026-09-25 (revisão do PR #68): conta ativa e sonda falhou = `falhou`, para a web parar de
      // perguntar — sem isso ela repetia fixarConta + sonda a cada 2,5 s por 10 min, com o spinner na tela.
      ctx.json(200, { conectado: r.ok, ...(r.ok ? {} : { falhou: true, causa }), conector: r.conector });
    } },
  ];
}
