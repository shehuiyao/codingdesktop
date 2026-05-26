use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const DEFAULT_REDIS_HOST: &str = "127.0.0.1";
const DEFAULT_REDIS_PORT: u16 = 6381;
const DEFAULT_REDIS_DB: u8 = 0;
const REDIS_TIMEOUT_MS: u64 = 800;
const VERIFY_CODE_PATTERN: &str = "pf_verify_code:*";
const MAX_SCAN_ROUNDS: usize = 20;
const MAX_CODES: usize = 50;

#[derive(Serialize)]
pub struct RedisVerifyCode {
    key: String,
    scene: String,
    phone: String,
    code: String,
    ttl_seconds: i64,
}

enum RespValue {
    Simple(String),
    Error(String),
    Integer(i64),
    Bulk(Option<Vec<u8>>),
    Array(Vec<RespValue>),
}

fn encode_command(parts: &[&str]) -> Vec<u8> {
    let mut payload = format!("*{}\r\n", parts.len()).into_bytes();
    for part in parts {
        payload.extend_from_slice(format!("${}\r\n", part.as_bytes().len()).as_bytes());
        payload.extend_from_slice(part.as_bytes());
        payload.extend_from_slice(b"\r\n");
    }
    payload
}

fn read_line(stream: &mut TcpStream) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        stream
            .read_exact(&mut byte)
            .map_err(|e| format!("读取 Redis 响应失败: {}", e))?;
        buf.push(byte[0]);
        if buf.len() >= 2 && buf[buf.len() - 2..] == *b"\r\n" {
            buf.truncate(buf.len() - 2);
            return String::from_utf8(buf).map_err(|e| format!("Redis 响应不是 UTF-8: {}", e));
        }
    }
}

fn read_resp(stream: &mut TcpStream) -> Result<RespValue, String> {
    let mut prefix = [0_u8; 1];
    stream
        .read_exact(&mut prefix)
        .map_err(|e| format!("读取 Redis 响应失败: {}", e))?;

    match prefix[0] {
        b'+' => Ok(RespValue::Simple(read_line(stream)?)),
        b'-' => Ok(RespValue::Error(read_line(stream)?)),
        b':' => read_line(stream)?
            .parse::<i64>()
            .map(RespValue::Integer)
            .map_err(|e| format!("Redis 整数响应解析失败: {}", e)),
        b'$' => {
            let len = read_line(stream)?
                .parse::<isize>()
                .map_err(|e| format!("Redis 字符串长度解析失败: {}", e))?;
            if len < 0 {
                return Ok(RespValue::Bulk(None));
            }
            let mut data = vec![0_u8; len as usize];
            stream
                .read_exact(&mut data)
                .map_err(|e| format!("读取 Redis 字符串失败: {}", e))?;
            let mut crlf = [0_u8; 2];
            stream
                .read_exact(&mut crlf)
                .map_err(|e| format!("读取 Redis 字符串结尾失败: {}", e))?;
            Ok(RespValue::Bulk(Some(data)))
        }
        b'*' => {
            let len = read_line(stream)?
                .parse::<isize>()
                .map_err(|e| format!("Redis 数组长度解析失败: {}", e))?;
            if len < 0 {
                return Ok(RespValue::Array(Vec::new()));
            }
            let mut items = Vec::with_capacity(len as usize);
            for _ in 0..len {
                items.push(read_resp(stream)?);
            }
            Ok(RespValue::Array(items))
        }
        other => Err(format!("未知 Redis 响应类型: {}", other as char)),
    }
}

fn send_command(stream: &mut TcpStream, parts: &[&str]) -> Result<RespValue, String> {
    let payload = encode_command(parts);
    stream
        .write_all(&payload)
        .map_err(|e| format!("发送 Redis 命令失败: {}", e))?;
    let resp = read_resp(stream)?;
    if let RespValue::Error(message) = &resp {
        return Err(format!("Redis 返回错误: {}", message));
    }
    Ok(resp)
}

