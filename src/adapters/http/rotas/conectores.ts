import type { ServerResponse } from "node:http";
import { criarCatalogoComposio } from "../../integracoes/catalogo-composio.ts";
import { atualizarCredenciaisConector } from "../../../use-cases/atualizar-credenciais-conector.ts";
import type { SensibilidadeDeclarada, TransporteConector } from "../../../contracts/conector.ts";
import { grupoDaCapacidade } from "../../../domain/grupos-de-acesso.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { habilitarConector } from "../../../use-cases/habilitar-conector.ts";
import { conectorPublico, registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector } from "../../../use-cases/sondar-conector.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasConectores = {
  dentro: DentroDeTx;
  /** Cifra o env do conector com a chave do servidor (NOD_CREDENTIAL_KEY via src/db/cifra.ts, composto pela L9). */
  cifrar: (texto: string) => string;
  /** Decifra a chave Composio do tenant para pedir o catálogo ao provedor (ADR-041). */
  decifrar: (texto: string) => string;
  fetchImpl?: typeof fetch;
};

/**
 * O logo é buscado PELO SERVIDOR (ADR-041 §6): um <img> apontando para o CDN faria o browser de
 * cada pessoa contar ao provedor quais apps o time abre. Cache longo — logo de app não muda — e
 * teto de tamanho para um CDN trocado não virar memória do servidor.
 */
const JANELA_LOGO_MS = 6 * 60 * 60 * 1000;
const TETO_LOGO_BYTES = 256 * 1024;
const TIPOS_LOGO = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/x-icon"]);
const logoPorSlug = new Map<string, { em: number; bytes: Buffer; tipo: string } | { em: number; bytes: null }>();

function escreverLogo(res: ServerResponse, bytes: Buffer, tipo: string): void {
  res.writeHead(200, {
    "content-type": tipo,
    "content-length": String(bytes.byteLength),
    "cache-control": "private, max-age=21600",
    // O logo vem de terceiro: nada de script, e o browser respeita o tipo declarado.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "x-content-type-options": "nosniff",
  });
  res.end(bytes);
}

type CorpoConector = {
  nome?: unknown;
  slug?: unknown;
  transporte?: unknown;
  comando?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
  declaracao?: unknown;
};

/**
 * Rotas finas de conectores (tabela ROTAS, lane L5): listar, registrar (nasce desabilitado), sondar,
 * habilitar, desabilitar. A web recebe `Conector` (env só com chaves → true); nada cifrado sai.
 */
