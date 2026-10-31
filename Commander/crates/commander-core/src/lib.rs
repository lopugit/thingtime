//! Portable, deterministic search primitives for Thingtime Commander.
//!
//! The crate deliberately contains no platform APIs. macOS, Windows, and Linux
//! hosts can all send the same [`SearchRequest`] over the JSON-lines protocol
//! exposed by the `commander-search` binary.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;

const MAX_QUERY_CHARS: usize = 128;
const MAX_FIELD_CHARS: usize = 512;
const MAX_KEYWORDS_PER_ITEM: usize = 64;
/// Maximum catalog items accepted by the JSON-lines adapter in one request.
pub const MAX_ITEMS_PER_REQUEST: usize = 100_000;
/// Maximum IDs accepted in each list of an action filter.
pub const MAX_ACTION_FILTER_IDS: usize = 256;
const TITLE_WEIGHT: u64 = 100;
const SUBTITLE_WEIGHT: u64 = 50;
const KEYWORD_WEIGHT: u64 = 25;
const FAVOURITE_BONUS: u64 = 25;
const MAX_PREFERENCE_SCORE: u64 = 100_000;
const EXACT_MATCH_SCORE: u64 = 100_000;
// Keep complete app-name words close to exact titles. Category and learned
// preferences decide the small remaining gap; never boost path/typo matches.
// Keep in sync with the daemon's fallback search.
const APPLICATION_NAME_WORD_SCORE: u64 = 99_300;
const PREFIX_MATCH_SCORE: u64 = 80_000;
const CONTAINED_MATCH_SCORE: u64 = 60_000;

/// The kinds currently shared with Commander's TypeScript protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchItemKind {
    Builtin,
    System,
    Application,
    File,
    Directory,
    Extension,
    Command,
    Quicklink,
}

impl SearchItemKind {
    fn sort_rank(self) -> u8 {
        match self {
            Self::Builtin => 0,
            Self::System => 1,
            Self::Application => 2,
            Self::File => 3,
            Self::Directory => 4,
            Self::Extension => 5,
            Self::Command => 6,
            Self::Quicklink => 7,
        }
    }
}

/// An action exposed by a command search item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommanderAction {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub destructive: bool,
}

/// One searchable application, built-in command, extension command, or quicklink.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub kind: SearchItemKind,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default)]
    pub favourite: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub preference_score: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_name: Option<String>,
    #[serde(default)]
    pub actions: Vec<CommanderAction>,
}

/// Restricts results by exact action IDs before text ranking is performed.
///
/// Empty lists impose no constraint. `anyOf` requires at least one matching
/// action, `allOf` requires every listed action, and `noneOf` rejects an item
/// containing any listed action.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFilter {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub any_of: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub all_of: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub none_of: Vec<String>,
}

impl ActionFilter {
    /// Returns whether an item's action IDs satisfy this filter.
    pub fn matches(&self, item: &SearchItem) -> bool {
        let has_action = |wanted: &str| item.actions.iter().any(|action| action.id == wanted);

        (self.any_of.is_empty() || self.any_of.iter().any(|id| has_action(id)))
            && self.all_of.iter().all(|id| has_action(id))
            && self.none_of.iter().all(|id| !has_action(id))
    }
}

/// One request accepted by both the library and the JSON-lines binary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub items: Vec<SearchItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_filter: Option<ActionFilter>,
}

/// A half-open range in JavaScript UTF-16 code units within a hit's title.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRange {
    pub start: usize,
    pub end: usize,
}

/// A ranked item. The item is flattened to match Commander's TypeScript model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(flatten)]
    pub item: SearchItem,
    pub score: u64,
    #[serde(default)]
    pub matched_ranges: Vec<MatchRange>,
}

/// A successful JSON-lines response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
}

/// Machine-readable details for a rejected JSON-lines request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchError {
    pub code: String,
    pub message: String,
}

/// An unsuccessful JSON-lines response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchErrorResponse {
    pub error: SearchError,
}

impl SearchErrorResponse {
    /// Constructs the stable error envelope used for malformed input lines.
    pub fn invalid_request(line_number: usize, message: impl Into<String>) -> Self {
        Self::new("invalid_request", line_number, message)
    }

    /// Constructs the stable error envelope used when an input line is too large.
    pub fn request_too_large(line_number: usize, limit_bytes: usize) -> Self {
        Self::new(
            "request_too_large",
            line_number,
            format!("request exceeds the {limit_bytes}-byte limit"),
        )
    }

    fn new(code: &str, line_number: usize, message: impl Into<String>) -> Self {
        Self {
            error: SearchError {
                code: code.to_owned(),
                message: format!("line {line_number}: {}", message.into()),
            },
        }
    }
}

/// Searches, ranks, and limits a request's items.
///
/// Ranking uses integer arithmetic only, so identical inputs produce identical
/// output on macOS, Windows, and Linux. Ties are resolved by favourite status,
/// case-folded title, kind, ID, and finally original ordinal.
pub fn search(request: &SearchRequest) -> Vec<SearchHit> {
    if request.limit == Some(0) {
        return Vec::new();
    }

    let query = fold_query(&request.query);
    let filter = request.action_filter.as_ref();

    let mut ranked: Vec<RankedMatch<'_>> = request
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| match filter {
            Some(action_filter) => action_filter.matches(item),
            None => true,
        })
        .filter_map(|(ordinal, item)| rank_item(item, &query, ordinal))
        .collect();

    if let Some(limit) = request.limit {
        if limit < ranked.len() {
            ranked.select_nth_unstable_by(limit, compare_ranked_matches);
            ranked.truncate(limit);
        }
    }
    ranked.sort_by(compare_ranked_matches);

    ranked
        .into_iter()
        .map(RankedMatch::into_search_hit)
        .collect()
}

