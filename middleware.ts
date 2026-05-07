import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/** Public: auth UI, MCP transport (Bearer for API), iframe widget HTML (server fetch has no Clerk cookie). */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/mcp(.*)",
  "/widget(.*)",
]);

function applyCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  response.headers.set("Access-Control-Allow-Headers", "*");
}

export default clerkMiddleware(async (auth, request) => {
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    applyCors(response);
    return response;
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  const response = NextResponse.next();
  applyCors(response);
  return response;
});

export const config = {
  matcher: [
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
