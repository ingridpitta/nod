import type { AppComLogo } from "../../contracts/marketplace.ts";
import { catalogoDoPiso, mesclarCatalogo, type AppGerenciado } from "../../domain/catalogo-marketplace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { criarClienteComposio } from "./composio.ts";

/**
 * definido em 2026-09-21 (ADR-041): o catálogo vem do provedor a cada abertura da tela, e uma
 * janela curta evita repetir a chamada em cada F5 sem esconder por muito tempo o app que a pessoa
 * acabou de criar no painel. Cache por TENANT: a chave é do tenant, o catálogo também.
 */
const JANELA_CATALOGO_MS = 60_000;
const catalogoPorTenant = new Map<string, { em: number; apps: AppComLogo[] }>();

/**
 * definido em 2026-09-29 (ADR-057): o catálogo público muda quando o Composio lança um toolkit, não
 * quando alguém mexe no painel — e é a resposta pesada (centenas de itens). Janela de uma hora, à
 * parte da do painel: o app recém-configurado continua aparecendo em um minuto.
 */
const JANELA_GERENCIADOS_MS = 60 * 60_000;
const gerenciadosPorTenant = new Map<string, { em: number; apps: AppGerenciado[] }>();

export type DepsCatalogoComposio = {
  /** Decifra a chave Composio do tenant (ADR-041). */
  decifrar: (texto: string) => string;
  fetchImpl?: typeof fetch;
};

/**
 * O catálogo do provedor, com a curadoria por cima. Falhar aqui NÃO derruba a tela: sem chave,
 * com a chamada fora do ar ou com resposta em forma inesperada, a grade cai no piso curado —
 * o que a pessoa perde é o app novo, não o Marketplace.
 *
 * revisto em 2026-09-29 (ADR-057): o catálogo público entra junto. A falha dele sozinha não leva a
 * grade ao piso: o que está no painel continua aparecendo, e o último catálogo público bom é usado.
 */
export function criarCatalogoComposio(deps: DepsCatalogoComposio) {
  async function gerenciados(tenantId: string, cliente: ReturnType<typeof criarClienteComposio>, agora: number): Promise<AppGerenciado[]> {
    const posto = gerenciadosPorTenant.get(tenantId);
    if (posto && agora - posto.em < JANELA_GERENCIADOS_MS) return posto.apps;
    try {
      const apps = await cliente.gerenciados();
      gerenciadosPorTenant.set(tenantId, { em: agora, apps });
      return apps;
    } catch (e) {
      log("aviso", "marketplace_catalogo_publico_falhou", {
        tenant_id: tenantId,
        codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido",
        usou_cache: !!posto,
      });
      return posto?.apps ?? [];
    }
  }

  return async function catalogo(tenantId: string, cifrada: string | null): Promise<AppComLogo[]> {
    if (!cifrada) return catalogoDoPiso();
    const agora = Date.now();
    const posto = catalogoPorTenant.get(tenantId);
    if (posto && agora - posto.em < JANELA_CATALOGO_MS) return posto.apps;
    try {
      const cliente = criarClienteComposio(deps.decifrar(cifrada), deps.fetchImpl);
      const [doProvedor, publicos] = await Promise.all([cliente.catalogo(), gerenciados(tenantId, cliente, agora)]);
      const apps = doProvedor.length || publicos.length ? mesclarCatalogo(doProvedor, publicos) : catalogoDoPiso();
      catalogoPorTenant.set(tenantId, { em: agora, apps });
      return apps;
    } catch (e) {
      // definido em 2026-09-21: cair no piso em silêncio esconde justamente o que este caminho
      // existe para corrigir — a grade fica plausível e o app novo continua ausente, sem rastro.
      log("aviso", "marketplace_catalogo_do_piso", {
        tenant_id: tenantId,
        codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido",
        usou_cache: !!posto,
      });
      return posto?.apps ?? catalogoDoPiso();
    }
  };
}
