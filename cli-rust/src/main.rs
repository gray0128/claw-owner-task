mod api;
mod update;

use api::ApiClient;
use chrono::NaiveDateTime;
use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use std::process;
use tabled::{Table, Tabled};

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(
    name = "claw-task",
    version = env!("CARGO_PKG_VERSION"),
    about = "Claw Owner Task CLI - A minimalist task manager for humans and AI."
)]
struct Cli {
    /// Output in JSON format for AI Agent parsing
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Get system info, enums, and self-discovery metadata
    Info,

    /// List tasks
    List {
        /// Search keyword
        #[arg(short = 'q', long = "query")]
        query: Option<String>,
        /// Filter by status (e.g., pending, completed)
        #[arg(short, long)]
        status: Option<String>,
        /// Filter by priority (low, medium, high)
        #[arg(short, long)]
        priority: Option<String>,
        /// Filter by category ID
        #[arg(short, long = "category")]
        category: Option<String>,
        /// Filter by due date in UTC (YYYY-MM-DD)
        #[arg(long = "due")]
        due: Option<String>,
        /// Filter by remind date in UTC (YYYY-MM-DD)
        #[arg(long = "remind")]
        remind: Option<String>,
        /// Filter by tag name
        #[arg(short, long = "tag")]
        tag: Option<String>,
    },

    /// Create a new task
    Add {
        /// Task title
        title: String,
        /// Description
        #[arg(short = 'd', long = "desc")]
        desc: Option<String>,
        /// Priority (low, medium, high)
        #[arg(short, long)]
        priority: Option<String>,
        /// Category ID
        #[arg(short, long = "category")]
        category: Option<String>,
        /// Due date in UTC (accepts YYYY-MM-DD HH:mm:ss or ISO format)
        #[arg(long = "due")]
        due: Option<String>,
        /// Remind at date in UTC (accepts YYYY-MM-DD HH:mm:ss or ISO format)
        #[arg(long = "remind")]
        remind: Option<String>,
        /// Recurring rule (daily, weekly, monthly)
        #[arg(long)]
        rule: Option<String>,
        /// Comma separated tag names (e.g. 紧急,工作)
        #[arg(long)]
        tags: Option<String>,
        /// Source of the task (e.g., user, openclaw)
        #[arg(long)]
        source: Option<String>,
        /// JSON string of metadata
        #[arg(long)]
        metadata: Option<String>,
    },

    /// Update an existing task
    Update {
        /// Task ID
        id: String,
        /// New title
        #[arg(short = 't', long)]
        title: Option<String>,
        /// New description
        #[arg(short = 'd', long = "desc")]
        desc: Option<String>,
        /// New status (e.g., pending, completed)
        #[arg(short, long)]
        status: Option<String>,
        /// New priority (low, medium, high)
        #[arg(short, long)]
        priority: Option<String>,
        /// New category ID
        #[arg(short, long = "category")]
        category: Option<String>,
        /// New due date in UTC (accepts YYYY-MM-DD HH:mm:ss or ISO format)
        #[arg(long = "due")]
        due: Option<String>,
        /// New remind at date in UTC (accepts YYYY-MM-DD HH:mm:ss or ISO format)
        #[arg(long = "remind")]
        remind: Option<String>,
        /// New recurring rule (daily, weekly, monthly)
        #[arg(long)]
        rule: Option<String>,
        /// New comma separated tag names (e.g. 紧急,工作)
        #[arg(long)]
        tags: Option<String>,
        /// New JSON string of metadata
        #[arg(long)]
        metadata: Option<String>,
    },

    /// Mark a task as completed
    Complete {
        /// Task ID
        id: String,
    },

    /// Delete a task
    Delete {
        /// Task ID
        id: String,
    },

    /// Check and trigger reminders (For Cron/Agent use)
    Check {
        /// Channel to trigger: "agent" or "cloud"
        #[arg(long)]
        channel: String,
    },

    /// List all tags
    Tags,

    /// Create a new tag
    AddTag {
        /// Tag name
        name: String,
    },

    /// List all categories
    Categories,

    /// Create a new category
    AddCategory {
        /// Category name
        name: String,
        /// Color hex code (e.g. #FF0000)
        #[arg(short, long)]
        color: Option<String>,
    },

    /// Upgrade the CLI to the latest version
    Upgrade,

