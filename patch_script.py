import re

with open('frontend/src/lib/deltaSyncPayload.test.ts', 'r') as f:
    content = f.read()

# Revert frozenOriginal to original (since the test asserts against mixedPayloads anyway, original is not used later except for freezing)
content = content.replace(
    "const frozenOriginal = Object.freeze(structuredClone(mixedPayloads));\n    frozenOriginal.forEach(Object.freeze);",
    "const original = Object.freeze(structuredClone(mixedPayloads));\n    original.forEach(Object.freeze);"
)

# Fix fetch signatures to include Typescript typing
content = content.replace(
    "global.fetch = async (...args) => { if (args.length === 0) throw new TypeError('Missing arguments'); throw new TypeError('Failed to fetch'); };",
    "global.fetch = async (...args: any[]) => { if (args.length === 0) throw new TypeError('Missing arguments'); throw new TypeError('Failed to fetch'); };"
)

content = content.replace(
    "global.fetch = async (...args) => { if (args.length === 0) throw new TypeError('Missing arguments'); const [url, options] = args;",
    "global.fetch = async (...args: any[]) => { if (args.length === 0) throw new TypeError('Missing arguments'); const [url, options] = args;"
)

with open('frontend/src/lib/deltaSyncPayload.test.ts', 'w') as f:
    f.write(content)
