use reqwest::blocking::Client;
use serde_json::Value;
use std::env;
use std::fs;
use semver::Version;

const REPO_API_URL: &str = "https://api.github.com/repos/gray0128/claw-owner-task/releases/latest";

fn get_asset_name() -> Option<&'static str> {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("claw-task-linux")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("claw-task-macos-arm64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("claw-task-macos-x64")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("claw-task.exe")
    } else {
        None
    }
}

pub fn check_update_info(json_mode: bool) {
    if json_mode {
        return;
    }
    let temp_dir = env::temp_dir();
    let info_file = temp_dir.join("claw_task_update_info.txt");
    if let Ok(content) = fs::read_to_string(&info_file) {
        let tag = content.trim();
        if !tag.is_empty() {
            println!("\n💡 发现新版本 {}！运行 \"claw-task upgrade\" 即可自动升级。", tag);
        }
    }
}

pub fn trigger_background_check() {
    let temp_dir = env::temp_dir();
    let check_file = temp_dir.join("claw_task_last_check.txt");
    
    let mut should_check = true;
    if let Ok(metadata) = fs::metadata(&check_file) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                if elapsed.as_secs() < 86400 { // 24 hours
                    should_check = false;
                }
            }
        }
    }
    
    if should_check {
        if let Ok(exe) = env::current_exe() {
            // Spawn detached process
            let _ = std::process::Command::new(exe)
                .arg("internal-check-update")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
}

pub fn perform_internal_check() {
    let temp_dir = env::temp_dir();
    let check_file = temp_dir.join("claw_task_last_check.txt");
    let _ = fs::write(&check_file, ""); // Update last check time
    
    if let Ok(client) = Client::builder().user_agent("claw-task-cli").build() {
        if let Ok(res) = client.get(REPO_API_URL).send() {
            if res.status().is_success() {
                if let Ok(json) = res.json::<Value>() {
                    if let Some(tag) = json.get("tag_name").and_then(|v| v.as_str()) {
                        let latest_ver_str = tag.trim_start_matches('v');
                        if let (Ok(current_ver), Ok(latest_ver)) = (
                            Version::parse(env!("CARGO_PKG_VERSION")),
                            Version::parse(latest_ver_str)
                        ) {
                            let info_file = temp_dir.join("claw_task_update_info.txt");
                            if latest_ver > current_ver {
                                let _ = fs::write(info_file, tag);
                            } else {
                                let _ = fs::remove_file(info_file);
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn perform_upgrade(json_mode: bool) -> Result<(), String> {
    let client = Client::builder().user_agent("claw-task-cli").build().map_err(|e| e.to_string())?;
    
    if !json_mode {
        println!("Checking for latest release...");
    }
    
    let res = client.get(REPO_API_URL).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to fetch release info: {}", res.status()));
    }
    
    let json: Value = res.json().map_err(|e| e.to_string())?;
    let tag = json.get("tag_name").and_then(|v| v.as_str()).ok_or("Release has no tag_name")?;
    let latest_ver_str = tag.trim_start_matches('v');
    
    let current_ver = Version::parse(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
    let latest_ver = Version::parse(latest_ver_str).map_err(|e| e.to_string())?;
    
    if latest_ver <= current_ver {
        if !json_mode {
            println!("You are already on the latest version v{}.", current_ver);
        }
        return Ok(());
    }
    
    let asset_name = get_asset_name().ok_or("No pre-built binary available for your OS/Arch")?;
    
    let assets = json.get("assets").and_then(|v| v.as_array()).ok_or("No assets found in release")?;
    let download_url = assets.iter()
        .find_map(|a| {
            if a.get("name").and_then(|n| n.as_str()) == Some(asset_name) {
                a.get("browser_download_url").and_then(|url| url.as_str())
            } else {
                None
            }
        })
        .ok_or(format!("Could not find asset '{}' in release", asset_name))?;
        
    if !json_mode {
        println!("Downloading update (v{}) from {}", latest_ver_str, download_url);
    }
    
    let mut res = client.get(download_url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to download asset: {}", res.status()));
    }
    
    let temp_file = env::temp_dir().join(asset_name);
    let mut file = fs::File::create(&temp_file).map_err(|e| e.to_string())?;
    res.copy_to(&mut file).map_err(|e| e.to_string())?;
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_file, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    
    self_replace::self_replace(&temp_file).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&temp_file);
    
    let info_file = env::temp_dir().join("claw_task_update_info.txt");
    let _ = fs::remove_file(info_file);
    
    if !json_mode {
        println!("✅ Successfully upgraded to version v{}", latest_ver_str);
    }
    
    Ok(())
}
