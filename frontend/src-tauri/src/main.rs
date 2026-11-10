#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    base_url: String,
    token: String,
}

#[derive(Default)]
struct BackendState(Arc<Mutex<Option<OwnedBackend>>>);

struct OwnedBackend {
    child: Child,
    connection: Connection,
    port: u16,
    #[cfg(windows)]
    _job: WindowsJob,
}

impl OwnedBackend {
    fn shutdown(mut self) {
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], self.port)), Duration::from_secs(1),
        ) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let request = format!(
                "POST /v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                self.port, self.connection.token,
            );
            let _ = stream.write_all(request.as_bytes());
            let mut response = [0u8; 128];
            let _ = stream.read(&mut response);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() { return; }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for OwnedBackend {
    fn drop(&mut self) {
        // Só este processo foi criado pelo aplicativo. O EOF do stdin também sinaliza saída.
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(windows)]
struct WindowsJob(usize);

#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
                &info as *const _ as *const _, std::mem::size_of_val(&info) as u32) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as _) == 0 {
                let error = std::io::Error::last_os_error().to_string();
                CloseHandle(handle);
                return Err(error);
            }
            Ok(Self(handle as usize))
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _); }
    }
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

fn launch_backend(app: &AppHandle) -> Result<OwnedBackend, String> {
    let root = repository_root();
    let mut command;
    if cfg!(debug_assertions) {
        let python = std::env::var_os("HORUS_PYTHON").map(PathBuf::from).unwrap_or_else(|| {
            root.join(if cfg!(windows) { "backend/.venv/Scripts/python.exe" } else { "backend/.venv/bin/python" })
        });
        if !python.is_file() { return Err("Prepare o ambiente backend/.venv antes de abrir o desktop.".into()); }
        command = Command::new(python);
        command.args(["-m", "horus_backend", "--port", "0"]);
    } else {
        let executable = app.path().resource_dir().map_err(|e| e.to_string())?
            .join("backend").join(if cfg!(windows) { "horus-backend.exe" } else { "horus-backend" });
        if !executable.is_file() { return Err("Backend empacotado não encontrado. Refaça o build completo.".into()); }
        command = Command::new(executable);
        command.args(["--port", "0"]);
    }
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("workspace");
    command.env("HORUS_API_TOKEN", &token).env("HORUS_MANAGED", "1")
        .env("HORUS_DATA_DIR", std::env::var_os("HORUS_DATA_DIR").map(PathBuf::from).unwrap_or(data_dir))
        .env("PYTHONUNBUFFERED", "1").env("PYTHONUTF8", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Não foi possível iniciar o backend: {e}"))?;
    #[cfg(windows)]
    let native_job = WindowsJob::attach(&child).map_err(|error| { let _ = child.kill(); error })?;
    let stdout = child.stdout.take().ok_or("Backend sem canal de inicialização.")?;
    let stderr = child.stderr.take().ok_or("Backend sem canal de diagnóstico.")?;
    // Drenar pipes evita bloquear o processo. Nunca repassar tokens/ambiente ao console da UI.
    std::thread::spawn(move || { for line in BufReader::new(stderr).lines() { if line.is_err() { break; } } });
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let _ = reader.read_line(&mut line);
        let _ = sender.send(line);
        for line in reader.lines() { if line.is_err() { break; } }
    });
    let mut backend = OwnedBackend {
        child, connection: Connection { base_url: String::new(), token }, port: 0,
        #[cfg(windows)]
        _job: native_job,
    };
    let line = receiver.recv_timeout(Duration::from_secs(15)).map_err(|_| "O backend não ficou pronto em 15 segundos.")?;
    let ready: serde_json::Value = serde_json::from_str(&line).map_err(|_| "Resposta de inicialização inválida.")?;
    if ready["event"] != "ready" { return Err("O backend não confirmou a inicialização.".into()); }
    backend.port = ready["port"].as_u64().filter(|p| *p > 0 && *p <= 65535).ok_or("Porta local inválida.")? as u16;
    backend.connection.base_url = format!("http://127.0.0.1:{}", backend.port);
    Ok(backend)
}

#[tauri::command]
async fn backend_connection(app: AppHandle, state: tauri::State<'_, BackendState>) -> Result<Connection, String> {
    let inner = Arc::clone(&state.inner().0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = inner.lock().map_err(|_| "Estado do backend indisponível.")?;
        if let Some(backend) = guard.as_mut() {
            if backend.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(backend.connection.clone());
            }
        }
        guard.take();
        let backend = launch_backend(&app)?;
        let connection = backend.connection.clone();
        *guard = Some(backend);
        Ok(connection)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_legacy() -> Result<(), String> {
    let executable = std::env::var_os("HORUS_LEGACY_APP").map(PathBuf::from).unwrap_or_else(|| {
        repository_root().join(if cfg!(windows) { "src/Horus/bin/Debug/net10.0/Horus.exe" } else { "src/Horus/bin/Debug/net10.0/Horus" })
    });
    if !executable.is_file() { return Err("Desktop Avalonia não encontrado. Configure HORUS_LEGACY_APP ou execute-o pelo projeto C#.".into()); }
    let mut command = Command::new(executable);
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let dotnet = PathBuf::from(home).join(".dotnet");
        if dotnet.is_dir() { command.env("DOTNET_ROOT", dotnet); }
    }
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![backend_connection, open_legacy])
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o Hórus desktop")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let owned = handle.state::<BackendState>().inner().0.lock().ok().and_then(|mut state| state.take());
                if let Some(backend) = owned {
                    api.prevent_exit();
                    let app = handle.clone();
                    std::thread::spawn(move || { backend.shutdown(); app.exit(0); });
                }
            }
        });
}
