/**
 * Ditado no campo de mensagem (definido em 2026-10-11, ADR-095): a pessoa aperta o microfone, fala, e o texto entra no
 * campo (■) ou vai direto como mensagem (↑). Sem texto ao vivo na tela; o áudio vai ao STT enquanto ela fala, para o
 * texto estar pronto logo depois do clique.
 *
 * Canal: WebSocket `/api/t/:tenant/voz/v1/ditado`, mesmo protocolo nod-voz/1 da ligação (src/contracts/voz.ts): os
 * quadros binários do microfone são os mesmos (`0x01` + seq u32 LE + PCM16LE mono a 16 kHz, 20 ms); o controle vai em
 * JSON `{t, …}`. Um ditado por conexão: depois do `texto` (ou do `erro`) o servidor fecha.
 */

/** definido em 2026-10-11: teto de um ditado. Passou disso, o servidor conclui sozinho (o texto vem com `teto`). */
export const DITADO_MAX_S = 5 * 60;

/** Por que o ditado não abriu ou não terminou (código fechado; a tela escolhe o texto). */
export const ERROS_DITADO = ["sem_permissao", "sem_consentimento", "ja_ditando", "voz_fora", "falhou"] as const;
export type ErroDitado = (typeof ERROS_DITADO)[number];

/** Cliente → servidor. */
export type MsgDitadoCliente =
  | { t: "ola"; v: number }
  /** A pessoa apertou ■ (`campo`) ou ↑ (`enviar`): fecha a fala em curso e devolve o texto inteiro. O destino só vai ao log. */
  | { t: "concluir"; destino: "campo" | "enviar" }
  /** Esc, troca de conversa, tela bloqueada: joga tudo fora, sem texto. */
  | { t: "descartar" };

/** Servidor → cliente. */
export type MsgDitadoServidor =
  | { t: "pronto"; maxS: number }
  /** O texto do ditado inteiro (pode ser vazio: ninguém falou). `teto`: o servidor concluiu por `DITADO_MAX_S`. */
  | { t: "texto"; texto: string; teto?: true }
  | { t: "erro"; codigo: ErroDitado };

/**
 * GET voz/ditado/disponibilidade: se o microfone aparece no campo. Indisponível nunca é erro HTTP — o botão só some.
 * `consentimentoNecessario`: a tela mostra o aviso da voz (ADR-075) antes da primeira gravação.
 */
export type DisponibilidadeDitado =
  | { disponivel: true; consentimentoNecessario: boolean; versaoConsentimento: number }
  | { disponivel: false; motivo: "desligado" | "sem_permissao" | "voz_fora" };
