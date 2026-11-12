from pathlib import Path
import runpy

def test_real_saved_artifacts_match_recorded_test_outputs():
    script = Path(__file__).resolve().parents[1] / "verify_artifacts.py"
    runpy.run_path(str(script), run_name="__main__")
