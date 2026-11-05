//! Git byte-wildmatch semantics used by the Apple and web sync adapters.
//! The shared syncIgnore.fixtures.json Git oracle prevents language drift.
//! Search keeps its existing matcher; backup must preserve saved sync policy.
#[derive(Clone)]
enum Token {
    Literal(u8),
    Any,
    Star,
    Glob,
    GlobSlash,
    Members(Box<[bool; 256]>, bool),
}
struct Rule {
    tokens: Vec<Token>,
    basename: bool,
    directory: bool,
    negative: bool,
}
pub struct BackupIgnoreRules {
    rules: Vec<Rule>,
}
impl BackupIgnoreRules {
    pub fn new(text: &str) -> Self {
        let mut rules = Vec::new();
        for (index, raw) in text.as_bytes().split(|b| *b == 10).enumerate() {
            let mut line = raw;
            if line.last() == Some(&13) {
                line = &line[..line.len() - 1];
            }
            if index == 0 && line.starts_with(&[239, 187, 191]) {
                line = &line[3..];
            }
            while line.last() == Some(&32) {
                let escapes = line[..line.len() - 1]
                    .iter()
                    .rev()
                    .take_while(|b| **b == 92)
                    .count();
                if escapes % 2 == 1 {
                    break;
                }
                line = &line[..line.len() - 1];
            }
            if line.is_empty() || line[0] == 35 {
                continue;
            }
            let negative = line[0] == 33;
            if negative {
                line = &line[1..];
            }
            let directory = line.last() == Some(&47);
            if directory {
                line = &line[..line.len() - 1];
            }
            let anchored = line.first() == Some(&47);
            if anchored {
                line = &line[1..];
            }
            if line.is_empty() {
                continue;
            }
            if let Some(tokens) = compile(line) {
                rules.push(Rule {
                    tokens,
                    basename: !anchored && !line.contains(&47),
                    directory,
                    negative,
                });
            }
        }
        Self { rules }
    }
    pub fn ignores_entry(&self, path: &str, directory: bool) -> bool {
        let mut ignored = false;
        let bytes = path.as_bytes();
        let basename = bytes.rsplit(|b| *b == 47).next().unwrap_or(bytes);
        for r in &self.rules {
            if (!r.directory || directory)
                && matches(&r.tokens, if r.basename { basename } else { bytes })
            {
                ignored = !r.negative;
            }
        }
        ignored
    }
    pub fn ignores(&self, path: &str, directory: bool) -> bool {
        path.match_indices('/')
            .any(|(i, _)| self.ignores_entry(&path[..i], true))
            || self.ignores_entry(path, directory)
    }
}
fn compile(p: &[u8]) -> Option<Vec<Token>> {
    let mut result = Vec::new();
    let mut i = 0;
    while i < p.len() {
        match p[i] {
            92 => {
                i += 1;
                result.push(Token::Literal(*p.get(i)?));
                i += 1;
            }
            63 => {
                result.push(Token::Any);
                i += 1;
            }
            42 => {
                let start = i;
                while p.get(i) == Some(&42) {
                    i += 1;
                }
                let before = start == 0 || p[start - 1] == 47;
                let after =
                    p.get(i) == Some(&47) || (p.get(i) == Some(&92) && p.get(i + 1) == Some(&47));
                if i - start >= 2 && before && (i == p.len() || after) {
                    if p.get(i) == Some(&47) {
                        i += 1;
                        result.push(Token::GlobSlash);
                    } else {
                        result.push(Token::Glob);
                    }
                } else {
                    result.push(Token::Star);
                }
            }
            91 => {
                let (token, end) = bracket(p, i)?;
                result.push(token);
                i = end;
            }
            byte => {
                result.push(Token::Literal(byte));
                i += 1;
            }
        }
    }
    Some(result)
}
fn bracket(p: &[u8], start: usize) -> Option<(Token, usize)> {
    let mut i = start + 1;
    let mut members = Box::new([false; 256]);
    let mut previous = None;
    let negative = matches!(p.get(i), Some(33 | 94));
    if negative {
        i += 1;
    }
    let mut first = true;
    while i < p.len() {
        if p[i] == 93 && !first {
            return Some((Token::Members(members, negative), i + 1));
        }
        first = false;
        if p[i] == 91 && p.get(i + 1) == Some(&58) {
            if let Some(close) =
                (i + 2..p.len()).find(|j| p[*j] == 58 && p.get(*j + 1) == Some(&93))
            {
                let name = std::str::from_utf8(&p[i + 2..close]).ok()?;
                let class = ascii_class(name)?;
                for (i, value) in class.iter().enumerate() {
                    members[i] |= value;
                }
                previous = None;
                i = close + 2;
                continue;
            }
        }
        let mut value = p[i];
        let escaped = value == 92;
        i += 1;
        if escaped {
            value = *p.get(i)?;
            i += 1;
        }
        if !escaped && value == 45 && previous.is_some() && i < p.len() && p[i] != 93 {
            let from = previous?;
            let mut to = p[i];
            i += 1;
            if to == 92 {
                to = *p.get(i)?;
                i += 1;
            }
            if from <= to {
                for b in from..=to {
                    members[b as usize] = true;
                }
            }
            previous = None;
        } else {
            members[value as usize] = true;
            previous = Some(value);
        }
    }
    None
}
fn ascii_class(name: &str) -> Option<[bool; 256]> {
    if ![
        "alnum", "alpha", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space",
        "upper", "xdigit",
    ]
    .contains(&name)
    {
        return None;
    }
    let mut values = [false; 256];
    for b in 0_u8..=127 {
        values[b as usize] = match name {
            "alnum" => b.is_ascii_alphanumeric(),
            "alpha" => b.is_ascii_alphabetic(),
            "blank" => b == 9 || b == 32,
            "cntrl" => b < 32 || b == 127,
            "digit" => b.is_ascii_digit(),
            "graph" => (33..=126).contains(&b),
            "lower" => b.is_ascii_lowercase(),
            "print" => (32..=126).contains(&b),
            "punct" => b.is_ascii_punctuation(),
            "space" => (9..=13).contains(&b) || b == 32,
            "upper" => b.is_ascii_uppercase(),
            "xdigit" => b.is_ascii_hexdigit(),
            _ => false,
        };
    }
    Some(values)
}
fn matches(tokens: &[Token], path: &[u8]) -> bool {
    let mut reachable = vec![false; path.len() + 1];
    reachable[0] = true;
    for token in tokens {
        let mut next = vec![false; path.len() + 1];
        match token {
            Token::Star => {
                let mut active = false;
                for p in 0..=path.len() {
                    active |= reachable[p];
                    next[p] = active;
                    if path.get(p) == Some(&47) {
                        active = false;
                    }
                }
            }
            Token::Glob => {
                if let Some(start) = reachable.iter().position(|b| *b) {
                    next[start..].fill(true);
                }
            }
            Token::GlobSlash => {
                next.clone_from(&reachable);
                if let Some(start) = reachable.iter().position(|b| *b) {
                    for p in start..path.len() {
                        if path[p] == 47 {
                            next[p + 1] = true;
                        }
                    }
                }
            }
            _ => {
                for p in 0..path.len() {
                    if reachable[p] {
                        next[p + 1] = match token {
                            Token::Literal(b) => path[p] == *b,
                            Token::Any => path[p] != 47,
                            Token::Members(values, negative) => {
                                path[p] != 47 && values[path[p] as usize] != *negative
                            }
                            _ => false,
                        };
                    }
                }
            }
        }
        reachable = next;
        if !reachable.iter().any(|b| *b) {
            return false;
        }
    }
    reachable[path.len()]
}
