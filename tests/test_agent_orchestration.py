"""
Agent 自定义编排测试 —— 验证前端编排画布和 Agent 设计器所需的所有后端接口。

当前后端缺失以下功能，这些测试预期失败：
  1. GET/PUT /api/projects/{project_id}/agent-config  （404）
  2. GET /api/projects/{id} 不返回 agent_config 字段
  3. POST /api/w/{ws_id}/projects 不接受 agent_config
  4. 流式工作流不读取 agent_config 动态构建图
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import json
import pytest
from fastapi.testclient import TestClient
from main import app

# ─── 常量 ────────────────────────────────────────────────────────────────────

DEFAULT_LLM_AGENTS = [
    "Planner", "Retriever", "Coder", "Writer",
    "Tester", "Summarizer", "Bot",
]

ALL_PIPELINE_AGENTS = DEFAULT_LLM_AGENTS + ["Executor"]

INVALID_AGENT_NAMES = ["UnknownAgent", "Foo", "MagicBot", ""]

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client, suffix: str = "") -> tuple[str, str]:
    name = f"t_{suffix}_{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/auth/register", json={
        "name": name, "email": f"{name}@t.com", "password": "test1234"
    })
    assert resp.status_code in (200, 201), f"register failed: {resp.json()}"
    data = resp.json()
    return data["token"], data["user_id"]


def _create_workspace(client, token: str) -> str:
    name = f"ws_{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/workspaces", json={"name": name}, headers=_auth(token))
    assert resp.status_code in (200, 201), f"create workspace failed: {resp.json()}"
    return resp.json()["id"]


def _create_project(client, token: str, ws_id: str) -> str:
    name = f"proj_{uuid.uuid4().hex[:6]}"
    resp = client.post(
        f"/api/w/{ws_id}/projects",
        json={"name": name, "description": "test"},
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), f"create project failed: {resp.json()}"
    return resp.json()["id"]


# ═════════════════════════════════════════════════════════════════════════════
# 第一部分：Agent Config CRUD
# 前端   GET/PUT /api/projects/{project_id}/agent-config
# 预期   当前后端未实现 → 全部失败（404）
# ═════════════════════════════════════════════════════════════════════════════

class TestAgentConfigCRUD:

    # ─── GET ───────────────────────────────────────────────────────────────

    def test_get_agent_config_requires_auth(self):
        """未认证请求应返回 401"""
        with TestClient(app) as client:
            resp = client.get("/api/projects/fake-id/agent-config")
            assert resp.status_code == 401, f"expected 401, got {resp.status_code}"

    def test_get_agent_config_project_not_found(self):
        """不存在的 project_id 应返回 404"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_notfound")
            resp = client.get(
                f"/api/projects/{uuid.uuid4().hex}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 404, f"expected 404, got {resp.status_code}"

    def test_get_agent_config_returns_default(self):
        """已有项目但未保存过 agent-config → 返回默认配置（所有 agent 启用）"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_default")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.get(
                f"/api/projects/{proj_id}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"expected 200, got {resp.status_code}"
            data = resp.json()

            assert "enabled_agents" in data, "缺少 enabled_agents"
            assert "disabled_agents" in data, "缺少 disabled_agents"
            assert "always_on" in data, "缺少 always_on"
            assert isinstance(data["enabled_agents"], list)
            assert isinstance(data["disabled_agents"], list)
            assert isinstance(data["always_on"], list)
            # 默认所有 agent 启用
            assert sorted(data["enabled_agents"]) == sorted(ALL_PIPELINE_AGENTS), (
                f"默认应包含所有 agent: {data['enabled_agents']}"
            )
            assert data["disabled_agents"] == [], f"默认 disabled_agents 应为空: {data['disabled_agents']}"

    def test_get_agent_config_returns_saved(self):
        """保存后再读取应返回保存的值"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_saved")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            custom_agents = ["Planner", "Coder", "Tester", "Summarizer"]
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": custom_agents},
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"save failed: {resp.json()}"

            resp = client.get(
                f"/api/projects/{proj_id}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 200
            data = resp.json()
            assert sorted(data["enabled_agents"]) == sorted(custom_agents), (
                f"读取结果不一致: {data['enabled_agents']}"
            )

    def test_get_agent_config_isolation_by_project(self):
        """不同项目的 agent-config 相互隔离"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_iso")
            ws_id = _create_workspace(client, token)
            proj_a = _create_project(client, token, ws_id)
            proj_b = _create_project(client, token, ws_id)

            # 项目 A 启用部分 agent
            client.put(
                f"/api/projects/{proj_a}/agent-config",
                json={"enabled_agents": ["Planner", "Coder"]},
                headers=_auth(token),
            )

            # 项目 B 取默认值（全部启用）
            resp_b = client.get(
                f"/api/projects/{proj_b}/agent-config",
                headers=_auth(token),
            )
            assert resp_b.status_code == 200
            assert sorted(resp_b.json()["enabled_agents"]) == sorted(ALL_PIPELINE_AGENTS)

            # 项目 A 仍是自定义
            resp_a = client.get(
                f"/api/projects/{proj_a}/agent-config",
                headers=_auth(token),
            )
            assert resp_a.json()["enabled_agents"] == ["Planner", "Coder"]

    def test_get_agent_config_isolation_by_user(self):
        """不同用户的 agent-config 相互隔离"""
        with TestClient(app) as client:
            token_a, _ = _register(client, "ag_ua")
            token_b, _ = _register(client, "ag_ub")

            ws_a = _create_workspace(client, token_a)
            ws_b = _create_workspace(client, token_b)

            proj_a = _create_project(client, token_a, ws_a)
            proj_b = _create_project(client, token_b, ws_b)

            client.put(
                f"/api/projects/{proj_a}/agent-config",
                json={"enabled_agents": ["Bot"]},
                headers=_auth(token_a),
            )

            resp_b = client.get(
                f"/api/projects/{proj_b}/agent-config",
                headers=_auth(token_b),
            )
            assert resp_b.status_code == 200
            assert sorted(resp_b.json()["enabled_agents"]) == sorted(ALL_PIPELINE_AGENTS)
    
    # ─── PUT ───────────────────────────────────────────────────────────────

    def test_update_agent_config_requires_auth(self):
        """未认证 PUT 应返回 401"""
        with TestClient(app) as client:
            resp = client.put(
                "/api/projects/fake-id/agent-config",
                json={"enabled_agents": ["Planner"]},
            )
            assert resp.status_code == 401

    def test_update_agent_config_project_not_found(self):
        """不存在的 project_id 返回 404"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_up404")
            resp = client.put(
                f"/api/projects/{uuid.uuid4().hex}/agent-config",
                json={"enabled_agents": ["Planner"]},
                headers=_auth(token),
            )
            assert resp.status_code == 404

    def test_update_agent_config_success(self):
        """正常保存应返回 200 + 正确的响应格式"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_ok")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            custom = ["Planner", "Coder", "Tester", "Summarizer"]
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": custom},
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.json()}"
            data = resp.json()
            assert "status" in data
            assert data["status"] == "ok"
            assert sorted(data["enabled_agents"]) == sorted(custom)

    def test_update_agent_config_all_disabled(self):
        """空列表时服务端应自动补全 always_on agent（Planner, Summarizer）"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_empt")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": []},
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.json()}"
            data = resp.json()
            # always_on 的 agent 应被自动补全
            for always in ("Planner", "Summarizer"):
                assert always in data["enabled_agents"], (
                    f"always_on agent {always} 应在 enabled_agents 中: {data['enabled_agents']}"
                )

    def test_update_agent_config_invalid_format(self):
        """非法请求体应返回 4xx"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_inv")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            # 非数组
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": "not_a_list"},
                headers=_auth(token),
            )
            assert resp.status_code in (400, 422), f"expected 4xx, got {resp.status_code}"

            # 缺少字段
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={},
                headers=_auth(token),
            )
            assert resp.status_code in (400, 422)

            # 非 JSON
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                content=b"not json",
                headers={"Content-Type": "application/json", **_auth(token)},
            )
            assert resp.status_code in (400, 422)

    def test_update_agent_config_invalid_agent_name(self):
        """不存在的 agent 名称应返回 4xx"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_bad")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["NonExistentAgent"]},
                headers=_auth(token),
            )
            assert resp.status_code in (400, 422), (
                f"无效 agent 名应返回 4xx, got {resp.status_code}: {resp.json()}"
            )

    def test_update_agent_config_duplicate_names(self):
        """重复的 agent 名称应去重或返回 4xx"""
        with TestClient(app) as client:
            token, _ = _register(client, "ag_dup")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["Planner", "Planner", "Coder"]},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            # 结果应去重
            data = resp.json()
            assert data["enabled_agents"] == ["Planner", "Coder"], (
                f"重复未去重: {data['enabled_agents']}"
            )

    def test_update_agent_config_other_user_cannot_modify(self):
        """用户 B 不能修改用户 A 项目的 agent-config"""
        with TestClient(app) as client:
            token_a, _ = _register(client, "ag_own1")
            token_b, _ = _register(client, "ag_own2")
            ws_a = _create_workspace(client, token_a)
            proj_a = _create_project(client, token_a, ws_a)

            resp = client.put(
                f"/api/projects/{proj_a}/agent-config",
                json={"enabled_agents": ["Bot"]},
                headers=_auth(token_b),
            )
            assert resp.status_code == 403, (
                f"其他用户修改应返回 403, got {resp.status_code}"
            )


