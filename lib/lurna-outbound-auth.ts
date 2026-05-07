import { auth, verifyToken } from "@clerk/nextjs/server";
import { getLurnaMcpRequest } from "./lurna-mcp-request-context";

/**
 * Authorization and custom headers forwarded to api.lurna.co.
 * Precedence:
 * 1. Bearer on the incoming MCP `/mcp` request (optionally verified with Clerk).
 * 2. Signed-in Clerk session (`getToken`), with optional JWT template for your API.
 * 3. Env: LURNA_API_BEARER_TOKEN / LURNA_API_KEY / LURNA_API_AUTH_* .
 */
export async function resolveLurnaUpstreamAuthHeaders(): Promise<
  Record<string, string>
> {
  const headers: Record<string, string> = {};

  const fromMcp = getLurnaMcpRequest()?.bearerToken?.trim();
  if (
    fromMcp &&
    process.env.LURNA_FORWARD_MCP_BEARER?.trim().toLowerCase() !== "false"
  ) {
    if (
      process.env.CLERK_VERIFY_MCP_BEARER?.trim().toLowerCase() === "true"
    ) {
      const secret = process.env.CLERK_SECRET_KEY?.trim();
      if (!secret) {
        throw new Error(
          "CLERK_VERIFY_MCP_BEARER is true but CLERK_SECRET_KEY is missing.",
        );
      }
      try {
        await verifyToken(fromMcp, { secretKey: secret });
      } catch {
        throw new Error(
          "MCP Authorization Bearer is not a valid Clerk session JWT.",
        );
      }
    }
    headers.Authorization = `Bearer ${fromMcp}`;
    maybeMergeStaticAuth(headers);
    return headers;
  }

  if (clerkConfigured()) {
    try {
      const a = await auth();
      if (a.userId) {
        const template = process.env.LURNA_CLERK_JWT_TEMPLATE?.trim();
        const sessionJwt =
          template && template.length > 0
            ? await a.getToken({ template })
            : await a.getToken();
        if (sessionJwt) {
          headers.Authorization = `Bearer ${sessionJwt}`;
          maybeMergeStaticAuth(headers);
          return headers;
        }
      }
    } catch {
      /* no Clerk context (e.g. missing middleware in dev) — fall through */
    }
  }

  const token =
    process.env.LURNA_API_BEARER_TOKEN?.trim() ||
    process.env.LURNA_API_KEY?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const customName = process.env.LURNA_API_AUTH_HEADER?.trim();
  const customValue = process.env.LURNA_API_AUTH_VALUE?.trim();
  if (customName && customValue) headers[customName] = customValue;

  return headers;
}

function clerkConfigured(): boolean {
  return !!(
    process.env.CLERK_SECRET_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  );
}

/** When LURNA_INCLUDE_STATIC_AUTH=true, also attach env-based auth alongside Clerk/user Bearer. */
function maybeMergeStaticAuth(headers: Record<string, string>): void {
  if (process.env.LURNA_INCLUDE_STATIC_AUTH?.trim().toLowerCase() !== "true") {
    return;
  }

  const customName = process.env.LURNA_API_AUTH_HEADER?.trim();
  const customValue = process.env.LURNA_API_AUTH_VALUE?.trim();
  if (customName && customValue && !headers[customName]) {
    headers[customName] = customValue;
  }

  const token =
    process.env.LURNA_API_BEARER_TOKEN?.trim() ||
    process.env.LURNA_API_KEY?.trim();
  if (
    token &&
    !headers.Authorization &&
    customName?.toLowerCase() !== "authorization"
  ) {
    headers.Authorization = `Bearer ${token}`;
  }
}