fn bulk_to_string(value: &RespValue) -> Option<String> {
    match value {
        RespValue::Bulk(Some(bytes)) => String::from_utf8(bytes.clone()).ok(),
        RespValue::Simple(text) => Some(text.clone()),
        _ => None,
    }
}

fn parse_scan_response(value: RespValue) -> Result<(String, Vec<String>), String> {
    let RespValue::Array(items) = value else {
        return Err("Redis SCAN 响应格式不正确".to_string());
    };
    if items.len() != 2 {
        return Err("Redis SCAN 响应长度不正确".to_string());
    }

    let cursor = bulk_to_string(&items[0]).ok_or("Redis SCAN 游标解析失败")?;
    let RespValue::Array(keys) = &items[1] else {
        return Err("Redis SCAN key 列表解析失败".to_string());
    };
    let keys = keys.iter().filter_map(bulk_to_string).collect();
    Ok((cursor, keys))
}

fn parse_key_parts(key: &str) -> (String, String) {
    let parts: Vec<&str> = key.split(':').collect();
    let scene = parts.get(1).copied().unwrap_or("").to_string();
    let phone = parts.last().copied().unwrap_or("").to_string();
    (scene, phone)
}

#[tauri::command]
pub fn get_redis_verify_codes(
    host: Option<String>,
    port: Option<u16>,
    db: Option<u8>,
) -> Result<Vec<RedisVerifyCode>, String> {
    let host = host
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_REDIS_HOST.to_string());
    let port = port.unwrap_or(DEFAULT_REDIS_PORT);
    let db = db.unwrap_or(DEFAULT_REDIS_DB).to_string();
    let address = format!("{}:{}", host, port);
    let socket = address
        .to_socket_addrs()
        .map_err(|e| format!("解析 Redis 地址失败: {}", e))?
        .next()
        .ok_or_else(|| format!("找不到 Redis 地址: {}", address))?;

    let timeout = Duration::from_millis(REDIS_TIMEOUT_MS);
    let mut stream = TcpStream::connect_timeout(&socket, timeout)
        .map_err(|e| format!("连接 Redis 失败（{}）: {}", address, e))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("设置 Redis 读取超时失败: {}", e))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("设置 Redis 写入超时失败: {}", e))?;

    match send_command(&mut stream, &["SELECT", &db])? {
        RespValue::Simple(text) if text.eq_ignore_ascii_case("OK") => {}
        _ => return Err("选择 Redis DB 失败".to_string()),
    }

    let mut cursor = "0".to_string();
    let mut keys = Vec::new();
    for _ in 0..MAX_SCAN_ROUNDS {
        let response = send_command(
            &mut stream,
            &[
                "SCAN",
                &cursor,
                "MATCH",
                VERIFY_CODE_PATTERN,
                "COUNT",
                "100",
            ],
        )?;
        let (next_cursor, next_keys) = parse_scan_response(response)?;
        keys.extend(next_keys);
        keys.sort();
        keys.dedup();
        if keys.len() >= MAX_CODES || next_cursor == "0" {
            break;
        }
        cursor = next_cursor;
    }

    let mut codes = Vec::new();
    for key in keys.into_iter().take(MAX_CODES) {
        let value = send_command(&mut stream, &["GET", &key])?;
        let Some(code) = bulk_to_string(&value).filter(|text| !text.trim().is_empty()) else {
            continue;
        };
        let ttl = match send_command(&mut stream, &["TTL", &key])? {
            RespValue::Integer(value) => value,
            _ => -1,
        };
        let (scene, phone) = parse_key_parts(&key);
        codes.push(RedisVerifyCode {
            key,
            scene,
            phone,
            code,
            ttl_seconds: ttl,
        });
    }

    codes.sort_by(|first, second| second.ttl_seconds.cmp(&first.ttl_seconds));
    Ok(codes)
}
