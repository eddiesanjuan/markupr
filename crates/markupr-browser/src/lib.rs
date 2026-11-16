use markupr_core::{round_t, Clock, JsonlWriter};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    process::Command,
    sync::mpsc::{self, Receiver, Sender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket};

pub struct BrowserConfig {
    pub port: u16,
    pub log_path: PathBuf,
}
#[derive(Debug, Serialize)]
pub struct BrowserReport {
    pub attached: bool,
    pub browser: Option<String>,
    pub port: u16,
    pub lines: u64,
    pub tabs: u32,
    pub warnings: Vec<String>,
}
pub struct BrowserRecorder {
    stop: Sender<()>,
    worker: Option<JoinHandle<BrowserReport>>,
    port: u16,
    warning: Option<String>,
}
impl BrowserRecorder {
    pub fn start(cfg: BrowserConfig, clock: Clock) -> Self {
        let port = cfg.port;
        let (stop, rx) = mpsc::channel();
        let result = thread::Builder::new()
            .name("browser-cdp".into())
            .spawn(move || run(cfg, clock, rx));
        let (worker, warning) = match result {
            Ok(worker) => (Some(worker), None),
            Err(e) => (None, Some(e.to_string())),
        };
        Self {
            stop,
            worker,
            port,
            warning,
        }
    }
    pub fn stop(mut self) -> BrowserReport {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            match worker.join() {
                Ok(report) => return report,
                Err(_) => self.warning = Some("browser recorder thread panicked".into()),
            }
        }
        let mut report = empty_report(self.port);
        report.warnings.extend(self.warning.take());
        report
    }
}
impl Drop for BrowserRecorder {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}
fn empty_report(port: u16) -> BrowserReport {
    BrowserReport {
        attached: false,
        browser: None,
        port,
        lines: 0,
        tabs: 0,
        warnings: vec![],
    }
}
fn warn(report: &mut BrowserReport, text: String) {
    if report.warnings.len() < 20 && !report.warnings.contains(&text) {
        report.warnings.push(text);
    }
}
fn local_stream(port: u16, timeout: Duration) -> io::Result<TcpStream> {
    let stream =
        TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    Ok(stream)
}
fn version(port: u16) -> Option<Value> {
    let deadline = Instant::now() + Duration::from_millis(250);
    let mut stream = local_stream(port, Duration::from_millis(100)).ok()?;
    write!(
        stream,
        "GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut bytes = vec![];
    let mut buf = [0; 4096];
    while Instant::now() < deadline && bytes.len() < 65536 {
        stream
            .set_read_timeout(Some(
                deadline
                    .saturating_duration_since(Instant::now())
                    .max(Duration::from_millis(1)),
            ))
            .ok()?;
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes[pos + 4..]) {
                return value
                    .get("Browser")
                    .and_then(Value::as_str)
                    .map(|_| value.clone());
            }
        }
    }
    None
}
pub fn debug_endpoint(port: u16) -> Option<String> {
    version(port)?.get("Browser")?.as_str().map(str::to_owned)
}

#[derive(Debug, Serialize)]
pub struct LaunchInfo {
    pub pid: u32,
    pub app: String,
    pub profile_dir: PathBuf,
    pub port: u16,
}
pub type BrowserError = io::Error;
// Kept separate so the launch command can be inspected without starting a visible browser.
pub fn debug_browser_command(port: u16, url: Option<&str>) -> Result<Command, BrowserError> {
    let apps = [
        ("Google Chrome", "Google Chrome"),
        ("Brave Browser", "Brave Browser"),
        ("Chromium", "Chromium"),
        ("Microsoft Edge", "Microsoft Edge"),
        ("Arc", "Arc"),
    ];
    let binary = apps
        .iter()
        .map(|(app, bin)| PathBuf::from(format!("/Applications/{app}.app/Contents/MacOS/{bin}")))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "No supported browser in /Applications",
            )
        })?;
    let mut command = Command::new(binary);
    command
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!(
            "--user-data-dir={}",
            markupr_core::config::app_support_dir()
                .join("browser-profile")
                .display()
        ))
        .args(["--no-first-run", "--no-default-browser-check"]);
    if let Some(url) = url {
        command.arg(url);
    }
    Ok(command)
}
pub fn launch_debug_browser(port: u16, url: Option<&str>) -> Result<LaunchInfo, BrowserError> {
    let mut command = debug_browser_command(port, url)?;
    let app = PathBuf::from(command.get_program())
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let child = command.spawn()?;
    Ok(LaunchInfo {
        pid: child.id(),
        app,
        profile_dir: markupr_core::config::app_support_dir().join("browser-profile"),
        port,
    })
}

