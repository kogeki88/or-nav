with open("backend/tests/test_planner_gauge_resolution.py", "r") as f:
    content = f.read()

new_content = content.replace("def test_planner_gauge_resolution_diff_supplementary():", "def test_complex_gauge_disambiguation():")

with open("backend/tests/test_planner_gauge_resolution.py", "w") as f:
    f.write(new_content)
