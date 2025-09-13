from pathlib import Path
from app.file_ops import safe_join
import pytest
import tempfile

def test_safe_join_ok():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td).resolve()
        child = root / "sub"
        child.mkdir()
        assert safe_join(root, "sub").resolve() == child

def test_safe_join_traversal():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td).resolve()
        with pytest.raises(Exception):
            safe_join(root, "../etc/passwd")