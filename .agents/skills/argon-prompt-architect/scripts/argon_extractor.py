#!/usr/bin/env python3
"""
Argon AST & Contract Extractor (argon_extractor.py)
--------------------------------------------------
Surgical context extraction engine for Argon (64k context model / LM Arena).
Extracts the exact Type Spine, Design System tokens, and API contracts from
TypeScript, Python, SQL, and CSS files, stripping implementation bodies to
stay strictly under the 3,500 input token budget ceiling.
"""

import sys
import os
import re
import ast
import argparse
from typing import List, Dict, Optional, Set

CHARS_PER_TOKEN = 3.8


def count_tokens(text: str) -> int:
    """Calculates approximate token count using a conservative character ratio."""
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def extract_python_spine(content: str, symbols: Optional[Set[str]] = None) -> str:
    """
    Extracts type spine from Python code using the standard library `ast` module.
    Extracts class definitions, dataclasses, TypedDicts, function signatures,
    and type annotations while replacing function bodies with `...`.
    """
    try:
        tree = ast.parse(content)
    except SyntaxError:
        # Fallback to regex if syntax error (e.g. invalid syntax in snippet)
        return _regex_fallback_python(content, symbols)

    extracted_lines = []

    for node in tree.body:
        # Global assignments, type aliases, or constants
        if isinstance(node, ast.AnnAssign):
            target = getattr(node.target, "id", None)
            if target and (not symbols or target in symbols):
                type_hint = ast.unparse(node.annotation)
                value_repr = f" = {ast.unparse(node.value)}" if node.value else ""
                extracted_lines.append(f"{target}: {type_hint}{value_repr}")
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                target_id = getattr(t, "id", None)
                if target_id and (not symbols or target_id in symbols):
                    # Preserve type aliases or constants
                    val_str = ast.unparse(node.value)
                    if any(kw in val_str for kw in ["Literal[", "Union[", "TypeVar(", "NewType("]):
                        extracted_lines.append(f"{target_id} = {val_str}")
                    elif target_id.isupper():
                        # Keep short scalar constants
                        if len(val_str) < 60 and "\n" not in val_str:
                            extracted_lines.append(f"{target_id} = {val_str}")

        # Top-level functions
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not symbols or node.name in symbols:
                extracted_lines.append(_format_func_signature(node))

        # Classes
        elif isinstance(node, ast.ClassDef):
            if not symbols or node.name in symbols:
                extracted_lines.append(_format_class_signature(node, symbols))

    return "\n".join(extracted_lines)


def _format_func_signature(node: ast.FunctionDef, indent: str = "") -> str:
    """Formats a function definition header, preserving decorators and type annotations."""
    lines = []
    prefix = "async def " if isinstance(node, ast.AsyncFunctionDef) else "def "
    # Decorators
    for dec in node.decorator_list:
        lines.append(f"{indent}@{ast.unparse(dec)}")
    # Args
    args_str = ast.unparse(node.args)
    return_str = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    lines.append(f"{indent}{prefix}{node.name}({args_str}){return_str}:")
    
    # Check for docstring
    doc = ast.get_docstring(node)
    if doc:
        first_line = doc.strip().split("\n")[0]
        lines.append(f'{indent}    """{first_line}"""')
    lines.append(f"{indent}    ...")
    return "\n".join(lines)


def _format_class_signature(node: ast.ClassDef, symbols: Optional[Set[str]] = None) -> str:
    """Formats a class definition, preserving attributes, dataclass fields, and method signatures."""
    lines = []
    for dec in node.decorator_list:
        lines.append(f"@{ast.unparse(dec)}")
    
    bases_str = f"({', '.join(ast.unparse(b) for b in node.bases)})" if node.bases else ""
    lines.append(f"class {node.name}{bases_str}:")
    
    doc = ast.get_docstring(node)
    if doc:
        first_line = doc.strip().split("\n")[0]
        lines.append(f'    """{first_line}"""')
    
    class_body_lines = []
    for item in node.body:
        if isinstance(item, ast.AnnAssign):
            target = getattr(item.target, "id", None)
            if target:
                type_hint = ast.unparse(item.annotation)
                val = f" = {ast.unparse(item.value)}" if item.value else ""
                class_body_lines.append(f"    {target}: {type_hint}{val}")
        elif isinstance(item, ast.Assign):
            for t in item.targets:
                tid = getattr(t, "id", None)
                if tid and (tid.isupper() or not tid.startswith("_")):
                    val_str = ast.unparse(item.value)
                    if len(val_str) < 80:
                        class_body_lines.append(f"    {tid} = {val_str}")
        elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Include public methods and __init__
            if item.name == "__init__" or not item.name.startswith("_") or (symbols and item.name in symbols):
                class_body_lines.append(_format_func_signature(item, indent="    "))

    if not class_body_lines:
        lines.append("    ...")
    else:
        lines.extend(class_body_lines)
    
    return "\n".join(lines)


def _regex_fallback_python(content: str, symbols: Optional[Set[str]] = None) -> str:
    lines = []
    for line in content.splitlines():
        if re.match(r"^\s*(class|def|async def)\s+", line):
            lines.append(line)
    return "\n".join(lines)


