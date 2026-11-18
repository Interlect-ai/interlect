import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const SERVER_ONLY = {
  name: "server-only",
  message:
    "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
};

// Every AI model call is masked for personal data, so only the control point may
// call a model. model-call.test.ts runs the same check over src and scripts.
const MODEL_CALL_MESSAGE =
  "Call AI models through src/lib/ai/model-call.ts (maskedModel, embed, embedMany, postChatCompletion), so personal data is masked first (T-209).";
// What may be imported from "ai" outside the control point: helpers and types that call nothing.
const AI_ALLOWED_IMPORTS = [
  "asSchema",
  "jsonSchema",
  "Output",
  "tool",
  "isStepCount",
  "NoObjectGeneratedError",
  "NoOutputGeneratedError",
  "LanguageModel",
  "ModelMessage",
  "ToolSet",
];
const MODEL_CALL_IMPORTS = {
  paths: [{ name: "ai", allowImportNames: AI_ALLOWED_IMPORTS, message: MODEL_CALL_MESSAGE }],
  patterns: [{ group: ["@ai-sdk/*", "!@ai-sdk/provider"], message: MODEL_CALL_MESSAGE }],
};
const GATEWAY = "/ai-gateway\\.vercel\\.sh/";
const MODEL_CALL_SYNTAX = [
  { selector: `Literal[value=${GATEWAY}]`, message: MODEL_CALL_MESSAGE },
  { selector: `TemplateElement[value.raw=${GATEWAY}]`, message: MODEL_CALL_MESSAGE },
  { selector: "ImportExpression[source.value=/^(ai|@ai-sdk\\/.+)$/]", message: MODEL_CALL_MESSAGE },
];
/** May call a model directly: the control point and its test. */
const MODEL_CALL_ALLOWED = ["src/lib/ai/model-call.ts", "src/lib/ai/model-call.test.ts"];

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "website"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [SERVER_ONLY, ...MODEL_CALL_IMPORTS.paths],
          patterns: MODEL_CALL_IMPORTS.patterns,
        },
      ],
      "no-restricted-syntax": ["error", ...MODEL_CALL_SYNTAX],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: MODEL_CALL_ALLOWED,
    rules: {
      "no-restricted-imports": ["error", { paths: [SERVER_ONLY] }],
      "no-restricted-syntax": "off",
    },
  },
  eslintPluginPrettier,
);
