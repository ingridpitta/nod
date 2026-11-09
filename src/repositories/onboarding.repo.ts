import type { CampoEntrevista, CamposEntrevista, EtapaOnboarding, TamanhoTime } from "../contracts/onboarding.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/** O onboarding da pessoa (0049): uma linha de `preferencias`, criada na primeira escrita. */
export type LinhaOnboarding = {
  etapa: EtapaOnboarding | null;
  guiaId: string | null;
  botId: string | null;
  concluidoEm: number | null;
  campos: CamposEntrevista;
};

interface Linha {
  onboarding_etapa: EtapaOnboarding | null;
  onboarding_guia_id: string | null;
  onboarding_bot_id: string | null;
  onboarding_concluido_em: Date | null;
  apelido: string | null;
  como_conheceu: string | null;
  objetivo: string | null;
  tamanho_time: TamanhoTime | null;
}

const VAZIA: LinhaOnboarding = { etapa: null, guiaId: null, botId: null, concluidoEm: null, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } };

function paraOnboarding(l: Linha | undefined): LinhaOnboarding {
  if (!l) return VAZIA;
  return {
    etapa: l.onboarding_etapa,
    guiaId: l.onboarding_guia_id,
    botId: l.onboarding_bot_id,
    concluidoEm: l.onboarding_concluido_em ? ms(l.onboarding_concluido_em) : null,
    campos: { apelido: l.apelido, comoConheceu: l.como_conheceu, objetivo: l.objetivo, tamanhoTime: l.tamanho_time },
  };
}

const COLUNAS = "onboarding_etapa, onboarding_guia_id, onboarding_bot_id, onboarding_concluido_em, apelido, como_conheceu, objetivo, tamanho_time";

/** A coluna de cada campo da entrevista (lista fechada: nunca vem de fora). */
const COLUNA_DO_CAMPO: Record<CampoEntrevista, "apelido" | "como_conheceu" | "objetivo" | "tamanho_time"> = {
  apelido: "apelido",
  como_conheceu: "como_conheceu",
  objetivo: "objetivo",
  tamanho_time: "tamanho_time",
};

export function onboardingRepo(conn: Conn, escopo: Escopo) {
  /** Garante a linha da pessoa e aplica `set` (o upsert de preferencias é por (tenant, owner), 0036). */
  async function gravar(set: Record<string, string | Date | null>): Promise<LinhaOnboarding> {
    const [l] = await conn<Linha[]>`
      insert into preferencias ${conn({ tenant_id: escopo.tenantId, owner_id: escopo.pessoaId, ...set })}
      on conflict (tenant_id, owner_id) do update set ${conn({ ...set, atualizado_em: new Date() })}
      returning ${conn.unsafe(COLUNAS)}`;
    return paraOnboarding(l);
  }

  return {
    async buscar(): Promise<LinhaOnboarding> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return paraOnboarding(l);
    },
    definirEtapa: (etapa: Exclude<EtapaOnboarding, "concluido">) => gravar({ onboarding_etapa: etapa }),
    /**
     * "Ver o onboarding de novo": volta ao "olá", tira a conclusão e esquece a entrevista e o bot novo (ele continua um
     * bot comum da pessoa); a guia fica, para a mesma Nina ligar de novo.
     */
    reiniciar: () => gravar({ onboarding_etapa: "ola", onboarding_concluido_em: null, onboarding_bot_id: null, apelido: null, como_conheceu: null, objetivo: null, tamanho_time: null }),
    concluir: (agora: number) => gravar({ onboarding_etapa: "concluido", onboarding_concluido_em: new Date(agora) }),
    anotar: (campo: CampoEntrevista, valor: string) => gravar({ [COLUNA_DO_CAMPO[campo]]: valor }),
    definirGuia: (agenteId: string) => gravar({ onboarding_guia_id: agenteId }),
    definirBot: (agenteId: string) => gravar({ onboarding_bot_id: agenteId }),
  };
}
