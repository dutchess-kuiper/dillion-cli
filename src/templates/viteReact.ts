/**
 * Embedded template files for `dillion artifacts init`.
 *
 * Files are inlined as string constants so the compiled `bun build --compile`
 * binary keeps working without a separate assets directory.
 */

export interface TemplateFile {
  /** Relative path inside the new artifact directory. */
  path: string;
  contents: string;
}

const PACKAGE_JSON = `{
  "name": "dillion-report",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.0",
    "vite": "^5.4.0"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the bundle works no matter where it's mounted
// (member viewer, share link, local preview).
//
// The share viewer renders the report inside sandbox="allow-scripts" (no
// allow-same-origin), so the iframe document has a null origin. That breaks
// two default Vite behaviors: ES-module scripts are fetched in CORS mode and
// get blocked (no ACAO for null), and \`crossorigin\` on <script>/<link> tags
// disables credentialed requests so the share-session cookie never flows.
// We emit a classic IIFE bundle and strip crossorigin/type="module" from the
// entry tags — classic loads aren't CORS-gated and send cookies per SameSite.
function dillionShareCompat() {
  return {
    name: "dillion-share-compat",
    transformIndexHtml(html: string) {
      return html
        .replace(/\\s+crossorigin(?:="[^"]*")?/g, "")
        // Classic scripts in <head> run before <body> is parsed, so
        // \`document.getElementById("root")\` returns null. Module scripts
        // were implicitly deferred; we add \`defer\` to preserve that.
        .replace(/<script\\s+type="module"/g, "<script defer");
    },
  };
}

export default defineConfig({
  plugins: [react(), dillionShareCompat()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    modulePreload: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dillion Research Report</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;

const STYLES_CSS = `:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  background: var(--bg, #fff);
  color: var(--fg, #111);
}

main {
  max-width: 880px;
  margin: 0 auto;
  padding: 48px 24px 96px;
  line-height: 1.55;
}

h1 { font-size: 2.25rem; margin: 0 0 8px; }
h2 { font-size: 1.5rem; margin-top: 2.5rem; }
p { margin: 0.75em 0; }

.cite {
  display: inline-flex;
  align-items: center;
  margin: 0 2px;
  padding: 1px 6px;
  font-size: 0.78em;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  cursor: pointer;
  vertical-align: text-top;
  line-height: 1.4;
  font-weight: 500;
}

.cite:hover { background: rgba(127, 127, 127, 0.12); }

.callout {
  margin: 24px 0;
  padding: 16px 20px;
  border-left: 3px solid #888;
  background: rgba(127, 127, 127, 0.08);
  border-radius: 4px;
}

.chart {
  margin: 24px 0;
  width: 100%;
  height: 300px;
}
`;

const APP_TSX = `import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Cite } from "./lib/dillion-bridge";

const REVENUE = [
  { month: "Jan", revenue: 12.4 },
  { month: "Feb", revenue: 13.1 },
  { month: "Mar", revenue: 14.8 },
  { month: "Apr", revenue: 14.2 },
  { month: "May", revenue: 16.0 },
  { month: "Jun", revenue: 17.6 },
];

