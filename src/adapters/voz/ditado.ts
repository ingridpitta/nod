import { DITADO_MAX_S, type ErroDitado, type MsgDitadoServidor } from "../../contracts/ditado.ts";
import { FECHAMENTOS_VOZ, QUADRO_MS } from "../../contracts/voz.ts";
import { juntarTrechos, OPCOES_VAD_DITADO, PRAZO_FINAIS_MS } from "../../domain/ditado.ts";
import { criarVad, VOZ_MINIMA_MS } from "../../domain/ligacao-vad.ts";
import { log } from "../../obs/log.ts";
import { lerQuadroMicrofone, PRECOS } from "./orquestrador.ts";
import type { SessaoStt, Transcritor } from "./spi.ts";
import { lerJson, type CanalVoz } from "./ws.ts";

/**
 * Ditado no campo de mensagem (definido em 2026-10-11, ADR-095). Um ditado por conexão do canal
 * `/api/t/:tenant/voz/v1/ditado`: o áudio vai ao STT enquanto a pessoa fala, cortado nas pausas pelo VAD da ligação (o
 * mesmo pré-roll do orquestrador), e no `concluir` o servidor fecha a fala em curso, espera os finais e devolve o texto
 * inteiro. Nada é gravado; o log leva só contagens e tempos, nunca o texto (ADR-075).
 *
 * Não importa banco: quem autoriza (sessão, permissão, consentimento) é a composição, antes de chamar `abrir`.
 */

/** definido em 2026-10-11 (o mesmo do orquestrador): o começo da fala que o VAD só confirma depois de 3 quadros. */
const PRE_ROLL_QUADROS = 15;
/**
 * definido em 2026-10-11: áudio acima de 1,2× o tempo real é abuso (como na ligação), com 4 s de folga — o cliente
 * guarda os quadros até o `pronto` e os manda de uma vez quando o STT abre.
 */
const FATOR_ABUSO = 1.2;
const FOLGA_ABUSO_MS = 4_000;

export type DesfechoDitado = "concluido" | "teto" | "descartado" | "caiu" | "erro";

export type OpcoesServicoDitado = {
  transcritor: Transcritor;
  relogio?: () => number;
  /** Para teste; o padrão é `DITADO_MAX_S`. */
  maxMs?: number;
  /** Para teste; o padrão é `PRAZO_FINAIS_MS`. */
  prazoFinaisMs?: number;
};

export interface ServicoDitado {
  /**
   * Um ditado novo da pessoa neste canal (já autorizado). Um ditado anterior dela ainda aberto (outra aba, recarga) é
   * descartado: vale o último microfone apertado.
   */
  abrir(p: { pessoaId: string; canal: CanalVoz; vocabulario: readonly string[] }): Promise<void>;
  /** Recusa antes de abrir: manda o código e fecha (a composição decidiu que não pode). */
  recusar(canal: CanalVoz, codigo: ErroDitado): void;
  vivos(): number;
  fechar(): Promise<void>;
}

