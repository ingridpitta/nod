import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { IdentidadeDeTurno, IdentidadeSemTurno, ServicesNod } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import type { Escopo, Relogio } from "../shared/types.ts";
import { escopoAlegado } from "./token-maquina.ts";

/**
 * Token de turno (ADR-024, core-features §credencial): 24 bytes aleatórios, guardados na MEMÓRIA do servidor
 * (Map turnoId → {hash sha256, epoch, expira, identidade}); `autorizar` compara em tempo constante e devolve a IDENTIDADE
 * (tenant, pessoa, agente, turno) — o remetente nunca vem do texto. Cunhar de novo para o mesmo turno avança o epoch e
 * invalida o token anterior. O plano emitido fica guardado junto do token: GET /api/interno/plano devolve
 * `planoDe(turnoId)` (rotas/interno.ts).
 *
 * revisto em 2026-10-12 (NOD-214, revisão da EMENDA 3): o HASH do token também vai para o banco (`turno_credenciais`,
 * 0073), gravado por quem despacha. Depois de um reinício do servidor, o token que chega e não está na memória é
 * procurado lá (`autorizarComBanco`) e volta para a memória; o plano é recomposto pelo mesmo caminho do emitir, sem
 * cunhar outro token (`planoOuRecompor`). Por isso o token agora leva o escopo ALEGADO na frente, como a chave de máquina
 * (ADR-031): com RLS FORCE, procurar o hash sem escopo nunca acha a linha. O escopo não autoriza nada sozinho — o hash
 * cobre o token inteiro, e trocar a metade do escopo muda o hash. Token sem escopo (cunhado antes deste formato) segue
 * valendo só pela memória, como antes.
 *
 *   token = base64url(JSON{t: tenantId, p: pessoaId}) "." base64url(randomBytes(24))
 */
export type { IdentidadeSemTurno };

/** O que o banco guarda do token (só o hash): o bastante para reconhecê-lo depois de um reinício. */
export type CredencialGuardada = { turnoId: string; tokenHash: Buffer; epoch: number; identidade: IdentidadeSemTurno; sobreviveReinicio: boolean };

export type TokenTurno = ServicesNod<unknown>["tokenTurno"] & {
  /** A identidade é opcional só quando `identidadeDe` foi injetado (resolvida pelo turno); o contrato a exige. */
  cunhar(turnoId: string, identidade?: IdentidadeSemTurno): string;
  guardarPlano(plano: PlanoTurno): void;
  planoDe(turnoId: string): PlanoTurno | null;
  /**
   * Quantos tokens vivos (métrica/testes). NOD-214: `semSobrevive` conta só os de máquina que NÃO atravessa o reinício
   * do servidor — são esses que a drenagem do deploy ainda espera.
   */
  ativos(o?: { semSobrevive?: boolean }): number;
  /** NOD-214: o hash e o epoch do token vivo do turno, para quem despacha gravar no banco. null = sem token. */
  credencialDe(turnoId: string): { tokenHash: Buffer; epoch: number; identidade: IdentidadeSemTurno } | null;
  /** NOD-214: a máquina do turno atravessa o reinício (o anúncio dela): o token não segura a drenagem. */
  marcarSobrevive(turnoId: string): void;
  /** NOD-214: como `autorizar`, mas o token que falta na memória é procurado no banco e volta para ela. */
  autorizarComBanco(token: unknown): Promise<IdentidadeDeTurno | null>;
  /**
   * NOD-214 (a adoção, rotas/ponte.ts): recoloca na memória o token de um turno que o banco reconheceu. Não troca um
   * token mais novo (epoch maior) que já esteja na memória. false = não adotou.
   */
  adotar(token: string, c: CredencialGuardada): boolean;
  /**
   * definido em 2026-10-22 (NOD-218, drenagem do deploy azul/verde): daqui em diante o token vale só pelo banco. A outra
   * cor já é a ativa e é ela quem assenta e revoga turnos; a memória deste processo não fica sabendo. `autorizar`
   * (síncrono, só memória) passa a devolver null e `autorizarComBanco` ignora a memória: turno que saiu de `despachando`
   * no banco deixa de autorizar aqui também. Não tem volta (o processo está saindo).
   */
  modoSoBanco(): void;
  /**
   * definido em 2026-10-22 (NOD-331, drenagem): consulta no banco cada token que segura a drenagem (sem `sobrevive`) e
   * apaga o que o banco já não reconhece (turno fora de `despachando`: a outra cor o assentou). Coerente com o
   * `modoSoBanco`: esse token já não autoriza aqui. Erro do banco mantém a entrada (loga `token_poda_falhou` uma vez).
   * Devolve quantos podou; sem `buscar`, nada.
   */
  podarPeloBanco(): Promise<number>;
  /** NOD-214: o plano guardado ou, do turno adotado depois de um reinício, recomposto (sem cunhar token novo). */
  planoOuRecompor(turnoId: string): Promise<PlanoTurno | null>;
};

