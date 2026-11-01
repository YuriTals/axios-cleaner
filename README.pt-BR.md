<div align="center">
    <img src="docs/app-icon.png" width=200 height=200>
    <h1>Axios Cleaner</h1>
    <a href="README.md">English</a> · <b>Português (Brasil)</b>
</div>

<p align="center">
  O Axios Cleaner deixa o seu PC com Windows leve, rápido e privado.<br>
  Ele remove arquivos temporários, caches e logs do <b>Windows</b>, dos <b>navegadores</b>, <b>apps</b>, <b>jogos</b> e <b>ferramentas de dev</b>,<br>
  com uma interface futurista em ASCII — <b>sem conta, sem telemetria, nada sobre você sai do seu computador</b>.
</p>

<p align="center">
  <img src="docs/screenshots/inicio.png" width="420" alt="Início: núcleo ASCII com o lixo por área, telemetria ao vivo e unidades">
  <img src="docs/screenshots/limpeza.png" width="420" alt="Lista de limpeza do Sistema com a barra de ação">
</p>

<p align="center">
  <a href="https://github.com/YuriTals/axios-cleaner/releases/latest"><img src="https://img.shields.io/badge/download-%C3%BAltima%20vers%C3%A3o-brightgreen?style=flat-square" alt="Download"></a>
  <img src="https://img.shields.io/badge/plataforma-Windows-0078D6?style=flat-square" alt="Plataforma">
  <img src="https://img.shields.io/badge/requisitos-Windows%2010%2F11%20%C2%B7%20x64-fa4e49?style=flat-square" alt="Requisitos">
  <img src="https://img.shields.io/badge/feito%20com-Tauri%202%20%C2%B7%20Rust-FF2448?style=flat-square" alt="Feito com Tauri e Rust">
  <img src="https://img.shields.io/badge/privacidade-sem%20telemetria-7BE38F?style=flat-square" alt="Sem telemetria">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-blue?style=flat-square" alt="Licença"></a>
  <a href="https://buymeacoffee.com/axiosdevteam"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-axiosdevteam-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=000000" alt="Buy Me A Coffee"></a>
  <a href="https://ko-fi.com/axiosdevteam"><img src="https://img.shields.io/badge/Ko--fi-axiosdevteam-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</p>

## Destaques

- **34 categorias de limpeza em 6 áreas:** Sistema, Navegadores, Apps, Jogos e GPU, Dev e Privacidade. Qualquer categoria pode ser desligada, e dá para ver onde estão os arquivos e quais são os maiores antes de limpar.
- **Progresso ao vivo dentro do botão:** segure para iniciar; enquanto roda, o botão mostra o % real, a etapa atual e o tempo restante. Passe o mouse para **cancelar**, e o botão pede confirmação dentro dele mesmo.
- **Seguro por padrão:** atalhos de pasta (junctions/symlinks) nunca são seguidos, arquivos em uso são pulados e listados no log, e só pastas vazias são removidas. Histórico, senhas, cookies, favoritos e documentos nunca são tocados.
- **Fecha os apps com educação:** antes de limpar, mostra os apps abertos que travam arquivos (navegadores, Discord, Teams, OneDrive) e você escolhe quais podem fechar. Eles recebem um pedido para fechar (como clicar no X) e só são forçados depois de 8 s. O OneDrive é reaberto no fim, e o Windows Update é pausado e religado sozinho.
- **Ferramentas:** busca de arquivos grandes (vão para a Lixeira, dá para desfazer), mapa de espaço em ASCII por pasta ou disco, gerenciador reversível de programas na inicialização e manutenção do Windows (DNS, Explorer e cache de miniaturas, TRIM, DISM, `sfc` e ponto de restauração).
- **Limpeza agendada e ícone na bandeja:** diária, semanal ou mensal, sem abrir janela e com aviso no fim, além da opção "fechar para a bandeja". Sair pergunta antes e cancela com segurança o que estiver rodando.
- **Telemetria ao vivo:** CPU, GPU, memória e atividade de disco em gráficos ASCII, e cada unidade como uma barra ASCII mostrando quanto é lixo.
- **Histórico e logs:** cada limpeza gera um log em texto que você abre pelo próprio app.
- **Atualizações assinadas:** o app avisa quando sai versão nova e instala segurando um botão, ou você deixa para depois ou pula aquela versão. Ele só aceita instaladores assinados com a chave do projeto, e a verificação pode ser desligada.

