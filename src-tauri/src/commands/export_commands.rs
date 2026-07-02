use std::fs::File;
use std::io::Write;

#[tauri::command]
pub async fn export_to_csv(
    data: Vec<serde_json::Map<String, serde_json::Value>>,
    file_path: String,
) -> Result<(), String> {
    if data.is_empty() {
        return Err("No data to export".to_string());
    }

    let mut file = File::create(&file_path).map_err(|e| e.to_string())?;

    // Get headers from first row
    let headers: Vec<&String> = data[0].keys().collect();

    // Write header row
    writeln!(file, "{}", headers.iter().map(|h| escape_csv(h)).collect::<Vec<_>>().join(","))
        .map_err(|e| e.to_string())?;

    // Write data rows
    for row in &data {
        let values: Vec<String> = headers
            .iter()
            .map(|h| {
                row.get(*h)
                    .map(|v| value_to_csv_string(v))
                    .unwrap_or_default()
            })
            .collect();
        writeln!(file, "{}", values.join(",")).map_err(|e| e.to_string())?;
    }

    tracing::info!("Exported {} rows to CSV: {}", data.len(), file_path);
    Ok(())
}

#[tauri::command]
pub async fn export_to_json(
    data: Vec<serde_json::Map<String, serde_json::Value>>,
    file_path: String,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;

    let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    tracing::info!("Exported {} rows to JSON: {}", data.len(), file_path);
    Ok(())
}

fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn value_to_csv_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => escape_csv(s),
        serde_json::Value::Array(arr) => escape_csv(&serde_json::to_string(arr).unwrap_or_default()),
        serde_json::Value::Object(obj) => escape_csv(&serde_json::to_string(obj).unwrap_or_default()),
    }
}
