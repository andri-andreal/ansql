use std::collections::{HashMap, HashSet};

/// Returns table names ordered so that referenced tables come before referencing
/// tables. `deps[t]` lists the tables `t` references. On a cycle, falls back to
/// the input order and reports a warning.
pub fn order_by_dependencies(
    tables: &[String],
    deps: &HashMap<String, Vec<String>>,
) -> (Vec<String>, Vec<String>) {
    let selected: HashSet<&String> = tables.iter().collect();
    let mut visited: HashSet<String> = HashSet::new();
    let mut in_progress: HashSet<String> = HashSet::new();
    let mut ordered: Vec<String> = Vec::new();
    let mut cycle_detected = false;

    fn visit(
        node: &str,
        selected: &HashSet<&String>,
        deps: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        in_progress: &mut HashSet<String>,
        ordered: &mut Vec<String>,
        cycle_detected: &mut bool,
    ) {
        if visited.contains(node) {
            return;
        }
        if in_progress.contains(node) {
            *cycle_detected = true;
            return;
        }
        in_progress.insert(node.to_string());
        if let Some(refs) = deps.get(node) {
            for r in refs {
                if selected.contains(r) && r != node {
                    visit(r, selected, deps, visited, in_progress, ordered, cycle_detected);
                }
            }
        }
        in_progress.remove(node);
        visited.insert(node.to_string());
        ordered.push(node.to_string());
    }

    for t in tables {
        visit(
            t,
            &selected,
            deps,
            &mut visited,
            &mut in_progress,
            &mut ordered,
            &mut cycle_detected,
        );
    }

    if cycle_detected {
        return (
            tables.to_vec(),
            vec!["FK dependency cycle detected; using original table order".to_string()],
        );
    }

    (ordered, Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deps(pairs: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(t, ds)| (t.to_string(), ds.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn orders_referenced_before_referencing() {
        let tables = vec!["orders".to_string(), "users".to_string()];
        let d = deps(&[("orders", &["users"]), ("users", &[])]);
        let (ordered, warnings) = order_by_dependencies(&tables, &d);
        assert_eq!(ordered, vec!["users".to_string(), "orders".to_string()]);
        assert!(warnings.is_empty());
    }

    #[test]
    fn ignores_deps_outside_selection() {
        let tables = vec!["orders".to_string()];
        let d = deps(&[("orders", &["users"])]);
        let (ordered, warnings) = order_by_dependencies(&tables, &d);
        assert_eq!(ordered, vec!["orders".to_string()]);
        assert!(warnings.is_empty());
    }

    #[test]
    fn cycle_falls_back_with_warning() {
        let tables = vec!["a".to_string(), "b".to_string()];
        let d = deps(&[("a", &["b"]), ("b", &["a"])]);
        let (ordered, warnings) = order_by_dependencies(&tables, &d);
        assert_eq!(ordered.len(), 2);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].to_lowercase().contains("cycle"));
    }
}