export default function App() {
  return (
    <main>
      <h1>Acme Industries — Q2 Diligence</h1>
      <p>
        This report is rendered as a sandboxed React bundle. Replace this
        scaffold with your own JSX, charts, and analysis. Citation chips below
        use the Dillion bridge to ask the host VDR to open the source document.
      </p>

      <h2>Revenue trajectory</h2>
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={REVENUE} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.3)" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={(v) => \`$\${v}M\`} />
            <Tooltip formatter={(v: number) => \`$\${v.toFixed(1)}M\`} />
            <Line type="monotone" dataKey="revenue" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Findings</h2>
      <p>
        Revenue grew 41% YoY driven by enterprise expansion. Pricing held
        steady through the period
        <Cite jobId="REPLACE_WITH_REAL_JOB_ID" label="1" />, with no concessions
        on master agreements
        <Cite
          jobId="REPLACE_WITH_REAL_JOB_ID"
          chunkId="REPLACE_WITH_REAL_CHUNK_ID"
          label="2"
        />.
      </p>

      <div className="callout">
        <strong>Note:</strong> Citation chips fall back to plain badges when
        previewed outside the Dillion VDR (e.g. <code>vite preview</code>).
      </div>
    </main>
  );
}
`;

const BRIDGE_TS = `/**
 * Dillion citation bridge.
 *
 * Runs inside a sandboxed iframe inside the Dillion VDR. Clicking a citation
 * sends a structured message to the parent shell, which validates project
 * access and opens the source document with bbox highlights.
 *
 * The bundle has no API keys and never talks directly to the backend; the
 * parent shell is the only privileged actor.
 */

import { useEffect, useState, type ReactNode } from "react";

export type DillionMessage =
  | { source: "dillion-artifact"; v: 1; type: "OPEN_SOURCE"; jobId: string; chunkId?: string; label?: string }
  | { source: "dillion-artifact"; v: 1; type: "READY" };

let warnedOnce = false;

function inFrame(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window;
  } catch {
    return false;
  }
}

export function openSource(jobId: string, chunkId?: string, label?: string): void {
  if (!inFrame()) {
    if (!warnedOnce) {
      console.info(
        "[dillion-bridge] Not running inside the Dillion VDR — citation click is a no-op.",
      );
      warnedOnce = true;
    }
    return;
  }
  const message: DillionMessage = {
    source: "dillion-artifact",
    v: 1,
    type: "OPEN_SOURCE",
    jobId,
    ...(chunkId ? { chunkId } : {}),
    ...(label ? { label } : {}),
  };
  // The parent enforces its own origin allowlist; "*" is acceptable here
  // because the payload contains no secrets.
  window.parent.postMessage(message, "*");
}

export function announceReady(): void {
  if (!inFrame()) return;
  const message: DillionMessage = {
    source: "dillion-artifact",
    v: 1,
    type: "READY",
  };
  window.parent.postMessage(message, "*");
}

export interface CiteProps {
  jobId: string;
  chunkId?: string;
  label?: string | number;
  children?: ReactNode;
}

/** Inline citation chip. Click to open source in the parent VDR. */
export function Cite({ jobId, chunkId, label, children }: CiteProps) {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(inFrame());
    announceReady();
  }, []);

  const text = children ?? label ?? "src";
  return (
    <button
      type="button"
      className="cite"
      onClick={() => openSource(jobId, chunkId, label?.toString())}
      title={
        embedded
          ? "Open source document"
          : "Citation (preview only — open inside Dillion to view source)"
      }
    >
      {text}
    </button>
  );
}
`;

const GITIGNORE = `node_modules
dist
.dillion
*.zip
.DS_Store
`;

const README = `# Dillion Research Report

Scaffold for an interactive, JSX-based research report that renders inside the
Dillion VDR (sandboxed iframe).

## Setup

\`\`\`sh
bun install   # or npm install / pnpm install
bun run dev   # http://localhost:5173 — citations are no-ops outside the VDR
bun run build # produces ./dist
\`\`\`

## Citations

Use \`<Cite jobId="…" chunkId="…" label="1" />\` from \`src/lib/dillion-bridge.ts\`.
The component sends a \`postMessage\` to the parent shell when clicked; the
parent resolves the citation and opens the source document. There is **no
API key** in this bundle.

## Publish

\`\`\`sh
dillion artifacts publish --title "Q2 Diligence" --project <project-id>
\`\`\`

To publish a new version of an existing report:

\`\`\`sh
dillion artifacts publish --report <report-id>
\`\`\`

To create a share link (optional password; source document preview is on by default, add \`--no-citations\` to disable):

\`\`\`sh
dillion artifacts share <report-id> --password '<strong>'
\`\`\`
`;

export const VITE_REACT_TEMPLATE: TemplateFile[] = [
  { path: "package.json", contents: PACKAGE_JSON },
  { path: "vite.config.ts", contents: VITE_CONFIG },
  { path: "tsconfig.json", contents: TSCONFIG },
  { path: "index.html", contents: INDEX_HTML },
  { path: "src/main.tsx", contents: MAIN_TSX },
  { path: "src/styles.css", contents: STYLES_CSS },
  { path: "src/App.tsx", contents: APP_TSX },
  { path: "src/lib/dillion-bridge.tsx", contents: BRIDGE_TS },
  { path: ".gitignore", contents: GITIGNORE },
  { path: "README.md", contents: README },
];