<p align="center">
  <img src="docs/screenshots/andamento.png" width="420" alt="Limpeza em andamento com porcentagem e tempo restante">
  <img src="docs/screenshots/cancelar.png" width="420" alt="Confirmação de cancelamento dentro do botão">
</p>

<p align="center">
  <img src="docs/screenshots/manutencao.png" width="420" alt="Fila de manutenção do Windows">
  <img src="docs/screenshots/ajustes.png" width="420" alt="Ajustes com ON em verde e OFF em vermelho">
</p>

<p align="center">
  <img src="docs/screenshots/resultado.png" width="600" alt="Tela de resultado sobre bolhas ASCII animadas">
</p>

## O que ele limpa

| Área | Categorias |
|---|---|
| **Sistema** | Lixeira · pastas Temp dos usuários · `C:\Windows\Temp` · logs do Windows (CBS, Panther, MeasuredBoot, WinSAT, Windows Update, .NET, Defender) · dumps de programas · caches do Explorer e do Internet Explorer · logs do OneDrive · cache do Windows Update · Otimização de Entrega · relatórios de erro e minidumps |
| **Navegadores** | Microsoft Edge · Google Chrome · Mozilla Firefox · Brave · Vivaldi · Opera / Opera GX — só cache, em todos os perfis |
| **Apps** | Spotify · Adobe Media Cache · VMware · TeamViewer · Discord · Microsoft Teams · Slack · Visual Studio Code · Zoom · apps da Microsoft Store |
| **Jogos e GPU** | Cache de shaders (DirectX, NVIDIA, AMD, Intel) · Steam · Epic Games Launcher — jogos e saves ficam |
| **Dev** | npm, Yarn e pip · NuGet, Gradle e Go · Cargo (Rust) — são baixados de novo quando precisar |
| **Privacidade** | Lista de arquivos recentes · listas de atalhos da barra de tarefas — os arquivos em si ficam |

> Limpar o cache de shaders é seguro, mas os jogos recriam esse cache, então as primeiras partidas podem engasgar um pouco. Se preferir, desmarque essa categoria.

## Instalação