/// Validates request-level resource bounds used by the JSON-lines adapter.
pub fn validate_request(request: &SearchRequest) -> Result<(), String> {
    if request.items.len() > MAX_ITEMS_PER_REQUEST {
        return Err(format!(
            "items contains {} entries; at most {MAX_ITEMS_PER_REQUEST} are allowed",
            request.items.len()
        ));
    }

    if let Some(filter) = &request.action_filter {
        for (name, ids) in [
            ("actionFilter.anyOf", &filter.any_of),
            ("actionFilter.allOf", &filter.all_of),
            ("actionFilter.noneOf", &filter.none_of),
        ] {
            if ids.len() > MAX_ACTION_FILTER_IDS {
                return Err(format!(
                    "{name} contains {} entries; at most {MAX_ACTION_FILTER_IDS} are allowed",
                    ids.len()
                ));
            }
        }
    }

    Ok(())
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

#[derive(Debug)]
struct RankedMatch<'a> {
    item: &'a SearchItem,
    score: u64,
    matched_ranges: Vec<MatchRange>,
    folded_title: String,
    ordinal: usize,
}

impl<'a> RankedMatch<'a> {
    fn into_search_hit(self) -> SearchHit {
        SearchHit {
            item: self.item.clone(),
            score: self.score,
            matched_ranges: self.matched_ranges,
        }
    }
}

fn rank_item<'a>(item: &'a SearchItem, query: &[char], ordinal: usize) -> Option<RankedMatch<'a>> {
    if query.is_empty() {
        return Some(RankedMatch {
            item,
            score: favourite_bonus(item).saturating_add(preference_bonus(item)),
            matched_ranges: Vec::new(),
            folded_title: fold_sort_key(&item.title),
            ordinal,
        });
    }

    let title_match = match_text(query, &item.title);
    let mut best_score = title_match.as_ref().map(|text_match| {
        let score = if item.kind == SearchItemKind::Application
            && text_match.score < APPLICATION_NAME_WORD_SCORE
            && matches_application_name_words(query, &item.title)
        {
            APPLICATION_NAME_WORD_SCORE
        } else {
            text_match.score
        };
        weighted_score(score, TITLE_WEIGHT)
    });

    if let Some(subtitle_match) = item
        .subtitle
        .as_deref()
        .and_then(|subtitle| match_text(query, subtitle))
    {
        best_score = Some(
            best_score
                .unwrap_or_default()
                .max(weighted_score(subtitle_match.score, SUBTITLE_WEIGHT)),
        );
    }

    for keyword in item.keywords.iter().take(MAX_KEYWORDS_PER_ITEM) {
        if let Some(keyword_match) = match_text(query, keyword) {
            best_score = Some(
                best_score
                    .unwrap_or_default()
                    .max(weighted_score(keyword_match.score, KEYWORD_WEIGHT)),
            );
        }
    }

    let score = best_score?
        .saturating_add(favourite_bonus(item))
        .saturating_add(preference_bonus(item));
    let matched_ranges = title_match
        .map(|text_match| text_match.ranges)
        .unwrap_or_default();

    Some(RankedMatch {
        item,
        score,
        matched_ranges,
        folded_title: fold_sort_key(&item.title),
        ordinal,
    })
}

fn matches_application_name_words(query: &[char], title: &str) -> bool {
    let needle: Vec<char> = query
        .iter()
        .copied()
        .filter(|ch| ch.is_alphanumeric())
        .collect();
    if needle.len() < 3 {
        return false;
    }
    let name: Vec<FoldedGlyph> = fold_candidate(title)
        .into_iter()
        .filter(|glyph| glyph.value.is_alphanumeric())
        .collect();
    name.windows(needle.len())
        .enumerate()
        .any(|(start, window)| {
            window[0].boundary
                && name
                    .get(start + needle.len())
                    .map_or(true, |glyph| glyph.boundary)
                && window
                    .iter()
                    .map(|glyph| glyph.value)
                    .eq(needle.iter().copied())
        })
}

fn compare_ranked_matches(left: &RankedMatch<'_>, right: &RankedMatch<'_>) -> Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.item.favourite.cmp(&left.item.favourite))
        .then_with(|| left.folded_title.cmp(&right.folded_title))
        .then_with(|| left.item.kind.sort_rank().cmp(&right.item.kind.sort_rank()))
        .then_with(|| left.item.id.cmp(&right.item.id))
        .then_with(|| left.ordinal.cmp(&right.ordinal))
}

fn favourite_bonus(item: &SearchItem) -> u64 {
    if item.favourite {
        FAVOURITE_BONUS
    } else {
        0
    }
}

fn preference_bonus(item: &SearchItem) -> u64 {
    item.preference_score.min(MAX_PREFERENCE_SCORE)
}

fn weighted_score(score: u64, weight: u64) -> u64 {
    score.saturating_mul(weight) / 100
}

#[derive(Debug, Clone)]
struct FoldedGlyph {
    value: char,
    utf16_start: usize,
    utf16_len: usize,
    boundary: bool,
}