    #[command(hide = true)]
    InternalCheckUpdate,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a date string (YYYY-MM-DD or ISO format) into "YYYY-MM-DD HH:mm:ss".
/// Mirrors the Node.js `parseDateStr` function.
fn parse_date_str(val: &str) -> Result<String, String> {
    // Try "YYYY-MM-DD HH:MM:SS" first
    if let Ok(dt) = NaiveDateTime::parse_from_str(val, "%Y-%m-%d %H:%M:%S") {
        return Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    // Try "YYYY-MM-DDTHH:MM:SS" (ISO without tz)
    if let Ok(dt) = NaiveDateTime::parse_from_str(val, "%Y-%m-%dT%H:%M:%S") {
        return Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    // Try "YYYY-MM-DDTHH:MM:SS.fffZ" or with offset
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(val) {
        return Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    // Try date-only "YYYY-MM-DD" → default to 00:00:00
    if let Ok(d) = chrono::NaiveDate::parse_from_str(val, "%Y-%m-%d") {
        return Ok(format!("{d} 00:00:00"));
    }
    Err(format!(
        "Invalid date format for value: \"{val}\". Expected YYYY-MM-DD or ISO format."
    ))
}

/// Print JSON output and return true, or return false for human-readable output.
fn format_output(json_mode: bool, data: &Value) -> bool {
    if json_mode {
        println!("{}", serde_json::to_string_pretty(data).unwrap());
        true
    } else {
        false
    }
}

/// Print error and exit.
fn exit_with_error(json_mode: bool, message: &str) -> ! {
    if json_mode {
        eprintln!(
            "{}",
            serde_json::to_string_pretty(&json!({"success": false, "error": message})).unwrap()
        );
    } else {
        eprintln!("\n[Error] {message}\n");
    }
    process::exit(1);
}

/// Split tags by comma (both , and ，), trim, and filter empty.
fn split_tags(s: &str) -> Vec<String> {
    s.split([',', '，'])
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

// ---------------------------------------------------------------------------
// Table row types for `tabled`
// ---------------------------------------------------------------------------

#[derive(Tabled)]
struct TaskRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Title")]
    title: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Priority")]
    priority: String,
    #[tabled(rename = "Due")]
    due: String,
    #[tabled(rename = "Remind")]
    remind: String,
    #[tabled(rename = "Completed")]
    completed: String,
    #[tabled(rename = "Category")]
    category: String,
    #[tabled(rename = "Tags")]
    tags: String,
}

#[derive(Tabled)]
struct TagRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
}

#[derive(Tabled)]
struct CategoryRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Color")]
    color: String,
}

fn val_str(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Null) | None => "-".to_string(),
        Some(other) => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let cli = Cli::parse();
    let json_mode = cli.json;

    if let Commands::InternalCheckUpdate = cli.command {
        update::perform_internal_check();
        return;
    }

    if let Commands::Upgrade = cli.command {
        if let Err(e) = update::perform_upgrade(json_mode) {
            exit_with_error(json_mode, &e);
        } else if json_mode {
            println!("{}", serde_json::to_string_pretty(&json!({"success": true})).unwrap());
        }
        return;
    }

    let client = ApiClient::new();

    match cli.command {
        Commands::InternalCheckUpdate | Commands::Upgrade => unreachable!(),

        // --- Info ---
        Commands::Info => {
            let data = client.info();
            if !format_output(json_mode, &data) {
                println!("{}", serde_json::to_string_pretty(&data).unwrap());
            }
        }

        // --- List ---
        Commands::List {
            query,
            status,
            priority,
            category,
            due,
            remind,
            tag,
        } => {
            let mut params = Vec::new();
            if let Some(v) = query {
                params.push(format!("q={v}"));
            }
            if let Some(v) = status {
                params.push(format!("status={v}"));
            }
            if let Some(v) = priority {
                params.push(format!("priority={v}"));
            }
            if let Some(v) = category {
                params.push(format!("category_id={v}"));
            }
            if let Some(v) = due {
                params.push(format!("due_date={v}"));
            }
            if let Some(v) = remind {
                params.push(format!("remind_at={v}"));
            }
            if let Some(v) = tag {
                params.push(format!("tag_name={v}"));
            }
            let qs = if params.is_empty() {
                String::new()
            } else {
                format!("?{}", params.join("&"))
            };

            let tasks = client.list_tasks(&qs);
            if !format_output(json_mode, &tasks) {
                if let Some(arr) = tasks.as_array() {
                    let rows: Vec<TaskRow> = arr
                        .iter()
                        .map(|t| {
                            let tags_str = t
                                .get("tags")
                                .and_then(|v| v.as_array())
                                .map(|tags| {
                                    tags.iter()
                                        .filter_map(|tag| {
                                            tag.get("name").and_then(|n| n.as_str())
                                        })
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                                .unwrap_or_else(|| "-".to_string());
                            let tags_display = if tags_str.is_empty() {
                                "-".to_string()
                            } else {
                                tags_str
                            };

                            TaskRow {
                                id: val_str(t, "id"),
                                title: val_str(t, "title"),
                                status: val_str(t, "status"),
                                priority: val_str(t, "priority"),
                                due: val_str(t, "due_date"),
                                remind: val_str(t, "remind_at"),
                                completed: val_str(t, "completed_at"),
                                category: val_str(t, "category_name"),
                                tags: tags_display,
                            }
                        })
                        .collect();
                    println!("{}", Table::new(rows));
                }
            }
        }

        // --- Add ---
        Commands::Add {
            title,
            desc,
            priority,
            category,
            due,
            remind,
            rule,
            tags,
            source,
            metadata,
        } => {
            // Validate metadata JSON
            let metadata_value = metadata.as_deref().map(|m| {
                serde_json::from_str::<Value>(m)
                    .unwrap_or_else(|_| exit_with_error(json_mode, "Invalid JSON for metadata"))
            });

            // Parse dates
            let due_date = due.as_deref().map(|d| {
                parse_date_str(d).unwrap_or_else(|e| exit_with_error(json_mode, &e))
            });
            let remind_at = remind.as_deref().map(|d| {
                parse_date_str(d).unwrap_or_else(|e| exit_with_error(json_mode, &e))
            });

            let mut payload = json!({ "title": title });
            if let Some(v) = desc {
                payload["description"] = json!(v);
            }
            if let Some(v) = priority {
                payload["priority"] = json!(v);
            }
            if let Some(v) = category {
                if let Ok(id) = v.parse::<i64>() {
                    payload["category_id"] = json!(id);
                }
            }
            if let Some(v) = due_date {
                payload["due_date"] = json!(v);
            }
            if let Some(v) = remind_at {
                payload["remind_at"] = json!(v);
            }
            if let Some(v) = rule {
                payload["recurring_rule"] = json!(v);
            }
            if let Some(v) = tags {
                payload["tags"] = json!(split_tags(&v));
            }
            if let Some(v) = source {
                payload["source"] = json!(v);
            }
            if let Some(v) = metadata_value {
                payload["metadata"] = json!(v.to_string());
            }

            let res = client.create_task(payload);
            if !format_output(json_mode, &res) {
                println!("Task created with ID: {}", val_str(&res, "id"));
            }
        }

        // --- Update ---
        Commands::Update {
            id,
            title,
            desc,
            status,
            priority,
            category,
            due,
            remind,
            rule,
            tags,
            metadata,
        } => {
            let metadata_value = metadata.as_deref().map(|m| {
                serde_json::from_str::<Value>(m)
                    .unwrap_or_else(|_| exit_with_error(json_mode, "Invalid JSON for metadata"))
            });

            let mut payload = json!({});
            if let Some(v) = title {
                payload["title"] = json!(v);
            }
            if let Some(v) = desc {
                payload["description"] = json!(v);
            }
            if let Some(v) = status {
                payload["status"] = json!(v);
            }
            if let Some(v) = priority {
                payload["priority"] = json!(v);
            }
            if let Some(v) = category {
                if v.is_empty() {
                    payload["category_id"] = Value::Null;
                } else if let Ok(cid) = v.parse::<i64>() {
                    payload["category_id"] = json!(cid);
                }
            }
            if let Some(ref v) = due {
                payload["due_date"] = json!(
                    parse_date_str(v).unwrap_or_else(|e| exit_with_error(json_mode, &e))
                );
            }
            if let Some(ref v) = remind {
                payload["remind_at"] = json!(
                    parse_date_str(v).unwrap_or_else(|e| exit_with_error(json_mode, &e))
                );
            }
            if let Some(v) = rule {
                payload["recurring_rule"] = json!(v);
            }
            if let Some(v) = tags {
                payload["tags"] = json!(split_tags(&v));
            }
            if let Some(v) = metadata_value {
                payload["metadata"] = json!(v.to_string());
            }

            if payload.as_object().map_or(true, |o| o.is_empty()) {
                exit_with_error(json_mode, "No update fields provided");
            }

            let res = client.update_task(&id, payload);
            if !format_output(json_mode, &res) {
                println!("Task {id} updated.");
            }
        }

        // --- Complete ---
        Commands::Complete { id } => {
            let res = client.complete_task(&id);
            if !format_output(json_mode, &res) {
                let default_msg = format!("Task {id} completed.");
                let msg = res
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&default_msg);
                println!("{msg}");
            }
        }

        // --- Delete ---
        Commands::Delete { id } => {
            let res = client.delete_task(&id);
            let output = if res.is_null() {
                json!({"success": true, "id": id})
            } else {
                res
            };
            if !format_output(json_mode, &output) {
                println!("Task {id} deleted.");
            }
        }

        // --- Check (Remind) ---
        Commands::Check { channel } => {
            let res = client.remind_check(&channel);
            if json_mode {
                println!("{}", serde_json::to_string_pretty(&res).unwrap());
                return;
            }
            let tasks = res.get("tasks").and_then(|v| v.as_array());
            if let Some(arr) = tasks {
                if !arr.is_empty() {
                    println!("Triggered {} reminders.", arr.len());
                    if channel == "agent" {
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&Value::Array(arr.clone())).unwrap()
                        );
                    }
                } else {
                    println!("No tasks to remind at this time.");
                }
            } else {
                println!("No tasks to remind at this time.");
            }
        }

        // --- Tags ---
        Commands::Tags => {
            let data = client.list_tags();
            if !format_output(json_mode, &data) {
                if let Some(arr) = data.as_array() {
                    let rows: Vec<TagRow> = arr
                        .iter()
                        .map(|t| TagRow {
                            id: val_str(t, "id"),
                            name: val_str(t, "name"),
                        })
                        .collect();
                    println!("{}", Table::new(rows));
                }
            }
        }

        // --- Add Tag ---
        Commands::AddTag { name } => {
            let res = client.create_tag(&name);
            if !format_output(json_mode, &res) {
                println!("Tag created with ID: {}", val_str(&res, "id"));
            }
        }

        // --- Categories ---
        Commands::Categories => {
            let data = client.list_categories();
            if !format_output(json_mode, &data) {
                if let Some(arr) = data.as_array() {
                    let rows: Vec<CategoryRow> = arr
                        .iter()
                        .map(|c| CategoryRow {
                            id: val_str(c, "id"),
                            name: val_str(c, "name"),
                            color: val_str(c, "color"),
                        })
                        .collect();
                    println!("{}", Table::new(rows));
                }
            }
        }

        // --- Add Category ---
        Commands::AddCategory { name, color } => {
            let res = client.create_category(&name, color.as_deref());
            if !format_output(json_mode, &res) {
                println!("Category created with ID: {}", val_str(&res, "id"));
            }
        }
    }

    update::check_update_info(json_mode);
    update::trigger_background_check();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_only() {
        assert_eq!(parse_date_str("2026-03-02").unwrap(), "2026-03-02 00:00:00");
    }

    #[test]
    fn parse_datetime_space() {
        assert_eq!(
            parse_date_str("2026-03-02 14:30:00").unwrap(),
            "2026-03-02 14:30:00"
        );
    }

    #[test]
    fn parse_datetime_iso_no_tz() {
        assert_eq!(
            parse_date_str("2026-03-02T14:30:00").unwrap(),
            "2026-03-02 14:30:00"
        );
    }

    #[test]
    fn parse_datetime_rfc3339_utc() {
        assert_eq!(
            parse_date_str("2026-03-02T14:30:00Z").unwrap(),
            "2026-03-02 14:30:00"
        );
    }

    #[test]
    fn parse_datetime_rfc3339_offset() {
        assert_eq!(
            parse_date_str("2026-03-02T22:30:00+08:00").unwrap(),
            "2026-03-02 22:30:00"
        );
    }

    #[test]
    fn parse_invalid_date() {
        assert!(parse_date_str("not-a-date").is_err());
        assert!(parse_date_str("").is_err());
        assert!(parse_date_str("2026-13-01").is_err());
    }
}