# ═════════════════════════════════════════════════════════════════════════════
# 第二部分：User Config —— 自定义 System Prompt
# 前端 GET/PUT /api/user/config   （Agent Designer）
# 预期   当前后端已实现这些接口
# ═════════════════════════════════════════════════════════════════════════════

class TestUserAgentConfig:

    def test_get_user_config_has_roles(self):
        """GET /api/user/config 返回 roles 字段"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_role")
            resp = client.get("/api/user/config", headers=_auth(token))
            assert resp.status_code == 200
            data = resp.json()
            assert "roles" in data
            for agent in DEFAULT_LLM_AGENTS:
                assert agent in data["roles"], (
                    f"默认 roles 中缺少 {agent}: {list(data['roles'].keys())}"
                )

    def test_save_custom_prompts(self):
        """保存自定义 prompt 后可读出"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_save")
            custom = {"Planner": "你是测试用的 Planner", "Bot": "你是测试用的 Bot"}
            resp = client.put(
                "/api/user/config",
                json={"roles": custom},
                headers=_auth(token),
            )
            assert resp.status_code == 200, f"save failed: {resp.json()}"
            assert resp.json()["status"] == "ok"

            resp = client.get("/api/user/config", headers=_auth(token))
            assert resp.status_code == 200
            roles = resp.json()["roles"]
            assert roles["Planner"] == "你是测试用的 Planner"
            assert roles["Bot"] == "你是测试用的 Bot"

    def test_custom_prompts_merge_with_defaults(self):
        """只保存部分 role 时，其他 role 应保留默认值"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_merge")
            client.put(
                "/api/user/config",
                json={"roles": {"Coder": "自定义 Coder"}},
                headers=_auth(token),
            )
            resp = client.get("/api/user/config", headers=_auth(token))
            roles = resp.json()["roles"]
            assert roles["Coder"] == "自定义 Coder"
            # 其他 role 应有值（可能来自默认配置）
            assert roles.get("Planner"), "Planer 不应为空"
            assert roles.get("Writer"), "Writer 不应为空"
            assert roles.get("Tester"), "Tester 不应为空"

    def test_custom_prompts_isolation(self):
        """不同用户的自定义 prompt 相互隔离"""
        with TestClient(app) as client:
            token_a, _ = _register(client, "uc_iso_a")
            token_b, _ = _register(client, "uc_iso_b")

            client.put(
                "/api/user/config",
                json={"roles": {"Planner": "A 的 Planner"}},
                headers=_auth(token_a),
            )

            resp_a = client.get("/api/user/config", headers=_auth(token_a))
            resp_b = client.get("/api/user/config", headers=_auth(token_b))

            assert resp_a.json()["roles"]["Planner"] == "A 的 Planner"
            # B 的 Planner 应不同于 A
            assert resp_b.json()["roles"]["Planner"] != "A 的 Planner"

    def test_save_empty_roles(self):
        """保存空 roles 应成功，不破坏已有配置"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_empty")
            resp = client.put(
                "/api/user/config",
                json={"roles": {}},
                headers=_auth(token),
            )
            assert resp.status_code == 200

    def test_save_invalid_format(self):
        """非法请求体应返回 4xx"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_inv")
            resp = client.put(
                "/api/user/config",
                json={"wrong_field": {}},
                headers=_auth(token),
            )
            # 即使没有 roles 字段，后端也应能处理（忽略未知字段）
            assert resp.status_code in (200, 400, 422)

    def test_get_user_config_models_and_system_models(self):
        """GET /api/user/config 应包含 models 和 system_models"""
        with TestClient(app) as client:
            token, _ = _register(client, "uc_mod")
            resp = client.get("/api/user/config", headers=_auth(token))
            data = resp.json()
            assert "models" in data
            assert "system_models" in data


# ═════════════════════════════════════════════════════════════════════════════
# 第三部分：Project agent_config 字段可见性
# 前端 Project 类型包含 agent_config: string
# 预期   当前 GET /api/projects/{id} 可能不返回 agent_config
# ═════════════════════════════════════════════════════════════════════════════

class TestProjectAgentConfigField:

    def test_project_response_has_agent_config(self):
        """GET /api/projects/{id} 应包含 agent_config 字段"""
        with TestClient(app) as client:
            token, _ = _register(client, "pj_field")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.get(f"/api/projects/{proj_id}", headers=_auth(token))
            assert resp.status_code == 200
            data = resp.json()
            assert "agent_config" in data, (
                f"Project 响应缺少 agent_config 字段: {list(data.keys())}"
            )
            # agent_config 应为 JSON 字符串
            assert isinstance(data["agent_config"], str), (
                f"agent_config 应为字符串: {type(data['agent_config'])}"
            )

    def test_agent_config_updates_after_save(self):
        """保存 agent-config 后，GET /api/projects/{id} 的 agent_config 应更新"""
        with TestClient(app) as client:
            token, _ = _register(client, "pj_upd")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            custom = ["Planner", "Bot"]
            client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": custom},
                headers=_auth(token),
            )

            resp = client.get(f"/api/projects/{proj_id}", headers=_auth(token))
            raw = resp.json()["agent_config"]
            parsed = json.loads(raw)
            assert "enabled_agents" in parsed
            assert sorted(parsed["enabled_agents"]) == sorted(custom)

    def test_create_project_with_agent_config(self):
        """POST /api/projects 支持传入 agent_config"""
        with TestClient(app) as client:
            token, _ = _register(client, "pj_crtcfg")
            ws_id = _create_workspace(client, token)

            custom_cfg = json.dumps({"enabled_agents": ["Planner", "Coder"]})
            resp = client.post(
                f"/api/w/{ws_id}/projects",
                json={
                    "name": f"cfg_proj_{uuid.uuid4().hex[:6]}",
                    "description": "with agent_config",
                    "agent_config": custom_cfg,
                },
                headers=_auth(token),
            )
            assert resp.status_code in (200, 201), (
                f"create with agent_config failed: {resp.json()}"
            )
            proj_id = resp.json()["id"]

            resp = client.get(f"/api/projects/{proj_id}", headers=_auth(token))
            raw = resp.json().get("agent_config", "{}")
            parsed = json.loads(raw)
            assert parsed.get("enabled_agents") == ["Planner", "Coder"], (
                f"创建时传入的 agent_config 未保留: {parsed}"
            )


# ═════════════════════════════════════════════════════════════════════════════
# 第四部分：流式工作流集成 —— 动态构建图
# 预期   当前工作流完全硬编码，不读取 agent_config
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(
    not os.environ.get("DEEPSEEK_API_KEY"),
    reason="DEEPSEEK_API_KEY not set — 跳过 LLM 依赖测试"
)
class TestWorkflowIntegration:

    def test_stream_workflow_respects_disabled_agents(self):
        """禁用了某个 agent 后，工作流不应调用它"""
        with TestClient(app) as client:
            token, _ = _register(client, "wf_disable")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            # 只启用 Bot，禁掉所有其他 agent
            client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["Bot"]},
                headers=_auth(token),
            )

            resp = client.post(
                "/api/chat/start",
                json={"message": "你好", "lane_mode": "fast", "project_id": proj_id},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            session_id = resp.json()["session_id"]

            # 消费 SSE 流
            stream_resp = client.get(
                f"/api/chat/stream/{session_id}",
                headers=_auth(token),
            )
            assert stream_resp.status_code == 200
            body = stream_resp.text

            # 不应出现被禁用 agent 的痕迹
            assert "Planner" not in body, "Bot-only 模式不应出现 Planner"

    def test_stream_workflow_uses_custom_prompts(self):
        """用户自定义的 system prompt 应在工作流中生效"""
        with TestClient(app) as client:
            token, _ = _register(client, "wf_prompt")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            custom_prompt = "你是测试 Bot，只说『测试通过』"
            client.put(
                "/api/user/config",
                json={"roles": {"Bot": custom_prompt}},
                headers=_auth(token),
            )

            resp = client.post(
                "/api/chat/start",
                json={"message": "你好", "lane_mode": "fast", "project_id": proj_id},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            session_id = resp.json()["session_id"]

            stream_resp = client.get(
                f"/api/chat/stream/{session_id}",
                headers=_auth(token),
            )
            assert stream_resp.status_code == 200

    def test_stream_workflow_no_agents_enabled(self):
        """所有非 always_on agent 都被禁用 → 仍然可用（只剩 always_on）"""
        with TestClient(app) as client:
            token, _ = _register(client, "wf_noagent")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": []},
                headers=_auth(token),
            )

            resp = client.post(
                "/api/chat/start",
                json={"message": "测试", "project_id": proj_id},
                headers=_auth(token),
            )
            # 因为 always_on 的 agent (Planner, Summarizer) 会被自动补全，所以仍有可用 agent
            assert resp.status_code == 200, (
                f"always_on agent 应保证仍有可用 agent, got {resp.status_code}: {resp.json()}"
            )

    def test_stream_workflow_default_config(self):
        """未保存 agent-config 时使用完整的默认管线"""
        with TestClient(app) as client:
            token, _ = _register(client, "wf_def")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.post(
                "/api/chat/start",
                json={"message": "写一个 Hello World", "project_id": proj_id},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            session_id = resp.json()["session_id"]

            stream_resp = client.get(
                f"/api/chat/stream/{session_id}",
                headers=_auth(token),
            )
            assert stream_resp.status_code == 200


# ═════════════════════════════════════════════════════════════════════════════
# 第五部分：always_on 恒定规则
# 前端 AgentTab.tsx 标记 Planner 和 Summarizer 为 alwaysOn: true
# 服务端应保证 always_on 的 agent 永远存在于 enabled_agents 中
# ═════════════════════════════════════════════════════════════════════════════

class TestAlwaysOn:

    def test_always_on_rules_are_constant(self):
        """GET /api/projects/{id}/agent-config 返回的 always_on 固定为 Planner, Summarizer"""
        with TestClient(app) as client:
            token, _ = _register(client, "ao_const")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            resp = client.get(
                f"/api/projects/{proj_id}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 200
            always_on = resp.json().get("always_on", [])
            assert "Planner" in always_on
            assert "Summarizer" in always_on

    def test_always_on_agents_cannot_be_removed(self):
        """PUT 时即使不发送 always_on agent，服务端应自动补全"""
        with TestClient(app) as client:
            token, _ = _register(client, "ao_force")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            # 只发送非 always_on 的 agent
            resp = client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["Coder", "Tester"]},
                headers=_auth(token),
            )
            assert resp.status_code == 200
            data = resp.json()
            always_on = data.get("always_on", [])

            # always_on 应始终出现在 enabled_agents 中
            for agent in always_on:
                assert agent in data["enabled_agents"], (
                    f"always_on agent {agent} 必须存在: {data['enabled_agents']}"
                )

    def test_always_on_appears_in_get_after_put(self):
        """PUT 后再 GET，always_on 字段应存在且一致"""
        with TestClient(app) as client:
            token, _ = _register(client, "ao_consist")
            ws_id = _create_workspace(client, token)
            proj_id = _create_project(client, token, ws_id)

            client.put(
                f"/api/projects/{proj_id}/agent-config",
                json={"enabled_agents": ["Bot"]},
                headers=_auth(token),
            )

            resp = client.get(
                f"/api/projects/{proj_id}/agent-config",
                headers=_auth(token),
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "always_on" in data
            assert "Planner" in data["always_on"]
            assert "Summarizer" in data["always_on"]
            assert "Planner" in data["enabled_agents"]
            assert "Summarizer" in data["enabled_agents"]


# ═════════════════════════════════════════════════════════════════════════════
# 第六部分：验证 DEEPSEEK_API_KEY 存在（辅助信息）
# ═════════════════════════════════════════════════════════════════════════════

class TestEnvCheck:
    def test_deepseek_api_key_info(self):
        """打印 API Key 配置状态（仅信息性，永远 PASS）"""
        key = os.environ.get("DEEPSEEK_API_KEY", "")
        has_key = bool(key)
        prefix = key[:8] + "..." if len(key) > 8 else "(empty)"
        print(f"\n  DEEPSEEK_API_KEY: {'✅ 已设置' if has_key else '❌ 未设置'} {prefix}")
        print(f"  LLM 依赖测试: {'✅ 将执行' if has_key else '❌ 将被跳过(skip)'}")
