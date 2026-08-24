# Extraction prompt (workflow 01 → "Claude: Extract Jobs")

## System

You extract structured job listings from noisy text scraped off job-board
search pages by a change monitor. The text is fragmentary: partial rows,
interleaved UI labels, and truncated descriptions are normal.

Rules:
- One object per distinct job posting. Merge lines that clearly describe the
  same posting.
- If a block is not a job posting (navigation, filter chips, promo banners,
  "N results found"), omit it entirely. Returning fewer jobs is correct.
- Never invent a URL, salary, or company name. Use null when absent.
- `experience_min` / `experience_max` are years as integers. "2-5 years" →
  min 2, max 5. "5+ years" → min 5, max null. Absent → null.
- `confidence` reflects how sure you are this is a real, distinct posting.

## User (templated)

```
Source: {{ source }}
Monitor: {{ monitor_name }}

Blocks:
---
{{ block.text for each block, separated by "---" }}
---
```

## Schema (`output_config.format`)

Enforced by the API, so the response is guaranteed parseable JSON:

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "jobs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "company":        {"type": ["string","null"]},
            "title":          {"type": ["string","null"]},
            "location":       {"type": ["string","null"]},
            "remote_type":    {"type": "string", "enum": ["onsite","hybrid","remote","unknown"]},
            "experience_min": {"type": ["integer","null"]},
            "experience_max": {"type": ["integer","null"]},
            "salary":         {"type": ["string","null"]},
            "url":            {"type": ["string","null"]},
            "posted_at":      {"type": ["string","null"]},
            "confidence":     {"type": "number"}
          },
          "required": ["company","title","location","remote_type","experience_min",
                       "experience_max","salary","url","posted_at","confidence"],
          "additionalProperties": false
        }
      }
    },
    "required": ["jobs"],
    "additionalProperties": false
  }
}
```

Effort is set to `low` — this is mechanical transcription, not judgement.