/** NOD-288: o plano recomposto e se ele é provisório (a máquina ainda não reconectou). */
export type PlanoRecomposto = { plano: PlanoTurno; provisorio: boolean };

export type OpcoesTokenTurno = {
  agora: Relogio;
  /**
   * revisto em 2026-10-01 (ADR-067): sem validade por relógio — o token vale enquanto o turno vive, como o plano.
   * Some na entrega e quando o varredor assenta o turno pelo lease (revogar); o reinício do servidor apaga a memória (o
   * banco guarda o hash, NOD-214). Os testes ainda passam um valor para provar a expiração.
   */
  validadeMs?: number;
  /** Resolve a identidade quando cunhar() vier só com o turnoId (composição da L9); sem isto e sem identidade, cunhar lança estado_invalido. */
  identidadeDe?: (turnoId: string) => IdentidadeSemTurno | null;
  /** NOD-214: a credencial pelo hash do token, no escopo que o token alega (`turno_credenciais`, só turno `despachando`). */
  buscar?: (escopo: Escopo, hash: Buffer) => Promise<CredencialGuardada | null>;
  /**
   * NOD-214: recompõe o plano do turno adotado pelo caminho do emitir, com o token que já existe.
   * revisto em 2026-10-15 (NOD-288): `provisorio` = recomposto sem a máquina conectada (capacidades "não sei"); vale só
   * para a chamada e não entra no cache, para a próxima, já com a máquina de volta, recompor com as capacidades reais.
   */
  recompor?: (identidade: IdentidadeDeTurno, token: string) => Promise<PlanoRecomposto | null>;
};

type Entrada = { hash: Buffer; epoch: number; expira: number; identidade: IdentidadeSemTurno; plano: PlanoTurno | null; sobrevive: boolean; token: string | null };

const hashDe = (token: string): Buffer => createHash("sha256").update(token).digest();
const casa = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

