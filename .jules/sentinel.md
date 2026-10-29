## 2026-10-29 - [Path Traversal in API]
**Vulnerability:** Path traversal in `get_pack_file` endpoint due to insufficient validation of the target path.
**Learning:** Checking for `..` is not sufficient, as absolute paths or normalized strings can bypass this logic, allowing arbitrary file reading (e.g. source code, `.env`).
**Prevention:** Always use `pathlib.Path.resolve()` and `Path.is_relative_to()` to strictly bound the target path to an allowed base directory.
