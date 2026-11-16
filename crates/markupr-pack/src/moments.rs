use markupr_core::round_t;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Word {
    pub t0: f64,
    pub t1: f64,
    pub w: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Utterance {
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    pub words: Vec<Word>,
}
#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub file: String,
    pub line: usize,
    pub t: f64,
    pub text: String,
    #[serde(skip)]
    pub error: bool,
    pub replayed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_t: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Moment {
    pub t: f64,
    pub kind: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    pub file: String,
    pub zoom: Option<String>,
    pub t: f64,
    pub frame_t: f64,
    pub note: Option<String>,
    pub mark: Option<u64>,
    pub mark_note: Option<String>,
    pub said: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Item {
    pub id: usize,
    pub t0: f64,
    pub t1: f64,
    pub anchor_t: f64,
    pub reasons: Vec<String>,
    pub title: String,
    pub said: String,
    pub looking_at: Value,
    pub frames: Vec<Frame>,
    pub logs: Vec<LogLine>,
    pub dive: Value,
    #[serde(skip)]
    pub clicks: Vec<Value>,
    #[serde(skip)]
    anchors: Vec<(u8, f64)>,
    #[serde(skip)]
    pub marks: Vec<Value>,
    #[serde(skip)]
    pub words: Vec<Word>,
    #[serde(skip)]
    errors: Vec<LogLine>,
    #[serde(skip)]
    scored_errors: Vec<LogLine>,
}
#[derive(Debug, Serialize)]
pub struct OtherSaid {
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    pub clicks: Vec<Value>,
}
#[derive(Debug, Serialize)]
pub struct Moments {
    pub moments: Vec<Moment>,
    pub items: Vec<Item>,
    pub other_errors: Vec<LogLine>,
    pub other_said: Vec<OtherSaid>,
}

pub fn t(v: &Value) -> f64 {
    v["t"].as_f64().unwrap_or(0.0)
}
pub fn kind(v: &Value) -> &str {
    v["type"].as_str().unwrap_or("")
}
#[cfg(test)]
pub fn utterances(mut words: Vec<Word>) -> Vec<Utterance> {
    words.sort_by(|a, b| a.t0.total_cmp(&b.t0));
    let mut result: Vec<Utterance> = Vec::new();
    for word in words {
        if result
            .last()
            .is_none_or(|u| round_t(word.t0 - u.t1) >= 0.7 || round_t(word.t0 - u.t0) >= 12.0)
        {
            result.push(Utterance {
                t0: word.t0,
                t1: word.t1,
                text: String::new(),
                words: vec![],
            });
        }
        let u = result.last_mut().unwrap();
        u.t1 = u.t1.max(word.t1);
        if !u.text.is_empty() {
            u.text.push(' ');
        }
        u.text.push_str(&word.w);
        u.words.push(word);
    }
    result
}
fn normalized(s: &str) -> String {
    s.replace('’', "'")
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'')
        .to_lowercase()
}
fn pointing(u: &Utterance) -> (Vec<(f64, String)>, Option<f64>) {
    let words: Vec<String> = u.words.iter().map(|w| normalized(&w.w)).collect();
    let mut strong = vec![];
    let phrases = [
        "that's wrong",
        "this is wrong",
        "look at this",
        "right here",
        "doesn't work",
        "should be",
        "over here",
        "not working",
        "nothing happens",
        "fix this",
        "needs to be",
        "broken",
    ];
    let mut i = 0;
    while i < words.len() {
        let matched = phrases
            .iter()
            .filter_map(|phrase| {
                let parts: Vec<_> = phrase.split_whitespace().collect();
                (words[i..]
                    .iter()
                    .take(parts.len())
                    .map(String::as_str)
                    .eq(parts.iter().copied()))
                .then_some((*phrase, parts.len()))
            })
            .max_by_key(|(_, len)| *len);
        if let Some((phrase, len)) = matched {
            strong.push((u.words[i].t0, phrase.to_owned()));
            i += len;
        } else {
            i += 1;
        }
    }
    strong.sort_by(|a, b| a.0.total_cmp(&b.0));
    let weak = words
        .iter()
        .position(|w| {
            [
                "this",
                "here",
                "that",
                "wrong",
                "should",
                "shouldn't",
                "bug",
                "weird",
            ]
            .contains(&w.as_str())
        })
        .map(|i| u.words[i].t0);
    (strong, weak)
}
fn mark_reason(mark: &Value, fallback: u64) -> String {
    let mut reason = format!(
        "mark {} at {:.3}",
        mark["n"].as_u64().unwrap_or(fallback),
        t(mark)
    );
    if let Some(note) = mark["note"].as_str().filter(|note| !note.is_empty()) {
        reason.push_str(&format!(" note {note:?}"));
    }
    reason
}

fn distance(t: f64, u: &Utterance) -> f64 {
    (u.t0 - t).max(t - u.t1).max(0.0)
}
fn title(s: &str) -> String {
    let end = s
        .char_indices()
        .find(|(i, c)| {
            ['.', '!', '?'].contains(c)
                && s[i + c.len_utf8()..]
                    .chars()
                    .next()
                    .is_none_or(char::is_whitespace)
        })
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    s[..end].trim().to_owned()
}
fn new_item(t0: f64, t1: f64, said: String) -> Item {
    Item {
        id: 0,
        t0,
        t1,
        anchor_t: round_t((t0 + t1) / 2.0),
        reasons: vec![],
        title: title(&said),
        said,
        looking_at: json!({}),
        frames: vec![],
        logs: vec![],
        dive: json!({}),
        clicks: vec![],
        anchors: vec![],
        marks: vec![],
        words: vec![],
        errors: vec![],
        scored_errors: vec![],
    }
}

pub fn detect(utterances: &[Utterance], events: &[Value], logs: &[LogLine]) -> Moments {
    let marks: Vec<&Value> = events.iter().filter(|v| kind(v) == "mark").collect();
    let mut moments = vec![];
    // Ownership comes first: an earlier duplicate must not hide a later
    // occurrence which is close enough to attach to speech.
    let mut errors: Vec<&LogLine> = logs
        .iter()
        .filter(|l| l.file == "logs/browser.jsonl" && l.error && !l.replayed)
        .collect();
    errors.sort_by(|a, b| a.t.total_cmp(&b.t));
    let mut attached: Vec<Vec<&LogLine>> = vec![vec![]; utterances.len()];
    let mut other_errors: Vec<_> = logs
        .iter()
        .filter(|l| l.file == "logs/browser.jsonl" && l.replayed)
        .cloned()
        .collect();
    let mut scoring: Vec<Vec<&LogLine>> = vec![vec![]; utterances.len()];
    let mut scored_texts = std::collections::HashSet::new();
    for error in errors {
        let owner = utterances
            .iter()
            .position(|u| u.t0 <= error.t && error.t <= u.t1)
            .or_else(|| {
                utterances
                    .iter()
                    .enumerate()
                    .filter(|(_, u)| u.t0 > error.t && round_t(u.t0 - error.t) <= 8.0)
                    .min_by(|a, b| a.1.t0.total_cmp(&b.1.t0))
                    .map(|(i, _)| i)
            })
            .or_else(|| {
                utterances
                    .iter()
                    .enumerate()
                    .filter(|(_, u)| u.t1 < error.t && round_t(error.t - u.t1) <= 3.0)
                    .max_by(|a, b| a.1.t1.total_cmp(&b.1.t1))
                    .map(|(i, _)| i)
            });
        match owner {
            Some(i) => {
                attached[i].push(error);
                if scored_texts.insert(error.text.clone()) {
                    scoring[i].push(error);
                }
            }
            None => other_errors.push(error.clone()),
        }
    }
    let mark_owners: Vec<_> = marks
        .iter()
        .map(|mark| {
            utterances
                .iter()
                .enumerate()
                .min_by(|a, b| distance(t(mark), a.1).total_cmp(&distance(t(mark), b.1)))
                .filter(|(_, u)| round_t(distance(t(mark), u)) <= 3.0)
                .map(|(i, _)| i)
        })
        .collect();
    let mut candidates = vec![];
    let mut other_said = vec![];
    for (i, u) in utterances.iter().enumerate() {
        let mut item = new_item(u.t0, u.t1, u.text.clone());
        item.words = u.words.clone();
        item.errors = attached[i].iter().map(|l| (*l).clone()).collect();
        item.scored_errors = scoring[i].iter().map(|l| (*l).clone()).collect();
        let mut score = 0;
        for (m, mark) in marks.iter().enumerate() {
            if mark_owners[m] == Some(i) {
                item.reasons.push(mark_reason(mark, m as u64 + 1));
                item.anchors.push((0, t(mark)));
                item.marks.push((*mark).clone());
            }
        }
        if !item.anchors.is_empty() {
            score += 5;
        }
        for error in &scoring[i] {
            item.anchors.push((4, error.t));
        }
        if !scoring[i].is_empty() {
            score += 3;
        }
        item.clicks = events
            .iter()
            .filter(|v| kind(v) == "mouse_down" && t(v) >= u.t0 && t(v) <= u.t1)
            .cloned()
            .collect();
        for click in &item.clicks {
            item.reasons.push(format!("click at {:.3}", t(click)));
            item.anchors.push((2, t(click)));
            moments.push(Moment {
                t: t(click),
                kind: "click_speech".into(),
                detail: "click during speech".into(),
            });
        }
        if !item.clicks.is_empty() {
            score += 1;
        }
        let (strong, weak) = pointing(u);
        for (time, phrase) in &strong {
            item.reasons
                .push(format!("pointing words {phrase:?} at {time:.3}"));
            item.anchors.push((1, *time));
            moments.push(Moment {
                t: *time,
                kind: "pointing".into(),
                detail: phrase.clone(),
            });
        }
        if !strong.is_empty() {
            score += 2;
        }
        if let Some(time) = weak {
            score += 1;
            item.anchors.push((3, time));
            item.reasons.push(format!("pointing word at {time:.3}"));
            moments.push(Moment {
                t: time,
                kind: "pointing".into(),
                detail: "this / here / that".into(),
            });
        }
        if score >= 2 {
            candidates.push(item);
        } else {
            other_errors.extend(attached[i].iter().map(|error| (*error).clone()));
            other_said.push(OtherSaid {
                t0: u.t0,
                t1: u.t1,
                text: u.text.clone(),
                clicks: item.clicks,
            });
        }
    }
    for (i, mark) in marks.iter().enumerate() {
        let detail = mark_reason(mark, i as u64 + 1);
        moments.push(Moment {
            t: t(mark),
            kind: "mark".into(),
            detail: detail.clone(),
        });
        if mark_owners[i].is_none() {
            let mut item = new_item(t(mark), t(mark), String::new());
            item.title = mark["note"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Marked moment (no speech captured)")
                .into();
            item.reasons.push(detail);
            item.anchors.push((0, t(mark)));
            item.marks.push((*mark).clone());
            candidates.push(item);
        }
    }
    candidates.sort_by(|a, b| a.t0.total_cmp(&b.t0));
    let mut items: Vec<Item> = vec![];
    for mut next in candidates {
        // Only utterances merge. A standalone mark stays useful even without narration.
        if let Some(prev) = items.last_mut().filter(|p| {
            !p.said.is_empty()
                && !next.said.is_empty()
                && (p.marks.is_empty() || next.marks.is_empty())
                && round_t(next.t0 - p.t1) < 2.0
        }) {
            prev.t1 = prev.t1.max(next.t1);
            prev.said.push(' ');
            prev.said.push_str(&next.said);
            prev.reasons.append(&mut next.reasons);
            prev.anchors.append(&mut next.anchors);
            prev.clicks.append(&mut next.clicks);
            prev.marks.append(&mut next.marks);
            prev.words.append(&mut next.words);
            prev.errors.append(&mut next.errors);
            prev.scored_errors.append(&mut next.scored_errors);
        } else {
            items.push(next);
        }
    }
    for (i, item) in items.iter_mut().enumerate() {
        item.id = i + 1;
        item.anchors
            .sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
        if let Some((_, time)) = item.anchors.first() {
            item.anchor_t = *time;
        }
        // Nearby marks can be just outside the spoken span; keep the dive range truthful.
        item.t0 = item.t0.min(item.anchor_t);
        item.t1 = item.t1.max(item.anchor_t);
        item.marks.sort_by(|a, b| t(a).total_cmp(&t(b)));
        if let Some(mark) = item.marks.last() {
            item.t1 = item.t1.max(t(mark));
        }
        item.scored_errors = dedupe_logs(&item.scored_errors);
        for error in &item.scored_errors {
            item.reasons
                .push(format!("error at {}: {}", time_label(error.t), error.text));
        }
        let mut seen = std::collections::HashSet::new();
        item.reasons.retain(|reason| seen.insert(reason.clone()));
    }
    assign_logs(&mut items, logs);
    for item in &mut items {
        if item.said.is_empty()
            && !item
                .marks
                .iter()
                .any(|m| m["note"].as_str().is_some_and(|note| !note.is_empty()))
        {
            if let Some(error) = item
                .logs
                .iter()
                .find(|l| l.file == "logs/browser.jsonl" && l.error)
            {
                item.title = error.text.clone();
            }
        }
    }
    other_errors.retain(|log| {
        !items
            .iter()
            .flat_map(|i| &i.logs)
            .any(|cited| cited.file == log.file && cited.line == log.line)
    });
    other_errors.sort_by(|a, b| a.t.total_cmp(&b.t));
    other_errors = dedupe_logs(&other_errors);
    other_said.sort_by(|a, b| a.t0.total_cmp(&b.t0));
    let mut errors: Vec<_> = logs
        .iter()
        .filter(|l| l.file == "logs/browser.jsonl" && l.error && !l.replayed)
        .cloned()
        .collect();
    errors.sort_by(|a, b| a.t.total_cmp(&b.t));
    for error in dedupe_logs(&errors) {
        moments.push(Moment {
            t: error.t,
            kind: "error".into(),
            detail: error.text.clone(),
        });
    }
    moments.sort_by(|a, b| a.t.total_cmp(&b.t));
    Moments {
        moments,
        items,
        other_errors,
        other_said,
    }
}

/// Keep the preferred line in each five-second group, after its destination is known.
fn dedupe_logs(logs: &[LogLine]) -> Vec<LogLine> {
    let mut retained: Vec<LogLine> = vec![];
    for log in logs {
        if !retained
            .iter()
            .rev()
            .any(|p| p.text == log.text && round_t((log.t - p.t).abs()) <= 5.0)
        {
            retained.push(log.clone());
        }
    }
    retained
}

pub fn time_label(time: f64) -> String {
    if time < 0.0 {
        format!("before the recording started ({:.3} s earlier)", -time)
    } else {
        format!("{time:.3}")
    }
}

fn assign_logs(items: &mut [Item], logs: &[LogLine]) {
    for log in logs {
        if log.replayed {
            continue;
        }
        let attached = items.iter().position(|item| {
            item.errors
                .iter()
                .any(|owned| owned.file == log.file && owned.line == log.line)
        });
        let owner = attached.or_else(|| {
            items
                .iter()
                .enumerate()
                .filter(|(_, i)| log.t >= i.t0 - 15.0 && log.t <= i.t1 + 5.0)
                .min_by(|a, b| {
                    (a.1.anchor_t - log.t)
                        .abs()
                        .total_cmp(&(b.1.anchor_t - log.t).abs())
                })
                .map(|(i, _)| i)
        });
        if let Some(i) = owner {
            items[i].logs.push(log.clone());
        }
    }
    for item in items {
        item.logs.sort_by(|a, b| {
            let owned = |log: &LogLine| {
                item.errors
                    .iter()
                    .any(|e| e.file == log.file && e.line == log.line)
            };
            (a.file == "logs/system.jsonl")
                .cmp(&(b.file == "logs/system.jsonl"))
                .then_with(|| owned(b).cmp(&owned(a)))
                .then_with(|| {
                    (a.t - item.anchor_t)
                        .abs()
                        .total_cmp(&(b.t - item.anchor_t).abs())
                })
        });
        let mut browser = 0;
        let mut system_messages = std::collections::HashSet::new();
        item.logs.retain(|log| {
            if log.file == "logs/system.jsonl" {
                system_messages.len() < 2 && system_messages.insert(log.text.clone())
            } else {
                browser += 1;
                browser <= 8
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn speech(t0: f64, text: &str) -> Utterance {
        let words: Vec<_> = text
            .split_whitespace()
            .enumerate()
            .map(|(i, w)| Word {
                t0: t0 + i as f64 * 0.2,
                t1: t0 + i as f64 * 0.2 + 0.18,
                w: w.into(),
            })
            .collect();
        utterances(words).remove(0)
    }
    fn error(t: f64) -> LogLine {
        LogLine {
            file: "logs/browser.jsonl".into(),
            line: (t * 10.0) as usize,
            t,
            text: "exception: broken cart".into(),
            error: true,
            replayed: false,
            observed_t: None,
        }
    }
    #[test]
    fn error_two_seconds_before_a_spoken_mark_is_not_lost_or_split() {
        let result = detect(
            &[speech(10.0, "this button is broken")],
            &[json!({"type":"mark","t":10.5,"n":1})],
            &[error(8.5)],
        );
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].anchor_t, 10.5);
        assert!(result.items[0]
            .reasons
            .iter()
            .any(|s| s.starts_with("error")));
        assert!(result.other_errors.is_empty());
    }
    #[test]
    fn ordinary_talk_ten_seconds_after_an_error_does_not_become_an_item() {
        let result = detect(
            &[speech(20.0, "now I am going for coffee")],
            &[],
            &[error(10.0)],
        );
        assert!(result.items.is_empty());
        assert_eq!(result.other_errors.len(), 1);
    }
    #[test]
    fn overlapping_item_windows_do_not_cite_one_log_line_twice() {
        let result = detect(
            &[speech(10.0, "look at this"), speech(15.0, "that is broken")],
            &[],
            &[error(13.5)],
        );
        assert_eq!(result.items.len(), 2);
        assert_eq!(result.items.iter().map(|i| i.logs.len()).sum::<usize>(), 1);
        assert_eq!(result.items[1].logs.len(), 1);
        assert_eq!(
            result
                .items
                .iter()
                .flat_map(|i| &i.reasons)
                .filter(|s| s.starts_with("error"))
                .count(),
            1
        );
    }
    #[test]
    fn mark_without_speech_is_not_dropped() {
        let result = detect(&[], &[json!({"type":"mark","t":4.2,"n":1})], &[]);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].anchor_t, 4.2);
    }
    #[test]
    fn ordinary_talk_two_and_a_half_seconds_after_a_mark_is_not_a_spurious_item() {
        let result = detect(
            &[speech(10.0, "chosen"), speech(12.6, "coffee")],
            &[json!({"type":"mark","t":10.1,"n":1})],
            &[],
        );
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].said, "chosen");
        let nearest = detect(
            &[speech(8.0, "earlier"), speech(11.0, "nearer")],
            &[json!({"type":"mark","t":10.0,"n":1})],
            &[],
        );
        assert_eq!(nearest.items.len(), 1);
        assert_eq!(nearest.items[0].said, "nearer");
    }
    #[test]
    fn pauses_and_twelve_second_spans_do_not_become_one_utterance() {
        let paused = vec![
            Word {
                t0: 1.0,
                t1: 1.6,
                w: "hello".into(),
            },
            Word {
                t0: 2.3,
                t1: 2.5,
                w: "again".into(),
            },
        ];
        assert_eq!(utterances(paused).len(), 2);
        let continuous = (0..26)
            .map(|i| Word {
                t0: i as f64 * 0.5,
                t1: i as f64 * 0.5 + 0.4,
                w: "word".into(),
            })
            .collect();
        let result = utterances(continuous);
        assert_eq!(result.len(), 2);
        assert_eq!(result[1].t0, 12.0);
    }
    #[test]
    fn earlier_duplicate_does_not_hide_the_error_within_eight_seconds_of_speech() {
        let result = detect(
            &[speech(10.0, "this here that")],
            &[],
            &[error(1.0), error(3.0)],
        );
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].anchor_t, 10.0); // weak word still beats the error
        assert_eq!(
            result.items[0]
                .reasons
                .iter()
                .filter(|r| r.starts_with("error at"))
                .count(),
            1
        );
        assert!(result.items[0]
            .reasons
            .iter()
            .any(|r| r.starts_with("error at 3.000")));
        assert_eq!(result.items[0].logs.len(), 2);
        assert_eq!(result.items[0].logs[0].t, 3.0);
        assert!(result.other_errors.is_empty());
    }
    #[test]
    fn unnarrated_error_cited_under_a_mark_is_not_repeated_in_other_errors() {
        let result = detect(&[], &[json!({"type":"mark","t":10.0,"n":1})], &[error(8.0)]);
        assert_eq!(result.items[0].logs.len(), 1);
        assert!(result.other_errors.is_empty());
    }
    #[test]
    fn error_only_speech_anchors_at_its_attached_error_instead_of_its_midpoint() {
        let narration = speech(10.0, "ordinary narration about coffee");
        let result = detect(&[narration], &[], &[error(3.0)]);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].anchor_t, 3.0);
        let strong = detect(&[speech(10.0, "broken")], &[], &[error(3.0)]);
        assert_eq!(strong.items[0].anchor_t, 10.0);
    }
    #[test]
    fn an_ordinary_click_needs_a_weak_word_to_create_an_issue() {
        let result = detect(
            &[speech(10.0, "opening settings")],
            &[json!({"t":10.1,"type":"mouse_down","el":{"title":"Settings"}})],
            &[],
        );
        assert!(result.items.is_empty());
        assert_eq!(result.other_said.len(), 1);
        assert_eq!(result.other_said[0].clicks.len(), 1);
        let weak = detect(
            &[speech(10.0, "this opens")],
            &[json!({"t":10.1,"type":"mouse_down"})],
            &[],
        );
        assert_eq!(weak.items.len(), 1); // One click point plus one weak-word point.
    }
    #[test]
    fn two_deliberately_marked_utterances_do_not_merge_into_one_issue() {
        let result = detect(
            &[speech(10.0, "chosen"), speech(11.0, "another")],
            &[
                json!({"t":10.1,"type":"mark","n":1}),
                json!({"t":11.1,"type":"mark","n":2}),
            ],
            &[],
        );
        assert_eq!(result.items.len(), 2);
        assert_eq!(result.items[0].marks.len(), 1);
        assert_eq!(result.items[1].marks.len(), 1);
    }
    #[test]
    fn replayed_errors_near_speech_do_not_score_anchor_or_attach_to_an_item() {
        let mut replay = error(7.0);
        replay.replayed = true;
        let ordinary = detect(&[speech(10.0, "opening settings")], &[], &[replay.clone()]);
        assert!(ordinary.items.is_empty());
        assert_eq!(ordinary.other_errors.len(), 1);
        let marked = detect(
            &[speech(10.0, "opening settings")],
            &[json!({"t":10.1,"type":"mark","n":1})],
            &[replay],
        );
        assert!(marked.items[0].logs.is_empty());
        assert_eq!(marked.other_errors.len(), 1);
        assert!(!marked.moments.iter().any(|m| m.kind == "error"));
    }
    #[test]
    fn a_repeated_error_stays_in_logs_without_scoring_another_utterance() {
        let result = detect(
            &[
                speech(10.0, "opening settings"),
                speech(13.0, "continuing navigation"),
            ],
            &[],
            &[error(10.1), error(13.1)],
        );
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.other_said.len(), 1);
        assert_eq!(result.items[0].logs.len(), 2);
        assert_eq!(result.items[0].logs[1].t, 13.1);
        assert_eq!(
            result.items[0]
                .reasons
                .iter()
                .filter(|r| r.starts_with("error"))
                .count(),
            1
        );
    }
    #[test]
    fn an_error_owned_by_speech_is_not_stolen_by_a_nearer_mark() {
        let long = speech(10.0, &vec!["ordinary"; 30].join(" "));
        let result = detect(
            &[long, speech(18.0, "broken")],
            &[
                json!({"t":10.1,"type":"mark","n":1}),
                json!({"t":18.1,"type":"mark","n":2}),
            ],
            &[error(15.8)],
        );
        assert_eq!(result.items.len(), 2);
        assert_eq!(result.items[0].logs.len(), 1);
        assert!(result.items[1].logs.is_empty());
    }
    #[test]
    fn ordinary_introductory_talk_about_whats_wrong_needs_a_click_to_be_an_item() {
        let spoken = speech(
            10.0,
            "Okay, I'm testing this test page. Let me walk through what's wrong.",
        );
        let alone = detect(std::slice::from_ref(&spoken), &[], &[]);
        assert!(alone.items.is_empty());
        let clicked = detect(&[spoken], &[json!({"t":10.2,"type":"mouse_down"})], &[]);
        assert_eq!(clicked.items.len(), 1);
        let explicit = pointing(&speech(10.0, "this is wrong and needs to be fixed"));
        assert_eq!(
            explicit
                .0
                .iter()
                .map(|(_, phrase)| phrase.as_str())
                .collect::<Vec<_>>(),
            vec!["this is wrong", "needs to be"]
        );
    }
    #[test]
    fn a_mark_note_survives_in_reasons_and_is_not_replaced_by_a_nearby_error_title() {
        let result = detect(
            &[],
            &[json!({"t":10.0,"type":"mark","n":1,"note":"Fix the totals"})],
            &[error(10.1)],
        );
        assert_eq!(result.items[0].title, "Fix the totals");
        assert!(result.items[0].reasons[0].contains("Fix the totals"));
    }
    #[test]
    fn an_error_attached_to_unflagged_speech_is_not_lost_from_other_errors() {
        let result = detect(
            &[
                speech(10.0, "Opening preferences"),
                speech(20.0, "Opening another panel"),
            ],
            &[],
            &[error(10.1), error(20.1)],
        );
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.other_said.len(), 1);
        assert_eq!(result.other_errors.len(), 1);
        assert_eq!(result.other_errors[0].t, 20.1);
    }
}