#[derive(Debug)]
struct TextMatch {
    score: u64,
    ranges: Vec<MatchRange>,
}

#[derive(Debug, Clone, Copy)]
struct Cell {
    score: i64,
    previous: Option<usize>,
    start: usize,
}

fn fold_query(query: &str) -> Vec<char> {
    query
        .trim()
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| !character.is_whitespace())
        .take(MAX_QUERY_CHARS)
        .collect()
}

fn fold_sort_key(value: &str) -> String {
    value
        .chars()
        .take(MAX_FIELD_CHARS)
        .flat_map(char::to_lowercase)
        .collect()
}

fn fold_candidate(value: &str) -> Vec<FoldedGlyph> {
    let mut glyphs = Vec::new();
    let mut previous_original: Option<char> = None;
    let mut utf16_start = 0;

    for original in value.chars().take(MAX_FIELD_CHARS) {
        let utf16_len = original.len_utf16();
        let boundary = match previous_original {
            None => true,
            Some(previous) => {
                (!previous.is_alphanumeric() && original.is_alphanumeric())
                    || (previous.is_lowercase() && original.is_uppercase())
            }
        };

        for (lowercase_index, lowercase) in original.to_lowercase().enumerate() {
            glyphs.push(FoldedGlyph {
                value: lowercase,
                utf16_start,
                utf16_len,
                boundary: boundary && lowercase_index == 0,
            });
        }

        utf16_start += utf16_len;
        previous_original = Some(original);
    }

    glyphs
}

fn match_text(query: &[char], candidate: &str) -> Option<TextMatch> {
    if query.is_empty() {
        return Some(TextMatch {
            score: 0,
            ranges: Vec::new(),
        });
    }

    let candidate = fold_candidate(candidate);
    if candidate.is_empty() {
        return None;
    }

    if query.len() > candidate.len() {
        return typo_match(query, &candidate);
    }
    if !contains_subsequence(query, &candidate) {
        return typo_match(query, &candidate);
    }

    let mut rows = vec![vec![None; candidate.len()]; query.len()];

    for (candidate_index, glyph) in candidate.iter().enumerate() {
        if glyph.value != query[0] {
            continue;
        }

        rows[0][candidate_index] = Some(Cell {
            score: initial_score(glyph, candidate_index),
            previous: None,
            start: candidate_index,
        });
    }

    for query_index in 1..query.len() {
        let (previous_rows, current_and_later_rows) = rows.split_at_mut(query_index);
        let previous_row = &previous_rows[query_index - 1];
        let current_row = &mut current_and_later_rows[0];
        let prefix_best = prefix_best_indices(previous_row);

        for candidate_index in 0..candidate.len() {
            if candidate[candidate_index].value != query[query_index] {
                continue;
            }

            let mut best: Option<Cell> = None;
            let nearby_start = candidate_index.saturating_sub(10);
            for (previous_index, previous) in previous_row
                .iter()
                .copied()
                .enumerate()
                .take(candidate_index)
                .skip(nearby_start)
            {
                let Some(previous) = previous else {
                    continue;
                };

                let gap = candidate_index - previous_index - 1;
                let proposed =
                    transition(previous, previous_index, gap, &candidate[candidate_index]);

                if cell_is_better(proposed, best) {
                    best = Some(proposed);
                }
            }

            // Gap penalties saturate at 100 after ten skipped glyphs. For all
            // earlier predecessors, only the best prefix cell can win.
            let far_previous = candidate_index
                .checked_sub(11)
                .and_then(|far_end| prefix_best[far_end])
                .and_then(|previous_index| {
                    previous_row[previous_index].map(|cell| (previous_index, cell))
                });
            if let Some((previous_index, previous)) = far_previous {
                let gap = candidate_index - previous_index - 1;
                let proposed =
                    transition(previous, previous_index, gap, &candidate[candidate_index]);
                if cell_is_better(proposed, best) {
                    best = Some(proposed);
                }
            }
            current_row[candidate_index] = best;
        }
    }

    let last_row = &rows[query.len() - 1];
    let mut best_end = None;
    for (candidate_index, cell) in last_row.iter().copied().enumerate() {
        let Some(cell) = cell else {
            continue;
        };

        match best_end {
            None => best_end = Some((candidate_index, cell)),
            Some((best_index, best))
                if cell.score > best.score
                    || (cell.score == best.score && cell.start < best.start)
                    || (cell.score == best.score
                        && cell.start == best.start
                        && candidate_index < best_index) =>
            {
                best_end = Some((candidate_index, cell));
            }
            Some(_) => {}
        }
    }

    let Some((candidate_index, final_cell)) = best_end else {
        return typo_match(query, &candidate);
    };
    let mut matched_indices = reconstruct_indices(&rows, candidate_index);
    let mut path_score = final_cell.score;

    // A lower-scoring partial path may become the best complete match after
    // the full-consecutive bonus is applied. Evaluate contiguous windows as a
    // separate terminal state instead of allowing the generic DP to discard
    // them prematurely.
    match best_contiguous_match(query, &candidate) {
        Some((contiguous_score, contiguous_indices))
            if path_is_better(
                contiguous_score,
                &contiguous_indices,
                path_score,
                &matched_indices,
            ) =>
        {
            path_score = contiguous_score;
            matched_indices = contiguous_indices;
        }
        _ => {}
    }

    let compact_query: Vec<char> = query
        .iter()
        .copied()
        .filter(|character| character.is_alphanumeric())
        .collect();
    let compact_query = if compact_query.is_empty() {
        query.to_vec()
    } else {
        compact_query
    };
    let compact_candidate: Vec<char> = candidate
        .iter()
        .filter(|glyph| glyph.value.is_alphanumeric())
        .map(|glyph| glyph.value)
        .collect();
    let coverage_bonus =
        (((compact_query.len() as u64) * 1_000) / compact_candidate.len().max(1) as u64).min(1_000);
    let contained_at = compact_candidate
        .windows(compact_query.len())
        .position(|candidate_window| candidate_window == compact_query);
    let score = if compact_candidate == compact_query {
        EXACT_MATCH_SCORE
    } else if compact_candidate.starts_with(&compact_query) {
        PREFIX_MATCH_SCORE.saturating_sub(compact_candidate.len() as u64)
    } else if let Some(index) = contained_at {
        CONTAINED_MATCH_SCORE.saturating_sub(index as u64)
    } else {
        path_score.max(1) as u64 + coverage_bonus
    };

    Some(TextMatch {
        score,
        ranges: ranges_for_indices(&candidate, &matched_indices),
    })
}

