//! OpenAI Codex (ChatGPT OAuth) request wiring, ported from PI's
//! `openai-codex-responses` provider.
//!
//! PI sends inference to `https://chatgpt.com/backend-api/codex/responses`
//! with a ChatGPT subscription OAuth bearer and a `chatgpt-account-id`
//! header derived from the JWT. Platform `api.openai.com` keys are a
//! different product and are not handled here.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

/// Claim path inside the OAuth access token (same as PI / Codex CLI).
const JWT_AUTH_CLAIM: &str = "https://api.openai.com/auth";

/// True when `base_url` targets the ChatGPT backend used by Codex OAuth.
pub fn is_openai_codex_base_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url) else {
        return false;
    };
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    host == "chatgpt.com" || host.ends_with(".chatgpt.com")
}

/// Resolve the Responses endpoint the way PI's `resolveCodexUrl` does.
///
/// * `…/codex/responses` → unchanged
/// * `…/codex` → `…/codex/responses`
/// * otherwise (for ChatGPT backend bases) → `…/codex/responses`
///
/// Non-ChatGPT bases return `None` so the generic `{base}/{path}` join is used.
pub fn resolve_codex_responses_url(base_url: &str) -> Option<String> {
    if !is_openai_codex_base_url(base_url) {
        return None;
    }
    let normalized = base_url.trim_end_matches('/');
    if normalized.ends_with("/codex/responses") {
        return Some(normalized.to_string());
    }
    if normalized.ends_with("/codex") {
        return Some(format!("{normalized}/responses"));
    }
    Some(format!("{normalized}/codex/responses"))
}

