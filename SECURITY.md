# Segurança e privacidade — Axios Cleaner

Auditoria feita em 30/10/2026 (v1.2.1), seguindo a metodologia do
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill):
reconhecimento → caça por classe de ataque → validação → relatório.

## Princípio: nada sai do computador

O app é 100% local. Ele não tem servidor, conta, telemetria, atualização automática nem análise de uso.

| Verificação | Resultado |
|---|---|
| URLs, `fetch`, WebSocket ou `sendBeacon` no código (`ui/`, `src-tauri/src/`) | nenhum |
| Bibliotecas de rede nas dependências Rust (`reqwest`, `hyper`, `rustls`, `ureq`, plugins `http`/`updater`) | nenhuma |
| Plugins Tauri | `notification` (aviso local do Windows), `single-instance` e `window-state` (locais) |
| Fontes, scripts e estilos | todos empacotados no app; nenhum CDN |
| Monitoramento real de conexões do app e de todos os processos da WebView2, por 90 s | **0 conexões externas** |

Dados gravados, todos em `%APPDATA%\Axios Cleaner`, que só o próprio usuário acessa:

- `config.json`: categorias marcadas e ajustes.
- `history.json`: data, tamanho e categorias de cada limpeza.
- `logs\*.txt`: relatório de cada limpeza, com os caminhos dos arquivos que estavam em uso.

### WebView2 (motor de interface da Microsoft)

Mesmo sem nenhum código de rede no app, o runtime da WebView2 **por padrão** fazia contato com servidores da Microsoft:

- **Login automático com a conta do Windows.** Feito pelo módulo WAM, por fora da rede do Chromium. Foi observado chegando a `52.97.x.x:443`.
- **Serviços do Edge:** configuração remota, experimentos, SmartScreen, atualização de componentes e relatórios de travamento.

Tudo isso está desligado em `tauri.conf.json → additionalBrowserArgs`:

- `--disable-features=msOneAuthWAM,msLoadOneAuthInBackground,msImplicitSignin,…` corta o login automático.
  O nome `msOneAuthWAM` não é documentado ([WebView2Feedback #5760](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5760)).
- `--disable-background-networking`, `--disable-component-update`, `--no-pings` e afins cortam os serviços de fundo do Edge.
- `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE tauri.localhost, EXCLUDE ipc.localhost"` faz a interface não conseguir resolver nenhum domínio.
- `--proxy-server=127.0.0.1:9` manda qualquer tráfego do Chromium para um endereço morto, inclusive acessos direto por IP.

A janela só exibe o próprio app (`on_navigation`), e a CSP limita scripts, estilos, fontes e imagens ao pacote local.
A limpeza agendada (`--auto`) nem cria WebView.

## Fronteiras de confiança

- **Processo principal:** roda como administrador (manifesto `requireAdministrator`).
- **Interface:** WebView com conteúdo empacotado que chama comandos nativos pelo `invoke`. É tratada como *não confiável*: cada comando valida o que recebe.
- **Dados lidos do disco:** nomes de arquivos, pastas de **outros usuários** (`C:\Users\*`) e itens de inicialização. Podem ter sido criados por um usuário sem privilégios.
- **Persistência:** `%APPDATA%` do usuário e uma tarefa agendada que roda elevada.

## Achados e correções

| # | Classe | Achado | Status |
|---|---|---|---|
| 1 | Confused deputy / junction | Um usuário comum podia trocar a própria pasta `Temp` por uma junction para `C:\Windows`; o app, como admin, apagaria arquivos lá. | **Corrigido.** Pastas-alvo com junction ou symlink em qualquer trecho do caminho são ignoradas (`is_direct_path`). Teste: `junction_as_target_folder_is_ignored`. |
| 2 | TOCTOU / junction | Uma subpasta podia ser trocada por junction durante a limpeza. | **Mitigado.** Junctions nunca são seguidas na varredura, e antes de cada exclusão o caminho real do arquivo é conferido de novo (`Containment`). Resta uma janela de microssegundos (ver riscos residuais). |
| 3 | Bridge amplo | `open_path` aceitava qualquer caminho e o `explorer.exe` executaria um `.exe`. | **Corrigido.** Viraram `open_folder` (só pastas existentes), `reveal_path` (só seleciona o item) e `open_log` (só `.txt` dentro da pasta de logs). Teste: `open_log_rejects_files_outside_the_logs_folder`. |
| 4 | Bridge amplo | `recycle_files` aceitava qualquer caminho. | **Corrigido.** Só aceita arquivos devolvidos pela última busca de "Grandes" (lista guardada no backend). |
| 5 | Bridge amplo | `startup_set` aceitava qualquer nome de valor no registro. | **Corrigido.** Só altera itens que existem na lista atual. |
| 6 | Injeção de argumentos | `schedule_set` passava dia e hora sem validação para o `schtasks`. | **Corrigido.** Frequência, dia (`SUN..SAT` / `1..28`) e hora (`HH:MM`) são validados. Teste: `schedule_input_is_validated`. |
| 7 | Elevação de privilégio | A tarefa agendada roda como admin; se o `.exe` estivesse numa pasta gravável sem admin, outro programa poderia trocá-lo. | **Corrigido.** O agendamento só é criado se o app estiver instalado em Arquivos de Programas. |
| 8 | Origem da WebView | Não havia bloqueio de navegação para fora do app. | **Corrigido.** `on_navigation` só permite `tauri.localhost`, e a CSP ganhou `object-src`, `base-uri`, `form-action` e `frame-src` como `'none'`. |
| 9 | Privacidade | A WebView2 contatava a Microsoft (login automático e serviços do Edge). | **Corrigido.** Ver a seção acima. 0 conexões em 90 s de monitoramento. |

Verificados e sem problema:

- **XSS:** todo texto vindo do disco passa por `esc()` antes de ir para o HTML.
- **Comandos externos:** são chamados com argumentos separados, sem shell.
- **Categorias e tarefas:** a interface só escolhe ids de listas fixas do backend.

## Riscos residuais

- **Flags não documentadas da WebView2.** `msOneAuthWAM` pode mudar de nome numa atualização do runtime. Se isso acontecer, o login automático da Microsoft pode voltar a fazer contato. O bloqueio de DNS e o proxy morto continuam valendo para o restante.
  Como verificar: rodar o app e conferir as conexões com `Get-NetTCPConnection`, como neste relatório.
- **TOCTOU (item 2).** Entre a conferência do caminho e a exclusão existe uma janela mínima. Explorar isso exige outro usuário logado no mesmo PC, criando junctions em loop durante a limpeza.
- **Windows.** Telemetria do próprio sistema operacional não é controlada pelo app.

## Como rodar os testes

```sh
npm test
```

O comando roda os testes da interface (`node --test`) e os do Rust (`cargo test`). Os testes de segurança criam junctions reais numa pasta temporária.
