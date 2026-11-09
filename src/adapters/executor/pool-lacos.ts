import type { PonteInterna } from "../../contracts/ponte.ts";
import type { Drenagem } from "../../domain/atualizacao-do-motor.ts";
import { log } from "../../obs/log.ts";

/** O que o pool precisa de um laço: parar. `turnoAtual` é o do laço da L4, repassado para diagnóstico. */
type LacoDoPool = { parar(): Promise<void>; turnoAtual?(): string | null };

export type PoolDeLacos = {
  parar(): Promise<void>;
  /** Laços vivos (ocupados + o ocioso). */
  tamanho(): number;
  /** Turnos rodando agora, um por laço ocupado. */
  turnosAtuais(): string[];
  /**
   * ADR-131: dos turnos rodando, quantos a pessoa espera agora (`daPessoa` no plano; plano sem o campo, de servidor
   * antigo, conta como dela). O motor que se atualiza espera só estes.
   */
  turnosDaPessoa(): number;
  /**
   * ADR-100: com `"fundo"`, o laço ocioso para de puxar trabalho novo de fundo; os turnos que rodam terminam e entregam
   * como sempre. ADR-130: o que a pessoa espera agora continua saindo (`soDaPessoa` no puxar). ADR-131: `"tudo"` não puxa
   * nada (os segundos antes do reinício). `false` volta a puxar tudo.
   */
  drenar(nivel: Drenagem): void;
};

/**
 * Pool ELÁSTICO de laços por pessoa (definido em 2026-09-24, sem teto por decisão do Marlon). Antes um
 * laço só rodava um turno por vez, e a Nina em 30 min de triagem deixava Taga, Gil e as rotinas
 * esperando — sem motivo, porque o reivindicar já só serializa a MESMA conversa e o MESMO agente.
 *
 * Regra: sempre exatamente UM laço ocioso puxando. Quando um laço pega turno e nenhum outro ficou
 * ocioso, sobe mais um; quando um laço volta a puxar e já existe outro ocioso, ele se aposenta. O teto
 * natural é o banco: um turno por agente, então o paralelismo máximo é o número de agentes com trabalho.
 * JS é de uma thread e as contagens são lidas e escritas sem await no meio: dois ociosos nunca se
 * aposentam juntos. O laço em si não muda — o pool só envolve o `puxar` da ponte que cada um recebe.
 */
export function iniciarPoolDeLacos(criar: (ponte: PonteInterna) => LacoDoPool, ponte: PonteInterna): PoolDeLacos {
  /** `daPessoa`: o plano do turno que a vaga puxou por último (ADR-131). */
  type Vaga = { laco: LacoDoPool | null; ocupado: boolean; aposentado: boolean; daPessoa: boolean };
  const vagas = new Set<Vaga>();
  let parando = false;
  let drenando: Drenagem = false;
  const ociosos = () => [...vagas].filter((v) => !v.ocupado && !v.aposentado).length;

  function subir(): void {
    const vaga: Vaga = { laco: null, ocupado: false, aposentado: false, daPessoa: false };
    vagas.add(vaga);
    const envolvida: PonteInterna = {
      ...ponte,
      puxar: async (pessoaId, maquina) => {
        vaga.ocupado = false;
        if (parando || vaga.aposentado || drenando === "tudo") return null;
        if (ociosos() > 1) {
          vaga.aposentado = true;
          vagas.delete(vaga);
          // Sem await: parar() espera a corrida do próprio laço, que está AQUI dentro. Devolver null faz o
          // laço ver `parado` logo depois e sair; não há adapter vivo entre turnos.
          void vaga.laco?.parar();
          return null;
        }
        // revisto em 2026-10-26 (ADR-130): drenando, o laço ainda pega o que a pessoa espera agora (a fala dela, a ligação):
        // a drenagem durava até 10 min por hora e a mensagem dela ficava "na fila" sem motivo visível. O fundo espera.
        const plano = drenando ? await ponte.puxar(pessoaId, maquina, { soDaPessoa: true }) : await ponte.puxar(pessoaId, maquina);
        if (plano) {
          vaga.ocupado = true;
          vaga.daPessoa = plano.daPessoa !== false;
          if (!parando && ociosos() === 0) subir();
        }
        return plano;
      },
    };
    vaga.laco = criar(envolvida);
  }

  subir();
  return {
    async parar() {
      parando = true;
      const todas = [...vagas];
      vagas.clear();
      for (const v of todas) {
        try {
          await v.laco?.parar();
        } catch (e) {
          log("erro", "laco_do_pool_nao_parou", { erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
    },
    tamanho: () => vagas.size,
    turnosAtuais: () => [...vagas].map((v) => v.laco?.turnoAtual?.() ?? null).filter((t): t is string => t !== null),
    // `ocupado` (do plano puxado até o próximo puxar) cobre o instante entre o puxar e o laço marcar o turno atual.
    turnosDaPessoa: () => [...vagas].filter((v) => v.ocupado && v.daPessoa).length,
    drenar(nivel) { drenando = nivel; },
  };
}