def extract_typescript_spine(content: str, symbols: Optional[Set[str]] = None) -> str:
    """
    Extracts interfaces, types, enums, Zod schemas, and function/method headers
    from TypeScript/JavaScript source, stripping method bodies.
    """
    extracted_blocks = []
    lines = content.splitlines()
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # Match Zod schemas: export const FooSchema = z.object({ ... }); or export const FooSchema = z\n.object({ ... });
        zod_match = re.match(r"^(export\s+)?(const|let)\s+(\w+Schema)\s*=\s*z(\.|$)", stripped)
        if zod_match:
            name = zod_match.group(3)
            if not symbols or name in symbols:
                block_lines = [line]
                open_braces = line.count("{") - line.count("}")
                open_parens = line.count("(") - line.count(")")
                i += 1
                while i < n:
                    curr = lines[i]
                    block_lines.append(curr)
                    open_braces += curr.count("{") - curr.count("}")
                    open_parens += curr.count("(") - curr.count(")")
                    stripped_curr = curr.strip()
                    if open_braces <= 0 and open_parens <= 0 and (stripped_curr.endswith(";") or stripped_curr.endswith(")")):
                        i += 1
                        break
                    i += 1
                extracted_blocks.append("\n".join(block_lines))
                continue

        # Match interfaces & types: export (interface|type) Foo ...
        type_match = re.match(r"^(export\s+)?(interface|type|enum)\s+(\w+)", stripped)
        if type_match:
            name = type_match.group(3)
            if not symbols or name in symbols:
                block_lines = [line]
                open_braces = line.count("{") - line.count("}")
                i += 1
                while i < n and open_braces > 0:
                    curr = lines[i]
                    block_lines.append(curr)
                    open_braces += curr.count("{") - curr.count("}")
                    i += 1
                # If type alias single line or multi-line without braces
                if open_braces == 0 and not block_lines[0].endswith(";"):
                    while i < n and not lines[i - 1].strip().endswith(";"):
                        block_lines.append(lines[i])
                        i += 1
                extracted_blocks.append("\n".join(block_lines))
                continue

        # Match exported function headers
        func_match = re.match(r"^(export\s+)?(async\s+)?function\s+(\w+)\s*(\(.*?\))\s*(:\s*[^\{]+)?", stripped)
        if func_match:
            name = func_match.group(3)
            if not symbols or name in symbols:
                prefix = func_match.group(1) or ""
                async_p = func_match.group(2) or ""
                sig = func_match.group(4)
                ret = func_match.group(5) or ": void"
                extracted_blocks.append(f"{prefix}{async_p}function {name}{sig}{ret} {{ /* ... */ }}")
                # Advance past function body
                open_braces = line.count("{") - line.count("}")
                i += 1
                while i < n and open_braces > 0:
                    curr = lines[i]
                    open_braces += curr.count("{") - curr.count("}")
                    i += 1
                continue

        # Match React components: export const Component: React.FC<Props> = ...
        comp_match = re.match(r"^(export\s+)?const\s+(\w+)\s*(:\s*React\.FC<([^>]+)>|:\s*\([^)]*\)\s*=>\s*JSX\.Element)", stripped)
        if comp_match:
            name = comp_match.group(2)
            if not symbols or name in symbols:
                type_ann = comp_match.group(3)
                extracted_blocks.append(f"export const {name}{type_ann};")
                # Skip implementation
                open_braces = line.count("{") - line.count("}")
                i += 1
                while i < n and open_braces > 0:
                    curr = lines[i]
                    open_braces += curr.count("{") - curr.count("}")
                    i += 1
                continue

        i += 1

    return "\n\n".join(extracted_blocks)


def extract_sql_ddl(content: str, symbols: Optional[Set[str]] = None) -> str:
    """
    Extracts table schemas, type definitions, triggers, and indices from SQL,
    dropping raw INSERTs and data migration scripts.
    """
    extracted = []
    # Match CREATE TABLE blocks
    table_pattern = re.compile(r"CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\((.*?)\);", re.DOTALL | re.IGNORECASE)
    for match in table_pattern.finditer(content):
        table_name = match.group(2).strip('"')
        if not symbols or table_name in symbols:
            # Clean up internal whitespace
            body = "\n".join(f"  {line.strip()}" for line in match.group(3).splitlines() if line.strip())
            extracted.append(f"CREATE TABLE {table_name} (\n{body}\n);")

    # Match CREATE TYPE (e.g. ENUM)
    type_pattern = re.compile(r"CREATE\s+TYPE\s+([^\s]+)\s+AS\s+ENUM\s*\((.*?)\);", re.DOTALL | re.IGNORECASE)
    for match in type_pattern.finditer(content):
        type_name = match.group(1)
        if not symbols or type_name in symbols:
            vals = match.group(2).strip()
            extracted.append(f"CREATE TYPE {type_name} AS ENUM ({vals});")

    # Match CREATE INDEX and TRIGGER
    aux_pattern = re.compile(r"(CREATE\s+(UNIQUE\s+)?INDEX\s+[^;]+;|CREATE\s+TRIGGER\s+[^;]+;)", re.IGNORECASE)
    for match in aux_pattern.finditer(content):
        extracted.append(match.group(1).strip())

    return "\n\n".join(extracted)


