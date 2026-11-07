with open("backend/tests/test_config.py", "r") as f:
    content = f.read()

# 4. Fuzzing
old_fuzz = """def test_validate_tenant_id_fuzzing():
    # Attempting various bad inputs
    bad_inputs = [
        "../../etc/passwd",
        "/etc/passwd",
        "some_tenant/../../../etc/passwd",
        "sacred_heart::or/../../",
        "te!nant",
        "tenant_1;",
        "tenant space",
        "tenant#name",
        "\\x00tenant",
        "tenant\\n1",
        "  ..  ",
        "//etc/passwd",
        "/",
        "foo//bar",
        "foo/"
    ]
    for bad in bad_inputs:
        with pytest.raises(ValueError):
            validate_tenant_id(bad)"""

new_fuzz = """def test_validate_tenant_id_fuzzing():
    import random
    import string

    bad_inputs = [
        "../../etc/passwd",
        "/etc/passwd",
        "some_tenant/../../../etc/passwd",
        "sacred_heart::or/../../",
        "te!nant",
        "tenant_1;",
        "tenant space",
        "tenant#name",
        "\\x00tenant",
        "tenant\\n1",
        "  ..  ",
        "//etc/passwd",
        "/",
        "foo//bar",
        "foo/"
    ]

    # Retain the random generation and append explicit delimiters if boundary invariants must be enforced.
    def generate_random_string(length):
        return ''.join(random.choice(string.ascii_letters + string.punctuation + string.digits) for _ in range(length))

    bad_inputs.extend([generate_random_string(20) + '::or' for _ in range(20)])

    for bad in bad_inputs:
        with pytest.raises(ValueError):
            validate_tenant_id(bad)"""
# The issue earlier was I wrapped it in an `if` condition. The reviewer said:
# "By checking the input against a regex first, the test will silently skip any payloads that accidentally bypass the regex, completely defeating the purpose of the security/validation test."
# Which is totally correct. We should test it unconditionally.
# But wait, what if `generate_random_string(20) + '::or'` happens to be a VALID string?
# The random string uses punctuation (`string.punctuation`) which contains characters not allowed by `validate_tenant_id`. But is it guaranteed? Yes, `random.choice(string.ascii_letters + string.punctuation + string.digits)` will very likely contain punctuation.
# Actually, since it has length 20, it is very highly likely to contain punctuation. But to be safe, I should inject at least one invalid char.
# However, `::or` is also invalid! `validate_tenant_id` replaces `::` with `/`, and then validates against `^[a-zA-Z0-9_]+(?:/[a-zA-Z0-9_]+)*$`. But wait, if it replaces `::` with `/`, then `generate_random_string(20) + '::or'` will become `generate_random_string(20)/or`.
# If `generate_random_string(20)` only has alphanumerics, it WOULD be valid!
# Let's ensure it has an invalid character.

new_fuzz = """def test_validate_tenant_id_fuzzing():
    import random
    import string

    bad_inputs = [
        "../../etc/passwd",
        "/etc/passwd",
        "some_tenant/../../../etc/passwd",
        "sacred_heart::or/../../",
        "te!nant",
        "tenant_1;",
        "tenant space",
        "tenant#name",
        "\\x00tenant",
        "tenant\\n1",
        "  ..  ",
        "//etc/passwd",
        "/",
        "foo//bar",
        "foo/"
    ]

    # Retain the random generation and append explicit delimiters if boundary invariants must be enforced.
    def generate_random_string(length):
        # Force at least one invalid character (e.g. !) to guarantee rejection
        return '!' + ''.join(random.choice(string.ascii_letters + string.punctuation + string.digits) for _ in range(length - 1))

    bad_inputs.extend([generate_random_string(20) + '::or' for _ in range(20)])

    for bad in bad_inputs:
        with pytest.raises(ValueError):
            validate_tenant_id(bad)"""

content = content.replace(old_fuzz, new_fuzz)
with open("backend/tests/test_config.py", "w") as f:
    f.write(content)
