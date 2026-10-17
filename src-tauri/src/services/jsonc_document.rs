//! Ordered JSONC nodes and surgical edits. Permission key order is meaningful.
use crate::error::AppError;
use serde_json::Value;

#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub start: usize,
    pub end: usize,
    pub value: Value,
    pub members: Vec<Member>,
    pub elements: Vec<Node>,
}
#[derive(Clone, Debug)]
pub(crate) struct Member {
    pub key: String,
    pub start: usize,
    pub node: Node,
    pub comma: Option<usize>,
}
impl Node {
    pub fn get(&self, key: &str) -> Option<&Node> {
        self.members
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| &entry.node)
    }
}
fn invalid() -> AppError {
    AppError::Conflict("原生 JSON/JSONC 无效、含重复键或结构无法识别。".into())
}
struct Parser<'a> {
    text: &'a str,
    pos: usize,
}
impl Parser<'_> {
    fn space(&mut self) -> Result<(), AppError> {
        let b = self.text.as_bytes();
        loop {
            while b.get(self.pos).is_some_and(u8::is_ascii_whitespace) {
                self.pos += 1;
            }
            if b.get(self.pos..self.pos + 2) == Some(b"//") {
                while b.get(self.pos).is_some_and(|c| *c != b'\n') {
                    self.pos += 1;
                }
            } else if b.get(self.pos..self.pos + 2) == Some(b"/*") {
                let offset = self.text[self.pos + 2..].find("*/").ok_or_else(invalid)?;
                self.pos += offset + 4;
            } else {
                return Ok(());
            }
        }
    }
    fn string(&mut self) -> Result<String, AppError> {
        let start = self.pos;
        if self.text.as_bytes().get(self.pos) != Some(&b'"') {
            return Err(invalid());
        }
        self.pos += 1;
        let mut escaped = false;
        while let Some(c) = self.text.as_bytes().get(self.pos) {
            self.pos += 1;
            if escaped {
                escaped = false;
            } else if *c == b'\\' {
                escaped = true;
            } else if *c == b'"' {
                return serde_json::from_str(&self.text[start..self.pos]).map_err(|_| invalid());
            }
        }
        Err(invalid())
    }
    fn node(&mut self, depth: usize) -> Result<Node, AppError> {
        if depth > 128 {
            return Err(invalid());
        }
        self.space()?;
        let start = self.pos;
        let mut members: Vec<Member> = Vec::new();
        let mut elements = Vec::new();
        let value = match self.text.as_bytes().get(self.pos) {
            Some(b'{') => {
                self.pos += 1;
                self.space()?;
                let mut map = serde_json::Map::new();
                while self.text.as_bytes().get(self.pos) != Some(&b'}') {
                    let key_start = self.pos;
                    let key = self.string()?;
                    if map.contains_key(&key) {
                        return Err(invalid());
                    }
                    self.space()?;
                    if self.text.as_bytes().get(self.pos) != Some(&b':') {
                        return Err(invalid());
                    }
                    self.pos += 1;
                    let node = self.node(depth + 1)?;
                    map.insert(key.clone(), node.value.clone());
                    self.space()?;
                    let comma =
                        (self.text.as_bytes().get(self.pos) == Some(&b',')).then_some(self.pos);
                    members.push(Member {
                        key,
                        start: key_start,
                        node,
                        comma,
                    });
                    if comma.is_some() {
                        self.pos += 1;
                        self.space()?;
                    } else if self.text.as_bytes().get(self.pos) != Some(&b'}') {
                        return Err(invalid());
                    }
                }
                self.pos += 1;
                Value::Object(map)
            }
            Some(b'[') => {
                self.pos += 1;
                self.space()?;
                while self.text.as_bytes().get(self.pos) != Some(&b']') {
                    elements.push(self.node(depth + 1)?);
                    self.space()?;
                    if self.text.as_bytes().get(self.pos) == Some(&b',') {
                        self.pos += 1;
                        self.space()?;
                    } else if self.text.as_bytes().get(self.pos) != Some(&b']') {
                        return Err(invalid());
                    }
                }
                self.pos += 1;
                Value::Array(elements.iter().map(|node| node.value.clone()).collect())
            }
            Some(b'"') => Value::String(self.string()?),
            Some(_) => {
                while self
                    .text
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(|c| !c.is_ascii_whitespace() && !b",}]/".contains(c))
                {
                    self.pos += 1;
                }
                serde_json::from_str(&self.text[start..self.pos]).map_err(|_| invalid())?
            }
            None => return Err(invalid()),
        };
        Ok(Node {
            start,
            end: self.pos,
            value,
            members,
            elements,
        })
    }
}
pub(crate) fn parse(text: &str) -> Result<Node, AppError> {
    let mut parser = Parser { text, pos: 0 };
    let node = parser.node(0)?;
    parser.space()?;
    if parser.pos != text.len() || !node.value.is_object() {
        return Err(invalid());
    }
    Ok(node)
}
fn replace(text: &str, start: usize, end: usize, value: &str) -> String {
    format!("{}{}{}", &text[..start], value, &text[end..])
}
pub(crate) fn set(text: &str, path: &[&str], value: Value) -> Result<String, AppError> {
    let root = parse(text)?;
    fn edit(text: &str, node: &Node, path: &[&str], value: Value) -> Result<String, AppError> {
        if path.is_empty() {
            return Ok(replace(text, node.start, node.end, &value.to_string()));
        }
        if !node.value.is_object() {
            return Err(invalid());
        }
        if let Some(child) = node.get(path[0]) {
            return edit(text, child, &path[1..], value);
        }
        let mut nested = value;
        for key in path[1..].iter().rev() {
            nested = serde_json::json!({*key: nested});
        }
        let insert = format!(
            "\n{}: {}\n",
            serde_json::to_string(path[0]).unwrap(),
            nested
        );
        let mut output = replace(text, node.end - 1, node.end - 1, &insert);
        if let Some(last) = node.members.last().filter(|entry| entry.comma.is_none()) {
            output.insert(last.node.end, ',');
        }
        Ok(output)
    }
    let output = edit(text, &root, path, value)?;
    parse(&output)?;
    Ok(output)
}
pub(crate) fn remove(text: &str, path: &[&str]) -> Result<String, AppError> {
    let root = parse(text)?;
    let mut parent = &root;
    for key in &path[..path.len() - 1] {
        let Some(next) = parent.get(key) else {
            return Ok(text.into());
        };
        parent = next;
    }
    let Some(index) = parent
        .members
        .iter()
        .position(|entry| entry.key == path[path.len() - 1])
    else {
        return Ok(text.into());
    };
    let entry = &parent.members[index];
    let mut output = replace(text, entry.start, entry.node.end, "");
    let comma = entry
        .comma
        .or_else(|| index.checked_sub(1).and_then(|i| parent.members[i].comma));
    if let Some(comma) = comma {
        let adjusted = if comma >= entry.node.end {
            comma - (entry.node.end - entry.start)
        } else {
            comma
        };
        output.remove(adjusted);
    }
    parse(&output)?;
    Ok(output)
}
pub(crate) fn remove_element(text: &str, path: &[&str], index: usize) -> Result<String, AppError> {
    let root = parse(text)?;
    let mut array = &root;
    for key in path {
        array = array.get(key).ok_or_else(invalid)?;
    }
    let entry = array.elements.get(index).ok_or_else(invalid)?;
    let mut parser = Parser {
        text,
        pos: entry.end,
    };
    parser.space()?;
    let next_comma = (text.as_bytes().get(parser.pos) == Some(&b',')).then_some(parser.pos);
    let previous_comma = index.checked_sub(1).and_then(|i| {
        let mut parser = Parser {
            text,
            pos: array.elements[i].end,
        };
        parser.space().ok()?;
        (text.as_bytes().get(parser.pos) == Some(&b',')).then_some(parser.pos)
    });
    let mut output = replace(text, entry.start, entry.end, "");
    if let Some(comma) = next_comma.or(previous_comma) {
        output.remove(if comma >= entry.end {
            comma - (entry.end - entry.start)
        } else {
            comma
        });
    }
    parse(&output)?;
    Ok(output)
}
pub(crate) fn append(text: &str, path: &[&str], value: Value) -> Result<String, AppError> {
    let root = parse(text)?;
    let mut node = &root;
    for key in path {
        let Some(next) = node.get(key) else {
            return set(text, path, serde_json::json!([value]));
        };
        node = next;
    }
    if !node.value.is_array() {
        return Err(invalid());
    }
    let mut parser = Parser {
        text,
        pos: node.elements.last().map_or(node.start + 1, |last| last.end),
    };
    parser.space()?;
    let comma = !node.elements.is_empty() && text.as_bytes().get(parser.pos) != Some(&b',');
    let output = replace(
        text,
        node.end - 1,
        node.end - 1,
        &format!("{}\n{}\n", if comma { "," } else { "" }, value),
    );
    parse(&output)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_keep_comments_and_literal_comma_brace_strings() {
        let text = r#"{ // header
          "permissions":[{"action":"skill","resource":"*","effect":"ask"} // keep first
          ], "unknown":"literal ,} // and /* string */",
        }"#;
        let output = append(
            text,
            &["permissions"],
            serde_json::json!({"action":"skill","resource":"review","effect":"deny"}),
        )
        .unwrap();
        assert!(output.contains("// keep first"));
        assert!(output.contains("literal ,} // and /* string */"));
        let restored = remove_element(&output, &["permissions"], 1).unwrap();
        assert_eq!(parse(&restored).unwrap().value, parse(text).unwrap().value);
        assert!(restored.contains("// keep first"));
        let nested = set(
            text,
            &["permission", "skill", "review"],
            serde_json::json!("deny"),
        )
        .unwrap();
        assert_eq!(
            parse(&nested).unwrap().value["permission"]["skill"]["review"],
            "deny"
        );
    }
    #[test]
    fn malformed_duplicate_or_non_object_documents_are_rejected() {
        for text in [
            r#"{"permission":{},"permission":{}}"#,
            r#"{"permission": /* broken}"#,
            r#"[]"#,
            r#"{"a":"invalid
string"}"#,
        ] {
            assert!(parse(text).is_err());
        }
    }
}
