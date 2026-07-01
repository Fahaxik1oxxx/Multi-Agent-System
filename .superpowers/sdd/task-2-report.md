### Task 2 Report: DB Methods -- saved_configs + audit_logs + goal

**Status:** COMPLETED

**Files modified:**
- `user/db.py` -- Added 11 methods to the Database class (113 lines)

**Methods added:**

| Method | Section | Description |
|---|---|---|
| `create_config` | 智能体配置 | Insert saved_configs row, return config ID |
| `get_config` | 智能体配置 | Fetch single config by ID, parse JSON columns |
| `list_configs` | 智能体配置 | List user configs, optional project_id filter |
| `_parse_config_row` | 智能体配置 | Helper: parse agents/pipeline/prompts JSON columns |
| `update_config` | 智能体配置 | Update with allowed-fields whitelist, auto-update timestamp |
| `delete_config` | 智能体配置 | Delete config by ID |
| `list_public_configs` | 智能体配置 | Public configs with optional search + pagination |
| `create_audit_log` | 审计日志 | Insert audit_logs row, return audit ID |
| `count_recent_audit` | 审计日志 | Count recent audit entries by action/user/ip/minutes |
| `get_user_goal` | 用户目标 | Read `users.goal` column |
| `set_user_goal` | 用户目标 | Write `users.goal` column |

**Insertion point:** After `# -- 频道管理 --` section (after `rename_channel`), before `get_user_name`.

**Test results:** All 13 tests passed:
- create_config + get_config (JSON round-trip for agents, pipeline, prompts)
- list_configs
- update_config (name, agents, pipeline) + invalid field rejection
- list_public_configs (public filter + search)
- delete_config (returns None after delete)
- create_audit_log + count_recent_audit (with/without filters)
- get_user_goal + set_user_goal (including nonexistent user edge cases)

**Concerns:** None. All methods follow the exact brief code verbatim, including the allowed-fields whitelist on `update_config`, JSON serialization with `ensure_ascii=False`, and datetime usage matching existing DB conventions.

---

### DRY Fix: get_config delegates to _parse_config_row

**Status:** FIXED

**Change:** In `get_config`, replaced 4 lines of inline JSON parsing (agents, pipeline, prompts) with a single call to `self._parse_config_row(row)`. The private helper `_parse_config_row` was already doing the identical work and was being used by `list_configs` and `list_public_configs` -- `get_config` was the sole remaining caller that duplicated the parsing inline.

**Test result:** PASSED
```
Fix verified OK
```
Test exercised: create_config -> get_config -> assert name and agents round-trip correctly -> delete_config cleanup.
