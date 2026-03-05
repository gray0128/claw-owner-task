use reqwest::blocking::Client;
use serde_json::Value;
use std::env;
use std::process;
use std::time::Duration;

/// Check if --json flag is present in args (for error handler before clap parses).
fn is_json_mode() -> bool {
    env::args().any(|a| a == "--json")
}

/// Print error and exit, respecting --json mode.
fn handle_error(msg: &str) -> ! {
    if is_json_mode() {
        eprintln!(
            "{}",
            serde_json::json!({"success": false, "error": msg})
        );
    } else {
        eprintln!("\n{msg}\n");
    }
    process::exit(1);
}

/// Core API client that mirrors the Node.js `api.js`.
pub struct ApiClient {
    base_url: String,
    api_key: String,
    timezone: String,
    client: Client,
}

impl ApiClient {
    pub fn new() -> Self {
        let base_url = env::var("TASK_API_URL")
            .unwrap_or_else(|_| "http://localhost:8787/api".to_string());

        let api_key = env::var("TASK_API_KEY").unwrap_or_default();
        if api_key.is_empty() {
            handle_error(
                "[Error] TASK_API_KEY environment variable is not set.\nPlease configure it before using the CLI.",
            );
        }

        let timezone = env::var("USER_TIMEZONE").unwrap_or_else(|_| "Asia/Shanghai".to_string());

        Self {
            base_url,
            api_key,
            timezone,
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    /// Send a request and return the full JSON response.
    fn request_full(&self, method: &str, endpoint: &str, body: Option<Value>) -> Value {
        let url = format!("{}{}", self.base_url, endpoint);
        let builder = match method {
            "GET" => self.client.get(&url),
            "POST" => self.client.post(&url),
            "PUT" => self.client.put(&url),
            "DELETE" => self.client.delete(&url),
            _ => handle_error(&format!("Unsupported HTTP method: {method}")),
        };

        let builder = builder
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("X-User-Timezone", &self.timezone);

        let builder = if let Some(b) = body {
            builder.body(b.to_string())
        } else {
            builder
        };

        let res = match builder.send() {
            Ok(r) => r,
            Err(e) => {
                if e.is_connect() {
                    handle_error(&format!(
                        "[Offline] Cannot connect to API at {}. Please check your network or server status.",
                        self.base_url
                    ));
                } else {
                    handle_error(&format!("[Request Failed] {e}"));
                }
            }
        };

        let status = res.status();
        if !status.is_success() {
            let err_body = res.text().unwrap_or_default();
            handle_error(&format!("API Error ({status}): {err_body}"));
        }

        let json: Value = match res.json() {
            Ok(v) => v,
            Err(e) => handle_error(&format!("[Parse Error] {e}")),
        };

        if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
            let err = json.get("error").cloned().unwrap_or(Value::Null);
            handle_error(&format!("API logic error: {err}"));
        }

        json
    }

    /// Send a request and return the `data` field from `{ success, data }`.
    fn request(&self, method: &str, endpoint: &str, body: Option<Value>) -> Value {
        let json = self.request_full(method, endpoint, body);
        json.get("data").cloned().unwrap_or(Value::Null)
    }

    // --- Info ---
    pub fn info(&self) -> Value {
        self.request("GET", "/info", None)
    }

    // --- Tasks ---
    pub fn list_tasks(&self, query_string: &str) -> Value {
        self.request("GET", &format!("/tasks{query_string}"), None)
    }

    pub fn create_task(&self, payload: Value) -> Value {
        self.request("POST", "/tasks", Some(payload))
    }

    pub fn update_task(&self, id: &str, payload: Value) -> Value {
        self.request("PUT", &format!("/tasks/{id}"), Some(payload))
    }

    pub fn complete_task(&self, id: &str) -> Value {
        self.request("PUT", &format!("/tasks/{id}/complete"), None)
    }

    pub fn delete_task(&self, id: &str) -> Value {
        self.request("DELETE", &format!("/tasks/{id}"), None)
    }

    pub fn ai_task(&self, text: &str) -> Value {
        self.request_full("POST", "/tasks/ai", Some(serde_json::json!({ "text": text })))
    }

    // --- Remind ---
    pub fn remind_check(&self, channel: &str) -> Value {
        self.request("POST", &format!("/remind/check?channel={channel}"), None)
    }

    // --- Tags ---
    pub fn list_tags(&self) -> Value {
        self.request("GET", "/tags", None)
    }

    pub fn create_tag(&self, name: &str) -> Value {
        self.request("POST", "/tags", Some(serde_json::json!({ "name": name })))
    }

    // --- Categories ---
    pub fn list_categories(&self) -> Value {
        self.request("GET", "/categories", None)
    }

    pub fn create_category(&self, name: &str, color: Option<&str>) -> Value {
        let mut payload = serde_json::json!({ "name": name });
        if let Some(c) = color {
            payload["color"] = Value::String(c.to_string());
        }
        self.request("POST", "/categories", Some(payload))
    }

    // --- Logs ---
    pub fn bark_logs(&self, limit: Option<&str>, task_id: Option<&str>) -> Value {
        let mut params = vec![];
        if let Some(l) = limit {
            params.push(format!("limit={}", l));
        }
        if let Some(tid) = task_id {
            params.push(format!("task_id={}", tid));
        }
        
        let qs = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        
        self.request("GET", &format!("/logs/bark{}", qs), None)
    }
}
