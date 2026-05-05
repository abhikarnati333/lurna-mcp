import { baseURL } from "@/baseUrl";
import {
  lurnaBackendRequest,
  lurnaPathFlashcards,
  lurnaPathQuizzes,
  type LurnaRequestResult,
} from "@/lib/lurna-api-client";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** Work around TS2589 from `registerTool` generics × Zod in the MCP SDK. */
function registerMcpTool(
  server: McpServer,
  toolName: string,
  cfg: {
    title?: string;
    description?: string;
    inputSchema: Record<string, z.ZodTypeAny>;
    _meta?: Record<string, unknown>;
  },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>,
): void {
  const register = server.registerTool.bind(server) as (
    name: string,
    config: typeof cfg,
    handler: typeof cb,
  ) => void;
  register(toolName, cfg, cb);
}

function formatLurnaResult(
  heading: string,
  result: LurnaRequestResult,
): CallToolResult {
  if (!result.ok) {
    return {
      content: [
        {
          type: "text",
          text: `${heading}\nError: ${result.error}`,
        },
      ],
      isError: true,
    };
  }

  const headline = `${heading}\nHTTP ${result.status}`;
  const ct = result.contentType ?? "";
  let text: string;
  if (ct.includes("application/json")) {
    try {
      text = `${headline}\n${JSON.stringify(JSON.parse(result.bodyText), null, 2)}`;
    } catch {
      text = `${headline}\n${result.bodyText}`;
    }
  } else {
    text = `${headline}\n${result.bodyText}`;
  }

  return { content: [{ type: "text", text }] };
}

function parseOptionalJsonBody(
  bodyJson: unknown,
): { ok: true; value?: unknown } | { ok: false; error: CallToolResult } {
  if (bodyJson === undefined || bodyJson === null) return { ok: true };
  const s =
    typeof bodyJson === "string" ? bodyJson.trim() : String(bodyJson).trim();
  if (!s) return { ok: true };

  try {
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return {
      ok: false,
      error: {
        content: [{ type: "text", text: "Invalid JSON in body_json argument." }],
        isError: true,
      },
    };
  }
}

function optionalQuery(query: unknown): Record<string, string> | undefined {
  if (query === undefined || query === null) return undefined;
  if (typeof query !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const methodEnum = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const getAppsSdkCompatibleHtml = async (baseUrl: string, path: string) => {
  const result = await fetch(`${baseUrl}${path}`);
  return await result.text();
};

type ContentWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  description: string;
  widgetDomain: string;
};

function widgetMeta(widget: ContentWidget) {
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": true,
  } as const;
}

const handler = createMcpHandler(async (server) => {
  const html = await getAppsSdkCompatibleHtml(baseURL, "/");

  const contentWidget: ContentWidget = {
    id: "show_content",
    title: "Show Content",
    templateUri: "ui://widget/content-template.html",
    invoking: "Loading content...",
    invoked: "Content loaded",
    html: html,
    description: "Displays the homepage content",
    widgetDomain: "https://nextjs.org/docs",
  };
  server.registerResource(
    "content-widget",
    contentWidget.templateUri,
    {
      title: contentWidget.title,
      description: contentWidget.description,
      mimeType: "text/html+skybridge",
      _meta: {
        "openai/widgetDescription": contentWidget.description,
        "openai/widgetPrefersBorder": true,
      },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html+skybridge",
          text: `<html>${contentWidget.html}</html>`,
          _meta: {
            "openai/widgetDescription": contentWidget.description,
            "openai/widgetPrefersBorder": true,
            "openai/widgetDomain": contentWidget.widgetDomain,
          },
        },
      ],
    }),
  );

  registerMcpTool(
    server,
    contentWidget.id,
    {
      title: contentWidget.title,
      description:
        "Fetch and display the homepage content with the name of the user",
      inputSchema: {
        name: z
          .string()
          .describe("The name of the user to display on the homepage"),
      },
      _meta: widgetMeta(contentWidget),
    },
    async (args) => {
      const name = String(args.name ?? "");
      return {
        content: [{ type: "text", text: name }],
        structuredContent: {
          name,
          timestamp: new Date().toISOString(),
        },
        _meta: widgetMeta(contentWidget),
      };
    },
  );

  /* —— api.lurna.co bridge tools —— */

  registerMcpTool(server, "lurna_request", {
    title: "Call Lurna API",
    description:
      "Send an HTTP request to the Lurna backend (api.lurna.co). Use GET for reads; pass body_json only for mutations. Paths must begin with /. Base URL overrides with LURNA_API_BASE_URL.",
    inputSchema: {
      method: methodEnum.describe("HTTP verb"),
      path: z
        .string()
        .describe(
          "API route path on api.lurna.co, starting with '/', e.g. /generate-study-set",
        ),
      query: z
        .record(z.string())
        .optional()
        .describe("Optional URL query keys (string values only)"),
      body_json: z
        .string()
        .optional()
        .describe(
          'JSON-encoded request body for POST/PUT/PATCH (omit for GET), e.g. {"front":"Q","back":"A"}',
        ),
    },
  }, async (args) => {
    const method =
      typeof args.method === "string" ? args.method.toUpperCase() : "GET";
    const path = String(args.path ?? "");
    const parsed = parseOptionalJsonBody(args.body_json);
    if (!parsed.ok) return parsed.error;
    const r = await lurnaBackendRequest({
      method,
      path,
      query: optionalQuery(args.query),
      jsonBody: parsed.value,
    });
    return formatLurnaResult(`[Lurna API] ${method} ${path}`, r);
  });

  registerMcpTool(server, "lurna_post_flashcards", {
    title: "Generate study set",
    description:
      `POST to the Lurna study-set generator (default ${lurnaPathFlashcards()}, env LURNA_PATH_FLASHCARDS). Body must match your /generate-study-set API.`,
    inputSchema: {
      body_json: z
        .string()
        .describe(
          "JSON-encoded body for /generate-study-set exactly as your API expects.",
        ),
    },
  }, async (args) => {
    const parsed = parseOptionalJsonBody(args.body_json);
    if (!parsed.ok) return parsed.error;
    if (parsed.value === undefined) {
      return {
        content: [{ type: "text", text: "body_json is required for POST." }],
        isError: true,
      };
    }
    const p = lurnaPathFlashcards();
    const r = await lurnaBackendRequest({
      method: "POST",
      path: p,
      jsonBody: parsed.value,
    });
    return formatLurnaResult(`[Lurna API] POST ${p}`, r);
  });

  registerMcpTool(server, "lurna_post_quizzes", {
    title: "Generate quiz from flashcards (streaming)",
    description:
      `POST to quiz generation (default ${lurnaPathQuizzes()}, env LURNA_PATH_QUIZZES). Response may stream; MCP returns the fetched body once complete.`,
    inputSchema: {
      body_json: z
        .string()
        .describe(
          "JSON-encoded body for /generate-quiz-from-flashcards-streaming as your API expects.",
        ),
    },
  }, async (args) => {
    const parsed = parseOptionalJsonBody(args.body_json);
    if (!parsed.ok) return parsed.error;
    if (parsed.value === undefined) {
      return {
        content: [{ type: "text", text: "body_json is required for POST." }],
        isError: true,
      };
    }
    const p = lurnaPathQuizzes();
    const r = await lurnaBackendRequest({
      method: "POST",
      path: p,
      jsonBody: parsed.value,
    });
    return formatLurnaResult(`[Lurna API] POST ${p}`, r);
  });
});

export const GET = handler;
export const POST = handler;
