import type { AlvoAviso, AvisoDesktop, NodDesktop, PreferenciasDesktop } from "../../src/contracts/desktop.ts";
import type { EstadoAvisos } from "./avisos.ts";

/**
 * O canal de avisos do app do Mac, pela ponte `window.nodDesktop` (desktop/preload-web.ts). Separado de canal-avisos.ts
 * (NOD-196) porque não toca DOM nenhum: recebe a ponte pronta e é testável no vitest sem navegador
 * (tests/unit/web/canal-avisos.test.ts).
 */
export type CanalAvisos = {
  estado(): EstadoAvisos;
  /** O avisador pode mostrar? */
  ligado(): boolean;
  /** Relê a preferência (o menu "Avisos no Mac" muda sem passar pela página). */
  reler(): Promise<void>;
  /** O interruptor de "Seu espaço". No navegador, pede a permissão no próprio clique. */
  alternar(): Promise<void>;
  mostrar(aviso: AvisoDesktop): void;
  contador(n: number): void;
  /**
   * O som dos avisos (NOD-196): só no app do Mac cuja ponte tem `definirSom`. No navegador e no app antigo, ausentes —
   * a tela (NOD-115) não mostra o interruptor.
   */
  som?(): boolean;
  alternarSom?(): Promise<void>;
};

/**
 * A ponte tem os avisos do app? Só o app do Mac tem. A janela do app do Windows também tem `window.nodDesktop`, mas só
 * com `iaEntrar`/`iaInstalar` (desktop/windows/preload-web-windows.ts): lá os avisos são os do navegador. Antes desta
 * conferência a web escolhia o canal do Mac só por a ponte existir, `mac.aoAbrir` não era função e a janela do Windows
 * abria em branco.
 */
/** Os avisos do app (todo membro de NodDesktop é opcional; o Windows não tem estes). */
export type PonteAvisosDesktop = NodDesktop & Required<Pick<NodDesktop, "avisar" | "contador" | "preferencias" | "definirAvisos" | "aoAbrir">>;

export function temAvisosDoApp(ponte: NodDesktop | undefined): ponte is PonteAvisosDesktop {
  return (
    !!ponte &&
    typeof ponte.avisar === "function" &&
    typeof ponte.contador === "function" &&
    typeof ponte.preferencias === "function" &&
    typeof ponte.definirAvisos === "function" &&
    typeof ponte.aoAbrir === "function"
  );
}

export function canalMac(mac: PonteAvisosDesktop, aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  let prefs: PreferenciasDesktop = { avisos: true, tema: "sistema", som: true, bloqueados: false };
  const aplicar = (lido: PreferenciasDesktop): void => {
    // App de antes de 2026-10-07 não devolve `som`: vale o padrão (ligado), sem disparar um aoMudar à toa.
    const p: PreferenciasDesktop = { ...lido, som: typeof lido.som === "boolean" ? lido.som : true };
    const mudou = p.avisos !== prefs.avisos || p.bloqueados !== prefs.bloqueados || p.som !== prefs.som;
    prefs = p;
    if (mudou) aoMudar();
  };
  const reler = (): Promise<void> => mac.preferencias().then(aplicar, () => undefined);
  mac.aoAbrir(aoAbrir);
  void reler();
  const canal: CanalAvisos = {
    estado: () => ({ onde: "mac", situacao: !prefs.avisos ? "desligados" : prefs.bloqueados ? "bloqueados" : "ligados" }),
    // Bloqueado continua tentando: se a pessoa liberar nos Ajustes, o próximo aviso aparece e o estado volta.
    ligado: () => prefs.avisos,
    reler,
    alternar: () => mac.definirAvisos(!prefs.avisos).then(aplicar, () => undefined),
    // NOD-114: o app do Mac de antes do alvo "trabalho" recusa o aviso (devolve false); a segunda tentativa vai com a
    // conversa do bot, que todo app aceita. No app novo o false é foco ou aviso desligado, e a conversa cai no mesmo false.
    mostrar: (aviso) =>
      void mac
        .avisar(aviso)
        .then((ok) => (ok || aviso.alvo.tipo !== "trabalho" ? ok : mac.avisar({ ...aviso, alvo: { tipo: "conversa", conversaId: aviso.alvo.conversaId, agenteId: aviso.alvo.agenteId } })))
        .then(reler, () => undefined),
    contador: (n) => void mac.contador(n).catch(() => undefined),
  };
  const definirSom = mac.definirSom?.bind(mac);
  if (definirSom) {
    // App de antes de 2026-10-07 não tem: sem as duas, a tela não oferece o interruptor.
    const situacao = canal.estado;
    canal.estado = () => ({ ...situacao(), som: prefs.som });
    canal.som = () => prefs.som;
    canal.alternarSom = () => definirSom(!prefs.som).then(aplicar, () => undefined);
  }
  return canal;
}
