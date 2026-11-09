import { prazoSondaDoEnv } from "../../src/adapters/executor/sonda.ts";

/**
 * NOD-198: prazo por teste dos arquivos `tests/integration/executor/*-falso` que sobem o CLI falso de verdade
 * (sonda `--version`/`--help`, app-server ou stream-json, proxy MCP: 3 a 6 processos node por teste).
 * medido em 2026-10-08 (Mac de 12 núcleos, load 490–730, 2× `npm run test:unit` ao lado): os testes que
 * passaram levaram mediana de 14 a 20 s e no máximo 24,8 s (71 amostras), contra ~4,5 s com o Mac livre. Os
 * prazos antigos (20 s do projeto, 30 s do arquivo) cortavam no meio do caminho feliz: 18 timeouts em 2
 * rodadas, todos sem corrida. Com 120 s, a mesma medição numa pilha pior (load 490–570 com voz + 2× unit +
 * 4× integration ao mesmo tempo, 166 testes de voz que passaram) deu mediana 17,8 s, p95 44 s e máximo 113 s, e um
 * teste cortou aos 120 s com a sonda ainda subindo node (sem corrida: só fila de CPU). 240 s dá ~2x esse pior caso;
 * no caminho feliz o número não custa nada, e um falso travado de verdade ainda cai aqui.
 * O `testTimeout` do projeto não muda.
 */
export const PRAZO_TESTE_FALSO_MS = 240_000;

/**
 * Prazo da sonda (`--version`/`--help`) que estes testes injetam no driver. Eles não medem a sonda (quem mede é
 * `sonda-lenta`/`sonda-falsa`); com o padrão de 10 s do código, o spawn do node sob carga virava
 * `executor_indisponivel` (16 vezes em 2 rodadas). Quem corta um travamento é o prazo do teste acima.
 * `NOD_PRAZO_SONDA_MS` continua mandando, como no resto da suíte (NOD-178).
 */
export const prazoSondaDoTeste = (): number => prazoSondaDoEnv(process.env) ?? PRAZO_TESTE_FALSO_MS;
