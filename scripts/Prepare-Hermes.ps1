param(
    [string]$HermesExecutable = (Join-Path $env:LOCALAPPDATA 'hermes/bin/hermes.exe'),
    [string]$HermesHome = (Join-Path $env:LOCALAPPDATA 'hermes'),
    [ValidateRange(1024,65535)][int]$Port = 8643,
    [switch]$StartGateway
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $HermesExecutable -PathType Leaf)) { throw 'Hermes CLI não encontrado. Informe -HermesExecutable.' }
$profileDir = Join-Path $HermesHome 'profiles/horus'
$marker = Join-Path $profileDir '.horus-integration'
$connectionDir = Join-Path $env:LOCALAPPDATA 'Horus/workspace/integrations'
$connectionFile = Join-Path $connectionDir 'hermes.json'

if (Test-Path -LiteralPath $profileDir) {
    if (-not (Test-Path -LiteralPath $marker)) { throw 'O perfil horus já existe e não foi preparado por este script. Nada foi sobrescrito.' }
    if (-not (Test-Path -LiteralPath $connectionFile)) { throw 'Arquivo privado de conexão ausente. Não vou substituir a chave de um perfil existente.' }
    $connection = Get-Content -LiteralPath $connectionFile -Raw | ConvertFrom-Json
    if ($connection.base_url -ne "http://127.0.0.1:$Port") { throw 'Use a mesma porta da preparação existente.' }
} else {
    if (Test-Path -LiteralPath $connectionFile) { throw 'Já existe uma conexão Hórus configurada. Nada foi sobrescrito.' }
    $originalHome = $env:HERMES_HOME
    try {
        $env:HERMES_HOME = $HermesHome
        & $HermesExecutable profile create horus --no-alias --no-skills --description 'Inteligência e operação audiovisual do Hórus'
        if ($LASTEXITCODE -ne 0) { throw 'A criação do perfil Hermes falhou.' }
    } finally { $env:HERMES_HOME = $originalHome }
    if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) { throw 'O Hermes não criou o perfil no diretório esperado.' }
    $randomBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    $secret = [BitConverter]::ToString($randomBytes).Replace('-','').ToLowerInvariant()
    @"
gateway:
  standalone: true
  multiplex_profiles: false
platforms:
  api_server:
    enabled: true
    gateway_restart_notification: false
    extra:
      host: 127.0.0.1
      port: $Port
"@ | Set-Content -LiteralPath (Join-Path $profileDir 'config.yaml') -Encoding utf8
    @"
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=$Port
API_SERVER_KEY=$secret
"@ | Set-Content -LiteralPath (Join-Path $profileDir '.env') -Encoding utf8
    @'
# Hórus — inteligência audiovisual
Atue somente em pesquisa, análise e planejamento audiovisual autorizados.
Produção técnica pertence ao CLI fabrica. Respeite aprovações editoriais,
licenças e orçamento; não inicie operações pagas ou publicação sem autorização.
Este perfil está em validação. Não assuma integração operacional com a fábrica.
'@ | Set-Content -LiteralPath (Join-Path $profileDir 'SOUL.md') -Encoding utf8
    New-Item -ItemType Directory -Path $connectionDir -Force | Out-Null
    $connection = @{ base_url = "http://127.0.0.1:$Port"; token = $secret }
    $connection | ConvertTo-Json | Set-Content -LiteralPath $connectionFile -Encoding utf8
    'horus-public-api-v1' | Set-Content -LiteralPath $marker -Encoding utf8
}

Write-Output 'Perfil exclusivo preparado. Chave armazenada somente nos arquivos privados locais.'
if (-not $StartGateway) { Write-Output 'Para iniciar: execute novamente com -StartGateway.'; return }

$headers = @{ Authorization = 'Bearer ' + $connection.token }
try {
    $capabilities = Invoke-RestMethod -Uri ($connection.base_url + '/v1/capabilities') -Headers $headers -TimeoutSec 3 -MaximumRedirection 0
    if ($capabilities.object -eq 'hermes.api_server.capabilities' -and $capabilities.auth.required) {
        Write-Output 'A API Hermes já está ativa e autenticada.'
        return
    }
} catch { <# A porta será conferida antes de iniciar qualquer processo. #> }

$listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback),$Port
try { $listener.Start() } catch { throw 'A porta está ocupada por outro serviço. Nenhum processo existente foi encerrado.' }
finally { $listener.Stop() }

function Start-HorusGateway {
    $originalHome = $env:HERMES_HOME
    try {
        $env:HERMES_HOME = $HermesHome
        Start-Process -FilePath $HermesExecutable -ArgumentList @('-p','horus','gateway','run','--external-supervisor') `
            -WorkingDirectory $profileDir -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $profileDir 'horus-gateway.stdout.log') `
            -RedirectStandardError (Join-Path $profileDir 'horus-gateway.stderr.log')
    } finally { $env:HERMES_HOME = $originalHome }
}
$gateway = Start-HorusGateway

$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    Start-Sleep -Milliseconds 700
    if ($gateway.HasExited) {
        $startupLog = Get-Content -LiteralPath (Join-Path $profileDir 'horus-gateway.stderr.log') -Raw -ErrorAction SilentlyContinue
        if ($startupLog -match 'host gateway still serves profile.*standalone is not live yet') {
            # O host reavalia perfis em até 30 s. Só repetir se a tentativa anterior já saiu.
            Start-Sleep -Seconds 2
            $gateway = Start-HorusGateway
        } else { throw 'O gateway encerrou na inicialização. Consulte os logs privados do perfil horus.' }
    }
    try {
        $health = Invoke-RestMethod -Uri ($connection.base_url + '/health') -TimeoutSec 2 -MaximumRedirection 0
        $capabilities = Invoke-RestMethod -Uri ($connection.base_url + '/v1/capabilities') -Headers $headers -TimeoutSec 2 -MaximumRedirection 0
        if ($health.platform -eq 'hermes-agent' -and $capabilities.object -eq 'hermes.api_server.capabilities' -and $capabilities.auth.required) {
            Write-Output "API Hermes autenticada em $($connection.base_url). Nenhum prompt foi enviado."
            return
        }
    } catch { <# A inicialização pode levar alguns segundos. Não imprimir respostas ou chaves. #> }
} while ([DateTime]::UtcNow -lt $deadline)
throw 'O gateway não confirmou prontidão. Confira os logs privados do perfil horus; não inicie outro gateway por cima dele.'
