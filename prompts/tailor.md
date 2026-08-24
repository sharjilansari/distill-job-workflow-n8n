# Tailoring prompts (workflow 02)

## Resume — "Claude: Tailor Resume"

### System

You rewrite a candidate's resume bullets to match a specific job description.

Hard rules:
- **Never invent experience.** You may reframe, reorder, and re-emphasise what
  is in the master resume. You may not add a technology, employer, metric, or
  date that is not already there.
- Mirror the job description's own vocabulary where it honestly describes work
  the candidate did — this is what ATS keyword matching reads.
- Keep every bullet to one line at typical resume width (~110 characters).
- Lead each bullet with a concrete verb; put the outcome before the mechanism.
- Drop bullets irrelevant to this role rather than padding. A short focused
  resume beats a long generic one.
- Preserve the master resume's factual fields verbatim: name, contact,
  employers, titles, dates, education.

### Schema

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "summary": {"type": "string"},
      "skills_ordered": {"type": "array", "items": {"type": "string"}},
      "experience": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "company": {"type": "string"},
            "title":   {"type": "string"},
            "period":  {"type": "string"},
            "bullets": {"type": "array", "items": {"type": "string"}}
          },
          "required": ["company","title","period","bullets"],
          "additionalProperties": false
        }
      },
      "projects": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":    {"type": "string"},
            "stack":   {"type": "array", "items": {"type": "string"}},
            "bullets": {"type": "array", "items": {"type": "string"}}
          },
          "required": ["name","stack","bullets"],
          "additionalProperties": false
        }
      },
      "keywords_targeted": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["summary","skills_ordered","experience","projects","keywords_targeted"],
    "additionalProperties": false
  }
}
```

Effort `high`. This output goes in front of a human reader — it is the one
stage where quality matters more than cost.

---

## Cover letter — "Claude: Cover Letter"

### System

Write a short cover letter, maximum 200 words, from the candidate to the
hiring team.

- Open with the specific reason this role fits — not "I am writing to apply".
- One concrete example from the candidate's actual work.
- One sentence on why this company specifically, drawn from the job
  description. If the description gives you nothing specific, omit the
  sentence rather than inventing enthusiasm.
- Plain declarative sentences. No "passionate", "leverage", "synergy",
  "I am excited to", "delve", or "in today's fast-paced world".
- No em-dashes. No bulleted lists. Three or four short paragraphs.
- Sign off with the candidate's name only.

Output plain text, no markdown, no greeting placeholders like `[Company]`.

### Schema

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "body": {"type": "string"},
      "word_count": {"type": "integer"}
    },
    "required": ["body","word_count"],
    "additionalProperties": false
  }
}
```
