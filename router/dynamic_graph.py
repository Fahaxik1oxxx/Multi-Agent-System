import logging
from langgraph.graph import StateGraph, END
from router.stream_graph import (
    StreamWorkflowState,
    bot_node,
    planner_node,
    retriever_node,
    coder_node,
    writer_node,
    executor_node,
    tester_node,
    summarizer_node
)

logger = logging.getLogger(__name__)

# Map agent names to existing node functions
NODE_FUNCTIONS = {
    "Bot": bot_node,
    "Planner": planner_node,
    "Retriever": retriever_node,
    "Coder": coder_node,
    "Writer": writer_node,
    "Executor": executor_node,
    "Tester": tester_node,
    "Summarizer": summarizer_node
}

def build_dynamic_workflow(pipeline_config: dict) -> StateGraph:
    """Build a LangGraph StateGraph dynamically from the frontend PipelineConfig."""
    logger.info("dynamic_graph | build started | nodes=%d | edges=%d",
                len(pipeline_config.get("nodes", [])),
                len(pipeline_config.get("edges", [])))

    wf = StateGraph(StreamWorkflowState)
    
    nodes = pipeline_config.get("nodes", [])
    edges = pipeline_config.get("edges", [])
    
    node_map = {n["id"]: n for n in nodes}
    
    # 1. Add agent nodes to the graph
    agent_nodes = []
    for node in nodes:
        if node["type"] == "agent":
            agent_name = node.get("data", {}).get("agent")
            func = NODE_FUNCTIONS.get(agent_name)
            if func:
                wf.add_node(node["id"], func)
                agent_nodes.append(node["id"])
                logger.info("dynamic_graph | add_node | id=%s | agent=%s", node["id"], agent_name)
            else:
                logger.warning("dynamic_graph | unknown agent | id=%s | agent=%s", node["id"], agent_name)
    
    # 2. Build adjacency list for edges
    adj = {}
    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        if src not in adj:
            adj[src] = []
        adj[src].append(tgt)
        
    # 3. Handle connections
    # The start node connects to the first agent
    start_node = next((n for n in nodes if n["type"] == "start"), None)
    
    # We must set conditional entry point to handle "fast lane" logic as in original stream_graph
    def route_lane(state: StreamWorkflowState) -> str:
        if state.get("complexity") == "低":
            bot_id = next((n["id"] for n in nodes if n["type"] == "agent" and n.get("data", {}).get("agent") == "Bot"), None)
            if bot_id:
                logger.info("dynamic_graph | route_lane | complexity=低 -> bot=%s", bot_id)
                return bot_id

        if start_node and start_node["id"] in adj:
            first_real_nodes = adj[start_node["id"]]
            if first_real_nodes:
                logger.info("dynamic_graph | route_lane | start -> %s", first_real_nodes[0])
                return first_real_nodes[0]
        elif agent_nodes:
            logger.info("dynamic_graph | route_lane | fallback -> %s", agent_nodes[0])
            return agent_nodes[0]

        logger.info("dynamic_graph | route_lane | no target -> END")
        return END

    wf.set_conditional_entry_point(route_lane)
    logger.info("dynamic_graph | entry_point | route_lane registered with %d agent nodes", len(agent_nodes))

    for node in nodes:
        if node["type"] == "agent":
            targets = adj.get(node["id"], [])
            agent_name = node.get("data", {}).get("agent")

            if not targets:
                logger.info("dynamic_graph | edge | %s(%s) -> END (no outgoing edge)", node["id"], agent_name)
                wf.add_edge(node["id"], END)
            elif len(targets) == 1:
                target_id = targets[0]
                target_node = node_map.get(target_id)

                if target_node and target_node["type"] == "router":
                    routes = target_node.get("data", {}).get("routes", [])
                    routes_summary = "; ".join(f"{r.get('condition')}->{r.get('target')}" for r in routes)
                    logger.info(
                        "dynamic_graph | router | %s(%s) -> router=%s | routes=[%s]",
                        node["id"], agent_name, target_id, routes_summary,
                    )

                    def create_router_func(node_id, agent_name_val, routes_config):
                        def route_func(state: StreamWorkflowState) -> str:
                            if state.get("execution_result", "") and (
                                "无代码" in state.get("execution_result", "")
                                or "没有有效代码块" in state.get("execution_result", "")
                            ):
                                summarizer_id = next(
                                    (r.get("target") for r in routes_config if r.get("condition") == "default"), END
                                )
                                chosen = summarizer_id if state.get("need_report", True) else END
                                logger.info(
                                    "dynamic_graph | route_func | %s | exec_result=无代码 -> %s",
                                    node_id, chosen,
                                )
                                return chosen

                            test_result = state.get("test_result", "")
                            fix_count = state.get("fix_count", 0)
                            if test_result:
                                if "✅" in test_result or fix_count >= 2:
                                    summarizer_id = next(
                                        (r.get("target") for r in routes_config if r.get("condition") == "default"), END
                                    )
                                    chosen = summarizer_id if state.get("need_report", True) else END
                                    logger.info(
                                        "dynamic_graph | route_func | %s | test_result=pass/fix_exhausted -> %s",
                                        node_id, chosen,
                                    )
                                    return chosen

                            task_type = state.get("task_type", "编程")
                            for route in routes_config:
                                condition = route.get("condition")
                                tgt = route.get("target")
                                if condition == task_type:
                                    logger.info(
                                        "dynamic_graph | route_func | %s | task_type=%s -> %s",
                                        node_id, task_type, tgt,
                                    )
                                    return tgt

                            for route in routes_config:
                                if route.get("condition") == "default":
                                    logger.info(
                                        "dynamic_graph | route_func | %s | fallback(default) -> %s",
                                        node_id, route.get("target"),
                                    )
                                    return route.get("target")

                            logger.info("dynamic_graph | route_func | %s | no match -> END", node_id)
                            return END
                        return route_func

                    path_map = {}
                    for route in routes:
                        tgt = route.get("target")
                        if tgt:
                            if tgt in node_map:
                                path_map[tgt] = tgt
                            else:
                                logger.warning("Router target %s not found in graph, redirecting to END", tgt)
                                path_map[tgt] = END
                    path_map[END] = END

                    if not path_map:
                        wf.add_edge(node["id"], END)
                    else:
                        wf.add_conditional_edges(
                            node["id"],
                            create_router_func(node["id"], agent_name, routes),
                            path_map,
                        )
                elif target_node and target_node["type"] == "agent":
                    if agent_name == "Executor":
                        logger.info(
                            "dynamic_graph | edge | %s(Executor) -> conditional(%s or END) [无代码 check]",
                            node["id"], target_id,
                        )

                        def route_after_executor(nid, tid):
                            def _route(state: StreamWorkflowState) -> str:
                                exec_result = state.get("execution_result", "")
                                if "无代码" in exec_result or "没有有效代码块" in exec_result:
                                    logger.info(
                                        "dynamic_graph | route_after_executor | %s | 无代码 -> END", nid
                                    )
                                    return END
                                logger.info(
                                    "dynamic_graph | route_after_executor | %s | has_code -> %s", nid, tid
                                )
                                return tid
                            return _route

                        wf.add_conditional_edges(
                            node["id"],
                            route_after_executor(node["id"], target_id),
                            {target_id: target_id, END: END},
                        )
                    elif agent_name == "Tester":
                        logger.info(
                            "dynamic_graph | edge | %s(Tester) -> conditional(%s or END) [✅/fix check]",
                            node["id"], target_id,
                        )

                        def route_test(nid, tid):
                            def _route(state: StreamWorkflowState) -> str:
                                test_result = state.get("test_result", "")
                                fix_count = state.get("fix_count", 0)
                                if "✅" in test_result or fix_count >= 2:
                                    logger.info(
                                        "dynamic_graph | route_test | %s | pass/exhausted -> %s", nid, tid
                                    )
                                    return tid
                                logger.info(
                                    "dynamic_graph | route_test | %s | fail(need_fix) -> %s (still forward, no loop edge)",
                                    nid, tid,
                                )
                                return tid
                            return _route

                        wf.add_conditional_edges(
                            node["id"],
                            route_test(node["id"], target_id),
                            {target_id: target_id, END: END},
                        )
                    else:
                        logger.info(
                            "dynamic_graph | edge | %s(%s) -> %s",
                            node["id"], agent_name, target_id,
                        )
                        wf.add_edge(node["id"], target_id)
                else:
                    logger.info(
                        "dynamic_graph | edge | %s(%s) -> END (target node not found)",
                        node["id"], agent_name,
                    )
                    wf.add_edge(node["id"], END)
            else:
                logger.warning(
                    "dynamic_graph | multiple outgoing edges | %s(%s) without router, using first: %s",
                    node["id"], agent_name, targets[0],
                )
                wf.add_edge(node["id"], targets[0])

    compiled = wf.compile()
    logger.info(
        "dynamic_graph | build complete | agent_nodes=%d | edges=%d",
        len(agent_nodes), len(edges),
    )
    return compiled
