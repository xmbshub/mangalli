import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const appFiles = ["apps/**/*.{js,jsx,ts,tsx}"];
const appNextConfig = nextVitals.map((config) => ({
  ...config,
  files: config.files ?? appFiles,
}));

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".next-*/**",
      "**/.next/**",
      "**/.turbo/**",
      ".sanity/**",
      ".vercel/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "**/._*",
    ],
  },
  ...appNextConfig,
  ...nextTs,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      react: {
        version: "19.2.0",
      },
    },
  },
];

export default eslintConfig;