export function criarTokenTurno(opcoes: OpcoesTokenTurno): TokenTurno {
  const validade = opcoes.validadeMs ?? Number.POSITIVE_INFINITY;
  const porTurno = new Map<string, Entrada>();
  const porHash = new Map<string, string>();
  const recompondo = new Map<string, Promise<PlanoTurno | null>>();
  let soBanco = false;
  let podaFalhouLogada = false;

  function apagar(turnoId: string): void {
    const e = porTurno.get(turnoId);
    if (!e) return;
    porHash.delete(e.hash.toString("hex"));
    porTurno.delete(turnoId);
  }

  function daMemoria(token: unknown): IdentidadeDeTurno | null {
    if (typeof token !== "string" || token === "") return null;
    const hash = hashDe(token);
    const turnoId = porHash.get(hash.toString("hex"));
    if (!turnoId) return null;
    const e = porTurno.get(turnoId);
    if (!e || !casa(e.hash, hash)) return null;
    if (e.expira <= opcoes.agora()) {
      apagar(turnoId);
      return null;
    }
    return { turnoId, ...e.identidade };
  }

  function adotar(token: string, c: CredencialGuardada): boolean {
    const hash = hashDe(token);
    if (!casa(c.tokenHash, hash)) return false;
    const atual = porTurno.get(c.turnoId);
    if (atual && casa(atual.hash, hash)) {
      atual.token ??= token;
      if (c.sobreviveReinicio) atual.sobrevive = true;
      return true;
    }
    // Um token mais novo do mesmo turno já está na memória: o apresentado é o antigo, e não volta.
    if (atual && atual.epoch >= c.epoch) return false;
    apagar(c.turnoId);
    porTurno.set(c.turnoId, { hash, epoch: c.epoch, expira: opcoes.agora() + validade, identidade: c.identidade, plano: null, sobrevive: c.sobreviveReinicio, token });
    porHash.set(hash.toString("hex"), c.turnoId);
    return true;
  }

  return {
    cunhar(turnoId: string, identidade?: IdentidadeSemTurno): string {
      const id = identidade ?? opcoes.identidadeDe?.(turnoId) ?? null;
      if (!id || !id.tenantId || !id.pessoaId || !id.agenteId) throw new ErroDeDominio("estado_invalido", { cause: "cunhar sem identidade do turno" });
      const anterior = porTurno.get(turnoId);
      apagar(turnoId);
      const alegado = Buffer.from(JSON.stringify({ t: id.tenantId, p: id.pessoaId }), "utf8").toString("base64url");
      const token = `${alegado}.${randomBytes(24).toString("base64url")}`;
      const hash = hashDe(token);
      porTurno.set(turnoId, { hash, epoch: (anterior?.epoch ?? 0) + 1, expira: opcoes.agora() + validade, identidade: id, plano: anterior?.plano ?? null, sobrevive: false, token: null });
      porHash.set(hash.toString("hex"), turnoId);
      return token;
    },

    autorizar(token) {
      return soBanco ? null : daMemoria(token);
    },

    modoSoBanco() {
      soBanco = true;
    },

    async podarPeloBanco() {
      const buscar = opcoes.buscar;
      if (!buscar) return 0;
      const alvos = [...porTurno.entries()].filter(([, e]) => !e.sobrevive);
      let podados = 0;
      await Promise.all(
        alvos.map(async ([turnoId, e]) => {
          try {
            const c = await buscar({ tenantId: e.identidade.tenantId, pessoaId: e.identidade.pessoaId }, e.hash);
            // Só apaga a MESMA entrada consultada (um cunhar ou adotar no meio troca a entrada do turno).
            if (c === null && porTurno.get(turnoId) === e) {
              apagar(turnoId);
              podados++;
            }
          } catch (erro) {
            if (!podaFalhouLogada) {
              podaFalhouLogada = true;
              log("aviso", "token_poda_falhou", { erro: erro instanceof Error ? erro.name : "erro" });
            }
          }
        }),
      );
      return podados;
    },

    async autorizarComBanco(token) {
      if (soBanco) {
        if (!opcoes.buscar || typeof token !== "string") return null;
        const escopo = escopoAlegado(token);
        if (!escopo) return null;
        const c = await opcoes.buscar(escopo, hashDe(token));
        if (!c || !casa(c.tokenHash, hashDe(token)) || c.identidade.tenantId !== escopo.tenantId || c.identidade.pessoaId !== escopo.pessoaId) return null;
        return { turnoId: c.turnoId, ...c.identidade };
      }
      const naMemoria = daMemoria(token);
      if (naMemoria || !opcoes.buscar || typeof token !== "string") return naMemoria;
      const escopo = escopoAlegado(token);
      if (!escopo) return null;
      const c = await opcoes.buscar(escopo, hashDe(token));
      if (!c || c.identidade.tenantId !== escopo.tenantId || c.identidade.pessoaId !== escopo.pessoaId) return null;
      if (!adotar(token, c)) return null;
      return daMemoria(token);
    },

    adotar,

    revogar(turnoId) {
      apagar(turnoId);
    },

    guardarPlano(plano) {
      const e = porTurno.get(plano.turnoId);
      if (!e) throw new ErroDeDominio("estado_invalido", { cause: "plano sem token cunhado" });
      e.plano = plano;
    },

    planoDe(turnoId) {
      return porTurno.get(turnoId)?.plano ?? null;
    },

    async planoOuRecompor(turnoId) {
      const e = porTurno.get(turnoId);
      if (!e) return null;
      if (e.plano) return e.plano;
      if (!opcoes.recompor || !e.token) return null;
      const emCurso = recompondo.get(turnoId);
      if (emCurso) return emCurso;
      const token = e.token;
      const p = opcoes.recompor({ turnoId, ...e.identidade }, token)
        .then((r) => {
          // O token pode ter sido revogado (entrega, lease) ou trocado enquanto o plano era recomposto: não volta.
          const agora = porTurno.get(turnoId);
          // NOD-288: o provisório (máquina ainda sem conexão) não fica em cache; a próxima chamada recompõe.
          if (r && !r.provisorio && agora && agora.token === token) agora.plano = r.plano;
          return agora && agora.token === token ? (r?.plano ?? null) : null;
        })
        .finally(() => recompondo.delete(turnoId));
      recompondo.set(turnoId, p);
      return p;
    },

    credencialDe(turnoId) {
      const e = porTurno.get(turnoId);
      return e ? { tokenHash: e.hash, epoch: e.epoch, identidade: e.identidade } : null;
    },

    marcarSobrevive(turnoId) {
      const e = porTurno.get(turnoId);
      if (e) e.sobrevive = true;
    },

    ativos(o) {
      if (!o?.semSobrevive) return porTurno.size;
      let n = 0;
      for (const e of porTurno.values()) if (!e.sobrevive) n++;
      return n;
    },
  };
}