export function criarServicoDitado(o: OpcoesServicoDitado): ServicoDitado {
  const relogio = o.relogio ?? Date.now;
  const maxMs = o.maxMs ?? DITADO_MAX_S * 1000;
  const prazoFinaisMs = o.prazoFinaisMs ?? PRAZO_FINAIS_MS;
  const vivos = new Map<string, { descartar(): void }>();

  const enviar = (canal: CanalVoz, m: MsgDitadoServidor) => canal.enviarJson(m);

  return {
    recusar(canal, codigo) {
      enviar(canal, { t: "erro", codigo });
      canal.fechar(1000, codigo);
    },

    async abrir({ pessoaId, canal, vocabulario }) {
      vivos.get(pessoaId)?.descartar();
      const abertoEm = relogio();
      const vad = criarVad(OPCOES_VAD_DITADO);
      const preRoll: Int16Array[] = [];
      const finais: string[] = [];
      let esperados = 0;
      let quadros = 0;
      let sttSegundos = 0;
      let falando = false;
      let acabou = false;
      let concluindo = false;
      let sessao: SessaoStt | null = null;
      let aoFinal: (() => void) | null = null;

      const eu = { descartar: () => encerrar("descartado") };
      vivos.set(pessoaId, eu);

      function encerrar(desfecho: DesfechoDitado, extra: { caracteres?: number; msAteTexto?: number; destino?: string } = {}, codigo = 1000): void {
        if (acabou) return;
        acabou = true;
        if (vivos.get(pessoaId) === eu) vivos.delete(pessoaId);
        const s = sessao;
        sessao = null;
        if (s) void s.fechar().catch(() => undefined);
        canal.fechar(codigo, desfecho);
        const preco = PRECOS[o.transcritor.id];
        log("info", "voz_ditado_encerrado", {
          provedor: o.transcritor.id,
          desfecho,
          destino: extra.destino,
          duracao_ms: quadros * QUADRO_MS,
          trechos: esperados,
          caracteres: extra.caracteres,
          ms_ate_texto: extra.msAteTexto,
          stt_segundos: Math.round(sttSegundos * 10) / 10,
          custo_estimado_usd: preco ? Math.round(sttSegundos * preco.sttPorSegundo * 1e6) / 1e6 : undefined,
          aberto_ms: relogio() - abertoEm,
        });
      }

      function falhar(codigo: ErroDitado, motivo: string): void {
        if (acabou) return;
        log("aviso", "voz_ditado_falhou", { provedor: o.transcritor.id, motivo });
        enviar(canal, { t: "erro", codigo });
        encerrar("erro");
      }

      /** Fecha o trecho em curso: com voz de verdade vira um final esperado; tosse e estalo são descartados. */
      function fecharTrecho(vozMs: number): void {
        falando = false;
        if (!sessao) return;
        if (vozMs >= VOZ_MINIMA_MS) {
          esperados++;
          sessao.fimDeFala();
        } else sessao.descartar();
      }

      function aoQuadro(pcm: Int16Array): void {
        if (acabou || concluindo || !sessao) return;
        const agora = quadros * QUADRO_MS;
        quadros++;
        if (agora > (relogio() - abertoEm) * FATOR_ABUSO + FOLGA_ABUSO_MS) {
          log("aviso", "voz_audio_acima_do_tempo_real", { canal: "ditado" });
          encerrar("erro", {}, FECHAMENTOS_VOZ.abuso);
          return;
        }
        const ev = vad.passo(pcm, agora);
        if (!falando) {
          preRoll.push(pcm);
          if (preRoll.length > PRE_ROLL_QUADROS) preRoll.shift();
        }
        if (ev?.tipo === "inicio") {
          falando = true;
          for (const q of preRoll) sessao.enviar(q);
          sttSegundos += (preRoll.length * QUADRO_MS) / 1000;
          preRoll.length = 0;
        } else if (falando) {
          sessao.enviar(pcm);
          sttSegundos += QUADRO_MS / 1000;
          if (ev?.tipo === "fim") fecharTrecho(ev.vozMs);
        }
        if (agora + QUADRO_MS >= maxMs) void concluir("teto");
      }

      async function concluir(como: "concluido" | "teto", destino?: string): Promise<void> {
        if (acabou || concluindo) return;
        concluindo = true;
        const t0 = relogio();
        if (falando) {
          const fim = vad.encerrarTrecho();
          fecharTrecho(fim?.vozMs ?? 0);
        }
        if (finais.length < esperados) {
          await new Promise<void>((resolver) => {
            const prazo = setTimeout(resolver, prazoFinaisMs);
            prazo.unref?.();
            aoFinal = () => {
              if (finais.length < esperados) return;
              clearTimeout(prazo);
              resolver();
            };
          });
          aoFinal = null;
        }
        if (acabou) return;
        if (finais.length < esperados) log("aviso", "voz_ditado_final_atrasado", { provedor: o.transcritor.id, faltaram: esperados - finais.length });
        const texto = juntarTrechos(finais);
        enviar(canal, como === "teto" ? { t: "texto", texto, teto: true } : { t: "texto", texto });
        encerrar(como, { caracteres: texto.length, msAteTexto: relogio() - t0, destino });
      }

      canal.aoMensagem((m) => {
        if ("binario" in m) {
          const q = lerQuadroMicrofone(m.binario);
          if (q) aoQuadro(q.pcm);
          return;
        }
        const msg = lerJson(m.texto);
        if (msg?.t === "concluir") void concluir("concluido", msg.destino === "enviar" ? "enviar" : "campo");
        else if (msg?.t === "descartar") encerrar("descartado");
      });
      canal.aoFechar(() => encerrar("caiu"));

      try {
        sessao = await o.transcritor.abrir({
          idioma: "pt-BR",
          // definido em 2026-10-11: os termos que a ligação já passa, mais os nomes dos bots de quem dita.
          vocabulario: ["nod", "bot", "bots", "rotina", "e-mail", ...vocabulario],
          aoResultado: (r) => {
            if (!r.final || acabou) return;
            finais.push(r.texto);
            aoFinal?.();
          },
          aoErro: (e) => falhar("voz_fora", e.name),
        });
      } catch (e) {
        falhar("voz_fora", e instanceof Error ? e.name : "desconhecido");
        return;
      }
      if (acabou) {
        void sessao.fechar().catch(() => undefined);
        sessao = null;
        return;
      }
      enviar(canal, { t: "pronto", maxS: Math.round(maxMs / 1000) });
    },

    vivos: () => vivos.size,

    async fechar() {
      for (const v of [...vivos.values()]) v.descartar();
    },
  };
}