export function rotasConectores(deps: DepsRotasConectores): Rota[] {
  // O cache mora em src/adapters/integracoes/catalogo-composio.ts: a rota de conectar lê o mesmo (ADR-057).
  const catalogo = criarCatalogoComposio(deps);
  return [
    {
      metodo: "GET",
      padrao: /^\/marketplace\/(?<slug>[a-z0-9_-]{1,64})\/logo$/,
      async handler(ctx) {
        const slug = ctx.params.slug ?? "";
        const posto = logoPorSlug.get(slug);
        const fresco = posto && Date.now() - posto.em < JANELA_LOGO_MS;
        if (fresco && posto.bytes === null) { ctx.json(404, { codigo: "nao_encontrado" }); return; }
        if (fresco && posto.bytes) { escreverLogo(ctx.res, posto.bytes, posto.tipo); return; }

        // A URL sai do catálogo já validada por urlDoProvedor (host na allowlist, https, sem porta).
        const cifrada = await deps.dentro(ctx.escopo, (d) => d.repos.composio.chave());
        const apps = await catalogo(ctx.escopo.tenantId, cifrada);
        const url = apps.find((a) => a.slug === slug)?.logo;
        if (!url) { logoPorSlug.set(slug, { em: Date.now(), bytes: null }); ctx.json(404, { codigo: "nao_encontrado" }); return; }
        try {
          const r = await (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
          const tipo = (r.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
          if (!r.ok || !TIPOS_LOGO.has(tipo)) throw new ErroDeDominio("conector_indisponivel");
          const bytes = Buffer.from(await r.arrayBuffer());
          if (bytes.byteLength > TETO_LOGO_BYTES) throw new ErroDeDominio("conector_indisponivel");
          logoPorSlug.set(slug, { em: Date.now(), bytes, tipo });
          escreverLogo(ctx.res, bytes, tipo);
        } catch {
          // Piso: a tela desenha a inicial do nome. Marca a ausência para não repetir a busca a cada card.
          logoPorSlug.set(slug, { em: Date.now(), bytes: null });
          ctx.json(404, { codigo: "nao_encontrado" });
        }
      },
    },
    {
      metodo: "PATCH", acao: "apps.credenciais", padrao: /^\/conectores\/(?<id>[^/]+)\/credenciais$/,
      async handler(ctx) {
        const c = await ctx.corpo() as { env?: unknown } | null;
        if (!c || typeof c !== "object") throw new ErroDeDominio("entrada_invalida");
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, atualizarCredenciaisConector, { conectorId: ctx.params.id ?? "", env: c.env, cifrar: deps.cifrar }));
        ctx.json(200, { conector });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/conectores$/,
      async handler(ctx) {
        // definido em 2026-09-25: cada ação sai com o grupo (ler, criar, editar, comentar, apagar) — a web
        // mostra "Ler e alterar" e os grupos do card sem refazer a classificação (src/domain/grupos-de-acesso.ts).
        const conectores = await deps.dentro(ctx.escopo, async (d) => (await d.repos.conectores.listar()).map((c) => {
          const p = conectorPublico(c);
          return { ...p, catalogo: p.catalogo.map((cap) => ({ ...cap, grupo: grupoDaCapacidade(cap) })) };
        }));
        const cifrada = await deps.dentro(ctx.escopo, (d) => d.repos.composio.chave());
        const marketplace = await catalogo(ctx.escopo.tenantId, cifrada);
        ctx.json(200, { conectores, marketplace, composioConfigurado: !!cifrada });
      },
    },
    {
      metodo: "POST", acao: "apps.criar",
      padrao: /^\/conectores$/,
      async handler(ctx) {
        const c = (await ctx.corpo()) as CorpoConector;
        if (typeof c !== "object" || c === null) throw new ErroDeDominio("entrada_invalida");
        const conector = await deps.dentro(ctx.escopo, (d) =>
          executar(d, registrarConector, {
            nome: typeof c.nome === "string" ? c.nome : "",
            slug: typeof c.slug === "string" ? c.slug : "",
            transporte: c.transporte as TransporteConector,
            comando: typeof c.comando === "string" ? c.comando : null,
            args: Array.isArray(c.args) ? (c.args as string[]) : [],
            url: typeof c.url === "string" ? c.url : null,
            env: typeof c.env === "object" && c.env !== null ? (c.env as Record<string, string | true>) : {},
            declaracao: (typeof c.declaracao === "string" ? c.declaracao : undefined) as SensibilidadeDeclarada | undefined,
            cifrar: deps.cifrar,
          }),
        );
        ctx.json(201, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
    {
      metodo: "POST", acao: "apps.sondar",
      padrao: /^\/conectores\/(?<id>[^/]+)\/sondar$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, sondarConector, { conectorId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: r.ok, ids: { conector: r.conector.id }, conector: r.conector });
      },
    },
    {
      metodo: "POST", acao: "apps.habilitar",
      padrao: /^\/conectores\/(?<id>[^/]+)\/habilitar$/,
      async handler(ctx) {
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, habilitarConector, { conectorId: ctx.params.id ?? "", habilitado: true }));
        ctx.json(200, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
    {
      metodo: "POST", acao: "apps.desabilitar",
      padrao: /^\/conectores\/(?<id>[^/]+)\/desabilitar$/,
      async handler(ctx) {
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, habilitarConector, { conectorId: ctx.params.id ?? "", habilitado: false }));
        ctx.json(200, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
  ];
}