fn redact_url(raw: &str) -> String {
    let Ok(mut url) = url::Url::parse(raw) else {
        return raw.to_owned();
    };
    if url.query().is_none() {
        return raw.to_owned();
    }
    let pairs: Vec<_> = url
        .query_pairs()
        .map(|(key, value)| {
            let lower = key.to_ascii_lowercase();
            let secret = [
                "token", "key", "secret", "password", "auth", "session", "sig", "code",
            ]
            .iter()
            .any(|part| lower.contains(part));
            (
                key.into_owned(),
                if secret {
                    "REDACTED".into()
                } else {
                    value.into_owned()
                },
            )
        })
        .collect();
    url.query_pairs_mut().clear().extend_pairs(pairs);
    url.into()
}
fn cap(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}
fn string(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_owned()
}
fn remote_text(value: &Value) -> String {
    if let Some(v) = value.get("value") {
        return v
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string());
    }
    let text = value["description"]
        .as_str()
        .or(value["unserializableValue"].as_str())
        .unwrap_or("");
    // Error descriptions duplicate the stack, whose URL fields we redact separately.
    if value["subtype"] == "error" {
        text.lines().next().unwrap_or("").to_owned()
    } else {
        text.to_owned()
    }
}
fn tab_info(info: &Value) -> Value {
    let raw_url = string(info, "url");
    let url = redact_url(&raw_url);
    let mut title = string(info, "title");
    // Before a document title arrives, Chrome uses the URL without its scheme.
    for scheme in ["", "http://", "https://"] {
        if title == raw_url.strip_prefix(scheme).unwrap_or(&raw_url) {
            title = url.strip_prefix(scheme).unwrap_or(&url).to_owned();
            break;
        }
    }
    json!({"id":info["targetId"], "url":url, "title":title})
}
fn stack(v: &Value) -> Vec<String> {
    v["callFrames"]
        .as_array()
        .into_iter()
        .flatten()
        .take(5)
        .map(|f| {
            format!(
                "{} {}:{}:{}",
                string(f, "functionName"),
                redact_url(&string(f, "url")),
                f["lineNumber"].as_u64().unwrap_or(0) + 1,
                f["columnNumber"].as_u64().unwrap_or(0) + 1
            )
        })
        .collect()
}
const CLICK_SCRIPT: &str = r#"(() => {
if (globalThis.__markuprClickInstalled) return;
globalThis.__markuprClickInstalled = true;
document.addEventListener('click', event => {
 if (typeof globalThis.__markuprClick !== 'function') return;
 const el = event.composedPath().find(n => n instanceof Element);
 if (!el) return;
 const parts = []; let node = el;
 for (let i = 0; node && i < 4; i++, node = node.parentElement) {
   let part = node.tagName.toLowerCase();
   if (node.id) { parts.unshift(part + '#' + CSS.escape(node.id)); break; }
   if (node.parentElement) part += ':nth-child(' + (Array.prototype.indexOf.call(node.parentElement.children, node) + 1) + ')';
   parts.unshift(part);
 }
 // Read visible text nodes only, never input values or editable content.
 const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
 let text = '', nodeText;
 while ((nodeText = walker.nextNode()) && text.length < 320) {
   const parent = nodeText.parentElement;
   if (parent && !parent.closest('input,textarea,select,[contenteditable]') && parent.getClientRects().length && getComputedStyle(parent).visibility !== 'hidden') text += nodeText.textContent + ' ';
 }
 globalThis.__markuprClick(JSON.stringify({selector: parts.join(' > '), tag: el.tagName.toLowerCase(),
 text: Array.from(text.replace(/\s+/g, ' ').trim()).slice(0,80).join(''),
 role: el.getAttribute('role'), aria_label: el.getAttribute('aria-label'), src_ts: Date.now()}));
}, true);
})()"#;
struct Request {
    method: String,
    url: String,
    start: f64,
    status: Value,
    mime: Value,
}
struct Capture {
    sessions: HashMap<String, Value>,
    requests: HashMap<(String, String), Request>,
    seen: HashSet<String>,
    title_queries: HashMap<u64, String>,
    id: u64,
}
impl Capture {
    fn command(
        &mut self,
        ws: &mut WebSocket<TcpStream>,
        session: Option<&str>,
        method: &str,
        params: Value,
    ) -> tungstenite::Result<()> {
        self.id += 1;
        let mut message = json!({"id":self.id,"method":method,"params":params});
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        ws.send(Message::Text(message.to_string().into()))
    }
    fn finish(
        &mut self,
        session: &str,
        id: &str,
        timestamp: &Value,
        failed: bool,
        error: Value,
    ) -> Option<Value> {
        let r = self.requests.remove(&(session.into(), id.into()))?;
        Some(
            json!({"type":"network","method":r.method,"url":redact_url(&r.url),"status":r.status,"mime":r.mime,
            "dur_ms":round_t((timestamp.as_f64().unwrap_or(r.start)-r.start)*1000.0),"failed":failed,"error":error,"src_ts":timestamp}),
        )
    }
    fn event(
        &mut self,
        ws: &mut WebSocket<TcpStream>,
        v: &Value,
    ) -> tungstenite::Result<Vec<Value>> {
        if let Some(session) = v["id"]
            .as_u64()
            .and_then(|id| self.title_queries.remove(&id))
        {
            if let Some(title) = v["result"]["result"]["value"].as_str() {
                if let Some(tab) = self.sessions.get_mut(&session) {
                    tab["title"] = json!(title);
                }
            }
        }
        let method = v["method"].as_str().unwrap_or("");
        let p = &v["params"];
        let session = v["sessionId"].as_str().unwrap_or("");
        let mut lines = vec![];
        match method {
            "Target.attachedToTarget" => {
                let s = p["sessionId"].as_str().unwrap_or("");
                if p["targetInfo"]["type"] == "page" {
                    let info = &p["targetInfo"];
                    self.seen.insert(string(info, "targetId"));
                    self.sessions.insert(s.into(), tab_info(info));
                    for domain in [
                        "Runtime.enable",
                        "Log.enable",
                        "Network.enable",
                        "Page.enable",
                    ] {
                        self.command(ws, Some(s), domain, json!({}))?;
                    }
                    self.command(
                        ws,
                        Some(s),
                        "Runtime.addBinding",
                        json!({"name":"__markuprClick"}),
                    )?;
                    self.command(
                        ws,
                        Some(s),
                        "Page.addScriptToEvaluateOnNewDocument",
                        json!({"source":CLICK_SCRIPT}),
                    )?;
                    self.command(
                        ws,
                        Some(s),
                        "Runtime.evaluate",
                        json!({"expression":CLICK_SCRIPT}),
                    )?;
                }
                self.command(ws, Some(s), "Runtime.runIfWaitingForDebugger", json!({}))?;
            }
            "Target.targetInfoChanged" => {
                let info = &p["targetInfo"];
                for tab in self
                    .sessions
                    .values_mut()
                    .filter(|tab| tab["id"] == info["targetId"])
                {
                    *tab = tab_info(info);
                }
            }
            "Target.detachedFromTarget" => {
                let s = p["sessionId"].as_str().unwrap_or("");
                self.sessions.remove(s);
                self.requests.retain(|(session, _), _| session != s);
            }
            _ if !self.sessions.contains_key(session) => return Ok(lines),
            "Runtime.consoleAPICalled" => {
                let frames = &p["stackTrace"];
                let first = &frames["callFrames"][0];
                let text = p["args"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(remote_text)
                    .collect::<Vec<_>>()
                    .join(" ");
                lines.push(json!({"type":"console","level":p["type"],"text":cap(&text,2000),"url":redact_url(&string(first,"url")),
                    "line":first["lineNumber"].as_u64().map(|n|n+1),"stack":stack(frames),"src_ts":p["timestamp"]}));
            }
            "Log.entryAdded" => {
                let e = &p["entry"];
                lines.push(json!({"type":"console","level":e["level"],"text":cap(&string(e,"text"),2000),"url":redact_url(&string(e,"url")),
                    "line":e["lineNumber"].as_u64().map(|n|n+1),"stack":stack(&e["stackTrace"]),"src_ts":e["timestamp"]}));
            }
            "Runtime.exceptionThrown" => {
                let e = &p["exceptionDetails"];
                let text = remote_text(&e["exception"]);
                let text = if text.is_empty() {
                    string(e, "text")
                } else {
                    text
                };
                lines.push(json!({"type":"exception","text":cap(&text,2000),"url":redact_url(&string(e,"url")),"line":e["lineNumber"].as_u64().map(|n|n+1),
                    "col":e["columnNumber"].as_u64().map(|n|n+1),"stack":stack(&e["stackTrace"]),"src_ts":p["timestamp"]}));
            }
            "Network.requestWillBeSent" => {
                let id = string(p, "requestId");
                if let Some(redirect) = p.get("redirectResponse") {
                    if let Some(r) = self.requests.get_mut(&(session.into(), id.clone())) {
                        r.status = redirect["status"].clone();
                        r.mime = redirect["mimeType"].clone();
                    }
                    if let Some(line) =
                        self.finish(session, &id, &p["timestamp"], false, Value::Null)
                    {
                        lines.push(line);
                    }
                }
                let r = &p["request"];
                let url = string(r, "url");
                if !url.starts_with("data:") {
                    self.requests.insert(
                        (session.into(), id),
                        Request {
                            method: string(r, "method"),
                            url,
                            start: p["timestamp"].as_f64().unwrap_or(0.0),
                            status: Value::Null,
                            mime: Value::Null,
                        },
                    );
                }
            }
            "Network.responseReceived" => {
                if let Some(r) = self
                    .requests
                    .get_mut(&(session.into(), string(p, "requestId")))
                {
                    r.status = p["response"]["status"].clone();
                    r.mime = p["response"]["mimeType"].clone();
                }
            }
            "Network.loadingFinished" | "Network.loadingFailed" => {
                if let Some(line) = self.finish(
                    session,
                    &string(p, "requestId"),
                    &p["timestamp"],
                    method == "Network.loadingFailed",
                    p["errorText"].clone(),
                ) {
                    lines.push(line);
                }
            }
            "Page.frameNavigated" if p["frame"].get("parentId").is_none() => {
                let url = redact_url(&string(&p["frame"], "url"));
                self.sessions.get_mut(session).unwrap()["url"] = json!(url);
                lines.push(json!({"type":"navigation","url":url,"src_ts":null}));
            }
            "Page.domContentEventFired" => {
                self.command(
                    ws,
                    Some(session),
                    "Runtime.evaluate",
                    json!({"expression":"document.title", "returnByValue":true}),
                )?;
                self.title_queries.insert(self.id, session.into());
            }
            "Runtime.bindingCalled" if p["name"] == "__markuprClick" => {
                if let Ok(click) =
                    serde_json::from_str::<Value>(p["payload"].as_str().unwrap_or(""))
                {
                    let mut line = json!({"type":"dom_click","selector":cap(&string(&click,"selector"),500),"tag":cap(&string(&click,"tag"),80),"text":cap(&string(&click,"text"),80),"src_ts":click["src_ts"]});
                    for key in ["role", "aria_label"] {
                        if let Some(s) = click[key].as_str() {
                            line[key] = json!(cap(s, 80));
                        }
                    }
                    lines.push(line);
                }
            }
            _ => {}
        }
        for line in &mut lines {
            line["tab"] = self.sessions.get(session).cloned().unwrap_or(Value::Null);
        }
        Ok(lines)
    }
}
fn run(cfg: BrowserConfig, clock: Clock, stop: Receiver<()>) -> BrowserReport {
    let mut report = empty_report(cfg.port);
    let writer = match JsonlWriter::open(cfg.log_path) {
        Ok(w) => w,
        Err(e) => {
            warn(&mut report, e.to_string());
            return report;
        }
    };
    let mut capture = Capture {
        sessions: HashMap::new(),
        requests: HashMap::new(),
        seen: HashSet::new(),
        title_queries: HashMap::new(),
        id: 0,
    };
    'retry: loop {
        if stop.try_recv().is_ok() {
            break;
        }
        if let Some(version) = version(cfg.port) {
            report.browser = version["Browser"].as_str().map(str::to_owned);
            let connected = (|| {
                let endpoint = url::Url::parse(version["webSocketDebuggerUrl"].as_str()?).ok()?;
                // Use only the path from the endpoint; never follow a remote host or port.
                let local = format!("ws://127.0.0.1:{}{}", cfg.port, endpoint.path());
                let stream = local_stream(cfg.port, Duration::from_millis(100)).ok()?;
                tungstenite::client(local, stream).ok().map(|(ws, _)| ws)
            })();
            if let Some(mut ws) = connected {
                report.attached = true;
                capture.sessions.clear();
                capture.title_queries.clear();
                capture.requests.clear();
                let setup = capture.command(&mut ws,None,"Target.setDiscoverTargets",json!({"discover":true}))
                    .and_then(|_|capture.command(&mut ws,None,"Target.setAutoAttach",json!({"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true,"filter":[{"type":"page","exclude":false},{"exclude":true}]})));
                if let Err(e) = setup {
                    warn(&mut report, e.to_string());
                } else {
                    loop {
                        if stop.try_recv().is_ok() {
                            break 'retry;
                        }
                        match ws.read() {
                            Ok(Message::Text(text)) => {
                                let t = round_t(clock.now());
                                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                                    if let Some(error) = v.get("error") {
                                        warn(&mut report, format!("CDP: {error}"));
                                    }
                                    match capture.event(&mut ws, &v) {
                                        Ok(lines) => {
                                            for mut line in lines {
                                                line["t"] = json!(t);
                                                if let Err(e) = writer.write(&line) {
                                                    warn(&mut report, e.to_string());
                                                    break 'retry;
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            warn(&mut report, e.to_string());
                                            break;
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => break,
                            Ok(_) => {}
                            Err(tungstenite::Error::Io(e))
                                if matches!(
                                    e.kind(),
                                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                                ) => {}
                            Err(e) => {
                                warn(&mut report, e.to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }
        match stop.recv_timeout(Duration::from_secs(2)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    if let Err(e) = writer.flush() {
        warn(&mut report, e.to_string());
    }
    report.lines = writer.lines_written();
    report.tabs = capture.seen.len() as u32;
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_with_token_and_code_keeps_secret_values_in_output() {
        let output = redact_url("http://localhost/?token=abc&code=123&q=shoes");
        assert_eq!(
            output,
            "http://localhost/?token=REDACTED&code=REDACTED&q=shoes"
        );
    }
}
