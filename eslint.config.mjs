/* Formatting rules for this repository.
 *
 *     npm run format     rewrite files in place
 *     npm run lint       report without changing anything
 *
 * This is a formatter, not a code-quality gate: the rules are @stylistic ones plus `curly`, the
 * single core rule below, so nothing here ever comments on what the code does. ESLint is used
 * instead of a reprinter (Prettier, dprint, Biome) on purpose. All three reprint from the AST and
 * therefore destroy two things this codebase does everywhere: continuation lines aligned under the
 * opening paren of a call, and switch cases at the same indentation as the `switch`.
 *
 * The flip side is that a rule set only normalizes what it is told to. Where the code has a choice
 * a reprinter would make for it — whether a call's arguments are aligned or indented, where a long
 * boolean expression breaks — the rules below stay silent, and consistency there is still a matter
 * of following the surrounding file.
 */

import stylistic from "@stylistic/eslint-plugin"

export default [
    {
        ignores: [
            /* Untracked local context material, and the DXF corpus. */
            "local/**",
            "test-data/**",
            /* TypeScript; would need a parser this config deliberately does not pull in. */
            "test/types/**"
        ]
    },
    {
        files: ["src/**/*.js", "test/**/*.mjs", "*.mjs"],

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module"
        },

        plugins: {"@stylistic": stylistic},

        rules: {
            /* Braces on every block, including one-statement `if` bodies. The only core (non-
             * @stylistic) rule here: braces never change what the code does, so it stays within
             * what this config is for.
             */
            curly: ["error", "all"],

            "@stylistic/semi": ["error", "never"],
            "@stylistic/quotes": ["error", "double", {avoidEscape: true}],
            "@stylistic/comma-dangle": ["error", "never"],
            "@stylistic/linebreak-style": ["error", "unix"],
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/no-multiple-empty-lines": ["error", {max: 2, maxEOF: 0}],
            "@stylistic/no-mixed-spaces-and-tabs": "error",

            /* Most of the "off" entries below do not disable indentation checking, they disable it
             * for *continuation* lines of that construct only: the first line of the statement is
             * still checked. That is what preserves the aligned-under-the-paren argument lists and
             * hanging object literals this codebase is full of, while still catching a block that
             * sits at the wrong level.
             */
            "@stylistic/indent": ["error", 4, {
                /* Cases sit at the same level as the `switch`, as they do throughout DxfScene. */
                SwitchCase: 0,
                CallExpression: {arguments: "off"},
                FunctionDeclaration: {parameters: "off"},
                FunctionExpression: {parameters: "off"},
                ObjectExpression: "off",
                ArrayExpression: "off",
                ImportDeclaration: "off",
                MemberExpression: "off",
                VariableDeclarator: "off",
                flatTernaryExpressions: true,
                /* Wrapped expressions are aligned by hand (operands lined up under the first
                 * operand, `?`/`:` under the condition), which no offset rule can express.
                 */
                ignoredNodes: [
                    "BinaryExpression", "LogicalExpression", "ConditionalExpression",
                    "TemplateLiteral *"
                ]
            }],

            "@stylistic/object-curly-spacing": ["error", "never"],
            "@stylistic/array-bracket-spacing": ["error", "never"],
            "@stylistic/computed-property-spacing": ["error", "never"],
            "@stylistic/space-in-parens": ["error", "never"],
            "@stylistic/block-spacing": ["error", "always"],
            /* `allowSingleLine: false` is load-bearing next to `curly`, not a preference: a block
             * is spread over its own lines, never `if (x) { break }`. Allowing the single-line
             * form lets curly's fixer satisfy itself with it, which is the cheaper fix and not the
             * shape wanted here.
             */
            "@stylistic/brace-style": ["error", "1tbs", {allowSingleLine: false}],
            "@stylistic/space-before-blocks": "error",
            "@stylistic/space-before-function-paren":
                ["error", {anonymous: "never", named: "never", asyncArrow: "always"}],
            "@stylistic/function-call-spacing": ["error", "never"],
            "@stylistic/keyword-spacing": "error",
            "@stylistic/space-infix-ops": "error",
            "@stylistic/space-unary-ops": "error",
            "@stylistic/arrow-spacing": "error",
            "@stylistic/comma-spacing": "error",
            "@stylistic/comma-style": ["error", "last"],
            "@stylistic/key-spacing": "error",
            "@stylistic/semi-spacing": "error",
            "@stylistic/switch-colon-spacing": "error",
            "@stylistic/rest-spread-spacing": ["error", "never"],
            "@stylistic/dot-location": ["error", "property"],
            "@stylistic/no-whitespace-before-property": "error",
            /* The one rule the fixer cannot satisfy: an over-long line has to be broken by hand,
             * by rewrapping a comment, wrapping an expression, or decomposing code that has
             * nested too deeply to fit. An error rather than a warning, because CI runs
             * `npm run lint`. A long string or URL is exempt — those cannot always be broken.
             */
            "@stylistic/max-len": ["error", {
                code: 100,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
                ignoreRegExpLiterals: true
            }]
        }
    }
]
