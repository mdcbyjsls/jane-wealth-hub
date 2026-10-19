# Git Workflow Rules

This project lives in a public GitHub repo and is a take-home assessment. Commit history is part of what reviewers evaluate. Follow these rules in every session.

## 1. Never commit secrets

- API keys and sensitive credentials go in `.env`, which must be gitignored.
- Maintain a `.env.example` with placeholder values so reviewers know what's needed.
- Before committing, verify no `.env` file or secret values are staged.

## 2. Small, descriptive commits at meaningful milestones

- Commit after each approved spec revision (requirements, design, tasks).
- Commit after each completed task.
- Do not batch everything into one large commit at the end.

## 3. Clear commit messages that explain *why*

Use the imperative mood and include context, not just what changed. Examples:

- `requirements v2: cut tax optimization from scope, add stale-data states`
- `design: switch to REST over GraphQL to reduce complexity`
- `feat(portfolio): add stale-data banner when prices are >15 min old`
- `fix(auth): redirect to login on 401 instead of showing blank screen`

## 4. Ask before pushing

Always confirm with the user before running `git push` or opening a pull request.