/// Returns the same deterministic fuzzy score used by Commander without
/// requiring callers to construct a complete [`SearchItem`]. The standalone
/// filesystem indexer uses this to keep file/folder typo handling aligned with
/// application, command, and extension search.
pub fn fuzzy_text_score(query: &str, candidate: &str) -> Option<u64> {
    match_text(&fold_query(query), candidate).map(|text_match| text_match.score)
}

fn contains_subsequence(query: &[char], candidate: &[FoldedGlyph]) -> bool {
    let mut query_index = 0;
    for glyph in candidate {
        if glyph.value == query[query_index] {
            query_index += 1;
            if query_index == query.len() {
                return true;
            }
        }
    }
    false
}

#[derive(Clone, Copy)]
struct EditCell {
    cost: usize,
    start: usize,
}

fn typo_match(query: &[char], candidate: &[FoldedGlyph]) -> Option<TextMatch> {
    let compact_query: Vec<char> = query
        .iter()
        .copied()
        .filter(|character| character.is_alphanumeric())
        .collect();
    let compact_query = if compact_query.is_empty() {
        query.to_vec()
    } else {
        compact_query
    };
    if compact_query.len() < 3 {
        return None;
    }
    let compact_candidate: Vec<(char, usize)> = candidate
        .iter()
        .enumerate()
        .filter(|(_, glyph)| glyph.value.is_alphanumeric())
        .map(|(index, glyph)| (glyph.value, index))
        .collect();
    if compact_candidate.is_empty() {
        return None;
    }
    let maximum_distance = maximum_typo_distance(compact_query.len());
    if character_overlap(&compact_query, &compact_candidate)
        < compact_query.len().saturating_sub(maximum_distance)
    {
        return None;
    }

    let mut previous_previous: Option<Vec<EditCell>> = None;
    let mut previous: Vec<EditCell> = (0..=compact_candidate.len())
        .map(|column| EditCell {
            cost: 0,
            start: column,
        })
        .collect();

    for row in 1..=compact_query.len() {
        let mut current = vec![
            EditCell {
                cost: row,
                start: 0
            };
            compact_candidate.len() + 1
        ];
        for column in 1..=compact_candidate.len() {
            let substitution_cost =
                usize::from(compact_query[row - 1] != compact_candidate[column - 1].0);
            let mut best = best_edit_cell(
                EditCell {
                    cost: previous[column].cost + 1,
                    start: previous[column].start,
                },
                EditCell {
                    cost: current[column - 1].cost + 1,
                    start: current[column - 1].start,
                },
                column,
            );
            best = best_edit_cell(
                best,
                EditCell {
                    cost: previous[column - 1].cost + substitution_cost,
                    start: previous[column - 1].start,
                },
                column,
            );
            if let Some(previous_previous) = &previous_previous {
                if row > 1
                    && column > 1
                    && compact_query[row - 1] == compact_candidate[column - 2].0
                    && compact_query[row - 2] == compact_candidate[column - 1].0
                {
                    best = best_edit_cell(
                        best,
                        EditCell {
                            cost: previous_previous[column - 2].cost + 1,
                            start: previous_previous[column - 2].start,
                        },
                        column,
                    );
                }
            }
            current[column] = best;
        }
        previous_previous = Some(previous);
        previous = current;
    }

    let (end, best) = previous.iter().copied().enumerate().skip(1).min_by(
        |(left_end, left), (right_end, right)| {
            left.cost
                .cmp(&right.cost)
                .then_with(|| {
                    edit_span_distance(*left_end, left.start, compact_query.len()).cmp(
                        &edit_span_distance(*right_end, right.start, compact_query.len()),
                    )
                })
                .then_with(|| left.start.cmp(&right.start))
        },
    )?;
    if best.cost > maximum_distance || best.start >= end {
        return None;
    }
    let start_glyph = compact_candidate[best.start].1;
    let end_glyph = compact_candidate[end - 1].1;
    let score = 8_000_u64
        .saturating_sub((best.cost as u64).saturating_mul(1_500))
        .saturating_sub((best.start as u64).saturating_mul(3));
    Some(TextMatch {
        score: score.max(1),
        ranges: ranges_for_indices(candidate, &(start_glyph..=end_glyph).collect::<Vec<_>>()),
    })
}

