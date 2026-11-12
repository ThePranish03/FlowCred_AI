"""Load the original feature helper from its retained CPython bytecode."""
from __future__ import annotations

import importlib.machinery
import importlib.util
from pathlib import Path
import sys

_MODULE_NAME = "feature_engineering_utils"
if __name__ != _MODULE_NAME:
    raise ImportError(f"This compatibility module must be imported as {_MODULE_NAME!r}")

_bytecode_path = (
    Path(__file__).resolve().parent
    / "vendor"
    / f"{_MODULE_NAME}.{sys.implementation.cache_tag}.pyc"
)
if not _bytecode_path.is_file():
    raise ImportError(
        f"Original {_MODULE_NAME} bytecode is missing at {_bytecode_path}; "
        f"restore the CPython {sys.version_info.major}.{sys.version_info.minor} "
        "vendor artifact."
    )

try:
    _magic_number = _bytecode_path.read_bytes()[:4]
except OSError as exc:
    raise ImportError(f"Could not read original {_MODULE_NAME} bytecode") from exc

if _magic_number != importlib.util.MAGIC_NUMBER:
    raise ImportError(
        f"Original {_MODULE_NAME} bytecode is incompatible with CPython "
        f"{sys.version_info.major}.{sys.version_info.minor}; use the matching "
        "CPython runtime and vendor artifact."
    )

_module = sys.modules.get(_MODULE_NAME)
if _module is None:
    raise ImportError(f"{_MODULE_NAME} must be registered before loading its bytecode")

_loader = importlib.machinery.SourcelessFileLoader(_MODULE_NAME, str(_bytecode_path))
try:
    _loader.exec_module(_module)
except (EOFError, ImportError, ValueError) as exc:
    raise ImportError(
        f"Original {_MODULE_NAME} bytecode at {_bytecode_path.name} could not be "
        f"loaded by CPython {sys.version_info.major}.{sys.version_info.minor}."
    ) from exc
