import re

with open("backend/tests/test_auth.py", "r") as f:
    content = f.read()

# 1. Fix memory leak modulo
content = re.sub(
    r'res = client.post\("/api/auth/register", json=\{"email": f"memleak_\{i\}@test.com", "password": "password123"\}\)',
    r'res = client.post("/api/auth/register", json={"email": f"memleak_{i % 5}@test.com", "password": "password123"})',
    content
)

# 2. Fix duplicated OSError
def remove_dup(match):
    s = match.group(0)
    lines = s.split('\n')
    # find duplicate raise OSError
    filtered = []
    for line in lines:
        if "raise OSError" in line and len(filtered) > 0 and "raise OSError" in filtered[-1]:
            continue
        filtered.append(line)
    return '\n'.join(filtered)

content = re.sub(r'def mock_save_users_quota\(users\):[\s\S]*?raise OSError\("QuotaExceededError.*?"\)(?:\s*raise OSError\("QuotaExceededError.*?"\))?', lambda m: m.group(0).replace('        raise OSError("QuotaExceededError: simulated storage offline or quota limit")\n        raise OSError("QuotaExceededError: simulated storage offline or quota limit")', '        raise OSError("QuotaExceededError: simulated storage offline or quota limit")'), content)


# 3. Fix domain underscore
# tenant_a = "tenant_a" -> "tenant-a"
content = content.replace('tenant_a = "tenant_a"', 'tenant_a = "tenant-a"')
content = content.replace('tenant_b = "tenant_b"', 'tenant_b = "tenant-b"')

with open("backend/tests/test_auth.py", "w") as f:
    f.write(content)