fn character_overlap(query: &[char], candidate: &[(char, usize)]) -> usize {
    let mut query_counts = HashMap::new();
    for character in query {
        *query_counts.entry(*character).or_insert(0_usize) += 1;
    }
    let mut candidate_counts = HashMap::new();
    for (character, _) in candidate {
        *candidate_counts.entry(*character).or_insert(0_usize) += 1;
    }
    query_counts
        .into_iter()
        .map(|(character, count)| count.min(candidate_counts.get(&character).copied().unwrap_or(0)))
        .sum()
}

fn best_edit_cell(left: EditCell, right: EditCell, _end: usize) -> EditCell {
    if right.cost < left.cost || (right.cost == left.cost && right.start > left.start) {
        right
    } else {
        left
    }
}

fn edit_span_distance(end: usize, start: usize, wanted: usize) -> usize {
    end.saturating_sub(start).abs_diff(wanted)
}

fn maximum_typo_distance(length: usize) -> usize {
    match length {
        0..=2 => 0,
        3..=5 => 1,
        6..=9 => 2,
        _ => 3,
    }
}

fn initial_score(glyph: &FoldedGlyph, candidate_index: usize) -> i64 {
    let boundary_bonus = if glyph.boundary { 80 + 180 } else { 0 };
    let beginning_bonus = if candidate_index == 0 { 120 } else { 0 };
    let position_penalty = ((candidate_index as i64) * 3).min(90);
    100 + boundary_bonus + beginning_bonus - position_penalty
}

fn reconstruct_indices(rows: &[Vec<Option<Cell>>], mut candidate_index: usize) -> Vec<usize> {
    let mut matched_indices = Vec::with_capacity(rows.len());
    for query_index in (0..rows.len()).rev() {
        matched_indices.push(candidate_index);
        if query_index > 0 {
            candidate_index = rows[query_index][candidate_index]
                .and_then(|cell| cell.previous)
                .expect("a terminal fuzzy match has a complete predecessor chain");
        }
    }
    matched_indices.reverse();
    matched_indices
}

fn best_contiguous_match(query: &[char], candidate: &[FoldedGlyph]) -> Option<(i64, Vec<usize>)> {
    let mut best: Option<(i64, Vec<usize>)> = None;

    for start in 0..=candidate.len().saturating_sub(query.len()) {
        if candidate[start..start + query.len()]
            .iter()
            .zip(query)
            .any(|(glyph, query_character)| glyph.value != *query_character)
        {
            continue;
        }

        let mut score = initial_score(&candidate[start], start);
        for (index, glyph) in candidate
            .iter()
            .enumerate()
            .skip(start + 1)
            .take(query.len() - 1)
        {
            score = transition(
                Cell {
                    score,
                    previous: Some(index - 1),
                    start,
                },
                index - 1,
                0,
                glyph,
            )
            .score;
        }
        score += 700;
        let indices: Vec<usize> = (start..start + query.len()).collect();

        match &best {
            None => best = Some((score, indices)),
            Some((best_score, best_indices))
                if path_is_better(score, &indices, *best_score, best_indices) =>
            {
                best = Some((score, indices));
            }
            Some(_) => {}
        }
    }

    best
}

fn path_is_better(
    proposed_score: i64,
    proposed_indices: &[usize],
    current_score: i64,
    current_indices: &[usize],
) -> bool {
    proposed_score > current_score
        || (proposed_score == current_score && proposed_indices < current_indices)
}

fn prefix_best_indices(row: &[Option<Cell>]) -> Vec<Option<usize>> {
    let mut result = Vec::with_capacity(row.len());
    let mut best_index: Option<usize> = None;

    for (index, cell) in row.iter().copied().enumerate() {
        if let Some(cell) = cell {
            let replace = match best_index {
                None => true,
                Some(current_index) => {
                    let current = row[current_index].expect("prefix index points to a cell");
                    cell.score > current.score
                        || (cell.score == current.score && cell.start < current.start)
                        || (cell.score == current.score
                            && cell.start == current.start
                            && index < current_index)
                }
            };
            if replace {
                best_index = Some(index);
            }
        }
        result.push(best_index);
    }

    result
}

fn transition(previous: Cell, previous_index: usize, gap: usize, candidate: &FoldedGlyph) -> Cell {
    let gap_penalty = ((gap as i64) * 10).min(100);
    let consecutive_bonus = if gap == 0 { 90 } else { 0 };
    let boundary_bonus = if candidate.boundary { 55 } else { 0 };
    Cell {
        score: previous.score + 100 + consecutive_bonus + boundary_bonus - gap_penalty,
        previous: Some(previous_index),
        start: previous.start,
    }
}

fn cell_is_better(proposed: Cell, current: Option<Cell>) -> bool {
    match current {
        None => true,
        Some(current) => {
            proposed.score > current.score
                || (proposed.score == current.score && proposed.start < current.start)
                || (proposed.score == current.score
                    && proposed.start == current.start
                    && proposed.previous < current.previous)
        }
    }
}