1. Baixe o `AxiosCleaner_<versão>_x64-setup.exe` na [página de Releases](https://github.com/YuriTals/axios-cleaner/releases/latest) e execute.
2. Abra o **Axios Cleaner**. Ele pede permissão de administrador, necessária para limpar as pastas do Windows e a pasta Temp de todos os usuários.

O instalador não tem assinatura digital, então o Windows SmartScreen pode avisar na primeira vez. Clique em **Mais informações › Executar assim mesmo**.

## Requisitos

- Windows 10 ou 11, 64 bits.
- Microsoft Edge WebView2 Runtime (já vem no Windows 11; no Windows 10 o instalador baixa se faltar).
- Permissão de administrador (pedida ao abrir o app).

## Privacidade

Tudo acontece no seu computador. O Axios Cleaner **não tem conta, telemetria nem análise de uso**. A única conexão de rede é a verificação de atualizações: ao abrir e a cada 12 horas ele pergunta ao GitHub qual é a última release deste repositório, sem enviar nada sobre você. Dá para desligar em **Ajustes › Atualizações**.

A interface roda na WebView2 da Microsoft, que por padrão contata a Microsoft (login automático com a conta do Windows, SmartScreen, configuração remota). O app desliga tudo isso e aponta a WebView2 para uma rede morta, então a própria interface não consegue acessar a internet; a verificação de atualizações roda no backend nativo. Com a verificação desligada, 90 segundos de monitoramento mostraram **zero conexões externas** do app e dos processos da WebView2.

Configurações, histórico e logs ficam só em `%APPDATA%\Axios Cleaner`. A auditoria completa, com fronteiras de confiança, achados e evidências, está em [SECURITY.md](SECURITY.md).

## Segurança

- As regras de limpeza ficam fixas em [`src-tauri/src/rules.rs`](src-tauri/src/rules.rs): uma regra por pasta e máscara de arquivo.
- Pastas-alvo acessadas por junction ou symlink são ignoradas, e cada arquivo é conferido de novo logo antes de ser apagado. Assim, outro usuário não consegue desviar a limpeza para `C:\Windows`.
- Os comandos chamados pela interface validam tudo o que recebem. "Abrir" nunca executa programas, e a ferramenta da Lixeira só aceita arquivos encontrados pela própria busca.
- A limpeza agendada só funciona com o app instalado em Arquivos de Programas, porque a tarefa agendada roda como administrador.

## Build

Requisitos: [Rust](https://rustup.rs) (toolchain MSVC), [Node.js](https://nodejs.org) e as Ferramentas de Build C++ do Visual Studio.

```sh
npm install
npm run build        # gera o .exe e o instalador (src-tauri/target/release/bundle/nsis)
npm test             # testes da interface (node --test) e do Rust (cargo test)
```

### Publicando uma atualização

1. Rode `npm run bump -- 1.2.4` (atualiza todos os arquivos que têm a versão), faça commit e push. O `npm test` falha se os arquivos divergirem.
2. Rode `npm run release -- notas.md`. Ele gera o instalador assinado com a chave de atualização (`~/.tauri/axios-cleaner-updater.key`, fora do repositório), monta o `latest.json` e publica a release neste repositório.
3. Os apps instalados com a verificação ligada vão oferecer a versão nova.

Ajudas de desenvolvimento:

- `AXIOS_NO_ELEVATE=1`: compila sem o pedido de administrador (testes e preview).
- `AXIOS_ROUTE=<tela>`: abre direto numa tela (`home`, `system`, `browsers`, `apps`, `games`, `dev`, `privacy`, `recycle`, `big`, `map`, `startup`, `tasks`, `history`, `settings`). `demo-run`, `demo-hover`, `demo-confirm` e `demo-result` simulam o botão rodando e a tela de resultado.
- `axios-cleaner.exe --auto`: modo da limpeza agendada.

### Estrutura do projeto

| Caminho | Responsabilidade |
|---|---|
| `src-tauri/src/main.rs` | Monta o app: plugins, estado, janela ou modo agendado |
| `src-tauri/src/commands.rs` | Comandos chamados pela interface |
| `src-tauri/src/pipeline.rs` | Uma limpeza: restauração → fechar apps → pausar serviços → limpar → log |
| `src-tauri/src/engine.rs`, `rules.rs` | Varredura, exclusão segura e as regras de cada categoria |
| `src-tauri/src/system.rs` | Integração com o Windows: processos, serviços, manutenção, agendamento, Explorer |
| `src-tauri/src/shell.rs` | Janela, ícone na bandeja e limpeza agendada |
| `src-tauri/src/updates.rs` | Atualizações assinadas pelas releases deste repositório |
| `scripts/release.mjs` | Build assinado + `latest.json` + releases no GitHub |
| `src-tauri/src/files.rs`, `startup.rs`, `perf.rs`, `store.rs` | Arquivos grandes e mapa, inicialização, telemetria, configurações e logs |
| `ui/js/` | Módulos da interface: `state`, `format`, `run` (botão de execução), `views/*`, `canvas`, `actions`, `render`, `main` |
| `tests/ui/` | Testes da interface |

## Licença

O Axios Cleaner é software livre sob a [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Nomes e fontes de terceiros não estão cobertos por ela; veja o aviso abaixo.

## Aviso legal

O Axios Cleaner é um projeto independente, sem afiliação, endosso ou patrocínio de Microsoft, Google, Mozilla, Brave, Vivaldi, Opera, Valve, Epic Games, NVIDIA, AMD, Intel, Adobe, Discord, Slack, Zoom, Spotify, VMware ou TeamViewer. Windows, Edge, OneDrive, Teams, Visual Studio Code e os demais nomes de produtos citados são marcas de seus respectivos donos, com todos os direitos reservados a eles. As fontes incluídas, IBM Plex Mono e Inter, pertencem aos seus autores e são distribuídas sob a SIL Open Font License 1.1, incluída em [`ui/fonts/licenses/`](ui/fonts/licenses/).

A limpeza apaga arquivos de vez (exceto a ferramenta de arquivos grandes, que usa a Lixeira). Revise as categorias marcadas antes de limpar; o uso do app é por sua conta e risco.