/// Extract `chatgpt_account_id` from a ChatGPT OAuth access token JWT.
///
/// Mirrors PI's `extractAccountId` / Codex CLI claim lookup.
pub fn extract_chatgpt_account_id(token: &str) -> Option<String> {
    let payload = decode_jwt_payload(token)?;
    let auth = payload.get(JWT_AUTH_CLAIM)?;
    let account_id = auth
        .get("chatgpt_account_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?;
    Some(account_id.to_string())
}

/// Inject Codex-required headers into a request header map.
///
/// Existing keys are left alone (callers / config can override). The caller
/// prepares `Authorization`; this helper adds the JWT-derived account ID,
/// `originator`, and for SSE `OpenAI-Beta: responses=experimental`.
pub fn inject_codex_headers(headers: &mut HeaderMap, bearer: Option<&str>) {
    if let Some(token) = bearer {
        if let Some(account_id) = extract_chatgpt_account_id(token)
            && let Ok(value) = HeaderValue::from_str(&account_id)
        {
            headers
                .entry(HeaderName::from_static("chatgpt-account-id"))
                .or_insert(value);
        }
    }
    headers
        .entry(HeaderName::from_static("originator"))
        .or_insert_with(|| HeaderValue::from_static("gcode"));
    headers
        .entry(HeaderName::from_static("openai-beta"))
        .or_insert_with(|| HeaderValue::from_static("responses=experimental"));
}

/// Adapt the generic Responses request shape to the shape used by PI's
/// `openai-codex-responses` provider.
///
/// The shared conversation converter represents system messages as Responses
/// input items. ChatGPT's Codex endpoint expects them in the top-level
/// `instructions` field instead, so move them there before serialization.
/// Keep this as a JSON-level adapter: the shared request types are also used by
/// xAI and ordinary OpenAI Responses endpoints and must retain their existing
/// wire format.
pub fn adapt_codex_response_body(body: &mut serde_json::Value) {
    let instructions = body
        .get_mut("input")
        .and_then(serde_json::Value::as_array_mut)
        .map(|input| {
            let mut system_parts = Vec::new();
            input.retain(|item| {
                let is_system =
                    item.get("role").and_then(serde_json::Value::as_str) == Some("system");
                if is_system {
                    if let Some(content) = item.get("content") {
                        append_instruction_content(content, &mut system_parts);
                    }
                }
                !is_system
            });
            system_parts.join("\n\n")
        })
        .filter(|instructions| !instructions.is_empty());

    if let Some(instructions) = instructions {
        body["instructions"] = serde_json::Value::String(instructions);
    } else if body
        .get("instructions")
        .is_none_or(serde_json::Value::is_null)
    {
        body["instructions"] = serde_json::Value::String("You are a helpful assistant.".into());
    }

    if body.get("store").is_none_or(serde_json::Value::is_null) {
        body["store"] = serde_json::Value::Bool(false);
    }

    if !body.get("include").is_some_and(serde_json::Value::is_array) {
        body["include"] = serde_json::Value::Array(Vec::new());
    }
    let include = body
        .get_mut("include")
        .and_then(serde_json::Value::as_array_mut)
        .expect("include was inserted as an array");
    if !include
        .iter()
        .any(|value| value.as_str() == Some("reasoning.encrypted_content"))
    {
        include.push(serde_json::Value::String(
            "reasoning.encrypted_content".into(),
        ));
    }

    if body
        .get("parallel_tool_calls")
        .is_none_or(serde_json::Value::is_null)
    {
        body["parallel_tool_calls"] = serde_json::Value::Bool(true);
    }
    if body
        .get("tool_choice")
        .is_none_or(serde_json::Value::is_null)
    {
        body["tool_choice"] = serde_json::Value::String("auto".into());
    }

    match body.get_mut("text") {
        Some(serde_json::Value::Object(text)) => {
            text.entry("verbosity")
                .or_insert_with(|| serde_json::Value::String("low".into()));
        }
        Some(serde_json::Value::Null) | None => {
            body["text"] = serde_json::json!({"verbosity": "low"});
        }
        _ => {}
    }

    if let Some(serde_json::Value::Object(reasoning)) = body.get_mut("reasoning") {
        reasoning.insert("summary".into(), serde_json::Value::String("auto".into()));
    }
}

fn append_instruction_content(content: &serde_json::Value, parts: &mut Vec<String>) {
    if let Some(text) = content.as_str() {
        parts.push(text.to_owned());
        return;
    }
    if let Some(items) = content.as_array() {
        for item in items {
            if let Some(text) = item.get("text").and_then(serde_json::Value::as_str) {
                parts.push(text.to_owned());
            }
        }
    }
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    if parts.next().is_none() {
        return None;
    }
    // Reject tokens with extra segments.
    if parts.next().is_some() {
        return None;
    }
    let decoded = base64url_decode(payload)?;
    serde_json::from_slice(&decoded).ok()
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    // Manual base64url decode avoids a new crate dependency on the sampler.
    const TABLE: &[u8; 128] = &{
        let mut t = [0xffu8; 128];
        let mut i = 0u8;
        while i < 26 {
            t[(b'A' + i) as usize] = i;
            t[(b'a' + i) as usize] = 26 + i;
            i += 1;
        }
        i = 0;
        while i < 10 {
            t[(b'0' + i) as usize] = 52 + i;
            i += 1;
        }
        t[b'+' as usize] = 62;
        t[b'/' as usize] = 63;
        t[b'-' as usize] = 62; // url-safe
        t[b'_' as usize] = 63; // url-safe
        t
    };

    let mut cleaned = input.as_bytes().to_vec();
    // Strip padding if present; re-add to multiple of 4.
    while cleaned.last() == Some(&b'=') {
        cleaned.pop();
    }
    let pad = (4 - (cleaned.len() % 4)) % 4;
    cleaned.extend(std::iter::repeat(b'=').take(pad));

    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks(4) {
        if chunk.len() < 4 {
            return None;
        }
        let mut vals = [0u8; 4];
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                vals[i] = 0;
                continue;
            }
            if c as usize >= TABLE.len() || TABLE[c as usize] == 0xff {
                return None;
            }
            vals[i] = TABLE[c as usize];
        }
        out.push((vals[0] << 2) | (vals[1] >> 4));
        if chunk[2] != b'=' {
            out.push((vals[1] << 4) | (vals[2] >> 2));
        }
        if chunk[3] != b'=' {
            out.push((vals[2] << 6) | vals[3]);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base64url_encode(bytes: &[u8]) -> String {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        let mut i = 0;
        while i < bytes.len() {
            let b0 = bytes[i];
            let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
            let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
            out.push(CHARS[(b0 >> 2) as usize] as char);
            out.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
            if i + 1 < bytes.len() {
                out.push(CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
            }
            if i + 2 < bytes.len() {
                out.push(CHARS[(b2 & 0x3f) as usize] as char);
            }
            i += 3;
        }
        out
    }

    fn make_jwt(account_id: &str) -> String {
        let header = base64url_encode(br#"{"alg":"none"}"#);
        let payload = base64url_encode(
            format!(r#"{{"https://api.openai.com/auth":{{"chatgpt_account_id":"{account_id}"}}}}"#)
                .as_bytes(),
        );
        format!("{header}.{payload}.sig")
    }

    #[test]
    fn detect_chatgpt_backend() {
        assert!(is_openai_codex_base_url("https://chatgpt.com/backend-api"));
        assert!(is_openai_codex_base_url(
            "https://chatgpt.com/backend-api/codex"
        ));
        assert!(!is_openai_codex_base_url("https://api.openai.com/v1"));
        assert!(!is_openai_codex_base_url("https://api.x.ai/v1"));
    }

    #[test]
    fn resolve_url_like_pi() {
        assert_eq!(
            resolve_codex_responses_url("https://chatgpt.com/backend-api").as_deref(),
            Some("https://chatgpt.com/backend-api/codex/responses")
        );
        assert_eq!(
            resolve_codex_responses_url("https://chatgpt.com/backend-api/codex").as_deref(),
            Some("https://chatgpt.com/backend-api/codex/responses")
        );
        assert_eq!(
            resolve_codex_responses_url("https://chatgpt.com/backend-api/codex/responses")
                .as_deref(),
            Some("https://chatgpt.com/backend-api/codex/responses")
        );
        assert_eq!(
            resolve_codex_responses_url("https://api.openai.com/v1"),
            None
        );
    }

    #[test]
    fn extract_account_id_from_jwt() {
        let token = make_jwt("acct-123");
        assert_eq!(
            extract_chatgpt_account_id(&token).as_deref(),
            Some("acct-123")
        );
        assert_eq!(extract_chatgpt_account_id("not-a-jwt"), None);
    }

    #[test]
    fn inject_headers_sets_account_and_beta() {
        let token = make_jwt("acct-xyz");
        let mut headers = HeaderMap::new();
        inject_codex_headers(&mut headers, Some(&token));
        assert_eq!(
            headers
                .get("chatgpt-account-id")
                .and_then(|v| v.to_str().ok()),
            Some("acct-xyz")
        );
        assert_eq!(
            headers.get("originator").and_then(|v| v.to_str().ok()),
            Some("gcode")
        );
        assert_eq!(
            headers.get("openai-beta").and_then(|v| v.to_str().ok()),
            Some("responses=experimental")
        );
    }

    #[test]
    fn inject_headers_preserves_existing() {
        let token = make_jwt("acct-xyz");
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("originator"),
            HeaderValue::from_static("custom"),
        );
        inject_codex_headers(&mut headers, Some(&token));
        assert_eq!(
            headers.get("originator").and_then(|v| v.to_str().ok()),
            Some("custom")
        );
    }

    #[test]
    fn adapt_body_moves_system_input_to_instructions() {
        let mut body = serde_json::json!({
            "input": [
                {"type": "message", "role": "system", "content": "system one"},
                {"type": "message", "role": "user", "content": "hello"}
            ],
            "reasoning": {"effort": "high", "summary": "concise"}
        });

        adapt_codex_response_body(&mut body);

        assert_eq!(body["instructions"], "system one");
        assert_eq!(body["input"].as_array().unwrap().len(), 1);
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["store"], false);
        assert_eq!(body["parallel_tool_calls"], true);
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["text"]["verbosity"], "low");
        assert_eq!(body["reasoning"]["summary"], "auto");
        assert_eq!(body["include"][0], "reasoning.encrypted_content");
    }

    #[test]
    fn adapt_body_keeps_existing_instructions_and_does_not_duplicate_include() {
        let mut body = serde_json::json!({
            "instructions": "keep me",
            "include": ["reasoning.encrypted_content"],
            "input": [{"type": "message", "role": "user", "content": "hello"}],
            "text": {"verbosity": "high"}
        });

        adapt_codex_response_body(&mut body);

        assert_eq!(body["instructions"], "keep me");
        assert_eq!(body["include"].as_array().unwrap().len(), 1);
        assert_eq!(body["text"]["verbosity"], "high");
    }
}
