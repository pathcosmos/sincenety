# sincenety hooks

## guard-out.sh

PreToolUse hook that blocks `sincenety out*` commands when no prior summary exists (MISSING/STALE).

### Installation

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/sincenety/hooks/guard-out.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/sincenety` with the actual install path (e.g. the output of `npm root -g`).

### Exit codes

- `0` — allow (not a `sincenety out` command, or verify passed)
- `2` — block (summary is MISSING or STALE; run `/sincenety` first)