def extract_design_tokens(content: str) -> str:
    """
    Extracts CSS custom properties (:root variables) and Tailwind configuration tokens.
    """
    extracted = []
    # CSS root custom properties
    root_pattern = re.compile(r":root\s*\{(.*?)\}", re.DOTALL)
    for match in root_pattern.finditer(content):
        props = []
        for line in match.group(1).splitlines():
            s = line.strip()
            if s.startswith("--"):
                props.append(f"  {s}")
        if props:
            extracted.append(":root {\n" + "\n".join(props) + "\n}")

    # Tailwind color tokens if matching JS/TS
    if "colors:" in content or "extend:" in content:
        theme_pattern = re.compile(r"(colors\s*:\s*\{.*?\}|spacing\s*:\s*\{.*?\})", re.DOTALL)
        for match in theme_pattern.finditer(content):
            extracted.append(match.group(1))

    return "\n\n".join(extracted)


def process_file(path: str, mode: str, symbols: Optional[Set[str]] = None) -> Dict[str, str]:
    """Inspects file type and runs appropriate extractor."""
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    ext = os.path.splitext(path)[1].lower()
    basename = os.path.basename(path).lower()

    if ext == ".py":
        spine = extract_python_spine(content, symbols)
        lang = "python"
    elif ext in [".ts", ".tsx", ".js", ".jsx"]:
        spine = extract_typescript_spine(content, symbols)
        lang = "typescript"
    elif ext == ".sql":
        spine = extract_sql_ddl(content, symbols)
        lang = "sql"
    elif ext in [".css", ".scss"] or "tailwind" in basename:
        spine = extract_design_tokens(content)
        lang = "css"
    else:
        # Generic fallback
        spine = content[:2000]
        lang = "text"

    return {
        "path": path,
        "lang": lang,
        "spine": spine.strip(),
        "orig_chars": len(content),
        "extracted_chars": len(spine.strip())
    }


def main():
    parser = argparse.ArgumentParser(
        description="Argon Context & AST Extractor - Surgical Type Spine and Token Generator."
    )
    parser.add_argument(
        "--files", "-f", nargs="+", required=True,
        help="One or more file paths to extract."
    )
    parser.add_argument(
        "--mode", "-m", choices=["all", "types", "contracts", "tokens"], default="all",
        help="Extraction mode."
    )
    parser.add_argument(
        "--symbols", "-s", type=str, default="",
        help="Comma-separated list of symbols (interfaces, schemas, functions, tables) to filter for."
    )
    parser.add_argument(
        "--max-tokens", "-t", type=int, default=3500,
        help="Max target input token ceiling (default: 3500)."
    )
    parser.add_argument(
        "--output", "-o", type=str, default="",
        help="Output markdown file path (defaults to stdout)."
    )

    args = parser.parse_args()
    symbol_set = {s.strip() for s in args.symbols.split(",") if s.strip()} if args.symbols else None

    results = []
    total_orig_chars = 0
    total_extracted_chars = 0

    output_lines = [
        "### Extracted Type Spine & Contracts Under Test\n"
    ]

    for fpath in args.files:
        res = process_file(fpath, args.mode, symbol_set)
        if "error" in res:
            print(f"[WARN] {res['error']}", file=sys.stderr)
            continue
        
        orig_c = res["orig_chars"]
        ext_c = res["extracted_chars"]
        total_orig_chars += orig_c
        total_extracted_chars += ext_c
        reduction = (1 - (ext_c / max(1, orig_c))) * 100

        output_lines.append(f"#### `{res['path']}` ({ext_c} chars, ~{count_tokens(res['spine'])} tokens, {reduction:.1f}% reduction)")
        output_lines.append(f"```{res['lang']}")
        output_lines.append(res["spine"] if res["spine"] else "// (No matching public types or contracts found)")
        output_lines.append("```\n")

    total_tokens = count_tokens("\n".join(output_lines))
    summary_header = [
        f"<!-- ARGON EXTRACTION STATS: {len(args.files)} files | "
        f"Raw: {total_orig_chars} chars (~{int(total_orig_chars / CHARS_PER_TOKEN)} tokens) -> "
        f"Spine: {total_extracted_chars} chars (~{total_tokens} tokens) | "
        f"Reduction: {(1 - (total_extracted_chars / max(1, total_orig_chars))) * 100:.1f}% -->\n"
    ]

    final_output = "\n".join(summary_header + output_lines)

    if total_tokens > args.max_tokens:
        warning_msg = (
            f"[ALERT] Extracted tokens ({total_tokens}) exceed budget ceiling ({args.max_tokens})! "
            f"Apply --symbols filtering or slice into Turn 1 and Turn 2."
        )
        print(warning_msg, file=sys.stderr)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as out_file:
            out_file.write(final_output)
        print(f"Extraction written to {args.output} (~{total_tokens} tokens).")
    else:
        print(final_output)


if __name__ == "__main__":
    main()