fn ranges_for_indices(candidate: &[FoldedGlyph], indices: &[usize]) -> Vec<MatchRange> {
    let mut ranges: Vec<MatchRange> = Vec::new();

    for index in indices {
        let glyph = &candidate[*index];
        let next = MatchRange {
            start: glyph.utf16_start,
            end: glyph.utf16_start + glyph.utf16_len,
        };

        match ranges.last_mut() {
            Some(previous) if next.start <= previous.end => {
                previous.end = previous.end.max(next.end);
            }
            _ => ranges.push(next),
        }
    }

    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, title: &str) -> SearchItem {
        SearchItem {
            id: id.to_owned(),
            title: title.to_owned(),
            subtitle: None,
            kind: SearchItemKind::Command,
            keywords: Vec::new(),
            icon: None,
            path: None,
            favourite: false,
            preference_score: 0,
            extension_id: None,
            command_name: None,
            actions: Vec::new(),
        }
    }

    fn request(query: &str, items: Vec<SearchItem>) -> SearchRequest {
        SearchRequest {
            query: query.to_owned(),
            items,
            limit: None,
            action_filter: None,
        }
    }

    #[test]
    fn exact_title_match_beats_other_fields() {
        let mut keyword_match = item("keyword", "Preferences");
        keyword_match.keywords = vec!["settings".to_owned()];
        let exact_title = item("title", "Settings");

        let hits = search(&request("settings", vec![keyword_match, exact_title]));

        assert_eq!(hits[0].item.id, "title");
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn complete_app_name_words_survive_the_file_result_limit() {
        for (query, title, filename) in [
            ("magician", "SamsungMagician", "Magician.png"),
            ("recovery", "Thingtime Recovery", "Recovery"),
        ] {
            let mut application = item("application", title);
            application.kind = SearchItemKind::Application;
            application.preference_score = 1_200;
            let mut items: Vec<SearchItem> = (0..40)
                .map(|index| {
                    let mut file = item(&format!("file:{index}"), filename);
                    file.kind = SearchItemKind::File;
                    file
                })
                .collect();
            items.push(application);
            let mut query_request = request(query, items);
            query_request.limit = Some(30);
            let hits = search(&query_request);
            assert_eq!(hits.len(), 30);
            assert_eq!(hits[0].item.id, "application", "{query}");
            assert_eq!(hits[0].score, APPLICATION_NAME_WORD_SCORE + 1_200);
            assert!(!hits[0].matched_ranges.is_empty());
        }
    }

    #[test]
    fn app_name_word_boost_requires_complete_words_not_substrings_or_typos() {
        for (query, title, expected) in [
            ("magician", "SamsungMagician", true),
            ("recovery", "Thingtime Recovery.app", true),
            ("recovery tools", "Thingtime Recovery-Tools", true),
            ("recoverytools", "Thingtime Recovery Tools", true),
            ("recovery", "🪄 Recovery Tools", true),
            ("café", "MonCafé", true),
            ("cover", "Thingtime Recovery", false),
            ("magic", "SamsungMagician", false),
            ("recvoery", "Thingtime Recovery", false),
            ("go", "Go Tools", false),
        ] {
            assert_eq!(
                matches_application_name_words(&fold_query(query), title),
                expected,
                "{query}: {title}"
            );
            let mut application = item("application", title);
            application.kind = SearchItemKind::Application;
            let hits = search(&request(query, vec![application]));
            assert_eq!(
                hits.first()
                    .map_or(false, |hit| hit.score >= APPLICATION_NAME_WORD_SCORE),
                expected,
                "{query}: {title}"
            );
        }
    }

    #[test]
    fn exact_app_names_files_and_user_preferences_still_win() {
        let mut application = item("application", "Thingtime Recovery");
        application.kind = SearchItemKind::Application;
        application.preference_score = 1_200;
        let mut exact_app = item("exact", "Recovery");
        exact_app.kind = SearchItemKind::Application;
        exact_app.preference_score = 1_200;
        let mut file = item("file", "recovery.c");
        file.kind = SearchItemKind::File;
        let mut folder = item("folder", "Recovery");
        folder.kind = SearchItemKind::Directory;
        folder.preference_score = 2_000;
        assert_eq!(
            search(&request("recovery", vec![application.clone(), exact_app]))[0]
                .item
                .id,
            "exact"
        );
        assert_eq!(
            search(&request("recovery.c", vec![application.clone(), file]))[0]
                .item
                .id,
            "file"
        );
        assert_eq!(
            search(&request("recovery", vec![application.clone(), folder]))[0]
                .item
                .id,
            "folder"
        );
        application.title = "Unrelated".to_owned();
        application.subtitle = Some("/Applications/Recovery/Unrelated.app".to_owned());
        application.keywords = vec!["recovery".to_owned()];
        assert!(
            search(&request("recovery", vec![application]))[0].score < APPLICATION_NAME_WORD_SCORE
        );
    }

    #[test]
    fn searches_subtitles_and_keywords() {
        let mut settings = item("settings", "Commander");
        settings.subtitle = Some("Application settings".to_owned());
        let mut clipboard = item("clipboard", "History");
        clipboard.keywords = vec!["clipboard".to_owned(), "paste".to_owned()];

        assert_eq!(
            search(&request("settings", vec![settings]))[0].item.id,
            "settings"
        );
        assert_eq!(
            search(&request("paste", vec![clipboard]))[0].item.id,
            "clipboard"
        );
    }

    #[test]
    fn subtitle_matches_are_weighted_above_keyword_matches() {
        let mut subtitle_match = item("subtitle", "First");
        subtitle_match.subtitle = Some("clipboard".to_owned());
        let mut keyword_match = item("keyword", "Second");
        keyword_match.keywords = vec!["clipboard".to_owned()];

        let hits = search(&request("clipboard", vec![keyword_match, subtitle_match]));

        assert_eq!(hits[0].item.id, "subtitle");
        assert!(hits[0].score > hits[1].score);
        assert!(hits[0].matched_ranges.is_empty());
    }

    #[test]
    fn title_phrase_match_beats_an_exact_keyword_match() {
        let title_match = item("title", "System Settings");
        let mut keyword_match = item("keyword", "Configure");
        keyword_match.keywords = vec!["settings".to_owned()];

        let hits = search(&request("settings", vec![keyword_match, title_match]));

        assert_eq!(hits[0].item.id, "title");
        assert_eq!(
            hits[0].matched_ranges,
            vec![MatchRange { start: 7, end: 15 }]
        );
    }

    #[test]
    fn title_prefix_beats_typo_files_and_a_contained_application_match() {
        let mut displays_settings = item("system", "Displays Settings");
        displays_settings.kind = SearchItemKind::System;
        displays_settings.preference_score = 600;

        let mut better_display = item("application", "BetterDisplay");
        better_display.kind = SearchItemKind::Application;
        better_display.preference_score = 1_200;

        let mut display_index = item("file", "_displayindex.py");
        display_index.kind = SearchItemKind::File;

        let mut display_directory = item("directory", "display");
        display_directory.kind = SearchItemKind::Directory;

        let hits = search(&request(
            "displays",
            vec![
                better_display,
                display_index,
                display_directory,
                displays_settings,
            ],
        ));

        assert_eq!(hits[0].item.id, "system");
        assert_eq!(hits[0].item.title, "Displays Settings");
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn separator_equivalent_exact_title_beats_typo_siblings() {
        let hits = search(&request(
            "raycast stop",
            vec![
                item("start", "raycast-start"),
                item("status", "raycast-status"),
                item("stop", "raycast-stop"),
            ],
        ));

        assert_eq!(hits[0].item.id, "stop");
        assert_eq!(hits[0].score, EXACT_MATCH_SCORE);
    }

    #[test]
    fn supports_non_contiguous_fuzzy_matches() {
        let hits = search(&request(
            "cmdr",
            vec![item("commander", "Commander Settings")],
        ));

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].item.id, "commander");
        assert!(hits[0].matched_ranges.len() > 1);
    }

    #[test]
    fn tolerates_substitutions_and_adjacent_transpositions() {
        let substitution = search(&request(
            "settngs",
            vec![item("settings", "Settings"), item("terminal", "Terminal")],
        ));
        assert_eq!(substitution[0].item.id, "settings");

        let transposition = search(&request("raycsat", vec![item("raycast", "Raycast Start")]));
        assert_eq!(transposition[0].item.id, "raycast");
        assert!(!transposition[0].matched_ranges.is_empty());
    }

    #[test]
    fn learned_preference_reorders_equivalent_results_for_queries_and_empty_search() {
        let baseline = item("baseline", "Open Notes");
        let mut preferred = item("preferred", "Open Notes");
        preferred.preference_score = 9_000;

        let matching = search(&request(
            "open notes",
            vec![baseline.clone(), preferred.clone()],
        ));
        assert_eq!(matching[0].item.id, "preferred");

        let empty = search(&request("", vec![baseline, preferred]));
        assert_eq!(empty[0].item.id, "preferred");
    }

    #[test]
    fn terminal_consecutive_bonus_preserves_the_best_contiguous_path() {
        let hits = search(&request("ab", vec![item("repeated", "aab")]));

        assert_eq!(
            hits[0].matched_ranges,
            vec![MatchRange { start: 1, end: 3 }]
        );
    }

    #[test]
    fn ignores_case_and_query_whitespace() {
        let hits = search(&request(
            "  cOm ManDer  ",
            vec![item("commander", "Commander")],
        ));

        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].matched_ranges,
            vec![MatchRange { start: 0, end: 9 }]
        );
    }

    #[test]
    fn excludes_items_without_a_text_match() {
        let hits = search(&request("settings", vec![item("other", "Clipboard")]));
        assert!(hits.is_empty());
    }

    #[test]
    fn title_ranges_are_half_open_and_coalesced() {
        let hits = search(&request("set", vec![item("settings", "Settings")]));
        assert_eq!(
            hits[0].matched_ranges,
            vec![MatchRange { start: 0, end: 3 }]
        );
    }

    #[test]
    fn title_ranges_use_javascript_utf16_offsets() {
        let hits = search(&request("set", vec![item("settings", "🪄 Settings")]));

        assert_eq!(
            hits[0].matched_ranges,
            vec![MatchRange { start: 3, end: 6 }]
        );
    }

    #[test]
    fn empty_query_orders_favourites_then_titles() {
        let mut favourite = item("favourite", "Zulu");
        favourite.favourite = true;

        let hits = search(&request(
            "   ",
            vec![item("beta", "Beta"), favourite, item("alpha", "Alpha")],
        ));

        let ids: Vec<&str> = hits.iter().map(|hit| hit.item.id.as_str()).collect();
        assert_eq!(ids, vec!["favourite", "alpha", "beta"]);
    }

    #[test]
    fn tie_breaking_does_not_depend_on_input_order() {
        let first = search(&request("op", vec![item("z", "Open"), item("a", "Open")]));
        let second = search(&request("op", vec![item("a", "Open"), item("z", "Open")]));

        let first_ids: Vec<&str> = first.iter().map(|hit| hit.item.id.as_str()).collect();
        let second_ids: Vec<&str> = second.iter().map(|hit| hit.item.id.as_str()).collect();
        assert_eq!(first_ids, vec!["a", "z"]);
        assert_eq!(first_ids, second_ids);
    }

    #[test]
    fn action_filter_applies_any_all_and_none_constraints() {
        let mut openable = item("openable", "Openable");
        openable.actions = vec![
            CommanderAction {
                id: "open".to_owned(),
                title: "Open".to_owned(),
                shortcut: None,
                destructive: false,
            },
            CommanderAction {
                id: "copy".to_owned(),
                title: "Copy".to_owned(),
                shortcut: None,
                destructive: false,
            },
        ];
        let mut removable = item("removable", "Removable");
        removable.actions = vec![CommanderAction {
            id: "delete".to_owned(),
            title: "Delete".to_owned(),
            shortcut: None,
            destructive: true,
        }];
        let request = SearchRequest {
            query: String::new(),
            items: vec![openable, removable],
            limit: None,
            action_filter: Some(ActionFilter {
                any_of: vec!["open".to_owned(), "delete".to_owned()],
                all_of: vec!["copy".to_owned()],
                none_of: vec!["delete".to_owned()],
            }),
        };

        let hits = search(&request);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].item.id, "openable");
    }

    #[test]
    fn limit_is_applied_after_ranking() {
        let mut requested = request(
            "set",
            vec![item("weak", "Some Extra Tool"), item("exact", "Set")],
        );
        requested.limit = Some(1);

        let hits = search(&requested);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].item.id, "exact");
    }

    #[test]
    fn zero_limit_returns_no_hits() {
        let mut requested = request("set", vec![item("set", "Set")]);
        requested.limit = Some(0);
        assert!(search(&requested).is_empty());
    }

    #[test]
    fn partial_selection_returns_the_same_top_results_as_a_full_sort() {
        let items = vec![
            item("f", "Some Extra Tool"),
            item("e", "Set Apart"),
            item("d", "Set"),
            item("c", "Settings"),
            item("b", "System Settings"),
            item("a", "Asset Tool"),
        ];
        let full = search(&request("set", items.clone()));
        let mut limited_request = request("set", items);
        limited_request.limit = Some(3);
        let limited = search(&limited_request);

        assert_eq!(limited, full.into_iter().take(3).collect::<Vec<_>>());
    }

    #[test]
    fn serde_contract_is_camel_case_and_flattens_hits() {
        let mut searchable = item("settings", "Settings");
        searchable.extension_id = Some("commander".to_owned());
        searchable.command_name = Some("open-settings".to_owned());
        let hit = search(&request("set", vec![searchable]))
            .into_iter()
            .next()
            .expect("hit");

        let value = serde_json::to_value(hit).expect("serialize hit");
        assert_eq!(value["id"], "settings");
        assert_eq!(value["extensionId"], "commander");
        assert_eq!(value["commandName"], "open-settings");
        assert_eq!(value["keywords"], serde_json::json!([]));
        assert_eq!(value["favourite"], false);
        assert_eq!(value["actions"], serde_json::json!([]));
        assert!(value.get("item").is_none());
        assert!(value.get("matchedRanges").is_some());
    }

    #[test]
    fn request_deserializes_protocol_defaults() {
        let request: SearchRequest = serde_json::from_str(
            r#"{"query":"set","items":[{"id":"settings","title":"Settings","kind":"builtin"}]}"#,
        )
        .expect("deserialize request");

        assert_eq!(request.items[0].kind, SearchItemKind::Builtin);
        assert!(request.items[0].keywords.is_empty());
        assert!(request.items[0].actions.is_empty());
        assert!(!request.items[0].favourite);
    }

    #[test]
    fn action_filter_deserializes_from_camel_case() {
        let request: SearchRequest = serde_json::from_str(
            r#"{
                "query":"",
                "items":[{
                    "id":"settings",
                    "title":"Settings",
                    "kind":"builtin",
                    "actions":[{"id":"open","title":"Open"}]
                }],
                "actionFilter":{"anyOf":["open"],"noneOf":["delete"]}
            }"#,
        )
        .expect("deserialize action filter");

        assert_eq!(search(&request).len(), 1);
    }

    #[test]
    fn every_item_kind_matches_the_typescript_wire_values() {
        let cases = [
            (SearchItemKind::Builtin, "builtin"),
            (SearchItemKind::System, "system"),
            (SearchItemKind::Application, "application"),
            (SearchItemKind::File, "file"),
            (SearchItemKind::Directory, "directory"),
            (SearchItemKind::Extension, "extension"),
            (SearchItemKind::Command, "command"),
            (SearchItemKind::Quicklink, "quicklink"),
        ];

        for (kind, expected) in cases {
            assert_eq!(
                serde_json::to_value(kind).expect("serialize kind"),
                expected
            );
        }
    }

    #[test]
    fn validates_catalog_and_action_filter_resource_bounds() {
        let mut oversized_catalog = request("", Vec::new());
        oversized_catalog.items = (0..=MAX_ITEMS_PER_REQUEST)
            .map(|index| item(&index.to_string(), "Item"))
            .collect();
        assert!(validate_request(&oversized_catalog).is_err());

        let mut oversized_filter = request("", vec![item("settings", "Settings")]);
        oversized_filter.action_filter = Some(ActionFilter {
            any_of: (0..=MAX_ACTION_FILTER_IDS)
                .map(|index| index.to_string())
                .collect(),
            all_of: Vec::new(),
            none_of: Vec::new(),
        });
        assert!(validate_request(&oversized_filter).is_err());
    }
}
