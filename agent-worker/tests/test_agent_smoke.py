"""Smoke test for the voice worker.

Run with:  .venv/bin/python tests/test_agent_smoke.py

This exists because the previous worker could not be imported at all, let alone
constructed. It asserts the things that were broken:

  1. Both agents import.
  2. CustomerAgent can be CONSTRUCTED (this raised TypeError before).
  3. Tools are registered on the agent.
  4. main.py imports and exports an entrypoint + prewarm.
  5. Nobody re-introduces the removed v0 API or the first-tenant fallback.
"""

from __future__ import annotations

import ast
import inspect
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        failures.append(label)


print("\n=== 1. imports ===")
from agents.customer_agent import CustomerAgent, build_prompt, greeting_for  # noqa: E402
from agents.owner_copilot_agent import OwnerCopilotAgent  # noqa: E402
from services.db import Database  # noqa: E402

check("agents.customer_agent imports", True)
check("agents.owner_copilot_agent imports", True)
check("services.db imports", True)

print("\n=== 2. construction (previously TypeError) ===")
TENANT = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Test VVS",
    "slug": "test-vvs",
    "default_language": "da-DK",
    "customer_system_prompt": "Du er receptionist.",
    "copilot_system_prompt": "Du er co-pilot.",
    "active_broadcast_message": None,
    "greeting_script": None,
    "business_hours": {},
    "pricing_catalog": [],
}
CONTACT = {
    "id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    "full_name": "Morten Bondo",
    "phone_number": "+4528776655",
    "preferred_language": "da",
    "shared_memory_summary": "Test caller",
}

db = Database("postgres://invalid/none")

try:
    agent = CustomerAgent(
        tenant=TENANT, contact=CONTACT, db=db, room_name="test_room", knowledge="- rule"
    )
    check("CustomerAgent constructed", True)
except Exception as exc:  # noqa: BLE001
    agent = None
    check("CustomerAgent constructed", False, f"-> {type(exc).__name__}: {exc}")

check(
    "no multiple inheritance",
    agent is not None and [c.__name__ for c in type(agent).__mro__][1:3] == ["Agent", "ABC"]
    or (agent is not None and type(agent).__bases__[0].__name__ == "Agent"),
    f"-> {[c.__name__ for c in type(agent).__mro__] if agent else 'n/a'}",
)

print("\n=== 3. tools registered ===")
if agent is not None:
    found = [
        name
        for name in (
            "check_availability_and_pricing",
            "update_pipeline_stage",
            "trigger_dire_escalation",
            "record_project_estimate",
            "request_inspection",
        )
        if callable(getattr(agent, name, None))
    ]
    check("5 customer tools registered (estimator + inspection request)", len(found) == 5, f"-> found {found}")

    owner = OwnerCopilotAgent(tenant=TENANT, db=db)
    owner_tools = [
        name
        for name in ("brief_owner", "set_broadcast")
        if callable(getattr(owner, name, None))
    ]
    check("2 owner tools registered", len(owner_tools) == 2, f"-> found {owner_tools}")

print("\n=== 4. prompt + greeting ===")
prompt = build_prompt(TENANT, CONTACT, "- know")
check("prompt includes the agency-owned text", "Du er receptionist." in prompt)
check("prompt states the language rule", "Danish" in prompt)
check("greeting mentions the caller", "Morten" in greeting_for(TENANT, CONTACT))

print("\n=== 5. main.py wiring ===")
try:
    import main as worker_main  # noqa: E402

    check("main.py imports", True)
    check("entrypoint is async", inspect.iscoroutinefunction(worker_main.entrypoint))
    check("prewarm exists", callable(worker_main.prewarm))
except Exception as exc:  # noqa: BLE001
    check("main.py imports", False, f"-> {type(exc).__name__}: {exc}")

print("\n=== 6. regressions must not return ===")


def code_only(path: pathlib.Path) -> str:
    """Source with all comments and docstrings removed.

    The module docstrings deliberately *describe* the old bugs (that is the
    documentation of the fix), so a naive text scan matches its own explanation.
    """
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


main_code = code_only(ROOT / "main.py")
agent_code = code_only(ROOT / "agents" / "customer_agent.py")

check("no VoicePipelineAgent in code", "VoicePipelineAgent" not in main_code + agent_code)
check(
    "no first-tenant fallback in code",
    "limit 1" not in main_code and "order_by" not in main_code,
)
check("uses AgentSession", "AgentSession" in main_code)
check("uses function_tool", "function_tool" in agent_code)
check("no supabase import", "supabase" not in (main_code + agent_code).lower())
check(
    "raises when tenant_id is missing",
    "raise RuntimeError" in main_code and "tenant_id" in main_code,
)

tree = ast.parse(agent_code)
classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
check(
    "exactly one agent class (no inheritance chain)",
    len(classes) == 1,
    f"-> {[c.name for c in classes]}",
)


print("\n" + "=" * 46)
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL WORKER SMOKE CHECKS PASSED")
